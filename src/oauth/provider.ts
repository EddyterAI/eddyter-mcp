/**
 * EddyterOAuthProvider — OAuth 2.1 provider for the remote MCP server, required
 * for the Claude connector DIRECTORY (the secret-path connector in http.ts is for
 * custom-connector-by-URL and stays as-is).
 *
 * SCAFFOLD STATUS: the OAuth protocol plumbing is real and works end-to-end
 * (metadata discovery, dynamic client registration, PKCE, code→token exchange,
 * bearer verification). The two Eddyter-specific integration points are marked
 * `INTEGRATION` and currently backed by in-memory stores + a dev shortcut:
 *
 *   1. authorize(): in prod, redirect the user to Eddyter login (Supabase) and
 *      let the /eddyter/callback route resolve their license key. In dev, set
 *      OAUTH_DEV_LICENSE_KEY to skip login so the full handshake is testable.
 *   2. clients and tokens persist to a JSON file (see store.ts) so restarts don't
 *      invalidate registrations — replace with Redis for multi-instance prod.
 *      Tokens are stored as SHA-256 hashes, never in plaintext.
 *
 * Identity model: an access token is bound to ONE Eddyter license key, surfaced
 * to tools via AuthInfo.extra.licenseKey (see http-oauth.ts).
 */

import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { JsonFileState } from "./store.js";

const token = () => randomBytes(32).toString("hex");
const nowMs = () => Date.now();
/** Hosts whose OAuth callbacks may have a lost registration re-created (recoverClient). */
const RECOVERABLE_REDIRECT_HOSTS = [
  "chatgpt.com",
  "chat.openai.com",
  "platform.openai.com",
  "claude.ai",
  "claude.com",
];
/** Tokens are looked up by hash so the persisted file never holds usable tokens. */
const hash = (t: string) => createHash("sha256").update(t).digest("hex");

interface PendingCode {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
  state?: string;
  licenseKey?: string; // filled once the user authenticates (callback / dev)
  expiresAt: number;
}
interface AccessRec {
  clientId: string;
  scopes: string[];
  licenseKey: string;
  expiresAt: number;
}
interface RefreshRec {
  clientId: string;
  scopes: string[];
  licenseKey: string;
}

interface PersistedState {
  clients: Record<string, OAuthClientInformationFull>;
  accessTokens: Record<string, AccessRec>;
  refreshTokens: Record<string, RefreshRec>;
}

/** Client registry (DCR), persisted through the provider's onChange callback. */
class PersistedClientsStore implements OAuthRegisteredClientsStore {
  constructor(
    private readonly clients: Map<string, OAuthClientInformationFull>,
    private readonly onChange: () => void,
  ) {}
  async getClient(clientId: string) {
    return this.clients.get(clientId);
  }
  async registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): Promise<OAuthClientInformationFull> {
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: token(),
      client_id_issued_at: Math.floor(nowMs() / 1000),
    };
    this.clients.set(full.client_id, full);
    this.onChange();
    return full;
  }
}

export interface EddyterOAuthConfig {
  /** This server's issuer URL, e.g. https://mcp.eddyter.com */
  issuer: string;
  /** Where to send users to log in (Eddyter/Supabase-backed). */
  eddyterLoginUrl: string;
  accessTtlSeconds: number;
  /** Dev-only: skip Eddyter login and bind every auth to this key. */
  devLicenseKey?: string;
  /** JSON file for clients + tokens; omit to keep everything in memory only. */
  storePath?: string;
}

export class EddyterOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  private codes = new Map<string, PendingCode>(); // short-lived, not persisted
  private clients: Map<string, OAuthClientInformationFull>;
  private accessTokens: Map<string, AccessRec>; // keyed by hash(token)
  private refreshTokens: Map<string, RefreshRec>; // keyed by hash(token)
  private readonly state: JsonFileState<PersistedState>;

  constructor(private readonly config: EddyterOAuthConfig) {
    this.state = new JsonFileState<PersistedState>(config.storePath);
    const saved = this.state.load();
    this.clients = new Map(Object.entries(saved.clients ?? {}));
    this.accessTokens = new Map(
      Object.entries(saved.accessTokens ?? {}).filter(([, r]) => r.expiresAt > nowMs()),
    );
    this.refreshTokens = new Map(Object.entries(saved.refreshTokens ?? {}));
    this.clientsStore = new PersistedClientsStore(this.clients, () => this.persist());
  }

  /**
   * Re-create a client registration that was lost (e.g. before persistence existed,
   * or if the store file is wiped). MCP clients cache their client_id and some —
   * like the OpenAI plugin portal — offer no way to re-register, so they would be
   * stuck on "Invalid client_id" forever.
   *
   * Only IDs in our own format with an HTTPS redirect to a known MCP client host
   * are recovered. This grants nothing beyond what open DCR (/register) already
   * allows anyone, and PKCE still protects the code exchange.
   */
  recoverClient(clientId: string, redirectUri: string): void {
    if (!/^[0-9a-f]{64}$/.test(clientId) || this.clients.has(clientId)) return;
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      return;
    }
    const trusted = RECOVERABLE_REDIRECT_HOSTS.some(
      (h) => url.hostname === h || url.hostname.endsWith(`.${h}`),
    );
    if (url.protocol !== "https:" || !trusted) return;

    this.clients.set(clientId, {
      client_id: clientId,
      client_id_issued_at: Math.floor(nowMs() / 1000),
      client_name: "Recovered client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    this.persist();
    // eslint-disable-next-line no-console
    console.log(`[eddyter-mcp:oauth] recovered client registration for ${url.hostname}`);
  }

  private persist(): void {
    const now = nowMs();
    this.state.save({
      clients: Object.fromEntries(this.clients),
      accessTokens: Object.fromEntries(
        [...this.accessTokens].filter(([, r]) => r.expiresAt > now),
      ),
      refreshTokens: Object.fromEntries(this.refreshTokens),
    });
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const code = token();
    this.codes.set(code, {
      clientId: client.client_id,
      codeChallenge: params.codeChallenge,
      redirectUri: params.redirectUri,
      scopes: params.scopes ?? [],
      state: params.state,
      expiresAt: nowMs() + 10 * 60 * 1000,
    });

    // INTEGRATION (1): in dev, skip login so the full OAuth dance is testable.
    if (this.config.devLicenseKey) {
      this.codes.get(code)!.licenseKey = this.config.devLicenseKey;
      this.redirectWithCode(res, params.redirectUri, code, params.state);
      return;
    }

    // PROD: hand off to Eddyter login. After authenticating the user, Eddyter must
    // mint a signed assertion (see oauth/assertion.ts) and redirect to
    // GET {issuer}/eddyter/callback?mcp_code=<code>&assertion=<jwt>; that route
    // verifies the assertion and calls completeAuthorization() with the bound key.
    const url = new URL(this.config.eddyterLoginUrl);
    url.searchParams.set("mcp_code", code);
    url.searchParams.set("callback", `${this.config.issuer}/eddyter/callback`);
    res.redirect(url.toString());
  }

  /** Called by the /eddyter/callback route once the user's key is resolved. */
  completeAuthorization(
    code: string,
    licenseKey: string,
  ): { redirectUri: string; state?: string } {
    const rec = this.codes.get(code);
    if (!rec) throw new Error("Unknown or expired authorization code");
    rec.licenseKey = licenseKey;
    return { redirectUri: rec.redirectUri, state: rec.state };
  }

  /** Build the redirect back to the OAuth client with code (+ state). */
  redirectWithCode(res: Response, redirectUri: string, code: string, state?: string): void {
    const u = new URL(redirectUri);
    u.searchParams.set("code", code);
    if (state) u.searchParams.set("state", state);
    res.redirect(u.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const rec = this.codes.get(authorizationCode);
    if (!rec) throw new Error("invalid_grant: unknown authorization code");
    return rec.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    const rec = this.codes.get(authorizationCode);
    if (!rec || rec.clientId !== client.client_id) {
      throw new Error("invalid_grant");
    }
    if (rec.expiresAt < nowMs()) {
      this.codes.delete(authorizationCode);
      throw new Error("invalid_grant: authorization code expired");
    }
    if (redirectUri && redirectUri !== rec.redirectUri) {
      throw new Error("invalid_grant: redirect_uri mismatch");
    }
    if (!rec.licenseKey) {
      throw new Error("authorization_pending: login not completed");
    }
    this.codes.delete(authorizationCode);
    return this.issueTokens(client.client_id, rec.scopes, rec.licenseKey);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const rec = this.refreshTokens.get(hash(refreshToken));
    if (!rec || rec.clientId !== client.client_id) {
      throw new Error("invalid_grant");
    }
    return this.issueTokens(client.client_id, scopes ?? rec.scopes, rec.licenseKey);
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const rec = this.accessTokens.get(hash(accessToken));
    if (!rec) throw new Error("invalid_token");
    if (rec.expiresAt < nowMs()) {
      // Expired records are dropped from the file on the next persist().
      this.accessTokens.delete(hash(accessToken));
      throw new Error("invalid_token: expired");
    }
    return {
      token: accessToken,
      clientId: rec.clientId,
      scopes: rec.scopes,
      expiresAt: Math.floor(rec.expiresAt / 1000),
      // Tools read the key from here (see http-oauth.ts).
      extra: { licenseKey: rec.licenseKey },
    };
  }

  private issueTokens(clientId: string, scopes: string[], licenseKey: string): OAuthTokens {
    const access = token();
    const refresh = token();
    this.accessTokens.set(hash(access), {
      clientId,
      scopes,
      licenseKey,
      expiresAt: nowMs() + this.config.accessTtlSeconds * 1000,
    });
    this.refreshTokens.set(hash(refresh), { clientId, scopes, licenseKey });
    this.persist();
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: this.config.accessTtlSeconds,
      refresh_token: refresh,
      scope: scopes.join(" ") || undefined,
    };
  }
}

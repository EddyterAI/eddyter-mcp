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
 *   2. the stores below are in-memory — replace with Redis for multi-instance prod.
 *
 * Identity model: an access token is bound to ONE Eddyter license key, surfaced
 * to tools via AuthInfo.extra.licenseKey (see http-oauth.ts).
 */

import { randomBytes } from "node:crypto";
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

const token = () => randomBytes(32).toString("hex");
const nowMs = () => Date.now();

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

/** In-memory client registry (DCR). INTEGRATION: swap for Redis in prod. */
class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();
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
}

export class EddyterOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();
  private codes = new Map<string, PendingCode>();
  private accessTokens = new Map<string, AccessRec>();
  private refreshTokens = new Map<string, RefreshRec>();

  constructor(private readonly config: EddyterOAuthConfig) {}

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
    const rec = this.refreshTokens.get(refreshToken);
    if (!rec || rec.clientId !== client.client_id) {
      throw new Error("invalid_grant");
    }
    return this.issueTokens(client.client_id, scopes ?? rec.scopes, rec.licenseKey);
  }

  async verifyAccessToken(accessToken: string): Promise<AuthInfo> {
    const rec = this.accessTokens.get(accessToken);
    if (!rec) throw new Error("invalid_token");
    if (rec.expiresAt < nowMs()) {
      this.accessTokens.delete(accessToken);
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
    this.accessTokens.set(access, {
      clientId,
      scopes,
      licenseKey,
      expiresAt: nowMs() + this.config.accessTtlSeconds * 1000,
    });
    this.refreshTokens.set(refresh, { clientId, scopes, licenseKey });
    return {
      access_token: access,
      token_type: "bearer",
      expires_in: this.config.accessTtlSeconds,
      refresh_token: refresh,
      scope: scopes.join(" ") || undefined,
    };
  }
}

/**
 * Eddyter MCP server — REMOTE with OAuth 2.1 (for the Claude connector DIRECTORY).
 *
 * Separate entry point from http.ts (the secret-path custom connector, which stays
 * deployed and unchanged). Reuses the same tools (./tools.ts); the only difference
 * is auth: instead of a license key in the URL path, the key is bound to an OAuth
 * access token and surfaced via req.auth.extra.licenseKey.
 *
 * The SDK's mcpAuthRouter exposes the standard endpoints the directory expects:
 *   /.well-known/oauth-authorization-server, /authorize, /token, /register, /revoke
 *
 * Run:  PORT=8789 MCP_ISSUER_URL=https://mcp.eddyter.com \
 *       OAUTH_DEV_LICENSE_KEY=eddyt_... pnpm start:oauth      (dev shortcut)
 */

import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import { loadConfig } from "./config.js";
import { EddyterClient } from "./client.js";
import { registerEddyterTools } from "./tools.js";
import { EddyterOAuthProvider } from "./oauth/provider.js";
import { verifyAssertion } from "./oauth/assertion.js";

const baseConfig = loadConfig();
const PORT = Number(process.env.PORT ?? 8789);
const ISSUER = process.env.MCP_ISSUER_URL ?? "https://mcp.eddyter.com";

// Shared secret used to verify the login assertion minted by the Eddyter web app.
// Required in prod (the callback fails closed without it); unused when
// OAUTH_DEV_LICENSE_KEY is set, since dev skips the login round-trip entirely.
const CALLBACK_SECRET = process.env.EDDYTER_CALLBACK_SECRET?.trim();

const provider = new EddyterOAuthProvider({
  issuer: ISSUER,
  eddyterLoginUrl:
    process.env.EDDYTER_LOGIN_URL ?? "https://www.eddyter.com/oauth/mcp-login",
  accessTtlSeconds: Number(process.env.OAUTH_ACCESS_TTL ?? 3600),
  devLicenseKey: process.env.OAUTH_DEV_LICENSE_KEY?.trim() || undefined,
});

const app = express();
app.use(express.json());

app.get("/health", (_req, res) =>
  res.json({ ok: true, service: "eddyter-mcp", auth: "oauth" }),
);

// Favicon — this host serves no HTML, so Claude's directory/tool-call icon (fetched
// via Google's favicon service for mcp.eddyter.com) would fall back to a generic
// globe. Redirect to the brand favicon so the connector shows the Eddyter logo.
app.get("/favicon.ico", (_req, res) =>
  res.redirect(301, "https://eddyter.com/favicon.ico"),
);

// OAuth 2.1 endpoints (metadata discovery, DCR, authorize, token, revoke).
app.use(
  mcpAuthRouter({
    provider,
    issuerUrl: new URL(ISSUER),
    scopesSupported: ["eddyter:read", "eddyter:write"],
    resourceName: "Eddyter",
  }),
);

/**
 * Eddyter login callback — completes authorize() once the authenticated user's
 * license key is known.
 *
 * The license key is taken from a signed assertion the Eddyter web app mints AFTER
 * authenticating the user (see oauth/assertion.ts for the contract) — NEVER from a
 * plaintext query param, which any client could forge. We verify the signature,
 * expiry, audience, and that the assertion is bound to *this* mcp_code, then bind
 * the key to the pending authorization.
 */
app.get("/eddyter/callback", (req: Request, res: Response) => {
  const code = String(req.query.mcp_code ?? "");
  const assertion = String(req.query.assertion ?? "");
  if (!code || !assertion) {
    res.status(400).send("Missing mcp_code or assertion");
    return;
  }
  // Fail closed: without the shared secret we cannot prove the assertion, so we
  // must never bind a key. (Dev uses OAUTH_DEV_LICENSE_KEY and never reaches here.)
  if (!CALLBACK_SECRET) {
    // eslint-disable-next-line no-console
    console.error("[eddyter-mcp:oauth] EDDYTER_CALLBACK_SECRET not set — refusing callback");
    res.status(500).send("Login is temporarily unavailable.");
    return;
  }
  try {
    const claims = verifyAssertion(assertion, { secret: CALLBACK_SECRET, audience: ISSUER });
    if (claims.mcp_code !== code) {
      throw new Error("assertion not bound to this mcp_code");
    }
    const { redirectUri, state } = provider.completeAuthorization(code, claims.licenseKey);
    provider.redirectWithCode(res, redirectUri, code, state);
  } catch (e) {
    // Log the specific reason server-side; return a generic message to the browser
    // so we don't hand an attacker a verification oracle.
    // eslint-disable-next-line no-console
    console.error("[eddyter-mcp:oauth] callback rejected:", (e as Error).message);
    res.status(400).send("Could not complete login. Please try again.");
  }
});

// Protected MCP endpoint — bearer token required; key comes from the token.
const bearer = requireBearerAuth({ verifier: provider });

app.post("/mcp", bearer, async (req: Request, res: Response) => {
  const auth = (req as Request & { auth?: AuthInfo }).auth;
  const licenseKey = auth?.extra?.licenseKey as string | undefined;
  if (!licenseKey) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "No license key bound to this token." },
      id: null,
    });
    return;
  }
  try {
    const client = new EddyterClient({ ...baseConfig, defaultLicenseKey: licenseKey });
    const server = new McpServer({ name: "eddyter", version: "0.1.0" });
    registerEddyterTools(server, client, baseConfig.allowWrites);

    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", bearer, (_req, res) => res.status(405).set("Allow", "POST").end());

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[eddyter-mcp:oauth] listening on :${PORT} • issuer=${ISSUER} • ` +
      `login=${provider ? "configured" : "—"} • ` +
      `dev-key=${process.env.OAUTH_DEV_LICENSE_KEY ? "set (login skipped)" : "off"}`,
  );
});

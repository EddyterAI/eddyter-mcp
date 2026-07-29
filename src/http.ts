/**
 * Eddyter MCP server — REMOTE (Streamable HTTP).
 *
 * Mirrors the proven apps/gsc-mcp pattern: a STATELESS server (fresh McpServer +
 * transport per request) guarded by a SECRET PATH. Reuses the exact same tools as
 * the stdio server (./tools.ts) — only the transport and key resolution differ.
 *
 * Multi-tenant from a single deployment: the path segment is the admin's Eddyter
 * license key, so every admin uses a personal connector URL and one server serves
 * all of them — no per-user OAuth, no session store.
 *
 *     Connector URL (add in Claude → Settings → Connectors):
 *     https://mcp.eddyter.com/<eddyt_...>/mcp
 *
 * HARDENING (see DIRECTORY.md): swap the raw key in the path for an opaque,
 * dashboard-minted token mapped to the key server-side (Redis), so the key never
 * appears in URLs/logs. The handler below is the only thing that changes.
 *
 * Deploy: same shape as apps/gsc-mcp — express on $PORT behind nginx + TLS at
 * mcp.eddyter.com.
 */

import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadConfig } from "./config.js";
import { EddyterClient } from "./client.js";
import { registerEddyterTools } from "./tools.js";

const baseConfig = loadConfig();
const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "eddyter-mcp" }));

/**
 * Resolve the caller's license key from the secret path segment.
 * Today the token IS the license key. To harden, look it up in a token→key store
 * here instead and return undefined for unknown tokens.
 */
function resolveKeyFromToken(token: string | undefined): string | undefined {
  if (token && token.startsWith("eddyt_")) return token;
  return undefined;
}

/** Stateless MCP endpoint, guarded by the secret path segment. */
const mcpHandler = async (req: Request, res: Response) => {
  const licenseKey = resolveKeyFromToken(req.params.token);
  // Cheap guard — unknown/implausible tokens get a flat 404 (no backend call,
  // no information leak about whether a path exists).
  if (!licenseKey) {
    res.status(404).end();
    return;
  }

  try {
    // Per-request server + client scoped to this caller's key, then shared tools.
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
};

app.post("/:token/mcp", mcpHandler);
// Stateless: no GET SSE stream (matches apps/gsc-mcp).
app.get("/:token/mcp", (_req, res) => res.status(405).set("Allow", "POST").end());

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(
    `[eddyter-mcp:http] listening on :${PORT} • backend=${baseConfig.baseUrl} • ` +
      `writes=${baseConfig.allowWrites ? "ON" : "off"} • connector URL: /<eddyt_…>/mcp`,
  );
});

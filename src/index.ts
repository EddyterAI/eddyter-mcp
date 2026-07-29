#!/usr/bin/env node
/**
 * Eddyter MCP server — stdio entry point.
 *
 * This is the published `npx eddyter-mcp` / Claude Code plugin binary. It runs on
 * the user's machine and reads the license key from the client config (env). The
 * tools live in ./tools.ts and are shared with the remote HTTP server (./http.ts).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { EddyterClient } from "./client.js";
import { registerEddyterTools } from "./tools.js";

const config = loadConfig();
const client = new EddyterClient(config);

const server = new McpServer({ name: "eddyter", version: "0.1.0" });
registerEddyterTools(server, client, config.allowWrites);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs go to stderr so they never corrupt the stdio JSON-RPC channel.
  console.error(
    `[eddyter-mcp] ready • backend=${config.baseUrl} • ` +
      `default key=${config.defaultLicenseKey ? "set" : "not set"} • ` +
      `writes=${config.allowWrites ? "ON" : "off (read-only)"}`,
  );
}

main().catch((err) => {
  console.error("[eddyter-mcp] fatal:", err);
  process.exit(1);
});

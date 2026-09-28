# Eddyter MCP Server

[![npm version](https://img.shields.io/npm/v/eddyter-mcp?color=cb3837&logo=npm)](https://www.npmjs.com/package/eddyter-mcp)
[![license](https://img.shields.io/npm/l/eddyter-mcp?color=blue)](./LICENSE)
[![MCP](https://img.shields.io/badge/MCP-compatible-8A2BE2)](https://modelcontextprotocol.io)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-d97757)](https://github.com/EddyterAI/eddyter-mcp)

> **Set up and configure the [Eddyter](https://www.eddyter.com) editor by talking to your AI agent** —
> the admin-side surface for Claude, Cursor, and other MCP tools.

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
tools check an Eddyter license key's status and usage, generate SSR-safe
integration code, and **change live editor features by chat** — with no redeploy.

This is the **admin-side** surface: the account owner connects it using a license
key. Changes apply to every end-user of the editor that uses that key, because the
config lives server-side on the key. The dashboard AI assistant ships next.

<!-- TODO(launch): replace with a ≤5s GIF of an agent calling update_config -->
<!-- ![demo](docs/demo.gif) -->

## Tools

Reads are always available. The config-changing tool is **opt-in**
(`EDDYTER_ALLOW_WRITES=true`) so a pasted key can't change the live editor unless
the admin allows it.

| Tool | Mode | What it does |
| --- | --- | --- |
| `verify_status` | read | Is the key valid/active? Plan, expiry, subscription, BYOK, warnings. |
| `get_config` | read | Which editor features are enabled, off-but-allowed, or locked by plan. |
| `get_usage` | read | Credits remaining, usage this period, days until reset. |
| `get_integration_snippet` | read | SSR-safe copy-paste setup code per framework. |
| `update_config` | **write** (opt-in) | Patch the editor's features (e.g. turn AI chat off). Clamped to the plan; live with no redeploy. |

Backend: reads ride the public `/api/license/validate`; `get_usage` and
`update_config` use the X-API-Key endpoints `GET /api/license/usage` and
`POST /api/license/config`.

## Use it in Claude (remote connector — no install)

The hosted server lets you add Eddyter as a **custom connector by URL**, with
sign-in handled by **OAuth** — no npm, no key pasting.

1. **Claude.ai** or **Claude Desktop** → **Settings → Connectors → Add custom connector**
2. URL: `https://mcp.eddyter.com/mcp`
3. Sign in with your Eddyter account when prompted, then approve the license key to connect.
4. The tools above are now available — e.g. ask *"Check my Eddyter license status."*

Each OAuth token is scoped to one Eddyter license key. Reads are always available;
`update_config` is enabled on the hosted server and stays clamped to your plan.

> Prefer to run it locally (npm / Claude Code plugin)? See **Setup** below.

## What this plugin connects to and sends

The plugin contains one remote MCP server and no local code, hooks or scripts.

- **Connects to:** `https://mcp.eddyter.com/mcp` (Eddyter's hosted MCP server), over HTTPS with OAuth 2.0 sign-in.
- **The server then calls:** Eddyter's API at `https://api.eddyter.com` to read your license status, usage and editor configuration, and (for `update_config`) to change that configuration.
- **Data sent:** the tool arguments Claude passes (for example, a feature to turn on or off, or a framework name for a snippet) and your OAuth token. The token is scoped to one Eddyter license key.
- **Not sent:** your documents, conversation history, local files or environment variables.
- **Writes:** only `update_config` changes anything, and every change is clamped to your plan's limits.

Privacy policy: <https://www.eddyter.com/privacy> (summary in [PRIVACY.md](./PRIVACY.md)).

## Setup

```bash
pnpm install
pnpm build
```

Get a license key from the dashboard: <https://www.eddyter.com/user/license-key>
(The MCP never creates keys — humans mint them in the portal)

Cursor and Codex connect to the hosted server over OAuth — no key pasting. The
server is also published to npm, so clients without remote-server support run it
via `npx` — no clone or build needed.

### Claude Code — as a plugin (one step)

```
/plugin marketplace add EddyterAI/eddyter-mcp
/plugin install eddyter@eddyter
```

The plugin connects to the hosted server at `https://mcp.eddyter.com/mcp`. On first
use you sign in with your Eddyter account via OAuth and pick the license key to
connect — no key pasting and no environment variables.

### Claude Code — without the plugin

```bash
claude mcp add eddyter --env EDDYTER_LICENSE_KEY=eddyt_your_key_here -- npx -y eddyter-mcp
```

### Cursor — as a plugin

Install **Eddyter** from [cursor.directory](https://cursor.directory/plugins).
The plugin wires up the hosted server; you sign in via OAuth on first use — no
npm install, no key pasting.

Or add the remote server by hand in `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "eddyter": {
      "type": "http",
      "url": "https://mcp.eddyter.com/mcp"
    }
  }
}
```

### Claude Desktop

`claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "eddyter": {
      "command": "npx",
      "args": ["-y", "eddyter-mcp"],
      "env": { "EDDYTER_LICENSE_KEY": "eddyt_your_key_here" }
    }
  }
}
```

### Codex (OpenAI)

Codex supports remote OAuth MCP servers directly — no npm install, no key pasting:

```bash
codex mcp add eddyter --url https://mcp.eddyter.com/mcp
```

Or add it to `~/.codex/config.toml`:

```toml
[mcp_servers.eddyter]
url = "https://mcp.eddyter.com/mcp"
```

Then ask: *"Check my Eddyter license status."* — you'll be prompted to sign in via OAuth on first use.

Then ask the agent: *"Is my Eddyter key valid?"* or *"What editor features do I
have enabled?"*

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `EDDYTER_LICENSE_KEY` | — | Key the agent acts on. Optional if passed per tool call. |
| `EDDYTER_ENV` | `production` | `production` \| `staging` \| `local`. |
| `EDDYTER_API_BASE_URL` | — | Advanced override of the backend base URL. |
| `EDDYTER_ALLOW_WRITES` | `false` | Set `true` to expose `update_config` (lets the agent change the live editor). |

## Develop & test

```bash
pnpm dev          # tsc --watch
pnpm inspect      # open the MCP Inspector against this server
```

Quick manual smoke test (no real key needed — exercises the live error path):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node dist/index.js
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Sign-in fails / "Could not complete login" | Session likely expired — retry the connect, or sign in at eddyter.com first, then add the connector. |
| "No active license key found" | The signed-in account has no active key. Create one at <https://www.eddyter.com/user/license-key>, then reconnect. |
| Tools don't appear after connecting | Remove and re-add the connector so Claude re-runs the OAuth handshake. |
| `update_config` "does nothing" | The change is clamped to your plan — a feature your plan locks stays off. Run `get_config` to see what your plan allows. |
| Reads work but `get_usage` / `update_config` error | Those hit `api.eddyter.com`; check the key is active and the backend is reachable. |
| Need help | Open an issue: <https://github.com/EddyterAI/eddyter-mcp/issues> |

## Notes

- Logs go to **stderr** — stdout is the JSON-RPC channel and must stay clean.
- Feature labels surfaced by `get_config` live in `src/format.ts`
  (`FEATURE_LABELS`) — tune names/ordering there to match the marketing site.

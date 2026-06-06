# Eddyter MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
tools (Claude Desktop, Cursor, Windsurf, …) inspect and — in later steps —
configure the [Eddyter](https://www.eddyter.com) editor on an admin's behalf.

This is the **admin-side** surface: the account owner connects it to their AI
tool using a license key. Changes made through it apply to every end-user of the
editor that uses that key, with no redeploy (config lives server-side on the key).

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

## Setup

```bash
pnpm install
pnpm build
```

Get a license key from the dashboard: <https://www.eddyter.com/user/license-key>
(The MCP never creates keys — humans mint them in the portal.)

The server is published to npm, so every client below runs it via `npx` — no
clone or build needed.

### Claude Code — as a plugin (one step)

```
/plugin marketplace add EddyterAI/eddyter-mcp
/plugin install eddyter@eddyter
```

Then set your key once in your environment (the plugin reads `${EDDYTER_LICENSE_KEY}`):

```bash
export EDDYTER_LICENSE_KEY=eddyt_your_key_here
# optional, to allow changing live config:
export EDDYTER_ALLOW_WRITES=true
```

### Claude Code — without the plugin

```bash
claude mcp add eddyter --env EDDYTER_LICENSE_KEY=eddyt_your_key_here -- npx -y eddyter-mcp
```

### Claude Desktop / Cursor

`claude_desktop_config.json` (Settings → Developer → Edit Config), or
`.cursor/mcp.json` in your project:

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

## Notes

- Logs go to **stderr** — stdout is the JSON-RPC channel and must stay clean.
- Feature labels surfaced by `get_config` live in `src/format.ts`
  (`FEATURE_LABELS`) — tune names/ordering there to match the marketing site.

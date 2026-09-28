# Eddyter for Claude

Set up and configure the [Eddyter](https://www.eddyter.com) rich text editor by talking to Claude. Check your license status and usage, see which editor features are on, generate SSR-safe integration code for your framework, and change live editor features by chat, with no redeploy.

This is the admin-side surface for Eddyter account owners. Changes apply to every end user of the editor that uses the connected license key, because the editor's configuration lives on the key.

## Tools

| Tool | Mode | What it does |
| --- | --- | --- |
| `verify_status` | read | Whether the key is valid and active: plan, expiry, subscription, warnings. |
| `get_config` | read | Which editor features are enabled, off but allowed, or locked by the plan. |
| `get_usage` | read | Credits remaining, usage this period, days until reset. |
| `get_integration_snippet` | read | Copy-paste setup code for your framework. |
| `update_config` | write | Turn editor features on or off. Every change is clamped to your plan. |

## Getting started

1. Install the plugin.
2. Ask Claude something like *"Check my Eddyter license status."*
3. On first use, sign in with your Eddyter account (OAuth) and choose the license key to connect.

You need an Eddyter account with a license key. Create one at <https://www.eddyter.com/user/license-key>.

## What this plugin connects to and sends

The plugin contains one remote MCP server and no local code, hooks or scripts.

- **Connects to:** `https://mcp.eddyter.com/mcp`, Eddyter's hosted MCP server, over HTTPS with OAuth 2.0 sign-in.
- **The server then calls:** Eddyter's API at `https://api.eddyter.com` to read your license status, usage and editor configuration, and (for `update_config`) to change that configuration.
- **Data sent:** the tool arguments Claude passes (for example, a feature to turn on or off, or a framework name) and your OAuth token. The token is scoped to one Eddyter license key.
- **Not sent:** your documents, conversation history, local files or environment variables.
- **Writes:** only `update_config` changes anything, and every change is clamped to your plan's limits.

- Privacy policy: <https://eddyter.com/privacy-policy>
- Terms of service: <https://eddyter.com/terms>

## Support

Open an issue at <https://github.com/EddyterAI/eddyter-mcp/issues> or visit <https://www.eddyter.com/user/support>.

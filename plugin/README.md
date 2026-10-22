# Eddyter for Claude

[Eddyter](https://www.eddyter.com) is an AI rich text editor you can drop into your web app. This plugin lets you set it up and manage it by talking to Claude, with no dashboards and no redeploys.

## What you can do

- **Add Eddyter to your app.** Claude detects your framework (React, Next.js, Vite or Remix), installs the package, writes the editor component with the correct client-only setup, and adds your license key to the env file.
- **Check your account.** See if your license is active, which plan you're on, when it renews, and how many AI credits you have left.
- **Turn features on or off live.** Switch AI chat, tables, comments, image upload, exports and more on or off. Changes reach every user of your editor instantly, with no redeploy.

## Try asking

- *"Add the Eddyter editor to my Next.js app."*
- *"Is my Eddyter license active? When does it expire?"*
- *"How many AI credits do I have left this month?"*
- *"Which editor features are turned on?"*
- *"Turn off AI chat and tables in my editor."*

## Getting started

1. Install the plugin.
2. Ask Claude one of the questions above.
3. The first time, sign in with your Eddyter account and choose the license key to connect.

You need an Eddyter account with a license key. Create one at <https://www.eddyter.com/user/license-key>.

> **Good to know:** feature changes apply to everyone using the editor on that license key. Claude checks your current setup first and tells you exactly what will change. Features your plan doesn't include stay locked, and Claude will tell you when an upgrade is needed.

## What's inside

**Skills** (step-by-step guides Claude follows)

| Skill | Use it to |
| --- | --- |
| `setup-eddyter` | Add Eddyter to a React, Next.js, Vite or Remix project. |
| `manage-eddyter` | Check your license, plan and credits, and turn editor features on or off. |

**Tools** (from the Eddyter connector)

| Tool | Mode | What it does |
| --- | --- | --- |
| `verify_status` | read | Whether the key is valid and active: plan, expiry, subscription, warnings. |
| `get_config` | read | Which editor features are on, off, or locked by your plan. |
| `get_usage` | read | Credits remaining, usage this period, days until reset. |
| `get_integration_snippet` | read | Official setup code for your framework. |
| `update_config` | write | Turn editor features on or off. Every change is limited to what your plan allows. |

## What this plugin connects to and sends

The plugin contains one remote MCP server and two skills (plain-text instructions for Claude). It has no local code, hooks or scripts.

- **Connects to:** `https://mcp.eddyter.com/mcp`, Eddyter's hosted MCP server, over HTTPS with OAuth 2.0 sign-in.
- **The server then calls:** Eddyter's API at `https://api.eddyter.com` to read your license status, usage and editor configuration, and (for `update_config`) to change that configuration.
- **Data sent:** the tool arguments Claude passes (for example, a feature to turn on or off, or a framework name) and your OAuth token. The token is scoped to one Eddyter license key.
- **Not sent:** your documents, conversation history, local files or environment variables.
- **Writes:** only `update_config` changes anything, and every change is clamped to your plan's limits.

- Privacy policy: <https://eddyter.com/privacy-policy>
- Terms of service: <https://eddyter.com/terms>

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Sign-in fails | Your session may have expired. Sign in at eddyter.com, then try connecting again. |
| "No active license key found" | Your account has no active key. Create one at <https://www.eddyter.com/user/license-key>, then reconnect. |
| Eddyter tools don't appear | Remove and re-add the Eddyter connector so sign-in runs again. |
| A feature won't turn on | Your plan doesn't include it. Ask Claude which features your plan allows. |

## Support

- Docs: <https://eddyter.com/docs>
- Help: <https://www.eddyter.com/user/support>
- Bugs and requests: <https://github.com/EddyterAI/eddyter-mcp/issues>

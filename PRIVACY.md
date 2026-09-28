# Privacy Policy — Eddyter MCP Server

_Last updated: 2026-06-07_

The Eddyter MCP server ("the connector") lets an AI tool you control
(Claude, Cursor, etc.) read and configure your [Eddyter](https://www.eddyter.com)
editor on your behalf. This policy explains what it does and does not do with your
data.

## What the connector accesses

To do its job, the connector sends your **Eddyter license key** (the `eddyt_…`
value you provide) to the Eddyter API at `https://api.eddyter.com` over HTTPS, in
order to:

- verify the key's status, plan, and expiry (`verify_status`);
- read the editor feature configuration tied to that key (`get_config`);
- read AI usage and credit totals for the key's account (`get_usage`);
- generate integration code locally — no network call (`get_integration_snippet`);
- change the key's editor feature configuration, **only when you have explicitly
  enabled writes** (`update_config`).

## What it does NOT do

- It does **not** store, log, or transmit your license key anywhere other than to
  the Eddyter API to fulfill the request you made.
- It does **not** access, read, or transmit your own third-party AI provider keys
  (OpenAI, Anthropic, etc.). Those "bring your own key" secrets are never exposed
  to the connector.
- It does **not** collect analytics, telemetry, or personal data.
- It does **not** read your files, environment, or anything beyond the license key
  you provide to it.

## Where your data goes

Your license key and the requests above are processed by Eddyter's backend
(`api.eddyter.com`). Data handling there is governed by Eddyter's main privacy
policy: <https://eddyter.com/privacy-policy>.

## Your control

- The connector only acts when you (or your AI tool, on your instruction) call a
  tool. It performs no background activity.
- Configuration changes (`update_config`) are **off by default** and require you
  to explicitly opt in (`EDDYTER_ALLOW_WRITES=true`).
- You can remove the connector at any time; it retains no local state.

## Contact

Questions: <support@eddyter.com> · <https://www.eddyter.com>

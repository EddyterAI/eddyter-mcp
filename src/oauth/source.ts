/**
 * Which app started a sign-in, for signup attribution on eddyter.com.
 *
 * Sent as `source` on the /oauth/mcp-login redirect; the website stores it once,
 * when the account is created (profiles.signup_source). Analytics only — it never
 * affects access. The backend ignores values outside its own list, so add any new
 * value there first.
 *
 * Name rules run before address rules: Claude Code and Cursor return to localhost
 * or custom schemes, so only their registered client_name identifies them.
 */

export type SignupSource = "claude" | "claude_code" | "chatgpt" | "cursor" | "mcp_other";

const onHost = (hostname: string, hosts: string[]) =>
  hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));

export function detectSignupSource(
  clientName: string | undefined,
  redirectUri: string,
): SignupSource {
  const name = (clientName ?? "").toLowerCase();
  if (name.includes("claude code")) return "claude_code";
  if (name.includes("cursor")) return "cursor";

  let hostname: string;
  try {
    hostname = new URL(redirectUri).hostname.toLowerCase();
  } catch {
    return "mcp_other";
  }
  if (onHost(hostname, ["claude.ai", "claude.com"])) return "claude";
  if (onHost(hostname, ["chatgpt.com", "openai.com"])) return "chatgpt";
  return "mcp_other";
}

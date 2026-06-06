/**
 * Resolves which Eddyter backend to talk to and the license key the agent
 * acts on behalf of.
 *
 * Base URLs mirror apps/editor/src/config/env.ts so the MCP and the editor
 * always agree on which environment a key belongs to.
 */

const ENV_BASE_URLS: Record<string, string> = {
  production: "https://api.eddyter.com",
  staging: "https://api.cteditor.com",
  local: "http://localhost:3000",
};

export interface EddyterConfig {
  baseUrl: string;
  /** Default license key from the client config, if the admin set one. */
  defaultLicenseKey?: string;
  /**
   * Whether config-changing tools (update_config) are exposed. Off by default —
   * reads are always available; the admin must opt in to let the agent change
   * the live editor. Set EDDYTER_ALLOW_WRITES=true to enable.
   */
  allowWrites: boolean;
}

function parseBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function loadConfig(): EddyterConfig {
  const explicitBase = process.env.EDDYTER_API_BASE_URL?.trim();
  const envName = (process.env.EDDYTER_ENV?.trim() || "production").toLowerCase();

  const baseUrl =
    explicitBase || ENV_BASE_URLS[envName] || ENV_BASE_URLS.production;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    defaultLicenseKey: process.env.EDDYTER_LICENSE_KEY?.trim() || undefined,
    allowWrites: parseBool(process.env.EDDYTER_ALLOW_WRITES),
  };
}

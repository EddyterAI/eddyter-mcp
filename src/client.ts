/**
 * Thin client over the Eddyter backend.
 *
 * Step 1 only needs the public, X-API-Key-authenticated validation endpoint —
 * the same one the editor itself calls on mount. No new backend surface.
 */

import type { EddyterConfig } from "./config.js";

/** Subset of the /api/license/validate response we rely on. */
export interface ValidateResponse {
  success: boolean;
  message?: string;
  code?: string;
  data?: {
    isValid: boolean;
    expiresAt: string;
    status: string;
    paidPlan: boolean;
    planName: string;
    isFreePlan: boolean;
    /** The key's current feature config (what's on right now). */
    customizations: Record<string, unknown> | null;
    /** The plan's allowed feature set — the ceiling of what CAN be enabled. */
    planCustomizations: Record<string, unknown> | null;
    isLiveApi: boolean;
    apiDomain: string;
    subscriptionStatus: string;
    hideBranding: boolean;
    warning?: {
      type: string;
      message: string;
      daysRemaining: number;
    } | null;
    isByokPlan?: boolean;
    byokApiKeys?: Record<string, boolean>;
    featureMinimumPlanNames?: Record<string, string>;
  };
}

export class EddyterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "EddyterError";
  }
}

export class EddyterClient {
  constructor(private readonly config: EddyterConfig) {}

  /**
   * Resolve the license key for a tool call: explicit arg wins, otherwise the
   * one configured in the MCP client. Throws a clear, actionable error if neither.
   */
  resolveLicenseKey(explicit?: string): string {
    const key = explicit?.trim() || this.config.defaultLicenseKey;
    if (!key) {
      throw new EddyterError(
        "No Eddyter license key provided. Set EDDYTER_LICENSE_KEY in your MCP client " +
          "config, or pass `licenseKey` to the tool. Create a key at " +
          "https://www.eddyter.com/user/license-key",
      );
    }
    return key;
  }

  /** Authenticated request helper: attaches X-API-Key and unwraps {success,data}. */
  private async request<T>(
    method: string,
    path: string,
    licenseKey: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": licenseKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new EddyterError(
        `Could not reach Eddyter at ${url}: ${(err as Error).message}`,
      );
    }

    let parsed:
      | { success?: boolean; message?: string; code?: string; data?: T }
      | undefined;
    try {
      parsed = (await res.json()) as typeof parsed;
    } catch {
      // fall through to status-based error
    }

    if (!res.ok || !parsed?.success) {
      throw new EddyterError(
        parsed?.message || `Request to ${path} failed (HTTP ${res.status})`,
        res.status,
        parsed?.code,
      );
    }

    return parsed.data as T;
  }

  /** Calls POST /api/license/validate with the key in the X-API-Key header. */
  async validate(licenseKey: string): Promise<ValidateResponse> {
    const url = `${this.config.baseUrl}/api/license/validate`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": licenseKey,
        },
        body: "{}",
      });
    } catch (err) {
      throw new EddyterError(
        `Could not reach Eddyter at ${url}: ${(err as Error).message}`,
      );
    }

    let body: ValidateResponse | undefined;
    try {
      body = (await res.json()) as ValidateResponse;
    } catch {
      // fall through to status-based error below
    }

    if (!res.ok || !body?.success) {
      throw new EddyterError(
        body?.message || `License validation failed (HTTP ${res.status})`,
        res.status,
        body?.code,
      );
    }

    return body;
  }

  /** GET /api/license/usage — credits, current-period usage, plan summary. */
  async getUsage(licenseKey: string): Promise<UsageSummary> {
    return this.request<UsageSummary>("GET", "/api/license/usage", licenseKey);
  }

  /**
   * POST /api/license/config — patch this key's editor config (clamped to plan).
   * Returns the new effective config plus the plan ceiling.
   */
  async updateConfig(
    licenseKey: string,
    partialCustomizations: Record<string, unknown>,
  ): Promise<{
    customizations: Record<string, unknown>;
    planCustomizations: Record<string, unknown> | null;
  }> {
    return this.request("POST", "/api/license/config", licenseKey, {
      customizations: partialCustomizations,
    });
  }
}

/** Subset of the /api/license/usage (AiUsageSummary) response we surface. */
export interface UsageSummary {
  planName: string;
  isFreePlan: boolean;
  isByokPlan: boolean;
  isTrial: boolean;
  credits: {
    remaining: number;
    planTotal: number;
    purchasedCredits: number;
  };
  currentPeriod: {
    creditsUsed: number;
    textOperations: number;
    imagesGenerated: number;
  };
  daysUntilReset: number;
  resetDate: string | null;
}

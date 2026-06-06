#!/usr/bin/env node
/**
 * Eddyter MCP server (step 1 — read-only).
 *
 * Exposes the admin's editor setup over the Model Context Protocol so AI tools
 * (Claude Desktop, Cursor, …) can inspect a license key's status and feature
 * config. Write tools (update_config) and usage land in later steps once the
 * shared, plan-ceiling-guarded backend service is in place.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { EddyterClient, EddyterError } from "./client.js";
import { renderFeatureSummary, summarizeFeatures } from "./format.js";
import {
  getIntegrationSnippet,
  renderSnippet,
  type Framework,
} from "./snippets.js";

const config = loadConfig();
const client = new EddyterClient(config);

const server = new McpServer({
  name: "eddyter",
  version: "0.1.0",
});

const licenseKeyArg = {
  licenseKey: z
    .string()
    .optional()
    .describe(
      "Eddyter license key (eddyt_…). Optional if EDDYTER_LICENSE_KEY is set in the client config.",
    ),
};

/** Wrap tool handlers so EddyterError becomes a clean, non-fatal tool error. */
function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

server.registerTool(
  "verify_status",
  {
    title: "Verify License Status",
    description:
      "Check whether an Eddyter license key is valid and active: plan name, paid/free, " +
      "expiry, subscription status, BYOK mode, and any payment warning. Use this first " +
      "to confirm the key works before configuring anything.",
    inputSchema: licenseKeyArg,
    annotations: { title: "Verify License Status", readOnlyHint: true, openWorldHint: true },
  },
  async ({ licenseKey }) => {
    try {
      const key = client.resolveLicenseKey(licenseKey);
      const { data } = await client.validate(key);
      if (!data) return errorResult("No data returned from Eddyter.");

      const expires = new Date(data.expiresAt);
      const daysLeft = Math.ceil(
        (expires.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );

      const lines = [
        `Status: ${data.isValid ? "✅ valid" : "❌ invalid"} (${data.status})`,
        `Plan: ${data.planName}${data.isFreePlan ? " (free)" : ""} — ${data.paidPlan ? "paid" : "unpaid"}`,
        `Subscription: ${data.subscriptionStatus}`,
        `Expires: ${data.expiresAt} (${daysLeft} day(s) left)`,
        `BYOK mode: ${data.isByokPlan ? "on (uses your own AI provider keys)" : "off (managed credits)"}`,
        `Live API: ${data.isLiveApi ? "yes" : "no"} • domain: ${data.apiDomain}`,
      ];
      if (data.warning) {
        lines.push(`⚠️  ${data.warning.message} (${data.warning.daysRemaining} day(s))`);
      }
      return textResult(lines.join("\n"));
    } catch (err) {
      if (err instanceof EddyterError) return errorResult(err.message);
      throw err;
    }
  },
);

server.registerTool(
  "get_config",
  {
    title: "Get Editor Config",
    description:
      "Show the editor feature configuration for a license key: which features are " +
      "enabled, which are off but allowed by the plan, and which are locked behind a " +
      "higher plan. Use before changing config so you know what's available.",
    inputSchema: licenseKeyArg,
    annotations: { title: "Get Editor Config", readOnlyHint: true, openWorldHint: true },
  },
  async ({ licenseKey }) => {
    try {
      const key = client.resolveLicenseKey(licenseKey);
      const { data } = await client.validate(key);
      if (!data) return errorResult("No data returned from Eddyter.");

      const summaries = summarizeFeatures(
        data.customizations,
        data.planCustomizations,
      );
      const header = `Editor config for "${data.planName}" plan key:\n`;
      return textResult(header + "\n" + renderFeatureSummary(summaries));
    } catch (err) {
      if (err instanceof EddyterError) return errorResult(err.message);
      throw err;
    }
  },
);

server.registerTool(
  "get_usage",
  {
    title: "Get Usage & Credits",
    description:
      "Show the license key owner's AI usage and credits: plan, credits remaining, " +
      "credits used this period, operation counts, and days until reset. Use to answer " +
      "'am I about to hit my limit?'.",
    inputSchema: licenseKeyArg,
    annotations: { title: "Get Usage & Credits", readOnlyHint: true, openWorldHint: true },
  },
  async ({ licenseKey }) => {
    try {
      const key = client.resolveLicenseKey(licenseKey);
      const u = await client.getUsage(key);
      const lines = [
        `Plan: ${u.planName}${u.isFreePlan ? " (free)" : ""}${u.isTrial ? " (trial)" : ""}`,
        `BYOK mode: ${u.isByokPlan ? "on — uses your own provider keys (credits not consumed)" : "off — managed credits"}`,
        `Credits remaining: ${u.credits.remaining} (plan ${u.credits.planTotal} + purchased ${u.credits.purchasedCredits})`,
        `Used this period: ${u.currentPeriod.creditsUsed} credits ` +
          `(${u.currentPeriod.textOperations} text ops, ${u.currentPeriod.imagesGenerated} images)`,
        `Resets in: ${u.daysUntilReset} day(s)${u.resetDate ? ` (${u.resetDate})` : ""}`,
      ];
      return textResult(lines.join("\n"));
    } catch (err) {
      if (err instanceof EddyterError) return errorResult(err.message);
      throw err;
    }
  },
);

server.registerTool(
  "get_integration_snippet",
  {
    title: "Get Integration Snippet",
    description:
      "Return ready-to-paste, SSR-safe code to add the Eddyter editor to an app. " +
      "Picks the correct client-only boundary per framework (the editor is a DOM-only " +
      "React component). Use when setting Eddyter up in a project.",
    inputSchema: {
      framework: z
        .enum(["react", "nextjs-app", "nextjs-pages", "vite", "remix"])
        .describe("Target framework. Use 'nextjs-app' for App Router, 'nextjs-pages' for Pages Router."),
    },
    // Pure/static — no network, no mutation.
    annotations: { title: "Get Integration Snippet", readOnlyHint: true, openWorldHint: false },
  },
  async ({ framework }) => {
    const snippet = getIntegrationSnippet(framework as Framework);
    return textResult(renderSnippet(snippet));
  },
);

// --- Write tools: only registered when the admin opts in (EDDYTER_ALLOW_WRITES) ---
if (config.allowWrites) {
  server.registerTool(
    "update_config",
    {
      title: "Update Editor Config (live)",
      description:
        "Change the editor's feature configuration for a license key (e.g. turn AI chat " +
        "or tables off/on). Send only the features you want to change — a partial patch. " +
        "Changes are clamped to the plan (cannot enable locked features) and go live for " +
        "all users of the key with no redeploy. Call get_config first to see current state.",
      inputSchema: {
        ...licenseKeyArg,
        customizations: z
          .record(z.any())
          .describe(
            "Partial EditorConfigTypes patch. Feature toggles live under `toolbarOptions`, " +
              'e.g. { "toolbarOptions": { "enableAIChat": false, "enableTableOptions": false } }. ' +
              "Only the keys you include change; everything else is preserved.",
          ),
      },
      // Mutates LIVE editor behavior for every user of the key — flag it so clients
      // can prompt for confirmation before the agent applies it.
      annotations: {
        title: "Update Editor Config (live)",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ licenseKey, customizations }) => {
      try {
        const key = client.resolveLicenseKey(licenseKey);
        const result = await client.updateConfig(
          key,
          customizations as Record<string, unknown>,
        );
        const summaries = summarizeFeatures(
          result.customizations,
          result.planCustomizations,
        );
        return textResult(
          "✅ Config updated (live now, no redeploy needed).\n\n" +
            renderFeatureSummary(summaries),
        );
      } catch (err) {
        if (err instanceof EddyterError) return errorResult(err.message);
        throw err;
      }
    },
  );
}

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

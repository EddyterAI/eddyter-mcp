/**
 * Turns the raw `customizations` / `planCustomizations` payloads into something
 * an AI agent (and the admin reading its reply) can reason about:
 *
 *   - enabled:  feature is ON for this key
 *   - disabled: feature is OFF, but the plan allows turning it on
 *   - locked:   the plan does not permit this feature (upsell, not a toggle)
 *
 * The classification logic is generic. The ONE thing worth tuning by hand is
 * FEATURE_LABELS below: human-friendly names + which toggles are "primary"
 * (surfaced first) vs. advanced. That's a product/UX call — see note at bottom.
 */

export type FeatureState = "enabled" | "disabled" | "locked";

export interface FeatureSummary {
  key: string;
  label: string;
  state: FeatureState;
}

/**
 * Human-facing labels for the toolbarOptions toggles in EditorConfigTypes.
 * Keys not listed here still get reported, just with a derived label.
 *
 * 👉 TUNE ME: order ~= importance; trim/rename to match how you describe
 * features on the marketing site and dashboard.
 */
const FEATURE_LABELS: Record<string, string> = {
  enableAIChat: "AI Chat",
  enableTextFormatting: "Text formatting (bold / italic / underline)",
  enableTableOptions: "Tables",
  enableImageUpload: "Image upload",
  enableComments: "Comments",
  enableMentions: "@mentions",
  enableCharts: "Charts",
  enableEmbeds: "Embeds (YouTube, Loom, …)",
  enablePdfExport: "PDF export",
  enableDocExport: "DOC export",
  enableSpeechToText: "Speech to text",
  enableHeadings: "Headings",
  enableLists: "Lists",
  enableColors: "Text & background colors",
  enableNotePanels: "Callout / note panels",
  enableTodoList: "To-do lists",
  enableFormatPainter: "Format painter",
};

function deriveLabel(key: string): string {
  if (FEATURE_LABELS[key]) return FEATURE_LABELS[key];
  // enableFooBar -> "Foo bar"
  const stripped = key.replace(/^enable/, "");
  const spaced = stripped.replace(/([A-Z])/g, " $1").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function asBoolMap(obj: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

/**
 * Classify each toolbar feature given the key's current config and the plan ceiling.
 * A feature is `locked` when the plan explicitly disallows it (ceiling === false).
 */
export function summarizeFeatures(
  customizations: Record<string, unknown> | null,
  planCustomizations: Record<string, unknown> | null,
): FeatureSummary[] {
  const current = asBoolMap(
    (customizations as Record<string, unknown> | null)?.toolbarOptions,
  );
  const ceiling = asBoolMap(
    (planCustomizations as Record<string, unknown> | null)?.toolbarOptions,
  );

  const allKeys = new Set([...Object.keys(current), ...Object.keys(ceiling)]);

  const summaries: FeatureSummary[] = [];
  for (const key of allKeys) {
    const allowedByPlan = ceiling[key] !== false; // absent or true => allowed
    const onNow = current[key] === true;

    let state: FeatureState;
    if (!allowedByPlan) state = "locked";
    else if (onNow) state = "enabled";
    else state = "disabled";

    summaries.push({ key, label: deriveLabel(key), state });
  }

  // Primary features (those we have explicit labels for) first, in declared order.
  const order = Object.keys(FEATURE_LABELS);
  summaries.sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.label.localeCompare(b.label);
  });

  return summaries;
}

/** Compact, agent-readable text rendering of the feature summary. */
export function renderFeatureSummary(summaries: FeatureSummary[]): string {
  const group = (state: FeatureState) =>
    summaries
      .filter((s) => s.state === state)
      .map((s) => `  • ${s.label}`)
      .join("\n") || "  (none)";

  return [
    "Enabled:",
    group("enabled"),
    "",
    "Disabled (plan allows turning on):",
    group("disabled"),
    "",
    "Locked by plan (upgrade to unlock):",
    group("locked"),
  ].join("\n");
}

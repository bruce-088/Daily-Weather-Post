import { FeatureFlags } from "@/lib/featureFlags";

export type ExecutionMode = "pipeline" | "legacy" | null | undefined;
export type RenderEngine =
  | "creatomate"
  | "gemini_fallback"
  | "gemini"
  | "static_fallback"
  | "fallback_template"
  | string
  | null
  | undefined;

export interface DebugLabelsProps {
  mode?: ExecutionMode;
  abVariant?: "A" | "B" | string | null;
  renderEngine?: RenderEngine;
  voiceOn?: boolean | null;
  healthScore?: number | null;
  /** Visual density */
  size?: "sm" | "xs";
  /** Optional className passthrough */
  className?: string;
}

const PILL = "inline-flex items-center gap-1 rounded-full border font-medium uppercase tracking-wide";

function pillSize(size: "sm" | "xs") {
  return size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";
}

function modeStyle(mode: ExecutionMode) {
  if (mode === "pipeline") {
    return { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "SOURCE: PIPELINE ✅" };
  }
  if (mode === "legacy") {
    return { cls: "bg-amber-500/15 text-amber-500 border-amber-500/30", label: "SOURCE: LEGACY ⚠️" };
  }
  return null;
}

function prettyEngine(engine: RenderEngine): string | null {
  if (!engine) return null;
  switch (engine) {
    case "creatomate":
      return "Creatomate";
    case "gemini":
    case "gemini_fallback":
      return "Gemini";
    case "static_fallback":
    case "fallback_template":
      return "Static";
    default:
      return String(engine);
  }
}

/**
 * Compact debug pill row. Renders nothing when SHOW_DEBUG_LABELS is off
 * or no metadata is provided. Intended for the Review modal + history rows.
 */
export function DebugLabels({
  mode,
  abVariant,
  renderEngine,
  voiceOn,
  healthScore,
  size = "xs",
  className = "",
}: DebugLabelsProps) {
  if (!FeatureFlags.SHOW_DEBUG_LABELS) return null;

  const m = modeStyle(mode);
  const engineLabel = prettyEngine(renderEngine);
  const sz = pillSize(size);

  const items: React.ReactNode[] = [];

  if (m) {
    items.push(
      <span key="mode" className={`${PILL} ${sz} ${m.cls}`} title="Execution mode">
        {m.label}
      </span>,
    );
  }

  if (abVariant) {
    items.push(
      <span
        key="ab"
        className={`${PILL} ${sz} bg-sky-500/15 text-sky-400 border-sky-500/30`}
        title="A/B test variant"
      >
        🧪 Variant {abVariant}
      </span>,
    );
  }

  if (engineLabel) {
    items.push(
      <span
        key="engine"
        className={`${PILL} ${sz} bg-violet-500/15 text-violet-400 border-violet-500/30`}
        title="Render engine"
      >
        {engineLabel}
      </span>,
    );
  }

  if (typeof voiceOn === "boolean") {
    items.push(
      <span
        key="voice"
        className={`${PILL} ${sz} ${
          voiceOn
            ? "bg-emerald-500/10 text-emerald-400/90 border-emerald-500/20"
            : "bg-muted text-muted-foreground border-border"
        }`}
        title="Voiceover"
      >
        Voice: {voiceOn ? "On" : "Off"}
      </span>,
    );
  }

  if (typeof healthScore === "number") {
    const tone =
      healthScore >= 80
        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
        : healthScore >= 60
        ? "bg-sky-500/15 text-sky-400 border-sky-500/30"
        : "bg-red-500/15 text-red-400 border-red-500/30";
    items.push(
      <span key="health" className={`${PILL} ${sz} ${tone}`} title="Post Health Score">
        Health: {healthScore}
      </span>,
    );
  }

  if (items.length === 0) return null;

  return <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>{items}</div>;
}

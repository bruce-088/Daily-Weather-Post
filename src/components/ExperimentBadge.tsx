/**
 * Compact badge for A/B variants and experiment status.
 * Visually consistent with DebugLabels pill styling.
 */

export type BadgeKind = "A" | "B" | "winner" | "testing" | "inconclusive";

const PILL = "inline-flex items-center gap-1 rounded-full border font-medium uppercase tracking-wide px-2 py-0.5 text-[10px]";

const STYLES: Record<BadgeKind, { cls: string; label: string }> = {
  A: { cls: "bg-sky-500/15 text-sky-400 border-sky-500/30", label: "A 🧪" },
  B: { cls: "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30", label: "B 🧪" },
  winner: { cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40", label: "Winner 🏆" },
  testing: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "Testing…" },
  inconclusive: { cls: "bg-muted text-muted-foreground border-border", label: "Inconclusive" },
};

export function ExperimentBadge({ kind, className = "" }: { kind: BadgeKind; className?: string }) {
  const s = STYLES[kind];
  return <span className={`${PILL} ${s.cls} ${className}`}>{s.label}</span>;
}

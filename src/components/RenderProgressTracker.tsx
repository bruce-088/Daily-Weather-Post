import { Check, Loader2, Radio, Mic, Film, Rocket, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PreviewJobStage } from "@/lib/api";

interface Props {
  stage: PreviewJobStage | null;
  cityName?: string | null;
  voiceEnabled?: boolean;
  error?: string | null;
}

const STEPS = [
  { id: "fetching_weather", icon: Radio, label: (city?: string | null) => `Fetching ${city || "weather"} data…`, done: "Weather data ready" },
  { id: "generating_hooks", icon: Mic, label: () => "Synthesizing voiceover…", done: "Voiceover synthesized" },
  { id: "rendering_video", icon: Film, label: () => "Composing cinematic render…", done: "Render composed" },
  { id: "ready", icon: Rocket, label: () => "Ready for broadcast!", done: "Ready for broadcast!" },
] as const;

export function RenderProgressTracker({ stage, cityName, voiceEnabled = true, error }: Props) {
  const failed = stage === "failed";
  const activeIdx = failed ? -1 : Math.max(0, STEPS.findIndex((s) => s.id === (stage ?? "fetching_weather")));

  return (
    <div className="rounded-xl border border-border/40 bg-gradient-to-b from-background/60 to-secondary/30 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
          Producer View
        </span>
        <span className="text-[10px] font-mono text-muted-foreground/70">
          STEP {Math.min(activeIdx + 1, STEPS.length)}/{STEPS.length}
        </span>
      </div>

      <ul className="space-y-2">
        {STEPS.map((s, i) => {
          const isActive = !failed && i === activeIdx;
          const isDone = !failed && i < activeIdx;
          const isPending = failed || i > activeIdx;
          const Icon = s.icon;
          const skipped = !voiceEnabled && s.id === "generating_hooks";
          return (
            <li
              key={s.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2 transition-all",
                isActive && "border-primary/50 bg-primary/5 shadow-[0_0_20px_-8px_hsl(var(--primary))]",
                isDone && "border-emerald-500/30 bg-emerald-500/5",
                isPending && "border-border/30 bg-transparent",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border shrink-0",
                  isActive && "border-primary text-primary bg-primary/10",
                  isDone && "border-emerald-500/40 text-emerald-500 bg-emerald-500/10",
                  isPending && "border-border/40 text-muted-foreground/60",
                )}
              >
                {isActive ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : isDone ? (
                  <Check size={14} />
                ) : (
                  <Icon size={13} />
                )}
              </span>
              <span
                className={cn(
                  "text-sm flex-1 relative overflow-hidden",
                  isActive && "text-foreground font-medium shimmer-text",
                  isDone && "text-foreground/80",
                  isPending && "text-muted-foreground/60",
                  skipped && "line-through opacity-50",
                )}
              >
                {isDone ? s.done : s.label(cityName)}
              </span>
              {s.id === "rendering_video" && isActive && (
                <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
                  ~45–90s
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {failed && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          <X size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{error || "Render failed"}</span>
        </div>
      )}
    </div>
  );
}

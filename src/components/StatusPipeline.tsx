import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type PipelineStage = "pending" | "scheduled" | "processing" | "posted" | "failed" | "cancelled";

const STAGES: { key: Exclude<PipelineStage, "failed" | "cancelled">; label: string; tone: string }[] = [
  { key: "pending", label: "Pending", tone: "bg-muted-foreground/40" },
  { key: "scheduled", label: "Scheduled", tone: "bg-blue-500" },
  { key: "processing", label: "Processing", tone: "bg-amber-500" },
  { key: "posted", label: "Posted", tone: "bg-green-500" },
];

/**
 * Maps the raw DB status string into a derived pipeline stage.
 * - "pending" stays pending until ~2min before scheduled time, then "scheduled".
 * - On the day it would run (within 5 min of scheduled_at) it shows "processing".
 * - Terminal: posted / failed / cancelled.
 */
export function deriveStage(status: string, scheduledAt: string): PipelineStage {
  if (status === "posted") return "posted";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";

  const diffMs = new Date(scheduledAt).getTime() - Date.now();
  if (diffMs <= 5 * 60_000 && diffMs > -10 * 60_000) return "processing";
  if (diffMs <= 60 * 60_000) return "scheduled";
  return "pending";
}

interface Props {
  stage: PipelineStage;
  className?: string;
}

export function StatusPipeline({ stage, className }: Props) {
  if (stage === "failed") {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
        <span className="text-[11px] font-medium text-destructive">Failed</span>
      </div>
    );
  }
  if (stage === "cancelled") {
    return (
      <div className={cn("flex items-center gap-1.5", className)}>
        <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
        <span className="text-[11px] font-medium text-muted-foreground">Cancelled</span>
      </div>
    );
  }

  const activeIndex = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {STAGES.map((s, idx) => {
        const reached = idx <= activeIndex;
        const isCurrent = idx === activeIndex;
        return (
          <div key={s.key} className="flex items-center gap-1">
            <div
              className={cn(
                "flex items-center justify-center rounded-full transition-all",
                reached ? s.tone : "bg-muted",
                isCurrent ? "h-3 w-3 ring-2 ring-offset-1 ring-offset-background ring-current/30" : "h-2 w-2",
                isCurrent && stage === "processing" && "animate-pulse",
              )}
            >
              {reached && idx < activeIndex && s.key === "posted" && <Check size={8} className="text-white" />}
            </div>
            {idx < STAGES.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-3 transition-colors",
                  idx < activeIndex ? STAGES[idx + 1].tone : "bg-muted",
                )}
              />
            )}
          </div>
        );
      })}
      <span className="ml-1.5 text-[11px] font-medium text-muted-foreground capitalize">
        {STAGES[Math.max(0, activeIndex)].label}
      </span>
    </div>
  );
}

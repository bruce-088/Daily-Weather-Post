import { Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PreviewStage =
  | "fetching_weather"
  | "generating_hooks"
  | "rendering_video"
  | "ready"
  | "failed";

const ORDER: { id: Exclude<PreviewStage, "failed">; label: string }[] = [
  { id: "fetching_weather", label: "Fetching weather" },
  { id: "generating_hooks", label: "Generating hooks" },
  { id: "rendering_video", label: "Rendering video" },
  { id: "ready", label: "Ready" },
];

interface Props {
  stage: PreviewStage | null;
  error?: string | null;
  source?: "pipeline" | "legacy" | null;
}

export function PreviewPipelineStatus({ stage, error, source = "pipeline" }: Props) {
  if (!stage) return null;
  const failed = stage === "failed";
  const activeIdx = failed ? -1 : ORDER.findIndex((s) => s.id === stage);

  return (
    <div className="border-t border-border/40 bg-muted/30 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
        <div className="flex items-center gap-1.5 flex-wrap">
          {ORDER.map((s, i) => {
            const isActive = i === activeIdx;
            const isDone = !failed && i < activeIdx;
            const isPending = !failed && i > activeIdx;
            return (
              <div key={s.id} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
                    isActive && "border-primary text-primary bg-primary/10",
                    isDone && "border-emerald-500/40 text-emerald-500 bg-emerald-500/5",
                    isPending && "border-border/40 text-muted-foreground/60",
                  )}
                >
                  {isActive && <Loader2 className="h-3 w-3 animate-spin" />}
                  {isDone && <Check className="h-3 w-3" />}
                  {isPending && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-50" />}
                  {s.label}
                </span>
                {i < ORDER.length - 1 && (
                  <span className="text-muted-foreground/30">›</span>
                )}
              </div>
            );
          })}
          {failed && (
            <span className="inline-flex items-center gap-1 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-destructive">
              <X className="h-3 w-3" /> Failed
            </span>
          )}
        </div>
        {source && (
          <span className="text-muted-foreground/70 shrink-0">
            SOURCE:{" "}
            <span className={source === "pipeline" ? "text-emerald-500" : "text-amber-500"}>
              {source === "pipeline" ? "PIPELINE ✅" : "LEGACY"}
            </span>
          </span>
        )}
      </div>
      {failed && error && (
        <div className="mt-1.5 text-[11px] font-mono text-destructive/80 break-words">
          {error}
        </div>
      )}
    </div>
  );
}

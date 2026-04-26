import { useMemo } from "react";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export type PlatformPostStatus =
  | "idle"
  | "ready"
  | "requires-video"
  | "not-connected"
  | "posting"
  | "success"
  | "failed";

export interface PlatformPostState {
  id: string;
  label: string;
  status: PlatformPostStatus;
  message?: string;
}

interface Props {
  platforms: PlatformPostState[];
  phase: "validating" | "ready" | "posting" | "complete";
  onRetry?: (platformId: string) => void;
}

const VIDEO_REQUIRED = new Set(["youtube", "tiktok"]);

export function buildInitialStates(
  selectedIds: string[],
  labelMap: Record<string, string>,
  connections: Record<string, boolean>,
  hasVideo: boolean,
): PlatformPostState[] {
  return selectedIds.map((id) => {
    const label = labelMap[id] || id;
    if (!connections[id]) {
      return { id, label, status: "not-connected", message: "Not connected" };
    }
    if (VIDEO_REQUIRED.has(id) && !hasVideo) {
      return { id, label, status: "requires-video", message: "Requires video — image only available" };
    }
    return { id, label, status: "ready", message: "Ready to post" };
  });
}

export function hasBlockingError(states: PlatformPostState[]): boolean {
  return states.some((s) => s.status === "not-connected");
}

function StatusIcon({ status }: { status: PlatformPostStatus }) {
  switch (status) {
    case "ready":
      return <CheckCircle2 size={16} className="text-green-500" />;
    case "requires-video":
      return <AlertTriangle size={16} className="text-amber-500" />;
    case "not-connected":
      return <XCircle size={16} className="text-destructive" />;
    case "posting":
      return <Loader2 size={16} className="animate-spin text-primary" />;
    case "success":
      return <CheckCircle2 size={16} className="text-green-500" />;
    case "failed":
      return <XCircle size={16} className="text-destructive" />;
    default:
      return <Circle size={16} className="text-muted-foreground" />;
  }
}

function statusLabel(status: PlatformPostStatus): string {
  switch (status) {
    case "ready": return "Ready";
    case "requires-video": return "Requires video";
    case "not-connected": return "Not connected";
    case "posting": return "Posting…";
    case "success": return "Posted";
    case "failed": return "Failed";
    default: return "Pending";
  }
}

function statusToneClass(status: PlatformPostStatus): string {
  switch (status) {
    case "ready":
    case "success":
      return "bg-green-500/10 text-green-500 border-green-500/30";
    case "requires-video":
      return "bg-amber-500/10 text-amber-500 border-amber-500/30";
    case "not-connected":
    case "failed":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "posting":
      return "bg-primary/10 text-primary border-primary/30";
    default:
      return "bg-muted text-muted-foreground border-border/30";
  }
}

export function PostProgressPanel({ platforms, phase, onRetry }: Props) {
  const heading = useMemo(() => {
    switch (phase) {
      case "validating": return "Pre-post validation";
      case "ready": return "Ready to post";
      case "posting": return "Posting in progress";
      case "complete": return "Post results";
    }
  }, [phase]);

  return (
    <div className="rounded-lg border border-border/30 bg-secondary/20 p-3 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{heading}</p>
      <div className="space-y-1.5">
        {platforms.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between gap-2 rounded-md bg-background/40 border border-border/20 px-3 py-2"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <StatusIcon status={p.status} />
              <span className="text-sm font-medium text-foreground truncate">{p.label}</span>
              {p.message && (
                <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                  — {p.message}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Badge variant="outline" className={`text-[10px] ${statusToneClass(p.status)}`}>
                {statusLabel(p.status)}
              </Badge>
              {p.status === "failed" && onRetry && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onRetry(p.id)}
                  className="h-7 px-2 text-xs gap-1"
                >
                  <RefreshCw size={12} /> Retry
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

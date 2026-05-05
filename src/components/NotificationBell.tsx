import { useState } from "react";
import { Bell, CheckCheck, RotateCw, ExternalLink, Volume2, VolumeX, Loader2, Bug, Gem } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { Badge } from "@/components/ui/badge";
import { useNotifications, type Notification } from "@/hooks/useNotifications";
import { formatDistanceToNow } from "date-fns";
import {
  retryFailedPlatforms,
  getViewPostUrl,
  isSoundEnabled,
  setSoundEnabled,
} from "@/lib/notificationUtils";
import { copyDebugSnapshot } from "@/lib/debugSnapshot";
import { toast } from "sonner";

export function NotificationBell() {
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [soundOn, setSoundOnState] = useState<boolean>(isSoundEnabled());
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOnState(next);
  };

  const handleRetry = async (n: Notification) => {
    setRetryingId(n.id);
    const res = await retryFailedPlatforms(n.meta);
    setRetryingId(null);
    if (res.ok) toast.success("Retry succeeded");
    else toast.error(res.error || "Retry failed");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="relative text-foreground/90 hover:text-foreground hover:bg-white/10">
          <Bell size={16} className="opacity-100" />
          {unreadCount > 0 && (
            <Badge
              variant={notifications.some((n) => !n.read && n.type === "error") ? "destructive" : "default"}
              className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 overflow-hidden">
        <div className="max-h-[400px] overflow-y-auto notif-scroll">
          <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="text-xs gap-1 h-7"
                onClick={toggleSound}
                title={soundOn ? "Mute success sound" : "Unmute success sound"}
              >
                {soundOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
              </Button>
              {unreadCount > 0 && (
                <Button size="sm" variant="ghost" className="text-xs gap-1 h-7" onClick={markAllAsRead}>
                  <CheckCheck size={12} /> Mark all read
                </Button>
              )}
            </div>
          </div>
          {notifications.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No notifications yet</p>
          ) : (
            <div className="pb-2">
              {notifications.map((n) => {
                const failures = n.meta?.failures ?? [];
                const successes = n.meta?.successes ?? [];
                const isSummary = n.meta?.kind === "summary";
                const isGrowthInsight =
                  (typeof n.title === "string" && n.title.startsWith("New Growth Insight")) ||
                  (n.meta as any)?.kind === "growth_insight";
                const viewUrl = !isSummary && failures.length === 0 ? getViewPostUrl(n.meta) : null;
                const canRetry = !isSummary && failures.length > 0;

                const dotColor =
                  n.type === "success"
                    ? "bg-green-500"
                    : n.type === "error"
                    ? failures.length > 0 && successes.length > 0
                      ? "bg-amber-500"
                      : "bg-destructive"
                    : "bg-primary";

                return (
                  <div
                    key={n.id}
                    className={`w-full text-left px-4 py-4 border-b border-border/50 hover:bg-primary/10 transition-colors ${
                      isGrowthInsight
                        ? "bg-amber-500/10 border-l-2 border-l-amber-500/60 hover:bg-amber-500/15"
                        : !n.read
                        ? "bg-primary/5"
                        : ""
                    }`}
                  >
                    <button
                      onClick={() => !n.read && markAsRead(n.id)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start gap-2">
                        {isGrowthInsight ? (
                          <Gem size={14} className="mt-0.5 text-amber-400 shrink-0 drop-shadow-[0_0_4px_rgba(251,191,36,0.6)]" />
                        ) : (
                          <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={`text-xs font-medium ${isGrowthInsight ? "text-amber-200" : "text-foreground"}`}>{n.title}</p>
                          <p className="text-xs text-muted-foreground whitespace-pre-line">
                            {n.displayMessage}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">
                            {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    </button>
                    {(canRetry || viewUrl || n.type === "error") && (
                      <div className="flex items-center gap-2 mt-2 pl-4 flex-wrap">
                        {canRetry && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            disabled={retryingId === n.id}
                            onClick={() => handleRetry(n)}
                          >
                            {retryingId === n.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <RotateCw size={12} />
                            )}
                            Retry {failures.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(", ")}
                          </Button>
                        )}
                        {viewUrl && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={() => window.open(viewUrl, "_blank", "noopener,noreferrer")}
                          >
                            <ExternalLink size={12} /> View Post
                          </Button>
                        )}
                        {n.type === "error" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1"
                            onClick={async () => {
                              try {
                                const snap = await copyDebugSnapshot({
                                  notification: {
                                    title: n.title,
                                    message: n.displayMessage ?? "",
                                    type: n.type,
                                    created_at: n.created_at,
                                    meta: n.meta,
                                  },
                                });
                                toast.success("🐛 Debug info copied", {
                                  description: `${snap.split("\n").length} lines on clipboard.`,
                                });
                              } catch (err) {
                                toast.error("Failed to build snapshot", {
                                  description: err instanceof Error ? err.message : String(err),
                                });
                              }
                            }}
                          >
                            <Bug size={12} /> Copy Debug Info
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

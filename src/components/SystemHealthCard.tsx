import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Beaker, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface DryRunEntry {
  city: string;
  city_id: string | null;
  slot: string;
  target_local: string | null;
  current_local: string;
  tz: string;
  platforms: string[];
  diff_min?: number;
  matched: boolean;
  voiceover_enabled?: boolean;
  voiceover_platforms?: string[];
  reason: string;
}

interface DryRunResponse {
  dry_run: true;
  message: string;
  checked_targets: number;
  would_trigger: number;
  report: DryRunEntry[];
  summary: string[];
}

export function SystemHealthCard() {
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [lastRunIso, setLastRunIso] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("system_health")
        .select("last_run_at, last_status, last_message")
        .eq("id", "auto-post-scheduler")
        .maybeSingle();
      const iso = data?.last_run_at ?? null;
      setLastRunIso(iso);
      setLastRun(timeAgo(iso));
      setStatus(data?.last_status ?? null);
      setMessage(data?.last_message ?? null);
    } finally {
      setLoading(false);
    }
  };

  const runDryRun = async () => {
    setDryRunLoading(true);
    setDryRunResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("auto-post-scheduler", {
        body: { dry_run: true },
      });
      if (error) throw error;
      const result = data as DryRunResponse;
      setDryRunResult(result);
      toast({
        title: "Dry run complete",
        description: `${result.would_trigger} slot(s) would fire right now across ${result.checked_targets} target(s).`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Dry run failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setDryRunLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 30000);
    return () => clearInterval(t);
  }, []);

  // Active if scheduler ticked within the last 12 minutes (cron = every 5)
  const isActive = lastRunIso
    ? Date.now() - new Date(lastRunIso).getTime() < 12 * 60 * 1000
    : false;
  const hasError = status === "error";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Activity size={16} className="text-primary" />
          System Health
        </CardTitle>
        <CardDescription className="text-xs">
          Background automation status
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Cron Status</span>
          <Badge variant={isActive ? "default" : "secondary"} className={isActive ? "bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/20" : ""}>
            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${isActive ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`} />
            {isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Last Automation Run</span>
          <span className="text-sm font-medium">{lastRun ?? "—"}</span>
        </div>
        {lastRunIso && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Last result</span>
            <Badge
              variant="outline"
              className={
                hasError
                  ? "bg-destructive/15 text-destructive border-destructive/30 text-[11px]"
                  : "bg-green-500/15 text-green-500 border-green-500/30 text-[11px]"
              }
            >
              {hasError ? "❌ Failed" : "✅ Success"}
            </Badge>
          </div>
        )}
        {lastRunIso && (
          <p className="text-[11px] text-muted-foreground">
            {new Date(lastRunIso).toLocaleString()}
          </p>
        )}
        {hasError && message && (
          <p className="text-[11px] text-destructive">
            {message}
          </p>
        )}
        {!isActive && !hasError && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            No recent automation tick detected. Scheduler should run every 5 minutes.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={fetchHealth}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={runDryRun}
            disabled={dryRunLoading}
            className="gap-2"
          >
            <Beaker size={12} className={dryRunLoading ? "animate-pulse" : ""} />
            {dryRunLoading ? "Running…" : "Test Automation Logic (Dry Run)"}
          </Button>
        </div>

        {dryRunResult && (
          <div className="mt-3 rounded-md border border-border/50 bg-muted/40 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Dry Run Results</span>
              <Badge variant="outline" className="text-[10px]">
                {dryRunResult.would_trigger} would fire / {dryRunResult.report.length} slot(s) checked
              </Badge>
            </div>
            <ScrollArea className="h-48 pr-2">
              <ul className="space-y-1.5 text-[11px] font-mono">
                {dryRunResult.report.length === 0 && (
                  <li className="text-muted-foreground italic">
                    No targets to check. Add a city + automation in Settings → Cities.
                  </li>
                )}
                {dryRunResult.report.map((entry, idx) => (
                  <li
                    key={idx}
                    className={`flex items-start gap-1.5 leading-tight ${
                      entry.matched ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                    }`}
                  >
                    {entry.matched ? (
                      <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" />
                    ) : (
                      <XCircle size={12} className="mt-0.5 flex-shrink-0 opacity-60" />
                    )}
                    <span>
                      <span className="font-semibold">
                        {entry.matched ? "Slot Match Found" : "No match"} for {entry.city} [{entry.slot}]:
                      </span>{" "}
                      {entry.matched ? "YES" : "NO"}.{" "}
                      <span className="text-foreground/80">
                        Platforms: {entry.platforms.length ? entry.platforms.join(", ") : "none"}.
                      </span>{" "}
                      <span className="opacity-80">Reason: {entry.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </ScrollArea>
            <p className="text-[10px] text-muted-foreground italic">
              Dry run does NOT insert posts, send notifications, or update System Health.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

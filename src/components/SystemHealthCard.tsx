import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Beaker, CheckCircle2, XCircle, Mic, AlertTriangle, Bug, Copy, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { copyDebugSnapshot } from "@/lib/debugSnapshot";

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

interface TraceStep { ts: string; step: string; detail?: any }
interface LatestTraceRow {
  id: string;
  city: string;
  status: string;
  platform: string | null;
  voice_status: string | null;
  voice_error: string | null;
  voice_attempts: number | null;
  debug_trace: { steps?: TraceStep[]; captured_at?: string } | null;
  created_at: string;
}

function voiceLine(row: { voice_status: string | null; voice_error: string | null; voice_attempts: number | null }) {
  const s = row.voice_status;
  const a = row.voice_attempts ?? 0;
  if (s === "success") return { icon: "✅", label: `Voice: Success (${a || 1} attempt${(a || 1) > 1 ? "s" : ""})`, tone: "ok" as const };
  if (s === "retried") return { icon: "⚠️", label: `Voice: Retried (${a} attempts)`, tone: "warn" as const };
  if (s === "failed") return { icon: "❌", label: `Voice: Failed${row.voice_error ? ` — ${row.voice_error}` : ""}`, tone: "err" as const };
  if (s === "skipped") return { icon: "—", label: `Voice: Skipped — ${row.voice_error || "platform doesn't support audio"}`, tone: "muted" as const };
  return { icon: "—", label: "Voice: Not requested", tone: "muted" as const };
}

interface HealthRow {
  last_run_at: string | null;
  last_status: string | null;
  last_message: string | null;
}

const EMPTY_ROW: HealthRow = { last_run_at: null, last_status: null, last_message: null };

function sourceFromMessage(msg: string | null): string {
  if (!msg) return "—";
  const m = msg.match(/source=([a-z]+)/);
  return m ? m[1] : (msg.startsWith("probe") ? "probe" : "cron");
}

export function SystemHealthCard() {
  const [scheduler, setScheduler] = useState<HealthRow>(EMPTY_ROW);
  const [runJobs, setRunJobs] = useState<HealthRow>(EMPTY_ROW);
  const [probe, setProbe] = useState<HealthRow>(EMPTY_ROW);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [syncingCron, setSyncingCron] = useState(false);

  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunResult, setDryRunResult] = useState<DryRunResponse | null>(null);

  const [debugEnabled, setDebugEnabled] = useState(false);
  const [debugSaving, setDebugSaving] = useState(false);
  const [latestTrace, setLatestTrace] = useState<LatestTraceRow | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from("system_health")
        .select("id, last_run_at, last_status, last_message")
        .in("id", ["auto-post-scheduler", "auto-post-scheduler-probe", "run-jobs"]);
      const byId: Record<string, HealthRow> = {};
      (data || []).forEach((r: any) => {
        byId[r.id] = {
          last_run_at: r.last_run_at,
          last_status: r.last_status,
          last_message: r.last_message,
        };
      });
      setScheduler(byId["auto-post-scheduler"] || EMPTY_ROW);
      setRunJobs(byId["run-jobs"] || EMPTY_ROW);
      setProbe(byId["auto-post-scheduler-probe"] || EMPTY_ROW);
    } finally {
      setLoading(false);
    }
  }, []);

  const syncCronSecret = useCallback(async () => {
    setSyncingCron(true);
    try {
      const { data, error } = await supabase.functions.invoke("sync-cron-secret", { body: {} });
      if (error || !(data as any)?.ok) {
        toast({
          title: "Cron secret sync failed",
          description: (error?.message || (data as any)?.error || "Unknown error"),
          variant: "destructive",
        });
      } else {
        toast({ title: "🔑 Cron secret synced", description: "Background workers can authenticate again." });
      }
    } finally {
      setSyncingCron(false);
      await fetchHealth();
    }
  }, [fetchHealth]);

  const safeReset = useCallback(async () => {
    setProbing(true);
    setProbeError(null);
    try {
      const { data, error } = await supabase.functions.invoke("auto-post-scheduler", {
        body: { probe: true },
      });
      if (error) {
        const anyErr = error as any;
        const statusCode = anyErr?.context?.status ?? anyErr?.status;
        let bodyText = "";
        try {
          if (anyErr?.context && typeof anyErr.context.text === "function") {
            bodyText = await anyErr.context.text();
          }
        } catch { /* ignore */ }
        const label = statusCode ? `${statusCode} ${anyErr?.message || "Error"}` : (anyErr?.message || "Probe failed");
        const full = bodyText ? `${label} — ${bodyText.slice(0, 200)}` : label;
        setProbeError(full);
        toast({ title: "❌ Heartbeat failed", description: full, variant: "destructive" });
      } else if (data?.ok) {
        toast({ title: "✅ Heartbeat OK", description: "Scheduler responded — link is alive." });
      } else {
        const m = data?.error || "Unknown response";
        setProbeError(m);
        toast({ title: "❌ Heartbeat error", description: m, variant: "destructive" });
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setProbeError(m);
      toast({ title: "❌ Heartbeat failed", description: m, variant: "destructive" });
    } finally {
      setProbing(false);
      await fetchHealth();
    }
  }, [fetchHealth]);


  const fetchDebugState = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;
    const [{ data: settings }, { data: trace }] = await Promise.all([
      supabase
        .from("weather_settings")
        .select("enable_debug_trace")
        .eq("user_id", userData.user.id)
        .limit(1)
        .maybeSingle(),
      supabase
        .from("post_history")
        .select("id, city, status, platform, voice_status, voice_error, voice_attempts, debug_trace, created_at")
        .eq("user_id", userData.user.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setDebugEnabled((settings as any)?.enable_debug_trace === true);
    // Pick the most recent row that actually has a stored trace
    const traced = (trace || []).find((r: any) => r.debug_trace && Array.isArray(r.debug_trace?.steps)) as any;
    setLatestTrace(traced || (trace?.[0] as any) || null);
  }, []);

  const toggleDebug = async (next: boolean) => {
    setDebugSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("weather_settings")
        .update({ enable_debug_trace: next })
        .eq("user_id", userData.user.id);
      if (error) throw error;
      setDebugEnabled(next);
      toast({
        title: next ? "Debug trace armed" : "Debug trace disabled",
        description: next
          ? "The next scheduled run will record a full step-by-step trace, then auto-disable."
          : "No traces will be captured on upcoming runs.",
      });
    } catch (err) {
      toast({
        title: "Failed to update debug toggle",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDebugSaving(false);
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
    fetchDebugState();
    const t = setInterval(() => { fetchHealth(); fetchDebugState(); }, 30000);
    return () => clearInterval(t);
  }, [fetchHealth, fetchDebugState]);

  // Tri-state derivation: Active (≤5m & ok) / Stale (5–10m & ok) / Critical (>10m OR error)
  const ageMs = lastRunIso ? Date.now() - new Date(lastRunIso).getTime() : Infinity;
  const hasError = status === "error";
  const isCritical = hasError || ageMs > 10 * 60 * 1000;
  const isStale = !isCritical && ageMs > 5 * 60 * 1000;
  const isActive = !isCritical && !isStale;
  const stateLabel = isActive ? "Active" : isStale ? "Stale" : "CRITICAL";
  const stateBadgeClass = isActive
    ? "bg-green-500/20 text-green-600 border-green-500/30 hover:bg-green-500/20"
    : isStale
    ? "bg-amber-500/20 text-amber-600 border-amber-500/30 hover:bg-amber-500/20"
    : "bg-destructive/20 text-destructive border-destructive/40 hover:bg-destructive/20";
  const stateDotClass = isActive
    ? "bg-green-500 animate-pulse"
    : isStale
    ? "bg-amber-500"
    : "bg-destructive";

  const voice = latestTrace
    ? voiceLine({
        voice_status: latestTrace.voice_status,
        voice_error: latestTrace.voice_error,
        voice_attempts: latestTrace.voice_attempts,
      })
    : null;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer select-none hover:bg-muted/30 transition-colors rounded-t-lg">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity size={16} className="text-primary" />
                  System Health
                  <Badge
                    variant="outline"
                    className={`ml-1 ${stateBadgeClass}`}
                  >
                    <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${stateDotClass}`} />
                    {stateLabel}
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  {open ? "Background automation status" : `Last run: ${lastRun ?? "—"}`}
                </CardDescription>
              </div>
              <ChevronDown
                size={18}
                className={`text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Cron Status</span>
          <Badge variant="outline" className={stateBadgeClass}>
            <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${stateDotClass}`} />
            {stateLabel}
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
        {isCritical && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2.5 space-y-1">
            <p className="text-[11px] font-semibold text-destructive flex items-center gap-1.5">
              <AlertTriangle size={12} /> CRITICAL — automation link is down
            </p>
            <p className="text-[11px] text-destructive/90">
              {hasError && message
                ? message
                : `No tick in ${lastRunIso ? timeAgo(lastRunIso) : "a while"}. Scheduler should run every 5 minutes.`}
            </p>
            {probeError && (
              <p className="text-[11px] font-mono text-destructive/90 break-all">
                Probe: {probeError}
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              Click <span className="font-semibold">Safe Reset</span> below to send a live test tick.
            </p>
          </div>
        )}
        {isStale && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            Last tick was {lastRun}. Scheduler is delayed — should run every 5 minutes.
          </p>
        )}

        {/* Debug Trace toggle */}
        <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <Label htmlFor="debug-trace" className="text-sm font-medium flex items-center gap-1.5">
                <Beaker size={14} className="text-primary" />
                Enable Debug Trace (Next Run)
              </Label>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Capture a full step trace on the next scheduled execution. Auto-disables after one run.
              </p>
            </div>
            <Switch
              id="debug-trace"
              checked={debugEnabled}
              disabled={debugSaving}
              onCheckedChange={toggleDebug}
            />
          </div>
          {debugEnabled && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle size={11} /> Armed — next auto-run will record + persist a trace.
            </p>
          )}
        </div>

        {/* Last voice status + trace */}
        {latestTrace && voice && (
          <div className="rounded-md border border-border/50 bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold flex items-center gap-1.5">
                <Mic size={12} /> Last Voice Status
              </span>
              <span className="text-[10px] text-muted-foreground">
                {timeAgo(latestTrace.created_at)} · {latestTrace.city}
              </span>
            </div>
            <p className={
              voice.tone === "ok" ? "text-[12px] text-green-500"
              : voice.tone === "warn" ? "text-[12px] text-amber-500"
              : voice.tone === "err" ? "text-[12px] text-destructive"
              : "text-[12px] text-muted-foreground"
            }>
              {voice.icon} {voice.label}
            </p>

            {latestTrace.debug_trace?.steps && latestTrace.debug_trace.steps.length > 0 && (
              <>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs font-semibold">Step Trace</span>
                  <Badge variant="outline" className="text-[10px]">
                    {latestTrace.debug_trace.steps.length} steps
                  </Badge>
                </div>
                <ScrollArea className="h-44 pr-2">
                  <ul className="space-y-1 text-[11px] font-mono">
                    {latestTrace.debug_trace.steps.map((s, i) => (
                      <li key={i} className="leading-tight">
                        <span className="text-muted-foreground">
                          {new Date(s.ts).toLocaleTimeString()}
                        </span>{" "}
                        <span className="text-foreground font-semibold">{s.step}</span>
                        {s.detail !== undefined && s.detail !== null && (
                          <span className="text-muted-foreground/80">
                            {" "}· {typeof s.detail === "object" ? JSON.stringify(s.detail) : String(s.detail)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              </>
            )}
            {!latestTrace.debug_trace && (
              <p className="text-[10px] italic text-muted-foreground">
                No step trace stored for the most recent run. Toggle "Enable Debug Trace" above and wait for the next run.
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button
            size="sm"
            variant={isCritical ? "default" : "outline"}
            onClick={safeReset}
            disabled={probing}
            className="gap-2"
            title="Sends a live test tick to the scheduler and refreshes status."
          >
            <RefreshCw size={12} className={probing ? "animate-spin" : ""} />
            {probing ? "Probing…" : "Safe Reset"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={runDryRun}
            disabled={dryRunLoading}
            className="gap-2"
          >
            <Beaker size={12} className={dryRunLoading ? "animate-pulse" : ""} />
            {dryRunLoading ? "Running…" : "Test Automation Logic (Dry Run)"}
          </Button>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              const snap = await copyDebugSnapshot();
              toast({
                title: "🐛 Debug snapshot copied",
                description: `${snap.split("\n").length} lines copied to clipboard — ready to paste.`,
              });
            } catch (err) {
              toast({
                title: "Failed to build snapshot",
                description: err instanceof Error ? err.message : String(err),
                variant: "destructive",
              });
            }
          }}
          className="w-full gap-2"
        >
          <Bug size={12} />
          Report Issue — Copy Debug Snapshot
        </Button>

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
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

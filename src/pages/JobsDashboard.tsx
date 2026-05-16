import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, RefreshCw, RotateCcw, XCircle, CheckCircle2, Clock, Loader2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface JobRow {
  id: string;
  user_id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  scheduled_for: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  parent_job_id: string | null;
  root_job_id: string | null;
  scheduled_post_id: string | null;
  city: string | null;
  platform: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface SystemLogRow {
  id: string;
  type: string;
  message: string;
  platform: string | null;
  created_at: string;
  context: Record<string, unknown> | null;
}

const TYPE_ORDER = ["generate_content", "generate_voice", "render_video", "publish_post", "analyze_performance"] as const;
const STATUS_OPTIONS = ["all", "pending", "retrying", "processing", "succeeded", "failed", "cancelled"];
const TYPE_OPTIONS = ["all", ...TYPE_ORDER];

function engineStateBadge(payload: Record<string, unknown> | null | undefined) {
  const p = (payload ?? {}) as any;
  const state = p.engine_state as string | undefined;
  if (state === "optimized") {
    const ref = p.reference_job ? ` · ${p.reference_job}` : "";
    return (
      <Badge variant="outline" className="font-mono text-[10px] gap-1 border-emerald-500/40 text-emerald-300 bg-emerald-500/10" title={`Reusing patterns from a recent winning job${ref}`}>
        🟢 Optimized{ref}
      </Badge>
    );
  }
  if (state === "experiment") {
    return (
      <Badge variant="outline" className="font-mono text-[10px] gap-1 border-amber-500/40 text-amber-300 bg-amber-500/10" title="Testing a new combination to beat past jobs">
        🧪 Experiment
      </Badge>
    );
  }
  return null;
}

function statusBadge(status: string) {
  const map: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: any; label: string }> = {
    pending: { variant: "secondary", icon: Clock, label: "Pending" },
    retrying: { variant: "outline", icon: RotateCcw, label: "Retrying" },
    processing: { variant: "default", icon: Loader2, label: "Processing" },
    succeeded: { variant: "default", icon: CheckCircle2, label: "Succeeded" },
    failed: { variant: "destructive", icon: XCircle, label: "Failed" },
    cancelled: { variant: "outline", icon: XCircle, label: "Cancelled" },
  };
  const m = map[status] ?? { variant: "outline" as const, icon: AlertTriangle, label: status };
  const Icon = m.icon;
  return (
    <Badge variant={m.variant} className="gap-1 font-mono text-xs">
      <Icon className={`h-3 w-3 ${status === "processing" ? "animate-spin" : ""}`} />
      {m.label}
    </Badge>
  );
}

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (Math.abs(s) < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (Math.abs(m) < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return `${h}h ago`;
  return new Date(iso).toLocaleString();
}

function fmtDuration(startISO: string | null, endISO: string | null): string | null {
  if (!startISO) return null;
  const start = new Date(startISO).getTime();
  const end = endISO ? new Date(endISO).getTime() : Date.now();
  const ms = Math.max(0, end - start);
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}

function stepLabel(t: string): string {
  return t.replace(/_/g, " ");
}

export default function JobsDashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [cityFilter, setCityFilter] = useState("");
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [selectedLogs, setSelectedLogs] = useState<SystemLogRow[]>([]);

  const loadJobs = async (opts?: { kick?: boolean }) => {
    setLoading(true);
    // Optionally kick the worker so any due jobs advance before we re-fetch.
    if (opts?.kick) {
      try {
        await supabase.functions.invoke("run-jobs", { body: { source: "dashboard_refresh" } });
      } catch {
        // non-fatal — still re-fetch
      }
    }
    let query = supabase
      .from("jobs" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (typeFilter !== "all") query = query.eq("type", typeFilter);
    if (cityFilter.trim()) query = query.ilike("city", `%${cityFilter.trim()}%`);
    const { data, error } = await query;
    if (error) {
      toast({ title: "Failed to load jobs", description: error.message, variant: "destructive" });
    } else {
      setJobs((data ?? []) as unknown as JobRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter]);

  // Realtime updates
  useEffect(() => {
    const channel = supabase
      .channel("jobs-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => loadJobs())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group by root_job_id for timeline view
  const grouped = useMemo(() => {
    const map = new Map<string, JobRow[]>();
    for (const j of jobs) {
      const key = j.root_job_id ?? j.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(j);
    }
    // sort children by created_at within each chain
    for (const [, list] of map) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    }
    return Array.from(map.entries()).sort((a, b) => {
      const aT = a[1][a[1].length - 1].created_at;
      const bT = b[1][b[1].length - 1].created_at;
      return bT.localeCompare(aT);
    });
  }, [jobs]);

  const openDrilldown = async (rootId: string) => {
    setSelectedRoot(rootId);
    // Fetch system_logs tied to this chain
    const ids = jobs.filter((j) => (j.root_job_id ?? j.id) === rootId).map((j) => j.id);
    if (ids.length === 0) {
      setSelectedLogs([]);
      return;
    }
    const { data } = await supabase
      .from("system_logs")
      .select("*")
      .in("type", ["job_generate_content", "job_generate_voice", "job_render_video", "job_publish_post", "job_analyze_performance",
                   "job_generate_content_failed", "job_generate_voice_failed", "job_render_video_failed", "job_publish_post_failed", "job_analyze_performance_failed"])
      .order("created_at", { ascending: false })
      .limit(200);
    const filtered = (data ?? []).filter((row: any) => {
      const ctx = row.context as any;
      return ctx?.root_job_id === rootId || ids.includes(ctx?.job_id);
    });
    setSelectedLogs(filtered as SystemLogRow[]);
  };

  const requeueJob = async (job: JobRow) => {
    const { error } = await supabase
      .from("jobs" as any)
      .update({
        status: "retrying",
        attempts: 0,
        scheduled_for: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
      })
      .eq("id", job.id);
    if (error) {
      toast({ title: "Requeue failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Job requeued", description: `${job.type} will run on next tick.` });
      loadJobs();
    }
  };

  const cancelJob = async (job: JobRow) => {
    const { error } = await supabase
      .from("jobs" as any)
      .update({ status: "cancelled", locked_at: null, locked_by: null })
      .eq("id", job.id);
    if (error) toast({ title: "Cancel failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Job cancelled" }); loadJobs(); }
  };

  const selectedChain = selectedRoot ? jobs.filter((j) => (j.root_job_id ?? j.id) === selectedRoot).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [];

  return (
    <div className="dark min-h-screen bg-background text-foreground p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Job Pipeline</h1>
              <p className="text-sm text-muted-foreground font-mono">
                Durable, retryable: content → voice → render → publish → analyze (24h)
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={loadJobs} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Filters */}
        <Card className="p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground font-mono">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground font-mono">Type</label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground font-mono">City</label>
            <div className="flex gap-2">
              <Input
                placeholder="Filter by city…"
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadJobs()}
              />
              <Button variant="outline" onClick={loadJobs}>Apply</Button>
            </div>
          </div>
        </Card>

        {/* Timeline list */}
        <div className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!loading && grouped.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">
              No jobs found. The new pipeline is opt-in — enable it in Settings.
            </Card>
          )}
          {grouped.map(([rootId, chain]) => {
            const head = chain[chain.length - 1];
            return (
              <Card
                key={rootId}
                className="p-4 hover:bg-muted/30 cursor-pointer transition-colors"
                onClick={() => openDrilldown(rootId)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    {statusBadge(head.status)}
                    <span className="font-mono text-sm">{head.city ?? "—"}</span>
                    {head.platform && <Badge variant="outline" className="font-mono text-xs">{head.platform}</Badge>}
                    {engineStateBadge(chain.find((c) => c.type === "generate_content")?.payload ?? head.payload)}
                  </div>
                  <span className="text-xs text-muted-foreground font-mono">{fmtRelative(head.created_at)}</span>
                </div>
                {/* Step pipeline */}
                <div className="flex items-center gap-2 flex-wrap">
                  {TYPE_ORDER.map((t) => {
                    const step = chain.find((c) => c.type === t);
                    const tone = step
                      ? step.status === "succeeded"
                        ? "bg-primary/20 text-primary border-primary/40"
                        : step.status === "failed"
                        ? "bg-destructive/20 text-destructive border-destructive/40"
                        : step.status === "processing"
                        ? "bg-blue-500/20 text-blue-300 border-blue-500/40"
                        : step.status === "retrying"
                        ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                        : "bg-muted text-muted-foreground border-border"
                      : "bg-muted/30 text-muted-foreground/50 border-border/40 border-dashed";
                    const dur = step ? fmtDuration(step.started_at, step.completed_at) : null;
                    return (
                      <div key={t} className={`px-2 py-1 rounded border text-xs font-mono flex items-center gap-1.5 ${tone}`}>
                        <span>{stepLabel(t)}</span>
                        {dur && <span className="opacity-70">· {dur}</span>}
                        {step && step.attempts > 1 && <span className="opacity-60">×{step.attempts}</span>}
                      </div>
                    );
                  })}
                </div>
                {head.last_error && (
                  <div className="mt-3 flex items-start justify-between gap-3">
                    <div className="text-xs text-destructive font-mono space-y-0.5 flex-1 min-w-0">
                      <div className="font-semibold">⚠ Failed at: {stepLabel(head.type)}</div>
                      <div className="truncate opacity-90">{head.last_error}</div>
                      <div className="text-[10px] opacity-60">
                        Retry re-runs only this step. Earlier successful steps (incl. cached video) are reused — no extra render credits.
                      </div>
                    </div>
                    {(head.status === "failed" || head.status === "cancelled") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="shrink-0"
                        onClick={(e) => { e.stopPropagation(); requeueJob(head); }}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" /> Retry Failed Step
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* Drilldown sheet */}
      <Sheet open={!!selectedRoot} onOpenChange={(o) => !o && setSelectedRoot(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-hidden flex flex-col">
          <SheetHeader>
            <SheetTitle>Job chain</SheetTitle>
            <SheetDescription className="font-mono text-xs">
              {selectedRoot?.slice(0, 8)}…
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="flex-1 mt-4 pr-4">
            <div className="space-y-4">
              {selectedChain.map((j) => {
                const dur = fmtDuration(j.started_at, j.completed_at);
                return (
                <div key={j.id} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm">{stepLabel(j.type)}</span>
                      {dur && (
                        <span className="text-xs font-mono text-muted-foreground">· {dur}</span>
                      )}
                    </div>
                    {statusBadge(j.status)}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono space-y-1">
                    <div>Attempts: {j.attempts}/{j.max_attempts}</div>
                    <div>Scheduled: {fmtRelative(j.scheduled_for)}</div>
                    {j.started_at && <div>Started: {fmtRelative(j.started_at)}</div>}
                    {j.completed_at && <div>Completed: {fmtRelative(j.completed_at)}</div>}
                    {dur && <div>Duration: {dur}</div>}
                    {j.locked_by && <div>Locked by: {j.locked_by}</div>}
                  </div>
                  {j.last_error && (
                    <div className="text-xs text-destructive bg-destructive/10 p-2 rounded font-mono space-y-1">
                      <div className="font-semibold">Failed step: {stepLabel(j.type)}</div>
                      <div className="whitespace-pre-wrap opacity-90">{j.last_error}</div>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    {(j.status === "failed" || j.status === "cancelled") && (
                      <Button size="sm" variant="outline" onClick={() => requeueJob(j)} title="Re-run only this step — earlier successful steps are not repeated">
                        <RotateCcw className="h-3 w-3 mr-1" /> Retry this step
                      </Button>
                    )}
                    {(j.status === "pending" || j.status === "retrying") && (
                      <Button size="sm" variant="outline" onClick={() => cancelJob(j)}>
                        <XCircle className="h-3 w-3 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
                );
              })}

              {selectedLogs.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold mb-2">System logs</h3>
                  <div className="space-y-2">
                    {selectedLogs.map((l) => (
                      <div key={l.id} className="text-xs font-mono border-l-2 border-muted pl-2 py-1">
                        <div className="text-muted-foreground">{fmtRelative(l.created_at)} · {l.type}</div>
                        <div className="text-foreground">{l.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  );
}

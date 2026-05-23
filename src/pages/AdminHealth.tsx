import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RefreshCw, ArrowLeft, Loader2 } from "lucide-react";

type ScheduledRow = {
  id: string;
  city: string | null;
  slot: string | null;
  platform: string | null;
  status: string | null;
  error_message: string | null;
  scheduled_at: string | null;
  created_at: string;
};

type LogRow = {
  id: string;
  type: string | null;
  message: string | null;
  context: any;
  created_at: string;
};

function statusColor(status: string | null): string {
  const s = (status ?? "").toLowerCase();
  if (s === "posted" || s === "success" || s === "completed") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  if (s === "failed" || s === "validation_failed" || s.includes("error") || s.includes("block")) return "bg-red-500/15 text-red-400 border-red-500/30";
  if (s === "pending" || s === "processing" || s === "queued") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function short(s: string | null | undefined, n = 8): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) : s;
}

export default function AdminHealth() {
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [recent, setRecent] = useState<ScheduledRow[]>([]);
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ScheduledRow[]>([]);
  const [renderFails, setRenderFails] = useState<ScheduledRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [recentRes, logsRes, blockedRes, renderRes] = await Promise.all([
      supabase
        .from("scheduled_posts")
        .select("id, city, slot, platform, status, error_message, scheduled_at, created_at")
        .order("created_at", { ascending: false })
        .limit(15),
      supabase
        .from("system_logs" as any)
        .select("id, type, message, context, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("scheduled_posts")
        .select("id, city, slot, platform, status, error_message, scheduled_at, created_at")
        .or("status.eq.validation_failed,error_message.ilike.%blocked%,error_message.ilike.%validation%")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("scheduled_posts")
        .select("id, city, slot, platform, status, error_message, scheduled_at, created_at")
        .eq("status", "failed")
        .or("error_message.ilike.%creatomate%,error_message.ilike.%render%,error_message.ilike.%template%")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    setRecent((recentRes.data as ScheduledRow[]) ?? []);
    if (logsRes.error) {
      setLogs(null);
      setLogsError(logsRes.error.message);
    } else {
      setLogs(((logsRes.data as unknown) as LogRow[]) ?? []);
      setLogsError(null);
    }
    setBlocked((blockedRes.data as ScheduledRow[]) ?? []);
    setRenderFails((renderRes.data as ScheduledRow[]) ?? []);
    setLastRefreshed(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <header className="border-b border-border/40 bg-card/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="container px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-lg font-semibold">Admin · System Health</h1>
              <p className="text-xs text-muted-foreground">
                Last refreshed: {lastRefreshed.toLocaleTimeString()}
              </p>
            </div>
          </div>
          <Button size="sm" onClick={load} disabled={loading} className="gap-1.5">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh Data
          </Button>
        </div>
      </header>

      <main className="container px-4 py-6 space-y-6">
        {/* Panel 1: Recent scheduled posts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Scheduled Posts (last 15)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-muted-foreground text-center">No data</TableCell></TableRow>
                )}
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{short(r.id)}</TableCell>
                    <TableCell>{r.city ?? "—"}</TableCell>
                    <TableCell>{r.slot ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.platform ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColor(r.status)}>
                        {r.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px] truncate text-xs text-red-400" title={r.error_message ?? ""}>
                      {r.error_message ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{fmt(r.scheduled_at)}</TableCell>
                    <TableCell className="text-xs">{fmt(r.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Panel 2: System logs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Logs (last 20)</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {logsError ? (
              <p className="text-sm text-muted-foreground">
                No logs table — will be created in Phase 3.{" "}
                <span className="text-xs opacity-60">({logsError})</span>
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Timestamp</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(logs ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground text-center">No logs</TableCell></TableRow>
                  )}
                  {(logs ?? []).map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs font-medium">{l.type ?? "—"}</TableCell>
                      <TableCell className="max-w-[600px]">
                        <pre className="text-[11px] whitespace-pre-wrap break-all bg-muted/40 rounded p-2 max-h-32 overflow-auto">
{JSON.stringify({ message: l.message, context: l.context }, null, 2)}
                        </pre>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmt(l.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Panel 3: Validation blocks */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Validation Blocks
              <Badge variant="outline" className={blocked.length > 0 ? "bg-red-500/15 text-red-400 border-red-500/30" : ""}>
                {blocked.length} posts blocked by validation
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blocked.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-muted-foreground text-center">No validation blocks</TableCell></TableRow>
                )}
                {blocked.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{short(r.id)}</TableCell>
                    <TableCell>{r.city ?? "—"}</TableCell>
                    <TableCell>{r.slot ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.platform ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColor(r.status)}>{r.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[400px] text-xs text-red-400" title={r.error_message ?? ""}>
                      {r.error_message ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{fmt(r.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Panel 4: Render failures */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Render Failures
              <Badge variant="outline" className={renderFails.length > 0 ? "bg-red-500/15 text-red-400 border-red-500/30" : ""}>
                {renderFails.length} render failures
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Platform</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {renderFails.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-muted-foreground text-center">No render failures</TableCell></TableRow>
                )}
                {renderFails.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{short(r.id)}</TableCell>
                    <TableCell>{r.city ?? "—"}</TableCell>
                    <TableCell>{r.slot ?? "—"}</TableCell>
                    <TableCell className="text-xs">{r.platform ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColor(r.status)}>{r.status ?? "—"}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[400px] text-xs text-red-400" title={r.error_message ?? ""}>
                      {r.error_message ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs">{fmt(r.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

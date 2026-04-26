import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

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

export function SystemHealthCard() {
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [lastRunIso, setLastRunIso] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
          <p className="text-[11px] text-muted-foreground">
            {new Date(lastRunIso).toLocaleString()}
          </p>
        )}
        {!isActive && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            No recent automation run detected. Scheduler runs every 5 minutes — only fires when a slot's local time matches.
          </p>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={fetchHealth}
          disabled={loading}
          className="w-full gap-2"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </CardContent>
    </Card>
  );
}

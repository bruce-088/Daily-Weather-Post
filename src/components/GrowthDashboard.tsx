import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Sparkles, TrendingUp, AlertTriangle, Trophy, Clock, Activity, X, ArrowUpRight,
  ChevronLeft, ChevronRight, Flame,
} from "lucide-react";
import { useActiveCity } from "@/hooks/useActiveCity";

interface HookStat {
  hook_text: string;
  uses: number;
  avg_views: number;
  status: string;
  rank: number;
}

interface SlotStat {
  day_of_week: number;
  hour: number;
  posts: number;
  avg_views: number;
}

interface AlertRow {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  city: string;
  created_at: string;
  suggested_post_id: string | null;
  dismissed: boolean;
}

interface Recommendation {
  recommendation: string;
  top_hooks: string[];
  best_slot: { day_of_week: number; hour: number; avg_views: number } | null;
  variety_score: number;
  recent_tones: string[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Saturday".slice(0, 3)];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmtHour = (h: number) => {
  const p = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${p}`;
};

export function GrowthDashboard() {
  const activeCity = useActiveCity();
  const [hooks, setHooks] = useState<HookStat[]>([]);
  const [slots, setSlots] = useState<SlotStat[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [hooksPage, setHooksPage] = useState(0);
  const HOOKS_PER_PAGE = 8;

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    let alertsQ = supabase.from("trend_alerts")
      .select("id, alert_type, severity, message, city, created_at, suggested_post_id, dismissed")
      .eq("user_id", user.id)
      .eq("dismissed", false)
      .order("created_at", { ascending: false })
      .limit(5);
    if (activeCity.name) alertsQ = alertsQ.ilike("city", activeCity.name);

    const [h, s, a, r] = await Promise.all([
      supabase.from("hook_stats")
        .select("hook_text, uses, avg_views, status, rank")
        .eq("user_id", user.id)
        .order("avg_views", { ascending: false })
        .limit(20),
      supabase.from("time_slot_stats")
        .select("day_of_week, hour, posts, avg_views")
        .eq("user_id", user.id),
      alertsQ,
      supabase.from("growth_recommendations")
        .select("recommendation, top_hooks, best_slot, variety_score, recent_tones")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    setHooks((h.data as any) || []);
    setSlots((s.data as any) || []);
    setAlerts((a.data as any) || []);
    setRec((r.data as any) || null);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCity.name]);

  const dismissAlert = async (id: string) => {
    const { error } = await supabase.from("trend_alerts").update({ dismissed: true }).eq("id", id);
    if (error) { toast.error("Couldn't dismiss alert"); return; }
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  // Build a 7x24 view with max for color scaling
  const slotMap = new Map<string, SlotStat>();
  for (const s of slots) slotMap.set(`${s.day_of_week}|${s.hour}`, s);
  const maxAvg = slots.reduce((m, s) => Math.max(m, s.avg_views || 0), 0);

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading growth dashboard…</Card>;
  }

  return (
    <div className="space-y-4">
      {/* Recommendation header */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles size={14} className="text-primary" />
            AI Recommendation
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary ml-auto">Auto-Growth</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 pb-3">
          <p className="text-sm">{rec?.recommendation || "Keep posting consistently — recommendations appear once we have data."}</p>
          {rec && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Activity size={11} /> Variety score:{" "}
                <span className={`font-semibold ${rec.variety_score < 60 ? "text-amber-400" : "text-emerald-400"}`}>
                  {Math.round(rec.variety_score)}
                </span>
              </span>
              {rec.recent_tones?.length > 0 && (
                <span>Recent tones: {rec.recent_tones.slice(0, 3).join(" → ")}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trend alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle size={14} className="text-amber-400" />
              Trend alerts
            </CardTitle>
            <CardDescription className="text-xs">
              Detected extreme weather. A draft post has been pre-created in Schedule.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs leading-snug">{a.message}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] capitalize">{a.alert_type.replace("_", " ")}</Badge>
                    <Badge variant="outline" className="text-[10px] capitalize">{a.severity}</Badge>
                    <span>{a.city}</span>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 shrink-0"
                  onClick={() => dismissAlert(a.id)}
                  title="Dismiss"
                >
                  <X size={12} />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Top hooks */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy size={14} className="text-primary" /> Top performing hooks
            <Badge variant="outline" className="text-[10px] ml-auto">All cities</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Ranked by average views. Hooks with 10+ uses get classified as Top, Active, or Retired.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {hooks.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No hook data yet. Publish a few posts to start the leaderboard.</p>
          ) : (
            <>
              {hooks
                .slice(hooksPage * HOOKS_PER_PAGE, hooksPage * HOOKS_PER_PAGE + HOOKS_PER_PAGE)
                .map((h) => (
                  <div key={h.hook_text} className="flex items-center gap-3 rounded-md border border-border/40 bg-muted/20 p-2">
                    <div className="text-xs font-mono text-muted-foreground w-6">#{h.rank}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs line-clamp-1">{h.hook_text}</p>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {h.uses} use{h.uses === 1 ? "" : "s"} · avg {Math.round(h.avg_views).toLocaleString()} views
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] capitalize ${
                        h.status === "top" ? "border-emerald-500/40 text-emerald-400" :
                        h.status === "retired" ? "border-red-500/40 text-red-400/80" : ""
                      }`}
                    >
                      {h.status}
                    </Badge>
                  </div>
                ))}
              {hooks.length > HOOKS_PER_PAGE && (
                <div className="flex items-center justify-between pt-2 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">
                    {hooksPage * HOOKS_PER_PAGE + 1}–
                    {Math.min((hooksPage + 1) * HOOKS_PER_PAGE, hooks.length)} of {hooks.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon" variant="ghost" className="h-6 w-6"
                      disabled={hooksPage === 0}
                      onClick={() => setHooksPage((p) => Math.max(0, p - 1))}
                    >
                      <ChevronLeft size={12} />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-6 w-6"
                      disabled={(hooksPage + 1) * HOOKS_PER_PAGE >= hooks.length}
                      onClick={() => setHooksPage((p) => p + 1)}
                    >
                      <ChevronRight size={12} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Time heatmap */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock size={14} className="text-primary" /> Best posting times (heatmap)
          </CardTitle>
          <CardDescription className="text-xs">
            Avg views per day-of-week × hour (UTC). Darker = stronger.
            {rec?.best_slot && (
              <> Your best slot is <strong>{DAY_NAMES_FULL[rec.best_slot.day_of_week]} {fmtHour(rec.best_slot.hour)}</strong>.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {slots.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">Heatmap appears after we have at least 14 days of post data.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-[9px] tabular-nums w-full">
                <thead>
                  <tr>
                    <th className="text-left text-muted-foreground pr-1"></th>
                    {Array.from({ length: 24 }).map((_, h) => (
                      <th key={h} className="text-center text-muted-foreground font-normal w-5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((dn, dow) => (
                    <tr key={dow}>
                      <td className="pr-1.5 text-muted-foreground">{dn}</td>
                      {Array.from({ length: 24 }).map((_, h) => {
                        const slot = slotMap.get(`${dow}|${h}`);
                        const intensity = slot && maxAvg > 0 ? slot.avg_views / maxAvg : 0;
                        const bg = slot
                          ? `hsl(var(--primary) / ${(0.15 + intensity * 0.7).toFixed(2)})`
                          : "transparent";
                        return (
                          <td key={h} className="p-0.5">
                            <div
                              className="aspect-square rounded-sm border border-border/30"
                              style={{ background: bg }}
                              title={slot ? `${dn} ${fmtHour(h)} · ${Math.round(slot.avg_views).toLocaleString()} avg · ${slot.posts} posts` : undefined}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Auto-Winner: Outperforming Posts ────────────────────────────────────
interface RepostSuggestion {
  id: string;
  post_id: string;
  city: string | null;
  reason: string | null;
  suggested_at: string;
  views_24h: number | null;
  city_avg: number | null;
  status: string;
}

export function OutperformingPosts() {
  const [items, setItems] = useState<RepostSuggestion[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase
      .from("winner_repost_suggestions" as any)
      .select("*")
      .eq("status", "pending")
      .order("suggested_at", { ascending: false })
      .limit(10);
    setItems(((data as any[]) || []) as RepostSuggestion[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handle(id: string, status: "dismissed" | "reposted") {
    await supabase.from("winner_repost_suggestions" as any).update({ status }).eq("id", id);
    setItems((prev) => prev.filter((p) => p.id !== id));
  }

  if (loading || items.length === 0) return null;

  return (
    <Card className="border-orange-400/30 bg-gradient-to-br from-orange-400/10 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Flame size={14} className="text-orange-400" />
          Outperforming posts
          <Badge variant="outline" className="text-[10px] border-orange-400/40 text-orange-400 ml-auto">
            {items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pb-3">
        {items.map((it) => (
          <div
            key={it.id}
            className="flex items-center justify-between gap-2 rounded-md border border-border/40 bg-card/50 p-2.5"
          >
            <div className="text-xs flex-1 min-w-0">
              <p className="font-medium text-foreground">
                🔥 {it.city || "Post"} is outperforming
              </p>
              <p className="text-muted-foreground truncate">{it.reason}</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => handle(it.id, "reposted")}
              >
                Repost variation
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => handle(it.id, "dismissed")}
              >
                Dismiss
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

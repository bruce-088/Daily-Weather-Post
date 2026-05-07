import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, TrendingUp, Sparkles, RefreshCw, ExternalLink, Eye, Heart, MessageCircle, Clock } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid,
} from "recharts";
import { toast } from "sonner";
import { useActiveCity } from "@/hooks/useActiveCity";

type PostRow = {
  id: string;
  caption: string | null;
  platform: string | null;
  city: string | null;
  condition: string | null;
  post_url: string | null;
  image_url: string | null;
  created_at: string;
  views_count: number | null;
  likes_count: number | null;
  comment_count: number | null;
  retention_rate: number | null;
  last_synced_at: string | null;
};

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString();

function healthScore(views: number, likes: number) {
  if (!views) return { label: "No data", tone: "muted" as const, ratio: 0 };
  const ratio = likes / views;
  if (ratio >= 0.2) return { label: "Excellent", tone: "excellent" as const, ratio };
  if (ratio >= 0.1) return { label: "Good", tone: "good" as const, ratio };
  return { label: "Building", tone: "muted" as const, ratio };
}

const toneStyles: Record<string, string> = {
  excellent: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  good: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  muted: "bg-muted text-muted-foreground border-border/40",
};

function conditionEmoji(c: string | null) {
  const k = (c || "").toLowerCase();
  if (k.includes("rain") || k.includes("storm") || k.includes("drizzle")) return "🌧️";
  if (k.includes("snow")) return "❄️";
  if (k.includes("cloud")) return "☁️";
  if (k.includes("fog") || k.includes("mist")) return "🌫️";
  if (k.includes("clear") || k.includes("sun")) return "☀️";
  return "🌤️";
}

type TimingWindow = {
  slot: string | null;
  offset: number;
  delta_pct: number;
  base_time: string | null;
  optimized_time: string | null;
};

function addMinutesToHHMM(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  let total = h * 60 + m + mins;
  total = ((total % 1440) + 1440) % 1440;
  const oh = Math.floor(total / 60);
  const om = total % 60;
  const ampm = oh >= 12 ? "PM" : "AM";
  const h12 = ((oh + 11) % 12) + 1;
  return `${h12}:${String(om).padStart(2, "0")} ${ampm}`;
}

export function GrowthInsights() {
  const activeCity = useActiveCity();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [timingWindows, setTimingWindows] = useState<TimingWindow[]>([]);

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    let q = supabase
      .from("post_history")
      .select("id, caption, platform, city, condition, post_url, image_url, created_at, views_count, likes_count, comment_count, retention_rate, last_synced_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (activeCity.name) q = q.ilike("city", activeCity.name);
    const { data } = await q;
    setPosts((data || []) as PostRow[]);

    // ── Optimal Posting Windows: from concluded timing experiments ──
    let expQ = supabase
      .from("experiments")
      .select("id, city, delta_pct, winner_variant, scheduled_time_offset_a, scheduled_time_offset_b, concluded_at")
      .eq("user_id", user.id)
      .eq("test_type", "timing")
      .eq("status", "concluded")
      .order("concluded_at", { ascending: false })
      .limit(20);
    if (activeCity.name) expQ = expQ.ilike("city", activeCity.name);
    const { data: timingExps } = await expQ;

    const { data: autos } = await supabase
      .from("automations")
      .select("city_id, morning_time, afternoon_time, evening_time, cities:city_id(name)")
      .eq("user_id", user.id);
    const automationForCity: any = (autos || []).find((a: any) =>
      activeCity.name && a?.cities?.name?.toLowerCase() === activeCity.name.toLowerCase()
    ) || (autos || [])[0];

    const { data: mem } = await supabase
      .from("ai_memory")
      .select("content, condition, performance_score, created_at")
      .eq("user_id", user.id)
      .eq("memory_type", "timing")
      .order("created_at", { ascending: false })
      .limit(20);

    const windows: TimingWindow[] = [];
    for (const e of (timingExps || []) as any[]) {
      const offset = e.winner_variant === "A" ? (e.scheduled_time_offset_a ?? 0) : (e.scheduled_time_offset_b ?? 0);
      const tag = (mem || []).find((m: any) =>
        String(m.condition || "").toLowerCase().includes((e.city || "").toLowerCase())
      );
      const slot = tag?.condition?.split(":")[1] || null;
      const baseTime: string | null = slot && automationForCity
        ? ((automationForCity[`${slot}_time`] as string | null) || "").slice(0, 5) || null
        : null;
      windows.push({
        slot,
        offset,
        delta_pct: Number(e.delta_pct) || 0,
        base_time: baseTime,
        optimized_time: baseTime ? addMinutesToHHMM(baseTime, offset) : null,
      });
    }
    setTimingWindows(windows);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [activeCity.name]);

  const sync = async () => {
    setSyncing(true);
    const { error } = await supabase.functions.invoke("sync-post-performance");
    if (error) toast.error("Sync failed: " + error.message);
    else { toast.success("Performance synced"); await load(); }
    setSyncing(false);
  };

  const top3 = useMemo(
    () => [...posts].sort((a, b) => (b.views_count ?? 0) - (a.views_count ?? 0)).slice(0, 3),
    [posts],
  );

  // 30-day daily totals
  const trend = useMemo(() => {
    const days: Record<string, number> = {};
    const now = Date.now();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      days[key] = 0;
    }
    for (const p of posts) {
      const key = p.created_at.slice(0, 10);
      if (key in days) days[key] += p.views_count ?? 0;
    }
    return Object.entries(days).map(([date, views]) => ({
      date: date.slice(5),
      views,
    }));
  }, [posts]);

  // Condition affinity
  const affinity = useMemo(() => {
    const buckets: Record<string, { views: number; eng: number; n: number }> = {};
    for (const p of posts) {
      if (!p.condition || !p.views_count) continue;
      const k = (p.condition || "Other").toLowerCase();
      const key = k.includes("rain") || k.includes("storm") ? "Rainy"
        : k.includes("snow") ? "Snowy"
        : k.includes("cloud") ? "Cloudy"
        : k.includes("clear") || k.includes("sun") ? "Sunny"
        : "Other";
      if (!buckets[key]) buckets[key] = { views: 0, eng: 0, n: 0 };
      buckets[key].views += p.views_count ?? 0;
      buckets[key].eng += (p.likes_count ?? 0) + (p.comment_count ?? 0);
      buckets[key].n += 1;
    }
    const rows = Object.entries(buckets).map(([cond, v]) => ({
      cond,
      avgViews: v.n ? v.views / v.n : 0,
      engRate: v.views ? v.eng / v.views : 0,
      n: v.n,
    })).filter(r => r.n >= 1).sort((a, b) => b.engRate - a.engRate);

    let insight: string | null = null;
    if (rows.length >= 2) {
      const best = rows[0];
      const worst = rows[rows.length - 1];
      if (best.engRate > 0 && worst.engRate > 0) {
        const lift = ((best.engRate - worst.engRate) / worst.engRate) * 100;
        const bestEmoji = conditionEmoji(best.cond);
        const worstEmoji = conditionEmoji(worst.cond);
        insight = `Videos posted during ${bestEmoji} ${best.cond} conditions get ${Math.round(lift)}% more engagement than ${worstEmoji} ${worst.cond} days.`;
      }
    }
    return { rows, insight };
  }, [posts]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Growth Insights{activeCity.name ? ` · ${activeCity.name}` : ""}
          </h3>
          <p className="text-xs text-muted-foreground">
            {activeCity.name
              ? `Live performance of posts published for ${activeCity.name}.`
              : "Live performance of your published content."}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={sync} disabled={syncing}>
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync now"}
        </Button>
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-400" /> Performance Leaderboard
          </CardTitle>
          <CardDescription>Top 3 posts of all time by views</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : top3.length === 0 || (top3[0].views_count ?? 0) === 0 ? (
            <div className="text-sm text-muted-foreground">
              No view data yet. Click <strong>Sync now</strong> after your posts have been live for a while.
            </div>
          ) : (
            <ol className="space-y-2">
              {top3.map((p, i) => {
                const score = healthScore(p.views_count ?? 0, p.likes_count ?? 0);
                return (
                  <li key={p.id} className="flex items-center gap-3 p-3 rounded-md border border-border/40 bg-card/40">
                    <div className="text-xl font-bold w-6 text-center">{["🥇","🥈","🥉"][i]}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline" className="text-[10px] uppercase">{p.platform || "—"}</Badge>
                        <span>{p.city}</span>
                        <span>·</span>
                        <span>{conditionEmoji(p.condition)} {p.condition}</span>
                      </div>
                      <div className="text-sm font-medium truncate mt-0.5">
                        {p.caption?.split("\n")[0] || "Untitled post"}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{fmt(p.views_count)}</span>
                        <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{fmt(p.likes_count)}</span>
                        <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{fmt(p.comment_count)}</span>
                      </div>
                    </div>
                    <div className="text-right space-y-1">
                      <Badge className={`border ${toneStyles[score.tone]}`}>{score.label}</Badge>
                      <div className="text-[10px] text-muted-foreground">
                        {(score.ratio * 100).toFixed(1)}% like-rate
                      </div>
                      {p.post_url && (
                        <a href={p.post_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
                          Open <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Trend chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-sky-400" /> Views over the last 30 days
          </CardTitle>
        </CardHeader>
        <CardContent className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 6, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.4)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <RTooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="views" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Condition affinity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" /> Condition Affinity
          </CardTitle>
          <CardDescription>How weather conditions impact engagement</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {affinity.insight && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              💡 {affinity.insight}
            </div>
          )}
          {affinity.rows.length === 0 ? (
            <div className="text-sm text-muted-foreground">Not enough synced data yet.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {affinity.rows.map(r => (
                <div key={r.cond} className="p-3 rounded-md border border-border/40 bg-card/40">
                  <div className="text-xs text-muted-foreground">{conditionEmoji(r.cond)} {r.cond}</div>
                  <div className="text-lg font-semibold mt-0.5">{(r.engRate * 100).toFixed(1)}%</div>
                  <div className="text-[10px] text-muted-foreground">
                    avg {fmt(Math.round(r.avgViews))} views · {r.n} post{r.n === 1 ? "" : "s"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

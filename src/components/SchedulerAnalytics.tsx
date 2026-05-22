import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { Youtube, Twitter, Linkedin, Music2, Instagram, ExternalLink } from "lucide-react";

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "hsl(0 84% 55%)",
  twitter: "hsl(203 89% 53%)",
  x: "hsl(203 89% 53%)",
  tiktok: "hsl(0 0% 12%)",
  linkedin: "hsl(214 70% 30%)",
  instagram: "hsl(330 70% 55%)",
};

const SUCCESS_COLOR = "hsl(142 71% 45%)";
const FAIL_COLOR = "hsl(0 84% 60%)";

function PlatformIcon({ platform }: { platform: string }) {
  const p = (platform || "").toLowerCase();
  const cls = "h-3.5 w-3.5";
  if (p.includes("youtube")) return <Youtube className={cls} style={{ color: PLATFORM_COLORS.youtube }} />;
  if (p.includes("tiktok")) return <Music2 className={cls} />;
  if (p.includes("twitter") || p === "x") return <Twitter className={cls} style={{ color: PLATFORM_COLORS.twitter }} />;
  if (p.includes("linkedin")) return <Linkedin className={cls} style={{ color: PLATFORM_COLORS.linkedin }} />;
  if (p.includes("instagram")) return <Instagram className={cls} style={{ color: PLATFORM_COLORS.instagram }} />;
  return null;
}

type SchedRow = {
  id: string;
  status: string;
  platform: string | null;
  city: string | null;
  slot: string | null;
  source: string | null;
  scheduled_at: string;
};

type HistRow = {
  id: string;
  city: string;
  platform: string | null;
  slot: string | null;
  status: string;
  post_url: string | null;
  created_at: string;
};

export function SchedulerAnalytics() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SchedRow[]>([]);
  const [recent, setRecent] = useState<HistRow[]>([]);
  const [activeSlots, setActiveSlots] = useState(0);
  const [lastAutoCron, setLastAutoCron] = useState<string | null>(null);
  const [nextPost, setNextPost] = useState<SchedRow | null>(null);

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const sinceIso = new Date(Date.now() - 14 * 86400_000).toISOString();

    const [
      { data: schedAll },
      { data: settings },
      { data: lastCron },
      { data: nextRows },
      { data: history },
    ] = await Promise.all([
      supabase
        .from("scheduled_posts")
        .select("id,status,platform,city,slot,source,scheduled_at")
        .eq("user_id", user.id)
        .gte("scheduled_at", sinceIso)
        .order("scheduled_at", { ascending: false })
        .limit(1000),
      supabase
        .from("weather_settings")
        .select("auto_post_morning,auto_post_afternoon,auto_post_evening")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("scheduled_posts")
        .select("scheduled_at")
        .eq("user_id", user.id)
        .eq("source", "auto_cron")
        .eq("status", "posted")
        .order("scheduled_at", { ascending: false })
        .limit(1),
      supabase
        .from("scheduled_posts")
        .select("id,status,platform,city,slot,source,scheduled_at")
        .eq("user_id", user.id)
        .eq("status", "pending")
        .gt("scheduled_at", new Date().toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(1),
      supabase
        .from("post_history")
        .select("id,city,platform,slot,status,post_url,created_at")
        .eq("user_id", user.id)
        .eq("status", "posted")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    setRows(schedAll ?? []);
    setRecent((history ?? []) as HistRow[]);
    setActiveSlots(
      settings
        ? [settings.auto_post_morning, settings.auto_post_afternoon, settings.auto_post_evening].filter(Boolean).length
        : 0,
    );
    setLastAutoCron(lastCron?.[0]?.scheduled_at ?? null);
    setNextPost((nextRows?.[0] as SchedRow) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  // Also fetch total all-time posted count separately (rows is 14d-bounded for charts)
  const [totalPosted, setTotalPosted] = useState(0);
  const [totalAll, setTotalAll] = useState(0);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const [{ count: posted }, { count: all }] = await Promise.all([
        supabase.from("scheduled_posts").select("id", { count: "exact", head: true })
          .eq("user_id", user.id).eq("status", "posted"),
        supabase.from("scheduled_posts").select("id", { count: "exact", head: true })
          .eq("user_id", user.id),
      ]);
      setTotalPosted(posted ?? 0);
      setTotalAll(all ?? 0);
    })();
  }, []);

  const successRate = totalAll > 0 ? Math.round((totalPosted / totalAll) * 100) : 0;

  const platformData = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((r) => {
      const raw = (r.platform || "unknown").toLowerCase();
      const platforms = raw.includes(",") ? raw.split(",") : [raw];
      platforms.forEach((p) => {
        const key = p.trim();
        if (!key) return;
        map.set(key, (map.get(key) ?? 0) + 1);
      });
    });
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [rows]);

  const dailyData = useMemo(() => {
    const buckets: Record<string, { date: string; successful: number; failed: number }> = {};
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { date: key.slice(5), successful: 0, failed: 0 };
    }
    rows.forEach((r) => {
      const key = r.scheduled_at.slice(0, 10);
      if (!buckets[key]) return;
      if (r.status === "posted") buckets[key].successful++;
      else if (r.status === "failed") buckets[key].failed++;
    });
    return Object.values(buckets);
  }, [rows]);

  const pulse = useMemo(() => {
    if (!lastAutoCron) return { color: "bg-red-500", label: "No auto activity", ts: null as string | null };
    const ageH = (Date.now() - new Date(lastAutoCron).getTime()) / 3600_000;
    if (ageH < 6) return { color: "bg-green-500", label: "Healthy", ts: lastAutoCron };
    if (ageH < 12) return { color: "bg-yellow-500", label: "Degraded", ts: lastAutoCron };
    return { color: "bg-red-500", label: "Stalled", ts: lastAutoCron };
  }, [lastAutoCron]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">Scheduler Health</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Live from <code className="font-mono text-[10px]">scheduled_posts</code>
            {pulse.ts && <> · Last auto post {formatDistanceToNow(new Date(pulse.ts), { addSuffix: true })}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${pulse.color} shadow-[0_0_8px_currentColor]`} />
          <span className="text-xs text-muted-foreground">{pulse.label}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="Total Posts Sent" value={loading ? "—" : totalPosted.toLocaleString()} />
          <StatCard label="Success Rate" value={loading ? "—" : `${successRate}%`} />
          <StatCard label="Active Automations" value={loading ? "—" : `${activeSlots} / 3`} />
          <StatCard
            label="Next Scheduled"
            value={
              nextPost
                ? formatDistanceToNow(new Date(nextPost.scheduled_at), { addSuffix: true })
                : "None"
            }
            sub={nextPost ? `${nextPost.city ?? ""} · ${nextPost.platform ?? ""}` : undefined}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-md border border-white/5 p-3">
            <p className="text-xs text-muted-foreground mb-2">Platform Breakdown (14d)</p>
            <div className="h-48">
              {platformData.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={platformData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                      {platformData.map((d) => (
                        <Cell key={d.name} fill={PLATFORM_COLORS[d.name] ?? "hsl(var(--muted-foreground))"} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="rounded-md border border-white/5 p-3">
            <p className="text-xs text-muted-foreground mb-2">Daily Volume (14d)</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="successful" stroke={SUCCESS_COLOR} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="failed" stroke={FAIL_COLOR} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Recent feed */}
        <div className="rounded-md border border-white/5">
          <div className="px-3 py-2 border-b border-white/5">
            <p className="text-xs text-muted-foreground">Recent Posts</p>
          </div>
          {recent.length === 0 ? (
            <p className="px-3 py-4 text-xs text-muted-foreground">No posts yet.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {recent.map((r) => {
                const inner = (
                  <div className="flex items-center justify-between px-3 py-2 text-sm hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <PlatformIcon platform={r.platform ?? ""} />
                      <span className="font-medium truncate">{r.city}</span>
                      {r.slot && <Badge variant="outline" className="text-[10px] py-0 h-4">{r.slot}</Badge>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                      </span>
                      <Badge variant="secondary" className="text-[10px] py-0 h-4">posted</Badge>
                      {r.post_url && <ExternalLink className="h-3 w-3 text-muted-foreground" />}
                    </div>
                  </div>
                );
                return (
                  <li key={r.id}>
                    {r.post_url ? (
                      <a href={r.post_url} target="_blank" rel="noopener noreferrer">{inner}</a>
                    ) : inner}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-white/5 bg-card/30 p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold font-mono text-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground truncate mt-0.5">{sub}</p>}
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
      No data yet
    </div>
  );
}

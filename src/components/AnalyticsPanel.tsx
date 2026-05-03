import React, { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TrendingUp,
  Eye,
  Heart,
  MessageCircle,
  Sparkles,
  Clock,
  Trophy,
  BarChart3,
  RefreshCw,
  Film,
  Flame,
  Mic,
  ExternalLink,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
} from "recharts";
import { toast } from "sonner";

type AnalyticsRow = {
  id: string;
  post_id: string | null;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  external_id: string | null;
  fetched_at: string;
};

type HookRow = {
  id: string;
  post_id: string | null;
  hook_text: string | null;
  tone: string | null;
  platform: string | null;
  created_at: string;
};

type PostRow = {
  id: string;
  caption: string | null;
  platform: string | null;
  city: string | null;
  condition: string | null;
  external_id: string | null;
  post_url: string | null;
  image_url: string | null;
  created_at: string;
};

type ScheduledRow = {
  id: string;
  include_voiceover: boolean | null;
  voiceover_url: string | null;
  caption: string | null;
  city: string | null;
  scheduled_at: string;
};

const score = (a: AnalyticsRow) =>
  (a.views || 0) + (a.likes || 0) * 3 + (a.comments || 0) * 5 + (a.shares || 0) * 4;

const isYouTube = (p: { platform?: string | null; post_url?: string | null }) =>
  (p.platform || "").toLowerCase().includes("youtube") ||
  (p.post_url || "").toLowerCase().includes("youtube.com");

const ytThumb = (videoId: string | null | undefined) =>
  videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;

const fmt = (n: number) => (n || 0).toLocaleString();

export function AnalyticsPanel() {
  const [analytics, setAnalytics] = useState<AnalyticsRow[]>([]);
  const [hooks, setHooks] = useState<HookRow[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const [a, h, p, s] = await Promise.all([
      supabase.from("post_analytics").select("*").eq("user_id", user.id).order("fetched_at", { ascending: false }).limit(1000),
      supabase.from("post_hooks").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
      supabase.from("post_history").select("id, caption, platform, city, condition, external_id, post_url, image_url, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
      supabase.from("scheduled_posts").select("id, include_voiceover, voiceover_url, caption, city, scheduled_at").eq("user_id", user.id).order("scheduled_at", { ascending: false }).limit(500),
    ]);

    setAnalytics((a.data as AnalyticsRow[]) ?? []);
    setHooks((h.data as HookRow[]) ?? []);
    setPosts((p.data as PostRow[]) ?? []);
    setScheduled((s.data as ScheduledRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase.functions.invoke("sync-youtube-metrics", {
        body: { user_id: user?.id },
      });
      if (error) throw error;
      const processed = data?.processed ?? 0;
      const updated = data?.updated ?? 0;
      const inserted = data?.inserted ?? 0;
      toast.success(`Synced ${processed} YouTube post${processed === 1 ? "" : "s"} (${updated + inserted} updated)`);
      await load();
    } catch (e: any) {
      toast.error(`Sync failed: ${e?.message || e}`);
    } finally {
      setSyncing(false);
    }
  };

  // Latest analytics row per post
  const latestByPost = useMemo(() => {
    const map = new Map<string, AnalyticsRow>();
    for (const row of analytics) {
      if (!row.post_id) continue;
      if (!map.has(row.post_id)) map.set(row.post_id, row);
    }
    return map;
  }, [analytics]);

  const ytPosts = useMemo(() => posts.filter(isYouTube), [posts]);

  // Helper: voiceover info for a given post (matched by city + nearest scheduled time, fallback to caption snippet)
  const voiceoverByPostId = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const post of posts) {
      const created = new Date(post.created_at).getTime();
      // Find a scheduled row in same city within ±6h with voiceover info
      const candidates = scheduled.filter(
        (s) =>
          (s.city || "").toLowerCase() === (post.city || "").toLowerCase() &&
          Math.abs(new Date(s.scheduled_at).getTime() - created) < 6 * 60 * 60 * 1000,
      );
      if (candidates.length === 0) {
        map.set(post.id, false);
        continue;
      }
      candidates.sort(
        (x, y) =>
          Math.abs(new Date(x.scheduled_at).getTime() - created) -
          Math.abs(new Date(y.scheduled_at).getTime() - created),
      );
      const match = candidates[0];
      map.set(post.id, !!(match.include_voiceover || match.voiceover_url));
    }
    return map;
  }, [posts, scheduled]);

  // Overview metrics (YouTube only — that's where real numbers come from)
  const overview = useMemo(() => {
    let totalViews = 0;
    let viewsToday = 0;
    let totalLikes = 0;
    let bestPost: { post: PostRow; views: number } | null = null;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    for (const post of ytPosts) {
      const a = latestByPost.get(post.id);
      const v = a?.views ?? 0;
      const l = a?.likes ?? 0;
      totalViews += v;
      totalLikes += l;
      if (new Date(post.created_at) >= startOfToday) viewsToday += v;
      if (!bestPost || v > bestPost.views) bestPost = { post, views: v };
    }

    const totalPosts = ytPosts.length;
    const avgViews = totalPosts > 0 ? Math.round(totalViews / totalPosts) : 0;

    return { totalViews, viewsToday, totalLikes, totalPosts, bestPost, avgViews };
  }, [ytPosts, latestByPost]);

  // 7-day chart data: one point per post (date + views)
  const chartData = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const points = ytPosts
      .filter((p) => new Date(p.created_at).getTime() >= cutoff)
      .map((p) => {
        const d = new Date(p.created_at);
        return {
          date: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          ts: d.getTime(),
          views: latestByPost.get(p.id)?.views ?? 0,
        };
      })
      .sort((a, b) => a.ts - b.ts);
    return points;
  }, [ytPosts, latestByPost]);

  // Existing tone insight (kept for value)
  const toneInsight = useMemo(() => {
    if (analytics.length === 0 || hooks.length === 0) return null;
    const byTone = new Map<string, { score: number; n: number }>();
    for (const a of analytics) {
      const hook = hooks.find((h) => h.post_id === a.post_id);
      const tone = hook?.tone || "unspecified";
      const cur = byTone.get(tone) ?? { score: 0, n: 0 };
      cur.score += score(a);
      cur.n += 1;
      byTone.set(tone, cur);
    }
    const arr = Array.from(byTone.entries())
      .filter(([t]) => t !== "unspecified")
      .map(([tone, v]) => ({ tone, avg: v.score / v.n, n: v.n }))
      .sort((a, b) => b.avg - a.avg);
    if (arr.length < 2) return null;
    const top = arr[0];
    const baseline = arr.slice(1).reduce((s, x) => s + x.avg, 0) / (arr.length - 1);
    if (baseline === 0) return null;
    const lift = Math.round(((top.avg - baseline) / baseline) * 100);
    if (lift <= 0) return null;
    return { tone: top.tone, lift };
  }, [analytics, hooks]);

  const toneByPost = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const h of hooks) if (h.post_id) map.set(h.post_id, h.tone || null);
    return map;
  }, [hooks]);

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading analytics…</Card>;
  }

  if (ytPosts.length === 0) {
    return (
      <Card className="p-8 text-center">
        <BarChart3 className="mx-auto mb-3 text-muted-foreground" size={32} />
        <h3 className="font-display text-lg mb-1">No YouTube posts yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-4">
          Once your Shorts are live, view counts, likes and comments will appear here automatically.
        </p>
        <Button onClick={handleSyncNow} disabled={syncing} size="sm" variant="outline">
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          Sync Now
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + Sync Now */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-base">YouTube performance</h3>
          <p className="text-xs text-muted-foreground">Auto-syncs every 6h · last refreshed {new Date(analytics[0]?.fetched_at ?? Date.now()).toLocaleString()}</p>
        </div>
        <Button onClick={handleSyncNow} disabled={syncing} size="sm" variant="outline">
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing…" : "Sync Now"}
        </Button>
      </div>

      {/* Overview cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-3">
        <OverviewCard icon={<Eye size={14} />} label="Total Views" value={fmt(overview.totalViews)} />
        <OverviewCard icon={<TrendingUp size={14} />} label="Views Today" value={fmt(overview.viewsToday)} />
        <OverviewCard icon={<Heart size={14} />} label="Total Likes" value={fmt(overview.totalLikes)} />
        <OverviewCard icon={<Film size={14} />} label="Posts Published" value={fmt(overview.totalPosts)} />
        <OverviewCard icon={<BarChart3 size={14} />} label="Avg Views / Post" value={fmt(overview.avgViews)} />
        <OverviewCard
          icon={<Flame size={14} />}
          label="Best Performing"
          value={overview.bestPost ? fmt(overview.bestPost.views) : "—"}
          sub={overview.bestPost?.post.caption?.slice(0, 40) || overview.bestPost?.post.city || ""}
        />
      </div>

      {/* Insight (kept) */}
      {toneInsight && (
        <Card className="p-4 border-primary/30 bg-primary/5">
          <div className="flex items-center gap-2 mb-1 text-primary">
            <Sparkles size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">Insight</span>
          </div>
          <p className="text-sm">
            🔥 <span className="capitalize font-semibold">{toneInsight.tone}</span> tone performs{" "}
            <span className="font-semibold">{toneInsight.lift}%</span> better
          </p>
        </Card>
      )}

      {/* 7-day views chart */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-muted-foreground" />
          <h3 className="font-display text-sm uppercase tracking-wider">Views — last 7 days</h3>
        </div>
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts in the last 7 days.</p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} allowDecimals={false} />
                <RTooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="views"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "hsl(var(--primary))" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Per-post breakdown */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={16} className="text-muted-foreground" />
          <h3 className="font-display text-sm uppercase tracking-wider">Per-post breakdown</h3>
        </div>
        <ScrollFadeContainer className="max-h-[28rem] rounded-md border border-border/30">
          <Table className="min-w-[860px]">
            <TableHeader className="sticky top-0 z-10 bg-card [&_th]:bg-card [&_tr]:border-b [&_tr]:border-border/50">
              <TableRow>
                <TableHead className="w-20">Video</TableHead>
                <TableHead>Posted</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Likes</TableHead>
                <TableHead className="text-right">Comments</TableHead>
                <TableHead>Weather</TableHead>
                <TableHead>Tone</TableHead>
                <TableHead className="text-center">VO</TableHead>
                <TableHead className="text-right">Link</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ytPosts.map((post) => {
                const a = latestByPost.get(post.id);
                const thumb = ytThumb(post.external_id);
                const tone = toneByPost.get(post.id);
                const hasVO = voiceoverByPostId.get(post.id) ?? false;
                return (
                  <TableRow key={post.id}>
                    <TableCell>
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          className="w-16 h-9 object-cover rounded border border-border/50"
                        />
                      ) : (
                        <div className="w-16 h-9 bg-muted rounded" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {new Date(post.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(a?.views ?? 0)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(a?.likes ?? 0)}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{fmt(a?.comments ?? 0)}</TableCell>
                    <TableCell className="text-xs capitalize">{post.condition || "—"}</TableCell>
                    <TableCell className="text-xs capitalize">
                      {tone ? <Badge variant="outline" className="text-[10px]">{tone}</Badge> : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {hasVO ? (
                        <Mic size={14} className="inline text-primary" />
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {post.post_url && (
                        <a
                          href={post.post_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <ExternalLink size={12} />
                          View
                        </a>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollFadeContainer>
      </Card>
    </div>
  );
}

function ScrollFadeContainer({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 4);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  return (
    <div className="relative">
      <div ref={ref} className={`overflow-x-scroll overflow-y-auto always-scrollbar ${className ?? ""}`} onScroll={update}>
        {children}
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent transition-opacity duration-200"
        style={{ opacity: showLeft ? 1 : 0 }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent transition-opacity duration-200"
        style={{ opacity: showRight ? 1 : 0 }}
      />
    </div>
  );
}

function OverviewCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="font-mono text-xl text-foreground">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</p>}
    </Card>
  );
}

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Eye, Heart, MessageCircle, Sparkles, Clock, Trophy, BarChart3 } from "lucide-react";

type AnalyticsRow = {
  id: string;
  post_id: string | null;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
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
  created_at: string;
};

const score = (a: AnalyticsRow) =>
  (a.views || 0) + (a.likes || 0) * 3 + (a.comments || 0) * 5 + (a.shares || 0) * 4;

export function AnalyticsPanel() {
  const [analytics, setAnalytics] = useState<AnalyticsRow[]>([]);
  const [hooks, setHooks] = useState<HookRow[]>([]);
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const [a, h, p] = await Promise.all([
        supabase.from("post_analytics").select("*").eq("user_id", user.id).order("fetched_at", { ascending: false }).limit(500),
        supabase.from("post_hooks").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
        supabase.from("post_history").select("id, caption, platform, city, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(500),
      ]);

      if (cancelled) return;
      setAnalytics((a.data as AnalyticsRow[]) ?? []);
      setHooks((h.data as HookRow[]) ?? []);
      setPosts((p.data as PostRow[]) ?? []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const top = useMemo(() => {
    const byPost = new Map<string, AnalyticsRow>();
    // Group by post_id and keep the latest analytics record for each post
    for (const row of analytics) {
      if (!row.post_id) continue;
      if (!byPost.has(row.post_id)) {
        byPost.set(row.post_id, row);
      }
    }
    const ranked = Array.from(byPost.values()).sort((x, y) => score(y) - score(x)).slice(0, 5);
    return ranked.map(r => ({ ...r, post: posts.find(p => p.id === r.post_id) }));
  }, [analytics, posts]);

  const avgByPlatform = useMemo(() => {
    const map = new Map<string, { views: number; n: number }>();
    for (const a of analytics) {
      const k = a.platform || "unknown";
      const cur = map.get(k) ?? { views: 0, n: 0 };
      cur.views += a.views || 0;
      cur.n += 1;
      map.set(k, cur);
    }
    return Array.from(map.entries())
      .map(([platform, v]) => ({ platform, avg: Math.round(v.views / Math.max(v.n, 1)), n: v.n }))
      .sort((a, b) => b.avg - a.avg);
  }, [analytics]);

  const bestHour = useMemo(() => {
    if (analytics.length === 0) return null;
    const buckets = new Map<number, { score: number; n: number }>();
    for (const a of analytics) {
      const post = posts.find(p => p.id === a.post_id);
      const ts = post?.created_at ?? a.fetched_at;
      const hour = new Date(ts).getHours();
      const cur = buckets.get(hour) ?? { score: 0, n: 0 };
      cur.score += score(a);
      cur.n += 1;
      buckets.set(hour, cur);
    }
    let best: { hour: number; avg: number } | null = null;
    for (const [hour, v] of buckets) {
      const avg = v.score / v.n;
      if (!best || avg > best.avg) best = { hour, avg };
    }
    return best;
  }, [analytics, posts]);

  const toneInsight = useMemo(() => {
    if (analytics.length === 0 || hooks.length === 0) return null;
    const byTone = new Map<string, { score: number; n: number }>();
    for (const a of analytics) {
      const hook = hooks.find(h => h.post_id === a.post_id);
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

  const formatHour = (h: number) => {
    const period = h >= 12 ? "PM" : "AM";
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}${period}`;
  };

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading analytics…</Card>;
  }

  if (analytics.length === 0) {
    return (
      <Card className="p-8 text-center">
        <BarChart3 className="mx-auto mb-3 text-muted-foreground" size={32} />
        <h3 className="font-display text-lg mb-1">No analytics yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Once your posts are live, performance data will appear here so you can see what's working.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Insights */}
      <div className="grid gap-4 md:grid-cols-2">
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
        {bestHour && (
          <Card className="p-4 border-primary/30 bg-primary/5">
            <div className="flex items-center gap-2 mb-1 text-primary">
              <Clock size={16} />
              <span className="text-xs font-medium uppercase tracking-wider">Insight</span>
            </div>
            <p className="text-sm">
              ⏰ <span className="font-semibold">{formatHour(bestHour.hour)}</span> posts get the highest engagement
            </p>
          </Card>
        )}
      </div>

      {/* Avg by platform */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-muted-foreground" />
          <h3 className="font-display text-sm uppercase tracking-wider">Average views by platform</h3>
        </div>
        {avgByPlatform.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data.</p>
        ) : (
          <div className="space-y-2">
            {avgByPlatform.map(p => (
              <div key={p.platform} className="flex items-center justify-between text-sm">
                <span className="capitalize">{p.platform}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-foreground">{p.avg.toLocaleString()}</span>
                  <Badge variant="outline" className="text-[10px]">{p.n} posts</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Top posts */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Trophy size={16} className="text-muted-foreground" />
          <h3 className="font-display text-sm uppercase tracking-wider">Top performing posts</h3>
        </div>
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ranked posts yet.</p>
        ) : (
          <div className="space-y-3">
            {top.map((row, i) => (
              <div key={row.id} className="flex items-start gap-3 p-3 rounded-md bg-secondary/30 border border-border/30">
                <div className="text-lg font-mono text-muted-foreground w-6">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-2">{row.post?.caption || "—"}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] capitalize">{row.platform}</Badge>
                    <span className="flex items-center gap-1"><Eye size={12} />{row.views.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><Heart size={12} />{row.likes.toLocaleString()}</span>
                    <span className="flex items-center gap-1"><MessageCircle size={12} />{row.comments.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

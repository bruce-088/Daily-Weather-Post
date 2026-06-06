import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useActiveCity } from "@/hooks/useActiveCity";
import { Sparkles, Search, TrendingUp, Tag, Flame, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Row {
  id: string;
  post_id: string | null;
  city: string | null;
  views: number;
  seo_score: number | null;
  trending_score: number | null;
  keywords_organic: string[] | null;
  tags_used: string[] | null;
  tags_recommended: string[] | null;
  analytics_last_synced: string | null;
  external_id: string | null;
}

interface HistoryRow { id: string; caption: string | null; created_at: string }

export function SEOInsightsPanel() {
  const { user } = useAuth();
  const activeCity = useActiveCity();
  const [rows, setRows] = useState<Row[]>([]);
  const [titles, setTitles] = useState<Map<string, HistoryRow>>(new Map());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    if (!user?.id) return;
    let q = supabase
      .from("post_analytics")
      .select(
        "id, post_id, city, views, seo_score, trending_score, keywords_organic, tags_used, tags_recommended, analytics_last_synced, external_id",
      )
      .eq("user_id", user.id)
      .eq("platform", "youtube")
      .order("seo_score", { ascending: false, nullsFirst: false })
      .limit(200);
    if (activeCity.name) q = q.eq("city", activeCity.name);
    const { data } = await q;
    const list = (data || []) as Row[];
    setRows(list);

    const ids = list.map((r) => r.post_id).filter(Boolean) as string[];
    if (ids.length) {
      const { data: ph } = await supabase
        .from("post_history")
        .select("id, caption, created_at")
        .in("id", ids);
      const m = new Map<string, HistoryRow>();
      for (const r of (ph || [])) m.set(r.id, r as HistoryRow);
      setTitles(m);
    }
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    load();
  }, [user?.id, activeCity.name]);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    const toastId = toast.loading("Syncing YouTube analytics… (1/3)");

    // Hard safety cap so the spinner can never hang forever, even if an
    // edge function exceeds the gateway timeout or never responds.
    const SYNC_TIMEOUT_MS = 120_000;
    const timeout = <T,>(p: Promise<T>, label: string) =>
      Promise.race<T>([
        p,
        new Promise<T>((_, rej) =>
          setTimeout(() => rej(new Error(`${label} timed out after 120s`)), SYNC_TIMEOUT_MS),
        ),
      ]);

    try {
      const a = await timeout(
        supabase.functions.invoke("sync-youtube-analytics", { body: {} }),
        "sync-youtube-analytics",
      );
      if (a.error) throw a.error;

      toast.loading("Computing SEO scores… (2/3)", { id: toastId });
      const b = await timeout(
        supabase.functions.invoke("compute-seo-scores", { body: {} }),
        "compute-seo-scores",
      );
      if (b.error) throw b.error;

      toast.loading("Generating tag recommendations… (3/3)", { id: toastId });
      const c = await timeout(
        supabase.functions.invoke("generate-tag-recommendations", { body: {} }),
        "generate-tag-recommendations",
      );
      if (c.error) throw c.error;

      const synced = (a.data as any)?.updated ?? (a.data as any)?.synced ?? "all";
      toast.success(`YouTube SEO refreshed (${synced} videos)`, { id: toastId });
      await load();
    } catch (e: any) {
      console.error("[SEOInsightsPanel] sync failed:", e);
      toast.error(e?.message || "Sync failed", { id: toastId });
    } finally {
      setSyncing(false);
    }
  }

  // ----- derived insights -----
  const distribution = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0]; // 0-20,20-40,...
    let scored = 0;
    for (const r of rows) {
      if (r.seo_score == null) continue;
      scored++;
      const idx = Math.min(4, Math.floor(Number(r.seo_score) / 20));
      buckets[idx]++;
    }
    return { buckets, scored };
  }, [rows]);

  const keywordAgg = useMemo(() => {
    const map = new Map<string, { uses: number; totalViews: number }>();
    for (const r of rows) {
      const kws = r.keywords_organic || [];
      for (const k of kws) {
        const key = k.toLowerCase().trim();
        if (!key) continue;
        const cur = map.get(key) ?? { uses: 0, totalViews: 0 };
        cur.uses++;
        cur.totalViews += Number(r.views) || 0;
        map.set(key, cur);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].totalViews - a[1].totalViews)
      .slice(0, 20);
  }, [rows]);

  const recommendedTags = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      for (const t of (r.tags_recommended || [])) {
        const k = t.toLowerCase();
        m.set(k, (m.get(k) ?? 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([t]) => t);
  }, [rows]);

  const trending = useMemo(() => {
    return [...rows]
      .filter((r) => r.trending_score != null)
      .sort((a, b) => Number(b.trending_score) - Number(a.trending_score))
      .slice(0, 5);
  }, [rows]);

  const top5 = useMemo(
    () =>
      [...rows]
        .filter((r) => r.seo_score != null)
        .sort((a, b) => Number(b.seo_score) - Number(a.seo_score))
        .slice(0, 5),
    [rows],
  );
  const bottom5 = useMemo(
    () =>
      [...rows]
        .filter((r) => r.seo_score != null)
        .sort((a, b) => Number(a.seo_score) - Number(b.seo_score))
        .slice(0, 5),
    [rows],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return rows.slice(0, 25);
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const t = titles.get(r.post_id || "")?.caption?.toLowerCase() || "";
      return t.includes(q) || (r.external_id || "").toLowerCase().includes(q);
    }).slice(0, 25);
  }, [rows, search, titles]);

  if (loading) return null;

  if (rows.length === 0) {
    return (
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            YouTube SEO Insights
          </CardTitle>
          <CardDescription className="text-xs">
            No enriched analytics yet. Sync to fetch retention, organic keywords, and tag data from YouTube.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw size={12} className={syncing ? "animate-spin mr-1" : "mr-1"} />
            Sync YouTube Analytics
          </Button>
        </CardContent>
      </Card>
    );
  }

  const maxBucket = Math.max(...distribution.buckets, 1);

  return (
    <div className="space-y-4">
      {/* Header + sync */}
      <Card className="border-border/60 bg-gradient-to-br from-card/90 to-card/60 backdrop-blur">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles size={16} className="text-primary" />
                YouTube SEO Insights
                <Badge variant="outline" className="text-[10px]">
                  {distribution.scored} scored
                </Badge>
                {activeCity.name && (
                  <Badge variant="outline" className="text-[10px]">{activeCity.name}</Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs">
                Self-computed SEO + real organic keywords + ML tag recommendations.
              </CardDescription>
            </div>
            <Button size="sm" variant="ghost" onClick={handleSync} disabled={syncing} className="h-7 text-xs">
              <RefreshCw size={12} className={syncing ? "animate-spin mr-1" : "mr-1"} />
              Sync
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Score distribution */}
          <div>
            <div className="text-[11px] text-muted-foreground mb-1.5">SEO Score Distribution</div>
            <div className="flex items-end gap-1 h-20">
              {distribution.buckets.map((n, i) => (
                <div key={i} className="flex-1 h-full flex flex-col items-center justify-end gap-1">
                  <div className="text-[9px] font-mono text-muted-foreground tabular-nums">{n}</div>
                  <div
                    className="w-full rounded-t bg-primary/70 min-h-[2px]"
                    style={{ height: `${Math.max((n / maxBucket) * 100, n > 0 ? 4 : 0)}%` }}
                    title={`${n} videos`}
                  />
                  <div className="text-[9px] font-mono text-muted-foreground">
                    {i * 20}-{(i + 1) * 20}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top / Bottom */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp size={14} className="text-emerald-400" />
              Top SEO Performers
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {top5.map((r) => (
              <PerfRow key={r.id} r={r} title={titles.get(r.post_id || "")?.caption || "(untitled)"} positive />
            ))}
            {top5.length === 0 && <p className="text-xs text-muted-foreground">No scored videos yet.</p>}
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp size={14} className="text-amber-400 rotate-180" />
              Lowest SEO Scores
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {bottom5.map((r) => (
              <PerfRow key={r.id} r={r} title={titles.get(r.post_id || "")?.caption || "(untitled)"} />
            ))}
            {bottom5.length === 0 && <p className="text-xs text-muted-foreground">No data yet.</p>}
          </CardContent>
        </Card>
      </div>

      {/* Keyword performance */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search size={14} className="text-sky-400" />
            Top Organic Keywords
            <Badge variant="outline" className="text-[10px]">{keywordAgg.length}</Badge>
          </CardTitle>
          <CardDescription className="text-[11px]">
            Real YouTube search terms driving traffic, ranked by total views.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {keywordAgg.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No organic keyword data yet. Connect YouTube with the <code>yt-analytics.readonly</code> scope to populate.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {keywordAgg.map(([kw, agg]) => (
                <Badge key={kw} variant="secondary" className="text-[11px] font-normal">
                  {kw} <span className="ml-1 font-mono text-muted-foreground">{agg.totalViews}</span>
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommended tags */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Tag size={14} className="text-violet-400" />
            Recommended Tags
          </CardTitle>
          <CardDescription className="text-[11px]">
            Frequent tags across your top 10% SEO performers — applied automatically to future posts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recommendedTags.length === 0 ? (
            <p className="text-xs text-muted-foreground">Need more scored posts to generate recommendations.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {recommendedTags.map((t) => (
                <Badge key={t} variant="outline" className="text-[11px] border-violet-400/40 text-violet-300">
                  #{t}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trending */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Flame size={14} className="text-orange-400" />
            Trending Velocity
          </CardTitle>
          <CardDescription className="text-[11px]">
            views/hour, decayed by age and boosted by CTR + retention.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {trending.length === 0 && <p className="text-xs text-muted-foreground">No trending data yet.</p>}
          {trending.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 text-xs rounded-md border border-border/40 bg-muted/20 px-2 py-1.5">
              <div className="truncate text-foreground/90">
                {titles.get(r.post_id || "")?.caption || "(untitled)"}
              </div>
              <div className="font-mono text-orange-300 shrink-0">
                {Number(r.trending_score).toFixed(1)}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Search */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search size={14} />
            Video Lookup
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            placeholder="Search by title or video ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
          <div className="space-y-1.5">
            {filtered.map((r) => (
              <PerfRow key={r.id} r={r} title={titles.get(r.post_id || "")?.caption || "(untitled)"} dense />
            ))}
            {filtered.length === 0 && <p className="text-xs text-muted-foreground">No matches.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PerfRow({ r, title, positive, dense }: { r: Row; title: string; positive?: boolean; dense?: boolean }) {
  const score = r.seo_score != null ? Number(r.seo_score).toFixed(1) : "—";
  return (
    <div className={`flex items-center justify-between gap-2 rounded-md border border-border/40 bg-muted/20 px-2 ${dense ? "py-1" : "py-1.5"}`}>
      <div className="min-w-0 flex-1">
        <div className="text-xs truncate text-foreground/90">{title}</div>
        {!dense && (r.keywords_organic?.length || r.tags_used?.length) ? (
          <div className="text-[10px] text-muted-foreground truncate">
            {r.keywords_organic?.slice(0, 3).join(" · ") || r.tags_used?.slice(0, 3).join(" · ")}
          </div>
        ) : null}
      </div>
      <div className={`font-mono text-xs shrink-0 ${positive ? "text-emerald-300" : "text-amber-300"}`}>
        {score}
      </div>
    </div>
  );
}

// Insight Engine — "Why It Won" + Pattern Cards
// Reads existing tables only: post_analytics, post_history, content_insights,
// hook_stats, time_slot_stats. Renders gracefully when sample size < 5.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Trophy, Sparkles, MicVocal, Clock4, Megaphone } from "lucide-react";

interface WhyItWon {
  post_id: string;
  caption: string | null;
  city: string | null;
  views: number;
  performance_score: number | null;
  winning_factors: string[];
  losing_factors: string[];
}

interface PatternCardData {
  label: string;
  value: string;
  delta: number | null;
  samples: number;
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmtHour = (h: number) => {
  const p = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${p}`;
};

function explainFactor(f: string): string {
  if (f.startsWith("tone:")) return `${f.slice(5)} tone resonated`;
  if (f.startsWith("slot:")) return `posted in your strongest slot (${f.slice(5)})`;
  if (f.startsWith("condition:")) return `${f.slice(10)} weather typically over-indexes for you`;
  if (f.startsWith("hook:")) return `opener “${f.slice(5)}…” pattern works`;
  if (f === "cinematic") return "cinematic visual style";
  if (f === "voiceover") return "voiceover narration";
  return f;
}

export function InsightEnginePanel() {
  const [loading, setLoading] = useState(true);
  const [why, setWhy] = useState<WhyItWon | null>(null);
  const [bestTone, setBestTone] = useState<PatternCardData | null>(null);
  const [bestSlot, setBestSlot] = useState<PatternCardData | null>(null);
  const [bestHook, setBestHook] = useState<PatternCardData | null>(null);
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [sampleSize, setSampleSize] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      // Top scoring post in last 30d
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [{ data: topRows }, { data: insightRows }, { data: hookRows }, { data: slotRows }, { data: rec }] = await Promise.all([
        supabase
          .from("post_analytics")
          .select("post_id, views, performance_score, winning_factors, losing_factors")
          .eq("user_id", user.id)
          .gte("created_at", since)
          .not("performance_score", "is", null)
          .order("performance_score", { ascending: false })
          .limit(1),
        supabase
          .from("content_insights")
          .select("tone, time_of_day, condition, avg_views, delta_pct, sample_size, rank")
          .eq("user_id", user.id)
          .order("avg_views", { ascending: false })
          .limit(50),
        supabase
          .from("hook_stats")
          .select("hook_text, avg_views, uses")
          .eq("user_id", user.id)
          .order("avg_views", { ascending: false })
          .limit(5),
        supabase
          .from("time_slot_stats")
          .select("day_of_week, hour, posts, avg_views")
          .eq("user_id", user.id)
          .order("avg_views", { ascending: false })
          .limit(10),
        supabase
          .from("growth_recommendations")
          .select("recommendation")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      if (cancelled) return;

      // Resolve top post caption + city via post_history
      const top = (topRows || [])[0] as any;
      if (top?.post_id) {
        const { data: ph } = await supabase
          .from("post_history")
          .select("caption, city, views_count")
          .eq("id", top.post_id)
          .maybeSingle();
        setWhy({
          post_id: top.post_id,
          caption: ph?.caption ?? null,
          city: ph?.city ?? null,
          views: Number(ph?.views_count ?? top.views ?? 0),
          performance_score: Number(top.performance_score),
          winning_factors: Array.isArray(top.winning_factors) ? top.winning_factors : [],
          losing_factors: Array.isArray(top.losing_factors) ? top.losing_factors : [],
        });
      } else {
        setWhy(null);
      }

      const insights = (insightRows || []) as any[];
      const total = insights.reduce((s, r) => s + (r.sample_size || 0), 0);
      setSampleSize(total);

      // Best tone — highest avg-views tone with ≥3 samples
      const toneAgg = new Map<string, { views: number; n: number; deltas: number[] }>();
      for (const r of insights) {
        if (!r.tone) continue;
        const a = toneAgg.get(r.tone) || { views: 0, n: 0, deltas: [] };
        a.views += (r.avg_views || 0) * (r.sample_size || 1);
        a.n += r.sample_size || 1;
        if (typeof r.delta_pct === "number") a.deltas.push(r.delta_pct);
        toneAgg.set(r.tone, a);
      }
      const toneList = Array.from(toneAgg.entries())
        .filter(([, a]) => a.n >= 3)
        .map(([tone, a]) => ({
          tone,
          avg: a.views / a.n,
          delta: a.deltas.length ? a.deltas.reduce((s, x) => s + x, 0) / a.deltas.length : null,
          n: a.n,
        }))
        .sort((a, b) => b.avg - a.avg);
      setBestTone(toneList[0]
        ? { label: "Best Tone", value: toneList[0].tone, delta: toneList[0].delta, samples: toneList[0].n }
        : null);

      // Best slot — top time_slot_stats with ≥3 posts
      const slotList = (slotRows || []).filter((s: any) => s.posts >= 3);
      if (slotList[0]) {
        const s = slotList[0] as any;
        const avg = slotList.reduce((sum: number, x: any) => sum + x.avg_views, 0) / slotList.length;
        const delta = avg > 0 ? ((s.avg_views - avg) / avg) * 100 : null;
        setBestSlot({
          label: "Best Slot",
          value: `${DAY_NAMES[s.day_of_week]} ${fmtHour(s.hour)}`,
          delta,
          samples: s.posts,
        });
      } else {
        setBestSlot(null);
      }

      // Best hook type — top hook with ≥3 uses
      const hooks = ((hookRows || []) as any[]).filter((h) => h.uses >= 3);
      if (hooks[0]) {
        const avgAll = hooks.reduce((s, h) => s + h.avg_views, 0) / hooks.length;
        const delta = avgAll > 0 ? ((hooks[0].avg_views - avgAll) / avgAll) * 100 : null;
        setBestHook({
          label: "Best Hook",
          value: String(hooks[0].hook_text).slice(0, 60),
          delta,
          samples: hooks[0].uses,
        });
      } else {
        setBestHook(null);
      }

      setRecommendation((rec as any)?.recommendation ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading insight engine…</Card>;
  }

  const minSample = sampleSize >= 5;

  return (
    <div className="space-y-4">
      {/* Why It Won */}
      <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy size={14} className="text-emerald-400" />
            Why it won
            {why?.performance_score != null && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 ml-auto tabular-nums">
                Score {Math.round(why.performance_score)}/100
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-xs">
            Your top-scoring post in the last 30 days — explained.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pb-3">
          {!why ? (
            <p className="text-xs text-muted-foreground italic">
              No scored posts yet. Publish at least 5 posts so the engine can score performance.
            </p>
          ) : (
            <>
              {why.caption && (
                <p className="text-xs leading-snug bg-muted/30 rounded-md p-2 line-clamp-3">
                  {why.caption}
                </p>
              )}
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {why.city && <>📍 {why.city} · </>}
                {why.views.toLocaleString()} views
              </div>
              {why.winning_factors.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">What drove it:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {why.winning_factors.map((f, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                      >
                        ✓ {explainFactor(f)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground italic">
                  Not enough comparable posts yet to attribute specific winning factors.
                </p>
              )}
              {why.losing_factors.length > 0 && (
                <div className="space-y-1 pt-1">
                  <p className="text-[11px] text-muted-foreground">What held it back:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {why.losing_factors.slice(0, 3).map((f, i) => (
                      <Badge
                        key={i}
                        variant="outline"
                        className="text-[10px] border-red-500/40 text-red-300/80 bg-red-500/5"
                      >
                        − {explainFactor(f)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Pattern cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PatternCard icon={MicVocal} title="Best Tone" data={bestTone} ready={minSample} />
        <PatternCard icon={Clock4} title="Best Slot" data={bestSlot} ready={minSample} />
        <PatternCard icon={Megaphone} title="Best Hook" data={bestHook} ready={minSample} />
      </div>

      {/* Actionable recommendation */}
      {recommendation && (
        <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles size={14} className="text-primary" />
              Try this next
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <p className="text-sm">{recommendation}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PatternCard({
  icon: Icon,
  title,
  data,
  ready,
}: {
  icon: React.ElementType;
  title: string;
  data: PatternCardData | null;
  ready: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center gap-2 text-muted-foreground font-medium">
          <Icon size={12} /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        {!data ? (
          <p className="text-xs text-muted-foreground italic">
            {ready ? "Need more variation across posts." : "Collecting data — needs ≥5 posts."}
          </p>
        ) : (
          <>
            <p className="text-sm font-medium line-clamp-1">{data.value}</p>
            <div className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
              {data.delta != null && (
                <span className={data.delta >= 0 ? "text-emerald-400" : "text-red-400/80"}>
                  {data.delta >= 0 ? "+" : ""}
                  {Math.round(data.delta)}%
                </span>
              )}
              {data.delta != null && " · "}
              {data.samples} sample{data.samples === 1 ? "" : "s"}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

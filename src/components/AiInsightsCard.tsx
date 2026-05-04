import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkles, TrendingUp, Clock, Ban } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ConditionLift {
  condition: string;
  avgViews: number;
  engagementScore: number;
  deltaPct: number | null;
}

interface HookPrefixStat { prefix: string; avgViews: number; uses: number }

interface Insights {
  topHooks: string[];
  avoidPhrases: string[];
  bestTimeOfDay: string | null;
  conditionLifts: ConditionLift[];
  hookPrefixes: HookPrefixStat[];
  sampleSize: number;
}

const CONDITION_EMOJI: Record<string, string> = {
  sunny: "☀️", clear: "☀️", cloudy: "☁️", clouds: "☁️",
  rain: "🌧️", rainy: "🌧️", snow: "❄️", storm: "⛈️",
  thunderstorm: "⛈️", fog: "🌫️", mist: "🌫️", windy: "💨",
};

const GENERIC_AVOID = ["Weather Update", "Today's Forecast", "Daily Weather", "Weather Report"];

async function loadInsights(): Promise<Insights | null> {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return null;

  const [{ data: hookRows }, { data: rows }] = await Promise.all([
    supabase.from("hook_stats").select("hook_text, avg_views, uses")
      .eq("user_id", uid).order("avg_views", { ascending: false }).limit(20),
    supabase.from("post_analytics").select("views, likes, comments, condition, time_of_day")
      .eq("user_id", uid)
      .gte("created_at", new Date(Date.now() - 60 * 86400_000).toISOString()),
  ]);

  const hooks = (hookRows || []) as any[];
  const topHooks = hooks.filter(h => h.uses >= 2 && h.avg_views > 0).slice(0, 5).map(h => h.hook_text);
  const worstHooks = [...hooks].filter(h => h.uses >= 2)
    .sort((a, b) => a.avg_views - b.avg_views).slice(0, 3).map(h => h.hook_text);

  const prefixMap = new Map<string, { sum: number; n: number }>();
  for (const h of hooks) {
    if (!h.hook_text) continue;
    const w = h.hook_text.trim().split(/\s+/).slice(0, 2).join(" ");
    if (w.length < 3) continue;
    const cur = prefixMap.get(w) || { sum: 0, n: 0 };
    cur.sum += h.avg_views * Math.max(1, h.uses);
    cur.n += Math.max(1, h.uses);
    prefixMap.set(w, cur);
  }
  const hookPrefixes = Array.from(prefixMap.entries())
    .filter(([, v]) => v.n >= 2)
    .map(([prefix, v]) => ({ prefix, avgViews: v.sum / v.n, uses: v.n }))
    .sort((a, b) => b.avgViews - a.avgViews).slice(0, 5);

  const analytics = (rows || []) as any[];
  const condBuckets = new Map<string, { views: number; eng: number; n: number }>();
  const todBuckets = new Map<string, { eng: number; n: number }>();
  let totalEng = 0, totalN = 0;

  for (const r of analytics) {
    const v = Math.max(1, r.views || 0);
    const e = ((r.likes || 0) * 2 + (r.comments || 0) * 3) / v;
    totalEng += e; totalN += 1;
    if (r.condition) {
      const k = r.condition.toLowerCase();
      const b = condBuckets.get(k) || { views: 0, eng: 0, n: 0 };
      b.views += r.views || 0; b.eng += e; b.n += 1;
      condBuckets.set(k, b);
    }
    if (r.time_of_day) {
      const b = todBuckets.get(r.time_of_day) || { eng: 0, n: 0 };
      b.eng += e; b.n += 1;
      todBuckets.set(r.time_of_day, b);
    }
  }

  const baseline = totalN ? totalEng / totalN : 0;
  const conditionLifts = Array.from(condBuckets.entries())
    .filter(([, b]) => b.n >= 2)
    .map(([condition, b]) => ({
      condition,
      avgViews: b.views / b.n,
      engagementScore: b.eng / b.n,
      deltaPct: baseline > 0 ? (((b.eng / b.n) - baseline) / baseline) * 100 : null,
    }))
    .sort((a, b) => b.engagementScore - a.engagementScore);

  const bestTod = Array.from(todBuckets.entries())
    .filter(([, b]) => b.n >= 2)
    .map(([tod, b]) => ({ tod, score: b.eng / b.n }))
    .sort((a, b) => b.score - a.score)[0]?.tod ?? null;

  return {
    topHooks,
    avoidPhrases: Array.from(new Set([...GENERIC_AVOID, ...worstHooks])),
    bestTimeOfDay: bestTod,
    conditionLifts,
    hookPrefixes,
    sampleSize: totalN,
  };
}

export function AiInsightsCard() {
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadInsights().then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <Card className="p-6 bg-card/50 backdrop-blur border-border/50">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Sparkles size={16} className="animate-pulse" /> Loading AI insights…
        </div>
      </Card>
    );
  }

  if (!data || data.sampleSize < 2) {
    return (
      <Card className="p-6 bg-card/50 backdrop-blur border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={18} className="text-primary" />
          <h3 className="font-display text-lg">AI Insights</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Once you have a few posts with engagement data, this panel will surface
          your highest-performing hooks, conditions, and time slots.
        </p>
      </Card>
    );
  }

  const topConds = data.conditionLifts.slice(0, 3);
  const topPrefix = data.hookPrefixes[0];

  return (
    <Card className="p-6 bg-card/50 backdrop-blur border-border/50">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-primary" />
          <h3 className="font-display text-lg">AI Insights — what's working</h3>
        </div>
        <Badge variant="outline" className="text-xs">
          {data.sampleSize} posts analyzed
        </Badge>
      </div>

      <div className="space-y-4">
        {topConds.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-2">
              <TrendingUp size={12} /> Condition lift
            </div>
            <ul className="space-y-1.5 text-sm">
              {topConds.map(c => {
                const emoji = CONDITION_EMOJI[c.condition] ?? "🌤️";
                const pct = c.deltaPct != null ? Math.round(c.deltaPct) : 0;
                const tone = pct >= 0 ? "text-emerald-400" : "text-rose-400";
                return (
                  <li key={c.condition} className="flex items-center gap-2">
                    <span>{emoji}</span>
                    <span className="capitalize">{c.condition}</span>
                    <span className="text-muted-foreground">posts perform</span>
                    <span className={`font-mono ${tone}`}>{pct >= 0 ? "+" : ""}{pct}%</span>
                    <span className="text-muted-foreground">vs your average</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {topPrefix && (
          <div className="text-sm">
            <span className="text-muted-foreground">Hooks starting with </span>
            <span className="font-mono text-primary">"{topPrefix.prefix}"</span>
            <span className="text-muted-foreground"> perform best </span>
            <span className="text-muted-foreground/80">(avg {Math.round(topPrefix.avgViews).toLocaleString()} views).</span>
          </div>
        )}

        {data.bestTimeOfDay && (
          <div className="flex items-center gap-2 text-sm">
            <Clock size={14} className="text-muted-foreground" />
            <span className="text-muted-foreground">Best time of day:</span>
            <Badge variant="secondary" className="capitalize">{data.bestTimeOfDay}</Badge>
          </div>
        )}

        {data.topHooks.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Top hooks</div>
            <div className="flex flex-wrap gap-1.5">
              {data.topHooks.map(h => (
                <Badge key={h} variant="outline" className="text-xs font-normal max-w-full">
                  <span className="truncate max-w-[260px]">{h}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {data.avoidPhrases.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-2">
              <Ban size={12} /> Avoiding
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.avoidPhrases.slice(0, 6).map(p => (
                <Badge key={p} variant="outline" className="text-xs font-normal text-muted-foreground border-dashed max-w-full">
                  <span className="truncate max-w-[220px]">{p}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground border-t border-border/50 pt-3">
          70% of generations favor proven patterns; 30% explore new angles to keep your feed fresh.
        </p>
      </div>
    </Card>
  );
}

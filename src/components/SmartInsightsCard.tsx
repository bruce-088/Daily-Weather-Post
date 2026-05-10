import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, Clock, Mic, Palette, Cloud } from "lucide-react";
import { useActiveCity } from "@/hooks/useActiveCity";

interface PostRow {
  city: string | null;
  condition: string | null;
  views_count: number | null;
  voice_status: string | null;
  visual_metadata: any;
  created_at: string;
}

interface Insight {
  icon: "fire" | "visual" | "time" | "voice";
  emoji: string;
  text: string;
  delta?: number; // positive = good
  samples: number;
}

function timeOfDayFromIso(iso: string): "morning" | "afternoon" | "evening" | "night" {
  const h = new Date(iso).getHours();
  if (h < 11) return "morning";
  if (h < 16) return "afternoon";
  if (h < 20) return "evening";
  return "night";
}

function timeLabel(t: string) {
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function topGroup<T extends string>(
  rows: PostRow[],
  keyFn: (r: PostRow) => T | null,
  minSamples = 3,
): { key: T; avg: number; samples: number; overall: number; deltaPct: number } | null {
  const buckets = new Map<T, number[]>();
  const all: number[] = [];
  for (const r of rows) {
    const k = keyFn(r);
    const v = r.views_count ?? 0;
    if (k == null) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(v);
    all.push(v);
  }
  const overall = avg(all);
  let best: { key: T; avg: number; samples: number } | null = null;
  for (const [k, vs] of buckets) {
    if (vs.length < minSamples) continue;
    const a = avg(vs);
    if (!best || a > best.avg) best = { key: k, avg: a, samples: vs.length };
  }
  if (!best) return null;
  const deltaPct = overall > 0 ? Math.round(((best.avg - overall) / overall) * 100) : 0;
  return { ...best, overall, deltaPct };
}

interface SmartInsightsCardProps {
  /** Compact mode shows top 1-2 only (used on Dashboard). */
  compact?: boolean;
}

export function SmartInsightsCard({ compact = false }: SmartInsightsCardProps) {
  const activeCity = useActiveCity();
  const [rows, setRows] = useState<PostRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      let q = supabase
        .from("post_history")
        .select("city, condition, views_count, voice_status, visual_metadata, created_at")
        .eq("status", "posted")
        .order("created_at", { ascending: false })
        .limit(500);
      if (activeCity.name) q = q.eq("city", activeCity.name);
      const { data } = await q;
      if (!alive) return;
      setRows((data as PostRow[]) || []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [activeCity.name]);

  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    if (rows.length < 3) return out;

    // 1. Condition performance
    const cond = topGroup(rows, (r) => (r.condition ? r.condition.toLowerCase() : null));
    if (cond && cond.deltaPct > 10) {
      const cityTag = activeCity.name ? ` in ${activeCity.name}` : "";
      out.push({
        icon: "fire",
        emoji: "🔥",
        text: `${timeLabel(cond.key)} videos perform ${(cond.avg / Math.max(cond.overall, 1)).toFixed(1)}x better${cityTag}`,
        delta: cond.deltaPct,
        samples: cond.samples,
      });
    }

    // 2. Best posting time
    const slot = topGroup(rows, (r) => timeOfDayFromIso(r.created_at));
    if (slot && slot.deltaPct > 5) {
      const cityTag = activeCity.name ? ` in ${activeCity.name}` : "";
      out.push({
        icon: "time",
        emoji: "⏰",
        text: `Best time${cityTag} is ${timeLabel(slot.key)} (+${slot.deltaPct}% vs other slots)`,
        delta: slot.deltaPct,
        samples: slot.samples,
      });
    }

    // 3. Visual performance — style
    const vis = topGroup(rows, (r) => {
      const s = r.visual_metadata?.visual_style;
      return typeof s === "string" ? s.toLowerCase() : null;
    });
    if (vis && vis.deltaPct > 10) {
      out.push({
        icon: "visual",
        emoji: "🎥",
        text: `${timeLabel(vis.key)} visuals outperform other styles by +${vis.deltaPct}%`,
        delta: vis.deltaPct,
        samples: vis.samples,
      });
    }

    // 3b. Brightness
    const bright = topGroup(rows, (r) => {
      const b = r.visual_metadata?.brightness_level;
      return typeof b === "string" ? b.toLowerCase() : null;
    });
    if (bright && bright.deltaPct > 15) {
      out.push({
        icon: "visual",
        emoji: "🌅",
        text: `${timeLabel(bright.key)} backgrounds win by +${bright.deltaPct}%`,
        delta: bright.deltaPct,
        samples: bright.samples,
      });
    }

    // 4. Voiceover impact
    const onViews = rows.filter((r) => r.voice_status === "success").map((r) => r.views_count ?? 0);
    const offViews = rows.filter((r) => r.voice_status !== "success").map((r) => r.views_count ?? 0);
    if (onViews.length >= 3 && offViews.length >= 3) {
      const a = avg(onViews);
      const b = avg(offViews);
      if (b > 0 && a > b) {
        const delta = Math.round(((a - b) / b) * 100);
        if (delta > 5) {
          out.push({
            icon: "voice",
            emoji: "🎙️",
            text: `Voiceover increases views by +${delta}%`,
            delta,
            samples: onViews.length + offViews.length,
          });
        }
      } else if (a > 0 && b > a) {
        const delta = Math.round(((b - a) / a) * 100);
        if (delta > 5) {
          out.push({
            icon: "voice",
            emoji: "🔇",
            text: `Silent videos outperform voiceover by +${delta}%`,
            delta,
            samples: onViews.length + offViews.length,
          });
        }
      }
    }

    // Sort by impact
    out.sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
    return out;
  }, [rows, activeCity.name]);

  if (loading) return null;

  const visible = compact ? insights.slice(0, 2) : insights;

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain size={16} className="text-primary" />
          Smart Insights
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">AI</Badge>
          {activeCity.name && (
            <Badge variant="outline" className="text-[10px] ml-auto">{activeCity.name}</Badge>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Patterns learned across condition, timing, visuals, and voiceover
          {activeCity.name ? ` for ${activeCity.name}` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            {rows.length < 3
              ? activeCity.name
                ? `No data yet for ${activeCity.name} — start posting to generate insights.`
                : "Not enough data yet. Insights appear after a few posts."
              : "Patterns are still emerging. Keep posting to surface clear winners."}
          </p>
        ) : (
          visible.map((i, idx) => (
            <div
              key={idx}
              className="rounded-md border border-border/50 bg-muted/30 p-2.5 text-xs space-y-1"
            >
              <div className="flex items-start gap-1.5">
                {i.icon === "fire" && <TrendingUp size={12} className="text-primary mt-0.5 shrink-0" />}
                {i.icon === "time" && <Clock size={12} className="text-primary mt-0.5 shrink-0" />}
                {i.icon === "visual" && <Palette size={12} className="text-primary mt-0.5 shrink-0" />}
                {i.icon === "voice" && <Mic size={12} className="text-primary mt-0.5 shrink-0" />}
                <span>
                  {i.emoji} {i.text}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Cloud size={11} />
                <span className="opacity-70">{i.samples} samples</span>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

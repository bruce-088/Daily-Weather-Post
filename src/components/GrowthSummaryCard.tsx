import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, TrendingUp, AlertTriangle, ChevronRight, Trophy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useActiveCity } from "@/hooks/useActiveCity";

interface Recommendation {
  recommendation: string;
  variety_score: number;
  best_slot: { day_of_week: number; hour: number; avg_views: number } | null;
  top_hooks: string[];
}

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  message: string;
  city: string;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtHour = (h: number) => {
  const p = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}${p}`;
};

interface Winner {
  topTitle: string | null;
  bestSlot: string | null;
  avgViews: number;
  sampleSize: number;
}

export function GrowthSummaryCard({ onOpenAnalytics }: { onOpenAnalytics?: () => void }) {
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [alert, setAlert] = useState<Alert | null>(null);
  const [winner, setWinner] = useState<Winner | null>(null);
  const [loading, setLoading] = useState(true);
  const activeCity = useActiveCity();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      let perfQ = supabase.from("post_performance")
        .select("title, slot, views, engagement_score, published_at")
        .gte("published_at", since)
        .order("engagement_score", { ascending: false, nullsFirst: false })
        .limit(20);
      if (activeCity.name) perfQ = perfQ.ilike("city", activeCity.name);

      const [r, a, p] = await Promise.all([
        supabase.from("growth_recommendations")
          .select("recommendation, variety_score, best_slot, top_hooks")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase.from("trend_alerts")
          .select("id, alert_type, severity, message, city")
          .eq("user_id", user.id)
          .eq("dismissed", false)
          .order("created_at", { ascending: false })
          .limit(1),
        perfQ,
      ]);
      setRec((r.data as any) || null);
      setAlert(((a.data as any[]) || [])[0] || null);

      const perfRows = ((p.data as any[]) || []).filter(x => x.title);
      if (perfRows.length >= 3) {
        const top = perfRows[0];
        const slotCounts: Record<string, { sum: number; n: number }> = {};
        for (const row of perfRows) {
          if (!row.slot) continue;
          slotCounts[row.slot] = slotCounts[row.slot] || { sum: 0, n: 0 };
          slotCounts[row.slot].sum += Number(row.views || 0);
          slotCounts[row.slot].n += 1;
        }
        let bestSlot: string | null = null;
        let bestAvg = -1;
        for (const [slot, { sum, n }] of Object.entries(slotCounts)) {
          const avg = sum / n;
          if (avg > bestAvg) { bestAvg = avg; bestSlot = slot; }
        }
        const totalViews = perfRows.reduce((s, r) => s + Number(r.views || 0), 0);
        setWinner({
          topTitle: top.title,
          bestSlot,
          avgViews: Math.round(totalViews / perfRows.length),
          sampleSize: perfRows.length,
        });
      }
      setLoading(false);
    })();
  }, [activeCity.name]);

  if (loading) return null;
  if (!rec && !alert && !winner) return null;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          Growth · AI Recommendation
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary ml-auto">Auto</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 pb-3">
        {alert && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
            <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs leading-snug">{alert.message}</p>
          </div>
        )}
        {rec && (
          <p className="text-xs leading-snug text-foreground/90">{rec.recommendation}</p>
        )}
        {rec?.best_slot && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <TrendingUp size={11} />
            Best slot: <span className="font-medium text-foreground">{DAYS[rec.best_slot.day_of_week]} {fmtHour(rec.best_slot.hour)}</span>
            <span className="opacity-60">· {Math.round(rec.best_slot.avg_views).toLocaleString()} avg views</span>
          </div>
        )}
        {winner && (
          <div className="rounded-md border border-primary/20 bg-primary/5 p-2 space-y-1">
            <div className="flex items-center gap-1.5 text-[11px] text-primary font-medium">
              <Trophy size={11} />
              Recent Winners{activeCity.name ? ` · ${activeCity.name}` : ""}
              <span className="ml-auto opacity-60 font-normal">{winner.sampleSize} posts · 14d</span>
            </div>
            {winner.topTitle && (
              <p className="text-xs text-foreground/90 line-clamp-2 leading-snug">"{winner.topTitle}"</p>
            )}
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              {winner.bestSlot && <span>Best slot: <span className="text-foreground font-medium capitalize">{winner.bestSlot}</span></span>}
              <span className="opacity-60">· {winner.avgViews.toLocaleString()} avg views</span>
            </div>
          </div>
        )}
        {onOpenAnalytics && (
          <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 px-2" onClick={onOpenAnalytics}>
            Open Growth dashboard <ChevronRight size={12} />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

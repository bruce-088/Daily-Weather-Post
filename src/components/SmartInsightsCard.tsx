import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Brain, TrendingUp, Clock, MapPin, ChevronLeft, ChevronRight } from "lucide-react";

interface InsightRow {
  condition: string;
  tone: string;
  time_of_day: string;
  avg_views: number;
  delta_pct: number | null;
  sample_size: number;
  top_hook: string | null;
  rank: number;
}

interface SmartInsightsCardProps {
  /** Compact mode shows top 1-2 only (used on Dashboard). */
  compact?: boolean;
}

function timeLabel(t: string) {
  const h = t === "morning" ? "8 AM" : t === "afternoon" ? "1 PM" : t === "evening" ? "6 PM" : "9 PM";
  return `${t.charAt(0).toUpperCase() + t.slice(1)} (${h})`;
}

export function SmartInsightsCard({ compact = false }: SmartInsightsCardProps) {
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("content_insights")
        .select("condition, tone, time_of_day, avg_views, delta_pct, sample_size, top_hook, rank")
        .eq("rank", 1)
        .order("avg_views", { ascending: false })
        .limit(compact ? 2 : 12);
      setInsights((data as any) || []);
      setLoading(false);
    })();
  }, [compact]);

  if (loading) return null;

  return (
    <Card className="border-border/50 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain size={16} className="text-primary" />
          Smart Insights
          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">AI</Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          Patterns the system has learned from your post performance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Not enough data yet. Insights appear after the analyzer has at least 3 posts per pattern.
          </p>
        ) : (
          insights.map((i, idx) => {
            const delta = i.delta_pct ? Math.round(i.delta_pct) : null;
            return (
              <div key={idx} className="rounded-md border border-border/50 bg-muted/30 p-2.5 text-xs space-y-1">
                <div className="flex items-start gap-1.5">
                  <TrendingUp size={12} className="text-primary mt-0.5 shrink-0" />
                  <span>
                    🔥 <strong className="capitalize">{i.condition}</strong> posts perform best with{" "}
                    <strong className="capitalize">{i.tone}</strong> tone
                    {delta !== null && delta > 0 && (
                      <span className="text-green-500"> (+{delta}% vs your avg)</span>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock size={11} /> Best slot: {timeLabel(i.time_of_day)} · avg{" "}
                  <span className="tabular-nums">{Math.round(i.avg_views).toLocaleString()}</span> views
                  <span className="opacity-60">· {i.sample_size} samples</span>
                </div>
                {!compact && i.top_hook && (
                  <div className="flex items-start gap-1.5 text-muted-foreground italic">
                    <MapPin size={11} className="mt-0.5 shrink-0" />
                    <span>"{i.top_hook}"</span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

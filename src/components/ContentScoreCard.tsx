import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Info, Gauge } from "lucide-react";
import {
  computeContentScore,
  type ContentScoreInput,
  type WinnerStatsLite,
} from "@/lib/postHealth";
import { useAuth } from "@/hooks/useAuth";
import { FeatureFlags } from "@/lib/featureFlags";

interface Props {
  input: ContentScoreInput;
  city?: string | null;
}

export function ContentScoreCard({ input, city }: Props) {
  const { user } = useAuth();
  const [winners, setWinners] = useState<WinnerStatsLite | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    if (!FeatureFlags.ENABLE_CONTENT_SCORE) return;
    let alive = true;
    (async () => {
      let q = supabase
        .from("winner_stats" as any)
        .select(
          "best_hook_type, best_hour, worst_hour, cinematic_lift_pct, voice_lift_pct, best_condition",
        )
        .eq("user_id", user.id)
        .order("computed_at", { ascending: false })
        .limit(1);
      if (city) q = q.eq("city", city);
      const { data } = await q;
      if (!alive) return;
      setWinners((((data as any[]) || [])[0] as any) || null);
    })();
    return () => {
      alive = false;
    };
  }, [user?.id, city]);

  if (!FeatureFlags.ENABLE_CONTENT_SCORE) return null;

  const { score, checks } = computeContentScore(input, winners);
  const tier = score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "ok" : "low";
  const tierColor =
    tier === "excellent"
      ? "text-emerald-400 border-emerald-400/40"
      : tier === "good"
        ? "text-sky-400 border-sky-400/40"
        : tier === "ok"
          ? "text-amber-400 border-amber-400/40"
          : "text-rose-400 border-rose-400/40";

  return (
    <Card className="p-3 border-border/50 bg-card/70 backdrop-blur space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Gauge size={14} className="text-primary" />
          <span>Post Score</span>
        </div>
        <Badge variant="outline" className={`text-xs font-mono ${tierColor}`}>
          {score}/100
        </Badge>
      </div>
      <div className="space-y-1">
        {checks.map((c, i) => (
          <div key={i} className="flex items-start gap-1.5 text-xs">
            {c.status === "ok" && <CheckCircle2 size={12} className="text-emerald-400 mt-0.5 shrink-0" />}
            {c.status === "warn" && <AlertTriangle size={12} className="text-amber-400 mt-0.5 shrink-0" />}
            {c.status === "info" && <Info size={12} className="text-sky-400 mt-0.5 shrink-0" />}
            <div className="flex-1">
              <span className="text-foreground">{c.label}</span>
              {c.tip && (
                <span className="block text-[10px] text-muted-foreground italic">💡 {c.tip}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

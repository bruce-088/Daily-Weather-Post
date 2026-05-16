import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Clock, Zap, CloudRain, MicVocal, RefreshCw } from "lucide-react";
import { useActiveCity } from "@/hooks/useActiveCity";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface WinnerStats {
  user_id: string;
  city: string | null;
  computed_at: string;
  best_hook_type: string | null;
  best_hook_avg: number | null;
  best_hour: number | null;
  best_hour_avg: number | null;
  worst_hour: number | null;
  worst_hour_avg: number | null;
  best_condition: string | null;
  best_condition_avg: number | null;
  cinematic_lift_pct: number | null;
  voice_lift_pct: number | null;
  city_avg_views: number | null;
  sample_size: number;
}

const HOOK_LABELS: Record<string, { emoji: string; label: string }> = {
  A: { emoji: "⚡", label: "Urgency (Hook A)" },
  B: { emoji: "💡", label: "Advice (Hook B)" },
  C: { emoji: "👁️", label: "Insight (Hook C)" },
};

const CONDITION_EMOJI: Record<string, string> = {
  storm: "⛈️",
  rain: "🌧️",
  clear: "☀️",
  clouds: "☁️",
  cloudy: "☁️",
  snow: "❄️",
  mist: "🌫️",
};

function formatHour(h: number | null) {
  if (h == null) return "—";
  const hh = h % 12 === 0 ? 12 : h % 12;
  const ampm = h < 12 ? "AM" : "PM";
  return `${hh}:00 ${ampm}`;
}

function condEmoji(c: string | null) {
  if (!c) return "🌡️";
  const k = c.toLowerCase();
  for (const key of Object.keys(CONDITION_EMOJI)) {
    if (k.includes(key)) return CONDITION_EMOJI[key];
  }
  return "🌡️";
}

export function GrowthIntelligenceCard() {
  const activeCity = useActiveCity();
  const { user } = useAuth();
  const [stats, setStats] = useState<WinnerStats | null>(null);
  const [voiceSamples, setVoiceSamples] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!user?.id) return;
    let q = supabase
      .from("winner_stats" as any)
      .select("*")
      .eq("user_id", user.id)
      .order("computed_at", { ascending: false })
      .limit(1);
    if (activeCity.name) q = q.eq("city", activeCity.name);
    const { data } = await q;
    const row = ((data as any[]) || [])[0] || null;

    // Recompute voice_lift_pct from post_history to match SmartInsightsCard
    // (views-based, larger sample = source of truth).
    let ph = supabase
      .from("post_history")
      .select("views_count, voice_status")
      .eq("user_id", user.id)
      .in("status", ["success", "posted"])
      .limit(500);
    if (activeCity.name) ph = ph.ilike("city", activeCity.name);
    const { data: phRows } = await ph;
    const on = (phRows || []).filter((r: any) => r.voice_status === "success").map((r: any) => Number(r.views_count) || 0);
    const off = (phRows || []).filter((r: any) => r.voice_status !== "success").map((r: any) => Number(r.views_count) || 0);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    let lift: number | null = null;
    if (on.length >= 3 && off.length >= 3) {
      const a = mean(on);
      const b = mean(off);
      if (b > 0) lift = Math.round(((a - b) / b) * 100);
      else if (a > 0) lift = 100;
    }
    setVoiceSamples(on.length + off.length);
    setStats(row ? { ...row, voice_lift_pct: lift ?? row.voice_lift_pct } : row);
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    load();
  }, [user?.id, activeCity.name]);

  async function handleRecompute() {
    setRefreshing(true);
    try {
      await supabase.functions.invoke("compute-winner-stats");
      toast.success("Recomputing growth intelligence…");
      setTimeout(load, 1500);
    } catch (e: any) {
      toast.error(e?.message || "Failed to recompute");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) return null;

  const hasData = stats && stats.sample_size >= 2;

  return (
    <Card className="border-border/60 bg-gradient-to-br from-card/90 to-card/60 backdrop-blur">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy size={16} className="text-amber-400" />
              Growth Intelligence
              <Badge variant="outline" className="text-[10px] border-amber-400/40 text-amber-400">
                Auto-Winner
              </Badge>
              {activeCity.name && (
                <Badge variant="outline" className="text-[10px]">{activeCity.name}</Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              What's working — learned from your post performance.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRecompute}
            disabled={refreshing}
            className="h-7 text-xs"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {!hasData ? (
          <p className="text-xs text-muted-foreground italic py-2">
            Need at least 2 posts per pattern (hook style, hour, condition).
            {stats?.sample_size
              ? ` Currently tracking ${stats.sample_size} post${stats.sample_size === 1 ? "" : "s"}${activeCity.name ? ` for ${activeCity.name}` : ""}.`
              : " Start posting to surface winners."}
          </p>
        ) : (
          <>
            <Row
              icon={<Zap size={14} className="text-amber-400" />}
              label="Best Hook Style"
              value={
                stats!.best_hook_type
                  ? `${HOOK_LABELS[stats!.best_hook_type]?.emoji ?? "⚡"} ${HOOK_LABELS[stats!.best_hook_type]?.label ?? stats!.best_hook_type}`
                  : "—"
              }
              avg={stats!.best_hook_avg}
            />
            <Row
              icon={<Clock size={14} className="text-primary" />}
              label="Best Post Time"
              value={`🕕 ${formatHour(stats!.best_hour)}`}
              avg={stats!.best_hour_avg}
            />
            {stats!.cinematic_lift_pct != null && (
              <Row
                icon={<span className="text-base leading-none">🎬</span>}
                label="Cinematic Lift"
                value={
                  stats!.cinematic_lift_pct >= 0
                    ? `+${stats!.cinematic_lift_pct}% when ON`
                    : `${stats!.cinematic_lift_pct}% (OFF wins)`
                }
                positive={stats!.cinematic_lift_pct >= 0}
              />
            )}
            {stats!.best_condition && (
              <Row
                icon={<CloudRain size={14} className="text-sky-400" />}
                label="Best Condition"
                value={`${condEmoji(stats!.best_condition)} ${stats!.best_condition} posts`}
                avg={stats!.best_condition_avg}
              />
            )}
            {stats!.voice_lift_pct != null && (
              <Row
                icon={<MicVocal size={14} className="text-violet-400" />}
                label="Voiceover Lift"
                value={
                  stats!.voice_lift_pct >= 0
                    ? `+${stats!.voice_lift_pct}% when ON`
                    : `${stats!.voice_lift_pct}% (silent wins)`
                }
                positive={stats!.voice_lift_pct >= 0}
                hint={voiceSamples > 0 ? `${voiceSamples} samples` : undefined}
              />
            )}
            {stats!.worst_hour != null && (
              <Row
                icon={<Clock size={14} className="text-muted-foreground" />}
                label="Worst Time"
                value={`🕐 ${formatHour(stats!.worst_hour)}`}
                avg={stats!.worst_hour_avg}
                muted
              />
            )}
            <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/50 mt-2">
              {stats!.sample_size} posts analyzed · last computed{" "}
              {new Date(stats!.computed_at).toLocaleString()}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  icon,
  label,
  value,
  avg,
  positive,
  muted,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  avg?: number | null;
  positive?: boolean;
  muted?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-3 py-2 ${
        muted ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-xs">
        {icon}
        <span className="text-muted-foreground">{label}</span>
      </div>
      <div className="text-right">
        <div className={`text-xs font-medium ${positive === false ? "text-amber-400" : ""}`}>
          {value}
        </div>
        {avg != null && (
          <div className="text-[10px] font-mono text-muted-foreground">
            avg {Math.round(avg)} pts
          </div>
        )}
        {hint && (
          <div className="text-[10px] font-mono text-muted-foreground">{hint}</div>
        )}
      </div>
    </div>
  );
}

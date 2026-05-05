// Growth Log: persistent feed of A/B-test wins, plus a live Growth Lab card
// (active experiments + proven wins + AI recommendation).
//
// Lives in the Analytics tab. Toasts and sounds are fired by useGrowthInsights
// at the App level so they show even when the user isn't on this tab.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Sparkles, Beaker, Gem, ExternalLink, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useActiveCity } from "@/hooks/useActiveCity";

interface GrowthInsightRow {
  id: string;
  experiment_id: string | null;
  variable: string;
  winner_variant: string;
  winner_value: string | null;
  loser_value: string | null;
  delta_pct: number;
  title: string;
  message: string;
  post_id_a: string | null;
  post_id_b: string | null;
  city: string | null;
  read: boolean;
  created_at: string;
}

interface ExperimentRow {
  id: string;
  city: string | null;
  variable_tested: string;
  variant_a_meta: any;
  variant_b_meta: any;
  status: string;
  conclude_at: string;
  created_at: string;
}

interface ExperimentWinRow {
  variable: string;
  winning_value: string;
  wins: number;
  losses: number;
  win_rate: number;
  last_win_at: string | null;
}

export function GrowthLog() {
  const activeCity = useActiveCity();
  const [insights, setInsights] = useState<GrowthInsightRow[]>([]);
  const [active, setActive] = useState<ExperimentRow[]>([]);
  const [wins, setWins] = useState<ExperimentWinRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    let iQ = supabase.from("growth_insights")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(25);
    let eQ = supabase.from("experiments")
      .select("id, city, variable_tested, variant_a_meta, variant_b_meta, status, conclude_at, created_at")
      .eq("user_id", user.id)
      .eq("status", "gathering_data")
      .order("created_at", { ascending: false })
      .limit(10);
    if (activeCity.name) {
      iQ = iQ.ilike("city", activeCity.name);
      eQ = eQ.ilike("city", activeCity.name);
    }

    const [i, e, w] = await Promise.all([
      iQ, eQ,
      supabase.from("experiment_wins")
        .select("variable, winning_value, wins, losses, win_rate, last_win_at")
        .eq("user_id", user.id)
        .gte("wins", 2)
        .order("wins", { ascending: false })
        .limit(8),
    ]);
    setInsights((i.data as any) || []);
    setActive((e.data as any) || []);
    setWins((w.data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    let alive = true;
    const channel = supabase
      .channel("growth-insights-feed")
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "growth_insights" },
        () => { if (alive) load(); })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCity.name]);

  const recommendation = wins[0]
    ? `Based on recent A/B tests, your audience consistently prefers ${wins[0].variable} = "${wins[0].winning_value}" (${Math.round(wins[0].win_rate * 100)}% win rate). The AI is now favoring this style automatically.`
    : "Run more posts and the engine will start surfacing winning patterns automatically.";

  if (loading) return <Card className="p-6 text-sm text-muted-foreground">Loading growth log…</Card>;

  return (
    <div id="growth-log" className="space-y-4 scroll-mt-24">
      {/* Growth Log feed */}
      <Card className="border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gem size={14} className="text-amber-400" />
            Growth Log
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400 ml-auto">
              {insights.length} insight{insights.length === 1 ? "" : "s"}
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Every winning A/B test the AI discovers shows up here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {insights.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              {activeCity.name
                ? `No data yet for ${activeCity.name} — start posting to generate insights.`
                : "No insights yet. The engine is running A/B tests in the background — check back after a few posts publish."}
            </p>
          ) : (
            insights.map((ins) => (
              <div
                key={ins.id}
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 hover:bg-amber-500/10 transition-colors"
              >
                <div className="flex items-start gap-2">
                  <Gem size={14} className="text-amber-400 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-amber-200">{ins.title}</p>
                    <p className="text-xs text-foreground/80 mt-0.5 leading-relaxed">{ins.message}</p>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <Badge variant="outline" className="text-[10px] capitalize">{ins.variable}</Badge>
                      <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                        +{Math.round(ins.delta_pct)}%
                      </Badge>
                      {ins.city && <span className="text-[10px] text-muted-foreground">{ins.city}</span>}
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {formatDistanceToNow(new Date(ins.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    {(ins.post_id_a || ins.post_id_b) && (
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            const ids = [ins.post_id_a, ins.post_id_b].filter(Boolean).join(",");
                            window.location.hash = `#history-posts=${ids}`;
                          }}
                        >
                          <ExternalLink size={10} /> View posts
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Growth Lab */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Beaker size={14} className="text-primary" />
            Growth Lab
          </CardTitle>
          <CardDescription className="text-xs">
            Active experiments and patterns the engine has proven multiple times.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Active experiments
            </p>
            {active.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No live tests right now.</p>
            ) : (
              <div className="space-y-1.5">
                {active.map((e) => {
                  const hoursLeft = Math.max(0, Math.round((new Date(e.conclude_at).getTime() - Date.now()) / 36e5));
                  const aVal = (e.variant_a_meta as any)?.[e.variable_tested] || "—";
                  const bVal = (e.variant_b_meta as any)?.[e.variable_tested] || "—";
                  return (
                    <div key={e.id} className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 p-2 text-xs">
                      <Badge variant="outline" className="text-[10px] capitalize">{e.variable_tested}</Badge>
                      <span className="font-mono text-muted-foreground">A: {aVal}</span>
                      <span className="text-muted-foreground">vs</span>
                      <span className="font-mono text-muted-foreground">B: {bVal}</span>
                      <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock size={10} /> {hoursLeft}h
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              Proven wins
            </p>
            {wins.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No repeated winners yet.</p>
            ) : (
              <div className="space-y-1.5">
                {wins.map((w) => (
                  <div key={`${w.variable}-${w.winning_value}`} className="flex items-center gap-2 text-xs">
                    <Trophy size={12} className="text-amber-400 shrink-0" />
                    <Badge variant="outline" className="text-[10px] capitalize">{w.variable}</Badge>
                    <span className="font-mono">{w.winning_value}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {w.wins}W / {w.losses}L · {Math.round(w.win_rate * 100)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
            <div className="flex items-start gap-2">
              <Sparkles size={12} className="text-primary mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">{recommendation}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

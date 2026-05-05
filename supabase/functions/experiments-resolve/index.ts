// Resolves A/B experiments whose 24h window has elapsed.
// - Reads post_analytics for the two posts
// - Computes engagement_score = (likes*2 + comments*3) / max(views,1)
// - Picks a winner if delta >= 15%, else marks no_winner
// - Writes a growth_insights row + a notifications row + experiment_wins rollup
// - Marks experiment.status = concluded
//
// Scheduled hourly via pg_cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { variantValue, type Variable, type VariantMeta } from "../_shared/experiments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_DELTA = 0.15; // 15%
const MIN_VIEWS = 5;     // floor so we don't crown noise

interface AnalyticsRow {
  post_id: string | null;
  views: number;
  likes: number;
  comments: number;
}

function score(rows: AnalyticsRow[]): { eng: number; views: number } {
  let likes = 0, comments = 0, views = 0;
  for (const r of rows) {
    likes += r.likes || 0;
    comments += r.comments || 0;
    views += r.views || 0;
  }
  const eng = (likes * 2 + comments * 3) / Math.max(1, views);
  return { eng, views };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: due } = await supabase
    .from("experiments")
    .select("*")
    .eq("status", "gathering_data")
    .lte("conclude_at", new Date().toISOString())
    .limit(50);

  const exps = due || [];
  let resolved = 0, winners = 0;

  for (const e of exps) {
    if (!e.post_id_a || !e.post_id_b) {
      // One side never published — cancel it.
      await supabase.from("experiments").update({
        status: "cancelled", concluded_at: new Date().toISOString(),
      }).eq("id", e.id);
      continue;
    }

    const { data: aRows } = await supabase
      .from("post_analytics")
      .select("post_id, views, likes, comments")
      .eq("user_id", e.user_id)
      .eq("post_id", e.post_id_a);
    const { data: bRows } = await supabase
      .from("post_analytics")
      .select("post_id, views, likes, comments")
      .eq("user_id", e.user_id)
      .eq("post_id", e.post_id_b);

    const a = score((aRows || []) as AnalyticsRow[]);
    const b = score((bRows || []) as AnalyticsRow[]);

    if (a.views < MIN_VIEWS && b.views < MIN_VIEWS) {
      // Not enough data — give it another 12h then cancel if still empty.
      const newConclude = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      const ageHours = (Date.now() - new Date(e.created_at).getTime()) / 36e5;
      if (ageHours > 60) {
        await supabase.from("experiments").update({
          status: "no_winner", concluded_at: new Date().toISOString(), winner_variant: "none",
        }).eq("id", e.id);
      } else {
        await supabase.from("experiments").update({ conclude_at: newConclude }).eq("id", e.id);
      }
      continue;
    }

    const denom = Math.max(a.eng, b.eng, 1e-9);
    const deltaPct = Math.abs(a.eng - b.eng) / denom;
    let winner: "A" | "B" | "tie" = "tie";
    if (deltaPct >= MIN_DELTA) winner = b.eng > a.eng ? "B" : "A";

    const variable = e.variable_tested as Variable;
    const aMeta = (e.variant_a_meta || {}) as VariantMeta;
    const bMeta = (e.variant_b_meta || {}) as VariantMeta;

    const winnerVal = winner === "A" ? variantValue(variable, aMeta)
      : winner === "B" ? variantValue(variable, bMeta) : null;
    const loserVal = winner === "A" ? variantValue(variable, bMeta)
      : winner === "B" ? variantValue(variable, aMeta) : null;

    await supabase.from("experiments").update({
      status: winner === "tie" ? "no_winner" : "concluded",
      winner_variant: winner === "tie" ? "tie" : winner,
      winner_post_id: winner === "A" ? e.post_id_a : winner === "B" ? e.post_id_b : null,
      delta_pct: Math.round(deltaPct * 1000) / 10,
      concluded_at: new Date().toISOString(),
      insight_generated: winner !== "tie",
    }).eq("id", e.id);

    resolved++;

    if (winner === "tie" || !winnerVal || !loserVal) continue;
    winners++;

    // Rollup: increment wins/losses for this winning value, and losses for loser.
    const pct = Math.round(deltaPct * 100);
    const title = "New Growth Insight Found! 🚀";
    const message = `Pattern: "${winnerVal}" beat "${loserVal}" by +${pct}% in engagement. AI Update: Your master prompt has been automatically optimized to favor this style.`;

    // Upsert winner row
    {
      const { data: existing } = await supabase
        .from("experiment_wins")
        .select("wins, losses")
        .eq("user_id", e.user_id).eq("variable", variable).eq("winning_value", winnerVal)
        .maybeSingle();
      const wins = (existing?.wins ?? 0) + 1;
      const losses = existing?.losses ?? 0;
      await supabase.from("experiment_wins").upsert({
        user_id: e.user_id, variable, winning_value: winnerVal,
        wins, losses,
        win_rate: wins / Math.max(1, wins + losses),
        last_win_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    // Bump loser's losses count (so win_rate stays honest)
    {
      const { data: existing } = await supabase
        .from("experiment_wins")
        .select("wins, losses")
        .eq("user_id", e.user_id).eq("variable", variable).eq("winning_value", loserVal)
        .maybeSingle();
      const wins = existing?.wins ?? 0;
      const losses = (existing?.losses ?? 0) + 1;
      await supabase.from("experiment_wins").upsert({
        user_id: e.user_id, variable, winning_value: loserVal,
        wins, losses,
        win_rate: wins / Math.max(1, wins + losses),
        last_win_at: existing ? undefined : null,
        updated_at: new Date().toISOString(),
      });
    }

    // Persistent feed item
    await supabase.from("growth_insights").insert({
      user_id: e.user_id,
      experiment_id: e.id,
      variable,
      winner_variant: winner,
      winner_value: winnerVal,
      loser_value: loserVal,
      delta_pct: pct,
      title,
      message,
      post_id_a: e.post_id_a,
      post_id_b: e.post_id_b,
      city: e.city,
    });

    // Live notification (toast + bell)
    await supabase.from("notifications").insert({
      user_id: e.user_id,
      title,
      message,
      type: "success",
    });

    // AI Memory: persist winning content for future learning.
    // hook/tone variables map directly; visuals winners are stored as 'script' style hints.
    const memoryType = variable === "hook" ? "hook"
      : variable === "tone" ? "tone"
      : "script";

    // Pull condition + time_of_day + voice info from the winning post.
    const winnerPostId = winner === "A" ? e.post_id_a : e.post_id_b;
    const winnerViews = winner === "A" ? a.views : b.views;
    let winnerCondition: string | null = null;
    let winnerTimeOfDay: string | null = null;
    let winnerVoiceId: string | null = null;
    let winnerVoiceStyle: string | null = null;
    try {
      const { data: pa } = await supabase
        .from("post_analytics")
        .select("condition, time_of_day")
        .eq("post_id", winnerPostId)
        .limit(1)
        .maybeSingle();
      winnerCondition = pa?.condition?.toLowerCase() || null;
      winnerTimeOfDay = pa?.time_of_day || null;

      const { data: ph } = await supabase
        .from("post_history")
        .select("debug_trace")
        .eq("id", winnerPostId)
        .limit(1)
        .maybeSingle();
      const trace = (ph?.debug_trace as any) || {};
      // debug_trace.voice_config = { voice_id, ... } when voiceover ran
      winnerVoiceId = trace?.voice_config?.voice_id ?? trace?.voice_id ?? null;
      if (winnerVoiceId) {
        const { classifyVoiceStyle } = await import("../_shared/voice-memory.ts");
        winnerVoiceStyle = classifyVoiceStyle(winnerVoiceId);
      }
    } catch (_e) { /* best-effort enrichment */ }

    await supabase.from("ai_memory").insert({
      user_id: e.user_id,
      memory_type: memoryType,
      content: winnerVal,
      performance_score: deltaPct,
      condition: winnerCondition,
      time_of_day: winnerTimeOfDay,
      voice_id: winnerVoiceId,
      voice_style: winnerVoiceStyle,
      views: winnerViews,
    });
  }

  await supabase.from("system_health").upsert({
    id: "experiments-resolve",
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_message: `due=${exps.length} resolved=${resolved} winners=${winners}`,
  });

  return new Response(
    JSON.stringify({ due: exps.length, resolved, winners }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

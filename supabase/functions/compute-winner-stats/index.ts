// compute-winner-stats — Auto-Winner Layer 2 + 5
//
// Aggregates per-user/per-city analytics into `winner_stats` (best hook,
// best/worst hour, best condition, cinematic & voice lift) and inserts
// "outperforming post" suggestions into `winner_repost_suggestions` when a
// post's views_24h > city_avg * 1.5.
//
// Pure read on post_history / post_analytics. Writes ONLY to:
//   - post_analytics (the new score/views_24h columns it owns)
//   - winner_stats
//   - winner_repost_suggestions
//   - notifications (informational)
//
// Does NOT touch render or posting pipeline.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PARow {
  id: string;
  user_id: string;
  post_id: string | null;
  city: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  avg_percentage_viewed: number | null;
  has_voiceover: boolean | null;
  cinematic: boolean | null;
  hook_type: string | null;
  condition: string | null;
  posted_at: string | null;
  posted_hour: number | null;
  views_24h: number | null;
  views_7d: number | null;
  score: number | null;
}

function avg(xs: number[]) {
  if (!xs.length) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function bestBucket<T extends string | number>(
  rows: PARow[],
  key: (r: PARow) => T | null,
  minSamples = 2,
) {
  const m = new Map<T, number[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(Number(r.score || 0));
  }
  let best: { k: T; avg: number; n: number } | null = null;
  let worst: { k: T; avg: number; n: number } | null = null;
  for (const [k, vs] of m) {
    if (vs.length < minSamples) continue;
    const a = avg(vs);
    if (!best || a > best.avg) best = { k, avg: a, n: vs.length };
    if (!worst || a < worst.avg) worst = { k, avg: a, n: vs.length };
  }
  return { best, worst };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1. Refresh post_analytics derived fields from post_history (recent 60d)
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const { data: history } = await supabase
      .from("post_history")
      .select(
        "id, user_id, city, created_at, hook_id, hook_used, cinematic_mode, views_count, likes_count, retention_rate, condition",
      )
      .gte("created_at", since)
      .eq("status", "posted");

    const hookIdToType = (id: string | null): string | null => {
      if (!id) return null;
      const s = id.toLowerCase();
      if (s.includes("a") || s === "0") return "A";
      if (s.includes("b") || s === "1") return "B";
      if (s.includes("c") || s === "2") return "C";
      return null;
    };

    for (const h of history || []) {
      const score =
        Number(h.views_count || 0) * 1.0 +
        Number(h.likes_count || 0) * 10.0 +
        Number(h.retention_rate || 0) * 50.0;
      const postedAt = h.created_at;
      const ageHours = (Date.now() - new Date(postedAt).getTime()) / 3_600_000;
      const patch: Record<string, unknown> = {
        city: h.city,
        posted_at: postedAt,
        posted_hour: new Date(postedAt).getUTCHours(),
        cinematic: h.cinematic_mode,
        hook_text: h.hook_used,
        hook_type: hookIdToType(h.hook_id),
        score,
      };
      if (ageHours <= 36) patch.views_24h = Number(h.views_count || 0);
      if (ageHours <= 24 * 8) patch.views_7d = Number(h.views_count || 0);

      // Find existing PA row for this post; if none, insert minimal one.
      const { data: existing } = await supabase
        .from("post_analytics")
        .select("id")
        .eq("post_id", h.id)
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        await supabase.from("post_analytics").update(patch).eq("id", existing.id);
      } else {
        await supabase.from("post_analytics").insert({
          user_id: h.user_id,
          post_id: h.id,
          platform: "aggregate",
          views: h.views_count || 0,
          likes: h.likes_count || 0,
          comments: 0,
          condition: h.condition,
          ...patch,
        });
      }
    }

    // 2. Pull all PA rows and group by (user, city)
    const { data: paRows } = await supabase
      .from("post_analytics")
      .select(
        "id, user_id, post_id, city, views, likes, comments, avg_percentage_viewed, has_voiceover, cinematic, hook_type, condition, posted_at, posted_hour, views_24h, views_7d, score",
      )
      .gte("posted_at", since);

    const groups = new Map<string, PARow[]>();
    for (const r of (paRows || []) as PARow[]) {
      if (!r.user_id || !r.city) continue;
      const k = `${r.user_id}::${r.city}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }

    let groupsWritten = 0;
    let suggestionsCreated = 0;

    for (const [k, rows] of groups) {
      const [user_id, city] = k.split("::");
      if (rows.length < 2) continue;

      const hook = bestBucket(rows, (r) => r.hook_type);
      const hour = bestBucket(rows, (r) => r.posted_hour);
      const cond = bestBucket(rows, (r) => (r.condition ? r.condition.toLowerCase() : null));

      const cinOn = rows.filter((r) => r.cinematic === true).map((r) => Number(r.score || 0));
      const cinOff = rows.filter((r) => r.cinematic === false).map((r) => Number(r.score || 0));
      const cinematicLift =
        cinOn.length >= 2 && cinOff.length >= 2 && avg(cinOff) > 0
          ? Math.round(((avg(cinOn) - avg(cinOff)) / avg(cinOff)) * 100)
          : null;

      const vOn = rows.filter((r) => r.has_voiceover === true).map((r) => Number(r.score || 0));
      const vOff = rows.filter((r) => r.has_voiceover === false).map((r) => Number(r.score || 0));
      const voiceLift =
        vOn.length >= 2 && vOff.length >= 2 && avg(vOff) > 0
          ? Math.round(((avg(vOn) - avg(vOff)) / avg(vOff)) * 100)
          : null;

      const cityAvgViews = avg(rows.map((r) => Number(r.views || 0)));

      await supabase.from("winner_stats").upsert(
        {
          user_id,
          city,
          computed_at: new Date().toISOString(),
          best_hook_type: hook.best?.k ?? null,
          best_hook_avg: hook.best?.avg ?? null,
          best_hour: hook.best ? (hour.best?.k as number) ?? null : null,
          best_hour_avg: hour.best?.avg ?? null,
          worst_hour: hour.worst?.k ?? null,
          worst_hour_avg: hour.worst?.avg ?? null,
          best_condition: cond.best?.k ?? null,
          best_condition_avg: cond.best?.avg ?? null,
          cinematic_lift_pct: cinematicLift,
          voice_lift_pct: voiceLift,
          city_avg_views: cityAvgViews,
          sample_size: rows.length,
          raw: {
            hook_buckets: hook,
            hour_buckets: hour,
            condition_buckets: cond,
          },
        },
        { onConflict: "user_id,city" },
      );
      groupsWritten++;

      // 3. Outperforming-post suggestions
      const threshold = cityAvgViews * 1.5;
      for (const r of rows) {
        if (!r.post_id) continue;
        if (!r.views_24h || r.views_24h < threshold) continue;
        const { data: existing } = await supabase
          .from("winner_repost_suggestions")
          .select("id")
          .eq("post_id", r.post_id)
          .limit(1)
          .maybeSingle();
        if (existing) continue;
        await supabase.from("winner_repost_suggestions").insert({
          user_id,
          post_id: r.post_id,
          city,
          views_24h: r.views_24h,
          city_avg: cityAvgViews,
          reason: `${r.views_24h} views vs city avg ${Math.round(cityAvgViews)} (+${Math.round(((r.views_24h - cityAvgViews) / Math.max(cityAvgViews, 1)) * 100)}%)`,
        });
        await supabase.from("notifications").insert({
          user_id,
          type: "success",
          title: "🔥 Post outperforming",
          message: `Your ${city} post is at ${r.views_24h} views — well above your average. Consider a repost variation.`,
        });
        suggestionsCreated++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, groupsWritten, suggestionsCreated }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

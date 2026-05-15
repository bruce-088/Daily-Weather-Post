// Pattern analyzer — runs daily at 00:00 UTC.
// Groups post_analytics by (user_id, condition, tone, time_of_day) for the
// last 60 days, computes avg views + engagement, picks the best top_hook
// example from post_hooks, and upserts the leaderboard into content_insights.
//
// content_insights is keyed (user_id, condition, tone, time_of_day) UNIQUE
// so this is a deterministic refresh.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AnalyticsRow {
  user_id: string;
  post_id: string | null;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  tone: string | null;
  condition: string | null;
  time_of_day: string | null;
}

interface HookRow {
  user_id: string;
  post_id: string | null;
  tone: string | null;
  hook_text: string | null;
}

import { requireCronOrUser } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const { data: rows, error } = await supabase
    .from("post_analytics")
    .select("user_id, post_id, platform, views, likes, comments, shares, tone, condition, time_of_day")
    .gte("created_at", since)
    .not("tone", "is", null)
    .not("condition", "is", null)
    .not("time_of_day", "is", null);

  if (error) {
    console.error("[analyze] fetch failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {

  const _gate = await requireCronOrUser(req);
  if (!_gate.ok) return _gate.response;
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const all = (rows || []) as AnalyticsRow[];
  console.log(`[analyze] processing ${all.length} analytics rows`);

  // Pull hooks for hook-text examples
  const { data: hookRows } = await supabase
    .from("post_hooks")
    .select("user_id, post_id, tone, hook_text")
    .gte("created_at", since);

  const hookByPost = new Map<string, HookRow>();
  for (const h of (hookRows || []) as HookRow[]) {
    if (h.post_id) hookByPost.set(h.post_id, h);
  }

  // Group: user|condition|tone|time_of_day → aggregate
  type Bucket = {
    user_id: string;
    condition: string;
    tone: string;
    time_of_day: string;
    totalViews: number;
    totalEngagement: number;
    samples: number;
    bestPostId: string | null;
    bestViews: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of all) {
    if (!r.tone || !r.condition || !r.time_of_day) continue;
    const key = `${r.user_id}|${r.condition.toLowerCase()}|${r.tone.toLowerCase()}|${r.time_of_day}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        user_id: r.user_id,
        condition: r.condition.toLowerCase(),
        tone: r.tone.toLowerCase(),
        time_of_day: r.time_of_day,
        totalViews: 0,
        totalEngagement: 0,
        samples: 0,
        bestPostId: null,
        bestViews: -1,
      };
      buckets.set(key, b);
    }
    const eng = (r.likes || 0) + (r.comments || 0) + (r.shares || 0);
    b.totalViews += r.views || 0;
    b.totalEngagement += eng;
    b.samples += 1;
    if ((r.views || 0) > b.bestViews) {
      b.bestViews = r.views || 0;
      b.bestPostId = r.post_id;
    }
  }

  // Compute per-user baseline avg views (across all buckets) for delta_pct.
  const userBaseline = new Map<string, { totalViews: number; samples: number }>();
  for (const b of buckets.values()) {
    const u = userBaseline.get(b.user_id) || { totalViews: 0, samples: 0 };
    u.totalViews += b.totalViews;
    u.samples += b.samples;
    userBaseline.set(b.user_id, u);
  }

  // Build insight rows
  const insights: any[] = [];
  // Track per-user (condition,time_of_day) ranking
  const ranking = new Map<string, Bucket[]>();
  for (const b of buckets.values()) {
    const k = `${b.user_id}|${b.condition}|${b.time_of_day}`;
    if (!ranking.has(k)) ranking.set(k, []);
    ranking.get(k)!.push(b);
  }

  for (const list of ranking.values()) {
    list.sort((a, b) => (b.totalViews / b.samples) - (a.totalViews / a.samples));
    list.forEach((b, idx) => {
      const avgViews = b.samples ? b.totalViews / b.samples : 0;
      const avgEng = b.samples ? b.totalEngagement / b.samples : 0;
      const baseline = userBaseline.get(b.user_id);
      const userAvg = baseline && baseline.samples
        ? baseline.totalViews / baseline.samples
        : 0;
      const delta_pct = userAvg > 0 ? ((avgViews - userAvg) / userAvg) * 100 : null;
      const hook = b.bestPostId ? hookByPost.get(b.bestPostId) : null;
      insights.push({
        user_id: b.user_id,
        condition: b.condition,
        tone: b.tone,
        time_of_day: b.time_of_day,
        avg_views: avgViews,
        avg_engagement: avgEng,
        sample_size: b.samples,
        top_hook: hook?.hook_text || null,
        delta_pct,
        rank: idx + 1,
        computed_at: new Date().toISOString(),
      });
    });
  }

  // Wipe stale rows for users we just analyzed, then insert fresh.
  // (Simpler than per-row upsert because the unique key matches.)
  const userIds = Array.from(new Set(insights.map((i) => i.user_id)));
  if (userIds.length > 0) {
    const { error: delErr } = await supabase
      .from("content_insights")
      .delete()
      .in("user_id", userIds);
    if (delErr) console.error("[analyze] delete previous insights failed:", delErr);
  }

  let inserted = 0;
  if (insights.length > 0) {
    // Insert in batches of 500
    for (let i = 0; i < insights.length; i += 500) {
      const slice = insights.slice(i, i + 500);
      const { error: insErr } = await supabase.from("content_insights").insert(slice);
      if (insErr) {
        console.error("[analyze] insert insights failed:", insErr);
      } else {
        inserted += slice.length;
      }
    }
  }

  await supabase.from("system_health").upsert({
    id: "analyze-performance",
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_message: `users=${userIds.length} insights=${inserted}`,
  });

  console.log(`[analyze] done — users=${userIds.length} insights=${inserted}`);

  return new Response(
    JSON.stringify({ users: userIds.length, insights: inserted, samples: all.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

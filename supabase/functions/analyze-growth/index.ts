// Auto-Growth analyzer.
// Runs every 6 hours alongside sync-platform-metrics.
//
// For each user, computes:
//   1. Hook leaderboard → hook_stats (top/active/retired)
//   2. Day-of-week × hour heatmap → time_slot_stats
//   3. Variety state (last 3 tones, last opener)
//   4. AI Recommendation summary → growth_recommendations
//
// Reads:  post_analytics (last 60d), post_hooks (last 60d), post_history
// Writes: hook_stats, time_slot_stats, growth_recommendations

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface AnalyticsRow {
  user_id: string;
  post_id: string | null;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  tone: string | null;
  created_at: string;
}

interface HookRow {
  user_id: string;
  post_id: string | null;
  hook_text: string | null;
  opener: string | null;
  tone: string | null;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: aRows }, { data: hRows }, { data: pRows }] = await Promise.all([
    supabase
      .from("post_analytics")
      .select("user_id, post_id, views, likes, comments, shares, tone, created_at")
      .gte("created_at", since),
    supabase
      .from("post_hooks")
      .select("user_id, post_id, hook_text, opener, tone, created_at")
      .gte("created_at", since),
    supabase
      .from("post_history")
      .select("id, user_id, created_at, status")
      .gte("created_at", since)
      .eq("status", "posted"),
  ]);

  const analytics = (aRows || []) as AnalyticsRow[];
  const hooks = (hRows || []) as HookRow[];
  const posts = (pRows || []) as { id: string; user_id: string; created_at: string }[];

  // Index hooks by post_id for join
  const hookByPost = new Map<string, HookRow>();
  for (const h of hooks) if (h.post_id) hookByPost.set(h.post_id, h);

  // Index post created_at by id
  const postCreatedAt = new Map<string, string>();
  for (const p of posts) postCreatedAt.set(p.id, p.created_at);

  // Collect per-user data
  const userIds = Array.from(new Set([
    ...analytics.map(a => a.user_id),
    ...hooks.map(h => h.user_id),
    ...posts.map(p => p.user_id),
  ]));

  const eng = (a: AnalyticsRow) => (a.likes || 0) + (a.comments || 0) + (a.shares || 0);

  let hookStatsCount = 0;
  let timeSlotsCount = 0;

  for (const userId of userIds) {
    // ===== 1. HOOK STATS =====
    type HookAgg = { uses: number; views: number; eng: number; lastUsedAt: string };
    const hookAgg = new Map<string, HookAgg>();

    for (const h of hooks) {
      if (h.user_id !== userId) continue;
      if (!h.hook_text) continue;
      const a = hookAgg.get(h.hook_text) || { uses: 0, views: 0, eng: 0, lastUsedAt: h.created_at };
      a.uses += 1;
      if (h.created_at > a.lastUsedAt) a.lastUsedAt = h.created_at;
      // Find analytics for this post
      if (h.post_id) {
        const matches = analytics.filter(x => x.post_id === h.post_id && x.user_id === userId);
        for (const m of matches) {
          a.views += m.views || 0;
          a.eng += eng(m);
        }
      }
      hookAgg.set(h.hook_text, a);
    }

    const hookList = Array.from(hookAgg.entries()).map(([text, a]) => ({
      hook_text: text,
      uses: a.uses,
      total_views: a.views,
      avg_views: a.uses ? a.views / a.uses : 0,
      total_engagement: a.eng,
      last_used_at: a.lastUsedAt,
    }));

    // Rank by avg_views (only hooks with >=1 use); flag top/retired only when uses>=10
    hookList.sort((x, y) => y.avg_views - x.avg_views);
    const overallAvg = hookList.length
      ? hookList.reduce((s, x) => s + x.avg_views, 0) / hookList.length
      : 0;

    const hookRows = hookList.map((h, idx) => {
      let status: "top" | "active" | "retired" = "active";
      if (h.uses >= 10) {
        if (idx < 3) status = "top";
        else if (h.avg_views < overallAvg * 0.7) status = "retired";
      }
      return {
        user_id: userId,
        hook_text: h.hook_text,
        uses: h.uses,
        total_views: h.total_views,
        avg_views: h.avg_views,
        total_engagement: h.total_engagement,
        status,
        rank: idx + 1,
        last_used_at: h.last_used_at,
        computed_at: new Date().toISOString(),
      };
    });

    if (hookRows.length > 0) {
      // Replace user's rows
      await supabase.from("hook_stats").delete().eq("user_id", userId);
      const { error } = await supabase.from("hook_stats").insert(hookRows);
      if (error) console.error("[analyze-growth] hook_stats insert failed", userId, error);
      else hookStatsCount += hookRows.length;
    }

    // ===== 2. TIME SLOT STATS =====
    type SlotAgg = { posts: number; views: number; eng: number };
    const slotAgg = new Map<string, SlotAgg>(); // key: dow|hour
    for (const a of analytics) {
      if (a.user_id !== userId) continue;
      const ts = (a.post_id && postCreatedAt.get(a.post_id)) || a.created_at;
      const d = new Date(ts);
      const key = `${d.getUTCDay()}|${d.getUTCHours()}`;
      const cur = slotAgg.get(key) || { posts: 0, views: 0, eng: 0 };
      cur.posts += 1;
      cur.views += a.views || 0;
      cur.eng += eng(a);
      slotAgg.set(key, cur);
    }
    const slotRows = Array.from(slotAgg.entries()).map(([k, v]) => {
      const [dow, hour] = k.split("|").map(Number);
      return {
        user_id: userId,
        day_of_week: dow,
        hour,
        posts: v.posts,
        total_views: v.views,
        avg_views: v.posts ? v.views / v.posts : 0,
        total_engagement: v.eng,
        computed_at: new Date().toISOString(),
      };
    });
    if (slotRows.length > 0) {
      await supabase.from("time_slot_stats").delete().eq("user_id", userId);
      const { error } = await supabase.from("time_slot_stats").insert(slotRows);
      if (error) console.error("[analyze-growth] time_slot_stats insert failed", userId, error);
      else timeSlotsCount += slotRows.length;
    }

    // ===== 3. VARIETY STATE — last 3 hook entries (most recent first) =====
    const userHooksRecent = hooks
      .filter(h => h.user_id === userId)
      .sort((x, y) => y.created_at.localeCompare(x.created_at))
      .slice(0, 5);
    const recentTones = userHooksRecent.map(h => (h.tone || "").toLowerCase()).filter(Boolean);
    const recentOpeners = userHooksRecent.map(h => h.opener || "").filter(Boolean);

    // Variety score 0-100: penalize tone repetition
    let varietyScore = 100;
    if (recentTones.length >= 3) {
      const last3 = recentTones.slice(0, 3);
      if (new Set(last3).size === 1) varietyScore = 40;
      else if (new Set(last3).size === 2) varietyScore = 75;
    }

    // ===== 4. RECOMMENDATION =====
    const topHooks = hookRows.filter(h => h.status === "top").slice(0, 3).map(h => h.hook_text);
    const bestSlot = slotRows.length
      ? slotRows.slice().sort((a, b) => b.avg_views - a.avg_views).filter(s => s.posts >= 1)[0]
      : null;

    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const fmtHour = (h: number) => {
      const p = h >= 12 ? "PM" : "AM";
      const hr = h % 12 === 0 ? 12 : h % 12;
      return `${hr}${p}`;
    };

    let recommendation = "Keep posting consistently — we'll surface insights once we have more data.";
    if (bestSlot && topHooks.length > 0) {
      recommendation = `Post on ${dayNames[bestSlot.day_of_week]} ${fmtHour(bestSlot.hour)} using your top hook for the strongest reach.`;
    } else if (bestSlot) {
      recommendation = `Your highest-engagement slot is ${dayNames[bestSlot.day_of_week]} ${fmtHour(bestSlot.hour)} (avg ${Math.round(bestSlot.avg_views).toLocaleString()} views).`;
    } else if (topHooks.length > 0) {
      recommendation = `Lean on your top hook: "${topHooks[0]}".`;
    }
    if (varietyScore < 60 && recentTones[0]) {
      recommendation += ` Variety is low — try a different tone than ${recentTones[0]} on the next post.`;
    }

    await supabase.from("growth_recommendations").upsert({
      user_id: userId,
      recommendation,
      top_hooks: topHooks,
      best_slot: bestSlot
        ? { day_of_week: bestSlot.day_of_week, hour: bestSlot.hour, avg_views: bestSlot.avg_views }
        : null,
      variety_score: varietyScore,
      recent_tones: recentTones,
      recent_openers: recentOpeners,
      computed_at: new Date().toISOString(),
    });
  }

  await supabase.from("system_health").upsert({
    id: "analyze-growth",
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_message: `users=${userIds.length} hooks=${hookStatsCount} slots=${timeSlotsCount}`,
  });

  console.log(`[analyze-growth] users=${userIds.length} hooks=${hookStatsCount} slots=${timeSlotsCount}`);

  return new Response(
    JSON.stringify({ users: userIds.length, hooks: hookStatsCount, slots: timeSlotsCount }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

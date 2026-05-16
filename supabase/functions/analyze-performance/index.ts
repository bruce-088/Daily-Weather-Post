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

  const _gate = await requireCronOrUser(req);
  if (!_gate.ok) return _gate.response;

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

  // ====================================================================
  // PHASE 1 — Per-post insight engine: performance_score + factors.
  // Scores each post 0–100 vs the user's own 60d baseline and labels
  // winning/losing factors. Updates post_analytics in batches.
  // Min sample size: 5 posts per user (Phase 5 safeguard).
  // ====================================================================

  let scoredPosts = 0;
  let scoredUsers = 0;
  const memoryUpserts: any[] = [];

  try {
    // Pull full analytics rows (need id + retention + post_id + flags)
    const { data: fullRows } = await supabase
      .from("post_analytics")
      .select("id, user_id, post_id, views, likes, comments, shares, tone, condition, time_of_day, has_voiceover, cinematic, hook_text, avg_percentage_viewed")
      .gte("created_at", since);

    const byUser = new Map<string, any[]>();
    for (const r of (fullRows || []) as any[]) {
      const arr = byUser.get(r.user_id) || [];
      arr.push(r);
      byUser.set(r.user_id, arr);
    }

    // Pull captions for ai_memory top-post seeding
    const allPostIds = ((fullRows || []) as any[]).map((r) => r.post_id).filter(Boolean);
    const captionByPost = new Map<string, { caption: string | null; city: string | null }>();
    if (allPostIds.length > 0) {
      for (let i = 0; i < allPostIds.length; i += 200) {
        const chunk = allPostIds.slice(i, i + 200);
        const { data: ph } = await supabase
          .from("post_history")
          .select("id, caption, city")
          .in("id", chunk);
        for (const p of (ph || []) as any[]) {
          captionByPost.set(p.id, { caption: p.caption, city: p.city });
        }
      }
    }

    const updates: Array<{ id: string; performance_score: number; winning_factors: string[]; losing_factors: string[] }> = [];

    for (const [userId, rows] of byUser.entries()) {
      if (rows.length < 5) continue; // safeguard
      scoredUsers += 1;

      const avgViews = rows.reduce((s, r) => s + (r.views || 0), 0) / rows.length;
      const avgEng = rows.reduce((s, r) => s + ((r.likes || 0) + (r.comments || 0) + (r.shares || 0)), 0) / rows.length;
      const retentionRows = rows.filter((r) => typeof r.avg_percentage_viewed === "number" && r.avg_percentage_viewed > 0);
      const avgRet = retentionRows.length
        ? retentionRows.reduce((s, r) => s + (r.avg_percentage_viewed || 0), 0) / retentionRows.length
        : 0;

      // Per-factor baselines for tone/slot/condition/cinematic/voiceover/hook
      const factorAvg = (key: "tone" | "time_of_day" | "condition" | "hook_text", value: string) => {
        const matches = rows.filter((r) => (r[key] || "").toString().toLowerCase() === value.toLowerCase());
        if (matches.length < 2) return null;
        return matches.reduce((s, r) => s + (r.views || 0), 0) / matches.length;
      };
      const boolFactorAvg = (key: "cinematic" | "has_voiceover", value: boolean) => {
        const matches = rows.filter((r) => !!r[key] === value);
        if (matches.length < 2) return null;
        return matches.reduce((s, r) => s + (r.views || 0), 0) / matches.length;
      };

      const topRowForMemory = { id: null as string | null, score: -1, caption: null as string | null, condition: null as string | null, tone: null as string | null, tod: null as string | null };

      for (const r of rows) {
        const viewRatio = avgViews > 0 ? (r.views || 0) / avgViews : 1;
        const engVal = (r.likes || 0) + (r.comments || 0) + (r.shares || 0);
        const engRatio = avgEng > 0 ? engVal / avgEng : 1;
        const retVal = typeof r.avg_percentage_viewed === "number" ? r.avg_percentage_viewed : null;
        const retRatio = retVal && avgRet > 0 ? retVal / avgRet : null;

        // 50 / 30 / 20 weights; renormalize if retention is missing.
        const wView = retRatio === null ? 0.625 : 0.5;
        const wEng = retRatio === null ? 0.375 : 0.3;
        const wRet = retRatio === null ? 0 : 0.2;
        const blend = wView * viewRatio + wEng * engRatio + wRet * (retRatio ?? 0);
        // ratio of 1.0 = baseline → 50; clamp blend to [0, 2]
        const clamped = Math.max(0, Math.min(2, blend));
        const performance_score = Math.round(clamped * 50);

        // Factor labeling: ≥+15% wins, ≤−15% losers
        const winning: string[] = [];
        const losing: string[] = [];
        const checkRatio = (label: string, ratio: number | null) => {
          if (ratio === null) return;
          if (ratio >= 1.15) winning.push(label);
          else if (ratio <= 0.85) losing.push(label);
        };

        if (r.tone) {
          const fa = factorAvg("tone", r.tone);
          if (fa !== null && avgViews > 0) checkRatio(`tone:${r.tone}`, fa / avgViews);
        }
        if (r.time_of_day) {
          const fa = factorAvg("time_of_day", r.time_of_day);
          if (fa !== null && avgViews > 0) checkRatio(`slot:${r.time_of_day}`, fa / avgViews);
        }
        if (r.condition) {
          const fa = factorAvg("condition", r.condition);
          if (fa !== null && avgViews > 0) checkRatio(`condition:${r.condition}`, fa / avgViews);
        }
        if (r.hook_text) {
          const fa = factorAvg("hook_text", r.hook_text);
          if (fa !== null && avgViews > 0) checkRatio(`hook:${String(r.hook_text).slice(0, 60)}`, fa / avgViews);
        }
        if (r.cinematic === true || r.cinematic === false) {
          const fa = boolFactorAvg("cinematic", true);
          if (fa !== null && avgViews > 0 && r.cinematic === true) checkRatio("cinematic", fa / avgViews);
        }
        if (r.has_voiceover === true || r.has_voiceover === false) {
          const fa = boolFactorAvg("has_voiceover", true);
          if (fa !== null && avgViews > 0 && r.has_voiceover === true) checkRatio("voiceover", fa / avgViews);
        }

        updates.push({
          id: r.id,
          performance_score,
          winning_factors: winning.slice(0, 6),
          losing_factors: losing.slice(0, 6),
        });
        scoredPosts += 1;

        // Track best post per user for ai_memory
        if (performance_score > topRowForMemory.score && r.post_id) {
          const ph = captionByPost.get(r.post_id);
          if (ph?.caption) {
            topRowForMemory.id = r.post_id;
            topRowForMemory.score = performance_score;
            topRowForMemory.caption = ph.caption;
            topRowForMemory.condition = r.condition || null;
            topRowForMemory.tone = r.tone || null;
            topRowForMemory.tod = r.time_of_day || null;
          }
        }
      }

      if (topRowForMemory.id && topRowForMemory.score >= 70 && topRowForMemory.caption) {
        memoryUpserts.push({
          user_id: userId,
          memory_type: "top_post",
          content: String(topRowForMemory.caption).slice(0, 1200),
          condition: topRowForMemory.condition,
          voice_style: topRowForMemory.tone,
          time_of_day: topRowForMemory.tod,
          performance_score: topRowForMemory.score,
          views: 0,
        });
      }
    }

    // Batch update post_analytics in chunks of 200 (one row at a time per Supabase JS;
    // we use parallel batches via Promise.all to keep the function fast).
    for (let i = 0; i < updates.length; i += 50) {
      const batch = updates.slice(i, i + 50);
      await Promise.all(batch.map((u) =>
        supabase.from("post_analytics").update({
          performance_score: u.performance_score,
          winning_factors: u.winning_factors,
          losing_factors: u.losing_factors,
        }).eq("id", u.id)
      ));
    }

    if (memoryUpserts.length > 0) {
      const { error: memErr } = await supabase.from("ai_memory").insert(memoryUpserts);
      if (memErr) console.warn("[analyze] ai_memory upsert failed:", memErr.message);
    }
  } catch (e) {
    console.error("[analyze] phase-1 scoring failed:", e);
  }

  await supabase.from("system_health").upsert({
    id: "analyze-performance",
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_message: `users=${userIds.length} insights=${inserted} scored=${scoredPosts}`,
  });

  console.log(`[analyze] done — users=${userIds.length} insights=${inserted} scored=${scoredPosts} (across ${scoredUsers} users) memories=${memoryUpserts.length}`);

  return new Response(
    JSON.stringify({ users: userIds.length, insights: inserted, samples: all.length, scored_posts: scoredPosts, scored_users: scoredUsers, memories_added: memoryUpserts.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

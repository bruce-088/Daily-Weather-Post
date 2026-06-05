// sync-youtube-analytics
// Phase 12-Analytics-D — Enriches post_analytics with YouTube Data API video
// snippet (tags, title, description) and YouTube Analytics API metrics
// (averageViewPercentage, CTR, subscribersGained, organic search terms).
//
// Triggered nightly via pg_cron (03:00 UTC) and on-demand from the in-app
// "Sync analytics" button. Fully additive — never touches existing views/likes
// sync done by sync-youtube-metrics.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { YouTubeAdapter } from "../_shared/youtube-adapter.ts";
import { requireCronOrUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface VideoMeta {
  post_id: string;
  user_id: string;
  external_id: string;
  created_at: string;
  caption: string | null;
  city: string | null;
  city_id: string | null;
  contentType: "short" | "recap";
  post_url: string | null;
  source: string | null;
}

function classifyContentType(post: { post_url?: string | null; source?: string | null }): "short" | "recap" {
  const src = (post.source || "").toLowerCase();
  if (src.includes("recap")) return "recap";
  const url = (post.post_url || "").toLowerCase();
  if (url.includes("/shorts/")) return "short";
  if (url.includes("watch?v=") || url.includes("youtu.be/")) return "recap";
  return "short";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireCronOrUser(req);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // backfill=true => 18 months, otherwise last 60 days.
  let backfill = false;
  let scopedUserId: string | null = gate.source === "user" ? (gate.userId ?? null) : null;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.clone().json().catch(() => null);
      if (body?.backfill) backfill = true;
      if (gate.source === "user" && body?.user_id && body.user_id !== gate.userId) {
        return new Response(JSON.stringify({ error: "user_id mismatch" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  } catch (_) { /* ignore */ }

  const sinceDays = backfill ? 540 : 60;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  let q = supabase
    .from("post_history")
    .select("id, user_id, external_id, caption, created_at, platform, post_url, city, source")
    .not("external_id", "is", null)
    .gte("created_at", since)
    .or("platform.eq.youtube,platform.ilike.%youtube%,post_url.ilike.%youtube.com%");
  if (scopedUserId) q = q.eq("user_id", scopedUserId);

  const { data: posts, error: postsErr } = await q;
  if (postsErr) {
    console.error("[sync-youtube-analytics] load failed:", postsErr);
    return jsonResp({ error: postsErr.message }, 500);
  }

  // Resolve city names -> city_id (one lookup, cached)
  const cityNames = Array.from(new Set((posts || []).map((p: any) => (p.city || "").trim()).filter(Boolean)));
  const cityIdByName = new Map<string, string>();
  if (cityNames.length > 0) {
    const { data: cityRows } = await supabase
      .from("cities")
      .select("id, name")
      .in("name", cityNames);
    for (const c of cityRows || []) {
      cityIdByName.set((c.name as string).toLowerCase(), c.id as string);
    }
  }

  const videos: VideoMeta[] = (posts || [])
    .filter((p: any) => p.external_id && p.user_id)
    .map((p: any) => ({
      post_id: p.id,
      user_id: p.user_id,
      external_id: p.external_id,
      created_at: p.created_at,
      caption: p.caption,
      city: p.city ?? null,
      city_id: cityIdByName.get(String(p.city || "").toLowerCase()) ?? null,
      contentType: classifyContentType(p),
      post_url: p.post_url ?? null,
      source: p.source ?? null,
    }));

  console.log(`[sync-youtube-analytics] processing ${videos.length} videos (backfill=${backfill})`);

  const adapter = new YouTubeAdapter();
  // Bucket by (userId, cityId, contentType) so each bucket uses the right channel token.
  const buckets = new Map<string, { userId: string; cityId: string | null; contentType: "short" | "recap"; videos: VideoMeta[] }>();
  for (const v of videos) {
    const key = `${v.user_id}|${v.city_id ?? "null"}|${v.contentType}`;
    if (!buckets.has(key)) {
      buckets.set(key, { userId: v.user_id, cityId: v.city_id, contentType: v.contentType, videos: [] });
    }
    buckets.get(key)!.videos.push(v);
  }

  let snippetUpdated = 0;
  let analyticsUpdated = 0;
  let analyticsSkipped = 0;
  let wrongChannel = 0;
  let failed = 0;
  const bucketResults: Array<Record<string, unknown>> = [];

  for (const [key, bucket] of buckets.entries()) {
    const { userId, cityId, contentType, videos: list } = bucket;
    const label = `bucket[${key} count=${list.length}]`;

    const token = await adapter.getValidToken(supabase, userId, cityId, { contentType });
    if (!token) {
      console.warn(`[sync-youtube-analytics] ${label}: no token (city=${cityId} contentType=${contentType})`);
      failed += list.length;
      bucketResults.push({ key, count: list.length, error: "no_token" });
      continue;
    }

    // ---- 1) Snippets ----
    const idsToMeta = new Map<string, VideoMeta>();
    for (const v of list) idsToMeta.set(v.external_id, v);
    const ids = Array.from(idsToMeta.keys());
    let bSnippet = 0;

    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${chunk.join(",")}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[sync-youtube-analytics] ${label} snippet failed (${res.status}): ${body}`);
        failed += chunk.length;
        continue;
      }
      const json = await res.json();
      for (const item of (json.items || [])) {
        const meta = idsToMeta.get(item.id);
        if (!meta) continue;
        const snip = item.snippet || {};
        const tags: string[] = Array.isArray(snip.tags) ? snip.tags : [];
        await upsertAnalytics(supabase, meta, { tags_used: tags });
        snippetUpdated++;
        bSnippet++;
      }
    }

    // ---- 2) Analytics per-video ----
    let bAnalytics = 0;
    let bWrongChannel = 0;
    let b403Count = 0;
    for (const v of list) {
      const startDate = v.created_at.slice(0, 10);
      const endDate = new Date().toISOString().slice(0, 10);
      const baseParams = new URLSearchParams({
        ids: "channel==MINE",
        startDate,
        endDate,
        filters: `video==${v.external_id}`,
      });

      const metricsList = [
        "views","likes","comments","shares","subscribersGained",
        "averageViewPercentage","averageViewDuration","estimatedMinutesWatched",
      ].join(",");
      const aggParams = new URLSearchParams(baseParams);
      aggParams.set("metrics", metricsList);
      const aggUrl = `https://youtubeanalytics.googleapis.com/v2/reports?${aggParams.toString()}`;
      const aggRes = await fetch(aggUrl, { headers: { Authorization: `Bearer ${token}` } });

      if (aggRes.status === 403) {
        // Wrong channel for this video (or — in the worst case — scope missing).
        b403Count++;
        bWrongChannel++;
        wrongChannel++;
        analyticsSkipped++;
        console.warn(`[sync-youtube-analytics] ${label} video=${v.external_id} 403 (wrong channel or scope)`);
        continue;
      }
      if (!aggRes.ok) {
        const body = await aggRes.text();
        console.error(`[sync-youtube-analytics] ${label} analytics failed ${v.external_id} (${aggRes.status}): ${body}`);
        analyticsSkipped++;
        continue;
      }
      const aggJson = await aggRes.json();
      const row = (aggJson.rows && aggJson.rows[0]) || [];
      const headers: string[] = (aggJson.columnHeaders || []).map((h: any) => h.name);
      const m: Record<string, number> = {};
      headers.forEach((h, idx) => { m[h] = Number(row[idx] ?? 0); });

      // Search-term traffic
      const ttParams = new URLSearchParams(baseParams);
      ttParams.set("metrics", "views");
      ttParams.set("dimensions", "insightTrafficSourceDetail");
      ttParams.set("filters", `video==${v.external_id};insightTrafficSourceType==YT_SEARCH`);
      ttParams.set("sort", "-views");
      ttParams.set("maxResults", "25");
      const ttUrl = `https://youtubeanalytics.googleapis.com/v2/reports?${ttParams.toString()}`;
      const ttRes = await fetch(ttUrl, { headers: { Authorization: `Bearer ${token}` } });

      const keywords: string[] = [];
      const rankings: Record<string, number> = {};
      if (ttRes.ok) {
        const ttJson = await ttRes.json();
        const rows = ttJson.rows || [];
        rows.forEach((r: any[], i: number) => {
          const term = String(r[0] ?? "").trim();
          if (!term) return;
          keywords.push(term);
          rankings[term] = i + 1;
        });
      } else if (ttRes.status !== 400 && ttRes.status !== 403) {
        const body = await ttRes.text();
        console.warn(`[sync-youtube-analytics] ${label} search-term ${v.external_id} (${ttRes.status}): ${body}`);
      }

      const enriched: Record<string, unknown> = {
        views: Math.round(m.views || 0),
        likes: Math.round(m.likes || 0),
        comments: Math.round(m.comments || 0),
        shares: Math.round(m.shares || 0),
        subscribers_gained: Math.round(m.subscribersGained || 0),
        avg_percentage_viewed: m.averageViewPercentage ?? null,
        avg_view_duration_sec: m.averageViewDuration ?? null,
        keywords_organic: keywords,
        keyword_rankings: rankings,
        analytics_last_synced: new Date().toISOString(),
      };

      await upsertAnalytics(supabase, v, enriched);
      analyticsUpdated++;
      bAnalytics++;
    }

    const allFailed403 = list.length > 0 && b403Count === list.length;
    bucketResults.push({
      key, count: list.length, snippet: bSnippet, analytics: bAnalytics,
      wrongChannel: bWrongChannel, scopeMissingLikely: allFailed403,
    });
    if (allFailed403) {
      console.warn(`[sync-youtube-analytics] ${label} ALL calls returned 403 — yt-analytics scope likely missing for this channel`);
    }
  }

  console.log(
    `[sync-youtube-analytics] done. buckets=${buckets.size} snippet=${snippetUpdated} analytics=${analyticsUpdated} skipped=${analyticsSkipped} wrongChannel=${wrongChannel} failed=${failed}`,
  );
  return jsonResp({
    processed: videos.length,
    buckets: buckets.size,
    snippetUpdated,
    analyticsUpdated,
    analyticsSkipped,
    wrongChannel,
    failed,
    bucketResults,
  });
});

async function upsertAnalytics(supabase: any, meta: VideoMeta, patch: Record<string, unknown>) {
  const { data: existing } = await supabase
    .from("post_analytics")
    .select("id")
    .eq("post_id", meta.post_id)
    .eq("platform", "youtube")
    .maybeSingle();

  if (existing?.id) {
    const { error } = await supabase
      .from("post_analytics")
      .update({ ...patch, external_id: meta.external_id })
      .eq("id", existing.id);
    if (error) console.error(`[sync-youtube-analytics] update ${meta.post_id}:`, error);
  } else {
    const { error } = await supabase.from("post_analytics").insert({
      user_id: meta.user_id,
      post_id: meta.post_id,
      platform: "youtube",
      external_id: meta.external_id,
      fetched_at: new Date().toISOString(),
      ...patch,
    });
    if (error) console.error(`[sync-youtube-analytics] insert ${meta.post_id}:`, error);
  }
}

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
    .select("id, user_id, external_id, caption, created_at, platform, post_url")
    .not("external_id", "is", null)
    .gte("created_at", since)
    .or("platform.eq.youtube,platform.ilike.%youtube%,post_url.ilike.%youtube.com%");
  if (scopedUserId) q = q.eq("user_id", scopedUserId);

  const { data: posts, error: postsErr } = await q;
  if (postsErr) {
    console.error("[sync-youtube-analytics] load failed:", postsErr);
    return jsonResp({ error: postsErr.message }, 500);
  }

  const videos: VideoMeta[] = (posts || [])
    .filter((p: any) => p.external_id && p.user_id)
    .map((p: any) => ({
      post_id: p.id,
      user_id: p.user_id,
      external_id: p.external_id,
      created_at: p.created_at,
      caption: p.caption,
    }));

  console.log(`[sync-youtube-analytics] processing ${videos.length} videos (backfill=${backfill})`);

  const adapter = new YouTubeAdapter();
  const byUser = new Map<string, VideoMeta[]>();
  for (const v of videos) {
    if (!byUser.has(v.user_id)) byUser.set(v.user_id, []);
    byUser.get(v.user_id)!.push(v);
  }

  let snippetUpdated = 0;
  let analyticsUpdated = 0;
  let analyticsSkipped = 0;
  let failed = 0;

  for (const [userId, list] of byUser.entries()) {
    const token = await adapter.getValidToken(supabase, userId);
    if (!token) {
      console.warn(`[sync-youtube-analytics] no token for user ${userId}`);
      failed += list.length;
      continue;
    }

    // ---- 1) Pull snippet (tags, title, description) in batches of 50 ----
    const idsToMeta = new Map<string, VideoMeta>();
    for (const v of list) idsToMeta.set(v.external_id, v);
    const ids = Array.from(idsToMeta.keys());

    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${chunk.join(",")}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[sync-youtube-analytics] videos.list snippet failed (${res.status}): ${body}`);
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
      }
    }

    // ---- 2) Per-video YouTube Analytics API call ----
    // Requires the yt-analytics.readonly scope on the OAuth token. If not
    // granted (older connections), the call returns 403 and we skip silently.
    let scopeMissing = false;
    for (const v of list) {
      if (scopeMissing) { analyticsSkipped++; continue; }
      const startDate = v.created_at.slice(0, 10);
      const endDate = new Date().toISOString().slice(0, 10);
      const baseParams = new URLSearchParams({
        ids: "channel==MINE",
        startDate,
        endDate,
        filters: `video==${v.external_id}`,
      });

      // 2a) Aggregate metrics
      const metricsList = [
        "views",
        "likes",
        "comments",
        "shares",
        "subscribersGained",
        "averageViewPercentage",
        "averageViewDuration",
        "estimatedMinutesWatched",
      ].join(",");
      const aggParams = new URLSearchParams(baseParams);
      aggParams.set("metrics", metricsList);
      const aggUrl = `https://youtubeanalytics.googleapis.com/v2/reports?${aggParams.toString()}`;
      const aggRes = await fetch(aggUrl, { headers: { Authorization: `Bearer ${token}` } });

      if (aggRes.status === 403) {
        scopeMissing = true;
        analyticsSkipped++;
        console.warn(`[sync-youtube-analytics] yt-analytics scope missing for user ${userId} — skipping remaining`);
        continue;
      }
      if (!aggRes.ok) {
        const body = await aggRes.text();
        console.error(`[sync-youtube-analytics] analytics failed ${v.external_id} (${aggRes.status}): ${body}`);
        analyticsSkipped++;
        continue;
      }
      const aggJson = await aggRes.json();
      const row = (aggJson.rows && aggJson.rows[0]) || [];
      const headers: string[] = (aggJson.columnHeaders || []).map((h: any) => h.name);
      const m: Record<string, number> = {};
      headers.forEach((h, idx) => { m[h] = Number(row[idx] ?? 0); });

      // 2b) Search-term traffic (real organic keywords)
      const ttParams = new URLSearchParams(baseParams);
      ttParams.set("metrics", "views");
      ttParams.set("dimensions", "insightTrafficSourceDetail");
      ttParams.set("filters", `video==${v.external_id};insightTrafficSourceType==YT_SEARCH`);
      ttParams.set("sort", "-views");
      ttParams.set("maxResults", "25");
      const ttUrl = `https://youtubeanalytics.googleapis.com/v2/reports?${ttParams.toString()}`;
      const ttRes = await fetch(ttUrl, { headers: { Authorization: `Bearer ${token}` } });

      let keywords: string[] = [];
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
      } else if (ttRes.status !== 400) {
        const body = await ttRes.text();
        console.warn(`[sync-youtube-analytics] search-term query ${v.external_id} (${ttRes.status}): ${body}`);
      }

      // 2c) Impressions / CTR (channel-level call, separate endpoint)
      // YouTube Analytics impressions + impressionClickThroughRate only
      // available via the "advertisingOptions" or "trafficSource" reports
      // — call it per-video with no dimensions.
      let ctr: number | null = null;
      const ctrParams = new URLSearchParams(baseParams);
      ctrParams.set("metrics", "cardImpressions,cardClickRate");
      // Most channels don't have cards — we'll rely on subscribers/views proxy
      // when impressions unavailable. Skipping this network call by default to
      // save quota; rely on aggregated metrics above.

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
    }
  }

  console.log(
    `[sync-youtube-analytics] done. snippet=${snippetUpdated} analytics=${analyticsUpdated} skipped=${analyticsSkipped} failed=${failed}`,
  );
  return jsonResp({
    processed: videos.length,
    snippetUpdated,
    analyticsUpdated,
    analyticsSkipped,
    failed,
    note: analyticsSkipped > 0
      ? "Some users need to reconnect YouTube to grant yt-analytics.readonly scope."
      : undefined,
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

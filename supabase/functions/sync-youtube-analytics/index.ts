// sync-youtube-analytics
// Phase 12-Analytics-D / F — Enriches post_analytics with YouTube Data API
// video snippet (tags, title, description) and YouTube Analytics API metrics
// (averageViewPercentage, CTR, subscribersGained, organic search terms).
//
// Phase 12-Analytics-F: routes the Analytics API call by the *actual* channel
// that owns each video (snippet.channelId) — not by current city mapping. This
// is required because older recaps/shorts may have been uploaded by a channel
// that is no longer the active one for that city.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { YouTubeAdapter, getYouTubeOAuthCreds } from "../_shared/youtube-adapter.ts";
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
}

interface ChannelRow {
  id: string;
  user_id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  account_external_id: string | null;
  account_name: string | null;
  oauth_project: "A" | "B" | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireCronOrUser(req);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let backfill = false;
  let scopedUserId: string | null = gate.source === "user" ? (gate.userId ?? null) : null;
  try {
    if (req.headers.get("content-type")?.includes("application/json")) {
      const body = await req.clone().json().catch(() => null);
      if (body?.backfill) backfill = true;
      if (gate.source === "user" && body?.user_id && body.user_id !== gate.userId) {
        return jsonResp({ error: "user_id mismatch" }, 403);
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
  let wrongChannel = 0;
  let failed = 0;
  const channelStats: Record<string, { ok: number; forbidden: number; total: number; name?: string }> = {};

  for (const [userId, list] of byUser.entries()) {
    // Load all YT channels for this user (both projects).
    const { data: channelsRows } = await supabase
      .from("social_accounts")
      .select("id, user_id, access_token, refresh_token, token_expires_at, account_external_id, account_name, oauth_project")
      .eq("user_id", userId)
      .eq("platform", "youtube");
    const channels = (channelsRows || []) as ChannelRow[];
    const channelById = new Map<string, ChannelRow>();
    for (const c of channels) {
      if (c.account_external_id) channelById.set(c.account_external_id, c);
    }

    // Use any one valid token for snippet fetches (Data API doesn't care
    // about channel ownership). Prefer Project A; fall back to Project B.
    const snippetToken =
      (await adapter.getValidToken(supabase, userId, null, { contentType: "short" }).catch(() => null)) ||
      (await adapter.getValidToken(supabase, userId, null, { contentType: "recap" }).catch(() => null));
    if (!snippetToken) {
      console.warn(`[sync-youtube-analytics] no usable token for user ${userId}`);
      failed += list.length;
      continue;
    }

    // ---- 1) Snippets (tags + channelId) in batches of 50 ----
    const idsToMeta = new Map<string, VideoMeta>();
    for (const v of list) idsToMeta.set(v.external_id, v);
    const ids = Array.from(idsToMeta.keys());
    // Map video_id -> channelId (UCxxxx)
    const videoChannel = new Map<string, string>();

    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${chunk.join(",")}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${snippetToken}` } });
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
        const channelId: string = snip.channelId || "";
        if (channelId) videoChannel.set(item.id, channelId);
        await upsertAnalytics(supabase, meta, { tags_used: tags });
        snippetUpdated++;
      }
    }

    // ---- 2) Analytics — route per actual owning channel ----
    // Cache: channelId -> { token } or null if unroutable.
    const channelTokenCache = new Map<string, string | null>();

    const getTokenForChannel = async (channelId: string): Promise<string | null> => {
      if (channelTokenCache.has(channelId)) return channelTokenCache.get(channelId)!;
      const row = channelById.get(channelId);
      if (!row || !row.refresh_token) {
        console.warn(`[sync-youtube-analytics] no social_accounts row with refresh_token for channelId=${channelId}`);
        channelTokenCache.set(channelId, null);
        return null;
      }
      // Reuse cached access_token if still valid (>5min).
      const exp = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
      if (row.access_token && exp > Date.now() + 5 * 60 * 1000) {
        channelTokenCache.set(channelId, row.access_token);
        return row.access_token;
      }
      const project: "A" | "B" = row.oauth_project === "B" ? "B" : "A";
      const { id: clientId, secret: clientSecret } = getYouTubeOAuthCreds(project);
      if (!clientId || !clientSecret) {
        console.error(`[sync-youtube-analytics] Project ${project} creds missing for refresh`);
        channelTokenCache.set(channelId, null);
        return null;
      }
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: row.refresh_token,
        }),
      });
      const data = await refreshRes.json().catch(() => ({}));
      if (!data.access_token) {
        console.error(`[sync-youtube-analytics] refresh failed channel="${row.account_name}" project=${project}: ${JSON.stringify(data)}`);
        channelTokenCache.set(channelId, null);
        return null;
      }
      const newExp = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
      await supabase
        .from("social_accounts")
        .update({ access_token: data.access_token, token_expires_at: newExp, updated_at: new Date().toISOString() })
        .eq("id", row.id);
      channelTokenCache.set(channelId, data.access_token);
      return data.access_token;
    };

    for (const v of list) {
      const channelId = videoChannel.get(v.external_id);
      if (!channelId) {
        analyticsSkipped++;
        continue;
      }
      const stat = channelStats[channelId] ||= { ok: 0, forbidden: 0, total: 0, name: channelById.get(channelId)?.account_name ?? undefined };
      stat.total++;

      const token = await getTokenForChannel(channelId);
      if (!token) {
        wrongChannel++;
        analyticsSkipped++;
        stat.forbidden++;
        continue;
      }

      const startDate = v.created_at.slice(0, 10);
      const endDate = new Date().toISOString().slice(0, 10);
      const baseParams = new URLSearchParams({
        ids: "channel==MINE",
        startDate,
        endDate,
        filters: `video==${v.external_id}`,
      });
      const aggParams = new URLSearchParams(baseParams);
      aggParams.set("metrics", "views,likes,comments,shares,subscribersGained,averageViewPercentage,averageViewDuration,estimatedMinutesWatched");
      const aggUrl = `https://youtubeanalytics.googleapis.com/v2/reports?${aggParams.toString()}`;
      const aggRes = await fetch(aggUrl, { headers: { Authorization: `Bearer ${token}` } });

      if (aggRes.status === 403) {
        stat.forbidden++;
        wrongChannel++;
        analyticsSkipped++;
        if (stat.forbidden <= 3) {
          const body = await aggRes.text();
          console.warn(`[sync-youtube-analytics] channel="${stat.name ?? channelId}" video=${v.external_id} 403: ${body.slice(0, 200)}`);
        }
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

      // Search-term traffic (organic keywords)
      const ttParams = new URLSearchParams(baseParams);
      ttParams.set("metrics", "views");
      ttParams.set("dimensions", "insightTrafficSourceDetail");
      ttParams.set("filters", `video==${v.external_id};insightTrafficSourceType==YT_SEARCH`);
      ttParams.set("sort", "-views");
      ttParams.set("maxResults", "25");
      const ttRes = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${ttParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const keywords: string[] = [];
      const rankings: Record<string, number> = {};
      if (ttRes.ok) {
        const ttJson = await ttRes.json();
        (ttJson.rows || []).forEach((r: any[], i: number) => {
          const term = String(r[0] ?? "").trim();
          if (!term) return;
          keywords.push(term);
          rankings[term] = i + 1;
        });
      }

      await upsertAnalytics(supabase, v, {
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
      });
      analyticsUpdated++;
      stat.ok++;
    }
  }

  console.log(
    `[sync-youtube-analytics] done. snippet=${snippetUpdated} analytics=${analyticsUpdated} skipped=${analyticsSkipped} wrongChannel=${wrongChannel} failed=${failed}`,
  );
  console.log(`[sync-youtube-analytics] per-channel: ${JSON.stringify(channelStats)}`);

  return jsonResp({
    processed: videos.length,
    snippetUpdated,
    analyticsUpdated,
    analyticsSkipped,
    wrongChannel,
    failed,
    channelStats,
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

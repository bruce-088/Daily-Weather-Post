// sync-youtube-metrics
// Syncs live YouTube Shorts metrics (views, likes, comments) into post_analytics.
// For every post_history row where platform=youtube and external_id is set, calls
// YouTube Data API v3 videos.list?part=statistics in batches of 50 per user, and
// upserts the result into post_analytics. Triggered every 6h via pg_cron and from
// the in-app "Sync Now" button.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { YouTubeAdapter } from "../_shared/youtube-adapter.ts";
import { requireCronOrUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireCronOrUser(req);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // When called by an authenticated user, scope to that user only.
  // If the body supplies a user_id, it MUST match the authenticated session.
  // Cron calls process all users.
  let scopedUserId: string | null = gate.source === "user" ? (gate.userId ?? null) : null;

  if (gate.source === "user") {
    let bodyUserId: string | undefined;
    try {
      if (req.headers.get("content-type")?.includes("application/json")) {
        const body = await req.clone().json().catch(() => null);
        bodyUserId = body?.user_id;
      }
    } catch (_) { /* ignore */ }
    if (bodyUserId && bodyUserId !== gate.userId) {
      return new Response(
        JSON.stringify({ error: "user_id mismatch with authenticated session" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // Look at the last 60 days so manual syncs catch everything reasonable.
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  let postsQuery = supabase
    .from("post_history")
    .select("id, user_id, external_id, platform, post_url, condition, caption, created_at")
    .not("external_id", "is", null)
    .gte("created_at", since)
    .or("platform.eq.youtube,platform.ilike.%youtube%,post_url.ilike.%youtube.com%");

  if (scopedUserId) postsQuery = postsQuery.eq("user_id", scopedUserId);

  const { data: posts, error: postsErr } = await postsQuery;
  if (postsErr) {
    console.error("[sync-youtube-metrics] failed to load posts:", postsErr);
    return new Response(JSON.stringify({ error: postsErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const youtubePosts = (posts || []).filter((p) => p.external_id && p.user_id);
  console.log(`[sync-youtube-metrics] processing ${youtubePosts.length} YouTube post(s)`);

  // Group video IDs per user (one token + one batched API call per user).
  const byUser = new Map<
    string,
    { user_id: string; postsById: Map<string, { post_id: string; condition: string | null }> }
  >();
  for (const p of youtubePosts) {
    if (!byUser.has(p.user_id!)) byUser.set(p.user_id!, { user_id: p.user_id!, postsById: new Map() });
    byUser.get(p.user_id!)!.postsById.set(p.external_id!, {
      post_id: p.id,
      condition: p.condition ?? null,
    });
  }

  const adapter = new YouTubeAdapter();
  let updated = 0;
  let inserted = 0;
  let failed = 0;

  for (const { user_id, postsById } of byUser.values()) {
    const token = await adapter.getValidToken(supabase, user_id);
    if (!token) {
      console.warn(`[sync-youtube-metrics] no valid YouTube token for user ${user_id}`);
      failed += postsById.size;
      continue;
    }

    const videoIds = Array.from(postsById.keys());
    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const url =
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}`;

      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = await res.text();
        console.error(`[sync-youtube-metrics] videos.list failed (${res.status}): ${body}`);
        failed += chunk.length;
        continue;
      }

      const json = await res.json();
      const items = json.items || [];

      for (const item of items) {
        const videoId: string = item.id;
        const meta = postsById.get(videoId);
        if (!meta) continue;
        const stats = item.statistics || {};
        const views = parseInt(stats.viewCount || "0", 10);
        const likes = parseInt(stats.likeCount || "0", 10);
        const comments = parseInt(stats.commentCount || "0", 10);

        // Try update first (existing row); if no row, insert one.
        const { data: existing } = await supabase
          .from("post_analytics")
          .select("id")
          .eq("post_id", meta.post_id)
          .eq("platform", "youtube")
          .maybeSingle();

        if (existing?.id) {
          const { error: upErr } = await supabase
            .from("post_analytics")
            .update({
              views,
              likes,
              comments,
              external_id: videoId,
              fetched_at: new Date().toISOString(),
            })
            .eq("id", existing.id);
          if (upErr) {
            console.error(`[sync-youtube-metrics] update failed for ${meta.post_id}:`, upErr);
            failed++;
          } else {
            updated++;
          }
        } else {
          const { error: insErr } = await supabase.from("post_analytics").insert({
            user_id,
            post_id: meta.post_id,
            platform: "youtube",
            external_id: videoId,
            views,
            likes,
            comments,
            condition: meta.condition,
            fetched_at: new Date().toISOString(),
          });
          if (insErr) {
            console.error(`[sync-youtube-metrics] insert failed for ${meta.post_id}:`, insErr);
            failed++;
          } else {
            inserted++;
          }
        }
      }
    }
  }

  console.log(`[sync-youtube-metrics] done. updated=${updated} inserted=${inserted} failed=${failed}`);
  return new Response(
    JSON.stringify({ updated, inserted, failed, processed: youtubePosts.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

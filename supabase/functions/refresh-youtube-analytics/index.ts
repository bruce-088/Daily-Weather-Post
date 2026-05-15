// Refreshes YouTube post metrics into post_analytics.
// Triggered by cron every 30-60 minutes. Looks up post_history rows that have
// a YouTube external_id and a corresponding post_analytics row, then calls the
// YouTube Data API v3 `videos.list` endpoint with part=statistics.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { YouTubeAdapter } from "../_shared/youtube-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

import { requireCronOrUser } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const _gate = await requireCronOrUser(req);
  if (!_gate.ok) return _gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Only refresh posts published in the last 30 days to keep the workload bounded.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Pull YouTube post_history rows with an external_id.
  const { data: posts, error: postsErr } = await supabase
    .from("post_history")
    .select("id, user_id, external_id, platform, post_url, created_at")
    .not("external_id", "is", null)
    .gte("created_at", since)
    .or("platform.eq.youtube,platform.ilike.%youtube%,post_url.ilike.%youtube.com%");

  if (postsErr) {
    console.error("[refresh-youtube] failed to load posts:", postsErr);
    return new Response(JSON.stringify({ error: postsErr.message }), {

      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const youtubePosts = (posts || []).filter((p) => p.external_id && p.user_id);
  console.log(`[refresh-youtube] processing ${youtubePosts.length} YouTube post(s)`);

  // Group video IDs per user so we can use a single token + batched videos.list call per user.
  const byUser = new Map<string, { user_id: string; postsById: Map<string, string> }>();
  for (const p of youtubePosts) {
    if (!byUser.has(p.user_id!)) byUser.set(p.user_id!, { user_id: p.user_id!, postsById: new Map() });
    byUser.get(p.user_id!)!.postsById.set(p.external_id!, p.id);
  }

  const adapter = new YouTubeAdapter();
  let updated = 0;
  let failed = 0;

  for (const { user_id, postsById } of byUser.values()) {
    const token = await adapter.getValidToken(supabase, user_id);
    if (!token) {
      console.warn(`[refresh-youtube] no valid YouTube token for user ${user_id}`);
      failed += postsById.size;
      continue;
    }

    const videoIds = Array.from(postsById.keys());
    // YouTube Data API allows up to 50 ids per request.
    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const body = await res.text();
        console.error(`[refresh-youtube] videos.list failed (${res.status}): ${body}`);
        failed += chunk.length;
        continue;
      }

      const json = await res.json();
      const items = json.items || [];

      for (const item of items) {
        const videoId: string = item.id;
        const postId = postsById.get(videoId);
        if (!postId) continue;
        const stats = item.statistics || {};
        const views = parseInt(stats.viewCount || "0", 10);
        const likes = parseInt(stats.likeCount || "0", 10);
        const comments = parseInt(stats.commentCount || "0", 10);

        // Update the existing post_analytics row for this post + youtube.
        const { error: upErr } = await supabase
          .from("post_analytics")
          .update({ views, likes, comments, fetched_at: new Date().toISOString() })
          .eq("post_id", postId)
          .eq("platform", "youtube");

        if (upErr) {
          console.error(`[refresh-youtube] update failed for post ${postId}:`, upErr);
          failed++;
        } else {
          updated++;
        }
      }
    }
  }

  console.log(`[refresh-youtube] done. updated=${updated} failed=${failed}`);
  return new Response(
    JSON.stringify({ updated, failed, processed: youtubePosts.length }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

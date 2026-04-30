// Sync engagement metrics for posts published in the last 30 days from
// YouTube + TikTok into post_analytics. Triggered by cron every 6 hours.
//
// For each user with publishable posts:
//   - YouTube: GET videos.list?part=statistics&id=...
//   - TikTok:  POST /v2/video/query/?fields=view_count,like_count,comment_count,share_count
//
// Updates post_analytics rows in place, matched by (post_id, platform) and
// records views/likes/comments/shares + fetched_at.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { YouTubeAdapter } from "../_shared/youtube-adapter.ts";
import { TikTokAdapter } from "../_shared/tiktok-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PostRow {
  id: string;
  user_id: string;
  external_id: string;
  platform: string | null;
  post_url: string | null;
}

async function syncYouTubeForUser(
  supabase: any,
  userId: string,
  posts: PostRow[],
): Promise<{ updated: number; failed: number }> {
  const adapter = new YouTubeAdapter();
  const token = await adapter.getValidToken(supabase, userId);
  if (!token) {
    console.warn(`[sync-metrics] no YouTube token for user ${userId}`);
    return { updated: 0, failed: posts.length };
  }
  const postsById = new Map<string, string>();
  for (const p of posts) postsById.set(p.external_id, p.id);
  const ids = Array.from(postsById.keys());

  let updated = 0;
  let failed = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`[sync-metrics] YT videos.list failed (${res.status})`);
      failed += chunk.length;
      continue;
    }
    const json = await res.json();
    for (const item of (json.items || [])) {
      const postId = postsById.get(item.id);
      if (!postId) continue;
      const stats = item.statistics || {};
      const { error } = await supabase
        .from("post_analytics")
        .update({
          views: parseInt(stats.viewCount || "0", 10),
          likes: parseInt(stats.likeCount || "0", 10),
          comments: parseInt(stats.commentCount || "0", 10),
          fetched_at: new Date().toISOString(),
        })
        .eq("post_id", postId)
        .eq("platform", "youtube");
      if (error) failed++;
      else updated++;
    }
  }
  return { updated, failed };
}

async function syncTikTokForUser(
  supabase: any,
  userId: string,
  posts: PostRow[],
): Promise<{ updated: number; failed: number }> {
  const adapter = new TikTokAdapter();
  const token = await adapter.getValidToken(supabase, userId);
  if (!token) {
    console.warn(`[sync-metrics] no TikTok token for user ${userId}`);
    return { updated: 0, failed: posts.length };
  }
  const postsById = new Map<string, string>();
  for (const p of posts) postsById.set(p.external_id, p.id);
  const ids = Array.from(postsById.keys());

  let updated = 0;
  let failed = 0;
  // TikTok video/query allows up to 20 video_ids per call.
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const url =
      "https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filters: { video_ids: chunk } }),
    });
    if (!res.ok) {
      console.error(`[sync-metrics] TikTok query failed (${res.status})`);
      failed += chunk.length;
      continue;
    }
    const json = await res.json();
    const items = json?.data?.videos || [];
    for (const v of items) {
      const postId = postsById.get(v.id);
      if (!postId) continue;
      const { error } = await supabase
        .from("post_analytics")
        .update({
          views: v.view_count ?? 0,
          likes: v.like_count ?? 0,
          comments: v.comment_count ?? 0,
          shares: v.share_count ?? 0,
          fetched_at: new Date().toISOString(),
        })
        .eq("post_id", postId)
        .eq("platform", "tiktok");
      if (error) failed++;
      else updated++;
    }
  }
  return { updated, failed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: posts, error } = await supabase
    .from("post_history")
    .select("id, user_id, external_id, platform, post_url, created_at")
    .not("external_id", "is", null)
    .gte("created_at", since);

  if (error) {
    console.error("[sync-metrics] load posts failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const isYouTube = (p: PostRow) =>
    !!p.external_id && (
      p.platform === "youtube" ||
      (p.platform || "").toLowerCase().includes("youtube") ||
      (p.post_url || "").includes("youtube.com")
    );
  const isTikTok = (p: PostRow) =>
    !!p.external_id && (
      p.platform === "tiktok" ||
      (p.platform || "").toLowerCase().includes("tiktok") ||
      (p.post_url || "").includes("tiktok.com")
    );

  // Group per user/platform
  const ytByUser = new Map<string, PostRow[]>();
  const ttByUser = new Map<string, PostRow[]>();
  for (const p of (posts || []) as PostRow[]) {
    if (!p.user_id) continue;
    if (isYouTube(p)) {
      if (!ytByUser.has(p.user_id)) ytByUser.set(p.user_id, []);
      ytByUser.get(p.user_id)!.push(p);
    }
    if (isTikTok(p)) {
      if (!ttByUser.has(p.user_id)) ttByUser.set(p.user_id, []);
      ttByUser.get(p.user_id)!.push(p);
    }
  }

  let ytUpdated = 0, ytFailed = 0, ttUpdated = 0, ttFailed = 0;
  for (const [uid, list] of ytByUser) {
    const r = await syncYouTubeForUser(supabase, uid, list);
    ytUpdated += r.updated; ytFailed += r.failed;
  }
  for (const [uid, list] of ttByUser) {
    const r = await syncTikTokForUser(supabase, uid, list);
    ttUpdated += r.updated; ttFailed += r.failed;
  }

  // Health ping
  await supabase.from("system_health").upsert({
    id: "sync-platform-metrics",
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_message: `youtube: ${ytUpdated}/${ytUpdated + ytFailed}, tiktok: ${ttUpdated}/${ttUpdated + ttFailed}`,
  });

  return new Response(
    JSON.stringify({
      youtube: { updated: ytUpdated, failed: ytFailed },
      tiktok: { updated: ttUpdated, failed: ttFailed },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

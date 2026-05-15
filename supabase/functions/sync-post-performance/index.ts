// Sync live engagement metrics from platform APIs into post_history columns
// (views_count, likes_count, comment_count, retention_rate, last_synced_at).
//
// Scope: posts created in the last 7 days that have an external_id.
// Schedule: every 12 hours via pg_cron.
// Platforms: YouTube + TikTok (others store no per-post stats yet).

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

const isYT = (p: PostRow) =>
  (p.platform || "").toLowerCase().includes("youtube") ||
  (p.post_url || "").toLowerCase().includes("youtube.com");
const isTT = (p: PostRow) =>
  (p.platform || "").toLowerCase().includes("tiktok") ||
  (p.post_url || "").toLowerCase().includes("tiktok.com");

async function syncYouTube(supabase: any, userId: string, posts: PostRow[]) {
  const adapter = new YouTubeAdapter();
  const token = await adapter.getValidToken(supabase, userId);
  if (!token) return { updated: 0, failed: posts.length };
  const byExt = new Map<string, string>();
  for (const p of posts) byExt.set(p.external_id, p.id);
  const ids = Array.from(byExt.keys());

  let updated = 0, failed = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const url =
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,contentDetails&id=${chunk.join(",")}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { failed += chunk.length; continue; }
    const json = await res.json();
    for (const item of (json.items || [])) {
      const postId = byExt.get(item.id);
      if (!postId) continue;
      const stats = item.statistics || {};
      const views = parseInt(stats.viewCount || "0", 10);
      const likes = parseInt(stats.likeCount || "0", 10);
      const comments = parseInt(stats.commentCount || "0", 10);
      // Retention is not directly available without YT Analytics API auth.
      // Approximate engagement rate = (likes+comments)/views as a proxy.
      const retention = views > 0 ? Math.min(1, (likes + comments) / views) : null;
      const { error } = await supabase
        .from("post_history")
        .update({
          views_count: views,
          likes_count: likes,
          comment_count: comments,
          retention_rate: retention,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", postId);
      if (error) failed++; else updated++;
    }
  }
  return { updated, failed };
}

async function syncTikTok(supabase: any, userId: string, posts: PostRow[]) {
  const adapter = new TikTokAdapter();
  const token = await adapter.getValidToken(supabase, userId);
  if (!token) return { updated: 0, failed: posts.length };
  const byExt = new Map<string, string>();
  for (const p of posts) byExt.set(p.external_id, p.id);
  const ids = Array.from(byExt.keys());

  let updated = 0, failed = 0;
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
    if (!res.ok) { failed += chunk.length; continue; }
    const json = await res.json();
    const items = json?.data?.videos || [];
    for (const v of items) {
      const postId = byExt.get(v.id);
      if (!postId) continue;
      const views = v.view_count ?? 0;
      const likes = v.like_count ?? 0;
      const comments = v.comment_count ?? 0;
      const retention = views > 0 ? Math.min(1, (likes + comments) / views) : null;
      const { error } = await supabase
        .from("post_history")
        .update({
          views_count: views,
          likes_count: likes,
          comment_count: comments,
          retention_rate: retention,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", postId);
      if (error) failed++; else updated++;
    }
  }
  return { updated, failed };
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

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: posts, error } = await supabase
    .from("post_history")
    .select("id, user_id, external_id, platform, post_url, created_at")
    .not("external_id", "is", null)
    .gte("created_at", since);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {

      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ytByUser = new Map<string, PostRow[]>();
  const ttByUser = new Map<string, PostRow[]>();
  for (const p of (posts || []) as PostRow[]) {
    if (!p.user_id) continue;
    if (isYT(p)) (ytByUser.get(p.user_id) ?? ytByUser.set(p.user_id, []).get(p.user_id)!).push(p);
    if (isTT(p)) (ttByUser.get(p.user_id) ?? ttByUser.set(p.user_id, []).get(p.user_id)!).push(p);
  }

  let ytUpd = 0, ytFail = 0, ttUpd = 0, ttFail = 0;
  for (const [uid, list] of ytByUser) {
    const r = await syncYouTube(supabase, uid, list);
    ytUpd += r.updated; ytFail += r.failed;
  }
  for (const [uid, list] of ttByUser) {
    const r = await syncTikTok(supabase, uid, list);
    ttUpd += r.updated; ttFail += r.failed;
  }

  await supabase.from("system_health").upsert({
    id: "sync-post-performance",
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_message: `YT ${ytUpd}/${ytUpd + ytFail} · TT ${ttUpd}/${ttUpd + ttFail}`,
  });

  return new Response(JSON.stringify({
    ok: true,
    youtube: { updated: ytUpd, failed: ytFail },
    tiktok: { updated: ttUpd, failed: ttFail },
    scanned: posts?.length || 0,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});

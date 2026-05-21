// Weekly Recap pipeline (ISOLATED).
//
// Goal: turn the last 7 daily successful posts into ONE long-form YouTube
// video, posted automatically every Sunday at 18:00 UTC.
//
// Hard rules (per spec):
//   - DO NOT modify auto-post-scheduler or process-scheduled-posts.
//   - DO NOT share locks/queues with the daily pipeline.
//   - If video stitch fails -> generate an infographic image as fallback.
//
// Triggered by:
//   - pg_cron Sunday 18:00 UTC -> POST /functions/v1/create-weekly-recap
//   - Manual: POST {} with Authorization: Bearer <service_role>
//
// Per-run flow (per user with YouTube connected):
//   1. Fetch last 7 succeeded posts from post_history
//   2. Pull top "best hooks" from ai_memory (Step 2 layer)
//   3. Ask Lovable AI for a continuous weekly script (high/low + conditions)
//   4. Build a Creatomate slideshow that stitches the 7 image_urls + voice/text
//   5. Upload to YouTube as long-form (privacyStatus=public)
//   6. On stitch failure: generate a "Weekly Summary" image via Lovable AI
//      image gen, save to post_history with status='fallback_image',
//      notify user, EXIT cleanly (no daily-pipeline interaction).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const CREATOMATE_API_KEY = Deno.env.get("CREATOMATE_API_KEY") || "";

interface PostRow {
  id: string;
  city: string;
  temperature: number | null;
  condition: string | null;
  caption: string | null;
  image_url: string | null;
  post_url: string | null;
  created_at: string;
}

// ───────────────── helpers ─────────────────

async function getLast7Posts(svc: any, userId: string, cityFilter?: string): Promise<PostRow[]> {
  const since = new Date(Date.now() - 8 * 86400 * 1000).toISOString();
  let q = svc
    .from("post_history")
    .select("id, city, temperature, condition, caption, image_url, post_url, created_at")
    .eq("user_id", userId)
    .in("status", ["succeeded", "success"])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(50);
  if (cityFilter) q = q.ilike("city", `%${cityFilter}%`);
  const { data, error } = await q;
  if (error) throw new Error(`post_history fetch failed: ${error.message}`);
  // Dedupe by day so multi-platform same-day posts collapse to one slide
  const byDay = new Map<string, PostRow>();
  for (const p of (data || []) as PostRow[]) {
    const day = p.created_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, p);
  }
  return Array.from(byDay.values()).slice(-7);
}

async function getTopHooks(svc: any, userId: string): Promise<string[]> {
  try {
    const { data } = await svc
      .from("ai_memory")
      .select("content")
      .eq("user_id", userId)
      .eq("memory_type", "hook")
      .order("performance_score", { ascending: false })
      .limit(5);
    return (data || []).map((r: any) => String(r.content)).filter(Boolean);
  } catch {
    return [];
  }
}

async function generateWeeklyScript(
  posts: PostRow[],
  topHooks: string[],
): Promise<{ title: string; script: string }> {
  const summary = posts.map((p, i) => {
    const day = new Date(p.created_at).toLocaleDateString("en-US", { weekday: "long" });
    const t = p.temperature != null ? `${Math.round(p.temperature)}°F` : "N/A";
    return `${i + 1}. ${day}: ${t}, ${p.condition ?? "—"}`;
  }).join("\n");

  const city = posts[0]?.city ?? "your city";
  const hookBlock = topHooks.length
    ? `\n\nHigh-performing past openers (use a similar style if helpful):\n- ${topHooks.slice(0, 3).join("\n- ")}`
    : "";

  const prompt = `Write a YouTube long-form weekly weather recap script for ${city}.
It should be conversational, energetic, ~250-350 words, and cover all 7 days
with highs/lows and conditions. End with a brief look at next week and a
"like + subscribe" prompt.

Last 7 days:
${summary}${hookBlock}

Return JSON ONLY: {"title":"...", "script":"..."}.
Title must include the phrase "Weekly Recap".`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "You are a concise weather copywriter. Always return valid JSON." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Lovable AI script failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(content); } catch { /* ignore */ }
  return {
    title: parsed.title || `${city} Weekly Recap`,
    script: parsed.script || "Here's your weekly weather recap.",
  };
}

// ───────────────── Creatomate stitch ─────────────────

interface StitchResult { url: string; data: Uint8Array; }

// Remove #Shorts-style hashtags so YouTube does not auto-classify the upload
// as a Short. Long-form recap MUST never carry these tags.
function stripShortsHashtag(s: string): string {
  return (s || "")
    .replace(/#shorts\b/gi, "")
    .replace(/#ytshorts\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function stitchSlideshow(posts: PostRow[], title: string): Promise<StitchResult | null> {
  if (!CREATOMATE_API_KEY) {
    console.warn("[recap] CREATOMATE_API_KEY missing — skipping stitch");
    return null;
  }
  const slides = posts.filter((p) => p.image_url).slice(0, 7);
  if (slides.length < 2) {
    console.warn("[recap] Not enough image_urls to stitch (need 2+):", slides.length);
    return null;
  }

  // 9s per slide ensures even a 5-slide week (5*9 + title + outro = 63s)
  // clears the 60s YouTube Short threshold. A full 7-slide week = 81s.
  const SLIDE_DUR = 9;
  const city = posts[0]?.city ?? "your city";

  const elements: any[] = [];
  // Title card
  elements.push({
    type: "text", text: title,
    x: "50%", y: "20%", width: "90%",
    font_family: "Inter", font_weight: "800",
    font_size: "8 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.45)", padding: 24,
    time: 0, duration: SLIDE_DUR,
    enter_animation: { type: "fade", duration: 0.4 },
    exit_animation: { type: "fade", duration: 0.4 },
  });
  slides.forEach((p, i) => {
    const start = (i + 1) * SLIDE_DUR;
    elements.push({
      type: "image", source: p.image_url,
      time: start, duration: SLIDE_DUR,
      fit: "cover",
      enter_animation: { type: "fade", duration: 0.4 },
      exit_animation: { type: "fade", duration: 0.4 },
    });
    const day = new Date(p.created_at).toLocaleDateString("en-US", { weekday: "long" });
    const temp = p.temperature != null ? `${Math.round(p.temperature)}°F` : "";
    const cond = p.condition ?? "";
    elements.push({
      type: "text",
      text: `${day}\n${temp}  ${cond}`.trim(),
      x: "50%", y: "85%", width: "90%",
      font_family: "Inter", font_weight: "700",
      font_size: "5 vh", fill_color: "#ffffff",
      background_color: "rgba(0,0,0,0.55)", padding: 18,
      time: start, duration: SLIDE_DUR,
      enter_animation: { type: "slide", direction: "up", duration: 0.4 },
    });
  });

  // Outro card — guarantees the long-form clears 60s even on short weeks.
  const outroStart = (slides.length + 1) * SLIDE_DUR;
  elements.push({
    type: "text",
    text: `Thanks for watching!\nLike + subscribe for daily ${city} weather.`,
    x: "50%", y: "50%", width: "90%",
    font_family: "Inter", font_weight: "800",
    font_size: "7 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.55)", padding: 24,
    time: outroStart, duration: SLIDE_DUR,
    enter_animation: { type: "fade", duration: 0.4 },
    exit_animation: { type: "fade", duration: 0.4 },
  });

  let totalDuration = (slides.length + 2) * SLIDE_DUR; // title + slides + outro
  if (totalDuration < 65) {
    const pad = 65 - totalDuration;
    elements[elements.length - 1].duration += pad;
    totalDuration += pad;
  }
  console.log(`[recap] stitch duration=${totalDuration}s slides=${slides.length}`);

  const body = {
    output_format: "mp4",
    frame_rate: 30,
    render_scale: 0.75,
    source: {
      width: 1920, height: 1080, // long-form 16:9
      duration: totalDuration,

      fill_color: "#0f172a",
      elements,
    },
  };

  const submit = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const submitText = await submit.text();
  if (!submit.ok) {
    console.error("[recap] Creatomate submit failed:", submit.status, submitText.slice(0, 300));
    return null;
  }
  let renders: any;
  try { renders = JSON.parse(submitText); } catch { return null; }
  const renderId = Array.isArray(renders) ? renders[0]?.id : renders?.id;
  if (!renderId) return null;

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const sr = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
      headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
    });
    if (!sr.ok) continue;
    const sd = await sr.json();
    if (sd.status === "succeeded" && sd.url) {
      const dl = await fetch(sd.url);
      if (!dl.ok) return null;
      const ab = await dl.arrayBuffer();
      return { url: sd.url, data: new Uint8Array(ab) };
    }
    if (sd.status === "failed") {
      console.error("[recap] Creatomate render failed:", sd.error_message);
      return null;
    }
  }
  console.error("[recap] Creatomate poll timeout");
  return null;
}

// ───────────────── YouTube long-form upload ─────────────────

async function getYouTubeToken(svc: any, userId: string): Promise<string | null> {
  const { data: s } = await svc.from("weather_settings")
    .select("youtube_access_token, youtube_refresh_token, youtube_token_expires_at")
    .eq("user_id", userId).maybeSingle();
  if (!s?.youtube_refresh_token && !s?.youtube_access_token) return null;
  const exp = s.youtube_token_expires_at ? new Date(s.youtube_token_expires_at).getTime() : 0;
  if (s.youtube_access_token && exp > Date.now() + 5 * 60 * 1000) return s.youtube_access_token;
  if (!s.youtube_refresh_token) return null;
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("YOUTUBE_CLIENT_ID")!,
      client_secret: Deno.env.get("YOUTUBE_CLIENT_SECRET")!,
      refresh_token: s.youtube_refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!refreshRes.ok) return null;
  const r = await refreshRes.json();
  const newExp = new Date(Date.now() + (r.expires_in ?? 3600) * 1000).toISOString();
  await svc.from("weather_settings")
    .update({ youtube_access_token: r.access_token, youtube_token_expires_at: newExp })
    .eq("user_id", userId);
  return r.access_token;
}

async function uploadLongFormToYouTube(
  token: string,
  videoData: Uint8Array,
  title: string,
  description: string,
): Promise<string | null> {
  const safeTitle = title.length > 95 ? title.slice(0, 95) : title;
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(videoData.byteLength),
      },
      body: JSON.stringify({
        snippet: {
          title: safeTitle,
          description: description.slice(0, 4900),
          categoryId: "22",
          tags: ["Weekly Recap", "Weather", "SkyBrief", "Weather Recap"],
        },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!initRes.ok) {
    const errText = await initRes.text();
    console.error(`[recap] YouTube upload failed: ${initRes.status} ${errText.slice(0, 500)}`);
    return null;
  }
  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) {
    console.error("[recap] YouTube upload failed: missing resumable Location header");
    return null;
  }
  const up = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: videoData,
  });
  if (!up.ok) {
    const errText = await up.text();
    console.error(`[recap] YouTube upload failed: ${up.status} ${errText.slice(0, 500)}`);
    return null;
  }
  const j = await up.json();
  console.log(`[recap] YT response: ${JSON.stringify(j).slice(0, 500)}`);
  return j?.id ?? null;
}


// ───────────────── infographic fallback ─────────────────

async function generateFallbackInfographic(
  title: string,
  posts: PostRow[],
): Promise<Uint8Array | null> {
  const lines = posts.map((p) => {
    const day = new Date(p.created_at).toLocaleDateString("en-US", { weekday: "short" });
    const t = p.temperature != null ? `${Math.round(p.temperature)}°F` : "—";
    return `${day} ${t} ${p.condition ?? ""}`.trim();
  }).join(" | ");
  const prompt = `Clean modern weather infographic poster, dark navy gradient background,
white bold sans-serif typography, large title "${title}", 7-day weather summary
displayed as a tidy grid with weather icons. Data: ${lines}. Minimalist, editorial,
high contrast. No watermark.`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-image-preview",
        prompt,
        size: "1792x1024",
      }),
    });
    if (!res.ok) {
      console.error("[recap] image gen failed:", res.status, await res.text());
      return null;
    }
    const j = await res.json();
    const b64 = j?.data?.[0]?.b64_json;
    if (!b64) return null;
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return bin;
  } catch (e) {
    console.error("[recap] image gen error:", (e as Error).message);
    return null;
  }
}

// ───────────────── per-user runner ─────────────────

async function runForUser(svc: any, userId: string, cityFilter?: string): Promise<{ ok: boolean; detail: string }> {
  const posts = await getLast7Posts(svc, userId, cityFilter);
  if (posts.length < 3) {
    return { ok: false, detail: `Only ${posts.length} posts in last 7 days${cityFilter ? ` for ${cityFilter}` : ""} — skipping recap` };
  }
  const topHooks = await getTopHooks(svc, userId);
  const { title, script } = await generateWeeklyScript(posts, topHooks);
  const finalTitle = title.includes("Weekly Recap") ? title : `${title} — Weekly Recap`;
  const description = `${script}\n\n#WeeklyRecap #Weather #SkyBrief`;

  // Try video stitch
  const stitched = await stitchSlideshow(posts, finalTitle);

  if (stitched) {
    const token = await getYouTubeToken(svc, userId);
    if (!token) {
      await svc.from("post_history").insert({
        user_id: userId, status: "failed", platform: "youtube",
        city: posts[0].city, caption: finalTitle,
        error_message: "No YouTube token for weekly recap",
      });
      return { ok: false, detail: "No YouTube token" };
    }
    const cleanTitle = stripShortsHashtag(finalTitle);
    const cleanDesc = stripShortsHashtag(description);
    const videoId = await uploadLongFormToYouTube(token, stitched.data, cleanTitle, cleanDesc);
    if (videoId) {
      console.log(`[recap] uploaded to YouTube as videoId: ${videoId}`);
      await svc.from("post_history").insert({
        user_id: userId, status: "succeeded", platform: "youtube",
        city: posts[0].city, caption: cleanTitle,
        post_url: `https://www.youtube.com/watch?v=${videoId}`,
        external_id: videoId,
      });
      await svc.from("notifications").insert({
        user_id: userId, type: "success",
        title: "📺 Weekly Recap published!",
        message: `${cleanTitle} is live on YouTube.`,
      });
      return { ok: true, detail: `Uploaded ${videoId}` };
    }

    // upload failed -> fall through to infographic fallback
    console.warn("[recap] YT upload failed — falling back to infographic");
  }

  // Fallback path (stitch failed OR upload failed)
  const img = await generateFallbackInfographic(finalTitle, posts);
  if (!img) {
    await svc.from("post_history").insert({
      user_id: userId, status: "failed", platform: "youtube",
      city: posts[0].city, caption: finalTitle,
      error_message: "Stitch failed and infographic generation failed",
    });
    return { ok: false, detail: "Both stitch and infographic failed" };
  }
  // Save infographic to storage
  const path = `weekly-recap/${userId}/${Date.now()}.png`;
  const { error: upErr } = await svc.storage.from("generated-images")
    .upload(path, img, { contentType: "image/png", upsert: true });
  if (upErr) console.error("[recap] storage upload failed:", upErr);
  const { data: signed } = await svc.storage.from("generated-images")
    .createSignedUrl(path, 60 * 60 * 24 * 30);

  await svc.from("post_history").insert({
    user_id: userId, status: "fallback_image", platform: "youtube",
    city: posts[0].city, caption: finalTitle,
    image_url: signed?.signedUrl ?? null,
    error_message: "Video stitch unavailable — generated weekly summary infographic instead",
  });
  await svc.from("notifications").insert({
    user_id: userId, type: "warning",
    title: "🖼️ Weekly Recap fallback ready",
    message: "We couldn't stitch the weekly video, so we made a Weekly Summary infographic instead.",
  });
  return { ok: true, detail: "Fallback infographic generated" };
}

// ───────────────── HTTP entrypoint ─────────────────

import { requireCronOrUser } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const _gate = await requireCronOrUser(req);
  if (!_gate.ok) return _gate.response;

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Optional body: { city?: string, user_id?: string } for manual test runs.
  let cityFilter: string | undefined;
  let userFilter: string | undefined;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.city === "string" && body.city.trim()) cityFilter = body.city.trim();
      if (body && typeof body.user_id === "string" && body.user_id.trim()) userFilter = body.user_id.trim();
    }
  } catch { /* ignore */ }

  // Find users with YouTube connected
  let cq = svc
    .from("weather_settings")
    .select("user_id, youtube_refresh_token, youtube_access_token")
    .or("youtube_refresh_token.not.is.null,youtube_access_token.not.is.null");
  if (userFilter) cq = cq.eq("user_id", userFilter);
  const { data: candidates, error } = await cq;

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {

      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Array<{ user_id: string; ok: boolean; detail: string }> = [];
  for (const c of (candidates || [])) {
    if (!c.user_id) continue;
    try {
      const r = await runForUser(svc, c.user_id, cityFilter);
      results.push({ user_id: c.user_id, ...r });
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[recap] user ${c.user_id} failed:`, msg);
      results.push({ user_id: c.user_id, ok: false, detail: msg });
    }
  }

  await svc.from("system_health").upsert({
    id: "create-weekly-recap",
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_message: `${results.filter(r => r.ok).length}/${results.length} recaps`,
    updated_at: new Date().toISOString(),
  });

  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

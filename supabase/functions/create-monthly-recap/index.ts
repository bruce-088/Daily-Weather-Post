// Monthly Recap pipeline (ISOLATED).
//
// Goal: turn the last 30 days of successful posts into ONE long-form YouTube
// video — 7 slides: title + 4 weekly overviews + 1 "Moment of the Month"
// highlight + outro. Posted automatically at 23:59 UTC on the last day of
// each month.
//
// Hard rules (mirror weekly):
//   - DO NOT modify auto-post-scheduler or process-scheduled-posts.
//   - DO NOT share locks/queues with the daily pipeline.
//   - If video stitch fails -> generate an infographic image as fallback.
//
// Triggered by:
//   - pg_cron 23:59 UTC on the last day of each month -> POST /functions/v1/create-monthly-recap
//   - Manual: POST {city?, user_id?} with Authorization: Bearer <user JWT|service_role>
//
// Per-run flow (per user with YouTube connected):
//   1. Fetch last 30 days of succeeded posts from post_history
//   2. Bucket into 4 weekly summaries + auto-detect "Moment of the Month"
//   3. Ask Lovable AI for {title, script, weekSummaries[4], momentLine}
//   4. Build a Creatomate 7-slide composition + voice (2.5) + music (0.15)
//   5. Upload to YouTube as long-form (privacyStatus=public)
//   6. On stitch failure: generate a "Month in Review" infographic fallback.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  pickPresetForRecapSlide,
  resolveScene,
  logCinematic,
  type SceneDecision,
} from "../_shared/cinematic-presets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const CREATOMATE_API_KEY = Deno.env.get("CREATOMATE_API_KEY") || "";
const RECAP_MUSIC_URL = (Deno.env.get("RECAP_MUSIC_URL") || "").trim();

// Resolve ElevenLabs key from any of the legacy/canonical env names so a
// future rotation under either spelling keeps the recap voice working.
function resolveElevenLabsKey(): { value: string; source: string } | null {
  const candidates = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY", "ELEVENLABS_KEY"];
  for (const name of candidates) {
    const v = Deno.env.get(name);
    if (v && v.trim().length > 0) return { value: v.trim(), source: name };
  }
  return null;
}

// Shared voice map — mirrors process-scheduled-posts so user voice prefs apply.
const ELEVENLABS_VOICES: Record<string, string> = {
  female: "EXAVITQu4vr4xnSDxMaL",
  male: "JBFqnCBsd6RMkjVDRZzb",
  anchor: "onwK4e9ZLuTAKqWW03F9",
  cheerful: "Xb7hH8MSUJpSbSDYk0k2",
  calm: "cgSgspJ2msm6clMCkdW9",
  deep: "nPczCjzI2devNBz1zQrb",
};
function resolveVoiceId(input?: string | null): string {
  if (!input) return ELEVENLABS_VOICES.female;
  if (ELEVENLABS_VOICES[input]) return ELEVENLABS_VOICES[input];
  return input;
}
function clampVoiceParam(n: any, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

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


async function getLast30Posts(svc: any, userId: string, cityFilter?: string): Promise<PostRow[]> {
  const since = new Date(Date.now() - 31 * 86400 * 1000).toISOString();
  let q = svc
    .from("post_history")
    .select("id, city, temperature, condition, caption, image_url, post_url, created_at")
    .eq("user_id", userId)
    .in("status", ["succeeded", "success"])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(300);
  if (cityFilter) q = q.ilike("city", `%${cityFilter}%`);
  const { data, error } = await q;
  if (error) throw new Error(`post_history fetch failed: ${error.message}`);
  // Dedupe by day so multi-platform same-day posts collapse to one entry.
  const byDay = new Map<string, PostRow>();
  for (const p of (data || []) as PostRow[]) {
    const day = p.created_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, p);
  }
  return Array.from(byDay.values()).slice(-30);
}

// Bucket 30 days into 4 weekly groups (week 1 = oldest, week 4 = most recent).
function bucketWeeks(posts: PostRow[]): PostRow[][] {
  const buckets: PostRow[][] = [[], [], [], []];
  if (posts.length === 0) return buckets;
  const first = new Date(posts[0].created_at).getTime();
  for (const p of posts) {
    const daysSince = Math.floor((new Date(p.created_at).getTime() - first) / 86400000);
    const idx = Math.min(3, Math.floor(daysSince / 7));
    buckets[idx].push(p);
  }
  return buckets;
}

interface WeekStat {
  weekNum: number;
  avgHigh: number | null;
  avgLow: number | null;
  dominantCondition: string;
  count: number;
}
function summarizeWeek(weekNum: number, week: PostRow[]): WeekStat {
  if (week.length === 0) {
    return { weekNum, avgHigh: null, avgLow: null, dominantCondition: "—", count: 0 };
  }
  const temps = week.map((p) => p.temperature).filter((t): t is number => t != null);
  const avg = temps.length ? temps.reduce((s, t) => s + t, 0) / temps.length : null;
  // Without separate high/low fields, use avg ±5 as proxy for high/low band.
  const avgHigh = avg != null ? Math.round(avg + 5) : null;
  const avgLow = avg != null ? Math.round(avg - 5) : null;
  const condCounts = new Map<string, number>();
  for (const p of week) {
    const c = (p.condition ?? "").trim();
    if (!c) continue;
    condCounts.set(c, (condCounts.get(c) ?? 0) + 1);
  }
  let dominant = "—";
  let max = 0;
  for (const [c, n] of condCounts) {
    if (n > max) { max = n; dominant = c; }
  }
  return { weekNum, avgHigh, avgLow, dominantCondition: dominant, count: week.length };
}

// Pick the day with the most extreme deviation from the monthly mean temp.
function findMomentOfMonth(posts: PostRow[]): { post: PostRow; kind: "hottest" | "coldest" } | null {
  const withTemp = posts.filter((p) => p.temperature != null);
  if (withTemp.length === 0) return null;
  const mean = withTemp.reduce((s, p) => s + (p.temperature as number), 0) / withTemp.length;
  let best = withTemp[0];
  let bestDev = 0;
  for (const p of withTemp) {
    const dev = Math.abs((p.temperature as number) - mean);
    if (dev > bestDev) { bestDev = dev; best = p; }
  }
  return {
    post: best,
    kind: (best.temperature as number) >= mean ? "hottest" : "coldest",
  };
}

interface MonthlyScript {
  title: string;
  script: string;
  weekSummaries: string[]; // 4 entries, one-liner per week
  momentLine: string;
}

async function generateMonthlyScript(
  posts: PostRow[],
  topHooks: string[],
  weekStats: WeekStat[],
  moment: { post: PostRow; kind: "hottest" | "coldest" } | null,
): Promise<MonthlyScript> {
  const city = posts[0]?.city ?? "your city";
  const monthName = new Date(posts[posts.length - 1].created_at)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const weekBlock = weekStats.map((w) =>
    `Week ${w.weekNum}: ${w.count} days, avg high ${w.avgHigh ?? "—"}°F / low ${w.avgLow ?? "—"}°F, mostly ${w.dominantCondition}`
  ).join("\n");
  const momentBlock = moment
    ? `Moment of the Month — ${moment.kind === "hottest" ? "hottest" : "coldest"} day was ${new Date(moment.post.created_at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} at ${Math.round(moment.post.temperature as number)}°F (${moment.post.condition ?? "—"}).`
    : "";
  const hookBlock = topHooks.length
    ? `\n\nHigh-performing past openers (style reference):\n- ${topHooks.slice(0, 3).join("\n- ")}`
    : "";

  const prompt = `Write a YouTube long-form MONTHLY weather recap script for ${city} for ${monthName}.
Conversational, energetic, ~350-500 words. Structure: intro → week 1 → week 2 → week 3 → week 4 → "Moment of the Month" highlight → outro CTA "Follow for your daily forecast".

Data:
${weekBlock}
${momentBlock}${hookBlock}

Return JSON ONLY:
{
  "title": "Month in Review: ${city} — ${monthName}",
  "script": "full narration text",
  "weekSummaries": ["one-line summary for week 1", "...week 2", "...week 3", "...week 4"],
  "momentLine": "one-line summary of the Moment of the Month"
}
Title MUST start with "Month in Review:".`;

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
    throw new Error(`Lovable AI monthly script failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try { parsed = JSON.parse(content); } catch { /* ignore */ }
  const fallbackWeek = weekStats.map((w) =>
    `Week ${w.weekNum}: avg ${w.avgHigh ?? "—"}°/${w.avgLow ?? "—"}°, ${w.dominantCondition}`
  );
  const fallbackMoment = moment
    ? `${moment.kind === "hottest" ? "Hottest" : "Coldest"} day: ${Math.round(moment.post.temperature as number)}°F`
    : "A month of varied weather.";
  return {
    title: parsed.title || `Month in Review: ${city} — ${monthName}`,
    script: parsed.script || `Here's your ${monthName} weather recap for ${city}.`,
    weekSummaries: Array.isArray(parsed.weekSummaries) && parsed.weekSummaries.length === 4
      ? parsed.weekSummaries.map((s: any) => String(s))
      : fallbackWeek,
    momentLine: typeof parsed.momentLine === "string" && parsed.momentLine
      ? parsed.momentLine
      : fallbackMoment,
  };
}

// ───────────────── Creatomate stitch ─────────────────

interface StitchResult { url: string; data: Uint8Array; contentType: string; reportedDuration?: number; }

// Remove #Shorts-style hashtags so YouTube does not auto-classify the upload
// as a Short. Long-form recap MUST never carry these tags.
function stripShortsHashtag(s: string): string {
  return (s || "")
    .replace(/#shorts\b/gi, "")
    .replace(/#ytshorts\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
}

function createSilentWav(durationSeconds: number): Uint8Array {
  const sampleRate = 48000;
  const channels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.ceil(durationSeconds * sampleRate);
  const dataSize = samples * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  return new Uint8Array(buffer);
}

async function createSignedSilentAudio(svc: any, userId: string, durationSeconds: number): Promise<string | null> {
  const roundedDuration = Math.max(65, Math.ceil(durationSeconds));
  const wav = createSilentWav(roundedDuration);
  const path = `weekly-recap-audio/${userId}/${Date.now()}-${roundedDuration}s.wav`;
  const { error: uploadError } = await svc.storage.from("generated-images")
    .upload(path, wav, { contentType: "audio/wav", upsert: true });
  if (uploadError) {
    console.error("[monthly-recap] silent audio upload failed:", uploadError.message);
    return null;
  }
  const { data: signed, error: signedError } = await svc.storage.from("generated-images")
    .createSignedUrl(path, 60 * 60);
  if (signedError || !signed?.signedUrl) {
    console.error("[monthly-recap] silent audio signed url failed:", signedError?.message ?? "missing signed URL");
    return null;
  }
  console.log(`[monthly-recap] silent audio ready: duration=${roundedDuration}s bytes=${wav.byteLength}`);
  return signed.signedUrl;
}

// ───────────────── ElevenLabs voice narration ─────────────────
//
// Synthesize the weekly recap script via ElevenLabs and cache the mp3 in the
// `generated-images` bucket so render retries reuse the same asset.
// Gated by `weather_settings.enable_voiceover`. On ANY failure (no key, http,
// timeout, upload), returns null so the recap still renders silently.
async function synthesizeRecapVoice(
  svc: any,
  userId: string,
  script: string,
): Promise<{ url: string; durationSec: number } | null> {
  let settings: any = null;
  try {
    const { data } = await svc
      .from("weather_settings")
      .select("enable_voiceover, voiceover_voice_id, voiceover_speed, voiceover_stability, voiceover_similarity")
      .eq("user_id", userId)
      .maybeSingle();
    settings = data;
  } catch (e) {
    console.warn("[monthly-recap] could not load voiceover settings:", (e as Error).message);
  }

  if (!settings || settings.enable_voiceover !== true) {
    console.log(`[monthly-recap] voice synth skipped: enable_voiceover=${settings?.enable_voiceover ?? "n/a"}`);
    return null;
  }

  const key = resolveElevenLabsKey();
  if (!key) {
    console.error("[monthly-recap] voice synth failed, falling back to silent render: no ElevenLabs API key in env");
    return null;
  }

  const voiceId = settings.voiceover_voice_id || "female";
  const speed = clampVoiceParam(settings.voiceover_speed, 0.7, 1.2, 1.0);
  const stability = clampVoiceParam(settings.voiceover_stability, 0, 1, 0.55);
  const similarity = clampVoiceParam(settings.voiceover_similarity, 0, 1, 0.78);
  const wordCount = (script || "").trim().split(/\s+/).filter(Boolean).length;
  const estDurationSec = Math.max(10, Math.ceil(wordCount / 2.5));
  console.log(`[monthly-recap] synthesizing 0:${estDurationSec}s voice script via ElevenLabs voice=${voiceId} source=${key.source} words=${wordCount}`);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${resolveVoiceId(voiceId)}?output_format=mp3_44100_128`;
  const body = JSON.stringify({
    text: script,
    model_id: "eleven_turbo_v2_5",
    voice_settings: { stability, similarity_boost: similarity, style: 0.35, use_speaker_boost: true, speed },
  });

  let bytes: Uint8Array | null = null;
  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": key.value, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        bytes = new Uint8Array(await res.arrayBuffer());
        break;
      }
      const detail = (await res.text()).slice(0, 200);
      console.error(`[monthly-recap] voice synth attempt ${attempt}/${MAX_ATTEMPTS} failed: status=${res.status} ${detail}`);
      if (attempt < MAX_ATTEMPTS && res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[monthly-recap] voice synth failed, falling back to silent render");
      return null;
    } catch (e) {
      clearTimeout(timer);
      console.error(`[monthly-recap] voice synth attempt ${attempt}/${MAX_ATTEMPTS} error:`, (e as Error).message);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[monthly-recap] voice synth failed, falling back to silent render");
      return null;
    }
  }
  if (!bytes) {
    console.error("[monthly-recap] voice synth failed, falling back to silent render: no bytes");
    return null;
  }

  const path = `weekly-recap-audio/${userId}/${Date.now()}-voice.mp3`;
  const { error: upErr } = await svc.storage
    .from("generated-images")
    .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
  if (upErr) {
    console.error("[monthly-recap] voice synth failed, falling back to silent render: upload error:", upErr.message);
    return null;
  }
  const { data: signed, error: signedErr } = await svc.storage
    .from("generated-images")
    .createSignedUrl(path, 60 * 60);
  if (signedErr || !signed?.signedUrl) {
    console.error("[monthly-recap] voice synth failed, falling back to silent render: signed url error:", signedErr?.message);
    return null;
  }
  // mp3 @ 128kbps ≈ 16000 bytes/sec
  const durationSec = Math.max(estDurationSec, Math.ceil(bytes.byteLength / 16000));
  console.log(`[monthly-recap] voice asset ready: ${signed.signedUrl} bytes=${bytes.byteLength} duration=${durationSec}s`);
  return { url: signed.signedUrl, durationSec };
}



// Time-of-day → gradient stops for animated slide background.
function gradientForSlide(createdAt?: string): { from: string; to: string; label: string } {
  if (!createdAt) return { from: "#0f172a", to: "#581c87", label: "evening" };
  const h = new Date(createdAt).getHours();
  if (h < 12) return { from: "#1e3a8a", to: "#7e22ce", label: "morning" };
  if (h < 17) return { from: "#ea580c", to: "#f59e0b", label: "afternoon" };
  return { from: "#0f172a", to: "#581c87", label: "evening" };
}

// Full-frame animated gradient background. Slow scale (1.0 → 1.05) + gradient
// fill guarantees frame-to-frame change so Creatomate ALWAYS emits a real
// MP4, never a static JPEG, even when no image_url is available.
function buildAnimatedGradientBg(
  time: number,
  duration: number,
  grad: { from?: string; to?: string; label?: string } | null | undefined,
  slideNum?: number,
): any {
  // Creatomate gradient fill: stops use `offset` (0%..100%), NOT `position`.
  // Passing `position` triggers "Shape.fill_color[0].offset: Shouldn't be
  // null or undefined" and the entire render fails.
  const from = grad?.from;
  const to = grad?.to;
  const label = grad?.label ?? "?";

  // Safety fallback: missing gradient → solid hex so render never fails.
  if (!from || !to) {
    console.warn(
      `[monthly-recap] slide ${slideNum ?? "?"} missing gradient (label=${label}) — using solid fallback #0f172a`,
    );
    return {
      type: "shape",
      shape_type: "rectangle",
      width: "100%",
      height: "100%",
      x: "50%",
      y: "50%",
      fill_color: from || to || "#0f172a",
      time,
      duration,
    };
  }

  if (typeof slideNum === "number") {
    console.log(
      `[monthly-recap] slide ${slideNum} background gradient=${label} ${from}\u2192${to}`,
    );
  }
  return {
    type: "shape",
    shape_type: "rectangle",
    width: "100%",
    height: "100%",
    x: "50%",
    y: "50%",
    fill_color: [
      { offset: "0%", color: from },
      { offset: "100%", color: to },
    ],
    gradient: "linear",
    fill_color_type: "linear-gradient",
    fill_color_angle: 135,
    time,
    duration,
  };
}

// Full-frame dark scrim used between background and text for legibility.
function buildScrim(time: number, duration: number, opacity: number = 0.3): any {
  return {
    type: "shape",
    shape_type: "rectangle",
    width: "100%",
    height: "100%",
    x: "50%",
    y: "50%",
    fill_color: `rgba(0,0,0,${opacity})`,
    time,
    duration,
  };
}

// ── Storytelling variation tables ──
const LAYOUTS = ["center", "left", "right"] as const;
type LayoutKind = typeof LAYOUTS[number];
const THEME_KEYS = ["warm", "cool", "neutral"] as const;
type ThemeKey = typeof THEME_KEYS[number];
const THEMES: Record<ThemeKey, { from: string; to: string }> = {
  warm:    { from: "#ea580c", to: "#f59e0b" },
  cool:    { from: "#1e3a8a", to: "#7e22ce" },
  neutral: { from: "#334155", to: "#1e3a8a" },
};
// Flip to false in one place if Creatomate rejects the image pan animation.
const SAFE_IMAGE_ANIM = true;

// ── Condition → stock scene map (hotlinked CC0 Unsplash imagery) ──
const CONDITION_SCENES: Array<{ match: RegExp; label: string; url: string }> = [
  { match: /storm|thunder|lightning/i,       label: "storm_clouds", url: "https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?auto=format&fit=crop&w=1080&q=80" },
  { match: /rain|drizzle|shower/i,           label: "rainy_sky",    url: "https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=1080&q=80" },
  { match: /snow|sleet|blizzard|flurr/i,     label: "snowy_sky",    url: "https://images.unsplash.com/photo-1483921020237-2ff51e8e4b22?auto=format&fit=crop&w=1080&q=80" },
  { match: /cloud|overcast|fog|mist|haze/i,  label: "cloudy_sky",   url: "https://images.unsplash.com/photo-1500740516770-92bd004b996e?auto=format&fit=crop&w=1080&q=80" },
  { match: /clear|sunny|sun\b/i,             label: "bright_sky",   url: "https://images.unsplash.com/photo-1419833173245-f59e1b93f9ee?auto=format&fit=crop&w=1080&q=80" },
];

function pickConditionScene(cond?: string | null): { label: string; url: string } | null {
  if (!cond) return null;
  for (const s of CONDITION_SCENES) if (s.match.test(cond)) return { label: s.label, url: s.url };
  return null;
}

/**
 * Layer a background scene (image or video) BEHIND a translucent themed
 * gradient. Returns an array of Creatomate elements in z-order. If no scene
 * resolves OR the scene layer throws, falls back to gradient-only so the
 * render NEVER fails.
 */
function buildSlideBackground(opts: {
  time: number;
  duration: number;
  slideNum: number;
  grad: { from: string; to: string; label?: string };
  mode?: "image" | "video" | "gradient";
  mediaUrl?: string | null;
  condition?: string | null;
  logPrefix?: string;
  city?: string | null;
  recapSlideKind?: "title" | "day" | "week_stat" | "highlight" | "outro";
  decisionsOut?: SceneDecision[];
}): any[] {
  const { time, duration, slideNum, grad, mediaUrl, condition } = opts;
  const mode = opts.mode ?? "image";
  const prefix = opts.logPrefix ?? "monthly-recap";
  let sceneEl: any = null;
  let sceneLabel: string | null = null;
  let sceneUrl: string | null = null;

  if (mode !== "gradient") {
    try {
      if (mediaUrl) {
        sceneUrl = mediaUrl;
        sceneLabel = "history_image";
      } else if (condition) {
        const pick = pickConditionScene(condition);
        if (pick) { sceneUrl = pick.url; sceneLabel = pick.label; }
      }
      if (sceneUrl) {
        if (mode === "video") {
          sceneEl = {
            type: "video", source: sceneUrl,
            fit: "cover", loop: true,
            width: "100%", height: "100%", x: "50%", y: "50%",
            time, duration,
            animations: [{ type: "scale", from: 1.0, to: 1.05, easing: "linear", scope: "element" }],
          };
        } else {
          sceneEl = {
            type: "image", source: sceneUrl,
            fit: "cover",
            width: "100%", height: "100%", x: "50%", y: "50%",
            time, duration,
          };
          if (SAFE_IMAGE_ANIM) {
            sceneEl.animations = [{ type: "scale", from: 1.0, to: 1.05, easing: "linear", scope: "element" }];
          }
        }
      }
    } catch (e) {
      console.warn(`[${prefix}] slide ${slideNum} scene failed, gradient-only:`, (e as Error)?.message);
      sceneEl = null;
    }
  }

  const out: any[] = [];
  if (sceneEl) {
    out.push(sceneEl);
    console.log(`[${prefix}] slide ${slideNum} background=${mode} ${sceneLabel} (${sceneUrl})`);
    const overlay = buildAnimatedGradientBg(time, duration, grad, slideNum);
    overlay.opacity = "25%";
    out.push(overlay);
  } else {
    console.log(`[${prefix}] slide ${slideNum} background=gradient ${grad.label ?? "?"} (no scene)`);
    out.push(buildAnimatedGradientBg(time, duration, grad, slideNum));
  }

  // [cinematic] Emit unified decision log + accumulate.
  try {
    const preset = pickPresetForRecapSlide({
      kind: opts.recapSlideKind ?? "week_stat",
      condition,
      city: opts.city,
      slideIndex: slideNum,
    });
    const decision = resolveScene({
      city: opts.city,
      condition,
      mediaUrl,
      preset,
      mode,
      slideIndex: slideNum,
    });
    logCinematic(prefix, decision, { city: opts.city, kind: opts.recapSlideKind ?? "week_stat", slide: slideNum });
    if (opts.decisionsOut) opts.decisionsOut.push(decision);
  } catch (e) {
    console.warn(`[${prefix}] slide ${slideNum} cinematic-log failed:`, (e as Error)?.message);
  }

  return out;
}

function layoutTextProps(layout: LayoutKind): { x: string; width: string; x_alignment: string } {
  if (layout === "left")  return { x: "30%", width: "60%", x_alignment: "0%" };
  if (layout === "right") return { x: "70%", width: "60%", x_alignment: "100%" };
  return { x: "50%", width: "90%", x_alignment: "50%" };
}

interface MonthlySlideData {
  weekStats: WeekStat[];        // 4 entries
  weekSummaries: string[];      // 4 entries (AI one-liners)
  moment: { post: PostRow; kind: "hottest" | "coldest" } | null;
  momentLine: string;
  monthName: string;
}

async function stitchSlideshow(
  svc: any,
  userId: string,
  posts: PostRow[],
  title: string,
  monthly: MonthlySlideData,
  voice?: { url: string; durationSec: number },
): Promise<StitchResult | null> {
  if (!CREATOMATE_API_KEY) {
    console.warn("[monthly-recap] CREATOMATE_API_KEY missing — skipping stitch");
    return null;
  }
  const city = posts[0]?.city ?? "your city";

  // 7 slides total: title + 4 weeks + moment + outro
  const CONTENT_SLIDES = 6; // 4 weeks + moment
  const TOTAL_SLIDES = CONTENT_SLIDES + 2; // + title + outro

  // Voice is the master clock. Spread visual time evenly across slides so the
  // outro doesn't balloon when voice is long (monthly script ~350-500 words).
  const voiceDur = voice ? Math.ceil(voice.durationSec + 1) : 0;
  const minTotal = Math.max(180, voiceDur, TOTAL_SLIDES * 12); // 3 min floor
  const SLIDE_DUR = Math.max(12, Math.ceil(minTotal / TOTAL_SLIDES));
  console.log(`[monthly-recap] stitch inputs: weeks=${monthly.weekStats.length} moment=${monthly.moment ? "yes" : "no"} slide_dur=${SLIDE_DUR}s voice=${voiceDur}s`);

  const elements: any[] = [];
  // [cinematic] Per-recap accumulator for system_logs.
  const cinematicDecisions: SceneDecision[] = [];

  // ── Title card ──
  const titleGrad = gradientForSlide();
  elements.push(buildAnimatedGradientBg(0, SLIDE_DUR, { ...titleGrad }, 1));
  elements.push(buildScrim(0, SLIDE_DUR));
  elements.push({
    type: "text", text: title,
    x: "50%", y: "30%", width: "90%",
    font_family: "Inter", font_weight: "800",
    font_size: "10 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 24,
    time: 0, duration: SLIDE_DUR,
    animations: [{ type: "fade", duration: 1.2, scope: "element" }],
  });
  elements.push({
    type: "text", text: monthly.monthName,
    x: "50%", y: "55%", width: "70%",
    font_family: "Inter", font_weight: "500",
    font_size: "4 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 12,
    time: 0, duration: SLIDE_DUR,
  });
  console.log("[monthly-recap] title font=10vh animation=fade");

  // ── 4 weekly overview slides ──
  monthly.weekStats.forEach((w, i) => {
    const start = (i + 1) * SLIDE_DUR;
    const layout: LayoutKind = LAYOUTS[i % 3];
    const themeKey: ThemeKey = THEME_KEYS[i % 3];
    const grad = THEMES[themeKey];
    const textPos = layoutTextProps(layout);

    elements.push(...buildSlideBackground({
      time: start, duration: SLIDE_DUR, slideNum: i + 2,
      grad: { ...grad, label: themeKey },
      mode: "image",
      condition: w.dominantCondition ?? null,
      logPrefix: "monthly-recap",
      city,
      recapSlideKind: "week_stat",
      decisionsOut: cinematicDecisions,
    }));
    elements.push(buildScrim(start, SLIDE_DUR, 0.32));

    const headline = `Week ${w.weekNum}`;
    const stats = w.avgHigh != null
      ? `${w.avgHigh}° / ${w.avgLow}°  ·  ${w.dominantCondition}`
      : "—";
    const summary = monthly.weekSummaries[i] ?? "";

    elements.push({
      type: "text", text: headline,
      x: textPos.x, y: "28%", width: textPos.width,
      x_alignment: textPos.x_alignment,
      font_family: "Inter", font_weight: "800",
      font_size: "8 vh", fill_color: "#ffffff",
      background_color: "rgba(0,0,0,0.25)", padding: 16,
      time: start, duration: SLIDE_DUR,
    });
    elements.push({
      type: "text", text: stats,
      x: textPos.x, y: "48%", width: textPos.width,
      x_alignment: textPos.x_alignment,
      font_family: "Inter", font_weight: "700",
      font_size: "5 vh", fill_color: "#ffffff",
      background_color: "rgba(0,0,0,0.25)", padding: 12,
      time: start, duration: SLIDE_DUR,
    });
    if (summary) {
      elements.push({
        type: "text", text: summary,
        x: textPos.x, y: "68%", width: textPos.width,
        x_alignment: textPos.x_alignment,
        font_family: "Inter", font_weight: "500",
        font_size: "3.4 vh", fill_color: "#ffffff",
        background_color: "rgba(0,0,0,0.25)", padding: 12,
        time: start, duration: SLIDE_DUR,
      });
    }
    console.log(`[monthly-recap] slide ${i + 1} week=${w.weekNum} layout=${layout} theme=${themeKey} days=${w.count}`);
  });

  // ── Moment of the Month highlight slide (slide 6) ──
  const momentStart = (monthly.weekStats.length + 1) * SLIDE_DUR;
  const momentLayout: LayoutKind = "center";
  const momentTheme: ThemeKey = monthly.moment?.kind === "coldest" ? "cool" : "warm";
  const momentGrad = THEMES[momentTheme];
  const momentTextPos = layoutTextProps(momentLayout);
  elements.push(...buildSlideBackground({
    time: momentStart, duration: SLIDE_DUR, slideNum: monthly.weekStats.length + 2,
    grad: { ...momentGrad, label: momentTheme },
    mode: "image",
    mediaUrl: monthly.moment?.post.image_url ?? null,
    condition: monthly.moment?.post.condition ?? null,
    logPrefix: "monthly-recap",
    city,
    recapSlideKind: "highlight",
    decisionsOut: cinematicDecisions,
  }));
  elements.push(buildScrim(momentStart, SLIDE_DUR, 0.4));

  elements.push({
    type: "text", text: "Moment of the Month",
    x: momentTextPos.x, y: "22%", width: momentTextPos.width,
    x_alignment: momentTextPos.x_alignment,
    font_family: "Inter", font_weight: "600",
    font_size: "3.8 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 12,
    time: momentStart, duration: SLIDE_DUR,
  });
  const momentHeadline = monthly.moment
    ? `${monthly.moment.kind === "hottest" ? "🔥 Hottest day" : "❄️ Coldest day"}\n${Math.round(monthly.moment.post.temperature as number)}°F`
    : "A month to remember";
  elements.push({
    type: "text", text: momentHeadline,
    x: momentTextPos.x, y: "45%", width: momentTextPos.width,
    x_alignment: momentTextPos.x_alignment,
    font_family: "Inter", font_weight: "800",
    font_size: "7.7 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 24,
    time: momentStart, duration: SLIDE_DUR,
  });
  elements.push({
    type: "text", text: monthly.momentLine,
    x: momentTextPos.x, y: "70%", width: momentTextPos.width,
    x_alignment: momentTextPos.x_alignment,
    font_family: "Inter", font_weight: "500",
    font_size: "3.4 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 12,
    time: momentStart, duration: SLIDE_DUR,
  });
  console.log(`[monthly-recap] slide 6 moment kind=${monthly.moment?.kind ?? "none"} theme=${momentTheme}`);

  // ── Outro card ──
  const outroStart = (monthly.weekStats.length + 2) * SLIDE_DUR;
  const outroGrad = gradientForSlide();
  const outroBgIdx = elements.length;
  elements.push(buildAnimatedGradientBg(outroStart, SLIDE_DUR, { ...outroGrad }, monthly.weekStats.length + 3));
  const outroScrimIdx = elements.length;
  elements.push(buildScrim(outroStart, SLIDE_DUR));
  const outroTextIdx = elements.length;
  elements.push({
    type: "text",
    text: `Follow for your daily forecast\n${city} weather, every day.`,
    x: "50%", y: "50%", width: "90%",
    font_family: "Inter", font_weight: "800",
    font_size: "7 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 24,
    time: outroStart, duration: SLIDE_DUR,
  });
  console.log("[monthly-recap] outro cta=follow");

  const visualDuration0 = TOTAL_SLIDES * SLIDE_DUR;
  let totalDuration = Math.max(visualDuration0, voiceDur, 180);
  if (totalDuration > visualDuration0) {
    const pad = totalDuration - visualDuration0;
    elements[outroTextIdx].duration += pad;
    elements[outroScrimIdx].duration += pad;
    elements[outroBgIdx].duration += pad;
  }
  console.log(`[monthly-recap] timing: visual=${visualDuration0}s voice=${voice?.durationSec ?? 0}s total=${totalDuration}s outro_extended=${totalDuration - visualDuration0}s slides=${TOTAL_SLIDES}`);



  // ── Audio mix ──
  const hasVoice = !!voice;
  const hasMusic = !!RECAP_MUSIC_URL;
  let usedSilentFallback = false;
  if (hasVoice) {
    elements.push({
      type: "audio",
      source: voice!.url,
      time: 0,
      duration: totalDuration,
      volume: 2.5,
    });
  }
  if (hasMusic) {
    elements.push({
      type: "audio",
      source: RECAP_MUSIC_URL,
      time: 0,
      duration: totalDuration,
      volume: 0.15,
    });
  }
  if (!hasVoice && !hasMusic) {
    const silentAudioUrl = await createSignedSilentAudio(svc, userId, totalDuration);
    if (silentAudioUrl) {
      usedSilentFallback = true;
      elements.push({
        type: "audio",
        source: silentAudioUrl,
        time: 0,
        duration: totalDuration,
        volume: 0.01,
      });
    } else {
      console.warn("[monthly-recap] continuing without any audio track; YouTube may abandon processing");
    }
  }
  console.log(`[monthly-recap] audio mix: voice=${hasVoice ? "yes(vol=2.5)" : "no"} music=${hasMusic ? "yes(vol=0.15)" : "no"} silent_fallback=${usedSilentFallback ? "yes" : "no"}`);

  // ── Safety fallback: never ship a visually empty composition ──
  const visualCountPre = elements.filter((e) => e.type !== "audio").length;
  if (visualCountPre === 0) {
    console.warn("[monthly-recap] safety fallback: no visual elements, pushing solid background");
    elements.unshift({
      type: "shape",
      shape_type: "rectangle",
      width: "100%", height: "100%", x: "50%", y: "50%",
      fill_color: "#0f172a",
      time: 0, duration: totalDuration,
    });
  }

  const visualCount = elements.filter((e) => e.type !== "audio").length;
  const audioCount = elements.length - visualCount;
  console.log(`[monthly-recap] elements count=${elements.length} visual=${visualCount} audio=${audioCount}`);

  // Debug: identify any element (or nested animation) missing `type`
  elements.forEach((el, idx) => {
    if (!el || typeof el.type !== "string" || el.type.length === 0) {
      console.error(`[monthly-recap] BAD_ELEMENT idx=${idx} keys=${Object.keys(el ?? {}).join(",")} preview=${JSON.stringify(el).slice(0, 300)}`);
    }
    if (Array.isArray(el?.animations)) {
      el.animations.forEach((a: any, ai: number) => {
        if (!a || typeof a.type !== "string") {
          console.error(`[monthly-recap] BAD_ANIMATION el=${idx} ai=${ai} preview=${JSON.stringify(a).slice(0, 300)}`);
        }
      });
    }
  });
  console.log(`[monthly-recap] DEBUG full source: ${JSON.stringify({ width: 1920, height: 1080, duration: totalDuration, elements }).slice(0, 4000)}`);

  // Creatomate v2 expects source fields (width/height/duration/elements) at
  // the TOP LEVEL of the request body, not nested under a `source` key.
  // Nesting causes Creatomate to ignore them and emit a 5-second default
  // composition. Matches the working daily pipeline shape.
  const body = {
    output_format: "mp4",
    frame_rate: 30,
    width: 1920,
    height: 1080,
    duration: totalDuration,
    fill_color: "#0f172a",
    elements,
  };

  console.log(
    `[monthly-recap] Creatomate payload (no template_id, dynamic source): ${JSON.stringify(body)}`,
  );

  const submit = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const submitText = await submit.text();
  if (!submit.ok) {
    console.error("[monthly-recap] Creatomate submit failed:", submit.status, submitText.slice(0, 300));
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
    console.log(`[monthly-recap] creatomate poll ${i}: status=${sd.status} url=${sd.url ?? "?"} snapshot=${sd.snapshot_url ?? "?"} dur=${sd.duration ?? "?"} format=${sd.format ?? sd.output_format ?? "?"} err=${sd.error_message ?? ""}`);
    if (sd.status === "succeeded" && sd.url) {
      const reportedDuration: number | undefined =
        typeof sd.duration === "number" ? sd.duration : undefined;
      console.log(`[monthly-recap] render duration reported by Creatomate: ${reportedDuration ?? "?"}s`);
      if (typeof reportedDuration === "number" && reportedDuration < 60) {
        console.warn(`[monthly-recap] WARNING: duration under 60s, YouTube will reject`);
      }
      const dl = await fetch(sd.url);
      if (!dl.ok) {
        console.error(`[monthly-recap] ABORT: render output invalid (download status=${dl.status})`);
        return null;
      }
      const contentType = dl.headers.get("content-type") || "unknown";
      const ab = await dl.arrayBuffer();
      const bytes = ab.byteLength;
      console.log(`[monthly-recap] render output size=${bytes} type=${contentType}`);
      if (bytes < 100_000 || !/video\/mp4/i.test(contentType)) {
        console.error(`[monthly-recap] ABORT: render output invalid (bytes=${bytes} type=${contentType})`);
        return null;
      }
      console.log(`[monthly-recap] stitched mp4 ready: url=${sd.url} bytes=${bytes}`);
      try {
        const sources: Record<string, number> = {};
        let eligible = 0;
        for (const d of cinematicDecisions) {
          sources[d.source] = (sources[d.source] ?? 0) + 1;
          if (d.eligibleForLearning) eligible++;
        }
        await svc.from("system_logs").insert({
          user_id: userId,
          type: "cinematic_recap_render",
          platform: "youtube",
          message: `monthly recap: ${cinematicDecisions.length} slides (${eligible} eligible)`,
          context: {
            kind: "monthly",
            city,
            slide_count: cinematicDecisions.length,
            eligible_count: eligible,
            sources,
            decisions: cinematicDecisions,
          },
        });
      } catch (e) {
        console.warn(`[monthly-recap] cinematic system_logs insert failed:`, (e as Error)?.message);
      }
      return { url: sd.url, data: new Uint8Array(ab), contentType, reportedDuration };
    }
    if (sd.status === "failed") {
      console.error("[monthly-recap] Creatomate render failed:", sd.error_message);
      return null;
    }
  }
  console.error("[monthly-recap] Creatomate poll timeout");
  return null;
}

// ───────────────── YouTube long-form upload ─────────────────
// City-scoped token resolution lives in _shared/recap-youtube-token.ts — it
// reuses the same YouTubeAdapter as Shorts (per-city social_accounts first,
// then legacy weather_settings fallback).
import { getRecapYouTubeToken, listYouTubeConnectedUserIds } from "../_shared/recap-youtube-token.ts";

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
          tags: ["Monthly Recap", "Weather", "SkyBrief", "Month in Review"],
        },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!initRes.ok) {
    const errText = await initRes.text();
    console.error(`[monthly-recap] YouTube upload failed: ${initRes.status} ${errText.slice(0, 500)}`);
    return null;
  }
  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) {
    console.error("[monthly-recap] YouTube upload failed: missing resumable Location header");
    return null;
  }
  const up = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: videoData,
  });
  if (!up.ok) {
    const errText = await up.text();
    console.error(`[monthly-recap] YouTube upload failed: ${up.status} ${errText.slice(0, 500)}`);
    return null;
  }
  const j = await up.json();
  console.log(`[monthly-recap] YT response: ${JSON.stringify(j).slice(0, 500)}`);
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
white bold sans-serif typography, large title "${title}", monthly weather summary
displayed as a tidy 4-week grid with weather icons. Data: ${lines}. Minimalist, editorial,
high contrast. No watermark.`;
  try {
    // Lovable AI image generation lives on the chat completions endpoint with
    // modalities=["image","text"], not /v1/images/generations (which 404s).
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[monthly-recap] image gen failed, falling back to animated gradient: status=${res.status} ${errText.slice(0, 200)}`);
      return null;
    }
    const j = await res.json();
    const dataUrl: string | undefined =
      j?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      console.error("[monthly-recap] image gen failed, falling back to animated gradient: no image in response");
      return null;
    }
    const b64 = dataUrl.split(",")[1] ?? "";
    if (!b64) {
      console.error("[monthly-recap] image gen failed, falling back to animated gradient: empty base64");
      return null;
    }
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return bin;
  } catch (e) {
    console.error(`[monthly-recap] image gen failed, falling back to animated gradient: ${(e as Error).message}`);
    return null;
  }
}

// ───────────────── per-user runner ─────────────────

async function runForUser(svc: any, userId: string, cityFilter?: string, opts?: { skipPost?: boolean }): Promise<{ ok: boolean; detail: string; preview_url?: string }> {
  const skipPost = !!opts?.skipPost;
  const posts = await getLast30Posts(svc, userId, cityFilter);
  if (posts.length < 8) {
    return { ok: false, detail: `Only ${posts.length} posts in last 30 days${cityFilter ? ` for ${cityFilter}` : ""} — skipping monthly recap (need 8+)` };
  }
  const topHooks = await getTopHooks(svc, userId);
  const weekBuckets = bucketWeeks(posts);
  const weekStats = weekBuckets.map((w, i) => summarizeWeek(i + 1, w));
  const moment = findMomentOfMonth(posts);
  const monthName = new Date(posts[posts.length - 1].created_at)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const { title, script, weekSummaries, momentLine } = await generateMonthlyScript(posts, topHooks, weekStats, moment);
  const finalTitle = title.startsWith("Month in Review") ? title : `Month in Review: ${posts[0].city} — ${monthName}`;
  const description = `${script}\n\n#MonthlyRecap #Weather #SkyBrief`;

  // Voice narration (master clock). Skipped silently if disabled or it fails.
  const voice = await synthesizeRecapVoice(svc, userId, script);

  // Try video stitch
  const stitched = await stitchSlideshow(
    svc, userId, posts, finalTitle,
    { weekStats, weekSummaries, moment, momentLine, monthName },
    voice ?? undefined,
  );

  if (stitched) {
    if (skipPost) {
      console.log(`[monthly-recap] dev-test skip_post=true preview_url=${stitched.url}`);
      return { ok: true, detail: "Dev test render complete", preview_url: stitched.url };
    }
    const tokenRes = await getRecapYouTubeToken(svc, userId, posts[0].city);
    if (!tokenRes.token) {
      const errMsg = tokenRes.message || "No YouTube token for monthly recap";
      console.error(`[monthly-recap] ${errMsg} (city=${posts[0].city}, reason=${tokenRes.reason})`);
      await svc.from("post_history").insert({
        user_id: userId, status: "failed", platform: "youtube",
        city: posts[0].city, caption: finalTitle,
        error_message: errMsg,
      });
      await svc.from("notifications").insert({
        user_id: userId, type: "error",
        title: "⚠️ Monthly Recap failed",
        message: tokenRes.reason === "AUTH_EXPIRED"
          ? `Reconnect YouTube for ${posts[0].city} — token expired.`
          : tokenRes.reason === "ROUTING_VIOLATION"
          ? `Assign a YouTube channel to ${posts[0].city} in Settings.`
          : `Couldn't post monthly recap for ${posts[0].city}: ${errMsg}`,
      });
      return { ok: false, detail: errMsg };
    }
    const token = tokenRes.token;
    const cleanTitle = stripShortsHashtag(finalTitle);
    const cleanDesc = stripShortsHashtag(description);

    // Pre-upload guard: HEAD the rendered URL one more time before pushing to YouTube.
    try {
      const head = await fetch(stitched.url, { method: "HEAD" });
      const hLen = Number(head.headers.get("content-length") || "0");
      const hType = head.headers.get("content-type") || "unknown";
      console.log(`[monthly-recap] pre-upload HEAD check: status=${head.status} length=${hLen} type=${hType}`);
      if ((hLen > 0 && hLen < 100_000) || (hType !== "unknown" && !/video\/mp4/i.test(hType))) {
        console.error(`[monthly-recap] ABORT: pre-upload guard rejected file (length=${hLen} type=${hType})`);
        await svc.from("post_history").insert({
          user_id: userId, status: "failed", platform: "youtube",
          city: posts[0].city, caption: finalTitle,
          error_message: `Pre-upload guard rejected file (length=${hLen} type=${hType})`,
        });
        return { ok: false, detail: "Pre-upload guard rejected file" };
      }
    } catch (e) {
      console.warn(`[monthly-recap] pre-upload HEAD check failed (continuing): ${(e as Error).message}`);
    }

    const videoId = await uploadLongFormToYouTube(token, stitched.data, cleanTitle, cleanDesc);
    if (videoId) {
      console.log(`[monthly-recap] uploaded to YouTube as videoId: ${videoId}`);
      await svc.from("post_history").insert({
        user_id: userId, status: "succeeded", platform: "youtube",
        city: posts[0].city, caption: cleanTitle,
        post_url: `https://www.youtube.com/watch?v=${videoId}`,
        external_id: videoId,
      });
      await svc.from("notifications").insert({
        user_id: userId, type: "success",
        title: "📺 Monthly Recap published!",
        message: `${cleanTitle} is live on YouTube.`,
      });
      return { ok: true, detail: `Uploaded ${videoId}` };
    }

    // upload failed -> fall through to infographic fallback
    console.warn("[monthly-recap] YT upload failed — falling back to infographic");
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
  const path = `monthly-recap/${userId}/${Date.now()}.png`;
  const { error: upErr } = await svc.storage.from("generated-images")
    .upload(path, img, { contentType: "image/png", upsert: true });
  if (upErr) console.error("[monthly-recap] storage upload failed:", upErr);
  const { data: signed } = await svc.storage.from("generated-images")
    .createSignedUrl(path, 60 * 60 * 24 * 30);

  await svc.from("post_history").insert({
    user_id: userId, status: "fallback_image", platform: "youtube",
    city: posts[0].city, caption: finalTitle,
    image_url: signed?.signedUrl ?? null,
    error_message: "Video stitch unavailable — generated Month in Review infographic instead",
  });
  await svc.from("notifications").insert({
    user_id: userId, type: "warning",
    title: "🖼️ Monthly Recap fallback ready",
    message: "We couldn't stitch the monthly video, so we made a Month in Review infographic instead.",
  });
  return { ok: true, detail: "Fallback infographic generated" };
}

// ───────────────── HTTP entrypoint ─────────────────

import { requireCronOrUser } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireCronOrUser(req);
  if (!gate.ok) return gate.response;

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Optional body: { city?: string, user_id?: string } for manual test runs.
  let cityFilter: string | undefined;
  let userFilter: string | undefined;
  let skipPost = false;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.city === "string" && body.city.trim()) cityFilter = body.city.trim();
      if (body && typeof body.user_id === "string" && body.user_id.trim()) userFilter = body.user_id.trim();
      if (body && body.skip_post === true) skipPost = true;
    }
  } catch { /* ignore */ }

  if (skipPost) {
    console.log(`[dev-test] monthly triggered for city=${cityFilter ?? "(any)"} (skipping upload)`);
  } else if (cityFilter || userFilter) {
    console.log(`[manual-post] monthly triggered for city=${cityFilter ?? "(any)"} by user=${gate.source === "user" ? gate.userId : (userFilter ?? "cron")}`);
  }

  // Last-day-of-month guard for cron-only invocations (cron is scheduled 28-31 nightly;
  // only the actual last day should fire). Manual user-triggered or explicit filters bypass.
  if (gate.source === "cron" && !cityFilter && !userFilter) {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const isLastDay = now.getUTCMonth() !== tomorrow.getUTCMonth();
    if (!isLastDay) {
      console.log(`[monthly-recap] cron skipped: not last day of month (UTC date=${now.toISOString().slice(0,10)})`);
      return new Response(JSON.stringify({ ok: true, skipped: "not-last-day" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Find users with YouTube connected
  let cq = svc
    .from("weather_settings")
    .select("user_id, youtube_refresh_token, youtube_access_token")
    .or("youtube_refresh_token.not.is.null,youtube_access_token.not.is.null");
  if (gate.source === "user") {
    cq = cq.eq("user_id", gate.userId);
  } else if (userFilter) {
    cq = cq.eq("user_id", userFilter);
  }
  const { data: candidates, error } = await cq;

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {

      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const candidateList = (candidates || []).filter((c: any) => c.user_id);

  // Dev-test mode: run synchronously and return the preview URL inline.
  if (skipPost) {
    try {
      const target = candidateList[0];
      if (!target) {
        return new Response(JSON.stringify({ ok: false, error: "no candidate users" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const r = await runForUser(svc, target.user_id, cityFilter, { skipPost: true });
      return new Response(
        JSON.stringify({ ok: r.ok, mode: "dev", preview_url: r.preview_url ?? null, detail: r.detail }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const work = async () => {
    const results: Array<{ user_id: string; ok: boolean; detail: string }> = [];
    for (const c of candidateList) {
      try {
        const r = await runForUser(svc, c.user_id, cityFilter);
        results.push({ user_id: c.user_id, ...r });
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`[monthly-recap] user ${c.user_id} failed:`, msg);
        results.push({ user_id: c.user_id, ok: false, detail: msg });
        try {
          await svc.from("post_history").insert({
            user_id: c.user_id, status: "failed", platform: "youtube",
            caption: "Month in Review",
            error_message: `Background recap failed: ${msg}`,
          });
        } catch { /* ignore */ }
      }
    }

    try {
      await svc.from("system_health").upsert({
        id: "create-monthly-recap",
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_message: `${results.filter(r => r.ok).length}/${results.length} recaps`,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[monthly-recap] system_health upsert failed:", (e as Error).message);
    }

    console.log(`[monthly-recap] background job complete: ${results.filter(r => r.ok).length}/${results.length} recaps`);
  };

  // @ts-ignore — EdgeRuntime is provided by Supabase Edge
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work());
  } else {
    work().catch((e) => console.error("[monthly-recap] background failed:", (e as Error).message));
  }

  return new Response(
    JSON.stringify({ ok: true, accepted: true, candidates: candidateList.length }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});


// Yearly Recap pipeline — long-form "Year in Review" video.
//
// Premium product: turns a full calendar year of successful daily posts
// into an 8-slide YouTube long-form video (3–5 min).
//
// Hard rules (mirror weekly + monthly):
//   - DO NOT modify auto-post-scheduler or process-scheduled-posts.
//   - DO NOT share locks/queues with the daily pipeline.
//   - If video stitch fails -> generate an infographic image as fallback.
//   - Manual trigger only (no cron). Admin-gated in UI via feature flag.
//
// Triggered by:
//   POST /functions/v1/create-yearly-recap
//   Body: { city: string, year?: number, user_id?: string, skip_post?: boolean, test_mode?: boolean }
//
// Composition (8 slides):
//   1. Intro       — "{year} Year in Review: {City}"
//   2. Winter      — Dec(prev) + Jan + Feb
//   3. Spring      — Mar–May
//   4. Summer      — Jun–Aug
//   5. Fall        — Sep–Nov
//   6. The Big One — most severe / highest-engagement event
//   7. Annual Stats
//   8. Outro       — "Onward to {year+1}"
//
// All slide backgrounds route through the shared cinematic-presets module:
// every decision is logged via logCinematic and accumulated in system_logs
// under type='yearly_recap_render'. Any gradient_only / degraded_fallback
// slide demotes the parent post_history row from learning (firewall).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  pickPresetForRecapSlide,
  resolveScene,
  logCinematic,
  buildVisualMetadata,
  type SceneDecision,
  type RecapSlideKind,
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

const SEVERE_RE = /storm|severe|tornado|blizzard|hurricane|extreme heat|excessive heat/i;

// ───────────────── env helpers (mirror monthly recap) ─────────────────

function resolveElevenLabsKey(): { value: string; source: string } | null {
  const candidates = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY", "ELEVENLABS_KEY"];
  for (const name of candidates) {
    const v = Deno.env.get(name);
    if (v && v.trim().length > 0) return { value: v.trim(), source: name };
  }
  return null;
}

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

// ───────────────── data types ─────────────────

interface PostRow {
  id: string;
  city: string;
  temperature: number | null;
  condition: string | null;
  caption: string | null;
  image_url: string | null;
  post_url: string | null;
  created_at: string;
  views_count?: number | null;
  likes_count?: number | null;
}

type Season = "winter" | "spring" | "summer" | "fall";

interface SeasonStat {
  season: Season;
  label: string;
  posts: PostRow[];
  avgTemp: number | null;
  highTemp: { value: number; date: string } | null;
  lowTemp: { value: number; date: string } | null;
  dominantCondition: string;
  topPost: PostRow | null;
}

interface AnnualStats {
  totalPosts: number;
  rainyDays: number;
  sunniestMonthName: string;
  sunniestMonthPct: number;
  highest: { value: number; date: string } | null;
  lowest: { value: number; date: string } | null;
}

interface YearlyData {
  city: string;
  year: number;
  seasons: SeasonStat[];      // up to 4, dropped if empty
  bigOne: PostRow | null;     // most severe / highest-engagement event
  stats: AnnualStats;
}

// ───────────────── settings loader (for cinematic toggles) ─────────────────

async function loadCinematicSettings(svc: any, userId: string) {
  try {
    const { data } = await svc
      .from("weather_settings")
      .select("smart_cost_strategy, strict_visuals_gainesville, exclude_fallback_from_learning, auto_cinematic_for_storms")
      .eq("user_id", userId)
      .maybeSingle();
    return data ?? {};
  } catch {
    return {};
  }
}

// ───────────────── data aggregation ─────────────────

async function getYearPosts(
  svc: any,
  userId: string,
  cityFilter: string,
  year: number,
): Promise<PostRow[]> {
  // Winter spans Dec of prior year → fetch from Dec 1 (year-1) to Jan 1 (year+1).
  const fromIso = new Date(Date.UTC(year - 1, 11, 1)).toISOString();
  const toIso = new Date(Date.UTC(year + 1, 0, 1)).toISOString();
  const { data, error } = await svc
    .from("post_history")
    .select("id, city, temperature, condition, caption, image_url, post_url, created_at, views_count, likes_count")
    .eq("user_id", userId)
    .in("status", ["succeeded", "success"])
    .gte("created_at", fromIso)
    .lt("created_at", toIso)
    .ilike("city", `%${cityFilter}%`)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`post_history yearly fetch failed: ${error.message}`);
  // Dedupe by day so multi-platform same-day posts collapse to one entry.
  const byDay = new Map<string, PostRow>();
  for (const p of (data || []) as PostRow[]) {
    const day = p.created_at.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, p);
  }
  return Array.from(byDay.values());
}

function seasonForDate(iso: string, year: number): Season | null {
  const d = new Date(iso);
  const m = d.getUTCMonth(); // 0-based
  const y = d.getUTCFullYear();
  // Winter: Dec (year-1) + Jan/Feb of `year`.
  if (m === 11 && y === year - 1) return "winter";
  if ((m === 0 || m === 1) && y === year) return "winter";
  if (y !== year) return null;
  if (m >= 2 && m <= 4) return "spring";
  if (m >= 5 && m <= 7) return "summer";
  if (m >= 8 && m <= 10) return "fall";
  return null;
}

function summarizeSeason(season: Season, label: string, posts: PostRow[]): SeasonStat {
  const out: SeasonStat = {
    season, label, posts,
    avgTemp: null, highTemp: null, lowTemp: null,
    dominantCondition: "—", topPost: null,
  };
  if (posts.length === 0) return out;
  const temps: number[] = [];
  for (const p of posts) {
    if (p.temperature != null) {
      temps.push(p.temperature);
      if (!out.highTemp || p.temperature > out.highTemp.value) out.highTemp = { value: p.temperature, date: p.created_at };
      if (!out.lowTemp || p.temperature < out.lowTemp.value) out.lowTemp = { value: p.temperature, date: p.created_at };
    }
  }
  if (temps.length) out.avgTemp = temps.reduce((s, t) => s + t, 0) / temps.length;
  const condCounts = new Map<string, number>();
  for (const p of posts) {
    const c = (p.condition ?? "").trim();
    if (!c) continue;
    condCounts.set(c, (condCounts.get(c) ?? 0) + 1);
  }
  let dom = "—"; let max = 0;
  for (const [c, n] of condCounts) if (n > max) { max = n; dom = c; }
  out.dominantCondition = dom;
  // Top post: prefer views_count, fall back to likes, fall back to first.
  let top = posts[0];
  let topScore = -1;
  for (const p of posts) {
    const score = (p.views_count ?? 0) * 2 + (p.likes_count ?? 0);
    if (score > topScore) { topScore = score; top = p; }
  }
  out.topPost = top;
  return out;
}

function findBigOne(posts: PostRow[]): PostRow | null {
  if (posts.length === 0) return null;
  let best: PostRow | null = null;
  let bestScore = -1;
  for (const p of posts) {
    const cond = `${p.condition || ""} ${p.caption || ""}`;
    const severity = SEVERE_RE.test(cond) ? 1000 : 0;
    const engagement = (p.views_count ?? 0) * 2 + (p.likes_count ?? 0);
    const score = severity + engagement;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function computeAnnualStats(posts: PostRow[], year: number): AnnualStats {
  const stats: AnnualStats = {
    totalPosts: posts.length,
    rainyDays: 0,
    sunniestMonthName: "—",
    sunniestMonthPct: 0,
    highest: null,
    lowest: null,
  };
  const monthCounts: number[] = new Array(12).fill(0);
  const monthClear: number[] = new Array(12).fill(0);
  for (const p of posts) {
    if (p.temperature != null) {
      if (!stats.highest || p.temperature > stats.highest.value) stats.highest = { value: p.temperature, date: p.created_at };
      if (!stats.lowest || p.temperature < stats.lowest.value) stats.lowest = { value: p.temperature, date: p.created_at };
    }
    const d = new Date(p.created_at);
    if (d.getUTCFullYear() === year) {
      const m = d.getUTCMonth();
      monthCounts[m] += 1;
      const cond = (p.condition || "").toLowerCase();
      if (/rain|drizzle|shower|storm|thunder/.test(cond)) stats.rainyDays += 1;
      if (/clear|sunny|sun\b/.test(cond)) monthClear[m] += 1;
    }
  }
  let bestPct = -1;
  let bestM = -1;
  for (let m = 0; m < 12; m++) {
    if (monthCounts[m] < 3) continue;
    const pct = monthClear[m] / monthCounts[m];
    if (pct > bestPct) { bestPct = pct; bestM = m; }
  }
  if (bestM >= 0) {
    stats.sunniestMonthName = new Date(Date.UTC(year, bestM, 1)).toLocaleDateString("en-US", { month: "long" });
    stats.sunniestMonthPct = Math.round(bestPct * 100);
  }
  return stats;
}

function aggregateYear(city: string, year: number, posts: PostRow[]): YearlyData {
  const buckets: Record<Season, PostRow[]> = { winter: [], spring: [], summer: [], fall: [] };
  for (const p of posts) {
    const s = seasonForDate(p.created_at, year);
    if (s) buckets[s].push(p);
  }
  const seasonLabels: Record<Season, string> = {
    winter: "Winter", spring: "Spring", summer: "Summer", fall: "Fall",
  };
  const seasons: SeasonStat[] = (["winter", "spring", "summer", "fall"] as Season[])
    .map((s) => summarizeSeason(s, seasonLabels[s], buckets[s]))
    .filter((s) => s.posts.length > 0);
  const yearOnly = posts.filter((p) => new Date(p.created_at).getUTCFullYear() === year);
  return {
    city, year, seasons,
    bigOne: findBigOne(yearOnly),
    stats: computeAnnualStats(yearOnly, year),
  };
}

// ───────────────── AI script ─────────────────

interface YearlyScript {
  title: string;
  script: string;
  seasonalLines: Record<Season, string>;
  bigOneLine: string;
  outroLine: string;
}

async function generateYearlyScript(data: YearlyData): Promise<YearlyScript> {
  const seasonBlock = data.seasons.map((s) => {
    const hi = s.highTemp ? `${Math.round(s.highTemp.value)}°F` : "—";
    const lo = s.lowTemp ? `${Math.round(s.lowTemp.value)}°F` : "—";
    return `${s.label}: ${s.posts.length} days, high ${hi}, low ${lo}, mostly ${s.dominantCondition}`;
  }).join("\n");
  const bigOneBlock = data.bigOne
    ? `Big One: ${new Date(data.bigOne.created_at).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} — ${data.bigOne.condition ?? "severe weather"} at ${data.bigOne.temperature != null ? Math.round(data.bigOne.temperature) + "°F" : "—"}.`
    : "Big One: no severe events on record.";
  const statsBlock = `Annual stats: ${data.stats.totalPosts} posts, ${data.stats.rainyDays} rainy days, sunniest month ${data.stats.sunniestMonthName} (${data.stats.sunniestMonthPct}% clear), high ${data.stats.highest ? Math.round(data.stats.highest.value) + "°F" : "—"}, low ${data.stats.lowest ? Math.round(data.stats.lowest.value) + "°F" : "—"}.`;

  const prompt = `Write a YouTube long-form YEAR-IN-REVIEW weather recap script for ${data.city} in ${data.year}.
Conversational, warm, energetic, ~400-600 words. Structure: intro → winter beat → spring beat → summer beat → fall beat → "The Big One" hero moment → annual stats burst → outro CTA "Follow for daily ${data.city} weather, all year long".

Data:
${seasonBlock}
${bigOneBlock}
${statsBlock}

Return JSON ONLY:
{
  "title": "${data.year} Year in Review: ${data.city}",
  "script": "full narration text",
  "seasonalLines": {
    "winter": "one-line summary for winter or empty string",
    "spring": "...",
    "summer": "...",
    "fall":   "..."
  },
  "bigOneLine": "one-line summary of the Big One",
  "outroLine": "short look-ahead to ${data.year + 1}"
}
Title MUST start with "${data.year} Year in Review:".`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
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
      console.warn(`[yearly-recap] Lovable AI script failed: ${res.status} ${t.slice(0, 200)} — using fallback`);
      return fallbackScript(data);
    }
    const json = await res.json();
    const content = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { /* ignore */ }
    const fb = fallbackScript(data);
    const seasonalLines: Record<Season, string> = {
      winter: parsed?.seasonalLines?.winter || fb.seasonalLines.winter,
      spring: parsed?.seasonalLines?.spring || fb.seasonalLines.spring,
      summer: parsed?.seasonalLines?.summer || fb.seasonalLines.summer,
      fall:   parsed?.seasonalLines?.fall   || fb.seasonalLines.fall,
    };
    return {
      title: parsed.title || fb.title,
      script: parsed.script || fb.script,
      seasonalLines,
      bigOneLine: parsed.bigOneLine || fb.bigOneLine,
      outroLine:  parsed.outroLine  || fb.outroLine,
    };
  } catch (e) {
    console.warn(`[yearly-recap] script gen threw: ${(e as Error).message} — using fallback`);
    return fallbackScript(data);
  }
}

function fallbackScript(data: YearlyData): YearlyScript {
  const seasonalLines: Record<Season, string> = { winter: "", spring: "", summer: "", fall: "" };
  for (const s of data.seasons) {
    const hi = s.highTemp ? `${Math.round(s.highTemp.value)}°F` : "—";
    const lo = s.lowTemp ? `${Math.round(s.lowTemp.value)}°F` : "—";
    seasonalLines[s.season] = `${s.posts.length} days · ${hi}/${lo} · ${s.dominantCondition}`;
  }
  return {
    title: `${data.year} Year in Review: ${data.city}`,
    script: `${data.city}, here's your ${data.year} year in weather. ${data.stats.totalPosts} forecasts, ${data.stats.rainyDays} rainy days, and one season we'll never forget. Follow for daily ${data.city} weather, all year long.`,
    seasonalLines,
    bigOneLine: data.bigOne
      ? `${data.bigOne.condition ?? "Severe weather"} on ${new Date(data.bigOne.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "A year of steady forecasts",
    outroLine: `Onward to ${data.year + 1}`,
  };
}

// ───────────────── Creatomate stitch ─────────────────

interface StitchResult { url: string; data: Uint8Array; contentType: string; reportedDuration?: number; }

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
  const sampleRate = 48000, channels = 1, bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const samples = Math.ceil(durationSeconds * sampleRate);
  const dataSize = samples * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF"); view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE"); writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, "data"); view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}
async function createSignedSilentAudio(svc: any, userId: string, durationSeconds: number): Promise<string | null> {
  const roundedDuration = Math.max(65, Math.ceil(durationSeconds));
  const wav = createSilentWav(roundedDuration);
  const path = `yearly-recap-audio/${userId}/${Date.now()}-${roundedDuration}s.wav`;
  const { error: uploadError } = await svc.storage.from("generated-images")
    .upload(path, wav, { contentType: "audio/wav", upsert: true });
  if (uploadError) { console.error("[yearly-recap] silent audio upload failed:", uploadError.message); return null; }
  const { data: signed, error: signedError } = await svc.storage.from("generated-images")
    .createSignedUrl(path, 60 * 60);
  if (signedError || !signed?.signedUrl) { console.error("[yearly-recap] silent audio signed url failed"); return null; }
  return signed.signedUrl;
}

async function synthesizeRecapVoice(svc: any, userId: string, script: string): Promise<{ url: string; durationSec: number } | null> {
  let settings: any = null;
  try {
    const { data } = await svc
      .from("weather_settings")
      .select("enable_voiceover, voiceover_voice_id, voiceover_speed, voiceover_stability, voiceover_similarity")
      .eq("user_id", userId).maybeSingle();
    settings = data;
  } catch { /* ignore */ }
  if (!settings || settings.enable_voiceover !== true) {
    console.log(`[yearly-recap] voice synth skipped: enable_voiceover=${settings?.enable_voiceover ?? "n/a"}`);
    return null;
  }
  const key = resolveElevenLabsKey();
  if (!key) { console.error("[yearly-recap] voice synth skipped: no ElevenLabs key"); return null; }
  const voiceId = settings.voiceover_voice_id || "female";
  const speed = clampVoiceParam(settings.voiceover_speed, 0.7, 1.2, 1.0);
  const stability = clampVoiceParam(settings.voiceover_stability, 0, 1, 0.55);
  const similarity = clampVoiceParam(settings.voiceover_similarity, 0, 1, 0.78);
  const wordCount = (script || "").trim().split(/\s+/).filter(Boolean).length;
  const estDurationSec = Math.max(20, Math.ceil(wordCount / 2.5));
  console.log(`[yearly-recap] synth voice: voice=${voiceId} words=${wordCount} est=${estDurationSec}s`);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${resolveVoiceId(voiceId)}?output_format=mp3_44100_128`;
  const body = JSON.stringify({
    text: script,
    model_id: "eleven_turbo_v2_5",
    voice_settings: { stability, similarity_boost: similarity, style: 0.35, use_speaker_boost: true, speed },
  });
  let bytes: Uint8Array | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": key.value, "Content-Type": "application/json" },
        body, signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) { bytes = new Uint8Array(await res.arrayBuffer()); break; }
      console.error(`[yearly-recap] voice attempt ${attempt} failed: ${res.status}`);
      if (attempt < 2 && res.status >= 500) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      return null;
    } catch (e) {
      clearTimeout(timer);
      console.error(`[yearly-recap] voice attempt ${attempt} error: ${(e as Error).message}`);
      if (attempt < 2) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      return null;
    }
  }
  if (!bytes) return null;
  const path = `yearly-recap-audio/${userId}/${Date.now()}-voice.mp3`;
  const { error: upErr } = await svc.storage.from("generated-images")
    .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
  if (upErr) { console.error("[yearly-recap] voice upload failed:", upErr.message); return null; }
  const { data: signed, error: signedErr } = await svc.storage.from("generated-images")
    .createSignedUrl(path, 60 * 60);
  if (signedErr || !signed?.signedUrl) return null;
  const durationSec = Math.max(estDurationSec, Math.ceil(bytes.byteLength / 16000));
  console.log(`[yearly-recap] voice ready: duration=${durationSec}s bytes=${bytes.byteLength}`);
  return { url: signed.signedUrl, durationSec };
}

// ───────────────── Slide composition helpers ─────────────────

const SEASON_THEME: Record<Season, { from: string; to: string }> = {
  winter: { from: "#1e3a8a", to: "#0ea5e9" },
  spring: { from: "#16a34a", to: "#84cc16" },
  summer: { from: "#ea580c", to: "#f59e0b" },
  fall:   { from: "#b45309", to: "#7c2d12" },
};
const SAFE_IMAGE_ANIM = true;

function buildAnimatedGradientBg(time: number, duration: number, grad: { from?: string; to?: string; label?: string } | null | undefined, slideNum?: number): any {
  const from = grad?.from, to = grad?.to, label = grad?.label ?? "?";
  if (!from || !to) {
    return {
      type: "shape", shape_type: "rectangle",
      width: "100%", height: "100%", x: "50%", y: "50%",
      fill_color: from || to || "#0f172a",
      time, duration,
    };
  }
  if (typeof slideNum === "number") console.log(`[yearly-recap] slide ${slideNum} gradient=${label} ${from}→${to}`);
  return {
    type: "shape", shape_type: "rectangle",
    width: "100%", height: "100%", x: "50%", y: "50%",
    fill_color: [
      { offset: "0%", color: from },
      { offset: "100%", color: to },
    ],
    gradient: "linear",
    fill_color_type: "linear-gradient",
    fill_color_angle: 135,
    time, duration,
  };
}

function buildScrim(time: number, duration: number, opacity = 0.32): any {
  return {
    type: "shape", shape_type: "rectangle",
    width: "100%", height: "100%", x: "50%", y: "50%",
    fill_color: `rgba(0,0,0,${opacity})`,
    time, duration,
  };
}

// Wrap resolveScene + render: returns Creatomate elements and accumulates decision.
function buildSlideBackground(opts: {
  time: number;
  duration: number;
  slideNum: number;
  grad: { from: string; to: string; label?: string };
  mediaUrl?: string | null;
  condition?: string | null;
  city?: string | null;
  kind: RecapSlideKind;
  settings?: any;
  decisionsOut: SceneDecision[];
}): any[] {
  const { time, duration, slideNum, grad, mediaUrl, condition, kind, settings } = opts;
  const preset = pickPresetForRecapSlide({
    kind, condition, city: opts.city, slideIndex: slideNum, settings,
  });
  const decision = resolveScene({
    city: opts.city, condition, mediaUrl, preset,
    mode: "image", slideIndex: slideNum, settings,
  });
  logCinematic("yearly-recap", decision, { city: opts.city, kind, slide: slideNum });
  opts.decisionsOut.push(decision);

  const out: any[] = [];
  if (decision.url) {
    const sceneEl: any = {
      type: "image", source: decision.url, fit: "cover",
      width: "100%", height: "100%", x: "50%", y: "50%",
      time, duration,
    };
    if (SAFE_IMAGE_ANIM) {
      sceneEl.animations = [{ type: "scale", from: 1.0, to: 1.05, easing: "linear", scope: "element" }];
    }
    out.push(sceneEl);
    const overlay = buildAnimatedGradientBg(time, duration, grad, slideNum);
    overlay.opacity = "30%";
    out.push(overlay);
  } else {
    out.push(buildAnimatedGradientBg(time, duration, grad, slideNum));
  }
  return out;
}

// ───────────────── Stitch ─────────────────

async function stitchSlideshow(
  svc: any,
  userId: string,
  data: YearlyData,
  script: YearlyScript,
  settings: any,
  voice?: { url: string; durationSec: number },
): Promise<{ stitch: StitchResult; decisions: SceneDecision[] } | null> {
  if (!CREATOMATE_API_KEY) {
    console.warn("[yearly-recap] CREATOMATE_API_KEY missing — skipping stitch");
    return null;
  }
  const city = data.city;

  // Slide list: intro + N seasonal + (bigOne?) + stats + outro.
  const seasonSlides = data.seasons;          // 0–4
  const includeBigOne = !!data.bigOne;
  const TOTAL_SLIDES = 1 + seasonSlides.length + (includeBigOne ? 1 : 0) + 1 + 1;
  if (TOTAL_SLIDES < 4) {
    console.warn(`[yearly-recap] only ${TOTAL_SLIDES} slides — not enough content`);
    return null;
  }

  const voiceDur = voice ? Math.ceil(voice.durationSec + 1) : 0;
  // Target 3-5 min long-form: floor 180s, derive per-slide duration.
  const minTotal = Math.max(180, voiceDur, TOTAL_SLIDES * 18);
  const SLIDE_DUR = Math.max(18, Math.ceil(minTotal / TOTAL_SLIDES));
  console.log(`[yearly-recap] stitch inputs: seasons=${seasonSlides.length} bigOne=${includeBigOne ? "yes" : "no"} total_slides=${TOTAL_SLIDES} slide_dur=${SLIDE_DUR}s voice=${voiceDur}s`);

  const elements: any[] = [];
  const decisions: SceneDecision[] = [];
  let slideNum = 0;
  let cursor = 0;

  // ── 1. Intro ──
  slideNum += 1;
  elements.push(...buildSlideBackground({
    time: cursor, duration: SLIDE_DUR, slideNum,
    grad: { from: "#0f172a", to: "#581c87", label: "intro" },
    city, condition: null, mediaUrl: null,
    kind: "title", settings, decisionsOut: decisions,
  }));
  elements.push(buildScrim(cursor, SLIDE_DUR, 0.4));
  elements.push({
    type: "text", text: `${data.year} Year in Review`,
    x: "50%", y: "32%", width: "90%",
    font_family: "Inter", font_weight: "800",
    font_size: "11 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 24,
    time: cursor, duration: SLIDE_DUR,
    animations: [{ type: "fade", duration: 1.2, scope: "element" }],
  });
  elements.push({
    type: "text", text: city,
    x: "50%", y: "55%", width: "80%",
    font_family: "Inter", font_weight: "600",
    font_size: "6 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 16,
    time: cursor, duration: SLIDE_DUR,
  });
  cursor += SLIDE_DUR;

  // ── 2-5. Seasonal slides ──
  for (const s of seasonSlides) {
    slideNum += 1;
    const grad = { ...SEASON_THEME[s.season], label: s.season };
    elements.push(...buildSlideBackground({
      time: cursor, duration: SLIDE_DUR, slideNum, grad,
      mediaUrl: s.topPost?.image_url ?? null,
      condition: s.dominantCondition,
      city,
      kind: "day",
      settings,
      decisionsOut: decisions,
    }));
    elements.push(buildScrim(cursor, SLIDE_DUR, 0.32));
    elements.push({
      type: "text", text: s.label,
      x: "50%", y: "26%", width: "85%",
      font_family: "Inter", font_weight: "800",
      font_size: "9 vh", fill_color: "#ffffff",
      background_color: "rgba(0,0,0,0.25)", padding: 16,
      time: cursor, duration: SLIDE_DUR,
    });
    const hi = s.highTemp ? `${Math.round(s.highTemp.value)}°F` : "—";
    const lo = s.lowTemp ? `${Math.round(s.lowTemp.value)}°F` : "—";
    elements.push({
      type: "text", text: `${hi} / ${lo}  ·  ${s.dominantCondition}`,
      x: "50%", y: "48%", width: "85%",
      font_family: "Inter", font_weight: "700",
      font_size: "5.5 vh", fill_color: "#ffffff",
      background_color: "rgba(0,0,0,0.25)", padding: 12,
      time: cursor, duration: SLIDE_DUR,
    });
    const line = script.seasonalLines[s.season];
    if (line) {
      elements.push({
        type: "text", text: line,
        x: "50%", y: "70%", width: "85%",
        font_family: "Inter", font_weight: "500",
        font_size: "3.6 vh", fill_color: "#ffffff",
        background_color: "rgba(0,0,0,0.25)", padding: 12,
        time: cursor, duration: SLIDE_DUR,
      });
    }
    cursor += SLIDE_DUR;
  }

  // ── 6. The Big One ──
  if (includeBigOne && data.bigOne) {
    slideNum += 1;
    elements.push(...buildSlideBackground({
      time: cursor, duration: SLIDE_DUR, slideNum,
      grad: { from: "#7f1d1d", to: "#451a03", label: "bigOne" },
      mediaUrl: data.bigOne.image_url,
      condition: data.bigOne.condition,
      city,
      kind: "highlight",
      settings,
      decisionsOut: decisions,
    }));
    elements.push(buildScrim(cursor, SLIDE_DUR, 0.45));
    elements.push({
      type: "text", text: "The Big One",
      x: "50%", y: "22%", width: "85%",
      font_family: "Inter", font_weight: "600",
      font_size: "4.4 vh", fill_color: "#fde68a",
      background_color: "rgba(0,0,0,0.3)", padding: 12,
      time: cursor, duration: SLIDE_DUR,
    });
    const dateLine = new Date(data.bigOne.created_at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    elements.push({
      type: "text", text: `${dateLine}\n${data.bigOne.condition ?? "Severe weather"}`,
      x: "50%", y: "45%", width: "90%",
      font_family: "Inter", font_weight: "800",
      font_size: "7.5 vh", fill_color: "#ffffff",
      background_color: "rgba(0,0,0,0.3)", padding: 20,
      time: cursor, duration: SLIDE_DUR,
    });
    elements.push({
      type: "text", text: script.bigOneLine,
      x: "50%", y: "72%", width: "85%",
      font_family: "Inter", font_weight: "500",
      font_size: "3.6 vh", fill_color: "#ffffff",
      background_color: "rgba(0,0,0,0.3)", padding: 12,
      time: cursor, duration: SLIDE_DUR,
    });
    cursor += SLIDE_DUR;
  }

  // ── 7. Annual Stats ──
  slideNum += 1;
  elements.push(...buildSlideBackground({
    time: cursor, duration: SLIDE_DUR, slideNum,
    grad: { from: "#334155", to: "#1e3a8a", label: "stats" },
    mediaUrl: null,
    condition: null,
    city,
    kind: "week_stat",
    settings,
    decisionsOut: decisions,
  }));
  elements.push(buildScrim(cursor, SLIDE_DUR, 0.4));
  elements.push({
    type: "text", text: `${data.year} by the numbers`,
    x: "50%", y: "22%", width: "85%",
    font_family: "Inter", font_weight: "700",
    font_size: "6 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 16,
    time: cursor, duration: SLIDE_DUR,
  });
  const statLines = [
    `${data.stats.totalPosts} forecasts`,
    `${data.stats.rainyDays} rainy days`,
    `Sunniest: ${data.stats.sunniestMonthName}${data.stats.sunniestMonthPct ? ` (${data.stats.sunniestMonthPct}% clear)` : ""}`,
    data.stats.highest ? `High: ${Math.round(data.stats.highest.value)}°F` : "",
    data.stats.lowest ? `Low: ${Math.round(data.stats.lowest.value)}°F` : "",
  ].filter(Boolean).join("\n");
  elements.push({
    type: "text", text: statLines,
    x: "50%", y: "58%", width: "80%",
    font_family: "Inter", font_weight: "600",
    font_size: "4.6 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 16,
    time: cursor, duration: SLIDE_DUR,
  });
  cursor += SLIDE_DUR;

  // ── 8. Outro ──
  slideNum += 1;
  const outroBgIdx = elements.length;
  elements.push(...buildSlideBackground({
    time: cursor, duration: SLIDE_DUR, slideNum,
    grad: { from: "#0f172a", to: "#581c87", label: "outro" },
    mediaUrl: null, condition: null,
    city, kind: "outro", settings,
    decisionsOut: decisions,
  }));
  const outroScrimIdx = elements.length;
  elements.push(buildScrim(cursor, SLIDE_DUR, 0.4));
  const outroTextIdx = elements.length;
  elements.push({
    type: "text",
    text: `${script.outroLine}\nFollow for daily ${city} weather.`,
    x: "50%", y: "50%", width: "90%",
    font_family: "Inter", font_weight: "800",
    font_size: "7 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 24,
    time: cursor, duration: SLIDE_DUR,
  });
  cursor += SLIDE_DUR;

  // ── Timing reconciliation: extend outro to cover voice tail ──
  const visualDuration0 = cursor;
  const totalDuration = Math.max(visualDuration0, voiceDur, 180);
  if (totalDuration > visualDuration0) {
    const pad = totalDuration - visualDuration0;
    elements[outroTextIdx].duration += pad;
    elements[outroScrimIdx].duration += pad;
    // Outro background may be 1 or 2 elements (image + overlay or single gradient).
    for (let i = outroBgIdx; i < outroScrimIdx; i++) {
      if (typeof elements[i].duration === "number") elements[i].duration += pad;
    }
  }
  console.log(`[yearly-recap] timing: visual=${visualDuration0}s voice=${voiceDur}s total=${totalDuration}s slides=${TOTAL_SLIDES}`);

  // ── Audio mix ──
  if (voice) {
    elements.push({ type: "audio", source: voice.url, time: 0, duration: totalDuration, volume: 2.5 });
  }
  if (RECAP_MUSIC_URL) {
    elements.push({ type: "audio", source: RECAP_MUSIC_URL, time: 0, duration: totalDuration, volume: 0.15 });
  }
  if (!voice && !RECAP_MUSIC_URL) {
    const silent = await createSignedSilentAudio(svc, userId, totalDuration);
    if (silent) {
      elements.push({ type: "audio", source: silent, time: 0, duration: totalDuration, volume: 0.01 });
    }
  }
  console.log(`[yearly-recap] audio mix: voice=${voice ? "yes" : "no"} music=${RECAP_MUSIC_URL ? "yes" : "no"}`);

  const body = {
    output_format: "mp4",
    frame_rate: 30,
    width: 1920, height: 1080,
    duration: totalDuration,
    fill_color: "#0f172a",
    elements,
  };

  const submit = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const submitText = await submit.text();
  if (!submit.ok) {
    console.error("[yearly-recap] Creatomate submit failed:", submit.status, submitText.slice(0, 300));
    return null;
  }
  let renders: any;
  try { renders = JSON.parse(submitText); } catch { return null; }
  const renderId = Array.isArray(renders) ? renders[0]?.id : renders?.id;
  if (!renderId) return null;

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const sr = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
      headers: { Authorization: `Bearer ${CREATOMATE_API_KEY}` },
    });
    if (!sr.ok) continue;
    const sd = await sr.json();
    console.log(`[yearly-recap] poll ${i}: status=${sd.status} dur=${sd.duration ?? "?"} err=${sd.error_message ?? ""}`);
    if (sd.status === "succeeded" && sd.url) {
      const reportedDuration: number | undefined = typeof sd.duration === "number" ? sd.duration : undefined;
      const dl = await fetch(sd.url);
      if (!dl.ok) { console.error(`[yearly-recap] download failed: ${dl.status}`); return null; }
      const contentType = dl.headers.get("content-type") || "unknown";
      const ab = await dl.arrayBuffer();
      const bytes = ab.byteLength;
      if (bytes < 100_000 || !/video\/mp4/i.test(contentType)) {
        console.error(`[yearly-recap] ABORT: invalid output bytes=${bytes} type=${contentType}`);
        return null;
      }
      console.log(`[yearly-recap] stitched mp4 ready: ${sd.url} bytes=${bytes}`);
      return {
        stitch: { url: sd.url, data: new Uint8Array(ab), contentType, reportedDuration },
        decisions,
      };
    }
    if (sd.status === "failed") {
      console.error("[yearly-recap] render failed:", sd.error_message);
      return null;
    }
  }
  console.error("[yearly-recap] Creatomate poll timeout");
  return null;
}

// ───────────────── YouTube upload (reuse pattern) ─────────────────

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

async function uploadLongFormToYouTube(token: string, videoData: Uint8Array, title: string, description: string): Promise<string | null> {
  const safeTitle = title.length > 95 ? title.slice(0, 95) : title;
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`, "Content-Type": "application/json",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(videoData.byteLength),
      },
      body: JSON.stringify({
        snippet: {
          title: safeTitle,
          description: description.slice(0, 4900),
          categoryId: "22",
          tags: ["Year in Review", "Yearly Recap", "Weather", "SkyBrief"],
        },
        status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
      }),
    },
  );
  if (!initRes.ok) {
    console.error(`[yearly-recap] YouTube init failed: ${initRes.status}`);
    return null;
  }
  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) return null;
  const up = await fetch(uploadUrl, {
    method: "PUT", headers: { "Content-Type": "video/mp4" }, body: videoData,
  });
  if (!up.ok) {
    console.error(`[yearly-recap] YouTube upload PUT failed: ${up.status}`);
    return null;
  }
  const j = await up.json();
  return j?.id ?? null;
}

// ───────────────── Infographic fallback ─────────────────

async function generateFallbackInfographic(title: string, data: YearlyData): Promise<Uint8Array | null> {
  const lines = data.seasons.map((s) => {
    const hi = s.highTemp ? `${Math.round(s.highTemp.value)}°F` : "—";
    return `${s.label}: ${s.posts.length}d · ${hi} · ${s.dominantCondition}`;
  }).join(" | ");
  const prompt = `Clean modern weather infographic poster for a YEAR IN REVIEW, dark navy gradient background,
white bold sans-serif typography, large title "${title}", 4-season summary as a tidy grid.
Data: ${lines}. Minimalist, editorial, high contrast. No watermark.`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const dataUrl: string | undefined = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl || !dataUrl.startsWith("data:")) return null;
    const b64 = dataUrl.split(",")[1] ?? "";
    if (!b64) return null;
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch (e) {
    console.error("[yearly-recap] infographic gen failed:", (e as Error).message);
    return null;
  }
}

// ───────────────── per-user runner ─────────────────

async function runForUser(
  svc: any, userId: string, city: string, year: number, opts?: { skipPost?: boolean },
): Promise<{ ok: boolean; status?: string; reason?: string; detail: string; preview_url?: string; slides?: number }> {
  const skipPost = !!opts?.skipPost;
  const posts = await getYearPosts(svc, userId, city, year);

  // Hard floor: need a minimum corpus to make a meaningful year-in-review.
  if (posts.length < 10) {
    console.log(`[yearly-recap] insufficient_data: ${posts.length} usable posts for ${city} ${year} (need 10+)`);
    return {
      ok: false,
      status: "insufficient_data",
      reason: "Not enough yearly data",
      detail: `Only ${posts.length} usable posts in ${year} for ${city} — need 10+ for a yearly recap`,
    };
  }

  const settings = await loadCinematicSettings(svc, userId);
  const data = aggregateYear(city, year, posts);

  // Soft floor: empty seasons are already dropped in aggregateYear; we just need at
  // least 1 season's worth of content to compose around (intro + 1 season + stats + outro).
  // 2–3 missing seasons → render with reduced structure, no empty seasonal sections.
  if (data.seasons.length < 1) {
    console.log(`[yearly-recap] insufficient_data: 0 seasons with content for ${city} ${year}`);
    return {
      ok: false,
      status: "insufficient_data",
      reason: "Not enough yearly data",
      detail: `No season had usable posts in ${year} for ${city}`,
    };
  }
  console.log(`[yearly-recap] composing with ${data.seasons.length}/4 seasons (${4 - data.seasons.length} missing)`);


  const script = await generateYearlyScript(data);
  const finalTitle = script.title.startsWith(`${year} Year in Review`)
    ? script.title
    : `${year} Year in Review: ${city}`;
  const description = `${script.script}\n\n#YearInReview #YearlyRecap #Weather #SkyBrief #${city.replace(/\s+/g, "")}`;

  const voice = await synthesizeRecapVoice(svc, userId, script.script);

  const stitchOut = await stitchSlideshow(svc, userId, data, script, settings, voice ?? undefined);

  if (stitchOut) {
    const { stitch, decisions } = stitchOut;
    // Persist cinematic summary for visibility + firewall provenance.
    try {
      const sources: Record<string, number> = {};
      let eligible = 0;
      for (const d of decisions) {
        sources[d.source] = (sources[d.source] ?? 0) + 1;
        if (d.eligibleForLearning) eligible++;
      }
      await svc.from("system_logs").insert({
        user_id: userId,
        type: "yearly_recap_render",
        platform: "youtube",
        message: `yearly recap: ${decisions.length} slides (${eligible} eligible) for ${city} ${year}`,
        context: {
          kind: "yearly",
          city, year,
          slide_count: decisions.length,
          eligible_count: eligible,
          fallback_count: decisions.length - eligible,
          sources,
          decisions,
        },
      });
    } catch (e) {
      console.warn("[yearly-recap] system_logs insert failed:", (e as Error).message);
    }

    if (skipPost) {
      console.log(`[yearly-recap] dev-test skip_post=true preview_url=${stitch.url}`);
      return { ok: true, detail: "Dev test render complete", preview_url: stitch.url, slides: decisions.length };
    }

    const token = await getYouTubeToken(svc, userId);
    if (!token) {
      await svc.from("post_history").insert({
        user_id: userId, status: "failed", platform: "youtube",
        city, caption: finalTitle,
        error_message: "No YouTube token for yearly recap",
      });
      return { ok: false, detail: "No YouTube token" };
    }
    const cleanTitle = stripShortsHashtag(finalTitle);
    const cleanDesc = stripShortsHashtag(description);

    const videoId = await uploadLongFormToYouTube(token, stitch.data, cleanTitle, cleanDesc);
    if (videoId) {
      // Worst-eligible slide demotes the parent row (matches firewall semantics).
      const worst = decisions.find((d) => !d.eligibleForLearning) ?? decisions[decisions.length - 1];
      const visual_metadata = buildVisualMetadata(worst, {
        kind: "yearly_recap",
        year, city,
        slide_count: decisions.length,
        fallback_count: decisions.filter((d) => !d.eligibleForLearning).length,
      });
      await svc.from("post_history").insert({
        user_id: userId, status: "succeeded", platform: "youtube",
        city, caption: cleanTitle,
        post_url: `https://www.youtube.com/watch?v=${videoId}`,
        external_id: videoId,
        visual_metadata,
        published_visual_source: worst.source,
      });
      await svc.from("notifications").insert({
        user_id: userId, type: "success",
        title: "📺 Yearly Recap published!",
        message: `${cleanTitle} is live on YouTube.`,
      });
      return { ok: true, detail: `Uploaded ${videoId}`, slides: decisions.length };
    }

    console.warn("[yearly-recap] YT upload failed — falling back to infographic");
  }

  // Fallback path
  const img = await generateFallbackInfographic(finalTitle, data);
  if (!img) {
    await svc.from("post_history").insert({
      user_id: userId, status: "failed", platform: "youtube",
      city, caption: finalTitle,
      error_message: "Yearly stitch failed and infographic generation failed",
    });
    return { ok: false, detail: "Both stitch and infographic failed" };
  }
  const path = `yearly-recap/${userId}/${year}-${Date.now()}.png`;
  const { error: upErr } = await svc.storage.from("generated-images")
    .upload(path, img, { contentType: "image/png", upsert: true });
  if (upErr) console.error("[yearly-recap] infographic upload failed:", upErr.message);
  const { data: signed } = await svc.storage.from("generated-images")
    .createSignedUrl(path, 60 * 60 * 24 * 30);

  await svc.from("post_history").insert({
    user_id: userId, status: "fallback_image", platform: "youtube",
    city, caption: finalTitle,
    image_url: signed?.signedUrl ?? null,
    error_message: "Yearly video stitch unavailable — generated Year in Review infographic instead",
  });
  await svc.from("notifications").insert({
    user_id: userId, type: "warning",
    title: "🖼️ Yearly Recap fallback ready",
    message: "Couldn't stitch the yearly video — generated a Year in Review infographic instead.",
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

  let cityFilter: string | undefined;
  let userFilter: string | undefined;
  let year = new Date().getUTCFullYear();
  let skipPost = false;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body && typeof body.city === "string" && body.city.trim()) cityFilter = body.city.trim();
      if (body && typeof body.user_id === "string" && body.user_id.trim()) userFilter = body.user_id.trim();
      if (body && typeof body.year === "number" && body.year > 2000 && body.year < 3000) year = Math.floor(body.year);
      if (body && (body.skip_post === true || body.test_mode === true)) skipPost = true;
    }
  } catch { /* ignore */ }

  if (!cityFilter) {
    return new Response(
      JSON.stringify({ ok: false, error: "city is required for yearly recap" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (skipPost) {
    console.log(`[dev-test] yearly triggered for city=${cityFilter} year=${year} (skipping upload)`);
  } else {
    console.log(`[manual-post] yearly triggered for city=${cityFilter} year=${year} by user=${gate.source === "user" ? gate.userId : (userFilter ?? "service")}`);
  }

  // Resolve target user.
  let targetUserId: string | null = null;
  if (gate.source === "user") targetUserId = gate.userId;
  else if (userFilter) targetUserId = userFilter;
  if (!targetUserId) {
    return new Response(
      JSON.stringify({ ok: false, error: "user_id is required for service-role invocation" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // Dev-test mode: run synchronously, return preview URL.
  if (skipPost) {
    try {
      const r = await runForUser(svc, targetUserId, cityFilter, year, { skipPost: true });
      return new Response(
        JSON.stringify({
          ok: r.ok,
          mode: "dev",
          status: r.status,
          reason: r.reason,
          preview_url: r.preview_url ?? null,
          slides: r.slides ?? 0,
          detail: r.detail,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: (e as Error).message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  // Prod mode: background work, return 202 immediately.
  const work = async () => {
    try {
      const r = await runForUser(svc, targetUserId, cityFilter!, year);
      console.log(`[yearly-recap] complete: ok=${r.ok} ${r.detail}`);
      try {
        await svc.from("system_health").upsert({
          id: "create-yearly-recap",
          last_run_at: new Date().toISOString(),
          last_status: r.ok ? "ok" : "error",
          last_message: r.detail,
          updated_at: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[yearly-recap] background failed:", msg);
      try {
        await svc.from("post_history").insert({
          user_id: targetUserId, status: "failed", platform: "youtube",
          city: cityFilter ?? "", caption: `${year} Year in Review`,
          error_message: `Background yearly recap failed: ${msg}`,
        });
      } catch { /* ignore */ }
    }
  };

  // @ts-ignore — EdgeRuntime provided by Supabase Edge
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work());
  } else {
    work().catch((e) => console.error("[yearly-recap] background failed:", (e as Error).message));
  }

  return new Response(
    JSON.stringify({ ok: true, accepted: true, city: cityFilter, year, candidates: 1 }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

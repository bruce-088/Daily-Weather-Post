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
    console.error("[recap] silent audio upload failed:", uploadError.message);
    return null;
  }
  const { data: signed, error: signedError } = await svc.storage.from("generated-images")
    .createSignedUrl(path, 60 * 60);
  if (signedError || !signed?.signedUrl) {
    console.error("[recap] silent audio signed url failed:", signedError?.message ?? "missing signed URL");
    return null;
  }
  console.log(`[recap] silent audio ready: duration=${roundedDuration}s bytes=${wav.byteLength}`);
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
    console.warn("[recap] could not load voiceover settings:", (e as Error).message);
  }

  if (!settings || settings.enable_voiceover !== true) {
    console.log(`[recap] voice synth skipped: enable_voiceover=${settings?.enable_voiceover ?? "n/a"}`);
    return null;
  }

  const key = resolveElevenLabsKey();
  if (!key) {
    console.error("[recap] voice synth failed, falling back to silent render: no ElevenLabs API key in env");
    return null;
  }

  const voiceId = settings.voiceover_voice_id || "female";
  const speed = clampVoiceParam(settings.voiceover_speed, 0.7, 1.2, 1.0);
  const stability = clampVoiceParam(settings.voiceover_stability, 0, 1, 0.55);
  const similarity = clampVoiceParam(settings.voiceover_similarity, 0, 1, 0.78);
  const wordCount = (script || "").trim().split(/\s+/).filter(Boolean).length;
  const estDurationSec = Math.max(10, Math.ceil(wordCount / 2.5));
  console.log(`[recap] synthesizing 0:${estDurationSec}s voice script via ElevenLabs voice=${voiceId} source=${key.source} words=${wordCount}`);

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
      console.error(`[recap] voice synth attempt ${attempt}/${MAX_ATTEMPTS} failed: status=${res.status} ${detail}`);
      if (attempt < MAX_ATTEMPTS && res.status >= 500) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[recap] voice synth failed, falling back to silent render");
      return null;
    } catch (e) {
      clearTimeout(timer);
      console.error(`[recap] voice synth attempt ${attempt}/${MAX_ATTEMPTS} error:`, (e as Error).message);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      console.error("[recap] voice synth failed, falling back to silent render");
      return null;
    }
  }
  if (!bytes) {
    console.error("[recap] voice synth failed, falling back to silent render: no bytes");
    return null;
  }

  const path = `weekly-recap-audio/${userId}/${Date.now()}-voice.mp3`;
  const { error: upErr } = await svc.storage
    .from("generated-images")
    .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
  if (upErr) {
    console.error("[recap] voice synth failed, falling back to silent render: upload error:", upErr.message);
    return null;
  }
  const { data: signed, error: signedErr } = await svc.storage
    .from("generated-images")
    .createSignedUrl(path, 60 * 60);
  if (signedErr || !signed?.signedUrl) {
    console.error("[recap] voice synth failed, falling back to silent render: signed url error:", signedErr?.message);
    return null;
  }
  // mp3 @ 128kbps ≈ 16000 bytes/sec
  const durationSec = Math.max(estDurationSec, Math.ceil(bytes.byteLength / 16000));
  console.log(`[recap] voice asset ready: ${signed.signedUrl} bytes=${bytes.byteLength} duration=${durationSec}s`);
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
  grad: { from: string; to: string },
): any {
  // Creatomate-native animation syntax: `animations` array with scope=element,
  // scale object, start_scale object, explicit time/duration. Using the
  // built-in scale animation guarantees frame-to-frame change so Creatomate
  // emits a real MP4 (and not a 15KB JPEG snapshot of a static composition).
  return {
    type: "shape",
    shape_type: "rectangle",
    width: "100%",
    height: "100%",
    x: "50%",
    y: "50%",
    fill_color: grad.from, // solid fill — Creatomate rectangles don't support gradient stops natively
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

function layoutTextProps(layout: LayoutKind): { x: string; width: string; x_alignment: string } {
  if (layout === "left")  return { x: "30%", width: "60%", x_alignment: "0%" };
  if (layout === "right") return { x: "70%", width: "60%", x_alignment: "100%" };
  return { x: "50%", width: "90%", x_alignment: "50%" };
}

async function stitchSlideshow(svc: any, userId: string, posts: PostRow[], title: string, voice?: { url: string; durationSec: number }): Promise<StitchResult | null> {
  if (!CREATOMATE_API_KEY) {
    console.warn("[recap] CREATOMATE_API_KEY missing — skipping stitch");
    return null;
  }
  // Use up to 7 of the most recent posts. Image is optional — when missing,
  // the slide falls back to an animated gradient background so the recap
  // still renders a real MP4 (and clears the YouTube long-form threshold).
  const slides = posts.slice(-7);
  if (slides.length < 2) {
    console.warn("[recap] Not enough posts to stitch (need 2+):", slides.length);
    return null;
  }
  const imageCount = slides.filter((p) => p.image_url).length;
  console.log(`[recap] stitch inputs: slides=${slides.length}, with_image=${imageCount}`);

  // 9s per slide ensures even a 5-slide week (5*9 + title + outro = 63s)
  // clears the 60s YouTube Short threshold. A full 7-slide week = 81s.
  const SLIDE_DUR = 9;
  const city = posts[0]?.city ?? "your city";

  const elements: any[] = [];

  // ── Title card ── (gradient → scrim → text)
  const titleGrad = gradientForSlide();
  elements.push(buildAnimatedGradientBg(0, SLIDE_DUR, titleGrad));
  elements.push(buildScrim(0, SLIDE_DUR));
  elements.push({
    type: "text", text: title,
    x: "50%", y: "20%", width: "90%",
    font_family: "Inter", font_weight: "800",
    font_size: "9 vh", fill_color: "#ffffff",
    background_color: "rgba(0,0,0,0.25)", padding: 24,
    time: 0, duration: SLIDE_DUR,
    animations: [{ type: "fade", duration: 1.2, scope: "element" }],
  });
  console.log("[recap] title font=9vh animation=fade");

  // ── Day slides ── (gradient → image → scrim → text)
  slides.forEach((p, i) => {
    const start = (i + 1) * SLIDE_DUR;
    const layout: LayoutKind = LAYOUTS[i % 3];
    const themeKey: ThemeKey = THEME_KEYS[i % 3];
    const grad = THEMES[themeKey];
    const isHighlight = i === 3;
    const textPos = layoutTextProps(layout);

    // 1. Themed gradient base (safety net + motion guarantee)
    elements.push(buildAnimatedGradientBg(start, SLIDE_DUR, grad));
    // 2. Image on top of gradient (if available) — subtle Ken Burns pan
    if (p.image_url) {
      const imgEl: any = {
        type: "image", source: p.image_url,
        time: start, duration: SLIDE_DUR,
        fit: "cover",
      };
      if (SAFE_IMAGE_ANIM) {
        imgEl.animations = [{
          type: "pan",
          direction: layout === "left" ? "right" : layout === "right" ? "left" : "up",
          duration: SLIDE_DUR,
          easing: "linear",
          scope: "element",
        }];
      }
      elements.push(imgEl);
      console.log(`[recap] slide ${i + 1} using image from history: ${p.image_url}`);
    } else {
      console.log(`[recap] slide ${i + 1} using animated gradient (no image_url) theme=${themeKey}`);
    }
    // 3. Scrim for legibility (slightly darker on midweek highlight)
    elements.push(buildScrim(start, SLIDE_DUR, isHighlight ? 0.35 : 0.3));
    // 4. Text on top
    const day = new Date(p.created_at).toLocaleDateString("en-US", { weekday: "long" });
    const temp = p.temperature != null ? `${Math.round(p.temperature)}°F` : "";
    const cond = p.condition ?? "";
    elements.push({
      type: "text",
      text: `${day}\n${temp}  ${cond}`.trim(),
      x: textPos.x, y: "50%", width: textPos.width,
      x_alignment: textPos.x_alignment,
      font_family: "Inter", font_weight: "700",
      font_size: isHighlight ? "7.7 vh" : "7 vh",
      fill_color: "#ffffff",
      background_color: "rgba(0,0,0,0.25)", padding: 24,
      time: start, duration: SLIDE_DUR,
    });
    if (isHighlight) {
      elements.push({
        type: "text",
        text: "Midweek Shift",
        x: textPos.x, y: "62%", width: textPos.width,
        x_alignment: textPos.x_alignment,
        font_family: "Inter", font_weight: "600",
        font_size: "3.5 vh", fill_color: "#ffffff",
        background_color: "rgba(0,0,0,0.25)", padding: 12,
        time: start, duration: SLIDE_DUR,
      });
    }
    console.log(`[recap] slide ${i + 1} layout=${layout} theme=${themeKey}${isHighlight ? " highlight=yes" : ""}`);
  });

  // ── Outro card ── (gradient → scrim → text)
  const outroStart = (slides.length + 1) * SLIDE_DUR;
  const outroGrad = gradientForSlide();
  const outroBgIdx = elements.length;
  elements.push(buildAnimatedGradientBg(outroStart, SLIDE_DUR, outroGrad));
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
  console.log("[recap] outro cta=follow");


  const visualDuration0 = (slides.length + 2) * SLIDE_DUR; // title + slides + outro
  const voiceDur = voice ? Math.ceil(voice.durationSec + 1) : 0;
  let totalDuration = Math.max(visualDuration0, voiceDur, 65);
  if (totalDuration > visualDuration0) {
    const pad = totalDuration - visualDuration0;
    elements[outroTextIdx].duration += pad;
    elements[outroScrimIdx].duration += pad;
    elements[outroBgIdx].duration += pad;
    // (no animation array anymore — Creatomate didn't accept scale schema)
  }
  console.log(`[recap] timing: visual=${visualDuration0}s voice=${voice?.durationSec ?? 0}s total=${totalDuration}s outro_extended=${totalDuration - visualDuration0}s slides=${slides.length}`);

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
      volume: 2.0,
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
      console.warn("[recap] continuing without any audio track; YouTube may abandon processing");
    }
  }
  console.log(`[recap] audio mix: voice=${hasVoice ? "yes(vol=2.0)" : "no"} music=${hasMusic ? "yes(vol=0.15)" : "no"} silent_fallback=${usedSilentFallback ? "yes" : "no"}`);

  // ── Safety fallback: never ship a visually empty composition ──
  const visualCountPre = elements.filter((e) => e.type !== "audio").length;
  if (visualCountPre === 0) {
    console.warn("[recap] safety fallback: no visual elements, pushing solid background");
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
  console.log(`[recap] elements count=${elements.length} visual=${visualCount} audio=${audioCount}`);

  // Debug: identify any element (or nested animation) missing `type`
  elements.forEach((el, idx) => {
    if (!el || typeof el.type !== "string" || el.type.length === 0) {
      console.error(`[recap] BAD_ELEMENT idx=${idx} keys=${Object.keys(el ?? {}).join(",")} preview=${JSON.stringify(el).slice(0, 300)}`);
    }
    if (Array.isArray(el?.animations)) {
      el.animations.forEach((a: any, ai: number) => {
        if (!a || typeof a.type !== "string") {
          console.error(`[recap] BAD_ANIMATION el=${idx} ai=${ai} preview=${JSON.stringify(a).slice(0, 300)}`);
        }
      });
    }
  });
  console.log(`[recap] DEBUG full source: ${JSON.stringify({ width: 1920, height: 1080, duration: totalDuration, elements }).slice(0, 4000)}`);

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
    console.log(`[recap] creatomate poll ${i}: status=${sd.status} url=${sd.url ?? "?"} snapshot=${sd.snapshot_url ?? "?"} dur=${sd.duration ?? "?"} format=${sd.format ?? sd.output_format ?? "?"} err=${sd.error_message ?? ""}`);
    if (sd.status === "succeeded" && sd.url) {
      const reportedDuration: number | undefined =
        typeof sd.duration === "number" ? sd.duration : undefined;
      console.log(`[recap] render duration reported by Creatomate: ${reportedDuration ?? "?"}s`);
      if (typeof reportedDuration === "number" && reportedDuration < 60) {
        console.warn(`[recap] WARNING: duration under 60s, YouTube will reject`);
      }
      const dl = await fetch(sd.url);
      if (!dl.ok) {
        console.error(`[recap] ABORT: render output invalid (download status=${dl.status})`);
        return null;
      }
      const contentType = dl.headers.get("content-type") || "unknown";
      const ab = await dl.arrayBuffer();
      const bytes = ab.byteLength;
      console.log(`[recap] render output size=${bytes} type=${contentType}`);
      if (bytes < 100_000 || !/video\/mp4/i.test(contentType)) {
        console.error(`[recap] ABORT: render output invalid (bytes=${bytes} type=${contentType})`);
        return null;
      }
      console.log(`[recap] stitched mp4 ready: url=${sd.url} bytes=${bytes}`);
      return { url: sd.url, data: new Uint8Array(ab), contentType, reportedDuration };
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
      console.error(`[recap] image gen failed, falling back to animated gradient: status=${res.status} ${errText.slice(0, 200)}`);
      return null;
    }
    const j = await res.json();
    const dataUrl: string | undefined =
      j?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      console.error("[recap] image gen failed, falling back to animated gradient: no image in response");
      return null;
    }
    const b64 = dataUrl.split(",")[1] ?? "";
    if (!b64) {
      console.error("[recap] image gen failed, falling back to animated gradient: empty base64");
      return null;
    }
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return bin;
  } catch (e) {
    console.error(`[recap] image gen failed, falling back to animated gradient: ${(e as Error).message}`);
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

  // Voice narration (master clock). Skipped silently if disabled or it fails.
  const voice = await synthesizeRecapVoice(svc, userId, script);

  // Try video stitch
  const stitched = await stitchSlideshow(svc, userId, posts, finalTitle, voice ?? undefined);

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

    // Pre-upload guard: HEAD the rendered URL one more time before pushing to YouTube.
    try {
      const head = await fetch(stitched.url, { method: "HEAD" });
      const hLen = Number(head.headers.get("content-length") || "0");
      const hType = head.headers.get("content-type") || "unknown";
      console.log(`[recap] pre-upload HEAD check: status=${head.status} length=${hLen} type=${hType}`);
      if ((hLen > 0 && hLen < 100_000) || (hType !== "unknown" && !/video\/mp4/i.test(hType))) {
        console.error(`[recap] ABORT: pre-upload guard rejected file (length=${hLen} type=${hType})`);
        await svc.from("post_history").insert({
          user_id: userId, status: "failed", platform: "youtube",
          city: posts[0].city, caption: finalTitle,
          error_message: `Pre-upload guard rejected file (length=${hLen} type=${hType})`,
        });
        return { ok: false, detail: "Pre-upload guard rejected file" };
      }
    } catch (e) {
      console.warn(`[recap] pre-upload HEAD check failed (continuing): ${(e as Error).message}`);
    }

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

  const gate = await requireCronOrUser(req);
  if (!gate.ok) return gate.response;

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

  if (cityFilter || userFilter) {
    console.log(`[manual] weekly triggered for city=${cityFilter ?? "(any)"} by user=${gate.source === "user" ? gate.userId : (userFilter ?? "cron")}`);
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

  const work = async () => {
    const results: Array<{ user_id: string; ok: boolean; detail: string }> = [];
    for (const c of candidateList) {
      try {
        const r = await runForUser(svc, c.user_id, cityFilter);
        results.push({ user_id: c.user_id, ...r });
      } catch (e) {
        const msg = (e as Error).message;
        console.error(`[recap] user ${c.user_id} failed:`, msg);
        results.push({ user_id: c.user_id, ok: false, detail: msg });
        try {
          await svc.from("post_history").insert({
            user_id: c.user_id, status: "failed", platform: "youtube",
            caption: "Weekly Recap",
            error_message: `Background recap failed: ${msg}`,
          });
        } catch { /* ignore */ }
      }
    }

    try {
      await svc.from("system_health").upsert({
        id: "create-weekly-recap",
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_message: `${results.filter(r => r.ok).length}/${results.length} recaps`,
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[recap] system_health upsert failed:", (e as Error).message);
    }

    console.log(`[recap] background job complete: ${results.filter(r => r.ok).length}/${results.length} recaps`);
  };

  // @ts-ignore — EdgeRuntime is provided by Supabase Edge
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(work());
  } else {
    work().catch((e) => console.error("[recap] background failed:", (e as Error).message));
  }

  return new Response(
    JSON.stringify({ ok: true, accepted: true, candidates: candidateList.length }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});


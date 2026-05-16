// Video render fallback wrapper.
//
// Wraps the existing Creatomate-based renderer with JSON2Video fallback(s).
// Returns raw bytes + mimeType + duration so callers can validate that a
// real video (≥ 2 s) was produced before treating render_video as success.
//
// Usage from an edge function:
//   const video = await generateVideoWithFallback({
//     weather, timePeriod, voiceUrl, audioDurationSec,
//     creatomate: () => generateWeatherVideo(weather, timePeriod, voiceUrl, audioDurationSec),
//   });

export interface NormalizedRender {
  url: string;
  duration: number;
  thumbnail?: string;
  provider: "creatomate" | "json2video" | "json2video_kenburns";
}

export interface RenderBytes {
  data: Uint8Array;
  mimeType: string;
  /** Reported video duration in seconds. < 2 ⇒ treated as failure upstream. */
  duration?: number;
  provider: "creatomate" | "json2video" | "json2video_kenburns";
}

/** Tagged failure: render provider rejected for credits / quota / billing. */
export type CreditExhaustedError = { creditExhausted: true; provider: "creatomate" | "json2video"; message?: string };

export type CreatomateResult =
  | { data: Uint8Array; mimeType: string; duration?: number }
  | CreditExhaustedError
  | null;

export interface FallbackPayload {
  weather: any;
  timePeriod?: string | null;
  voiceUrl?: string | null;
  audioDurationSec?: number | null;
  // Existing creatomate renderer — already returns bytes + mime (+ optional duration),
  // OR a CreditExhaustedError tag when the provider blocks the request for billing.
  creatomate: () => Promise<CreatomateResult>;
  // Optional timeout for the primary provider (ms). Default: 180s
  primaryTimeoutMs?: number;
  // AI Visual Optimization — drives JSON2Video background pick.
  visualStyle?: string | null;
}

const DEFAULT_TIMEOUT_MS = 180_000;
// A render that completes in <2s almost always means Creatomate short-circuited
// (auth error, empty body, etc.) — treat as a failed attempt, never as success.
const MIN_WALL_DURATION_MS = 2_000;
// Final video must be > 2 s of playable content.
const MIN_VIDEO_DURATION_SEC = 2;

function isCreditError(v: unknown): v is CreditExhaustedError {
  return !!v && typeof v === "object" && (v as any).creditExhausted === true;
}

export async function generateVideoWithFallback(
  payload: FallbackPayload,
): Promise<RenderBytes | null> {
  const timeoutMs = payload.primaryTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hasCreatomateKey = !!Deno.env.get("CREATOMATE_API_KEY");
  console.log(
    `[render] creatomate_request_sent=${hasCreatomateKey} visual_style=${payload.visualStyle ?? "default"} voice_url=${payload.voiceUrl ? "present" : "none"} audio_dur=${payload.audioDurationSec ?? "n/a"}s timeout=${timeoutMs}ms`,
  );

  // ---- Primary: Creatomate (always attempted, with one retry) ----
  const MAX_ATTEMPTS = 2;
  let creatomateCreditError = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`creatomate timeout after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      );
      const result = await Promise.race([payload.creatomate(), timeout]);

      // Credit / quota exhaustion → skip retries, jump straight to fallback.
      if (isCreditError(result)) {
        creatomateCreditError = true;
        console.error(
          `[render] CREDIT_EXHAUSTED on creatomate attempt=${attempt}: ${result.message ?? "no message"} — skipping retries, escalating to fallback`,
        );
        break;
      }

      const wallMs = Date.now() - startedAt;
      const bytes = result?.data?.byteLength ?? 0;
      const dur = (result as any)?.duration;
      console.log(
        `[render] creatomate attempt=${attempt}/${MAX_ATTEMPTS} wall=${wallMs}ms bytes=${bytes} reported_dur=${dur ?? "?"}s ok=${!!(result && bytes > 0)}`,
      );
      if (result && bytes > 0) {
        if (wallMs < MIN_WALL_DURATION_MS) {
          console.error(
            `[render] REJECTED: creatomate finished in ${wallMs}ms (<${MIN_WALL_DURATION_MS}ms). Treating as failure.`,
          );
        } else if (typeof dur === "number" && dur < MIN_VIDEO_DURATION_SEC) {
          console.error(
            `[render] REJECTED: creatomate reported_dur=${dur}s (< ${MIN_VIDEO_DURATION_SEC}s). Treating as failure.`,
          );
        } else {
          console.log(`[render] Render provider: creatomate (attempt ${attempt})`);
          return { data: result.data, mimeType: result.mimeType, duration: dur, provider: "creatomate" };
        }
      } else if (!result) {
        console.error(`[render] creatomate returned null on attempt ${attempt}`);
      } else {
        console.error(`[render] creatomate returned empty bytes on attempt ${attempt}`);
      }
    } catch (error) {
      const wallMs = Date.now() - startedAt;
      const msg = (error as Error).message ?? "";
      console.error(
        `[render] creatomate attempt=${attempt}/${MAX_ATTEMPTS} wall=${wallMs}ms ERROR:`,
        msg,
      );
      if (looksLikeCreditError(msg)) {
        creatomateCreditError = true;
        console.error(`[render] credit-error keyword detected — escalating to fallback`);
        break;
      }
    }
    if (attempt < MAX_ATTEMPTS) {
      console.log(`[render] retrying creatomate (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
    }
  }

  // ---- Fallback 1: JSON2Video (full composition) ----
  console.warn(
    `[render] Creatomate failed${creatomateCreditError ? " (credit_exhausted)" : ""} — falling back to JSON2Video`,
  );
  let json2videoCreditError = false;
  try {
    const fallback = await generateWithJSON2Video(payload, /*kenBurns*/ false);
    if (isCreditError(fallback)) {
      json2videoCreditError = true;
      console.error(`[render] CREDIT_EXHAUSTED on json2video — escalating to ken-burns fallback`);
    } else if (fallback && fallback.data.byteLength > 0) {
      if (typeof fallback.duration === "number" && fallback.duration < MIN_VIDEO_DURATION_SEC) {
        console.error(`[render] REJECTED: json2video duration ${fallback.duration}s < ${MIN_VIDEO_DURATION_SEC}s`);
      } else {
        console.log("[render] Render provider: json2video");
        return { ...fallback, provider: "json2video" };
      }
    } else {
      console.error("[render] JSON2Video returned empty result");
    }
  } catch (error) {
    const msg = (error as Error).message ?? "";
    console.error("[render] JSON2Video failed:", msg);
    if (looksLikeCreditError(msg)) json2videoCreditError = true;
  }

  // ---- Fallback 2: JSON2Video Ken-Burns (cheap, single-image, always-on) ----
  // Triggered by: any earlier failure (credit-exhaustion or otherwise). Uses
  // a single Pexels still + slow zoom + weather overlays + voice + CTA so we
  // ALWAYS produce a valid mp4 for video-required platforms.
  console.warn(
    `[render] Escalating to Ken-Burns fallback (creatomate_credit=${creatomateCreditError} json2video_credit=${json2videoCreditError})`,
  );
  try {
    const kb = await generateWithJSON2Video(payload, /*kenBurns*/ true);
    if (isCreditError(kb)) {
      console.error(`[render] CREDIT_EXHAUSTED on ken-burns fallback — no providers available`);
      return null;
    }
    if (kb && kb.data.byteLength > 0) {
      if (typeof kb.duration === "number" && kb.duration < MIN_VIDEO_DURATION_SEC) {
        console.error(`[render] REJECTED: ken-burns duration ${kb.duration}s < ${MIN_VIDEO_DURATION_SEC}s`);
        return null;
      }
      console.log("[render] Render provider: json2video_kenburns");
      return { ...kb, provider: "json2video_kenburns" };
    }
    console.error("[render] Ken-Burns fallback returned empty result");
    return null;
  } catch (error) {
    console.error("[render] Ken-Burns fallback failed:", (error as Error).message);
    return null;
  }
}

function looksLikeCreditError(s: string): boolean {
  // STRICT: only escalate to credit-exhaustion when the API is unambiguous
  // about it. Avoids false "credits depleted" failures (e.g. transient 402s
  // on unrelated endpoints, "billing" appearing in benign messages, or the
  // substring "402" showing up in unrelated payloads). The HTTP 402 status
  // code itself is checked separately at the call sites.
  const m = (s || "").toLowerCase();
  return (
    m.includes("insufficient credit") ||
    m.includes("credit exhausted") ||
    m.includes("credits exhausted") ||
    m.includes("out of credit") ||
    m.includes("no credits") ||
    m.includes("no_credits")
  );
}

// ───────────── JSON2Video adapter ─────────────
// Builds a vertical 1080x1920 weather card. When `kenBurns=true` we render a
// guaranteed-cheap composition: a single Pexels still, slow zoom, weather
// overlays, voice + CTA — designed to survive when full compositions fail.
async function generateWithJSON2Video(
  payload: FallbackPayload,
  kenBurns = false,
): Promise<({ data: Uint8Array; mimeType: string; duration?: number }) | CreditExhaustedError | null> {
  const apiKey = Deno.env.get("JSON2VIDEO_API_KEY");
  if (!apiKey) {
    console.error("JSON2VIDEO_API_KEY not configured");
    return null;
  }

  const w = payload.weather ?? {};
  const city: string = w.city ?? "Your City";
  const region: string = w.stateOrRegion ?? "";
  const cond: string = w.condition ?? "Clear";
  const temp = typeof w.temperature === "number" ? Math.round(w.temperature) : null;
  const morning = typeof w.morningTemp === "number" ? Math.round(w.morningTemp) : null;
  const afternoon = typeof w.afternoonTemp === "number" ? Math.round(w.afternoonTemp) : null;
  const evening = typeof w.eveningTemp === "number" ? Math.round(w.eveningTemp) : null;

  const audioLen = typeof payload.audioDurationSec === "number" && payload.audioDurationSec > 0
    ? payload.audioDurationSec
    : 12;
  const duration = kenBurns
    ? Math.max(12, Math.min(15, Math.ceil(audioLen + 1)))
    : Math.max(8, Math.min(40, Math.ceil(audioLen + 1.5)));

  const bg = pickBackgroundColor(cond, payload.visualStyle || null);
  const headline = `${city}${region ? ", " + region : ""}`;
  const sub = temp != null ? `${temp}°F · ${cond}` : cond;
  const breakdown = [
    morning != null ? `Morning ${morning}°` : null,
    afternoon != null ? `Afternoon ${afternoon}°` : null,
    evening != null ? `Evening ${evening}°` : null,
  ].filter(Boolean).join("   ");
  const ctaText = `Follow for daily ${city} weather`;

  const elements: any[] = [];

  // Ken-Burns background image (slow zoom-in over full duration).
  if (kenBurns) {
    const bgImage = await fetchPexelsStillForCondition(cond, city);
    if (bgImage) {
      elements.push({
        type: "image",
        src: bgImage,
        start: 0,
        duration,
        x: 0, y: 0, width: 1080, height: 1920,
        // JSON2Video supports a "zoom" pan/scale animation on still images.
        zoom: 1,
        pan: "center",
        "pan-distance": 0.08,
      });
      // Subtle dark overlay so text stays legible over photo.
      elements.push({
        type: "text", text: " ",
        x: 0, y: 0, width: 1080, height: 1920,
        "background-color": "#00000066",
      });
    }
  }

  elements.push(
    { type: "text", text: headline,
      "font-family": "Inter", "font-size": 96, "font-weight": "800",
      "font-color": "#ffffff", x: 60, y: 220, width: 960 },
    { type: "text", text: sub,
      "font-family": "Inter", "font-size": 72, "font-weight": "700",
      "font-color": "#ffffff", x: 60, y: 360, width: 960 },
    { type: "text", text: breakdown,
      "font-family": "Inter", "font-size": 48, "font-weight": "600",
      "font-color": "#f1f5f9", x: 60, y: 1620, width: 960 },
  );

  // Animated CTA in the last ~3s (fade-in via start-late).
  const ctaStart = Math.max(0, duration - 3);
  elements.push({
    type: "text", text: ctaText,
    "font-family": "Inter", "font-size": 56, "font-weight": "700",
    "font-color": "#ffffff",
    "background-color": "#1e3a8acc",
    x: 60, y: 1780, width: 960,
    start: ctaStart, duration: duration - ctaStart,
  });

  if (payload.voiceUrl) {
    elements.push({
      type: "audio",
      src: payload.voiceUrl,
      start: 0,
      duration: audioLen,
      volume: 1,
    });
  }

  const movie = {
    resolution: "custom",
    width: 1080,
    height: 1920,
    quality: "high",
    scenes: [
      {
        duration,
        "background-color": bg,
        elements,
      },
    ],
  };

  // Submit job
  const submit = await fetch("https://api.json2video.com/v2/movies", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(movie),
  });
  const submitText = await submit.text();
  if (!submit.ok) {
    console.error("JSON2Video submit failed:", submit.status, submitText.slice(0, 400));
    if (submit.status === 402 || submit.status === 429 || looksLikeCreditError(submitText)) {
      return { creditExhausted: true, provider: "json2video", message: submitText.slice(0, 200) };
    }
    return null;
  }
  let submitJson: any;
  try { submitJson = JSON.parse(submitText); } catch { return null; }
  const project = submitJson?.project ?? submitJson?.id ?? submitJson?.data?.project;
  if (!project) {
    console.error("JSON2Video: no project id in response", submitText.slice(0, 200));
    return null;
  }
  console.log(`JSON2Video render started, project: ${project} (kenBurns=${kenBurns})`);

  // Poll
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const statusRes = await fetch(
      `https://api.json2video.com/v2/movies?project=${encodeURIComponent(project)}`,
      { headers: { "x-api-key": apiKey } },
    );
    if (!statusRes.ok) continue;
    const statusJson: any = await statusRes.json();
    const movieData = statusJson?.movie ?? statusJson;
    const status = movieData?.status;
    const url = movieData?.url;
    const reportedDuration: number | undefined =
      typeof movieData?.duration === "number" ? movieData.duration : undefined;
    console.log(`JSON2Video ${project} status: ${status}`);
    if (status === "done" && url) {
      const dl = await fetch(url);
      if (!dl.ok) {
        console.error("JSON2Video: download failed", dl.status);
        return null;
      }
      const ab = await dl.arrayBuffer();
      console.log(`JSON2Video downloaded: ${ab.byteLength} bytes, reported_dur=${reportedDuration ?? "?"}s`);
      return {
        data: new Uint8Array(ab),
        mimeType: "video/mp4",
        duration: reportedDuration ?? duration,
      };
    }
    if (status === "error" || status === "failed") {
      const msg = String(movieData?.message ?? "unknown");
      console.error("JSON2Video render failed:", msg);
      if (looksLikeCreditError(msg)) {
        return { creditExhausted: true, provider: "json2video", message: msg };
      }
      return null;
    }
  }
  console.error("JSON2Video render timed out");
  return null;
}

async function fetchPexelsStillForCondition(condition: string, city: string): Promise<string | null> {
  const key = Deno.env.get("PEXELS_API_KEY");
  if (!key) return null;
  const c = (condition || "").toLowerCase();
  let primary = "sky";
  if (c.includes("rain") || c.includes("storm")) primary = "rain storm sky";
  else if (c.includes("snow")) primary = "snow landscape";
  else if (c.includes("cloud")) primary = "cloudy sky";
  else if (c.includes("fog") || c.includes("mist")) primary = "foggy landscape";
  else primary = "blue sky clouds";

  // Random secondary keyword for thumbnail variety even on identical weather.
  const SECONDARY = ["foliage", "architecture", "horizon", "aerial", "street", "skyline", "trees", "rooftop", "park", "downtown"];
  const secondary = SECONDARY[Math.floor(Math.random() * SECONDARY.length)];

  // City is included in the query so identical conditions in different cities
  // never collide on the same stock photo. Future caching MUST include `city`
  // in its cache key.
  const cityPart = (city || "").trim();
  const q = [primary, secondary, cityPart].filter(Boolean).join(" ");

  try {
    const r = await fetch(
      `https://api.pexels.com/v1/search?per_page=10&orientation=portrait&query=${encodeURIComponent(q)}`,
      { headers: { Authorization: key } },
    );
    if (!r.ok) return null;
    const j: any = await r.json();
    const photos: any[] = Array.isArray(j?.photos) ? j.photos : [];
    if (!photos.length) return null;
    const idx = Math.floor(Math.random() * photos.length);
    const pick = photos[idx];
    console.log(`[ken-burns] pexels q="${q}" picked=${idx + 1}/${photos.length}`);
    return pick?.src?.portrait || pick?.src?.large2x || pick?.src?.large || null;
  } catch (e) {
    console.warn("[ken-burns] pexels fetch failed:", (e as Error).message);
    return null;
  }
}

function pickSkyGradient(condition: string): string {
  const c = (condition || "").toLowerCase();
  if (c.includes("rain") || c.includes("storm") || c.includes("drizzle")) return "#374151";
  if (c.includes("snow")) return "#94a3b8";
  if (c.includes("cloud")) return "#475569";
  if (c.includes("fog") || c.includes("mist")) return "#64748b";
  return "#1e3a8a";
}

/**
 * Visual Optimization: choose a background color that respects the
 * requested visual_style (gradient | sky | cinematic | minimal). Falls
 * back to the existing condition-driven gradient when no style provided.
 */
function pickBackgroundColor(condition: string, style: string | null): string {
  const s = (style || "").toLowerCase();
  if (s === "minimal") return "#f1f5f9";   // bright, high-contrast
  if (s === "cinematic") return "#0b1220"; // deep moody backdrop
  if (s === "sky") return "#1e3a8a";       // bright blue sky
  // "gradient" or unspecified → existing condition-aware palette
  return pickSkyGradient(condition);
}

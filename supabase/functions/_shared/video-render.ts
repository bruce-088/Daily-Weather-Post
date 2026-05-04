// Video render fallback wrapper.
//
// Wraps the existing Creatomate-based renderer with a JSON2Video fallback.
// The wrapper preserves the existing pipeline contract (returns raw bytes
// + mimeType) so that auto-post-scheduler, scheduled_posts pipeline, and
// posting logic remain UNCHANGED. Internally it normalizes both providers
// to a { url, duration, thumbnail? } shape before downloading.
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
  provider: "creatomate" | "json2video";
}

export interface RenderBytes {
  data: Uint8Array;
  mimeType: string;
  provider: "creatomate" | "json2video";
}

export interface FallbackPayload {
  weather: any;
  timePeriod?: string | null;
  voiceUrl?: string | null;
  audioDurationSec?: number | null;
  // Existing creatomate renderer — already returns bytes + mime.
  creatomate: () => Promise<{ data: Uint8Array; mimeType: string } | null>;
  // Optional timeout for the primary provider (ms). Default: 180s
  // (Creatomate often needs >15s; keep generous so we don't fail healthy renders.)
  primaryTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 180_000;

export async function generateVideoWithFallback(
  payload: FallbackPayload,
): Promise<RenderBytes | null> {
  const timeoutMs = payload.primaryTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  // ---- Primary: Creatomate ----
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`creatomate timeout after ${timeoutMs}ms`)), timeoutMs)
    );
    const result = await Promise.race([payload.creatomate(), timeout]);
    if (result && result.data && result.data.byteLength > 0) {
      console.log("Render provider: creatomate");
      return { ...result, provider: "creatomate" };
    }
    throw new Error("creatomate returned empty result");
  } catch (error) {
    console.error("Creatomate failed:", (error as Error).message);
  }

  // ---- Fallback: JSON2Video ----
  try {
    const fallback = await generateWithJSON2Video(payload);
    if (fallback && fallback.data.byteLength > 0) {
      console.log("Render provider: json2video");
      return { ...fallback, provider: "json2video" };
    }
    console.error("JSON2Video returned empty result");
    return null;
  } catch (error) {
    console.error("JSON2Video failed:", (error as Error).message);
    return null;
  }
}

// ───────────── JSON2Video adapter ─────────────
// Builds a vertical 1080x1920 weather card with text overlays for
// morning/afternoon/evening, optional voice audio, and a sky-gradient
// background (or stock video if available via the same Pexels asset).
//
// Docs: https://json2video.com/docs/api/
async function generateWithJSON2Video(
  payload: FallbackPayload,
): Promise<{ data: Uint8Array; mimeType: string } | null> {
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
  const duration = Math.max(8, Math.min(40, Math.ceil(audioLen + 1.5)));

  const bg = pickSkyGradient(cond);
  const headline = `${city}${region ? ", " + region : ""}`;
  const sub = temp != null ? `${temp}°F · ${cond}` : cond;
  const breakdown = [
    morning != null ? `Morning ${morning}°` : null,
    afternoon != null ? `Afternoon ${afternoon}°` : null,
    evening != null ? `Evening ${evening}°` : null,
  ].filter(Boolean).join("   ");

  const elements: any[] = [
    { type: "text", text: headline,
      "font-family": "Inter", "font-size": 96, "font-weight": "800",
      "font-color": "#ffffff", x: 60, y: 220, width: 960 },
    { type: "text", text: sub,
      "font-family": "Inter", "font-size": 72, "font-weight": "700",
      "font-color": "#ffffff", x: 60, y: 360, width: 960 },
    { type: "text", text: breakdown,
      "font-family": "Inter", "font-size": 48, "font-weight": "600",
      "font-color": "#f1f5f9", x: 60, y: 1620, width: 960 },
  ];

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
        background: { type: "color", color: bg },
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
    return null;
  }
  let submitJson: any;
  try { submitJson = JSON.parse(submitText); } catch { return null; }
  const project = submitJson?.project ?? submitJson?.id ?? submitJson?.data?.project;
  if (!project) {
    console.error("JSON2Video: no project id in response", submitText.slice(0, 200));
    return null;
  }
  console.log("JSON2Video render started, project:", project);

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
    console.log(`JSON2Video ${project} status: ${status}`);
    if (status === "done" && url) {
      const dl = await fetch(url);
      if (!dl.ok) {
        console.error("JSON2Video: download failed", dl.status);
        return null;
      }
      const ab = await dl.arrayBuffer();
      console.log("JSON2Video downloaded:", ab.byteLength, "bytes");
      return { data: new Uint8Array(ab), mimeType: "video/mp4" };
    }
    if (status === "error" || status === "failed") {
      console.error("JSON2Video render failed:", movieData?.message ?? "unknown");
      return null;
    }
  }
  console.error("JSON2Video render timed out");
  return null;
}

function pickSkyGradient(condition: string): string {
  const c = (condition || "").toLowerCase();
  if (c.includes("rain") || c.includes("storm") || c.includes("drizzle")) return "#374151";
  if (c.includes("snow")) return "#94a3b8";
  if (c.includes("cloud")) return "#475569";
  if (c.includes("fog") || c.includes("mist")) return "#64748b";
  return "#1e3a8a";
}

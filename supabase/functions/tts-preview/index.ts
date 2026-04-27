import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Keep aligned with process-scheduled-posts/index.ts
const ELEVENLABS_VOICES: Record<string, string> = {
  female: "EXAVITQu4vr4xnSDxMaL",   // Sarah — warm, conversational
  male:   "JBFqnCBsd6RMkjVDRZzb",   // George — confident, news-style
  anchor: "onwK4e9ZLuTAKqWW03F9",   // Daniel — authoritative news anchor
  cheerful: "Xb7hH8MSUJpSbSDYk0k2", // Alice — bright, cheerful
  calm:   "cgSgspJ2msm6clMCkdW9",   // Jessica — calm, soothing
  deep:   "nPczCjzI2devNBz1zQrb",   // Brian — deep, resonant
};

function resolveVoiceId(input?: string | null): string {
  if (!input) return ELEVENLABS_VOICES.female;
  if (ELEVENLABS_VOICES[input]) return ELEVENLABS_VOICES[input];
  return input; // assume raw ElevenLabs id
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || !isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Voice service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const voiceId = typeof body?.voiceId === "string" ? body.voiceId : "female";
    const speed = clamp(Number(body?.speed), 0.7, 1.2, 1.0);
    const stability = clamp(Number(body?.stability), 0, 1, 0.55);
    const similarity = clamp(Number(body?.similarity), 0, 1, 0.78);
    const text =
      typeof body?.text === "string" && body.text.trim().length > 0
        ? body.text.trim().slice(0, 280)
        : "Good morning. Expect partly cloudy skies with a high near 72 degrees and a light breeze from the west.";

    const url = `https://api.elevenlabs.io/v1/text-to-speech/${resolveVoiceId(voiceId)}?output_format=mp3_44100_128`;
    const ttsRes = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
        voice_settings: {
          stability,
          similarity_boost: similarity,
          style: 0.35,
          use_speaker_boost: true,
          speed,
        },
      }),
    });

    if (!ttsRes.ok) {
      const errText = (await ttsRes.text()).slice(0, 300);
      console.error("[tts-preview] ElevenLabs error:", ttsRes.status, errText);
      // Detect quota / auth issues so the client can gracefully fall back
      // to the browser's built-in speech synthesis instead of crashing.
      const isQuota = ttsRes.status === 401 || ttsRes.status === 402 || /quota/i.test(errText);
      const isFallbackable = isQuota || ttsRes.status >= 500;
      const message = isQuota
        ? "Voice service quota exceeded — using browser voice as fallback."
        : `Voice generation failed (${ttsRes.status})`;
      return new Response(
        JSON.stringify({ error: message, fallback: isFallbackable }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const audioBytes = new Uint8Array(await ttsRes.arrayBuffer());
    const audioBase64 = base64Encode(audioBytes);

    return new Response(
      JSON.stringify({ audioContent: audioBase64, mimeType: "audio/mpeg" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[tts-preview] error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

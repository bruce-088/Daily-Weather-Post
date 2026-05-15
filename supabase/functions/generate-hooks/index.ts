import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { verifyUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Viral Hook Generator.
 * Returns 3 high-engagement YouTube/Shorts title hooks for a weather post.
 *  A — Urgency / Warning
 *  B — Instructional / Advice
 *  C — Observation / Direct
 *
 * Pure ADD-ON: does not touch caption/render/voice pipelines.
 */

const SYSTEM_PROMPT = `You write short, punchy, high-retention YouTube Shorts titles for a local weather brand called SkyBrief.
Rules:
- Each hook must be a single sentence, 50–95 characters, no quotes, no emojis, no hashtags.
- Mention the city naturally.
- Reference the actual weather condition / temperature when given.
- Sound like a person who lives there, not a TV anchor.
- Do not exaggerate ("APOCALYPSE", "DEADLY") — confident, not clickbait.
- Output STRICT JSON only. No prose, no markdown, no code fences.`;

function fallbackHooks(city: string, condition: string, time: string) {
  const c = condition || "weather";
  const t = time || "today";
  return {
    A: `Heads up ${city} — ${c} rolling in ${t}, here is what to expect.`,
    B: `${city}, don't leave home today without checking this ${c} forecast.`,
    C: `It's about to get ${c} in ${city} — here is the plan for ${t}.`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = await verifyUser(req);
    if (auth.response) return auth.response;

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const body = await req.json().catch(() => ({}));
    const city: string = String(body.city || "").trim() || "your city";
    const condition: string = String(body.condition || body.weather?.condition || "the weather").trim();
    const temperature = body.temperature ?? body.weather?.temperature ?? null;
    const time: string = String(body.time_period || body.timePeriod || "today").trim();
    const rainChance = body.rain_chance ?? body.rainChance ?? null;

    const userPrompt = `City: ${city}
Condition: ${condition}
Temperature: ${temperature ?? "n/a"}°F
Rain chance: ${rainChance ?? "n/a"}%
Time period: ${time}

Generate THREE distinct hooks following these formulas exactly:
- A (Urgency / Warning): "Heads up <city> — <condition> rolling in at <time-or-window>..." style.
- B (Instructional / Advice): "<city>, don't leave home without <umbrella/sunglasses/jacket> today..." style. Pick the item that fits the actual condition.
- C (Observation / Direct): "It's about to get <condition> in <city> — here is the plan..." style.

Return JSON of the form: {"A": "...", "B": "...", "C": "..."}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later.", hooks: fallbackHooks(city, condition, time) }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (res.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted.", hooks: fallbackHooks(city, condition, time) }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const text = await res.text();
      console.error("[generate-hooks] gateway error", res.status, text.slice(0, 300));
      // Soft-fallback so the UI always has 3 hooks.
      return new Response(
        JSON.stringify({ hooks: fallbackHooks(city, condition, time), fallback: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const fb = fallbackHooks(city, condition, time);
    const hooks = {
      A: String(parsed.A || parsed.a || fb.A).trim(),
      B: String(parsed.B || parsed.b || fb.B).trim(),
      C: String(parsed.C || parsed.c || fb.C).trim(),
    };

    return new Response(
      JSON.stringify({ hooks }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("generate-hooks error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

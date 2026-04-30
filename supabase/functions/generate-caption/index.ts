import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyUser } from "../_shared/auth-helpers.ts";
import { buildStyleAddendum, normalizeTone } from "../_shared/caption-style.ts";
import {
  LOCATION_ACCURACY_RULES,
  buildVerifiedLandmarksBlock,
  validateCaptionLocation,
  stripUnverifiedReferences,
} from "../_shared/location-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- Dynamic Handle System ---

const HANDLE_MAP: Record<string, string> = {
  "Gainesville": "@SkyBriefGNV",
  "Miami": "@SkyBriefMiami",
  "Orlando": "@SkyBriefOrlando",
  "Tampa": "@SkyBriefTampa",
};

function getDynamicHandle(city: string): string {
  if (HANDLE_MAP[city]) return HANDLE_MAP[city];
  const cleaned = city.replace(/\s+/g, "");
  return `@SkyBrief${cleaned}`;
}

const SKYBRIEF_SYSTEM_PROMPT = `You are the caption-writing engine for a social media weather brand called SkyBrief.

BRAND IDENTITY:
SkyBrief is a clean, fast, local daily weather brand for Instagram and TikTok.
Its job is to make people understand today's weather in their city in seconds.
The tone is simple, reliable, human, local, and scroll-friendly.
Do NOT sound like a government weather report.
Do NOT sound overly corporate, technical, or dramatic.
Do NOT use long paragraphs.
Do NOT use clickbait.
Do NOT use slang that feels forced.

WRITING STYLE:
- Keep captions short and highly readable
- Use plain English
- Sound confident, helpful, and local
- Make the weather feel relevant to the person's actual day
- Prioritize clarity over creativity
- Use light personality, but never become cheesy
- Make each caption feel like a quick daily brief
- Optimize for mobile reading

CAPTION GOAL:
Write a daily weather caption for social media that helps someone instantly know:
1. What the weather is like today
2. What part of the day matters most
3. Whether they need to prepare for heat, rain, wind, cold, storms, or a great outdoor day

CAPTION STRUCTURE:
Generate captions using this format:
Line 1: City + "Weather" + date or "Today"
Line 2: Morning forecast in a few words with temp
Line 3: Afternoon forecast in a few words with temp
Line 4: Evening forecast in a few words with temp
Line 5: Rain chance
Line 6: If alert_line is provided (not "None"), include it as a short calm alert line
Line 7: "What to know:" followed by 2-3 short bullet-style points
Line 8: Tomorrow preview line (use the provided tomorrow_preview)
Final line: A habit-forming CTA using the provided dynamic_handle (e.g. "Follow @SkyBriefGNV for tomorrow's forecast" or "Check back tomorrow on @SkyBriefMiami")

STYLE RULES:
- Keep total caption under 120 words unless severe weather requires more
- Use short lines
- Use emojis sparingly and naturally (0-4 max)
- Only use emojis that fit weather content: sun, cloud, rain, lightning, wind, umbrella, sunrise, sunset, snow
- Include a practical takeaway
- If severe weather is present, shift tone to calm, clear, and alert
- Never exaggerate risk
- Never use jargon unless necessary
- Never include hashtags unless explicitly requested
- Never write more than one CTA
- Avoid repetitive phrases across days
- The final CTA line MUST use the exact dynamic_handle provided — do not substitute or invent a different handle

TONE MODES:
1. NICE DAY MODE - pleasant, dry, calm, or sunny. Tone: light, fresh, easy, upbeat
2. MIXED DAY MODE - day changes across periods or conditions are inconsistent. Tone: balanced, practical, informative
3. ALERT MODE - storms, strong wind, heavy rain, extreme heat, freezing. Tone: calm, direct, useful
4. COZY MODE - cloudy, cool, drizzly, foggy, subdued. Tone: mellow, simple, slightly warm

BRAND CONSISTENCY RULES:
- Every caption should feel like part of the same brand system
- Keep formatting consistent across posts
- Vary wording slightly, but keep the structure familiar
- The brand voice should feel local, useful, and clean
- Write like a dependable local weather page, not a news anchor and not a meme page
- Make the caption useful even if someone only reads the first 3 lines

Return only the finished caption. Do not explain your choices. Do not output labels. Do not include quotation marks around the caption.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify authenticated user
    const auth = await verifyUser(req);
    if (auth.response) return auth.response;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const body = await req.json();
    const { city } = body;
    if (!city) throw new Error("city is required");

    const now = new Date();
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const handle = getDynamicHandle(city);

    // Detect extreme weather and append urgent tone instruction
    const condStr = String(body.condition ?? body.morning_condition ?? body.afternoon_condition ?? "").toLowerCase();
    const tempVal = Number(body.temperature ?? body.afternoonTemp ?? body.afternoon_temp ?? 0);
    const isExtreme =
      tempVal > 100 ||
      condStr.includes("storm") ||
      condStr.includes("hurricane") ||
      condStr.includes("tornado") ||
      condStr.includes("blizzard");
    const extremeNote = isExtreme
      ? "\n\nIMPORTANT: Extreme weather detected. Use ALERT MODE. Lead with the urgent condition. Prioritize safety guidance (stay indoors / avoid travel / hydrate / take shelter as appropriate). Stay calm and direct — never panic-inducing or sensational. Keep the brand voice intact."
      : "";

    // Style + variation tone steering (UI-driven creative direction)
    const styleStr = String(body.style ?? "standard").toLowerCase();
    const styleNote =
      styleStr === "minimal"
        ? "\n\nSTYLE: MINIMAL. Strip back. Shorter lines, fewer words, no emojis, no decorative phrasing. Prioritize ruthless clarity."
        : styleStr === "cinematic"
        ? "\n\nSTYLE: CINEMATIC. Slightly more dramatic and evocative language. Use one strong opening line that paints the sky. Still concise; up to 2 weather emojis allowed."
        : "";

    const variation = !!body.variation;
    const variationNote = variation
      ? "\n\nVARIATION REQUEST: Generate a NOTICEABLY different creative angle than a typical informational caption — pick one of: witty, dramatic, conversational, or poetic. Keep all factual data the same. Vary opening line, sentence rhythm, and word choice. Do NOT repeat the previous caption's structure verbatim."
      : "";

    // Voice & Tone preset + life tips + greeting + hashtag stack
    const tone = normalizeTone(body.tone ?? body.caption_tone);
    const period = body.time_period ?? body.period ?? null;
    const highTemp = Number(body.afternoon_temp ?? body.afternoonTemp ?? body.temperature ?? 0);
    const lowTemp = Number(body.morning_temp ?? body.morningTemp ?? highTemp);
    const conditions = String(
      body.condition ?? body.afternoon_condition ?? body.afternoonCondition ?? body.morning_condition ?? body.morningCondition ?? "",
    );
    const styleAddendum = buildStyleAddendum({
      tone,
      city,
      state: body.state_or_region || body.stateOrRegion,
      period,
      rainChance: Number(body.rain_chance ?? body.rainChance ?? 0),
      highTemp,
      lowTemp,
      conditions,
      platform: body.platform ?? null,
    });

    // ---- AI learning: pull top content_insights for this user/condition/time_of_day ----
    let insightNote = "";
    let aiOptimized = false;
    try {
      const svc = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: settingsRow } = await svc
        .from("weather_settings")
        .select("use_performance_learning")
        .eq("user_id", auth.userId)
        .maybeSingle();
      const learningOn = (settingsRow as any)?.use_performance_learning !== false;
      if (learningOn) {
        const hourLocal = new Date().getHours();
        const tod =
          hourLocal < 11 ? "morning" :
          hourLocal < 16 ? "afternoon" :
          hourLocal < 21 ? "evening" : "night";
        const condKey = (conditions || "").toLowerCase().split(/[,;]/)[0]?.trim();
        if (condKey) {
          const { data: ins } = await svc
            .from("content_insights")
            .select("tone, top_hook, delta_pct, sample_size, rank")
            .eq("user_id", auth.userId)
            .eq("condition", condKey)
            .eq("time_of_day", tod)
            .order("rank", { ascending: true })
            .limit(1);
          const top = ins?.[0];
          if (top && (top as any).sample_size >= 3) {
            aiOptimized = true;
            const deltaTxt = (top as any).delta_pct ? ` (+${Math.round((top as any).delta_pct)}% vs your avg)` : "";
            const hookTxt = (top as any).top_hook ? `\nA past high-performing opener for this pattern: "${(top as any).top_hook}". Use it as inspiration only — do not copy verbatim.` : "";
            insightNote = `\n\nPERFORMANCE LEARNING: Your past ${condKey} posts at ${tod} perform best with a ${(top as any).tone.toUpperCase()} tone${deltaTxt}. Lean into that voice.${hookTxt}`;
          }
        }
      }
    } catch (e) {
      console.warn("[generate-caption] insight lookup failed:", e);
    }

    const userPrompt = `NOW USE THESE INPUTS TO WRITE TODAY'S CAPTION:

city: ${city}
state_or_region: ${body.state_or_region || body.stateOrRegion || ""}
date: ${body.date || now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
day_of_week: ${body.day_of_week || dayNames[now.getDay()]}
time_period: ${period || "Full Day"}
morning_temp: ${body.morning_temp ?? body.morningTemp ?? "N/A"}
morning_condition: ${body.morning_condition ?? body.morningCondition ?? "N/A"}
afternoon_temp: ${body.afternoon_temp ?? body.afternoonTemp ?? "N/A"}
afternoon_condition: ${body.afternoon_condition ?? body.afternoonCondition ?? "N/A"}
evening_temp: ${body.evening_temp ?? body.eveningTemp ?? "N/A"}
evening_condition: ${body.evening_condition ?? body.eveningCondition ?? "N/A"}
rain_chance: ${body.rain_chance ?? body.rainChance ?? "N/A"}%
wind_info: ${body.wind_info ?? body.windInfo ?? "N/A"}
alert_line: ${body.alert_line ?? body.alertLine ?? "None"}
tomorrow_preview: ${body.tomorrow_preview ?? body.tomorrowPreview ?? "N/A"}
sunrise_time: ${body.sunrise_time ?? body.sunrise ?? "N/A"}
sunset_time: ${body.sunset_time ?? body.sunset ?? "N/A"}
dynamic_handle: ${handle}
extra_note: ${body.extra_note ?? body.extraNote ?? ""}${extremeNote}${styleNote}${variationNote}

${buildVerifiedLandmarksBlock(city)}

${styleAddendum}${insightNote}`;

    const systemPrompt = `${SKYBRIEF_SYSTEM_PROMPT}\n\n${LOCATION_ACCURACY_RULES}`;

    const callModel = async (extraUserSuffix = "") => {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt + extraUserSuffix },
          ],
        }),
      });
      return res;
    };

    let response = await callModel();

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds in your workspace settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    let data = await response.json();
    let caption = data.choices?.[0]?.message?.content?.trim() || "";

    // Post-generation safety: if a foreign landmark slipped through, regenerate
    // ONCE with stricter instructions and no local-flavor allowance.
    let validation = validateCaptionLocation(caption, city);
    if (!validation.ok) {
      console.warn(`[generate-caption] foreign landmarks detected for ${city}:`, validation.hits);
      const retryRes = await callModel(
        `\n\nREGENERATION REQUIRED: Your previous draft mentioned ${validation.hits.join(", ")}, which is NOT in ${city}. Rewrite without ANY specific landmark, stadium, university, neighborhood, or business name. Use only generic local phrasing.`,
      );
      if (retryRes.ok) {
        data = await retryRes.json();
        const retryCaption = data.choices?.[0]?.message?.content?.trim() || "";
        const retryValidation = validateCaptionLocation(retryCaption, city);
        if (retryValidation.ok && retryCaption) {
          caption = retryCaption;
        } else if (retryCaption) {
          caption = stripUnverifiedReferences(retryCaption, city);
        }
      }
    }

    // Final safety net regardless of retry path
    caption = stripUnverifiedReferences(caption, city);

    return new Response(
      JSON.stringify({ caption }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("generate-caption error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyUser } from "../_shared/auth-helpers.ts";
import {
  buildStyleAddendum,
  normalizeTone,
  getCityLocalStamp,
  slotDisplayLabel,
  slotPersonalityDirective,
  rotatingCTA,
} from "../_shared/caption-style.ts";
import {
  LOCATION_ACCURACY_RULES,
  buildVerifiedLandmarksBlock,
  buildCityVisualBlock,
  buildLocalIdentityBlock,
  validateCaptionLocation,
  stripUnverifiedReferences,
} from "../_shared/location-guard.ts";
import { getTopPerformingPatterns, buildLearningPromptBlock } from "../_shared/learning-patterns.ts";
import { getWinningStyleForCondition, formatRecipeDirective } from "../_shared/winning-recipes.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- Caption phrasing cleanup ---

function cleanWeatherPhrasing(text: string): string {
  return text
    .replace(/\bin\s+(clear skies|rain|clouds|sunshine|snow|thunderstorms|fog|wind)\b/gi, (_m, p1) => {
      const lower = String(p1).toLowerCase();
      if (lower.includes("cloud")) return "with cloudy conditions";
      if (lower.includes("rain")) return "with rain";
      if (lower.includes("sun")) return "with sunshine";
      if (lower.includes("snow")) return "with snow";
      if (lower.includes("storm")) return "with storms";
      if (lower.includes("fog")) return "with fog";
      if (lower.includes("wind")) return "with windy conditions";
      if (lower.includes("clear")) return "with clear skies";
      return p1;
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function fixInvalidLocation(text: string, city: string): string {
  if (!city) return text;
  const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Fix: "weather in [Wrong]" -> "weather in [City]"
  const weatherRe = new RegExp(`\\bweather in (?!${escapedCity}\\b)[A-Za-z][A-Za-z\\s'-]{0,40}`, "gi");

  // Fix: "daily [Wrong] weather alerts" -> "daily [City] weather alerts"
  const dailyRe = new RegExp(`\\bdaily (?!${escapedCity}\\b)[A-Za-z][A-Za-z\\s'-]{0,40} weather alerts`, "gi");

  return text.replace(weatherRe, `weather in ${city}`).replace(dailyRe, `daily ${city} weather alerts`);
}

// Strict whitelist sanitizer — runs as the final step of the cleanup chain.
// Positive-match: anything in the "weather in ___" or "daily ___ weather alerts"
// slots that isn't exactly ${city} gets rewritten to ${city}. Catches any
// hallucinated label (style names, tone labels, "Weather Update", etc.) without
// maintaining a blacklist.
function forceCitySanity(text: string, city: string): string {
  if (!city) return text;
  const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Regex 1: any word(s) between "weather in " and end of sentence/line
  // that is NOT exactly the city name.
  const weatherInRegex = new RegExp(`weather in (?!${escapedCity}\\b)[^.!\\n]+`, "gi");

  // Regex 2: any word(s) between "daily " and " weather alerts"
  // that is NOT exactly the city name.
  const alertsRegex = new RegExp(`daily (?!${escapedCity}\\b)[^.!\\n]+?(?= weather alerts)`, "gi");

  let cleaned = text;
  cleaned = cleaned.replace(weatherInRegex, `weather in ${city}`);
  cleaned = cleaned.replace(alertsRegex, `daily ${city}`);
  return cleaned;
}

// --- Dynamic Handle System ---

const HANDLE_MAP: Record<string, string> = {
  Gainesville: "@SkyBriefGNV",
  Miami: "@SkyBriefMiami",
  Orlando: "@SkyBriefOrlando",
  Tampa: "@SkyBriefTampa",
};

function getDynamicHandle(city: string): string {
  if (HANDLE_MAP[city]) return HANDLE_MAP[city];
  const cleaned = city.replace(/\s+/g, "");
  return `@SkyBrief${cleaned}`;
}

// Fetch top-performing past winners from ai_memory for this user.
// NOTE: ai_memory is a GLOBAL knowledge base — winning patterns from any
// city are intentionally surfaced for all cities. Do NOT filter by city here.
// Filters by condition when available; falls back to user's overall top.
async function getRelevantMemories(
  svc: any,
  userId: string,
  condition: string | null,
  _timeOfDay: string | null,
): Promise<Array<{ content: string; performance_score: number; memory_type: string }>> {
  try {
    let q = svc
      .from("ai_memory")
      .select("content, performance_score, memory_type, condition")
      .eq("user_id", userId)
      .order("performance_score", { ascending: false })
      .limit(3);
    if (condition) q = q.eq("condition", condition);
    const { data, error } = await q;
    if (error) return [];
    let rows = (data || []) as any[];
    if (condition && rows.length === 0) {
      const { data: any2 } = await svc
        .from("ai_memory")
        .select("content, performance_score, memory_type, condition")
        .eq("user_id", userId)
        .order("performance_score", { ascending: false })
        .limit(3);
      rows = (any2 || []) as any[];
    }
    return rows;
  } catch {
    return [];
  }
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
      body.condition ??
        body.afternoon_condition ??
        body.afternoonCondition ??
        body.morning_condition ??
        body.morningCondition ??
        "",
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
      const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: settingsRow } = await svc
        .from("weather_settings")
        .select("use_performance_learning")
        .eq("user_id", auth.userId)
        .maybeSingle();
      const learningOn = (settingsRow as any)?.use_performance_learning !== false;
      if (learningOn) {
        const hourLocal = new Date().getHours();
        const tod = hourLocal < 11 ? "morning" : hourLocal < 16 ? "afternoon" : hourLocal < 21 ? "evening" : "night";
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
            const hookTxt = (top as any).top_hook
              ? `\nA past high-performing opener for this pattern: "${(top as any).top_hook}". Use it as inspiration only — do not copy verbatim.`
              : "";
            insightNote = `\n\nPERFORMANCE LEARNING: Your past ${condKey} posts at ${tod} perform best with a ${(top as any).tone.toUpperCase()} tone${deltaTxt}. Lean into that voice.${hookTxt}`;
          }
        }

        // ---- Auto-Growth signals: top hooks + opener avoidance + tone variety ----
        const { data: rec } = await svc
          .from("growth_recommendations")
          .select("top_hooks, recent_openers, recent_tones, variety_score")
          .eq("user_id", auth.userId)
          .maybeSingle();
        if (rec) {
          const topHooks: string[] = Array.isArray((rec as any).top_hooks) ? (rec as any).top_hooks : [];
          const recentOpeners: string[] = Array.isArray((rec as any).recent_openers) ? (rec as any).recent_openers : [];
          const recentTones: string[] = Array.isArray((rec as any).recent_tones) ? (rec as any).recent_tones : [];
          const varietyScore: number = Number((rec as any).variety_score ?? 100);

          if (topHooks.length > 0) {
            // Hard rotation: pick one of the top 3
            const chosen = topHooks[Math.floor(Math.random() * Math.min(3, topHooks.length))];
            insightNote += `\n\nHOOK ROTATION: Use this proven high-performing hook as inspiration for your opening line: "${chosen}". Adapt it to today's actual weather — do not copy verbatim if it doesn't fit.`;
            aiOptimized = true;
          }
          if (recentOpeners[0]) {
            insightNote += `\n\nVARIETY: Your last post opened with "${recentOpeners[0]}". Do NOT start with the same words this time.`;
          }
          if (varietyScore < 60 && recentTones[0]) {
            insightNote += `\n\nTONE NUDGE: Your last several posts were ${recentTones[0]}. Consider a different tone today for variety (the user-selected tone still wins).`;
          }
        }

        // FAVOR / AVOID + 70/30 explore/exploit (engagement_score = (likes*2+comments*3)/views)
        try {
          const patterns = await getTopPerformingPatterns(svc, auth.userId, { city });
          const block = buildLearningPromptBlock(patterns);
          if (block) {
            insightNote += block;
            aiOptimized = true;
          }
        } catch (e) {
          console.warn("[generate-caption] patterns lookup failed:", e);
        }

        // ---- AI Memory injection (winners from past A/B tests) ----
        try {
          const hourLocal2 = new Date().getHours();
          const tod2 =
            hourLocal2 < 11 ? "morning" : hourLocal2 < 16 ? "afternoon" : hourLocal2 < 21 ? "evening" : "night";
          const condKey2 = (conditions || "").toLowerCase().split(/[,;]/)[0]?.trim() || null;
          const memories = await getRelevantMemories(svc, auth.userId, condKey2, tod2);
          console.log("AI memory injected:", memories.length);
          if (memories.length >= 2) {
            insightNote += `\n\nUse similar styles to these high-performing examples:\n${memories.map((m: any) => `- ${m.content}`).join("\n")}`;
            aiOptimized = true;
          }
        } catch (e) {
          console.warn("[generate-caption] ai_memory lookup failed:", e);
        }

        // ---- Predictive Creative Engine: getWinningStyleForCondition ----
        // Use historical performance to choose visual_style + voice_tone + hook_type
        // for this (condition, city) and inject as a directive.
        try {
          const condForRecipe = (conditions || "").toLowerCase().split(/[,;]/)[0]?.trim() || null;
          const recipe = await getWinningStyleForCondition(svc, auth.userId, condForRecipe, city);
          insightNote += formatRecipeDirective(recipe);
          aiOptimized = true;
          console.log(
            `[generate-caption] 🎯 recipe (${recipe.source}, Δ${recipe.delta_pct}%): ${recipe.visual_style}/${recipe.voice_tone}/${recipe.hook_type}`,
          );
        } catch (e) {
          console.warn("[generate-caption] winning-recipe lookup failed:", e);
        }
      }
    } catch (e) {
      console.warn("[generate-caption] insight lookup failed:", e);
    }

    // Fail-safe precompute of the new enhancement blocks. If any helper throws,
    // we silently drop the block and fall back to the original prompt.
    let personalityBlock = "";
    let ctaBlock = "";
    let antiRepeatBlock = "";
    let diversityBlock = "";
    let focusBlock = "";
    let localVoiceBlock = "";
    let hookAggressionBlock = "";
    try {
      personalityBlock = slotPersonalityDirective(body.slot ?? period) || "";
      const _cta = rotatingCTA(body.slot ?? period);
      const locationGuard = `CRITICAL LOCATION RULE (highest priority):
- The ONLY valid location string anywhere in the caption is "${city}".
- The strings "Not Need", "Weather Update", "Coming Up", "But Comfortable", "Clear Skies", or any style/tone/variation label, or any weather condition word (Rain, Clouds, Sunny, Ahead, etc.) must NEVER appear as a location.
- Every time you refer to the location — in body text, CTA, hashtags, or anywhere else — you MUST use exactly "${city}".
- "weather in [X]" and "daily [X] weather alerts" MUST always use "${city}".
- If you mention the broadcast slot (Morning, Afternoon, Evening), it must be purely descriptive of the timeframe and NEVER used as a replacement for the city name "${city}".`;
      ctaBlock = _cta
        ? `CTA ROTATION: For the final call-to-action line, use this exact CTA (or a close paraphrase): "${_cta}". Do not invent additional CTAs.\n${locationGuard}`
        : locationGuard;
      if (body.prev_opener) {
        antiRepeatBlock = `ANTI-REPEAT: Do NOT reuse the opening hook, first-sentence structure, or CTA verb from the previous post for this city. Previous opener was: "${String(body.prev_opener).slice(0, 160)}". Use a noticeably different angle.`;
      }

      // ── Diversity Guard ──
      diversityBlock = `DIVERSITY GUARD:\nAvoid repeating recent hooks. If reusing a proven high-performing pattern, it MUST be rephrased with a new angle and different opening structure. Prefer secondary weather signals (wind, humidity, visibility, dew point, UV, local activity, cinematic atmosphere) when conditions are mild.`;

      // ── Focus Rotation (deterministic per city + day + slot) ──
      const focusPool = ["Landscape", "Sky", "Street Level", "Atmospheric Detail", "Human Activity"];
      const slotIdx = (() => {
        const s = String(body.slot ?? period ?? "").toLowerCase();
        if (s.includes("morning")) return 0;
        if (s.includes("afternoon")) return 1;
        if (s.includes("evening")) return 2;
        return new Date().getHours();
      })();
      const cityHash = Array.from(String(city)).reduce((a, c) => a + c.charCodeAt(0), 0);
      const start = new Date(now.getFullYear(), 0, 0);
      const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
      const focus = focusPool[(cityHash + dayOfYear + slotIdx) % focusPool.length];
      focusBlock = `FOCUS ANGLE: Frame this post from a "${focus}" perspective. Do not default to a wide "beautiful day" overview.`;

      localVoiceBlock = `LOCAL VOICE:
Write like a local in ${city} speaking casually, not a weather report.
- Avoid formal phrases like "conditions remain", "forecast indicates", "expect", "anticipate".
- Prefer natural openers: "Looks like...", "Feels like...", "Heads up...", "You might notice...".
- Reference time naturally: "this afternoon", "later tonight", "heading into the evening".
- Conversational and slightly informal, still clear.

MICRO-LOCALIZATION (only when it fits naturally — never force):
- Hot/humid → hydration, AC, pool weather.
- Rain/storms → umbrella, wet commute, slick roads.
- Clear/mild → great night to get outside, sunset, evening plans.
- Cold/windy → layers, jacket weather.

OPENER VARIATION:
Do NOT always start with the city name ("${city}..."). Rotate among:
- Weather-first (e.g. "Clouds rolling in over ${city}...")
- Feeling-first (e.g. "Feels like a slow afternoon...")
- Situation-first (e.g. "Heads up if you're commuting home...")

HARD CONSTRAINTS (do not override):
- Keep within current length limits.
- Keep the CTA line exactly as required by CTA ROTATION above.
- Do not change title / body / hashtag block structure.`;

      // ── Growth Phase 1: Hook Aggression Layer ──
      const haHighTemp = Number(body.afternoon_temp ?? body.afternoonTemp ?? body.temperature ?? 0);
      const haMornTemp = Number(body.morning_temp ?? body.morningTemp ?? 0);
      const haEveTemp = Number(body.evening_temp ?? body.eveningTemp ?? 0);
      const haFeels = Number(body.feels_like ?? body.feelsLike ?? body.heat_index ?? body.heatIndex ?? 0);
      const haMornCond = String(body.morning_condition ?? body.morningCondition ?? "").toLowerCase();
      const haEveCond = String(body.evening_condition ?? body.eveningCondition ?? "").toLowerCase();

      const condFamily = (c: string) => {
        if (!c) return "";
        if (c.includes("storm") || c.includes("thunder")) return "storm";
        if (c.includes("rain") || c.includes("shower") || c.includes("drizzle")) return "rain";
        if (c.includes("snow") || c.includes("sleet") || c.includes("flurr")) return "snow";
        if (c.includes("cloud") || c.includes("overcast")) return "cloud";
        if (c.includes("clear") || c.includes("sun")) return "clear";
        if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return "fog";
        return c.split(/\s+/)[0] || "";
      };
      const haSwing = Math.abs(haEveTemp - haMornTemp) >= 10;
      const haFamilyShift =
        haMornCond && haEveCond && condFamily(haMornCond) !== condFamily(haEveCond);
      const haCuriosityTrigger = haSwing || haFamilyShift;

      const haParts: string[] = [
        "HOOK AGGRESSION LAYER (Growth Phase 1):",
        "- FIRST SENTENCE RULE: The opening sentence MUST be an INSTRUCTIONAL hook (lead with an action verb: \"Grab…\", \"Crank…\", \"Layer up…\") or a SITUATIONAL hook (\"If you're heading to…\", \"Heads up if you're…\"). Do NOT open with a data report. Human relatability outranks data reporting.",
      ];

      if (haHighTemp > 88 || haFeels > 95) {
        haParts.push(
          'HEAT ACTION REQUIRED: Open with a high-intensity action hook. Pick the tone of one of: "Crank the AC", "Pool day is on", "Hydrate early", "Find shade by noon". Do not copy verbatim — adapt to today\'s exact reading.',
        );
      } else if (haHighTemp > 0 && haHighTemp < 40) {
        haParts.push(
          'COLD ACTION REQUIRED: Open with a high-intensity action hook. Pick the tone of one of: "Layer up", "Warm the car early", "Bundle the kids". Adapt — do not copy verbatim.',
        );
      }

      if (haCuriosityTrigger) {
        haParts.push(
          `CURIOSITY GAP REQUIRED: Morning and evening diverge meaningfully today. Use this pattern once (paraphrased to fit the actual data): "Don't let the [morning weather] fool you, [evening weather] is coming." Use at most once.`,
        );
      } else {
        haParts.push(
          `CURIOSITY GAP (optional): If morning and evening conditions differ, you may use once: "Don't let the [morning weather] fool you, [evening weather] is coming."`,
        );
      }

      haParts.push(
        `LANDMARK CONTEXT INJECTION: When natural, place ONE landmark from VERIFIED LANDMARKS above into the first 3 seconds using the pattern: "If you're heading to [Landmark] today, heads up — …". One landmark max per caption. Never invent a landmark.`,
      );

      hookAggressionBlock = haParts.join("\n");
    } catch (err) {
      console.warn("Caption enhancement failed — falling back to default logic", err);
      personalityBlock = "";
      ctaBlock = "";
      antiRepeatBlock = "";
      diversityBlock = "";
      focusBlock = "";
      localVoiceBlock = "";
      hookAggressionBlock = "";
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

${buildCityVisualBlock(city)}

${buildLocalIdentityBlock(city)}

${styleAddendum}${insightNote}

${hookAggressionBlock}

${diversityBlock}

${focusBlock}

${localVoiceBlock}

${personalityBlock}

${ctaBlock}${antiRepeatBlock ? `\n\n${antiRepeatBlock}` : ""}`;

    const cityScopeDirective = `\n\nSTRICT CITY SCOPE: You are generating content EXCLUSIVELY for ${city}${body.state_or_region || body.stateOrRegion ? ", " + (body.state_or_region || body.stateOrRegion) : ""}. Do NOT mention any other city, region, or social handle. The ONLY @handle allowed is ${handle}. Never output @SkyBriefGNV, @SkyBriefMiami, @SkyBriefOrlando, @SkyBriefTampa or any other variant unless it exactly equals ${handle}. Do NOT include subscribe URLs for other channels.`;

    // Phase 1 Growth Loop — inject directional performance guidance.
    let performanceBlock = "";
    try {
      const { loadCityPerformanceInsights, formatPerformanceGuidanceBlock } = await import("../_shared/performance-insights.ts");
      const svcForInsights = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const platformForInsights = ((body as any).platform || "youtube").toString().toLowerCase();
      const insights = await loadCityPerformanceInsights(svcForInsights, { city, platform: platformForInsights });
      if (insights) {
        performanceBlock = `\n\n${formatPerformanceGuidanceBlock(insights)}`;
        console.log(`[analytics] injecting performance guidance into title generation city=${city} platform=${platformForInsights} sampleSize=${insights.sampleSize}`);
      }
    } catch (e) {
      console.warn("[analytics] performance guidance injection skipped:", e instanceof Error ? e.message : e);
    }

    const systemPrompt = `${SKYBRIEF_SYSTEM_PROMPT}\n\n${LOCATION_ACCURACY_RULES}${cityScopeDirective}${performanceBlock}`;

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
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add funds in your workspace settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
    caption = cleanWeatherPhrasing(caption);
    caption = fixInvalidLocation(caption, city);
    caption = forceCitySanity(caption, city);

    // GLOBAL PROXY REPLACEMENT — final guard, CONTEXT-BOUND.
    // Only replaces blacklist terms when they appear in CTA/location slots
    // or as hashtags. Descriptive narration (e.g. "clear skies over the bay")
    // is intentionally left alone.
    {
      const BLACKLIST = [
        "Not Need", "Weather Update", "Coming Up", "But Comfortable", "Clear Skies",
        "Sunny", "Cloudy", "Overcast", "Rainy", "Stormy", "Foggy", "Windy", "Humid",
        "Hot", "Cold", "Warm", "Cool", "Mild", "Breezy",
        "Partly Cloudy", "Mostly Cloudy", "Mostly Sunny", "Partly Sunny",
        "Scattered Showers", "Thunderstorms", "Drizzle", "Light Rain", "Heavy Rain",
        "Snow", "Sleet", "Haze", "Mist", "Hazy", "Showers",
        "Afternoon", "Morning", "Evening", "Tonight", "Today", "Ahead", "Update"
      ];
      const cityNoSpaces = city.replace(/\s+/g, "");
      const blacklistHits: string[] = [];

      for (const term of BLACKLIST) {
        const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Allow any (or no) whitespace between the words of the blacklisted term
        // so "Weather Update", "WeatherUpdate", and "Weather  Update" all match.
        const escFlex = esc.replace(/\s+/g, "\\s*");
        const noSpace = term.replace(/\s+/g, "");
        const escNoSpace = noSpace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const ctaPatterns: Array<{ re: RegExp; sub: string }> = [
          { re: new RegExp(`\\benjoying the weather in ${escFlex}(?=[^a-zA-Z]|$)`, "gi"), sub: `enjoying the weather in ${city}` },
          { re: new RegExp(`\\bweather in ${escFlex}(?=[^a-zA-Z]|$)`, "gi"), sub: `weather in ${city}` },
          { re: new RegExp(`\\bdaily ${escFlex} weather alerts(?=[^a-zA-Z]|$)`, "gi"), sub: `daily ${city} weather alerts` },
          { re: new RegExp(`\\bdaily ${escFlex} updates(?=[^a-zA-Z]|$)`, "gi"), sub: `daily ${city} updates` },
          { re: new RegExp(`\\bfollow for ${escFlex} updates(?=[^a-zA-Z]|$)`, "gi"), sub: `follow for ${city} updates` },
          { re: new RegExp(`\\bsubscribe for ${escFlex} weather alerts(?=[^a-zA-Z]|$)`, "gi"), sub: `subscribe for ${city} weather alerts` },
        ];
        for (const { re, sub } of ctaPatterns) {
          if (re.test(caption)) {
            blacklistHits.push(`${term} (cta)`);
            console.log(`[generate-caption] blacklist CTA sanitized term="${term}" city="${city}"`);
            caption = caption.replace(re, sub);
          }
        }

        const tagRe = new RegExp(`#${escNoSpace}\\b`, "gi");
        if (tagRe.test(caption)) {
          blacklistHits.push(`${term} (hashtag)`);
          console.log(`[generate-caption] blacklist hashtag sanitized term="${term}" city="${city}"`);
          caption = caption.replace(tagRe, `#${cityNoSpaces}`);
        }
      }

      caption = caption
        .replace(new RegExp(`##+${cityNoSpaces}`, "gi"), `#${cityNoSpaces}`)
        .replace(new RegExp(`#\\s+${cityNoSpaces}`, "gi"), `#${cityNoSpaces}`);

      if (blacklistHits.length > 0) {
        console.warn(`[generate-caption] blacklist proxy terms replaced for ${city}:`, blacklistHits);
        try {
          const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
          await svc.from("system_logs").insert({
            user_id: auth.userId,
            type: "caption_blacklist_sanitized",
            message: `Replaced proxy term(s) ${blacklistHits.join(", ")} → ${city}`,
            context: { city, hits: blacklistHits },
          });
        } catch {
          /* best-effort */
        }
      }
    }
    // City-handle sanitizer: replace any @SkyBrief* token that doesn't match
    // the dynamic handle for this city. Prevents Orlando captions ending with
    // "Follow @SkyBriefGNV" because the model recalled stale brand strings.
    try {
      const handleRe = /@SkyBrief[A-Za-z0-9_]+/g;
      const foreign: string[] = [];
      caption = caption.replace(handleRe, (m) => {
        if (m === handle) return m;
        foreign.push(m);
        return handle;
      });
      if (foreign.length > 0) {
        console.warn(`[generate-caption] foreign @SkyBrief handle(s) replaced for ${city}:`, foreign);
        try {
          const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
          await svc.from("system_logs").insert({
            user_id: auth.userId,
            type: "caption_handle_sanitized",
            message: `Replaced foreign @SkyBrief handle(s) ${foreign.join(", ")} → ${handle} for city ${city}`,
            context: { city, expected_handle: handle, foreign },
          });
        } catch {
          /* best-effort */
        }
      }
    } catch (e) {
      console.warn("[generate-caption] handle sanitizer failed:", e);
    }
    // Prepend (or replace) a city-local timestamp stamp on the first line.
    // Format: `📍 ${city} · ${H AM/PM} Update`. Fails silently if anything throws.
    try {
      const slotForBeacon = body.slot ?? period;
      const stamp = slotForBeacon ? slotDisplayLabel(slotForBeacon) : getCityLocalStamp(city);
      const stampLine = `📍 ${city} · ${stamp} Update`;
      const lines = caption.split(/\r?\n/);
      const firstIdx = lines.findIndex((l) => l.trim().length > 0);
      if (firstIdx >= 0 && /^\s*📍/.test(lines[firstIdx])) {
        lines[firstIdx] = stampLine;
        caption = lines.join("\n");
      } else {
        caption = `${stampLine}\n\n${caption.replace(/^\s+/, "")}`;
      }
    } catch (e) {
      console.warn("[generate-caption] timestamp stamp failed:", e);
    }

    return new Response(JSON.stringify({ caption, ai_optimized: aiOptimized }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("generate-caption error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

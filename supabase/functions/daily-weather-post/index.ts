import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface WeatherResponse {
  city: string;
  temperature: number;
  condition: string;
  description: string;
  morningTemp: number | null;
  morningCondition: string | null;
  afternoonTemp: number | null;
  afternoonCondition: string | null;
  eveningTemp: number | null;
  eveningCondition: string | null;
  rainChance: number;
  windInfo: string;
  sunrise: string;
  sunset: string;
  stateOrRegion: string;
}

async function fetchWeatherData(city: string, apiKey: string): Promise<WeatherResponse> {
  const geoRes = await fetch(
    `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`
  );
  const geoData = await geoRes.json();
  if (!geoData.length) throw new Error(`Location not found: ${city}`);

  const { lat, lon, name, country, state } = geoData[0];

  const [currentRes, forecastRes] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`),
  ]);

  const current = await currentRes.json();
  const forecast = await forecastRes.json();

  const now = new Date();
  const todayStr = now.toDateString();
  let morningTemp: number | null = null;
  let morningCondition: string | null = null;
  let afternoonTemp: number | null = null;
  let afternoonCondition: string | null = null;
  let eveningTemp: number | null = null;
  let eveningCondition: string | null = null;
  let maxPop = 0;

  for (const item of forecast.list) {
    const dt = new Date(item.dt * 1000);
    if (dt.toDateString() !== todayStr) continue;
    const hour = dt.getHours();
    const temp = Math.round(item.main.temp);
    const cond = item.weather[0].main;
    if (item.pop != null && item.pop > maxPop) maxPop = item.pop;

    if (hour >= 6 && hour < 12 && morningTemp === null) {
      morningTemp = temp; morningCondition = cond;
    } else if (hour >= 12 && hour < 18 && afternoonTemp === null) {
      afternoonTemp = temp; afternoonCondition = cond;
    } else if (hour >= 18 && eveningTemp === null) {
      eveningTemp = temp; eveningCondition = cond;
    }
  }

  if (morningTemp === null && afternoonTemp === null && eveningTemp === null) {
    const h = now.getHours();
    const t = Math.round(current.main.temp);
    const c = current.weather[0].main;
    if (h < 12) { morningTemp = t; morningCondition = c; }
    else if (h < 18) { afternoonTemp = t; afternoonCondition = c; }
    else { eveningTemp = t; eveningCondition = c; }
  }

  const sunriseDate = new Date(current.sys.sunrise * 1000);
  const sunsetDate = new Date(current.sys.sunset * 1000);
  const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  return {
    city: name,
    temperature: Math.round(current.main.temp),
    condition: current.weather[0].main,
    description: current.weather[0].description,
    morningTemp, morningCondition,
    afternoonTemp, afternoonCondition,
    eveningTemp, eveningCondition,
    rainChance: Math.round(maxPop * 100),
    windInfo: `${Math.round(current.wind.speed)} mph${current.wind.gust ? `, gusts ${Math.round(current.wind.gust)} mph` : ""}`,
    sunrise: fmt(sunriseDate),
    sunset: fmt(sunsetDate),
    stateOrRegion: state || country || "",
  };
}

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

function getHabitCTA(city: string): string {
  const handle = getDynamicHandle(city);
  const ctas = [
    `Follow ${handle} for tomorrow's forecast`,
    `Tomorrow's forecast drops at ${handle}`,
    `Daily weather every morning at ${handle}`,
    `Check back tomorrow on ${handle}`,
  ];
  const dayIndex = new Date().getDay();
  return ctas[dayIndex % ctas.length];
}

// --- Caption Prompt ---

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

CAPTION STRUCTURE:
Generate captions using this format:
Line 1: City + "Weather" + date or "Today"
Line 2: Morning forecast in a few words with temp
Line 3: Afternoon forecast in a few words with temp
Line 4: Evening forecast in a few words with temp
Line 5: Rain chance
Line 6: "What to know:" followed by 2-3 short bullet-style points
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

Return only the finished caption. No labels, no quotes.`;

function buildSkyBriefUserPrompt(weather: WeatherResponse): string {
  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const handle = getDynamicHandle(weather.city);
  return \`city: \${weather.city}
state_or_region: \${weather.stateOrRegion}
date: \${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
day_of_week: \${dayNames[now.getDay()]}
morning_temp: \${weather.morningTemp ?? "N/A"}
morning_condition: \${weather.morningCondition ?? "N/A"}
afternoon_temp: \${weather.afternoonTemp ?? "N/A"}
afternoon_condition: \${weather.afternoonCondition ?? "N/A"}
evening_temp: \${weather.eveningTemp ?? "N/A"}
evening_condition: \${weather.eveningCondition ?? "N/A"}
rain_chance: \${weather.rainChance}%
wind_info: \${weather.windInfo}
severe_alerts: None
sunrise_time: \${weather.sunrise}
sunset_time: \${weather.sunset}
dynamic_handle: \${handle}
extra_note: \`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const userPrompt = `NOW USE THESE INPUTS TO WRITE TODAY'S CAPTION:

city: ${city}
state_or_region: ${body.state_or_region || body.stateOrRegion || ""}
date: ${body.date || now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
day_of_week: ${body.day_of_week || dayNames[now.getDay()]}
morning_temp: ${body.morning_temp ?? body.morningTemp ?? "N/A"}
morning_condition: ${body.morning_condition ?? body.morningCondition ?? "N/A"}
afternoon_temp: ${body.afternoon_temp ?? body.afternoonTemp ?? "N/A"}
afternoon_condition: ${body.afternoon_condition ?? body.afternoonCondition ?? "N/A"}
evening_temp: ${body.evening_temp ?? body.eveningTemp ?? "N/A"}
evening_condition: ${body.evening_condition ?? body.eveningCondition ?? "N/A"}
rain_chance: ${body.rain_chance ?? body.rainChance ?? "N/A"}%
wind_info: ${body.wind_info ?? body.windInfo ?? "N/A"}
severe_alerts: ${body.severe_alerts ?? body.severeAlerts ?? "None"}
sunrise_time: ${body.sunrise_time ?? body.sunrise ?? "N/A"}
sunset_time: ${body.sunset_time ?? body.sunset ?? "N/A"}
dynamic_handle: ${handle}
extra_note: ${body.extra_note ?? body.extraNote ?? ""}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SKYBRIEF_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      }),
    });

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

    const data = await response.json();
    const caption = data.choices?.[0]?.message?.content?.trim() || "";

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

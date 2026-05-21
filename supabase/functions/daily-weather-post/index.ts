import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStyleAddendum, normalizeTone, appendVoiceCTA, isWeatherAlert, titleHasTimestamp, ensureSlotTitlePrefix, slotTimePrefix, assertSlotTitlePrefix } from "../_shared/caption-style.ts";
import {
  LOCATION_ACCURACY_RULES,
  buildVerifiedLandmarksBlock,
  buildCityVisualBlock,
  buildLocalIdentityBlock,
  validateCaptionLocation,
  stripUnverifiedReferences,
} from "../_shared/location-guard.ts";
import { generateVideoWithFallback } from "../_shared/video-render.ts";
import { verifyUser } from "../_shared/auth-helpers.ts";

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
  tomorrowHigh: number | null;
  tomorrowLow: number | null;
  tomorrowCondition: string | null;
}

async function fetchWeatherData(city: string, apiKey: string): Promise<WeatherResponse> {
  const geoRes = await fetch(
    "https://api.openweathermap.org/geo/1.0/direct?q=" + encodeURIComponent(city) + "&limit=1&appid=" + apiKey
  );
  const geoData = await geoRes.json();
  if (!geoData.length) throw new Error("Location not found: " + city);

  const { lat, lon, name, country, state } = geoData[0];

  const [currentRes, forecastRes] = await Promise.all([
    fetch("https://api.openweathermap.org/data/2.5/weather?lat=" + lat + "&lon=" + lon + "&units=imperial&appid=" + apiKey),
    fetch("https://api.openweathermap.org/data/2.5/forecast?lat=" + lat + "&lon=" + lon + "&units=imperial&appid=" + apiKey),
  ]);

  const current = await currentRes.json();
  const forecast = await forecastRes.json();

  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrowDate = new Date(now);
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toDateString();

  let morningTemp: number | null = null;
  let morningCondition: string | null = null;
  let afternoonTemp: number | null = null;
  let afternoonCondition: string | null = null;
  let eveningTemp: number | null = null;
  let eveningCondition: string | null = null;
  let maxPop = 0;
  const tomorrowTemps: number[] = [];
  let tomorrowCondition: string | null = null;

  for (const item of forecast.list) {
    const dt = new Date(item.dt * 1000);
    const dtStr = dt.toDateString();

    if (dtStr === todayStr) {
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

    if (dtStr === tomorrowStr) {
      tomorrowTemps.push(Math.round(item.main.temp));
      if (!tomorrowCondition) tomorrowCondition = item.weather[0].main;
    }
  }

  // Step 2: Fill gaps from tomorrow's forecast
  for (const item of forecast.list) {
    const dt = new Date(item.dt * 1000);
    if (dt.toDateString() !== tomorrowStr) continue;
    const hour = dt.getHours();
    const temp = Math.round(item.main.temp);
    const cond = item.weather[0].main;

    if (hour >= 6 && hour < 12 && morningTemp === null) {
      morningTemp = temp; morningCondition = cond;
    } else if (hour >= 12 && hour < 18 && afternoonTemp === null) {
      afternoonTemp = temp; afternoonCondition = cond;
    } else if (hour >= 18 && eveningTemp === null) {
      eveningTemp = temp; eveningCondition = cond;
    }
  }

  // Step 3: Fill any remaining nulls with current weather as estimate
  const currentTemp = Math.round(current.main.temp);
  const currentCond = current.weather[0].main;
  if (morningTemp === null) { morningTemp = currentTemp; morningCondition = currentCond; }
  if (afternoonTemp === null) { afternoonTemp = currentTemp; afternoonCondition = currentCond; }
  if (eveningTemp === null) { eveningTemp = currentTemp; eveningCondition = currentCond; }

  const tomorrowHigh = tomorrowTemps.length ? Math.max(...tomorrowTemps) : null;
  const tomorrowLow = tomorrowTemps.length ? Math.min(...tomorrowTemps) : null;

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
    windInfo: Math.round(current.wind.speed) + " mph" + (current.wind.gust ? ", gusts " + Math.round(current.wind.gust) + " mph" : ""),
    sunrise: fmt(sunriseDate),
    sunset: fmt(sunsetDate),
    stateOrRegion: state || country || "",
    tomorrowHigh, tomorrowLow, tomorrowCondition,
  };
}

// --- SkyBrief Title Generator ---

function getWeatherEmoji(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes("thunder") || c.includes("storm")) return "⛈";
  if (c.includes("snow") || c.includes("sleet") || c.includes("blizzard")) return "❄️";
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) return "🌧";
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return "🌫";
  if (c.includes("cloud") || c.includes("overcast")) return "☁️";
  if (c.includes("partly") || c.includes("scatter")) return "🌤";
  return "☀️";
}

function generateSkyBriefTitle(city: string, temp: number, condition: string, rainChance?: number, slot?: string | null): string {
  return buildHookTitle(city, temp, condition, rainChance, slot);
}

// --- Hook-based YouTube title generator ---
// Format: [Hook] + City + Weather Detail + Emoji. Drives CTR via curiosity + specificity.
function buildHookTitle(city: string, temp: number, condition: string, rainChance?: number, slot?: string | null): string {
  const emoji = getWeatherEmoji(condition);
  const c = (condition || "").toLowerCase();
  const t = Math.round(temp);
  const hour = new Date().getHours();
  const isMorning = hour >= 4 && hour < 11;
  const isEvening = hour >= 17 || hour < 4;
  const isStorm = /thunder|storm|tornado|hurricane/i.test(c);
  const isRain = /rain|drizzle|shower/.test(c);
  const isSnow = /snow|sleet|blizzard/.test(c);
  const isFog = /fog|mist|haze/.test(c);
  const isCloudy = /cloud|overcast/.test(c);
  const isPartly = /partly|scatter/.test(c);
  const isClear = /clear|sun/.test(c) || (!isCloudy && !isRain && !isStorm && !isSnow && !isFog && !isPartly);

  const pool: string[] = [];

  if (isStorm || (rainChance != null && rainChance >= 70)) {
    pool.push(`Storms Rolling Into ${city} ⛈ ${t}° Today`);
    pool.push(`Heads Up ${city} — Storms On The Way ⛈ Forecast`);
    pool.push(`Don't Skip The Umbrella Today ☔ ${city} Weather`);
  } else if (isRain || (rainChance != null && rainChance >= 50)) {
    pool.push(`Grab An Umbrella ☔ ${city} Weather Today`);
    pool.push(`Wet Day Ahead In ${city} 🌧 ${t}° Forecast`);
    pool.push(`Rain On The Radar 🌧 ${city} Weather Update`);
  } else if (isSnow) {
    pool.push(`Bundle Up ${city} ❄️ ${t}° And Snowy`);
    pool.push(`Snowy Skies Ahead ❄️ ${city} Forecast Today`);
  } else if (isFog) {
    pool.push(`Foggy Start In ${city} 🌫 ${t}° Today`);
    pool.push(`Drive Slow This Morning 🌫 ${city} Forecast`);
  }

  if (t >= 90) {
    pool.push(`Hot Day Ahead 🔥 ${city} Hits ${t}° Today`);
    pool.push(`Crank The AC ${city} 🔥 ${t}° Incoming`);
  } else if (t >= 85) {
    pool.push(`Feels Like Summer Already In ${city} ☀️ ${t}° Today`);
    pool.push(`Warm One Coming Up 🌞 ${city} Hits ${t}°`);
  } else if (t >= 70 && (isClear || isPartly)) {
    pool.push(`Beautiful Day In ${city} ${emoji} ${t}° And Comfortable`);
    pool.push(`You Might Not Need A Jacket Today 👀 ${city} Forecast`);
  } else if (t >= 55 && t < 70) {
    pool.push(`Mild & Comfy In ${city} ${emoji} ${t}° Today`);
    pool.push(`Cool Start, Nice Finish ${emoji} ${city} Weather Today`);
  } else if (t >= 40 && t < 55) {
    pool.push(`Chilly Morning In ${city} 🧥 ${t}° Today`);
    pool.push(`Grab A Jacket ${city} 🧥 ${t}° Forecast`);
  } else if (t < 40) {
    pool.push(`Cold Front Hits ${city} 🥶 Just ${t}° Today`);
    pool.push(`Bundle Up ${city} 🥶 ${t}° And Chilly`);
  }

  if (isCloudy && !isRain && !isStorm) {
    pool.push(`Gray Skies But Comfortable ☁️ ${city} Weather Today`);
    pool.push(`Cloudy Start, Warm Finish 🌤 ${city} Weather Today`);
  }
  if (isClear && !pool.length) {
    pool.push(`Beautiful Clear Skies ☀️ ${city} Forecast Today`);
  }
  if (isPartly) {
    pool.push(`Sun & Clouds Mix 🌤 ${city} Weather Today`);
  }

  if (isEvening) {
    pool.push(`Tonight's Weather Update 🌙 ${city} Forecast`);
    pool.push(`Calm & Clear Skies Ahead 🌙 ${city} Evening Weather`);
  } else if (isMorning) {
    pool.push(`Good Morning ${city} ☕ ${t}° To Start The Day`);
  }

  if (!pool.length) {
    pool.push(`${city} Weather Today ${emoji} ${t}° ${condition}`);
  }

  const seed = new Date().getDate() * 24 + hour;
  const baseTitle = pool[seed % pool.length];
  // Always force one of the three SkyBrief broadcast slot prefixes
  // ([8 AM]/[1 PM]/[6 PM]). Default to "morning" — this function is the morning
  // automated job, but callers may override via the slot arg.
  try {
    const result = ensureSlotTitlePrefix(baseTitle, slot || "morning", city);
    assertSlotTitlePrefix(result, "daily-weather-post:buildHookTitle");
    return result;
  } catch (err) {
    console.warn("buildHookTitle: ensureSlotTitlePrefix failed, applying hard fallback prefix", err);
    const prefix = `[${slotTimePrefix(slot || "morning", city)}] `;
    const budget = Math.max(1, 95 - prefix.length);
    const body = baseTitle.length > budget ? baseTitle.substring(0, budget - 1) + "…" : baseTitle;
    const result = prefix + body;
    assertSlotTitlePrefix(result, "daily-weather-post:buildHookTitle:fallback");
    return result;
  }
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
  return "@SkyBrief" + cleaned;
}

function getHabitCTA(city: string): string {
  const handle = getDynamicHandle(city);
  const ctas = [
    "Follow " + handle + " for tomorrow's forecast",
    "Tomorrow's forecast drops at " + handle,
    "Daily weather every morning at " + handle,
    "Check back tomorrow on " + handle,
  ];
  const dayIndex = new Date().getDay();
  return ctas[dayIndex % ctas.length];
}

// --- Caption Prompt ---

const SKYBRIEF_SYSTEM_PROMPT = [
  "You are the caption-writing engine for a social media weather brand called SkyBrief.",
  "",
  "BRAND IDENTITY:",
  "SkyBrief is a clean, fast, local daily weather brand for Instagram and TikTok.",
  "Its job is to make people understand today's weather in their city in seconds.",
  "The tone is simple, reliable, human, local, and scroll-friendly.",
  "Do NOT sound like a government weather report.",
  "Do NOT sound overly corporate, technical, or dramatic.",
  "Do NOT use long paragraphs.",
  "Do NOT use clickbait.",
  "Do NOT use slang that feels forced.",
  "",
  "WRITING STYLE:",
  "- Keep captions short and highly readable",
  "- Use plain English",
  "- Sound confident, helpful, and local",
  "- Make the weather feel relevant to the person's actual day",
  "- Prioritize clarity over creativity",
  "- Use light personality, but never become cheesy",
  "- Make each caption feel like a quick daily brief",
  "- Optimize for mobile reading",
  "",
  "CAPTION STRUCTURE:",
  "Line 1: City + \"Weather\" + date or \"Today\"",
  "Line 2: Morning forecast in a few words with temp",
  "Line 3: Afternoon forecast in a few words with temp",
  "Line 4: Evening forecast in a few words with temp",
  "Line 5: Rain chance",
  "Line 6: \"What to know:\" followed by 2-3 short bullet-style points",
  "Final line: A habit-forming CTA using the provided dynamic_handle",
  "",
  "STYLE RULES:",
  "- Keep total caption under 120 words",
  "- Use emojis sparingly (0-4 max), only weather emojis",
  "- Include a practical takeaway",
  "- If severe weather, shift to calm, clear, alert tone",
  "- Never exaggerate risk",
  "- Never include hashtags unless explicitly requested",
  "- Never write more than one CTA",
  "- The final CTA line MUST use the exact dynamic_handle provided",
  "",
  "BRAND CONSISTENCY RULES:",
  "- Every caption should feel like part of the same brand system",
  "- Keep formatting consistent across posts",
  "- Vary wording slightly, but keep the structure familiar",
  "- The brand voice should feel local, useful, and clean",
  "- Write like a dependable local weather page, not a news anchor and not a meme page",
  "- Make the caption useful even if someone only reads the first 3 lines",
  "",
  "Return only the finished caption. No labels, no quotes.",
].join("\n");

function buildSkyBriefUserPrompt(weather: WeatherResponse, timePeriod?: string | null): string {
  const now = new Date();
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const handle = getDynamicHandle(weather.city);
  const alertLine = getAlertLine(weather);
  const tomorrowPrev = getTomorrowPreview(weather);
  const periodLabel = timePeriod === "morning" ? "Morning Update" : timePeriod === "afternoon" ? "Afternoon Update" : timePeriod === "evening" ? "Evening Update" : "Full Day";
  const lines = [
    "city: " + weather.city,
    "state_or_region: " + weather.stateOrRegion,
    "date: " + now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    "day_of_week: " + dayNames[now.getDay()],
    "time_period: " + periodLabel,
    "morning_temp: " + (weather.morningTemp ?? "N/A"),
    "morning_condition: " + (weather.morningCondition ?? "N/A"),
    "afternoon_temp: " + (weather.afternoonTemp ?? "N/A"),
    "afternoon_condition: " + (weather.afternoonCondition ?? "N/A"),
    "evening_temp: " + (weather.eveningTemp ?? "N/A"),
    "evening_condition: " + (weather.eveningCondition ?? "N/A"),
    "rain_chance: " + weather.rainChance + "%",
    "wind_info: " + weather.windInfo,
    "alert_line: " + (alertLine || "None"),
    "tomorrow_preview: " + tomorrowPrev,
    "sunrise_time: " + weather.sunrise,
    "sunset_time: " + weather.sunset,
    "dynamic_handle: " + handle,
    "extra_note: " + (timePeriod ? "Focus the caption on the " + timePeriod + " forecast. Lead with the " + timePeriod + " conditions." : ""),
  ];
  return lines.join("\n");
}

// --- Platform Adapters (shared) ---
import { postToPlatform, getConnectedAdapters } from "../_shared/platform-adapter.ts";

// --- Creatomate Video Generation ---

interface WeatherTheme {
  bg1: string; bg2: string; accent: string;
  glow1: string; glow2: string; emoji: string;
  videoKeyword: string;
}

function getWeatherTheme(condition: string): WeatherTheme {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle")) return { bg1: "#0a1628", bg2: "#152238", accent: "#60a5fa", glow1: "rgba(96,165,250,0.10)", glow2: "rgba(59,130,246,0.06)", emoji: "\u{1F327}\u{FE0F}", videoKeyword: "rain window dark moody" };
  if (c.includes("thunder") || c.includes("storm")) return { bg1: "#110820", bg2: "#1e1038", accent: "#a78bfa", glow1: "rgba(167,139,250,0.10)", glow2: "rgba(139,92,246,0.06)", emoji: "\u{26C8}\u{FE0F}", videoKeyword: "lightning storm dark sky" };
  if (c.includes("snow")) return { bg1: "#0c1524", bg2: "#162340", accent: "#93c5fd", glow1: "rgba(147,197,253,0.10)", glow2: "rgba(191,219,254,0.06)", emoji: "\u{2744}\u{FE0F}", videoKeyword: "snow falling slow motion" };
  if (c.includes("cloud") || c.includes("overcast")) return { bg1: "#0e1420", bg2: "#1a2030", accent: "#94a3b8", glow1: "rgba(148,163,184,0.08)", glow2: "rgba(100,116,139,0.05)", emoji: "\u{2601}\u{FE0F}", videoKeyword: "clouds sky timelapse moody" };
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return { bg1: "#12121e", bg2: "#1e1e30", accent: "#a1a1aa", glow1: "rgba(161,161,170,0.08)", glow2: "rgba(113,113,122,0.05)", emoji: "\u{1F32B}\u{FE0F}", videoKeyword: "fog mist morning forest" };
  return { bg1: "#0a1020", bg2: "#14203a", accent: "#fbbf24", glow1: "rgba(251,191,36,0.08)", glow2: "rgba(245,158,11,0.05)", emoji: "\u{2600}\u{FE0F}", videoKeyword: "blue sky sun golden hour" };
}

function getPracticalTakeaway(weather: WeatherResponse): string {
  const c = weather.condition.toLowerCase();
  const temp = weather.temperature;
  const rain = weather.rainChance;
  if (c.includes("thunder") || c.includes("storm")) return "Stay indoors if possible";
  if (rain >= 70) return "Bring an umbrella today";
  if (rain >= 40) return "Rain possible later";
  if (c.includes("snow")) return "Bundle up and drive safe";
  if (c.includes("fog") || c.includes("mist")) return "Low visibility this morning";
  if (temp >= 95) return "Stay hydrated today";
  if (temp >= 85) return "Hot and humid today";
  if (temp >= 80 && c.includes("clear")) return "Great day to be outside";
  if (temp >= 70) return "Comfortable all day";
  if (temp >= 50) return "Grab a jacket for later";
  if (temp < 32) return "Below freezing — dress warm";
  if (temp < 50) return "Chilly — layer up today";
  return "Comfortable all day";
}

function getAlertLine(weather: WeatherResponse): string | null {
  const c = weather.condition.toLowerCase();
  const temp = weather.temperature;
  const rain = weather.rainChance;
  const windNum = parseInt(weather.windInfo);
  if (c.includes("hurricane")) return "ALERT: Hurricane conditions — take shelter and follow local guidance";
  if (c.includes("tornado")) return "ALERT: Tornado warning — seek shelter immediately";
  if (c.includes("blizzard")) return "ALERT: Blizzard conditions — avoid travel if possible";
  if (c.includes("thunder") || c.includes("storm")) return "ALERT: Storms possible this afternoon";
  if (rain > 50 && (c.includes("rain") || c.includes("drizzle"))) return "ALERT: Heavy rain expected";
  if (windNum > 20) return "ALERT: Strong winds this afternoon";
  if (temp > 100) return "ALERT: Dangerous heat — stay hydrated and limit outdoor exposure";
  if (temp > 95) return "ALERT: Extreme heat today";
  if (temp < 35) return "ALERT: Near-freezing temperatures";
  return null;
}

function getTomorrowPreview(weather: WeatherResponse): string {
  if (!weather.tomorrowCondition) return "Tomorrow: check back for updates";
  const c = weather.tomorrowCondition.toLowerCase();
  const tempDiff = weather.tomorrowHigh != null ? weather.tomorrowHigh - weather.temperature : 0;
  let trend = "";
  if (tempDiff > 5) trend = "warmer";
  else if (tempDiff < -5) trend = "cooler";
  else trend = "similar temps";

  if (c.includes("clear") || c.includes("sun")) return "Tomorrow: " + trend + " and sunny";
  if (c.includes("cloud")) return "Tomorrow: " + trend + " with clouds";
  if (c.includes("rain") || c.includes("drizzle")) return "Tomorrow: " + trend + " with rain";
  if (c.includes("storm") || c.includes("thunder")) return "Tomorrow: storms possible again";
  if (c.includes("snow")) return "Tomorrow: snow chances return";
  return "Tomorrow: " + trend + " and " + c.toLowerCase();
}

// Curated, weather-only Pexels search. NEVER uses city/landmark/region terms —
// those caused wrong-location footage (e.g. Texas stadiums for Florida cities).
// Atmosphere clips only: sky, rain, clouds, storms, snow, fog, wind.
async function fetchPexelsVideoUrl(keyword: string, _city?: string, _region?: string): Promise<string | null> {
  const pexelsKey = Deno.env.get("PEXELS_API_KEY");
  if (!pexelsKey) { console.log("PEXELS_API_KEY not configured, skipping stock video"); return null; }

  async function searchPexels(query: string): Promise<string | null> {
    const url = "https://api.pexels.com/videos/search?query=" + encodeURIComponent(query) + "&per_page=15&orientation=portrait&size=medium";
    console.log("[bg] Pexels (weather-only) query:", query);
    const res = await fetch(url, { headers: { Authorization: pexelsKey } });
    if (!res.ok) { console.error("Pexels API error:", res.status); return null; }
    const data = await res.json();
    const videos = data.videos || [];
    if (!videos.length) return null;
    const video = videos[Math.floor(Math.random() * videos.length)];
    const files = video.video_files || [];
    const hdFile = files.find((f: any) => f.quality === "hd" && f.width >= 1440)
      || files.find((f: any) => f.quality === "hd" && f.width >= 1080)
      || files.find((f: any) => f.quality === "hd")
      || files.find((f: any) => f.quality === "sd")
      || files[0];
    if (hdFile?.link) { console.log("[bg] selected:", hdFile.link.substring(0, 80)); return hdFile.link; }
    return null;
  }

  // Generic weather-atmosphere library (NO locations, NO landmarks).
  const atmosphereLibrary: Record<string, string[]> = {
    sunny:  ["bright blue sky clouds timelapse", "sunshine blue sky", "sun rays clear sky"],
    clear:  ["clear blue sky timelapse", "sunrise sky clouds", "blue sky white clouds"],
    cloudy: ["overcast cloudy sky timelapse", "grey clouds moving sky", "cloudy sky"],
    rain:   ["rain on window closeup", "wet street rain", "raindrops puddle"],
    storm:  ["thunderstorm lightning sky", "dark storm clouds timelapse", "lightning night sky"],
    snow:   ["snow falling closeup", "snowfall winter sky", "snowflakes slow motion"],
    fog:    ["fog mist morning", "foggy atmosphere", "misty fog timelapse"],
    wind:   ["wind blowing trees", "windy sky clouds fast", "leaves blowing wind"],
  };

  const k = (keyword || "").toLowerCase();
  const matchedKey = Object.keys(atmosphereLibrary).find((key) => k.includes(key)) || "clear";
  const queries = atmosphereLibrary[matchedKey];
  console.log(`[bg] weather-only mode | condition=${matchedKey} (ignored city/region to prevent wrong-location footage)`);

  try {
    // Try the curated weather queries in random order; fall back to generic sky.
    const shuffled = [...queries].sort(() => Math.random() - 0.5);
    for (const q of shuffled) {
      const result = await searchPexels(q);
      if (result) return result;
    }
    return await searchPexels("sky clouds timelapse");
  } catch (err) { console.error("Pexels fetch error:", err); return null; }
}

// =============================================================
// === AI VOICE NARRATION (Voice Script + ElevenLabs TTS) ====
// =============================================================

interface VoiceOptions {
  enabled: boolean;
  voiceId?: string;       // ElevenLabs voice id
  tone?: "conversational" | "energetic" | "news" | string;
}

// ElevenLabs preset voice IDs (verified from their public voice library)
const ELEVENLABS_VOICES: Record<string, string> = {
  female: "EXAVITQu4vr4xnSDxMaL",   // Sarah - warm, conversational female
  male:   "JBFqnCBsd6RMkjVDRZzb",   // George - confident male
};

function resolveVoiceId(input?: string): string {
  if (!input) return ELEVENLABS_VOICES.female;
  if (input === "female" || input === "male") return ELEVENLABS_VOICES[input];
  return input; // assume raw voice id
}

function voiceSettingsForTone(tone?: string) {
  // Speeds default to 1.05–1.10× across the board: adds "news anchor" energy
  // and shaves 1–2s off total runtime so the spoken CTA always lands before
  // the video clip ends. Speed is clamped server-side to [0.7, 1.2].
  switch (tone) {
    case "energetic":
      return { stability: 0.35, similarity_boost: 0.8, style: 0.6, use_speaker_boost: true, speed: 1.10 };
    case "news":
      return { stability: 0.75, similarity_boost: 0.85, style: 0.2, use_speaker_boost: true, speed: 1.10 };
    case "conversational":
    default:
      return { stability: 0.55, similarity_boost: 0.78, style: 0.35, use_speaker_boost: true, speed: 1.05 };
  }
}

/** Generate a short, spoken-feeling voice script (1-2 sentences). */
async function generateVoiceScript(
  weather: WeatherResponse,
  tone?: string,
  platforms?: string[],
  ctaOpts?: { subscribeCta?: boolean; city?: string | null },
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  // Fallback if AI gateway is unavailable — still useful, deterministic
  const fallback = `Good day, ${weather.city}. Expect ${weather.description.toLowerCase()} with a high near ${weather.temperature} degrees today.`;
  const ctaCity = ctaOpts?.city ?? weather.city;
  const subscribeCta = ctaOpts?.subscribeCta ?? false;
  if (!LOVABLE_API_KEY) {
    const alertMode = isWeatherAlert({
      condition: weather.description,
      temperature: weather.temperature,
      rainChance: weather.rainChance,
    });
    return appendVoiceCTA(fallback, { tone, platforms, alertMode, subscribeCta, city: ctaCity });
  }

  const toneHint =
    tone === "energetic" ? "Upbeat and lively, with energy."
    : tone === "news" ? "Crisp, neutral, news-anchor style."
    : "Friendly and conversational, like a local morning host.";

  const userPrompt = [
    `City: ${weather.city}`,
    `Condition: ${weather.description}`,
    `Current temp: ${weather.temperature}°F`,
    `Morning: ${weather.morningTemp ?? "?"}°F ${weather.morningCondition ?? ""}`.trim(),
    `Afternoon: ${weather.afternoonTemp ?? "?"}°F ${weather.afternoonCondition ?? ""}`.trim(),
    `Evening: ${weather.eveningTemp ?? "?"}°F ${weather.eveningCondition ?? ""}`.trim(),
    `Rain chance: ${weather.rainChance}%`,
    "",
    `Tone: ${toneHint}`,
    "",
    "Write a SPOKEN weather script. Strict rules:",
    "- HARD CAP: 25 words MAX for the weather summary. Shorter is better.",
    "- LEAD with the most important data first: high temp + rain chance. Other periods are optional.",
    "- 1–2 sentences. Sound natural read aloud (no emojis, no hashtags, no special chars).",
    "- Mention the city once, the dominant condition, and the key temperature.",
    "- No greetings like 'Hey everyone'. A short locale opener like 'Good morning {city}' is fine but counts toward the 25-word cap.",
    "- You MAY include AT MOST ONE local reference, but ONLY from the verified list below, and ONLY if it fits the weather naturally. Otherwise omit it.",
    "- Do NOT include any subscribe / follow / notification / bell call-to-action — that is appended automatically as a separate final paragraph. End on the weather, not a CTA.",
    "- Return ONLY the script text. No labels, no quotes.",
    "",
    buildVerifiedLandmarksBlock(weather.city),
  ].join("\n");

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + LOVABLE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a concise broadcast weather scriptwriter. Output spoken-style scripts only.\n\n" + LOCATION_ACCURACY_RULES },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      console.error("Voice script AI failed:", res.status);
      return fallback;
    }
    const data = await res.json();
    const txt = data?.choices?.[0]?.message?.content?.trim();
    const candidate = txt || fallback;
    const v = validateCaptionLocation(candidate, weather.city);
    let finalScript = candidate;
    if (!v.ok) {
      console.warn(`[voice] foreign landmarks in script for ${weather.city}:`, v.hits, "— sanitizing");
      finalScript = stripUnverifiedReferences(candidate, weather.city);
    }
    // Append tone-matched, rotating spoken CTA for audio-first platforms (YouTube / TikTok).
    // Switches to the ultra-short safety CTA when weather conditions qualify as an alert.
    // When subscribeCta is enabled (Growth toggle), the new Subscribe + Bell pool is used.
    const alertMode = isWeatherAlert({
      condition: weather.description,
      temperature: weather.temperature,
      rainChance: weather.rainChance,
    });
    return appendVoiceCTA(finalScript, { tone, platforms, alertMode, subscribeCta, city: ctaCity });
  } catch (e) {
    console.error("Voice script error:", e);
    const alertMode = isWeatherAlert({
      condition: weather.description,
      temperature: weather.temperature,
      rainChance: weather.rainChance,
    });
    return appendVoiceCTA(fallback, { tone, platforms, alertMode, subscribeCta, city: ctaCity });
  }
}

/** Calls ElevenLabs TTS and returns MP3 bytes. */
function resolveElevenLabsKey(): string | null {
  // Accept either the canonical name or the legacy ELEVEN_LABS_API_KEY name.
  const v = Deno.env.get("ELEVENLABS_API_KEY") || Deno.env.get("ELEVEN_LABS_API_KEY") || Deno.env.get("ELEVENLABS_KEY");
  return v && v.trim().length > 0 ? v.trim() : null;
}

async function generateVoiceAudio(script: string, voice: VoiceOptions): Promise<Uint8Array | null> {
  const apiKey = resolveElevenLabsKey();
  if (!apiKey) {
    console.error("Error: ElevenLabs Key not found in environment");
    console.error("ELEVENLABS_API_KEY not configured (also tried ELEVEN_LABS_API_KEY) — skipping voice generation");
    return null;
  }
  const voiceId = resolveVoiceId(voice.voiceId);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: script,
        model_id: "eleven_turbo_v2_5",
        voice_settings: voiceSettingsForTone(voice.tone),
      }),
    });
    if (!res.ok) {
      const errTxt = await res.text();
      console.error("ElevenLabs TTS failed:", res.status, errTxt.slice(0, 200));
      return null;
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) {
    console.error("ElevenLabs TTS error:", e);
    return null;
  }
}

/** Upload MP3 to weather-videos bucket and return signed URL + path. */
async function storeVoiceAudio(
  supabase: any,
  userId: string,
  audio: Uint8Array,
): Promise<{ signedUrl: string; storagePath: string } | null> {
  const path = `${userId}/voice-${Date.now()}.mp3`;
  const { error: upErr } = await supabase.storage
    .from("weather-videos")
    .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (upErr) { console.error("Voice upload error:", upErr); return null; }
  const { data: signed, error: signErr } = await supabase.storage
    .from("weather-videos")
    .createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl) { console.error("Voice signed url error:", signErr); return null; }
  return { signedUrl: signed.signedUrl, storagePath: path };
}

/**
 * Estimate the duration (seconds) of an MP3 buffer produced by ElevenLabs.
 * We request `mp3_44100_128` (CBR 128 kbps) so duration ≈ bytes / (128_000/8) = bytes / 16000.
 */
function estimateMp3DurationSeconds(byteLength: number | null | undefined): number | null {
  if (!byteLength || byteLength <= 0) return null;
  const seconds = byteLength / 16000;
  if (!isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

/**
 * Compute the final composition duration so the voiceover (which starts at t=0.5s)
 * always finishes with at least `VOICE_TAIL_PAD` seconds of silent video at the end.
 */
const VOICE_START = 0.5;        // seconds — when voice element starts
const VOICE_TAIL_PAD = 1.5;     // seconds — silence held after voice ends
const MIN_VIDEO_DURATION = 12;  // seconds — retention sweet spot floor
const MAX_VIDEO_DURATION = 15;  // seconds — short enough to invite re-watch loops

function computeVideoDuration(audioDurationSec: number | null | undefined): number {
  const audio = typeof audioDurationSec === "number" && isFinite(audioDurationSec) && audioDurationSec > 0 ? audioDurationSec : 0;
  const target = audio > 0 ? VOICE_START + audio + VOICE_TAIL_PAD : MIN_VIDEO_DURATION;
  // Clamp into the 12–15s retention window so the video loops well.
  return Math.min(MAX_VIDEO_DURATION, Math.max(MIN_VIDEO_DURATION, target));
}

const ALLOWED_CREATOMATE_ANIMATIONS = new Set(["fade", "scale", "pan", "slide"]);
const ALLOWED_CREATOMATE_ELEMENTS = new Set(["text", "image", "video", "shape", "audio", "composition"]);

function sanitizeCreatomateSource(source: Record<string, any>): Record<string, any> {
  const cleanAnimationValue = (value: any, ownerType: string, path: string): any => {
    if (!value) return value;
    const cleanOne = (animation: any) => {
      if (!animation || typeof animation !== "object") return null;
      const type = String(animation.type || "");
      if (!ALLOWED_CREATOMATE_ANIMATIONS.has(type)) {
        console.warn(`[creatomate] removed invalid animation at ${path}: ${type || "(missing)"}`);
        return null;
      }
      return animation;
    };
    if (ownerType === "shape" && path.endsWith("animations")) {
      console.warn("[creatomate] removed shape.animations to avoid Shape.animations.type source rejection");
      return undefined;
    }
    if (Array.isArray(value)) return value.map(cleanOne).filter(Boolean);
    return cleanOne(value) || undefined;
  };

  const cleanElement = (el: any, index: number): any => {
    if (!el || typeof el !== "object") throw new Error(`Creatomate source element ${index} is invalid`);
    const type = String(el.type || "");
    if (!ALLOWED_CREATOMATE_ELEMENTS.has(type)) throw new Error(`Creatomate source element ${index} has invalid type: ${type || "(missing)"}`);
    const next: Record<string, any> = { ...el };
    next.animations = cleanAnimationValue(next.animations, type, `${type}.animations`);
    next.enter = cleanAnimationValue(next.enter, type, `${type}.enter`);
    next.exit = cleanAnimationValue(next.exit, type, `${type}.exit`);
    if (next.animations === undefined) delete next.animations;
    if (next.enter === undefined) delete next.enter;
    if (next.exit === undefined) delete next.exit;
    if ((type === "video" || type === "image" || type === "audio") && (!next.source || typeof next.source !== "string")) {
      throw new Error(`Creatomate ${type} element ${index} is missing a valid source URL`);
    }
    return next;
  };

  const elements = Array.isArray(source.elements) ? source.elements.map(cleanElement) : [];
  if (elements.length === 0) throw new Error("Creatomate source must include a non-empty elements array");
  return { ...source, output_format: "mp4", elements };
}

function buildCreatomateSource(weather: WeatherResponse, videoUrl?: string | null, timePeriod?: string | null, voiceUrl?: string | null, audioDurationSec?: number | null, visualStyle?: string | null): object {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const theme = getWeatherTheme(weather.condition);
  const takeaway = getPracticalTakeaway(weather);
  const alertLine = getAlertLine(weather);
  const tomorrowPreview = getTomorrowPreview(weather);
  const habitCTA = getHabitCTA(weather.city);
  const temps = [weather.morningTemp, weather.afternoonTemp, weather.eveningTemp].filter((t): t is number => t != null);
  const hi = temps.length ? Math.max(...temps) : weather.temperature;
  const lo = temps.length ? Math.min(...temps) : weather.temperature;
  const windSpeed = weather.windInfo.split(" ")[0] + " mph";
  let t = 0;
  const nt = () => ++t;
  // Dynamic composition length — extends to accommodate full voiceover + tail padding.
  const D = computeVideoDuration(audioDurationSec);
  // Helper: original durations were authored as `10 - time` (so element runs to end).
  // Translate them so each element still runs from `time` to `D`.
  const dur = (originalRemainder: number) => Math.max(0.1, D - (10 - originalRemainder));

  // Determine time period label
  let periodLabel: string;
  if (timePeriod === "morning") periodLabel = "☀️  MORNING UPDATE";
  else if (timePeriod === "afternoon") periodLabel = "🌤️  AFTERNOON UPDATE";
  else if (timePeriod === "evening") periodLabel = "🌙  EVENING UPDATE";
  else {
    const hour = now.getHours();
    if (hour >= 6 && hour < 12) periodLabel = "☀️  MORNING UPDATE";
    else if (hour >= 12 && hour < 17) periodLabel = "🌤️  AFTERNOON UPDATE";
    else periodLabel = "🌙  EVENING UPDATE";
  }

  const cityUpper = weather.city.toUpperCase();
  const regionDate = weather.stateOrRegion + "  \u00B7  " + dateStr;
  const tempStr = weather.temperature + "\u00B0";
  const condStr = weather.description.charAt(0).toUpperCase() + weather.description.slice(1);
  const hiStr = hi + "\u00B0";
  const loStr = lo + "\u00B0";
  const rainStr = weather.rainChance + "%";
  const bgGradient = visualStyle === "cinematic"
    ? "linear-gradient(170deg, #0b1220 0%, #1a1a2e 50%, #0b1220 100%)"
    : "linear-gradient(170deg, " + theme.bg1 + " 0%, " + theme.bg2 + " 50%, " + theme.bg1 + " 100%)";
  const logoUrl = "https://pewdswjhsesfondewucc.supabase.co/storage/v1/object/public/brand-assets/skybrief-icon.png";

  // === BACKGROUND with Ken Burns slow zoom (100% → 110%) — keeps motion alive
  // even when the source is a still image, which is critical for retention.
  const kenBurns = { type: "scale" as const, start_scale: "100%", end_scale: "110%", duration: dur(10.0), easing: "linear" };
  const elements: any[] = [
    // === BACKGROUND ===
    ...(videoUrl ? [
      { type: "video", track: nt(), time: 0, duration: dur(10.0), source: videoUrl, width: "100%", height: "100%", x: "50%", y: "50%", fit: "cover",
        animations: [kenBurns] },
    ] : [
      { type: "shape", track: nt(), time: 0, duration: dur(10.0), shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%", fill_color: bgGradient,
        animations: [kenBurns] },
    ]),

    // === BOTTOM-UP SHADOW GRADIENT — guarantees white text legibility ===
    { type: "shape", track: nt(), time: 0, duration: dur(10.0), shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
      fill_color: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 30%, rgba(0,0,0,0.35) 65%, rgba(0,0,0,0.80) 100%)" },

    // === WEATHER PARTICLE / SHIMMER OVERLAY (drifting orbs for motion) ===
    { type: "shape", track: nt(), time: 0, duration: dur(10.0), shape_type: "ellipse", width: 260, height: 260, x: "20%", y: "30%",
      fill_color: "rgba(255,255,255,0.10)",
      animations: [{ type: "scale", start_scale: "80%", end_scale: "120%", duration: 4.0, easing: "ease-in-out" }] },
    { type: "shape", track: nt(), time: 0.5, duration: dur(9.5), shape_type: "ellipse", width: 200, height: 200, x: "78%", y: "55%",
      fill_color: "rgba(255,255,255,0.08)",
      animations: [{ type: "scale", start_scale: "120%", end_scale: "85%", duration: 5.0, easing: "ease-in-out" }] },
    { type: "shape", track: nt(), time: 1.0, duration: dur(9.0), shape_type: "ellipse", width: 320, height: 320, x: "30%", y: "78%",
      fill_color: "rgba(255,255,255,0.06)",
      animations: [{ type: "scale", start_scale: "90%", end_scale: "115%", duration: 6.0, easing: "ease-in-out" }] },

    // Subtle theme glow
    { type: "shape", track: nt(), time: 0, duration: dur(10.0), shape_type: "ellipse", width: 1800, height: 1800, x: "75%", y: "30%", fill_color: theme.glow1,
      animations: [{ type: "scale", start_scale: "95%", end_scale: "108%", duration: dur(10.0), easing: "linear" }] },

    // === SKYBRIEF LOGO (icon image) ===
    { type: "image", track: nt(), time: 0, duration: dur(10.0), source: logoUrl, width: 100, height: 100,
      x: "44%", y: "5.5%", x_alignment: "50%", y_alignment: "50%",
      enter: { type: "fade", duration: 0.5 } },

    // === BRAND TEXT ===
    { type: "text", track: nt(), time: 0, duration: dur(10.0), text: "SKYBRIEF", font_family: "Inter", font_weight: "800", font_size: "56", fill_color: "#ffffff", letter_spacing: "18%",
      x: "56%", y: "5.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } },
    { type: "shape", track: nt(), time: 0.2, duration: dur(9.8), shape_type: "rectangle", width: 80, height: 4, x: "50%", y: "8%", fill_color: theme.accent, border_radius: "2",
      enter: { type: "scale", start_scale: "0%", duration: 0.6 } },

    // === TIME PERIOD BADGE ===
    { type: "shape", track: nt(), time: 0.3, duration: dur(9.7), shape_type: "rectangle", width: 520, height: 60, x: "50%", y: "11%",
      fill_color: "rgba(255,255,255,0.12)", border_radius: "30",
      enter: { type: "fade", duration: 0.4 } },
    { type: "text", track: nt(), time: 0.3, duration: dur(9.7), text: periodLabel, font_family: "Inter", font_weight: "700", font_size: "34", fill_color: theme.accent, letter_spacing: "4%",
      x: "50%", y: "11%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.4 } },

    // === CITY HEADER GLASS PANEL (stronger backdrop) ===
    { type: "shape", track: nt(), time: 0.2, duration: dur(9.8), shape_type: "rectangle", width: 1100, height: 280, x: "50%", y: "17%",
      fill_color: "rgba(0,0,0,0.45)", border_radius: "16",
      enter: { type: "fade", duration: 0.4 } },

    // === CITY + DATE ===
    { type: "text", track: nt(), time: 0.3, duration: dur(9.7), text: cityUpper, font_family: "Inter", font_weight: "800", font_size: "112", fill_color: "#ffffff",
      x: "50%", y: "15%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.5 } },
    { type: "text", track: nt(), time: 0.5, duration: dur(9.5), text: regionDate, font_family: "Inter", font_weight: "600", font_size: "40", fill_color: "rgba(255,255,255,0.70)",
      x: "50%", y: "20%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } },

    // === HERO TEMPERATURE ===
    { type: "text", track: nt(), time: 0.6, duration: dur(9.4), text: theme.emoji, font_size: "100",
      x: "50%", y: "29%", x_alignment: "50%", y_alignment: "50%", enter: { type: "scale", start_scale: "50%", duration: 0.6 } },
    { type: "text", track: nt(), time: 0.7, duration: dur(9.3), text: tempStr, font_family: "Inter", font_weight: "900", font_size: "220", fill_color: "#ffffff",
      x: "50%", y: "41%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "scale", start_scale: "60%", duration: 0.6 } },
    { type: "text", track: nt(), time: 0.9, duration: dur(9.1), text: condStr,
      font_family: "Inter", font_weight: "600", font_size: "48", fill_color: theme.accent,
      x: "50%", y: "50%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } },

    // === DETAIL CARD (stronger frosted glass) ===
    { type: "shape", track: nt(), time: 1.3, duration: dur(8.7), shape_type: "rectangle", width: 1250, height: 340, x: "50%", y: "63%",
      fill_color: "rgba(10,15,30,0.75)", border_radius: "18", border_width: 1, border_color: "rgba(255,255,255,0.12)",
      shadow: "inset 0 1px 0 rgba(255,255,255,0.06)",
      enter: { type: "scale", start_scale: "92%", duration: 0.5 } },
    // Labels
    { type: "text", track: nt(), time: 1.5, duration: dur(8.5), text: "HIGH", font_family: "Inter", font_weight: "600", font_size: "28", fill_color: "rgba(255,255,255,0.50)", letter_spacing: "6%",
      x: "17%", y: "58%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: dur(8.5), text: "LOW", font_family: "Inter", font_weight: "600", font_size: "28", fill_color: "rgba(255,255,255,0.50)", letter_spacing: "6%",
      x: "39%", y: "58%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: dur(8.5), text: "RAIN", font_family: "Inter", font_weight: "600", font_size: "28", fill_color: "rgba(255,255,255,0.50)", letter_spacing: "6%",
      x: "61%", y: "58%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: dur(8.5), text: "WIND", font_family: "Inter", font_weight: "600", font_size: "28", fill_color: "rgba(255,255,255,0.50)", letter_spacing: "6%",
      x: "83%", y: "58%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.3 } },
    // Values
    { type: "text", track: nt(), time: 1.7, duration: dur(8.3), text: hiStr, font_family: "Inter", font_weight: "700", font_size: "56", fill_color: "#ffffff",
      x: "17%", y: "64%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 1.8, duration: dur(8.2), text: loStr, font_family: "Inter", font_weight: "700", font_size: "56", fill_color: "#ffffff",
      x: "39%", y: "64%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 1.9, duration: dur(8.1), text: rainStr, font_family: "Inter", font_weight: "700", font_size: "56", fill_color: "#ffffff",
      x: "61%", y: "64%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 2.0, duration: dur(8.0), text: windSpeed, font_family: "Inter", font_weight: "700", font_size: "56", fill_color: "#ffffff",
      x: "83%", y: "64%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.4 } },
    // Dividers
    { type: "shape", track: nt(), time: 1.6, duration: dur(8.4), shape_type: "rectangle", width: 1, height: 100, x: "28%", y: "61.5%", fill_color: "rgba(255,255,255,0.10)", enter: { type: "fade", duration: 0.3 } },
    { type: "shape", track: nt(), time: 1.6, duration: dur(8.4), shape_type: "rectangle", width: 1, height: 100, x: "50%", y: "61.5%", fill_color: "rgba(255,255,255,0.10)", enter: { type: "fade", duration: 0.3 } },
    { type: "shape", track: nt(), time: 1.6, duration: dur(8.4), shape_type: "rectangle", width: 1, height: 100, x: "72%", y: "61.5%", fill_color: "rgba(255,255,255,0.10)", enter: { type: "fade", duration: 0.3 } },
  ];

  // === OPTIONAL ALERT LINE (soft yellow accent) ===
  if (alertLine) {
    elements.push(
      { type: "text", track: nt(), time: 2.2, duration: dur(7.8), text: alertLine, font_family: "Inter", font_weight: "700", font_size: "38", fill_color: "#fbbf24",
        x: "50%", y: "73%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } }
    );
  }

  // === TAKEAWAY ===
  const takeawayY = alertLine ? "77%" : "74%";
  elements.push(
    { type: "text", track: nt(), time: 2.5, duration: dur(7.5), text: takeaway, font_family: "Inter", font_weight: "600", font_size: "42", fill_color: "#ffffff",
      x: "50%", y: takeawayY, x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.6 } }
  );

  // === TOMORROW PREVIEW ===
  const tomorrowY = alertLine ? "81%" : "78.5%";
  elements.push(
    { type: "text", track: nt(), time: 3.0, duration: dur(7.0), text: tomorrowPreview, font_family: "Inter", font_weight: "600", font_size: "36", fill_color: "rgba(255,255,255,0.65)",
      x: "50%", y: tomorrowY, x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } }
  );

  // === CTA PANEL (stronger backdrop) ===
  const ctaPanelY = alertLine ? "88%" : "86%";
  const ctaTextY = alertLine ? "88%" : "86%";
  elements.push(
    { type: "shape", track: nt(), time: 3.3, duration: dur(6.7), shape_type: "rectangle", width: 1000, height: 100, x: "50%", y: ctaPanelY,
      fill_color: "rgba(0,0,0,0.55)", border_radius: "14",
      enter: { type: "fade", duration: 0.4 } },
    { type: "text", track: nt(), time: 3.8, duration: dur(6.2), text: habitCTA, font_family: "Inter", font_weight: "600", font_size: "40", fill_color: "rgba(255,255,255,0.75)",
      x: "50%", y: ctaTextY, x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.6 } },
  );

  // === FINAL "LIKE" PULSE BADGE ===
  const likeStart = Math.max(0.5, D - 2.5);
  const likeDur = Math.max(0.5, D - likeStart);
  elements.push(
    { type: "shape", track: nt(), time: likeStart, duration: likeDur, shape_type: "rectangle",
      width: 220, height: 90, x: "82%", y: "9%", fill_color: "rgba(255,255,255,0.92)", border_radius: "45",
      shadow: "0px 4px 12px rgba(0,0,0,0.35)",
      enter: { type: "scale", start_scale: "20%", duration: 0.45 } },
    { type: "text", track: nt(), time: likeStart, duration: likeDur, text: "👍 LIKE",
      font_family: "Inter", font_weight: "800", font_size: "44", fill_color: "#0f172a",
      x: "82%", y: "9%", x_alignment: "50%", y_alignment: "50%",
      enter: { type: "scale", start_scale: "20%", duration: 0.45 } },
  );

  // === SUBSCRIBE + NOTIFICATION BELL END-SCREEN (last 3s) ===
  const subStart = Math.max(0.5, D - 3.0);
  const subDur = Math.max(0.5, D - subStart);
  const cityHandle = (weather.city || "").replace(/[^A-Za-z0-9]/g, "");
  const handleText = cityHandle ? `Subscribe to @SkyBrief${cityHandle}` : "Subscribe for daily weather";
  elements.push(
    { type: "shape", track: nt(), time: subStart, duration: subDur, shape_type: "rectangle",
      width: 720, height: 130, x: "50%", y: "94%",
      fill_color: "#ff0000", border_radius: "65",
      shadow: "0px 6px 18px rgba(255,0,0,0.45)",
      enter: { type: "scale", start_scale: "60%", duration: 0.5 },
      animations: [{ type: "scale", start_scale: "100%", end_scale: "108%", duration: 0.6, easing: "ease-in-out" }] },
    { type: "text", track: nt(), time: subStart, duration: subDur, text: "▶  SUBSCRIBE",
      font_family: "Inter", font_weight: "900", font_size: "52", fill_color: "#ffffff", letter_spacing: "4%",
      x: "44%", y: "94%", x_alignment: "50%", y_alignment: "50%" },
    { type: "shape", track: nt(), time: subStart, duration: subDur, shape_type: "ellipse",
      width: 110, height: 110, x: "70%", y: "94%", fill_color: "#ffffff",
      shadow: "0px 4px 12px rgba(0,0,0,0.35)",
      animations: [{ type: "scale", start_scale: "100%", end_scale: "115%", duration: 0.5, easing: "ease-in-out" }] },
    { type: "text", track: nt(), time: subStart, duration: subDur, text: "🔔",
      font_size: "70", x: "70%", y: "94%", x_alignment: "50%", y_alignment: "50%",
      animations: [{ type: "scale", start_scale: "100%", end_scale: "115%", duration: 0.5, easing: "ease-in-out" }] },
    { type: "text", track: nt(), time: subStart, duration: subDur, text: handleText,
      font_family: "Inter", font_weight: "700", font_size: "30", fill_color: "#ffffff", letter_spacing: "3%",
      x: "50%", y: "89%", x_alignment: "50%", y_alignment: "50%",
      shadow: "0px 2px 4px rgba(0,0,0,0.6)", enter: { type: "fade", duration: 0.4 } },
  );

  // === AI VOICE NARRATION TRACK ===
  // Voice plays from t=VOICE_START. We do NOT trim the audio track — its duration mirrors
  // the real audio length so the CTA always finishes. Composition (D) leaves
  // VOICE_TAIL_PAD seconds of silent video after the voice ends. Background music (if
  // added later) should be on its own track at reduced volume to duck under the voice.
  if (voiceUrl) {
    const audioLen = typeof audioDurationSec === "number" && isFinite(audioDurationSec) && audioDurationSec > 0
      ? audioDurationSec
      : Math.max(0.1, D - VOICE_START); // fallback: play to end of composition
    elements.push({
      type: "audio",
      track: nt(),
      time: VOICE_START,
      duration: audioLen,
      source: voiceUrl,
      volume: "100%",
      // Explicitly do not fade out — keep audio crisp through the CTA.
    });
  }

  // ── CINEMATIC ENHANCEMENTS LAYER (additive only — never mutates above) ──
  // Toggled via ENABLE_CINEMATIC_MODE feature flag. Only appends new elements
  // using the already-allowed types (shape, text) and animation types
  // (fade, scale, slide). Never changes timing, voice, or pipeline.
  if (visualStyle === "cinematic") {
    const condLower = (weather.condition || "").toLowerCase();
    const isRain = condLower.includes("rain") || condLower.includes("drizzle") || condLower.includes("storm") || condLower.includes("thunder");
    const isFog = condLower.includes("fog") || condLower.includes("mist") || condLower.includes("haze") || condLower.includes("smoke");
    const isSnow = condLower.includes("snow") || condLower.includes("sleet") || condLower.includes("blizzard");

    // 1) Soft atmospheric haze (~8% white) — adds depth on every cinematic render.
    elements.push({
      type: "shape", track: nt(), time: 0, duration: dur(10.0),
      shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
      fill_color: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 50%, rgba(255,255,255,0.08) 100%)",
      enter: { type: "fade", duration: 0.8 },
    });

    // 2) Cinematic VIGNETTE — radial dark edges via top+bottom+side gradient stack.
    //    Always-on for cinematic; pushes the eye toward center subjects.
    elements.push({
      type: "shape", track: nt(), time: 0, duration: dur(10.0),
      shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
      fill_color: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)",
      enter: { type: "fade", duration: 0.8 },
    });

    // 3) Condition-based overlays — RAIN (cool blue tint + slow drift).
    if (isRain) {
      elements.push({
        type: "shape", track: nt(), time: 0, duration: dur(10.0),
        shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
        fill_color: "linear-gradient(180deg, rgba(30,58,138,0.18) 0%, rgba(15,23,42,0.10) 100%)",
        enter: { type: "fade", duration: 0.8 },
        animations: [{ type: "scale", start_scale: "100%", end_scale: "104%", duration: 6.0, easing: "ease-in-out" }],
      });
    }

    // 4) Condition-based overlays — FOG (heavy white wash + soft pulse).
    if (isFog) {
      elements.push({
        type: "shape", track: nt(), time: 0, duration: dur(10.0),
        shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
        fill_color: "linear-gradient(180deg, rgba(220,225,235,0.28) 0%, rgba(200,210,225,0.18) 100%)",
        enter: { type: "fade", duration: 1.0 },
        animations: [{ type: "scale", start_scale: "100%", end_scale: "106%", duration: 7.0, easing: "ease-in-out" }],
      });
    }

    // 5) Condition-based overlays — SNOW (cool white wash).
    if (isSnow) {
      elements.push({
        type: "shape", track: nt(), time: 0, duration: dur(10.0),
        shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
        fill_color: "linear-gradient(180deg, rgba(241,245,249,0.20) 0%, rgba(203,213,225,0.10) 100%)",
        enter: { type: "fade", duration: 0.8 },
      });
    }

    // 6) SUBTLE CARD FLOAT — inject animation onto the existing city header glass
    //    panel and detail card shapes. We mutate only the `animations` property —
    //    no JSON structure or layer additions for the cards themselves.
    for (const el of elements) {
      if (!el || el.type !== "shape" || el.shape_type !== "rectangle") continue;
      const isCityPanel = el.width === 1100 && el.height === 280 && el.y === "17%";
      const isDetailCard = el.width === 1250 && el.height === 340 && el.y === "63%";
      if (!isCityPanel && !isDetailCard) continue;
      const float = { type: "scale", start_scale: "100%", end_scale: "101.5%", duration: 4.0, easing: "ease-in-out" };
      el.animations = Array.isArray(el.animations) ? [...el.animations, float] : [float];
    }

    // 7) CTA pulse — overlay ring on the CTA panel during last ~3s, scales 1→1.05→1.
    const pulseStart = Math.max(0.5, D - 3.0);
    const pulseDur = Math.max(0.5, D - pulseStart);
    elements.push({
      type: "shape", track: nt(), time: pulseStart, duration: pulseDur,
      shape_type: "rectangle", width: 1000, height: 100, x: "50%", y: ctaPanelY,
      fill_color: "rgba(255,255,255,0)", border_radius: "14",
      border_width: 2, border_color: "rgba(255,255,255,0.45)",
      animations: [{ type: "scale", start_scale: "100%", end_scale: "105%", duration: 1.5, easing: "ease-in-out" }],
    });

    console.log(`[cinematic] enhancements applied: vignette=on rain=${isRain} fog=${isFog} snow=${isSnow} card_float=on`);
  }

  return {
    width: 1440, height: 2560, duration: D, frame_rate: 30, fill_color: theme.bg1,
    elements,
  };
}

async function generateWeatherVideo(weather: WeatherResponse, timePeriod?: string | null, voiceUrl?: string | null, audioDurationSec?: number | null, visualStyle?: string | null, errorSink?: { message?: string }): Promise<{ data: Uint8Array; mimeType: string; duration?: number } | null> {
  const apiKey = Deno.env.get("CREATOMATE_API_KEY");
  const setErr = (m: string) => { if (errorSink) errorSink.message = m; console.error("[creatomate] error:", m); };
  if (!apiKey) {
    setErr("CREATOMATE_API_KEY not configured in backend function secrets");
    return null;
  }
  console.log(`[creatomate] api_key_present=true api_key_prefix=${apiKey.slice(0, 4)}... length=${apiKey.length}`);

  const compDuration = computeVideoDuration(audioDurationSec);
  console.log(`Starting Creatomate render for ${weather.city} ${voiceUrl ? "(with voiceover)" : "(no voice)"} — composition ${compDuration.toFixed(2)}s (audio=${audioDurationSec ?? "n/a"}s)`);
  const theme = getWeatherTheme(weather.condition);
  const videoUrl = await fetchPexelsVideoUrl(theme.videoKeyword, weather.city, weather.stateOrRegion);
  let source: Record<string, any>;
  try {
    source = sanitizeCreatomateSource(buildCreatomateSource(weather, videoUrl, timePeriod, voiceUrl, audioDurationSec, visualStyle) as Record<string, any>);
  } catch (error) {
    setErr(`Creatomate source validation failed before API call: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }


  // Cache-bust: opaque per-render nonce. Creatomate stores `metadata` on the
  // render record and includes it in the input fingerprint, so this guarantees
  // a fresh render_id every call even when weather inputs are identical.
  const renderNonce = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const requestBody = JSON.stringify({ output_format: "mp4", metadata: renderNonce, ...source });
  const root: any = source;
  console.log(
    `[render] creatomate_request_sent=true template_id=${(source as any)?.template_id ?? "inline_source"} background_url=${videoUrl ? String(videoUrl).split("?")[0] : "(gradient)"} audio_url=${voiceUrl ? String(voiceUrl).split("?")[0] : "(none)"} audio_dur=${audioDurationSec ?? "n/a"}s comp_dur=${compDuration.toFixed(2)}s`,
  );
  console.log(`[creatomate] source_valid=true output_format=mp4 elements=${Array.isArray(root.elements) ? root.elements.length : 0} background_video_source=${videoUrl ? "mapped" : "none"}`);
  console.log("Creatomate request body (first 300 chars):", requestBody.substring(0, 300));

  const renderRes = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: requestBody,
  });

  const responseText = await renderRes.text();
  console.log("Creatomate raw response status:", renderRes.status);
  console.log("Creatomate raw response body:", responseText.substring(0, 1500));

  let parsedResponse: any = null;
  try { parsedResponse = JSON.parse(responseText); } catch { /* keep raw */ }
  const apiError = parsedResponse?.error || parsedResponse?.message || parsedResponse?.error_message || null;
  console.log("Creatomate parsed error field:", apiError);

  if (!renderRes.ok) {
    const detail = apiError || responseText.slice(0, 300) || `HTTP ${renderRes.status}`;
    const mapped = renderRes.status === 401
      ? "Invalid Creatomate API key (401). Check CREATOMATE_API_KEY secret."
      : renderRes.status === 422
      ? `Creatomate validation error (422): ${detail}`
      : renderRes.status === 404
      ? `Creatomate endpoint/render not found (404): ${detail}`
      : `Creatomate ${renderRes.status}: ${detail}`;
    setErr(mapped);
    return null;
  }

  const renders = parsedResponse;
  if (!renders) {
    setErr("Failed to parse Creatomate response as JSON");
    return null;
  }

  const renderId = Array.isArray(renders) ? renders[0]?.id : renders?.id;
  if (!renderId) {
    setErr(`Creatomate returned no render ID (response: ${responseText.slice(0, 200)})`);
    return null;
  }

  console.log("Creatomate render started, ID:", renderId);

  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusRes = await fetch("https://api.creatomate.com/v1/renders/" + renderId, {
      headers: { Authorization: "Bearer " + apiKey },
    });

    if (!statusRes.ok) {
      console.error("Creatomate status check failed:", statusRes.status);
      continue;
    }

    const statusData = await statusRes.json();
    console.log(`Render ${renderId} status: ${statusData.status} (poll ${i + 1}/18, ~${(i + 1) * 5}s)`);

    if (statusData.status === "succeeded" && statusData.url) {
      console.log("Render complete, downloading video...");
      const videoRes = await fetch(statusData.url);
      if (!videoRes.ok) {
        setErr(`Failed to download rendered video (HTTP ${videoRes.status})`);
        return null;
      }
      const arrayBuf = await videoRes.arrayBuffer();
      const reportedDurationSec = typeof statusData.duration === "number" ? statusData.duration : undefined;
      console.log(`Video downloaded: ${arrayBuf.byteLength} bytes, reported duration ${reportedDurationSec ?? "?"}s`);
      return { data: new Uint8Array(arrayBuf), mimeType: "video/mp4", duration: reportedDurationSec };
    }

    if (statusData.status === "failed") {
      setErr(`Creatomate render failed: ${statusData.error_message || statusData.error || "unknown error"}`);
      return null;
    }
  }

  setErr("Creatomate render timed out after 90 seconds");
  return null;
}

// --- Enhanced Fallback: AI-generated branded weather infographic ---
async function generateFallbackImage(weather: WeatherResponse): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    console.error("LOVABLE_API_KEY not set, cannot generate fallback image");
    return null;
  }

  const theme = getWeatherTheme(weather.condition);
  const temps = [weather.morningTemp, weather.afternoonTemp, weather.eveningTemp].filter((t): t is number => t != null);
  const hi = temps.length ? Math.max(...temps) : weather.temperature;
  const lo = temps.length ? Math.min(...temps) : weather.temperature;
  const takeaway = getPracticalTakeaway(weather);
  const alertLine = getAlertLine(weather);
  const tomorrowLine = getTomorrowPreview(weather);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const promptParts = [
    "Create a premium weather infographic for social media (vertical 9:16, 1080x1920 pixels).",
    "",
    "DESIGN REQUIREMENTS:",
    "- Dark gradient background blending from " + theme.bg1 + " to " + theme.bg2,
    '- "SKYBRIEF" logo text centered at top in clean sans-serif, white, with a subtle glow',
    "- Small badge below logo reading: \"DAILY UPDATE\"",
    "",
    "MAIN CONTENT (centered, top to bottom):",
    "- City name large and bold: " + weather.city,
    "- Subtitle: " + (weather.stateOrRegion || "") + " | " + today,
    "- Large temperature display: " + weather.temperature + "\u00B0F with weather emoji " + theme.emoji,
    "- Condition text in accent color " + theme.accent + ": " + weather.description,
    "",
    "STATS ROW (horizontal, icon-style):",
    "- High: " + hi + "\u00B0F  |  Low: " + lo + "\u00B0F  |  Rain: " + weather.rainChance + "%  |  Wind: " + weather.windInfo,
    "",
    "TIME PERIODS (if available):",
  ];

  if (weather.morningTemp != null) promptParts.push("- Morning: " + weather.morningTemp + "\u00B0F " + (weather.morningCondition || ""));
  if (weather.afternoonTemp != null) promptParts.push("- Afternoon: " + weather.afternoonTemp + "\u00B0F " + (weather.afternoonCondition || ""));
  if (weather.eveningTemp != null) promptParts.push("- Evening: " + weather.eveningTemp + "\u00B0F " + (weather.eveningCondition || ""));

  promptParts.push("");
  promptParts.push("BOTTOM SECTION:");
  promptParts.push("- Practical tip in a subtle card: \"" + takeaway + "\"");
  if (alertLine) promptParts.push("- Alert banner with warning icon: \"" + alertLine + "\"");
  promptParts.push("- Tomorrow preview line: \"" + tomorrowLine + "\"");
  promptParts.push("");
  promptParts.push("STYLE: Clean, minimal, professional weather app aesthetic. No photographs. Sharp typography. Subtle depth with shadows and glow effects. Premium feel.");
  promptParts.push("");
  promptParts.push(buildCityVisualBlock(weather.city));
  promptParts.push("");
  promptParts.push(buildLocalIdentityBlock(weather.city));

  const prompt = promptParts.join("\n");

  try {
    console.log("Generating enhanced fallback weather image via AI...");
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + LOVABLE_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-pro-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI image generation failed:", aiRes.status, errText);
      return null;
    }

    const aiData = await aiRes.json();
    const imageUrl = aiData.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!imageUrl) {
      console.error("No image in AI response");
      return null;
    }

    const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!base64Match) {
      console.error("Unexpected image URL format from AI");
      return null;
    }

    const imageType = base64Match[1];
    const base64Data = base64Match[2];
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log("Enhanced fallback image generated: " + bytes.length + " bytes (" + imageType + ")");
    return { data: bytes, mimeType: "image/" + imageType };
  } catch (err) {
    console.error("Fallback image generation error:", err);
    return null;
  }
}

// --- Store generated image to Supabase Storage ---
async function storeGeneratedImage(
  supabase: any,
  userId: string,
  imageData: Uint8Array,
  mimeType: string,
  city: string
): Promise<{ storagePath: string; signedUrl: string } | null> {
  try {
    const ext = mimeType.includes("png") ? "png" : mimeType.includes("jpeg") ? "jpg" : "png";
    const filename = `${userId}/${city.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}.${ext}`;
    
    const { error: uploadError } = await supabase.storage
      .from("generated-images")
      .upload(filename, imageData, {
        contentType: mimeType,
        upsert: false,
      });
    
    if (uploadError) {
      console.error("Failed to store generated image:", uploadError);
      return null;
    }
    
    const { data: signedData } = await supabase.storage
      .from("generated-images")
      .createSignedUrl(filename, 3600); // 1 hour
    
    console.log(`Image stored: ${filename}`);
    return { storagePath: filename, signedUrl: signedData?.signedUrl || "" };
  } catch (err) {
    console.error("Image storage error:", err);
    return null;
  }
}

// --- Fallback: Post image to LinkedIn ---
async function postLinkedInImage(token: string, imageData: Uint8Array, title: string, description: string): Promise<string | null> {
  const parts = token.split("::");
  const accessToken = parts[0];
  const authorUrn = parts[1];
  if (!authorUrn) { console.error("LinkedIn: no author URN"); return null; }

  // Try org URN first, fallback to person URN if org permissions fail
  const personUrn = parts.length > 2 ? parts[2] : null;
  
  try {
    // Step 1: Register image upload
    console.log("LinkedIn: Registering image upload for", authorUrn);
    let registerRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": "202601",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        initializeUploadRequest: {
          owner: authorUrn,
        },
      }),
    });
    let registerData = await registerRes.json();
    
    // If org posting fails due to permissions, fallback to person URN
    let effectiveAuthor = authorUrn;
    if (!registerRes.ok && personUrn && authorUrn !== personUrn) {
      console.log("LinkedIn org image failed, falling back to person URN:", personUrn);
      registerRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "LinkedIn-Version": "202601",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: personUrn,
          },
        }),
      });
      registerData = await registerRes.json();
      effectiveAuthor = personUrn;
    }
    if (!registerRes.ok) { console.error("LinkedIn image register failed:", registerData); return null; }

    const uploadUrl = registerData.value?.uploadUrl;
    const imageUrn = registerData.value?.image;
    if (!uploadUrl || !imageUrn) { console.error("LinkedIn: Missing image upload URL or URN"); return null; }

    // Step 2: Upload image binary
    console.log("LinkedIn: Uploading image binary...");
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/octet-stream",
      },
      body: imageData,
    });
    if (!uploadRes.ok) { const err = await uploadRes.text(); console.error("LinkedIn image upload failed:", err); return null; }

    // Step 3: Create post with image
    console.log("LinkedIn: Creating image post...");
    const postRes = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": "202601",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author: effectiveAuthor,
        commentary: description || title,
        visibility: "PUBLIC",
        distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
        content: { media: { title, id: imageUrn } },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
      }),
    });
    if (!postRes.ok) { const err = await postRes.text(); console.error("LinkedIn image post failed:", err); return null; }

    const postId = postRes.headers.get("x-restli-id") || imageUrn;
    console.log("LinkedIn image post created:", postId);
    return postId;
  } catch (err) { console.error("LinkedIn image post error:", err); return null; }
}

// --- Fallback: Post image to Twitter ---
async function postTwitterImage(token: string, imageData: Uint8Array, text: string): Promise<string | null> {
  try {
    const { TwitterAdapter } = await import("../_shared/twitter-adapter.ts");
    const adapter = new TwitterAdapter();
    console.log("Posting image to Twitter via image upload...");
    const result = await adapter.uploadImage(token, imageData, text, "image/png");
    if (result) {
      console.log("Twitter image post created:", result.id);
      return result.id;
    }
    return null;
  } catch (err) { console.error("Twitter image post error:", err); return null; }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let mode = "post";
    let timePeriod: string | null = null;
    let selectedPlatforms: string[] | null = null;
    let style = "standard";
    let variation = false;
    let voiceOpts: VoiceOptions = { enabled: false };
    let requestedCityId: string | null = null;
    let requestedCityName: string | null = null;
    let requestedCityState: string | null = null;
    let requestBody: Record<string, any> = {};
    try {
      const body = await req.clone().json();
      requestBody = body && typeof body === "object" ? body : {};
      if (body?.mode === "preview") mode = "preview";
      if (body?.time_period) timePeriod = body.time_period; // "morning" | "afternoon" | "evening"
      if (body?.platforms && Array.isArray(body.platforms)) selectedPlatforms = body.platforms;
      if (typeof body?.style === "string") style = body.style;
      if (body?.variation === true) variation = true;
      if (typeof body?.city_id === "string") requestedCityId = body.city_id;
      if (typeof body?.city === "string") requestedCityName = body.city;
      if (typeof body?.state === "string") requestedCityState = body.state;
      if (body?.voice && typeof body.voice === "object") {
        voiceOpts = {
          enabled: !!body.voice.enabled,
          voiceId: typeof body.voice.voiceId === "string" ? body.voice.voiceId : undefined,
          tone: typeof body.voice.tone === "string" ? body.voice.tone : undefined,
        };
      }
    } catch { /* no body is fine */ }
    const requestedCinematic = !!requestBody?.enable_cinematic_mode;
    // NOTE: Cinematic-mode hard gate is applied AFTER weather is fetched (see below).
    // These vars are reassigned once weather.condition is known.
    let cinematicTrigger: string | null = null;
    let enableCinematic = false;
    let visualStyle: string | null = null;
    console.log(`[daily-weather-post] mode=${mode} style=${style} variation=${variation} voice=${voiceOpts.enabled} city_id=${requestedCityId ?? "-"} city=${requestedCityName ?? "-"} cinematic_requested=${requestedCinematic}`);


    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Require authentication — this pipeline burns external API credits (OpenWeather, Lovable AI, Creatomate).
    const auth = await verifyUser(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;

    const { data: settings, error: settingsError } = await supabase
      .from("weather_settings")
      .select("*")
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (settingsError || !settings) {
      throw new Error("No weather settings found. Please configure your settings first.");
    }

    // === City context (single source of truth) ===
    // The selected city in the global header is the authoritative input.
    // If the request supplied a city_id, look it up. Otherwise honor city/state.
    // Fall back to weather_settings ONLY when nothing is supplied (legacy callers).
    let resolvedCityId: string | null = requestedCityId;
    let resolvedCityName: string = requestedCityName || settings.city;
    let resolvedCityState: string | null = requestedCityState ?? settings.state ?? null;
    if (requestedCityId) {
      const { data: cityRow } = await supabase
        .from("cities")
        .select("id, name, state")
        .eq("id", requestedCityId)
        .maybeSingle();
      if (cityRow) {
        resolvedCityId = cityRow.id;
        resolvedCityName = cityRow.name;
        resolvedCityState = cityRow.state ?? null;
      }
    }
    console.log(`[daily-weather-post] resolved city: ${resolvedCityName}${resolvedCityState ? ", " + resolvedCityState : ""} (id=${resolvedCityId ?? "-"})`);

    const openWeatherApiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!openWeatherApiKey) {
      throw new Error("OpenWeatherMap API key not configured as a backend secret.");
    }

    const weather = await fetchWeatherData(resolvedCityState ? resolvedCityName + "," + resolvedCityState : resolvedCityName, openWeatherApiKey);

    // Cinematic-mode hard gate: only fires for high-drama weather conditions
    // (rain / storm / thunder / cloudy / overcast / drizzle / shower). Sunny,
    // clear, hot, fog, mist, snow → standard render. Mirrors the rule applied
    // in process-scheduled-posts so manual + auto paths behave identically.
    {
      const _condForCinematic = (weather?.condition || "").toLowerCase();
      const _cinematicMatch = /(rain|storm|thunder|cloudy|overcast|drizzle|shower)/.exec(_condForCinematic);
      cinematicTrigger = _cinematicMatch ? _cinematicMatch[1] : null;
      enableCinematic = requestedCinematic && !!cinematicTrigger;
      visualStyle = enableCinematic ? "cinematic" : null;
      console.log(`[daily-weather-post] cinematic_active=${enableCinematic} trigger=${cinematicTrigger ?? "-"} condition=${weather?.condition ?? "-"}`);
    }

    // Generate caption via SkyBrief prompt
    let caption: string | null = null;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (LOVABLE_API_KEY) {
      try {
        const baseUserContent =
          buildSkyBriefUserPrompt(weather, timePeriod) +
          (style === "minimal"
            ? "\n\nSTYLE: MINIMAL. Strip back. Shorter lines, no emojis."
            : style === "cinematic"
            ? "\n\nSTYLE: CINEMATIC. Slightly more dramatic, evocative opening line."
            : "") +
          (variation
            ? "\n\nVARIATION REQUEST: Pick a noticeably different creative angle (witty, dramatic, conversational, or poetic). Vary opening line and rhythm."
            : "") +
          "\n\n" + buildVerifiedLandmarksBlock(weather.city) +
          "\n\n" +
          buildStyleAddendum({
            tone: normalizeTone((settings as any).caption_tone),
            city: weather.city,
            state: weather.stateOrRegion,
            period: timePeriod,
            rainChance: weather.rainChance ?? 0,
            highTemp: weather.afternoonTemp ?? weather.temperature ?? 0,
            lowTemp: weather.morningTemp ?? weather.temperature ?? 0,
            conditions: weather.afternoonCondition || weather.condition || "",
            platform: (selectedPlatforms && selectedPlatforms[0]) || null,
          });

        const systemPromptWithGuard = SKYBRIEF_SYSTEM_PROMPT + "\n\n" + LOCATION_ACCURACY_RULES;

        const callCaption = async (extra = "") => {
          const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: "Bearer " + LOVABLE_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: systemPromptWithGuard },
                { role: "user", content: baseUserContent + extra },
              ],
            }),
          });
          if (!r.ok) return null;
          const d = await r.json();
          return d.choices?.[0]?.message?.content?.trim() || null;
        };

        caption = await callCaption();
        if (caption) {
          const v = validateCaptionLocation(caption, weather.city);
          if (!v.ok) {
            console.warn(`[daily-weather-post] foreign landmarks for ${weather.city}:`, v.hits);
            const retry = await callCaption(
              `\n\nREGENERATION REQUIRED: Your previous draft mentioned ${v.hits.join(", ")}, which is NOT in ${weather.city}. Rewrite without ANY specific landmark, stadium, university, neighborhood, or business name. Use only generic local phrasing.`,
            );
            if (retry) {
              const v2 = validateCaptionLocation(retry, weather.city);
              caption = v2.ok ? retry : stripUnverifiedReferences(retry, weather.city);
            }
          }
          // Final safety net: scrub any remaining foreign references.
          if (caption) caption = stripUnverifiedReferences(caption, weather.city);
        }
      } catch (e) {
        console.error("Caption generation failed:", e);
      }
    }

    // === AI VOICE NARRATION (optional) ===
    // Generated BEFORE the video so we can pass the audio URL into Creatomate.
    // If TTS fails, we proceed silently without voice (does not break flow).
    let voiceUrl: string | null = null;
    let voiceStoragePath: string | null = null;
    let voiceScript: string | null = null;
    // Estimated voiceover audio duration (seconds). Drives the dynamic composition length
    // so the full voiceover + CTA is never cut off. null = no voiceover (use 10s minimum).
    let voiceAudioDurationSec: number | null = null;
    let voiceAttempted = false;
    let voiceFailed = false;
    if (voiceOpts.enabled && userId) {
      voiceAttempted = true;
      console.log("Voice enabled — generating script + TTS audio");
      voiceScript = await generateVoiceScript(weather, voiceOpts.tone, selectedPlatforms, {
        subscribeCta: (settings as any)?.subscribe_cta_enabled !== false,
        city: weather.city,
      });
      console.log("Voice script:", voiceScript);
      const audioBytes = await generateVoiceAudio(voiceScript, voiceOpts);
      if (audioBytes) {
        voiceAudioDurationSec = estimateMp3DurationSeconds(audioBytes.length);
        console.log(`Voice audio estimated duration: ${voiceAudioDurationSec?.toFixed(2) ?? "n/a"}s (${audioBytes.length} bytes)`);
        const stored = await storeVoiceAudio(supabase, userId, audioBytes);
        if (stored) {
          voiceUrl = stored.signedUrl;
          voiceStoragePath = stored.storagePath;
          console.log("Voice audio stored at:", voiceStoragePath);
        } else {
          voiceFailed = true;
          console.warn("Voice audio storage failed — preview will be silent");
        }
      } else {
        voiceFailed = true;
        console.warn("Voice audio generation failed — continuing without voiceover");
      }
    }

    // Generate video (with voice baked in if available). Composition length is sized
    // dynamically from the audio duration so the voiceover + CTA always finish in full.
    const renderStart = Date.now();
    const renderErrorSink: { message?: string } = {};
    const video = await generateVideoWithFallback({
      weather, timePeriod, voiceUrl, audioDurationSec: voiceAudioDurationSec,
      visualStyle,
      primaryTimeoutMs: 180_000,
      creatomate: () => generateWeatherVideo(weather, timePeriod, voiceUrl, voiceAudioDurationSec, visualStyle, renderErrorSink),
    });
    const renderElapsedSec = ((Date.now() - renderStart) / 1000);


    // === PREVIEW MODE ===
    if (mode === "preview") {
      // Helper: insert a preview_bundle row and return its id. Best-effort —
      // failures don't block returning the preview to the user, but we log so
      // we can investigate. The bundle is the contract used by publish later.
      const insertBundle = async (args: {
        contentType: "video" | "image";
        storageBucket: string;
        storagePath: string;
        assetUrl: string;
        visualSource: string;
        bytes: number;
        renderTime?: number;
      }): Promise<string | null> => {
        if (!userId) return null;
        try {
          // Cheap content fingerprint — combine the asset path, byte size and
          // caption so we can detect drift between preview and published asset.
          const hashInput = `${args.storagePath}|${args.bytes}|${(caption || "").slice(0, 200)}`;
          const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(hashInput));
          const contentHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
          const { data, error } = await supabase.from("preview_bundles").insert({
            user_id: userId,
            city_id: resolvedCityId ?? null,
            city: weather?.city ?? null,
            state: (weather as any)?.stateOrRegion ?? null,
            weather_snapshot: weather as any,
            caption_text: caption ?? null,
            voice_script: voiceScript ?? null,
            visual_source: args.visualSource,
            content_type: args.contentType,
            storage_bucket: args.storageBucket,
            storage_path: args.storagePath,
            asset_url: args.assetUrl,
            audio_url: voiceUrl ?? null,
            render_config: {
              style: requestBody.style ?? "standard",
              time_period: timePeriod ?? null,
              render_time_sec: args.renderTime ?? null,
            },
            content_hash: contentHash,
            status: "locked",
          }).select("id").maybeSingle();
          if (error) { console.warn("[preview-bundle] insert failed:", error.message); return null; }
          return data?.id ?? null;
        } catch (e) {
          console.warn("[preview-bundle] insert threw:", (e as Error).message);
          return null;
        }
      };

      if (video && userId) {
        // Video preview path
        const fileName = userId + "/preview-" + Date.now() + ".mp4";
        const { error: uploadError } = await supabase.storage
          .from("weather-videos")
          .upload(fileName, video.data, {
            contentType: "video/mp4",
            upsert: true,
          });

        if (uploadError) {
          console.error("Storage upload error:", uploadError);
          throw new Error("Failed to store preview video");
        }

        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from("weather-videos")
          .createSignedUrl(fileName, 3600);

        if (signedUrlError || !signedUrlData?.signedUrl) {
          console.error("Signed URL error:", signedUrlError);
          throw new Error("Failed to create signed URL for preview video");
        }

        const visualSource = (video as any)?.source === "creatomate" ? "creatomate"
          : (video as any)?.source ? String((video as any).source) : "creatomate";
        const bundleId = await insertBundle({
          contentType: "video",
          storageBucket: "weather-videos",
          storagePath: fileName,
          assetUrl: signedUrlData.signedUrl,
          visualSource,
          bytes: video.data.byteLength,
          renderTime: renderElapsedSec,
        });

        console.log("Preview video stored with signed URL", { bundleId, visualSource, renderTime: renderElapsedSec });
        return new Response(
          JSON.stringify({
            success: true,
            mode: "preview",
            content_type: "video",
            video_url: signedUrlData.signedUrl,
            storage_path: fileName,
            weather,
            caption,
            audio_url: voiceUrl,
            voice_script: voiceScript,
            voice_attempted: voiceAttempted,
            voice_failed: voiceAttempted && !voiceUrl,
            bundle_id: bundleId,
            visual_source: visualSource,
            render_time: renderElapsedSec,
            locked: !!bundleId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const renderError = renderErrorSink.message || "Video render failed before producing a valid mp4";
      console.error(`[daily-weather-post] preview video render failed — ${renderError}`);
      return new Response(
        JSON.stringify({
          success: false,
          mode: "preview",
          content_type: "video",
          error: renderError,
          weather,
          caption,
          audio_url: voiceUrl,
          voice_script: voiceScript,
          voice_attempted: voiceAttempted,
          voice_failed: voiceAttempted && !voiceUrl,
          visual_source: "creatomate",
          render_time: renderElapsedSec,
          locked: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === POST MODE ===
    let platform = "none";
    let status = "success";
    let errorMessage: string | null = null;
    let youtubeVideoId: string | null = null;
    const storedImageUrl: string | null = null;

    // Per-platform result tracking (used for grouped notification)
    type PlatformResult = { name: string; ok: boolean; error?: string; postId?: string | null };
    const platformResults: PlatformResult[] = [];
    const recordResult = (name: string, ok: boolean, error?: string, postId?: string | null) => {
      const existing = platformResults.find((r) => r.name === name);
      if (existing) {
        existing.ok = ok;
        existing.error = error;
        existing.postId = postId ?? existing.postId;
      } else {
        platformResults.push({ name, ok, error, postId: postId ?? null });
      }
    };

    // Determine which platforms have a usable connection. We start with the
    // legacy `weather_settings` token columns (single-channel installs) and
    // then merge in any rows from `social_accounts` — including city-scoped
    // rows mapped to the resolved city. This prevents false "No social
    // platforms connected" errors when the user only has city-mapped channels.
    const augmentedSettings: Record<string, unknown> = { ...(settings as Record<string, unknown>) };
    try {
      const { data: socialRows } = await supabase
        .from("social_accounts")
        .select("platform, access_token, refresh_token, token_expires_at, city_id, account_name, account_external_id")
        .eq("user_id", userId);
      const rows = socialRows ?? [];
      const platformsConnected = new Set<string>();
      const youtubeRouting: Array<Record<string, any>> = [];
      for (const r of rows) {
        const cityMatches = !r.city_id || r.city_id === resolvedCityId;
        if (!cityMatches) continue;
        if (r.access_token || r.refresh_token) {
          platformsConnected.add(r.platform);
          if (r.platform === "youtube") {
            youtubeRouting.push({
              account: r.account_name || r.account_external_id || "(unnamed)",
              external_id: r.account_external_id,
              scope: r.city_id ? "city" : "shared",
              expired: r.token_expires_at ? new Date(r.token_expires_at).getTime() < Date.now() : false,
            });
          }
        }
      }
      // Reflect connection state into the synthetic settings so adapter.isConnected() returns true.
      if (platformsConnected.has("youtube")) {
        augmentedSettings.youtube_access_token = augmentedSettings.youtube_access_token || "social";
        augmentedSettings.youtube_refresh_token = augmentedSettings.youtube_refresh_token || "social";
      }
      if (platformsConnected.has("tiktok")) {
        augmentedSettings.tiktok_access_token = augmentedSettings.tiktok_access_token || "social";
        augmentedSettings.tiktok_refresh_token = augmentedSettings.tiktok_refresh_token || "social";
      }
      if (platformsConnected.has("twitter")) {
        augmentedSettings.twitter_access_token = augmentedSettings.twitter_access_token || "social";
        augmentedSettings.twitter_access_token_secret = augmentedSettings.twitter_access_token_secret || "social";
      }
      if (platformsConnected.has("linkedin")) {
        augmentedSettings.linkedin_access_token = augmentedSettings.linkedin_access_token || "social";
      }
      console.log(`[daily-weather-post] connection map (city=${resolvedCityName}, id=${resolvedCityId ?? "-"}): platforms=${[...platformsConnected].join(",") || "none"}, youtube_routing=${JSON.stringify(youtubeRouting)}`);
    } catch (e) {
      console.warn("[daily-weather-post] failed to load social_accounts for connection check:", e);
    }

    let connectedAdapters = getConnectedAdapters(augmentedSettings);
    // Filter to only selected platforms if specified
    if (selectedPlatforms && selectedPlatforms.length > 0) {
      connectedAdapters = connectedAdapters.filter((a) => selectedPlatforms!.includes(a.name));
    }

    if (connectedAdapters.length === 0) {
      status = "pending";
      const requested = selectedPlatforms?.length ? ` (${selectedPlatforms.join(", ")})` : "";
      errorMessage = `No social platforms connected for ${resolvedCityName}${requested} — open Settings → Channels and either connect a shared account or assign one to this city.`;
    } else if (!video) {
      const realRenderError = renderErrorSink.message || "Video render failed before producing a valid mp4";
      console.error(`[daily-weather-post] post blocked because video render failed — ${realRenderError}`);
      status = "failed";
      platform = connectedAdapters[0]?.name || "none";
      errorMessage = realRenderError;
      for (const a of connectedAdapters) recordResult(a.name, false, `Video render failed: ${realRenderError}`);
    } else if (userId) {
      const title = generateSkyBriefTitle(weather.city, weather.temperature, weather.condition, weather.rainChance, "morning");
      assertSlotTitlePrefix(title, "daily-weather-post:dispatch");
      const desc = caption || "Weather update for " + weather.city + ": " + weather.temperature + "\u00B0F, " + weather.description;

      for (const adapter of connectedAdapters) {
        console.log(`[title_debug] daily dispatch title for ${adapter.name}:`, title);
        const result = await postToPlatform(adapter.name, supabase, userId, video.data, title, desc, video.mimeType, resolvedCityId, "morning", resolvedCityName);
        if (result.success) {
          platform = adapter.name;
          status = "success";
          if (adapter.name === "youtube") youtubeVideoId = result.id || null;
          console.log(`${adapter.name} post published! ID: ${result.id}`);
          recordResult(adapter.name, true, undefined, result.id || null);
        } else {
          platform = adapter.name;
          status = "failed";
          errorMessage = result.error || `${adapter.name} upload failed`;
          recordResult(adapter.name, false, result.error || `${adapter.name} upload failed`);
        }
      }
    }

    // Derive a hook label from the caption (first non-empty line, ≤120 chars)
    // so analytics + History UI always show what opened the post — matches the
    // logic used by process-scheduled-posts.
    const _hookSource = (caption || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
    const hookUsedDerived = _hookSource ? _hookSource.slice(0, 120) : null;
    const persistedTrace = {
      captured_at: new Date().toISOString(),
      hook_used: hookUsedDerived,
      hook_type: null,
      cinematic_mode: enableCinematic,
      cinematic_trigger: cinematicTrigger,
      voice_enabled: !!voiceUrl,
      source: "daily-weather-post",
    };

    // Derive title used for posting (re-build deterministically for metadata).
    const _titleForMeta = generateSkyBriefTitle(weather.city, weather.temperature, weather.condition, weather.rainChance, "morning");
    assertSlotTitlePrefix(_titleForMeta, "daily-weather-post:metadata");
    const { data: historyRow, error: historyError } = await supabase.from("post_history").insert({
      status, platform, city: weather.city, temperature: weather.temperature,
      condition: weather.condition, image_url: storedImageUrl, error_message: errorMessage,
      caption, user_id: userId,
      post_url: youtubeVideoId ? `https://www.youtube.com/watch?v=${youtubeVideoId}` : null,
      external_id: youtubeVideoId || null,
      // Persist hook + cinematic + voice metadata so the History UI shows them
      // on any device (cross-device, server-authoritative).
      hook_used: hookUsedDerived,
      cinematic_mode: enableCinematic,
      cinematic_trigger: cinematicTrigger,
      voice_name: voiceUrl ? "AI" : null,
      debug_trace: persistedTrace,
      visual_metadata: { has_timestamp_in_title: titleHasTimestamp(_titleForMeta) },
    }).select("id").single();
    if (historyError) console.error("Failed to log post history:", historyError);

    // Seed analytics rows for each successful platform so the Analytics tab shows the post immediately.
    if (!historyError && historyRow?.id && userId) {
      const successful = platformResults.filter((r) => r.ok);
      if (successful.length > 0) {
        const hourLocal = new Date().getHours();
        const timeOfDay =
          hourLocal < 11 ? "morning" :
          hourLocal < 16 ? "afternoon" :
          hourLocal < 21 ? "evening" : "night";
        const captionLower = (caption || "").toLowerCase();
        const cityLower = (weather.city || "").toLowerCase();
        const localKeywords = ["downtown", "park", "river", "bay", "beach", "neighborhood", "ave", "street", "blvd"];
        const hasLocalReference =
          (cityLower && captionLower.includes(cityLower)) ||
          localKeywords.some((k) => captionLower.includes(k));
        const seedRows = successful.map((r) => ({
          user_id: userId,
          post_id: historyRow.id,
          platform: r.name,
          external_id: r.name === "youtube" ? (youtubeVideoId || null) : (r as any).id || null,
          tone: (settings as any)?.caption_tone || null,
          condition: weather.condition || null,
          time_of_day: timeOfDay,
          has_voiceover: !!voiceUrl,
          has_local_reference: hasLocalReference,
          views: 0,
          likes: 0,
          comments: 0,
          shares: 0,
        }));
        const { error: seedErr } = await supabase.from("post_analytics").insert(seedRows);
        if (seedErr) console.error("Failed to seed post_analytics:", seedErr);
        else console.log(`Seeded ${seedRows.length} post_analytics row(s) for ${historyRow.id}`);

        // Phase 1 Growth Loop — seed post_performance per platform.
        try {
          const hookText = (caption || "").split("\n").map((s: string) => s.trim()).filter(Boolean)[0] || null;
          const perfRows = successful.map((r) => ({
            post_id: historyRow.id,
            city: weather.city,
            platform: r.name,
            slot: "morning" as const,
            title: _titleForMeta,
            caption: caption || null,
            hook_text: hookText,
            tone: (settings as any)?.caption_tone || null,
            style: null,
            weather_condition: weather.condition || null,
            posted_with_voice: !!voiceUrl,
            published_at: new Date().toISOString(),
            source: "auto",
          }));
          if (perfRows.length > 0) {
            const { error: perfErr } = await supabase
              .from("post_performance")
              .upsert(perfRows, { onConflict: "post_id,platform", ignoreDuplicates: true });
            if (perfErr) console.warn(`[analytics] post_performance seed failed:`, perfErr.message);
            else console.log(`[analytics] inserted post_performance row for ${weather.city} (${perfRows.map(r => r.platform).join(",")})`);
          }
        } catch (e) {
          console.warn(`[analytics] post_performance seed exception:`, e instanceof Error ? e.message : e);
        }

        // Seed post_hooks for the auto-growth analyzer
        try {
          const lines = (caption || "").split("\n").map((s: string) => s.trim()).filter(Boolean);
          const hookText = lines[0] || null;
          const opener = hookText ? hookText.split(/\s+/).slice(0, 6).join(" ").toLowerCase() : null;
          if (hookText) {
            const hookRows = successful.map((r) => ({
              user_id: userId,
              post_id: historyRow.id,
              platform: r.name,
              hook_text: hookText,
              opener,
              tone: (settings as any)?.caption_tone || null,
              city: weather.city || null,
            }));
            const { error: hookErr } = await supabase.from("post_hooks").insert(hookRows);
            if (hookErr) console.warn("Failed to seed post_hooks:", hookErr);
          }
        } catch (e) {
          console.warn("post_hooks seed exception:", e);
        }
      }
    }

    // === GROUPED NOTIFICATION ===
    // Schema is fixed (title/message/type) so we encode actionable metadata as a JSON
    // suffix in `message` using a sentinel the frontend strips before display.
    if (userId && platformResults.length > 0) {
      const successes = platformResults.filter((r) => r.ok).map((r) => r.name);
      const failures = platformResults.filter((r) => !r.ok).map((r) => r.name);
      const slot = timePeriod ? timePeriod.charAt(0).toUpperCase() + timePeriod.slice(1) : null;
      const isManual = !timePeriod;
      const isGrouped = platformResults.length > 1;
      const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
      const list = (arr: string[]) => {
        const labels = arr.map(cap);
        if (labels.length <= 1) return labels.join("");
        if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
        return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
      };

      let title: string;
      let message: string;
      let type: "success" | "error" | "info";

      if (failures.length === 0) {
        type = "success";
        title = isGrouped ? `${slot ?? "Weather"} posts published` : `${cap(successes[0])} post published`;
        message = isGrouped
          ? `\u2705 ${slot ?? "Weather"} posts sent to ${list(successes)}.`
          : `\u2705 ${cap(successes[0])} post published for ${weather.city}.`;
      } else if (successes.length === 0) {
        type = "error";
        title = isGrouped ? `${slot ?? "Weather"} posts failed` : `${cap(failures[0])} post failed`;
        message = isGrouped
          ? `\u274C ${slot ?? "Weather"} posts failed: ${list(failures)}.`
          : `\u274C ${cap(failures[0])} post failed for ${weather.city}.`;
      } else {
        type = "error"; // partial failure → amber/red priority
        title = `${slot ?? "Weather"} posts: partial failure`;
        message = `\u26A0\uFE0F ${slot ?? "Weather"} posts sent to ${list(successes)}, but ${list(failures)} failed.`;
      }

      const meta = {
        v: 1,
        slot: timePeriod || null,
        manual: isManual,
        city: weather.city,
        successes,
        failures,
        results: platformResults,
        youtube_video_id: youtubeVideoId,
      };
      const fullMessage = `${message}\n<<META>>${JSON.stringify(meta)}`;

      const { error: notifyError } = await supabase.from("notifications").insert({
        user_id: userId,
        title,
        message: fullMessage,
        type,
      });
      if (notifyError) console.error("Failed to insert notification:", notifyError);
    }

    return new Response(
      JSON.stringify({
        success: status === "success",
        weather, status, caption, platform,
        youtube_video_id: youtubeVideoId,
        platform_results: platformResults,
        message: errorMessage || "Weather post " + status + " for " + weather.city,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Edge function error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

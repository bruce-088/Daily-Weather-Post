import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStyleAddendum, normalizeTone, appendVoiceCTA, isWeatherAlert, titleHasTimestamp, slotTimePrefix, slotDisplayLabel, slotPersonalityDirective, rotatingCTA, captionSimilarity, firstContentLine, ensureSlotTitlePrefix, inferSlotFromCityHour, assertSlotTitlePrefix } from "../_shared/caption-style.ts";
import { validatePostBundle } from "../_shared/text-sanitizer.ts";
import { buildHookTitle, generateSkyBriefTitle, getWeatherEmoji } from "../_shared/title-builder.ts";
import { LOCATION_ACCURACY_RULES, validateCaptionLocation, buildVerifiedLandmarksBlock, stripUnverifiedReferences } from "../_shared/location-guard.ts";
import { generateVideoWithFallback } from "../_shared/video-render.ts";
import { expandVisualMeta, getTopVisualStyle, classifyVisualTheme, classifyColorProfile } from "../_shared/experiments.ts";
import { getRecentStyles, enforceStyleRotation } from "../_shared/style-rotation.ts";
import { selectContextualVisualStyle } from "../_shared/visual-selector.ts";
import { getAutoWinnerOverrides, type AutoWinnerOverrides } from "../_shared/auto-winner.ts";
import {
  pickPresetForDaily,
  resolveScene,
  logCinematic,
  attachCinematicToPostHistory,
  loadCinematicSettings,
  SAFE_CINEMATIC_DEFAULTS,
} from "../_shared/cinematic-presets.ts";
import { logEvent, EventType, nowMs } from "../_shared/structured-logger.ts";

const PROCESS_SCHEDULED_POSTS_BUILD = "phase3-structured-logging-2026-05-23T03:30Z";

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

async function fetchWeatherData(city: string, apiKey: string, state?: string | null): Promise<WeatherResponse> {
  const locationQuery = [city, state, "US"].filter(Boolean).join(",");
  const geoRes = await fetch(
    `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(locationQuery)}&limit=1&appid=${apiKey}`
  );
  const geoData = await geoRes.json();
  if (!geoData.length) throw new Error(`Location not found: ${city}`);

  const { lat, lon, name, country, state: geoState } = geoData[0];

  const [currentRes, forecastRes] = await Promise.all([
    fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`),
    fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`),
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
    windInfo: `${Math.round(current.wind.speed)} mph${current.wind.gust ? `, gusts ${Math.round(current.wind.gust)} mph` : ""}`,
    sunrise: fmt(sunriseDate),
    sunset: fmt(sunsetDate),
    stateOrRegion: state || country || "",
    tomorrowHigh, tomorrowLow, tomorrowCondition,
  };
}

async function resolveScheduledCity(supabase: any, post: any): Promise<{ city: string; state: string | null; cityId: string | null; automationId: string | null }> {
  let cityId = post.city_id || null;
  const automationId = post.automation_id || null;
  const isAutoPost = typeof post.caption === "string" && /^\s*\[(auto|manual):[a-z]+\]\s*$/i.test(post.caption);

  if (isAutoPost && !cityId && !automationId) {
    throw new Error("Auto-post is missing city_id/automation_id; refusing to render without strict city scope");
  }

  if (automationId) {
    const { data: automation, error: automationError } = await supabase
      .from("automations")
      .select("id, city_id, user_id")
      .eq("id", automationId)
      .eq("user_id", post.user_id)
      .maybeSingle();
    if (automationError) throw new Error("Failed to validate automation city: " + automationError.message);
    if (!automation?.city_id) throw new Error("Scheduled post automation is missing a city_id");
    if (cityId && cityId !== automation.city_id) throw new Error("Scheduled post city_id does not match automation city_id");
    cityId = automation.city_id;
  }

  if (cityId) {
    const { data: city, error: cityError } = await supabase
      .from("cities")
      .select("id, name, state, country, timezone")
      .eq("id", cityId)
      .maybeSingle();
    if (cityError) throw new Error("Failed to load scheduled city: " + cityError.message);
    if (!city?.name) throw new Error("Scheduled post city_id was not found");
    return { city: city.name, state: city.state || null, cityId, automationId };
  }

  return { city: post.city, state: null, cityId: null, automationId };
}

// --- SkyBrief Title Generator (Phase 5B: centralized in _shared/title-builder.ts) ---
import { buildHookTitle, generateSkyBriefTitle, getWeatherEmoji } from "../_shared/title-builder.ts";

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

// --- City-proxy sanitizer (mirrors generate-caption BLACKLIST + nuclear fallback) ---
// Auto_cron posts generate captions inline here and previously skipped the hardened
// sanitization in generate-caption. Run AFTER caption generation, BEFORE publish.
function sanitizeCityProxies(caption: string, city: string): string {
  if (!caption || !city) return caption;
  const BLACKLIST = [
    "Not Need", "Weather Update", "Coming Up", "But Comfortable", "Clear Skies",
    "Sunny", "Cloudy", "Overcast", "Rainy", "Stormy", "Foggy", "Windy", "Humid",
    "Hot", "Cold", "Warm", "Cool", "Mild", "Breezy",
    "Partly Cloudy", "Mostly Cloudy", "Mostly Sunny", "Partly Sunny",
    "Scattered Showers", "Thunderstorms", "Drizzle", "Light Rain", "Heavy Rain",
    "Snow", "Sleet", "Haze", "Mist", "Hazy", "Showers",
    "Afternoon", "Morning", "Evening", "Tonight", "Today", "Ahead", "Update",
    "SkyBrief",
  ];
  const cityNoSpaces = city.replace(/\s+/g, "");
  let out = caption;
  for (const term of BLACKLIST) {
    const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s*");
    const noSpaceEsc = term.replace(/\s+/g, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns: Array<{ re: RegExp; sub: string }> = [
      { re: new RegExp(`\\benjoying the weather in ${esc}(?=[^a-zA-Z]|$)`, "gi"), sub: `enjoying the weather in ${city}` },
      { re: new RegExp(`\\bweather in ${esc}(?=[^a-zA-Z]|$)`, "gi"), sub: `weather in ${city}` },
      { re: new RegExp(`\\bdaily ${esc} weather alerts(?=[^a-zA-Z]|$)`, "gi"), sub: `daily ${city} weather alerts` },
      { re: new RegExp(`\\bdaily ${esc} updates(?=[^a-zA-Z]|$)`, "gi"), sub: `daily ${city} updates` },
      { re: new RegExp(`\\bfollow for ${esc} updates(?=[^a-zA-Z]|$)`, "gi"), sub: `follow for ${city} updates` },
      { re: new RegExp(`\\bsubscribe for ${esc} weather alerts(?=[^a-zA-Z]|$)`, "gi"), sub: `subscribe for ${city} weather alerts` },
    ];
    for (const { re, sub } of patterns) out = out.replace(re, sub);
    out = out.replace(new RegExp(`#${noSpaceEsc}\\b`, "gi"), `#${cityNoSpaces}`);
  }
  // Nuclear fallback: any non-city token in the critical CTA slots becomes the city.
  const cityEsc = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  out = out.replace(new RegExp(`(enjoying the weather in )(?!${cityEsc}\\b)([^!.\\n]+)`, "gi"), `$1${city}`);
  out = out.replace(new RegExp(`(daily )(?!${cityEsc}\\b)([^\\n]+?)( weather alerts)`, "gi"), `$1${city}$3`);
  out = out.replace(new RegExp(`(subscribe for )(?!${cityEsc}\\b)([^\\n]+?)( weather alerts)`, "gi"), `$1${city}$3`);
  // Foreign @SkyBrief handle → city-correct handle.
  const expectedHandle = getDynamicHandle(city);
  out = out.replace(/@SkyBrief[A-Za-z0-9_]+/g, (m) => (m === expectedHandle ? m : expectedHandle));
  out = out
    .replace(new RegExp(`##+${cityNoSpaces}`, "gi"), `#${cityNoSpaces}`)
    .replace(new RegExp(`#\\s+${cityNoSpaces}`, "gi"), `#${cityNoSpaces}`);
  return out;
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
Line 1: City + "Weather" + date or "Today"
Line 2: Morning forecast in a few words with temp
Line 3: Afternoon forecast in a few words with temp
Line 4: Evening forecast in a few words with temp
Line 5: Rain chance
Line 6: "What to know:" followed by 2-3 short bullet-style points
Final line: A habit-forming CTA using the provided dynamic_handle (e.g. "Follow @SkyBriefGNV for tomorrow's forecast" or "Check back tomorrow on @SkyBriefMiami")

STYLE RULES:
- Keep total caption under 120 words
- Use emojis sparingly (0-4 max), only weather emojis
- Include a practical takeaway
- If severe weather, shift to calm, clear, alert tone
- Never exaggerate risk
- Never include hashtags unless explicitly requested
- Never write more than one CTA
- The final CTA line MUST use the exact dynamic_handle provided — do not substitute or invent a different handle

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
  return `city: ${weather.city}
state_or_region: ${weather.stateOrRegion}
date: ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
day_of_week: ${dayNames[now.getDay()]}
morning_temp: ${weather.morningTemp ?? "N/A"}
morning_condition: ${weather.morningCondition ?? "N/A"}
afternoon_temp: ${weather.afternoonTemp ?? "N/A"}
afternoon_condition: ${weather.afternoonCondition ?? "N/A"}
evening_temp: ${weather.eveningTemp ?? "N/A"}
evening_condition: ${weather.eveningCondition ?? "N/A"}
rain_chance: ${weather.rainChance}%
wind_info: ${weather.windInfo}
severe_alerts: None
sunrise_time: ${weather.sunrise}
sunset_time: ${weather.sunset}
dynamic_handle: ${handle}
extra_note: `;
}

// --- Platform Adapters (shared) ---
import { postToPlatform } from "../_shared/platform-adapter.ts";

// --- Creatomate Video Generation ---

interface WeatherTheme {
  bg1: string; bg2: string; accent: string;
  glow1: string; glow2: string; emoji: string;
  videoKeyword: string;
}

function getWeatherTheme(condition: string): WeatherTheme {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle")) return { bg1: "#0a1628", bg2: "#152238", accent: "#60a5fa", glow1: "rgba(96,165,250,0.10)", glow2: "rgba(59,130,246,0.06)", emoji: "🌧️", videoKeyword: "rain window dark moody" };
  if (c.includes("thunder") || c.includes("storm")) return { bg1: "#110820", bg2: "#1e1038", accent: "#a78bfa", glow1: "rgba(167,139,250,0.10)", glow2: "rgba(139,92,246,0.06)", emoji: "⛈️", videoKeyword: "lightning storm dark sky" };
  if (c.includes("snow")) return { bg1: "#0c1524", bg2: "#162340", accent: "#93c5fd", glow1: "rgba(147,197,253,0.10)", glow2: "rgba(191,219,254,0.06)", emoji: "❄️", videoKeyword: "snow falling slow motion" };
  if (c.includes("cloud") || c.includes("overcast")) return { bg1: "#0e1420", bg2: "#1a2030", accent: "#94a3b8", glow1: "rgba(148,163,184,0.08)", glow2: "rgba(100,116,139,0.05)", emoji: "☁️", videoKeyword: "clouds sky timelapse moody" };
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return { bg1: "#12121e", bg2: "#1e1e30", accent: "#a1a1aa", glow1: "rgba(161,161,170,0.08)", glow2: "rgba(113,113,122,0.05)", emoji: "🌫️", videoKeyword: "fog mist morning forest" };
  return { bg1: "#0a1020", bg2: "#14203a", accent: "#fbbf24", glow1: "rgba(251,191,36,0.08)", glow2: "rgba(245,158,11,0.05)", emoji: "☀️", videoKeyword: "blue sky sun golden hour" };
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
  if (c.includes("thunder") || c.includes("storm")) return "ALERT: Storms possible this afternoon";
  if (rain > 50 && (c.includes("rain") || c.includes("drizzle"))) return "ALERT: Heavy rain expected";
  if (windNum > 20) return "ALERT: Strong winds this afternoon";
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
  if (!pexelsKey) { console.log("PEXELS_API_KEY not configured"); return null; }

  async function searchPexels(query: string): Promise<string | null> {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=portrait&size=medium`;
    console.log("[bg] Pexels (weather-only) query:", query);
    const res = await fetch(url, { headers: { Authorization: pexelsKey } });
    if (!res.ok) return null;
    const data = await res.json();
    const videos = data.videos || [];
    if (!videos.length) return null;
    const video = videos[Math.floor(Math.random() * videos.length)];
    const files = video.video_files || [];
    const hdFile = files.find((f: any) => f.quality === "hd" && f.width <= 1080)
      || files.find((f: any) => f.quality === "hd")
      || files.find((f: any) => f.quality === "sd")
      || files[0];
    return hdFile?.link || null;
  }

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
    const shuffled = [...queries].sort(() => Math.random() - 0.5);
    for (const q of shuffled) {
      const result = await searchPexels(q);
      if (result) return result;
    }
    return await searchPexels("sky clouds timelapse");
  } catch { return null; }
}

/**
 * Estimate the duration (seconds) of an MP3 buffer produced by ElevenLabs.
 * We request `mp3_44100_128` (CBR 128 kbps) so duration ≈ bytes / (128_000/8) = bytes / 16000.
 * Returns null if bytes is missing/invalid.
 */
function estimateMp3DurationSeconds(byteLength: number | null | undefined): number | null {
  if (!byteLength || byteLength <= 0) return null;
  // 128 kbps CBR → 16,000 bytes/sec. Subtract a tiny ID3/header pad to stay conservative.
  const seconds = byteLength / 16000;
  if (!isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

/**
 * Compute the final composition duration so the voiceover (which starts at t=0.5s)
 * always finishes with at least `tailPad` seconds of silent video at the end,
 * and the total is never shorter than `minDuration`.
 */
const VOICE_START = 0.5;        // seconds — when voice element starts (also where chime ends)
const VOICE_TAIL_PAD = 1.5;     // seconds — silence held after voice ends
const MIN_VIDEO_DURATION = 12;  // seconds — retention sweet spot floor
const MAX_VIDEO_DURATION = 15;  // seconds — short enough to invite re-watch loops

// === Broadcast audio bed (optional, env-configured) ===
// BROADCAST_INTRO_CHIME_URL — 0.3–0.8s short chime that plays t=0 → VOICE_START
// BROADCAST_BG_MUSIC_URL   — soft ambient bed for the whole clip. Ducked to
//   BG_MUSIC_DUCK_VOLUME while the voice is speaking, full volume otherwise.
const BG_MUSIC_FULL_VOLUME = "35%";   // baseline music volume (no voice)
const BG_MUSIC_DUCK_VOLUME = "12%";   // ducked volume while voice is speaking

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
  // Helper: translate "original duration relative to a 10s composition" → actual duration.
  // Original offsets were authored as `10 - time` (so element runs to end). Preserve that.
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

  // === BACKGROUND with Ken Burns slow zoom (100% → 110%) — keeps motion alive
  // even when the source is a still image, which is critical for retention.
  const kenBurns = { type: "scale" as const, start_scale: "100%", end_scale: "110%", duration: dur(10.0), easing: "linear" };
  const elements: any[] = [
    ...(videoUrl ? [
      { type: "video", track: nt(), time: 0, duration: dur(10.0), source: videoUrl, width: "100%", height: "100%", x: "50%", y: "50%", fit: "cover",
        animations: [kenBurns] },
    ] : [
      { type: "shape", track: nt(), time: 0, duration: dur(10.0), shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%", fill_color: `linear-gradient(170deg, ${theme.bg1} 0%, ${theme.bg2} 50%, ${theme.bg1} 100%)`,
        animations: [kenBurns] },
    ]),
    // === Bottom-up shadow gradient — guarantees white text legibility on any
    // bright background. Layered above the background but below all content.
    { type: "shape", track: nt(), time: 0, duration: dur(10.0), shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
      fill_color: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.20) 30%, rgba(0,0,0,0.30) 65%, rgba(0,0,0,0.75) 100%)" },
    // Weather particle / shimmer overlay — three soft, drifting orbs that
    // gently pulse to keep the eye moving across the frame.
    { type: "shape", track: nt(), time: 0, duration: dur(10.0), shape_type: "ellipse", width: 220, height: 220, x: "20%", y: "30%",
      fill_color: "rgba(255,255,255,0.10)",
      animations: [{ type: "scale", start_scale: "80%", end_scale: "120%", duration: 4.0, easing: "ease-in-out" }] },
    { type: "shape", track: nt(), time: 0.5, duration: dur(9.5), shape_type: "ellipse", width: 160, height: 160, x: "78%", y: "55%",
      fill_color: "rgba(255,255,255,0.08)",
      animations: [{ type: "scale", start_scale: "120%", end_scale: "85%", duration: 5.0, easing: "ease-in-out" }] },
    { type: "shape", track: nt(), time: 1.0, duration: dur(9.0), shape_type: "ellipse", width: 280, height: 280, x: "30%", y: "78%",
      fill_color: "rgba(255,255,255,0.06)",
      animations: [{ type: "scale", start_scale: "90%", end_scale: "115%", duration: 6.0, easing: "ease-in-out" }] },
    { type: "shape", track: nt(), time: 0, duration: dur(10.0), shape_type: "ellipse", width: 1400, height: 1400, x: "75%", y: "30%", fill_color: theme.glow1,
      animations: [{ type: "scale", start_scale: "95%", end_scale: "108%", duration: dur(10.0), easing: "linear" }] },
    { type: "text", track: nt(), time: 0, duration: dur(10.0), text: "SKYBRIEF", font_family: "Inter", font_weight: "700", font_size: "42", fill_color: "#ffffff", letter_spacing: "18%",
      x: "50%", y: "7%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } },
    { type: "shape", track: nt(), time: 0.2, duration: dur(9.8), shape_type: "rectangle", width: 60, height: 3, x: "50%", y: "9.5%", fill_color: theme.accent, border_radius: "2",
      enter: { type: "scale", start_scale: "0%", duration: 0.6 } },

    // === TIME PERIOD BADGE ===
    { type: "shape", track: nt(), time: 0.3, duration: dur(9.7), shape_type: "rectangle", width: 420, height: 50, x: "50%", y: "12%",
      fill_color: "rgba(255,255,255,0.12)", border_radius: "25",
      enter: { type: "fade", duration: 0.4 } },
    { type: "text", track: nt(), time: 0.3, duration: dur(9.7), text: periodLabel, font_family: "Inter", font_weight: "700", font_size: "28", fill_color: theme.accent, letter_spacing: "4%",
      x: "50%", y: "12%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.4 } },

    { type: "shape", track: nt(), time: 0.2, duration: dur(9.8), shape_type: "rectangle", width: 800, height: 200, x: "50%", y: "18%",
      fill_color: "rgba(0,0,0,0.35)", border_radius: "14", enter: { type: "fade", duration: 0.4 } },
    { type: "text", track: nt(), time: 0.3, duration: dur(9.7), text: weather.city.toUpperCase(), font_family: "Inter", font_weight: "800", font_size: "88", fill_color: "#ffffff",
      x: "50%", y: "16%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.5 } },
    { type: "text", track: nt(), time: 0.5, duration: dur(9.5), text: `${weather.stateOrRegion}  ·  ${dateStr}`, font_family: "Inter", font_weight: "500", font_size: "30", fill_color: "rgba(255,255,255,0.65)",
      x: "50%", y: "21%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } },
    { type: "text", track: nt(), time: 0.6, duration: dur(9.4), text: theme.emoji, font_size: "80",
      x: "50%", y: "30%", x_alignment: "50%", y_alignment: "50%", enter: { type: "scale", start_scale: "50%", duration: 0.6 } },
    { type: "text", track: nt(), time: 0.7, duration: dur(9.3), text: `${weather.temperature}°`, font_family: "Inter", font_weight: "900", font_size: "180", fill_color: "#ffffff",
      x: "50%", y: "42%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "scale", start_scale: "60%", duration: 0.6 } },
    { type: "text", track: nt(), time: 0.9, duration: dur(9.1), text: weather.description.charAt(0).toUpperCase() + weather.description.slice(1),
      font_family: "Inter", font_weight: "600", font_size: "38", fill_color: theme.accent,
      x: "50%", y: "51%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } },
    { type: "shape", track: nt(), time: 1.3, duration: dur(8.7), shape_type: "rectangle", width: 920, height: 260, x: "50%", y: "63%",
      fill_color: "rgba(10,15,30,0.65)", border_radius: "28", border_width: 1, border_color: "rgba(255,255,255,0.10)",
      shadow: "inset 0 1px 0 rgba(255,255,255,0.05)", enter: { type: "scale", start_scale: "92%", duration: 0.5 } },
    { type: "text", track: nt(), time: 1.5, duration: dur(8.5), text: "HIGH", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
      x: "17%", y: "58.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: dur(8.5), text: "LOW", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
      x: "39%", y: "58.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: dur(8.5), text: "RAIN", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
      x: "61%", y: "58.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: dur(8.5), text: "WIND", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
      x: "83%", y: "58.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.7, duration: dur(8.3), text: `${hi}°`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
      x: "17%", y: "63.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 1.8, duration: dur(8.2), text: `${lo}°`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
      x: "39%", y: "63.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 1.9, duration: dur(8.1), text: `${weather.rainChance}%`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
      x: "61%", y: "63.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 2.0, duration: dur(8.0), text: windSpeed, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
      x: "83%", y: "63.5%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "shape", track: nt(), time: 1.6, duration: dur(8.4), shape_type: "rectangle", width: 1, height: 80, x: "28%", y: "61.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },
    { type: "shape", track: nt(), time: 1.6, duration: dur(8.4), shape_type: "rectangle", width: 1, height: 80, x: "50%", y: "61.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },
    { type: "shape", track: nt(), time: 1.6, duration: dur(8.4), shape_type: "rectangle", width: 1, height: 80, x: "72%", y: "61.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },
  ];

  if (alertLine) {
    elements.push(
      { type: "text", track: nt(), time: 2.2, duration: dur(7.8), text: alertLine, font_family: "Inter", font_weight: "700", font_size: "30", fill_color: "#fbbf24",
        x: "50%", y: "73%", x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } }
    );
  }

  const takeawayY = alertLine ? "77%" : "74%";
  elements.push(
    { type: "text", track: nt(), time: 2.5, duration: dur(7.5), text: takeaway, font_family: "Inter", font_weight: "600", font_size: "32", fill_color: "#ffffff",
      x: "50%", y: takeawayY, x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.6 } }
  );

  const tomorrowY = alertLine ? "81%" : "78.5%";
  elements.push(
    { type: "text", track: nt(), time: 3.0, duration: dur(7.0), text: tomorrowPreview, font_family: "Inter", font_weight: "500", font_size: "28", fill_color: "rgba(255,255,255,0.6)",
      x: "50%", y: tomorrowY, x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.5 } }
  );

  const ctaDivY = alertLine ? "86%" : "84%";
  const ctaTextY = alertLine ? "90%" : "88%";
  elements.push(
    { type: "shape", track: nt(), time: 3.5, duration: dur(6.5), shape_type: "rectangle", width: 80, height: 2, x: "50%", y: ctaDivY, fill_color: theme.accent, border_radius: "1",
      enter: { type: "scale", start_scale: "0%", duration: 0.5 } },
    { type: "text", track: nt(), time: 3.8, duration: dur(6.2), text: habitCTA, font_family: "Inter", font_weight: "500", font_size: "28", fill_color: "rgba(255,255,255,0.55)",
      x: "50%", y: ctaTextY, x_alignment: "50%", y_alignment: "50%", shadow: "0px 2px 4px rgba(0,0,0,0.5)", enter: { type: "fade", duration: 0.6 } },
  );

  // === FINAL "LIKE" PULSE BADGE ===
  // Appears for the last ~2.5s as the voiceover asks for the like. Top-right
  // placement keeps it out of the way of the centered CTA stack.
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
  // Pulsing red Subscribe pill + shaking bell icon, branded "@SkyBrief{City}".
  // Lands at the same time the voiceover asks for the subscribe + bell.
  const subStart = Math.max(0.5, D - 3.0);
  const subDur = Math.max(0.5, D - subStart);
  const cityHandle = (weather.city || "").replace(/[^A-Za-z0-9]/g, "");
  const handleText = cityHandle ? `Subscribe to @SkyBrief${cityHandle}` : "Subscribe for daily weather";
  elements.push(
    // Red Subscribe pill (pulse via scale animation)
    { type: "shape", track: nt(), time: subStart, duration: subDur, shape_type: "rectangle",
      width: 720, height: 130, x: "50%", y: "94%",
      fill_color: "#ff0000", border_radius: "65",
      shadow: "0px 6px 18px rgba(255,0,0,0.45)",
      enter: { type: "scale", start_scale: "60%", duration: 0.5 },
      animations: [{ type: "scale", start_scale: "100%", end_scale: "108%", duration: 0.6, easing: "ease-in-out", reversed: false }] },
    { type: "text", track: nt(), time: subStart, duration: subDur, text: "▶  SUBSCRIBE",
      font_family: "Inter", font_weight: "900", font_size: "52", fill_color: "#ffffff", letter_spacing: "4%",
      x: "44%", y: "94%", x_alignment: "50%", y_alignment: "50%" },
    // Shaking bell badge to the right of the pill
    { type: "shape", track: nt(), time: subStart, duration: subDur, shape_type: "ellipse",
      width: 110, height: 110, x: "70%", y: "94%", fill_color: "#ffffff",
      shadow: "0px 4px 12px rgba(0,0,0,0.35)",
      animations: [{ type: "scale", start_scale: "100%", end_scale: "115%", duration: 0.5, easing: "ease-in-out" }] },
    { type: "text", track: nt(), time: subStart, duration: subDur, text: "🔔",
      font_size: "70", x: "70%", y: "94%", x_alignment: "50%", y_alignment: "50%",
      animations: [{ type: "scale", start_scale: "100%", end_scale: "115%", duration: 0.5, easing: "ease-in-out" }] },
    // Channel handle line above the pill
    { type: "text", track: nt(), time: subStart, duration: subDur, text: handleText,
      font_family: "Inter", font_weight: "700", font_size: "30", fill_color: "#ffffff", letter_spacing: "3%",
      x: "50%", y: "89%", x_alignment: "50%", y_alignment: "50%",
      shadow: "0px 2px 4px rgba(0,0,0,0.6)", enter: { type: "fade", duration: 0.4 } },
  );

  // === AI VOICEOVER + BROADCAST AUDIO BED (optional) ===
  // Three audio layers:
  //   1. Intro chime  (t=0 → VOICE_START)              — gives it a broadcast feel
  //   2. Background music (whole clip, ducked while voice is playing)
  //   3. Voiceover    (starts at VOICE_START, full volume)
  // All three are optional and independently degrade — missing music URL ⇒ no
  // music layer; missing chime URL ⇒ no chime; missing voice ⇒ music plays at
  // full volume the whole way through.
  const introChimeUrl = (Deno.env.get("BROADCAST_INTRO_CHIME_URL") || "").trim();
  const bgMusicUrl    = (Deno.env.get("BROADCAST_BG_MUSIC_URL") || "").trim();
  const audioLen = voiceUrl
    ? (typeof audioDurationSec === "number" && isFinite(audioDurationSec) && audioDurationSec > 0
        ? audioDurationSec
        : Math.max(0.1, D - VOICE_START))
    : 0;
  const voiceEnd = voiceUrl ? Math.min(D, VOICE_START + audioLen) : 0;

  // 1) Intro chime — only when voice is playing (so it actually feels like an intro).
  if (voiceUrl && introChimeUrl) {
    elements.push({
      type: "audio",
      track: nt(),
      time: 0,
      duration: Math.min(0.6, VOICE_START),
      source: introChimeUrl,
      volume: "85%",
    });
  }

  // 2) Background music — ducks while voice is playing.
  // A short 0.4s fade-in is applied to the FIRST music segment so the bed
  // eases in instead of starting abruptly at full volume.
  // A matching 0.4s fade-out on the LAST music segment gives a clean
  // broadcast finish.
  const BG_MUSIC_FADE_IN = 0.4; // seconds
  const BG_MUSIC_FADE_OUT = 0.4; // seconds
  if (bgMusicUrl) {
    if (voiceUrl) {
      // Pre-voice segment at full volume (includes chime tail).
      if (VOICE_START > 0.05) {
        elements.push({
          type: "audio", track: nt(), time: 0, duration: VOICE_START,
          source: bgMusicUrl, volume: BG_MUSIC_FULL_VOLUME,
          audio_fade_in: BG_MUSIC_FADE_IN,
        });
      }
      // Ducked segment under the voice. When there's no pre-voice segment
      // (VOICE_START is tiny), apply the fade-in here so we never start cold.
      // If there is no tail segment after the voice, this is the last music
      // segment and also gets the fade-out.
      const hasTail = D - voiceEnd > 0.05;
      elements.push({
        type: "audio", track: nt(), time: VOICE_START, duration: Math.max(0.1, voiceEnd - VOICE_START),
        source: bgMusicUrl, volume: BG_MUSIC_DUCK_VOLUME,
        ...(VOICE_START <= 0.05 ? { audio_fade_in: BG_MUSIC_FADE_IN } : {}),
        ...(!hasTail ? { audio_fade_out: BG_MUSIC_FADE_OUT } : {}),
      });
      // Tail segment back to full volume.
      if (hasTail) {
        elements.push({
          type: "audio", track: nt(), time: voiceEnd, duration: D - voiceEnd,
          source: bgMusicUrl, volume: BG_MUSIC_FULL_VOLUME,
          audio_fade_out: BG_MUSIC_FADE_OUT,
        });
      }
    } else {
      // No voice → music plays the entire clip at full volume.
      elements.push({
        type: "audio", track: nt(), time: 0, duration: D,
        source: bgMusicUrl, volume: BG_MUSIC_FULL_VOLUME,
        audio_fade_in: BG_MUSIC_FADE_IN,
        audio_fade_out: BG_MUSIC_FADE_OUT,
      });
    }
  }

  // 3) Voiceover — starts at VOICE_START, never trimmed (CTA must finish).
  if (voiceUrl) {
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

  // ── CINEMATIC ENHANCEMENTS LAYER ──
  // Activated when visualStyle === "cinematic" (set by ENABLE_CINEMATIC_MODE
  // override or weather-driven detection upstream). Additive only:
  //  • condition-matched overlays (rain / fog / snow / vignette)
  //  • subtle float animation injected onto existing card layers
  // Background Ken-Burns zoom (1.0 → 1.10) is already applied above for every
  // render and remains active in cinematic mode.
  if (visualStyle === "cinematic") {
    const condLower = (weather.condition || "").toLowerCase();
    // Strict cinematic conditions: rain family, storm/thunder, cloudy/overcast.
    // Fog/mist/snow do NOT trigger cinematic overlays per product rule.
    const isRain   = condLower.includes("rain") || condLower.includes("drizzle") || condLower.includes("shower");
    const isStorm  = condLower.includes("storm") || condLower.includes("thunder");
    const isCloudy = condLower.includes("cloudy") || condLower.includes("overcast");

    // Storm/thunder: dark vignette + grain feel (opacity ~10%). Always-on
    // vignette is reserved for storm so we don't darken light cloudy scenes.
    if (isStorm) {
      elements.push({
        type: "shape", track: nt(), time: 0, duration: dur(10.0),
        shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
        fill_color: "radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.10) 100%)",
        enter: { type: "fade", duration: 0.8 },
      });
    }
    // Rain/drizzle/shower: subtle cool blue overlay (opacity 8%).
    if (isRain) {
      elements.push({
        type: "shape", track: nt(), time: 0, duration: dur(10.0),
        shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
        fill_color: "linear-gradient(180deg, rgba(30,58,138,0.08) 0%, rgba(15,23,42,0.06) 100%)",
        enter: { type: "fade", duration: 0.8 },
      });
    }
    // Cloudy/overcast: soft fog layer (opacity 6%).
    if (isCloudy) {
      elements.push({
        type: "shape", track: nt(), time: 0, duration: dur(10.0),
        shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
        fill_color: "linear-gradient(180deg, rgba(220,225,235,0.06) 0%, rgba(200,210,225,0.04) 100%)",
        enter: { type: "fade", duration: 1.0 },
      });
    }

    // Subtle card float — 5s loop, injected onto existing city header + detail
    // card shapes (no JSON structure changes, only `animations` property,
    // reusing the existing "scale" animation type per hard-rule constraint).
    for (const el of elements) {
      if (!el || el.type !== "shape" || el.shape_type !== "rectangle") continue;
      const isCityPanel = el.width === 800 && el.height === 200 && el.y === "18%";
      const isDetailCard = el.width === 920 && el.height === 260 && el.y === "63%";
      if (!isCityPanel && !isDetailCard) continue;
      const float = { type: "scale", start_scale: "100%", end_scale: "101%", duration: 5.0, easing: "ease-in-out" };
      el.animations = Array.isArray(el.animations) ? [...el.animations, float] : [float];
    }

    console.log(`[cinematic] enhancements applied: rain=${isRain} storm=${isStorm} cloudy=${isCloudy} card_float=on`);
  }

  return {
    width: 1080, height: 1920, duration: D, frame_rate: 30, fill_color: theme.bg1,
    elements,
  };
}

// =============================================================
// === AI VOICE NARRATION (Voice Script + ElevenLabs TTS) ====
// Mirrors the helpers in daily-weather-post so auto-posts get
// the same voiceover quality as manual "Post Now" actions.
// =============================================================

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

// === ELEVENLABS API KEY RESOLVER ===
// Background workers run on the service_role side and only see the secrets the
// project explicitly registered. Different docs/migrations have used two names
// (ELEVENLABS_API_KEY and ELEVEN_LABS_API_KEY), so we accept either to make
// the worker robust against accidental rename. We also expose the source name
// in logs so misconfigurations are obvious without leaking the key value.
function resolveElevenLabsKey(): { value: string; source: string } | null {
  const candidates = ["ELEVENLABS_API_KEY", "ELEVEN_LABS_API_KEY", "ELEVENLABS_KEY"];
  for (const name of candidates) {
    const v = Deno.env.get(name);
    if (v && v.trim().length > 0) return { value: v.trim(), source: name };
  }
  return null;
}

function clampVoiceParam(n: any, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** Time-of-day greeting derived from slot or local hour. */
function broadcastGreetingFor(slot?: string | null): string {
  const s = (slot || "").toLowerCase();
  if (s === "morning") return "Good morning";
  if (s === "afternoon") return "Good afternoon";
  if (s === "evening") return "Good evening";
  const h = new Date().getUTCHours();
  if (h < 11) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

async function generateVoiceScript(
  weather: WeatherResponse,
  tone?: string,
  platforms?: string[],
  ctaOpts?: { subscribeCta?: boolean; city?: string | null; slot?: string | null },
): Promise<string> {
  const ctaCity = ctaOpts?.city ?? weather.city;
  const subscribeCta = ctaOpts?.subscribeCta ?? false;
  const slot = ctaOpts?.slot ?? null;
  const greeting = broadcastGreetingFor(slot);
  const feels = typeof weather.feelsLike === "number" ? Math.round(weather.feelsLike) : null;
  const temp = Math.round(weather.temperature);
  const cond = weather.description.toLowerCase();
  // Broadcast-style fallback always includes greeting + city + temp + feels-like.
  const fallback = feels != null && Math.abs(feels - temp) >= 2
    ? `${greeting}, ${weather.city}. Right now it's ${temp} degrees, feels like ${feels}, with ${cond}. Here's your quick weather update.`
    : `${greeting}, ${weather.city}. It's currently ${temp} degrees with ${cond}. Here's your quick weather update.`;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return appendVoiceCTA(fallback, { tone, platforms, subscribeCta, city: ctaCity });
  const userPrompt = [
    `City: ${weather.city}`,
    `Slot: ${slot ?? "(unknown)"}  → opening greeting: "${greeting}, ${weather.city}"`,
    `Condition: ${weather.description}`,
    `Current temp: ${temp}°F`,
    feels != null ? `Feels like: ${feels}°F` : `Feels like: (unavailable — do not invent)`,
    `Rain chance: ${weather.rainChance}%`,
    "",
    "Write a BROADCAST WEATHER SCRIPT for a 10–15 second on-air read. Strict rules:",
    `- OPEN with the greeting verbatim: "${greeting}, ${weather.city}." (or a close variant like "Checking in on ${weather.city}").`,
    "- 2–3 short sentences, 30–45 words total. Sound like a local weather anchor — warm, conversational, never robotic.",
    "- MUST include the current temperature in degrees.",
    feels != null && Math.abs(feels - temp) >= 2
      ? "- MUST mention 'feels like' followed by the feels-like temperature (the gap is noticeable)."
      : "- You MAY skip 'feels like' if it's within 1 degree of the actual temp.",
    "- Mention the dominant weather condition in plain words (e.g. 'clear skies', 'light rain', 'partly cloudy').",
    "- One brief outlook phrase is welcome (e.g. 'staying mild through the evening', 'rain easing overnight').",
    "- No emojis, no hashtags, no special characters, no abbreviations like 'F' — say 'degrees'.",
    "- You MAY include AT MOST ONE local reference from the verified list below, only if it fits naturally. Otherwise omit.",
    "- Do NOT include any subscribe / follow / notification / bell CTA — that is appended automatically. End on the weather, not a CTA.",
    "- Return ONLY the script text. No labels, no quotes.",
    "",
    buildVerifiedLandmarksBlock(weather.city),
  ].join("\n");
  const systemPrompt = `You are a professional local broadcast weather anchor writing a 10–15 second on-air script. Warm, conversational, accurate. Output spoken-style scripts only.\n\n${LOCATION_ACCURACY_RULES}`;
  const alertMode = isWeatherAlert({
    condition: weather.description,
    temperature: weather.temperature,
    rainChance: weather.rainChance,
  });
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) { console.error("[voice] script AI failed:", res.status); return appendVoiceCTA(fallback, { tone, platforms, alertMode, subscribeCta, city: ctaCity }); }
    const data = await res.json();
    const script = data?.choices?.[0]?.message?.content?.trim() || fallback;
    const validation = validateCaptionLocation(script, weather.city);
    let finalScript = script;
    if (!validation.ok) {
      console.warn(`[voice] foreign landmarks in script for ${weather.city}:`, validation.hits, "— sanitizing");
      finalScript = stripUnverifiedReferences(script, weather.city);
    }
    return appendVoiceCTA(finalScript, { tone, platforms, alertMode, subscribeCta, city: ctaCity });
  } catch (e) {
    console.error("[voice] script error:", e);
    return appendVoiceCTA(fallback, { tone, platforms, alertMode, subscribeCta, city: ctaCity });
  }
}

// Result type so callers can distinguish 401 / timeout / other failures and
// surface meaningful notifications to the System Health bell.
export interface VoiceAttemptLog {
  attempt: number;
  status: number | "timeout" | "network_error" | "missing_key";
  ok: boolean;
  error?: string;
}

type VoiceAudioResult =
  | { ok: true; bytes: Uint8Array; attempts: VoiceAttemptLog[] }
  | { ok: false; reason: "missing_key" | "unauthorized" | "timeout" | "http_error" | "network_error"; status?: number; detail?: string; attempts: VoiceAttemptLog[] };

async function generateVoiceAudio(
  script: string,
  voiceId: string,
  opts?: { speed?: number; stability?: number; similarity?: number },
): Promise<VoiceAudioResult> {
  const attempts: VoiceAttemptLog[] = [];
  // Re-resolve the env var on every call so a key rotation mid-run is picked
  // up without redeploying the worker. The resolver accepts both the canonical
  // ELEVENLABS_API_KEY and the legacy ELEVEN_LABS_API_KEY name.
  const initial = resolveElevenLabsKey();
  if (!initial) {
    console.error("Error: ElevenLabs Key not found in environment");
    console.error("CRITICAL: ElevenLabs API Key missing in worker (checked: ELEVENLABS_API_KEY, ELEVEN_LABS_API_KEY)");
    attempts.push({ attempt: 1, status: "missing_key", ok: false, error: "No ElevenLabs API key found in env (tried ELEVENLABS_API_KEY, ELEVEN_LABS_API_KEY)" });
    return { ok: false, reason: "missing_key", attempts };
  }
  let apiKey: string = initial.value;
  const keySource: string = initial.source;
  console.log(`[voice] using ElevenLabs key from env var "${keySource}"`);

  const speed = clampVoiceParam(opts?.speed, 0.7, 1.2, 1.05);
  const stability = clampVoiceParam(opts?.stability, 0, 1, 0.55);
  const similarity = clampVoiceParam(opts?.similarity, 0, 1, 0.78);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${resolveVoiceId(voiceId)}?output_format=mp3_44100_128`;
  const body = JSON.stringify({
    text: script,
    model_id: "eleven_turbo_v2_5",
    voice_settings: { stability, similarity_boost: similarity, style: 0.35, use_speaker_boost: true, speed },
  });

  const MAX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "xi-api-key": apiKey!, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 401) {
        const detail = (await res.text()).slice(0, 200);
        console.error(`[voice] ElevenLabs 401 Unauthorized (attempt ${attempt}/${MAX_ATTEMPTS}):`, detail);
        attempts.push({ attempt, status: 401, ok: false, error: detail || "Unauthorized" });
        if (attempt < MAX_ATTEMPTS) {
          const refreshed = resolveElevenLabsKey();
          if (!refreshed) {
            console.error("CRITICAL: ElevenLabs API Key missing in worker (during 401 retry)");
            return { ok: false, reason: "missing_key", attempts };
          }
          apiKey = refreshed.value;
          console.warn(`[voice] backoff 2s before retry (after 401, key source="${refreshed.source}")`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return { ok: false, reason: "unauthorized", status: 401, detail, attempts };
      }

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        console.error(`[voice] ElevenLabs TTS failed (attempt ${attempt}/${MAX_ATTEMPTS}): status=${res.status}`, detail);
        attempts.push({ attempt, status: res.status, ok: false, error: detail });
        if (attempt < MAX_ATTEMPTS && res.status >= 500) {
          console.warn(`[voice] backoff 2s before retry (after ${res.status})`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return { ok: false, reason: "http_error", status: res.status, detail, attempts };
      }

      attempts.push({ attempt, status: 200, ok: true });
      return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()), attempts };
    } catch (e) {
      clearTimeout(timeoutId);
      const isAbort = (e as any)?.name === "AbortError";
      if (isAbort) {
        console.error(`[voice] ElevenLabs TTS timed out after 30s (attempt ${attempt}/${MAX_ATTEMPTS})`);
        attempts.push({ attempt, status: "timeout", ok: false, error: "exceeded 30s" });
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[voice] backoff 2s before retry (after timeout)`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return { ok: false, reason: "timeout", detail: "ElevenLabs request exceeded 30s", attempts };
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      console.error(`[voice] ElevenLabs TTS error (attempt ${attempt}/${MAX_ATTEMPTS}):`, e);
      attempts.push({ attempt, status: "network_error", ok: false, error: errMsg });
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[voice] backoff 2s before retry (after network error)`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return { ok: false, reason: "network_error", detail: errMsg, attempts };
    }
  }
  return { ok: false, reason: "network_error", detail: "exhausted retries", attempts };
}

async function storeVoiceAudio(supabase: any, userId: string, audio: Uint8Array): Promise<string | null> {
  const path = `${userId}/voice-${Date.now()}.mp3`;
  const { error: upErr } = await supabase.storage
    .from("weather-videos")
    .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
  if (upErr) { console.error("[voice] upload error:", upErr); return null; }
  const { data: signed, error: signErr } = await supabase.storage
    .from("weather-videos")
    .createSignedUrl(path, 3600);
  if (signErr || !signed?.signedUrl) { console.error("[voice] sign url error:", signErr); return null; }
  return signed.signedUrl;
}

async function generateWeatherVideo(weather: WeatherResponse, timePeriod?: string | null, voiceUrl?: string | null, audioDurationSec?: number | null, visualStyle?: string | null, errorSink?: { message?: string; templateConfigError?: boolean }): Promise<{ data: Uint8Array; mimeType: string; duration?: number } | { creditExhausted: true; provider: "creatomate"; message?: string } | null> {
  const apiKey = Deno.env.get("CREATOMATE_API_KEY");
  const setErr = (m: string) => { if (errorSink) errorSink.message = m; console.error("[creatomate] error:", m); };
  if (!apiKey) {
    setErr("CREATOMATE_API_KEY not configured in Supabase edge function secrets");
    return null;
  }
  console.log(`[creatomate] api_key_present=true api_key_prefix=${apiKey.slice(0, 4)}... length=${apiKey.length}`);

  const compDuration = computeVideoDuration(audioDurationSec);
  console.log(`Starting Creatomate render for ${weather.city} ${voiceUrl ? "(with voiceover)" : "(no voice)"} — composition ${compDuration.toFixed(2)}s (audio=${audioDurationSec ?? "n/a"}s) — visualStyle=${visualStyle || "default"}`);
  const theme = getWeatherTheme(weather.condition);
  // AI Visual Optimization — "gradient" / "minimal" styles intentionally skip
  // the Pexels stock-video background to keep the visual pure (gradient only).
  const skipStockVideo = visualStyle === "gradient" || visualStyle === "minimal";
  let videoUrl = skipStockVideo ? null : await fetchPexelsVideoUrl(theme.videoKeyword, weather.city, weather.stateOrRegion);
  // ── Pre-render asset validation ──
  // Make sure the background URL is non-empty AND actually reachable. If the
  // HEAD probe fails, we drop it and let Creatomate render the gradient-only
  // template instead of a black screen from a broken asset.
  if (videoUrl && (typeof videoUrl !== "string" || !/^https?:\/\//i.test(videoUrl))) {
    console.warn(`[render] background URL invalid format — dropping: ${String(videoUrl).slice(0, 80)}`);
    videoUrl = null;
  }
  if (videoUrl) {
    try {
      const probe = await fetch(videoUrl, { method: "HEAD" });
      if (!probe.ok) {
        console.warn(`[render] background HEAD probe failed (${probe.status}) — falling back to gradient`);
        videoUrl = null;
      }
    } catch (e) {
      console.warn(`[render] background HEAD probe error — falling back to gradient:`, (e as Error).message);
      videoUrl = null;
    }
  }
  if (!videoUrl) {
    console.warn(`[render] Pexels background unavailable (keyword="${theme.videoKeyword}", style="${visualStyle || "default"}") — using safe gradient (${theme.bg1} → ${theme.bg2})`);
  } else {
    console.log(`[render] Pexels background validated for "${theme.videoKeyword}"`);
  }
  let source: Record<string, any>;
  try {
    source = sanitizeCreatomateSource(buildCreatomateSource(weather, videoUrl, timePeriod, voiceUrl, audioDurationSec, visualStyle) as Record<string, any>);
  } catch (error) {
    setErr(`Creatomate source validation failed before API call: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

  // ── Phase 2B: pre-render structural guards ──
  // Hard-fail before we waste an API call (and credits) when the render spec
  // is malformed. A bad template_id is the #1 cause of "succeeded" renders
  // that produce a black screen.
  if (!source || typeof source !== "object") {
    setErr("Creatomate source is not a valid object after sanitize");
    return null;
  }
  if ("template_id" in source) {
    const tid = (source as any).template_id;
    if (typeof tid !== "string" || tid.trim().length === 0) {
      if (errorSink) errorSink.templateConfigError = true;
      setErr(`Creatomate template_id invalid (got ${typeof tid}: "${String(tid).slice(0, 80)}") — treat as config error`);
      return null;
    }
  }

  // Medium-quality render: 0.75 scale (810x1440 from a 1080x1920 source)
  // dramatically cuts Creatomate render time so we stay inside the worker
  // window. Visually indistinguishable for vertical mobile playback.
  const requestBody = JSON.stringify({
    output_format: "mp4",
    render_scale: 0.75,
    frame_rate: 30,
    ...source,
  });
  const root: any = source;
  console.log(`[creatomate] source_valid=true output_format=mp4 elements=${Array.isArray(root.elements) ? root.elements.length : 0} background_video_source=${videoUrl ? "mapped" : "none"}`);
  console.log(
    `[render] creatomate_request_sent=true template_id=${(source as any)?.template_id ?? "inline_source"} background_url=${videoUrl ? videoUrl.split("?")[0] : "(gradient)"} audio_url=${voiceUrl ? voiceUrl.split("?")[0] : "(none)"} audio_dur=${audioDurationSec ?? "n/a"}s comp_dur=${compDuration.toFixed(2)}s`,
  );
  console.log("Creatomate request body (first 300 chars):", requestBody.substring(0, 300));
  
  const renderRes = await fetch("https://api.creatomate.com/v2/renders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
  });

  const responseText = await renderRes.text();
  console.log("Creatomate raw response status:", renderRes.status);
  console.log("Creatomate raw response body:", responseText.substring(0, 1500));

  // Try to parse the response so we can surface the REAL error field.
  let parsedResponse: any = null;
  try { parsedResponse = JSON.parse(responseText); } catch { /* keep raw */ }
  const apiError =
    (parsedResponse && (parsedResponse.error || parsedResponse.message || parsedResponse.error_message)) ||
    null;
  console.log("Creatomate parsed error field:", apiError);

  if (!renderRes.ok) {
    const detail = apiError || responseText.slice(0, 300) || `HTTP ${renderRes.status}`;
    // Map Creatomate HTTP status codes to actionable, human-readable errors.
    let mapped: string;
    switch (renderRes.status) {
      case 401:
        mapped = "Invalid Creatomate API key (401). Check CREATOMATE_API_KEY secret.";
        break;
      case 403:
        mapped = `Creatomate access forbidden (403): ${detail}`;
        break;
      case 404:
        mapped = "Creatomate template not found (404). We render from inline source — this usually means the endpoint or render id is wrong.";
        break;
      case 422:
        mapped = `Creatomate validation error (422): ${detail}`;
        break;
      case 429:
        mapped = `Creatomate rate limited (429): ${detail}`;
        break;
      case 402:
        mapped = `Creatomate payment required (402): ${detail}`;
        break;
      default:
        mapped = `Creatomate ${renderRes.status}: ${detail}`;
    }
    console.error(`[creatomate] ${mapped}`);
    setErr(mapped);
    const lower = (responseText + " " + (apiError || "")).toLowerCase();
    // Phase 2C: distinguish template-config errors (real config bug) from
    // transient failures (rate-limit, 5xx, timeout). When the upstream API
    // is explicit about template_not_found / no_template, mark the errorSink
    // so the publish gate can hold YouTube uploads on the fallback render.
    if (
      lower.includes("no template") ||
      lower.includes("template not found") ||
      lower.includes("template_not_found") ||
      lower.includes("invalid template")
    ) {
      if (errorSink) errorSink.templateConfigError = true;
      console.error("[creatomate] TEMPLATE_CONFIG_ERROR detected — fallback renders will NOT auto-publish to video platforms");
    }
    // STRICT credit-exhaustion detection.
    const isCreditExhausted =
      renderRes.status === 402 ||
      lower.includes("no_credits") ||
      lower.includes("insufficient credit") ||
      lower.includes("out of credit") ||
      lower.includes("credit exhausted") ||
      lower.includes("credits exhausted");
    if (isCreditExhausted) {
      return { creditExhausted: true, provider: "creatomate", message: mapped };
    }
    return null;
  }

  const renders = parsedResponse;
  if (!renders) {
    setErr("Failed to parse Creatomate response as JSON");
    return null;
  }

  const renderId = Array.isArray(renders) ? renders[0]?.id : renders?.id;
  if (!renderId) {
    setErr(`Creatomate returned no render id (response: ${responseText.slice(0, 200)})`);
    return null;
  }

  console.log("Creatomate render started, ID:", renderId);

  // Poll budget: 18 ticks × 5s = 90s minimum before any fallback path.
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusRes = await fetch(`https://api.creatomate.com/v1/renders/${renderId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!statusRes.ok) {
      console.error("Creatomate status check failed:", statusRes.status);
      continue;
    }

    const statusData = await statusRes.json();
    console.log(`Render ${renderId} status: ${statusData.status} (poll ${i + 1}/18, ~${(i + 1) * 5}s)`);

    // ── Detect partial success / asset-load errors ──
    // Creatomate sometimes returns status=succeeded but flags asset failures
    // in `warnings`, `error_message`, or a non-"completed" sub-state. Treat
    // any of those as a hard failure so we never publish a black screen.
    const warnings: any[] = Array.isArray(statusData.warnings) ? statusData.warnings : [];
    const assetIssue =
      (statusData.error_message && String(statusData.error_message).length > 0) ||
      warnings.some((w) => {
        const s = JSON.stringify(w).toLowerCase();
        return s.includes("asset") || s.includes("source") || s.includes("download") || s.includes("load");
      });

    if (statusData.status === "succeeded" && statusData.url) {
      if (assetIssue) {
        const m = `Creatomate asset load issue: ${statusData.error_message ?? JSON.stringify(warnings).slice(0, 200)}`;
        setErr(m);
        return null;
      }
      console.log("Render complete, downloading video...");
      const videoRes = await fetch(statusData.url);
      if (!videoRes.ok) {
        setErr(`Failed to download rendered video (HTTP ${videoRes.status})`);
        return null;
      }
      const arrayBuf = await videoRes.arrayBuffer();
      const reportedDurationSec = typeof statusData.duration === "number" ? statusData.duration : null;
      console.log(`Video downloaded: ${arrayBuf.byteLength} bytes, reported duration ${reportedDurationSec ?? "?"}s`);
      // ── Render validation: reject false-positive successes ──
      const MIN_BYTES = 50_000;     // <50KB → almost certainly empty/black
      const MIN_DURATION_SEC = 5;
      if (arrayBuf.byteLength < MIN_BYTES) {
        setErr(`Rendered video too small (${arrayBuf.byteLength} bytes < ${MIN_BYTES})`);
        return null;
      }
      if (reportedDurationSec !== null && reportedDurationSec < MIN_DURATION_SEC) {
        setErr(`Rendered video too short (${reportedDurationSec}s < ${MIN_DURATION_SEC}s)`);
        return null;
      }
      return { data: new Uint8Array(arrayBuf), mimeType: "video/mp4", duration: reportedDurationSec ?? undefined };
    }

    if (statusData.status === "failed" || statusData.status === "partial") {
      const detail = statusData.error_message || statusData.error || "unknown render error";
      setErr(`Creatomate ${statusData.status}: ${detail}`);
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
  const personUrn = parts.length > 2 ? parts[2] : null;

  try {
    console.log("LinkedIn: Registering image upload for", authorUrn);
    let registerRes = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": "202601",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn } }),
    });
    let registerData = await registerRes.json();

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
        body: JSON.stringify({ initializeUploadRequest: { owner: personUrn } }),
      });
      registerData = await registerRes.json();
      effectiveAuthor = personUrn;
    }
    if (!registerRes.ok) { console.error("LinkedIn image register failed:", registerData); return null; }

    const uploadUrl = registerData.value?.uploadUrl;
    const imageUrn = registerData.value?.image;
    if (!uploadUrl || !imageUrn) { console.error("LinkedIn: Missing image upload URL or URN"); return null; }

    console.log("LinkedIn: Uploading image binary...");
    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/octet-stream" },
      body: imageData,
    });
    if (!uploadRes.ok) { const err = await uploadRes.text(); console.error("LinkedIn image upload failed:", err); return null; }

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

import { requireCronOrUser } from "../_shared/auth-helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  if (url.searchParams.get("health") === "1") {
    console.log(`[process] health build=${PROCESS_SCHEDULED_POSTS_BUILD}`);
    return new Response(
      JSON.stringify({ success: true, function: "process-scheduled-posts", build: PROCESS_SCHEDULED_POSTS_BUILD }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const _gate = await requireCronOrUser(req);
  if (!_gate.ok) return _gate.response;


  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    console.log(`[process] build=${PROCESS_SCHEDULED_POSTS_BUILD}`);

    const openWeatherApiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!openWeatherApiKey) {
      throw new Error("OpenWeatherMap API key not configured");
    }

    // Validate the ElevenLabs API key up front so missing-credential failures
    // are visible in the worker logs immediately (not deep inside a TTS call).
    // Voiceover is optional, so we DO NOT throw — silent video is the fallback.
    // We accept either ELEVENLABS_API_KEY (current) or ELEVEN_LABS_API_KEY (legacy),
    // so a future rotation under either name keeps working without code changes.
    const elevenLabsApiKey = resolveElevenLabsKey();
    if (!elevenLabsApiKey) {
      console.error("Error: ElevenLabs Key not found in environment");
      console.error("CRITICAL: ElevenLabs API Key missing in worker (checked: ELEVENLABS_API_KEY, ELEVEN_LABS_API_KEY)");
    } else {
      console.log(`[process] ElevenLabs API key present via ${elevenLabsApiKey.source} (worker can generate voiceovers)`);
    }


    const nowIso = new Date().toISOString();
    const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    // ── SINGLE-POST MODE (job runner) ──
    // When invoked by the new job pipeline (run-jobs), the caller passes a
    // specific scheduled_post_id. We process ONLY that row and skip the
    // sweep / recovery logic — the job runner handles those concerns itself.
    let singlePostId: string | null = null;
    let skipPost = false;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && typeof body.scheduled_post_id === "string") {
          singlePostId = body.scheduled_post_id;
          console.log(`[process] single-post mode for ${singlePostId} (source=${body.source ?? "unknown"})`);
        }
        if (body && body.skip_post === true) {
          skipPost = true;
          console.log(`[dev-test] skip_post=true received for scheduled_post_id=${singlePostId ?? "(sweep)"}`);
        }
      } catch {
        // No body — legacy cron invocation, fall through to sweep mode.
      }
    }

    // ── MISSED-JOB RECOVERY ──
    // If cron skipped a tick (sleep, deploy, outage…), `pending` rows may be
    // sitting overdue. Our base query already grabs any pending row with
    // scheduled_at <= now, so missed jobs of any age get picked up. We surface
    // a count here purely for observability/logging.
    const { count: missedCount } = await supabase
      .from("scheduled_posts")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("scheduled_at", tenMinAgoIso);
    if (missedCount && missedCount > 0) {
      console.log(`[process] 🛟 missed-job recovery: ${missedCount} pending row(s) overdue by >10min — including in this run`);
    }

    // ── STUCK PROCESSING RECOVERY ──
    // If a worker crashed mid-run, its row stays in `processing` forever.
    // Reset any row stuck in `processing` for >10 minutes back to its retry
    // state so the next tick re-claims it via the atomic claim block.
    const { data: stuck, error: stuckErr } = await supabase
      .from("scheduled_posts")
      .update({
        status: "retrying",
        next_retry_at: nowIso,
        error_message: "Recovered from stuck processing state (worker likely crashed)",
      })
      .eq("status", "processing")
      .lt("last_attempt_at", tenMinAgoIso)
      .select("id");
    if (stuckErr) {
      console.error("[process] stuck-processing recovery query failed:", stuckErr);
    } else if (stuck && stuck.length > 0) {
      console.log(`[process] 🛟 reset ${stuck.length} stuck 'processing' row(s) → 'retrying'`);
    }

    // Pick up: pending posts that are due, retrying posts past next_retry_at.
    // Both branches use scheduled_at/next_retry_at <= now, so genuinely missed
    // jobs (overdue by hours) are still caught.
    // Single-post mode: fetch ONLY the target row regardless of status,
    // so the job runner can reprocess a row even if it's been touched already.
    const baseQuery = supabase.from("scheduled_posts").select("*");
    const { data: duePosts, error: fetchError } = singlePostId
      ? await baseQuery.eq("id", singlePostId).limit(1)
      : await baseQuery
          .or(`and(status.eq.pending,scheduled_at.lte.${nowIso}),and(status.eq.retrying,next_retry_at.lte.${nowIso})`)
          .order("scheduled_at", { ascending: true });

    if (fetchError) throw new Error(`Failed to fetch scheduled posts: ${fetchError.message}`);
    if (!duePosts || duePosts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No posts due", processed: 0, missed_recovered: missedCount || 0, build: PROCESS_SCHEDULED_POSTS_BUILD }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.log(`[process] picked up ${duePosts.length} due row(s) (missed/overdue: ${missedCount || 0})`);

    let processed = 0;
    let failed = 0;
    let skippedLocked = 0;

    for (const post of duePosts) {
      const __postStartMs = nowMs();
      logEvent(supabase, EventType.PostStart, `Begin processing scheduled post`, {
        scheduled_post_id: post.id,
        user_id: post.user_id,
        city: post.city,
        slot: (post as any).slot ?? null,
        platform: post.platform,
        status: post.status,
      });
      // === ATOMIC CLAIM ===
      // Flip status pending|retrying → processing, scoped to this exact row AND
      // the status we read it at. If another worker already claimed it, the
      // update affects 0 rows and we skip. This is our distributed lock — no
      // double execution even if the cron fires twice or the function is
      // invoked concurrently.
      const expectedStatus = post.status; // "pending" or "retrying"
      const { data: claimed, error: claimErr } = await supabase
        .from("scheduled_posts")
        .update({ status: "processing", last_attempt_at: new Date().toISOString() })
        .eq("id", post.id)
        .eq("status", expectedStatus)
        .select("id")
        .maybeSingle();

      if (claimErr) {
        console.error(`[process] failed to claim post ${post.id}:`, claimErr);
        continue;
      }
      if (!claimed) {
        skippedLocked += 1;
        console.log(`[process] ⏭️  post ${post.id} already claimed by another worker — skipping`);
        continue;
      }
      // Reflect the claim locally so downstream code sees the right status.
      post.status = "processing";

      // === PUBLISH LOCK (global dedupe) ===
      // Hard guarantee: per (user_id, city_id, slot, platform, local_date), only one
      // successful publish can win — across manual runs, auto cron, and the job
      // pipeline. The Postgres function `acquire_publish_lock` does an atomic
      // INSERT ... ON CONFLICT DO NOTHING and returns false if the key is held.
      // On any publish failure later in this loop, we MUST release the lock so
      // retries can re-acquire (see release_publish_lock calls in failure paths).
      const lockSlot: string =
        (post as any).slot ||
        (post.caption?.match(/\[(?:auto|manual):(morning|afternoon|evening|manual|adhoc)\]/i)?.[1]) ||
        "adhoc";
      let lockAcquired = false;
      // TODO: remove after pipeline debugging — issue #pipeline-hardening
      const isManualRun =
        ((post as any).source === "manual_slot") ||
        (typeof post.caption === "string" && /\[manual:/i.test(post.caption));
      if (isManualRun) {
        console.warn(`[lock] ⚠ DEDUP BYPASSED for manual run post=${post.id}`);
      }
      if ((post as any).city_id && !isManualRun) {
        try {
          const { data: gotLock, error: lockErr } = await supabase.rpc("acquire_publish_lock", {
            p_user: post.user_id,
            p_city_id: (post as any).city_id,
            p_slot: lockSlot,
            p_platform: post.platform,
            p_tz: null,
            p_scheduled_post_id: post.id,
          });
          if (lockErr) {
            console.warn(`[lock] acquire failed for ${post.id} — failing open:`, lockErr.message);
          } else if (gotLock === false) {
            console.log(`[lock] 🔒 post ${post.id} skipped — publish lock held for ${post.city_id}/${lockSlot}/${post.platform}`);
            await supabase.from("scheduled_posts").update({
              status: "posted",
              error_message: `[DEDUPED] publish lock held for ${lockSlot}/${post.platform} today`,
              last_attempt_at: new Date().toISOString(),
            }).eq("id", post.id);
            await supabase.from("system_logs").insert({
              user_id: post.user_id,
              type: "post_deduped",
              message: `Skipped — publish lock held for ${post.city} ${lockSlot}/${post.platform}`,
              platform: post.platform,
              context: { scheduled_post_id: post.id, city_id: (post as any).city_id, slot: lockSlot },
            });
            processed++;
            continue;
          } else {
            lockAcquired = true;
          }
        } catch (e) {
          console.warn(`[lock] rpc threw for ${post.id}:`, (e as any)?.message);
        }
      }

      // Helper to release the lock on any failure path so retries can re-acquire.
      const releaseLock = async () => {
        if (!lockAcquired || !(post as any).city_id) return;
        try {
          await supabase.rpc("release_publish_lock", {
            p_user: post.user_id,
            p_city_id: (post as any).city_id,
            p_slot: lockSlot,
            p_platform: post.platform,
            p_tz: null,
          });
        } catch (e) {
          console.warn(`[lock] release failed for ${post.id}:`, (e as any)?.message);
        }
      };

      // === HARD CITY ISOLATION ===
      // Verify the resolved social_account for (user_id, platform, city_id) actually
      // belongs to this city. Routing violations abort the publish immediately and
      // are NOT retried — better to fail loudly than post Gainesville to Orlando.
      if ((post as any).city_id) {
        try {
          const { data: acct } = await supabase
            .from("social_accounts")
            .select("id, city_id, platform")
            .eq("user_id", post.user_id)
            .eq("platform", post.platform)
            .eq("city_id", (post as any).city_id)
            .maybeSingle();
          if (!acct) {
            // Name-based fallback: accept a channel whose account_name contains
            // the post's city name before declaring a routing violation.
            const { data: userAccts } = await supabase
              .from("social_accounts")
              .select("id, city_id, account_name")
              .eq("user_id", post.user_id)
              .eq("platform", post.platform);
            const cityNeedle = (post.city || "").trim().toLowerCase();
            const nameMatch = cityNeedle
              ? (userAccts || []).find((a: any) =>
                  (a.account_name || "").toLowerCase().includes(cityNeedle))
              : null;
            if (nameMatch) {
              console.log(
                `[routing] city_id lookup failed, falling back to city name match (post=${post.id}, city=${post.city}, matched=${nameMatch.account_name})`,
              );
              // Treat as resolved; let adapter perform the same fallback for the token.
            } else {
            // No account bound to this exact city — check if one exists for the
            // wrong city. If so, this is a routing violation. If none exists at
            // all but the user has connected this platform somewhere, treat it
            // as BLOCKED (city missing channel). Only fall through silently when
            // the user has never connected this platform (legacy single-channel
            // weather_settings path may still hold tokens).
            const { data: wrong } = await supabase
              .from("social_accounts")
              .select("id, city_id")
              .eq("user_id", post.user_id)
              .eq("platform", post.platform)
              .neq("city_id", (post as any).city_id)
              .limit(1);
            if (wrong && wrong.length > 0) {
              const msg = `[ROUTING_VIOLATION] No ${post.platform} account for city_id=${(post as any).city_id}; another city has one`;
              console.error(`[isolate] ${post.id}: ${msg}`);
              await supabase.from("scheduled_posts").update({
                status: "failed",
                error_message: msg,
                last_attempt_at: new Date().toISOString(),
              }).eq("id", post.id);
              await supabase.from("system_logs").insert({
                user_id: post.user_id,
                type: "routing_violation",
                message: msg,
                platform: post.platform,
                context: { scheduled_post_id: post.id, city_id: (post as any).city_id, slot: (post as any).slot ?? null },
              });
              await supabase.from("notifications").insert({
                user_id: post.user_id,
                title: `⚠️ Routing blocked — no ${post.platform} channel for ${post.city}`,
                message: `Connect a ${post.platform} account to ${post.city} in Settings, then retry.`,
                type: "warning",
              });
              await releaseLock();
              processed++;
              continue;
            }
            // Also block if the user has ANY social_accounts row for this
            // platform (legacy shared row without city_id counts) — they've
            // adopted the multi-channel model but Gainesville simply has no
            // channel mapped. Surface it instead of silently no-op'ing.
            const { data: anyAcct } = await supabase
              .from("social_accounts")
              .select("id")
              .eq("user_id", post.user_id)
              .eq("platform", post.platform)
              .limit(1);
            if (anyAcct && anyAcct.length > 0) {
              const msg = `[BLOCKED] No ${post.platform} account connected for ${post.city}`;
              console.error(`[isolate] ${post.id}: ${msg}`);
              await supabase.from("scheduled_posts").update({
                status: "failed",
                error_message: msg,
                last_attempt_at: new Date().toISOString(),
              }).eq("id", post.id);
              await supabase.from("system_logs").insert({
                user_id: post.user_id,
                type: "publish_blocked",
                message: msg,
                platform: post.platform,
                context: { scheduled_post_id: post.id, city_id: (post as any).city_id, slot: (post as any).slot ?? null },
              });
              await supabase.from("notifications").insert({
                user_id: post.user_id,
                title: `❌ Publish blocked — connect a ${post.platform} channel for ${post.city}`,
                message: `Open Settings → ${post.city} → Account Routing to connect a ${post.platform} account.`,
                type: "error",
              });
              await releaseLock();
              processed++;
              continue;
            }
            }
          }
        } catch (e) {
          console.warn(`[isolate] check failed for ${post.id} (continuing):`, (e as any)?.message);
        }
      }

      // === DEBUG TRACE COLLECTOR ===
      // Always built (cheap), persisted to scheduled_posts/post_history when the
      // user has flipped on enable_debug_trace in weather_settings (one-shot flag).
      const traceSteps: Array<{ ts: string; step: string; detail?: any }> = [];
      const trace = (step: string, detail?: any) => {
        const entry = { ts: new Date().toISOString(), step, detail };
        traceSteps.push(entry);
        console.log(`[trace ${post.id}] ${step}`, detail ?? "");
      };
      // Voice telemetry — written to scheduled_posts + post_history regardless of debug flag.
      let voiceStatus: "success" | "retried" | "failed" | "skipped" | "not_requested" = "not_requested";
      let voiceError: string | null = null;
      let voiceAttemptsCount = 0;
      let debugTraceEnabled = false;

      // ── FAILURE NOTIFIER ──
      // Single helper so every silent failure (render, upload, fallback)
      // produces both a user-facing notification AND a system_logs row.
      // Call sites pass a short stage label and the raw error/status detail.
      const notifyFailure = async (
        stage: "voice" | "render" | "upload" | "fallback_image" | "platform",
        title: string,
        detail: string,
        context: Record<string, unknown> = {},
      ) => {
        const safeDetail = (detail || "unknown error").slice(0, 500);
        try {
          await supabase.from("notifications").insert({
            user_id: post.user_id,
            title: `❌ ${title}`,
            message: safeDetail,
            type: "error",
          });
        } catch (e) {
          console.error(`[process] post ${post.id}: failed to write notification (${stage}):`, e);
        }
        try {
          await supabase.from("system_logs").insert({
            user_id: post.user_id,
            type: `post_${stage}_failed`,
            message: `${title}: ${safeDetail}`,
            platform: post.platform,
            context: { scheduled_post_id: post.id, stage, ...context },
          });
        } catch (e) {
          console.error(`[process] post ${post.id}: failed to write system_logs (${stage}):`, e);
        }
      };

      try {
        const scopedCity = await resolveScheduledCity(supabase, post);
        console.log(`CITY CONFIRMED: ${scopedCity.city}${scopedCity.state ? ", " + scopedCity.state : ""} (city_id=${scopedCity.cityId || "legacy"})`);
        console.log(`[process] post ${post.id}: strict city scope city=${scopedCity.city}${scopedCity.state ? ", " + scopedCity.state : ""} city_id=${scopedCity.cityId || "legacy"} automation_id=${scopedCity.automationId || "none"}`);
        trace("city_resolved", { city: scopedCity.city, state: scopedCity.state, city_id: scopedCity.cityId, automation_id: scopedCity.automationId });
        trace("schedule_match", { scheduled_at: post.scheduled_at, now: new Date().toISOString(), within_window: true });
        // ── WEATHER FETCH WITH 6h LAST-KNOWN FALLBACK ──
        // Try the live API first; on success, refresh the cache. On failure,
        // fall back to weather_cache if the most recent row is < 6h old, so a
        // transient OpenWeather outage never kills a post.
        const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
        let weather: any;
        let weatherSource: "live" | "cache" = "live";
        const __weatherStartMs = nowMs();
        logEvent(supabase, EventType.WeatherFetchStart, `Fetching weather for ${scopedCity.city}`, {
          scheduled_post_id: post.id, user_id: post.user_id, city: scopedCity.city,
        });
        try {
          weather = await fetchWeatherData(scopedCity.city, openWeatherApiKey, scopedCity.state);
          // Refresh the cache (best-effort).
          try {
            await supabase.from("weather_cache").upsert({
              city: scopedCity.city,
              state: scopedCity.state || null,
              country: "US",
              payload: weather,
              fetched_at: new Date().toISOString(),
            }, { onConflict: "city,state,country" });
          } catch (cacheWriteErr) {
            console.warn(`[weather-cache] write failed for ${scopedCity.city}:`, cacheWriteErr);
          }
        } catch (liveErr) {
          const liveMsg = liveErr instanceof Error ? liveErr.message : String(liveErr);
          console.warn(`[weather] live fetch failed for ${scopedCity.city}: ${liveMsg} — checking cache`);
          let cacheQ = supabase
            .from("weather_cache")
            .select("payload, fetched_at")
            .ilike("city", scopedCity.city)
            .order("fetched_at", { ascending: false })
            .limit(1);
          if (scopedCity.state) cacheQ = cacheQ.ilike("state", scopedCity.state);
          const { data: cacheRow } = await cacheQ.maybeSingle();
          const ageMs = cacheRow ? (Date.now() - new Date(cacheRow.fetched_at).getTime()) : Infinity;
          if (cacheRow && ageMs <= CACHE_MAX_AGE_MS) {
            weather = cacheRow.payload;
            weatherSource = "cache";
            const ageMin = Math.round(ageMs / 60000);
            console.log(`[weather] ✅ using cached payload for ${scopedCity.city} (age=${ageMin}min)`);
            await notifyFailure(
              "render", // closest existing stage label; system_logs type will reflect intent below
              "Weather API unavailable — using cached data",
              `Live fetch failed (${liveMsg}). Falling back to weather data from ${ageMin} minutes ago.`,
              { city: scopedCity.city, cache_age_min: ageMin, fallback: "weather_cache" },
            );
          } else {
            logEvent(supabase, EventType.WeatherFetchError, `Weather fetch failed, no usable cache`, {
              scheduled_post_id: post.id, user_id: post.user_id, city: scopedCity.city,
              error_message: liveMsg, duration_ms: nowMs() - __weatherStartMs,
            });
            // No usable cache — re-throw so the row enters the normal retry/fail flow.
            throw new Error(`Weather fetch failed and no cache within 6h: ${liveMsg}`);
          }
        }
        weather.city = scopedCity.city;
        if (scopedCity.state) weather.stateOrRegion = scopedCity.state;
        logEvent(supabase, EventType.WeatherFetchOk, `Weather ok (${weatherSource})`, {
          scheduled_post_id: post.id, user_id: post.user_id, city: scopedCity.city,
          source: weatherSource, temperature: weather?.temperature, condition: weather?.condition,
          duration_ms: nowMs() - __weatherStartMs,
        });
        trace("weather_fetched", { temperature: weather.temperature, condition: weather.condition, source: weatherSource });

        // ── PRE-FLIGHT VALIDATION ──
        // Catch config errors (missing platform, missing keys, bad weather data,
        // invalid voice settings) BEFORE we spend time on caption/render/upload.
        // Failures here mark the row as `failed_precheck` and DO NOT retry —
        // retrying a missing API key won't fix it.
        const preflightErrors: string[] = [];

        // 1. City exists
        if (!scopedCity.city || !String(scopedCity.city).trim()) {
          preflightErrors.push("city is missing or empty");
        }

        // 2. Weather data is valid
        if (typeof weather?.temperature !== "number" || Number.isNaN(weather.temperature)) {
          preflightErrors.push("weather data invalid (no temperature)");
        }
        if (!weather?.condition || !String(weather.condition).trim()) {
          preflightErrors.push("weather data invalid (no condition)");
        }

        // 3. At least one platform selected
        const preflightPlatforms = post.platform === "both"
          ? ["youtube", "tiktok"]
          : String(post.platform || "").split(",").map((p: string) => p.trim()).filter(Boolean);
        if (preflightPlatforms.length === 0) {
          preflightErrors.push("no platform selected on scheduled_posts row");
        }

        // 4. Required API keys exist for this run
        if (!openWeatherApiKey) preflightErrors.push("missing OPENWEATHER_API_KEY");
        if (!Deno.env.get("LOVABLE_API_KEY")) preflightErrors.push("missing LOVABLE_API_KEY");
        if (preflightPlatforms.some((p) => ["youtube", "tiktok", "instagram"].includes(p))
            && !Deno.env.get("CREATOMATE_API_KEY")) {
          preflightErrors.push("missing CREATOMATE_API_KEY (required for video platforms)");
        }

        // 5. Voice settings (only when voiceover is requested for this row)
        const VIDEO_PLATFORMS_PF = new Set(["youtube", "tiktok", "instagram"]);
        const voiceRequested = post.include_voiceover === true
          && preflightPlatforms.some((p) => VIDEO_PLATFORMS_PF.has(p));
        if (voiceRequested) {
          if (!resolveElevenLabsKey()) preflightErrors.push("voiceover enabled but ElevenLabs API key missing");
          try {
            const { data: vs } = await supabase
              .from("weather_settings")
              .select("voiceover_voice_id, voiceover_speed, voiceover_stability, voiceover_similarity")
              .eq("user_id", post.user_id)
              .limit(1)
              .maybeSingle();
            if (vs) {
              if (!(vs as any).voiceover_voice_id) preflightErrors.push("voice_id not set");
              const spd = Number((vs as any).voiceover_speed);
              const stb = Number((vs as any).voiceover_stability);
              const sim = Number((vs as any).voiceover_similarity);
              if (!(spd >= 0.5 && spd <= 2.0)) preflightErrors.push(`voice speed out of range (${spd})`);
              if (!(stb >= 0 && stb <= 1)) preflightErrors.push(`voice stability out of range (${stb})`);
              if (!(sim >= 0 && sim <= 1)) preflightErrors.push(`voice similarity out of range (${sim})`);
            }
          } catch (vErr) {
            console.warn(`[preflight ${post.id}] voice settings lookup failed:`, vErr);
          }
        }

        if (preflightErrors.length > 0) {
          const reason = preflightErrors.join("; ");
          console.error(`[preflight ${post.id}] ❌ FAILED: ${reason}`);
          trace("preflight_failed", { errors: preflightErrors });
          await supabase.from("scheduled_posts").update({
            status: "failed_precheck",
            error_message: `Pre-flight check failed: ${reason}`,
            last_attempt_at: new Date().toISOString(),
          }).eq("id", post.id);
          await releaseLock();
          await supabase.from("system_logs").insert({
            user_id: post.user_id,
            type: "post_precheck_failed",
            message: `Pre-flight check failed for ${scopedCity.city}: ${reason}`,
            platform: post.platform,
            context: { scheduled_post_id: post.id, errors: preflightErrors },
          });
          await supabase.from("notifications").insert({
            user_id: post.user_id,
            title: "Post Skipped — Configuration Issue",
            message: `Post for ${scopedCity.city} was skipped before processing: ${reason}`,
            type: "error",
          });
          failed++;
          continue;
        }
        console.log(`[preflight ${post.id}] ✅ all checks passed`);
        trace("preflight_passed", { platforms: preflightPlatforms, voice_requested: voiceRequested });

        // Use pre-written caption if available, otherwise auto-generate.
        // Auto-post rows from auto-post-scheduler use a marker like "[auto:morning]"
        // as the caption (for duplicate detection). Treat those as empty so we
        // generate a real AI caption here.
        const rawCaption: string | null = post.caption || null;
        // Treat both [auto:slot] and [manual:slot] markers as "no real caption"
        // so we always generate (and persist) a real AI caption to post_history.
        const isAutoMarker = !!rawCaption && /^\s*\[(auto|manual):[a-z]+\]\s*$/i.test(rawCaption);
        let caption: string | null = isAutoMarker ? null : rawCaption;

        // Resolve time period early so it can feed both the caption AND the video
        const earlySlotMatch = rawCaption ? /\[(?:auto|manual):([a-z]+)\]/i.exec(rawCaption) : null;
        const earlyTimePeriod = earlySlotMatch ? earlySlotMatch[1].toLowerCase() : null;

        // Look up the user's caption tone preference
        let captionTone: string = "professional";
        let subscribeCtaEnabled = true;
        try {
          const { data: toneSettings } = await supabase
            .from("weather_settings")
            .select("caption_tone, subscribe_cta_enabled")
            .eq("user_id", post.user_id)
            .limit(1)
            .maybeSingle();
          if ((toneSettings as any)?.caption_tone) captionTone = (toneSettings as any).caption_tone;
          if (typeof (toneSettings as any)?.subscribe_cta_enabled === "boolean") {
            subscribeCtaEnabled = (toneSettings as any).subscribe_cta_enabled;
          }
        } catch { /* ignore */ }

        // ── A/B EXPERIMENT VARIANT OVERRIDE ──
        // If this post belongs to an experiment, apply variant_b_meta overrides.
        let experimentCtx: { id: string; variant: "A" | "B"; variable: string; meta: any } | null = null;
        if ((post as any).experiment_id && (post as any).experiment_variant) {
          try {
            const { data: exp } = await supabase
              .from("experiments")
              .select("id, variable_tested, variant_a_meta, variant_b_meta")
              .eq("id", (post as any).experiment_id)
              .maybeSingle();
            if (exp) {
              const variant = (post as any).experiment_variant as "A" | "B";
              const meta = variant === "B" ? (exp as any).variant_b_meta : (exp as any).variant_a_meta;
              experimentCtx = { id: (exp as any).id, variant, variable: (exp as any).variable_tested, meta };
              if (variant === "B" && (exp as any).variable_tested === "tone" && meta?.tone) {
                captionTone = String(meta.tone);
                console.log(`[experiments] Post ${post.id} variant B overriding tone → ${captionTone}`);
              }
            }
          } catch (e) { console.warn("[experiments] context lookup failed:", e); }
        }


        // Resolve the primary platform up-front so the caption can be platform-tuned
        const earlyPlatformList = post.platform === "both"
          ? ["youtube", "tiktok"]
          : String(post.platform || "").split(",").map((p: string) => p.trim()).filter(Boolean);
        const primaryPlatform = earlyPlatformList[0] || null;

        // ── AUTO-WINNER OVERRIDES (safe; no-op when toggles are off) ──
        // Loaded once per post; consumed by hook (caption), cinematic (render),
        // and persisted to debug_trace + post_history for UI feedback.
        const autoWinner: AutoWinnerOverrides = await getAutoWinnerOverrides(
          supabase,
          post.user_id,
          weather.city,
        );

        // Resolve slot now (used by caption personality, beacon, and title prefix).
        // Order: [auto:slot]/[manual:slot] marker → post.slot column → infer from city-local hour.
        const _slotForGen =
          earlyTimePeriod ||
          ((post as any).slot ? String((post as any).slot).toLowerCase() : null) ||
          inferSlotFromCityHour(weather.city);
        const _slotLabel = slotDisplayLabel(_slotForGen);

        // Fetch the most recent prior caption for this city to power anti-repeat
        let _prevCaption: string | null = null;
        try {
          const { data: prev } = await supabase
            .from("post_history")
            .select("caption, created_at")
            .eq("user_id", post.user_id)
            .eq("city", weather.city)
            .not("caption", "is", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          _prevCaption = (prev as any)?.caption || null;
        } catch { /* best-effort */ }
        const _prevOpener = firstContentLine(_prevCaption);

        if (!caption) {
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          if (LOVABLE_API_KEY) {
            try {
              let _diversityBlock = "";
              try {
                const _rotCTA = rotatingCTA(_slotForGen);
                const _personality = slotPersonalityDirective(_slotForGen);
                _diversityBlock = [
                  _personality,
                  _prevOpener
                    ? `ANTI-REPEAT: Do NOT reuse the opening hook, first-sentence structure, or CTA verb from the previous post for this city. Previous opener was: "${_prevOpener}". Use a noticeably different angle.`
                    : "",
                  `CTA ROTATION: For the final call-to-action line, use this exact CTA (or a close paraphrase): "${_rotCTA}". Do not invent additional CTAs.`,
                ].filter(Boolean).join("\n\n");
              } catch (err) {
                console.warn("Caption enhancement (diversity block) failed — falling back to default logic", err);
                _diversityBlock = "";
              }

              const baseUserContent =
                buildSkyBriefUserPrompt(weather) +
                "\n\n" + buildVerifiedLandmarksBlock(weather.city) +
                "\n\n" +
                buildStyleAddendum({
                  tone: normalizeTone(captionTone),
                  city: weather.city,
                  state: weather.stateOrRegion,
                  period: earlyTimePeriod,
                  rainChance: weather.rainChance ?? 0,
                  highTemp: weather.afternoonTemp ?? weather.temperature ?? 0,
                  lowTemp: weather.morningTemp ?? weather.temperature ?? 0,
                  conditions: weather.afternoonCondition || weather.condition || "",
                  platform: primaryPlatform,
                }) +
                (_diversityBlock ? "\n\n" + _diversityBlock : "");
              const sysPrompt = SKYBRIEF_SYSTEM_PROMPT + "\n\n" + LOCATION_ACCURACY_RULES;
              const callCap = async (extra = "") => {
                const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                  method: "POST",
                  headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    model: "google/gemini-3-flash-preview",
                    messages: [
                      { role: "system", content: sysPrompt },
                      { role: "user", content: baseUserContent + extra },
                    ],
                  }),
                });
                if (!r.ok) return null;
                const d = await r.json();
                return d.choices?.[0]?.message?.content?.trim() || null;
              };
              // ── Auto-Winner hook injection (only when toggle is ON and we have a winner) ──
              let hookExtra = "";
              try {
                if (
                  autoWinner.flags.auto_apply_winning_hook &&
                  autoWinner.preferred_hook
                ) {
                  hookExtra = `\n\nAUTO-WINNER HOOK OVERRIDE: Open the caption with a "${autoWinner.preferred_hook}" style hook in the very first line. Keep the rest of the caption natural.`;
                  autoWinner.applied = true;
                  autoWinner.fields.hook = autoWinner.preferred_hook;
                  console.log(`[auto-winner] post ${post.id}: hook override → ${autoWinner.preferred_hook}`);
                }
              } catch (e) {
                console.warn("[auto-winner] hook injection failed; falling back:", e);
                hookExtra = "";
              }
              caption = await callCap(hookExtra);
              if (caption) {
                const v = validateCaptionLocation(caption, weather.city);
                if (!v.ok) {
                  console.warn(`[process-scheduled-posts] foreign landmarks for ${weather.city}:`, v.hits);
                  const retry = await callCap(`\n\nREGENERATION REQUIRED: Your previous draft mentioned ${v.hits.join(", ")}, which is NOT in ${weather.city}. Rewrite without ANY specific landmark, stadium, university, neighborhood, or business name.`);
                  if (retry) {
                    const v2 = validateCaptionLocation(retry, weather.city);
                    caption = v2.ok ? retry : stripUnverifiedReferences(retry, weather.city);
                  }
                }
              }

              // ── Similarity check vs previous post for this city ──
              if (caption && _prevCaption) {
                try {
                  const sim = captionSimilarity(caption, _prevCaption);
                  if (sim >= 0.8) {
                    console.warn(`[process-scheduled-posts] high similarity (${sim.toFixed(2)}) vs previous post for ${weather.city} — regenerating once`);
                    try {
                      await supabase.from("system_logs").insert({
                        user_id: post.user_id,
                        type: "caption_similarity_regen",
                        message: `Caption ${sim.toFixed(2)} similar to previous post for ${weather.city}; triggered one-shot regen.`,
                        context: { city: weather.city, slot: _slotForGen, similarity: sim, prev_opener: _prevOpener },
                      });
                    } catch { /* best-effort */ }
                    const regen = await callCap(`\n\nREGENERATION REQUIRED: Your previous draft was too similar to the last post for this city ("${_prevOpener}"). Rewrite with a different opening hook, sentence rhythm, and CTA verb. Keep all factual weather data the same.`);
                    if (regen) {
                      const v3 = validateCaptionLocation(regen, weather.city);
                      const cleaned = v3.ok ? regen : stripUnverifiedReferences(regen, weather.city);
                      const sim2 = captionSimilarity(cleaned, _prevCaption);
                      if (sim2 < sim) caption = cleaned;
                    }
                  }
                } catch (err) {
                  console.warn("Caption similarity check failed — keeping original caption", err);
                }
              }

              // Final safety net
              if (caption) caption = stripUnverifiedReferences(caption, weather.city);
              // City-proxy sanitizer (BLACKLIST + nuclear fallback + handle guard).
              // Catches "weather in Clear Skies", foreign @SkyBrief* handles, hashtag drift.
              if (caption) {
                const before = caption;
                caption = sanitizeCityProxies(caption, weather.city);
                if (before !== caption) {
                  console.log(`[process-scheduled-posts] city-proxy sanitized for ${weather.city} (post=${post.id})`);
                }
              }
            } catch (e) {
              console.error("Caption generation failed:", e);
            }
          }
        }

        // Sanitize regardless of generation path (covers pre-populated post.caption).
        if (caption) caption = sanitizeCityProxies(caption, weather.city);


        // ── Location Beacon: ensure first non-empty line is "📍 City · Slot Update" ──
        if (caption) {
          try {
            const beacon = `📍 ${weather.city} · ${_slotLabel} Update`;
            const lines = caption.split(/\r?\n/);
            const firstIdx = lines.findIndex((l) => l.trim().length > 0);
            if (firstIdx >= 0 && /^\s*📍/.test(lines[firstIdx])) {
              lines[firstIdx] = beacon;
              caption = lines.join("\n");
            } else {
              caption = `${beacon}\n\n${caption.replace(/^\s+/, "")}`;
            }
          } catch (e) {
            console.warn("[process-scheduled-posts] beacon injection failed:", e);
          }
        }

        let postStatus = "posted";
        let errorMessage: string | null = null;
        const storedImageUrl: string | null = null;

        // --- Platform Upload via Adapter ---
        const platformsToPost = post.platform === "both" ? ["youtube", "tiktok"] : post.platform.split(",").map((p: string) => p.trim());
        const title = generateSkyBriefTitle(weather.city, weather.temperature, weather.condition, weather.rainChance, _slotForGen);
        assertSlotTitlePrefix(title, "process-scheduled-posts:dispatch");
        const desc = caption || "Weather update for " + weather.city + ": " + weather.temperature + "°F, " + weather.description;

        // Extract slot (morning/afternoon/evening) from auto-post marker if present, so the
        // video header shows the correct period badge for auto-posts.
        const slotMatch = rawCaption ? /\[(?:auto|manual):([a-z]+)\]/i.exec(rawCaption) : null;
        const timePeriod = slotMatch ? slotMatch[1].toLowerCase() : null;
        trace("platforms_resolved", { platforms: platformsToPost, slot: timePeriod, automated: isAutoMarker });

        // === AI VOICEOVER (auto-posts) ===
        // include_voiceover is set by auto-post-scheduler ONLY for video-capable platforms.
        // As a safety net we ALSO re-check enable_voiceover on weather_settings here so a user
        // who flipped voice on after rows were queued still gets audio. Image-only platforms
        // (twitter, linkedin) are excluded since they can't carry audio anyway.
        // If TTS fails, we render silently — never break the schedule.
        const VIDEO_PLATFORMS = new Set(["youtube", "tiktok", "instagram"]);
        const hasVideoPlatform = platformsToPost.some((p) => VIDEO_PLATFORMS.has(p));

        let voiceUrl: string | null = post.voiceover_url || null;
        // Estimated duration of the voiceover audio (seconds). Used to size the video composition
        // so the full voiceover + CTA always plays before the video ends. null = no voiceover.
        let voiceAudioDurationSec: number | null = null;
        let voiceSettingsRow: any = null;
        if (post.user_id) {
          const { data: vSettings } = await supabase
            .from("weather_settings")
            .select("enable_voiceover, voiceover_voice_id, voiceover_speed, voiceover_stability, voiceover_similarity, enable_debug_trace")
            .eq("user_id", post.user_id)
            .limit(1)
            .maybeSingle();
          voiceSettingsRow = vSettings || null;
          debugTraceEnabled = voiceSettingsRow?.enable_debug_trace === true;
          if (debugTraceEnabled) {
            console.log(`[process] post ${post.id}: 🔍 DEBUG TRACE ENABLED — full step trace will be persisted`);
          }
        }
        const settingsEnabled = voiceSettingsRow?.enable_voiceover === true;
        const wantVoice = !voiceUrl && hasVideoPlatform && (post.include_voiceover === true || settingsEnabled);
        trace("voice_decision", {
          include_voiceover_flag: post.include_voiceover === true,
          settings_enable_voiceover: settingsEnabled,
          has_video_platform: hasVideoPlatform,
          will_attempt: wantVoice,
        });

        if (!hasVideoPlatform) {
          voiceStatus = "skipped";
          voiceError = "No video-capable platform in selection";
        } else if (!wantVoice && !voiceUrl) {
          voiceStatus = "not_requested";
        } else if (voiceUrl) {
          voiceStatus = "success"; // pre-attached audio
        }

        if (wantVoice && post.user_id) {
          console.log(`[process] post ${post.id}: VOICE: enabled (row.include_voiceover=${post.include_voiceover}, settings.enable_voiceover=${settingsEnabled})`);
          try {
            let voiceId = voiceSettingsRow?.voiceover_voice_id || "female";
            const voiceSpeed = voiceSettingsRow?.voiceover_speed;
            const voiceStability = voiceSettingsRow?.voiceover_stability;
            const voiceSimilarity = voiceSettingsRow?.voiceover_similarity;

            // === SAFE INJECTION: AI voice optimization ===
            // Only override the configured voice if a high-confidence winner exists
            // (>10% lift, >=100 cumulative views) for this condition + time-of-day.
            try {
              const { getBestVoice } = await import("../_shared/voice-memory.ts");
              const condForVoice = (weather?.condition || "").toLowerCase() || null;
              const best = await getBestVoice(supabase, {
                userId: post.user_id,
                condition: condForVoice,
                timeOfDay: timePeriod,
              });
              if (best && best.voiceId && best.voiceId !== voiceId) {
                console.log(`[process] post ${post.id}: VOICE: 🧠 AI voice override → ${best.voiceId} (style=${best.voiceStyle}, lift=${best.liftPct.toFixed(1)}%, views=${best.totalViews}, n=${best.sampleSize})`);
                trace("voice_ai_override", { from: voiceId, to: best.voiceId, lift_pct: best.liftPct, views: best.totalViews, sample: best.sampleSize });
                voiceId = best.voiceId;
              } else {
                console.log(`[process] post ${post.id}: VOICE: AI override not applied (no high-confidence winner)`);
              }
            } catch (vmErr) {
              console.warn(`[process] post ${post.id}: VOICE: AI override skipped:`, vmErr);
            }

            // === A/B EXPERIMENT: voice variable ===
            // If this post is part of a "voice" experiment, force the variant's voice
            // style so we can isolate the effect. Other variables stay identical.
            try {
              if (post.experiment_id && post.experiment_variant) {
                const { data: exp } = await supabase
                  .from("experiments")
                  .select("variable_tested, variant_a_meta, variant_b_meta")
                  .eq("id", post.experiment_id)
                  .maybeSingle();
                if (exp?.variable_tested === "voice") {
                  const meta = (post.experiment_variant === "B" ? exp.variant_b_meta : exp.variant_a_meta) || {};
                  const styleToVoice: Record<string, string> = {
                    calm: "anchor",
                    energetic: "cheerful",
                    urgent: "deep",
                  };
                  const desired = styleToVoice[(meta.voice || "").toLowerCase()];
                  if (desired) {
                    console.log(`[process] post ${post.id}: VOICE: 🧪 A/B voice variant=${post.experiment_variant} style=${meta.voice} → ${desired}`);
                    trace("voice_experiment", { variant: post.experiment_variant, style: meta.voice, voice_id: desired });
                    voiceId = desired;
                  }
                }
              }
            } catch (expErr) {
              console.warn(`[process] post ${post.id}: VOICE: experiment override skipped:`, expErr);
            }

            console.log(`[process] post ${post.id}: VOICE: config voice=${voiceId} speed=${voiceSpeed} stability=${voiceStability} similarity=${voiceSimilarity}`);
            trace("voice_config", { voice_id: voiceId, speed: voiceSpeed, stability: voiceStability, similarity: voiceSimilarity });

            console.log(`[process] post ${post.id}: VOICE: generating script`);
            const script = await generateVoiceScript(weather, captionTone, platformsToPost, { subscribeCta: subscribeCtaEnabled, city: weather.city, slot: timePeriod });
            console.log(`[process] post ${post.id}: VOICE: script="${script}"`);

            const ttsOpts = { speed: voiceSpeed, stability: voiceStability, similarity: voiceSimilarity };
            // Attempt #1
            let ttsResult = await generateVoiceAudio(script, voiceId, ttsOpts);
            voiceAttemptsCount = ttsResult.attempts.length;

            // === AUDIO VERIFICATION ===
            const transientFailure = !ttsResult.ok && (ttsResult.reason === "timeout" || ttsResult.reason === "network_error" || (ttsResult.reason === "http_error" && (ttsResult.status ?? 0) >= 500));
            if (transientFailure) {
              console.warn(`[process] post ${post.id}: VOICE: transient failure (${(ttsResult as any).reason}) — waiting 2s and retrying once`);
              await new Promise((r) => setTimeout(r, 2000));
              ttsResult = await generateVoiceAudio(script, voiceId, ttsOpts);
              voiceAttemptsCount += ttsResult.attempts.length;
            }
            trace("voice_attempts", { count: voiceAttemptsCount, attempts: ttsResult.attempts });

            if (ttsResult.ok) {
              // Estimate audio duration from MP3 byte length (CBR 128 kbps from ElevenLabs).
              voiceAudioDurationSec = estimateMp3DurationSeconds(ttsResult.bytes.length);
              console.log(`[process] post ${post.id}: VOICE: estimated audio duration ${voiceAudioDurationSec?.toFixed(2) ?? "n/a"}s (${ttsResult.bytes.length} bytes)`);
              trace("voice_audio_duration", { bytes: ttsResult.bytes.length, seconds: voiceAudioDurationSec });
              const url = await storeVoiceAudio(supabase, post.user_id, ttsResult.bytes);
              if (url) {
                voiceUrl = url;
                voiceStatus = voiceAttemptsCount > 1 ? "retried" : "success";
                console.log(`[process] post ${post.id}: VOICE: audio attached (${url.split("?")[0]})`);
                await supabase.from("scheduled_posts").update({ voiceover_url: url }).eq("id", post.id);
              } else {
                console.warn(`[process] post ${post.id}: VOICE: upload failed — retrying once after 2s`);
                await new Promise((r) => setTimeout(r, 2000));
                const retryUrl = await storeVoiceAudio(supabase, post.user_id, ttsResult.bytes);
                if (retryUrl) {
                  voiceUrl = retryUrl;
                  voiceStatus = "retried";
                  console.log(`[process] post ${post.id}: VOICE: audio attached on retry (${retryUrl.split("?")[0]})`);
                  await supabase.from("scheduled_posts").update({ voiceover_url: retryUrl }).eq("id", post.id);
                } else {
                  voiceStatus = "failed";
                  voiceError = "Storage upload failed twice";
                  console.warn(`[process] post ${post.id}: VOICE: upload failed twice — falling back to silent video`);
                }
              }
            } else {
              const reason = ttsResult.reason;
              const status = (ttsResult as any).status;
              const detail = (ttsResult as any).detail;
              voiceStatus = "failed";
              voiceError = `${reason}${status ? ` (${status})` : ""}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`;
              console.warn(`[process] post ${post.id}: VOICE: TTS failed (reason=${reason}, status=${status ?? "n/a"}) — falling back to silent video`);

              try {
                await supabase.from("system_logs").insert({
                  user_id: post.user_id,
                  type: "voiceover_failed",
                  message: `ElevenLabs voice generation failed: reason=${reason}, status=${status ?? "n/a"}${detail ? ` — ${String(detail).slice(0, 200)}` : ""}`,
                  platform: platformsToPost.join(","),
                  context: {
                    scheduled_post_id: post.id,
                    reason,
                    status: status ?? null,
                    detail: detail ?? null,
                    city: weather.city,
                    attempts: ttsResult.attempts,
                  },
                });
              } catch (logErr) {
                console.error(`[process] post ${post.id}: VOICE: failed to write system_logs entry:`, logErr);
              }

              if (reason === "missing_key" || reason === "unauthorized" || reason === "timeout") {
                const titleMap: Record<string, string> = {
                  missing_key: "Voiceover Disabled — Missing API Key",
                  unauthorized: "Voiceover Failed — ElevenLabs 401",
                  timeout: "Voiceover Failed — Timeout",
                };
                const messageMap: Record<string, string> = {
                  missing_key: `Your post for ${weather.city} was published without voiceover because the ElevenLabs API key is not configured.`,
                  unauthorized: `Your post for ${weather.city} was published without voiceover — ElevenLabs returned 401 Unauthorized. Please verify your API key.`,
                  timeout: `Your post for ${weather.city} was published without voiceover — ElevenLabs took longer than 30 seconds to respond.`,
                };
                try {
                  await supabase.from("notifications").insert({
                    user_id: post.user_id,
                    title: titleMap[reason],
                    message: messageMap[reason],
                    type: "error",
                  });
                } catch (notifyErr) {
                  console.error(`[process] post ${post.id}: VOICE: failed to write failure notification:`, notifyErr);
                }
              }
            }
          } catch (vErr) {
            voiceStatus = "failed";
            voiceError = vErr instanceof Error ? vErr.message : String(vErr);
            console.error(`[process] post ${post.id}: VOICE: pipeline error — falling back to silent video:`, vErr);
            voiceUrl = null;
          }
        } else if (!voiceUrl && hasVideoPlatform) {
          console.log(`[process] post ${post.id}: VOICE: disabled (row.include_voiceover=${post.include_voiceover}, settings.enable_voiceover=${settingsEnabled})`);
        }

        // === VOICE ASSET VALIDATION (failsafe: never block the post) ===
        // Previously we threw here and failed the entire scheduled_post when
        // voice was requested but missing. Product rule changed: if TTS fails
        // we MUST still ship the video (silent / music-only) rather than skip
        // the broadcast. We log + notify, but proceed to render.
        if (wantVoice && !voiceUrl) {
          const reason = voiceError || "Voiceover requested but audio file was not generated";
          console.warn(`[process] post ${post.id}: VOICE: failsafe — continuing without voiceover. reason=${reason}`);
          trace("voice_result", { status: "failed_failsafe", attempts: voiceAttemptsCount, error: reason, has_audio: false, fatal: false });
          voiceStatus = voiceStatus === "success" ? "failed" : voiceStatus || "failed";
          try {
            await supabase.from("system_logs").insert({
              user_id: post.user_id,
              type: "voiceover_failsafe",
              message: `Voice generation failed for ${weather.city} — shipping silent video instead of blocking the schedule (${reason}).`,
              platform: platformsToPost.join(","),
              context: { scheduled_post_id: post.id, reason, city: weather.city },
            });
          } catch (_) { /* logging best-effort */ }
        }
        // Reachability HEAD check — make sure Creatomate can actually fetch the audio.
        // If unreachable, drop the audio and continue silently (failsafe).
        if (voiceUrl) {
          try {
            const probe = await Promise.race([
              fetch(voiceUrl, { method: "HEAD" }),
              new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("audio HEAD timeout")), 8000)),
            ]) as Response;
            if (!probe.ok) {
              throw new Error(`audio_url HEAD ${probe.status}`);
            }
            console.log(`[process] post ${post.id}: VOICE: audio_url reachable (${probe.status}) ${voiceUrl.split("?")[0]}`);
          } catch (probeErr) {
            const reason = probeErr instanceof Error ? probeErr.message : String(probeErr);
            console.warn(`[process] post ${post.id}: VOICE: audio_url unreachable — dropping to silent (failsafe) (${reason})`);
            trace("voice_result", { status: "failed_failsafe", error: `audio unreachable: ${reason}`, has_audio: false, fatal: false });
            voiceUrl = null;
            voiceAudioDurationSec = null;
            voiceStatus = "failed";
            voiceError = `audio unreachable: ${reason}`;
          }
        }
        trace("voice_result", { status: voiceStatus, attempts: voiceAttemptsCount, error: voiceError, has_audio: !!voiceUrl });

        // Capture which background atmosphere bucket the renderer will pick (deterministic from condition).
        const _bgTheme = getWeatherTheme(weather.condition);
        trace("background_selected", { condition: weather.condition, video_keyword: _bgTheme.videoKeyword });

        // ── AI Visual Optimization ──
        // Priority: 1) experiment override 2) weather context 3) city context
        // 4) top-performing style from history. Then rotation guard.
        let visualStyle = "sky";

        // ── Cinematic Mode (auto, weather-triggered) ──
        // Dramatic conditions force cinematic visual style. This activates
        // the cinematic background + overlays in the fallback renderer
        // (see _shared/video-render.ts pickBackgroundColor) AND signals
        // intent to the contextual selector below. Sunny/clear conditions
        // never trigger cinematic — standard render only.
        const _condLower = (weather.condition || "").toLowerCase();
        // Strict cinematic trigger list — high-drama weather only.
        // Sunny / clear / hot / fog / snow → standard render.
        const _cinematicKeywords = [
          "rain","drizzle","shower",
          "storm","thunder",
          "cloudy","overcast",
        ];
        let cinematicForced = false;
        let cinematicTrigger: string | null = null;
        for (const kw of _cinematicKeywords) {
          if (_condLower.includes(kw)) { cinematicForced = true; cinematicTrigger = kw; break; }
        }

        // ── Auto-Winner cinematic override ──
        // If the user opted into "auto cinematic for storms" we force cinematic on
        // for rain/storm conditions even if the keyword check above missed an alias.
        try {
          if (autoWinner.flags.auto_cinematic_for_storms) {
            const isStormy = /rain|storm|thunder|drizzle|shower/.test(_condLower);
            if (isStormy && !cinematicForced) {
              cinematicForced = true;
              cinematicTrigger = cinematicTrigger ?? "auto_winner";
              autoWinner.applied = true;
              autoWinner.fields.cinematic = true;
              console.log(`[auto-winner] post ${post.id}: cinematic override ON (condition=${_condLower})`);
            } else if (cinematicForced) {
              autoWinner.fields.cinematic = true; // already on; just record
            }
          }
        } catch (e) {
          console.warn("[auto-winner] cinematic override failed; falling back:", e);
        }

        if (cinematicForced) {
          visualStyle = "cinematic";
          console.log(`[visual] post ${post.id}: 🎬 cinematic mode ON (trigger=${cinematicTrigger})`);
          trace("cinematic_mode", { enabled: true, trigger: cinematicTrigger });
        } else {
          // Non-dramatic conditions never get cinematic — standard render only,
          // even if ENABLE_CINEMATIC_MODE is set globally.
          trace("cinematic_mode", { enabled: false, reason: "condition_not_dramatic", condition: _condLower });
        }
        let topPerfStyle: string | null = null;
        try {
          const top = await getTopVisualStyle(supabase, post.user_id);
          if (top) topPerfStyle = top.style;
        } catch (e) { console.warn("[visual] memory lookup failed:", e); }

        if (cinematicForced) {
          // Cinematic mode wins over contextual/experiment selection so the
          // dramatic-weather visual treatment actually reaches the renderer.
          trace("visual_rotation", { skipped: true, reason: "cinematic_forced", style: visualStyle });
        } else if (experimentCtx?.variable === "visuals" && experimentCtx?.meta?.visuals) {
          visualStyle = String(experimentCtx.meta.visuals);
          console.log(`[visual] post ${post.id}: experiment override → visual_style=${visualStyle}`);
          trace("visual_rotation", { skipped: true, reason: "experiment_override", style: visualStyle });
        } else {
          // Context-aware selection (weather > city > performance).
          const selection = selectContextualVisualStyle(weather.condition, weather.city, topPerfStyle);
          visualStyle = selection.style;
          console.log(`[visual] post ${post.id}: 🎯 contextual (${selection.source}) → ${selection.label} [${selection.style}] — ${selection.reason}`);
          trace("visual_context", {
            style: selection.style,
            label: selection.label,
            source: selection.source,
            reason: selection.reason,
            condition: weather.condition,
            city: weather.city,
            top_performer: topPerfStyle,
          });
          // Visual Style Rotation Guard — avoid repetition fatigue.
          try {
            const recent = await getRecentStyles(supabase, post.user_id, 5);
            const decision = enforceStyleRotation(visualStyle, recent);
            if (decision.forced) {
              console.log(`[visual] post ${post.id}: 🔄 rotation forced — ${decision.reason}`);
            } else {
              console.log(`[visual] post ${post.id}: rotation OK — ${decision.reason}`);
            }
            visualStyle = decision.style;
            trace("visual_rotation", {
              forced: decision.forced,
              preferred: decision.preferred,
              chosen: decision.style,
              pool_label: decision.pool_label,
              recent: decision.recent,
              reason: decision.reason,
            });
          } catch (e) {
            console.warn("[visual] rotation guard failed:", e);
          }
        }
        const baseMeta = expandVisualMeta(visualStyle);
        const visualTheme = classifyVisualTheme(weather.condition, timePeriod);
        const visualColorProfile = classifyColorProfile(visualStyle, visualTheme);
        const visualMeta = { ...baseMeta, theme: visualTheme, color_profile: visualColorProfile };
        trace("visual_style", visualMeta);

        // ── Retry-aware visual fallback ──
        // retry 1 → re-run pipeline (regenerates Pexels background lookup)
        // retry 2 → force a safe gradient template (skips stock video entirely)
        const attemptNum = (post as any).retry_count ?? 0;
        if (attemptNum >= 2 && visualStyle !== "gradient") {
          console.log(`[render] retry ${attemptNum}: forcing safe gradient template (was ${visualStyle})`);
          trace("visual_retry_fallback", { previous: visualStyle, forced: "gradient", attempt: attemptNum });
          visualStyle = "gradient";
        }

        const MIN_VIDEO_BYTES = 50_000;

        // Credit Protection: if a previous attempt already rendered a video,
        // reuse it instead of paying for another render — but only if it
        // passes the same validity bar we apply to fresh renders.
        let video: { data: Uint8Array; mimeType: string; provider?: string } | null = null;

        // ── WYSYWYP (What You See Is What You Post) ──────────────────────
        // If the manual post was created from a locked Preview Bundle and
        // the bundle is still valid, skip rendering entirely and post the
        // exact mp4 the user previewed. This is the contract the Preview
        // Modal promises ("Post this exact render").
        const previewBundleId: string | null =
          (post as any)?.debug_trace?.preview_bundle_id ?? null;
        if (previewBundleId) {
          try {
            const { data: bundle } = await supabase
              .from("preview_bundles")
              .select("id, status, asset_url, expires_at, content_type")
              .eq("id", previewBundleId)
              .maybeSingle();
            const isLocked = bundle?.status === "locked";
            const notExpired = bundle?.expires_at ? new Date(bundle.expires_at).getTime() > Date.now() : false;
            const isVideo = bundle?.content_type === "video";
            if (bundle && isLocked && notExpired && isVideo && bundle.asset_url) {
              console.log(`[wysywyp] reusing preview bundle ${previewBundleId} → ${String(bundle.asset_url).split("?")[0]}`);
              const dl = await fetch(bundle.asset_url);
              if (dl.ok) {
                const ab = await dl.arrayBuffer();
                if (ab.byteLength >= MIN_VIDEO_BYTES) {
                  video = { data: new Uint8Array(ab), mimeType: "video/mp4", provider: "preview_bundle" };
                  trace("video_render", { reused: "preview_bundle", bundle_id: previewBundleId, bytes: ab.byteLength });
                  // Mark the bundle consumed (best-effort).
                  await supabase.from("preview_bundles")
                    .update({ status: "consumed", consumed_at: new Date().toISOString() })
                    .eq("id", previewBundleId);
                } else {
                  console.warn(`[wysywyp] bundle asset too small (${ab.byteLength}b) — re-rendering`);
                }
              } else {
                console.warn(`[wysywyp] bundle asset fetch failed (${dl.status}) — re-rendering`);
              }
            } else {
              console.log(`[wysywyp] bundle ${previewBundleId} not usable (locked=${isLocked} notExpired=${notExpired} isVideo=${isVideo}) — re-rendering`);
            }
          } catch (e) {
            console.warn("[wysywyp] short-circuit failed (non-fatal):", (e as Error).message);
          }
        }

        const cachedVideoUrl: string | null = (post as any).cached_video_url ?? null;
        if (!video && cachedVideoUrl) {
          try {
            console.log(`[render] reusing cached video for post ${post.id}: ${cachedVideoUrl.slice(0, 80)}…`);
            const dl = await fetch(cachedVideoUrl);
            if (dl.ok) {
              const ab = await dl.arrayBuffer();
              if (ab.byteLength >= MIN_VIDEO_BYTES) {
                video = { data: new Uint8Array(ab), mimeType: "video/mp4", provider: "cache" };
                trace("video_render", { reused: true, bytes: ab.byteLength });
              } else {
                console.warn(`[render] cached video rejected (${ab.byteLength} bytes < ${MIN_VIDEO_BYTES}) — re-rendering`);
              }
            } else {
              console.warn(`[render] cached video fetch failed (${dl.status}) — will re-render`);
            }
          } catch (e) {
            console.warn("[render] cached video reuse failed:", (e as Error).message);
          }
        }
        if (!video) {
          // Try video generation once (with voiceover baked in if available)
          console.log(`RENDER START: City: ${weather.city}, VoiceEnabled: ${voiceUrl ? "True" : "False"}, VisualStyle: ${visualStyle}`);
          console.log(`[publish] post ${post.id}: AUDIO_URL → ${voiceUrl ? voiceUrl.split("?")[0] : "(none)"} duration=${voiceAudioDurationSec ?? "n/a"}s`);
          const renderErrorSink: { message?: string; templateConfigError?: boolean } = {};
          const __renderStartMs = nowMs();
          logEvent(supabase, EventType.RenderCreatomateStart, `Render start`, {
            scheduled_post_id: post.id, user_id: post.user_id, city: weather.city,
            visual_style: visualStyle, voice: voiceUrl ? true : false,
          });
          const rendered = await generateVideoWithFallback({
            weather, timePeriod, voiceUrl, audioDurationSec: voiceAudioDurationSec, visualStyle,
            creatomate: () => generateWeatherVideo(weather, timePeriod, voiceUrl, voiceAudioDurationSec, visualStyle, renderErrorSink),
          });
          // ── Post-render validation: reject empty/tiny/short outputs ──
          // render_video = success ONLY if bytes are real AND duration > 2s.
          const MIN_RENDER_DURATION_SEC = 2;
          if (rendered && rendered.data.byteLength >= MIN_VIDEO_BYTES) {
            const dur = (rendered as any).duration;
            if (typeof dur === "number" && dur <= MIN_RENDER_DURATION_SEC) {
              console.error(`[render] REJECTED post-render: duration ${dur}s <= ${MIN_RENDER_DURATION_SEC}s — marking FAILED`);
              trace("video_render_rejected", { reason: "short_duration", duration: dur, provider: rendered.provider });
            } else {
              video = rendered;
            }
          } else if (rendered) {
            console.error(`[render] REJECTED post-render: ${rendered.data.byteLength} bytes < ${MIN_VIDEO_BYTES}`);
            trace("video_render_rejected", { reason: "too_small", bytes: rendered.data.byteLength, provider: rendered.provider });
          }
          trace("video_render", { success: !!video, mime: video?.mimeType, provider: video?.provider, bytes: video?.data.byteLength, duration: (video as any)?.duration });
          // Phase 3 structured render outcome
          if (video) {
            const evt = video.provider === "creatomate" ? EventType.RenderCreatomateOk : EventType.RenderFallbackOk;
            logEvent(supabase, evt, `Render ok (${video.provider})`, {
              scheduled_post_id: post.id, user_id: post.user_id, city: weather.city,
              provider: video.provider, bytes: video.data.byteLength,
              duration_ms: nowMs() - __renderStartMs,
            });
          } else {
            const evt = renderErrorSink.templateConfigError
              ? EventType.RenderCreatomateConfigError
              : EventType.RenderFallbackError;
            logEvent(supabase, evt, `Render failed`, {
              scheduled_post_id: post.id, user_id: post.user_id, city: weather.city,
              error_message: renderErrorSink.message ?? null,
              template_config_error: !!renderErrorSink.templateConfigError,
              duration_ms: nowMs() - __renderStartMs,
            });
          }
          // Persist for retry credit-protection (only validated videos)
          if (video && video.data.byteLength >= MIN_VIDEO_BYTES) {
            try {
              const path = `${post.user_id}/render-${post.id}-${Date.now()}.mp4`;
              const { error: upErr } = await supabase.storage
                .from("weather-videos")
                .upload(path, video.data, { contentType: video.mimeType, upsert: true });
              if (!upErr) {
                const { data: signed } = await supabase.storage
                  .from("weather-videos")
                  .createSignedUrl(path, 60 * 60 * 24); // 24h
                if (signed?.signedUrl) {
                  await supabase
                    .from("scheduled_posts")
                    .update({ cached_video_url: signed.signedUrl })
                    .eq("id", post.id);
                  console.log(`[render] cached video URL saved for post ${post.id}`);
                }
              } else {
                console.warn("[render] cache upload failed:", upErr.message);
              }
            } catch (e) {
              console.warn("[render] cache persist failed:", (e as Error).message);
            }
          }
        }

        // ── DEV-TEST SHORT-CIRCUIT ──
        // When invoked with skip_post=true, stop after render. Mark the row
        // dev_completed (sentinel string — not a real publish state) and skip
        // platform upload, post_history, post_analytics, and notifications.
        if (skipPost && video) {
          let previewUrl: string | null = null;
          try {
            const { data: row } = await supabase
              .from("scheduled_posts")
              .select("cached_video_url")
              .eq("id", post.id)
              .maybeSingle();
            previewUrl = (row as any)?.cached_video_url ?? null;
          } catch { /* ignore */ }
          await supabase
            .from("scheduled_posts")
            .update({
              status: "dev_completed",
              error_message: null,
              posted_at: null,
            })
            .eq("id", post.id);
          console.log(`[dev-test] scheduled_post_id=${post.id} skipping upload — preview_url=${previewUrl ?? "(none)"}`);
          processed++;
          continue;
        }

        let publishedPostUrl: string | null = null;
        // Map of platform -> external/post id, used to seed post_analytics rows.
        const platformExternalIds: Record<string, string> = {};

        let videoPostedAny = false;
        const platformErrors: string[] = [];

        // ═══════════════════════════════════════════════════════════════
        // PHASE 1 EMERGENCY GATE: Pre-upload content validation.
        // Blocks publish when title/description contain known hallucinated
        // location proxies ("Weather Update", template placeholders, etc.)
        // or a suspicious "in <NotExpectedCity>!" pattern.
        // Caption + voiceScript are checked for placeholders only (Option B).
        // ═══════════════════════════════════════════════════════════════
        try {
          const expectedCity = (post.city || weather?.city || "").trim() || null;
          const bundle = validatePostBundle({
            title,
            description: desc,
            caption: caption || null,
            voiceScript: null,
            expectedCity,
          });
          if (!bundle.ok) {
            const detail = bundle.failures
              .map((f) => `${f.field}:${f.reason}${f.matched ? `(${f.matched})` : ""}`)
              .join("; ");
            const msg = `[validation_failed] ${detail}`;
            console.error(`[validate] BLOCKED post_id=${post.id} city=${expectedCity ?? "?"} — ${detail}`);
            try {
              await supabase
                .from("scheduled_posts")
                .update({
                  status: "validation_failed",
                  error_message: msg,
                })
                .eq("id", post.id);
            } catch (auditErr) {
              console.error(`[validate] failed to mark scheduled_posts ${post.id} as validation_failed (block still enforced):`, (auditErr as Error).message);
            }
            try {
              await supabase.from("system_logs").insert({
                user_id: post.user_id,
                type: "validation_blocked",
                platform: platformsToPost.join(","),
                message: `Validation gate blocked publish: ${detail}`,
                context: {
                  scheduled_post_id: post.id,
                  city: expectedCity,
                  failures: bundle.failures,
                },
              });
            } catch (_) { /* best-effort */ }
            try {
              await supabase.from("post_history").insert({
                status: "validation_failed",
                platform: post.platform,
                city: expectedCity || post.city || "Unknown",
                error_message: msg,
                caption: caption || null,
                user_id: post.user_id,
                slot: (post as any).slot || null,
                source: (post as any).source || "scheduled",
              });
            } catch (phErr) {
              console.error(`[validate] failed to log post_history validation_failed row for ${post.id} (block still enforced):`, (phErr as Error).message);
            }
            logEvent(supabase, EventType.ValidationBlock, `Validation blocked publish`, {
              scheduled_post_id: post.id, user_id: post.user_id, city: expectedCity,
              platform: platformsToPost.join(","),
              validation_reason: bundle.failures[0]?.reason,
              validation_field: bundle.failures[0]?.field,
              matched: bundle.failures[0]?.matched,
              failures: bundle.failures,
            });
            logEvent(supabase, EventType.PostFinalizeFailed, `Post finalize: validation_failed`, {
              scheduled_post_id: post.id, user_id: post.user_id, city: expectedCity,
              status: "validation_failed", duration_ms: nowMs() - __postStartMs,
            });
            processed++;
            continue;
          }
          logEvent(supabase, EventType.ValidationPass, `Validation passed`, {
            scheduled_post_id: post.id, user_id: post.user_id, city: expectedCity,
            platform: platformsToPost.join(","),
          });
        } catch (vErr) {
          // Validator must never crash the worker — if it fails, log and
          // fall through to publish (fail-open by design for Phase 1).
          console.error(`[validate] validator threw — falling through:`, (vErr as Error).message);
        }

        // ═══════════════════════════════════════════════════════════════
        // PHASE 2C GATE: smart fallback handling.
        // If Creatomate emitted a TEMPLATE_CONFIG_ERROR (real misconfig) AND
        // we fell back to a non-Creatomate provider AND a video platform is
        // targeted → hold the post for review instead of auto-publishing the
        // generic fallback render to YouTube/TikTok/Instagram/LinkedIn.
        // Transient Creatomate failures (rate-limit, 5xx, timeout) still
        // publish via the fallback, because they're reliability issues, not
        // content quality issues.
        // ═══════════════════════════════════════════════════════════════
        const videoPlatforms = ["youtube", "tiktok", "instagram", "linkedin"];
        const targetsVideoPlatform = platformsToPost.some((p) => videoPlatforms.includes(p));
        if (
          video &&
          renderErrorSink.templateConfigError === true &&
          video.provider !== "creatomate" &&
          targetsVideoPlatform
        ) {
          const reason = `[NEEDS_REVIEW:template_config] Creatomate template error — fallback render (${video.provider}) held from video platforms. Original: ${renderErrorSink.message ?? "(no message)"}`;
          console.error(`[publish] HOLDING post ${post.id} for review — ${reason}`);
          try {
            await supabase
              .from("scheduled_posts")
              .update({ status: "needs_review", error_message: reason })
              .eq("id", post.id);
          } catch (auditErr) {
            console.error(`[publish] failed to mark scheduled_posts ${post.id} needs_review (hold still enforced):`, (auditErr as Error).message);
          }
          try {
            await supabase.from("system_logs").insert({
              user_id: post.user_id,
              type: "render_needs_review",
              platform: platformsToPost.join(","),
              message: `Creatomate template error — fallback render held from publish`,
              context: {
                scheduled_post_id: post.id,
                city: post.city || weather?.city || null,
                render_provider: video.provider,
                creatomate_error: renderErrorSink.message ?? null,
              },
            });
          } catch (_) { /* best-effort */ }
          try {
            await supabase.from("post_history").insert({
              status: "needs_review",
              platform: post.platform,
              city: post.city || weather?.city || "Unknown",
              error_message: reason,
              caption: caption || null,
              user_id: post.user_id,
              slot: (post as any).slot || null,
              source: (post as any).source || "scheduled",
            });
          } catch (phErr) {
            console.error(`[publish] failed to log post_history needs_review for ${post.id} (hold still enforced):`, (phErr as Error).message);
          }
          logEvent(supabase, EventType.UploadSkippedNeedsReview, `Upload skipped — fallback render held for review`, {
            scheduled_post_id: post.id, user_id: post.user_id, city: post.city || weather?.city,
            platform: platformsToPost.join(","), provider: video.provider,
            error_message: renderErrorSink.message ?? null,
          });
          logEvent(supabase, EventType.PostFinalizeNeedsReview, `Post finalize: needs_review`, {
            scheduled_post_id: post.id, user_id: post.user_id, city: post.city || weather?.city,
            status: "needs_review", duration_ms: nowMs() - __postStartMs,
          });
          processed++;
          continue;
        }

        if (video) {
          // Video succeeded — post to all platforms
          for (const platformName of platformsToPost) {
            console.log(`[publish] Attempting to write notification for user: ${post.user_id}, platform: ${platformName}`);
            console.log(`[title_debug] dispatch title for ${platformName}:`, title);
            const __uploadStartMs = nowMs();
            logEvent(supabase, EventType.UploadStart, `Upload start ${platformName}`, {
              scheduled_post_id: post.id, user_id: post.user_id, city: weather.city,
              platform: platformName, provider: video.provider, bytes: video.data.byteLength,
            });
            const result = await postToPlatform(platformName, supabase, post.user_id, video.data, title, desc, video.mimeType, post.city_id || null, (timePeriod as any) || null, post.city || null);
            // Hard guard: YouTube must return a real video_id. Throw so the
            // publish_post job fails loudly instead of being marked succeeded.
            if (platformName === "youtube" && result.success && !result.id) {
              throw new Error("[YT_NO_VIDEO_ID] YouTube reported success without a video_id — failing job");
            }
            if (result.success && result.id) {
              videoPostedAny = true;
              logEvent(supabase, EventType.UploadOk, `Upload ok ${platformName}`, {
                scheduled_post_id: post.id, user_id: post.user_id, city: weather.city,
                platform: platformName, external_id: result.id,
                duration_ms: nowMs() - __uploadStartMs,
              });
              const acctName = (result as any).account_name || "unknown";
              console.log(`[publish] ${platformName} OK id=${result.id} channel=${acctName} city=${(result as any).resolved_city_id ?? "shared"} post=${post.id}`);
              if (platformName === "youtube") {
                platformExternalIds["youtube"] = result.id;
                if (!publishedPostUrl) publishedPostUrl = `https://www.youtube.com/watch?v=${result.id}`;
              } else if (platformName === "tiktok") {
                platformExternalIds["tiktok"] = result.id;
                if (!publishedPostUrl) publishedPostUrl = `https://www.tiktok.com/video/${result.id}`;
              } else {
                platformExternalIds[platformName] = result.id;
              }
              // === Channel-level success log ===
              // Records exactly which channel received this post so any future
              // contamination is visible after the fact.
              try {
                await supabase.from("system_logs").insert({
                  user_id: post.user_id,
                  type: "post_published",
                  platform: platformName,
                  message: `Success: ${weather.city} posted to ${platformName} channel: ${acctName}`,
                  context: {
                    scheduled_post_id: post.id,
                    city: weather.city,
                    city_id: post.city_id || null,
                    account_name: acctName,
                    resolved_city_id: (result as any).resolved_city_id ?? null,
                    external_post_id: result.id,
                  },
                });
                await supabase.from("system_health").upsert({
                  id: "last_publish",
                  last_status: "ok",
                  last_message: `${weather.city} → ${platformName} ${acctName}`,
                  last_run_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                });
              } catch (e) {
                console.warn(`[publish] success log failed:`, (e as any)?.message);
              }
            } else if (result.success && !result.id) {
              // Adapter reported success but returned no ID — treat as a hard failure.
              const msg = `${platformName} returned success without a video ID`;
              console.error(`[publish] ${msg} post=${post.id}`);
              platformErrors.push(msg);
              errorMessage = msg;
              await notifyFailure("upload", `${platformName} upload failed`, msg, { platform: platformName });
            } else {
              errorMessage = result.error || `${platformName} upload failed`;
              platformErrors.push(`${platformName}: ${errorMessage}`);
              console.error(`[publish] ${platformName} FAILED post=${post.id}: ${errorMessage}`);
              logEvent(supabase, EventType.UploadError, `Upload failed ${platformName}`, {
                scheduled_post_id: post.id, user_id: post.user_id, city: weather.city,
                platform: platformName, error_message: errorMessage,
                duration_ms: nowMs() - __uploadStartMs,
              });
              // Detect expired/invalid auth (token refresh failed) on any platform.
              const errLower = (errorMessage || "").toLowerCase();
              const isAuthExpired =
                errLower.includes("invalid_grant") ||
                errLower.includes("unauthorized") ||
                errLower.includes("401") ||
                errLower.includes("failed to obtain valid") ||
                errLower.includes("could not get valid token") ||
                errLower.includes("login expired") ||
                errLower.includes("token expired") ||
                errLower.includes("reconnect");
              if (isAuthExpired) {
                // Tag the error so publish_post handler can route this to an
                // info-style notification ("connection expired — reconnect")
                // instead of "Pipeline step failed".
                errorMessage = `[AUTH_EXPIRED:${platformName}] ${errorMessage}`;
                await supabase.from("notifications").insert({
                  user_id: post.user_id,
                  title: `⚠️ ${platformName.charAt(0).toUpperCase() + platformName.slice(1)} (${weather.city}) connection expired`,
                  message: `Reconnect ${platformName} in Settings → Social Connections to resume posting.`,
                  type: "warning",
                });
                await supabase.from("system_logs").insert({
                  user_id: post.user_id,
                  type: `post_auth_expired`,
                  message: `${platformName} token expired for ${weather.city}; needs reconnect`,
                  platform: platformName,
                  context: { scheduled_post_id: post.id, reason: "auth_expired", city: weather.city },
                });
              } else {
                await notifyFailure("upload", `${platformName} upload failed`, errorMessage, { platform: platformName });
              }
            }
          }
          // CRITICAL: only consider this a successful publish if at least one
          // platform actually returned a valid upload result. Otherwise the
          // job pipeline would treat token/upload failures as a success.
          if (!videoPostedAny) {
            postStatus = "failed";
            if (!errorMessage) errorMessage = platformErrors.join(" | ") || "All platform uploads failed";
          } else if (platformErrors.length > 0) {
            // Partial: some succeeded, some failed. Keep status posted but record the failures.
            errorMessage = `Partial publish — ${platformErrors.join(" | ")}`;
          }
        } else {
          // Video failed — surface the REAL render error (not the old hardcoded "credits depleted").
          const realRenderError = renderErrorSink.message || "Video render failed (no provider produced a valid video)";
          console.log(`Video generation failed for scheduled post — real error: ${realRenderError}`);
          await notifyFailure("render", "Render failed", realRenderError, { city: weather.city });
          postStatus = "failed";
          errorMessage = realRenderError;
          for (const platformName of platformsToPost) {
            await notifyFailure("upload", `${platformName} skipped`, `Video render failed: ${realRenderError}`, { platform: platformName });
          }
        }

        if (!errorMessage) {
          errorMessage = "Weather data fetched and caption generated successfully";
        }

        // Tag auto-posts so the History UI can show an "Automated" badge.
        // Detected via the [auto:slot] marker the scheduler placed in scheduled_posts.caption.
        if (isAutoMarker) {
          errorMessage = `[AUTO] ${errorMessage}`;
        }

        // post_history.status CHECK constraint only allows: success | failed | pending
        // Map our internal "posted" → "success" so the insert isn't silently rejected.
        const historyStatus = postStatus === "posted" ? "success" : postStatus;

        // Phase 3: structured post finalize checkpoint
        logEvent(
          supabase,
          postStatus === "posted" ? EventType.PostFinalizeSuccess : EventType.PostFinalizeFailed,
          `Post finalize: ${postStatus}`,
          {
            scheduled_post_id: post.id, user_id: post.user_id, city: weather?.city,
            platform: platformsToPost.join(","), status: postStatus,
            error_message: postStatus === "failed" ? errorMessage : null,
            duration_ms: nowMs() - __postStartMs,
          },
        );

        // Final action step in the trace
        trace("final_action", { action: postStatus === "posted" ? "POSTED" : `FAILED — ${errorMessage}`, voice_status: voiceStatus });
        // Always persist hook/cinematic/voice metadata for analytics; only
        // include the verbose `steps` array when the user opted in.
        // Derive a hook label from the caption (first non-empty line, ≤120 chars)
        // so analytics + the History UI always show what opened the post.
        const _hookSource = (caption || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
        const hookUsedDerived = _hookSource ? _hookSource.slice(0, 120) : null;
        const persistedTrace: Record<string, any> = {
          captured_at: new Date().toISOString(),
          hook_used: hookUsedDerived,
          hook_type: autoWinner.fields.hook ?? null,
          cinematic_mode: cinematicForced,
          cinematic_trigger: cinematicTrigger,
          voice_enabled: !!voiceUrl,
          auto_winner_applied: autoWinner.applied,
          auto_winner_fields: autoWinner.applied ? autoWinner.fields : null,
          auto_winner_flags: autoWinner.flags,
        };
        if (debugTraceEnabled) {
          persistedTrace.steps = traceSteps;
        }

        // Pick a representative external_id for the post_history row (prefer YouTube).
        const primaryExternalId =
          platformExternalIds["youtube"] ||
          platformExternalIds["tiktok"] ||
          Object.values(platformExternalIds)[0] ||
          null;

        // ── Post Health Score (0–100) ──
        // Mirrors the breakdown shown in the Review Modal so manual + automated
        // posts can be compared apples-to-apples in the History UI.
        const placeholderRe = /\{\{|\}\}|\[city\]|\[temperature\]|\bTODO\b|\bLorem ipsum\b|undefined|\bNaN\b/i;
        const captionPresent = !!caption && caption.trim().length > 0;
        const captionClean = captionPresent && !placeholderRe.test(caption);
        const ctaIncluded = (post.include_voiceover === true) || /subscribe|notification|bell/i.test(caption || "");
        const isVideoPlatform = ["youtube", "tiktok", "instagram", "linkedin"].includes(post.platform);
        const breakdownItems = [
          { key: "video", label: "Video asset", earned: postStatus === "posted" && isVideoPlatform ? 15 : 0, max: 15 },
          { key: "render_time", label: "Real render (>2s)", earned: postStatus === "posted" && isVideoPlatform ? 10 : 0, max: 10 },
          { key: "voice", label: "Voiceover audio", earned: voiceUrl ? 15 : 0, max: 15 },
          { key: "audio_duration", label: "Audio duration", earned: voiceUrl ? 5 : 0, max: 5 },
          { key: "caption", label: "Caption", earned: captionPresent ? 10 : 0, max: 10 },
          { key: "caption_clean", label: "No placeholders", earned: captionClean ? 10 : 0, max: 10 },
          { key: "platforms", label: "Target platform", earned: post.platform ? 10 : 0, max: 10 },
          { key: "aspect", label: "Vertical (9:16)", earned: isVideoPlatform ? 5 : 0, max: 5 },
          { key: "pipeline", label: "Pipeline clean", earned: postStatus === "posted" ? 10 : 0, max: 10 },
          { key: "cta", label: "Subscribe CTA", earned: ctaIncluded ? 5 : 0, max: 5 },
          { key: "duration", label: "Duration 12–15s", earned: isVideoPlatform && postStatus === "posted" ? 5 : 0, max: 5 },
        ];
        const healthScore = breakdownItems.reduce((s, i) => s + i.earned, 0);
        const healthTier =
          healthScore >= 85 ? "excellent" :
          healthScore >= 70 ? "good" :
          healthScore >= 50 ? "needs_improvement" : "do_not_post";
        const healthBreakdown = { score: healthScore, tier: healthTier, items: breakdownItems };
        console.log(`[process] post ${post.id}: health_score=${healthScore} (${healthTier})`);

        // ── Cinematic Preset System: persist preset/source/cost/eligible so
        // the visual-learning firewall can exclude fallback renders. Decision
        // is recomputed from the current render context (visualStyle drives
        // gradient vs image mode; storedImageUrl is the history-image tier).
        // Wrapped in try/catch so a cinematic-preset failure can NEVER abort
        // the publish path. Falls back to a no-op visual_metadata patch.
        let _cinPatch: { visual_metadata: any; published_visual_source: string | null } = {
          visual_metadata: { ...(visualMeta || {}), has_timestamp_in_title: titleHasTimestamp(title) },
          published_visual_source: null,
        };
        try {
          const cinematicSettings = (await loadCinematicSettings(supabase, post.user_id)) || { ...SAFE_CINEMATIC_DEFAULTS };
          const _cinematicDecision = resolveScene({
            city: weather.city,
            condition: weather.condition,
            mediaUrl: storedImageUrl,
            preset: pickPresetForDaily({
              condition: weather.condition,
              city: weather.city,
              slot: (post as any).slot || null,
              settings: cinematicSettings as any,
            }),
            mode: visualStyle === "gradient" ? "gradient" : "image",
            settings: cinematicSettings as any,
          });
          logCinematic("process-scheduled-posts", _cinematicDecision, { city: weather.city, kind: "daily" });
          _cinPatch = attachCinematicToPostHistory(
            { visual_metadata: { ...(visualMeta || {}), has_timestamp_in_title: titleHasTimestamp(title) } },
            _cinematicDecision,
          );
        } catch (cinErr) {
          console.warn(`[process] cinematic preset resolution failed for ${post.id} — using safe defaults:`, cinErr instanceof Error ? cinErr.message : cinErr);
        }


        const { data: historyRow, error: historyErr } = await supabase.from("post_history").insert({
          status: historyStatus, platform: post.platform, city: weather.city,
          temperature: weather.temperature, condition: weather.condition,
          image_url: storedImageUrl, error_message: errorMessage, caption,
          user_id: post.user_id, post_url: publishedPostUrl,
          external_id: primaryExternalId,
          slot: (post as any).slot || null,
          source: (post as any).source || null,
          voice_status: voiceStatus,
          voice_error: voiceError,
          voice_attempts: voiceAttemptsCount,
          debug_trace: persistedTrace,
          experiment_id: experimentCtx?.id ?? null,
          experiment_variant: experimentCtx?.variant ?? null,
          variant_id: (post as any).variant_id ?? experimentCtx?.variant ?? null,
          visual_metadata: _cinPatch.visual_metadata,
          published_visual_source: _cinPatch.published_visual_source,
          health_score: healthScore,
          health_breakdown: healthBreakdown,
          // Persist hook + cinematic flags so the History UI shows them on
          // any device (cross-device, server-authoritative).
          hook_used: hookUsedDerived,
          cinematic_mode: cinematicForced,
          cinematic_trigger: cinematicTrigger,
          voice_name: voiceUrl ? "AI" : null,
        }).select("id").single();
        if (historyErr) {
          console.error(`[process] post_history insert failed for ${post.id}:`, historyErr);
        } else {
          // Backfill experiment.post_id_a / post_id_b so the resolver can score it.
          if (experimentCtx && historyRow?.id && historyStatus === "success") {
            const col = experimentCtx.variant === "A" ? "post_id_a" : "post_id_b";
            try {
              await supabase.from("experiments").update({ [col]: historyRow.id }).eq("id", experimentCtx.id);
            } catch (e) { console.warn("[experiments] backfill failed:", e); }
          }
          console.log(`[process] post_history row created for ${post.id} (${post.platform}, ${historyStatus})`);

          // Seed post_analytics rows so the Analytics tab shows the post immediately.
          // One row per platform that successfully published. Includes context
          // fields used by the AI learning analyzer (tone, condition, time-of-day,
          // voiceover flag, local-reference detection).
          if (postStatus === "posted" && historyRow?.id && Object.keys(platformExternalIds).length > 0) {
            const hourLocal = new Date().getHours();
            const timeOfDay =
              hourLocal < 11 ? "morning" :
              hourLocal < 16 ? "afternoon" :
              hourLocal < 21 ? "evening" : "night";
            // Heuristic: caption mentions a local landmark / city-specific name beyond just the city itself.
            const captionLower = (caption || "").toLowerCase();
            const cityLower = (weather.city || "").toLowerCase();
            const localKeywords = ["downtown", "park", "river", "bay", "beach", "neighborhood", "ave", "street", "blvd"];
            const hasLocalReference =
              (cityLower && captionLower.includes(cityLower)) ||
              localKeywords.some((k) => captionLower.includes(k));
            const analyticsRows = Object.keys(platformExternalIds).map((plat) => ({
              user_id: post.user_id,
              post_id: historyRow.id,
              platform: plat,
              external_id: platformExternalIds[plat],
              tone: captionTone || null,
              condition: weather.condition || null,
              time_of_day: timeOfDay,
              has_voiceover: !!voiceUrl,
              has_local_reference: hasLocalReference,
              views: 0,
              likes: 0,
              comments: 0,
              shares: 0,
            }));
            const { error: analyticsErr } = await supabase.from("post_analytics").insert(analyticsRows);
            if (analyticsErr) {
              console.error(`[process] post_analytics seed failed for ${post.id}:`, analyticsErr);
            } else {
              console.log(`[process] seeded ${analyticsRows.length} post_analytics row(s) for ${historyRow.id}`);
            }

            // Phase 1 Growth Loop — seed post_performance per platform.
            try {
              const perfRows = Object.keys(platformExternalIds).map((plat) => ({
                post_id: historyRow.id,
                city: weather.city,
                platform: plat,
                slot: ((post as any).slot as ("morning"|"afternoon"|"evening"|null)) || null,
                title,
                caption: caption || null,
                hook_text: (caption || "").split("\n").map(s => s.trim()).filter(Boolean)[0] || null,
                tone: captionTone || null,
                style: (visualMeta as any)?.style || null,
                weather_condition: weather.condition || null,
                posted_with_voice: !!voiceUrl,
                published_at: new Date().toISOString(),
                source: ((post as any).source as string) || "auto",
              }));
              if (perfRows.length > 0) {
                const { error: perfErr } = await supabase
                  .from("post_performance")
                  .upsert(perfRows, { onConflict: "post_id,platform", ignoreDuplicates: true });
                if (perfErr) {
                  console.warn(`[analytics] post_performance seed failed for ${post.id}:`, perfErr.message);
                } else {
                  console.log(`[analytics] inserted post_performance row for ${weather.city} (${perfRows.map(r => r.platform).join(",")})`);
                }
              }
            } catch (e) {
              console.warn(`[analytics] post_performance seed exception:`, e instanceof Error ? e.message : e);
            }

            // Seed post_hooks for the auto-growth analyzer.
            // hook_text = first non-empty line, opener = first 6 words.
            try {
              const lines = (caption || "").split("\n").map(s => s.trim()).filter(Boolean);
              const hookText = lines[0] || null;
              const opener = hookText ? hookText.split(/\s+/).slice(0, 6).join(" ").toLowerCase() : null;
              if (hookText) {
                const hookRows = Object.keys(platformExternalIds).map((plat) => ({
                  user_id: post.user_id,
                  post_id: historyRow.id,
                  platform: plat,
                  hook_text: hookText,
                  opener,
                  tone: captionTone || null,
                  city: weather.city || null,
                }));
                const { error: hookErr } = await supabase.from("post_hooks").insert(hookRows);
                if (hookErr) console.warn(`[process] post_hooks seed failed for ${post.id}:`, hookErr);
              }
            } catch (e) {
              console.warn(`[process] hook seed exception:`, e);
            }
          }
        }

        const isFailureFlow = postStatus !== "posted";
        const currentRetryCount = (post as any).retry_count ?? 0;
        // Retry policy: up to 2 retries, 2 minutes apart. The retry re-runs
        // the entire pipeline (caption → voice → render → upload) because the
        // scheduler picks the row up again from scratch via the
        // status="retrying" + next_retry_at branch of the fetch query.
        const MAX_RETRIES = 2;
        const RETRY_DELAY_MS = 2 * 60 * 1000;
        if (isFailureFlow && currentRetryCount < MAX_RETRIES) {
          const nextRetryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
          await supabase.from("scheduled_posts").update({
            status: "retrying",
            error_message: errorMessage,
            retry_count: currentRetryCount + 1,
            next_retry_at: nextRetryAt,
            last_attempt_at: new Date().toISOString(),
            voice_status: voiceStatus,
            voice_error: voiceError,
            voice_attempts: voiceAttemptsCount,
            debug_trace: persistedTrace,
          }).eq("id", post.id);
          await supabase.from("system_logs").insert({
            user_id: post.user_id,
            type: "post_retry_scheduled",
            message: `Scheduled post failed, retrying in 2 minutes (attempt ${currentRetryCount + 1}/${MAX_RETRIES}): ${errorMessage}`,
            platform: post.platform,
            context: { scheduled_post_id: post.id, retry_count: currentRetryCount + 1 },
          });
        } else {
          await supabase.from("scheduled_posts").update({
            status: postStatus,
            error_message: errorMessage,
            voice_status: voiceStatus,
            voice_error: voiceError,
            voice_attempts: voiceAttemptsCount,
            debug_trace: persistedTrace,
          }).eq("id", post.id);

          // One-shot: if this run was traced, clear the toggle so the next run is silent again.
          if (debugTraceEnabled && post.user_id) {
            try {
              await supabase.from("weather_settings")
                .update({ enable_debug_trace: false })
                .eq("user_id", post.user_id);
              console.log(`[trace ${post.id}] one-shot debug toggle cleared for user ${post.user_id}`);
            } catch (e) { console.error("[trace] failed to clear debug toggle:", e); }
          }

          if (isFailureFlow) {
            await supabase.from("system_logs").insert({
              user_id: post.user_id,
              type: "post_error",
              message: `Scheduled post failed permanently: ${errorMessage}`,
              platform: post.platform,
              context: { scheduled_post_id: post.id, retry_count: currentRetryCount },
            });
          }
        }

        await supabase.from("notifications").insert({
          user_id: post.user_id,
          title: postStatus === "posted" ? "Post Published" : (currentRetryCount < MAX_RETRIES && isFailureFlow ? "Post Retrying" : "Post Failed"),
          message: postStatus === "posted"
            ? `Your weather post for ${weather.city} was processed on ${post.platform}.`
            : (currentRetryCount < MAX_RETRIES && isFailureFlow
                ? `Post for ${weather.city} failed — retrying in 2 minutes (attempt ${currentRetryCount + 1}/${MAX_RETRIES}).`
                : `Your scheduled post for ${weather.city} failed: ${errorMessage}`),
          type: postStatus === "posted" ? "success" : (currentRetryCount < MAX_RETRIES && isFailureFlow ? "info" : "error"),
        });

        // Clear "ghost" Post Retrying notifications once we've successfully published
        // for the same user + city. Keeps the Notifications panel clean and avoids
        // showing a stale "still retrying" alert next to a "Published" success.
        if (postStatus === "posted" && post.user_id) {
          try {
            await supabase
              .from("notifications")
              .delete()
              .eq("user_id", post.user_id)
              .eq("title", "Post Retrying")
              .ilike("message", `%${weather.city}%`);
          } catch (clearErr) {
            console.warn(`[notifications] failed to clear retry alerts for ${weather.city}:`, clearErr);
          }
        }

        processed++;
      } catch (postError) {
        const errMsg = postError instanceof Error ? postError.message : String(postError || "Processing failed");
        const errStack = postError instanceof Error ? (postError.stack || "") : "";
        console.error(`[process] per-post catch build=${PROCESS_SCHEDULED_POSTS_BUILD} post_id=${post.id} message=${errMsg}`);
        console.error(`[process] per-post stack post_id=${post.id}\n${errStack || "<no stack>"}`);
        logEvent(supabase, EventType.PipelineException, `Unhandled exception in per-post pipeline`, {
          scheduled_post_id: post.id,
          user_id: post.user_id,
          city: post.city,
          slot: (post as any).slot ?? null,
          platform: post.platform,
          error_message: errMsg.slice(0, 500),
          duration_ms: nowMs() - __postStartMs,
          status: "exception",
        });

        const currentRetryCount = (post as any).retry_count ?? 0;
        const MAX_RETRIES = 2;
        const RETRY_DELAY_MS = 2 * 60 * 1000;
        if (currentRetryCount < MAX_RETRIES) {
          const nextRetryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
          await supabase.from("scheduled_posts").update({
            status: "retrying",
            error_message: errMsg,
            retry_count: currentRetryCount + 1,
            next_retry_at: nextRetryAt,
            last_attempt_at: new Date().toISOString(),
          }).eq("id", post.id);
          // Release the publish lock so the retry can re-acquire it.
          try {
            if ((post as any).city_id) {
              await supabase.rpc("release_publish_lock", {
                p_user: post.user_id,
                p_city_id: (post as any).city_id,
                p_slot: (post as any).slot || "adhoc",
                p_platform: post.platform,
                p_tz: null,
              });
            }
          } catch (_) { /* best-effort */ }
          await supabase.from("system_logs").insert({
            user_id: post.user_id,
            type: "post_retry_scheduled",
            message: `Processing threw, retrying in 2 minutes (attempt ${currentRetryCount + 1}/${MAX_RETRIES}): ${errMsg}`,
            platform: post.platform,
            context: { scheduled_post_id: post.id, retry_count: currentRetryCount + 1 },
          });
          await supabase.from("notifications").insert({
            user_id: post.user_id,
            title: "Post Retrying",
            message: `Post for ${post.city} hit an error — retrying in 2 minutes (attempt ${currentRetryCount + 1}/${MAX_RETRIES}).`,
            type: "info",
          });
        } else {
          await supabase.from("scheduled_posts").update({
            status: "failed",
            error_message: errMsg,
            last_attempt_at: new Date().toISOString(),
          }).eq("id", post.id);
          try {
            if ((post as any).city_id) {
              await supabase.rpc("release_publish_lock", {
                p_user: post.user_id,
                p_city_id: (post as any).city_id,
                p_slot: (post as any).slot || "adhoc",
                p_platform: post.platform,
                p_tz: null,
              });
            }
          } catch (_) { /* best-effort */ }
          await supabase.from("system_logs").insert({
            user_id: post.user_id,
            type: "post_error",
            message: `Scheduled post failed permanently after ${MAX_RETRIES} retries: ${errMsg}`,
            platform: post.platform,
            context: { scheduled_post_id: post.id, retry_count: currentRetryCount },
          });
          await supabase.from("notifications").insert({
            user_id: post.user_id,
            title: "Post Failed",
            message: `Your scheduled post for ${post.city} failed: ${errMsg}`,
            type: "error",
          });
        }
        failed++;
      }
    }

    // For dev-test single-post invocations, surface the rendered preview URL.
    let previewUrl: string | null = null;
    if (skipPost && singlePostId) {
      try {
        const { data: row } = await supabase
          .from("scheduled_posts")
          .select("cached_video_url, status")
          .eq("id", singlePostId)
          .maybeSingle();
        previewUrl = (row as any)?.cached_video_url ?? null;
      } catch { /* ignore */ }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${processed}, failed ${failed}`,
        processed,
        failed,
        mode: skipPost ? "dev" : "post",
        preview_url: previewUrl,
        build: PROCESS_SCHEDULED_POSTS_BUILD,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("process-scheduled-posts error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

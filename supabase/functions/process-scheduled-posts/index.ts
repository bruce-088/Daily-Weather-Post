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
  tomorrowHigh: number | null;
  tomorrowLow: number | null;
  tomorrowCondition: string | null;
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

function generateSkyBriefTitle(city: string, temp: number, condition: string, rainChance?: number): string {
  const emoji = getWeatherEmoji(condition);
  const isStorm = /thunder|storm|tornado|hurricane/i.test(condition);

  if (rainChance != null && rainChance >= 60 && isStorm) {
    return `Storms in ${city}? ⛈ Weather Update`;
  }

  const variant = new Date().getDay() % 3;
  let title: string;
  switch (variant) {
    case 0: title = `${city} Weather Today ${emoji} | ${temp}° ${condition}`; break;
    case 1: title = `Today's Weather in ${city} ${emoji} Quick Forecast`; break;
    default: title = `${city} Forecast Today ${emoji} Weather Update`; break;
  }

  return title.length > 60 ? title.substring(0, 57) + "..." : title;
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

async function fetchPexelsVideoUrl(keyword: string, city?: string, region?: string): Promise<string | null> {
  const pexelsKey = Deno.env.get("PEXELS_API_KEY");
  if (!pexelsKey) { console.log("PEXELS_API_KEY not configured"); return null; }

  async function searchPexels(query: string): Promise<string | null> {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=15&orientation=portrait&size=medium`;
    console.log("Fetching Pexels video:", query);
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

  // City-specific search keywords for cities that don't return accurate Pexels results
  const cityKeywords: Record<string, string[]> = {
    "gainesville": ["university of florida campus", "florida swamp nature", "florida oak trees spanish moss"],
    "tallahassee": ["florida capitol building", "tallahassee florida trees", "florida panhandle nature"],
    "jacksonville": ["jacksonville florida bridge", "jacksonville beach florida", "st johns river florida"],
    "orlando": ["orlando florida lake", "orlando florida downtown", "florida theme park"],
    "tampa": ["tampa bay florida", "tampa skyline waterfront", "tampa riverwalk"],
    "miami": ["miami beach ocean", "miami skyline biscayne", "south beach florida"],
    "st. petersburg": ["st pete florida pier", "st petersburg florida waterfront", "tampa bay sunset"],
    "fort lauderdale": ["fort lauderdale beach", "fort lauderdale florida canal", "south florida coast"],
    "naples": ["naples florida beach", "naples pier florida", "gulf of mexico florida"],
    "sarasota": ["sarasota florida beach", "siesta key florida", "sarasota bay"],
    "pensacola": ["pensacola beach florida", "emerald coast florida", "pensacola bay"],
    "daytona beach": ["daytona beach florida", "daytona speedway", "florida atlantic coast"],
    "ocala": ["ocala florida horses", "florida springs nature", "ocala national forest"],
  };

  const locationTag = region && region !== city ? `${city} ${region}` : city;
  const cityLower = (city || "").toLowerCase();

  try {
    // Tier 0: City-specific curated keywords
    const specificKeywords = cityKeywords[cityLower];
    if (specificKeywords) {
      const randomKeyword = specificKeywords[Math.floor(Math.random() * specificKeywords.length)];
      const specificResult = await searchPexels(randomKeyword);
      if (specificResult) return specificResult;
      console.log(`No city-specific video for "${city}", trying skyline`);
    }

    // Tier 1: City + state skyline
    if (city) {
      const skylineResult = await searchPexels(`${locationTag} skyline`);
      if (skylineResult) return skylineResult;
      console.log(`No skyline video for "${locationTag}", trying city + weather`);
    }
    // Tier 2: City + state + weather condition
    if (city) {
      const cityResult = await searchPexels(`${locationTag} ${keyword}`);
      if (cityResult) return cityResult;
      console.log(`No Pexels videos for "${locationTag} ${keyword}", trying region`);
    }
    // Tier 3: Region/state + weather condition
    if (region && region !== city) {
      const regionResult = await searchPexels(`${region} ${keyword}`);
      if (regionResult) return regionResult;
      console.log(`No Pexels videos for "${region}", trying nature fallback`);
    }
    // Tier 4: Nature-based weather fallback
    const natureFallbacks: Record<string, string> = {
      sunny: "sunshine blue sky nature",
      clear: "clear sky sunrise nature",
      cloudy: "cloudy sky timelapse",
      rain: "rain drops nature",
      storm: "thunderstorm lightning",
      snow: "snowfall winter nature",
      fog: "fog morning nature",
      wind: "windy trees nature",
    };
    const conditionKey = Object.keys(natureFallbacks).find(k => keyword.toLowerCase().includes(k));
    const fallbackQuery = conditionKey ? natureFallbacks[conditionKey] : `${keyword} weather nature`;
    return await searchPexels(fallbackQuery);
  } catch { return null; }
}

function buildCreatomateSource(weather: WeatherResponse, videoUrl?: string | null, timePeriod?: string | null, voiceUrl?: string | null): object {
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
  const txtShadow = "0px 1px 4px rgba(0,0,0,0.4)";

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

  const elements: any[] = [
    ...(videoUrl ? [
      { type: "video", track: nt(), time: 0, duration: 10, source: videoUrl, width: "100%", height: "100%", x: "50%", y: "50%", fit: "cover" },
    ] : [
      { type: "shape", track: nt(), time: 0, duration: 10, shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%", fill_color: `linear-gradient(170deg, ${theme.bg1} 0%, ${theme.bg2} 50%, ${theme.bg1} 100%)` },
    ]),
    { type: "shape", track: nt(), time: 0, duration: 10, shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
      fill_color: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0.25) 60%, rgba(0,0,0,0.45) 100%)" },
    { type: "shape", track: nt(), time: 0, duration: 10, shape_type: "ellipse", width: 1400, height: 1400, x: "75%", y: "30%", fill_color: theme.glow1,
      animations: [{ type: "scale", start_scale: "95%", end_scale: "108%", duration: 10, easing: "linear" }] },
    { type: "text", track: nt(), time: 0, duration: 10, text: "SKYBRIEF", font_family: "Inter", font_weight: "700", font_size: "42", fill_color: "#ffffff", letter_spacing: "18%",
      x: "50%", y: "7%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.5 } },
    { type: "shape", track: nt(), time: 0.2, duration: 9.8, shape_type: "rectangle", width: 60, height: 3, x: "50%", y: "9.5%", fill_color: theme.accent, border_radius: "2",
      enter: { type: "scale", start_scale: "0%", duration: 0.6 } },

    // === TIME PERIOD BADGE ===
    { type: "shape", track: nt(), time: 0.3, duration: 9.7, shape_type: "rectangle", width: 420, height: 50, x: "50%", y: "12%",
      fill_color: "rgba(255,255,255,0.12)", border_radius: "25",
      enter: { type: "fade", duration: 0.4 } },
    { type: "text", track: nt(), time: 0.3, duration: 9.7, text: periodLabel, font_family: "Inter", font_weight: "700", font_size: "28", fill_color: theme.accent, letter_spacing: "4%",
      x: "50%", y: "12%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.4 } },

    { type: "shape", track: nt(), time: 0.2, duration: 9.8, shape_type: "rectangle", width: 800, height: 200, x: "50%", y: "18%",
      fill_color: "rgba(0,0,0,0.35)", border_radius: "14", enter: { type: "fade", duration: 0.4 } },
    { type: "text", track: nt(), time: 0.3, duration: 9.7, text: weather.city.toUpperCase(), font_family: "Inter", font_weight: "800", font_size: "76", fill_color: "#ffffff",
      x: "50%", y: "16%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "slide", direction: "up", duration: 0.5 } },
    { type: "text", track: nt(), time: 0.5, duration: 9.5, text: `${weather.stateOrRegion}  ·  ${dateStr}`, font_family: "Inter", font_weight: "500", font_size: "30", fill_color: "rgba(255,255,255,0.65)",
      x: "50%", y: "21%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.5 } },
    { type: "text", track: nt(), time: 0.6, duration: 9.4, text: theme.emoji, font_size: "80",
      x: "50%", y: "30%", x_alignment: "50%", y_alignment: "50%", enter: { type: "scale", start_scale: "50%", duration: 0.6 } },
    { type: "text", track: nt(), time: 0.7, duration: 9.3, text: `${weather.temperature}°`, font_family: "Inter", font_weight: "900", font_size: "180", fill_color: "#ffffff",
      x: "50%", y: "42%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "scale", start_scale: "60%", duration: 0.6 } },
    { type: "text", track: nt(), time: 0.9, duration: 9.1, text: weather.description.charAt(0).toUpperCase() + weather.description.slice(1),
      font_family: "Inter", font_weight: "600", font_size: "38", fill_color: theme.accent,
      x: "50%", y: "51%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.5 } },
    { type: "shape", track: nt(), time: 1.3, duration: 8.7, shape_type: "rectangle", width: 920, height: 260, x: "50%", y: "63%",
      fill_color: "rgba(10,15,30,0.65)", border_radius: "28", border_width: 1, border_color: "rgba(255,255,255,0.10)",
      shadow: "inset 0 1px 0 rgba(255,255,255,0.05)", enter: { type: "scale", start_scale: "92%", duration: 0.5 } },
    { type: "text", track: nt(), time: 1.5, duration: 8.5, text: "HIGH", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
      x: "17%", y: "58.5%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: 8.5, text: "LOW", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
      x: "39%", y: "58.5%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: 8.5, text: "RAIN", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
      x: "61%", y: "58.5%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.5, duration: 8.5, text: "WIND", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
      x: "83%", y: "58.5%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.3 } },
    { type: "text", track: nt(), time: 1.7, duration: 8.3, text: `${hi}°`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
      x: "17%", y: "63.5%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 1.8, duration: 8.2, text: `${lo}°`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
      x: "39%", y: "63.5%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 1.9, duration: 8.1, text: `${weather.rainChance}%`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
      x: "61%", y: "63.5%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "text", track: nt(), time: 2.0, duration: 8.0, text: windSpeed, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
      x: "83%", y: "63.5%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "slide", direction: "up", duration: 0.4 } },
    { type: "shape", track: nt(), time: 1.6, duration: 8.4, shape_type: "rectangle", width: 1, height: 80, x: "28%", y: "61.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },
    { type: "shape", track: nt(), time: 1.6, duration: 8.4, shape_type: "rectangle", width: 1, height: 80, x: "50%", y: "61.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },
    { type: "shape", track: nt(), time: 1.6, duration: 8.4, shape_type: "rectangle", width: 1, height: 80, x: "72%", y: "61.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },
  ];

  if (alertLine) {
    elements.push(
      { type: "text", track: nt(), time: 2.2, duration: 7.8, text: alertLine, font_family: "Inter", font_weight: "700", font_size: "30", fill_color: "#fbbf24",
        x: "50%", y: "73%", x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.5 } }
    );
  }

  const takeawayY = alertLine ? "77%" : "74%";
  elements.push(
    { type: "text", track: nt(), time: 2.5, duration: 7.5, text: takeaway, font_family: "Inter", font_weight: "600", font_size: "32", fill_color: "#ffffff",
      x: "50%", y: takeawayY, x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.6 } }
  );

  const tomorrowY = alertLine ? "81%" : "78.5%";
  elements.push(
    { type: "text", track: nt(), time: 3.0, duration: 7.0, text: tomorrowPreview, font_family: "Inter", font_weight: "500", font_size: "28", fill_color: "rgba(255,255,255,0.6)",
      x: "50%", y: tomorrowY, x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.5 } }
  );

  const ctaDivY = alertLine ? "86%" : "84%";
  const ctaTextY = alertLine ? "90%" : "88%";
  elements.push(
    { type: "shape", track: nt(), time: 3.5, duration: 6.5, shape_type: "rectangle", width: 80, height: 2, x: "50%", y: ctaDivY, fill_color: theme.accent, border_radius: "1",
      enter: { type: "scale", start_scale: "0%", duration: 0.5 } },
    { type: "text", track: nt(), time: 3.8, duration: 6.2, text: habitCTA, font_family: "Inter", font_weight: "500", font_size: "28", fill_color: "rgba(255,255,255,0.55)",
      x: "50%", y: ctaTextY, x_alignment: "50%", y_alignment: "50%", shadow: txtShadow, enter: { type: "fade", duration: 0.6 } },
  );

  // === AI VOICEOVER (optional) ===
  // Plays from t=0.5s on its own track. If TTS step failed upstream, voiceUrl is null and we render silently.
  if (voiceUrl) {
    elements.push({
      type: "audio",
      track: nt(),
      time: 0.5,
      duration: 9.5,
      source: voiceUrl,
      volume: "100%",
    });
  }

  return {
    width: 1080, height: 1920, duration: 10, frame_rate: 30, fill_color: theme.bg1,
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

function clampVoiceParam(n: any, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

async function generateVoiceScript(weather: WeatherResponse): Promise<string> {
  const fallback = `Good day, ${weather.city}. Expect ${weather.description.toLowerCase()} with a high near ${weather.temperature} degrees today.`;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) return fallback;
  const userPrompt = [
    `City: ${weather.city}`,
    `Condition: ${weather.description}`,
    `Current temp: ${weather.temperature}°F`,
    `Rain chance: ${weather.rainChance}%`,
    "",
    "Write a SPOKEN weather script. Strict rules:",
    "- Maximum 2 sentences, ~25 words total.",
    "- Sound natural when read aloud (no emojis, no hashtags, no special chars).",
    "- Mention the city, the dominant condition, and the temperature.",
    "- Return ONLY the script text. No labels, no quotes.",
  ].join("\n");
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "You are a concise broadcast weather scriptwriter. Output spoken-style scripts only." },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) { console.error("[voice] script AI failed:", res.status); return fallback; }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || fallback;
  } catch (e) {
    console.error("[voice] script error:", e);
    return fallback;
  }
}

async function generateVoiceAudio(
  script: string,
  voiceId: string,
  opts?: { speed?: number; stability?: number; similarity?: number },
): Promise<Uint8Array | null> {
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  if (!apiKey) { console.error("[voice] ELEVENLABS_API_KEY not configured"); return null; }
  const speed = clampVoiceParam(opts?.speed, 0.7, 1.2, 1.0);
  const stability = clampVoiceParam(opts?.stability, 0, 1, 0.55);
  const similarity = clampVoiceParam(opts?.similarity, 0, 1, 0.78);
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${resolveVoiceId(voiceId)}?output_format=mp3_44100_128`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: script,
        model_id: "eleven_turbo_v2_5",
        voice_settings: { stability, similarity_boost: similarity, style: 0.35, use_speaker_boost: true, speed },
      }),
    });
    if (!res.ok) {
      console.error("[voice] ElevenLabs TTS failed:", res.status, (await res.text()).slice(0, 200));
      return null;
    }
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    console.error("[voice] ElevenLabs TTS error:", e);
    return null;
  }
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

async function generateWeatherVideo(weather: WeatherResponse, timePeriod?: string | null, voiceUrl?: string | null): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const apiKey = Deno.env.get("CREATOMATE_API_KEY");
  if (!apiKey) {
    console.error("CREATOMATE_API_KEY not configured");
    return null;
  }

  console.log("Starting Creatomate render for", weather.city, voiceUrl ? "(with voiceover)" : "(no voice)");
  const theme = getWeatherTheme(weather.condition);
  const videoUrl = await fetchPexelsVideoUrl(theme.videoKeyword, weather.city, weather.stateOrRegion);
  const source = buildCreatomateSource(weather, videoUrl, timePeriod, voiceUrl);

  const requestBody = JSON.stringify({ output_format: "mp4", ...source });
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
  console.log("Creatomate response status:", renderRes.status, "body:", responseText.substring(0, 500));

  if (!renderRes.ok) {
    console.error("Creatomate render request failed:", renderRes.status, responseText);
    return null;
  }

  let renders;
  try {
    renders = JSON.parse(responseText);
  } catch {
    console.error("Failed to parse Creatomate response as JSON");
    return null;
  }
  
  const renderId = Array.isArray(renders) ? renders[0]?.id : renders?.id;
  if (!renderId) {
    console.error("No render ID in Creatomate response");
    return null;
  }

  console.log("Creatomate render started, ID:", renderId);

  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));

    const statusRes = await fetch(`https://api.creatomate.com/v2/renders/${renderId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!statusRes.ok) {
      console.error("Creatomate status check failed:", statusRes.status);
      continue;
    }

    const statusData = await statusRes.json();
    console.log(`Render ${renderId} status: ${statusData.status}`);

    if (statusData.status === "succeeded" && statusData.url) {
      console.log("Render complete, downloading video...");
      const videoRes = await fetch(statusData.url);
      if (!videoRes.ok) {
        console.error("Failed to download rendered video");
        return null;
      }
      const arrayBuf = await videoRes.arrayBuffer();
      console.log(`Video downloaded: ${arrayBuf.byteLength} bytes`);
      return { data: new Uint8Array(arrayBuf), mimeType: "video/mp4" };
    }

    if (statusData.status === "failed") {
      console.error("Creatomate render failed:", statusData.error_message || "unknown error");
      return null;
    }
  }

  console.error("Creatomate render timed out after 3 minutes");
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const openWeatherApiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!openWeatherApiKey) {
      throw new Error("OpenWeatherMap API key not configured");
    }

    const { data: duePosts, error: fetchError } = await supabase
      .from("scheduled_posts")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_at", new Date().toISOString());

    if (fetchError) throw new Error(`Failed to fetch scheduled posts: ${fetchError.message}`);
    if (!duePosts || duePosts.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No posts due", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    let failed = 0;

    for (const post of duePosts) {
      try {
        const weather = await fetchWeatherData(post.city, openWeatherApiKey);

        // Use pre-written caption if available, otherwise auto-generate.
        // Auto-post rows from auto-post-scheduler use a marker like "[auto:morning]"
        // as the caption (for duplicate detection). Treat those as empty so we
        // generate a real AI caption here.
        const rawCaption: string | null = post.caption || null;
        const isAutoMarker = !!rawCaption && /^\s*\[auto:[a-z]+\]\s*$/i.test(rawCaption);
        let caption: string | null = isAutoMarker ? null : rawCaption;
        if (!caption) {
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
          if (LOVABLE_API_KEY) {
            try {
              const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${LOVABLE_API_KEY}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: "google/gemini-3-flash-preview",
                  messages: [
                    { role: "system", content: SKYBRIEF_SYSTEM_PROMPT },
                    { role: "user", content: buildSkyBriefUserPrompt(weather) },
                  ],
                }),
              });
              if (aiRes.ok) {
                const aiData = await aiRes.json();
                caption = aiData.choices?.[0]?.message?.content?.trim() || null;
              }
            } catch (e) {
              console.error("Caption generation failed:", e);
            }
          }
        }

        let postStatus = "posted";
        let errorMessage: string | null = null;
        let storedImageUrl: string | null = null;

        // --- Platform Upload via Adapter ---
        const platformsToPost = post.platform === "both" ? ["youtube", "tiktok"] : post.platform.split(",").map((p: string) => p.trim());
        const title = generateSkyBriefTitle(weather.city, weather.temperature, weather.condition, weather.rainChance);
        const desc = caption || "Weather update for " + weather.city + ": " + weather.temperature + "°F, " + weather.description;

        // Extract slot (morning/afternoon/evening) from auto-post marker if present, so the
        // video header shows the correct period badge for auto-posts.
        const slotMatch = rawCaption ? /\[auto:([a-z]+)\]/i.exec(rawCaption) : null;
        const timePeriod = slotMatch ? slotMatch[1].toLowerCase() : null;

        // === AI VOICEOVER (auto-posts) ===
        // include_voiceover is set by auto-post-scheduler ONLY for video-capable platforms
        // and only when the user enabled the preference. Manual scheduled posts default to false.
        // If TTS fails, we render silently — never break the schedule.
        let voiceUrl: string | null = post.voiceover_url || null;
        if (!voiceUrl && post.include_voiceover && post.user_id) {
          console.log(`[process] post ${post.id}: voiceover requested, generating script + TTS`);
          try {
            // Look up the user's preferred voice
            const { data: vSettings } = await supabase
              .from("weather_settings")
              .select("voiceover_voice_id")
              .eq("user_id", post.user_id)
              .limit(1)
              .maybeSingle();
            const voiceId = (vSettings as any)?.voiceover_voice_id || "female";

            const script = await generateVoiceScript(weather);
            console.log(`[process] post ${post.id}: voice script: ${script}`);
            const audioBytes = await generateVoiceAudio(script, voiceId);
            if (audioBytes) {
              const url = await storeVoiceAudio(supabase, post.user_id, audioBytes);
              if (url) {
                voiceUrl = url;
                console.log(`[process] post ${post.id}: ✅ voiceover ready`);
                // Persist on the row so re-runs don't regenerate the same audio
                await supabase.from("scheduled_posts").update({ voiceover_url: url }).eq("id", post.id);
              } else {
                console.warn(`[process] post ${post.id}: voice upload failed — falling back to silent video`);
              }
            } else {
              console.warn(`[process] post ${post.id}: TTS failed — falling back to silent video`);
            }
          } catch (vErr) {
            console.error(`[process] post ${post.id}: voiceover pipeline error — falling back to silent video:`, vErr);
            voiceUrl = null;
          }
        }

        // Try video generation once (with voiceover baked in if available)
        const video = await generateWeatherVideo(weather, timePeriod, voiceUrl);

        if (video) {
          // Video succeeded — post to all platforms
          for (const platformName of platformsToPost) {
            const result = await postToPlatform(platformName, supabase, post.user_id, video.data, title, desc, video.mimeType);
            if (result.success) {
              console.log(`Scheduled post ${post.id}: ${platformName} published, ID: ${result.id}`);
            } else {
              errorMessage = result.error || `${platformName} upload failed`;
            }
          }
        } else {
          // Video failed — fallback to image for image-capable platforms
          console.log("Video generation failed for scheduled post, attempting fallback image...");
          const fallbackImage = await generateFallbackImage(weather);

          if (!fallbackImage) {
            errorMessage = "Both video and fallback image generation failed";
          } else {
            // Store the generated image to Supabase Storage
            const stored = await storeGeneratedImage(supabase, post.user_id, fallbackImage.data, fallbackImage.mimeType, weather.city);
            if (stored) {
              storedImageUrl = stored.signedUrl;
              console.log("Image stored at:", stored.storagePath);
            }
            
            const imageCapablePlatforms = ["linkedin", "twitter", "tiktok"];
            const videoOnlyPlatforms = ["youtube", "instagram"];
            let postedAny = false;

            for (const platformName of platformsToPost) {
              if (imageCapablePlatforms.includes(platformName)) {
                try {
                  const { getAdapter } = await import("../_shared/platform-adapter.ts");
                  const adapter = getAdapter(platformName);
                  if (!adapter) continue;
                  const token = await adapter.getValidToken(supabase, post.user_id);
                  if (!token) { console.error(`${platformName}: failed to get token for image post`); continue; }

                  if (platformName === "linkedin") {
                    const postResult = await postLinkedInImage(token, fallbackImage.data, title, desc);
                    if (postResult) { postedAny = true; console.log(`Scheduled ${post.id}: linkedin image posted, ID: ${postResult}`); }
                    else { errorMessage = "LinkedIn image post failed"; }
                  } else if (platformName === "twitter") {
                    const postResult = await postTwitterImage(token, fallbackImage.data, desc);
                    if (postResult) { postedAny = true; console.log(`Scheduled ${post.id}: twitter image posted, ID: ${postResult}`); }
                    else { errorMessage = "Twitter image post failed"; }
                  } else if (platformName === "tiktok") {
                    if (storedImageUrl) {
                      const { TikTokAdapter } = await import("../_shared/tiktok-adapter.ts");
                      const tiktokAdapter = new TikTokAdapter();
                      const postResult = await tiktokAdapter.uploadImage(token, storedImageUrl, title, desc);
                      if (postResult) { postedAny = true; console.log(`Scheduled ${post.id}: tiktok photo posted, publish_id: ${postResult}`); }
                      else { errorMessage = "TikTok photo post failed"; }
                    } else {
                      console.log(`Skipping TikTok for scheduled ${post.id} — no stored image URL`);
                    }
                  }
                } catch (err) {
                  console.error(`${platformName} image post error:`, err);
                  errorMessage = `${platformName} image post failed`;
                }
              } else if (videoOnlyPlatforms.includes(platformName)) {
                console.log("Skipping " + platformName + " — requires video (image fallback only)");
                errorMessage = (errorMessage || "") + platformName + " skipped (video required, credits depleted); ";
              }
            }

            if (!postedAny && !errorMessage) {
              errorMessage = "No image-capable platforms in selection — video generation failed";
            }
          }
        }

        if (!errorMessage) {
          errorMessage = "Weather data fetched and caption generated successfully";
        }

        // post_history.status CHECK constraint only allows: success | failed | pending
        // Map our internal "posted" → "success" so the insert isn't silently rejected.
        const historyStatus = postStatus === "posted" ? "success" : postStatus;

        const { error: historyErr } = await supabase.from("post_history").insert({
          status: historyStatus, platform: post.platform, city: weather.city,
          temperature: weather.temperature, condition: weather.condition,
          image_url: storedImageUrl, error_message: errorMessage, caption,
          user_id: post.user_id,
        });
        if (historyErr) {
          console.error(`[process] post_history insert failed for ${post.id}:`, historyErr);
        } else {
          console.log(`[process] post_history row created for ${post.id} (${post.platform}, ${historyStatus})`);
        }

        await supabase.from("scheduled_posts").update({ status: postStatus, error_message: errorMessage }).eq("id", post.id);

        await supabase.from("notifications").insert({
          user_id: post.user_id,
          title: "Post Published",
          message: `Your weather post for ${weather.city} was processed on ${post.platform}.`,
          type: "success",
        });

        processed++;
      } catch (postError) {
        const errMsg = postError instanceof Error ? postError.message : "Processing failed";
        await supabase.from("scheduled_posts").update({ status: "failed", error_message: errMsg }).eq("id", post.id);
        await supabase.from("notifications").insert({
          user_id: post.user_id,
          title: "Post Failed",
          message: `Your scheduled post for ${post.city} failed: ${errMsg}`,
          type: "error",
        });
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ success: true, message: `Processed ${processed}, failed ${failed}`, processed, failed }),
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

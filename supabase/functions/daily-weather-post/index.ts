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
Final line: Short local-style signoff or CTA to follow for daily updates

STYLE RULES:
- Keep total caption under 120 words
- Use emojis sparingly (0-4 max), only weather emojis
- Include a practical takeaway
- If severe weather, shift to calm, clear, alert tone
- Never exaggerate risk
- Never include hashtags unless explicitly requested
- Never write more than one CTA

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
extra_note: `;
}

// --- YouTube Upload Helpers ---

async function getValidYouTubeToken(supabase: any, userId: string): Promise<string | null> {
  const { data: settings } = await supabase
    .from("weather_settings")
    .select("youtube_access_token, youtube_refresh_token, youtube_token_expires_at")
    .eq("user_id", userId)
    .single();

  if (!settings?.youtube_access_token) return null;

  // Check if token is still valid (5 min buffer)
  const expiresAt = settings.youtube_token_expires_at ? new Date(settings.youtube_token_expires_at) : null;
  if (expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return settings.youtube_access_token;
  }

  // Refresh token
  if (!settings.youtube_refresh_token) {
    console.error("No YouTube refresh token available");
    return null;
  }

  const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID");
  const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) {
    console.error("YouTube client credentials not configured");
    return null;
  }

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: settings.youtube_refresh_token,
    }),
  });

  const refreshData = await refreshRes.json();
  if (!refreshData.access_token) {
    console.error("YouTube token refresh failed:", JSON.stringify(refreshData));
    return null;
  }

  const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();
  await supabase
    .from("weather_settings")
    .update({
      youtube_access_token: refreshData.access_token,
      youtube_token_expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  console.log("YouTube token refreshed successfully");
  return refreshData.access_token;
}

async function uploadToYouTubeShorts(
  accessToken: string,
  videoData: Uint8Array,
  title: string,
  description: string,
  mimeType = "video/mp4",
): Promise<{ videoId: string } | null> {
  console.log(`Uploading to YouTube Shorts: "${title}" (${videoData.byteLength} bytes, ${mimeType})`);

  // Step 1: Initiate resumable upload
  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(videoData.byteLength),
      },
      body: JSON.stringify({
        snippet: {
          title: (title.length > 95 ? title.substring(0, 95) : title) + " #Shorts",
          description,
          categoryId: "22", // People & Blogs
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  if (!initRes.ok) {
    const errText = await initRes.text();
    console.error("YouTube upload init failed:", initRes.status, errText);
    return null;
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) {
    console.error("No upload URL returned from YouTube");
    return null;
  }

  // Step 2: Upload the video data
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(videoData.byteLength),
    },
    body: videoData,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    console.error("YouTube video upload failed:", uploadRes.status, errText);
    return null;
  }

  const result = await uploadRes.json();
  console.log("YouTube upload success! Video ID:", result.id);
  return { videoId: result.id };
}

// --- Creatomate Video Generation ---

interface WeatherTheme {
  bg1: string; bg2: string; accent: string;
  glow1: string; glow2: string; emoji: string;
  videoKeyword: string; panelBg: string;
}

function getWeatherTheme(condition: string): WeatherTheme {
  const c = condition.toLowerCase();
  if (c.includes("rain") || c.includes("drizzle")) return { bg1: "#0a1628", bg2: "#152238", accent: "#60a5fa", glow1: "rgba(96,165,250,0.10)", glow2: "rgba(59,130,246,0.06)", emoji: "🌧️", videoKeyword: "rain window dark moody", panelBg: "rgba(10,22,40,0.82)" };
  if (c.includes("thunder") || c.includes("storm")) return { bg1: "#110820", bg2: "#1e1038", accent: "#a78bfa", glow1: "rgba(167,139,250,0.10)", glow2: "rgba(139,92,246,0.06)", emoji: "⛈️", videoKeyword: "lightning storm dark sky", panelBg: "rgba(17,8,32,0.82)" };
  if (c.includes("snow")) return { bg1: "#0c1524", bg2: "#162340", accent: "#93c5fd", glow1: "rgba(147,197,253,0.10)", glow2: "rgba(191,219,254,0.06)", emoji: "❄️", videoKeyword: "snow falling slow motion", panelBg: "rgba(12,21,36,0.82)" };
  if (c.includes("cloud") || c.includes("overcast")) return { bg1: "#0e1420", bg2: "#1a2030", accent: "#94a3b8", glow1: "rgba(148,163,184,0.08)", glow2: "rgba(100,116,139,0.05)", emoji: "☁️", videoKeyword: "clouds sky timelapse moody", panelBg: "rgba(14,20,32,0.82)" };
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return { bg1: "#12121e", bg2: "#1e1e30", accent: "#a1a1aa", glow1: "rgba(161,161,170,0.08)", glow2: "rgba(113,113,122,0.05)", emoji: "🌫️", videoKeyword: "fog mist morning forest", panelBg: "rgba(18,18,30,0.82)" };
  return { bg1: "#0a1020", bg2: "#14203a", accent: "#fbbf24", glow1: "rgba(251,191,36,0.08)", glow2: "rgba(245,158,11,0.05)", emoji: "☀️", videoKeyword: "blue sky sun golden hour", panelBg: "rgba(10,16,32,0.82)" };
}

function getPracticalTakeaway(weather: WeatherResponse): string {
  const c = weather.condition.toLowerCase();
  const temp = weather.temperature;
  const rain = weather.rainChance;
  if (c.includes("thunder") || c.includes("storm")) return "⚡ Stay indoors if possible";
  if (rain >= 70) return "☔ Bring an umbrella today";
  if (rain >= 40) return "🌂 Rain possible — pack a layer";
  if (c.includes("snow")) return "❄️ Bundle up and drive safe";
  if (c.includes("fog") || c.includes("mist")) return "🌫️ Low visibility — drive carefully";
  if (temp >= 95) return "🥵 Stay hydrated, limit sun exposure";
  if (temp >= 80 && c.includes("clear")) return "☀️ Great day to be outside";
  if (temp >= 70) return "👍 Comfortable temps all day";
  if (temp >= 50) return "🧥 Grab a jacket for later";
  if (temp < 32) return "🧊 Below freezing — dress warm";
  if (temp < 50) return "🧣 Chilly — layer up today";
  return "📋 Check back for updates";
}

async function fetchPexelsVideoUrl(keyword: string): Promise<string | null> {
  const pexelsKey = Deno.env.get("PEXELS_API_KEY");
  if (!pexelsKey) { console.log("PEXELS_API_KEY not configured, skipping stock video"); return null; }
  try {
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(keyword)}&per_page=15&orientation=portrait&size=medium`;
    console.log("Fetching Pexels video:", keyword);
    const res = await fetch(url, { headers: { Authorization: pexelsKey } });
    if (!res.ok) { console.error("Pexels API error:", res.status); return null; }
    const data = await res.json();
    const videos = data.videos || [];
    if (!videos.length) { console.log("No Pexels videos found for:", keyword); return null; }
    const video = videos[Math.floor(Math.random() * videos.length)];
    const files = video.video_files || [];
    const hdFile = files.find((f: any) => f.quality === "hd" && f.width <= 1080)
      || files.find((f: any) => f.quality === "hd")
      || files.find((f: any) => f.quality === "sd")
      || files[0];
    if (hdFile?.link) { console.log("Pexels video:", hdFile.link.substring(0, 80)); return hdFile.link; }
    return null;
  } catch (err) { console.error("Pexels fetch error:", err); return null; }
}

function buildCreatomateSource(weather: WeatherResponse, videoUrl?: string | null): object {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const theme = getWeatherTheme(weather.condition);
  const takeaway = getPracticalTakeaway(weather);
  const temps = [weather.morningTemp, weather.afternoonTemp, weather.eveningTemp].filter((t): t is number => t != null);
  const hi = temps.length ? Math.max(...temps) : weather.temperature;
  const lo = temps.length ? Math.min(...temps) : weather.temperature;
  const windSpeed = weather.windInfo.split(" ")[0] + " mph";
  let t = 0;
  const nt = () => ++t;

  return {
    width: 1080, height: 1920, duration: 10, frame_rate: 30, fill_color: theme.bg1,
    elements: [
      // === BACKGROUND ===
      ...(videoUrl ? [
        { type: "video", track: nt(), time: 0, duration: 10, source: videoUrl, width: "100%", height: "100%", x: "50%", y: "50%", fit: "cover" },
      ] : [
        { type: "shape", track: nt(), time: 0, duration: 10, shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%", fill_color: `linear-gradient(170deg, ${theme.bg1} 0%, ${theme.bg2} 50%, ${theme.bg1} 100%)` },
      ]),
      // Heavy overlay for readability
      { type: "shape", track: nt(), time: 0, duration: 10, shape_type: "rectangle", width: "100%", height: "100%", x: "50%", y: "50%",
        fill_color: `linear-gradient(180deg, ${theme.bg1}e6 0%, ${theme.bg1}b3 20%, ${theme.bg1}99 45%, ${theme.bg1}b3 65%, ${theme.bg1}e6 85%, ${theme.bg1}f2 100%)` },
      // Subtle glow
      { type: "shape", track: nt(), time: 0, duration: 10, shape_type: "ellipse", width: 1400, height: 1400, x: "75%", y: "30%", fill_color: theme.glow1,
        animations: [{ type: "scale", start_scale: "95%", end_scale: "108%", duration: 10, easing: "linear" }] },

      // === BRAND (y ~7%) ===
      { type: "text", track: nt(), time: 0, duration: 10, text: "SKYBRIEF", font_family: "Inter", font_weight: "700", font_size: "42", fill_color: "#ffffff", letter_spacing: "18%",
        x: "50%", y: "7%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.5 } },
      { type: "shape", track: nt(), time: 0.2, duration: 9.8, shape_type: "rectangle", width: 60, height: 3, x: "50%", y: "9.5%", fill_color: theme.accent, border_radius: "2",
        enter: { type: "scale", start_scale: "0%", duration: 0.6 } },

      // === CITY + DATE ===
      { type: "text", track: nt(), time: 0.3, duration: 9.7, text: weather.city.toUpperCase(), font_family: "Inter", font_weight: "800", font_size: "76", fill_color: "#ffffff",
        x: "50%", y: "16%", x_alignment: "50%", y_alignment: "50%", enter: { type: "slide", direction: "up", duration: 0.5 } },
      { type: "text", track: nt(), time: 0.5, duration: 9.5, text: `${weather.stateOrRegion}  ·  ${dateStr}`, font_family: "Inter", font_weight: "500", font_size: "30", fill_color: "rgba(255,255,255,0.65)",
        x: "50%", y: "21%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.5 } },

      // === HERO TEMPERATURE ===
      { type: "text", track: nt(), time: 0.6, duration: 9.4, text: theme.emoji, font_size: "80",
        x: "50%", y: "30%", x_alignment: "50%", y_alignment: "50%", enter: { type: "scale", start_scale: "50%", duration: 0.6 } },
      { type: "text", track: nt(), time: 0.7, duration: 9.3, text: `${weather.temperature}°`, font_family: "Inter", font_weight: "900", font_size: "180", fill_color: "#ffffff",
        x: "50%", y: "42%", x_alignment: "50%", y_alignment: "50%", enter: { type: "scale", start_scale: "60%", duration: 0.6 } },
      { type: "text", track: nt(), time: 0.9, duration: 9.1, text: weather.description.charAt(0).toUpperCase() + weather.description.slice(1),
        font_family: "Inter", font_weight: "600", font_size: "38", fill_color: theme.accent,
        x: "50%", y: "51%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.5 } },

      // === DETAIL CARD ===
      { type: "shape", track: nt(), time: 1.3, duration: 8.7, shape_type: "rectangle", width: 920, height: 260, x: "50%", y: "65%",
        fill_color: theme.panelBg, border_radius: "28", border_width: 1, border_color: "rgba(255,255,255,0.10)",
        enter: { type: "scale", start_scale: "92%", duration: 0.5 } },
      // Labels
      { type: "text", track: nt(), time: 1.5, duration: 8.5, text: "HIGH", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
        x: "17%", y: "60.5%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.3 } },
      { type: "text", track: nt(), time: 1.5, duration: 8.5, text: "LOW", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
        x: "39%", y: "60.5%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.3 } },
      { type: "text", track: nt(), time: 1.5, duration: 8.5, text: "RAIN", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
        x: "61%", y: "60.5%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.3 } },
      { type: "text", track: nt(), time: 1.5, duration: 8.5, text: "WIND", font_family: "Inter", font_weight: "600", font_size: "22", fill_color: "rgba(255,255,255,0.45)", letter_spacing: "6%",
        x: "83%", y: "60.5%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.3 } },
      // Values
      { type: "text", track: nt(), time: 1.7, duration: 8.3, text: `${hi}°`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
        x: "17%", y: "65.5%", x_alignment: "50%", y_alignment: "50%", enter: { type: "slide", direction: "up", duration: 0.4 } },
      { type: "text", track: nt(), time: 1.8, duration: 8.2, text: `${lo}°`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
        x: "39%", y: "65.5%", x_alignment: "50%", y_alignment: "50%", enter: { type: "slide", direction: "up", duration: 0.4 } },
      { type: "text", track: nt(), time: 1.9, duration: 8.1, text: `${weather.rainChance}%`, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
        x: "61%", y: "65.5%", x_alignment: "50%", y_alignment: "50%", enter: { type: "slide", direction: "up", duration: 0.4 } },
      { type: "text", track: nt(), time: 2.0, duration: 8.0, text: windSpeed, font_family: "Inter", font_weight: "700", font_size: "44", fill_color: "#ffffff",
        x: "83%", y: "65.5%", x_alignment: "50%", y_alignment: "50%", enter: { type: "slide", direction: "up", duration: 0.4 } },
      // Dividers
      { type: "shape", track: nt(), time: 1.6, duration: 8.4, shape_type: "rectangle", width: 1, height: 80, x: "28%", y: "63.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },
      { type: "shape", track: nt(), time: 1.6, duration: 8.4, shape_type: "rectangle", width: 1, height: 80, x: "50%", y: "63.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },
      { type: "shape", track: nt(), time: 1.6, duration: 8.4, shape_type: "rectangle", width: 1, height: 80, x: "72%", y: "63.5%", fill_color: "rgba(255,255,255,0.08)", enter: { type: "fade", duration: 0.3 } },

      // === TAKEAWAY ===
      { type: "text", track: nt(), time: 2.5, duration: 7.5, text: takeaway, font_family: "Inter", font_weight: "600", font_size: "34", fill_color: "#ffffff",
        x: "50%", y: "76%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.6 } },

      // === CTA ===
      { type: "shape", track: nt(), time: 3.5, duration: 6.5, shape_type: "rectangle", width: 80, height: 2, x: "50%", y: "84%", fill_color: theme.accent, border_radius: "1",
        enter: { type: "scale", start_scale: "0%", duration: 0.5 } },
      { type: "text", track: nt(), time: 3.8, duration: 6.2, text: "Follow @SkyBrief for daily updates", font_family: "Inter", font_weight: "500", font_size: "28", fill_color: "rgba(255,255,255,0.55)",
        x: "50%", y: "88%", x_alignment: "50%", y_alignment: "50%", enter: { type: "fade", duration: 0.6 } },
    ],
  };
}

async function generateWeatherVideo(weather: WeatherResponse): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const apiKey = Deno.env.get("CREATOMATE_API_KEY");
  if (!apiKey) {
    console.error("CREATOMATE_API_KEY not configured");
    return null;
  }

  console.log("Starting Creatomate render for", weather.city);
  const theme = getWeatherTheme(weather.condition);
  const videoUrl = await fetchPexelsVideoUrl(theme.videoKeyword);
  const source = buildCreatomateSource(weather, videoUrl);

  // Start render
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

  // Poll for completion (max ~3 minutes)
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

async function postToInstagram(_imageUrl: string, _caption: string, _apiKey: string): Promise<boolean> {
  return false;
}
async function postToTikTok(_imageUrl: string, _caption: string, _apiKey: string): Promise<boolean> {
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body for mode
    let mode = "post"; // "post" or "preview"
    try {
      const body = await req.clone().json();
      if (body?.mode === "preview") mode = "preview";
    } catch { /* no body is fine */ }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await anonClient.auth.getUser();
      userId = user?.id ?? null;
    }

    const settingsQuery = supabase.from("weather_settings").select("*").limit(1);
    if (userId) settingsQuery.eq("user_id", userId);
    const { data: settings, error: settingsError } = await settingsQuery.single();

    if (settingsError || !settings) {
      throw new Error("No weather settings found. Please configure your settings first.");
    }

    const openWeatherApiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!openWeatherApiKey) {
      throw new Error("OpenWeatherMap API key not configured as a backend secret.");
    }

    const weather = await fetchWeatherData(settings.city, openWeatherApiKey);

    // Generate caption via SkyBrief prompt
    let caption: string | null = null;
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

    // Generate video
    const video = await generateWeatherVideo(weather);

    // === PREVIEW MODE ===
    if (mode === "preview") {
      if (!video || !userId) {
        throw new Error("Failed to generate video for preview");
      }
      // Store in Supabase Storage
      const fileName = `${userId}/preview-${Date.now()}.mp4`;
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

      const { data: urlData } = supabase.storage
        .from("weather-videos")
        .getPublicUrl(fileName);

      console.log("Preview video stored:", urlData.publicUrl);

      return new Response(
        JSON.stringify({
          success: true,
          mode: "preview",
          video_url: urlData.publicUrl,
          storage_path: fileName,
          weather,
          caption,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // === POST MODE (original behavior) ===
    let platform = "none";
    let status = "success";
    let errorMessage: string | null = null;
    let youtubeVideoId: string | null = null;

    // --- YouTube Shorts Upload ---
    if (userId && settings.youtube_access_token) {
      try {
        console.log("YouTube connected, attempting upload...");
        const ytToken = await getValidYouTubeToken(supabase, userId);

        if (ytToken) {
          if (video) {
            const title = `${weather.city} Weather Today — ${weather.temperature}°F ${weather.condition}`;
            const desc = caption || `Weather update for ${weather.city}: ${weather.temperature}°F, ${weather.description}`;
            const result = await uploadToYouTubeShorts(ytToken, video.data, title, desc, video.mimeType);

            if (result) {
              youtubeVideoId = result.videoId;
              platform = "youtube";
              status = "success";
              errorMessage = null;
              console.log("YouTube Short published! Video ID:", youtubeVideoId);
            } else {
              platform = "youtube";
              status = "failed";
              errorMessage = "YouTube upload failed — check edge function logs for details";
            }
          } else {
            platform = "youtube";
            status = "pending";
            errorMessage = "Video generation failed";
            console.log("Video generation failed.");
          }
        } else {
          platform = "youtube";
          status = "failed";
          errorMessage = "Failed to obtain valid YouTube access token";
        }
      } catch (e) {
        console.error("YouTube upload error:", e);
        platform = "youtube";
        status = "failed";
        errorMessage = e instanceof Error ? e.message : "YouTube upload failed";
      }
    }

    // --- Instagram ---
    if (settings.instagram_api_key) {
      const postCaption = caption || `Weather in ${weather.city}: ${weather.temperature}°F`;
      try {
        await postToInstagram("", postCaption, settings.instagram_api_key);
      } catch (e) {
        console.error("Instagram post failed:", e);
      }
    }

    // --- TikTok ---
    if (settings.tiktok_access_token) {
      const postCaption = caption || `Weather in ${weather.city}: ${weather.temperature}°F`;
      try {
        await postToTikTok("", postCaption, settings.tiktok_access_token);
      } catch (e) {
        console.error("TikTok post failed:", e);
      }
    }

    if (platform === "none") {
      status = "pending";
      errorMessage = "No social platforms connected — connect YouTube, TikTok, or Instagram in Settings";
    }

    const { error: historyError } = await supabase.from("post_history").insert({
      status, platform, city: weather.city, temperature: weather.temperature,
      condition: weather.condition, image_url: null, error_message: errorMessage,
      caption, user_id: userId,
    });
    if (historyError) console.error("Failed to log post history:", historyError);

    return new Response(
      JSON.stringify({
        success: status === "success",
        weather, status, caption, platform,
        youtube_video_id: youtubeVideoId,
        message: errorMessage || `Weather post ${status} for ${weather.city}`,
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

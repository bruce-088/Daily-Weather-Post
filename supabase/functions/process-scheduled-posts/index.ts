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

  const expiresAt = settings.youtube_token_expires_at ? new Date(settings.youtube_token_expires_at) : null;
  if (expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
    return settings.youtube_access_token;
  }

  if (!settings.youtube_refresh_token) return null;

  const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID");
  const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET) return null;

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
  await supabase.from("weather_settings").update({
    youtube_access_token: refreshData.access_token,
    youtube_token_expires_at: newExpiresAt,
  }).eq("user_id", userId);

  return refreshData.access_token;
}

async function uploadToYouTubeShorts(
  accessToken: string,
  videoData: Uint8Array,
  title: string,
  description: string,
  mimeType = "video/mp4",
): Promise<{ videoId: string } | null> {
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
          categoryId: "22",
        },
        status: {
          privacyStatus: "public",
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  if (!initRes.ok) {
    console.error("YouTube upload init failed:", initRes.status, await initRes.text());
    return null;
  }

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) return null;

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "Content-Length": String(videoData.byteLength) },
    body: videoData,
  });

  if (!uploadRes.ok) {
    console.error("YouTube upload failed:", uploadRes.status, await uploadRes.text());
    return null;
  }

  const result = await uploadRes.json();
  console.log("YouTube upload success! Video ID:", result.id);
  return { videoId: result.id };
}

// --- Creatomate Video Generation ---

function buildCreatomateSource(weather: WeatherResponse): object {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const morningLine = weather.morningTemp != null
    ? `Morning: ${weather.morningTemp}°F — ${weather.morningCondition}` : "Morning: —";
  const afternoonLine = weather.afternoonTemp != null
    ? `Afternoon: ${weather.afternoonTemp}°F — ${weather.afternoonCondition}` : "Afternoon: —";
  const eveningLine = weather.eveningTemp != null
    ? `Evening: ${weather.eveningTemp}°F — ${weather.eveningCondition}` : "Evening: —";

  return {
    width: 1080,
    height: 1920,
    duration: 7,
    elements: [
      {
        type: "shape",
        track: 1,
        time: 0,
        duration: 7,
        shape_type: "rectangle",
        width: 1080,
        height: 1920,
        x: "50%",
        y: "50%",
        fill_color: "linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
      },
      {
        type: "text",
        track: 2,
        time: 0,
        duration: 7,
        text: "SkyBrief",
        font_family: "Inter",
        font_weight: "700",
        font_size: "42px",
        fill_color: "#38bdf8",
        x: "50%",
        y: "8%",
        text_align: "center",
        enter: { type: "fade", duration: 0.5 },
      },
      {
        type: "text",
        track: 3,
        time: 0.3,
        duration: 6.7,
        text: `${weather.city}, ${weather.stateOrRegion}`,
        font_family: "Inter",
        font_weight: "700",
        font_size: "64px",
        fill_color: "#ffffff",
        x: "50%",
        y: "18%",
        text_align: "center",
        enter: { type: "fade", duration: 0.5 },
      },
      {
        type: "text",
        track: 4,
        time: 0.5,
        duration: 6.5,
        text: dateStr,
        font_family: "Inter",
        font_weight: "400",
        font_size: "36px",
        fill_color: "#94a3b8",
        x: "50%",
        y: "24%",
        text_align: "center",
        enter: { type: "fade", duration: 0.5 },
      },
      {
        type: "text",
        track: 5,
        time: 0.8,
        duration: 6.2,
        text: `${weather.temperature}°F`,
        font_family: "Inter",
        font_weight: "800",
        font_size: "140px",
        fill_color: "#ffffff",
        x: "50%",
        y: "38%",
        text_align: "center",
        enter: { type: "fade", duration: 0.6 },
      },
      {
        type: "text",
        track: 6,
        time: 1.0,
        duration: 6.0,
        text: weather.condition,
        font_family: "Inter",
        font_weight: "500",
        font_size: "48px",
        fill_color: "#e2e8f0",
        x: "50%",
        y: "47%",
        text_align: "center",
        enter: { type: "fade", duration: 0.5 },
      },
      {
        type: "text",
        track: 7,
        time: 1.5,
        duration: 5.5,
        text: `${morningLine}\n${afternoonLine}\n${eveningLine}`,
        font_family: "Inter",
        font_weight: "500",
        font_size: "38px",
        line_height: "180%",
        fill_color: "#cbd5e1",
        x: "50%",
        y: "60%",
        text_align: "center",
        enter: { type: "fade", duration: 0.6 },
      },
      {
        type: "text",
        track: 8,
        time: 2.0,
        duration: 5.0,
        text: `🌧 Rain: ${weather.rainChance}%   💨 Wind: ${weather.windInfo}`,
        font_family: "Inter",
        font_weight: "400",
        font_size: "32px",
        fill_color: "#94a3b8",
        x: "50%",
        y: "75%",
        text_align: "center",
        enter: { type: "fade", duration: 0.5 },
      },
      {
        type: "text",
        track: 9,
        time: 2.5,
        duration: 4.5,
        text: `🌅 ${weather.sunrise}  •  🌇 ${weather.sunset}`,
        font_family: "Inter",
        font_weight: "400",
        font_size: "32px",
        fill_color: "#94a3b8",
        x: "50%",
        y: "82%",
        text_align: "center",
        enter: { type: "fade", duration: 0.5 },
      },
      {
        type: "text",
        track: 10,
        time: 3.0,
        duration: 4.0,
        text: "Follow @SkyBrief for daily updates",
        font_family: "Inter",
        font_weight: "500",
        font_size: "30px",
        fill_color: "#38bdf8",
        x: "50%",
        y: "92%",
        text_align: "center",
        enter: { type: "fade", duration: 0.5 },
      },
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
  const source = buildCreatomateSource(weather);

  const requestBody = JSON.stringify({ source });
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

        // Use pre-written caption if available, otherwise auto-generate
        let caption: string | null = post.caption || null;
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

        // --- YouTube Shorts Upload ---
        if (post.platform === "youtube" || post.platform === "both") {
          const { data: userSettings } = await supabase
            .from("weather_settings")
            .select("youtube_access_token")
            .eq("user_id", post.user_id)
            .single();

          if (userSettings?.youtube_access_token) {
            const ytToken = await getValidYouTubeToken(supabase, post.user_id);
            if (ytToken) {
              const video = await generateWeatherVideo(weather);
              if (video) {
                const title = `${weather.city} Weather Today — ${weather.temperature}°F ${weather.condition}`;
                const desc = caption || `Weather update for ${weather.city}: ${weather.temperature}°F, ${weather.description}`;
                const result = await uploadToYouTubeShorts(ytToken, video.data, title, desc, video.mimeType);
                if (result) {
                  console.log(`Scheduled post ${post.id}: YouTube Short published, video ID: ${result.videoId}`);
                } else {
                  errorMessage = "YouTube upload failed after video generation";
                }
              } else {
                errorMessage = "Video generation failed — check Creatomate configuration";
              }
            } else {
              errorMessage = "Failed to refresh YouTube token";
            }
          }
        }

        if (!errorMessage) {
          errorMessage = "Weather data fetched and caption generated successfully";
        }

        await supabase.from("post_history").insert({
          status: postStatus, platform: post.platform, city: weather.city,
          temperature: weather.temperature, condition: weather.condition,
          image_url: null, error_message: errorMessage, caption,
          user_id: post.user_id,
        });

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

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

        let status = "posted";
        let errorMessage: string | null = null;
        const imageUrl: string | null = null;
        if (!imageUrl) {
          status = "posted";
          errorMessage = "Image generation not yet implemented - weather data fetched successfully";
        }

        await supabase.from("post_history").insert({
          status, platform: post.platform, city: weather.city,
          temperature: weather.temperature, condition: weather.condition,
          image_url: imageUrl, error_message: errorMessage, caption,
          user_id: post.user_id,
        });

        await supabase.from("scheduled_posts").update({ status, error_message: errorMessage }).eq("id", post.id);

        await supabase.from("notifications").insert({
          user_id: post.user_id,
          title: status === "posted" ? "Post Published" : "Post Issue",
          message: `Your weather post for ${weather.city} was published on ${post.platform}.`,
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

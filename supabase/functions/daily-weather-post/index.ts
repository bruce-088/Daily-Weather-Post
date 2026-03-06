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
}

async function fetchWeatherData(city: string, apiKey: string): Promise<WeatherResponse> {
  const geoRes = await fetch(
    `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`
  );
  const geoData = await geoRes.json();
  if (!geoData.length) throw new Error(`Location not found: ${city}`);

  const { lat, lon, name } = geoData[0];
  const weatherRes = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`
  );
  const weather = await weatherRes.json();

  return {
    city: name,
    temperature: Math.round(weather.main.temp),
    condition: weather.weather[0].main,
    description: weather.weather[0].description,
  };
}

// Placeholder: generate weather image
async function generateWeatherImage(weather: WeatherResponse): Promise<string | null> {
  console.log(`[generateWeatherImage] Would generate image for ${weather.city}: ${weather.temperature}°C, ${weather.condition}`);
  // TODO: Implement image generation (e.g., using html-to-image on client, or a server-side renderer)
  return null;
}

// Placeholder: post to Instagram
async function postToInstagram(imageUrl: string, caption: string, apiKey: string): Promise<boolean> {
  console.log(`[postToInstagram] Would post image to Instagram: ${imageUrl}`);
  console.log(`[postToInstagram] Caption: ${caption}`);
  // TODO: Implement Instagram Graph API posting
  // 1. Create media container: POST /me/media { image_url, caption, access_token }
  // 2. Publish: POST /me/media_publish { creation_id, access_token }
  return false;
}

// Placeholder: post to TikTok
async function postToTikTok(imageUrl: string, caption: string, apiKey: string): Promise<boolean> {
  console.log(`[postToTikTok] Would post to TikTok: ${imageUrl}`);
  // TODO: Implement TikTok Content Posting API
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header if present
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await anonClient.auth.getUser();
      userId = user?.id ?? null;
    }

    // Get settings - scope by user if available
    const settingsQuery = supabase
      .from("weather_settings")
      .select("*")
      .limit(1);
    if (userId) settingsQuery.eq("user_id", userId);
    const { data: settings, error: settingsError } = await settingsQuery.single();

    if (settingsError || !settings) {
      throw new Error("No weather settings found. Please configure your settings first.");
    }

    const openWeatherApiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!openWeatherApiKey) {
      throw new Error("OpenWeatherMap API key not configured as a backend secret.");
    }

    // Fetch weather
    const weather = await fetchWeatherData(settings.city, openWeatherApiKey);
    console.log(`Weather fetched: ${weather.city} - ${weather.temperature}°F - ${weather.condition}`);

    // Generate caption via Lovable AI
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
              { role: "system", content: "You are a social media caption writer. Write a short, engaging caption for a weather post. Include relevant emojis and 3-5 hashtags. Keep it under 280 characters. Return ONLY the caption text." },
              { role: "user", content: `City: ${weather.city}, Temp: ${weather.temperature}°F, Condition: ${weather.condition}, Description: ${weather.description}` },
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

    // Generate image (placeholder)
    const imageUrl = await generateWeatherImage(weather);

    // Attempt posting
    let platform = "both";
    let status = "success";
    let errorMessage: string | null = null;

    try {
      if (settings.instagram_api_key && imageUrl) {
        const postCaption = caption || `🌤 Weather in ${weather.city}: ${weather.temperature}°F - ${weather.description} #weather #daily`;
        await postToInstagram(imageUrl, postCaption, settings.instagram_api_key);
      }
      if (settings.tiktok_api_key && imageUrl) {
        const postCaption = caption || `Weather update for ${weather.city}! ${weather.temperature}°F ${weather.condition}`;
        await postToTikTok(imageUrl, postCaption, settings.tiktok_api_key);
      }

      if (!imageUrl) {
        status = "pending";
        errorMessage = "Image generation not yet implemented - weather data fetched successfully";
      }
    } catch (postError) {
      status = "failed";
      errorMessage = postError instanceof Error ? postError.message : "Posting failed";
    }

    // Log to post_history
    const { error: historyError } = await supabase.from("post_history").insert({
      status,
      platform,
      city: weather.city,
      temperature: weather.temperature,
      condition: weather.condition,
      image_url: imageUrl,
      error_message: errorMessage,
      caption,
      user_id: userId,
    });

    if (historyError) {
      console.error("Failed to log post history:", historyError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        weather,
        status,
        caption,
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

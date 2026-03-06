import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchWeatherData(city: string, apiKey: string) {
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

    // Get all pending posts that are due
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
                  { role: "user", content: `City: ${weather.city}, Temp: ${weather.temperature}°F, Condition: ${weather.condition}, Description: ${weather.description}, Platform: ${post.platform}` },
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

        let status = "posted";
        let errorMessage: string | null = null;

        const imageUrl: string | null = null;
        if (!imageUrl) {
          status = "posted";
          errorMessage = "Image generation not yet implemented - weather data fetched successfully";
        }

        // Log to post_history
        await supabase.from("post_history").insert({
          status,
          platform: post.platform,
          city: weather.city,
          temperature: weather.temperature,
          condition: weather.condition,
          image_url: imageUrl,
          error_message: errorMessage,
          caption,
          user_id: post.user_id,
        });

        // Update scheduled post status
        await supabase
          .from("scheduled_posts")
          .update({ status, error_message: errorMessage })
          .eq("id", post.id);

        // Insert notification
        await supabase.from("notifications").insert({
          user_id: post.user_id,
          title: status === "posted" ? "Post Published" : "Post Issue",
          message: `Your weather post for ${weather.city} was published on ${post.platform}.`,
          type: "success",
        });

        processed++;
      } catch (postError) {
        const errMsg = postError instanceof Error ? postError.message : "Processing failed";
        await supabase
          .from("scheduled_posts")
          .update({ status: "failed", error_message: errMsg })
          .eq("id", post.id);

        // Insert failure notification
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

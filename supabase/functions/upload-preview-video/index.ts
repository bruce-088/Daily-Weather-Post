import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { postToPlatform } from "../_shared/platform-adapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { storage_path, title, description, caption, city_id, city: cityNameIn, state: stateIn } = await req.json();

    if (!storage_path) {
      throw new Error("storage_path is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user from auth header
    let userId: string | null = null;
    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await anonClient.auth.getUser();
      userId = user?.id ?? null;
    }

    if (!userId) {
      throw new Error("Authentication required");
    }

    // Download video from storage
    const { data: videoBlob, error: downloadError } = await supabase.storage
      .from("weather-videos")
      .download(storage_path);

    if (downloadError || !videoBlob) {
      throw new Error("Failed to download preview video from storage");
    }

    const videoData = new Uint8Array(await videoBlob.arrayBuffer());
    console.log(`Downloaded preview video: ${videoData.byteLength} bytes`);

    // Upload to YouTube via shared adapter
    const result = await postToPlatform(
      "youtube",
      supabase,
      userId,
      videoData,
      title || "Weather Update",
      description || caption || "Daily weather update",
    );

    if (!result.success) {
      throw new Error(result.error || "YouTube upload failed");
    }

    console.log("YouTube Short published from preview! Video ID:", result.id);

    // Log to post history
    const city = title?.split(" Weather")?.[0] || "Unknown";
    await supabase.from("post_history").insert({
      status: "success",
      platform: "youtube",
      city,
      caption,
      user_id: userId,
    });

    // Clean up the preview file
    await supabase.storage.from("weather-videos").remove([storage_path]);

    return new Response(
      JSON.stringify({
        success: true,
        youtube_video_id: result.id,
        message: `YouTube Short published! Video ID: ${result.id}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Upload preview error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

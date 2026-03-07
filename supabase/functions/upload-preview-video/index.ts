import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function getValidYouTubeToken(supabase: any, userId: string): Promise<string | null> {
  const { data: settings } = await supabase
    .from("weather_settings")
    .select("youtube_access_token, youtube_refresh_token, youtube_token_expires_at")
    .eq("user_id", userId)
    .single();

  if (!settings?.youtube_access_token) return null;

  const expiresAt = settings.youtube_token_expires_at ? new Date(settings.youtube_token_expires_at) : null;
  if (expiresAt && expiresAt > new Date(Date.now() + 60000)) {
    return settings.youtube_access_token;
  }

  if (!settings.youtube_refresh_token) return null;

  const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
  const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: settings.youtube_refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenRes.ok) return null;

  const tokenData = await tokenRes.json();
  const newToken = tokenData.access_token;
  const newExpiry = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString();

  await supabase.from("weather_settings").update({
    youtube_access_token: newToken,
    youtube_token_expires_at: newExpiry,
  }).eq("user_id", userId);

  return newToken;
}

async function uploadToYouTubeShorts(
  accessToken: string, videoData: Uint8Array, title: string, description: string, mimeType = "video/mp4"
): Promise<{ videoId: string } | null> {
  const metadata = {
    snippet: { title, description, categoryId: "28", tags: ["weather", "shorts"] },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };

  const initRes = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(videoData.byteLength),
        "X-Upload-Content-Type": mimeType,
      },
      body: JSON.stringify(metadata),
    }
  );

  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) return null;

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType, "Content-Length": String(videoData.byteLength) },
    body: videoData,
  });

  if (!uploadRes.ok) return null;

  const result = await uploadRes.json();
  return { videoId: result.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { storage_path, title, description, caption } = await req.json();

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

    // Get YouTube token
    const ytToken = await getValidYouTubeToken(supabase, userId);
    if (!ytToken) {
      throw new Error("No valid YouTube token found. Please reconnect YouTube in Settings.");
    }

    // Upload to YouTube
    const result = await uploadToYouTubeShorts(
      ytToken,
      videoData,
      title || "Weather Update",
      description || caption || "Daily weather update",
    );

    if (!result) {
      throw new Error("YouTube upload failed");
    }

    console.log("YouTube Short published from preview! Video ID:", result.videoId);

    // Log to post history
    // Extract city from title (format: "City Weather Today — ...")
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
        youtube_video_id: result.videoId,
        message: `YouTube Short published! Video ID: ${result.videoId}`,
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

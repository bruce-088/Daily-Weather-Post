import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";

export class YouTubeAdapter implements PlatformAdapter {
  name = "youtube";

  isConnected(settings: Record<string, unknown>): boolean {
    return !!settings.youtube_access_token;
  }

  async getValidToken(supabase: any, userId: string): Promise<string | null> {
    const { data: settings } = await supabase
      .from("weather_settings")
      .select("youtube_access_token, youtube_refresh_token, youtube_token_expires_at")
      .eq("user_id", userId)
      .single();

    if (!settings?.youtube_access_token) return null;

    const expiresAt = settings.youtube_token_expires_at
      ? new Date(settings.youtube_token_expires_at)
      : null;
    if (expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return settings.youtube_access_token;
    }

    if (!settings.youtube_refresh_token) {
      console.error("No YouTube refresh token available");
      return null;
    }

    const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
    const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");
    if (!clientId || !clientSecret) {
      console.error("YouTube client credentials not configured");
      return null;
    }

    const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: settings.youtube_refresh_token,
      }),
    });

    const refreshData = await refreshRes.json();
    if (!refreshData.access_token) {
      console.error("YouTube token refresh failed:", JSON.stringify(refreshData));
      return null;
    }

    const newExpiresAt = new Date(
      Date.now() + refreshData.expires_in * 1000,
    ).toISOString();
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

  async uploadVideo(
    accessToken: string,
    videoData: Uint8Array,
    title: string,
    description: string,
    mimeType = "video/mp4",
  ): Promise<UploadResult | null> {
    const shortTitle = title.length > 100 ? title.substring(0, 100) : title;
    console.log(
      `Uploading to YouTube Shorts: ${shortTitle} (${videoData.byteLength} bytes)`,
    );

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
            title: shortTitle,
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
      const errText = await initRes.text();
      console.error("YouTube upload init failed:", initRes.status, errText);
      return null;
    }

    const uploadUrl = initRes.headers.get("Location");
    if (!uploadUrl) {
      console.error("No upload URL returned from YouTube");
      return null;
    }

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
    return { id: result.id };
  }
}

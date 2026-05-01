import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";

export class YouTubeAdapter implements PlatformAdapter {
  name = "youtube";

  isConnected(settings: Record<string, unknown>): boolean {
    const expiresAt = settings.youtube_token_expires_at
      ? new Date(String(settings.youtube_token_expires_at)).getTime()
      : 0;
    const hasUsableAccessToken = !!settings.youtube_access_token && expiresAt > Date.now() + 5 * 60 * 1000;
    return hasUsableAccessToken || !!settings.youtube_refresh_token;
  }

  async getValidToken(supabase: any, userId: string): Promise<string | null> {
    const { data: settings } = await supabase
      .from("weather_settings")
      .select("youtube_access_token, youtube_refresh_token, youtube_token_expires_at")
      .eq("user_id", userId)
      .single();

    if (!settings?.youtube_access_token && !settings?.youtube_refresh_token) return null;

    const expiresAt = settings.youtube_token_expires_at
      ? new Date(settings.youtube_token_expires_at)
      : null;
    if (settings.youtube_access_token && expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
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
      // If Google says the refresh_token is permanently invalid (revoked/expired),
      // clear it so the UI flips from "Connected" → "Reconnect Required" instead
      // of silently failing every auto-post.
      const errorCode = (refreshData?.error || "").toString();
      if (errorCode === "invalid_grant" || errorCode === "invalid_token") {
        await supabase
          .from("weather_settings")
          .update({ youtube_refresh_token: null })
          .eq("user_id", userId);
        console.warn("YouTube refresh_token cleared due to invalid_grant — user must reconnect");
      }
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

    const { data: socialRows } = await supabase
      .from("social_accounts")
      .update({
        access_token: refreshData.access_token,
        token_expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .select("id");
    if (!socialRows?.length) {
      await supabase.from("social_accounts").insert({
        user_id: userId,
        platform: "youtube",
        access_token: refreshData.access_token,
        refresh_token: settings.youtube_refresh_token,
        token_expires_at: newExpiresAt,
      });
    }

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

    // Append permanent YouTube subscribe + notifications CTA to every Shorts
    // description. Centralized here so it applies uniformly to manual posts,
    // scheduled posts, and the auto-post scheduler — they all funnel through
    // uploadVideo(). YouTube-only by design (other platforms call their own
    // adapters and never hit this code path).
    const YT_CHANNEL_URL = "https://www.youtube.com/@SkyBriefGNV?sub_confirmation=1";
    const YT_CTA = `👉 Subscribe and turn on notifications for daily Gainesville weather alerts: ${YT_CHANNEL_URL} 🔔`;
    // Strip any previously-appended CTA variants so we always end with the
    // current notifications-focused line (and never stack duplicates).
    let baseDescription = (description || "").trimEnd();
    baseDescription = baseDescription
      .replace(/\n*👉[^\n]*@SkyBriefGNV\?sub_confirmation=1[^\n]*$/u, "")
      .trimEnd();
    const finalDescription = `${baseDescription}\n\n${YT_CTA}`;
    // YouTube caps description at 5000 chars.
    const safeDescription = finalDescription.length > 5000
      ? finalDescription.substring(0, 5000)
      : finalDescription;

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
            description: safeDescription,
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
      try {
        const errJson = JSON.parse(errText);
        const reason = errJson?.error?.errors?.[0]?.reason;
        if (reason === "uploadLimitExceeded") {
          throw new Error("YouTube daily upload limit reached. Please wait 24 hours or request a quota increase in Google Cloud Console.");
        }
        throw new Error(errJson?.error?.message || "YouTube upload initialization failed");
      } catch (e) {
        if (e instanceof Error && e.message.includes("YouTube")) throw e;
        throw new Error(`YouTube upload init failed (${initRes.status})`);
      }
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
      try {
        const errJson = JSON.parse(errText);
        const reason = errJson?.error?.errors?.[0]?.reason;
        const message = errJson?.error?.message || "Video processing failed";
        if (reason === "processingFailure") {
          throw new Error(`YouTube rejected the video: processing failure. The video format or codec may be unsupported.`);
        }
        if (reason === "videoTooLong") {
          throw new Error("YouTube rejected the video: video exceeds maximum duration for Shorts (60s).");
        }
        if (reason === "invalidVideoMetadata") {
          throw new Error("YouTube rejected the video: invalid metadata. Check title and description length.");
        }
        throw new Error(`YouTube upload failed: ${message} (${reason || uploadRes.status})`);
      } catch (e) {
        if (e instanceof Error && e.message.includes("YouTube")) throw e;
        throw new Error(`YouTube upload failed with status ${uploadRes.status}`);
      }
    }

    const result = await uploadRes.json();
    console.log("YouTube upload success! Video ID:", result.id);
    return { id: result.id };
  }
}

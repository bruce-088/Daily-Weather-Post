import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";

export class TikTokAdapter implements PlatformAdapter {
  name = "tiktok";

  isConnected(settings: Record<string, unknown>): boolean {
    return !!settings.tiktok_access_token;
  }

  async getValidToken(supabase: any, userId: string): Promise<string | null> {
    const { data: settings } = await supabase
      .from("weather_settings")
      .select("tiktok_access_token, tiktok_refresh_token, tiktok_token_expires_at")
      .eq("user_id", userId)
      .single();

    if (!settings?.tiktok_access_token) return null;

    // TODO: Add token refresh logic using TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET
    return settings.tiktok_access_token;
  }

  async uploadVideo(
    _token: string,
    _videoData: Uint8Array,
    _title: string,
    _description: string,
    _mimeType?: string,
  ): Promise<UploadResult | null> {
    // TODO: Implement TikTok video Content Posting API
    console.log("TikTok video upload not yet implemented");
    return null;
  }

  /**
   * Post a photo to TikTok using the Content Posting API (PULL_FROM_URL).
   * The imageUrl must be publicly accessible (e.g. a signed URL).
   * Returns the publish_id on success, null on failure.
   */
  async uploadImage(
    token: string,
    imageUrl: string,
    title: string,
    description: string,
  ): Promise<string | null> {
    // Step 1: Query creator info to get privacy_level_options
    const creatorInfoRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );

    const creatorInfo = await creatorInfoRes.json();
    console.log("TikTok creator info:", JSON.stringify(creatorInfo));

    if (creatorInfo?.error?.code) {
      console.error("TikTok creator info error:", creatorInfo.error);
      return null;
    }

    // Use the first available privacy level, prefer PUBLIC_TO_EVERYONE
    const privacyOptions: string[] =
      creatorInfo?.data?.privacy_level_options || ["PUBLIC_TO_EVERYONE"];
    const privacyLevel = privacyOptions.includes("PUBLIC_TO_EVERYONE")
      ? "PUBLIC_TO_EVERYONE"
      : privacyOptions[0];

    // Step 2: Init photo post
    // Title max 90 chars for TikTok photo posts
    const safeTitle = title.length > 90 ? title.slice(0, 87) + "..." : title;

    const initBody = {
      post_info: {
        title: safeTitle,
        description: description.slice(0, 4000),
        privacy_level: privacyLevel,
        disable_comment: false,
        auto_add_music: true,
      },
      source_info: {
        source: "PULL_FROM_URL",
        photo_cover_index: 0,
        photo_images: [imageUrl],
      },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    };

    console.log("TikTok photo post init body:", JSON.stringify(initBody));

    const initRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/content/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(initBody),
      },
    );

    const initData = await initRes.json();
    console.log("TikTok photo post response:", JSON.stringify(initData));

    if (initData?.error?.code && initData.error.code !== "ok") {
      console.error("TikTok photo post error:", initData.error);
      return null;
    }

    const publishId = initData?.data?.publish_id;
    if (publishId) {
      console.log("TikTok photo post initiated, publish_id:", publishId);
      return publishId;
    }

    return null;
  }
}

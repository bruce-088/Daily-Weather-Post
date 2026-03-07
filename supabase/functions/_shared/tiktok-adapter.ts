import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";

/**
 * TikTok Platform Adapter (stub)
 *
 * To implement:
 * 1. Wire up TikTok Content Posting API in uploadVideo()
 * 2. Add token refresh logic in getValidToken()
 * 3. Register any new secrets needed
 */
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
    // TODO: Implement TikTok Content Posting API
    console.log("TikTok upload not yet implemented");
    return null;
  }
}

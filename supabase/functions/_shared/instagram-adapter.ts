import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";

/**
 * Instagram Platform Adapter (stub)
 *
 * To implement:
 * 1. Wire up Instagram Graph API / Reels publishing in uploadVideo()
 * 2. Add token management in getValidToken()
 * 3. Register any new secrets needed
 */
export class InstagramAdapter implements PlatformAdapter {
  name = "instagram";

  isConnected(settings: Record<string, unknown>): boolean {
    return !!settings.instagram_api_key;
  }

  async getValidToken(_supabase: any, _userId: string): Promise<string | null> {
    // TODO: Implement Instagram token management
    console.log("Instagram token management not yet implemented");
    return null;
  }

  async uploadVideo(
    _token: string,
    _videoData: Uint8Array,
    _title: string,
    _description: string,
    _mimeType?: string,
  ): Promise<UploadResult | null> {
    // TODO: Implement Instagram Reels publishing
    console.log("Instagram upload not yet implemented");
    return null;
  }
}

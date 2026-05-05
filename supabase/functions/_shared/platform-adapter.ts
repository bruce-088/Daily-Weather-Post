// Platform Adapter Interface & Dispatcher
// Add new platforms by creating an adapter file and registering it here.

export interface UploadResult {
  id: string;
}

export interface PostResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface PlatformAdapter {
  /** Platform name matching post_history.platform values */
  name: string;

  /** Check if this platform is connected based on user settings */
  isConnected(settings: Record<string, unknown>): boolean;

  /** Get a valid access token (refreshing if needed) */
  getValidToken(supabase: any, userId: string, cityId?: string | null): Promise<string | null>;

  /** Upload video content to the platform */
  uploadVideo(
    token: string,
    videoData: Uint8Array,
    title: string,
    description: string,
    mimeType?: string,
  ): Promise<UploadResult | null>;
}

// --- Adapter Registry ---
import { YouTubeAdapter } from "./youtube-adapter.ts";
import { TikTokAdapter } from "./tiktok-adapter.ts";
import { InstagramAdapter } from "./instagram-adapter.ts";
import { TwitterAdapter } from "./twitter-adapter.ts";
import { LinkedInAdapter } from "./linkedin-adapter.ts";

const adapters: PlatformAdapter[] = [
  new YouTubeAdapter(),
  new TikTokAdapter(),
  new InstagramAdapter(),
  new TwitterAdapter(),
  new LinkedInAdapter(),
];

/** Get adapter by platform name */
export function getAdapter(platform: string): PlatformAdapter | null {
  return adapters.find((a) => a.name === platform) || null;
}

/** Get all adapters that are connected for the given settings */
export function getConnectedAdapters(settings: Record<string, unknown>): PlatformAdapter[] {
  return adapters.filter((a) => a.isConnected(settings));
}

/** Post to a specific platform — handles token + upload in one call */
export async function postToPlatform(
  platform: string,
  supabase: any,
  userId: string,
  videoData: Uint8Array,
  title: string,
  description: string,
  mimeType = "video/mp4",
): Promise<PostResult> {
  const adapter = getAdapter(platform);
  if (!adapter) {
    return { success: false, error: `Unknown platform: ${platform}` };
  }

  try {
    const token = await adapter.getValidToken(supabase, userId);
    if (!token) {
      return { success: false, error: `Failed to obtain valid ${adapter.name} access token` };
    }

    const result = await adapter.uploadVideo(token, videoData, title, description, mimeType);
    if (!result) {
      return { success: false, error: `${adapter.name} upload failed` };
    }

    console.log(`${adapter.name} upload success! ID: ${result.id}`);
    return { success: true, id: result.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : `${adapter.name} upload failed`;
    console.error(`${adapter.name} upload error:`, msg);
    return { success: false, error: msg };
  }
}

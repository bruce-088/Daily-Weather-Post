// Platform Adapter Interface & Dispatcher
// Add new platforms by creating an adapter file and registering it here.

export interface UploadResult {
  id: string;
  /** city_id of the social_accounts row actually used for this upload, if resolvable */
  resolved_city_id?: string | null;
  /** account_name / handle of the channel actually used for this upload */
  account_name?: string | null;
}

export interface PostResult {
  success: boolean;
  id?: string;
  error?: string;
  resolved_city_id?: string | null;
  account_name?: string | null;
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
    cityId?: string | null,
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
  cityId?: string | null,
  slot?: "morning" | "afternoon" | "evening" | null,
  cityName?: string | null,
): Promise<PostResult> {
  const adapter = getAdapter(platform);
  if (!adapter) {
    return { success: false, error: `Unknown platform: ${platform}` };
  }

  try {
    const token = await adapter.getValidToken(supabase, userId, cityId);
    if (!token) {
      return { success: false, error: `Failed to obtain valid ${adapter.name} access token` };
    }

    // Strip ONLY known internal analytics/tracking tags like [auto:afternoon],
    // [exp:B], [ab:variant_a]. Critically, do NOT strip the broadcast-slot
    // prefix [8 AM] / [1 PM] / [6 PM] — that must reach the platform.
    const INTERNAL_TAG = /\[(auto|manual|exp|ab|variant|debug|test|pipeline|engine|voice|render|src):[^\]]*\]/gi;
    const stripInternalTags = (s: string) =>
      (s || "").replace(INTERNAL_TAG, "").replace(/[ \t]{2,}/g, " ").replace(/\s+\n/g, "\n").trim();
    console.log(`[title_debug] postToPlatform received title:`, title);
    let cleanTitle = stripInternalTags(title);
    const cleanDescription = stripInternalTags(description);
    console.log(`[title_debug] after stripInternalTags:`, cleanTitle);

    // Final guard: re-assert the broadcast-slot prefix immediately before upload.
    cleanTitle = ensureSlotTitlePrefix(cleanTitle, slot ?? null, cityName ?? null);
    assertSlotTitlePrefix(cleanTitle, `postToPlatform:${adapter.name}`);
    console.log(`[title_debug] final title sent to ${adapter.name}:`, cleanTitle);

    const result = await adapter.uploadVideo(token, videoData, cleanTitle, cleanDescription, mimeType, cityId ?? null);
    if (!result) {
      return { success: false, error: `${adapter.name} upload failed` };
    }

    // Hard routing assertion: if caller scoped the post to a city and the
    // adapter resolved a different city's channel, refuse to declare success.
    if (cityId && result.resolved_city_id && result.resolved_city_id !== cityId) {
      const msg = `[ROUTING_VIOLATION] ${adapter.name} resolved channel city_id=${result.resolved_city_id} but post was for city_id=${cityId}`;
      console.error(msg);
      return { success: false, error: msg, resolved_city_id: result.resolved_city_id, account_name: result.account_name ?? null };
    }

    console.log(`${adapter.name} upload success! ID: ${result.id} channel=${result.account_name ?? "unknown"} city=${result.resolved_city_id ?? "shared"}`);
    return { success: true, id: result.id, resolved_city_id: result.resolved_city_id ?? null, account_name: result.account_name ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : `${adapter.name} upload failed`;
    console.error(`${adapter.name} upload error:`, msg);
    return { success: false, error: msg };
  }
}

import { supabase } from "@/integrations/supabase/client";
import type { AutomationSettings, WeatherData } from "@/types/weather";
import { FeatureFlags } from "@/lib/featureFlags";

export async function loadSettings(): Promise<{ settings: AutomationSettings; tiktokConnected: boolean; youtubeConnected: boolean; youtubeExpired: boolean; twitterConnected: boolean; linkedinConnected: boolean } | null> {
  const { data, error } = await supabase
    .from("weather_settings")
    .select("*")
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    settings: {
      instagramApiKey: data.instagram_api_key || "",
      tiktokApiKey: data.tiktok_api_key || "",
      postTime: data.post_time?.slice(0, 5) || "08:00",
      location: data.city || "San Francisco",
      state: (data as any).state || "",
      autoPost: data.auto_post || false,
      morningPostTime: (data as any).morning_post_time?.slice(0, 5) || "07:00",
      afternoonPostTime: (data as any).afternoon_post_time?.slice(0, 5) || "13:00",
      eveningPostTime: (data as any).evening_post_time?.slice(0, 5) || "18:00",
      autoPostMorning: (data as any).auto_post_morning ?? true,
      autoPostAfternoon: (data as any).auto_post_afternoon ?? true,
      autoPostEvening: (data as any).auto_post_evening ?? true,
      timezone: (data as any).timezone || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" : "UTC"),
      morningPlatforms: Array.isArray((data as any).morning_platforms) ? (data as any).morning_platforms : [],
      afternoonPlatforms: Array.isArray((data as any).afternoon_platforms) ? (data as any).afternoon_platforms : [],
      eveningPlatforms: Array.isArray((data as any).evening_platforms) ? (data as any).evening_platforms : [],
      morningSkipDate: (data as any).morning_skip_date || null,
      afternoonSkipDate: (data as any).afternoon_skip_date || null,
      eveningSkipDate: (data as any).evening_skip_date || null,
      enableVoiceover: (data as any).enable_voiceover ?? false,
      voiceoverVoiceId: (data as any).voiceover_voice_id || "female",
      voiceoverSpeed: Number((data as any).voiceover_speed ?? 1.0),
      voiceoverStability: Number((data as any).voiceover_stability ?? 0.55),
      voiceoverSimilarity: Number((data as any).voiceover_similarity ?? 0.78),
      captionTone: ((data as any).caption_tone as any) || "professional",
      subscribeCtaEnabled: (data as any).subscribe_cta_enabled !== false,
    },
    tiktokConnected: !!(data as any).tiktok_connected,
    youtubeConnected: !!(data as any).youtube_connected,
    // The backend refreshes tokens transparently. Show "expired" only when the
    // row is connected but has no refresh token (worker can't auto-heal).
    youtubeExpired: !!(data as any).youtube_connected && !(data as any).youtube_has_refresh_token,
    twitterConnected: !!(data as any).twitter_connected,
    linkedinConnected: !!(data as any).linkedin_connected,
  };
}

export async function saveSettings(settings: AutomationSettings): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: existing } = await supabase
    .from("weather_settings")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const payload = {
    city: settings.location,
    state: settings.state || null,
    instagram_api_key: settings.instagramApiKey || null,
    tiktok_api_key: settings.tiktokApiKey || null,
    post_time: settings.postTime + ":00",
    auto_post: settings.autoPost,
    morning_post_time: settings.morningPostTime + ":00",
    afternoon_post_time: settings.afternoonPostTime + ":00",
    evening_post_time: settings.eveningPostTime + ":00",
    auto_post_morning: settings.autoPostMorning,
    auto_post_afternoon: settings.autoPostAfternoon,
    auto_post_evening: settings.autoPostEvening,
    timezone: settings.timezone || "UTC",
    morning_platforms: settings.morningPlatforms || [],
    afternoon_platforms: settings.afternoonPlatforms || [],
    evening_platforms: settings.eveningPlatforms || [],
    morning_skip_date: settings.morningSkipDate ?? null,
    afternoon_skip_date: settings.afternoonSkipDate ?? null,
    evening_skip_date: settings.eveningSkipDate ?? null,
    enable_voiceover: settings.enableVoiceover ?? false,
    voiceover_voice_id: settings.voiceoverVoiceId || "female",
    voiceover_speed: typeof settings.voiceoverSpeed === "number" ? settings.voiceoverSpeed : 1.0,
    voiceover_stability: typeof settings.voiceoverStability === "number" ? settings.voiceoverStability : 0.55,
    voiceover_similarity: typeof settings.voiceoverSimilarity === "number" ? settings.voiceoverSimilarity : 0.78,
    caption_tone: settings.captionTone || "professional",
    subscribe_cta_enabled: settings.subscribeCtaEnabled !== false,
    user_id: user.id,
  };

  if (existing) {
    const { error } = await supabase
      .from("weather_settings")
      .update(payload)
      .eq("id", existing.id);
    return !error;
  } else {
    const { error } = await supabase
      .from("weather_settings")
      .insert(payload);
    return !error;
  }
}

/**
 * Toggle a "skip today" flag for one automation slot.
 * Writes the user's local YYYY-MM-DD into <slot>_skip_date — the scheduler
 * compares this to today and skips that slot. Pass null to clear the flag.
 */
export async function setSkipToday(
  slot: "morning" | "afternoon" | "evening",
  date: string | null
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const column = `${slot}_skip_date`;
  const { error } = await supabase
    .from("weather_settings")
    .update({ [column]: date } as any)
    .eq("user_id", user.id);
  return !error;
}

export interface VoiceOptions {
  enabled: boolean;
  voiceId?: string;             // "female" | "male" | raw ElevenLabs id
  tone?: "conversational" | "energetic" | "news";
}

export interface CityContext {
  id?: string | null;
  name?: string | null;
  state?: string | null;
}

function applyCityContext(body: Record<string, any>, city?: CityContext | null) {
  if (!city) return;
  if (city.id) body.city_id = city.id;
  if (city.name) body.city = city.name;
  if (city.state) body.state = city.state;
}

// When USE_PIPELINE_FOR_MANUAL_POSTS=true, direct publish is forbidden — all
// manual posts MUST go through `triggerManualPipelinePost`. When the flag is
// false (default), the legacy direct invoke of `daily-weather-post` is kept
// alive for backwards compatibility / gradual rollout.
export async function triggerDailyPost(
  timePeriod?: string,
  platforms?: string[],
  voice?: VoiceOptions,
  city?: CityContext | null,
): Promise<{ success: boolean; message: string }> {
  if (FeatureFlags.USE_PIPELINE_FOR_MANUAL_POSTS) {
    const msg = "Publishing outside pipeline is not allowed — use triggerManualPipelinePost()";
    console.error("[guardrail] " + msg);
    throw new Error(msg);
  }
  const body: Record<string, any> = { mode: "post-now" };
  if (timePeriod) body.time_period = timePeriod;
  if (platforms?.length) body.platforms = platforms;
  if (voice?.enabled) body.voice = voice;
  applyCityContext(body, city);
  const { data, error } = await supabase.functions.invoke("daily-weather-post", { body });
  if (error) return { success: false, message: error.message || "Failed to post" };
  return { success: !!data?.success, message: data?.message || data?.error || "Posted" };
}

export interface PreviewResult {
  success: boolean;
  content_type?: "video" | "image";
  video_url?: string;
  image_url?: string;
  audio_url?: string;
  voice_script?: string | null;
  storage_path?: string;
  weather?: any;
  caption?: string | null;
  error?: string;
  resolved_city?: { id: string | null; name: string; state: string | null } | null;
  /** Locked preview bundle id — pass to publishPreviewBundle to guarantee
   * "what you previewed = what gets posted". */
  bundle_id?: string | null;
  /** Source of the visual: creatomate | gemini | fallback_template */
  visual_source?: string | null;
  /** True when a bundle row was successfully written for this preview */
  locked?: boolean;
  /** Render/generation elapsed time in seconds (0.5 = half second, 45 = slow creatomate). */
  render_time?: number;
  /** True if voiceover generation was attempted for this preview. */
  voice_attempted?: boolean;
  /** True if voiceover was attempted but the audio file failed to generate. */
  voice_failed?: boolean;
}

export async function generatePreview(opts?: {
  style?: string;
  variation?: boolean;
  voice?: VoiceOptions;
  city?: CityContext | null;
}): Promise<PreviewResult> {
  const body: Record<string, any> = {
    mode: "preview",
    style: opts?.style ?? "standard",
    variation: !!opts?.variation,
  };
  if (opts?.voice?.enabled) body.voice = opts.voice;
  applyCityContext(body, opts?.city);

  const { data, error } = await supabase.functions.invoke("daily-weather-post", {
    body,
  });

  if (error) {
    return { success: false, error: error.message || "Failed to generate preview" };
  }

  return data as PreviewResult;
}

export interface PublishBundleResult {
  success: boolean;
  message: string;
  bundle_id?: string;
  visual_source?: string | null;
  results?: Array<{ platform: string; success: boolean; id?: string | null; url?: string | null; error?: string }>;
}

/** GUARDRAIL: Direct bundle publish is no longer allowed from the UI.
 * All manual posts (including bundle publishes) must flow through the job
 * pipeline via `triggerManualPipelinePost`, which references the locked
 * bundle id via debug_trace.preview_bundle_id. */
export async function publishPreviewBundle(
  _bundleId: string,
  _platforms: string[],
): Promise<PublishBundleResult> {
  const msg = "Publishing outside pipeline is not allowed — use triggerManualPipelinePost()";
  console.error("[guardrail] " + msg);
  throw new Error(msg);
}

export async function uploadPreviewVideo(
  storagePath: string,
  title: string,
  description: string,
  caption?: string | null,
  city?: CityContext | null,
): Promise<{ success: boolean; message: string; youtube_video_id?: string }> {
  const body: Record<string, any> = { storage_path: storagePath, title, description, caption };
  applyCityContext(body, city);
  const { data, error } = await supabase.functions.invoke("upload-preview-video", {
    body,
  });

  if (error) {
    return { success: false, message: error.message || "Failed to upload video" };
  }

  return {
    success: data?.success ?? false,
    message: data?.message || data?.error || "Unknown response",
    youtube_video_id: data?.youtube_video_id,
  };
}

export interface PostHistoryItem {
  id: string;
  status: string;
  platform: string | null;
  city: string;
  temperature: number | null;
  condition: string | null;
  image_url: string | null;
  error_message: string | null;
  caption: string | null;
  created_at: string;
  retry_count?: number | null;
  next_retry_at?: string | null;
  last_attempt_at?: string | null;
  post_url?: string | null;
  voice_status?: string | null;
  voice_error?: string | null;
  voice_attempts?: number | null;
  debug_trace?: { steps?: Array<{ ts: string; step: string; detail?: any }>; captured_at?: string } | null;
}

export async function fetchPostHistory(limit = 10, offset = 0): Promise<PostHistoryItem[]> {
  const { data, error } = await supabase
    .from("post_history")
    .select("*")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return [];
  return (data || []) as unknown as PostHistoryItem[];
}

// --- Scheduled Posts ---

export interface ScheduledPostItem {
  id: string;
  city: string;
  scheduled_at: string;
  platform: string;
  status: string;
  error_message: string | null;
  caption: string | null;
  created_at: string;
  experiment_id?: string | null;
  experiment_variant?: string | null;
  debug_trace?: {
    ai_recipe?: {
      visual_style: string;
      voice_tone: string;
      hook_type: string;
      source: "city" | "global" | "tilt";
      delta_pct: number;
      reason: string;
      condition: string | null;
      city: string | null;
      sample_size: number;
    };
    [k: string]: any;
  } | null;
}

export async function createScheduledPost(
  city: string,
  scheduledAt: string,
  platform: string,
  caption?: string | null
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: inserted, error } = await supabase
    .from("scheduled_posts")
    .insert({
      city,
      scheduled_at: scheduledAt,
      platform,
      user_id: user.id,
      ...(caption ? { caption } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error) return false;
  if (inserted?.id) {
    await enqueueGenerateContentJob({
      userId: user.id,
      scheduledPostId: inserted.id,
      city,
      platform,
      scheduledFor: scheduledAt,
      source: "manual-create",
    });
  }
  return true;
}

// Enqueue a generate_content job for a scheduled_post. Best-effort:
// failures are logged but never block the user-facing schedule action,
// since the legacy cron still picks up the row as a safety net.
async function enqueueGenerateContentJob(args: {
  userId: string;
  scheduledPostId: string;
  city: string;
  platform: string;
  scheduledFor: string;
  source: string;
}) {
  try {
    const { error } = await supabase.rpc("enqueue_job", {
      p_user_id: args.userId,
      p_type: "generate_content",
      p_payload: { source: args.source },
      p_parent_job_id: null,
      p_root_job_id: null,
      p_scheduled_post_id: args.scheduledPostId,
      p_city: args.city,
      p_platform: args.platform,
      p_scheduled_for: args.scheduledFor,
    });
    if (error) console.warn("[api] enqueue_job failed:", error.message);
  } catch (e) {
    console.warn("[api] enqueue_job threw:", e);
  }
}

export async function fetchScheduledPosts(): Promise<ScheduledPostItem[]> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .order("scheduled_at", { ascending: true });

  if (error) return [];
  return (data as ScheduledPostItem[]) || [];
}

export async function cancelScheduledPost(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("scheduled_posts")
    .update({ status: "cancelled" })
    .eq("id", id);
  return !error;
}

export async function updateScheduledPost(
  id: string,
  updates: { city?: string; scheduled_at?: string; platform?: string; caption?: string | null }
): Promise<boolean> {
  const { error } = await supabase
    .from("scheduled_posts")
    .update(updates)
    .eq("id", id)
    .eq("status", "pending");
  return !error;
}

/**
 * Duplicate a scheduled post — clones the row with status=pending and
 * scheduled_at bumped 1 hour into the future (or +1h from original, whichever is later).
 */
export async function duplicateScheduledPost(post: ScheduledPostItem): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const original = new Date(post.scheduled_at).getTime();
  const oneHourFromNow = Date.now() + 60 * 60 * 1000;
  const newScheduledAt = new Date(Math.max(original + 60 * 60 * 1000, oneHourFromNow)).toISOString();

  const { data: inserted, error } = await supabase
    .from("scheduled_posts")
    .insert({
      city: post.city,
      scheduled_at: newScheduledAt,
      platform: post.platform,
      user_id: user.id,
      ...(post.caption ? { caption: post.caption } : {}),
    })
    .select("id")
    .maybeSingle();
  if (error) return false;
  if (inserted?.id) {
    await enqueueGenerateContentJob({
      userId: user.id,
      scheduledPostId: inserted.id,
      city: post.city,
      platform: post.platform,
      scheduledFor: newScheduledAt,
      source: "manual-duplicate",
    });
  }
  return true;
}

/**
 * Retry a failed scheduled post by re-queuing it: clears the error and
 * sets status back to "pending" with scheduled_at bumped to now + 2 minutes
 * so the existing scheduler picks it up on its next tick.
 */
export async function retryScheduledPost(id: string): Promise<boolean> {
  const newScheduledAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
  const { data: updated, error } = await supabase
    .from("scheduled_posts")
    .update({
      status: "pending",
      error_message: null,
      scheduled_at: newScheduledAt,
    })
    .eq("id", id)
    .select("id, user_id, city, platform")
    .maybeSingle();
  if (error) return false;
  if (updated?.id && updated.user_id) {
    await enqueueGenerateContentJob({
      userId: updated.user_id,
      scheduledPostId: updated.id,
      city: updated.city,
      platform: updated.platform,
      scheduledFor: newScheduledAt,
      source: "manual-retry",
    });
  }
  return true;
}

// --- Manual Post via Job Pipeline ---
//
// Replaces the legacy "generate → render → publish directly" path. Creates a
// scheduled_post (status=pending, scheduled_at = now+30s to satisfy the
// validate_scheduled_at trigger), enqueues a generate_content job, and polls
// until the row reaches a terminal status. The full pipeline runs:
//   generate_content → generate_voice → render_video → publish_post
// Voice + render gating in process-scheduled-posts and video-render guarantee
// no silent / instant-fallback shortcuts. Identical behaviour to automated.
export interface ManualPipelineResult {
  success: boolean;
  message: string;
  scheduledPostId?: string;
  status?: string;
  error?: string;
  externalUrl?: string | null;
  onPhase?: never;
}

export async function triggerManualPipelinePost(
  platform: string,
  voice: VoiceOptions | undefined,
  city: CityContext | null | undefined,
  caption: string | null | undefined,
  opts?: {
    onPhase?: (phase: "creating" | "queued" | "running" | "publishing", detail?: string) => void;
    bundleId?: string | null;
    timeoutMs?: number;
  }
): Promise<ManualPipelineResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, message: "Not signed in" };
  if (!city?.name) return { success: false, message: "No active city" };

  opts?.onPhase?.("creating", "Creating job…");

  const scheduledAtIso = new Date(Date.now() + 30 * 1000).toISOString();
  const cityName = city.state ? `${city.name}, ${city.state}` : city.name;

  const debugTrace: Record<string, unknown> = { source: "manual_post" };
  if (opts?.bundleId) debugTrace.preview_bundle_id = opts.bundleId;

  const { data: inserted, error: insErr } = await supabase
    .from("scheduled_posts")
    .insert({
      user_id: user.id,
      city: cityName,
      city_id: city.id ?? null,
      scheduled_at: scheduledAtIso,
      platform,
      status: "pending",
      include_voiceover: !!voice?.enabled,
      ...(caption ? { caption } : {}),
      debug_trace: debugTrace as any,
    })
    .select("id")
    .maybeSingle();
  if (insErr || !inserted?.id) {
    return { success: false, message: insErr?.message || "Failed to create job" };
  }

  await enqueueGenerateContentJob({
    userId: user.id,
    scheduledPostId: inserted.id,
    city: cityName,
    platform,
    scheduledFor: scheduledAtIso,
    source: "manual-post-now",
  });

  opts?.onPhase?.("queued", "Queued — running pipeline…");

  // Poll the scheduled_post until terminal. Pipeline can take 60–120s.
  const timeoutMs = opts?.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();
  let lastStatus = "pending";
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 4000));
    const { data: row } = await supabase
      .from("scheduled_posts")
      .select("status, error_message")
      .eq("id", inserted.id)
      .maybeSingle();
    const status = (row?.status as string) ?? "pending";
    if (status !== lastStatus) {
      lastStatus = status;
      if (status === "processing") opts?.onPhase?.("running", "Rendering video…");
      else if (status === "rendering") opts?.onPhase?.("running", "Rendering video…");
      else if (status === "publishing") opts?.onPhase?.("publishing", "Publishing to platform…");
    }
    if (status === "posted" || status === "succeeded") {
      // Lookup external_id from post_history for the URL
      const { data: hist } = await supabase
        .from("post_history")
        .select("external_id")
        .eq("user_id", user.id)
        .eq("city", cityName)
        .eq("platform", platform)
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const externalUrl = hist?.external_id
        ? platform === "youtube"
          ? `https://youtube.com/shorts/${hist.external_id}`
          : null
        : null;
      return {
        success: true,
        message: `Posted to ${platform}${externalUrl ? ` — ${externalUrl}` : ""}`,
        scheduledPostId: inserted.id,
        status,
        externalUrl,
      };
    }
    if (status === "failed" || status === "failed_precheck" || status === "cancelled") {
      return {
        success: false,
        message: row?.error_message || `Pipeline ${status}`,
        scheduledPostId: inserted.id,
        status,
        error: row?.error_message ?? undefined,
      };
    }
  }
  return {
    success: false,
    message: "Pipeline timed out waiting for completion",
    scheduledPostId: inserted.id,
    status: lastStatus,
  };
}

// --- Caption Generation ---

export async function generateCaption(
  weather: WeatherData,
  opts?: { style?: string; variation?: boolean; tone?: string; timePeriod?: string | null; platform?: string | null }
): Promise<string> {
  const { data, error } = await supabase.functions.invoke("generate-caption", {
    body: {
      city: weather.city,
      stateOrRegion: weather.stateOrRegion,
      morningTemp: weather.morningTemp,
      morningCondition: weather.morningCondition,
      afternoonTemp: weather.afternoonTemp,
      afternoonCondition: weather.afternoonCondition,
      eveningTemp: weather.eveningTemp,
      eveningCondition: weather.eveningCondition,
      rainChance: weather.rainChance,
      windInfo: weather.windInfo,
      sunrise: weather.sunrise,
      sunset: weather.sunset,
      tomorrowHigh: weather.tomorrowHigh,
      tomorrowLow: weather.tomorrowLow,
      tomorrowCondition: weather.tomorrowCondition,
      style: opts?.style ?? "standard",
      variation: !!opts?.variation,
      tone: opts?.tone,
      time_period: opts?.timePeriod ?? null,
      platform: opts?.platform ?? null,
    },
  });

  if (error) throw new Error(error.message || "Failed to generate caption");
  if (data?.error) throw new Error(data.error);
  return data?.caption || "";
}

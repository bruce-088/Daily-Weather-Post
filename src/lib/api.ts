import { supabase } from "@/integrations/supabase/client";
import type { AutomationSettings, WeatherData } from "@/types/weather";

export async function loadSettings(): Promise<{ settings: AutomationSettings; tiktokConnected: boolean; youtubeConnected: boolean; twitterConnected: boolean; linkedinConnected: boolean } | null> {
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
    },
    tiktokConnected: !!(data as any).tiktok_access_token,
    youtubeConnected: !!(data as any).youtube_access_token,
    twitterConnected: !!(data as any).twitter_access_token,
    linkedinConnected: !!(data as any).linkedin_access_token,
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

export async function triggerDailyPost(timePeriod?: string, platforms?: string[]): Promise<{ success: boolean; message: string }> {
  const body: Record<string, any> = {};
  if (timePeriod) body.time_period = timePeriod;
  if (platforms && platforms.length > 0) body.platforms = platforms;

  const { data, error } = await supabase.functions.invoke("daily-weather-post", {
    body: Object.keys(body).length > 0 ? body : undefined,
  });

  if (error) {
    return { success: false, message: error.message || "Failed to trigger post" };
  }

  return {
    success: data?.success ?? false,
    message: data?.message || data?.error || "Unknown response",
  };
}

export interface PreviewResult {
  success: boolean;
  content_type?: "video" | "image";
  video_url?: string;
  image_url?: string;
  storage_path?: string;
  weather?: any;
  caption?: string | null;
  error?: string;
}

export async function generatePreview(): Promise<PreviewResult> {
  const { data, error } = await supabase.functions.invoke("daily-weather-post", {
    body: { mode: "preview" },
  });

  if (error) {
    return { success: false, error: error.message || "Failed to generate preview" };
  }

  return data as PreviewResult;
}

export async function uploadPreviewVideo(
  storagePath: string,
  title: string,
  description: string,
  caption?: string | null,
): Promise<{ success: boolean; message: string; youtube_video_id?: string }> {
  const { data, error } = await supabase.functions.invoke("upload-preview-video", {
    body: { storage_path: storagePath, title, description, caption },
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
}

export async function fetchPostHistory(limit = 10): Promise<PostHistoryItem[]> {
  const { data, error } = await supabase
    .from("post_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return data || [];
}

// --- Scheduled Posts ---

export interface ScheduledPostItem {
  id: string;
  city: string;
  scheduled_at: string;
  platform: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

export async function createScheduledPost(
  city: string,
  scheduledAt: string,
  platform: string,
  caption?: string | null
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase.from("scheduled_posts").insert({
    city,
    scheduled_at: scheduledAt,
    platform,
    user_id: user.id,
    ...(caption ? { caption } : {}),
  });
  return !error;
}

export async function fetchScheduledPosts(): Promise<ScheduledPostItem[]> {
  const { data, error } = await supabase
    .from("scheduled_posts")
    .select("*")
    .order("scheduled_at", { ascending: true });

  if (error) return [];
  return data || [];
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

// --- Caption Generation ---

export async function generateCaption(weather: WeatherData): Promise<string> {
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
    },
  });

  if (error) throw new Error(error.message || "Failed to generate caption");
  if (data?.error) throw new Error(data.error);
  return data?.caption || "";
}

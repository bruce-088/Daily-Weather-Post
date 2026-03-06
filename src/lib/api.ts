import { supabase } from "@/integrations/supabase/client";
import type { AutomationSettings, WeatherData } from "@/types/weather";

export async function loadSettings(): Promise<{ settings: AutomationSettings; tiktokConnected: boolean } | null> {
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
      autoPost: data.auto_post || false,
    },
    tiktokConnected: !!(data as any).tiktok_access_token,
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
    instagram_api_key: settings.instagramApiKey || null,
    tiktok_api_key: settings.tiktokApiKey || null,
    post_time: settings.postTime + ":00",
    auto_post: settings.autoPost,
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

export async function triggerDailyPost(): Promise<{ success: boolean; message: string }> {
  const { data, error } = await supabase.functions.invoke("daily-weather-post");

  if (error) {
    return { success: false, message: error.message || "Failed to trigger post" };
  }

  return {
    success: data?.success ?? false,
    message: data?.message || data?.error || "Unknown response",
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
    },
  });

  if (error) throw new Error(error.message || "Failed to generate caption");
  if (data?.error) throw new Error(data.error);
  return data?.caption || "";
}

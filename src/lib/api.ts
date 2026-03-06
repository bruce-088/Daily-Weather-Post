import { supabase } from "@/integrations/supabase/client";
import type { AutomationSettings } from "@/types/weather";

export async function loadSettings(): Promise<AutomationSettings | null> {
  const { data, error } = await supabase
    .from("weather_settings")
    .select("*")
    .limit(1)
    .single();

  if (error || !data) return null;

  return {
    openWeatherApiKey: data.openweather_api_key || "",
    instagramApiKey: data.instagram_api_key || "",
    tiktokApiKey: data.tiktok_api_key || "",
    postTime: data.post_time?.slice(0, 5) || "08:00",
    location: data.city || "San Francisco",
    autoPost: data.auto_post || false,
  };
}

export async function saveSettings(settings: AutomationSettings): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  // Get existing row for this user
  const { data: existing } = await supabase
    .from("weather_settings")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const payload = {
    city: settings.location,
    openweather_api_key: settings.openWeatherApiKey || null,
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

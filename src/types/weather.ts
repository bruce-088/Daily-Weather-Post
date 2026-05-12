export interface WeatherData {
  city: string;
  country: string;
  stateOrRegion: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  condition: string;
  conditionIcon: string;
  description: string;
  forecast: ForecastDay[];
  // Time-of-day breakdowns
  morningTemp: number | null;
  morningCondition: string | null;
  afternoonTemp: number | null;
  afternoonCondition: string | null;
  eveningTemp: number | null;
  eveningCondition: string | null;
  rainChance: number | null;
  windInfo: string | null;
  sunrise: string | null;
  sunset: string | null;
  tomorrowHigh: number | null;
  tomorrowLow: number | null;
  tomorrowCondition: string | null;
}

export interface ForecastDay {
  day: string;
  tempHigh: number;
  tempLow: number;
  condition: string;
  conditionIcon: string;
}

export type AspectRatio = "1:1" | "9:16";

export type TimePeriod = "morning" | "afternoon" | "evening";

export interface AutomationSettings {
  instagramApiKey: string;
  tiktokApiKey: string;
  postTime: string; // kept for backward compat
  location: string;
  state: string;
  autoPost: boolean;
  morningPostTime: string;
  afternoonPostTime: string;
  eveningPostTime: string;
  autoPostMorning: boolean;
  autoPostAfternoon: boolean;
  autoPostEvening: boolean;
  timezone: string;
  morningPlatforms: string[];
  afternoonPlatforms: string[];
  eveningPlatforms: string[];
  morningSkipDate?: string | null;
  afternoonSkipDate?: string | null;
  eveningSkipDate?: string | null;
  // AI voiceover preferences applied to auto-posts on video-capable platforms
  enableVoiceover: boolean;
  voiceoverVoiceId: string; // "female" | "male" | "anchor" | "cheerful" | "calm" | "deep" | raw ElevenLabs id
  voiceoverSpeed: number;       // 0.7–1.2 (default 1.0)
  voiceoverStability: number;   // 0–1 (default 0.55) — lower = more expressive
  voiceoverSimilarity: number;  // 0–1 (default 0.78) — higher = closer to original voice
  // AI caption "Voice & Tone" preset
  captionTone: "professional" | "hype" | "funny" | "local_legend";
  // Growth: append "Subscribe + hit the bell" CTA to every voiceover (default ON)
  subscribeCtaEnabled: boolean;
}

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

export interface AutomationSettings {
  instagramApiKey: string;
  tiktokApiKey: string;
  postTime: string;
  location: string;
  state: string;
  autoPost: boolean;
}

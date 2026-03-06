export interface WeatherData {
  city: string;
  country: string;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  condition: string;
  conditionIcon: string;
  description: string;
  forecast: ForecastDay[];
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
  autoPost: boolean;
}

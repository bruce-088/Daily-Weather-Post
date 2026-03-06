import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WeatherData } from "@/types/weather";

const MOCK_WEATHER: WeatherData = {
  city: "San Francisco",
  country: "US",
  temperature: 18,
  feelsLike: 16,
  humidity: 72,
  windSpeed: 14,
  condition: "Partly Cloudy",
  conditionIcon: "cloud-sun",
  description: "Partly cloudy with mild temperatures",
  forecast: [
    { day: "Mon", tempHigh: 19, tempLow: 12, condition: "Sunny", conditionIcon: "sun" },
    { day: "Tue", tempHigh: 17, tempLow: 11, condition: "Cloudy", conditionIcon: "cloud" },
    { day: "Wed", tempHigh: 15, tempLow: 10, condition: "Rain", conditionIcon: "cloud-rain" },
    { day: "Thu", tempHigh: 16, tempLow: 11, condition: "Partly Cloudy", conditionIcon: "cloud-sun" },
    { day: "Fri", tempHigh: 20, tempLow: 13, condition: "Sunny", conditionIcon: "sun" },
  ],
};

export function useWeather() {
  const [weather, setWeather] = useState<WeatherData>(MOCK_WEATHER);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(async (location: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("fetch-weather", {
        body: { city: location },
      });

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      setWeather(data as WeatherData);
    } catch (err: any) {
      setError(err.message || "Failed to fetch weather");
      setWeather(MOCK_WEATHER);
    } finally {
      setLoading(false);
    }
  }, []);

  return { weather, loading, error, fetchWeather };
}

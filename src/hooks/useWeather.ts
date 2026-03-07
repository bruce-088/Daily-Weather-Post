import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WeatherData } from "@/types/weather";

const REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes

const MOCK_WEATHER: WeatherData = {
  city: "San Francisco",
  country: "US",
  stateOrRegion: "California",
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
  morningTemp: 55,
  morningCondition: "Fog",
  afternoonTemp: 65,
  afternoonCondition: "Partly Cloudy",
  eveningTemp: 58,
  eveningCondition: "Clear",
  rainChance: 10,
  windInfo: "14 mph",
  sunrise: "6:45 AM",
  sunset: "6:12 PM",
};

export function useWeather(autoRefreshLocation?: string) {
  const [weather, setWeather] = useState<WeatherData>(MOCK_WEATHER);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchWeather = useCallback(async (location: string, state?: string) => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("fetch-weather", {
        body: { city: location, state: state || undefined },
      });

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      setWeather(data as WeatherData);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || "Failed to fetch weather");
      // Keep last good weather data instead of resetting to mock
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoRefreshLocation) return;

    fetchWeather(autoRefreshLocation);

    intervalRef.current = setInterval(() => {
      fetchWeather(autoRefreshLocation);
    }, REFRESH_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefreshLocation, fetchWeather]);

  return { weather, loading, error, fetchWeather, lastUpdated };
}

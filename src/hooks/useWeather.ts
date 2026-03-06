import { useState, useCallback } from "react";
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

  const fetchWeather = useCallback(async (location: string, apiKey: string) => {
    if (!apiKey) {
      setWeather(MOCK_WEATHER);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const geoRes = await fetch(
        `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(location)}&limit=1&appid=${apiKey}`
      );
      const geoData = await geoRes.json();

      if (!geoData.length) {
        throw new Error("Location not found");
      }

      const { lat, lon, name, country } = geoData[0];

      const [currentRes, forecastRes] = await Promise.all([
        fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`),
        fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`),
      ]);

      const current = await currentRes.json();
      const forecast = await forecastRes.json();

      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const dailyMap = new Map<string, { temps: number[]; condition: string; icon: string }>();

      forecast.list.forEach((item: any) => {
        const date = new Date(item.dt * 1000);
        const dayKey = date.toDateString();
        if (!dailyMap.has(dayKey)) {
          dailyMap.set(dayKey, { temps: [], condition: item.weather[0].main, icon: mapIcon(item.weather[0].main) });
        }
        dailyMap.get(dayKey)!.temps.push(item.main.temp);
      });

      const forecastDays = Array.from(dailyMap.entries()).slice(1, 6).map(([key, val]) => ({
        day: dayNames[new Date(key).getDay()],
        tempHigh: Math.round(Math.max(...val.temps)),
        tempLow: Math.round(Math.min(...val.temps)),
        condition: val.condition,
        conditionIcon: val.icon,
      }));

      setWeather({
        city: name,
        country,
        temperature: Math.round(current.main.temp),
        feelsLike: Math.round(current.main.feels_like),
        humidity: current.main.humidity,
        windSpeed: Math.round(current.wind.speed * 3.6),
        condition: current.weather[0].main,
        conditionIcon: mapIcon(current.weather[0].main),
        description: current.weather[0].description,
        forecast: forecastDays,
      });
    } catch (err: any) {
      setError(err.message || "Failed to fetch weather");
      setWeather(MOCK_WEATHER);
    } finally {
      setLoading(false);
    }
  }, []);

  return { weather, loading, error, fetchWeather };
}

function mapIcon(condition: string): string {
  const map: Record<string, string> = {
    Clear: "sun",
    Clouds: "cloud",
    Rain: "cloud-rain",
    Drizzle: "cloud-drizzle",
    Thunderstorm: "cloud-lightning",
    Snow: "snowflake",
    Mist: "cloud-fog",
    Fog: "cloud-fog",
    Haze: "cloud-fog",
  };
  return map[condition] || "cloud-sun";
}

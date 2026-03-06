import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { city } = await req.json();
    if (!city) throw new Error("City is required");

    const apiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!apiKey) throw new Error("OpenWeatherMap API key not configured");

    // Geocode
    const geoRes = await fetch(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`
    );
    const geoData = await geoRes.json();
    if (!geoData.length) throw new Error("Location not found");

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

    const weather = {
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
    };

    return new Response(JSON.stringify(weather), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

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

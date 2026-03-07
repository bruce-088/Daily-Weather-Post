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
    const { city, state: inputState } = await req.json();
    if (!city) throw new Error("City is required");

    const apiKey = Deno.env.get("OPENWEATHER_API_KEY");
    if (!apiKey) throw new Error("OpenWeatherMap API key not configured");

    // Geocode — include state for more accurate results
    const geoQuery = inputState ? (city + "," + inputState) : city;
    const geoRes = await fetch(
      `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(geoQuery)}&limit=1&appid=${apiKey}`
    );
    const geoData = await geoRes.json();
    if (!geoData.length) throw new Error("Location not found");

    const { lat, lon, name, country, state } = geoData[0];

    const [currentRes, forecastRes] = await Promise.all([
      fetch(`https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`),
      fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${apiKey}`),
    ]);

    const current = await currentRes.json();
    const forecast = await forecastRes.json();

    // --- 5-day forecast ---
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

    // --- Time-of-day breakdowns for today ---
    const now = new Date();
    const todayStr = now.toDateString();

    let morningTemp: number | null = null;
    let morningCondition: string | null = null;
    let afternoonTemp: number | null = null;
    let afternoonCondition: string | null = null;
    let eveningTemp: number | null = null;
    let eveningCondition: string | null = null;
    let maxPop = 0;

    for (const item of forecast.list) {
      const dt = new Date(item.dt * 1000);
      if (dt.toDateString() !== todayStr) continue;
      const hour = dt.getHours();
      const temp = Math.round(item.main.temp);
      const cond = item.weather[0].main;
      if (item.pop != null && item.pop > maxPop) maxPop = item.pop;

      if (hour >= 6 && hour < 12 && morningTemp === null) {
        morningTemp = temp;
        morningCondition = cond;
      } else if (hour >= 12 && hour < 18 && afternoonTemp === null) {
        afternoonTemp = temp;
        afternoonCondition = cond;
      } else if (hour >= 18 && eveningTemp === null) {
        eveningTemp = temp;
        eveningCondition = cond;
      }
    }

    // Fallback: use current data if today's forecast entries are missing
    if (morningTemp === null && afternoonTemp === null && eveningTemp === null) {
      const currentHour = now.getHours();
      const temp = Math.round(current.main.temp);
      const cond = current.weather[0].main;
      if (currentHour < 12) { morningTemp = temp; morningCondition = cond; }
      else if (currentHour < 18) { afternoonTemp = temp; afternoonCondition = cond; }
      else { eveningTemp = temp; eveningCondition = cond; }
    }

    // Sunrise / sunset
    const sunriseDate = new Date(current.sys.sunrise * 1000);
    const sunsetDate = new Date(current.sys.sunset * 1000);
    const formatTime = (d: Date) =>
      d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

    const windInfo = `${Math.round(current.wind.speed)} mph${current.wind.gust ? `, gusts ${Math.round(current.wind.gust)} mph` : ""}`;

    const weather = {
      city: name,
      country,
      stateOrRegion: state || country || "",
      temperature: Math.round(current.main.temp),
      feelsLike: Math.round(current.main.feels_like),
      humidity: current.main.humidity,
      windSpeed: Math.round(current.wind.speed),
      condition: current.weather[0].main,
      conditionIcon: mapIcon(current.weather[0].main),
      description: current.weather[0].description,
      forecast: forecastDays,
      morningTemp,
      morningCondition,
      afternoonTemp,
      afternoonCondition,
      eveningTemp,
      eveningCondition,
      rainChance: Math.round(maxPop * 100),
      windInfo,
      sunrise: formatTime(sunriseDate),
      sunset: formatTime(sunsetDate),
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

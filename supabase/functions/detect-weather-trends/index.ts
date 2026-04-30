// detect-weather-trends
// Daily cron. For each user with a weather_settings city (and any user_cities),
// pulls a 48-hour forecast from OpenWeatherMap and detects extreme weather:
//   - heat_wave  : any forecast point > 100°F
//   - freeze     : any forecast point < 32°F
//   - storm      : main contains 'thunderstorm' or weather id 200-299
//   - hurricane  : weather id 781 (tornado) or descriptions containing "hurricane"
//
// On detection (deduplicated per day per user/city/type via trend_alerts.alert_date):
//   1. Insert trend_alerts row
//   2. Insert notifications row (in-app bell)
//   3. Pre-create a draft scheduled_posts row (status='draft') the user can approve

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type AlertType = "heat_wave" | "storm" | "freeze" | "hurricane";

interface DetectedAlert {
  type: AlertType;
  severity: "low" | "moderate" | "high";
  message: string;
  startsAt: string;
}

async function geocode(city: string, state: string | null, apiKey: string) {
  const q = state ? `${city},${state},US` : city;
  const r = await fetch(
    `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${apiKey}`,
  );
  if (!r.ok) return null;
  const arr = await r.json();
  return arr?.[0] ? { lat: arr[0].lat, lon: arr[0].lon } : null;
}

async function detectForCity(
  city: string,
  state: string | null,
  apiKey: string,
): Promise<DetectedAlert[]> {
  const geo = await geocode(city, state, apiKey);
  if (!geo) return [];

  const r = await fetch(
    `https://api.openweathermap.org/data/2.5/forecast?lat=${geo.lat}&lon=${geo.lon}&units=imperial&appid=${apiKey}`,
  );
  if (!r.ok) return [];
  const data = await r.json();
  const list: any[] = (data?.list || []).slice(0, 16); // ~48 hours (3-hour steps)

  const alerts: DetectedAlert[] = [];
  let maxTemp = -Infinity;
  let minTemp = Infinity;
  let stormPoint: any = null;
  let hurricanePoint: any = null;

  for (const p of list) {
    const t = Number(p?.main?.temp ?? 0);
    if (t > maxTemp) maxTemp = t;
    if (t < minTemp) minTemp = t;
    const w = p?.weather?.[0] || {};
    const id = Number(w.id || 0);
    const desc = String(w.description || "").toLowerCase();
    const main = String(w.main || "").toLowerCase();
    if (!stormPoint && (id >= 200 && id < 300 || main === "thunderstorm")) stormPoint = p;
    if (!hurricanePoint && (id === 781 || desc.includes("hurricane") || desc.includes("tropical storm"))) {
      hurricanePoint = p;
    }
  }

  if (maxTemp > 100) {
    alerts.push({
      type: "heat_wave",
      severity: maxTemp > 108 ? "high" : "moderate",
      message: `🔥 Heat wave incoming for ${city} — peak ${Math.round(maxTemp)}°F in the next 48h. Suggest an extra hydration / heat-safety post.`,
      startsAt: new Date(list[0]?.dt * 1000 || Date.now()).toISOString(),
    });
  }
  if (minTemp < 32) {
    alerts.push({
      type: "freeze",
      severity: minTemp < 20 ? "high" : "moderate",
      message: `❄️ Freeze watch for ${city} — temps drop to ${Math.round(minTemp)}°F. Suggest a freeze-prep post (pipes, plants, pets).`,
      startsAt: new Date(list[0]?.dt * 1000 || Date.now()).toISOString(),
    });
  }
  if (stormPoint) {
    alerts.push({
      type: "storm",
      severity: "moderate",
      message: `⛈️ Thunderstorms incoming for ${city}. Suggest a storm-timing post so followers know when to take cover.`,
      startsAt: new Date(stormPoint.dt * 1000).toISOString(),
    });
  }
  if (hurricanePoint) {
    alerts.push({
      type: "hurricane",
      severity: "high",
      message: `🌀 Tropical/hurricane signal for ${city}. Strongly suggest an extra safety post.`,
      startsAt: new Date(hurricanePoint.dt * 1000).toISOString(),
    });
  }

  return alerts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const apiKey = Deno.env.get("OPENWEATHER_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENWEATHER_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Build (user_id, city, state) targets from weather_settings + user_cities
  const { data: ws } = await supabase
    .from("weather_settings")
    .select("user_id, city, state");
  const { data: uc } = await supabase
    .from("user_cities")
    .select("user_id, cities(name, state)");

  type Target = { user_id: string; city: string; state: string | null };
  const targets: Target[] = [];
  const seen = new Set<string>();
  for (const row of (ws || []) as any[]) {
    if (!row.user_id || !row.city) continue;
    const key = `${row.user_id}|${row.city.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ user_id: row.user_id, city: row.city, state: row.state || null });
  }
  for (const row of (uc || []) as any[]) {
    const c = row.cities;
    if (!row.user_id || !c?.name) continue;
    const key = `${row.user_id}|${c.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ user_id: row.user_id, city: c.name, state: c.state || null });
  }

  let alertsCreated = 0;
  let draftsCreated = 0;

  for (const t of targets) {
    let alerts: DetectedAlert[] = [];
    try {
      alerts = await detectForCity(t.city, t.state, apiKey);
    } catch (e) {
      console.warn(`[trends] detect failed for ${t.city}`, e);
      continue;
    }

    for (const a of alerts) {
      // Pre-create suggested scheduled post draft (next hour)
      const nextHour = new Date(Date.now() + 60 * 60 * 1000);
      const draftCaption = `${a.message}\n\nDraft caption — edit before publishing.`;
      const { data: draftRow, error: draftErr } = await supabase
        .from("scheduled_posts")
        .insert({
          user_id: t.user_id,
          city: t.city,
          scheduled_at: nextHour.toISOString(),
          platform: "all",
          status: "draft",
          caption: draftCaption,
        })
        .select("id")
        .maybeSingle();
      if (draftErr) {
        console.warn("[trends] draft insert failed", draftErr);
      } else if (draftRow) {
        draftsCreated += 1;
      }

      const { error: alertErr } = await supabase.from("trend_alerts").insert({
        user_id: t.user_id,
        city: t.city,
        alert_type: a.type,
        severity: a.severity,
        starts_at: a.startsAt,
        message: a.message,
        suggested_post_id: draftRow?.id ?? null,
      });
      if (alertErr) {
        // Likely a unique-violation dedupe (same day, city, type) — that's fine.
        if (!String(alertErr.message || "").includes("duplicate")) {
          console.warn("[trends] alert insert failed", alertErr);
        }
        // If alert was deduped, also remove the draft we just created to avoid drift
        if (draftRow?.id && String(alertErr.message || "").includes("duplicate")) {
          await supabase.from("scheduled_posts").delete().eq("id", draftRow.id);
          draftsCreated = Math.max(0, draftsCreated - 1);
        }
        continue;
      }
      alertsCreated += 1;

      await supabase.from("notifications").insert({
        user_id: t.user_id,
        type: "warning",
        title: `Weather alert: ${a.type.replace("_", " ")}`,
        message: a.message,
      });
    }
  }

  await supabase.from("system_health").upsert({
    id: "detect-weather-trends",
    last_run_at: new Date().toISOString(),
    last_status: "ok",
    last_message: `targets=${targets.length} alerts=${alertsCreated} drafts=${draftsCreated}`,
  });

  return new Response(
    JSON.stringify({ targets: targets.length, alerts: alertsCreated, drafts: draftsCreated }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

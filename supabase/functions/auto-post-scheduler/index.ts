import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get all weather settings with auto-post enabled
    const { data: allSettings, error } = await supabase
      .from("weather_settings")
      .select("*");

    if (error || !allSettings?.length) {
      return new Response(
        JSON.stringify({ message: "No settings found", triggered: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const now = new Date();

    // Get the current wall-clock hour/minute in a given IANA timezone.
    function getZonedHourMinute(date: Date, timeZone: string): { hour: number; minute: number } {
      try {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const parts = fmt.formatToParts(date);
        const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
        const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");
        // Intl can return "24" for midnight in some runtimes — normalize.
        return { hour: hour === 24 ? 0 : hour, minute };
      } catch {
        // Fallback to UTC if timezone is invalid
        return { hour: date.getUTCHours(), minute: date.getUTCMinutes() };
      }
    }

    // Parse "HH:MM[:SS]" → { hour, minute }
    function parseTime(timeStr: string): { hour: number; minute: number } {
      const parts = timeStr.split(":");
      return { hour: parseInt(parts[0]), minute: parseInt(parts[1]) };
    }

    // Check if the user's local wall-clock time is within 15 minutes after the target.
    // Cron runs every 15 min, so window = [target, target + 15min).
    function evaluateTime(timeStr: string, timeZone: string) {
      const target = parseTime(timeStr);
      const zoned = getZonedHourMinute(now, timeZone);
      const targetMinutes = target.hour * 60 + target.minute;
      const currentMinutes = zoned.hour * 60 + zoned.minute;
      let diff = currentMinutes - targetMinutes;
      // Handle day wrap (e.g., target 23:55, current 00:05)
      if (diff < -12 * 60) diff += 24 * 60;
      const shouldPost = diff >= 0 && diff < 15;
      return {
        shouldPost,
        diff,
        targetLocal: `${String(target.hour).padStart(2, "0")}:${String(target.minute).padStart(2, "0")}`,
        currentLocal: `${String(zoned.hour).padStart(2, "0")}:${String(zoned.minute).padStart(2, "0")}`,
      };
    }

    const nowUtcIso = now.toISOString();
    const nowUtcHm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
    console.log(`[scheduler] Tick — now UTC: ${nowUtcIso} (${nowUtcHm}), users: ${allSettings.length}`);

    let triggered = 0;
    const results: string[] = [];

    for (const settings of allSettings) {
      const userTz: string = settings.timezone || "UTC";
      const userLocal = getZonedHourMinute(now, userTz);
      const userLocalHm = `${String(userLocal.hour).padStart(2, "0")}:${String(userLocal.minute).padStart(2, "0")}`;
      console.log(`[scheduler] User ${settings.user_id || "default"} — tz: ${userTz}, local now: ${userLocalHm}`);

      const periods: { enabled: boolean; time: string; name: string; platforms: string[]; skipDate: string | null }[] = [
        {
          enabled: settings.auto_post_morning,
          time: settings.morning_post_time,
          name: "morning",
          platforms: Array.isArray(settings.morning_platforms) ? settings.morning_platforms : [],
          skipDate: settings.morning_skip_date || null,
        },
        {
          enabled: settings.auto_post_afternoon,
          time: settings.afternoon_post_time,
          name: "afternoon",
          platforms: Array.isArray(settings.afternoon_platforms) ? settings.afternoon_platforms : [],
          skipDate: settings.afternoon_skip_date || null,
        },
        {
          enabled: settings.auto_post_evening,
          time: settings.evening_post_time,
          name: "evening",
          platforms: Array.isArray(settings.evening_platforms) ? settings.evening_platforms : [],
          skipDate: settings.evening_skip_date || null,
        },
      ];

      // Today's date in user's local timezone (YYYY-MM-DD)
      const todayLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone: userTz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);

      for (const period of periods) {
        if (!period.enabled || !period.time) {
          console.log(`[scheduler]   ${period.name}: skipped (enabled=${period.enabled}, time=${period.time})`);
          continue;
        }
        if (period.skipDate && period.skipDate === todayLocal) {
          console.log(`[scheduler]   ${period.name}: skipped (skip_date=${period.skipDate} matches today ${todayLocal})`);
          continue;
        }
        if (!period.platforms.length) {
          console.log(`[scheduler]   ${period.name}: skipped (no platforms selected for this slot)`);
          continue;
        }
        const ev = evaluateTime(period.time, userTz);
        console.log(
          `[scheduler]   ${period.name}: target_local=${ev.targetLocal} ${userTz}, current_local=${ev.currentLocal}, diff=${ev.diff}min, shouldPost=${ev.shouldPost}, platforms=${period.platforms.join(",")}`
        );
        if (!ev.shouldPost) continue;

        console.log(`[scheduler]   → Triggering ${period.name} post for user ${settings.user_id || "default"} on ${period.platforms.join(",")}`);

        try {
          const postUrl = supabaseUrl + "/functions/v1/daily-weather-post";
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + anonKey,
          };

          const res = await fetch(postUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ time_period: period.name, platforms: period.platforms }),
          });

          const resText = await res.text();
          console.log("Post result for " + period.name + ":", res.status, resText.substring(0, 200));
          triggered++;
          results.push(period.name + ": " + res.status);
        } catch (e) {
          console.error("Failed to trigger " + period.name + " post:", e);
          results.push(period.name + ": error");
        }
      }
    }

    return new Response(
      JSON.stringify({ message: "Auto-post check complete", triggered, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Auto-post scheduler error:", message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

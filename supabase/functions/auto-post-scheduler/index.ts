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
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    // Convert HH:MM:SS time string to { hour, minute }
    function parseTime(timeStr: string): { hour: number; minute: number } {
      const parts = timeStr.split(":");
      return { hour: parseInt(parts[0]), minute: parseInt(parts[1]) };
    }

    // Check if current time is within 15 minutes of the target time
    function isTimeToPost(timeStr: string): boolean {
      const target = parseTime(timeStr);
      const targetMinutes = target.hour * 60 + target.minute;
      const currentMinutes = currentHour * 60 + currentMinute;
      const diff = currentMinutes - targetMinutes;
      return diff >= 0 && diff < 15;
    }

    let triggered = 0;
    const results: string[] = [];

    for (const settings of allSettings) {
      const periods: { enabled: boolean; time: string; name: string }[] = [
        { enabled: settings.auto_post_morning, time: settings.morning_post_time, name: "morning" },
        { enabled: settings.auto_post_afternoon, time: settings.afternoon_post_time, name: "afternoon" },
        { enabled: settings.auto_post_evening, time: settings.evening_post_time, name: "evening" },
      ];

      for (const period of periods) {
        if (!period.enabled || !period.time) continue;
        if (!isTimeToPost(period.time)) continue;

        console.log("Triggering " + period.name + " post for user " + (settings.user_id || "default") + " at " + period.time);

        try {
          const postUrl = supabaseUrl + "/functions/v1/daily-weather-post";
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + anonKey,
          };

          const res = await fetch(postUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({ time_period: period.name }),
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

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

  // Initialize client + heartbeat OUTSIDE the main try so heartbeat always runs first.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── HEARTBEAT (very first thing): record that the scheduler is alive ──
  // This runs even if downstream logic crashes, so System Health reflects
  // actual cron invocations, not just slot-matching post creations.
  try {
    await supabase.from("system_health").upsert({
      id: "auto-post-scheduler",
      last_run_at: new Date().toISOString(),
      last_status: "running",
      last_message: "tick started",
      updated_at: new Date().toISOString(),
    });
    console.log("[scheduler] ❤️  heartbeat recorded");
  } catch (hbErr) {
    console.error("[scheduler] heartbeat write failed:", hbErr);
  }

  try {

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

    // Check if the user's local wall-clock time is within 5 minutes after the target.
    // Window = [target, target + 5min] — ensures slots aren't missed when cron fires
    // slightly off the exact minute (e.g., 16:03 still catches a 16:00 slot).
    function evaluateTime(timeStr: string, timeZone: string) {
      const target = parseTime(timeStr);
      const zoned = getZonedHourMinute(now, timeZone);
      const targetMinutes = target.hour * 60 + target.minute;
      const currentMinutes = zoned.hour * 60 + zoned.minute;
      let diff = currentMinutes - targetMinutes;
      // Handle day wrap (e.g., target 23:55, current 00:05)
      if (diff < -12 * 60) diff += 24 * 60;
      const shouldPost = diff >= 0 && diff <= 5;
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
        console.log(
          `[scheduler]   ── Checking slot: ${period.name.toUpperCase()} | utc_now=${nowUtcIso} | tz=${userTz} | local_now=${userLocalHm} | target_local=${period.time || "(unset)"} | platforms=[${period.platforms.join(", ") || "none"}]`
        );
        if (!period.enabled || !period.time) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: disabled or no time (enabled=${period.enabled}, time=${period.time})`);
          continue;
        }
        if (period.skipDate && period.skipDate === todayLocal) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: skip_date=${period.skipDate} matches today ${todayLocal}`);
          continue;
        }
        if (!period.platforms.length) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: no platforms selected for this slot`);
          continue;
        }
        const ev = evaluateTime(period.time, userTz);
        console.log(
          `[scheduler]   ${period.name}: target_local=${ev.targetLocal} ${userTz}, current_local=${ev.currentLocal}, diff=${ev.diff}min, shouldPost=${ev.shouldPost}`
        );
        if (!ev.shouldPost) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: outside post window (diff=${ev.diff}min, need 0..5)`);
          continue;
        }
        console.log(`[scheduler]   🎯 Slot matched within window — triggering post (${period.name}, diff=${ev.diff}min)`);
        console.log(`[scheduler]   ✅ ${period.name.toUpperCase()} slot triggered for user ${settings.user_id || "default"}`);
        console.log(`[scheduler]   Creating scheduled posts for platforms: [${period.platforms.join(", ")}]`);

        if (!settings.user_id) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: settings row has no user_id (cannot create scheduled_posts)`);
          continue;
        }

        // Duplicate guard: has any scheduled_posts row been created in the last 30 min
        // for this user + slot (any platform)? Slot is encoded in caption marker [auto:<slot>].
        const dupSince = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
        const slotMarker = `[auto:${period.name}]`;
        const { data: recentDupes, error: dupErr } = await supabase
          .from("scheduled_posts")
          .select("id, created_at, caption")
          .eq("user_id", settings.user_id)
          .gte("created_at", dupSince)
          .ilike("caption", `%${slotMarker}%`)
          .limit(1);

        if (dupErr) {
          console.error(`[scheduler]   duplicate check failed for ${period.name}:`, dupErr);
        } else if (recentDupes && recentDupes.length > 0) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: duplicate (already created ${recentDupes[0].created_at})`);
          continue;
        }

        // Schedule slightly in the future to satisfy validate_scheduled_at trigger.
        const scheduledAt = new Date(now.getTime() + 5_000).toISOString();

        // === AI VOICEOVER FLAG (per-user setting) ===
        // Only attach voice to video-capable platforms (youtube, tiktok, instagram).
        // Image-only platforms (twitter, linkedin) get include_voiceover=false even if the user enabled it.
        // Actual TTS generation happens in process-scheduled-posts so the cron tick stays fast and
        // a TTS failure cannot block the entire schedule.
        const voiceoverEnabled = (settings as any).enable_voiceover === true;
        const VIDEO_PLATFORMS = new Set(["youtube", "tiktok", "instagram"]);
        if (voiceoverEnabled) {
          console.log(`[scheduler]   🎙️  voiceover enabled for user ${settings.user_id}; will attach to video platforms only`);
        }

        // Insert one scheduled_posts row per platform — process-scheduled-posts will execute them.
        const rows = period.platforms.map((platform) => ({
          user_id: settings.user_id,
          city: settings.city,
          platform,
          scheduled_at: scheduledAt,
          status: "pending",
          // Marker lets us detect duplicates and trace origin; process-scheduled-posts
          // will auto-generate the real caption since this is just a tag, not full copy.
          caption: slotMarker,
          include_voiceover: voiceoverEnabled && VIDEO_PLATFORMS.has(platform),
        }));

        const { error: insErr, data: inserted } = await supabase
          .from("scheduled_posts")
          .insert(rows)
          .select("id, platform");

        if (insErr) {
          console.error(`[scheduler]   ❌ Failed to create scheduled_posts for ${period.name}:`, insErr);
          results.push(`${period.name}: insert_error`);
        } else {
          console.log(`[scheduler]   📝 Created ${inserted?.length ?? 0} scheduled_posts row(s) for ${period.name}: ${(inserted || []).map((r: any) => r.platform).join(", ")}`);
          triggered += inserted?.length ?? 0;
          results.push(`${period.name}: queued ${inserted?.length ?? 0}`);
        }
      }


      // === DAILY SUMMARY (fires once per user when local time is 23:30 - 23:59) ===
      try {
        if (settings.user_id && userLocal.hour === 23 && userLocal.minute >= 30) {
          // Idempotency: skip if a summary notification already exists for today (user-local).
          const lookback = new Date(now);
          lookback.setUTCHours(lookback.getUTCHours() - 6);
          const { data: existingSummary } = await supabase
            .from("notifications")
            .select("id, created_at")
            .eq("user_id", settings.user_id)
            .eq("title", "Daily summary")
            .gte("created_at", lookback.toISOString())
            .limit(1);

          if (!existingSummary || existingSummary.length === 0) {
            const sodLocal = new Date(`${todayLocal}T00:00:00`);
            const { data: todays } = await supabase
              .from("post_history")
              .select("status, platform, error_message, created_at")
              .eq("user_id", settings.user_id)
              .gte("created_at", sodLocal.toISOString());

            const total = todays?.length ?? 0;
            const successCount = (todays ?? []).filter((p) => p.status === "success").length;
            const failedCount = (todays ?? []).filter((p) => p.status === "failed").length;

            let message: string;
            let type: "success" | "error" | "info" = "info";

            if (total === 0) {
              message = "Today: no posts published. Check your automation slots in Settings.";
              type = "info";
            } else if (failedCount === 0) {
              message = `Today: ${successCount}/${total} posts successful. Total engagement: coming soon.`;
              type = "success";
            } else {
              message = `Today: ${successCount}/${total} posts successful, ${failedCount} failed. Total engagement: coming soon.`;
              type = failedCount > successCount ? "error" : "info";
            }

            const meta = {
              v: 1,
              kind: "summary",
              date: todayLocal,
              total,
              success: successCount,
              failed: failedCount,
            };
            const fullMessage = `${message}\n<<META>>${JSON.stringify(meta)}`;

            const { error: sumErr } = await supabase.from("notifications").insert({
              user_id: settings.user_id,
              title: "Daily summary",
              message: fullMessage,
              type,
            });
            if (sumErr) console.error("[scheduler] daily summary insert failed:", sumErr);
            else console.log(`[scheduler] daily summary sent to user ${settings.user_id}`);
          } else {
            console.log(`[scheduler] daily summary already exists for user ${settings.user_id} today`);
          }
        }
      } catch (sumE) {
        console.error("[scheduler] daily summary error:", sumE);
      }
    }

    // Mark heartbeat as success
    try {
      await supabase.from("system_health").upsert({
        id: "auto-post-scheduler",
        last_run_at: new Date().toISOString(),
        last_status: "ok",
        last_message: `triggered=${triggered}`,
        updated_at: new Date().toISOString(),
      });
    } catch (_) { /* best-effort */ }

    return new Response(
      JSON.stringify({ message: "Auto-post check complete", triggered, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Auto-post scheduler error:", message);
    // Record failure but STILL return 200 so cron doesn't think function is down
    try {
      await supabase.from("system_health").upsert({
        id: "auto-post-scheduler",
        last_run_at: new Date().toISOString(),
        last_status: "error",
        last_message: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      });
    } catch (_) { /* best-effort */ }
    return new Response(
      JSON.stringify({ message: "Scheduler completed with errors", error: message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

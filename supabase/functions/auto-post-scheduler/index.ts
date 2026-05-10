import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  shouldRunExperiment,
  shouldRunTimingExperiment,
  pickChallengerVariant,
  buildControlVariant,
  createExperimentRow,
  getTopVisualStyle,
} from "../_shared/experiments.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function cityLabel(city: any): string {
  return city?.state ? String(city.name) + ", " + String(city.state) : String(city?.name || "Unknown");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Initialize client + heartbeat OUTSIDE the main try so heartbeat always runs first.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── DRY-RUN MODE ──
  // When the request body contains { dry_run: true }, the scheduler runs ALL of
  // its slot-matching logic (per city, per period, per platform) but performs
  // ZERO side-effects: no scheduled_posts inserts, no notifications, no
  // system_health writes, no duplicate-guard reads. It returns a structured
  // diagnostic payload instead so the UI can show exactly what would have fired.
  let dryRun = false;
  try {
    if (req.method === "POST") {
      const body = await req.clone().json().catch(() => ({}));
      dryRun = body?.dry_run === true;
    }
  } catch (_) { /* ignore parse errors */ }
  const dryRunReport: any[] = [];

  // ── HEARTBEAT (very first thing): record that the scheduler is alive ──
  // Skipped during dry-run so we don't pollute the System Health card.
  if (!dryRun) {
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
  } else {
    console.log("[scheduler] 🧪 DRY RUN — no DB side effects will occur");
  }

  try {

    // Weather settings are user-level preferences only (voice, legacy defaults).
    // Multi-city scheduling must be driven by automations.city_id, never by the
    // most recently edited weather_settings row.
    const { data: allSettings, error } = await supabase
      .from("weather_settings")
      .select("*")
      .not("user_id", "is", null)
      .order("updated_at", { ascending: false });

    const { data: automations, error: automationError } = await supabase
      .from("automations")
      .select("*");

    if (error || automationError) {
      throw new Error(error?.message || automationError?.message || "Failed to load automation settings");
    }

    if (!allSettings?.length && !automations?.length) {
      return new Response(
        JSON.stringify({ message: "No settings found", triggered: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const settingsByUser = new Map<string, any>();
    for (const row of allSettings || []) {
      if (row.user_id && !settingsByUser.has(row.user_id)) settingsByUser.set(row.user_id, row);
    }

    const enabledAutomations = (automations || []).filter((a: any) => a.enabled === true);
    const automationCityIds = [...new Set(enabledAutomations.map((a: any) => a.city_id).filter(Boolean))];
    const citiesById = new Map<string, any>();
    if (automationCityIds.length) {
      const { data: cityRows, error: cityError } = await supabase
        .from("cities")
        .select("id, name, state, country, timezone")
        .in("id", automationCityIds);
      if (cityError) throw new Error(`Failed to load automation cities: ${cityError.message}`);
      for (const city of cityRows || []) citiesById.set(city.id, city);
    }

    const scheduleTargets = [
      ...enabledAutomations.map((automation: any) => {
        const city = citiesById.get(automation.city_id);
        const userSettings = settingsByUser.get(automation.user_id) || null;
        return {
          source: "automation",
          user_id: automation.user_id,
          city_id: automation.city_id,
          automation_id: automation.id,
          city: city?.name || "",
          state: city?.state || null,
          timezone: automation.timezone || city?.timezone || userSettings?.timezone || "UTC",
          enable_voiceover: userSettings?.enable_voiceover === true,
          periods: [
            { enabled: true, time: automation.morning_time, name: "morning", platforms: jsonArray(automation.morning_platforms), skipDate: null },
            { enabled: true, time: automation.afternoon_time, name: "afternoon", platforms: jsonArray(automation.afternoon_platforms), skipDate: null },
            { enabled: true, time: automation.evening_time, name: "evening", platforms: jsonArray(automation.evening_platforms), skipDate: null },
          ],
        };
      }).filter((target: any) => {
        if (target.user_id && target.city_id && target.city) return true;
        console.warn(`[scheduler] skipping automation ${target.automation_id || "unknown"}: missing city_id/city/user`);
        return false;
      }),
    ];

    const now = new Date();
    const POST_WINDOW_MINUTES = 15;
    const DUPLICATE_GUARD_MINUTES = 30;

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

    // Check if the user's local wall-clock time is within the extended window after the target.
    // Window = [target, target + 10min] — ensures slots aren't missed when cron fires
    // late due to minor cron drift or function execution timing.
    function evaluateTime(timeStr: string, timeZone: string) {
      const target = parseTime(timeStr);
      const zoned = getZonedHourMinute(now, timeZone);
      const targetMinutes = target.hour * 60 + target.minute;
      const currentMinutes = zoned.hour * 60 + zoned.minute;
      let diff = currentMinutes - targetMinutes;
      // Handle day wrap (e.g., target 23:55, current 00:05)
      if (diff < -12 * 60) diff += 24 * 60;
      const shouldPost = diff >= 0 && diff <= POST_WINDOW_MINUTES;
      return {
        shouldPost,
        diff,
        targetLocal: `${String(target.hour).padStart(2, "0")}:${String(target.minute).padStart(2, "0")}`,
        currentLocal: `${String(zoned.hour).padStart(2, "0")}:${String(zoned.minute).padStart(2, "0")}`,
      };
    }

    const nowUtcIso = now.toISOString();
    const nowUtcHm = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
    console.log(`[scheduler] Tick — now UTC: ${nowUtcIso} (${nowUtcHm}), targets: ${scheduleTargets.length}, enabled automations: ${enabledAutomations.length}, total automations: ${(automations || []).length}`);

    // Count valid slots: enabled automations that have a city_id AND at least one platform on at least one slot.
    const validSlots = enabledAutomations.filter((a: any) => {
      if (!a.city_id) return false;
      const m = Array.isArray(a.morning_platforms) ? a.morning_platforms.length : 0;
      const af = Array.isArray(a.afternoon_platforms) ? a.afternoon_platforms.length : 0;
      const e = Array.isArray(a.evening_platforms) ? a.evening_platforms.length : 0;
      return m + af + e > 0;
    }).length;
    if (validSlots === 0) {
      console.log("AUTO: No valid slots — check city/platform config");
    } else {
      console.log(`AUTO: Found ${validSlots} valid slots`);
    }

    let triggered = 0;
    const results: string[] = [];

    for (const target of scheduleTargets) {
      const userTz: string = target.timezone || "UTC";
      const userLocal = getZonedHourMinute(now, userTz);
      const userLocalHm = `${String(userLocal.hour).padStart(2, "0")}:${String(userLocal.minute).padStart(2, "0")}`;
      console.log(`[scheduler] Target ${target.source} user=${target.user_id} city=${target.city}${target.state ? ", " + target.state : ""} city_id=${target.city_id || "legacy"} — tz: ${userTz}, local now: ${userLocalHm}`);

      // Today's date in user's local timezone (YYYY-MM-DD)
      const todayLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone: userTz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);

      for (const period of target.periods) {
        const cityLabelStr = `${target.city}${target.state ? ", " + target.state : ""}`;
        const baseEntry: any = {
          city: cityLabelStr,
          city_id: target.city_id || null,
          slot: period.name,
          target_local: period.time || null,
          current_local: userLocalHm,
          tz: userTz,
          platforms: period.platforms,
          matched: false,
          reason: "",
        };

        console.log(
          `[scheduler]   ── Checking slot: ${period.name.toUpperCase()} | utc_now=${nowUtcIso} | tz=${userTz} | local_now=${userLocalHm} | target_local=${period.time || "(unset)"} | platforms=[${period.platforms.join(", ") || "none"}]`
        );
        if (!period.enabled || !period.time) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: disabled or no time (enabled=${period.enabled}, time=${period.time})`);
          if (dryRun) dryRunReport.push({ ...baseEntry, reason: `Disabled or no time set (enabled=${period.enabled}, time=${period.time || "unset"}).` });
          continue;
        }
        if (period.skipDate && period.skipDate === todayLocal) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: skip_date=${period.skipDate} matches today ${todayLocal}`);
          if (dryRun) dryRunReport.push({ ...baseEntry, reason: `Skipped — slot has skip_date=${period.skipDate} matching today.` });
          continue;
        }
        if (!period.platforms.length) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: no platforms selected for this slot`);
          if (dryRun) dryRunReport.push({ ...baseEntry, reason: "No platforms selected for this slot. Pick at least one in the city's automation settings." });
          continue;
        }
        // ── TIMING TILT ──: if ai_memory has a winning timing offset for this user/city,
        // shift the slot's target time by that many minutes (max ±30).
        let timingTiltMin = 0;
        try {
          const { data: timingMem } = await supabase
            .from("ai_memory")
            .select("content, performance_score, condition")
            .eq("user_id", target.user_id)
            .eq("memory_type", "timing")
            .order("performance_score", { ascending: false })
            .limit(20);
          // Prefer entries whose `condition` field encodes "<city>:<slot>" or matches city.
          const cityKey = target.city.toLowerCase();
          const slotKey = period.name.toLowerCase();
          const tagged = (timingMem || []).find((m: any) => {
            const c = String(m.condition || "").toLowerCase();
            return c.includes(cityKey) && c.includes(slotKey);
          }) || (timingMem || []).find((m: any) => String(m.condition || "").toLowerCase().includes(cityKey));
          if (tagged?.content) {
            const parsed = parseInt(String(tagged.content).replace(/[^-\d]/g, ""), 10);
            if (!isNaN(parsed) && Math.abs(parsed) <= 30) {
              timingTiltMin = parsed;
              console.log(`[scheduler]   ⏱️  timing tilt: applying ${parsed >= 0 ? "+" : ""}${parsed}min from ai_memory winner (city=${target.city}, slot=${period.name})`);
            }
          }
        } catch (tErr) {
          console.warn("[scheduler]   timing tilt lookup failed:", tErr);
        }
        // Apply the tilt to the period time before evaluation.
        const tiltedTime = (() => {
          const t = parseTime(period.time);
          let total = t.hour * 60 + t.minute + timingTiltMin;
          total = ((total % 1440) + 1440) % 1440;
          const h = Math.floor(total / 60), m = total % 60;
          return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        })();
        const ev = evaluateTime(tiltedTime, userTz);
        console.log(
          `[scheduler]   ${period.name}: target_local=${ev.targetLocal} ${userTz}, current_local=${ev.currentLocal}, diff=${ev.diff}min, shouldPost=${ev.shouldPost}`
        );
        if (!ev.shouldPost) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: outside post window (diff=${ev.diff}min, need 0..${POST_WINDOW_MINUTES})`);
          if (dryRun) {
            dryRunReport.push({
              ...baseEntry,
              target_local: ev.targetLocal,
              current_local: ev.currentLocal,
              diff_min: ev.diff,
              reason: `Outside ${POST_WINDOW_MINUTES}-minute post window (diff=${ev.diff}min). Will fire when local time hits ${ev.targetLocal} ${userTz}.`,
            });
          }
          continue;
        }

        console.log(`[scheduler]   🎯 Matched slot within extended window (${period.name}, diff=${ev.diff}min)`);
        console.log(`AUTO: Processing slot for ${target.city} at ${period.time} (${period.name}) — city_id=${target.city_id || "legacy"}, user=${target.user_id || "default"}`);
        console.log(`[scheduler]   ✅ ${period.name.toUpperCase()} slot triggered for user ${target.user_id || "default"} city=${target.city} city_id=${target.city_id || "legacy"}`);
        console.log(`[scheduler]   Creating scheduled posts for platforms: [${period.platforms.join(", ")}]`);

        if (!target.user_id || !target.city) {
          console.log(`[scheduler]   ⏭️  SKIP ${period.name} — reason: target missing user_id or city (cannot create scheduled_posts)`);
          if (dryRun) dryRunReport.push({ ...baseEntry, matched: false, reason: "Target missing user_id or city." });
          continue;
        }

        // === AI VOICEOVER FLAG (per-user setting) ===
        const voiceoverEnabled = target.enable_voiceover === true;
        const VIDEO_PLATFORMS = new Set(["youtube", "tiktok", "instagram"]);
        if (voiceoverEnabled) {
          console.log(`[scheduler]   🎙️  voiceover enabled for user ${target.user_id}; will attach to video platforms only`);
        }

        // ── DRY-RUN: stop before any DB side effects, just record the match. ──
        if (dryRun) {
          dryRunReport.push({
            ...baseEntry,
            target_local: ev.targetLocal,
            current_local: ev.currentLocal,
            diff_min: ev.diff,
            matched: true,
            voiceover_enabled: voiceoverEnabled,
            voiceover_platforms: period.platforms.filter((p: string) => VIDEO_PLATFORMS.has(p)),
            reason: `Within ${POST_WINDOW_MINUTES}m window (diff=${ev.diff}min). Would publish to: ${period.platforms.join(", ")}.`,
          });
          continue;
        }

        // Duplicate guard (live runs only): has any scheduled_posts row been created in the last 30 min?
        const dupSince = new Date(now.getTime() - DUPLICATE_GUARD_MINUTES * 60 * 1000).toISOString();
        const slotMarker = `[auto:${period.name}]`;
        let dupQuery = supabase
          .from("scheduled_posts")
          .select("id, created_at, caption")
          .eq("user_id", target.user_id)
          .eq("city", target.city)
          .gte("created_at", dupSince)
          .ilike("caption", `%${slotMarker}%`)
          .limit(1);
        if (target.city_id) dupQuery = dupQuery.eq("city_id", target.city_id);
        if (target.automation_id) dupQuery = dupQuery.eq("automation_id", target.automation_id);
        const { data: recentDupes, error: dupErr } = await dupQuery;

        if (dupErr) {
          console.error(`[scheduler]   duplicate check failed for ${period.name}:`, dupErr);
        } else if (recentDupes && recentDupes.length > 0) {
          console.log(`[scheduler]   ⏭️  Skipped due to duplicate guard (${period.name}, already created ${recentDupes[0].created_at})`);
          continue;
        }

        // Schedule slightly in the future to satisfy validate_scheduled_at trigger.
        const scheduledAt = new Date(now.getTime() + 5_000).toISOString();

        // Insert one scheduled_posts row per platform — process-scheduled-posts will execute them.
        const rows = period.platforms.map((platform) => ({
          user_id: target.user_id,
          city: target.city,
          city_id: target.city_id,
          automation_id: target.automation_id,
          platform,
          scheduled_at: scheduledAt,
          status: "pending",
          caption: slotMarker,
          include_voiceover: voiceoverEnabled && VIDEO_PLATFORMS.has(platform),
        }));

        // Idempotent insert — the unique constraint
        // (user_id, city, platform, scheduled_at) makes this safe against
        // duplicate cron ticks. We use upsert with ignoreDuplicates so that
        // if a row for this exact job already exists, the insert is silently
        // skipped instead of erroring.
        const { error: insErr, data: inserted } = await supabase
          .from("scheduled_posts")
          .upsert(rows, {
            onConflict: "user_id,city,platform,scheduled_at",
            ignoreDuplicates: true,
          })
          .select("id, platform");

        if (insErr) {
          console.error(`[scheduler]   ❌ Failed to create scheduled_posts for ${period.name}:`, insErr);
          results.push(`${period.name}: insert_error`);
        } else {
          const insertedCount = inserted?.length ?? 0;
          const skippedCount = rows.length - insertedCount;
          for (const r of inserted || []) {
            console.log(`AUTO: Created scheduled_post row for ${r.platform} (city=${target.city}, slot=${period.name}, voiceover=${voiceoverEnabled && VIDEO_PLATFORMS.has(r.platform)})`);
          }
          if (skippedCount > 0) {
            console.log(`[scheduler]   🔁 Skipped ${skippedCount} duplicate job(s) for ${period.name} (unique_key collision — already queued)`);
          }
          console.log(`[scheduler]   📝 Created ${insertedCount} scheduled_posts row(s) for ${period.name}: ${(inserted || []).map((r: any) => r.platform).join(", ")}`);
          triggered += insertedCount;
          results.push(`${period.name}: queued ${insertedCount}${skippedCount ? ` (skipped ${skippedCount} dup)` : ""}`);

          // ── JOB PIPELINE (opt-in via weather_settings.use_jobs_pipeline) ──
          // When enabled, also enqueue a generate_content job per inserted row.
          // The legacy cron continues to run unchanged — the job runner takes
          // ownership of execution by calling process-scheduled-posts itself.
          const userSettings = settingsByUser.get(target.user_id);
          if (!dryRun && userSettings?.use_jobs_pipeline === true && inserted && inserted.length > 0) {
            for (const row of inserted) {
              const { error: enqueueErr } = await supabase.rpc("enqueue_job", {
                p_user_id: target.user_id,
                p_type: "generate_content",
                p_payload: { source: "auto-scheduler", slot: period.name },
                p_parent_job_id: null,
                p_root_job_id: null,
                p_scheduled_post_id: row.id,
                p_city: target.city,
                p_platform: row.platform,
                p_scheduled_for: scheduledAt,
              });
              if (enqueueErr) {
                console.error(`[scheduler]   ⚠️ enqueue_job failed for ${row.id}:`, enqueueErr.message);
              } else {
                console.log(`[scheduler]   🧩 enqueued generate_content job for scheduled_post ${row.id}`);
              }
            }
          }

          // ── TIMING EXPERIMENT PAIRING ──
          // Same content, two times: A = base-15min (effectively "now" because the
          // slot just triggered), B = base+15min (now + 30min). Picks ~25% of slots.
          let timingExpRan = false;
          if (!dryRun && inserted && inserted.length > 0) {
            try {
              if (await shouldRunTimingExperiment(supabase, target.user_id, target.city)) {
                const expId = await createExperimentRow(supabase, {
                  userId: target.user_id,
                  city: target.city,
                  variable: "timing",
                  variantA: { label: "Earlier", ...({ timing: "-15" } as any) } as any,
                  variantB: { label: "Later", ...({ timing: "+15" } as any) } as any,
                  testType: "timing",
                  offsetA: -15,
                  offsetB: 15,
                });
                if (expId) {
                  await supabase.from("scheduled_posts").update({
                    experiment_id: expId, experiment_variant: "A",
                  }).in("id", inserted.map((r: any) => r.id));

                  const bScheduledAt = new Date(now.getTime() + 30 * 60 * 1000 + 5_000).toISOString();
                  const bRows = inserted.map((r: any) => ({
                    user_id: target.user_id,
                    city: target.city,
                    city_id: target.city_id,
                    automation_id: target.automation_id,
                    platform: r.platform,
                    scheduled_at: bScheduledAt,
                    status: "pending",
                    caption: slotMarker + " [exp:B] [timing:+15]",
                    include_voiceover: voiceoverEnabled && VIDEO_PLATFORMS.has(r.platform),
                    experiment_id: expId,
                    experiment_variant: "B",
                  }));
                  const { error: bErr, data: bInserted } = await supabase
                    .from("scheduled_posts").insert(bRows).select("id, platform");
                  if (bErr) console.warn(`[experiments] timing B insert failed:`, bErr.message);
                  else console.log(`[experiments] ⏱️  Timing exp ${expId} created; B rows: ${(bInserted || []).length}`);
                  timingExpRan = true;
                }
              }
            } catch (tExpErr) {
              console.warn("[experiments] timing pairing exception:", tExpErr);
            }
          }

          // ── A/B EXPERIMENT PAIRING (content) ──
          // ~50% of the time create a Challenger (B) post 60min after the
          // Control (A). Skipped if a timing experiment was created for this slot.
          if (!dryRun && !timingExpRan && inserted && inserted.length > 0) {
            try {
              const userToneRaw = (settingsByUser.get(target.user_id) as any)?.caption_tone || "professional";
              if (await shouldRunExperiment(supabase, target.user_id)) {
                const control = buildControlVariant({ tone: userToneRaw, hook: "statement", visuals: "gradient" });
                const { variable, meta: challenger } = pickChallengerVariant(control);
                const expId = await createExperimentRow(supabase, {
                  userId: target.user_id,
                  city: target.city,
                  variable,
                  variantA: control,
                  variantB: challenger,
                });
                if (expId) {
                  // Tag A rows
                  await supabase.from("scheduled_posts").update({
                    experiment_id: expId, experiment_variant: "A",
                  }).in("id", inserted.map((r: any) => r.id));

                  // Schedule B rows 60 min later, mirroring platforms
                  const bScheduledAt = new Date(now.getTime() + 60 * 60 * 1000 + 5_000).toISOString();
                  const bRows = inserted.map((r: any) => ({
                    user_id: target.user_id,
                    city: target.city,
                    city_id: target.city_id,
                    automation_id: target.automation_id,
                    platform: r.platform,
                    scheduled_at: bScheduledAt,
                    status: "pending",
                    caption: slotMarker + " [exp:B]",
                    include_voiceover: voiceoverEnabled && VIDEO_PLATFORMS.has(r.platform),
                    experiment_id: expId,
                    experiment_variant: "B",
                  }));
                  const { data: bInserted, error: bErr } = await supabase
                    .from("scheduled_posts")
                    .insert(bRows)
                    .select("id, platform");
                  if (bErr) {
                    console.warn(`[experiments] B-variant insert failed for exp ${expId}:`, bErr.message);
                  } else {
                    console.log(`[experiments] 🧪 Created exp ${expId} (var=${variable}); B rows: ${(bInserted || []).length}`);
                  }
                }
              }
            } catch (expErr) {
              console.warn("[experiments] pairing exception:", expErr);
            }
          }
        }
      }


      // === DAILY SUMMARY (fires once per user when local time is 23:30 - 23:59) ===
      // Skipped during dry-run — no notifications should be inserted.
      if (!dryRun) {
        try {
          if (target.user_id && userLocal.hour === 23 && userLocal.minute >= 30) {
            // Idempotency: skip if a summary notification already exists for today (user-local).
            const lookback = new Date(now);
            lookback.setUTCHours(lookback.getUTCHours() - 6);
            const { data: existingSummary } = await supabase
              .from("notifications")
              .select("id, created_at")
              .eq("user_id", target.user_id)
              .eq("title", "Daily summary")
              .gte("created_at", lookback.toISOString())
              .limit(1);

            if (!existingSummary || existingSummary.length === 0) {
              const sodLocal = new Date(`${todayLocal}T00:00:00`);
              const { data: todays } = await supabase
                .from("post_history")
                .select("status, platform, error_message, created_at")
                .eq("user_id", target.user_id)
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
                user_id: target.user_id,
                title: "Daily summary",
                message: fullMessage,
                type,
              });
              if (sumErr) console.error("[scheduler] daily summary insert failed:", sumErr);
              else console.log(`[scheduler] daily summary sent to user ${target.user_id}`);
            } else {
              console.log(`[scheduler] daily summary already exists for user ${target.user_id} today`);
            }
          }
        } catch (sumE) {
          console.error("[scheduler] daily summary error:", sumE);
        }
      }
    }

    // Mark heartbeat as success (skipped during dry-run).
    if (!dryRun) {
      try {
        await supabase.from("system_health").upsert({
          id: "auto-post-scheduler",
          last_run_at: new Date().toISOString(),
          last_status: "ok",
          last_message: `triggered=${triggered}`,
          updated_at: new Date().toISOString(),
        });
      } catch (_) { /* best-effort */ }
    }

    if (dryRun) {
      // Build a flat human-readable summary the UI can render line-by-line.
      const summary = dryRunReport.map((e: any) => {
        const matchedTxt = e.matched ? "✅ Slot Match Found" : "⏭️  No match";
        const platformsTxt = (e.platforms && e.platforms.length) ? e.platforms.join(", ") : "none";
        return `${matchedTxt} for ${e.city} [${e.slot}] — Platforms: ${platformsTxt}. ${e.reason}`;
      });
      return new Response(
        JSON.stringify({
          dry_run: true,
          message: "Dry run complete — no rows inserted, no notifications sent.",
          checked_targets: scheduleTargets.length,
          would_trigger: dryRunReport.filter((e: any) => e.matched).length,
          report: dryRunReport,
          summary,
        }, null, 2),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ message: "Auto-post check complete", triggered, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Auto-post scheduler error:", message);
    // Record failure but STILL return 200 so cron doesn't think function is down.
    // Skipped during dry-run so a debug click doesn't flip System Health to red.
    if (!dryRun) {
      try {
        await supabase.from("system_health").upsert({
          id: "auto-post-scheduler",
          last_run_at: new Date().toISOString(),
          last_status: "error",
          last_message: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        });
      } catch (_) { /* best-effort */ }
    }
    return new Response(
      JSON.stringify({ dry_run: dryRun, message: "Scheduler completed with errors", error: message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

import { supabase } from "@/integrations/supabase/client";

export interface DebugSnapshotOptions {
  /** Optional notification context to include alongside system state */
  notification?: {
    title: string;
    message: string;
    type: string;
    created_at: string;
    meta?: any;
  };
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * Build a single-pane "Debug Snapshot" string covering: recent jobs,
 * last automation run, last voice status, current city/platform config,
 * and (optionally) the notification that triggered the report.
 *
 * Output is plain text, optimized for pasting into chat/issue trackers.
 */
export async function buildDebugSnapshot(opts: DebugSnapshotOptions = {}): Promise<string> {
  const { data: userResp } = await supabase.auth.getUser();
  const user = userResp?.user;

  const lines: string[] = [];
  lines.push("=== SkyBrief Debug Snapshot ===");
  lines.push(`Time: ${new Date().toLocaleString()}`);
  lines.push(`User: ${user?.email ?? user?.id ?? "anonymous"}`);
  lines.push("");

  if (!user) {
    lines.push("(not signed in — limited data available)");
    return lines.join("\n");
  }

  // Run all reads in parallel
  const [
    settingsRes,
    healthRes,
    jobsRes,
    historyRes,
    automationRes,
    citiesRes,
    socialRes,
  ] = await Promise.all([
    supabase
      .from("weather_settings")
      .select("city, state, use_jobs_pipeline, enable_voiceover, voiceover_voice_id, caption_tone, enable_debug_trace")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("system_health")
      .select("id, last_run_at, last_status, last_message")
      .in("id", ["auto-post-scheduler", "run-jobs"]),
    supabase
      .from("jobs" as any)
      .select("id, type, status, attempts, max_attempts, last_error, scheduled_for, completed_at, city, platform, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("post_history")
      .select("id, city, platform, status, voice_status, voice_error, voice_attempts, error_message, debug_trace, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("automations")
      .select("id, enabled, timezone, morning_time, afternoon_time, evening_time, morning_platforms, afternoon_platforms, evening_platforms, city_id")
      .eq("user_id", user.id),
    supabase
      .from("user_cities")
      .select("is_primary, city_id, cities:city_id(name, state, timezone)")
      .eq("user_id", user.id),
    supabase
      .from("social_accounts")
      .select("platform, account_name, token_expires_at, updated_at")
      .eq("user_id", user.id),
  ]);

  // ── City / platform config ──
  const settings = settingsRes.data as any;
  lines.push("── Config ──");
  if (settings) {
    lines.push(`City (legacy): ${settings.city ?? "—"}, ${settings.state ?? "—"}`);
    lines.push(`Caption tone: ${settings.caption_tone ?? "—"}`);
    lines.push(`Voiceover enabled: ${settings.enable_voiceover ? "yes" : "no"} (${settings.voiceover_voice_id ?? "default"})`);
    lines.push(`Job pipeline: ${settings.use_jobs_pipeline ? "ON (experimental)" : "off (legacy processor)"}`);
    lines.push(`Debug trace armed: ${settings.enable_debug_trace ? "yes" : "no"}`);
  } else {
    lines.push("(no weather_settings row)");
  }

  const cities = (citiesRes.data ?? []) as any[];
  if (cities.length > 0) {
    lines.push(`Cities: ${cities.map((c) => `${c.cities?.name ?? "?"}${c.cities?.state ? ", " + c.cities.state : ""}${c.is_primary ? " ★" : ""}`).join(" | ")}`);
  }

  const social = (socialRes.data ?? []) as any[];
  if (social.length > 0) {
    lines.push(`Connected: ${social.map((s) => {
      const exp = s.token_expires_at ? new Date(s.token_expires_at) : null;
      const expired = exp && exp.getTime() < Date.now();
      return `${s.platform}${expired ? " ⚠expired" : ""}`;
    }).join(", ")}`);
  } else {
    lines.push("Connected: (none)");
  }
  lines.push("");

  // ── Automations ──
  const automations = (automationRes.data ?? []) as any[];
  lines.push("── Automations ──");
  if (automations.length === 0) {
    lines.push("(none configured)");
  } else {
    for (const a of automations) {
      lines.push(
        `${a.enabled ? "✅" : "⏸"} tz=${a.timezone} morn=${a.morning_time}[${(a.morning_platforms ?? []).join(",") || "—"}] aft=${a.afternoon_time}[${(a.afternoon_platforms ?? []).join(",") || "—"}] eve=${a.evening_time}[${(a.evening_platforms ?? []).join(",") || "—"}]`,
      );
    }
  }
  lines.push("");

  // ── System health ──
  const healthRows = (healthRes.data ?? []) as any[];
  lines.push("── Workers ──");
  for (const id of ["auto-post-scheduler", "run-jobs"]) {
    const row = healthRows.find((r) => r.id === id);
    if (!row) {
      lines.push(`${id}: never reported`);
    } else {
      lines.push(
        `${id}: last=${ago(row.last_run_at)} (${fmtTime(row.last_run_at)}) status=${row.last_status ?? "?"}${row.last_message ? ` msg=${String(row.last_message).slice(0, 200)}` : ""}`,
      );
    }
  }
  lines.push("");

  // ── Last 5 jobs ──
  const jobs = (jobsRes.data ?? []) as any[];
  lines.push(`── Last ${jobs.length} jobs ──`);
  if (jobs.length === 0) {
    lines.push("(no jobs yet — pipeline may be disabled)");
  } else {
    for (const j of jobs) {
      lines.push(
        `[${ago(j.created_at)}] ${j.type} → ${j.status} (${j.attempts}/${j.max_attempts}) city=${j.city ?? "—"} platform=${j.platform ?? "—"}${j.last_error ? ` err=${String(j.last_error).slice(0, 200)}` : ""}`,
      );
    }
  }
  lines.push("");

  // ── Last voice + recent post history ──
  const history = (historyRes.data ?? []) as any[];
  lines.push("── Recent posts ──");
  if (history.length === 0) {
    lines.push("(no post history)");
  } else {
    for (const h of history) {
      const voice = h.voice_status
        ? `voice=${h.voice_status}${h.voice_attempts ? `(×${h.voice_attempts})` : ""}${h.voice_error ? `:${String(h.voice_error).slice(0, 100)}` : ""}`
        : "voice=—";
      lines.push(
        `[${ago(h.created_at)}] ${h.city} → ${h.platform ?? "—"} : ${h.status} ${voice}${h.error_message ? ` err=${String(h.error_message).slice(0, 200)}` : ""}`,
      );
    }
    // Last automation run trace (if available)
    const traced = history.find((h) => h.debug_trace?.steps && Array.isArray(h.debug_trace.steps));
    if (traced) {
      const steps = traced.debug_trace.steps.slice(-10);
      lines.push("");
      lines.push(`── Last trace (post ${traced.id.slice(0, 8)}, last ${steps.length} steps) ──`);
      for (const s of steps) {
        lines.push(
          `  ${new Date(s.ts).toLocaleTimeString()} ${s.step}${s.detail !== undefined && s.detail !== null ? ` · ${typeof s.detail === "object" ? JSON.stringify(s.detail) : String(s.detail)}` : ""}`,
        );
      }
    }
  }
  lines.push("");

  // ── Optional notification context ──
  if (opts.notification) {
    lines.push("── Triggering notification ──");
    lines.push(`Time: ${fmtTime(opts.notification.created_at)} (${ago(opts.notification.created_at)})`);
    lines.push(`Type: ${opts.notification.type}`);
    lines.push(`Title: ${opts.notification.title}`);
    lines.push(`Message: ${opts.notification.message}`);
    if (opts.notification.meta && Object.keys(opts.notification.meta).length > 0) {
      lines.push(`Meta: ${JSON.stringify(opts.notification.meta).slice(0, 500)}`);
    }
    lines.push("");
  }

  lines.push("=== end snapshot ===");
  return lines.join("\n");
}

export async function copyDebugSnapshot(opts: DebugSnapshotOptions = {}): Promise<string> {
  const text = await buildDebugSnapshot(opts);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback: legacy textarea approach
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } finally { document.body.removeChild(ta); }
  }
  return text;
}

// Phase 13G-B: project-aware YouTube OAuth refresh with telemetry + failure-streak hardening.
//
// One canonical refresh path used by:
//   - youtube-health-check (cron)
//   - YouTubeAdapter.getValidToken (real-time posting)
//   - sync-youtube-analytics (can adopt later)
//
// Rules:
//   - Always pick credentials by account.oauth_project ('A' = shorts default,
//     'B' = recaps via YOUTUBE_CLIENT_ID_RECAPS / YOUTUBE_CLIENT_SECRET_RECAPS).
//   - Never silently fall back to Project A creds for a Project B account
//     (that was the root cause of the chronic "token expired" loop).
//   - Always emit a structured row to public.system_logs so we can see
//     every refresh attempt + Google error code.
//   - Do NOT clear refresh_token on a single failure. Clear only after a
//     persistent streak (default ≥3 strikes spanning ≥1h) to survive
//     transient Google 5xx / network blips.

export type OAuthProject = "A" | "B";

export interface YouTubeAccountForRefresh {
  id: string;                              // social_accounts.id (may be empty for legacy weather_settings row)
  user_id?: string | null;
  account_name?: string | null;
  refresh_token: string | null;
  oauth_project?: OAuthProject | null;
  extra?: Record<string, unknown> | null;
}

export interface RefreshTelemetry {
  account_id: string;
  account_name: string | null;
  oauth_project: OAuthProject;
  http_status: number | null;
  google_error: string | null;
  ok: boolean;
}

export interface RefreshOutcome {
  ok: boolean;
  accessToken?: string;
  expiresAt?: string;            // ISO timestamp
  httpStatus?: number;
  googleError?: string;          // e.g. "invalid_grant"
  errorMessage?: string;         // human-readable
  misconfigured?: boolean;       // true when creds for the project aren't set
  strikes?: number;              // current consecutive failure count after this attempt
}

/** Resolve the (clientId, clientSecret) pair for a given OAuth project.
 *  Returns nulls when the env vars are missing. */
export function getYouTubeOAuthCredsForProject(project: OAuthProject): {
  clientId: string | null;
  clientSecret: string | null;
} {
  if (project === "B") {
    return {
      clientId: Deno.env.get("YOUTUBE_CLIENT_ID_RECAPS") || null,
      clientSecret: Deno.env.get("YOUTUBE_CLIENT_SECRET_RECAPS") || null,
    };
  }
  return {
    clientId: Deno.env.get("YOUTUBE_CLIENT_ID") || null,
    clientSecret: Deno.env.get("YOUTUBE_CLIENT_SECRET") || null,
  };
}

/** Failure-streak thresholds for clearing a refresh_token. */
export const REFRESH_FAIL_STREAK_THRESHOLD = 3;
export const REFRESH_FAIL_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RefreshFailureState {
  count: number;
  first_failed_at: string | null;
  last_failed_at: string | null;
  last_error: string | null;
}

function readFailState(extra: Record<string, unknown> | null | undefined): RefreshFailureState {
  const health = (extra && typeof extra === "object" ? (extra as any).health : null) || {};
  return {
    count: typeof health.refresh_fail_count === "number" ? health.refresh_fail_count : 0,
    first_failed_at: typeof health.refresh_first_failed_at === "string" ? health.refresh_first_failed_at : null,
    last_failed_at: typeof health.refresh_last_failed_at === "string" ? health.refresh_last_failed_at : null,
    last_error: typeof health.refresh_last_error === "string" ? health.refresh_last_error : null,
  };
}

/** Should we clear the refresh_token now? Only after ≥N consecutive failures
 *  AND the streak has lasted ≥1h. Prevents transient errors from forcing
 *  a manual reconnect. */
export function shouldClearRefreshToken(state: RefreshFailureState): boolean {
  if (state.count < REFRESH_FAIL_STREAK_THRESHOLD) return false;
  if (!state.first_failed_at) return false;
  const age = Date.now() - new Date(state.first_failed_at).getTime();
  return age >= REFRESH_FAIL_WINDOW_MS;
}

async function logRefreshTelemetry(supabase: any, t: RefreshTelemetry, extraContext: Record<string, unknown> = {}) {
  try {
    await supabase.from("system_logs").insert({
      user_id: extraContext.user_id ?? null,
      type: t.ok ? "youtube_refresh_succeeded" : "youtube_refresh_failed",
      platform: "youtube",
      message: t.ok
        ? `[refresh-ok] ${t.account_name || t.account_id} project=${t.oauth_project}`
        : `[refresh-fail] ${t.account_name || t.account_id} project=${t.oauth_project} http=${t.http_status ?? "n/a"} google_error=${t.google_error ?? "n/a"}`,
      context: {
        account_id: t.account_id,
        account_name: t.account_name,
        oauth_project: t.oauth_project,
        http_status: t.http_status,
        google_error: t.google_error,
        ok: t.ok,
        ...extraContext,
      },
    });
  } catch (e) {
    console.warn("[youtube-refresh] system_logs insert failed:", (e as Error)?.message);
  }
}

/**
 * Refresh a YouTube access token using the credentials that match the
 * account's oauth_project. ALWAYS logs telemetry to system_logs.
 *
 * On failure, returns updated streak info. Callers decide whether to
 * persist the streak counter into social_accounts.extra.health.* and
 * whether to clear the refresh_token (use shouldClearRefreshToken()).
 */
export async function refreshYouTubeAccessToken(
  supabase: any,
  account: YouTubeAccountForRefresh,
): Promise<RefreshOutcome> {
  const project: OAuthProject = account.oauth_project === "B" ? "B" : "A";
  const { clientId, clientSecret } = getYouTubeOAuthCredsForProject(project);
  const prevState = readFailState(account.extra ?? null);

  // Loud failure when the project's creds aren't configured at all.
  // This is a distinct misconfiguration error, NOT a Google rejection,
  // so we tag it specifically so dashboards can surface it.
  if (!clientId || !clientSecret) {
    const msg = `Project ${project} OAuth client not configured (need ${project === "B" ? "YOUTUBE_CLIENT_ID_RECAPS / YOUTUBE_CLIENT_SECRET_RECAPS" : "YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET"})`;
    console.error(`[youtube-refresh] MISCONFIGURED for "${account.account_name}" — ${msg}`);
    try {
      await supabase.from("system_logs").insert({
        user_id: account.user_id ?? null,
        type: "youtube_refresh_misconfigured",
        platform: "youtube",
        message: `[refresh-misconfig] ${account.account_name || account.id} project=${project}`,
        context: {
          account_id: account.id,
          account_name: account.account_name,
          oauth_project: project,
          missing_secrets: project === "B"
            ? ["YOUTUBE_CLIENT_ID_RECAPS", "YOUTUBE_CLIENT_SECRET_RECAPS"]
            : ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
        },
      });
    } catch (_) { /* best effort */ }
    return { ok: false, misconfigured: true, errorMessage: msg };
  }

  if (!account.refresh_token) {
    return { ok: false, errorMessage: "No refresh_token on account" };
  }

  let httpStatus: number | null = null;
  let googleError: string | null = null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
      }),
    });
    httpStatus = res.status;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error || !data.access_token) {
      googleError = (data.error || data.error_description || `http_${res.status}`).toString();
      await logRefreshTelemetry(
        supabase,
        {
          account_id: account.id,
          account_name: account.account_name ?? null,
          oauth_project: project,
          http_status: httpStatus,
          google_error: googleError,
          ok: false,
        },
        { user_id: account.user_id ?? null, error_description: data.error_description ?? null },
      );
      return {
        ok: false,
        httpStatus,
        googleError,
        errorMessage: data.error_description || googleError,
        strikes: prevState.count + 1,
      };
    }

    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    await logRefreshTelemetry(
      supabase,
      {
        account_id: account.id,
        account_name: account.account_name ?? null,
        oauth_project: project,
        http_status: httpStatus,
        google_error: null,
        ok: true,
      },
      { user_id: account.user_id ?? null, expires_at: expiresAt },
    );

    return { ok: true, accessToken: data.access_token, expiresAt, httpStatus };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logRefreshTelemetry(
      supabase,
      {
        account_id: account.id,
        account_name: account.account_name ?? null,
        oauth_project: project,
        http_status: httpStatus,
        google_error: "fetch_threw",
        ok: false,
      },
      { user_id: account.user_id ?? null, error_message: msg },
    );
    return { ok: false, errorMessage: msg, strikes: prevState.count + 1 };
  }
}

/** Merge a successful refresh outcome into account.extra.health (resets streak). */
export function mergeHealthOnSuccess(extra: Record<string, unknown> | null | undefined) {
  const prev = (extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>;
  const prevHealth = (typeof prev.health === "object" && prev.health) ? prev.health as Record<string, unknown> : {};
  return {
    ...prev,
    health: {
      ...prevHealth,
      status: "healthy",
      refresh: "succeeded",
      checked_at: new Date().toISOString(),
      refresh_fail_count: 0,
      refresh_first_failed_at: null,
      refresh_last_failed_at: null,
      refresh_last_error: null,
    },
  };
}

/** Merge a failed refresh into account.extra.health, advancing the streak. */
export function mergeHealthOnFailure(
  extra: Record<string, unknown> | null | undefined,
  outcome: RefreshOutcome,
) {
  const prev = (extra && typeof extra === "object" ? extra : {}) as Record<string, unknown>;
  const prevHealth = (typeof prev.health === "object" && prev.health) ? prev.health as Record<string, unknown> : {};
  const prevState = readFailState(prev);
  const now = new Date().toISOString();
  return {
    ...prev,
    health: {
      ...prevHealth,
      status: "expired",
      refresh: "failed",
      checked_at: now,
      refresh_error: outcome.googleError || outcome.errorMessage || "unknown",
      refresh_fail_count: prevState.count + 1,
      refresh_first_failed_at: prevState.first_failed_at || now,
      refresh_last_failed_at: now,
      refresh_last_error: outcome.googleError || outcome.errorMessage || "unknown",
    },
  };
}

export function readRefreshFailureState(extra: Record<string, unknown> | null | undefined) {
  return readFailState(extra);
}

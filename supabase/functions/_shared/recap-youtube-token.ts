// Shared helper: resolve a YouTube access token for recap functions
// (weekly / monthly / yearly). Uses the same YouTubeAdapter as the Shorts
// pipeline, which prefers per-city `social_accounts` rows and falls back to
// the legacy `weather_settings.youtube_*` columns automatically.
//
// Returns:
//   { token: string }                            — usable bearer token
//   { token: null, reason: "AUTH_EXPIRED" }      — user must reconnect YouTube
//   { token: null, reason: "ROUTING_VIOLATION", message } — no channel mapped to city
//   { token: null, reason: "NO_TOKEN" }          — no token at all (never connected)

import { YouTubeAdapter } from "./youtube-adapter.ts";

export interface RecapTokenResult {
  token: string | null;
  cityId: string | null;
  reason?: "AUTH_EXPIRED" | "ROUTING_VIOLATION" | "NO_TOKEN";
  message?: string;
}

/** Look up the city_id for a city name (case-insensitive). Returns null if not found. */
export async function resolveCityIdByName(
  svc: any,
  cityName: string | null | undefined,
): Promise<string | null> {
  if (!cityName) return null;
  try {
    const { data } = await svc
      .from("cities")
      .select("id")
      .ilike("name", cityName.trim())
      .maybeSingle();
    return data?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Get a valid YouTube access token scoped to the given city when possible.
 * Mirrors the same resolution rules as the Shorts uploader.
 */
export async function getRecapYouTubeToken(
  svc: any,
  userId: string,
  cityName: string | null | undefined,
): Promise<RecapTokenResult> {
  const cityId = await resolveCityIdByName(svc, cityName);
  const adapter = new YouTubeAdapter();
  try {
    // Phase 12E: recaps ALWAYS use OAuth Project B (dedicated quota).
    const token = await adapter.getValidToken(svc, userId, cityId, { contentType: "recap" });
    if (token) return { token, cityId };
    return {
      token: null,
      cityId,
      reason: "AUTH_EXPIRED",
      message: "[AUTH_EXPIRED:youtube_recap] No Project B recap channel connected or refresh token invalid — user must connect a YouTube channel under 'Connect Recaps Channel'.",
    };
  } catch (e) {
    const msg = (e as Error)?.message || String(e);
    if (msg.includes("ROUTING_VIOLATION")) {
      return { token: null, cityId, reason: "ROUTING_VIOLATION", message: msg };
    }
    return { token: null, cityId, reason: "NO_TOKEN", message: msg };
  }
}

/** Find all user_ids that have YouTube connected via either source. */
export async function listYouTubeConnectedUserIds(
  svc: any,
  opts?: { userId?: string },
): Promise<string[]> {
  const ids = new Set<string>();

  // Source 1: new social_accounts table
  let q1 = svc
    .from("social_accounts")
    .select("user_id")
    .eq("platform", "youtube");
  if (opts?.userId) q1 = q1.eq("user_id", opts.userId);
  const { data: rows1 } = await q1;
  for (const r of rows1 || []) if (r?.user_id) ids.add(r.user_id);

  // Source 2: legacy weather_settings columns
  let q2 = svc
    .from("weather_settings")
    .select("user_id, youtube_refresh_token, youtube_access_token")
    .or("youtube_refresh_token.not.is.null,youtube_access_token.not.is.null");
  if (opts?.userId) q2 = q2.eq("user_id", opts.userId);
  const { data: rows2 } = await q2;
  for (const r of rows2 || []) if (r?.user_id) ids.add(r.user_id);

  return Array.from(ids);
}

/**
 * Phase 12CB Fix #3: List the city names a user has connected for recap
 * generation. Prefers the multi-city `user_cities` table (joined to `cities`
 * for the human name). Falls back to the legacy single-city
 * `weather_settings.city` column for users who never adopted multi-city.
 *
 * Returns an empty array when no city info exists — callers should treat
 * that as "process at user level" (single recap, no city filter).
 */
export interface RecapCityDispatchInfo {
  cities: string[];                                  // production-ready cities (kept)
  skipped: Array<{ city: string; reason: string }>;  // cities filtered out + why
  source: "user_cities" | "weather_settings" | "none";
}

export async function listUserRecapCities(
  svc: any,
  userId: string,
): Promise<string[]> {
  const info = await listUserRecapCitiesDetailed(svc, userId);
  return info.cities;
}

/**
 * Phase 12CC-B Fix #2 + #3:
 *  - Filters cities to ONLY those with an enabled automation row
 *    (`automations.enabled = true`). This prevents non-production cities
 *    (e.g. Miami before launch) from being included in recap dispatch.
 *  - Returns structured dispatch info so the caller can audit-log which
 *    cities were skipped and why.
 *
 * Fallback: when the user has no `user_cities` at all, fall back to the
 * legacy `weather_settings.city` value (single-city users).
 */
export async function listUserRecapCitiesDetailed(
  svc: any,
  userId: string,
): Promise<RecapCityDispatchInfo> {
  const kept: string[] = [];
  const skipped: Array<{ city: string; reason: string }> = [];
  let source: RecapCityDispatchInfo["source"] = "none";

  try {
    const { data } = await svc
      .from("user_cities")
      .select("city_id, cities ( name )")
      .eq("user_id", userId);
    const rows = (data || []) as any[];
    if (rows.length > 0) source = "user_cities";

    for (const row of rows) {
      const name = (row?.cities?.name || "").trim();
      const cityId = row?.city_id;
      if (!name || !cityId) continue;
      // Check automation gate
      let enabled = false;
      try {
        const { data: autoRow } = await svc
          .from("automations")
          .select("enabled")
          .eq("user_id", userId)
          .eq("city_id", cityId)
          .maybeSingle();
        enabled = !!autoRow?.enabled;
      } catch {
        enabled = false;
      }
      if (enabled) {
        kept.push(name);
      } else {
        skipped.push({ city: name, reason: "automation_disabled_or_missing" });
      }
    }
  } catch (e) {
    console.warn(`[recap] listUserRecapCities user_cities lookup failed: ${(e as Error).message}`);
  }

  if (source === "none") {
    try {
      const { data } = await svc
        .from("weather_settings")
        .select("city")
        .eq("user_id", userId)
        .maybeSingle();
      const fallback = (data?.city || "").trim();
      if (fallback) {
        kept.push(fallback);
        source = "weather_settings";
      }
    } catch (e) {
      console.warn(`[recap] listUserRecapCities weather_settings fallback failed: ${(e as Error).message}`);
    }
  }

  // De-dup while preserving order
  const seen = new Set<string>();
  const cities = kept.filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
  return { cities, skipped, source };
}

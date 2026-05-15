// Auto-Winner overrides — SAFE injection helper.
//
// Loads the user's three Auto-Winner toggles from `weather_settings` and the
// computed best hook/hour/condition from `winner_stats` for a given city.
// Every read is wrapped in try/catch so a failure here can NEVER break the
// posting pipeline — callers receive `applied = false` and proceed with the
// existing logic unchanged.

export type AutoWinnerOverrides = {
  applied: boolean;
  flags: {
    auto_apply_winning_hook: boolean;
    auto_adjust_post_times: boolean;
    auto_cinematic_for_storms: boolean;
  };
  preferred_hook: string | null;   // e.g. "urgency"
  best_hour: number | null;        // 0..23
  best_condition: string | null;
  // Convenience flags filled in by individual callers describing what was actually applied.
  fields: {
    hook?: string | null;
    time?: number | null;
    cinematic?: boolean | null;
  };
};

const SAFE_DEFAULT: AutoWinnerOverrides = {
  applied: false,
  flags: {
    auto_apply_winning_hook: false,
    auto_adjust_post_times: false,
    auto_cinematic_for_storms: false,
  },
  preferred_hook: null,
  best_hour: null,
  best_condition: null,
  fields: {},
};

export async function getAutoWinnerOverrides(
  supabase: any,
  userId: string,
  city: string | null,
): Promise<AutoWinnerOverrides> {
  if (!userId) return { ...SAFE_DEFAULT };
  try {
    const [{ data: settings }, { data: stats }] = await Promise.all([
      supabase
        .from("weather_settings")
        .select(
          "auto_apply_winning_hook, auto_adjust_post_times, auto_cinematic_for_storms",
        )
        .eq("user_id", userId)
        .limit(1)
        .maybeSingle(),
      city
        ? supabase
            .from("winner_stats")
            .select("best_hook_type, best_hour, best_condition")
            .eq("user_id", userId)
            .ilike("city", city)
            .order("computed_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const flags = {
      auto_apply_winning_hook: !!(settings as any)?.auto_apply_winning_hook,
      auto_adjust_post_times: !!(settings as any)?.auto_adjust_post_times,
      auto_cinematic_for_storms: !!(settings as any)?.auto_cinematic_for_storms,
    };

    const bestHourRaw = (stats as any)?.best_hour;
    const bestHour =
      typeof bestHourRaw === "number" && bestHourRaw >= 0 && bestHourRaw <= 23
        ? bestHourRaw
        : null;

    return {
      applied: false, // caller flips this when at least one override fires
      flags,
      preferred_hook: ((stats as any)?.best_hook_type as string | null) ?? null,
      best_hour: bestHour,
      best_condition: ((stats as any)?.best_condition as string | null) ?? null,
      fields: {},
    };
  } catch (err) {
    console.warn("[auto-winner] override lookup failed; using safe defaults:", err);
    return { ...SAFE_DEFAULT };
  }
}

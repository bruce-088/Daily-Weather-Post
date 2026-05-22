## Root cause

`process-scheduled-posts/index.ts` (line ~3048) calls `pickPresetForDaily({ ..., settings })` and `resolveScene({ ..., settings })` but **no `settings` variable is defined in that scope** — the function never fetches `weather_settings` for the post's user. ReferenceError → "settings is not defined" → scheduled post fails.

`publish-preview-bundle/index.ts` (line ~117) calls the same helpers without a `settings` arg. It doesn't throw today (the module tolerates `undefined`), but per the request we'll wire a safe fetch for consistency.

`daily-weather-post/index.ts` already loads `settings` at line 1522 before the cinematic call at 1959 — that path is fine, but it currently `throw`s when the row is missing. We'll soften that to a safe-default fallback so a missing/erroring settings row never blocks a post.

## Fix

Introduce one shared helper, then call it in all three paths before any cinematic-presets function:

```ts
// _shared/cinematic-presets.ts (add)
export const SAFE_CINEMATIC_DEFAULTS: CinematicSettings = {
  smart_cost_strategy: true,
  strict_visuals_gainesville: true,
  exclude_fallback_from_learning: true,
  auto_cinematic_for_storms: true,
};

export async function loadCinematicSettings(
  supabase: any, userId: string,
): Promise<CinematicSettings & Record<string, unknown>> {
  try {
    const { data, error } = await supabase
      .from("weather_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) {
      console.warn(`[cinematic] settings fetch fallback for ${userId}: ${error?.message ?? "no row"}`);
      return { ...SAFE_CINEMATIC_DEFAULTS };
    }
    return {
      ...SAFE_CINEMATIC_DEFAULTS,
      ...data,
      smart_cost_strategy: data.smart_cost_strategy ?? true,
      strict_visuals_gainesville: data.strict_visuals_gainesville ?? true,
      exclude_fallback_from_learning: data.exclude_fallback_from_learning ?? true,
    };
  } catch (e) {
    console.warn(`[cinematic] settings fetch threw — using defaults:`, (e as Error)?.message);
    return { ...SAFE_CINEMATIC_DEFAULTS };
  }
}
```

### `process-scheduled-posts/index.ts`
- At the top of the per-post processing block (before the cinematic call at ~3048), add:
  ```ts
  const settings = await loadCinematicSettings(supabase, post.user_id);
  ```
- No other behavior changes (voice/caption/scheduling untouched).

### `publish-preview-bundle/index.ts`
- After `userId` is resolved (~line 40), add `const settings = await loadCinematicSettings(supabase, userId);`
- Pass `settings` into both `pickPresetForDaily({ ..., settings })` and `resolveScene({ ..., settings })` at ~117.

### `daily-weather-post/index.ts`
- Replace the hard `throw new Error("No weather settings found...")` at line 1530 with a warn + `settings = { ...SAFE_CINEMATIC_DEFAULTS }` fallback so cinematic calls always have a defined object. Other downstream reads (`settings.city`, `settings.caption_tone`, token columns) keep their existing `?? null` / optional chaining — verify and add `?? requestedCityName` etc. only if missing.

## Out of scope
- No changes to voice, caption, scheduling, routing, or platform adapters.
- No DB migration — missing columns are handled by inline `?? true` defaults.

## Verification
- After edit: re-run a scheduled post via Jobs dashboard for Gainesville and Orlando.
- Check `process-scheduled-posts` logs for `[cinematic] city=... preset=...` (no ReferenceError).
- Confirm `publish-preview-bundle` still publishes a preview bundle end-to-end.
## Current state

Most of the requested work is already in place from a prior pass:

- `_shared/caption-style.ts` already exports `ensureSlotTitlePrefix(baseTitle, slot, city, maxLen=95)` and `inferSlotFromCityHour(city)` exactly per spec (morning → `[8 AM] `, afternoon → `[1 PM] `, evening → `[6 PM] `, strips any existing `[H(:MM)? AM|PM]` prefix, caps at 95 chars).
- `process-scheduled-posts/index.ts` `buildHookTitle` already ends with `ensureSlotTitlePrefix(baseTitle, slot, city)`.
- `daily-weather-post/index.ts` `buildHookTitle` already accepts `slot`, defaults to `"morning"`, and wraps with `ensureSlotTitlePrefix`.
- The legacy `getCityLocalStamp` fallback in title construction has already been removed from both `buildHookTitle` paths.

What is missing vs. the new spec:

1. The `try/catch` fallback in both `buildHookTitle`s returns the raw `baseTitle` (no prefix) if the helper throws — this is the only path that can still emit a title without `[8 AM]/[1 PM]/[6 PM]`.
2. No "Verification Guard" log exists.

## Changes

### A. `supabase/functions/_shared/caption-style.ts`
Add a tiny helper, used by both edge functions and any future caller:

```ts
export function assertSlotTitlePrefix(title: string, context: string = ""): void {
  if (!titleHasTimestamp(title)) {
    console.warn(
      `[title_system] WARNING: Title generated without broadcast slot prefix.${context ? " ctx=" + context : ""} title="${title}"`,
    );
  }
}
```

(`titleHasTimestamp` already exists — checks `^\[\d{1,2}(:\d{2})?\s?(AM|PM)\]`.)

### B. `supabase/functions/process-scheduled-posts/index.ts`
- Import `assertSlotTitlePrefix`.
- In `buildHookTitle`, replace the `catch` branch so it still attempts a hard-coded prefix from `slotTimePrefix(slot, city)` (already imported) before truncating, then call `assertSlotTitlePrefix(result, "process-scheduled-posts:buildHookTitle")` before `return`.
- After the `const title = generateSkyBriefTitle(...)` call at L2296, add one `assertSlotTitlePrefix(title, "process-scheduled-posts:dispatch")` so we also catch any future code path that bypasses `buildHookTitle`.
- Drop the now-unused `getCityLocalStamp` import (it's no longer referenced in title code; keep only if used elsewhere in the file — quick re-grep before removing).

### C. `supabase/functions/daily-weather-post/index.ts`
- Import `assertSlotTitlePrefix` and `slotTimePrefix`.
- Same `catch`-branch hardening as B: build `\`[${slotTimePrefix(slot || "morning", city)}] \` + truncated base` as the last-resort fallback.
- After both `generateSkyBriefTitle(...)` call sites (L1902 and L1938), add `assertSlotTitlePrefix(title, "daily-weather-post")`.
- Ensure the L1902 / L1938 calls pass through a `slot` (default `"morning"` for the daily morning job; if a slot variable is already in scope, use it).
- Drop unused `getCityLocalStamp` import if no other references remain.

### D. `supabase/functions/generate-spec/index.ts`
Add one RESOLVED_ISSUES row:

> `Titles emitted without [8 AM]/[1 PM]/[6 PM] prefix on edge-case fallback paths | Added assertSlotTitlePrefix() guard in _shared/caption-style.ts, hardened buildHookTitle catch branches in process-scheduled-posts and daily-weather-post to force slotTimePrefix() fallback, and added post-call assertions at every title dispatch site.`

No other spec text changes (the slot-prefix system is already documented).

## Out of scope
- No DB changes.
- No changes to `generate-caption` (it does not own title generation — it only consumes/returns captions; the `getCityLocalStamp` import there is used for in-caption beacons, not titles).
- No changes to platform adapters, JSON schemas, or UI.
- No changes to the hook-pool content or selection logic.

## Files touched
- `supabase/functions/_shared/caption-style.ts` (add `assertSlotTitlePrefix`)
- `supabase/functions/process-scheduled-posts/index.ts` (harden catch, add guard call, prune import)
- `supabase/functions/daily-weather-post/index.ts` (harden catch, add guard call, ensure slot pass-through, prune import)
- `supabase/functions/generate-spec/index.ts` (RESOLVED_ISSUES row)

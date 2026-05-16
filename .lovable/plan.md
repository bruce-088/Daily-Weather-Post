## Goal
Guarantee every generated title starts with `[8 AM] `, `[1 PM] `, or `[6 PM] ` — across automated, scheduled, and manual posts — without breaking existing hook quality, hashtags, city/temp injection, or the 95-char cap.

## Root cause
`buildHookTitle` in `process-scheduled-posts/index.ts` already calls `slotTimePrefix(slot, city)`, but:
1. When `slot` is null (scheduled rows without an `[auto:slot]`/`[manual:slot]` marker, manual Post Now without a selected slot, or anything else), `slotTimePrefix` falls back to `getCityLocalStamp(city)` — which can return arbitrary times like `12 PM` or `9:30 AM`, not the required three broadcast slots.
2. `daily-weather-post/index.ts` has its own copy of `buildHookTitle` that does not accept or apply a slot prefix at all.
3. The 95-char truncation in `buildHookTitle` slices the already-prefixed string, so a long base hook can chop the prefix off.

Note: the user's brief mentions `generate-caption`, but that function only writes captions — no title is produced there. Titles are produced exclusively by `buildHookTitle` in `process-scheduled-posts` and `daily-weather-post`. The fix is centralized in those two functions plus the shared helper.

## Changes

### 1. `supabase/functions/_shared/caption-style.ts`
- Add `inferSlotFromCityHour(city)` → returns `"morning" | "afternoon" | "evening"` based on city-local hour:
  - `04:00–10:59` → morning
  - `11:00–15:59` → afternoon
  - `16:00–03:59` → evening
- Tighten `slotTimePrefix(slot, city)`:
  - morning → `"8 AM"`, afternoon → `"1 PM"`, evening → `"6 PM"`
  - any other / null / unknown value → infer slot from city-local hour (above) and return the matching broadcast time. Never return a free-form `getCityLocalStamp` value for titles.
- Add `ensureSlotTitlePrefix(baseTitle, slot, city, maxLen = 95)`:
  - Compute desired prefix `"[8 AM] "` / `"[1 PM] "` / `"[6 PM] "`.
  - If `baseTitle` already starts with any `[H(:MM)? AM|PM]` token (use existing `titleHasTimestamp`), strip it and re-prepend the correct one (no duplication, fixes wrong existing prefix).
  - Prefix sits BEFORE any emoji or text — it is always the first characters.
  - Truncate the base portion (not the prefix) so total length ≤ 95; append `…` when truncated.

### 2. `supabase/functions/process-scheduled-posts/index.ts`
- Replace the inline prefix block inside `buildHookTitle` (lines 286–295) with a single call to `ensureSlotTitlePrefix(baseTitle, slot, city)`.
- Improve slot resolution for `_slotForGen` (~line 2117): pick the first non-null of
  1. `earlyTimePeriod` (from `[auto:slot]` / `[manual:slot]` marker),
  2. `post.slot` column,
  3. inferred slot from current city-local hour.
  Pass that resolved slot to `generateSkyBriefTitle` (already wired at line 2276) and continue feeding the same value to caption personality/beacon (unchanged behavior, just non-null more often).

### 3. `supabase/functions/daily-weather-post/index.ts`
- Add `slot` parameter to `generateSkyBriefTitle` and `buildHookTitle` (default `null`).
- At end of `buildHookTitle`, wrap the chosen `baseTitle` with `ensureSlotTitlePrefix(baseTitle, slot, city)`.
- Update the two callers (lines 1896 and 1932) to pass the slot the daily run is executing (this function is the morning automated job → pass `"morning"`; if the file already resolves a slot elsewhere we'll reuse it).

### 4. No changes to
- `generate-caption` (does not produce titles).
- Caption generation logic, CTA system, routing guard, hashtag handling, temperature injection, city handle sanitizer.
- DB schema. The `post_history.title` column already stores whatever string we write, so the prefix flows through to UI preview, YouTube upload (`title` passed to `postToPlatform`), and history.

## Validation plan
1. Deploy `process-scheduled-posts` and `daily-weather-post`.
2. Insert three test scheduled posts for one city (morning, afternoon, evening slots) and run `process-scheduled-posts` via curl. Confirm:
   - `post_history.title` starts with `[8 AM] ` / `[1 PM] ` / `[6 PM] ` respectively.
   - Length ≤ 95 chars, hashtags and city/temp preserved.
   - YouTube upload payload (log) shows the prefixed title.
3. Trigger a manual Post Now without specifying a slot → confirm the inferred slot prefix matches the current city-local hour bucket.
4. Re-run on a row whose title already had a stale prefix → confirm no duplication.

## Spec impact
Section 6 (Title generation) and Section 14 (Known issues — slot prefix) of the SkyBrief v1.4.0 spec should be updated to reflect that `ensureSlotTitlePrefix` is the single source of truth and that adhoc/manual now infer the slot from city-local time instead of stamping a raw clock value.

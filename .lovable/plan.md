## Root cause

`postToPlatform` in `supabase/functions/_shared/platform-adapter.ts` runs:

```ts
const stripTags = (s: string) =>
  (s || "").replace(/\[[^\]]*\]/g, "")...
const cleanTitle = stripTags(title);
const cleanDescription = stripTags(description);
```

That regex was added to strip internal analytics tags like `[auto:afternoon]` and `[exp:B]`, but it also eats the broadcast-slot prefix (`[8 AM]`, `[1 PM]`, `[6 PM]`) that `ensureSlotTitlePrefix` carefully adds upstream. Every adapter (YouTube, TikTok, Instagram, X, LinkedIn) flows through this function, so the prefix is wiped for all platforms — matching the reported symptom.

`buildHookTitle` and `generateSkyBriefTitle` are returning the prefixed title correctly; it only disappears between `buildHookTitle` output and the adapter `uploadVideo` call.

## Changes

### 1. `supabase/functions/_shared/platform-adapter.ts` — surgical strip + final guard

Replace the blanket `[...]` regex with one that targets only known internal tags, then re-assert the slot prefix as the last step before upload.

- Import `ensureSlotTitlePrefix` and `inferSlotFromCityHour` from `_shared/caption-style.ts`.
- Extend `postToPlatform` signature with two optional params used purely for the final guard:
  - `slot?: "morning" | "afternoon" | "evening" | null`
  - `cityName?: string | null` (for `inferSlotFromCityHour` fallback when `slot` is missing)
- New `stripInternalTags` that only removes a known allow-list:
  ```ts
  const INTERNAL_TAG = /\[(auto|exp|ab|variant|debug|test|pipeline|engine|voice|render|src):[^\]]*\]/gi;
  const stripInternalTags = (s: string) =>
    (s || "").replace(INTERNAL_TAG, "").replace(/[ \t]{2,}/g, " ").replace(/\s+\n/g, "\n").trim();
  ```
  Slot prefixes like `[8 AM]`, `[1 PM]`, `[6 PM]` no longer match and survive.
- After `stripInternalTags`, re-wrap title with `ensureSlotTitlePrefix(cleanTitle, slot ?? null, cityName ?? null)` as the final guard.
- Add the lifecycle debug logs the user requested:
  ```ts
  console.log("[title_debug] postToPlatform received title:", title);
  console.log("[title_debug] after stripInternalTags:", cleanTitle);
  console.log("[title_debug] final title sent to", adapter.name, ":", cleanTitle);
  ```
- If `assertSlotTitlePrefix` exists in `caption-style.ts` (from prior pass), call it on the final title for the existing warning channel.

### 2. Pass `slot` + `cityName` from the two callers

So the final guard can always rebuild the prefix even if upstream somehow lost it.

- `supabase/functions/process-scheduled-posts/index.ts` — every `postToPlatform(...)` call site: pass the post's `slot` (already in scope from the scheduled-post row) and `cityName`.
- `supabase/functions/daily-weather-post/index.ts` — pass `"morning"` (the daily job is always the morning slot) and `cityName`.
- `supabase/functions/upload-preview-video/index.ts` — pass `null` for slot (let the adapter infer from city hour) and `resolvedCityName`.

No other callers of `postToPlatform` exist (verified via the registry — those three files plus the adapters themselves).

### 3. `supabase/functions/generate-spec/index.ts` — RESOLVED_ISSUES delta

Add one row:

> Slot time prefix `[8 AM]/[1 PM]/[6 PM]` stripped from published titles | `postToPlatform` in `_shared/platform-adapter.ts` was running `replace(/\[[^\]]*\]/g, "")` to strip internal tags and accidentally removed the broadcast-slot prefix on every platform. Replaced with an allow-list regex that only matches known internal tags (`auto`, `exp`, `ab`, `variant`, `debug`, `test`, `pipeline`, `engine`, `voice`, `render`, `src`), then re-applies `ensureSlotTitlePrefix` as a final guard immediately before adapter upload. Added `[title_debug]` lifecycle logs at three checkpoints (buildHookTitle output, generateSkyBriefTitle output, final title sent to YouTube/TikTok/IG/X/LinkedIn).

## Verification

1. Deploy `process-scheduled-posts`, `daily-weather-post`, `upload-preview-video`, `generate-spec`.
2. Trigger one manual post via "Post Now".
3. Confirm log sequence:
   - `[title_debug] buildHookTitle output: [1 PM] …`
   - `[title_debug] postToPlatform received title: [1 PM] …`
   - `[title_debug] after stripInternalTags: [1 PM] …`
   - `[title_debug] final title sent to youtube: [1 PM] …`
4. Confirm published YouTube title shows `[1 PM]` prefix.

## Out of scope

- No DB / schema changes.
- No changes to caption body handling (only title).
- No changes to hook generation or `ensureSlotTitlePrefix` itself.
- Adapters unchanged — fix is centralized in `postToPlatform`.

## Files touched

- `supabase/functions/_shared/platform-adapter.ts`
- `supabase/functions/process-scheduled-posts/index.ts` (pass slot/city to postToPlatform; add buildHookTitle debug log)
- `supabase/functions/daily-weather-post/index.ts` (pass slot/city; add buildHookTitle debug log)
- `supabase/functions/upload-preview-video/index.ts` (pass slot=null/city)
- `supabase/functions/generate-spec/index.ts` (RESOLVED_ISSUES row)

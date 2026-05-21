## Goal
Make the caption blacklist match "Weather Update" even when spacing/casing varies (e.g. "WeatherUpdate", "Weather  Update", "weather update").

## Change (single file: `supabase/functions/generate-caption/index.ts`, ~lines 658–670)

Inside the existing `for (const term of BLACKLIST)` loop, build the term regex so internal whitespace becomes `\s*` instead of a literal space. This makes every CTA pattern (and not just "Weather Update") space-insensitive automatically.

Replacement logic:

```ts
const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// NEW: allow any (or no) whitespace between the words of the blacklisted term
const escFlex = esc.replace(/\\?\s+/g, "\\s*");
const noSpace = term.replace(/\s+/g, "");
const escNoSpace = noSpace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ctaPatterns: Array<{ re: RegExp; sub: string }> = [
  { re: new RegExp(`\\benjoying the weather in ${escFlex}(?=[^a-zA-Z]|$)`, "gi"),
    sub: `enjoying the weather in ${city}` },
  { re: new RegExp(`\\bweather in ${escFlex}(?=[^a-zA-Z]|$)`, "gi"),
    sub: `weather in ${city}` },
  { re: new RegExp(`\\bdaily ${escFlex} weather alerts(?=[^a-zA-Z]|$)`, "gi"),
    sub: `daily ${city} weather alerts` },
  { re: new RegExp(`\\bdaily ${escFlex} updates(?=[^a-zA-Z]|$)`, "gi"),
    sub: `daily ${city} updates` },
  { re: new RegExp(`\\bfollow for ${escFlex} updates(?=[^a-zA-Z]|$)`, "gi"),
    sub: `follow for ${city} updates` },
  { re: new RegExp(`\\bsubscribe for ${escFlex} weather alerts(?=[^a-zA-Z]|$)`, "gi"),
    sub: `subscribe for ${city} weather alerts` },
];
```

Notes on the user-supplied snippet:
- It used single-backslash `\b` / `\s*` inside a regular string literal, which would not produce real regex metachars. The plan uses double-escaped `\\b` / `\\s*` to match the existing file style.
- It only covered the "Weather Update" term, but the same fix applies cleanly to every blacklist term by deriving `escFlex` from `esc`.
- Hashtag handling already uses `escNoSpace`, so it already tolerates the no-space variant — no change needed there.

## Spec / Living Doc
- Update `supabase/functions/generate-spec/index.ts` Sanitization section: note that blacklist CTA matching is now whitespace-insensitive (`Weather Update`, `WeatherUpdate`, `Weather  Update` all sanitized).

## Verification
- Deploy `generate-caption`.
- Run generate-caption for Gainesville; confirm `[generate-caption] blacklist proxy terms replaced` log fires for a synthetic input containing `weather in WeatherUpdate`.
- Inspect `system_logs` rows of type `caption_blacklist_sanitized`.

## Out of scope
- No changes to narration sanitization, hashtag rules, or other edge functions.
- No schema changes.
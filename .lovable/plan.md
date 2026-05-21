# Caption Blacklist CTA Punctuation Fix

## Problem
The context-bound blacklist at `supabase/functions/generate-caption/index.ts` (lines 662–667) uses `\b` at the end of each CTA pattern. When the AI appends `!` or `.` directly after a proxy term (e.g. `weather in Weather Update!`), `\b` fails to match in the expected position and the proxy leaks through. The hashtag path and `system_logs` writer already work and stay untouched.

## Changes

### 1. `supabase/functions/generate-caption/index.ts` — `ctaPatterns` (lines 662–667)
Swap trailing `\b` for a non-consuming lookahead `(?=[^a-zA-Z]|$)` on all four existing patterns, and add the two new high-priority patterns.

New array (6 entries, same `sub` style as today):

```ts
const ctaPatterns: Array<{ re: RegExp; sub: string }> = [
  { re: new RegExp(`\\benjoying the weather in ${esc}(?=[^a-zA-Z]|$)`, "gi"),
    sub: `enjoying the weather in ${city}` },
  { re: new RegExp(`\\bweather in ${esc}(?=[^a-zA-Z]|$)`, "gi"),
    sub: `weather in ${city}` },
  { re: new RegExp(`\\bdaily ${esc} weather alerts(?=[^a-zA-Z]|$)`, "gi"),
    sub: `daily ${city} weather alerts` },
  { re: new RegExp(`\\bdaily ${esc} updates(?=[^a-zA-Z]|$)`, "gi"),
    sub: `daily ${city} updates` },
  { re: new RegExp(`\\bfollow for ${esc} updates(?=[^a-zA-Z]|$)`, "gi"),
    sub: `follow for ${city} updates` },
  { re: new RegExp(`\\bsubscribe for ${esc} weather alerts(?=[^a-zA-Z]|$)`, "gi"),
    sub: `subscribe for ${city} weather alerts` },
];
```

The longer `enjoying the weather in …` pattern is placed before the bare `weather in …` so the more specific match wins on the first pass; functionally both still resolve to the city, so order is defensive only.

### 2. `locationGuard` slot-timing guard (around line 406)
Append one new bullet to the existing `locationGuard` template literal so the LLM is explicitly told slot words are never a city substitute:

```
- If you mention the broadcast slot (Morning, Afternoon, Evening), it must be purely descriptive of the timeframe and NEVER used as a replacement for the city name "${city}".
```

### 3. Logging
No changes needed — the existing `system_logs.insert({ type: "caption_blacklist_sanitized", ... })` block at lines 686–699 already records every hit, including the new patterns, because they flow through the same `blacklistHits` accumulator.

## Out of scope
- No DB / schema / RLS changes.
- No UI changes.
- No edits to `fixInvalidLocation`, `forceCitySanity`, hashtag regex, or any other sanitizer.
- No changes to `generate-spec` (spec delta will be added in a follow-up turn after this lands, per established workflow).

## Files touched
- `supabase/functions/generate-caption/index.ts` (one block replaced, one bullet added)

## Deploy
- Redeploy `generate-caption` only.

## Verification
- Confirm `weather in Weather Update!` → `weather in Gainesville!` (punctuation preserved).
- Confirm `enjoying the weather in Coming Up.` → `enjoying the weather in Gainesville.`.
- Confirm narration like `clear skies over the bay` remains untouched (no CTA slot match).
- Confirm a `caption_blacklist_sanitized` row appears in `system_logs` listing the hit term.

## Goal
Replace the hardcoded `forceCitySanity` blacklist in `generate-caption/index.ts` with a **whitelist** approach that positively enforces the city name in location slots, catching any future variant the AI might invent.

## Change
**File: `supabase/functions/generate-caption/index.ts`**

Replace the existing `forceCitySanity` function (lines 66–81, plus the old regex approach at lines 51–61 which is now superseded) with a strict whitelist implementation:

- **Regex 1** (`weatherInRegex`): Matches anything after `"weather in "` that is NOT exactly the city name (up to end of sentence/line) and forces it to `weather in ${city}`.
- **Regex 2** (`alertsRegex`): Matches anything between `"daily "` and `" weather alerts"` that is NOT exactly the city name and forces it to `daily ${city} weather alerts`.
- This catches `"weather in Weather Update"`, `"weather in But Comfortable"`, and any future hallucination without adding more hardcoded patterns.
- Keeps integration point identical: runs as the final step in the cleanup chain.

## Verification
The positive-match regex will be tested against known bad outputs:
- `"weather in Coming Up"` → `"weather in Gainesville"`
- `"weather in But Comfortable"` → `"weather in Gainesville"`
- `"daily Weather Update weather alerts"` → `"daily Gainesville weather alerts"`
- Preserves correct phrasing: `"weather in Gainesville"` stays untouched.

## Out of Scope
- No other caption logic, system prompt, or CTA block changes.
- No spec doc updates (this is a code-level defensive fix; spec already documents the sanitizer concept).

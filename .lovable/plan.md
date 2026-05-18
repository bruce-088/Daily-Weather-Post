## Goal
Activate Growth Phase 1: shift `generate-caption` from descriptive output to high-CTR, action-oriented growth content. Layer aggressive hooks, heat-index action triggers, curiosity-gap framing, and landmark context, plus boost analytics-winning patterns to 80% frequency. Confirm `forceCitySanity` is the strict whitelist.

## Changes
**File: `supabase/functions/generate-caption/index.ts`**

### 1. forceCitySanity — verify only (no change)
Current implementation (lines 63–84) already matches the spec exactly:
- `weather in (?!${escapedCity}\b)[^.!\n]+` → `weather in ${city}`
- `daily (?!${escapedCity}\b)[^.!\n]+?(?= weather alerts)` → `daily ${city}`
- Final cleanup chain order is already `cleanWeatherPhrasing → fixInvalidLocation → forceCitySanity`.
No edit needed. Mention in spec for completeness.

### 2. Hook Aggression Layer (new `hookAggressionBlock`)
Build a new prompt block injected into `userPrompt` alongside Diversity Guard / Focus Angle / Local Voice. It will contain four directives:

**a. First-sentence rule** — "The first sentence MUST be an Instructional or Situational hook (action verb or 'if you're …' setup). NOT a data report. Human relatability outranks data reporting."

**b. Heat-action trigger** — computed at request time from `highTemp` / `feels_like` (use the existing `highTemp` variable already derived at L260, plus optional `body.feels_like` / `heat_index`):
- if temp > 88°F **or** heat index > 95°F → inject: `HEAT ACTION REQUIRED: Open with a high-intensity action hook. Pick one tone: "Crank the AC", "Pool day is on", "Hydrate early", "Find shade by noon".`
- if temp < 40°F → inject cold counterpart: `COLD ACTION: Open with "Layer up", "Warm the car early", "Bundle the kids".`
- otherwise no trigger.

**c. Curiosity Gap** — "When morning and evening conditions diverge meaningfully (≥10°F swing OR different condition family), use the pattern: `Don't let the [Morning Weather] fool you, [Evening Weather] is coming.` Use this at most once per caption."
- Computed automatically if `morning_temp`/`evening_temp` differ ≥10°F or `morning_condition` ≠ `evening_condition` family — adds the directive; otherwise just gives it as an option.

**d. Landmark Context Injection** — "Use one landmark from VERIFIED LANDMARKS in the first 3 seconds when natural: `If you're heading to [Landmark] today, heads up — …`. One landmark max. Do not invent locations."

The block is wrapped in the existing fail-safe try/catch (same pattern as `personalityBlock`/`localVoiceBlock`) so any error silently drops it.

### 3. Analytics-Driven Weighting (winningThemes → 80% exploit)
**File: `supabase/functions/_shared/learning-patterns.ts`**

In `buildLearningPromptBlock`, replace the static 70/30 split with a dynamic ratio:
- If `winningThemes` exists and contains an "Action Hooks" or "Action Titles" entry, OR if any `provenWins` entry has `variable === "hook_type"` and `winRate ≥ 0.6`, set `explore = Math.random() < 0.2` (i.e. 80% exploit) and append a new line to the EXPLOITATION block:
  `"ACTION DOMINANCE: Action hooks/titles win in your analytics — use one in 4 of every 5 posts."`
- Otherwise keep existing 70/30.

Implemented locally to the function (no signature change, no DB writes).

### 4. Spec Documentation
**File: `supabase/functions/generate-spec/index.ts`**

- Add a new subsection under Caption Generation System titled **"Hook Aggression Layer (Growth Phase 1)"** documenting:
  - First-sentence Instructional/Situational rule
  - Heat-action triggers (>88°F or HI >95°F)
  - Cold-action counterpart (<40°F)
  - Curiosity Gap template ("Don't let the X fool you, Y is coming")
  - Landmark Context Injection (first 3 seconds)
- Add bullet to Learning Feedback Loop subsection: dynamic 80/20 exploit ratio when Action Hooks/Titles are detected as winners.
- Add one `RESOLVED_ISSUES` row: *"Descriptive captions underperforming on CTR | Added Growth Phase 1 Hook Aggression Layer: instructional/situational first sentence, heat/cold action triggers, curiosity-gap template, landmark injection; dynamic 80/20 exploit ratio when winningThemes shows Action Hooks/Titles."*

## Cleanup chain (verified, no change)
`cleanWeatherPhrasing` → `fixInvalidLocation` → `forceCitySanity` — already wired.

## Out of Scope
- No DB migrations.
- No new tables, no new edge functions.
- No changes to ElevenLabs / Creatomate / platform adapters.
- No changes to JSON response schema returned to callers.
- Existing tone / variation / style / personality blocks unchanged.

## Files Touched
- `supabase/functions/generate-caption/index.ts` (add `hookAggressionBlock`, inject into `userPrompt`)
- `supabase/functions/_shared/learning-patterns.ts` (dynamic exploit ratio when Action Hooks win)
- `supabase/functions/generate-spec/index.ts` (spec doc + RESOLVED_ISSUES row)

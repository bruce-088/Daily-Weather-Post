## Local Voice Layer for Captions

Add a "LOCAL VOICE" block to the caption prompt so output sounds like a casual local, not a forecast. No structural, length, or CTA changes.

### File: `supabase/functions/generate-caption/index.ts`

**1. Build a new prompt block (alongside `diversityBlock`, `focusBlock`, etc.) around line 379:**

```ts
const localVoiceBlock = `LOCAL VOICE:
Write like a local in ${city} speaking casually, not a weather report.
- Avoid formal phrases like "conditions remain", "forecast indicates", "expect", "anticipate".
- Prefer natural openers: "Looks like...", "Feels like...", "Heads up...", "You might notice...".
- Reference time naturally: "this afternoon", "later tonight", "heading into the evening".
- Conversational and slightly informal, still clear.

MICRO-LOCALIZATION (only when it fits naturally — never force):
- Hot/humid → hydration, AC, pool weather.
- Rain/storms → umbrella, wet commute, slick roads.
- Clear/mild → great night to get outside, sunset, evening plans.
- Cold/windy → layers, jacket weather.

OPENER VARIATION:
Do NOT always start with the city name ("${city}..."). Rotate among:
- Weather-first ("Clouds rolling in over ${city}...")
- Feeling-first ("Feels like a slow afternoon...")
- Situation-first ("Heads up if you're commuting home...")

HARD CONSTRAINTS (do not override):
- Keep within current length limits.
- Keep the CTA line exactly as required by CTA ROTATION above.
- Do not change title / body / hashtag block structure.`;
```

Wrap in the existing try/catch so any failure leaves `localVoiceBlock = ""` (fail-safe parity with the other blocks).

**2. Inject into `userPrompt` (around line 425), after `focusBlock` and before `personalityBlock`** so CTA rules still appear last and dominate:

```ts
${focusBlock}

${localVoiceBlock}

${personalityBlock}

${ctaBlock}${antiRepeatBlock ? `\n\n${antiRepeatBlock}` : ""}`;
```

### Out of scope
- No changes to `SKYBRIEF_SYSTEM_PROMPT`, `rotatingCTA`, structure rules, length caps, `cleanWeatherPhrasing`, or any other function.
- No DB / schema / UI changes.

### Spec Delta (applied same turn after approval)
Update `supabase/functions/generate-spec/index.ts`:
- Add a "Local Voice Layer" subsection under `CAPTION_SYSTEM` describing the local voice rules, micro-localization triggers, opener rotation, and hard constraints (CTA + structure preserved).
- Add a row to `RESOLVED_ISSUES` noting captions previously sounded like formal forecasts; now use casual local phrasing with optional lifestyle context.

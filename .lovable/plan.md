## Goal
Stop the AI from filling `"enjoying the weather in ___"` and `"daily ___ weather alerts"` with weather conditions (e.g. "Clear Skies", "But Comfortable") instead of the city name.

## File
`supabase/functions/generate-caption/index.ts`

## Changes

### 1. Expand BLACKLIST (line 654)
Replace the 5-term array with the full 39-term list provided (adds weather conditions: Sunny, Cloudy, Overcast, Rainy, Stormy, Foggy, Windy, Humid, Hot, Cold, Warm, Cool, Mild, Breezy, Partly Cloudy, Mostly Cloudy, Mostly Sunny, Partly Sunny, Scattered Showers, Thunderstorms, Drizzle, Light Rain, Heavy Rain, Snow, Sleet, Haze, Mist, Hazy, Showers, Afternoon, Morning, Evening, Tonight, Today, Ahead, Update).

The existing context-bound CTA loop (lines 666–688) will then also catch these as proxy terms — narration like "clear skies over the bay" stays untouched because matching is still bound to CTA slots / hashtags only.

### 2. Add nuclear fallback regex (after the BLACKLIST loop closes at line 708, before the city-handle sanitizer at line 709)
Catches ANY non-city word in the slot, even ones we didn't enumerate:

```ts
const cityEsc = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const enjoyingRe = new RegExp(
  `(enjoying the weather in )(?!${cityEsc}\\b)([^!.\\n]+)`,
  'gi'
);
if (enjoyingRe.test(caption)) {
  console.warn(`[generate-caption] nuclear fallback: "enjoying the weather in" wrong location for ${city}`);
  caption = caption.replace(enjoyingRe, `$1${city}`);
}

const dailyAlertsRe = new RegExp(
  `(daily )(?!${cityEsc}\\b)([^\\n]+?)( weather alerts)`,
  'gi'
);
caption = caption.replace(dailyAlertsRe, `$1${city}$3`);
```

### 3. Add explicit CTA rule to SKYBRIEF_SYSTEM_PROMPT
Append to the STYLE RULES block (around line 189) a new bullet:
> CRITICAL: In the line "Smash the LIKE button if you're enjoying the weather in ___", the blank MUST be filled with the exact city name (e.g. "Gainesville", "Orlando"). NEVER use a weather condition, tone label, or any other word in this slot.

### 4. Deploy
Deploy the `generate-caption` edge function after the edits.

## Safety
- All replacements remain context-bound to CTA phrasing — descriptive narration (e.g. "clear skies tonight") is unaffected.
- Logs use the existing `[generate-caption]` prefix and `system_logs` insert path for observability.
- No schema, no other files touched.

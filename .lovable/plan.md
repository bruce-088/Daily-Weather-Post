## Fix Invalid Location Substitution in CTA

Captions sometimes render style/variation labels (e.g. "But Comfortable") inside `weather in ___`. Fix with a prompt guardrail + a post-generation sanitizer. Pure prompt + string-fix change; structure/CTA shape untouched.

### File: `supabase/functions/generate-caption/index.ts`

**1. Prompt guardrail (CTA section)**
- The CTA constraints are added via `ctaBlock` around line 357 (after `rotatingCTA`). Append a critical-location line so the constraint travels with every CTA:

```ts
ctaBlock = _cta
  ? `CTA ROTATION: For the final call-to-action line, use this exact CTA (or a close paraphrase): "${_cta}". Do not invent additional CTAs.\nCRITICAL: The phrase "weather in [X]" must ONLY use the actual city name (${city}). Never use style names, weather conditions, tone labels, or variation labels as a location.`
  : `CRITICAL: The phrase "weather in [X]" must ONLY use the actual city name (${city}). Never use style names, weather conditions, tone labels, or variation labels as a location.`;
```

**2. Post-processing sanitizer**
- Add helper near `cleanWeatherPhrasing` (top of file):

```ts
function fixInvalidLocation(text: string, city: string): string {
  if (!city) return text;
  const escapedCity = city.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Replace "weather in <anything>" where <anything> is not already the city
  const re = new RegExp(`\\bweather in (?!${escapedCity}\\b)[A-Za-z][A-Za-z\\s'-]{0,40}`, "gi");
  return text.replace(re, `weather in ${city}`);
}
```

- Invoke in the final safety net, right after `cleanWeatherPhrasing(caption)` (around current line 491):

```ts
caption = cleanWeatherPhrasing(caption);
caption = fixInvalidLocation(caption, city);
```

### Out of scope
- No changes to CTA rotation pool, structure blocks, length, tone, hashtags, system prompt, or other functions.
- No DB/UI changes.

### Spec Delta (applied same turn after approval)
Update `supabase/functions/generate-spec/index.ts`:
- Extend the **Phrasing Cleaner (Post-Generation)** subsection to mention `fixInvalidLocation` — regex `\bweather in (?!<city>)[A-Za-z…]+` rewrites bad substitutions back to the canonical city; runs after `cleanWeatherPhrasing` in the final safety net.
- Note CTA prompt now carries a CRITICAL location guardrail forbidding style/condition/variation labels in `weather in ___`.
- Add a `RESOLVED_ISSUES` row: "Style/variation labels appearing as locations in CTA (e.g. 'weather in But Comfortable') → fixed via CTA guardrail + `fixInvalidLocation` sanitizer."

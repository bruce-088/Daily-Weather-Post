## Block style/variation labels from appearing as locations in CTA & hashtags

Adds a hardcoded "no-fly zone" sanitizer on top of the existing `fixInvalidLocation` guard, plus a stronger CTA prompt instruction.

### Changes in `supabase/functions/generate-caption/index.ts`

**1. New helper `forceCitySanity(text, city)`** (added next to `fixInvalidLocation`, ~line 43):

```ts
function forceCitySanity(text: string, city: string): string {
  if (!city) return text;
  const badPatterns = ["Coming Up", "But Comfortable", "Clear Skies", "Rain", "Clouds", "Ahead"];
  let cleaned = text;
  badPatterns.forEach((pattern) => {
    cleaned = cleaned.replace(new RegExp(`weather in ${pattern}\\b`, "gi"), `weather in ${city}`);
    cleaned = cleaned.replace(new RegExp(`daily ${pattern} weather alerts`, "gi"), `daily ${city} weather alerts`);
  });
  return cleaned;
}
```

Note: `pattern` strings here are fixed literals (no user input), so a regex-escape pass isn't required, but I'll wrap them in `\b` boundaries where useful to avoid partial matches.

**2. CTA prompt guard** (append to `ctaBlock` around line 365, alongside the existing CRITICAL line):
> "In the CTA block, the only valid location is `${city}`. Do NOT use any style name, variation label, or weather condition (e.g. 'Coming Up', 'But Comfortable', 'Clear Skies') as a location. `weather in ___` and `daily ___ weather alerts` must always use `${city}`."

**3. Wire into cleanup chain** (after line 530, final step before returning):
```ts
caption = forceCitySanity(caption, city);
```

Order becomes: `cleanWeatherPhrasing` → `fixInvalidLocation` → `forceCitySanity`.

### Spec delta in `supabase/functions/generate-spec/index.ts`
- Extend the **Phrasing Cleaner (Post-Generation)** subsection to document `forceCitySanity` as the final hardcoded no-fly-zone pass covering both `weather in <bad>` and `daily <bad> weather alerts`, listing the blocked patterns.
- Add a `RESOLVED_ISSUES` row: "Style/variation labels leaking into hashtag-style 'daily X weather alerts' phrasing".

### Out of scope
No changes to CTA structure, hashtags content, length limits, system prompt, or other functions.

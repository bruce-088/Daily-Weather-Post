## Caption Phrasing Cleaner (Pattern-Based)

### File: `supabase/functions/generate-caption/index.ts`

**1. Add helper near the top of the file (after imports, before `HANDLE_MAP`):**

```ts
function cleanWeatherPhrasing(text: string): string {
  return text
    .replace(/\bin\s+(clear skies|rain|clouds|sunshine|snow|thunderstorms|fog|wind)\b/gi, (_m, p1) => {
      const lower = String(p1).toLowerCase();
      if (lower.includes("cloud")) return "with cloudy conditions";
      if (lower.includes("rain")) return "with rain";
      if (lower.includes("sun")) return "with sunshine";
      if (lower.includes("snow")) return "with snow";
      if (lower.includes("storm")) return "with storms";
      if (lower.includes("fog")) return "with fog";
      if (lower.includes("wind")) return "with windy conditions";
      if (lower.includes("clear")) return "with clear skies";
      return p1;
    })
    .replace(/\s{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}
```

**2. Invoke it after `stripUnverifiedReferences` and before the timestamp stamp block (around line 471):**

```ts
caption = stripUnverifiedReferences(caption, city);
caption = cleanWeatherPhrasing(caption);
```

Handle sanitizer and timestamp stamp logic remain unchanged and run after the cleaner.

### Out of scope
- No prompt changes, no structural changes, no tone/CTA logic, no other functions, no DB.
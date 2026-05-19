## Goal
Stop AI-hallucinated location proxies ("Not Need", "Weather Update", "Coming Up", "But Comfortable", "Clear Skies") from leaking into CTA blocks and hashtags — WITHOUT clobbering legitimate weather narration (e.g. "clear skies over the bay" must survive).

## Changes

### 1. `supabase/functions/generate-caption/index.ts` — Context-bound Global Proxy Replacement

Insert immediately after the existing `forceCitySanity(caption, city)` call (line 626), before the `@SkyBrief` handle sanitizer block (line 630):

```ts
// GLOBAL PROXY REPLACEMENT — final guard, CONTEXT-BOUND.
// Only replaces blacklist terms when they appear in CTA/location slots
// or as hashtags. Descriptive narration (e.g. "clear skies over the bay")
// is intentionally left alone.
const BLACKLIST = ["Not Need", "Weather Update", "Coming Up", "But Comfortable", "Clear Skies"];
const cityNoSpaces = city.replace(/\s+/g, "");
const blacklistHits: string[] = [];

for (const term of BLACKLIST) {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const noSpace = term.replace(/\s+/g, "");
  const escNoSpace = noSpace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // CTA/location slot patterns (case-insensitive)
  const ctaPatterns: Array<{ re: RegExp; sub: string }> = [
    { re: new RegExp(`\\bweather in ${esc}\\b`, "gi"),                 sub: `weather in ${city}` },
    { re: new RegExp(`\\bdaily ${esc} weather alerts\\b`, "gi"),       sub: `daily ${city} weather alerts` },
    { re: new RegExp(`\\bfollow for ${esc} updates\\b`, "gi"),         sub: `follow for ${city} updates` },
    { re: new RegExp(`\\bsubscribe for ${esc} weather alerts\\b`, "gi"), sub: `subscribe for ${city} weather alerts` },
  ];
  for (const { re, sub } of ctaPatterns) {
    if (re.test(caption)) {
      blacklistHits.push(`${term} (cta)`);
      caption = caption.replace(re, sub);
    }
  }

  // Hashtag pattern — only the compressed form (e.g. #NotNeed, #ClearSkies)
  const tagRe = new RegExp(`#${escNoSpace}\\b`, "gi");
  if (tagRe.test(caption)) {
    blacklistHits.push(`${term} (hashtag)`);
    caption = caption.replace(tagRe, `#${cityNoSpaces}`);
  }
}

// Hashtag de-duplication after replacement: prevent ##Gainesville / # Gainesville
caption = caption
  .replace(new RegExp(`##+${cityNoSpaces}`, "gi"), `#${cityNoSpaces}`)
  .replace(new RegExp(`#\\s+${cityNoSpaces}`, "gi"), `#${cityNoSpaces}`);

if (blacklistHits.length > 0) {
  console.warn(`[generate-caption] blacklist proxy terms replaced for ${city}:`, blacklistHits);
  try {
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await svc.from("system_logs").insert({
      user_id: auth.userId,
      type: "caption_blacklist_sanitized",
      message: `Replaced proxy term(s) ${blacklistHits.join(", ")} → ${city}`,
      context: { city, hits: blacklistHits },
    });
  } catch { /* best-effort */ }
}
```

Order rationale: runs AFTER `stripUnverifiedReferences` / `cleanWeatherPhrasing` / `fixInvalidLocation` / `forceCitySanity`, BEFORE the `@SkyBrief` handle sanitizer so handle rules still get last word on `@`-tokens.

### 2. Prompt hardening — `locationGuard` at line 402

Replace with:

```ts
const locationGuard = `CRITICAL LOCATION RULE (highest priority):
- The ONLY valid location string anywhere in the caption is "${city}".
- The strings "Not Need", "Weather Update", "Coming Up", "But Comfortable", "Clear Skies", or any style/tone/variation label, or any weather condition word (Rain, Clouds, Sunny, Ahead, etc.) must NEVER appear as a location.
- Every time you refer to the location — in body text, CTA, hashtags, or anywhere else — you MUST use exactly "${city}".
- "weather in [X]" and "daily [X] weather alerts" MUST always use "${city}".`;
```

### 3. `supabase/functions/generate-spec/index.ts` — RESOLVED_ISSUES delta

Append one row:

> AI captions leaked hallucinated location proxies ("Not Need", "Weather Update", "Coming Up", "But Comfortable", "Clear Skies") into CTA blocks and hashtags despite `forceCitySanity` | Root cause: `forceCitySanity` only rewrites two slot phrases ("weather in __" / "daily __ weather alerts"); proxies appearing in other CTA slots ("follow for __ updates", "subscribe for __ weather alerts") and in hashtags (`#NotNeed`, `#ClearSkies`) slipped through. Fix: added a final CONTEXT-BOUND Global Proxy Replacement pass in `generate-caption/index.ts` that rewrites the blacklist ONLY inside the four CTA slot patterns and hashtag tokens (descriptive narration like "clear skies over the bay" is intentionally preserved), plus a hashtag de-dup pass to collapse `##` / `# ` artifacts. Tightened the `locationGuard` system-prompt rule to forbid those exact strings and style/tone/weather words as locations. Logs to `system_logs` (`caption_blacklist_sanitized`) when any hit fires.

## Files touched
- `supabase/functions/generate-caption/index.ts` (one insert at ~line 626, one prompt edit at line 402)
- `supabase/functions/generate-spec/index.ts` (RESOLVED_ISSUES row)

## Out of scope
- No DB / schema / RLS changes, no UI changes.
- No edits to `forceCitySanity`, `stripUnverifiedReferences`, or other shared sanitizers (additive only).
- Blacklist stays inline (single call site).

## Verification
1. Deploy `generate-caption` + `generate-spec`.
2. Trigger Post Now for Gainesville and inspect output:
   - "weather in Not Need" → "weather in Gainesville" ✓
   - "daily Clear Skies weather alerts" → "daily Gainesville weather alerts" ✓
   - "Follow for Weather Update updates" → "Follow for Gainesville updates" ✓
   - "#NotNeed #ClearSkies" → "#Gainesville #Gainesville" ✓
   - Body text "clear skies over Depot Park" → UNCHANGED ✓
3. Confirm `system_logs` rows of type `caption_blacklist_sanitized` when hits fire.

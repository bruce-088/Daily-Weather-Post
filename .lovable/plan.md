

## Plan: SkyBrief Video & Caption System Upgrade

This updates the Creatomate video template, Pexels search strategy, dynamic handle system, and caption prompt across both edge functions.

---

### 1. Improved Gradient Overlay for Readability

**Current**: Single heavy overlay using theme-colored hex with alpha suffixes.

**New**: Replace with a 3-zone gradient matching the spec:
- Top: `rgba(0,0,0,0.35)` — protects city/brand text
- Middle: `rgba(0,0,0,0.25)` — keeps temperature readable without killing background
- Bottom: `rgba(0,0,0,0.45)` — protects detail card and CTA

This is theme-independent, ensuring consistent readability on any bright background.

---

### 2. Glass Panels Behind Key Text Areas

**City header panel**: Add a rounded rectangle behind city name area:
- `rgba(0,0,0,0.35)`, border-radius 14, backdrop-blur equivalent styling, positioned at the city/date section (~y 14-23%)

**Detail card update**: Change panel background from current `theme.panelBg` (~0.82 opacity) to `rgba(10,15,30,0.65)` with subtle border, matching the spec's frosted-glass look.

---

### 3. Typography & Text Shadow

Add `shadow` property to all text elements: `"0px 1px 4px rgba(0,0,0,0.4)"`.

Update font weights to match spec:
- City: 800 (already correct)
- Temperature: 900 (already correct)
- Condition: 600 (already correct)
- Supporting info: 500 (already correct)

---

### 4. Pexels Search — Local Landmark Priority

Update `fetchPexelsVideoUrl` search tiers to prioritize landmarks:
1. `"{city} skyline landmark"` — prioritize recognizable city imagery
2. `"{city} {keyword}"` — city + weather condition (existing)
3. `"{region} {keyword}"` — region fallback (existing)
4. `"{keyword}"` — generic fallback (existing)

This adds one additional search tier before the existing logic.

---

### 5. Dynamic City Handle System

Add a `getDynamicHandle(city)` helper function:

```text
Known handles map:
  Gainesville → @SkyBriefGNV
  Miami → @SkyBriefMiami
  Orlando → @SkyBriefOrlando
  Tampa → @SkyBriefTampa

Fallback: @SkyBrief{CityWithSpacesRemoved}
  e.g. "Fort Lauderdale" → @SkyBriefFortLauderdale
```

---

### 6. Habit-Based CTA System

Replace the static `"Follow @SkyBrief for daily updates"` with a rotating CTA that uses the dynamic handle. Select from a pool:
- `"Follow {handle} for tomorrow's forecast"`
- `"Tomorrow's forecast drops at {handle}"`
- `"Daily weather every morning at {handle}"`
- `"Check back tomorrow on {handle}"`

Rotate based on day-of-week (deterministic per city per day).

---

### 7. Updated Caption Prompt

Update the `SKYBRIEF_SYSTEM_PROMPT` in `generate-caption/index.ts` to:
- Include the dynamic handle in the final CTA line
- Pass the handle as a variable in the user prompt
- Instruct the AI to use habit-forming CTA language

Also update the user prompt builder to include the `dynamic_handle` field.

---

### 8. Takeaway — Remove Emojis

Current takeaway lines include emojis (⚡☔❄️ etc). The spec shows clean text-only takeaways. Remove emoji prefixes from `getPracticalTakeaway()` and keep lines under 8 words.

---

### Files Changed

| File | Changes |
|------|---------|
| `supabase/functions/daily-weather-post/index.ts` | Overlay, glass panels, text shadows, Pexels landmark search, `getDynamicHandle()`, habit CTA, clean takeaways |
| `supabase/functions/process-scheduled-posts/index.ts` | Same changes (mirrored) |
| `supabase/functions/generate-caption/index.ts` | Add dynamic handle to user prompt, update CTA instruction in system prompt |

All changes are in edge functions only — no frontend or database changes needed.


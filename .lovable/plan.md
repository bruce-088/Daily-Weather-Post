

## Plan: Implement SkyBrief Title Generator

### Current State
Titles are hardcoded inline across three edge functions using a single format:
```
{City} Weather Today — {Temp}°F {Condition}
```
No emoji, no format variety, no alert-aware titles, no rain chance consideration.

### Changes

**1. Create a shared title generator function**

Add a `generateTitle` helper to each edge function (or inline it) that:
- Accepts `city`, `temperature`, `condition`, `day`, `rainChance`
- Selects Format D if `rainChance >= 60` and condition includes storm/rain/thunder
- Otherwise rotates between Formats A/B/C based on a simple hash (e.g., day of week % 3)
- Maps condition to a single emoji (☀️ sunny, 🌤 partly cloudy, ☁️ cloudy, 🌧 rain, ⛈ storm, ❄️ snow, 🌫 fog)
- Truncates to under 60 characters

**2. Update title usage in three files**

- `supabase/functions/daily-weather-post/index.ts` (line ~872): replace inline title with `generateTitle()`
- `supabase/functions/process-scheduled-posts/index.ts` (line ~748): same
- `supabase/functions/upload-preview-video/index.ts` (line ~145): use generated title as default fallback

**3. Remove `#Shorts` suffix from `uploadToYouTubeShorts`**

YouTube auto-detects Shorts by aspect ratio; the `#Shorts` suffix wastes title characters. Remove it from all three functions.

### Title Logic (pseudocode)
```
function generateTitle(city, temp, condition, rainChance):
  emoji = mapConditionToEmoji(condition)
  
  if rainChance >= 60 && isStormCondition(condition):
    return `Storms in ${city}? ⛈ Weather Update`  // Format D
  
  // Rotate formats by day-of-week
  variant = new Date().getDay() % 3
  switch variant:
    0: return `${city} Weather Today ${emoji} | ${temp}° ${condition}`     // A
    1: return `Today's Weather in ${city} ${emoji} Quick Forecast`         // B
    2: return `${city} Forecast Today ${emoji} Weather Update`             // C
  
  // Truncate to 60 chars
```

### Files Modified
- `supabase/functions/daily-weather-post/index.ts`
- `supabase/functions/process-scheduled-posts/index.ts`
- `supabase/functions/upload-preview-video/index.ts`


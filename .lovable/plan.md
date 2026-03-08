

## Add Time Period Indicator to Video Overlay

### What
Add a badge-style time period label (e.g., "☀️ MORNING UPDATE", "🌤️ AFTERNOON UPDATE", "🌙 EVENING UPDATE") to the video overlay near the city header, so viewers immediately know which forecast period the video covers.

### How

**Files to change (2):**
- `supabase/functions/daily-weather-post/index.ts`
- `supabase/functions/process-scheduled-posts/index.ts`

**Changes in each file:**

1. **Add `timePeriod` parameter** to `buildCreatomateSource(weather, videoUrl, timePeriod?)` and `generateWeatherVideo(weather, timePeriod?)` signatures.

2. **Determine the period label and emoji** inside `buildCreatomateSource`:
   - If `timePeriod` is explicitly passed, use it
   - Otherwise, auto-detect from the current hour (6-12 → morning, 12-17 → afternoon, else → evening)
   - Map to display: `"☀️ MORNING UPDATE"` / `"🌤️ AFTERNOON UPDATE"` / `"🌙 EVENING UPDATE"`

3. **Add a pill badge element** to the overlay between the brand accent line and the city header panel (~y 11%):
   - Small frosted-glass rectangle background (`rgba(255,255,255,0.12)`, rounded)
   - Text element with the period label in the theme accent color, font weight 700, font size ~28-30px, letter-spacing for readability

4. **Thread `timePeriod` through call sites:**
   - In `daily-weather-post`: pass `timePeriod` from the request body through to `generateWeatherVideo` → `buildCreatomateSource`
   - In `process-scheduled-posts`: auto-detect period from current hour (no request body available)

### Visual placement (both layouts)

```text
┌──────────────────────┐
│      SKYBRIEF        │  ← brand
│      ────────        │  ← accent line
│  [ ☀️ MORNING UPDATE ]│  ← NEW pill badge (~y 11%)
│  ┌────────────────┐  │
│  │   CITY NAME    │  │  ← city header
│  │  State · Date  │  │
│  └────────────────┘  │
│        ...           │
```


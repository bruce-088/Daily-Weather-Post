

## Problem

The `morningTemp` is `null` when the function runs in the afternoon/evening because OpenWeatherMap's 5-day/3-hour forecast API only returns **future** forecast entries. By afternoon, the morning 6-12h slots for today are already in the past and not included in the response. The current fallback only sets the *current* period's temp, leaving morning null.

## Solution

Change all three `fetchWeatherData` functions (in `fetch-weather`, `daily-weather-post`, and `process-scheduled-posts`) to also check **tomorrow's** forecast entries for period-specific temps when today's data is missing. Additionally, use the current weather as a smarter fallback for any still-null period.

### Changes (3 files, same logic in each)

**Files:** `supabase/functions/fetch-weather/index.ts`, `supabase/functions/daily-weather-post/index.ts`, `supabase/functions/process-scheduled-posts/index.ts`

Replace the current time-of-day extraction and fallback block with:

1. **Collect ALL periods from today's forecast** (existing — keep as-is)
2. **Fill gaps from tomorrow's forecast** — if morningTemp is still null after scanning today, scan tomorrow's 6-12h entries
3. **Fill remaining gaps from current weather** — for any period still null, use the current temperature as an estimate rather than only filling the current period

```text
Before (fallback only sets ONE period based on current hour):
  if (all three null) → set only the current-hour period

After (fills ALL missing periods):
  Step 1: scan today's forecast (existing)
  Step 2: for any still-null period, scan tomorrow's forecast
  Step 3: for any STILL-null period, use current temp as estimate
```

This ensures morning posts always have morning data (from tomorrow if today's morning is past), and the caption/alert logic always has complete period data to work with.


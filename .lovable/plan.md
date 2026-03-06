

## Show Weather in Fahrenheit

The API currently fetches weather in metric (Celsius). Two changes needed:

### 1. Edge Function: `supabase/functions/fetch-weather/index.ts`
- Change `units=metric` to `units=imperial` in both the current weather and forecast API calls
- Update wind speed calculation (imperial already returns mph, so remove the `* 3.6` conversion and label accordingly)

### 2. Frontend Display
- **`src/components/WeatherCard.tsx`**: Append `°F` instead of just `°` for temperature, feels-like, and forecast temps
- **`src/components/PostHistoryList.tsx`**: Change `°C` to `°F`

### 3. Edge Functions: `daily-weather-post` and `process-scheduled-posts`
- Change `units=metric` to `units=imperial` in their weather fetch calls for consistency


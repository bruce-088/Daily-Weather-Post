

## Update Caption Generator to SkyBrief Brand Prompt

The user has provided a comprehensive SkyBrief brand prompt that replaces the current generic caption system. This requires changes to how weather data is gathered and passed, and a full replacement of the AI prompt in the edge function.

### Key Challenge

The SkyBrief prompt expects **morning/afternoon/evening breakdowns**, rain chance, wind info, sunrise/sunset, and severe alerts. The current `fetch-weather` function only returns a single current temperature and condition, plus a 5-day forecast. We need to extract time-of-day data from the OpenWeatherMap forecast API.

### Changes

**1. Update `generate-caption` edge function**
- Replace the generic system prompt with the full SkyBrief brand prompt provided by the user
- Accept expanded input fields: `city`, `state_or_region`, `date`, `day_of_week`, `morning_temp`, `morning_condition`, `afternoon_temp`, `afternoon_condition`, `evening_temp`, `evening_condition`, `rain_chance`, `wind_info`, `severe_alerts`, `sunrise_time`, `sunset_time`, `extra_note`
- Build the user prompt by filling in the template variables from the SkyBrief prompt

**2. Update `fetch-weather` edge function**
- Extract morning (6-11), afternoon (12-17), and evening (18-23) temps/conditions from the 3-hour forecast data
- Include `rain_chance` (max pop from forecast entries for today)
- Include `wind_info` from current weather
- Include `sunrise_time` and `sunset_time` from the current weather response (`sys.sunrise`, `sys.sunset`)
- Return these new fields alongside existing data (backward-compatible)

**3. Update `src/hooks/useWeather.ts` and `src/types/weather.ts`**
- Add new fields to `WeatherData` type: `morningTemp`, `morningCondition`, `afternoonTemp`, `afternoonCondition`, `eveningTemp`, `eveningCondition`, `rainChance`, `windInfo`, `sunrise`, `sunset`, `stateOrRegion`
- Update the hook to map the new response fields

**4. Update `src/lib/api.ts` — `generateCaption` function**
- Accept the expanded weather fields and pass them to the edge function

**5. Update `src/pages/Index.tsx` — `handleGenerateCaption`**
- Pass the new weather fields (morning/afternoon/evening, rain chance, wind, sunrise/sunset) to `generateCaption`

**6. Update `daily-weather-post` and `process-scheduled-posts` edge functions**
- When generating captions inline, use the same SkyBrief system prompt and pass the expanded weather fields

### No database changes needed.


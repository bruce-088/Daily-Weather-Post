

## Secure OpenWeatherMap API Key as Backend Secret

### Current Problem
The OpenWeatherMap API key is stored as plaintext in the `weather_settings` database table and exposed to the client via `loadSettings()`. This means the key is visible in network responses and browser memory.

### Approach
Move the OpenWeatherMap API key to a **backend secret** (`OPENWEATHER_API_KEY`) accessible only by the Edge Function. Remove the key from the database and the frontend settings UI entirely.

### Changes

**1. Add backend secret**
- Use the `add_secret` tool to prompt you to enter `OPENWEATHER_API_KEY` as a secure secret.

**2. Edge Function (`supabase/functions/daily-weather-post/index.ts`)**
- Read the API key from `Deno.env.get("OPENWEATHER_API_KEY")` instead of `settings.openweather_api_key`.
- Remove the check for `settings.openweather_api_key`.

**3. Database migration**
- Drop the `openweather_api_key` column from `weather_settings` (it will no longer be needed).

**4. Frontend cleanup**
- **`src/types/weather.ts`**: Remove `openWeatherApiKey` from `AutomationSettings`.
- **`src/lib/api.ts`**: Remove `openWeatherApiKey` from `loadSettings` and `saveSettings`.
- **`src/components/SettingsPanel.tsx`**: Remove the OpenWeatherMap API Key input field.
- **`src/hooks/useWeather.ts`**: The `fetchWeather` function currently takes an `apiKey` param for client-side weather preview. This will need to either use a proxy edge function or fall back to mock data when no key is provided client-side.
- **`src/pages/Index.tsx`**: Remove references to `openWeatherApiKey` in the fetch handler.

**5. Client-side weather preview (useWeather hook)**
- Since the API key will no longer be on the client, the live weather preview in the Designer tab will use mock data unless we add a lightweight "fetch-weather" edge function to proxy requests. I recommend adding a small edge function for this so the preview still shows real data.

### Summary of new/modified files
| File | Action |
|------|--------|
| Backend secret `OPENWEATHER_API_KEY` | Add via secret tool |
| `supabase/functions/daily-weather-post/index.ts` | Use `Deno.env.get()` for key |
| `supabase/functions/fetch-weather/index.ts` | **New** — proxy for client preview |
| DB migration | Drop `openweather_api_key` column |
| `src/types/weather.ts` | Remove `openWeatherApiKey` field |
| `src/lib/api.ts` | Remove key from load/save |
| `src/components/SettingsPanel.tsx` | Remove API key input |
| `src/hooks/useWeather.ts` | Call new proxy edge function |
| `src/pages/Index.tsx` | Update fetch handler |


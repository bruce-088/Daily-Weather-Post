

## Auto-Refresh Weather Data Every 30 Minutes

### Approach
Add an auto-refresh interval to the `useWeather` hook and trigger an initial fetch on mount from `Index.tsx`. A `lastUpdated` timestamp will show users when data was last refreshed.

### Changes

**`src/hooks/useWeather.ts`**
- Add `useEffect` + `useRef` to set up a 30-minute `setInterval` that re-fetches weather
- Accept an optional `autoRefreshLocation` param — when set, the hook auto-fetches on mount and every 30 min
- Track and expose a `lastUpdated: Date | null` timestamp

**`src/pages/Index.tsx`**
- Pass `settings.location` to `useWeather` so auto-refresh starts after settings load
- Display a small "Last updated: X min ago" label near the weather card, updating each minute via a simple interval

**`src/components/WeatherCard.tsx`**
- No changes needed — it renders whatever `weather` data it receives

### Summary
| File | Change |
|------|--------|
| `src/hooks/useWeather.ts` | Add 30-min auto-refresh interval, `lastUpdated` state |
| `src/pages/Index.tsx` | Pass location for auto-refresh, show last-updated timestamp |


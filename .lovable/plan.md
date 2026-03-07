

## Plan: Location-aware Pexels stock video backgrounds

### Problem
Currently, `fetchPexelsVideoUrl` receives only a weather-condition keyword (e.g. `"rain window dark moody"`, `"blue sky sun golden hour"`). The city/location is ignored, so a post for "Tokyo" and "Paris" get the same generic background.

### Solution
Prepend the city name to the Pexels search query so backgrounds are location-relevant. Add a fallback: if the city-specific search returns no results, retry with the generic weather-only keyword.

### Changes

**Both edge functions** (`daily-weather-post/index.ts` and `process-scheduled-posts/index.ts`):

1. **Update `fetchPexelsVideoUrl` signature** to accept an optional `city` parameter.

2. **Modify search logic**:
   - First search: `"{city} {keyword}"` (e.g. `"Tokyo rain window dark moody"`)
   - If no results found, fallback search: `"{keyword}"` (original behavior)

3. **Update the call site** in `generateWeatherVideo` to pass `weather.city`:
   ```
   const videoUrl = await fetchPexelsVideoUrl(theme.videoKeyword, weather.city);
   ```

This is a small, self-contained change — two files, same pattern in each.


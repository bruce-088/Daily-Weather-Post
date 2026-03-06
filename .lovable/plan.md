

## Auto-Generate Captions Based on Location

### What
Create a `generate-caption` edge function that uses Lovable AI to produce a weather caption based on the city, temperature, and condition. Wire it into the posting flow and add a caption preview on the Designer tab.

### Changes

**1. New edge function: `supabase/functions/generate-caption/index.ts`**
- Accepts `{ city, temperature, condition, description, platform }` and optionally a user auth header
- Calls Lovable AI (`google/gemini-3-flash-preview`) with a system prompt like: *"You are a social media caption writer. Write a short, engaging caption for a weather post. Include relevant emojis and 3-5 hashtags. Keep it under 280 characters."*
- Returns `{ caption: string }`
- Handles 429/402 rate limit errors
- Add to `supabase/config.toml` with `verify_jwt = false`

**2. Add `caption` column to `post_history` table**
- Migration: `ALTER TABLE post_history ADD COLUMN caption text;`
- No RLS changes needed (existing policies cover it)

**3. Update `daily-weather-post` edge function**
- After fetching weather, call `generate-caption` internally (via the Lovable AI gateway directly, since it's server-side) to get a caption
- Use the generated caption instead of the hardcoded template strings
- Store the caption in `post_history`

**4. Update `process-scheduled-posts` edge function**
- Same as above: generate a caption for each scheduled post before logging to `post_history`

**5. New API helper: `src/lib/api.ts`**
- Add `generateCaption(city, temperature, condition, description, platform)` that invokes the `generate-caption` edge function

**6. Caption preview on Designer tab (`src/pages/Index.tsx`)**
- Add a "Generate Caption" button below the weather card
- On click, call `generateCaption()` with current weather data
- Display the generated caption in a text area so the user can see/copy it
- Show a regenerate button to get a new one

**7. Update `PostHistoryList` component**
- Display the `caption` field if present in each history item


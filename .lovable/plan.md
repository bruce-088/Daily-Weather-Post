## Scope

Two safe, UI-only fixes inside the **Weekly Recap** card in `src/components/GrowthCommandCenter.tsx`. No edge functions, no cron, no pipeline changes.

---

### Fix 1 — Thumbnail previews for the 3 recent posts

Today the card queries `post_history` for the last 3 posts of the active city and renders `image_url` — if it's `null` (most video posts), it falls back to a grey `<Cloud>` icon, which is what the user sees.

Changes:

- Extend the `post_history` select to also pull `condition` and `temperature` so the fallback can be informative.
- Render order per card:
  1. If `image_url` is set, use it inside an `<img>` with `onError` → swap to the styled fallback (fail silently).
  2. Styled fallback: a small panel that uses the existing `WeatherIcon` component (mapped from `condition`), the `city` name, and the date, on a subtle gradient background that matches the dark glassmorphic theme — no more bare grey cloud.
- Keep the existing bottom gradient strip with `city · date`.

No new queries, no new tables, no storage calls — thumbnails already live at the public URL stored on `post_history.image_url`.

---

### Fix 2 — Channel selector for the recap

Add a small dropdown row inside the Weekly Recap `CardContent`, above the thumbnails:

```text
Post recap to: [ Sky Brief Gainesville ▼ ]
```

Behavior:

- Source the options from `social_accounts` where `platform = 'youtube'` for the current user (returns the two existing channels: Sky Brief Orlando, Sky Brief Gainesville).
- Default value:
  1. `weather_settings.recap_youtube_channel` if already set, else
  2. the channel whose `city_id` matches the active city, else
  3. the first available channel.
- On change, upsert `weather_settings.recap_youtube_channel` for the current user (check-then-act, per project rule for `weather_settings`).
- Show the selected channel name next to the existing `Auto` badge in the card header, e.g. `Auto · Sky Brief Gainesville`.

The selection is stored but **not** read by any edge function in this change — the cron, the recap generator, and the posting pipeline are untouched, as requested.

---

### Database migration

Add a single nullable column so the selection can persist:

```sql
ALTER TABLE public.weather_settings
  ADD COLUMN IF NOT EXISTS recap_youtube_channel text;
```

No RLS changes needed — existing `weather_settings` policies already cover it.

---

### Files touched

- `src/components/GrowthCommandCenter.tsx` — thumbnail fallback rendering, channel dropdown, save handler, header badge label.
- One migration adding `weather_settings.recap_youtube_channel`.

### Explicitly NOT touched

- `supabase/functions/create-weekly-recap/index.ts`
- Any cron schedule
- Any posting / rendering pipeline
- Any other component or table

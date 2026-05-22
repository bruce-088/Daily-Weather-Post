# Dev Shadow Runs for City Command Center

Add a second row of buttons per city — **Dev: Test Daily / Weekly / Monthly** — that runs the full generation pipeline (image/video render, voice + music mix, AI caption) but **skips the social upload** and instead returns the rendered media URL for review.

## 1. UI — `src/components/CityCommandCenter.tsx`

Per city, render two button rows:

- **PROD row** (existing behavior, label tweak):
  - `▶ Post Daily Now`, `▶ Post Weekly Now`, `▶ Post Monthly Now`
  - Subtle warning text: *"Posts live to connected channels."*
- **DEV row** (new):
  - `🛠 Dev: Test Daily`, `🛠 Dev: Test Weekly`, `🛠 Dev: Test Monthly`
  - Subtle helper text: *"Renders end-to-end. No upload, no post_history."*

State changes:

- `RunType` becomes `"daily" | "weekly" | "monthly"` plus a parallel `mode: "post" | "dev"`. Run state map key becomes `${cityId}:${mode}:${type}`.
- 30-min localStorage dup guard applies per `(city, mode, type)` so a Dev run does not block a Post run.
- On Dev success, status pill shows `👁 View Test Result` linking to `data.preview_url` (opens `.mp4`/`.png` in a new tab). On Post success, link label stays `View on YouTube`.
- Logs:
  - Post click → `[manual-post] {type} triggered for city={city} by user={id}`
  - Dev click → `[dev-test] {type} triggered for city={city} (skipping upload)`

No visual redesign — reuse existing Card/Button/StatusDot, just two rows inside each city block.

## 2. Edge Functions — accept `skip_post: true`

All three honor a `skip_post` flag in the JSON body. When true: run the full generation chain, **do not** publish to any platform, **do not** insert a "posted" `post_history` row, and return the rendered asset URL.

### `create-weekly-recap` and `create-monthly-recap`

- `runForUser(svc, userId, cityFilter, { skipPost })` gains a `skipPost` option threaded from the request body.
- After `stitchSlideshow` succeeds (`stitched.url` is the Creatomate signed URL):
  - If `skipPost`: log `[recap] dev-test skip_post=true preview_url={stitched.url}`, return `{ ok: true, preview_url, mode: "dev" }`. Skip `uploadLongFormToYouTube`, skip the `notifications` insert, skip `post_history`.
  - Else: existing upload path runs unchanged.
- Response shape gains `preview_url` and `mode` so the UI can surface the link.

### `process-scheduled-posts`

- Body parser accepts `skip_post` alongside the existing `scheduled_post_id`.
- When `skip_post === true`, the function processes the row through caption → voice → render exactly as today, but:
  - Replaces the `postToPlatform(...)` call with a no-op that records the rendered `video.data` URL.
  - Marks the `scheduled_posts` row `status = 'dev_completed'` (new sentinel string, no schema change) instead of `'posted'`.
  - Does NOT insert into `post_history`; does NOT insert `post_performance`/`post_analytics`.
  - Logs `[dev-test] scheduled_post_id={id} skipping upload for {platform}`.
- Final response includes `preview_url` derived from the render step.
- The `scheduled_posts` row inserted by the Dev: Daily button uses the same shape as today plus `slot: "adhoc-dev"` so it is filterable in history and cannot be picked up by the regular cron worker (the worker only claims `slot in ('morning','afternoon','evening','adhoc')`).

## 3. Logging contract

- Each function emits a single line at entry distinguishing modes:
  - `[manual-post] weekly triggered for city=Gainesville by user=…`
  - `[dev-test] weekly triggered for city=Gainesville (skipping upload)`
- Each function logs `preview_url` after a successful render in dev mode.

## 4. Out of scope

- No schema changes, no migrations, no new RLS.
- No changes to the cron entries, the last-day-of-month guard, the post-health gate, A/B testing, or the analytics pipeline.
- No changes to platform adapters; the skip is enforced upstream by the orchestrating function.
- `generate-spec` is not updated in this pass (will follow only if you ask after verification).

## Files touched

- `src/components/CityCommandCenter.tsx` — two-row layout, mode-aware run state, preview-URL handling.
- `supabase/functions/create-weekly-recap/index.ts` — `skip_post` branch around upload + notification.
- `supabase/functions/create-monthly-recap/index.ts` — same `skip_post` branch.
- `supabase/functions/process-scheduled-posts/index.ts` — `skip_post` body field, replaces publish step with preview URL capture, uses `dev_completed` sentinel and `adhoc-dev` slot.

## Verification

1. **Dev: Test Weekly** for Gainesville → status reaches Done, edge logs show `[dev-test]` and `preview_url=…`, no new YouTube upload, `👁 View Test Result` opens the rendered `.mp4` with voice + music.
2. **Post Weekly Now** for Gainesville → existing path, video lands on the YouTube channel and `View on YouTube` link is shown.
3. **Dev: Test Daily** → `scheduled_posts` row created with `slot: 'adhoc-dev'`, transitions to `dev_completed`, no `post_history` row, preview URL returned.
4. Confirm both Post and Dev rows respect their own 30-min dup guard independently.

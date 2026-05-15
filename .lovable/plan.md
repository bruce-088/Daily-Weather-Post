## Goal

Make the "Preview" experience as durable as auto-post by routing it through a real backend job, eliminating render cache "ghosts," reusing the previewed asset at publish time, and showing the user where the pipeline is at every step.

---

## 1. Hook the Preview into the Job Pipeline

Today the **Preview** button calls `daily-weather-post` (mode=`preview`) synchronously and waits up to ~60s for the response. It bypasses the `jobs` table entirely. We will wrap it in a real job so it has the same status surface as auto-post.

**New edge function: `enqueue-preview-job`**
- Inputs: `city_id`, `city`, `state`, `style`, `voice`, `selected_hook`, `enable_cinematic_mode`.
- Calls `enqueue_job()` SQL with `type = 'preview'`, payload carrying the inputs.
- Returns `{ job_id }` immediately (no waiting).

**New job handler: `preview`** (added to `_shared/job-handlers.ts`)
- Stage 1 — `fetching_weather`: calls `fetch-weather`, writes `result.stage`.
- Stage 2 — `generating_hooks`: calls `generate-hooks`, writes the chosen hook into `result`.
- Stage 3 — `rendering_video`: calls `daily-weather-post` (`mode=preview`) with all inputs + `nonce` (see §2). On success writes `result.video_url`, `result.bundle_id`, `result.caption`, `result.weather`, `result.visual_source`, `result.health_score`.
- Stage 4 — `ready`: marks job `status='succeeded'`.
- Failures bubble up via the existing `last_error` field; UI surfaces them.

**Frontend (`VideoPreviewDialog` + `lib/api.ts`)**
- New helper `enqueuePreviewJob(opts)` → returns `job_id`.
- New helper `pollPreviewJob(jobId)` → polls `jobs` row every 1.5s for up to 90s, returns `{ stage, status, result, last_error }`.
- `handleGenerate` is rewritten to: enqueue → poll → set `preview` only when `status='succeeded'`. The existing `generatePreview()` direct-call helper stays as a fallback behind a feature flag for one release, then gets removed.

---

## 2. Eliminate Render Caching "Ghosts"

The frontend already appends a `nonce` to the edge invoke body, but the value is not forwarded into the Creatomate render request, so Creatomate's content-hash cache can still return the same render. We will plumb the nonce all the way down.

- `daily-weather-post` reads `requestBody.nonce` (already received) and passes it through `generateWeatherVideo()` → `buildCreatomateSource()`.
- Inside `buildCreatomateSource`, attach the nonce as a hidden `modifications.cache_bust` property on the source object, e.g.:
  ```
  source.modifications = { ...(source.modifications||{}), cache_bust: nonce }
  ```
- Same nonce is also added to the JSON2Video payload (`payload.metadata.cache_bust`) so the fallback chain is just as fresh.
- The new `preview` job handler ALWAYS generates a server-side nonce (`crypto.randomUUID()`) so even if a client forgets, every preview is unique.

Result: identical weather inputs no longer produce identical render IDs.

---

## 3. WYSYWYP — "What You See Is What You Post"

`preview_bundles` already stores the locked render. `publish-preview-bundle` already supports posting an exact `bundle_id`. The gap is on the publish path: when a user "Posts" after previewing, the manual-post pipeline currently re-renders. We will:

- Surface the current preview's `bundle_id` (already returned in `PreviewResult.bundle_id`) all the way through `triggerManualPipelinePost(...)` and the resulting `scheduled_posts.debug_trace.preview_bundle_id`.
- Update `process-scheduled-posts` so that when `debug_trace.preview_bundle_id` is set AND the bundle is still `locked` (not expired/consumed) it:
  1. Loads `preview_bundles.asset_url` + `audio_url`.
  2. Skips `generateWeatherVideo()` entirely.
  3. Downloads the stored asset bytes and feeds them straight to `postToPlatform()`.
  4. On success marks the bundle `consumed`.
- The manual "Post" button only invalidates the bundle when (a) caption was edited, (b) city changed, or (c) `Regenerate` was clicked — the existing `bundleInvalidated` state already tracks this. When invalidated, fall back to the normal pipeline render.

Result: the exact mp4 the user previewed is the exact mp4 that lands on the platform.

---

## 4. Visual Reliability Indicator

Add a thin status strip pinned to the bottom of `VideoPreviewDialog` (above the existing footer). It's driven directly by the polled `result.stage` from the preview job.

```text
[●  Fetching weather] ── [○  Generating hooks] ── [○  Rendering video] ── [○  Ready]
```

- States rendered as small pills (matching `DebugLabels`/`PostProgressPanel` styling).
- Active stage uses an animated pulse + the existing `Loader2` icon.
- Completed stages get a check; failed stages get a red X with the `last_error` shown beneath in monospace.
- New component: `src/components/PreviewPipelineStatus.tsx` (≤120 lines, presentational only).

---

## Technical details

**DB**
- No schema change required. `jobs.payload`, `jobs.result`, and `jobs.status` already cover everything.
- Add a CHECK-friendly value: `jobs.type = 'preview'` (free text — already allowed).
- Optional: add an index `CREATE INDEX IF NOT EXISTS idx_jobs_type_status ON jobs (type, status);` for poll efficiency. (Will be done in a separate migration if poll latency is a concern.)

**Job runner**
- `_shared/job-handlers.ts` registry gets a new entry: `preview: previewJob`.
- `run-jobs` continues to claim jobs via `claim_next_jobs`; no change needed there because the new handler self-contains the staged work and writes intermediate `result.stage` updates inside a single job rather than chaining sub-jobs.

**Edge functions touched**
- New: `supabase/functions/enqueue-preview-job/index.ts`
- Modified: `supabase/functions/_shared/job-handlers.ts` (add `previewJob` + register)
- Modified: `supabase/functions/daily-weather-post/index.ts` (forward `nonce` into Creatomate `source.modifications.cache_bust`; same for JSON2Video metadata)
- Modified: `supabase/functions/process-scheduled-posts/index.ts` (WYSYWYP short-circuit when `preview_bundle_id` present and bundle is `locked`)

**Frontend touched**
- Modified: `src/lib/api.ts` (`enqueuePreviewJob`, `pollPreviewJob`; pass `bundle_id` through `triggerManualPipelinePost`)
- Modified: `src/components/VideoPreviewDialog.tsx` (replace direct `generatePreview` call with enqueue+poll; pass `bundle_id` to manual post)
- New: `src/components/PreviewPipelineStatus.tsx` (status bar)

**Feature flags**
- `ENABLE_DURABLE_PREVIEW_PIPELINE` (default `true`, localStorage override). When `false`, `handleGenerate` falls back to today's direct `generatePreview()` for one release as a safety net.

**Failure modes & UX**
- Job stuck in `processing` >90s: UI shows "Render is taking longer than usual…" but keeps polling up to 180s, then surfaces `last_error` (or "Timed out — try again").
- Render fallback chain (Creatomate → JSON2Video → Ken-Burns) is unchanged; the user just sees `Rendering video` longer.
- Bundle expired between preview and publish: WYSYWYP short-circuit detects expiry, falls back to a fresh pipeline render, and toasts "Preview expired — regenerated for posting."

---

## Acceptance criteria

1. Clicking **Preview** creates a row in `jobs` with `type='preview'` visible in `JobsDashboard`.
2. Two consecutive previews of the same city produce **two different `render_id`s** in Creatomate's API log.
3. Posting after a preview reuses the bundle's stored mp4 — no second Creatomate render is logged.
4. The Preview Modal always shows one of: `Fetching weather` / `Generating hooks` / `Rendering video` / `Ready` / `Failed: <reason>`.
5. Auto-post and Preview→Post produce byte-identical mp4s for the same bundle id.

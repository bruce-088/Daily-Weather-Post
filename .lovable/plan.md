# Pipeline Hardening & Silent Failure Debugging

Goal: expose the hidden YouTube failure that's marking jobs Succeeded with no video and no notification.

## 1. Verbose logging in YouTube adapter
File: `supabase/functions/_shared/youtube-adapter.ts` — `uploadVideo()` (~lines 285–320)

Right after the resumable `PUT` to `uploadUrl` resolves, log full diagnostics whether or not `ok`:
- `console.log("[YT] upload status:", uploadRes.status, uploadRes.statusText)`
- Parse the body once into `responseBody` (string + JSON when possible) and `console.log("[YT] full response body:", JSON.stringify(responseBody))`
- If `responseBody.id` present → `console.log("✅ YouTube Upload Success! Video ID: " + responseBody.id)`
- Else → `console.error("❌ YouTube API returned " + uploadRes.status + " but no Video ID found. Full Response: " + JSON.stringify(responseBody))` and `throw new Error("YouTube upload returned no video ID: " + JSON.stringify(responseBody).slice(0,500))` so the caller fails loudly instead of returning `null`.

Keep the existing `!uploadRes.ok` branch but route through the same parsed body so we don't double-consume the stream.

## 2. Post-publish notification reliability
File: `supabase/functions/process-scheduled-posts/index.ts` (~lines 2690–2740)

- Right before the `postToPlatform` call, `console.log("[publish] Attempting to write notification for user: " + post.user_id + ", platform: " + platformName)` (the request asked for it before `insertNotifications`; this is the equivalent pre-publish hook in this codebase).
- The branch at line 2733 (`result.success && !result.id`) already treats missing IDs as failure. Tighten it for YouTube specifically: if `platformName === "youtube"` and `result.success` is true but `result.id` is falsy, `throw new Error("[YT_NO_VIDEO_ID] YouTube reported success without a video_id — failing job")`. The surrounding try/catch in `publish_post` job handler will then mark the job FAILED instead of SUCCEEDED.
- Add a `console.log("[publish] notification queued user=" + post.user_id + " platform=" + platformName + " status=" + (result.success ? "ok" : "fail"))` immediately after the `notifyFailure(...)` / success-log calls so we can see in edge logs whether notification writes actually fired.

## 3. Manual-slot dedup bypass (TESTING ONLY)
File: `supabase/functions/process-scheduled-posts/index.ts` (~lines 1688–1722)

- Wrap the `acquire_publish_lock` block in `if (!post.caption?.includes("[manual:") && !((post as any).source === "manual_slot")) { ... }` so manual "Run This Slot Now" runs always proceed.
- Add a `console.warn("[lock] ⚠ DEDUP BYPASSED for manual run post=" + post.id)` when bypassed.
- Mark the block with a `// TODO: remove after pipeline debugging — issue #pipeline-hardening` comment so it's easy to revert.

(Automated cron runs still honor the lock; only manual slot triggers bypass.)

## 4. Enhanced Jobs Dashboard drilldown
File: `src/pages/JobsDashboard.tsx` (drilldown sheet, ~lines 360–395)

- Today `last_error` is only rendered inside `if (j.last_error)` which works, but it's hidden behind the status badge styling. Move the error block out from under any status check so it renders for `succeeded` jobs too.
- Change the heading from `"Failed step: ..."` to a status-aware label: `j.status === "succeeded" ? "⚠ Warning logged on succeeded step" : "Failed step: ..."`.
- Use a warning style (amber background) for succeeded-with-error vs destructive (red) for actual failures so users can tell them apart at a glance.
- Also surface `j.result` JSON (pretty-printed, collapsible <details>) in the drilldown so hidden adapter responses are visible without checking edge logs.

## Verification
1. Run "Run This Slot Now" for Orlando 3× in a row — all three should reach `process-scheduled-posts` (no dedup skip) and produce edge-function log lines starting with `[YT] upload status:` and either `✅` or `❌`.
2. If YouTube returns a 200 without an `id`, the corresponding `publish_post` job appears as **FAILED** in `/jobs` with the `[YT_NO_VIDEO_ID]` error visible in the drilldown.
3. If YouTube returns an `id`, a `post_published` system_log row is written and a notification row appears for the user.
4. Open any previously-"succeeded" job in `/jobs` — if `last_error` exists, it now renders in the drilldown with the amber warning style.

## Out of scope
- The unrelated `enqueue_job` "permission denied" RPC error visible in console logs (separate issue — would need a SECURITY DEFINER grant migration).
- Reverting the dedup bypass — flagged with a TODO, to be removed once root cause is identified.

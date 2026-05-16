# Visibility + YouTube URL Hardening

Five small, targeted fixes. No schema migration required — `jobs` table already holds the pipeline rows the dashboard reads, and `social_accounts.account_external_id` already stores the canonical YouTube channel ID.

---

## Fix 1 — Notify on every blocked publish (not only "another city has one")

**File:** `supabase/functions/process-scheduled-posts/index.ts` (around L1744–1793, the "HARD CITY ISOLATION" block)

Today a notification is only inserted in the `wrong && wrong.length > 0` branch. If the city has **no** connected account at all (Gainesville's case), the code falls through to legacy `weather_settings` token resolution and may silently no-op later.

Change:
- After the `social_accounts` lookup, if `!acct` AND no rows exist for `(user, platform)` whatsoever bound to a city, also write:
  - `scheduled_posts.status = 'failed'`, `error_message = '[BLOCKED] No <platform> account connected for <city>'`
  - `system_logs` row with `type: 'publish_blocked'`
  - `notifications` row: `❌ Publish blocked — connect a <platform> channel for <city>`
- Then `releaseLock()`, increment `processed`, `continue`.

Add the same notify + log on the existing routing-violation branch (already inserts notification — keep it, just also include the `slot` and `scheduled_post_id` in `context` so the JobsDashboard drilldown can correlate).

---

## Fix 2 — Manual "Run This Slot Now" must enqueue a pipeline job

**File:** `src/components/CityManager.tsx` (`handleRunSlotNow`, L222–314)

Currently it inserts `scheduled_posts` and directly invokes `process-scheduled-posts` — bypassing the `jobs` table entirely, so JobsDashboard never sees the run.

Change the loop body that invokes the worker: instead of (or in addition to) calling `process-scheduled-posts`, call the existing `enqueue_job` RPC to insert a `publish_post` job tied to the new `scheduled_post_id`:

```ts
await supabase.rpc("enqueue_job", {
  p_user_id: user.id,
  p_type: "publish_post",
  p_payload: { source: "manual_slot", slot, platform: row.platform },
  p_scheduled_post_id: row.id,
  p_city: cityLabel,
  p_platform: row.platform,
});
```

Then kick `run-jobs` (cheap fire-and-forget invoke) instead of `process-scheduled-posts`. The existing `publishPost` handler in `_shared/job-handlers.ts` already delegates to `process-scheduled-posts`, acquires the lock, and writes notifications on dedupe/auth-expired — so all routing/blocked notifications continue to fire, and the `jobs` row gives JobsDashboard a visible record.

---

## Fix 3 — JobsDashboard auto-refresh + force-fresh on click

**File:** `src/pages/JobsDashboard.tsx`

Two small changes:

1. **Realtime subscription is already wired on `jobs` table**, but only for INSERT/UPDATE inside the dashboard. After Fix 2, manual runs enqueue jobs → realtime will fire automatically. No further work needed for the open-page case.
2. **Refresh button**: today `loadJobs` is just a re-`select`. Supabase-js doesn't HTTP-cache, but add `cache: 'no-store'` headers via `{ head: false }` isn't necessary — instead, give the user feedback that the click did something by also calling `supabase.functions.invoke("run-jobs", {})` (advance any due jobs) before reloading. Wrap in try/catch so failure doesn't block the reload.
3. **Sort order**: already `order("created_at", { ascending: false })` — confirm `grouped` sorting also uses last-created descending (it does, L162–167). No change.

---

## Fix 4 — Correct YouTube subscribe URL

**File:** `supabase/functions/_shared/youtube-adapter.ts` (L186–208 + tighter ResolvedYTAccount)

Root cause: `account_name` is a YouTube **channel title** (display name like "Sky Brief Orlando"), not a handle. The current regex `@?([A-Za-z0-9_.\-]{2,})` greedy-matches the first word → `"Sky"` → `https://www.youtube.com/@Sky?sub_confirmation=1`.

Changes:

1. **Extend `ResolvedYTAccount`** to also carry `account_external_id` (channel ID, `UCxxxx`). It's already populated by `youtube-auth/index.ts` on connect.
2. **In `getValidToken`** select `account_external_id` alongside the existing fields and pass it into `this._resolved.set(...)` (both warm-cache and post-refresh paths).
3. **In `uploadVideo`**, replace the `cleanHandle` block with a 3-tier resolver:
   - **a.** If `account_name` looks like a real handle (matches `^@?[A-Za-z0-9_.\-]{3,30}$` with **no spaces**) → use `https://www.youtube.com/@<handle>?sub_confirmation=1`.
   - **b.** Else if `account_external_id` starts with `UC` and is 24 chars → use `https://www.youtube.com/channel/<id>?sub_confirmation=1` (always valid).
   - **c.** Else → emit generic CTA with **no URL**: `👉 Subscribe and turn on notifications for daily <city> weather alerts 🔔`.
   Never derive a handle from `account_name` words or from the title city when those don't correspond to a real channel.

4. Remove the existing fallback that synthesizes `SkyBrief<City>` from the title (L198–199) — that's the path producing fake handles on multi-channel installs.

---

## Fix 5 — Status copy across UI

Scope-limited touch-ups so users can read outcomes at a glance.

- **`system_logs.type` taxonomy** (already in use): `post_published`, `post_deduped`, `routing_violation`, `publish_blocked` (new from Fix 1).
- **`scheduled_posts.error_message` prefixes** drive the UI labels. After Fixes 1–2 these will be: `[DEDUPED] …`, `[ROUTING_VIOLATION] …`, `[BLOCKED] …`, plain text for hard failures.
- **`PostHistoryList.tsx`** (read-only here, no change needed unless labels are already drifting — check after Fix 1 lands; if it shows raw error text, add a tiny label mapper):
  - `[DEDUPED]` → `Skipped (deduped)`
  - `[ROUTING_VIOLATION]` / `[BLOCKED]` → `Blocked`
  - other `status=failed` → `Failed`
  - `status=posted` → `Posted`
- **`JobsDashboard.tsx`** already renders status via `statusBadge`; the "Blocked" reason is in `last_error` and surfaces in the drilldown — good as-is.

---

## Files touched

- `supabase/functions/process-scheduled-posts/index.ts` — Fix 1
- `src/components/CityManager.tsx` — Fix 2
- `src/pages/JobsDashboard.tsx` — Fix 3
- `supabase/functions/_shared/youtube-adapter.ts` — Fix 4
- `src/components/PostHistoryList.tsx` — Fix 5 (only if current copy is raw)

## Out of scope

No DB migration. No changes to render pipeline, A/B logic, analytics, or other platform adapters. Only YouTube URL generation is changed; other adapters already use platform-specific account IDs.

## Acceptance walkthrough

1. **Disconnect Gainesville YouTube → Run Gainesville morning slot**
   - `scheduled_posts` row created (manual_slot) → `enqueue_job` writes a `publish_post` job → JobsDashboard shows it in realtime.
   - Isolation check fires `[BLOCKED]`, marks the post `failed`, releases lock, inserts `notifications` row → bell shows "Publish blocked — connect a YouTube channel for Gainesville".
   - `publishPost` job receives the failed status → job marked `failed` with that reason → visible in dashboard with a Retry button.
2. **Run Orlando morning slot** (channel connected)
   - New job appears immediately via realtime; Refresh forces an extra `run-jobs` tick.
   - Description CTA contains `https://www.youtube.com/@SkyBriefOrlando?sub_confirmation=1` (handle path) or `…/channel/UCxxxx?sub_confirmation=1` (channel-id fallback). Never `@Sky?...`.
3. **Re-run same slot within the day** → lock blocks → `[DEDUPED]` notification, job ends `succeeded` with `skipped: "deduped"` (existing behavior).

# Stop duplicate posts — Publish Lock + City Isolation

## Root cause
Cron `auto-post-scheduler` dedupes by 30-min caption ILIKE `[auto:slot]`. Manual runs write `[manual:slot]`, so cron doesn't see them and fires a second post. Per-post dedupe in `process-scheduled-posts` is 60-min `user+city+platform` only — no slot/date/city_id awareness.

## Fix 1 — Persist slot + source as real columns
Add to `scheduled_posts` and `post_history`:
- `slot text` — `morning|afternoon|evening|manual|adhoc`
- `source text` — `auto_cron|manual_slot|job_pipeline|preview|ab_test|adhoc`

Writers:
- `auto-post-scheduler` → `slot=period.name`, `source='auto_cron'`
- `CityManager.handleRunSlotNow` → `slot=<clicked>`, `source='manual_slot'`
- Other writers → `slot='adhoc'`, appropriate source

Keep existing caption markers for backward-compat reads.

## Fix 2 — Manual run hardening (`CityManager.tsx`)
- Write `slot` + `source='manual_slot'` columns on insert.
- Global click guard: if any `runningSlot` is set for any city/slot, refuse new clicks.
- Console breadcrumb on fire: `manual_slot city=<id> slot=<slot> platforms=[...]`.
- Toast wording on dedupe: "Already posted for this slot today — skipped."

## Fix 3 — Global Publish Lock (the real fix)

New table `publish_locks`:
```text
user_id     uuid
city_id     uuid
slot        text
platform    text
local_date  date
scheduled_post_id uuid null
acquired_at timestamptz default now()
PRIMARY KEY (user_id, city_id, slot, platform, local_date)
```

Postgres functions (SECURITY DEFINER):
- `acquire_publish_lock(p_user, p_city_id, p_slot, p_platform, p_tz) → boolean`
  - `local_date := (now() AT TIME ZONE coalesce(p_tz,'UTC'))::date`
  - Returns `false` if a `post_history` row exists with `(user_id, city_id, slot, platform, status='success')` on that local_date, OR a `scheduled_posts` row with same key is `posted`/`processing`.
  - Else `INSERT INTO publish_locks ... ON CONFLICT DO NOTHING` — if no row inserted, returns `false`; else `true`.
- `check_publish_lock(...)` → read-only variant (no insert) for the scheduler pre-check.
- `release_publish_lock(p_user, p_city_id, p_slot, p_platform, p_tz)` → DELETE row for the local_date (called on publish failure).

Timezone source (server-side resolution helper): `automations.timezone` for city_id → `weather_settings.timezone` → `UTC`.

### Call sites
- **`process-scheduled-posts`** (replace 60-min check ~L1676): call `acquire_publish_lock`. If `false` → mark row `posted` with `error_message='[DEDUPED] publish lock held'` and short-circuit. On any publish failure path → `release_publish_lock`.
- **`auto-post-scheduler`** (~L425): replace ILIKE dedupe with `check_publish_lock` before insert; skip slot if locked.
- **`_shared/job-handlers.ts` `publishPost`**: call `acquire_publish_lock` right before delegating to `process-scheduled-posts` (safety net for pipeline path).

### Manual ad-hoc behavior
Manual "Run This Slot Now" DOES hold the lock under the clicked slot. Double-clicks/race conditions are blocked. To deliberately re-run, the lock must be released or wait until next local day.

## Fix 4 — Hard City Isolation at Publish Time
In `process-scheduled-posts` and `publishPost`, before any platform upload:
- Read `scheduled_post.city_id` and `scheduled_post.city`.
- Resolve expected social account for `(user_id, platform, city_id)`.
- Verify `resolved_account.city_id === scheduled_post.city_id`. If mismatch:
  - Mark row `failed` with `error_message='[ROUTING_VIOLATION] city mismatch'`.
  - Insert `system_logs` warning + user notification.
  - Do NOT retry.

This guarantees Gainesville content can never post to Orlando channels even if upstream wiring is wrong.

## Fix 5 — Optional one-time backfill
SQL to populate `slot` on recent `scheduled_posts`/`post_history` rows from caption markers (`[auto:morning]` → `morning`, etc.) so today's analytics aren't blank.

## Files to change
- **Migration**: `slot` + `source` columns on `scheduled_posts` and `post_history`; create `publish_locks` table; create `acquire_publish_lock` / `check_publish_lock` / `release_publish_lock` functions; RLS service-role-only on `publish_locks`.
- `supabase/functions/process-scheduled-posts/index.ts` — swap dedupe for lock acquire; release on failure; add city-isolation check.
- `supabase/functions/auto-post-scheduler/index.ts` — write `slot`/`source`; pre-insert `check_publish_lock`.
- `supabase/functions/_shared/job-handlers.ts` — `acquire_publish_lock` + city-isolation guard at start of `publishPost`.
- `src/components/CityManager.tsx` — write `slot`/`source`; global click guard; updated toast.

## Out of scope
- No changes to caption/voice/render/visual logic.
- No changes to analytics aggregation.
- No UI redesign beyond the click guard + toast wording.

## Confirmed decisions
- Timezone resolution: `automations.timezone` → `weather_settings.timezone` → `UTC`.
- Manual ad-hoc runs DO hold the lock under the clicked slot.

## Goal
Stop duplicate-post storms (e.g. 11 Orlando 8AM posts) by enforcing **one `generate_content` job per {user, city, platform, slot, date}**, dedup automation rows, and harden the schema.

---

## 1. Scheduler idempotency — `supabase/functions/auto-post-scheduler/index.ts`

Today the scheduler relies on (a) `check_publish_lock` and (b) a unique index on `scheduled_posts(user_id, city, platform, scheduled_at)`. Both are bypassed when the cron fires twice in the same minute with a fresh `scheduled_at` timestamp, or when two duplicate automation rows produce two distinct `scheduled_at` values 5s apart. We add explicit pre-insert guards.

**New helper** `existingJobForSlot(userId, city, platform, slot, localDate)`:
- Queries `jobs` where `type='generate_content'`, `status in ('pending','processing','retrying')`, `city=…`, `platform=…`, `payload->>slot = slot`, and `created_at >= start_of_local_day`.
- Returns true if any row exists.

**New helper** `recentSuccessForSlot(userId, city, platform, slot)`:
- Queries `post_history` where `user_id`, `city`, `platform`, `slot` match and `status in ('succeeded','success','posted')` and `created_at >= now() - interval '12 hours'`.

**Wire-in** (around lines 432–610, the per-platform loop):
1. After `check_publish_lock` approves a platform, run the two new guards.
2. If either guard hits → drop the platform from `allowedPlatforms`, emit
   `console.log("[scheduler] Slot=%s City=%s Platform=%s Status=Skipped_Existing", slot, city, platform)`.
3. Otherwise proceed and log `Status=Triggered` after successful enqueue.
4. Apply the same guards inside `enqueueExperimentBJobs` so B-variant timing experiments don't multiply duplicates.

---

## 2. Automation row deduplication

**Scheduler side** (top of `try` block, after loading automations):
- Group `enabledAutomations` by `${user_id}|${city_id}`; keep the **most recently `updated_at`** row, log
  `[scheduler] Status=Skipped_DuplicateRow city=… kept=<id> dropped=[…]` for the rest.
- All downstream loops use the deduped list.

**UI side** — `src/lib/citiesApi.ts` `upsertAutomation` already does check-then-update for `(user_id, city_id)`, but the bug is two rows already exist so `.maybeSingle()` throws. Change to:
- `.select("id").eq(user_id).eq(city_id).order("updated_at", { ascending: false }).limit(1)` → take first.
- If `>1` row was returned in an unbounded check (use `.select("id", { count: "exact" })`), delete all but the most recent before updating, and surface a toast: "Merged duplicate automation rows for this city."

No changes to `SettingsPanel.tsx` directly — it goes through `citiesApi.ts`.

---

## 3. Database integrity (migration)

```sql
-- One automation per user per city. Pick winner (most recent) before constraint.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, city_id
           ORDER BY updated_at DESC, created_at DESC
         ) AS rn
  FROM public.automations
)
DELETE FROM public.automations a
USING ranked r
WHERE a.id = r.id AND r.rn > 1;

ALTER TABLE public.automations
  ADD CONSTRAINT automations_user_city_unique UNIQUE (user_id, city_id);

-- Optional belt-and-suspenders for the jobs table (partial unique index
-- on active generate_content jobs per slot per local UTC day):
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_generate_content_slot_uniq
  ON public.jobs (
    user_id, city, platform,
    (payload->>'slot'),
    (date_trunc('day', created_at AT TIME ZONE 'UTC'))
  )
  WHERE type = 'generate_content'
    AND status IN ('pending','processing','retrying');
```

User confirms before we run.

---

## 4. Logging contract

Every slot decision in the scheduler emits exactly one line:
```
[scheduler] Slot=morning City=Orlando Platform=youtube Status=Triggered
[scheduler] Slot=morning City=Orlando Platform=youtube Status=Skipped_Existing reason=job_pending
[scheduler] Slot=morning City=Orlando Platform=youtube Status=Skipped_Existing reason=recent_success
[scheduler] Slot=morning City=Orlando Status=Skipped_DuplicateRow kept=abc dropped=[xyz]
```

---

## 5. Out of scope
- No changes to render/voice/caption/platform-adapter code.
- No changes to `process-scheduled-posts` legacy path — guarded by `publish_locks` already.
- No UI redesign of SettingsPanel (just dedup-on-save via `citiesApi`).

---

## Files touched
- `supabase/functions/auto-post-scheduler/index.ts` (helpers + dedup + logging)
- `src/lib/citiesApi.ts` (upsertAutomation: handle multi-row, auto-merge)
- New migration (delete duplicates + UNIQUE constraint + partial index)

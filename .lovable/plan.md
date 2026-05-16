# Fix: publish_post verification false failures

Single-file change: `supabase/functions/_shared/job-handlers.ts`, `publishPost` handler (~lines 237–261).

## Changes

### 1. Relax the `post_history` verification query (line 237–245)
- Widen the lookup window from **30 → 60 minutes** (`sinceIso`).
- Replace the strict `.eq("city", post?.city ?? "")` with a loose OR match so `"Gainesville"` matches `"Gainesville, Florida"` and vice versa:
  ```ts
  const cityFull = (post?.city ?? "").trim();
  const cityShort = cityFull.split(",")[0].trim();
  // …
  .or(`city.eq.${cityFull},city.ilike.%${cityShort}%`)
  ```
  Only apply the `.or(...)` when `cityShort` is non-empty; otherwise skip the city filter entirely.

### 2. Don't throw when verification fails — warn and defer to scheduled_post (line 256–261)
Replace the `if (!successWithId) { throw … }` block with:
- Log a warning (`⚠ post_history verification found no row with external_id — checking scheduled_post status directly`) including `rows.length`.
- If `post?.status === "posted"`, log `"scheduled_post.status=posted — treating as success despite missing post_history row"` and **continue** (fall through to the success `return`).
- Only `throw new Error(reason)` when `post?.status` is anything other than `"posted"`.

### 3. Handle the success-fallthrough's return payload
When we fall through because `scheduled_post.status === "posted"` but `rows` is empty, the existing `return` block at lines 264–273 reads from `rows` for `published_platforms` / `external_ids`. That still works (it just emits empty arrays), but add `verification: "scheduled_post_status"` to the `output` so the JobsDashboard drilldown shows this path was taken.

## Why this is safe
- `process-scheduled-posts` writes `scheduled_posts.status = 'posted'` and the channel-level `system_logs` row only after a real adapter success with a video ID (see `process-scheduled-posts/index.ts` ~line 2733 hard-fail guard already in place).
- The verification step here is belt-and-suspenders; it should not override the authoritative status flag.
- Real failures still throw: when `post.status` is `failed`/`failed_precheck` (handled earlier at line 229) or anything not equal to `posted`.

## Verification
1. Run "Run This Slot Now" for Orlando — the `publish_post` job should now show **Succeeded** with `output.verification: "scheduled_post_status"` if the city-name mismatch was the cause.
2. Drop a fake `scheduled_posts.status='failed'` row → job should still fail loudly.
3. Edge logs should show the new warning line whenever the fallthrough fires, so we can quantify how often the city-name mismatch occurs.

## Out of scope
- Backfilling old "failed" job rows that were actually successful posts on YouTube.
- Normalizing `post_history.city` to a canonical form (separate cleanup).

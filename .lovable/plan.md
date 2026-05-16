## Goal

Prepend the city's local time to every generated post title and caption first-line, and track `has_timestamp_in_title` in `post_history.visual_metadata` so Growth Intelligence can measure lift. No schema changes, no video/posting pipeline changes, no overlay burn-in.

## Scope (what gets touched)

Only text-generation code paths:

1. `supabase/functions/daily-weather-post/index.ts` — title builder + history insert metadata
2. `supabase/functions/process-scheduled-posts/index.ts` — title builder + history insert metadata (mirror of #1; counts as title-generation, not pipeline)
3. `supabase/functions/generate-caption/index.ts` — caption first-line stamp (post-processing only)
4. `supabase/functions/_shared/caption-style.ts` — add a tiny shared helper for city → local hour string (avoids drift between the three call sites)

No changes to: render pipeline, posting adapters, cron, schema, RLS, edge functions outside the four above.

## Change 1 — Title prefix `[H AM/PM]`

Add a shared helper in `_shared/caption-style.ts`:

```text
CITY_TZ map: Orlando, Gainesville, Miami, Tampa, Jacksonville → America/New_York
             (fallback: America/New_York; extendable later)

getCityLocalStamp(city) →
   Intl.DateTimeFormat("en-US", { timeZone, hour:"numeric", minute:"numeric", hour12:true })
   round minutes: only render :30 or :45, otherwise drop minutes
   → "8 AM" | "2 PM" | "8:30 AM" | "2:45 PM"
```

In both `buildHookTitle` functions (daily-weather-post + process-scheduled-posts), prepend `[${stamp}] ` to the chosen title and re-apply the 95-char clamp after prepending.

Result: `[8 AM] Storms Rolling Into Orlando ⛈ 78° Today`

Applies to manual posts (daily-weather-post) and auto posts (process-scheduled-posts) since both go through these title builders.

## Change 2 — Caption first line

In `generate-caption/index.ts`, after the model response is finalized (after `stripUnverifiedReferences`), post-process the caption:

- Build `📍 ${city} · ${stamp} Update`
- If the existing first non-empty line already starts with `📍` or already contains the stamp, replace it; otherwise prepend it as a new first line followed by a blank line.
- Rest of the caption is untouched.

Only the caption text changes; the AI prompt itself stays the same to avoid regressions in tone/length.

## Change 3 — `has_timestamp_in_title` tracking

`post_history` already has a `visual_metadata jsonb` column → no migration.

In both history-insert sites (daily-weather-post line ~1929, and the equivalent insert in process-scheduled-posts), set:

```text
visual_metadata: { ...existingMetadata, has_timestamp_in_title: /^\[\d/.test(title) }
```

Detection regex matches the `[H` / `[H:30` opener so backfilled-without-stamp rows naturally read `false`. Growth Intelligence queries can then `group by visual_metadata->>'has_timestamp_in_title'`.

## Out of scope (explicit guardrails)

- No edits to `_shared/job-runner.ts`, `_shared/job-handlers.ts`, any platform adapter, Creatomate/JSON2Video calls, or cron.
- No overlay/burn-in: the stamp lives in `title` + `caption` strings only.
- No DB migration, no RLS change, no new column.
- `generate-hooks` is untouched (hook titles are auxiliary and not used for the final post title).

## Verification

- Deploy the three edge functions.
- Trigger a manual "Post Now" for Orlando → confirm title starts with `[H AM/PM]`, caption first line is `📍 Orlando · H AM/PM Update`, and the resulting `post_history` row has `visual_metadata.has_timestamp_in_title = true`.
- Inspect a recent historical row → `has_timestamp_in_title` is absent/false, confirming the field is additive.

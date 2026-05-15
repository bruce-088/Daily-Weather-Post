# Auto-Winner System — Additive Intelligence Layer

A self-improving learning layer built **on top of** existing tables and edge functions. Zero changes to render, posting, Creatomate, or auto-apply behavior. Everything is read-only against current pipeline; only new analytics columns and one new table are written to.

## Guardrails (encoded in code)

- No edits to: `daily-weather-post`, `process-scheduled-posts`, `video-render.ts`, any platform adapter, Creatomate config, `enqueue-preview-job`.
- No automatic settings changes anywhere. Layers 4/5/7 are suggestion-only and gated behind explicit user confirmation toggles (default OFF).
- All new feature flags default OFF except Layers 1–3 (read/display).

---

## Layer 1 — Performance Reader (extend existing)

`post_analytics` already exists with views/likes/comments/condition/time_of_day/has_voiceover/avg_view_duration_sec. We **extend** it (no rebuild) with the missing fields:

```text
ALTER TABLE post_analytics ADD:
  hook_type        text          -- 'A' | 'B' | 'C' (urgency/advice/insight)
  hook_text        text
  cinematic        boolean
  posted_at        timestamptz
  posted_hour      smallint      -- 0-23, in user timezone
  views_24h        integer
  views_7d         integer
  score            numeric        -- (views * 1.0) + (likes * 10) + (duration_pct * 50)
  city             text           -- denormalized for fast group-by
```

Backfill from `post_history` (hook_id → A/B/C map, cinematic_mode, created_at, views_count, likes_count). All values are **read** from `post_history` — no writes back to it.

A new edge function `compute-winner-stats` (cron every 6h) walks recent posts and:
1. Recomputes `views_24h` / `views_7d` / `score` for each `post_analytics` row.
2. Writes nothing back to `post_history`, `scheduled_posts`, or `weather_settings`.

## Layer 2 — Winner Detection

New table `winner_stats` (per user, per city) — pure aggregate output:

```text
winner_stats:
  user_id, city, computed_at
  best_hook_type      text     -- 'A'|'B'|'C'
  best_hook_avg       numeric
  best_hour           smallint
  best_hour_avg       numeric
  worst_hour          smallint
  worst_hour_avg      numeric
  best_condition      text
  best_condition_avg  numeric
  cinematic_lift_pct  numeric  -- (avg_on - avg_off) / avg_off * 100
  voice_lift_pct      numeric
  sample_size         integer
  raw                 jsonb    -- full breakdown for UI drill-down
```

`compute-winner-stats` populates this. Min sample size = 3 per bucket; otherwise field is null and UI shows "still learning."

## Layer 3 — Growth Intelligence card (Analytics tab)

New component `src/components/GrowthIntelligenceCard.tsx`, mounted inside `AnalyticsPanel.tsx` above existing `GrowthDashboard`. Reads from `winner_stats` for the active city.

Layout matches the spec:

```text
🏆 What's Working
Best Hook Style:    ⚡ Urgency (Hook A)   avg 142 views
Best Post Time:     🕕 6:00 PM            avg 138 views
Cinematic Lift:     +47% views when ON
Best Condition:     ⛈️ Storm posts        avg 155 views
Worst Time:         🕐 1:00 PM            avg 31 views
```

Empty state: "Need 3+ posts per pattern. Currently tracking N posts."

## Layer 4 — Gentle Auto-Apply (opt-in toggles)

Add to `weather_settings` (per user, default false):

```text
auto_apply_winning_hook       boolean default false
auto_adjust_post_times        boolean default false
auto_cinematic_for_storms     boolean default false
```

In `SettingsPanel.tsx` add an "Auto-Winner" section with three switches. Toggling ON triggers a confirmation dialog quoting the current winner ("Auto-Winner will now prefer Hook A and post at 6PM. Confirm?").

**Read-side only** for now: `daily-weather-post` and the scheduler are NOT modified. Instead we expose a helper `getAutoWinnerOverrides(userId, city)` in `_shared/winning-recipes.ts` that returns `{ preferred_hook, preferred_hour, force_cinematic }` only when both (a) the toggle is ON and (b) `winner_stats` has a clear winner. Wiring those overrides into the render pipeline is **out of scope for this task** (will be a separate, isolated PR with its own approval) so we don't violate the "don't touch render/posting" rule.

## Layer 5 — Auto-Repost Winner Suggestion

Edge function logic added inside `compute-winner-stats` (no new function): when a post's `views_24h > city_avg × 1.5`, insert into existing `notifications` and a new `winner_repost_suggestions` table:

```text
winner_repost_suggestions:
  id, user_id, post_id, city, suggested_at,
  reason text, status text  -- 'pending'|'dismissed'|'reposted'
```

UI: new section in `GrowthDashboard.tsx` titled "🔥 Outperforming posts" with `[Repost Variation]` (deep-links to existing `SchedulePostForm` prefilled, no auto-creation) and `[Dismiss]` buttons. Never creates a scheduled post automatically.

## Layer 6 — Pre-Post Content Score

`src/lib/postHealth.ts` already exists. Extend (don't replace) with a new function `computeContentScore(input, winnerStats)` returning:

```text
{ score: 0-100, checks: [{ ok|warn|info, label, tip? }] }
```

Display in `VideoPreviewDialog.tsx` review step as a non-blocking card:

```text
📊 Post Score: 84/100
✅ Strong hook selected
✅ Voice enabled
✅ Cinematic (storm detected)
⚠️ Afternoon slot (lower avg)
💡 Tip: Evening posts avg +40% views
```

Gated by feature flag `ENABLE_CONTENT_SCORE` (default true). Never blocks the Post button.

## Layer 7 — Smart Weather Triggers

New helper `src/lib/weatherTriggers.ts`:

```text
detectUrgency({ condition, tempNow, tempPrev24h }) →
  { trigger: boolean, reason: string,
    suggest: { hook: 'A', cinematic: true, earlier_minutes: 30 } }
```

Used **only** by the preview/review modal to display:

```text
⚡ Significant weather detected. Urgency mode recommended.
[Apply suggestion] [Ignore]
```

`Apply` mutates only the in-memory preview state (hook selection, cinematic toggle in the dialog). Posting/render pipeline unchanged.

---

## Files

**New**
- `supabase/functions/compute-winner-stats/index.ts`
- `src/components/GrowthIntelligenceCard.tsx`
- `src/lib/weatherTriggers.ts`
- `src/components/AutoWinnerSettings.tsx` (mounted inside SettingsPanel)
- `src/components/ContentScoreCard.tsx`

**Edited (additive only)**
- `src/components/AnalyticsPanel.tsx` — mount `GrowthIntelligenceCard`
- `src/components/GrowthDashboard.tsx` — add "Outperforming posts" section
- `src/components/SettingsPanel.tsx` — mount `AutoWinnerSettings`
- `src/components/VideoPreviewDialog.tsx` — mount `ContentScoreCard` + urgency banner
- `src/lib/postHealth.ts` — add `computeContentScore`
- `src/lib/featureFlags.ts` — add `ENABLE_CONTENT_SCORE`, `ENABLE_AUTO_WINNER`

**DB migrations**
1. `ALTER TABLE post_analytics` add columns + backfill from `post_history`.
2. `CREATE TABLE winner_stats` (RLS: users read own, service_role full).
3. `CREATE TABLE winner_repost_suggestions` (same RLS).
4. `ALTER TABLE weather_settings` add 3 auto-apply boolean columns (default false).

**Cron**
- `compute-winner-stats` scheduled every 6h via `pg_cron` (separate `supabase--insert` step after migrations).

---

## What this does NOT change

- `daily-weather-post`, `process-scheduled-posts`, `enqueue-preview-job`, all `_shared/*-adapter.ts`, `video-render.ts`, Creatomate templates, JSON2Video config — untouched.
- No existing analytics computation is removed; this layer runs alongside `analyze-performance` / `analyze-growth`.
- No automatic mutation of `weather_settings`, `automations`, or `scheduled_posts` from the auto-winner system. Every actionable suggestion requires a user click.

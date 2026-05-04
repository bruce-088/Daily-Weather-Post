# A/B Experiment Engine

## Context

The app already has an automation pipeline (`process-scheduled-posts`, `daily-weather-post`), an analytics sync (`sync-post-performance`, every 12h), and a learning loop (`hook_stats`, `growth_recommendations`, `_shared/learning-patterns.ts`). The A/B engine plugs in between them: it pairs posts, picks winners 24h later, and feeds the winning style back into the same learning surfaces the caption generator already reads.

## Plan

### 1. Database — new `experiments` table + `experiment_wins` rollup

Migration:

```
experiments (
  id uuid pk,
  user_id uuid not null,
  city text,
  variable_tested text not null,    -- 'hook' | 'tone' | 'visuals'
  variant_a_meta jsonb not null,    -- { hook, tone, visuals }
  variant_b_meta jsonb not null,
  post_id_a uuid,                   -- references post_history
  post_id_b uuid,
  scheduled_post_id_a uuid,
  scheduled_post_id_b uuid,
  winner_post_id uuid,
  winner_variant text,              -- 'a' | 'b' | 'tie'
  status text not null default 'gathering_data',  -- 'gathering_data' | 'concluded' | 'cancelled'
  insight_generated boolean not null default false,
  conclude_at timestamptz not null, -- post_a_time + 24h
  concluded_at timestamptz,
  created_at timestamptz default now()
)

experiment_wins (
  user_id uuid,
  variable text,         -- 'hook' | 'tone' | 'visuals'
  winning_value text,    -- e.g. 'question'
  wins int default 0,
  losses int default 0,
  win_rate numeric,
  last_win_at timestamptz,
  primary key (user_id, variable, winning_value)
)
```

RLS: users read own; service role full. Add `experiment_id uuid` + `experiment_variant text` columns to `scheduled_posts` and `post_history` so each post knows its experiment + side.

### 2. Pairing logic in scheduling

New `supabase/functions/_shared/experiments.ts`:
- `shouldRunExperiment(userId)` → 50% chance, skipped if user already has > 2 active experiments.
- `pickChallengerVariant(control)` → randomly flip ONE variable:
  - `hook`: statement ↔ question
  - `tone`: contrasting (professional ↔ playful, calm ↔ urgent)
  - `visuals`: gradient ↔ stock-video background
- `createExperimentPair(...)` inserts the row and returns A/B variant metadata.

Hook in:
- `process-scheduled-posts` and `daily-weather-post`: after creating Post A, if `shouldRunExperiment` is true, insert a second `scheduled_posts` +60 min later carrying the challenger variant; link both to a new `experiments` row.
- `generate-caption`: when called with an `experiment_variant`, apply the override (question hook line, forced tone, or visuals flag passed to the renderer).

### 3. Winner selection — `experiments-resolve` edge function (hourly cron)

For each `gathering_data` experiment with `conclude_at <= now()`:
1. Read latest `post_analytics` for both posts.
2. `engagement_score = (likes*2 + comments*3) / max(views, 1)`.
3. Pick winner — or `tie` if delta < 5% with ≥ 50 views each; `cancelled` if either side has 0 views.
4. Update experiment: `winner_post_id`, `winner_variant`, `status='concluded'`.
5. Roll up into `experiment_wins`.
6. Bump the winning hook's `hook_stats.avg_views` by ~10% so the existing exploit/explore reader prefers it next generation.
7. Insert a `notifications` row: "Experiment concluded — Question hooks beat Statement hooks (+34%)."

Schedule via `pg_cron` + `pg_net`, hourly.

### 4. Learning loop integration

Extend `_shared/learning-patterns.ts`:
- After `hook_stats`, also fetch `experiment_wins`.
- For variables with `wins ≥ 3` and `win_rate ≥ 0.65`, append a "PROVEN WIN" line to the prompt block — e.g. `Question hooks have outperformed Statement hooks 4 of 5 tests — keep favoring questions.`

### 5. UI — `src/components/GrowthLab.tsx`

Mounted in the Analytics tab above `AiInsightsCard`:
- **Active experiments**: A vs B mini-cards with current views/likes and "concludes in Xh".
- **Proven wins**: top `experiment_wins` rows with `wins ≥ 2` ("Question hooks win 80% of tests (4/5)").
- **AI recommendation**: derived client-side from the strongest proven-win row.
- Empty state when no experiments yet.

Optional Settings toggle `enable_experiments` (default true).

## Technical details

- 50% gate uses `Math.random()` — no determinism needed.
- +1h offset is hard-coded for v1.
- Tie threshold: < 5% delta with ≥ 50 views each.
- Insufficient data (0 views) → `cancelled`, no learning update.
- `hook_stats` boost is intentionally gentle (+10%); `analyze-growth` will overwrite with real numbers next run.
- Cron `experiments-resolve` runs as service role; user-facing functions keep `verifyUser`.

## Files

New:
- `supabase/functions/_shared/experiments.ts`
- `supabase/functions/experiments-resolve/index.ts`
- `src/components/GrowthLab.tsx`

Edit:
- `supabase/functions/process-scheduled-posts/index.ts`
- `supabase/functions/daily-weather-post/index.ts`
- `supabase/functions/generate-caption/index.ts`
- `supabase/functions/_shared/learning-patterns.ts`
- `src/pages/Index.tsx`
- Migration: `experiments`, `experiment_wins`, columns on `scheduled_posts`/`post_history`, RLS, hourly cron

No new secrets.

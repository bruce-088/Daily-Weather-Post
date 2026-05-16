## Advanced Analytics — Insight Engine

Five phases, all built on existing tables. One small schema migration adds derived fields to `post_analytics`; everything else reuses what's there.

---

### Phase 0 — Schema (one migration, additive only)

Add to `post_analytics`:
- `performance_score numeric` (0–100, nullable)
- `winning_factors jsonb default '[]'`
- `losing_factors jsonb default '[]'`

No new tables. `post_history.health_score` already exists and will be reused for the per-post badge.

---

### Phase 1 — Insight Engine in `analyze-performance`

After the existing content_insights aggregation, add a per-post scoring pass over the last 60 days of `post_analytics`:

- Pull each row + its matching `post_hooks` + `post_history` (for slot, tone, cinematic).
- Compute against the user's own baseline (avg views and avg engagement across their last 60d):
  - **performance_score** = weighted blend of view ratio (50%), engagement ratio (30%), retention proxy `avg_percentage_viewed` (20%), clamped to 0–100. Fall back to view ratio alone when retention is null.
  - **winning_factors[]** = labels for any factor ≥+15% vs baseline: `"hook:<text>"`, `"tone:<x>"`, `"slot:<x>"`, `"condition:<x>"`, `"cinematic"`, `"voiceover"`, `"cta:<x>"`.
  - **losing_factors[]** = same set but ≤−15%.
- Batch UPDATE post_analytics with the three fields (chunks of 200).
- Surface the top post per user into `ai_memory` (memory_type=`top_post`) so the caption generator's `getRelevantMemories()` immediately benefits.

Guard: skip users with fewer than 5 scored posts (Phase 5 safeguard).

---

### Phase 2 — Pattern Detection in `analyze-growth`

Extend the existing per-user loop:

- Compute slot × tone, slot × hook-prefix, condition × tone aggregates from the last 20–50 posts (use `post_analytics` + `post_hooks` already loaded).
- For each pair with ≥3 samples and ≥15% lift vs user baseline, write a row to `growth_insights` with:
  - `variable` = `"tone"` / `"hook"` / `"slot"` / `"condition"`
  - `winner_value`, `loser_value`, `delta_pct`
  - `title` / `message` in plain English: `"Cinematic tone performs +22% in Evening slot"`.
- Extend `growth_recommendations.recommendation` and write a new optional JSON field via the existing `top_hooks` / `best_slot` / `recent_tones` columns (no schema change — use a short next-action sentence already concatenated into `recommendation`).
- Existing realtime toast in `useGrowthInsights` will fire automatically for new pattern wins.

---

### Phase 3 — Growth Command Center UI

`src/components/GrowthDashboard.tsx` (and/or `GrowthCommandCenter.tsx`) gets three new sections, all reading from existing tables:

1. **Why It Won panel** — top `post_history` post by `views_count` last 30d; render its `winning_factors[]` (from joined `post_analytics`) as labeled chips with a one-line plain-English summary.
2. **Pattern Cards** — three cards (Best Tone / Best Slot / Best Hook Type) built from `content_insights` + `hook_stats` + `time_slot_stats`. Each card shows winner, delta %, and sample size.
3. **Actionable Recommendation** — primary CTA card backed by `growth_recommendations.recommendation`.

`PostHistoryList.tsx`: add a small **Performance Score** pill (0–100) per row, reading `post_analytics.performance_score` (fallback to `post_history.health_score`). Color-coded: ≥75 green, 50–74 amber, <50 muted. Hidden when null.

No new routes, no design system additions beyond existing semantic tokens.

---

### Phase 4 — Feedback Loop into `generate-caption`

Already calls `getTopPerformingPatterns()` + `getWinningStyleForCondition()` + `getRelevantMemories()`. Extend `buildLearningPromptBlock` (in `_shared/learning-patterns.ts`) to also surface:

- Top 1–2 `winning_factors` themes from recent high-scoring posts (queried from `post_analytics` with `performance_score >= 75`).
- 1 short few-shot example from `ai_memory` `top_post` entries (already supported — just ensure the new Phase-1 writes flow in).

Inject as an additional "PROVEN WINNERS — favor these patterns" block in the prompt, before the existing CTA/anti-clone block. Keep:
- anti-clone (last 3 captions) ✔
- CTA rotation ✔
- fail-safe try/catch fallback to base caption ✔

---

### Phase 5 — Safeguards (enforced in code)

- Min sample size **≥5 posts** before applying patterns (Phase 1 guard, Phase 2 ≥3 per pair, Phase 4 query gate).
- Variation: when injecting winning patterns into the caption prompt, include explicit instruction `"do not copy verbatim — vary opener and structure"`, plus the existing 70/30 exploit/explore in `learning-patterns.ts` is preserved.
- All new prompt blocks wrapped in `try/catch` — any failure falls through to base caption logic.

---

### Out of scope (not touched)

- `process-scheduled-posts`, `auto-post-scheduler`, cron schedule
- Routing guard, platform adapters, video render pipeline
- Auth, RLS policies, scheduled_posts schema

---

### Technical details

**Files changed**
- `supabase/migrations/<ts>_post_analytics_factors.sql` (additive only)
- `supabase/functions/analyze-performance/index.ts` (append scoring pass + ai_memory upsert)
- `supabase/functions/analyze-growth/index.ts` (append pattern-pair detection + growth_insights inserts)
- `supabase/functions/_shared/learning-patterns.ts` (add proven-winners block + helper)
- `supabase/functions/generate-caption/index.ts` (inject new block into prompt assembly, fail-safe)
- `src/components/GrowthDashboard.tsx` + `GrowthCommandCenter.tsx` (three new sections)
- `src/components/PostHistoryList.tsx` (score pill)
- `src/integrations/supabase/types.ts` auto-regenerates from migration

**Deploys**: `analyze-performance`, `analyze-growth`, `generate-caption`.

**Validation**
- Run `analyze-performance` and `analyze-growth` manually via `curl_edge_functions`, then inspect 5 sample `post_analytics.performance_score` + factor arrays.
- Open Growth tab; verify Why It Won + Pattern Cards + Recommendation render with real data and gracefully empty-state on <5 posts.
- Trigger one manual caption generation and confirm logs show the new "PROVEN WINNERS" block was injected without breaking fallback.

### Spec Delta (after implementation)

Sections 2 (Features), 6 (will be `Insight Engine` subsection), 9 (Caption Generation), and 14 (Resolved Issues) get updated in `generate-spec/index.ts` once shipped.

## A/B Testing System for YouTube Shorts

A safe, pipeline-only experiment layer that tests **one variable at a time** (hook / CTA / background). Gated by the existing `ENABLE_AB_TESTING` feature flag so nothing changes for users until they opt in.

### 1. Database (one migration)

Reuse the existing `experiments` table (already has `variable_tested`, `variant_a_meta`, `variant_b_meta`, winner, delta). Add what's missing:

- `experiments.experiment_type` text — `hook_test | cta_test | background_test`
- `experiments.rollout_mode` text default `manual_select_winner` — also `auto_rotate_variants`
- `experiments.city_id` uuid, `platform` text default `youtube`, `scheduled_slot` text (`morning|afternoon|evening|manual`)
- `scheduled_posts.variant_id` text (`A` / `B`) — joined to `experiment_id` (already exists)
- `post_history.variant_id` text and `post_analytics.avg_percentage_viewed`, `avg_view_duration_sec`, `subscribers_gained` (numeric) — additive, nullable
- New `experiment_variants` table is **not** needed; variant payload stays in `experiments.variant_a_meta` / `variant_b_meta` jsonb.

### 2. Variant generation rules (shared lib)

`supabase/functions/_shared/ab-variants.ts` — pure helper that takes a base preview bundle plus `experiment_type` and returns `{ variantA, variantB }` deltas only:

| Type             | Mutates                                      | Locked (must match base)                |
|------------------|----------------------------------------------|-----------------------------------------|
| `hook_test`      | first script line, first headline, 0–2s emphasis | weather, CTA, duration, background     |
| `cta_test`       | end-card text, CTA voice line, CTA animation | hook, forecast, background              |
| `background_test`| visual style, motion preset, particle overlay | hook, forecast, CTA                     |

A guard rejects any variant that mutates a locked field — protects against multi-variable drift.

### 3. Pipeline integration

Both variants go through the **same `generate_content → render_video → publish_post` pipeline** — no shortcuts. `triggerManualPipelinePost` and `process-scheduled-posts` learn one new branch:

- If a `scheduled_post.experiment_id` is set, the runner reads `variant_id` and applies the variant payload from `experiments.variant_<a|b>_meta` to the generation step.
- Each variant writes its own `post_history` row tagged with `variant_id`, `execution_mode`, `health_score`, `render_engine`, `voice_enabled` (already covered by debug_trace work).

### 4. Review modal UI

In `VideoPreviewDialog`, when `FeatureFlags.ENABLE_AB_TESTING` is on:

- New checkbox **"Create A/B variants"**
- When checked: show experiment-type dropdown (hook / CTA / background) and a **rollout mode** select (manual default / auto_rotate)
- Generate **two previews side-by-side** (reuses `generatePreview` with variant-specific overrides), each with its own `DebugLabels` + health card
- Posting creates two scheduled_posts (A + B) linked by `experiment_id`, both routed through the pipeline

### 5. New `ABComparePanel` component

```
src/components/ABComparePanel.tsx   ← side-by-side video + caption + health
src/components/ExperimentBadge.tsx  ← "A 🧪" / "B 🧪" / "Winner" / "Testing"
```

Badges reuse the sky-tone styling from `DebugLabels` so visual language stays consistent.

### 6. Analytics + winner logic

Extend `sync-platform-metrics` to capture the new YouTube fields (`averageViewPercentage`, `averageViewDuration`, `subscribersGained`) into `post_analytics`. Then a small `analyze-experiments` edge function (cron every 6 h) does:

```
score = 0.5 * avg_percentage_viewed_norm
      + 0.3 * avg_view_duration_norm
      + 0.15 * likes_norm
      + 0.05 * comments_norm
```

- `manual_select_winner` → writes `growth_insights` recommendation, no automatic action
- `auto_rotate_variants` → marks losing variant `archived`, promotes winner's payload to default for that slot/city via `experiment_wins`

A minimum sample (≥ 200 views per variant or 24 h elapsed) is required before declaring a winner.

### 7. Experiments tab in Analytics

New "Experiments" sub-tab inside `AnalyticsPanel` listing active + concluded experiments with:
- Type, city, slot, both variant thumbnails
- Live metric deltas
- "Pick winner A" / "Pick winner B" buttons (manual mode)
- Status pill: `Testing` / `Winner: A` / `Winner: B` / `Inconclusive`

### 8. Feature flag rollout

- `ENABLE_AB_TESTING = false` (default) → all UI hidden, pipeline behaves as today
- Flip on per-user via `localStorage.setItem("ff:ENABLE_AB_TESTING","true")`
- Hard guard in pipeline: experiment payload is ignored when flag is off, so accidental DB rows can't trigger variants

### Technical details

- Reuse `experiments` schema; only additive columns
- Variant payload lives in `variant_a_meta` / `variant_b_meta` jsonb — no new heavy tables
- Both variants share the same Job Pipeline, so `execution_mode` always `pipeline`
- `DebugLabels` already accepts `abVariant` — feeds straight from `scheduled_posts.variant_id` / `post_history.variant_id`
- Cron schedule for `analyze-experiments` is added via the Supabase insert tool, not a migration
- All variant publishing uses `triggerManualPipelinePost`; guardrails in `triggerDailyPost` / `publishPreviewBundle` stay intact

### Out of scope (intentionally)

- Multi-variable (multivariate) experiments — explicitly forbidden by rule 1
- Cross-platform A/B (only YouTube Shorts on first cut; TikTok/IG arrive in a follow-up once analytics parity exists)
- Auto-generation of "creative" variants by AI — variants are deterministic transforms of the base bundle

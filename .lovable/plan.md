## Context

The project already has a partial learning system: `content_insights`, `hook_stats`, and `growth_recommendations` are computed by the `analyze-performance` and `analyze-growth` cron functions, and `generate-caption` already injects "PERFORMANCE LEARNING" + "HOOK ROTATION" + "VARIETY" notes into the prompt.

What's missing from the user's spec:
- An explicit `engagement_score = (likes*2 + comments*3) / views` signal (currently uses `likes + comments + shares` summed).
- A clean `getTopPerformingPatterns()` helper returning {top hooks, best conditions, best time of day, avoid list}.
- Explicit FAVOR / AVOID phrase blocks in the prompt (today it's only "use this hook" — no avoid list, no generics filter).
- A 70/30 exploit/explore toggle so the AI sometimes invents new variations.
- A user-visible "AI Insights" panel summarizing what's working.

## Plan

### 1. New shared helper — `supabase/functions/_shared/learning-patterns.ts`
- `getTopPerformingPatterns(supabase, userId)` returns:
  - `topHooks` — up to 5 hooks from `hook_stats` with `uses ≥ 2`, sorted by `avg_views`.
  - `avoidPhrases` — generic phrases ("Weather Update", "Today's Forecast", "Daily Weather", "Weather Report") + 3 worst-performing hooks.
  - `bestCondition`, `bestTimeOfDay` — computed from `post_analytics` using the new `engagement_score` formula.
  - `conditionLifts[]` with `deltaPct` vs the user's baseline engagement (used by the UI).
  - `hookPrefixes[]` — top 5 two-word openers (e.g. "Feels Like").
- `buildLearningPromptBlock(patterns)` returns the prompt-injection text. Uses `Math.random() < 0.3` for EXPLORATION mode (no FAVOR list, fresh angle nudge), otherwise EXPLOITATION (lists FAVOR hooks + best prefix).

### 2. Wire into caption generation — `supabase/functions/generate-caption/index.ts`
- Replace the bespoke insight-assembly block (~lines 187–237) with:
  1. The existing `content_insights` lookup (kept — it provides condition/time-of-day specific tone steering).
  2. A call to `getTopPerformingPatterns` + `buildLearningPromptBlock` to append the FAVOR / AVOID block.
- The existing `growth_recommendations` "VARIETY" / "TONE NUDGE" notes stay — they complement the new block.
- Net effect: the prompt now explicitly contains both `Favor hooks similar to:` and `Avoid generic phrases like:` sections, plus a 70/30 explore/exploit decision.

### 3. New API surface for the UI — `src/lib/api.ts`
- Add `fetchAiInsights()` that:
  - Reads `hook_stats` (top 5 + worst 3), `content_insights`, and `post_analytics` (last 60d) for the current user.
  - Computes the same `conditionLifts[]` and `hookPrefixes[]` as the helper, client-side, so the panel works even if no edge function is deployed yet.

### 4. New UI — `src/components/AiInsightsCard.tsx`
- Glassmorphic card titled "AI Insights — what's working".
- Shows:
  - Top 3 condition lifts as one-liners: "☀️ Sunny posts perform 22% better than your average."
  - Top hook prefix: "Hooks starting with 'Feels Like' perform best (avg 1.2k views)."
  - Best time of day chip.
  - "Avoid" chips (generic + bottom-3 hooks).
  - Note: "30% of generations explore new angles to keep your feed fresh."
- Hook into the existing Analytics tab in `src/pages/Index.tsx`, just below the new `GrowthInsights` card.

### Technical details

- Engagement score is the spec formula `(likes*2 + comments*3) / views`, with `views` floored at 1 to avoid divide-by-zero.
- All reads use existing tables — no schema changes.
- The `getTopPerformingPatterns` helper requires `sample_size ≥ 2` per bucket to avoid noise from one-off posts.
- The 70/30 split is per-call randomness on the edge function side; the panel surfaces this to the user as an explainer line so they understand why outputs vary.
- `avoidPhrases` is capped at 6 items in the prompt to keep token usage low.
- No new cron jobs — `analyze-performance` already refreshes `content_insights` daily and `analyze-growth` refreshes `hook_stats`/`growth_recommendations` every 6h.

### Files touched

- New: `supabase/functions/_shared/learning-patterns.ts`
- New: `src/components/AiInsightsCard.tsx`
- Edit: `supabase/functions/generate-caption/index.ts` (swap the insight-assembly block)
- Edit: `src/lib/api.ts` (add `fetchAiInsights`)
- Edit: `src/pages/Index.tsx` (mount `AiInsightsCard` in the Analytics tab)

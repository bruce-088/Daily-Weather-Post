## Phase 1 Growth Loop — Performance Feedback for Title Generation

Lightweight per-city/platform feedback loop. Captures every published post, enriches with metrics, and feeds recent winners back into title generation as directional guidance only.

---

### 1. Schema — `post_performance` (migration)

New table with columns exactly as spec'd (id, post_id, city, platform, slot CHECK in morning/afternoon/evening, title, caption, hook_text, tone, style, weather_condition, posted_with_voice, published_at, views, likes, comments, impressions, ctr, engagement_score, source default 'system', created_at, updated_at).

RLS:
- Service role: full access
- Authenticated: read where exists matching `post_history.user_id = auth.uid()` via subquery on `post_id` (mirrors `post_analytics` pattern)

Indexes:
- `(city)`
- `(platform)`
- `(published_at desc)`
- composite `(city, platform, published_at desc)` for the lookup query
- `(post_id)` for sync updates

Trigger: reuse `public.update_updated_at_column()` on `updated_at`.

---

### 2. Publish-time insert (`_shared/platform-adapter.ts`)

In `postToPlatform`, after a successful adapter `uploadVideo` / publish (right after success branch, alongside the existing `[title_debug]` final log), insert into `post_performance` using metadata already in scope:

- `post_id` ← `postHistoryId` (the `post_history.id` already created upstream)
- `city` ← `cityName`
- `platform` ← normalized platform key
- `slot` ← `slot` arg (already plumbed through for slot-prefix enforcement)
- `title` ← final `cleanTitle` after `ensureSlotTitlePrefix`
- `caption`, `hook_text`, `tone`, `style`, `weather_condition`, `posted_with_voice` ← read from the post metadata object passed in (already available; we'll extend the `postToPlatform` signature with an optional `performanceMeta` object so call sites in `process-scheduled-posts`, `daily-weather-post`, `upload-preview-video`, `publish-preview-bundle` pass what they already know)
- `published_at` ← `new Date().toISOString()`
- views/likes/comments/impressions/ctr default to 0/null
- `source` ← `'auto' | 'manual' | 'preview'` based on the call site

Idempotent: insert only; if a row for the same `post_id` + `platform` already exists, do nothing (use `.upsert` on a unique `(post_id, platform)` constraint, allow null post_id without dedupe). Log `[analytics] inserted post_performance row for {city} {platform}` on success; warn-only on failure (never block publish).

---

### 3. Metrics enrichment (`sync-post-performance/index.ts`)

Extend the existing YouTube + TikTok sync loop. After each successful `post_history` metrics update, look up the matching `post_performance` row by `post_id + platform` and update:

- `views`, `likes`, `comments`
- `impressions` (YouTube only, if exposed; else leave null)
- `ctr` (YouTube only, if exposed)
- `engagement_score = views + likes*8 + comments*20 + (ctr != null ? ctr*200 : 0)`
- `updated_at = now()`

Add a final fallback pass: for any `post_performance` row from the last 14 days where `engagement_score IS NULL`, compute from current view/like/comment columns so the analyze step always has values.

Log `[analytics] updated metrics for post_performance row {id}`.

---

### 4. Insights fetch helper (`_shared/performance-insights.ts`, new)

Single exported function `loadCityPerformanceInsights(supabase, { city, platform, days = 14, limit = 5 })`:

1. Query top N `post_performance` rows for `(city, platform)` in the window, ordered by `engagement_score DESC NULLS LAST`.
2. If `< 3` rows → return `null` (clean skip).
3. Compute:
   - `topTitles`: array of `title` strings (capped 5, deduped)
   - `bestSlot`: highest avg `engagement_score` grouped by `slot`
   - `bestTone`, `bestStyle`: most common in the top 5 (only if both columns populated for ≥3 rows)
   - `avgViewsBySlot`: `{ morning, afternoon, evening }`
4. Returns a compact `{ city, platform, bestSlot, bestTone, bestStyle, topTitles, avgViewsBySlot, sampleSize }`.

Log `[analytics] loaded top performers for {city}` with sample size.

---

### 5. Prompt injection (`buildHookTitle` in `process-scheduled-posts` and `daily-weather-post`)

Both `buildHookTitle` implementations are currently deterministic string builders (no LLM call inside). Title generation that actually uses the LLM happens in `generate-caption`. Two integration points:

**a. `generate-caption/index.ts`** — Before building the system prompt, call `loadCityPerformanceInsights`. If non-null, append a `<PERFORMANCE_GUIDANCE>` block to the system prompt with the exact format from the spec:

```
Recent performance guidance for {city}:
- Best slot: {slot}
- Best tone: {tone}
- Best style: {style}
- Top-performing recent titles:
  1. ...
  2. ...
- Patterns that perform well:
  - urgency around storms
  - short punchy hooks
  - local specificity

Rules:
- Directional only. NEVER copy a previous title exactly.
- NEVER override slot-prefix rules ([8 AM]/[1 PM]/[6 PM]).
- NEVER override city/location guardrails (only "{city}" allowed).
- Use insights to refine hook/tone only.
```

Log `[analytics] injecting performance guidance into title generation` with `{ city, platform, sampleSize }`.

**b. `buildHookTitle` fallback paths** — Leave untouched. They are deterministic fallbacks; injecting guidance there would add complexity for no LLM benefit. The slot-prefix guard remains the final authority.

---

### 6. UI (optional light touch)

Extend `GrowthSummaryCard` (already on Dashboard) with a single new section "Recent Winners" per active city:
- best slot label
- top recent title (one line, truncated)
- avg views last 7d / 14d (two small stats)

Reads from a new lightweight query against `post_performance` (active city + primary platform). Hidden if `sampleSize < 3`. No new route, no new card.

---

### 7. Out of scope (confirmed)

- No MCP, no event awareness, no multi-platform recommender, no ranking model
- No edits to slot-prefix logic, location sanitizer, or post_history schema
- No new cron — sync runs inside the existing `sync-post-performance` schedule

---

### 8. Spec delta (`generate-spec/index.ts`)

Append RESOLVED_FEATURES rows:
- New `post_performance` table + RLS
- Publish-time insert in `postToPlatform`
- Metrics enrichment + `engagement_score` formula in `sync-post-performance`
- `loadCityPerformanceInsights` shared helper
- `<PERFORMANCE_GUIDANCE>` injection in `generate-caption` system prompt with directional-only rules
- `GrowthSummaryCard` Recent Winners section

---

### Files touched

- **New migration** — `post_performance` table, indexes, RLS, updated_at trigger
- **New** `supabase/functions/_shared/performance-insights.ts`
- **Edit** `supabase/functions/_shared/platform-adapter.ts` (insert on publish, extend signature)
- **Edit** `supabase/functions/process-scheduled-posts/index.ts` (pass `performanceMeta`)
- **Edit** `supabase/functions/daily-weather-post/index.ts` (pass `performanceMeta`)
- **Edit** `supabase/functions/upload-preview-video/index.ts` + `publish-preview-bundle/index.ts` (pass `performanceMeta`, source='preview')
- **Edit** `supabase/functions/sync-post-performance/index.ts` (mirror updates + engagement_score)
- **Edit** `supabase/functions/generate-caption/index.ts` (load insights, inject guidance block)
- **Edit** `src/components/GrowthSummaryCard.tsx` (Recent Winners section)
- **Edit** `supabase/functions/generate-spec/index.ts` (spec delta)

### Success verification

1. Trigger a manual Post Now → confirm new `post_performance` row inserted (logs + DB).
2. Run `sync-post-performance` → confirm row updated with metrics + `engagement_score`.
3. Trigger next caption generation for same city → confirm `[analytics] injecting performance guidance` log + system prompt contains the block (via `enable_debug_trace`).
4. Verify slot prefix still present on resulting title and location guardrail unchanged.

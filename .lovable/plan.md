## Goal

Kill the "Beautiful Day In Gainesville" repetition loop by penalizing recently-used hooks/styles per city, forbidding them in the prompt, forcing a fresh focus angle each post, and varying the stock-image background search.

No changes to scheduling, posting pipeline, or analytics collection.

---

## 1. `supabase/functions/_shared/learning-patterns.ts` — Creative Decay

Extend `getTopPerformingPatterns` and `buildLearningPromptBlock` so cooldown is city-aware.

- **New signature:** `getTopPerformingPatterns(supabase, userId, opts?: { city?: string })`. `city` is optional so existing callers that don't pass it still work; cooldown logic just no-ops.
- **New query** (when `city` provided): pull last 48h of `post_history` for `(user_id, city)` ordered by `created_at desc`, selecting `hook_used`, `caption`, `created_at`. Limit ~20.
- Build a `recentHookUseCount: Map<normalizedHook, number>` from those rows (normalize = lowercase, trim, collapse whitespace, strip punctuation). Also keep the last 3 distinct openers verbatim → `forbiddenOpeners: string[]`.
- Extract recent **style keywords** by scanning each recent caption/hook for known theme tokens: `beautiful day`, `comfortable`, `gorgeous`, `perfect day`, `lovely`, `nice day`. Anything appearing ≥2× in the 48h window → `forbiddenThemes`.
- **Decay rule:** when computing `topHooks` (existing block, lines 54–58), apply an 80% weight penalty to any hook whose normalized form has `recentHookUseCount >= 2` (i.e., used >2× counting the current attempt would be ≥3, so we cool down at ≥2 in the 48h window per spec). Re-sort by penalized `avg_views * weight` before slicing the top 5. High-scoring-but-overused hooks fall off the list.
- Extend `TopPatterns` with `forbiddenOpeners?: string[]` and `forbiddenThemes?: string[]`.
- **`buildLearningPromptBlock`** — append a `FORBIDDEN REPETITIONS:` section (only when arrays are non-empty) listing each forbidden opener and theme, with instruction: *"Do NOT start with, paraphrase, or build the post around any of these — they have been used in the last 3 city posts."*

Caller update in `supabase/functions/generate-caption/index.ts` line 280: pass `{ city }` to `getTopPerformingPatterns`. No other call sites need changes (city is optional).

---

## 2. `supabase/functions/generate-caption/index.ts` — Diversity Guard + Focus Rotation

- **Diversity Guard block** (new const near `styleNote`/`variationNote`, inserted into `userPrompt` alongside `${styleAddendum}${insightNote}`):

  ```
  DIVERSITY GUARD:
  CRITICAL: Do NOT reuse the "Beautiful Day" or "Comfortable" themes if they were used recently for this city. Force a shift to a different angle — wind, humidity, visibility, dew point, UV, specific local activities, or cinematic atmosphere. If conditions are mild, pick the SECONDARY most interesting weather signal and lead with that instead of temperature.
  ```

- **Focus Rotation:** add a deterministic-but-varying focus picker:
  - Pool: `["Landscape", "Sky", "Street Level", "Atmospheric Detail", "Human Activity"]`.
  - Pick index = `(hash(city) + dayOfYear + slotIndex) % pool.length` so consecutive posts for the same city land on different focuses. (`slotIndex`: morning=0, afternoon=1, evening=2, else current hour.)
  - Inject as: `FOCUS ANGLE: Frame this post from a "${focus}" perspective. Do not default to a wide "beautiful day" overview.`
  - Append after the Diversity Guard.

Both blocks are precomputed in the existing fail-safe `try/catch` near `personalityBlock` (lines 327–344) so any failure silently drops them.

---

## 3. `supabase/functions/_shared/video-render.ts` — Background Variation

Update `fetchPexelsStillForCondition(condition, city)`:

- **Secondary keyword pool** (random per call): `["foliage", "architecture", "horizon", "aerial", "street", "skyline", "trees", "rooftop", "park", "downtown"]`.
- Build query as `${primary} ${secondary}` where `primary` is today's condition-derived term (existing logic) and `secondary` is randomly picked.
- **City-scoped variety:** include `city` in the Pexels query (`${primary} ${secondary} ${city}` when city is non-empty), and randomize across the top 10 results instead of top 5. This guarantees Gainesville's "clear sky" doesn't pull the same shared stock photo as Orlando's "clear sky".
- Add a short log line: `[ken-burns] pexels q="…" picked=index/total` for debuggability.

No caching layer to invalidate — current code already fetches fresh each render — but we document the city scoping in a code comment so future caching keeps `city` in the key.

---

## Out of scope (explicitly untouched)

- `process-scheduled-posts`, `auto-post-scheduler`, cron schedules.
- `post_analytics` / `post_history` writes (read-only access from learning-patterns).
- Creatomate template JSON, render fallback chain, voice pipeline.
- Database schema, RLS, or migrations.

---

## Verification

- Lint/typecheck via build.
- Quick edge-function deploy of `generate-caption` + (no deploy needed for `_shared` consumers — they redeploy with their parents) and confirm logs show `FORBIDDEN REPETITIONS` + `FOCUS ANGLE` lines on the next Gainesville run.

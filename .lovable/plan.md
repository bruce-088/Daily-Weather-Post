
# Yearly Recap — Long-form "Year in Review" Video

A premium long-form (3–5 min) YouTube product summarizing a city's weather year. Reuses the existing weekly/monthly recap architecture and the shared `cinematic-presets.ts` module. Manual-trigger only; admin-gated.

## 1. New edge function: `create-yearly-recap`

Cloned from `create-monthly-recap` with a 12-month aggregation window. Same env handling (Lovable AI, Creatomate, ElevenLabs key resolution, optional `RECAP_MUSIC_URL` bed at 0.15), same fallback infographic on stitch failure, same CORS/auth pattern.

**Input** (POST JSON):
- `city: string` (required)
- `year: number` (defaults to current year)
- `user_id?: string` (service-role override)
- `skip_post?: boolean` — dev mode, returns `preview_url`, no YouTube upload, no `post_history` write
- `test_mode?: boolean` — alias accepted for parity with other recaps

**Output**: `{ status, preview_url?, slides, video_url?, detail? }`.

**Failure-safe**: any season with no data is skipped (slide omitted) rather than failing the render. If <2 seasonal slides survive, falls back to the infographic path.

## 2. Data aggregation (one full year)

Query `post_history` (`status in ('succeeded','success')`, `user_id`, `ilike city`, `created_at` within `[Jan 1 year, Jan 1 year+1)`) joined opportunistically with `post_performance` / `post_analytics` for engagement.

Compute:
- **Seasonal buckets** — Winter (Dec prev year + Jan + Feb), Spring (Mar–May), Summer (Jun–Aug), Fall (Sep–Nov). For each bucket: best/worst day by temperature, dominant condition, top post by views.
- **Big swings** — sort days by |Δtemp day-over-day|; keep top 1–2.
- **The Big One** — single post with max severity score: prefer severe condition match (`storm|hurricane|tornado|blizzard|extreme heat`), tiebreak by views_24h then likes.
- **Annual stats** — total rainy days, sunniest month (% clear), highest/lowest temp + date, total posts.

All aggregation lives in a single `aggregateYear(rows)` helper. Returns a typed `YearlyData` struct that drives composition.

## 3. Composition — 8-slide long-form

| # | Kind          | Source                                | Cinematic kind we pass to `pickPresetForRecapSlide` |
|---|---------------|---------------------------------------|------------------------------------------------------|
| 1 | Intro         | "{year} Year in Review: {City}"       | `title` → `broadcast_lite`                           |
| 2 | Winter        | best/worst + condition headline       | `day`   → `broadcast_lite` (seasonal intro line)     |
| 3 | Spring        | "                                     | `day`   → `broadcast_lite`                           |
| 4 | Summer        | "                                     | `day`   → `broadcast_lite`                           |
| 5 | Fall          | "                                     | `day`   → `broadcast_lite`                           |
| 6 | The Big One   | hero severe event                     | `highlight` → `cinematic_weather` or `event_mode`    |
| 7 | Annual Stats  | quick-fire numbers                    | `week_stat` → `broadcast_lite`                       |
| 8 | Outro         | "Onward to {year+1}"                  | `outro` → `broadcast_lite`                           |

Seasonal slides escalate to `cinematic_weather` only when that season's hero condition matches `SEVERE_RE` AND `smart_cost_strategy !== false`. Keeps cost low by default while preserving the wow moment on slide 6.

Each slide builds its background via:

```ts
const preset = pickPresetForRecapSlide({ kind, condition, city, slideIndex, settings });
const decision = resolveScene({
  city, condition, mediaUrl: bestPost?.image_url, preset, mode: "image", slideIndex, settings,
});
logCinematic("yearly_recap", decision, { city, kind, slide: slideIndex });
decisions.push(decision);
```

`mediaUrl` priority: top post `image_url` for the season/event → falls through the standard chain (history → condition_scene → city_safe_scene for Gainesville → gradient). The Gainesville strict-visual override is honored automatically because `resolveScene` reads `settings.strict_visuals_gainesville`.

## 4. Audio

- Reuse the recap voice helper (`resolveVoiceId`, `clampVoiceParam`) and ducked music bed (`RECAP_MUSIC_URL` at 0.15) exactly as monthly does.
- Voice script generated via Lovable AI with a year-in-review prompt: opener, four ~10s seasonal beats, one ~20s Big-One narration, stats burst, outro. Total script length capped at ~700 chars to stay under ~3 min spoken + room for music tails.
- Voice failure → continue with silent render (same pattern as weekly recap voice fallback).

## 5. Learning firewall

The firewall is already in `resolveScene` (any `gradient_only`/`degraded_fallback` decision returns `eligibleForLearning: false`). No separate code path is needed — by routing every yearly slide through `resolveScene` we get firewall behavior for free.

Recap-level summary insert into `system_logs`:

```ts
{
  type: "yearly_recap_render",
  message: `Yearly recap rendered for ${city} ${year}`,
  user_id,
  context: {
    year, city,
    slides: decisions.map(d => ({ preset: d.preset, source: d.source, eligible: d.eligibleForLearning })),
    eligible_count, fallback_count,
  },
}
```

Yearly recap slides intentionally do **not** write per-slide `post_history` rows — the existing weekly/monthly recap precedent is one parent `post_history` row only when YouTube upload succeeds. We carry the same pattern and attach `visual_metadata` + `published_visual_source` on that single row using the *worst-eligible* slide (so any fallback slide demotes the parent row from learning, matching daily semantics).

## 6. UI — admin-gated trigger in City Command Center

Add a third Run-Type alongside daily/weekly/monthly:

```
type RunType = "daily" | "weekly" | "monthly" | "yearly";
```

- Add Post + Dev buttons (`▶ Post Yearly Now` / `🛠 Dev: Test Yearly`).
- New row only renders when the current user is an admin. Admin check: read `is_admin` from a new `user_roles`-style helper, or — to avoid scope creep — gate behind a feature flag `ENABLE_YEARLY_RECAP` in `src/lib/featureFlags.ts` (default false, localStorage override). Pick **feature flag** because there is no existing admin role infrastructure in the repo and adding one is out of scope.
- Button passes `{ city: c.name, year: currentYear, skip_post: isDev }`. Dev branch reuses the existing `preview_url` surface ("View Test Result").

## 7. Spec & version

- Bump `APP_VERSION` in `generate-spec/index.ts` to `"1.6.0"`.
- Add a `YEARLY_RECAP_SYSTEM` constant rendered as **Section 11** (push the previously-numbered Section 11 → 12, etc.). Content covers input, season buckets, 8-slide composition, cinematic preset reuse, firewall reuse, admin gating.
- Add a `FEATURES` entry: "Yearly Recap (long-form year-in-review video, admin-only)".

## Technical notes

- File layout: `supabase/functions/create-yearly-recap/index.ts` only — no shared changes required beyond the new function (cinematic-presets module already exposes everything we need).
- Logging prefix: `[yearly-recap]` for function-level, `[cinematic]` lines emitted by `logCinematic` per slide.
- Idempotency: derive a `content_hash` from `city|year` so re-runs within the same year find an existing successful render and short-circuit (mirrors weekly behavior).
- No new tables, no migrations.
- No changes to `process-scheduled-posts`, `auto-post-scheduler`, daily pipeline, or platform adapters.

## Out of scope (explicit)

- No automatic scheduled cron — manual trigger only for v1.
- No multi-year comparison.
- No per-slide `post_history` rows.
- No new admin role table — gated via feature flag.

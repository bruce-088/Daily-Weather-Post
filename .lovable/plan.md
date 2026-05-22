
# Cinematic Preset System

Fixes Gainesville's plain-render drift, controls cost via image-first defaults, and stops the learning loop from rewarding gradient/fallback renders. Voice, music, captions, routing, scheduling, and platform adapters are untouched.

## 1. Migration (additive, default-on, null-safe)

Add to `weather_settings`:
```
smart_cost_strategy             boolean not null default true
strict_visuals_gainesville      boolean not null default true
exclude_fallback_from_learning  boolean not null default true
```
RLS unchanged. Defaults cover existing rows.

## 2. Gainesville safe-scene assets

Upload 2–3 curated landscape JPGs to the existing public `brand-assets` bucket at `cinematic/gainesville-*.jpg` (e.g. `oak-canopy.jpg`, `downtown-skyline.jpg`, `prairie-storm.jpg`). Referenced via permanent public URLs:
```
https://pewdswjhsesfondewucc.supabase.co/storage/v1/object/public/brand-assets/cinematic/gainesville-<name>.jpg
```
No signed/expiring URLs. If the user has not yet uploaded files, the module still ships with the constant URL list; missing files log a warning and the chain falls through to the next tier (renders never break).

## 3. New shared module — `supabase/functions/_shared/cinematic-presets.ts`

Single source of truth. Pure helpers, no DB writes.

```ts
export type CinematicPreset = "broadcast_lite" | "cinematic_weather" | "event_mode";
export type RenderSource =
  | "history_image" | "condition_scene" | "city_safe_scene"
  | "video_scene"   | "gradient_only"   | "degraded_fallback";
export type CostTier = "low" | "medium" | "high";

export interface SceneDecision {
  preset: CinematicPreset;
  source: RenderSource;
  label: string;
  url?: string;
  costTier: CostTier;
  eligibleForLearning: boolean; // false iff source ∈ {gradient_only, degraded_fallback}
}

pickPresetForDaily({ condition, severity, slot, city, settings }): CinematicPreset
pickPresetForRecapSlide({ kind, condition?, city, slideIndex, settings }): CinematicPreset
resolveScene({ city, condition, mediaUrl, preset, mode, settings }): SceneDecision
logCinematic(prefix, decision, ctx): void
buildVisualMetadata(decision, prevMeta?): Record<string, unknown>
isEligibleVisualMetadata(meta): boolean   // null/unknown → true (backward-compatible)
isEligiblePublishedSource(source): boolean
```

Internals:
- `CONDITION_SCENES` — moved from recap files (5 stock URLs).
- `GAINESVILLE_SAFE_SCENES` — 2–3 permanent public-bucket URLs.

### Preset selection rules

- **Daily** → default `broadcast_lite`; upgrade to `cinematic_weather` for stronger conditions (rain/snow/fog/thunder/wind ≥ threshold); `event_mode` only on severe keywords (storm, severe, tornado, blizzard, extreme heat). All upgrades gated by `settings.smart_cost_strategy`.
- **Weekly** → all day slides `broadcast_lite`; standout day → `cinematic_weather`. Title/outro stay `broadcast_lite`. Never `event_mode`.
- **Monthly** → stat slides `broadcast_lite`; Moment-of-the-Month → `cinematic_weather`; escalate to `event_mode` only if severe.

### Gainesville fallback chain (explicit)

When `settings.strict_visuals_gainesville === true` AND `mode !== "gradient"`, `resolveScene` walks tiers in order and stops at the first that yields a URL:

| # | Tier              | Used when                                                                                | `source`              | Eligible |
|---|-------------------|------------------------------------------------------------------------------------------|-----------------------|----------|
| 1 | history_image     | `mediaUrl` provided & non-empty                                                          | `history_image`       | true     |
| 2 | condition_scene   | tier 1 unavailable AND `pickConditionScene(condition)` returns a URL                     | `condition_scene`     | true     |
| 3 | city_safe_scene   | tiers 1+2 unavailable AND ≥1 Gainesville safe scene URL is present in the module         | `city_safe_scene`     | true     |
| 4 | gradient_only     | tiers 1+2+3 all unavailable (no media, no condition match, no Gainesville safe scene)    | `gradient_only`       | false    |

Any throw → `degraded_fallback` (eligible=false), gradient still drawn. Other cities skip tier 3.

### Preset → overlay treatment (CSS/image layers, no new APIs)

- `broadcast_lite`: image + 25% themed gradient + subtle 1.0→1.05 scale
- `cinematic_weather`: + soft vignette + brand-tinted overlay + slower Ken Burns
- `event_mode`: + top/bottom scrims + stronger zoom + brand watermark pulse

## 4. Wire into pipelines

- `create-weekly-recap/index.ts` — replace inline `CONDITION_SCENES`/`pickConditionScene`/`buildSlideBackground` with shared module calls. Collect each slide's `SceneDecision`.
- `create-monthly-recap/index.ts` — same swap. Moment slide passes `kind: "highlight"` + `mediaUrl` + condition.
- `daily-weather-post/index.ts` — call `pickPresetForDaily` + `resolveScene` around existing visual-selector site; apply overlays in Creatomate source. Image-first stays default.

## 5. Persist richness — all three daily publish paths

Shared helper `attachCinematicToPostHistory(row, decision)` merges into insert payload:
```
visual_metadata: { ...prev, preset, source, label, costTier, eligibleForLearning }
published_visual_source: decision.source
```
Applied at:
- `daily-weather-post/index.ts:1949`
- `process-scheduled-posts/index.ts:3038` — decision pulled from job payload or recomputed from stored render context
- `publish-preview-bundle/index.ts:94` — decision pulled from `preview_bundles.render_config`

Recaps insert one `system_logs` row per render: `type='cinematic_recap_render'`, `context={ kind, slides:[SceneDecision], summary:{ presetCounts, eligibleCount } }`.

Backward compat: older null-metadata rows are treated as eligible.

## 6. Visual learning firewall (gated by `exclude_fallback_from_learning`, default ON)

Null-safe filtering in 4 reader paths:
- `_shared/winning-recipes.ts` — add `published_visual_source` to `.select`; post-filter with `isEligibleVisualMetadata && isEligiblePublishedSource`.
- `_shared/style-rotation.ts` — same filter.
- `compute-winner-stats/index.ts` — exclude non-eligible rows from `cinOn`/`cinOff` lift and `best_condition`. Hook + hour aggregations unchanged.
- `analyze-performance/index.ts` — skip excluded rows when computing the `cinematic` winning factor. Hook/tone/voiceover factors unchanged.

All short-circuit when toggle = false. Caption/hook/tone learning untouched.

## 7. Settings UI

New "Cinematic Presets" card in `src/components/SettingsPanel.tsx` with three Switches bound to the new columns via the existing settings save/load helper. Helper text under each toggle.

## 8. Logging

Standardized via `logCinematic`:
```
[cinematic] city=Gainesville kind=daily preset=broadcast_lite source=condition_scene label=rainy_sky eligible=yes cost=low
[cinematic] city=Gainesville kind=daily preset=broadcast_lite source=city_safe_scene label=gnv_oak_canopy eligible=yes cost=low
[cinematic] city=Gainesville kind=daily preset=broadcast_lite source=gradient_only eligible=no cost=low fallback=yes
[cinematic] kind=weekly slide=4 preset=cinematic_weather source=history_image eligible=yes
[cinematic] kind=monthly slide=moment preset=cinematic_weather source=history_image eligible=yes
```

## 9. Spec Delta

Append a Resolved Issues entry in `generate-spec/index.ts`: presets, Smart Cost Strategy, Gainesville strictness + `city_safe_scene` tier (permanent public-URL guarantee), richness fields at all three daily insert sites, `system_logs` `cinematic_recap_render`, firewall touchpoints, three new settings columns. Deploy `generate-spec`.

## Rollout order

1. Migration → 3 settings columns
2. Upload Gainesville safe-scene JPGs to `brand-assets/cinematic/` (user action; module ships with URLs regardless)
3. Shared module `cinematic-presets.ts`
4. Wire `daily-weather-post` + write richness at insert
5. Wire `process-scheduled-posts` + `publish-preview-bundle` insert sites (decision via job payload / `preview_bundles.render_config`)
6. Wire weekly + monthly recaps + `system_logs` rows
7. Firewall filters across 4 reader paths
8. Settings UI card
9. Update `generate-spec` + deploy

## Verification

- Gainesville daily, history image → `history_image` eligible
- Gainesville daily, no history, rainy → `condition_scene` eligible
- Gainesville daily, no history, no condition match, safe scenes present → `city_safe_scene` eligible
- Gainesville daily, no history, no condition match, no safe scenes → `gradient_only` not eligible, render completes
- Any throw → `degraded_fallback` not eligible, render completes
- Orlando daily, no history → `condition_scene` then `gradient_only` (skips tier 3)
- All three publish paths write `visual_metadata.{preset,source,label,costTier,eligibleForLearning}` + `published_visual_source`
- Weekly recap logs: mostly `broadcast_lite`, one `cinematic_weather`; monthly: stat `broadcast_lite`, Moment `cinematic_weather`
- Synthetic `gradient_only` row excluded from `cinematic_lift_pct` after re-running `compute-winner-stats`
- Toggle `exclude_fallback_from_learning` off → firewall stops applying
- `curl` Gainesville safe-scene URL → 200 OK from public storage, no expiration

## Out of scope

Voice, music, captions/hook/tone, routing, scheduling, platform adapters. Daily Shorts do not become video-first. No new buckets/credits/external APIs.

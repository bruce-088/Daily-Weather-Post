
# Dynamic Background Scenes for Recaps

Upgrade `buildAnimatedGradientBg` in both recap functions so each slide gets a real visual scene (image, optionally video) behind a translucent themed gradient. Falls back to the current gradient-only behavior on any failure, so renders never break.

## Scope

Files:
- `supabase/functions/create-weekly-recap/index.ts`
- `supabase/functions/create-monthly-recap/index.ts`

Out of scope: daily Shorts pipeline, scrim/text layers, voice, music, timing.

## What changes

### 1. New shared helper `buildSlideBackground(...)`

Replaces direct calls to `buildAnimatedGradientBg` at slide-build sites. Signature:

```ts
buildSlideBackground({
  time, duration, slideNum,
  grad,                 // { from, to, label } — themed gradient (still required)
  mode: "image" | "video" | "gradient",
  mediaUrl?: string,    // pre-resolved (e.g. p.image_url) — takes priority
  condition?: string,   // used to pick a stock scene when mediaUrl is missing
})
```

Returns an **array** of Creatomate elements in z-order:
1. Background scene (image or video) — full-frame, cover fit
2. Themed gradient (existing helper) at reduced opacity (20–30%)

If both the scene and the gradient fail to produce a valid layer, returns gradient-only (current behavior). Render never fails.

### 2. Background scene layer

**Image mode**
```ts
{
  type: "image",
  source: mediaUrl,
  fit: "cover",
  width: "100%", height: "100%", x: "50%", y: "50%",
  animations: SAFE_IMAGE_ANIM
    ? [{ type: "scale", from: 1.0, to: 1.05, easing: "linear" }]
    : undefined,
  time, duration,
}
```

**Video mode** (recaps don't use this today, but the helper supports it for future Shorts use)
```ts
{
  type: "video",
  source: mediaUrl,
  fit: "cover",
  loop: true,
  width: "100%", height: "100%", x: "50%", y: "50%",
  animations: [{ type: "scale", from: 1.0, to: 1.05, easing: "linear" }],
  time, duration,
}
```

### 3. Gradient overlay

Reuse existing `buildAnimatedGradientBg` but add an `opacity` param (default `1.0`). When a scene layer is present, call it with `opacity: 0.25` so the warm/cool/neutral tint remains visible without hiding the photo. When no scene, opacity stays `1.0` (current look preserved).

### 4. Condition → stock scene map

Add a constant `CONDITION_SCENES` (CC0 image URLs, served from an existing public bucket or curated CDN):

```ts
const CONDITION_SCENES: Array<{ match: RegExp; label: string; url: string }> = [
  { match: /storm|thunder|lightning/i, label: "storm_clouds", url: ".../storm.jpg" },
  { match: /rain|drizzle|shower/i,     label: "rainy_sky",    url: ".../rain.jpg"  },
  { match: /snow|sleet|blizzard/i,     label: "snowy_sky",    url: ".../snow.jpg"  },
  { match: /cloud|overcast|fog|mist/i, label: "cloudy_sky",   url: ".../cloudy.jpg"},
  { match: /clear|sunny|sun\b/i,       label: "bright_sky",   url: ".../sunny.jpg" },
];
function pickConditionScene(cond?: string | null) { /* first match or null */ }
```

Resolution order inside `buildSlideBackground`:
1. Explicit `mediaUrl` (e.g. `p.image_url` from history) → use it, label as `"history_image"`.
2. Otherwise `pickConditionScene(condition)` → use stock URL.
3. Otherwise gradient-only.

URLs will be hosted in the existing public brand asset bucket (uploaded as part of this change). Five small JPEGs, ~1080×1920.

### 5. Call-site updates

**Weekly recap** (`create-weekly-recap/index.ts`)

- Title slide: `mode: "image"`, `condition: undefined` → gradient-only fallback (no theme image needed for title).
- Day slides (currently lines ~501–526): replace the if/else (image branch vs gradient branch) with a single `buildSlideBackground({ mode: "image", mediaUrl: p.image_url, condition: p.condition, grad: {...THEMES[themeKey], label: themeKey}, slideNum: i+2 })`. Removes duplicated image-layer code.
- Outro slide: gradient-only (no condition signal).

**Monthly recap** (`create-monthly-recap/index.ts`)

- Title + outro: gradient-only.
- Week-stat slides: pass `condition: weekStat.dominantCondition` if available; otherwise gradient-only.
- Moment-of-the-Month slide (line ~657): pass `mediaUrl: monthly.moment?.post.image_url` plus its condition, so the existing image layer is folded into the helper instead of being appended separately.

### 6. Logging

Inside `buildSlideBackground`, after resolving the scene:
```
[recap] slide 2 background=image rainy_sky (https://.../rain.jpg)
[recap] slide 3 background=image history_image (https://.../signed.jpg)
[recap] slide 4 background=gradient cool (no scene)
[monthly-recap] slide 5 background=image storm_clouds (...)
```

Same prefix conventions already used (`[recap]` / `[monthly-recap]`).

### 7. Failure safety

- If `mediaUrl` HEAD-check is skipped (we don't add network calls in the hot path), Creatomate handles missing assets gracefully — but to be defensive, wrap the scene-layer construction in a `try/catch`. On throw, log `[recap] slide N scene failed, gradient-only` and return just the gradient.
- Gradient overlay always added last, so even an invalid scene URL leaves the slide with the current themed look.
- Existing safety fallback in `buildAnimatedGradientBg` (solid `#0f172a` if `from`/`to` missing) is preserved.

## Verification

1. Deploy both functions.
2. Run **Dev: Test Weekly** for Gainesville. Logs should show `background=image` for slides where `p.image_url` exists and `background=image <condition_label>` (or `background=gradient`) for the rest. Preview MP4 shows photo + faint warm/cool/neutral tint.
3. Run **Dev: Test Monthly** for Gainesville. Week slides show condition-based stock scene tinted by theme; Moment-of-the-Month uses the historical post image.
4. Force a broken URL once (temporary edit) and confirm the render still completes with gradient-only and a `scene failed` log line.

## Out of scope

- Shorts pipeline (daily-weather-post). Helper supports `mode: "video"` for future reuse, but no Shorts call sites change here.
- New buckets / migrations beyond uploading the 5 stock JPEGs to the existing public brand asset bucket.
- Any change to scrim, text, voice, music, layout rotation.

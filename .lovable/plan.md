## Fix: Weekly Recap Black-Screen Render

Audio plays but visuals never appear. Root cause is in `stitchSlideshow` inside `supabase/functions/create-weekly-recap/index.ts`. Scope: that one function. No schema, no other edge functions.

### Root cause

`buildAnimatedGradientBg` emits a `shape` element with:

```
fill_color: `linear-gradient(135deg, ${from}, ${to})`
```

Creatomate's `fill_color` only accepts a **solid** color string. CSS-style `linear-gradient(...)` is silently rejected → the shape renders as transparent/black. Because that shape is the only guaranteed base layer (images are optional and may also fail to load from signed URLs), the composition collapses to a black frame for the entire slide — exactly the symptom reported. Audio is unaffected, so narration still plays.

Secondary issues found while reading the code:
- No explicit dark overlay between image and text. Text legibility relies on its own `background_color` pill, but per the spec we want a 0.3 scrim under the text.
- No `[recap] elements count=…` log immediately before submit.
- No hard safety fallback if both gradient and image are missing/invalid.

### Implementation (all in `create-weekly-recap/index.ts`)

**1. Replace `buildAnimatedGradientBg` with a Creatomate-valid gradient base.**

Use a `rectangle` (or `shape`) with Creatomate's native `gradient` property instead of CSS `linear-gradient` in `fill_color`:

```
{
  type: "rectangle",
  width: "100%", height: "100%", x: "50%", y: "50%",
  fill_color: grad.from,                      // solid fallback (valid)
  gradient: {
    type: "linear",
    angle: 135,
    stops: [
      { offset: "0%",   color: grad.from },
      { offset: "100%", color: grad.to   },
    ],
  },
  time, duration,
  animations: [ /* existing scale 1.0 → 1.08, unchanged */ ],
}
```

Keeping `fill_color` as a solid color guarantees a non-black base even if Creatomate ignores `gradient` on a given account/version. Animation block unchanged so MP4 motion guarantee still holds.

**2. Enforce per-slide layer order: gradient → image → overlay → text.**

In the `slides.forEach` loop:

```
elements.push(buildAnimatedGradientBg(start, SLIDE_DUR, grad));   // base
if (p.image_url) {
  elements.push({ type: "image", source: p.image_url, fit: "cover",
                  time: start, duration: SLIDE_DUR,
                  enter_animation: { type: "fade", duration: 0.4 },
                  exit_animation:  { type: "fade", duration: 0.4 } });
  console.log(`[recap] slide ${i+1} using image from history: ${p.image_url}`);
}
elements.push({                                                    // 0.3 scrim
  type: "rectangle",
  width: "100%", height: "100%", x: "50%", y: "50%",
  fill_color: "rgba(0,0,0,0.3)",
  time: start, duration: SLIDE_DUR,
});
elements.push({ /* existing day/temp/condition text, unchanged */ });
```

Day-slide text `background_color` drops from `rgba(0,0,0,0.55)` → `rgba(0,0,0,0.25)` so the scrim does the legibility work without double-darkening (matches the earlier image-rich plan).

**3. Apply the same ordering to title + outro cards.**

Each becomes: gradient → 0.3 scrim → text. Title/outro text kept on `background_color: "rgba(0,0,0,0.25)"`. Outro extension (`outroBgIdx` / `outroTextIdx`) still works because indices are captured at push time — extend the scrim duration too if it sits between bg and text. Concretely, capture `outroScrimIdx` next to `outroBgIdx` and extend all three in the pad block.

**4. Safety fallback (prevents black screen ever again).**

Right before submit, if `elements.filter(e => e.type !== "audio").length === 0`, push a single solid `rectangle` covering `totalDuration` at `fill_color: "#0f172a"` so the composition is never visually empty. Log `[recap] safety fallback: no visual elements, pushing solid background`.

**5. Pre-submit debug log.**

Immediately before `fetch("https://api.creatomate.com/v2/renders", …)`:

```
const visualCount = elements.filter(e => e.type !== "audio").length;
const audioCount  = elements.length - visualCount;
console.log(`[recap] elements count=${elements.length} visual=${visualCount} audio=${audioCount}`);
```

**6. Keep payload shape unchanged.**

`body` still uses top-level `output_format / width / height / duration / fill_color / elements`. `elements` is the SAME array — audio is appended, never substituted. No nesting under `source`.

### Out of scope

- No changes to voice synthesis, music bed, audio mix volumes, fallback infographic, upload, or YouTube/post_history logic.
- No new env vars, secrets, tables, or migrations.
- No frontend changes.
- Daily pipeline and `_shared/video-render.ts` untouched.

### Verification

Trigger Gainesville recap manually and confirm logs:

- `[recap] elements count=N visual=M audio=K` with `visual ≥ slides*3 + 4` (gradient + scrim + text per slide, plus title/outro triplets).
- For each slide with an image: `[recap] slide N using image from history: …`.
- `[recap] uploaded to YouTube as videoId: …`.

Then open the YouTube video and confirm:
- Visible animated gradient + (when present) weather card image behind each day's text.
- White text legible on top, no full-black frames.
- Voice narration still audible (unchanged).

## Weekly Recap — Visual Variety & Storytelling

Add structured per-slide variation to `stitchSlideshow` in `supabase/functions/create-weekly-recap/index.ts` so the recap reads as an evolving story. No changes to timing, audio, schema validation, or render pipeline.

### Scope

Single file: `supabase/functions/create-weekly-recap/index.ts`.
All work lives inside `stitchSlideshow` plus 2 small helpers (`gradientForSlide` extension + new `LAYOUTS`/`THEMES` tables). No changes to `buildAnimatedGradientBg` shape contract (still `type: "shape"`, `shape_type: "rectangle"`) — only `fill_color` varies via theme.

### Changes

1. **Layout variants per slide**
   - Add `const LAYOUTS = ["center", "left", "right"] as const;`
   - For each day slide: `const layout = LAYOUTS[i % 3];`
   - Map layout → text element overrides:
     - `center` → `x: "50%"`, `x_alignment: "50%"` (current)
     - `left`   → `x: "30%"`, `width: "60%"`, `x_alignment: "0%"`
     - `right`  → `x: "70%"`, `width: "60%"`, `x_alignment: "100%"`

2. **Theme rotation per slide**
   - Add `const THEMES = { warm: {from:"#ea580c",to:"#f59e0b"}, cool:{from:"#1e3a8a",to:"#7e22ce"}, neutral:{from:"#334155",to:"#1e3a8a"} };`
   - Pick `const themeKey = (["warm","cool","neutral"] as const)[i % 3];`
   - Replace per-slide `gradientForSlide(p.created_at)` call with `THEMES[themeKey]` for the gradient base; keep `gradientForSlide` for title/outro.
   - Pass theme color as `fill_color` of the existing background rectangle — schema unchanged.

3. **Subtle image motion (Ken Burns, safe)**
   - On day-slide `type: "image"` elements add a Creatomate-supported `animations` block:
     ```ts
     animations: [{
       type: "pan",
       direction: layout === "left" ? "right" : layout === "right" ? "left" : "up",
       duration: SLIDE_DUR,
       easing: "linear",
       scope: "element",
     }]
     ```
   - Wrap behind a try/catch-free conditional via a single `SAFE_IMAGE_ANIM` boolean constant so it can be flipped off in one place if Creatomate rejects it. Background rectangle stays animation-free (we already learned that breaks validation).

4. **Midweek highlight (slide index 3)**
   - When `i === 3`: bump text `font_size` from `"7 vh"` → `"7.7 vh"`, swap scrim opacity from `0.3` → `0.35` (new `buildScrim(start, dur, 0.35)` overload — default stays 0.3), and append a small subtitle text element: `"Midweek Shift"` at `y: "62%"`, `font_size: "3.5 vh"`, same layout x/alignment as the day text.

5. **Title + outro differentiation**
   - Title: `font_size: "9 vh"`, add `animations: [{ type: "fade", duration: 1.2 }]`.
   - Outro: replace text with `Follow for your daily forecast\n${city} weather, every day.` Keep existing voice-driven duration extension logic intact.

6. **Logging**
   - After picking layout/theme per slide:
     `console.log("[recap] slide", i + 1, "layout=" + layout, "theme=" + themeKey, i === 3 ? "highlight=yes" : "");`
   - Title and outro get matching lines: `[recap] title font=9vh animation=fade` / `[recap] outro cta=follow`.

### Non-Goals / Preserved

- Slide count, `SLIDE_DUR = 9`, total duration math, outro extension when voice is longer.
- Audio mix (voice 2.0, music 0.15, silent fallback).
- All shape elements stay `type: "shape", shape_type: "rectangle"` — no reintroduction of the previously rejected `scale` animation on backgrounds.
- Public schema, DB writes, RLS, edge function signature, frontend.

### Verification

1. Deploy `create-weekly-recap`.
2. Trigger Gainesville + Orlando recaps from the Dev panel.
3. Tail logs and confirm:
   - `[recap] slide 1 layout=center theme=warm` … `slide 4 … highlight=yes` … `slide 7 layout=center theme=warm`
   - No Creatomate validation errors; poll reaches `succeeded`.
4. Watch resulting MP4: text shifts left/right across slides, gradients alternate warm/cool/neutral, midweek slide visibly larger, outro shows new CTA.

### File touched

- `supabase/functions/create-weekly-recap/index.ts`

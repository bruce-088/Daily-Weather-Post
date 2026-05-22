# Fix recap background gradients

Weekly and monthly recap videos currently render with a flat dark-blue background instead of the warm/cool/neutral themed gradients. The background rectangle helper passes a single hex string to `fill_color`, which Creatomate doesn't treat as a gradient — so the themed look never appears.

## What to change

Both files have an identical helper that builds the full-frame background rectangle:

- `supabase/functions/create-weekly-recap/index.ts` (~line 376)
- `supabase/functions/create-monthly-recap/index.ts` (~line 466)

Update that helper to accept the full `{ from, to }` gradient and emit Creatomate's gradient format:

```ts
fill_color: [
  { position: 0, color: grad.from },
  { position: 1, color: grad.to },
],
fill_color_type: "linear-gradient",
fill_color_angle: 135,
```

Remove the stale comment that says rectangles don't support gradient stops.

## Where it's used

The helper is reused for every background rectangle, so the single helper change covers all slide types:

- Weekly: title card, day slides (theme rotates warm → cool → neutral), outro card
- Monthly: title card, week slides (theme rotates), Moment of the Month slide (`momentGrad`), outro card

Today most call sites already pass `grad.from` from a `{ from, to }` object (`titleGrad`, `THEMES[themeKey]`, `momentGrad`, `outroGrad`), so the call sites can pass the whole object instead of just `.from`.

## Themes (unchanged, just confirm)

```ts
warm:    { from: "#ea580c", to: "#f59e0b" }
cool:    { from: "#1e3a8a", to: "#7e22ce" }
neutral: { from: "#334155", to: "#1e3a8a" }
```

## Logging

Add a structured log per slide background, e.g.:

```
[recap] slide 2 background gradient=cool #1e3a8a→#7e22ce
[monthly-recap] slide 4 background gradient=neutral #334155→#1e3a8a
```

## Verification

1. Deploy both functions.
2. Trigger Dev: Test Weekly for Gainesville → confirm logs show the three gradients rotating and the `preview_url` shows warm slide 1, cool slide 2, neutral slide 3.
3. Trigger Dev: Test Monthly for Gainesville → same gradient rotation across week slides plus themed Moment of the Month + outro.
4. Confirm no `post_history` row is written (dev-test mode unchanged).

## Out of scope

- Scrim, image, and text layers (already working correctly).
- Voice, music bed, layout rotation, Midweek Shift subtitle, outro CTA (all confirmed good).
- The 504 IDLE_TIMEOUT from the earlier monthly run is unrelated — the backgrounded `EdgeRuntime.waitUntil` work still completes; not addressed here.

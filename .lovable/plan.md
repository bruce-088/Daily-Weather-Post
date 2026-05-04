# Growth Discovery toast: persist + "View Insights" action

## What changes for the user
When the experiments-resolve job finds a clear winner, the success toast will:
1. Stay on screen for 5 seconds (long enough to read).
2. Clearly show the winning pattern and the engagement delta, e.g.
   `Hook "Feels Like Summer" beat "Weather Update" by +24% engagement`.
3. Include a **View Insights** button. Clicking it jumps straight to the Growth Log on the Analytics tab and scrolls it into view.

No changes to the resolver job — it already writes `title`, `message`, `delta_pct`, `winner_value`, `loser_value`, and `variable` into `growth_insights`. We just present them better in the toast.

## Files to edit

### 1. `src/hooks/useGrowthInsights.ts`
- Set `duration: 5000` (currently 9000).
- Build a richer `description` from the row: prefer `winner_value` vs `loser_value` and append `+X% engagement`. Fall back to `row.message` when values are missing.
- Add a sonner `action` button labeled **View Insights** that dispatches a `CustomEvent("skybrief:open-growth-log")` on `window`. (The hook is mounted globally, outside the tabs component, so a window event is the cleanest bridge.)

### 2. `src/pages/Index.tsx`
- Add a `useEffect` that listens for `skybrief:open-growth-log` and calls `setActiveTab("analytics")`, then on the next tick scrolls a ref into view.
- Pass a `ref` to the wrapper around `<GrowthLog />` inside the analytics `TabsContent` and call `ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })`.

### 3. `src/components/GrowthLog.tsx`
- Add `id="growth-log"` to the root section so the scroll target is stable (used as a fallback if the ref isn't mounted yet when the event fires — we re-query by id after a short timeout).

## Technical notes
- Sonner's `action` accepts `{ label, onClick }` and renders an inline button inside the toast — no extra UI plumbing needed.
- Toast description format: `` `Hook "${winner_value}" beat "${loser_value}" by +${Math.abs(delta_pct)}% engagement` `` when both values exist; otherwise reuse `row.message`. `delta_pct` is already stored as a percentage (e.g. `24` for 24%).
- Window-event bridge avoids lifting state or introducing a store just for one toast action.
- Sound, gold border, and gem icon stay as-is.

## Out of scope
- No DB or edge-function changes.
- No changes to the Growth Log layout itself beyond adding an `id` anchor.

## Move Outperforming posts into the right column of row 2

Goal: Outperforming posts sits next to (right of) the Top performing hooks + Best posting times heatmap stack, capped at the height of that left stack — no overflow past the heatmap's bottom, no full-width row below.

### Changes

1. **`src/pages/Index.tsx`** — Growth TabsContent row 2:
   - Add `items-stretch` to the row-2 grid.
   - Left column (`lg:col-span-7`) keeps `<GrowthDashboard />` (Top hooks + heatmap).
   - Right column (`lg:col-span-5`) becomes a `flex flex-col gap-6 h-full` stack containing:
     - `<SmartInsightsCard />` (natural height)
     - `<OutperformingPosts className="flex-1 min-h-0" />` (fills remaining space, scrolls internally)
   - Remove the existing standalone full-width `<OutperformingPosts />` row above Weekly Recap.

2. **`src/components/GrowthDashboard.tsx`** — `OutperformingPosts`:
   - Accept optional `className` prop, merge onto the root `<Card>` with `cn(...)`.
   - Add `flex flex-col` to the Card and `flex-1 overflow-auto min-h-0` to the CardContent so the list scrolls inside the available space instead of pushing the card taller.

### Result

```text
Row 2 (items-stretch, both columns same height):
  [ Top hooks + Heatmap (col-7) ] | [ Smart Insights + Outperforming posts scroll (col-5) ]
Then: Weekly Recap, Growth Log (full width, unchanged)
```

No data, fetching, or business logic touched.

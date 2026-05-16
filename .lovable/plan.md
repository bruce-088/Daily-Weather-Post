## Growth tab layout fix

Edit only `src/pages/Index.tsx`, inside the `growth` TabsContent block (lines 1055–1091). No other files, no logic changes.

### New structure

```text
[ Header: Growth Insights Center ]
[ 3-col grid: Stats (col-span-3) | Memory Bank (col-span-5) | AI Insights stack (col-span-4) ]
[ Weekly Recap — full width ]
[ Growth Log — full width ]
```

### Changes

1. **Left column (`lg:col-span-3`)** — keep only `<GrowthStatsCards stacked />`. Remove the surrounding `space-y-4` wrapper's extra child so the column hugs the stat-card stack height (no min-height, no filler).
2. **Weekly Recap** — move `<GrowthWeeklyRecap />` out of the left column to a sibling row directly below the grid, rendered full width (no col-span, no max-width override — inherits the `max-w-[1600px]` container).
3. **Middle / Right columns** — unchanged (`GrowthMemoryBank`, then `AiInsightsCard` + `GrowthDashboard` + `SmartInsightsCard`).
4. **Growth Log** — stays as the last full-width row, now sitting below Weekly Recap.

### Note on "Growth Lab"

There is no separate `GrowthLab` component in the codebase — "Experiments Running" is already one of the three cards inside `GrowthStatsCards` (left column). No move is needed; flagging in case you expected a distinct card.

### Final order inside `max-w-[1600px] mx-auto space-y-6`

1. Header row
2. 3-col grid (stats / memory bank / ai-insights stack)
3. `<GrowthWeeklyRecap />` (full width)
4. `<GrowthLog />` (full width)

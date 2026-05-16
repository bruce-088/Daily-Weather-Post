## Cap Memory Bank to side-column height, scroll internally

### Changes

1. **`src/components/GrowthCommandCenter.tsx`** — `GrowthMemoryBank`:
   - Card root: add `h-full flex flex-col` (alongside the passed `className`).
   - `CardHeader`: add `shrink-0`.
   - `CardContent`: add `flex-1 min-h-0 overflow-auto` so the hook list scrolls inside the available card height instead of expanding it.

2. **`src/pages/Index.tsx`** — Growth tab row 1:
   - Change row 1 grid from `items-start` to `items-stretch` so all three columns share the tallest column's height.
   - Left column wrapper (`lg:col-span-3`) and right column wrapper (`lg:col-span-4`) keep their content; their `<GrowthStatsCards stacked />` / `<AiInsightsCard />` define the row height.
   - Middle column wrapper (`lg:col-span-5`) gets `h-full` so the `<GrowthMemoryBank />` inside stretches to fill the row.

### Result

Row 1 columns are all the same height (= the taller of Stats stack vs AI Insights). Memory Bank fills that height exactly and scrolls its hook list, eliminating both the dead zone below Experiments Running and below AI Insights.

No data, fetching, or business logic touched.

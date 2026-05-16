## Growth tab — kill the dead zones

The current dead space comes from the right column (`AI Recommendation` + `GrowthDashboard` heatmap/top hooks + `Smart Insights`) being roughly 2× taller than the left+middle columns, so everything beneath Memory Bank and Stats is empty purple void.

Layout-only fix in `src/pages/Index.tsx` (Growth TabsContent, lines 1068–1085). No component internals, no data changes.

### New structure

```text
[ Header ]
Row 1 (12-col grid):
  Stats (col-3)  |  Memory Bank (col-5)  |  AI Recommendation (col-4)
Row 2 (12-col grid):
  Best posting times heatmap + Top hooks (col-7)  |  Smart Insights (col-5)
Row 3: Outperforming posts (full width)
Row 4: Weekly Recap (full width)
Row 5: Growth Log (full width)
```

### Concrete changes

1. Right column of row 1 keeps only `<AiInsightsCard />`.
2. Move `<GrowthDashboard />` and `<SmartInsightsCard />` into a new second 12-col grid row directly below:
   - `lg:col-span-7` → `<GrowthDashboard />`
   - `lg:col-span-5` → `<SmartInsightsCard />`
3. Add `items-start` to both grids; drop `h-full` from Memory Bank so it sizes to its own content instead of stretching to match the now-shorter right column.
4. Outperforming posts, Weekly Recap, Growth Log stay full-width below — order unchanged.

### Result

- Left column's empty void disappears because row 1 ends at the shorter of the three columns (Stats / Memory Bank / AI Recommendation are roughly comparable now).
- Heatmap + Smart Insights become a balanced 7/5 row that uses the full canvas instead of leaving the left half blank.
- No padding/min-height hacks, no logic touched.

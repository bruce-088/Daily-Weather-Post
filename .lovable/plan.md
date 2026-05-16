# Growth Page — 3-Column Grid Layout

The Growth tab lives inside `src/pages/Index.tsx` under `<TabsContent value="growth">`. Most of its content (stat cards, Memory Bank, Weekly Recap) is bundled inside `<GrowthCommandCenter />`. The right-column cards (`GrowthDashboard`, `AiInsightsCard`, `SmartInsightsCard`) are already rendered separately. `GrowthLog` is the chronological wins feed (not requested by user — will be moved below the grid as a full-width row so nothing is lost).

To get the requested 3-column layout (stat cards stacked vertically + recap on the left; Memory Bank in the middle; insights on the right) **without touching data fetching or AI logic**, the GrowthCommandCenter render tree needs to be split into addressable slots. Its internal data loading stays byte-identical.

## Refactor

### 1. `src/components/GrowthCommandCenter.tsx` — slot prop, no logic changes

- Extract the existing `load` / `handleRefresh` / state into an internal `useGrowthCommandData()` hook **defined in the same file** (queries, intervals, toasts, and channel-save logic copied verbatim — no edits to SQL or behavior).
- Export three new components that consume that hook and render only their respective sub-sections:
  - `GrowthStatsCards` — stat cards (`Total Insights`, `Best Performing Hook`, `Experiments Running`) — rendered as a **vertical stack** (`grid-cols-1 gap-3`) for left column.
  - `GrowthMemoryBank` — `Memory Bank` card with `<MemoryBankList />` inside, scroll height capped (`max-h-[720px] overflow-auto`).
  - `GrowthWeeklyRecap` — Weekly Recap card with channel selector + recent posts preview.
- Keep `<GrowthCommandCenter />` as a thin wrapper (`<GrowthStatsCards /> + <GrowthMemoryBank /> + <GrowthWeeklyRecap />`) so any other consumer is unaffected. Only call site is `Index.tsx` so this just preserves the public API.
- The "Refresh" button stays inside `GrowthStatsCards`'s header — single instance, single refresh.

⚠️ Important: because each slot calls the same hook independently, the hook MUST be a **shared context** to avoid 3× fetches. Implementation: add a `GrowthCommandProvider` that calls the load function once and shares state via `React.createContext`. Slot components read from context; if no provider is present, they fall back to running the hook themselves (so the standalone `<GrowthCommandCenter />` still works).

### 2. `src/pages/Index.tsx` — replace the Growth tab body

Replace the existing `<GrowthCommandCenter />` + `lg:grid-cols-[1.4fr_1fr]` block with:

```text
<GrowthCommandProvider>
  max-w-[1600px] mx-auto space-y-6
    header (Sparkles · Growth Insights Center · Refresh)
    grid grid-cols-1 lg:grid-cols-12 gap-6
      ├─ Left  (lg:col-span-3)  → GrowthStatsCards stacked + GrowthWeeklyRecap
      ├─ Mid   (lg:col-span-5)  → GrowthMemoryBank (h-full)
      └─ Right (lg:col-span-4)  → AiInsightsCard + GrowthDashboard (heatmap + top hooks) + SmartInsightsCard
  GrowthLog (full width below the grid, unchanged)
</GrowthCommandProvider>
```

- Each column wrapped in `space-y-4` so cards inside stay aligned.
- Top-row top edges align because all three columns start at the same grid row.
- Cards use `h-full` where it improves visual balance (Memory Bank, AI Insights).

## Out of scope

- Any data queries, intervals, toasts, RLS, edge function calls.
- `GrowthDashboard`, `AiInsightsCard`, `SmartInsightsCard`, `GrowthLog`, `GrowthInsights` internals.
- All other tabs (`schedule`, `history`, `analytics`, `create`, `jobs`).

## Files touched

- `src/components/GrowthCommandCenter.tsx` — split into provider + 3 slot components + thin wrapper. No query/logic changes.
- `src/pages/Index.tsx` — Growth tab body only (lines ~1054–1082).

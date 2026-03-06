

## Add Filtering and Sorting to Scheduled Posts List

### Approach
Add client-side filtering and sorting controls directly inside `ScheduledPostsList.tsx` using existing UI components (Select, ToggleGroup). All filtering/sorting is done on the already-fetched `posts` array — no backend changes needed.

### Changes

**`src/components/ScheduledPostsList.tsx`**
- Add local state: `statusFilter` (all | pending | posted | failed | cancelled), `sortBy` (date-asc | date-desc | city-asc | city-desc)
- Add a toolbar row above the list with:
  - A `Select` dropdown for status filter (default: "All")
  - A `Select` dropdown for sort order (default: "Date ↓ newest")
- Apply `useMemo` to filter and sort `posts` before rendering
- Move the empty state check to after filtering so it shows "No matching posts" when filters exclude everything

No other files need changes.


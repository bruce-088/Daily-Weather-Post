

## Add City Search to Scheduled Posts List

### Change

**`src/components/ScheduledPostsList.tsx`**
- Add a text `Input` field to the toolbar row for searching by city name
- Update the `useMemo` filtering logic to also filter posts where `city` includes the search term (case-insensitive)
- Import `Input` from `@/components/ui/input` and `Search` icon from `lucide-react`

Single file change, no backend modifications needed.


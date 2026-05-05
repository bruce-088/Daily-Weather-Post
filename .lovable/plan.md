# Reward growth-insight notifications in the bell

## What changes for the user
Every "New Growth Insight Found! 🚀" event will:
1. Show a gold-trimmed entry in the existing notification bell (with a diamond/gem icon instead of the generic colored dot).
2. Play the same subtle gold chime that the toast uses (respecting the existing mute toggle).
3. Continue to fire the persistent toast + "View Insights" button from `useGrowthInsights`.
4. Avoid the duplicate generic success toast/ping that `useNotifications` would otherwise fire.

The bell already lists growth-insight rows because the resolver writes to `notifications` — we're just upgrading their look and sound, and de-duplicating with the gold toast.

## Files to edit

### 1. `supabase/functions/experiments-resolve/index.ts`
- Tag the inserted notification with a kind sentinel so the client can recognize it without relying on the title string. Append `[meta:growth_insight]` to `message` (matches the existing `parseNotificationMessage` sentinel pattern) — or simpler: add `kind: "growth_insight"` via the same meta channel the rest of the app uses.
- Quick approach: extend the message with the existing meta sentinel so `parseNotificationMessage` returns `meta.kind === "growth_insight"`. (Confirm sentinel format from `src/lib/notificationUtils.ts` during build.)

### 2. `src/hooks/useNotifications.ts`
- In the realtime INSERT handler, detect growth-insight rows (`n.title.startsWith("New Growth Insight")` or `n.meta?.kind === "growth_insight"`).
- For those rows: skip the standard `toast.success` + `playSuccessPing` (the gold chime + amber toast from `useGrowthInsights` already handles the reward UX).
- All other notification types behave exactly as today.

### 3. `src/components/NotificationBell.tsx`
- When rendering each notification row, detect growth insights the same way.
- Replace the small colored status dot with a `Gem` icon (lucide, `text-amber-400`).
- Add an amber tint to the row: `bg-amber-500/5 border-l-2 border-amber-500/50` (only for growth-insight rows; keeps the rest unchanged).
- Keep title/message rendering as-is — the resolver already writes a friendly title and pattern message.

## Technical notes
- The gold chime + 5-second toast + "View Insights" action are already wired in `useGrowthInsights` (listens on the `growth_insights` table). We are NOT moving sound to the bell hook — it would double up.
- Sound mute respects `isSoundEnabled()` already (used by the chime util).
- No DB migration needed; we only piggyback on the existing `notifications` row.
- No styling tokens are hardcoded outside of amber utility classes already used by `GrowthLog.tsx`, keeping the gold/diamond visual language consistent.

## Out of scope
- New notification types or DB columns.
- Changes to the resolver scoring logic.

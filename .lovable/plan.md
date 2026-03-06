

## In-App Notifications for Scheduled Post Status

### Overview
Add a `notifications` table and real-time subscription so users get instant in-app toast notifications when their scheduled posts are processed (posted or failed), plus a persistent notification bell with history.

### Database

**New table: `notifications`**
- `id` uuid PK default `gen_random_uuid()`
- `user_id` uuid NOT NULL
- `title` text NOT NULL
- `message` text NOT NULL
- `type` text NOT NULL default `'info'` (success | error | info)
- `read` boolean default false
- `created_at` timestamptz default now()

RLS: users can SELECT/UPDATE own rows (`user_id = auth.uid()`). Service role has full access (for edge function inserts).

Enable realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;`

### Backend Changes

**`supabase/functions/process-scheduled-posts/index.ts`**
- After updating each scheduled post's status, insert a row into `notifications` for the user:
  - Success: `{ title: "Post Published", message: "Your weather post for {city} was published on {platform}", type: "success" }`
  - Failure: `{ title: "Post Failed", message: "Your scheduled post for {city} failed: {error}", type: "error" }`

### Frontend

**New component: `NotificationBell.tsx`**
- Bell icon in the header with unread count badge
- Dropdown/popover listing recent notifications with timestamps
- Click marks notifications as read
- "Mark all as read" button

**New hook: `useNotifications.ts`**
- Fetches notifications on mount
- Subscribes to realtime `INSERT` events on `notifications` table for the current user
- On new notification: shows a sonner toast and appends to local state
- Exposes `notifications`, `unreadCount`, `markAsRead`, `markAllAsRead`

**`src/pages/Index.tsx`**
- Add `<NotificationBell />` to the header bar

### Files

| File | Action |
|------|--------|
| DB migration | Create `notifications` table + RLS + realtime |
| `supabase/functions/process-scheduled-posts/index.ts` | Insert notifications on post completion |
| `src/hooks/useNotifications.ts` | New — fetch + realtime subscription |
| `src/components/NotificationBell.tsx` | New — bell icon with dropdown |
| `src/pages/Index.tsx` | Add NotificationBell to header |


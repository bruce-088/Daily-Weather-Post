

## Add Scheduled Posts Feature

### Overview
Create a `scheduled_posts` table and a new "Schedule" tab/UI so users can queue weather posts for specific future dates and times. A new edge function processes due posts via a cron job.

### Database

**New table: `scheduled_posts`**
- `id` uuid PK
- `user_id` uuid (NOT NULL)
- `city` text NOT NULL
- `scheduled_at` timestamptz NOT NULL
- `platform` text DEFAULT 'both'
- `status` text DEFAULT 'pending' (pending | posted | failed | cancelled)
- `error_message` text nullable
- `created_at` timestamptz DEFAULT now()

RLS: users can CRUD own rows (where `user_id = auth.uid()`), service role has full access.

Validation trigger to ensure `scheduled_at` is in the future on INSERT.

### Backend

**New edge function: `process-scheduled-posts`**
- Queries `scheduled_posts` where `status = 'pending'` and `scheduled_at <= now()`
- For each, calls the weather fetch + post logic (reusing patterns from `daily-weather-post`)
- Updates status to `posted` or `failed`, logs to `post_history`
- Set `verify_jwt = false` in config.toml (called by cron)

**Cron job** (via `pg_cron` + `pg_net`):
- Runs every 5 minutes, calls `process-scheduled-posts`

### Frontend

**New component: `SchedulePostForm`**
- Date picker (using existing Calendar/Popover components) + time input
- City input (pre-filled from settings)
- Platform selector (Instagram / TikTok / Both)
- "Schedule Post" button

**New component: `ScheduledPostsList`**
- Lists upcoming scheduled posts with status badges
- Cancel button for pending posts

**New API functions in `src/lib/api.ts`:**
- `createScheduledPost(city, scheduledAt, platform)` — insert into `scheduled_posts`
- `fetchScheduledPosts()` — select pending/upcoming posts
- `cancelScheduledPost(id)` — update status to 'cancelled'

**Index page updates:**
- Add a "Schedule" tab between History and Settings
- Contains `SchedulePostForm` + `ScheduledPostsList`

### Files changed/created

| File | Action |
|------|--------|
| DB migration | Create `scheduled_posts` table + RLS + validation trigger |
| `supabase/functions/process-scheduled-posts/index.ts` | New edge function |
| `supabase/config.toml` | Add `[functions.process-scheduled-posts]` |
| Cron job SQL | Enable `pg_cron`/`pg_net`, schedule every 5 min |
| `src/components/SchedulePostForm.tsx` | New — form to schedule a post |
| `src/components/ScheduledPostsList.tsx` | New — list upcoming/past scheduled posts |
| `src/lib/api.ts` | Add schedule CRUD functions |
| `src/pages/Index.tsx` | Add Schedule tab |


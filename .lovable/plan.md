## Goal

Add a new **Scheduler Health** sub-section at the top of the existing Analytics tab in `src/pages/Index.tsx`. All data pulled live from Supabase (`scheduled_posts` + `weather_settings`) — no mock data, no changes to the existing growth analytics below it.

## New component

`src/components/SchedulerAnalytics.tsx` — self-contained, fetches its own data on mount, auto-refreshes every 60s.

### Data sources

| Section | Query |
|---|---|
| Stat cards | `scheduled_posts` (count by status, nearest future `scheduled_at`), `weather_settings` (enabled slots) |
| Platform chart | `scheduled_posts` grouped by `platform` |
| Daily volume | `scheduled_posts` last 14 days, grouped by date + status |
| System pulse | latest `scheduled_posts` row where `source = 'auto_cron'` AND `status = 'posted'` |
| Recent feed | `scheduled_posts` last 5 where `status = 'posted'` |

All queries filtered by `user_id = auth.uid()` (RLS handles this automatically).

## Layout

```text
┌─────────────────────────────────────────────────────────┐
│  Scheduler Health                          ● Healthy    │
├─────────────────────────────────────────────────────────┤
│  [Total Sent] [Success %] [Active Autom.] [Next Post]   │
├──────────────────────────┬──────────────────────────────┤
│  Platform Breakdown      │  Daily Volume (14d)          │
│  (donut chart)           │  (line: success vs failed)   │
├──────────────────────────┴──────────────────────────────┤
│  Recent Posts (last 5, with platform icon + time ago)   │
└─────────────────────────────────────────────────────────┘
```

Mounted inside the existing `<TabsContent value="analytics">` block, rendered **above** the current `<AnalyticsPanel />` / growth content.

## Section details

**1. Stat cards (grid-cols-4, glassmorphic Card)**
- Total Posts Sent — `count(status='posted')` all-time
- Success Rate — `posted / total * 100` (rounded)
- Active Automations — count of `auto_post_morning/afternoon/evening = true` in `weather_settings`
- Next Scheduled Post — nearest `scheduled_at > now()` with `status='pending'`; show relative time + city

**2. Platform Breakdown (Recharts donut)**
- Groups by `platform` (youtube, twitter, tiktok, linkedin, instagram)
- Color map: youtube `hsl(0 84% 55%)` red, twitter `hsl(203 89% 53%)` blue, tiktok `hsl(0 0% 8%)` black, linkedin `hsl(214 70% 25%)` navy, instagram `hsl(330 70% 55%)` pink fallback
- Use semantic tokens where possible; brand hex only for platform identity

**3. Daily Volume (Recharts LineChart)**
- X axis: last 14 days (YYYY-MM-DD)
- Two series: Successful (`status='posted'`) green `hsl(142 71% 45%)`, Failed (`status='failed'`) red `hsl(0 84% 60%)`
- Bucket by `date(scheduled_at)` in user TZ

**4. System Health Pulse**
- Query: most recent `scheduled_posts` row where `source='auto_cron'` AND `status='posted'`, order by `scheduled_at desc limit 1`
- Compute age: `< 6h` green, `6–12h` yellow, `>12h` red
- Show dot + label + `"Last auto post: 2h ago"` timestamp
- Placed in the section header (top-right corner)

**5. Recent Posts Feed**
- Last 5 `status='posted'` rows ordered by `scheduled_at desc`
- Row: city · slot badge · platform icon (lucide) · "5 min ago" (use `date-fns` `formatDistanceToNow`) · status badge
- If `post_history` row exists with matching scheduled timing and `post_url`, link to it (best-effort join via `created_at` proximity; otherwise non-linked)
  - **Simpler approach used:** query `post_history` (also has `post_url`) for the recent feed instead of `scheduled_posts`, since `scheduled_posts` has no URL column. Confirmed `post_history` has `post_url`, `city`, `slot`, `platform`, `status`, `created_at`. Use it for the feed only; everything else stays on `scheduled_posts` per spec.

## Files

- **New:** `src/components/SchedulerAnalytics.tsx` (~250 lines)
- **Edit:** `src/pages/Index.tsx` — import + render `<SchedulerAnalytics />` at top of the analytics TabsContent

No DB migrations, no edge function changes, no backend work. Recharts already in deps. Auto-refresh via `setInterval(60_000)` with cleanup.

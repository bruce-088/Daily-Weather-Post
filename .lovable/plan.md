# Monthly Recaps + City Command Center

## 1. New edge function: `create-monthly-recap`

Clone `supabase/functions/create-weekly-recap/index.ts` as `supabase/functions/create-monthly-recap/index.ts` and refine:

- **Data window**: `getLast30Posts` instead of `getLast7Posts` (filter by city, last 30 days, min 8 posts to qualify).
- **Slide structure** in `stitchSlideshow`:
  1. Title slide — `Month in Review: {City} — {MonthName} {Year}` (10vh, fade-in 1.2s)
  2–5. **4 weekly overview slides** — bucket the 30 days into Week 1/2/3/4. Each slide shows avg high/low, dominant condition, and a one-line AI summary. Cycle the existing `LAYOUTS` (`center`, `left`, `right`, `center`) and `THEMES` (`warm`, `cool`, `neutral`, `warm`).
  6. **Moment of the Month** highlight slide — auto-detect the day with the highest OR lowest temperature (whichever deviates most from the monthly mean). Scrim opacity `0.4`, subtitle `"Moment of the Month"`, 7.7vh headline.
  7. Outro — same `"Follow for your daily forecast"` CTA, with `{City} weather, every day.`
- **Voice**: reuse `synthesizeRecapVoice` but generate a 6-section script (intro + 4 weeks + highlight + outro). Volume **2.5** (vs weekly 2.0); music volume stays **0.15**.
- **AI script**: new `generateMonthlyScript(posts, topHooks)` — returns `{ title, script, weekSummaries[4], momentLine }` so the visual slides + voice stay in sync.
- **YouTube tags**: `["Monthly Recap","Weather","SkyBrief","Month in Review"]`. Description ends with `#MonthlyRecap #Weather #SkyBrief`.
- **Fallback chain**: same as weekly (stitch fail → infographic).
- **Logging**: `[monthly-recap] …` prefix everywhere.
- **HTTP entry**: same `requireCronOrUser` gate; accepts `{ city?, user_id? }` body for manual runs.

Register in `supabase/config.toml` with `verify_jwt = false` (matches weekly).

## 2. Monthly cron

Insert a `pg_cron` job via `supabase--insert` (per project rules — not migration) that fires at **23:59 UTC on the last day of each month** and POSTs to `create-monthly-recap`:

```
'59 23 28-31 * *'  -- guarded inside SQL with: AND (now() + interval '1 day')::date = date_trunc('month', now() + interval '1 month')::date
```

i.e. run only when "tomorrow" is the 1st. Uses `CRON_SECRET` header like existing scheduled jobs.

## 3. UI: City Command Center (replaces `DevWeeklyRecapTrigger`)

New component `src/components/CityCommandCenter.tsx`:

```
┌────────────────────────────────────────────────────────┐
│ 📍 Gainesville, FL                                      │
│ [▶ Run Daily Now] [▶ Run Weekly Now] [▶ Run Monthly Now]│
│ Status: ● Idle                                          │
└────────────────────────────────────────────────────────┘
```

Per-city card, one row per `user_cities` row.

**Button behavior**:
- **Daily** → insert a `scheduled_posts` row (status=`pending`, scheduled_at=now+10s, slot=`adhoc`, platform from automation) for this city, then `supabase.functions.invoke('process-scheduled-posts', { body: { scheduled_post_id } })`. This goes through the full pipeline (caption → voice → render → publish). Polls `scheduled_posts` row + `post_history` for completion.
- **Weekly** → `invoke('create-weekly-recap', { body: { city } })`. Polls `post_history` for new `caption LIKE '%Weekly Recap%'` row with `status=succeeded`.
- **Monthly** → `invoke('create-monthly-recap', { body: { city } })`. Polls `post_history` for `caption LIKE 'Month in Review%'`.

**States** (per button):
- Idle → `▶ Run X Now`
- Running → spinner + `Generating…` (disabled, also disables siblings)
- Success → `✅ Posted` + clickable `View on YouTube` link from `post_history.post_url`
- Error → `❌ {error_message}` (toast + inline)

**Duplicate guard** (client-side, localStorage):
- Key `lastRun:{cityId}:{type}` = ISO timestamp.
- If clicked within 30 min, show `AlertDialog`: `"⚠️ You ran this recently ({Xm} ago). Run again?"` — Cancel / Run anyway.

**Logging** (client + server):
- Client: `console.log("[manual] {type} triggered for city={city} by user={id}")`.
- Server: each function logs same line at entry when `body.city` + user identified.

**Status indicator**: `● Idle` (muted), `● Running` (yellow, pulse), `● Done` (green), `● Error` (red).

`SettingsPanel.tsx` line 961: replace `<DevWeeklyRecapTrigger />` with `<CityCommandCenter />`. Delete `DevWeeklyRecapTrigger.tsx`.

## 4. Spec update

`supabase/functions/generate-spec/index.ts` — add a `### Monthly Recap` section under recaps documenting: 30-day window, 7-slide Full Story structure (title + 4 weeks + Moment of the Month + outro), voice 2.5 / music 0.15, monthly cron at 23:59 last day of month, manual trigger via City Command Center.

## 5. Files touched

```
NEW   supabase/functions/create-monthly-recap/index.ts
EDIT  supabase/config.toml                          (+ [functions.create-monthly-recap] verify_jwt=false)
EDIT  supabase/functions/generate-spec/index.ts     (+ Monthly Recap section)
NEW   src/components/CityCommandCenter.tsx
EDIT  src/components/SettingsPanel.tsx              (swap DevWeeklyRecapTrigger → CityCommandCenter)
DEL   src/components/DevWeeklyRecapTrigger.tsx
INSERT pg_cron schedule via supabase--insert
```

## 6. Verification

1. Click **Run Monthly Now** for Gainesville → status pulses → completes with YouTube link.
2. Open the link → 3–5 min video with title card, 4 weekly summary slides, Moment of the Month highlight, outro CTA, voice narration + ambient music bed.
3. Edge logs show `[manual] monthly triggered for city=Gainesville by user=…` and `[monthly-recap] uploaded to YouTube as videoId: …`.
4. Re-click within 30 min → confirmation dialog appears.
5. Repeat for Weekly and Daily.

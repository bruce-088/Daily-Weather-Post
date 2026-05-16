## Diagnosis (confirmed from live data)

- `cron.job_run_details` shows the `auto-post-scheduler` pg_cron job is firing every 5 min as scheduled (last run 02:45 UTC, status `succeeded`).
- `function_edge_logs` shows the HTTP calls land on the edge function as **`POST | 401`** — the function rejects every cron call.
- `system_health` row for `auto-post-scheduler` was last updated 3h 47m ago, lining up exactly with when the 401s started — heartbeat write happens **after** the auth gate, so it never executes.
- Root cause: `_shared/auth-helpers.ts → requireCronOrUser` compares `x-cron-secret` header (sourced by cron from `vault.cron_secret`) against env `CRON_SECRET`. The two stores drifted out of sync (one was rotated, the other wasn't), so every cron call returns 401.

---

## Fix plan

### 1. Re-sync the cron secret (the actual fix)

- Generate a fresh random token, write it into BOTH stores so the handshake matches again:
  - Update `vault.cron_secret` via the insert tool (cron's `decrypted_secrets` lookup will now return the new value).
  - Prompt the user via `add_secret` to set the edge-function env `CRON_SECRET` to that **same** token (I'll pre-fill the value so it's a one-click confirm).
- Once both sides match, the very next 5-minute tick will return 200, write the heartbeat, and the UI status flips to green.

### 2. Harden the handshake (so this can't silently break again)

- Extend `supabase/functions/_shared/auth-helpers.ts → requireCronOrUser` to accept the cron secret via **either**:
  - `x-cron-secret: <CRON_SECRET>` (current path), or
  - `Authorization: Bearer <CRON_SECRET>` (the path the user explicitly asked for).
- Update the `auto-post-scheduler` cron command (via the insert tool, since the command embeds the project-specific anon key and URL) to send the same secret in both headers. Belt + suspenders.

### 3. UI status correction in `SystemHealthCard.tsx`

Replace the binary Active/Inactive logic with a three-state derivation based on `last_run_at` age + `last_status`:

```text
≤ 5 min  & status=ok        → Active   (green pulse)
5–10 min & status=ok        → Stale    (amber)
> 10 min OR status=error    → CRITICAL (red, solid dot)
```

- "Cron Status" badge color and the header badge both reflect this state.
- When CRITICAL, render an inline error row that surfaces:
  - `last_message` from `system_health` if present (e.g. `triggered=0`, real error text).
  - The exact failure label from the most recent probe — see #4 — like `401 Unauthorized` or `500 Timeout`.

### 4. "Safe Reset" + live probe on Refresh

- Replace the existing **Refresh** button with **Safe Reset** (existing dry-run button stays untouched).
- Safe Reset performs:
  1. `supabase.functions.invoke("auto-post-scheduler", { body: { probe: true } })` — non-destructive (the function already has dry-run plumbing; a `probe` flag will be treated as a dry-run + force heartbeat write).
  2. Reads HTTP status and `error.message` (`FunctionsHttpError` exposes both) and stores it in component state for the CRITICAL error line.
  3. Re-fetches `system_health` and toasts either "✅ Heartbeat OK" or "❌ <status> — <message>".
- Auto-poll interval stays at 30s and silently runs the same fetch (no probe) so the card self-recovers without user input once the secret is re-synced.

### 5. Automatic wake-up when settings are saved

- In `src/components/SettingsPanel.tsx`, immediately after the existing settings-save success handler, fire-and-forget:

  ```ts
  supabase.functions.invoke("auto-post-scheduler", { body: { wakeup: true } }).catch(() => {});
  ```

- The scheduler treats `wakeup: true` like `probe: true` — it writes the heartbeat, runs no slots, and returns. This proves the link is alive every time the user touches settings, so any future drift is visible within seconds.

- Add a tiny helper `src/lib/wakeupScheduler.ts` so other save sites (CityManager, automation toggles) can call it later without duplication — wire it only in SettingsPanel for now to keep scope tight, per the user's "settings save" requirement.

### 6. Minor: scheduler accepts `probe` / `wakeup`

In `supabase/functions/auto-post-scheduler/index.ts`, immediately after the existing `dryRun` parsing, parse `probe`/`wakeup`. If either is true:
- Write the heartbeat row (`last_status: "ok"`, `last_message: "probe ok"`).
- Return `{ probe: true, ok: true }` without entering the slot loop.
This is the only edge-function logic change.

---

## Files touched

- `supabase/functions/_shared/auth-helpers.ts` — accept `Authorization: Bearer <CRON_SECRET>` in addition to `x-cron-secret`.
- `supabase/functions/auto-post-scheduler/index.ts` — recognize `probe`/`wakeup` body flags as a heartbeat-only fast path.
- `src/components/SystemHealthCard.tsx` — three-state status, error message surface, Safe Reset button.
- `src/lib/wakeupScheduler.ts` — new tiny helper.
- `src/components/SettingsPanel.tsx` — call wakeup helper after a successful save.

## Data / secret ops

- `insert` tool: update `vault.secrets.cron_secret` to a freshly generated token.
- `insert` tool: rewrite the `auto-post-scheduler` cron command to send both `x-cron-secret` and `Authorization: Bearer <secret>`.
- `add_secret` prompt: ask the user to update edge-env `CRON_SECRET` to the same freshly generated token (one-click confirm with value pre-filled).

## Explicitly NOT touched

- Posting pipeline, render pipeline, scheduled_posts flow.
- Any other cron job's command (only `auto-post-scheduler` is the broken one — the other 8 jobs are still firing fine, but they share the same secret so the re-sync automatically heals them too).

---

## Expected outcome

- Within ~5 min of completing the re-sync, the System Health card flips to **Active (green)** and the 8:00 AM slot will be inside the post window when cron next ticks.
- If anything breaks again, the UI will show **CRITICAL (red)** with the exact HTTP status + message instead of a silent "Inactive".

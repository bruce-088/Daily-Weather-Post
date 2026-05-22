# Plan: Background weekly recap render+upload via EdgeRuntime.waitUntil

Scoped to `supabase/functions/create-weekly-recap/index.ts` only. No schema changes, no other function changes.

## Problem

`runForUser` does the full Creatomate poll loop (up to ~60s+) plus the YouTube upload synchronously inside the request handler. The pg_cron caller hits Supabase's ~150s request-idle ceiling and times out before `[recap] uploaded to YouTube as videoId: …` fires, even though the render itself succeeds.

## Change

Rework only the `Deno.serve` handler at the bottom of the file (lines 671–735). All helper functions (`stitchSlideshow`, `uploadLongFormToYouTube`, `generateFallbackInfographic`, `runForUser`, etc.) remain untouched — their logs and `post_history` write paths (success row, failed row, fallback infographic row) are already correct.

### New handler shape

```text
Deno.serve(req):
  OPTIONS → cors
  auth gate → reject if not ok
  parse optional { city, user_id } body
  query candidate users (same as today)

  build a single async work() closure that:
    - loops candidates
    - calls runForUser(svc, user_id, cityFilter) per user
    - catches per-user errors, pushes into results[]
    - after loop, upserts system_health row (same payload as today)
    - logs `[recap] background job complete: N/M recaps`

  if EdgeRuntime?.waitUntil exists:
      EdgeRuntime.waitUntil(work())
  else:
      work().catch(e => console.error('[recap] background failed:', e))

  return 202 immediately with { ok: true, accepted: true, candidates: candidates.length }
```

### Key properties

- **Immediate 202 response** to the cron caller — the pg_cron HTTP request closes before any Creatomate polling happens.
- **All existing logs still fire** inside the background closure because `runForUser` is called unchanged: `[recap] render output size=…`, `[recap] render duration reported by Creatomate: …`, `[recap] pre-upload HEAD check: …`, `[recap] uploaded to YouTube as videoId: …`.
- **Failure rows unchanged**: any throw or upload failure inside `runForUser` already writes a `failed` row to `post_history` (no-token, pre-upload guard, both-stitch-and-infographic-failed). The outer per-user try/catch still logs `[recap] user … failed:` for unexpected throws.
- **system_health upsert** moves inside `work()` so it reflects what actually ran in the background, not what was queued.
- **Fallback** when `EdgeRuntime` is undefined (local dev): fire-and-forget with `.catch`. Plan-of-record runtime is Supabase Edge, where `EdgeRuntime.waitUntil` is always available.

### Response body

Keep the response JSON small and obviously async:
```json
{ "ok": true, "accepted": true, "candidates": <count> }
```
HTTP 202. The cron caller doesn't read the body — it only needs a 2xx.

## Verify after deploy

1. Trigger one manual recap: `POST /create-weekly-recap` with service-role and `{ "user_id": "<id>" }`.
2. Confirm:
   - HTTP response returns within a second or two with `{ ok: true, accepted: true }`.
   - Edge logs continue past poll 26 and show:
     - `[recap] render output size=XXXXXX type=video/mp4` (>1MB)
     - `[recap] render duration reported by Creatomate: Ns` (N ≥ 65)
     - `[recap] pre-upload HEAD check: status=200 length=… type=video/mp4`
     - `[recap] uploaded to YouTube as videoId: …`
     - `[recap] background job complete: 1/1 recaps`
   - Video appears in the YouTube **Videos** tab (not Shorts, not "Processing abandoned").
   - `post_history` has a `succeeded` row with the new `external_id`.

## Out of scope

- No changes to `stitchSlideshow`, `uploadLongFormToYouTube`, `generateFallbackInfographic`, or `runForUser`.
- No schema changes.
- No other edge functions.
- No frontend changes.
- No daily Shorts pipeline changes.

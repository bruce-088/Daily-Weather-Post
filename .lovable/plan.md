# Plan: Relax weekly recap size guard 1MB → 100KB

Scoped to `supabase/functions/create-weekly-recap/index.ts`. Two literal swaps, nothing else.

## Change

Replace both `1_000_000` thresholds with `100_000`:

- **Line 416** — post-render validator inside `stitchSlideshow`:
  ```ts
  if (bytes < 100_000 || !/video\/mp4/i.test(contentType)) { … abort … }
  ```
- **Line 601** — pre-upload HEAD guard inside `runForUser`:
  ```ts
  if ((hLen > 0 && hLen < 100_000) || (hType !== "unknown" && !/video\/mp4/i.test(hType))) { … abort … }
  ```

Keep everything else identical:
- `content-type: video/mp4` check — unchanged
- `reportedDuration ≥ 60s` warning log — unchanged (already separate)
- All log strings unchanged (still emit byte count + type so we can see what passed)
- Failure paths, fallback infographic path, post_history rows — unchanged

## Why 100 KB

A flat-gradient + text 81s 1080p MP4 H.264 compresses to ~280 KB — well above 100 KB but far below 1 MB. 100 KB still rejects the original failure mode (15 KB single-frame JPEG masquerading as video) with ~6× headroom.

## Verify after deploy

Re-trigger the Gainesville manual recap. Expect in logs:
- `[recap] render output size=287849 type=video/mp4` (no ABORT this time)
- `[recap] pre-upload HEAD check: status=200 length=~287849 type=video/mp4`
- `[recap] uploaded to YouTube as videoId: …`
- `[recap] background job complete: 1/1 recaps`
- Video appears under YouTube **Videos** tab (not Shorts, not "Processing abandoned").

## Out of scope

- No changes to duration warning logic, gradient builder, Creatomate payload, or fallback infographic.
- No schema or other-function changes.

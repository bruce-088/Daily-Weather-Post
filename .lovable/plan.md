## Plan: stop corrupt/invalid weekly recap uploads before YouTube

### 1. Validate Creatomate render output immediately after completion
In `supabase/functions/create-weekly-recap/index.ts`, update the successful Creatomate render branch to inspect the rendered URL before returning it:

- Fetch/render-download the output URL and capture:
  - `bytes` from the downloaded `ArrayBuffer`
  - `contentType` from the response header
  - `contentLength` from headers when available
- Add the required log:
  - `[recap] render output size={bytes} type={contentType}`
- Abort the stitch result if:
  - downloaded bytes are `< 1_000_000`
  - content type is not `video/mp4` compatible
- Add the required abort log:
  - `[recap] ABORT: render output invalid`

### 2. Log and warn on Creatomate-reported duration
In the same successful render branch:

- Read the duration from the Creatomate render status payload.
- Add:
  - `[recap] render duration reported by Creatomate: {duration}s`
- If reported duration is a number below 60 seconds, add:
  - `[recap] WARNING: duration under 60s, YouTube will reject`

### 3. Force YouTube-safe Creatomate output settings
The function already sets `output_format: "mp4"`, `frame_rate: 30`, and `source.width/height` to `1920x1080`.

I’ll add the missing explicit Creatomate codec field:

```ts
codec: "h264"
```

I’ll keep `width` and `height` in the `source` object because that matches the current Creatomate payload structure already in use.

### 4. Add a final pre-upload guard
Before `uploadLongFormToYouTube(...)` runs, validate the `stitched.url` with a `HEAD` request:

- Check `Content-Length` if present.
- Check `Content-Type` if present.
- Abort upload if `Content-Length < 1_000_000` or content type is clearly not MP4.
- Log the guard result with a `[recap]` prefix.

To support this cleanly, extend `StitchResult` to carry enough metadata from the render validation step, while still using the existing `stitched.data` upload path.

### 5. Deploy and verify
After implementation:

- Deploy only `create-weekly-recap`.
- Pull fresh function logs to confirm deployment/boot and that the new log points are present for the next run.

No schema changes, no daily pipeline changes, and no frontend changes.
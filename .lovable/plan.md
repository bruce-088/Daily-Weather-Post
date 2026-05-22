## Plan: guarantee MP4 for text-only weekly recap + fix infographic fallback

Scoped to `supabase/functions/create-weekly-recap/index.ts` only. No changes to daily Shorts pipeline, captions, or schema.

### 1. Animated gradient background per slide (forces real MP4 encoding)

In `stitchSlideshow`, for **every** slide section (title card, each of the 7 day slides, outro), add a background rectangle element with motion so Creatomate always sees frame-to-frame change:

- A full-frame `rectangle` (or `shape`) element sized 1920x1080 sitting beneath the existing text.
- `fill_color` set from a **time-of-day palette** picked per slide:
  - Morning → `#1e3a8a` → `#7e22ce` (deep blue → purple)
  - Afternoon → `#ea580c` → `#f59e0b` (orange → amber)
  - Evening → `#0f172a` → `#581c87` (dark navy → deep purple)
  - Title / outro → evening palette (brand-consistent)
  - Slot picked from the slide's `created_at` hour (morning <12, afternoon 12-16, evening >16).
- Add a **slow scale animation** on the background using Creatomate `animations: [{ type: "scale", from: 1.0, to: 1.05, duration: SLIDE_DUR, easing: "linear" }]` so motion is present even when no `image_url` exists.
- A second `animations` entry with `type: "fill_color"` (or a fade between two color stops) to shift gradient stop over the slide duration.

**Per-slide branching:**
- If `p.image_url` is present → keep the existing `image cover` element (Ken-Burns-ish via existing fade), and still place an animated gradient *under* it as a safety net (cheap, ensures motion even if the image fails to load).
- If `p.image_url` is null/missing → only the animated gradient + text. Log:
  - `[recap] slide {n} using animated gradient (no image_url)`

Also keep the existing `fill_color: "#0f172a"` on the `source` as a final safety fill.

### 2. Fix infographic fallback endpoint (404)

The current code POSTs to `https://ai.gateway.lovable.dev/v1/images/generations` (OpenAI-style), which returns 404. The Lovable AI Gateway image surface is the **chat completions endpoint** with `modalities: ["image", "text"]` and `google/gemini-2.5-flash-image`.

Rewrite `generateFallbackInfographic`:
- POST to `https://ai.gateway.lovable.dev/v1/chat/completions` with:
  ```json
  {
    "model": "google/gemini-2.5-flash-image",
    "messages": [{ "role": "user", "content": "<prompt>" }],
    "modalities": ["image", "text"]
  }
  ```
- Extract base64 from `choices[0].message.images[0].image_url.url` (strip `data:image/png;base64,` prefix).
- Wrap entire flow in try/catch; on any failure return `null` and log:
  - `[recap] image gen failed, falling back to animated gradient`

### 3. Graceful fallthrough when infographic fails

Today, if both stitch and infographic fail, the function writes a `failed` `post_history` row and gives up. With change #1 above the stitch path will essentially always succeed (animated gradient guarantees MP4), so the infographic fallback becomes a rarely-used safety net. Still:

- Keep the infographic write path as-is for successful image gen.
- If infographic fails AND stitch already failed, the existing failure row is fine — no abort behavior change beyond the new log line.

### 4. Deploy & verify

- Deploy only `create-weekly-recap`.
- Trigger one manual recap (`POST {}` with service role) for the user.
- Confirm in logs:
  - `[recap] slide N using animated gradient (no image_url)` for any null-image slides
  - `[recap] render output size=XXXXXX type=video/mp4` with bytes > 1,000,000
  - `[recap] render duration reported by Creatomate: Ns` with N ≥ 65
  - `[recap] pre-upload HEAD check: status=200 length=>1MB type=video/mp4`
  - YouTube returns a video id and the video appears under the **Videos** tab (not Shorts, not "Processing abandoned").

### Out of scope
- No daily Shorts pipeline changes
- No caption / blacklist changes
- No schema changes
- No frontend changes

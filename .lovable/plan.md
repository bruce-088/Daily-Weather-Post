

## Plan: Integrate Creatomate for Weather Video Generation

### What needs to happen

The `generateWeatherVideo()` function in `daily-weather-post/index.ts` is currently a stub returning `null`. We need to replace it with a real Creatomate API call that renders a weather-themed YouTube Shorts video (1080x1920, 9:16) and returns the MP4 bytes for upload.

### Prerequisites

**Creatomate API Key** — You will need a Creatomate account and API key. You can get one at [creatomate.com](https://creatomate.com). I will securely store it as a backend secret called `CREATOMATE_API_KEY`.

### Implementation

#### 1. Add `CREATOMATE_API_KEY` secret
Prompt you to enter your Creatomate API key via the secrets tool.

#### 2. Implement `generateWeatherVideo()` in `daily-weather-post/index.ts`

Replace the stub with a function that:
- Builds a Creatomate JSON source defining a 1080x1920 video (5-8 seconds) with:
  - Dark gradient background matching the SkyBrief brand
  - City name, temperature, condition text
  - Morning/afternoon/evening breakdown
  - Rain chance and wind info
  - Subtle text animations (fade-in per line)
- POSTs to `https://api.creatomate.com/v2/renders` with `output_format: "mp4"`
- Polls the render status until complete (Creatomate returns a render URL)
- Downloads the finished MP4 and returns it as `{ data: Uint8Array, mimeType: "video/mp4" }`

#### 3. Apply the same change in `process-scheduled-posts/index.ts`

Extract the shared `generateWeatherVideo()` into both edge functions so scheduled posts also produce real videos.

#### 4. Add error handling and logging

Log render progress, handle Creatomate API errors gracefully, and fall back to a "pending" status if rendering fails.

### How Creatomate rendering works

```text
Edge Function                    Creatomate API
    │                                 │
    ├─ POST /v2/renders (JSON) ──────►│
    │                                 ├─ Returns render ID + status
    │◄────────────────────────────────┤
    │                                 │
    ├─ GET /v2/renders/{id} (poll) ──►│
    │                                 ├─ "rendering" / "succeeded"
    │◄────────────────────────────────┤
    │                                 │
    ├─ fetch(render.url) ────────────►│ (download MP4)
    │◄────────────────────────────────┤
    │                                 │
    └─ Upload to YouTube ─────────────►
```

The video template will be defined inline as JSON (no pre-built Creatomate template needed), keeping everything self-contained in the edge function.


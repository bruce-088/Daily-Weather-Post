

# Enhanced Image Fallback as Primary Alternative to Creatomate

## Summary

Replace the Creatomate video dependency with a higher-quality AI image generation pipeline as the primary content generation method. When Creatomate fails (or is unavailable), the system will generate polished, branded weather infographic images using `google/gemini-3-pro-image-preview` (higher quality model) instead of the current basic fallback.

## Changes

### 1. Upgrade `generateFallbackImage` in both edge functions

- Switch from `google/gemini-2.5-flash-image` to `google/gemini-3-pro-image-preview` for higher quality output
- Enhance the prompt to produce a more polished, branded infographic with:
  - Morning/afternoon/evening time period context
  - Tomorrow's forecast preview
  - Practical takeaway line
  - Alert line (if applicable)
  - Better SkyBrief branding instructions
  - Specific layout and typography guidance

**Files affected:**
- `supabase/functions/daily-weather-post/index.ts` — update `generateFallbackImage()`
- `supabase/functions/process-scheduled-posts/index.ts` — update matching `generateFallbackImage()`

### 2. Make image generation the primary path when Creatomate fails

Current flow: Creatomate → fallback image (basic)
New flow: Creatomate → **enhanced image** (high-quality, branded)

The logic in the main handler already falls back correctly. The key improvement is the image quality and prompt richness.

### 3. Preview mode image support

Currently preview mode only works with video. Update it to also support image previews when video generation fails — store the image in `generated-images` bucket and return a signed URL.

**Files affected:**
- `supabase/functions/daily-weather-post/index.ts` — update preview mode block (lines 988-1027)

### 4. Update `VideoPreviewDialog` for image support

Allow the preview dialog to display either a video or an image, depending on what was generated.

**Files affected:**
- `src/components/VideoPreviewDialog.tsx`
- `src/lib/api.ts` — update `PreviewResult` type to include `content_type`

## Technical Details

### Enhanced image prompt structure
```
Create a premium weather infographic for social media (vertical 9:16, 1080x1920).
- Dark gradient background ({theme colors})
- "SKYBRIEF" logo text at top, clean sans-serif
- Time period badge: "{period} UPDATE"
- City name large and bold: {city}
- State + date subtitle
- Large temperature: {temp}°F with weather emoji
- Condition text in accent color
- Stats row: High/Low/Rain/Wind
- Practical tip: "{takeaway}"
- Alert line if applicable
- Tomorrow preview line
- Clean, minimal, professional weather app aesthetic
```

### Preview mode changes
When `video` is null in preview mode, generate an enhanced image instead of throwing an error. Return `content_type: "image"` in the response so the frontend knows what to render.


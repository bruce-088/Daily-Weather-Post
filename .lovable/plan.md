

## Plan: Add Download Button to Video Preview Dialog

### What
Add a "Download" button to the `VideoPreviewDialog` footer so users can save the preview video locally before posting — enabling review in other tools/LLMs.

### How

**File: `src/components/VideoPreviewDialog.tsx`**

1. Import the `Download` icon from `lucide-react`
2. Add a `handleDownload` function that:
   - Fetches the video from `preview.video_url`
   - Creates a temporary `<a>` element with a `download` attribute
   - Uses a filename like `skybrief-preview-{city}-{timestamp}.mp4`
3. Add a "Download" button in the `DialogFooter` between "Re-render" and "Discard"

The video URL is already a public storage URL, so downloading is straightforward with a fetch + blob approach.

### Changes Summary
- **1 file modified**: `src/components/VideoPreviewDialog.tsx`
- No backend changes needed


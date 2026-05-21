## Fix: Weekly Recap uploads not appearing in YouTube Videos tab

### Root cause
`supabase/functions/create-weekly-recap/index.ts` builds a Creatomate slideshow with `SLIDE_DUR = 4` seconds across 7 day-slides + 1 title card = **~32 seconds total**. YouTube auto-classifies any upload **under 60 seconds** as a Short, even when the canvas is 1920×1080. That's why the video never shows up in the channel's *Videos* tab.

Secondary issues:
- Success path never logs the YouTube `videoId` returned by the API — only writes to `post_history`, so failures look silent in edge logs.
- Upload-success branch doesn't log the YouTube response body, making "uploaded but missing" cases hard to diagnose.
- Title/description currently contain no `#Shorts`, but there is no guard preventing a future edit from re-introducing it.

### Scope
Only `supabase/functions/create-weekly-recap/index.ts`. No changes to daily Shorts pipeline, caption blacklist, schema, or any other function.

### Changes

1. **Guarantee duration > 60s**
   - Bump `SLIDE_DUR` from `4` → `9` seconds (7 slides + title + outro = 81s).
   - Append a dedicated **outro card** element ("Thanks for watching — like + subscribe for daily {city} weather") with its own `SLIDE_DUR` window so even short weeks (3 slides → 45s pre-outro) still clear the 60s threshold once the outro is added.
   - Compute `totalDuration = (slides.length + 2) * SLIDE_DUR` (title + slides + outro) and assert `totalDuration >= 65` before submitting to Creatomate; if not, pad by extending the outro `duration` to make up the gap.

2. **Strip / guard against `#Shorts`**
   - Add a `stripShortsHashtag()` helper that removes `#Shorts`, `#shorts`, `#YTShorts` (case-insensitive) from both title and description before YouTube init.
   - Apply to `finalTitle` and `description` immediately before `uploadLongFormToYouTube(...)`.

3. **Explicit success/failure logs**
   - On YT init failure (already logs status+text), reformat as `[recap] YouTube upload failed: <status> <body>`.
   - On YT upload PUT failure, log `[recap] YouTube upload failed: <status> <body>`.
   - On success, log `[recap] uploaded to YouTube as videoId: <id>` and also log the full upload JSON at debug level (`[recap] YT response:`).
   - Log the computed duration before submit: `[recap] stitch duration=<n>s slides=<n>` so we can confirm >60s in logs.

4. **Defensive YouTube payload check**
   - Explicitly set `notifySubscribers: true` in the snippet/status payload (currently omitted — defaults true, but make it explicit).
   - Keep `selfDeclaredMadeForKids: false` and `privacyStatus: "public"` (already correct, leave as-is).
   - Add a `categoryId: "22"` comment confirming it's *People & Blogs* (already set) — no change, just a clarifying comment.

### Technical details

```ts
// new helper near top
function stripShortsHashtag(s: string): string {
  return s.replace(/#shorts\b/gi, "").replace(/#ytshorts\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

// in stitchSlideshow:
const SLIDE_DUR = 9; // was 4 — ensures min ~63s even with 5 slides
// ...build slides...
// append outro card
elements.push({
  type: "text",
  text: `Thanks for watching!\nLike + subscribe for daily ${city} weather.`,
  x: "50%", y: "50%", width: "90%",
  font_family: "Inter", font_weight: "800", font_size: "7 vh",
  fill_color: "#ffffff", background_color: "rgba(0,0,0,0.55)", padding: 24,
  time: (slides.length + 1) * SLIDE_DUR, duration: SLIDE_DUR,
  enter_animation: { type: "fade", duration: 0.4 },
});

let totalDuration = (slides.length + 2) * SLIDE_DUR;
if (totalDuration < 65) {
  const pad = 65 - totalDuration;
  // extend outro duration by `pad`
  elements[elements.length - 1].duration += pad;
  totalDuration += pad;
}
console.log(`[recap] stitch duration=${totalDuration}s slides=${slides.length}`);
```

```ts
// in runForUser before upload:
const cleanTitle = stripShortsHashtag(finalTitle);
const cleanDesc  = stripShortsHashtag(description);
const videoId = await uploadLongFormToYouTube(token, stitched.data, cleanTitle, cleanDesc);
if (videoId) {
  console.log(`[recap] uploaded to YouTube as videoId: ${videoId}`);
  // ...existing post_history insert...
}
```

```ts
// in uploadLongFormToYouTube, on success:
const j = await up.json();
console.log(`[recap] YT response:`, JSON.stringify(j).slice(0, 500));
return j?.id ?? null;
// on failure branches, replace existing console.error with:
console.error(`[recap] YouTube upload failed: ${up.status} ${await up.text()}`);
```

### Verification
1. Deploy `create-weekly-recap`.
2. Manually invoke with service-role auth: `POST /functions/v1/create-weekly-recap`.
3. Check edge logs for:
   - `[recap] stitch duration=Ns slides=M` where N ≥ 65
   - `[recap] uploaded to YouTube as videoId: <id>`
4. Open YouTube Studio → *Videos* tab → confirm the new upload is listed there (not under *Shorts*).
5. Confirm `post_history` row exists with `platform='youtube'`, `status='succeeded'`, and the `post_url` opens as a standard watch page.

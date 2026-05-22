## Feature: AI Voice Narration for Weekly Recap

Add ElevenLabs narration as the audio "master clock" for the weekly recap video, layered over low-volume background music. All changes are scoped to `supabase/functions/create-weekly-recap/index.ts`. No schema changes, no other function changes.

---

### 1. New helper: `synthesizeRecapVoice(svc, userId, script)`

- Read `weather_settings` for the user: `enable_voiceover`, `voiceover_voice_id`, `voiceover_speed`, `voiceover_stability`, `voiceover_similarity`. If `enable_voiceover !== true`, return `null` and skip (silent render path, unchanged).
- Resolve ElevenLabs key with the same multi-name resolver used in `process-scheduled-posts` (`ELEVENLABS_API_KEY` → `ELEVEN_LABS_API_KEY` → `ELEVENLABS_KEY`). If missing, log `[recap] voice synth failed, falling back to silent render` and return `null`.
- Log `[recap] synthesizing 0:~Ns voice script via ElevenLabs voice=<id> source=<env-name>` (N = estimated duration from word count, ~2.5 words/sec).
- POST to `https://api.elevenlabs.io/v1/text-to-speech/<voiceId>?output_format=mp3_44100_128` with `model_id: eleven_turbo_v2_5` and the same voice_settings shape as the daily worker. One retry on 5xx/timeout (30s abort), matching the daily worker.
- On any non-OK result, log `[recap] voice synth failed, falling back to silent render` (include status/detail) and return `null`.
- On success: upload mp3 to existing `generated-images` bucket at `weekly-recap-audio/<userId>/<ts>-voice.mp3` (`upsert: true`), then `createSignedUrl(path, 60 * 60)`. Log `[recap] voice asset ready: <signed_url> bytes=<n>`. Return `{ url, durationSec }` — `durationSec` estimated from bytes (mp3 128 kbps ⇒ `bytes / 16000`) and rounded up to integer.
- Caching note: re-uses the existing bucket; the timestamped path means retries within the same run reuse the upload (no extra logic needed beyond `upsert:true`).

### 2. Wire voice into `stitchSlideshow` (signature + body)

- Change signature to `stitchSlideshow(svc, userId, posts, title, voice?: { url: string; durationSec: number })`. `runForUser` passes the synthesized voice (or `undefined`).
- Compute `visualDuration = (slides.length + 2) * SLIDE_DUR` (existing logic, with the existing ≥65s padding still applied).
- Compute `totalDuration = Math.max(visualDuration, voice ? Math.ceil(voice.durationSec + 1) : 0, 65)`.
- If `totalDuration > visualDuration` (voice longer than visuals), extend the outro by `totalDuration - visualDuration`: bump `elements[outroTextIdx].duration`, `elements[outroBgIdx].duration`, and `elements[outroBgIdx].animations[0].duration`. This is the same extension pattern already used for the 65s minimum.
- Log `[recap] timing: visual=${visualDuration}s voice=${voice?.durationSec ?? 0}s total=${totalDuration}s outro_extended=${totalDuration - visualDuration}s`.

### 3. Audio tracks in Creatomate payload

Replace the current single silent-audio element with two layered tracks:

- **Voice track** (only when `voice` present):
  ```
  { type: "audio", source: voice.url, time: 0, duration: totalDuration, volume: 1.0 }
  ```
- **Background music track** (always, when a music URL is available):
  - Add `RECAP_MUSIC_URL = Deno.env.get("RECAP_MUSIC_URL")` near the other env reads. Document in the spec that this is an optional public mp3 URL (loopable instrumental bed). When unset, music is simply omitted.
  - Element:
    ```
    { type: "audio", source: RECAP_MUSIC_URL, time: 0, duration: totalDuration, volume: 0.15, loop: true }
    ```
  - Creatomate supports per-element `volume`; mixing two audio tracks naturally ducks the music under the louder voice (voice at 1.0 ≈ 0 dB, music at 0.15 ≈ -16 dB), satisfying the broadcast feel without needing dynamic sidechain.
- **Silent fallback** (only when neither voice nor music present): keep the existing `createSignedSilentAudio` + low-volume silent track so YouTube doesn't abandon processing. Behaviour today is preserved.

Log a one-liner per render: `[recap] audio mix: voice=<yes|no> music=<yes|no> silent_fallback=<yes|no>`.

### 4. `runForUser` orchestration

Between `generateWeeklyScript` and `stitchSlideshow`:

```
const voice = await synthesizeRecapVoice(svc, userId, script);
const stitched = await stitchSlideshow(svc, userId, posts, finalTitle, voice ?? undefined);
```

- If voice synth fails, the function continues with `voice = null` and we fall through to the existing silent render path. No new failure mode is introduced.
- Existing post_history success / failure / fallback-infographic writes stay exactly as they are.

### 5. Spec & memory

- `supabase/functions/generate-spec/index.ts`: extend the weekly-recap section to mention voice narration (gated by `weather_settings.enable_voiceover`), ducked music at 15%, silent fallback, and the new optional `RECAP_MUSIC_URL` secret.
- Add a memory entry `mem://features/weekly-recap-voice` (and reference it from `mem://index.md`) describing the master-clock behavior, 15%/100% mix, and fallback rules.

---

### Spec Delta

- **What changed**: Weekly recap renders now include an ElevenLabs voice track (when the user has `enable_voiceover=true`) plus a ducked background-music bed (when `RECAP_MUSIC_URL` is configured). The voice track is the master clock — visual outro extends to match.
- **Why**: Make the recap feel like a real broadcast with clearly audible narration over light music.
- **Behavior impact**:
  - Recap total duration = `max(visual, voice+1s, 65s)`.
  - When voice synth fails for any reason (missing key, 401, 5xx, timeout, upload failure), the recap still renders and uploads — silent — with log `[recap] voice synth failed, falling back to silent render`.
  - Audio mix: voice at `volume: 1.0`, music at `volume: 0.15`.
- **Schema/contract impact**: none. Reads existing `weather_settings.voiceover_*` fields. New optional env secret `RECAP_MUSIC_URL`.
- **Living spec updates**: weekly-recap section in `generate-spec/index.ts` + new `mem://features/weekly-recap-voice`.

---

### Verification

Trigger `create-weekly-recap` for Gainesville and confirm logs:

- `[recap] synthesizing 0:~Ns voice script via ElevenLabs voice=<id> source=ELEVENLABS_API_KEY`
- `[recap] voice asset ready: <signed url> bytes=<n>`
- `[recap] timing: visual=81s voice=85s total=85s outro_extended=4s` (or similar)
- `[recap] audio mix: voice=yes music=<yes|no> silent_fallback=no`
- `[recap] uploaded to YouTube as videoId: …`

Then play the resulting YouTube video and confirm the narration is clearly audible above the music bed (or above silence if `RECAP_MUSIC_URL` is not set yet).

### Out of scope

- No changes to the daily pipeline, scheduler, adapters, or any other edge function.
- No new tables, RLS, or migrations.
- No dynamic sidechain ducking — fixed 1.0 / 0.15 volume mix is the agreed broadcast feel.
- No frontend UI changes (voice toggle already exists in Settings).

## Fix: Weekly Recap Audio Volume Too Low

### What
Increase the voice narration track volume in the weekly recap Creatomate render so it is clearly audible at normal listening volume.

### Changes
1. **Boost voice track** — Change `volume: 1.0` → `volume: 2.0` on the voice audio element in `stitchSlideshow` (Creatomate accepts values >1.0 as amplification; 2.0 ≈ +6dB).
2. **Keep music bed unchanged** — Music remains at `volume: 0.15` (already correct).
3. **Update audio mix log** — Change the existing `[recap] audio mix:` log line to include the actual volume values:
   - `voice=yes(vol=2.0)` when voice is present
   - `music=yes(vol=0.15)` when music is present

### File
- `supabase/functions/create-weekly-recap/index.ts`

### Verification
Trigger a Gainesville recap and confirm the log shows:
```
[recap] audio mix: voice=yes(vol=2.0) music=no silent_fallback=no
```
Voice narration should be clearly audible over the music bed.
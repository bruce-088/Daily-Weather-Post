## Update `supabase/functions/generate-spec/index.ts`

Two targeted string edits, no other sections touched.

### 1. Section 6 — add Title Generation subsection

Section 6 in the rendered doc is currently "Database Schema" (the constants are ordered Identity → Features → Slots → Sources → Pipeline → Schema). The user's "Section 6" refers to the Title-related spec area. Since title generation isn't currently its own section in the constants, add a new constant `TITLE_GENERATION` and render it as a subsection appended to the existing `PIPELINE_FLOW` block (Section 5) — OR more cleanly: append it inside the Slot System block (Section 3), which already covers title prefixes.

Recommended placement: append as a new `### Title Generation` subsection at the end of the `SLOT_SYSTEM` constant, since that's where title-prefix rules already live. Content:

```
### Title Generation
- Single source of truth: `ensureSlotTitlePrefix()` in `_shared/caption-style.ts`
- Slot inference: `inferSlotFromCityHour(city)` maps city-local hour to morning / afternoon / evening
- Broadcast slots only: morning → [8 AM], afternoon → [1 PM], evening → [6 PM]
- Manual posts without a selected slot infer slot from current city-local hour
- Prefix is always first — before emojis, text, or hashtags
- Stale/wrong prefixes are stripped and replaced (no duplication)
- Total title length enforced at ≤95 chars; base is truncated, prefix is never cut
```

### 2. Section 14 — add row to Recently Resolved Issues

Append one row to the `RESOLVED_ISSUES` markdown table:

```
| Slot prefix inconsistency | Fixed via ensureSlotTitlePrefix in _shared/caption-style.ts — all sources now use single helper |
```

### 3. Deploy

Deploy `generate-spec` edge function after the edit.

### Confirm before I build

The user wrote "Section 6 (Title Generation)" but Section 6 in the current spec is "Database Schema". Should the Title Generation subsection go under Section 3 (Slot System, which already mentions title prefixes) — or should I insert a brand-new dedicated Section 6 "Title Generation" and renumber subsequent sections? I'll default to appending under Slot System unless you say otherwise.

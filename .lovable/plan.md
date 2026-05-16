## Safety Patch — Non-Breaking Guardrails

Goal: ensure the recent "Content Professionalism" changes can never break the pipeline. Wrap all new logic in fail-safe guards and confirm `buildHookTitle` remains a pure prefix change.

### Files touched (only these, no schema/cron/job changes)
- `supabase/functions/process-scheduled-posts/index.ts`
- `supabase/functions/generate-caption/index.ts`

No changes to `_shared/caption-style.ts`, adapters, job-handlers, run-jobs, or DB.

---

### 1. `buildHookTitle` — audit + harden prefix only

Current code (process-scheduled-posts/index.ts, lines 202–290) already keeps the original signature `buildHookTitle(city, temp, condition, rainChance?, slot?)`, original pool logic, original 95-char cap, and only modifies the final return by prepending `[${stamp}]`.

Patch: wrap the prefix step so any failure inside `slotTimePrefix` returns the un-prefixed `baseTitle` (still truncated to 95 chars). Net effect: pipeline can never crash from the new slot prefix.

```ts
// lines 282-289 (final return block)
const seed = new Date().getDate() * 24 + hour;
const baseTitle = pool[seed % pool.length];
let stamped = baseTitle;
try {
  const stamp = slotTimePrefix(slot, city);
  if (stamp) stamped = `[${stamp}] ${baseTitle}`;
} catch (err) {
  console.warn("buildHookTitle: slot prefix failed, using base title", err);
}
return stamped.length > 95 ? stamped.substring(0, 92) + "..." : stamped;
```

No signature change, no return-type change, no internal pool/validation change.

---

### 2. `process-scheduled-posts` SKYBRIEF block — fail-safe diversity logic

Today, lines 2114–2234 already sit inside one outer `try/catch` (line 2231) that swallows errors but can leave `caption` null and skip the post. Tighten it so each new enhancement is independently safe and the call always falls back to the original prompt + the original caption result.

Patch shape (no behavior change on the happy path):

```ts
// Diversity block construction — never throws
let _diversityBlock = "";
try {
  const _rotCTA = rotatingCTA(_slotForGen);
  const _personality = slotPersonalityDirective(_slotForGen);
  _diversityBlock = [
    _personality,
    _prevOpener ? `ANTI-REPEAT: ... "${_prevOpener}" ...` : "",
    `CTA ROTATION: ... "${_rotCTA}" ...`,
  ].filter(Boolean).join("\n\n");
} catch (err) {
  console.warn("Caption enhancement (diversity block) failed — falling back", err);
  _diversityBlock = "";
}

// Previous-caption lookup — already in try/catch; keep, plus null-safe _prevOpener.

// Similarity check — independent guard so a bad regen never nukes the good caption
if (caption && _prevCaption) {
  try {
    const sim = captionSimilarity(caption, _prevCaption);
    if (sim >= 0.8) {
      // existing regen + system_logs insert
    }
  } catch (err) {
    console.warn("Caption similarity check failed — keeping original caption", err);
  }
}
```

Rules enforced:
- New logic never throws out of the caption step.
- If diversity/CTA/similarity fails, `caption` retains whatever the model returned (or null → existing downstream fallback path is unchanged).
- Outer pipeline flow (validation, beacon, render, publish) untouched.

---

### 3. `generate-caption/index.ts` — fail-safe prompt enhancements

Lines 355–357 currently inline `slotPersonalityDirective(...)`, `rotatingCTA(...)`, and the `prev_opener` anti-repeat clause directly into the `userPrompt` template literal. If any helper throws, the whole request 400s.

Patch: precompute these into local strings inside a `try/catch`, default to empty strings on failure, then interpolate.

```ts
let personalityBlock = "";
let ctaBlock = "";
let antiRepeatBlock = "";
try {
  personalityBlock = slotPersonalityDirective(body.slot ?? period) || "";
  const cta = rotatingCTA(body.slot ?? period);
  ctaBlock = cta ? `CTA ROTATION: ... "${cta}" ...` : "";
  if (body.prev_opener) {
    antiRepeatBlock = `ANTI-REPEAT: ... "${String(body.prev_opener).slice(0,160)}" ...`;
  }
} catch (err) {
  console.warn("Caption enhancement failed — falling back to default logic", err);
  personalityBlock = ""; ctaBlock = ""; antiRepeatBlock = "";
}

// Then in the userPrompt template, replace the inline expressions with the
// pre-built strings (joined with blank lines, all optional).
```

Net effect: if any new helper breaks, the model still gets the original SkyBrief prompt and returns a valid caption. No 4xx/5xx surfaced to callers.

---

### Guarantees
- Function signatures, return types, and pipeline contracts unchanged.
- No DB migrations, no edge-function additions/removals, no cron edits.
- Every new feature (slot prefix, personality, CTA rotation, anti-repeat, similarity check) is now wrapped so a thrown error degrades to the pre-patch behavior silently with a `console.warn`.
- Both edge functions redeployed after edits: `process-scheduled-posts`, `generate-caption`.

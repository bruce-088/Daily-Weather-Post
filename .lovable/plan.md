## Goal
Soften Creative Decay so it prevents spam without starving the algorithm of proven winners. Add a tiered penalty, allow strategic reuse of top performers, and update the Diversity Guard wording.

## Changes

### 1. `supabase/functions/_shared/learning-patterns.ts`

**Track recency precisely.** Replace the single `recentUseCount` map with:
- `recentUseCount` (still last 48h, all uses)
- `last2Hooks: string[]` — normalized hooks from the 2 most recent city posts (used to block consecutive/last-2 reuse)
- `lastHook: string | null` — most recent (consecutive guard)

**Tiered weighted decay** (replaces the flat 0.2 penalty):
```
overused = recentUseCount.get(normalizedHook) || 0
weight = overused <= 1 ? 1.0
       : overused === 2 ? 0.6   // -40%
       : 0.2                    // -80% for 3+
```

**Strategic-reuse rescue.** Before applying the penalty, look up the hook's best `performance_score` from `post_analytics` (join via `hook_used` for this user, last 60d). If `bestScore >= 85` AND the normalized hook is NOT in `last2Hooks`, force `weight = 1.0` and tag it `rescued: true`.

**New `recentlyUsedAllowed` tier** on the returned `TopPatterns`:
```
recentlyUsedAllowed: Array<{ hook: string; score: number; uses48h: number }>
```
Populated with rescued hooks (high performance, not in last 2, not consecutive). Surface up to 3.

**Forbidden list narrows** — `forbiddenOpeners` becomes ONLY `last2Hooks` (was last 3 distinct). Themes logic unchanged.

**Type updates.** Extend `TopPatterns` with `recentlyUsedAllowed`. Keep existing fields for backward compatibility.

### 2. `buildLearningPromptBlock` (same file)

Add a new section when `recentlyUsedAllowed.length > 0`:
```
RECENTLY USED BUT ALLOWED (proven winners — may be reused, but MUST be rephrased with a new opening structure and angle):
  - "<hook>" (score 88, used 2× in 48h)
```

Tighten the FORBIDDEN block copy to: "used in the last 2 city posts — do NOT repeat verbatim or as the opener."

### 3. `supabase/functions/generate-caption/index.ts` (line 343)

Replace the Diversity Guard string:
```
DIVERSITY GUARD:
Avoid repeating recent hooks. If reusing a proven high-performing pattern,
it MUST be rephrased with a new angle and different opening structure.
Prefer secondary weather signals (wind, humidity, visibility, dew point,
UV, local activity, cinematic atmosphere) when conditions are mild.
```

### 4. `supabase/functions/generate-spec/index.ts`

Per the Spec Delta rule, update the Creative Decay / Learning Loop section of the live spec to document:
- Tiered decay (0 / -40% / -80%)
- Performance-score rescue (≥85 and not in last 2)
- New "Recently Used but Allowed" tier
- New Diversity Guard wording

## Spec Delta (preview)
- **What:** Creative Decay tiered penalty + strategic rescue of proven hooks; Diversity Guard rephrased.
- **Why:** Flat 80% penalty at 2 uses was discarding algorithmically-validated winners.
- **Behavior impact:** Top hooks (score ≥85) may reappear after a 2-post gap with a mandatory rephrase. 2-use hooks now decay -40% instead of -80%.
- **Schema impact:** None.
- **Spec sections updated:** Learning Loop → Creative Decay; Caption Prompt → Diversity Guard.

## Out of scope
- No schema changes, no new tables, no edge function additions.
- `generate-caption` keeps its existing structure aside from the Diversity Guard string.

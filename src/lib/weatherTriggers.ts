// Layer 7 — Smart Weather Triggers (suggestion only).
//
// Detects significant weather (storms or large temp swings) and suggests
// urgency mode for the preview. Never mutates anything outside the preview UI.

export interface UrgencyDetectInput {
  condition?: string | null;
  tempNow?: number | null;
  tempPrev24h?: number | null;
}

export interface UrgencySuggestion {
  hook: "A";
  cinematic: true;
  earlier_minutes: number;
}

export interface UrgencyResult {
  trigger: boolean;
  reason: string;
  suggest: UrgencySuggestion;
}

const STORM_RE = /storm|thunder|severe|tornado|hurricane|hail|squall/i;
const TEMP_DELTA_F = 10; // °F threshold

export function detectUrgency(input: UrgencyDetectInput): UrgencyResult {
  const reasons: string[] = [];
  const stormy = !!(input.condition && STORM_RE.test(input.condition));
  if (stormy) reasons.push("Severe weather detected");

  if (input.tempNow != null && input.tempPrev24h != null) {
    const delta = Math.abs(input.tempNow - input.tempPrev24h);
    if (delta >= TEMP_DELTA_F) {
      reasons.push(`${Math.round(delta)}°F swing in 24h`);
    }
  }

  return {
    trigger: reasons.length > 0,
    reason: reasons.join(" · "),
    suggest: { hook: "A", cinematic: true, earlier_minutes: 30 },
  };
}

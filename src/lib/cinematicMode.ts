/**
 * Cinematic Mode — weather-triggered visual enhancement detection.
 *
 * Pure detection helper. Does NOT modify the render pipeline, Creatomate JSON,
 * or voice/timing. UI surfaces (preview badge, post log) read from this to
 * indicate whether cinematic enhancements would apply.
 *
 * Trigger: dramatic weather only — rain, drizzle, shower, storm, thunder,
 * cloudy, overcast, fog, mist. Sunny / clear / hot / warm → standard always.
 */

const CINEMATIC_KEYWORDS = [
  "rain",
  "drizzle",
  "shower",
  "storm",
  "thunder",
  "cloudy",
  "overcast",
  "fog",
  "mist",
] as const;

export type CinematicTrigger = (typeof CINEMATIC_KEYWORDS)[number];

export interface CinematicEvaluation {
  enabled: boolean;
  trigger: CinematicTrigger | null;
}

export function evaluateCinematicMode(
  condition: string | null | undefined,
): CinematicEvaluation {
  if (!condition) return { enabled: false, trigger: null };
  const c = condition.toLowerCase();
  for (const kw of CINEMATIC_KEYWORDS) {
    if (c.includes(kw)) return { enabled: true, trigger: kw };
  }
  return { enabled: false, trigger: null };
}

export function isCinematicWeather(condition: string | null | undefined): boolean {
  return evaluateCinematicMode(condition).enabled;
}

/** Short human label for the post-confirmation log. */
export function cinematicLogLine(condition: string | null | undefined): string {
  const { enabled, trigger } = evaluateCinematicMode(condition);
  return enabled ? `Cinematic: ON (${trigger} detected)` : "Cinematic: OFF";
}

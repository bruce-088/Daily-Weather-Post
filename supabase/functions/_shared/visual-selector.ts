// Context-Aware Visual Selection
//
// Priority order:
//   1. Weather relevance  (e.g., storms → dramatic sky)
//   2. City relevance     (e.g., Gainesville clear → UF landmark)
//   3. Performance history (top-performing visual_style for the user)
//
// Goal: make visuals feel intentional, not random or repetitive.
// Returns a CANONICAL visual_style (gradient | sky | cinematic | minimal)
// consumed by the renderer, plus a human-readable label and reason.

export interface VisualSelection {
  style: string;          // canonical: gradient | sky | cinematic | minimal
  label: string;          // descriptive: dramatic_sky | local_landmark | bright_sky | ...
  reason: string;
  source: "weather" | "city" | "performance" | "fallback";
}

function normCondition(c: string | null | undefined): string {
  return String(c || "").toLowerCase();
}

function isStorm(c: string): boolean {
  return /storm|thunder|lightning|severe|tornado|hurricane|squall/.test(c);
}
function isClear(c: string): boolean {
  return /clear|sunny|sun\b/.test(c) && !/partly|mostly cloud/.test(c);
}
function isRain(c: string): boolean {
  return /rain|drizzle|shower/.test(c) && !isStorm(c);
}
function isSnow(c: string): boolean {
  return /snow|sleet|blizzard|flurr/.test(c);
}
function isCloudy(c: string): boolean {
  return /cloud|overcast|fog|mist|haze/.test(c);
}

/**
 * Pick a visual_style based on weather → city → performance priority.
 *
 * @param condition  Raw weather condition string.
 * @param city       City name.
 * @param topStyle   Optional top-performing canonical style from ai_memory/history.
 */
export function selectContextualVisualStyle(
  condition: string | null,
  city: string | null,
  topStyle?: string | null,
): VisualSelection {
  const cond = normCondition(condition);
  const cityName = String(city || "").trim();

  // ── 1. Weather relevance (highest priority) ─────────────────────────────
  if (isStorm(cond)) {
    return {
      style: "cinematic",
      label: "dramatic_sky",
      reason: `Storm detected ("${condition}") — using dramatic_sky for high-impact visual.`,
      source: "weather",
    };
  }
  if (isSnow(cond)) {
    return {
      style: "minimal",
      label: "minimal_winter",
      reason: `Snow conditions — using minimal_winter for clean, cold-toned visual.`,
      source: "weather",
    };
  }
  if (isRain(cond)) {
    return {
      style: "cinematic",
      label: "moody_rain",
      reason: `Rain detected — using moody cinematic visual to match the mood.`,
      source: "weather",
    };
  }

  // ── 2. City relevance (when weather is mild/clear) ──────────────────────
  if (isClear(cond)) {
    if (cityName === "Gainesville") {
      return {
        style: "minimal",
        label: "local_landmark",
        reason: `Clear day in Gainesville — preferring local_landmark (UF-style visual).`,
        source: "city",
      };
    }
    if (cityName === "Orlando") {
      return {
        style: "sky",
        label: "bright_sky_skyline",
        reason: `Clear day in Orlando — preferring bright_sky / skyline visual.`,
        source: "city",
      };
    }
    if (cityName === "Miami") {
      return {
        style: "sky",
        label: "bright_sky_coast",
        reason: `Clear day in Miami — preferring bright coastal sky visual.`,
        source: "city",
      };
    }
    if (cityName === "Tampa") {
      return {
        style: "sky",
        label: "bright_sky_bay",
        reason: `Clear day in Tampa — preferring bright bayfront sky visual.`,
        source: "city",
      };
    }
    // Generic clear-day default before falling through to performance
    return {
      style: "sky",
      label: "bright_sky",
      reason: `Clear conditions — defaulting to bright_sky visual.`,
      source: "weather",
    };
  }

  // ── 3. Performance history fallback ─────────────────────────────────────
  const allowed = ["gradient", "sky", "cinematic", "minimal"];
  if (topStyle && allowed.includes(String(topStyle).toLowerCase())) {
    const t = String(topStyle).toLowerCase();
    return {
      style: t,
      label: `top_performer_${t}`,
      reason: `No strong weather/city signal for "${condition || "n/a"}" in ${cityName || "this city"} — falling back to top-performing style "${t}".`,
      source: "performance",
    };
  }

  // ── Final fallback ──────────────────────────────────────────────────────
  if (isCloudy(cond)) {
    return {
      style: "gradient",
      label: "soft_gradient",
      reason: `Cloudy/overcast conditions and no performance winner — using soft_gradient.`,
      source: "fallback",
    };
  }
  return {
    style: "sky",
    label: "default_sky",
    reason: `No specific signal — defaulting to sky.`,
    source: "fallback",
  };
}

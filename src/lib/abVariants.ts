/**
 * A/B variant generator for YouTube Shorts.
 *
 * One variable at a time — each test type mutates ONLY its allowed fields,
 * everything else must match the base preview. A guard rejects any payload
 * that mutates a locked field, protecting against multivariate drift.
 */

export type ExperimentType = "hook_test" | "cta_test" | "background_test";
export type RolloutMode = "manual_select_winner" | "auto_rotate_variants";

export interface VariantPayload {
  /** First line of script — used for hook_test only */
  hook_line?: string;
  /** First headline overlay — used for hook_test only */
  hook_headline?: string;
  /** Opening 0–2s emphasis preset — used for hook_test only */
  hook_emphasis?: "zoom_in" | "punch_in" | "slide_up" | "fade";

  /** End-card CTA text — used for cta_test only */
  cta_text?: string;
  /** Final voice line — used for cta_test only */
  cta_voice_line?: string;
  /** End-card animation preset — used for cta_test only */
  cta_animation?: "fade" | "slide" | "pop" | "subscribe_burst";

  /** Background style — used for background_test only */
  background_style?: "cinematic_sky" | "city_vibe" | "weather_driven" | "minimal_gradient";
  /** Motion treatment — used for background_test only */
  motion_treatment?: "ken_burns" | "parallax" | "static_with_particles" | "drift";
  /** Particle overlay — used for background_test only */
  particle_overlay?: "rain" | "snow" | "sun_dust" | "none";

  /** Human-readable summary shown in the badge */
  label?: string;
}

const HOOK_FIELDS = ["hook_line", "hook_headline", "hook_emphasis"] as const;
const CTA_FIELDS = ["cta_text", "cta_voice_line", "cta_animation"] as const;
const BG_FIELDS = ["background_style", "motion_treatment", "particle_overlay"] as const;

function allowedFields(type: ExperimentType): readonly string[] {
  if (type === "hook_test") return HOOK_FIELDS;
  if (type === "cta_test") return CTA_FIELDS;
  return BG_FIELDS;
}

/**
 * Validate a variant only mutates fields allowed for its experiment type.
 * Throws on violation — call before persisting an experiment row.
 */
export function assertVariantScope(type: ExperimentType, variant: VariantPayload): void {
  const allowed = new Set<string>([...allowedFields(type), "label"]);
  const offenders = Object.keys(variant).filter((k) => !allowed.has(k));
  if (offenders.length > 0) {
    throw new Error(
      `Variant for ${type} mutates locked fields: ${offenders.join(", ")}. ` +
      `Only ${[...allowed].join(", ")} may differ between variants.`,
    );
  }
}

export interface VariantPair {
  variantA: VariantPayload;
  variantB: VariantPayload;
}

/**
 * Build a deterministic variant pair for an experiment type.
 * Variant A always represents the "control" / current default;
 * Variant B is the challenger with one differing dimension.
 */
export function buildVariantPair(type: ExperimentType): VariantPair {
  if (type === "hook_test") {
    return {
      variantA: {
        hook_line: "Here's your forecast.",
        hook_headline: "Today's Weather",
        hook_emphasis: "fade",
        label: "Calm hook",
      },
      variantB: {
        hook_line: "Don't leave the house yet —",
        hook_headline: "Wait. Look outside.",
        hook_emphasis: "punch_in",
        label: "Pattern-interrupt hook",
      },
    };
  }
  if (type === "cta_test") {
    return {
      variantA: {
        cta_text: "Subscribe for daily forecasts",
        cta_voice_line: "Subscribe for daily weather updates.",
        cta_animation: "fade",
        label: "Soft CTA",
      },
      variantB: {
        cta_text: "Hit subscribe + 🔔 — don't miss tomorrow",
        cta_voice_line: "Hit subscribe and turn on notifications so you don't miss tomorrow's forecast.",
        cta_animation: "subscribe_burst",
        label: "Direct CTA",
      },
    };
  }
  // background_test
  return {
    variantA: {
      background_style: "minimal_gradient",
      motion_treatment: "static_with_particles",
      particle_overlay: "none",
      label: "Minimal gradient",
    },
    variantB: {
      background_style: "cinematic_sky",
      motion_treatment: "ken_burns",
      particle_overlay: "sun_dust",
      label: "Cinematic sky",
    },
  };
}

export const EXPERIMENT_TYPE_LABELS: Record<ExperimentType, string> = {
  hook_test: "Hook test",
  cta_test: "CTA test",
  background_test: "Background test",
};

export const EXPERIMENT_TYPE_DESCRIPTIONS: Record<ExperimentType, string> = {
  hook_test: "Tests only the first 1–2 seconds. Weather, CTA and background stay identical.",
  cta_test: "Tests only the end-card. Hook, forecast and background stay identical.",
  background_test: "Tests only the visual background + motion. Hook, forecast and CTA stay identical.",
};

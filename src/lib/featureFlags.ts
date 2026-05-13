/**
 * Feature flags — safe pipeline migration.
 *
 * Flip these to gradually roll out new pipeline-based behaviour without
 * breaking the existing manual posting path. All flags default to `false`
 * so production keeps using the legacy logic until each flag is opted in.
 *
 * Override at runtime via `localStorage.setItem("ff:<name>", "true"|"false")`
 * for quick QA without a redeploy.
 */

export type FeatureFlagName =
  | "USE_PIPELINE_FOR_MANUAL_POSTS"
  | "ENABLE_POST_HEALTH_SCORE"
  | "ENABLE_AB_TESTING";

const DEFAULTS: Record<FeatureFlagName, boolean> = {
  USE_PIPELINE_FOR_MANUAL_POSTS: false,
  ENABLE_POST_HEALTH_SCORE: false,
  ENABLE_AB_TESTING: false,
};

function readOverride(name: FeatureFlagName): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(`ff:${name}`);
    if (v === "true") return true;
    if (v === "false") return false;
  } catch {
    /* ignore */
  }
  return null;
}

export function isFeatureEnabled(name: FeatureFlagName): boolean {
  const override = readOverride(name);
  return override ?? DEFAULTS[name];
}

export const FeatureFlags = {
  get USE_PIPELINE_FOR_MANUAL_POSTS() {
    return isFeatureEnabled("USE_PIPELINE_FOR_MANUAL_POSTS");
  },
  get ENABLE_POST_HEALTH_SCORE() {
    return isFeatureEnabled("ENABLE_POST_HEALTH_SCORE");
  },
  get ENABLE_AB_TESTING() {
    return isFeatureEnabled("ENABLE_AB_TESTING");
  },
};

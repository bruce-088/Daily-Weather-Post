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
  | "ENABLE_AB_TESTING"
  | "SHOW_DEBUG_LABELS"
  | "ENABLE_CINEMATIC_MODE"
  | "ENABLE_DURABLE_PREVIEW_PIPELINE"
  | "ENABLE_CONTENT_SCORE"
  | "ENABLE_AUTO_WINNER";

const DEFAULTS: Record<FeatureFlagName, boolean> = {
  // Single source of truth: manual posts + preview always run through the
  // job pipeline (generate_content → generate_voice → render_video), the
  // same path auto-post uses. Disable via
  // localStorage.setItem("ff:USE_PIPELINE_FOR_MANUAL_POSTS","false") for QA.
  USE_PIPELINE_FOR_MANUAL_POSTS: true,
  ENABLE_POST_HEALTH_SCORE: false,
  ENABLE_AB_TESTING: false,
  // On by default for now (preview/admin mode). Disable via
  // localStorage.setItem("ff:SHOW_DEBUG_LABELS","false") to silence pills.
  SHOW_DEBUG_LABELS: true,
  ENABLE_CINEMATIC_MODE: false,
  // Durable Preview: route the Preview button through a real `jobs` row
  // (enqueue-preview-job) and poll status. Disable via
  // localStorage.setItem("ff:ENABLE_DURABLE_PREVIEW_PIPELINE","false") to
  // fall back to the legacy direct-invoke path for one release.
  ENABLE_DURABLE_PREVIEW_PIPELINE: true,
  // Auto-Winner: pre-post Content Score card (display only). Default ON.
  ENABLE_CONTENT_SCORE: true,
  // Auto-Winner: opt-in auto-apply toggles in Settings. Default OFF.
  ENABLE_AUTO_WINNER: false,
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
  get SHOW_DEBUG_LABELS() {
    return isFeatureEnabled("SHOW_DEBUG_LABELS");
  },
  get ENABLE_CINEMATIC_MODE() {
    return isFeatureEnabled("ENABLE_CINEMATIC_MODE");
  },
  get ENABLE_DURABLE_PREVIEW_PIPELINE() {
    return isFeatureEnabled("ENABLE_DURABLE_PREVIEW_PIPELINE");
  },
};

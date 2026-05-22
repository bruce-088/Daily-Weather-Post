// Visual Style Rotation Guard
//
// Rule: track the visual_style of the last 5 posts. If the same style was used
// more than 3 times in that window, force an alternate style from the pool.
// Goal: maintain visual freshness and avoid repetition fatigue.
//
// Public-facing pool labels (used in logs / debug_trace) are mapped to the
// internal canonical visual_style values used by the renderer.

export const STYLE_POOL = [
  "sky_realistic",
  "gradient_clean",
  "local_landmark",
  "cinematic_weather",
] as const;

export type PoolStyle = typeof STYLE_POOL[number];

// Map pool labels ↔ canonical internal styles consumed by the video renderer
// (gradient | sky | cinematic | minimal).
export const POOL_TO_CANONICAL: Record<PoolStyle, string> = {
  sky_realistic: "sky",
  gradient_clean: "gradient",
  local_landmark: "minimal",
  cinematic_weather: "cinematic",
};

export const CANONICAL_TO_POOL: Record<string, PoolStyle> = {
  sky: "sky_realistic",
  gradient: "gradient_clean",
  minimal: "local_landmark",
  cinematic: "cinematic_weather",
};

const ROTATION_WINDOW = 5;
const REPETITION_THRESHOLD = 3; // > 3 → force alternate

import { isLearningEligibleRow } from "./cinematic-presets.ts";

/** Fetch visual_style from the last N posted entries for a user. */
export async function getRecentStyles(
  supabase: any,
  userId: string,
  limit = ROTATION_WINDOW,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("post_history")
      .select("visual_metadata, published_visual_source, created_at")
      .eq("user_id", userId)
      .eq("status", "posted")
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    if (error) return [];
    // Firewall: don't let fallback renders shape future rotation choices.
    return (data || [])
      .filter((r: any) => isLearningEligibleRow(r, null))
      .map((r: any) => String(r.visual_metadata?.visual_style || "").toLowerCase())
      .filter(Boolean)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export interface RotationDecision {
  style: string;             // canonical style to actually render
  forced: boolean;           // true if rotation guard overrode preferred
  preferred: string;         // what the upstream layer wanted
  reason: string;            // human-readable explanation
  recent: string[];          // last-N styles considered
  pool_label: PoolStyle | null;
}

/**
 * Decide which canonical visual_style to use given a preferred style and the
 * recent style history. If `preferred` was used > REPETITION_THRESHOLD times in
 * the last ROTATION_WINDOW posts, swap to an alternate from the pool.
 */
export function enforceStyleRotation(
  preferred: string,
  recent: string[],
): RotationDecision {
  const pref = String(preferred || "sky").toLowerCase();
  const window = recent.slice(0, ROTATION_WINDOW);
  const count = window.filter((s) => s === pref).length;

  if (count <= REPETITION_THRESHOLD) {
    return {
      style: pref,
      forced: false,
      preferred: pref,
      reason: `Style "${pref}" used ${count}/${window.length} recently — within fresh limit.`,
      recent: window,
      pool_label: CANONICAL_TO_POOL[pref] ?? null,
    };
  }

  // Forced rotation: pick the canonical style with the fewest recent uses,
  // breaking ties by pool order so we cycle predictably.
  const canonicals = STYLE_POOL.map((p) => POOL_TO_CANONICAL[p]);
  const usage = new Map<string, number>();
  for (const c of canonicals) usage.set(c, 0);
  for (const s of window) {
    if (usage.has(s)) usage.set(s, (usage.get(s) || 0) + 1);
  }
  let chosen = canonicals[0];
  let chosenCount = Infinity;
  for (const c of canonicals) {
    if (c === pref) continue; // never pick the over-used one
    const u = usage.get(c) ?? 0;
    if (u < chosenCount) { chosen = c; chosenCount = u; }
  }

  return {
    style: chosen,
    forced: true,
    preferred: pref,
    reason: `Rotation guard: "${pref}" was used ${count}/${window.length} recent posts (>${REPETITION_THRESHOLD}). Forcing alternate "${chosen}" for visual freshness.`,
    recent: window,
    pool_label: CANONICAL_TO_POOL[chosen] ?? null,
  };
}

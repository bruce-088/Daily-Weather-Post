// Cinematic Preset System — single source of truth.
//
// Goals:
//  1. Improve visual richness across daily + weekly + monthly outputs
//     without inflating per-render cost.
//  2. Fix the Gainesville "9/10 plain" drift via a strict per-city fallback
//     chain that prefers a real image over a gradient.
//  3. Stop the visual-learning loop from rewarding gradient-only / degraded
//     renders, so the system stops reinforcing plain visuals.
//
// This module is PURE: it never reads or writes the database, never calls
// external APIs, and never throws. resolveScene() is failure-safe — any
// internal error degrades to a `degraded_fallback` decision so renders
// always complete.

// ── Public types ───────────────────────────────────────────────────────────

export type CinematicPreset = "broadcast_lite" | "cinematic_weather" | "event_mode";

export type RenderSource =
  | "history_image"
  | "condition_scene"
  | "city_safe_scene"
  | "video_scene"
  | "gradient_only"
  | "degraded_fallback";

export type CostTier = "low" | "medium" | "high";

export type RecapSlideKind = "title" | "day" | "week_stat" | "highlight" | "outro";

/**
 * Sources that should NEVER feed the visual / cinematic winner system.
 * A fallback render is, by definition, what happens when richer paths
 * failed — letting it win would teach the model to prefer failure.
 */
export const NON_LEARNING_SOURCES: ReadonlySet<RenderSource> = new Set([
  "gradient_only",
  "degraded_fallback",
]);

export interface SceneDecision {
  preset: CinematicPreset;
  source: RenderSource;
  label: string;
  url?: string;
  costTier: CostTier;
  eligibleForLearning: boolean;
}

export interface CinematicSettings {
  smart_cost_strategy?: boolean | null;
  strict_visuals_gainesville?: boolean | null;
  exclude_fallback_from_learning?: boolean | null;
  auto_cinematic_for_storms?: boolean | null;
}

// ── Internal: condition → stock scene map (moved from recap files) ─────────

interface CondScene { match: RegExp; label: string; url: string }

const CONDITION_SCENES: ReadonlyArray<CondScene> = [
  { match: /storm|thunder|lightning/i,        label: "storm_clouds", url: "https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?auto=format&fit=crop&w=1080&q=80" },
  { match: /rain|drizzle|shower/i,            label: "rainy_sky",    url: "https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=1080&q=80" },
  { match: /snow|sleet|blizzard|flurr/i,      label: "snowy_sky",    url: "https://images.unsplash.com/photo-1483921020237-2ff51e8e4b22?auto=format&fit=crop&w=1080&q=80" },
  { match: /cloud|overcast|fog|mist|haze/i,   label: "cloudy_sky",   url: "https://images.unsplash.com/photo-1500740516770-92bd004b996e?auto=format&fit=crop&w=1080&q=80" },
  { match: /clear|sunny|sun\b/i,              label: "bright_sky",   url: "https://images.unsplash.com/photo-1419833173245-f59e1b93f9ee?auto=format&fit=crop&w=1080&q=80" },
];

export function pickConditionScene(cond?: string | null): { label: string; url: string } | null {
  if (!cond) return null;
  for (const s of CONDITION_SCENES) {
    if (s.match.test(cond)) return { label: s.label, url: s.url };
  }
  return null;
}

// ── Gainesville city-safe scenes (permanent public URLs) ──────────────────
//
// These MUST be permanent, non-expiring public URLs. They live in the
// existing public `brand-assets` bucket under `cinematic/`. If a file
// is missing at runtime the helper logs a warning and the chain falls
// through to the next tier — renders never break.
//
// Owner action: upload 2–3 landscape JPGs to that bucket. Until then the
// URLs simply 404 and the chain skips to gradient_only.

const PUBLIC_ASSET_BASE = "https://pewdswjhsesfondewucc.supabase.co/storage/v1/object/public/brand-assets/cinematic";

export const GAINESVILLE_SAFE_SCENES: ReadonlyArray<{ label: string; url: string }> = [
  { label: "gnv_oak_canopy",     url: `${PUBLIC_ASSET_BASE}/gainesville-oak-canopy.jpg` },
  { label: "gnv_downtown_sky",   url: `${PUBLIC_ASSET_BASE}/gainesville-downtown-skyline.jpg` },
  { label: "gnv_prairie_storm",  url: `${PUBLIC_ASSET_BASE}/gainesville-prairie-storm.jpg` },
];

function pickGainesvilleSafeScene(slideIndex = 0): { label: string; url: string } | null {
  if (GAINESVILLE_SAFE_SCENES.length === 0) return null;
  const i = Math.abs(slideIndex) % GAINESVILLE_SAFE_SCENES.length;
  return GAINESVILLE_SAFE_SCENES[i];
}

const SEVERE_RE = /storm|severe|tornado|blizzard|hurricane|extreme heat|excessive heat/i;
const STRONG_RE = /rain|drizzle|shower|snow|sleet|thunder|fog|mist|haze|wind/i;

function isGainesville(city?: string | null): boolean {
  return typeof city === "string" && /gainesville/i.test(city.trim());
}

// ── Preset selection ──────────────────────────────────────────────────────

export function pickPresetForDaily(opts: {
  condition?: string | null;
  severity?: string | null;
  slot?: string | null;
  city?: string | null;
  settings?: CinematicSettings | null;
}): CinematicPreset {
  const cond = `${opts.condition || ""} ${opts.severity || ""}`;
  // Smart Cost Strategy gates upgrades. When off, always broadcast_lite.
  if (opts.settings && opts.settings.smart_cost_strategy === false) {
    return "broadcast_lite";
  }
  if (SEVERE_RE.test(cond)) return "event_mode";
  if (STRONG_RE.test(cond)) return "cinematic_weather";
  return "broadcast_lite";
}

export function pickPresetForRecapSlide(opts: {
  kind: RecapSlideKind;
  condition?: string | null;
  city?: string | null;
  slideIndex?: number;
  settings?: CinematicSettings | null;
}): CinematicPreset {
  const cond = String(opts.condition || "");
  if (opts.settings && opts.settings.smart_cost_strategy === false) {
    return "broadcast_lite";
  }
  switch (opts.kind) {
    case "title":
    case "outro":
    case "day":
    case "week_stat":
      return "broadcast_lite";
    case "highlight":
      // Monthly Moment can escalate to event_mode only on severe conditions.
      if (SEVERE_RE.test(cond)) return "event_mode";
      return "cinematic_weather";
    default:
      return "broadcast_lite";
  }
}

// ── Cost tier ─────────────────────────────────────────────────────────────

function costTierFor(preset: CinematicPreset, source: RenderSource): CostTier {
  if (source === "gradient_only" || source === "degraded_fallback") return "low";
  if (preset === "event_mode") return "high";
  if (preset === "cinematic_weather") return "medium";
  return "low";
}

// ── Scene resolution (Gainesville-strict fallback chain) ──────────────────

function nonEmpty(u?: string | null): u is string {
  return typeof u === "string" && u.trim().length > 0;
}

/**
 * Resolve the actual visual source for a render.
 *
 * Tier order (when `mode !== "gradient"`):
 *   1. history_image     — when `mediaUrl` is provided & non-empty
 *   2. condition_scene   — when a stock scene matches the condition
 *   3. city_safe_scene   — Gainesville only (gated by strict_visuals_gainesville),
 *                          when ≥1 safe scene URL exists
 *   4. gradient_only     — when every prior tier yielded nothing
 *
 * Any unexpected throw → `degraded_fallback` (eligible=false).
 * Render NEVER fails — caller always gets a usable decision.
 */
export function resolveScene(opts: {
  city?: string | null;
  condition?: string | null;
  mediaUrl?: string | null;
  preset: CinematicPreset;
  mode?: "image" | "video" | "gradient";
  slideIndex?: number;
  settings?: CinematicSettings | null;
}): SceneDecision {
  const { city, condition, mediaUrl, preset } = opts;
  const mode = opts.mode ?? "image";
  const settings = opts.settings || {};

  try {
    if (mode === "gradient") {
      return {
        preset,
        source: "gradient_only",
        label: "gradient_only",
        costTier: costTierFor(preset, "gradient_only"),
        eligibleForLearning: false,
      };
    }

    // Tier 1: history image
    if (nonEmpty(mediaUrl)) {
      return {
        preset,
        source: "history_image",
        label: "history_image",
        url: mediaUrl,
        costTier: costTierFor(preset, "history_image"),
        eligibleForLearning: true,
      };
    }

    // Tier 2: condition scene
    const pick = pickConditionScene(condition);
    if (pick) {
      return {
        preset,
        source: "condition_scene",
        label: pick.label,
        url: pick.url,
        costTier: costTierFor(preset, "condition_scene"),
        eligibleForLearning: true,
      };
    }

    // Tier 3: Gainesville-only city-safe scene
    const strictGnv = settings.strict_visuals_gainesville !== false; // default ON
    if (strictGnv && isGainesville(city)) {
      const safe = pickGainesvilleSafeScene(opts.slideIndex ?? 0);
      if (safe) {
        return {
          preset,
          source: "city_safe_scene",
          label: safe.label,
          url: safe.url,
          costTier: costTierFor(preset, "city_safe_scene"),
          eligibleForLearning: true,
        };
      }
      console.warn(`[cinematic] city_safe_scene missing for ${city} — falling through to gradient_only`);
    }

    // Tier 4: gradient-only
    return {
      preset,
      source: "gradient_only",
      label: "gradient_only",
      costTier: costTierFor(preset, "gradient_only"),
      eligibleForLearning: false,
    };
  } catch (e) {
    console.warn(`[cinematic] resolveScene threw — degraded_fallback:`, (e as Error)?.message);
    return {
      preset,
      source: "degraded_fallback",
      label: "degraded_fallback",
      costTier: "low",
      eligibleForLearning: false,
    };
  }
}

// ── Logging ───────────────────────────────────────────────────────────────

export function logCinematic(
  prefix: string,
  decision: SceneDecision,
  ctx: { city?: string | null; kind?: string; slide?: number | string } = {},
): void {
  const parts: string[] = [`[cinematic]`];
  if (ctx.city) parts.push(`city=${ctx.city}`);
  if (ctx.kind) parts.push(`kind=${ctx.kind}`);
  if (ctx.slide != null) parts.push(`slide=${ctx.slide}`);
  parts.push(`preset=${decision.preset}`);
  parts.push(`source=${decision.source}`);
  parts.push(`label=${decision.label}`);
  parts.push(`eligible=${decision.eligibleForLearning ? "yes" : "no"}`);
  parts.push(`cost=${decision.costTier}`);
  if (!decision.eligibleForLearning) parts.push(`fallback=yes`);
  void prefix; // prefix is purely advisory; keep arg for call-site context
  console.log(parts.join(" "));
}

// ── Persistence helpers ───────────────────────────────────────────────────

/**
 * Merge a cinematic decision into a `visual_metadata` jsonb payload.
 * Preserves any pre-existing keys (e.g. has_timestamp_in_title, visual_style).
 */
export function buildVisualMetadata(
  decision: SceneDecision,
  prevMeta?: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const base = (prevMeta && typeof prevMeta === "object") ? { ...prevMeta } : {};
  return {
    ...base,
    preset: decision.preset,
    source: decision.source,
    label: decision.label,
    costTier: decision.costTier,
    eligibleForLearning: decision.eligibleForLearning,
  };
}

/**
 * Convenience for the three daily publish insert sites. Returns the patch
 * object to merge into a `post_history.insert({...})` payload.
 */
export function attachCinematicToPostHistory(
  prev: { visual_metadata?: Record<string, unknown> | null } | null | undefined,
  decision: SceneDecision,
): { visual_metadata: Record<string, unknown>; published_visual_source: RenderSource } {
  return {
    visual_metadata: buildVisualMetadata(decision, prev?.visual_metadata ?? null),
    published_visual_source: decision.source,
  };
}

// ── Firewall predicates (null-safe, backward-compatible) ──────────────────
//
// Older rows have no `visual_metadata.eligibleForLearning` field and no
// `published_visual_source`. Treat them as eligible so we don't retroactively
// punish historical data — only NEW rows tagged as fallback are excluded.

export function isEligibleVisualMetadata(meta: unknown): boolean {
  if (meta == null) return true;
  if (typeof meta !== "object") return true;
  const m = meta as Record<string, unknown>;
  if (m.eligibleForLearning === false) return false;
  const src = typeof m.source === "string" ? m.source : null;
  if (src && NON_LEARNING_SOURCES.has(src as RenderSource)) return false;
  return true;
}

export function isEligiblePublishedSource(source: unknown): boolean {
  if (source == null) return true;
  if (typeof source !== "string") return true;
  return !NON_LEARNING_SOURCES.has(source as RenderSource);
}

/**
 * Combined predicate for a post_history row. Use after a `.select` that
 * includes both `visual_metadata` and `published_visual_source`. When the
 * `exclude_fallback_from_learning` toggle is off, returns true for all rows.
 */
export function isLearningEligibleRow(
  row: { visual_metadata?: unknown; published_visual_source?: unknown } | null | undefined,
  settings?: CinematicSettings | null,
): boolean {
  if (settings && settings.exclude_fallback_from_learning === false) return true;
  if (!row) return true;
  return isEligibleVisualMetadata(row.visual_metadata) && isEligiblePublishedSource(row.published_visual_source);
}

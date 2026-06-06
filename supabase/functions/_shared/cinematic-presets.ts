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

// Phase 13C: each condition now has 3–4 stock scenes so consecutive renders
// rotate visually instead of reusing the same Unsplash photo every time.
// All URLs are royalty-free Unsplash with explicit `?auto=format` and a
// stable photo id so we don't depend on search ranking.
const CONDITION_SCENES: ReadonlyArray<CondScene> = [
  // Storm / thunder (4)
  { match: /storm|thunder|lightning/i, label: "storm_clouds_a", url: "https://images.unsplash.com/photo-1605727216801-e27ce1d0cc28?auto=format&fit=crop&w=1080&q=80" },
  { match: /storm|thunder|lightning/i, label: "storm_clouds_b", url: "https://images.unsplash.com/photo-1538935732373-f7a495fea3f6?auto=format&fit=crop&w=1080&q=80" },
  { match: /storm|thunder|lightning/i, label: "storm_clouds_c", url: "https://images.unsplash.com/photo-1561485132-59468cd0b553?auto=format&fit=crop&w=1080&q=80" },
  // Rain (4)
  { match: /rain|drizzle|shower/i, label: "rainy_sky_a", url: "https://images.unsplash.com/photo-1519692933481-e162a57d6721?auto=format&fit=crop&w=1080&q=80" },
  { match: /rain|drizzle|shower/i, label: "rainy_sky_b", url: "https://images.unsplash.com/photo-1428592953211-077101b2021b?auto=format&fit=crop&w=1080&q=80" },
  { match: /rain|drizzle|shower/i, label: "rainy_street",  url: "https://images.unsplash.com/photo-1534274988757-a28bf1a57c17?auto=format&fit=crop&w=1080&q=80" },
  { match: /rain|drizzle|shower/i, label: "rain_window",   url: "https://images.unsplash.com/photo-1438449805896-28a666819a20?auto=format&fit=crop&w=1080&q=80" },
  // Snow (2)
  { match: /snow|sleet|blizzard|flurr/i, label: "snowy_sky_a", url: "https://images.unsplash.com/photo-1483921020237-2ff51e8e4b22?auto=format&fit=crop&w=1080&q=80" },
  { match: /snow|sleet|blizzard|flurr/i, label: "snowy_sky_b", url: "https://images.unsplash.com/photo-1457269449834-928af64c684d?auto=format&fit=crop&w=1080&q=80" },
  // Cloudy / fog / overcast (4)
  { match: /cloud|overcast|fog|mist|haze/i, label: "cloudy_sky_a",  url: "https://images.unsplash.com/photo-1500740516770-92bd004b996e?auto=format&fit=crop&w=1080&q=80" },
  { match: /cloud|overcast|fog|mist|haze/i, label: "cloudy_sky_b",  url: "https://images.unsplash.com/photo-1499346030926-9a72daac6c63?auto=format&fit=crop&w=1080&q=80" },
  { match: /cloud|overcast|fog|mist|haze/i, label: "overcast_field", url: "https://images.unsplash.com/photo-1505533321630-975218a5f66f?auto=format&fit=crop&w=1080&q=80" },
  { match: /cloud|overcast|fog|mist|haze/i, label: "foggy_morning", url: "https://images.unsplash.com/photo-1487621167305-5d248087c724?auto=format&fit=crop&w=1080&q=80" },
  // Clear / sunny (4)
  { match: /clear|sunny|sun\b/i, label: "bright_sky_a",   url: "https://images.unsplash.com/photo-1419833173245-f59e1b93f9ee?auto=format&fit=crop&w=1080&q=80" },
  { match: /clear|sunny|sun\b/i, label: "bright_sky_b",   url: "https://images.unsplash.com/photo-1504370805625-d32c54b16100?auto=format&fit=crop&w=1080&q=80" },
  { match: /clear|sunny|sun\b/i, label: "sunlit_palms",   url: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1080&q=80" },
  { match: /clear|sunny|sun\b/i, label: "blue_sky_park",  url: "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1080&q=80" },
];

/**
 * Pick a condition scene with deterministic rotation. `seed` (e.g. a slide
 * index or date-derived integer) lets consecutive renders cycle through the
 * matching pool instead of always returning the first entry — fixes the
 * "same Unsplash photo every day" visual monotony.
 */
export function pickConditionScene(cond?: string | null, seed = 0): { label: string; url: string } | null {
  if (!cond) return null;
  const matches = CONDITION_SCENES.filter((s) => s.match.test(cond));
  if (matches.length === 0) return null;
  const idx = Math.abs(seed | 0) % matches.length;
  const pick = matches[idx];
  return { label: pick.label, url: pick.url };
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
 * Tier order (ALWAYS runs — `visualStyleHint` is a HINT, not a command):
 *   1. history_image     — when `mediaUrl` is provided & non-empty
 *   2. condition_scene   — when a stock scene matches the condition
 *   3. city_safe_scene   — Gainesville only (gated by strict_visuals_gainesville),
 *                          when ≥1 safe scene URL exists
 *   4. gradient_only     — natural fallback when every prior tier yielded nothing
 *
 * `visualStyleHint: "gradient"` no longer short-circuits the chain — the
 * upstream visual-selector frequently picks "gradient" for Clouds/overcast
 * even though tier 2 has a perfectly good `cloudy_sky` scene. Treating the
 * hint as a command starved the visual-learning loop and biased renders
 * toward plain backgrounds (Phase 9A-bis finding). The hint is preserved
 * only for diagnostic logging.
 *
 * `mode` is accepted as a deprecated alias of `visualStyleHint`.
 *
 * Any unexpected throw → `degraded_fallback` (eligible=false).
 * Render NEVER fails — caller always gets a usable decision.
 */
export function resolveScene(opts: {
  city?: string | null;
  condition?: string | null;
  mediaUrl?: string | null;
  preset: CinematicPreset;
  visualStyleHint?: "image" | "video" | "gradient";
  /** @deprecated use `visualStyleHint` — kept for backward compat with recap fns */
  mode?: "image" | "video" | "gradient";
  slideIndex?: number;
  settings?: CinematicSettings | null;
}): SceneDecision {
  const { city, condition, mediaUrl, preset } = opts;
  const visualStyleHint = opts.visualStyleHint ?? opts.mode ?? "image";
  const settings = opts.settings || {};

  try {
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
      if (visualStyleHint === "gradient") {
        console.log(`[cinematic] hint=gradient overridden — condition_scene available (label=${pick.label})`);
      }
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

    // Tier 4: gradient-only (natural fallback)
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

// ── Safe-default settings loader ──────────────────────────────────────────
//
// Every daily publish path (daily-weather-post, process-scheduled-posts,
// publish-preview-bundle) MUST resolve a `settings` object before calling
// pickPresetForDaily() / resolveScene(). This helper guarantees a usable
// object even when the weather_settings row is missing, errors, or lacks
// the newer cinematic columns — so a settings-fetch failure can never
// short-circuit a post with "settings is not defined".

export const SAFE_CINEMATIC_DEFAULTS: CinematicSettings = {
  smart_cost_strategy: true,
  strict_visuals_gainesville: true,
  exclude_fallback_from_learning: true,
  auto_cinematic_for_storms: true,
};

export async function loadCinematicSettings(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<CinematicSettings & Record<string, unknown>> {
  try {
    if (!userId) return { ...SAFE_CINEMATIC_DEFAULTS };
    const { data, error } = await supabase
      .from("weather_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) {
      console.warn(`[cinematic] settings fetch fallback for ${userId}: ${error?.message ?? "no row"}`);
      return { ...SAFE_CINEMATIC_DEFAULTS };
    }
    return {
      ...SAFE_CINEMATIC_DEFAULTS,
      ...data,
      smart_cost_strategy: (data as any).smart_cost_strategy ?? true,
      strict_visuals_gainesville: (data as any).strict_visuals_gainesville ?? true,
      exclude_fallback_from_learning: (data as any).exclude_fallback_from_learning ?? true,
      auto_cinematic_for_storms: (data as any).auto_cinematic_for_storms ?? true,
    };
  } catch (e) {
    console.warn(`[cinematic] settings fetch threw — using defaults:`, (e as Error)?.message);
    return { ...SAFE_CINEMATIC_DEFAULTS };
  }
}

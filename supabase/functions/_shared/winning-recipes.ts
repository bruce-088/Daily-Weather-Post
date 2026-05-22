// Predictive Creative Engine — getWinningStyleForCondition()
//
// Returns a "Winning Recipe" (visual_style + voice_tone + hook_type) for a
// given (condition, city) by combining:
//   1. Per-city historical winners (post_history filtered by condition + city)
//   2. Cross-city winners (post_history filtered by condition only) — fallback
//   3. ai_memory winners for voice/tone/hook
//   4. City "tilts" — initial creative bias when no data exists yet
//
// City Tilts (overridable by A/B engine as data accumulates):
//   • Orlando     → cinematic + energetic + question  (High-Energy / Vibrant)
//   • Gainesville → sky       + calm      + statement (Calm / Informative)

import { VISUAL_STYLES } from "./experiments.ts";
import { isLearningEligibleRow, type CinematicSettings } from "./cinematic-presets.ts";

export interface WinningRecipe {
  visual_style: string;       // gradient | sky | cinematic | minimal
  voice_tone: string;         // calm | energetic | urgent
  hook_type: string;          // statement | question
  source: "city" | "global" | "tilt";
  delta_pct: number;          // winner vs overall avg
  reason: string;             // human-readable directive
  condition: string | null;
  city: string | null;
  sample_size: number;
}

const CITY_TILTS: Record<string, { visual_style: string; voice_tone: string; hook_type: string; label: string }> = {
  Orlando:     { visual_style: "cinematic", voice_tone: "energetic", hook_type: "question",  label: "High-Energy / Vibrant" },
  Gainesville: { visual_style: "sky",       voice_tone: "calm",      hook_type: "statement", label: "Calm / Informative" },
};

function tiltFor(city: string | null) {
  if (!city) return null;
  return CITY_TILTS[city] || null;
}

/** Public: pick the best creative recipe for a (condition, city). */
export async function getWinningStyleForCondition(
  supabase: any,
  userId: string,
  condition: string | null,
  city: string | null,
): Promise<WinningRecipe> {
  const cond = (condition || "").toLowerCase().split(/[,;]/)[0]?.trim() || "";
  const tilt = tiltFor(city);

  const baseRecipe: WinningRecipe = {
    visual_style: tilt?.visual_style || "sky",
    voice_tone:   tilt?.voice_tone   || "calm",
    hook_type:    tilt?.hook_type    || "statement",
    source: "tilt",
    delta_pct: 0,
    reason: tilt
      ? `${city} default tilt: ${tilt.label} — not enough learned data yet for ${cond || "this condition"}.`
      : `Default recipe — system is still learning. Will tilt once more posts are collected.`,
    condition: cond || null,
    city,
    sample_size: 0,
  };

  // ----- Helper: pull top posts from post_history -----
  async function topPosts(filterCity: boolean) {
    let q = supabase
      .from("post_history")
      .select("views_count, visual_metadata, condition, city")
      .eq("user_id", userId)
      .eq("status", "posted")
      .gt("views_count", 0)
      .order("views_count", { ascending: false })
      .limit(40);
    if (cond) q = q.ilike("condition", `%${cond}%`);
    if (filterCity && city) q = q.ilike("city", city);
    const { data, error } = await q;
    if (error) return [];
    return (data || []) as any[];
  }

  let posts: any[] = city ? await topPosts(true) : [];
  let source: "city" | "global" | "tilt" = "city";

  if (posts.length < 3) {
    const fallback = await topPosts(false);
    if (fallback.length >= 3) {
      posts = fallback;
      source = "global";
    } else {
      // Not enough data anywhere — also try ai_memory voice/hook to enrich tilt
      await enrichFromMemory(supabase, userId, baseRecipe);
      return baseRecipe;
    }
  }

  // ----- Aggregate visual_style winners -----
  const buckets = new Map<string, number[]>();
  const allViews: number[] = [];
  for (const p of posts) {
    const s = String(p.visual_metadata?.visual_style || "").toLowerCase();
    const v = Number(p.views_count || 0);
    allViews.push(v);
    if (!s || !VISUAL_STYLES.includes(s)) continue;
    if (!buckets.has(s)) buckets.set(s, []);
    buckets.get(s)!.push(v);
  }
  const overall = allViews.reduce((a, b) => a + b, 0) / Math.max(allViews.length, 1);
  let bestStyle = baseRecipe.visual_style;
  let bestAvg = 0;
  for (const [s, vs] of buckets) {
    if (vs.length < 2) continue;
    const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
    if (avg > bestAvg) { bestAvg = avg; bestStyle = s; }
  }
  const deltaPct = overall > 0 && bestAvg > 0 ? Math.round(((bestAvg - overall) / overall) * 100) : 0;

  const recipe: WinningRecipe = { ...baseRecipe, visual_style: bestStyle, source, delta_pct: deltaPct, sample_size: posts.length };
  await enrichFromMemory(supabase, userId, recipe);

  const cityTag = source === "global" ? " (cross-city learning — Shared)" : ` in ${city || "this city"}`;
  const condTag = cond ? `${cond} forecasts` : "this forecast";
  recipe.reason = deltaPct > 0
    ? `For ${condTag}, "${recipe.visual_style}" visuals + "${recipe.voice_tone}" tone have historically performed +${deltaPct}% better${cityTag}.`
    : `Best-performing recipe so far for ${condTag}${cityTag}: "${recipe.visual_style}" + "${recipe.voice_tone}".`;
  return recipe;
}

async function enrichFromMemory(supabase: any, userId: string, recipe: WinningRecipe) {
  try {
    const { data: voice } = await supabase
      .from("ai_memory")
      .select("content")
      .eq("user_id", userId)
      .eq("memory_type", "voice")
      .order("performance_score", { ascending: false })
      .limit(1);
    const v = String(voice?.[0]?.content || "").toLowerCase();
    if (["calm", "energetic", "urgent"].includes(v)) recipe.voice_tone = v;
  } catch {/* noop */}
  try {
    const { data: hook } = await supabase
      .from("ai_memory")
      .select("content")
      .eq("user_id", userId)
      .eq("memory_type", "hook")
      .order("performance_score", { ascending: false })
      .limit(1);
    const h = String(hook?.[0]?.content || "").toLowerCase();
    if (["statement", "question"].includes(h)) recipe.hook_type = h;
  } catch {/* noop */}
}

/** Format a recipe as a Gemini-prompt directive line. */
export function formatRecipeDirective(recipe: WinningRecipe): string {
  return `\n\nDIRECTIVE — DATA-BACKED CREATIVE: ${recipe.reason} ` +
    `Lean into a ${recipe.voice_tone.toUpperCase()} voice and a ${recipe.hook_type} opening hook. ` +
    `Visual rendering will use the "${recipe.visual_style}" style. Keep brand voice intact.`;
}

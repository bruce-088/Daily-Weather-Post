// A/B Experiment engine helpers.
//
// Pairs Control (A) with a Challenger (B) post that flips ONE variable.
// Used by auto-post-scheduler: after creating Post A, ~50% of the time
// we also schedule Post B 60 minutes later with one variable changed.

export type Variable = "hook" | "tone" | "visuals" | "voice" | "timing";
export type VariantLabel = "A" | "B";

export interface VariantMeta {
  hook?: string;            // "statement" | "question"
  tone?: string;            // mirrors normalizeTone() outputs
  visuals?: string;         // "gradient" | "stock-video"
  voice?: string;           // "calm" | "energetic" | "urgent"
  label?: string;           // human-readable summary
}

const TONES = ["professional", "warm", "playful", "warning"];
// Expanded visual styles for the AI Visual Optimization system.
// Each style is paired with a brightness/layout/motion profile via expandVisualMeta().
export const VISUAL_STYLES = ["gradient", "sky", "cinematic", "minimal"];
const HOOK_STYLES = ["statement", "question"];
const VOICE_STYLES = ["calm", "energetic", "urgent"];

export interface VisualMetadata {
  visual_style: string;          // gradient | sky | cinematic | minimal
  brightness_level: string;      // dark | medium | bright
  layout_type: string;           // centered | split | minimal
  motion_type: string;           // static | subtle_motion
}

/** Expand a visual_style string into its full metadata profile. */
export function expandVisualMeta(style: string): VisualMetadata {
  const s = (style || "sky").toLowerCase();
  if (s === "gradient") {
    return { visual_style: "gradient", brightness_level: "dark", layout_type: "centered", motion_type: "static" };
  }
  if (s === "cinematic") {
    return { visual_style: "cinematic", brightness_level: "medium", layout_type: "split", motion_type: "subtle_motion" };
  }
  if (s === "minimal") {
    return { visual_style: "minimal", brightness_level: "bright", layout_type: "minimal", motion_type: "static" };
  }
  // default: sky
  return { visual_style: "sky", brightness_level: "bright", layout_type: "centered", motion_type: "subtle_motion" };
}

export function buildControlVariant(opts: {
  tone?: string | null;
  hook?: string | null;
  visuals?: string | null;
}): VariantMeta {
  return {
    tone: opts.tone || "professional",
    hook: opts.hook || "statement",
    visuals: opts.visuals || "gradient",
    label: "Control",
  };
}

export function pickChallengerVariant(control: VariantMeta): { variable: Variable; meta: VariantMeta } {
  // Pick which single variable to flip. Voice is occasionally tested (~1 in 5
  // experiments) so existing hook/tone/visuals coverage isn't reduced too much.
  const pool: Variable[] = Math.random() < 0.2
    ? ["voice"]
    : ["hook", "tone", "visuals"];
  const variable = pool[Math.floor(Math.random() * pool.length)];
  const next: VariantMeta = { ...control, label: "Challenger" };

  if (variable === "hook") {
    const others = HOOK_STYLES.filter((h) => h !== control.hook);
    next.hook = others[Math.floor(Math.random() * others.length)];
  } else if (variable === "tone") {
    const others = TONES.filter((t) => t !== control.tone);
    next.tone = others[Math.floor(Math.random() * others.length)];
  } else if (variable === "visuals") {
    const others = VISUAL_STYLES.filter((v) => v !== control.visuals);
    next.visuals = others[Math.floor(Math.random() * others.length)];
  } else {
    // voice — flip the style; everything else identical.
    const controlVoice = control.voice || "calm";
    const others = VOICE_STYLES.filter((v) => v !== controlVoice);
    next.voice = others[Math.floor(Math.random() * others.length)];
  }

  return { variable, meta: next };
}

export async function shouldRunExperiment(supabase: any, userId: string): Promise<boolean> {
  // Don't pile on if user already has 2+ active experiments.
  const { count } = await supabase
    .from("experiments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "gathering_data");
  if ((count ?? 0) >= 2) return false;
  return Math.random() < 0.5;
}

export async function createExperimentRow(
  supabase: any,
  args: {
    userId: string;
    city: string | null;
    variable: Variable;
    variantA: VariantMeta;
    variantB: VariantMeta;
    testType?: "content" | "timing";
    offsetA?: number | null;
    offsetB?: number | null;
  },
): Promise<string | null> {
  const { data, error } = await supabase
    .from("experiments")
    .insert({
      user_id: args.userId,
      city: args.city,
      variable_tested: args.variable,
      variant_a_meta: args.variantA,
      variant_b_meta: args.variantB,
      status: "gathering_data",
      conclude_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      test_type: args.testType || "content",
      scheduled_time_offset_a: args.offsetA ?? null,
      scheduled_time_offset_b: args.offsetB ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[experiments] create failed:", error);
    return null;
  }
  return data?.id ?? null;
}

/** Decide whether to run a TIMING experiment for this slot (~25%). */
export async function shouldRunTimingExperiment(supabase: any, userId: string, city: string | null): Promise<boolean> {
  const { count } = await supabase
    .from("experiments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("test_type", "timing")
    .eq("status", "gathering_data");
  if ((count ?? 0) >= 1) return false;
  // Don't pile on if a recent timing test exists for this city in last 3 days.
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { count: recent } = await supabase
    .from("experiments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("test_type", "timing")
    .ilike("city", city || "")
    .gte("created_at", since);
  if ((recent ?? 0) >= 1) return false;
  return Math.random() < 0.25;
}

export function variantValue(variable: Variable, meta: VariantMeta): string {
  if (variable === "hook") return meta.hook || "";
  if (variable === "tone") return meta.tone || "";
  if (variable === "voice") return meta.voice || "";
  if (variable === "timing") return (meta as any).timing || "";
  return meta.visuals || "";
}

/**
 * Visual Optimization — return the top-performing visual_style for a user
 * based on past experiment winners stored in ai_memory.
 *
 * Guardrails (per spec):
 *   • performance_score (= win delta %) must be > 15
 *   • the winning post must have at least 100 views
 *
 * Returns null when no winner clears the bar — caller should fall back to
 * the user's existing default style.
 */
export async function getTopVisualStyle(
  supabase: any,
  userId: string,
): Promise<{ style: string; deltaPct: number; views: number } | null> {
  const { data, error } = await supabase
    .from("ai_memory")
    .select("content, performance_score, views, created_at")
    .eq("user_id", userId)
    .eq("memory_type", "visual")
    .gt("performance_score", 15)
    .gte("views", 100)
    .order("performance_score", { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const row: any = data[0];
  const style = String(row.content || "").trim().toLowerCase();
  if (!VISUAL_STYLES.includes(style)) return null;
  return { style, deltaPct: Number(row.performance_score) || 0, views: Number(row.views) || 0 };
}

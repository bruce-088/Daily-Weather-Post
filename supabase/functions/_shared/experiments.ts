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
const VISUAL_STYLES = ["gradient", "stock-video"];
const HOOK_STYLES = ["statement", "question"];
const VOICE_STYLES = ["calm", "energetic", "urgent"];

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
    })
    .select("id")
    .single();
  if (error) {
    console.error("[experiments] create failed:", error);
    return null;
  }
  return data?.id ?? null;
}

export function variantValue(variable: Variable, meta: VariantMeta): string {
  if (variable === "hook") return meta.hook || "";
  if (variable === "tone") return meta.tone || "";
  if (variable === "voice") return meta.voice || "";
  return meta.visuals || "";
}

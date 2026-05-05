// AI Voice Optimization helper.
//
// Reads ai_memory rows that captured a winning voice and returns the best
// performing voice for a given (condition, timeOfDay) bucket — but only if
// it clears a high-confidence bar:
//   - performance improvement > 10% (vs. baseline winners)
//   - cumulative views >= 100
//
// Safe-by-default: returns null when there isn't enough data, so callers
// can fall back to the user's configured default voice.

export interface BestVoice {
  voiceId: string;
  voiceStyle: string | null;
  avgScore: number;
  totalViews: number;
  sampleSize: number;
  liftPct: number;
}

const MIN_VIEWS = 100;
const MIN_LIFT_PCT = 10;

export async function getBestVoice(
  supabase: any,
  args: { userId: string; condition?: string | null; timeOfDay?: string | null },
): Promise<BestVoice | null> {
  let q = supabase
    .from("ai_memory")
    .select("voice_id, voice_style, performance_score, views, condition, time_of_day")
    .eq("user_id", args.userId)
    .not("voice_id", "is", null);

  if (args.condition) q = q.eq("condition", args.condition.toLowerCase());
  if (args.timeOfDay) q = q.eq("time_of_day", args.timeOfDay);

  const { data, error } = await q.limit(200);
  if (error || !data || data.length === 0) return null;

  // Group by voice_id
  const groups = new Map<string, { score: number; views: number; n: number; style: string | null }>();
  for (const r of data as any[]) {
    if (!r.voice_id) continue;
    const g = groups.get(r.voice_id) || { score: 0, views: 0, n: 0, style: r.voice_style };
    g.score += Number(r.performance_score) || 0;
    g.views += Number(r.views) || 0;
    g.n += 1;
    g.style = g.style || r.voice_style;
    groups.set(r.voice_id, g);
  }
  if (groups.size === 0) return null;

  const ranked = Array.from(groups.entries())
    .map(([voiceId, g]) => ({
      voiceId,
      voiceStyle: g.style,
      avgScore: g.n ? g.score / g.n : 0,
      totalViews: g.views,
      sampleSize: g.n,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  const top = ranked[0];
  if (!top) return null;

  // Confidence gates
  if (top.totalViews < MIN_VIEWS) return null;

  // Lift vs. next-best (or vs. zero baseline if only one voice tracked).
  const baseline = ranked[1]?.avgScore ?? 0;
  const denom = Math.max(Math.abs(baseline), 1e-6);
  const liftPct = baseline > 0 ? ((top.avgScore - baseline) / denom) * 100 : 100;
  if (liftPct < MIN_LIFT_PCT) return null;

  return { ...top, liftPct };
}

// Map an internal voice alias / style label to a canonical "voice_style" bucket.
export function classifyVoiceStyle(voiceId: string | null | undefined): "calm" | "energetic" | "urgent" | null {
  if (!voiceId) return null;
  const v = voiceId.toLowerCase();
  if (v.includes("calm") || v.includes("anchor") || v.includes("deep")) return "calm";
  if (v.includes("cheer") || v.includes("hype") || v.includes("energetic")) return "energetic";
  if (v.includes("urgent") || v.includes("warning")) return "urgent";
  // Sensible defaults for the "female"/"male" aliases used in the app.
  if (v === "female") return "calm";
  if (v === "male") return "energetic";
  return null;
}

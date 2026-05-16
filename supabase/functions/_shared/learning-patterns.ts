// Shared learning-patterns helper.
//
// Surfaces "what's working" for a given user from existing analytics tables
// (hook_stats + post_analytics) so the caption generator can FAVOR proven
// patterns and AVOID weak ones, with 70/30 exploit/explore.
//
// engagement_score = (likes*2 + comments*3) / max(views, 1)

export interface ConditionLift {
  condition: string;
  avgViews: number;
  engagementScore: number;
  deltaPct: number | null;
}

export interface HookPrefixStat {
  prefix: string;
  avgViews: number;
  uses: number;
}

export interface TopPatterns {
  topHooks: string[];
  avoidPhrases: string[];
  bestCondition: string | null;
  bestTimeOfDay: string | null;
  conditionLifts: ConditionLift[];
  hookPrefixes: HookPrefixStat[];
  baselineEngagement: number;
  sampleSize: number;
  provenWins?: Array<{ variable: string; value: string; wins: number; winRate: number }>;
  winningThemes?: Array<{ label: string; count: number }>;
  forbiddenOpeners?: string[];
  forbiddenThemes?: string[];
}

const THEME_TOKENS = [
  "beautiful day",
  "comfortable",
  "gorgeous",
  "perfect day",
  "lovely",
  "nice day",
];

function normalizeHook(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_AVOID = [
  "Weather Update",
  "Today's Forecast",
  "Daily Weather",
  "Weather Report",
  "Forecast for today",
];

export async function getTopPerformingPatterns(
  supabase: any,
  userId: string,
): Promise<TopPatterns> {
  const { data: hookRows } = await supabase
    .from("hook_stats")
    .select("hook_text, avg_views, uses")
    .eq("user_id", userId)
    .order("avg_views", { ascending: false })
    .limit(20);

  const hooks = (hookRows || []) as Array<{ hook_text: string; avg_views: number; uses: number }>;
  const topHooks = hooks
    .filter(h => h.uses >= 2 && h.avg_views > 0)
    .slice(0, 5)
    .map(h => h.hook_text);

  const worstHooks = [...hooks]
    .filter(h => h.uses >= 2)
    .sort((a, b) => a.avg_views - b.avg_views)
    .slice(0, 3)
    .map(h => h.hook_text);

  const prefixMap = new Map<string, { sum: number; n: number }>();
  for (const h of hooks) {
    if (!h.hook_text) continue;
    const words = h.hook_text.trim().split(/\s+/).slice(0, 2).join(" ");
    if (words.length < 3) continue;
    const cur = prefixMap.get(words) || { sum: 0, n: 0 };
    cur.sum += h.avg_views * Math.max(1, h.uses);
    cur.n += Math.max(1, h.uses);
    prefixMap.set(words, cur);
  }
  const hookPrefixes: HookPrefixStat[] = Array.from(prefixMap.entries())
    .filter(([, v]) => v.n >= 2)
    .map(([prefix, v]) => ({ prefix, avgViews: v.sum / v.n, uses: v.n }))
    .sort((a, b) => b.avgViews - a.avgViews)
    .slice(0, 5);

  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const { data: rows } = await supabase
    .from("post_analytics")
    .select("views, likes, comments, condition, time_of_day")
    .eq("user_id", userId)
    .gte("created_at", since);

  const analytics = (rows || []) as Array<{
    views: number; likes: number; comments: number;
    condition: string | null; time_of_day: string | null;
  }>;

  const condBuckets = new Map<string, { views: number; eng: number; n: number }>();
  const todBuckets = new Map<string, { views: number; eng: number; n: number }>();
  let totalEng = 0, totalN = 0;

  for (const r of analytics) {
    const v = Math.max(1, r.views || 0);
    const eScore = ((r.likes || 0) * 2 + (r.comments || 0) * 3) / v;
    totalEng += eScore; totalN += 1;
    if (r.condition) {
      const k = r.condition.toLowerCase();
      const b = condBuckets.get(k) || { views: 0, eng: 0, n: 0 };
      b.views += r.views || 0; b.eng += eScore; b.n += 1;
      condBuckets.set(k, b);
    }
    if (r.time_of_day) {
      const b = todBuckets.get(r.time_of_day) || { views: 0, eng: 0, n: 0 };
      b.views += r.views || 0; b.eng += eScore; b.n += 1;
      todBuckets.set(r.time_of_day, b);
    }
  }

  const baselineEngagement = totalN ? totalEng / totalN : 0;
  const conditionLifts: ConditionLift[] = Array.from(condBuckets.entries())
    .filter(([, b]) => b.n >= 2)
    .map(([condition, b]) => {
      const eng = b.eng / b.n;
      return {
        condition,
        avgViews: b.views / b.n,
        engagementScore: eng,
        deltaPct: baselineEngagement > 0 ? ((eng - baselineEngagement) / baselineEngagement) * 100 : null,
      };
    })
    .sort((a, b) => b.engagementScore - a.engagementScore);

  const bestCondition = conditionLifts[0]?.condition ?? null;

  const bestTodEntry = Array.from(todBuckets.entries())
    .map(([tod, b]) => ({ tod, score: b.n ? b.eng / b.n : 0, n: b.n }))
    .filter(t => t.n >= 2)
    .sort((a, b) => b.score - a.score)[0];
  const bestTimeOfDay = bestTodEntry?.tod ?? null;

  const avoidPhrases = Array.from(new Set([...GENERIC_AVOID, ...worstHooks]));

  // ── A/B EXPERIMENT WINNERS ──
  // Pull patterns that have won >=2 experiments with >=65% win rate.
  let provenWins: Array<{ variable: string; value: string; wins: number; winRate: number }> = [];
  try {
    const { data: wins } = await supabase
      .from("experiment_wins")
      .select("variable, winning_value, wins, losses, win_rate")
      .eq("user_id", userId)
      .gte("wins", 2)
      .gte("win_rate", 0.65)
      .order("wins", { ascending: false })
      .limit(5);
    provenWins = (wins || []).map((w: any) => ({
      variable: w.variable, value: w.winning_value, wins: w.wins, winRate: w.win_rate,
    }));
  } catch { /* ignore */ }

  // ── PROVEN WINNERS — themes from high performance_score posts (Phase 4) ──
  // Pull winning_factors from posts scoring ≥75 in the last 60 days, tally
  // the most common factor labels. Requires ≥5 high-scoring samples.
  let winningThemes: Array<{ label: string; count: number }> = [];
  try {
    const { data: hot } = await supabase
      .from("post_analytics")
      .select("winning_factors")
      .eq("user_id", userId)
      .gte("performance_score", 75)
      .gte("created_at", since)
      .limit(50);
    const hotRows = (hot || []) as Array<{ winning_factors: string[] | null }>;
    if (hotRows.length >= 5) {
      const counts = new Map<string, number>();
      for (const r of hotRows) {
        for (const f of (r.winning_factors || [])) {
          // Skip raw hook text — too noisy for prompt
          if (typeof f !== "string") continue;
          if (f.startsWith("hook:")) continue;
          counts.set(f, (counts.get(f) || 0) + 1);
        }
      }
      winningThemes = Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 4);
    }
  } catch { /* non-fatal */ }

  return {
    topHooks, avoidPhrases, bestCondition, bestTimeOfDay,
    conditionLifts, hookPrefixes, baselineEngagement, sampleSize: totalN,
    provenWins, winningThemes,
  } as TopPatterns;
}

/**
 * 70% exploit proven patterns, 30% exploration.
 */
export function buildLearningPromptBlock(p: TopPatterns): string {
  if (p.topHooks.length === 0 && p.conditionLifts.length === 0) return "";

  const explore = Math.random() < 0.3;
  const lines: string[] = ["", "PERFORMANCE LEARNING LOOP:"];

  if (explore) {
    lines.push("MODE: EXPLORATION — try a fresh angle today. Invent a new opener that still feels on-brand. Do NOT lean on the proven hook list verbatim.");
  } else {
    lines.push("MODE: EXPLOITATION — favor proven high-performing patterns.");
    if (p.topHooks.length > 0) {
      lines.push("Favor hooks similar to:");
      for (const h of p.topHooks) lines.push(`  - ${h}`);
    }
    if (p.hookPrefixes.length > 0) {
      const top = p.hookPrefixes[0];
      lines.push(`Hooks starting with "${top.prefix}" have been your strongest pattern.`);
    }
  }

  if (p.avoidPhrases.length > 0) {
    lines.push("");
    lines.push("Avoid generic or weak phrases like:");
    for (const a of p.avoidPhrases.slice(0, 6)) lines.push(`  - ${a}`);
  }

  const top = p.conditionLifts[0];
  if (p.bestCondition && top?.deltaPct && top.deltaPct > 5) {
    lines.push("");
    lines.push(`Note: your ${p.bestCondition} posts perform ~${Math.round(top.deltaPct)}% above your average — lean into vivid sensory detail when conditions match.`);
  }

  if (p.provenWins && p.provenWins.length > 0) {
    lines.push("");
    lines.push("PROVEN WINS (validated by past A/B tests — favor these):");
    for (const w of p.provenWins) {
      lines.push(`  - ${w.variable}="${w.value}" wins ${Math.round(w.winRate * 100)}% of tests (${w.wins}+ wins)`);
    }
  }

  if (p.winningThemes && p.winningThemes.length > 0) {
    lines.push("");
    lines.push("PROVEN WINNERS — your top-scoring posts share these traits (favor them, but vary opener and structure — do not copy verbatim):");
    for (const t of p.winningThemes) {
      lines.push(`  - ${t.label} (×${t.count})`);
    }
  }

  return lines.join("\n");
}

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
  recentlyUsedAllowed?: Array<{ hook: string; score: number; uses48h: number }>;
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
  opts?: { city?: string },
): Promise<TopPatterns> {
  const city = opts?.city?.trim() || null;

  // ── Creative Decay: gather recent (48h) city-specific posts ──
  let recentUseCount = new Map<string, number>();
  let last2Hooks: string[] = []; // normalized, most-recent-first, max 2
  let forbiddenOpeners: string[] = [];
  let forbiddenThemes: string[] = [];
  if (city) {
    try {
      const since48 = new Date(Date.now() - 48 * 3600_000).toISOString();
      const { data: recent } = await supabase
        .from("post_history")
        .select("hook_used, caption, created_at")
        .eq("user_id", userId)
        .eq("city", city)
        .gte("created_at", since48)
        .order("created_at", { ascending: false })
        .limit(20);
      const rows = (recent || []) as Array<{ hook_used: string | null; caption: string | null }>;

      const themeCounts = new Map<string, number>();
      for (const r of rows) {
        const hk = normalizeHook(r.hook_used || "");
        if (hk) {
          recentUseCount.set(hk, (recentUseCount.get(hk) || 0) + 1);
          if (last2Hooks.length < 2 && !last2Hooks.includes(hk)) {
            last2Hooks.push(hk);
          }
        }
        const blob = `${r.hook_used || ""} ${r.caption || ""}`.toLowerCase();
        for (const tok of THEME_TOKENS) {
          if (blob.includes(tok)) themeCounts.set(tok, (themeCounts.get(tok) || 0) + 1);
        }
      }
      // Forbidden openers narrowed to the last 2 city posts (verbatim text)
      forbiddenOpeners = rows
        .slice(0, 2)
        .map(r => r.hook_used || "")
        .filter(Boolean);
      forbiddenThemes = Array.from(themeCounts.entries())
        .filter(([, n]) => n >= 2)
        .map(([t]) => t);
    } catch (e) {
      console.warn("[learning-patterns] creative-decay lookup failed:", (e as Error).message);
    }
  }

  const { data: hookRows } = await supabase
    .from("hook_stats")
    .select("hook_text, avg_views, uses")
    .eq("user_id", userId)
    .order("avg_views", { ascending: false })
    .limit(20);

  const hooks = (hookRows || []) as Array<{ hook_text: string; avg_views: number; uses: number }>;

  // ── Strategic-reuse rescue: look up best performance_score per hook ──
  const since60 = new Date(Date.now() - 60 * 86400_000).toISOString();
  const bestScoreByHook = new Map<string, number>();
  try {
    const { data: scored } = await supabase
      .from("post_analytics")
      .select("hook_used, performance_score")
      .eq("user_id", userId)
      .gte("created_at", since60)
      .not("performance_score", "is", null);
    for (const r of (scored || []) as Array<{ hook_used: string | null; performance_score: number | null }>) {
      const k = normalizeHook(r.hook_used || "");
      if (!k) continue;
      const s = Number(r.performance_score || 0);
      if (s > (bestScoreByHook.get(k) || 0)) bestScoreByHook.set(k, s);
    }
  } catch { /* non-fatal */ }

  // Tiered weighted decay + rescue
  const recentlyUsedAllowed: Array<{ hook: string; score: number; uses48h: number }> = [];
  const weighted = hooks
    .filter(h => h.uses >= 2 && h.avg_views > 0)
    .map(h => {
      const nk = normalizeHook(h.hook_text);
      const overused = recentUseCount.get(nk) || 0;
      let weight = overused <= 1 ? 1.0 : overused === 2 ? 0.6 : 0.2;
      const bestScore = bestScoreByHook.get(nk) || 0;
      const inLast2 = last2Hooks.includes(nk);
      let rescued = false;
      if (overused >= 2 && bestScore >= 85 && !inLast2) {
        weight = 1.0;
        rescued = true;
        if (recentlyUsedAllowed.length < 3) {
          recentlyUsedAllowed.push({ hook: h.hook_text, score: bestScore, uses48h: overused });
        }
      }
      return { ...h, weightedViews: h.avg_views * weight, overused, rescued };
    })
    .sort((a, b) => b.weightedViews - a.weightedViews);

  const topHooks = weighted.slice(0, 5).map(h => h.hook_text);

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
    forbiddenOpeners, forbiddenThemes,
    recentlyUsedAllowed,
  } as TopPatterns;
}

/**
 * 70% exploit proven patterns, 30% exploration.
 */
export function buildLearningPromptBlock(p: TopPatterns): string {
  const hasForbidden = (p.forbiddenOpeners?.length ?? 0) > 0 || (p.forbiddenThemes?.length ?? 0) > 0;
  const hasAllowed = (p.recentlyUsedAllowed?.length ?? 0) > 0;
  if (p.topHooks.length === 0 && p.conditionLifts.length === 0 && !hasForbidden && !hasAllowed) return "";

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

  if (p.recentlyUsedAllowed && p.recentlyUsedAllowed.length > 0) {
    lines.push("");
    lines.push("RECENTLY USED BUT ALLOWED (proven winners — may be reused, but MUST be rephrased with a new opening structure and angle; do NOT copy verbatim):");
    for (const r of p.recentlyUsedAllowed) {
      lines.push(`  - "${r.hook}" (score ${Math.round(r.score)}, used ${r.uses48h}× in 48h)`);
    }
  }

  if (hasForbidden) {
    lines.push("");
    lines.push("FORBIDDEN REPETITIONS (used in the last 2 city posts — do NOT repeat verbatim or use as the opener):");
    for (const o of (p.forbiddenOpeners ?? [])) lines.push(`  - opener: "${o}"`);
    for (const t of (p.forbiddenThemes ?? [])) lines.push(`  - theme: "${t}"`);
  }

  return lines.join("\n");
}

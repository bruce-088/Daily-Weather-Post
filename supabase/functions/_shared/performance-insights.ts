// Phase 1 Growth Loop — performance feedback helpers.
// Reads recent post_performance rows for a (city, platform) and returns a
// compact, directional summary used to enrich title generation prompts.

export interface PerformanceInsights {
  city: string;
  platform: string;
  sampleSize: number;
  bestSlot: "morning" | "afternoon" | "evening" | null;
  bestTone: string | null;
  bestStyle: string | null;
  topTitles: string[];
  avgViewsBySlot: { morning: number; afternoon: number; evening: number };
}

export interface PerformanceMeta {
  postId?: string | null;
  city: string;
  platform: string;
  slot: "morning" | "afternoon" | "evening" | null;
  title: string;
  caption?: string | null;
  hookText?: string | null;
  tone?: string | null;
  style?: string | null;
  weatherCondition?: string | null;
  postedWithVoice?: boolean;
  publishedAt?: string;
  source?: "auto" | "manual" | "preview" | "system";
}

/** Insert (idempotent on post_id+platform) a post_performance row at publish-time. */
export async function recordPostPerformance(
  supabase: any,
  meta: PerformanceMeta,
): Promise<void> {
  try {
    const row = {
      post_id: meta.postId ?? null,
      city: meta.city,
      platform: meta.platform,
      slot: meta.slot ?? null,
      title: meta.title,
      caption: meta.caption ?? null,
      hook_text: meta.hookText ?? null,
      tone: meta.tone ?? null,
      style: meta.style ?? null,
      weather_condition: meta.weatherCondition ?? null,
      posted_with_voice: !!meta.postedWithVoice,
      published_at: meta.publishedAt ?? new Date().toISOString(),
      source: meta.source ?? "system",
    };

    if (meta.postId) {
      const { error } = await supabase
        .from("post_performance")
        .upsert(row, { onConflict: "post_id,platform", ignoreDuplicates: true });
      if (error) {
        console.warn(`[analytics] post_performance upsert failed for ${meta.city} ${meta.platform}:`, error.message);
        return;
      }
    } else {
      const { error } = await supabase.from("post_performance").insert(row);
      if (error) {
        console.warn(`[analytics] post_performance insert failed for ${meta.city} ${meta.platform}:`, error.message);
        return;
      }
    }
    console.log(`[analytics] inserted post_performance row for ${meta.city} ${meta.platform}`);
  } catch (e) {
    console.warn("[analytics] recordPostPerformance threw (non-fatal):", e instanceof Error ? e.message : e);
  }
}

/** Compute engagement_score from currently-known metrics. */
export function computeEngagementScore(opts: {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  ctr?: number | null;
}): number {
  const v = opts.views ?? 0;
  const l = opts.likes ?? 0;
  const c = opts.comments ?? 0;
  const ctrBoost = opts.ctr != null ? opts.ctr * 200 : 0;
  return v + l * 8 + c * 20 + ctrBoost;
}

/** Update post_performance metrics + engagement_score for a given post_id+platform. */
export async function updatePostPerformanceMetrics(
  supabase: any,
  opts: {
    postId: string;
    platform: string;
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    impressions?: number | null;
    ctr?: number | null;
  },
): Promise<void> {
  try {
    const engagement_score = computeEngagementScore(opts);
    const patch: Record<string, unknown> = {
      views: opts.views ?? 0,
      likes: opts.likes ?? 0,
      comments: opts.comments ?? 0,
      engagement_score,
      updated_at: new Date().toISOString(),
    };
    if (opts.impressions != null) patch.impressions = opts.impressions;
    if (opts.ctr != null) patch.ctr = opts.ctr;

    const { data, error } = await supabase
      .from("post_performance")
      .update(patch)
      .eq("post_id", opts.postId)
      .eq("platform", opts.platform)
      .select("id");
    if (error) {
      console.warn(`[analytics] post_performance metrics update failed for ${opts.postId}/${opts.platform}:`, error.message);
      return;
    }
    if (data && data.length > 0) {
      console.log(`[analytics] updated metrics for post_performance row ${data[0].id}`);
    }
  } catch (e) {
    console.warn("[analytics] updatePostPerformanceMetrics threw (non-fatal):", e instanceof Error ? e.message : e);
  }
}

/** Load top-performing post_performance rows for (city, platform) and shape directional insights. */
export async function loadCityPerformanceInsights(
  supabase: any,
  args: { city: string; platform: string; days?: number; limit?: number },
): Promise<PerformanceInsights | null> {
  const days = args.days ?? 14;
  const limit = args.limit ?? 5;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    // 1. Top N by engagement_score for direct title examples.
    const { data: top, error: topErr } = await supabase
      .from("post_performance")
      .select("title, tone, style, slot, engagement_score, views")
      .eq("city", args.city)
      .eq("platform", args.platform)
      .gte("published_at", since)
      .order("engagement_score", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (topErr) {
      console.warn("[analytics] loadCityPerformanceInsights query failed:", topErr.message);
      return null;
    }
    if (!top || top.length < 3) return null;

    // 2. Pull a wider window for per-slot averages (cap at 100).
    const { data: all } = await supabase
      .from("post_performance")
      .select("slot, views")
      .eq("city", args.city)
      .eq("platform", args.platform)
      .gte("published_at", since)
      .limit(100);

    const slotAgg: Record<string, { sum: number; n: number }> = {
      morning: { sum: 0, n: 0 },
      afternoon: { sum: 0, n: 0 },
      evening: { sum: 0, n: 0 },
    };
    for (const r of (all || []) as any[]) {
      if (!r.slot || !(r.slot in slotAgg)) continue;
      slotAgg[r.slot].sum += r.views || 0;
      slotAgg[r.slot].n += 1;
    }
    const avgViewsBySlot = {
      morning: slotAgg.morning.n ? slotAgg.morning.sum / slotAgg.morning.n : 0,
      afternoon: slotAgg.afternoon.n ? slotAgg.afternoon.sum / slotAgg.afternoon.n : 0,
      evening: slotAgg.evening.n ? slotAgg.evening.sum / slotAgg.evening.n : 0,
    };
    const bestSlotEntry = (["morning", "afternoon", "evening"] as const)
      .map((s) => ({ s, v: avgViewsBySlot[s], n: slotAgg[s].n }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.v - a.v)[0];
    const bestSlot = bestSlotEntry ? bestSlotEntry.s : null;

    // 3. Most-common tone/style across top rows (require ≥3 populated).
    const mostCommon = (key: "tone" | "style"): string | null => {
      const counts = new Map<string, number>();
      for (const r of top as any[]) {
        const v = (r[key] || "").toString().trim().toLowerCase();
        if (!v) continue;
        counts.set(v, (counts.get(v) || 0) + 1);
      }
      const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
      if (total < 3) return null;
      let best: { k: string; n: number } | null = null;
      for (const [k, n] of counts) if (!best || n > best.n) best = { k, n };
      return best ? best.k : null;
    };

    const topTitles = Array.from(
      new Set((top as any[]).map((r) => (r.title || "").trim()).filter(Boolean)),
    ).slice(0, 5);

    const insights: PerformanceInsights = {
      city: args.city,
      platform: args.platform,
      sampleSize: top.length,
      bestSlot,
      bestTone: mostCommon("tone"),
      bestStyle: mostCommon("style"),
      topTitles,
      avgViewsBySlot,
    };
    console.log(`[analytics] loaded top performers for ${args.city} (n=${top.length}, platform=${args.platform})`);
    return insights;
  } catch (e) {
    console.warn("[analytics] loadCityPerformanceInsights threw:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Build the <PERFORMANCE_GUIDANCE> block injected into title-generation prompts. */
export function formatPerformanceGuidanceBlock(i: PerformanceInsights): string {
  const lines: string[] = [];
  lines.push(`<PERFORMANCE_GUIDANCE>`);
  lines.push(`Recent performance guidance for ${i.city}:`);
  if (i.bestSlot) lines.push(`- Best slot: ${i.bestSlot}`);
  if (i.bestTone) lines.push(`- Best tone: ${i.bestTone}`);
  if (i.bestStyle) lines.push(`- Best style: ${i.bestStyle}`);
  if (i.topTitles.length > 0) {
    lines.push(`- Top-performing recent titles:`);
    i.topTitles.forEach((t, idx) => lines.push(`  ${idx + 1}. ${t}`));
  }
  lines.push(`- Patterns that perform well:`);
  lines.push(`  - urgency around storms`);
  lines.push(`  - short punchy hooks`);
  lines.push(`  - local specificity`);
  lines.push(``);
  lines.push(`Rules:`);
  lines.push(`- Directional only. NEVER copy a previous title exactly.`);
  lines.push(`- NEVER override slot-prefix rules ([8 AM]/[1 PM]/[6 PM]).`);
  lines.push(`- NEVER override city/location guardrails (only "${i.city}" is valid).`);
  lines.push(`- Use these insights to refine hook/tone only.`);
  lines.push(`</PERFORMANCE_GUIDANCE>`);
  return lines.join("\n");
}

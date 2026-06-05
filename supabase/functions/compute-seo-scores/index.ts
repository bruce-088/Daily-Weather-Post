// compute-seo-scores
// Phase 12-Analytics-D — Computes seo_score (0-100) and trending_score for
// every YouTube post_analytics row that has either tags or organic keywords.
// Designed to be cheap and idempotent. Runs nightly at 04:00 UTC after
// sync-youtube-analytics has refreshed enrichment fields.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireCronOrUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const gate = await requireCronOrUser(req);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Pull every YouTube row with enrichment fields populated.
  let q = supabase
    .from("post_analytics")
    .select(
      "id, user_id, post_id, city, views, likes, comments, avg_percentage_viewed, tags_used, keywords_organic, fetched_at, created_at",
    )
    .eq("platform", "youtube")
    .limit(2000);
  if (gate.source === "user" && gate.userId) q = q.eq("user_id", gate.userId);

  const { data: rows, error } = await q;
  if (error) {
    console.error("[compute-seo-scores] load failed:", error);
    return jsonResp({ error: error.message }, 500);
  }

  // Look up titles from post_history in one batch.
  const postIds = (rows || []).map((r: any) => r.post_id).filter(Boolean);
  const titleMap = new Map<string, string>();
  if (postIds.length) {
    const { data: ph } = await supabase
      .from("post_history")
      .select("id, caption")
      .in("id", postIds);
    for (const p of (ph || [])) titleMap.set(p.id, (p.caption || ""));
  }

  // niche CTR proxy — engagement rate, computed per user as fallback.
  const userViewAvg = new Map<string, number>();
  const userBuckets = new Map<string, number[]>();
  for (const r of (rows || []) as any[]) {
    if (!r.user_id) continue;
    if (!userBuckets.has(r.user_id)) userBuckets.set(r.user_id, []);
    userBuckets.get(r.user_id)!.push(Number(r.views || 0));
  }
  for (const [uid, arr] of userBuckets.entries()) {
    const sum = arr.reduce((a, b) => a + b, 0);
    userViewAvg.set(uid, arr.length ? sum / arr.length : 0);
  }

  let updated = 0;
  for (const r of (rows || []) as any[]) {
    const title = titleMap.get(r.post_id) || "";
    const tags: string[] = Array.isArray(r.tags_used) ? r.tags_used : [];
    const keywords: string[] = Array.isArray(r.keywords_organic) ? r.keywords_organic : [];

    const titleMatch = scoreTitleKeywordMatch(title, keywords);
    const tagCov = scoreTagCoverage(tags, keywords);
    const descDensity = scoreDescriptionDensity(title, keywords); // we treat title text as our "desc" proxy
    const userAvgViews = userViewAvg.get(r.user_id) || 1;
    const engagementProxy = Math.min(2, (Number(r.views || 0) / Math.max(1, userAvgViews))); // 0..2
    const retention = clamp01((Number(r.avg_percentage_viewed) || 0) / 100);

    const seo = 100 * (
      0.30 * titleMatch +
      0.20 * tagCov +
      0.20 * descDensity +
      0.15 * (engagementProxy / 2) +
      0.15 * retention
    );

    // Trending score
    const createdAt = new Date(r.created_at || Date.now()).getTime();
    const hours = Math.max(0.5, (Date.now() - createdAt) / 3_600_000);
    const decay = Math.exp(-0.01 * hours);
    const ctrBoost = Math.max(0, (engagementProxy - 1)); // 0..1
    const retentionBoost = Math.max(0, (retention - 0.5) / 0.5);
    const trending = (Number(r.views || 0) / hours) * decay * (1 + ctrBoost) * (1 + retentionBoost);

    const { error: upErr } = await supabase
      .from("post_analytics")
      .update({
        seo_score: round2(seo),
        trending_score: round2(trending),
      })
      .eq("id", r.id);
    if (!upErr) updated++;
  }

  console.log(`[compute-seo-scores] updated=${updated} of ${rows?.length ?? 0}`);
  return jsonResp({ updated, processed: rows?.length ?? 0 });
});

function scoreTitleKeywordMatch(title: string, keywords: string[]): number {
  if (!keywords.length) return 0.5; // neutral when we have no organic data yet
  const t = title.toLowerCase();
  let hits = 0;
  for (const k of keywords.slice(0, 10)) {
    const kw = k.toLowerCase().trim();
    if (!kw) continue;
    if (t.includes(kw)) hits++;
  }
  return clamp01(hits / Math.min(10, keywords.length));
}

function scoreTagCoverage(tags: string[], keywords: string[]): number {
  if (!keywords.length) return tags.length >= 5 ? 0.6 : tags.length * 0.1;
  if (!tags.length) return 0;
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  let hits = 0;
  for (const k of keywords.slice(0, 10)) {
    const kw = k.toLowerCase().trim();
    if (!kw) continue;
    for (const t of tagSet) if (t.includes(kw) || kw.includes(t)) { hits++; break; }
  }
  return clamp01(hits / Math.min(10, keywords.length));
}

function scoreDescriptionDensity(text: string, keywords: string[]): number {
  if (!keywords.length || !text) return 0.4;
  const words = text.toLowerCase().split(/\s+/).length || 1;
  let occ = 0;
  for (const k of keywords.slice(0, 5)) {
    const kw = k.toLowerCase().trim();
    if (!kw) continue;
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const m = text.toLowerCase().match(re);
    if (m) occ += m.length;
  }
  const density = occ / words;
  // sweet spot 0.5%–3%
  if (density === 0) return 0.2;
  if (density < 0.005) return 0.4;
  if (density <= 0.03) return 1.0;
  return 0.6;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

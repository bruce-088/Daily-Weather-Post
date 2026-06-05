// generate-tag-recommendations
// Phase 12-Analytics-D — Identifies top-performer videos (top 10% by seo_score
// per user+city) and computes a frequency-ranked list of tags they share.
// Writes the result into post_analytics.tags_recommended for every recent
// video in the same scope, and stores a summary memory in ai_memory for the
// content generation loop to consume.
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

  let q = supabase
    .from("post_analytics")
    .select("id, user_id, city, tags_used, seo_score, views")
    .eq("platform", "youtube")
    .not("tags_used", "is", null);
  if (gate.source === "user" && gate.userId) q = q.eq("user_id", gate.userId);

  const { data: rows, error } = await q;
  if (error) {
    console.error("[generate-tag-recommendations] load failed:", error);
    return jsonResp({ error: error.message }, 500);
  }

  // Bucket by user+city
  const buckets = new Map<string, any[]>();
  for (const r of (rows || []) as any[]) {
    const key = `${r.user_id}::${r.city ?? "all"}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }

  let updated = 0;
  let memoryInserts = 0;

  for (const [key, list] of buckets.entries()) {
    if (list.length < 5) continue; // not enough signal
    const sorted = list
      .filter((r) => r.seo_score != null)
      .sort((a, b) => Number(b.seo_score) - Number(a.seo_score));
    if (!sorted.length) continue;

    const topCount = Math.max(2, Math.ceil(sorted.length * 0.1));
    const top = sorted.slice(0, topCount);

    const freq = new Map<string, { count: number; totalSeo: number }>();
    for (const r of top) {
      const tags: string[] = Array.isArray(r.tags_used) ? r.tags_used : [];
      const seen = new Set<string>();
      for (const raw of tags) {
        const tag = String(raw).trim().toLowerCase();
        if (!tag || seen.has(tag)) continue;
        seen.add(tag);
        const cur = freq.get(tag) ?? { count: 0, totalSeo: 0 };
        cur.count += 1;
        cur.totalSeo += Number(r.seo_score) || 0;
        freq.set(tag, cur);
      }
    }

    const minOccurrence = Math.max(2, Math.ceil(top.length * 0.5));
    const ranked = [...freq.entries()]
      .filter(([_, v]) => v.count >= minOccurrence)
      .sort((a, b) => (b[1].totalSeo / b[1].count) - (a[1].totalSeo / a[1].count))
      .slice(0, 15)
      .map(([tag]) => tag);

    if (!ranked.length) continue;

    // Apply to every recent row in this bucket
    const ids = list.map((r) => r.id);
    const { error: upErr } = await supabase
      .from("post_analytics")
      .update({ tags_recommended: ranked })
      .in("id", ids);
    if (!upErr) updated += ids.length;

    // Drop a learning memory for the content generator
    const [userId, city] = key.split("::");
    const { error: memErr } = await supabase.from("ai_memory").insert({
      user_id: userId,
      memory_type: "tag_pattern",
      condition: city === "all" ? null : city,
      content: JSON.stringify({
        source: "youtube_analytics_seo",
        city: city === "all" ? null : city,
        tags: ranked,
        sample_size: top.length,
        avg_seo: round2(top.reduce((a, b) => a + (Number(b.seo_score) || 0), 0) / top.length),
      }),
      performance_score: round2(top.reduce((a, b) => a + (Number(b.seo_score) || 0), 0) / top.length),
      views: Math.round(top.reduce((a, b) => a + (Number(b.views) || 0), 0) / top.length),
    });
    if (!memErr) memoryInserts++;
  }

  console.log(`[generate-tag-recommendations] updated=${updated} memories=${memoryInserts}`);
  return jsonResp({ updated, memories: memoryInserts, buckets: buckets.size });
});

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

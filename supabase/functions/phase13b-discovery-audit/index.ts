// One-shot Phase 13B audit: pulls impressions, CTR, retention for last N
// YouTube Shorts per city to determine if Gainesville's view collapse is
// caused by (A) discovery suppression (impressions ↓) or (B) content fatigue
// (CTR/retention ↓ with impressions flat).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getYouTubeOAuthCreds } from "../_shared/youtube-adapter.ts";
import { requireCronOrUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const gate = await requireCronOrUser(req);
  if (!gate.ok) return gate.response;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const cities: string[] = body.cities ?? ["Gainesville", "Orlando"];
  const sinceISO = body.since ?? "2026-05-30";
  const limitPerCity = body.limit ?? 18;

  // Get last N shorts per city
  const { data: posts } = await supabase
    .from("post_history")
    .select("id, user_id, external_id, city, slot, created_at, caption")
    .in("city", cities)
    .gte("created_at", sinceISO)
    .not("external_id", "is", null)
    .or("platform.eq.youtube,platform.ilike.%youtube%,post_url.ilike.%youtube.com%")
    .order("created_at", { ascending: false });

  // Filter out long-form recaps (slot is null) — keep shorts only
  const byCity = new Map<string, any[]>();
  for (const p of posts || []) {
    if (!p.slot) continue;
    const arr = byCity.get(p.city) || [];
    if (arr.length < limitPerCity) arr.push(p);
    byCity.set(p.city, arr);
  }

  // Resolve token per channel (Project A first — that's where shorts live)
  const userId = (posts && posts[0]?.user_id) as string;
  const { data: accounts } = await supabase
    .from("social_accounts")
    .select("id, account_name, account_external_id, oauth_project, access_token, refresh_token, token_expires_at")
    .eq("user_id", userId)
    .eq("platform", "youtube")
    .eq("oauth_project", "A");

  const channelByName: Record<string, any> = {};
  for (const a of accounts || []) {
    if (a.account_name?.toLowerCase().includes("gainesville")) channelByName["Gainesville"] = a;
    if (a.account_name?.toLowerCase().includes("orlando")) channelByName["Orlando"] = a;
  }

  async function getToken(acct: any): Promise<string | null> {
    const exp = acct.token_expires_at ? new Date(acct.token_expires_at).getTime() : 0;
    if (acct.access_token && exp > Date.now() + 5 * 60 * 1000) return acct.access_token;
    const { id: clientId, secret } = getYouTubeOAuthCreds("A");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId!, client_secret: secret!,
        grant_type: "refresh_token", refresh_token: acct.refresh_token!,
      }),
    });
    const j = await r.json();
    if (!j.access_token) { console.error("refresh fail", acct.account_name, j); return null; }
    await supabase.from("social_accounts").update({
      access_token: j.access_token,
      token_expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
    }).eq("id", acct.id);
    return j.access_token;
  }

  const result: Record<string, any[]> = {};
  for (const city of cities) {
    const acct = channelByName[city];
    if (!acct) { result[city] = [{ error: "no Project A channel" }]; continue; }
    const token = await getToken(acct);
    if (!token) { result[city] = [{ error: "token refresh failed" }]; continue; }

    const rows: any[] = [];
    for (const p of byCity.get(city) || []) {
      const start = p.created_at.slice(0, 10);
      const end = new Date().toISOString().slice(0, 10);
      const params = new URLSearchParams({
        ids: "channel==MINE",
        startDate: start,
        endDate: end,
        filters: `video==${p.external_id}`,
        metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,shares",
      });
      const main = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const mainJson = await main.json();

      // Impressions + CTR (separate metric group, sometimes 400 if not available)
      const impParams = new URLSearchParams({
        ids: "channel==MINE",
        startDate: start,
        endDate: end,
        filters: `video==${p.external_id}`,
        metrics: "impressions,impressionClickThroughRate",
      });
      const imp = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${impParams}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const impJson = await imp.json();

      const m: Record<string, number> = {};
      if (main.ok) {
        const hdr = (mainJson.columnHeaders || []).map((h: any) => h.name);
        const row = (mainJson.rows && mainJson.rows[0]) || [];
        hdr.forEach((h: string, i: number) => m[h] = Number(row[i] ?? 0));
      } else {
        m.error_main = main.status;
      }
      if (imp.ok) {
        const hdr = (impJson.columnHeaders || []).map((h: any) => h.name);
        const row = (impJson.rows && impJson.rows[0]) || [];
        hdr.forEach((h: string, i: number) => m[h] = Number(row[i] ?? 0));
      } else {
        m.error_imp = imp.status;
        m.error_imp_body = (impJson?.error?.message || "").slice(0, 120) as any;
      }

      rows.push({
        date: start,
        slot: p.slot,
        video: p.external_id,
        views: m.views ?? 0,
        impressions: m.impressions ?? null,
        ctr_pct: m.impressionClickThroughRate != null ? Math.round(m.impressionClickThroughRate * 1000) / 10 : null,
        avg_view_pct: m.averageViewPercentage != null ? Math.round(m.averageViewPercentage * 10) / 10 : null,
        avg_dur_s: m.averageViewDuration ?? null,
        subs: m.subscribersGained ?? 0,
        likes: m.likes ?? 0,
        err: (m as any).error_imp_body || (m as any).error_imp || (m as any).error_main || null,
      });
    }
    result[city] = rows;
  }

  // Summaries
  const summary: any = {};
  for (const city of cities) {
    const rows = result[city] || [];
    const healthy = rows.filter((r) => r.date <= "2026-06-03");
    const recent = rows.filter((r) => r.date >= "2026-06-04");
    const avg = (xs: number[]) => xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
    summary[city] = {
      healthy_window: {
        n: healthy.length,
        avg_impressions: avg(healthy.map((r) => r.impressions || 0)),
        avg_ctr_pct: avg(healthy.map((r) => r.ctr_pct || 0)),
        avg_view_pct: avg(healthy.map((r) => r.avg_view_pct || 0)),
        avg_views: avg(healthy.map((r) => r.views || 0)),
      },
      recent_window: {
        n: recent.length,
        avg_impressions: avg(recent.map((r) => r.impressions || 0)),
        avg_ctr_pct: avg(recent.map((r) => r.ctr_pct || 0)),
        avg_view_pct: avg(recent.map((r) => r.avg_view_pct || 0)),
        avg_views: avg(recent.map((r) => r.views || 0)),
      },
    };
  }

  return new Response(JSON.stringify({ summary, detail: result }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

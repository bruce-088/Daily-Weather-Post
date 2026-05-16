// Fetch YouTube channel statistics (subscribers, videos, views) for each
// connected YouTube social_account and store a snapshot in
// social_accounts.extra.channel_stats. Keeps up to 35 daily snapshots so the
// UI can compute 7d / 30d subscriber gains.
//
// Read-only against YouTube: never refreshes tokens, never modifies channel
// data, never interrupts posts. Fails silently per-account.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Snapshot = {
  date: string; // YYYY-MM-DD UTC
  subs: number;
  videos: number;
  views: number;
};

type ChannelStats = {
  subscribers: number | null;
  videos: number | null;
  views: number | null;
  hidden_subscribers: boolean;
  fetched_at: string;
  last_error?: string | null;
  history: Snapshot[];
};

async function fetchStats(accessToken: string | null) {
  if (!accessToken) return { ok: false as const, error: "no_token", status: null };
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return { ok: false as const, error: `http_${res.status}`, status: res.status };
    const json = await res.json();
    const item = json?.items?.[0];
    if (!item) return { ok: false as const, error: "no_channel", status: 200 };
    const s = item.statistics || {};
    return {
      ok: true as const,
      subscribers: s.hiddenSubscriberCount ? null : Number(s.subscriberCount ?? 0),
      videos: Number(s.videoCount ?? 0),
      views: Number(s.viewCount ?? 0),
      hidden: !!s.hiddenSubscriberCount,
    };
  } catch (e) {
    return { ok: false as const, error: String(e), status: null };
  }
}

function mergeHistory(prev: Snapshot[] | undefined, snap: Snapshot): Snapshot[] {
  const list = Array.isArray(prev) ? [...prev] : [];
  const idx = list.findIndex((h) => h.date === snap.date);
  if (idx >= 0) list[idx] = snap;
  else list.push(snap);
  list.sort((a, b) => a.date.localeCompare(b.date));
  // Keep last 35 days.
  return list.slice(-35);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional: scope to a single user (when called manually from UI).
  let userScope: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.user_id === "string") userScope = body.user_id;
    }
  } catch { /* ignore */ }

  const summary = { checked: 0, ok: 0, failed: 0 };

  try {
    let q = supabase
      .from("social_accounts")
      .select("id, user_id, account_name, access_token, extra")
      .eq("platform", "youtube");
    if (userScope) q = q.eq("user_id", userScope);
    const { data: channels, error } = await q;
    if (error) throw error;

    const today = new Date().toISOString().slice(0, 10);

    for (const ch of channels || []) {
      summary.checked++;
      const result = await fetchStats(ch.access_token);
      const prevStats = ((ch.extra as any)?.channel_stats || {}) as Partial<ChannelStats>;

      let nextStats: ChannelStats;
      if (!result.ok) {
        summary.failed++;
        nextStats = {
          subscribers: prevStats.subscribers ?? null,
          videos: prevStats.videos ?? null,
          views: prevStats.views ?? null,
          hidden_subscribers: prevStats.hidden_subscribers ?? false,
          fetched_at: new Date().toISOString(),
          last_error: result.error,
          history: prevStats.history ?? [],
        };
      } else {
        summary.ok++;
        const snap: Snapshot = {
          date: today,
          subs: result.subscribers ?? 0,
          videos: result.videos ?? 0,
          views: result.views ?? 0,
        };
        nextStats = {
          subscribers: result.subscribers,
          videos: result.videos,
          views: result.views,
          hidden_subscribers: result.hidden,
          fetched_at: new Date().toISOString(),
          last_error: null,
          history: mergeHistory(prevStats.history, snap),
        };
      }

      const newExtra = {
        ...(ch.extra as Record<string, unknown> || {}),
        channel_stats: nextStats,
      };

      await supabase
        .from("social_accounts")
        .update({ extra: newExtra })
        .eq("id", ch.id);
    }
  } catch (e) {
    console.error("[youtube-channel-stats] fatal:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

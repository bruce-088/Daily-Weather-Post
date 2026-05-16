// Silent YouTube connection health check.
// Runs every ~6h via pg_cron. Read-only: never refreshes tokens, never
// disconnects channels, never interrupts posts. Just pings the YouTube
// API with the stored access_token and records a status on
// social_accounts.extra.health.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Health = "healthy" | "expired" | "disconnected";

async function checkOne(accessToken: string | null): Promise<{ status: Health; httpStatus: number | null }> {
  if (!accessToken) return { status: "expired", httpStatus: null };
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 200) return { status: "healthy", httpStatus: 200 };
    if (res.status === 401 || res.status === 403) return { status: "expired", httpStatus: res.status };
    return { status: "disconnected", httpStatus: res.status };
  } catch {
    return { status: "disconnected", httpStatus: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary = { checked: 0, healthy: 0, expired: 0, disconnected: 0, errors: 0 };

  try {
    const { data: channels, error } = await supabase
      .from("social_accounts")
      .select("id, user_id, account_name, access_token, extra")
      .eq("platform", "youtube");
    if (error) throw error;

    for (const ch of channels || []) {
      summary.checked++;
      try {
        const { status, httpStatus } = await checkOne(ch.access_token);
        summary[status]++;

        const prevHealth = (ch.extra as any)?.health?.status as Health | undefined;
        const newExtra = {
          ...(ch.extra as Record<string, unknown> || {}),
          health: {
            status,
            http_status: httpStatus,
            checked_at: new Date().toISOString(),
          },
        };

        await supabase
          .from("social_accounts")
          .update({ extra: newExtra })
          .eq("id", ch.id);

        // Notify on transition into a non-healthy state (avoid spamming).
        if (status === "expired" && prevHealth !== "expired") {
          const name = ch.account_name || "YouTube channel";
          await supabase.from("notifications").insert({
            user_id: ch.user_id,
            type: "warning",
            title: "YouTube token needs refresh",
            message: `${name} token needs refresh. Reconnect in Settings → YouTube Channels.`,
          });
        }
      } catch (e) {
        summary.errors++;
        console.error("[youtube-health-check] channel failed:", ch.id, e);
      }
    }
  } catch (e) {
    console.error("[youtube-health-check] fatal:", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 200, // fail silently — never break the cron
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

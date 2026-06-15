// YouTube connection health check with proactive token refresh.
//
// Runs every ~6h via pg_cron. For each connected YouTube channel:
//   1. If access_token is near expiry (< 10 min) AND refresh_token exists,
//      proactively call Google's OAuth refresh endpoint, persist the new
//      access_token + token_expires_at, then ping the YouTube API.
//   2. Only notify the user when:
//        - refresh_token is missing, OR
//        - the refresh call itself fails (e.g. invalid_grant 401/403), OR
//        - the health ping still returns 401 after a successful refresh.
//   3. Never warn just because the cached access_token timestamp lapsed —
//      that's normal (Google access tokens are 1 h) and the refresh_token
//      handles it silently.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  refreshYouTubeAccessToken,
  mergeHealthOnSuccess,
  mergeHealthOnFailure,
  type OAuthProject,
} from "../_shared/youtube-refresh.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Health = "healthy" | "expired" | "disconnected";

const NEAR_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

async function pingChannel(accessToken: string | null): Promise<{ status: Health; httpStatus: number | null; channelId: string | null }> {
  if (!accessToken) return { status: "expired", httpStatus: null, channelId: null };
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 200) {
      const body = await res.json().catch(() => ({}));
      const channelId: string | null = body?.items?.[0]?.id ?? null;
      return { status: "healthy", httpStatus: 200, channelId };
    }
    if (res.status === 401 || res.status === 403) return { status: "expired", httpStatus: res.status, channelId: null };
    return { status: "disconnected", httpStatus: res.status, channelId: null };
  } catch {
    return { status: "disconnected", httpStatus: null, channelId: null };
  }
}

/** Phase 13E-B: probe youtube.force-ssl scope by listing one comment thread.
 *  Returns "ok" | "missing_scope" | "error". Cheap (1 unit quota). */
async function probeCommentScope(accessToken: string, channelId: string): Promise<"ok" | "missing_scope" | "error"> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/commentThreads?part=id&allThreadsRelatedToChannelId=${encodeURIComponent(channelId)}&maxResults=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 200) return "ok";
    if (res.status === 401 || res.status === 403) {
      const body = await res.text().catch(() => "");
      if (/insufficient|insufficientPermissions|scope/i.test(body)) return "missing_scope";
      return "missing_scope";
    }
    return "error";
  } catch {
    return "error";
  }
}

// Phase 13G-B: refresh logic moved to _shared/youtube-refresh.ts so the
// health-check cron, the real-time YouTubeAdapter, and analytics workers
// all share ONE project-aware code path. The previous local helper hardcoded
// Project A creds, which caused every Project B (Recaps) refresh to return
// 401 invalid_client and silently kill the connection.

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const summary = {
    checked: 0,
    healthy: 0,
    expired: 0,
    disconnected: 0,
    proactive_refreshed: 0,
    refresh_failed: 0,
    errors: 0,
  };

  try {
    const { data: channels, error } = await supabase
      .from("social_accounts")
      .select("id, user_id, account_name, access_token, refresh_token, token_expires_at, extra")
      .eq("platform", "youtube");
    if (error) throw error;

    for (const ch of channels || []) {
      summary.checked++;
      try {
        const accountLabel = ch.account_name || "YouTube channel";
        let accessToken: string | null = ch.access_token;
        let refreshOutcome: "skipped" | "succeeded" | "failed" = "skipped";
        let refreshError: string | null = null;

        const expiresAtMs = ch.token_expires_at ? new Date(ch.token_expires_at).getTime() : 0;
        const nearExpiry = !expiresAtMs || expiresAtMs - Date.now() < NEAR_EXPIRY_MS;

        if (nearExpiry && ch.refresh_token) {
          console.log(`[health-check] token near expiry for ${accountLabel} — refreshing proactively`);
          const refreshed = await refreshAccessToken(ch.refresh_token);
          if (refreshed.ok && refreshed.accessToken && refreshed.expiresAt) {
            accessToken = refreshed.accessToken;
            await supabase
              .from("social_accounts")
              .update({
                access_token: refreshed.accessToken,
                token_expires_at: refreshed.expiresAt,
                updated_at: new Date().toISOString(),
              })
              .eq("id", ch.id);
            refreshOutcome = "succeeded";
            summary.proactive_refreshed++;
            console.log(`[health-check] proactive refresh succeeded for ${accountLabel}`);
          } else {
            refreshOutcome = "failed";
            refreshError = refreshed.error || "unknown refresh error";
            summary.refresh_failed++;
            console.log(`[health-check] refresh FAILED for ${accountLabel} — notifying user (${refreshError})`);
          }
        }

        // Ping with the freshest token we have (just-refreshed or stored).
        const { status, httpStatus, channelId } = await pingChannel(accessToken);
        summary[status]++;

        // Phase 13E-B: probe youtube.force-ssl scope so missing comment
        // permission surfaces here instead of silently at post time.
        let commentScope: "ok" | "missing_scope" | "error" | "skipped" = "skipped";
        if (status === "healthy" && accessToken && channelId) {
          commentScope = await probeCommentScope(accessToken, channelId);
        }

        const prevHealth = (ch.extra as any)?.health?.status as Health | undefined;
        const prevCommentScope = (ch.extra as any)?.health?.comment_scope as string | undefined;
        const newExtra = {
          ...((ch.extra as Record<string, unknown>) || {}),
          health: {
            status,
            http_status: httpStatus,
            checked_at: new Date().toISOString(),
            refresh: refreshOutcome,
            comment_scope: commentScope,
            ...(refreshError ? { refresh_error: refreshError } : {}),
          },
        };

        await supabase
          .from("social_accounts")
          .update({ extra: newExtra })
          .eq("id", ch.id);

        // Decide whether to notify. Suppress false warnings: a stale
        // access_token alone is NOT a problem when refresh_token works.
        const hasRefreshToken = !!ch.refresh_token;
        const shouldNotify =
          !hasRefreshToken ||
          refreshOutcome === "failed" ||
          (refreshOutcome === "succeeded" && status === "expired") ||
          (refreshOutcome === "skipped" && status === "expired" && !hasRefreshToken);

        if (shouldNotify && prevHealth !== "expired") {
          await supabase.from("notifications").insert({
            user_id: ch.user_id,
            type: "warning",
            title: "YouTube token needs refresh",
            message: `${accountLabel} token needs refresh. Reconnect in Settings → YouTube Channels.`,
          });
        }

        // Notify once when comment scope is missing (until reconnected).
        if (commentScope === "missing_scope" && prevCommentScope !== "missing_scope") {
          await supabase.from("notifications").insert({
            user_id: ch.user_id,
            type: "warning",
            title: "YouTube channel needs reconnect for pinned comments",
            message: `${accountLabel} is missing the comment permission. Open Settings → YouTube Channels, disconnect and reconnect to enable pinned comments.`,
          });
          await supabase.from("system_logs").insert({
            user_id: ch.user_id,
            type: "youtube_scope_missing",
            platform: "youtube",
            message: `${accountLabel} missing youtube.force-ssl scope (commentThreads probe failed)`,
            context: { social_account_id: ch.id, channel_id: channelId },
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

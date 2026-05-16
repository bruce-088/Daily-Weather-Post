import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signStatePayload(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64UrlEncode(new Uint8Array(signature));
}

async function createSignedState(payload: Record<string, unknown>, secret: string) {
  const encodedPayload = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await signStatePayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function readSignedState(state: string, secret: string) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Malformed state");
  const expectedSignature = await signStatePayload(encodedPayload, secret);
  if (signature !== expectedSignature) throw new Error("Invalid signature");
  return JSON.parse(decoder.decode(base64UrlDecode(encodedPayload)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID")!;
  const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const STATE_SECRET = SUPABASE_SERVICE_ROLE_KEY;

  try {
    const body = await req.json();
    const { action, code, redirect_uri, state } = body;
    console.log("YouTube auth action:", action);

    // get_auth_url doesn't need auth
    if (action === "get_auth_url") {
      const auth = await verifyUser(req);
      if (auth.response) return auth.response;

      const statePayload = {
        nonce: crypto.randomUUID(),
        user_id: auth.userId,
        redirect_uri,
        exp: Date.now() + 10 * 60 * 1000,
      };
      const csrfState = await createSignedState(statePayload, STATE_SECRET);
      const params = new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        redirect_uri: redirect_uri,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
        // ⚠️ CONTRACT — DO NOT REMOVE THESE THREE PARAMS:
        //   access_type=offline → required for Google to issue a refresh_token
        //   prompt=consent      → guarantees a refresh_token even on re-auth
        //                         (without it, Google returns no refresh_token
        //                          if the user previously granted scope, and
        //                          tokens silently expire every ~1h)
        //   include_granted_scopes=true → preserves prior scopes on re-consent
        access_type: "offline",
        prompt: "select_account consent",
        include_granted_scopes: "true",
        state: csrfState,
      });

      return new Response(
        JSON.stringify({
          url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
          state: csrfState,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "exchange_code") {
      if (!code || !state) {
        return new Response(
          JSON.stringify({ error: "Missing code or state" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let statePayload: { user_id?: string; redirect_uri?: string; exp?: number } = {};
      try {
        statePayload = await readSignedState(state, STATE_SECRET);
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid OAuth state" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (
        !statePayload.user_id ||
        !statePayload.redirect_uri ||
        !statePayload.exp ||
        statePayload.exp < Date.now()
      ) {
        return new Response(
          JSON.stringify({ error: "Invalid or expired OAuth state" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const userId = statePayload.user_id;
      const effectiveRedirectUri = statePayload.redirect_uri;

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: YOUTUBE_CLIENT_ID,
          client_secret: YOUTUBE_CLIENT_SECRET,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: effectiveRedirectUri,
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.error || !tokenData.access_token) {
        console.error("YouTube token exchange failed:", JSON.stringify(tokenData));
        return new Response(
          JSON.stringify({
            error: tokenData.error_description || tokenData.error || "Token exchange failed",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let channelId: string | null = null;
      let channelTitle: string | null = null;
      try {
        const channelRes = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        const channelData = await channelRes.json();
        channelId = channelData.items?.[0]?.id || null;
        channelTitle = channelData.items?.[0]?.snippet?.title || null;
      } catch (e) {
        console.error("Failed to fetch channel info:", e);
      }

      if (!channelId) {
        return new Response(
          JSON.stringify({ error: "Could not determine YouTube channel for this account" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
      const refreshToken = tokenData.refresh_token || null;

      // ---- Multi-channel: upsert per-channel row in social_accounts ----
      // Look up by (user_id, platform, account_external_id) so re-connecting
      // the SAME channel updates tokens, but a NEW channel adds a new row.
      const { data: existingChannel } = await supabaseAdmin
        .from("social_accounts")
        .select("id, refresh_token")
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("account_external_id", channelId)
        .maybeSingle();

      // Visibility: warn if Google returned no refresh_token AND we have
      // none on file — means long-lived auth is NOT possible for this row
      // until the user reconnects with prompt=consent honored.
      if (!refreshToken && !existingChannel?.refresh_token) {
        console.warn(
          `[youtube-auth] exchange_code: no refresh_token returned by Google AND none stored — long-lived auth NOT established for channel ${channelId}. User must reconnect with prompt=consent.`,
        );
      }

      if (existingChannel) {
        await supabaseAdmin
          .from("social_accounts")
          .update({
            account_name: channelTitle,
            access_token: tokenData.access_token,
            // Preserve previous refresh_token if Google didn't return one this time.
            refresh_token: refreshToken || existingChannel.refresh_token,
            token_expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingChannel.id);
      } else {
        await supabaseAdmin.from("social_accounts").insert({
          user_id: userId,
          platform: "youtube",
          account_external_id: channelId,
          account_name: channelTitle,
          access_token: tokenData.access_token,
          refresh_token: refreshToken,
          token_expires_at: expiresAt,
        });
      }

      // ---- Legacy weather_settings columns (single-channel compatibility) ----
      // Only write here when this is the user's FIRST connected YouTube channel
      // — otherwise we'd clobber the "primary" channel that legacy code paths
      // (sync-platform-metrics, status flags, refresh_token endpoint) still read.
      const { count: channelCount } = await supabaseAdmin
        .from("social_accounts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("platform", "youtube");

      const isFirstChannel = (channelCount || 0) <= 1;

      const { data: existingSettings } = await supabaseAdmin
        .from("weather_settings")
        .select("id, youtube_refresh_token")
        .eq("user_id", userId)
        .maybeSingle();

      if (isFirstChannel) {
        if (existingSettings) {
          await supabaseAdmin
            .from("weather_settings")
            .update({
              youtube_access_token: tokenData.access_token,
              youtube_refresh_token: refreshToken || existingSettings.youtube_refresh_token,
              youtube_channel_id: channelId,
              youtube_token_expires_at: expiresAt,
            })
            .eq("user_id", userId);
        } else {
          await supabaseAdmin.from("weather_settings").insert({
            user_id: userId,
            youtube_access_token: tokenData.access_token,
            youtube_refresh_token: refreshToken,
            youtube_channel_id: channelId,
            youtube_token_expires_at: expiresAt,
          });
        }
      }

      return new Response(
        JSON.stringify({ success: true, channel_id: channelId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "refresh_token") {
      const auth = await verifyUser(req);
      if (auth.response) return auth.response;
      const userId = auth.userId;

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: settings } = await supabaseAdmin
        .from("weather_settings")
        .select("youtube_refresh_token")
        .eq("user_id", userId)
        .single();

      if (!settings?.youtube_refresh_token) {
        return new Response(
          JSON.stringify({ error: "No refresh token found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: YOUTUBE_CLIENT_ID,
          client_secret: YOUTUBE_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: settings.youtube_refresh_token,
        }),
      });

      const refreshData = await refreshRes.json();

      if (refreshData.error || !refreshData.access_token) {
        return new Response(
          JSON.stringify({ error: refreshData.error_description || "Refresh failed" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const expiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

      await supabaseAdmin
        .from("weather_settings")
        .update({
          youtube_access_token: refreshData.access_token,
          youtube_token_expires_at: expiresAt,
        })
        .eq("user_id", userId);

      // BUG FIX: previously this updated EVERY youtube social_accounts row
      // for the user with the same access_token — corrupting per-channel
      // tokens in multi-channel setups. Scope strictly to the row whose
      // refresh_token matches the one we just used to mint this access_token.
      const { data: socialRows } = await supabaseAdmin
        .from("social_accounts")
        .update({
          access_token: refreshData.access_token,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .eq("refresh_token", settings.youtube_refresh_token)
        .select("id");
      if (!socialRows?.length) {
        // No matching row — create one and tag it as the shared/legacy channel
        // (city_id = null) so we don't accidentally claim a city-mapped slot.
        await supabaseAdmin.from("social_accounts").insert({
          user_id: userId,
          platform: "youtube",
          access_token: refreshData.access_token,
          refresh_token: settings.youtube_refresh_token,
          token_expires_at: expiresAt,
          city_id: null,
        });
      }

      console.log("[youtube-auth] token refreshed successfully");

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Per-channel silent refresh used by the YouTube Channels Manager.
    // Refreshes ONE social_accounts row using its own stored refresh_token,
    // updates its access_token + expiry, then pings the channels API and
    // writes the resulting health status back to social_accounts.extra.
    if (action === "refresh_channel") {
      const auth = await verifyUser(req);
      if (auth.response) return auth.response;
      const userId = auth.userId;
      const channelRowId = body.channel_id as string | undefined;
      if (!channelRowId) {
        return new Response(
          JSON.stringify({ error: "Missing channel_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: row, error: rowErr } = await supabaseAdmin
        .from("social_accounts")
        .select("id, user_id, refresh_token, account_name, extra")
        .eq("id", channelRowId)
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .maybeSingle();

      if (rowErr || !row) {
        return new Response(
          JSON.stringify({ ok: false, status: "not_found", error: "Channel not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!row.refresh_token) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: "refresh_token_missing",
            error: "No refresh token stored — reconnect required.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: YOUTUBE_CLIENT_ID,
          client_secret: YOUTUBE_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: row.refresh_token,
        }),
      });
      const refreshData = await refreshRes.json();

      if (refreshData.error || !refreshData.access_token) {
        // Mark disconnected/expired in extra.health for the UI
        await supabaseAdmin
          .from("social_accounts")
          .update({
            extra: {
              ...((row.extra as Record<string, unknown>) || {}),
              health: {
                status: "expired",
                http_status: 401,
                checked_at: new Date().toISOString(),
              },
            },
          })
          .eq("id", row.id);
        return new Response(
          JSON.stringify({
            ok: false,
            status: "reauth_required",
            error: refreshData.error_description || refreshData.error || "Refresh failed",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const expiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

      // Verify the freshly issued access_token with a real API ping
      let pingStatus: "healthy" | "expired" | "disconnected" = "healthy";
      let pingHttp: number | null = null;
      try {
        const pingRes = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true",
          { headers: { Authorization: `Bearer ${refreshData.access_token}` } },
        );
        pingHttp = pingRes.status;
        if (pingRes.status === 200) pingStatus = "healthy";
        else if (pingRes.status === 401 || pingRes.status === 403) pingStatus = "expired";
        else pingStatus = "disconnected";
      } catch {
        pingStatus = "disconnected";
      }

      await supabaseAdmin
        .from("social_accounts")
        .update({
          access_token: refreshData.access_token,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
          extra: {
            ...((row.extra as Record<string, unknown>) || {}),
            health: {
              status: pingStatus,
              http_status: pingHttp,
              checked_at: new Date().toISOString(),
            },
          },
        })
        .eq("id", row.id);

      if (pingStatus === "healthy") {
        console.log(`[youtube-auth] token refreshed successfully (channel=${row.account_name || row.id})`);
      }

      return new Response(
        JSON.stringify({
          ok: pingStatus === "healthy",
          status: pingStatus === "healthy" ? "refreshed" : "reauth_required",
          channel_id: row.id,
          token_expires_at: expiresAt,
          ping_http: pingHttp,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("YouTube auth error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

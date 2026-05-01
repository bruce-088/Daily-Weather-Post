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
        access_type: "offline",
        prompt: "consent",
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

      let channelId = null;
      try {
        const channelRes = await fetch(
          "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
          { headers: { Authorization: `Bearer ${tokenData.access_token}` } }
        );
        const channelData = await channelRes.json();
        channelId = channelData.items?.[0]?.id || null;
      } catch (e) {
        console.error("Failed to fetch channel ID:", e);
      }

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
      const refreshToken = tokenData.refresh_token || null;

      const { data: existing } = await supabaseAdmin
        .from("weather_settings")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      let dbError;
      if (existing) {
        const { error } = await supabaseAdmin
          .from("weather_settings")
          .update({
            youtube_access_token: tokenData.access_token,
            youtube_refresh_token: refreshToken,
            youtube_channel_id: channelId,
            youtube_token_expires_at: expiresAt,
          })
          .eq("user_id", userId);
        dbError = error;
      } else {
        const { error } = await supabaseAdmin
          .from("weather_settings")
          .insert({
            user_id: userId,
            youtube_access_token: tokenData.access_token,
            youtube_refresh_token: refreshToken,
            youtube_channel_id: channelId,
            youtube_token_expires_at: expiresAt,
          });
        dbError = error;
      }

      if (dbError) {
        console.error("Failed to save YouTube tokens:", JSON.stringify(dbError));
        return new Response(
          JSON.stringify({ error: "Failed to save tokens" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: socialRows } = await supabaseAdmin
        .from("social_accounts")
        .update({
          account_external_id: channelId,
          access_token: tokenData.access_token,
          refresh_token: refreshToken,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .select("id");
      if (!socialRows?.length) {
        await supabaseAdmin.from("social_accounts").insert({
          user_id: userId,
          platform: "youtube",
          account_external_id: channelId,
          access_token: tokenData.access_token,
          refresh_token: refreshToken,
          token_expires_at: expiresAt,
        });
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

      const { data: socialRows } = await supabaseAdmin
        .from("social_accounts")
        .update({
          access_token: refreshData.access_token,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("platform", "youtube")
        .select("id");
      if (!socialRows?.length) {
        await supabaseAdmin.from("social_accounts").insert({
          user_id: userId,
          platform: "youtube",
          access_token: refreshData.access_token,
          refresh_token: settings.youtube_refresh_token,
          token_expires_at: expiresAt,
        });
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

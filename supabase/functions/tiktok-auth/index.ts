import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const TIKTOK_CLIENT_KEY = Deno.env.get("TIKTOK_CLIENT_KEY")!;
  const TIKTOK_CLIENT_SECRET = Deno.env.get("TIKTOK_CLIENT_SECRET")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const { action, code, redirect_uri } = await req.json();

    // get_auth_url doesn't need auth — user hasn't connected yet
    if (action === "get_auth_url") {
      const csrfState = crypto.randomUUID();
      const params = new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        scope: "user.info.basic,video.publish,video.upload",
        response_type: "code",
        redirect_uri: redirect_uri,
        state: csrfState,
      });

      return new Response(
        JSON.stringify({
          url: `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`,
          state: csrfState,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // All other actions require authenticated user
    const auth = await verifyUser(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;

    if (action === "exchange_code") {
      if (!code || !redirect_uri) {
        return new Response(
          JSON.stringify({ error: "Missing code or redirect_uri" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: TIKTOK_CLIENT_KEY,
          client_secret: TIKTOK_CLIENT_SECRET,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: redirect_uri,
        }),
      });

      const tokenData = await tokenRes.json();

      if (tokenData.error || !tokenData.access_token) {
        console.error("TikTok token exchange failed:", tokenData);
        return new Response(
          JSON.stringify({
            error: tokenData.error_description || tokenData.error || "Token exchange failed",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

      const { error: updateError } = await supabaseAdmin
        .from("weather_settings")
        .update({
          tiktok_access_token: tokenData.access_token,
          tiktok_refresh_token: tokenData.refresh_token,
          tiktok_open_id: tokenData.open_id,
          tiktok_token_expires_at: expiresAt,
        })
        .eq("user_id", userId);

      if (updateError) {
        const { error: insertError } = await supabaseAdmin
          .from("weather_settings")
          .insert({
            user_id: userId,
            tiktok_access_token: tokenData.access_token,
            tiktok_refresh_token: tokenData.refresh_token,
            tiktok_open_id: tokenData.open_id,
            tiktok_token_expires_at: expiresAt,
          });

        if (insertError) {
          console.error("Failed to save TikTok tokens:", insertError);
          return new Response(
            JSON.stringify({ error: "Failed to save tokens" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({ success: true, open_id: tokenData.open_id, scope: tokenData.scope }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "refresh_token") {
      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: settings } = await supabaseAdmin
        .from("weather_settings")
        .select("tiktok_refresh_token")
        .eq("user_id", userId)
        .single();

      if (!settings?.tiktok_refresh_token) {
        return new Response(
          JSON.stringify({ error: "No refresh token found" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const refreshRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: TIKTOK_CLIENT_KEY,
          client_secret: TIKTOK_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: settings.tiktok_refresh_token,
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
          tiktok_access_token: refreshData.access_token,
          tiktok_refresh_token: refreshData.refresh_token,
          tiktok_open_id: refreshData.open_id,
          tiktok_token_expires_at: expiresAt,
        })
        .eq("user_id", userId);

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
    console.error("TikTok auth error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

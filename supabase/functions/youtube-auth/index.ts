import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const YOUTUBE_CLIENT_ID = Deno.env.get("YOUTUBE_CLIENT_ID")!;
  const YOUTUBE_CLIENT_SECRET = Deno.env.get("YOUTUBE_CLIENT_SECRET")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const body = await req.json();
    const { action, code, redirect_uri, user_id } = body;
    console.log("YouTube auth action:", action, "user_id:", user_id, "redirect_uri:", redirect_uri);

    // Step 1: Generate the Google OAuth authorization URL
    if (action === "get_auth_url") {
      const csrfState = crypto.randomUUID();
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

    // Step 2: Exchange authorization code for access token
    if (action === "exchange_code") {
      if (!code || !redirect_uri || !user_id) {
        return new Response(
          JSON.stringify({ error: "Missing code, redirect_uri, or user_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: YOUTUBE_CLIENT_ID,
          client_secret: YOUTUBE_CLIENT_SECRET,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: redirect_uri,
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

      // Fetch channel ID
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

      const { error: updateError } = await supabaseAdmin
        .from("weather_settings")
        .update({
          youtube_access_token: tokenData.access_token,
          youtube_refresh_token: tokenData.refresh_token || null,
          youtube_channel_id: channelId,
          youtube_token_expires_at: expiresAt,
        })
        .eq("user_id", user_id);

      if (updateError) {
        const { error: insertError } = await supabaseAdmin
          .from("weather_settings")
          .insert({
            user_id: user_id,
            youtube_access_token: tokenData.access_token,
            youtube_refresh_token: tokenData.refresh_token || null,
            youtube_channel_id: channelId,
            youtube_token_expires_at: expiresAt,
          });

        if (insertError) {
          console.error("Failed to save YouTube tokens:", insertError);
          return new Response(
            JSON.stringify({ error: "Failed to save tokens" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(
        JSON.stringify({ success: true, channel_id: channelId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 3: Refresh token
    if (action === "refresh_token") {
      if (!user_id) {
        return new Response(
          JSON.stringify({ error: "Missing user_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: settings } = await supabaseAdmin
        .from("weather_settings")
        .select("youtube_refresh_token")
        .eq("user_id", user_id)
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
        .eq("user_id", user_id);

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
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

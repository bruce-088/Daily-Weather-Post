import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const clientId = Deno.env.get("LINKEDIN_CLIENT_ID");
    const clientSecret = Deno.env.get("LINKEDIN_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!clientId || !clientSecret) {
      return new Response(
        JSON.stringify({ error: "LinkedIn credentials not configured" }),
        { status: 500, headers: corsHeaders },
      );
    }

    const { action, code, redirect_uri, state, organization_urn } = await req.json();

    // --- Generate Auth URL ---
    if (action === "get_auth_url") {
      const oauthState = crypto.randomUUID();
      // Keep authorization on LinkedIn's generally available products.
      // Organization scopes require separate LinkedIn approval and can cause
      // LinkedIn's generic "Bummer, something went wrong" screen before the
      // user ever reaches our callback, even when redirect_uri is correct.
      const scopes = "openid profile w_member_social";
      const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirect_uri);
      url.searchParams.set("state", oauthState);
      url.searchParams.set("scope", scopes);

      console.log("LinkedIn auth URL redirect_uri:", redirect_uri);
      console.log("LinkedIn auth full URL:", url.toString());

      return new Response(
        JSON.stringify({ url: url.toString(), state: oauthState }),
        { headers: corsHeaders },
      );
    }

    // --- Exchange Code for Tokens ---
    if (action === "exchange_code") {
      const auth = await verifyUser(req);
      if (auth.error) return auth.response!;

      // Exchange authorization code for access token
      const tokenRes = await fetch(
        "https://www.linkedin.com/oauth/v2/accessToken",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        },
      );

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        console.error("LinkedIn token exchange error:", tokenData);
        return new Response(
          JSON.stringify({ error: tokenData.error_description || "Token exchange failed" }),
          { status: 400, headers: corsHeaders },
        );
      }

      const accessToken = tokenData.access_token;
      const expiresIn = tokenData.expires_in; // seconds
      const refreshToken = tokenData.refresh_token || null;

      // Get the user's LinkedIn person URN via userinfo
      const profileRes = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const profileData = await profileRes.json();
      const personUrn = profileData.sub ? `urn:li:person:${profileData.sub}` : null;

      if (!personUrn) {
        console.error("Failed to get LinkedIn person URN:", profileData);
        return new Response(
          JSON.stringify({ error: "Could not retrieve LinkedIn profile" }),
          { status: 400, headers: corsHeaders },
        );
      }

      // Fetch administered organizations
      let organizations: Array<{ urn: string; name: string }> = [];
      try {
        const orgsRes = await fetch(
          "https://api.linkedin.com/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR",
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "LinkedIn-Version": "202601",
              "X-Restli-Protocol-Version": "2.0.0",
            },
          },
        );
        const orgsData = await orgsRes.json();
        console.log("LinkedIn orgs response:", JSON.stringify(orgsData));

        if (orgsData.elements) {
          // Fetch each org's name individually
          for (const el of orgsData.elements) {
            const orgUrn = el.organization; // e.g. "urn:li:organization:12345"
            const orgId = orgUrn.split(":").pop();
            let name = orgUrn;
            try {
              const orgRes = await fetch(
                `https://api.linkedin.com/rest/organizations/${orgId}`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "LinkedIn-Version": "202601",
                    "X-Restli-Protocol-Version": "2.0.0",
                  },
                },
              );
              const orgData = await orgRes.json();
              name = orgData.localizedName || orgUrn;
            } catch (e) {
              console.error("Failed to fetch org name for", orgUrn, e);
            }
            organizations.push({ urn: orgUrn, name });
          }
        }
      } catch (orgErr) {
        console.error("Failed to fetch LinkedIn organizations:", orgErr);
      }

      // Store tokens
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      const { data: existingSettings } = await supabase
        .from("weather_settings")
        .select("linkedin_refresh_token")
        .eq("user_id", auth.userId)
        .maybeSingle();

      const refreshTokenToStore = refreshToken || existingSettings?.linkedin_refresh_token || null;
      const accountName = profileData.name || profileData.localizedFirstName || null;
      const selectedOrgUrn = organizations.length === 1 ? organizations[0].urn : null;

      const { error: dbError } = await supabase
        .from("weather_settings")
        .update({
          linkedin_access_token: accessToken,
          linkedin_refresh_token: refreshTokenToStore,
          linkedin_token_expires_at: expiresAt,
          linkedin_person_urn: personUrn,
          // If only one org, auto-select it
          ...(selectedOrgUrn ? { linkedin_organization_urn: selectedOrgUrn } : {}),
        })
        .eq("user_id", auth.userId);

      if (dbError) {
        console.error("DB update error:", dbError);
        return new Response(
          JSON.stringify({ error: "Failed to save LinkedIn tokens" }),
          { status: 500, headers: corsHeaders },
        );
      }

      const { data: matchingAccount } = await supabase
        .from("social_accounts")
        .select("id, refresh_token")
        .eq("user_id", auth.userId)
        .eq("platform", "linkedin")
        .eq("account_external_id", personUrn)
        .maybeSingle();

      const { data: fallbackAccount } = matchingAccount
        ? { data: null }
        : await supabase
          .from("social_accounts")
          .select("id, refresh_token")
          .eq("user_id", auth.userId)
          .eq("platform", "linkedin")
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

      const existingAccount = matchingAccount || fallbackAccount;

      const accountPayload = {
        account_name: accountName,
        access_token: accessToken,
        refresh_token: refreshTokenToStore || existingAccount?.refresh_token || null,
        token_expires_at: expiresAt,
        extra: { organization_urn: selectedOrgUrn },
        updated_at: new Date().toISOString(),
      };

      if (existingAccount) {
        await supabase.from("social_accounts").update(accountPayload).eq("id", existingAccount.id);
      } else {
        await supabase.from("social_accounts").insert({
          user_id: auth.userId,
          platform: "linkedin",
          account_external_id: personUrn,
          ...accountPayload,
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          person_urn: personUrn,
          organizations,
        }),
        { headers: corsHeaders },
      );
    }

    // --- Set Organization URN ---
    if (action === "set_organization") {
      const auth = await verifyUser(req);
      if (auth.error) return auth.response!;

      if (!organization_urn) {
        return new Response(
          JSON.stringify({ error: "organization_urn is required" }),
          { status: 400, headers: corsHeaders },
        );
      }

      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { error: dbError } = await supabase
        .from("weather_settings")
        .update({ linkedin_organization_urn: organization_urn })
        .eq("user_id", auth.userId);

      if (dbError) {
        return new Response(
          JSON.stringify({ error: "Failed to save organization" }),
          { status: 500, headers: corsHeaders },
        );
      }

      await supabase
        .from("social_accounts")
        .update({
          extra: { organization_urn },
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", auth.userId)
        .eq("platform", "linkedin");

      return new Response(
        JSON.stringify({ success: true }),
        { headers: corsHeaders },
      );
    }

    // --- Refresh Token ---
    if (action === "refresh_token") {
      const auth = await verifyUser(req);
      if (auth.error) return auth.response!;

      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { data: settings } = await supabase
        .from("weather_settings")
        .select("linkedin_refresh_token")
        .eq("user_id", auth.userId)
        .single();

      if (!settings?.linkedin_refresh_token) {
        return new Response(
          JSON.stringify({ error: "No refresh token available" }),
          { status: 400, headers: corsHeaders },
        );
      }

      const tokenRes = await fetch(
        "https://www.linkedin.com/oauth/v2/accessToken",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: settings.linkedin_refresh_token,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        },
      );

      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || tokenData.error) {
        return new Response(
          JSON.stringify({ error: tokenData.error_description || "Refresh failed" }),
          { status: 400, headers: corsHeaders },
        );
      }

      const expiresAt = new Date(
        Date.now() + tokenData.expires_in * 1000,
      ).toISOString();

      await supabase
        .from("weather_settings")
        .update({
          linkedin_access_token: tokenData.access_token,
          linkedin_refresh_token: tokenData.refresh_token || settings.linkedin_refresh_token,
          linkedin_token_expires_at: expiresAt,
        })
        .eq("user_id", auth.userId);

      await supabase
        .from("social_accounts")
        .update({
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || settings.linkedin_refresh_token,
          token_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", auth.userId)
        .eq("platform", "linkedin");

      return new Response(
        JSON.stringify({ success: true, access_token: tokenData.access_token }),
        { headers: corsHeaders },
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: corsHeaders },
    );
  } catch (err) {
    console.error("LinkedIn auth error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});

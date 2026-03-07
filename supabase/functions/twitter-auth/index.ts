import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyUser } from "../_shared/auth-helpers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// --- OAuth 1.0a helpers ---

function percentEncode(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function generateNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

async function buildOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  tokenOrEmpty: string,
  tokenSecretOrEmpty: string,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
  if (tokenOrEmpty) oauthParams["oauth_token"] = tokenOrEmpty;

  // Merge oauth_* extra params (like oauth_callback) into oauthParams so they appear in the header
  for (const [k, v] of Object.entries(extraParams)) {
    if (k.startsWith("oauth_")) {
      oauthParams[k] = v;
    }
  }
  const allParams = { ...oauthParams, ...extraParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map((k) => percentEncode(k) + "=" + percentEncode(allParams[k])).join("&");
  const signatureBase = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = percentEncode(consumerSecret) + "&" + percentEncode(tokenSecretOrEmpty);
  const signature = await hmacSha1(signingKey, signatureBase);
  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => percentEncode(k) + '="' + percentEncode(oauthParams[k]) + '"');
  return "OAuth " + headerParts.join(", ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const CONSUMER_KEY = Deno.env.get("TWITTER_CONSUMER_KEY")!;
  const CONSUMER_SECRET = Deno.env.get("TWITTER_CONSUMER_SECRET")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const body = await req.json();
    const { action, oauth_token, oauth_verifier, redirect_uri } = body;
    console.log("Twitter auth action:", action);

    // get_auth_url doesn't need auth
    if (action === "get_auth_url") {
      const requestTokenUrl = "https://api.twitterwitter.com/oauth/request_token";
      const callbackUrl = redirect_uri || "oob";
      const extraParams: Record<string, string> = { oauth_callback: callbackUrl };

      const authHeader = await buildOAuthHeader(
        "POST", requestTokenUrl, CONSUMER_KEY, CONSUMER_SECRET, "", "", extraParams,
      );

      const res = await fetch(requestTokenUrl, {
        method: "POST",
        headers: { Authorization: authHeader },
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Request token failed:", res.status, errText);
        return new Response(JSON.stringify({ error: "Failed to get request token: " + errText }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const responseText = await res.text();
      const params = new URLSearchParams(responseText);
      const oauthToken = params.get("oauth_token");
      const oauthTokenSecret = params.get("oauth_token_secret");

      if (!oauthToken) {
        return new Response(JSON.stringify({ error: "No oauth_token returned" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const authorizeUrl = "https:twitter/api.x.com/oauth/authorize?oauth_token=" + oauthToken;
      return new Response(
        JSON.stringify({ url: authorizeUrl, oauth_token: oauthToken, oauth_token_secret: oauthTokenSecret }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // All other actions require authenticated user
    const auth = await verifyUser(req);
    if (auth.response) return auth.response;
    const userId = auth.userId;

    if (action === "exchange_token") {
      if (!oauth_token || !oauth_verifier) {
        return new Response(JSON.stringify({ error: "Missing oauth_token or oauth_verifier" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const oauth_token_secret = body.oauth_token_secret || "";
      const accessTokenUrl = "https://api.x.com/oauth/access_token";
      const extraParams: Record<string, string> = { oauth_verifier };

      const authHeader = await buildOAuthHeader(
        "POST", accessTokenUrl, CONSUMER_KEY, CONSUMER_SECRET, oauth_token, oauth_token_secret, extraParams,
      );

      const res = await fetch(accessTokenUrl, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "oauth_verifier=" + percentEncode(oauth_verifier),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error("Access token exchange failed:", res.status, errText);
        return new Response(JSON.stringify({ error: "Token exchange failed: " + errText }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const responseText = await res.text();
      const params = new URLSearchParams(responseText);
      const accessToken = params.get("oauth_token");
      const accessTokenSecret = params.get("oauth_token_secret");
      const twitterUserId = params.get("user_id");
      const screenName = params.get("screen_name");

      if (!accessToken || !accessTokenSecret) {
        return new Response(JSON.stringify({ error: "No access token returned" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      const { data: existing } = await supabase
        .from("weather_settings")
        .select("id")
        .eq("user_id", userId)
        .single();

      const tokenPayload = {
        twitter_access_token: accessToken,
        twitter_access_token_secret: accessTokenSecret,
        twitter_user_id: twitterUserId,
      };

      if (existing) {
        await supabase.from("weather_settings").update(tokenPayload).eq("user_id", userId);
      } else {
        await supabase.from("weather_settings").insert({ ...tokenPayload, user_id: userId });
      }

      console.log("Twitter connected for user:", userId, "screen_name:", screenName);
      return new Response(
        JSON.stringify({ success: true, screen_name: screenName }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "Unknown action: " + action }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Twitter auth error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

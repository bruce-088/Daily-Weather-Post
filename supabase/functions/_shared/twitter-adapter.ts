import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";

// --- OAuth 1.0a Helpers ---

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
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function buildOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string,
  extraParams: Record<string, string> = {},
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: generateNonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Combine oauth params and extra params for signature base
  const allParams = { ...oauthParams, ...extraParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys.map((k) => percentEncode(k) + "=" + percentEncode(allParams[k])).join("&");

  const signatureBase = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join("&");
  const signingKey = percentEncode(consumerSecret) + "&" + percentEncode(accessTokenSecret);
  const signature = await hmacSha1(signingKey, signatureBase);

  oauthParams["oauth_signature"] = signature;

  const headerParts = Object.keys(oauthParams)
    .sort()
    .map((k) => percentEncode(k) + '="' + percentEncode(oauthParams[k]) + '"');

  return "OAuth " + headerParts.join(", ");
}

// --- Twitter Adapter ---

export class TwitterAdapter implements PlatformAdapter {
  name = "twitter";

  isConnected(settings: Record<string, unknown>): boolean {
    return !!(settings as any).twitter_access_token && !!(settings as any).twitter_access_token_secret;
  }

  async getValidToken(supabase: any, userId: string): Promise<string | null> {
    // For Twitter OAuth 1.0a we need both tokens, so we return a JSON string
    // containing both values that uploadVideo will parse
    const { data: settings } = await supabase
      .from("weather_settings")
      .select("twitter_access_token, twitter_access_token_secret")
      .eq("user_id", userId)
      .single();

    if (!settings?.twitter_access_token || !settings?.twitter_access_token_secret) return null;

    // Pack both tokens into a JSON string since the interface expects a single string
    return JSON.stringify({
      access_token: settings.twitter_access_token,
      access_token_secret: settings.twitter_access_token_secret,
    });
  }

  async uploadVideo(
    tokenJson: string,
    videoData: Uint8Array,
    title: string,
    description: string,
    mimeType = "video/mp4",
  ): Promise<UploadResult | null> {
    const consumerKey = Deno.env.get("TWITTER_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("TWITTER_CONSUMER_SECRET");
    if (!consumerKey || !consumerSecret) {
      console.error("Twitter consumer credentials not configured");
      return null;
    }

    const { access_token, access_token_secret } = JSON.parse(tokenJson);

    console.log("Uploading video to Twitter/X (" + videoData.byteLength + " bytes)");

    // Step 1: INIT chunked media upload
    const mediaUploadUrl = "https://upload.twitter.com/1.1/media/upload.json";

    const initParams: Record<string, string> = {
      command: "INIT",
      total_bytes: String(videoData.byteLength),
      media_type: mimeType,
      media_category: "tweet_video",
    };

    const initAuth = await buildOAuthHeader("POST", mediaUploadUrl, consumerKey, consumerSecret, access_token, access_token_secret, initParams);
    const initBody = new URLSearchParams(initParams);

    const initRes = await fetch(mediaUploadUrl, {
      method: "POST",
      headers: {
        Authorization: initAuth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: initBody.toString(),
    });

    if (!initRes.ok) {
      const errText = await initRes.text();
      console.error("Twitter media INIT failed:", initRes.status, errText);
      return null;
    }

    const initData = await initRes.json();
    const mediaId = initData.media_id_string;
    console.log("Twitter media INIT success, media_id:", mediaId);

    // Step 2: APPEND chunks (5MB each)
    const chunkSize = 5 * 1024 * 1024;
    let segmentIndex = 0;

    for (let offset = 0; offset < videoData.byteLength; offset += chunkSize) {
      const chunk = videoData.slice(offset, Math.min(offset + chunkSize, videoData.byteLength));
      const chunkBase64 = btoa(String.fromCharCode(...chunk));

      const appendParams: Record<string, string> = {
        command: "APPEND",
        media_id: mediaId,
        segment_index: String(segmentIndex),
      };

      // For APPEND, we need to send media_data in the body but NOT in the OAuth signature
      const appendAuth = await buildOAuthHeader("POST", mediaUploadUrl, consumerKey, consumerSecret, access_token, access_token_secret, appendParams);

      const formData = new URLSearchParams({
        ...appendParams,
        media_data: chunkBase64,
      });

      const appendRes = await fetch(mediaUploadUrl, {
        method: "POST",
        headers: {
          Authorization: appendAuth,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      if (!appendRes.ok) {
        const errText = await appendRes.text();
        console.error("Twitter media APPEND failed (segment " + segmentIndex + "):", appendRes.status, errText);
        return null;
      }
      await appendRes.text(); // consume body

      console.log("Twitter APPEND segment " + segmentIndex + " success");
      segmentIndex++;
    }

    // Step 3: FINALIZE
    const finalizeParams: Record<string, string> = {
      command: "FINALIZE",
      media_id: mediaId,
    };

    const finalizeAuth = await buildOAuthHeader("POST", mediaUploadUrl, consumerKey, consumerSecret, access_token, access_token_secret, finalizeParams);

    const finalizeRes = await fetch(mediaUploadUrl, {
      method: "POST",
      headers: {
        Authorization: finalizeAuth,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(finalizeParams).toString(),
    });

    if (!finalizeRes.ok) {
      const errText = await finalizeRes.text();
      console.error("Twitter media FINALIZE failed:", finalizeRes.status, errText);
      return null;
    }

    let finalizeData = await finalizeRes.json();
    console.log("Twitter media FINALIZE response:", JSON.stringify(finalizeData));

    // Step 4: Poll for processing completion if async
    if (finalizeData.processing_info) {
      let processingInfo = finalizeData.processing_info;
      while (processingInfo && processingInfo.state !== "succeeded") {
        if (processingInfo.state === "failed") {
          console.error("Twitter media processing failed:", JSON.stringify(processingInfo));
          return null;
        }
        const waitSec = processingInfo.check_after_secs || 5;
        console.log("Twitter media processing, waiting " + waitSec + "s...");
        await new Promise((r) => setTimeout(r, waitSec * 1000));

        const statusParams: Record<string, string> = {
          command: "STATUS",
          media_id: mediaId,
        };
        const statusAuth = await buildOAuthHeader("GET", mediaUploadUrl, consumerKey, consumerSecret, access_token, access_token_secret, statusParams);

        const statusRes = await fetch(mediaUploadUrl + "?command=STATUS&media_id=" + mediaId, {
          method: "GET",
          headers: { Authorization: statusAuth },
        });

        if (!statusRes.ok) {
          const errText = await statusRes.text();
          console.error("Twitter media STATUS check failed:", statusRes.status, errText);
          return null;
        }

        const statusData = await statusRes.json();
        processingInfo = statusData.processing_info;
      }
      console.log("Twitter media processing complete");
    }

    // Step 5: Create tweet with the video
    const tweetUrl = "https://api.x.com/2/tweets";
    const tweetText = title.length > 280 ? title.substring(0, 277) + "..." : title;

    const tweetBody = JSON.stringify({
      text: tweetText,
      media: { media_ids: [mediaId] },
    });

    // For v2 JSON endpoints, do NOT include body params in OAuth signature
    const tweetAuth = await buildOAuthHeader("POST", tweetUrl, consumerKey, consumerSecret, access_token, access_token_secret);

    const tweetRes = await fetch(tweetUrl, {
      method: "POST",
      headers: {
        Authorization: tweetAuth,
        "Content-Type": "application/json",
      },
      body: tweetBody,
    });

    if (!tweetRes.ok) {
      const errText = await tweetRes.text();
      console.error("Twitter tweet creation failed:", tweetRes.status, errText);
      return null;
    }

    const tweetData = await tweetRes.json();
    const tweetId = tweetData.data?.id;
    console.log("Twitter tweet posted! ID:", tweetId);

    return { id: tweetId };
  }
}

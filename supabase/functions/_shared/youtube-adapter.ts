import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";
import { matchAccountByCityName } from "./city-accounts.ts";
import { buildRotatingTags as _buildRotatingTagsSync } from "./post-variety.ts";

type ResolvedYTAccount = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  account_name?: string | null;
  city_id?: string | null;
  account_external_id?: string | null;
  oauth_project?: "A" | "B" | null;
};

export type YouTubeContentType = "short" | "recap";

/** Phase 12E: route content type to OAuth Project.
 *  Shorts → Project A (existing client). Recaps (daily/weekly/monthly/yearly)
 *  → Project B (dedicated client) for quota isolation. */
export function projectForContentType(t?: YouTubeContentType): "A" | "B" {
  return t === "recap" ? "B" : "A";
}

/** Resolves the YOUTUBE_CLIENT_ID/SECRET pair to use for a given OAuth project.
 *  Project B credentials are required when t==='recap'; absence is a hard error
 *  (we never silently fall back to Project A — that would burn shorts quota). */
export function getYouTubeOAuthCreds(project: "A" | "B"): { id: string | null; secret: string | null } {
  if (project === "B") {
    return {
      id: Deno.env.get("YOUTUBE_CLIENT_ID_RECAPS") || null,
      secret: Deno.env.get("YOUTUBE_CLIENT_SECRET_RECAPS") || null,
    };
  }
  return {
    id: Deno.env.get("YOUTUBE_CLIENT_ID") || null,
    secret: Deno.env.get("YOUTUBE_CLIENT_SECRET") || null,
  };
}

export class YouTubeAdapter implements PlatformAdapter {
  name = "youtube";

  /** Side-channel cache so uploadVideo() can recover the channel that
   *  getValidToken() actually selected for this user+city combination. */
  private _resolved: Map<string, ResolvedYTAccount> = new Map();

  /** Refresh-context cache: token → everything we need to mint a NEW token
   *  if YouTube returns 401 mid-upload. Populated by getValidToken(),
   *  consumed by uploadVideo()'s 401 self-heal path. */
  private _refreshCtx: Map<string, { supabase: any; userId: string; cityId: string | null; contentType: YouTubeContentType }> = new Map();

  private _resolvedKey(userId: string, cityId?: string | null) {
    return `${userId}::${cityId ?? "shared"}`;
  }

  isConnected(settings: Record<string, unknown>): boolean {
    const expiresAt = settings.youtube_token_expires_at
      ? new Date(String(settings.youtube_token_expires_at)).getTime()
      : 0;
    const hasUsableAccessToken = !!settings.youtube_access_token && expiresAt > Date.now() + 5 * 60 * 1000;
    return hasUsableAccessToken || !!settings.youtube_refresh_token;
  }

  async getValidToken(
    supabase: any,
    userId: string,
    cityId?: string | null,
    opts?: { contentType?: YouTubeContentType },
  ): Promise<string | null> {
    const contentType: YouTubeContentType = opts?.contentType ?? "short";
    const project = projectForContentType(contentType);
    const { id: clientId, secret: clientSecret } = getYouTubeOAuthCreds(project);

    // Hard guard: Project B is recap-only. If recap credentials aren't
    // configured we MUST fail loudly — silently falling back to Project A
    // would burn the daily shorts upload quota.
    if (project === "B" && (!clientId || !clientSecret)) {
      console.error("[youtube-adapter] Project B credentials missing (YOUTUBE_CLIENT_ID_RECAPS / YOUTUBE_CLIENT_SECRET_RECAPS)");
      throw new Error("[OAUTH_PROJECT_B_NOT_CONFIGURED] Recap OAuth client not configured — add YOUTUBE_CLIENT_ID_RECAPS + YOUTUBE_CLIENT_SECRET_RECAPS secrets.");
    }

    // ---- Resolve which YouTube channel (social_accounts row) to use ----
    // Channels are partitioned by oauth_project so a single user can have
    // a Project A channel (shorts) and a Project B channel (recaps) for
    // the same city without collision.
    let account: ResolvedYTAccount | null = null;

    const { data: allChannels } = await supabase
      .from("social_accounts")
      .select("id, access_token, refresh_token, token_expires_at, account_name, city_id, account_external_id, oauth_project")
      .eq("user_id", userId)
      .eq("platform", "youtube")
      .eq("oauth_project", project);
    const channels = (allChannels || []) as ResolvedYTAccount[];

    if (cityId) {
      account = channels.find((c) => c.city_id === cityId) || null;
    }

    // STRICT routing: when a cityId is supplied and the user has ANY
    // channels in this project, require an explicit per-city mapping.
    if (!account && cityId && channels.length >= 1) {
      let cityName: string | null = null;
      try {
        const { data: cityRow } = await supabase
          .from("cities")
          .select("name")
          .eq("id", cityId)
          .maybeSingle();
        cityName = cityRow?.name ?? null;
      } catch (_) { /* ignore */ }
      const nameMatch = matchAccountByCityName(channels as any[], cityName);
      if (nameMatch) {
        console.log(
          `[routing] city_id lookup failed, falling back to city name match (project=${project}, cityId=${cityId}, cityName=${cityName}, matched=${(nameMatch as any).account_name})`,
        );
        account = nameMatch as ResolvedYTAccount;
      } else {
        const names = channels.map((c) => c.account_name || "channel").join(", ");
        console.error(`[routing] ROUTING_VIOLATION project=${project} no YouTube channel for city_id=${cityId} (cityName=${cityName})`);
        throw new Error(
          `[ROUTING_VIOLATION] No YouTube ${project === "B" ? "recap" : "shorts"} channel mapped to city_id=${cityId}. Open Settings → City → Account Routing and assign one of your connected ${project === "B" ? "recap" : "shorts"} channels (${names}) to this city.`,
        );
      }
    }

    if (!account) {
      account = channels.find((c) => c.city_id == null) || channels[0] || null;
    }

    if (account) {
      console.log(
        `[youtube-adapter] project=${project} contentType=${contentType} using channel "${account.account_name || account.id}" (city_id=${account.city_id ?? "shared"}) for cityId=${cityId ?? "none"}`,
      );
    }

    // Legacy weather_settings fallback — ONLY for Project A (shorts).
    // Project B (recaps) must never fall back to legacy columns; those
    // tokens were minted by Project A and would cause a routing violation.
    if (!account && project === "A") {
      const { data: settings } = await supabase
        .from("weather_settings")
        .select("youtube_access_token, youtube_refresh_token, youtube_token_expires_at")
        .eq("user_id", userId)
        .single();
      if (!settings?.youtube_access_token && !settings?.youtube_refresh_token) return null;
      account = {
        id: "",
        access_token: settings.youtube_access_token,
        refresh_token: settings.youtube_refresh_token,
        token_expires_at: settings.youtube_token_expires_at,
        oauth_project: "A",
      };
    }

    if (!account) {
      if (project === "B") {
        console.error(`[youtube-adapter] No Project B (recap) channel connected for user=${userId}`);
        throw new Error("[AUTH_EXPIRED:youtube_recap] No Project B recap channel connected — user must connect a YouTube channel under 'Connect Recaps Channel'.");
      }
      return null;
    }

    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at) : null;
    if (account.access_token && expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      this._resolved.set(account.access_token, account);
      this._refreshCtx.set(account.access_token, { supabase, userId, cityId: cityId ?? null, contentType });
      return account.access_token;
    }

    if (!account.refresh_token) {
      console.error("[youtube-auth] No YouTube refresh token available — user must reconnect");
      return null;
    }
    if (!clientId || !clientSecret) {
      console.error(`[youtube-auth] YouTube Project ${project} client credentials not configured`);
      return null;
    }

    const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
      }),
    });

    const refreshData = await refreshRes.json();
    if (!refreshData.access_token) {
      console.error(`[youtube-auth] YouTube Project ${project} token refresh failed:`, JSON.stringify(refreshData));
      const errorCode = (refreshData?.error || "").toString();
      if (errorCode === "invalid_grant" || errorCode === "invalid_token") {
        if (account.id) {
          await supabase
            .from("social_accounts")
            .update({ refresh_token: null, access_token: null })
            .eq("id", account.id);
        } else if (project === "A") {
          await supabase
            .from("weather_settings")
            .update({ youtube_refresh_token: null })
            .eq("user_id", userId);
        }
        console.warn("[youtube-auth] refresh_token invalidated — reconnect required");
      }
      return null;
    }

    const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

    if (account.id) {
      // Merge health stamp into extra without clobbering other fields
      const { data: existing } = await supabase
        .from("social_accounts")
        .select("extra")
        .eq("id", account.id)
        .maybeSingle();
      const prevExtra = (existing?.extra ?? {}) as Record<string, unknown>;
      const prevHealth =
        typeof prevExtra.health === "object" && prevExtra.health
          ? (prevExtra.health as Record<string, unknown>)
          : {};
      const mergedExtra = {
        ...prevExtra,
        health: {
          ...prevHealth,
          status: "healthy",
          refresh: "succeeded",
          checked_at: new Date().toISOString(),
        },
      };
      await supabase
        .from("social_accounts")
        .update({
          access_token: refreshData.access_token,
          token_expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
          extra: mergedExtra,
        })
        .eq("id", account.id);
    } else if (project === "A") {
      await supabase
        .from("weather_settings")
        .update({
          youtube_access_token: refreshData.access_token,
          youtube_token_expires_at: newExpiresAt,
        })
        .eq("user_id", userId);
    }

    console.log(`[youtube-auth] Project ${project} token refreshed successfully`);
    const refreshedAccount = { ...account, access_token: refreshData.access_token, token_expires_at: newExpiresAt };
    this._resolved.set(refreshData.access_token, refreshedAccount);
    this._refreshCtx.set(refreshData.access_token, { supabase, userId, cityId: cityId ?? null, contentType });
    return refreshData.access_token;
  }

  /** Force a fresh access_token by re-running the refresh path. Used by
   *  the 401 self-heal in uploadVideo(). Returns null if reconnect needed. */
  private async _forceRefresh(oldToken: string): Promise<string | null> {
    const ctx = this._refreshCtx.get(oldToken);
    if (!ctx) {
      console.warn("[youtube-auth] _forceRefresh: no refresh context for token");
      return null;
    }
    const cached = this._resolved.get(oldToken);
    if (cached) {
      this._resolved.set(oldToken, { ...cached, token_expires_at: new Date(0).toISOString() });
    }
    const fresh = await this.getValidToken(ctx.supabase, ctx.userId, ctx.cityId, { contentType: ctx.contentType });
    if (fresh && fresh !== oldToken) {
      console.log("[youtube-auth] 401 self-heal: minted new access_token");
    }
    return fresh;
  }

  async uploadVideo(
    accessToken: string,
    videoData: Uint8Array,
    title: string,
    description: string,
    mimeType = "video/mp4",
    _cityId?: string | null,
    cityName?: string | null,
  ): Promise<UploadResult | null> {
    // Belt-and-suspenders: even though postToPlatform already strips internal
    // tracking tags like [auto:afternoon] / [exp:B] / [ab:variant_a], a few
    // legacy callers and self-heal paths reached this adapter with raw values,
    // leaking system metadata into public YouTube titles, descriptions, AND
    // pinned comments (real incident: external_id 914CxaWpKfc had
    // "📍 Gainesville · Afternoon Update [auto:afternoon] [exp:B]" visible to
    // viewers). Strip again here so NOTHING with those tokens reaches YouTube.
    const INTERNAL_TAG_RE = /\s*\[(?:auto|manual|exp|ab|variant|debug|test|pipeline|engine|voice|render|src|timing):[^\]]*\]\s*/gi;
    const stripInternal = (s: string) =>
      (s || "").replace(INTERNAL_TAG_RE, " ").replace(/[ \t]{2,}/g, " ").replace(/\s+\n/g, "\n").trim();
    title = stripInternal(title);
    description = stripInternal(description);

    const shortTitle = appendTitleHashtags(title);


    // Recover the channel that getValidToken() actually selected so we can
    // build a CTA / subscribe URL that points to the RIGHT channel (not a
    // hardcoded Gainesville one). Falls back to title-derived city if the
    // cache miss for any reason.
    const resolved = this._resolved.get(accessToken) || null;

    // City resolution priority for CTA/LIKE copy:
    //   1. Explicit cityName passed by caller (most trustworthy)
    //   2. City extracted from the title (legacy behavior)
    //   3. "your area" generic fallback
    const explicitCity = (cityName || "").trim();
    const extractedCity = extractCityFromTitle(title);
    const titleCity = explicitCity || extractedCity || "your area";
    const cityForLike = titleCity;

    // Build a valid subscribe URL. Three-tier resolver — never fabricate
    // handles from display names or city titles (that produced "@Sky?..." bugs):
    //   a. account_name only if it looks like a real YouTube handle (no spaces).
    //   b. account_external_id (channel ID, UCxxxx — always valid).
    //   c. Generic CTA with no URL.
    const subscribeUrl = (() => {
      const raw = (resolved?.account_name || "").trim();
      // A real handle: 3–30 chars, alnum + . _ -, no spaces. Strip leading @.
      const handleCandidate = raw.replace(/^@/, "");
      if (/^[A-Za-z0-9_.\-]{3,30}$/.test(handleCandidate) && !/\s/.test(raw)) {
        return `https://www.youtube.com/@${handleCandidate}?sub_confirmation=1`;
      }
      const extId = (resolved?.account_external_id || "").trim();
      if (/^UC[A-Za-z0-9_-]{20,24}$/.test(extId)) {
        return `https://www.youtube.com/channel/${extId}?sub_confirmation=1`;
      }
      return null;
    })();

    const YT_CTA = subscribeUrl
      ? `👉 Subscribe and turn on notifications for daily ${titleCity} weather alerts: ${subscribeUrl} 🔔`
      : `👉 Subscribe and turn on notifications for daily ${titleCity} weather alerts 🔔`;

    // LIKE prompt — validated to ensure the interpolated city is real.
    // If cityForLike is the generic fallback or contains a banned token,
    // fall back to a generic line with no location reference.
    const BAD_LIKE_TOKENS = /\b(weather update|clear skies|coming up|but comfortable|your area)\b/i;
    const YT_LIKE_PROMPT = (cityForLike === "your area" || BAD_LIKE_TOKENS.test(cityForLike))
      ? `👍 Smash the LIKE button if you're enjoying today's weather forecast!`
      : `👍 Smash the LIKE button if you're enjoying the weather in ${cityForLike}!`;
    let baseDescription = (description || "").trimEnd();
    // Strip any previously-prepended LIKE prompt so we don't stack them.
    baseDescription = baseDescription
      .replace(/^👍[^\n]*\n+/u, "")
      .trimStart();
    // Strip ANY previously-appended subscribe CTA (any @handle, including the
    // legacy hardcoded @SkyBriefGNV) so we always end with the current,
    // correctly-routed CTA.
    baseDescription = baseDescription
      .replace(/\n*👉[^\n]*sub_confirmation=1[^\n]*$/u, "")
      .replace(/\n*👉[^\n]*subscribe[^\n]*$/iu, "")
      .trimEnd();
    // Strip any previously-appended hashtag block so we never stack duplicates.
    baseDescription = baseDescription
      .replace(/\n+#[A-Za-z0-9]+(?:\s+#[A-Za-z0-9]+)*\s*$/u, "")
      .trimEnd();
    const hashtagBlock = buildDescriptionHashtags(title, baseDescription);
    const finalDescription = `${YT_LIKE_PROMPT}\n\n${baseDescription}\n\n${YT_CTA}\n\n${hashtagBlock}`;
    // YouTube caps description at 5000 chars.
    const safeDescription = finalDescription.length > 5000
      ? finalDescription.substring(0, 5000)
      : finalDescription;

    console.log(
      `Uploading to YouTube Shorts: ${shortTitle} (${videoData.byteLength} bytes)`,
    );

    // Wrap the init in a one-shot 401 self-heal: if the access_token is
    // somehow stale (e.g. revoked between getValidToken() and now), force
    // a refresh via _forceRefresh() and retry the init exactly once.
    let activeToken = accessToken;
    const doInit = (tok: string) => fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tok}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": mimeType,
          "X-Upload-Content-Length": String(videoData.byteLength),
        },
        body: JSON.stringify({
          snippet: {
            title: shortTitle,
            description: safeDescription,
            categoryId: "22",
            tags: buildYouTubeTags(shortTitle, safeDescription),
          },
          status: {
            privacyStatus: "public",
            selfDeclaredMadeForKids: false,
          },
        }),
      },
    );

    let initRes = await doInit(activeToken);

    if (initRes.status === 401) {
      console.warn("[youtube-auth] upload init returned 401 — attempting one-shot token refresh + retry");
      const fresh = await this._forceRefresh(activeToken);
      if (fresh) {
        activeToken = fresh;
        initRes = await doInit(activeToken);
        if (initRes.ok) {
          console.log("[youtube-auth] 401 self-heal succeeded — upload init retried with refreshed token");
        }
      }
    }

    if (!initRes.ok) {
      const errText = await initRes.text();
      console.error("YouTube upload init failed:", initRes.status, errText);
      try {
        const errJson = JSON.parse(errText);
        const reason = errJson?.error?.errors?.[0]?.reason;
        if (reason === "uploadLimitExceeded") {
          throw new Error("YouTube daily upload limit reached. Please wait 24 hours or request a quota increase in Google Cloud Console.");
        }
        throw new Error(errJson?.error?.message || "YouTube upload initialization failed");
      } catch (e) {
        if (e instanceof Error && e.message.includes("YouTube")) throw e;
        throw new Error(`YouTube upload init failed (${initRes.status})`);
      }
    }

    const uploadUrl = initRes.headers.get("Location");
    if (!uploadUrl) {
      console.error("No upload URL returned from YouTube");
      return null;
    }

    const uploadRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
        "Content-Length": String(videoData.byteLength),
      },
      body: videoData,
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error("YouTube video upload failed:", uploadRes.status, errText);
      try {
        const errJson = JSON.parse(errText);
        const reason = errJson?.error?.errors?.[0]?.reason;
        const message = errJson?.error?.message || "Video processing failed";
        if (reason === "processingFailure") {
          throw new Error(`YouTube rejected the video: processing failure. The video format or codec may be unsupported.`);
        }
        if (reason === "videoTooLong") {
          throw new Error("YouTube rejected the video: video exceeds maximum duration for Shorts (60s).");
        }
        if (reason === "invalidVideoMetadata") {
          throw new Error("YouTube rejected the video: invalid metadata. Check title and description length.");
        }
        throw new Error(`YouTube upload failed: ${message} (${reason || uploadRes.status})`);
      } catch (e) {
        if (e instanceof Error && e.message.includes("YouTube")) throw e;
        throw new Error(`YouTube upload failed with status ${uploadRes.status}`);
      }
    }

    // === Verbose response logging — surfaces silent 200-without-id failures ===
    const rawBody = await uploadRes.text();
    let result: any = {};
    try { result = rawBody ? JSON.parse(rawBody) : {}; } catch { result = { _raw: rawBody }; }
    console.log("[YT] upload status:", uploadRes.status, uploadRes.statusText);
    console.log("[YT] full response body:", JSON.stringify(result));
    if (result?.id) {
      console.log(`✅ YouTube Upload Success! Video ID: ${result.id}`);
    } else {
      console.error(`❌ YouTube API returned ${uploadRes.status} but no Video ID found. Full Response: ${JSON.stringify(result)}`);
      throw new Error(`YouTube upload returned no video ID: ${JSON.stringify(result).slice(0, 500)}`);
    }

    // === AUTOMATED PINNED / FIRST COMMENT (per-city opt-in) ===
    // Posts a top-level comment as the channel owner (auto-highlighted at top
    // of the Shorts comment thread — YouTube Data API v3 has NO public
    // endpoint to programmatically pin, so this is the closest equivalent).
    // Gated by automations.pinned_comment_enabled per (user, city). Custom
    // text from automations.pinned_comment_text overrides the default.
    let pinnedCommentId: string | null = null;
    try {
      const ctx = this._refreshCtx.get(activeToken) || this._refreshCtx.get(accessToken);
      let enabled = false;
      let customText: string | null = null;
      if (ctx?.supabase && ctx.userId && ctx.cityId) {
        const { data: auto } = await ctx.supabase
          .from("automations")
          .select("pinned_comment_enabled, pinned_comment_text")
          .eq("user_id", ctx.userId)
          .eq("city_id", ctx.cityId)
          .maybeSingle();
        enabled = !!auto?.pinned_comment_enabled;
        customText = auto?.pinned_comment_text ?? null;
      }

      if (enabled) {
        const cityForComment = explicitCity || extractCityFromTitle(title) || "your area";
        const defaultText = (cityForComment === "your area")
          ? `📍 What's the weather like where you are right now? Drop your city + current conditions below! ⬇️ 🌤️`
          : `📍 What's the weather like where you are right now? Drop your city + current conditions below! ⬇️ 🌤️`;
        const commentText = (customText && customText.trim().length > 0)
          ? customText.replace(/\{city\}/gi, cityForComment).slice(0, 9000)
          : defaultText;

        const commentRes = await fetch(
          "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${activeToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              snippet: {
                videoId: result.id,
                topLevelComment: {
                  snippet: { textOriginal: commentText },
                },
              },
            }),
          },
        );
        if (commentRes.ok) {
          try {
            const body = await commentRes.json();
            pinnedCommentId = body?.snippet?.topLevelComment?.id || body?.id || null;
          } catch { /* ignore parse error */ }
          console.log(`YouTube pinned-comment posted on ${result.id} (commentId=${pinnedCommentId ?? "?"})`);
        } else {
          const errText = await commentRes.text().catch(() => "");
          console.warn(`YouTube pinned-comment failed (${commentRes.status}): ${errText.slice(0, 200)}`);
        }
      } else {
        console.log(`[youtube-adapter] pinned comment disabled for user=${ctx?.userId ?? "?"} city=${ctx?.cityId ?? "?"} — skipping`);
      }
    } catch (e) {
      console.warn("YouTube pinned-comment error:", (e as Error).message);
    }

    return {
      id: result.id,
      resolved_city_id: resolved?.city_id ?? null,
      account_name: resolved?.account_name ?? null,
      pinned_comment_id: pinnedCommentId,
    };
  }
}

// --- Dynamic YouTube tag builder (SEO-optimized for Shorts discovery) ---
// Tags are derived from title + description text so we don't need to change
// the PlatformAdapter signature or any caller in the posting pipeline.
// Phase 13C: now delegates to shared buildRotatingTags so manual + auto
// posts share one anti-repetition pool. The legacy in-file generator had a
// city-extraction bug that produced the duplicate-token tag
// "gainesville weather weather" (and the same on Orlando) — fixed here by
// reusing the canonical city derived from settings rather than re-extracting
// from the title.
function buildYouTubeTags(title: string, description: string): string[] {
  const text = `${title}\n${description}`.toLowerCase();
  const hour = new Date().getHours();

  // City extraction from hook title (city is always present, properly cased).
  // Phase 13C bug #1 fix: never consume a second word that is itself a
  // common weather noun — otherwise "Gainesville Weather …" gets captured
  // as a 2-word "city" and the next step emits "gainesville weather weather".
  const skipWords = new Set(["good", "hot", "cold", "cool", "warm", "rain", "storms", "storm",
    "bundle", "calm", "cloudy", "foggy", "grab", "gray", "heads", "tonight",
    "today", "beautiful", "feels", "you", "wet", "snowy", "drive", "crank",
    "chilly", "mild", "sun", "sunny", "tonights", "afternoon", "morning", "evening"]);
  const secondWordBlocklist = new Set([
    "weather", "update", "forecast", "today", "tonight", "morning",
    "afternoon", "evening", "shorts", "now", "alert", "alerts", "skies",
    "outlook", "watch", "warning",
  ]);
  let city = "";
  const matches = title.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g) || [];
  for (const m of matches) {
    const parts = m.split(" ");
    const first = parts[0].toLowerCase();
    if (skipWords.has(first)) continue;
    if (parts.length === 2 && secondWordBlocklist.has(parts[1].toLowerCase())) {
      city = parts[0];
    } else {
      city = m;
    }
    break;
  }

  // Detect slot from hour and rotate via shared helper.
  const slot = hour >= 4 && hour < 11 ? "morning"
             : hour >= 11 && hour < 17 ? "afternoon"
             : "evening";

  // Pull dominant condition from text for the rotation pool.
  let cond = "";
  if (/storm|⛈|thunder|tornado|hurricane/.test(text)) cond = "storm";
  else if (/rain|🌧|☔|drizzle|shower/.test(text)) cond = "rain";
  else if (/snow|❄️|sleet|blizzard/.test(text)) cond = "snow";
  else if (/fog|🌫|mist|haze/.test(text)) cond = "fog";
  else if (/cloud|☁️|🌤|gray skies|overcast/.test(text)) cond = "cloudy";
  else if (/clear|☀️|sunny|beautiful/.test(text)) cond = "sunny";

  const tempMatch = title.match(/(\d{1,3})°/);
  const temp = tempMatch ? parseInt(tempMatch[1], 10) : null;

  const isFlorida = /gainesville|florida|miami|orlando|tampa|jacksonville|tallahassee|ocala/
    .test(text);

  // Lazy import (sync) of the shared helper via dynamic call — file lives
  // alongside us so this is a static relative path.
  const out = _buildRotatingTagsSync({
    city: city || "Local",
    state: isFlorida ? "Florida" : null,
    slot,
    condition: cond,
    highTemp: temp,
  });

  // Belt-and-suspenders: dedupe, cap at 480 chars to respect YouTube limit.
  const seen = new Set<string>();
  const final: string[] = [];
  let charCount = 0;
  const MAX_CHARS = 480;
  for (const tag of out) {
    const t = tag.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    if (/\b(\w+)\b\s+\b\1\b/i.test(t)) continue; // never let dup-tokens slip through
    const cost = t.length + (t.includes(" ") ? 4 : 2);
    if (charCount + cost > MAX_CHARS) break;
    seen.add(t.toLowerCase());
    final.push(t);
    charCount += cost;
    if (final.length >= 14) break;
  }
  return final;
}





// --- City extraction helper (shared by title + description hashtags) ---
const TITLE_SKIP_WORDS = new Set([
  "good", "hot", "cold", "cool", "warm", "rain", "storms", "storm",
  "bundle", "calm", "cloudy", "foggy", "grab", "gray", "heads", "tonight",
  "today", "beautiful", "feels", "you", "wet", "snowy", "drive", "crank",
  "chilly", "mild", "sun", "sunny", "tonights", "afternoon", "morning", "evening",
  "don't", "dont", "wake", "rise", "shine",
  // Phase 1 emergency: hallucinated location proxies must never be treated as cities.
  "weather", "update", "clear", "skies", "coming", "up", "but", "comfortable",
  "not", "need", "ahead", "outside", "today's", "todays", "tonight's",
  "your", "area", "alerts", "alert", "forecast", "live", "live!", "now",
]);

function extractCityFromTitle(title: string): string {
  const matches = title.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g) || [];
  for (const m of matches) {
    const first = m.split(" ")[0].toLowerCase();
    if (!TITLE_SKIP_WORDS.has(first)) return m;
  }
  return "";
}

// --- Title hashtag suffix ---
// Appends exactly two hashtags ("#<City> #Shorts") to the end of the title.
// If the resulting title would exceed YouTube's 100-char limit, the weather
// detail text in the original title is trimmed first so the hashtags ALWAYS
// fit. The leading hook is preserved at all costs.
function appendTitleHashtags(rawTitle: string): string {
  const MAX = 100;
  const city = extractCityFromTitle(rawTitle).replace(/\s+/g, "") || "Weather";
  const suffix = ` #${city} #Shorts`;

  // Strip any pre-existing trailing hashtags so we don't double up.
  let core = rawTitle.replace(/(?:\s+#[A-Za-z0-9]+){1,4}\s*$/u, "").trim();

  const budget = MAX - suffix.length;
  if (core.length > budget) {
    const cut = budget - 1; // leave room for "…"
    core = core.substring(0, Math.max(0, cut)).trimEnd() + "…";
  }
  const out = `${core}${suffix}`;
  return out.length > MAX ? out.substring(0, MAX) : out;
}

// --- Description hashtag block ---
// Aggressive hashtag block appended to the description for SEO.
// Format: #<City>Weather #<Condition> #FloridaWeather #WeatherUpdate #DailyShorts
function buildDescriptionHashtags(title: string, description: string): string {
  const text = `${title}\n${description}`.toLowerCase();
  const city = extractCityFromTitle(title).replace(/\s+/g, "");
  const isFlorida = /gainesville|florida|miami|orlando|tampa|jacksonville|tallahassee|ocala/
    .test(text);

  // Pick a single dominant condition hashtag
  let condition = "Weather";
  if (/storm|⛈|thunder|tornado|hurricane/.test(text)) condition = "Storm";
  else if (/rain|🌧|☔|drizzle|shower/.test(text)) condition = "Rain";
  else if (/snow|❄️|sleet|blizzard/.test(text)) condition = "Snow";
  else if (/fog|🌫|mist|haze/.test(text)) condition = "Fog";
  else if (/heat wave|🔥|hot weather|🌞/.test(text) || /\b(8[5-9]|9\d|1\d{2})°/.test(title)) condition = "HeatWave";
  else if (/cold front|🥶|chilly|🧥/.test(text)) condition = "ColdFront";
  else if (/cloud|☁️|🌤|gray skies|overcast/.test(text)) condition = "Cloudy";
  else if (/clear|☀️|sunny|beautiful/.test(text)) condition = "Sunny";

  const tags: string[] = [];
  if (city) tags.push(`#${city}Weather`);
  tags.push(`#${condition}`);
  if (isFlorida) tags.push("#FloridaWeather");
  tags.push("#WeatherUpdate", "#DailyShorts");

  const seen = new Set<string>();
  return tags.filter(t => {
    const k = t.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).join(" ");
}

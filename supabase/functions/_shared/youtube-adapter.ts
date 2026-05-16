import type { PlatformAdapter, UploadResult } from "./platform-adapter.ts";

type ResolvedYTAccount = {
  id: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  account_name?: string | null;
  city_id?: string | null;
  account_external_id?: string | null;
};

export class YouTubeAdapter implements PlatformAdapter {
  name = "youtube";

  /** Side-channel cache so uploadVideo() can recover the channel that
   *  getValidToken() actually selected for this user+city combination. */
  private _resolved: Map<string, ResolvedYTAccount> = new Map();

  /** Refresh-context cache: token → everything we need to mint a NEW token
   *  if YouTube returns 401 mid-upload. Populated by getValidToken(),
   *  consumed by uploadVideo()'s 401 self-heal path. */
  private _refreshCtx: Map<string, { supabase: any; userId: string; cityId: string | null }> = new Map();

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

  async getValidToken(supabase: any, userId: string, cityId?: string | null): Promise<string | null> {
    const clientId = Deno.env.get("YOUTUBE_CLIENT_ID");
    const clientSecret = Deno.env.get("YOUTUBE_CLIENT_SECRET");

    // ---- Resolve which YouTube channel (social_accounts row) to use ----
    // 1. If a cityId is given, prefer the row assigned to that city.
    // 2. Otherwise (or if no city-specific row exists), use a row with
    //    city_id IS NULL (shared). If multiple shared rows exist, take the
    //    most recently updated one — preserves single-channel behavior.
    let account: ResolvedYTAccount | null = null;

    // Inventory all YouTube channels for this user so we can enforce strict
    // city→channel routing when multiple channels are connected.
    const { data: allChannels } = await supabase
      .from("social_accounts")
      .select("id, access_token, refresh_token, token_expires_at, account_name, city_id, account_external_id")
      .eq("user_id", userId)
      .eq("platform", "youtube");
    const channels = allChannels || [];

    if (cityId) {
      account = channels.find((c: any) => c.city_id === cityId) || null;
    }

    // STRICT routing: when a cityId is supplied and the user has ANY connected
    // channels, we require an explicit per-city mapping. Falling back to a
    // shared/legacy channel is exactly how Gainesville posts ended up on the
    // Orlando channel.
    if (!account && cityId && channels.length >= 1) {
      const names = channels.map((c: any) => c.account_name || "channel").join(", ");
      throw new Error(
        `[ROUTING_VIOLATION] No YouTube channel mapped to city_id=${cityId}. Open Settings → City → Account Routing and assign one of your connected channels (${names}) to this city.`,
      );
    }

    if (!account) {
      // No cityId context: legacy single-channel behavior — use shared row.
      account = channels.find((c: any) => c.city_id == null) || channels[0] || null;
    }

    if (account) {
      console.log(
        `[youtube-adapter] using channel "${account.account_name || account.id}" (city_id=${account.city_id ?? "shared"}) for cityId=${cityId ?? "none"}`,
      );
    }

    // Final fallback to legacy weather_settings columns (oldest single-channel install).
    if (!account) {
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
      };
    }

    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at) : null;
    if (account.access_token && expiresAt && expiresAt.getTime() > Date.now() + 5 * 60 * 1000) {
      this._resolved.set(account.access_token, account);
      this._refreshCtx.set(account.access_token, { supabase, userId, cityId: cityId ?? null });
      return account.access_token;
    }

    if (!account.refresh_token) {
      console.error("[youtube-auth] No YouTube refresh token available — user must reconnect");
      return null;
    }
    if (!clientId || !clientSecret) {
      console.error("[youtube-auth] YouTube client credentials not configured");
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
      console.error("[youtube-auth] YouTube token refresh failed:", JSON.stringify(refreshData));
      const errorCode = (refreshData?.error || "").toString();
      // Only clear refresh_token on TERMINAL errors (Google says the grant is
      // permanently invalid). Treat anything else as transient — do NOT wipe
      // the refresh_token, so the next attempt can succeed once Google
      // recovers / rate-limit clears.
      if (errorCode === "invalid_grant" || errorCode === "invalid_token") {
        if (account.id) {
          await supabase
            .from("social_accounts")
            .update({ refresh_token: null, access_token: null })
            .eq("id", account.id);
        } else {
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
      await supabase
        .from("social_accounts")
        .update({
          access_token: refreshData.access_token,
          token_expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", account.id);
    } else {
      // Legacy fallback path: also keep weather_settings warm.
      await supabase
        .from("weather_settings")
        .update({
          youtube_access_token: refreshData.access_token,
          youtube_token_expires_at: newExpiresAt,
        })
        .eq("user_id", userId);
    }

    console.log("[youtube-auth] token refreshed successfully");
    const refreshedAccount = { ...account, access_token: refreshData.access_token, token_expires_at: newExpiresAt };
    this._resolved.set(refreshData.access_token, refreshedAccount);
    this._refreshCtx.set(refreshData.access_token, { supabase, userId, cityId: cityId ?? null });
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
    // Invalidate cached row so getValidToken treats it as expired.
    const cached = this._resolved.get(oldToken);
    if (cached) {
      this._resolved.set(oldToken, { ...cached, token_expires_at: new Date(0).toISOString() });
    }
    const fresh = await this.getValidToken(ctx.supabase, ctx.userId, ctx.cityId);
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
  ): Promise<UploadResult | null> {
    const shortTitle = appendTitleHashtags(title);

    // Recover the channel that getValidToken() actually selected so we can
    // build a CTA / subscribe URL that points to the RIGHT channel (not a
    // hardcoded Gainesville one). Falls back to title-derived city if the
    // cache miss for any reason.
    const resolved = this._resolved.get(accessToken) || null;

    const titleCity = extractCityFromTitle(title) || "your area";
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

    const YT_LIKE_PROMPT = `👍 Smash the LIKE button if you're enjoying the weather in ${cityForLike}!`;
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

    // === AUTOMATED FIRST COMMENT ===
    // Posts a top-level comment on the freshly-uploaded Short. YouTube's API
    // does NOT expose programmatic pinning, so creators may want to manually
    // pin this from YouTube Studio. We post regardless so the prompt exists.
    try {
      const cityForComment = extractCityFromTitle(title) || "your area";
      const commentText = `🔔 Subscribe for daily ${cityForComment} weather! What's the weather like where you are today?`;
      const commentRes = await fetch(
        "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
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
        console.log(`YouTube first-comment posted on ${result.id}`);
      } else {
        const errText = await commentRes.text().catch(() => "");
        console.warn(`YouTube first-comment failed (${commentRes.status}): ${errText.slice(0, 200)}`);
      }
    } catch (e) {
      console.warn("YouTube first-comment error:", (e as Error).message);
    }

    return {
      id: result.id,
      resolved_city_id: resolved?.city_id ?? null,
      account_name: resolved?.account_name ?? null,
    };
  }
}

// --- Dynamic YouTube tag builder (SEO-optimized for Shorts discovery) ---
// Tags are derived from title + description text so we don't need to change
// the PlatformAdapter signature or any caller in the posting pipeline.
// Strategy: evergreen base tags + city + regional + condition + time-of-day,
// targeting 15–20 tags within YouTube's 500-char combined limit.
function buildYouTubeTags(title: string, description: string): string[] {
  const text = `${title}\n${description}`.toLowerCase();
  const hour = new Date().getHours();

  // City extraction from hook title (city is always present, properly cased).
  const skipWords = new Set(["good", "hot", "cold", "cool", "warm", "rain", "storms", "storm",
    "bundle", "calm", "cloudy", "foggy", "grab", "gray", "heads", "tonight",
    "today", "beautiful", "feels", "you", "wet", "snowy", "drive", "crank",
    "chilly", "mild", "sun", "sunny", "tonights", "afternoon", "morning", "evening"]);
  let city = "";
  const matches = title.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g) || [];
  for (const m of matches) {
    const first = m.split(" ")[0].toLowerCase();
    if (!skipWords.has(first)) { city = m; break; }
  }
  const cityLc = city.toLowerCase();

  // Detect region (Florida default for SkyBriefGNV and FL cities)
  const isFlorida = /gainesville|florida|miami|orlando|tampa|jacksonville|tallahassee|ocala/
    .test(text);

  // 1. Base tags — always include
  const base: string[] = [
    "weather update",
    "daily forecast",
    "weather shorts",
    "local weather",
    "#Shorts",
  ];
  if (cityLc) {
    base.unshift(`${cityLc} weather`);
    if (isFlorida) base.unshift(`${cityLc} florida`);
  }
  if (isFlorida) base.push("florida weather today");

  // 2. Condition tags
  const cond: string[] = [];
  if (/clear|☀️|sunny|beautiful/.test(text)) {
    cond.push("sunny weather", "clear skies", "beautiful day");
  }
  if (/cloud|☁️|🌤|gray skies|overcast/.test(text)) {
    cond.push("cloudy forecast", "overcast skies");
  }
  if (/rain|🌧|☔|drizzle|shower/.test(text)) {
    cond.push("rain forecast", isFlorida ? "rainy day florida" : "rainy day", "storm update");
  }
  if (/storm|⛈|thunder|tornado|hurricane/.test(text)) {
    cond.push("storm update", "severe weather");
  }
  if (/snow|❄️|sleet|blizzard/.test(text)) {
    cond.push("snow forecast", "winter weather");
  }
  if (/fog|🌫|mist|haze/.test(text)) {
    cond.push("foggy weather");
  }

  // Temperature-based (parse from title — hook titles include "84°" style)
  const tempMatch = title.match(/(\d{1,3})°/);
  const temp = tempMatch ? parseInt(tempMatch[1], 10) : NaN;
  if (!isNaN(temp)) {
    if (temp > 85) {
      cond.push("heat wave", isFlorida ? "hot weather florida" : "hot weather", "summer heat");
    } else if (temp < 55) {
      cond.push("cold front", "chilly weather", isFlorida ? "florida cold" : "cold weather");
    }
  } else {
    // Fallback to keyword match if no temp present
    if (/hot|🔥|heat|🌞/.test(text)) cond.push("heat wave", "hot weather");
    if (/cold|🥶|chilly|🧥|cold front/.test(text)) cond.push("cold front", "chilly weather");
  }

  // 3. Time-of-day tags
  const tod: string[] = [];
  if (hour >= 4 && hour < 11) {
    tod.push("morning weather", "today's forecast");
  } else if (hour >= 11 && hour < 17) {
    tod.push("afternoon update", "midday weather");
  } else {
    tod.push("tonight's weather", "evening forecast");
  }

  // Compose, dedupe (preserve order), cap at 20 tags and stay under YouTube's
  // 500-char combined limit. YouTube counts ~ tag length + 2 (quotes/comma).
  const seen = new Set<string>();
  const out: string[] = [];
  let charCount = 0;
  const MAX_TAGS = 20;
  const MAX_CHARS = 480;
  for (const tag of [...base, ...cond, ...tod]) {
    const t = tag.trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    const cost = t.length + (t.includes(" ") ? 4 : 2); // quotes if multi-word
    if (charCount + cost > MAX_CHARS) break;
    seen.add(t.toLowerCase());
    out.push(t);
    charCount += cost;
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

// --- City extraction helper (shared by title + description hashtags) ---
const TITLE_SKIP_WORDS = new Set([
  "good", "hot", "cold", "cool", "warm", "rain", "storms", "storm",
  "bundle", "calm", "cloudy", "foggy", "grab", "gray", "heads", "tonight",
  "today", "beautiful", "feels", "you", "wet", "snowy", "drive", "crank",
  "chilly", "mild", "sun", "sunny", "tonights", "afternoon", "morning", "evening",
  "don't", "dont", "wake", "rise", "shine",
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

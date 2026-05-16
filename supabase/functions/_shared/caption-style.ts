// Shared helpers for SkyBrief AI caption generation. Provides:
//   • Voice & Tone presets (Professional / Hype / Funny / Local Legend)
//   • Platform-specific style guides (YouTube / Twitter / TikTok / LinkedIn / Instagram)
//   • Scroll-stopping HOOK bank (weather-bucket aware, randomized)
//   • Smart hashtag engine (location + condition + per-platform caps)
//   • Weather-triggered "life tips" (umbrella, hydration, jacket, perfect-day)
//   • Time-of-day greeting guidance
// Used by `generate-caption` (manual), `daily-weather-post` (auto + preview), and
// `process-scheduled-posts` (scheduled + auto-posted) so output stays unified.

export type CaptionTone = "professional" | "hype" | "funny" | "local_legend";
export type Platform = "youtube" | "twitter" | "tiktok" | "linkedin" | "instagram" | "generic";

export function normalizeTone(input: unknown): CaptionTone {
  const v = String(input || "").toLowerCase().trim();
  if (v === "hype" || v === "energetic") return "hype";
  if (v === "funny" || v === "sarcastic") return "funny";
  if (v === "local_legend" || v === "local") return "local_legend";
  return "professional";
}

export function normalizePlatform(input: unknown): Platform {
  const v = String(input || "").toLowerCase().trim();
  if (v.startsWith("youtube") || v === "yt") return "youtube";
  if (v === "twitter" || v === "x" || v === "twitter/x") return "twitter";
  if (v === "tiktok") return "tiktok";
  if (v === "linkedin") return "linkedin";
  if (v === "instagram" || v === "ig") return "instagram";
  return "generic";
}

export function toneInstruction(tone: CaptionTone, city?: string): string {
  switch (tone) {
    case "hype":
      return [
        "TONE: HYPE / ENERGETIC.",
        "- Bring high energy. Use exclamation points sparingly but deliberately.",
        "- Use 3–4 weather emojis (lightning, sun, fire, wind) where they amplify impact.",
        "- Short, punchy sentences. Sound like a hype-man for the sky.",
        "- Still factually accurate — never invent conditions.",
      ].join("\n");
    case "funny":
      return [
        "TONE: FUNNY / SARCASTIC.",
        "- Lead with a witty, dry observation about today's weather.",
        "- Light sarcasm is welcome (e.g. \"Humidity is currently set to 'Steam Room'.\").",
        "- Never punch down, never mock people, never be mean about a city.",
        "- Keep facts intact — the joke is the framing, not the data.",
      ].join("\n");
    case "local_legend":
      return [
        "TONE: LOCAL LEGEND.",
        `- Write like a beloved local who knows ${city || "this city"} inside and out.`,
        "- You MAY ONLY reference specific places listed in the 'VERIFIED LOCAL LANDMARKS' section of this prompt. Never invent landmarks, stadiums, universities, neighborhoods, parks, or businesses.",
        "- If no verified landmarks are provided, use generic local color only (\"around town\", \"across {city}\", \"throughout the area\").",
        "- Use 0–2 emojis. Keep it warm, neighborly, in-the-know.",
      ].join("\n");
    case "professional":
    default:
      return [
        "TONE: PROFESSIONAL.",
        "- Clean, calm, news-style delivery. Think trusted local meteorologist.",
        "- Minimal emojis (0–2). No slang. No exclamation points unless severe weather.",
        "- Lead with the headline forecast in one tight sentence.",
      ].join("\n");
  }
}

// ---------- WEATHER BUCKETS ----------
export type WeatherBucket = "heat" | "cold" | "rain" | "storm" | "snow" | "fog" | "perfect" | "mild";

export function classifyWeather(opts: {
  conditions?: string;
  highTemp?: number | null;
  lowTemp?: number | null;
  rainChance?: number | null;
}): WeatherBucket {
  const cond = String(opts.conditions || "").toLowerCase();
  const high = Number(opts.highTemp ?? 0);
  const low = Number(opts.lowTemp ?? high);
  const rain = Number(opts.rainChance ?? 0);

  if (/thunder|storm|tornado|hurricane/.test(cond)) return "storm";
  if (/snow|flurr|blizzard/.test(cond)) return "snow";
  if (/fog|mist|haze/.test(cond)) return "fog";
  if (/rain|drizzle|shower/.test(cond) || rain >= 50) return "rain";
  if (high >= 90) return "heat";
  if (low <= 45 || high <= 50) return "cold";
  if (high >= 70 && high <= 80 && rain < 20 && /clear|sun|fair/.test(cond)) return "perfect";
  return "mild";
}

// ---------- HOOK BANK ----------
// Each hook has {city} placeholder where natural. The AI is instructed to use
// ONE of these as inspiration but rephrase so output never repeats verbatim.
const HOOKS: Record<WeatherBucket, string[]> = {
  heat: [
    "Brutal heat hitting {city} today 🥵",
    "This heat is no joke…",
    "{city} is about to feel like a furnace 🔥",
    "Hydration check, {city} — today's a scorcher.",
    "The kind of day the AC earns its keep.",
  ],
  cold: [
    "You'll want a jacket for this one 🥶",
    "Bundle up, {city} — it's a cold one.",
    "The chill is back in {city} today.",
    "Coffee weather. Layers weather. {city} weather.",
  ],
  rain: [
    "Don't leave the house without this 👇",
    "Rain is about to change your plans…",
    "Umbrella alert, {city}.",
    "The skies have opinions today, {city}.",
  ],
  storm: [
    "Storm rolling into {city} — heads up. ⛈",
    "{city}, this one needs your attention.",
    "Skies are getting loud today. Stay alert.",
  ],
  snow: [
    "{city} is about to look different ❄️",
    "Snow day vibes incoming.",
    "Bundle up — the white stuff is here.",
  ],
  fog: [
    "{city} woke up wrapped in fog this morning.",
    "Slow it down out there — visibility is low.",
  ],
  perfect: [
    "This is the kind of day you don't waste ☀️",
    "{city}, today is a gift. Use it.",
    "Patio weather. Park weather. Just-go-outside weather.",
  ],
  mild: [
    "{city}, here's your weather brief.",
    "A mellow one on tap for {city}.",
    "Easy weather day — nothing dramatic.",
  ],
};

export function pickHookExamples(bucket: WeatherBucket, city?: string, count = 3): string[] {
  const pool = HOOKS[bucket] || HOOKS.mild;
  // Shuffle deterministically per minute so back-to-back generations don't get the
  // identical sample set, but a single request is stable.
  const seed = Math.floor(Date.now() / 60_000);
  const arr = [...pool]
    .map((h, i) => ({ h, k: ((i + 1) * 9301 + seed * 49297) % 233280 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.h.replace(/\{city\}/g, city || "your city"));
  return arr.slice(0, Math.min(count, arr.length));
}

// ---------- LIFE TIPS ----------
export function lifeTips(opts: {
  rainChance?: number | null;
  highTemp?: number | null;
  lowTemp?: number | null;
  conditions?: string;
}): string {
  const tips: string[] = [];
  const rain = Number(opts.rainChance ?? 0);
  const high = Number(opts.highTemp ?? 0);
  const low = Number(opts.lowTemp ?? high);
  const cond = String(opts.conditions || "").toLowerCase();

  if (rain > 40) tips.push("Rain chance is elevated — mention bringing an umbrella OR driving with extra caution on wet roads.");
  if (high > 90) tips.push("High heat — mention hydrating, or staying in the shade during peak afternoon.");
  if (low < 50) tips.push("Cool temperatures — mention grabbing a jacket or layering up.");

  const isClear = /clear|sun|sunny|fair/.test(cond) && !/storm|rain/.test(cond);
  if (isClear && high >= 70 && high <= 80 && rain < 20) {
    tips.push("Perfect-day window — suggest one outdoor activity (a walk in the park, a patio coffee, a quick run).");
  }

  if (tips.length === 0) return "";
  return [
    "WEATHER-TRIGGERED LIFE TIPS (MUST work at least one of these into the caption naturally):",
    ...tips.map((t) => "- " + t),
  ].join("\n");
}

// ---------- GREETING ----------
export function greetingForPeriod(period?: string | null, city?: string): string {
  const p = String(period || "").toLowerCase();
  const c = city || "everyone";
  if (p === "morning") return `OPENING ENERGY: Morning. Use a fresh-start energy ("Rise and shine, ${c}…", "Morning, ${c}…"). Vary the wording — don't reuse a previous template.`;
  if (p === "afternoon") return `OPENING ENERGY: Midday. Frame it as a check-in ("Lunch break weather check…", "Afternoon update for ${c}…"). Vary the wording.`;
  if (p === "evening") return `OPENING ENERGY: Wind-down. Calm, reflective tone ("Winding down your day, ${c}…", "Evening forecast…"). Vary the wording.`;
  return "";
}

// ---------- HASHTAGS ----------
function hashtagCapForPlatform(p: Platform): number {
  switch (p) {
    case "twitter": return 2;
    case "linkedin": return 2;
    case "youtube": return 3;
    case "tiktok": return 5;
    case "instagram": return 5;
    default: return 4;
  }
}

export function buildHashtags(opts: {
  city?: string;
  state?: string;
  conditions?: string;
  highTemp?: number | null;
  rainChance?: number | null;
  platform?: Platform;
}): string {
  const tags: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    const key = t.toLowerCase();
    if (!seen.has(key)) { seen.add(key); tags.push(t); }
  };

  // Location-based (always-on when present)
  const cityTag = (opts.city || "").replace(/[^a-zA-Z0-9]/g, "");
  if (cityTag) add("#" + cityTag + "Weather");
  const state = (opts.state || "").trim();
  if (/florida/i.test(state)) add("#FloridaWeather");
  else if (state) add("#" + state.replace(/[^a-zA-Z0-9]/g, "") + "Weather");

  // Condition-based
  const cond = String(opts.conditions || "").toLowerCase();
  const high = Number(opts.highTemp ?? 0);
  const rain = Number(opts.rainChance ?? 0);

  if (high >= 90) { add("#HeatWave"); add("#StayCool"); }
  if (/rain|drizzle|shower/.test(cond) || rain >= 50) { add("#RainyDay"); }
  if (/storm|thunder/.test(cond)) { add("#StormWatch"); }
  if (/clear|sun|sunny|fair/.test(cond) && rain < 30) {
    if (high >= 70 && high <= 80) { add("#PerfectWeather"); add("#SunnyDay"); }
    else { add("#SunnyDay"); }
  }
  if (/snow/.test(cond)) add("#SnowDay");
  if (/fog|mist|haze/.test(cond)) add("#FoggyMorning");
  if (high <= 50 && high > 0) add("#JacketWeather");

  // Always include #Weather as a safe fallback so we never return empty
  add("#Weather");

  const cap = hashtagCapForPlatform(opts.platform || "generic");
  return tags.slice(0, cap).join(" ");
}

// ---------- PLATFORM STYLE GUIDE ----------
export function platformGuide(platform: Platform): string {
  switch (platform) {
    case "youtube":
      return [
        "PLATFORM: YOUTUBE SHORTS.",
        "- Short, punchy, KEYWORD-RICH (city + 'weather' + condition early).",
        "- Format: HOOK line, then 1–2 line summary, then optional weather tip, then HASHTAG line, then a CTA line on its own (e.g. 'Subscribe for daily {city} weather updates').",
        "- Keep total under 90 words.",
        "- Max 3 hashtags. Place them on a single dedicated line ABOVE the CTA.",
      ].join("\n");
    case "twitter":
      return [
        "PLATFORM: TWITTER / X.",
        "- 1–2 lines MAX. Sharp, witty, high-impact.",
        "- Hook + the single most useful weather fact. That's it.",
        "- 1–2 hashtags MAX, appended at the very end.",
        "- No CTA. No multi-line bullet lists. Total under 240 characters.",
      ].join("\n");
    case "tiktok":
      return [
        "PLATFORM: TIKTOK.",
        "- HOOK-HEAVY and emotional. First line must stop the scroll.",
        "- Casual voice. Emojis encouraged (4–6 ok). Trend-style phrasing welcome (e.g. 'POV:', 'tell me it's ___ without telling me…').",
        "- Format: HOOK, then 1–2 line summary, then a tip if relevant, then HASHTAG line.",
        "- 3–5 hashtags. No CTA line — TikTok captions don't need one.",
      ].join("\n");
    case "linkedin":
      return [
        "PLATFORM: LINKEDIN.",
        "- Professional, informative, slight storytelling tone.",
        "- Lead with a calm hook (no clickbait). Then a 2–3 sentence forecast framed in terms of how it affects the day/commute.",
        "- 0–2 hashtags MAX, on the final line. NO emojis (or absolute minimum).",
        "- No 'subscribe' CTA. Skip exclamation points.",
      ].join("\n");
    case "instagram":
      return [
        "PLATFORM: INSTAGRAM.",
        "- Format: HOOK, then 2–4 line summary, then a tip, then HASHTAG line.",
        "- Up to 5 hashtags on a dedicated final line. Emojis welcome (3–5).",
      ].join("\n");
    case "generic":
    default:
      return [
        "PLATFORM: GENERIC SOCIAL.",
        "- Format: HOOK, then 2–3 line summary, then an optional tip, then HASHTAG line.",
        "- 3–4 hashtags on a dedicated final line.",
      ].join("\n");
  }
}

// ---------- STRUCTURE & OUTPUT RULES ----------
function structureRules(platform: Platform): string {
  const wantsCTA = platform === "youtube";
  const lines = [
    "OUTPUT STRUCTURE (in this exact order, each section separated by a single blank line):",
    "1. HOOK — one scroll-stopping line. Emotion-driven.",
    "2. MAIN SUMMARY — 1–3 short lines covering today's headline weather (temp range + condition).",
    "3. TIP — only include when a weather-triggered life tip applies (rain/heat/cold/perfect).",
    "4. HASHTAG LINE — the EXACT hashtag string provided below, on its own line, nothing else.",
  ];
  if (wantsCTA) lines.push("5. CTA — one short line on its own (subscribe / follow). Skip on every other platform.");
  return lines.join("\n");
}

function antiRepetitionRule(): string {
  return [
    "ANTI-REPETITION:",
    "- Treat the hook examples as INSPIRATION ONLY. Do not copy any of them verbatim.",
    "- Vary phrasing, sentence rhythm, and word choice from one generation to the next.",
    "- Do not start two consecutive captions with the same opening words.",
  ].join("\n");
}

// ---------- MAIN ENTRY ----------
export function buildStyleAddendum(opts: {
  tone: CaptionTone;
  city?: string;
  state?: string;
  period?: string | null;
  rainChance?: number | null;
  highTemp?: number | null;
  lowTemp?: number | null;
  conditions?: string;
  platform?: Platform | string | null;
}): string {
  const platform = normalizePlatform(opts.platform);
  const bucket = classifyWeather({
    conditions: opts.conditions,
    highTemp: opts.highTemp,
    lowTemp: opts.lowTemp,
    rainChance: opts.rainChance,
  });
  const hookExamples = pickHookExamples(bucket, opts.city, 3);

  const sections: string[] = [];
  sections.push(platformGuide(platform));
  sections.push(toneInstruction(opts.tone, opts.city));

  const greet = greetingForPeriod(opts.period, opts.city);
  if (greet) sections.push(greet);

  sections.push(
    [
      `HOOK BANK (weather bucket: ${bucket}). Use ONE of these as inspiration for your hook line, but rephrase so it feels fresh:`,
      ...hookExamples.map((h) => "- " + h),
    ].join("\n"),
  );

  const tips = lifeTips({
    rainChance: opts.rainChance,
    highTemp: opts.highTemp,
    lowTemp: opts.lowTemp,
    conditions: opts.conditions,
  });
  if (tips) sections.push(tips);

  const tags = buildHashtags({
    city: opts.city,
    state: opts.state,
    conditions: opts.conditions,
    highTemp: opts.highTemp,
    rainChance: opts.rainChance,
    platform,
  });
  sections.push(
    [
      "HASHTAGS:",
      "- End the caption with EXACTLY this hashtag line on its own line:",
      tags,
      "- Do not add other hashtags. Do not modify or reorder these.",
    ].join("\n"),
  );

  sections.push(structureRules(platform));
  sections.push(antiRepetitionRule());

  return sections.join("\n\n");
}

// ---------- VOICE CTA (audio-first platforms only) ----------
// Appends a short spoken call-to-action (~3 seconds) to the END of voice
// scripts for YouTube and TikTok. NEVER added for Twitter/LinkedIn/Instagram
// because those are not audio-first. Rotates daily so the same listener hears
// variation, and adapts wording to the active CaptionTone preset.
//
// Used by both `daily-weather-post` (manual / preview) and
// `process-scheduled-posts` (scheduled + auto-posts) so the spoken CTA stays
// identical across paths.

// CTA pools: "Double Hook" — ALWAYS ask for the LIKE first, then the
// subscribe / follow. Likes drive YouTube Shorts algo signal harder than
// subs, so we lead with them. Lines are intentionally a bit longer (~14–18
// words) so both asks land clearly in audio (~4–5s of speech).
const VOICE_CTAS_BY_TONE: Record<CaptionTone, string[]> = {
  professional: [
    "Drop a like if this was helpful, and subscribe for your daily local update.",
    "Tap that like button and hit follow so you never miss a forecast.",
    "Give us a like to help the channel grow, and subscribe for more daily weather.",
    "Subscribe for daily alerts — and don't forget to like the video on your way out!",
  ],
  hype: [
    "Smash that like button and subscribe for your daily local update!",
    "Drop a like and hit follow — daily forecasts, every single day!",
    "Like the video to help us grow, and subscribe for more daily weather!",
    "Subscribe for daily alerts — and don't forget to smash that like!",
  ],
  funny: [
    "Like the video so the algorithm stops ghosting us, then subscribe.",
    "Tap like to thank the sky, and subscribe so it stops surprising you.",
    "Drop a like for the weather gods, and follow for daily forecasts.",
    "Subscribe for daily forecasts — and like the video, your umbrella will thank you.",
  ],
  local_legend: [
    "Drop a like if this helped, and subscribe for your daily local forecast.",
    "Tap that like button and hit follow so you never miss the local weather.",
    "Give us a like to help the channel grow, and subscribe for daily updates.",
    "Subscribe for daily local alerts — and don't forget to like on your way out!",
  ],
};

// When weather is severe / alert-driven, swap to a single ultra-short CTA so
// the safety message gets the airtime, not the marketing line. Still leads
// with the like to keep the engagement signal consistent.
const ALERT_CTA = "Like and subscribe for safety updates!";

// ---------- SUBSCRIBE + NOTIFICATION BELL CTAs ----------
// Used when the user has the "Include Subscribe CTA in every post" growth
// toggle enabled (default ON). Rotates daily across 3 variants and
// interpolates the active city name so the ask feels local.
// {city} is replaced with the active city or "your area" if missing.
const SUBSCRIBE_NOTIFY_CTAS: string[] = [
  "Subscribe and hit the bell for daily {city} updates.",
  "Stay ahead of the storm — subscribe and turn on notifications.",
  "Don't miss tomorrow's forecast — hit subscribe and the notification bell!",
];

/**
 * Returns true when the platform is audio-first and a spoken CTA makes sense.
 * Twitter / LinkedIn / Instagram videos are typically scrolled muted, so we
 * skip the CTA there.
 */
export function platformWantsVoiceCTA(platform: Platform | null | undefined): boolean {
  return platform === "youtube" || platform === "tiktok";
}

/**
 * Picks a tone-matched, rotating voice CTA. Selection is deterministic per
 * day (UTC) so all platforms / re-runs in the same day stay consistent, but
 * varies day-to-day so listeners don't hear the same line every time.
 *
 * Returns null when no CTA should be appended (non-audio platforms).
 * In alert mode, always returns a single 6-word safety-first CTA.
 */
export function buildVoiceCTA(opts: {
  tone?: CaptionTone | string | null;
  platforms?: Array<Platform | string> | null;
  alertMode?: boolean;
  /** Force the Subscribe + Notification Bell CTA pool (Growth toggle). */
  subscribeCta?: boolean;
  /** Active city name for {city} interpolation in the subscribe CTA. */
  city?: string | null;
}): string | null {
  const platforms = (opts.platforms || []).map((p) => normalizePlatform(p));
  const anyAudio = platforms.some(platformWantsVoiceCTA);
  if (!anyAudio) return null;

  if (opts.alertMode) return ALERT_CTA;

  // Day-of-year rotation so all calls within a single UTC day pick the same
  // line, but it varies day-to-day.
  const now = new Date();
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86400000);

  if (opts.subscribeCta) {
    const cityToken = (opts.city && String(opts.city).trim()) || "your area";
    const tmpl = SUBSCRIBE_NOTIFY_CTAS[dayOfYear % SUBSCRIBE_NOTIFY_CTAS.length];
    return tmpl.replace(/\{city\}/g, cityToken);
  }

  const tone = normalizeTone(opts.tone);
  const pool = VOICE_CTAS_BY_TONE[tone] || VOICE_CTAS_BY_TONE.professional;
  return pool[dayOfYear % pool.length];
}

/**
 * Hard-clamps the spoken weather summary to a max word count (default 25).
 * Strips any trailing partial sentence so the cut point still sounds natural.
 * Also collapses excess whitespace and removes characters that don't read
 * well aloud.
 */
export function clampSummaryWords(text: string, maxWords = 25): string {
  const cleaned = (text || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "") // strip emoji
    .replace(/#[A-Za-z0-9_]+/g, "")                          // strip hashtags
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return cleaned;
  const clipped = words.slice(0, maxWords).join(" ");
  // Trim back to the last sentence boundary if one exists in the kept range.
  const lastStop = Math.max(clipped.lastIndexOf("."), clipped.lastIndexOf("!"), clipped.lastIndexOf("?"));
  if (lastStop > clipped.length * 0.5) return clipped.slice(0, lastStop + 1);
  return clipped.replace(/[,;:\-–—]+$/, "") + ".";
}

/**
 * Appends the spoken CTA to a finished voice script. Also enforces the
 * weather-summary word cap so the script + CTA together stay under ~35 words
 * (~10–12 seconds of speech at 1.05–1.1× playback).
 *
 * Safe no-op when CTA isn't applicable (non-audio platforms).
 */
export function appendVoiceCTA(
  script: string,
  opts: {
    tone?: CaptionTone | string | null;
    platforms?: Array<Platform | string> | null;
    alertMode?: boolean;
    subscribeCta?: boolean;
    city?: string | null;
    /** Max words allowed in the weather-summary portion (before the CTA). Default 25. */
    maxSummaryWords?: number;
  },
): string {
  // Always tighten the summary first so total runtime is bounded even when
  // no CTA gets appended (e.g. Instagram, LinkedIn).
  const summary = clampSummaryWords(script, opts.maxSummaryWords ?? 25);

  const cta = buildVoiceCTA(opts);
  if (!cta) return summary;

  if (summary.toLowerCase().includes(cta.toLowerCase())) return summary;
  const sep = /[.!?]$/.test(summary) ? " " : ". ";
  return `${summary}${sep}${cta}`;
}

/**
 * Lightweight check: does this weather payload qualify as a "weather alert"
 * scenario where we should swap to the ultra-short CTA and prioritize the
 * safety message? Inputs are loose so callers can pass partial weather data.
 */
export function isWeatherAlert(input: {
  alertLine?: string | null;
  condition?: string | null;
  temperature?: number | null;
  rainChance?: number | null;
  windSpeed?: number | null;
}): boolean {
  if (input.alertLine && String(input.alertLine).trim() && String(input.alertLine).trim().toLowerCase() !== "none") {
    return true;
  }
  const cond = String(input.condition || "").toLowerCase();
  if (/storm|hurricane|tornado|blizzard|severe|warning|advisory|flood/.test(cond)) return true;
  const t = Number(input.temperature ?? NaN);
  if (Number.isFinite(t) && (t >= 100 || t <= 20)) return true;
  const rc = Number(input.rainChance ?? NaN);
  if (Number.isFinite(rc) && rc >= 90) return true;
  const w = Number(input.windSpeed ?? NaN);
  if (Number.isFinite(w) && w >= 35) return true;
  return false;
}


// --- City-local timestamp helpers ---------------------------------------------
// Used by title builders (daily-weather-post, process-scheduled-posts) and the
// caption first-line stamp in generate-caption. Pure string helpers, no I/O.

const CITY_TZ: Record<string, string> = {
  Orlando: "America/New_York",
  Gainesville: "America/New_York",
  Miami: "America/New_York",
  Tampa: "America/New_York",
  Jacksonville: "America/New_York",
  Tallahassee: "America/New_York",
};

export function getCityTimezone(city?: string | null): string {
  if (!city) return "America/New_York";
  return CITY_TZ[city.trim()] || "America/New_York";
}

/**
 * Returns a city-local short stamp like "8 AM", "2 PM", "8:30 AM", "2:45 PM".
 * Minutes are dropped unless the local time is :30 or :45 (so most slots are
 * clean H AM/PM strings).
 */
export function getCityLocalStamp(city?: string | null, when: Date = new Date()): string {
  const tz = getCityTimezone(city);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hour12: true,
  }).formatToParts(when);
  const hour = parts.find((p) => p.type === "hour")?.value || "12";
  const minute = parts.find((p) => p.type === "minute")?.value || "00";
  const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value || "AM").toUpperCase();
  const m = parseInt(minute, 10);
  if (m === 30 || m === 45) return `${hour}:${minute} ${dayPeriod}`;
  return `${hour} ${dayPeriod}`;
}

/** True if a title already begins with a `[H...]` timestamp prefix. */
export function titleHasTimestamp(title: string): boolean {
  return /^\[\d{1,2}(:\d{2})?\s?(AM|PM)\]/i.test(title || "");
}

// --- Slot helpers (Morning/Afternoon/Evening branding) ---

export type SlotName = "morning" | "afternoon" | "evening" | "adhoc" | "manual" | string;

/** Fixed time prefix per slot. Falls back to city-local stamp for adhoc/manual. */
export function slotTimePrefix(slot: SlotName | null | undefined, city?: string | null): string {
  switch ((slot || "").toLowerCase()) {
    case "morning": return "8 AM";
    case "afternoon": return "1 PM";
    case "evening": return "6 PM";
    default: return getCityLocalStamp(city);
  }
}

/** Title-case slot label for UI/beacons. */
export function slotDisplayLabel(slot: SlotName | null | undefined): string {
  const s = (slot || "").toLowerCase();
  if (s === "morning") return "Morning";
  if (s === "afternoon") return "Afternoon";
  if (s === "evening") return "Evening";
  return "Update";
}

/** Slot-driven personality directive for the caption AI. */
export function slotPersonalityDirective(slot: SlotName | null | undefined): string {
  switch ((slot || "").toLowerCase()) {
    case "morning":
      return "SLOT PERSONALITY: Upbeat / Energetic. This is a MORNING brief — open with energy, frame the day ahead, sound like someone helping people start their day right.";
    case "afternoon":
      return "SLOT PERSONALITY: Informative / Direct. This is an AFTERNOON check-in — be punchy and factual, mid-day update tone, no fluff.";
    case "evening":
      return "SLOT PERSONALITY: Calm / Cinematic. This is an EVENING wind-down — softer rhythm, slightly atmospheric language, help people settle into the night.";
    default:
      return "";
  }
}

/** Rotating CTA pool. Picks deterministically by (date, slot). */
const CTA_POOL = [
  "Tap ❤️ if this helped your plans.",
  "Subscribe for tomorrow's brief.",
  "Check the radar before you head out.",
  "Drop your city's weather in the comments.",
];

export function rotatingCTA(slot: SlotName | null | undefined, when: Date = new Date()): string {
  const slotIdx = ["morning", "afternoon", "evening"].indexOf((slot || "").toLowerCase());
  const dateIdx = Math.floor(when.getTime() / 86400000);
  const idx = (dateIdx + (slotIdx >= 0 ? slotIdx : 0)) % CTA_POOL.length;
  return CTA_POOL[idx];
}

/** Token-set Jaccard similarity over normalized text. Returns 0..1. */
export function captionSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);
  const A = new Set(norm(a || ""));
  const B = new Set(norm(b || ""));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union > 0 ? inter / union : 0;
}

/** First non-empty content line, used as the "previous opener" hint. */
export function firstContentLine(s: string | null | undefined): string {
  if (!s) return "";
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Skip a leading 📍 beacon line so we hint the actual hook
  const idx = lines.findIndex((l) => !/^📍/.test(l));
  return (idx >= 0 ? lines[idx] : lines[0] || "").slice(0, 160);
}

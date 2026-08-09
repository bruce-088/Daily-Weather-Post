// Phase 5B: Centralized SkyBrief title builder.
//
// All YouTube/Shorts title templates live here so that:
//   1. Both `process-scheduled-posts` and `daily-weather-post` use one source.
//   2. Templates can be statically inspected by the unit test
//      (`title-builder.test.ts`) against `validatePostBundle` so a banned
//      fragment can never be merged.
//
// Templates intentionally avoid the strict banned-fragment list from
// `_shared/text-sanitizer.ts`:
//   "Heads Up", "Weather Update", "Coming Up", "But Comfortable",
//   "Clear Skies", "Not Need".

import {
  ensureSlotTitlePrefix,
  slotTimePrefix,
  assertSlotTitlePrefix,
} from "./caption-style.ts";

export function getWeatherEmoji(condition: string): string {
  const c = (condition || "").toLowerCase();
  if (c.includes("thunder") || c.includes("storm")) return "⛈";
  if (c.includes("snow") || c.includes("sleet") || c.includes("blizzard")) return "❄️";
  if (c.includes("rain") || c.includes("drizzle") || c.includes("shower")) return "🌧";
  if (c.includes("fog") || c.includes("mist") || c.includes("haze")) return "🌫";
  if (c.includes("cloud") || c.includes("overcast")) return "☁️";
  if (c.includes("partly") || c.includes("scatter")) return "🌤";
  return "☀️";
}

export interface TitleTemplateInputs {
  city: string;
  temp: number;
  condition: string;
  emoji: string;
}

/**
 * Returns the full pool of every possible title body the generator could
 * ever emit for a given (city, temp, condition) combo. Used by the unit
 * test to validate every template against `validatePostBundle`.
 *
 * This is `expandAllTemplates` — NOT runtime selection. Runtime selection
 * happens in `buildHookTitle` based on weather branching.
 */
/**
 * Phase 10C: Date-stamped hook pattern.
 * Winning template observed at 159 views (vs 30-40 baseline).
 * Format: "{City} Weather | {Weekday}, {Month} {Day}"
 *   e.g. "Orlando Weather | Tuesday, May 27"
 * City in first 3 words, weekday + specific date, pipe separator.
 */
export function buildDateStampedTitle(city: string, now: Date = new Date()): string {
  const weekday = now.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });
  const month = now.toLocaleDateString("en-US", { month: "long", timeZone: "America/New_York" });
  const day = Number(now.toLocaleDateString("en-US", { day: "numeric", timeZone: "America/New_York" }));
  return `${city} Weather | ${weekday}, ${month} ${day}`;
}

export function expandAllTemplates(inp: TitleTemplateInputs): string[] {
  const { city, temp: t, emoji } = inp;
  return [
    // Phase 10C: Date-stamped winner (159-view pattern)
    buildDateStampedTitle(city),
    // Severe / storm
    `Storms Rolling Into ${city} ⛈ ${t}° Today`,
    `Storm Alert ${city} — Rolling In ⛈ Forecast`,                        // was: "Heads Up ${city} — Storms On The Way ⛈ Forecast"
    `Don't Skip The Umbrella Today ☔ ${city} Weather`,
    // Rain
    `Grab An Umbrella ☔ ${city} Weather Today`,
    `Wet Day Ahead In ${city} 🌧 ${t}° Forecast`,
    `Rain On The Radar 🌧 ${city} Forecast Drop`,                          // was: "Rain On The Radar 🌧 ${city} Weather Update"
    // Snow
    `Bundle Up ${city} ❄️ ${t}° And Snowy`,
    `Snowy Skies Ahead ❄️ ${city} Forecast Today`,
    // Fog
    `Foggy Start In ${city} 🌫 ${t}° Today`,
    `Drive Slow This Morning 🌫 ${city} Forecast`,
    // Heat / temp
    `Hot Day Ahead 🔥 ${city} Hits ${t}° Today`,
    `Crank The AC ${city} 🔥 ${t}° Incoming`,
    `Feels Like Summer Already In ${city} ☀️ ${t}° Today`,
    `Warm One Rolling Through 🌞 ${city} Hits ${t}°`,                      // was: "Warm One Coming Up 🌞 ${city} Hits ${t}°" — drift-safe (no "Coming Up")
    `Beautiful Day In ${city} ${emoji} ${t}° And Comfortable`,
    `You Might Skip The Jacket Today 👀 ${city} Forecast`,                 // was: "You Might Not Need A Jacket Today" — drift-safe (no "Not Need")
    `Mild & Comfy In ${city} ${emoji} ${t}° Today`,
    `Cool Start, Nice Finish ${emoji} ${city} Weather Today`,
    `Chilly Morning In ${city} 🧥 ${t}° Today`,
    `Grab A Jacket ${city} 🧥 ${t}° Forecast`,
    `Cold Front Hits ${city} 🥶 Just ${t}° Today`,
    `Bundle Up ${city} 🥶 ${t}° And Chilly`,
    // Sky / cloud
    `Gray Skies, Easy Vibes ☁️ ${city} Weather Today`,                     // was: "Gray Skies But Comfortable ☁️..."
    `Cloudy Start, Warm Finish 🌤 ${city} Weather Today`,
    `Beautiful Blue Skies ☀️ ${city} Forecast Today`,                      // was: "Beautiful Clear Skies ☀️..."
    `Sun & Clouds Mix 🌤 ${city} Weather Today`,
    // Time-of-day
    `Tonight's Forecast Drop 🌙 ${city} Weather`,                          // was: "Tonight's Weather Update 🌙..."
    `Calm & Blue Skies Ahead 🌙 ${city} Evening Weather`,                  // was: "Calm & Clear Skies Ahead 🌙..."
    `Good Morning ${city} ☕ ${t}° To Start The Day`,
    // Generic fallback
    `${city} Weather Today ${emoji} ${t}° ${inp.condition}`,
  ];
}

/**
 * Phase 14A — Urgency & Specificity title formula.
 *
 *   {City}: {Specific Detail} - {Hook / Value Prop}
 *
 * Body is capped so `[8 AM] ` + body stays under 60 characters for mobile.
 * Templates deliberately avoid every phrase in BANNED_FRAGMENTS_STRICT /
 * BANNED_LOCATION_PROXIES ("Weather Update", "Coming Up", "Clear Skies",
 * "Heads Up", "Not Need", "But Comfortable").
 */
export interface TitleContext {
  feelsLike?: number | null;
  tomorrowHigh?: number | null;
  tomorrowLow?: number | null;
  tomorrowCondition?: string | null;
  now?: Date;
}

/** Max characters for the title BODY (slot prefix `[8 AM] ` = 7 chars → ≤60 total). */
export const TITLE_BODY_BUDGET = 52;

function clampBody(body: string, budget = TITLE_BODY_BUDGET): string {
  if (body.length <= budget) return body;
  // Prefer dropping the hook half over truncating mid-word.
  const dashIdx = body.lastIndexOf(" - ");
  if (dashIdx > 0 && dashIdx <= budget) return body.slice(0, dashIdx);
  return body.slice(0, budget - 1).trimEnd() + "…";
}

/** Weekday in ET (0 = Sunday). */
function etWeekday(now: Date): number {
  const s = now.toLocaleDateString("en-US", { weekday: "short", timeZone: "America/New_York" });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(s);
}

export interface FormulaTitleResult {
  body: string;
  trigger:
    | "extreme_heat"
    | "heat"
    | "extreme_cold"
    | "cold"
    | "storm"
    | "rain"
    | "snow"
    | "pattern_change"
    | "weekend"
    | "pleasant"
    | "none";
}

/**
 * Deterministic, condition-aware title body. Returns `trigger: "none"` when no
 * strong signal exists, so callers can fall back to the Phase 10C date-stamped
 * winner pattern.
 */
export function buildFormulaTitleBody(
  city: string,
  temp: number,
  condition: string,
  rainChance?: number | null,
  ctx: TitleContext = {},
): FormulaTitleResult {
  const now = ctx.now ?? new Date();
  const t = Math.round(temp);
  const feels = ctx.feelsLike != null ? Math.round(ctx.feelsLike) : null;
  const c = (condition || "").toLowerCase();
  const rain = rainChance ?? null;

  const isStorm = /thunder|storm|tornado|hurricane|squall|hail/.test(c);
  const isRain = /rain|drizzle|shower/.test(c);
  const isSnow = /snow|sleet|blizzard|ice/.test(c);
  const isPleasant = /clear|sun|partly|fair/.test(c) && !isRain && !isStorm;

  const dow = etWeekday(now);
  const weekendPreview = dow === 4 || dow === 5; // Thu / Fri

  const tHigh = ctx.tomorrowHigh != null ? Math.round(ctx.tomorrowHigh) : null;
  const delta = tHigh != null ? tHigh - t : 0;
  const patternChange = tHigh != null && Math.abs(delta) >= 8;

  const mk = (detail: string, hook: string, trigger: FormulaTitleResult["trigger"]) => ({
    body: clampBody(`${city}: ${detail} - ${hook}`),
    trigger,
  });

  // 1. Extreme heat / feels-like heat index
  if (feels != null && feels >= 100) {
    return mk(`Feels Like ${feels}°F`, "Stay Cool Tips", "extreme_heat");
  }
  if (t >= 95) {
    return mk(`${t}°F Today`, "Heat Advisory Details", "extreme_heat");
  }
  // 2. Severe storms / heavy rain
  if (isStorm || (rain != null && rain >= 70)) {
    return mk("Severe Storms", "Timing & Impacts", "storm");
  }
  if (isRain || (rain != null && rain > 50)) {
    return mk(`Rain ${rain != null ? rain + "% Likely" : "Moving In"}`, "Hour-By-Hour Timing", "rain");
  }
  // 3. Extreme cold
  if (t <= 35) {
    return mk(`${t}°F Freeze Risk`, "What To Protect", "extreme_cold");
  }
  if (isSnow) {
    return mk("Snow Chances", "Timing & Totals", "snow");
  }
  // 4. Pattern change (relief / cooling / warm-up)
  if (patternChange) {
    return delta <= -8
      ? mk(`${t}°F Now`, `Relief At ${tHigh}°F Tomorrow`, "pattern_change")
      : mk("Warm-Up Ahead", `${tHigh}°F By Tomorrow`, "pattern_change");
  }
  // 5. Weekend preview (Thu/Fri)
  if (weekendPreview) {
    return isPleasant
      ? mk(`${t}°F & Sunny`, "Weekend Outlook", "weekend")
      : mk(`${t}°F ${condition}`, "Weekend Outlook", "weekend");
  }
  // 6. Hot-but-not-extreme
  if (t >= 88) {
    return mk(`${t}°F Hot One`, "When It Peaks", "heat");
  }
  if (t <= 45) {
    return mk(`${t}°F Chill`, "Jacket Or Not", "cold");
  }
  // 7. Pleasant
  if (isPleasant && t >= 68 && t <= 84) {
    return mk(`Sunny & ${t}°F`, "7-Day Outlook", "pleasant");
  }

  return { body: buildDateStampedTitle(city, now), trigger: "none" };
}

/**
 * Runtime title selection. Identical branching to the old per-function
 * implementations in process-scheduled-posts/index.ts and
 * daily-weather-post/index.ts — but the literal pool entries are kept in
 * lock-step with `expandAllTemplates` above so the unit test covers every
 * branch.
 */
export function buildHookTitle(
  city: string,
  temp: number,
  condition: string,
  rainChance?: number,
  slot?: string | null,
  callerTag = "title-builder",
  ctx: TitleContext = {},
): string {
  const emoji = getWeatherEmoji(condition);
  const c = (condition || "").toLowerCase();
  const t = Math.round(temp);
  const hour = new Date().getHours();
  const isMorning = hour >= 4 && hour < 11;
  const isEvening = hour >= 17 || hour < 4;
  const isStorm = /thunder|storm|tornado|hurricane/i.test(c);
  const isRain = /rain|drizzle|shower/.test(c);
  const isSnow = /snow|sleet|blizzard/.test(c);
  const isFog = /fog|mist|haze/.test(c);
  const isCloudy = /cloud|overcast/.test(c);
  const isPartly = /partly|scatter/.test(c);
  const isClear = /clear|sun/.test(c) ||
    (!isCloudy && !isRain && !isStorm && !isSnow && !isFog && !isPartly);

  const pool: string[] = [];

  if (isStorm || (rainChance != null && rainChance >= 70)) {
    pool.push(`Storms Rolling Into ${city} ⛈ ${t}° Today`);
    pool.push(`Storm Alert ${city} — Rolling In ⛈ Forecast`);
    pool.push(`Don't Skip The Umbrella Today ☔ ${city} Weather`);
  } else if (isRain || (rainChance != null && rainChance >= 50)) {
    pool.push(`Grab An Umbrella ☔ ${city} Weather Today`);
    pool.push(`Wet Day Ahead In ${city} 🌧 ${t}° Forecast`);
    pool.push(`Rain On The Radar 🌧 ${city} Forecast Drop`);
  } else if (isSnow) {
    pool.push(`Bundle Up ${city} ❄️ ${t}° And Snowy`);
    pool.push(`Snowy Skies Ahead ❄️ ${city} Forecast Today`);
  } else if (isFog) {
    pool.push(`Foggy Start In ${city} 🌫 ${t}° Today`);
    pool.push(`Drive Slow This Morning 🌫 ${city} Forecast`);
  }

  if (t >= 90) {
    pool.push(`Hot Day Ahead 🔥 ${city} Hits ${t}° Today`);
    pool.push(`Crank The AC ${city} 🔥 ${t}° Incoming`);
  } else if (t >= 85) {
    pool.push(`Feels Like Summer Already In ${city} ☀️ ${t}° Today`);
    pool.push(`Warm One Rolling Through 🌞 ${city} Hits ${t}°`);
  } else if (t >= 70 && (isClear || isPartly)) {
    pool.push(`Beautiful Day In ${city} ${emoji} ${t}° And Comfortable`);
    pool.push(`You Might Skip The Jacket Today 👀 ${city} Forecast`);
  } else if (t >= 55 && t < 70) {
    pool.push(`Mild & Comfy In ${city} ${emoji} ${t}° Today`);
    pool.push(`Cool Start, Nice Finish ${emoji} ${city} Weather Today`);
  } else if (t >= 40 && t < 55) {
    pool.push(`Chilly Morning In ${city} 🧥 ${t}° Today`);
    pool.push(`Grab A Jacket ${city} 🧥 ${t}° Forecast`);
  } else if (t < 40) {
    pool.push(`Cold Front Hits ${city} 🥶 Just ${t}° Today`);
    pool.push(`Bundle Up ${city} 🥶 ${t}° And Chilly`);
  }

  if (isCloudy && !isRain && !isStorm) {
    pool.push(`Gray Skies, Easy Vibes ☁️ ${city} Weather Today`);
    pool.push(`Cloudy Start, Warm Finish 🌤 ${city} Weather Today`);
  }
  if (isClear && !pool.length) {
    pool.push(`Beautiful Blue Skies ☀️ ${city} Forecast Today`);
  }
  if (isPartly) {
    pool.push(`Sun & Clouds Mix 🌤 ${city} Weather Today`);
  }

  if (isEvening) {
    pool.push(`Tonight's Forecast Drop 🌙 ${city} Weather`);
    pool.push(`Calm & Blue Skies Ahead 🌙 ${city} Evening Weather`);
  } else if (isMorning) {
    pool.push(`Good Morning ${city} ☕ ${t}° To Start The Day`);
  }

  if (!pool.length) {
    pool.push(`${city} Weather Today ${emoji} ${t}° ${condition}`);
  }

  // Phase 14A: urgency/specificity formula wins whenever a strong weather
  // signal exists (heat, cold, storms, pattern change, weekend preview).
  // Otherwise fall back to the Phase 10C date-stamped winner (70%) / the
  // weather-variety pool (30%) so visual variety is preserved.
  const seed = new Date().getDate() * 24 + hour;
  const formula = buildFormulaTitleBody(city, temp, condition, rainChance ?? null, ctx);
  let baseTitle: string;
  if (formula.trigger !== "none") {
    baseTitle = formula.body;
  } else {
    const useDateStamp = (seed % 10) < 7; // ~70%
    baseTitle = useDateStamp ? buildDateStampedTitle(city) : pool[seed % pool.length];
  }
  console.log(
    `[title_debug] formula trigger=${formula.trigger} body="${baseTitle}" len=${baseTitle.length}`,
  );
  const effectiveSlot = slot || "morning";
  try {
    const result = ensureSlotTitlePrefix(baseTitle, effectiveSlot, city);
    assertSlotTitlePrefix(result, `${callerTag}:buildHookTitle`);
    console.log("[title_debug] buildHookTitle output:", result);
    return result;
  } catch (err) {
    console.warn(
      "[title-builder] ensureSlotTitlePrefix failed, applying hard fallback prefix",
      err,
    );
    const prefix = `[${slotTimePrefix(effectiveSlot, city)}] `;
    const budget = Math.max(1, 95 - prefix.length);
    const body = baseTitle.length > budget
      ? baseTitle.substring(0, budget - 1) + "…"
      : baseTitle;
    const result = prefix + body;
    assertSlotTitlePrefix(result, `${callerTag}:buildHookTitle:fallback`);
    return result;
  }
}

export function generateSkyBriefTitle(
  city: string,
  temp: number,
  condition: string,
  rainChance?: number,
  slot?: string | null,
  callerTag = "title-builder",
  ctx: TitleContext = {},
): string {
  return buildHookTitle(city, temp, condition, rainChance, slot, callerTag, ctx);
}


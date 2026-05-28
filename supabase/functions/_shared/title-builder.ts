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

  const seed = new Date().getDate() * 24 + hour;
  const baseTitle = pool[seed % pool.length];
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
): string {
  return buildHookTitle(city, temp, condition, rainChance, slot, callerTag);
}

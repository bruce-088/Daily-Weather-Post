// Phase 5B: Static guard for the centralized title pool.
//
// Asserts that every template in `expandAllTemplates` passes
// `validatePostBundle` (title + description scope) for representative
// fixture cities, so a banned fragment can never be merged into the pool.
//
// Run with:  deno test supabase/functions/_shared/title-builder.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { expandAllTemplates, getWeatherEmoji, buildHookTitle, buildFormulaTitleBody } from "./title-builder.ts";
import { validatePostBundle, BANNED_FRAGMENTS_STRICT } from "./text-sanitizer.ts";

const FIXTURE_CITIES = ["Orlando", "Gainesville", "Miami", "Tampa"];
const FIXTURE_TEMPS = [32, 50, 65, 78, 88, 95];
const FIXTURE_CONDITIONS = [
  "Clear",
  "Partly Cloudy",
  "Overcast",
  "Light Rain",
  "Thunderstorm",
  "Snow",
  "Fog",
];

Deno.test("every template in the pool passes validatePostBundle (title scope)", () => {
  for (const city of FIXTURE_CITIES) {
    for (const t of FIXTURE_TEMPS) {
      for (const condition of FIXTURE_CONDITIONS) {
        const emoji = getWeatherEmoji(condition);
        const templates = expandAllTemplates({ city, temp: t, condition, emoji });
        for (const tpl of templates) {
          const r = validatePostBundle({
            title: `[8 AM] ${tpl}`,
            description: tpl,
            caption: null,
            voiceScript: null,
            expectedCity: city,
          });
          assert(
            r.ok,
            `Template failed validation for city=${city} temp=${t} cond=${condition}: ` +
              `"${tpl}" — failures=${JSON.stringify(r.failures)}`,
          );
        }
      }
    }
  }
});

Deno.test("no template literally contains any BANNED_FRAGMENTS_STRICT phrase", () => {
  const city = "Orlando";
  const emoji = getWeatherEmoji("Clear");
  const templates = expandAllTemplates({ city, temp: 75, condition: "Clear", emoji });
  for (const tpl of templates) {
    for (const banned of BANNED_FRAGMENTS_STRICT) {
      const re = new RegExp(
        `\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`,
        "i",
      );
      assert(
        !re.test(tpl),
        `Template "${tpl}" contains banned fragment "${banned}"`,
      );
    }
  }
});

Deno.test("buildHookTitle produces a slot-prefixed string that passes validation", () => {
  for (const city of FIXTURE_CITIES) {
    const title = buildHookTitle(city, 78, "Partly Cloudy", 10, "morning", "unit-test");
    assert(/^\[(8 AM|1 PM|6 PM)\]/.test(title), `Missing slot prefix: ${title}`);
    const r = validatePostBundle({
      title,
      description: title,
      caption: null,
      voiceScript: null,
      expectedCity: city,
    });
    assertEquals(r.ok, true, `buildHookTitle output failed validation: ${JSON.stringify(r.failures)}`);
  }
});

Deno.test("word-boundary validator does NOT block 'unclear skies' (false-positive guard)", () => {
  const r = validatePostBundle({
    title: "Morning of unclear skies in Orlando",
    description: "It's a day of unclear skies ahead.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, true, `False positive: ${JSON.stringify(r.failures)}`);
});

Deno.test("validator DOES block 'Clear Skies' when used as a location slot", () => {
  // Phase 8B: "Clear Skies" moved from BANNED_FRAGMENTS_STRICT to
  // BANNED_LOCATION_PROXIES — only blocked when it appears as a hallucinated
  // location (e.g. "across Clear Skies"), not in natural narration.
  const r = validatePostBundle({
    title: "[6 PM] Sunshine across Clear Skies tonight",
    description: "Tonight's outlook across Clear Skies.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, false);
  assertEquals(r.failures[0]?.matched, "Clear Skies");
});


// --- Phase 14A: urgency/specificity formula titles ---

Deno.test("formula titles stay under 60 chars with slot prefix and pass validation", () => {
  const cases: Array<[number, string, number | null, Record<string, unknown>]> = [
    [96, "Clear", 0, {}],
    [88, "Clear", 0, { feelsLike: 103 }],
    [30, "Clear", 0, {}],
    [78, "Thunderstorm", 80, {}],
    [72, "Light Rain", 60, {}],
    [34, "Snow", 40, {}],
    [85, "Clear", 0, { tomorrowHigh: 70 }],
    [60, "Clear", 0, { tomorrowHigh: 80 }],
    [75, "Partly Cloudy", 10, {}],
  ];
  for (const city of FIXTURE_CITIES) {
    for (const [temp, condition, rain, ctx] of cases) {
      const title = buildHookTitle(city, temp, condition, rain ?? undefined, "morning", "unit-test", ctx);
      assert(/^\[(8 AM|1 PM|6 PM)\]/.test(title), `Missing slot prefix: ${title}`);
      assert(title.length <= 60, `Title too long (${title.length}): ${title}`);
      const r = validatePostBundle({
        title,
        description: title,
        caption: null,
        voiceScript: null,
        expectedCity: city,
      });
      assertEquals(r.ok, true, `Formula title failed validation: ${title} ${JSON.stringify(r.failures)}`);
    }
  }
});

Deno.test("formula body follows {City}: {Detail} - {Hook} and is condition-aware", () => {
  const hot = buildFormulaTitleBody("Orlando", 96, "Clear", 0);
  assertEquals(hot.trigger, "extreme_heat");
  assert(hot.body.startsWith("Orlando: "), hot.body);
  assert(hot.body.includes(" - "), hot.body);

  const storm = buildFormulaTitleBody("Gainesville", 80, "Thunderstorm", 85);
  assertEquals(storm.trigger, "storm");

  const cold = buildFormulaTitleBody("Orlando", 32, "Clear", 0);
  assertEquals(cold.trigger, "extreme_cold");

  const relief = buildFormulaTitleBody("Orlando", 92, "Clear", 0, { tomorrowHigh: 78 });
  assertEquals(relief.trigger, "pattern_change");

  const weekend = buildFormulaTitleBody("Orlando", 75, "Clear", 0, {
    now: new Date("2026-08-07T14:00:00Z"), // Friday
  });
  assertEquals(weekend.trigger, "weekend");
});

Deno.test("no formula title contains banned fragments or location proxies", () => {
  for (const city of FIXTURE_CITIES) {
    for (const t of [30, 45, 60, 75, 90, 96]) {
      for (const condition of FIXTURE_CONDITIONS) {
        const { body } = buildFormulaTitleBody(city, t, condition, 60, { feelsLike: t + 6, tomorrowHigh: t - 10 });
        for (const banned of [...BANNED_FRAGMENTS_STRICT, "Weather Update", "Coming Up", "Heads Up", "Clear Skies"]) {
          assert(
            !body.toLowerCase().includes(banned.toLowerCase()),
            `Formula body "${body}" contains banned fragment "${banned}"`,
          );
        }
      }
    }
  }
});

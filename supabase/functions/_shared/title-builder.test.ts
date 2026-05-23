// Phase 5B: Static guard for the centralized title pool.
//
// Asserts that every template in `expandAllTemplates` passes
// `validatePostBundle` (title + description scope) for representative
// fixture cities, so a banned fragment can never be merged into the pool.
//
// Run with:  deno test supabase/functions/_shared/title-builder.test.ts

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { expandAllTemplates, getWeatherEmoji, buildHookTitle } from "./title-builder.ts";
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

Deno.test("validator DOES block the banned 'Clear Skies' fragment in title", () => {
  const r = validatePostBundle({
    title: "[6 PM] Clear Skies overnight in Orlando",
    description: "Tonight's outlook for Orlando.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, false);
  assertEquals(r.failures[0]?.matched, "Clear Skies");
});

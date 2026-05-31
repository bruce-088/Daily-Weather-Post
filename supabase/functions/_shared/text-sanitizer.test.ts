// Text sanitizer tests.
//
// Phase 5E: contextual blocking of "But Comfortable".
// Phase 8B: moved "Coming Up", "Clear Skies", "Heads Up" to context-aware
// BANNED_LOCATION_PROXIES so legitimate weather narration is not blocked.
//
// Run with:  deno test supabase/functions/_shared/text-sanitizer.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validatePostBundle } from "./text-sanitizer.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Strict fragments (still globally blocked in title/description)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("PROXY: 'Weather Update' as location is BLOCKED", () => {
  // Phase 12CB: "Weather Update" is now a context-aware location proxy.
  // It is allowed in legitimate narration ("Today's Weather Update for the
  // day ahead.") but blocked when it appears as a hallucinated location
  // ("weather in Weather Update").
  const r = validatePostBundle({
    title: "[8 AM] Today's weather in Weather Update",
    description: "Mild day across the area.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, false);
  const m = r.failures.find((f) => f.reason === "banned_location_proxy");
  assertEquals(m?.matched, "Weather Update");
});

Deno.test("PROXY: 'Weather Update' in legitimate narration is ALLOWED", () => {
  const r = validatePostBundle({
    title: "[8 AM] Today's weather in Orlando",
    description: "Weather Update for the day ahead — sunny skies expected.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, true);
});

Deno.test("STRICT: 'Not Need' in title is BLOCKED", () => {
  const r = validatePostBundle({
    title: "[1 PM] Not Need this afternoon in Orlando",
    description: "Mild day across Orlando.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, false);
  const m = r.failures.find((f) => f.reason === "banned_fragment");
  assertEquals(m?.matched, "Not Need");
});

// ─────────────────────────────────────────────────────────────────────────────
// Location-proxy fragments — context-aware
// ─────────────────────────────────────────────────────────────────────────────

// "But Comfortable" (Phase 5E baseline)
Deno.test("PROXY: 'in But Comfortable' is BLOCKED", () => {
  const r = validatePostBundle({
    title: "[8 AM] Today's weather in But Comfortable",
    description: "Heads up for the forecast in But Comfortable today.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, false);
  const m = r.failures.find((f) => f.reason === "banned_location_proxy");
  assertEquals(m?.matched, "But Comfortable");
});

Deno.test("PROXY: 'grey but comfortable day' is ALLOWED", () => {
  const r = validatePostBundle({
    title: "[1 PM] Mild afternoon in Orlando",
    description: "Plan on a grey but comfortable day across Orlando.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, true, `Failures: ${JSON.stringify(r.failures)}`);
});

// "Coming Up"
Deno.test("PROXY: 'over Coming Up' is BLOCKED", () => {
  const r = validatePostBundle({
    title: "[6 PM] Storms over Coming Up tonight",
    description: "Showers expected over Coming Up.",
    expectedCity: "Gainesville",
  });
  assertEquals(r.ok, false);
  const m = r.failures.find((f) => f.reason === "banned_location_proxy");
  assertEquals(m?.matched, "Coming Up");
});

Deno.test("PROXY: 'storms coming up tonight' is ALLOWED", () => {
  const r = validatePostBundle({
    title: "[6 PM] Evening update for Gainesville",
    description: "Heavy storms coming up tonight across Gainesville.",
    expectedCity: "Gainesville",
  });
  assertEquals(r.ok, true, `Failures: ${JSON.stringify(r.failures)}`);
});

// "Clear Skies"
Deno.test("PROXY: 'across Clear Skies' is BLOCKED", () => {
  const r = validatePostBundle({
    title: "[8 AM] Sunshine across Clear Skies",
    description: "Bright morning across Clear Skies today.",
    expectedCity: "Tampa",
  });
  assertEquals(r.ok, false);
  const m = r.failures.find((f) => f.reason === "banned_location_proxy");
  assertEquals(m?.matched, "Clear Skies");
});

Deno.test("PROXY: 'clear skies tonight over Tampa' is ALLOWED", () => {
  const r = validatePostBundle({
    title: "[6 PM] Calm evening in Tampa",
    description: "Expect clear skies tonight over Tampa.",
    expectedCity: "Tampa",
  });
  assertEquals(r.ok, true, `Failures: ${JSON.stringify(r.failures)}`);
});

// "Heads Up"
Deno.test("PROXY: 'in Heads Up' is BLOCKED", () => {
  const r = validatePostBundle({
    title: "[1 PM] Today's weather in Heads Up",
    description: "Forecast for Heads Up this afternoon.",
    expectedCity: "Miami",
  });
  assertEquals(r.ok, false);
  // Either banned_location_proxy or suspicious_location_phrase is acceptable;
  // we just need a failure on something related to the hallucinated location.
  assertEquals(r.failures.length > 0, true);
});

Deno.test("PROXY: 'heads up for rain tonight' is ALLOWED", () => {
  const r = validatePostBundle({
    title: "[6 PM] Evening update for Miami",
    description: "Heads up for rain tonight across Miami.",
    expectedCity: "Miami",
  });
  assertEquals(r.ok, true, `Failures: ${JSON.stringify(r.failures)}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression: natural narration variants stay allowed
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("REGRESSION: mixed natural phrases in description ALLOWED", () => {
  const r = validatePostBundle({
    title: "[8 AM] Morning forecast for Orlando",
    description:
      "Heads up — clear skies this morning, with storms coming up by evening across Orlando.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, true, `Failures: ${JSON.stringify(r.failures)}`);
});

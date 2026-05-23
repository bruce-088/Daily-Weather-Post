// Phase 5E: contextual-only blocking of "But Comfortable".
//
// Run with:  deno test supabase/functions/_shared/text-sanitizer.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validatePostBundle } from "./text-sanitizer.ts";

Deno.test("Phase 5E: location-slot 'in But Comfortable' is BLOCKED", () => {
  const r = validatePostBundle({
    title: "[8 AM] Today's weather in But Comfortable",
    description: "Heads up for the forecast in But Comfortable today.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, false, "Expected block on location-slot hallucination");
  const matched = r.failures.find((f) => f.reason === "banned_location_proxy");
  assertEquals(matched?.matched, "But Comfortable");
});

Deno.test("Phase 5E: natural prose 'grey but comfortable day' is ALLOWED", () => {
  const r = validatePostBundle({
    title: "[1 PM] Mild afternoon in Orlando",
    description: "Plan on a grey but comfortable day across Orlando.",
    expectedCity: "Orlando",
  });
  assertEquals(r.ok, true, `Should not flag natural prose. Failures: ${JSON.stringify(r.failures)}`);
});

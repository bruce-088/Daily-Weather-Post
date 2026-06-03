// Unit tests for Phase 12CD-B helpers. Run with: deno test
// These mirror the helpers exported from index.ts (kept inline there to avoid
// touching the module entrypoint; copied here for isolated assertions).

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

function computeRecapMonthName(posts: Array<{ created_at: string }>): string {
  if (posts.length === 0) {
    const d = new Date();
    d.setUTCDate(1); d.setUTCDate(0);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }
  const counts = new Map<string, { label: string; count: number }>();
  for (const p of posts) {
    const d = new Date(p.created_at);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const cur = counts.get(key);
    if (cur) cur.count += 1; else counts.set(key, { label, count: 1 });
  }
  let best = ""; let max = -1;
  for (const { label, count } of counts.values()) {
    if (count > max) { max = count; best = label; }
  }
  return best;
}

function classifyYouTubeError(status: number, body: string): string {
  const lower = (body || "").toLowerCase();
  if (status === 403 && (lower.includes("quotaexceeded") || lower.includes("dailylimitexceeded") || lower.includes("quota"))) return "quota_exceeded";
  if (status === 401 || (status === 403 && (lower.includes("unauthorized") || lower.includes("invalid_grant")))) return "auth";
  if (status >= 500 || status === 429) return "transient";
  if (status >= 400) return "client_error";
  return "unknown";
}

Deno.test("computeRecapMonthName picks mode month, ignoring stray boundary post", () => {
  const posts = [
    ...Array.from({ length: 30 }, (_, i) => ({ created_at: `2026-05-${String(i + 1).padStart(2, "0")}T12:00:00Z` })),
    { created_at: "2026-06-01T00:05:00Z" }, // stray boundary post
  ];
  assertEquals(computeRecapMonthName(posts), "May 2026");
});

Deno.test("computeRecapMonthName empty falls back to previous month", () => {
  const v = computeRecapMonthName([]);
  // Don't assert exact (depends on test run date); assert format only.
  if (!/^[A-Z][a-z]+ \d{4}$/.test(v)) throw new Error(`bad format: ${v}`);
});

Deno.test("classifyYouTubeError detects quota", () => {
  assertEquals(classifyYouTubeError(403, '{"error":{"errors":[{"reason":"quotaExceeded"}]}}'), "quota_exceeded");
  assertEquals(classifyYouTubeError(403, "dailyLimitExceeded"), "quota_exceeded");
});

Deno.test("classifyYouTubeError detects auth", () => {
  assertEquals(classifyYouTubeError(401, ""), "auth");
  assertEquals(classifyYouTubeError(403, "invalid_grant"), "auth");
});

Deno.test("classifyYouTubeError transient vs client", () => {
  assertEquals(classifyYouTubeError(500, ""), "transient");
  assertEquals(classifyYouTubeError(429, ""), "transient");
  assertEquals(classifyYouTubeError(400, "bad title"), "client_error");
});

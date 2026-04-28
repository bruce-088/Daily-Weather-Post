// Shared location-accuracy guardrails for SkyBrief AI generations.
// Goal: prevent the model from hallucinating landmarks/stadiums/universities
// that are NOT in the selected city (e.g. "Kyle Field" appearing in a
// Gainesville, FL caption).
//
// Strategy:
//   1. A strict system-prompt rule appended to every AI call.
//   2. A small allowlist of verified local landmarks per city. ONLY these
//      may be referenced when the "Local Legend" tone is active.
//   3. A post-generation validator that scans output for known foreign
//      landmark keywords and flags it for one regeneration.

export const LOCATION_ACCURACY_RULES = [
  "STRICT LOCATION ACCURACY (highest priority — overrides every other rule):",
  "- You must NOT invent or reference landmarks, stadiums, universities, neighborhoods, parks, streets, or businesses.",
  "- Only use the city and state EXACTLY as provided in the input fields.",
  "- Do NOT guess or hallucinate local references. If unsure, omit the reference entirely.",
  "- The ONLY specific local places you may mention are those explicitly listed in the 'VERIFIED LOCAL LANDMARKS' section of this prompt (if present). If that section is absent or empty, do not name any specific place at all.",
  "- For generic local color, prefer neutral phrasing: \"around town\", \"across {city}\", \"throughout the area\".",
  "- Never reference another city, another state, another country, or anything outside the provided city/state.",
].join("\n");

// Verified, hand-curated allowlist. Add cities as needed.
// Keys are normalized lowercase city names.
const VERIFIED_LANDMARKS: Record<string, string[]> = {
  gainesville: [
    "The Swamp",
    "Ben Hill Griffin Stadium",
    "University of Florida",
    "UF campus",
    "Midtown",
    "Depot Park",
    "the Hippodrome",
    "Paynes Prairie",
    "Lake Alice",
    "Bo Diddley Plaza",
  ],
  miami: ["South Beach", "Wynwood", "Brickell", "Bayside", "Little Havana"],
  orlando: ["Lake Eola", "Downtown Orlando", "Winter Park"],
  tampa: ["Bayshore Boulevard", "Ybor City", "Channelside", "Curtis Hixon Park"],
};

export function verifiedLandmarksFor(city?: string | null): string[] {
  const key = String(city || "").trim().toLowerCase();
  return VERIFIED_LANDMARKS[key] || [];
}

export function buildVerifiedLandmarksBlock(city?: string | null): string {
  const list = verifiedLandmarksFor(city);
  if (list.length === 0) {
    return [
      "VERIFIED LOCAL LANDMARKS: (none provided)",
      "- Do NOT name any specific landmark, stadium, university, neighborhood, park, street, or business.",
      "- Use only generic phrasing like \"around town\" or \"across the area\".",
    ].join("\n");
  }
  return [
    `VERIFIED LOCAL LANDMARKS for ${city}:`,
    ...list.map((l) => "- " + l),
    "You MAY reference items from the list above when natural. You MUST NOT reference anything not on this list.",
  ].join("\n");
}

// ---------- Validation ----------
// Known landmarks that commonly hallucinate into the wrong city.
// If any of these appear in output and they are NOT in the selected city's
// allowlist, we flag the caption for regeneration.
const FOREIGN_LANDMARK_KEYWORDS: string[] = [
  // College football stadiums (very common AI hallucinations)
  "Kyle Field",          // Texas A&M
  "Bryant-Denny",        // Alabama
  "Tiger Stadium",       // LSU
  "Neyland Stadium",     // Tennessee
  "Sanford Stadium",     // Georgia
  "Doak Campbell",       // FSU
  "Camp Randall",        // Wisconsin
  "Beaver Stadium",      // Penn State
  "The Big House",       // Michigan
  "Ohio Stadium",        // Ohio State
  "Memorial Stadium",
  "Jordan-Hare",         // Auburn
  "Razorback Stadium",   // Arkansas
  "Williams-Brice",      // South Carolina
  "Vaught-Hemingway",    // Ole Miss
  // NFL / pro venues
  "AT&T Stadium", "MetLife Stadium", "SoFi Stadium", "Lambeau Field",
  "Soldier Field", "Arrowhead Stadium", "Hard Rock Stadium",
  // Universities commonly mis-attributed
  "Texas A&M", "LSU campus", "Auburn University", "Clemson University",
  // Famous landmarks
  "Times Square", "Golden Gate", "Eiffel Tower", "Hollywood Sign",
  "Space Needle", "French Quarter", "Bourbon Street",
];

export interface LocationValidationResult {
  ok: boolean;
  hits: string[]; // foreign landmark substrings detected
}

/**
 * Scan generated text for landmark keywords that are NOT in the city's
 * verified allowlist. Returns ok=false with the list of offending strings.
 */
export function validateCaptionLocation(
  text: string,
  city?: string | null,
): LocationValidationResult {
  const allow = new Set(verifiedLandmarksFor(city).map((s) => s.toLowerCase()));
  const lower = String(text || "").toLowerCase();
  const hits: string[] = [];
  for (const kw of FOREIGN_LANDMARK_KEYWORDS) {
    if (allow.has(kw.toLowerCase())) continue;
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
  }
  return { ok: hits.length === 0, hits };
}

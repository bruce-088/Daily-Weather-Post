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
    "University of Florida",
    "UF campus",
    "The Swamp",
    "Downtown Gainesville",
    "Depot Park",
    "Midtown",
    "Archer Road",
  ],
  miami: ["South Beach", "Wynwood", "Brickell", "Bayside", "Little Havana"],
  orlando: ["Lake Eola", "Downtown Orlando", "Winter Park"],
  tampa: ["Bayshore Boulevard", "Ybor City", "Channelside", "Curtis Hixon Park"],
};

export function verifiedLandmarksFor(city?: string | null): string[] {
  const key = String(city || "").trim().toLowerCase();
  return VERIFIED_LANDMARKS[key] || [];
}

// In-memory rotation tracker — avoid picking the SAME landmark twice in a row
// for the same city within a single edge-function instance lifetime.
const lastPickByCity = new Map<string, string>();

/**
 * Pick one verified landmark for the given city, avoiding the most recent pick
 * when possible. Returns null when the city has no allowlist.
 */
export function pickLocalReference(city?: string | null): string | null {
  const list = verifiedLandmarksFor(city);
  if (list.length === 0) return null;
  const key = String(city || "").trim().toLowerCase();
  const last = lastPickByCity.get(key);
  const pool = list.length > 1 && last ? list.filter((l) => l !== last) : list;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  lastPickByCity.set(key, pick);
  return pick;
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
  const suggested = pickLocalReference(city);
  return [
    `VERIFIED LOCAL REFERENCES for ${city} (the ONLY local places you may name):`,
    ...list.map((l) => "- " + l),
    "",
    "LOCAL FLAVOR RULES:",
    "- You MAY include AT MOST ONE local reference from the list above.",
    "- Only include it if it fits NATURALLY with today's weather (e.g. heat → \"stay cool out near UF campus\"; rain → \"rain moving through Downtown Gainesville\"; perfect day → \"great day to be out at Depot Park\").",
    "- If none fits naturally, omit the reference entirely — do NOT force one in.",
    "- Do NOT invent, guess, or modify any location name. Use the listed wording exactly.",
    "- Never name two different places in the same caption.",
    suggested ? `- SUGGESTED REFERENCE for this generation (use ONLY if it fits the weather, otherwise skip): "${suggested}"` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Sanitize text by replacing any landmark mentions that are NOT in the
 * city's verified allowlist with safe generic phrasing. Used as a final
 * safety net after AI output.
 */
export function stripUnverifiedReferences(text: string, city?: string | null): string {
  const allow = verifiedLandmarksFor(city).map((s) => s.toLowerCase());
  let out = String(text || "");
  for (const kw of FOREIGN_LANDMARK_KEYWORDS) {
    if (allow.includes(kw.toLowerCase())) continue;
    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    out = out.replace(re, city ? `around ${city}` : "across the area");
  }
  return out;
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

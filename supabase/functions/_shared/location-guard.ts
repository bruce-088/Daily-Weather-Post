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

// ─────────────────────────────────────────────────────────────
// City Visual Anchors — used to constrain IMAGE/VIDEO generation
// prompts so AI never depicts foreign universities, skylines, or
// landmarks. Curated per city; "avoid" lists common confusables.
// ─────────────────────────────────────────────────────────────
export interface CityVisualAnchor {
  landmarks: string[];
  avoid: string[];
}

export const CITY_VISUAL_ANCHORS: Record<string, CityVisualAnchor> = {
  gainesville: {
    landmarks: [
      "University of Florida campus",
      "Ben Hill Griffin Stadium (The Swamp)",
      "UF campus oak trees",
      "Depot Park",
      "Downtown Gainesville",
    ],
    avoid: ["FSU", "Florida State", "UCF", "Miami campus", "Doak Campbell", "Tallahassee skyline"],
  },
  orlando: {
    landmarks: [
      "downtown Orlando skyline",
      "Lake Eola fountain",
      "theme park skyline silhouette",
      "Winter Park tree-lined streets",
    ],
    avoid: ["UF campus", "The Swamp", "Tallahassee", "Miami skyline", "South Beach"],
  },
  miami: {
    landmarks: ["South Beach", "Wynwood murals", "Brickell skyline", "Bayside Marketplace"],
    avoid: ["Orlando theme parks", "UF campus", "Tallahassee", "Tampa skyline"],
  },
  tampa: {
    landmarks: ["Tampa Bay waterfront", "Bayshore Boulevard", "Ybor City", "downtown Tampa skyline"],
    avoid: ["Miami skyline", "Orlando theme parks", "UF campus", "South Beach"],
  },
};

export function cityVisualAnchorsFor(city?: string | null): CityVisualAnchor | null {
  const key = String(city || "").trim().toLowerCase();
  return CITY_VISUAL_ANCHORS[key] || null;
}

/**
 * Build a strict instruction block for image/video generation prompts.
 * Inject this verbatim into any AI image-gen prompt that may include
 * location imagery so the model only depicts the correct city.
 */
export function buildCityVisualBlock(city?: string | null): string {
  const anchor = cityVisualAnchorsFor(city);
  const cityName = String(city || "").trim();
  if (!anchor) {
    return [
      "CITY VISUAL ACCURACY (strict):",
      cityName
        ? `- If any location imagery appears, it must visually represent ${cityName} only.`
        : "- Do NOT depict any specific city, university, stadium, or landmark.",
      "- Do NOT depict any university, stadium, skyline, or landmark from another city or state.",
      "- When unsure, use generic weather/sky imagery with NO identifiable landmarks.",
    ].join("\n");
  }
  return [
    `CITY VISUAL ACCURACY for ${cityName} (strict — overrides style preferences):`,
    `- If using location imagery, ONLY use landmarks associated with ${cityName}.`,
    `- Approved visual anchors: ${anchor.landmarks.join(", ")}.`,
    `- NEVER depict or reference: ${anchor.avoid.join(", ")}.`,
    "- Do NOT invent skylines, campuses, stadiums, or signage from other cities.",
    "- When in doubt, prefer generic sky/weather imagery over a wrong landmark.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────
// Local Identity + Brand Safety + Diversity rules.
// Injected alongside CITY_VISUAL_ANCHORS into both image-gen and
// caption prompts. Per-city "vibe" guidance keeps content locally
// authentic while avoiding copyrighted/trademarked branding.
// ─────────────────────────────────────────────────────────────
export interface CityIdentity {
  vibe: string;          // descriptive aesthetic / texture palette
  prefer: string[];      // visual elements to lean into
  avoid_brands: string[]; // brand-safety items to never depict/name
}

export const CITY_IDENTITIES: Record<string, CityIdentity> = {
  gainesville: {
    vibe: "college-town textures: brick buildings, mossy oak canopies, walkable campus settings, cozy academic feel",
    prefer: [
      "brick architecture",
      "Spanish-moss-draped oak trees",
      "tree-lined campus paths",
      "warm afternoon light through canopy",
      "small-town downtown storefronts",
    ],
    avoid_brands: [
      "FSU logos / Seminoles iconography",
      "UCF logos / Knights iconography",
      "specific university trademarks, mascots, or wordmarks",
      "official Gators logo lockups (use 'inspired by' UF aesthetic only)",
    ],
  },
  orlando: {
    vibe: "vibrant, high-energy: skylines, palm trees, theme-park-style horizons, Lake Eola fountain vibes",
    prefer: [
      "downtown skyline silhouettes",
      "palm trees against sunset",
      "fountain / lake reflections",
      "playful pastel sunsets",
      "wide horizons with distant theme-park-style structures",
    ],
    avoid_brands: [
      "Disney / Mickey iconography or castle silhouettes",
      "Universal Studios trademarks or globe",
      "SeaWorld branding",
      "any specific theme park logos, characters, or rides",
    ],
  },
  miami: {
    vibe: "art-deco coastal energy: pastel facades, neon, palms, ocean horizons, Wynwood mural color",
    prefer: ["pastel art-deco facades", "neon-lit streets at dusk", "ocean + palm horizons", "vibrant mural color blocks"],
    avoid_brands: ["specific hotel/club logos", "celebrity likenesses", "sports team trademarks"],
  },
  tampa: {
    vibe: "bayfront calm: waterfront walks, sailboats, historic Ybor brick, soft Gulf light",
    prefer: ["bayfront skyline", "sailboats on the water", "brick streets / historic architecture", "soft Gulf-coast pastel skies"],
    avoid_brands: ["Buccaneers/Lightning logos", "specific stadium branding", "team mascots"],
  },
};

export function cityIdentityFor(city?: string | null): CityIdentity | null {
  const key = String(city || "").trim().toLowerCase();
  return CITY_IDENTITIES[key] || null;
}

/**
 * Build a Local Identity + Brand Safety + Diversity instruction block.
 * Inject into image-gen AND caption prompts so the model knows which
 * "vibe" to lean into and what trademarks to never depict or name.
 */
export function buildLocalIdentityBlock(city?: string | null): string {
  const cityName = String(city || "").trim();
  const identity = cityIdentityFor(city);

  const lines: string[] = [];

  // [LOCAL IDENTITY RULE] — per-city
  if (identity && cityName) {
    lines.push(`[LOCAL IDENTITY — ${cityName}]`);
    lines.push(`- Vibe: ${identity.vibe}.`);
    lines.push(`- Prefer: ${identity.prefer.join("; ")}.`);
    lines.push(
      `- Make local references feel "inspired by" ${cityName}, not a literal copy of any specific institution or property.`,
    );
  } else if (cityName) {
    lines.push(`[LOCAL IDENTITY — ${cityName}]`);
    lines.push(`- Lean into the authentic local vibe and texture of ${cityName}.`);
    lines.push(`- Make references feel "inspired by" the area, not a copy of a specific property.`);
  }

  // [BRAND SAFETY CONSTRAINT] — global + per-city avoid lists
  lines.push("");
  lines.push("[BRAND SAFETY CONSTRAINT]");
  lines.push("- Do NOT include copyrighted logos, registered trademarks, official wordmarks, or protected branding in any visual or text.");
  lines.push("- Do NOT name or depict specific mascots, team logos, theme-park characters, or corporate iconography.");
  lines.push("- Focus on the VIBE and AESTHETIC of the city — never the legal trademarks.");
  if (identity?.avoid_brands?.length) {
    lines.push(`- For ${cityName}, specifically avoid: ${identity.avoid_brands.join("; ")}.`);
  }

  // [DIVERSITY RULE] — prevent default-to-sky monotony
  lines.push("");
  lines.push("[DIVERSITY RULE]");
  lines.push("- Do NOT default exclusively to plain \"sky\" visuals.");
  lines.push(
    cityName
      ? `- If the weather is clear or mild, prioritize a ${cityName}-specific landscape, streetscape, or background to keep content fresh and local.`
      : "- If the weather is clear or mild, prioritize a city-specific landscape or background to keep content fresh and local.",
  );
  lines.push("- Vary composition (skyline, street-level, nature, landmark vibe) across posts — avoid repeating the same framing.");

  return lines.join("\n");
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

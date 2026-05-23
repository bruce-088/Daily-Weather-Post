// Nuclear text sanitizer / validation gate.
//
// Phase 1 Emergency Fix: blocks posts whose title/description contain known
// hallucinated location proxies ("Weather Update", "Coming Up", template
// placeholders) or a suspicious "in <NotExpectedCity>!" pattern.
//
// Option B scope: banned-fragment checks run on TITLE + DESCRIPTION only.
// Caption and voiceScript are checked for template placeholders and for the
// "in X!" mismatch when expectedCity is supplied, but natural weather
// narration like "clear skies ahead" is NOT blocked.

export type FieldName = "title" | "description" | "caption" | "voiceScript";

export interface ValidateOptions {
  field: FieldName;
  expectedCity?: string | null;
  /** When true, run the full banned-fragment list (title+description). */
  strictBannedFragments?: boolean;
}

export interface ValidateResult {
  ok: boolean;
  reason?: string;
  matched?: string;
}

/** Phrases that should NEVER appear in a published title or description.
 *  These are observed hallucinated location-proxy fragments. */
export const BANNED_FRAGMENTS_STRICT: string[] = [
  "Weather Update",
  "Coming Up",
  "But Comfortable",
  "Not Need",
  "Clear Skies", // only blocked in title/description, not narration
  "Heads Up",
];

/** Template placeholders that escaped a prompt — banned everywhere. */
export const TEMPLATE_PLACEHOLDERS: RegExp[] = [
  /\{\s*city\s*\}/i,
  /\[\s*city\s*\]/i,
  /\{\s*location\s*\}/i,
  /\[\s*location\s*\]/i,
  /\{\{[^}]+\}\}/,
  /<\s*city\s*>/i,
];

/** Suspicious "in <Something>!" pattern where <Something> isn't the city. */
function suspiciousInPhrase(text: string, expectedCity?: string | null): string | null {
  // matches "in <Capitalized Word(s)>!" with up to 3 capitalized words
  const re = /\bin\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s*!/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const candidate = m[1].trim();
    // If candidate matches one of the known banned fragments → suspicious.
    if (BANNED_FRAGMENTS_STRICT.some((b) => candidate.toLowerCase() === b.toLowerCase())) {
      return candidate;
    }
    // If expectedCity is provided and candidate doesn't include it → suspicious.
    if (expectedCity) {
      const cityLower = expectedCity.toLowerCase();
      if (!candidate.toLowerCase().includes(cityLower)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Validate a single field. Returns ok=false with a reason when the content
 * contains a banned fragment, template placeholder, or suspicious "in X!"
 * mismatch. Caller should mark the post validation_failed and skip publish.
 */
export function validateAndSanitize(text: string, opts: ValidateOptions): ValidateResult {
  const raw = (text || "").trim();
  if (!raw) {
    return { ok: false, reason: `${opts.field}_empty` };
  }

  // 1. Template placeholders — always banned in every field.
  for (const re of TEMPLATE_PLACEHOLDERS) {
    const m = raw.match(re);
    if (m) {
      return { ok: false, reason: "template_placeholder", matched: m[0] };
    }
  }

  // 2. Banned fragments — strict scope (title + description).
  if (opts.strictBannedFragments) {
    const lower = raw.toLowerCase();
    for (const phrase of BANNED_FRAGMENTS_STRICT) {
      if (lower.includes(phrase.toLowerCase())) {
        return { ok: false, reason: "banned_fragment", matched: phrase };
      }
    }
  }

  // 3. Suspicious "in <NotExpectedCity>!" — applies everywhere.
  const sus = suspiciousInPhrase(raw, opts.expectedCity ?? null);
  if (sus) {
    return { ok: false, reason: "suspicious_location_phrase", matched: `in ${sus}!` };
  }

  return { ok: true };
}

export interface PostBundle {
  title?: string | null;
  description?: string | null;
  caption?: string | null;
  voiceScript?: string | null;
  expectedCity?: string | null;
}

export interface BundleResult {
  ok: boolean;
  failures: Array<{ field: FieldName; reason: string; matched?: string }>;
}

/**
 * Aggregate validator for a full post bundle.
 *
 * Option B scope:
 *   - title         → strict banned-fragment check
 *   - description   → strict banned-fragment check
 *   - caption       → placeholder + suspicious-"in X!" only
 *   - voiceScript   → placeholder + suspicious-"in X!" only
 */
export function validatePostBundle(bundle: PostBundle): BundleResult {
  const failures: BundleResult["failures"] = [];
  const expectedCity = bundle.expectedCity ?? null;

  const checks: Array<{ field: FieldName; text: string; strict: boolean }> = [
    { field: "title", text: bundle.title ?? "", strict: true },
    { field: "description", text: bundle.description ?? "", strict: true },
    { field: "caption", text: bundle.caption ?? "", strict: false },
    { field: "voiceScript", text: bundle.voiceScript ?? "", strict: false },
  ];

  for (const c of checks) {
    // Skip empty optional fields (caption / voiceScript can be missing).
    if (!c.text && (c.field === "caption" || c.field === "voiceScript")) continue;
    const r = validateAndSanitize(c.text, {
      field: c.field,
      expectedCity,
      strictBannedFragments: c.strict,
    });
    if (!r.ok) {
      failures.push({ field: c.field, reason: r.reason || "invalid", matched: r.matched });
    }
  }

  return { ok: failures.length === 0, failures };
}

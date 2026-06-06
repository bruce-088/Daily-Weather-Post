// Phase 13C — shared "anti-repetition" helpers.
//
// Centralizes:
//   • Caption opener rotation (5 templates) — used by generate-caption and
//     process-scheduled-posts so manual and auto posts get the same variety.
//   • Tag pool rotation — picks 6 core + ~6 rotating tags per post from a
//     larger pool so YouTube doesn't see an identical 12-tag fingerprint
//     on every upload.
//
// All selectors are DETERMINISTIC seeded on (city + slot + local-date) so:
//   – the same post regenerated within the same slot produces the same
//     output (idempotent),
//   – consecutive slots/days vary,
//   – we never need to read prior posts from the DB.

// ── Deterministic seed ────────────────────────────────────────────────────

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function seedFor(city: string, slot: string | null | undefined, date?: Date): number {
  const d = date ?? new Date();
  const key = `${city.toLowerCase().trim()}|${(slot || "").toLowerCase()}|${d.toISOString().slice(0, 10)}`;
  return hashStr(key);
}

// ── Caption opener rotation ───────────────────────────────────────────────

export type SlotName = "morning" | "afternoon" | "evening" | string;

const SLOT_LABEL: Record<string, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

function slotLabel(slot: string | null | undefined): string {
  const key = String(slot || "").toLowerCase();
  return SLOT_LABEL[key] || (key ? key[0].toUpperCase() + key.slice(1) : "Update");
}

function timeOfDayGreeting(slot: string | null | undefined): string {
  const key = String(slot || "").toLowerCase();
  if (key === "morning") return "morning";
  if (key === "afternoon") return "afternoon";
  if (key === "evening") return "evening";
  return "day";
}

function conditionAdjective(condition?: string | null): { phrase: string; emoji: string } {
  const c = String(condition || "").toLowerCase();
  if (/storm|thunder/.test(c)) return { phrase: "Stormy skies", emoji: "⛈" };
  if (/rain|shower|drizzle/.test(c)) return { phrase: "Rain moving", emoji: "🌧" };
  if (/snow|sleet/.test(c))         return { phrase: "Snow falling", emoji: "❄️" };
  if (/fog|mist|haze/.test(c))      return { phrase: "Fog rolling in", emoji: "🌫" };
  if (/cloud|overcast/.test(c))     return { phrase: "Cloudy skies", emoji: "☁️" };
  if (/clear|sun/.test(c))          return { phrase: "Sunny skies", emoji: "☀️" };
  return { phrase: "Weather update", emoji: "📡" };
}

/**
 * Build the opener line. Rotates across 5 templates by deterministic seed.
 * Falls back to the classic 📍 beacon if anything throws.
 */
export function buildOpener(opts: {
  city: string;
  slot?: string | null;
  condition?: string | null;
  date?: Date;
}): string {
  try {
    const { city } = opts;
    const slot = opts.slot ?? null;
    const label = slotLabel(slot);
    const tod = timeOfDayGreeting(slot);
    const cond = conditionAdjective(opts.condition);
    const slotLc = String(slot || "update").toLowerCase();
    const seed = seedFor(city, slot, opts.date);
    const variant = seed % 5;

    switch (variant) {
      case 0:
        return `📍 ${city} · ${label} Update`;
      case 1:
        return `Planning your day in ${city}? 🤔 Here's your ${slotLc} forecast:`;
      case 2:
        return `${cond.phrase} in ${city} today ${cond.emoji} ${label} details:`;
      case 3: {
        const cap = tod[0].toUpperCase() + tod.slice(1);
        return `Good ${cap}, ${city}! ☕ Here's what to expect:`;
      }
      case 4:
      default:
        return `${city} ${slotLc} check: ${cond.emoji} ${cond.phrase} on tap.`;
    }
  } catch {
    return `📍 ${opts.city} · ${slotLabel(opts.slot)} Update`;
  }
}

/**
 * Inject the rotating opener into an existing caption, replacing any
 * pre-existing 📍 beacon on the first non-empty line. Mirrors the legacy
 * beacon-injection logic in generate-caption + process-scheduled-posts.
 */
export function injectOpener(caption: string, opts: {
  city: string;
  slot?: string | null;
  condition?: string | null;
  date?: Date;
}): string {
  const opener = buildOpener(opts);
  const lines = (caption || "").split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim().length > 0);
  // Replace pre-existing opener line (either 📍 beacon or any of our 5 patterns).
  const looksLikeOpener = (l: string) =>
    /^\s*📍/.test(l) ||
    /^\s*Planning your day in /i.test(l) ||
    /^\s*Good (Morning|Afternoon|Evening|Day),/i.test(l) ||
    /check:\s*[^\w]/i.test(l) ||
    /(today|details:)/i.test(l) && /(skies|weather update|rain|fog|snow|sun|storm)/i.test(l);
  if (firstIdx >= 0 && looksLikeOpener(lines[firstIdx])) {
    lines[firstIdx] = opener;
    return lines.join("\n");
  }
  return `${opener}\n\n${(caption || "").replace(/^\s+/, "")}`;
}

// ── YouTube tag rotation ──────────────────────────────────────────────────

export interface TagRotationOpts {
  city: string;             // e.g. "Gainesville"
  state?: string | null;    // e.g. "Florida" / "FL"
  slot?: string | null;     // "morning" | "afternoon" | "evening"
  condition?: string | null;
  highTemp?: number | null;
  date?: Date;
}

/**
 * Build a deduped tag list: 6 core (always-on) + ~6 rotating (deterministic
 * subset of a larger pool). Output is lowercased phrases without # — the
 * caller (youtube-adapter) decides between bare tags for `snippet.tags` and
 * #-prefixed tags for description hashtags.
 *
 * Cap: 14 tags, all under YouTube's 500-char combined limit.
 */
export function buildRotatingTags(opts: TagRotationOpts): string[] {
  const city = opts.city.trim();
  const cityLc = city.toLowerCase().replace(/\s+/g, " ");
  const cityNoSpace = cityLc.replace(/\s+/g, "");
  const slotLc = String(opts.slot || "").toLowerCase();
  const cond = String(opts.condition || "").toLowerCase();
  const temp = Number(opts.highTemp || 0);
  const isFlorida = /florida|fl/i.test(String(opts.state || "")) ||
    /gainesville|orlando|miami|tampa|jacksonville|tallahassee|ocala/i.test(cityLc);

  // ── CORE (always include, 6 tags) ──
  const core: string[] = [
    "#Shorts",
    "weather",
    `${cityLc} weather`,
    isFlorida ? "florida weather" : "local weather",
    "weather update",
    slotLc ? `${slotLc} forecast` : "daily forecast",
  ];

  // ── ROTATING POOL ──
  const pool: string[] = [];

  // Condition-aware tags
  if (/storm|thunder|tornado|hurricane/.test(cond)) {
    pool.push("storm update", "severe weather", "thunderstorm forecast");
  }
  if (/rain|drizzle|shower/.test(cond)) {
    pool.push("rainy day", "umbrella weather", "stay dry", "rain forecast");
  }
  if (/snow|sleet|blizzard/.test(cond)) {
    pool.push("snow forecast", "winter weather", "snow day");
  }
  if (/fog|mist|haze/.test(cond)) {
    pool.push("foggy morning", "low visibility");
  }
  if (/cloud|overcast/.test(cond)) {
    pool.push("cloudy day", "overcast skies", "gray skies");
  }
  if (/clear|sun/.test(cond)) {
    pool.push("sunny day", "clear skies", "beautiful weather");
  }
  // Temp-aware
  if (temp >= 90) pool.push("heat advisory", "stay hydrated", "hot weather");
  else if (temp >= 80) pool.push("warm weather", "summer vibes");
  if (temp > 0 && temp <= 55) pool.push("cool weather", "jacket weather", "chilly forecast");

  // Always-relevant rotating set
  pool.push(
    "weekend forecast",
    "travel weather",
    "outdoor plans",
    "weather aware",
    "local weather",
    "weather shorts",
    "daily forecast",
    "weather now",
    "forecast update",
    `${cityLc} forecast`,
    `${cityLc} today`,
    isFlorida ? `${cityNoSpace} florida` : `${cityNoSpace} weather today`,
  );

  // Seeded deterministic shuffle, pick 6.
  const seed = seedFor(city, opts.slot, opts.date);
  const ROTATE_COUNT = 6;
  const seen = new Set<string>(core.map((t) => t.toLowerCase()));
  const ranked = pool
    .filter((t, i, a) => a.indexOf(t) === i)
    .map((t, i) => ({ t, k: ((seed >>> 0) ^ ((i + 1) * 2654435761)) >>> 0 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.t);

  const rotating: string[] = [];
  for (const t of ranked) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    // Sanity: reject any tag containing repeated "weather weather" or
    // duplicated tokens — defensive belt-and-suspenders against Phase 13C
    // bug #1 ever recurring.
    if (/\b(\w+)\b\s+\b\1\b/i.test(t)) continue;
    seen.add(key);
    rotating.push(t);
    if (rotating.length >= ROTATE_COUNT) break;
  }

  return [...core, ...rotating].slice(0, 14);
}

// Shared helpers for SkyBrief AI caption "Voice & Tone" presets, weather-triggered
// life tips, time-of-day greetings, and dynamic hashtags. Used by both the
// manual `generate-caption` flow and automated/scheduled posting flows so
// every caption — manual, scheduled, or auto-posted — stays on-brand.

export type CaptionTone = "professional" | "hype" | "funny" | "local_legend";

export function normalizeTone(input: unknown): CaptionTone {
  const v = String(input || "").toLowerCase().trim();
  if (v === "hype" || v === "energetic") return "hype";
  if (v === "funny" || v === "sarcastic") return "funny";
  if (v === "local_legend" || v === "local") return "local_legend";
  return "professional";
}

export function toneInstruction(tone: CaptionTone, city?: string): string {
  switch (tone) {
    case "hype":
      return [
        "TONE: HYPE / ENERGETIC.",
        "- Bring high energy. Use exclamation points sparingly but deliberately.",
        "- Use 3–4 weather emojis (lightning, sun, fire, wind) where they amplify impact.",
        "- Short, punchy sentences. Sound like a hype-man for the sky.",
        "- Still factually accurate — never invent conditions.",
      ].join("\n");
    case "funny":
      return [
        "TONE: FUNNY / SARCASTIC.",
        "- Lead with a witty, dry observation about today's weather.",
        "- Light sarcasm is welcome (e.g. \"Humidity is currently set to 'Steam Room'.\").",
        "- Never punch down, never mock people, never be mean about a city.",
        "- Keep facts intact — the joke is the framing, not the data.",
      ].join("\n");
    case "local_legend":
      return [
        "TONE: LOCAL LEGEND.",
        `- Write like a beloved local who knows ${city || "this city"} inside and out.`,
        "- Reference real local landmarks and culture naturally when it fits the weather.",
        `- For Gainesville specifically: feel free to mention places like \"The Swamp\", Midtown, Depot Park, the Hippodrome, UF campus, or Paynes Prairie when relevant.`,
        "- Use 0–2 emojis. Keep it warm, neighborly, in-the-know.",
      ].join("\n");
    case "professional":
    default:
      return [
        "TONE: PROFESSIONAL.",
        "- Clean, calm, news-style delivery. Think trusted local meteorologist.",
        "- Minimal emojis (0–2). No slang. No exclamation points unless severe weather.",
        "- Lead with the headline forecast in one tight sentence.",
      ].join("\n");
  }
}

/**
 * Weather-triggered "life tips" the AI MUST work into the caption when
 * relevant data is present. Returns "" when no tips apply.
 */
export function lifeTips(opts: {
  rainChance?: number | null;
  highTemp?: number | null;
  lowTemp?: number | null;
  conditions?: string;
}): string {
  const tips: string[] = [];
  const rain = Number(opts.rainChance ?? 0);
  const high = Number(opts.highTemp ?? 0);
  const low = Number(opts.lowTemp ?? high);
  const cond = String(opts.conditions || "").toLowerCase();

  if (rain > 40) tips.push("Rain chance is elevated — mention bringing an umbrella OR driving with extra caution on wet roads.");
  if (high > 90) tips.push("High heat — mention hydrating, or staying in the shade during peak afternoon.");
  if (low < 50) tips.push("Cool temperatures — mention grabbing a jacket or layering up.");

  const isClear = /clear|sun|sunny|fair/.test(cond) && !/storm|rain/.test(cond);
  if (isClear && high >= 70 && high <= 80 && rain < 20) {
    tips.push("Perfect-day window — suggest one outdoor activity (a walk in the park, a patio coffee, a quick run).");
  }

  if (tips.length === 0) return "";
  return [
    "WEATHER-TRIGGERED LIFE TIPS (MUST include at least one when applicable):",
    ...tips.map((t) => "- " + t),
  ].join("\n");
}

/** Time-of-day opening line guidance. */
export function greetingForPeriod(period?: string | null, city?: string): string {
  const p = String(period || "").toLowerCase();
  const c = city || "everyone";
  if (p === "morning") return `OPENING LINE: Start with an energetic morning greeting like \"Rise and shine, ${c}…\" (vary the wording, but keep the morning energy).`;
  if (p === "afternoon") return `OPENING LINE: Start with a midday check-in like \"Lunch break weather check…\" or \"Afternoon update for ${c}…\" (vary the wording).`;
  if (p === "evening") return `OPENING LINE: Start with a wind-down line like \"Winding down your day, ${c}…\" or \"Evening forecast…\" (vary the wording).`;
  return "";
}

/**
 * Build 3–5 dynamic hashtags based on weather + city. Always includes the
 * city tag and #Weather. Returned as a single space-separated string ready
 * to append to the caption (no leading/trailing whitespace).
 */
export function buildHashtags(opts: {
  city?: string;
  state?: string;
  conditions?: string;
  highTemp?: number | null;
  rainChance?: number | null;
}): string {
  const tags = new Set<string>();
  const cityTag = (opts.city || "").replace(/[^a-zA-Z0-9]/g, "");
  if (cityTag) tags.add("#" + cityTag);
  tags.add("#Weather");

  const cond = String(opts.conditions || "").toLowerCase();
  const high = Number(opts.highTemp ?? 0);
  const rain = Number(opts.rainChance ?? 0);

  if (/rain|drizzle|shower/.test(cond) || rain >= 50) tags.add("#RainyDay");
  if (/storm|thunder/.test(cond)) tags.add("#StormWatch");
  if (/snow|flurr/.test(cond)) tags.add("#SnowDay");
  if (/fog|mist|haze/.test(cond)) tags.add("#FoggyMorning");
  if (/clear|sun|sunny|fair/.test(cond) && rain < 30) tags.add("#SunLife");
  if (high >= 90) {
    tags.add("#HeatWave");
    if ((opts.state || "").toLowerCase() === "florida") tags.add("#FloridaHeat");
  }
  if (high <= 50 && high > 0) tags.add("#JacketWeather");
  if (high >= 70 && high <= 80 && /clear|sun|fair/.test(cond)) tags.add("#PerfectDay");

  // Cap to 5 total
  const out = Array.from(tags).slice(0, 5);
  return out.join(" ");
}

/**
 * One convenient block to append to ANY system or user prompt that wants the
 * full SkyBrief style stack: tone + greeting + life tips + hashtag rule.
 */
export function buildStyleAddendum(opts: {
  tone: CaptionTone;
  city?: string;
  state?: string;
  period?: string | null;
  rainChance?: number | null;
  highTemp?: number | null;
  lowTemp?: number | null;
  conditions?: string;
}): string {
  const sections: string[] = [];
  sections.push(toneInstruction(opts.tone, opts.city));
  const greet = greetingForPeriod(opts.period, opts.city);
  if (greet) sections.push(greet);
  const tips = lifeTips({
    rainChance: opts.rainChance,
    highTemp: opts.highTemp,
    lowTemp: opts.lowTemp,
    conditions: opts.conditions,
  });
  if (tips) sections.push(tips);
  const tags = buildHashtags({
    city: opts.city,
    state: opts.state,
    conditions: opts.conditions,
    highTemp: opts.highTemp,
    rainChance: opts.rainChance,
  });
  sections.push(
    [
      "HASHTAGS:",
      "- End the caption with EXACTLY this hashtag line on its own final line, after the CTA:",
      tags,
      "- Do not add other hashtags. Do not modify or reorder these.",
    ].join("\n"),
  );
  return sections.join("\n\n");
}

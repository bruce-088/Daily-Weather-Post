import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";
import { verifyUser } from "../_shared/auth-helpers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const APP_NAME = "SkyBrief";
const APP_VERSION = "1.4.0";
const TAGLINE = "Automated weather posts for every platform.";

const FEATURES: Array<[string, string, string]> = [
  ["Create – Manual weather card & video generation", "✅ Working", "Generate, preview, and post weather cards/videos on demand."],
  ["Schedule – Queue posts for future delivery", "✅ Working", "Stores into scheduled_posts; processed by cron."],
  ["History – Past post log with status badges", "✅ Working", "Reads post_history; tags Automated vs manual posts."],
  ["Automation – 3x/day auto-post (morning/afternoon/evening)", "✅ Working", "auto-post-scheduler runs every 5 minutes with a 10-minute trigger window and 30-minute duplicate guard."],
  ["AI Voiceover (ElevenLabs)", "✅ Working", "Per-user voice, speed, stability, similarity controls; live Test Voice preview."],
  ["AI Captions (Lovable AI / Gemini)", "✅ Working", "generate-caption edge function with anti-clone, CTA rotation, and personality logic."],
  ["Notifications (in-app, realtime)", "✅ Working", "notifications table + realtime subscription."],
  ["Social integrations: TikTok, YouTube, X/Twitter, LinkedIn, Instagram", "✅ Working", "OAuth flows; Instagram via Graph API. YouTube auth hardened: access_type=offline + prompt=consent + include_granted_scopes guarantee a long-lived refresh_token; legacy refresh_token action matches strictly by refresh_token (no city_id=null fallback insert, no cross-channel overwrite); adapter performs ONE auto refresh + retry on 401 from upload init; standardized [youtube-auth] logging."],
  ["Video rendering via Creatomate (with Remotion fallback)", "⚠️ Partial", "Creatomate primary; fallback path is environment-dependent."],
  ["Export Spec (this document)", "✅ Working", "generate-spec edge function returns live Markdown."],
  ["Job Pipeline Dashboard", "✅ Working", "Visual pipeline showing step-by-step job progress per post."],
  ["Duplicate Post Protection", "✅ Working", "DB-level exclusion constraint + runtime dedupe checks."],
  ["City-to-Channel Routing Guard", "✅ Working", "Strict mapping prevents cross-city content contamination."],
  ["Slot-based Title & Caption Branding", "✅ Working", "Titles prefixed with [8 AM]/[1 PM]/[6 PM]; captions include location beacon."],
  ["Advanced Analytics — Insight Engine", "✅ Working", "Per-post 0–100 performance_score with winning/losing factors; powered by analyze-performance over last 60d of post_analytics."],
  ["Advanced Analytics — Pattern Detection", "✅ Working", "analyze-growth detects slot×tone, slot×hook, condition×tone winners (≥3 samples, ≥15% lift) into growth_insights."],
  ["Advanced Analytics — Learning Feedback Loop", "✅ Working", "generate-caption injects PROVEN WINNERS block (winning themes + top-post few-shot from ai_memory) while preserving anti-clone and 70/30 exploit/explore."],
  ["Advanced Analytics — Growth Command Center UI", "✅ Working", "Why It Won, Best Tone/Slot/Hook cards, actionable recommendation; per-post Performance pill in history."],
  ["Creative Decay & Diversity Guard", "✅ Working", "48h per-city cooldown uses tiered decay (1×=0, 2×=-40%, 3+×=-80%); proven winners (performance_score ≥85, not in last 2 posts) are rescued into a RECENTLY USED BUT ALLOWED tier that may be reused if rephrased; FORBIDDEN REPETITIONS narrowed to last 2 city openers + recurring themes; reworded Diversity Guard + deterministic Focus Angle rotation injected into generate-caption."],
  ["Background Variation (Pexels)", "✅ Working", "Ken-Burns fallback query combines weather condition + random secondary keyword (foliage/architecture/horizon/aerial/street/skyline/trees/rooftop/park/downtown) + city scope; randomized across top 10 results so identical conditions in different cities never collide."],
];

const INTEGRATIONS: Array<[string, string]> = [
  ["OpenWeather", "Forecast & current conditions (Imperial units)."],
  ["Creatomate", "Video rendering pipeline."],
  ["ElevenLabs", "TTS voiceover for auto-posts."],
  ["Lovable AI Gateway (Google Gemini)", "Caption generation."],
  ["Pexels", "Stock imagery for video backgrounds."],
  ["YouTube Data API v3", "Shorts upload (resumable). Long-lived OAuth via access_type=offline + prompt=consent; refresh_token preserved on re-consent; per-row refresh isolation; in-flight 401 self-heal (refresh + retry once)."],
  ["X/Twitter v1.1 + v2", "OAuth 1.0a HMAC-SHA1; chunked media upload."],
  ["LinkedIn API v202601", "Person + organization posts."],
  ["TikTok Content Posting API", "video.publish / video.upload."],
  ["Instagram Graph API", "Business/Creator account publishing."],
];

const SLOT_SYSTEM = `Slots define the three daily automation windows and drive caption tone, title prefix, and scheduling logic.

| Slot | Time | Title Prefix | Caption Personality |
|---|---|---|---|
| Morning | 8:00 AM (local) | [8 AM] | Upbeat / Energetic |
| Afternoon | 1:00 PM (local) | [1 PM] | Informative / Direct |
| Evening | 6:00 PM (local) | [6 PM] | Calm / Cinematic |

- Slot times are stored per-city in \`weather_settings\` as \`morning_post_time\`, \`afternoon_post_time\`, \`evening_post_time\`.
- All times are evaluated in the city's local timezone (stored in \`weather_settings.timezone\`).
- Slots determine: posting time, caption personality, title prefix, and CTA rotation index.

### Title Generation
- Single source of truth: \`ensureSlotTitlePrefix()\` in \`_shared/caption-style.ts\`
- Slot inference: \`inferSlotFromCityHour(city)\` maps city-local hour to morning / afternoon / evening
- Broadcast slots only: morning → [8 AM], afternoon → [1 PM], evening → [6 PM]
- Manual posts without a selected slot infer slot from current city-local hour
- Prefix is always first — before emojis, text, or hashtags
- Stale/wrong prefixes are stripped and replaced (no duplication)
- Total title length enforced at ≤95 chars; base is truncated, prefix is never cut`;

const EXECUTION_SOURCES = `Every post in SkyBrief originates from one of three sources. Each source is tagged internally to ensure isolation and prevent cross-triggering.

| Source | Trigger | Tag |
|---|---|---|
| Manual | User clicks "Post Now" on Create page | \`source=manual\` |
| Scheduled | User creates a future post via Schedule tab | \`source=scheduled\` |
| Automated | Cron fires auto-post-scheduler every 5 minutes | \`source=automated\` |

- "Run This Slot Now" executes ONLY the specific city_id + slot combination requested.
- Automated runs bypass manual slot execution paths.
- All sources feed into the same \`process-scheduled-posts\` pipeline.`;

const PIPELINE_FLOW = "Every post (manual, scheduled, or automated) follows this pipeline:\n\n" +
  "```\n" +
  "Trigger (manual / scheduled / automated)\n" +
  "  → auto-post-scheduler OR direct call\n" +
  "  → process-scheduled-posts\n" +
  "    → Create job in `jobs` table\n" +
  "    → Step 1: generate_content (caption + title)\n" +
  "    → Step 2: generate_voice (ElevenLabs, optional)\n" +
  "    → Step 3: render_video (Creatomate)\n" +
  "    → Step 4: publish_post (platform adapter)\n" +
  "    → Step 5: analyze_performance (post-publish)\n" +
  "  → Write result to `post_history`\n" +
  "  → Insert notification for user\n" +
  "```\n\n" +
  "- Each step is independently retryable.\n" +
  "- Earlier successful steps (including rendered video) are cached and reused on retry.\n" +
  "- Failures at any step do not block future automation cycles.";

const EDGE_FUNCTIONS_OVERVIEW = `### \`auto-post-scheduler\`
- Runs every 5 minutes via pg_cron.
- Checks all \`weather_settings\` rows for slots due within the current 10-minute window.
- Creates \`scheduled_posts\` rows and triggers \`process-scheduled-posts\`.
- Enforces 30-minute duplicate guard per slot per user.
- Uses service_role key for authorization.

### \`process-scheduled-posts\`
- Core execution engine for all post types.
- Runs the full pipeline: caption → voice → render → publish → analyze.
- Creates and updates \`jobs\` table rows for each step.
- Handles retries at the step level (not full pipeline restarts).
- Caches rendered video to avoid duplicate render charges on retry.

### \`generate-caption\`
- Generates AI captions using Lovable AI Gateway (Google Gemini).
- Accepts slot, city, weather data, and previous caption context.
- Applies personality rotation, CTA rotation, and anti-repeat logic.
- Includes similarity validation with one automatic regeneration cycle.
- Fail-safe: any enhancement failure falls back to base caption logic silently.

### \`generate-spec\`
- Returns this document as live Markdown.
- Pulls recent activity from \`post_history\` for the Recent Changes Log.`;

const IDEMPOTENCY = `SkyBrief uses a multi-layer approach to prevent duplicate posts:

### Layer 1 — Database Constraint
- Exclusion constraint on \`jobs.scheduled_post_id\` prevents two active jobs for the same post.
- Enforced at the Postgres level — cannot be bypassed by application code.

### Layer 2 — Runtime Dedupe Check
- Before publishing, the system checks \`post_history\` for a successful post with the same city + platform + date + slot within the last 60 minutes.
- If found, the publish step is skipped and the existing post URL is returned.

### Layer 3 — Slot Idempotency Key
- Unique key format: \`city_id + local_date + slot_name + platform\`
- Applied at both the \`scheduled_posts\` creation step and the \`publish_post\` step.`;

const CAPTION_SYSTEM = `### Personality Rotation (by slot)
| Slot | Personality |
|---|---|
| Morning | Upbeat / Energetic |
| Afternoon | Informative / Direct |
| Evening | Calm / Cinematic |

### CTA Rotation Pool
Rotated deterministically by \`(date + slot)\` index:
1. "Tap ❤️ if this helped your plans."
2. "Subscribe for tomorrow's brief."
3. "Check the radar before you head out."
4. "Drop your city's weather in the comments."

### Anti-Clone Logic
- Fetches the last 3 post captions for the same city before generating.
- Instructs the AI to avoid the same opening hook, sentence structure, and CTA.
- If generated caption is ≥80% similar to the previous post, triggers one automatic regeneration.
- Maximum one regeneration attempt — never loops.

### Fail-Safe Behavior
- All caption enhancements (personality, CTA, anti-repeat, similarity) are wrapped in try/catch.
- Any failure silently falls back to base caption generation.
- Posts are never blocked by caption enhancement failures.

### Learning Feedback Loop (Advanced Analytics)
- \`buildLearningPromptBlock()\` in \`_shared/learning-patterns.ts\` injects a **PROVEN WINNERS** block into the prompt.
- Sources: top \`winning_factors\` themes from high-scoring \`post_analytics\` rows + 1 few-shot example from \`ai_memory\` (\`memory_type='top_post'\`).
- Safeguards: minimum sample size ≥5 posts per user (and ≥3 per pattern) before patterns are applied.
- Variation preserved: 70/30 exploit/explore ratio; explicit instruction to vary opener and structure.
- Fully fail-safe: wrapped in try/catch — falls back to base generation if learning context is unavailable.

### Creative Decay & Diversity Guard
- **Per-city tiered cooldown** (\`getTopPerformingPatterns\` in \`_shared/learning-patterns.ts\`): queries the last 48h of \`post_history\` for \`(user_id, city)\` and counts normalized hook reuse. Weight multipliers: 1 use → ×1.0 (no penalty), 2 uses → ×0.6 (−40%), 3+ uses → ×0.2 (−80%) applied to \`avg_views\` before \`topHooks\` is sliced.
- **Strategic-reuse rescue**: hooks whose best \`post_analytics.performance_score\` over the last 60d is ≥85 AND that are NOT in the last 2 city posts are rescued back to ×1.0 weight and surfaced (up to 3) in a **RECENTLY USED BUT ALLOWED** prompt block — proven winners can be reused but must be rephrased with a new opening structure and angle.
- **FORBIDDEN REPETITIONS block**: narrowed to the last **2** city openers verbatim plus any theme tokens (\`beautiful day\`, \`comfortable\`, \`gorgeous\`, \`perfect day\`, \`lovely\`, \`nice day\`) seen ≥2× in 48h. Instructs the model not to repeat verbatim or use as the opener.
- **Diversity Guard**: prompt directive — "Avoid repeating recent hooks. If reusing a proven high-performing pattern, it MUST be rephrased with a new angle and different opening structure. Prefer secondary weather signals (wind, humidity, visibility, dew point, UV, local activity, cinematic atmosphere) when conditions are mild."
- **Focus Angle rotation**: deterministic picker over \`["Landscape", "Sky", "Street Level", "Atmospheric Detail", "Human Activity"]\` keyed by \`(cityHash + dayOfYear + slotIdx) mod 5\` so consecutive posts for the same city land on different framings.
- Both Diversity Guard and Focus Angle live inside the existing fail-safe try/catch — any error silently drops them.

### Phrasing Cleaner (Post-Generation)
- A lightweight regex-based cleaner (\`cleanWeatherPhrasing\`) runs in the final safety net after \`stripUnverifiedReferences\` and before timestamp stamping.
- Pattern: `\bin\s+(clear skies|rain|clouds|sunshine|snow|thunderstorms|fog|wind)\b` is rewritten to use natural phrasing (e.g., "in Clear Skies" → "with clear skies", "in Rain" → "with rain", "in Wind" → "with windy conditions").
- Fallback: if the pattern does not match a known condition, the original text is preserved.
- Secondary passes collapse double spaces and fix trailing spaces before punctuation.
- Fully safe: it operates only on the finalized caption string and never modifies prompt logic, tone, CTA, or structural directives.
- A companion sanitizer \`fixInvalidLocation\` runs immediately after \`cleanWeatherPhrasing\`. It matches \`\\bweather in (?!<city>)[A-Za-z][A-Za-z\\s'-]{0,40}\` (city is regex-escaped) and rewrites the captured location back to the canonical city, fixing cases where the model substitutes a style/variation/tone label (e.g. "weather in But Comfortable") for the real city. It also rewrites \`daily [non-city] weather alerts\` back to the canonical city.
- A final hardcoded "no-fly zone" pass \`forceCitySanity\` runs last in the cleanup chain (\`cleanWeatherPhrasing\` → \`fixInvalidLocation\` → \`forceCitySanity\`). It iterates a fixed list of known offending labels (\`Coming Up\`, \`But Comfortable\`, \`Clear Skies\`, \`Rain\`, \`Clouds\`, \`Ahead\`) and case-insensitively rewrites both \`weather in <label>\` and \`daily <label> weather alerts\` to use the actual city. Acts as a deterministic guard against any pattern the regex sanitizer misses.
- CTA prompt now carries a CRITICAL location guardrail: in the CTA block the only valid location is the actual city; style names, variation labels, tone labels, and weather conditions (e.g. "Coming Up", "But Comfortable", "Clear Skies", "Rain", "Clouds", "Ahead") are explicitly forbidden as locations. The guardrail is appended to \`ctaBlock\` so it travels with every CTA rotation.

### Local Voice Layer (Prompt Block)
- A \`LOCAL VOICE\` block is appended to the caption user prompt alongside Diversity Guard, Focus Angle, and Personality.
- **Voice rules**: avoid formal forecast phrasing ("conditions remain", "forecast indicates", "expect", "anticipate"); prefer casual openers ("Looks like…", "Feels like…", "Heads up…", "You might notice…"); use natural time references ("this afternoon", "later tonight", "heading into the evening").
- **Micro-localization (opt-in, never forced)**: hot/humid → hydration, AC, pool weather; rain/storms → umbrella, wet commute, slick roads; clear/mild → great night to get outside, sunset, evening plans; cold/windy → layers, jacket weather.
- **Opener variation**: do not always start with the city name — rotate weather-first, feeling-first, situation-first openers.
- **Hard constraints preserved**: stays within current length limits, keeps the CTA line exactly as required by CTA ROTATION, does not change title / body / hashtag block structure.
- Lives inside the existing fail-safe try/catch — any error silently drops the block.

### Background Variation (Pexels Ken-Burns fallback)
- \`fetchPexelsStillForCondition()\` in \`_shared/video-render.ts\` now appends a random **secondary keyword** (\`foliage | architecture | horizon | aerial | street | skyline | trees | rooftop | park | downtown\`) and the **city name** to the condition-derived primary query.
- Result pool widened from top 5 → top 10, then randomized. Identical conditions in different cities can no longer collide on the same stock photo.
- Future caching layers MUST include \`city\` in their cache key.`;

const ROUTING_GUARD = `Prevents cross-city content contamination (e.g., Gainesville content on Orlando channel).

### Pre-Flight Check
- Before publishing, resolves the target channel ID directly from the \`city_id\` mapping in \`weather_settings\`.
- Asserts that the city name in the post content matches the city assigned to the target channel.
- If mismatch detected → job fails with \`ROUTING_VIOLATION\` error (does not publish).

### Template Isolation
- All template variables (city name, channel handle, subscribe URLs, state name) are cleared and reset for every generation cycle.
- AI prompt explicitly scoped to the target city: "You are writing for the [CITY] channel only."`;

const ERROR_STRATEGY = `SkyBrief uses a **fail-open philosophy**: posts should publish even if non-critical steps fail.

| Failure | Behavior |
|---|---|
| Voiceover generation fails | Post continues without audio |
| Caption enhancement fails | Fallback to base caption |
| Similarity check fails | Keep original caption, log warning |
| Rendering fails | Retry or fallback renderer |
| Routing violation detected | Abort publish, log ROUTING_VIOLATION |
| Duplicate detected | Skip publish, log dedupe event |
| Any pipeline step fails | Log to system_logs + job record; future cycles unaffected |`;

const KNOWN_ISSUES = "- Voiceover generation depends on ElevenLabs availability; on failure the post still publishes without audio.\n" +
  "- Creatomate fallback to a Remotion-based external renderer is environment-dependent.\n" +
  "- Cron drift up to ~10 minutes is expected (matched window). Posts overdue >10 min show a red badge.\n" +
  "- App version (`" + APP_VERSION + "`) is currently maintained as a constant inside `generate-spec`.\n" +
  "- Recent Changes Log below is sourced from the latest `post_history` activity, not git commits.";

const RESOLVED_ISSUES = `| Issue | Resolution |
|---|---|
| Automation not firing | Fixed pg_cron using anon key instead of service_role key |
| Timezone misalignment | Fixed slot time comparison to use city-local timezone |
| Duplicate YouTube uploads | Added DB-level exclusion constraint on jobs table |
| Cross-city routing (Gainesville on Orlando channel) | Added pre-flight routing guard in publish step |
| Identical post titles/captions | Added anti-clone logic, CTA rotation, personality rotation |
| Silent pipeline failures | Added fail-safe try/catch wrappers on all caption enhancements |
| Slot prefix inconsistency | Fixed via ensureSlotTitlePrefix in _shared/caption-style.ts — all sources now use single helper |
| Analytics limited to "Top Performer" badges | Upgraded to Insight Engine: per-post performance_score + winning/losing factors, growth_insights pattern detection, PROVEN WINNERS feedback loop into generate-caption |
| Gainesville posts repeating "Beautiful Day" hooks and styles | Added 48h per-city Creative Decay (80% weight penalty on overused hooks), FORBIDDEN REPETITIONS block, Diversity Guard, deterministic Focus Angle rotation, and Pexels secondary-keyword + city-scoped background variation |
| AI captions producing awkward "in [Weather]" phrasing | Added `cleanWeatherPhrasing` regex cleaner in `generate-caption` final safety net — replaces "in Clear Skies/Rain/Wind/etc." with natural "with clear skies/rain/windy conditions" without hardcoded sentence replacements |
| Captions reading like formal forecasts ("conditions remain", "forecast indicates") | Added `LOCAL VOICE` prompt block: casual openers ("Looks like…", "Feels like…", "Heads up…"), natural time references, opt-in micro-localization (hydration/umbrella/sunset cues), and opener rotation away from city-name-first — all under hard constraints that preserve length, CTA, and structural blocks |
| Style/variation labels appearing as locations in CTA (e.g. "weather in But Comfortable") | Added CRITICAL location guardrail to \`ctaBlock\` + post-generation \`fixInvalidLocation\` sanitizer that regex-rewrites any "weather in [non-city]" back to the canonical city name |
| Style/variation labels leaking into "daily X weather alerts" phrasing (e.g. "daily Coming Up weather alerts") | Added final hardcoded \`forceCitySanity\` sanitizer that runs last in the cleanup chain and rewrites a fixed allow-list of offending labels (\`Coming Up\`, \`But Comfortable\`, \`Clear Skies\`, \`Rain\`, \`Clouds\`, \`Ahead\`) in both \`weather in <label>\` and \`daily <label> weather alerts\` to use the actual city |\`;

const DEPLOYMENT = `- **Frontend**: React 18 + Vite + TypeScript + Tailwind (Lovable Cloud)
- **Backend**: Managed Postgres + Serverless Edge Runtime (Supabase via Lovable Cloud)
- **Cron**: pg_cron extension, every 5 minutes, authenticated with service_role key
- **Storage**: Supabase Storage (video/image assets)
- **Auth**: Supabase Auth (email/password + OAuth)

### Manual Override Controls (Settings → System Health)
- **Run Performance Analysis** — invokes \`analyze-performance\` edge function on demand (bypasses 24h cron). Shows Loader2 spinner while running; disables button; success/error toast on completion.
- **Run Growth Analysis** — invokes \`analyze-growth\` edge function on demand (bypasses 6h cron). Same loading/disabled/toast behavior.
- Both buttons sit under the existing Safe Reset / Dry Run controls in the System Health card. They do not alter cron schedules, edge function code, DB schemas, or RLS — they are pure on-demand triggers for operator/debug use.`;

function md(rows: string[]) {
  return rows.join("\n");
}

function table(headers: string[], rows: string[][]) {
  const head = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  return [head, sep, body].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await verifyUser(req);
  if (auth.response) return auth.response;

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Recent activity log (last 10 from post_history) — scoped to the requesting user.
    const { data: recent } = await supabase
      .from("post_history")
      .select("created_at, status, platform, city")
      .eq("user_id", auth.userId)
      .order("created_at", { ascending: false })
      .limit(10);

    const recentRows = (recent ?? []).map((r: any) => [
      new Date(r.created_at).toISOString().replace("T", " ").slice(0, 16),
      r.status ?? "—",
      r.platform ?? "—",
      r.city ?? "—",
    ]);

    const SCHEMA_TABLES: Record<string, string[]> = {
      weather_settings: [
        "id (uuid, PK)", "user_id (uuid)", "city (text)", "state (text)", "timezone (text)",
        "post_time (time)", "morning_post_time (time)", "afternoon_post_time (time)", "evening_post_time (time)",
        "auto_post_morning / auto_post_afternoon / auto_post_evening (bool)",
        "morning_platforms / afternoon_platforms / evening_platforms (jsonb)",
        "morning_skip_date / afternoon_skip_date / evening_skip_date (date)",
        "enable_voiceover (bool)", "voiceover_voice_id (text)", "voiceover_speed (numeric)",
        "voiceover_stability (numeric)", "voiceover_similarity (numeric)",
        "tiktok_* / youtube_* / twitter_* / linkedin_* OAuth tokens",
      ],
      scheduled_posts: [
        "id (uuid, PK)", "user_id (uuid)", "platform (text)", "city (text)",
        "scheduled_at (timestamptz)", "status (text)", "caption (text)",
        "include_voiceover (bool)", "voiceover_url (text)", "error_message (text)",
      ],
      post_history: [
        "id (uuid, PK)", "user_id (uuid)", "platform (text)", "city (text)",
        "condition (text)", "temperature (numeric)", "image_url (text)",
        "caption (text)", "status (text)", "error_message (text)", "created_at (timestamptz)",
      ],
      jobs: [
        "id (uuid, PK)", "scheduled_post_id (uuid, FK → scheduled_posts.id)", "user_id (uuid)",
        "city (text)", "platform (text)",
        "status (text: pending | running | retrying | succeeded | failed)",
        "step (text: generate_content | generate_voice | render_video | publish_post | analyze)",
        "error_message (text)", "created_at (timestamptz)", "updated_at (timestamptz)",
      ],
      notifications: [
        "id (uuid, PK)", "user_id (uuid)", "title (text)", "message (text)",
        "type (text)", "read (bool)", "created_at (timestamptz)",
      ],
      system_health: [
        "id (text, PK)", "last_run_at (timestamptz)", "last_status (text)",
        "last_message (text)", "updated_at (timestamptz)",
      ],
      post_analytics: [
        "id (uuid, PK)", "user_id (uuid)", "post_history_id (uuid)", "platform (text)", "city (text)",
        "views / likes / comments / shares (int)", "view_ratio (numeric)", "engagement_rate (numeric)",
        "performance_score (numeric, 0–100) — weighted blend: view ratio 50% + engagement 30% + retention 20% vs 60d user baseline",
        "winning_factors (jsonb) — factors ≥+15% vs baseline (tone, hook, slot, condition, etc.)",
        "losing_factors (jsonb) — factors ≤−15% vs baseline",
        "created_at (timestamptz)",
      ],
      content_insights: [
        "id (uuid, PK)", "user_id (uuid)", "insight_type (text)", "dimension (text)",
        "value (text)", "score (numeric)", "sample_size (int)", "updated_at (timestamptz)",
      ],
      growth_insights: [
        "id (uuid, PK)", "user_id (uuid)", "variable (text)", "winner_value (text)",
        "loser_value (text)", "delta_pct (numeric)", "sample_size (int)", "title (text)", "created_at (timestamptz)",
      ],
      ai_memory: [
        "id (uuid, PK)", "user_id (uuid)", "memory_type (text: top_post | ...)",
        "content (jsonb)", "score (numeric)", "created_at (timestamptz)",
      ],
    };

    const now = new Date().toISOString();
    const docParts: string[] = [];

    docParts.push(`# ${APP_NAME} – Application Specification`);
    docParts.push(`_Generated: ${now} | Version: ${APP_VERSION}_\n`);
    docParts.push("---\n");

    docParts.push(`## 1. App Identity`);
    docParts.push(md([
      `- **Name**: ${APP_NAME}`,
      `- **Version**: ${APP_VERSION}`,
      `- **Tagline**: ${TAGLINE}`,
      `- **Frontend**: React 18 + Vite 5 + TypeScript 5 + Tailwind CSS v3 (shadcn/ui)`,
      `- **Backend**: Lovable Cloud (Supabase) – Postgres + Auth + Storage + Edge Functions (Deno)`,
      `- **Database**: PostgreSQL (managed)`,
      `- **Edge runtime**: Deno (Supabase Edge Functions)`,
    ]));
    docParts.push("\n---\n");

    docParts.push(`## 2. Features`);
    docParts.push(table(["Feature", "Status", "Notes"], FEATURES.map(([f, s, n]) => [f, s, n])));
    docParts.push("\n---\n");

    docParts.push(`## 3. Slot System\n`);
    docParts.push(SLOT_SYSTEM);
    docParts.push("\n---\n");

    docParts.push(`## 4. Execution Sources\n`);
    docParts.push(EXECUTION_SOURCES);
    docParts.push("\n---\n");

    docParts.push(`## 5. Pipeline Flow\n`);
    docParts.push(PIPELINE_FLOW);
    docParts.push("\n---\n");

    docParts.push(`## 6. Database Schema\n`);
    for (const [t, cols] of Object.entries(SCHEMA_TABLES)) {
      docParts.push(`### \`${t}\``);
      docParts.push(cols.map((c) => `- ${c}`).join("\n"));
      if (t === "jobs") {
        docParts.push(`\n**Constraint:** \`unique_scheduled_post_job\` — exclusion constraint on \`scheduled_post_id\` where status IN ('pending', 'running', 'retrying', 'succeeded'). Prevents duplicate active jobs at the database level.`);
      }
      docParts.push("");
    }
    docParts.push(`**Relationships**: All user-owned tables reference \`auth.users.id\` via \`user_id\` (no FK; enforced by RLS). \`scheduled_posts\` becomes \`post_history\` rows after processing.`);
    docParts.push("\n---\n");

    docParts.push(`## 7. Edge Functions\n`);
    docParts.push(EDGE_FUNCTIONS_OVERVIEW);
    docParts.push("\n---\n");

    docParts.push(`## 8. Idempotency & Duplicate Protection\n`);
    docParts.push(IDEMPOTENCY);
    docParts.push("\n---\n");

    docParts.push(`## 9. Caption Generation System\n`);
    docParts.push(CAPTION_SYSTEM);
    docParts.push("\n---\n");

    docParts.push(`## 10. City-to-Channel Routing Guard\n`);
    docParts.push(ROUTING_GUARD);
    docParts.push("\n---\n");

    docParts.push(`## 11. Error Handling Strategy\n`);
    docParts.push(ERROR_STRATEGY);
    docParts.push("\n---\n");

    docParts.push(`## 12. API Integrations`);
    docParts.push(table(["Integration", "Used for"], INTEGRATIONS.map(([n, u]) => [n, u])));
    docParts.push("\n---\n");

    docParts.push(`## 13. Known Issues / Limitations`);
    docParts.push(KNOWN_ISSUES);
    docParts.push("\n---\n");

    docParts.push(`## 14. Recently Resolved Issues\n`);
    docParts.push(RESOLVED_ISSUES);
    docParts.push("\n---\n");

    docParts.push(`## 15. Deployment`);
    docParts.push(DEPLOYMENT);
    docParts.push("\n---\n");

    docParts.push(`## 16. Recent Changes Log`);
    docParts.push(`_Pulled live from post_history (last 10 events)_\n`);
    if (recentRows.length === 0) {
      docParts.push(`_No recent activity recorded._`);
    } else {
      docParts.push(table(["When (UTC)", "Status", "Platform", "City"], recentRows));
    }
    docParts.push("");

    const markdown = docParts.join("\n");

    return new Response(markdown, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="SkyBrief-Spec-${now.slice(0, 10)}.md"`,
      },
      status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

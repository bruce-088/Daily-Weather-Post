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
  ["AI Captions (Lovable AI / Gemini)", "✅ Working", "generate-caption edge function."],
  ["Notifications (in-app, realtime)", "✅ Working", "notifications table + realtime subscription."],
  ["Social integrations: TikTok, YouTube, X/Twitter, LinkedIn, Instagram", "✅ Working", "OAuth flows; Instagram via Graph API."],
  ["Video rendering via Creatomate (with Remotion fallback)", "⚠️ Partial", "Creatomate primary; fallback path is environment-dependent."],
  ["Export Spec (this document)", "✅ Working", "generate-spec edge function returns live Markdown."],
];

const EDGE_FUNCTIONS: Array<[string, string, string]> = [
  ["auto-post-scheduler", "Cron every 5 min", "Evaluates user time slots; enqueues scheduled_posts within a 10-minute window."],
  ["process-scheduled-posts", "Cron / triggered", "Renders video, generates voiceover, calls platform adapters; writes post_history."],
  ["daily-weather-post", "Manual / cron", "Legacy single daily post entry point."],
  ["fetch-weather", "User action", "Calls OpenWeather; returns enriched morning/afternoon/evening forecast."],
  ["generate-caption", "User action", "Lovable AI Gemini caption generation."],
  ["tts-preview", "User action", "ElevenLabs preview using current voice settings."],
  ["upload-preview-video", "User action", "Uploads preview render to weather-videos bucket."],
  ["tiktok-auth / youtube-auth / twitter-auth / linkedin-auth", "OAuth callback", "Exchanges code for tokens; stores in weather_settings."],
  ["generate-spec", "User action (Export Spec button)", "Builds this Markdown file from live DB + code constants."],
];

const INTEGRATIONS: Array<[string, string]> = [
  ["OpenWeather", "Forecast & current conditions (Imperial units)."],
  ["Creatomate", "Video rendering pipeline."],
  ["ElevenLabs", "TTS voiceover for auto-posts."],
  ["Lovable AI Gateway (Google Gemini)", "Caption generation."],
  ["Pexels", "Stock imagery for video backgrounds."],
  ["YouTube Data API v3", "Shorts upload (resumable)."],
  ["X/Twitter v1.1 + v2", "OAuth 1.0a HMAC-SHA1; chunked media upload."],
  ["LinkedIn API v202601", "Person + organization posts."],
  ["TikTok Content Posting API", "video.publish / video.upload."],
  ["Instagram Graph API", "Business/Creator account publishing."],
];

const AUTOMATION = `- **Cron schedule**: \`auto-post-scheduler\` runs every 5 minutes.
- **Time window**: a slot triggers when \`scheduled_time <= now <= scheduled_time + 10 minutes\`.
- **Duplicate guard**: each slot can only fire once per 30-minute window per user.
- **Slot platforms**: per-user \`morning_platforms\`, \`afternoon_platforms\`, \`evening_platforms\` JSONB arrays.
- **Skip-once**: \`{slot}_skip_date\` columns let users skip a single occurrence.
- **Rendering**: handed off to \`process-scheduled-posts\` which generates voiceover (if enabled), renders video, and posts.`;

const KNOWN_ISSUES = `- Voiceover generation depends on ElevenLabs availability; on failure the post still publishes without audio.
- Creatomate fallback to a Remotion-based external renderer is environment-dependent.
- Cron drift up to ~10 minutes is expected (matched window). Posts overdue >10 min show a red badge.
- App version (\`${APP_VERSION}\`) is currently maintained as a constant inside \`generate-spec\`.
- Recent Changes Log below is sourced from the latest \`post_history\` activity, not git commits (no git available at runtime).`;

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

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // --- Live DB introspection ---
    const { data: tablesRaw } = await supabase
      .rpc("noop_unused", {})
      .then(() => ({ data: null }))
      .catch(() => ({ data: null }));

    // Use information_schema via REST is not exposed; we hardcode known tables but pull row counts live.
    const KNOWN_TABLES = ["weather_settings", "scheduled_posts", "post_history", "notifications", "system_health"];
    const tableStats: Record<string, number | string> = {};
    for (const t of KNOWN_TABLES) {
      const { count, error } = await supabase.from(t).select("*", { count: "exact", head: true });
      tableStats[t] = error ? "n/a" : (count ?? 0);
    }

    // Recent activity log (last 10 from post_history)
    const { data: recent } = await supabase
      .from("post_history")
      .select("created_at, status, platform, city, error_message")
      .order("created_at", { ascending: false })
      .limit(10);

    const recentRows = (recent ?? []).map((r: any) => [
      new Date(r.created_at).toISOString().replace("T", " ").slice(0, 16),
      r.status ?? "—",
      r.platform ?? "—",
      r.city ?? "—",
      (r.error_message ?? "").slice(0, 80),
    ]);

    const SCHEMA_TABLES: Record<string, string[]> = {
      weather_settings: [
        "id (uuid, PK)", "user_id (uuid)", "city (text)", "state (text)", "timezone (text)",
        "post_time (time)", "morning_post_time", "afternoon_post_time", "evening_post_time",
        "auto_post_morning/afternoon/evening (bool)",
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
      notifications: [
        "id (uuid, PK)", "user_id (uuid)", "title (text)", "message (text)",
        "type (text)", "read (bool)", "created_at (timestamptz)",
      ],
      system_health: [
        "id (text, PK)", "last_run_at (timestamptz)", "last_status (text)",
        "last_message (text)", "updated_at (timestamptz)",
      ],
    };

    const now = new Date().toISOString();

    const docParts: string[] = [];

    docParts.push(`# ${APP_NAME} – Application Specification`);
    docParts.push(`_Generated: ${now}_\n`);

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
    docParts.push("");

    docParts.push(`## 2. Features`);
    docParts.push(table(["Feature", "Status", "Notes"], FEATURES.map(([f, s, n]) => [f, s, n])));
    docParts.push("");

    docParts.push(`## 3. Database Schema`);
    docParts.push(`Live row counts shown below.`);
    docParts.push("");
    for (const [t, cols] of Object.entries(SCHEMA_TABLES)) {
      docParts.push(`### \`${t}\`  _(rows: ${tableStats[t]})_`);
      docParts.push(cols.map((c) => `- ${c}`).join("\n"));
      docParts.push("");
    }
    docParts.push(`**Relationships**: All user-owned tables reference \`auth.users.id\` via \`user_id\` (no FK; enforced by RLS). \`scheduled_posts\` becomes \`post_history\` rows after processing.`);
    docParts.push("");

    docParts.push(`## 4. Edge Functions`);
    docParts.push(table(["Function", "Trigger", "Purpose"], EDGE_FUNCTIONS.map(([n, t, p]) => [n, t, p])));
    docParts.push("");

    docParts.push(`## 5. Automation Logic`);
    docParts.push(AUTOMATION);
    docParts.push("");

    docParts.push(`## 6. API Integrations`);
    docParts.push(table(["Integration", "Used for"], INTEGRATIONS.map(([n, u]) => [n, u])));
    docParts.push("");

    docParts.push(`## 7. Known Issues / Limitations`);
    docParts.push(KNOWN_ISSUES);
    docParts.push("");

    docParts.push(`## 8. Deployment`);
    const reqUrl = new URL(req.url);
    const liveAppUrl = reqUrl.searchParams.get("origin") || "https://skybriefweatherpost.lovable.app";
    const supabaseUrl = SUPABASE_URL;
    const projectRef = (() => {
      try { return new URL(supabaseUrl).hostname.split(".")[0]; } catch { return "unknown"; }
    })();
    const edgeBase = `${supabaseUrl}/functions/v1`;
    const lovableProjectId = Deno.env.get("LOVABLE_PROJECT_ID") || "f81dce50-925f-420f-9022-0fb85c4a9a2f";
    docParts.push(md([
      `- **Hosting provider**: Lovable Cloud (Supabase-backed)`,
      `- **Live app URL**: ${liveAppUrl}`,
      `- **Supabase project URL**: ${supabaseUrl}`,
      `- **Supabase project ref**: \`${projectRef}\``,
      `- **Edge function base URL**: ${edgeBase}`,
      `- **Lovable project ID**: \`${lovableProjectId}\``,
      `- **Edge runtime region**: ${Deno.env.get("DENO_REGION") || "auto"}`,
    ]));
    docParts.push("");

    docParts.push(`## 9. Recent Changes Log`);
    docParts.push(`Pulled live from \`post_history\` (last 10 events).`);
    docParts.push("");
    if (recentRows.length === 0) {
      docParts.push(`_No recent activity recorded._`);
    } else {
      docParts.push(table(["When (UTC)", "Status", "Platform", "City", "Note"], recentRows));
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

export const MASTER_PROMPT = `# SkyBrief — Full App Specification

_Last refreshed to match the live codebase._

## Overview

SkyBrief is an AI-driven social-media weather automation platform. It fetches local forecasts, generates short-form videos and image posts (1:1 and 9:16), composes captions in the SkyBrief brand voice, and publishes to Instagram, TikTok, YouTube Shorts, X (Twitter), and LinkedIn — across multiple cities, on a morning / afternoon / evening cadence, with a feedback loop that learns from what performs.

---

## Core Capabilities

### Multi-city operation
- Cities live in \`cities\` + \`user_cities\`; legacy single-city config persists in \`weather_settings\`.
- Active city is managed by \`CitySwitcher\` (header) and \`useActiveCity\`; managed in **Settings → Cities** via \`CityManager\` and \`CityAccountsManager\`.
- Per-city automation rows in \`automations\` drive slot toggles independently of the legacy \`auto_post_morning/afternoon/evening\` flags.

### Weather + Card Designer
- Real-time data via \`fetch-weather\` (OpenWeatherMap; **imperial units everywhere — °F + mph**).
- Both City **and** State are required for accurate geocoding.
- Dual aspect ratio cards (1:1 Feed and 9:16 Story) with live preview and 3× PNG export (html-to-image).
- Dashboard auto-refresh (\`useWeather\`); \`Next24hTimeline\` shows an hourly band.

### AI Caption Generation
- \`generate-caption\` edge function (Lovable AI Gateway → \`google/gemini-3-flash-preview\`).
- SkyBrief brand prompt (\`SKYBRIEF_SYSTEM_PROMPT\`) + per-slot personality (morning upbeat / afternoon informative / evening calm), rotating CTA pool, anti-repeat against the previous post for the city, and an 80% Jaccard similarity guard with one-shot regeneration.
- Voice & Tone presets via \`_shared/caption-style.ts\` (\`normalizeTone\`, \`buildStyleAddendum\`, weather life tips, time-of-day greeting, dynamic hashtag stack).
- Dynamic per-city handles (\`@SkyBrief<City>\`) with foreign-handle and foreign-landmark sanitizers (\`_shared/location-guard.ts\`).
- All new enhancement logic is wrapped in fail-safe \`try/catch\` so any helper failure degrades silently to the base prompt.

### Video Generation & Render Fallback
- 3-tier render chain in \`_shared/video-render.ts\`:
  1. **Creatomate** (primary)
  2. **JSON2Video** (full fallback)
  3. **JSON2Video Ken-Burns** (image-only emergency fallback)
- Success contract: real bytes downloaded + duration > 2 s; otherwise treated as a render failure.
- Credit-exhaustion errors are detected explicitly and surfaced to the user.
- **Never** falls back to a static image for YouTube, TikTok, or Instagram Reels — those platforms require a true video.
- Image assets generated with Lovable AI (Gemini) when needed; stored in the \`generated-images\` Supabase Storage bucket.
- Visual badges, overlay safe zones, and brand typography defined in \`_shared/visual-selector.ts\` and the render templates.

### Voiceover (TTS)
- ElevenLabs voiceovers wired through \`tts-preview\` and \`process-scheduled-posts\`.
- Per-user voice config (\`voiceover_voice_id / speed / stability / similarity\`) stored on \`weather_settings\`.
- \`_shared/voice-memory.ts\` + voice A/B experiments give the system a \`getBestVoice()\` override; safe injection only.

### Multi-Platform Publishing
All adapters implement the shared \`PlatformAdapter\` interface in \`_shared/platform-adapter.ts\`.

| Platform | Adapter | Notes |
|---|---|---|
| YouTube Shorts | \`youtube-adapter.ts\` | Data API v3, resumable upload, OAuth refresh, SEO titles/tags/description |
| TikTok | \`tiktok-adapter.ts\` | Content Posting API; video upload + photo fallback (PULL_FROM_URL); domain-verification text files in \`/public\` |
| Instagram | \`instagram-adapter.ts\` | Graph API for Reels + image posts |
| X (Twitter) | \`twitter-adapter.ts\` | OAuth 1.0a media upload (image + chunked video) |
| LinkedIn | \`linkedin-adapter.ts\` | API \`v202601\`; async video registration |

OAuth flows: \`youtube-auth\`, \`tiktok-auth\`, \`twitter-auth\`, \`linkedin-auth\`.
Token expiry & disconnect logic managed in \`SettingsPanel\`, \`YouTubeChannelsManager\`, \`CityAccountsManager\`, \`ExpiredConnectionsBanner\`.

### Scheduling & Automation
- Manual scheduling via \`SchedulePostForm\` + \`ScheduledPostsList\` + \`EditScheduledPostDialog\`.
- \`process-scheduled-posts\` runs the full pipeline for a queued post.
- \`auto-post-scheduler\` (pg_cron) fires the morning / afternoon / evening slots.
- Slot prefixes on YouTube titles: \`[8 AM]\`, \`[1 PM]\`, \`[6 PM]\` (adhoc/manual fall back to a city-local stamp), capped at 95 chars.
- "Post Now" split button supports per-platform manual triggers.
- Per-city × per-slot toggles in \`automations\`.

### Job Pipeline
- Edge function \`run-jobs\` + shared \`_shared/job-runner.ts\` + \`_shared/job-handlers.ts\` execute discrete steps: \`generate_content → render_video → publish_post → sync_metrics → analyze_performance\`.
- \`jobs\` table is the source of truth; \`JobsDashboard\` page visualizes runs.
- The hidden 5th step (\`analyze_performance\`, 24 h after publish) writes \`pipeline_reflections\`; the next \`generate_content\` reads them and exposes \`engine_state\` to the Jobs UI.
- Feature flag \`USE_PIPELINE_FOR_MANUAL_POSTS\` toggles whether manual posts also run through the pipeline.

### Preview / Review Flow
- \`enqueue-preview-job\`, \`upload-preview-video\`, \`publish-preview-bundle\` power the pre-publish preview.
- Review dialog uses \`postHealth.ts\` to compute a 0–100 quality score with breakdown; posts < 60 are blocked when \`ENABLE_POST_HEALTH_SCORE\` is on. Score is persisted on \`post_history.health_score / health_breakdown\`.

### AI Learning & Growth System
- \`sync-platform-metrics\` + \`sync-youtube-metrics\` + \`sync-post-performance\` + \`refresh-youtube-analytics\` ingest engagement data into \`post_analytics\`, \`post_hooks\`, \`hook_stats\`, \`time_slot_stats\`.
- \`analyze-performance\` (cron) writes \`content_insights\` (best tone / opener per condition × time-of-day).
- \`analyze-growth\` (6 h) writes \`growth_recommendations\` (top hooks, recent openers, tone variety score).
- \`detect-weather-trends\` (daily) writes \`trend_alerts\`.
- \`compute-winner-stats\` + \`experiments-resolve\` drive \`experiments\` / \`experiment_wins\` / \`winner_stats\` / \`winner_repost_suggestions\`.
- \`_shared/learning-patterns.ts\` exposes FAVOR/AVOID hooks with a 70/30 explore/exploit split.
- \`_shared/winning-recipes.ts\` provides \`getWinningStyleForCondition()\` (visual_style + voice_tone + hook_type) and per-city tilts (Predictive Creative Engine).
- \`ai_memory\` stores per-user winning examples that are injected as few-shot context into the caption prompt.
- Surfaces: \`AnalyticsPanel\`, \`GrowthDashboard\`, \`GrowthCommandCenter\`, \`GrowthSummaryCard\`, \`GrowthInsights\`, \`GrowthIntelligenceCard\`, \`GrowthLog\`, \`SmartInsightsCard\`, \`AiInsightsCard\`, \`ContentScoreCard\`, \`ChannelHealthCard\`, \`SystemHealthCard\`.

### A/B Testing
- Manual, one-variable-at-a-time experiments (hook / CTA / background) via \`triggerManualABPost\`.
- Both variants run through the same pipeline.
- Gated by \`ENABLE_AB_TESTING\`; UI in \`ABComparePanel\`, badges via \`AutoWinnerBadge\` / \`AutoWinnerSettings\` / \`ExperimentBadge\`.

### City Visual Anchors
- Per-city landmark allow/avoid lists in \`_shared/location-guard.ts\` (\`buildCityVisualBlock\`, \`buildVerifiedLandmarksBlock\`, \`buildLocalIdentityBlock\`).
- Injected into both image and caption prompts; post-generation sanitizer strips unverified references and replaces foreign \`@SkyBrief*\` handles.

### Weather Alerts
- Thresholds (severe heat, storms, freeze, hurricane) trigger an ALERT-mode caption tone and a calm, direct overlay.

### Notifications
- \`NotificationBell\` with realtime unread count.
- \`useNotifications\` subscribes to \`notifications\` table via Supabase Realtime.

### History
- \`PostHistoryList\` with infinite scroll, slot badge (Morning / Afternoon / Evening / Manual), city badge, debug pills (Pipeline/Legacy, A/B, render engine, voice, health score) when \`SHOW_DEBUG_LABELS\` is on.

### Export Spec
- This document is generated by \`src/lib/masterPromptContent.ts\` + \`masterPromptPdfGenerator.ts\` + the \`generate-spec\` edge function.
- Available at \`/export-spec\` (\`ExportSpec.tsx\`) for download as PDF / Markdown.

---

## Database Schema (current tables)

\`weather_settings\`, \`scheduled_posts\`, \`post_history\`, \`notifications\`,
\`cities\`, \`user_cities\`, \`social_accounts\`, \`automations\`,
\`jobs\`, \`pipeline_reflections\`, \`video_renders\`, \`weather_cache\`,
\`post_analytics\`, \`post_hooks\`, \`content_insights\`,
\`hook_stats\`, \`time_slot_stats\`, \`trend_alerts\`, \`growth_recommendations\`, \`growth_insights\`,
\`experiments\`, \`experiment_wins\`, \`winner_stats\`, \`winner_repost_suggestions\`,
\`ai_memory\`, \`preview_bundles\`, \`publish_locks\`, \`system_health\`, \`system_logs\`.

All tables have Row-Level Security enabled and are scoped by \`user_id\`. Roles use a separate \`user_roles\` table accessed via the \`has_role()\` security-definer function.

### Key columns of note
- \`weather_settings\` carries legacy OAuth tokens, per-slot toggles, voice config, and feature toggles (\`use_performance_learning\`, \`enable_voiceover\`, \`enable_debug_trace\`).
- \`scheduled_posts.status\` lifecycle: \`pending → posted | failed | cancelled\`.
- \`post_history\` carries \`slot\`, \`platform\`, \`health_score\`, \`health_breakdown\`, render + publish metadata, and engagement metrics fed by sync jobs.
- \`jobs\` carries \`type\`, \`status\`, \`attempts\`, \`payload\`, \`engine_state\`, \`error\`.

---

## Edge Functions

| Function | Purpose |
|---|---|
| \`fetch-weather\` | OpenWeatherMap fetch + cache (\`weather_cache\`) |
| \`generate-caption\` | SkyBrief brand caption via Lovable AI Gateway |
| \`generate-hooks\` | Hook variant generator for A/B and growth |
| \`daily-weather-post\` | Legacy daily post entry-point |
| \`process-scheduled-posts\` | Full pipeline for queued posts (caption → render → publish → log) |
| \`auto-post-scheduler\` | pg_cron entry that enqueues slot posts |
| \`run-jobs\` | Job-queue worker (manual + pipeline) |
| \`enqueue-preview-job\` | Creates a preview render job |
| \`publish-preview-bundle\` | Publishes an approved preview |
| \`upload-preview-video\` | Stores rendered preview video |
| \`tts-preview\` | ElevenLabs voiceover preview |
| \`analyze-performance\` | Writes per-tone × condition × ToD insights |
| \`analyze-growth\` | Refreshes \`growth_recommendations\` every 6h |
| \`detect-weather-trends\` | Daily trend detection → \`trend_alerts\` |
| \`compute-winner-stats\` | Rolls up A/B winners |
| \`experiments-resolve\` | Resolves running experiments |
| \`sync-platform-metrics\` / \`sync-post-performance\` / \`sync-youtube-metrics\` / \`refresh-youtube-analytics\` | Engagement ingestion |
| \`youtube-channel-stats\` / \`youtube-health-check\` | Per-channel health |
| \`create-weekly-recap\` | Generates the weekly summary post |
| \`generate-spec\` | Produces this app spec |
| \`sync-cron-secret\` | Bootstraps the cron auth secret |
| \`youtube-auth\` / \`tiktok-auth\` / \`twitter-auth\` / \`linkedin-auth\` | OAuth handlers |

### Shared modules (\`supabase/functions/_shared/\`)
\`platform-adapter.ts\`, \`youtube-adapter.ts\`, \`tiktok-adapter.ts\`, \`instagram-adapter.ts\`, \`twitter-adapter.ts\`, \`linkedin-adapter.ts\`,
\`video-render.ts\`, \`visual-selector.ts\`, \`caption-style.ts\`, \`location-guard.ts\`,
\`auth-helpers.ts\`, \`job-runner.ts\`, \`job-handlers.ts\`,
\`learning-patterns.ts\`, \`winning-recipes.ts\`, \`voice-memory.ts\`, \`experiments.ts\`,
\`auto-winner.ts\`, \`style-rotation.ts\`, \`city-accounts.ts\`.

**Edge-function constraints**: no FFmpeg (use \`video-render.ts\` providers); avoid complex nested template literals; all functions validate JWT via \`verifyUser(req)\`; CORS headers included on every response.

---

## YouTube SEO & Engagement Layer (\`youtube-adapter.ts\`)

- **Slot-prefixed title**: \`[8 AM|1 PM|6 PM] + Hook + City + Weather Detail + Emoji\`, ≤ 95 chars.
- **Title hashtags**: trailing \` #<City> #Shorts\` enforced by \`appendTitleHashtags()\` within YouTube's 100-char limit (weather detail trimmed with ellipsis as needed).
- **Tags (15–20, ≤ 480 chars)** built by \`buildYouTubeTags()\` across base / regional / condition / temperature / time-of-day buckets.
- **Description**: starts with \`👍 Smash the LIKE button …\`, ends with subscribe CTA + hashtag block \`#<City>Weather #<Condition> #<State>Weather #WeatherUpdate #DailyShorts\`.
- **Engagement double-hook**: voiceover ends with LIKE then SUBSCRIBE (rotated per tone via \`VOICE_CTAS_BY_TONE\`); pulsing \`👍 LIKE\` overlay in final 2.5 s of every render.

---

## Frontend Architecture

### Pages (\`src/pages/\`)
\`Index.tsx\` (dashboard), \`Auth.tsx\`, \`JobsDashboard.tsx\`, \`ExportSpec.tsx\`,
\`PrivacyPolicy.tsx\`, \`TermsOfService.tsx\`, \`NotFound.tsx\`,
\`YouTubeCallback.tsx\`, \`TikTokCallback.tsx\`, \`TwitterCallback.tsx\`, \`LinkedInCallback.tsx\`.

### Components (\`src/components/\`)
Weather: \`WeatherCard\`, \`WeatherIcon\`, \`Next24hTimeline\`.
Scheduling: \`SchedulePostForm\`, \`ScheduledPostsList\`, \`EditScheduledPostDialog\`, \`PostProgressPanel\`, \`StatusPipeline\`, \`PreviewPipelineStatus\`, \`RenderProgressTracker\`.
History & review: \`PostHistoryList\`, \`VideoPreviewDialog\`, \`DebugLabels\`.
Cities & connections: \`CitySwitcher\`, \`CityManager\`, \`CityAccountsManager\`, \`YouTubeChannelsManager\`, \`ExpiredConnectionsBanner\`.
Analytics & growth: \`AnalyticsPanel\`, \`GrowthDashboard\`, \`GrowthCommandCenter\`, \`GrowthSummaryCard\`, \`GrowthInsights\`, \`GrowthIntelligenceCard\`, \`GrowthLog\`, \`SmartInsightsCard\`, \`AiInsightsCard\`, \`ContentScoreCard\`, \`ChannelHealthCard\`, \`SystemHealthCard\`, \`ABComparePanel\`, \`AutoWinnerBadge\`, \`AutoWinnerSettings\`, \`ExperimentBadge\`.
Settings: \`SettingsPanel\`, \`PerformanceLearningToggle\`, \`JobPipelineToggle\`.
Misc: \`NavLink\`, \`NotificationBell\`, \`CollapsibleCardHeader\`, plus the full \`ui/\` shadcn library.

### Hooks (\`src/hooks/\`)
\`useAuth\`, \`useWeather\`, \`useNotifications\`, \`useActiveCity\`, \`useCountdown\`, \`useDynamicFavicon\`, \`useGrowthInsights\`, \`use-mobile\`, \`use-toast\`.

### Lib (\`src/lib/\`)
\`api.ts\`, \`citiesApi.ts\`, \`abVariants.ts\`, \`cinematicMode.ts\`, \`confetti.ts\`, \`debugSnapshot.ts\`, \`featureFlags.ts\`, \`hooks.ts\`, \`masterPromptContent.ts\`, \`masterPromptPdfGenerator.ts\`, \`notificationUtils.ts\`, \`oauthConfig.ts\`, \`postHealth.ts\`, \`socialConnectionsPrompt.ts\`, \`utils.ts\`, \`wakeupScheduler.ts\`, \`weatherTriggers.ts\`.

### Feature Flags (\`src/lib/featureFlags.ts\`)
- \`USE_PIPELINE_FOR_MANUAL_POSTS\` — manual posts go through the job pipeline.
- \`ENABLE_POST_HEALTH_SCORE\` — gate publish on health ≥ 60.
- \`ENABLE_AB_TESTING\` — surface A/B controls.
- \`SHOW_DEBUG_LABELS\` — show execution-path pills (default \`true\`).
- All flags overridable via \`localStorage\`.

---

## UI / UX Design System

- **Theme**: dark-mode-first, minimalist glassmorphic.
- **Typography**: Space Grotesk (headings), JetBrains Mono (data/code), Inter for body.
- **Tokens**: HSL semantic tokens in \`src/index.css\` and \`tailwind.config.ts\` — \`--background\`, \`--foreground\`, \`--primary\`, \`--secondary\`, \`--muted\`, \`--accent\`, \`--destructive\`, plus weather tokens \`--weather-warm\`, \`--weather-cool\`, \`--weather-storm\`.
- **Components**: shadcn/ui (Radix primitives) wired through \`src/components/ui/\`.
- **Layout**: tabbed dashboard (Designer / Schedule / History / Analytics / Growth / Jobs / Settings), sticky header with blur backdrop, responsive grids, mobile-friendly.

---

## Tech Stack

| Layer | Tech |
|---|---|
| Framework | React 18 + TypeScript 5 |
| Build | Vite 5 (with \`dedupe: ['react','react-dom']\` — required for Radix) |
| Styling | Tailwind CSS v3 + tailwindcss-animate |
| UI | shadcn/ui (Radix) |
| State | @tanstack/react-query + React hooks |
| Routing | React Router v6 |
| Backend | Lovable Cloud (Supabase) — Postgres + Auth + Storage + Edge Functions (Deno) + Realtime + pg_cron |
| AI text | Lovable AI Gateway → Gemini (caption + image) |
| Video render | Creatomate → JSON2Video → JSON2Video Ken-Burns |
| Voice | ElevenLabs |
| Image export | html-to-image |
| PDF | jsPDF |
| Toasts | sonner |
| Icons | lucide-react |

---

## Storage Buckets

- \`generated-images\` — AI-generated card backgrounds and post stills.
- \`brand-assets\` — public brand visuals (logos, overlays, badges).
- Preview rendered videos staged via \`upload-preview-video\`.

---

## Authentication

- Supabase Auth with email/password.
- Google OAuth enabled for sign-in.
- Roles in a dedicated \`user_roles\` table; never on the profile/users table. \`has_role()\` is \`SECURITY DEFINER\` to avoid RLS recursion.
- No anonymous sign-ups. Email confirmation enabled.

---

## Cron / Scheduling

Configured via Supabase pg_cron and bootstrapped by \`sync-cron-secret\`:
- \`auto-post-scheduler\` — morning, afternoon, evening enqueues.
- \`analyze-growth\` — every 6 hours.
- \`detect-weather-trends\` — daily.
- \`analyze-performance\` — 24 h after publish.
- Sync jobs (\`sync-platform-metrics\`, \`sync-youtube-metrics\`, etc.) on their own intervals.

---

## File Structure

\`\`\`
src/
├── components/                # Feature + shadcn ui/
├── hooks/                     # Auth, weather, notifications, active city, growth
├── lib/                       # api, featureFlags, postHealth, oauthConfig, masterPrompt*
├── pages/                     # Index, Auth, JobsDashboard, ExportSpec, callbacks
├── types/weather.ts
└── integrations/supabase/     # client.ts + auto-generated types.ts (do NOT edit)

supabase/
├── functions/
│   ├── _shared/               # adapters + video-render + caption-style + learning
│   ├── fetch-weather / generate-caption / generate-hooks / daily-weather-post
│   ├── process-scheduled-posts / auto-post-scheduler / run-jobs
│   ├── enqueue-preview-job / publish-preview-bundle / upload-preview-video
│   ├── tts-preview
│   ├── analyze-performance / analyze-growth / detect-weather-trends
│   ├── compute-winner-stats / experiments-resolve
│   ├── sync-platform-metrics / sync-post-performance / sync-youtube-metrics / refresh-youtube-analytics
│   ├── youtube-channel-stats / youtube-health-check
│   ├── create-weekly-recap / generate-spec / sync-cron-secret
│   └── youtube-auth / tiktok-auth / twitter-auth / linkedin-auth
└── config.toml
\`\`\`

---

## Conventions for Contributors / External LLMs

1. **TypeScript** everywhere, strict types.
2. **Tailwind semantic tokens only** — never raw colors in components. HSL tokens defined in \`index.css\` and \`tailwind.config.ts\`.
3. **shadcn/ui** via \`@/components/ui/*\`.
4. **Path alias** \`@/\` for all imports.
5. **Toasts** with \`sonner\`.
6. **Supabase** via \`@/integrations/supabase/client\` — never edit \`client.ts\` or \`types.ts\`.
7. **Server state** via React Query.
8. **Edge Functions** in Deno; reuse \`_shared/\` adapters and helpers; always call \`verifyUser(req)\`; always include CORS headers; avoid complex nested template literals.
9. **Auth-gate** routes with \`useAuth\`.
10. **RLS** policies required on every public table; new social integrations must implement \`PlatformAdapter\`.
11. **Imperial units** in all weather code (°F, mph).
12. **City + State** required for any location lookup.
13. **Vite** must keep \`dedupe: ['react','react-dom']\`.
14. **Dark mode by default** — ensure contrast in every new surface.
15. **Mobile + desktop responsive** with Tailwind breakpoint prefixes.
`;

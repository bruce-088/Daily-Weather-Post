# SkyBrief – Application Specification
_Generated: 2026-05-16 | Version: 1.4.0_

---

## 1. App Identity
- **Name**: SkyBrief
- **Version**: 1.4.0
- **Tagline**: Automated weather posts for every platform.
- **Frontend**: React 18 + Vite 5 + TypeScript 5 + Tailwind CSS v3 (shadcn/ui)
- **Backend**: Lovable Cloud (Supabase) – Postgres + Auth + Storage + Edge Functions (Deno)
- **Database**: PostgreSQL (managed)
- **Edge runtime**: Deno (Supabase Edge Functions)

---

## 2. Features
| Feature | Status | Notes |
|---|---|---|
| Create – Manual weather card & video generation | ✅ Working | Generate, preview, and post weather cards/videos on demand. |
| Schedule – Queue posts for future delivery | ✅ Working | Stores into scheduled_posts; processed by cron. |
| History – Past post log with status badges | ✅ Working | Reads post_history; tags Automated vs manual posts. |
| Automation – 3x/day auto-post (morning/afternoon/evening) | ✅ Working | auto-post-scheduler runs every 5 minutes with a 10-minute trigger window and 30-minute duplicate guard. |
| AI Voiceover (ElevenLabs) | ✅ Working | Per-user voice, speed, stability, similarity controls; live Test Voice preview. |
| AI Captions (Lovable AI / Gemini) | ✅ Working | generate-caption edge function with anti-clone, CTA rotation, and personality logic. |
| Notifications (in-app, realtime) | ✅ Working | notifications table + realtime subscription. |
| Social integrations: TikTok, YouTube, X/Twitter, LinkedIn, Instagram | ✅ Working | OAuth flows; Instagram via Graph API. |
| Video rendering via Creatomate (with Remotion fallback) | ⚠️ Partial | Creatomate primary; fallback path is environment-dependent. |
| Export Spec (this document) | ✅ Working | generate-spec edge function returns live Markdown. |
| Job Pipeline Dashboard | ✅ Working | Visual pipeline showing step-by-step job progress per post. |
| Duplicate Post Protection | ✅ Working | DB-level exclusion constraint + runtime dedupe checks. |
| City-to-Channel Routing Guard | ✅ Working | Strict mapping prevents cross-city content contamination. |
| Slot-based Title & Caption Branding | ✅ Working | Titles prefixed with [8 AM]/[1 PM]/[6 PM]; captions include location beacon. |

---

## 3. Slot System

Slots define the three daily automation windows and drive caption tone, title prefix, and scheduling logic.

| Slot | Time | Title Prefix | Caption Personality |
|---|---|---|---|
| Morning | 8:00 AM (local) | [8 AM] | Upbeat / Energetic |
| Afternoon | 1:00 PM (local) | [1 PM] | Informative / Direct |
| Evening | 6:00 PM (local) | [6 PM] | Calm / Cinematic |

- Slot times are stored per-city in `weather_settings` as `morning_post_time`, `afternoon_post_time`, `evening_post_time`.
- All times are evaluated in the city's local timezone (stored in `weather_settings.timezone`).
- Slots determine: posting time, caption personality, title prefix, and CTA rotation index.

---

## 4. Execution Sources

Every post in SkyBrief originates from one of three sources. Each source is tagged internally to ensure isolation and prevent cross-triggering.

| Source | Trigger | Tag |
|---|---|---|
| Manual | User clicks "Post Now" on Create page | `source=manual` |
| Scheduled | User creates a future post via Schedule tab | `source=scheduled` |
| Automated | Cron fires auto-post-scheduler every 5 minutes | `source=automated` |

- "Run This Slot Now" executes ONLY the specific city_id + slot combination requested.
- Automated runs bypass manual slot execution paths.
- All sources feed into the same `process-scheduled-posts` pipeline.

---

## 5. Pipeline Flow

Every post (manual, scheduled, or automated) follows this pipeline:

```
Trigger (manual / scheduled / automated)
  → auto-post-scheduler OR direct call
  → process-scheduled-posts
    → Create job in `jobs` table
    → Step 1: generate_content (caption + title)
    → Step 2: generate_voice (ElevenLabs, optional)
    → Step 3: render_video (Creatomate)
    → Step 4: publish_post (platform adapter)
    → Step 5: analyze_performance (post-publish)
  → Write result to `post_history`
  → Insert notification for user
```

- Each step is independently retryable.
- Earlier successful steps (including rendered video) are cached and reused on retry.
- Failures at any step do not block future automation cycles.

---

## 6. Database Schema

### `weather_settings`
- id (uuid, PK)
- user_id (uuid)
- city (text)
- state (text)
- timezone (text)
- post_time (time)
- morning_post_time (time)
- afternoon_post_time (time)
- evening_post_time (time)
- auto_post_morning / auto_post_afternoon / auto_post_evening (bool)
- morning_platforms / afternoon_platforms / evening_platforms (jsonb)
- morning_skip_date / afternoon_skip_date / evening_skip_date (date)
- enable_voiceover (bool)
- voiceover_voice_id (text)
- voiceover_speed (numeric)
- voiceover_stability (numeric)
- voiceover_similarity (numeric)
- tiktok_* / youtube_* / twitter_* / linkedin_* OAuth tokens

### `scheduled_posts`
- id (uuid, PK)
- user_id (uuid)
- platform (text)
- city (text)
- scheduled_at (timestamptz)
- status (text)
- caption (text)
- include_voiceover (bool)
- voiceover_url (text)
- error_message (text)

### `post_history`
- id (uuid, PK)
- user_id (uuid)
- platform (text)
- city (text)
- condition (text)
- temperature (numeric)
- image_url (text)
- caption (text)
- status (text)
- error_message (text)
- created_at (timestamptz)

### `jobs`
- id (uuid, PK)
- scheduled_post_id (uuid, FK → scheduled_posts.id)
- user_id (uuid)
- city (text)
- platform (text)
- status (text: pending | running | retrying | succeeded | failed)
- step (text: generate_content | generate_voice | render_video | publish_post | analyze)
- error_message (text)
- created_at (timestamptz)
- updated_at (timestamptz)

**Constraint:** `unique_scheduled_post_job` — exclusion constraint on `scheduled_post_id` where status IN ('pending', 'running', 'retrying', 'succeeded'). Prevents duplicate active jobs at the database level.

### `notifications`
- id (uuid, PK)
- user_id (uuid)
- title (text)
- message (text)
- type (text)
- read (bool)
- created_at (timestamptz)

### `system_health`
- id (text, PK)
- last_run_at (timestamptz)
- last_status (text)
- last_message (text)
- updated_at (timestamptz)

**Relationships**: All user-owned tables reference `auth.users.id` via `user_id` (no FK; enforced by RLS). `scheduled_posts` becomes `post_history` rows after processing.

---

## 7. Edge Functions

### `auto-post-scheduler`
- Runs every 5 minutes via pg_cron.
- Checks all `weather_settings` rows for slots due within the current 10-minute window.
- Creates `scheduled_posts` rows and triggers `process-scheduled-posts`.
- Enforces 30-minute duplicate guard per slot per user.
- Uses service_role key for authorization.

### `process-scheduled-posts`
- Core execution engine for all post types.
- Runs the full pipeline: caption → voice → render → publish → analyze.
- Creates and updates `jobs` table rows for each step.
- Handles retries at the step level (not full pipeline restarts).
- Caches rendered video to avoid duplicate render charges on retry.

### `generate-caption`
- Generates AI captions using Lovable AI Gateway (Google Gemini).
- Accepts slot, city, weather data, and previous caption context.
- Applies personality rotation, CTA rotation, and anti-repeat logic.
- Includes similarity validation with one automatic regeneration cycle.
- Fail-safe: any enhancement failure falls back to base caption logic silently.

### `generate-spec`
- Returns this document as live Markdown.
- Pulls recent activity from `post_history` for the Recent Changes Log.

---

## 8. Idempotency & Duplicate Protection

SkyBrief uses a multi-layer approach to prevent duplicate posts:

### Layer 1 — Database Constraint
- Exclusion constraint on `jobs.scheduled_post_id` prevents two active jobs for the same post.
- Enforced at the Postgres level — cannot be bypassed by application code.

### Layer 2 — Runtime Dedupe Check
- Before publishing, the system checks `post_history` for a successful post with the same city + platform + date + slot within the last 60 minutes.
- If found, the publish step is skipped and the existing post URL is returned.

### Layer 3 — Slot Idempotency Key
- Unique key format: `city_id + local_date + slot_name + platform`
- Applied at both the `scheduled_posts` creation step and the `publish_post` step.

---

## 9. Caption Generation System

### Personality Rotation (by slot)
| Slot | Personality |
|---|---|
| Morning | Upbeat / Energetic |
| Afternoon | Informative / Direct |
| Evening | Calm / Cinematic |

### CTA Rotation Pool
Rotated deterministically by `(date + slot)` index:
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

---

## 10. City-to-Channel Routing Guard

Prevents cross-city content contamination (e.g., Gainesville content on Orlando channel).

### Pre-Flight Check
- Before publishing, resolves the target channel ID directly from the `city_id` mapping in `weather_settings`.
- Asserts that the city name in the post content matches the city assigned to the target channel.
- If mismatch detected → job fails with `ROUTING_VIOLATION` error (does not publish).

### Template Isolation
- All template variables (city name, channel handle, subscribe URLs, state name) are cleared and reset for every generation cycle.
- AI prompt explicitly scoped to the target city: "You are writing for the [CITY] channel only."

---

## 11. Error Handling Strategy

SkyBrief uses a **fail-open philosophy**: posts should publish even if non-critical steps fail.

| Failure | Behavior |
|---|---|
| Voiceover generation fails | Post continues without audio |
| Caption enhancement fails | Fallback to base caption |
| Similarity check fails | Keep original caption, log warning |
| Rendering fails | Retry or fallback renderer |
| Routing violation detected | Abort publish, log ROUTING_VIOLATION |
| Duplicate detected | Skip publish, log dedupe event |
| Any pipeline step fails | Log to system_logs + job record; future cycles unaffected |

---

## 12. API Integrations
| Integration | Used for |
|---|---|
| OpenWeather | Forecast & current conditions (Imperial units). |
| Creatomate | Video rendering pipeline. |
| ElevenLabs | TTS voiceover for auto-posts. |
| Lovable AI Gateway (Google Gemini) | Caption generation. |
| Pexels | Stock imagery for video backgrounds. |
| YouTube Data API v3 | Shorts upload (resumable). |
| X/Twitter v1.1 + v2 | OAuth 1.0a HMAC-SHA1; chunked media upload. |
| LinkedIn API v202601 | Person + organization posts. |
| TikTok Content Posting API | video.publish / video.upload. |
| Instagram Graph API | Business/Creator account publishing. |

---

## 13. Known Issues / Limitations
- Voiceover generation depends on ElevenLabs availability; on failure the post still publishes without audio.
- Creatomate fallback to a Remotion-based external renderer is environment-dependent.
- Cron drift up to ~10 minutes is expected (matched window). Posts overdue >10 min show a red badge.
- App version (1.4.0) is currently maintained as a constant inside generate-spec.
- Recent Changes Log is sourced from the latest post_history activity, not git commits.

---

## 14. Recently Resolved Issues
| Issue | Resolution |
|---|---|
| Automation not firing | Fixed pg_cron using anon key instead of service_role key |
| Timezone misalignment | Fixed slot time comparison to use city-local timezone |
| Duplicate YouTube uploads | Added DB-level exclusion constraint on jobs table |
| Cross-city routing (Gainesville on Orlando channel) | Added pre-flight routing guard in publish step |
| Identical post titles/captions | Added anti-clone logic, CTA rotation, personality rotation |
| Silent pipeline failures | Added fail-safe try/catch wrappers on all caption enhancements |

---

## 15. Deployment
- **Frontend**: React 18 + Vite + TypeScript + Tailwind (Lovable Cloud)
- **Backend**: Managed Postgres + Serverless Edge Runtime (Supabase via Lovable Cloud)
- **Cron**: pg_cron extension, every 5 minutes, authenticated with service_role key
- **Storage**: Supabase Storage (video/image assets)
- **Auth**: Supabase Auth (email/password + OAuth)

---

## 16. Recent Changes Log
_Pulled live from post_history (last 10 events)_

| When (UTC) | Status | Platform | City |
|---|---|---|---|
| 2026-05-16 15:45 | success | youtube | Gainesville |
| 2026-05-16 15:45 | success | youtube | Gainesville |
| 2026-05-16 14:29 | success | youtube | Orlando |
| 2026-05-16 13:58 | success | youtube | Gainesville |
| 2026-05-16 12:31 | success | youtube | Gainesville |
| 2026-05-16 12:31 | success | youtube | Gainesville |
| 2026-05-16 12:31 | success | youtube | Gainesville |
| 2026-05-16 12:31 | success | youtube | Orlando |
| 2026-05-16 12:31 | success | youtube | Gainesville |
| 2026-05-16 12:30 | success | youtube | Orlando |



# Plan: Generate a Reusable Social Connections Prompt

This is not an implementation task — it's a content generation task. I'll create a comprehensive, copy-pasteable prompt that you can use in any new Lovable project to replicate the full social media connection infrastructure (TikTok, YouTube, Twitter/X, LinkedIn) with OAuth flows and direct posting capability.

The prompt will be based on the exact architecture in this project and will cover:

1. **Database schema** — `social_connections` table storing OAuth tokens per platform per user
2. **Edge functions** — OAuth auth handlers for each platform (get_auth_url, exchange_code, refresh_token)
3. **Shared auth helper** — JWT verification for edge functions
4. **Platform adapters** — Interface + implementations for each platform's upload API
5. **Frontend** — Settings panel with Connect/Disconnect buttons, OAuth callback pages, routing
6. **Required secrets** — What API keys to configure per platform
7. **Security** — CSRF state validation, token refresh, RLS policies

Here's the prompt I'll provide (not as a code change, but as text you can copy):

---

**Deliverable**: A single markdown prompt block you can paste into a new Lovable project chat. It will instruct Lovable to build:

- A `social_connections` table (or equivalent `weather_settings`-style table) with columns for each platform's tokens
- Four edge functions: `tiktok-auth`, `youtube-auth`, `twitter-auth`, `linkedin-auth` — each supporting `get_auth_url`, `exchange_code`, and `refresh_token` actions
- A shared `_shared/auth-helpers.ts` for JWT verification
- Platform adapter classes (`_shared/twitter-adapter.ts`, etc.) implementing a common `PlatformAdapter` interface with `uploadVideo` and `uploadImage` methods
- A `SettingsPanel` component with Connect/Disconnect UI per platform
- Four callback pages (`/tiktok/callback`, `/youtube/callback`, `/twitter/callback`, `/linkedin/callback`) with CSRF state validation
- App routes wrapped in `ProtectedRoute`
- Required secrets list (TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET)

Since this is a text/content deliverable rather than a code change, I'll write the full prompt directly in my response after switching to default mode. No files need to be modified.


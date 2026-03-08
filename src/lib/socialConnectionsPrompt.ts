export const SOCIAL_CONNECTIONS_PROMPT = `# Social Media Connection & Direct Posting Infrastructure

Build a complete social media connection system that lets authenticated users connect their TikTok, YouTube, Twitter/X, and LinkedIn accounts via OAuth, then post content (images and videos) directly to those platforms.

---

## 1. Database Schema

Create a \`social_connections\` table to store per-user OAuth credentials:

\`\`\`sql
CREATE TABLE public.social_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- TikTok
  tiktok_access_token TEXT,
  tiktok_refresh_token TEXT,
  tiktok_open_id TEXT,
  tiktok_token_expires_at TIMESTAMPTZ,

  -- YouTube
  youtube_access_token TEXT,
  youtube_refresh_token TEXT,
  youtube_channel_id TEXT,
  youtube_token_expires_at TIMESTAMPTZ,

  -- Twitter / X (OAuth 1.0a — no expiry)
  twitter_access_token TEXT,
  twitter_access_token_secret TEXT,
  twitter_user_id TEXT,

  -- LinkedIn
  linkedin_access_token TEXT,
  linkedin_refresh_token TEXT,
  linkedin_person_urn TEXT,
  linkedin_organization_urn TEXT,
  linkedin_token_expires_at TIMESTAMPTZ,

  UNIQUE (user_id)
);

ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own connections"
  ON public.social_connections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connections"
  ON public.social_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connections"
  ON public.social_connections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);
\`\`\`

---

## 2. Shared Auth Helper — \`supabase/functions/_shared/auth-helpers.ts\`

Create a shared module that verifies the JWT from the Authorization header and returns the authenticated user ID. All edge functions that modify user data must call this first.

\`\`\`typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

export async function verifyUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: "Unauthorized",
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      }),
    };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await anonClient.auth.getUser(token);
  if (error || !data?.user?.id) {
    return {
      error: "Unauthorized",
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: corsHeaders,
      }),
    };
  }
  return { userId: data.user.id };
}
\`\`\`

---

## 3. Edge Functions — One Per Platform

Create four edge functions, each supporting three actions:

### Pattern (apply to each platform):

Each function at \`supabase/functions/{platform}-auth/index.ts\` handles:

- **\`get_auth_url\`** — No auth required. Builds the OAuth authorization URL with required scopes and a CSRF \`state\` param. Returns \`{ url, state }\`.
- **\`exchange_code\`** — Requires auth (call \`verifyUser\`). Exchanges the authorization code for access/refresh tokens. Stores tokens in \`social_connections\` (upsert). Returns \`{ success: true }\`.
- **\`refresh_token\`** — Requires auth. Uses the stored refresh token to obtain a new access token. Updates the row in \`social_connections\`.

### Platform-specific details:

**TikTok** (\`tiktok-auth\`):
- OAuth 2.0 Authorization Code flow
- Auth URL: \`https://www.tiktok.com/v2/auth/authorize/\`
- Token endpoint: \`https://open.tiktokapis.com/v2/oauth/token/\`
- Scopes: \`user.info.basic,video.publish,video.upload\`
- Secrets needed: \`TIKTOK_CLIENT_KEY\`, \`TIKTOK_CLIENT_SECRET\`

**YouTube** (\`youtube-auth\`):
- OAuth 2.0 Authorization Code flow
- Auth URL: \`https://accounts.google.com/o/oauth2/v2/auth\`
- Token endpoint: \`https://oauth2.googleapis.com/token\`
- Scopes: \`https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly\`
- After token exchange, fetch channel ID via \`https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true\`
- Secrets needed: \`YOUTUBE_CLIENT_ID\`, \`YOUTUBE_CLIENT_SECRET\`

**Twitter/X** (\`twitter-auth\`):
- OAuth 1.0a (3-legged) flow
- Request token: \`https://api.twitter.com/oauth/request_token\`
- Auth URL: \`https://api.twitter.com/oauth/authorize\`
- Access token: \`https://api.twitter.com/oauth/access_token\`
- Requires HMAC-SHA1 signature generation for each request
- Secrets needed: \`TWITTER_CONSUMER_KEY\`, \`TWITTER_CONSUMER_SECRET\`

**LinkedIn** (\`linkedin-auth\`):
- OAuth 2.0 Authorization Code flow
- Auth URL: \`https://www.linkedin.com/oauth/v2/authorization\`
- Token endpoint: \`https://www.linkedin.com/oauth/v2/accessToken\`
- Scopes: \`openid profile w_member_social w_organization_social rw_organization_admin\`
- After token exchange, fetch person URN from \`https://api.linkedin.com/v2/userinfo\` and org list from \`https://api.linkedin.com/rest/organizationAcls\`
- If multiple orgs, return the list for user selection; add a \`set_organization\` action
- Secrets needed: \`LINKEDIN_CLIENT_ID\`, \`LINKEDIN_CLIENT_SECRET\`

---

## 4. Platform Adapter Pattern — \`supabase/functions/_shared/\`

Create a \`platform-adapter.ts\` file defining the interface:

\`\`\`typescript
export interface UploadResult {
  id: string;
}

export interface PostResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface PlatformAdapter {
  name: string;
  isConnected(settings: Record<string, unknown>): boolean;
  getValidToken(supabase: any, userId: string): Promise<string | null>;
  uploadVideo(token: string, videoData: Uint8Array, title: string, description: string, mimeType?: string): Promise<UploadResult | null>;
}

export function getAdapter(platform: string): PlatformAdapter | null { /* registry lookup */ }
export function getConnectedAdapters(settings: Record<string, unknown>): PlatformAdapter[] { /* filter connected */ }
export async function postToPlatform(platform: string, supabase: any, userId: string, videoData: Uint8Array, title: string, description: string, mimeType?: string): Promise<PostResult> { /* get adapter, get token, upload */ }
\`\`\`

Then create adapter implementations:
- **\`youtube-adapter.ts\`** — Resumable upload to YouTube Data API v3. Check token expiry, refresh if needed.
- **\`twitter-adapter.ts\`** — Chunked media upload via \`https://upload.twitter.com/1.1/media/upload.json\` (INIT → APPEND → FINALIZE → STATUS polling), then tweet via v2 API. Also supports image upload for fallback.
- **\`linkedin-adapter.ts\`** — Register upload → PUT binary → create post via \`https://api.linkedin.com/rest/posts\`. Parse token string for author/person URNs.
- **\`tiktok-adapter.ts\`** — Supports both video upload and photo posting via Content Posting API (\`PULL_FROM_URL\` with \`media_type: "PHOTO"\` for images, \`DIRECT_POST\` mode). Queries creator info for privacy level options.

Each adapter's \`getValidToken\` should check token expiry and auto-refresh if the token is expired, updating the database row.

---

## 5. Frontend Components

### Settings Panel (\`src/components/SettingsPanel.tsx\`)

A card-based settings UI with:
- A section for each platform showing connected/disconnected status via a Badge
- **Connect** button: calls the platform's \`get_auth_url\` edge function, stores CSRF state in \`localStorage\`, then opens the auth URL with \`window.open()\` (use \`window.open\` instead of \`window.location.href\` to avoid iframe \`refused to connect\` errors)
- **Disconnect** button: nullifies all platform-specific token columns in \`social_connections\` via Supabase update
- Use shadcn \`Card\`, \`Button\`, \`Badge\` components with semantic design tokens

### OAuth Callback Pages

Create four pages: \`src/pages/TikTokCallback.tsx\`, \`YouTubeCallback.tsx\`, \`TwitterCallback.tsx\`, \`LinkedInCallback.tsx\`

Each callback page:
1. Reads query params (\`code\`, \`state\`, \`error\`, or \`oauth_token\`/\`oauth_verifier\` for Twitter)
2. Validates CSRF state against \`localStorage\` (except Twitter which uses OAuth 1.0a tokens)
3. Calls the platform's \`exchange_code\` action via \`supabase.functions.invoke()\`
4. Shows loading spinner → success/error message → redirects to \`/\` after 2 seconds
5. For LinkedIn: if multiple orgs returned, show org selection UI before completing

### Routing (\`src/App.tsx\`)

\`\`\`tsx
<Route path="/tiktok/callback" element={<ProtectedRoute><TikTokCallback /></ProtectedRoute>} />
<Route path="/youtube/callback" element={<ProtectedRoute><YouTubeCallback /></ProtectedRoute>} />
<Route path="/twitter/callback" element={<ProtectedRoute><TwitterCallback /></ProtectedRoute>} />
<Route path="/linkedin/callback" element={<ProtectedRoute><LinkedInCallback /></ProtectedRoute>} />
\`\`\`

---

## 6. Required Secrets

Configure these as backend secrets (via Lovable Cloud):

| Secret | Platform |
|---|---|
| \`TIKTOK_CLIENT_KEY\` | TikTok |
| \`TIKTOK_CLIENT_SECRET\` | TikTok |
| \`YOUTUBE_CLIENT_ID\` | YouTube |
| \`YOUTUBE_CLIENT_SECRET\` | YouTube |
| \`TWITTER_CONSUMER_KEY\` | Twitter/X |
| \`TWITTER_CONSUMER_SECRET\` | Twitter/X |
| \`LINKEDIN_CLIENT_ID\` | LinkedIn |
| \`LINKEDIN_CLIENT_SECRET\` | LinkedIn |

---

## 7. Security Requirements

- All edge functions that modify data MUST verify the JWT via \`verifyUser(req)\` before proceeding
- Use \`SUPABASE_SERVICE_ROLE_KEY\` only in edge functions to write tokens (never expose to client)
- OAuth callback pages validate CSRF state from \`localStorage\`
- RLS policies restrict \`social_connections\` rows to the owning \`auth.uid()\`
- Token refresh happens server-side in adapters; never send refresh tokens to the client
- Use \`window.open()\` for OAuth redirects to avoid iframe restrictions

---

## 8. Tech Stack

- React + TypeScript + Vite
- Tailwind CSS with semantic design tokens
- shadcn/ui components
- \`@/\` import path aliases
- \`sonner\` for toast notifications
- Supabase JS client from \`@/integrations/supabase/client\`
- Deno edge functions with \`https://esm.sh/\` imports
`;

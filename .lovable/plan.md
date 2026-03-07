

## Plan: Extract Reusable Platform Adapter Pattern

### Problem
YouTube upload logic, token refresh, and platform-specific code is duplicated across `daily-weather-post`, `process-scheduled-posts`, and `upload-preview-video`. Adding a new platform (LinkedIn, Twitter) means copy-pasting and modifying this pattern in 3 places.

### Solution
Create a shared platform adapter interface and extract each platform into its own adapter. The edge functions call a unified `postToplatform()` dispatcher instead of inline platform logic.

### Architecture

```text
supabase/functions/_shared/
  ├── platform-adapter.ts      # Interface + dispatcher
  ├── youtube-adapter.ts       # YouTube upload + token refresh
  ├── tiktok-adapter.ts        # TikTok (stub, ready to implement)
  └── instagram-adapter.ts     # Instagram (stub)
```

### Platform Adapter Interface

```typescript
// platform-adapter.ts
export interface PlatformAdapter {
  name: string;
  isConnected(settings: any): boolean;
  getValidToken(supabase: any, userId: string): Promise<string | null>;
  uploadVideo(token: string, videoData: Uint8Array, title: string, description: string): Promise<{ id: string } | null>;
}
```

A dispatcher function selects the right adapter:

```typescript
export function getAdapter(platform: string): PlatformAdapter | null
export async function postToPlatform(platform: string, supabase: any, userId: string, video, title, desc): Promise<{success, id?, error?}>
```

### Changes

**1. New file: `supabase/functions/_shared/platform-adapter.ts`**
- Define `PlatformAdapter` interface and `postToPlatform` dispatcher

**2. New file: `supabase/functions/_shared/youtube-adapter.ts`**
- Extract `getValidYouTubeToken` and `uploadToYouTubeShorts` from `daily-weather-post`
- Implement `PlatformAdapter` interface

**3. New file: `supabase/functions/_shared/tiktok-adapter.ts`**
- Stub implementing the interface, returns `isConnected: false` until TikTok Content API is wired

**4. New file: `supabase/functions/_shared/instagram-adapter.ts`**
- Stub implementing the interface

**5. Modify: `supabase/functions/daily-weather-post/index.ts`**
- Remove inline YouTube upload functions (~120 lines)
- Import `postToPlatform` from shared module
- Replace the platform-specific upload block (lines 892-954) with a loop over connected adapters

**6. Modify: `supabase/functions/process-scheduled-posts/index.ts`**
- Remove duplicated YouTube functions
- Import and use shared `postToPlatform` for the upload block (lines 767-794)

**7. Modify: `supabase/functions/upload-preview-video/index.ts`**
- Import `YouTubeAdapter` from shared module instead of inline token/upload functions

### Adding a New Platform (e.g. LinkedIn)

After this refactor, adding LinkedIn requires:
1. Create `supabase/functions/_shared/linkedin-adapter.ts` implementing `PlatformAdapter`
2. Register it in the adapter registry in `platform-adapter.ts`
3. Add LinkedIn OAuth columns to `weather_settings` (migration)
4. Add LinkedIn OAuth edge function + callback page (same pattern as YouTube)
5. Update the `post_history_platform_check` constraint

No changes needed to the core posting logic in `daily-weather-post` or `process-scheduled-posts`.

### Important Notes
- Edge functions can import from `_shared/` using relative paths (Deno supports this)
- The `_shared` folder prefix with underscore prevents it from being deployed as its own function
- No database changes required for this refactor
- All existing functionality stays identical; this is a pure structural refactor


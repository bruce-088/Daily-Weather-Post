export const MASTER_PROMPT = `# SkyBrief — Full App Specification

## Overview

SkyBrief is a social media automation tool that generates weather-based content (images and videos) and posts them to connected platforms (YouTube, Twitter/X, LinkedIn, TikTok). It features automated scheduling, AI-powered caption generation, and a visual weather card designer.

---

## Core Features

### Weather Card Designer
- Real-time weather data fetching by city/state
- Dual aspect ratio support: 1:1 (Feed) and 9:16 (Story)
- Live preview with export to PNG (3x pixel ratio)
- Auto-refresh every 30 minutes

### AI Caption Generation
- Generates social media captions based on current weather data
- Editable textarea for manual adjustments
- Regenerate capability

### Multi-Platform Posting
- **YouTube**: Video uploads via resumable upload API
- **Twitter/X**: Image and video posting via OAuth 1.0a media upload
- **LinkedIn**: Image posting via UGC Post API with registered uploads
- **TikTok**: Photo posting via Content Posting API (PULL_FROM_URL)
- Platform picker with checkbox selection (post to all or specific platforms)

### Scheduled Posts
- Schedule posts for future date/time with city and platform selection
- Background processing via edge function (\`process-scheduled-posts\`)
- Edit and cancel scheduled posts

### Automated Daily Posts
- Three configurable time slots: morning, afternoon, evening
- Per-slot enable/disable toggles
- Background cron via edge function (\`auto-post-scheduler\`)

### Image Generation Fallback
- Primary: Creatomate video generation
- Fallback: AI-powered image generation via Gemini
- Generated images stored in Supabase Storage (\`generated-images\` bucket)

### Notifications
- In-app notification bell with unread count
- Real-time updates for post status changes

---

## Database Schema

### \`weather_settings\`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References auth.users |
| city | text | Weather location city |
| state | text | Weather location state |
| post_time | text | Legacy post time |
| morning_post_time | text | Morning auto-post time |
| afternoon_post_time | text | Afternoon auto-post time |
| evening_post_time | text | Evening auto-post time |
| auto_post | boolean | Global auto-post toggle |
| auto_post_morning | boolean | Morning slot enabled |
| auto_post_afternoon | boolean | Afternoon slot enabled |
| auto_post_evening | boolean | Evening slot enabled |
| instagram_api_key | text | Instagram API key |
| tiktok_access_token | text | TikTok OAuth token |
| tiktok_refresh_token | text | TikTok refresh token |
| tiktok_open_id | text | TikTok user ID |
| tiktok_api_key | text | TikTok API key |
| tiktok_token_expires_at | timestamptz | Token expiry |
| youtube_access_token | text | YouTube OAuth token |
| youtube_refresh_token | text | YouTube refresh token |
| youtube_channel_id | text | YouTube channel ID |
| youtube_token_expires_at | timestamptz | Token expiry |
| twitter_access_token | text | Twitter OAuth token |
| twitter_access_token_secret | text | Twitter OAuth secret |
| twitter_user_id | text | Twitter user ID |
| linkedin_access_token | text | LinkedIn OAuth token |
| linkedin_refresh_token | text | LinkedIn refresh token |
| linkedin_person_urn | text | LinkedIn person URN |
| linkedin_organization_urn | text | LinkedIn org URN |
| linkedin_token_expires_at | timestamptz | Token expiry |

### \`post_history\`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References auth.users |
| city | text | City posted for |
| temperature | numeric | Temperature value |
| condition | text | Weather condition |
| caption | text | Post caption |
| image_url | text | Generated image URL |
| platform | text | Target platform |
| status | text | Post status (posted/failed) |
| error_message | text | Error details |
| created_at | timestamptz | Timestamp |

### \`scheduled_posts\`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References auth.users |
| city | text | City to post for |
| caption | text | Post caption |
| platform | text | Target platform |
| scheduled_at | timestamptz | Scheduled time |
| status | text | pending/posted/failed/cancelled |
| error_message | text | Error details |
| created_at | timestamptz | Timestamp |

### \`notifications\`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | References auth.users |
| title | text | Notification title |
| message | text | Notification body |
| type | text | Notification type |
| read | boolean | Read status |
| created_at | timestamptz | Timestamp |

---

## Edge Functions

| Function | Purpose |
|----------|---------|
| \`fetch-weather\` | Fetches weather data from external API |
| \`daily-weather-post\` | Generates content and posts to platforms |
| \`generate-caption\` | AI-powered caption generation |
| \`auto-post-scheduler\` | Cron-triggered automated posting |
| \`process-scheduled-posts\` | Processes pending scheduled posts |
| \`upload-preview-video\` | Handles video preview uploads |
| \`tiktok-auth\` | TikTok OAuth flow handler |
| \`youtube-auth\` | YouTube OAuth flow handler |
| \`twitter-auth\` | Twitter/X OAuth flow handler |
| \`linkedin-auth\` | LinkedIn OAuth flow handler |

### Platform Adapters (\`_shared/\`)
- \`twitter-adapter.ts\` — OAuth 1.0a signing, media upload (image + video), tweet creation
- \`youtube-adapter.ts\` — Resumable video upload, metadata setting
- \`linkedin-adapter.ts\` — Registered image upload, UGC post creation
- \`tiktok-adapter.ts\` — Content posting API (photo via PULL_FROM_URL)
- \`instagram-adapter.ts\` — Instagram posting adapter
- \`platform-adapter.ts\` — Base adapter interface
- \`auth-helpers.ts\` — Shared authentication utilities

---

## UI/UX Design System

### Theme
- Dark mode by default
- HSL-based CSS custom properties
- Semantic tokens: \`--background\`, \`--foreground\`, \`--primary\`, \`--secondary\`, \`--muted\`, \`--accent\`, \`--destructive\`
- Weather-specific tokens: \`--weather-warm\`, \`--weather-cool\`, \`--weather-storm\`

### Components
- shadcn/ui component library (Button, Card, Tabs, Dialog, Popover, Badge, etc.)
- Custom components: WeatherCard, MobilePreview, SettingsPanel, NotificationBell
- Responsive layout with container queries
- Sticky header with blur backdrop

### Layout
- Tabbed interface: Designer, Preview, Schedule, History, Settings
- Sidebar settings panel in Designer tab
- Mobile-responsive grid layouts

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS + tailwindcss-animate |
| UI Library | shadcn/ui (Radix primitives) |
| State | React Query (@tanstack/react-query) |
| Routing | React Router v6 |
| Backend | Supabase (Lovable Cloud) |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| Edge Functions | Deno (Supabase Edge Functions) |
| Image Export | html-to-image |
| PDF Generation | jsPDF |
| Toasts | sonner |
| Icons | lucide-react |

---

## File Structure

\`\`\`
src/
├── components/
│   ├── ui/              # shadcn/ui components
│   ├── WeatherCard.tsx   # Weather display card
│   ├── WeatherIcon.tsx   # Weather condition icons
│   ├── MobilePreview.tsx # Phone frame preview
│   ├── SettingsPanel.tsx  # Settings form
│   ├── NotificationBell.tsx
│   ├── PostHistoryList.tsx
│   ├── SchedulePostForm.tsx
│   ├── ScheduledPostsList.tsx
│   ├── EditScheduledPostDialog.tsx
│   ├── VideoPreviewDialog.tsx
│   └── NavLink.tsx
├── hooks/
│   ├── useAuth.ts
│   ├── useWeather.ts
│   ├── useNotifications.ts
│   └── use-mobile.tsx
├── lib/
│   ├── api.ts            # API helper functions
│   ├── utils.ts          # Utility functions
│   ├── masterPromptContent.ts
│   └── masterPromptPdfGenerator.ts
├── pages/
│   ├── Index.tsx          # Main dashboard
│   ├── Auth.tsx           # Login/signup
│   ├── ExportSpec.tsx     # App spec export
│   └── ...callback pages
├── types/
│   └── weather.ts
└── integrations/
    └── supabase/
        ├── client.ts
        └── types.ts

supabase/
├── functions/
│   ├── _shared/          # Platform adapters
│   ├── fetch-weather/
│   ├── daily-weather-post/
│   ├── generate-caption/
│   ├── auto-post-scheduler/
│   ├── process-scheduled-posts/
│   └── ...-auth/         # OAuth handlers
└── config.toml
\`\`\`

---

## Instructions for External LLMs

When working with this codebase:

1. **TypeScript** — All code must be written in TypeScript with proper type annotations.
2. **Tailwind CSS** — Use Tailwind utility classes for styling. Use semantic design tokens from \`index.css\` and \`tailwind.config.ts\` (e.g., \`bg-background\`, \`text-foreground\`, \`border-border\`). Never use raw color values in components.
3. **shadcn/ui** — Use existing shadcn/ui components from \`src/components/ui/\`. Import them with the \`@/\` path alias.
4. **Import Paths** — Always use \`@/\` path aliases (e.g., \`@/components/ui/button\`, \`@/lib/utils\`, \`@/hooks/useAuth\`).
5. **Toasts** — Use \`sonner\` for toast notifications: \`import { toast } from "sonner"\`.
6. **Supabase Client** — Import from \`@/integrations/supabase/client\`. Never modify this file.
7. **State Management** — Use React Query for server state, React hooks for local state.
8. **Edge Functions** — Write in Deno/TypeScript. Use shared adapters from \`_shared/\` directory.
9. **Authentication** — Always check auth state via \`useAuth\` hook. Protect routes with \`ProtectedRoute\` wrapper.
10. **Database** — Use Supabase SDK for all database operations. Always consider RLS policies.
11. **Dark Mode** — The app runs in dark mode by default. Ensure all UI elements have proper contrast.
12. **Responsive** — Support mobile and desktop layouts using Tailwind responsive prefixes.
`;

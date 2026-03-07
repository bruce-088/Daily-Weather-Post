

# Plan: Enable Automated Daily LinkedIn Company Page Posting

## Current State
- LinkedIn OAuth, adapter, and auth edge function are implemented for **personal profiles** (`urn:li:person:...`)
- LinkedIn secrets (CLIENT_ID, CLIENT_SECRET) are already configured
- The auto-post scheduler and platform adapter architecture already support LinkedIn
- The LinkedIn adapter posts using `personUrn` as the author — this needs to support **organization URNs** for company pages

## What Needs to Change

### 1. Update LinkedIn OAuth Scopes
The current scopes are `openid profile w_member_social`. For posting to a **Company Page**, the app also needs:
- `r_organization_social` — to read org data
- `w_organization_social` — to post on behalf of the org

**File:** `supabase/functions/linkedin-auth/index.ts`
- Update the `scopes` variable to include organization scopes
- After token exchange, fetch the user's administered organizations via the LinkedIn API and store the selected organization URN in `weather_settings`

### 2. Add Organization URN Storage
**Database migration:**
- Add `linkedin_organization_urn` column to `weather_settings` table (nullable text)

### 3. Update LinkedIn Adapter for Company Pages
**File:** `supabase/functions/_shared/linkedin-adapter.ts`
- Modify `getValidToken` to also return the organization URN (or person URN as fallback)
- Update `uploadVideo` to use `urn:li:organization:...` as the `owner` and `author` when an organization URN is present

### 4. Add Organization Selection UI
**File:** `src/components/SettingsPanel.tsx`
- After LinkedIn OAuth completes successfully, if the user has admin access to organizations, show a selector to pick which Company Page to post to
- Store the selected organization URN via an API call

### 5. Verify Auto-Post Integration
The existing auto-post scheduler (`auto-post-scheduler/index.ts`) and daily post function (`daily-weather-post/index.ts`) already loop through all connected adapters. Once the LinkedIn adapter is properly returning tokens and the organization URN is stored, LinkedIn will be included automatically in the triple-post schedule — no changes needed to these files.

## Summary of File Changes
| File | Change |
|------|--------|
| DB migration | Add `linkedin_organization_urn` column |
| `supabase/functions/linkedin-auth/index.ts` | Add org scopes, fetch & store org URN |
| `supabase/functions/_shared/linkedin-adapter.ts` | Use org URN as author when available |
| `src/components/SettingsPanel.tsx` | Add org selection after LinkedIn connect |


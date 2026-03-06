

## Plan: Create Terms of Service and Privacy Policy Pages for TikTok API Review

TikTok's developer app review requires a publicly accessible Terms of Service and Privacy Policy page. These need to be public routes (no auth required) and cover data collection, usage, and user rights related to the app and TikTok integration.

### Changes

1. **Create `src/pages/TermsOfService.tsx`**
   - Public page with standard ToS content covering: service description (SkyBrief weather posting), user responsibilities, content ownership, API usage terms, account termination, liability limitations, and TikTok-specific content posting terms.

2. **Create `src/pages/PrivacyPolicy.tsx`**
   - Public page covering: data collected (email, location, API tokens, weather data, post history), how data is used, third-party services (TikTok API, Instagram API, weather APIs), data retention, user rights (access, deletion), cookies, and contact information.

3. **Update `src/App.tsx`**
   - Add two public routes: `/terms` and `/privacy` (no auth required, no redirect if logged in).

4. **Add footer links**
   - Add links to Terms and Privacy in the Auth page footer so they're discoverable and linkable for the TikTok review submission.

Both pages will be styled consistently with the app's dark theme and will be accessible without authentication, as required by TikTok's review process.


## Rename app to "SkyBrief"

Update the user-facing app name from "WeatherPost" / "Lovable App" to **SkyBrief** across the project.

### Changes

1. **`index.html`**
   - `<title>Lovable App` → `SkyBrief`
   - `<meta name="description">` and `og:description` → "SkyBrief — Automated weather posts for social media"
   - `og:title` and `twitter:title` → `SkyBrief`

2. **`src/pages/Index.tsx`** (line 264)
   - Header `<h1>WeatherPost</h1>` → `<h1>SkyBrief</h1>`

3. **`README.md`**
   - Update the project title/intro to SkyBrief.

### Not changed
- `TermsOfService.tsx` and `PrivacyPolicy.tsx` already reference SkyBrief — no edits needed.
- No database, edge function, or routing changes required.
- Favicon/logo assets are not being swapped (rename only).
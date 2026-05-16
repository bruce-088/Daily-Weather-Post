
## Goal
Stop frequent manual YouTube reconnects. The OAuth params already request `access_type=offline` + `prompt=consent`, and a refresh path exists, but three latent bugs cause refresh to silently fail or get corrupted, and there is no 401 retry on upload.

## Changes (auth layer only — no posting/scheduling logic touched)

### 1. `supabase/functions/youtube-auth/index.ts`

a. **Confirm OAuth params (already correct, keep)** — `access_type=offline`, `prompt=select_account consent`, `include_granted_scopes=true`. Add an explicit code comment that these MUST stay to guarantee a refresh_token.

b. **`exchange_code` — never null out refresh_token (already preserved on update). Add safety log if Google returns no refresh_token AND no prior one exists** — surface as warning so we know reconnect was incomplete.

c. **`refresh_token` action — BUG FIX**: today it bulk-updates EVERY `social_accounts` row for `(user_id, platform=youtube)` with the same access_token from a single refresh. In multi-channel setups this overwrites other channels' tokens with a token that belongs to a different channel. Scope the update to the row whose `refresh_token` matches the one we actually used (the legacy `weather_settings.youtube_refresh_token`), OR limit to `city_id IS NULL` (legacy shared row). Prefer matching by refresh_token.

d. **Standardize log prefix** to `[youtube-auth] token refreshed successfully` in both `refresh_token` and `refresh_channel`.

### 2. `supabase/functions/_shared/youtube-adapter.ts`

a. **`getValidToken`** — already refreshes when expiry < now+5min and writes back to the correct `social_accounts` row by `id`. Two small hardenings:
   - Change log to `[youtube-auth] token refreshed successfully` (matches required string).
   - Only clear `refresh_token` on `invalid_grant` (current behavior) — keep, but ALSO log `[youtube-auth] refresh_token invalidated — reconnect required` so we don't silently wipe tokens on transient errors. Treat any non-`invalid_grant`/`invalid_token` error as transient (return null without wiping) — current code already does this; add explicit comment.

b. **`uploadVideo` — add 401 retry (new)**: wrap the resumable init + PUT in a helper that, on `401`, calls a new private `forceRefresh(supabase, userId, cityId)` once, retries the request with the new token, then proceeds. Only the init call practically returns 401 (PUT uses the upload URL which is pre-authorized), but we'll guard both. After one retry, propagate failure as today.
   - Signature stays `(token, videoData, title, description, mimeType, cityId)` to preserve `PlatformAdapter` interface. To enable refresh we need `supabase` + `userId`. Since the interface doesn't pass them, add an optional setter the adapter already uses via `_resolved` cache: store `{supabase, userId, cityId}` keyed by token in a parallel `_refreshCtx` map, populated at the end of `getValidToken`. `uploadVideo` looks it up by token and uses it to force-refresh.

### 3. `supabase/functions/generate-spec/index.ts`

Update the live spec with the Spec Delta below.

## Spec Delta

- **YouTube auth — OAuth params hardening**: `access_type=offline` + `prompt=select_account consent` + `include_granted_scopes=true` are now contractually required and commented as such; removing them breaks long-lived auth.
- **YouTube auth — refresh_token preservation**: `exchange_code` continues to fall back to the previously stored `refresh_token` when Google omits one on re-consent, and now logs a warning if neither exists.
- **YouTube auth — refresh isolation (BUG FIX)**: the legacy `refresh_token` action no longer overwrites every channel's `social_accounts.access_token`. It scopes the update to the row matching the refresh_token actually used (or the shared `city_id IS NULL` row), preventing cross-channel token corruption in multi-channel setups.
- **YouTube adapter — 401 self-heal (NEW)**: `uploadVideo` now performs ONE automatic refresh + retry on a 401 from YouTube's upload init before marking the post as failed.
- **YouTube auth — logging**: standardized `[youtube-auth] token refreshed successfully` log line emitted by both edge-function refresh paths and the adapter's in-flight refresh, plus explicit `[youtube-auth] refresh_token invalidated — reconnect required` when Google returns `invalid_grant`.

## Out of scope
- No DB migrations.
- No changes to `process-scheduled-posts`, job pipeline, scheduling, captions, or any non-YouTube adapter.
- No changes to the OAuth callback frontend.

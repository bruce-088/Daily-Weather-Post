## Goal
Stop Gainesville content (and CTAs/links) from ever reaching another city's channel. Make city→channel routing a hard, asserted invariant at three layers: caption generation, platform adapter, and publish dispatch. Log successful publishes with the exact channel that received them.

## Root causes found

1. **Hardcoded `@SkyBriefGNV` in `youtube-adapter.ts`** (lines 168–169, 185): every Shorts description gets the Gainesville subscribe URL appended, no matter the city. This is the contamination of Orlando descriptions.
2. **Soft fallback to "shared" channel** in `youtube-adapter.ts` (line 57): when a city has no explicit `social_accounts` row, the adapter falls back to the first channel found. With a single shared channel this looks fine; with multiple it can leak — and the per-account first-comment uses `extractCityFromTitle` only, which can mis-guess.
3. **No positive assertion** at publish time that the resolved channel's `city_id` equals the scheduled post's `city_id`. Today we only check "does *a* row exist for this city" — we do not block the case where the adapter used a different one.
4. **Caption prompt** does not explicitly forbid mentioning other cities or other channel handles, so the model can recall stale brand strings (e.g., `@SkyBriefGNV`).
5. **No success log entry** records *which* channel received the post, so contamination is invisible after the fact.

## Fix plan

### 1. YouTube adapter — dynamic per-channel CTA + strict routing
File: `supabase/functions/_shared/youtube-adapter.ts`

- Extend `PlatformAdapter.uploadVideo` signature with an optional `context: { cityId?: string|null; accountName?: string|null; subscribeHandle?: string|null }` (additive, all current callers keep working).
- In `YouTubeAdapter.getValidToken`, return the resolved `account` (handle, channel id, city_id) via a side channel: store on `this._lastResolved` keyed by `userId|cityId`, OR resolve again inside `uploadVideo` using the new context. Cleanest: have `postToPlatform` pass `cityId` through to `uploadVideo`, then `uploadVideo` re-queries `social_accounts` for the same `(userId, "youtube", cityId)` row to read `account_name`.
- Build `YT_CHANNEL_URL` / `YT_CTA` from `account.account_name` (`@SkyBriefOrlando`, `@SkyBriefMiami`, etc.). Fallback chain: `account_name` → derive `@SkyBrief{City}` from title → generic "Subscribe for daily weather updates" (no URL) — **never** a hardcoded `@SkyBriefGNV`.
- Strict routing: if `cityId` is provided AND `channels.length >= 1` AND no row matches `cityId` → **throw `[ROUTING_VIOLATION] no YouTube channel mapped to city <id>`** instead of falling back to the shared row. Single-channel installs without `cityId` keep working.

### 2. Platform adapter dispatcher — pass cityId through and verify
File: `supabase/functions/_shared/platform-adapter.ts`

- Pass `cityId` into `adapter.uploadVideo(...)` so every adapter (YT, TikTok, IG, X, LinkedIn) can scope its own resources.
- After `getValidToken` resolves an account, return that account's `id` + `city_id` from the adapter via an extended `UploadResult` (`{ id, channel_external_id?, resolved_city_id? }`) so `postToPlatform` can assert `resolved_city_id === cityId` before declaring success.
- On mismatch: return `{ success: false, error: "[ROUTING_VIOLATION] resolved channel city does not match scheduled post city" }` — do NOT upload.

### 3. Caption generation — explicit per-city scoping
File: `supabase/functions/generate-caption/index.ts`

- Prepend a hard system directive: `You are generating content EXCLUSIVELY for {city}, {state}. Do NOT mention any other city, region, or social handle. The ONLY handle allowed is ${handle}. Never output @SkyBriefGNV unless city is Gainesville.`
- Post-generation sanitizer (extend existing `stripUnverifiedReferences`): scan for any `@SkyBrief\w+` token that does not equal the dynamic handle and replace with the correct handle (or strip). Log a `system_logs` warning when this triggers.

### 4. Other adapters — sweep for hardcoded city strings
Files: `tiktok-adapter.ts`, `instagram-adapter.ts`, `twitter-adapter.ts`, `linkedin-adapter.ts`

- Grep each for hardcoded city names, `SkyBriefGNV`, or `gainesville` literals. Replace any found CTAs/links with values derived from the resolved account (same pattern as YT). Apply the same strict routing rule (throw `[ROUTING_VIOLATION]` instead of soft fallback when `cityId` is set and no per-city row exists).

### 5. Publish-time routing assertion (defense in depth)
File: `supabase/functions/process-scheduled-posts/index.ts`

- We already check "does a `social_accounts` row exist for `(user_id, platform, city_id)`". Keep that.
- ADD: after `postToPlatform` returns success, verify `result.resolved_city_id === post.city_id`. If not → mark post `failed`, write `system_logs { type: 'routing_violation', message: '[ROUTING_VIOLATION] ${platform} resolved to city ${result.resolved_city_id} but post was for ${post.city_id}' }`, release publish lock, do NOT retry.

### 6. Success logging — channel-level transparency
File: `supabase/functions/process-scheduled-posts/index.ts` (publish success branch around line 2654)

- On each successful platform upload, insert into `system_logs`:
  - `type: 'post_published'`
  - `platform: <platform>`
  - `message: 'Success: {city} posted to {platform} channel: {account_name}'`
  - `context: { scheduled_post_id, city_id, channel_external_id, account_name, external_post_id }`
- Update `system_health` row id `last_publish` with `last_status='ok'`, `last_message='{city} → {platform} {account_name}'`.

### 7. No-op safeguards
- `index.ts` (no DB migration needed — `social_accounts.account_name` already exists).
- All changes are backward-compatible for single-channel installs that don't set `city_id` on their `social_accounts` row.

## Files to edit
- `supabase/functions/_shared/platform-adapter.ts`
- `supabase/functions/_shared/youtube-adapter.ts`
- `supabase/functions/_shared/tiktok-adapter.ts`
- `supabase/functions/_shared/instagram-adapter.ts`
- `supabase/functions/_shared/twitter-adapter.ts`
- `supabase/functions/_shared/linkedin-adapter.ts`
- `supabase/functions/generate-caption/index.ts`
- `supabase/functions/process-scheduled-posts/index.ts`

## Out of scope
No DB migration. No UI changes. No changes to scheduling, render pipeline, analytics, or A/B logic.

## Acceptance
- Orlando YouTube post description contains `@SkyBriefOrlando` (or generic CTA) — **never** `@SkyBriefGNV`.
- Manual "Run This Slot Now" for Gainesville with a missing Gainesville YT mapping → fails fast with `[ROUTING_VIOLATION]` instead of posting to Orlando.
- Every successful publish creates one `system_logs` row naming the city, platform, and channel handle.
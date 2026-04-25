# Sync social connections between users — please read before approving

## What I found

Looking at `weather_settings` for both accounts:

| Account | Row exists | TikTok | YouTube | Twitter/X | LinkedIn |
|---|---|---|---|---|---|
| brucejr08@gmail.com | yes (city: Gainesville) | not connected | connected | connected | connected |
| sample@sample.com | **no row at all** | — | — | — | — |

So "the connections aren't the same" because sample@sample.com has never saved settings or connected any social accounts. Brucejr's account has YouTube, Twitter/X, and LinkedIn connected (TikTok is not connected on either).

## Why I want to confirm before doing this

Each connection stores **OAuth access tokens and refresh tokens** that authenticate as a specific human's social account (Bruce's YouTube channel, Bruce's LinkedIn person URN, Bruce's Twitter user ID). Copying those token rows into sample@sample.com means:

- sample@sample.com would be able to **post to Bruce's YouTube channel, X account, and LinkedIn profile** as if they were Bruce.
- Both accounts would share the same refresh tokens — if one disconnects/reconnects, it can invalidate the other.
- This is effectively giving a second login full posting access to Bruce's social presence.

That may be exactly what you want (e.g. sample@sample.com is a test/admin account you control), but it is not a normal "settings sync" — it's credential sharing. I don't want to do it silently.

## Options

**A. Copy tokens from brucejr08 → sample@sample.com** (what your message literally asks)
   - Insert a `weather_settings` row for sample@sample.com with the same city, post times, platform schedule, and **the same OAuth tokens** as brucejr08.
   - Result: sample@sample.com posts to Bruce's connected social accounts.

**B. Copy only non-credential settings** (city, timezone, post times, schedule platforms, auto-post flags)
   - sample@sample.com gets the same configuration shape, but would still need to connect their own TikTok/YouTube/X/LinkedIn via the Settings panel.
   - Recommended if sample@sample.com is a different person.

**C. Do nothing in the database, and instead investigate why sample@sample.com's UI looks different**
   - If you expected the Settings panel itself to look the same regardless of user, that's a UI/account-state thing, not a data copy.

## What I'll do once you pick

If **A**: insert one row into `public.weather_settings` for sample@sample.com's user_id, copying every column from Bruce's row (except `id`, `user_id`, `created_at`, `updated_at`).

If **B**: same insert, but with all `*_access_token`, `*_refresh_token`, `*_token_expires_at`, `tiktok_open_id`, `youtube_channel_id`, `twitter_user_id`, `twitter_access_token_secret`, `linkedin_person_urn`, `linkedin_organization_urn` set to NULL.

If **C**: I'll dig into the Settings panel rendering logic and report back.

No code files change in any option — this is a data operation only.

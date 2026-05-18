## Goal
Resolve `[ROUTING_VIOLATION] No youtube account for city_id=...` errors when a channel exists for the city but is not linked via `social_accounts.city_id`. Add a **name-based fallback** lookup before declaring a routing violation. No DB changes.

## Root Cause
Two routing checks rely strictly on `social_accounts.city_id` equality:
1. `supabase/functions/_shared/youtube-adapter.ts` (lines 57–70) — `getValidToken`
2. `supabase/functions/process-scheduled-posts/index.ts` (lines 1756–1803) — hard city-isolation gate

If a YouTube account row was connected before the city mapping was assigned (or was assigned to a stale `city_id`), the strict `city_id` equality returns null and we throw `ROUTING_VIOLATION` — even when the channel's `account_name` clearly corresponds to the post's city (e.g. an "Orlando Weather" channel for an Orlando post).

## Fix (routing-only, no DB writes)

### 1. `supabase/functions/_shared/youtube-adapter.ts`
Inside `getValidToken`, after the strict `city_id` match fails and before throwing `ROUTING_VIOLATION`:

- Look up the city's `name` from `cities` by `cityId`.
- If found, search the user's YouTube `channels` for one whose `account_name` contains the city name (case-insensitive, word-boundary safe).
- If a match is found:
  - `console.log("[routing] city_id lookup failed, falling back to city name match", { cityId, cityName, matched: account.account_name })`
  - Use that account (do NOT mutate DB).
- Only if name fallback also fails:
  - `console.error("[routing] ROUTING_VIOLATION ...")` and throw the existing error (current behavior preserved).

### 2. `supabase/functions/process-scheduled-posts/index.ts` (HARD CITY ISOLATION block, ~L1756)
Mirror the same fallback before the `wrong`-account branch fires:

- After the initial `acct` lookup returns null, fetch `post.city` (already on `post`) and the user's full set of `social_accounts` for `post.platform`.
- If any row's `account_name` contains `post.city` (case-insensitive), accept it as the resolved account:
  - `console.log("[routing] city_id lookup failed, falling back to city name match", ...)`
  - Skip the `wrong`/`BLOCKED` branches and let publishing proceed (the adapter will independently resolve the same way).
- Only when both `city_id` and name-based lookups fail do we keep current `ROUTING_VIOLATION` / `BLOCKED` behavior (log + fail post + notify user).

### 3. Helper (optional, internal only)
Add a tiny shared helper in `supabase/functions/_shared/city-accounts.ts`:

```ts
export function matchAccountByCityName(
  accounts: Array<{ account_name?: string | null }>,
  cityName?: string | null,
) {
  if (!cityName) return null;
  const needle = cityName.trim().toLowerCase();
  if (!needle) return null;
  return accounts.find((a) =>
    (a.account_name || "").toLowerCase().includes(needle)
  ) ?? null;
}
```

Both call sites use this helper to keep behavior consistent.

## Out of Scope
- No DB migrations.
- No automatic backfill of `social_accounts.city_id` (logs make the mismatch visible; user can fix in Settings → Account Routing).
- No changes to TikTok / Instagram / LinkedIn / Twitter adapters (problem reported only on YouTube; same pattern can be applied later if needed).
- No spec doc edits unless you want them — I can add a `RESOLVED_ISSUES` row to `generate-spec/index.ts` if desired.

## Files Touched
- `supabase/functions/_shared/youtube-adapter.ts`
- `supabase/functions/process-scheduled-posts/index.ts`
- `supabase/functions/_shared/city-accounts.ts` (add helper only)

## Status: No changes needed

All three requested changes are already present in the codebase from prior edits:

### 1. Relaxed city match + 60-min window — ✅ already in `job-handlers.ts` (lines 238–250)
```ts
const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
const cityFull = (post?.city ?? "").trim();
const cityShort = cityFull.split(",")[0].trim();
...
if (cityShort) {
  histQuery = histQuery.or(`city.eq.${cityFull},city.ilike.%${cityShort}%`);
}
```

### 2. Don't throw if scheduled_post.status === "posted" — ✅ already in `job-handlers.ts` (lines 266–276)
```ts
if (!successWithId) {
  ...
  if (post?.status !== "posted") { throw new Error(reason); }
  await log("scheduled_post.status=posted — treating as success...");
  verification = "scheduled_post_status";
}
```

### 3. Verbose YouTube upload logging + throw on missing id — ✅ already in `youtube-adapter.ts` (lines 317–328)
```ts
const rawBody = await uploadRes.text();
let result: any = {};
try { result = rawBody ? JSON.parse(rawBody) : {}; } catch { result = { _raw: rawBody }; }
console.log("[YT] upload status:", uploadRes.status, uploadRes.statusText);
console.log("[YT] full response body:", JSON.stringify(result));
if (result?.id) { ... } else { throw new Error("YouTube upload returned no video ID: ...") }
```

The `!uploadRes.ok` branch (lines 294–315) consumes the body via its own `await uploadRes.text()` and `JSON.parse(errText)` — it is reached only when the success branch is not, so there is no double-consume of the stream. The variable is locally scoped (`errText`) and does not conflict with the success-branch `rawBody`.

### Recommendation
No code changes to apply. If you're still seeing silent failures, the next step is to run a slot and inspect:
- Edge function logs for `process-scheduled-posts` and the YouTube adapter (look for `[YT] upload status` / `❌ YouTube API returned`)
- The Job Pipeline drilldown for `output.verification` value and `last_error`

Want me to pull the latest edge logs for a recent run to confirm the new logging is firing?
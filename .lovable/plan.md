## Diagnosis

Two surfaces serve the spec, and they currently disagree:

1. **`/export-spec` page** (`src/pages/ExportSpec.tsx`) → reads the static `MASTER_PROMPT` from `src/lib/masterPromptContent.ts`. **Already updated** to the 16-section v1.4.0 spec in the previous turn.
2. **"Export Spec" button on the Dashboard** (`src/pages/Index.tsx:560`) → calls the live edge function `generate-spec` which still emits the old 9-section layout.

So the user sees stale content via the Dashboard button (and any download triggered there), not via `/export-spec`.

## Goal

Bring `supabase/functions/generate-spec/index.ts` in line with the 16-section v1.4.0 spec, while keeping its only dynamic value-add: the per-user "Recent Changes Log" pulled from `post_history`.

## Scope

- **File touched:** `supabase/functions/generate-spec/index.ts` only.
- **Out of scope:** any pipeline, cron, DB schema, adapter, or frontend logic. `MASTER_PROMPT` and `ExportSpec.tsx` stay as-is.

## Changes to `generate-spec/index.ts`

Rewrite the Markdown assembly so the output matches the v1.4.0 section order from `SkyBrief-Spec-Updated.md`:

1. App Identity *(unchanged content, kept)*
2. Features *(expanded table — adds Job Pipeline Dashboard, Duplicate Post Protection, City-to-Channel Routing Guard, Slot-based Title & Caption Branding)*
3. **Slot System** *(new static section — slot/time/prefix/personality table + slot-storage notes)*
4. **Execution Sources** *(new — Manual / Scheduled / Automated tag table)*
5. **Pipeline Flow** *(new — fenced ASCII pipeline diagram)*
6. Database Schema *(existing tables + adds `jobs` table with the `unique_scheduled_post_job` exclusion constraint note)*
7. Edge Functions *(keep redacted-summary stance; minor wording refresh)*
8. **Idempotency & Duplicate Protection** *(new — 3 layers)*
9. **Caption Generation System** *(new — personality rotation, CTA pool, anti-clone, fail-safe)*
10. **City-to-Channel Routing Guard** *(new — pre-flight check + template isolation)*
11. **Error Handling Strategy** *(new — fail-open table)*
12. API Integrations *(kept)*
13. Known Issues / Limitations *(kept)*
14. **Recently Resolved Issues** *(new — static table)*
15. Deployment *(kept, lightly expanded)*
16. Recent Changes Log *(kept — live `post_history` query, last 10, scoped to caller via `auth.userId`)*

Implementation notes:
- Define the new static blocks as `const` strings at the top of the file alongside the existing `AUTOMATION` / `KNOWN_ISSUES` constants — no nested template-literal gymnastics, to respect the "avoid complex nested template literals" edge-function rule.
- Reuse the existing `md()` and `table()` helpers.
- Keep `APP_VERSION = "1.4.0"`.
- Keep `verifyUser(req)` JWT validation and CORS headers exactly as they are.
- Keep the `Content-Disposition` download header.
- No changes to the function signature, route, or response status codes.

## Verification

- Deploy `generate-spec`.
- Click the Dashboard "Export Spec" button and confirm the downloaded `.md` contains all 16 sections.
- Reload `/export-spec` and confirm the static page still renders the same 16-section v1.4.0 spec (unchanged path).
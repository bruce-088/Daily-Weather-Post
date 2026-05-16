## Goal

Replace the contents of `src/lib/masterPromptContent.ts` (the `MASTER_PROMPT` export) so the `/export-spec` page renders the uploaded **SkyBrief – Application Specification v1.4.0** verbatim.

## Scope

- **File touched:** `src/lib/masterPromptContent.ts` only.
- No edge functions, DB, or UI components change.
- `ExportSpec.tsx` and `masterPromptPdfGenerator.ts` already consume `MASTER_PROMPT`, so the new content flows through automatically.

## Changes

1. Overwrite the `MASTER_PROMPT` template literal with the full Markdown from `SkyBrief-Spec-Updated.md` (all 16 sections, from "App Identity" through "Recent Changes Log").
2. Preserve the file's `export const MASTER_PROMPT = \`...\`;` shape so existing imports keep working.
3. Escape backticks and `${...}` sequences inside the Markdown (none appear in the uploaded spec, but the writer will guard for it).
4. Keep the "Recent Changes Log" table from the upload as static example rows (the live `generate-spec` edge function already injects real rows at runtime — this constant is just the offline fallback shown on `/export-spec`).

## Out of scope

- No change to `generate-spec` edge function.
- No change to PDF generator styling.
- No version bump anywhere else in the app (the spec's "Version 1.4.0" lives only inside this constant).

## Verification

- After write, reload `/export-spec` in preview and confirm the new sections render.
- Confirm the PDF download still works (same generator, same input shape).
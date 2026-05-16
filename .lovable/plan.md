## Standing rule to adopt

For every future change that affects app behavior, features, schema, edge functions, or integrations, I will:

1. **Provide a Spec Delta** in the chat response — a concise diff-style summary describing:
   - What changed (feature/file/function)
   - Why it changed
   - Any schema, contract, or behavior impact
   - New/updated/removed sections in the living spec

2. **Update `supabase/functions/generate-spec/index.ts`** in the same turn so the generated live spec reflects the change (new sections, updated descriptions, added fields, etc.).

This becomes a default workflow step — no need to ask each time.

## Memory update

I'll save this as a project preference in `mem://preferences/spec-delta-workflow` and add a Core one-liner to `mem://index.md` so it applies to every future change automatically.

## Scope

- Applies to: feature additions, edge function changes, schema migrations, integration changes, pipeline/AI logic changes.
- Skipped for: pure cosmetic UI tweaks, copy fixes, and bug fixes with no behavior change (unless they alter a documented spec section).

No code changes required right now — this only registers the rule. Approve to save it to memory.
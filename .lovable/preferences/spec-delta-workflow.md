# Spec Delta Workflow

For every future change that affects app behavior, features, schema, edge functions, integrations, pipeline/AI logic, or documented contracts:

1. Provide a **Spec Delta** in the final chat response, covering:
   - What changed
   - Why it changed
   - Schema, contract, or behavior impact
   - New/updated/removed living spec sections

2. Update `supabase/functions/generate-spec/index.ts` in the same turn so the generated live spec reflects the change.

Skip this only for pure cosmetic UI tweaks, copy fixes, and bug fixes with no behavior/spec impact unless they alter documented behavior.

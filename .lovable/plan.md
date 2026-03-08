

## Plan: Update post_history platform check constraint

The `post_history` table has a CHECK constraint that only allows individual platform values: `instagram`, `tiktok`, `youtube`, `twitter`, `linkedin`, `both`, `none`.

This blocks comma-separated values like `twitter,linkedin` that the multi-select scheduling could produce.

### Changes

**Database migration** (single step):
- Drop the existing `post_history_platform_check` constraint
- No replacement constraint needed — the platform value is controlled by application code, and adding a regex-based constraint would be fragile. The column already defaults to `NULL` and is nullable, so invalid values won't cause issues beyond display.

Alternatively, if you prefer keeping validation, we could switch to a more permissive check that allows any combination. But dropping it is simpler and safer.

### Technical Details
```sql
ALTER TABLE public.post_history DROP CONSTRAINT post_history_platform_check;
```

No code changes needed — the form and edge functions already handle platform values correctly.


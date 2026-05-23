# IFDP Quick Reference Card

## The Investigation-First Development Protocol

A three-phase, evidence-driven approach to fixing production issues.

---

## Quick Overview

| Phase | Duration | Focus | Deliverable |
|-------|----------|-------|-------------|
| **A: Investigation** | 2–4 hours | Root cause analysis with data | Hypothesis + approval |
| **B: Implementation** | 2–8 hours | Surgical fix + observability | Code + tests deployed |
| **C: Verification** | 24–48 hours | Production monitoring | GO/NO-GO decision |

---

## Phase A: Investigation & Diagnosis

**Rule: NO CODE CHANGES**

1. **Flow Mapping** → Trace logic with file paths & line numbers
2. **Evidence Gathering** → Run database queries, analyze logs
3. **Code Review** → Inspect affected modules & configs
4. **Hypothesis Formation** → State root cause + 3-5 fix options

**Stop Condition:**
> Phase [X]A investigation complete. Root cause: [Finding]. Awaiting approval to proceed to Phase [X]B.

---

## Phase B: Implementation

**Focus: Surgical fixes + observability**

1. **Surgical Fixes** → Only approved changes, no scope creep
2. **Observability First** → Add logging BEFORE changing behavior
3. **Testing** → Unit tests + manual validation (100% pass)
4. **Deployment** → Deploy & verify clean logs

**Logging Standard:**
```json
{
  "event_type": "fix_checkpoint",
  "context": { "city": "...", "slot": "...", "provider": "..." },
  "message": "...",
  "error_details": { "http_status": "...", "error_message": "..." }
}
```

**Stop Condition:**
> Phase [X]B implementation complete. Deployed successfully. Ready for Phase [X]C.

---

## Phase C: Production Verification

**Duration: 24–48 hours**

1. **Monitoring** → Observe production without changes
2. **Metric Comparison** → Compare before/after data
3. **Final Audit** → Check for regressions

**Stop Condition:**
> Phase [X]C verification complete. Final verdict: [GO/NO-GO with reasoning].

---

## Key Principles

✓ **Observability Before Action** — Add logging before changing behavior  
✓ **Evidence-Driven** — Base decisions on data, not intuition  
✓ **Independent Revertability** — Each phase rolls back cleanly  
✓ **Minimal Changes** — Surgical fixes only, no improvements  
✓ **Standardized Logging** — Consistent format across all phases  

---

## When to Use IFDP

✓ Production outages  
✓ Recurring issues  
✓ Complex system failures  
✓ High-impact bugs  
✓ Pattern-based issues  

❌ Simple typos  
❌ Obvious one-liner fixes  
❌ Issues with known solutions  
❌ Low-impact bugs (use IFDP lite)  

---

## Real-World Results

| Issue | Phase A Finding | Result |
|-------|-----------------|--------|
| **Branding Bug** | Hardcoded banned fragments in templates | Block rate: 25–30% → <2% |
| **Rendering Variety** | Silent API failure causing fallback | Diversity improved + no regressions |

---

## Phase Checklist

### Phase A
- [ ] Flow diagram created
- [ ] Evidence gathered (queries, logs, metrics)
- [ ] Root cause hypothesis formed
- [ ] 3-5 fix options identified
- [ ] Approval obtained

### Phase B
- [ ] Approved fix implemented
- [ ] Observability logging added
- [ ] Tests passing 100%
- [ ] Deployment clean
- [ ] Rollback plan documented

### Phase C
- [ ] 24–48 hours monitored
- [ ] Before/after metrics compared
- [ ] No regressions detected
- [ ] Final verdict: GO or NO-GO

---

## Commands (for Git Integration)

```bash
# Phase A: Investigation findings
git commit -m "Phase 5A investigation: root cause identified - hardcoded fragments"

# Phase B: Implementation
git commit -m "Phase 5B implementation: rewrite templates + consolidate title-builder"

# Phase C: Verification
git commit -m "Phase 5C verification: GO - block rate 25% → <2%"
```

---

## For AI Assistants

When requesting help:
- *"Help me with Phase 3A investigation for [issue]"*
- *"Let me implement the Phase 3B fix based on my Phase 3A findings"*
- *"Help me verify the Phase 3C metrics for this production fix"*

Reference: See `IFDP_METHODOLOGY.md` for full details  
Lovable/Cursor: See `LOVABLE_INSTRUCTIONS.md`

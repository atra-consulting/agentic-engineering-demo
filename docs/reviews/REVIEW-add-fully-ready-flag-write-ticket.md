# Code Review - add-fully-ready-flag-write-ticket

**Date**: 2026-08-02T20:26:45Z
**Branch**: add-fully-ready-flag-write-ticket
**Base**: main
**Files Reviewed**: 13
**Review Rounds**: 3

## Summary

Adds a `fullyReady` boolean flag to tickets. `write-ticket` sets it at creation time when its own judgment says a ticket is buildable. `do-fully-automatic` gains a third candidate class (`DEFINITION_READY`) that finds and self-promotes such tickets — via a mandatory two-call `status`-then-`owner` sequence — removing the last human click ("An KI übergeben") from the pipeline for well-specified tickets. Includes a guarded DB migration, service/route changes, migration and API test suites, and doc updates.

Round 1 found one CRITICAL bug (a hardcoded `fullyReady: true` literal in `write-ticket` that would have always flagged every ticket, regardless of judgment) plus 3 WARNINGs and several SUGGESTIONs, all fixed. Round 2 found one residual WARNING (a stale wording ripple-effect missed by the round-1 fix), fixed. Round 3 was clean.

## Review Rounds

### Round 1

**Issues found**: 8 | **Fixes applied**: 8

| # | Severity | File | Issue | Found by | Fix | Fixed by |
|---|----------|------|-------|----------|-----|----------|
| 1 | CRITICAL | `.claude/skills/write-ticket/SKILL.md:171` | Payload hardcoded `"fullyReady": true` as a literal — always sent `true` regardless of Schritt 2's verdict, contradicting the prose above it | skill-reviewer (opus) | Replaced with an inline conditional placeholder matching the file's existing style, plus a reworded prose instruction | skill-coder (sonnet) |
| 2 | WARNING | `.claude/skills/write-ticket/SKILL.md:205` | Schritt 3b claimed the ticket "waits for a human" — stale now that `do-fully-automatic` can pick it up automatically | skill-reviewer (opus) | Reworded to state the ticket stays `DEFINITION`+`HUMAN` but is flagged for automatic pickup | skill-coder (sonnet) |
| 3 | WARNING | `backend/src/test/ticketFullyReadyMigration.spec.ts:151-172` | "Every row reads fullyReady=0" assertion had an undocumented, unenforced cross-file ordering dependency | be-test-reviewer (sonnet) | Scoped to `TICKET_SEED_COUNT`, documented the ordering assumption (mirrors `agentTaskSeed.spec.ts` precedent) | be-test-coder (sonnet) |
| 4 | WARNING | `backend/src/test/tickets.spec.ts:2667-2680` | `GET /board` per-column check only verified `typeof === 'boolean'`, never that a `true` value was actually present in non-TODO columns | be-test-reviewer (sonnet) | Added explicit `.toBe(true)` assertion for the `DEFINITION` column, reusing an existing fixture | be-test-coder (sonnet) |
| 5 | SUGGESTION | `backend/src/services/ticketService.ts:596-597` | Doc comment implied `clearFullyReady` required the `handBackToAi` guard's condition; it doesn't | be-reviewer (opus) | Reworded for accuracy | be-coder (haiku) |
| 6 | SUGGESTION | `.claude/skills/do-fully-automatic/SKILL.md` (multiple lines) | Misplaced navigation hint; config note missing `PATCH /:id/owner`; retained-field-list asymmetry between Schritt 1's two branches; three classification-time-vs-current-time overclaims | skill-reviewer (opus) | All addressed in the same dispatch as #1/#2 | skill-coder (sonnet) |
| 7 | SUGGESTION | `.claude/skills/write-ticket/SKILL.md` (multiple lines) | English leaking into German prose; missing comma; stale Schritt 4 follow-up text | skill-reviewer (opus) | All addressed in the same dispatch as #1/#2 | skill-coder (sonnet) |
| 8 | SUGGESTION | `backend/src/config/migrate.ts` | Exporting both new migration functions (unlike the private precedent) widens public surface slightly; duplicated concurrent-cold-start docblock comment | db-reviewer (sonnet) | Not fixed — both explicitly noted as low-confidence (40-50), not actionable; deliberate, tested tradeoff | — |

### Round 2

**Issues found**: 1 | **Fixes applied**: 1

| # | Severity | File | Issue | Found by | Fix | Fixed by |
|---|----------|------|-------|----------|-----|----------|
| 1 | WARNING | `.claude/skills/do-fully-automatic/SKILL.md:201` | A 4th instance of the classification-time-vs-current-time overclaim pattern, missed by round 1's fix (which addressed 3 other instances) | skill-reviewer (sonnet) | Reworded to state the end state and reference the correctly-hedged explanation at line 177 instead of re-claiming certainty | skill-coder (sonnet) |

### Round 3

Clean pass. No issues found.

## Remaining Issues

No remaining issues. (Item 8 from Round 1 — exported migration-function surface area, duplicated docblock comment — is an accepted, deliberate tradeoff, not a defect; no fix planned.)

## Project Context Validation

Implementation matches the approved PRD (`docs/prds/PRD-ADD-FULLY-READY-FLAG.md`) and plan (`docs/plans/PLAN-ADD-FULLY-READY-FLAG.md`) point for point — verified per-domain by each reviewer against REQ-001 through REQ-014. The mandatory `status`-then-`owner` promotion order (REQ-012, the correctness-critical piece) was verified in the actual code blocks, not just prose. Atomicity between `clearFullyReady` and `handBackToAi` (REQ-006) was verified against the real guard-then-batch code structure. Full backend test suite: 354/354 passing throughout.

## Next Steps

- No remaining issues.
- Full test suite green (354/354).
- Create PR when ready.

---
Generated with Claude Code - bpf-review v1.6.0

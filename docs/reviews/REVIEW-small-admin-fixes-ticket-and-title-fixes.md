# Code Review - small-admin-fixes-ticket-and-title-fixes

**Date**: 2026-08-18T20:02:29Z
**Branch**: small-admin-fixes-ticket-and-title-fixes
**Base**: 17af701e0ba0556c659e02094168df476d7348e0
**Files Reviewed**: 8
**Review Rounds**: 3 (max 3)

## Summary

Three small, independent fixes: ticket numbers on Kanban cards, a two-way link between agent-task feedback and the ticket it creates, and a German title fix for agent-task #23 that self-heals already-seeded databases. All three implemented, tested, and reviewed. Round 1 found five real but minor issues (duplicated string literal risking drift, a missing `updatedAt` convention bump, a test-coverage gap across Kanban columns, and two plan-doc accuracy nits). All five fixed and verified. Round 2 found one more minor semantic point (an `updatedAt` timestamp choice diverging from its cited precedent) — fixed with a clarifying comment. Round 3 confirmed the fix and found nothing further. No CRITICAL issues at any point.

## Review Rounds

### Round 1

**Issues found**: 5 | **Fixes applied**: 5

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `backend/src/seed/agentTaskSeed.ts:308,337` | Title `'Chancen verbessern'` duplicated as a raw literal in both the seed row and the standing-overwrite UPDATE — future edits could drift | be-reviewer, db-reviewer (converged) | Hoist a shared module-level constant used in both places | db-coder | Added `AGENT_TASK_23_TITLE` constant, used in both locations | db-coder |
| 2 | WARNING | `backend/src/seed/agentTaskSeed.ts:335-338` | Standing-overwrite UPDATE didn't bump `updatedAt`, unlike the `szenarioSeed.ts` precedent it's modeled on | be-reviewer, db-reviewer (converged) | Add `updatedAt=@updatedAt` to the UPDATE | db-coder | Added `updatedAt: new Date().toISOString()` to the UPDATE | db-coder |
| 3 | WARNING | `frontend/.../ticket-board.component.spec.ts:184-192` | New test only covers the ticket-number prefix in the DEFINITION column; the same markup change was independently duplicated across 5 columns | fe-reviewer | Add one assertion per remaining column | fe-coder | Added 4 tests (TODO, IN_PROGRESS, ON_HOLD, DONE) | fe-coder |
| 4 | WARNING | `docs/plans/PLAN-SMALL-ADMIN-FIXES.md:37` | Plan states `#495057` gives "~5:1" contrast; actual computed contrast is ≈8.2:1 (conclusion still correct, figure was wrong) | ba-reviewer | Correct the cited contrast figures | orchestrator (direct) | Corrected to ≈8.2:1 vs ≈4.7:1 | orchestrator (direct) |
| 5 | SUGGESTION | `docs/plans/PLAN-SMALL-ADMIN-FIXES.md:5` | Business Summary implies the feedback→ticket link didn't exist before; a text-only backlink already existed, only the URL upgrade is new | ba-reviewer | Reword to reflect the actual starting state | orchestrator (direct) | Reworded to describe the upgrade accurately | orchestrator (direct) |

### Round 2

**Issues found**: 1 | **Fixes applied**: 1

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 6 | WARNING | `backend/src/seed/agentTaskSeed.ts:341` | Fix cited `szenarioSeed.ts` as precedent, but that precedent uses a *fixed* timestamp, not "now" — a real semantic divergence, though "now" is arguably more correct for a live self-healing correction | be-reviewer | Document the intentional divergence, or switch to a fixed timestamp | orchestrator (direct) | Added a comment explaining why "now" is used on purpose, unlike the fixed-timestamp precedent | orchestrator (direct) |

(fe-reviewer's round 2 pass on the test-coverage fix found no issues — all 5 columns correctly verified against `makeMockBoard()`'s seed data.)

### Round 3

Clean pass. No CRITICAL or WARNING issues found. One sub-threshold wording suggestion was noted by the reviewer but explicitly called out as not worth a follow-up commit (documentation-only, non-functional).

## Remaining Issues

No remaining issues.

## Project Context Validation

No PRD exists for this task — it was assessed as small (three independent, well-scoped fixes with no architectural impact) and the PRD step was skipped per the plan-and-do workflow. CLAUDE.md/AGENTS.md conventions were checked and followed throughout: async `@libsql/client` calls with parameterized queries, ISO-8601 timestamps via `new Date().toISOString()`, Angular 21 standalone components with `@for`/`@if` control flow, and the project's short/direct writing style in the skill and plan docs.

## Next Steps

- Run tests: `cd backend && npx playwright test` and `cd frontend && npm run test:ci` (both green as of this review)
- Create PR when ready

---
Generated with Claude Code - review v1.8.2

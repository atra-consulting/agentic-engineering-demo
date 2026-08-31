# Code Review - ticket-ui-link-fixes

**Date**: 2026-08-30T21:14:56Z
**Branch**: ticket-ui-link-fixes
**Base**: 47a751fddda1f298e57d921bd4152a78c34e0406
**Files Reviewed**: 28 (changed vs base) + 2 fix-round files
**Review Rounds**: 3 (max 3)

## Summary

This branch implements three fixes: (1) shows the ticket number on the Kanban board card, (2) links app feedback (`agent_task`) and the ticket it spawns via a new `ticket.agentTaskId` column and a derived `agentTask.ticketId` field, with a guarded migration, backend API support, frontend cross-links, and a `write-ticket` skill update, and (3) corrects agent-task #23's title to German with an idempotent corrective UPDATE for already-seeded databases.

Six domain reviewers (be-reviewer, be-test-reviewer, db-reviewer, fe-reviewer, fe-test-reviewer, ba-reviewer) ran an independent Round 1 review against the full diff. The single highest-risk item — the DB migration's index-creation ordering, where a mistake would crash the backend on startup for every existing database — was independently re-verified as correct by two reviewers who read the actual line sequence in `runMigrations()` themselves. Backend (385 tests) and frontend (535 tests) suites were confirmed green multiple times, including by reviewers running them independently.

Round 1 found two real WARNING-level issues (a stale doc claim, a `routerLink` convention inconsistency). Round 2 found the doc fix was incomplete (fixed the count but left the prose internally inconsistent). Round 3 confirmed everything clean. No CRITICAL issues were found in any round.

## Review Rounds

### Round 1

**Issues found**: 2 | **Fixes applied**: 2

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `docs/specs/SPECS-database.md:28` | "Migration approach" paragraph claimed "only two ALTER-on-an-existing-table migrations" while a third (`ensureTicketAgentTaskIdColumn()`) exists and is documented a few lines later in the same file | ba-reviewer | Update the count and name the third function | db-coder | Changed "two"→"three", added `ensureTicketAgentTaskIdColumn()` to the named list | db-coder |
| 2 | WARNING | `frontend/src/app/features/admin/tickets/ticket-detail.component.ts:256`, `frontend/src/app/features/admin/agent-tasks/agent-task-detail.component.ts:45` | New cross-link anchors used string-interpolation `routerLink="..."` instead of this codebase's established array-binding convention for dynamic-id links (e.g. `agent-task-list.component.ts:43`) | fe-reviewer | Convert both to `[routerLink]="[...]"` array-binding form | fe-coder | Converted both anchors to array-binding syntax; build and both spec files still pass | fe-coder |

Other reviewers this round (be-reviewer, be-test-reviewer, db-reviewer, fe-test-reviewer) reported no issues — see notes below.

### Round 2

**Issues found**: 1 | **Fixes applied**: 1

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `docs/specs/SPECS-database.md:28` | Round 1's fix changed the count to "three" but the prose still only described two of the three functions, and "Both are safe to run on every startup" was left orphaned (only covering two of the three announced exceptions) | ba-reviewer | Add a description of the third function (including its unconditional index re-creation behavior) and change "Both" to "All three" | db-coder | Added the missing description and corrected "Both"→"All three" | db-coder |

fe-reviewer re-reviewed the `routerLink` fix this round: clean, no issues (route pattern matches, `@if` guard unaffected, both spec files pass).

### Round 3

Clean pass. No issues found.

ba-reviewer re-verified the completed `SPECS-database.md` paragraph is internally consistent, accurate against `backend/src/config/migrate.ts`, and grammatically sound.

## Remaining Issues

No remaining issues.

## Project Context Validation

**PRD** (`docs/prds/PRD-TICKET-UI-LINK-FIXES.md`): all requirements (REQ-101 through REQ-303) verified implemented. Success Criteria checklist fully ticked with evidence, including live manual verification (browser-based ticket-board check, 600px responsive check, keyboard nav, and an end-to-end `write-ticket` skill run in both queue and free-text modes that produced a real cross-linked ticket, verified visually in both directions).

**CLAUDE.md / AGENTS.md**: conventions followed — async `@libsql/client` calls, `asyncHandler` wrapping, `{ status, message, timestamp, fieldErrors }` error shape, Angular 21 standalone components with `@if`/`@for` and `inject()`, no `*ngIf`. Commit messages carry the `PRD:` footer per the project's commit convention.

## Next Steps

- No remaining issues to address.
- Full backend Playwright suite (385 tests) and full frontend Karma suite (535 tests) confirmed green.
- Create PR when ready.

---
Generated with Claude Code - review v1.8.2

# Code Review - calculator-selectable-steps-rechner-ui

**Date**: 2026-09-18
**Branch**: calculator-selectable-steps-rechner-ui
**Base**: 854b506cd6620b7b08cbf2c2eabe8c486f8a33e5
**Files Reviewed**: 19 (11 source/test files, 5 spec docs, PRD, plan, state)
**Review Rounds**: 3 (max 3)

## Summary

Task CALCULATOR-SELECTABLE-STEPS: the productivity calculator at `/produktivitaet/rechner` gained addable/removable steps (floor 1, cap 50, replacing the previous fixed 19/19/11/2), per-step editable names, a per-step role picker (BA/Dev/Tester) on the two agile processes, and a persistent disclosure banner. Backend validation moved from fixed step counts to structural rules (works 1–50, waits = works−1, optional names array).

This review ran after the full implementation, test-authoring, and prior phase reviews were already complete and green (413/413 backend tests, 602/602 frontend tests). Round 1 took a fresh, holistic look at the whole accumulated branch diff (not per-commit) across backend, frontend, UI/accessibility, and documentation, plus live browser testing. It found no CRITICAL issues but 8 real WARNING/SUGGESTION-level issues — 4 real accessibility bugs (a grammar regression at the step-count floor, a focus-ring contrast failure under WCAG 1.4.11, truncated step names with no way to read them, a role-picker control under the 44px touch-target minimum), 1 minor code-duplication suggestion, and 2 documentation gaps (undocumented live-region and focus-management patterns). Round 2 validated all Round 1 fixes (all correct, no regressions) and found 3 new WARNING-level issues in the just-written documentation itself (a false "only use of aria-live" claim, a focus-priority description that didn't match the actual code order, a stale reference to an approach the Round 1 fix had just removed). Round 3 validated the Round 2 fixes and found nothing further — clean.

## Review Rounds

### Round 1

**Issues found**: 8 | **Fixes applied**: 8

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `frontend/.../rechner.component.html:40,345` | Grammar regression: "1 Schritten"/"1 Schritte" at the bar `<desc>` and flow-diagram `aria-label` (the live-region announcement was already fixed for this in an earlier phase, these two sites were missed) | ui-reviewer | Extract a shared `schritteWort(count)` singular/plural helper, use it at both sites | ui-designer | Added `schritteWort()`, used at both template sites and in `announce()` | ui-designer |
| 2 | WARNING | `frontend/.../rechner.component.ts` (styles) | Focus ring on blocked Add/Remove buttons fails WCAG 1.4.11 (3:1) — `opacity: 0.5` dims the whole element including its own `:focus-visible` outline to ~2.5:1 | ui-reviewer | Stop using `opacity`; mute via dedicated `color`/`border-color` rules per button variant instead | ui-designer | Replaced `opacity` with `.btn-outline-primary[aria-disabled='true']` / `.btn-outline-danger[aria-disabled='true']` muted-color rules; outline renders at full strength | ui-designer |
| 3 | WARNING | `frontend/.../rechner.component.html` | Step name input truncates real step names (row now shares space with 5 other controls) with no way to read the full text | ui-reviewer | Add `[title]="getStepName(...)"` for a native hover tooltip | ui-designer | Added `[title]` binding | ui-designer |
| 4 | WARNING | `frontend/.../rechner.component.html`/styles | Role-picker `<select>` renders at 38px, missing the 44px touch-target minimum the row's other new controls explicitly set | ui-reviewer | Add `min-height: 44px` scoped to the role-picker's own class | ui-designer | New `.step-role-select` class, `min-height: 44px` | ui-designer |
| 5 | SUGGESTION | `frontend/.../rechner.component.html` | Role-picker select width varies with selected option text (`w-auto`), misaligning the row | ui-reviewer | Fixed width instead of `w-auto` | ui-designer | `.step-role-select` also sets `width: 150px` | ui-designer |
| 6 | SUGGESTION | `frontend/.../rechner.component.ts:1067,1105` | `addStep()`/`removeStep()` duplicate the `showsRollen()` check inline instead of calling it | fe-reviewer | Call `this.showsRollen(prozessKey)` in both places | fe-coder | Replaced both inline checks with `showsRollen()` calls | fe-coder |
| 7 | WARNING | `docs/specs/SPECS-frontend.md`, `SPECS-ui.md` | Live-region announcement pattern (first `aria-live` use in the codebase, required by REQ-104) undocumented anywhere | ba-reviewer | Add a short note to `SPECS-frontend.md`; mirror the `aria-disabled` section's format in `SPECS-ui.md` | ba-writer | Added both | ba-writer (orchestrator committed) |
| 8 | WARNING | `docs/specs/SPECS-frontend.md` | Post-add/remove focus-management behavior (REQ-101/102) undocumented anywhere | ba-reviewer | Add a short note alongside the live-region note | ba-writer | Added | ba-writer (orchestrator committed) |

### Round 2

**Issues found**: 3 | **Fixes applied**: 3

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `SPECS-frontend.md`, `SPECS-ui.md` | The Round 1 doc fix claimed the Rechner live region is "the only use of `aria-live` in this codebase" — false; `dashboard.component.ts` already has one (a pre-existing loading indicator) | ba-reviewer | Narrow the claim to something true and checkable | ba-writer | Reworded to "the first purpose-built `aria-live` region for announcing a user action's result" | ba-writer (orchestrator committed) |
| 2 | WARNING | `SPECS-frontend.md` | The Round 1 doc fix's focus-priority sentence listed position → last-step → floor, but the real code checks floor first (it can override "was last" when both conditions overlap, e.g. removing the 2nd of exactly 2 remaining steps) | ba-reviewer | Reorder the sentence to match the code's actual check order | ba-writer | Reworded to state floor-first priority explicitly | ba-writer (orchestrator committed) |
| 3 | WARNING | `SPECS-ui.md` | Pre-existing `aria-disabled` section still said "muted color or reduced opacity" — stale, since the Round 1 fix (#2 above) specifically removed the opacity approach for WCAG 1.4.11 reasons | ba-reviewer | Remove "or reduced opacity", explain why | ba-writer | Reworded with the WCAG rationale inline | ba-writer (orchestrator committed) |

### Round 3

Clean pass. No issues found.

## Remaining Issues

No remaining issues.

One item was explicitly flagged during fixing as genuinely pre-existing and out of this branch's scope, not acted on: `.btn-outline-primary`/`.btn-outline-danger` render with stock Bootstrap colors (`#0d6efd`/`#dc3545`) instead of this project's `$primary`/`$danger` design tokens, sitewide, predating this branch. Worth a separate follow-up ticket if the team wants it fixed.

## Project Context Validation

Cross-checked against `docs/prds/PRD-CALCULATOR-SELECTABLE-STEPS.md` (all REQ-101 through REQ-108, REQ-201, REQ-301/302/303) and `docs/plans/PLAN-CALCULATOR-SELECTABLE-STEPS.md`. Every requirement traced to working, tested code. Backend: no DDL change (confirmed empty diff on `migrate.ts`/`szenarioSeed.ts`), structural Zod validation with correct cross-field error paths, `agileKiSteps` given identical treatment to the other three processes throughout. Frontend: shared constants (`PROZESS_STEP_LABELS`, `PROZESS_ROLLEN`) never mutated, role-state array kept in lockstep with the works array across add/remove/load, the REQ-102 wait-removal rule verified against the PRD's own worked example, Angular 21 conventions (`inject()`, `@if`/`@for` with `track`, standalone components) used throughout, no `innerHTML`/`bypassSecurityTrust` anywhere step names are rendered.

## Next Steps

- No remaining issues to review.
- Full test suites already confirmed green (413/413 backend, 602/602 frontend, build clean) as of Wave 7's verification.
- Create PR when ready.

---
Generated with Claude Code - review v1.8.2

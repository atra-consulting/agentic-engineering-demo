# Code Review - add-settings-planner-tiers

**Date**: 2026-08-15T00:00:00Z
**Branch**: add-settings-planner-tiers
**Base**: c20c7517149af790fb15e6a99732d1518a9447a0
**Files Reviewed**: 10 (5 skill/agent files, `CLAUDE.md`, `claude.atra.example.json`, PRD, plan, state)
**Review Rounds**: 3 (max 3)

## Summary

Upgrades `.claude/skills/plan-and-do/` with two features from an external package: a `claude.atra.json` settings file (keep/delete preferences, Markdown auto-open) and model-tier delegation (a `planner` agent, explicit haiku/sonnet/opus on every subagent dispatch, verification, escalation). SKILL.md started at 1003 lines against the package's own 850-line hard gate, so `TICKET MODE`, `STEP 12`, and the `AGENT DISCOVERY` family moved into two new reference files to make room. Final: SKILL.md 838 lines. Three review rounds found 15 issues total (0 CRITICAL, several WARNING, several SUGGESTION) — all 15 fixed. No CRM application files touched.

## Review Rounds

### Round 1

**Issues found**: 11 | **Fixes applied**: 11

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `docs/prds/PRD-ADD-SETTINGS-PLANNER-TIERS.md` | Line-count target mismatch: PRD said "~800", plan/actual result used "≤840" | ba-reviewer | Update PRD NFR to "≤840 (revised from initial ~800 estimate...)" | ba-writer | Updated | ba-writer |
| 2 | WARNING | `docs/prds/PRD-ADD-SETTINGS-PLANNER-TIERS.md` | Missing `## Implementierung` section per AGENTS.md convention | ba-reviewer | Add section listing implementing commits | ba-writer | Added | ba-writer |
| 3 | SUGGESTION | `docs/plans/PLAN-ADD-SETTINGS-PLANNER-TIERS.md` | Task 21 miscounts Feature 1 checklist as 14 lines (actual 15) | ba-reviewer | Fix count to 15 | ba-writer | Fixed | ba-writer |
| 4 | WARNING | `plan-and-do-setup.md:43` | `"auto_open_md": [auto_open_md]` unquoted placeholder looks like invalid JSON | skill-reviewer | Add clarifying note it's a literal boolean | skill-coder | Added note | skill-coder |
| 5 | WARNING | `plan-and-do-delegation.md:103` | Generic `test-runner-*` placeholder not localized | skill-reviewer | Rename to `be-test-runner`/`fe-test-runner` | skill-coder | Renamed | skill-coder |
| 6 | WARNING | `SKILL.md` Step 13.1 | Bare-prose instruction sentence sits inside display-text fence | skill-reviewer | Move above the fence | skill-coder | Moved | skill-coder |
| 7 | SUGGESTION | `SKILL.md` Step 11.1 | No note explaining the intentional ladder exemption | skill-reviewer | Add clarifying parenthetical | skill-coder | Added | skill-coder |
| 8 | SUGGESTION | `plan-and-do-delegation.md` § 14 | Stale call-site list "Steps 6.2, 8.1, 11.1" (11.1 wrong, 7.3 missing) | skill-reviewer | Fix to "Steps 6.2, 7.3, 8.1" | skill-coder | Fixed | skill-coder |
| 9 | SUGGESTION | `plan-and-do-delegation.md` § 9 | No mention the repo already has an adapted planner | skill-reviewer | Add one-line note | skill-coder | Added | skill-coder |
| 10 | SUGGESTION | `SKILL.md:776` | Cross-reference quotes short heading, not full heading text | skill-reviewer | Quote full heading | skill-coder | Fixed | skill-coder |
| 11 | SUGGESTION | `plan-and-do-modes.md:35` | HELP MODE still says `REVIEW-[task_key].md`, contradicts new load-bearing R4 behavior | skill-reviewer | Fix to `REVIEW-[branch_name].md` | skill-coder | Fixed | skill-coder |

### Round 2

**Issues found**: 3 | **Fixes applied**: 3

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `.claude/agents/planner.md:108` | Stray `</content>` tag leaked into the live agent file | skill-reviewer | Delete the line | direct fix | Removed | direct fix |
| 2 | SUGGESTION | `plan-and-do-delegation.md` § 10 item 3 | Step 7.3 review doesn't cite REVIEWER SCOPE FILTER, unlike Step 6.2/8.1 | skill-reviewer | Add explicit citation | direct fix | Added | direct fix |
| 3 | SUGGESTION | `SKILL.md:751` | R9 citation slightly imprecise about what the PRD actually says | skill-reviewer | Reword to separate PRD fact from inference | direct fix | Reworded | direct fix |

### Round 3

**Issues found**: 1 | **Fixes applied**: 1

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `plan-and-do-setup.md:225-259` | `## CLEANUP RESOLUTION (Step 13.0 and Step 13.2)` heading covers both steps but only has a Step 13.0 subheading; the Step 13.2 paragraph sits unlabeled and contradicts SKILL.md's own (now fully self-contained) Step 13.2 | skill-reviewer | Remove the redundant/stale Step 13.2 paragraph, retitle heading to "(Step 13.0)", update the one inbound pointer | direct fix | Removed, retitled, pointer updated | direct fix |

`docs/plans/`, `docs/prds/`, `docs/state/` files: Round 2 and Round 3 both Clean for these three files (no issues after Round 1's fixes).

## Remaining Issues

No remaining issues.

## Project Context Validation

- PRD (`docs/prds/PRD-ADD-SETTINGS-PLANNER-TIERS.md`) and plan (`docs/plans/PLAN-ADD-SETTINGS-PLANNER-TIERS.md`) both read and used as ground truth throughout all three rounds.
- CLAUDE.md conventions checked: commit-scoping rule (no `git add -A`/`.`/`-a` — verified zero real violations), the `PRD:` commit-footer convention (all 4 implementation commits carry it), writing style (short sentences, sentence fragments, no passive voice — spot-checked, compliant), and the `## Agents` 3-column table format (planner registered correctly).
- All 72 acceptance-checklist items (39 PRD Success Criteria + 33 PROMPT.md checklist lines, renamed) were independently walked and passed before this review skill even ran (Task 21 of the plan) — this review's 3 rounds found additional issues beyond that walk, all now fixed.
- Zero CRM application files (`backend/`, `frontend/`, `api/`, `docs/specs/`) touched — confirmed via `git diff --stat`.
- Pre-existing repo-root `claude.bpf.json` (belongs to a separately-installed plugin skill) confirmed untouched throughout.

## Next Steps

- Commit the round 1-3 review fixes (currently uncommitted working-tree changes across 8 files).
- Ensure all tests pass — N/A, no automated test suite for skill Markdown; verification was the PRD's Test Strategy (static checks, command dry-reads, scenario walk-throughs), all passed per Task 20/21 of the plan.
- Documentation already updated as part of this change (the change *is* documentation/skill content).
- Create PR when ready.

---
Generated with Claude Code - review v1.8.2

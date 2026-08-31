# Code Review - review-add-data-subagents

**Date**: 2026-08-26
**Branch**: review-add-data-subagents (temp branch created at HEAD of `main`, commit `07ae30d`, for review purposes only)
**Base**: `17af701` (parent of `07ae30d` — base override; `main`/`master` detection was skipped because the reviewed commit was already merged to `main`)
**Files Reviewed**: 4 original + 1 touched by fixes (`SKILL.md`) = 5 total
**Review Rounds**: 3 (max 3)

## Summary

Reviewed commit `07ae30d` ("Add data-reader and data-writer subagents"), which adds two new Claude Code subagents — `data-reader` (read-only fact-finding) and `data-writer` (write-only, save-verbatim) — and wires them into `CLAUDE.md`'s Agents table and `plan-and-do`'s agent discovery.

The commit was already committed directly to `main` with a clean working tree, so this review ran on a temporary local branch (`review-add-data-subagents`, created at `main`'s HEAD) compared against the commit's parent (`17af701`) via a base override. No changes were pushed or merged; see "Next Steps" for what to do with the temp branch.

Agent discovery deviated from the skill's literal fallback: since no `be-*`/`db-*`/`fe-*`/`ui-*`/`ba-*` pattern matched files under `.claude/`, and `skill-reviewer`/`skill-coder` are excluded from the CRM-domain reviewer/coder pools by design (they're general tooling agents per `AGENTS.md`), the literal rule would have fallen back to all 8 CRM-domain reviewers reviewing markdown agent-definition files — not useful. `skill-reviewer`/`skill-coder` were used instead, since reviewing/fixing Claude Code agent and skill definitions is exactly their stated purpose.

Round 1 found 11 issues (0 critical, 5 warnings, 6 suggestions) — an incomplete write-agent-fallback guard (only one of two symmetric call sites was guarded), a factually wrong claim about the `write-ticket` skill's behavior, an unused frontmatter field, a stray leftover line, and several smaller taxonomy/wording inconsistencies. 9 of 11 were approved and fixed (2 needed one revision round from plan review before being applied); 1 was judged fine as-is (no change needed); 1 was scoped as a future integration follow-up (documented, not fixed).

Round 2 (fix-correctness focus) found 2 minor cosmetic suggestions in the round 1 fixes themselves — both approved and fixed immediately, without a separate plan-review pass, given their triviality and reviewer-originated wording.

Round 3 (fix-correctness focus) found nothing — clean.

## Review Rounds

### Round 1

**Issues found**: 11 | **Fixes applied**: 9

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | WARNING | `.claude/skills/plan-and-do/SKILL.md:463` | PRD-drafting `writer_agent` fallback had no read-capability guard against `data-writer`, unlike the plan-drafting fallback | skill-reviewer | Mirror the existing guard from `plan-and-do-delegation.md:356`, semicolon-separated to avoid a run-on | skill-coder | Guard clause added, list converted to semicolon separators per plan-review feedback | skill-coder |
| 2 | WARNING | `.claude/skills/plan-and-do/plan-and-do-delegation.md:440` | Rule 8's parenthetical documented `data-reader` skipping as utility but said nothing about `data-writer`'s asymmetric classification (intercepted by rule 4, not rule 8) | skill-reviewer | Append a clarifying note explaining the asymmetry | skill-coder | Note added | skill-coder |
| 3 | WARNING | `.claude/agents/data-writer.md:45` | Claimed the writer-fallback risk applies to "a ticket body" in `write-ticket`, but that skill quotes source content verbatim and never dispatches a writer agent | skill-reviewer | Remove the inaccurate "or a ticket body" clause | skill-coder | Clause removed | skill-coder |
| 4 | WARNING | `.claude/agents/data-reader.md:7`, `.claude/agents/data-writer.md:6` | `disallowedTools` frontmatter field unused anywhere else in the repo's 25 other agent files, redundant with the explicit `tools:` allowlist | skill-reviewer | Delete the field from both files | skill-coder | Deleted from both | skill-coder |
| 5 | WARNING | `.claude/agents/data-reader.md:10` | Stray `Updated: 2026-08-25 21:45 Europe/Berlin` body line, absent from its sibling file and all other agent files | skill-reviewer | Delete the line | skill-coder | Deleted | skill-coder |
| 6 | SUGGESTION | `CLAUDE.md:38` | `data-reader`'s Type `research` is a new, unannounced taxonomy value | skill-reviewer | Keep as-is — no existing value (`planning`/`ops`/`review`/`writing`/`coding`/`test-*`) accurately describes non-judgmental fact-finding | skill-coder | No change (intentional) | — |
| 7 | SUGGESTION | `CLAUDE.md:39` | `data-writer`'s Type `writing` was identical to `ba-writer`'s despite being functionally opposite (persists verbatim vs. drafts from investigation) | skill-reviewer | Change Type to `persistence` | skill-coder | Changed `writing` → `persistence` | skill-coder |
| 8 | SUGGESTION | `.claude/agents/data-reader.md:5` | `memory: project` set with no stated rationale; the field's only other user (`requirements-reviewer`) has ~100 lines of memory-usage guidance this file lacks | skill-reviewer | Remove `memory: project` | skill-coder | Removed | skill-coder |
| 9 | SUGGESTION | `.claude/agents/data-writer.md:45` | Referenced `/bpf-review` (slash form); repo convention is `bpf:review` (colon form) | skill-reviewer | Fix slash → colon form | skill-coder | Fixed | skill-coder |
| 10 | SUGGESTION | `.claude/agents/data-reader.md:3` | No disambiguation from the built-in general-purpose/Explore subagent in the description, unlike `admin.md`'s pattern | skill-reviewer | Insert a "prefer this over Explore for scoped lookups" clause in the lead paragraph, before the `<example>` blocks | skill-coder | Clause inserted at the correct point per plan-review feedback | skill-coder |
| 11 | SUGGESTION | `.claude/skills/plan-and-do/plan-and-do-delegation.md` | No workflow step actually delegates read-only research to `data-reader`; reachable only via ad-hoc direct dispatch | skill-reviewer | Documented as a future follow-up (needs a design decision on a `discovery` agent bucket) — not fixed this round | — | Not applied (deferred) | — |

Plan review (Step 5.3) flagged fixes #1 and #10 as NEEDS-REVISION on first pass (list punctuation ambiguity; wrong insertion point for the description clause). Both were revised in one iteration and re-approved before being applied.

### Round 2

**Issues found**: 2 | **Fixes applied**: 2

| # | Severity | File | Issue | Found by | Proposed Fix | Fix by | Applied | Applied by |
|---|----------|------|-------|----------|--------------|--------|---------|------------|
| 1 | SUGGESTION | `.claude/agents/data-writer.md:44` | "Registering this role" mentioned only the PRD-drafting fallback risk, but round 1's guards cover both PRD and plan drafting | skill-reviewer | Change "a PRD" to "a PRD or plan" | skill-coder | Fixed | skill-coder |
| 2 | SUGGESTION | `.claude/skills/plan-and-do/plan-and-do-delegation.md:440` | Round 1's added note was one dense 3-clause sentence, mildly at odds with the project's "short sentences" writing convention | skill-reviewer | Split into 3 short sentences, same meaning | skill-coder | Fixed | skill-coder |

### Round 3

Clean pass. No issues found. Both round 2 fixes verified landed exactly as specified, no regressions, all cross-references (`## 10`, `SKILL.md Step 6.2`, `bpf:review`) confirmed to resolve correctly.

## Remaining Issues

- `.claude/skills/plan-and-do/plan-and-do-delegation.md` — no workflow step proactively delegates read-only research to `data-reader` (finding #11, round 1). Deferred: needs a design decision (e.g. a `discovery` agent bucket, parallel to `planner_agents`/`writer_agents`) before it's a mechanical fix. Candidate insertion points: Step 6.1 "Analyze Requirements" and its plan-side twin Step 7.2, both in `SKILL.md`.

## Project Context Validation

No PRD found under `docs/prds/` for this change. Context inferred from `AGENTS.md`/`CLAUDE.md` conventions (agent frontmatter format, tooling-agent classification, `bpf:`-prefix convention for referencing global/plugin skill counterparts) and the commit message. All applied fixes were checked against these conventions during plan review and round 2/3 verification.

## Next Steps

- Decide what to do with the temp branch `review-add-data-subagents`: it now holds 11 uncommitted fixes on top of `main`'s HEAD (`07ae30d`). Since `main` and this branch point at the same base commit, options are: commit the fixes here and fast-forward `main`, or cherry-pick/reapply the fixes directly on `main`. Nothing has been merged or pushed yet.
- Address the deferred `data-reader` delegation-integration suggestion (see "Remaining Issues") as a separate follow-up if desired.
- Run tests / `ng build` check if any behavior-affecting code were touched — not applicable here (docs/agent-definition-only change).
- Delete `docs/state/STATE-REVIEW-review-add-data-subagents.json` (review-skill scratch state) before committing, if not already cleaned up.

---
Generated with Claude Code - review v1.8.2

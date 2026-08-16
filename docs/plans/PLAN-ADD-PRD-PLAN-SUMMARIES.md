# Implementation Plan: ADD-PRD-PLAN-SUMMARIES

## Summary

### Business Summary
This change updates the templates our AI coding assistant follows when it writes planning documents. From now on, every specification and every implementation plan opens with two short summaries: one in plain business language, one in technical language. This makes it faster for non-technical stakeholders to understand what a change does, without reading technical detail. No part of the running application changes — only the templates the assistant follows when it writes documents.

### Technical Summary
Edit three files under `.claude/`: `skills/plan-and-do/SKILL.md`, `skills/plan-and-do/plan-and-do-delegation.md`, and `agents/planner.md`. `SKILL.md` gets a `## Writing Style` scope line (governs PRD, plan, and — via the review skill — the code review) and a rebuilt PRD structure block in Step 6.2 (`## Summary` > `### Business Summary` / `### Technical Summary`, existing PRD sections, optional trailing `## Technical Notes`, plus an audience rule). `plan-and-do-delegation.md` gets its `## 11. PLAN STRUCTURE (Step 7.3)` template reordered and nested: `### Business Summary` before `### Technical Summary`, both under one `## Summary` heading, with an audience-rule line. `planner.md` gets its one-line summary rule (line 16) rewritten to match the same order and audience rule, since the planner agent is the one that drafts these documents. `.claude/skills/review/SKILL.md` is verified, not edited — its `## Writing Style` block already matches. Docs-only change, no application code touched.

## Test Command

`N/A — docs-only change, testing skipped per user choice`

## Tasks

**Note:** this is a docs-only change to `.claude/**` template and agent-spec files. No test-authoring/implementation phase applies — skip that phase of the workflow for this task.

### 1. Update plan-and-do skill templates and the planner agent spec
**Agent:** skill-coder
**Model:** sonnet — well-specified, multi-file but mechanical text edits with exact target content given

- [ ] In `.claude/skills/plan-and-do/SKILL.md`, `## Writing Style` section (around lines 88-90, currently "Short and brief. Short sentences. Simple words non-native speakers understand. No passive voice. Use sentence fragments."): append this exact line, on its own paragraph, right after the existing one:
  ```
  This applies to every document this skill produces: the specifications (PRD), the plan, and — via the review skill — the code review.
  ```
- [ ] In `.claude/skills/plan-and-do/SKILL.md`, Step 6.2 "Generate Specifications (PRD)" (around line 470), replace the current `Structure:` line (and the "Keep brief..." line right after it) with this exact block:
  ```markdown
  Structure:

  ```markdown
  ## Summary
  ### Business Summary
  [2-4 sentences. Business audience. What this change does and why it matters. No jargon, no file paths, no code.]

  ### Technical Summary
  [2-4 sentences. Technical audience. The shape of the change at a high level.]

  ## Source
  ## Problem Statement
  ## Requirements
  ## Special Instructions
  ## Implementation Approach (high-level, no code)
  ## Test Strategy
  ## Non-Functional Requirements
  ## Success Criteria
  ## Technical Notes (optional)
  [Only if needed. Technical audience. Deeper technical detail than the Technical Summary. Skip this section when the Technical Summary already covers it.]
  ```

  Audience rule: everything above must read clearly to a business person, except Technical Summary and Technical Notes — those two are for technical readers only.

  Keep brief. No code samples anywhere in the PRD — not even in Technical Notes. Details go in the Step 7 plan.
  ```
  (The outer ` ```markdown ... ``` ` fence in this task item is only to show you the block to paste — do not add an extra fence layer in the actual SKILL.md file. Write only the inner content: the `Structure:` label, the fenced markdown template, the "Audience rule:" line, and the "Keep brief..." line, exactly as shown between them.)
- [ ] In `.claude/skills/plan-and-do/plan-and-do-delegation.md`, `## 11. PLAN STRUCTURE (Step 7.3)` (around lines 375-411): replace the existing fenced template's opening (from `# Implementation Plan: [task_key]` through `## Test Command`) with this exact text:
  ```markdown
  # Implementation Plan: [task_key]

  ## Summary
  ### Business Summary
  [2-4 sentences, business audience: what this plan accomplishes and why it matters. No jargon, no file paths, no code.]

  ### Technical Summary
  [2-5 sentences, technical audience: what gets built or changed, the shape of the approach, the main risk or constraint.]

  ## Test Command
  `[test_command]`
  ```
  Leave everything from `## Tasks` onward in that fenced template unchanged. Directly below the fenced template (where the existing prose notes already sit, e.g. "The `**Agent:**` and `**Model:**` lines are the whole point..."), add this exact line as its own paragraph:
  ```
  Audience rule: apart from the Business Summary, nothing else in the plan needs to make sense to a business person.
  ```
- [ ] In `.claude/agents/planner.md`, line 16 (currently: "Every document opens with a `## Summary`. PRD — 2–4 sentences, business audience. Plan — 2–5 sentences, technical audience, followed by a `## Business Summary` section — 2–4 sentences, business audience."): replace the whole line with this exact text:
  ```
  Every document opens with `## Summary`, containing `### Business Summary` first (2–4 sentences, business audience — no jargon, no file paths, no code), then `### Technical Summary` second (2–5 sentences, technical audience). PRD — everything else stays business-readable, except an optional trailing `## Technical Notes` section for technical readers only. Plan — everything else is technical-only; only the Business Summary needs to make sense to a business person.
  ```
- [ ] Do not touch `.claude/skills/review/SKILL.md`.
- [ ] Do not touch any file outside the three named above.
- [ ] Commit only the three changed files, per the repo's Commit Scoping Rule (`git add [exact paths]`, never `git add -A`/`git add .`/`git commit -a`).

**Acceptance criteria:**
- `SKILL.md` `## Writing Style` explicitly names PRD, plan, and review as the documents it governs.
- `SKILL.md` Step 6.2 shows the full PRD structure block with `## Summary` > `### Business Summary` / `### Technical Summary` first, the eight existing sections next, `## Technical Notes` last and marked optional, plus the audience rule and the no-code-samples rule.
- `plan-and-do-delegation.md` `## 11. PLAN STRUCTURE (Step 7.3)` shows one `## Summary` heading containing `### Business Summary` before `### Technical Summary`, plus the plan audience-rule line.
- `planner.md` line 16 (or its replacement lines) match the same business-first order and audience rule as the two skill files.
- `.claude/skills/review/SKILL.md` is unmodified.

### 2. Verification
**Agent:** skill-coder
**Model:** haiku — mechanical read-and-confirm check.

- [ ] Re-read `.claude/skills/plan-and-do/SKILL.md` and confirm the `## Writing Style` section states it governs PRD, plan, and review documents.
- [ ] Re-read `.claude/skills/plan-and-do/SKILL.md` Step 6.2 and confirm the PRD structure block orders `### Business Summary` before `### Technical Summary` under `## Summary`, lists the eight existing sections unchanged, ends with an optional `## Technical Notes`, and states both the "Audience rule:" line and the "no code samples anywhere in the PRD" line.
- [ ] Re-read `.claude/skills/plan-and-do/plan-and-do-delegation.md` `## 11. PLAN STRUCTURE (Step 7.3)` and confirm `### Business Summary` sits before `### Technical Summary` under one `## Summary` heading, with the plan audience-rule line present.
- [ ] Re-read `.claude/agents/planner.md` and confirm its summary rule matches the same business-first order and audience rule as the two skill files.
- [ ] Re-read `.claude/skills/review/SKILL.md` `## Writing Style` and confirm it still reads word-for-word identical to the pre-edit plan-and-do version, and needs no change — reviews do not get the business/technical summary split.
- [ ] Confirm no file outside the three named in Task 1 was changed.
- [ ] Report pass/fail per check; on any fail, name the file and section that does not match.

## Tests

`N/A — docs-only change; no automated tests apply. The Verification task group above is the check for this change.`

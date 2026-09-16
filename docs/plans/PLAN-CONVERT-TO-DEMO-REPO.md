# Implementation Plan: CONVERT-TO-DEMO-REPO

## Summary

### Business Summary
This repo used to serve two audiences: conference visitors and paid workshop participants, with a folder of hands-on exercises. It becomes a pure product demo — the workshop exercise track disappears entirely, while the valuable "bring these AI skills to your own project" guidance moves directly into the main README so every visitor sees it right away, with no side documents to chase down. A new walkthrough doc shows the ticket-triage-to-build pipeline end to end. No application feature changes; this is a documentation and repo-structure cleanup only.

### Technical Summary
Delete `/tasks/` (12 exercise files), `docs/welcome_DE.MD`, `docs/welcome_EN.MD`, and the `do-factory-automatic` skill plus its dedicated `.github/workflows/do-factory-automatic.yml`. That skill is confirmed NOT a duplicate of `do-fully-automatic` — it targets a different backend system (`agent_task`/`/api/agent-tasks`, sources EMAIL/GITHUB_ISSUE/ERROR_REPORT/APP_LOG) vs. `do-fully-automatic`'s Kanban ticket system (`/api/tickets`) — though both workflows do share the same `repository_dispatch: [solve-agent-tasks]` trigger today, so `agent-task-runner.yml` becomes the sole consumer of that event after this deletion; `agent-task-runner.yml` itself stays untouched. Fully merge `docs/TRANSFER.md`, `docs/SKILLS.md`, and `docs/SUBAGENTS.md` into `README.MD` as one self-contained, German-language section, then delete the three source files; drop the two-audience framing; update the skill count from 7 to 6; keep the "Training" business-ad section as-is. Update the remaining training/workshop wording repo-wide in the files that carry it: `docs/TOOLS.md`, `AGENTS.md`, and `docs/specs/*.md`, and verify `CLAUDE.md` (a 6-line stub that imports `AGENTS.md`) carries none. Add a new `docs/WALKTHROUGH.md` describing the `/write-ticket` → `/do-fully-automatic`/`/do-semi-automatic` pipeline, linked from README's documentation table. Pure docs/skills/CI-config change — no `backend/` or `frontend/` code touched.

## Test Command
Backend: `cd backend && npm test`
Frontend: `cd frontend && npx ng test --watch=false`

## Tasks

### 1. Remove the `do-factory-automatic` skill and its CI workflow
**Agent:** skill-coder
**Model:** sonnet — deletion is mechanical, but the one live file that still names the skill (`.claude/agent-memory/requirements-reviewer/project_agent_task_reject_patterns.md`) needs a careful reword that keeps the two similar-looking automation systems (agent-task runner vs. Kanban skills) distinct, not just find-and-replace

- [ ] Delete `.claude/skills/do-factory-automatic/` (whole directory, currently just `SKILL.md`)
- [ ] Delete `.github/workflows/do-factory-automatic.yml`
- [ ] Do **not** touch `.github/workflows/agent-task-runner.yml` — it stays untouched, even though it currently shares the same `repository_dispatch: types: [solve-agent-tasks]` trigger as the deleted workflow (today one cron firing dispatches both; after this deletion, `agent-task-runner.yml` becomes the sole consumer of that event — a desirable simplification, not a regression). It invokes `.claude/prompts/agent-*.md` prompt files, a completely separate mechanism from the deleted skill.
- [ ] Do **not** touch the `agent_task` backend feature (DB table, `/api/agent-tasks` API, `/admin/agent-tasks` dashboard) — only the skill and its own workflow go away
- [ ] Update `.claude/agent-memory/requirements-reviewer/project_agent_task_reject_patterns.md` line 10, which currently reads: `**Why:** The autonomous runner (`do-factory-automatic` skill / `/admin/agent-tasks`) decides solve-or-reject without human input.` — reword to reference the actual remaining runner for `agent_task` (the agent-task-runner workflow / prompts under `.claude/prompts/agent-*.md`), not the deleted skill. Do not delete the surrounding pattern-note content — only fix the stale skill reference.
  - **Implementer note:** the deleted `do-factory-automatic` skill delegated its accept/reject judgment to the `requirements-reviewer` subagent (which is why this memory file lives under `.claude/agent-memory/requirements-reviewer/`). The surviving `agent-task-runner.yml` + `.claude/prompts/agent-*.md` make that judgment inline in the prompt text, without invoking `requirements-reviewer` at all. So after this reword, the note accurately names the surviving runner, but that runner does not actually consult this memory file or subagent — it becomes a reference note about a decision pattern that now exists in unwired, duplicate form in the prompt files. That's fine (do not delete the content — just fix the stale name), but don't word the fix in a way that implies the memory file is still mechanically read by anything.
- [ ] Confirm via grep that no other file under `.claude/` references `do-factory-automatic` after the edit

**Acceptance criteria:**
- `.claude/skills/do-factory-automatic/` no longer exists
- `.github/workflows/do-factory-automatic.yml` no longer exists
- `.github/workflows/agent-task-runner.yml` is byte-for-byte unchanged
- `.claude/agent-memory/requirements-reviewer/project_agent_task_reject_patterns.md` no longer names `do-factory-automatic`, still describes the same rejection pattern correctly attributed to the remaining runner
- `grep -r "do-factory-automatic" .claude/` returns no results

### 2. Remove the `/tasks/` folder
**Agent:** direct
**Model:** n/a — pure `git rm -r tasks/`, no judgment or code involved

- [ ] Delete `tasks/introduction/` (6 files: `Bonusaufgabe 1.md`, `Bonusaufgabe 2.md`, `Übungsaufgabe 1.md` through `4.md`)
- [ ] Delete `tasks/advanced/` (7 files: `Skill für Übungsaufgabe 2.md`, `Skill für Übungsaufgabe 4.md`, `Übungsaufgabe 1.md` through `5.md`)
- [ ] Delete the now-empty `tasks/` directory itself

**Acceptance criteria:**
- `tasks/` does not exist anywhere in the repo tree

### 3. Restructure and merge README.MD
**Agent:** ba-writer
**Model:** sonnet — substantial synthesis of three source documents into one coherent section, plus a structural rewrite of the two-audience framing; not mechanical

- [ ] Remove the "Zwei Wege durch dieses Repo" section (current lines ~28–35) entirely
- [ ] Remove the "English? See docs/welcome_EN.MD" callout line near the top (current line 24)
- [ ] Keep the "Training" section as-is (atra.consulting's separate paid-training business mention) — **confirmed by user: keep it**, no further action needed
- [ ] Fix the "Tools" section line: `"Die App hat drei Tools für Training und Demo."` → drop `"Training und"`, so it reads as demo-only (e.g. `"Die App hat drei Tools für die Demo."`)
- [ ] Remove the "Für Workshop-Teilnehmer: Aufgaben bearbeiten" section entirely — heading, `training-<MMJJ>/<name>` branch-naming instructions, `/tasks/` reference, and the `/plan-and-do` example within it (the general `/plan-and-do` explanation lives on in the merged Skills section and in "Nützliche Befehle")
- [ ] Replace the "Für Konferenz-Zuhörer: Skills & Subagents übernehmen" heading and its out-linking content with one new, self-contained, inline section — suggested heading: `## Skills & Subagents übernehmen` — with no audience framing (drop "Konferenz-Zuhörer" wording from the intro paragraph)
- [ ] Under that new section, merge in **all three source documents**, translated/written consistently in German (README's dominant language — see resolved language decision below):
  - `### Die Subagents` — merge `docs/SUBAGENTS.md` content in full: what a subagent is, why use them, how to invoke one, the six category tables (Coding, Review, Writing, Testing, Ops, Tooling) with exact agent/purpose/model values unchanged, the "Domänengebunden oder allgemein?" subsection, and the "CI-Workflow: do-semi-automatic.yml" subsection. Translate all English prose to German. Drop the trailing "Mehr Details" cross-link block (`.claude/agents/`, `CLAUDE.md`, `TRANSFER.md` links) — replace with a single in-page anchor link to the new `Skills und Subagents ins eigene Projekt übernehmen` subsection below. Also drop/replace the inline cross-link in the "Domänengebunden oder allgemein?" subsection (`Siehe [TRANSFER.md](TRANSFER.md).`) and the one in the "CI-Workflow" subsection (`Skill-Details: [SKILLS.md](SKILLS.md)`) with in-page anchors to the sibling merged subsections instead.
  - `### Die Skills` — merge `docs/SKILLS.md` content, already German. Change "sieben eigene Skills" → "sechs eigene Skills". Remove the `/do-factory-automatic` entry entirely. In the "Voraussetzung: `backend/.env`" paragraph, update the headless-skill list from four skills to three: `/do-fully-automatic`, `/do-semi-automatic`, `/write-ticket` (drop `/do-factory-automatic`). Keep the exact heading wording (word-for-word) for every retained skill (`/plan-and-do`, `/review`, `/update-claude-files`, `/do-semi-automatic`, `/do-fully-automatic`, `/write-ticket`) — this preserves their GitHub-generated anchor text so Task 6 (TOOLS.md link fix) is a pure path substitution. **In the `/plan-and-do` entry, remove the sentence "Workshop-Teilnehmer starten ihre Aufgaben mit diesem Skill." (or reword it to drop "Workshop-Teilnehmer") — this sentence must not survive into README given the acceptance criteria below.** Also drop the top-of-file cross-link `Mehr zu Agents: [SUBAGENTS.md](SUBAGENTS.md).` (replace with an in-page anchor to `### Die Subagents`), and **do not carry over** the file's trailing `## Übernahme in dein Projekt` section — it duplicates the new `Skills und Subagents ins eigene Projekt übernehmen` subsection and points at the soon-deleted `TRANSFER.md`; fold its purpose into that subsection instead of merging it as a separate block.
  - `### Skills und Subagents ins eigene Projekt übernehmen` — merge `docs/TRANSFER.md`'s 8-step process, already German. Reword its intro line ("Diese Anleitung ist für Konferenz-Zuhörer...") to drop the audience label. Replace its trailing cross-links ("Mehr zu den Bausteinen: [SUBAGENTS.md] · [SKILLS.md]") with in-page anchors to `### Die Subagents` and `### Die Skills` above.
- [ ] **Fix relative links that break when content moves from `docs/*.md` (relative to `docs/`) into `README.MD` (relative to repo root):**
  - In the merged Skills content: `specs/SPEC-API-TASKS.md` → `docs/specs/SPEC-API-TASKS.md`; `specs/SPEC-API-TICKETS.md` → `docs/specs/SPEC-API-TICKETS.md`
  - In the merged Subagents content: `specs/SPEC-API-TICKETS.md` → `docs/specs/SPEC-API-TICKETS.md`; `../CLAUDE.md` → `CLAUDE.md`
  - All the in-page cross-links called out above (SUBAGENTS.md↔SKILLS.md↔TRANSFER.md mutual references) become in-page anchors, not file links
  - Check every link inside the three merged blocks individually — do not assume this list is exhaustive
- [ ] Delete source files after their content is merged: `docs/TRANSFER.md`, `docs/SKILLS.md`, `docs/SUBAGENTS.md`
- [ ] Delete `docs/welcome_DE.MD` and `docs/welcome_EN.MD`
- [ ] Update the "Weiterführende Dokumentation" table: remove the rows for `docs/TRANSFER.md`, `docs/SKILLS.md`, `docs/SUBAGENTS.md`, `docs/welcome_DE.MD`, `docs/welcome_EN.MD` (5 rows total)
- [ ] In the "Projektstruktur" tree, the `docs/` row currently ends with "..., PRDs, Tasks" — remove the trailing "Tasks" word (no `/tasks/` folder exists anymore, and it was never its own row in the tree)
- [ ] Rewrite the "Inhalt" (TOC) section: drop the "Gemeinsam" / "Für Konferenz-Zuhörer" / "Für Workshop-Teilnehmer" grouping entirely. Flatten into a single ordered list matching the new section order: Voraussetzungen, Schnellstart, Demo-Login, Tools, Skills & Subagents übernehmen, Nützliche Befehle, Playwright-MCP: Browser-Automation, Features, Tech-Stack, Weiterführende Dokumentation, Lizenz
- [ ] Preserve unchanged: Voraussetzungen, Schnellstart, Demo-Login, Playwright-MCP, Features, Tech-Stack, Lizenz sections
- [ ] Apply repo writing style throughout new/rewritten prose: short sentences, simple words, no passive voice, sentence fragments fine

**Language decision (resolved, not open):** all merged content is written in German. README.MD is German-first; `docs/SUBAGENTS.md` (English) gets translated. This keeps the final document internally consistent.

**Acceptance criteria:**
- `docs/TRANSFER.md`, `docs/SKILLS.md`, `docs/SUBAGENTS.md`, `docs/welcome_DE.MD`, `docs/welcome_EN.MD` no longer exist
- README.MD contains no reference to "Konferenz-Zuhörer", "Workshop-Teilnehmer", `training-<MMJJ>`, or `/tasks/`
- README.MD states "sechs" / "6" skills, still states "27" subagents
- README.MD's merged Skills section lists exactly 3 skills needing `backend/.env`, and never mentions `/do-factory-automatic`
- Every link inside the merged section resolves to an existing file or a valid in-page anchor
- TOC entries match actual section headings 1:1

### 4. Verify CLAUDE.md and update AGENTS.md training/workshop wording
**Agent:** ba-writer
**Model:** sonnet — small scope, but requires the same subject-matter judgment as Task 3 to spot subtler framing, not just keyword grep

- [ ] Re-read `CLAUDE.md` in full. Confirm it contains no "training", "workshop", "Übungsaufgabe", "Konferenz-Zuhörer", or `/tasks/` language (a prior grep found zero hits — this is a confirmation pass, not an expected rewrite). `CLAUDE.md` is a short stub that imports `AGENTS.md` (`@AGENTS.md`) — the actual prose to fix lives there, per the next bullets.
- [ ] In `AGENTS.md`, reword the following (user-confirmed in scope):
  - Line 11: `### Autonomous Agents (advanced workshop)` → drop the `(advanced workshop)` qualifier (e.g. `### Autonomous Agents`)
  - Line 20: `### Ticket System (Kanban, advanced workshop)` → drop `, advanced workshop` (e.g. `### Ticket System (Kanban)`)
  - Line 22: `A fake ticketing system for the software-factory training.` → reword to drop "training" (e.g. `A fake ticketing system for the software-factory demo.`)
  - Line 26: `Seeded with the 12 workshop specs; POST /api/tickets/reset re-seeds.` → reword "workshop specs" to something that doesn't reference the deleted workshop track (e.g. `Seeded with 12 demo specs; POST /api/tickets/reset re-seeds.`) — this describes seed-data provenance, not the deleted `/tasks/` files themselves, so keep the factual "seeded with N items" framing, just drop "workshop"
- [ ] If CLAUDE.md itself needs a tweak (unlikely per the prior grep), make the smallest wording change that removes it — do not restructure the file, do not invent unrelated changes
- [ ] Do not touch any other part of `AGENTS.md` (build commands, conventions, entity recipe, commit rules, spec reading lists) — wording-only fix, scoped to the four lines above

**Acceptance criteria:**
- `grep -iE "training|workshop|übungsaufgabe|konferenz-zuhörer" CLAUDE.md AGENTS.md` returns no results
- `CLAUDE.md` is either unchanged or has only a minimal targeted fix
- `AGENTS.md`'s only changes are the four reworded lines above — no other content differs

### 5. Update docs/specs/*.md training/workshop wording
**Agent:** ba-writer
**Model:** sonnet — wording-only changes across four technical spec files; needs judgment to reword without altering technical meaning

- [ ] `docs/specs/SPECS.md` line 63: reword "Kanban-Ticketsystem für Workshop-Aufgaben" to drop "Workshop" (e.g. "Kanban-Ticketsystem für Demo-Aufgaben" or simply "Kanban-Ticketsystem")
- [ ] `docs/specs/SPECS-backend.md` lines 153 and 160: reword "software-factory training" and "Re-seed the 12 workshop tickets" to drop the training/workshop wording while preserving the technical meaning (e.g. "software-factory demo", "Re-seed the 12 demo tickets")
- [ ] `docs/specs/SPEC-API-TASKS.md` lines 154 and 374: reword "re-run the workshop" and "A workshop skill drives this API" to drop "workshop" (e.g. "re-run the demo", "A headless skill drives this API")
- [ ] `docs/specs/SPEC-API-TICKETS.md` lines 21, 433, and 537: reword the "workshop tickets"/"workshop skill" mentions to drop "workshop", preserving technical accuracy
- [ ] These are wording-only changes — do not alter any documented API signature, schema, enum value, or technical behavior. Only the word "workshop"/"training" and directly adjacent phrasing changes.

**Acceptance criteria:**
- `grep -riE "workshop|training" docs/specs/SPECS.md docs/specs/SPECS-backend.md docs/specs/SPEC-API-TASKS.md docs/specs/SPEC-API-TICKETS.md` returns no results
- No technical content (endpoints, schemas, field names, counts of actual DB rows) changed — only the training/workshop wording around them

### 6. Fix docs/TOOLS.md links and remaining training-era wording
**Agent:** ba-writer
**Model:** sonnet — mechanical link repointing plus small rewording of four phrases; needs the same subject-matter judgment as Task 3, not pure find-and-replace

*(Waits for Task 3 — needs README's final heading text to build correct anchors.)*

- [ ] Line ~45: repoint `[`/write-ticket`](SKILLS.md#write-ticket--feedback-in-ein-neues-ticket-triagieren)` → `[`/write-ticket`](../README.MD#write-ticket--feedback-in-ein-neues-ticket-triagieren)` (same anchor fragment, since Task 3 preserves the heading text verbatim)
- [ ] Line ~47: the sentence `"Der Skill dahinter: [`/do-factory-automatic`](SKILLS.md#do-factory-automatic--autonom-ohne-mensch)."` references a deleted skill — remove this clause. Reword the surrounding sentence so it no longer references any skill by that name (e.g. keep just `"Das Tool zeigt einen autonomen Agenten im „Software-Factory"-Betrieb."` without the skill link, or point instead to the agent-task-runner workflow if that reads better — writer's call, but the deleted skill name must not appear)
- [ ] Line ~65: repoint the three links in the "Skills dazu" sentence:
  - `[`/do-semi-automatic`](SKILLS.md#do-semi-automatic--autonom-ein-ticket-pro-lauf)` → `[`/do-semi-automatic`](../README.MD#do-semi-automatic--autonom-ein-ticket-pro-lauf)`
  - `[`/do-fully-automatic`](SKILLS.md#do-fully-automatic--autonom-inklusive-beförderung-aus-definition)` → `[`/do-fully-automatic`](../README.MD#do-fully-automatic--autonom-inklusive-beförderung-aus-definition)`
  - `[`/write-ticket`](SKILLS.md#write-ticket--feedback-in-ein-neues-ticket-triagieren)` → `[`/write-ticket`](../README.MD#write-ticket--feedback-in-ein-neues-ticket-triagieren)`
- [ ] Verify no other line in `docs/TOOLS.md` links to `SKILLS.md`, `SUBAGENTS.md`, or `TRANSFER.md`
- [ ] **User-confirmed additional scope:** update 4 remaining training-era phrases for consistency with the demo-repo reframe:
  - Line 3: `"...Training und Demo."` → drop `"Training und"`, demo-only wording
  - Line 29: `"Gut für Vorträge und Workshops"` → reword to drop "Workshops" (e.g. `"Gut für Vorträge und Demos"`)
  - Line 56: `"...ein einfaches Ticketsystem für das Software-Factory-Training."` → drop the training framing (e.g. `"...ein einfaches Ticketsystem für die Software-Factory-Demo."`)
  - Line 60: `"12 Workshop-Tickets"` → reword to drop "Workshop" (e.g. `"12 Demo-Tickets"`)

**Acceptance criteria:**
- `grep -n "SKILLS.md\|SUBAGENTS.md\|TRANSFER.md" docs/TOOLS.md` returns no results
- `docs/TOOLS.md` contains no occurrence of `do-factory-automatic`
- The 3 remaining repointed links use anchor fragments that exist in the final `README.MD`
- `grep -iE "training|workshops?" docs/TOOLS.md` returns no results

### 7. Create docs/WALKTHROUGH.md
**Agent:** ba-writer
**Model:** sonnet — new prose content synthesizing the ticket-triage-to-build pipeline across two skills, not mechanical

*(Waits for Task 3 — needs README's final section/table structure to add a link row.)*

- [ ] Create `docs/WALKTHROUGH.md`, German, short-sentence style matching `docs/TOOLS.md` and the rest of the repo's writing style
- [ ] Describe the pipeline end to end:
  1. A feedback item exists (a bug report, feature idea, or error report — free text or an existing `agent_task`)
  2. Run `/write-ticket` to triage it into a new Kanban ticket (`Definition`, owner `HUMAN`, possibly flagged `fullyReady`)
  3. Then either:
     - `/do-semi-automatic` — builds exactly one `Ready+AI` ticket per run (a human already promoted it via "Nach Bereit")
     - `/do-fully-automatic` — also handles `Definition+AI` or `Definition+fullyReady` tickets, promoting them itself before building
- [ ] Explain when to use which: `/do-semi-automatic` when a human already vetted and promoted the ticket to Ready; `/do-fully-automatic` for a more hands-off pipeline where the promotion step also happens unattended
- [ ] Reference the Ticket-Board UI (`/admin/tickets`) to watch the ticket move through the pipeline
- [ ] Link to `docs/specs/SPEC-API-TICKETS.md` for API details
- [ ] Add one new row for `docs/WALKTHROUGH.md` in README.MD's "Weiterführende Dokumentation" table

**Acceptance criteria:**
- `docs/WALKTHROUGH.md` exists and describes the full `/write-ticket` → `/do-fully-automatic`/`/do-semi-automatic` pipeline, including when to use which skill
- README.MD's documentation table includes a row linking to `docs/WALKTHROUGH.md`

### 8. Review README.MD, CLAUDE.md, AGENTS.md, docs/specs/*.md, docs/TOOLS.md, and docs/WALKTHROUGH.md
**Agent:** ba-reviewer
**Model:** sonnet — floor tier for a prose/spec review

*(Waits for Tasks 3, 4, 5, 6, and 7.)*

- [ ] Review README.MD for: leftover two-audience language, correct skill/agent counts, broken links or anchors, consistent German throughout the merged section, style compliance (short sentences, no passive voice), and confirm the vestigial "Übernahme in dein Projekt" content and the "Workshop-Teilnehmer" sentence from the old SKILLS.md did not survive the merge
- [ ] Review the CLAUDE.md diff (or confirmation-of-no-diff) and the AGENTS.md diff (the four reworded lines, and nothing else) for correctness
- [ ] Review the docs/specs/*.md wording diffs (4 files) — confirm only wording changed, no technical content altered
- [ ] Review docs/TOOLS.md's changes (3 repointed links, 4 reworded phrases) for accuracy
- [ ] Review docs/WALKTHROUGH.md for accuracy of the write-ticket → do-fully-automatic/do-semi-automatic pipeline description, and confirm README links to it
- [ ] File findings; loop back to Tasks 3/4/5/6/7 owners for fixes if findings are material

**Acceptance criteria:**
- Review produces a findings list (even if empty) covering all files touched by Tasks 3–7
- No unresolved "broken link" or "stale reference" finding remains open

### 9. Review the do-factory-automatic and workflow deletions
**Agent:** skill-reviewer
**Model:** sonnet — floor tier for a tooling/skills review

*(Waits for Task 1.)*

- [ ] Confirm `.claude/skills/do-factory-automatic/` and `.github/workflows/do-factory-automatic.yml` are fully gone
- [ ] Confirm `.github/workflows/agent-task-runner.yml` is untouched
- [ ] Confirm the `agent_task` backend feature (routes, DB table, admin dashboard) is untouched
- [ ] Confirm the reworded `.claude/agent-memory/requirements-reviewer/project_agent_task_reject_patterns.md` correctly identifies `do-factory-automatic` as the deleted **agent_task-oriented** skill (NOT "Kanban-oriented" — the Kanban-oriented skills, `do-fully-automatic`/`do-semi-automatic`/`write-ticket`, are the ones that stay) and doesn't accidentally conflate the two systems

**Acceptance criteria:**
- Review produces a findings list (even if empty)
- No finding indicates the two automation systems (agent_task runner vs. Kanban skills) got confused in the reworded memory note, and the memory note itself correctly attributes the deleted skill to the agent_task system

### 10. Test Implementation
**Agent:** direct
**Model:** n/a — no test suite applies to markdown/YAML/skill-file changes; this task group is a no-op by design

- [ ] No new automated tests are needed. This is a pure docs/skills/CI-config change with no application code touched.

### 11. Verification
**Agent:** direct
**Model:** n/a — plain command and grep verification, no agent judgment needed

*(Waits for all of Tasks 1–9, including any fixes from review findings in Tasks 8 and 9.)*

- [ ] `tasks/` directory does not exist
- [ ] `docs/TRANSFER.md`, `docs/SKILLS.md`, `docs/SUBAGENTS.md`, `docs/welcome_DE.MD`, `docs/welcome_EN.MD` do not exist
- [ ] `docs/WALKTHROUGH.md` exists
- [ ] `.claude/skills/do-factory-automatic/` and `.github/workflows/do-factory-automatic.yml` do not exist
- [ ] `.github/workflows/agent-task-runner.yml` still exists, unchanged
- [ ] Repo-wide grep (excluding `docs/plans/`, `docs/reviews/`, `docs/state/`, `docs/prds/`, `docs/superpowers/` — historical records, never edited retroactively) for `do-factory-automatic`, `welcome_DE`, `welcome_EN`, `TRANSFER.md`, `SKILLS.md`, `SUBAGENTS.md`, `training-<MMJJ` pattern, `/tasks/` returns no hits in any live file (`README.MD`, `CLAUDE.md`, `AGENTS.md`, `docs/TOOLS.md`, `docs/SETUP.md`, `docs/CHEATSHEET-CLAUDE-CODE.md`, `docs/specs/**`, `.claude/**`, `.github/workflows/**`, `backend/`, `frontend/`)
- [ ] Repo-wide grep for the general words `training|workshop` (case-insensitive) across the same live-file set returns no hits, except any deliberate exception explicitly approved (none expected)
- [ ] `cd backend && npm test` passes — regression safety net, expected unaffected by docs-only change
- [ ] `cd frontend && npx ng test --watch=false` passes — regression safety net, expected unaffected
- [ ] `cd frontend && npx ng build` succeeds — regression safety net, expected unaffected

## Tests

### Edge Cases
- [ ] Grep confirms zero dangling references to any deleted file or the deleted skill name, repo-wide, outside the explicitly-excluded historical folders
- [ ] README's merged Skills section lists exactly 6 skills and never names `do-factory-automatic`
- [ ] README's merged "headless skills needing `backend/.env`" list names exactly 3 skills, not 4
- [ ] `docs/TOOLS.md` has zero remaining links to `SKILLS.md`, `SUBAGENTS.md`, or `TRANSFER.md`, and zero remaining training/workshop wording
- [ ] `docs/TOOLS.md`'s 3 repointed links (`/write-ticket` ×2, `/do-semi-automatic`, `/do-fully-automatic`) resolve to real anchors in the final `README.MD`
- [ ] Relative links moved from `docs/SKILLS.md` / `docs/SUBAGENTS.md` into `README.MD` are path-corrected (`specs/...` → `docs/specs/...`, `../CLAUDE.md` → `CLAUDE.md`), and all mutual SKILLS↔SUBAGENTS↔TRANSFER cross-links become in-page anchors
- [ ] README's "Projektstruktur" tree no longer lists "Tasks" on the `docs/` row
- [ ] `CLAUDE.md` diff (if any) is minimal and targeted; `AGENTS.md` diff is limited to exactly the four reworded lines in Task 4
- [ ] `docs/specs/*.md` diffs are wording-only — no technical content changed
- [ ] `.claude/agent-memory/requirements-reviewer/project_agent_task_reject_patterns.md` no longer names the deleted skill, correctly attributes it to the agent_task system (not Kanban), and still correctly describes the rejection pattern it documents
- [ ] `docs/WALKTHROUGH.md` exists, is linked from README, and correctly explains when to use `/do-semi-automatic` vs. `/do-fully-automatic`

## Parallelism

- **Phase 1 (parallel): Tasks 1, 2, 3, 4, 5** — disjoint files, no interdependency. Task 10 (no-op) can also run any time in this phase.
- **Phase 2 (parallel, after Task 3): Tasks 6 and 7** — both need README's final structure (anchors / table format) but are independent of each other.
- **Phase 3 (parallel): Task 8 (needs 3, 4, 5, 6, 7) and Task 9 (needs 1)** — both are review passes over the phases above.
- **Phase 4: Task 11** — waits for everything, including any fixes from Phase 3 review findings.

## Resolved Decisions (previously Open Questions)

- **"Training" section in README.MD:** user confirmed — **keep it**. Legitimate business mention of atra.consulting's separate paid-training offering, unrelated to this repo's demo/training status.
- **docs/TOOLS.md training-era wording beyond the 3 link fixes:** user confirmed — **update these too** (Task 6), plus a 4th phrase ("12 Workshop-Tickets") found during plan review.
- **AGENTS.md training/workshop framing:** user confirmed — **update it too** (Task 4). It holds the actual prose `CLAUDE.md` imports.
- **docs/specs/*.md training/workshop wording:** user confirmed — **update these too** (new Task 5), wording-only, no technical content changes.
- **Task 7 (now Task 9) mislabel found in plan review:** fixed — the deleted skill is **agent_task-oriented**, not "Kanban-oriented"; the acceptance criteria now say this correctly.

# Implementation Plan: DEMO-WALKTHROUGHS

## Summary

### Business Summary
Three ready-to-run demo scripts show visitors how the "software factory" works: a fully automatic run, a supervised run that succeeds, and a supervised run where the AI refuses a vague request instead of guessing. The README links them right at the top, so everyone sees them first.

### Technical Summary
Three new German Markdown walkthroughs under `docs/walkthroughs/`: `/do-fully-automatic 10`, `/write-ticket 18` + `/do-semi-automatic <id>`, `/write-ticket 4` + `/do-semi-automatic <id>`. All facts come from seed data, skill files, and UI code. `README.md` gets a new section after the "Erstmal hier starten" callout plus a TOC entry. `docs/WALKTHROUGH.md` (concept overview) stays untouched and gets linked as background. Docs only — no app code changes.

## Test Command
`cd backend && npm test` / `cd frontend && npx ng test --watch=false` (docs-only change — no test run needed beyond link check)

## Verified Facts

- Ticket **#10** "Chancen-Phase als farbiger Badge", `CHORE`, `status=TODO` ("Bereit"), `owner=AI`, no comments. Ready+AI on a fresh DB — no click needed. `backend/src/seed/ticketSeed.ts:154-167`.
- `/do-fully-automatic` treats `TODO`+`AI` as `READY`, skips promotion, goes straight to claim. `.claude/skills/do-fully-automatic/SKILL.md:118-119, 275`.
- Agent-task **#18** "Show the website in the company list" (`EMAIL`), clear and concrete. `backend/src/seed/agentTaskSeed.ts:240-252`.
- Agent-task **#4** "Fix the broken feature" (`EMAIL`), one vague sentence. `backend/src/seed/agentTaskSeed.ts:58-70`.
- `/write-ticket` always creates a ticket in `DEFINITION`/`owner=HUMAN`. Good → `fullyReady=true`, no comment. Vague → `fullyReady=false` + comment with only questions. `.claude/skills/write-ticket/SKILL.md:150-207`.
- `/write-ticket` prints the new ticket id + URL last. Readers must copy that id. `.claude/skills/write-ticket/SKILL.md:235-252`.
- New ticket ids not fixed. Seed ids 1–12; next is 13 on a fresh DB. `docs/specs/SPEC-API-TICKETS.md:507-531`.
- `/do-semi-automatic` with an id aborts if `owner != AI` or `status != TODO` — before any content check. `.claude/skills/do-semi-automatic/SKILL.md:101-116`. So walkthroughs 2 **and** 3 need the "Nach Bereit" click first.
- `/do-semi-automatic` reject path: comment → `owner=HUMAN` → `status=DEFINITION`. Never claims, never builds. `.claude/skills/do-semi-automatic/SKILL.md:143-183`.
- `/do-semi-automatic` is headless: never calls `AskUserQuestion`, pre-answers plan approval. The "approval" in the semi-automatic flow is the **human's "Nach Bereit" click** — not a prompt from the skill. `.claude/skills/do-semi-automatic/SKILL.md:16, 228-237`.
- Buttons "An KI übergeben" and "Nach Bereit", shown only in `DEFINITION`. `frontend/src/app/features/admin/tickets/ticket-detail.component.ts:170,183,194`.
- "Nach Bereit" = `POST /:id/hand-to-ai` → `owner=AI` + `status=TODO`. "An KI übergeben" sets only `owner=AI`. `docs/specs/SPEC-API-TICKETS.md:350-402`.
- Column labels: Definition, Bereit, In Arbeit, Wartet, Erledigt. `docs/TOOLS.md:58`.
- Board `/admin/tickets` (all logins view, admin acts); agent tasks `/admin/agent-tasks` (admin).
- No UI reset for tickets. `POST /api/tickets/reset` admin session only. `docs/specs/SPEC-API-TICKETS.md:117`.
- Agent tasks: "Zurücksetzen" button on `/admin/agent-tasks` → `POST /api/agent-tasks/reset`, tickets untouched.
- Login body `{ "benutzername", "passwort" }`. `backend/src/routes/auth.ts:10-16`.
- Logins: `admin`/`admin123`, `user`/`test123`, `demo`/`demo1234`. `README.md:96-104`.
- Skills need `backend/.env` with `AGENT_API_TOKEN` and `AGENT_AUTH_ALLOW_LOOPBACK=1`. `README.md:269-281`.
- Skills pre-answer every `plan-and-do` checkpoint. No push, no PR. Result: local branch + local commits. `.claude/skills/do-fully-automatic/SKILL.md:317-329`.
- `plan-and-do` creates a new branch only from `main`; on a feature branch it keeps that branch. So start each walkthrough on `main`. `.claude/skills/plan-and-do/SKILL.md:382-400`.
- `docs/WALKTHROUGH.md` = concept overview, stays untouched. `docs/WALKTHROUGH.md:85-107`.

## Tasks

### 1. Walkthrough 1 — Vollautomatisch
**Agent:** ba-writer
**Model:** sonnet — new German prose from verified facts, more than mechanical copy

- [ ] Create `docs/walkthroughs/01-vollautomatisch.md`, title "Walkthrough 1: Vollautomatisch — Ticket #10 ohne Rückfrage bauen"
- [ ] Sections: `Ziel`, `Voraussetzungen`, `Vorgehen`, `Erwartetes Ergebnis`, `Zurücksetzen`, `Hintergrund`
- [ ] Voraussetzungen: `./start.sh`, `backend/.env` vars (link README), admin login, on `main`
- [ ] Vorgehen: git hygiene → login → board: #10 in "Bereit", owner KI → `/do-fully-automatic 10` → what to watch (no promotion, requirements-reviewer OK, claim → "In Arbeit", plan-and-do without questions, done) → board "Erledigt" → verify `/chancen` badges → git: local branch, no push/PR
- [ ] Zurücksetzen (same text in all three files): `./start.sh --reset-db` (recommended); agent-tasks "Zurücksetzen" button; tickets-only via two curl calls (login with cookie jar, `POST /api/tickets/reset`); ids not guaranteed → always read id from board or skill output
- [ ] Hintergrund: links to SPEC-API-TICKETS.md, do-fully-automatic SKILL.md, docs/WALKTHROUGH.md

### 2. Walkthrough 2 — Halbautomatisch, Erfolg
**Agent:** ba-writer
**Model:** sonnet — same as Task 1

- [ ] Create `docs/walkthroughs/02-halbautomatisch-erfolg.md`, title "Walkthrough 2: Halbautomatisch — vom Feedback zum fertigen Feature"
- [ ] Same sections
- [ ] Vorgehen: git hygiene → login → `/admin/agent-tasks?source=EMAIL`, task #18 → `/write-ticket 18` → watch: new ticket in Definition/Mensch, no comment, fullyReady, task closed, id printed (≈13) → open ticket, check 4 body sections → **human approval: click "Nach Bereit"** (explain vs. "An KI übergeben") → callout: `/do-fully-automatic` could promote a fullyReady ticket without this click; here the human approves on purpose → `/do-semi-automatic <id>` → watch: precondition OK, reviewer OK, claim, build without questions, done → verify `/firmen` website column → git: local branch, no push/PR
- [ ] Same Zurücksetzen block; Hintergrund adds write-ticket and do-semi-automatic SKILL.md

### 3. Walkthrough 3 — Halbautomatisch, scheitert absichtlich
**Agent:** ba-writer
**Model:** sonnet — same as Task 1, plus a subtle timing nuance

- [ ] Create `docs/walkthroughs/03-halbautomatisch-scheitert.md`, title "Walkthrough 3: Halbautomatisch — wenn die Anforderung zu vage ist"
- [ ] Same sections
- [ ] Vorgehen: git hygiene → login → task #4 → `/write-ticket 4` → watch: new ticket (≈14) Definition/Mensch, fullyReady=false, comment with only questions → open ticket → **do not answer** the questions → click "Nach Bereit" → explain: precondition checks only owner/status, content check comes later → `/do-semi-automatic <id>` → watch: reviewer says "zurückgeben", no claim, no build; new comment naming what's missing, owner Mensch, status Definition → ticket now has two comments → no branch, no commit → optional: answer via comment with "an KI zurückgeben" → back to "Bereit"
- [ ] Same Zurücksetzen block and Hintergrund as Task 2

### 4. README integration
**Agent:** ba-writer
**Model:** haiku — mechanical insert, fully specified

- [ ] After Tasks 1–3
- [ ] New `## Demo-Walkthroughs` section after the "Erstmal hier starten" callout + `---`, before `## Training`: intro sentence, 3-row table (link + "zeigt was"), closing line linking `docs/WALKTHROUGH.md` as background
- [ ] First TOC bullet: `- [Demo-Walkthroughs](#demo-walkthroughs)`
- [ ] Change nothing else

### 5. Verification
**Agent:** ba-reviewer
**Model:** sonnet — cross-check prose against specs, seed data, UI code

- [ ] Check button/column labels, URLs, seed titles, skill behavior claims, curl commands, internal links
- [ ] `docs/WALKTHROUGH.md` unchanged
- [ ] Each walkthrough states "no push, no PR" and the ticket-id caveat
- [ ] Fix list until clean

## Tests
- [ ] Link check: every relative link in the 3 files + README diff resolves
- [ ] No backend/frontend test run — no app code changed
- [ ] Optional: dry-run Walkthrough 1 on a reset DB

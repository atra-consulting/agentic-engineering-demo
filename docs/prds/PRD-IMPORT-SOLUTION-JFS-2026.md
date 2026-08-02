# PRD: IMPORT-SOLUTION-JFS-2026

## Source

User request: fill this repo (`coding-with-ai-demo`, currently empty) with the code from `atra-consulting/coding-with-ai-lab`, branch `solution-jfs-2026`. Then bring in the commits that landed on that repo's `main` after `solution-jfs-2026` was last touched.

Reference: https://github.com/atra-consulting/coding-with-ai-lab/tree/solution-jfs-2026
Reference: https://github.com/atra-consulting/coding-with-ai-lab/compare/solution-jfs-2026...main

## Problem Statement

`coding-with-ai-demo` has no commits and no files. It needs to start life as a copy of the `solution-jfs-2026` branch of `coding-with-ai-lab` — a full-stack CRM workshop app (Node/Express/Drizzle backend, Angular 21 frontend) — brought up to date with 5 small doc commits that landed on `coding-with-ai-lab`'s `main` after that branch diverged.

`coding-with-ai-lab` must stay untouched. No push, no branch, no PR there. Every change happens only in `coding-with-ai-demo`.

## Requirements

1. Import the full working tree of `coding-with-ai-lab@solution-jfs-2026` into `coding-with-ai-demo`, as a clean snapshot — one commit, authored in this repo, no foreign commit history attached (confirmed with the user).
2. Apply the diff `solution-jfs-2026...main` from the source repo on top of the import. Per `gh api compare`, that diff is exactly 4 files:
   - `AGENTS.md` — added
   - `CLAUDE.md` — modified
   - `README.MD` — modified
   - `docs/specs/SPECS-infrastructure.md` — modified
3. End state: working tree identical to `coding-with-ai-lab@main` (source repo's `main`, not this repo's `main`), imported as 2 clean commits in `coding-with-ai-demo`.
4. Existing files already committed in `coding-with-ai-demo` (this task's own `docs/state/STATE-IMPORT-SOLUTION-JFS-2026.json`, the untracked local `claude.bpf.json`) must survive the import untouched. Neither collides with a path in the source tree.

## Special Instructions

- **Do not touch `coding-with-ai-lab`.** Read-only access only (fetch/clone). Never push, never open a branch or PR there.
- **Only update `coding-with-ai-demo`.**
- Never stage the local `claude.bpf.json` — it must stay untracked.

## Implementation Approach

- Add a temporary, local-only git remote pointing at the public `coding-with-ai-lab` repo (HTTPS, no credentials needed — repo is public).
- Fetch `solution-jfs-2026` and `main` from that remote.
- Check out the full `solution-jfs-2026` tree into the working directory (without disturbing files already tracked in `coding-with-ai-demo`), stage everything except `claude.bpf.json`, and commit as one snapshot commit.
- Fetch the `main` version of the 4 changed files from the source repo and overwrite them in the working tree, then commit as a second, separate commit — this reproduces the 5-commit diff exactly, since those 4 files are the entire net difference between the two branches.
- Remove the temporary remote once done.

## Test Strategy

The imported app owns its own tests. After import:
- Backend: `cd backend && npm install && npm test` (Playwright API tests).
- Frontend: `cd frontend && npm install && npm test -- --watch=false` (Karma/Jasmine unit tests).
- Sanity check: `cd frontend && npx ng build` (build compiles).

No new tests are written for the import itself — this is a content-migration task, not a feature.

## Non-Functional Requirements

- No secrets, credentials, or `.env` files carried over beyond the source repo's own `.env.example` (already tracked there).
- The temporary git remote must never be pushed to.

## Success Criteria

- `coding-with-ai-demo`'s working tree matches `coding-with-ai-lab@solution-jfs-2026` exactly, except for the 4 files the upstream diff touches (`AGENTS.md` added, `CLAUDE.md`/`README.MD`/`docs/specs/SPECS-infrastructure.md` now matching `main`'s versions) and this task's own planning artifacts (`docs/state/`, `docs/prds/`, `docs/plans/`, `docs/reviews/` entries for `IMPORT-SOLUTION-JFS-2026`, plus `claude.bpf.json`). Note: `solution-jfs-2026` and `main` are diverged sibling branches (93 vs. 5 unique commits), so the result does NOT match `main`'s full tree — only those 4 files' content does.
- Two clean commits in `coding-with-ai-demo`: one snapshot import, one upstream-diff merge.
- `coding-with-ai-lab` has zero new branches, commits, or pushes from this work.
- Backend and frontend test suites run (pass/fail reported; pre-existing failures in the source app are not this task's responsibility to fix).

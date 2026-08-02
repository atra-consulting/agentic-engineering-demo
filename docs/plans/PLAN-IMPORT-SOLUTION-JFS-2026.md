# Implementation Plan: IMPORT-SOLUTION-JFS-2026

## Test Command
`(cd backend && npm install && npm test) ; (cd frontend && npm install && npm test -- --watch=false)`

## Tasks

### 1. Fetch source repo (read-only)
**Agent:** direct
**Model:** n/a

- [ ] Add a temporary local git remote `lab-source` → `https://github.com/atra-consulting/coding-with-ai-lab.git` (public repo, no credentials needed)
- [ ] `git fetch lab-source solution-jfs-2026 main`
- [ ] Never push to `lab-source`. Never create a branch or PR on `coding-with-ai-lab`.

### 2. Import solution-jfs-2026 as a clean snapshot
**Agent:** direct
**Model:** n/a

- [ ] `git checkout lab-source/solution-jfs-2026 -- .` — writes every file from that branch into the working tree, leaves files that only exist here (`docs/state/STATE-IMPORT-SOLUTION-JFS-2026.json`, `docs/prds/PRD-IMPORT-SOLUTION-JFS-2026.md`, this plan) alone, since none of those paths exist in the source tree
- [ ] Confirm `claude.bpf.json` is untouched and still untracked (`git status` shows it, but it was never part of the source tree either)
- [ ] Stage everything except `claude.bpf.json`: `git add -A -- . ':!claude.bpf.json'`
- [ ] `git status` sanity check: `claude.bpf.json` must NOT appear in the staged list
- [ ] Commit: `feat: Import coding-with-ai-lab@solution-jfs-2026 as a snapshot. IMPORT-SOLUTION-JFS-2026`

### 3. Apply the upstream diff (solution-jfs-2026...main)
**Agent:** direct
**Model:** n/a

- [ ] Fetch the `main`-branch version of the 4 changed files from `lab-source/main` and write them into the working tree, overwriting/creating as needed:
  - `AGENTS.md` (new file)
  - `CLAUDE.md`
  - `README.MD`
  - `docs/specs/SPECS-infrastructure.md`
- [ ] Verify no other files differ between `lab-source/solution-jfs-2026` and `lab-source/main` (already confirmed via `gh api compare` — exactly these 4 files)
- [ ] Stage exactly these 4 files: `git add AGENTS.md CLAUDE.md README.MD docs/specs/SPECS-infrastructure.md`
- [ ] Commit: `chore: Merge upstream changes from coding-with-ai-lab main (5 commits since solution-jfs-2026 diverged). IMPORT-SOLUTION-JFS-2026`

### 4. Clean up
**Agent:** direct
**Model:** n/a

- [ ] `git remote remove lab-source`
- [ ] `git status` — confirm working tree is clean except for the local untracked `claude.bpf.json`

### 5. Test Implementation
**Agent:** direct
**Model:** n/a

- [ ] No new tests are written — this is a content-migration task. The imported app carries its own test suites.

### 6. Verification
**Agent:** direct
**Model:** n/a

- [ ] `cd backend && npm install && npm test` (Playwright API tests)
- [ ] `cd frontend && npm install && npm test -- --watch=false` (Karma/Jasmine unit tests)
- [ ] `cd frontend && npx ng build` (build sanity check)
- [ ] Diff check: working tree matches `lab-source/main` exactly, aside from this task's own planning artifacts and `claude.bpf.json`

## Tests

### Migration correctness (manual verification, not new test code)
- [ ] `git diff lab-source/main -- . ':!docs/state' ':!docs/prds' ':!docs/plans' ':!docs/reviews' ':!claude.bpf.json'` shows no output — tree matches source `main` exactly
- [ ] `coding-with-ai-lab` has no new branches/commits/pushes from this work (spot-check: `git ls-remote --heads https://github.com/atra-consulting/coding-with-ai-lab.git` unchanged)

### Pre-existing app test suites
- [ ] Backend Playwright suite result (pass/fail reported, not necessarily fixed if pre-existing failures exist)
- [ ] Frontend Karma suite result (pass/fail reported, not necessarily fixed if pre-existing failures exist)

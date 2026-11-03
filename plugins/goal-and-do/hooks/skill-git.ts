// The git commands the six skills tell Claude to run, one per line: skill | phase it runs in | the command as the SKILL.md
// writes it, placeholders included. skill-git.test.ts runs each through the guard; dev/goal-and-do/test/skill-git.test.mjs
// keeps this list equal to the commands the SKILL.md files name.
export const SKILL_GIT = `
write-intent | Intent | git add changes/<id>/request.md changes/<id>/intent.md
write-intent | Intent | git branch --list sdd/<id>
write-intent | Intent | git branch --show-current
write-intent | Intent | git commit -m 'docs(<id>): intent' -m 'Co-Authored-By: Claude <noreply@anthropic.com>' -- changes/<id>/request.md changes/<id>/intent.md
write-intent | Intent | git rev-parse --show-toplevel
write-intent | Intent | git status --short -- changes/<id>/request.md changes/<id>/intent.md
write-intent | Intent | git switch -c sdd/<id> origin/<base>
write-intent | Intent | git switch sdd/<id>
write-intent | Intent | GIT_TERMINAL_PROMPT=0 git fetch origin <base>
write-spec | Spec | git branch --show-current
write-spec | Spec | git status --short -- changes/<id>/intent.md
write-spec | Spec | git status --short -- changes/<id>/spec.md
plan-change | Plan | git status --short -- <test-paths> changes/<id>/plan.md
test-change | Test | git diff --quiet <locked-at> -- <test-paths>
test-change | Test | git ls-files --others --exclude-standard -- <test-paths>
test-change | Test | git rev-parse --git-path goal-and-do/weakening-<id>.md
open-pr | PR | git diff origin/<base>...HEAD
open-pr | PR | git push -u origin sdd/<id>
open-pr | PR | git push origin sdd/<id>
open-pr | PR | git rev-parse --git-path goal-and-do/base-claude-<id>.md
open-pr | PR | git rev-parse --git-path goal-and-do/signals-<id>.md
open-pr | PR | git rev-parse --git-path goal-and-do/weakening-<id>.md
open-pr | PR | git show origin/<base>:CLAUDE.md
`

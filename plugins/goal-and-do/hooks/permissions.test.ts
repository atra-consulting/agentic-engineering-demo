import { expect, test } from 'claude-code/testing'
import { describeRule, mergeAllowRules, normalizeCommand, pickedRules, ruleChoiceLabels, ruleFor, ruleLabel, shouldSuggest } from './permissions'

const bash = (command: string, isReadOnly = false) => ruleFor('Bash', { command }, isReadOnly)

test('normalizeCommand drops assignments, path prefixes and git global options', () => {
  expect(normalizeCommand('FOO=1 /usr/bin/git -C . -c a=b push origin x')).toEqual([['git', 'push', 'origin', 'x']])
  expect(normalizeCommand('git --git-dir=.git --work-tree=. status')).toEqual([['git', 'status']])
  expect(normalizeCommand('command git log')).toEqual([['git', 'log']])
  expect(normalizeCommand('env -i FOO=1 git log')).toEqual([['git', 'log']])
  expect(normalizeCommand('timeout 30 npm test')).toEqual([['npm', 'test']])
})

test('normalizeCommand splits at operators, newlines and substitutions', () => {
  expect(normalizeCommand('npm test && rm -rf dist')).toEqual([
    ['npm', 'test'],
    ['rm', '-rf', 'dist'],
  ])
  expect(normalizeCommand('a; b || c | d\ne')).toEqual([['a'], ['b'], ['c'], ['d'], ['e']])
  expect(normalizeCommand('echo $(git push --force) `date`')).toEqual([['echo'], ['git', 'push', '--force'], ['date']])
})

test('normalizeCommand drops quotes and keeps quoted operators inside the word', () => {
  expect(normalizeCommand("git 'push' origin x")).toEqual([['git', 'push', 'origin', 'x']])
  expect(normalizeCommand('echo "a && b"')).toEqual([['echo', 'a && b']])
  expect(normalizeCommand('g""it pu\\sh')).toEqual([['git', 'push']])
})

test('normalizeCommand reads a substitution inside double quotes as its own segment', () => {
  expect(normalizeCommand('echo "x $(git push --force)"')).toContainEqual(['git', 'push', '--force'])
})

test('ruleFor gives a read-only MCP tool its name', () => {
  expect(ruleFor('mcp__jira__getIssue', {}, true)).toBe('mcp__jira__getIssue')
  expect(ruleFor('mcp__jira__updateIssue', {}, false)).toBeUndefined()
  expect(ruleFor('mcp__ghe__updateFile', {}, false)).toBeUndefined()
})

test('ruleFor gives the read-only prefixes a wildcard rule', () => {
  expect(bash('gh pr checks 12 --watch')).toBe('Bash(gh pr checks *)')
  expect(bash('gh pr view 12')).toBe('Bash(gh pr view *)')
  expect(bash('gh pr list')).toBe('Bash(gh pr list *)')
  expect(bash('gh run view 7')).toBe('Bash(gh run view *)')
  expect(bash('gh run list')).toBe('Bash(gh run list *)')
  expect(bash('gh repo view')).toBe('Bash(gh repo view *)')
  expect(bash('git status')).toBe('Bash(git status *)')
  expect(bash('FOO=1 /usr/bin/git -C . status')).toBe('Bash(git status *)')
})

test('ruleFor gives git log, diff, show and ls-remote the exact command', () => {
  expect(bash('git log --oneline')).toBe('Bash(git log --oneline)')
  expect(bash('git diff HEAD~1')).toBe('Bash(git diff HEAD~1)')
  expect(bash('git show abc123')).toBe('Bash(git show abc123)')
  expect(bash('git ls-remote origin')).toBe('Bash(git ls-remote origin)')
  expect(bash('git log')).toBe('Bash(git log)')
  expect(bash('git -C . log')).toBeUndefined()
  expect(bash('git -c core.pager=x log')).toBeUndefined()
  expect(bash('GIT_EXTERNAL_DIFF=x git diff')).toBeUndefined()
  expect(bash('git log --format="%h"')).toBeUndefined()
})

test('ruleFor gives git log, diff, show and ls-remote no rule when an option writes or runs code', () => {
  for (const command of [
    'git ls-remote --upload-pack=x origin',
    'git ls-remote --upload-pack x origin',
    'git ls-remote -u x origin',
    'git ls-remote -ux origin',
    'git ls-remote --exec=x origin',
    'git diff --output=x',
    'git diff --output x',
    'git log --output=x',
    'git show --output=x abc',
    'git diff --ext-diff',
    'git log -p --ext-diff',
    'git diff --textconv',
    'git show --textconv abc:file',
    'git diff --outp=x',
    'git diff --ext',
    'git ls-remote --up=x origin',
  ]) {
    expect(bash(command)).toBeUndefined()
  }
  expect(bash('git diff --no-ext-diff --stat')).toBe('Bash(git diff --no-ext-diff --stat)')
  expect(bash('git log -u')).toBe('Bash(git log -u)')
  expect(bash('git status --output=x')).toBe('Bash(git status *)')
})

test('ruleFor gives a git command that reaches into another repository no rule', () => {
  for (const command of [
    'git -C ../other log',
    'git -C ../other status',
    'git --git-dir=../o/.git log',
    'git --git-dir=../o/.git status',
    'git --work-tree=../o status',
    'GIT_DIR=../o/.git git status',
    'GIT_DIR=../o/.git git log',
    'git -c core.pager=x status',
  ]) {
    expect(bash(command)).toBeUndefined()
  }
})

test('ruleFor gives interpreters and runners the exact command', () => {
  expect(bash('python3 -m unittest')).toBe('Bash(python3 -m unittest)')
  expect(bash('npm test')).toBe('Bash(npm test)')
  expect(bash('./gradlew build')).toBe('Bash(./gradlew build)')
  expect(bash('./mvnw -q verify')).toBe('Bash(./mvnw -q verify)')
  expect(bash('cargo test')).toBe('Bash(cargo test)')
  expect(bash('uv run pytest')).toBe('Bash(uv run pytest)')
})

test('ruleFor gives an interpreter command with quotes or a wildcard no rule', () => {
  expect(bash('python3 -c "print(1)"')).toBeUndefined()
  expect(bash("npm test 'a b'")).toBeUndefined()
  expect(bash('npm run *')).toBeUndefined()
})

test('ruleFor refuses what could write, delete, merge or reach out', () => {
  for (const command of [
    'git push -u origin sdd/ABC-1',
    'git -C . push',
    'gh pr merge 12',
    'gh pr review 12 --approve',
    'gh pr ready',
    'gh api /user',
    'gh repo delete x',
    'git reset --hard',
    'git branch -D x',
    'git checkout -- .',
    'git config x y',
    'rm -rf x',
    'sudo ls',
    'curl x',
    'npm test && rm -rf dist',
    'npm test; rm -rf dist',
    'npm test | tee out',
    'sh -c "x && y"',
    'git status > out.txt',
    'git log < in.txt',
    'git log $(whoami)',
    'git log `whoami`',
    'git log $HOME',
    'git status &',
    'time git status',
    'nice git log',
    'env -C . git status',
    'for b in x; do git status; done',
    '>/dev/null git status',
    '',
    '   ',
  ]) {
    expect(bash(command)).toBeUndefined()
  }
})

test('ruleFor gives other tools no rule', () => {
  expect(ruleFor('WebFetch', { url: 'https://x' }, true)).toBeUndefined()
  expect(ruleFor('Write', { file_path: '/a' }, false)).toBeUndefined()
  expect(ruleFor('Edit', { file_path: '/a' }, false)).toBeUndefined()
  expect(ruleFor('Bash', {}, false)).toBeUndefined()
  expect(ruleFor('Bash', null, false)).toBeUndefined()
})

test('describeRule says in words what a rule allows, by the kind ruleFor gave it', () => {
  // Read-only prefixes, as wildcards.
  expect(describeRule('Bash(git status *)')).toBe('Reads only; changes nothing. Allowed with any arguments.')
  expect(describeRule('Bash(gh pr view *)')).toBe('Reads only; changes nothing. Allowed with any arguments.')
  // Read-only Git, exact.
  expect(describeRule('Bash(git log --oneline)')).toBe('Reads only; changes nothing.')
  // Tools marked read-only.
  expect(describeRule('mcp__jira__getIssue')).toBe('Reads only; changes nothing.')
  // Runners.
  expect(describeRule('Bash(python3 -m unittest)')).toBe('Runs a project command (tests, build or a script); it can change files.')
  expect(describeRule('Bash(npm test)')).toBe('Runs a project command (tests, build or a script); it can change files.')
  expect(describeRule('Bash(./gradlew test)')).toBe('Runs a project command (tests, build or a script); it can change files.')
  expect(describeRule('Bash(python3 -m pytest tests)')).toBe('Runs a project command (tests, build or a script); it can change files.')
  expect(describeRule('Bash(go test ./...)')).toBe('Runs a project command (tests, build or a script); it can change files.')
  // Any other runner's command runs a program: npx fetches and runs a package, a script does what it does.
  for (const rule of [
    'Bash(npx eslint)',
    'Bash(python3 manage.py migrate)',
    'Bash(node scripts/seed.js)',
    'Bash(npm install left-pad)',
    'Bash(go run ./cmd/x)',
  ]) {
    expect(describeRule(rule), rule).toBe('Runs a program; it can change files.')
  }
})

test('ruleLabel names the command or the tool without Bash(...), a wildcard with an ellipsis', () => {
  expect(ruleLabel('Bash(python3 -m unittest)')).toBe('python3 -m unittest')
  expect(ruleLabel('Bash(git status *)')).toBe('git status …')
  expect(ruleLabel('mcp__jira__getIssue')).toBe('mcp__jira__getIssue')
  // Every rule ruleFor offers gets a label and a description of its own kind.
  for (const [command, kind] of [
    ['git status -s', 'Reads only'],
    ['git log --oneline', 'Reads only'],
    ['npm test', 'Runs a project command'],
    ['npx eslint', 'Runs a program'],
    ['gh pr checks 12', 'Reads only'],
  ] as const) {
    const rule = ruleFor('Bash', { command }, false) ?? ''
    expect(rule, command).not.toBe('')
    expect(ruleLabel(rule), command).not.toContain('Bash(')
    expect(describeRule(rule).startsWith(kind), command).toBe(true)
  }
})

test('shouldSuggest accepts only a person approving an ask with no ceiling, hook or setting', () => {
  const ok = { decision: 'ask', approver: 'person', tool_use_id: 'toolu_1' }
  expect(shouldSuggest(ok)).toBe(true)
  expect(shouldSuggest({ ...ok, decision: 'allow' })).toBe(false)
  expect(shouldSuggest({ ...ok, approver: 'classifier' })).toBe(false)
  expect(shouldSuggest({ decision: 'ask', approver: 'person' })).toBe(false)
  expect(shouldSuggest({ decision: 'ask', tool_use_id: 'toolu_1' })).toBe(false)
  expect(shouldSuggest({ ...ok, tool_use_id: '' })).toBe(false)
  expect(shouldSuggest({ ...ok, ceiling: 'deny' })).toBe(false)
  expect(shouldSuggest({ ...ok, hook: 'x' })).toBe(false)
  expect(shouldSuggest({ ...ok, setting: 'x' })).toBe(false)
})

test('mergeAllowRules merges into existing settings and keeps the rest', () => {
  const text = '{"permissions":{"allow":["Bash(npm test:*)"]},"model":"opus"}'
  const merged = mergeAllowRules(text, ['Bash(npm test *)', 'Bash(git log *)', 'Bash(git log:*)', 'mcp__jira__getIssue'])
  expect(merged).toEqual({
    text: '{\n  "permissions": {\n    "allow": [\n      "Bash(npm test:*)",\n      "Bash(git log *)",\n      "mcp__jira__getIssue"\n    ]\n  },\n  "model": "opus"\n}\n',
    added: ['Bash(git log *)', 'mcp__jira__getIssue'],
  })
})

test('mergeAllowRules writes the space form and adds nothing already there', () => {
  const merged = mergeAllowRules('{"permissions":{"allow":["Bash(git log *)"]}}', ['Bash(git log:*)'])
  expect(merged).toEqual({ text: '{\n  "permissions": {\n    "allow": [\n      "Bash(git log *)"\n    ]\n  }\n}\n', added: [] })
})

test('mergeAllowRules starts a fresh file from nothing or blank text', () => {
  const fresh = { text: '{\n  "permissions": {\n    "allow": [\n      "Bash(git log *)"\n    ]\n  }\n}\n', added: ['Bash(git log *)'] }
  expect(mergeAllowRules(undefined, ['Bash(git log:*)'])).toEqual(fresh)
  expect(mergeAllowRules('  \n', ['Bash(git log *)'])).toEqual(fresh)
  expect(mergeAllowRules('{"permissions":{}}', ['Bash(git log *)'])).toEqual(fresh)
})

test('mergeAllowRules refuses settings it cannot merge into', () => {
  for (const text of [
    '{ not json',
    'null',
    '[]',
    '"x"',
    '{"permissions":"x"}',
    '{"permissions":null}',
    '{"permissions":{"allow":"x"}}',
    '{"permissions":{"allow":[1]}}',
  ]) {
    const result = mergeAllowRules(text, ['Bash(git log *)'])
    expect('error' in result).toBe(true)
  }
})

test('ruleChoiceLabels keeps a plain command as its label and numbers one with a comma or a twin', () => {
  expect(ruleChoiceLabels(['Bash(python3 -m unittest)', 'Bash(git status *)'])).toEqual(['python3 -m unittest', 'git status …'])
  expect(ruleChoiceLabels(['Bash(a, b)', 'Bash(b)'])).toEqual(['Rule 1', 'b'])
  expect(ruleChoiceLabels(['Bash(x)', 'Bash(x)'])).toEqual(['Rule 1', 'Rule 2'])
  expect(ruleChoiceLabels(['Bash(Rule 2)', 'Bash(a,b)'])).toEqual(['Rule 1', 'Rule 2'])
})

test('pickedRules maps an answer to the rules picked, and to none when a part is no label', () => {
  const labels = ['python3 -m unittest', 'git status …', 'Rule 3']
  expect(pickedRules('python3 -m unittest', labels)).toEqual([0])
  expect(pickedRules('python3 -m unittest, Rule 3', labels)).toEqual([0, 2])
  expect(pickedRules('', labels)).toEqual([])
  expect(pickedRules('python3 -m unittest, rm -rf /', labels)).toEqual([])
  expect(pickedRules('python3 -m unittest, python3 -m unittest', labels)).toEqual([])
  expect(pickedRules('Not now', [...labels, 'Not now'])).toEqual([3])
})

test('pickedRules never picks a label that only shows inside another one', () => {
  const labels = ruleChoiceLabels(['Bash(x, y)', 'Bash(y)'])
  expect(pickedRules(`${labels[0]}`, labels)).toEqual([0])
  expect(pickedRules('x, y', labels)).toEqual([])
})

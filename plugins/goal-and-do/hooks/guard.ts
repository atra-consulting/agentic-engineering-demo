// What a tool call may do during a run. Anything that cannot be read with confidence is denied or left to the permission system.
import type { PhaseName } from '../types'
import { isTestRun } from './pane'
import { SHELLS, gitSubcommandAt, segmentsOf, type Segment } from './permissions'
import { expandBraces, fromRoot, globMatches, normalizedPath, reachFinding, type Finding, type ReachContext } from './reach'

export { isEnvFile } from './reach'

type Verdict = { verdict: 'pass' } | { verdict: 'push' } | { verdict: 'deny'; reason: string }

// root: the project root, absolute; '' when unknown. real: for an edit, where its target and the root land with every
// symbolic link followed, as the mod resolved them; path '' when the mod could not place the target. storeDirs: the
// mod's store folder, as spelled and where it lands; absent when the mod could not find it. home and xdgConfigHome: the
// mod's HOME and XDG_CONFIG_HOME, absolute; absent when unset. blocksTimers: the run is under way (not a refused one), so
// a timer is denied.
// plannedTools: the MCP tool names the approved plan.md names in planned-tools:. The ReachContext fields are the mod's
// listing of environment files and the approved plan's planned-paths, the run's base branch, and whether the call comes
// from the reviewer subagent.
interface Context extends ReachContext {
  active: boolean
  blocksTimers?: boolean
  id: string
  lockedPaths: string[]
  plannedTools?: string[]
  real?: { path: string; root: string }
  storeDirs?: string[]
  xdgConfigHome?: string
}

const PASS: Verdict = { verdict: 'pass' }

const deny = (reason: string): Verdict => ({ verdict: 'deny', reason })

export const REASONS = {
  pushPhase: (phase: PhaseName) => `goal-and-do allows git push only in the PR phase. This is the ${phase} phase.`,
  pushTarget: 'goal-and-do allows only git push [-u] origin sdd/<id> (or HEAD:sdd/<id>). Other targets, force, delete, mirror, all and tags are blocked.',
  pullRequest: 'goal-and-do blocks gh pr merge, gh pr ready and gh pr review. A person decides on the pull request.',
  apiWrite: 'goal-and-do blocks gh api calls that write (a method or fields).',
  noVerify: "goal-and-do blocks --no-verify. The project's hooks run on every commit.",
  githubMcp: 'goal-and-do blocks GitHub MCP tools during a run. The PR phase uses git and gh.',
  productionMcp: 'goal-and-do blocks production tools (mcp__dynatrace_prod__*) during a run.',
  tests: (path: string) => `goal-and-do blocks edits to the acceptance tests after Plan approval: ${path}.`,
  ci: 'goal-and-do blocks edits to CI files (.github/workflows/, Jenkinsfile*).',
  state: 'goal-and-do blocks edits to its run state and the settings files.',
  approvals: 'goal-and-do blocks edits to approvals.md. The mod writes it at each gate.',
  intentEdit: 'goal-and-do allows edits only in the change folder during the Intent phase.',
  intentMcp: 'goal-and-do allows only Jira reads during the Intent phase.',
  intentShell: 'goal-and-do allows only Git commands for the change folder during the Intent phase.',
  runFile: 'goal-and-do blocks edits to run.json. The mod writes it.',
  intentTool: 'goal-and-do allows only reading, the change folder, Git and Jira reads during the Intent phase.',
  unplaced: 'goal-and-do blocks an edit whose path it cannot follow: a symbolic link on it leads nowhere or cannot be read.',
  storeFile: 'goal-and-do blocks edits to its store. The mod writes it.',
  gitConfig: 'goal-and-do blocks Git settings for hooks, fsmonitor, diff and filter drivers, includes, remotes, URLs, credentials and ssh during a run.',
  gitDir: "goal-and-do blocks edits to Git's own config, attributes and hooks during a run.",
  timers: 'goal-and-do blocks timers during a run. Subagents and background tasks report back by themselves.',
  // A pattern is named as one that could match an environment file, not as the file itself. The text before the path and the final stop stay the
  // same, so reasonKeyOf finds both.
  envFile: (path: string) =>
    `goal-and-do blocks reading environment files (.env, .env.<suffix>); the .env.example copies are readable: ${path}${/[*?[{]/.test(path) ? ', a pattern that could match one' : ''}.`,
  credentialStore: (path: string) =>
    `goal-and-do blocks reading the account's credential stores (~/.netrc, ~/.m2/settings.xml, ~/.gradle/gradle.properties, ~/.npmrc, ~/.aws/credentials, ~/.ssh/, ~/.docker/config.json, ~/.claude.json, ~/.git-credentials, ~/.config/gh/hosts.yml, ~/.config/git/credentials): ${path}.`,
  // TEMPORARY EXCEPTION 1: a refused folder search is not in BLOCKING_REASONS, so the call is denied and the run goes on.
  folderSearch: (folder: string) =>
    `goal-and-do blocks a search, or a git diff, show or log patch, over a folder that might reach an environment file or a credential store. Exclude them (for example --exclude='.env*', or for Git -- . ':(exclude,glob)**/.env*') or name the files you need: ${folder}.`,
  tokenReveal:
    'goal-and-do blocks commands that reveal a token or the whole environment (gh auth token, --show-token, git credential, printenv, env, set, export -p, declare -p).',
  tokenPrint: (name: string) => `goal-and-do blocks printing a variable whose name matches *_PAT, *TOKEN* or *KEY*; print or edit it by hand: ${name}.`,
  steeringFile: (path: string) =>
    `goal-and-do blocks writes to steering files (.claude/, .mcp.json, CLAUDE.md, ~/.claude/settings.json, shell startup files) that the approved plan.md does not name in planned-paths: ${path}.`,
  reviewerClaudeMd: (command: string) => `goal-and-do has the reviewer read CLAUDE.md from the base branch, not the working tree: ${command}.`,
  outbound: (what: string) => `goal-and-do blocks tools that send data out during a run (WebFetch, WebSearch, fetch and browser tools): ${what}.`,
  mcpWrite: (tool: string) => `goal-and-do blocks MCP write tools that the approved plan.md does not name in planned-tools: ${tool}.`,
  envRedirect: 'goal-and-do blocks setting a variable that points git or gh at another host, proxy, CA file, config or token.',
  ghForm:
    'goal-and-do allows only gh pr create|view|edit|checks|list|status|diff, gh run view|list|watch, gh repo view, gh auth status and a GET gh api of a relative endpoint (with --paginate, --jq, --include) in the PR phase.',
}

// A call that sets a timer, whose prompt would start a turn of its own, even after the run ends: a wakeup or a cron job.
// Cancelling one (ScheduleWakeup with stop: true, CronDelete) only removes a timer, so it goes on.
function setsTimer(call: { tool: string; input: Record<string, unknown> }): boolean {
  if (call.tool === 'CronCreate') return true
  return call.tool === 'ScheduleWakeup' && call.input.stop !== true
}

export type ReasonKey = keyof typeof REASONS

// The reasons whose denial ends the run blocked: a named environment file or credential store, a steering file, an
// outbound address or tool, an MCP write tool the plan does not name. folderSearch stays out (TEMPORARY EXCEPTION 1).
export const BLOCKING_REASONS: ReadonlySet<ReasonKey> = new Set<ReasonKey>(['envFile', 'credentialStore', 'steeringFile', 'outbound', 'mcpWrite'])

// The key of a reason the guard gave, from its text: a fixed text by equality, a reason that names a phase or a path by
// the text around it. undefined for any other text.
export function reasonKeyOf(reason: string): ReasonKey | undefined {
  const MARK = '\u0000'
  for (const [key, value] of Object.entries(REASONS) as [ReasonKey, (typeof REASONS)[ReasonKey]][]) {
    if (typeof value === 'string') {
      if (value === reason) return key
      continue
    }
    const [before = '', after = ''] = value(MARK as PhaseName).split(MARK)
    if (reason.length > before.length + after.length && reason.startsWith(before) && reason.endsWith(after)) return key
  }
  return undefined
}

// The built-in tools the Intent phase may use; MCP tools there are Jira reads only.
const INTENT_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Glob',
  'Grep',
  'Bash',
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  'AskUserQuestion',
  'TodoWrite',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskUpdate',
  'Skill',
  'ToolSearch',
])

const API_WRITE = /^(-[XfF]|--(method|field|raw-field|input)(=|$))/

const SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json']

// Variables that make git run a program of its choosing or read its configuration from elsewhere.
const BLOCKED_GIT_ENV: ReadonlySet<string> = new Set([
  'HOME',
  'XDG_CONFIG_HOME',
  'PATH',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'GIT_EXEC_PATH',
  'GIT_ASKPASS',
  'GIT_PAGER',
  'GIT_EXTERNAL_DIFF',
  'GIT_PROXY_COMMAND',
  'GIT_EDITOR',
  'GIT_SEQUENCE_EDITOR',
])

// Bash

const EXPORTERS: ReadonlySet<string> = new Set(['export', 'declare', 'typeset', 'readonly', 'local'])

const INTERPRETERS = /^(?:python[\d.]*|node|perl|ruby)$/

// Variables that point git or gh at another host, token, config, proxy or CA file: set in a shell, they send later calls,
// and the token, elsewhere. One pattern for the export check and for a variable in front of gh.
const REDIRECT_ENV = /^(?:GH_|GITHUB_)|proxy$|^(?:SSL_CERT_(?:FILE|DIR)|CURL_CA_BUNDLE|REQUESTS_CA_BUNDLE|NODE_EXTRA_CA_CERTS)$/i

// gh's variables that only change its output: harmless in front of gh. A pager runs a command, so only cat passes.
const HARMLESS_GH_ENV: ReadonlySet<string> = new Set(['GH_NO_UPDATE_NOTIFIER', 'GH_PROMPT_DISABLED', 'GH_SPINNER_DISABLED'])
const PAGERS: ReadonlySet<string> = new Set(['GH_PAGER', 'PAGER'])

// Whether a variable, with its value when known, sends git or gh elsewhere.
function isRedirectEnv(name: string, value?: string): boolean {
  if (HARMLESS_GH_ENV.has(name)) return false
  if (PAGERS.has(name)) return value !== 'cat'
  return REDIRECT_ENV.test(name)
}

// Variables whose value, once exported, changes what a later git command runs or reads, or where git and gh send.
function isSensitiveEnv(name: string): boolean {
  return (
    name !== 'GIT_TERMINAL_PROMPT' &&
    (name.startsWith('GIT_') || (REDIRECT_ENV.test(name) && isRedirectEnv(name)) || name === 'HOME' || name === 'XDG_CONFIG_HOME' || name === 'PATH')
  )
}

// What an export sets: git's own variables (and HOME, PATH, a $ or backquote), 'git'; a variable that sends git or gh
// elsewhere, 'redirect'; undefined for neither.
function exportsSensitive(words: string[]): 'git' | 'redirect' | undefined {
  const command = words[0] ?? ''
  const args = words.slice(1)
  if (!EXPORTERS.has(command) || (command !== 'export' && !args.some(arg => /^-[a-zA-Z]*x/.test(arg)))) return undefined
  let kind: 'git' | 'redirect' | undefined
  for (const arg of args) {
    if (arg.startsWith('-')) continue
    const at = arg.indexOf('=')
    const name = at < 0 ? arg : arg.slice(0, at)
    const value = at < 0 ? undefined : arg.slice(at + 1)
    if (/[$`]/.test(arg) || (isSensitiveEnv(name) && !REDIRECT_ENV.test(name))) return 'git'
    if (isRedirectEnv(name, value) && REDIRECT_ENV.test(name)) kind = 'redirect'
  }
  return kind
}

function checkPush(segment: Segment, subAt: number, ctx: Context): Verdict {
  if (ctx.phase !== 'PR') return deny(REASONS.pushPhase(ctx.phase))
  if (subAt !== 1 || segment.gitOptions || segment.wrapped) return deny(REASONS.pushTarget)
  if (segment.env.some(name => name !== 'GIT_TERMINAL_PROMPT')) return deny(REASONS.pushTarget)
  let rest = segment.words.slice(2)
  if (rest[0] === '-u' || rest[0] === '--set-upstream') rest = rest.slice(1)
  const branch = `sdd/${ctx.id}`
  const [remote, ref] = rest
  if (rest.length === 2 && remote === 'origin' && (ref === branch || ref === `HEAD:${branch}`)) return { verdict: 'push' }
  return deny(REASONS.pushTarget)
}

// The one push the mod lets through, spelled exactly: git push [-u|--set-upstream] origin sdd/<id> or HEAD:sdd/<id>,
// plain words in one command, with nothing before or after. Its upstream option and refspec; undefined for any other
// command.
export interface PushArgs {
  upstream?: string
  ref: string
}

export function pushArgs(command: string, id: string): PushArgs | undefined {
  const branch = `sdd/${id}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const shape = new RegExp(`^\\s*git[ \\t]+push(?:[ \\t]+(-u|--set-upstream))?[ \\t]+origin[ \\t]+((?:HEAD:)?${branch})\\s*$`)
  const found = shape.exec(command)
  if (found === null) return undefined
  const [, upstream, ref = ''] = found
  return upstream === undefined ? { ref } : { upstream, ref }
}

// The tokens a test run does not get.
const TEST_UNSET: readonly string[] = ['JIRA_PAT', 'GH_TOKEN']

// The Bash call's command wrapped to run without the ticket-system and code-host tokens, when it runs the test command;
// the names in keep (the approved plan's test-env-keep line) stay. undefined for any other call, and when both are kept.
export function testRunCommand(command: string, testCommand: string, keep: string[] = []): string | undefined {
  if (isTestRun(command, testCommand) === 'none') return undefined
  const names = TEST_UNSET.filter(name => !keep.includes(name))
  return names.length === 0 ? undefined : `(unset ${names.join(' ')}; ${command})`
}

// A push URL the mod can hand to git as one word: text, not empty, with no control character and no leading dash.
export function isPushUrl(url: unknown): url is string {
  return typeof url === 'string' && url !== '' && !url.startsWith('-') && !/[\u0000-\u001f\u007f]/.test(url)
}

// The variables that would beat the forced settings or point git elsewhere; the push runs with them unset.
const PUSH_UNSET = [
  'GIT_SSH_COMMAND',
  'GIT_SSH',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_COUNT',
  'GIT_CONFIG_PARAMETERS',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_EXEC_PATH',
  'GIT_PROXY_COMMAND',
  'GIT_ASKPASS',
  'SSH_ASKPASS',
  // Redirect git's directories or objects, or write its traffic, credentials included, to a file. The proxy and
  // certificate variables stay: a push behind a company proxy needs them.
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_INDEX_FILE',
  'GIT_NAMESPACE',
  'GIT_SSH_VARIANT',
  'GIT_TEMPLATE_DIR',
  'GIT_CONFIG',
  'GIT_SSL_NO_VERIFY',
  'GIT_TRACE',
  'GIT_TRACE_CURL',
  'GIT_TRACE_PACKET',
  'GIT_TRACE2',
  'GIT_TRACE2_EVENT',
  'GIT_TRACE2_PERF',
  'GIT_CURL_VERBOSE',
]

const shellWord = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

// The allowed push with its settings forced: env through command, so no shell function or alias stands in for it, with
// the GIT_ variables that beat git's settings unset; git at the project root, so the shell's folder doesn't pick the
// repository; no hooks and no pre-push hook; plain ssh; and the push URL recorded at the run's start in origin's place,
// since a remote's push URLs add up and a planted one would get the push too. The root and the URL are each one
// shell-quoted word. A git binary another one replaces on PATH, the system config and a URL rewrite still reach it.
export function forcedPush(args: PushArgs, url: string, root: string): string {
  const unset = PUSH_UNSET.map(name => `-u ${name}`).join(' ')
  const upstream = args.upstream === undefined ? '' : `${args.upstream} `
  return `command env ${unset} git -C ${shellWord(root)} -c core.hooksPath=/dev/null -c core.sshCommand=ssh push --no-verify ${upstream}${shellWord(url)} ${args.ref}`
}

// Config keys that make git run a program the repository names (the fsmonitor, the hooks folder, diff and filter
// drivers, the ssh command, a credential helper) or send a push elsewhere (a remote's URLs, a URL rewrite).
const RUNNING_KEY =
  /^(?:core\.fsmonitor|core\.hookspath|core\.sshcommand|diff\..+|filter\..+|credential\..+|remote\..+\.(?:url|pushurl)|url\..+\.(?:insteadof|pushinsteadof))$/i

// Config keys that make git read more config from a file of its choosing.
const INCLUDE_KEY = /^(?:include|includeif)\..+$/i

const keyKind = (word: string): 'running' | 'include' | undefined => (RUNNING_KEY.test(word) ? 'running' : INCLUDE_KEY.test(word) ? 'include' : undefined)

// The options of git config that take the next word as their value, unless they carry it after =.
const CONFIG_VALUED: ReadonlySet<string> = new Set(['--comment', '-f', '--file', '--blob', '-t', '--type', '--default', '--value'])

const CONFIG_READS: ReadonlySet<string> = new Set(['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l', '--get-color', '--get-colorbool'])

const CONFIG_WRITES: ReadonlySet<string> = new Set(['--add', '--replace-all', '--unset', '--unset-all', '--rename-section', '--remove-section', '--edit', '-e'])

const CONFIG_FLAGS: ReadonlySet<string> = new Set([
  ...CONFIG_READS,
  ...CONFIG_WRITES,
  '--global',
  '--system',
  '--local',
  '--worktree',
  '--fixed-value',
  '--null',
  '-z',
  '--name-only',
  '--show-origin',
  '--show-scope',
  '--includes',
  '--no-includes',
  '--bool',
  '--int',
  '--bool-or-int',
  '--path',
  '--expiry-date',
  '--no-type',
  '--all',
])

const CONFIG_SUBCOMMANDS: ReadonlySet<string> = new Set(['set', 'unset', 'get', 'list', 'rename-section', 'remove-section', 'edit'])

// Which guarded key a git config call may write: a running key, an include key, or none. Renaming or removing a section
// writes the keys of both names; a name the guard can't read counts as a running key. The values of value-taking
// options are skipped. A read (--get, --list, get, list, or a key alone) writes none, but only when every option is
// known: with an option the guard doesn't know, any word that names a guarded key counts as written. An edit in an
// editor can write any key.
function configWrite(args: string[]): 'running' | 'include' | undefined {
  const positional: string[] = []
  let isSure = true
  let isRead = false
  let isWrite = false
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? ''
    if (word === '--') {
      positional.push(...args.slice(i + 1))
      break
    }
    if (!word.startsWith('-') || word === '-') {
      positional.push(word)
      continue
    }
    const name = word.split('=')[0] ?? ''
    if (CONFIG_VALUED.has(name)) {
      if (!word.includes('=')) i++
      continue
    }
    if (!CONFIG_FLAGS.has(name)) isSure = false
    if (CONFIG_READS.has(name)) isRead = true
    if (CONFIG_WRITES.has(name)) isWrite = true
  }
  const sub = CONFIG_SUBCOMMANDS.has(positional[0] ?? '') ? positional.shift() : undefined
  if (sub === 'edit' || args.includes('-e') || args.includes('--edit')) return 'running'
  const isRename = sub === 'rename-section' || args.includes('--rename-section')
  if (isRename || sub === 'remove-section' || args.includes('--remove-section')) {
    const isParsed = positional.length === (isRename ? 2 : 1) && positional.every(name => SECTION_NAME.test(name))
    if (!isSure || !isParsed) return 'running'
    const kinds = positional.map(sectionKind)
    return kinds.includes('include') ? 'include' : kinds.includes('running') ? 'running' : undefined
  }
  if (sub === 'get' || sub === 'list') isRead = true
  else if (sub !== undefined) isWrite = true
  else if (positional.length === 1) isRead = true
  if (isRead && !isWrite && isSure) return undefined
  const named = (isSure ? positional : args).flatMap(word => word.split('='))
  const kinds = [...named.map(keyKind), ...(isSure ? [] : args.map(sectionKind))]
  return kinds.includes('include') ? 'include' : kinds.find(kind => kind !== undefined)
}

// A section name git config can rename or remove: a plain section, with a subsection after its first dot.
const SECTION_NAME = /^[A-Za-z0-9-]+(?:\.[^\s'"$`\\]+)?$/

// Whether a section holds keys the guard protects: running keys (core, remote, url, credential, filter, diff) or
// include keys; a section's name is read in any case.
function sectionKind(name: string): 'running' | 'include' | undefined {
  const lower = name.toLowerCase()
  if (lower.startsWith('include')) return 'include'
  return /^(?:core|remote|url|filter|diff)(?:\.|$)|^credential/.test(lower) ? 'running' : undefined
}

// The options git submodule foreach takes before its command.
const FOREACH_OPTIONS: ReadonlySet<string> = new Set(['--recursive', '--quiet', '-q'])

// The first words of a foreach command that run a command of their own: shells, wrappers and interpreters, by the name
// after any folder.
const FOREACH_HIDERS = /^(?:sh|bash|zsh|dash|ksh|fish|env|eval|exec|command|xargs|python[\d.]*|node|perl|ruby)$/

// The git remote subcommands that change where a push goes.
const REMOTE_WRITES: ReadonlySet<string> = new Set(['set-url', 'add', 'rename', 'remove', 'rm'])

// The config a git clone or git submodule call sets with its own -c or --config (or any abbreviation git accepts of it,
// from --co), anywhere among its words, checked like git -c; and the command a git submodule foreach runs, checked as a shell command.
function checkNestedGit(sub: string, args: string[], ctx: Context): Verdict {
  const configs: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? ''
    const name = word.split('=')[0] ?? ''
    const isConfig = name.length >= '--co'.length && '--config'.startsWith(name)
    if (word === '-c' || (isConfig && name === word)) configs.push(args[++i] ?? '')
    else if (isConfig) configs.push(word.slice(name.length + 1))
    else if (/^-c./.test(word)) configs.push(word.slice(2))
  }
  const kinds = configs.map(config => keyKind(config.split('=')[0] ?? ''))
  if (kinds.includes('include')) return deny(REASONS.gitDir)
  if (kinds.includes('running') && ctx.phase !== 'Intent') return deny(REASONS.gitConfig)
  const at = args.indexOf('foreach')
  if (sub === 'submodule' && at >= 0) {
    let from = at + 1
    while (FOREACH_OPTIONS.has(args[from] ?? '')) from++
    // A shell, a wrapper or an interpreter first hides its own command, whose quotes the words no longer show.
    const first = args[from] ?? ''
    if (FOREACH_HIDERS.test(first.slice(first.lastIndexOf('/') + 1))) return deny(ctx.phase === 'PR' ? REASONS.pushTarget : REASONS.pushPhase(ctx.phase))
    const inner = checkBash(args.slice(from).join(' '), ctx)
    if (inner.verdict !== 'pass') return inner.verdict === 'push' ? deny(REASONS.pushTarget) : inner
  }
  return PASS
}

// Options that set config or point git at another repository, which the segment parser drops before the subcommand; a
// word after an option the guard doesn't know may still be one.
const GIT_REDIRECTS = /^(?:-c|-C|--config-env|--git-dir|--work-tree)(?:$|=)|^-[cC]./

// A git command whose subcommand is unsure, behind an option the guard doesn't know, is denied when any of its words
// names a guarded key, push, or a config or repository option.
function checkGit(segment: Segment, ctx: Context): Verdict {
  const { words } = segment
  if (segment.env.some(name => /^GIT_CONFIG(_|$)/.test(name))) return deny(REASONS.noVerify)
  if (segment.env.some(name => BLOCKED_GIT_ENV.has(name))) return deny(REASONS.pushTarget)
  const configKinds = segment.configs.map(config => keyKind(config.split('=')[0] ?? ''))
  if (configKinds.includes('include')) return deny(REASONS.gitDir)
  // Intent allows only bare git, without config, and keeps its own reasons.
  if (ctx.phase !== 'Intent' && configKinds.includes('running')) return deny(REASONS.gitConfig)
  if (segment.configs.length > 0) {
    const hooks = segment.configs.some(config => (config.split('=')[0] ?? '').toLowerCase().startsWith('core.hookspath'))
    return deny(hooks ? REASONS.noVerify : REASONS.pushTarget)
  }
  const { at: subAt, isSure } = gitSubcommandAt(words)
  const sub = words[subAt]
  if (!isSure) {
    const rest = words.slice(1)
    const kinds = rest.flatMap(word => word.split('=')).map(keyKind)
    if (kinds.includes('include')) return deny(REASONS.gitDir)
    if (kinds.includes('running') && ctx.phase !== 'Intent') return deny(REASONS.gitConfig)
    if (rest.includes('push')) return checkPush(segment, -1, ctx)
    if (rest.some(word => GIT_REDIRECTS.test(word))) return deny(REASONS.pushTarget)
  }
  if (sub === 'push') return checkPush(segment, subAt, ctx)
  const args = words.slice(subAt + 1)
  if (sub === 'clone' || sub === 'submodule') {
    const verdict = checkNestedGit(sub, args, ctx)
    if (verdict.verdict === 'deny') return verdict
  }
  if (sub === 'remote' && REMOTE_WRITES.has(args.find(word => !word.startsWith('-')) ?? '') && ctx.phase !== 'Intent') {
    return deny(REASONS.gitConfig)
  }
  const written = sub === 'config' ? configWrite(args) : undefined
  if (written === 'include') return deny(REASONS.gitDir)
  if (written === 'running' && ctx.phase !== 'Intent') return deny(REASONS.gitConfig)
  if (segment.xargs || segment.repoOptions) return deny(REASONS.pushTarget)
  const noVerify = words.includes('--no-verify') || (sub === 'commit' && words.slice(subAt + 1).some(word => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(word)))
  return noVerify ? deny(REASONS.noVerify) : PASS
}

const PR_PHASE_GH: Readonly<Record<string, readonly string[]>> = {
  pr: ['create', 'view', 'edit', 'checks', 'list', 'status', 'diff'],
  run: ['view', 'list', 'watch'],
  repo: ['view'],
}

const API_READ_FLAGS: ReadonlySet<string> = new Set(['--paginate', '--include', '-i'])
const API_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i
const JQ_ENV = /\benv\b|\$ENV\b|\$__loc__|\binput_filename\b|\$__prog_args/
const API_GRAPHQL = /^\/?graphql(?:[/?#]|$)/i

// gh api in the PR phase: a GET of one relative endpoint, with at most --paginate, --include|-i and --jq|-q <filter>. A method other than GET, a
// field and --input are writes; a URL, graphql, --hostname, a header and any other option are not allowed.
function checkPrApi(args: string[]): Verdict {
  for (const [i, word] of args.entries()) {
    if (!API_WRITE.test(word)) continue
    if (word !== '-X' && !word.startsWith('--method')) return deny(REASONS.apiWrite)
    const method = word.includes('=') ? word.slice(word.indexOf('=') + 1) : args[i + 1]
    if (!/^GET$/i.test(method ?? '')) return deny(REASONS.apiWrite)
  }
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? ''
    // A jq filter that reads the environment would print variables, tokens included, into the transcript.
    if (word.startsWith('--jq=') && JQ_ENV.test(word.slice('--jq='.length))) return deny(REASONS.ghForm)
    if (API_READ_FLAGS.has(word) || word.startsWith('--jq=') || word.startsWith('--method=')) continue
    if (word === '--jq' || word === '-q' || word === '-X' || word === '--method') {
      if (i + 1 >= args.length || ((word === '--jq' || word === '-q') && JQ_ENV.test(args[i + 1] ?? ''))) return deny(REASONS.ghForm)
      i++
    } else if (word.startsWith('-')) return deny(REASONS.ghForm)
    else positional.push(word)
  }
  const endpoint = positional[0] ?? ''
  if (positional.length !== 1 || API_URL.test(endpoint) || API_GRAPHQL.test(endpoint)) return deny(REASONS.ghForm)
  return PASS
}

// The value a segment's prefix gives a variable, from its raw words; undefined when the guard can't find it.
function prefixValue(raw: string[], name: string): string | undefined {
  const word = raw.find(one => one.startsWith(`${name}=`))
  return word === undefined ? undefined : word.slice(name.length + 1)
}

// A jq filter of any gh form (--jq, -q, --jq=) that reads the environment, which would print tokens into the transcript.
function readsEnvInJq(words: string[]): boolean {
  return words.some(
    (word, i) =>
      (word.startsWith('--jq=') && JQ_ENV.test(word.slice('--jq='.length))) || ((word === '--jq' || word === '-q') && JQ_ENV.test(words[i + 1] ?? ''))
  )
}

function checkGh(words: string[], ctx: Context, env: string[] = [], raw: string[] = words): Verdict {
  const positional: string[] = []
  let firstAt = -1
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? ''
    if (word === '-R' || word === '--repo') i++
    else if (!word.startsWith('-')) {
      if (positional.length === 0) firstAt = i
      positional.push(word)
    }
  }
  if (positional[0] === 'pr' && ['merge', 'ready', 'review'].includes(positional[1] ?? '')) return deny(REASONS.pullRequest)
  // In the PR phase, for every gh form: a word with a $ the guard can't see through, a jq filter that reads the environment,
  // and a variable in front that sends gh elsewhere are refused. gh auth status (alone) and a read-only gh api also pass.
  if (ctx.phase === 'PR') {
    if (words.slice(1).some(word => /[$`]/.test(word)) || readsEnvInJq(words)) return deny(REASONS.ghForm)
    if (env.some(name => isRedirectEnv(name, prefixValue(raw, name)))) return deny(REASONS.ghForm)
  }
  if (ctx.phase === 'PR' && positional[0] === 'api') return firstAt === 1 ? checkPrApi(words.slice(2)) : deny(REASONS.ghForm)
  if (ctx.phase === 'PR' && words.length === 3 && words[1] === 'auth' && words[2] === 'status') return PASS
  if (positional[0] === 'api' && words.some(word => API_WRITE.test(word))) return deny(REASONS.apiWrite)
  // In the PR phase only the forms the phase uses pass; every other form is refused.
  if (ctx.phase === 'PR' && !(PR_PHASE_GH[positional[0] ?? ''] ?? []).includes(positional[1] ?? '')) return deny(REASONS.ghForm)
  return PASS
}

function checkSegment(segment: Segment, ctx: Context): Verdict {
  const { words } = segment
  const command = words[0] ?? ''
  if (segment.unparseable) return deny(REASONS.pushTarget)
  if (segment.xargs && command === 'gh') return deny(REASONS.pullRequest)
  if (segment.xargs && (command === 'eval' || SHELLS.has(command) || INTERPRETERS.test(command))) return deny(REASONS.pushTarget)
  if (command === 'git') return checkGit(segment, ctx)
  if (command === 'gh') return checkGh(words, ctx, segment.env, segment.raw)
  if ((command === 'eval' || SHELLS.has(command)) && segment.env.some(isSensitiveEnv)) return deny(REASONS.pushTarget)
  if (command === 'eval') {
    const inner = checkBash(words.slice(1).join(' '), ctx)
    return inner.verdict === 'push' ? deny(REASONS.pushTarget) : inner
  }
  if (SHELLS.has(command)) {
    const at = words.findIndex(word => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word))
    const script = words[at + 1]
    if (at < 0 || script === undefined) return PASS
    const inner = checkBash(script, ctx)
    return inner.verdict === 'push' ? deny(REASONS.pushTarget) : inner
  }
  return PASS
}

function checkBash(command: string, ctx: Context): Verdict {
  const segments = segmentsOf(command, true)
  let push = false
  for (const segment of segments) {
    const assignsOnly = segment.words.length === 0 && segment.env.some(isSensitiveEnv)
    const exported = exportsSensitive(segment.words)
    if (exported === 'redirect') return deny(REASONS.envRedirect)
    if (assignsOnly || exported === 'git') return deny(REASONS.pushTarget)
  }
  for (const segment of segments) {
    const verdict = checkSegment(segment, ctx)
    if (verdict.verdict === 'deny') return verdict
    if (verdict.verdict === 'push') push = true
  }
  for (const segment of segments) {
    if (segment.raw.some(word => namesStore(word, ctx))) return deny(REASONS.storeFile)
    if (segment.raw.some(word => namesGitDir(word) || namesUserGitFile(word, ctx))) return deny(REASONS.gitDir)
    const named = runFileNamed(segment.raw, ctx.id)
    if (named !== undefined && !isGitRecord(segment) && !isPlainRead(segment)) {
      return deny(named === 'approvals.md' ? REASONS.approvals : REASONS.runFile)
    }
  }
  if (ctx.phase === 'Intent' && (!isPlainCommand(command) || !segments.every(segment => isIntentGit(segment, ctx)))) {
    return deny(REASONS.intentShell)
  }
  if (!push) return PASS
  return segments.length === 1 ? { verdict: 'push' } : deny(REASONS.pushTarget)
}

// The mod's own files in the change folder, by shell

const RUN_FILES = ['approvals.md', 'run.json'] as const

// Git commands that stage, commit or show a file and never write it.
const RECORDING_GIT: ReadonlySet<string> = new Set(['add', 'commit', 'diff', 'show', 'log', 'status'])

// Long options of the reading git commands that write a file or run a program, matched by any prefix git accepts.
const WRITING_GIT_OPTIONS: readonly string[] = ['--output', '--upload-pack', '--ext-diff', '--textconv', '--exec']

function isWritingOption(word: string): boolean {
  const name = word.split('=')[0] ?? ''
  return name.startsWith('--') && name.length > 2 && WRITING_GIT_OPTIONS.some(option => option.startsWith(name) || name.startsWith(option))
}

// The file of the change folder a segment names, as changes/<id>/<file>, through a redirection, an option's value, a
// revision, a path above the root, a pattern or braces.
function runFileNamed(words: string[], id: string): (typeof RUN_FILES)[number] | undefined {
  for (const word of words) {
    for (const candidate of expandBraces(word).flatMap(one => one.split(/[=:<>]/))) {
      const parts = normalizedPath(candidate).split('/').slice(-3)
      const [folder = '', change = '', file = ''] = parts
      if (parts.length < 3 || !globMatches(folder, 'changes') || (/[*?[]/.test(change) && !globMatches(change, id))) continue
      const named = RUN_FILES.find(name => globMatches(file, name))
      if (named !== undefined) return named
    }
  }
  return undefined
}

// Whether a path is in the mod's store folder: under one of ctx.storeDirs; or, with those unknown, or for a path the
// guard can't anchor (~, a variable, a path above its folder, an absolute one outside the project), any path with the
// parts plugins/store.
function isStorePath(path: string, ctx: Context): boolean {
  const file = normalizedPath(path).toLowerCase()
  const dirs = (ctx.storeDirs ?? []).map(dir => normalizedPath(dir).toLowerCase()).filter(dir => dir !== '' && dir !== '/')
  if (dirs.some(dir => file === dir || file.startsWith(`${dir}/`))) return true
  const parts = file.split('/')
  if (!parts.some((part, i) => part === 'plugins' && parts[i + 1] === 'store')) return false
  if (ctx.storeDirs === undefined) return true
  const isUnanchored = /^[~$]/.test(file) || file.includes('$') || file === '..' || file.startsWith('../')
  return isUnanchored || (file.startsWith('/') && fromRoot(file, ctx.root) === undefined)
}

// A shell word that names the store folder: one that holds a store folder anywhere (an interpreter's script, a longer
// quoted string), or the parts /plugins/store, or one whose path, through a redirection, an option's value or braces, is
// in the store.
function namesStore(word: string, ctx: Context): boolean {
  const lower = word.toLowerCase()
  const dirs = (ctx.storeDirs ?? []).map(dir => normalizedPath(dir).toLowerCase()).filter(dir => dir !== '' && dir !== '/')
  if (dirs.some(dir => lower.includes(dir)) || lower.includes('/plugins/store/') || lower.endsWith('/plugins/store')) return true
  return expandBraces(word)
    .flatMap(one => one.split(/[=:<>]/))
    .some(candidate => candidate !== '' && isStorePath(candidate, ctx))
}

function gitSubcommand(segment: Segment): { sub: string; args: string[] } | undefined {
  if (segment.words[0] !== 'git') return undefined
  let args = segment.words.slice(1)
  while (args[0] === '--no-pager' || args[0] === '-P') args = args.slice(1)
  const [sub = '', ...rest] = args
  return { sub, args: rest }
}

function isGitRecord(segment: Segment): boolean {
  const git = gitSubcommand(segment)
  return git !== undefined && RECORDING_GIT.has(git.sub) && !segment.xargs && !segment.words.some(word => /[<>]/.test(word) || isWritingOption(word))
}

// Commands that read the files they are given and write nothing, whatever their options. sed, awk and less stay out:
// a sed or awk program can write or run a command, and less runs a preprocessor LESSOPEN names.
const READING_COMMANDS: ReadonlySet<string> = new Set(['cat', 'head', 'tail', 'grep', 'wc'])

// An output redirection in a word, apart from a copy of one stream to another (2>&1) and a discard (2>/dev/null).
function redirectsOutput(word: string): boolean {
  return word.includes('>') && !/^\d?>&\d$/.test(word) && !/^\d?>\/dev\/null$/.test(word)
}

// A segment whose command only reads: cat, head, tail, grep or wc, with no output redirection.
function isPlainRead(segment: Segment): boolean {
  const [command = ''] = segment.words
  if (!READING_COMMANDS.has(command) || segment.xargs || segment.unparseable) return false
  return !segment.raw.some(redirectsOutput)
}

// Git's own folder: an edit tool may write nothing under a .git segment (a submodule's under .git/modules/ too) but the
// mod's own .git/goal-and-do/. The path is normalized first, so .git//config and .git/./info are the same files.
// Any file under a .git folder, except a file in the mod's own folder: .git/goal-and-do/, or in a worktree, where Git
// keeps it in the worktree's folder, .git/worktrees/<name>/goal-and-do/.
function isGitDirFile(file: string): boolean {
  const parts = file.split('/')
  return parts.some((part, i) => {
    if (part.toLowerCase() !== '.git') return false
    const at = parts[i + 1] === 'worktrees' && (parts[i + 2] ?? '') !== '' ? i + 3 : i + 1
    return !(parts[at] === 'goal-and-do' && at + 1 < parts.length)
  })
}

// In a shell word, a quoted script or an option's value included: .git/config (and config.worktree), .git/info/,
// .git/hooks/ and .git/modules/, in the repository or a worktree's folder under .git/worktrees/. Each path in the word
// is normalized first, so .git//modules and .git/goal-and-do/../config match too.
const GIT_DIR_PATH = /(?:^|\/)\.git\/(?:worktrees\/[^/]+\/)?(?:config(?:$|\.)|(?:info|hooks|modules)(?:$|\/))/i

function namesGitDir(word: string): boolean {
  return expandBraces(word)
    .flatMap(one => one.split(/[\s'"=:<>(),;]+/))
    .some(candidate => candidate !== '' && GIT_DIR_PATH.test(normalizedPath(candidate)))
}

// Git's config and attributes files of the user, in lower case: ~/.gitconfig, and git/config and git/attributes in the
// XDG config folder ($XDG_CONFIG_HOME) and in ~/.config, git's default for it; undefined when the home folder is unknown.
function userGitFiles(ctx: Context): string[] | undefined {
  const home = normalizedPath(ctx.home ?? '').toLowerCase()
  if (!home.startsWith('/') || home === '/') return undefined
  const xdg = normalizedPath(ctx.xdgConfigHome ?? '').toLowerCase()
  const configs = [`${home}/.config`, ...(xdg.startsWith('/') && xdg !== '/' ? [xdg] : [])]
  return [`${home}/.gitconfig`, ...configs.flatMap(config => [`${config}/git/config`, `${config}/git/attributes`])]
}

// A path to a user's Git config or attributes by its spelling alone.
const USER_GIT_FILE = /\/\.gitconfig$|(?:^|\/)\.config\/git\/(?:config|attributes)$/

const XDG_GIT_FILE = /^\$(?:\{xdg_config_home\}|xdg_config_home)\/git\/(?:config|attributes)$/

// Whether a path is one of the user's Git files: one of userGitFiles, read from root when relative; or, with those
// unknown, or for a path the guard can't anchor (~, a variable, a path outside the project), any path USER_GIT_FILE
// matches.
function isUserGitFile(path: string, ctx: Context, root = ctx.root): boolean {
  const file = normalizedPath(path).toLowerCase()
  if (XDG_GIT_FILE.test(file)) return true
  const base = normalizedPath(root).toLowerCase()
  const isUnanchored = /^[~$]/.test(file) || file.includes('$') || (!file.startsWith('/') && base === '')
  const absolute = file.startsWith('/') || isUnanchored ? file : normalizedPath(`${base}/${file}`)
  const files = userGitFiles(ctx)
  if (files?.includes(absolute)) return true
  if (!USER_GIT_FILE.test(absolute)) return false
  return files === undefined || isUnanchored || fromRoot(absolute, base) === undefined
}

function namesUserGitFile(word: string, ctx: Context): boolean {
  return expandBraces(word)
    .flatMap(one => one.split(/[\s'"=:<>(),;]+/))
    .some(candidate => candidate !== '' && isUserGitFile(candidate, ctx))
}

// The Intent phase's shell

// Whether a command has no redirection, no substitution or expansion ($, a backquote) and no open quote.
function isPlainCommand(command: string): boolean {
  let quote = ''
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i)
    if (quote === "'") {
      if (c === "'") quote = ''
    } else if (c === '\\') {
      i++
    } else if (c === '$' || c === '`') {
      return false
    } else if (quote === '"') {
      if (c === '"') quote = ''
    } else if (c === "'" || c === '"') {
      quote = c
    } else if (c === '<' || c === '>') {
      return false
    }
  }
  return quote === ''
}

// A path of the change folder, or the folder itself, from the project root; never a pattern or braces.
function isChangePath(path: string, ctx: Context): boolean {
  const file = fromRoot(path, ctx.root)
  return !/[*?[\]{}]/.test(path) && file !== undefined && (file === `changes/${ctx.id}` || file.startsWith(`changes/${ctx.id}/`))
}

const BRANCH_LISTING: ReadonlySet<string> = new Set(['--show-current', '-a', '--all', '-r', '--remotes', '-v', '-vv', '--verbose', '-l', '--list'])

function isBranchListing(args: string[]): boolean {
  const isList = args.includes('-l') || args.includes('--list')
  return args.every(word => BRANCH_LISTING.has(word) || (isList && !word.startsWith('-')))
}

function isBranchMove(sub: string, args: string[], ctx: Context): boolean {
  const branch = `sdd/${ctx.id}`
  const [first = '', second, third, ...more] = args
  const isStart = third !== undefined && !third.startsWith('-') && more.length === 0
  if (sub === 'switch') return (args.length === 1 && !first.startsWith('-')) || (first === '-c' && second === branch && isStart)
  return (args.length === 1 && first === branch) || (first === '-b' && second === branch && isStart)
}

function isChangeAdd(args: string[], ctx: Context): boolean {
  const paths: string[] = []
  let isPathsOnly = false
  for (const word of args) {
    if (!isPathsOnly && word === '--') isPathsOnly = true
    else if (!isPathsOnly && word.startsWith('-')) return false
    else paths.push(word)
  }
  return paths.length > 0 && paths.every(path => isChangePath(path, ctx))
}

// git commit with a message (-m, or -F from the change folder or .git/), of paths in the change folder only.
function isChangeCommit(args: string[], ctx: Context): boolean {
  const isMessageFile = (file: string | undefined) => {
    const at = file === undefined ? undefined : fromRoot(file, ctx.root)
    return at !== undefined && (isChangePath(file ?? '', ctx) || at.startsWith('.git/'))
  }
  const paths: string[] = []
  let hasMessage = false
  let isPathsOnly = false
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? ''
    if (isPathsOnly) {
      paths.push(word)
    } else if (word === '--') {
      isPathsOnly = true
    } else if (word === '-m' || word === '--message') {
      if (args[++i] === undefined) return false
      hasMessage = true
    } else if (word.startsWith('--message=') || /^-m./.test(word)) {
      hasMessage = true
    } else if (word === '-F' || word === '--file') {
      if (!isMessageFile(args[++i])) return false
      hasMessage = true
    } else if (word.startsWith('--file=') || /^-F./.test(word)) {
      if (!isMessageFile(word.startsWith('--file=') ? word.slice('--file='.length) : word.slice(2))) return false
      hasMessage = true
    } else if (word.startsWith('-')) {
      return false
    } else {
      paths.push(word)
    }
  }
  return hasMessage && paths.every(path => isChangePath(path, ctx))
}

// The Git commands Intent needs: read the state, fetch, create and switch to sdd/<id>, stage and commit the change folder.
// git stands first as written, by its bare name; only GIT_TERMINAL_PROMPT=<value> may stand before it.
function isIntentGit(segment: Segment, ctx: Context): boolean {
  const git = gitSubcommand(segment)
  const first = segment.raw.find(word => !word.startsWith('GIT_TERMINAL_PROMPT='))
  if (git === undefined || first !== 'git' || segment.gitOptions || segment.wrapped || segment.xargs || segment.repoOptions || segment.unparseable) {
    return false
  }
  if (segment.env.some(name => name !== 'GIT_TERMINAL_PROMPT')) return false
  const { sub, args } = git
  if (['status', 'log', 'diff', 'show', 'rev-parse', 'fetch'].includes(sub)) return !args.some(isWritingOption)
  if (sub === 'branch') return isBranchListing(args)
  if (sub === 'switch' || sub === 'checkout') return isBranchMove(sub, args, ctx)
  if (sub === 'add') return isChangeAdd(args, ctx)
  if (sub === 'commit') return isChangeCommit(args, ctx)
  return false
}

// MCP tools

function isGithubServer(server: string): boolean {
  const lower = server.toLowerCase()
  return lower.includes('github') || lower.split(/[_-]/).some(token => token === 'github' || token === 'ghe' || token === 'gh')
}

// Verbs that make a tool write, as the start of any word of its name after the read word.
const JIRA_WRITES: readonly string[] = [
  'create',
  'update',
  'delete',
  'add',
  'transition',
  'assign',
  'edit',
  'set',
  'post',
  'put',
  'remove',
  'upload',
  'link',
  'write',
  'comment',
  'move',
  'close',
  'log',
  'resolve',
  'clone',
  'archive',
  'reopen',
]

// A word that starts with a write verb writes, unless it is the verb plus s, plus ed, or plus d after a final e: a noun
// or a past form, which names what a read lists (getComments, getClosedIssues, getIssueTransitions).
function isWriteWord(word: string): boolean {
  return JIRA_WRITES.some(verb => {
    if (!word.startsWith(verb)) return false
    const rest = word.slice(verb.length)
    return !(rest === 's' || rest === 'ed' || (rest === 'd' && verb.endsWith('e')))
  })
}

// The words of a camelCase or snake_case name, in lower case.
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word !== '')
}

// A read on a Jira server (its name holds jira or atlassian): getX, searchX or readX in camelCase, jira_get_x or
// jira_search in snake_case; never a Confluence tool, and no write verb after the read word.
export function isJiraRead(tool: string): boolean {
  const [prefix, server = '', ...rest] = tool.split('__')
  const name = rest.join('__')
  if (prefix !== 'mcp' || !/jira|atlassian/i.test(server) || /confluence/i.test(name)) return false
  const words = wordsOf(name)
  const isSnake = words[0] === 'jira'
  const verb = words[isSnake ? 1 : 0] ?? ''
  const after = words.slice(isSnake ? 2 : 1)
  const isRead = isSnake ? (verb === 'get' && after.length > 0) || verb === 'search' : ['get', 'search', 'read'].includes(verb)
  return isRead && !after.some(isWriteWord)
}

const isMcpTool = (tool: string): boolean => tool.startsWith('mcp__')

// The context7 documentation tools. TEMPORARY EXCEPTION 2: they pass in Spec, Plan and Build.
export function isDocLookupTool(tool: string): boolean {
  return isMcpTool(tool) && (tool.split('__')[1] ?? '').toLowerCase().includes('context7')
}

const BROWSER_SERVER = /playwright|puppeteer|selenium|browser|fetch|firecrawl/i

const BROWSER_WORDS: readonly string[] = ['fetch', 'browse', 'navigate', 'crawl', 'scrape']

// WebFetch, WebSearch and the tools of a fetch or browser server; the Jira, Jenkins and Confluence tools and the
// documentation lookups are none.
export function isOutboundTool(tool: string): boolean {
  if (tool === 'WebFetch' || tool === 'WebSearch') return true
  if (!isMcpTool(tool) || isDocLookupTool(tool)) return false
  const [, server = '', ...name] = tool.split('__')
  return BROWSER_SERVER.test(server) || wordsOf(name.join('__')).some(word => BROWSER_WORDS.some(verb => word.startsWith(verb)))
}

// Tools whose first word reads, whatever else the name holds (getBuildLog, executeLogsQuery).
const MCP_READ_VERBS: ReadonlySet<string> = new Set([
  'get',
  'search',
  'read',
  'list',
  'find',
  'query',
  'describe',
  'show',
  'test',
  'help',
  'analyze',
  'execute',
])

// Verbs of MCP write tools that JIRA_WRITES does not hold.
const MCP_MORE_WRITES: readonly string[] = [
  'record',
  'send',
  'publish',
  'submit',
  'trigger',
  'start',
  'stop',
  'cancel',
  'kill',
  'rebuild',
  'abort',
  'save',
  'mark',
  'request',
  'merge',
  'approve',
  'reject',
]

// An MCP tool that writes: its first word is no read verb and some word of its name is a write verb.
export function isMcpWrite(tool: string): boolean {
  if (!isMcpTool(tool)) return false
  const [, , ...name] = tool.split('__')
  let words = wordsOf(name.join('__'))
  if (words[0] === 'jira' || words[0] === 'confluence') words = words.slice(1)
  const [first = '', second] = words
  if (MCP_READ_VERBS.has(first) || (first === 'resolve' && second === 'entity')) return false
  return words.some(word => isWriteWord(word) || MCP_MORE_WRITES.includes(word))
}

// An address as scheme, host and path only: no query string, no fragment, no user:password@.
function plainAddress(url: unknown): string | undefined {
  if (typeof url !== 'string' || url === '') return undefined
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return (url.split(/[?#]/)[0] ?? '').replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1')
  }
}

// What the blocked message names for an outbound call: the address, the search query cut to 80 characters, or the tool.
function outboundTarget(call: { tool: string; input: Record<string, unknown> }): string {
  if (call.tool === 'WebSearch' && typeof call.input.query === 'string') return `WebSearch ${call.input.query.slice(0, 80)}`
  return plainAddress(call.input.url) ?? call.tool
}

const DOC_PHASES: ReadonlySet<PhaseName> = new Set<PhaseName>(['Spec', 'Plan', 'Build'])

// From Spec on: outbound tools are refused, documentation lookups pass in Spec, Plan and Build (TEMPORARY EXCEPTION 2),
// and an MCP write tool passes only when the approved plan names it.
function checkOutbound(call: { tool: string; input: Record<string, unknown> }, ctx: Context): Verdict {
  if (ctx.phase === 'Intent') return PASS
  const { tool } = call
  if (isDocLookupTool(tool)) return DOC_PHASES.has(ctx.phase) ? PASS : deny(REASONS.outbound(tool))
  if (isOutboundTool(tool)) return deny(REASONS.outbound(outboundTarget(call)))
  if (isMcpWrite(tool) && !(ctx.plannedTools ?? []).includes(tool)) return deny(REASONS.mcpWrite(tool))
  return PASS
}

function checkMcp(tool: string, ctx: Context): Verdict {
  const [, server = '', ...name] = tool.split('__')
  if (/merge/i.test(name.join('__'))) return deny(REASONS.pullRequest)
  if (isGithubServer(server)) return deny(REASONS.githubMcp)
  if (server === 'dynatrace_prod') return deny(REASONS.productionMcp)
  if (ctx.phase === 'Intent' && !isJiraRead(tool)) return deny(REASONS.intentMcp)
  return PASS
}

// File edits

// A path is the file itself or a folder holding it, at any depth. Paths are compared in lower case.
function isUnderPath(path: string, relative: string): boolean {
  return relative !== '' && (path === relative || path.endsWith(`/${relative}`) || path.startsWith(`${relative}/`) || path.includes(`/${relative}/`))
}

// The rules for a file in every phase: the mod's store, Git's own files and the user's Git config and attributes, the
// locked tests, CI files, the run state and settings, approvals.md.
// root: the project root the path is read from, for the git folder rule: a .git folder above the root is none of the
// project's.
function checkFile(path: string, ctx: Context, root = ctx.root): Verdict {
  if (isStorePath(path, ctx)) return deny(REASONS.storeFile)
  const file = normalizedPath(path).toLowerCase()
  if (isGitDirFile((fromRoot(path, root) ?? normalizedPath(path)).toLowerCase())) return deny(REASONS.gitDir)
  if (isUserGitFile(path, ctx, root)) return deny(REASONS.gitDir)
  const locked = ctx.lockedPaths.find(rel => isUnderPath(file, normalizedPath(rel).toLowerCase()))
  if (locked !== undefined) return deny(REASONS.tests(locked))
  const basename = file.slice(file.lastIndexOf('/') + 1)
  if (basename.startsWith('jenkinsfile') || file.includes('/.github/workflows/') || file.startsWith('.github/workflows/')) {
    return deny(REASONS.ci)
  }
  if (SETTINGS_FILES.some(rel => isUnderPath(file, rel)) || /(^|\/)changes\/.+\/run\.json$/.test(file)) {
    return deny(REASONS.state)
  }
  if (/(^|\/)changes\/[^/]+\/approvals\.md$/.test(file)) return deny(REASONS.approvals)
  return PASS
}

// An edit is judged as spelled and where it lands. In Intent both must be absolute paths in the change folder. One the
// mod could not place is denied in every phase, since it may land on any file the rules protect.
function checkEdit(path: string, ctx: Context): Verdict {
  const spelledAndReal: [string, string][] = [
    [path, ctx.root],
    [ctx.real?.path ?? '', ctx.real?.root ?? ctx.root],
  ]
  for (const [file, root] of spelledAndReal) {
    const verdict = file === '' ? PASS : checkFile(file, ctx, root)
    if (verdict.verdict === 'deny') return verdict
  }
  const isInside = (file: string, root: string) => file.startsWith('/') && root !== '' && (fromRoot(file, root) ?? '').startsWith(`changes/${ctx.id}/`)
  const real = ctx.real
  if (ctx.phase === 'Intent' && !isInside(path, ctx.root)) return deny(REASONS.intentEdit)
  if (real?.path === '') return deny(REASONS.unplaced)
  if (ctx.phase !== 'Intent') return PASS
  return real !== undefined && isInside(real.path, real.root) ? PASS : deny(REASONS.intentEdit)
}

// The file an edit tool writes, as the call names it.
export function editTarget(call: { tool: string; input: Record<string, unknown> }): string | undefined {
  if (!['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(call.tool)) return undefined
  const path = call.input[call.tool === 'NotebookEdit' ? 'notebook_path' : 'file_path']
  return typeof path === 'string' ? path : undefined
}

// The reason Claude reads for a finding of the reach rules.
function reasonOf(finding: Finding): string {
  const reason = REASONS[finding.key]
  return typeof reason === 'string' ? reason : reason(finding.arg ?? '')
}

// A call is judged by every rule that applies to it, and the first deny wins: the timers, the Intent tool list, the edit
// rules for its target, the shell rules for a command any built-in tool carries (Bash, Monitor), the MCP rules. Only Bash
// pushes.
export function guard(call: { tool: string; input: Record<string, unknown> }, ctx: Context): Verdict {
  if (!ctx.active) return PASS
  if (ctx.blocksTimers === true && setsTimer(call)) return deny(REASONS.timers)
  const isMcp = call.tool.startsWith('mcp__')
  if (ctx.phase === 'Intent' && !isMcp && !INTENT_TOOLS.has(call.tool)) return deny(REASONS.intentTool)
  const path = editTarget(call)
  const finding = reachFinding(call, ctx, ctx.real)
  if (finding !== undefined) {
    // The mod's store keeps its own reason when an edit hits both rules.
    const own = path === undefined ? PASS : checkEdit(path, ctx)
    return own.verdict === 'deny' && reasonKeyOf(own.reason) === 'storeFile' ? own : deny(reasonOf(finding))
  }
  const command = call.input.command
  const verdicts = [
    path === undefined ? PASS : checkEdit(path, ctx),
    isMcp || typeof command !== 'string' ? PASS : checkBash(command, ctx),
    isMcp ? checkMcp(call.tool, ctx) : PASS,
    checkOutbound(call, ctx),
  ]
  const denied = verdicts.find(verdict => verdict.verdict === 'deny')
  if (denied !== undefined) return denied
  if (!verdicts.some(verdict => verdict.verdict === 'push')) return PASS
  return call.tool === 'Bash' ? { verdict: 'push' } : deny(REASONS.pushTarget)
}

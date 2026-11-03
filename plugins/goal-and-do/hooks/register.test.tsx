import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, ProcessRunResult, RenderSurface } from 'claude-code'
import type { Approval, DeniedCall, LevelChange, PhaseName, Run } from '../types'
import { REASONS } from './guard'
import { LEVEL_NOTICE } from './level'
import { footprint, lastChangedLines } from './pane'
import { FILES, PHASES, TEXTS, TURN_CAPS, changeIdFrom, goalFor, newRun } from './phases'
import { USAGE_FOOTER, addTurn, formatUsage } from './usage'

// Every test stands in for the engine beneath the plugin: files, git and gh, the dialogs, the
// /goal and /clear commands, the evaluator, the state store and the clock.

const NOW = Date.UTC(2026, 9, 29, 18, 5)
const phaseAt = (name: PhaseName) => PHASES.indexOf(name)
const ID = 'ABC-43224'
// The pane's header: the run's ID, folded, with what the person asked for under it.
const HEAD = `► ${ID}`
const URL_INPUT = 'https://jira.example.com/browse/ABC-43224'
const HOST = 'github.example.com'
const ENV = { claudeCode: '2.1.314', plugin: '0.1.0', provider: 'anthropic', permissionMode: 'acceptEdits' }
const PERSON = { kind: 'composer' } as const
const OTHER = { kind: 'plugin', name: 'other-mod' } as const
const PRESENTATION = { isFullscreen: true, columns: 160 }
const SURFACES = ['terminal', 'desktop'] as const
const COLUMNS = [60, 120]
const JIRA = ['mcp__jira__getIssue']
const LOCK = { lockedAt: '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345', lockedFiles: { 'tests/acceptance/a.test.ts': 'x' }, testPaths: ['tests/acceptance'] }
const USAGE = {
  model: 'claude-sonnet-5-5',
  input_tokens: 10,
  output_tokens: 200,
  cache_read_input_tokens: 3000,
  cache_creation_input_tokens: 40,
}

const INTENT_DONE = '---\nphase: intent\nstatus: done\n---\n'
// INTENT_DONE as approved, with the count of its open questions the mod writes in.
const INTENT_APPROVED = '---\nphase: intent\nstatus: done\nopen-at-approval: 0\n---\n'
const INTENT_SHA = '483d52c26e223f57c4c387760e743fb0f6327dba0238719e65f7c0b92f666ef6'
const SPEC_DONE = '---\nphase: spec\nstatus: done\n---\n\n# Spec\n'
const SPEC_SHA = '357d26ea1a5cc057c23a96f7fd4cfc0b4e354282c4847d17294ce0522d790486'
const PLAN_DONE = '---\nphase: plan\nstatus: done\ntest-paths: tests/acceptance\n---\n\n# Plan\n'
const PLAN_SHA = 'dc1589c59bbfaf13a392c85f1326236323f367b5c5e39c01b2fef90b0c055d85'
const TEST_FILE = 'test("AC-1", () => {})\n'
const TEST_SHA = 'd6f2bb9043edb027ed98c73a0ce2bdf95e5e35f2948becbb98da7d643ee081b5'

const PLAN_APPROVAL = { phase: 'Plan' as const, file: `changes/ABC-2/plan.md`, sha256: PLAN_SHA, at: NOW, lockedAt: LOCK.lockedAt }

const GATE_SHAS = { Intent: INTENT_SHA, Spec: SPEC_SHA, Plan: PLAN_SHA } as const

// The approval rows of a run at a phase: one for each gate before it, Plan's with its lock.
function approvalsTo(phase: PhaseName, id = 'ABC-2'): Approval[] {
  return (['Intent', 'Spec', 'Plan'] as const)
    .filter(gate => PHASES.indexOf(gate) < PHASES.indexOf(phase))
    .map(gate => ({
      phase: gate,
      file: `changes/${id}/${FILES[gate]}`,
      sha256: GATE_SHAS[gate],
      at: NOW,
      ...(gate === 'Plan' ? { lockedAt: LOCK.lockedAt } : {}),
    }))
}

// The mod's record of a run's approvals in its store: each row with who approved it and its note, and the last gate
// a person approved past.
function recordOf(approvals: Approval[]) {
  const past = approvals.filter(row => row.kind !== 'relock').map(row => PHASES.indexOf(row.phase))
  return {
    approvedPast: Math.max(-1, ...past),
    rows: approvals.map(row => ({ ...row, by: 'the person who approved', ...(row.kind === 'relock' ? { note: 'tests re-locked' } : {}) })),
  }
}

const APPROVALS_HEADER = '# Approvals\n\n| Phase | File | SHA-256 | Approved by | Time | locked-at |\n| --- | --- | --- | --- | --- | --- |\n'

// approvals.md as the mod writes it from that record.
function approvalsText(approvals: Approval[]): string {
  const line = (row: Approval) => {
    const file = row.kind === 'relock' ? `${row.file} (tests re-locked)` : row.file
    return `| ${row.phase} | ${file} | ${row.sha256} | the person who approved | ${new Date(row.at).toISOString()} | ${row.lockedAt ?? ''} |\n`
  }
  return APPROVALS_HEADER + approvals.map(line).join('')
}

// A setup whose runs, in the atom and in run.json, have the mod's record of their approvals, and approvals.md as the
// mod writes it.
function withRecord(setup: Setup): Setup {
  const fromFiles = Object.entries(setup.files ?? {})
    .filter(([path]) => /^changes\/[^/]+\/run\.json$/.test(path))
    .flatMap(([, text]) => {
      try {
        return [JSON.parse(text) as Run]
      } catch {
        return []
      }
    })
  const store: Record<string, unknown> = { ...setup.store }
  const files: Record<string, string> = { ...setup.files }
  for (const run of [...(setup.run ? [setup.run] : []), ...fromFiles]) {
    store[`approvals:${run.id}`] = recordOf(run.approvals)
    files[`changes/${run.id}/approvals.md`] ??= approvalsText(run.approvals)
  }
  return { ...setup, store, files }
}

const FORGED = (id: string) =>
  `run.json for ${id} differs from the mod's record. The run is blocked, and the guard stays on. Type \`/goal-and-do stop\`, then start over, or \`rm -r changes/${id}\` and \`git branch -D sdd/${id}\`.`
const EARLIER =
  'This run started before the six-phase update. It is blocked, and the guard stays on. Type `/goal-and-do stop`, or install `f7c67dd` to finish it.'
const APPROVALS_DIFFER = "goal-and-do blocks the push: approvals.md differs from the mod's record."
// The push dialog's signals before the mod has read the changed files.
// The rows that end in a turn bar; the pane draws none, since the band shows the turns.
const barRows = (rows: readonly string[]) => rows.filter(row => /[█░]{10}$/.test(row))

const NO_SIGNALS = 'Outside the plan: unknown. Sensitive: unknown. Denials: 0.'
// What the push dialog adds when the branch can't be read and the scanner is not approved.
const NO_WEAKENING = ' Test-weakening signals and counts: not scanned (the branch could not be read). Nothing is blocked. Scanner (gitleaks): not scanned'

function base64Of(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

// The SHA-256 the mod gives a hook's content: over its bytes as base64.
async function hookShaOf(content: string | number[]): Promise<string> {
  return shaOf(base64Of(typeof content === 'string' ? [...new TextEncoder().encode(content)] : content))
}

async function shaOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const done = (phase: string) => `---\nphase: ${phase}\nstatus: done\n---\n`
const draft = (phase: string) => `---\nphase: ${phase}\nstatus: draft\n---\n`

// A git call as the mod makes it: the options that keep git from running a program the repository names, then its
// arguments; a diff also leaves out external diff and textconv drivers, and a diff or a status doesn't look inside a
// submodule's working tree.
const GIT_SAFE = 'git -c core.fsmonitor=false -c core.untrackedCache=false -c diff.external= --no-pager'
// A diff or a status reads the working tree: each filter the repository defines (local or worktree scope) runs no
// program there (filtered: those names).
const gitArgs = (args: string, filtered: string[]) => {
  const readsTree = /^(diff|status)(?= |$)/.test(args)
  const neutral = readsTree
    ? filtered.map(name => ` -c filter.${name}.clean= -c filter.${name}.smudge= -c filter.${name}.process= -c filter.${name}.required=false`).join('')
    : ''
  const tree = args
    .replace(/^diff(?= |$)/, 'diff --no-ext-diff --no-textconv --ignore-submodules=dirty')
    .replace(/^status(?= |$)/, 'status --ignore-submodules=dirty')
  return `${GIT_SAFE}${neutral} ${tree}`
}
const g = (args: string) => gitArgs(args, [])
const gF = (args: string, filtered: string[]) => gitArgs(args, filtered)
// The read of the filters before each diff or status.
const FILTER_READ = g('config --show-scope -z --get-regexp ^filter\\.')
// The read of Git's settings for the run's fingerprint: every config entry at every scope git reads; then where git
// keeps the hooks folder and info/attributes, and which hooks run.
const SETTINGS_READ = g('config --show-scope -z --list')
const SETTINGS_PATHS = g('rev-parse --git-path hooks --git-path info/attributes')
const HOOKS_RUN = 'find -L /repo/.git/hooks -maxdepth 1 -type f -perm -100 -print0'
// The read of origin's push URL at the run's start, and the URL it gives.
const PUSH_URL_READ = g('remote get-url --push origin')
const PUSH_URL = `https://${HOST}/example/demo.git`
// The fingerprint with no config entry, no info/attributes, no global attributes and no hooks: the SHA-256 of
// {"config":[],"attributes":"none","globalAttributes":"none","hooks":[]}.
const NO_SETTINGS = '1b84a4770bc4dff6d5b46fd60d8395c88e600ecdf9630a8e1307f077fb5d5cf3'
// The mod's store record of a run's Git settings: the fingerprint, and origin's push URL as the start read it (null for
// none).
const settingsRecord = (fingerprint: string, pushUrl: string | null = PUSH_URL) => ({ fingerprint, ...(pushUrl === null ? {} : { pushUrl }) })
const GIT_SETTINGS_CHANGED = "goal-and-do blocks the run: Git's config, hooks or attributes changed since the run started."
const PUSH_URL_MISSING = 'goal-and-do blocks the push: it has no recorded push URL for origin.'
// The allowed push as the mod hands it on: env with the GIT_ variables that beat its settings unset, git at the project
// root, no hooks, plain ssh, and the recorded push URL in origin's place.
const PUSH_ENV =
  'command env -u GIT_SSH_COMMAND -u GIT_SSH -u GIT_CONFIG_GLOBAL -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS -u GIT_DIR -u GIT_WORK_TREE -u GIT_EXEC_PATH -u GIT_PROXY_COMMAND -u GIT_ASKPASS -u SSH_ASKPASS -u GIT_COMMON_DIR -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES -u GIT_INDEX_FILE -u GIT_NAMESPACE -u GIT_SSH_VARIANT -u GIT_TEMPLATE_DIR -u GIT_CONFIG -u GIT_SSL_NO_VERIFY -u GIT_TRACE -u GIT_TRACE_CURL -u GIT_TRACE_PACKET -u GIT_TRACE2 -u GIT_TRACE2_EVENT -u GIT_TRACE2_PERF -u GIT_CURL_VERBOSE'
const forcedPush = (args: string, url = PUSH_URL) =>
  `${PUSH_ENV} git -C '/repo' -c core.hooksPath=/dev/null -c core.sshCommand=ssh push --no-verify ${args.replace(/\borigin\b/, `'${url}'`)}`
const PUSH_SETTINGS_CHANGED = "goal-and-do: Git's settings changed during the push; check the pushed branch."
// What git config --list answers for these entries, each [scope, key, value].
function settingsAnswer(entries: [string, string, string][]): [number, string] {
  return [0, entries.map(([scope, key, value]) => `${scope}\0${key}\n${value}\0`).join('')]
}

const GIT: Record<string, [number, string]> = {
  [g('symbolic-ref --short refs/remotes/origin/HEAD')]: [0, 'origin/main\n'],
  [g('rev-parse --show-prefix')]: [0, '\n'],
  [g('branch --show-current')]: [0, 'main\n'],
  [g('status --porcelain -z --untracked-files=all')]: [0, ''],
  [g('remote get-url origin')]: [0, `https://${HOST}/example/demo.git\n`],
  [`gh auth status --hostname ${HOST}`]: [0, ''],
  [g('rev-parse HEAD')]: [0, '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345\n'],
  [g(`rev-parse --verify --quiet refs/heads/sdd/${ID}`)]: [0, '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345\n'],
  [g('ls-files -- tests/acceptance')]: [0, 'tests/acceptance/a.test.ts\n'],
  [g('status --porcelain -- tests/acceptance')]: [0, ''],
  [g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 HEAD -- tests/acceptance')]: [0, ''],
  [g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance')]: [0, ''],
  [g('ls-files --others --exclude-standard -- tests/acceptance')]: [0, ''],
  [g('check-ignore -q .claude/settings.local.json')]: [1, ''],
  [g('rev-parse --git-path info/exclude')]: [0, '.git/info/exclude\n'],
  [SETTINGS_READ]: [0, ''],
  [SETTINGS_PATHS]: [0, '.git/hooks\n.git/info/attributes\n'],
  [PUSH_URL_READ]: [0, `${PUSH_URL}\n`],
}

interface Ask {
  question: string
  options: string[]
  header: string
  multiSelect: boolean
}

interface Setup {
  files?: Record<string, string>
  git?: Record<string, [number, string]>
  tools?: string[]
  policy?: Record<string, unknown>
  version?: string
  run?: Run
  answers?: (string | undefined)[]
  // What the evaluator beneath the mod's classic.Stop hook answers.
  evaluator?: { block?: string; stopReason?: string }
  // Leaves /goal without a stand-in, so a goal start is refused.
  goalRefused?: boolean
  // tool_use_ids whose tool.check the engine denies.
  denied?: string[]
  // Answers a dialog's question just before the answer is given.
  beforeAnswer?: (ask: Ask) => void
  // Sees each /goal call's arguments as it arrives.
  onGoal?: (args: string) => void
  // Relative paths whose fs.write the engine refuses.
  failWrites?: string[]
  // What a Bash call prints, by its command.
  bashOut?: Record<string, string>
  // The engine's working directory; it follows a shell cd, the project root does not.
  cwd?: string
  // Leaves prompt.submit without a stand-in, so a submitted prompt is refused.
  promptRefused?: boolean
  // What the engine's chain adds to an ask put to a person (a settings rule, an option's check).
  askWith?: { setting?: string; rule?: string; hook?: string }
  // What $.store holds at the start.
  store?: Record<string, unknown>
  // Makes every $.store.set fail.
  storeFails?: boolean
  // Symbolic links, by their path relative to the root, to the absolute path each points at.
  links?: Record<string, string>
  // What the trace atom holds at the start.
  trace?: unknown
  // Questions whose dialog resolves on its own after the person is away (afkTimeoutMs), with the answer given or none.
  timedOut?: string[]
  // What fs.list of a folder that isn't there, or of a path that is no folder, rejects with; ENOENT when not given.
  listError?: string
  // Absolute paths that are neither a file nor a folder, such as /dev/null: fs.stat says other.
  others?: string[]
  // Absolute paths whose fs.stat the engine refuses with EACCES.
  statFails?: string[]
  // Relative paths whose fs.list the engine refuses although they are folders.
  unlistable?: string[]
  // Relative paths whose fs.read the engine refuses although they are there.
  unreadable?: string[]
  // What a Bash call answers, by its command, as the live check recorded the shapes.
  bashResult?: Record<string, { isError?: boolean; text?: string; result?: unknown; backgroundTaskId?: string }>
  // Process calls, by their argv line, that wait a minute on the clock before they answer.
  slowArgv?: string[]
  // Sees each Bash call's command as it reaches the engine, before it answers.
  onBash?: (command: string) => void
  // The project root the session gives; /repo when not given.
  root?: string
  // Process calls, by their argv line, that the engine refuses, so $.process.run rejects.
  failArgv?: string[]
  // What the changed-files atom holds at the start.
  footprint?: unknown
  // What the turn atom holds at the start: the current goal turn's start and its calls.
  turn?: { startedAt: number; calls: number }
  // What the open-dialogs atom holds at the start.
  dialogs?: number
  // Questions whose AskUserQuestion call the engine fails with an error, as a call that throws.
  askThrows?: string[]
  // Holds each AskUserQuestion call's answer until this promise settles, so the dialog stays open.
  hold?: Promise<void>
  // Files by their bytes, beside files: a text read decodes them as UTF-8, a bytes read answers them as they are.
  binary?: Record<string, number[]>
  // What other atoms hold at the start, by their key.
  atoms?: Record<string, unknown>
  // Atom keys whose state.set the engine refuses.
  failAtoms?: string[]
  // Atom keys whose state.set waits a minute on the clock.
  slowAtoms?: string[]
  // A Write call writes its file, as the engine's Write does.
  writesFiles?: boolean
  // Relative paths whose fs.exists waits a minute on the clock, or that the engine refuses.
  slowExists?: string[]
  existsFails?: string[]
  // Drops every submitted prompt, as a hook's refusal does.
  promptDropped?: boolean
  // Holds the answer of a dialog until the promise it gives settles; undefined answers at once.
  holdAsk?: (ask: Ask) => Promise<void> | undefined
  // Opens every pane undrawn, as Claude Code does on a terminal too narrow for an open nobody asked for.
  paneNotPlaced?: boolean
  // File sizes in bytes that fs.stat answers, by relative path; 0 when not given.
  sizes?: Record<string, number>
}

function runAt(overrides: Partial<Run> = {}): Run {
  return {
    ...newRun({ id: ID, input: ID, source: 'jira', base: 'main', now: NOW, env: ENV }),
    pendingGoal: false,
    ...overrides,
  }
}

function result(exitCode: number, stdout: string): ProcessRunResult {
  return { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

// The kit hands file paths over absolute, under the test session's folder (the plugin's).
// The mod hands paths over absolute under the project root (/repo here); a relative one the kit makes absolute under
// the test session's folder (the plugin's).
function relative(path: string): string {
  return path.replace(/^\/repo\//, '').replace(/^.*\/plugins\/goal-and-do\//, '')
}

// Each run's fingerprint of Git's settings as its start stored it, for the run of the setup and each run.json, unless
// the setup's store gives one.
function seededSettings(setup: Setup): [string, unknown][] {
  const ids = [...(setup.run ? [setup.run.id] : []), ...Object.keys(setup.files ?? {}).flatMap(path => /^changes\/([^/]+)\/run\.json$/.exec(path)?.[1] ?? [])]
  return ids.map(id => [`gitSettings:${id}`, settingsRecord(NO_SETTINGS)])
}

function world(on: On, setup: Setup = {}) {
  const binaryText = Object.entries(setup.binary ?? {}).map(([path, bytes]): [string, string] => [path, new TextDecoder().decode(new Uint8Array(bytes))])
  const files = new Map<string, string>([...Object.entries(setup.files ?? {}), ...binaryText])
  const git = { ...GIT, ...setup.git }
  const answers = [...(setup.answers ?? [])]
  const w = {
    files,
    writes: [] as string[],
    argv: [] as string[],
    commands: [] as string[],
    asks: [] as Ask[],
    // The questions of the last AskUserQuestion drawing, as the engine drew them.
    drawnQuestions: [] as unknown[],
    toasts: [] as string[],
    logs: [] as string[],
    registered: [] as unknown[],
    opened: [] as string[],
    closed: [] as string[],
    prompts: [] as string[],
    promptAsUser: [] as boolean[],
    asked: (_count: number): Promise<void> => Promise.resolve(),
    // Resolves once the engine has received this many prompts.
    prompted: (_count: number): Promise<void> => Promise.resolve(),
    rawPaths: [] as string[],
    processCwds: [] as string[],
    toasted: (_count: number): Promise<void> => Promise.resolve(),
    git,
    ran: [] as string[],
    // The commands of the Bash calls that reached the engine, as they reached it.
    bash: [] as string[],
    // The inputs of those Bash calls, as they reached the engine.
    bashInputs: [] as Record<string, unknown>[],
    heard: 0,
    clock: mock.clock(on, { now: NOW }),
    wipe: () => {},
    run: (): Run | null => null,
    trace: (): unknown => undefined,
    json: (id = ID): Run => JSON.parse(files.get(`changes/${id}/run.json`) ?? 'null') as Run,
    goal: (_args: string): Promise<void> => Promise.resolve(),
    store: new Map<string, unknown>([...seededSettings(setup), ...Object.entries(setup.store ?? {})]),
    // Each process call's environment and time limit, beside its argv line.
    envs: [] as (Record<string, string> | undefined)[],
    timeouts: [] as (number | undefined)[],
    // The mod's debug log lines.
    debug: [] as string[],
    // While true, every write of the run atom is refused.
    failRunWrites: false,
    // Atom keys whose writes the engine refuses from now on.
    failingAtoms: new Set<string>(),
    // Atom keys whose reads the engine refuses from now on.
    failingReads: new Set<string>(),
    // The next write of this file waits a minute on the clock.
    slowWrite: undefined as string | undefined,
    // The next write of this file is refused.
    failWrite: undefined as string | undefined,
    atom: (_key: string): unknown => undefined,
  }

  // clock.settle() doesn't wait on crypto.subtle (the SHA-256 at an approval), so a test whose
  // chain hashes waits for the /goal call the chain ends in.
  const toastWaiters: { count: number; resolve: () => void }[] = []
  w.toasted = count =>
    new Promise<void>(resolve => {
      if (w.toasts.length >= count) resolve()
      else toastWaiters.push({ count, resolve })
    })
  const askWaiters: { count: number; resolve: () => void }[] = []
  w.asked = count =>
    new Promise<void>(resolve => {
      if (w.asks.length >= count) resolve()
      else askWaiters.push({ count, resolve })
    })
  const promptWaiters: { count: number; resolve: () => void }[] = []
  w.prompted = count =>
    new Promise<void>(resolve => {
      if (w.prompts.length >= count) resolve()
      else promptWaiters.push({ count, resolve })
    })
  const goalWaiters: { args: string; resolve: () => void }[] = []
  w.goal = args =>
    new Promise<void>(resolve => {
      if (w.commands.includes(`goal ${args}`)) resolve()
      else goalWaiters.push({ args, resolve })
    })

  // One value and version per atom key: the run and the trace.
  const states = new Map<string, { value: unknown; version: number }>()
  if (setup.run) states.set('run', { value: setup.run, version: 1 })
  if (setup.trace) states.set('trace', { value: setup.trace, version: 1 })
  if (setup.footprint) states.set('footprint', { value: setup.footprint, version: 1 })
  if (setup.turn) states.set('turn', { value: setup.turn, version: 1 })
  if (setup.dialogs !== undefined) states.set('dialogs', { value: setup.dialogs, version: 1 })
  for (const [key, value] of Object.entries(setup.atoms ?? {})) states.set(key, { value, version: 1 })
  on('state.get', (_, e) => {
    if (w.failingReads.has(e.key)) return { deny: 'EIO: state' }
    const held = states.get(e.key)
    return { value: { value: held?.value ?? undefined, version: held?.version ?? 0 } }
  })
  on('state.set', async (_, e) => {
    if (w.failRunWrites && e.key === 'run') return { deny: 'EIO: state' }
    if ((setup.failAtoms ?? []).includes(e.key) || w.failingAtoms.has(e.key)) return { deny: 'EIO: state' }
    if ((setup.slowAtoms ?? []).includes(e.key)) await w.clock.sleep(60_000)
    const version = states.get(e.key)?.version ?? 0
    if (e.ifVersion !== undefined && e.ifVersion !== version) return { value: { isSet: false, version } }
    states.set(e.key, { value: e.value, version: version + 1 })
    return { value: { isSet: true, version: version + 1 } }
  })
  w.wipe = () => {
    for (const [key, held] of states) states.set(key, { value: null, version: held.version + 1 })
  }
  w.run = () => (states.get('run')?.value ?? null) as Run | null
  w.trace = () => states.get('trace')?.value
  w.atom = key => states.get(key)?.value

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.version', () => ({ value: { version: setup.version ?? '2.1.314' } }))
  on('session.cwd', () => ({ value: setup.cwd ?? '/repo' }))
  on('session.root', () => ({ value: setup.root ?? '/repo' }))
  if (!setup.promptRefused) {
    on('prompt.submit', (_, e) => {
      w.prompts.push(e.text)
      for (const waiter of promptWaiters.filter(one => w.prompts.length >= one.count)) waiter.resolve()
      w.promptAsUser.push(e.origin.kind === 'plugin' && e.origin.asUser === true)
      return setup.promptDropped ? { drop: 'a hook refused the prompt' } : { text: e.text }
    })
  }
  on('store.get', (_, e) => ({ value: w.store.get(e.key) }))
  on('store.delete', (_, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.set', (_, e) => {
    if (setup.storeFails) return { deny: 'EACCES: store' }
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('command.register', (_, e) => {
    w.registered.push(e)
    return { value: { command: e.name } }
  })
  on('ui.close', (_, e) => {
    w.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.open', (_, e) => {
    w.opened.push(e.id)
    return { value: setup.paneNotPlaced ? { isPlaced: false, reason: 'below 144 columns' } : { isPlaced: true } }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    for (const waiter of toastWaiters.filter(one => w.toasts.length >= one.count)) waiter.resolve()
    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    if (e.to !== 'debug') w.logs.push(e.text)
    else w.debug.push(e.text)
    return { value: undefined }
  })
  on('settings.read', (_, e) => ({
    value: e.source === 'policy' ? (setup.policy ?? {}) : { permissions: { defaultMode: 'acceptEdits' } },
  }))
  on('tool.list', () => ({
    value: (setup.tools ?? JIRA).map(name => ({ name, description: '', mcp: name.startsWith('mcp__') })),
  }))
  on('process.run', async (_, e) => {
    const line = e.argv.join(' ')
    w.argv.push(line)
    w.processCwds.push(e.init?.cwd ?? '')
    w.envs.push(e.init?.env)
    w.timeouts.push(e.init?.timeoutMs)
    if ((setup.failArgv ?? []).includes(line)) return { deny: 'ENOENT: git' }
    if (e.argv[0] === 'rm' && e.argv[1] === '-f' && e.argv[2] === '--') for (const path of e.argv.slice(3)) files.delete(relative(path))
    if ((setup.slowArgv ?? []).includes(line)) await w.clock.sleep(60_000)
    const [code, out] = git[line] ?? [0, '']
    return { value: result(code, out) }
  })

  on('fs.read', (_, e) => {
    w.rawPaths.push(e.path)
    const at = relative(e.path)
    if (at === '.claude-plugin/plugin.json') return { value: '{ "version": "0.1.0" }' }
    const bytes = setup.binary?.[at]
    if (bytes !== undefined) return { value: e.as === 'bytes' ? { base64: base64Of(bytes) } : new TextDecoder().decode(new Uint8Array(bytes)) }
    const text = files.get(at)
    if (text === undefined) return { deny: `ENOENT: ${at}` }
    if ((setup.unreadable ?? []).includes(at)) return { deny: `EACCES: ${at}` }
    return { value: e.as === 'bytes' ? { base64: base64Of([...new TextEncoder().encode(text)]) } : text }
  })
  on('fs.write', async (_, e) => {
    w.rawPaths.push(e.path)
    const at = relative(e.path)
    if ((setup.failWrites ?? []).includes(at)) return { deny: `EACCES: ${at}` }
    if (w.failWrite === at) {
      w.failWrite = undefined
      return { deny: `EACCES: ${at}` }
    }
    if (w.slowWrite === at) {
      w.slowWrite = undefined
      await w.clock.sleep(60_000)
    }
    w.writes.push(at)
    files.set(at, e.text)
    return { value: undefined }
  })
  on('fs.exists', async (_, e) => {
    w.rawPaths.push(e.path)
    const at = relative(e.path)
    if ((setup.existsFails ?? []).includes(at)) return { deny: `EACCES: ${at}` }
    if ((setup.slowExists ?? []).includes(at)) await w.clock.sleep(60_000)
    return { value: [...files.keys()].some(path => path === at || path.startsWith(`${at}/`)) }
  })
  // A path exists when it is the root or a folder above it, a file, or a folder holding one; each link of setup.links
  // is followed on the way.
  on('fs.stat', (_, e) => {
    const plugin = /^.*\/plugins\/goal-and-do\//
    const cwd = setup.cwd ?? '/repo'
    const links = setup.links ?? {}
    const absolute = plugin.test(e.path) ? `${cwd}/${e.path.replace(plugin, '')}` : e.path.startsWith('/') ? e.path : `${cwd}/${e.path}`
    let real = ''
    let isLink = false
    const linkOf = (at: string) => (at.startsWith('/repo/') ? links[at.slice('/repo/'.length)] : undefined)
    for (const part of absolute.split('/')) {
      if (part === '' || part === '.') continue
      real = part === '..' ? real.slice(0, real.lastIndexOf('/')) : `${real}/${part}`
      let target = linkOf(real)
      isLink = target !== undefined
      for (let hops = 0; target !== undefined && hops < 40; hops++) {
        real = target
        target = linkOf(real)
      }
    }
    if (real === '') real = '/'
    if ((setup.statFails ?? []).includes(real)) return { deny: `EACCES: ${e.path}` }
    if ((setup.others ?? []).includes(real)) return { value: { kind: 'other', size: 0, mtimeMs: 0, isLink, ...(e.resolve ? { realPath: real } : {}) } }
    const inRepo = real.startsWith('/repo/')
    const at = real.slice('/repo/'.length)
    // A file outside the project lies in files under its absolute path.
    const isFile = (inRepo && files.has(at)) || (!inRepo && files.has(real))
    const held = [...files.keys(), ...Object.keys(links)]
    const isDir = real === '/repo' || '/repo'.startsWith(`${real}/`) || real === '/' || (inRepo && held.some(path => path.startsWith(`${at}/`)))
    if (!isFile && !isDir) return { deny: `ENOENT: ${e.path}` }
    return { value: { kind: isFile ? 'file' : 'dir', size: setup.sizes?.[at] ?? 0, mtimeMs: 0, isLink, ...(e.resolve ? { realPath: real } : {}) } }
  })
  on('fs.list', (_, e) => {
    w.rawPaths.push(e.path)
    // The root of the disk holds the project; /repo itself is the project's top folder.
    if (e.path === '/') return { value: [{ name: 'repo', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }] }
    const at = e.path === '/repo' ? '' : relative(e.path)
    if ((setup.unlistable ?? []).includes(at)) return { deny: `EACCES: ${at}` }
    const prefix = at === '' ? '' : `${at}/`
    const names = new Map<string, 'file' | 'dir' | 'link'>()
    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const name = rest.split('/')[0] ?? rest
      names.set(name, rest.includes('/') ? 'dir' : 'file')
    }
    // A link is listed as it stands, whether its target is there or not, and the folders above it as folders.
    for (const path of Object.keys(setup.links ?? {})) {
      if (!path.startsWith(prefix)) continue
      const rest = path.slice(prefix.length)
      const name = rest.split('/')[0] ?? rest
      if (rest.includes('/')) names.set(name, names.get(name) ?? 'dir')
      else names.set(name, 'link')
    }
    if (names.size === 0 && at !== '') return { deny: setup.listError ?? `ENOENT: ${at}` }
    return {
      value: [...names].map(([name, kind]) =>
        kind === 'link' ? { name, kind: 'other' as const, size: 0, mtimeMs: 0, isLink: true } : { name, kind, size: 0, mtimeMs: 0, isLink: false }
      ),
    }
  })

  if (!setup.goalRefused) {
    on('command.run', { command: 'goal' }, (_, e) => {
      w.commands.push(e.args === 'clear' ? 'goal clear' : `goal ${e.args}`)
      setup.onGoal?.(e.args)
      for (const waiter of goalWaiters.filter(one => one.args === e.args)) waiter.resolve()
      return {}
    })
  }
  on('command.run', { command: 'clear' }, () => {
    w.commands.push('clear')
    w.wipe()
    return {}
  })
  on('classic.Stop', () => {
    w.heard += 1
    return setup.evaluator ?? { block: 'spec.md: status is not done yet' }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.check', (_, e) => {
    if (e.approver !== 'person' && e.tool_use_id !== undefined && (setup.denied ?? []).includes(e.tool_use_id)) {
      return { decision: 'deny' as const, reason: 'the person said no' }
    }
    if (e.approver === 'person') return { decision: 'ask' as const, ...setup.askWith }
    return { decision: 'allow' as const }
  })
  on('tool.call', async (_, e) => {
    if (e.tool === 'AskUserQuestion') {
      const asked = e.questions[0]
      const ask: Ask = {
        question: asked?.question ?? '',
        options: (asked?.options ?? []).map(option => option.label),
        header: asked?.header ?? '',
        multiSelect: asked?.multiSelect ?? false,
      }
      w.asks.push(ask)
      for (const waiter of askWaiters.filter(one => w.asks.length >= one.count)) waiter.resolve()
      setup.beforeAnswer?.(ask)
      await setup.hold
      await setup.holdAsk?.(ask)
      if ((setup.askThrows ?? []).includes(ask.question)) throw new Error('the dialog failed')
      const answer = answers.shift()
      if ((setup.timedOut ?? []).includes(ask.question)) {
        const given = answer === undefined ? {} : { [ask.question]: answer }
        return { result: { questions: e.questions, answers: given, afkTimeoutMs: 60000 } }
      }
      if (answer === undefined) return { deny: 'dismissed' }
      return { result: { questions: e.questions, answers: { [ask.question]: answer } } }
    }
    w.ran.push(e.tool_use_id)
    if (setup.writesFiles && e.tool === 'Write') files.set(relative(e.file_path), e.content)
    if (e.tool === 'Bash') {
      w.bash.push(e.command)
      const { tool: _tool, tool_use_id: _id, ...input } = e
      w.bashInputs.push(input)
      setup.onBash?.(e.command)
    }
    // The test run reaches the tool wrapped to unset the tokens: (unset JIRA_PAT GH_TOKEN; <command>).
    const unwrapped = e.tool === 'Bash' ? e.command.replace(/^\(unset [A-Z_ ]+; (.*)\)$/s, '$1') : ''
    const shaped = e.tool === 'Bash' ? setup.bashResult?.[unwrapped] : undefined
    if (shaped !== undefined) {
      const { backgroundTaskId, ...rest } = shaped
      const record = backgroundTaskId === undefined ? rest.result : { ...(rest.result as object), backgroundTaskId }
      return { ...rest, result: (record ?? {}) as never } as never
    }
    const out = e.tool === 'Bash' ? setup.bashOut?.[e.command] : undefined
    return out === undefined ? { result: {} } : { result: { stdout: out, stderr: '', interrupted: false } }
  })
  on('ui.render', ($, e) => {
    // The engine draws its dialog itself: the questions as the hooks above handed them on.
    if (e.component === 'AskUserQuestion') {
      w.drawnQuestions = e.props.questions
      return { type: 'engine', ref: 0 } as never
    }
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  return w
}

type $T = Engine

async function begin($: $T) {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
}

async function command($: $T, args: string, origin: typeof PERSON | typeof OTHER = PERSON) {
  return (await $.command.run({ command: 'goal-and-do', args, origin, presentation: PRESENTATION })).text
}

async function turnEnd($: $T, fields: { usage?: typeof USAGE; agentId?: string; answer?: string } = {}) {
  return $.turn.complete({
    answer: fields.answer ?? 'Done.',
    durationMs: 120000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
    ...(fields.usage ? { usage: fields.usage } : {}),
    ...(fields.agentId ? { agentId: fields.agentId } : {}),
  })
}

async function stopHook($: $T, agentId?: string) {
  return $.classic.Stop({ stop_hook_active: true, ...(agentId ? { agent_id: agentId } : {}) })
}

async function band($: $T, surface: RenderSurface, bodyColumns: number): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  const lines = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return lines
}

async function pane($: $T, surface: RenderSurface, bodyColumns: number): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface,
    component: 'Pane',
    requestId: 'goal-and-do',
    props: {
      title: 'goal-and-do',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  })
  const lines = (await ui.findAll({ type: 'Text' })).map(found => found.text)
  await ui.unmount()
  return afterHint(lines)
}

// Each phase row of the pane, read whole: the kit joins a Box's texts and its Link's label.
async function paneRowTexts($: $T, surface: RenderSurface, bodyColumns: number): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface,
    component: 'Pane',
    requestId: 'goal-and-do',
    props: { title: 'goal-and-do', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  const rows: string[] = []
  for (const phase of PHASES) rows.push((await ui.find({ key: `row-${phase}` }))?.text ?? '')
  await ui.unmount()
  return rows
}

async function everyBand($: $T, check: (lines: string[]) => void) {
  for (const surface of SURFACES) for (const columns of COLUMNS) check(await band($, surface, columns))
}

const phaseFile = (phase: PhaseName, id = ID) => `changes/${id}/${FILES[phase]}`

// Start

test('start: a ticket URL at the repo root writes request.md and run.json and starts the first goal', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '# git ls-files --others\n' } })
  await begin($)
  const reply = await command($, URL_INPUT)

  expect(reply).toBe(TEXTS.startedJira(ID))
  expect(w.files.get(`changes/${ID}/request.md`)).toBe(`---\nsource: jira ${ID}\nbase: main\n---\n\n${URL_INPUT}\n`)
  const run = w.json()
  expect(run).toMatchObject({ id: ID, input: URL_INPUT, source: 'jira', base: 'main', phase: 0, state: 'running' })
  expect(run.env).toEqual(ENV)
  expect(w.files.get('.git/info/exclude')).toBe('# git ls-files --others\nchanges/*/run.json\n')
  expect(w.opened).toContain('goal-and-do')
  await everyBand($, lines => {
    expect(lines.join('\n')).toContain(`● ${PHASES[0].toUpperCase()}`)
  })

  expect(w.commands).toEqual([])
  await w.clock.settle()
  expect(w.commands).toEqual([`goal ${goalFor(PHASES[0], ID)}`])
  expect(w.json()).toMatchObject({ goalActive: true, pendingGoal: false })
})

test('start: the command is registered with its hint and immediate', async ($, on) => {
  const w = world(on)
  await begin($)
  expect(w.registered).toEqual([
    {
      name: 'goal-and-do',
      description: 'Run the six phases for a Jira ticket or a free-text request',
      argumentHint: '[--base <branch>] <ticket URL | key | text | file.md> | next | status | allow [local] | stop',
      immediate: true,
    },
  ])
})

test('start: free text names the CH- ID and the ticket hint, and request.md says freeform', async ($, on) => {
  const w = world(on, { tools: [] })
  await begin($)
  const input = 'Stop sending duplicate emails'
  const { id } = changeIdFrom(input, NOW)
  const reply = await command($, input)

  expect(id).toBe('CH-20261029-stop-sending-duplicate-emails')
  expect(reply).toBe(TEXTS.startedFreeText(id))
  expect(w.files.get(`changes/${id}/request.md`)).toBe(`---\nsource: freeform\nbase: main\n---\n\n${input}\n`)
  await w.clock.settle()
  expect(w.commands).toEqual([`goal ${goalFor(PHASES[0], id)}`])
})

test('start: an empty argument gives the usage text', async ($, on) => {
  const w = world(on)
  await begin($)
  expect(await command($, '  ')).toBe(TEXTS.usage)
  expect(w.writes).toEqual([])
})

const PREFLIGHT: { name: string; input?: string; setup: Setup; reply: string }[] = [
  { name: 'not the repo root', setup: { git: { [g('rev-parse --show-prefix')]: [0, 'sub/\n'] } }, reply: TEXTS.preflightNotAtRoot },
  { name: 'not a repository', setup: { git: { [g('rev-parse --show-prefix')]: [128, ''] } }, reply: TEXTS.notAtRoot },
  {
    name: 'on an sdd/ branch',
    setup: { git: { [g('branch --show-current')]: [0, 'sdd/ABC-1\n'] } },
    reply: TEXTS.wrongBranch('sdd/ABC-1', 'main'),
  },
  {
    name: 'a dirty tree',
    setup: {
      git: {
        [g('status --porcelain -z --untracked-files=all')]: [
          0,
          ' M src/a.ts\0?? .claude/settings.local.json\0 M .claude/settings.json\0?? changes/ABC-9/run.json\0?? notes.txt\0',
        ],
      },
    },
    reply: TEXTS.preflightDirty('src/a.ts, notes.txt'),
  },
  { name: 'a ticket with no Jira tool', setup: { tools: ['mcp__dynatrace__getEvents'] }, reply: TEXTS.preflightNoJira },
  {
    name: 'a ticket with only a Confluence tool on the atlassian server',
    setup: { tools: ['mcp__atlassian__confluence_search'] },
    reply: TEXTS.preflightNoJira,
  },
  { name: 'a ticket with only Jira writes', setup: { tools: ['mcp__jira__createIssue', 'mcp__jira__jira_add_comment'] }, reply: TEXTS.preflightNoJira },
  {
    name: 'gh not logged in for a GitHub origin',
    setup: { git: { [`gh auth status --hostname ${HOST}`]: [1, ''] } },
    reply: TEXTS.preflightGh(HOST),
  },
  {
    name: 'gh not logged in for an ssh origin',
    setup: {
      git: {
        [g('remote get-url origin')]: [0, `git@${HOST}:example/demo.git\n`],
        [`gh auth status --hostname ${HOST}`]: [1, ''],
      },
    },
    reply: TEXTS.preflightGh(HOST),
  },
  { name: 'a blocking policy key', setup: { policy: { allowManagedModsOnly: true } }, reply: TEXTS.preflightManaged('allowManagedModsOnly') },
  {
    name: 'two failures at once',
    setup: { tools: [], git: { [g('branch --show-current')]: [0, 'sdd/ABC-1\n'] } },
    reply: `${TEXTS.wrongBranch('sdd/ABC-1', 'main')}\n${TEXTS.preflightNoJira}`,
  },
]

for (const c of PREFLIGHT) {
  test(`preflight: ${c.name} gives its line and writes nothing`, async ($, on) => {
    const w = world(on, c.setup)
    await begin($)
    expect(await command($, c.input ?? ID)).toBe(c.reply)
    await w.clock.settle()
    expect(w.writes).toEqual([])
    expect(w.commands).toEqual([])
    expect(w.run()).toBeNull()
  })
}

test('start: a failed write to the exclude file refuses the start and writes nothing', async ($, on) => {
  const w = world(on, { failWrites: ['.git/info/exclude'] })
  await begin($)
  const reply = await command($, ID)
  expect(reply).toBe(
    'goal-and-do started nothing: it could not add changes/*/run.json to .git/info/exclude (goal-and-do: $.fs.write: EACCES: .git/info/exclude).'
  )
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect(w.files.has(`changes/${ID}/run.json`)).toBe(false)
  expect(w.files.has(`changes/${ID}/request.md`)).toBe(false)
  expect(w.run()).toBeNull()
  expect(w.commands).toEqual([])
})

test('start: a failed store write refuses the start with a toast and writes nothing in the change folder', async ($, on) => {
  const w = world(on, { storeFails: true })
  await begin($)
  expect(await command($, ID)).toBeUndefined()
  await w.clock.settle()
  expect(w.toasts).toEqual(['goal-and-do could not write its store; the run did not start.'])
  expect([...w.files.keys()].filter(path => path.startsWith(`changes/${ID}/`))).toEqual([])
  expect(w.run()).toBeNull()
  expect(w.commands).toEqual([])
  expect(w.opened).toEqual([])
})

test('start: a failed lookup of the exclude file refuses the start and writes nothing', async ($, on) => {
  const w = world(on, { git: { [g('rev-parse --git-path info/exclude')]: [128, ''] } })
  await begin($)
  const reply = await command($, ID)
  expect(reply).toBe('goal-and-do started nothing: it could not add changes/*/run.json to .git/info/exclude (git rev-parse --git-path info/exclude failed).')
  await w.clock.settle()
  expect(w.writes).toEqual([])
  expect(w.run()).toBeNull()
})

test('preflight: a snake_case Jira read on the atlassian server is a Jira source', async ($, on) => {
  world(on, { tools: ['mcp__atlassian__jira_get_issue'] })
  await begin($)
  expect(await command($, ID)).toBe(TEXTS.startedJira(ID))
})

test('preflight: a bare local origin skips the gh check', async ($, on) => {
  const w = world(on, {
    git: { [g('remote get-url origin')]: [0, '/Users/k/demo-origin.git\n'], [`gh auth status --hostname ${HOST}`]: [1, ''] },
  })
  await begin($)
  expect(await command($, ID)).toBe(TEXTS.startedJira(ID))
  expect(w.argv.some(line => line.startsWith('gh auth'))).toBe(false)
})

test('origin: next, allow and a start from a plugin are refused with the person-only text', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }) })
  await begin($)
  expect(await command($, 'next', OTHER)).toBe(TEXTS.notFromPerson('next', 'plugin other-mod'))
  expect(await command($, 'allow', OTHER)).toBe(TEXTS.notFromPerson('allow', 'plugin other-mod'))
  expect(await command($, 'allow local', OTHER)).toBe(TEXTS.notFromPerson('allow local', 'plugin other-mod'))
  expect(await command($, 'ABC-7', OTHER)).toBe(TEXTS.notFromPerson('ABC-7', 'plugin other-mod'))
  await w.clock.settle()
  expect(w.asks).toEqual([])
  expect(w.writes).toEqual([])
})

test('second start: an active run names its folder and next', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: { 'changes/ABC-2/run.json': JSON.stringify(runAt({ phase: phaseAt('Spec'), id: 'ABC-2', state: 'gate', approvals: approvalsTo('Spec') })) },
    })
  )
  await begin($)
  expect(await command($, 'ABC-3')).toBe(TEXTS.runActive('ABC-2'))
  expect(w.files.has('changes/ABC-3/request.md')).toBe(false)
})

test('a next with more words starts no run and changes none', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Intent'), state: 'blocked', reason: 'x' }) })
  await begin($)
  expect(await command($, 'next reruns Intent')).toBe(TEXTS.subcommandWords('next'))
  expect(await command($, 'status of the export')).toBe(TEXTS.subcommandWords('status'))
  expect(w.writes).toEqual([])
  expect(w.commands).toEqual([])
  expect(w.run()).toMatchObject({ phase: phaseAt('Intent'), state: 'blocked' })
})

test('second start: an existing change folder names the clean-up commands', async ($, on) => {
  const w = world(on, { files: { 'changes/ABC-1/spec.md': SPEC_DONE } })
  await begin($)
  expect(await command($, 'ABC-1')).toBe(TEXTS.changeExists('ABC-1', 'main'))
  expect(w.writes).toEqual([])
})

// Gates

test("approvals.md names a role under Approved by, never the runner's Git name", async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Intent'), pendingGoal: true }),
    answers: ['Approve, start Spec'],
    git: { [g('config user.name')]: [0, 'Some Runner\n'] },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  w.files.set(phaseFile('Intent'), INTENT_DONE)
  await turnEnd($)
  await w.clock.settle()
  const text = w.files.get(`changes/${ID}/approvals.md`) ?? ''
  expect(text).toContain('| the person who approved |')
  expect(text).not.toContain('Some Runner')
  expect(JSON.stringify(w.store.get(`approvals:${ID}`))).not.toContain('Some Runner')
})

test('Intent done stops at the gate; Approve records the row, runs /clear and starts Spec', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Intent'), pendingGoal: true }), answers: ['Approve, start Spec'] })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  w.files.set(phaseFile('Intent'), INTENT_DONE)
  await turnEnd($)
  await w.goal(goalFor('Spec', ID))
  await w.clock.settle()

  expect(w.asks[0]).toEqual({
    question: TEXTS.gateQuestion('Intent', ID, []),
    options: [...TEXTS.gateOptions('Spec'), 'Open intent.md in app'],
    header: 'Gate',
    multiSelect: false,
  })
  expect(w.commands).toEqual([`goal ${goalFor('Intent', ID)}`, 'goal clear', 'clear', `goal ${goalFor('Spec', ID)}`])
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n')
  expect(w.files.get(phaseFile('Intent'))).toBe(INTENT_APPROVED)
  expect(rows.at(-1)).toBe(`| Intent | changes/${ID}/intent.md (0 open points) | ${INTENT_SHA} | the person who approved | 2026-10-29T18:05:00.000Z |  |`)
  expect(w.json()).toMatchObject({ phase: phaseAt('Spec'), state: 'running', goalActive: true })
  expect(w.json().approvals).toEqual([{ phase: 'Intent', file: `changes/${ID}/intent.md`, sha256: INTENT_SHA, at: NOW }])
  await everyBand($, lines => {
    expect(lines.join('\n')).toContain('● SPEC')
  })
})

test('gate: the Intent question names the open points that stay open if the person approves', async ($, on) => {
  const text = INTENT_DONE + '\n## Open questions\n\n- Who owns the export?\n- Which formats?\n'
  const w = world(on, { run: runAt({ phase: phaseAt('Intent'), state: 'gate' }), files: { [phaseFile('Intent')]: text } })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(TEXTS.gateQuestion('Intent', ID, [], 2))
  expect(w.asks[0]?.question).toContain('2 open questions stay open if you approve; Spec carries them.')
})

const INTENT_OPEN = [
  '---',
  'phase: intent',
  'status: done',
  '---',
  '',
  '# Export for brokers',
  '',
  '## Business acceptance criteria',
  '',
  '- BAC-1: Given a broker, when they export, then they get a file.',
  '',
  '## Open questions',
  '',
  '- Who owns the export?',
  '  Answer (2026-10-29): "The broker team."',
  '- Which formats?',
  `  Answer (2026-10-29): "Not known yet (stays open for the ticket's owner)"`,
  '- How often?',
  '',
].join('\n')
const INTENT_WALK_GATE = ['Walk through the 2 open questions', 'Approve, start Spec', 'Open intent.md in app', 'Stop this run']
const intentGate = (setup: Setup = {}) => ({
  run: runAt({ phase: phaseAt('Intent'), state: 'gate' }),
  ...setup,
  files: { [phaseFile('Intent')]: INTENT_OPEN, ...setup.files },
})

test('Intent gate: open questions offer the walk-through, and the question counts them', async ($, on) => {
  const w = world(on, intentGate())
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]).toEqual({ question: TEXTS.gateQuestion('Intent', ID, [], 2), options: INTENT_WALK_GATE, header: 'Gate', multiSelect: false })
})

test('Intent gate: approval writes open-at-approval, hashes intent.md with it, and names the count in approvals.md', async ($, on) => {
  const w = world(on, intentGate({ answers: ['Approve, start Spec'] }))
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Spec', ID))
  await w.clock.settle()
  const approved = INTENT_OPEN.replace('status: done\n---', 'status: done\nopen-at-approval: 2\n---')
  const sha = await shaOf(approved)
  expect(w.files.get(phaseFile('Intent'))).toBe(approved)
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n')
  expect(rows.at(-1)).toBe(`| Intent | changes/${ID}/intent.md (2 open points) | ${sha} | the person who approved | 2026-10-29T18:05:00.000Z |  |`)
  expect(w.json().approvals).toEqual([{ phase: 'Intent', file: `changes/${ID}/intent.md`, sha256: sha, at: NOW }])
  expect(w.json()).toMatchObject({ phase: phaseAt('Spec'), state: 'running' })
})

test('Intent gate: approval replaces an open-at-approval line, keeps CRLF, and says 1 open point', async ($, on) => {
  const text = '---\r\nphase: intent\r\nstatus: done\r\nopen-at-approval: 7\r\n---\r\n\r\n## Open questions\r\n\r\n- Who?\r\n'
  const w = world(on, intentGate({ files: { [phaseFile('Intent')]: text }, answers: ['Approve, start Spec'] }))
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Spec', ID))
  await w.clock.settle()
  const approved = text.replace('open-at-approval: 7', 'open-at-approval: 1')
  expect(w.files.get(phaseFile('Intent'))).toBe(approved)
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n')
  expect(rows.at(-1)).toBe(
    `| Intent | changes/${ID}/intent.md (1 open point) | ${await shaOf(approved)} | the person who approved | 2026-10-29T18:05:00.000Z |  |`
  )
})

for (const [name, answer] of [
  ['an empty answer', ''],
  ['a rejected ask', undefined],
  ['"Approve" typed under Other', 'Approve'],
  ['"yes, approve and start Spec" typed under Other', 'yes, approve and start Spec'],
] as [string, string | undefined][]) {
  test(`Intent gate: ${name} never approves`, async ($, on) => {
    const w = world(on, intentGate({ answers: [answer] }))
    await begin($)
    await command($, 'next')
    await w.clock.settle()
    expect(w.asks).toHaveLength(1)
    expect(w.run()).toMatchObject({ state: 'gate', phase: phaseAt('Intent'), approvals: [] })
    expect(w.files.has(`changes/${ID}/approvals.md`)).toBe(false)
    expect(w.files.get(phaseFile('Intent'))).toBe(INTENT_OPEN)
    expect(w.commands).toEqual([])
    expect(w.logs).toEqual([TEXTS.gateText('Intent', ID)])
  })
}

for (const [name, points, count] of [
  ['an Answer line under the item', ['- Who?', '  Answer (2026-10-29): "The broker."'], 0],
  ['an Answer line as a sub-item', ['- Who?', '  - Answer (2026-10-29): "The broker."'], 0],
  ['an Answer line without quotes', ['- Who?', '  Answer (2026-10-29): The broker.'], 0],
  ['an Answer of Not known yet', ['- Who?', `  Answer (2026-10-29): "Not known yet (stays open for the ticket's owner)"`], 1],
  ['an Answer of not known YET in another case', ['- Who?', '  ANSWER (2026-10-29): "not known YET"'], 1],
  ['an Answer that only mentions not known yet', ['- Who?', '  Answer (2026-10-29): "The broker; the format is not known yet."'], 0],
  ['"Answer" in the question', ['- Who can answer (today) the calls?'], 1],
  ['a Decided line', ['- Who?', '  Decided (the person, 2026-10-29): the broker.'], 0],
  ['"None."', ['None.'], 0],
  ['"- None."', ['- None.'], 0],
  ['two open, one answered', ['- A?', '- B?', '  Answer (2026-10-29): "yes"', '- C?'], 2],
  ['a top-level Answer item under the item', ['- Who?', '- Answer (2026-10-29): "The broker."'], 0],
  ['a numbered Answer item under the item', ['1. Who?', '2. Answer (2026-10-29): "The broker."'], 0],
  ['a top-level Decided item under the item', ['- Who?', '- Decided (the person, 2026-10-29): the broker.'], 0],
  ['a top-level Answer item between two open items', ['- A?', '- Answer (2026-10-29): "yes"', '- B?'], 1],
  ['a top-level Answer of Not known yet', ['- Who?', `- Answer (2026-10-29): "Not known yet (stays open for the ticket's owner)"`], 1],
  ['a nested Answer of Not known yet', ['- Who?', '  - Answer (2026-10-29): "NOT KNOWN YET"'], 1],
] as [string, string[], number][]) {
  test(`open questions: ${name} counts ${count} undecided`, async ($, on) => {
    const text = ['---', 'phase: intent', 'status: done', '---', '', '## Open questions', '', ...points, ''].join('\n')
    const w = world(on, intentGate({ files: { [phaseFile('Intent')]: text } }))
    await begin($)
    await command($, 'next')
    await w.clock.settle()
    const options = w.asks[0]?.options ?? []
    if (count === 0) expect(options).toEqual([...TEXTS.gateOptions('Spec'), 'Open intent.md in app'])
    else expect(options[0]).toBe(TEXTS.walkThrough(count, 'Intent'))
    expect(w.asks[0]?.question).toBe(TEXTS.gateQuestion('Intent', ID, [], count))
  })
}

// High-risk questions: approval waits for their answers

const intentWithRisk = (answer: string) =>
  [
    '---',
    'phase: intent',
    'status: done',
    'high-risk: Personal data; Money',
    '---',
    '',
    '## Open questions',
    '',
    '- Personal data: who may see the broker list?',
    ...(answer === '' ? [] : [`  Answer (2026-10-29): "${answer}"`]),
    '- Money: does the export change a premium?',
    '  Answer (2026-10-29): "No."',
    '- Which formats?',
    '',
  ].join('\n')

test('Intent gate: an unanswered high-risk question offers no approval and names the question', async ($, on) => {
  const w = world(on, intentGate({ files: { [phaseFile('Intent')]: intentWithRisk('') } }))
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual(['Walk through the 2 open questions', 'Open intent.md in app', 'Stop this run'])
  expect(w.asks[0]?.question).toContain(TEXTS.highRiskWaits(['Personal data']))
})

test('Intent gate: Not known yet leaves a high-risk question waiting', async ($, on) => {
  const w = world(on, intentGate({ files: { [phaseFile('Intent')]: intentWithRisk("Not known yet (stays open for the ticket's owner)") } }))
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]?.options).not.toContain('Approve, start Spec')
})

test('Intent gate: the approve label typed under Other still waits for the high-risk answer', async ($, on) => {
  const w = world(on, intentGate({ files: { [phaseFile('Intent')]: intentWithRisk('') }, answers: ['Approve, start Spec'] }))
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.logs).toContain(TEXTS.highRiskRefused(['Personal data']))
  expect(w.run()).toMatchObject({ phase: phaseAt('Intent'), state: 'gate' })
  expect(w.run()?.approvals ?? []).toEqual([])
})

test('Intent gate: with every high-risk question answered, approval comes after the walk-through', async ($, on) => {
  const w = world(on, intentGate({ files: { [phaseFile('Intent')]: intentWithRisk('The broker team only.') }, answers: ['Approve, start Spec'] }))
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Spec', ID))
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual(['Walk through the 1 open question', 'Approve, start Spec', 'Open intent.md in app', 'Stop this run'])
  expect(w.json()).toMatchObject({ phase: phaseAt('Spec'), state: 'running' })
})

// The walk-through at the Intent gate

const askQuestion = (question: string) => ({
  tool: 'AskUserQuestion' as const,
  questions: [
    {
      question,
      header: 'Intent',
      options: [
        { label: 'Yes', description: 'Yes' },
        { label: 'Not known yet', description: "Stays open for the ticket's owner" },
      ],
      multiSelect: false,
    },
  ],
})

test('Intent gate: the walk-through sends the Intent prompt', async ($, on) => {
  const w = world(on, intentGate({ answers: ['Walk through the 2 open points'] }))
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.prompts).toEqual([`${TEXTS.walkPicked('Intent', 'gate')} ${TEXTS.intentWalkPrompt(ID, '2026-10-29')}`])
  expect(w.run()?.state).toBe('gate')
})

test('Intent gate: the reopened gate counts the answered, skipped and timed-out questions of the walk-through', async ($, on) => {
  const w = world(
    on,
    intentGate({
      answers: ['Walk through the 2 open points', 'The broker team', 'CSV', undefined, undefined],
      timedOut: ['Which formats?'],
    })
  )
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  await $.tool.call(askQuestion('Who owns the export?'))
  await $.tool.call(askQuestion('Which formats?'))
  await $.tool.call(askQuestion('How often?'))
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks).toHaveLength(5)
  expect(w.asks[4]?.question).toBe(`${TEXTS.gateQuestion('Intent', ID, [], 2)} ${TEXTS.walkCounts(1, 1, 1)}`)
})

test('Intent gate: a question that times out counts as timed out even with an answer, and no call counts outside a walk-through', async ($, on) => {
  const w = world(
    on,
    intentGate({ answers: ['Before the walk', 'Walk through the 2 open points', 'Yes', undefined, 'After the gate reopened'], timedOut: ['Which formats?'] })
  )
  await begin($)
  await $.tool.call(askQuestion('Who owns the export?'))
  await command($, 'next')
  await w.clock.settle()
  await $.tool.call(askQuestion('Which formats?'))
  await command($, 'next')
  await w.clock.settle()
  await $.tool.call(askQuestion('How often?'))
  await command($, 'next')
  await w.clock.settle()
  const questions = w.asks.map(ask => ask.question)
  expect(questions[3]).toBe(`${TEXTS.gateQuestion('Intent', ID, [], 2)} ${TEXTS.walkCounts(0, 0, 1)}`)
  expect(questions[5]).toBe(`${TEXTS.gateQuestion('Intent', ID, [], 2)} ${TEXTS.walkCounts(0, 0, 1)}`)
})

test('Intent gate: a dialog the mod opens itself during a walk-through counts nothing', async ($, on) => {
  const w = world(
    on,
    intentGate({
      run: runAt({ phase: phaseAt('Intent'), state: 'gate', suggested: ['Bash(npm test)'] }),
      answers: ['Walk through the 2 open points', 'Not now', 'Yes'],
    })
  )
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  await command($, 'allow')
  await w.clock.settle()
  await $.tool.call(askQuestion('Who owns the export?'))
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks).toHaveLength(4)
  expect(w.asks[3]?.question).toBe(`${TEXTS.gateQuestion('Intent', ID, [], 2)} ${TEXTS.walkCounts(1, 0, 0)}`)
})

test('Intent gate: the reopened gate names the criteria added or changed since the gate first opened', async ($, on) => {
  const w = world(on, intentGate({ answers: ["Not yet, I'll review or edit first"] }))
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  w.files.set(
    phaseFile('Intent'),
    INTENT_OPEN.replace('then they get a file.', 'then they get a CSV file.').replace(
      '- BAC-1:',
      '- BAC-2: Given a broker, when the export fails, then they see why.\n- BAC-1:'
    )
  )
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[1]?.question).toBe(`${TEXTS.gateQuestion('Intent', ID, [], 2)} ${TEXTS.criteriaSince(['BAC-2'], ['BAC-1'])}`)
})

test('Intent gate: an unchanged intent.md adds nothing to the reopened question', async ($, on) => {
  const w = world(on, intentGate({ answers: ["Not yet, I'll review or edit first"] }))
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks.map(ask => ask.question)).toEqual([TEXTS.gateQuestion('Intent', ID, [], 2), TEXTS.gateQuestion('Intent', ID, [], 2)])
})

// A blocked Intent

const INTENT_BLOCKED = '---\nphase: intent\nstatus: blocked\nnot-needed: yes\n---\n\n# Export\n\n## Open questions\n\n- The export exists already.\n'
const INTENT_STOP_OPTIONS = ['Stop this run', 'Rerun Intent', 'Not yet', 'Open intent.md in app']
const blockedIntent = (answers: (string | undefined)[]) => ({
  run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
  files: { [phaseFile('Intent')]: INTENT_BLOCKED },
  answers,
})

test('Intent blocked: the dialog asks to stop the run, and Stop this run gives the start-over line', async ($, on) => {
  const w = world(on, blockedIntent(['Stop this run']))
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]).toEqual({
    question: "Intent says the change isn't needed: The export exists already. Stop the run?",
    options: INTENT_STOP_OPTIONS,
    header: 'Stuck',
    multiSelect: false,
  })
  expect(w.run()).toMatchObject({ state: 'stopped' })
  expect(w.logs).toEqual([TEXTS.stopped(ID, 'main')])
  expect(w.logs[0]).toContain(`To start over: git reset -- changes/${ID}, git switch main, rm -r changes/${ID}, git branch -D sdd/${ID}.`)
})

test('Intent blocked: Rerun Intent reruns it from a draft', async ($, on) => {
  const w = world(on, blockedIntent(['Rerun Intent']))
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('Intent', ID))
  await w.clock.settle()
  expect(w.run()).toMatchObject({ phase: phaseAt('Intent'), state: 'running', reruns: { Intent: 1 } })
  expect(w.files.get(phaseFile('Intent'))).toBe(INTENT_BLOCKED.replace('status: blocked', 'status: draft'))
  expect(w.commands).toEqual(['goal clear', 'goal clear', 'clear', `goal ${goalFor('Intent', ID)}`])
})

for (const [name, answers] of [
  ['Not yet', ['Not yet']],
  ['a dismissal', [undefined]],
  ['typed text', ['stop it maybe']],
] as [string, (string | undefined)[]][]) {
  test(`Intent blocked: ${name} keeps the run blocked and says how to continue`, async ($, on) => {
    const w = world(on, blockedIntent(answers))
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.asks).toHaveLength(1)
    expect(w.run()?.state).toBe('blocked')
    expect(w.logs).toEqual([TEXTS.stuckContinue('Intent')])
  })
}

test('Intent blocked: Open intent.md in app opens it and asks again', async ($, on) => {
  const w = world(on, blockedIntent(['Open intent.md in app', 'Not yet']))
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.argv).toContain(`open /repo/changes/${ID}/intent.md`)
  expect(w.asks.map(ask => ask.options)).toEqual([INTENT_STOP_OPTIONS, INTENT_STOP_OPTIONS])
})

test('Intent blocked without not-needed: yes opens the stuck dialog with its reason', async ($, on) => {
  const thin = '---\nphase: intent\nstatus: blocked\n---\n\n# Export\n\n## Open questions\n\n- The request is too thin to say what to build.\n'
  const w = world(on, { ...blockedIntent(['Not yet']), files: { [phaseFile('Intent')]: thin } })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]?.question).toBe(TEXTS.stuckBlocked('Intent', 'The request is too thin to say what to build.', ID))
  const [rerunLabel, , stopLabel] = TEXTS.stuckOptions('Intent')
  expect(w.asks[0]?.options).toEqual([TEXTS.walkThrough(1, 'Intent'), rerunLabel, 'Open intent.md in app', stopLabel])
  expect(w.asks[0]?.header).toBe('Stuck')
})

test('Intent stuck without status blocked keeps the stuck dialog', async ($, on) => {
  const reason = 'the goal stopped'
  const w = world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
    files: { [phaseFile('Intent')]: draft('intent') },
    evaluator: { stopReason: reason },
  })
  await begin($)
  await stopHook($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(TEXTS.stuckBlocked('Intent', TEXTS.goalEnded(reason), ID))
  expect(w.asks[0]?.options).toEqual([...TEXTS.stuckOptions('Intent'), 'Open intent.md in app'])
})

test('Intent out of turns keeps the stuck dialog', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true, state: 'capped', turns: 10 }),
    files: { [phaseFile('Intent')]: INTENT_BLOCKED },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(TEXTS.stuckCapped('Intent', ID))
  expect(w.asks[0]?.options).toEqual(['Walk through the 1 open question', 'Rerun Intent now', 'Open intent.md in app', 'Stop this run'])
})

test('Spec done stops at the gate; Approve records the row, runs /clear and starts Plan', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), pendingGoal: true }), answers: ['Approve, start Plan'] })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  w.files.set(phaseFile('Spec'), SPEC_DONE)
  await turnEnd($)
  await w.goal(goalFor('Plan', ID))
  await w.clock.settle()

  expect(w.asks[0]).toEqual({
    question: TEXTS.gateQuestion('Spec', ID, []),
    options: [...TEXTS.gateOptions('Plan'), 'Open spec.md in app'],
    header: 'Gate',
    multiSelect: false,
  })
  expect(w.commands).toEqual([`goal ${goalFor('Spec', ID)}`, 'goal clear', 'clear', `goal ${goalFor('Plan', ID)}`])
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n')
  expect(rows.at(-1)).toBe(`| Spec | changes/${ID}/spec.md | ${SPEC_SHA} | the person who approved | 2026-10-29T18:05:00.000Z |  |`)
  expect(w.json()).toMatchObject({ phase: phaseAt('Plan'), state: 'running', goalActive: true })
  expect(w.json().approvals).toEqual([{ phase: 'Spec', file: `changes/${ID}/spec.md`, sha256: SPEC_SHA, at: NOW }])
  await everyBand($, lines => {
    expect(lines.join('\n')).toContain('● PLAN')
  })
})

test('gate: an approval writes the rows to the store and rebuilds approvals.md whole from them', async ($, on) => {
  const intent = approvalsTo('Spec', ID)
  const extra = `| Plan | changes/${ID}/plan.md | ${'ab'.repeat(32)} | Someone | 2026-10-29T18:05:00.000Z |  |\n`
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate', approvals: intent }),
    files: {
      [phaseFile('Intent')]: INTENT_APPROVED,
      [phaseFile('Spec')]: SPEC_DONE,
      [`changes/${ID}/approvals.md`]: approvalsText(intent) + extra,
    },
    store: { [`approvals:${ID}`]: recordOf(intent) },
    answers: ['Approve, start Plan'],
  })
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Plan', ID))
  await w.clock.settle()
  const rows = [...intent, { phase: 'Spec' as const, file: phaseFile('Spec'), sha256: SPEC_SHA, at: NOW }]
  expect(w.store.get(`approvals:${ID}`)).toEqual(recordOf(rows))
  expect(w.files.get(`changes/${ID}/approvals.md`)).toBe(approvalsText(rows))
  expect(w.json().approvals).toEqual(rows)
})

test('gate: the Intent approval keeps its open points in the store and in the rebuilt approvals.md', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Intent'), state: 'gate' }),
    files: { [phaseFile('Intent')]: INTENT_DONE },
    store: { [`approvals:${ID}`]: recordOf([]) },
    answers: ['Approve, start Spec'],
  })
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Spec', ID))
  await w.clock.settle()
  const row = { phase: 'Intent' as const, file: phaseFile('Intent'), sha256: INTENT_SHA, at: NOW }
  expect(w.store.get(`approvals:${ID}`)).toEqual({ approvedPast: 0, rows: [{ ...row, by: 'the person who approved', note: '0 open points' }] })
  expect(w.files.get(`changes/${ID}/approvals.md`)).toBe(
    `${APPROVALS_HEADER}| Intent | changes/${ID}/intent.md (0 open points) | ${INTENT_SHA} | the person who approved | 2026-10-29T18:05:00.000Z |  |\n`
  )
})

test('gate: Not yet keeps the band at waiting and gives the gate text; next reopens the dialog', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), answers: ["Not yet, I'll review or edit first"] })
  await begin($)
  expect(await command($, 'next')).toBeUndefined()
  await w.clock.settle()

  expect(w.logs).toEqual([TEXTS.gateText('Spec', ID)])
  expect(w.run()?.state).toBe('gate')
  await everyBand($, lines => {
    expect(lines.join('\n')).toContain('waiting: approve Spec')
  })
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks.map(ask => ask.question)).toEqual([TEXTS.gateQuestion('Spec', ID, []), TEXTS.gateQuestion('Spec', ID, [])])
  expect(w.commands).toEqual([])
})

test('gate: a gate state at a phase with no gate logs the gate text and opens no dialog', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), state: 'gate' }) })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks).toEqual([])
  expect(w.logs).toEqual([TEXTS.gateText('Build', ID)])
})

test('gate: Stop this run stops the run', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), answers: ['Stop this run'] })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'stopped', pendingClear: false })
  expect(w.commands).toEqual(['goal clear'])
  expect(w.logs).toEqual([TEXTS.stopped(ID, 'main')])
  expect(w.closed).toEqual(['goal-and-do'])
})

test('Plan approval records locked-at and each locked file, then starts Build', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
    files: { [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    answers: ['Approve, start Build'],
  })
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()

  expect(w.asks[0]?.question).toBe(TEXTS.gateQuestion('Plan', ID, ['tests/acceptance']))
  const run = w.json()
  expect(run).toMatchObject({
    phase: phaseAt('Build'),
    state: 'running',
    lockedAt: '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345',
    lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA },
    testPaths: ['tests/acceptance'],
  })
  expect(run.approvals.at(-1)).toEqual({
    phase: 'Plan',
    file: `changes/${ID}/plan.md`,
    sha256: PLAN_SHA,
    at: NOW,
    lockedAt: '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345',
  })
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n')
  expect(rows.at(-1)).toBe(
    `| Plan | changes/${ID}/plan.md | ${PLAN_SHA} | the person who approved | 2026-10-29T18:05:00.000Z | 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 |`
  )
  expect(w.commands).toEqual(['clear', `goal ${goalFor('Build', ID)}`])
  expect(w.store.get(`lock:${ID}`)).toEqual({
    lockedAt: '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345',
    lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA },
    testPaths: ['tests/acceptance'],
  })
})

test('Plan approval is refused while the test paths have uncommitted changes', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
    files: { [phaseFile('Plan')]: PLAN_DONE },
    git: { [g('status --porcelain -- tests/acceptance')]: [0, ' M tests/acceptance/a.test.ts\n'] },
    answers: ['Approve, start Build'],
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.logs).toEqual([TEXTS.preflightDirty('tests/acceptance/a.test.ts')])
  expect(w.run()?.state).toBe('gate')
  expect(w.files.has(`changes/${ID}/approvals.md`)).toBe(false)
  expect(w.commands).toEqual([])
})

test('Plan approval is refused when git rev-parse HEAD fails', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
    files: { [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    git: { [g('rev-parse HEAD')]: [128, ''] },
    answers: ['Approve, start Build'],
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.toasts).toEqual(['goal-and-do did not approve Plan: git rev-parse HEAD failed, so the acceptance tests cannot be locked.'])
  expect(w.run()).toMatchObject({ state: 'gate', approvals: [] })
  expect(w.run()?.lockedAt).toBeUndefined()
  expect(w.files.has(`changes/${ID}/approvals.md`)).toBe(false)
  expect(w.commands).toEqual([])
})

// Chaining and the lock

test('Build done starts Test and Test done starts PR, each after /clear; the band keeps the run', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands).toEqual(['clear', `goal ${goalFor('Test', ID)}`])
  expect(w.run()).toMatchObject({ phase: phaseAt('Test'), state: 'running', goalActive: true })
  await everyBand($, lines => {
    expect(lines.join('\n')).toContain('● TEST')
  })

  w.files.set(phaseFile('Test'), done('test'))
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands.slice(2)).toEqual(['clear', `goal ${goalFor('PR', ID)}`])
  expect(w.run()).toMatchObject({ phase: phaseAt('PR'), state: 'running', goalActive: true })
  await everyBand($, lines => {
    expect(lines.join('\n')).toContain('● PR')
  })
  expect(w.argv.filter(line => line === g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance'))).toHaveLength(2)
  expect(w.argv.filter(line => line === g('ls-files --others --exclude-standard -- tests/acceptance'))).toHaveLength(2)
})

test('a changed acceptance test blocks Build; Test does not start', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
    git: { [g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance')]: [1, ''] },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  const reason = 'the acceptance tests changed since Plan approval'
  expect(w.run()).toMatchObject({ phase: phaseAt('Build'), state: 'blocked', reason, goalActive: false })
  expect(w.commands).toEqual(['goal clear'])
  expect(w.asks[0]?.question).toBe(TEXTS.relockQuestion('Build', []))
})

test('an uncommitted change to an acceptance test blocks Build though HEAD matches the lock', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
    git: { [g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance')]: [1, ''] },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval' })
  expect(w.commands).toEqual(['goal clear'])
})

test('an untracked file under a test path blocks Build', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
    git: { [g('ls-files --others --exclude-standard -- tests/acceptance')]: [0, 'tests/acceptance/new.test.ts\n'] },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval' })
  expect(w.commands).toEqual(['goal clear'])
})

test('blocked: build.md at blocked opens the stuck dialog; Rerun Build now reruns it', async ($, on) => {
  const seen: (string | undefined)[] = []
  const w = world(on, {
    onGoal: args => {
      if (args !== 'clear') seen.push(w.files.get(phaseFile('Build')))
    },
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: {
      [phaseFile('Build')]: '---\nphase: build\nstatus: blocked\n---\n\n# Build\n\n## Open points\n\n- The migration needs a DBA.\n',
    },
    answers: ['Rerun Build now'],
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]).toEqual({
    question: TEXTS.stuckBlocked('Build', 'The migration needs a DBA.', ID),
    options: ['Walk through the 1 open point', 'Rerun Build now', 'Open build.md in app', 'Stop this run'],
    header: 'Stuck',
    multiSelect: false,
  })
  expect(w.commands).toEqual(['goal clear', 'goal clear', 'clear', `goal ${goalFor('Build', ID)}`])
  expect(w.run()).toMatchObject({ phase: phaseAt('Build'), state: 'running', goalActive: true, reruns: { Build: 1 } })
  expect(seen).toEqual(['---\nphase: build\nstatus: draft\n---\n\n# Build\n\n## Open points\n\n- The migration needs a DBA.\n'])
})

test('next on a blocked run sets the phase file back to draft before the goal starts', async ($, on) => {
  const seen: (string | undefined)[] = []
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', ...LOCK }),
    files: { [phaseFile('Build')]: '---\nphase: build\nstatus: blocked\nfix-rounds: 1\n---\nstatus: blocked stays in the body\n' },
    onGoal: args => {
      if (args !== 'clear') seen.push(w.files.get(phaseFile('Build')))
    },
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(seen).toEqual(['---\nphase: build\nstatus: draft\nfix-rounds: 1\n---\nstatus: blocked stays in the body\n'])
  expect(w.commands).toEqual(['goal clear', 'clear', `goal ${goalFor('Build', ID)}`])
})

test('a rerun leaves a phase file without front matter as it is', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'capped', turns: 15 }),
    files: { [phaseFile('Spec')]: '# Spec\n\nstatus: blocked\n' },
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.files.get(phaseFile('Spec'))).toBe('# Spec\n\nstatus: blocked\n')
  expect(w.writes).not.toContain(phaseFile('Spec'))
  expect(w.commands.at(-1)).toBe(`goal ${goalFor('Spec', ID)}`)
})

// Turn cap, unmet goals, stop

test('the mod stops a phase at its turn cap and the turn.complete after it clears the goal', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), pendingGoal: true }) })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  w.files.set(phaseFile('Spec'), draft('spec'))

  const verdicts = []
  for (let i = 0; i < TURN_CAPS.Spec; i++) verdicts.push(await stopHook($))
  expect(w.heard).toBe(TURN_CAPS.Spec - 1)
  expect(verdicts.at(-1)).toEqual({})
  expect(verdicts[0]).toEqual({ block: 'spec.md: status is not done yet' })
  expect(w.run()).toMatchObject({ state: 'capped', turns: 15 })
  expect(w.run()?.usage.rows.Spec?.turns).toBe(15)

  await turnEnd($, { usage: USAGE })
  await w.clock.settle()
  expect(w.commands.slice(1)).toEqual(['goal clear'])
  expect(w.asks[0]?.question).toBe(TEXTS.stuckCapped('Spec', ID))
  expect(Object.keys(w.run()?.usage.rows ?? {})).toEqual(['Spec'])
  expect(w.run()?.usage.rows.Spec?.models['claude-sonnet-5-5']?.output).toBe(200)
  expect(w.run()?.goalActive).toBe(false)
  await everyBand($, lines => {
    expect(lines.join('\n')).toContain('out of turns')
  })
})

test('the cap holds while the phase file says done and the evaluator keeps blocking', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), pendingGoal: true }), evaluator: { block: 'spec.md: the acceptance criteria are not shown yet' } })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  w.files.set(phaseFile('Spec'), SPEC_DONE)

  const verdicts = []
  for (let i = 0; i < TURN_CAPS.Spec + 1; i++) verdicts.push(await stopHook($))
  expect(verdicts[TURN_CAPS.Spec - 2]).toEqual({ block: 'spec.md: the acceptance criteria are not shown yet' })
  expect(verdicts[TURN_CAPS.Spec - 1]).toEqual({})
  expect(verdicts[TURN_CAPS.Spec]).toEqual({})
  expect(w.heard).toBe(TURN_CAPS.Spec - 1)
  expect(w.run()).toMatchObject({ state: 'capped', turns: 15 })
  expect(w.run()?.usage.rows.Spec?.turns).toBe(15)
})

test('a classic.Stop while no goal of the run is set passes to the evaluator and counts nothing', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), evaluator: {} })
  await begin($)
  expect(await stopHook($)).toEqual({})
  expect(w.heard).toBe(1)
  expect(w.run()?.turns).toBe(0)
})

test("a goal that ends without done gives blocked with the evaluator's last reason", async ($, on) => {
  const reason = 'Goal could not be achieved: the tests cannot pass in 40 turns'
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: draft('build') },
    evaluator: { stopReason: reason },
  })
  await begin($)
  await stopHook($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands).toEqual(['goal clear'])
  expect(w.run()).toMatchObject({ state: 'blocked', reason: TEXTS.goalEnded(reason), goalActive: false })
  expect(w.asks[0]?.question).toBe(TEXTS.stuckBlocked('Build', TEXTS.goalEnded(reason), ID))
})

const BUILD_DONE = '---\nphase: build\nstatus: done\n---\n\n# Build\n'

test('next on a run blocked by "goal ended" whose phase file says done goes on without a rerun', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: TEXTS.goalEnded('Goal achieved'), ...LOCK }),
    files: { [phaseFile('Build')]: BUILD_DONE },
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.files.get(phaseFile('Build'))).toBe(BUILD_DONE)
  expect(w.commands).toEqual(['clear', `goal ${goalFor('Test', ID)}`])
  const run = w.run()
  expect(run).toMatchObject({ phase: phaseAt('Test'), state: 'running' })
  expect(run?.reruns?.Build).toBeUndefined()
})

test("a turn after the goal's end finishes the file: the stuck dialog's rerun goes on without a rerun", async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: draft('build') },
    evaluator: { stopReason: 'Goal achieved' },
    answers: [TEXTS.stuckOptions('Build')[0] ?? ''],
    beforeAnswer: () => w.files.set(phaseFile('Build'), BUILD_DONE),
  })
  await begin($)
  await stopHook($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(TEXTS.stuckBlocked('Build', TEXTS.goalEnded('Goal achieved'), ID))
  expect(w.files.get(phaseFile('Build'))).toBe(BUILD_DONE)
  expect(w.run()).toMatchObject({ phase: phaseAt('Test'), state: 'running' })
  expect(w.run()?.reruns?.Build).toBeUndefined()
})

test('next on a run blocked by another reason reruns a phase file that says done', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', ...LOCK }),
    files: { [phaseFile('Build')]: BUILD_DONE },
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.files.get(phaseFile('Build'))).toContain('status: draft')
  expect(w.run()).toMatchObject({ phase: phaseAt('Build'), state: 'running', reruns: { Build: 1 } })
})

test('next on a "goal ended" block whose phase file still says draft reruns it', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: TEXTS.goalEnded('x'), ...LOCK }),
    files: { [phaseFile('Build')]: draft('build') },
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.run()).toMatchObject({ phase: phaseAt('Build'), state: 'running', reruns: { Build: 1 } })
})

const BACKGROUND: { id: string; type: string; status: string; description: string; command?: string; agent_type?: string; server?: string }[] = [
  { id: 'task-1', type: 'subagent', status: 'running', description: 'Write the acceptance tests', agent_type: 'general-purpose' },
]

for (const isActiveStop of [false, true]) {
  test(`background work: a turn that ends waiting on a background agent keeps the goal (stop_hook_active ${isActiveStop})`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Plan'), goalActive: true }),
      files: { [phaseFile('Plan')]: draft('plan') },
    })
    await begin($)
    await $.turn.start({ text: '', turnId: 'turn-1' })
    await $.classic.Stop({ stop_hook_active: isActiveStop, background_tasks: BACKGROUND })
    const r = await turnEnd($, { answer: 'Waiting for 1 background agent to finish.' })
    await w.clock.settle()
    expect(r.text).toBe('Waiting for 1 background agent to finish.')
    expect(w.commands).toEqual([])
    expect(w.asks).toEqual([])
    expect(w.run()).toMatchObject({ phase: phaseAt('Plan'), state: 'running', goalActive: true, turns: 1 })

    await $.turn.start({ text: '', turnId: 'turn-2' })
    w.files.set(phaseFile('Plan'), PLAN_DONE)
    await $.classic.Stop({ stop_hook_active: true, background_tasks: [] })
    await turnEnd($)
    await w.clock.settle()
    expect(w.commands).toEqual(['goal clear'])
    expect(w.asks[0]?.question).toBe(TEXTS.gateQuestion('Plan', ID, ['tests/acceptance']))
    expect(w.run()).toMatchObject({ state: 'gate', turns: 2 })
  })
}

for (const [name, task] of [
  ['a finished shell task', { id: 'task-2', type: 'shell', status: 'completed', description: 'gradle test', command: './gradlew test' }],
  ['a running monitor', { id: 'task-3', type: 'monitor', status: 'running', description: 'logs', server: 'dynatrace' }],
  ['a completed subagent', { id: 'task-4', type: 'subagent', status: 'completed', description: 'Write the acceptance tests' }],
  ['a failed workflow', { id: 'task-5', type: 'workflow', status: 'Failed', description: 'checks' }],
] as [string, (typeof BACKGROUND)[number]][]) {
  test(`background work: ${name} does not hold the goal open`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Plan'), goalActive: true }),
      files: { [phaseFile('Plan')]: PLAN_DONE },
    })
    await begin($)
    await $.turn.start({ text: '', turnId: 'turn-1' })
    await $.classic.Stop({ stop_hook_active: true, background_tasks: [task] })
    await turnEnd($)
    await w.clock.settle()
    expect(w.commands).toEqual(['goal clear'])
    expect(w.asks[0]?.question).toBe(TEXTS.gateQuestion('Plan', ID, ['tests/acceptance']))
    expect(w.run()?.state).toBe('gate')
  })
}

test('background work: a running shell task holds the goal open', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK }), files: { [phaseFile('Test')]: draft('test') } })
  await begin($)
  await $.classic.Stop({
    stop_hook_active: true,
    background_tasks: [{ id: 'task-8', type: 'shell', status: 'running', description: 'gradle test', command: './gradlew test' }],
  })
  await turnEnd($, { answer: 'Waiting for the test suite to finish.' })
  await w.clock.settle()
  expect(w.commands).toEqual([])
  expect(w.asks).toEqual([])
  expect(w.run()).toMatchObject({ phase: phaseAt('Test'), state: 'running', goalActive: true })
})

test('background work: the cap still ends a goal waiting on a shell', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Test'), goalActive: true, turns: TURN_CAPS.Test - 1, ...LOCK }),
    files: { [phaseFile('Test')]: draft('test') },
  })
  await begin($)
  const shell = [{ id: 'task-9', type: 'shell', status: 'running', description: 'gradle test' }]
  expect(await $.classic.Stop({ stop_hook_active: true, background_tasks: shell })).toEqual({})
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands).toEqual(['goal clear'])
  expect(w.run()?.state).toBe('capped')
})

test('background work: a running workflow holds the goal open', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Plan'), goalActive: true }), files: { [phaseFile('Plan')]: draft('plan') } })
  await begin($)
  await $.classic.Stop({
    stop_hook_active: true,
    background_tasks: [
      { id: 'task-6', type: 'shell', status: 'running', description: 'watch' },
      { id: 'task-7', type: 'workflow', status: 'pending', description: 'tests' },
    ],
  })
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands).toEqual([])
  expect(w.run()).toMatchObject({ state: 'running', goalActive: true })
})

test('background work: a stop still ends the goal', async ($, on) => {
  const w = world(on)
  await begin($)
  await command($, ID)
  await w.clock.settle()
  await $.turn.start({ text: '', turnId: 'turn-1' })
  await command($, 'stop')
  expect(await $.classic.Stop({ stop_hook_active: true, background_tasks: BACKGROUND })).toEqual({})
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands.slice(1)).toEqual(['goal clear'])
  expect(w.run()?.pendingClear).toBe(false)
})

test('background work: the cap still ends the goal', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), pendingGoal: true }) })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  w.files.set(phaseFile('Spec'), draft('spec'))
  let last = {}
  for (let i = 0; i < TURN_CAPS.Spec; i++) last = await $.classic.Stop({ stop_hook_active: i > 0, background_tasks: BACKGROUND })
  expect(last).toEqual({})
  expect(w.run()?.state).toBe('capped')
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands.slice(1)).toEqual(['goal clear'])
  expect(w.asks[0]?.question).toBe(TEXTS.stuckCapped('Spec', ID))
})

test('next while the goal runs is refused; subagent turns add usage but never advance or count', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), pendingGoal: true }) })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  await $.turn.start({ text: '', turnId: 'turn-1' })
  expect(await command($, 'next')).toBe(TEXTS.goalRunning('Spec'))
  expect(await command($, 'allow')).toBe(TEXTS.goalRunning('Spec'))
  expect(await command($, 'ABC-9')).toBe(TEXTS.goalRunning('Spec'))

  w.files.set(phaseFile('Spec'), SPEC_DONE)
  await stopHook($, 'agent-1')
  await turnEnd($, { agentId: 'agent-1', usage: USAGE })
  await w.clock.settle()
  const run = w.run()
  expect(run).toMatchObject({ phase: phaseAt('Spec'), state: 'running', goalActive: true, turns: 0 })
  expect(run?.usage.rows.Spec).toEqual({
    models: { 'claude-sonnet-5-5': { input: 10, output: 200, cacheRead: 3000, cacheWrite: 40 } },
    turns: 0,
    ms: 0,
  })
  expect(w.commands).toHaveLength(1)
  expect(w.heard).toBe(1)
})

test('next while a turn runs and no run exists names the first phase', async ($, on) => {
  world(on)
  await begin($)
  await $.turn.start({ text: '', turnId: 'turn-1' })
  expect(await command($, 'next')).toBe(TEXTS.goalRunning(PHASES[0]))
})

test('next with a goal set and no turn running is refused too', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }) })
  await begin($)
  expect(await command($, 'next')).toBe(TEXTS.goalRunning('Spec'))
  expect(w.commands).toEqual([])
})

test('stop mid-turn cuts the goal loop at the next classic.Stop and the turn.complete after it clears the goal', async ($, on) => {
  const w = world(on)
  await begin($)
  await command($, ID)
  await w.clock.settle()
  await $.turn.start({ text: '', turnId: 'turn-1' })
  expect(await command($, 'stop')).toBe(TEXTS.stopped(ID, 'main'))
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'stopped', pendingClear: true, goalActive: false })
  expect(w.commands).toEqual([`goal ${goalFor(PHASES[0], ID)}`])
  expect(w.closed).toEqual(['goal-and-do'])

  expect(await stopHook($)).toEqual({})
  expect(w.heard).toBe(0)
  const push = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(push.deny).toBeDefined()
  await everyBand($, lines => {
    expect(lines).toEqual(['engine'])
  })

  await turnEnd($, { usage: USAGE })
  await w.clock.settle()
  expect(w.commands.slice(1)).toEqual(['goal clear'])
  expect(w.run()?.pendingClear).toBe(false)
  expect(Object.keys(w.run()?.usage.rows ?? {})).toEqual([PHASES[0]])
  const later = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(later.deny).toBeUndefined()
})

test('stop with the goal set and no turn running clears the goal at once', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }) })
  await begin($)
  expect(await command($, 'stop')).toBe(TEXTS.stopped(ID, 'main'))
  await w.clock.settle()
  expect(w.commands).toEqual(['goal clear'])
  expect(w.run()).toMatchObject({ state: 'stopped', pendingClear: false })
  expect(w.closed).toEqual(['goal-and-do'])
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands).toEqual(['goal clear'])
})

test('stop on a stopped run names it as stopped', async ($, on) => {
  world(on, { run: runAt({ state: 'stopped' }) })
  await begin($)
  expect(await command($, 'stop')).toBe(TEXTS.runStopped(ID, 'main'))
})

// Restore

test('restart at the Plan gate restores the newest active run; next reopens the dialog', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-0/run.json': JSON.stringify(runAt({ id: 'ABC-0', phase: phaseAt('Plan'), state: 'gate', startedAt: NOW - 9000 })),
        'changes/ABC-1/run.json': JSON.stringify(runAt({ id: 'ABC-1', state: 'finished', phase: phaseAt('PR'), startedAt: NOW + 9000 })),
        'changes/ABC-2/run.json': JSON.stringify(
          runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', startedAt: NOW - 1000, approvals: approvalsTo('Plan') })
        ),
        [phaseFile('Plan', 'ABC-2')]: PLAN_DONE,
      },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ id: 'ABC-2', state: 'gate' })
  expect(w.opened).toContain('goal-and-do')
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(TEXTS.gateQuestion('Plan', 'ABC-2', ['tests/acceptance']))
})

test('restart mid-Build restores running as interrupted; next clears any goal and reruns Build', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: approvalsTo('Build') })),
      },
      store: { 'lock:ABC-2': LOCK },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ id: 'ABC-2', state: 'interrupted', goalActive: false, pendingGoal: false })
  expect(w.json('ABC-2').state).toBe('interrupted')
  await everyBand($, lines => {
    expect(lines.join('\n')).toContain('interrupted')
  })
  await command($, 'next')
  await w.clock.settle()
  expect(w.commands).toEqual(['goal clear', 'clear', `goal ${goalFor('Build', 'ABC-2')}`])
  expect(w.run()).toMatchObject({ state: 'running', goalActive: true, reruns: { Build: 1 } })
})

test('restore: an approved push is not carried over from run.json', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('PR'), state: 'gate', pushApproved: true, approvals: approvalsTo('PR') })),
      },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ id: 'ABC-2', pushApproved: false })
  expect(w.json('ABC-2').pushApproved).toBe(false)
})

test('restore: suggested rules and candidates are not carried over from run.json', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(
          runAt({
            id: 'ABC-2',
            phase: phaseAt('Spec'),
            state: 'gate',
            approvals: approvalsTo('Spec'),
            suggested: ['Bash(curl *)'],
            candidates: { toolu_1: 'Bash(curl *)' },
            offered: ['Bash(npm test)'],
          })
        ),
      },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ suggested: [], candidates: {}, offered: ['Bash(npm test)'] })
  expect(w.json('ABC-2').suggested).toEqual([])
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks).toEqual([])
})

for (const [name, fields] of [
  ['a lockedAt that is no commit', { lockedAt: '--output=/tmp/x' }],
  ['a test path that reads as an option', { lockedAt: '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345', testPaths: ['-x'] }],
  ['a test path outside the repo', { testPaths: ['../outside'] }],
  ['an absolute locked file', { lockedFiles: { '/etc/passwd': 'x' } }],
  ['an id that is no change ID', { id: '../x' }],
  ['approvals that are no list', { approvals: 'none' as unknown as Run['approvals'] }],
  ['an approval row that is no object', { approvals: [null] as unknown as Run['approvals'] }],
  ['an approval row with no phase', { approvals: [{ file: 'x' }] as unknown as Run['approvals'] }],
  ['a phase past the last', { phase: PHASES.length }],
  ['a negative phase', { phase: -1 }],
  ['a phase that is no whole number', { phase: 1.5 }],
  ['a schema that is neither 1 nor 2', { schema: 3 as unknown as Run['schema'] }],
] as [string, Partial<Run>][]) {
  test(`restore: a run.json with ${name} is skipped with a toast`, async ($, on) => {
    const w = world(on, { files: { 'changes/ABC-7/run.json': JSON.stringify(runAt({ phase: phaseAt('Spec'), id: 'ABC-7', state: 'gate', ...fields })) } })
    await begin($)
    expect(w.run()).toBeNull()
    expect(w.toasts).toHaveLength(1)
    expect(w.toasts[0]).toContain('goal-and-do skipped changes/ABC-7/run.json')
  })
}

test('restore: a free-text ID and a 64-character lock commit are restored', async ($, on) => {
  const id = 'CH-20261029-stop-sending-duplicate-emails'
  const w = world(
    on,
    withRecord({
      files: {
        [`changes/${id}/run.json`]: JSON.stringify(
          runAt({ id, phase: phaseAt('Build'), state: 'blocked', ...LOCK, lockedAt: 'ab'.repeat(32), approvals: approvalsTo('Build', id) })
        ),
      },
    })
  )
  await begin($)
  expect(w.run()?.id).toBe(id)
  expect(w.toasts).toEqual([])
})

test('restore: a lock that differs from the stored one comes back blocked with the stored lock', async ($, on) => {
  const stored = { lockedAt: 'ab'.repeat(20), lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA } }
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: approvalsTo('Build') })),
      },
      store: { 'lock:ABC-2': stored },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({
    id: 'ABC-2',
    state: 'blocked',
    reason: 'the acceptance tests changed since Plan approval',
    goalActive: false,
    pendingGoal: false,
    ...stored,
  })
})

test('restore: locked files that differ from the stored ones come back blocked', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Build'), state: 'gate', ...LOCK, approvals: approvalsTo('Build') })),
      },
      store: { 'lock:ABC-2': { lockedAt: LOCK.lockedAt, lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA } } },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ state: 'blocked', lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA } })
})

test('restore: test paths that differ from the stored ones come back blocked with the stored paths', async ($, on) => {
  const stored = { ...LOCK, testPaths: ['tests/acceptance', 'tests/contract'] }
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: approvalsTo('Build') })),
      },
      store: { 'lock:ABC-2': stored },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({
    state: 'blocked',
    reason: 'the acceptance tests changed since Plan approval',
    testPaths: ['tests/acceptance', 'tests/contract'],
    lockedAt: LOCK.lockedAt,
  })
})

test('restore: a start-over deletes the stale stored lock, so the restarted run is not blocked', async ($, on) => {
  const w = world(on, { store: { [`lock:${ID}`]: { ...LOCK, lockedAt: 'ab'.repeat(20) } } })
  await begin($)
  await command($, ID)
  await w.clock.settle()
  expect(w.store.has(`lock:${ID}`)).toBe(false)
  await begin($)
  expect(w.run()).toMatchObject({ id: ID, phase: 0, state: 'interrupted' })
  expect(w.run()?.lockedAt).toBeUndefined()
  expect(w.run()?.reason).toBeUndefined()
})

for (const phase of [0, PHASES.length - 1]) {
  test(`restore: a run.json of schema 2 at phase ${phase} comes back`, async ($, on) => {
    const approvals = approvalsTo(PHASES[phase] ?? 'Intent', 'ABC-7')
    const w = world(on, withRecord({ files: { 'changes/ABC-7/run.json': JSON.stringify(runAt({ id: 'ABC-7', phase, state: 'gate', approvals })) } }))
    await begin($)
    expect(w.run()).toMatchObject({ id: 'ABC-7', schema: 2, phase })
    expect(w.toasts).toEqual([])
  })
}

test('restore: a finished or stopped run of schema 1 is skipped without a toast', async ($, on) => {
  const w = world(on, {
    files: {
      'changes/ABC-5/run.json': JSON.stringify({ ...runAt({ id: 'ABC-5', state: 'finished', phase: 4 }), schema: 1 }),
      'changes/ABC-6/run.json': JSON.stringify({ ...runAt({ id: 'ABC-6', state: 'stopped', phase: 1 }), schema: 1 }),
    },
  })
  await begin($)
  expect(w.run()).toBeNull()
  expect(w.toasts).toEqual([])
})

test('restore: an active run of schema 1 comes back blocked at Intent with the guard on, until stop ends it', async ($, on) => {
  const earlier = JSON.stringify({ ...runAt({ id: 'ABC-6', state: 'gate', phase: 1, approvals: approvalsTo('Spec', 'ABC-6') }), schema: 1 })
  const w = world(on, { files: { 'changes/ABC-6/run.json': earlier } })
  await begin($)
  expect(w.toasts).toEqual([EARLIER])
  expect(w.run()).toMatchObject({ id: 'ABC-6', schema: 2, phase: 0, state: 'blocked', reason: EARLIER, approvals: [], goalActive: false })
  expect(w.files.get('changes/ABC-6/run.json')).toBe(earlier)
  await expectRefused($, w, 'ABC-6', EARLIER)
})

test('restore: a stored lock is compared without a Plan approval row too', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: { 'changes/ABC-2/run.json': JSON.stringify(runAt({ phase: phaseAt('Spec'), id: 'ABC-2', state: 'gate', approvals: approvalsTo('Spec') })) },
      store: { 'lock:ABC-2': { ...LOCK } },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval', lockedAt: LOCK.lockedAt })
})

test('restore: a run.json whose id is not its folder name is skipped with a toast', async ($, on) => {
  const w = world(on, { files: { 'changes/ABC-7/run.json': JSON.stringify(runAt({ phase: phaseAt('Spec'), id: 'ABC-8', state: 'gate' })) } })
  await begin($)
  expect(w.run()).toBeNull()
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('goal-and-do skipped changes/ABC-7/run.json')
})

test('restore: a lock equal to the stored one comes back as before', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: approvalsTo('Build') })),
      },
      store: { 'lock:ABC-2': { lockedFiles: LOCK.lockedFiles, testPaths: LOCK.testPaths, lockedAt: LOCK.lockedAt } },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ state: 'interrupted', lockedAt: LOCK.lockedAt, lockedFiles: LOCK.lockedFiles })
})

test('restore: a run past Plan with no stored lock comes back blocked', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: approvalsTo('Build') })),
      },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval', goalActive: false })
})

test('restore: a run with a Plan approval row and no stored lock comes back blocked', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(
          runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals: [...approvalsTo('Plan'), PLAN_APPROVAL] })
        ),
      },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval' })
})

test('restore: a run before Plan approval with no stored lock comes back as before', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: { 'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals: approvalsTo('Plan') })) },
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ state: 'gate' })
  expect(w.run()?.reason).toBeUndefined()
})

// The mod's record of the approvals

// A refused run: next answers with its toast's text, the guard denies the push and an edit of approvals.md, no goal
// starts and no dialog opens; stop ends it, and the next restart skips it without a toast.
async function expectRefused($: $T, w: ReturnType<typeof world>, id: string, text: string) {
  expect(await command($, 'next')).toBe(text)
  await w.clock.settle()
  const push = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${id}` })
  expect(push.deny).toBeDefined()
  const edit = await $.tool.call({ tool: 'Edit', file_path: `/repo/changes/${id}/approvals.md`, old_string: 'a', new_string: 'b' })
  expect(edit.deny).toBeDefined()
  expect(w.asks).toEqual([])
  expect(w.commands.filter(line => line.startsWith('goal ') && line !== 'goal clear')).toEqual([])
  expect(w.run()?.state).toBe('blocked')
  expect(await command($, 'stop')).toBe(TEXTS.stopped(id, 'main'))
  await w.clock.settle()
  expect(w.run()?.state).toBe('stopped')
  expect(w.json(id)).toMatchObject({ schema: 2, id, state: 'stopped' })
  const toasts = w.toasts.length
  await begin($)
  expect(w.toasts).toHaveLength(toasts)
}

test("restore: a run.json forged to Plan with a made-up Spec approval comes back blocked at Spec, with the store's rows", async ($, on) => {
  const intent = approvalsTo('Spec')
  const forged = [...intent, { phase: 'Spec' as const, file: 'changes/ABC-2/spec.md', sha256: 'ab'.repeat(32), at: NOW }]
  const json = JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals: forged, pushApproved: true }))
  const w = world(on, {
    files: { 'changes/ABC-2/run.json': json, [phaseFile('Plan', 'ABC-2')]: PLAN_DONE },
    store: { 'approvals:ABC-2': recordOf(intent) },
  })
  await begin($)
  expect(w.toasts).toEqual([FORGED('ABC-2')])
  expect(w.run()).toMatchObject({
    id: 'ABC-2',
    phase: phaseAt('Spec'),
    state: 'blocked',
    reason: FORGED('ABC-2'),
    approvals: intent,
    pushApproved: false,
    goalActive: false,
    pendingGoal: false,
  })
  expect(w.files.get('changes/ABC-2/run.json')).toBe(json)
  await expectRefused($, w, 'ABC-2', FORGED('ABC-2'))
})

test('restore: a run.json forged past Plan comes back blocked at Build, so the guard denies the push', async ($, on) => {
  const approvals = approvalsTo('PR')
  const w = world(on, {
    files: {
      'changes/ABC-2/run.json': JSON.stringify(
        runAt({ id: 'ABC-2', phase: phaseAt('PR'), state: 'running', goalActive: true, approvals: [...approvals, { ...PLAN_APPROVAL }], pushApproved: true })
      ),
      'changes/ABC-2/approvals.md': approvalsText(approvals),
    },
    store: { 'approvals:ABC-2': recordOf(approvals), 'lock:ABC-2': { ...LOCK } },
  })
  await begin($)
  expect(w.toasts).toEqual([FORGED('ABC-2')])
  expect(w.run()).toMatchObject({ phase: phaseAt('Build'), state: 'blocked', approvals, lockedAt: LOCK.lockedAt, lockedFiles: LOCK.lockedFiles })
  const test = await $.tool.call({ tool: 'Edit', file_path: '/repo/tests/acceptance/a.test.ts', old_string: 'a', new_string: 'b' })
  expect(test.deny).toBeDefined()
  await expectRefused($, w, 'ABC-2', FORGED('ABC-2'))
})

test("restore: a run.json whose approvals match the store restores as before, with the store's rows", async ($, on) => {
  const approvals = approvalsTo('Plan')
  const w = world(on, {
    files: {
      'changes/ABC-2/run.json': JSON.stringify(
        runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals: approvals.map(row => ({ ...row, at: NOW + 5 })) })
      ),
    },
    store: { 'approvals:ABC-2': recordOf(approvals) },
  })
  await begin($)
  expect(w.toasts).toEqual([])
  expect(w.run()).toMatchObject({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals })
  expect(w.opened).toContain('goal-and-do')
})

for (const [name, change] of [
  ['a phase past what the approvals allow', (run: Run) => ({ ...run, phase: phaseAt('Build') })],
  ['a SHA-256 that differs', (run: Run) => ({ ...run, approvals: run.approvals.map((row, i) => (i === 1 ? { ...row, sha256: 'ab'.repeat(32) } : row)) })],
  ['a file that differs', (run: Run) => ({ ...run, approvals: run.approvals.map((row, i) => (i === 0 ? { ...row, file: 'changes/ABC-2/x.md' } : row)) })],
  ['a phase of a row that differs', (run: Run) => ({ ...run, approvals: run.approvals.map((row, i) => (i === 0 ? { ...row, phase: 'Plan' as const } : row)) })],
  ['a lockedAt that differs', (run: Run) => ({ ...run, approvals: run.approvals.map((row, i) => (i === 0 ? { ...row, lockedAt: LOCK.lockedAt } : row)) })],
  ['a kind that differs', (run: Run) => ({ ...run, approvals: run.approvals.map((row, i) => (i === 0 ? { ...row, kind: 'relock' as const } : row)) })],
  ['a row more', (run: Run) => ({ ...run, approvals: [...run.approvals, { ...PLAN_APPROVAL }] })],
  ['a row less', (run: Run) => ({ ...run, approvals: run.approvals.slice(1) })],
] as [string, (run: Run) => Run][]) {
  test(`restore: a run.json that differs from the store's record by ${name} is refused with the toast`, async ($, on) => {
    const run = runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals: approvalsTo('Plan') })
    const w = world(on, {
      files: { 'changes/ABC-2/run.json': JSON.stringify(change(run)) },
      store: { 'approvals:ABC-2': recordOf(run.approvals) },
    })
    await begin($)
    expect(w.toasts).toEqual([FORGED('ABC-2')])
    expect(w.run()).toMatchObject({ phase: phaseAt('Plan'), state: 'blocked', reason: FORGED('ABC-2'), approvals: run.approvals })
  })
}

test('restore: a run at Spec needs the Intent approval in the store', async ($, on) => {
  const w = world(on, {
    files: { 'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Spec'), state: 'gate' })) },
    store: { 'approvals:ABC-2': recordOf([]) },
  })
  await begin($)
  expect(w.run()).toMatchObject({ phase: phaseAt('Intent'), state: 'blocked', approvals: [] })
  expect(w.toasts).toEqual([FORGED('ABC-2')])
})

test('restore: an active run with no record in the store comes back blocked at Intent with no approvals', async ($, on) => {
  const json = JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals: approvalsTo('Plan') }))
  const w = world(on, { files: { 'changes/ABC-2/run.json': json } })
  await begin($)
  expect(w.toasts).toEqual([FORGED('ABC-2')])
  expect(w.run()).toMatchObject({ phase: phaseAt('Intent'), state: 'blocked', reason: FORGED('ABC-2'), approvals: [] })
  expect(await command($, 'ABC-9')).toBe(TEXTS.runActive('ABC-2'))
  await expectRefused($, w, 'ABC-2', FORGED('ABC-2'))
  expect(await command($, 'ABC-9')).toBe(TEXTS.startedJira('ABC-9'))
})

test('restore: a finished or stopped run with no record in the store is skipped without a toast', async ($, on) => {
  const w = world(on, {
    files: {
      'changes/ABC-5/run.json': JSON.stringify(runAt({ id: 'ABC-5', state: 'finished', phase: phaseAt('PR') })),
      'changes/ABC-6/run.json': JSON.stringify(runAt({ id: 'ABC-6', state: 'stopped', phase: phaseAt('Build') })),
    },
  })
  await begin($)
  expect(w.run()).toBeNull()
  expect(w.toasts).toEqual([])
})

test('start: a start writes an empty record, so a restart in Intent restores the run', async ($, on) => {
  const w = world(on, { store: { [`approvals:${ID}`]: recordOf(approvalsTo('PR', ID)) } })
  await begin($)
  await command($, `--strict ${ID}`)
  await w.clock.settle()
  expect(w.store.get(`approvals:${ID}`)).toEqual({ approvedPast: -1, rows: [] })
  await begin($)
  expect(w.toasts).toEqual([])
  expect(w.run()).toMatchObject({ id: ID, phase: 0, state: 'interrupted', approvals: [] })
})

test('no changes folder: no band and no error', async ($, on) => {
  const w = world(on)
  await begin($)
  await everyBand($, lines => {
    expect(lines).toEqual(['engine'])
  })
  expect(w.toasts).toEqual([])
  expect(w.opened).toEqual([])
})

test('a corrupt run.json is skipped with a toast', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-5/run.json': '{ not json',
        'changes/ABC-6/run.json': JSON.stringify(runAt({ phase: phaseAt('Spec'), id: 'ABC-6', state: 'gate', approvals: approvalsTo('Spec', 'ABC-6') })),
      },
    })
  )
  await begin($)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('changes/ABC-5/run.json')
  expect(w.run()?.id).toBe('ABC-6')
})

test('a Claude Code version other than 2.1.314 toasts a warning', async ($, on) => {
  const w = world(on, { version: '2.1.320' })
  await begin($)
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain('2.1.320')
})

// Finish, status, pane

test('PR done finishes: the finish text, the usage table and all six phases done', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK }),
    files: { [phaseFile('PR')]: '---\nphase: pr\nstatus: done\npr-url: https://github.example.com/example/demo/pull/7\nchecks: passed\n---\n' },
  })
  await begin($)
  const r = await turnEnd($, { usage: USAGE })
  await w.clock.settle()
  const book = addTurn({ schema: 'usage-1', rows: {} }, 'PR', USAGE, 120000, true)
  expect(r.text).toBe(`${TEXTS.finishedPr('https://github.example.com/example/demo/pull/7')} Denials: 0.`)
  expect(r.text).not.toContain('\n')
  expect(w.commands).toEqual(['goal clear'])
  expect(w.closed).toEqual([])
  expect(w.run()?.state).toBe('finished')
  const status = await command($, 'status')
  expect(status).toContain('✔ INTENT  ✔ SPEC  ✔ PLAN  ✔ BUILD  ✔ TEST  ✔ PR')
  expect(status).toContain('pr.md: done')
  expect(status).toContain(formatUsage(book, USAGE_FOOTER))
})

test('status: the usage table lists the Intent row first', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Intent'), pendingGoal: true }), answers: ['Approve, start Spec'] })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  w.files.set(phaseFile('Intent'), INTENT_DONE)
  await turnEnd($, { usage: USAGE })
  await w.goal(goalFor('Spec', ID))
  await w.clock.settle()
  await turnEnd($, { usage: USAGE })
  await w.clock.settle()
  const lines = (await command($, 'status'))?.split('\n') ?? []
  const rows = lines.filter(line => line.endsWith('|') && line.includes('| all models |')).map(line => line.split(' | ')[0])
  expect(rows).toEqual(['| Intent', '| Spec', '| All phases'])
})

// The end-of-run summary

const SUMMARY_BOOK = {
  schema: 'usage-1' as const,
  rows: {
    Spec: { models: { m: { input: 1000, output: 9000, cacheRead: 0, cacheWrite: 0 } }, turns: 4, ms: 300000 },
    'Spec gate': { models: { m: { input: 100, output: 900, cacheRead: 0, cacheWrite: 0 } }, turns: 0, ms: 60000 },
    Plan: { models: { m: { input: 2000, output: 18000, cacheRead: 0, cacheWrite: 0 } }, turns: 6, ms: 600000 },
    Build: { models: { m: { input: 10000, output: 190000, cacheRead: 0, cacheWrite: 0 } }, turns: 20, ms: 1800000 },
    'Build rerun 1': { models: { m: { input: 5000, output: 45000, cacheRead: 0, cacheWrite: 0 } }, turns: 8, ms: 600000 },
    Test: { models: { m: { input: 3000, output: 27000, cacheRead: 0, cacheWrite: 0 } }, turns: 5, ms: 300000 },
    PR: { models: { m: { input: 4000, output: 36000, cacheRead: 0, cacheWrite: 0 } }, turns: 7, ms: 420000 },
  },
}
const PR_DONE = [
  '---',
  'phase: pr',
  'status: done',
  'pr-url: https://github.example.com/example/demo/pull/485',
  'checks: passed',
  'fix-rounds: 1',
  '---',
  '',
  '## Review findings',
  '',
  '| Severity | Finding |',
  '| --- | --- |',
  '| Major | The export ignores time zones. |',
  '| **Minor** | A log line repeats. |',
  '- **Minor**: a name reads oddly.',
  '',
  '| # | AC | Severity | Where | Finding |',
  '| --- | --- | --- | --- | --- |',
  '| 1 | AC-10 | Blocker | `a.kt:19` | The toggle is still read, also by a Minor path. |',
  '',
  '## Notes',
  '',
  '- Major refactor some day, not a finding.',
  '',
].join('\n')
const DRAFT_CHECK = `gh pr view sdd/${ID} --json isDraft`

function summaryWorld(on: On, setup: Setup = {}) {
  return world(on, {
    run: runAt({
      phase: phaseAt('PR'),
      goalActive: true,
      pushApproved: true,
      startedAt: NOW - 125 * 60000,
      usage: SUMMARY_BOOK,
      reruns: { Build: 1 },
      ...LOCK,
    }),
    files: { [phaseFile('PR')]: PR_DONE },
    ...setup,
    git: { [DRAFT_CHECK]: [0, '{"isDraft":true}\n'], ...setup.git },
  })
}

test('summary: a finished run logs the summary lines after the one-line finish', async ($, on) => {
  const w = summaryWorld(on)
  await begin($)
  const r = await turnEnd($)
  await w.clock.settle()
  expect(r.text).toBe(`${TEXTS.finishedPr('https://github.example.com/example/demo/pull/485')} Denials: 0.`)
  expect(w.argv).toContain(DRAFT_CHECK)
  expect(w.logs).toEqual([
    `✔ ${ID} finished in 2 h 5 min · 351k tokens (input plus output) · 50 goal turns · Guard level: strict`,
    'PR #485: https://github.example.com/example/demo/pull/485 · checks passed · 1 fix round',
    'Review: 1 Blocker, 1 Major, 2 Minor (see pr.md)',
    'Next: read the whole diff · mark the PR ready by hand.',
  ])
})

test('summary: the first line of a run at review names the level beside the measurements', async ($, on) => {
  const w = summaryWorld(on, {
    run: runAt({
      phase: phaseAt('PR'),
      goalActive: true,
      pushApproved: true,
      startedAt: NOW - 125 * 60000,
      usage: SUMMARY_BOOK,
      reruns: { Build: 1 },
      guardLevel: 'review',
      ...LOCK,
    }),
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.logs[0]).toBe(`✔ ${ID} finished in 2 h 5 min · 351k tokens (input plus output) · 50 goal turns · Guard level: review`)
})

test('summary: a PR that is not a draft adds the warning and drops "Draft" from the finish', async ($, on) => {
  const w = summaryWorld(on, { git: { [DRAFT_CHECK]: [0, '{"isDraft":false}\n'] } })
  await begin($)
  const r = await turnEnd($)
  await w.clock.settle()
  expect(r.text).toBe(`${TEXTS.finishedPrNotDraft('https://github.example.com/example/demo/pull/485')} Denials: 0.`)
  expect(w.logs[2]).toBe(TEXTS.summaryNotDraft)
})

// Sees every /goal-and-do command above the mod and logs it, so a test can count them.
const COMMAND_WATCH = {
  name: 'command-watch',
  tier: 'prepend' as const,
  register(on: On) {
    on('command.run', { command: 'goal-and-do' }, ($, e, next) => {
      $.ui.log(`seen /goal-and-do ${e.args} from ${e.origin.kind}`)
      return next(e)
    })
  },
}

test('summary: a finished run runs /goal-and-do status once, after the summary', { plugins: [COMMAND_WATCH] }, async ($, on) => {
  const w = summaryWorld(on)
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.logs.filter(line => line.startsWith('seen '))).toEqual(['seen /goal-and-do status from plugin'])
  expect(w.logs.at(-1)).toBe('seen /goal-and-do status from plugin')
})

test('summary: a run that ends stuck, stopped or blocked runs no status command', { plugins: [COMMAND_WATCH] }, async ($, on) => {
  const w = summaryWorld(on, { files: { [phaseFile('PR')]: draft('pr') } })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('blocked')
  expect(w.logs.filter(line => line.startsWith('seen '))).toEqual([])
})

test('summary: no PR gives the no-PR line, and no findings skip the review line', async ($, on) => {
  const w = summaryWorld(on, { files: { [phaseFile('PR')]: '---\nphase: pr\nstatus: done\npr-url: none\nchecks: none\n---\n' } })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.logs[1]).toBe(TEXTS.summaryNoPr)
  expect(w.logs.some(line => line.startsWith('Review:'))).toBe(false)
  expect(w.argv).not.toContain(DRAFT_CHECK)
  expect(w.logs.at(-1)).toBe(TEXTS.summaryNext(ID))
})

test('PR done with no GitHub origin says there is no PR', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true }),
    files: { [phaseFile('PR')]: '---\nphase: pr\nstatus: done\npr-url: none\nchecks: none\n---\n' },
  })
  await begin($)
  const r = await turnEnd($)
  expect(r.text).toBe(`${TEXTS.finishedNoPr} Denials: 0.`)
  expect(w.run()?.state).toBe('finished')
})

test('the pane shows the run, each phase file with its status and tokens, and pending suggestions', async ($, on) => {
  const usage = addTurn({ schema: 'usage-1', rows: {} }, 'Spec', USAGE, 1000, true)
  world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', usage, suggested: ['Bash(npm test)'] }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE },
  })
  await begin($)
  for (const surface of SURFACES) {
    for (const columns of COLUMNS) {
      const lines = await pane($, surface, columns)
      expect(lines[0]).toBe(HEAD)
      const rows = await paneRowTexts($, surface, columns)
      expect(rows).toEqual([
        'Intent  intent.md  -             0 tokens',
        'Spec    spec.md    done        210 tokens',
        'Plan    plan.md    to approve    0 tokens',
        'Build   build.md   -             0 tokens',
        'Test    test.md    -             0 tokens',
        'PR      pr.md      -             0 tokens',
      ])
      // The suggested rules start folded, with their count.
      expect(lines).toContain('► Suggested Rules (1)')
      expect(lines.join('\n')).not.toContain('Bash(npm test)')
    }
  }
})

const paneAt = async ($: $T, columns: number) =>
  $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'goal-and-do',
    props: { title: 'goal-and-do', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })

// The pane's drawing as rows of text: a column Box stacks its children and puts its gap as blank rows between them, a
// Box of any other kind is one row, and a Button or a Link shows its label. The kit paints no layout, so this reads it
// off the tree.
interface Drawn {
  type: string
  props?: Record<string, unknown>
  children?: unknown[]
}

function inlineText(node: unknown): string {
  if (typeof node === 'string') return node
  const drawn = node as Drawn
  if (drawn.type === 'Button' || drawn.type === 'Link') return String(drawn.props?.label ?? '')
  return (drawn.children ?? []).map(inlineText).join('')
}

// The pane's rows after the hint on the buttons, which opens every pane, wrapped or not: most tests read from the run's
// header on. Rows that don't start the pane with the hint's words stay as they are.
function afterHint<T>(rows: readonly T[], text: (row: T) => string = row => String(row)): T[] {
  let joined = ''
  for (const [i, row] of rows.entries()) {
    joined = `${joined} ${text(row).trim()}`.trim()
    if (joined === TEXTS.openHint) return rows.slice(i + 1)
    if (!TEXTS.openHint.startsWith(joined)) break
  }
  return [...rows]
}

function rowsOf(node: unknown): string[] {
  const drawn = node as Drawn
  if (typeof node === 'string' || drawn.type !== 'Box' || drawn.props?.flexDirection !== 'column') return [inlineText(node)]
  const gap = Number(drawn.props?.gap ?? 0)
  const blocks = (drawn.children ?? []).map(rowsOf).filter(rows => rows.length > 0)
  return blocks.flatMap((rows, i) => [...(i > 0 ? Array<string>(gap).fill('') : []), ...rows])
}

async function paneRowsAt($: $T, columns: number, placement: 'dock' | 'inline' = 'dock'): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'goal-and-do',
    props: { title: 'goal-and-do', isFocused: false, bodyColumns: columns, placement, scroll: { offset: 0, bodyRows: 80 }, view: {} },
  })
  const rows = rowsOf(await ui.drawn())
  await ui.unmount()
  return afterHint(rows)
}

test("the pane starts with the hint on the buttons, dimmed and in italics, above the run's header", async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Plan'), state: 'gate' }), files: { [phaseFile('Spec')]: SPEC_DONE } })
  await begin($)
  const ui = await paneAt($, 80)
  const rows = rowsOf(await ui.drawn())
  expect(rows.slice(0, 2)).toEqual([TEXTS.openHint, HEAD])
  expect((await ui.find({ type: 'Text', text: TEXTS.openHint }))?.props).toMatchObject({ dimColor: true, italic: true })
  expect(TEXTS.openHint).toBe('Point at a word: the ones that invert are buttons you can click.')
  expect(rows).not.toContain('Click a file name to open it.')
  await ui.unmount()
})

test('the pane shows the hint before any phase file exists, since the header is a button too', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent') }) })
  await begin($)
  const ui = await paneAt($, 80)
  expect(rowsOf(await ui.drawn())[0]).toBe(TEXTS.openHint)
  await ui.unmount()
})

test('the pane wraps the hint where it is wider than the pane, every row dimmed and in italics', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Plan'), state: 'gate' }), files: { [phaseFile('Spec')]: SPEC_DONE } })
  await begin($)
  const narrow = await paneAt($, 20)
  const hint = await narrow.find({ key: 'open-hint' })
  const rows = rowsOf(await narrow.drawn())
  const lines = rows.slice(
    0,
    rows.findIndex(row => /^[▼►] /.test(row))
  )
  expect(hint?.children?.length).toBe(lines.length)
  expect(lines.length).toBeGreaterThan(1)
  for (const line of lines) expect(Array.from(line).length).toBeLessThanOrEqual(20)
  expect(lines.map(line => line.trim()).join(' ')).toBe(TEXTS.openHint)
  for (const found of await narrow.findAll({ type: 'Text', text: /point at|invert|buttons|click/i }))
    expect(found.props).toMatchObject({ dimColor: true, italic: true })
  await narrow.unmount()
})

test('the pane makes each existing phase file a button that opens it, on every surface', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
  })
  await begin($)
  for (const surface of SURFACES) {
    for (const columns of COLUMNS) {
      const ui = await $.ui.mount({
        plugin: 'goal-and-do',
        surface,
        component: 'Pane',
        requestId: 'goal-and-do',
        props: { title: 'goal-and-do', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
      })
      expect((await ui.find({ type: 'Button', key: 'open-Spec' }))?.text).toBe('spec.md')
      expect(await ui.find({ type: 'Button', key: 'open-Build' })).toBeUndefined()
      expect((await ui.find({ key: 'row-Build' }))?.text).toBe('Build   build.md   -           0 tokens')
      const before = w.argv.length
      await ui.press({ key: 'open-Spec' })
      expect(w.argv.slice(before)).toEqual([`open /repo/changes/${ID}/spec.md`])
      await ui.unmount()
    }
  }
})

test('the pane draws the phase names as plain text, with no mark, on every surface', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), files: { [phaseFile('Spec')]: SPEC_DONE } })
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'goal-and-do',
      surface,
      component: 'Pane',
      requestId: 'goal-and-do',
      props: { title: 'goal-and-do', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    const names = (await ui.findAll({ type: 'Text' })).filter(found => (PHASES as readonly string[]).includes(found.text.trim()))
    expect(names.map(found => found.text.trim())).toEqual([...PHASES])
    for (const name of names) {
      expect(name.props.color, name.text).toBeUndefined()
      expect(name.props.dimColor, name.text).toBeUndefined()
    }
    for (const phase of PHASES) expect((await ui.find({ key: `row-${phase}` }))?.text).not.toMatch(/[✔●○✖]/)
    await ui.unmount()
  }
})

test('the pane aligns its columns, groups the tokens, and drops the tokens when narrow', async ($, on) => {
  const usage = addTurn(
    addTurn({ schema: 'usage-1', rows: {} }, 'Build', { ...USAGE, input_tokens: 6_683, output_tokens: 200_200 }, 1000, true),
    'Spec',
    USAGE,
    1000,
    true
  )
  world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', usage, ...LOCK }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Build')]: '---\nphase: build\nstatus: blocked\n---\n' },
  })
  await begin($)
  for (const surface of SURFACES) {
    const rows = await paneRowTexts($, surface, 60)
    expect(rows[phaseAt('Spec')]).toBe('Spec    spec.md    done         210 tokens')
    expect(rows[phaseAt('Build')]).toBe('Build   build.md   blocked  206,883 tokens')
    const starts = rows.map((row, i) => row.indexOf(FILES[PHASES[i]!] ?? ''))
    expect(new Set(starts).size).toBe(1)
    const narrow = await paneRowTexts($, surface, 30)
    expect(narrow[phaseAt('Build')]).toBe('Build   build.md   blocked')
    expect(narrow.every(row => row.length <= 30)).toBe(true)
  }
})

for (const [state, shown, color] of [
  ['running', 'running', 'suggestion'],
  ['blocked', 'blocked', 'error'],
  ['capped', 'capped', 'error'],
  ['interrupted', 'interrupted', 'warning'],
] as const) {
  test(`the pane shows "${shown}" in the current phase's status column while its file is not done (${state})`, async ($, on) => {
    world(on, {
      run: runAt({ phase: phaseAt('Build'), state, goalActive: state === 'running', reason: state === 'blocked' ? 'x' : undefined, ...LOCK }),
      files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Build')]: '---\nphase: build\nstatus: draft\n---\n' },
    })
    await begin($)
    for (const surface of SURFACES) {
      const rows = await paneRowTexts($, surface, 60)
      expect(rows[phaseAt('Build')]).toMatch(new RegExp(`^Build   build.md   ${shown}\\s+0 tokens$`))
      expect(rows[phaseAt('Spec')]).toContain('done')
      expect(rows[phaseAt('Test')]).toMatch(/test.md {4}-\s+0 tokens$/)
      const ui = await paneAt($, 60)
      expect((await ui.find({ type: 'Text', text: new RegExp(`^${shown}\\s*$`) }))?.props).toMatchObject({ color })
      await ui.unmount()
    }
  })
}

test('the pane shows the state where the current phase has no file yet', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }) })
  await begin($)
  const rows = await paneRowTexts($, 'terminal', 60)
  expect(rows[phaseAt('Intent')]).toBe('Intent  intent.md  running  0 tokens')
  expect(rows[phaseAt('Spec')]).toBe('Spec    spec.md    -        0 tokens')
})

test('the pane shows the phase at its gate as "to approve", bold, in the warning color, though its file is done', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE },
  })
  await begin($)
  for (const surface of SURFACES) {
    const gate = await paneRowTexts($, surface, 60)
    expect(gate[phaseAt('Plan')]).toBe('Plan    plan.md    to approve  0 tokens')
    expect(gate[phaseAt('Spec')]).toBe('Spec    spec.md    done        0 tokens')
    expect(gate.join('\n')).not.toMatch(/running|gate/)
  }
  const ui = await paneAt($, 60)
  const status = (await ui.findAll({ type: 'Text' })).find(found => found.text.trim() === 'to approve')
  expect(status?.props).toMatchObject({ color: 'warning', weight: 'bold' })
  await ui.unmount()
})

test('the pane and the band show the gated phase as done once the person approves it', async ($, on) => {
  const w = world(on, { ...PLAN_GATE, files: { ...PLAN_GATE.files, [phaseFile('Spec')]: SPEC_DONE }, answers: ['Approve, start Build'] })
  await begin($)
  const mount = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 124, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  })
  expect((await mount.findAll({ type: 'Text' })).find(found => found.text === '● PLAN')?.props).toMatchObject({ color: 'warning', weight: 'bold' })
  await mount.unmount()
  await command($, 'next')
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  const rows = await paneRowTexts($, 'terminal', 60)
  expect(rows[phaseAt('Plan')]).toBe('Plan    plan.md    done     0 tokens')
  expect((await band($, 'terminal', 120)).join('')).toContain('✔ PLAN  ● BUILD')
})

for (const state of ['blocked', 'capped', 'interrupted'] as const) {
  test(`the pane and the band keep the display of a ${state} phase`, async ($, on) => {
    world(on, {
      run: runAt({ phase: phaseAt('Spec'), state, reason: 'x', turns: state === 'capped' ? TURN_CAPS.Spec : 0 }),
      files: { [phaseFile('Spec')]: draft('spec') },
    })
    await begin($)
    expect((await paneRowTexts($, 'terminal', 60))[phaseAt('Spec')]).toMatch(new RegExp(`^Spec    spec.md    ${state}\\s+0 tokens$`))
    expect((await band($, 'terminal', 160)).join('')).toContain(state === 'interrupted' ? '● SPEC' : '✖ SPEC')
  })
}

test('the pane drops the tokens before the state word when narrow, and keeps its columns aligned', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'interrupted', ...LOCK }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
  })
  await begin($)
  const wide = await paneRowTexts($, 'terminal', 60)
  expect(wide[phaseAt('Build')]).toBe('Build   build.md   interrupted  0 tokens')
  expect(wide[phaseAt('Spec')]).toBe(`Spec    spec.md    done${' '.repeat(9)}0 tokens`)
  const narrow = await paneRowTexts($, 'terminal', 34)
  expect(narrow[phaseAt('Build')]).toBe('Build   build.md   interrupted')
  expect(narrow.every(row => row.length <= 34)).toBe(true)
  const starts = wide.map((row, i) => row.indexOf(FILES[PHASES[i]!] ?? ''))
  expect(new Set(starts).size).toBe(1)
})

// Open in app

const SPEC_PATH = `/repo/changes/${ID}/spec.md`

for (const typed of ['Open spec.md in app', 'Open spec in app', 'open SPEC.MD in app']) {
  test(`gate: "${typed}" opens spec.md in the default app and shows the dialog again; Approve then works`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Spec'), state: 'gate' }),
      files: { [phaseFile('Spec')]: SPEC_DONE },
      answers: [typed, 'Approve, start Plan'],
    })
    await begin($)
    await command($, 'next')
    await w.goal(goalFor('Plan', ID))
    await w.clock.settle()
    expect(w.argv).toContain(`open ${SPEC_PATH}`)
    expect(w.asks.map(ask => ask.question)).toEqual([TEXTS.gateQuestion('Spec', ID, []), TEXTS.gateQuestion('Spec', ID, [])])
    expect(w.asks[1]?.options).toEqual([...TEXTS.gateOptions('Plan'), 'Open spec.md in app'])
    expect(w.commands).toEqual(['clear', `goal ${goalFor('Plan', ID)}`])
    expect(w.run()).toMatchObject({ phase: phaseAt('Plan'), state: 'running' })
    expect(w.toasts).toEqual([])
  })
}

test('gate: when open fails, xdg-open is tried, then a toast gives the path', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate' }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    git: { [`open ${SPEC_PATH}`]: [1, ''], [`xdg-open ${SPEC_PATH}`]: [1, ''] },
    answers: ['Open spec.md in app', undefined],
  })
  await begin($)
  await command($, 'next')
  // The second dialog opens after the open calls fail; a busy runner needs more than one round for that.
  await settleUntil(w, () => w.asks.length >= 2 && w.toasts.length >= 1)
  expect(w.argv).toEqual(expect.arrayContaining([`open ${SPEC_PATH}`, `xdg-open ${SPEC_PATH}`]))
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain(SPEC_PATH)
  expect(w.asks).toHaveLength(2)
  expect(w.run()?.state).toBe('gate')
})

test('stuck: "Open build.md in app" opens the file and shows the dialog again; Rerun then works', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: '---\nphase: build\nstatus: blocked\n---\n\n## Open points\n\n- x\n' },
    answers: ['Open build.md in app', 'Rerun Build now'],
  })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect(w.argv).toContain(`open /repo/changes/${ID}/build.md`)
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]?.options).toEqual(['Walk through the 1 open point', 'Rerun Build now', 'Open build.md in app', 'Stop this run'])
  expect(w.run()).toMatchObject({ state: 'running', reruns: { Build: 1 } })
})

// Open points walk-through

const SPEC_OPEN = [
  '---',
  'phase: spec',
  'status: done',
  '---',
  '',
  '# Spec',
  '',
  '## Open points',
  '',
  '1. Which date format do brokers expect?',
  '2. Round half up or half even?',
  '   Decided (the person, 2026-10-28): half up.',
  '- Who receives the export?',
  '',
  '## Notes',
  '',
  '- Not an open point.',
  '',
].join('\n')
const WALK_GATE = ['Walk through the 2 open points', 'Approve, start Plan', 'Open spec.md in app', 'Stop this run']

test('gate: undecided open points add the walk-through with their count, within four options', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate' }),
    files: { [phaseFile('Spec')]: SPEC_OPEN },
    answers: ['Walk through the 2 open points'],
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]).toEqual({ question: TEXTS.gateQuestion('Spec', ID, [], 2), options: WALK_GATE, header: 'Gate', multiSelect: false })
  expect(w.asks[0]?.question).toContain('2 open points stay open if you approve; Plan carries them.')
  expect(w.prompts).toEqual([`${TEXTS.walkPicked('Spec', 'gate')} ${TEXTS.walkPrompt(ID, 'spec.md', '2026-10-29')}`])
  expect(w.promptAsUser).toEqual([false])
  expect(w.run()?.state).toBe('gate')
  expect(w.commands).toEqual([])
})

test('gate: the Plan gate names how many open points stay open', async ($, on) => {
  const plan = PLAN_DONE.replace('# Plan\n', '# Plan\n\n## Open points\n\n- A?\n- B?\n  Decided: yes\n- C?\n')
  const w = world(
    on,
    withRecord({ run: runAt({ phase: phaseAt('Plan'), state: 'gate', approvals: approvalsTo('Plan', ID) }), files: { [phaseFile('Plan')]: plan } })
  )
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]?.question).toContain('Planned paths: none. 2 open points stay open if you approve. Approve and start Build?')
})

test('gate: typed text naming a walk through counts as the pick', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate' }),
    files: { [phaseFile('Spec')]: SPEC_OPEN },
    answers: ["Let's Walk Through them"],
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.prompts).toEqual([`${TEXTS.walkPicked('Spec', 'gate')} ${TEXTS.walkPrompt(ID, 'spec.md', '2026-10-29')}`])
})

test('gate: with open points a dismissal still means not yet', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), files: { [phaseFile('Spec')]: SPEC_OPEN } })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.prompts).toEqual([])
  expect(w.logs).toEqual([TEXTS.gateText('Spec', ID)])
  expect(w.run()?.state).toBe('gate')
})

test('gate: with every open point decided the dialog stays as before', async ($, on) => {
  const decided = SPEC_OPEN.replace('do brokers expect?', 'do brokers expect?\n   decided: ISO dates').replace(
    '- Who receives the export?',
    '- Who receives the export?\n  DECIDED (the person, 2026-10-28): the broker.'
  )
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), files: { [phaseFile('Spec')]: decided } })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual([...TEXTS.gateOptions('Plan'), 'Open spec.md in app'])
})

for (const [name, points, count] of [
  ['"Still undecided" in the item', ['- Still undecided: date format'], 1],
  ['"Undecided." under the item', ['- Date format?', '  Undecided.'], 1],
  ['"(to be decided)" in the item', ['- Date format (to be decided)'], 1],
  ['"Who decided" as a question', ['- Who decided the format?'], 1],
  ['"Not decided yet" under the item', ['1. Date format?', '   Not decided yet'], 1],
  ['"not Decided:" in the item', ['- Date format, not Decided: yet'], 1],
  ['"yet to be Decided (" in the item', ['- Date format, yet to be Decided (later)'], 1],
  ['"Decided (the person, ...)" under the item', ['- Stubs or mocks?', '  Decided (the person, 2026-10-30): stubs'], 0],
  ['"**Decided:**" under the item', ['- Keep the old export?', '   **Decided:** delete'], 0],
  ['"Decided (" inside the item', ['- Point 2: delete it. Decided (the person, 2026-10-30).'], 0],
  ['"_Decided_" leading the line under the item', ['- Keep it?', '  _Decided_ by the team: keep'], 0],
  ['"- None."', ['- None.'], 0],
  ['"none" as a numbered item', ['1. none'], 0],
  ['one decided, one open', ['- A?', '  Decided: yes', '- B?'], 1],
] as [string, string[], number][]) {
  test(`open points: ${name} counts ${count} undecided`, async ($, on) => {
    const text = ['---', 'phase: spec', 'status: done', '---', '', '## Open points', '', ...points, ''].join('\n')
    const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), files: { [phaseFile('Spec')]: text } })
    await begin($)
    await command($, 'next')
    await w.clock.settle()
    const options = w.asks[0]?.options ?? []
    if (count === 0) expect(options).toEqual([...TEXTS.gateOptions('Plan'), 'Open spec.md in app'])
    else expect(options[0]).toBe(TEXTS.walkThrough(count))
  })
}

test('gate: a refused prompt toasts and gives the prompt to paste', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate' }),
    files: { [phaseFile('Spec')]: SPEC_OPEN },
    answers: ['Walk through the 2 open points'],
    promptRefused: true,
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.toasts).toHaveLength(1)
  expect(w.logs).toEqual([TEXTS.walkPrompt(ID, 'spec.md', '2026-10-29')])
  expect(w.run()?.state).toBe('gate')
})

test('stuck: the walk-through from the stuck dialog submits the prompt for the stuck file', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: SPEC_OPEN.replace('phase: spec', 'phase: build').replace('status: done', 'status: blocked') },
    answers: ['Walk through the 2 open points'],
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual(['Walk through the 2 open points', 'Rerun Build now', 'Open build.md in app', 'Stop this run'])
  expect(w.prompts).toEqual([`${TEXTS.walkPicked('Build', 'stuck')} ${TEXTS.walkPrompt(ID, 'build.md', '2026-10-29', 'stuck')}`])
  expect(w.run()?.state).toBe('blocked')
})

test('stuck: without open points the dialog stays as before', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), files: { [phaseFile('Build')]: draft('build') } })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual([...TEXTS.stuckOptions('Build'), 'Open build.md in app'])
})

// Re-approval of an edited spec

const OLD_SPEC_APPROVAL = { phase: 'Spec' as const, file: `changes/${ID}/spec.md`, sha256: 'ab'.repeat(32), at: NOW - 60000 }

test('Plan gate: an edited spec.md is named in the question and approved again before Plan', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', approvals: [OLD_SPEC_APPROVAL] }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    answers: ['Approve, start Build'],
  })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  expect(w.asks[0]?.question).toBe(`${TEXTS.gateQuestion('Plan', ID, ['tests/acceptance'])} ${TEXTS.changedSinceApproval('spec.md')}`)
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n').slice(-2)
  expect(rows[0]).toBe(`| Spec | changes/${ID}/spec.md | ${SPEC_SHA} | the person who approved | 2026-10-29T18:05:00.000Z |  |`)
  expect(rows[1]?.startsWith(`| Plan | changes/${ID}/plan.md | ${PLAN_SHA} |`)).toBe(true)
  expect(w.json().approvals.map(row => [row.phase, row.sha256])).toEqual([
    ['Spec', 'ab'.repeat(32)],
    ['Spec', SPEC_SHA],
    ['Plan', PLAN_SHA],
  ])
})

test('Plan gate: an edit to plan.md while the dialog is open reopens it and approves nothing', async ($, on) => {
  let isEdited = false
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
    files: { [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    answers: ['Approve, start Build', undefined],
    beforeAnswer: () => {
      if (!isEdited) w.files.set(phaseFile('Plan'), `${PLAN_DONE}\nOne more task.\n`)
      isEdited = true
    },
  })
  await begin($)
  await command($, 'next')
  await w.asked(2)
  await w.clock.settle()
  expect(w.toasts).toEqual([`goal-and-do: changes/${ID}/plan.md changed while the gate was open; review it again.`])
  expect(w.asks.map(ask => ask.question)).toEqual([TEXTS.gateQuestion('Plan', ID, ['tests/acceptance']), TEXTS.gateQuestion('Plan', ID, ['tests/acceptance'])])
  expect(w.files.has(`changes/${ID}/approvals.md`)).toBe(false)
  expect(w.store.has(`lock:${ID}`)).toBe(false)
  expect(w.run()).toMatchObject({ state: 'gate', approvals: [] })
  expect(w.commands).toEqual([])
})

test('Plan gate: an edit to spec.md while the dialog is open reopens it naming spec.md and approves nothing', async ($, on) => {
  let isEdited = false
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', approvals: [{ ...OLD_SPEC_APPROVAL, sha256: SPEC_SHA }] }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    answers: ['Approve, start Build', undefined],
    beforeAnswer: () => {
      if (!isEdited) w.files.set(phaseFile('Spec'), `${SPEC_DONE}\nAC-9: one more.\n`)
      isEdited = true
    },
  })
  await begin($)
  await command($, 'next')
  await w.asked(2)
  await w.clock.settle()
  expect(w.toasts).toEqual([`goal-and-do: changes/${ID}/spec.md changed while the gate was open; review it again.`])
  expect(w.asks[0]?.question).toBe(TEXTS.gateQuestion('Plan', ID, ['tests/acceptance']))
  expect(w.asks[1]?.question).toBe(`${TEXTS.gateQuestion('Plan', ID, ['tests/acceptance'])} ${TEXTS.changedSinceApproval('spec.md')}`)
  expect(w.files.has(`changes/${ID}/approvals.md`)).toBe(false)
  expect(w.run()).toMatchObject({ state: 'gate' })
  expect(w.run()?.approvals).toHaveLength(1)
})

test('Plan gate: with no edit while the dialog is open the shown files are approved', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', approvals: [OLD_SPEC_APPROVAL] }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    answers: ['Approve, start Build'],
  })
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect(w.toasts).toEqual([])
  expect(
    w
      .json()
      .approvals.slice(-2)
      .map(row => [row.phase, row.sha256])
  ).toEqual([
    ['Spec', SPEC_SHA],
    ['Plan', PLAN_SHA],
  ])
})

test('Plan gate: an unchanged spec.md adds only the Plan row', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', approvals: [{ ...OLD_SPEC_APPROVAL, sha256: SPEC_SHA }] }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    answers: ['Approve, start Build'],
  })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  expect(w.asks[0]?.question).toBe(TEXTS.gateQuestion('Plan', ID, ['tests/acceptance']))
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  // approvals.md is written whole: the Spec row of its earlier approval, and no new one.
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n')
  expect(rows.filter(row => row.startsWith('| Spec |'))).toHaveLength(1)
  expect(w.json().approvals.map(row => row.phase)).toEqual(['Spec', 'Plan'])
})

const OLD_INTENT_APPROVAL = { phase: 'Intent' as const, file: `changes/${ID}/intent.md`, sha256: 'cd'.repeat(32), at: NOW - 120000 }

test('Spec gate: an edited intent.md says Spec traced the old intent, and approving approves it again', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate', approvals: [OLD_INTENT_APPROVAL] }),
    files: { [phaseFile('Intent')]: INTENT_APPROVED, [phaseFile('Spec')]: SPEC_DONE },
    answers: ['Approve, start Plan'],
  })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  expect(w.asks[0]?.question).toBe(
    `${TEXTS.gateQuestion('Spec', ID, [])} ${TEXTS.changedSinceApproval('intent.md')} Spec traced the old intent; edit spec.md or rerun Spec first.`
  )
  await w.goal(goalFor('Plan', ID))
  await w.clock.settle()
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n').slice(-2)
  expect(rows[0]).toBe(`| Intent | changes/${ID}/intent.md | ${INTENT_SHA} | the person who approved | 2026-10-29T18:05:00.000Z |  |`)
  expect(rows[1]?.startsWith(`| Spec | changes/${ID}/spec.md | ${SPEC_SHA} |`)).toBe(true)
  expect(w.files.get(phaseFile('Intent'))).toBe(INTENT_APPROVED)
})

test('Plan gate: an edited intent.md and spec.md name both, with the trace sentence after intent.md', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', approvals: [OLD_INTENT_APPROVAL, OLD_SPEC_APPROVAL] }),
    files: { [phaseFile('Intent')]: INTENT_APPROVED, [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE },
  })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  expect(w.asks[0]?.question).toBe(
    [
      TEXTS.gateQuestion('Plan', ID, ['tests/acceptance']),
      TEXTS.changedSinceApproval('intent.md'),
      TEXTS.intentChanged,
      TEXTS.changedSinceApproval('spec.md'),
    ].join(' ')
  )
  await w.clock.settle()
})

// Colors

test('the band draws each part in its theme color, on terminal and desktop', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  let shown = 0
  for (const surface of SURFACES) {
    for (const columns of COLUMNS) {
      const ui = await $.ui.mount({
        plugin: 'goal-and-do',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: columns, scroll: { offset: 0, bodyRows: 4 }, view: {} },
      })
      const part = async (text: string) => (await ui.find({ type: 'Text', text }))?.props
      expect(await part('● BUILD')).toMatchObject({ color: 'claude', weight: 'bold' })
      expect(await part('✔ SPEC')).toMatchObject({ color: 'success' })
      expect(await part('TEST')).toMatchObject({ color: 'inactive', dimColor: true })
      // A narrow band leaves a plain "working" out to stay on one line; where it shows, it has its color.
      const working = await part('working')
      if (working !== undefined) {
        shown++
        expect(working).toMatchObject({ color: 'suggestion' })
      }
      await ui.unmount()
    }
  }
  expect(shown).toBeGreaterThan(0)
})

test('the band shows the goal turn against the cap in place of the run ID, and no turn part at a gate or when blocked', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), turns: 2, goalActive: true, ...LOCK }),
    turn: { startedAt: NOW - 12 * 60_000, calls: 4 },
  })
  await begin($)
  for (const surface of SURFACES) {
    const text = (await band($, surface, 120)).join('')
    expect(text).toBe('✔ INTENT  ✔ SPEC  ✔ PLAN  ● BUILD  TEST  PR    turn 3/40 · 12 min · 4 calls · working')
    expect(text).not.toContain(ID)
  }
  expect(w.run()?.id).toBe(ID)
})

test('the band leaves the minutes out when no goal turn runs or the turn atom is missing', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), turns: 0, pendingGoal: true, goalActive: false, ...LOCK }),
    turn: { startedAt: NOW - 90 * 60_000, calls: 4 },
  })
  await begin($)
  expect((await band($, 'terminal', 120)).join('')).toBe('✔ INTENT  ✔ SPEC  ✔ PLAN  ● BUILD  TEST  PR    turn 0/40 · working')
})

test('the band leaves the minutes out when a running goal has no turn atom', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Plan'), turns: 1, goalActive: true }) })
  await begin($)
  expect((await band($, 'terminal', 120)).join('')).toBe('✔ INTENT  ✔ SPEC  ● PLAN  BUILD  TEST  PR    turn 1/20 · working')
})

test('the band at a gate and when blocked has the state text after the marks and no run ID', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Plan'), state: 'gate' }), files: { [phaseFile('Spec')]: SPEC_DONE } })
  await begin($)
  for (const surface of SURFACES) {
    expect((await band($, surface, 120)).join('')).toBe('✔ INTENT  ✔ SPEC  ● PLAN  BUILD  TEST  PR    waiting: approve Plan with /goal-and-do next')
  }
})

test('the band when blocked has the state text after the marks and no turn part', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', ...LOCK }) })
  await begin($)
  for (const surface of SURFACES) {
    const text = (await band($, surface, 120)).join('')
    expect(text).toBe('✔ INTENT  ✔ SPEC  ✔ PLAN  ✖ BUILD  TEST  PR    stuck: see build.md, then type /goal-and-do next')
  }
})

test('no band line is longer than its columns at 40, 60, 80, 120 and 150, with the minutes and the calls', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), turns: 2, goalActive: true, prUrl: 'https://github.example.com/o/r/pull/485', ...LOCK }),
    turn: { startedAt: NOW - 12 * 60_000, calls: 7 },
  })
  await begin($)
  expect((await band($, 'terminal', 150)).join('')).toContain('turn 3/40 · 12 min · 7 calls · working · PR #485')
  for (const surface of SURFACES) {
    for (const columns of [40, 60, 80, 120, 150]) {
      const ui = await $.ui.mount({
        plugin: 'goal-and-do',
        surface,
        component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: columns, scroll: { offset: 0, bodyRows: 12 }, view: {} },
      })
      // The band's box holds the line boxes: leave it out.
      const rows = (await ui.findAll({ type: 'Box' })).filter(found => found.key !== 'band')
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThanOrEqual(2)
      for (const row of rows) expect(`${columns} ${row.text.length <= columns - 4}`).toBe(`${columns} true`)
      await ui.unmount()
    }
  }
})

test('the band sits in a bold box, one blank row below the lines above it', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }) })
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'goal-and-do',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
    })
    expect((await ui.find({ type: 'Box', key: 'band' }))?.props).toMatchObject({
      marginTop: 1,
      borderStyle: 'bold',
      borderColor: 'subtle',
      paddingX: 1,
    })
    await ui.unmount()
  }
})

test('the band draws a blocked phase in the error color', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', ...LOCK }) })
  await begin($)
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  })
  expect((await ui.find({ type: 'Text', text: '✖ BUILD' }))?.props).toMatchObject({ color: 'error', weight: 'bold' })
  await ui.unmount()
})

test('the pane colors each status', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', ...LOCK }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Build')]: '---\nphase: build\nstatus: blocked\n---\n' },
  })
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'goal-and-do',
      surface,
      component: 'Pane',
      requestId: 'goal-and-do',
      props: { title: 'goal-and-do', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect((await ui.find({ type: 'Text', text: /^-\s*$/ }))?.props).toMatchObject({ color: 'inactive' })
    expect((await ui.find({ type: 'Text', text: /^done\s*$/ }))?.props).toMatchObject({ color: 'success' })
    expect((await ui.find({ type: 'Text', text: /^blocked\s*$/ }))?.props).toMatchObject({ color: 'error' })
    await ui.unmount()
  }
})

// Paths from the project root

test('a shell cd into the change folder moves no path: phase files, run.json, restore and git stay at the root', async ($, on) => {
  const w = world(
    on,
    withRecord({
      cwd: `/repo/changes/${ID}`,
      files: {
        [`changes/${ID}/run.json`]: JSON.stringify(runAt({ phase: phaseAt('Test'), state: 'interrupted', ...LOCK, approvals: approvalsTo('Test', ID) })),
        [phaseFile('Test')]: done('test'),
      },
      store: { [`lock:${ID}`]: LOCK },
    })
  )
  await begin($)
  expect(w.rawPaths).toContain('/repo/changes')
  expect(w.run()).toMatchObject({ state: 'interrupted' })
  await command($, 'next')
  await w.clock.settle()
  expect(w.commands.at(-1)).toBe(`goal ${goalFor('Test', ID)}`)
  expect(w.rawPaths).toContain(`/repo/changes/${ID}/test.md`)
  w.files.set(phaseFile('Test'), done('test'))
  await turnEnd($)
  await w.clock.settle()
  expect(w.rawPaths).toContain(`/repo/changes/${ID}/test.md`)
  expect(w.run()).toMatchObject({ phase: phaseAt('PR'), state: 'running' })
  expect(w.commands.at(-1)).toBe(`goal ${goalFor('PR', ID)}`)
  expect(w.rawPaths).toContain(`/repo/changes/${ID}/run.json`)
  const outside = w.rawPaths.filter(path => !path.startsWith('/repo/') && path !== '/repo/changes' && !path.endsWith('/.claude-plugin/plugin.json'))
  expect(outside).toEqual([])
  expect(w.rawPaths.some(path => path.includes(`changes/${ID}/changes/`))).toBe(false)
  expect(w.processCwds.every(cwd => cwd === '/repo')).toBe(true)
})

// Guard and push

test('the guard fails closed: with the state read throwing, git push --force is still denied', async ($, on) => {
  on('state.get', () => ({ deny: 'the state store is gone' }))
  on('tool.call', () => ({ result: {} }))
  const r = await $.tool.call({ tool: 'Bash', command: 'git push --force' })
  expect(r.deny).toBe('goal-and-do: the guard failed, so the call is blocked. See the debug log.')
})

test('the guard denies what it reads as unsafe during a run and passes it without one', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  const edit = await $.tool.call({ tool: 'Edit', file_path: '/repo/tests/acceptance/a.test.ts', old_string: 'a', new_string: 'b' })
  expect(edit.deny).toContain('acceptance tests')
  const fine = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(fine.deny).toBeUndefined()
})

test('push: the first push opens the push dialog; yes runs the lock check and lets it and the PR commands through', async ($, on) => {
  const push = `git push -u origin sdd/${ID}`
  const w = world(
    on,
    withRecord({
      run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }),
      answers: ['Push and open the draft PR'],
    })
  )
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: push })
  expect(r.deny).toBeUndefined()
  expect(w.asks[0]).toEqual({
    question: `${TEXTS.pushQuestion(ID)} ${NO_SIGNALS}${NO_WEAKENING}`,
    options: ['Push and open the draft PR', 'Open the PR body in app', 'Not now'],
    header: 'Push',
    multiSelect: false,
  })
  expect(w.argv).toContain(g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance'))
  expect(w.argv).toContain(g('ls-files --others --exclude-standard -- tests/acceptance'))
  expect(w.run()?.pushApproved).toBe(true)

  const decide = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: 'toolu_x' })).decision
  // The engine decides on the call as the mod rewrote it: the forced push is allowed, Claude's own words never reach it.
  expect(await decide(forcedPush(`-u origin sdd/${ID}`))).toBe('allow')
  expect(await decide(push)).toBe('ask')
  expect(await decide('gh pr create --draft --base main --title "ABC-43224" --body-file changes/ABC-43224/pr-body.md')).toBe('allow')
  expect(await decide(`gh pr checks sdd/${ID} --watch`)).toBe('allow')
  expect(await decide(`timeout 600 gh pr checks sdd/${ID} --watch`)).toBe('allow')
  // No PR URL yet, so a number names no PR of the run.
  expect(await decide('gh pr checks 7 --watch')).toBe('ask')
  expect(await decide(`gh pr edit sdd/${ID} --add-label sdd`)).toBe('ask')
  expect(await decide('gh pr create --title x')).toBe('ask')
  expect(await decide('gh pr merge 7')).toBe('ask')
  expect(await decide('git push origin main')).toBe('ask')

  await $.tool.call({ tool: 'Bash', command: push })
  expect(w.asks).toHaveLength(1)
  expect(w.argv.filter(line => line.startsWith(g('diff --quiet')))).toHaveLength(2)
})

test('push: only an ask the engine made by default is turned into allow', async ($, on) => {
  const push = `git push origin sdd/${ID}`
  const decide = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: 'toolu_x' })).decision
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }),
    answers: ['Push and open the draft PR'],
    askWith: { setting: 'permissions.ask' },
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: push })
  expect(w.run()?.pushApproved).toBe(true)
  expect(await decide(push)).toBe('ask')
  expect(await decide('gh pr checks 7 --watch')).toBe('ask')
})

test('push: an ask from a settings rule stays an ask', async ($, on) => {
  const decide = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: 'toolu_x' })).decision
  world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK }), askWith: { rule: 'Bash(gh pr:*)' } })
  await begin($)
  expect(await decide('gh pr checks 7 --watch')).toBe('ask')
})

test("push: checks and edit run without a prompt only for the run's own PR, by its number or sdd/<id>", async ($, on) => {
  const decide = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: 'toolu_x' })).decision
  world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, prUrl: PR_URL, ...LOCK }) })
  await begin($)
  for (const command of [
    'gh pr checks 485 --watch',
    `gh pr checks sdd/${ID} --json name,bucket`,
    `gh pr edit 485 --body-file changes/${ID}/pr-body.md`,
    `gh pr edit sdd/${ID} --title x`,
    'timeout 540 gh pr checks 485 --watch --interval 60',
  ]) {
    expect(await decide(command), command).toBe('allow')
  }
  for (const command of [
    'gh pr checks 99 --watch',
    'gh pr checks 4850',
    'gh pr checks 048',
    `gh pr edit 99 --body-file changes/${ID}/pr-body.md`,
    'gh pr checks --watch',
    `gh pr edit --body-file changes/${ID}/pr-body.md`,
    `gh pr checks 485 sdd/${ID}`,
    'gh pr checks sdd/ABC-1',
  ]) {
    expect(await decide(command), command).toBe('ask')
  }
})

test('push: a PR follow-up for another repo or a body file outside the run stays an ask', async ($, on) => {
  const decide = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: 'toolu_x' })).decision
  world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, prUrl: 'https://github.example.com/example/demo/pull/12', ...LOCK }),
  })
  await begin($)
  expect(await decide('gh pr edit 12 -R other/repo --body-file x')).toBe('ask')
  expect(await decide('gh pr edit 12 --repo other/repo')).toBe('ask')
  expect(await decide('gh pr edit 12 --repo=other/repo')).toBe('ask')
  expect(await decide('gh pr checks 12 -Rother/repo')).toBe('ask')
  expect(await decide('gh pr create -dR other/repo --title x')).toBe('ask')
  expect(await decide('gh pr edit 12 --body-file /tmp/x')).toBe('ask')
  expect(await decide('gh pr edit 12 --body-file=/tmp/x')).toBe('ask')
  expect(await decide('gh pr edit 12 -F /tmp/x')).toBe('ask')
  expect(await decide(`gh pr edit 12 --body-file changes/${ID}/../../etc/x`)).toBe('ask')
  expect(await decide('gh pr edit 12 --body-file changes/ABC-1/pr-body.md')).toBe('ask')
  expect(await decide('gh pr edit 12 --body-file')).toBe('ask')
  expect(await decide(`gh pr edit 12 --body-file changes/${ID}/pr-body.md`)).toBe('allow')
  expect(await decide(`gh pr edit 12 -F changes/${ID}/pr-body.md`)).toBe('ask')
  // In the git dir only the run's own body file: never the shared name of earlier versions, nor another run's.
  expect(await decide(`gh pr create --draft --base main --body-file .git/goal-and-do/pr-body-${ID}.md --title x`)).toBe('allow')
  expect(await decide(`gh pr edit 12 --body-file .git/goal-and-do/pr-body-${ID}.md`)).toBe('allow')
  expect(await decide('gh pr create --draft --base main --body-file .git/goal-and-do/pr-body.md --title x')).toBe('ask')
  expect(await decide('gh pr create --draft --base main --body-file .git/goal-and-do/pr-body-ABC-1.md --title x')).toBe('ask')
  expect(await decide('gh pr edit 12 --body-file .git/goal-and-do/body.md')).toBe('ask')
  expect(await decide(`gh pr edit 12 --body-file .git/goal-and-do/pr-title-${ID}.txt`)).toBe('ask')
})

test('push: the PR follow-ups are an allow-list of subcommands, flags and arguments', async ($, on) => {
  const decide = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: 'toolu_x' })).decision
  world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, prUrl: 'https://github.example.com/example/demo/pull/7', ...LOCK }),
  })
  await begin($)
  for (const command of [
    'GH_REPO=o/r gh pr checks 7',
    'gh pr checks https://x/o/r/pull/7',
    'gh pr edit o:branch --title x',
    'gh pr create --draft --template x',
    'gh pr create --draft --recover f',
    'nice gh pr checks 7',
    'env gh pr checks 7',
    'timeout 5 nice gh pr checks 7',
    'command gh pr checks 7',
    'gh pr checks 7 --watch=false',
    'gh pr checks 7 --interval',
    'gh pr checks 7 8 --web',
    'gh pr create --title x',
    'gh pr create --draft 7',
    'gh pr create --draft --head other:sdd/ABC-43224',
    // The PR goes against the run's own base, and names it.
    `gh pr create --draft --head sdd/${ID} --title x`,
    `gh pr create --draft --head sdd/${ID} --base develop --title x`,
    'gh pr view 7',
    'gh pr checks 7; gh pr merge 7',
  ]) {
    expect(await decide(command), command).toBe('ask')
  }
  for (const command of [
    'timeout 540 gh pr checks 7 --watch --interval 60',
    'gh pr checks 7 --json name,bucket',
    'gh pr checks sdd/ABC-43224 --required --fail-fast',
    'gh pr checks --interval=30 7',
    `gh pr edit 7 --body-file changes/${ID}/pr-body.md`,
    `gh pr edit sdd/${ID} --title 'ABC-43224 fix'`,
    `gh pr create --draft --base main --title 'x' --body-file .git/goal-and-do/pr-body-${ID}.md`,
    `gh pr create --draft --head sdd/${ID} --base=main --title x`,
  ]) {
    expect(await decide(command), command).toBe('allow')
  }
})

for (const typed of ['Open the PR body in app', 'open the body in app']) {
  test(`push: "${typed}" opens the PR body and pr.md, shows the push dialog again, and the push then goes`, async ($, on) => {
    const w = world(
      on,
      withRecord({
        run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }),
        files: { [`.git/goal-and-do/pr-body-${ID}.md`]: '# ABC-43224\n', [phaseFile('PR')]: draft('pr') },
        git: { [g(`rev-parse --git-path goal-and-do/pr-body-${ID}.md`)]: [0, `.git/goal-and-do/pr-body-${ID}.md\n`] },
        answers: [typed, 'Push and open the draft PR'],
      })
    )
    await begin($)
    const r = await $.tool.call({ tool: 'Bash', command: `git push -u origin sdd/${ID}` })
    expect(r.deny).toBeUndefined()
    expect(w.argv).toContain(`open /repo/.git/goal-and-do/pr-body-${ID}.md`)
    expect(w.argv).toContain(`open /repo/changes/${ID}/pr.md`)
    expect(w.asks.map(ask => ask.question)).toEqual(Array(2).fill(`${TEXTS.pushQuestion(ID)} ${NO_SIGNALS}${NO_WEAKENING}`))
    expect(w.run()?.pushApproved).toBe(true)
    expect(w.toasts).toEqual([])
  })
}

test("push: another run's PR body, or the shared one of earlier versions, is never opened", async ($, on) => {
  const w = world(
    on,
    withRecord({
      run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }),
      files: { '.git/goal-and-do/pr-body.md': '# old\n', '.git/goal-and-do/pr-body-ABC-1.md': '# other\n', [phaseFile('PR')]: draft('pr') },
      answers: ['Open the PR body in app', 'Not now'],
    })
  )
  await begin($)
  await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(w.argv).toContain(g(`rev-parse --git-path goal-and-do/pr-body-${ID}.md`))
  expect(w.argv.filter(line => line.startsWith('open '))).toEqual([])
  expect(w.rawPaths.some(path => /pr-body(-ABC-1)?\.md$/.test(path))).toBe(false)
  expect(w.toasts[0]).toContain(`pr-body-${ID}.md`)
})

test('push: a missing PR body toasts and shows the push dialog again', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }),
    git: { [g(`rev-parse --git-path goal-and-do/pr-body-${ID}.md`)]: [0, `.git/goal-and-do/pr-body-${ID}.md\n`] },
    answers: ['Open the PR body in app', 'Not now'],
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain(`/repo/.git/goal-and-do/pr-body-${ID}.md`)
  expect(w.asks).toHaveLength(2)
  expect(r.deny).toBe('goal-and-do: you chose not to push yet.')
  expect(w.argv.some(line => line.startsWith('open '))).toBe(false)
})

// The draft PR

const PR_URL = 'https://github.example.com/example/demo/pull/485'
const PR_CREATE = `gh pr create --draft --base main --title 'x' --body-file .git/goal-and-do/pr-body-${ID}.md`

test('pr url: a gh pr create that prints the PR URL stores it in the run', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK }),
    files: { [`.git/goal-and-do/pr-body-${ID}.md`]: 'Summary of the change.\n' },
    bashOut: { [PR_CREATE]: `Creating draft pull request\n${PR_URL}\n` },
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: PR_CREATE })
  expect(w.run()?.prUrl).toBe(PR_URL)
  expect(w.json().prUrl).toBe(PR_URL)
})

test('pr url: the pane shows PR #<n> as a link, and the band shows it at 120 columns and leaves it out at 68 to keep one line', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, prUrl: PR_URL, ...LOCK }) })
  await begin($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'goal-and-do',
      surface,
      component: 'Pane',
      requestId: 'goal-and-do',
      props: { title: 'goal-and-do', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect((await ui.find({ type: 'Link', text: 'PR #485' }))?.props.href).toBe(PR_URL)
    await ui.unmount()
    expect((await band($, surface, 120)).join('')).toContain('PR #485')
    // Too narrow for one line, the whole tail goes to line 2.
    expect((await band($, surface, 68)).join('')).toBe('✔ INTENT  ✔ SPEC  ✔ PLAN  ✔ BUILD  ✔ TEST  ● PR    turn 0/60')
  }
})

test('pr url: a restore takes pr-url from pr.md when the run has none', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        [`changes/${ID}/run.json`]: JSON.stringify(runAt({ phase: phaseAt('PR'), state: 'blocked', reason: 'x', ...LOCK, approvals: approvalsTo('PR', ID) })),
        [phaseFile('PR')]: `---\nphase: pr\nstatus: blocked\npr-url: ${PR_URL}\n---\n`,
      },
      store: { [`lock:${ID}`]: LOCK },
    })
  )
  await begin($)
  expect(w.run()?.prUrl).toBe(PR_URL)
})

test('pr url: a run.json prUrl that is no PR URL is dropped at restore', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        [`changes/${ID}/run.json`]: JSON.stringify(
          runAt({ phase: phaseAt('PR'), state: 'blocked', reason: 'x', ...LOCK, approvals: approvalsTo('PR', ID), prUrl: 'javascript:alert(1)' })
        ),
      },
      store: { [`lock:${ID}`]: LOCK },
    })
  )
  await begin($)
  expect(w.run()?.prUrl).toBeUndefined()
})

test('push: Not now denies the push and blocks the run', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }), answers: ['Not now'] })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBe('goal-and-do: you chose not to push yet.')
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'you chose not to push yet', pushApproved: false })
  expect(w.ran).toEqual([])
  expect(w.logs).toEqual([TEXTS.pushContinue])
})

test('push: a dismissed push dialog denies the push and says how to continue', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }) })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBe('goal-and-do: you chose not to push yet.')
  expect(w.logs).toEqual([TEXTS.pushContinue])
})

for (const [name, answers] of [
  ['"Not yet, I\'ll fix it first"', ["Not yet, I'll fix it first"]],
  ['a dismissal', [undefined]],
  ['typed approval', ['ok']],
] as [string, (string | undefined)[]][]) {
  test(`stuck: ${name} says how to continue and keeps the run blocked`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), files: { [phaseFile('Build')]: draft('build') }, answers })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.asks).toHaveLength(1)
    expect(w.logs).toEqual([TEXTS.stuckContinue('Build')])
    expect(w.run()?.state).toBe('blocked')
  })
}

test('push: a changed acceptance test blocks the push', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK }),
    git: { [g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance')]: [1, ''] },
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBe('goal-and-do blocks the push: the acceptance tests changed since Plan approval.')
  expect(w.asks).toEqual([])
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval' })
})

test('Intent phase: the guard resolves edits against the project root and allows only the change folder', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }), cwd: '/repo/src' })
  await begin($)
  const inside = await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/intent.md`, content: 'x' })
  expect(inside.deny).toBeUndefined()
  const relative = await $.tool.call({ tool: 'Write', file_path: `changes/${ID}/intent.md`, content: 'x' })
  expect(relative.deny).toBe('goal-and-do allows edits only in the change folder during the Intent phase.')
  const outside = await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'a', new_string: 'b' })
  expect(outside.deny).toBe('goal-and-do allows edits only in the change folder during the Intent phase.')
  const mcp = await $.tool.call({ tool: 'mcp__confluence__getPage' })
  expect(mcp.deny).toBe('goal-and-do allows only Jira reads during the Intent phase.')
  const jira = await $.tool.call({ tool: 'mcp__jira__getIssue' })
  expect(jira.deny).toBeUndefined()
})

test('Intent phase: a Write through a symbolic link in the change folder to a path outside it is denied', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
    files: { 'src/b.ts': 'x', [`changes/${ID}/request.md`]: 'x' },
    links: { [`changes/${ID}/s`]: '/repo/src' },
  })
  await begin($)
  const through = await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/s/a.ts`, content: 'x' })
  expect(through.deny).toBe('goal-and-do allows edits only in the change folder during the Intent phase.')
  const back = await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/s/../intent.md`, content: 'x' })
  expect(back.deny).toBe('goal-and-do allows edits only in the change folder during the Intent phase.')
  const inside = await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/notes/new/a.md`, content: 'x' })
  expect(inside.deny).toBeUndefined()
})

const UNPLACED = 'goal-and-do blocks an edit whose path it cannot follow: a symbolic link on it leads nowhere or cannot be read.'
const STORE_DENIED = 'goal-and-do blocks edits to its store. The mod writes it.'

test('Intent phase: a Write through a dangling symbolic link in the change folder is denied; a new file there passes', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
    files: { [`changes/${ID}/request.md`]: 'x' },
    links: { [`changes/${ID}/s`]: '/repo/src' },
  })
  await begin($)
  expect((await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/s/a.ts`, content: 'x' })).deny).toBe(UNPLACED)
  expect((await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/s`, content: 'x' })).deny).toBe(UNPLACED)
  expect((await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/intent.md`, content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/notes/new/a.md`, content: 'x' })).deny).toBeUndefined()
})

test('Build: a Write through a dangling symbolic link under changes/ is denied, approvals.md included', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [`changes/${ID}/approvals.md`]: 'x', 'src/a.ts': 'x' },
    links: { [`changes/${ID}/s`]: '/repo/changes/ABC-9' },
  })
  await begin($)
  expect((await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/s/approvals.md`, content: 'x' })).deny).toBe(UNPLACED)
  expect((await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/notes.md`, content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/src/new/b.ts', content: 'x' })).deny).toBeUndefined()
})

test('Build: Writes through dangling links to a CI file, a locked test and the local settings are denied; a new src file passes', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { 'docs/readme.md': 'x', 'src/a.ts': 'x' },
    links: {
      'docs/ci.yml': '/repo/.github/workflows/new.yml',
      'docs/t.ts': '/repo/tests/acceptance/new.test.ts',
      'docs/s.json': '/repo/.claude/settings.local.json',
    },
  })
  await begin($)
  for (const path of ['docs/ci.yml', 'docs/t.ts', 'docs/s.json']) {
    expect((await $.tool.call({ tool: 'Write', file_path: `/repo/${path}`, content: 'x' })).deny, path).toBe(UNPLACED)
  }
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'x' })).deny).toBeUndefined()
})

test('Build: a new file three folders deep passes though listing a missing folder fails without ENOENT', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { 'src/a.ts': 'x' },
    listError: 'EIO: i/o error',
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/src/one/two/three/new.ts', content: 'x' })
  expect(r.deny).toBeUndefined()
  // The one path there is the file itself: whether it exists, for the recent files.
  const listed = w.rawPaths.filter(path => path.startsWith('/repo/src/one') && path !== '/repo/src/one/two/three/new.ts')
  expect(listed).toEqual([])
})

test('a dangling link at any depth is still denied, with listing a missing folder failing without ENOENT', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { 'src/a/b/x.ts': 'x', 'src/c.ts': 'x' },
    links: { 'src/a/b/s': '/repo/nowhere', 'src/l': '/repo/gone' },
    listError: 'EIO: i/o error',
  })
  await begin($)
  for (const path of ['/repo/src/a/b/s/new.ts', '/repo/src/a/b/s', '/repo/src/l/x/y.ts']) {
    expect((await $.tool.call({ tool: 'Write', file_path: path, content: 'x' })).deny, path).toBe(UNPLACED)
  }
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/src/a/b/new/../x2.ts', content: 'x' })).deny).toBeUndefined()
})

const STORE_FILE = '/Users/me/.claude/plugins/store/goal-and-do_local-1a2b3c.json'

for (const phase of ['Spec', 'Plan', 'Build'] as const) {
  test(`${phase}: a Write and an Edit to the store file are denied, under HOME's .claude`, async ($, on) => {
    world(on, { run: runAt({ phase: phaseAt(phase), goalActive: true, ...(phase === 'Build' ? LOCK : {}) }) })
    mock.env(on, { HOME: '/Users/me' })
    await begin($)
    expect((await $.tool.call({ tool: 'Write', file_path: STORE_FILE, content: '{}' })).deny).toBe(STORE_DENIED)
    expect((await $.tool.call({ tool: 'Edit', file_path: STORE_FILE, old_string: 'a', new_string: 'b' })).deny).toBe(STORE_DENIED)
    expect((await $.tool.call({ tool: 'Bash', command: `cat ${STORE_FILE}` })).deny).toBe(STORE_DENIED)
    expect((await $.tool.call({ tool: 'Bash', command: `echo {} > ${STORE_FILE}` })).deny).toBe(STORE_DENIED)
    expect((await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'x' })).deny).toBeUndefined()
  })

  test(`${phase}: a Write and an Edit that land on the store through a link are denied, under CLAUDE_CONFIG_DIR`, async ($, on) => {
    world(on, {
      run: runAt({ phase: phaseAt(phase), goalActive: true, ...(phase === 'Build' ? LOCK : {}) }),
      files: { '.config-claude/plugins/store/goal-and-do_local-1a2b3c.json': '{}', 'docs/readme.md': 'x' },
      links: { 'docs/s.json': '/repo/.config-claude/plugins/store/goal-and-do_local-1a2b3c.json' },
    })
    mock.env(on, { CLAUDE_CONFIG_DIR: '/repo/.config-claude', HOME: '/Users/me' })
    await begin($)
    expect((await $.tool.call({ tool: 'Write', file_path: '/repo/docs/s.json', content: '{}' })).deny).toBe(STORE_DENIED)
    expect((await $.tool.call({ tool: 'Edit', file_path: '/repo/docs/s.json', old_string: 'a', new_string: 'b' })).deny).toBe(STORE_DENIED)
    const direct = '/repo/.config-claude/plugins/store/goal-and-do_local-1a2b3c.json'
    expect((await $.tool.call({ tool: 'Write', file_path: direct, content: '{}' })).deny).toBe(STORE_DENIED)
  })
}

test('the store rule fails closed: with no config folder known, an edit with the parts plugins/store is denied', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  expect((await $.tool.call({ tool: 'Write', file_path: STORE_FILE, content: '{}' })).deny).toBe(STORE_DENIED)
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/src/new.ts', content: 'x' })).deny).toBeUndefined()
})

test('Intent phase: a chain of symbolic links is followed to its end', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
    files: { [`changes/${ID}/notes/x.md`]: 'x', 'src/b.ts': 'x' },
    links: {
      [`changes/${ID}/a`]: `/repo/changes/${ID}/b`,
      [`changes/${ID}/b`]: `/repo/changes/${ID}/notes`,
      [`changes/${ID}/c`]: `/repo/changes/${ID}/d`,
      [`changes/${ID}/d`]: '/repo/src',
    },
  })
  await begin($)
  expect((await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/a/y.md`, content: 'x' })).deny).toBeUndefined()
  expect((await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/c/y.ts`, content: 'x' })).deny).toBe(
    'goal-and-do allows edits only in the change folder during the Intent phase.'
  )
})

test('Intent phase: the guard allows only Git commands for the change folder in the shell', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }) })
  await begin($)
  const write = await $.tool.call({ tool: 'Bash', command: 'echo x > src/a.ts' })
  expect(write.deny).toBe('goal-and-do allows only Git commands for the change folder during the Intent phase.')
  const add = await $.tool.call({ tool: 'Bash', command: `git add changes/${ID}/request.md changes/${ID}/intent.md` })
  expect(add.deny).toBeUndefined()
})

test('the guard blocks an edit that lands on approvals.md through a symbolic link, and shell writes to run.json', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [`changes/${ID}/approvals.md`]: 'x' },
    links: { 'docs/a.md': `/repo/changes/${ID}/approvals.md` },
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/docs/a.md', content: 'x' })
  expect(r.deny).toBe('goal-and-do blocks edits to approvals.md. The mod writes it at each gate.')
  const sed = await $.tool.call({ tool: 'Bash', command: `sed -i s/a/b/ changes/${ID}/run.json` })
  expect(sed.deny).toBe('goal-and-do blocks edits to run.json. The mod writes it.')
})

test('the guard judges Monitor like Bash, and the Intent phase denies tools off its list', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  const r = await $.tool.call({ tool: 'Monitor', command: `echo x > changes/${ID}/approvals.md`, description: 'x', timeout_ms: 1000 })
  expect(r.deny).toBe('goal-and-do blocks edits to approvals.md. The mod writes it at each gate.')
})

test('Intent phase: Monitor and Agent are denied as tools off the Intent list', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }) })
  await begin($)
  const text = 'goal-and-do allows only reading, the change folder, Git and Jira reads during the Intent phase.'
  const monitor = await $.tool.call({ tool: 'Monitor', command: 'echo x > src/a.ts', description: 'x', timeout_ms: 1000 })
  expect(monitor.deny).toBe(text)
  const agent = await $.tool.call({ tool: 'Agent', description: 'x', prompt: 'x' })
  expect(agent.deny).toBe(text)
})

test('the guard blocks edits to approvals.md in a phase past Intent', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  const r = await $.tool.call({ tool: 'Write', file_path: `/repo/changes/${ID}/approvals.md`, content: 'x' })
  expect(r.deny).toBe('goal-and-do blocks edits to approvals.md. The mod writes it at each gate.')
})

const approvalOf = async (phase: 'Intent' | 'Spec' | 'Plan', text: string) => ({
  phase,
  file: `changes/${ID}/${FILES[phase]}`,
  sha256: await shaOf(text),
  at: NOW,
})

test('push: intent.md, spec.md and plan.md as approved let the push go', async ($, on) => {
  const approvals = [await approvalOf('Intent', INTENT_APPROVED), await approvalOf('Spec', SPEC_DONE), await approvalOf('Plan', PLAN_DONE)]
  const w = world(
    on,
    withRecord({
      run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK, approvals }),
      files: { [phaseFile('Intent')]: INTENT_APPROVED, [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE },
    })
  )
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBeUndefined()
  expect(w.run()?.state).toBe('running')
})

for (const [name, phase, files] of [
  ['an edited intent.md', 'Intent', { [phaseFile('Intent')]: `${INTENT_APPROVED}\nOne more line.\n` }],
  ['an edited spec.md', 'Spec', { [phaseFile('Spec')]: `${SPEC_DONE}\nAC-9: one more.\n` }],
  ['an edited plan.md', 'Plan', { [phaseFile('Plan')]: `${PLAN_DONE}\nOne more task.\n` }],
  ['a deleted spec.md', 'Spec', { [phaseFile('Spec')]: undefined }],
] as [string, 'Intent' | 'Spec' | 'Plan', Record<string, string | undefined>][]) {
  test(`push: ${name} since its approval blocks the push and the run`, async ($, on) => {
    const approvals = [await approvalOf('Intent', INTENT_APPROVED), await approvalOf('Spec', SPEC_DONE), await approvalOf('Plan', PLAN_DONE)]
    const all: Record<string, string | undefined> = {
      [phaseFile('Intent')]: INTENT_APPROVED,
      [phaseFile('Spec')]: SPEC_DONE,
      [phaseFile('Plan')]: PLAN_DONE,
      ...files,
    }
    const present = Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== undefined))
    const w = world(on, withRecord({ run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK, approvals }), files: present }))
    await begin($)
    const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
    const note = `goal-and-do blocks the push: ${FILES[phase]} changed since its approval.`
    expect(r.deny).toBe(note)
    expect(w.run()).toMatchObject({ state: 'blocked', reason: note })
    expect(w.ran).toEqual([])
  })
}

test('push: a hand-edited approvals.md blocks the push and the run', async ($, on) => {
  const approvals = approvalsTo('PR', ID)
  const setup = withRecord({
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK, approvals }),
    files: { [phaseFile('Intent')]: INTENT_APPROVED, [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE },
  })
  const files = { ...setup.files, [`changes/${ID}/approvals.md`]: `${approvalsText(approvals)}| Plan | x | y | Someone | z |  |\n` }
  const w = world(on, { ...setup, files })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBe(APPROVALS_DIFFER)
  expect(w.run()).toMatchObject({ state: 'blocked', reason: APPROVALS_DIFFER })
  expect(w.ran).toEqual([])
})

for (const [name, drop] of [
  ['a missing approvals.md', 'file'],
  ['no record in the store', 'store'],
] as [string, 'file' | 'store'][]) {
  test(`push: ${name} blocks the push`, async ($, on) => {
    const approvals = approvalsTo('PR', ID)
    const setup = withRecord({
      run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK, approvals }),
      files: { [phaseFile('Intent')]: INTENT_APPROVED, [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE },
    })
    const files = { ...setup.files }
    const store = { ...setup.store }
    if (drop === 'file') delete files[`changes/${ID}/approvals.md`]
    else delete store[`approvals:${ID}`]
    const w = world(on, { ...setup, files, store })
    await begin($)
    const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
    expect(r.deny).toBe(APPROVALS_DIFFER)
    expect(w.run()).toMatchObject({ state: 'blocked', reason: APPROVALS_DIFFER })
  })
}

test('push: the approved-files check takes the SHA-256 from the store, not from the run', async ($, on) => {
  const approvals = approvalsTo('PR', ID)
  const other = approvals.map(row => (row.phase === 'Spec' ? { ...row, sha256: 'ab'.repeat(32) } : row))
  const files = {
    [phaseFile('Intent')]: INTENT_APPROVED,
    [phaseFile('Spec')]: SPEC_DONE,
    [phaseFile('Plan')]: PLAN_DONE,
    [`changes/${ID}/approvals.md`]: approvalsText(approvals),
  }
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK, approvals: other }),
    files,
    store: { [`approvals:${ID}`]: recordOf(approvals) },
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBeUndefined()
  expect(w.run()?.state).toBe('running')
})

test('push: a SHA-256 in the store that the file no longer has blocks the push, whatever the run holds', async ($, on) => {
  const approvals = approvalsTo('PR', ID)
  const other = approvals.map(row => (row.phase === 'Spec' ? { ...row, sha256: 'ab'.repeat(32) } : row))
  world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK, approvals }),
    files: {
      [phaseFile('Intent')]: INTENT_APPROVED,
      [phaseFile('Spec')]: SPEC_DONE,
      [phaseFile('Plan')]: PLAN_DONE,
      [`changes/${ID}/approvals.md`]: approvalsText(other),
    },
    store: { [`approvals:${ID}`]: recordOf(other) },
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBe('goal-and-do blocks the push: spec.md changed since its approval.')
})

// Re-lock with the person's approval

const OLD_LOCK = LOCK.lockedAt
const NEW_HEAD = 'cd'.repeat(20)
const RELOCK_GIT: Record<string, [number, string]> = {
  [g(`diff --quiet ${OLD_LOCK} -- tests/acceptance`)]: [1, ''],
  [g(`diff --name-only ${OLD_LOCK} -- tests/acceptance`)]: [0, 'tests/acceptance/a.test.ts\n'],
  [g(`ls-files --others --exclude-standard -- tests/acceptance`)]: [0, ''],
  [g('rev-parse HEAD')]: [0, `${NEW_HEAD}\n`],
  [g(`rev-parse --verify --quiet refs/heads/sdd/${ID}`)]: [0, `${NEW_HEAD}\n`],
}
const RELOCK_OPTIONS = ['Approve the changed tests and re-lock', 'Rerun Build now', 'Open plan.md in app', 'Stop this run']

function relockWorld(on: On, setup: Setup = {}) {
  return world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: [PLAN_APPROVAL] }),
    files: { [phaseFile('Build')]: done('build'), [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    ...setup,
    git: { ...RELOCK_GIT, ...setup.git },
  })
}

test('re-lock: a lock block offers the re-lock and names the changed tests', async ($, on) => {
  const w = relockWorld(on)
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]).toEqual({
    question: TEXTS.relockQuestion('Build', ['tests/acceptance/a.test.ts']),
    options: RELOCK_OPTIONS,
    header: 'Stuck',
    multiSelect: false,
  })
})

test('re-lock: approving with committed changes records the row and the new lock, and the rerun passes the lock check', async ($, on) => {
  const w = relockWorld(on, { answers: ['Approve the changed tests and re-lock'] })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  const run = w.json()
  expect(run).toMatchObject({
    state: 'running',
    lockedAt: NEW_HEAD,
    lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA },
    testPaths: ['tests/acceptance'],
    reruns: { Build: 1 },
  })
  expect(run.approvals.at(-1)).toEqual({
    phase: 'Plan',
    file: `changes/${ID}/plan.md`,
    sha256: PLAN_APPROVAL.sha256,
    at: NOW,
    lockedAt: NEW_HEAD,
    kind: 'relock',
  })
  const rows = (w.files.get(`changes/${ID}/approvals.md`) ?? '').trim().split('\n')
  expect(rows.at(-1)).toBe(
    `| Plan | changes/${ID}/plan.md (tests re-locked) | ${PLAN_SHA} | the person who approved | 2026-10-29T18:05:00.000Z | ${NEW_HEAD} |`
  )
  expect(w.store.get(`lock:${ID}`)).toEqual({
    lockedAt: NEW_HEAD,
    lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA },
    testPaths: ['tests/acceptance'],
  })
  expect(w.store.get(`approvals:${ID}`)).toEqual(recordOf(run.approvals))
  expect(w.files.get(`changes/${ID}/approvals.md`)).toBe(approvalsText(run.approvals))
  expect(w.files.get(phaseFile('Build'))).toBe(draft('build'))
  expect(w.commands).toEqual(['goal clear', 'goal clear', 'clear', `goal ${goalFor('Build', ID)}`])

  w.files.set(phaseFile('Build'), done('build'))
  await turnEnd($)
  await w.clock.settle()
  expect(w.argv).toContain(g(`diff --quiet ${NEW_HEAD} -- tests/acceptance`))
  expect(w.run()).toMatchObject({ phase: phaseAt('Test'), state: 'running' })
  expect(w.commands.slice(-2)).toEqual(['clear', `goal ${goalFor('Test', ID)}`])
})

test('re-lock: uncommitted test changes refuse with the toast and reopen the dialog', async ($, on) => {
  const w = relockWorld(on, {
    answers: ['Approve the changed tests and re-lock', undefined],
    git: { [g('status --porcelain -- tests/acceptance')]: [0, ' M tests/acceptance/a.test.ts\n'] },
  })
  await begin($)
  await turnEnd($)
  await w.asked(2)
  await w.clock.settle()
  expect(w.toasts).toEqual(['Commit the test changes first, then approve the re-lock.'])
  expect(w.asks[1]?.options).toEqual(RELOCK_OPTIONS)
  expect(w.run()).toMatchObject({ state: 'blocked', lockedAt: OLD_LOCK, approvals: [PLAN_APPROVAL] })
  expect(w.store.has(`lock:${ID}`)).toBe(false)
})

test('re-lock: next on a lock-blocked run opens the re-lock dialog instead of rerunning', async ($, on) => {
  const w = relockWorld(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'the acceptance tests changed since Plan approval', ...LOCK }),
  })
  await begin($)
  expect(await command($, 'next')).toBeUndefined()
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual(RELOCK_OPTIONS)
  expect(w.commands).toEqual([])
  expect(w.run()?.state).toBe('blocked')
})

test('re-lock: a plan.md changed since its approval refuses the re-lock and keeps the run blocked', async ($, on) => {
  const w = relockWorld(on, {
    answers: ['Approve the changed tests and re-lock'],
    files: {
      [phaseFile('Build')]: done('build'),
      [phaseFile('Plan')]: `${PLAN_DONE}\nA task added after approval.\n`,
      'tests/acceptance/a.test.ts': TEST_FILE,
    },
  })
  await begin($)
  await turnEnd($)
  await w.toasted(1)
  await w.clock.settle()
  expect(w.toasts).toEqual(['goal-and-do: plan.md changed since its approval; it needs the Plan gate again.'])
  expect(w.run()).toMatchObject({ state: 'blocked', lockedAt: OLD_LOCK, approvals: [PLAN_APPROVAL] })
  expect(w.store.has(`lock:${ID}`)).toBe(false)
  expect(w.files.has(`changes/${ID}/approvals.md`)).toBe(false)
  expect(w.commands).toEqual(['goal clear'])
})

test('re-lock: a test file edited while the dialog is open reopens it and re-locks nothing', async ($, on) => {
  let isEdited = false
  const w = relockWorld(on, {
    answers: ['Approve the changed tests and re-lock', undefined],
    beforeAnswer: () => {
      if (!isEdited) w.files.set('tests/acceptance/a.test.ts', `${TEST_FILE}// edited\n`)
      isEdited = true
    },
  })
  await begin($)
  await turnEnd($)
  await w.asked(2)
  await w.clock.settle()
  expect(w.toasts).toEqual(['goal-and-do: the tests changed while the dialog was open; review them again.'])
  expect(w.run()).toMatchObject({ state: 'blocked', lockedAt: OLD_LOCK })
  expect(w.store.has(`lock:${ID}`)).toBe(false)
})

test('re-lock: a new commit while the dialog is open reopens it and re-locks nothing', async ($, on) => {
  let isMoved = false
  const w = relockWorld(on, {
    answers: ['Approve the changed tests and re-lock', undefined],
    beforeAnswer: () => {
      if (!isMoved) w.git[g('rev-parse HEAD')] = [0, `${'ef'.repeat(20)}\n`]
      isMoved = true
    },
  })
  await begin($)
  await turnEnd($)
  await w.asked(2)
  await w.clock.settle()
  expect(w.toasts).toEqual(['goal-and-do: the tests changed while the dialog was open; review them again.'])
  expect(w.run()).toMatchObject({ state: 'blocked', lockedAt: OLD_LOCK })
})

test('re-lock: an unusual file name is not shown as given', async ($, on) => {
  const w = relockWorld(on, {
    git: { [g(`diff --name-only ${OLD_LOCK} -- tests/acceptance`)]: [0, 'tests/acceptance/a.test.ts\ntests/acceptance/`x`.ts\n'] },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(TEXTS.relockQuestion('Build', ['tests/acceptance/a.test.ts', 'tests/acceptance/`x`.ts'].sort()))
  expect(w.asks[0]?.question).toContain('<a file with an unusual name>')
  expect(w.asks[0]?.question).not.toContain('`x`')
})

test('re-lock: a failing git diff offers no re-lock and says why', async ($, on) => {
  const w = relockWorld(on, { git: { [g(`diff --name-only ${OLD_LOCK} -- tests/acceptance`)]: [128, ''] } })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.toasts).toEqual(['goal-and-do cannot list the changed tests (git failed), so it offers no re-lock.'])
  expect(w.asks[0]?.question).toBe(TEXTS.stuckBlocked('Build', 'the acceptance tests changed since Plan approval', ID))
  expect(w.asks[0]?.options).not.toContain('Approve the changed tests and re-lock')
})

test('re-lock: build.md set to blocked by the skill still gets the lock check and the re-lock', async ($, on) => {
  const w = relockWorld(on, {
    files: {
      [phaseFile('Build')]: '---\nphase: build\nstatus: blocked\n---\n\n## Open points\n\n- An acceptance test changed after the lock.\n',
      [phaseFile('Plan')]: PLAN_DONE,
      'tests/acceptance/a.test.ts': TEST_FILE,
    },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval' })
  expect(w.asks[0]?.options).toEqual(RELOCK_OPTIONS)
})

test('re-lock: a Build goal that ends without status still gets the lock check', async ($, on) => {
  const w = relockWorld(on, {
    files: { [phaseFile('Build')]: draft('build'), [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval' })
})

test('re-lock: next on a run blocked for another reason with changed locked tests opens the re-lock without a goal', async ($, on) => {
  const w = relockWorld(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'The skill saw a changed acceptance test.', ...LOCK, approvals: [PLAN_APPROVAL] }),
  })
  await begin($)
  expect(await command($, 'next')).toBeUndefined()
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual(RELOCK_OPTIONS)
  expect(w.asks[0]?.question).toBe(TEXTS.relockQuestion('Build', ['tests/acceptance/a.test.ts']))
  expect(w.commands).toEqual([])
  expect(w.run()?.state).toBe('blocked')
})

test('re-lock: picking it on such a run writes the new lock first, then reruns Build', async ($, on) => {
  const w = relockWorld(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'The skill saw a changed acceptance test.', ...LOCK, approvals: [PLAN_APPROVAL] }),
    answers: ['Approve the changed tests and re-lock'],
    onGoal: args => {
      if (args !== 'clear') expect(w.run()?.lockedAt).toBe(NEW_HEAD)
    },
  })
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect(w.json()).toMatchObject({ state: 'running', lockedAt: NEW_HEAD, reruns: { Build: 1 } })
  expect(w.store.get(`lock:${ID}`)).toMatchObject({ lockedAt: NEW_HEAD })
  expect(w.commands).toEqual(['goal clear', 'clear', `goal ${goalFor('Build', ID)}`])
})

test('re-lock: an interrupted Build with changed locked tests re-locks from next, then reruns', async ($, on) => {
  const w = relockWorld(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'interrupted', ...LOCK, approvals: [PLAN_APPROVAL] }),
    answers: ['Approve the changed tests and re-lock'],
  })
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual(RELOCK_OPTIONS)
  expect(w.json()).toMatchObject({ state: 'running', lockedAt: NEW_HEAD })
})

test('re-lock: a capped Build with changed locked tests offers the re-lock at the turn end', async ($, on) => {
  const w = relockWorld(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, state: 'capped', turns: 40, ...LOCK, approvals: [PLAN_APPROVAL] }) })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]?.options).toEqual(RELOCK_OPTIONS)
})

test('re-lock: with the tests matching the lock, next on a blocked run reruns as before', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'The skill saw a changed acceptance test.', ...LOCK, approvals: [PLAN_APPROVAL] }),
    files: { [phaseFile('Build')]: draft('build') },
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks).toEqual([])
  expect(w.commands).toEqual(['goal clear', 'clear', `goal ${goalFor('Build', ID)}`])
})

test('re-lock: typed free text never re-locks', async ($, on) => {
  const w = relockWorld(on, { answers: ['approve the tests and re-lock them'] })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', lockedAt: OLD_LOCK })
  expect(w.logs).toEqual([TEXTS.stuckContinue('Build')])
})

test('re-lock: a blocked push offers the re-lock at the next turn end', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK }),
    files: { [phaseFile('PR')]: draft('pr') },
    git: RELOCK_GIT,
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(await stopHook($)).toEqual({})
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(TEXTS.relockQuestion('PR', ['tests/acceptance/a.test.ts']))
  expect(w.asks[0]?.options).toEqual(['Approve the changed tests and re-lock', 'Rerun PR now', 'Open plan.md in app', 'Stop this run'])
})

// Learning

// The options of an open dialog as the engine draws them under the mod's render hook: label and description.
async function drawnOptions($: $T, w: { drawnQuestions: unknown[] }, ask: Ask, description = ''): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'AskUserQuestion',
    requestId: 'toolu_dialog',
    props: {
      tool: 'AskUserQuestion',
      questions: [{ question: ask.question, header: ask.header, options: ask.options.map(label => ({ label, description })), multiSelect: ask.multiSelect }],
    },
  })
  await ui.unmount()
  return w.drawnQuestions.flatMap(item =>
    ((item as { options?: { label: string; description?: string }[] }).options ?? []).map(option => `${option.label}: ${option.description ?? ''}`)
  )
}

async function learn($: $T, calls: [string, string][]) {
  for (const [id, command] of calls) {
    await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: id })
    await $.tool.call({ tool: 'Bash', command, tool_use_id: id })
  }
}

const TWO: [string, string][] = [
  ['toolu_1', 'npm test'],
  ['toolu_2', 'gh pr view 7'],
]

const RUNS_CODE = 'Runs a project command (tests, build or a script); it can change files.'
const READS_ANY = 'Reads only; changes nothing. Allowed with any arguments.'

test('learning: the first command for everyone writes that rule, re-reading the file just before the write', async ($, on) => {
  const { held, release } = holdDialogs()
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'gate' }),
    answers: ['npm test', 'Everyone on this project (.claude/settings.json; you commit it)'],
    holdAsk: ask => (ask.question === TEXTS.ruleQuestion(2) ? held : undefined),
    beforeAnswer: ask => {
      if (ask.question === TEXTS.ruleWhere) w.files.set('.claude/settings.json', '{"permissions":{"allow":["Bash(ls)"]}}')
    },
  })
  await begin($)
  await learn($, TWO)
  expect(w.run()).toMatchObject({ suggested: ['Bash(npm test)', 'Bash(gh pr view *)'], candidates: {} })

  await turnEnd($)
  await settleUntil(w, () => w.asks.length >= 1)

  // Each option is the command itself, its description what the rule allows.
  expect(w.asks[0]).toEqual({
    question: TEXTS.ruleQuestion(2),
    options: ['npm test', 'gh pr view …'],
    header: 'Rules',
    multiSelect: true,
  })
  expect(await drawnOptions($, w, w.asks[0]!)).toEqual([`npm test: ${RUNS_CODE}`, `gh pr view …: ${READS_ANY}`])
  release()
  await settleUntil(w, () => w.asks.length >= 2)
  await w.clock.settle()
  // Once the dialog is answered, the drawing adds nothing.
  expect(await drawnOptions($, w, w.asks[0]!)).toEqual(['npm test: ', 'gh pr view …: '])
  expect(w.asks[1]).toMatchObject({ question: TEXTS.ruleWhere, options: TEXTS.ruleWhereOptions, header: 'Rules' })
  const settings = JSON.parse(w.files.get('.claude/settings.json') ?? '{}') as { permissions: { allow: string[] } }
  expect(settings.permissions.allow).toEqual(['Bash(ls)', 'Bash(npm test)'])
  expect(w.run()).toMatchObject({ suggested: ['Bash(gh pr view *)'], offered: ['Bash(npm test)', 'Bash(gh pr view *)'] })
})

test('learning: Only me writes settings.local.json and adds it to the exclude file when git does not ignore it', async ($, on) => {
  const { held, release } = holdDialogs()
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate' }),
    answers: ['npm test', 'Only me (.claude/settings.local.json)'],
    holdAsk: ask => (ask.question === TEXTS.ruleQuestion(1) ? held : undefined),
  })
  await begin($)
  await learn($, [['toolu_1', 'npm test']])
  await turnEnd($)
  await settleUntil(w, () => w.asks.length >= 1)
  expect(w.asks[0]).toEqual({ question: TEXTS.ruleQuestion(1), options: ['npm test', 'Not now'], header: 'Rules', multiSelect: false })
  expect(await drawnOptions($, w, w.asks[0]!)).toEqual([`npm test: ${RUNS_CODE}`, 'Not now: Claude Code keeps asking.'])
  release()
  await settleUntil(w, () => w.asks.length >= 2)
  await w.clock.settle()
  expect(JSON.parse(w.files.get('.claude/settings.local.json') ?? '{}')).toEqual({ permissions: { allow: ['Bash(npm test)'] } })
  expect(w.files.get('.git/info/exclude')).toBe('.claude/settings.local.json\n')
  expect(w.files.has('.claude/settings.json')).toBe(false)
})

test('learning: an ignored settings.local.json is not added to the exclude file', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate', suggested: ['Bash(npm test)'] }),
    git: { [g('check-ignore -q .claude/settings.local.json')]: [0, ''] },
    answers: ['npm test'],
  })
  await begin($)
  expect(await command($, 'allow local')).toBeUndefined()
  await w.clock.settle()
  expect(w.asks).toHaveLength(1)
  expect(w.files.has('.claude/settings.local.json')).toBe(true)
  expect(w.files.has('.git/info/exclude')).toBe(false)
})

for (const [name, answers] of [
  ['Not now', ['npm test', 'Not now']],
  ['a dismissal', [undefined]],
  ['free text', ['only the first one please']],
  ['no command ticked', ['']],
] as [string, (string | undefined)[]][]) {
  test(`learning: ${name} writes nothing and keeps the suggestions`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), answers })
    await begin($)
    await learn($, TWO)
    await turnEnd($)
    await w.clock.settle()
    expect(w.writes.filter(path => path.startsWith('.claude/'))).toEqual([])
    expect(w.run()?.suggested).toEqual(['Bash(npm test)', 'Bash(gh pr view *)'])
  })
}

test('learning: a call the person denied gives no rule', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true }), denied: ['toolu_3'] })
  await begin($)
  await $.tool.check({ tool: 'Bash', input: { command: 'npm test' }, approver: 'person', tool_use_id: 'toolu_3' })
  expect(w.run()?.candidates).toEqual({ toolu_3: 'Bash(npm test)' })
  await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'toolu_3' })
  expect(w.run()).toMatchObject({ candidates: {}, suggested: [] })
})

test('learning: an ask with no person to ask keeps no candidate', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true }) })
  await begin($)
  await $.tool.check({ tool: 'Bash', input: { command: 'npm test' }, tool_use_id: 'toolu_4' })
  expect(w.run()?.candidates).toEqual({})
})

test(
  'learning: an ask another plugin made keeps no candidate',
  {
    plugins: [
      {
        name: 'asker',
        tier: 'append',
        register(on) {
          on('tool.check', () => ({ decision: 'ask', reason: 'asker wants a person' }))
        },
      },
    ],
  },
  async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true }) })
    await begin($)
    const r = await $.tool.check({ tool: 'Bash', input: { command: 'npm test' }, approver: 'person', tool_use_id: 'toolu_6' })
    expect(r).toMatchObject({ decision: 'ask', plugin: 'asker' })
    expect(w.run()?.candidates).toEqual({})
  }
)

test('learning: a second offer of the same rule is not made, and a turn with no usage adds nothing', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), answers: [undefined] })
  await begin($)
  await learn($, [['toolu_1', 'npm test']])
  await turnEnd($)
  await w.clock.settle()
  await learn($, [['toolu_5', 'npm test']])
  await turnEnd($)
  await w.clock.settle()
  expect(w.asks).toHaveLength(1)
  expect(w.run()?.suggested).toEqual(['Bash(npm test)'])
  expect(w.run()?.usage.rows).toEqual({})
})

test('learning: both commands ticked write both rules, and the descriptions never reach the run or the settings', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'gate' }),
    answers: ['npm test, gh pr view …', 'Only me (.claude/settings.local.json)'],
  })
  await begin($)
  await learn($, TWO)
  await turnEnd($)
  await w.clock.settle()
  expect(JSON.parse(w.files.get('.claude/settings.local.json') ?? '{}')).toEqual({ permissions: { allow: ['Bash(npm test)', 'Bash(gh pr view *)'] } })
  expect(w.run()?.suggested).toEqual([])
  expect(w.files.get('.claude/settings.local.json')).not.toContain('Reads only')
})

test('learning: two rule dialogs with as many rules each keep their own descriptions, also after one of them closes', async ($, on) => {
  const first = holdDialogs()
  const second = holdDialogs()
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'gate' }),
    answers: [undefined, undefined],
    holdAsk: ask => (ask.options[0] === 'npm test' ? first.held : ask.options[0] === 'npx eslint' ? second.held : undefined),
  })
  await begin($)
  await learn($, TWO)
  await turnEnd($)
  await settleUntil(w, () => w.asks.length >= 1)
  // While the first is open, two more rules give a second dialog of two.
  await learn($, [
    ['toolu_3', 'npx eslint'],
    ['toolu_4', 'git status -s'],
  ])
  await turnEnd($)
  await settleUntil(w, () => w.asks.length >= 2)
  expect(w.asks[1]?.question).toBe(w.asks[0]?.question)
  const [one, two] = [w.asks[0]!, w.asks[1]!]
  expect(await drawnOptions($, w, one)).toEqual([`npm test: ${RUNS_CODE}`, `gh pr view …: ${READS_ANY}`])
  expect(await drawnOptions($, w, two)).toEqual(['npx eslint: Runs a program; it can change files.', `git status …: ${READS_ANY}`])
  first.release()
  await w.clock.settle()
  expect(await drawnOptions($, w, one)).toEqual(['npm test: ', 'gh pr view …: '])
  expect(await drawnOptions($, w, two)).toEqual(['npx eslint: Runs a program; it can change files.', `git status …: ${READS_ANY}`])
  second.release()
  await w.clock.settle()
})

test("learning: Claude's own question keeps its descriptions, even with the rule dialog's labels", async ($, on) => {
  const { held, release } = holdDialogs()
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'gate', suggested: ['Bash(npm test)'] }),
    answers: ['npm test', 'Not now'],
    holdAsk: () => held,
  })
  await begin($)
  void command($, 'allow')
  await settleUntil(w, () => w.asks.length >= 1)
  const claudes = { question: 'Which one?', header: 'Pick', options: ['npm test', 'Not now'], multiSelect: false }
  expect(await drawnOptions($, w, claudes, 'mine')).toEqual(['npm test: mine', 'Not now: mine'])
  release()
  await w.clock.settle()
})

test('allow with nothing to suggest says so', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }) })
  await begin($)
  expect(await command($, 'allow')).toBe('No rules to suggest yet.')
  expect(w.asks).toEqual([])
})

test('bad settings JSON is left alone, and the text names the file and the error', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate', suggested: ['Bash(npm test)'] }),
    files: { '.claude/settings.json': '{ "permissions": ' },
    answers: ['npm test', 'Everyone on this project (.claude/settings.json; you commit it)'],
  })
  await begin($)
  await command($, 'allow')
  await w.clock.settle()
  expect(w.writes).not.toContain('.claude/settings.json')
  expect(w.logs).toHaveLength(1)
  expect(w.logs[0]).toContain('.claude/settings.json')
  expect(w.logs[0]).toContain('not valid JSON')
})

// Refused goal start

test('a refused goal start toasts the refusal and gives the /goal line to paste; run.json stays running with pendingGoal', async ($, on) => {
  const w = world(on, { goalRefused: true })
  await begin($)
  await command($, `--strict ${ID}`)
  await w.clock.settle()
  expect(w.toasts).toHaveLength(1)
  expect(w.toasts[0]).toContain(`${PHASES[0]} goal`)
  expect(w.logs).toEqual([`/goal ${goalFor(PHASES[0], ID)}`])
  expect(w.json()).toMatchObject({ state: 'running', pendingGoal: true, goalActive: false })
})

test('a pending goal starts at the next main-loop turn.complete', async ($, on) => {
  const w = world(on, { run: runAt({ pendingGoal: true }) })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.commands).toEqual([`goal ${goalFor(PHASES[0], ID)}`])
  expect(w.run()).toMatchObject({ goalActive: true, pendingGoal: false })
})

// Commands without a run

test('next, status and stop with no run give the no-run text', async ($, on) => {
  world(on)
  await begin($)
  expect(await command($, 'next')).toBe(TEXTS.noRun)
  expect(await command($, 'status')).toBe(TEXTS.noRun)
  expect(await command($, 'stop')).toBe(TEXTS.noRun)
})

test('next on a finished or a stopped run names it', async ($, on) => {
  world(on, { run: runAt({ state: 'finished', phase: phaseAt('PR') }) })
  await begin($)
  expect(await command($, 'next')).toBe(TEXTS.runFinished(ID))
})

test('usage while waiting goes to the gate row', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }) })
  await begin($)
  await turnEnd($, { usage: USAGE })
  expect(Object.keys(w.run()?.usage.rows ?? {})).toEqual(['Spec gate'])
})

// The trace chain

const acBlock = (n: number, bacs: string) => `### AC-${n} (${bacs})\n\n- Given a\n- When b\n- Then c\n`
const traceSpec = (blocks: string[], scope = '- Nothing else.') =>
  ['---', 'phase: spec', 'status: done', '---', '', '## Acceptance criteria', '', ...blocks, '## Out of scope', '', scope, ''].join('\n')
const traceIntent = (count: number) =>
  [
    '---',
    'phase: intent',
    'status: done',
    'open-at-approval: 0',
    '---',
    '',
    '## Business acceptance criteria',
    '',
    ...Array.from({ length: count }, (_, i) => `- BAC-${i + 1}: Given a clerk, when b, then c.`),
    '',
  ].join('\n')
const TRACE_TEST = '---\nphase: test\nstatus: done\n---\n\n| AC ID | Test | Result |\n| --- | --- | --- |\n| AC-1 | `t1` | pass |\n| AC-2 | `t2` | fail |\n'

// The chain's lines in the pane, each read whole, with the color its first part is drawn in.
async function chain($: $T, surface: RenderSurface, bodyColumns: number): Promise<{ text: string; color?: unknown }[]> {
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface,
    component: 'Pane',
    requestId: 'goal-and-do',
    props: { title: 'goal-and-do', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  const tree = await ui.drawn()
  await ui.unmount()
  return chainLines(tree)
}

function chainLines(node: unknown): { text: string; color?: unknown }[] {
  if (typeof node === 'string') return []
  const drawn = node as Drawn
  if (drawn.type === 'Box' && String(drawn.props?.key ?? '').startsWith('trace-line-')) {
    const color = textsUnder(node)[0]?.color
    return [{ text: inlineText(node), ...(color === undefined ? {} : { color }) }]
  }
  return (drawn.children ?? []).flatMap(chainLines)
}

test('trace: the Spec gate draws one line per criterion under the phase table, none in the warning color', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true, suggested: ['Bash(npm test)'] }),
    files: { [phaseFile('Intent')]: traceIntent(3), [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-1, BAC-2')]) },
  })
  await begin($)
  await turnEnd($)
  await w.asked(1)
  await w.clock.settle()
  for (const surface of SURFACES) {
    for (const columns of COLUMNS) {
      expect(await chain($, surface, columns)).toEqual([{ text: 'BAC-1 → AC-1, AC-2' }, { text: 'BAC-2 → AC-2' }, { text: 'BAC-3 → none', color: 'warning' }])
    }
  }
  const lines = await paneRowsAt($, 120)
  const at = (text: string) => lines.findIndex(line => line.startsWith(text))
  expect(at('▼ Requirements (3)')).toBeGreaterThan(at('PR '))
  expect(at('BAC-1 → AC-1')).toBe(at('▼ Requirements (3)') + 1)
  expect(at('BAC-1 → AC-1')).toBeLessThan(at('► Suggested Rules'))
  expect(w.trace()).toEqual([
    { id: 'BAC-1', kind: 'acs', acs: [{ id: 'AC-1' }, { id: 'AC-2' }] },
    { id: 'BAC-2', kind: 'acs', acs: [{ id: 'AC-2' }] },
    { id: 'BAC-3', kind: 'none', acs: [] },
  ])
})

test('trace: Spec running without spec.md draws no chain, even from an earlier read', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Intent')]: traceIntent(2) },
    trace: [{ id: 'BAC-1', kind: 'none', acs: [] }],
  })
  await begin($)
  for (const surface of SURFACES) expect(await chain($, surface, 80)).toEqual([])
})

test('trace: a spec.md without any (BAC-<n>) draws no chain at the Spec gate', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Intent')]: traceIntent(2), [phaseFile('Spec')]: SPEC_DONE },
  })
  await begin($)
  await turnEnd($)
  await w.asked(1)
  await w.clock.settle()
  expect(await chain($, 'terminal', 80)).toEqual([])
  expect(w.trace()).toEqual([])
})

test('trace: a criterion Spec puts out of scope shows in a neutral color, and the Spec gate question names it', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: {
      [phaseFile('Intent')]: traceIntent(3),
      [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-2')], '- BAC-3 (out of scope): the ticket leaves it to a later change.'),
    },
  })
  await begin($)
  await turnEnd($)
  await w.asked(1)
  await w.clock.settle()
  expect(w.asks[0]?.question).toContain('Spec puts BAC-3 out of scope; approving accepts that. Approve and start Plan?')
  expect(await chain($, 'terminal', 80)).toEqual([{ text: 'BAC-1 → AC-1' }, { text: 'BAC-2 → AC-2' }, { text: 'BAC-3 → out of scope (Spec)', color: 'subtle' }])
})

test('trace: a criterion with an AC that Out of scope lists too is named at the Spec gate and flagged in the pane', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: {
      [phaseFile('Intent')]: traceIntent(2),
      [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-2')], '- BAC-2 (out of scope): later.'),
    },
  })
  await begin($)
  await turnEnd($)
  await w.asked(1)
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(
    `Spec is done: changes/${ID}/spec.md. Check that the acceptance criteria are complete and the open points answered. Spec puts BAC-2 out of scope; approving accepts that. Approve and start Plan?`
  )
  expect(await chain($, 'terminal', 80)).toEqual([{ text: 'BAC-1 → AC-1' }, { text: 'BAC-2 → AC-2 (also out of scope)', color: 'warning' }])
})

test('trace: a criterion intent.md lacks shows as not in intent.md in the warning color', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Intent')]: traceIntent(1), [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-4'), acBlock(3, 'none')]) },
  })
  await begin($)
  await turnEnd($)
  await w.asked(1)
  await w.clock.settle()
  expect(await chain($, 'terminal', 80)).toEqual([{ text: 'BAC-1 → AC-1' }, { text: 'BAC-4 → not in intent.md', color: 'warning' }, { text: 'no BAC: AC-3' }])
})

test('trace: the reopened Spec gate adds a sentence per out of scope criterion', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate' }),
    files: {
      [phaseFile('Intent')]: traceIntent(3),
      [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1')], '- BAC-2 (out of scope): later.\n- BAC-3 (out of scope): later.'),
    },
  })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  await w.clock.settle()
  expect(w.asks[0]?.question).toBe(
    `Spec is done: changes/${ID}/spec.md. Check that the acceptance criteria are complete and the open points answered. Spec puts BAC-2 out of scope; approving accepts that. Spec puts BAC-3 out of scope; approving accepts that. Approve and start Plan?`
  )
})

test('trace: from Test on, each AC carries its mark from test.md', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK }),
    files: {
      [phaseFile('Intent')]: traceIntent(3),
      [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-2')]),
      [phaseFile('Test')]: TRACE_TEST,
    },
  })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('PR', ID))
  await w.clock.settle()
  for (const surface of SURFACES) {
    expect(await chain($, surface, 80)).toEqual([{ text: 'BAC-1 → AC-1 ✔' }, { text: 'BAC-2 → AC-2 ✖' }, { text: 'BAC-3 → none', color: 'warning' }])
  }
})

test('trace: the files are read again at each approval, and the atom survives the /clear after it', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Intent')]: traceIntent(2), [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-2')]) },
    answers: ['Approve, start Plan'],
    // test.md is no file the gate dialog compares, so the approval reads it anew.
    beforeAnswer: () => w.files.set(phaseFile('Test'), TRACE_TEST),
  })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('Plan', ID))
  await w.clock.settle()
  expect(w.commands).toContain('clear')
  expect(w.trace()).toEqual([
    { id: 'BAC-1', kind: 'acs', acs: [{ id: 'AC-1', result: 'passed' }] },
    { id: 'BAC-2', kind: 'acs', acs: [{ id: 'AC-2', result: 'failed' }] },
  ])
  expect(await chain($, 'terminal', 80)).toEqual([{ text: 'BAC-1 → AC-1 ✔' }, { text: 'BAC-2 → AC-2 ✖' }])
})

test('trace: a restart reads the chain back from the files', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        [`changes/${ID}/run.json`]: JSON.stringify(runAt({ phase: phaseAt('Plan'), state: 'gate', approvals: approvalsTo('Plan', ID) })),
        [phaseFile('Intent')]: traceIntent(2),
        [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1')]),
      },
    })
  )
  await begin($)
  await w.clock.settle()
  expect(await chain($, 'terminal', 80)).toEqual([{ text: 'BAC-1 → AC-1' }, { text: 'BAC-2 → none', color: 'warning' }])
})

test('trace: a chain of more than five lines folds itself until the person opens it, then shows every line, wrapped', async ($, on) => {
  const blocks = Array.from({ length: 7 }, (_, i) => acBlock(i + 1, `BAC-${i + 1}`))
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Intent')]: traceIntent(7), [phaseFile('Spec')]: traceSpec(blocks) },
  })
  await begin($)
  await turnEnd($)
  await w.asked(1)
  await w.clock.settle()
  for (const surface of SURFACES) expect(await chain($, surface, 80)).toEqual([])
  expect(await paneRowsAt($, 80)).toContain('► Requirements (7)')
  const ui = await paneAt($, 80)
  await ui.press({ key: 'fold-trace' })
  await ui.unmount()
  await w.clock.settle()
  for (const surface of SURFACES) {
    expect((await chain($, surface, 80)).map(line => line.text)).toEqual(Array.from({ length: 7 }, (_, i) => `BAC-${i + 1} → AC-${i + 1}`))
  }
  const rows = await paneRowsAt($, 10)
  const at = rows.indexOf('BAC-1 →')
  expect(rows.slice(at, at + 6)).toEqual(['BAC-1 →', '  AC-1', 'BAC-2 →', '  AC-2', 'BAC-3 →', '  AC-3'])
  expect(rows.join('\n')).not.toContain('more')
  for (const row of rows.slice(at, rows.indexOf('', at))) expect(Array.from(row).length, row).toBeLessThanOrEqual(10)
})

// The pane's sections: what the mod records for them, and how it draws them

const TIME = (ms: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(ms)
const BASE_SHA = 'ab'.repeat(20)
const NUMSTAT = ['3\t1\tsrc/a.ts', '10\t0\ttests/test_premiums.py', '1\t1\tpackage.json', '-\t-\tdocs/logo.png', ''].join('\0')
const FOOTPRINT_GIT: Record<string, [number, string]> = {
  [g('merge-base origin/main HEAD')]: [0, `${BASE_SHA}\n`],
  [g(`diff --numstat -z --no-renames ${BASE_SHA}`)]: [0, NUMSTAT],
  [g('ls-files --others --exclude-standard -z')]: [0, 'notes.txt\0'],
}
const CI_TEXT = 'goal-and-do blocks edits to CI files (.github/workflows/, Jenkinsfile*).'
const GIT_CONFIG_TEXT =
  'goal-and-do blocks Git settings for hooks, fsmonitor, diff and filter drivers, includes, remotes, URLs, credentials and ssh during a run.'
const GUARD_FAILED = 'goal-and-do: the guard failed, so the call is blocked. See the debug log.'
const PASSED = {
  result: {
    stdout: '.\n----------------------------------------------------------------------\nRan 1 test in 0.000s\n\nOK',
    stderr: '',
    interrupted: false,
    isImage: false,
    noOutputExpected: false,
  },
  text: '.\n---...\nOK',
}
const FAILED = {
  isError: true,
  text: 'Exit code 1\nF\n======...\nFAIL: test_fails (test_fail.T.test_fails)\n...',
  result: 'Error: Exit code 1\nF\n...',
}
const BACKGROUND_RUN = {
  result: { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false },
  backgroundTaskId: 'bw0lx7g0e',
  text: 'Command running in background with ID: bw0lx7g0e. Output is being written to: ... You will be notified when it completes. ...',
}
const TEST_COMMAND = 'python3 -m unittest'
const PLAN_FIELDS =
  '---\nphase: plan\nstatus: done\ntest-paths: tests/acceptance\nplanned-paths: src docs/api.md\ntest-command: python3 -m unittest\n---\n\n# Plan\n'

const notification = (toolUseId: string, status?: string) =>
  [
    '<task-notification>',
    '<task-id>bw0lx7g0e</task-id>',
    `<tool-use-id>${toolUseId}</tool-use-id>`,
    '<output-file>/tmp/x/tasks/bw0lx7g0e.output</output-file>',
    ...(status === undefined ? [] : [`<status>${status}</status>`]),
    '<summary>Background command "python3 -m unittest" failed with exit code 1</summary>',
    '</task-notification>',
  ].join('\n')

async function taskEnd($: $T, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'task-notification' } })
}

// The pane's lines with the color each is drawn in, on the terminal.
async function paneColors($: $T, bodyColumns = 120, placement: 'dock' | 'inline' = 'dock') {
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'goal-and-do',
    props: { title: 'goal-and-do', isFocused: false, bodyColumns, placement, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  const found = (await ui.findAll({ type: 'Text' })).map(text => ({ text: text.text, color: (text.props as { color?: string }).color }))
  await ui.unmount()
  return afterHint(found, row => row.text)
}

// Git safety

test('git safety: every git call carries the safe options and GIT_CONFIG_NOSYSTEM=1, but the fingerprint reads the system config too; gh carries neither', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
    git: FOOTPRINT_GIT,
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  await command($, 'stop')
  await command($, 'ABC-9')
  await w.clock.settle()
  const calls = w.argv.map((line, i) => ({ line, env: w.envs[i] }))
  const gitCalls = calls.filter(call => call.line.startsWith('git '))
  expect(gitCalls.length).toBeGreaterThan(8)
  for (const call of gitCalls) {
    expect(call.line.startsWith(`${GIT_SAFE} `)).toBe(true)
    expect(call.env).toEqual(call.line === SETTINGS_READ ? undefined : { GIT_CONFIG_NOSYSTEM: '1' })
    expect(call.line.includes(' diff ') && !call.line.includes(' diff --no-ext-diff --no-textconv --ignore-submodules=dirty ')).toBe(false)
    expect(call.line.includes(' status ') && !call.line.includes(' status --ignore-submodules=dirty ')).toBe(false)
    // The fingerprint of Git's settings reads where info/attributes is and the core.attributesfile key; nothing else names attributes.
    if (call.line !== SETTINGS_READ && call.line !== SETTINGS_PATHS) expect(call.line.includes('attr')).toBe(false)
  }
  expect(gitCalls.some(call => call.line === SETTINGS_READ)).toBe(true)
  expect(gitCalls.some(call => call.line.startsWith(g('diff --numstat')))).toBe(true)
  expect(gitCalls.some(call => call.line.startsWith(g('status --porcelain')))).toBe(true)
  expect(gitCalls.filter(call => call.line === FILTER_READ).length).toBe(gitCalls.filter(call => / (diff|status) /.test(call.line)).length)
  for (const call of calls.filter(one => one.line.startsWith('gh '))) expect(call.env).toBeUndefined()
})

test('git safety: the changed-files calls run with a 5-second limit', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), git: FOOTPRINT_GIT })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  const at = w.argv.indexOf(g('merge-base origin/main HEAD'))
  expect(at).toBeGreaterThanOrEqual(0)
  for (const line of Object.keys(FOOTPRINT_GIT)) expect(w.timeouts[w.argv.indexOf(line)]).toBe(5000)
})

test('git safety: during a run the guard denies git config for the fsmonitor, hooks, diff and filter keys', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: 'git config core.fsmonitor ./x.sh' })).deny).toBe(GIT_CONFIG_TEXT)
  expect((await $.tool.call({ tool: 'Bash', command: 'git -c diff.external=./x.sh diff' })).deny).toBe(GIT_CONFIG_TEXT)
  expect((await $.tool.call({ tool: 'Bash', command: 'git config user.email x@y' })).deny).toBeUndefined()
  await w.clock.settle()
})

// Denials

test('denials: a guard denial adds its key and phase; the list keeps three, and deniedCount counts all', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/.github/workflows/ci.yml', content: 'x' })).deny).toBe(CI_TEXT)
  expect((await $.tool.call({ tool: 'Bash', command: 'git push origin main' })).deny).toBe(REASONS.pushPhase('Build'))
  expect((await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })).deny).toBe(REASONS.pullRequest)
  expect((await $.tool.call({ tool: 'Bash', command: 'git config core.hooksPath x' })).deny).toBe(GIT_CONFIG_TEXT)
  await w.clock.settle()
  expect(w.run()?.denials).toEqual([
    { phase: 'Build', key: 'pushPhase' },
    { phase: 'Build', key: 'pullRequest' },
    { phase: 'Build', key: 'gitConfig' },
  ])
  expect(w.run()?.deniedCount).toBe(4)
  expect(w.json().deniedCount).toBe(4)
  const lines = await pane($, 'terminal', 200)
  expect(lines).toContain('Build: goal-and-do allows git push only in the PR phase.')
  expect(lines).toContain(`Build: ${REASONS.pullRequest}`)
  expect(lines).toContain(`Build: ${GIT_CONFIG_TEXT}`)
  expect(lines).toContain('▼ Denials (4)')
  expect(lines.join('\n')).not.toContain('git push origin main')
})

test('denials: a push the person chose not to make adds none; a denied push never sets lastTests', async ($, on) => {
  const w = world(on, withRecord({ run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }), answers: ['Not now'] }))
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBe('goal-and-do: you chose not to push yet.')
  await w.clock.settle()
  expect(w.run()?.denials).toBeUndefined()
  expect(w.run()?.deniedCount).toBeUndefined()
})

test('denials: a denied push that equals the test command sets no lastTests', async ($, on) => {
  const push = 'git push origin main'
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testCommand: push }) })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: push })).deny).toBe(REASONS.pushPhase('Build'))
  await w.clock.settle()
  expect(w.run()?.lastTests).toBeUndefined()
  expect(w.run()?.deniedCount).toBe(1)
})

test('denials: the push refusals of the mod are rows too, by their own keys', async ($, on) => {
  const w = world(
    on,
    withRecord({
      run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK }),
      git: { [g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance')]: [1, ''] },
    })
  )
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBe(
    'goal-and-do blocks the push: the acceptance tests changed since Plan approval.'
  )
  await w.clock.settle()
  expect(w.run()?.denials).toEqual([{ phase: 'PR', key: 'pushLocked' }])
})

test('denials: an edit to a locked test gives a row whose pane line holds no path', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/tests/acceptance/a.test.ts', content: 'x' })
  expect(r.deny).toBe(REASONS.tests('tests/acceptance'))
  await w.clock.settle()
  expect(w.run()?.denials).toEqual([{ phase: 'Build', key: 'tests' }])
  const lines = await pane($, 'terminal', 200)
  expect(lines).toContain('Build: goal-and-do blocks edits to the acceptance tests after Plan approval.')
  expect(lines.join('\n')).not.toContain('a.test.ts')
})

test("denials: a recorder that throws at the deny site still returns the guard's reason, and logs no message", async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  w.failRunWrites = true
  const r = await $.tool.call({ tool: 'Write', file_path: '/repo/.github/workflows/ci.yml', content: 'x' })
  await w.clock.settle()
  expect(r.deny).toBe(CI_TEXT)
  expect(w.debug.some(line => line.startsWith('goal-and-do: denial not recorded'))).toBe(true)
  expect(w.debug.join('\n')).not.toContain('EIO')
})

test("denials: a guard that throws records guardFailed; a recorder that throws there still returns the guard's note", async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testPaths: 5 as never }) })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBe(GUARD_FAILED)
  await w.clock.settle()
  expect(w.run()?.denials).toEqual([{ phase: 'Build', key: 'guardFailed' }])
  w.failRunWrites = true
  expect((await $.tool.call({ tool: 'Bash', command: 'ls' })).deny).toBe(GUARD_FAILED)
  await w.clock.settle()
  w.failRunWrites = false
  expect(w.run()?.deniedCount).toBe(1)
  expect(await pane($, 'terminal', 200)).toContain(`Build: ${GUARD_FAILED}`)
})

test('denials: the finish text names the count', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK, deniedCount: 2 }),
    files: { [phaseFile('PR')]: '---\nphase: pr\nstatus: done\npr-url: https://github.example.com/example/demo/pull/7\nchecks: passed\n---\n' },
  })
  await begin($)
  const r = await turnEnd($)
  await w.clock.settle()
  expect(r.text).toBe(`${TEXTS.finishedPr('https://github.example.com/example/demo/pull/7')} ${TEXTS.denialCount(2)}`)
  expect(TEXTS.denialCount(2)).toBe('Denials: 2.')
})

// Restore of the new fields

test('restore: drops denials, lastTests and lastLockCheck, keeps deniedCount, and takes plannedPaths and testCommand from the store', async ($, on) => {
  const forged = runAt({
    id: 'ABC-2',
    phase: phaseAt('Build'),
    goalActive: true,
    ...LOCK,
    approvals: approvalsTo('Build'),
    denials: [{ phase: 'Build', key: 'ci' }],
    deniedCount: 3,
    lastTests: { status: 'passed', phase: 'Build', at: NOW },
    lastLockCheck: { changed: false, at: NOW },
    plannedPaths: ['everything'],
    testCommand: 'curl evil',
  })
  const w = world(
    on,
    withRecord({
      files: { 'changes/ABC-2/run.json': JSON.stringify(forged) },
      store: { 'lock:ABC-2': { ...LOCK, plannedPaths: ['src'], testCommand: TEST_COMMAND } },
    })
  )
  await begin($)
  const run = w.run()
  expect(run).toMatchObject({ state: 'interrupted', deniedCount: 3, plannedPaths: ['src'], testCommand: TEST_COMMAND })
  expect(run?.denials).toBeUndefined()
  expect(run?.lastTests).toBeUndefined()
  expect(run?.lastLockCheck).toBeUndefined()
  await openTests($)
  const lines = await pane($, 'terminal', 200)
  expect(lines).toContain('Tests locked at 3f2c9a1')
  expect(lines.join('\n')).not.toContain('unchanged at')
})

test('restore: a stored lock without the two fields leaves them out, whatever run.json says', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(
          runAt({
            id: 'ABC-2',
            phase: phaseAt('Build'),
            goalActive: true,
            ...LOCK,
            approvals: approvalsTo('Build'),
            plannedPaths: ['x'],
            testCommand: 'y',
          })
        ),
      },
      store: { 'lock:ABC-2': LOCK },
    })
  )
  await begin($)
  expect(w.run()?.state).toBe('interrupted')
  expect(w.run()?.plannedPaths).toBeUndefined()
  expect(w.run()?.testCommand).toBeUndefined()
})

for (const deniedCount of [-1, 1.5, '3', Number.NaN, null]) {
  test(`restore: deniedCount ${String(deniedCount)} is dropped, and the run comes back`, async ($, on) => {
    const w = world(
      on,
      withRecord({
        files: {
          'changes/ABC-2/run.json': JSON.stringify(
            runAt({ id: 'ABC-2', phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: approvalsTo('Build'), deniedCount: deniedCount as never })
          ),
        },
        store: { 'lock:ABC-2': LOCK },
      })
    )
    await begin($)
    expect(w.run()?.state).toBe('interrupted')
    expect(w.run()?.deniedCount).toBeUndefined()
  })
}

// Test runs

for (const [name, shape, status] of [
  ['a passing run', PASSED, 'passed'],
  ['a failing run', FAILED, 'failed'],
  ['a run moved to the background', BACKGROUND_RUN, 'started'],
] as const) {
  test(`test runs: ${name} sets lastTests with its phase, and its result reaches Claude unchanged`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testCommand: TEST_COMMAND }),
      bashResult: { [TEST_COMMAND]: shape },
    })
    await begin($)
    const r = await $.tool.call({ tool: 'Bash', command: TEST_COMMAND })
    await w.clock.settle()
    const { backgroundTaskId, ...rest } = shape as typeof shape & { backgroundTaskId?: string }
    expect(r).toMatchObject(backgroundTaskId === undefined ? rest : { ...rest, result: { ...(rest.result as object), backgroundTaskId } })
    expect(w.run()?.lastTests).toEqual({
      status,
      phase: 'Build',
      at: NOW,
      toolUseId: w.ran.at(-1),
      ...(backgroundTaskId === undefined ? {} : { backgroundTaskId }),
    })
  })
}

test('test runs: a throw while recording still returns the result, and the log names no command', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testCommand: TEST_COMMAND }),
    bashResult: { [TEST_COMMAND]: FAILED },
  })
  await begin($)
  w.failRunWrites = true
  const r = await $.tool.call({ tool: 'Bash', command: TEST_COMMAND })
  await w.clock.settle()
  w.failRunWrites = false
  expect(r).toMatchObject(FAILED)
  expect(w.run()?.lastTests).toBeUndefined()
  expect(w.debug.some(line => line.startsWith('goal-and-do: test run not recorded'))).toBe(true)
  expect(w.debug.join('\n')).not.toContain(TEST_COMMAND)
})

test('test runs: a Bash call that is no test run changes nothing', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testCommand: TEST_COMMAND }) })
  await begin($)
  const before = JSON.stringify(w.run())
  await $.tool.call({ tool: 'Bash', command: 'echo python3 -m unittest' })
  await w.clock.settle()
  expect(JSON.stringify(w.run())).toBe(before)
})

test("test runs: a subagent's test run sets lastTests", async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK, testCommand: TEST_COMMAND }),
    bashResult: { [TEST_COMMAND]: PASSED },
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: TEST_COMMAND, agentId: 'a1' })
  await w.clock.settle()
  expect(w.run()?.lastTests).toMatchObject({ status: 'passed', phase: 'Test' })
})

test('test runs: the test command behind a pipe ran, but its result is not readable', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testCommand: TEST_COMMAND }) })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: `${TEST_COMMAND} | tail -5` })
  await w.clock.settle()
  expect(w.run()?.lastTests).toMatchObject({ status: 'ran', phase: 'Build' })
  await openTests($)
  expect(await pane($, 'terminal', 200)).toContain('► Tests: ?'.replace('►', '▼'))
  expect((await pane($, 'terminal', 200)).some(line => line.startsWith('ran at ') && line.endsWith('; result not readable'))).toBe(true)
})

test('test runs: in the Plan phase the test command comes from plan.md', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), goalActive: true }),
    files: { [phaseFile('Plan')]: PLAN_FIELDS },
    bashResult: { [TEST_COMMAND]: FAILED },
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: TEST_COMMAND })
  await w.clock.settle()
  expect(w.run()?.lastTests).toMatchObject({ status: 'failed', phase: 'Plan' })
  // Failing acceptance tests are the Plan phase's goal: the section stays folded and its header has no color.
  expect((await paneColors($)).find(line => line.text === '► Tests: Fail')?.color).toBeUndefined()
  await openTests($)
  const failed = (await paneColors($)).find(line => line.text.startsWith('failed at'))
  expect(failed?.text).toBe(`failed at ${TIME(NOW)} (Plan)`)
  expect(failed?.color).toBeUndefined()
})

test('test runs: a failed run outside Plan shows in the error color', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), ...LOCK, testCommand: TEST_COMMAND, lastTests: { status: 'failed', phase: 'Build', at: NOW } }) })
  await begin($)
  // Outside Plan a failed run opens the section by itself, its header in the error color.
  expect((await paneColors($)).find(line => line.text === '▼ Tests: Fail')?.color).toBe('error')
  expect((await paneColors($)).find(line => line.text.startsWith('failed at'))?.color).toBe('error')
})

for (const [status, shown] of [
  ['completed', 'passed'],
  ['failed', 'failed'],
  ['killed', 'interrupted'],
  ['stopped', 'unreadable'],
] as const) {
  test(`test runs: a background end with status ${status} sets ${shown}, and the prompt goes on unchanged`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testCommand: TEST_COMMAND }),
      bashResult: { [TEST_COMMAND]: BACKGROUND_RUN },
    })
    await begin($)
    await $.tool.call({ tool: 'Bash', command: TEST_COMMAND })
    await w.clock.settle()
    const id = w.ran.at(-1) ?? ''
    const text = notification(id, status)
    const r = await taskEnd($, text)
    await w.clock.settle()
    expect(r.text).toBe(text)
    expect(w.prompts.at(-1)).toBe(text)
    expect(w.run()?.lastTests).toMatchObject({ status: shown, toolUseId: id, backgroundTaskId: 'bw0lx7g0e' })
  })
}

test('test runs: a background end of another call, or with no status, leaves the run as started', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testCommand: TEST_COMMAND }),
    bashResult: { [TEST_COMMAND]: BACKGROUND_RUN },
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: TEST_COMMAND })
  await w.clock.settle()
  await taskEnd($, notification('toolu_other', 'completed'))
  await taskEnd($, notification(w.ran.at(-1) ?? '', undefined))
  await $.prompt.submit({ text: notification(w.ran.at(-1) ?? '', 'completed'), wait: false, origin: { kind: 'composer' } })
  await w.clock.settle()
  expect(w.run()?.lastTests?.status).toBe('started')
  await w.clock.advance(3 * 60_000)
  await openTests($)
  expect(await pane($, 'terminal', 200)).toContain('▼ Tests: Running')
  expect(await pane($, 'terminal', 200)).toContain('started 3 min ago; result not seen')
})

// Lock checks

test('lock checks: the ends of Build and Test set lastLockCheck', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.lastLockCheck).toEqual({ changed: false, at: NOW })
  await w.clock.advance(60_000)
  w.files.set(phaseFile('Test'), done('test'))
  w.git[g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance')] = [1, '']
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.lastLockCheck).toEqual({ changed: true, at: NOW + 60_000 })
  // A changed lock opens the section by itself.
  expect(await pane($, 'terminal', 200)).toContain('Tests locked at 3f2c9a1, changed: see the Stuck dialog')
})

test('lock checks: the push sets lastLockCheck, and the pane says unchanged with its time', async ($, on) => {
  const w = world(on, withRecord({ run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK }) }))
  await begin($)
  await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  await w.clock.settle()
  expect(w.run()?.lastLockCheck).toEqual({ changed: false, at: NOW })
  await openTests($)
  expect(await pane($, 'terminal', 200)).toContain(`Tests locked at 3f2c9a1, unchanged at ${TIME(NOW)}`)
})

test('lock checks: the stuck dialog sets lastLockCheck', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', ...LOCK }),
    git: { [g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance')]: [1, ''] },
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.run()?.lastLockCheck).toEqual({ changed: true, at: NOW })
})

// The Plan gate's two fields

test('Plan gate: approval stores plannedPaths and testCommand in the run and beside the lock; the question names both', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
    files: { [phaseFile('Plan')]: PLAN_FIELDS, 'tests/acceptance/a.test.ts': TEST_FILE },
    answers: ['Approve, start Build'],
  })
  await begin($)
  await command($, 'next')
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  const question = w.asks[0]?.question ?? ''
  expect(question).toBe(TEXTS.gateQuestion('Plan', ID, ['tests/acceptance'], 0, [], { testCommand: TEST_COMMAND, plannedPaths: 2 }))
  expect(question).toContain('Test command: python3 -m unittest. Planned paths: 2.')
  expect(w.run()).toMatchObject({ plannedPaths: ['src', 'docs/api.md'], testCommand: TEST_COMMAND })
  expect(w.store.get(`lock:${ID}`)).toEqual({
    lockedAt: LOCK.lockedAt,
    lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA },
    testPaths: ['tests/acceptance'],
    plannedPaths: ['src', 'docs/api.md'],
    testCommand: TEST_COMMAND,
  })
})

test('Plan gate: a test command with unusual characters is not shown as given, and missing fields say none', async ($, on) => {
  const plan = PLAN_FIELDS.replace('test-command: python3 -m unittest', 'test-command: npm test; curl x | sh')
  const w = world(on, { run: runAt({ phase: phaseAt('Plan'), state: 'gate' }), files: { [phaseFile('Plan')]: plan } })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.asks[0]?.question).toContain('Test command: <a command with unusual characters>. Planned paths: 2.')
  expect(w.asks[0]?.question).not.toContain('curl')
  expect(TEXTS.gateQuestion('Plan', ID, ['tests/acceptance'])).toContain('Test command: none. Planned paths: none.')
})

test('re-lock: the new stored lock keeps plannedPaths and testCommand', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: [PLAN_APPROVAL], plannedPaths: ['src'], testCommand: TEST_COMMAND }),
    files: { [phaseFile('Build')]: done('build'), [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    git: RELOCK_GIT,
    answers: ['Approve the changed tests and re-lock'],
  })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect(w.store.get(`lock:${ID}`)).toEqual({
    lockedAt: NEW_HEAD,
    lockedFiles: { 'tests/acceptance/a.test.ts': TEST_SHA },
    testPaths: ['tests/acceptance'],
    plannedPaths: ['src'],
    testCommand: TEST_COMMAND,
  })
})

// The turn clock

test("turn clock: a goal's start and each main-loop classic.Stop reset the turn atom; each tool call adds one", async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), ...LOCK, pendingGoal: true }), evaluator: { block: 'not done' } })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect(w.atom('turn')).toEqual({ startedAt: NOW, calls: 0 })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  await w.clock.advance(23 * 60_000)
  expect(w.atom('turn')).toEqual({ startedAt: NOW, calls: 2 })
  // The pane has no turn line; the band has the turn, the minutes and the calls.
  expect(barRows(await pane($, 'terminal', 200))).toEqual([])
  expect((await band($, 'terminal', 200)).join('')).toContain('turn 1/40 · 23 min · 2 calls · working')
  await everyBand($, lines => {
    expect(lines).toContain('turn 1/40')
  })
  await everyBand($, lines => {
    expect(lines).toContain('23 min')
  })
  await stopHook($)
  await w.clock.settle()
  expect(w.atom('turn')).toEqual({ startedAt: NOW + 23 * 60_000, calls: 0 })
  expect(barRows(await pane($, 'terminal', 200))).toEqual([])
  expect((await band($, 'terminal', 200)).join('')).toContain('turn 2/40 · 0 min · 0 calls · working')
  await stopHook($, 'a1')
  await w.clock.settle()
  expect(w.run()?.turns).toBe(1)
})

// Changed Files

test('changed files: a Write, an Edit or a Bash result refreshes the section, at most once every 10 seconds', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), git: FOOTPRINT_GIT })
  await begin($)
  const bases = () => w.argv.filter(line => line === g('merge-base origin/main HEAD')).length
  await $.tool.call({ tool: 'Write', file_path: '/repo/src/a.ts', content: 'x' })
  await w.clock.settle()
  expect(bases()).toBe(1)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/a.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  expect(bases()).toBe(1)
  await w.clock.advance(10_000)
  expect(bases()).toBe(2)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  await w.clock.advance(20_000)
  expect(bases()).toBe(2)
})

test('changed files: turn.complete and opening the pane refresh it', async ($, on) => {
  const w = world(
    on,
    withRecord({
      files: {
        'changes/ABC-2/run.json': JSON.stringify(runAt({ id: 'ABC-2', phase: phaseAt('Build'), goalActive: true, ...LOCK, approvals: approvalsTo('Build') })),
      },
      store: { 'lock:ABC-2': LOCK },
      git: FOOTPRINT_GIT,
    })
  )
  await begin($)
  await w.clock.settle()
  const bases = () => w.argv.filter(line => line === g('merge-base origin/main HEAD')).length
  expect(bases()).toBe(1)
  await w.clock.advance(10_000)
  await turnEnd($)
  await w.clock.settle()
  expect(bases()).toBe(2)
})

test('changed files: a refresh in the middle of a goal draws the new files in three groups', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, plannedPaths: ['src'] }),
    git: FOOTPRINT_GIT,
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  const lines = await pane($, 'terminal', 200)
  expect(lines).toContain('Changed Files: 5 (+14 -2)')
  expect(lines).toContain('  Tests: 1 file (+10 -0)')
  expect(lines).toContain('  Other: 4 files (+4 -2)')
  // The path lists start folded; their counts show.
  expect(lines).toContain('► Outside the Plan (3)')
  expect(lines).toContain('► Sensitive Files (1)')
  expect(lines).not.toContain('  package.json')

  w.git[g(`diff --numstat -z --no-renames ${BASE_SHA}`)] = [0, '3\t1\tsrc/a.ts\0']
  w.git[g('ls-files --others --exclude-standard -z')] = [0, '']
  await w.clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  const after = await pane($, 'terminal', 200)
  expect(after).toContain('Changed Files: 1 (+3 -1)')
  expect(after).toContain('Outside the Plan: none')
})

test('changed files: without plannedPaths the outside check says so, and an unusual name is not drawn', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    git: { ...FOOTPRINT_GIT, [g('ls-files --others --exclude-standard -z')]: [0, 'src/\u001b[2Jx.ts\0.env\0'] },
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  const ui = await paneAt($, 200)
  await ui.press({ key: 'fold-sensitive' })
  await ui.unmount()
  await w.clock.settle()
  const lines = await pane($, 'terminal', 200)
  expect(lines).toContain('Outside the Plan: not checked (no planned-paths in plan.md)')
  expect(lines).toContain('  .env')
  expect(lines.join('\n')).not.toContain('\u001b')
})

test('changed files: a failing merge-base shows the section as unavailable', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    git: { ...FOOTPRINT_GIT, [g('merge-base origin/main HEAD')]: [128, ''] },
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  expect(await pane($, 'terminal', 200)).toContain('Changed Files: unavailable')
  expect(w.argv.some(line => line.startsWith(g('diff --numstat')))).toBe(false)
})

test('changed files: a base that git could read as an option is not used', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, base: '--output=x' }), git: FOOTPRINT_GIT })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  expect(w.argv.some(line => line.includes('merge-base'))).toBe(false)
  expect(await pane($, 'terminal', 200)).toContain('Changed Files: unavailable')
})

test('changed files: a slow git leaves the next goal as it is', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
    git: FOOTPRINT_GIT,
    slowArgv: [g('merge-base origin/main HEAD')],
  })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('Test', ID))
  await w.clock.settle()
  expect(w.commands).toEqual(['clear', `goal ${goalFor('Test', ID)}`])
})

test('changed files: a throwing git leaves the stuck dialog as it is', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: '---\nphase: build\nstatus: blocked\n---\n\n## Open points\n\n- x\n' },
    failArgv: [g('merge-base origin/main HEAD')],
  })
  await begin($)
  await turnEnd($)
  await w.asked(1)
  await w.clock.settle()
  expect(w.asks).toHaveLength(1)
  expect(await pane($, 'terminal', 200)).toContain('Changed Files: unavailable')
})

test('changed files: a throwing git leaves the gate dialog as it is', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), goalActive: true }),
    files: { [phaseFile('Plan')]: PLAN_FIELDS },
    failArgv: [g('merge-base origin/main HEAD')],
  })
  await begin($)
  await turnEnd($)
  await w.asked(1)
  await w.clock.settle()
  expect(w.asks[0]?.header).toBe('Gate')
  expect(w.run()?.state).toBe('gate')
})

test('changed files: a first draw without a footprint shows the section empty and writes nothing', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), git: FOOTPRINT_GIT })
  await begin($)
  const lines = await pane($, 'terminal', 200)
  expect(lines.some(line => line.startsWith('Changed Files'))).toBe(false)
  expect(w.writes).toEqual([])
  expect(w.argv.some(line => line.includes('merge-base'))).toBe(false)
})

// Open counts

test('open counts: an Edit under changes/<id>/ redraws the pane, and "2/3 open" follows the file', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }), files: { [phaseFile('Spec')]: SPEC_OPEN } })
  await begin($)
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'goal-and-do',
    props: { title: 'goal-and-do', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect((await ui.find({ key: 'row-Spec' }))?.text).toContain('2/3 open')
  w.files.set(phaseFile('Spec'), SPEC_OPEN.replace('- Who receives the export?\n', ''))
  await $.tool.call({ tool: 'Edit', file_path: `/repo/changes/${ID}/spec.md`, old_string: 'a', new_string: 'b' })
  await w.clock.settle()
  expect((await ui.find({ key: 'row-Spec' }))?.text).toContain('1/2 open')
  await ui.unmount()
})

test('open counts: an approved earlier phase shows none, the current one does', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Plan'), goalActive: true, approvals: approvalsTo('Plan').slice(0, 2) }),
    files: { [phaseFile('Spec')]: SPEC_OPEN, [phaseFile('Plan')]: SPEC_OPEN.replace('phase: spec', 'phase: plan') },
  })
  await begin($)
  const rows = await paneRowTexts($, 'terminal', 120)
  expect(rows[phaseAt('Spec')]).not.toContain('open')
  expect(rows[phaseAt('Plan')]).toContain('2/3 open')
})

// Blockers

for (const [name, run, shown] of [
  ['a reason the skill wrote', { phase: phaseAt('Spec'), state: 'blocked', reason: 'ABC-43224 says: see the ticket' }, 'Blocked: see Open points in spec.md'],
  ['a reason at Intent', { phase: phaseAt('Intent'), state: 'blocked', reason: 'the ticket says x' }, 'Blocked: see Open questions in intent.md'],
  [
    'a goal that ended without status',
    { phase: phaseAt('Build'), state: 'blocked', reason: TEXTS.goalEnded('MARKER-1 from the evaluator') },
    'Blocked: the goal ended without status: done.',
  ],
  ['a capped run', { phase: phaseAt('Build'), state: 'capped', turns: 40 }, 'Out of turns'],
  [
    'the changed tests',
    { phase: phaseAt('Build'), state: 'blocked', reason: 'the acceptance tests changed since Plan approval' },
    'Blocked: the acceptance tests changed since Plan approval',
  ],
  ['a push the person held back', { phase: phaseAt('PR'), state: 'blocked', reason: 'you chose not to push yet' }, 'Blocked: you chose not to push yet'],
  [
    'an approved file changed',
    { phase: phaseAt('PR'), state: 'blocked', reason: 'goal-and-do blocks the push: spec.md changed since its approval.' },
    'Blocked: goal-and-do blocks the push: spec.md changed since its approval.',
  ],
] as const) {
  test(`blockers: ${name} shows "${shown}"`, async ($, on) => {
    world(on, { run: runAt({ ...LOCK, ...run }) })
    await begin($)
    const lines = await pane($, 'terminal', 200)
    expect(lines).toContain(shown)
    expect(lines.join('\n')).not.toContain('MARKER-1')
    expect(lines.join('\n')).not.toContain('ticket')
  })
}

// The sections, in each state and phase

for (const phase of PHASES) {
  for (const state of ['running', 'gate', 'blocked', 'capped', 'interrupted', 'stopped', 'finished'] as const) {
    test(`sections: ${phase} ${state} shows each section only where it belongs`, async ($, on) => {
      const footprint = {
        groups: {},
        total: { files: 0, added: 0, removed: 0 },
        outside: undefined,
        isBroad: false,
        sensitive: [],
        lines: [{ text: 'Changed Files: none' }],
      }
      world(on, { run: runAt({ phase: phaseAt(phase), state, ...LOCK, reason: 'x', turns: state === 'capped' ? TURN_CAPS[phase] : 0 }), footprint })
      await begin($)
      const lines = await pane($, 'terminal', 200)
      const index = phaseAt(phase)
      const isActive = ['running', 'gate', 'blocked', 'capped', 'interrupted'].includes(state)
      expect(`blockers ${lines.includes('Denials: 0')}`).toBe(`blockers ${isActive}`)
      expect(barRows(lines)).toEqual([])
      expect(`changed ${lines.includes('Changed Files: none')}`).toBe(`changed ${index >= phaseAt('Build')}`)
      expect(`tests ${lines.some(line => /^[▼►] Tests: /.test(line))}`).toBe(`tests ${index >= phaseAt('Plan')}`)
    })
  }
}

test('sections: the Tests section names a missing test command, and the lock line shows from Plan approval on', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), ...LOCK }) })
  await begin($)
  const lines = await pane($, 'terminal', 200)
  expect(lines).toContain('► Tests: -')
  await openTests($)
  const opened = await pane($, 'terminal', 200)
  expect(opened).toContain('no test command in plan.md')
  expect(opened).toContain('Tests locked at 3f2c9a1')
})

test('sections: Tests lists no AC marks, and warns when a failed run meets all passed', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Test'), ...LOCK, testCommand: TEST_COMMAND, lastTests: { status: 'failed', phase: 'Test', at: NOW } }),
    files: {
      [phaseFile('Test')]:
        '---\nphase: test\nstatus: draft\n---\n\n| AC ID | Test | Result |\n| --- | --- | --- |\n| AC-1 | t1 | passed |\n| AC-2 | t2 | passed |\n',
    },
  })
  await begin($)
  const lines = await paneColors($)
  expect(lines.find(line => line.text.startsWith('AC marks'))).toBeUndefined()
  expect(lines.find(line => line.text.startsWith('test.md says'))?.color).toBe('warning')
})

test('sections: at 40 columns no line of the sections is wider, and the denial line wraps under the count', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), ...LOCK, denials: [{ phase: 'Build', key: 'ci' }], deniedCount: 1 }) })
  await begin($)
  const lines = await pane($, 'terminal', 40)
  expect(lines).toContain('▼ Denials (1)')
  expect(lines.indexOf('▼ Denials (1)')).toBeLessThan(lines.findIndex(text => text.startsWith('Build: ')))
  expect(lines.join(' ').replace(/ +/g, ' ')).toContain('Build: goal-and-do blocks edits to CI files (.github/workflows/, Jenkinsfile*).')
  for (const line of lines.filter(text => /^(▼ Denials|Tests|Build ·|Build: |  )/.test(text))) expect(line.length).toBeLessThanOrEqual(40)
})

test("sections: inline, the most urgent line comes first under the run's header", async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'the acceptance tests changed since Plan approval', ...LOCK }) })
  await begin($)
  const lines = (await paneColors($, 80, 'inline')).map(line => line.text)
  expect(lines[0]).toBe(HEAD)
  expect(lines[1]).toBe('Blocked: the acceptance tests changed since Plan approval')
})

test('sections: a denial key the pane cannot name shows the generic line', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), ...LOCK, denials: [{ phase: 'Build', key: 'toString' }], deniedCount: 1 }) })
  await begin($)
  expect(await pane($, 'terminal', 200)).toContain('Build: blocked by the guard')
})

// Signals

test('signals: the push dialog adds the outside, sensitive and denial counts', async ($, on) => {
  const w = world(
    on,
    withRecord({
      run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK, plannedPaths: ['src'], deniedCount: 1 }),
      git: FOOTPRINT_GIT,
      answers: ['Not now'],
    })
  )
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(w.asks[0]?.question).toBe(
    `${TEXTS.pushQuestion(ID)} Outside the plan: 3 files. Sensitive: 1 file. Denials: 1. Test-weakening signals and counts: none found. Nothing is blocked. Scanner (gitleaks): not scanned`
  )
})

test('signals: the PR goal start writes signals.md with the counts and up to five safe paths each', async ($, on) => {
  const many = ['f\u0007.txt', 'a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', ''].join('\0')
  const w = world(on, {
    run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK, plannedPaths: ['src'], deniedCount: 2 }),
    files: { [phaseFile('Test')]: done('test') },
    git: {
      ...FOOTPRINT_GIT,
      [g('ls-files --others --exclude-standard -z')]: [0, many],
      [g(`rev-parse --git-path goal-and-do/signals-${ID}.md`)]: [0, `.git/goal-and-do/signals-${ID}.md\n`],
    },
  })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('PR', ID))
  await w.clock.settle()
  const text = w.files.get(`.git/goal-and-do/signals-${ID}.md`) ?? ''
  expect(text).toContain(
    '- Outside the plan: 8 files\n  - package.json\n  - docs/logo.png\n  - <a file with an unusual name>\n  - a.txt\n  - b.txt\n  - +3 more\n'
  )
  expect(text).toContain('- Sensitive files: 1 file\n  - package.json\n')
  expect(text).toContain('- Denials: 2\n')
  expect(text).not.toContain('\u0007')
  expect(w.run()?.state).toBe('running')
})

// Fix round 1

const FILTERS = [
  'local',
  'filter.x.clean\nsh -c evil',
  'local',
  'filter.x.smudge\nsh -c evil',
  'worktree',
  'filter.w.smudge\ny',
  'global',
  'filter.lfs.clean\ngit-lfs clean -- %f',
  'global',
  'filter.lfs.process\ngit-lfs filter-process',
  'system',
  'filter.s.clean\nz',
  '',
].join('\0')

test("git filters: each filter the repository defines (local or worktree scope) runs no program in the mod's diff and status; a filter only at global or system scope is left on, and system config is never read", async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
    git: { ...FOOTPRINT_GIT, [FILTER_READ]: [0, FILTERS] },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.argv).toContain(gF('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance', ['x', 'w']))
  expect(w.argv).toContain(gF(`diff --numstat -z --no-renames ${BASE_SHA}`, ['x', 'w']))
  expect(w.argv.filter(line => line !== FILTER_READ).some(line => /filter\.(lfs|s)\./.test(line))).toBe(false)
  expect(w.argv.some(line => line.includes('attr-source') || line.includes('attributesFile'))).toBe(false)
  expect(w.run()).toMatchObject({ phase: phaseAt('Test'), lastLockCheck: { changed: false } })
  expect(w.envs[w.argv.indexOf(FILTER_READ)]).toEqual({ GIT_CONFIG_NOSYSTEM: '1' })
  expect(w.timeouts[w.argv.indexOf(FILTER_READ)]).toBe(5000)
})

test('git filters: no filter at all (git config exits 1) leaves the calls as they are', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
    git: { [FILTER_READ]: [1, ''] },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.argv).toContain(g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance'))
  expect(w.run()).toMatchObject({ phase: phaseAt('Test') })
})

for (const [name, answer] of [
  ['an unusual filter name', [0, 'local\0filter.$(id).clean\nz\0']],
  ['a filter name with a space', [0, 'worktree\0filter.a b.clean\nz\0']],
  ['a failing read', [128, '']],
  ['a read git could not run', undefined],
] as const) {
  test(`git filters: ${name} fails closed, as a change of the tests and unavailable changed files`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
      files: { [phaseFile('Build')]: done('build') },
      git: { ...FOOTPRINT_GIT, ...(answer === undefined ? {} : { [FILTER_READ]: [answer[0], answer[1]] as [number, string] }) },
      ...(answer === undefined ? { failArgv: [FILTER_READ] } : {}),
    })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.run()).toMatchObject({ state: 'blocked', reason: 'the acceptance tests changed since Plan approval', lastLockCheck: { changed: true } })
    expect(w.argv.some(line => / (diff|status) /.test(line))).toBe(false)
    expect(await pane($, 'terminal', 200)).toContain('Changed Files: unavailable')
  })
}

test('signals: the PR goal start deletes the older signals file of the run first, at the path git gives', async ($, on) => {
  const at = `/main/.git/worktrees/w/goal-and-do/signals-${ID}.md`
  const w = world(on, {
    run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Test')]: done('test'), [at]: 'old', '.git/goal-and-do/signals.md': 'another' },
    git: { [g(`rev-parse --git-path goal-and-do/signals-${ID}.md`)]: [0, `${at}\n`] },
    failWrites: [at],
  })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('PR', ID))
  await w.clock.settle()
  expect(w.argv).toContain(`rm -f -- ${at}`)
  expect(w.files.has(at)).toBe(false)
  expect(w.files.get('.git/goal-and-do/signals.md')).toBe('another')
})

// Refuses the first timer asked for during each main-loop turn.complete, and logs each refusal.
const TIMER_REFUSER = {
  name: 'timer-refuser',
  tier: 'prepend' as const,
  register(on: On) {
    let isArmed = false
    on('turn.complete', async ($, e, next) => {
      isArmed = e.agentId === undefined
      try {
        return await next(e)
      } finally {
        isArmed = false
      }
    })
    on('clock.after', ($, e, next) => {
      if (!isArmed) return next(e)
      isArmed = false
      $.ui.log('timer refused')
      return { deny: 'refused' }
    })
  },
}

test(
  'changed files: a refresh whose timer is refused at turn.complete leaves the gate as it is, and later refreshes run',
  { plugins: [TIMER_REFUSER] },
  async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Plan'), goalActive: true }),
      files: { [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
      git: FOOTPRINT_GIT,
      answers: ['Approve, start Build'],
    })
    await begin($)
    await turnEnd($)
    await w.goal(goalFor('Build', ID))
    await w.clock.settle()
    expect(w.logs.filter(line => line === 'timer refused')).toHaveLength(1)
    expect(w.asks[0]?.header).toBe('Gate')
    expect(w.run()).toMatchObject({ phase: phaseAt('Build'), state: 'running' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await w.clock.settle()
    expect(w.argv).toContain(g('merge-base origin/main HEAD'))
  }
)

test('run.json: a slow write of a denial never lands over a later approval', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate' }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Intent')]: INTENT_DONE },
    answers: ['Approve, start Plan'],
  })
  await begin($)
  w.slowWrite = `changes/${ID}/run.json`
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/.github/workflows/ci.yml', content: 'x' })).deny).toBe(CI_TEXT)
  await w.clock.settle()
  expect(w.slowWrite).toBeUndefined()
  expect(w.files.has(`changes/${ID}/run.json`)).toBe(false)
  await command($, 'next')
  await w.clock.settle()
  await w.clock.advance(60_000)
  await w.goal(goalFor('Plan', ID))
  await w.clock.settle()
  expect(w.debug.filter(line => line.includes('run.json'))).toEqual([])
  expect(w.writes.filter(path => path === `changes/${ID}/run.json`).length).toBeGreaterThan(1)
  expect(w.json()).toMatchObject({ phase: phaseAt('Plan'), state: 'running', deniedCount: 1 })
  expect(w.json()).toEqual(w.run())
})

test("run.json: a write that is refused is logged by the error's name, and the next write still lands", async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  w.failWrite = `changes/${ID}/run.json`
  await $.tool.call({ tool: 'Write', file_path: '/repo/.github/workflows/ci.yml', content: 'x' })
  await w.clock.settle()
  expect(w.files.has(`changes/${ID}/run.json`)).toBe(false)
  expect(w.debug.filter(line => line.startsWith('goal-and-do: run.json not written: '))).toHaveLength(1)
  expect(w.debug.join('\n')).not.toContain('EACCES')
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })
  await w.clock.settle()
  expect(w.json()).toMatchObject({ deniedCount: 2 })
})

// Fix round 3

const NO_STATUS = "goal-and-do can't read the working tree with git status. Check the repository's Git config, its filters and the Git version."

for (const [name, setup] of [
  ['an unusual local filter name', { git: { [FILTER_READ]: [0, 'local\0filter.my f.clean\nz\0'] as [number, string] } }],
  ['a failing git status', { git: { [g('status --porcelain -z --untracked-files=all')]: [128, ''] as [number, string] } }],
] as const) {
  test(`preflight: ${name} refuses the start with the no-status line`, async ($, on) => {
    const w = world(on, setup)
    await begin($)
    expect(await command($, ID)).toBe(NO_STATUS)
    expect(TEXTS.preflightNoStatus).toBe(NO_STATUS)
    await w.clock.settle()
    expect(w.writes).toEqual([])
    expect(w.run()).toBeNull()
  })
}

const LFS = (scope: string, extra: string[] = []) =>
  [
    scope,
    'filter.lfs.clean\ngit-lfs clean -- %f',
    scope,
    'filter.lfs.smudge\ngit-lfs smudge -- %f',
    scope,
    'filter.lfs.process\ngit-lfs filter-process',
    scope,
    'filter.lfs.required\ntrue',
    ...extra,
    '',
  ].join('\0')

for (const scope of ['local', 'worktree', 'global']) {
  test(`git filters: git-lfs at ${scope} scope, exactly as git lfs install writes it, stays on`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
      files: { [phaseFile('Build')]: done('build') },
      git: { [FILTER_READ]: [0, LFS(scope)] },
    })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.argv).toContain(g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance'))
  })
}

test('git filters: git-lfs without a process entry stays on too', async ($, on) => {
  const read = ['local', 'filter.lfs.clean\ngit-lfs clean -- %f', 'local', 'filter.lfs.smudge\ngit-lfs smudge -- %f', ''].join('\0')
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: done('build') },
    git: { [FILTER_READ]: [0, read] },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.argv).toContain(g('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance'))
})

for (const [name, read] of [
  ['another clean', LFS('local').replace('git-lfs clean -- %f', 'git-lfs clean -- %f; touch x')],
  ['another process', LFS('local').replace('git-lfs filter-process', 'sh -c evil')],
  ['an extra key', LFS('local', ['local', 'filter.lfs.foo\nbar'])],
  ['a second clean', LFS('local', ['local', 'filter.lfs.clean\nsh -c evil'])],
  ['a clean without a value', ['local', 'filter.lfs.clean', 'local', 'filter.lfs.smudge\ngit-lfs smudge -- %f', ''].join('\0')],
  ['no smudge', ['local', 'filter.lfs.clean\ngit-lfs clean -- %f', ''].join('\0')],
] as const) {
  test(`git filters: an lfs filter with ${name} is made harmless`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
      files: { [phaseFile('Build')]: done('build') },
      git: { [FILTER_READ]: [0, read] },
    })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.argv).toContain(gF('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance', ['lfs']))
  })
}

// Git's settings outside the repository

for (const [name, read, filtered] of [
  [
    'a filter only at global scope, not git-lfs, is left on',
    ['global', 'filter.g.clean\nsh -c evil', 'global', 'filter.g.smudge\nsh -c evil', ''].join('\0'),
    [],
  ],
  ['a filter only at global scope that looks like git-lfs is left on', ['global', 'filter.lfs.clean\ngit-lfs clean -- %f; evil', ''].join('\0'), []],
  ['a filter only at command scope is left on', ['command', 'filter.c.clean\nx', ''].join('\0'), []],
  ['a local filter is switched off', ['local', 'filter.l.clean\nsh -c evil', ''].join('\0'), ['l']],
  ['a name at global and local scope is switched off', ['global', 'filter.g.clean\nx', 'local', 'filter.g.smudge\ny', ''].join('\0'), ['g']],
] as [string, string, string[]][]) {
  test(`git filters: ${name}`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
      files: { [phaseFile('Build')]: done('build') },
      git: { [FILTER_READ]: [0, read] },
    })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.argv).toContain(gF('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance', filtered))
  })
}

for (const [name, read, filtered] of [
  ['the same values at global and local scope stays on', LFS('global') + LFS('local'), []],
  ['another value at local scope beside the global one is turned off', LFS('global') + LFS('local').replace('git-lfs smudge -- %f', 'sh -c evil'), ['lfs']],
] as [string, string, string[]][]) {
  test(`git filters: git-lfs with ${name}`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
      files: { [phaseFile('Build')]: done('build') },
      git: { [FILTER_READ]: [0, read] },
    })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.argv).toContain(gF('diff --quiet 3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345 -- tests/acceptance', filtered))
  })
}

test("Build: the user's Git config and attributes are denied to the edit tools and the shell, from the mod's HOME", async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  mock.env(on, { HOME: '/Users/me' })
  await begin($)
  for (const file of ['/Users/me/.gitconfig', '/Users/me/.config/git/config', '/Users/me/.config/git/attributes']) {
    expect((await $.tool.call({ tool: 'Write', file_path: file, content: 'x' })).deny, file).toBe(REASONS.gitDir)
    expect((await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'b' })).deny, file).toBe(REASONS.gitDir)
    expect((await $.tool.call({ tool: 'Bash', command: `echo x >> ${file}` })).deny, file).toBe(REASONS.gitDir)
  }
  for (const command of ['echo x >> ~/.gitconfig', 'tee -a $HOME/.config/git/attributes']) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBe(REASONS.gitDir)
  }
  expect((await $.tool.call({ tool: 'Write', file_path: '/repo/docs/.gitconfig', content: 'x' })).deny).toBeUndefined()
})

test("Build: the user's Git config follows the mod's XDG_CONFIG_HOME", async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  mock.env(on, { HOME: '/Users/me', XDG_CONFIG_HOME: '/Users/me/xdg' })
  await begin($)
  expect((await $.tool.call({ tool: 'Write', file_path: '/Users/me/xdg/git/config', content: 'x' })).deny).toBe(REASONS.gitDir)
  expect((await $.tool.call({ tool: 'Bash', command: 'echo x >> /Users/me/xdg/git/attributes' })).deny).toBe(REASONS.gitDir)
  expect((await $.tool.call({ tool: 'Write', file_path: '/Users/me/xdg/other.md', content: 'x' })).deny).toBeUndefined()
})

test('Build: with HOME unset, an edit of any .gitconfig or .config/git/config is denied', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  expect((await $.tool.call({ tool: 'Write', file_path: '/home/x/.gitconfig', content: 'x' })).deny).toBe(REASONS.gitDir)
  expect((await $.tool.call({ tool: 'Write', file_path: '/home/x/.config/git/config', content: 'x' })).deny).toBe(REASONS.gitDir)
})

// Git's settings, checked at each gate and before the push

test("git settings: the start stores their fingerprint, read with git's safety options in 5 seconds", async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' } })
  await begin($)
  expect(await command($, URL_INPUT)).toBe(TEXTS.startedJira(ID))
  expect(w.store.get(`gitSettings:${ID}`)).toEqual({ fingerprint: NO_SETTINGS, pushUrl: PUSH_URL })
  for (const line of [SETTINGS_READ, SETTINGS_PATHS, PUSH_URL_READ]) expect(w.timeouts[w.argv.indexOf(line)]).toBe(5000)
  // The fingerprint's config list reads the system scope too, since the push reads it; every other git call doesn't.
  expect(w.envs[w.argv.indexOf(SETTINGS_READ)]).toBeUndefined()
  const others = w.argv.flatMap((line, i) => (line.startsWith('git ') && line !== SETTINGS_READ ? [i] : []))
  expect(others.length).toBeGreaterThan(3)
  for (const i of others) expect(w.envs[i], w.argv[i]).toEqual({ GIT_CONFIG_NOSYSTEM: '1' })
  expect(GIT_SETTINGS_CHANGED).toBe("goal-and-do blocks the run: Git's config, hooks or attributes changed since the run started.")
})

test('git settings: a filter added after the start blocks the run at the next gate, with the stuck dialog', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' }, answers: ['Not yet'] })
  await begin($)
  await command($, URL_INPUT)
  await w.clock.settle()
  w.git[SETTINGS_READ] = settingsAnswer([['global', 'filter.a.clean', 'sh -c evil']])
  w.files.set(phaseFile('Intent'), INTENT_DONE)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ phase: phaseAt('Intent'), state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  expect(w.asks).toHaveLength(1)
  expect(w.asks[0]?.header).toBe('Stuck')
  expect(w.asks[0]?.question).toBe(TEXTS.stuckBlocked('Intent', GIT_SETTINGS_CHANGED, ID))
  expect((await pane($, 'terminal', 200)).join('\n')).toContain(`Blocked: ${GIT_SETTINGS_CHANGED}`)
})

for (const [name, entries] of [
  ['a filter', [['local', 'filter.a.clean', 'x']]],
  ['an include', [['local', 'include.path', '/tmp/x']]],
  ['an includeIf', [['local', 'includeif.gitdir:/repo/.path', '/tmp/x']]],
  ['a hooks path', [['global', 'core.hookspath', '/tmp/h']]],
  ['an fsmonitor', [['local', 'core.fsmonitor', 'x']]],
  ['a diff command', [['local', 'diff.a.command', 'x']]],
  ['a textconv', [['local', 'diff.a.textconv', 'x']]],
  ['an attributes file', [['global', 'core.attributesfile', '/tmp/a']]],
  ['a push URL', [['local', 'remote.origin.pushurl', 'https://evil/x.git']]],
  ['a remote URL', [['local', 'remote.evil.url', 'https://evil/x.git']]],
  ['a push URL rewrite', [['global', 'url.https://evil/.pushinsteadof', 'https://github.com/']]],
  ['a URL rewrite', [['global', 'url.https://evil/.insteadof', 'https://github.com/']]],
  ['a credential helper', [['global', 'credential.helper', '!sh -c evil']]],
  ['an ssh command', [['local', 'core.sshcommand', 'ssh -i x']]],
  ['an askpass program', [['local', 'core.askpass', '/tmp/x']]],
  ['a git proxy', [['global', 'core.gitproxy', '/tmp/x']]],
  ['a receive-pack', [['local', 'remote.origin.receivepack', '/tmp/x']]],
  ['an upload-pack', [['local', 'remote.origin.uploadpack', '/tmp/x']]],
  ['a remote helper', [['local', 'remote.origin.vcs', 'x']]],
  ['a remote proxy', [['local', 'remote.origin.proxy', 'http://evil:8080']]],
  ['an http proxy', [['global', 'http.proxy', 'http://evil:8080']]],
  ['an http header for one URL', [['global', 'http.https://github.com/.extraheader', 'X: y']]],
  ['a gpg program', [['local', 'gpg.program', '/tmp/x']]],
  ['a push setting', [['local', 'push.recursesubmodules', 'on-demand']]],
  ['an alias', [['global', 'alias.st', '!sh -c evil']]],
  ['a submodule URL', [['local', 'submodule.x.url', 'https://evil/x.git']]],
  ['a key no list names', [['local', 'core.filemode', 'false']]],
  ['a user setting at the worktree scope', [['worktree', 'user.name', 'x']]],
  ['a URL rewrite at the system scope', [['system', `url.https://evil/.insteadof`, PUSH_URL]]],
  ['a gh-resolved other than base', [['local', 'remote.origin.gh-resolved', 'attacker/evil']]],
  ['a gh-resolved of base in another case', [['local', 'remote.origin.gh-resolved', 'Base']]],
] as [string, [string, string, string][]][]) {
  test(`git settings: ${name} added since the start blocks the run at the gate`, async ($, on) => {
    const w = world(on, {
      run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
      files: { [phaseFile('Spec')]: SPEC_DONE },
      git: { [SETTINGS_READ]: settingsAnswer(entries) },
    })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
    expect(w.asks[0]?.header).toBe('Stuck')
  })
}

test('git settings: what git and gh write in a run does not count: branch.*, remote.*.fetch and gh-resolved, the LFS version', async ($, on) => {
  const tracking: [string, string, string][] = [
    ['local', `branch.sdd/${ID}.remote`, 'origin'],
    ['local', `branch.sdd/${ID}.merge`, `refs/heads/sdd/${ID}`],
    ['local', `branch.sdd/${ID}.gh-merge-base`, 'main'],
    ['local', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*'],
    ['local', 'remote.origin.gh-resolved', 'base'],
    ['local', 'remote.up.stream.fetch', '+refs/heads/*:refs/remotes/up.stream/*'],
    ['local', 'lfs.repositoryformatversion', '0'],
  ]
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    git: { [SETTINGS_READ]: settingsAnswer(tracking) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('gate')
  expect(w.asks[0]?.header).toBe('Gate')
})

for (const [name, files, git] of [
  ['a new hook file', { '.git/hooks/pre-commit': 'curl x' }, {}],
  ['a hook that runs now', { '.git/hooks/pre-commit': 'curl x' }, { [HOOKS_RUN]: [0, '/repo/.git/hooks/pre-commit\0'] }],
  ['a new info/attributes', { '.git/info/attributes': '* filter=a' }, {}],
] as [string, Record<string, string>, Record<string, [number, string]>][]) {
  test(`git settings: ${name} blocks the run at the gate`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }), files: { [phaseFile('Spec')]: SPEC_DONE, ...files }, git })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  })
}

test('git settings: the hooks are read from the folder git gives, with their run bits', async ($, on) => {
  const hooks = { '.git/hooks/pre-commit': 'x', '.git/hooks/post-merge': 'y' }
  const print = JSON.stringify({
    config: [],
    attributes: 'none',
    globalAttributes: 'none',
    hooks: [`post-merge\0file\x000\0-\0${await hookShaOf('y')}`, `pre-commit\0file\x000\0x\0${await hookShaOf('x')}`],
  })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE, ...hooks },
    git: { [HOOKS_RUN]: [0, '/repo/.git/hooks/pre-commit\0'] },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('gate')
  expect(w.timeouts[w.argv.indexOf(HOOKS_RUN)]).toBe(5000)
})

for (const [name, setup] of [
  ['a failing config read', { git: { [SETTINGS_READ]: [128, ''] } }],
  ['a config read git could not run', { failArgv: [SETTINGS_READ] }],
  ['a failing rev-parse', { git: { [SETTINGS_PATHS]: [128, ''] } }],
  ['a failing hooks read', { files: { '.git/hooks/pre-commit': 'x' }, git: { [HOOKS_RUN]: [1, ''] } }],
  ['no stored fingerprint', { store: { [`gitSettings:${ID}`]: undefined } }],
  ['a fingerprint of the old form, from before every entry counted', { store: { [`gitSettings:${ID}`]: NO_SETTINGS } }],
  ['a record with no fingerprint', { store: { [`gitSettings:${ID}`]: { pushUrl: PUSH_URL } } }],
  ['a config list git ends with no NUL pair', { git: { [SETTINGS_READ]: [0, 'local\0core.bare\nfalse\0local'] } }],
] as [string, Partial<Setup>][]) {
  test(`git settings: ${name} blocks the run at the gate`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }), ...setup, files: { [phaseFile('Spec')]: SPEC_DONE, ...setup.files } })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  })
}

// core.hooksPath=/dev/null turns hooks off: rev-parse prints /dev/null, and listing it fails as a file does.
const NOT_A_DIRECTORY = "ENOTDIR: not a directory, scandir '/dev/null'"
const HOOKS_OFF = { [SETTINGS_PATHS]: [0, '/dev/null\n.git/info/attributes\n'] } as Record<string, [number, string]>

test('git settings: a hooks path of /dev/null means no hooks, so the start stores a fingerprint and the first gate passes', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' }, git: HOOKS_OFF, others: ['/dev/null'], listError: NOT_A_DIRECTORY })
  await begin($)
  expect(await command($, URL_INPUT)).toBe(TEXTS.startedJira(ID))
  expect(w.store.get(`gitSettings:${ID}`)).toEqual({ fingerprint: NO_SETTINGS, pushUrl: PUSH_URL })
  expect(w.argv).not.toContain(HOOKS_RUN)
  expect(w.debug.filter(line => line.includes('git settings unreadable'))).toEqual([])
  await w.clock.settle()
  w.files.set(phaseFile('Intent'), INTENT_DONE)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ phase: phaseAt('Intent'), state: 'gate' })
  expect(w.run()?.reason).toBeUndefined()
  expect(w.asks[0]?.header).toBe('Gate')
})

test('git settings: a hooks path that is a regular file means no hooks', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '', '.git/hooks': 'not a folder' }, listError: NOT_A_DIRECTORY })
  await begin($)
  await command($, URL_INPUT)
  expect(w.store.get(`gitSettings:${ID}`)).toEqual({ fingerprint: NO_SETTINGS, pushUrl: PUSH_URL })
  expect(w.argv).not.toContain(HOOKS_RUN)
  expect(w.debug.filter(line => line.includes('git settings unreadable'))).toEqual([])
})

test('git settings: a hooks folder that is not there means no hooks', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' } })
  await begin($)
  await command($, URL_INPUT)
  expect(w.store.get(`gitSettings:${ID}`)).toEqual({ fingerprint: NO_SETTINGS, pushUrl: PUSH_URL })
  expect(w.argv).not.toContain(HOOKS_RUN)
})

test('git settings: a hooks path that links to a folder still lists the folder', async ($, on) => {
  const print = JSON.stringify({
    config: [],
    attributes: 'none',
    globalAttributes: 'none',
    hooks: [`pre-commit\0file\x000\0-\0${await hookShaOf('x')}`],
  })
  const w = world(on, {
    files: { '.git/info/exclude': '', 'tools/hooks/pre-commit': 'x' },
    links: { '.git/hooks': '/repo/tools/hooks' },
  })
  await begin($)
  await command($, URL_INPUT)
  expect(w.store.get(`gitSettings:${ID}`)).toEqual({ fingerprint: await shaOf(print), pushUrl: PUSH_URL })
})

test('git settings: a hooks folder that cannot be listed for another reason blocks the run at the gate', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '', '.git/hooks/pre-commit': 'x' }, unlistable: ['.git/hooks'], answers: ['Not yet'] })
  await begin($)
  await command($, URL_INPUT)
  expect(w.store.has(`gitSettings:${ID}`)).toBe(false)
  await w.clock.settle()
  w.files.set(phaseFile('Intent'), INTENT_DONE)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ phase: phaseAt('Intent'), state: 'blocked', reason: GIT_SETTINGS_CHANGED })
})

test('git settings: a hooks path whose stat fails with an error other than a missing one stays unreadable', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' }, git: HOOKS_OFF, statFails: ['/dev/null'] })
  await begin($)
  await command($, URL_INPUT)
  expect(w.store.has(`gitSettings:${ID}`)).toBe(false)
  expect(w.debug).toContain('goal-and-do: git settings unreadable: hooks folder')
})

for (const [part, setup] of [
  ['config read', { git: { [SETTINGS_READ]: [128, ''] } }],
  ['config read', { failArgv: [SETTINGS_READ] }],
  ['config read', { git: { [SETTINGS_READ]: [0, 'local\0core.bare\nfalse\0local'] } }],
  ['rev-parse', { git: { [SETTINGS_PATHS]: [128, ''] } }],
  ['attributes file', { files: { '.git/info/attributes': '* filter=a' }, unreadable: ['.git/info/attributes'] }],
  ['global attributes file', { git: { [SETTINGS_READ]: settingsAnswer([['global', 'core.attributesfile', '~other/attributes']]) } }],
  ['hooks folder', { files: { '.git/hooks/pre-commit': 'x' }, git: { [HOOKS_RUN]: [1, ''] } }],
  ['hooks folder', { files: { '.git/hooks/pre-commit': 'x' }, unlistable: ['.git/hooks'] }],
  ['hooks folder', { files: { '.git/hooks/pre-commit': 'x' }, unreadable: ['.git/hooks/pre-commit'] }],
] as [string, Partial<Setup>][]) {
  test(`git settings: the debug log names the ${part} when the fingerprint cannot be read`, async ($, on) => {
    const w = world(on, { ...setup, files: { '.git/info/exclude': '', ...setup.files } })
    await begin($)
    await command($, URL_INPUT)
    expect(w.store.has(`gitSettings:${ID}`)).toBe(false)
    const lines = w.debug.filter(line => line.includes('git settings unreadable'))
    expect(lines).toEqual([`goal-and-do: git settings unreadable: ${part}`])
  })
}

function prRun(overrides: Partial<Run> = {}): Setup {
  return withRecord({
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK, approvals: approvalsTo('PR', ID), ...overrides }),
    files: { [phaseFile('Intent')]: INTENT_APPROVED, [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE },
  })
}

test('git settings: a filter added since the start blocks the push and the run', async ($, on) => {
  const w = world(on, { ...prRun(), git: { [SETTINGS_READ]: settingsAnswer([['local', 'filter.a.clean', 'x']]) } })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBe(GIT_SETTINGS_CHANGED)
  expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  expect(w.ran).toEqual([])
  await w.clock.settle()
  expect(w.run()?.denials).toEqual([{ phase: 'PR', key: 'gitSettingsChanged' }])
  expect((await pane($, 'terminal', 200)).join('\n')).toContain(`PR: ${GIT_SETTINGS_CHANGED}`)
})

test('git settings: the push waits for no person when the settings changed', async ($, on) => {
  const w = world(on, { ...prRun({ pushApproved: false }), git: { [SETTINGS_READ]: [128, ''] } })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBe(GIT_SETTINGS_CHANGED)
  expect(w.asks).toEqual([])
})

test('git settings: the guard keeps denying the push while the run is blocked for them, even with the settings back', async ($, on) => {
  const w = world(on, prRun({ state: 'blocked', reason: GIT_SETTINGS_CHANGED, goalActive: false }))
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBe(GIT_SETTINGS_CHANGED)
  expect(w.ran).toEqual([])
})

test('git settings: unchanged settings let the push through', async ($, on) => {
  const w = world(on, prRun())
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBeUndefined()
  expect(w.argv).toContain(SETTINGS_READ)
})

test('git settings: the same entry at another scope counts as a change', async ($, on) => {
  const print = JSON.stringify({ config: ['local\0user.name\nx'], attributes: 'none', globalAttributes: 'none', hooks: [] })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    git: { [SETTINGS_READ]: settingsAnswer([['global', 'user.name', 'x']]) },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
})

test('git settings: every entry counts, sorted, by scope, key and value, a key with no value too', async ($, on) => {
  const entries: [string, string, string][] = [
    ['local', 'core.bare', 'false'],
    ['global', 'user.name', 'a\nb'],
    ['local', `branch.sdd/${ID}.remote`, 'origin'],
  ]
  const [, listed] = settingsAnswer(entries)
  const print = JSON.stringify({
    config: ['global\0user.name\na\nb', 'local\0core.bare\nfalse', 'local\0core.keyonly'],
    attributes: 'none',
    globalAttributes: 'none',
    hooks: [],
  })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    git: { [SETTINGS_READ]: [0, `${listed}local\0core.keyonly\0`] },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('gate')
})

for (const [name, env, file] of [
  ['under HOME', { HOME: '/Users/me' }, '/Users/me/.config/git/attributes'],
  ['under XDG_CONFIG_HOME', { HOME: '/Users/me', XDG_CONFIG_HOME: '/Users/me/xdg' }, '/Users/me/xdg/git/attributes'],
] as [string, Record<string, string>, string][]) {
  test(`git settings: a global attributes file ${name} added since the start blocks the run at the gate`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }), files: { [phaseFile('Spec')]: SPEC_DONE, [file]: '* filter=a' } })
    mock.env(on, env)
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  })
}

test('git settings: core.attributesFile names the global attributes file, with ~ for HOME', async ($, on) => {
  const entry: [string, string, string] = ['global', 'core.attributesfile', '~/attrs']
  const print = JSON.stringify({
    config: ['global\0core.attributesfile\n~/attrs'],
    attributes: 'none',
    globalAttributes: await shaOf('* diff=a'),
    hooks: [],
  })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE, '/Users/me/attrs': '* diff=a', '/Users/me/.config/git/attributes': 'ignored' },
    git: { [SETTINGS_READ]: settingsAnswer([entry]) },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  mock.env(on, { HOME: '/Users/me' })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('gate')
  expect(w.rawPaths).toContain('/Users/me/attrs')
})

test('git settings: a changed global attributes file named by core.attributesFile blocks the run at the gate', async ($, on) => {
  const print = JSON.stringify({ config: ['global\0core.attributesfile\n/etc/attrs'], attributes: 'none', globalAttributes: await shaOf('a'), hooks: [] })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE, '/etc/attrs': 'b' },
    git: { [SETTINGS_READ]: settingsAnswer([['global', 'core.attributesfile', '/etc/attrs']]) },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
})

for (const path of ['~other/attrs', '%(prefix)/attrs']) {
  test(`git settings: a global attributes path the mod can't place (${path}) blocks the run at the gate`, async ($, on) => {
    const print = JSON.stringify({ config: [`global\0core.attributesfile\n${path}`], attributes: 'none', globalAttributes: 'none', hooks: [] })
    const w = world(on, {
      run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
      files: { [phaseFile('Spec')]: SPEC_DONE },
      git: { [SETTINGS_READ]: settingsAnswer([['global', 'core.attributesfile', path]]) },
      store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
    })
    mock.env(on, { HOME: '/Users/me' })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  })
}

// The push with forced settings

for (const args of [`origin sdd/${ID}`, `-u origin sdd/${ID}`, `origin HEAD:sdd/${ID}`, `-u origin HEAD:sdd/${ID}`]) {
  test(`push: git push ${args} reaches the engine with no hooks, the recorded push URL and plain ssh`, async ($, on) => {
    const w = world(on, prRun())
    await begin($)
    const r = await $.tool.call({ tool: 'Bash', command: `git push ${args}` })
    expect(r.deny).toBeUndefined()
    expect(w.bash).toEqual([forcedPush(args)])
    expect(w.bash[0]).toBe(
      `${PUSH_ENV} git -C '/repo' -c core.hooksPath=/dev/null -c core.sshCommand=ssh push --no-verify ${args.replace('origin', "'https://github.example.com/example/demo.git'")}`
    )
    expect(w.logs).toEqual([])
    expect(w.run()?.state).toBe('running')
  })
}

test("push: Git's settings changed during the push block the run and log one line; the push's own result reaches Claude", async ($, on) => {
  const pushed = forcedPush(`-u origin sdd/${ID}`)
  const w: ReturnType<typeof world> = world(on, {
    ...prRun(),
    bashOut: { [pushed]: 'To demo.git\n * [new branch] sdd/ABC-43224 -> sdd/ABC-43224\n' },
    onBash: command => {
      if (command === pushed) w.git[SETTINGS_READ] = settingsAnswer([['local', 'remote.origin.pushurl', 'https://evil/x.git']])
    },
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push -u origin sdd/${ID}` })
  expect(r.deny).toBeUndefined()
  expect(r.result).toEqual({ stdout: 'To demo.git\n * [new branch] sdd/ABC-43224 -> sdd/ABC-43224\n', stderr: '', interrupted: false })
  expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  expect(w.logs).toEqual([PUSH_SETTINGS_CHANGED])
  expect(w.logs).toEqual(["goal-and-do: Git's settings changed during the push; check the pushed branch."])
})

test('push: a fingerprint that cannot be read after the push counts as a change', async ($, on) => {
  const pushed = forcedPush(`origin sdd/${ID}`)
  const w: ReturnType<typeof world> = world(on, {
    ...prRun(),
    onBash: command => {
      if (command === pushed) w.git[SETTINGS_READ] = [128, '']
    },
  })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBeUndefined()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  expect(w.logs).toEqual([PUSH_SETTINGS_CHANGED])
})

test('push: only the rewritten push is checked after the call; another command that changes the settings is not', async ($, on) => {
  const w: ReturnType<typeof world> = world(on, {
    ...prRun(),
    onBash: () => {
      w.git[SETTINGS_READ] = [128, '']
    },
  })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: 'npm test' })).deny).toBeUndefined()
  expect(w.logs).toEqual([])
  expect(w.run()?.state).toBe('running')
})

test('push: a push asked for in the background runs in the foreground, so the check after it sees its end', async ($, on) => {
  const pushed = forcedPush(`-u origin sdd/${ID}`)
  const w: ReturnType<typeof world> = world(on, {
    ...prRun(),
    onBash: command => {
      if (command === pushed) w.git[SETTINGS_READ] = [128, '']
    },
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push -u origin sdd/${ID}`, run_in_background: true })
  expect(r.deny).toBeUndefined()
  expect(w.bashInputs).toEqual([{ command: pushed }])
  expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  expect(w.logs).toEqual([PUSH_SETTINGS_CHANGED])
})

test('push: the push keeps its other inputs as Claude gave them', async ($, on) => {
  const w = world(on, prRun())
  await begin($)
  await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}`, description: 'Push the branch', timeout: 120000 })
  expect(w.bashInputs).toEqual([{ command: forcedPush(`origin sdd/${ID}`), description: 'Push the branch', timeout: 120000 }])
})

test('push: the push runs at the project root, whatever folder the shell is in', async ($, on) => {
  const w = world(on, { ...prRun(), cwd: '/repo/sub/nested' })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(w.bash).toEqual([forcedPush(`origin sdd/${ID}`)])
  expect(w.bash[0]).toContain(" git -C '/repo' ")
})

for (const [name, root] of [
  ['no project root', ''],
  ['a project root with a line break', '/re\npo'],
] as [string, string][]) {
  test(`push: ${name} denies the push, with no dialog, and nothing runs`, async ($, on) => {
    const w = world(on, { ...prRun({ pushApproved: false }), root })
    await begin($)
    const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
    expect(r.deny).toBe(REASONS.pushTarget)
    expect(w.asks).toEqual([])
    expect(w.ran).toEqual([])
  })
}

test('push: the person is asked first, then the push goes on rewritten', async ($, on) => {
  const [pushLabel = ''] = TEXTS.pushOptions
  const w = world(on, { ...prRun({ pushApproved: false }), answers: [pushLabel] })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push -u origin sdd/${ID}` })
  expect(r.deny).toBeUndefined()
  expect(w.asks).toHaveLength(1)
  expect(w.bash).toEqual([forcedPush(`-u origin sdd/${ID}`)])
})

test('push: a push the guard allows but not in the exact shape is denied, with no dialog, and nothing runs', async ($, on) => {
  const w = world(on, prRun({ pushApproved: false }))
  await begin($)
  for (const command of [`GIT_TERMINAL_PROMPT=0 git push origin sdd/${ID}`, `/usr/bin/git push origin sdd/${ID}`, `git 'push' origin 'sdd/${ID}'`]) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBe(REASONS.pushTarget)
  }
  expect(w.asks).toEqual([])
  expect(w.ran).toEqual([])
  await w.clock.settle()
  expect(w.run()?.deniedCount).toBe(3)
})

test("push: Claude's own forced push, as the mod would write it, is denied by the guard", async ($, on) => {
  const w = world(on, prRun())
  await begin($)
  for (const command of [forcedPush(`origin sdd/${ID}`), forcedPush(`origin sdd/${ID}`, 'https://evil/x.git')]) {
    expect((await $.tool.call({ tool: 'Bash', command })).deny, command).toBe(REASONS.gitConfig)
  }
  expect(w.ran).toEqual([])
})

for (const [name, record] of [
  ['no recorded push URL', settingsRecord(NO_SETTINGS, null)],
  ['a push URL with a leading dash', settingsRecord(NO_SETTINGS, '-oProxyCommand=evil')],
  ['a push URL with a line break', settingsRecord(NO_SETTINGS, 'https://h/x\n.git')],
  ['a push URL with a control character', settingsRecord(NO_SETTINGS, 'https://h/\u001bx.git')],
  ['an empty push URL', settingsRecord(NO_SETTINGS, '')],
  ['a push URL that is no text', { fingerprint: NO_SETTINGS, pushUrl: 42 }],
] as [string, unknown][]) {
  test(`push: ${name} denies the push, with no dialog, and nothing runs`, async ($, on) => {
    const setup = prRun({ pushApproved: false })
    const w = world(on, { ...setup, store: { ...setup.store, [`gitSettings:${ID}`]: record } })
    await begin($)
    const r = await $.tool.call({ tool: 'Bash', command: `git push -u origin sdd/${ID}` })
    expect(r.deny).toBe(PUSH_URL_MISSING)
    expect(r.deny).toBe('goal-and-do blocks the push: it has no recorded push URL for origin.')
    expect(w.asks).toEqual([])
    expect(w.ran).toEqual([])
    await w.clock.settle()
    expect(w.run()?.denials).toEqual([{ phase: 'PR', key: 'pushUrlMissing' }])
    expect((await pane($, 'terminal', 200)).join('\n')).toContain(`PR: ${PUSH_URL_MISSING}`)
  })
}

test('git settings: the start records no push URL when git gives none', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' }, git: { [PUSH_URL_READ]: [2, ''] } })
  await begin($)
  expect(await command($, URL_INPUT)).toBe(TEXTS.startedJira(ID))
  expect(w.store.get(`gitSettings:${ID}`)).toEqual({ fingerprint: NO_SETTINGS })
})

test("push: after a restore, the push URL comes from the mod's store, never from run.json", async ($, on) => {
  const run = { ...runAt({ phase: phaseAt('PR'), state: 'blocked', reason: 'x', ...LOCK, approvals: approvalsTo('PR', ID) }), pushUrl: 'https://evil/x.git' }
  const [pushLabel = ''] = TEXTS.pushOptions
  const w = world(
    on,
    withRecord({
      files: {
        [`changes/${ID}/run.json`]: JSON.stringify(run),
        [phaseFile('Intent')]: INTENT_APPROVED,
        [phaseFile('Spec')]: SPEC_DONE,
        [phaseFile('Plan')]: PLAN_DONE,
      },
      store: { [`lock:${ID}`]: LOCK, [`gitSettings:${ID}`]: settingsRecord(NO_SETTINGS, 'git@github.com:example/demo.git') },
      answers: [pushLabel],
    })
  )
  await begin($)
  expect(w.run()).toMatchObject({ id: ID, phase: phaseAt('PR') })
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBeUndefined()
  expect(w.bash).toEqual([forcedPush(`origin sdd/${ID}`, 'git@github.com:example/demo.git')])
})

for (const [name, stored, written, state] of [
  ["the store's fingerprint, not run.json's, decides: a changed one blocks", settingsRecord('f'.repeat(64)), NO_SETTINGS, 'blocked'],
  ["run.json's fingerprint is never read: an unchanged store opens the gate", settingsRecord(NO_SETTINGS), 'f'.repeat(64), 'gate'],
] as const) {
  test(`git settings, restore: ${name}`, async ($, on) => {
    const run = { ...runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals: approvalsTo('Plan') }), gitSettings: written }
    const w = world(
      on,
      withRecord({
        files: { 'changes/ABC-2/run.json': JSON.stringify(run), [phaseFile('Plan', 'ABC-2')]: PLAN_DONE },
        store: { 'gitSettings:ABC-2': stored },
      })
    )
    await begin($)
    expect(w.run()).toMatchObject({ id: 'ABC-2', state: 'gate' })
    await command($, 'next')
    await w.clock.settle()
    expect(w.run()?.state).toBe(state)
  })
}

// Fix round 1

test('git settings: with a remote URL in place, branch tracking from git switch -c and git push -u does not count', async ($, on) => {
  const remote: [string, string, string] = ['local', 'remote.origin.url', `https://${HOST}/example/demo.git`]
  const print = JSON.stringify({
    config: [`local\0remote.origin.url\nhttps://${HOST}/example/demo.git`],
    attributes: 'none',
    globalAttributes: 'none',
    hooks: [],
  })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    git: {
      [SETTINGS_READ]: settingsAnswer([remote, ['local', `branch.sdd/${ID}.remote`, 'origin'], ['local', `branch.sdd/${ID}.merge`, `refs/heads/sdd/${ID}`]]),
    },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('gate')
})

for (const [name, files, links] of [
  ['a same-size edit of a hook', { '.git/hooks/pre-commit': 'bbbb' }, {}],
  ['a hook whose link target changed', { 'tools/pre-commit': 'bbbb' }, { '.git/hooks/pre-commit': '/repo/tools/pre-commit' }],
  ['a hook whose link leads nowhere', {}, { '.git/hooks/pre-commit': '/repo/gone' }],
] as [string, Record<string, string>, Record<string, string>][]) {
  test(`git settings: ${name} blocks the run at the gate`, async ($, on) => {
    const isLink = Object.keys(links).length > 0
    const print = JSON.stringify({
      config: [],
      attributes: 'none',
      globalAttributes: 'none',
      hooks: [`pre-commit\0${isLink ? 'other' : 'file'}\x000\0-\0${await hookShaOf('aaaa')}`],
    })
    const w = world(on, {
      run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
      files: { [phaseFile('Spec')]: SPEC_DONE, ...files },
      links,
      store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
    })
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  })
}

test("git settings: a hook through a link is fingerprinted by its target's content", async ($, on) => {
  const print = JSON.stringify({ config: [], attributes: 'none', globalAttributes: 'none', hooks: [`pre-commit\0other\x000\0-\0${await hookShaOf('aaaa')}`] })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE, 'tools/pre-commit': 'aaaa' },
    links: { '.git/hooks/pre-commit': '/repo/tools/pre-commit' },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('gate')
})

test('git settings: a change while the person reads the push dialog blocks the push after the answer', async ($, on) => {
  const [pushLabel = ''] = TEXTS.pushOptions
  const w: ReturnType<typeof world> = world(on, {
    ...prRun({ pushApproved: false }),
    answers: [pushLabel],
    beforeAnswer: () => {
      w.git[SETTINGS_READ] = settingsAnswer([['local', 'core.hookspath', '/tmp/h']])
    },
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(w.asks).toHaveLength(1)
  expect(r.deny).toBe(GIT_SETTINGS_CHANGED)
  expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
  expect(w.ran).toEqual([])
})

test('push: an approved file changed while the person reads the push dialog blocks the push after the answer', async ($, on) => {
  const [pushLabel = ''] = TEXTS.pushOptions
  const w: ReturnType<typeof world> = world(on, {
    ...prRun({ pushApproved: false }),
    answers: [pushLabel],
    beforeAnswer: () => {
      w.files.set(phaseFile('Spec'), `${SPEC_DONE}changed\n`)
    },
  })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toBe('goal-and-do blocks the push: spec.md changed since its approval.')
  expect(w.ran).toEqual([])
})

// Fix round 2

test('git settings: a same-size edit of a hook that is not UTF-8 blocks the run at the gate', async ($, on) => {
  const print = JSON.stringify({
    config: [],
    attributes: 'none',
    globalAttributes: 'none',
    hooks: [`pre-commit\0file\x000\0-\0${await hookShaOf([0xff, 0x01])}`],
  })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    binary: { '.git/hooks/pre-commit': [0xfe, 0x01] },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: GIT_SETTINGS_CHANGED })
})

test('git settings: an unchanged hook that is not UTF-8 opens the gate', async ($, on) => {
  const print = JSON.stringify({
    config: [],
    attributes: 'none',
    globalAttributes: 'none',
    hooks: [`pre-commit\0file\x000\0-\0${await hookShaOf([0xff, 0x01])}`],
  })
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    binary: { '.git/hooks/pre-commit': [0xff, 0x01] },
    store: { [`gitSettings:${ID}`]: settingsRecord(await shaOf(print)) },
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('gate')
})

// Pane layout: one blank line between groups, long lines wrap

const RICH_FOOTPRINT = {
  groups: { tests: { files: 1, added: 3, removed: 0 }, ci: { files: 0, added: 0, removed: 0 }, rest: { files: 1, added: 2, removed: 1 } },
  total: { files: 2, added: 5, removed: 1 },
  outside: undefined,
  isBroad: false,
  sensitive: [],
  lines: [{ text: 'Changed Files: 2, +5 -1' }, { text: '  tests: 1 file', drop: 2 }],
}

test('the pane puts one blank line between its groups and none at the top, at the bottom or inside a group', async ($, on) => {
  world(on, {
    run: runAt({
      phase: phaseAt('Build'),
      goalActive: true,
      ...LOCK,
      prUrl: 'https://github.example.com/o/r/pull/485',
      suggested: ['Bash(npm test)'],
      deniedCount: 1,
    }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    turn: { startedAt: NOW - 12 * 60_000, calls: 4 },
    footprint: RICH_FOOTPRINT,
  })
  await begin($)
  const rows = await paneRowsAt($, 80)
  expect(rows[0]).toBe(HEAD)
  expect(rows.at(0)).not.toBe('')
  expect(rows.at(-1)).not.toBe('')
  expect(rows.join('\n')).not.toContain('\n\n\n')
  const groups = rows.join('\n').split('\n\n')
  expect(groups.map(group => group.split('\n')[0])).toEqual([
    HEAD,
    'Intent  intent.md  -        0 tokens',
    '► Tests: -',
    'Changed Files: 2, +5 -1',
    '► Suggested Rules (1)',
    'Guard level: strict',
    'Denials: 1',
    '► Help (3)',
  ])
  expect(groups[0]).toBe(HEAD)
  // The PR's link sits right under the PR row, in the file column.
  expect(groups[1]?.split('\n')).toEqual([
    'Intent  intent.md  -        0 tokens',
    'Spec    spec.md    done     0 tokens',
    'Plan    plan.md    -        0 tokens',
    'Build   build.md   running  0 tokens',
    'Test    test.md    -        0 tokens',
    'PR      pr.md      -        0 tokens',
    '        PR #485',
  ])
  expect(groups[2]?.split('\n')).toEqual(['► Tests: -'])
})

test('the pane has a blank line under its header and none at the bottom when no group follows the phase table', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), state: 'finished' }) })
  await begin($)
  const rows = await paneRowsAt($, 60)
  expect(rows).toEqual([
    HEAD,
    '',
    'Intent  intent.md  -        0 tokens',
    'Spec    spec.md    -        0 tokens',
    'Plan    plan.md    -        0 tokens',
    'Build   build.md   -        0 tokens',
    'Test    test.md    -        0 tokens',
    'PR      pr.md      -        0 tokens',
  ])
})

test('the pane keeps the urgent line first under the header when inline, with the blank lines as before', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'the acceptance tests changed since Plan approval', ...LOCK }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
  })
  await begin($)
  const rows = await paneRowsAt($, 80, 'inline')
  expect(rows.slice(0, 4)).toEqual([HEAD, 'Blocked: the acceptance tests changed since Plan approval', '', 'Intent  intent.md  -        0 tokens'])
  const groups = rows.join('\n').split('\n\n')
  // Denials come last but for Help.
  expect(groups.at(-2)?.split('\n')[0]).toBe('Denials: 0')
  expect(groups.at(-1)?.split('\n')[0]).toMatch(/^[▼►] Help \(3\)$/)
})

test('the pane wraps a long blocker line at 40 columns, keeps its color, and indents the continuation by two spaces', async ($, on) => {
  world(on, {
    run: runAt({
      phase: phaseAt('Build'),
      state: 'blocked',
      reason: GIT_SETTINGS_CHANGED,
      ...LOCK,
      deniedCount: 2,
      denials: [{ phase: 'Build', key: 'ci' }],
    }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
  })
  await begin($)
  const rows = await paneRowsAt($, 40)
  expect(rows).toEqual([
    HEAD,
    '',
    'Intent  intent.md  -        0 tokens',
    'Spec    spec.md    done     0 tokens',
    'Plan    plan.md    -        0 tokens',
    'Build   build.md   blocked  0 tokens',
    'Test    test.md    -        0 tokens',
    'PR      pr.md      -        0 tokens',
    '',
    'Blocked: goal-and-do blocks the run:',
    "  Git's config, hooks or attributes",
    '  changed since the run started.',
    '',
    '► Tests: -',
    '',
    'Guard level: strict',
    '',
    '▼ Denials (2)',
    'Build: goal-and-do blocks edits to CI',
    '  files (.github/workflows/,',
    '  Jenkinsfile*).',
    '',
    '▼ Help (3)',
    'Stuck: type /goal-and-do next alone,',
    '  with no more words. Esc interrupts a',
    '  running goal.',
    'Get out: /goal-and-do stop ends the run',
    "  for good. A stopped run can't be",
    '  resumed.',
    'Start over: git reset --',
    '  changes/ABC-43224, git switch main, rm',
    '  -r changes/ABC-43224, git branch -D',
    '  sdd/ABC-43224, then start again from',
    '  the same request.',
  ])
  const ui = await paneAt($, 40)
  const blocked = (await ui.findAll({ type: 'Text' })).filter(found => /^(Blocked:|  Git's|  changed since)/.test(found.text))
  expect(blocked.map(found => found.props.color)).toEqual(['error', 'error', 'error'])
  await ui.unmount()
  for (const row of rows) expect(Array.from(row).length).toBeLessThanOrEqual(40)
})

test('the pane wraps every long section line, and a word wider than the pane is split', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    turn: { startedAt: NOW - 12 * 60_000, calls: 4 },
    footprint: { ...RICH_FOOTPRINT, lines: [{ text: 'Changed Files: 2 files changed, 5 added and 1 removed' }, { text: `  ${'d'.repeat(30)}/file.ts` }] },
  })
  await begin($)
  for (const columns of [20, 25, 30, 40]) {
    const rows = await paneRowsAt($, columns)
    // After the blank lines under the header and under the phase table.
    const tail = rows.slice(rows.indexOf('', rows.indexOf('') + 1))
    for (const row of tail) expect(Array.from(row).length, row).toBeLessThanOrEqual(columns)
    const text = tail.join(' ').replace(/ +/g, ' ')
    expect(text).toContain('5 added and 1 removed')
    expect(text.replace(/ /g, '')).toContain(`${'d'.repeat(30)}/file.ts`)
    for (const row of tail.filter(one => one.startsWith('  '))) expect(row.trim()).not.toBe('')
  }
})

// Open dialogs

// The open dialogs the atom holds; a /clear leaves it empty, which counts as 0.
const openDialogs = (w: { atom: (key: string) => unknown }): number => Number(w.atom('dialogs') ?? 0)

const PLAN_GATE: Setup = {
  run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
  files: { [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
}

test('dialogs: a dialog of the mod counts 1 while it is open, and 0 after the answer', async ($, on) => {
  const seen: number[] = []
  const w = world(on, { ...PLAN_GATE, answers: ['Approve, start Build'], beforeAnswer: () => seen.push(openDialogs(w)) })
  await begin($)
  expect(openDialogs(w)).toBe(0)
  await command($, 'next')
  await w.asked(1)
  await w.clock.settle()
  expect(seen).toEqual([1])
  expect(openDialogs(w)).toBe(0)
})

test('dialogs: a dialog that is dismissed counts back to 0', async ($, on) => {
  const seen: number[] = []
  const w = world(on, { ...PLAN_GATE, answers: [undefined], beforeAnswer: () => seen.push(openDialogs(w)) })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  await w.clock.settle()
  expect(seen).toEqual([1])
  expect(openDialogs(w)).toBe(0)
})

test('dialogs: the blocked-Intent dialog counts too', async ($, on) => {
  const seen: number[] = []
  const w = world(on, { ...blockedIntent(['Stop this run']), beforeAnswer: () => seen.push(openDialogs(w)) })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(seen).toEqual([1])
  expect(openDialogs(w)).toBe(0)
})

test('dialogs: an AskUserQuestion call of Claude counts 1 while it is open, and its result reaches Claude unchanged', async ($, on) => {
  const seen: number[] = []
  const w = world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
    answers: ['Yes'],
    beforeAnswer: () => seen.push(openDialogs(w)),
  })
  await begin($)
  const call = askQuestion('Which formats?')
  const r = await $.tool.call(call)
  expect(seen).toEqual([1])
  expect(openDialogs(w)).toBe(0)
  expect(r).toEqual({ result: { questions: call.questions, answers: { 'Which formats?': 'Yes' } } })
})

test('dialogs: an AskUserQuestion call that the engine refuses counts back to 0 and keeps its refusal', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }), answers: [undefined] })
  await begin($)
  const r = await $.tool.call(askQuestion('Which formats?'))
  expect(r).toEqual({ deny: 'dismissed' })
  expect(openDialogs(w)).toBe(0)
})

test('dialogs: an AskUserQuestion call that throws counts back to 0 and the error goes on', async ($, on) => {
  const seen: number[] = []
  const w = world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
    askThrows: ['Which formats?'],
    beforeAnswer: () => seen.push(openDialogs(w)),
  })
  await begin($)
  await expect($.tool.call(askQuestion('Which formats?'))).rejects.toThrow()
  expect(seen).toEqual([1])
  expect(openDialogs(w)).toBe(0)
})

test('dialogs: two calls open at once count 2, and each closing takes one away', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const w = world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }), answers: ['Yes', 'Yes'], hold: held })
  await begin($)
  const calls = Promise.all([$.tool.call(askQuestion('Which formats?')), $.tool.call(askQuestion('How often?'))])
  await w.asked(2)
  expect(openDialogs(w)).toBe(2)
  release()
  await calls
  expect(openDialogs(w)).toBe(0)
})

test('dialogs: the count never goes below 0, also when /clear wipes the atom while a dialog is open', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
    answers: ['Yes'],
    beforeAnswer: () => {
      w.wipe()
    },
  })
  await begin($)
  await $.tool.call(askQuestion('Which formats?'))
  expect(openDialogs(w)).toBe(0)
})

test('dialogs: the count is in memory only, never in run.json', async ($, on) => {
  const w = world(on, { ...PLAN_GATE, answers: ['Approve, start Build'] })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  await w.clock.settle()
  expect(JSON.stringify(w.json())).not.toContain('dialogs')
})

// The pane shows the band while a dialog hides it

const BAND_RUN = () => runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK })
const BAND_TURN = { startedAt: NOW - 12 * 60_000, calls: 4 }

test('the pane shows the band right under its header while a dialog is open, without the phase chain, with a blank line after it, at 60 columns', async ($, on) => {
  world(on, { run: BAND_RUN(), turn: BAND_TURN, dialogs: 1 })
  await begin($)
  const rows = await paneRowsAt($, 60)
  expect(rows.slice(0, 4)).toEqual([HEAD, 'turn 1/40 · 12 min · 4 calls · working', '', 'Intent  intent.md  -        0 tokens'])
  expect(rows.join('\n')).not.toContain('INTENT')
  for (const row of rows) expect(Array.from(row).length).toBeLessThanOrEqual(60)
})

test('the pane shows the band with the turn, the minutes, the calls and the PR number', async ($, on) => {
  world(on, { run: { ...BAND_RUN(), prUrl: 'https://github.example.com/o/r/pull/485' }, turn: BAND_TURN, dialogs: 1 })
  await begin($)
  const rows = await paneRowsAt($, 100)
  expect(rows.slice(0, 3)).toEqual([HEAD, 'turn 1/40 · 12 min · 4 calls · working · PR #485', ''])
})

test('the pane wraps the band at 30 columns, and no row is wider', async ($, on) => {
  world(on, { run: BAND_RUN(), turn: BAND_TURN, dialogs: 2 })
  await begin($)
  const rows = await paneRowsAt($, 30)
  expect(rows.slice(0, 4)).toEqual([HEAD, 'turn 1/40 · 12 min · 4 calls ·', '  working', ''])
  for (const row of rows.slice(0, 4)) expect(Array.from(row).length).toBeLessThanOrEqual(30)
})

for (const columns of [20, 30]) {
  test(`the pane keeps every word of the band at ${columns} columns, splits none, and keeps the colors`, async ($, on) => {
    world(on, { run: BAND_RUN(), turn: BAND_TURN, dialogs: 1 })
    await begin($)
    const ui = await paneAt($, columns)
    const rows = afterHint(rowsOf(await ui.drawn()))
    const end = rows.indexOf('')
    const band = rows.slice(1, end)
    for (const row of band) expect(Array.from(row).length, row).toBeLessThanOrEqual(columns)
    // Every word of the band's tail is there, whole.
    const words = band
      .join(' ')
      .split(/\s+/)
      .filter(word => word !== '')
    expect(words).toEqual(['turn', '1/40', '·', '12', 'min', '·', '4', 'calls', '·', 'working'])
    // The rows after the first start with the two-space indent.
    for (const row of band.slice(1)) expect(row.startsWith('  ')).toBe(true)
    const drawn = await ui.findAll({ type: 'Text' })
    const isDrawn = (word: string, props: Record<string, unknown>) =>
      drawn.some(found => found.text.includes(word) && Object.entries(props).every(([key, value]) => found.props[key] === value))
    expect(isDrawn('working', { color: 'suggestion' })).toBe(true)
    expect(drawn.some(found => found.text.includes('min') && found.props.color === 'subtle')).toBe(true)
    expect(drawn.some(found => found.text.includes('calls') && found.props.color === 'subtle')).toBe(true)
    await ui.unmount()
  })
}

test("the pane draws the band's tail in the band's colors", async ($, on) => {
  world(on, { run: BAND_RUN(), turn: BAND_TURN, dialogs: 1 })
  await begin($)
  const ui = await paneAt($, 100)
  const texts = await ui.findAll({ type: 'Text' })
  const at = (text: string) => texts.find(found => found.text === text)?.props
  expect(at('turn 1/40')).toMatchObject({ color: 'subtle' })
  expect(at('12 min')).toMatchObject({ color: 'subtle' })
  expect(at('4 calls')).toMatchObject({ color: 'subtle' })
  expect(at(' · ')).toMatchObject({ color: 'subtle' })
  expect(at('working')).toMatchObject({ color: 'suggestion' })
  expect(at('● BUILD')).toBeUndefined()
  await ui.unmount()
})

test('the pane shows the band of a run at a gate, with the state the band gives', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Plan'), state: 'gate' }), dialogs: 1 })
  await begin($)
  const rows = await paneRowsAt($, 100)
  expect(rows.slice(0, 4)).toEqual([HEAD, 'waiting: approve Plan with /goal-and-do next', '', 'Intent  intent.md  -           0 tokens'])
})

for (const dialogs of [undefined, 0]) {
  test(`the pane shows no band while the count is ${dialogs ?? 'not set'}`, async ($, on) => {
    world(on, { run: BAND_RUN(), turn: BAND_TURN, ...(dialogs === undefined ? {} : { dialogs }) })
    await begin($)
    const rows = await paneRowsAt($, 60)
    expect(rows.slice(0, 3)).toEqual([HEAD, '', 'Intent  intent.md  -        0 tokens'])
    expect(rows.join('\n')).not.toContain('INTENT')
  })
}

for (const state of ['finished', 'stopped'] as const) {
  test(`the pane shows no band for a ${state} run, even with a dialog open`, async ($, on) => {
    world(on, { run: runAt({ phase: phaseAt('Build'), state }), dialogs: 1 })
    await begin($)
    expect((await paneRowsAt($, 60)).join('\n')).not.toContain('INTENT')
  })
}

test('the pane shows no band when no run exists, even with a dialog open', async ($, on) => {
  world(on, { dialogs: 1 })
  await begin($)
  expect(await paneRowsAt($, 60)).toEqual([TEXTS.noRun])
})

test('the pane shows the band while the dialog is open and takes it away when the dialog closes', async ($, on) => {
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const w = world(on, { ...PLAN_GATE, answers: ['Approve, start Build'], hold: held })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  const open = await paneRowsAt($, 100)
  expect(open[1]).toBe('waiting: approve Plan with /goal-and-do next')
  release()
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect((await paneRowsAt($, 100)).join('\n')).not.toContain('waiting: approve')
})

// The Blockers section's denial lines

const NARROW_COLUMNS = [40, 60, 80]

for (const state of ['running', 'gate'] as const) {
  test(`denials: an Intent denial shows its fixed text in the ${state} state at every width, wrapped`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Intent'), state, goalActive: state === 'running' }) })
    await begin($)
    expect((await $.tool.call({ tool: 'Bash', command: 'npm test' })).deny).toBe(REASONS.intentShell)
    await w.clock.settle()
    for (const columns of NARROW_COLUMNS) {
      const rows = await paneRowsAt($, columns)
      for (const row of rows) expect(Array.from(row).length, row).toBeLessThanOrEqual(columns)
      const text = rows.join(' ').replace(/ +/g, ' ')
      expect(text, `${columns} columns`).toContain(`Intent: ${REASONS.intentShell}`)
      expect(rows).toContain('▼ Denials (1)')
      expect(rows.indexOf('▼ Denials (1)')).toBeLessThan(rows.findIndex(row => row.startsWith('Intent: goal-and-do')))
    }
  })

  test(`denials: a Build denial shows its fixed text in the ${state} state at every width, wrapped`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Build'), state, goalActive: state === 'running', ...LOCK }) })
    await begin($)
    expect((await $.tool.call({ tool: 'Write', file_path: '/repo/.github/workflows/ci.yml', content: 'x' })).deny).toBe(CI_TEXT)
    await w.clock.settle()
    for (const columns of NARROW_COLUMNS) {
      const rows = await paneRowsAt($, columns)
      for (const row of rows) expect(Array.from(row).length, row).toBeLessThanOrEqual(columns)
      expect(rows.join(' ').replace(/ +/g, ' '), `${columns} columns`).toContain(`Build: ${CI_TEXT}`)
      expect(rows).toContain('▼ Denials (1)')
    }
  })

  test(`denials: four denials in a row in the ${state} state show the last three under a count of 4`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Build'), state, goalActive: state === 'running', ...LOCK }) })
    await begin($)
    await $.tool.call({ tool: 'Write', file_path: '/repo/.github/workflows/ci.yml', content: 'x' })
    await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
    await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })
    await $.tool.call({ tool: 'Bash', command: 'git config core.hooksPath x' })
    await w.clock.settle()
    for (const columns of NARROW_COLUMNS) {
      const rows = await paneRowsAt($, columns)
      for (const row of rows) expect(Array.from(row).length, row).toBeLessThanOrEqual(columns)
      const text = rows.join(' ').replace(/ +/g, ' ')
      expect(text, `${columns} columns`).not.toContain(CI_TEXT)
      expect(text).toContain('Build: goal-and-do allows git push only in the PR phase.')
      expect(text).toContain(`Build: ${REASONS.pullRequest}`)
      expect(text).toContain(`Build: ${GIT_CONFIG_TEXT}`)
      expect(rows).toContain('▼ Denials (4)')
    }
  })
}

test('denials: inline, the last denial goes first under the header and the other stays in Blockers', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })
  await w.clock.settle()
  const rows = await paneRowsAt($, 40, 'inline')
  expect(rows[0]).toBe(HEAD)
  expect(rows[1]).toBe('Build: goal-and-do blocks gh pr merge,')
  const text = rows.join(' ').replace(/ +/g, ' ')
  expect(text).toContain(`Build: ${REASONS.pullRequest}`)
  expect(text).toContain('Build: goal-and-do allows git push only in the PR phase.')
  expect(text.split('Build: goal-and-do allows git push').length).toBe(2)
  expect(rows).toContain('▼ Denials (2)')
})

test('denials: a pane too narrow to hold a wrapped line drops the denial lines and keeps the count', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'git push origin main' })
  await w.clock.settle()
  const wide = await paneRowsAt($, 20)
  expect(wide).toContain('Build: goal-and-do')
  // Under 20 columns the count stands alone, with no header that would show open with nothing under it.
  const narrow = await paneRowsAt($, 19)
  expect(narrow).not.toContain('Build:')
  expect(narrow).toContain('Denials: 1')
  expect(narrow.join('\n')).not.toContain('▼')
})

// The current row is bold

// Every Text under a node, with its weight.
function textsUnder(node: unknown): { text: string; weight?: unknown; color?: unknown }[] {
  if (typeof node === 'string') return []
  const drawn = node as Drawn
  const own = drawn.type === 'Text' ? [{ text: inlineText(node), weight: drawn.props?.weight, color: drawn.props?.color }] : []
  return [...own, ...(drawn.children ?? []).flatMap(textsUnder)]
}

function findKey(node: unknown, key: string): unknown {
  if (typeof node === 'string') return undefined
  const drawn = node as Drawn
  if (drawn.props?.key === key) return drawn
  for (const child of drawn.children ?? []) {
    const found = findKey(child, key)
    if (found !== undefined) return found
  }
  return undefined
}

// The weights of the Texts of each phase row, by phase.
async function rowWeights($: $T, columns = 100): Promise<Record<string, unknown[]>> {
  const ui = await paneAt($, columns)
  const tree = await ui.drawn()
  await ui.unmount()
  return Object.fromEntries(
    PHASES.map(phase => [
      phase,
      textsUnder(findKey(tree, `row-${phase}`))
        .filter(one => one.text.trim() !== '')
        .map(one => one.weight),
    ])
  )
}

for (const state of ['running', 'gate', 'blocked', 'capped', 'interrupted'] as const) {
  test(`the pane draws the current row bold while the run is ${state}, and no other row`, async ($, on) => {
    world(on, {
      run: runAt({ phase: phaseAt('Build'), state, reason: 'x', turns: state === 'capped' ? TURN_CAPS.Build : 0, ...LOCK }),
      files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Build')]: draft('build') },
    })
    await begin($)
    const weights = await rowWeights($)
    // The phase, the file and the status carry the weight; the tokens do not.
    expect(weights.Build).toEqual(['bold', 'bold', 'bold', undefined])
    for (const phase of PHASES.filter(one => one !== 'Build')) {
      expect(
        weights[phase]?.every(weight => weight === undefined),
        phase
      ).toBe(true)
    }
  })
}

test('the pane keeps the status color on the bold row', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', ...LOCK }), files: { [phaseFile('Build')]: draft('build') } })
  await begin($)
  const ui = await paneAt($, 100)
  const status = (await ui.findAll({ type: 'Text' })).find(found => found.text.trim() === 'blocked' && found.props.weight === 'bold')
  expect(status?.props).toMatchObject({ color: 'error', weight: 'bold' })
  await ui.unmount()
})

test('the pane draws the file button of the current row bold, and the file button of another row plain', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Build')]: draft('build') },
  })
  await begin($)
  const ui = await paneAt($, 100)
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.find(found => found.text === 'build.md')?.props).toMatchObject({ weight: 'bold' })
  expect(texts.find(found => found.text === 'spec.md')?.props.weight).toBeUndefined()
  expect((await ui.find({ type: 'Button', key: 'open-Build' }))?.text).toBe('build.md')
  await ui.unmount()
})

for (const state of ['finished', 'stopped'] as const) {
  test(`the pane draws no bold row for a ${state} run`, async ($, on) => {
    world(on, { run: runAt({ phase: phaseAt('Build'), state, ...LOCK }), files: { [phaseFile('Build')]: draft('build') } })
    await begin($)
    const weights = await rowWeights($)
    for (const phase of PHASES)
      expect(
        weights[phase]?.every(weight => weight === undefined),
        phase
      ).toBe(true)
  })
}

// The blank line under the header

for (const [name, setup] of [
  ['without a band', { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) }],
  ['with the band', { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), dialogs: 1 }],
  ['of a finished run', { run: runAt({ phase: phaseAt('PR'), state: 'finished' }) }],
] as const) {
  test(`the pane puts a blank line between its header and the phase table, ${name}`, async ($, on) => {
    world(on, setup)
    await begin($)
    const rows = await paneRowsAt($, 100)
    const intent = rows.findIndex(row => row.startsWith('Intent '))
    expect(rows[0]).toBe(HEAD)
    expect(rows[intent - 1]).toBe('')
    expect(rows[intent - 2]).not.toBe('')
  })
}

// The pane as a whole

test('the pane at a gate with a dialog open and one denial, at 38 columns', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'gate', ...LOCK }),
    files: { [phaseFile('Spec')]: SPEC_DONE },
    dialogs: 1,
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })
  await w.clock.settle()
  // The tokens go: with "to approve" the rows would be wider than the pane.
  expect(await paneRowsAt($, 38)).toEqual([
    HEAD,
    'waiting: approve Build with',
    '  /goal-and-do next',
    '',
    'Intent  intent.md  -',
    'Spec    spec.md    done',
    'Plan    plan.md    -',
    'Build   build.md   to approve',
    'Test    test.md    -',
    'PR      pr.md      -',
    '',
    '► Tests: -',
    '',
    'Guard level: strict',
    '',
    '▼ Denials (1)',
    'Build: goal-and-do blocks gh pr merge,',
    '  gh pr ready and gh pr review. A',
    '  person decides on the pull request.',
    '',
    '► Help (3)',
  ])
})

// The open-point count of a row: undecided against all

const specWithPoints = (decided: number, total: number) =>
  [
    '---',
    'phase: spec',
    'status: draft',
    '---',
    '',
    '## Open points',
    '',
    ...Array.from({ length: total }, (_, i) => (i < decided ? [`- Point ${i + 1}?`, '  Decided: yes'] : [`- Point ${i + 1}?`])).flat(),
    '',
  ].join('\n')

for (const [decided, total, shown] of [
  [0, 7, '7/7 open'],
  [2, 7, '5/7 open'],
  [6, 7, '1/7 open'],
  [7, 7, ''],
  [0, 0, ''],
] as const) {
  test(`open counts: ${decided} decided of ${total} shows ${shown === '' ? 'no count' : shown}`, async ($, on) => {
    world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }), files: { [phaseFile('Spec')]: specWithPoints(decided, total) } })
    await begin($)
    const rows = await paneRowTexts($, 'terminal', 120)
    const row = rows[phaseAt('Spec')] ?? ''
    if (shown === '') expect(row).not.toMatch(/open/)
    else expect(row.endsWith(`  ${shown}`)).toBe(true)
  })
}

test('open counts: the count is the last thing the width rule drops, and the row never gets wider than the pane', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }), files: { [phaseFile('Spec')]: specWithPoints(2, 7) } })
  await begin($)
  expect((await paneRowTexts($, 'terminal', 120))[phaseAt('Spec')]).toBe('Spec    spec.md    running  0 tokens  5/7 open')
  const narrow = await paneRowTexts($, 'terminal', 30)
  expect(narrow[phaseAt('Spec')]).toBe('Spec    spec.md    running')
  for (let columns = 24; columns <= 120; columns++) {
    const row = (await paneRowTexts($, 'terminal', columns))[phaseAt('Spec')] ?? ''
    if (row.includes('open')) expect(Array.from(row).length, `${columns} columns`).toBeLessThanOrEqual(columns)
  }
})

// The goal turn's calls in the band

test('the band shows the calls of the goal turn the pane counts: turn 1/10 · 0 min · 10 calls · working', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }), turn: { startedAt: NOW, calls: 10 } })
  await begin($)
  for (const surface of SURFACES) {
    expect((await band($, surface, 124)).join('')).toBe('● INTENT  SPEC  PLAN  BUILD  TEST  PR    turn 1/10 · 0 min · 10 calls · working')
  }
  // The pane has no turn line.
  expect(barRows(await paneRowsAt($, 120))).toEqual([])
  expect((await paneRowsAt($, 120)).join('\n')).not.toContain('10 calls')
})

test('the band counts each tool call of the goal turn, and drops the calls first when one line has no room for them', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), turn: { startedAt: NOW, calls: 0 } })
  await begin($)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  const marks = '✔ INTENT  ✔ SPEC  ✔ PLAN  ● BUILD  TEST  PR'
  expect((await band($, 'terminal', 124)).join('')).toBe(`${marks}    turn 1/40 · 0 min · 2 calls · working`)
  // Where one line holds the minutes but not the calls, the calls go and the band stays on one line.
  const width = `${marks}    turn 1/40 · 0 min · working`.length
  expect((await band($, 'terminal', width + 4)).join('')).toBe(`${marks}    turn 1/40 · 0 min · working`)
})

// The gate opens again after a walk-through

// Lets the clock settle until the check holds: a dialog or a prompt the mod opens on its own appears after the waits its
// chain makes. Fails after 50 rounds.
// Settles the clock until the check holds, up to 500 rounds: on a busy CI runner the mod's file and state calls take
// longer, and 50 rounds ran out (PR 44, November 2, 2026). A check that already holds stops at once.
async function settleUntil(w: { clock: { settle: () => Promise<void> } }, check: () => boolean): Promise<void> {
  for (let round = 0; round < 500 && !check(); round++) await w.clock.settle()
  expect(check()).toBe(true)
}

// Lets the clock settle ten times, so a dialog the mod would open late has shown before a test says none did.
async function settleRounds(w: { clock: { settle: () => Promise<void> } }): Promise<void> {
  for (let round = 0; round < 10; round++) await w.clock.settle()
}

// The main-loop turn the walk prompt starts: it begins with the prompt's text.
async function walkStarts($: $T, w: { prompts: string[] }, turnId = 'walk-1') {
  await $.turn.start({ text: w.prompts.at(-1) ?? '', turnId })
}

async function walkEnds($: $T, turnId = 'walk-1', isAborted = false) {
  await $.turn.complete({ answer: 'Done.', durationMs: 1000, isAborted, turnId, reason: isAborted ? 'aborted' : 'answer' })
}

const SPEC_WALK: Setup = { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), files: { [phaseFile('Spec')]: SPEC_OPEN } }

test('walk-through: the gate opens again when the turn the walk prompt started ends', async ($, on) => {
  const w = world(on, { ...SPEC_WALK, answers: ['Walk through the 2 open points'] })
  await begin($)
  await command($, 'next')
  await settleUntil(w, () => w.prompts.length >= 1)
  expect(w.prompts).toHaveLength(1)
  await walkStarts($, w)
  await settleRounds(w)
  expect(w.asks).toHaveLength(1)
  await walkEnds($)
  await settleUntil(w, () => w.asks.length >= 2)
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]).toEqual(w.asks[0])
  expect(w.run()?.state).toBe('gate')
})

test('walk-through: the reopened Intent gate names the counts and the changed criteria, as before', async ($, on) => {
  const w = world(on, intentGate({ answers: ['Walk through the 2 open points', 'The broker team'] }))
  await begin($)
  await command($, 'next')
  await settleUntil(w, () => w.prompts.length >= 1)
  await walkStarts($, w)
  await $.tool.call(askQuestion('Who owns the export?'))
  w.files.set(phaseFile('Intent'), INTENT_OPEN.replace('- BAC-1:', '- BAC-2: Given a broker, when the export fails, then they see why.\n- BAC-1:'))
  await walkEnds($)
  await settleUntil(w, () => w.asks.length >= 3)
  expect(w.asks).toHaveLength(3)
  expect(w.asks[2]?.question).toBe(`${TEXTS.gateQuestion('Intent', ID, [], 2)} ${TEXTS.walkCounts(1, 0, 0)} ${TEXTS.criteriaSince(['BAC-2'], [])}`)
})

test('walk-through: the stuck dialog opens again when the walk turn ends', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: SPEC_OPEN.replace('phase: spec', 'phase: build').replace('status: done', 'status: blocked') },
    answers: ['Walk through the 2 open points'],
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.prompts).toEqual([`${TEXTS.walkPicked('Build', 'stuck')} ${TEXTS.walkPrompt(ID, 'build.md', '2026-10-29', 'stuck')}`])
  await walkStarts($, w)
  await walkEnds($)
  await settleUntil(w, () => w.asks.length >= 2)
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]).toEqual(w.asks[0])
})

test('walk-through: a prompt of the person in between keeps the gate closed, and next still opens it', async ($, on) => {
  const w = world(on, { ...SPEC_WALK, answers: ['Walk through the 2 open points'] })
  await begin($)
  await command($, 'next')
  await settleUntil(w, () => w.prompts.length >= 1)
  await walkStarts($, w)
  await $.prompt.submit({ text: 'Skip that, tell me about the export instead.', wait: false, origin: { kind: 'composer' } })
  await walkEnds($)
  await settleRounds(w)
  expect(w.asks).toHaveLength(1)
  await command($, 'next')
  await settleUntil(w, () => w.asks.length >= 2)
  expect(w.asks).toHaveLength(2)
})

test('walk-through: a run that left the gate opens nothing at the end of the walk turn', async ($, on) => {
  const w = world(on, { ...SPEC_WALK, answers: ['Walk through the 2 open points'] })
  await begin($)
  await command($, 'next')
  await settleUntil(w, () => w.prompts.length >= 1)
  await walkStarts($, w)
  await command($, 'stop')
  await walkEnds($)
  await settleRounds(w)
  expect(w.asks).toHaveLength(1)
  expect(w.run()?.state).toBe('stopped')
})

test('walk-through: a turn the walk did not start opens nothing, and nor does an interrupted walk turn', async ($, on) => {
  const w = world(on, { ...SPEC_WALK, answers: ['Walk through the 2 open points', 'Walk through the 2 open points'] })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  // A turn end before the walk turn started.
  await turnEnd($)
  await settleRounds(w)
  expect(w.asks).toHaveLength(1)
  await walkStarts($, w)
  await walkEnds($, 'another-turn')
  await settleRounds(w)
  expect(w.asks).toHaveLength(1)
  await walkEnds($)
  await settleUntil(w, () => w.asks.length >= 2)
  expect(w.asks).toHaveLength(2)
  // The second walk, interrupted.
  await settleUntil(w, () => w.prompts.length >= 2)
  await walkStarts($, w, 'walk-2')
  await walkEnds($, 'walk-2', true)
  await settleRounds(w)
  expect(w.asks).toHaveLength(2)
})

// The trace chain's IDs open their text

const TRACE_RICH = {
  run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
  files: {
    [phaseFile('Intent')]: traceIntent(2).replace(
      '- BAC-1: Given a clerk, when b, then c.',
      '- BAC-1: Given a clerk with a very long name, when they export, then the file holds every \u202epremium.'
    ),
    [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-1, BAC-2')]),
  },
}

// The rows of the trace chain section: its header and the lines under it.
async function traceRowsAt($: $T, columns: number): Promise<string[]> {
  const rows = await paneRowsAt($, columns)
  const at = rows.findIndex(row => /^[▼►] Requirements/.test(row))
  if (at < 0) return []
  const end = rows.indexOf('', at)
  return rows.slice(at, end < 0 ? undefined : end)
}

// Opens the Tests section when it is folded: its lines show only while it is open.
async function openTests($: $T) {
  if (!(await paneRowsAt($, 200)).some(row => row.startsWith('► Tests: '))) return
  const ui = await paneAt($, 200)
  await ui.press({ key: 'fold-tests' })
  await ui.unmount()
}

async function press($: $T, w: { clock: { settle: () => Promise<void> } }, key: string, columns = 80) {
  const ui = await paneAt($, columns)
  await ui.press({ key })
  await ui.unmount()
  await w.clock.settle()
}

test('trace: each BAC and AC ID is a button that opens its text under its line, indented and wrapped; a second press closes it', async ($, on) => {
  const w = world(on, TRACE_RICH)
  await begin($)
  await turnEnd($)
  await settleUntil(w, () => w.asks.length >= 1)
  await w.clock.settle()
  const ui = await paneAt($, 60)
  for (const key of ['trace-BAC-1-BAC-1', 'trace-BAC-1-AC-1', 'trace-BAC-1-AC-2', 'trace-BAC-2-BAC-2', 'trace-BAC-2-AC-2']) {
    const button = await ui.find({ type: 'Button', key })
    expect(button, key).toBeDefined()
    expect(button?.props).toMatchObject({ plain: true })
    expect(button?.props.hotkey).toBeUndefined()
  }
  await ui.unmount()
  await press($, w, 'trace-BAC-1-BAC-1')
  await press($, w, 'trace-BAC-1-AC-2')
  expect(await traceRowsAt($, 60)).toEqual([
    '▼ Requirements (2)',
    'BAC-1 → AC-1, AC-2',
    '    BAC-1: Given a clerk with a very long name, when they',
    '      export, then the file holds every premium.',
    '    AC-2: Given a',
    '    When b',
    '    Then c',
    'BAC-2 → AC-2',
  ])
  await press($, w, 'trace-BAC-1-BAC-1')
  expect(await traceRowsAt($, 60)).toEqual(['▼ Requirements (2)', 'BAC-1 → AC-1, AC-2', '    AC-2: Given a', '    When b', '    Then c', 'BAC-2 → AC-2'])
  for (const row of await traceRowsAt($, 30)) expect(Array.from(row).length, row).toBeLessThanOrEqual(30)
  expect(JSON.stringify(w.json())).not.toContain('AC-2')
})

test('trace: a criterion whose text is not found says so, and the texts come from the last read of the chain', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), goalActive: true }),
    files: { [phaseFile('Intent')]: traceIntent(1), [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-4')]) },
  })
  await begin($)
  await turnEnd($)
  await settleUntil(w, () => w.asks.length >= 1)
  await w.clock.settle()
  // An edit after the chain was read shows only at its next read.
  w.files.set(phaseFile('Intent'), traceIntent(1).replace('Given a clerk', 'Given a broker'))
  await press($, w, 'trace-BAC-4-BAC-4')
  await press($, w, 'trace-BAC-1-BAC-1')
  expect(await traceRowsAt($, 80)).toEqual([
    '▼ Requirements (2)',
    'BAC-1 → AC-1',
    '    BAC-1: Given a clerk, when b, then c.',
    'BAC-4 → not in intent.md',
    '    BAC-4: <text not found>',
  ])
})

// Holds each dialog's answer until release is called.
function holdDialogs(): { held: Promise<void>; release: () => void } {
  let release = () => {}
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  return { held, release }
}

test('trace: the opened criteria outlive the /clear of a phase change', async ($, on) => {
  const { held, release } = holdDialogs()
  const w = world(on, { ...TRACE_RICH, answers: ['Approve, start Plan'], hold: held })
  await begin($)
  await turnEnd($)
  await settleUntil(w, () => w.asks.length >= 1)
  await press($, w, 'trace-BAC-2-AC-2')
  release()
  await w.goal(goalFor('Plan', ID))
  await w.clock.settle()
  expect(w.commands).toContain('clear')
  expect((await traceRowsAt($, 80)).slice(-4)).toEqual(['BAC-2 → AC-2', '    AC-2: Given a', '    When b', '    Then c'])
})

// Foldable sections

const FOLD_FOOTPRINT = footprint('1\t0\tlib/a.ts\u00001\t0\tlib/b.ts\u00001\t0\tCLAUDE.md\u0000', '', { id: ID, plannedPaths: ['src'] })

const FOLD_SETUP = (): Setup => ({
  run: runAt({
    phase: phaseAt('Build'),
    goalActive: true,
    ...LOCK,
    suggested: ['Bash(npm test)'],
    denials: [{ phase: 'Build', key: 'ci' }],
    deniedCount: 1,
  }),
  files: { [phaseFile('Intent')]: traceIntent(2), [phaseFile('Spec')]: traceSpec([acBlock(1, 'BAC-1'), acBlock(2, 'BAC-2')]) },
  trace: [
    { id: 'BAC-1', kind: 'acs', acs: [{ id: 'AC-1' }] },
    { id: 'BAC-2', kind: 'acs', acs: [{ id: 'AC-2' }] },
  ],
  footprint: FOLD_FOOTPRINT,
})

test('folds: each section starts as set, its header shows its count, and the counts of the folded lists show', async ($, on) => {
  world(on, FOLD_SETUP())
  await begin($)
  const rows = await paneRowsAt($, 100)
  const text = rows.join('\n')
  for (const head of ['► Suggested Rules (1)', '► Outside the Plan (3)', '► Sensitive Files (1)', '▼ Requirements (2)', '▼ Denials (1)']) {
    expect(rows, head).toContain(head)
  }
  expect(text).toContain('BAC-1 → AC-1')
  expect(text).toContain('Build: goal-and-do blocks edits to CI files')
  expect(text).not.toContain('Bash(npm test)')
  expect(text).not.toContain('  lib/a.ts')
  expect(text).not.toContain('  CLAUDE.md')
  // The phase table has no header, the Tests section folds, and the pane has no turn line.
  expect(text).not.toContain('Click a file name to open it.')
  expect(barRows(rows)).toEqual([])
  expect(rows).toContain('► Tests: -')
  expect(rows.filter(row => /^[▼►] /.test(row))).toHaveLength(8)
})

test('folds: a press on a header folds or opens its section, as a file button does, and two presses before a redraw undo each other', async ($, on) => {
  const w = world(on, FOLD_SETUP())
  await begin($)
  const ui = await paneAt($, 100)
  for (const key of ['fold-suggested', 'fold-outside', 'fold-sensitive', 'fold-trace', 'fold-denials']) {
    const button = await ui.find({ type: 'Button', key })
    expect(button, key).toBeDefined()
    expect(button?.props).toMatchObject({ plain: true })
    expect(button?.props.hotkey).toBeUndefined()
  }
  await ui.unmount()
  for (const key of ['fold-suggested', 'fold-outside', 'fold-sensitive', 'fold-trace', 'fold-denials']) await press($, w, key, 100)
  const rows = await paneRowsAt($, 100)
  const text = rows.join('\n')
  for (const head of ['▼ Suggested Rules (1)', '▼ Outside the Plan (3)', '▼ Sensitive Files (1)', '► Requirements (2)', '► Denials (1)']) {
    expect(rows, head).toContain(head)
  }
  expect(text).toContain('npm test: Runs a project command (tests, build or a script); it can change files.')
  expect(text).toContain('  lib/a.ts')
  expect(text).toContain('  CLAUDE.md')
  expect(text).not.toContain('BAC-1 → AC-1')
  expect(text).not.toContain('Build: goal-and-do blocks edits to CI files')
  // Two presses on one drawing: the second reads the state the first left.
  const twice = await paneAt($, 100)
  await twice.press({ key: 'fold-denials' })
  await twice.press({ key: 'fold-denials' })
  await twice.unmount()
  await w.clock.settle()
  expect(await paneRowsAt($, 100)).toContain('► Denials (1)')
  await press($, w, 'fold-denials', 100)
  expect(await paneRowsAt($, 100)).toContain('▼ Denials (1)')
})

test('folds: the choice outlives the /clear of a phase change and never goes into run.json', async ($, on) => {
  const { held, release } = holdDialogs()
  const w = world(on, {
    ...PLAN_GATE,
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', suggested: ['Bash(npm test)'] }),
    answers: ['Approve, start Build'],
    hold: held,
  })
  await begin($)
  await command($, 'next')
  await settleUntil(w, () => w.asks.length >= 1)
  await press($, w, 'fold-suggested', 100)
  expect(await paneRowsAt($, 100)).toContain('▼ Suggested Rules (1)')
  release()
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect(w.commands).toContain('clear')
  const rows = await paneRowsAt($, 100)
  expect(rows).toContain('▼ Suggested Rules (1)')
  expect(rows.join('\n')).toContain('npm test: Runs a project command (tests, build or a script); it can change files.')
  expect(JSON.stringify(w.json())).not.toMatch(/folds|"recent"|opened/)
})

// The walk's own turn, recent files outside the project and beside the call, narrow rows, and one call

test('walk-through: a turn of a task notification before the walk turn opens nothing, and the walk turn still reopens', async ($, on) => {
  const w = world(on, { ...SPEC_WALK, answers: ['Walk through the 2 open points'] })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  await $.turn.start({ text: '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>', turnId: 'note-1' })
  await walkEnds($, 'note-1')
  await settleRounds(w)
  expect(w.asks).toHaveLength(1)
  await walkStarts($, w)
  await walkEnds($)
  await settleUntil(w, () => w.asks.length >= 2)
  expect(w.asks).toHaveLength(2)
})

for (const [name, setup] of [
  ['dropped', { promptDropped: true }],
  ['refused', { promptRefused: true }],
] as const) {
  test(`walk-through: a ${name} walk prompt toasts, gives the prompt to paste, and opens nothing at a later turn`, async ($, on) => {
    const w = world(on, { ...SPEC_WALK, ...setup, answers: ['Walk through the 2 open points'] })
    await begin($)
    await command($, 'next')
    await settleUntil(w, () => w.toasts.length >= 1)
    expect(w.toasts).toHaveLength(1)
    expect(w.logs).toEqual([TEXTS.walkPrompt(ID, 'spec.md', '2026-10-29')])
    const sent = `${TEXTS.walkPicked('Spec', 'gate')} ${TEXTS.walkPrompt(ID, 'spec.md', '2026-10-29')}`
    await $.turn.start({ text: sent, turnId: 'later' })
    await walkEnds($, 'later')
    await settleRounds(w)
    expect(w.asks).toHaveLength(1)
  })
}

test('walk-through: the reopened gate waits for the rule dialog to close, so the two never show together', async ($, on) => {
  const { held, release } = holdDialogs()
  const w = world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'gate', suggested: ['Bash(npm test)'], offered: [] }),
    files: { [phaseFile('Spec')]: SPEC_OPEN },
    answers: ['Walk through the 2 open points', 'Not now'],
    holdAsk: ask => (ask.header === 'Rules' ? held : undefined),
  })
  await begin($)
  await command($, 'next')
  await settleUntil(w, () => w.prompts.length >= 1)
  await walkStarts($, w)
  await walkEnds($)
  await settleUntil(w, () => w.asks.length >= 2)
  // While the rule dialog stays open, the gate does not open, however long the clock runs.
  for (let i = 0; i < 5; i++) await w.clock.advance(1_000)
  expect(w.asks.map(ask => ask.header)).toEqual(['Gate', 'Rules'])
  expect(openDialogs(w)).toBe(1)
  release()
  await settleUntil(w, () => w.asks.length >= 3)
  expect(w.asks.map(ask => ask.header)).toEqual(['Gate', 'Rules', 'Gate'])
  expect(w.asks[2]).toEqual(w.asks[0])
})

test('opened criteria outlive a /clear the person types', async ($, on) => {
  const w = world(on, TRACE_RICH)
  await begin($)
  await turnEnd($)
  await settleUntil(w, () => w.asks.length >= 1)
  await w.clock.settle()
  await press($, w, 'trace-BAC-2-AC-2')
  w.wipe()
  expect((await traceRowsAt($, 80)).slice(-4)).toEqual(['BAC-2 → AC-2', '    AC-2: Given a', '    When b', '    Then c'])
})

for (const columns of [25, 28]) {
  test(`the gated row puts its status on a row of its own at ${columns} columns, and no row is wider`, async ($, on) => {
    world(on, {
      run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
      files: { [phaseFile('Intent')]: INTENT_DONE, [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE },
    })
    await begin($)
    const rows = await paneRowsAt($, columns)
    const plan = rows.indexOf('Plan    plan.md')
    expect(plan).toBeGreaterThan(0)
    expect(rows[plan + 1]).toBe('  to approve')
    for (const row of rows) expect(Array.from(row).length, row).toBeLessThanOrEqual(columns)
    const ui = await paneAt($, columns)
    expect((await ui.findAll({ type: 'Text' })).find(found => found.text === 'to approve')?.props).toMatchObject({ color: 'warning', weight: 'bold' })
    await ui.unmount()
  })
}

test('the band and the pane copy of the band say 1 call for one call', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), turn: { startedAt: NOW, calls: 1 }, dialogs: 1 })
  await begin($)
  expect((await band($, 'terminal', 124)).join('')).toContain('turn 1/40 · 0 min · 1 call · working')
  expect(await paneRowsAt($, 120)).toContain('turn 1/40 · 0 min · 1 call · working')
})

for (const [columns, status] of [
  [25, '  to approve  2/3 open'],
  [20, '  to approve'],
] as const) {
  test(`the split status row keeps the open count when it fits, at ${columns} columns`, async ($, on) => {
    world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), files: { [phaseFile('Spec')]: SPEC_OPEN } })
    await begin($)
    const rows = await paneRowsAt($, columns)
    const spec = rows.indexOf('Spec    spec.md')
    expect(rows[spec + 1]).toBe(status)
    const ui = await paneAt($, columns)
    const count = (await ui.findAll({ type: 'Text' })).find(found => found.text === '  2/3 open')
    if (columns === 25) expect(count?.props).toMatchObject({ color: 'warning' })
    else expect(count).toBeUndefined()
    await ui.unmount()
  })
}

// No turn line in the pane: the band shows the turns

test('the pane shows no turn line; the band has the turn, the minutes and the calls', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, turns: 1, ...LOCK }), turn: { startedAt: NOW - 60_000, calls: 6 } })
  await begin($)
  const rows = await paneRowsAt($, 63)
  expect(barRows(rows)).toEqual([])
  expect(rows.join('\n')).not.toMatch(/turn 2\/60|6 calls|1 min/)
  expect((await band($, 'terminal', 120)).join('')).toContain('turn 2/60 · 1 min · 6 calls · working')
})

test('while a dialog is open, the pane copy of the band has the numbers, and the pane has no turn line', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, turns: 1, ...LOCK }), turn: { startedAt: NOW - 60_000, calls: 6 }, dialogs: 1 })
  await begin($)
  for (const placement of ['dock', 'inline'] as const) {
    const rows = await paneRowsAt($, 63, placement)
    expect(
      rows.filter(row => row.includes('6 calls')),
      placement
    ).toEqual(['turn 2/60 · 1 min · 6 calls · working'])
    expect(barRows(rows), placement).toEqual([])
  }
})

test('inline, the pane has no turn line, and the band shows the numbers once', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }), turn: { startedAt: NOW - 12 * 60_000, calls: 4 } })
  await begin($)
  const rows = await paneRowsAt($, 80, 'inline')
  expect(barRows(rows)).toEqual([])
  expect(rows.join('\n')).not.toMatch(/4 calls|12 min|turn 1\/40/)
  expect((await band($, 'terminal', 124)).join('')).toContain('turn 1/40 · 12 min · 4 calls · working')
  // Docked, the pane has no turn line either.
  const docked = await paneRowsAt($, 80)
  expect(barRows(docked)).toEqual([])
  expect(docked.join('\n')).not.toContain('4 calls')
})

// A running goal's row reads running

test("a running goal's row reads running in bold, though its file already says done; then to approve, then done", async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Intent'), goalActive: true }),
    files: { [phaseFile('Intent')]: INTENT_DONE },
    answers: [undefined],
  })
  await begin($)
  expect((await paneRowTexts($, 'terminal', 100))[0]).toBe('Intent  intent.md  running  0 tokens')
  // The phase, the file and the status are bold; the tokens are not.
  expect((await rowWeights($)).Intent).toEqual(['bold', 'bold', 'bold', undefined])
  // The goal ends: at the gate the row is to approve.
  await turnEnd($)
  await w.clock.settle()
  expect(w.run()?.state).toBe('gate')
  expect((await paneRowTexts($, 'terminal', 100))[0]).toBe('Intent  intent.md  to approve  0 tokens')
})

test('a phase whose goal is not set yet reads its file as before', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: false, pendingGoal: true }), files: { [phaseFile('Spec')]: SPEC_DONE } })
  await begin($)
  expect((await paneRowTexts($, 'terminal', 100))[phaseAt('Spec')]).toBe('Spec    spec.md    done     0 tokens')
})

// The band at a goal's start, drawn by the render hook

test('the band at a goal start shows the calls of the goal turn, and draws again with every call', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }), turn: { startedAt: NOW, calls: 5 } })
  await begin($)
  // 120 columns: room for the calls on one line.
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  const text = async () => (await ui.findAll({ type: 'Text' })).map(found => found.text).join('')
  expect(await text()).toContain('turn 1/15 · 0 min · 5 calls · working')
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' })
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/b.ts' })
  await w.clock.settle()
  // The engine draws the band again on a write of the turn atom it read; the kit does it on redraw.
  await ui.redraw()
  expect(await text()).toContain('turn 1/15 · 0 min · 7 calls · working')
  expect(barRows(await paneRowsAt($, 63))).toEqual([])
  await ui.unmount()
})

test('the band at the start of a goal shows 0 calls, and its first call makes it 1 call', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Intent'), pendingGoal: true }) })
  await begin($)
  await turnEnd($)
  await w.goal(goalFor('Intent', ID))
  await w.clock.settle()
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 120, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  })
  const text = async () => (await ui.findAll({ type: 'Text' })).map(found => found.text).join('')
  expect(await text()).toContain('turn 1/10 · 0 min · 0 calls · working')
  await $.tool.call({ tool: 'Read', file_path: `/repo/changes/${ID}/request.md` })
  await w.clock.settle()
  await ui.redraw()
  expect(await text()).toContain('turn 1/10 · 0 min · 1 call · working')
  await ui.unmount()
})

test('the status command shows the band with two spaces between the phases and four before the turn', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Plan'), goalActive: true }), turn: { startedAt: NOW, calls: 3 } })
  await begin($)
  expect(await command($, 'status')).toContain(`${ID}\n✔ INTENT  ✔ SPEC  ● PLAN  BUILD  TEST  PR    turn 1/20 · 0 min · 3 calls · working\n`)
})

// Bold section headers

test('help: it is folded in a normal run, shows its count, and a press opens it', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  let rows = await paneRowsAt($, 100)
  expect(rows).toContain('► Help (3)')
  expect(rows.join('\n')).not.toContain('Stuck:')
  await press($, w, 'fold-help', 100)
  rows = await paneRowsAt($, 100)
  expect(rows).toContain('▼ Help (3)')
  expect(rows).toContain(TEXTS.helpStuck)
  expect(rows).toContain(TEXTS.helpGetOut)
  expect(rows.some(row => row.startsWith(`Start over: git reset -- changes/${ID}, git switch main`))).toBe(true)
  // Help comes last, under the denials.
  expect(rows.indexOf('▼ Help (3)')).toBeGreaterThan(rows.findIndex(row => row.startsWith('Denials')))
})

for (const state of ['blocked', 'capped', 'interrupted'] as const) {
  test(`help: it opens on its own while the run is ${state}, and a press folds it`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Build'), state, reason: 'x', ...LOCK }) })
    await begin($)
    let rows = await paneRowsAt($, 100)
    expect(rows).toContain('▼ Help (3)')
    expect(rows).toContain(TEXTS.helpStuck)
    expect(rows).toContain(TEXTS.helpGetOut)
    await press($, w, 'fold-help', 100)
    rows = await paneRowsAt($, 100)
    expect(rows).toContain('► Help (3)')
    expect(rows).not.toContain(TEXTS.helpStuck)
  })
}

test('help: a stopped run shows only how to start over, open', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), state: 'stopped', ...LOCK }) })
  await begin($)
  const rows = await paneRowsAt($, 100)
  expect(rows).toContain('▼ Help (1)')
  expect(rows.some(row => row.startsWith(`Start over: git reset -- changes/${ID}, git switch main`))).toBe(true)
  expect(rows).not.toContain(TEXTS.helpStuck)
  expect(rows).not.toContain(TEXTS.helpGetOut)
})

test('help: a finished run has no Help section', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('PR'), state: 'finished', ...LOCK }) })
  await begin($)
  expect((await paneRowsAt($, 100)).join('\n')).not.toContain('Help')
})

test('help: its texts name the command and the commands to start over', () => {
  expect(TEXTS.helpStuck).toBe('Stuck: type /goal-and-do next alone, with no more words. Esc interrupts a running goal.')
  expect(TEXTS.helpGetOut).toBe("Get out: /goal-and-do stop ends the run for good. A stopped run can't be resumed.")
  expect(TEXTS.helpStartOver('ABC-1', 'main')).toBe(
    'Start over: git reset -- changes/ABC-1, git switch main, rm -r changes/ABC-1, git branch -D sdd/ABC-1, then start again from the same request.'
  )
})

test('every fold header and the plain Changed Files and Denials heads are bold, keeping their color', async ($, on) => {
  world(on, FOLD_SETUP())
  await begin($)
  const ui = await paneAt($, 100)
  const texts = textsUnder(await ui.drawn())
  await ui.unmount()
  const heads = texts.filter(found => /^[▼►] /.test(found.text))
  expect(heads.map(found => found.text).sort()).toEqual(
    [HEAD, '► Help (3)', '► Outside the Plan (3)', '► Sensitive Files (1)', '► Suggested Rules (1)', '► Tests: -', '▼ Denials (1)', '▼ Requirements (2)'].sort()
  )
  for (const head of heads) expect(head.weight, head.text).toBe('bold')
  expect(heads.find(found => found.text === '▼ Denials (1)')?.color).toBe('warning')
  expect(heads.find(found => found.text === '► Outside the Plan (3)')?.color).toBe('warning')
  for (const plain of ['Changed Files: 3 (+3 -0)']) {
    expect(texts.find(found => found.text === plain)?.weight, plain).toBe('bold')
  }
  // The lines under the heads stay plain.
  expect(texts.find(found => found.text.startsWith('  Other:'))?.weight).toBeUndefined()
  expect(texts.find(found => found.text.startsWith('read '))?.weight).toBeUndefined()
})

test('the plain Denials head is bold when no denial line shows', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  const ui = await paneAt($, 100)
  const texts = textsUnder(await ui.drawn())
  await ui.unmount()
  expect(texts.find(found => found.text === 'Denials: 0')?.weight).toBe('bold')
})

// A test run with more words

test('a test run with more words leaves the Tests line as the last full run left it', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, testCommand: TEST_COMMAND }),
    bashResult: { [TEST_COMMAND]: PASSED, [`${TEST_COMMAND} -v`]: PASSED, [`${TEST_COMMAND} tests.test_one`]: FAILED },
  })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: TEST_COMMAND })
  await w.clock.settle()
  const full = w.run()?.lastTests
  expect(full).toMatchObject({ status: 'passed', phase: 'Build' })
  await w.clock.advance(5 * 60_000)
  await $.tool.call({ tool: 'Bash', command: `${TEST_COMMAND} -v` })
  await $.tool.call({ tool: 'Bash', command: `${TEST_COMMAND} tests.test_one` })
  await w.clock.settle()
  expect(w.run()?.lastTests).toEqual(full)
  expect(await pane($, 'terminal', 200)).toContain('► Tests: Pass')
  await openTests($)
  expect((await pane($, 'terminal', 200)).some(line => line.startsWith('passed at '))).toBe(true)
  // With a pipe it stays not readable.
  await $.tool.call({ tool: 'Bash', command: `${TEST_COMMAND} -v 2>&1 | tail -5` })
  await w.clock.settle()
  expect(w.run()?.lastTests?.status).toBe('ran')
})

// No timers during a run

for (const [tool, input] of [
  ['ScheduleWakeup', { delaySeconds: 60, reason: 'Waiting for change-reviewer agent to finish', prompt: '<<autonomous-loop-dynamic>>' }],
  ['CronCreate', { cron: '*/5 * * * *', prompt: 'check the PR' }],
] as const) {
  test(`timers: ${tool} is denied during a run with the fixed reason, and counts as a denial`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }) })
    await begin($)
    const r = await $.tool.call({ tool, ...input, tool_use_id: 'toolu_timer' } as never)
    await w.clock.settle()
    expect(r.deny).toBe(REASONS.timers)
    expect(w.ran).not.toContain('toolu_timer')
    expect(w.run()).toMatchObject({ deniedCount: 1, denials: [{ phase: 'PR', key: 'timers' }] })
    expect(await pane($, 'terminal', 200)).toContain(`PR: ${REASONS.timers}`)
  })

  test(`timers: ${tool} is denied in Intent, with the timer reason before Intent's own`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }) })
    await begin($)
    expect((await $.tool.call({ tool, ...input } as never)).deny).toBe(REASONS.timers)
    await w.clock.settle()
    expect(w.run()?.denials).toEqual([{ phase: 'Intent', key: 'timers' }])
  })

  test(`timers: ${tool} is denied at a gate`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }) })
    await begin($)
    expect((await $.tool.call({ tool, ...input } as never)).deny).toBe(REASONS.timers)
    await w.clock.settle()
    expect(w.run()?.denials).toEqual([{ phase: 'Spec', key: 'timers' }])
  })

  for (const [name, setup] of [
    ['with no run', {}],
    ['after the run finished', { run: runAt({ phase: phaseAt('PR'), state: 'finished' }) }],
    ['after the run stopped', { run: runAt({ phase: phaseAt('Build'), state: 'stopped', pendingClear: true }) }],
  ] as [string, Setup][]) {
    test(`timers: ${tool} passes ${name}`, async ($, on) => {
      const w = world(on, setup)
      await begin($)
      const r = await $.tool.call({ tool, ...input, tool_use_id: 'toolu_timer' } as never)
      expect(r.deny).toBeUndefined()
      expect(w.ran).toContain('toolu_timer')
    })
  }

  test(`timers: ${tool} passes the timer rule for a refused run`, async ($, on) => {
    // run.json lists no approvals, the mod's record three: the run is refused, blocked at Build with the guard on.
    const w = world(on, {
      files: { [`changes/${ID}/run.json`]: JSON.stringify(runAt({ phase: phaseAt('Build'), ...LOCK })) },
      store: { [`approvals:${ID}`]: recordOf(approvalsTo('Build', ID)), [`lock:${ID}`]: LOCK },
    })
    await begin($)
    expect(w.toasts).toContain(FORGED(ID))
    expect(w.run()).toMatchObject({ phase: phaseAt('Build'), state: 'blocked' })
    const r = await $.tool.call({ tool, ...input, tool_use_id: 'toolu_timer' } as never)
    expect(r.deny).toBeUndefined()
    expect(w.ran).toContain('toolu_timer')
  })
}

for (const [name, tool, input] of [
  ['a wakeup with stop: true', 'ScheduleWakeup', { stop: true }],
  ['CronDelete', 'CronDelete', { id: 'job-1' }],
] as const) {
  test(`timers: cancelling one, ${name}, goes on during a run`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }) })
    await begin($)
    const r = await $.tool.call({ tool, ...input, tool_use_id: 'toolu_cancel' } as never)
    await w.clock.settle()
    expect(r.deny).toBeUndefined()
    expect(w.ran).toContain('toolu_cancel')
    expect(w.run()?.deniedCount).toBeUndefined()
  })
}

// The status command never fails silently

test('status: a handler that throws answers the fixed line and logs the subcommand and the error name only', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('PR'), state: 'finished' }) })
  await begin($)
  w.failingReads.add('run')
  expect(await command($, 'status')).toBe("goal-and-do could not read the run's status. Try again.")
  // The handler's own catch logs the error's name; the registration's catch would log that the hook failed.
  expect(w.debug.filter(line => line.startsWith('goal-and-do: status: '))).toEqual(['goal-and-do: status: HooksError'])
  expect(w.debug.join('\n')).not.toContain('EIO')
  // Every subcommand answers the same way.
  for (const sub of ['next', 'stop', 'allow', 'allow local']) {
    expect(await command($, sub), sub).toBe(`goal-and-do could not run /goal-and-do ${sub}. Try again.`)
  }
  expect(await command($, 'ABC-1')).toBe('goal-and-do could not run /goal-and-do start. Try again.')
  expect(w.debug.join('\n')).not.toContain('ABC-1')
  w.failingReads.delete('run')
  expect(await command($, 'status')).toContain('pr.md: -')
})

// Stands in for the engine when the mod's own run of /goal-and-do reaches none of its hooks: it answers in their place.
const SKIPS_MOD = {
  name: 'skips-mod',
  tier: 'prepend' as const,
  register(on: On) {
    on('command.run', { command: 'goal-and-do' }, ($, e, next) =>
      e.origin.kind === 'plugin' ? { text: 'goal-and-do registered /goal-and-do but no command.run hook answered it' } : next(e)
    )
  },
}

test(
  "status: when the mod's own status run at the finish reaches no hook of the mod, the status goes to the transcript",
  { plugins: [SKIPS_MOD] },
  async ($, on) => {
    const w = summaryWorld(on)
    await begin($)
    await turnEnd($)
    await w.clock.settle()
    expect(w.debug).toContain('goal-and-do: status: not answered by the mod')
    const short = w.logs.at(-1) ?? ''
    expect(short.split('\n')).toEqual([
      `${ID}: tokens (input plus output), goal turns and active minutes per phase`,
      'Spec: 10,000 input+output · 4 turns · 5 min',
      'Spec gate: 1,000 input+output · 0 turns · 1 min',
      'Plan: 20,000 input+output · 6 turns · 10 min',
      'Build: 200,000 input+output · 20 turns · 30 min',
      'Build rerun 1: 50,000 input+output · 8 turns · 10 min',
      'Test: 30,000 input+output · 5 turns · 5 min',
      'PR: 40,000 input+output · 7 turns · 7 min',
      'All phases: 351,000 input+output · 50 turns · 68 min',
      'Type /goal-and-do status for the full table.',
    ])
  }
)

test('status: the short form stays under 2,000 characters, however many rows the run has', { plugins: [SKIPS_MOD] }, async ($, on) => {
  const rows = Object.fromEntries(
    Array.from({ length: 60 }, (_, i) => [
      `Build rerun ${i + 1}`,
      { models: { m: { input: 1000, output: 9000, cacheRead: 0, cacheWrite: 0 } }, turns: 3, ms: 60000 },
    ])
  )
  const w = summaryWorld(on, { run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, usage: { schema: 'usage-1', rows }, ...LOCK }) })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  const short = w.logs.at(-1) ?? ''
  expect(short.length).toBeLessThan(2000)
  expect(short).toMatch(/\n\+\d+ more rows\nAll phases: 600,000 input\+output · 180 turns · 60 min\nType \/goal-and-do status for the full table\.$/)
})

// Answers the mod's own status run in place of the mod's hook, a second of clock time late, so the person's own status
// can come in while the mod's run waits.
const SKIPS_MOD_LATE = {
  name: 'skips-mod-late',
  tier: 'prepend' as const,
  register(on: On) {
    on('command.run', { command: 'goal-and-do' }, async ($, e, next) => {
      if (e.origin.kind !== 'plugin') return next(e)
      await $.clock.sleep(1_000)
      return { text: 'goal-and-do registered /goal-and-do but no command.run hook answered it' }
    })
  },
}

test("status: a person's own status, typed while the mod's run waits, does not count as its answer", { plugins: [SKIPS_MOD_LATE] }, async ($, on) => {
  const w = summaryWorld(on)
  await begin($)
  await turnEnd($)
  // The person's own status: the mod answers it.
  expect(await command($, 'status')).toContain('| All phases | all models |')
  await w.clock.advance(1_000)
  await w.clock.settle()
  expect(w.debug).toContain('goal-and-do: status: not answered by the mod')
  expect(w.logs.at(-1)).toContain('Type /goal-and-do status for the full table.')
})

test('status: when the mod answers its own status run, nothing more is logged', { plugins: [COMMAND_WATCH] }, async ($, on) => {
  const w = summaryWorld(on)
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.logs.at(-1)).toBe('seen /goal-and-do status from plugin')
  expect(w.debug.some(line => line.includes('not answered'))).toBe(false)
})

// Watches the end of a main-loop turn: logs when the chain beneath has answered, so a test sees what ran before.
const TURN_WATCH = {
  name: 'turn-watch',
  tier: 'prepend' as const,
  register(on: On) {
    on('turn.complete', async ($, e, next) => {
      const r = await next(e)
      $.ui.log('turn end answered')
      return r
    })
    on('command.run', { command: 'goal-and-do' }, ($, e, next) => {
      $.ui.log(`seen /goal-and-do ${e.args}`)
      return next(e)
    })
  },
}

test('status: the mod asks for its own status run while its turn-end hook still runs', { plugins: [TURN_WATCH] }, async ($, on) => {
  const w = summaryWorld(on)
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  const asked = w.logs.indexOf('seen /goal-and-do status')
  expect(asked).toBeGreaterThan(-1)
  expect(asked).toBeLessThan(w.logs.indexOf('turn end answered'))
})

// The band on a short terminal

async function bandBox($: $T, run: { bodyColumns: number; maxRows: number }) {
  const ui = await $.ui.mount({
    plugin: 'goal-and-do',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: run.maxRows, bodyColumns: run.bodyColumns, scroll: { offset: 0, bodyRows: run.maxRows }, view: {} },
  })
  const box = await ui.find({ type: 'Box', key: 'band' })
  const rows = (await ui.findAll({ type: 'Box' })).filter(found => found.key !== 'band').map(found => found.text)
  await ui.unmount()
  return { props: box?.props ?? {}, rows }
}

test('band: with the rows for it, the band keeps its box and the blank row above', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), state: 'gate' }), files: { [phaseFile('Intent')]: INTENT_DONE } })
  await begin($)
  // Two lines at 80 columns: the lines, two borders and the blank row take five rows.
  const { props, rows } = await bandBox($, { bodyColumns: 80, maxRows: 5 })
  expect(props).toMatchObject({ marginTop: 1, borderStyle: 'bold', paddingX: 1 })
  expect(rows).toEqual(['● INTENT  SPEC  PLAN  BUILD  TEST  PR', 'waiting: approve Intent with /goal-and-do next'])
})

test('band: at 80 x 24 at the gate, too few rows for the box, the band drops it and keeps its lines and the blank row', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), state: 'gate' }), files: { [phaseFile('Intent')]: INTENT_DONE } })
  await begin($)
  const { props, rows } = await bandBox($, { bodyColumns: 80, maxRows: 4 })
  expect(props).toMatchObject({ marginTop: 1 })
  expect(props.borderStyle).toBeUndefined()
  expect(props.paddingX).toBeUndefined()
  expect(rows).toEqual(['● INTENT  SPEC  PLAN  BUILD  TEST  PR', 'waiting: approve Intent with /goal-and-do next'])
  // With room for the lines alone, the blank row goes too.
  const tight = await bandBox($, { bodyColumns: 80, maxRows: 2 })
  expect(tight.props.marginTop).toBe(0)
  expect(tight.rows).toHaveLength(2)
})

test('band: with room for one row the band is its one line that fits; with none, one line with the state first', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Spec'), goalActive: true }), turn: { startedAt: NOW, calls: 3 } })
  await begin($)
  for (const [maxRows, line] of [
    // The one line that fits: the phase chain, the turn and the minutes, with the calls left out.
    [1, '✔ INTENT  ● SPEC  PLAN  BUILD  TEST  PR    turn 1/15 · 0 min · working'],
    [0, 'working · turn 1/15 · 0 min · 3 calls    ✔ INTENT  ● SPEC  PLAN  BUILD  TEST  PR'.slice(0, 78)],
  ] as const) {
    const { props, rows } = await bandBox($, { bodyColumns: 78, maxRows })
    expect(props.borderStyle).toBeUndefined()
    expect(rows).toHaveLength(1)
    expect(rows[0], String(maxRows)).toBe(line)
    expect(Array.from(rows[0] ?? '').length).toBeLessThanOrEqual(78)
  }
})

test('band: a band of one line keeps its box in four rows', async ($, on) => {
  world(on, { run: runAt({ phase: phaseAt('Intent'), goalActive: true }), turn: { startedAt: NOW, calls: 3 } })
  await begin($)
  const { props, rows } = await bandBox($, { bodyColumns: 124, maxRows: 4 })
  expect(props).toMatchObject({ borderStyle: 'bold' })
  expect(rows).toHaveLength(1)
})

// A base branch at the start

// The base's fetch as the mod runs it: through env, with the ssh variables unset, the mod's git options and batch ssh.
const fetchLine = (branch: string) =>
  `env -u GIT_SSH_COMMAND -u GIT_SSH GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 ${GIT_SAFE} -c core.sshCommand=ssh -o BatchMode=yes fetch --quiet origin +refs/heads/${branch}:refs/remotes/origin/${branch}`

test('start: --base names the branch the run starts from, in request.md and run.json, after a fetch of it', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' } })
  await begin($)
  const reply = await command($, `--base feat/goal-and-do ${URL_INPUT}`)
  expect(reply).toBe(TEXTS.startedJira(ID))
  expect(w.files.get(`changes/${ID}/request.md`)).toBe(`---\nsource: jira ${ID}\nbase: feat/goal-and-do\n---\n\n${URL_INPUT}\n`)
  expect(w.json()).toMatchObject({ id: ID, input: URL_INPUT, base: 'feat/goal-and-do' })
  const fetch = fetchLine('feat/goal-and-do')
  expect(w.argv).toContain(g('check-ref-format --branch feat/goal-and-do'))
  expect(w.argv).toContain(fetch)
  expect(w.argv).toContain(g('rev-parse --verify --quiet refs/remotes/origin/feat/goal-and-do'))
  // GIT_SSH_COMMAND and GIT_SSH unset, as for the push, ssh in batch mode, no prompt, and 30 seconds.
  expect(fetch.startsWith('env -u GIT_SSH_COMMAND -u GIT_SSH GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 git ')).toBe(true)
  expect(fetch).toContain(' -c core.sshCommand=ssh -o BatchMode=yes fetch ')
  expect(w.timeouts[w.argv.indexOf(fetch)]).toBe(30_000)
  // origin's default branch is not asked for.
  expect(w.argv).not.toContain(g('symbolic-ref --short refs/remotes/origin/HEAD'))
})

for (const base of ['-x', '--upload-pack=evil', 'a..b', '../main', 'a;rm -rf x', 'a$(id)', 'a`id`', 'ä', 'HEAD']) {
  test(`start: --base ${JSON.stringify(base)} is refused with the rule, not the value, and starts nothing`, async ($, on) => {
    const w = world(on)
    await begin($)
    const reply = await command($, `--base ${base} ABC-43224`)
    expect(reply).toBe(TEXTS.baseInvalid)
    expect(reply).not.toContain(base)
    expect(w.writes).toEqual([])
    expect(w.argv.some(line => line.includes(' fetch '))).toBe(false)
  })
}

test('start: free text that mentions --base is plain text, and starts from the default branch', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' }, tools: [] })
  await begin($)
  const input = 'Document the --base option of the start'
  const { id } = changeIdFrom(input, NOW)
  expect(await command($, input)).toBe(TEXTS.startedFreeText(id))
  expect(w.files.get(`changes/${id}/request.md`)).toBe(`---\nsource: freeform\nbase: main\n---\n\n${input}\n`)
  expect(w.argv.some(line => line.includes(' fetch '))).toBe(false)
})

for (const [name, git] of [
  ['fails', { [fetchLine('feat/x')]: [128, ''] }],
  ['runs out of time', { [fetchLine('feat/x')]: [124, ''] }],
] as [string, Record<string, [number, string]>][]) {
  test(`start: a fetch of the base that ${name} refuses the start, though an older copy of the branch is there`, async ($, on) => {
    // rev-parse would find the older remote-tracking copy: it is never asked.
    const w = world(on, { git: { ...git, [g('rev-parse --verify --quiet refs/remotes/origin/feat/x')]: [0, `${'a'.repeat(40)}\n`] } })
    await begin($)
    expect(await command($, '--base feat/x ABC-43224')).toBe(TEXTS.baseNotFetched)
    expect(w.argv).not.toContain(g('rev-parse --verify --quiet refs/remotes/origin/feat/x'))
    expect(w.writes).toEqual([])
  })
}

test('start: a fetch the engine refuses refuses the start too', async ($, on) => {
  const fetch = fetchLine('feat/x')
  const w = world(on, { failArgv: [fetch] })
  await begin($)
  expect(await command($, '--base feat/x ABC-43224')).toBe(TEXTS.baseNotFetched)
  expect(w.writes).toEqual([])
})

test("start: a base git's own rules refuse is refused, and no fetch runs", async ($, on) => {
  const w = world(on, { git: { [g('check-ref-format --branch feat/x.lock')]: [1, ''] } })
  await begin($)
  expect(await command($, '--base feat/x.lock ABC-43224')).toBe(TEXTS.baseInvalid)
  expect(w.argv.some(line => line.includes(' fetch '))).toBe(false)
  expect(w.writes).toEqual([])
})

for (const args of [
  '--base main next',
  '--base main status',
  '--base main allow local',
  '--base main STOP',
  '--base main',
  '--base',
  'ABC-43224 --base feat/x',
  `${URL_INPUT} --base feat/x`,
  'ABC-43224 --base=feat/x',
  '--base=main ABC-43224',
  'next --base main',
  'stop --base main',
  'docs/prompts/run-1.md --base dev',
]) {
  test(`start: ${JSON.stringify(args)} puts --base where no run can start from it, and starts nothing`, async ($, on) => {
    const w = world(on)
    await begin($)
    expect(await command($, args)).toBe(TEXTS.baseMisplaced)
    expect(w.writes).toEqual([])
    expect(w.run()).toBeNull()
  })
}

test('start: a base that is not on origin is refused with the fixed text, and nothing is written', async ($, on) => {
  const w = world(on, { git: { [g('rev-parse --verify --quiet refs/remotes/origin/feat/gone')]: [1, ''] } })
  await begin($)
  const reply = await command($, '--base feat/gone ABC-43224')
  expect(reply).toBe(TEXTS.baseMissing)
  expect(reply).not.toContain('feat/gone')
  expect(w.writes).toEqual([])
  expect(w.run()).toBeNull()
})

test('start: the chosen base names the branch to switch to when the person is on a change branch', async ($, on) => {
  const w = world(on, { git: { [g('branch --show-current')]: [0, 'sdd/ABC-1\n'] } })
  await begin($)
  expect(await command($, '--base feat/goal-and-do ABC-43224')).toBe(TEXTS.wrongBranch('sdd/ABC-1', 'feat/goal-and-do'))
  expect(w.writes).toEqual([])
})

test("start: without --base the base is origin's default branch, as before, and no fetch runs", async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' }, git: { [g('symbolic-ref --short refs/remotes/origin/HEAD')]: [0, 'origin/develop\n'] } })
  await begin($)
  await command($, URL_INPUT)
  expect(w.files.get(`changes/${ID}/request.md`)).toContain('\nbase: develop\n')
  expect(w.argv.some(line => line.includes(' fetch '))).toBe(false)
  expect(w.argv.some(line => line.includes('rev-parse --verify'))).toBe(false)
})

test("start: the chosen base reaches the changed files' merge-base and the PR's --base", async ($, on) => {
  const base = 'feat/goal-and-do'
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, base, ...LOCK }),
    git: { [g(`merge-base origin/${base} HEAD`)]: [0, `${'a'.repeat(40)}\n`] },
  })
  await begin($)
  const decide = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: 'toolu_x' })).decision
  expect(await decide(`gh pr create --draft --head sdd/${ID} --base ${base} --title x --body-file .git/goal-and-do/pr-body-${ID}.md`)).toBe('allow')
  expect(await decide(`gh pr create --draft --head sdd/${ID} --base main --title x --body-file .git/goal-and-do/pr-body-${ID}.md`)).toBe('ask')
  expect(await decide(`gh pr create --draft --head sdd/${ID} --title x --body-file .git/goal-and-do/pr-body-${ID}.md`)).toBe('ask')
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await w.clock.settle()
  expect(w.argv).toContain(g(`merge-base origin/${base} HEAD`))
  expect(await command($, 'stop')).toBe(TEXTS.stopped(ID, base))
})

// The request from a file

const REQUEST_FILE = 'docs/prompts/run-1.md'
const REQUEST_TEXT = '# Format premium amounts\n\nShow premiums as euros with two decimals.\n'
const FILE_ID = 'CH-20261029-format-premium-amounts'

test('start: a .md file of the project is the request: its heading names the ID, request.md says where it came from', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '', [REQUEST_FILE]: REQUEST_TEXT } })
  await begin($)
  expect(await command($, REQUEST_FILE)).toBe(TEXTS.startedFreeText(FILE_ID))
  expect(w.files.get(`changes/${FILE_ID}/request.md`)).toBe(
    `---\nsource: freeform\nbase: main\nfrom-file: ${REQUEST_FILE}\n---\n\n# Format premium amounts\n\nShow premiums as euros with two decimals.\n`
  )
  expect(w.json(FILE_ID)).toMatchObject({ id: FILE_ID, source: 'freeform', base: 'main' })
  expect(w.argv.some(line => line.includes(' fetch '))).toBe(false)
})

test("start: a request file's front matter base goes through the base checks, and --base wins over it", async ($, on) => {
  const text = '---\nbase: feat/goal-and-do\n---\n\nAdd a function that formats amounts.\n'
  const w = world(on, { files: { '.git/info/exclude': '', [REQUEST_FILE]: text } })
  await begin($)
  const id = 'CH-20261029-add-a-function-that-formats'
  expect(await command($, REQUEST_FILE)).toBe(TEXTS.startedFreeText(id))
  expect(w.files.get(`changes/${id}/request.md`)).toBe(
    `---\nsource: freeform\nbase: feat/goal-and-do\nfrom-file: ${REQUEST_FILE}\n---\n\nAdd a function that formats amounts.\n`
  )
  expect(w.argv).toContain(fetchLine('feat/goal-and-do'))
})

test("start: --base on the command line wins over the request file's base", async ($, on) => {
  const text = '---\nbase: feat/goal-and-do\n---\n\n# Format premium amounts\n'
  const w = world(on, { files: { '.git/info/exclude': '', [REQUEST_FILE]: text } })
  await begin($)
  await command($, `--base release/1.2 ${REQUEST_FILE}`)
  expect(w.files.get(`changes/${FILE_ID}/request.md`)).toContain('\nbase: release/1.2\n')
  expect(w.argv).toContain(fetchLine('release/1.2'))
  expect(w.argv).not.toContain(fetchLine('feat/goal-and-do'))
})

test("start: a request file's base that is no plain name, or not on origin, refuses the start", async ($, on) => {
  const w = world(on, {
    files: { 'docs/bad.md': '---\nbase: -x\n---\n\nText\n', 'docs/gone.md': '---\nbase: feat/gone\n---\n\nText\n' },
    git: { [g('rev-parse --verify --quiet refs/remotes/origin/feat/gone')]: [1, ''] },
  })
  await begin($)
  expect(await command($, 'docs/bad.md')).toBe(TEXTS.requestFileBaseInvalid)
  expect(await command($, 'docs/gone.md')).toBe(TEXTS.requestFileBaseMissing)
  for (const text of [TEXTS.requestFileBaseInvalid, TEXTS.requestFileBaseMissing]) expect(text).not.toContain('--base')
  expect(w.writes).toEqual([])
})

for (const [name, input, setup] of [
  ['a path outside the root', '../other/run-1.md', { files: {} }],
  ['an absolute path', '/tmp/run-1.md', { files: { '/tmp/run-1.md': REQUEST_TEXT } }],
  ['a link to a file outside the root', 'docs/link.md', { files: { '/elsewhere/run-1.md': REQUEST_TEXT }, links: { 'docs/link.md': '/elsewhere/run-1.md' } }],
  [
    'a link to a file under a folder of the same name as the root',
    'docs/sib.md',
    { files: { '/repo2/run-1.md': REQUEST_TEXT }, links: { 'docs/sib.md': '/repo2/run-1.md' } },
  ],
  ['a folder', 'docs/prompts.md', { files: { 'docs/prompts.md/a.md': REQUEST_TEXT } }],
  ['a missing file, a typo', 'docs/prompts/run-2.md', { files: { [REQUEST_FILE]: REQUEST_TEXT } }],
  ['a name with an unusual character', 'docs/run$1.md', { files: { 'docs/run$1.md': REQUEST_TEXT } }],
] as [string, string, Setup][]) {
  test(`start: ${name} names no usable request file, so the start is refused and nothing is read`, async ($, on) => {
    const w = world(on, { ...setup, files: { '.git/info/exclude': '', ...setup.files }, tools: [] })
    await begin($)
    expect(await command($, input)).toBe(TEXTS.requestFileMissing)
    expect(w.writes).toEqual([])
    expect(w.run()).toBeNull()
    // The file outside the project is never read.
    expect(w.rawPaths.some(path => path.endsWith('run-1.md') && !path.startsWith('/repo/'))).toBe(false)
  })
}

for (const [name, input, setup] of [
  ['a file that is no .md', 'docs/run-1.txt', { files: { 'docs/run-1.txt': REQUEST_TEXT } }],
  ['two words, the last ending in .md', 'docs/run 1.md', { files: { 'docs/run 1.md': REQUEST_TEXT } }],
] as [string, string, Setup][]) {
  test(`start: ${name} is no request file, so today's rules read it as free text`, async ($, on) => {
    const w = world(on, { ...setup, files: { '.git/info/exclude': '', ...setup.files }, tools: [] })
    await begin($)
    const { id } = changeIdFrom(input, NOW)
    expect(await command($, input)).toBe(TEXTS.startedFreeText(id))
    expect(w.files.get(`changes/${id}/request.md`)).toBe(`---\nsource: freeform\nbase: main\n---\n\n${input}\n`)
  })
}

test('start: free text that ends in .md stays free text', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' } })
  await begin($)
  const input = 'Fix the typo in README.md'
  const { id } = changeIdFrom(input, NOW)
  expect(await command($, input)).toBe(TEXTS.startedFreeText(id))
  expect(w.files.get(`changes/${id}/request.md`)).not.toContain('from-file')
})

test('start: a new request file, not committed yet, starts the run; any other uncommitted file still refuses it', async ($, on) => {
  const w = world(on, {
    files: { '.git/info/exclude': '', [REQUEST_FILE]: REQUEST_TEXT },
    git: { [g('status --porcelain -z --untracked-files=all')]: [0, `?? ${REQUEST_FILE}\0`] },
  })
  await begin($)
  expect(await command($, REQUEST_FILE)).toBe(TEXTS.startedFreeText(FILE_ID))
  expect(w.files.get(`changes/${FILE_ID}/request.md`)).toContain(`from-file: ${REQUEST_FILE}\n`)
})

test('start: an uncommitted file beside the request file still refuses the start, naming that file alone', async ($, on) => {
  const w = world(on, {
    files: { '.git/info/exclude': '', [REQUEST_FILE]: REQUEST_TEXT },
    git: { [g('status --porcelain -z --untracked-files=all')]: [0, `?? ${REQUEST_FILE}\0?? notes.txt\0`] },
  })
  await begin($)
  expect(await command($, `./${REQUEST_FILE}`)).toBe(TEXTS.preflightDirty('notes.txt'))
  // A text request leaves no file out.
  expect(await command($, 'Format premium amounts')).toBe(TEXTS.preflightDirty(`${REQUEST_FILE}, notes.txt`))
  expect(w.writes).toEqual([])
})

for (const [name, porcelain, others] of [
  ['changed in the worktree', ` M ${REQUEST_FILE}\0`, []],
  ['staged', `M  ${REQUEST_FILE}\0`, []],
  ['added to the index', `A  ${REQUEST_FILE}\0`, []],
  ['staged and changed again', `MM ${REQUEST_FILE}\0`, []],
  ['renamed from another file', `R  ${REQUEST_FILE}\0src/app.py\0`, ['src/app.py']],
  ['copied from another file', `C  ${REQUEST_FILE}\0src/app.py\0`, ['src/app.py']],
  ['deleted in the index and new in the worktree', `D  ${REQUEST_FILE}\0?? ${REQUEST_FILE}\0`, []],
  ['the source of a rename', `R  notes/new.md\0${REQUEST_FILE}\0`, ['notes/new.md']],
] as [string, string, string[]][]) {
  test(`start: a request file ${name} refuses the start: commit it first`, async ($, on) => {
    const w = world(on, {
      files: { '.git/info/exclude': '', [REQUEST_FILE]: REQUEST_TEXT },
      git: { [g('status --porcelain -z --untracked-files=all')]: [0, porcelain] },
    })
    await begin($)
    const reply = await command($, REQUEST_FILE)
    expect(reply).toBe([TEXTS.requestFileCommitFirst, ...(others.length > 0 ? [TEXTS.preflightDirty(others.join(', '))] : [])].join('\n'))
    expect(w.writes).toEqual([])
  })
}

test('start: a text request on a tree with a changed .md file names the file, as any dirty file', async ($, on) => {
  const w = world(on, { git: { [g('status --porcelain -z --untracked-files=all')]: [0, ` M ${REQUEST_FILE}\0`] } })
  await begin($)
  expect(await command($, 'Format premium amounts')).toBe(TEXTS.preflightDirty(REQUEST_FILE))
  expect(w.writes).toEqual([])
})

test("start: a dirty file's name reaches the refusal only as a plain name, else as the fixed text", async ($, on) => {
  const odd = ['notes/\u001b[31mred\u001b[0m.txt', 'a\nb.txt', 'x\u202eexe.txt', 'link\u001b]8;;https://x\u0007y.txt']
  const w = world(on, { git: { [g('status --porcelain -z --untracked-files=all')]: [0, [...odd.map(name => `?? ${name}`), '?? plain.txt'].join('\0')] } })
  await begin($)
  const reply = await command($, 'Format premium amounts')
  expect(reply).toBe(TEXTS.preflightDirty([...odd.map(() => '<a file with an unusual name>'), 'plain.txt'].join(', ')))
  expect(reply).not.toMatch(/[\u0000-\u001f\u007f\u202e]/)
  expect(w.writes).toEqual([])
})

test('start: a request file whose size could not hold 20,000 characters is refused unread', async ($, on) => {
  const w = world(on, { files: { [REQUEST_FILE]: REQUEST_TEXT }, sizes: { [REQUEST_FILE]: 80_001 } })
  await begin($)
  expect(await command($, REQUEST_FILE)).toBe(TEXTS.requestFileUnreadable)
  expect(w.rawPaths.filter(path => path.endsWith(REQUEST_FILE))).toEqual([])
  expect(w.writes).toEqual([])
})

test('start: a request file inside the root, reached through a link, is read where it lands', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '', [REQUEST_FILE]: REQUEST_TEXT }, links: { 'docs/latest.md': `/repo/${REQUEST_FILE}` } })
  await begin($)
  expect(await command($, 'docs/latest.md')).toBe(TEXTS.startedFreeText(FILE_ID))
  expect(w.files.get(`changes/${FILE_ID}/request.md`)).toContain('from-file: docs/latest.md\n')
})

for (const [name, setup, text] of [
  ['longer than 20,000 characters', { files: { [REQUEST_FILE]: `# Big\n${'a'.repeat(20_000)}` } }, TEXTS.requestFileUnreadable],
  ['unreadable', { files: { [REQUEST_FILE]: REQUEST_TEXT }, unreadable: [REQUEST_FILE] }, TEXTS.requestFileUnreadable],
  ['empty below its front matter', { files: { [REQUEST_FILE]: '---\nbase: main\n---\n\n' } }, TEXTS.requestFileUnreadable],
  ['with another front-matter key', { files: { [REQUEST_FILE]: '---\nbase: main\nsource: jira ABC-1\n---\n\nText\n' } }, TEXTS.requestFileFrontMatter],
] as [string, Setup, string][]) {
  test(`start: a request file ${name} refuses the start with a fixed text, no path or content in it`, async ($, on) => {
    const w = world(on, setup)
    await begin($)
    const reply = await command($, REQUEST_FILE)
    expect(reply).toBe(text)
    expect(reply).not.toContain('run-1')
    expect(reply).not.toContain('aaaa')
    expect(w.writes).toEqual([])
    expect(w.run()).toBeNull()
  })
}

// The pane on a narrow terminal

test('pane: an open Claude Code keeps undrawn leaves a fixed debug line', async ($, on) => {
  const w = world(on, { files: { '.git/info/exclude': '' }, paneNotPlaced: true })
  await begin($)
  await command($, URL_INPUT)
  await w.clock.settle()
  expect(w.opened).toEqual(['goal-and-do'])
  expect(w.debug).toContain('goal-and-do: pane: not placed')
  expect(w.debug.join('\n')).not.toContain('144')
})

test("pane: a person's status or next opens the pane of an active run again; another plugin's does not", async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Spec'), state: 'gate' }), answers: [undefined] })
  await begin($)
  await command($, 'status')
  expect(w.opened).toEqual(['goal-and-do'])
  await command($, 'next')
  await w.clock.settle()
  expect(w.opened).toEqual(['goal-and-do', 'goal-and-do'])
  await command($, 'status', OTHER)
  expect(w.opened).toHaveLength(2)
})

test('pane: in a refused run, status and next neither open the pane nor read the changed files', async ($, on) => {
  const w = world(on, { files: { [`changes/${ID}/run.json`]: JSON.stringify(runAt({ phase: phaseAt('Build'), ...LOCK })) } })
  await begin($)
  expect(w.toasts).toContain(FORGED(ID))
  const opened = w.opened.length
  const reads = w.argv.length
  await command($, 'status')
  await command($, 'next')
  await w.clock.settle()
  expect(w.opened).toHaveLength(opened)
  expect(w.argv.slice(reads).some(line => line.includes('merge-base') || line.includes('diff --numstat'))).toBe(false)
})

test('pane: status opens no pane for a finished or stopped run, nor without one', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('PR'), state: 'finished' }) })
  await begin($)
  await command($, 'status')
  await command($, 'next')
  expect(w.opened).toEqual([])
})

test('reach: a Read of an environment file is denied and ends the run blocked, a Read of an example copy passes', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }) })
  await begin($)
  const example = await $.tool.call({ tool: 'Read', file_path: '/repo/.env.example' })
  expect((example as { deny?: string }).deny).toBeUndefined()
  expect(w.run()?.state).toBe('running')
  const refused = await $.tool.call({ tool: 'Read', file_path: '/repo/.env' })
  expect((refused as { deny?: string }).deny).toContain('/repo/.env')
  expect(w.run()?.state).toBe('blocked')
  expect(w.run()?.reason).toContain('/repo/.env')
})

// Guard level

test('level: at review a Read of an environment file is denied, counted and listed, and the run stays running', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, guardLevel: 'review' }) })
  await begin($)
  const refused = await $.tool.call({ tool: 'Read', file_path: '/repo/.env' })
  expect((refused as { deny?: string }).deny).toContain('/repo/.env')
  const again = await $.tool.call({ tool: 'Bash', command: 'cat /repo/.env' })
  expect((again as { deny?: string }).deny).toContain('/repo/.env')
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'running', deniedCount: 2, guardLevel: 'review' })
  expect(w.run()?.reason).toBeUndefined()
  expect(w.json().deniedCalls).toMatchObject([
    { phase: 'Build', key: 'envFile', tool: 'Read' },
    { phase: 'Build', key: 'envFile', tool: 'Bash', command: 'cat /repo/.env' },
  ])
  const next = await $.tool.call({ tool: 'Read', file_path: '/repo/.env.example' })
  expect((next as { deny?: string }).deny).toBeUndefined()
})

test('level: at review the command text in the denied-call list has its secret shapes removed', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, guardLevel: 'review' }) })
  await begin($)
  const secret = ['ghp_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('')
  await $.tool.call({ tool: 'Bash', command: `cat /repo/.env ${secret}` })
  await w.clock.settle()
  const listed = JSON.stringify(w.json().deniedCalls)
  expect(listed).not.toContain(secret)
  expect(listed).toContain('<removed: token>')
})

for (const guardLevel of ['strict', undefined] as const) {
  test(`level: with the level ${guardLevel ?? 'not set'}, a Read of an environment file ends the run blocked and lists nothing`, async ($, on) => {
    const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, ...(guardLevel === undefined ? {} : { guardLevel }) }) })
    await begin($)
    const refused = await $.tool.call({ tool: 'Read', file_path: '/repo/.env' })
    expect((refused as { deny?: string }).deny).toContain('/repo/.env')
    expect(w.run()).toMatchObject({ state: 'blocked', deniedCount: 1 })
    expect(w.run()?.reason).toContain('/repo/.env')
    expect(w.run()?.deniedCalls).toBeUndefined()
  })
}

test('level: at review a denial that is not a blocking kind is counted and listed once, and the run stays running', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, guardLevel: 'review' }) })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: 'gh pr merge 1' })).deny).toBe(REASONS.pullRequest)
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'running', deniedCount: 1, denials: [{ phase: 'Build', key: 'pullRequest' }] })
  expect(w.json().deniedCalls).toHaveLength(1)
})

test("level: the mod's own block still ends the run at review", async ($, on) => {
  const w = world(on, withRecord({ run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK, guardLevel: 'review' }), answers: ['Not now'] }))
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBe('goal-and-do: you chose not to push yet.')
  await w.clock.settle()
  expect(w.run()?.state).toBe('blocked')
})

test('level: a start line without --strict starts a run at review, with one toast and one log line of the notice', async ($, on) => {
  const w = world(on)
  await begin($)
  expect(await command($, ID)).toBe(TEXTS.startedJira(ID))
  await w.clock.settle()
  expect(w.json()).toMatchObject({ id: ID, guardLevel: 'review' })
  expect(w.toasts.filter(text => text === LEVEL_NOTICE)).toHaveLength(1)
  expect(w.logs.filter(text => text === LEVEL_NOTICE)).toHaveLength(1)
})

test('level: --strict as the first word starts a run at strict, with no notice', async ($, on) => {
  const w = world(on)
  await begin($)
  expect(await command($, `--strict ${ID}`)).toBe(TEXTS.startedJira(ID))
  await w.clock.settle()
  expect(w.json()).toMatchObject({ id: ID, guardLevel: 'strict' })
  expect(w.toasts).not.toContain(LEVEL_NOTICE)
  expect(w.logs).not.toContain(LEVEL_NOTICE)
})

test('level: --strict before --base starts a run at strict on that base', async ($, on) => {
  const w = world(on)
  await begin($)
  expect(await command($, `--strict --base main ${ID}`)).toBe(TEXTS.startedJira(ID))
  await w.clock.settle()
  expect(w.json()).toMatchObject({ id: ID, base: 'main', guardLevel: 'strict' })
})

test('level: --strict after --base starts a run at strict on that base', async ($, on) => {
  const w = world(on)
  await begin($)
  expect(await command($, `--base main --strict ${ID}`)).toBe(TEXTS.startedJira(ID))
  await w.clock.settle()
  expect(w.json()).toMatchObject({ id: ID, base: 'main', guardLevel: 'strict' })
  expect(w.toasts).not.toContain(LEVEL_NOTICE)
})

for (const args of [
  `${ID} --strict`,
  '--strict',
  '--strict next',
  '--strict=1 fix the login',
  '--base main --strict',
  '--strict --base main --strict fix the login',
]) {
  test(`level: a misplaced --strict is refused and writes no run: ${args}`, async ($, on) => {
    const w = world(on)
    await begin($)
    expect(await command($, args)).toBe(TEXTS.strictMisplaced)
    await w.clock.settle()
    expect(w.run()).toBeNull()
    expect([...w.files.keys()].filter(path => path.startsWith('changes/'))).toEqual([])
    expect(w.toasts).toEqual([])
  })
}

test('level: the notice comes once per run, not once per phase', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, guardLevel: 'review' }) })
  await begin($)
  await w.clock.settle()
  expect(w.toasts).not.toContain(LEVEL_NOTICE)
  expect(w.logs).not.toContain(LEVEL_NOTICE)
})

test('level: a restart keeps the level, the denied calls and the level changes of a run at review', async ($, on) => {
  const approvals = approvalsTo('Plan')
  const deniedCalls: DeniedCall[] = [{ phase: 'Spec', key: 'envFile', tool: 'Read', at: NOW + 1 }]
  const levelChanges: LevelChange[] = [{ at: NOW + 2, from: 'strict', to: 'review' }]
  const w = world(on, {
    files: {
      'changes/ABC-2/run.json': JSON.stringify(
        runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals, guardLevel: 'review', deniedCount: 3, deniedCalls, levelChanges })
      ),
    },
    store: { 'approvals:ABC-2': recordOf(approvals), 'level:ABC-2': 'review' },
  })
  await begin($)
  expect(w.toasts).toEqual([])
  expect(w.run()).toMatchObject({ id: 'ABC-2', state: 'gate', guardLevel: 'review', deniedCount: 3, deniedCalls, levelChanges })
})

// What the mod's store says about the level, against what run.json says.
const NOTES_LEVEL_MISMATCH = (id: string) =>
  `The guard level of ${id} in run.json is review, but the mod's record does not say so. The run is restored at the strict level. Type \`/goal-and-do level review\` to switch.`

for (const [name, level, stored, toasts] of [
  ['the store says strict', 'review', 'strict', true],
  ['the store has no level', 'review', undefined, true],
  ['the store holds another value', 'review', 'lenient', true],
  ['run.json says strict and the store says review', 'strict', 'review', false],
  ['run.json has no level and the store says review', undefined, 'review', false],
] as [string, string | undefined, string | undefined, boolean][]) {
  test(`level: a run restores as strict when ${name}`, async ($, on) => {
    const approvals = approvalsTo('Plan')
    const w = world(on, {
      files: {
        'changes/ABC-2/run.json': JSON.stringify({ ...runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals }), guardLevel: level }),
      },
      store: { 'approvals:ABC-2': recordOf(approvals), ...(stored === undefined ? {} : { 'level:ABC-2': stored }) },
    })
    await begin($)
    expect(w.run()).toMatchObject({ id: 'ABC-2', state: 'gate', guardLevel: 'strict' })
    expect(w.toasts).toEqual(toasts ? [NOTES_LEVEL_MISMATCH('ABC-2')] : [])
  })
}

for (const [args, level] of [
  [ID, 'review'],
  [`--strict ${ID}`, 'strict'],
] as const) {
  test(`level: a start with ${args === ID ? 'no flag' : '--strict'} stores ${level}, and a restart restores that level`, async ($, on) => {
    const w = world(on)
    await begin($)
    await command($, args)
    await w.clock.settle()
    expect(w.store.get(`level:${ID}`)).toBe(level)
    await begin($)
    expect(w.run()).toMatchObject({ id: ID, guardLevel: level })
    expect(w.toasts.filter(text => text !== LEVEL_NOTICE)).toEqual([])
  })
}

test('level: a switch is stored, so a restart keeps the new level', async ($, on) => {
  const w = world(on)
  await begin($)
  await command($, ID)
  await w.clock.settle()
  expect(await command($, 'level strict')).toBe(TEXTS.levelSwitched('review', 'strict'))
  await w.clock.settle()
  expect(w.store.get(`level:${ID}`)).toBe('strict')
  await command($, 'level review')
  await w.clock.settle()
  expect(w.store.get(`level:${ID}`)).toBe('review')
  await begin($)
  expect(w.run()).toMatchObject({ id: ID, guardLevel: 'review' })
})

for (const [name, fields] of [
  ['no level', {}],
  ['an unknown level', { guardLevel: 'lenient' }],
  ['a level of another type', { guardLevel: true }],
  ['Review in capitals', { guardLevel: 'Review' }],
] as [string, Record<string, unknown>][]) {
  test(`level: a run.json with ${name} is restored as strict`, async ($, on) => {
    const approvals = approvalsTo('Plan')
    const w = world(on, {
      files: {
        'changes/ABC-2/run.json': JSON.stringify({
          ...runAt({ id: 'ABC-2', phase: phaseAt('Plan'), state: 'gate', approvals }),
          guardLevel: undefined,
          ...fields,
        }),
      },
      store: { 'approvals:ABC-2': recordOf(approvals) },
    })
    await begin($)
    expect(w.run()).toMatchObject({ id: 'ABC-2', state: 'gate', guardLevel: 'strict' })
  })
}

test('level: a run of schema 1 comes back at strict', async ($, on) => {
  const earlier = JSON.stringify({
    ...runAt({ id: 'ABC-6', state: 'gate', phase: 1, approvals: approvalsTo('Spec', 'ABC-6') }),
    schema: 1,
    guardLevel: 'review',
  })
  const w = world(on, { files: { 'changes/ABC-6/run.json': earlier } })
  await begin($)
  expect(w.run()).toMatchObject({ id: 'ABC-6', schema: 2, state: 'blocked', guardLevel: 'strict' })
})

const levelRun = (guardLevel: 'strict' | 'review', fields: Partial<Run> = {}): Run =>
  runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, guardLevel, ...fields })

test('level: the command switches a running run from review to strict, logs the switch and keeps the denied calls', async ($, on) => {
  const deniedCalls: DeniedCall[] = [{ phase: 'Build', key: 'envFile', tool: 'Read', at: NOW }]
  const w = world(on, { run: levelRun('review', { deniedCount: 1, deniedCalls }) })
  await begin($)
  expect(await command($, 'level strict')).toBe(TEXTS.levelSwitched('review', 'strict'))
  await w.clock.settle()
  expect(w.json()).toMatchObject({ guardLevel: 'strict', state: 'running', deniedCount: 1, deniedCalls, levelChanges: [{ from: 'review', to: 'strict' }] })
  expect(typeof w.run()?.levelChanges?.[0]?.at).toBe('number')
  expect((await $.tool.call({ tool: 'Read', file_path: '/repo/.env' })).deny).toContain('/repo/.env')
  expect(w.run()?.state).toBe('blocked')
})

test('level: the command switches a run from strict to review, and the next environment-file denial lets the run go on', async ($, on) => {
  const w = world(on, { run: levelRun('strict') })
  await begin($)
  expect(await command($, 'LEVEL Review')).toBe(TEXTS.levelSwitched('strict', 'review'))
  expect((await $.tool.call({ tool: 'Read', file_path: '/repo/.env' })).deny).toContain('/repo/.env')
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'running', guardLevel: 'review', deniedCount: 1 })
})

test('level: a switch to the level the run already has is answered and logs nothing', async ($, on) => {
  const w = world(on, { run: levelRun('review') })
  await begin($)
  expect(await command($, 'level review')).toBe(TEXTS.levelUnchanged('review'))
  await w.clock.settle()
  expect(w.run()?.levelChanges).toBeUndefined()
})

test('level: a switch of a blocked run changes the level only and leaves it blocked with its reason', async ($, on) => {
  const w = world(on, { run: levelRun('strict', { state: 'blocked', reason: 'because', goalActive: false }) })
  await begin($)
  expect(await command($, 'level review')).toBe(TEXTS.levelSwitched('strict', 'review'))
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'blocked', reason: 'because', guardLevel: 'review' })
})

test('level: the command is for the person, and a level with another word starts nothing', async ($, on) => {
  const w = world(on, { run: levelRun('review') })
  await begin($)
  expect(await command($, 'level strict', OTHER)).toBe(TEXTS.notFromPerson('level strict', 'plugin other-mod'))
  expect(await command($, 'level loose')).toBe(TEXTS.subcommandWords('level'))
  expect(await command($, 'level')).toBe(TEXTS.subcommandWords('level'))
  await w.clock.settle()
  expect(w.run()).toMatchObject({ guardLevel: 'review' })
  expect(w.run()?.levelChanges).toBeUndefined()
})

test('level: with no run the command gives the no-run text', async ($, on) => {
  world(on)
  await begin($)
  expect(await command($, 'level strict')).toBe(TEXTS.noRun)
})

for (const state of ['finished', 'stopped'] as const) {
  test(`level: a ${state} run keeps its level`, async ($, on) => {
    const w = world(on, { run: levelRun('review', { state, goalActive: false }) })
    await begin($)
    const reply = await command($, 'level strict')
    expect(reply).toBe(state === 'finished' ? TEXTS.runFinished(ID) : TEXTS.runStopped(ID, 'main'))
    expect(w.run()).toMatchObject({ guardLevel: 'review' })
  })
}

for (const guardLevel of ['strict', 'review'] as const) {
  test(`level: the pane shows the line Guard level: ${guardLevel}`, async ($, on) => {
    world(on, { run: levelRun(guardLevel) })
    await begin($)
    expect(await paneRowsAt($, 80)).toContain(`Guard level: ${guardLevel}`)
  })
}

test('level: the pane line follows a switch', async ($, on) => {
  world(on, { run: levelRun('review') })
  await begin($)
  await command($, 'level strict')
  const rows = await paneRowsAt($, 80)
  expect(rows).toContain('Guard level: strict')
  expect(rows).not.toContain('Guard level: review')
})

test('level: the status text starts the usage table with the level line', async ($, on) => {
  world(on, { run: levelRun('review') })
  await begin($)
  const status = await command($, 'status')
  expect(status).toContain(`Guard level: review\n\n${formatUsage(levelRun('review').usage, USAGE_FOOTER)}`)
})

// The header opens to what the person asked for

test('request: the header starts folded and shows nothing of the request', async ($, on) => {
  world(on, { run: runAt({ input: 'Export the broker list as CSV', source: 'freeform' }) })
  await begin($)
  const rows = await paneRowsAt($, 80)
  expect(rows[0]).toBe(HEAD)
  expect(rows.join('\n')).not.toContain('Export the broker list')
})

test('request: a ticket URL shows as a link labeled with its key', async ($, on) => {
  const url = 'https://jira.example.com/browse/ABC-43224'
  const w = world(on, { run: runAt({ input: url, source: 'jira' }) })
  await begin($)
  await press($, w, 'fold-request')
  const ui = await paneAt($, 80)
  expect((await ui.find({ type: 'Link', text: 'ABC-43224' }))?.props.href).toBe(url)
  await ui.unmount()
  expect((await paneRowsAt($, 80))[0]).toBe(`▼ ${ID}`)
})

test('request: a ticket key alone shows as text, with no link', async ($, on) => {
  const w = world(on, { run: runAt({ input: 'ABC-43224', source: 'jira' }) })
  await begin($)
  await press($, w, 'fold-request')
  const ui = await paneAt($, 80)
  expect(await ui.find({ type: 'Link', text: 'ABC-43224' })).toBeUndefined()
  await ui.unmount()
  expect(await paneRowsAt($, 80)).toContain('Ticket: ABC-43224')
})

test('request: free text shows wrapped, and a long one ends in a button that opens request.md', async ($, on) => {
  const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
  const w = world(on, { run: runAt({ input: long, source: 'freeform' }) })
  await begin($)
  await press($, w, 'fold-request', 30)
  const rows = await paneRowsAt($, 30)
  expect(rows[1]).toBe('word0 word1 word2 word3 word4')
  expect(rows).toContain('Open request.md in app')
  for (const row of rows) expect(Array.from(row).length).toBeLessThanOrEqual(30)
  await press($, w, 'open-request', 30)
  expect(w.argv).toContain(`open /repo/changes/${ID}/request.md`)
})

test('request: a request file shows its path as a button that opens it', async ($, on) => {
  const path = 'docs/requests/run-1.md'
  const w = world(on, { run: runAt({ input: path, source: 'freeform' }) })
  await begin($)
  await press($, w, 'fold-request')
  expect(await paneRowsAt($, 80)).toContain(`From ${path}`)
  await press($, w, 'open-request')
  expect(w.argv).toContain(`open /repo/${path}`)
})

test('request: control characters in free text never reach the pane', async ($, on) => {
  const w = world(on, { run: runAt({ input: 'Fix \u001b[31mred\u001b[0m text', source: 'freeform' }) })
  await begin($)
  await press($, w, 'fold-request')
  expect((await paneRowsAt($, 80)).join('\n')).not.toContain('\u001b')
})

// Text typed at a dialog goes to Claude

test('gate: text typed under Other goes to Claude as the request for the phase file, and the gate stays', async ($, on) => {
  const typed = 'Split task 3 into two tasks'
  const w = world(on, { run: runAt({ phase: phaseAt('Plan'), state: 'gate', ...LOCK }), files: { [phaseFile('Plan')]: PLAN_DONE }, answers: [typed] })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.prompts).toEqual([TEXTS.typedPrompt(ID, 'Plan', typed)])
  expect(w.prompts[0]).toContain(`"${typed}"`)
  expect(w.run()).toMatchObject({ phase: phaseAt('Plan'), state: 'gate' })
  expect(w.files.has(`changes/${ID}/approvals.md`)).toBe(false)
  expect(w.logs).toEqual([])
})

test('stuck: text typed under Other goes to Claude, and the run stays blocked', async ($, on) => {
  const typed = 'Use the existing parser instead'
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK }),
    files: { [phaseFile('Build')]: draft('build') },
    answers: [typed],
  })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.prompts).toEqual([TEXTS.typedPrompt(ID, 'Build', typed, 'stuck')])
  expect(w.run()?.state).toBe('blocked')
})

test('gate: control characters in typed text never reach the prompt', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', ...LOCK }),
    files: { [phaseFile('Plan')]: PLAN_DONE },
    answers: ['Add \u001b[31ma\u001b[0m task'],
  })
  await begin($)
  await command($, 'next')
  await w.clock.settle()
  expect(w.prompts.join('')).not.toContain('\u001b')
})

// The person's own prompt at a gate: working, not waiting

test('gate: while a prompt of the person runs, the band and the row say working; after it, waiting again', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Plan'), state: 'gate', ...LOCK }), files: { [phaseFile('Plan')]: PLAN_DONE } })
  await begin($)
  expect((await band($, 'terminal', 124)).join('')).toContain('waiting: approve Plan with /goal-and-do next')
  await $.turn.start({ text: 'Split task 3 into two tasks', turnId: 'turn-1' })
  await w.clock.settle()
  expect((await band($, 'terminal', 124)).join('')).toContain('working on plan.md')
  expect((await band($, 'terminal', 124)).join('')).not.toContain('waiting')
  expect((await paneRowTexts($, 'terminal', 100))[phaseAt('Plan')]).toBe('Plan    plan.md    working  0 tokens')
  await turnEnd($)
  await w.clock.settle()
  expect((await band($, 'terminal', 124)).join('')).toContain('waiting: approve Plan with /goal-and-do next')
  expect((await paneRowTexts($, 'terminal', 100))[phaseAt('Plan')]).toBe('Plan    plan.md    to approve  0 tokens')
})

test('blocked: while a prompt of the person runs, the band says working on the request', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'blocked', reason: 'x', ...LOCK }),
    files: { [phaseFile('Build')]: draft('build') },
  })
  await begin($)
  await $.turn.start({ text: 'Use the existing parser', turnId: 'turn-1' })
  await w.clock.settle()
  expect((await band($, 'terminal', 124)).join('')).toContain('working on build.md')
})

// Last Changed folds like the other path lists

test('folds: Last Changed starts open, and a press folds it and a second press opens it again', async ($, on) => {
  const last = lastChangedLines([
    { path: 'src/a.ts', mtimeMs: 2 },
    { path: 'src/b.ts', mtimeMs: 1 },
  ])
  const w = world(on, { ...FOLD_SETUP(), footprint: { ...FOLD_FOOTPRINT, lines: [...FOLD_FOOTPRINT.lines, ...last] } })
  await begin($)
  let rows = await paneRowsAt($, 100)
  expect(rows).toContain('▼ Last Changed (2)')
  expect(rows).toContain('  src/a.ts')
  await press($, w, 'fold-last', 100)
  rows = await paneRowsAt($, 100)
  expect(rows).toContain('► Last Changed (2)')
  expect(rows).not.toContain('  src/a.ts')
  await press($, w, 'fold-last', 100)
  rows = await paneRowsAt($, 100)
  expect(rows).toContain('▼ Last Changed (2)')
  expect(rows).toContain('  src/a.ts')
  // At the width of a docked pane too.
  rows = await paneRowsAt($, 45)
  expect(rows).toContain('  src/a.ts')
})

test('folds: a long path in Last Changed is shortened from the left, and the other path lists stay', async ($, on) => {
  const long = 'packages/goal-and-do/hooks/register.test.tsx'
  const last = lastChangedLines([{ path: long, mtimeMs: 2 }])
  const w = world(on, { ...FOLD_SETUP(), footprint: { ...FOLD_FOOTPRINT, lines: [...FOLD_FOOTPRINT.lines, ...last] } })
  await begin($)
  await press($, w, 'fold-outside', 45)
  const rows = await paneRowsAt($, 45)
  const shortened = rows.find(row => row.endsWith('register.test.tsx'))
  expect(shortened).toBe(`  …${long.slice(long.length - 42)}`)
  expect(Array.from(shortened ?? '').length).toBe(45)
  // The Outside the Plan list keeps its paths beside it.
  expect(rows).toContain('  lib/a.ts')
})

// The secret check of the calls that publish work. The token is assembled at run time.
const SECRET_TOKEN = ['ghp', '_', 'Ab12Cd34Ef56', 'Gh78Ij90Kl12', 'Mn34Op56Qr78'].join('')
const secretPatch = (path: string) =>
  [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`, '@@ -0,0 +1,1 @@', `+const t = '${SECRET_TOKEN}'`].join('\n') +
  '\n'
const buildRun = (overrides: Partial<Run> = {}) => runAt({ phase: phaseAt('Build'), goalActive: true, ...LOCK, ...overrides })

const UNTRACKED = g('ls-files --others --exclude-standard -z')
const NO_INDEX = (path: string) => g(`diff --no-index --no-color -U0 -- /dev/null ${path}`)
const BINARY_PATCH = (path: string) => [`Binary files /dev/null and b/${path} differ`].join('\n') + '\n'
const manyUntracked = (count: number) => Array.from({ length: count }, (_, index) => `f${index}.txt`).join('\u0000') + '\u0000'

test('secret check: a clean commit passes with an untracked binary file and with 201 untracked files, and reads none of them', async ($, on) => {
  const w = world(on, {
    run: buildRun(),
    git: { [UNTRACKED]: [0, `${manyUntracked(201)}logo.png\u0000`], [NO_INDEX('logo.png')]: [1, BINARY_PATCH('logo.png')] },
  })
  await begin($)
  for (const command of ["git commit -m 'x'", "git commit -a -m 'x'", "git add -u && git commit -m 'x'", "git commit -m 'x' src/a.ts"]) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toBeUndefined()
  }
  expect(w.argv).not.toContain(UNTRACKED)
  expect(w.argv).not.toContain(NO_INDEX('logo.png'))
  expect(w.run()?.state).toBe('running')
})

test('secret check: a commit that adds more untracked files than the check reads is denied, and the denial names the cause', async ($, on) => {
  const w = world(on, { run: buildRun(), git: { [UNTRACKED]: [0, manyUntracked(201)] } })
  await begin($)
  for (const command of [
    "git add -A && git commit -m 'x'",
    "git add . && git commit -m 'x'",
    "git add --all && git commit -m 'x'",
    "git add f1.txt && cd app && git commit -m 'x'",
  ]) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toContain('The secret check could not run')
    expect(r.deny, command).toContain('200 untracked files')
  }
  expect(w.run()?.state).toBe('running')
})

test('secret check: only the untracked files a git add names are read, and a named binary file denies the commit', async ($, on) => {
  const w = world(on, {
    run: buildRun(),
    git: {
      [`${UNTRACKED} -- docs`]: [0, 'docs/logo.png\u0000docs/a.md\u0000'],
      [`${UNTRACKED} -- docs/a.md`]: [0, 'docs/a.md\u0000'],
      [NO_INDEX('docs/logo.png')]: [1, BINARY_PATCH('docs/logo.png')],
    },
  })
  await begin($)
  const named = await $.tool.call({ tool: 'Bash', command: "git add docs && git commit -m 'x'" })
  expect(named.deny).toContain('a binary file')
  expect(w.argv).toContain(NO_INDEX('docs/logo.png'))
  expect(w.argv).toContain(NO_INDEX('docs/a.md'))
  expect(w.argv).not.toContain(NO_INDEX('f0.txt'))
  const other = await $.tool.call({ tool: 'Bash', command: "git add docs/a.md && git commit -m 'x'" })
  expect(other.deny).toBeUndefined()
})

test('secret check: a binary file in the index still denies the commit, whatever the command adds', async ($, on) => {
  world(on, { run: buildRun(), git: { [g('diff --cached --no-color -U0')]: [0, BINARY_PATCH('logo.png')] } })
  await begin($)
  for (const command of ["git commit -m 'x'", "git commit -a -m 'x'", "git add -A && git commit -m 'x'"]) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toContain('The secret check could not run')
    expect(r.deny, command).toContain('a binary file')
  }
})

test('secret check: a push while HEAD is not sdd/<id> is denied before the dialog, since the commits checked would not be the ones pushed', async ($, on) => {
  const other = 'ffffffffffffffffffffffffffffffffffffffff\n'
  const w = world(
    on,
    withRecord({
      run: runAt({ phase: phaseAt('PR'), goalActive: true, ...LOCK }),
      git: { [g(`rev-parse --verify --quiet refs/heads/sdd/${ID}`)]: [0, other] },
      answers: ['Push and open the draft PR'],
    })
  )
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toContain('HEAD is not the branch')
  expect(w.asks).toEqual([])
})

test('secret check: a commit with a path list and no -a is read against HEAD, so a secret in a tracked file denies it', async ($, on) => {
  const w = world(on, { run: buildRun(), git: { [g('diff HEAD --no-color -U0')]: [0, secretPatch('src/a.ts')] } })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: "git commit -m 'x' src/a.ts" })
  expect(r.deny).toContain('src/a.ts')
  expect(r.deny).not.toContain(SECRET_TOKEN)
  expect(w.argv).toContain(g('diff --cached --no-color -U0'))
  expect(w.argv).toContain(g('diff HEAD --no-color -U0'))
})

test('secret check: a secret staged in the index and gone from the work tree still denies the commit', async ($, on) => {
  world(on, { run: buildRun(), git: { [g('diff --cached --no-color -U0')]: [0, secretPatch('src/b.ts')] } })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: "git commit -m 'x'" })
  expect(r.deny).toContain('src/b.ts')
})

test('secret check: a commit behind a git option or a wrapper is checked like a plain one, and a forced add is denied', async ($, on) => {
  world(on, { run: buildRun(), git: { [g('diff HEAD --no-color -U0')]: [0, secretPatch('src/c.ts')] } })
  await begin($)
  for (const command of ["git --no-pager commit -m 'x'", "timeout 30 git commit -m 'x'"]) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toContain('src/c.ts')
  }
  const forced = await $.tool.call({ tool: 'Bash', command: 'git add -f build/out.js' })
  expect(forced.deny).toContain('forced git add')
})

test('secret check: a commit chained to the test command is checked, and the test command alone is not', async ($, on) => {
  world(on, { run: buildRun({ testCommand: 'npm test' }), git: { [g('diff HEAD --no-color -U0')]: [0, secretPatch('src/d.ts')] } })
  await begin($)
  const chained = await $.tool.call({ tool: 'Bash', command: "npm test && git commit -m 'x'" })
  expect(chained.deny).toContain('src/d.ts')
  const alone = await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(alone.deny).toBeUndefined()
})

test('secret check: a secret in a commit message denies the commit before the staged files are read, and the denial never holds the value', async ($, on) => {
  const w = world(on, { run: buildRun() })
  await begin($)
  for (const command of [
    `git commit -m "use ${SECRET_TOKEN}"`,
    `git commit -am "use ${SECRET_TOKEN}"`,
    `git add f.ts && git commit --message="use ${SECRET_TOKEN}"`,
    `git commit -m "$(cat <<'EOF'\nfeat: x\n\nuse ${SECRET_TOKEN}\nEOF\n)"`,
    `git commit -F - <<'EOF'\nuse ${SECRET_TOKEN}\nEOF`,
  ]) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toContain('commit message, line')
    expect(r.deny, command).not.toContain(SECRET_TOKEN)
  }
  expect(w.argv).not.toContain(g('diff --cached --no-color -U0'))
  expect(w.run()?.state).toBe('running')
})

test('secret check: a gh pr create on a line of a longer command, in a subshell or behind an option is checked like a plain one', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('PR'), goalActive: true, pushApproved: true, ...LOCK }),
    files: { [`.git/goal-and-do/pr-body-${ID}.md`]: `Summary.\nuse ${SECRET_TOKEN}\n` },
  })
  await begin($)
  const create = "gh pr create --draft --base main --title 'x'"
  for (const command of [
    `export GH_PAGER=cat\nexport X=1\n${create} --body-file .git/goal-and-do/pr-body-${ID}.md`,
    `(${create} --body-file .git/goal-and-do/pr-body-${ID}.md)`,
    `${create} --body "use ${SECRET_TOKEN}"`,
  ]) {
    const r = await $.tool.call({ tool: 'Bash', command })
    expect(r.deny, command).toContain('PR body, line')
    expect(r.deny, command).not.toContain(SECRET_TOKEN)
  }
  // A command substitution in a gh word is refused before the secret check: the guard can't see what it prints.
  const substituted = await $.tool.call({ tool: 'Bash', command: `${create} --body "$(cat .git/goal-and-do/pr-body-${ID}.md)"` })
  expect(substituted.deny).toBe(REASONS.ghForm)
  expect(w.run()?.state).toBe('running')
})

test("secret check: a message file is read from the Bash tool's directory, and a change of directory in the command denies instead of guessing", async ($, on) => {
  world(on, {
    run: buildRun(),
    cwd: '/repo/app',
    files: { 'app/msg.txt': `feat: x\n\nuse ${SECRET_TOKEN}\n`, 'msg.txt': 'feat: clean\n', 'app/clean.txt': 'feat: clean\n' },
  })
  await begin($)
  const here = await $.tool.call({ tool: 'Bash', command: 'git commit -F msg.txt' })
  expect(here.deny).toContain('commit message, line 3')
  expect(here.deny).not.toContain(SECRET_TOKEN)
  const clean = await $.tool.call({ tool: 'Bash', command: 'git commit -F clean.txt' })
  expect(clean.deny).toBeUndefined()
  const moved = await $.tool.call({ tool: 'Bash', command: 'cd src && git commit -F msg.txt' })
  expect(moved.deny).toContain('cannot be placed')
  const absolute = await $.tool.call({ tool: 'Bash', command: 'git commit -F /repo/app/msg.txt' })
  expect(absolute.deny).toContain('commit message, line 3')
})

test('secret check: named untracked paths are not guessed when the Bash tool is not at the project root', async ($, on) => {
  const w = world(on, { run: buildRun(), cwd: '/repo/app', git: { [UNTRACKED]: [0, manyUntracked(201)] } })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: "git add a.txt && git commit -m 'x'" })
  expect(r.deny).toContain('200 untracked files')
  expect(w.argv).toContain(UNTRACKED)
})

test('Plan gate: Claude edits spec.md during the walk-through, the guard allows it, and approving records a second Spec row', async ($, on) => {
  const departure = `Departure (2026-10-29, decided at the Plan gate): the euro sign goes after the amount.`
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate', approvals: [{ ...OLD_SPEC_APPROVAL, sha256: SPEC_SHA }] }),
    files: { [phaseFile('Spec')]: SPEC_DONE, [phaseFile('Plan')]: PLAN_DONE, 'tests/acceptance/a.test.ts': TEST_FILE },
    answers: ['Approve, start Build'],
  })
  await begin($)
  const edited = await $.tool.call({ tool: 'Edit', file_path: `/repo/${phaseFile('Spec')}`, old_string: '# Spec', new_string: `# Spec\n\n${departure}` })
  expect(edited.deny).toBeUndefined()
  expect(w.run()?.state).toBe('gate')
  w.files.set(phaseFile('Spec'), `${SPEC_DONE}\n${departure}\n`)
  await command($, 'next')
  await w.asked(1)
  expect(w.asks[0]?.question).toBe(`${TEXTS.gateQuestion('Plan', ID, ['tests/acceptance'])} ${TEXTS.changedSinceApproval('spec.md')}`)
  await w.goal(goalFor('Build', ID))
  await w.clock.settle()
  expect(w.json().approvals.map(row => row.phase)).toEqual(['Spec', 'Spec', 'Plan'])
  const spec = (w.files.get(`changes/${ID}/approvals.md`) ?? '').split('\n').filter(row => row.startsWith('| Spec |'))
  // The first row stays as history; the second holds the edited file's hash.
  expect(spec).toHaveLength(2)
  expect(spec[0]).toContain(SPEC_SHA)
  expect(spec[1]).not.toContain(SPEC_SHA)
})

test('Plan gate: the walk-through prompt of plan.md carries the Departure line, and the denial count stays 0 for the edit', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Plan'), state: 'gate' }),
    files: {
      [phaseFile('Plan')]: `${PLAN_DONE}\n## Open points\n\n- Departure AC-2: the euro sign goes after the amount.\n`,
      'tests/acceptance/a.test.ts': TEST_FILE,
    },
    answers: ['Walk through the 1 open point'],
  })
  await begin($)
  await command($, 'next')
  await w.asked(1)
  await w.clock.settle()
  expect(w.prompts[0]).toContain('Departure (2026-10-29, decided at the Plan gate)')
  expect(w.prompts[0]).toBe(`${TEXTS.walkPicked('Plan', 'gate')} ${TEXTS.walkPrompt(ID, 'plan.md', '2026-10-29')}`)
  expect(w.run()?.denials ?? []).toEqual([])
})

// The fix push cap (AC-3, AC-4, AC-10, AC-11)

const NEW_SUBJECTS = g(`log --format=%s origin/sdd/${ID}..HEAD`)
const FIX_COMMIT = `fix(${ID}): unit-tests`
const RECORD_COMMIT = `docs(${ID}): pr record`
const CAP_REASON = 'The cap of 3 fix pushes is reached'

test('fix cap: a fix push below the cap goes through and counts once', async ($, on) => {
  const w = world(on, { ...prRun({ fixPushes: 1, fixCap: 3 }), git: { [NEW_SUBJECTS]: [0, `${FIX_COMMIT}\nfeat(${ID}): add parser\n${FIX_COMMIT}\n`] } })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBeUndefined()
  expect(w.run()).toMatchObject({ fixPushes: 2, fixCap: 3, state: 'running' })
})

test('fix cap: at the cap a push with a fix commit is refused, the count stays and the run is stuck on the cap', async ($, on) => {
  const w = world(on, { ...prRun({ fixPushes: 3, fixCap: 3, pushApproved: false }), git: { [NEW_SUBJECTS]: [0, `${RECORD_COMMIT}\n${FIX_COMMIT}\n`] } })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toContain(CAP_REASON)
  expect(w.asks).toEqual([])
  expect(w.run()).toMatchObject({ fixPushes: 3, fixCap: 3, state: 'blocked' })
  expect(w.run()?.reason).toContain(CAP_REASON)
})

test('fix cap: at the cap the record push passes and the count does not change', async ($, on) => {
  const w = world(on, { ...prRun({ fixPushes: 3, fixCap: 3 }), git: { [NEW_SUBJECTS]: [0, `${RECORD_COMMIT}\n`] } })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toBeUndefined()
  expect(w.run()).toMatchObject({ fixPushes: 3, fixCap: 3, state: 'running' })
})

test('fix cap: a push that git fails to list is refused before the person is asked', async ($, on) => {
  const w = world(on, { ...prRun({ pushApproved: false }), git: { [NEW_SUBJECTS]: [128, ''] } })
  await begin($)
  const r = await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(r.deny).toContain('git could not list the commits it would send')
  expect(w.asks).toEqual([])
  expect(w.run()).toMatchObject({ fixPushes: 0 })
})

test('fix cap: a push that did not go through counts for nothing', async ($, on) => {
  const failed = { [forcedPush(`origin sdd/${ID}`)]: { isError: true, text: 'remote: rejected' } }
  const w = world(on, { ...prRun({ fixPushes: 0 }), git: { [NEW_SUBJECTS]: [0, `${FIX_COMMIT}\n`] }, bashResult: failed })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })
  expect(w.run()).toMatchObject({ fixPushes: 0 })
})

// A PR run at the cap whose fix push the mod refuses; the turn then ends and the stuck dialog opens.
async function stuckAtCap($: $T, on: On, state: { fixPushes: number; fixCap: number }, answers: (string | undefined)[]) {
  const w = world(on, { ...prRun({ ...state }), git: { [NEW_SUBJECTS]: [0, `${FIX_COMMIT}\n`] }, answers })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toContain(`The cap of ${state.fixCap} fix pushes is reached`)
  await turnEnd($)
  await w.clock.settle()
  return w
}

test('fix cap: the stuck dialog offers rerun, reset and raise; a reset zeroes the count, reruns the phase and is logged only in the Git directory', async ($, on) => {
  const state = { fixPushes: 3, fixCap: 3 }
  const w = await stuckAtCap($, on, state, [TEXTS.fixCapChoiceLabel('reset count', state)])
  await w.clock.settle()
  expect(w.asks[0]?.header).toBe('Stuck')
  expect(w.asks[0]?.options).toEqual(TEXTS.fixCapOptions(state))
  expect(w.asks[0]?.options.slice(0, 3)).toEqual([
    'Rerun PR now, keep the count (3 of 3)',
    'Reset the count to 0 (cap stays 3) and rerun',
    'Raise the cap by 3 to 6 (count stays 3) and rerun',
  ])
  expect(w.run()).toMatchObject({ state: 'running', fixPushes: 0, fixCap: 3, reruns: { PR: 1 } })
  expect(w.files.get(`.git/goal-and-do/fix-choices-${ID}.log`)).toMatch(/Z reset count: count 0, cap 3\n$/)
  expect(JSON.stringify(w.run())).not.toContain('fix-choices')
})

test('fix cap: raising the cap adds 3 and keeps the count; a rerun changes neither', async ($, on) => {
  const state = { fixPushes: 3, fixCap: 3 }
  const raised = await stuckAtCap($, on, state, [TEXTS.fixCapChoiceLabel('raise cap', state)])
  await raised.clock.settle()
  expect(raised.run()).toMatchObject({ state: 'running', fixPushes: 3, fixCap: 6 })
  expect(raised.files.get(`.git/goal-and-do/fix-choices-${ID}.log`)).toMatch(/Z raise cap: count 3, cap 6\n$/)
})

test('fix cap: a rerun keeps the count and the cap, so the next fix push is refused again', async ($, on) => {
  const state = { fixPushes: 3, fixCap: 3 }
  const w = await stuckAtCap($, on, state, [TEXTS.fixCapChoiceLabel('rerun', state)])
  await w.clock.settle()
  expect(w.run()).toMatchObject({ state: 'running', fixPushes: 3, fixCap: 3, reruns: { PR: 1 } })
  expect(w.files.get(`.git/goal-and-do/fix-choices-${ID}.log`)).toMatch(/Z rerun: count 3, cap 3\n$/)
  expect((await $.tool.call({ tool: 'Bash', command: `git push origin sdd/${ID}` })).deny).toContain(CAP_REASON)
})

test('fix cap: the stuck dialog at a cap of 9 offers no raise', async ($, on) => {
  const w = await stuckAtCap($, on, { fixPushes: 9, fixCap: 9 }, [undefined])
  await w.clock.settle()
  expect(w.asks[0]?.options.some(option => option.startsWith('Raise the cap'))).toBe(false)
  expect(w.run()).toMatchObject({ state: 'blocked', fixPushes: 9, fixCap: 9 })
})

for (const [name, fields] of [
  ['values they cannot hold', { fixPushes: -2, fixCap: 40 }],
  ['no count and no cap', {}],
] as const) {
  test(`fix cap: a run.json with ${name} loads with 0 and 3`, async ($, on) => {
    const { fixPushes: _count, fixCap: _cap, ...older } = runAt({ id: 'ABC-2', phase: phaseAt('PR'), state: 'gate', approvals: approvalsTo('PR') })
    const w = world(on, withRecord({ files: { 'changes/ABC-2/run.json': JSON.stringify({ ...older, ...fields }) } }))
    await begin($)
    expect(w.run()).toMatchObject({ id: 'ABC-2', fixPushes: 0, fixCap: 3 })
  })
}

test('fix cap: a run.json with a count and a cap loads with both as saved', async ($, on) => {
  const saved = runAt({ id: 'ABC-2', phase: phaseAt('PR'), state: 'gate', approvals: approvalsTo('PR'), fixPushes: 4, fixCap: 6 })
  const w = world(on, withRecord({ files: { 'changes/ABC-2/run.json': JSON.stringify(saved) } }))
  await begin($)
  expect(w.run()).toMatchObject({ id: 'ABC-2', fixPushes: 4, fixCap: 6 })
})

// The read-only follow-ups of the PR phase (AC-5, AC-6, AC-15)

test('push: the reads of the head commit, the draft state and the description need no permission, any other gh pr view does', async ($, on) => {
  world(on, prRun())
  await begin($)
  const decide = async (command: string) => (await $.tool.check({ tool: 'Bash', input: { command }, approver: 'person', tool_use_id: 'toolu_x' })).decision
  expect(await decide(`gh pr view sdd/${ID} --json headRefOid,statusCheckRollup`)).toBe('allow')
  expect(await decide(`timeout 30 gh pr view sdd/${ID} --json headRefOid,statusCheckRollup`)).toBe('allow')
  expect(await decide(`gh pr view sdd/${ID} --json isDraft`)).toBe('allow')
  expect(await decide(`gh pr view sdd/${ID} --json body`)).toBe('allow')
  expect(await decide(`gh pr view sdd/${ID} --json headRefOid`)).toBe('ask')
  expect(await decide(`gh pr view sdd/${ID} --json headRefOid,statusCheckRollup,body`)).toBe('ask')
  expect(await decide(`gh pr view sdd/${ID} --web`)).toBe('ask')
  expect(await decide('gh pr view sdd/ABC-1 --json headRefOid,statusCheckRollup')).toBe('ask')
  expect(await decide(`gh pr view sdd/${ID} --json headRefOid,statusCheckRollup; rm -r x`)).toBe('ask')
})

const NOT_DRAFT_AT_END = { git: { [DRAFT_CHECK]: [0, '{"isDraft":false}\n'] as [number, string] } }

test('summary: a PR created as a draft that is none at the end warns', async ($, on) => {
  const w = summaryWorld(on, { ...NOT_DRAFT_AT_END, files: { [phaseFile('PR')]: PR_DONE.replace('fix-rounds: 1', 'fix-rounds: 1\ndraft-at-create: yes') } })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.logs).toContain(TEXTS.summaryNotDraft)
})

test('summary: a pr.md that says the PR was not created as a draft gives no warning', async ($, on) => {
  const w = summaryWorld(on, { ...NOT_DRAFT_AT_END, files: { [phaseFile('PR')]: PR_DONE.replace('fix-rounds: 1', 'fix-rounds: 1\ndraft-at-create: no') } })
  await begin($)
  await turnEnd($)
  await w.clock.settle()
  expect(w.logs).not.toContain(TEXTS.summaryNotDraft)
})

// Run 3 (November 2, 2026): an awk or grep regex over the test output blocked the finished Test phase as an environment
// file pattern. A Bash command with a wildcard now gets the mod's listing of env files and links, read fresh for each call
// (PR 48's security review), and the guard judges the wildcard by it.
const ENV_FIND = 'find . ( -name node_modules -o -name .git ) -prune -o -name .env* -type f -print0'
const LINK_FIND = 'find . ( -name node_modules -o -name .git ) -prune -o -type l -print0'

test('guard: a Bash command with a wildcard is judged by the env listing, so a plain path passes and a glob that reaches .env is refused', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK }), git: { [ENV_FIND]: [0, './.env\0'] } })
  await begin($)
  const plain = await $.tool.call({ tool: 'Bash', command: 'cat src/.*' })
  expect(plain.deny).toBeUndefined()
  expect(w.argv).toContain(ENV_FIND)
  expect(w.argv).toContain(LINK_FIND)
  expect(w.run()?.state).toBe('running')
  const glob = await $.tool.call({ tool: 'Bash', command: 'cat .*' })
  expect(glob.deny).toContain('a pattern that could match one')
  expect(w.run()?.state).toBe('blocked')
})

test('guard: each Bash command with a wildcard reads the listing again, and a link in it keeps the old rule', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK }),
    git: { [ENV_FIND]: [0, './.env\0'], [LINK_FIND]: [0, './src/.secret\0'] },
  })
  await begin($)
  const linked = await $.tool.call({ tool: 'Bash', command: 'cat src/.*' })
  expect(linked.deny).toContain('a pattern that could match one')
  expect(w.argv.filter(line => line === ENV_FIND).length).toBe(1)
  await $.tool.call({ tool: 'Bash', command: 'ls docs/*' })
  await $.tool.call({ tool: 'Bash', command: 'cat docs/.*' })
  expect(w.argv.filter(line => line === ENV_FIND).length).toBeGreaterThanOrEqual(2)
})

test('guard: a link listing that fails keeps the old rule for a wildcard', async ($, on) => {
  const w = world(on, {
    run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK }),
    git: { [ENV_FIND]: [0, './.env\0'], [LINK_FIND]: [1, ''] },
  })
  await begin($)
  expect((await $.tool.call({ tool: 'Bash', command: 'cat src/.*' })).deny).toContain('a pattern that could match one')
  expect(w.run()?.state).toBe('blocked')
})

test('guard: a Bash command without a wildcard runs no env listing', async ($, on) => {
  const w = world(on, { run: runAt({ phase: phaseAt('Test'), goalActive: true, ...LOCK }), git: { [ENV_FIND]: [0, './.env\0'] } })
  await begin($)
  await $.tool.call({ tool: 'Bash', command: 'cat src/app.ts' })
  expect(w.argv).not.toContain(ENV_FIND)
})

test("fix cap: after a raise, the rerun's goal names the new cap and the count", async ($, on) => {
  const state = { fixPushes: 3, fixCap: 3 }
  const raised = await stuckAtCap($, on, state, [TEXTS.fixCapChoiceLabel('raise cap', state)])
  await raised.clock.settle()
  expect(raised.commands.at(-1)).toBe(`goal ${goalFor('PR', ID, { fixPushes: 3, fixCap: 6 })}`)
  expect(raised.commands.at(-1)).toContain('at most 6 fix pushes in all, 3 done so far')
})

// The file column: a missing phase file is drawn subtle, like the tokens; an existing one plain; the current phase's in
// bold; a file with changes Git has not committed in the claude color, with a star after its name.
const FOLDER_STATUS = g(`status --porcelain -z --untracked-files=all -- changes/${ID}/`)

async function fileTexts($: $T, columns: number) {
  const ui = await paneAt($, columns)
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  const named = (name: string) => texts.find(found => found.text === name)?.props
  return { named, all: texts.map(found => found.text) }
}

test('pane: a missing phase file is subtle, an existing one plain, and the current phase bold', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'running', goalActive: true }),
    files: {
      [phaseFile('Intent')]: INTENT_DONE,
      [phaseFile('Spec')]: SPEC_DONE,
      [phaseFile('Plan')]: PLAN_DONE,
      [phaseFile('Build')]: '---\nphase: build\nstatus: draft\n---\n',
    },
  })
  await begin($)
  const { named } = await fileTexts($, 80)
  expect(named('test.md')).toMatchObject({ color: 'subtle' })
  expect(named('pr.md')).toMatchObject({ color: 'subtle' })
  expect(named('spec.md')?.color).toBeUndefined()
  expect(named('spec.md')?.weight).toBeUndefined()
  expect(named('build.md')).toMatchObject({ weight: 'bold' })
  expect(named('build.md')?.color).toBeUndefined()
})

test('pane: a phase file with uncommitted changes, or untracked, gets a star and the claude color; bold stays for the current phase', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Build'), state: 'running', goalActive: true }),
    files: {
      [phaseFile('Intent')]: INTENT_DONE,
      [phaseFile('Spec')]: SPEC_DONE,
      [phaseFile('Plan')]: PLAN_DONE,
      [phaseFile('Build')]: '---\nphase: build\nstatus: draft\n---\n',
    },
    git: { [FOLDER_STATUS]: [0, ` M changes/${ID}/spec.md\0?? changes/${ID}/build.md\0 M changes/${ID}/notes.txt\0`] },
  })
  await begin($)
  const { named, all } = await fileTexts($, 80)
  expect(named('spec.md*')).toMatchObject({ color: 'claude' })
  expect(named('spec.md*')?.weight).toBeUndefined()
  expect(named('build.md*')).toMatchObject({ color: 'claude', weight: 'bold' })
  expect(named('plan.md')?.color).toBeUndefined()
  expect(all).not.toContain('plan.md*')
  const rows = await paneRowTexts($, 'terminal', 80)
  expect(rows[phaseAt('Build')]).toMatch(/^Build {3}build\.md\* {2}running/)
  expect(rows[phaseAt('Plan')]).toMatch(/^Plan {4}plan\.md {4}done/)
})

test('pane: a git status that fails marks no file as changed', async ($, on) => {
  world(on, {
    run: runAt({ phase: phaseAt('Spec'), state: 'running', goalActive: true }),
    files: { [phaseFile('Intent')]: INTENT_DONE, [phaseFile('Spec')]: SPEC_DONE },
    git: { [FOLDER_STATUS]: [128, ''] },
  })
  await begin($)
  const { all } = await fileTexts($, 80)
  expect(all.some(text => text.endsWith('.md*'))).toBe(false)
})

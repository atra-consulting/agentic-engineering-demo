// The mod: wires the phase logic to the engine's events. The run lives in one atom, a module copy
// (which outlives a /clear) and changes/<id>/run.json (which outlives a restart).
import { atom, read, update } from 'claude-code'
import type { AskOptions, EngineInterface, FsEntry, ProcessRunInit, ProcessRunResult, PromptOrigin, Register, ThemeKey } from 'claude-code'
import type { BandPart, TurnClock } from './phases'
import type { Approval, FootprintLine, FootprintState, GuardLevel, LastTests, PhaseName, PhaseStatus, Run, RunState, TraceRow } from '../types'
import { REASONS, editTarget, forcedPush, isEnvFile, isJiraRead, isPushUrl, pushArgs, testRunCommand } from './guard'
import { afterDenial, announceLevel, guardAt, guardLevelOf, levelLine, startLevel, switchLevel } from './level'
import {
  DENIAL_MIN_COLUMNS,
  DROP,
  FOOTPRINT_UNAVAILABLE,
  fitPane,
  footprint,
  lastChangedLines,
  isTestRun,
  plannedPathsFrom,
  plannedToolsFrom,
  reasonText,
  safeCommand,
  safePath,
  stripControl,
  taskEndFrom,
  taskEndStatus,
  testCommandFrom,
  testEnvKeepFrom,
  testRunFrom,
  wrapParts,
  wrapText,
  type PaneLine,
  type PaneSection,
  type ReasonKey,
} from './pane'
import { describeRule, mergeAllowRules, pickedRules, ruleChoiceLabels, ruleFor, ruleLabel, segmentsOf, shouldSuggest } from './permissions'
import {
  ACTIVE_STATES,
  FILES,
  GATES,
  PHASES,
  POINTS_HEADING,
  PR_URL,
  TEXTS,
  TRACE_LINES,
  acResults,
  traceSummary,
  afterStatus,
  REQUEST_FILE_CHARS,
  approve,
  bandLine,
  bandParts,
  bandTail,
  bandText,
  changeIdFrom,
  countTurn,
  criteriaOf,
  criterionTexts,
  freeformId,
  frontMatterValue,
  goalFor,
  highRiskUnanswered,
  isActive,
  isRequestFile,
  ticketLink,
  isBranchName,
  isGate,
  isTraceShown,
  newRun,
  nextAction,
  offer,
  outOfScopeOf,
  parseArgs,
  phaseStatus,
  prNumber,
  requestFileParts,
  requestTitle,
  rerun,
  restored,
  stateColor,
  stop,
  testPathsFrom,
  traceParts,
  traceRows,
  pointCounts,
  undecidedPoints,
} from './phases'
import { USAGE_FOOTER, addTurn, compactUsage, countGoalTurn, formatUsage, modelKey, rowName } from './usage'
import { checkCommit, checkCommitMessage, checkPrBody, checkPush, patchFiles, publishKinds, scannerLine, untrackedScope } from './scan'
import type { Check, CommitPatch, GitReader, Scanner, UntrackedScope } from './scan'
import { SCANNER_APPROVED } from './shapes'
import { FIX_CAP_MAX, FIX_CAP_START, afterPush, choose, fixPushVerdict, fixStateOf, isFixCapReason, stuckChoices } from './fixpushes'
import type { FixState, StuckChoice } from './fixpushes'
import { endDraftWarning, isBodyView, isDraftView, isHeadView } from './prrecord'
import { signalsLine, testRecordSection, weakeningSignals } from './weakening'
import type { BranchFacts, ChangedPath, Signals } from './weakening'

const COMMAND = 'goal-and-do'
// The mod's plugin name, as Claude Code names it in a command's origin; the pane's ID is the same word.
const PLUGIN_NAME = 'goal-and-do'
const PANE = PLUGIN_NAME
const BUILT_FOR = '2.1.314'
// The plugin commit that still runs schema 1 runs, the ones from before the Intent phase.
const EARLIER_COMMIT = 'f7c67dd'
const EXCLUDE = '.git/info/exclude'
const RUN_JSON_LINE = 'changes/*/run.json'
const SETTINGS = { project: '.claude/settings.json', local: '.claude/settings.local.json' }
const MANAGED_KEYS = ['allowManagedHooksOnly', 'allowManagedModsOnly', 'disableAllHooks']
const IGNORED_DIRTY = [/^\.claude\/settings[^/]*\.json$/, /^changes\/[^/]+\/run\.json$/]
// What approvals.md names under Approved by: a role, never the runner's Git name (people appear as roles in the target
// repository's files).
const APPROVER = 'the person who approved'
const APPROVALS_HEADER = '# Approvals\n\n| Phase | File | SHA-256 | Approved by | Time | locked-at |\n| --- | --- | --- | --- | --- | --- |\n'

// Texts the person sees that TEXTS in phases.ts does not hold.
const NOTES = {
  version: (version: string) => `goal-and-do is built for Claude Code ${BUILT_FOR}; this is ${version}. It may not work as expected.`,
  corrupt: (path: string, error: string) => `goal-and-do skipped ${path}: ${error}`,
  runForged: (id: string) =>
    `run.json for ${id} differs from the mod's record. The run is blocked, and the guard stays on. Type \`/${COMMAND} stop\`, then start over, or \`rm -r changes/${id}\` and \`git branch -D sdd/${id}\`.`,
  earlierSchema: `This run started before the six-phase update. It is blocked, and the guard stays on. Type \`/${COMMAND} stop\`, or install \`${EARLIER_COMMIT}\` to finish it.`,
  storeFailed: 'goal-and-do could not write its store; the run did not start.',
  levelMismatch: (id: string) =>
    `The guard level of ${id} in run.json is review, but the mod's record does not say so. The run is restored at the strict level. Type \`/${COMMAND} level review\` to switch.`,
  goalRefused: (phase: PhaseName, error: string) => `goal-and-do could not start the ${phase} goal (${error}). Paste the /goal line from the transcript.`,
  testsChanged: 'the acceptance tests changed since Plan approval',
  excludeFailed: (path: string, error: string) => `goal-and-do started nothing: it could not add ${RUN_JSON_LINE} to ${path} (${error}).`,
  noLock: 'goal-and-do did not approve Plan: git rev-parse HEAD failed, so the acceptance tests cannot be locked.',
  pushChosenNot: 'you chose not to push yet',
  fixCountUnreadable: "goal-and-do blocks the push: git could not list the commits it would send, so the fix push cap can't be checked.",
  fixHeadMoved: (id: string) =>
    `goal-and-do blocks the push: HEAD is not the branch sdd/${id}, so the commits it would send are not the ones the fix push cap counts.`,
  pushDenied: 'goal-and-do: you chose not to push yet.',
  pushLocked: 'goal-and-do blocks the push: the acceptance tests changed since Plan approval.',
  approvedChanged: (file: string) => `goal-and-do blocks the push: ${file} changed since its approval.`,
  approvalsDiffer: "goal-and-do blocks the push: approvals.md differs from the mod's record.",
  pushUrlMissing: 'goal-and-do blocks the push: it has no recorded push URL for origin.',
  gitSettingsChanged: "goal-and-do blocks the run: Git's config, hooks or attributes changed since the run started.",
  pushSettingsChanged: "goal-and-do: Git's settings changed during the push; check the pushed branch.",
  openPoints: (count: number) => `${count} open point${count === 1 ? '' : 's'}`,
  guardFailed: 'goal-and-do: the guard failed, so the call is blocked. See the debug log.',
  noSuggestions: 'No rules to suggest yet.',
  noReason: 'no reason given',
  settingsLeft: (file: string, error: string) => `${file} was left unchanged. ${error}`,
  rulesAdded: (file: string, rules: string[]) => `Added to ${file}: ${rules.join(', ')}.`,
  openInApp: (file: string) => `Open ${file} in app`,
  prBodyMissing: (path: string) => `goal-and-do: ${path} does not exist yet, so there is no PR body to open.`,
  openFailed: (path: string) => `goal-and-do could not open ${path}. Open it from there.`,
  relockNoHead: 'goal-and-do did not re-lock: git rev-parse HEAD failed.',
  relockUnreadable: 'goal-and-do cannot list the changed tests (git failed), so it offers no re-lock.',
  relockMoved: 'goal-and-do: the tests changed while the dialog was open; review them again.',
  planChanged: 'goal-and-do: plan.md changed since its approval; it needs the Plan gate again.',
  acceptedDone: (file: string) => `goal-and-do: ${file} says status: done now, so the phase counts as done and the run goes on.`,
  changedWhileOpen: (path: string) => `goal-and-do: ${path} changed while the gate was open; review it again.`,
  walkRefused: (error: string) => `goal-and-do could not send the open-points prompt (${error}). Paste it from the transcript.`,
  statusFailed: "goal-and-do could not read the run's status. Try again.",
  statusShort: (id: string) => `${id}: tokens (input plus output), goal turns and active minutes per phase`,
  statusFull: `Type /${COMMAND} status for the full table.`,
  commandFailed: (kind: string) => `goal-and-do could not run /${COMMAND} ${kind}. Try again.`,
}

// The lock of Plan approval, with plan.md's planned-paths and test-command as approved beside it.
type Lock = { lockedAt: string; lockedFiles: Record<string, string>; testPaths: string[] } & PlanFields

interface PlanFields {
  plannedPaths?: string[]
  testCommand?: string
  plannedTools?: string[]
  testEnvKeep?: string[]
}

// plan.md's four fields, each only when it holds something.
function planFieldsOf(fields: PlanFields): PlanFields {
  const { plannedPaths, testCommand, plannedTools, testEnvKeep } = fields
  return {
    ...(Array.isArray(plannedPaths) && plannedPaths.length > 0 ? { plannedPaths } : {}),
    ...(typeof testCommand === 'string' && testCommand !== '' ? { testCommand } : {}),
    ...(Array.isArray(plannedTools) && plannedTools.length > 0 ? { plannedTools } : {}),
    ...(Array.isArray(testEnvKeep) && testEnvKeep.length > 0 ? { testEnvKeep } : {}),
  }
}

interface Outcome {
  action: string
  text?: string
}

const lockKey = (id: string) => `lock:${id}`

const approvalsKey = (id: string) => `approvals:${id}`

// The mod's record of a run's guard level, beside its approvals record: a restore takes review only when run.json and this
// record both say so.
const levelKey = (id: string) => `level:${id}`

// The mod's record of a run's Git settings: their fingerprint and origin's push URL, as the run's start read them.
const gitSettingsKey = (id: string) => `gitSettings:${id}`

interface GitRecord {
  fingerprint: string
  pushUrl?: unknown
}

// An approval row as the mod's store keeps it: who approved it, and the note approvals.md shows after its file.
type StoredRow = Approval & { by: string; note?: string }

// The mod's record of a run's approvals, the authority over run.json's copy: every row, and the index of the last gate
// a person approved past (-1 for none).
interface ApprovalRecord {
  approvedPast: number
  rows: StoredRow[]
}

const runAtom = atom({ plugin: 'goal-and-do', key: 'run' } as const, null)
// The trace chain's rows: the pane reads only this.
const traceAtom = atom({ plugin: 'goal-and-do', key: 'trace' } as const, [])
// The changed files since the change branched off, as git said at the last refresh.
const footprintAtom = atom({ plugin: 'goal-and-do', key: 'footprint' } as const, null)
// The current goal turn's start and its tool calls; never in run.json.
const turnAtom = atom({ plugin: 'goal-and-do', key: 'turn' } as const, null)
// Whether a main-loop turn runs: at a gate or a stuck state it is the person's own request, so the band and the phase
// table say working, not waiting. In memory only.
const busyAtom = atom({ plugin: 'goal-and-do', key: 'busy' } as const, false)
// How many dialogs are open: the mod's own and the AskUserQuestion calls of Claude. A dialog hides the band, so the
// pane shows the band's tail while the count is above 0. Never in run.json.
const dialogsAtom = atom({ plugin: 'goal-and-do', key: 'dialogs' } as const, 0)
// The pane's sections the person folded or opened, by their ID; never in run.json.
const foldsAtom = atom({ plugin: 'goal-and-do', key: 'folds' } as const, {})
// The text of each criterion the trace chain names, read with the chain.
const criteriaAtom = atom({ plugin: 'goal-and-do', key: 'criteria' } as const, {})
// The criteria the person opened in the trace chain, each as "<chain line's ID> <criterion's ID>"; never in run.json.
const openedAtom = atom({ plugin: 'goal-and-do', key: 'opened' } as const, [])

let copy: Run | null = null
let turnRunning = false
let lastReason: string | undefined
let allowedPush: string | undefined
// The subjects of the commits the allowed push sends, for the count of fix pushes once the push went through.
let pushSubjects: string[] | undefined
// The project root, absolute: every file and git call goes there, since a shell cd moves the session's working directory.
let root = ''
// The main loop's last Stop of the run's goal came with background work in flight (a background agent): the turn
// ends to wait for it, and the goal goes on with the turn its finish wakes.
let isWaitingOnBackground = false
// The run's Intent gate: the criteria its first dialog showed, and the questions of the walk-through since the last
// pick, counted until the gate's dialog opens again.
let intentGate: IntentGate | undefined
// The active run whose run.json the mod refused at restore, and the toast that said so. It stays blocked with the guard
// on until stop ends it, and its run.json stays as it was found.
let refused: { id: string; text: string } | undefined
// The changed files: the last value (which outlives a /clear), when git last ran for them, and whether a refresh waits.
let footprintCopy: FootprintState | null = null
let footprintAt: number | undefined
// When the refresh that waits for the end of the 10 seconds is due; undefined while none waits.
let footprintDueAt: number | undefined
// The settings files the mod's rule dialog wrote in this session.
const learnedFiles = new Set<string>()
// The folds and the opened criteria. These module values hold them, so they outlive any /clear; the pane draws from
// them, and their atoms only make it draw again when they change.
let foldsCopy: Record<string, boolean> = {}
let openedCopy: string[] = []
// The trace chain and its criteria's texts as last read, for the pane after a /clear the person types emptied the atoms.
let traceCopy: TraceRow[] = []
let criteriaCopy: Record<string, string[]> = {}
// The walk-through the mod sent from a dialog: the run, phase and state it left, the prompt's text, and the main-loop
// turn that prompt started, once a turn starts with that text. A prompt of the person's ends it, and so does the dialog
// when it opens again.
let walk: Walk | undefined
// How often the gate or stuck dialog has opened, so a reopen that waited knows whether one opened meanwhile.
let dialogOpens = 0
// How often the status command's text was made, so the mod's own status run at the finish knows whether its hook answered.
let statusAnswers = 0

interface Walk {
  id: string
  phase: PhaseName
  state: RunState
  text: string
  turnId?: string
}

interface WalkCounts {
  answered: number
  skipped: number
  timedOut: number
}

interface IntentGate {
  id: string
  criteria: { id: string; line: string }[]
  counts: WalkCounts
  isWalking: boolean
}

// Run state

function phaseOf(run: Run): PhaseName {
  return PHASES[run.phase] ?? PHASES[0]
}

function rowOf(run: Run): string {
  const phase = phaseOf(run)
  return rowName(phase, run.state, run.reruns[phase] ?? 0)
}

// A goal's tokens arrive with its one main-loop turn.complete, after a cap or a refused push may have
// moved the state: while the goal is set they stay on the phase's own row.
function usageRowOf(run: Run): string {
  const phase = phaseOf(run)
  return run.goalActive ? rowName(phase, 'running', run.reruns[phase] ?? 0) : rowOf(run)
}

const FINISHED_STATUS = /^(?:completed|failed|killed|cancelled|canceled|stopped|error|done)/i

// Background work the goal waits for: an agent, a workflow or a shell command (a test suite) still going. A monitor
// never holds the goal open.
function isGoalWork(task: { type: string; status: string }): boolean {
  return ['subagent', 'workflow', 'shell'].includes(task.type) && !FINISHED_STATUS.test(task.status)
}

function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// An error's name only: its message can hold a command or a path.
function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

// The debug log is best effort: a log that fails never stops what logs.
function debug($: EngineInterface, line: string): void {
  try {
    $.ui.log(`goal-and-do: ${line}`, { to: 'debug' })
  } catch {
    return
  }
}

// Work a hook starts and doesn't wait for. A failure goes to the debug log, never to an unhandled rejection: once a
// session or a test ends, the engine refuses every call, and a rejection nothing handles fails the test file.
function background($: EngineInterface, label: string, work: Promise<unknown>): void {
  work.catch((error: unknown) => {
    debug($, `${label}: ${nameOf(error)}`)
  })
}

async function refreshRoot($: EngineInterface): Promise<void> {
  root = (await $.session.root().catch(() => root)).replace(/\/+$/, '')
}

async function projectRoot($: EngineInterface): Promise<string> {
  if (root === '') await refreshRoot($)
  return root
}

// A path of the project, absolute under the root; an absolute path stays as it is.
async function at($: EngineInterface, path: string): Promise<string> {
  if (path.startsWith('/')) return path
  const base = await projectRoot($)
  return base === '' ? path : `${base}/${path.replace(/^(?:\.\/)+/, '')}`
}

// The questions of the mod's own open dialogs. A dialog another of its hooks opens reaches its tool.call hook as an
// AskUserQuestion call.
const ownQuestions = new Map<string, number>()

// One more or one fewer open dialog; the count stays 0 or more. Whether the write went through comes back, and a write that
// fails never stops the dialog.
async function countDialog($: EngineInterface, step: 1 | -1): Promise<boolean> {
  try {
    await update($, dialogsAtom, count => Math.max(0, (count ?? 0) + step))
    return true
  } catch (error) {
    debug($, `dialog not counted: ${nameOf(error)}`)
    return false
  }
}

// Runs a dialog and counts it open until it resolves or rejects. Called from a hook, never from a render hook.
async function whileDialogOpen<T>($: EngineInterface, open: () => Promise<T>): Promise<T> {
  const isCounted = await countDialog($, 1)
  try {
    return await open()
  } finally {
    if (isCounted) await countDialog($, -1)
  }
}

// The answers the mod's open dialogs wait for.
const openAsks = new Set<Promise<string>>()

async function askPerson($: EngineInterface, question: string, options: AskOptions): Promise<string> {
  return trackAsk($, question, () => $.ui.ask(question, options))
}

interface Choice {
  label: string
  description: string
}

// The mod's open dialogs whose options carry descriptions, each under the ID the mod gave it when it opened it: its
// question, its labels in order, and each label's description. $.ui.ask takes labels only, so the mod's ui.render hook on
// the AskUserQuestion dialog adds the descriptions to the dialog that has the same question and labels.
const choiceDialogs = new Map<number, { question: string; labels: string[]; texts: Record<string, string> }>()
let choiceIds = 0

// A question whose options carry a description each. It answers as $.ui.ask does.
async function askChoices($: EngineInterface, question: string, ask: { header: string; options: Choice[]; multiSelect: boolean }): Promise<string> {
  const id = ++choiceIds
  const labels = ask.options.map(option => option.label)
  choiceDialogs.set(id, { question, labels, texts: Object.fromEntries(ask.options.map(option => [option.label, option.description])) })
  try {
    return await askPerson($, question, { options: labels, header: ask.header, ...(ask.multiSelect ? { multiSelect: true as const } : {}) })
  } finally {
    choiceDialogs.delete(id)
  }
}

// The descriptions of the open dialog of the mod's that a drawn question is: the same question and the same labels.
function choiceTextsOf(item: unknown): Record<string, string> | undefined {
  const asked = item as { question?: unknown; options?: unknown } | null
  if (typeof asked?.question !== 'string' || !Array.isArray(asked.options)) return undefined
  const labels = asked.options.map(option => String((option as { label?: unknown } | null)?.label ?? ''))
  for (const dialog of choiceDialogs.values()) {
    const isSame = dialog.question === asked.question && dialog.labels.length === labels.length && dialog.labels.every((label, i) => label === labels[i])
    if (isSame) return dialog.texts
  }
  return undefined
}

// The questions of an AskUserQuestion call with the descriptions of the mod's own options added.
function withChoiceTexts(questions: readonly unknown[]): unknown[] {
  return questions.map(item => {
    const asked = item as { question?: unknown; options?: unknown } | null
    const texts = choiceTextsOf(item)
    if (texts === undefined || !Array.isArray(asked?.options)) return item
    const options = asked.options.map(option => {
      const label = (option as { label?: unknown } | null)?.label
      const description = typeof label === 'string' ? texts[label] : undefined
      return description === undefined ? option : { ...(option as object), description }
    })
    return { ...asked, options }
  })
}

// Counts a dialog of the mod's open while it waits, and knows its question as the mod's own.
async function trackAsk($: EngineInterface, question: string, open: () => Promise<string>): Promise<string> {
  ownQuestions.set(question, (ownQuestions.get(question) ?? 0) + 1)
  const asked = whileDialogOpen($, open)
  openAsks.add(asked)
  try {
    return await asked
  } finally {
    openAsks.delete(asked)
    const open = (ownQuestions.get(question) ?? 1) - 1
    if (open > 0) ownQuestions.set(question, open)
    else ownQuestions.delete(question)
  }
}

async function readFile($: EngineInterface, path: string): Promise<string> {
  return $.fs.read(await at($, path))
}

async function writeFile($: EngineInterface, path: string, text: string): Promise<void> {
  return $.fs.write(await at($, path), text)
}

async function listDir($: EngineInterface, path: string): Promise<FsEntry[]> {
  return $.fs.list(await at($, path))
}

async function fileExists($: EngineInterface, path: string): Promise<boolean> {
  return $.fs.exists(await at($, path))
}

async function current($: EngineInterface): Promise<Run | null> {
  return (await read($, runAtom)) ?? copy
}

// run.json has one writer: the writes go one after another, and each writes the mod's copy of the run as it is when the
// write starts, so a late write never carries an older state over a newer one.
let runWrites: Promise<void> = Promise.resolve()

function saveRun($: EngineInterface, run: Run): Promise<void> {
  const write = runWrites
    .then(() => writeRunFile($, run))
    .catch(error => {
      debug($, `run.json not written: ${nameOf(error)}`)
    })
  runWrites = write
  return write
}

async function writeRunFile($: EngineInterface, run: Run): Promise<void> {
  const latest = copy !== null && copy.id === run.id ? copy : run
  if (isRefused(latest)) return
  await writeFile($, `changes/${latest.id}/run.json`, `${JSON.stringify(latest, null, 2)}\n`)
}

function isRefused(run: Run | null): boolean {
  return run !== null && isActive(run) && refused?.id === run.id
}

async function change($: EngineInterface, fn: (run: Run) => Run): Promise<Run | null> {
  const next = await update($, runAtom, value => {
    const base = value ?? copy
    return base === null ? null : fn(base)
  })
  if (next === null) return null
  copy = next
  await saveRun($, next)
  return next
}

async function put($: EngineInterface, run: Run): Promise<void> {
  copy = run
  await update($, runAtom, () => run)
  await saveRun($, run)
}

// After /clear the atoms are empty: the module copy goes back in, and the chain is read again.
async function writeBack($: EngineInterface): Promise<void> {
  await update($, runAtom, value => value ?? copy)
  if (copy !== null) await keepTrace($, copy)
  if (footprintCopy !== null)
    await update($, footprintAtom, value => value ?? footprintCopy).catch(error => {
      debug($, `changed files not kept: ${nameOf(error)}`)
    })
}

// The chain of intent.md, spec.md and test.md as they are now, kept in the atom; the rows come back for the caller.
// The text of each criterion goes beside it, so the pane reads no file when it opens one.
async function keepTrace($: EngineInterface, run: Run): Promise<TraceRow[]> {
  const text = async (phase: PhaseName) => readFile($, phasePath(run, phase)).catch(() => '')
  const intent = await text('Intent')
  const spec = await text('Spec')
  const rows = traceRows(intent, spec, await text('Test'))
  const texts = criterionTexts(intent, spec)
  traceCopy = rows
  criteriaCopy = texts
  await update($, traceAtom, () => rows).catch(error => {
    debug($, `trace not kept: ${why(error)}`)
  })
  await update($, criteriaAtom, () => texts).catch(() => {
    debug($, 'criteria not kept')
  })
  return rows
}

function parseRun(text: string): Run | string {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return why(error)
  }
  const run = value as Partial<Run> | null
  const isRun =
    typeof run === 'object' &&
    run !== null &&
    run.schema === 2 &&
    typeof run.id === 'string' &&
    typeof run.phase === 'number' &&
    Number.isInteger(run.phase) &&
    run.phase >= 0 &&
    run.phase < PHASES.length &&
    typeof run.state === 'string' &&
    typeof run.startedAt === 'number' &&
    typeof run.usage === 'object' &&
    Array.isArray(run.suggested) &&
    Array.isArray(run.offered) &&
    Array.isArray(run.approvals) &&
    run.approvals.every(row => typeof row === 'object' && row !== null && typeof (row as { phase?: unknown }).phase === 'string')
  if (!isRun) return 'not a run of schema 2'
  const found = run as Run
  if (found.deniedCount !== undefined && !(Number.isInteger(found.deniedCount) && found.deniedCount >= 0)) delete found.deniedCount
  // Only the exact value 'review' restores as review; no field or any other value restores as strict.
  found.guardLevel = guardLevelOf(found)
  if (!Array.isArray(found.deniedCalls)) delete found.deniedCalls
  if (!Array.isArray(found.levelChanges)) delete found.levelChanges
  // A run.json without the fix push count and cap, or with a value they can't hold, loads with the start values.
  if (!Number.isInteger(found.fixPushes) || found.fixPushes < 0) found.fixPushes = 0
  if (!Number.isInteger(found.fixCap) || found.fixCap < FIX_CAP_START || found.fixCap > FIX_CAP_MAX) found.fixCap = FIX_CAP_START
  return unsafeField(found) ?? found
}

// A run without what a restore never takes from run.json: the denials, the last test run and lock check, which the
// mod records only for the pane, and plan.md's four fields, which come from the store beside the lock.
function withoutRecords(run: Run): Run {
  const {
    denials: _denials,
    lastTests: _tests,
    lastLockCheck: _check,
    plannedPaths: _paths,
    testCommand: _command,
    plannedTools: _tools,
    testEnvKeep: _keep,
    ...kept
  } = run
  return kept
}

// A run.json of schema 1 (from before the Intent phase); undefined for any other file.
function earlierRun(text: string): Record<string, unknown> | undefined {
  try {
    const run = JSON.parse(text) as Record<string, unknown> | null
    return typeof run === 'object' && run !== null && !Array.isArray(run) && run.schema === 1 ? run : undefined
  } catch {
    return undefined
  }
}

// A schema 1 run as a run of schema 2 at Intent, with no approvals; run.json keeps the schema 1 text.
function fromEarlier(id: string, earlier: Record<string, unknown>): Run {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const startedAt = earlier.startedAt
  return newRun({
    id,
    input: text(earlier.input),
    source: earlier.source === 'jira' ? 'jira' : 'freeform',
    base: text(earlier.base),
    now: typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : 0,
    env: { claudeCode: 'unknown', plugin: 'unknown', provider: 'unknown', permissionMode: 'default' },
  })
}

const CHANGE_ID = /^(?:[A-Z][A-Z0-9]+-\d+|CH-\d{8}-[a-z0-9-]+)$/
const COMMIT = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/

// A path the mod hands to git or reads: relative, inside the repo, never read as an option.
function isSafePath(path: unknown): boolean {
  if (typeof path !== 'string' || path === '' || path.startsWith('-')) return false
  if (path.startsWith('/') || path.startsWith('\\') || path.startsWith('~') || /^[A-Za-z]:/.test(path)) return false
  return !path.split(/[/\\]/).includes('..')
}

// run.json can be written through Bash, so the fields the mod passes to git or to the file system are checked.
function unsafeField(run: Run): string | undefined {
  if (!CHANGE_ID.test(run.id)) return 'its id is no change ID'
  if (run.lockedAt !== undefined && (typeof run.lockedAt !== 'string' || !COMMIT.test(run.lockedAt))) {
    return 'its lockedAt is no commit'
  }
  const testPaths: unknown = run.testPaths ?? []
  if (!Array.isArray(testPaths) || !testPaths.every(isSafePath)) return 'a test path is not a path inside the repo'
  const lockedFiles: unknown = run.lockedFiles ?? {}
  if (typeof lockedFiles !== 'object' || lockedFiles === null || !Object.keys(lockedFiles).every(isSafePath)) {
    return 'a locked file is not a path inside the repo'
  }
  return undefined
}

type StoredLock = { lockedAt: string; lockedFiles: Record<string, string>; testPaths?: string[] } & PlanFields

function storedLock(value: unknown): StoredLock | undefined {
  const lock = value as
    | {
        lockedAt?: unknown
        lockedFiles?: unknown
        testPaths?: unknown
        plannedPaths?: unknown
        testCommand?: unknown
        plannedTools?: unknown
        testEnvKeep?: unknown
      }
    | null
    | undefined
  if (typeof lock !== 'object' || lock === null || typeof lock.lockedAt !== 'string') return undefined
  if (typeof lock.lockedFiles !== 'object' || lock.lockedFiles === null) return undefined
  const found: StoredLock = { lockedAt: lock.lockedAt, lockedFiles: lock.lockedFiles as Record<string, string> }
  const isPaths = (paths: unknown): paths is string[] => Array.isArray(paths) && paths.every(path => typeof path === 'string')
  if (isPaths(lock.testPaths)) found.testPaths = lock.testPaths
  if (isPaths(lock.plannedPaths) && lock.plannedPaths.length > 0) found.plannedPaths = lock.plannedPaths
  if (typeof lock.testCommand === 'string' && lock.testCommand !== '') found.testCommand = lock.testCommand
  if (isPaths(lock.plannedTools) && lock.plannedTools.length > 0) found.plannedTools = lock.plannedTools
  if (isPaths(lock.testEnvKeep) && lock.testEnvKeep.length > 0) found.testEnvKeep = lock.testEnvKeep
  return found
}

// A stored lock without testPaths compares the commit and the files alone.
function sameLock(stored: StoredLock, run: Run): boolean {
  const entries = (files: Record<string, string>) => JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
  const samePaths = stored.testPaths === undefined || JSON.stringify(stored.testPaths) === JSON.stringify(run.testPaths ?? [])
  return stored.lockedAt === run.lockedAt && entries(stored.lockedFiles) === entries(run.lockedFiles ?? {}) && samePaths
}

function isStoredRow(value: unknown): value is StoredRow {
  const row = value as Partial<StoredRow> | null
  return (
    typeof row === 'object' &&
    row !== null &&
    PHASES.some(phase => phase === row.phase) &&
    typeof row.file === 'string' &&
    typeof row.sha256 === 'string' &&
    typeof row.at === 'number' &&
    typeof row.by === 'string' &&
    (row.lockedAt === undefined || typeof row.lockedAt === 'string') &&
    (row.kind === undefined || row.kind === 'relock') &&
    (row.note === undefined || typeof row.note === 'string')
  )
}

function storedApprovals(value: unknown): ApprovalRecord | undefined {
  const record = value as { approvedPast?: unknown; rows?: unknown } | null | undefined
  if (typeof record !== 'object' || record === null || typeof record.approvedPast !== 'number') return undefined
  if (!Array.isArray(record.rows) || !record.rows.every(isStoredRow)) return undefined
  return { approvedPast: record.approvedPast, rows: record.rows }
}

async function readRecord($: EngineInterface, id: string): Promise<ApprovalRecord | undefined> {
  return storedApprovals(await $.store.get(approvalsKey(id)).catch(() => undefined))
}

function approvalOf({ by: _by, note: _note, ...row }: StoredRow): Approval {
  return row
}

// Rows match in their phase, file, SHA-256, lock commit and kind, one for one.
function sameApprovals(approvals: Approval[], rows: StoredRow[]): boolean {
  const key = (row: Approval) => JSON.stringify([row.phase, row.file, row.sha256, row.lockedAt ?? null, row.kind ?? null])
  return approvals.length === rows.length && approvals.every((row, i) => rows[i] !== undefined && key(row) === key(rows[i]))
}

// A run may sit at a phase only when every gate before it has an approval row in the record, and the record was
// approved past the last of them.
function allowsPhase(record: ApprovalRecord, phase: number): boolean {
  const gates = PHASES.slice(0, phase).filter(name => GATES.has(name))
  const isApproved = (gate: PhaseName) => record.rows.some(row => row.phase === gate && row.kind !== 'relock')
  const last = gates.at(-1)
  return gates.every(isApproved) && (last === undefined || PHASES.indexOf(last) <= record.approvedPast)
}

// The furthest phase a record's approvals allow a refused run: Intent with no record, never past Build, since no
// approval vouches that Build or Test finished.
function allowedPhase(record: ApprovalRecord | undefined): number {
  let phase = 0
  if (record === undefined) return phase
  for (let index = 1; index <= PHASES.indexOf('Build'); index++) if (allowsPhase(record, index)) phase = index
  return phase
}

// A refused run as the mod keeps it: blocked for the refusal, at the phase and with the approvals the record allows,
// the stored lock in place when there is one, and nothing from run.json that would let it go on.
function refusedRun(run: Run, record: ApprovalRecord | undefined, stored: StoredLock | undefined, reason: string): Run {
  return {
    ...run,
    ...stored,
    phase: allowedPhase(record),
    approvals: record?.rows.map(approvalOf) ?? [],
    state: 'blocked',
    reason,
    goalActive: false,
    pendingGoal: false,
    pendingClear: false,
    pushApproved: false,
    prUrl: undefined,
    candidates: {},
    suggested: [],
  }
}

// approvals.md as the mod writes it from its record, whole.
function approvalsText(rows: StoredRow[]): string {
  const line = (row: StoredRow) => {
    const file = row.note === undefined ? row.file : `${row.file} (${row.note})`
    const cells = [row.phase, file, row.sha256, row.by, new Date(row.at).toISOString(), row.lockedAt ?? '']
    return `| ${cells.map(cell => cell.replace(/\|/g, '\\|')).join(' | ')} |\n`
  }
  return APPROVALS_HEADER + rows.map(line).join('')
}

// The draft PR's URL from pr.md's pr-url, when it is one.
async function prUrlOf($: EngineInterface, run: Run): Promise<string | undefined> {
  const pr = await readFile($, phasePath(run, 'PR')).catch(() => '')
  const url = frontMatterValue(pr, 'pr-url') ?? ''
  return PR_URL.test(url) ? url : undefined
}

async function restore($: EngineInterface): Promise<void> {
  refused = undefined
  const entries = await listDir($, 'changes').catch(() => [])
  let best: Run | undefined
  let isBestEarlier = false
  for (const entry of entries) {
    if (entry.kind !== 'dir') continue
    const path = `changes/${entry.name}/run.json`
    const text = await readFile($, path).catch(() => undefined)
    if (text === undefined) continue
    const earlier = earlierRun(text)
    if (earlier !== undefined && !ACTIVE_STATES.some(state => state === earlier.state)) continue
    if (earlier !== undefined && !CHANGE_ID.test(entry.name)) {
      $.ui.toast(NOTES.corrupt(path, 'its folder name is no change ID'))
      continue
    }
    const parsed = earlier === undefined ? parseRun(text) : fromEarlier(entry.name, earlier)
    const run = typeof parsed !== 'string' && parsed.id !== entry.name ? 'its id is not its folder name' : parsed
    if (typeof run === 'string') {
      $.ui.toast(NOTES.corrupt(path, run))
      continue
    }
    if (earlier === undefined && !isActive(run)) continue
    if (best === undefined || run.startedAt > best.startedAt) {
      best = run
      isBestEarlier = earlier !== undefined
    }
  }
  if (best === undefined) return
  best = withoutRecords(best)
  // run.json can be written through Bash, so a run is at review only when the mod's own record says review as well; any
  // other pair restores as strict.
  const storedLevel = isBestEarlier ? undefined : await $.store.get(levelKey(best.id)).catch(() => undefined)
  const isReview = guardLevelOf(best) === 'review'
  const isLevelKept = isReview && storedLevel === 'review'
  if (isReview && !isLevelKept) $.ui.toast(NOTES.levelMismatch(best.id))
  best = { ...best, guardLevel: isLevelKept ? 'review' : 'strict' }
  // run.json can be written through Bash, so the mod's record in its store decides: a run of schema 1, a run whose phase
  // its approvals don't allow, whose approvals differ from the record's rows, or that has no record is refused. It
  // stays blocked with the guard on until stop ends it. For the rest the approvals come from the record, the rest from
  // run.json, and an approved push, the suggested rules and the candidates are not taken over; plan.md's two fields come
  // from the stored lock, and the denials, the last test run and the last lock check not at all. A lock that differs
  // from the one stored at Plan approval blocks the run with the stored lock back in place; a run past Plan with no
  // stored lock is blocked too. A start writes an empty record and deletes the stored lock of its ID, so nothing is left
  // from an earlier run.
  const record = isBestEarlier ? undefined : await readRecord($, best.id)
  const stored = isBestEarlier ? undefined : storedLock(await $.store.get(lockKey(best.id)).catch(() => undefined))
  if (isBestEarlier || record === undefined || !allowsPhase(record, best.phase) || !sameApprovals(best.approvals, record.rows)) {
    const text = isBestEarlier ? NOTES.earlierSchema : NOTES.runForged(best.id)
    refused = { id: best.id, text }
    await put($, refusedRun(best, record, stored, text))
    $.ui.toast(text)
    return
  }
  const back: Run = {
    ...restored(best),
    ...planFieldsOf(stored ?? {}),
    approvals: record.rows.map(approvalOf),
    pushApproved: false,
    candidates: {},
    suggested: [],
  }
  back.prUrl = PR_URL.test(best.prUrl ?? '') ? best.prUrl : await prUrlOf($, best)
  const isPastPlan = best.phase > PHASES.indexOf('Plan') || best.approvals.some(approval => approval.phase === 'Plan')
  const blocked = { state: 'blocked' as const, reason: NOTES.testsChanged, goalActive: false, pendingGoal: false }
  if (stored !== undefined) await put($, sameLock(stored, best) ? back : { ...back, ...stored, ...blocked })
  else await put($, isPastPlan ? { ...back, ...blocked } : back)
  await keepTrace($, back)
  openPane($)
}

// Opens the run's pane. Claude Code may keep it undrawn (on a narrow terminal, for an open the person didn't ask for); the
// debug log says so, and the person's next status or next command opens it again.
function openPane($: EngineInterface): void {
  $.ui.open({ id: PANE, title: PANE }).then(
    opened => {
      if (!opened.isPlaced) debug($, 'pane: not placed')
    },
    error => {
      debug($, `pane: not opened: ${nameOf(error)}`)
    }
  )
  refreshFootprint($)
}

// Host commands and files

// Options on every git call of the mod: no fsmonitor hook, no untracked cache, no external diff and no pager. A diff
// also leaves out external diff and textconv drivers, and a diff or a status doesn't read a submodule's working tree
// (--ignore-submodules=dirty), whose own filters would run there; a submodule's recorded commit still counts. sh() also
// sets GIT_CONFIG_NOSYSTEM=1 in each git call's environment, so git reads no system config. These options cover the
// config keys that run a program; the filters a diff or a status could run from the repository's config are covered by
// filterOptions, and gitSettings fingerprints the rest.
const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'diff.external=', '--no-pager']

const FILTER_NAME = /^[A-Za-z0-9._-]+$/

// git-lfs as git lfs install --local writes it: the one filter of the repository's own config left on, since without it
// every LFS file reads as changed. Any other value or key for its name there turns it off like any other filter; the
// same value at both local and worktree scope does not.
const LFS_FILTER: Readonly<Record<string, string>> = {
  clean: 'git-lfs clean -- %f',
  smudge: 'git-lfs smudge -- %f',
  process: 'git-lfs filter-process',
}

function isLfsFilter(settings: { variable: string; value: string | undefined }[]): boolean {
  const seen = new Set<string>()
  for (const { variable, value } of settings) {
    if (variable === 'required') continue
    if (LFS_FILTER[variable] === undefined || value !== LFS_FILTER[variable]) return false
    seen.add(variable)
  }
  return seen.has('clean') && seen.has('smudge')
}

// The options that keep each filter the repository defines (at local or worktree scope) from running its programs in
// a call that reads the working tree: clean, smudge and process empty, and the filter not required. A name the
// repository defines is switched off even when another scope defines it too. A filter only of the user's own (global
// scope) or of the command line runs as it would for the person, and gitSettings fingerprints it, so one planted there
// blocks the run at the next gate; git-lfs as installed in the repository runs too, so the mod sees the tree as git
// does. undefined, so the call doesn't run, when the filters can't be read in 5 seconds or a name is not a plain one.
async function filterOptions($: EngineInterface): Promise<string[] | undefined> {
  const found = await sh($, ['git', 'config', '--show-scope', '-z', '--get-regexp', '^filter\\.'], GIT_TIMEOUT_MS)
  if (found === undefined || (found.exitCode !== 0 && found.exitCode !== 1)) return undefined
  if (found.exitCode === 1) return []
  const fields = found.stdout.split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 2 !== 0) return undefined
  const filters = new Map<string, { variable: string; value: string | undefined }[]>()
  for (let i = 0; i < fields.length; i += 2) {
    const scope = fields[i] ?? ''
    const entry = fields[i + 1] ?? ''
    const at = entry.indexOf('\n')
    const key = at < 0 ? entry : entry.slice(0, at)
    if (scope !== 'local' && scope !== 'worktree') continue
    const dot = key.lastIndexOf('.')
    const name = key.slice('filter.'.length, dot)
    if (!key.startsWith('filter.') || name === '') continue
    if (!FILTER_NAME.test(name)) return undefined
    filters.set(name, [...(filters.get(name) ?? []), { variable: key.slice(dot + 1), value: at < 0 ? undefined : entry.slice(at + 1) }])
  }
  return [...filters]
    .filter(([name, settings]) => !(name === 'lfs' && isLfsFilter(settings)))
    .flatMap(([name]) => ['clean=', 'smudge=', 'process=', 'required=false'].flatMap(setting => ['-c', `filter.${name}.${setting}`]))
}

// withSystem: git reads the system config too, for the fingerprint's list alone.
async function sh($: EngineInterface, argv: string[], timeoutMs?: number, withSystem = false): Promise<ProcessRunResult | undefined> {
  const cwd = await projectRoot($)
  const [command = '', sub, ...rest] = argv
  const isGit = command === 'git'
  const filters = isGit && (sub === 'diff' || sub === 'status') ? await filterOptions($) : []
  if (filters === undefined) return undefined
  const args = !isGit
    ? argv
    : sub === 'diff'
      ? [command, ...GIT_SAFE, ...filters, 'diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=dirty', ...rest]
      : sub === 'status'
        ? [command, ...GIT_SAFE, ...filters, 'status', '--ignore-submodules=dirty', ...rest]
        : [command, ...GIT_SAFE, ...filters, ...argv.slice(1)]
  const init: ProcessRunInit = {
    ...(cwd === '' ? {} : { cwd }),
    ...(isGit && !withSystem ? { env: { GIT_CONFIG_NOSYSTEM: '1' } } : {}),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  }
  return $.process.run(args, Object.keys(init).length === 0 ? undefined : init).catch(() => undefined)
}

// The config keys git and gh write themselves during a run, as git reports them: branch tracking and gh's merge base
// (branch.*), a remote's fetch refspecs, and the version git-lfs writes on its first use. The fingerprint leaves them
// out, and gh's resolved remote when it is base (GH_RESOLVED_BASE); every other entry counts, since any other value of
// gh-resolved points gh at another repository.
const GIT_WRITTEN_KEY = /^(?:branch\..+|remote\..+\.fetch|lfs\.repositoryformatversion)$/i

const GH_RESOLVED = /^remote\..+\.gh-resolved$/i

function isWrittenEntry(key: string, value: string | undefined): boolean {
  return GIT_WRITTEN_KEY.test(key) || (GH_RESOLVED.test(key) && value === 'base')
}

const isNotFound = (error: unknown) => /\bENOENT\b/.test(why(error))

// The hooks folder's files, sorted, each by name, kind, size, whether it runs (its owner may execute it) and the
// SHA-256 of its bytes (as base64), a link's from where it lands; [] for no folder, undefined when a part can't be read.
// A path that isn't there, or isn't a folder (core.hooksPath=/dev/null turns hooks off), holds no hooks. A link to a folder
// lists the folder it leads to.
async function hookFiles($: EngineInterface, path: string): Promise<string[] | undefined> {
  const named = await at($, path)
  const stat = await $.fs.stat(named, { resolve: true }).then(
    found => found,
    error => (isNotFound(error) ? null : undefined)
  )
  if (stat === undefined) return undefined
  if (stat?.kind !== 'dir') return []
  const folder = stat.realPath ?? named
  const entries = await $.fs.list(folder).then(
    found => found,
    error => (isNotFound(error) ? [] : undefined)
  )
  if (entries === undefined) return undefined
  if (entries.length === 0) return []
  const place = folder.startsWith('/') ? folder : `./${folder}`
  const runs = await sh($, ['find', '-L', place, '-maxdepth', '1', '-type', 'f', '-perm', '-100', '-print0'], GIT_TIMEOUT_MS)
  if (runs?.exitCode !== 0) return undefined
  const running = new Set(runs.stdout.split('\0').map(file => file.slice(file.lastIndexOf('/') + 1)))
  const content = async (entry: FsEntry): Promise<string | undefined> => {
    if (entry.kind === 'dir' || (entry.kind === 'other' && !entry.isLink)) return ''
    const file = `${folder.replace(/\/+$/, '')}/${entry.name}`
    const real = entry.isLink ? await landing($, file) : file
    return real === ''
      ? undefined
      : $.fs.read(real, { as: 'bytes' }).then(
          ({ base64 }) => sha256(base64),
          () => undefined
        )
  }
  const files: string[] = []
  for (const entry of entries) {
    const sha = await content(entry)
    if (sha === undefined) return undefined
    files.push([entry.name, entry.kind, entry.size, running.has(entry.name) ? 'x' : '-', sha].join('\0'))
  }
  return files.sort()
}

// Where git reads the global attributes file: the last core.attributesFile entry, with ~ for HOME and a relative path
// under the root; with none, XDG_CONFIG_HOME/git/attributes or HOME/.config/git/attributes. '' when there is none to
// read (no entry and no HOME), undefined for a path the mod can't place (~user, %(prefix), no value or an empty one).
async function globalAttributesPath($: EngineInterface, named: { value: string | undefined } | undefined): Promise<string | undefined> {
  const home = absoluteEnv(await $.env.get('HOME').catch(() => undefined))
  if (named !== undefined) {
    const { value } = named
    if (value === undefined || value === '' || value.startsWith('%(')) return undefined
    if (value === '~' || value.startsWith('~/')) return home === undefined ? undefined : `${home}${value.slice(1)}`
    return value.startsWith('~') ? undefined : value
  }
  const xdg = absoluteEnv(await $.env.get('XDG_CONFIG_HOME').catch(() => undefined))
  if (xdg !== undefined) return `${xdg.replace(/\/+$/, '')}/git/attributes`
  return home === undefined ? '' : `${home.replace(/\/+$/, '')}/.config/git/attributes`
}

// The SHA-256 of a file's text; none for a file that isn't there, undefined when it can't be read.
async function fileSha($: EngineInterface, path: string): Promise<string | undefined> {
  if (path === '') return 'none'
  return readFile($, path).then(
    text => sha256(text),
    error => (isNotFound(error) ? 'none' : undefined)
  )
}

// One SHA-256 over Git's settings: every config entry at every scope git reads, the system scope too, by scope, key and
// value, sorted, except what git and gh write themselves (isWrittenEntry); the SHA-256 of info/attributes and of the global attributes file,
// or none; and the hooks folder's files. undefined when a part can't be read.
async function gitSettings($: EngineInterface): Promise<string | undefined> {
  // A line with the failing part's name and nothing else: a path or a value could hold a secret.
  const unreadable = (part: string): undefined => {
    debug($, `git settings unreadable: ${part}`)
    return undefined
  }
  // The system scope counts too: the push reads it.
  const found = await sh($, ['git', 'config', '--show-scope', '-z', '--list'], GIT_TIMEOUT_MS, true)
  if (found?.exitCode !== 0) {
    unreadable('config read')
    return
  }
  const fields = found.stdout.split('\0')
  if (fields.at(-1) === '') fields.pop()
  if (fields.length % 2 !== 0) {
    unreadable('config read')
    return
  }
  const config: string[] = []
  let attributesFile: { value: string | undefined } | undefined
  for (let i = 0; i < fields.length; i += 2) {
    const entry = fields[i + 1] ?? ''
    const at = entry.indexOf('\n')
    const key = at < 0 ? entry : entry.slice(0, at)
    if (key.toLowerCase() === 'core.attributesfile') attributesFile = { value: at < 0 ? undefined : entry.slice(at + 1) }
    if (!isWrittenEntry(key, at < 0 ? undefined : entry.slice(at + 1))) config.push(`${fields[i] ?? ''}\0${entry}`)
  }
  const paths = await sh($, ['git', 'rev-parse', '--git-path', 'hooks', '--git-path', 'info/attributes'], GIT_TIMEOUT_MS)
  const [hooksPath = '', attributesPath = ''] = paths?.exitCode === 0 ? paths.stdout.split('\n') : []
  if (hooksPath === '' || attributesPath === '') {
    unreadable('rev-parse')
    return
  }
  const attributes = await fileSha($, attributesPath)
  const globalPath = await globalAttributesPath($, attributesFile)
  const globalAttributes = globalPath === undefined ? undefined : await fileSha($, globalPath)
  const hooks = await hookFiles($, hooksPath)
  if (attributes === undefined) {
    unreadable('attributes file')
    return
  }
  if (globalAttributes === undefined) {
    unreadable('global attributes file')
    return
  }
  if (hooks === undefined) {
    unreadable('hooks folder')
    return
  }
  return sha256(JSON.stringify({ config: config.sort(), attributes, globalAttributes, hooks }))
}

// origin's push URL as git gives it; undefined when git gives none.
async function originPushUrl($: EngineInterface): Promise<string | undefined> {
  const found = await sh($, ['git', 'remote', 'get-url', '--push', 'origin'], GIT_TIMEOUT_MS)
  return found?.exitCode === 0 ? found.stdout.replace(/\r?\n$/, '') : undefined
}

// The run's record of its Git settings in the mod's store; undefined for none, and for a record of an earlier form
// (a fingerprint alone), which counts as none.
async function readGitRecord($: EngineInterface, id: string): Promise<GitRecord | undefined> {
  const stored: unknown = await $.store.get(gitSettingsKey(id))
  if (typeof stored !== 'object' || stored === null) return undefined
  const { fingerprint, pushUrl } = stored as { fingerprint?: unknown; pushUrl?: unknown }
  return typeof fingerprint === 'string' ? { fingerprint, pushUrl } : undefined
}

// Whether Git's settings differ from the fingerprint the run's start stored. A read that fails, a check that throws and
// a missing fingerprint, or one of an earlier form, count as a change.
async function gitSettingsChanged($: EngineInterface, run: Run): Promise<boolean> {
  try {
    const record = await readGitRecord($, run.id)
    const now = await gitSettings($)
    return record === undefined || now === undefined || now !== record.fingerprint
  } catch {
    return true
  }
}

// Adds a line to .git/info/exclude, or where git keeps it in a worktree; answers why it couldn't.
async function exclude($: EngineInterface, line: string): Promise<{ path: string; error: string } | undefined> {
  const found = await sh($, ['git', 'rev-parse', '--git-path', 'info/exclude'])
  if (found?.exitCode !== 0) {
    return { path: EXCLUDE, error: 'git rev-parse --git-path info/exclude failed' }
  }
  const path = found.stdout.trim() === '' ? EXCLUDE : found.stdout.trim()
  const text = await readFile($, path).catch(() => '')
  if (text.split(/\r?\n/).includes(line)) return undefined
  return writeFile($, path, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`).then(
    () => undefined,
    error => ({ path, error: why(error) })
  )
}

// A rerun starts from a draft: the phase file's front-matter status line goes back to draft.
async function resetStatus($: EngineInterface, run: Run): Promise<void> {
  const path = phasePath(run)
  const text = await readFile($, path).catch(() => undefined)
  if (text === undefined) return
  const lines = text.split('\n')
  if (lines[0]?.replace(/^\uFEFF/, '').trimEnd() !== '---') return
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---')
  const at = lines.findIndex((line, i) => i > 0 && i < end && line.startsWith('status:'))
  if (end < 0 || at < 0 || lines[at]?.replace(/\r$/, '') === 'status: draft') return
  lines[at] = `status: draft${lines[at]?.endsWith('\r') ? '\r' : ''}`
  await writeFile($, path, lines.join('\n')).catch(error => {
    debug($, `${path} not reset: ${why(error)}`)
  })
}

// File names as a refusal shows them: each one plain, else the fixed text for an unusual name, with control and format
// characters stripped, so no name from git can move the cursor or draw a link.
function shownPaths(paths: readonly string[]): string {
  return paths.map(path => stripControl(safePath(path))).join(', ')
}

// An entry of git status --porcelain -z: its two-letter code, its path, and for a rename or a copy the path it came
// from, which -z gives as the next field.
interface StatusEntry {
  code: string
  path: string
  from?: string
}

function statusEntries(porcelain: string): StatusEntry[] {
  const fields = porcelain.split('\0')
  const entries: StatusEntry[] = []
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? ''
    if (field.length < 4) continue
    const code = field.slice(0, 2)
    entries.push(/[RC]/.test(code) ? { code, path: field.slice(3), from: fields[++i] ?? '' } : { code, path: field.slice(3) })
  }
  return entries
}

function changedPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      const path = line.slice(3)
      const arrow = path.indexOf(' -> ')
      return (arrow >= 0 ? path.slice(arrow + 4) : path).replace(/^"(.*)"$/, '$1')
    })
}

function hostOf(url: string): string | undefined {
  const web = /^(?:https?|ssh):\/\/(?:[^@/]+@)?([^/:]+)/.exec(url)
  if (web) return web[1]
  return /^[^@/\s]+@([^:/\s]+):/.exec(url)?.[1]
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function phasePath(run: Run, phase: PhaseName = phaseOf(run)): string {
  return `changes/${run.id}/${FILES[phase]}`
}

async function phaseFile($: EngineInterface, run: Run): Promise<{ text: string | undefined; status: PhaseStatus | undefined }> {
  const text = await readFile($, phasePath(run)).catch(() => undefined)
  return { text, status: text === undefined ? undefined : phaseStatus(text) }
}

async function statusOf($: EngineInterface, run: Run, phase: PhaseName): Promise<string> {
  const text = await readFile($, phasePath(run, phase)).catch(() => undefined)
  return (text === undefined ? undefined : phaseStatus(text)) ?? '-'
}

function openPoint(text: string | undefined): string | undefined {
  const lines = (text ?? '').split(/\r?\n/)
  const at = lines.findIndex(line => POINTS_HEADING.test(line.trim()))
  if (at < 0) return undefined
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) return undefined
    const item = line.trim().replace(/^(?:[-*]|\d+\.)\s+/, '')
    if (item !== '') return item
  }
  return undefined
}

// Text the person typed under Other: not empty, none of the dialog's own options, and no try at approving, which only
// the dialog's own pick does.
function isTyped(answer: string | undefined, options: readonly string[]): answer is string {
  const text = (answer ?? '').trim()
  const isApproving = /\bapprov/i.test(text) || /^(?:yes|ok|okay|go|lgtm)\b/i.test(text)
  return text !== '' && !isApproving && !options.includes(text) && !/^open\s+\S+\s+in\s+app$/i.test(text)
}

function isWalkPick(answer: string | undefined): boolean {
  return /walk\s+through/i.test(answer ?? '')
}

// The guided walk through the phase file's open points, sent as the mod's prompt at the person's pick (a plugin's
// prompt is framed as the plugin's, so it says who picked it); the run's state stays.
function walkThrough($: EngineInterface, run: Run): void {
  $.clock.after(0, () => {
    background($, 'walk-through', submitWalk($, run))
  })
}

// The dialog opens again when the main-loop turn the prompt starts ends (reopenAfterWalk).
async function submitWalk($: EngineInterface, run: Run): Promise<void> {
  const date = new Date(await $.clock.now()).toISOString().slice(0, 10)
  const phase = phaseOf(run)
  const dialog = run.state === 'gate' ? 'gate' : 'stuck'
  const text = phase === 'Intent' ? TEXTS.intentWalkPrompt(run.id, date, dialog) : TEXTS.walkPrompt(run.id, FILES[phase], date, dialog)
  await submitForDialog($, run, `${TEXTS.walkPicked(phaseOf(run), dialog)} ${text}`, text)
}

// What the person typed at a gate or Stuck dialog goes to Claude as their request for the phase file; the dialog opens
// again when that turn ends, as after a walk-through.
function typedRequest($: EngineInterface, run: Run, typed: string): void {
  const dialog = run.state === 'gate' ? 'gate' : 'stuck'
  const text = TEXTS.typedPrompt(run.id, phaseOf(run), stripControl(typed).trim(), dialog)
  $.clock.after(0, () => void submitForDialog($, run, text, text))
}

// A dialog's prompt, sent as the mod's; shown is what the log gives to paste when it doesn't enter.
async function submitForDialog($: EngineInterface, run: Run, prompt: string, shown: string): Promise<void> {
  const text = shown
  const sent: Walk = { id: run.id, phase: phaseOf(run), state: run.state, text: prompt }
  walk = sent
  // A prompt that did not enter (refused, or dropped by a hook or the engine) starts no walk.
  const refuse = (reason: string) => {
    if (walk === sent) walk = undefined
    $.ui.toast(NOTES.walkRefused(reason))
    $.ui.log(text)
  }
  try {
    const entered = await $.prompt.submit({ text: sent.text })
    if (entered.drop !== undefined) refuse(entered.drop)
  } catch (error) {
    refuse(why(error))
  }
}

// Whether a main-loop turn starts with the walk-through's prompt: its text holds the prompt the mod sent.
function isWalkTurn(sent: Walk, text: string): boolean {
  return text === sent.text || text.includes(sent.text)
}

// The end of the turn the walk-through's prompt started: the dialog it came from opens again, with its counts, while the
// run is still at that dialog. An interrupted turn leaves the dialog to the person. Another dialog of the mod, such as
// the rule dialog, closes first, and a gate or stuck dialog that opened meanwhile wins. With no dialog of the mod open,
// the dialog opens before the turn's end hook returns; else the reopen waits beside it.
async function reopenAfterWalk($: EngineInterface, turnId: string, isAborted: boolean): Promise<void> {
  const sent = walk
  if (sent?.turnId === undefined || sent.turnId !== turnId) return
  walk = undefined
  if (isAborted) return
  if (openAsks.size === 0) await reopenNow($, sent, dialogOpens)
  else background($, 'gate reopen', reopenWhenFree($, sent, dialogOpens))
}

async function reopenWhenFree($: EngineInterface, sent: Walk, opens: number): Promise<void> {
  try {
    while (openAsks.size > 0) {
      await Promise.allSettled([...openAsks])
      // A dialog's answer can open the next one: look again once its handler ran.
      await $.clock.sleep(0)
    }
  } catch {
    debug($, 'dialog not reopened after the walk-through')
    return
  }
  await reopenNow($, sent, opens)
}

// Opens the walk's dialog again while the run is still at it and no gate or stuck dialog opened since.
async function reopenNow($: EngineInterface, sent: Walk, opens: number): Promise<void> {
  try {
    const run = await current($)
    if (dialogOpens !== opens || run?.id !== sent.id || phaseOf(run) !== sent.phase || run.state !== sent.state) return
    if (run.state === 'gate') await openGate($, run)
    else await openStuck($, run)
  } catch {
    debug($, 'dialog not reopened after the walk-through')
  }
}

// The Intent gate's walk-through

const NO_COUNTS: WalkCounts = { answered: 0, skipped: 0, timedOut: 0 }

// What the Intent gate's question adds: the walk-through's counts, and the criteria added or changed since the run's
// first Intent dialog, which sets the criteria to compare with. A dialog ends the counting.
function intentGateNotes(run: Run, text: string): string[] {
  const criteria = criteriaOf(text)
  if (intentGate?.id !== run.id) {
    intentGate = { id: run.id, criteria, counts: NO_COUNTS, isWalking: false }
    return []
  }
  intentGate = { ...intentGate, isWalking: false }
  const { answered, skipped, timedOut } = intentGate.counts
  const notes = answered + skipped + timedOut > 0 ? [TEXTS.walkCounts(answered, skipped, timedOut)] : []
  const first = new Map(intentGate.criteria.map(({ id, line }) => [id, line]))
  const now = new Map(criteria.map(({ id, line }) => [id, line]))
  const added = [...now.keys()].filter(id => !first.has(id))
  const changed = [...first.keys()].filter(id => now.get(id) !== first.get(id))
  if (added.length + changed.length > 0) notes.push(TEXTS.criteriaSince(added, changed))
  return notes
}

// The person picked the walk-through at the Intent gate: its counts start again.
function startIntentWalk(run: Run, text: string): void {
  const criteria = intentGate?.id === run.id ? intentGate.criteria : criteriaOf(text)
  intentGate = { id: run.id, criteria, counts: NO_COUNTS, isWalking: true }
}

interface AskOutcome {
  deny?: string
  isError?: boolean
  result?: unknown
}

// One AskUserQuestion call, per question: timed out when the dialog resolved on its own (afkTimeoutMs), whatever
// answer came back with it; skipped when refused or left empty; else answered.
function tally(counts: WalkCounts, questions: string[], r: AskOutcome): WalkCounts {
  const result = (r.result ?? {}) as { answers?: Record<string, unknown>; afkTimeoutMs?: unknown; response?: unknown }
  let { answered, skipped, timedOut } = counts
  for (const question of questions) {
    const given = result.answers?.[question] ?? (questions.length === 1 ? result.response : undefined)
    if (r.deny !== undefined || r.isError === true) skipped++
    else if (typeof result.afkTimeoutMs === 'number') timedOut++
    else if (typeof given === 'string' && given.trim() !== '') answered++
    else skipped++
  }
  return { answered, skipped, timedOut }
}

// Claude's AskUserQuestion calls while the walk-through at the Intent gate runs; the mod's own dialogs count nothing.
async function countWalk($: EngineInterface, questions: unknown, r: AskOutcome): Promise<void> {
  if (intentGate === undefined || !intentGate.isWalking || !Array.isArray(questions)) return
  const run = await current($)
  if (run?.id !== intentGate.id || run.state !== 'gate' || phaseOf(run) !== 'Intent') return
  const asked = questions.map(item => (item as { question?: unknown } | null)?.question).filter(q => typeof q === 'string')
  if (asked.some(question => ownQuestions.has(question))) return
  intentGate = { ...intentGate, counts: tally(intentGate.counts, asked, r) }
}

// The acceptance tests in the working tree against the lock of Plan approval, untracked files under
// the test paths included; a check that can't run counts as a change. Each check that runs is kept as the run's
// lastLockCheck, for the pane.
async function testsChanged($: EngineInterface, run: Run): Promise<boolean> {
  const paths = run.testPaths ?? []
  if (run.lockedAt === undefined || paths.length === 0) return false
  const changed = await lockMoved($, run.lockedAt, paths)
  try {
    const at = await $.clock.now()
    await change($, latest => ({ ...latest, lastLockCheck: { changed, at } }))
  } catch (error) {
    debug($, `lock check not recorded: ${nameOf(error)}`)
  }
  return changed
}

async function lockMoved($: EngineInterface, lockedAt: string, paths: string[]): Promise<boolean> {
  const diff = await sh($, ['git', 'diff', '--quiet', lockedAt, '--', ...paths])
  if (diff?.exitCode !== 0) return true
  const untracked = await sh($, ['git', 'ls-files', '--others', '--exclude-standard', '--', ...paths])
  return untracked?.exitCode !== 0 || untracked.stdout.trim() !== ''
}

// The changed files

const FOOTPRINT_EVERY_MS = 10_000
const GIT_TIMEOUT_MS = 5_000
const BASE_NAME = /^[A-Za-z0-9._/-]+$/
const UNAVAILABLE: FootprintState = { unavailable: true }

// The files and lines changed since the change branched off from origin's base branch, committed or not.
async function readFootprint($: EngineInterface, run: Run): Promise<FootprintState> {
  if (!BASE_NAME.test(run.base) || run.base.startsWith('-')) return UNAVAILABLE
  const base = await sh($, ['git', 'merge-base', `origin/${run.base}`, 'HEAD'], GIT_TIMEOUT_MS)
  const sha = base?.exitCode === 0 ? base.stdout.trim() : ''
  if (!COMMIT.test(sha)) return UNAVAILABLE
  const numstat = await sh($, ['git', 'diff', '--numstat', '-z', '--no-renames', sha], GIT_TIMEOUT_MS)
  if (numstat?.exitCode !== 0) return UNAVAILABLE
  const untracked = await sh($, ['git', 'ls-files', '--others', '--exclude-standard', '-z'], GIT_TIMEOUT_MS)
  if (untracked?.exitCode !== 0) return UNAVAILABLE
  const found = footprint(numstat.stdout, untracked.stdout, {
    ...(run.plannedPaths === undefined ? {} : { plannedPaths: run.plannedPaths }),
    ...(run.testPaths === undefined ? {} : { testPaths: run.testPaths }),
    id: run.id,
    learnedRules: [...learnedFiles],
  })
  return { ...found, lines: [...found.lines, ...lastChangedLines(await changeTimes($, found.paths))] }
}

// Each changed path's change time, from the file itself, so a write through the shell counts too; at most the first
// MAX_TIMED paths, and undefined where the file is gone or can't be read.
const MAX_TIMED = 300

async function changeTimes($: EngineInterface, paths: readonly string[]): Promise<{ path: string; mtimeMs: number | undefined }[]> {
  return Promise.all(
    paths.slice(0, MAX_TIMED).map(async path => ({
      path,
      mtimeMs: await at($, path)
        .then(full => $.fs.stat(full))
        .then(
          stat => (typeof stat.mtimeMs === 'number' ? stat.mtimeMs : undefined),
          () => undefined
        ),
    }))
  )
}

async function keepFootprint($: EngineInterface, found: FootprintState): Promise<void> {
  footprintCopy = found
  await update($, footprintAtom, () => found)
}

// Asks for the changed files again, outside the caller's path, and never throws: at most once every 10 seconds, one
// later ask waiting for the end of the 10 seconds. A waiting refresh whose timer never fired is overdue after another
// 10 seconds, and the next ask replaces it. Only an active run from Build on reads them.
function refreshFootprint($: EngineInterface): void {
  try {
    $.clock.after(0, () => void footprintSoon($))
  } catch (error) {
    debug($, `changed files not asked for: ${nameOf(error)}`)
  }
}

async function footprintSoon($: EngineInterface): Promise<void> {
  try {
    const now = await $.clock.now()
    if (footprintAt === undefined || now >= footprintAt + FOOTPRINT_EVERY_MS) {
      await footprintNow($)
      return
    }
    if (footprintDueAt !== undefined && now < footprintDueAt + FOOTPRINT_EVERY_MS) return
    footprintDueAt = footprintAt + FOOTPRINT_EVERY_MS
    $.clock.after(footprintDueAt - now, () => void footprintNow($))
  } catch (error) {
    footprintDueAt = undefined
    debug($, `changed files not read: ${nameOf(error)}`)
  }
}

async function footprintNow($: EngineInterface): Promise<void> {
  footprintDueAt = undefined
  try {
    const run = await current($)
    if (run === null || !isActive(run) || run.phase < PHASES.indexOf('Build')) return
    footprintAt = await $.clock.now()
    await keepFootprint($, await readFootprint($, run))
  } catch (error) {
    debug($, `changed files not read: ${nameOf(error)}`)
  }
}

// The signals for the PR

const MAX_SIGNAL_PATHS = 5

function signalPaths(paths: string[]): string[] {
  const shown = paths.slice(0, MAX_SIGNAL_PATHS).map(path => `  - ${safePath(path)}`)
  return paths.length > MAX_SIGNAL_PATHS ? [...shown, `  - +${paths.length - MAX_SIGNAL_PATHS} more`] : shown
}

const fileCount = (count: number): string => `${count} file${count === 1 ? '' : 's'}`

// The signals file: the outside, sensitive and denial counts, with up to five paths each, as names the pane
// would draw. They gate nothing.
function signalsText(found: FootprintState, denials: number): string {
  const lines = ['# Signals from goal-and-do', '', 'Counts the mod kept during the run. They gate nothing.', '']
  if ('unavailable' in found) {
    lines.push(`- ${FOOTPRINT_UNAVAILABLE}`)
  } else {
    if (found.outside === undefined) lines.push('- Outside the plan: not checked (no planned-paths in plan.md)')
    else lines.push(`- Outside the plan: ${fileCount(found.outside.length)}`, ...signalPaths(found.outside))
    lines.push(`- Sensitive files: ${fileCount(found.sensitive.length)}`, ...signalPaths(found.sensitive.map(item => item.path)))
  }
  lines.push(`- Denials: ${denials}`)
  return `${lines.join('\n')}\n`
}

// goal-and-do/signals-<id>.md where git keeps its files (a worktree's own folder too). An older file of the run goes
// first, so a failed read or write leaves none behind.
async function writeSignals($: EngineInterface): Promise<void> {
  try {
    const run = await current($)
    if (run === null || !isActive(run)) return
    const name = `goal-and-do/signals-${run.id}.md`
    const located = await sh($, ['git', 'rev-parse', '--git-path', name])
    const path = await at($, located?.exitCode === 0 && located.stdout.trim() !== '' ? located.stdout.trim() : `.git/${name}`)
    await sh($, ['rm', '-f', '--', path])
    footprintAt = await $.clock.now()
    const found = await readFootprint($, run)
    await keepFootprint($, found)
    await writeFile($, path, signalsText(found, run.deniedCount ?? 0))
  } catch (error) {
    debug($, `signals not written: ${nameOf(error)}`)
  }
}

// The push dialog's line of signals, from the changed files of the last refresh.
function pushSignals(found: FootprintState | null, denials: number): string {
  if (found === null || 'unavailable' in found) return TEXTS.pushSignals('unknown', 'unknown', denials)
  return TEXTS.pushSignals(found.outside === undefined ? 'not checked' : found.outside.length, found.sensitive.length, denials)
}

// The secret check and the test-weakening signals

const SCAN_TIMEOUT_MS = 60_000
const BRANCH_TIMEOUT_MS = 15_000
const MAX_UNTRACKED = 200
const CHECK_CRASHED = 'The secret check could not run: it failed before it finished. A check that cannot run does not pass, so the action is denied.'

// Git's view for the secret check. A commit takes the index and the work tree (a path list or -a commits from it); the untracked files only
// when the command adds them (scope), which then are read as well: a binary one, one over 1 MB or more than MAX_UNTRACKED of them cannot
// be read, so the commit is denied.
function gitReader($: EngineInterface, scope: UntrackedScope = { all: false, paths: [] }): GitReader {
  return {
    stagedPatch: async () => {
      const cached = await sh($, ['git', 'diff', '--cached', '--no-color', '-U0'], BRANCH_TIMEOUT_MS)
      const tracked = await sh($, ['git', 'diff', 'HEAD', '--no-color', '-U0'], BRANCH_TIMEOUT_MS)
      if (cached?.exitCode !== 0 || tracked?.exitCode !== 0) return undefined
      let patch = `${cached.stdout}\n${tracked.stdout}`
      if (!scope.all && scope.paths.length === 0) return patch
      // Git matches the paths a git add named, as it does for the add.
      const named = scope.all ? [] : ['--', ...scope.paths]
      const others = await sh($, ['git', 'ls-files', '--others', '--exclude-standard', '-z', ...named], GIT_TIMEOUT_MS)
      if (others?.exitCode !== 0) return undefined
      const untracked = others.stdout.split('\u0000').filter(name => name !== '')
      if (untracked.length > MAX_UNTRACKED) throw new Error(`more than ${MAX_UNTRACKED} untracked files, which it cannot read`)
      for (const path of untracked) {
        const added = await sh($, ['git', 'diff', '--no-index', '--no-color', '-U0', '--', '/dev/null', path], BRANCH_TIMEOUT_MS)
        if (added === undefined || (added.exitCode !== 0 && added.exitCode !== 1)) return undefined
        patch += `\n${added.stdout}`
      }
      return patch
    },
    commitsAhead: async base => {
      const listed = await sh($, ['git', 'rev-list', '--reverse', `origin/${base}..HEAD`], GIT_TIMEOUT_MS)
      if (listed?.exitCode !== 0) return undefined
      const commits: CommitPatch[] = []
      for (const sha of listed.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^[0-9a-f]{40}$/.test(line))) {
        const shown = await sh(
          $,
          ['git', 'show', '-m', '--first-parent', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--format=%x00%B%x00', sha],
          BRANCH_TIMEOUT_MS
        )
        if (shown?.exitCode !== 0) return undefined
        const [, message = '', ...rest] = shown.stdout.split('\u0000')
        commits.push({ sha, message, patch: rest.join('\u0000') })
      }
      return commits
    },
  }
}

// The optional scanner. It exists only once the code owner has approved it (shapes.ts), and it runs with the plugin's own config and ignore
// file: nothing of the scanned repository configures it.
async function gitleaksScanner($: EngineInterface): Promise<Scanner | undefined> {
  if (!SCANNER_APPROVED) return undefined
  const located = await sh($, ['git', 'rev-parse', '--git-path', 'goal-and-do/gitleaks-report.json'])
  if (located?.exitCode !== 0 || located.stdout.trim() === '') return undefined
  const reportPath = await at($, located.stdout.trim())
  const folder = `${$.plugin.root}/hooks`
  return {
    reportPath,
    trusted: { config: `${folder}/gitleaks.toml`, ignorePath: `${folder}/gitleaks.ignore` },
    version: async () => {
      const printed = await sh($, ['gitleaks', 'version'], GIT_TIMEOUT_MS)
      return printed?.exitCode === 0 ? printed.stdout.trim() : undefined
    },
    approved: () => SCANNER_APPROVED,
    scan: async (target, args) => {
      const where = target === 'staged' ? ['git', '--staged'] : ['git', '--log-opts', `origin/${target.base}..HEAD`]
      const ran = await sh($, ['gitleaks', ...where, '--no-banner', ...args], SCAN_TIMEOUT_MS)
      if (ran === undefined) throw new Error('the scanner did not run')
      const report = await readFile($, reportPath).catch(() => undefined)
      return report === undefined ? { exitCode: ran.exitCode } : { exitCode: ran.exitCode, report }
    },
    removeReport: async () => {
      await sh($, ['rm', '-f', '--', reportPath])
    },
  }
}

const denialOf = (reason: string): { reason: string; key: string } => ({
  reason,
  key: reason.startsWith('The secret check could not run') ? 'secretCheckFailed' : 'secretShape',
})

// The secret check of the calls that publish work: git commit, gh pr create and gh pr edit. A hit denies the call and leaves the run going,
// so the developer can fix it and try again. A check that fails denies too.
async function secretDenial($: EngineInterface, command: string): Promise<{ reason: string; key: string } | undefined> {
  try {
    const kinds = publishKinds(command)
    if (kinds.forcedAdd) {
      return denialOf(
        'The secret check could not run: a forced git add (-f) stages files that Git ignores, and the check cannot read them. Add the file without -f, or leave it out.'
      )
    }
    // A relative path is the Bash tool's: the directory of the session, not the project root.
    const sessionDir = (await $.session.cwd().catch(() => '')).replace(/\/+$/, '')
    const readPath = (path: string): Promise<string | undefined> =>
      path.startsWith('/')
        ? readFile($, path).catch(() => undefined)
        : sessionDir === ''
          ? Promise.resolve(undefined)
          : readFile($, `${sessionDir}/${path.replace(/^(?:\.\/)+/, '')}`).catch(() => undefined)
    // Named untracked paths are the command's relative to the session's directory; git is asked from the project root.
    let scope = untrackedScope(command)
    if (!scope.all && scope.paths.length > 0 && sessionDir !== (await projectRoot($))) scope = { all: true, paths: [] }
    let check: Check | undefined
    if (kinds.commit) check = await checkCommitMessage(command, readPath)
    if (kinds.commit && check?.verdict !== 'deny') check = await checkCommit(gitReader($, scope), await gitleaksScanner($))
    if (check?.verdict !== 'deny' && kinds.isPr) check = await checkPrBody(command, readPath)
    return check?.verdict === 'deny' ? denialOf(check.reason) : undefined
  } catch (error) {
    debug($, `secret check failed: ${nameOf(error)}`)
    return denialOf(CHECK_CRASHED)
  }
}

// The push check reads origin/<base>..HEAD, so HEAD must be the branch the push names: `sdd/<id>` and `HEAD:sdd/<id>` then send the
// same commits.
async function headIsBranch($: EngineInterface, run: Run): Promise<boolean> {
  const head = await sh($, ['git', 'rev-parse', 'HEAD'], GIT_TIMEOUT_MS)
  const branch = await sh($, ['git', 'rev-parse', '--verify', '--quiet', `refs/heads/sdd/${run.id}`], GIT_TIMEOUT_MS)
  return head?.exitCode === 0 && branch?.exitCode === 0 && head.stdout.trim() !== '' && head.stdout.trim() === branch.stdout.trim()
}

// The checks before the push dialog opens: the secret check of every commit in origin/<base>..HEAD, then the signals, written for the
// reviewer. The line for the dialog holds the signals and the scanner part; a secret check that denies stops the push.
async function checkBeforePush($: EngineInterface, run: Run): Promise<{ denial?: { reason: string; key: string }; extra: string }> {
  if (!(await headIsBranch($, run))) {
    const reason = `The secret check could not run: HEAD is not the branch sdd/${run.id}, so the commits it would send are not the ones to check. Switch to sdd/${run.id} and try again.`
    return { denial: { reason, key: 'secretCheckFailed' }, extra: '' }
  }
  let scan: Check
  try {
    scan = await checkPush(gitReader($), run.base, await gitleaksScanner($))
  } catch (error) {
    debug($, `push check failed: ${nameOf(error)}`)
    scan = { verdict: 'deny', reason: CHECK_CRASHED }
  }
  if (scan.verdict === 'deny') return { denial: denialOf(scan.reason), extra: '' }
  const signals = await writeWeakening($, run, 'push')
  return { extra: `${signalsLine(signals)} ${scannerLine(scan)}` }
}

// The plain facts about merge-base..HEAD that weakeningSignals reads; undefined when Git can't say.
async function weakeningFacts($: EngineInterface, run: Run): Promise<BranchFacts | undefined> {
  const found = await sh($, ['git', 'merge-base', `origin/${run.base}`, 'HEAD'], GIT_TIMEOUT_MS)
  const base = found?.exitCode === 0 ? found.stdout.trim() : ''
  if (!/^[0-9a-f]{40}$/.test(base)) return undefined
  const tree = await sh($, ['git', 'ls-tree', '-r', '--name-only', '-z', base], BRANCH_TIMEOUT_MS)
  const names = await sh($, ['git', 'diff', '--name-status', '-M', '-z', base, 'HEAD'], BRANCH_TIMEOUT_MS)
  const patch = await sh($, ['git', 'diff', '-M', '-U0', '--no-color', base, 'HEAD'], BRANCH_TIMEOUT_MS)
  if (tree?.exitCode !== 0 || names?.exitCode !== 0 || patch?.exitCode !== 0) return undefined
  const added = new Map(patchFiles(patch.stdout).map(file => [file.path, file.added.map(line => line.text)]))
  const changes: ChangedPath[] = []
  const tokens = names.stdout.split('\u0000')
  for (let i = 0; i < tokens.length; i += 1) {
    const code = tokens[i] ?? ''
    if (code === '') continue
    const first = tokens[i + 1] ?? ''
    if (code.startsWith('R') || code.startsWith('C')) {
      const path = tokens[i + 2] ?? ''
      changes.push(
        code.startsWith('R')
          ? { path, status: 'renamed', from: first, addedLines: added.get(path) ?? [] }
          : { path, status: 'added', addedLines: added.get(path) ?? [] }
      )
      i += 2
    } else {
      const status = code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified'
      changes.push({ path: first, status, addedLines: added.get(first) ?? [] })
      i += 1
    }
  }
  const deletions: { path: string; message: string }[] = []
  for (const change of changes.filter(item => item.status === 'deleted')) {
    const logged = await sh($, ['git', 'log', '-1', '--format=%B', `${base}..HEAD`, '--', change.path], GIT_TIMEOUT_MS)
    deletions.push({ path: change.path, message: logged?.exitCode === 0 ? logged.stdout : '' })
  }
  const specText = await readFile($, `changes/${run.id}/spec.md`).catch(() => '')
  return { baseFiles: tree.stdout.split('\u0000').filter(name => name !== ''), changes, deletions, runnerPaths: [], specText }
}

// The signals at a scan point, written to weakening-<id>.md beside the signals file, where the test-change and open-pr skills read it.
// A branch Git can't read gives "not scanned"; nothing here blocks or throws.
async function writeWeakening($: EngineInterface, run: Run, point: 'build-end' | 'test-end' | 'push'): Promise<Signals | 'not scanned'> {
  let signals: Signals | 'not scanned' = 'not scanned'
  try {
    const facts = await weakeningFacts($, run)
    if (facts !== undefined) signals = weakeningSignals(facts)
  } catch (error) {
    debug($, `signals not read at ${point}: ${nameOf(error)}`)
  }
  try {
    const name = `goal-and-do/weakening-${run.id}.md`
    const located = await sh($, ['git', 'rev-parse', '--git-path', name])
    const path = await at($, located?.exitCode === 0 && located.stdout.trim() !== '' ? located.stdout.trim() : `.git/${name}`)
    await sh($, ['rm', '-f', '--', path])
    await writeFile(
      $,
      path,
      signals === 'not scanned' ? '## Test-weakening signals\n\nNot scanned: the branch could not be read.\n' : testRecordSection(signals)
    )
  } catch (error) {
    debug($, `signals not written at ${point}: ${nameOf(error)}`)
  }
  return signals
}

// Start and preflight

// The checks before a start, against the base: the chosen one, else origin's default branch, else main. A request file,
// named by its path, may be new or changed in the worktree: the clean-tree check leaves out that one entry.
async function preflight(
  $: EngineInterface,
  source: 'jira' | 'freeform',
  chosen?: string,
  requestPath?: string
): Promise<{ failures: string[]; base: string }> {
  const head = chosen === undefined ? await sh($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD']) : undefined
  const named = chosen ?? (head?.exitCode === 0 ? head.stdout.trim().replace(/^origin\//, '') : '')
  const base = named === '' ? 'main' : named
  const prefix = await sh($, ['git', 'rev-parse', '--show-prefix'])
  if (prefix?.exitCode !== 0) return { failures: [TEXTS.notAtRoot], base }
  const failures: string[] = []
  if (prefix.stdout.trim() !== '') failures.push(TEXTS.preflightNotAtRoot)
  const branch = (await sh($, ['git', 'branch', '--show-current']))?.stdout.trim() ?? ''
  if (branch.startsWith('sdd/')) failures.push(TEXTS.wrongBranch(branch, base))
  const status = await sh($, ['git', 'status', '--porcelain', '-z', '--untracked-files=all'])
  if (status?.exitCode !== 0) failures.push(TEXTS.preflightNoStatus)
  // The request file may be new and untracked. Tracked and changed, staged, renamed, copied or deleted, it refuses: a
  // phase's commit would take the index along, and Intent's switch to the change branch would stop on it.
  const entries = statusEntries(status?.stdout ?? '')
  const isExempt = (entry: StatusEntry) => entry.path === requestPath && entry.from === undefined && entry.code === '??'
  const isRequest = (path: string) => requestPath !== undefined && path === requestPath
  if (entries.some(entry => !isExempt(entry) && (isRequest(entry.path) || isRequest(entry.from ?? '')))) {
    failures.push(TEXTS.requestFileCommitFirst)
  }
  const paths = entries.flatMap(entry => (isExempt(entry) ? [] : [entry.path, ...(entry.from === undefined ? [] : [entry.from])]))
  const dirty = [...new Set(paths)].filter(path => !isRequest(path) && !IGNORED_DIRTY.some(pattern => pattern.test(path)))
  if (dirty.length > 0) failures.push(TEXTS.preflightDirty(shownPaths(dirty)))
  if (source === 'jira') {
    const tools = await $.tool.list().catch(() => [])
    if (!tools.some(tool => isJiraRead(tool.name))) failures.push(TEXTS.preflightNoJira)
  }
  const origin = await sh($, ['git', 'remote', 'get-url', 'origin'])
  const host = origin?.exitCode === 0 ? hostOf(origin.stdout.trim()) : undefined
  if (host !== undefined) {
    const auth = await sh($, ['gh', 'auth', 'status', '--hostname', host])
    if (auth?.exitCode !== 0) failures.push(TEXTS.preflightGh(host))
  }
  const policy: Readonly<Record<string, unknown>> = await $.settings.read({ source: 'policy' }).catch(() => ({}))
  for (const key of MANAGED_KEYS) if (policy[key]) failures.push(TEXTS.preflightManaged(key))
  return { failures, base }
}

async function environment($: EngineInterface): Promise<Run['env']> {
  const claudeCode = await $.session.version().then(
    v => v.version,
    () => 'unknown'
  )
  const manifest = await readFile($, `${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => '{}')
  let plugin = 'unknown'
  try {
    const version = (JSON.parse(manifest) as { version?: unknown }).version
    if (typeof version === 'string') plugin = version
  } catch {
    plugin = 'unknown'
  }
  const provider = await $.session.model().then(
    model => modelKey(model).provider,
    () => 'unknown'
  )
  const settings: Readonly<Record<string, unknown>> = await $.settings.read().catch(() => ({}))
  const mode = (settings.permissions as { defaultMode?: unknown } | undefined)?.defaultMode
  return { claudeCode, plugin, provider, permissionMode: typeof mode === 'string' ? mode : 'default' }
}

// Whether a chosen base is a branch name git takes: the mod's pattern, then git's own rules for a branch name.
async function isBaseName($: EngineInterface, branch: string): Promise<boolean> {
  if (!isBranchName(branch)) return false
  return (await sh($, ['git', 'check-ref-format', '--branch', branch], GIT_TIMEOUT_MS))?.exitCode === 0
}

// How long the base's fetch may take: it runs once per start, outside any tool call's path.
const FETCH_TIMEOUT_MS = 30_000

// Whether origin has the chosen base branch: a fetch of it into its remote-tracking branch, by an explicit refspec (so a
// clone that fetches one branch only finds it too); then the remote-tracking branch. The fetch runs as the push does,
// with GIT_SSH_COMMAND and GIT_SSH unset and the plain ssh, here in batch mode, and with no prompt for credentials. A
// fetch that fails or runs out of time gives 'not fetched': an older copy never decides.
async function baseOnOrigin($: EngineInterface, branch: string): Promise<'found' | 'missing' | 'not fetched'> {
  const refspec = `+refs/heads/${branch}:refs/remotes/origin/${branch}`
  const fetch = ['-c', 'core.sshCommand=ssh -o BatchMode=yes', 'fetch', '--quiet', 'origin', refspec]
  const env = ['env', '-u', 'GIT_SSH_COMMAND', '-u', 'GIT_SSH', 'GIT_TERMINAL_PROMPT=0', 'GIT_CONFIG_NOSYSTEM=1']
  const fetched = await sh($, [...env, 'git', ...GIT_SAFE, ...fetch], FETCH_TIMEOUT_MS)
  if (fetched?.exitCode !== 0) return 'not fetched'
  const found = await sh($, ['git', 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], GIT_TIMEOUT_MS)
  return found?.exitCode === 0 ? 'found' : 'missing'
}

interface RequestFile {
  text: string
  base?: string
}

// The request in a .md file of the project. An input of one word that ends in .md names one, and it must be a plain
// relative path that lands (links followed) on a regular file inside the root; else the start is refused, so a typo or a
// link outside never becomes the request itself. undefined for any other input, which today's rules read. A refusal's
// fixed text also when the file can't be read, is too long or holds front matter other than base.
async function requestFile($: EngineInterface, input: string): Promise<RequestFile | { refusal: string } | undefined> {
  if (!/^\S+\.md$/.test(input)) return undefined
  const missing = { refusal: TEXTS.requestFileMissing }
  if (safePath(input) !== input || !isSafePath(input)) return missing
  const base = await projectRoot($)
  if (base === '') return missing
  const rootReal = await landing($, base)
  const real = await landing($, await at($, input))
  if (rootReal === '' || real === '' || !real.startsWith(`${rootReal.replace(/\/+$/, '')}/`)) return missing
  const stat = await $.fs.stat(real).catch(() => undefined)
  if (stat?.kind !== 'file') return missing
  // A file whose bytes can't hold 20,000 characters or fewer is refused unread; a UTF-8 character takes at most 4.
  if (stat.size > REQUEST_FILE_CHARS * 4) return { refusal: TEXTS.requestFileUnreadable }
  const text = await $.fs.read(real).catch(() => undefined)
  if (text === undefined || text.length > REQUEST_FILE_CHARS) return { refusal: TEXTS.requestFileUnreadable }
  const parts = requestFileParts(text)
  if (parts === 'bad front matter') return { refusal: TEXTS.requestFileFrontMatter }
  return parts.text === '' ? { refusal: TEXTS.requestFileUnreadable } : parts
}

async function startRun($: EngineInterface, input: string, chosen?: string, strict?: true): Promise<string | undefined> {
  if (chosen !== undefined && !(await isBaseName($, chosen))) return TEXTS.baseInvalid
  if (input === '') return TEXTS.usage
  const active = await current($)
  if (active !== null && isActive(active)) return TEXTS.runActive(active.id)
  const file = await requestFile($, input)
  if (file !== undefined && 'refusal' in file) return file.refusal
  // --base on the command line wins over the file's.
  const asked = chosen ?? file?.base
  const isFromFile = chosen === undefined && file?.base !== undefined
  if (isFromFile && !(await isBaseName($, file?.base ?? ''))) return TEXTS.requestFileBaseInvalid
  const now = await $.clock.now()
  const { id, source } = file === undefined ? changeIdFrom(input, now) : { id: freeformId(requestTitle(file.text), now), source: 'freeform' as const }
  const { failures, base } = await preflight($, source, asked, file === undefined ? undefined : input.replace(/^(?:\.\/)+/, ''))
  if (failures.length > 0) return failures.join('\n')
  const onOrigin = asked === undefined ? 'found' : await baseOnOrigin($, asked)
  if (onOrigin === 'not fetched') return TEXTS.baseNotFetched
  if (onOrigin === 'missing') return isFromFile ? TEXTS.requestFileBaseMissing : TEXTS.baseMissing
  if (await fileExists($, `changes/${id}`)) return TEXTS.changeExists(id, base)
  const excluded = await exclude($, RUN_JSON_LINE)
  if (excluded !== undefined) return NOTES.excludeFailed(excluded.path, excluded.error)
  await $.store.delete(lockKey(id)).catch(error => {
    debug($, `stored lock not deleted: ${why(error)}`)
  })
  // Git's settings and origin's push URL as the run starts; with no settings read, each gate and the push find them
  // changed, and with no push URL the push is denied.
  const settings = await gitSettings($).catch(() => undefined)
  const pushUrl = settings === undefined ? undefined : await originPushUrl($).catch(() => undefined)
  const record: GitRecord | undefined = settings === undefined ? undefined : { fingerprint: settings, ...(pushUrl === undefined ? {} : { pushUrl }) }
  await (record === undefined ? $.store.delete(gitSettingsKey(id)) : $.store.set(gitSettingsKey(id), record)).catch(error => {
    debug($, `git settings not stored: ${why(error)}`)
  })
  const empty: ApprovalRecord = { approvedPast: -1, rows: [] }
  const isStored = await $.store.set(approvalsKey(id), empty).then(
    () => true,
    error => {
      debug($, `approvals not stored: ${why(error)}`)
      return false
    }
  )
  if (!isStored) {
    $.ui.toast(NOTES.storeFailed)
    return undefined
  }
  const level = startLevel({ strict })
  await $.store.set(levelKey(id), level).catch(error => {
    debug($, `guard level not stored: ${why(error)}`)
  })
  intentGate = undefined
  // A new run starts with no changed files of an earlier one.
  footprintCopy = null
  footprintAt = undefined
  await update($, footprintAtom, () => null).catch(error => {
    debug($, `changed files not cleared: ${nameOf(error)}`)
  })
  // Nor its opened criteria: the pane draws from the module value, so a failed atom write shows none.
  openedCopy = []
  walk = undefined
  await update($, openedAtom, () => []).catch(() => {
    debug($, 'opened criteria not cleared')
  })
  const origin = source === 'jira' ? `jira ${id}` : 'freeform'
  const fromFile = file === undefined ? '' : `from-file: ${input}\n`
  await writeFile($, `changes/${id}/request.md`, `---\nsource: ${origin}\nbase: ${base}\n${fromFile}---\n\n${file?.text ?? input}\n`)
  await put($, newRun({ id, input, source, base, now, level, env: await environment($) }))
  openPane($)
  announceLevel(
    {
      toast: text => {
        $.ui.toast(text)
      },
      log: text => {
        $.ui.log(text)
      },
    },
    level
  )
  $.clock.after(0, () => {
    background($, 'goal start', startGoal($))
  })
  return source === 'jira' ? TEXTS.startedJira(id) : TEXTS.startedFreeText(id)
}

// Goals

async function startGoal($: EngineInterface): Promise<void> {
  const before = await current($)
  if (before?.state !== 'running' || before.goalActive) return
  const phase = phaseOf(before)
  const goal = goalFor(phase, before.id, fixStateOf(before))
  lastReason = undefined
  await change($, run => ({ ...run, goalActive: true, pendingGoal: false }))
  await startTurnClock($)
  if (phase === 'PR') $.clock.after(0, () => void writeSignals($))
  $.command.run({ command: 'goal', args: goal }).catch(async error => {
    await change($, run => ({ ...run, goalActive: false, pendingGoal: true }))
    $.ui.toast(NOTES.goalRefused(phase, why(error)))
    $.ui.log(`/goal ${goal}`)
  })
}

// The current goal turn starts now, with no tool calls yet.
async function startTurnClock($: EngineInterface): Promise<void> {
  try {
    const startedAt = await $.clock.now()
    await update($, turnAtom, () => ({ startedAt, calls: 0 }))
  } catch (error) {
    debug($, `turn clock not set: ${nameOf(error)}`)
  }
}

// The current goal turn's clock for the band: while a goal turn runs, and for a capped run, as the pane's Turns line
// counts it. Without a goal turn, or without the turn atom (after a restart), there is no clock and no minutes.
async function turnClock($: EngineInterface, run: Run): Promise<TurnClock | undefined> {
  if (!run.goalActive && run.state !== 'capped') return undefined
  const turn = await read($, turnAtom)
  if (turn == null) return undefined
  return { startedAt: turn.startedAt, now: await $.clock.now(), calls: turn.calls }
}

async function setBusy($: EngineInterface, isBusy: boolean): Promise<void> {
  await update($, busyAtom, () => isBusy).catch(() => {
    debug($, 'busy not kept')
  })
}

// Whether the person's own prompt runs while the run waits at a gate or stuck state.
async function isBusyAt($: EngineInterface, run: Run): Promise<boolean> {
  const isWaiting = run.state === 'gate' || run.state === 'blocked' || run.state === 'capped' || run.state === 'interrupted'
  return isWaiting && (await read($, busyAtom))
}

// One more tool call in the current goal turn; nothing while no goal turn runs.
async function countCall($: EngineInterface): Promise<void> {
  if ((await read($, turnAtom)) == null) return
  await update($, turnAtom, turn => (turn == null ? null : { ...turn, calls: turn.calls + 1 }))
}

async function clearGoal($: EngineInterface): Promise<void> {
  await $.command.run({ command: 'goal', args: 'clear' }).catch(error => {
    debug($, `/goal clear: ${why(error)}`)
  })
}

// A fresh context for the next goal: /goal clear for a rerun, /clear, the run back into the atom, the goal.
async function freshGoal($: EngineInterface, clearFirst: boolean): Promise<void> {
  if (clearFirst) await clearGoal($)
  await $.command.run({ command: 'clear', args: '' }).catch(error => {
    debug($, `/clear: ${why(error)}`)
  })
  await writeBack($)
  await startGoal($)
}

// Stops the run and closes its pane. With no main-loop turn running the goal is cleared at once; mid-turn the next
// classic.Stop cuts the loop and the turn.complete after it clears the goal.
async function stopRun($: EngineInterface): Promise<void> {
  const run = await change($, stop)
  $.ui.close({ id: PANE }).catch(error => {
    debug($, `pane: ${why(error)}`)
  })
  if (run === null || turnRunning) return
  $.clock.after(0, () => {
    background($, 'stopped run', clearStopped($))
  })
}

async function clearStopped($: EngineInterface): Promise<void> {
  await clearGoal($)
  await change($, run => ({ ...run, pendingClear: false }))
}

// A run blocked with "the goal ended without status: done" whose phase file says done by now: a turn after the goal's end
// finished the file. The phase counts as done and the run goes on; a rerun would set the finished file back to draft.
// False when the reason is another, the file is not done, or the locked tests changed (the re-lock dialog decides).
async function acceptDoneFile($: EngineInterface, run: Run): Promise<boolean> {
  if (run.state !== 'blocked' || !(run.reason ?? '').startsWith(TEXTS.goalEnded(''))) return false
  const phase = phaseOf(run)
  if ((await phaseFile($, run)).status !== 'done') return false
  if ((phase === 'Build' || phase === 'Test') && (await testsChanged($, run))) return false
  const decided = await change($, latest =>
    latest.state === 'blocked' && latest.reason === run.reason && latest.phase === run.phase
      ? afterStatus({ ...latest, state: 'running', reason: undefined }, 'done')
      : latest
  )
  if (decided === null || decided.state === 'blocked') return false
  debug($, `${phasePath(run)} says done after the goal ended: the run goes on`)
  $.ui.log(NOTES.acceptedDone(FILES[phase]))
  await keepTrace($, run)
  // After the command's hook has returned, as a rerun's fresh goal: a /clear started inside it reaches no hook.
  $.clock.after(
    0,
    () =>
      void afterDecision($, run, decided).catch((error: unknown) => {
        debug($, `after the accepted file: ${nameOf(error)}`)
      })
  )
  return true
}

async function rerunPhase($: EngineInterface): Promise<Run | null> {
  const before = await current($)
  const prUrl = before !== null && before.prUrl === undefined ? await prUrlOf($, before) : undefined
  const run = await change($, latest => ({ ...rerun(latest), ...(prUrl === undefined || latest.prUrl ? {} : { prUrl }) }))
  if (run?.state === 'running') await resetStatus($, run)
  return run
}

// Dialogs

// The last approval of a phase's file; a re-lock row approves no file.
function lastApproval(approvals: Approval[], phase: PhaseName): Approval | undefined {
  return [...approvals].reverse().find(approval => approval.phase === phase && approval.kind !== 'relock')
}

// The earlier gates' files that changed since their last approval, with their current text.
async function changedSinceApproval($: EngineInterface, run: Run): Promise<{ phase: PhaseName; text: string; sha: string }[]> {
  const changed: { phase: PhaseName; text: string; sha: string }[] = []
  for (const phase of PHASES.slice(0, run.phase).filter(name => GATES.has(name))) {
    const last = lastApproval(run.approvals, phase)
    if (last === undefined) continue
    const text = await readFile($, phasePath(run, phase)).catch(() => undefined)
    if (text === undefined) continue
    const sha = await sha256(text)
    if (sha !== last.sha256) changed.push({ phase, text, sha })
  }
  return changed
}

// The gate or stuck dialog's options: with undecided open points the walk-through takes the place of "Not yet".
// With open points the walk-through comes first, so answering them is the default. While a high-risk question waits for
// its answer, the dialog offers no approval.
function dialogOptions(base: string[], phase: PhaseName, points: number, isWaiting = false): string[] {
  const [first = '', notYet = '', stopLabel = ''] = base
  const open = NOTES.openInApp(FILES[phase])
  if (isWaiting) return points > 0 ? [TEXTS.walkThrough(points, phase), open, stopLabel] : [notYet, open, stopLabel]
  return points > 0 ? [TEXTS.walkThrough(points, phase), first, open, stopLabel] : [first, notYet, stopLabel, open]
}

// What a gate dialog showed: its own file's text and each earlier file it named as changed since approval.
interface GateShown {
  text: string
  earlier: { phase: PhaseName; text: string }[]
}

// The first file whose text differs from what the dialog showed, or that changed since approval only now.
function movedSince(run: Run, shown: GateShown, text: string, earlier: { phase: PhaseName; text: string }[]): string | undefined {
  if (text !== shown.text) return phasePath(run)
  for (const phase of PHASES) {
    const before = shown.earlier.find(file => file.phase === phase)
    const now = earlier.find(file => file.phase === phase)
    if (before?.text !== now?.text) return phasePath(run, phase)
  }
  return undefined
}

async function openGate($: EngineInterface, run: Run): Promise<void> {
  walk = undefined
  dialogOpens++
  const phase = phaseOf(run)
  if (!isGate(phase)) {
    $.ui.log(TEXTS.gateText(phase, run.id))
    return
  }
  // Git's settings changed since the start: the run is blocked, and the person sees the stuck dialog, not the gate.
  if (await gitSettingsChanged($, run)) {
    const blocked = await change($, latest =>
      latest.state === 'gate' ? { ...latest, state: 'blocked', reason: NOTES.gitSettingsChanged, goalActive: false, pendingGoal: false } : latest
    )
    if (blocked?.state === 'blocked') await openStuck($, blocked)
    return
  }
  const next = PHASES[run.phase + 1] ?? 'PR'
  const text = await readFile($, phasePath(run, phase)).catch(() => '')
  const changed = await changedSinceApproval($, run)
  const rows = await keepTrace($, run)
  const waits = phase === 'Intent' ? highRiskUnanswered(text) : []
  const question = [
    TEXTS.gateQuestion(
      phase,
      run.id,
      phase === 'Plan' ? testPathsFrom(text) : [],
      undecidedPoints(text),
      phase === 'Spec' ? outOfScopeOf(rows) : [],
      phase === 'Plan' ? { testCommand: safeCommand(testCommandFrom(text)), plannedPaths: plannedPathsFrom(text).length } : undefined
    ),
    ...(phase === 'Intent' ? intentGateNotes(run, text) : []),
    ...(waits.length > 0 ? [TEXTS.highRiskWaits(waits)] : []),
    ...changed.flatMap(earlier => [TEXTS.changedSinceApproval(FILES[earlier.phase]), ...(earlier.phase === 'Intent' ? [TEXTS.intentChanged] : [])]),
  ].join(' ')
  const options = dialogOptions(TEXTS.gateOptions(next), phase, undecidedPoints(text), waits.length > 0)
  const shown: GateShown = { text, earlier: changed.map(({ phase: earlier, text: was }) => ({ phase: earlier, text: was })) }
  background(
    $,
    'gate dialog',
    askPerson($, question, { options, header: TEXTS.gateHeader }).then(
      answer => onGate($, answer, shown),
      () => onGate($, undefined, shown)
    )
  )
}

// "Open <file> in app", picked or typed under Other, with or without .md, in any case.
function isOpenPick(answer: string | undefined, file: string): boolean {
  const typed = /^open\s+(\S+?)(?:\.md)?\s+in\s+app$/i.exec((answer ?? '').trim())
  return typed !== null && typed[1]?.toLowerCase() === file.replace(/\.md$/, '').toLowerCase()
}

async function absolutePath($: EngineInterface, path: string): Promise<string> {
  return at($, path)
}

// The phase file in the default app: open on macOS, xdg-open elsewhere, else a toast with its path.
async function openInApp($: EngineInterface, run: Run, phase: PhaseName = phaseOf(run)): Promise<void> {
  await openPath($, await absolutePath($, phasePath(run, phase)))
}

async function openPath($: EngineInterface, path: string): Promise<void> {
  for (const opener of ['open', 'xdg-open']) {
    if ((await sh($, [opener, path]))?.exitCode === 0) return
  }
  $.ui.toast(NOTES.openFailed(path))
}

async function onGate($: EngineInterface, answer: string | undefined, shown: GateShown): Promise<void> {
  const run = await current($)
  if (run?.state !== 'gate') return
  const [approveLabel, , stopLabel] = TEXTS.gateOptions(PHASES[run.phase + 1] ?? 'PR')
  if (isOpenPick(answer, FILES[phaseOf(run)])) {
    await openInApp($, run)
    return openGate($, run)
  }
  if (isWalkPick(answer)) {
    if (phaseOf(run) === 'Intent') startIntentWalk(run, shown.text)
    walkThrough($, run)
    return
  }
  if (answer === approveLabel) return approveGate($, run, shown)
  if (answer === stopLabel) {
    await stopRun($)
    $.ui.log(TEXTS.stopped(run.id, run.base))
    return
  }
  if (isTyped(answer, TEXTS.gateOptions(PHASES[run.phase + 1] ?? 'PR'))) {
    typedRequest($, run, answer)
    return
  }
  $.ui.log(TEXTS.gateText(phaseOf(run), run.id))
}

async function lockFor($: EngineInterface, testPaths: string[]): Promise<{ lock?: Lock; dirty?: string; noHead?: true }> {
  if (testPaths.length > 0) {
    const status = await sh($, ['git', 'status', '--porcelain', '--', ...testPaths])
    const paths = changedPaths(status?.stdout ?? '')
    if (status?.exitCode !== 0 || paths.length > 0) {
      return { dirty: shownPaths(paths.length > 0 ? paths : testPaths) }
    }
  }
  const head = await sh($, ['git', 'rev-parse', 'HEAD'])
  const lockedAt = head?.exitCode === 0 ? head.stdout.trim() : ''
  if (lockedAt === '') return { noHead: true }
  const listed = testPaths.length > 0 ? await sh($, ['git', 'ls-files', '--', ...testPaths]) : undefined
  const lockedFiles: Record<string, string> = {}
  for (const file of (listed?.stdout ?? '').split('\n').filter(line => line !== '')) {
    lockedFiles[file] = await sha256(await readFile($, file).catch(() => ''))
  }
  return { lock: { lockedAt, lockedFiles, testPaths } }
}

// Adds rows to the mod's record in its store, then writes approvals.md whole from the record. A run with no record (one
// begun before the mod kept one) starts it from its own rows.
async function recordApprovals($: EngineInterface, run: Run, added: { row: Approval; note?: string }[]): Promise<void> {
  const by = APPROVER
  const before = await readRecord($, run.id)
  const rows: StoredRow[] = [
    ...(before?.rows ?? run.approvals.map(row => ({ ...row, by }))),
    ...added.map(({ row, note }) => ({ ...row, by, ...(note === undefined ? {} : { note }) })),
  ]
  const past = rows.filter(row => row.kind !== 'relock').map(row => PHASES.indexOf(row.phase))
  const record: ApprovalRecord = { approvedPast: Math.max(before?.approvedPast ?? -1, ...past), rows }
  await $.store.set(approvalsKey(run.id), record).catch(error => {
    debug($, `approvals not stored: ${why(error)}`)
  })
  await writeFile($, `changes/${run.id}/approvals.md`, approvalsText(rows))
}

async function storeLock($: EngineInterface, id: string, lock: Lock): Promise<void> {
  const { lockedAt, lockedFiles, testPaths } = lock
  await $.store.set(lockKey(id), { lockedAt, lockedFiles, testPaths, ...planFieldsOf(lock) }).catch(error => {
    debug($, `lock not stored: ${why(error)}`)
  })
}

// A stuck run at Build, Test or PR whose locked acceptance tests differ from the lock now, whatever its reason: the
// person decides on the re-lock before the phase reruns, since the phase's goal must not change the tests.
async function isLockBlock($: EngineInterface, run: Run): Promise<boolean> {
  const phase = phaseOf(run)
  if (run.state !== 'blocked' && run.state !== 'capped' && run.state !== 'interrupted') return false
  if (phase !== 'Build' && phase !== 'Test' && phase !== 'PR') return false
  return run.lockedAt !== undefined && (await testsChanged($, run))
}

// What a re-lock dialog showed: HEAD and each changed locked file with its text; undefined when git can't say.
interface RelockShown {
  head: string
  files: { path: string; text: string | undefined }[]
}

async function relockState($: EngineInterface, run: Run): Promise<RelockShown | undefined> {
  const paths = run.testPaths ?? []
  const diff = await sh($, ['git', 'diff', '--name-only', run.lockedAt ?? 'HEAD', '--', ...paths])
  const untracked = await sh($, ['git', 'ls-files', '--others', '--exclude-standard', '--', ...paths])
  const head = await sh($, ['git', 'rev-parse', 'HEAD'])
  if ([diff, untracked, head].some(result => result?.exitCode !== 0)) return undefined
  const names = [diff, untracked].flatMap(result => (result?.stdout ?? '').split('\n').filter(line => line !== ''))
  const files: RelockShown['files'] = []
  for (const path of [...new Set(names)].sort()) files.push({ path, text: await readFile($, path).catch(() => undefined) })
  return { head: head?.stdout.trim() ?? '', files }
}

function sameRelock(shown: RelockShown, now: RelockShown): boolean {
  return JSON.stringify(shown) === JSON.stringify(now)
}

// The person's re-lock of exactly what the dialog showed: plan.md as approved, the test changes committed; then the
// new lock, its re-lock row (the Plan approval's hash, no new approval of plan.md), and the rerun.
async function relock($: EngineInterface, run: Run, shown: RelockShown): Promise<void> {
  const now = await relockState($, run)
  if (now === undefined || !sameRelock(shown, now)) {
    $.ui.toast(now === undefined ? NOTES.relockUnreadable : NOTES.relockMoved)
    await openStuck($, run)
    return
  }
  const file = phasePath(run, 'Plan')
  const plan = await readFile($, file).catch(() => undefined)
  const planApproval = lastApproval(run.approvals, 'Plan')
  if (plan === undefined || (await sha256(plan)) !== planApproval?.sha256) {
    $.ui.toast(NOTES.planChanged)
    return
  }
  const found = await lockFor($, run.testPaths ?? [])
  if (found.dirty !== undefined || found.lock === undefined) {
    $.ui.toast(found.dirty !== undefined ? TEXTS.relockCommitFirst : NOTES.relockNoHead)
    await openStuck($, run)
    return
  }
  const lock = found.lock
  const approval: Approval = {
    phase: 'Plan',
    file,
    sha256: planApproval.sha256,
    at: await $.clock.now(),
    lockedAt: lock.lockedAt,
    kind: 'relock',
  }
  await recordApprovals($, run, [{ row: approval, note: 'tests re-locked' }])
  await storeLock($, run.id, { ...lock, ...planFieldsOf(run) })
  await change($, latest => ({
    ...latest,
    lockedAt: lock.lockedAt,
    lockedFiles: lock.lockedFiles,
    approvals: [...latest.approvals, approval],
  }))
  if ((await rerunPhase($))?.state === 'running') await freshGoal($, true)
}

// Approves exactly what the dialog showed: a file edited while it was open sends the person back to the dialog.
// intent.md's front matter with open-at-approval: <n>, in place of an earlier one or before its closing line.
function withOpenAtApproval(text: string, points: number): string {
  const lines = text.split('\n')
  if (lines[0]?.replace(/^\uFEFF/, '').trimEnd() !== '---') return text
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---')
  if (end < 0) return text
  const entry = `open-at-approval: ${points}${lines[end]?.endsWith('\r') ? '\r' : ''}`
  const at = lines.findIndex((line, i) => i > 0 && i < end && line.startsWith('open-at-approval:'))
  if (at >= 0) lines[at] = entry
  else lines.splice(end, 0, entry)
  return lines.join('\n')
}

// intent.md at its approval: the count of its open questions goes into its front matter before the hash.
async function markOpenAtApproval($: EngineInterface, file: string, text: string, points: number): Promise<string> {
  const marked = withOpenAtApproval(text, points)
  if (marked === text) return text
  return writeFile($, file, marked).then(
    () => marked,
    error => {
      debug($, `${file}: open-at-approval not written: ${why(error)}`)
      return text
    }
  )
}

async function approveGate($: EngineInterface, run: Run, shown: GateShown): Promise<void> {
  const phase = phaseOf(run)
  const file = phasePath(run)
  const read = await readFile($, file).catch(() => '')
  const changed = await changedSinceApproval($, run)
  const moved = movedSince(run, shown, read, changed)
  if (moved !== undefined) {
    $.ui.toast(NOTES.changedWhileOpen(moved))
    const latest = await current($)
    if (latest?.state === 'gate') await openGate($, latest)
    return
  }
  // Typed under Other, the approve label still waits for the high-risk answers.
  const waits = phase === 'Intent' ? highRiskUnanswered(read) : []
  if (waits.length > 0) {
    $.ui.log(TEXTS.highRiskRefused(waits))
    return
  }
  const found: { lock?: Lock; dirty?: string; noHead?: true } = phase === 'Plan' ? await lockFor($, testPathsFrom(read)) : {}
  if (found.lock)
    found.lock = {
      ...found.lock,
      ...planFieldsOf({
        plannedPaths: plannedPathsFrom(read),
        testCommand: testCommandFrom(read),
        plannedTools: plannedToolsFrom(read),
        testEnvKeep: testEnvKeepFrom(read),
      }),
    }
  if (found.dirty !== undefined) {
    $.ui.log(TEXTS.preflightDirty(found.dirty))
    return
  }
  if (found.noHead) {
    $.ui.toast(NOTES.noLock)
    return
  }
  const points = phase === 'Intent' ? undecidedPoints(read) : undefined
  const text = points === undefined ? read : await markOpenAtApproval($, file, read, points)
  const at = await $.clock.now()
  const approval: Approval = { phase, file, sha256: await sha256(text), at }
  if (found.lock) approval.lockedAt = found.lock.lockedAt
  // An earlier gate's file edited since its approval is approved again, in its current form, before this one.
  const again: Approval[] = changed.map(earlier => ({
    phase: earlier.phase,
    file: phasePath(run, earlier.phase),
    sha256: earlier.sha,
    at,
  }))
  const note = points === undefined ? undefined : NOTES.openPoints(points)
  await recordApprovals($, run, [...again.map(row => ({ row })), { row: approval, note }])
  if (found.lock) await storeLock($, run.id, found.lock)
  const approved = await change($, latest => approve({ ...latest, approvals: [...latest.approvals, ...again] }, approval, found.lock))
  await keepTrace($, run)
  if (approved?.state === 'running') await freshGoal($, false)
}

async function openStuck($: EngineInterface, run: Run): Promise<void> {
  walk = undefined
  dialogOpens++
  const phase = phaseOf(run)
  const text = await readFile($, phasePath(run)).catch(() => '')
  const isNotNeeded = phaseStatus(text) === 'blocked' && frontMatterValue(text, 'not-needed') === 'yes'
  if (phase === 'Intent' && run.state === 'blocked' && isNotNeeded) {
    openIntentStop($, run)
    return
  }
  if (isFixCapBlock(run)) {
    background(
      $,
      'stuck dialog',
      askPerson($, TEXTS.stuckFixCap(phase, run.reason ?? NOTES.noReason, run.id), {
        options: TEXTS.fixCapOptions(fixStateOf(run)),
        header: TEXTS.stuckHeader,
      }).then(
        answer => onStuck($, answer),
        () => onStuck($, undefined)
      )
    )
    return
  }
  const question = run.state === 'capped' ? TEXTS.stuckCapped(phase, run.id) : TEXTS.stuckBlocked(phase, run.reason ?? NOTES.noReason, run.id)
  const [rerunLabel = '', , stopLabel = ''] = TEXTS.stuckOptions(phase)
  const isRelock = await isLockBlock($, run)
  const shown = isRelock ? await relockState($, run) : undefined
  if (isRelock && shown === undefined) $.ui.toast(NOTES.relockUnreadable)
  const asked =
    shown === undefined
      ? question
      : TEXTS.relockQuestion(
          phase,
          shown.files.map(file => file.path)
        )
  const options =
    shown === undefined
      ? dialogOptions(TEXTS.stuckOptions(phase), phase, undecidedPoints(text))
      : [TEXTS.relockOption, rerunLabel, NOTES.openInApp(FILES.Plan), stopLabel]
  background(
    $,
    'stuck dialog',
    askPerson($, asked, { options, header: TEXTS.stuckHeader }).then(
      answer => onStuck($, answer, shown),
      () => onStuck($, undefined, shown)
    )
  )
}

async function onStuck($: EngineInterface, answer: string | undefined, shown?: RelockShown): Promise<void> {
  const run = await current($)
  if (run === null || (run.state !== 'blocked' && run.state !== 'capped' && run.state !== 'interrupted')) return
  const [rerunLabel, , stopLabel] = TEXTS.stuckOptions(phaseOf(run))
  if (isFixCapBlock(run)) {
    const state = fixStateOf(run)
    const choice = stuckChoices(state).find(item => TEXTS.fixCapChoiceLabel(item, state) === answer)
    if (choice !== undefined) {
      await applyFixChoice($, run, choice)
      return
    }
    if (answer === stopLabel) {
      await stopRun($)
      $.ui.log(TEXTS.stopped(run.id, run.base))
    } else {
      $.ui.log(TEXTS.stuckContinue(phaseOf(run)))
    }
    return
  }
  const isRelock = shown !== undefined
  const shownFile = isRelock ? 'Plan' : phaseOf(run)
  if (isRelock && answer === TEXTS.relockOption) {
    await relock($, run, shown)
  } else if (isOpenPick(answer, FILES[shownFile])) {
    await openInApp($, run, shownFile)
    await openStuck($, run)
  } else if (!isRelock && isWalkPick(answer)) {
    walkThrough($, run)
  } else if (answer === rerunLabel) {
    if (isRelock || !(await acceptDoneFile($, run))) {
      if ((await rerunPhase($))?.state === 'running') await freshGoal($, true)
    }
  } else if (answer === stopLabel) {
    await stopRun($)
    $.ui.log(TEXTS.stopped(run.id, run.base))
  } else if (!isRelock && isTyped(answer, TEXTS.stuckOptions(phaseOf(run)))) {
    typedRequest($, run, answer)
  } else {
    $.ui.log(TEXTS.stuckContinue(phaseOf(run)))
  }
}

// The stuck state of the fix push cap: a blocked run whose reason is the cap's.
function isFixCapBlock(run: Run): boolean {
  return run.state === 'blocked' && isFixCapReason(run.reason)
}

// The person's choice at the cap: the numbers change as choose says (a rerun changes none), the choice is logged on this machine
// only, and the phase runs again.
async function applyFixChoice($: EngineInterface, run: Run, choice: StuckChoice): Promise<void> {
  const next = await change($, latest => ({ ...latest, ...choose(fixStateOf(latest), choice) }))
  await logFixChoice($, run.id, choice, fixStateOf(next ?? run))
  if ((await rerunPhase($))?.state === 'running') await freshGoal($, true)
}

// One line per choice in the Git directory, never in a commit, the pull request or the ticket system.
async function logFixChoice($: EngineInterface, id: string, choice: StuckChoice, state: FixState): Promise<void> {
  try {
    const name = `goal-and-do/fix-choices-${id}.log`
    const found = await sh($, ['git', 'rev-parse', '--git-path', name])
    const path = found?.exitCode === 0 && found.stdout.trim() !== '' ? found.stdout.trim() : `.git/${name}`
    const old = await readFile($, path).catch(() => '')
    const time = new Date(await $.clock.now()).toISOString()
    await writeFile($, path, `${old}${old === '' || old.endsWith('\n') ? '' : '\n'}${time} ${choice}: count ${state.fixPushes}, cap ${state.fixCap}\n`)
  } catch (error) {
    debug($, `fix choice not logged: ${nameOf(error)}`)
  }
}

// intent.md says the change isn't needed: the person decides whether the run stops.
function openIntentStop($: EngineInterface, run: Run): void {
  const options = [...TEXTS.intentBlockedOptions, NOTES.openInApp(FILES.Intent)]
  background(
    $,
    'intent stop dialog',
    askPerson($, TEXTS.intentBlocked(run.reason ?? NOTES.noReason), { options, header: TEXTS.stuckHeader }).then(
      answer => onIntentStop($, answer),
      () => onIntentStop($, undefined)
    )
  )
}

async function onIntentStop($: EngineInterface, answer: string | undefined): Promise<void> {
  const run = await current($)
  if (run?.state !== 'blocked' || phaseOf(run) !== 'Intent') return
  const [stopLabel, rerunLabel] = TEXTS.intentBlockedOptions
  if (answer === stopLabel) {
    await stopRun($)
    $.ui.log(TEXTS.stopped(run.id, run.base))
  } else if (answer === rerunLabel) {
    if ((await rerunPhase($))?.state === 'running') await freshGoal($, true)
  } else if (isOpenPick(answer, FILES.Intent)) {
    await openInApp($, run)
    await openStuck($, run)
  } else {
    $.ui.log(TEXTS.stuckContinue('Intent'))
  }
}

// The rule dialog: each rule an option, its label the command or tool and its description what the rule allows. Several
// rules are ticked, one is allowed or not. Called from a hook, never from a render hook.
function openRules($: EngineInterface, rules: string[], scope: 'local' | undefined): void {
  const labels = ruleChoiceLabels(rules)
  const choices = rules.map((rule, i) => {
    const label = labels[i] ?? ruleLabel(rule)
    const allows = describeRule(rule)
    return { label, description: label === ruleLabel(rule) ? allows : `${ruleLabel(rule)}: ${allows}` }
  })
  const isOne = rules.length === 1
  const ask = { header: TEXTS.ruleHeader, options: isOne ? [...choices, TEXTS.ruleNotNow] : choices, multiSelect: !isOne }
  background(
    $,
    'rule dialog',
    askChoices($, TEXTS.ruleQuestion(rules.length), ask).then(
      answer =>
        onRules(
          $,
          pickedRules(answer, labels).flatMap(i => rules[i] ?? []),
          scope
        ),
      () => undefined
    )
  )
}

async function onRules($: EngineInterface, chosen: string[], scope: 'local' | undefined): Promise<void> {
  if (chosen.length === 0) return
  if (scope === 'local') return writeRules($, chosen, 'local')
  const where = await askPerson($, TEXTS.ruleWhere, { options: TEXTS.ruleWhereOptions, header: TEXTS.ruleHeader }).catch(() => undefined)
  if (where === TEXTS.ruleWhereOptions[0]) await writeRules($, chosen, 'project')
  else if (where === TEXTS.ruleWhereOptions[1]) await writeRules($, chosen, 'local')
}

async function writeRules($: EngineInterface, rules: string[], scope: 'project' | 'local'): Promise<void> {
  const file = SETTINGS[scope]
  const merged = mergeAllowRules(await readFile($, file).catch(() => undefined), rules)
  if ('error' in merged) {
    $.ui.log(NOTES.settingsLeft(file, merged.error))
    return
  }
  await writeFile($, file, merged.text)
  learnedFiles.add(file)
  if (scope === 'local') {
    const ignored = await sh($, ['git', 'check-ignore', '-q', file])
    const excluded = ignored?.exitCode === 0 ? undefined : await exclude($, file)
    if (excluded !== undefined) debug($, `${excluded.path} not written: ${excluded.error}`)
  }
  await change($, run => ({ ...run, suggested: run.suggested.filter(rule => !rules.includes(rule)) }))
  if (merged.added.length > 0) $.ui.log(NOTES.rulesAdded(file, merged.added))
}

async function offerRules($: EngineInterface): Promise<void> {
  const run = await current($)
  if (run === null) return
  const fresh = run.suggested.filter(rule => !run.offered.includes(rule)).slice(0, 4)
  if (fresh.length === 0) return
  await change($, latest => offer(latest, fresh))
  openRules($, fresh, undefined)
}

// The end of a main-loop turn

async function endGoal($: EngineInterface, run: Run): Promise<Outcome> {
  const phase = phaseOf(run)
  const file = await phaseFile($, run)
  // Build and Test end with the lock check whatever the phase file says: a skill that saw the changed tests and set
  // its file to blocked leaves the person the re-lock all the same.
  const locked = (phase === 'Build' || phase === 'Test') && (await testsChanged($, run))
  if (locked && file.status === 'blocked') debug($, `the skill's reason, overridden by the lock: ${openPoint(file.text) ?? 'none'}`)
  const decided = await change($, latest => {
    if (latest.state !== 'running') return { ...latest, goalActive: false }
    if (locked) return afterStatus(latest, 'blocked', NOTES.testsChanged)
    if (file.status === 'done') return afterStatus(latest, 'done')
    if (file.status === 'blocked') return afterStatus(latest, 'blocked', openPoint(file.text) ?? lastReason ?? NOTES.noReason)
    return afterStatus(latest, file.status, TEXTS.goalEnded(lastReason ?? NOTES.noReason))
  })
  if (decided === null) return { action: 'none' }
  await keepTrace($, run)
  // After the turn's end hook has returned, as the signals file of the PR phase: a slow Git must not hold the phase change.
  if (phase === 'Build' || phase === 'Test') $.clock.after(0, () => void writeWeakening($, run, phase === 'Build' ? 'build-end' : 'test-end'))
  const outcome = await afterDecision($, run, decided)
  debug($, `turn.complete phase=${phase} state=${decided.state} file=${phasePath(run)} status=${file.status ?? 'none'} action=${outcome.action}`)
  return outcome
}

async function afterDecision($: EngineInterface, run: Run, decided: Run): Promise<Outcome> {
  switch (decided.state) {
    case 'gate':
      background($, 'goal clear', clearGoal($))
      await openGate($, decided)
      return { action: 'gate dialog' }
    case 'running':
      void freshGoal($, false)
      return { action: `goal ${phaseOf(decided)}` }
    case 'finished': {
      background($, 'goal clear', clearGoal($))
      const pr = await readFile($, phasePath(run, 'PR')).catch(() => '')
      const written = frontMatterValue(pr, 'pr-url') ?? ''
      const url = /^https?:\/\//.test(written) ? written : (decided.prUrl ?? '')
      const isDraft = url === '' ? undefined : await draftState($, decided)
      const finish = url === '' ? TEXTS.finishedNoPr : isDraft === false ? TEXTS.finishedPrNotDraft(url) : TEXTS.finishedPr(url)
      for (const line of await summaryLines($, decided, pr, url, isDraft)) $.ui.log(line)
      // Asked now, while the turn's end hook runs; it runs once the session is idle.
      background($, 'status', showStatus($))
      return { action: 'finished', text: `${finish} ${TEXTS.denialCount(decided.deniedCount ?? 0)}` }
    }
    default:
      background($, 'goal clear', clearGoal($))
      await openStuck($, decided)
      return { action: 'stuck dialog' }
  }
}

// Whether the PR is a draft, as gh says at the root; undefined when gh can't say.
async function draftState($: EngineInterface, run: Run): Promise<boolean | undefined> {
  const viewed = await sh($, ['gh', 'pr', 'view', `sdd/${run.id}`, '--json', 'isDraft'])
  if (viewed?.exitCode !== 0) return undefined
  try {
    const isDraft = (JSON.parse(viewed.stdout) as { isDraft?: unknown }).isDraft
    return typeof isDraft === 'boolean' ? isDraft : undefined
  } catch {
    return undefined
  }
}

// Review findings by severity: list items that start with Blocker, Major or Minor, and table cells that hold one,
// under a findings heading, up to the next heading of the same or a higher level.
function findingCounts(text: string): { blockers: number; majors: number; minors: number } {
  const counts = { blockers: 0, majors: 0, minors: 0 }
  let level = 0
  for (const line of text.split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (heading) {
      const depth = heading[1]?.length ?? 1
      if (/finding/i.test(heading[2] ?? '')) level = depth
      else if (level > 0 && depth <= level) level = 0
      continue
    }
    if (level === 0) continue
    const marker = severityOf(line)
    if (marker === 'blocker') counts.blockers++
    else if (marker === 'major') counts.majors++
    else if (marker === 'minor') counts.minors++
  }
  return counts
}

// A list item that starts with a severity, or a table row with a cell that holds only one.
function severityOf(line: string): string | undefined {
  if (/^\s*\|/.test(line)) {
    for (const cell of line.split('|')) {
      const found = /^\s*(?:\*\*|__)?(blocker|major|minor)(?:\*\*|__)?\s*$/i.exec(cell)?.[1]
      if (found !== undefined) return found.toLowerCase()
    }
    return undefined
  }
  return /^\s*[-*+]\s+(?:\*\*|__)?\s*(Blocker|Major|Minor)\b/i.exec(line)?.[1]?.toLowerCase()
}

// The end-of-run summary, one transcript line each.
async function summaryLines($: EngineInterface, run: Run, pr: string, url: string, isDraft: boolean | undefined): Promise<string[]> {
  const rows = Object.values(run.usage.rows)
  const io = rows.reduce((sum, row) => sum + Object.values(row.models).reduce((all, c) => all + c.input + c.output, 0), 0)
  const turns = rows.reduce((sum, row) => sum + row.turns, 0)
  const lines = [TEXTS.summaryHead(run.id, (await $.clock.now()) - run.startedAt, io, turns, guardLevelOf(run))]
  if (url === '') {
    lines.push(TEXTS.summaryNoPr)
  } else {
    const rounds = Number(frontMatterValue(pr, 'fix-rounds') ?? 0)
    lines.push(TEXTS.summaryPr(prNumber(url) ?? '?', url, frontMatterValue(pr, 'checks') ?? 'none', Number.isFinite(rounds) ? rounds : 0))
    // pr.md says whether the check right after creation found a draft; a pr.md without that line counts as a draft.
    const createdAsDraft = !['no', 'unreadable'].includes(frontMatterValue(pr, 'draft-at-create') ?? '')
    if (endDraftWarning(createdAsDraft, isDraft) !== undefined) lines.push(TEXTS.summaryNotDraft)
  }
  const { blockers, majors, minors } = findingCounts(pr)
  if (blockers + majors + minors > 0) lines.push(TEXTS.summaryReview(blockers, majors, minors))
  lines.push(TEXTS.summaryNext(run.id))
  return lines
}

// The usage table as the status command's reply, which the transcript draws as Markdown. The mod's own run of the
// command starts while the hook that asks for it still runs: one started after that hook returned can reach no
// command.run hook of the mod's, and the engine then prints its note that none answered. When the mod's hook does not
// answer, or the engine refuses the run, the status goes to the transcript as a log line.
async function showStatus($: EngineInterface): Promise<void> {
  const before = statusAnswers
  try {
    const isRun = await $.command.run({ command: 'goal-and-do', args: 'status' }).then(
      () => true,
      (error: unknown) => {
        debug($, `status: ${nameOf(error)}`)
        return false
      }
    )
    if (isRun && statusAnswers !== before) return
    if (isRun) debug($, 'status: not answered by the mod')
    const run = await current($)
    $.ui.log(run === null ? TEXTS.noRun : compactUsage(run.usage, NOTES.statusShort(run.id), NOTES.statusFull))
  } catch (error) {
    debug($, `status: ${nameOf(error)}`)
  }
}

async function afterMainTurn($: EngineInterface, run: Run): Promise<string | undefined> {
  let outcome: Outcome
  if (run.pendingClear) {
    background($, 'goal clear', clearGoal($))
    await change($, latest => ({ ...latest, pendingClear: false }))
    outcome = { action: 'goal clear' }
    debug($, `turn.complete phase=${phaseOf(run)} state=${run.state} action=${outcome.action}`)
  } else if (run.pendingGoal && run.state === 'running' && !run.goalActive) {
    void startGoal($)
    outcome = { action: 'pending goal' }
    debug($, `turn.complete phase=${phaseOf(run)} state=${run.state} action=${outcome.action}`)
  } else if (run.goalActive && run.state === 'running' && isWaitingOnBackground) {
    debug($, `turn.complete phase=${phaseOf(run)} state=${run.state} action=waiting on background work`)
    return undefined
  } else if (run.goalActive) {
    outcome = await endGoal($, run)
  } else {
    outcome = { action: 'none' }
  }
  await offerRules($)
  return outcome.text
}

// The command

function originName(origin: PromptOrigin): string {
  return origin.kind === 'plugin' ? `plugin ${origin.name}` : origin.kind
}

async function nextStep($: EngineInterface, run: Run | null): Promise<string | undefined> {
  if (run === null) return TEXTS.noRun
  if (refused !== undefined && isRefused(run)) return refused.text
  switch (nextAction(run)) {
    case 'gate-dialog':
      await openGate($, run)
      return undefined
    case 'rerun':
      // A rerun would only block again on the changed tests: the person decides in the re-lock dialog.
      if (await isLockBlock($, run)) {
        await openStuck($, run)
        return undefined
      }
      if (await acceptDoneFile($, run)) return undefined
      await rerunPhase($)
      $.clock.after(0, () => {
        background($, 'goal rerun', freshGoal($, true))
      })
      return undefined
    case 'start-pending':
      $.clock.after(0, () => {
        background($, 'goal start', startGoal($))
      })
      return undefined
    case 'refuse-goal-running':
      return TEXTS.goalRunning(phaseOf(run))
    case 'refuse-finished':
      return TEXTS.runFinished(run.id)
    case 'refuse-stopped':
      return TEXTS.runStopped(run.id, run.base)
    case 'no-run':
      return TEXTS.noRun
  }
}

// The phase files are read side by side, so the reply waits for the slowest read, not their sum.
async function statusText($: EngineInterface, run: Run | null): Promise<string> {
  if (run === null) return TEXTS.noRun
  const statuses = await Promise.all(PHASES.map(phase => statusOf($, run, phase)))
  const lines = PHASES.map((phase, i) => `${FILES[phase]}: ${statuses[i] ?? '-'}`)
  const band = bandText(run, 1000, await turnClock($, run))
  const head = band === '' ? `${run.id} · ${run.state}` : `${run.id}\n${band}`
  return `${head}\n\n${lines.join('\n')}\n\n${formatUsage(run.usage, USAGE_FOOTER, guardLevelOf(run))}`
}

async function allowRules($: EngineInterface, run: Run | null, scope: 'local' | undefined): Promise<string | undefined> {
  if (run === null) return TEXTS.noRun
  const rules = run.suggested.slice(0, 4)
  if (rules.length === 0) return NOTES.noSuggestions
  await change($, latest => offer(latest, rules))
  openRules($, rules, scope)
  return undefined
}

// The person's switch of an active run to the other guard level: logged with its time, nothing else of the run changes.
async function levelCommand($: EngineInterface, run: Run | null, to: GuardLevel): Promise<string> {
  if (run === null) return TEXTS.noRun
  if (run.state === 'finished') return TEXTS.runFinished(run.id)
  if (!isActive(run)) return TEXTS.runStopped(run.id, run.base)
  const from = guardLevelOf(run)
  if (from === to) return TEXTS.levelUnchanged(to)
  const now = await $.clock.now()
  await change($, latest => switchLevel(latest, to, now))
  await $.store.set(levelKey(run.id), to).catch(error => {
    debug($, `guard level not stored: ${why(error)}`)
  })
  return TEXTS.levelSwitched(from, to)
}

async function stopCommand($: EngineInterface, run: Run | null): Promise<string> {
  refused = undefined
  if (run === null) return TEXTS.noRun
  if (run.state === 'finished') return TEXTS.runFinished(run.id)
  if (!isActive(run)) return TEXTS.runStopped(run.id, run.base)
  await stopRun($)
  return TEXTS.stopped(run.id, run.base)
}

// The command's fixed reply when its handler failed: it names the subcommand from the mod's own list, never the
// arguments.
function commandFailed(kind: ReturnType<typeof parseArgs>['kind']): string {
  return kind === 'status' ? NOTES.statusFailed : NOTES.commandFailed(kind)
}

// The command never fails silently: an error goes to the debug log as the subcommand and the error's name, and the person
// reads a fixed line.
async function answerCommand($: EngineInterface, args: string, origin: PromptOrigin): Promise<string | undefined> {
  const { kind } = parseArgs(args)
  try {
    return await commandText($, args, origin)
  } catch (error) {
    debug($, `${kind}: ${nameOf(error)}`)
    return commandFailed(kind)
  }
}

async function commandText($: EngineInterface, args: string, origin: PromptOrigin): Promise<string | undefined> {
  await refreshRoot($)
  const parsed = parseArgs(args)
  const isPersonal = ['start', 'next', 'allow', 'allow local', 'level'].includes(parsed.kind)
  if (isPersonal && origin.kind !== 'composer') return TEXTS.notFromPerson(args.trim(), originName(origin))
  const run = await current($)
  // A level switch starts no goal, so a goal turn that runs does not hold it back.
  if (isPersonal && parsed.kind !== 'level' && turnRunning) return TEXTS.goalRunning(run === null ? PHASES[0] : phaseOf(run))
  // A person's status or next opens the pane again: Claude Code may have kept it undrawn.
  // A refused run waits for the person to stop it: its pane stays as it is.
  const isOpenable = run !== null && isActive(run) && !isRefused(run)
  if ((parsed.kind === 'status' || parsed.kind === 'next') && origin.kind === 'composer' && isOpenable) openPane($)
  switch (parsed.kind) {
    case 'usage':
      return TEXTS.usage
    case 'misplaced base':
      return TEXTS.baseMisplaced
    case 'subcommand words':
      return TEXTS.subcommandWords(args.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
    case 'misplaced strict':
      return TEXTS.strictMisplaced
    case 'start':
      return startRun($, parsed.input, parsed.base, parsed.strict)
    case 'level':
      return levelCommand($, run, parsed.level)
    case 'next':
      return nextStep($, run)
    case 'status':
      // The mod's own status run counts its answers, so the finish knows whether its hook was reached.
      if (origin.kind === 'plugin' && origin.name === PLUGIN_NAME) statusAnswers++
      return statusText($, run)
    case 'allow':
      return allowRules($, run, undefined)
    case 'allow local':
      return allowRules($, run, 'local')
    case 'stop':
      return stopCommand($, run)
  }
}

// Tool calls

// The PR body file of a run, where git keeps its files; each run has its own (as its title file), so no line of an
// earlier run's body reaches this run's PR.
const prBodyName = (id: string) => `goal-and-do/pr-body-${id}.md`

// A body file of the run's own: under changes/<id>/, or the run's own body file in .git/goal-and-do/.
function isRunBodyFile(path: string | undefined, id: string): boolean {
  if (path === undefined || !isSafePath(path)) return false
  const file = path.replace(/^(?:\.\/)+/, '')
  const folder = `changes/${id}/`
  return (file.startsWith(folder) && file.length > folder.length) || file === `.git/${prBodyName(id)}`
}

// The flags a PR follow-up may carry, per subcommand: true for a flag that takes a value.
const PR_FLAGS: Record<string, Record<string, boolean>> = {
  create: { '--draft': false, '--base': true, '--head': true, '--title': true, '--body-file': true },
  checks: { '--watch': false, '--interval': true, '--json': true, '--required': false, '--fail-fast': false },
  edit: { '--body-file': true, '--title': true },
}

function isPrFlagValue(flag: string, value: string | undefined, run: Run): boolean {
  if (value === undefined || value === '' || value.startsWith('-')) return false
  switch (flag) {
    case '--body-file':
      return isRunBodyFile(value, run.id)
    case '--head':
      return value === `sdd/${run.id}`
    case '--base':
      return value === run.base
    case '--interval':
      return /^\d+$/.test(value)
    case '--json':
      return /^[A-Za-z]+(?:,[A-Za-z]+)*$/.test(value)
    default:
      return true
  }
}

// gh pr create, checks or edit with only the listed flags, and create as a draft against the run's own base; checks and
// edit name the run's own PR, by sdd/<id> or the number of its PR URL, and no other.
function isAllowedPrCall(words: string[], run: Run): boolean {
  const { id, prUrl } = run
  const sub = words[2] ?? ''
  const flags = PR_FLAGS[sub]
  if (words[0] !== 'gh' || words[1] !== 'pr' || flags === undefined) return false
  const positional: string[] = []
  let hasDraft = false
  let hasBase = false
  for (let i = 3; i < words.length; i++) {
    const word = words[i] ?? ''
    if (!word.startsWith('-')) {
      positional.push(word)
      continue
    }
    const at = word.indexOf('=')
    const flag = at < 0 ? word : word.slice(0, at)
    const takesValue = flags[flag]
    if (takesValue === undefined) return false
    if (!takesValue) {
      if (at >= 0) return false
      hasDraft ||= flag === '--draft'
      continue
    }
    const value = at < 0 ? words[++i] : word.slice(at + 1)
    if (!isPrFlagValue(flag, value, run)) return false
    hasBase ||= flag === '--base'
  }
  if (sub === 'create') return hasDraft && hasBase && positional.length === 0
  const [named, ...more] = positional
  return more.length === 0 && named !== undefined && (named === `sdd/${id}` || named === prNumber(prUrl))
}

// After the push dialog's yes: the allowed push itself, and the draft PR's create, checks and edit, alone or behind
// timeout <n> and nothing else.
function isPrFollowUp(input: unknown, run: Run): boolean {
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== 'string') return false
  if (command === allowedPush) return true
  if (/[<>`$]/.test(command)) return false
  const lead = /^\s*(timeout\s+\d+[smhd]?\s+)?gh\s/.exec(command)
  if (lead === null) return false
  const segments = segmentsOf(command, true)
  const segment = segments[0]
  if (segments.length !== 1 || segment === undefined) return false
  if (segment.env.length > 0 || segment.unparseable || segment.xargs || (segment.wrapped && lead[1] === undefined)) {
    return false
  }
  return isHeadView(command, run.id) || isDraftView(command, run.id) || isBodyView(command, run.id) || isAllowedPrCall(segment.words, run)
}

// An ask the engine's defaults made: no settings rule, option check, classic hook or plugin behind it.
function isDefaultAsk(r: { decision: string; rule?: string; setting?: string; hook?: string; plugin?: string }): boolean {
  return r.decision === 'ask' && r.rule === undefined && r.setting === undefined && r.hook === undefined && r.plugin === undefined
}

async function askPush($: EngineInterface, run: Run, options: string[], extra: string): Promise<string | undefined> {
  const found = await read($, footprintAtom).catch(() => null)
  const question = [TEXTS.pushQuestion(run.id), pushSignals(found ?? null, run.deniedCount ?? 0), extra].filter(part => part !== '').join(' ')
  return askPerson($, question, { options, header: TEXTS.pushHeader }).catch(() => undefined)
}

// The run's PR body in the git dir, and pr.md when it exists; a missing body is said in a toast. Another run's body is
// never opened.
async function openPrBody($: EngineInterface, run: Run): Promise<void> {
  const name = prBodyName(run.id)
  const found = await sh($, ['git', 'rev-parse', '--git-path', name])
  const body = await at($, found?.exitCode === 0 && found.stdout.trim() !== '' ? found.stdout.trim() : `.git/${name}`)
  if (!(await fileExists($, body).catch(() => false))) {
    $.ui.toast(NOTES.prBodyMissing(body))
    return
  }
  await openPath($, body)
  const pr = phasePath(run, 'PR')
  if (await fileExists($, pr).catch(() => false)) await openPath($, await at($, pr))
}

// The first of intent.md, spec.md and plan.md whose text differs from its last approval in the mod's record; a file
// that can't be read counts as changed.
async function approvedFileChanged($: EngineInterface, run: Run, approvals: Approval[]): Promise<string | undefined> {
  for (const phase of PHASES.filter(isGate)) {
    const last = lastApproval(approvals, phase)
    if (last === undefined) continue
    const text = await readFile($, phasePath(run, phase)).catch(() => undefined)
    if (text === undefined || (await sha256(text)) !== last.sha256) return FILES[phase]
  }
  return undefined
}

// Where a path lands, every symbolic link followed, resolved one part at a time from a folder already resolved, so a
// .. after a link goes where the link leads. A part not there yet stays as it is; '' when a part leads nowhere or can't be
// read. stat follows a link, so a link whose target is gone reads as missing: a part is not there only when stat says
// ENOENT and its folder, which stat showed is there, lists no entry of its name (in any case, as on a case-insensitive
// disk), since the mod can't read a link's target. The parts below a missing one are missing too, with no more calls,
// until a .. climbs back to the folder that holds it.
async function landing($: EngineInterface, path: string): Promise<string> {
  const realOf = async (at: string): Promise<string | null | undefined> => {
    let isMissing = false
    const stat = await $.fs.stat(at, { resolve: true }).catch((error: unknown) => {
      isMissing = /\bENOENT\b/.test(why(error))
      return undefined
    })
    if (stat === undefined) return isMissing ? undefined : null
    return stat.realPath ?? null
  }
  const isListed = async (folder: string, name: string): Promise<boolean | undefined> => {
    const same = (entry: string) => entry.normalize('NFC').toLowerCase() === name.normalize('NFC').toLowerCase()
    const entries = await $.fs.list(folder).catch(() => undefined)
    return entries === undefined ? undefined : entries.some(entry => same(entry.name))
  }
  let place = await realOf(path.startsWith('/') ? '/' : '.')
  if (typeof place !== 'string') return ''
  // The folder that is there and holds the first missing part; undefined while every part so far is there.
  let missingIn: string | undefined
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      place = place.slice(0, place.lastIndexOf('/')) || '/'
      if (missingIn !== undefined && !place.startsWith(`${missingIn.replace(/\/+$/, '')}/`)) missingIn = undefined
      continue
    }
    // The loop narrows place through next; without the annotation, next's type depends on itself.
    // eslint-disable-next-line @typescript-eslint/no-inferrable-types
    const next: string = `${place.replace(/\/+$/, '')}/${part}`
    if (missingIn !== undefined) {
      place = next
      continue
    }
    const found = await realOf(next)
    if (found === null) return ''
    if (found === undefined) {
      if ((await isListed(place, part)) !== false) return ''
      missingIn = place
    }
    place = found ?? next
  }
  return place
}

// The mod's store folder: <config folder>/plugins/store, the config folder from CLAUDE_CONFIG_DIR or else HOME's .claude,
// as spelled and where it lands; undefined when neither variable is set. Found once and kept.
let storeDirs: string[] | undefined
async function storeFolder($: EngineInterface): Promise<string[] | undefined> {
  if (storeDirs !== undefined) return storeDirs
  const configured = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  const home = await $.env.get('HOME').catch(() => undefined)
  const config = configured !== undefined && configured !== '' ? configured : home !== undefined && home !== '' ? `${home}/.claude` : ''
  if (!config.startsWith('/')) return undefined
  const spelled = `${config.replace(/\/+$/, '')}/plugins/store`
  const real = await landing($, spelled)
  storeDirs = real === '' || real === spelled ? [spelled] : [spelled, real]
  return storeDirs
}

// A variable's value when it is an absolute path.
function absoluteEnv(value: string | undefined): string | undefined {
  return value?.startsWith('/') ? value : undefined
}

// A refusal of a call: the reason Claude reads, and the key the pane's denials keep; none for a person's choice to wait.
interface Refusal {
  reason: string
  key?: string
  // The refusal ends the run at its level, so its record is finished before the reply goes back.
  blocks?: true
}

// The command an allowed call runs in place of its own.
interface Rewrite {
  command: string
  // The rewrite wraps the test run to unset the tokens; the allowed push is the other rewrite.
  isTestRun?: true
}

// The project's real environment files and the subset a default git grep, rg or Grep-tool search reads (tracked, or
// untracked and not ignored by Git), listed once per phase of a run; unknown when the listing failed.
interface EnvListing {
  envFiles: string[]
  envFilesReachable: string[]
  // The links in the project, as the walk finds them; undefined when it fails.
  envLinks?: string[]
  isUnknown: boolean
}

const envListings = new Map<string, EnvListing>()

// fresh: walk again, for a call whose wildcard the listing may let through, since a file or link made in the phase counts.
async function envListing($: EngineInterface, run: Run, fresh = false): Promise<EnvListing> {
  const key = `${run.id}:${run.startedAt}:${run.phase}`
  const cached = envListings.get(key)
  if (cached !== undefined && !fresh) return cached
  const walk = await sh(
    $,
    ['find', '.', '(', '-name', 'node_modules', '-o', '-name', '.git', ')', '-prune', '-o', '-name', '.env*', '-type', 'f', '-print0'],
    GIT_TIMEOUT_MS
  )
  let listing: EnvListing = { envFiles: [], envFilesReachable: [], isUnknown: true }
  if (walk?.exitCode === 0) {
    const envFiles = walk.stdout
      .split('\0')
      .map(path => path.replace(/^(?:\.\/)+/, ''))
      .filter(path => path !== '' && isEnvFile(path) === 'secret')
    const seen = await sh($, ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)**/.env*'], GIT_TIMEOUT_MS)
    const visible = seen?.exitCode === 0 ? new Set(seen.stdout.split('\0')) : undefined
    const links = await sh($, ['find', '.', '(', '-name', 'node_modules', '-o', '-name', '.git', ')', '-prune', '-o', '-type', 'l', '-print0'], GIT_TIMEOUT_MS)
    const envLinks =
      links?.exitCode === 0
        ? links.stdout
            .split('\0')
            .map(path => path.replace(/^(?:\.\/)+/, ''))
            .filter(path => path !== '')
        : undefined
    listing = {
      envFiles,
      envFilesReachable: visible === undefined ? envFiles : envFiles.filter(path => visible.has(path)),
      ...(envLinks ? { envLinks } : {}),
      isUnknown: false,
    }
  }
  envListings.set(key, listing)
  return listing
}

const REVIEWER_TYPES: ReadonlySet<string> = new Set(['goal-and-do:change-reviewer', 'change-reviewer'])

// Whether a call comes from the change-reviewer subagent's loop, by the agent type the engine lists for the loop's ID.
async function isReviewerLoop($: EngineInterface, agentId: string | undefined): Promise<boolean> {
  if (agentId === undefined) return false
  try {
    return (await $.agent.list()).some(agent => agent.id === agentId && REVIEWER_TYPES.has(agent.type))
  } catch {
    return false
  }
}

const SEARCHERS = /\b(?:e?grep|fgrep|rg|ag|ack)\b/

// A push refused because Git's settings changed: a running run is blocked for it.
async function blockForGitSettings($: EngineInterface): Promise<Refusal> {
  const note = NOTES.gitSettingsChanged
  await change($, latest => (latest.state === 'running' ? { ...latest, state: 'blocked', reason: note } : latest))
  return { reason: note, key: 'gitSettingsChanged' }
}

// The guard's word on a call during a run: the refusal, the command the allowed push runs as, or undefined to let it go
// on.
async function checkCall(
  $: EngineInterface,
  run: Run,
  call: { tool: string; input: Record<string, unknown> },
  agentId?: string
): Promise<Refusal | Rewrite | undefined> {
  const lockedPaths = [...(run.testPaths ?? []), ...Object.keys(run.lockedFiles ?? {})]
  const base = await projectRoot($)
  const target = editTarget(call)
  const real = target === undefined ? undefined : { path: await landing($, target), root: base === '' ? '' : await landing($, base) }
  const stores = await storeFolder($)
  const home = absoluteEnv(await $.env.get('HOME').catch(() => undefined))
  const xdgConfigHome = absoluteEnv(await $.env.get('XDG_CONFIG_HOME').catch(() => undefined))
  const command = call.input.command
  // A search, and any Bash command with a wildcard, which the guard judges against the env files the listing found.
  const isSearch = call.tool === 'Grep' || (call.tool === 'Bash' && typeof command === 'string' && SEARCHERS.test(command))
  const hasWildcard = call.tool === 'Bash' && typeof command === 'string' && /[*?[]/.test(command)
  const listing = hasWildcard ? await envListing($, run, true) : isSearch ? await envListing($, run) : undefined
  const isReviewer = run.phase === PHASES.indexOf('PR') && (await isReviewerLoop($, agentId))
  const context: Parameters<typeof guardAt>[1] = {
    active: true,
    // A timer's prompt would start a turn of its own, even after the run ends. A refused run is left to the person, who
    // stops it.
    blocksTimers: isActive(run) && !isRefused(run),
    phase: phaseOf(run),
    id: run.id,
    lockedPaths,
    root: base,
    ...(real ? { real } : {}),
    ...(stores ? { storeDirs: stores } : {}),
    ...(home ? { home } : {}),
    ...(xdgConfigHome ? { xdgConfigHome } : {}),
    base: run.base,
    ...(isReviewer ? { isReviewer } : {}),
    ...(run.plannedPaths ? { plannedPaths: run.plannedPaths } : {}),
    ...(run.plannedTools ? { plannedTools: run.plannedTools } : {}),
    ...(listing === undefined
      ? {}
      : listing.isUnknown
        ? { envFilesUnknown: true }
        : { envFiles: listing.envFiles, envFilesReachable: listing.envFilesReachable, ...(listing.envLinks ? { envLinks: listing.envLinks } : {}) }),
  }
  const verdict = guardAt(call, context, guardLevelOf(run))
  // Whether a refusal ends the run is decided by the run's level when the denial is recorded (afterDenial).
  if (verdict.verdict === 'deny') return { reason: verdict.reason, key: verdict.key ?? 'unknown', ...(verdict.blocks ? { blocks: true as const } : {}) }
  if (verdict.verdict === 'pass') return testRunRewrite($, run, call)
  // Git's settings, checked before the person is asked: a run blocked for them stays blocked, whatever they are now.
  const isSettingsBlock = run.state === 'blocked' && run.reason === NOTES.gitSettingsChanged
  if (isSettingsBlock || (await gitSettingsChanged($, run))) return blockForGitSettings($)
  // Only the push spelled exactly as allowed is rewritten, only at a root that is one plain word (isPushUrl's test), and
  // only with the push URL the run's start recorded.
  const args = pushArgs(String(call.input.command), run.id)
  if (args === undefined || !isPushUrl(base)) return { reason: REASONS.pushTarget, key: 'pushTarget' }
  const pushUrl = (await readGitRecord($, run.id).catch(() => undefined))?.pushUrl
  if (!isPushUrl(pushUrl)) return { reason: NOTES.pushUrlMissing, key: 'pushUrlMissing' }
  const pushChecks = await checkBeforePush($, run)
  if (pushChecks.denial !== undefined) return pushChecks.denial
  const extra = pushChecks.extra
  // The cap on fix pushes, before the person is asked: a push with a fix commit at the cap is refused and the run is stuck.
  const capBefore = await fixCapCheck($, run)
  if ('denial' in capBefore) return capBefore.denial
  if (!run.pushApproved) {
    const [pushLabel = '', notNow = ''] = TEXTS.pushOptions
    const options = [pushLabel, TEXTS.pushOpenBody, notNow]
    let answer = await askPush($, run, options, extra)
    // The push waits while the person reads the PR body: the dialog comes back until they push or say not now.
    while (answer === TEXTS.pushOpenBody || /^open\b.*\bin\s+app$/i.test((answer ?? '').trim())) {
      await openPrBody($, run)
      answer = await askPush($, run, options, extra)
    }
    if (answer !== pushLabel) {
      await change($, latest => (latest.state === 'running' ? { ...latest, state: 'blocked', reason: NOTES.pushChosenNot } : latest))
      $.ui.log(TEXTS.pushContinue)
      return { reason: NOTES.pushDenied }
    }
    await change($, latest => ({ ...latest, pushApproved: true }))
  }
  if (await testsChanged($, run)) {
    await change($, latest => (latest.state === 'running' ? { ...latest, state: 'blocked', reason: NOTES.testsChanged } : latest))
    return { reason: NOTES.pushLocked, key: 'pushLocked' }
  }
  // approvals.md as the mod's record writes it; a missing record or a file that can't be read blocks the push.
  const record = await readRecord($, run.id)
  const written = await readFile($, `changes/${run.id}/approvals.md`).catch(() => undefined)
  if (record === undefined || written !== approvalsText(record.rows)) {
    const note = NOTES.approvalsDiffer
    await change($, latest => (latest.state === 'running' ? { ...latest, state: 'blocked', reason: note } : latest))
    return { reason: note, key: 'approvalsDiffer' }
  }
  const changedFile = await approvedFileChanged($, run, record.rows.map(approvalOf))
  if (changedFile !== undefined) {
    const note = NOTES.approvedChanged(changedFile)
    await change($, latest => (latest.state === 'running' ? { ...latest, state: 'blocked', reason: note } : latest))
    return { reason: note, key: 'approvedChanged' }
  }
  // Again right before the push goes through, since a job can change them while the person reads the dialog.
  if (await gitSettingsChanged($, run)) return blockForGitSettings($)
  // The cap again, since a job can add a commit while the person reads the dialog; the push is counted by what it sends now.
  const capAfter = await fixCapCheck($, run)
  if ('denial' in capAfter) return capAfter.denial
  allowedPush = forcedPush(args, pushUrl, base)
  pushSubjects = capAfter.subjects
  return { command: allowedPush }
}

// The cap on fix pushes against the commits the push would send from HEAD, which is the branch sdd/<id>. A push with a fix
// commit at the cap is refused and the run is blocked on the cap's reason; the subjects are those the count takes once the push
// went through.
async function fixCapCheck($: EngineInterface, run: Run): Promise<{ subjects: string[] } | { denial: { reason: string; key: string } }> {
  if (!(await headIsBranch($, run))) return { denial: { reason: NOTES.fixHeadMoved(run.id), key: 'fixCheckFailed' } }
  const subjects = await newCommitSubjects($, run)
  if (subjects === undefined) return { denial: { reason: NOTES.fixCountUnreadable, key: 'fixCheckFailed' } }
  const verdict = fixPushVerdict(fixStateOf((await current($)) ?? run), subjects, run.id)
  if (verdict.allowed) return { subjects }
  await change($, latest => (latest.state === 'running' ? { ...latest, state: 'blocked', reason: verdict.reason } : latest))
  return { denial: { reason: verdict.reason, key: 'fixCap' } }
}

// The subjects of the commits a push would send: those beyond origin/sdd/<id> when that branch is on origin, else those beyond
// origin/<base>; undefined when git can't list them.
async function newCommitSubjects($: EngineInterface, run: Run): Promise<string[] | undefined> {
  const remote = await sh($, ['git', 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/sdd/${run.id}`], GIT_TIMEOUT_MS)
  const from = remote?.exitCode === 0 ? `origin/sdd/${run.id}` : `origin/${run.base}`
  const logged = await sh($, ['git', 'log', '--format=%s', `${from}..HEAD`], GIT_TIMEOUT_MS)
  if (logged?.exitCode !== 0) return undefined
  return logged.stdout.split(/\r?\n/).filter(subject => subject !== '')
}

// After a push that went through: one more fix push when it sent a fix commit. A push that failed counts for nothing.
async function countFixPush($: EngineInterface, isDone: boolean): Promise<void> {
  const subjects = pushSubjects
  pushSubjects = undefined
  if (subjects === undefined || !isDone) return
  await change($, latest => ({ ...latest, ...afterPush(fixStateOf(latest), subjects, latest.id) }))
}

// The test command's run without the ticket-system and code-host tokens, except those the approved plan keeps; undefined
// for any other call. In Plan, before its approval, the test command and the kept names come from plan.md.
async function testRunRewrite($: EngineInterface, run: Run, call: { tool: string; input: Record<string, unknown> }): Promise<Rewrite | undefined> {
  const command = call.input.command
  if (call.tool !== 'Bash' || typeof command !== 'string' || run.phase < PHASES.indexOf('Plan')) return undefined
  const planText = phaseOf(run) === 'Plan' ? await readFile($, phasePath(run, 'Plan')).catch(() => '') : ''
  const wrapped = testRunCommand(command, run.testCommand ?? testCommandFrom(planText), run.testEnvKeep ?? testEnvKeepFrom(planText))
  return wrapped === undefined ? undefined : { command: wrapped, isTestRun: true }
}

// After the allowed push: Git's settings checked again, since a job can change them while the push runs. A change
// blocks the run and logs one line; the push's own result stands.
async function checkAfterPush($: EngineInterface, run: Run): Promise<void> {
  if (!(await gitSettingsChanged($, run))) return
  await blockForGitSettings($)
  $.ui.log(NOTES.pushSettingsChanged)
}

// A denial of an active run, recorded by the run's level (afterDenial): counted, the last three kept for the pane, listed at
// review, and at strict a blocking key ends a running run. A denial that blocks is awaited before the deny reply goes
// back, so the next call sees the blocked run; any other is recorded without holding the reply.
async function recordDenial(
  $: EngineInterface,
  denied: { reason: string; key: string },
  call: { tool: string; input: Record<string, unknown> }
): Promise<void> {
  const command = typeof call.input.command === 'string' ? call.input.command : undefined
  try {
    const at = await $.clock.now()
    await change($, run => afterDenial(run, { ...denied, tool: call.tool, ...(command === undefined ? {} : { command }) }, at))
  } catch (error) {
    debug($, `denial not recorded: ${nameOf(error)}`)
  }
}

// A Bash call of an active run from Plan on that ran the test command: its result as the pane reads it, with the phase,
// the time and the call's ID. The test command is the stored one; in Plan, before its approval, plan.md's.
async function keepTestRun(
  $: EngineInterface,
  call: { tool: string; command?: unknown; tool_use_id: string },
  r: { deny?: string; isError?: boolean; text?: string; result?: unknown }
): Promise<void> {
  if (call.tool !== 'Bash' || typeof call.command !== 'string') return
  const run = await current($)
  if (run === null || !isActive(run) || run.phase < PHASES.indexOf('Plan')) return
  const planned = phaseOf(run) === 'Plan' ? testCommandFrom(await readFile($, phasePath(run, 'Plan')).catch(() => '')) : ''
  const kind = isTestRun(call.command, run.testCommand ?? planned)
  // A run with more words may run part of the suite: the last full run's status and time stay.
  if (kind === 'none' || kind === 'extra') return
  const record = typeof r.result === 'object' && r.result !== null ? (r.result as { backgroundTaskId?: unknown }) : {}
  const lastTests: LastTests = {
    status: kind === 'run' ? testRunFrom(r) : 'ran',
    phase: phaseOf(run),
    at: await $.clock.now(),
    toolUseId: call.tool_use_id,
    ...(typeof record.backgroundTaskId === 'string' ? { backgroundTaskId: record.backgroundTaskId } : {}),
  }
  await change($, latest => ({ ...latest, lastTests }))
}

// A background task's end: when it ends the last test run, which started in the background, its status sets the result.
async function keepTaskEnd($: EngineInterface, text: string): Promise<void> {
  const end = taskEndFrom(text)
  const status = taskEndStatus(end?.status)
  const run = await current($)
  const last = run?.lastTests
  if (end?.toolUseId === undefined || status === undefined || last?.status !== 'started' || last.toolUseId !== end.toolUseId) return
  await change($, latest =>
    latest.lastTests?.status === 'started' && latest.lastTests.toolUseId === end.toolUseId ? { ...latest, lastTests: { ...latest.lastTests, status } } : latest
  )
}

const EDIT_TOOLS: ReadonlySet<string> = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

// After a call of an active run: an edit or a shell command can change files, so the changed files are read again; an
// edit of the run's own folder can change a phase file's open points, so the pane draws again.
async function afterCall($: EngineInterface, call: { tool: string; input: Record<string, unknown> }, run: Run | null): Promise<void> {
  if (run === null || !isActive(run)) return
  if (EDIT_TOOLS.has(call.tool) || call.tool === 'Bash') refreshFootprint($)
  const target = editTarget(call)
  if (target === undefined) return
  if ((await fromRoot($, target)).startsWith(`changes/${run.id}/`)) $.ui.invalidate('ui.render')
}

// A path as the project root sees it: an absolute one under the root without the root, a relative one without ./.
async function fromRoot($: EngineInterface, path: string): Promise<string> {
  const base = await projectRoot($)
  return base !== '' && path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path.replace(/^(?:\.\/)+/, '')
}

// A gh pr create that ran and printed the draft PR's URL: the run keeps it.
async function keepPrUrl($: EngineInterface, command: string, r: { text?: string; result?: unknown }): Promise<void> {
  if (!/(^|\s)gh\s+pr\s+create(\s|$)/.test(command)) return
  const printed = typeof r.text === 'string' ? r.text : String((r.result as { stdout?: unknown } | undefined)?.stdout ?? '')
  const url = /https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/.exec(printed)?.[0]
  if (url !== undefined && PR_URL.test(url)) await change($, run => ({ ...run, prUrl: url }))
}

async function keepCandidate($: EngineInterface, id: string, rule: string): Promise<void> {
  await change($, run => ({ ...run, candidates: { ...run.candidates, [id]: rule } }))
}

async function settleCandidate($: EngineInterface, id: string, hasRun: boolean): Promise<void> {
  await change($, run => {
    const { [id]: rule, ...candidates } = run.candidates
    const isNew = hasRun && rule !== undefined && !run.suggested.includes(rule)
    return { ...run, candidates, suggested: isNew ? [...run.suggested, rule] : run.suggested }
  })
}

// Drawing

function phaseTokens(run: Run, phase: PhaseName): number {
  let sum = 0
  for (const [name, row] of Object.entries(run.usage.rows)) {
    if (name !== phase && !name.startsWith(`${phase} `)) continue
    for (const counts of Object.values(row.models)) sum += counts.input + counts.output
  }
  return sum
}

// points and allPoints: the undecided open points and all of them, which the row shows as points/allPoints for the current
// phase and an earlier gate not yet approved.
interface PaneRow {
  index: number
  phase: PhaseName
  file: string
  status: string
  statusColor: ThemeKey | undefined
  tokens: number
  exists: boolean
  // Git holds changes to the file that are not committed, or the file is untracked.
  isChanged: boolean
  // The name as the pane draws it: with a star when the file has changes Git has not committed.
  label: string
  points: number
  allPoints: number
  text: string | undefined
}

// Thousands separated by hand, as the usage table does.
function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

const STATUS_COLORS: Record<string, ThemeKey> = { done: 'success', blocked: 'error', draft: 'warning', '-': 'inactive' }

// The run states the current phase's row shows in its status column while the phase's file is not done.
const SHOWN_STATES: ReadonlySet<string> = new Set(['running', 'blocked', 'capped', 'interrupted'])

const TO_APPROVE = 'to approve'
const WORKING = 'working'

// The names of the files in the change folder that Git holds changes to that are not committed, untracked ones included;
// empty when git fails, so the pane marks none.
async function changedInFolder($: EngineInterface, run: Run): Promise<Set<string>> {
  const folder = `changes/${run.id}/`
  const status = await sh($, ['git', 'status', '--porcelain', '-z', '--untracked-files=all', '--', folder])
  if (status?.exitCode !== 0) return new Set()
  return new Set(
    statusEntries(status.stdout)
      .map(entry => entry.path)
      .filter(path => path.startsWith(folder))
      .map(path => path.slice(folder.length))
  )
}

// One row per phase: its file, whether it exists, its status and its tokens. A phase at its gate is to approve until the
// person approves it, and the current phase reads running while its goal works, whatever its file says: a skill writes
// done before its last commit.
async function paneRows($: EngineInterface, run: Run, isBusy = false): Promise<PaneRow[]> {
  const rows: PaneRow[] = []
  const changed = await changedInFolder($, run)
  for (const [index, phase] of PHASES.entries()) {
    const text = await readFile($, phasePath(run, phase)).catch(() => undefined)
    const fileStatus = (text === undefined ? undefined : phaseStatus(text)) ?? '-'
    const isGated = index === run.phase && run.state === 'gate'
    const isWorking = index === run.phase && run.state === 'running' && run.goalActive
    const showsState = index === run.phase && (isWorking || (fileStatus !== 'done' && SHOWN_STATES.has(run.state)))
    // The person's own prompt at the gate or a stuck state: the row reads working until that turn ends.
    const isAsked = index === run.phase && isBusy
    const status = isAsked ? WORKING : isGated ? TO_APPROVE : showsState ? run.state : fileStatus
    const isOpen = index === run.phase || (index < run.phase && isGate(phase) && lastApproval(run.approvals, phase) === undefined)
    const { undecided: points, total: allPoints } = isOpen ? pointCounts(text) : { undecided: 0, total: 0 }
    const statusColor = isAsked ? 'suggestion' : isGated ? 'warning' : showsState ? stateColor(run) : STATUS_COLORS[status]
    const isChanged = text !== undefined && changed.has(FILES[phase])
    const label = isChanged ? `${FILES[phase]}*` : FILES[phase]
    const exists = text !== undefined
    rows.push({ index, phase, file: FILES[phase], status, statusColor, tokens: phaseTokens(run, phase), exists, isChanged, label, points, allPoints, text })
  }
  return rows
}

// A row's open points, unless the row would not fit with them: they are the last thing the width rule drops.
function pointsText(row: PaneRow, widths: ReturnType<typeof paneWidths>, columns: number): string {
  if (row.points === 0) return ''
  const text = `  ${row.points}/${row.allPoints} open`
  const tokens = widths.tokens > 0 ? 2 + widths.tokens + ' tokens'.length : 0
  const status = widths.tokens > 0 ? widths.status : row.status.length
  return widths.phase + 2 + widths.file + 2 + status + tokens + text.length <= columns ? text : ''
}

// The sections under the phase table

const PLAN_AT = PHASES.indexOf('Plan')
const BUILD_AT = PHASES.indexOf('Build')

// Local 24-hour time with the time zone, such as 14:02 CET.
function clockTime(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(ms)
}

// The mod's own reasons, which the Blockers line shows as they are.
function fixedReasons(run: Run): string[] {
  return [
    NOTES.testsChanged,
    NOTES.pushChosenNot,
    NOTES.approvalsDiffer,
    NOTES.gitSettingsChanged,
    NOTES.earlierSchema,
    NOTES.runForged(run.id),
    ...PHASES.filter(isGate).map(phase => NOTES.approvedChanged(FILES[phase])),
  ]
}

// A blocked or capped run's one line. A reason the skill or the evaluator wrote is never shown: it can quote a ticket.
function blockedLine(run: Run): PaneLine | undefined {
  if (run.state === 'capped') return { text: 'Out of turns', color: 'error' }
  if (run.state !== 'blocked') return undefined
  const reason = run.reason ?? ''
  const ended = TEXTS.goalEnded('')
  const phase = phaseOf(run)
  const text = fixedReasons(run).includes(reason)
    ? reason
    : reason.startsWith(ended)
      ? ended.replace(/: $/, '.')
      : `see ${phase === 'Intent' ? 'Open questions' : 'Open points'} in ${FILES[phase]}`
  return { text: `Blocked: ${text}`, color: 'error' }
}

// A denial's fixed text by its key; a key the pane can't name gets a generic text.
function denialText(key: string): string {
  if (Object.hasOwn(REASONS, key)) return reasonText(key as ReasonKey)
  switch (key) {
    case 'pushLocked':
      return NOTES.pushLocked
    case 'approvalsDiffer':
      return NOTES.approvalsDiffer
    case 'approvedChanged':
      return NOTES.approvedChanged('an approved file')
    case 'gitSettingsChanged':
      return NOTES.gitSettingsChanged
    case 'pushUrlMissing':
      return NOTES.pushUrlMissing
    case 'guardFailed':
      return NOTES.guardFailed
    default:
      return 'blocked by the guard'
  }
}

// The guard's last three denials, one line each: the phase and the reason's fixed text. The pane wraps a line that is too
// wide. Only a pane too narrow even for a wrapped line (under DENIAL_MIN_COLUMNS) lets the width rule drop them.
function denialLines(run: Run, columns: number): PaneLine[] {
  const denials = Array.isArray(run.denials) ? run.denials.slice(-3) : []
  const isNarrow = columns < DENIAL_MIN_COLUMNS
  return denials.map(denial => ({
    text: `${denial.phase}: ${denialText(denial.key)}`,
    ...(isNarrow ? { drop: DROP.denials } : {}),
  }))
}

function lastTestsLine(last: LastTests, now: number): PaneLine {
  const time = clockTime(last.at)
  switch (last.status) {
    case 'passed':
      return { text: `Tests: passed at ${time} (${last.phase})`, color: 'success' }
    case 'failed':
      // Failing acceptance tests are the Plan phase's goal.
      return { text: `Tests: failed at ${time} (${last.phase})`, ...(last.phase === 'Plan' ? {} : { color: 'error' as const }) }
    case 'interrupted':
      return { text: `Tests: interrupted at ${time} (${last.phase})`, color: 'warning' }
    case 'started':
      return { text: `Tests: started ${Math.max(0, Math.floor((now - last.at) / 60_000))} min ago; result not seen` }
    case 'ran':
      return { text: `Tests: ran at ${time}; result not readable`, color: 'warning' }
    default:
      return { text: `Tests: result not readable (${time})`, color: 'warning' }
  }
}

// The last run's result in one word, for the Tests header: Pass, Fail, Interrupted, Running, ?, or - before any run.
const TEST_WORDS: Record<LastTests['status'], string> = {
  passed: 'Pass',
  failed: 'Fail',
  interrupted: 'Interrupted',
  started: 'Running',
  ran: '?',
  unreadable: '?',
}

// The Tests section folds: its header gives the last run's result in one word, colored as its line, and a changed lock
// turns it red; open, it shows the last run, a warning when test.md's marks and the last run disagree, and the lock
// line. The marks themselves show in the Requirements chain.
function testLines(run: Run, rows: PaneRow[], now: number, folds: Folds): PaneLine[] {
  const planned = phaseOf(run) === 'Plan' ? testCommandFrom(rows[PLAN_AT]?.text ?? '') : ''
  const command = run.testCommand ?? planned
  const last = run.lastTests
  const head = last !== undefined ? lastTestsLine(last, now) : { text: command === '' ? 'Tests: no test command in plan.md' : 'Tests: no run yet' }
  const isLockChanged = run.lastLockCheck?.changed === true
  const color = isLockChanged ? ('error' as const) : head.color
  const open = isOpen(folds, 'tests')
  const word = last === undefined ? '-' : TEST_WORDS[last.status]
  const header: PaneLine = { text: `${open ? '▼' : '►'} Tests: ${word}`, fold: 'tests', bold: true, ...(color === undefined ? {} : { color }) }
  const lines: PaneLine[] = [{ ...head, text: head.text.replace(/^Tests: /, '') }]
  const testText = rows[PHASES.indexOf('Test')]?.text
  const marks = testText === undefined ? [] : Object.entries(acResults(testText))
  if (marks.length > 0 && last?.status === 'failed' && marks.every(([, result]) => result === 'passed')) {
    lines.push({ text: 'test.md says every AC passed, but the last test run failed', color: 'warning' })
  }
  if (run.lockedAt !== undefined) {
    const locked = `Tests locked at ${run.lockedAt.slice(0, 7)}`
    const check = run.lastLockCheck
    lines.push(
      check === undefined
        ? { text: locked }
        : check.changed
          ? { text: `${locked}, changed: see the Stuck dialog`, color: 'error' }
          : { text: `${locked}, unchanged at ${clockTime(check.at)}` }
    )
  }
  return [header, ...(open ? lines : [])]
}

// Foldable sections

// The Tests section opens by itself when its result needs a look: a failed run outside Plan, or a changed lock.
function isTestsOpenByState(run: Run): boolean {
  return run.lastLockCheck?.changed === true || (run.lastTests?.status === 'failed' && run.lastTests.phase !== 'Plan')
}

// Whether a section is open when the person has not set it: the trace chain's default depends on its length.
const OPEN_AT_START: Record<string, boolean> = { last: true, request: false, suggested: false, outside: false, sensitive: false, denials: true, help: false }

type Folds = Record<string, boolean>

function isOpen(folds: Folds, id: string): boolean {
  return folds[id] ?? OPEN_AT_START[id] ?? true
}

// A section's header, in bold: a press folds or unfolds it, and its count shows either way.
function foldHead(id: string, title: string, count: number, open: boolean, color?: ThemeKey, detail = ''): PaneLine {
  return { text: `${open ? '▼' : '►'} ${title} (${count}${detail})`, fold: id, bold: true, ...(color === undefined ? {} : { color }) }
}

// Folds or opens a section from its state at the press (open unless set, its start value), then writes the atom so the
// pane draws again; called from a press, never from a render hook.
async function toggleFold($: EngineInterface, id: string, openAtStart: boolean): Promise<void> {
  foldsCopy = { ...foldsCopy, [id]: !(foldsCopy[id] ?? openAtStart) }
  try {
    await update($, foldsAtom, () => foldsCopy)
  } catch {
    debug($, 'fold not kept')
  }
}

// Opens a criterion's text under its chain line, or closes it; called from a press.
async function toggleOpened($: EngineInterface, key: string): Promise<void> {
  openedCopy = openedCopy.includes(key) ? openedCopy.filter(one => one !== key) : [...openedCopy, key]
  try {
    await update($, openedAtom, () => openedCopy)
  } catch {
    debug($, 'criterion not opened')
  }
}

const PATH_LISTS = { outside: 'Outside the Plan', sensitive: 'Sensitive Files', last: 'Last Changed' } as const

// The changed files' lines with each path list under a header of its own, its paths shown only while it is open. The
// first line, the Changed files head, is bold.
function changedLines(lines: readonly FootprintLine[], folds: Folds, columns: number): PaneLine[] {
  return lines.flatMap(({ head, under, count, ...line }, i): PaneLine[] => {
    if (head !== undefined) return [foldHead(head, PATH_LISTS[head], count ?? 0, isOpen(folds, head), line.color)]
    if (i === 0) return [{ ...line, bold: true }]
    if (under !== undefined && !isOpen(folds, under)) return []
    return [under === undefined ? line : { ...line, text: fitPath(line.text, columns) }]
  })
}

// A path line too wide for the pane, shortened from the left so its file name stays: "  …/hooks/register.test.tsx".
// Without this, one long path made the width rule drop every path list. Under 8 columns the line stays as it is.
const ELLIPSIS = '…'

function fitPath(text: string, columns: number): string {
  const chars = Array.from(text)
  if (chars.length <= columns || columns < 8) return text
  const indent = text.length - text.trimStart().length
  return `${text.slice(0, indent)}${ELLIPSIS}${chars.slice(chars.length - (columns - indent - 1)).join('')}`
}

// The Help section's lines for the run's state: a stopped run can only start over; every other run gets all three.
function helpLines(run: Run): string[] {
  if (run.state === 'stopped') return [TEXTS.helpStartOver(run.id, run.base)]
  return [TEXTS.helpStuck, TEXTS.helpGetOut, TEXTS.helpStartOver(run.id, run.base)]
}

// Whether the Help section opens on its own: the run is blocked, capped, interrupted or stopped.
const isHelpOpenByState = (run: Run): boolean => run.state === 'blocked' || run.state === 'capped' || run.state === 'interrupted' || run.state === 'stopped'

// The sections and the suggested rules, each where it belongs, and the denials last; the band above the
// prompt shows the turns. Inline, the most urgent line (a blocked state, else the last denial) leaves its section to go first.
async function paneSections(
  $: EngineInterface,
  run: Run,
  rows: PaneRow[],
  folds: Folds,
  isInline: boolean,
  columns: number
): Promise<{ urgent: PaneLine | undefined; sections: PaneSection[] }> {
  const now = await $.clock.now()
  const sections: PaneSection[] = []
  const blocked = isActive(run) ? blockedLine(run) : undefined
  const denials = isActive(run) ? denialLines(run, columns) : []
  // The denials go last, under the suggested rules; the blocked line stays first.
  let denialSection: PaneSection | undefined
  if (isActive(run)) {
    const count = run.deniedCount ?? 0
    const color = count > 0 ? ('warning' as const) : undefined
    // Under DENIAL_MIN_COLUMNS the width rule drops the denial lines, so the count stands alone, with no header.
    const isNarrow = columns < DENIAL_MIN_COLUMNS
    const open = isOpen(folds, 'denials')
    const total: PaneLine =
      denials.length === 0 || isNarrow
        ? { text: `Denials: ${count}`, bold: true, ...(color === undefined ? {} : { color }) }
        : foldHead('denials', 'Denials', count, open, color)
    if (blocked !== undefined) sections.push({ id: 'blockers', lines: [blocked] })
    denialSection = { id: 'denials', lines: [total, ...(open || isNarrow ? denials : [])] }
  }
  // Tests come first, right under the Requirements chain, then the changed files.
  if (run.phase >= PLAN_AT) sections.push({ id: 'tests', lines: testLines(run, rows, now, folds) })
  if (run.phase >= BUILD_AT) {
    const found = await read($, footprintAtom)
    if (found)
      sections.push({
        id: 'changed',
        lines: 'unavailable' in found ? [{ text: FOOTPRINT_UNAVAILABLE, bold: true }] : changedLines(found.lines, folds, columns),
      })
  }
  const open = run.suggested.length > 0 && isOpen(folds, 'suggested')
  if (run.suggested.length > 0) {
    const rules = open ? suggestionLines(run).map(text => ({ text })) : []
    sections.push({ id: 'suggested', lines: [foldHead('suggested', 'Suggested Rules', run.suggested.length, open), ...rules] })
  }
  if (run.state !== 'finished') {
    const lines = helpLines(run)
    const isHelpOpen = isOpen(folds, 'help')
    sections.push({ id: 'help', lines: [foldHead('help', 'Help', lines.length, isHelpOpen), ...(isHelpOpen ? lines.map(text => ({ text })) : [])] })
  }
  if (denialSection !== undefined) sections.push(denialSection)
  if (isActive(run)) sections.push({ id: 'level', lines: [{ text: levelLine(run) }] })
  const urgent = isInline ? (blocked ?? denials.at(-1)) : undefined
  if (urgent === undefined) return { urgent, sections }
  return { urgent, sections: sections.map(section => ({ ...section, lines: section.lines.filter(line => line !== urgent) })) }
}

// The pane's column widths; the tokens column (0 when dropped) goes first when the rows don't fit.
function paneWidths(rows: PaneRow[], columns: number): { phase: number; file: number; status: number; tokens: number } {
  const longest = (texts: string[]) => Math.max(...texts.map(text => text.length))
  const phase = longest(rows.map(row => row.phase))
  const file = longest(rows.map(row => row.label))
  const status = longest(['blocked', ...rows.map(row => row.status)])
  const tokens = longest(rows.map(row => grouped(row.tokens)))
  const full = phase + 2 + file + 2 + status + 2 + tokens + ' tokens'.length
  return { phase, file, status, tokens: full <= columns ? tokens : 0 }
}

// Each suggested rule as the rule dialog shows it: the command or tool, and what the rule allows.
function suggestionLines(run: Run): string[] {
  if (run.suggested.length === 0) return []
  return [`Add them with /${COMMAND} allow:`, ...run.suggested.map(rule => `${ruleLabel(rule)}: ${describeRule(rule)}`)]
}

// The trace chain

const TEXT_INDENT = '    '
const TEXT_NOT_FOUND = '<text not found>'

// A criterion's text under its chain line: indented, wrapped to the pane, its first line led by its ID.
function criterionLines(id: string, text: readonly string[] | undefined, columns: number): string[] {
  const indent = columns > 2 * TEXT_INDENT.length ? TEXT_INDENT : ''
  const body = text === undefined || text.length === 0 ? [TEXT_NOT_FOUND] : text
  return body.flatMap((line, i) =>
    wrapText(stripControl(i === 0 ? `${id}: ${line}` : line), Math.max(1, columns - indent.length)).map(row => `${indent}${row}`)
  )
}

// The key of an opened criterion: its chain line's ID and its own, so an AC opens under the line it was pressed on.
const openedKey = (row: TraceRow, id: string): string => `${row.id} ${id}`

// The rows of free text the opened header shows; a longer text gets a button that opens request.md.
const REQUEST_ROWS = 10

// Columns the band's box takes from the width: a border and a space on each side; and rows: a border above and below.
const BAND_FRAME = 4
const BAND_BOX_ROWS = 2

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'goal-and-do',
      description: 'Run the six phases for a Jira ticket or a free-text request',
      argumentHint: '[--base <branch>] <ticket URL | key | text | file.md> | next | status | allow [local] | stop',
      immediate: true,
    })
    await refreshRoot($)
    const version = await $.session.version().then(
      v => v.version,
      () => 'unknown'
    )
    if (version !== BUILT_FOR) $.ui.toast(NOTES.version(version))
    await restore($)
    return next(e)
  })

  // A handler that throws or outruns its time budget still answers: the fixed line in place of the engine's own note
  // that no hook answered.
  on('command.run', { command: 'goal-and-do' }, async ($, e) => {
    const text = await answerCommand($, e.args, e.origin)
    return text === undefined ? {} : { text }
  }).catch(($, e) => {
    const { kind } = parseArgs(e.args)
    debug($, `${kind}: hook failed`)
    return { text: commandFailed(kind) }
  })

  // A main-loop turn that starts with the walk-through's prompt is the walk's own; a turn with another prompt, such as a
  // task notification's, is not.
  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      turnRunning = true
      void setBusy($, true)
      isWaitingOnBackground = false
      if (walk !== undefined && walk.turnId === undefined && isWalkTurn(walk, e.text)) walk = { ...walk, turnId: e.turnId }
    }
    return next(e)
  })

  // Once per goal turn, and on plain turns: counts the run's goal turns and cuts the loop at the cap or a stop.
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id !== undefined) return next(e)
    const run = await current($)
    isWaitingOnBackground = run?.goalActive === true && (e.background_tasks ?? []).some(isGoalWork)
    if (run === null) return next(e)
    if (run.pendingClear) return {}
    if (!run.goalActive) return next(e)
    if (run.state !== 'running') return {}
    const counted = await change($, latest =>
      latest.goalActive && latest.state === 'running' ? { ...countTurn(latest), usage: countGoalTurn(latest.usage, rowOf(latest)) } : latest
    )
    if (counted?.state === 'capped') return {}
    // The goal goes on with a new goal turn: its clock starts again.
    if (counted?.state === 'running') await startTurnClock($)
    const verdict = await next(e)
    lastReason = verdict.block ?? verdict.stopReason ?? lastReason
    return verdict
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const isMain = e.agentId === undefined
    if (isMain) {
      turnRunning = false
      await setBusy($, false)
    }
    let run = await current($)
    if (run === null) return r
    const usage = e.usage
    if (usage !== undefined && (isActive(run) || run.pendingClear)) {
      const counted = await change($, latest => ({
        ...latest,
        usage: addTurn(latest.usage, usageRowOf(latest), usage, e.durationMs, isMain),
      }))
      run = counted ?? run
    }
    if (!isMain) return r
    const text = await afterMainTurn($, run)
    if (isActive(run)) refreshFootprint($)
    await reopenAfterWalk($, e.turnId, e.isAborted)
    return text === undefined ? r : { ...r, text }
  })

  // A background task's end arrives as a prompt from a task notification; it can end the last test run. A prompt of the
  // person's ends a walk-through, so its dialog does not open again on its own. What the prompt does stays as it is.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer' || e.origin.kind === 'bridge') walk = undefined
    const r = await next(e)
    if (e.origin.kind === 'task-notification') {
      try {
        await keepTaskEnd($, e.text)
      } catch (error) {
        debug($, `background end not recorded: ${nameOf(error)}`)
      }
    }
    return r
  }).catch(($, e, next) => next(e))

  on('tool.check', async ($, e, next) => {
    const r = await next(e)
    const run = await current($)
    if (run === null || !isActive(run)) return r
    if (run.pushApproved && isDefaultAsk(r) && e.tool === 'Bash' && isPrFollowUp(e.input, run)) return { decision: 'allow' }
    const isAsked = shouldSuggest({
      decision: r.decision,
      approver: e.approver,
      tool_use_id: e.tool_use_id,
      ceiling: e.ceiling ?? r.ceiling,
      hook: r.hook,
      setting: r.setting,
    })
    const rule = isAsked && r.plugin === undefined ? ruleFor(e.tool, e.input, e.isReadOnly === true) : undefined
    if (rule !== undefined && e.tool_use_id !== undefined) await keepCandidate($, e.tool_use_id, rule)
    return r
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const run = await current($)
    const { tool, tool_use_id: _id, ...input } = e
    const isOwnDialog = e.tool === 'AskUserQuestion' && e.questions.some(question => ownQuestions.has((question as { question?: string }).question ?? ''))
    if (!isOwnDialog)
      void countCall($).catch(error => {
        debug($, `call not counted: ${nameOf(error)}`)
      })
    let call = e
    let isRewrittenPush = false
    if (run !== null && (isActive(run) || run.pendingClear)) {
      const verdict = await checkCall($, run, { tool, input: input }, e.agentId)
      if (verdict !== undefined && 'reason' in verdict) {
        const answer = { deny: verdict.reason }
        if (verdict.key !== undefined) {
          const recorded = recordDenial($, { reason: verdict.reason, key: verdict.key }, { tool, input })
          if (verdict.blocks === true) await recorded
        }
        return answer
      }
      // A commit, a gh pr create and a gh pr edit are checked for secret shapes before the call goes through, whether the guard passed
      // the call as it is or rewrote it as a test run. The rewritten push has its own check before its dialog.
      if ((verdict === undefined || verdict.isTestRun === true) && e.tool === 'Bash' && isActive(run)) {
        const secret = await secretDenial($, String(e.command))
        if (secret !== undefined) {
          void recordDenial($, { reason: secret.reason, key: secret.key }, { tool, input })
          return { deny: secret.reason }
        }
      }
      // The allowed push runs as the mod rewrote it; what the hook records after the call reads the call as Claude made it.
      if (verdict !== undefined) {
        if (e.tool !== 'Bash') return { deny: NOTES.guardFailed }
        if (verdict.isTestRun === true) {
          call = { ...e, command: verdict.command }
        } else {
          // In the foreground, so the check after the push sees its end.
          const { run_in_background: _background, ...foreground } = e
          call = { ...foreground, command: verdict.command }
          isRewrittenPush = true
        }
      }
    }
    // Claude's own question is a dialog, counted open until the answer comes back; the result stays as the engine gave it.
    const r = e.tool === 'AskUserQuestion' && !isOwnDialog ? await whileDialogOpen($, () => next(call)) : await next(call)
    if (isRewrittenPush && run !== null) {
      try {
        await checkAfterPush($, run)
      } catch (error) {
        debug($, `settings after the push not checked: ${nameOf(error)}`)
      }
      try {
        await countFixPush($, r.deny === undefined && r.isError !== true)
      } catch (error) {
        debug($, `fix push not counted: ${nameOf(error)}`)
      }
    }
    try {
      await keepTestRun($, e, r)
    } catch (error) {
      debug($, `test run not recorded: ${nameOf(error)}`)
    }
    if (e.tool === 'AskUserQuestion') await countWalk($, e.questions, r)
    const latest = await current($)
    if (latest !== null && e.tool_use_id in latest.candidates) {
      await settleCandidate($, e.tool_use_id, r.deny === undefined && r.isError !== true)
    }
    if (latest !== null && isActive(latest) && e.tool === 'Bash' && r.deny === undefined && r.isError !== true) {
      await keepPrUrl($, e.command, r)
    }
    await afterCall($, { tool, input: input }, latest).catch(error => {
      debug($, `changed files not asked for: ${nameOf(error)}`)
    })
    return r
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    const { tool, tool_use_id: _id, ...input } = e
    void recordDenial($, { reason: NOTES.guardFailed, key: 'guardFailed' }, { tool, input })
    return { deny: NOTES.guardFailed }
  })

  // The mod's own dialog draws each option with its description; the answer stays the label. It writes no atom.
  on('ui.render', { component: 'AskUserQuestion' }, ($, e, next) => {
    const isOwn = e.props.questions.some(item => choiceTextsOf(item) !== undefined)
    return isOwn ? next({ ...e, props: { ...e.props, questions: withChoiceTexts(e.props.questions) } }) : next(e)
  })

  // The band takes the rows the engine gives it (maxRows): its box when the lines, the box and the blank row above fit;
  // else its lines alone, with the blank row while it fits; else one line with the state first.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const run = await current($)
    if (run === null || !isActive(run)) return next(e)
    const { bodyColumns, maxRows } = e.props
    const clock = await turnClock($, run)
    const isBusy = await isBusyAt($, run)
    // The box takes two columns for its border and two for its padding.
    const boxed = bandParts(run, Math.max(bodyColumns - BAND_FRAME, 0), clock, isBusy)
    if (boxed.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const rowOf = (line: readonly BandPart[]) => (
      <Box flexDirection="row">
        {line.map(part => (
          <Text color={part.color} weight={part.bold ? 'bold' : undefined} dimColor={part.dim}>
            {part.text}
          </Text>
        ))}
      </Box>
    )
    // The blank row keeps the band apart from the spinner and tip lines above it.
    if (boxed.length + BAND_BOX_ROWS + 1 <= maxRows) {
      return (
        <Box key="band" flexDirection="column" marginTop={1} borderStyle="bold" borderColor="subtle" paddingX={1}>
          {boxed.map(rowOf)}
        </Box>
      )
    }
    const plain = bandParts(run, bodyColumns, clock, isBusy)
    if (plain.length <= maxRows) {
      return (
        <Box key="band" flexDirection="column" marginTop={plain.length + 1 <= maxRows ? 1 : 0}>
          {plain.map(rowOf)}
        </Box>
      )
    }
    return (
      <Box key="band" flexDirection="column">
        {rowOf(bandLine(run, bodyColumns, clock, isBusy))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const run = await current($)
    if (run === null) {
      return (
        <Box>
          <Text dimColor>{TEXTS.noRun}</Text>
        </Box>
      )
    }
    const columns = e.props.bodyColumns
    const rows = await paneRows($, run, await isBusyAt($, run))
    const widths = paneWidths(rows, columns)
    // The atoms make the pane draw again on a change; the module values hold the state, also after a /clear.
    await read($, foldsAtom)
    await read($, openedAtom)
    const folds: Folds = foldsCopy
    const held = isTraceShown(run) ? ((await read($, traceAtom)) ?? []) : []
    const chain = isTraceShown(run) && held.length === 0 ? traceCopy : held
    // The chain folds itself when it is long, until the person opens it.
    const starts: Folds = { trace: chain.length <= TRACE_LINES, help: isHelpOpenByState(run), tests: isTestsOpenByState(run) }
    const opens: Folds = { ...starts, ...folds }
    // While a dialog is open it hides the band, so the pane draws the band's tail under the header, wrapped; the phase
    // table below stands for the phase chain.
    const isBandShown = isActive(run) && ((await read($, dialogsAtom)) ?? 0) > 0
    const isBusy = await isBusyAt($, run)
    const bandRows = isBandShown ? wrapParts(bandTail(run, await turnClock($, run), isBusy), columns) : []
    const { urgent, sections } = await paneSections($, run, rows, opens, e.props.placement === 'inline', columns)
    const fitted = fitPane(urgent === undefined ? sections : [{ id: 'urgent', lines: [urgent] }, ...sections], columns)
    // A section's header is a button, as a file name is: a press folds or unfolds the section.
    const foldButton = (id: string, text: string, color: ThemeKey | undefined, key: string) => (
      <Box key={`${key}-row`} flexDirection="row">
        <Button key={key} label={text} plain onPress={() => void toggleFold($, id, isOpen(starts, id))}>
          <Text color={color} weight="bold">
            {text}
          </Text>
        </Button>
      </Box>
    )
    const lineOf = (section: PaneSection) => {
      const seen = new Map<string, number>()
      return section.lines.map((line, i) => {
        if (line.fold === undefined) {
          return (
            <Text key={`${section.id}-${i}`} color={line.color} weight={line.bold ? 'bold' : undefined}>
              {line.text}
            </Text>
          )
        }
        const n = seen.get(line.fold) ?? 0
        seen.set(line.fold, n + 1)
        return foldButton(line.fold, line.text, line.color, n === 0 ? `fold-${line.fold}` : `fold-${line.fold}-${n}`)
      })
    }
    // The head group holds the hint on the buttons, the header, the band's tail while it shows, and the urgent line when inline. A blank line
    // separates it from the phase table, the table from each section, and the sections from the PR link and the
    // suggestions that show; none sits at the top or the bottom.
    // The header folds and unfolds what the person asked for: the ticket's link, its key, the request file, or the text.
    const isRequestOpen = isOpen(opens, 'request')
    const requestHead = `${isRequestOpen ? '▼' : '►'} ${run.id}`
    const ticket = ticketLink(run.input)
    const asked = stripControl(run.input)
    const askedRows = wrapText(asked, Math.max(1, columns))
    const request = !isRequestOpen ? null : ticket !== undefined ? (
      <Box key="request-link" flexDirection="row">
        <Text>{'Ticket: '}</Text>
        <Link href={ticket.href} label={ticket.key} />
      </Box>
    ) : run.source === 'jira' ? (
      <Box key="request-key" flexDirection="column">
        {wrapText(`Ticket: ${asked}`, Math.max(1, columns)).map((row, n) => (
          <Text key={`request-key-${n}`}>{row}</Text>
        ))}
      </Box>
    ) : isRequestFile(run.input) ? (
      <Box key="request-file" flexDirection="row">
        <Text>{'From '}</Text>
        <Button key="open-request" label={safePath(asked)} plain onPress={() => void absolutePath($, run.input.trim()).then(path => openPath($, path))}>
          <Text>{safePath(asked)}</Text>
        </Button>
      </Box>
    ) : (
      <Box key="request-text" flexDirection="column">
        {askedRows.slice(0, REQUEST_ROWS).map((row, n) => (
          <Text key={`request-${n}`}>{row}</Text>
        ))}
        {askedRows.length > REQUEST_ROWS ? (
          <Button
            key="open-request"
            label={NOTES.openInApp('request.md')}
            plain
            onPress={() => void absolutePath($, `changes/${run.id}/request.md`).then(path => openPath($, path))}
          >
            <Text>{NOTES.openInApp('request.md')}</Text>
          </Button>
        ) : null}
      </Box>
    )
    const head = (
      <Box key="head" flexDirection="column">
        <Box key="open-hint" flexDirection="column">
          {wrapText(TEXTS.openHint, columns).map((line, i) => (
            <Text key={`open-hint-${i}`} dimColor italic>
              {line}
            </Text>
          ))}
        </Box>
        {wrapText(requestHead, columns).map((text, n) => foldButton('request', text, undefined, n === 0 ? 'fold-request' : `fold-request-${n}`))}
        {request}
        {bandRows.map((line, row) => (
          <Box key={`band-${row}`} flexDirection="row">
            {line.map((part, i) => (
              <Text key={`band-${row}-${i}`} color={part.color} weight={part.bold ? 'bold' : undefined} dimColor={part.dim}>
                {part.text}
              </Text>
            ))}
          </Box>
        ))}
        {fitted.filter(section => section.id === 'urgent').map(lineOf)}
      </Box>
    )
    // The current row of an active run is bold: the phase, its file and its status. The status keeps its color.
    // The draft PR's link sits right under the PR row, in the file column, once the run knows its URL.
    const link =
      prNumber(run.prUrl) === undefined ? null : (
        <Box key="row-pr-url" flexDirection="row">
          <Text>{' '.repeat(widths.phase + 2)}</Text>
          <Link href={run.prUrl ?? ''} label={`PR #${prNumber(run.prUrl) ?? ''}`} />
        </Box>
      )
    const table = (
      <Box key="table" flexDirection="column">
        {rows.flatMap(row => {
          const points = pointsText(row, widths, columns)
          const weight = isActive(run) && row.index === run.phase ? ('bold' as const) : undefined
          // A row whose status would make it wider than the pane puts the status on a row of its own, indented.
          const isSplit = widths.tokens === 0 && widths.phase + 2 + widths.file + 2 + row.status.length > columns
          // A missing file is subtle, like the tokens; a file with changes Git has not committed is in the claude color.
          const fileColor = !row.exists ? ('subtle' as const) : row.isChanged ? ('claude' as const) : undefined
          const file = row.exists ? (
            <Button key={`open-${row.phase}`} label={row.file} plain onPress={() => void openInApp($, run, row.phase)}>
              <Text color={fileColor} weight={weight}>
                {row.label}
              </Text>
            </Button>
          ) : (
            <Text color={fileColor} weight={weight}>
              {row.label}
            </Text>
          )
          // The status row keeps the open-point count when it fits there.
          const counts = row.points === 0 ? '' : `  ${row.points}/${row.allPoints} open`
          const splitPoints = 2 + row.status.length + counts.length <= columns ? counts : ''
          if (isSplit) {
            return [
              <Box key={`row-${row.phase}`} flexDirection="row">
                <Text weight={weight}>{row.phase.padEnd(widths.phase)}</Text>
                <Text>{'  '}</Text>
                {file}
              </Box>,
              <Box key={`row-${row.phase}-status`} flexDirection="row">
                <Text>{'  '}</Text>
                <Text color={row.statusColor} weight={weight}>
                  {row.status}
                </Text>
                {splitPoints === '' ? null : <Text color="warning">{splitPoints}</Text>}
              </Box>,
            ]
          }
          return [
            <Box key={`row-${row.phase}`} flexDirection="row">
              <Text weight={weight}>{row.phase.padEnd(widths.phase)}</Text>
              <Text>{'  '}</Text>
              {file}
              <Text>{`${' '.repeat(widths.file - row.label.length)}  `}</Text>
              <Text color={row.statusColor} weight={weight}>
                {widths.tokens > 0 ? row.status.padEnd(widths.status) : row.status}
              </Text>
              {widths.tokens > 0 ? <Text color="subtle">{`  ${grouped(row.tokens).padStart(widths.tokens)} tokens`}</Text> : null}
              {points === '' ? null : <Text color="warning">{points}</Text>}
            </Box>,
          ]
        })}
        {link}
      </Box>
    )
    // The trace chain: each BAC and AC ID a button that opens its text under the chain line, wrapped to the pane. The
    // texts come from the atom, read with the chain.
    const heldTexts: Record<string, string[]> = (await read($, criteriaAtom)) ?? {}
    const texts = Object.keys(heldTexts).length === 0 ? criteriaCopy : heldTexts
    const opened = new Set(openedCopy)
    const traceLineOf = (row: TraceRow, r: number) => {
      const parts = traceParts(row)
      const slug = row.id.replace(/\s+/g, '-')
      const seen = new Map<string, number>()
      const drawn = wrapParts(parts, columns).map((pieces, k) => (
        <Box key={`trace-line-${r}-${k}`} flexDirection="row">
          {pieces.map((piece, j) => {
            const text = stripControl(piece.text)
            if (piece.button === undefined) {
              return (
                <Text key={`trace-${r}-${k}-${j}`} color={piece.color}>
                  {text}
                </Text>
              )
            }
            const id = piece.button
            const n = seen.get(id) ?? 0
            seen.set(id, n + 1)
            return (
              <Button
                key={n === 0 ? `trace-${slug}-${id}` : `trace-${slug}-${id}-${n}`}
                label={text}
                plain
                onPress={() => void toggleOpened($, openedKey(row, id))}
              >
                <Text color={piece.color}>{text}</Text>
              </Button>
            )
          })}
        </Box>
      ))
      const ids = [...new Set(parts.flatMap(part => (part.button === undefined ? [] : [part.button])))]
      const shown = ids
        .filter(id => opened.has(openedKey(row, id)))
        .flatMap(id => criterionLines(id, texts[id], columns))
        .map((line, k) => <Text key={`trace-text-${r}-${k}`}>{line}</Text>)
      return [...drawn, ...shown]
    }
    const traceOpen = isOpen(opens, 'trace')
    const traceHead = foldHead('trace', 'Requirements', chain.length, traceOpen, undefined, traceSummary(chain))
    const trace =
      chain.length === 0 ? null : (
        <Box key="section-trace" flexDirection="column">
          {wrapText(traceHead.text, columns).map((text, n) => foldButton('trace', text, undefined, n === 0 ? 'fold-trace' : `fold-trace-${n}`))}
          {traceOpen ? chain.flatMap(traceLineOf) : null}
        </Box>
      )
    const groups = fitted
      .filter(
        section =>
          section.id !== 'urgent' &&
          section.id !== 'suggested' &&
          section.id !== 'help' &&
          section.id !== 'denials' &&
          section.id !== 'level' &&
          section.lines.length > 0
      )
      .map(section => (
        <Box key={`section-${section.id}`} flexDirection="column">
          {lineOf(section)}
        </Box>
      ))
    const suggested = fitted.find(section => section.id === 'suggested')
    const helpGroup = fitted.find(section => section.id === 'help' && section.lines.length > 0)
    const denialGroup = fitted.find(section => section.id === 'denials' && section.lines.length > 0)
    const levelGroup = fitted.find(section => section.id === 'level' && section.lines.length > 0)
    return (
      <Box flexDirection="column" gap={1}>
        {head}
        {table}
        {trace}
        {groups}
        {suggested === undefined ? null : (
          <Box key="suggestions" flexDirection="column">
            {lineOf(suggested)}
          </Box>
        )}
        {levelGroup === undefined ? null : (
          <Box key="section-level" flexDirection="column">
            {lineOf(levelGroup)}
          </Box>
        )}
        {denialGroup === undefined ? null : (
          <Box key="section-denials" flexDirection="column">
            {lineOf(denialGroup)}
          </Box>
        )}
        {helpGroup === undefined ? null : (
          <Box key="section-help" flexDirection="column">
            {lineOf(helpGroup)}
          </Box>
        )}
      </Box>
    )
  })
}

export type PhaseName = 'Intent' | 'Spec' | 'Plan' | 'Build' | 'Test' | 'PR'

export type RunState = 'running' | 'gate' | 'blocked' | 'capped' | 'interrupted' | 'stopped' | 'finished'

export type PhaseStatus = 'done' | 'blocked' | 'draft'

export type Counts = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type UsageRow = { models: Record<string, Counts>; turns: number; ms: number }

export type UsageBook = { schema: 'usage-1'; rows: Record<string, UsageRow> }

export type Approval = {
  phase: PhaseName
  file: string
  sha256: string
  at: number
  lockedAt?: string
  // A re-lock of the acceptance tests the person approved; it re-approves no file.
  kind?: 'relock'
}

export type Run = {
  schema: 2
  id: string
  input: string
  source: 'jira' | 'freeform'
  base: string
  phase: number
  state: RunState
  startedAt: number
  goalActive: boolean
  pendingGoal: boolean
  pendingClear: boolean
  turns: number
  reruns: Partial<Record<PhaseName, number>>
  reason?: string
  lockedAt?: string
  lockedFiles?: Record<string, string>
  testPaths?: string[]
  approvals: Approval[]
  pushApproved: boolean
  // The draft PR's URL, from gh pr create's output or pr.md's pr-url.
  prUrl?: string
  candidates: Record<string, string>
  suggested: string[]
  offered: string[]
  usage: UsageBook
  env: { claudeCode: string; plugin: string; provider: string; permissionMode: string }
  // The guard's last three denials, by reason key, never the reason's text or the command; restore drops them.
  denials?: Denial[]
  // Every denial of the run, a whole number of 0 or more.
  deniedCount?: number
  // The last run of the test command; restore drops it.
  lastTests?: LastTests
  // The last check of the acceptance tests against the lock; restore drops it.
  lastLockCheck?: { changed: boolean; at: number }
  // plan.md's planned-paths and test-command as approved, from the mod's store beside the lock.
  plannedPaths?: string[]
  testCommand?: string
  // plan.md's planned-tools (MCP write tools the plan allows) and test-env-keep (variables the test run keeps), as approved.
  plannedTools?: string[]
  testEnvKeep?: string[]
  // The run's guard level; absent in a record from before the setting, which counts as strict.
  guardLevel?: GuardLevel
  // Review level only: each denied call in order, at most 200. A restart keeps it.
  deniedCalls?: DeniedCall[]
  // Each switch of the level in order. A restart keeps it.
  levelChanges?: LevelChange[]
  // The count of fix pushes (pushes that went through with a commit starting fix(<id>):) and the cap on them, 3 at the start.
  // A run.json without them loads with 0 and 3; only a push that went through and the person's choice at the stuck state change them.
  fixPushes: number
  fixCap: number
}

// strict: a denial of a blocking kind ends the run. review: every denial is refused, counted and listed, and the run goes on.
export type GuardLevel = 'strict' | 'review'

// One denied call. command: the command text after redactSecrets; absent for a call with no command.
export type DeniedCall = { phase: PhaseName; key: string; tool: string; at: number; command?: string }

export type LevelChange = { at: number; from: GuardLevel; to: GuardLevel }

// A denial by its key: a key of the guard's REASONS, or one of the mod's own refusals (pushLocked, approvalsDiffer,
// approvedChanged, gitSettingsChanged, pushUrlMissing, guardFailed).
export type Denial = { phase: PhaseName; key: string }

// unreadable: the result can't be read (a refused call, an unknown end); ran: the test command ran inside a longer
// command, so its result is not readable.
export type TestStatus = 'passed' | 'failed' | 'interrupted' | 'started' | 'unreadable' | 'ran'

export type LastTests = {
  status: TestStatus
  phase: PhaseName
  at: number
  toolUseId?: string
  backgroundTaskId?: string
}

export type FileGroup = { files: number; added: number; removed: number }

// The changed files since the change branched off: the groups and totals, the paths outside the plan (undefined when
// plan.md stores none) and the sensitive ones, and the lines the pane draws, which hold only safe names. color is a
// theme key; drop and shrink are steps of the pane's width rule.
export type Footprint = {
  groups: { tests: FileGroup; ci: FileGroup; rest: FileGroup }
  total: FileGroup
  outside: string[] | undefined
  isBroad: boolean
  sensitive: { path: string; label?: string }[]
  lines: FootprintLine[]
  // Every changed path, relative to the project root, as Git lists it.
  paths: string[]
}

// A line of the changed files. head: the line counts a path list (outside, sensitive, or the last changed) and heads it;
// under: the line is a path of that list.
export type FootprintLine = {
  text: string
  color?: 'warning'
  drop?: 1 | 2 | 3 | 4 | 5 | 6
  shrink?: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, string>>
  head?: 'outside' | 'sensitive' | 'last'
  count?: number
  under?: 'outside' | 'sensitive' | 'last'
}

// The changed files, or unavailable when git could not say.
export type FootprintState = Footprint | { unavailable: true }

// The current goal turn: when it started, and the tool calls since.
export type TurnClock = { startedAt: number; calls: number }

export type AcResult = 'passed' | 'failed' | 'unknown'

// One line of the trace chain: a criterion with its ACs, or what stands in their place. The marks come from test.md and
// are left out while it has no AC table. alsoOutOfScope: spec.md gives the criterion ACs and an Out of scope line.
export type TraceRow = {
  id: string
  kind: 'acs' | 'none' | 'out of scope' | 'not in intent' | 'no bac'
  acs: { id: string; result?: AcResult }[]
  alsoOutOfScope?: true
}

declare module 'claude-code' {
  interface PluginState {
    'goal-and-do': {
      run: Run | null
      trace: TraceRow[]
      footprint: FootprintState | null
      turn: TurnClock | null
      // The open dialogs: the mod's own and Claude's AskUserQuestion calls. In memory only.
      dialogs: number
      // A main-loop turn runs while no goal does, as on a prompt at a gate. In memory only.
      busy: boolean
      // The pane's folded and open sections by their ID, as the person set them: true for open. In memory only.
      folds: Record<string, boolean>
      // The text of each criterion the trace chain names, by its ID, as the chain was last read.
      criteria: Record<string, string[]>
      // The criteria the person opened in the trace chain, each as its chain line's ID and its own. In memory only.
      opened: string[]
    }
  }
}

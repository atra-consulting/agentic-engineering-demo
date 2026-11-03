// Reading the checks of the draft pull request: one element of `gh pr checks <branch> --json name,bucket,state,link` per check.
// The exit code of gh is never an input: a pending check makes it exit 8, which says nothing about a failure.

export interface CheckRow {
  name: string
  bucket: string
  state: string
  link: string
}

export type ToDoReason = 'neutral' | 'cancelled' | 'build unreadable'

export interface CheckReading {
  passed: string[]
  failed: string[]
  waiting: string[]
  toDo: { name: string; reason: ToDoReason }[]
  checks: 'passed' | 'failed' | 'waiting'
  stuck: boolean
}

// A Jenkins check: its link names a job, or its name holds jenkins in any case.
export function isJenkinsCheck(row: CheckRow): boolean {
  return row.link.includes('/job/') || row.name.toLowerCase().includes('jenkins')
}

// State is read before bucket, since gh puts a neutral check in bucket pass. buildFound is asked only for a Jenkins check in
// bucket fail, because the build is read only to get the failure's log; without it every build counts as found.
export function readChecks(rows: CheckRow[], buildFound?: (row: CheckRow) => boolean): CheckReading {
  const passed: string[] = []
  const failed: string[] = []
  const waiting: string[] = []
  const toDo: CheckReading['toDo'] = []
  for (const row of rows) {
    const state = row.state.toUpperCase()
    const bucket = row.bucket.toLowerCase()
    if (state === 'NEUTRAL') {
      toDo.push({ name: row.name, reason: 'neutral' })
    } else if (state === 'CANCELLED' || bucket === 'cancel') {
      toDo.push({ name: row.name, reason: 'cancelled' })
    } else if (bucket === 'fail' && isJenkinsCheck(row) && buildFound !== undefined && !buildFound(row)) {
      toDo.push({ name: row.name, reason: 'build unreadable' })
    } else if (bucket === 'pass' || bucket === 'skipping') {
      passed.push(row.name)
    } else if (bucket === 'fail') {
      failed.push(row.name)
    } else {
      waiting.push(row.name)
    }
  }
  const checks = failed.length > 0 || toDo.length > 0 ? 'failed' : waiting.length > 0 ? 'waiting' : 'passed'
  return { passed, failed, waiting, toDo, checks, stuck: toDo.length > 0 }
}

export interface FailedCheck {
  name: string
  log: string
}

export interface ByHand {
  name: string
  pattern: string
}

// The entries of the infrastructure pattern file: one per line, trimmed; blank lines and lines that start with # are skipped.
export function parsePatterns(fileText: string): string[] {
  return fileText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#'))
}

// A failure whose log holds an entry of the list (case-insensitive substring, entries in list order, the first match wins) is
// for a person to re-run; any other failure is a fix round. Both lists follow the order of the failed checks.
export function classifyFailures(failed: FailedCheck[], patterns: string[]): { fix: string[]; byHand: ByHand[] } {
  const entries = patterns.filter(pattern => pattern.trim() !== '')
  const fix: string[] = []
  const byHand: ByHand[] = []
  for (const check of failed) {
    const log = check.log.toLowerCase()
    const pattern = entries.find(entry => log.includes(entry.toLowerCase()))
    if (pattern === undefined) fix.push(check.name)
    else byHand.push({ name: check.name, pattern })
  }
  return { fix, byHand }
}

// The To Do line of a failure judged to be infrastructure: the check, what to do, and the entry that matched.
export function byHandLine(item: ByHand): string {
  return `${item.name}: re-run by hand (the log matches the infrastructure pattern "${item.pattern}")`
}

// A fix round is one more round when at least one failure is the change's own.
export function fixRoundsAfter(rounds: number, classified: { fix: string[] }): number {
  return classified.fix.length > 0 ? rounds + 1 : rounds
}

export function fixCommitSubject(id: string, check: string): string {
  return `fix(${id}): ${check}`
}

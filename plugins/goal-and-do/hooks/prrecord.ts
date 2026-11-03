// The rules of the PR phase's record, as pure functions: the draft decision right after gh pr create, the end-of-run draft
// warning, the compare of the live description with the one the phase wrote, and the match of the pull request's head commit
// with the commit the phase pushed. The skill and the mod call them with plain values; none of them reads a file or runs gh.

export interface DraftStep {
  action: 'continue' | 'reread' | 'stop'
  // The sentence pr.md carries about the draft state.
  record: string
  // For stop: what the person is asked.
  ask?: string
  // For reread: the seconds to wait before the next read.
  waitSeconds?: number
}

const DRAFT_REREAD_SECONDS = 10

// The decision after gh pr create --draft, from the isDraft values read so far (oldest first, one or two): a draft continues, no
// draft stops at once, and an unreadable value is read once more after 10 seconds, then stops.
export function draftStep(reads: (boolean | undefined)[]): DraftStep {
  const last = reads.at(-1)
  if (last === true) return { action: 'continue', record: 'The pull request was created as a draft and is a draft.' }
  if (last === false) {
    return {
      action: 'stop',
      record: 'The pull request is not a draft.',
      ask: 'The pull request is not a draft. Please convert it to a draft in the PR sidebar; the agent never converts a pull request, and the guard blocks gh pr ready.',
    }
  }
  if (reads.length < 2) {
    return { action: 'reread', waitSeconds: DRAFT_REREAD_SECONDS, record: 'The draft state could not be read yet; it is read once more.' }
  }
  return {
    action: 'stop',
    record: 'The draft state could not be read, after two reads.',
    ask: 'The draft state of the pull request could not be read. Please check the draft state in the PR sidebar, and convert the pull request to a draft if it is not one.',
  }
}

// The warning of the run's summary: the pull request was created as a draft and the read at the end finds it is none. An
// unreadable state at the end gives none.
export function endDraftWarning(createdAsDraft: boolean, isDraftAtEnd: boolean | undefined): string | undefined {
  return createdAsDraft && isDraftAtEnd === false ? 'The PR is not a draft' : undefined
}

// A description as the compare sees it: Windows line endings as \n, whitespace at the end of each line removed, and blank lines
// and newlines at the end of the whole text removed. Whitespace at the start of a line or inside it stays.
export function normalizeBody(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t\r]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '')
}

// Any difference but line endings and trailing whitespace is an edit by a person.
export function isEdited(live: string, written: string): boolean {
  return normalizeBody(live) !== normalizeBody(written)
}

export type KeepReason = 'edited' | 'no description of its own' | 'reviewer section removed'

export interface DescriptionStep {
  // true: run gh pr edit with the phase's text.
  update: boolean
  // The live text as given, the reason, and the note for pr.md that says why.
  keep?: { text: string; reason: KeepReason; note: string }
  // What the phase tells the person; set when keep is set.
  tell?: string
}

const KEEP_NOTES: Record<KeepReason, { note: string; tell: string }> = {
  edited: {
    note: 'The live description differs from the one the phase wrote by more than line endings and trailing whitespace. A person edited it; the text is kept as the pull request shows it and gh pr edit was not run.',
    tell: 'Kept your edit of the pull request description and did not run gh pr edit. pr.md holds the same text.',
  },
  'no description of its own': {
    note: 'The phase has no description of its own to compare with. The text is kept as the pull request shows it and gh pr edit was not run.',
    tell: 'Kept the description on the pull request as it is and did not run gh pr edit, since the phase has no description of its own to compare with. pr.md holds the same text.',
  },
  'reviewer section removed': {
    note: 'The live description has no section for reviewers; a person removed it. The text is kept as the pull request shows it and gh pr edit was not run.',
    tell: 'Kept your description on the pull request, which has no section for reviewers, and did not run gh pr edit. pr.md holds the same text.',
  },
}

// A heading line that holds the word Reviewer in any case counts as the section on what changes for reviewers.
function hasReviewerHeading(text: string): boolean {
  return text.split(/\r?\n/).some(line => /^\s{0,3}#{1,6}\s.*\breviewer/i.test(line))
}

// Whether the phase may run gh pr edit with its text: only when the live description is the one the phase wrote, give or take
// line endings and trailing whitespace. Else the person's text is final and stays, and it goes into pr.md with a note.
export function descriptionStep(live: string, written: string | undefined): DescriptionStep {
  if (written !== undefined && !isEdited(live, written)) return { update: true }
  const reason: KeepReason = written === undefined ? 'no description of its own' : hasReviewerHeading(live) ? 'edited' : 'reviewer section removed'
  const { note, tell } = KEEP_NOTES[reason]
  return { update: false, keep: { text: live, reason, note }, tell }
}

export const HEAD_REREADS = 5
export const HEAD_WAIT_SECONDS = 60

export type HeadStep = { action: 'report' } | { action: 'reread'; waitSeconds: number } | { action: 'todo'; todo: string }

// The same commit: equal ids, or one an abbreviation (seven characters or more) of the other.
function isSameCommit(a: string, b: string): boolean {
  const left = a.trim().toLowerCase()
  const right = b.trim().toLowerCase()
  if (left === '' || right === '') return false
  const [short, long] = left.length <= right.length ? [left, right] : [right, left]
  return short === long || (short.length >= 7 && long.startsWith(short))
}

// The results are the pushed commit's only once the head of the pull request is that commit: until then the phase reads again, up
// to HEAD_REREADS times (rereads: the re-reads done so far), HEAD_WAIT_SECONDS apart; after the last one a To Do names both commits.
export function headStep(headRefOid: string, pushed: string, rereads: number): HeadStep {
  if (isSameCommit(headRefOid, pushed)) return { action: 'report' }
  if (rereads < HEAD_REREADS) return { action: 'reread', waitSeconds: HEAD_WAIT_SECONDS }
  return {
    action: 'todo',
    todo: `The head of the pull request is ${headRefOid} and the phase pushed ${pushed}; they still differ after ${HEAD_REREADS} re-reads, ${HEAD_WAIT_SECONDS} seconds apart. No result is reported as the pushed commit's. Look at the pull request.`,
  }
}

// The note of pr.md that names the commit the checks line describes; for commits that differ it names both.
export function checksCommitLine(headRefOid: string, pushed: string, matched: boolean): string {
  if (matched) return `The checks line describes commit ${headRefOid}, which is the head of the pull request and the commit the phase pushed.`
  return `The checks line may not describe the head: the head of the pull request is ${headRefOid} and the phase pushed ${pushed}.`
}

// Exactly gh pr view sdd/<id> --json <fields>, alone or behind timeout <n>: a read of the run's own pull request.
function isViewOf(command: string, id: string, fields: string): boolean {
  if (/[\r\n]/.test(command)) return false
  const words = command
    .trim()
    .split(/[ \t]+/)
    .filter(word => word !== '')
  const rest = words[0] === 'timeout' && /^\d+[smhd]?$/.test(words[1] ?? '') ? words.slice(2) : words
  const form = ['gh', 'pr', 'view', `sdd/${id}`, '--json', fields]
  return rest.length === form.length && rest.every((word, i) => word === form[i])
}

// The read of the head commit and the checks of the run's own pull request.
export function isHeadView(command: string, id: string): boolean {
  return isViewOf(command, id, 'headRefOid,statusCheckRollup')
}

// The read of the draft state of the run's own pull request.
export function isDraftView(command: string, id: string): boolean {
  return isViewOf(command, id, 'isDraft')
}

// The read of the live description of the run's own pull request, for the compare before gh pr edit.
export function isBodyView(command: string, id: string): boolean {
  return isViewOf(command, id, 'body')
}

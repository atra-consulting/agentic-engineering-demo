import { expect, test } from 'claude-code/testing'
import {
  HEAD_REREADS,
  HEAD_WAIT_SECONDS,
  checksCommitLine,
  descriptionStep,
  draftStep,
  endDraftWarning,
  headStep,
  isEdited,
  isHeadView,
  normalizeBody,
} from './prrecord'

const ID = 'CH-20261102-sample-change'
const WRITTEN = '## Summary\n\nAdds the parser.\n\n## Reviewer Guide\n\nStart with parser.ts.\n\n## How to Test\n\nRun the unit tests.\n'
const WRITTEN_CRLF = WRITTEN.replace(/\n/g, '\r\n')

// AC-5

test('AC-5: for isDraft false the phase stops at once and asks the person to convert the pull request, which the agent never does', () => {
  const step = draftStep([false])
  expect(step.action).toBe('stop')
  expect(step.ask).toBeDefined()
  expect(step.ask).toMatch(/convert/i)
  expect(step.ask).toMatch(/never/i)
})

test('AC-5: for isDraft false pr.md says the pull request is not a draft', () => {
  expect(draftStep([false]).record).toContain('not a draft')
})

test('AC-5: for isDraft true the phase continues and pr.md states a draft', () => {
  const step = draftStep([true])
  expect(step.action).toBe('continue')
  expect(step.record).toMatch(/draft/i)
  expect(step.record).not.toContain('not a draft')
})

test('AC-5: when isDraft cannot be read the phase reads once more after 10 seconds', () => {
  const step = draftStep([undefined])
  expect(step.action).toBe('reread')
  expect(step.waitSeconds).toBe(10)
})

test('AC-5: when isDraft is still unreadable the phase stops, asks the person to check the draft state and says so in pr.md', () => {
  const step = draftStep([undefined, undefined])
  expect(step.action).toBe('stop')
  expect(step.ask).toMatch(/draft state/i)
  expect(step.record).toContain('could not be read')
})

test('AC-5: a second read that finds a draft continues, and one that finds no draft stops', () => {
  expect(draftStep([undefined, true]).action).toBe('continue')
  expect(draftStep([undefined, true]).record).toMatch(/draft/i)
  expect(draftStep([undefined, false]).action).toBe('stop')
  expect(draftStep([undefined, false]).record).toContain('not a draft')
})

// AC-6

test('AC-6: when the live description was edited by a person the phase does not run gh pr edit, the person text stays and is copied into pr.md', () => {
  const live = WRITTEN + '\nPlease also look at the migration note.\n'
  const step = descriptionStep(live, WRITTEN)
  expect(step.update).toBe(false)
  expect(step.keep).toBeDefined()
  expect(step.keep?.text).toBe(live)
  expect(step.keep?.reason).toBe('edited')
})

test('AC-6: the phase tells the person it kept their text', () => {
  const step = descriptionStep(WRITTEN + '\nOne more line from a person.\n', WRITTEN)
  expect(step.tell).toBeDefined()
  expect(step.tell?.length).toBeGreaterThan(0)
  expect(step.tell).toMatch(/kept/i)
})

test('AC-6: when the live description does not differ from the one the phase wrote, the description updates as before', () => {
  const step = descriptionStep(WRITTEN, WRITTEN)
  expect(step.update).toBe(true)
  expect(step.keep).toBeUndefined()
  expect(step.tell).toBeUndefined()
})

test('AC-6: a live description that differs only by line endings and trailing whitespace still updates', () => {
  const step = descriptionStep(WRITTEN_CRLF + '\r\n\r\n', WRITTEN)
  expect(step.update).toBe(true)
  expect(step.keep).toBeUndefined()
})

test('AC-6: the compare says edited for a changed word and not edited for the same text', () => {
  expect(isEdited(WRITTEN.replace('parser', 'lexer'), WRITTEN)).toBe(true)
  expect(isEdited(WRITTEN, WRITTEN)).toBe(false)
})

// AC-12

test('AC-12: when the pull request was created as a draft and is no longer a draft at the end, the run summary warns The PR is not a draft', () => {
  expect(endDraftWarning(true, false)).toBe('The PR is not a draft')
})

test('AC-12: a draft at the end gives no warning', () => {
  expect(endDraftWarning(true, true)).toBeUndefined()
})

test('AC-12: an unreadable draft state at the end gives no warning', () => {
  expect(endDraftWarning(true, undefined)).toBeUndefined()
})

test('AC-12: a pull request that was not created as a draft gives no warning', () => {
  expect(endDraftWarning(false, false)).toBeUndefined()
  expect(endDraftWarning(false, true)).toBeUndefined()
  expect(endDraftWarning(false, undefined)).toBeUndefined()
})

// AC-13

test('AC-13: a live description that differs only in line endings does not count as edited', () => {
  expect(isEdited(WRITTEN_CRLF, WRITTEN)).toBe(false)
  expect(isEdited(WRITTEN, WRITTEN_CRLF)).toBe(false)
  expect(normalizeBody('line one\r\nline two\r\n')).toBe('line one\nline two')
})

test('AC-13: whitespace at the end of a line does not count as an edit', () => {
  expect(isEdited('line one  \nline two\t\nline three', 'line one\nline two\nline three')).toBe(false)
  expect(normalizeBody('line one \t \nline two')).toBe('line one\nline two')
})

test('AC-13: blank lines and newlines at the end of the whole text are trailing whitespace and do not make an edit', () => {
  expect(isEdited('line one\nline two\n\n\n', 'line one\nline two')).toBe(false)
  expect(isEdited('line one\nline two', 'line one\nline two\n')).toBe(false)
  expect(normalizeBody('line one\nline two\n\n  \n')).toBe('line one\nline two')
})

test('AC-13: whitespace at the start of a line counts as an edit', () => {
  expect(isEdited('  line one\nline two', 'line one\nline two')).toBe(true)
  expect(isEdited('line one\n\tline two', 'line one\nline two')).toBe(true)
})

test('AC-13: whitespace inside a line counts as an edit', () => {
  expect(isEdited('line  one\nline two', 'line one\nline two')).toBe(true)
})

test('AC-13: any other difference counts as an edit', () => {
  expect(isEdited('line one\nline two changed', 'line one\nline two')).toBe(true)
  expect(isEdited('line one\n\nline two', 'line one\nline two')).toBe(true)
})

// AC-14

test('AC-14: with no description of its own the phase keeps the live text, runs no gh pr edit and copies the text with a note', () => {
  const live = '## Summary\n\nWritten by hand.\n'
  const step = descriptionStep(live, undefined)
  expect(step.update).toBe(false)
  expect(step.keep).toBeDefined()
  expect(step.keep?.text).toBe(live)
  expect(step.keep?.reason).toBe('no description of its own')
  expect(step.keep?.note.length).toBeGreaterThan(0)
  expect(step.tell).toBeDefined()
})

test('AC-14: when a person removed the reviewer section, the phase keeps the live text, runs no gh pr edit and copies the text with a note', () => {
  const live = '## Summary\n\nAdds the parser.\n\n## How to Test\n\nRun the unit tests.\n'
  const step = descriptionStep(live, WRITTEN)
  expect(step.update).toBe(false)
  expect(step.keep?.text).toBe(live)
  expect(step.keep?.reason).toBe('reviewer section removed')
  expect(step.keep?.note.length).toBeGreaterThan(0)
  expect(step.tell).toBeDefined()
})

test('AC-14: the kept text is the live text as given, with its line endings and trailing whitespace', () => {
  const live = '## Summary  \r\n\r\nWritten by hand.\r\n\r\n'
  const step = descriptionStep(live, undefined)
  expect(step.keep?.text).toBe(live)
})

test('AC-14: an edit that keeps a heading with the word Reviewer in any case is an edit, not a removed section', () => {
  const live = WRITTEN.replace('## Reviewer Guide', '## for the REVIEWER') + '\nExtra line.\n'
  const step = descriptionStep(live, WRITTEN)
  expect(step.update).toBe(false)
  expect(step.keep?.reason).toBe('edited')
})

test('AC-14: the word Reviewer in body text, outside a heading, does not count as the section', () => {
  const live = '## Summary\n\nAsk the Reviewer to look at it.\n'
  const step = descriptionStep(live, WRITTEN)
  expect(step.update).toBe(false)
  expect(step.keep?.reason).toBe('reviewer section removed')
})

test('AC-14: each reason gets a note of its own that says why', () => {
  const noOwn = descriptionStep('## Summary\n\nx\n', undefined).keep?.note
  const removed = descriptionStep('## Summary\n\nx\n', WRITTEN).keep?.note
  const edited = descriptionStep(WRITTEN + '\nextra\n', WRITTEN).keep?.note
  expect(noOwn).toBeDefined()
  expect(removed).toBeDefined()
  expect(edited).toBeDefined()
  expect(new Set([noOwn, removed, edited]).size).toBe(3)
})

// AC-15

test('AC-15: the phase re-reads up to five times, 60 seconds apart', () => {
  expect(HEAD_REREADS).toBe(5)
  expect(HEAD_WAIT_SECONDS).toBe(60)
})

test('AC-15: when headRefOid differs from the pushed commit the phase reads again, 60 seconds later, for up to five re-reads', () => {
  for (let rereads = 0; rereads < HEAD_REREADS; rereads++) {
    expect(headStep('a1b2c3d', 'e4f5a6b', rereads)).toEqual({ action: 'reread', waitSeconds: HEAD_WAIT_SECONDS })
  }
})

test('AC-15: the phase reports the results as the pushed commit only once headRefOid matches it', () => {
  expect(headStep('a1b2c3d', 'a1b2c3d', 0)).toEqual({ action: 'report' })
  expect(headStep('a1b2c3d', 'a1b2c3d', 3)).toEqual({ action: 'report' })
  expect(headStep('a1b2c3d', 'a1b2c3d', HEAD_REREADS)).toEqual({ action: 'report' })
  expect(headStep('a1b2c3d', 'e4f5a6b', 0).action).not.toBe('report')
})

test('AC-15: when the commits still differ after the fifth re-read, a To Do names both commits and no result is reported', () => {
  const step = headStep('a1b2c3d', 'e4f5a6b', HEAD_REREADS)
  expect(step.action).toBe('todo')
  if (step.action === 'todo') {
    expect(step.todo).toContain('a1b2c3d')
    expect(step.todo).toContain('e4f5a6b')
  }
})

test('AC-15: after the record push pr.md names the commit the checks line describes', () => {
  const line = checksCommitLine('b7c8d9e', 'b7c8d9e', true)
  expect(line).toContain('b7c8d9e')
})

test('AC-15: when the commits still differ after the record push, pr.md names both and says the checks line may not describe the head', () => {
  const line = checksCommitLine('a1b2c3d', 'b7c8d9e', false)
  expect(line).toContain('a1b2c3d')
  expect(line).toContain('b7c8d9e')
  expect(line).toMatch(/may not describe/i)
})

test('AC-15: the mod allows gh pr view --json headRefOid,statusCheckRollup as a read-only follow-up', () => {
  expect(isHeadView(`gh pr view sdd/${ID} --json headRefOid,statusCheckRollup`, ID)).toBe(true)
})

test('AC-15: the follow-up may sit behind timeout <n>', () => {
  expect(isHeadView(`timeout 30 gh pr view sdd/${ID} --json headRefOid,statusCheckRollup`, ID)).toBe(true)
})

test('AC-15: any other flag, branch or word is not the allowed follow-up', () => {
  expect(isHeadView(`gh pr view sdd/${ID} --json headRefOid`, ID)).toBe(false)
  expect(isHeadView(`gh pr view sdd/${ID} --json headRefOid,statusCheckRollup,body`, ID)).toBe(false)
  expect(isHeadView(`gh pr view sdd/CH-20261102-other-change --json headRefOid,statusCheckRollup`, ID)).toBe(false)
  expect(isHeadView(`gh pr view sdd/${ID} --json headRefOid,statusCheckRollup --web`, ID)).toBe(false)
  expect(isHeadView(`gh pr edit sdd/${ID} --json headRefOid,statusCheckRollup`, ID)).toBe(false)
  expect(isHeadView(`gh pr view sdd/${ID} --json headRefOid,statusCheckRollup; rm -rf x`, ID)).toBe(false)
  expect(isHeadView(`gh pr view sdd/${ID}`, ID)).toBe(false)
  expect(isHeadView('', ID)).toBe(false)
})

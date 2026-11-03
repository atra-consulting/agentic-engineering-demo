import { expect, test } from 'claude-code/testing'
import { BACKGROUND_CHECK, backgroundGapNote } from './background'

test('AC-14: the check of Claude Code found no hook that reaches the "moved to the background" line, so nothing is built for this criterion', () => {
  expect(BACKGROUND_CHECK.hook).toBe('none')
})

test('AC-15: the gap note carries the Claude Code version checked, is addressed to the Claude Code team, and says no hook reaches the line', () => {
  expect(BACKGROUND_CHECK.claudeCode.length).toBeGreaterThan(0)
  expect(BACKGROUND_CHECK.claudeCode).toMatch(/\d+\.\d+\.\d+/)

  const note = backgroundGapNote(BACKGROUND_CHECK)
  expect(note).toContain(BACKGROUND_CHECK.claudeCode)
  expect(note).toContain('Claude Code team')
  expect(note).toMatch(/no hook/i)
  expect(note.toLowerCase()).toContain('background')
})

test('AC-15: the gap note takes its version from the check it is given', () => {
  const check: typeof BACKGROUND_CHECK = { claudeCode: '9.9.999', hook: 'none', checkedFor: 'a hook on the moved to the background line' }
  const note = backgroundGapNote(check)
  expect(note).toContain('9.9.999')
  expect(note).toContain('Claude Code team')
  expect(note).toMatch(/no hook/i)
})

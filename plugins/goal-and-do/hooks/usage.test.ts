import { expect, test } from 'claude-code/testing'
import type { TurnUsage } from 'claude-code'
import type { UsageBook } from '../types'
import { USAGE_FOOTER, addTurn, countGoalTurn, formatUsage, modelKey, rowName } from './usage'

const EMPTY: UsageBook = { schema: 'usage-1', rows: {} }

function usage(model: string, input: number, output: number, cacheRead: number, cacheWrite: number): TurnUsage {
  return {
    model,
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
  }
}

test('rowName names the first attempt, a rerun and the waiting turns', () => {
  expect(rowName('Spec', 'running', 0)).toBe('Spec')
  expect(rowName('Build', 'running', 2)).toBe('Build rerun 2')
  for (const state of ['gate', 'blocked', 'capped', 'interrupted'] as const) {
    expect(rowName('Plan', state, 0)).toBe('Plan gate')
    expect(rowName('Plan', state, 3)).toBe('Plan gate')
  }
  expect(rowName('PR', 'finished', 0)).toBe('PR')
})

test('modelKey strips the Bedrock and Vertex forms', () => {
  expect(modelKey('eu.anthropic.claude-opus-5-5')).toEqual({ key: 'claude-opus-5-5', provider: 'bedrock' })
  expect(modelKey('us.anthropic.claude-haiku-4-5')).toEqual({ key: 'claude-haiku-4-5', provider: 'bedrock' })
  expect(modelKey('anthropic.claude-sonnet-5-5')).toEqual({ key: 'claude-sonnet-5-5', provider: 'bedrock' })
  expect(modelKey('claude-opus-4-1@20250805')).toEqual({ key: 'claude-opus-4-1', provider: 'vertex' })
  expect(modelKey('claude-opus-5-5')).toEqual({ key: 'claude-opus-5-5', provider: 'anthropic' })
})

test('addTurn adds up per row and model', () => {
  let book = addTurn(EMPTY, 'Spec', usage('claude-opus-5-5', 100, 20, 500, 30), 1000, true)
  book = addTurn(book, 'Spec', usage('claude-opus-5-5', 1, 2, 3, 4), 2000, true)
  book = addTurn(book, 'Spec', usage('claude-haiku-4-5', 10, 20, 30, 40), 500, true)
  expect(book.rows.Spec?.models['claude-opus-5-5']).toEqual({ input: 101, output: 22, cacheRead: 503, cacheWrite: 34 })
  expect(book.rows.Spec?.models['claude-haiku-4-5']).toEqual({ input: 10, output: 20, cacheRead: 30, cacheWrite: 40 })
  expect(book.rows.Spec?.ms).toBe(3500)
})

test('addTurn is pure and ignores a turn without usage', () => {
  const book = addTurn(EMPTY, 'Spec', usage('claude-opus-5-5', 1, 1, 1, 1), 10, true)
  expect(addTurn(book, 'Spec', undefined, 5000, true)).toBe(book)
  expect(EMPTY.rows).toEqual({})
  expect(book.rows.Spec?.ms).toBe(10)
})

test('a subagent turn adds tokens but no minutes, and addTurn adds no turns', () => {
  const book = addTurn(EMPTY, 'Build', usage('claude-haiku-4-5', 5, 6, 7, 8), 9000, false)
  expect(book.rows.Build?.ms).toBe(0)
  expect(book.rows.Build?.turns).toBe(0)
  expect(book.rows.Build?.models['claude-haiku-4-5']).toEqual({ input: 5, output: 6, cacheRead: 7, cacheWrite: 8 })
})

test('countGoalTurn adds one goal turn to the row', () => {
  const once = countGoalTurn(EMPTY, 'Plan')
  const twice = countGoalTurn(once, 'Plan')
  expect(once.rows.Plan?.turns).toBe(1)
  expect(twice.rows.Plan?.turns).toBe(2)
  expect(EMPTY.rows).toEqual({})
})

test('formatUsage lists models, the row total, all phases and the footer', () => {
  let book = addTurn(EMPTY, 'Spec', usage('claude-opus-5-5', 1000, 200, 5000, 300), 30000, true)
  book = addTurn(book, 'Spec', usage('claude-haiku-4-5', 10, 200, 5000, 300), 30000, true)
  book = countGoalTurn(countGoalTurn(book, 'Spec'), 'Spec')
  const lines = formatUsage(book, 'FOOTER').split('\n')
  expect(lines[0]).toBe('| Phase | Model | Input | Output | Cache read | Cache write | Total | Input+output | Turns | Minutes |')
  const haiku = lines.findIndex(line => line.startsWith('| Spec | claude-haiku-4-5 |'))
  const opus = lines.findIndex(line => line.startsWith('| Spec | claude-opus-5-5 |'))
  expect(haiku).toBeGreaterThan(1)
  expect(opus).toBeGreaterThan(haiku)
  expect(lines[haiku]).toBe('| Spec | claude-haiku-4-5 | 10 | 200 | 5,000 | 300 | 5,510 | 210 | - | - |')
  expect(lines[opus]).toBe('| Spec | claude-opus-5-5 | 1,000 | 200 | 5,000 | 300 | 6,500 | 1,200 | - | - |')
  expect(lines[opus + 1]).toBe('| Spec | all models | 1,010 | 400 | 10,000 | 600 | 12,010 | 1,410 | 2 | 1 |')
  expect(lines[opus + 2]).toBe('| All phases | all models | 1,010 | 400 | 10,000 | 600 | 12,010 | 1,410 | 2 | 1 |')
  expect(lines.slice(opus + 3)).toEqual(['', 'FOOTER'])
})

test('formatUsage totals several phases and separates thousands by hand', () => {
  let book = addTurn(EMPTY, 'Spec', usage('claude-opus-5-5', 1234567, 0, 0, 0), 60000, true)
  book = addTurn(book, 'Plan gate', usage('claude-opus-5-5', 1000000, 1, 0, 0), 120000, true)
  const text = formatUsage(book, USAGE_FOOTER)
  expect(text).toContain('| Spec | claude-opus-5-5 | 1,234,567 | 0 | 0 | 0 | 1,234,567 | 1,234,567 | - | - |')
  expect(text).toContain('| All phases | all models | 2,234,567 | 1 | 0 | 0 | 2,234,568 | 2,234,568 | 0 | 3 |')
  expect(text.endsWith(USAGE_FOOTER)).toBe(true)
})

test('formatUsage says so when nothing is counted', () => {
  expect(formatUsage(EMPTY, USAGE_FOOTER)).toBe('No tokens counted yet.')
})

test('formatUsage puts the guard level and a blank line above the table, and the table is the same', () => {
  const book: UsageBook = {
    schema: 'usage-1',
    rows: { Build: { models: { m: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } }, turns: 1, ms: 60_000 } },
  }
  const plain = formatUsage(book, 'F')
  expect(formatUsage(book, 'F', 'review')).toBe(`Guard level: review\n\n${plain}`)
  expect(formatUsage(EMPTY, 'F', 'strict').split('\n')[0]).toBe('Guard level: strict')
})

test('the footer names what is counted and what is not', () => {
  expect(USAGE_FOOTER).toBe(
    "Counted from turn.complete, main loop and subagents. A turn's tokens go to its last model. Turns are goal turns. Not counted: the /goal evaluator and, in auto mode, the permission classifier (both on a small model; /usage lists them). Input+output is the headline; cache tokens are listed apart."
  )
})

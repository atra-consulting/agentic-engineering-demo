import type { TurnUsage } from 'claude-code'
import type { Counts, GuardLevel, PhaseName, RunState, UsageBook, UsageRow } from '../types'

export const USAGE_FOOTER =
  "Counted from turn.complete, main loop and subagents. A turn's tokens go to its last model. Turns are goal turns. Not counted: the /goal evaluator and, in auto mode, the permission classifier (both on a small model; /usage lists them). Input+output is the headline; cache tokens are listed apart."

const WAITING: ReadonlySet<RunState> = new Set<RunState>(['gate', 'blocked', 'capped', 'interrupted'])

const NO_COUNTS: Counts = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

const NO_ROW: UsageRow = { models: {}, turns: 0, ms: 0 }

const HEADER = ['Phase', 'Model', 'Input', 'Output', 'Cache read', 'Cache write', 'Total', 'Input+output', 'Turns', 'Minutes']

export function rowName(phase: PhaseName, state: RunState, rerun: number): string {
  if (WAITING.has(state)) return `${phase} gate`
  return rerun > 0 ? `${phase} rerun ${rerun}` : phase
}

export function modelKey(raw: string): { key: string; provider: string } {
  const bedrock = /^(?:[a-z]{2,}\.)?anthropic\.(.+)$/.exec(raw)
  if (bedrock?.[1]) return { key: bedrock[1], provider: 'bedrock' }
  const at = raw.indexOf('@')
  if (at > 0) return { key: raw.slice(0, at), provider: 'vertex' }
  return { key: raw, provider: 'anthropic' }
}

export function addTurn(book: UsageBook, row: string, usage: TurnUsage | undefined, durationMs: number, isMainLoop: boolean): UsageBook {
  if (!usage) return book
  const current = book.rows[row] ?? NO_ROW
  const { key } = modelKey(usage.model)
  const before = current.models[key] ?? NO_COUNTS
  const counts: Counts = {
    input: before.input + usage.input_tokens,
    output: before.output + usage.output_tokens,
    cacheRead: before.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: before.cacheWrite + usage.cache_creation_input_tokens,
  }
  const next: UsageRow = {
    ...current,
    models: { ...current.models, [key]: counts },
    ms: current.ms + (isMainLoop ? durationMs : 0),
  }
  return { ...book, rows: { ...book.rows, [row]: next } }
}

export function countGoalTurn(book: UsageBook, row: string): UsageBook {
  const current = book.rows[row] ?? NO_ROW
  return { ...book, rows: { ...book.rows, [row]: { ...current, turns: current.turns + 1 } } }
}

function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function totalOf(counts: Counts): number {
  return counts.input + counts.output + counts.cacheRead + counts.cacheWrite
}

function line(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function countCells(counts: Counts): string[] {
  return [
    grouped(counts.input),
    grouped(counts.output),
    grouped(counts.cacheRead),
    grouped(counts.cacheWrite),
    grouped(totalOf(counts)),
    grouped(counts.input + counts.output),
  ]
}

function sumOf(all: Counts[]): Counts {
  return all.reduce(
    (sum, c) => ({
      input: sum.input + c.input,
      output: sum.output + c.output,
      cacheRead: sum.cacheRead + c.cacheRead,
      cacheWrite: sum.cacheWrite + c.cacheWrite,
    }),
    NO_COUNTS
  )
}

function minutes(ms: number): string {
  return String(Math.round(ms / 60000))
}

// The usage text; with a level, a line naming the guard level and a blank line come first.
export function formatUsage(book: UsageBook, footer: string, level?: GuardLevel): string {
  const table = usageTable(book, footer)
  return level === undefined ? table : `Guard level: ${level}\n\n${table}`
}

function usageTable(book: UsageBook, footer: string): string {
  const names = Object.keys(book.rows)
  if (names.length === 0) return 'No tokens counted yet.'
  const lines = [line(HEADER), line(HEADER.map((_, i) => (i < 2 ? '---' : '---:')))]
  let turns = 0
  let ms = 0
  const everything: Counts[] = []
  for (const name of names) {
    const row = book.rows[name] ?? NO_ROW
    const models = Object.keys(row.models).sort()
    for (const model of models) {
      const counts = row.models[model] ?? NO_COUNTS
      lines.push(line([name, model, ...countCells(counts), '-', '-']))
    }
    const rowCounts = sumOf(models.map(model => row.models[model] ?? NO_COUNTS))
    lines.push(line([name, 'all models', ...countCells(rowCounts), grouped(row.turns), minutes(row.ms)]))
    everything.push(rowCounts)
    turns += row.turns
    ms += row.ms
  }
  lines.push(line(['All phases', 'all models', ...countCells(sumOf(everything)), grouped(turns), minutes(ms)]))
  return `${lines.join('\n')}\n\n${footer}`
}

// The longest log line the terminal draws whole.
export const LOG_LINE_CHARS = 2000

// The usage in a few short lines, for a log line: per row, input plus output, goal turns and active minutes; then the
// total; then where the full table is. Rows that don't fit within LOG_LINE_CHARS give way to a count of them.
export function compactUsage(book: UsageBook, head: string, last: string): string {
  const rowLine = (name: string, counts: Counts, turns: number, ms: number) =>
    `${name}: ${grouped(counts.input + counts.output)} input+output · ${grouped(turns)} turns · ${minutes(ms)} min`
  const names = Object.keys(book.rows)
  const rows = names.map(name => {
    const row = book.rows[name] ?? NO_ROW
    return rowLine(name, sumOf(Object.values(row.models)), row.turns, row.ms)
  })
  const all = Object.values(book.rows)
  const total = rowLine(
    'All phases',
    sumOf(all.map(row => sumOf(Object.values(row.models)))),
    all.reduce((sum, row) => sum + row.turns, 0),
    all.reduce((sum, row) => sum + row.ms, 0)
  )
  const join = (kept: string[], left: number) => [head, ...kept, ...(left > 0 ? [`+${left} more rows`] : []), total, last].join('\n')
  for (let kept = rows.length; kept >= 0; kept--) {
    const text = join(rows.slice(0, kept), rows.length - kept)
    if (text.length < LOG_LINE_CHARS) return text
  }
  return join([], rows.length).slice(0, LOG_LINE_CHARS - 1)
}

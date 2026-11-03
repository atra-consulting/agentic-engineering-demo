import type { ThemeKey } from 'claude-code'
import type { AcResult, Approval, GuardLevel, PhaseName, PhaseStatus, Run, RunState, TraceRow } from '../types'
import { FIX_CAP_START, FIX_CAP_STEP, stuckChoices } from './fixpushes'
import type { FixState, StuckChoice } from './fixpushes'

export const PHASES: readonly [PhaseName, ...PhaseName[]] = ['Intent', 'Spec', 'Plan', 'Build', 'Test', 'PR']

export const GATES: ReadonlySet<PhaseName> = new Set<PhaseName>(['Intent', 'Spec', 'Plan'])

type GateName = 'Intent' | 'Spec' | 'Plan'

export function isGate(phase: PhaseName): phase is GateName {
  return GATES.has(phase)
}

export const FILES: Record<PhaseName, string> = {
  Intent: 'intent.md',
  Spec: 'spec.md',
  Plan: 'plan.md',
  Build: 'build.md',
  Test: 'test.md',
  PR: 'pr.md',
}

export const SKILLS: Record<PhaseName, string> = {
  Intent: 'write-intent',
  Spec: 'write-spec',
  Plan: 'plan-change',
  Build: 'build-change',
  Test: 'test-change',
  PR: 'open-pr',
}

export const TURN_CAPS: Record<PhaseName, number> = { Intent: 10, Spec: 15, Plan: 20, Build: 40, Test: 25, PR: 60 }

const COMMAND = '/goal-and-do'
const MAX_WORDS_LENGTH = 30
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]+-\d+$/

// Change ID

function ticketKeyIn(input: string): string | undefined {
  if (KEY_PATTERN.test(input)) return input.toUpperCase()
  const url = /^https?:\/\/[^/?#\s]+([^?#\s]*)$/i.exec(input.replace(/[?#].*$/, ''))
  if (!url) return undefined
  const last = (url[1] ?? '').replace(/\/+$/, '').split('/').pop() ?? ''
  return KEY_PATTERN.test(last) ? last.toUpperCase() : undefined
}

function wordsOf(text: string): string[] {
  return text
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word !== '')
}

function slugOf(text: string): string {
  const words = wordsOf(text)
  let slug = ''
  for (const word of words) {
    const next = slug === '' ? word : `${slug}-${word}`
    if (next.length > MAX_WORDS_LENGTH) {
      return slug === '' ? word.slice(0, MAX_WORDS_LENGTH) : slug
    }
    slug = next
  }
  return slug
}

// A ticket's browse URL the pane can link: http or https, a plain host, no spaces, quotes or brackets, ending in its
// key. undefined for a key alone, free text or anything else.
export function ticketLink(input: string): { href: string; key: string } | undefined {
  const href = input.trim()
  if (!/^https?:\/\/[A-Za-z0-9.-]+(?::\d+)?\/[A-Za-z0-9._~\/-]*$/.test(href)) return undefined
  const key = ticketKeyIn(href)
  return key === undefined ? undefined : { href, key }
}

// The request file a run started from: one word ending in .md.
export function isRequestFile(input: string): boolean {
  return /^\S+\.md$/.test(input.trim())
}

export function changeIdFrom(input: string, nowMs: number): { id: string; source: 'jira' | 'freeform' } {
  const trimmed = input.trim()
  const key = ticketKeyIn(trimmed)
  if (key) return { id: key, source: 'jira' }
  return { id: freeformId(trimmed, nowMs), source: 'freeform' }
}

// The ID of a free-text request: CH-, the date, then the slug of its words, else the time.
export function freeformId(text: string, nowMs: number): string {
  const trimmed = text.trim()
  const iso = new Date(nowMs).toISOString()
  const date = iso.slice(0, 10).replace(/-/g, '')
  const slug = slugOf(trimmed)
  return `CH-${date}-${slug === '' ? iso.slice(11, 16).replace(':', '') : slug}`
}

// The line a request file's ID comes from: its first heading's title, else its first line that holds text.
export function requestTitle(text: string): string {
  const lines = text.split(/\r?\n/)
  const heading = lines.map(line => /^#{1,6}\s+(.*\S)\s*$/.exec(line)?.[1]).find(title => title !== undefined)
  return heading ?? lines.find(line => line.trim() !== '')?.trim() ?? ''
}

export const REQUEST_FILE_CHARS = 20_000

// A request file: its text below the front matter, and the base its front matter names. The front matter may hold only
// base: <branch>; any other line in it, or front matter that never closes, is refused.
export function requestFileParts(fileText: string): { text: string; base?: string } | 'bad front matter' {
  const text = fileText.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines[0]?.trimEnd() !== '---') return { text: text.trim() }
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---')
  if (end === -1) return 'bad front matter'
  let base: string | undefined
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '') continue
    const found = /^base:\s*(\S+)\s*$/.exec(line)
    if (found === null || base !== undefined) return 'bad front matter'
    base = found[1]
  }
  const body = lines
    .slice(end + 1)
    .join('\n')
    .trim()
  return base === undefined ? { text: body } : { text: body, base }
}

// Phase files

function frontMatterLines(fileText: string): string[] | undefined {
  const lines = fileText.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trimEnd() !== '---') return undefined
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---')
  return end === -1 ? undefined : lines.slice(1, end)
}

export function frontMatterValue(fileText: string, key: string): string | undefined {
  for (const line of frontMatterLines(fileText) ?? []) {
    const at = line.indexOf(':')
    if (at <= 0 || line.slice(0, at) !== key) continue
    const value = line.slice(at + 1).trim()
    const quoted = /^(["'])(.*)\1$/.exec(value)
    return quoted ? quoted[2] : value
  }
  return undefined
}

export function phaseStatus(fileText: string): PhaseStatus | undefined {
  const value = frontMatterValue(fileText, 'status')
  return value === 'done' || value === 'blocked' || value === 'draft' ? value : undefined
}

export function testPathsFrom(planText: string): string[] {
  return (frontMatterValue(planText, 'test-paths') ?? '').split(/\s+/).filter(path => path !== '')
}

// The heading of a phase file's open points: Open points, or Open questions in intent.md.
export const POINTS_HEADING = /^#{1,6}\s+open\s+(?:points|questions)\s*$/i

const DECISION_LEAD = /^[\s>*_+-]*(?:\d+\.)?[\s*_]*decided(?![a-z])/i
const DECISION_INSIDE = /(^|[\s([{*_])decided\s*[*_]*\s*[:(]/gi
const NOT_YET = /\b(?:not|to\s+be|yet\s+to\s+be)[\s*_]*$/i

// A decision marker: the line starts with the word Decided (after list markers and emphasis), or holds "Decided:" or
// "Decided (" after a space, a bracket or emphasis, never inside a word (undecided) or after not, to be, yet to be.
function isDecision(line: string): boolean {
  if (DECISION_LEAD.test(line)) return true
  for (const match of line.matchAll(DECISION_INSIDE)) {
    const before = line.slice(0, (match.index ?? 0) + (match[1] ?? '').length)
    if (!NOT_YET.test(before)) return true
  }
  return false
}

const ANSWER = /^[\s>*_+-]*(?:\d+\.)?[\s*_]*answer\s*\([^)]*\)\s*[*_]*:\s*[*_]*(.*)$/i

// An answer from the walk-through, Answer (<date>): "<text>", unless its text starts with Not known yet.
function isAnswer(line: string): boolean {
  const text = ANSWER.exec(line)?.[1]
  return text !== undefined && !/^[\s"'\u201c]*not\s+known\s+yet/i.test(text)
}

// The lines under the Open points (or Open questions) heading, its subsections included, up to the next heading of the
// same or a higher level; undefined without the heading.
export function pointLines(text: string | undefined): string[] | undefined {
  const lines = (text ?? '').split(/\r?\n/)
  const at = lines.findIndex(line => POINTS_HEADING.test(line.trim()))
  if (at < 0) return undefined
  const level = /^#+/.exec((lines[at] ?? '').trim())?.[0].length ?? 2
  const end = lines.findIndex((line, i) => i > at && (/^#+(?=\s)/.exec(line.trim())?.[0].length ?? 7) <= level)
  return lines.slice(at + 1, end < 0 ? undefined : end)
}

// The items under Open points (or Open questions), its subsections included, and how many of them have no decision marker in them or in the lines
// under them and no answer under them; an item of just "None" is no open point. A line that starts with Decided or Answer
// belongs to the item above it, list marker or not.
export function pointCounts(text: string | undefined): { undecided: number; total: number } {
  const lines = pointLines(text)
  if (lines === undefined) return { undecided: 0, total: 0 }
  let undecided = 0
  let total = 0
  let isOpen = false
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line.trim())) {
      // A subsection's heading ends the item above it.
      if (isOpen) undecided++
      isOpen = false
      continue
    }
    const item = /^(?:[-*]|\d+\.)\s+(\S.*)$/.exec(line)
    if (item && (DECISION_LEAD.test(line) || ANSWER.test(line))) {
      if (isOpen && (DECISION_LEAD.test(line) || isAnswer(line))) isOpen = false
    } else if (item) {
      if (isOpen) undecided++
      const isNone = /^none\.?$/i.test((item[1] ?? '').trim())
      if (!isNone) total++
      isOpen = !isNone && !isDecision(line)
    } else if (isOpen && (isDecision(line) || isAnswer(line))) {
      isOpen = false
    }
  }
  return { undecided: undecided + (isOpen ? 1 : 0), total }
}

export function undecidedPoints(text: string | undefined): number {
  return pointCounts(text).undecided
}

// The high-risk items of intent.md's front matter (high-risk: a; b, or none).
export function highRiskItems(text: string | undefined): string[] {
  const value = frontMatterValue(text ?? '', 'high-risk') ?? ''
  return value
    .split(';')
    .map(item => item.trim())
    .filter(item => item !== '' && !/^none\.?$/i.test(item))
}

// The high-risk items whose open question has no answer yet: the question starts with the item's words and a colon.
// An answer of Not known yet leaves it open, and an item without its question counts as unanswered, so approval waits.
export function highRiskUnanswered(text: string | undefined): string[] {
  const block = (pointLines(text) ?? []).filter(line => !/^#{1,6}\s/.test(line.trim()))
  // Each open point with the lines under it, a top-level Decided or Answer item included.
  const items: string[][] = []
  for (const line of block) {
    const isItem = /^(?:[-*]|\d+\.)\s+\S/.test(line) && !DECISION_LEAD.test(line) && !ANSWER.test(line)
    if (isItem) items.push([line])
    else items.at(-1)?.push(line)
  }
  return highRiskItems(text).filter(risk => {
    const lead = risk.toLowerCase() + ':'
    const item = items.find(found =>
      (found[0] ?? '')
        .replace(/^(?:[-*]|\d+\.)\s+[*_]*/, '')
        .toLowerCase()
        .startsWith(lead)
    )
    return item === undefined || pointCounts(['## Open questions', ...item].join('\n')).undecided > 0
  })
}

// The criterion lines of intent.md: the list items under Business acceptance criteria that start with a BAC ID.
export function criteriaOf(intentText: string): { id: string; line: string }[] {
  const criteria: { id: string; line: string }[] = []
  let isInside = false
  for (const line of intentText.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line.trim())
    if (heading) {
      isInside = /^business acceptance criteria$/i.test(heading[1] ?? '')
      continue
    }
    const id = isInside ? /^(?:[-*+]|\d+\.)\s+[*_]*(BAC-\d+)\b/.exec(line.trim())?.[1] : undefined
    if (id !== undefined) criteria.push({ id, line: line.trim() })
  }
  return criteria
}

// The trace chain

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.replace(/[*_`]/g, '').trim())

const RESULT_WORDS: Record<string, AcResult> = { pass: 'passed', passed: 'passed', fail: 'failed', failed: 'failed' }

// Of two results for one AC the worse one stands: failed, then unknown, then passed.
const worse = (a: AcResult | undefined, b: AcResult): AcResult =>
  a === 'failed' || b === 'failed' ? 'failed' : a === 'unknown' || b === 'unknown' ? 'unknown' : 'passed'

// The AC ID | Test | Result table of test.md: each AC ID with passed, failed or unknown (any other Result cell).
export function acResults(testText: string): Record<string, AcResult> {
  const results: Record<string, AcResult> = {}
  let columns: { id: number; result: number } | undefined
  for (const line of testText.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) {
      if (columns !== undefined) break
      continue
    }
    const cells = cellsOf(line)
    if (columns === undefined) {
      const id = cells.findIndex(cell => /^ac id$/i.test(cell))
      const result = cells.findIndex(cell => /^result$/i.test(cell))
      if (id >= 0 && result >= 0) columns = { id, result }
      continue
    }
    const ac = /^AC-\d+$/i.exec(cells[columns.id] ?? '')?.[0].toUpperCase()
    if (ac === undefined) continue
    results[ac] = worse(results[ac], RESULT_WORDS[(cells[columns.result] ?? '').toLowerCase()] ?? 'unknown')
  }
  return results
}

const BAC_NUMBER = /^BAC-(\d+)$/
const byNumber = (a: string, b: string) => Number(BAC_NUMBER.exec(a)?.[1]) - Number(BAC_NUMBER.exec(b)?.[1])

// The ACs of spec.md: the headings ### AC-<n> (BAC-<n>, ...), (none) or (dropped). A dropped AC is left out; an AC whose
// brackets name no criterion counts as one that serves none.
function acBlocksOf(specText: string): { id: string; bacs: string[]; isNone: boolean }[] {
  const blocks: { id: string; bacs: string[]; isNone: boolean }[] = []
  for (const line of specText.split(/\r?\n/)) {
    const found = /^#{1,6}\s+(AC-\d+)\s*\(([^)]*)\)/i.exec(line.trim())
    if (found === null) continue
    const note = (found[2] ?? '').trim()
    if (/^dropped$/i.test(note)) continue
    const bacs = (note.match(/BAC-\d+/gi) ?? []).map(id => id.toUpperCase())
    blocks.push({ id: (found[1] ?? '').toUpperCase(), bacs, isNone: bacs.length === 0 })
  }
  return blocks
}

// The criteria that the lines - BAC-<n> (out of scope): ... under Out of scope in spec.md name.
function outOfScopeIn(specText: string): string[] {
  const ids: string[] = []
  let isInside = false
  for (const line of specText.split(/\r?\n/)) {
    const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line.trim())
    if (heading) {
      isInside = /^out of scope$/i.test(heading[1] ?? '')
      continue
    }
    const id = isInside ? /^[-*+]\s+[*_]*(BAC-\d+)[*_]*\s*\(out of scope\)\s*:/i.exec(line.trim())?.[1] : undefined
    if (id !== undefined) ids.push(id.toUpperCase())
  }
  return ids
}

const DROPPED = /^(?:[-*+]|\d+\.)\s+[*_]*BAC-\d+[*_]*\s*\(dropped\)/i

// One row per criterion of intent.md, in its order: its ACs with their marks (flagged when Out of scope lists it too), none,
// or out of scope (Spec); then one row
// per criterion that spec.md names and intent.md lacks (or marks dropped); then the ACs that serve no criterion. A spec.md
// with no (BAC-<n>) gives no rows.
export function traceRows(intentText: string, specText: string, testText: string): TraceRow[] {
  const acs = acBlocksOf(specText)
  if (!acs.some(ac => ac.bacs.length > 0)) return []
  const results = acResults(testText)
  const isMarked = Object.keys(results).length > 0
  const mark = (id: string): { id: string; result?: AcResult } => (isMarked ? { id, result: results[id] ?? 'unknown' } : { id })
  const live = criteriaOf(intentText)
    .filter(criterion => !DROPPED.test(criterion.line))
    .map(criterion => criterion.id)
  const outOfScope = new Set(outOfScopeIn(specText))
  const rows: TraceRow[] = live.map(id => {
    const served = acs.filter(ac => ac.bacs.includes(id)).map(ac => mark(ac.id))
    if (served.length === 0) return { id, kind: outOfScope.has(id) ? 'out of scope' : 'none', acs: served }
    return outOfScope.has(id) ? { id, kind: 'acs', acs: served, alsoOutOfScope: true } : { id, kind: 'acs', acs: served }
  })
  const named = new Set([...acs.flatMap(ac => ac.bacs), ...outOfScope])
  for (const id of [...named].filter(name => !live.includes(name)).sort(byNumber)) rows.push({ id, kind: 'not in intent', acs: [] })
  const unserved = acs.filter(ac => ac.isNone).map(ac => mark(ac.id))
  if (unserved.length > 0) rows.push({ id: 'no BAC', kind: 'no bac', acs: unserved })
  return rows
}

const MARKS: Record<AcResult, string> = { passed: ' ✔', failed: ' ✖', unknown: ' ?' }

// Above this many lines the pane folds the chain until the person opens it.
export const TRACE_LINES = 5

const lineColor = (row: TraceRow): ThemeKey | undefined =>
  row.kind === 'none' || row.kind === 'not in intent' || row.alsoOutOfScope ? 'warning' : row.kind === 'out of scope' ? 'subtle' : undefined

// One piece of a chain line: its text in the line's color, and the ID it opens when it is a criterion's ID.
export interface TracePart {
  text: string
  color?: ThemeKey
  button?: string
}

// The chain's results for its header: each AC once, as ' · 11 ✔ · 2 ✖' (and ' · 1 ?' for an AC test.md doesn't name);
// empty before test.md marks any AC.
export function traceSummary(rows: readonly TraceRow[]): string {
  const results = new Map<string, AcResult>()
  for (const ac of rows.flatMap(row => row.acs)) if (ac.result !== undefined) results.set(ac.id, ac.result)
  if (results.size === 0) return ''
  const count = (result: AcResult) => [...results.values()].filter(found => found === result).length
  const parts = (['passed', 'failed', 'unknown'] as const).filter(result => count(result) > 0).map(result => `${count(result)}${MARKS[result]}`)
  return parts.map(part => ` · ${part.trim()}`).join('')
}

// A row as the parts of its line, such as BAC-1 → AC-1 ✔, AC-2 ✖, each BAC and AC ID a button. None and not in
// intent.md warn, as does a criterion with ACs that Out of scope lists too; out of scope is neutral. The pane wraps a line
// that is too wide.
export function traceParts(row: TraceRow): TracePart[] {
  const color = lineColor(row)
  const part = (text: string, button?: string): TracePart => ({
    text,
    ...(color === undefined ? {} : { color }),
    ...(button === undefined ? {} : { button }),
  })
  const acs = row.acs.flatMap((ac, i) => [...(i === 0 ? [] : [part(', ')]), part(ac.id, ac.id), ...(ac.result === undefined ? [] : [part(MARKS[ac.result])])])
  const head = row.kind === 'no bac' ? [part(`${row.id}: `)] : [part(row.id, row.id), part(' → ')]
  switch (row.kind) {
    case 'acs':
      return [...head, ...acs, ...(row.alsoOutOfScope ? [part(' (also out of scope)')] : [])]
    case 'none':
      return [...head, part('none')]
    case 'out of scope':
      return [...head, part('out of scope (Spec)')]
    case 'not in intent':
      return [...head, part('not in intent.md')]
    case 'no bac':
      return [...head, ...acs]
  }
}

const LIST_MARKER = /^(?:[-*+]|\d+\.)\s+/
const STEP = /^[*_]*(?:given|when|then|and|but)\b/i
const FENCE = /^(?:```|~~~)/

// The most a criterion's text keeps, in lines and in characters; what it leaves out ends in …
export const CRITERION_LINES = 12
export const CRITERION_CHARS = 1200

interface Kept {
  lines: string[]
  chars: number
  isCut: boolean
}

// Adds a line to a criterion's text within its bounds, in time linear in the line.
function keep(kept: Kept, line: string): void {
  if (kept.isCut) return
  if (kept.lines.length === CRITERION_LINES) {
    kept.isCut = true
    kept.lines[kept.lines.length - 1] += ' …'
    return
  }
  const room = CRITERION_CHARS - kept.chars
  const chars = line.length > room ? Array.from(line) : undefined
  if (chars !== undefined && chars.length > room) {
    kept.isCut = true
    kept.lines.push(`${chars.slice(0, room).join('')}…`)
    return
  }
  kept.lines.push(line)
  kept.chars += chars?.length ?? Array.from(line).length
}

// Adds a step's indented next line to the step, within the bounds.
function extend(kept: Kept, line: string): void {
  const last = kept.lines.length - 1
  if (kept.isCut || last < 0) return
  const room = CRITERION_CHARS - kept.chars - 1
  const chars = line.length > room ? Array.from(line) : undefined
  if (chars !== undefined && chars.length > room) {
    kept.isCut = true
    kept.lines[last] += ` ${chars.slice(0, Math.max(0, room)).join('')}…`
    return
  }
  kept.lines[last] += ` ${line}`
  kept.chars += 1 + (chars?.length ?? Array.from(line).length)
}

// The text the chain opens under a criterion's ID: a BAC's line from intent.md after its ID, and an AC's Given, When and
// Then lines (And and But too) from spec.md, each without its list marker. An AC's text starts at its first such line and
// ends at the next line of another kind, a code fence or a heading; a heading inside a fence counts as none. An indented
// line right under a step that is no list item goes on that step, as the rest of a wrapped line. A criterion
// keeps at most CRITERION_LINES lines and CRITERION_CHARS characters, and one with no text has no entry.
export function criterionTexts(intentText: string, specText: string): Record<string, string[]> {
  const found = new Map<string, Kept>()
  for (const { id, line } of criteriaOf(intentText)) {
    const text = line
      .replace(LIST_MARKER, '')
      .replace(/^[*_]*BAC-\d+[*_]*\s*[:.]?[*_]*\s*/, '')
      .trim()
    if (text === '' || found.has(id)) continue
    const kept: Kept = { lines: [], chars: 0, isCut: false }
    keep(kept, text)
    found.set(id, kept)
  }
  let ac: { kept: Kept; stage: 'before' | 'in' | 'done'; isAfterStep: boolean } | undefined
  let isFenced = false
  for (const line of specText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (FENCE.test(trimmed)) {
      isFenced = !isFenced
      if (ac?.stage === 'in') ac.stage = 'done'
      continue
    }
    if (isFenced) continue
    if (/^#{1,6}\s/.test(trimmed)) {
      const id = /^#{1,6}\s+(AC-\d+)\b/i.exec(trimmed)?.[1]?.toUpperCase()
      ac = id === undefined || found.has(id) ? undefined : { kept: { lines: [], chars: 0, isCut: false }, stage: 'before', isAfterStep: false }
      if (id !== undefined && ac !== undefined) found.set(id, ac.kept)
      continue
    }
    if (ac === undefined || ac.stage === 'done') continue
    if (trimmed === '') {
      ac.isAfterStep = false
      continue
    }
    const text = trimmed.replace(LIST_MARKER, '').trim()
    if (STEP.test(text)) {
      ac.stage = 'in'
      ac.isAfterStep = true
      keep(ac.kept, text)
    } else if (ac.isAfterStep && /^\s/.test(line) && !LIST_MARKER.test(trimmed)) {
      extend(ac.kept, trimmed)
    } else if (ac.stage === 'in') {
      ac.stage = 'done'
    }
  }
  const texts: Record<string, string[]> = {}
  for (const [id, kept] of found) if (kept.lines.length > 0) texts[id] = kept.lines
  return texts
}

// Whether the pane draws the chain: from the Spec gate on.
export function isTraceShown(run: Run): boolean {
  const spec = PHASES.indexOf('Spec')
  return run.phase > spec || (run.phase === spec && run.state === 'gate')
}

// The criteria with an Out of scope line, whatever their ACs: the Spec gate question names them.
export function outOfScopeOf(rows: TraceRow[]): string[] {
  return rows.filter(row => row.kind === 'out of scope' || row.alsoOutOfScope).map(row => row.id)
}

// Goals and arguments

// The PR goal names the run's fix push cap and count, so a reset count or a raised cap reaches the agent; a run without
// them has 0 of the starting cap.
export function goalFor(phase: PhaseName, id: string, fix: FixState = { fixPushes: 0, fixCap: FIX_CAP_START }): string {
  const dir = `changes/${id}/`
  const skill = `goal-and-do:${SKILLS[phase]}`
  const stop = `Stop after ${TURN_CAPS[phase]} turns.`
  switch (phase) {
    case 'Intent':
      return `Write the intent ${dir}intent.md with the ${skill} skill, from request.md beside it. Done when its front matter says status: done and it has Problem, Outcome, Business acceptance criteria (BAC-1 to BAC-n), Users, Constraints, and Open questions sections, or status: blocked with the reason under Open questions. Show the front matter and the section headings as your last step. ${stop}`
    case 'Spec':
      return `Write the spec ${dir}spec.md with the ${skill} skill, from intent.md beside it. Done when spec.md has, in its front matter, status: done with acceptance criteria AC-1 to AC-n and an Open points section, or status: blocked with the reason under Open points. Show the front matter as your last step. ${stop}`
    case 'Plan':
      return `Write the technical plan ${dir}plan.md with the ${skill} skill, detailed enough for developers to judge and approve. Done when plan.md has, in its front matter, status: done with tasks naming AC IDs, a How to Test section and committed acceptance tests that fail when run, or status: blocked with the reason under Open points. Show the front matter and the failing run. ${stop}`
    case 'Build':
      return `Implement the plan ${dir}plan.md task by task with the ${skill} skill, never changing the acceptance tests. Done when build.md beside it has, in its front matter, status: done with the build and every acceptance test passing, or status: blocked with the reason under Open points. Show the front matter and the test output. ${stop}`
    case 'Test':
      return `Verify the change in ${dir} with the ${skill} skill. Done when test.md there has, in its front matter, status: done with every AC ID mapped to a passing test, the full suite passing, and no change to the acceptance tests since approvals.md's locked-at, or status: blocked with the reason under Open points. Show the front matter, the suite output and the diff check. ${stop}`
    case 'PR':
      return `Open the draft PR for ${dir} with the ${skill} skill, then watch its checks and fix failing ones, at most ${fix.fixCap} fix pushes in all, ${fix.fixPushes} done so far, never the acceptance tests or CI files. Done when pr.md there has, in its front matter, status: done with a pr-url line (a URL, or none when origin is not GitHub) and a checks line (passed, none or failed), or status: blocked with the reason. Show the front matter. ${stop}`
  }
}

type Args =
  | { kind: 'start'; input: string; base?: string; strict?: true }
  | { kind: 'level'; level: GuardLevel }
  | { kind: 'next' | 'status' | 'allow' | 'allow local' | 'stop' | 'usage' | 'misplaced base' | 'misplaced strict' | 'subcommand words' }

// A base branch name the mod may hand to git: letters, digits and . _ / -, no leading -, no .., and not HEAD. git's own
// rules for a branch name (git check-ref-format --branch) come on top, in the mod.
export function isBranchName(name: string): boolean {
  return /^[A-Za-z0-9._/-]+$/.test(name) && !name.startsWith('-') && !name.includes('..') && name !== 'HEAD'
}

const SUBCOMMANDS: ReadonlySet<string> = new Set(['next', 'status', 'allow', 'allow local', 'stop'])

// --base <branch> as the first word, then the request. Anywhere else --base is plain text, except after a ticket key or
// URL, a subcommand's word or a request file's path, which can't be a request with more words. The --base=<branch> form first, --base without a branch, or followed by
// nothing or a subcommand's word is misplaced: the start is refused, so no stray run begins.
// --strict follows the same rules as the first word, or right after --base <branch>: `--strict --base <branch> <request>`
// and `--base <branch> --strict <request>` both ask for strict. After a ticket, a subcommand's word or a request file,
// alone, before a subcommand's word, given twice or as --strict=<value> it is misplaced; inside free text it is plain text. `level strict|review` is a
// subcommand; `level` with any other word is refused like the words after next and status.
export function parseArgs(args: string): Args {
  const input = args.trim()
  if (input === '') return { kind: 'usage' }
  const words = input.split(/\s+/)
  const isBaseWord = (word: string) => word === '--base' || word.startsWith('--base=')
  const isStrictWord = (word: string) => word === '--strict' || word.startsWith('--strict=')
  if ((words[0] ?? '').startsWith('--base=')) return { kind: 'misplaced base' }
  if ((words[0] ?? '').startsWith('--strict=')) return { kind: 'misplaced strict' }
  // A ticket, a subcommand's word or a request file can't take more words, so --base or --strict after one is misplaced too.
  const first = (words[0] ?? '').toLowerCase()
  const isClosedFirst = ticketKeyIn(words[0] ?? '') !== undefined || SUBCOMMANDS.has(first) || first === 'allow' || first === 'level' || /^\S+\.md$/.test(first)
  if (isClosedFirst && words.slice(1).some(isBaseWord)) return { kind: 'misplaced base' }
  if (isClosedFirst && words.slice(1).some(isStrictWord)) return { kind: 'misplaced strict' }
  if (words[0] === '--strict') {
    const rest = parseArgs(input.slice('--strict'.length))
    if (rest.kind === 'misplaced base') return rest
    return rest.kind === 'start' && rest.strict !== true && !isStrictWord(words[1] ?? '') ? { ...rest, strict: true } : { kind: 'misplaced strict' }
  }
  if (words[0] === '--base') {
    const based = /^--base\s+(\S+)\s+([\s\S]*\S)\s*$/.exec(input)
    let request = based?.[2] ?? ''
    let strict = false
    if (based !== null && request.split(/\s+/)[0] === '--strict') {
      request = request.slice('--strict'.length).trim()
      strict = true
    }
    const requestWord = request.toLowerCase().replace(/\s+/g, ' ')
    // A ticket or a request file after the branch takes no more words either, so a --strict after it is misplaced.
    const requestWords = request.split(/\s+/)
    const isClosedRequest = ticketKeyIn(requestWords[0] ?? '') !== undefined || /^\S+\.md$/.test((requestWords[0] ?? '').toLowerCase())
    if (based !== null && isClosedRequest && requestWords.slice(1).some(isStrictWord)) return { kind: 'misplaced strict' }
    if (based !== null && (isStrictWord(request.split(/\s+/)[0] ?? '') || (strict && (requestWord === '' || SUBCOMMANDS.has(requestWord))))) {
      return { kind: 'misplaced strict' }
    }
    if (based === null || SUBCOMMANDS.has(requestWord)) return { kind: 'misplaced base' }
    return strict ? { kind: 'start', input: request, base: based[1] ?? '', strict: true } : { kind: 'start', input: request, base: based[1] ?? '' }
  }
  // next and status take no more words: a typed `next reruns Intent` is no request for a run.
  if (words.length > 1 && (first === 'next' || first === 'status')) return { kind: 'subcommand words' }
  if (first === 'level') {
    const level = words.length === 2 ? (words[1] ?? '').toLowerCase() : ''
    return level === 'strict' || level === 'review' ? { kind: 'level', level } : { kind: 'subcommand words' }
  }
  const word = input.toLowerCase().replace(/\s+/g, ' ')
  if (SUBCOMMANDS.has(word)) return { kind: word as 'next' | 'status' | 'allow' | 'allow local' | 'stop' }
  return { kind: 'start', input }
}

// Run and transitions

export function newRun(fields: {
  id: string
  input: string
  source: 'jira' | 'freeform'
  base: string
  now: number
  env: Run['env']
  level?: GuardLevel
}): Run {
  return {
    schema: 2,
    id: fields.id,
    input: fields.input,
    source: fields.source,
    base: fields.base,
    phase: 0,
    state: 'running',
    startedAt: fields.now,
    goalActive: false,
    pendingGoal: true,
    pendingClear: false,
    turns: 0,
    reruns: {},
    approvals: [],
    pushApproved: false,
    fixPushes: 0,
    fixCap: FIX_CAP_START,
    candidates: {},
    suggested: [],
    offered: [],
    usage: { schema: 'usage-1', rows: {} },
    env: fields.env,
    guardLevel: fields.level ?? 'strict',
  }
}

export const ACTIVE_STATES: readonly RunState[] = ['running', 'gate', 'blocked', 'capped', 'interrupted']

export function isActive(run: Run | null): boolean {
  return run !== null && ACTIVE_STATES.includes(run.state)
}

function phaseOf(run: Run): PhaseName {
  return PHASES[run.phase] ?? PHASES[0]
}

function nextPhase(run: Run): Run {
  return { ...run, phase: run.phase + 1, state: 'running', goalActive: false, pendingGoal: true, turns: 0, reason: undefined }
}

export function afterStatus(run: Run, status: PhaseStatus | undefined, reason?: string): Run {
  if (run.state !== 'running') return run
  if (status === 'done') {
    if (run.phase >= PHASES.length - 1) return { ...run, state: 'finished', goalActive: false, reason: undefined }
    if (GATES.has(phaseOf(run))) return { ...run, state: 'gate', goalActive: false, reason: undefined }
    return nextPhase(run)
  }
  return { ...run, state: 'blocked', goalActive: false, reason }
}

export function countTurn(run: Run): Run {
  if (run.state !== 'running') return run
  const turns = run.turns + 1
  return turns >= TURN_CAPS[phaseOf(run)] ? { ...run, turns, state: 'capped' } : { ...run, turns }
}

export function approve(run: Run, approval: Approval, lock?: { lockedAt: string; lockedFiles: Record<string, string>; testPaths: string[] }): Run {
  if (run.state !== 'gate') return run
  return { ...nextPhase(run), approvals: [...run.approvals, approval], ...lock }
}

export function rerun(run: Run): Run {
  if (run.state !== 'blocked' && run.state !== 'capped' && run.state !== 'interrupted') return run
  const phase = phaseOf(run)
  return {
    ...run,
    state: 'running',
    goalActive: false,
    pendingGoal: true,
    turns: 0,
    reason: undefined,
    reruns: { ...run.reruns, [phase]: (run.reruns[phase] ?? 0) + 1 },
  }
}

export function stop(run: Run): Run {
  if (!isActive(run)) return run
  return { ...run, state: 'stopped', goalActive: false, pendingGoal: false, pendingClear: true }
}

export function restored(run: Run): Run {
  return run.state === 'running' ? { ...run, state: 'interrupted', goalActive: false, pendingGoal: false } : run
}

export function offer(run: Run, rules: string[]): Run {
  return { ...run, offered: [...new Set([...run.offered, ...rules])] }
}

export function nextAction(
  run: Run | null
): 'gate-dialog' | 'rerun' | 'start-pending' | 'refuse-goal-running' | 'refuse-finished' | 'refuse-stopped' | 'no-run' {
  if (run === null) return 'no-run'
  switch (run.state) {
    case 'gate':
      return 'gate-dialog'
    case 'blocked':
    case 'capped':
    case 'interrupted':
      return 'rerun'
    case 'running':
      return run.goalActive ? 'refuse-goal-running' : 'start-pending'
    case 'finished':
      return 'refuse-finished'
    case 'stopped':
      return 'refuse-stopped'
  }
}

// Person-facing texts

const TICKET_OR_TEXT = '<ticket URL | key | text | file.md>'
const NOT_KNOWN_YET = "Not known yet (stays open for the ticket's owner)"
const SKIPPED_STAYS_OPEN =
  'When a question times out or the person skips it, the point stays open, even when an option came back with it. Write nothing under it.'
// The walk-through's last words: the dialog it came from opens again when its turn ends.
const reopens = (dialog: 'gate' | 'stuck'): string => (dialog === 'gate' ? 'the mod then opens the gate again.' : 'the mod then opens the Stuck dialog again.')
const startOverSteps = (id: string, base: string) => `git reset -- changes/${id}, git switch ${base}, rm -r changes/${id}, git branch -D sdd/${id}`
const startOver = (id: string, base: string) => `To start over: ${startOverSteps(id, base)}.`

// The Plan gate's walk-through writes a decided departure from a criterion into spec.md. The line is unindented, after a blank line and
// below the AC's last line, so the readers of spec.md (acBlocksOf, traceRows, criterionTexts) take it for none of the AC's steps.
const departureWrite = (id: string, date: string): string =>
  `A point that starts 'Departure AC-<n>:' is a gap that changes the criterion AC-<n>. When the person decides it, write one more line after the Decided line, into changes/${id}/spec.md with your Edit tool, from the person's words and not yours: 'Departure (${date}, decided at the Plan gate): <what was decided and why>'. Put it unindented, after a blank line, below the last line of AC-<n>'s block and below any Departure line already there; change no other line of spec.md, so the AC's heading and its Given, When and Then lines stay as they are. A point the person skips or declines gets no Departure line.`

// How a walk-through labels each question, so its count and the side pane's "k/N open" agree: the place among all the
// points in the file, and how many have no answer yet (this one included).
const WALK_LABEL =
  "Start each question with the label 'Question <n> of <N> · <k>/<N> open': n is its place among all the points in the file, N is how many points the file has, and k is how many have no answer yet, this one included, counted as the side pane counts them."

// The way back during a walk-through: the question before is asked again, with the answer it got, and its line is replaced.
const GO_BACK =
  "From the second question on, offer 'Back to question <n-1>' as the last option, at most four options in all. When the person picks it, ask that question again, show the answer they gave, and when they answer, replace its line instead of adding one. Then go on with the question after it."

export const TEXTS = {
  gateHeader: 'Gate',
  gateQuestion(
    phase: GateName,
    id: string,
    testPaths: string[],
    openPoints = 0,
    outOfScope: string[] = [],
    plan: { testCommand: string; plannedPaths: number } = { testCommand: '', plannedPaths: 0 }
  ): string {
    const file = `changes/${id}/${FILES[phase]}`
    // How many points stay open on approval, and which phase carries them; Plan's go on with the plan itself.
    const carried = (noun: 'question' | 'point', next?: PhaseName): string => {
      if (openPoints === 0) return ''
      const count = openPoints === 1 ? `1 open ${noun} stays` : `${openPoints} open ${noun}s stay`
      const carrier = next === undefined ? '' : `; ${next} carries ${openPoints === 1 ? 'it' : 'them'}`
      return ` ${count} open if you approve${carrier}.`
    }
    switch (phase) {
      case 'Intent':
        return `Intent is done: ${file}. Check the problem, the outcome, and the business acceptance criteria.${carried('question', 'Spec')} Approve and start Spec?`
      case 'Spec': {
        const accepted = outOfScope.map(criterion => ` Spec puts ${criterion} out of scope; approving accepts that.`).join('')
        return `Spec is done: ${file}. Check that the acceptance criteria are complete and the open points answered.${carried('point', 'Plan')}${accepted} Approve and start Plan?`
      }
      case 'Plan': {
        const command = plan.testCommand === '' ? 'none' : plan.testCommand
        const planned = plan.plannedPaths === 0 ? 'none' : String(plan.plannedPaths)
        return `Plan is done: ${file}. Check the tasks, the test map, and the acceptance tests that lock when you approve: ${testPaths.join(', ')}. Test command: ${command}. Planned paths: ${planned}.${carried('point')} Approve and start Build?`
      }
    }
  },
  gateOptions: (next: PhaseName): string[] => [`Approve, start ${next}`, "Not yet, I'll review or edit first", 'Stop this run'],
  gateText(phase: PhaseName, id: string): string {
    const next = PHASES[PHASES.indexOf(phase) + 1]
    return `${phase} is done: changes/${id}/${FILES[phase]}. Read it, edit it, or ask Claude for changes. Then type ${COMMAND} next to approve and start ${next}, or ${COMMAND} stop to end the run. Continue with ${COMMAND} next.`
  },

  stuckHeader: 'Stuck',
  stuckBlocked: (phase: PhaseName, reason: string, id: string): string => `${phase} is blocked: ${reason} (changes/${id}/${FILES[phase]}). Rerun ${phase}?`,
  stuckCapped: (phase: PhaseName, id: string): string =>
    `${phase} ran out of turns (${TURN_CAPS[phase]}) without status: done in changes/${id}/${FILES[phase]}. Rerun ${phase}?`,
  stuckOptions: (phase: PhaseName): string[] => [`Rerun ${phase} now`, "Not yet, I'll fix it first", 'Stop this run'],
  // The Stuck dialog of the fix push cap: each choice leaves the stuck state and reruns the phase; only a reset and a raise
  // change the count or the cap.
  stuckFixCap: (phase: PhaseName, reason: string, id: string): string => `${phase} is blocked: ${reason} (changes/${id}/${FILES[phase]}). How should it go on?`,
  fixCapChoiceLabel: (choice: StuckChoice, state: FixState): string => {
    switch (choice) {
      case 'rerun':
        return `Rerun PR now, keep the count (${state.fixPushes} of ${state.fixCap})`
      case 'reset count':
        return `Reset the count to 0 (cap stays ${state.fixCap}) and rerun`
      case 'raise cap':
        return `Raise the cap by ${FIX_CAP_STEP} to ${state.fixCap + FIX_CAP_STEP} (count stays ${state.fixPushes}) and rerun`
    }
  },
  // At most four options, which the question allows: the choices, then Stop this run. A dismissed dialog is "not yet".
  fixCapOptions: (state: FixState): string[] => [
    ...stuckChoices(state).map(choice => TEXTS.fixCapChoiceLabel(choice, state)),
    TEXTS.stuckOptions('PR')[2] ?? 'Stop this run',
  ],

  pushHeader: 'Push',
  pushQuestion: (id: string): string => `Push sdd/${id} to origin and open a draft PR?`,
  // The push dialog's signals: files outside the plan and sensitive files, from the last read of the changed files, and
  // the guard's denials. They gate nothing.
  pushSignals: (outside: number | 'not checked' | 'unknown', sensitive: number | 'unknown', denials: number): string => {
    const files = (count: number | string) => (typeof count === 'number' ? `${count} file${count === 1 ? '' : 's'}` : count)
    return `Outside the plan: ${files(outside)}. Sensitive: ${files(sensitive)}. Denials: ${denials}.`
  },
  denialCount: (count: number): string => `Denials: ${count}.`,
  pushOptions: ['Push and open the draft PR', 'Not now'],
  pushOpenBody: 'Open the PR body in app',

  // The rule dialogs: the first lists each rule as an option, its label the command and its description what it allows.
  ruleHeader: 'Rules',
  ruleQuestion: (count: number): string =>
    count === 1
      ? 'Claude Code asked your permission for this command in this run. Allow it without asking from now on?'
      : 'Claude Code asked your permission for these commands in this run. Tick each one it may run without asking from now on, then pick Submit. Tick none to keep being asked.',
  ruleNotNow: { label: 'Not now', description: 'Claude Code keeps asking.' },
  ruleWhere: 'Where should the rules go?',
  ruleWhereOptions: ['Everyone on this project (.claude/settings.json; you commit it)', 'Only me (.claude/settings.local.json)', 'Not now'],

  startedJira: (id: string): string => `Run ${id} started from Jira ticket ${id} on branch sdd/${id}.`,
  startedFreeText: (id: string): string => `Run ${id} started from free text, no ticket read. To use a ticket, give its key or browse URL alone.`,

  finishedPr: (url: string): string => `All six phases are done. Draft PR: ${url}.`,
  finishedNoPr: 'All six phases are done. No PR: origin is not GitHub.',
  finishedPrNotDraft: (url: string): string => `All six phases are done. PR: ${url}.`,

  summaryHead(id: string, ms: number, io: number, turns: number, level?: GuardLevel): string {
    const minutes = Math.floor(ms / 60000)
    const head = `✔ ${id} finished in ${Math.floor(minutes / 60)} h ${minutes % 60} min · ${shortCount(io)} tokens (input plus output) · ${turns} goal turns`
    return level === undefined ? head : `${head} · Guard level: ${level}`
  },
  summaryPr: (number: string, url: string, checks: string, rounds: number): string =>
    `PR #${number}: ${url} · checks ${checks} · ${rounds} fix round${rounds === 1 ? '' : 's'}`,
  summaryNoPr: 'No PR: origin is not GitHub.',
  summaryNotDraft: '⚠ The PR is not a draft. Convert it to a draft in the PR sidebar before anyone reviews it.',
  summaryReview: (blockers: number, majors: number, minors: number): string => `Review: ${blockers} Blocker, ${majors} Major, ${minors} Minor (see pr.md)`,
  summaryNext: (_id: string): string => 'Next: read the whole diff · mark the PR ready by hand.',
  stuckContinue: (phase: PhaseName): string => `Fix what's needed, then continue with ${COMMAND} next (it reruns ${phase}).`,
  pushContinue: `Continue with ${COMMAND} next when you want to push (it reruns PR).`,
  relockOption: 'Approve the changed tests and re-lock',
  relockQuestion(phase: PhaseName, files: string[]): string {
    const names = files.slice(0, 8).map(file => (/^[A-Za-z0-9._/-]+$/.test(file) ? `\`${file}\`` : '<a file with an unusual name>'))
    if (files.length > 8) names.push(`+${files.length - 8} more`)
    return [
      `${phase} is blocked: the acceptance tests changed since Plan approval.`,
      'Changed locked files:',
      ...(names.length > 0 ? names : ['none found']),
      `Approving records the current tests as the new lock. Approve the changed tests and rerun ${phase}?`,
    ].join('\n')
  },
  relockCommitFirst: 'Commit the test changes first, then approve the re-lock.',
  // Intent's file calls its points Open questions; every other phase file calls them Open points.
  // The Intent gate while a high-risk question has no answer: approval waits for it.
  highRiskWaits: (items: string[]): string =>
    `Approval waits for an answer to each high-risk question: ${items.join('; ')}. "Not known yet" doesn't count; ask the ticket's owner.`,
  highRiskRefused: (items: string[]): string =>
    `Intent can't be approved yet: the high-risk question${items.length === 1 ? '' : 's'} ${items.join('; ')} need${items.length === 1 ? 's' : ''} an answer. Type ${COMMAND} next and walk through the open questions, or edit intent.md.`,
  walkThrough: (count: number, phase?: PhaseName): string =>
    `Walk through the ${count} open ${phase === 'Intent' ? 'question' : 'point'}${count === 1 ? '' : 's'}`,
  walkPrompt: (id: string, file: string, date: string, dialog: 'gate' | 'stuck' = 'gate'): string =>
    `Go through the open points in changes/${id}/${file} one at a time. ${WALK_LABEL} For each point: explain in two or three sentences what is open and why it matters, give your recommendation, and ask the person with AskUserQuestion (your recommendation first, two or three alternatives). ${GO_BACK} Write the decision into ${file} right under that point as a line starting 'Decided (the person, ${date}):' before you go to the next point. ${SKIPPED_STAYS_OPEN}${file === 'plan.md' ? ` ${departureWrite(id, date)}` : ''} Write no names. When all are done, list the decisions and the points still open; ${reopens(dialog)}`,
  intentWalkPrompt: (id: string, date: string, dialog: 'gate' | 'stuck' = 'gate'): string =>
    `Go through the open questions in changes/${id}/intent.md one at a time. ${WALK_LABEL} For each point: explain in two or three sentences what is open and why it matters. Give no recommendation on a question about who, the problem, the cost, or the outcome; a question about a value may keep one, marked as yours. Ask the person with AskUserQuestion and always offer "${NOT_KNOWN_YET}". ${GO_BACK} For a question that starts with an item of high-risk:, say that approval waits for its answer and that Not known yet leaves it open; where a point has no natural options, ask with kind: "text" and name that answer in the question's description. Write the person's answer word for word right under its point, as a line Answer (${date}): "<their words>", with names as roles and credentials as <removed: what it was>. ${SKIPPED_STAYS_OPEN} After the last answer, fold the answers into Problem, Outcome, and the business acceptance criteria: a new or changed criterion takes the next free BAC number, the one it replaces is marked (dropped), and no ID is ever renumbered. Then list the answers and the points still open; ${reopens(dialog)}`,
  walkCounts(answered: number, skipped: number, timedOut: number): string {
    const parts = [`${answered} answered`, ...(skipped > 0 ? [`${skipped} skipped`] : []), ...(timedOut > 0 ? [`${timedOut} timed out`] : [])]
    const open = skipped + timedOut
    return `${parts.join(', ')}${open === 0 ? '.' : open === 1 ? ': it stays open.' : ': they stay open.'}`
  },
  criteriaSince(added: string[], changed: string[]): string {
    const parts = [...(added.length > 0 ? [`added ${added.join(', ')}`] : []), ...(changed.length > 0 ? [`changed ${changed.join(', ')}`] : [])]
    return `Since the gate first opened: ${parts.join('; ')}.`
  },
  intentChanged: 'Spec traced the old intent; edit spec.md or rerun Spec first.',
  intentBlocked: (reason: string): string => `Intent says the change isn't needed: ${reason.replace(/[\s.]+$/, '')}. Stop the run?`,
  intentBlockedOptions: ['Stop this run', 'Rerun Intent', 'Not yet'],
  // Text the person typed at a gate or Stuck dialog instead of picking an option: their request for the phase file.
  typedPrompt: (id: string, phase: PhaseName, typed: string, dialog: 'gate' | 'stuck' = 'gate'): string =>
    `The person typed this at the ${phase} ${dialog} dialog instead of picking an option: "${typed}". When it asks for a change to changes/${id}/${FILES[phase]}, make it the way the phase's skill writes that file, and commit it as that skill commits; when it asks for none, change nothing. Write no Decided or Answer line unless the person decided a point. Then say what you changed, or why nothing; ${reopens(dialog)}`,
  walkPicked: (phase: PhaseName, dialog: 'gate' | 'stuck'): string =>
    `The person picked 'Walk through the open ${phase === 'Intent' ? 'questions' : 'points'}' at the ${phase} ${dialog} dialog.`,
  changedSinceApproval: (file: string): string => `${file} changed since its approval; approving also approves the current ${file}.`,

  notAtRoot: "Start Claude Code in the repository's root folder.",
  // The pane's Help section.
  helpStuck: `Stuck: type ${COMMAND} next alone, with no more words. Esc interrupts a running goal.`,
  helpGetOut: `Get out: ${COMMAND} stop ends the run for good. A stopped run can't be resumed.`,
  helpStartOver: (id: string, base: string): string => `Start over: ${startOverSteps(id, base)}, then start again from the same request.`,
  runActive: (id: string): string => `Run ${id} is active (changes/${id}/). Type ${COMMAND} next to go on.`,
  changeExists: (id: string, base: string): string => `changes/${id}/ exists already. ${startOver(id, base)}`,
  wrongBranch: (branch: string, base: string): string => `You are on branch ${branch}. Switch to the default branch first: git switch ${base}.`,
  notFromPerson: (sub: string, origin: string): string => `Only a person can type ${COMMAND} ${sub}; this came from ${origin}.`,
  goalRunning: (phase: PhaseName): string => `The ${phase} goal is still running. Wait for it, or type ${COMMAND} stop.`,
  noRun: `No run here. Start one with ${COMMAND} ${TICKET_OR_TEXT}.`,
  openHint: 'Point at a word: the ones that invert are buttons you can click.',
  runFinished: (id: string): string => `Run ${id} is finished. Start a new one with ${COMMAND} ${TICKET_OR_TEXT}.`,
  runStopped: (id: string, base: string): string => `Run ${id} was stopped. ${startOver(id, base)}`,
  stopped: (id: string, base: string): string => `Run ${id} stopped. ${startOver(id, base)}`,
  usage: `Usage: ${COMMAND} [--strict] [--base <branch>] ${TICKET_OR_TEXT} | level strict|review | next | status | allow [local] | stop`,
  levelSwitched: (from: GuardLevel, to: GuardLevel): string => `Guard level: ${to}. It was ${from}.`,
  levelUnchanged: (level: GuardLevel): string => `Guard level is already ${level}.`,
  // A request from a .md file of the project.
  requestFileUnreadable: `The request file can't be read, holds no request, or is longer than 20,000 characters. Shorten it, or start with text.`,
  requestFileMissing:
    'A one-word request ending in .md names a request file, and this one is no readable file inside the project: a missing file, a folder, a link that leads outside, or an unusual name. Check the path.',
  subcommandWords: (word: string): string => {
    if (word === 'level') return `${COMMAND} level takes one word, strict or review: type ${COMMAND} level strict or ${COMMAND} level review.`
    const example =
      word === 'next'
        ? ['Next steps for the export', 'Plan the next steps for the export']
        : ['Status badge for the claims page', 'Add a status badge for the claims page']
    return `${COMMAND} ${word} takes no more words: type ${COMMAND} ${word} alone. To start a request that begins with "${word}" (such as "${example[0]}"), begin it with another word ("${example[1]}") or put it in a request file, a .md file in the project.`
  },
  baseMisplaced:
    'Give the base as --base <branch>, as the first word, then the request (a ticket, text or a .md file); a ticket, a subcommand or a .md file with --base after it, or a subcommand or nothing after the branch, starts no run.',
  strictMisplaced:
    'Give --strict as the first word, or right after --base <branch>, before the request (a ticket, text or a .md file); a ticket, a subcommand or a .md file with --strict after it, --strict alone, before a subcommand or given twice, or --strict=<value> starts no run.',
  baseNotFetched: "goal-and-do could not fetch the base branch from origin in time, so it can't check it. Check the network and origin, then start again.",
  requestFileBaseInvalid:
    "The request file's front matter names a base that is no plain branch name: letters, digits and . _ / - only, no leading - and no .., not HEAD, and one git takes.",
  requestFileCommitFirst:
    'The request file is tracked and changed, staged, renamed or deleted. Commit the request file first, or start from a new, untracked one.',
  requestFileBaseMissing:
    "The base the request file's front matter names is not on origin: git can't find origin/<branch> after a fetch. Push it first, or change the front matter.",
  requestFileFrontMatter: "The request file's front matter may hold only base: <branch>. Remove the other lines, or start with text.",
  // The start's base branch: a plain name of letters, digits and . _ / -, never with a leading - or .., on origin.
  baseInvalid:
    'The base branch must be a plain branch name: letters, digits and . _ / - only, no leading - and no ..; give it as --base <branch> before the request.',
  baseMissing: "The base branch is not on origin: git can't find origin/<branch> after a fetch. Push it first, or start without --base.",
  goalEnded: (lastReason: string): string => `the goal ended without status: done: ${lastReason}`,

  preflightNotAtRoot: "You are not at the repository's root folder. Start Claude Code there.",
  preflightNoStatus: "goal-and-do can't read the working tree with git status. Check the repository's Git config, its filters and the Git version.",
  preflightDirty: (paths: string): string => `The working tree has uncommitted changes: ${paths}. Commit or stash them first.`,
  preflightNoJira: 'No Jira tool is connected. Connect the Jira MCP, or start with free text.',
  preflightGh: (host: string): string => `gh is not logged in to ${host}. Run: gh auth login --hostname ${host}`,
  preflightManaged: (key: string): string => `A managed setting (${key}) stops mods or /goal here. Ask your Claude Code admins.`,
}

// Band

function shortCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

// While the person's own prompt runs at a gate or a stuck state, the band says so, not that the run waits.
function stateText(run: Run, isBusy = false): string {
  const phase = phaseOf(run)
  if (isBusy && run.state !== 'running' && run.state !== 'finished') return `working on ${FILES[phase]}`
  switch (run.state) {
    case 'gate':
      return `waiting: approve ${phase} with ${COMMAND} next`
    case 'blocked':
      // The person's next step, as the Stuck dialog and its hint say: fix what the phase file names, then next.
      return `stuck: see ${FILES[phase]}, then type ${COMMAND} next`
    case 'capped':
      return `out of turns: ${COMMAND} next reruns ${phase}`
    case 'interrupted':
      return `interrupted: ${COMMAND} next reruns ${phase}`
    case 'finished':
      return 'finished'
    default:
      return 'working'
  }
}

function markOf(run: Run, index: number): string {
  if (run.state === 'finished' || index < run.phase) return '✔'
  if (index > run.phase) return '○'
  return run.state === 'blocked' || run.state === 'capped' ? '✖' : '●'
}

// One piece of the band as drawn: its text and the theme key it is drawn in.
export interface BandPart {
  text: string
  color?: ThemeKey
  bold?: true
  dim?: true
}

const MARK_STYLES: Record<string, Omit<BandPart, 'text'>> = {
  '✔': { color: 'success' },
  '●': { color: 'claude', bold: true },
  '○': { color: 'inactive', dim: true },
  '✖': { color: 'error', bold: true },
}

// A phase at its gate is current until the person approves it: its mark is drawn in the warning color.
export function phaseMark(run: Run, index: number): { mark: string } & Omit<BandPart, 'text'> {
  const mark = markOf(run, index)
  if (run.state === 'gate' && index === run.phase) return { mark, color: 'warning', bold: true }
  return { mark, ...MARK_STYLES[mark] }
}

export function stateColor(run: Run): ThemeKey | undefined {
  switch (run.state) {
    case 'running':
      return 'suggestion'
    case 'gate':
    case 'interrupted':
      return 'warning'
    case 'blocked':
    case 'capped':
      return 'error'
    case 'finished':
      return 'success'
    default:
      return undefined
  }
}

function lengthOf(line: BandPart[]): number {
  return line.reduce((sum, part) => sum + part.text.length, 0)
}

function cutTo(line: BandPart[], columns: number): BandPart[] {
  const kept: BandPart[] = []
  let room = columns
  for (const part of line) {
    if (room <= 0) break
    kept.push(part.text.length <= room ? part : { ...part, text: part.text.slice(0, room) })
    room -= part.text.length
  }
  return kept
}

// The goal turn the run is in: the turns done plus the one running, at most the phase's cap; a capped run shows its cap.
export function goalTurn(run: Run): number {
  return Math.min(TURN_CAPS[phaseOf(run)], run.state === 'capped' ? run.turns : run.turns + 1)
}

// The current goal turn's clock: when it started and the time now, both in milliseconds, and its tool calls.
export interface TurnClock {
  startedAt: number
  now: number
  calls?: number
}

const DOT: BandPart = { text: ' · ', color: 'subtle' }

interface TailItems {
  turn?: BandPart
  minutes?: BandPart
  calls?: BandPart
  state: BandPart
  level?: BandPart
  denied?: BandPart
  pr?: BandPart
}

// The band's tail as items. While the run is running or capped, it shows the goal turn against the phase's cap; with a
// clock it adds the turn's minutes and, when the clock has them, its calls. Without a clock no goal turn is running, so
// it shows the turns done.
function tailItems(run: Run, clock?: TurnClock, isBusy = false): TailItems {
  const color = isBusy && run.state !== 'running' && run.state !== 'finished' ? 'suggestion' : stateColor(run)
  const state: BandPart = color === undefined ? { text: stateText(run, isBusy) } : { text: stateText(run, isBusy), color }
  const number = prNumber(run.prUrl)
  const pr: BandPart | undefined = number === undefined ? undefined : { text: `PR #${number}`, color: 'suggestion' }
  const hasTurn = run.state === 'running' || run.state === 'capped'
  const turn: BandPart | undefined = hasTurn
    ? { text: `turn ${clock === undefined ? Math.min(TURN_CAPS[phaseOf(run)], run.turns) : goalTurn(run)}/${TURN_CAPS[phaseOf(run)]}`, color: 'subtle' }
    : undefined
  const minutes: BandPart | undefined =
    turn === undefined || clock === undefined ? undefined : { text: `${Math.floor(Math.max(0, clock.now - clock.startedAt) / 60_000)} min`, color: 'subtle' }
  const calls: BandPart | undefined =
    minutes === undefined || clock?.calls === undefined ? undefined : { text: `${clock.calls} call${clock.calls === 1 ? '' : 's'}`, color: 'subtle' }
  // The level shows in the band at review only, with the count of denials once there are some; a strict run's band is as it was.
  // Only the exact value 'review' counts, as guardLevelOf reads it.
  const isReview = run.guardLevel === 'review'
  const level: BandPart | undefined = isReview ? { text: 'review', color: 'warning' } : undefined
  const denied: BandPart | undefined = isReview && (run.deniedCount ?? 0) > 0 ? { text: `${run.deniedCount} denied`, color: 'warning' } : undefined
  // The tokens live in the pane.
  return {
    state,
    ...(level === undefined ? {} : { level }),
    ...(denied === undefined ? {} : { denied }),
    ...(turn === undefined ? {} : { turn }),
    ...(minutes === undefined ? {} : { minutes }),
    ...(calls === undefined ? {} : { calls }),
    ...(pr === undefined ? {} : { pr }),
  }
}

const dotted = (items: (BandPart | undefined)[]): BandPart[] =>
  items.filter((item): item is BandPart => item !== undefined).flatMap((item, i) => (i === 0 ? [item] : [DOT, item]))

// The band's tail from the full text to the least: the PR number goes first, then the calls, the minutes, the turn.
function tailsOf(run: Run, clock?: TurnClock, isBusy = false): BandPart[][] {
  const { turn, minutes, calls, state, level, denied, pr } = tailItems(run, clock, isBusy)
  return [
    [turn, minutes, calls, state, level, denied, pr],
    [turn, minutes, calls, state, level, denied],
    [turn, minutes, state, level, denied],
    [turn, state, level, denied],
    [state, level, denied],
  ].map(dotted)
}

// The band without its phase chain, whole: the turn, the minutes, the calls, the state and the PR number.
export function bandTail(run: Run, clock?: TurnClock, isBusy = false): BandPart[] {
  if (run.state === 'stopped') return []
  return tailsOf(run, clock, isBusy)[0] ?? []
}

// Two spaces between phases, four before the tail.
const PHASE_GAP: BandPart = { text: '  ' }
const TAIL_GAP: BandPart = { text: '    ' }

function marksOf(run: Run): BandPart[] {
  return PHASES.flatMap((name, i) => {
    const { mark, ...style } = phaseMark(run, i)
    // A phase not reached yet shows its name alone; done, current and stuck phases keep their mark.
    const part: BandPart = { text: mark === '○' ? name.toUpperCase() : `${mark} ${name.toUpperCase()}`, ...style }
    return i === 0 ? [part] : [PHASE_GAP, part]
  })
}

// The band in colored parts, line by line: the same text and width rules as bandText. The phase chain and the tail go
// on one line when they fit, the tail shortened as far as needed; else the chain goes on line 1 and the longest tail
// that fits on line 2, so the turn, the minutes and the calls show whenever a line has room for them.
export function bandParts(run: Run, columns: number, clock?: TurnClock, isBusy = false): BandPart[][] {
  if (run.state === 'stopped') return []
  const marks = marksOf(run)
  const tails = tailsOf(run, clock, isBusy)
  // One line is worth more than the details: the PR number goes first, then the calls, then a plain "working"; a state
  // that says more (waiting, blocked, out of turns) stays, and the band takes two lines instead.
  const { turn, minutes } = tailItems(run, clock, isBusy)
  const isWorking = run.state === 'running' && !isBusy
  const shorter = isWorking && turn !== undefined ? [dotted([turn, minutes])] : []
  const oneLine = [...tails.slice(0, 3), ...shorter].map(tail => [...marks, TAIL_GAP, ...tail]).find(line => lengthOf(line) <= columns)
  if (oneLine !== undefined) return [oneLine]
  const second = tails.find(line => lengthOf(line) <= columns)
  return [cutTo(marks, columns), cutTo(second ?? tails.at(-1) ?? [], columns)]
}

// The band as one line for a band with room for one row: the state first, then the turn, the minutes, the calls and the
// PR number, then the phase chain, cut at the columns.
export function bandLine(run: Run, columns: number, clock?: TurnClock, isBusy = false): BandPart[] {
  if (run.state === 'stopped') return []
  const { turn, minutes, calls, state, level, denied, pr } = tailItems(run, clock, isBusy)
  return cutTo([...dotted([state, level, denied, turn, minutes, calls, pr]), TAIL_GAP, ...marksOf(run)], columns)
}

// A draft PR's URL: https, a host, owner, repository and /pull/<n>.
export const PR_URL = /^https:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/(\d+)$/

export function prNumber(url: string | undefined): string | undefined {
  return PR_URL.exec(url ?? '')?.[1]
}

export function bandText(run: Run, columns: number, clock?: TurnClock, isBusy = false): string {
  return bandParts(run, columns, clock, isBusy)
    .map(line => line.map(part => part.text).join(''))
    .join('\n')
}

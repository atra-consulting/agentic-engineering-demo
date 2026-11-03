// What the side pane shows, as pure functions: the turn bar, the changed files, the last test run, and the fit to the
// pane's width. The mod reads git, the run and the tool results; these functions only turn them into lines.
import type { ThemeKey } from 'claude-code'
import type { Footprint, PhaseName } from '../types'
import { REASONS } from './guard'
import { TURN_CAPS, frontMatterValue, type BandPart } from './phases'

// Lines and sections

// The steps of the width rule, in the order the pane gives up its parts when it is too narrow.
export const DROP = { tokens: 1, paths: 2, denials: 3, trace: 4, bar: 5, points: 6 } as const

type DropStep = (typeof DROP)[keyof typeof DROP]

// drop: the line goes at this step. shrink: the line's text becomes this at that step. fold: the line is the header of
// a foldable section, and a press on it folds or unfolds that section. bold: a section's head, drawn in bold.
export interface PaneLine {
  text: string
  color?: ThemeKey
  drop?: DropStep
  shrink?: Partial<Record<DropStep, string>>
  fold?: string
  bold?: true
}

export interface PaneSection {
  id: string
  lines: PaneLine[]
}

// Control characters, escapes, Unicode format characters (bidi overrides, zero-width marks) and line separators, so a name
// from git or a tool result cannot move the cursor, reorder the text or draw over the pane.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\p{Cf}]/gu

const lengthOf = (text: string): number => Array.from(text).length

export function stripControl(text: string): string {
  return text.replace(CONTROL, '')
}

export const UNUSUAL_NAME = '<a file with an unusual name>'

const SAFE_PATH = /^[A-Za-z0-9._/ -]+$/

export function safePath(path: string): string {
  return SAFE_PATH.test(path) ? path : UNUSUAL_NAME
}

// A count with its noun, singular for one.
export const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

export const UNUSUAL_COMMAND = '<a command with unusual characters>'

// Letters, digits and the punctuation of plain arguments: no quote, no $, no backquote, no operator, no redirect.
const SAFE_COMMAND = /^[A-Za-z0-9._/ =:@+,-]+$/

// A test command as a dialog may show it; an empty one stays empty.
export function safeCommand(command: string): string {
  return command === '' || SAFE_COMMAND.test(command) ? command : UNUSUAL_COMMAND
}

const CONTINUATION = '  '

// A line as lines of at most the columns, in code points: it breaks at spaces, and a word longer than a line is split.
// The first line keeps its own leading spaces; each further line starts with two spaces. Where the pane is too narrow for
// that indent, the lines have none.
export function wrapText(text: string, columns: number): string[] {
  const width = Math.max(1, columns)
  const indent = width > CONTINUATION.length ? CONTINUATION : ''
  const lines: string[] = []
  let current = ''
  const isBlank = () => current.trim() === ''
  const flush = () => {
    if (!isBlank()) lines.push(current.trimEnd())
    current = indent
  }
  for (const token of text.match(/ +|[^ ]+/gu) ?? []) {
    if (token.startsWith(' ') && token.trim() === '') {
      // A run of spaces that does not fit ends the line; at the start of a further line it is dropped.
      if (lines.length > 0 && isBlank()) continue
      if (lengthOf(current) + lengthOf(token) <= width) current += token
      else flush()
      continue
    }
    // One pass over the word's code points, so a long word costs no more than its length.
    const chars = Array.from(token)
    let at = 0
    while (at < chars.length) {
      const free = width - lengthOf(current)
      if (chars.length - at <= free) {
        current += chars.slice(at).join('')
        break
      }
      if (!isBlank()) {
        flush()
        continue
      }
      current += chars.slice(at, at + free).join('')
      at += free
      flush()
    }
  }
  if (!isBlank() || lines.length === 0) lines.push(current)
  return lines
}

// A part of a line the pane draws: its text and style, and the ID it opens when it is a button.
export type LinePart = BandPart & { button?: string }

// A line of parts as rows of at most the columns, each part keeping its color and its button. A line that fits stays as it
// is. One that is too wide wraps by wrapText's rule (breaks at spaces, two-space indent on further rows, a word wider than
// a row split); each character of a row takes the style of the part it came from, and the indent has none.
export function wrapParts(line: readonly LinePart[], columns: number): LinePart[][] {
  const text = line.map(part => part.text).join('')
  if (lengthOf(text) <= columns) return [[...line]]
  const origin = line.flatMap(({ text: piece, ...style }) => Array.from(piece).map(char => ({ char, style })))
  const indent = columns > CONTINUATION.length ? CONTINUATION.length : 0
  let at = 0
  return wrapText(text, columns).map((row, i) => {
    const chars = Array.from(row)
    const styled: { char: string; style: Omit<LinePart, 'text'> }[] = []
    chars.forEach((char, j) => {
      if (i > 0 && j < indent) {
        styled.push({ char, style: {} })
        return
      }
      // The spaces wrapText dropped at a break lie between two rows.
      while (at < origin.length && origin[at]?.char !== char) at++
      styled.push({ char, style: origin[at]?.style ?? {} })
      at++
    })
    const parts: LinePart[] = []
    for (const { char, style } of styled) {
      const last = parts.at(-1)
      const isSame = last !== undefined && last.color === style.color && last.bold === style.bold && last.dim === style.dim
      if (last !== undefined && isSame && last.button === style.button) last.text += char
      else parts.push({ text: char, ...style })
    }
    return parts
  })
}

// Below this width a wrapped denial line is not worth the rows it takes: the denial lines go (the width rule's third step)
// and the count stays.
export const DENIAL_MIN_COLUMNS = 20

// The pane gives up its parts in the width rule's order. Before a step, a line that is too wide counts only when this step or
// a later one can shorten it. What is still too wide after the last step wraps onto further lines. Lengths are in code
// points. The sections it gets stay as they are.
export function fitPane(sections: readonly PaneSection[], columns: number): PaneSection[] {
  let fitted = sections.map(section => ({
    ...section,
    lines: section.lines.map(line => ({ ...line, text: stripControl(line.text) })),
  }))
  const canShorten = (line: PaneLine, from: number): boolean =>
    (line.drop !== undefined && line.drop >= from) || Object.keys(line.shrink ?? {}).some(step => Number(step) >= from)
  const isTooWide = (from: number) => fitted.some(section => section.lines.some(line => lengthOf(line.text) > columns && canShorten(line, from)))
  for (const step of Object.values(DROP)) {
    if (!isTooWide(step)) break
    fitted = fitted.map(section => ({
      ...section,
      lines: section.lines
        .filter(line => line.drop !== step)
        .map(line => {
          const shrunk = line.shrink?.[step]
          return shrunk === undefined ? line : { ...line, text: stripControl(shrunk) }
        }),
    }))
  }
  return fitted.map(section => ({
    id: section.id,
    lines: section.lines.flatMap(({ text, color, fold, bold }) =>
      wrapText(text, columns).map(wrapped => ({
        text: wrapped,
        ...(color === undefined ? {} : { color }),
        ...(fold === undefined ? {} : { fold }),
        ...(bold === undefined ? {} : { bold }),
      }))
    ),
  }))
}

// Turns

const BAR_CELLS = 10

// The goal turns used against the phase's cap: the bar, its color from 75% (warning) and 90% (error), the text with the
// turn, the minutes and the calls, and the line the pane draws: the phase and the bar alone, since the band shows the
// numbers.
export function capBar(
  phase: PhaseName,
  turns: number,
  ms: number,
  calls: number
): { text: string; bar: string; cells: number; color?: ThemeKey; line: PaneLine } {
  const cap = TURN_CAPS[phase]
  const cells = Math.min(BAR_CELLS, Math.max(0, Math.round((BAR_CELLS * turns) / cap)))
  const bar = '█'.repeat(cells) + '░'.repeat(BAR_CELLS - cells)
  const color: ThemeKey | undefined = turns * 100 >= cap * 90 ? 'error' : turns * 100 >= cap * 75 ? 'warning' : undefined
  const text = `${phase} · turn ${turns}/${cap} · ${Math.floor(ms / 60_000)} min · ${counted(calls, 'call')}`
  const colored = color === undefined ? {} : { color }
  const line: PaneLine = { text: `${phase}  ${bar}`, shrink: { [DROP.bar]: phase }, ...colored }
  return { text, bar, cells, line, ...colored }
}

// Changed files

interface Group {
  files: number
  added: number
  removed: number
}

// The changed paths under no planned path are outside, undefined when plan.md stores none, so nothing is checked;
// isBroad: a planned entry covers too much (., /, *, **, or a top-level folder).
export type { Footprint }

type FootprintLine = Footprint['lines'][number]

export const FOOTPRINT_UNAVAILABLE = 'Changed Files: unavailable'

const LEARNED_RULES = 'learned rules (this mod)'

const MAX_PATHS = 5

const escaped = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A file by its whole name, in any folder.
const named = (...names: string[]): RegExp => new RegExp(`(^|/)(${names.map(escaped).join('|')})$`)

// Everything under a folder that the path names as whole segments, such as .github/workflows.
const under = (...folders: string[]): RegExp => new RegExp(`(^|/)(${folders.map(escaped).join('|')})/`)

const JENKINSFILE = /(^|\/)Jenkinsfile(\.[^/]*)?$/

const CI_FILES: readonly RegExp[] = [
  under('.github/workflows', '.circleci'),
  JENKINSFILE,
  named('.gitlab-ci.yml', '.gitlab-ci.yaml'),
  /(^|\/)azure-pipelines(-[^/]+)?\.ya?ml$/,
]

// Files a person has to look at before a merge: CI and ownership, Git hooks and config, build, dependency and wrapper
// files, container and infrastructure files, keys and secrets, Claude and app settings, database migrations, and
// instruction files. Names and folders match whole, never by prefix. It ignores plannedPaths.
export const SENSITIVE: readonly RegExp[] = [
  ...CI_FILES,
  under('.github/actions', '.husky', '.githooks', '.cursor', '.claude/skills', '.claude/agents', '.claude/commands', '.claude/hooks'),
  named('CODEOWNERS', '.github/dependabot.yml', '.github/dependabot.yaml', '.pre-commit-config.yaml', '.gitmodules', '.gitattributes'),
  /(^|\/)\.?lefthook(-local)?\.ya?ml$/,
  named('package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'),
  named('pyproject.toml', 'poetry.lock', 'uv.lock', 'Pipfile', 'Pipfile.lock', 'setup.py', 'setup.cfg'),
  /(^|\/)requirements([-_.][^/]*)?\.txt$/,
  named('pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'libs.versions.toml'),
  named('gradlew', 'gradlew.bat', 'mvnw', 'mvnw.cmd'),
  under('gradle/wrapper', '.mvn'),
  named('go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock', 'Gemfile', 'Gemfile.lock', 'composer.json', 'composer.lock', 'Makefile'),
  /\.csproj$/,
  /(^|\/)(Dockerfile|Containerfile)(\.[^/]*)?$/,
  /(^|\/)[^/]+\.Dockerfile$/,
  /(^|\/)(docker-)?compose([.-][^/]*)?\.ya?ml$/,
  /\.(tf|tfvars|bicep|bicepparam)$/,
  named('Chart.yaml', 'Chart.lock', 'values.yaml', 'values.yml', 'kustomization.yaml', 'kustomization.yml'),
  /(^|\/)values-[^/]+\.ya?ml$/,
  /\.(pem|key|p12|pfx|jks|keystore)$/,
  named('id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', '.netrc', '.npmrc', '.pypirc', '.yarnrc', '.yarnrc.yml'),
  /(^|\/)\.env(\..+)?$/,
  /(^|\/)\.claude\/settings[^/]*\.json$/,
  named('.mcp.json'),
  /(^|\/)(application|bootstrap)(-[^/]+)?\.(ya?ml|properties)$/,
  under('migrations', 'db/migrate', 'db/migration', 'db/changelog', 'flyway', 'liquibase'),
  named('CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', 'GEMINI.md', 'SKILL.md', '.cursorrules', '.windsurfrules', '.github/copilot-instructions.md'),
]

const TEST_DIRECTORIES: ReadonlySet<string> = new Set(['test', 'tests', '__tests__', 'spec', 'specs'])

const TEST_NAMES: readonly RegExp[] = [/^test_.+/, /^.+_test\.[A-Za-z0-9]+$/, /^.+\.(test|spec)\.[A-Za-z0-9]+$/, /^.+Tests?\.(java|kt|cs|scala|swift)$/]

function isTestFile(path: string): boolean {
  const parts = path.split('/')
  return parts.slice(0, -1).some(part => TEST_DIRECTORIES.has(part)) || TEST_NAMES.some(name => name.test(parts.at(-1) ?? ''))
}

const cleanEntry = (entry: string): string =>
  entry
    .trim()
    .replace(/^(\.\/)+/, '')
    .replace(/\/+$/, '')

// A path equal to the entry or under it as a folder. A glob is an ordinary name here.
const isCoveredBy = (path: string, entry: string): boolean => {
  const folder = cleanEntry(entry)
  return folder !== '' && (path === folder || path.startsWith(`${folder}/`))
}

const BROAD_ENTRIES: ReadonlySet<string> = new Set(['.', '/', '*', '**', './', ''])

// A top-level folder is one segment that ends in a slash or has changed files under it, so a top-level file stays fine.
function isBroadEntry(entry: string, paths: readonly string[]): boolean {
  const trimmed = entry.trim()
  if (BROAD_ENTRIES.has(trimmed) || BROAD_ENTRIES.has(cleanEntry(trimmed))) return true
  const folder = cleanEntry(trimmed)
  return !folder.includes('/') && (trimmed.endsWith('/') || paths.some(path => path.startsWith(`${folder}/`)))
}

const noun = (count: number): string => `${count} file${count === 1 ? '' : 's'}`

const lineCounts = (group: Group): string => `+${group.added} -${group.removed}`

type PathList = 'outside' | 'sensitive' | 'last'

// The paths of a list, each line naming the list it belongs to, so the pane can fold them under its head line.
function pathLines(paths: readonly string[], list: PathList): FootprintLine[] {
  const lines: FootprintLine[] = paths.slice(0, MAX_PATHS).map(path => ({ text: `  ${path}`, drop: DROP.paths, under: list }))
  if (paths.length > MAX_PATHS) lines.push({ text: `  +${paths.length - MAX_PATHS} more`, drop: DROP.paths, under: list })
  return lines
}

// The files and lines changed since the change branched off, from git diff --numstat -z --no-renames <base> and git
// ls-files -z --others --exclude-standard. A binary file has - for its lines.
export function footprint(
  numstat: string,
  untracked: string,
  options: { plannedPaths?: readonly string[]; testPaths?: readonly string[]; id: string; learnedRules?: readonly string[] }
): Footprint {
  const changed = new Map<string, { added: number; removed: number }>()
  for (const entry of numstat.split('\0')) {
    const found = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(entry)
    if (found === null || changed.has(found[3] ?? '')) continue
    changed.set(found[3] ?? '', { added: Number(found[1]) || 0, removed: Number(found[2]) || 0 })
  }
  for (const path of untracked.split('\0')) {
    if (path !== '' && !changed.has(path)) changed.set(path, { added: 0, removed: 0 })
  }
  const paths = [...changed.keys()]

  const groups = {
    tests: { files: 0, added: 0, removed: 0 },
    ci: { files: 0, added: 0, removed: 0 },
    rest: { files: 0, added: 0, removed: 0 },
  }
  const total: Group = { files: 0, added: 0, removed: 0 }
  const testPaths = options.testPaths ?? []
  const isTest = (path: string) => testPaths.some(entry => isCoveredBy(path, entry)) || isTestFile(path)
  for (const [path, lines] of changed) {
    const group = isTest(path) ? groups.tests : CI_FILES.some(pattern => pattern.test(path)) ? groups.ci : groups.rest
    for (const target of [group, total]) {
      target.files++
      target.added += lines.added
      target.removed += lines.removed
    }
  }

  const planned = options.plannedPaths ?? []
  const isChecked = planned.length > 0
  const outside = isChecked
    ? paths.filter(path => !planned.some(entry => isCoveredBy(path, entry)) && !path.startsWith(`changes/${options.id}/`) && !isTest(path))
    : undefined
  const isBroad = isChecked && planned.some(entry => isBroadEntry(entry, paths))
  const learned = options.learnedRules ?? []
  const sensitive = paths
    .filter(path => SENSITIVE.some(pattern => pattern.test(path)))
    .map(path => (learned.includes(path) ? { path, label: LEARNED_RULES } : { path }))

  const lines: FootprintLine[] = [{ text: total.files === 0 ? 'Changed Files: none' : `Changed Files: ${total.files} (${lineCounts(total)})` }]
  for (const [name, group] of [
    ['Tests', groups.tests],
    ['CI', groups.ci],
    ['Other', groups.rest],
  ] as const) {
    if (group.files > 0) lines.push({ text: `  ${name}: ${noun(group.files)} (${lineCounts(group)})` })
  }
  if (outside === undefined) {
    lines.push({ text: 'Outside the Plan: not checked (no planned-paths in plan.md)' })
  } else {
    lines.push({
      text: outside.length === 0 ? 'Outside the Plan: none' : `Outside the Plan: ${noun(outside.length)}`,
      ...(outside.length === 0 ? {} : { color: 'warning' as const, head: 'outside' as const, count: outside.length }),
    })
    lines.push(...pathLines(outside.map(safePath), 'outside'))
  }
  if (isBroad) lines.push({ text: 'Planned paths cover too much', color: 'warning' })
  lines.push({
    text: sensitive.length === 0 ? 'Sensitive Files: none' : `Sensitive Files: ${sensitive.length}`,
    ...(sensitive.length === 0 ? {} : { color: 'warning' as const, head: 'sensitive' as const, count: sensitive.length }),
  })
  const shown = sensitive.map(item => (item.label === undefined ? safePath(item.path) : `${safePath(item.path)} (${item.label})`))
  lines.push(...pathLines(shown, 'sensitive'))
  return { groups, total, outside, isBroad, sensitive, lines: lines.map(line => ({ ...line, text: stripControl(line.text) })), paths }
}

export const LAST_CHANGED = 5

// The changed files with the newest change time, newest first, five at most, under their own header; a path whose time
// is unknown (a deleted file) leaves the list.
export function lastChangedLines(files: readonly { path: string; mtimeMs: number | undefined }[]): FootprintLine[] {
  const newest = files
    .filter((file): file is { path: string; mtimeMs: number } => file.mtimeMs !== undefined)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
    .slice(0, LAST_CHANGED)
  if (newest.length === 0) return []
  return [
    { text: `Last Changed: ${newest.length}`, head: 'last', count: newest.length },
    ...newest.map(file => ({ text: stripControl(`  ${safePath(file.path)}`), drop: DROP.paths, under: 'last' as const })),
  ]
}

// Test runs

// The words of a command as a chain: the segments between operators (without their leading VAR=value pairs), the operator
// after each, and the commands inside substitutions. An operator inside quotes stays part of its word. A redirect such as
// 2>&1 stays part of its word. Any bracket or backtick counts as an operator that is not &&. A word is an assignment only when its name and
// the = are unquoted and unescaped; its value may hold quotes and escapes. isMalformed: the command starts with an operator or ends with &&, || or |, so the shell
// would refuse it.
interface Chain {
  segments: string[][]
  operators: string[]
  nested: string[][]
  isMalformed: boolean
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

function chainOf(command: string): Chain {
  const segments: string[][] = []
  const operators: string[] = []
  const nested: string[][] = []
  let isMalformed = false
  let words: { text: string; plainLength: number }[] = []
  let word = ''
  let isWord = false
  let plainLength = Infinity
  const endWord = () => {
    if (isWord) words.push({ text: word, plainLength })
    word = ''
    isWord = false
    plainLength = Infinity
  }
  const endSegment = (operator: string) => {
    let start = 0
    while (start < words.length && ASSIGNMENT.test((words[start]?.text ?? '').slice(0, words[start]?.plainLength))) start++
    segments.push(words.slice(start).map(item => item.text))
    operators.push(operator)
    words = []
  }
  const addOperator = (operator: string) => {
    endWord()
    if (words.length > 0) {
      endSegment(operator)
    } else if (operators.length > 0) {
      operators[operators.length - 1] += operator
    } else {
      isMalformed = true
    }
  }
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i)
    const next = command.charAt(i + 1)
    if (c === "'") {
      isWord = true
      plainLength = Math.min(plainLength, word.length)
      const end = command.indexOf("'", i + 1)
      word += command.slice(i + 1, end === -1 ? undefined : end)
      if (end === -1) break
      i = end
    } else if (c === '"') {
      isWord = true
      plainLength = Math.min(plainLength, word.length)
      let inner = ''
      let j = i + 1
      while (j < command.length && command.charAt(j) !== '"') {
        if (command.charAt(j) === '\\' && '"\\$`'.includes(command.charAt(j + 1)) && j + 1 < command.length) j++
        inner += command.charAt(j)
        j++
      }
      word += inner
      if (/\$\(|`/.test(inner)) {
        const found = chainOf(inner.replace(/\$\(|`|\)/g, ';'))
        nested.push(...found.segments, ...found.nested)
      }
      i = j
    } else if (c === '\\') {
      if (next !== '' && next !== '\n') {
        isWord = true
        plainLength = Math.min(plainLength, word.length)
        word += next
      }
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else if (c === '&' && next === '&') {
      addOperator('&&')
      i++
    } else if (c === '|' && next === '|') {
      addOperator('||')
      i++
    } else if (c === '|' && next === '&') {
      addOperator('|')
      i++
    } else if (c === '&' && (command.charAt(i - 1) === '>' || command.charAt(i - 1) === '<' || next === '>')) {
      isWord = true
      word += c
    } else if (c === '|' || c === '&' || c === ';' || c === '\n' || c === '(' || c === ')' || c === '`' || (c === '$' && next === '(')) {
      addOperator(c === '\n' ? ';' : c === '$' ? '(' : c)
      if (c === '$') i++
    } else {
      isWord = true
      word += c
    }
  }
  endWord()
  if (words.length > 0) endSegment('')
  else if (/(&&|\|\||\|)$/.test(operators.at(-1) ?? '')) isMalformed = true
  return { segments, operators, nested, isMalformed }
}

// The chain without its leading cd <dir> && steps.
function strippedChain(command: string): Chain {
  const chain = chainOf(command)
  let first = 0
  while (first < chain.segments.length && chain.segments[first]?.length === 2 && chain.segments[first]?.[0] === 'cd' && chain.operators[first] === '&&') first++
  return { ...chain, segments: chain.segments.slice(first), operators: chain.operators.slice(first) }
}

const startsWith = (words: readonly string[], prefix: readonly string[]): boolean => prefix.length > 0 && prefix.every((word, i) => words[i] === word)

const equals = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && startsWith(a, b)

// A word that redirects input or output, such as > out.txt or 2>&1.
const REDIRECTS = /[<>]/

// Whether a Bash call ran the test command: run when its whole command, after VAR=value pairs and cd <dir> &&, is the test
// command, or the test command opens it and only && follows; extra when it is the test command with more words (such as
// -v or one test) and otherwise as a run, which may run part of the suite only, so it leaves the last run as it was;
// unreadable when the test command opens a segment of the call in any other way (a pipe, ;, ||, &, a redirection, a later
// position, a substitution), so its result cannot be read; none when no segment starts with it.
export function isTestRun(command: string, testCommand: string): 'run' | 'extra' | 'unreadable' | 'none' {
  if (testCommand.trim() === '') return 'none'
  const wanted = strippedChain(testCommand)
  const first = wanted.segments[0]
  if (wanted.isMalformed || first === undefined || first.length === 0) return 'none'
  const call = strippedChain(command)
  const isNamed = [...call.segments, ...call.nested].some(words => startsWith(words, first))
  if (!isNamed) return 'none'
  const count = wanted.segments.length
  const isLinked = wanted.operators.slice(0, count - 1).every((operator, i) => operator === call.operators[i])
  const isFollowedByAnd = call.operators.slice(count - 1).every(operator => operator === '&&' || operator === '')
  if (call.isMalformed || call.nested.length > 0 || !isLinked || !isFollowedByAnd) return 'unreadable'
  const isBefore = wanted.segments.slice(0, -1).every((words, i) => equals(call.segments[i] ?? [], words))
  const last = wanted.segments[count - 1] ?? []
  const called = call.segments[count - 1] ?? []
  if (!isBefore || !startsWith(called, last)) return 'unreadable'
  if (called.length === last.length) return 'run'
  return called.slice(last.length).some(word => REDIRECTS.test(word)) ? 'unreadable' : 'extra'
}

export type TestRunStatus = 'passed' | 'failed' | 'interrupted' | 'started' | 'unreadable'

// The text the engine gives a Bash call that the person stopped with Esc. Not known yet: the demo session fills it in.
// While it is empty, no text counts as an interrupt, and only the answered record's interrupted flag does.
// Typed as string, not as its empty literal.
// eslint-disable-next-line @typescript-eslint/no-inferrable-types
export const INTERRUPT_TEXT: string = ''

// What next(e) resolved to for a Bash call, as far as the pane reads it.
interface ToolOutcome {
  deny?: string
  isError?: boolean
  text?: string
  result?: unknown
}

// The status of a test run from the Bash call's result. The long-output form (persistedOutputPath) reads like the short one.
export function testRunFrom(outcome: ToolOutcome): TestRunStatus {
  if (outcome.deny !== undefined) return 'unreadable'
  const record = typeof outcome.result === 'object' && outcome.result !== null ? (outcome.result as Record<string, unknown>) : {}
  if (record.interrupted === true) return 'interrupted'
  if (outcome.isError === true) {
    const text = outcome.text ?? ''
    if (text.startsWith('Permission to use ') || text.startsWith('<tool_use_error>')) return 'unreadable'
    return INTERRUPT_TEXT !== '' && text === INTERRUPT_TEXT ? 'interrupted' : 'failed'
  }
  return typeof record.backgroundTaskId === 'string' ? 'started' : 'passed'
}

// The end of a background task, from the text of a prompt whose origin is a task notification. The fields count only as
// whole lines before the first <summary>: the summary holds the command's own text, which can hold any tag.
export function taskEndFrom(text: string): { taskId: string; toolUseId?: string; status?: string } | undefined {
  const trimmed = text.trim()
  if (!trimmed.startsWith('<task-notification>')) return undefined
  const lines = trimmed.slice(0, trimmed.includes('<summary>') ? trimmed.indexOf('<summary>') : undefined).split(/\r?\n/)
  const field = (tag: string) => {
    for (const line of lines) {
      const value = new RegExp(`^<${tag}>([^<]*)</${tag}>$`).exec(line.trim())?.[1]?.trim()
      if (value) return value
    }
    return undefined
  }
  const taskId = field('task-id')
  if (taskId === undefined) return undefined
  const toolUseId = field('tool-use-id')
  const status = field('status')
  return { taskId, ...(toolUseId === undefined ? {} : { toolUseId }), ...(status === undefined ? {} : { status }) }
}

// The result a background task's end sets: completed passed, failed failed, killed interrupted, any other word not
// readable. Without a status the line stays.
export function taskEndStatus(status: string | undefined): TestRunStatus | undefined {
  if (status === undefined) return undefined
  return status === 'completed' ? 'passed' : status === 'failed' ? 'failed' : status === 'killed' ? 'interrupted' : 'unreadable'
}

// Reasons

export type ReasonKey = keyof typeof REASONS

// The pane's text for a guard reason: the fixed text, with no path or phase from the call. For pushPhase it drops the last
// sentence, which repeats the phase.
export function reasonText(key: ReasonKey): string {
  const value = REASONS[key]
  if (typeof value === 'string') return value
  if (key === 'tests') return REASONS.tests('').replace(/: \.$/, '.')
  if (key === 'pushPhase') return REASONS.pushPhase('Intent').replace(/ This is the \S+ phase\.$/, '')
  return (value as (text: string) => string)('').replace(/: \.$/, '.')
}

// plan.md's fields

export function plannedPathsFrom(planText: string): string[] {
  return (frontMatterValue(planText, 'planned-paths') ?? '').split(/\s+/).filter(path => path !== '')
}

export function testCommandFrom(planText: string): string {
  return frontMatterValue(planText, 'test-command') ?? ''
}

// The MCP tool names plan.md allows to write, from its planned-tools line.
export function plannedToolsFrom(planText: string): string[] {
  return (frontMatterValue(planText, 'planned-tools') ?? '').split(/\s+/).filter(name => name !== '')
}

// The variable names plan.md keeps in the test run's environment, from its test-env-keep line.
export function testEnvKeepFrom(planText: string): string[] {
  return (frontMatterValue(planText, 'test-env-keep') ?? '').split(/\s+/).filter(name => name !== '')
}

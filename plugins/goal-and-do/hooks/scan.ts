// The secret check. It finds the secret shapes of shapes.ts in the added lines of a patch, in a commit message and in a PR body, and denies
// with the place, never the value. An inline gitleaks:allow comment changes nothing here. A check that cannot run denies and names the cause.
import { SHELLS, gitSubcommandAt, segmentsOf } from './permissions'
import { ALLOWLIST, LINE_SHAPES, PRIVATE_KEY_BEGIN, PRIVATE_KEY_BODY, PRIVATE_KEY_INLINE } from './shapes'
import type { ShapeId } from './shapes'

export type { ShapeId } from './shapes'

export type Place =
  | { kind: 'file'; commit?: string; path: string; line: number }
  | { kind: 'message'; commit: string; line: number }
  | { kind: 'commit-message'; line: number }
  | { kind: 'pr-body'; line: number }

export interface Hit {
  shape: ShapeId | `scanner:${string}`
  place: Place
}

export type Check = { verdict: 'pass'; scanner: 'ran' | 'not scanned' } | { verdict: 'deny'; reason: string }

export interface CommitPatch {
  sha: string
  message: string
  patch: string
}

export interface GitReader {
  stagedPatch(): Promise<string | undefined>
  commitsAhead(base: string): Promise<CommitPatch[] | undefined>
}

export interface Scanner {
  reportPath: string
  // The config and ignore file the plugin ships. The scanner runs with these and never with a .gitleaks.toml or .gitleaksignore of the scanned repo.
  trusted?: { config: string; ignorePath: string }
  version(): Promise<string | undefined>
  approved(): boolean
  scan(target: 'staged' | { base: string }, args: string[]): Promise<{ exitCode: number; report?: string }>
  removeReport(): Promise<void>
}

export interface AddedLine {
  line: number
  text: string
}

export interface PatchFile {
  path: string
  added: AddedLine[]
}

// The added lines of each file in a unified diff, with their line numbers in the new file.
export function patchFiles(patch: string): PatchFile[] {
  const files: PatchFile[] = []
  let current: PatchFile | undefined
  let inHunk = false
  let next = 0
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      current = undefined
      inHunk = false
      continue
    }
    if (!inHunk && raw.startsWith('+++ ')) {
      const target = raw.slice(4).replace(/\t.*$/, '').trim()
      current = target === '/dev/null' ? undefined : { path: target.replace(/^"?b\//, '').replace(/"$/, ''), added: [] }
      if (current !== undefined) files.push(current)
      continue
    }
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (header !== null) {
      inHunk = true
      next = Number(header[1])
      continue
    }
    if (!inHunk || current === undefined) continue
    if (raw.startsWith('+')) {
      current.added.push({ line: next, text: raw.slice(1) })
      next += 1
    } else if (raw.startsWith(' ')) {
      next += 1
    }
  }
  return files
}

// The shapes in consecutive lines: one hit per shape and line. A private key block is reported at its begin line.
function shapesIn(lines: AddedLine[]): { shape: ShapeId; line: number }[] {
  const found: { shape: ShapeId; line: number }[] = []
  lines.forEach((entry, index) => {
    for (const { id, pattern } of LINE_SHAPES) {
      if (pattern.test(entry.text)) found.push({ shape: id, line: entry.line })
    }
    if (PRIVATE_KEY_INLINE.test(entry.text)) {
      found.push({ shape: 'private-key', line: entry.line })
    } else if (PRIVATE_KEY_BEGIN.test(entry.text)) {
      const following = lines[index + 1]
      if (following?.line === entry.line + 1 && PRIVATE_KEY_BODY.test(following.text)) {
        found.push({ shape: 'private-key', line: entry.line })
      }
    }
  })
  return found
}

export function scanPatch(patch: string, commit?: string): Hit[] {
  const hits: Hit[] = []
  for (const file of patchFiles(patch)) {
    for (const { shape, line } of shapesIn(file.added)) {
      if (ALLOWLIST.some(entry => entry.path === file.path && entry.shape === shape)) continue
      hits.push({ shape, place: commit === undefined ? { kind: 'file', path: file.path, line } : { kind: 'file', commit, path: file.path, line } })
    }
  }
  return hits
}

const textLines = (text: string): AddedLine[] => text.split('\n').map((line, index) => ({ line: index + 1, text: line }))

export function scanMessage(commit: string, message: string): Hit[] {
  return shapesIn(textLines(message)).map(({ shape, line }) => ({ shape, place: { kind: 'message', commit, line } }))
}

const REMOVED = '<removed: token>'
const KEY_END = '-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----'
// One block per begin marker: the body never steps over another begin marker, so a marker in prose cannot hide a key that follows it.
// LINE_SHAPES as global patterns, compiled once for redactSecrets.
const LINE_SHAPES_G = LINE_SHAPES.map(({ pattern }) => new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))

const KEY_BLOCK = new RegExp(`${PRIVATE_KEY_BEGIN.source}(?:(?!${PRIVATE_KEY_BEGIN.source})[\\s\\S])*?(?:${KEY_END}|$)`, 'g')

// The text with each secret shape of shapes.ts replaced by <removed: token>. It adds no shape; other text stays as it is.
export function redactSecrets(text: string): string {
  let out = text.replace(KEY_BLOCK, block => {
    const second = block.split('\n')[1]
    return PRIVATE_KEY_INLINE.test(block) || (second !== undefined && PRIVATE_KEY_BODY.test(second)) ? REMOVED : block
  })
  for (const pattern of LINE_SHAPES_G) {
    out = out.replace(pattern, REMOVED)
  }
  return out
}

const STEPS = [
  '1. Stop: do not commit, push or share the value anywhere else.',
  '2. Rotate: treat the secret as leaked and replace it at its issuer.',
  '3. Report: file the leak through the ACDC form.',
  '4. Document: record what leaked, where, and what you rotated.',
]
const MAX_PLACES = 20

function placeText(hit: Hit): string {
  const { place } = hit
  if (place.kind === 'pr-body') return `PR body, line ${place.line}`
  if (place.kind === 'commit-message') return `commit message, line ${place.line}`
  if (place.kind === 'message') return `commit message of ${place.commit.slice(0, 7)}, line ${place.line}`
  const commit = place.commit === undefined || place.commit === '' ? '' : `, commit ${place.commit.slice(0, 7)}`
  return `file ${place.path}, line ${place.line}${commit}`
}

// Names each place and the shape; never a value.
export function denialText(hits: Hit[]): string {
  const places = hits.slice(0, MAX_PLACES).map(hit => `- ${placeText(hit)} (${hit.shape})`)
  if (hits.length > MAX_PLACES) places.push(`- and ${hits.length - MAX_PLACES} more`)
  return ['A secret shape was found, so the action is denied. The value is not shown.', 'Where:', ...places, 'What to do:', ...STEPS].join('\n')
}

const MAX_FILE_CHARS = 1_000_000

// Why a patch cannot be read: a binary file, or a file over 1 MB.
export function unreadableCause(patch: string): string | undefined {
  if (/^(?:Binary files .* differ|GIT binary patch)$/m.test(patch)) return 'a binary file'
  if (patch.split(/^diff --git /m).some(part => part.length > MAX_FILE_CHARS)) return 'a file over 1 MB'
  return undefined
}

async function attempt<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read()
  } catch {
    return undefined
  }
}

// The index and the work tree can hold the same line twice: one hit per place.
const unique = (hits: Hit[]): Hit[] => {
  const seen = new Set<string>()
  return hits.filter(hit => {
    const key = JSON.stringify([hit.shape, hit.place])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const deny = (reason: string): Check => ({ verdict: 'deny', reason })

function cannotRun(cause: string): Check {
  return deny(`The secret check could not run: ${cause}. A check that cannot run does not pass, so the action is denied. Fix the cause and try again.`)
}

type ScanTarget = Parameters<Scanner['scan']>[0]
type ScanOutcome = { kind: 'ran' | 'not scanned' } | { kind: 'deny'; reason: string }

const settle = (outcome: ScanOutcome): Check => (outcome.kind === 'deny' ? deny(outcome.reason) : { verdict: 'pass', scanner: outcome.kind })

export async function checkCommit(git: GitReader, scanner?: Scanner): Promise<Check> {
  let staged: string | undefined
  let why = ''
  try {
    staged = await git.stagedPatch()
  } catch (error) {
    why = error instanceof Error ? `: ${error.message}` : ''
  }
  if (staged === undefined) return cannotRun(`the staged diff cannot be read${why}`)
  const unreadable = unreadableCause(staged)
  if (unreadable !== undefined) return cannotRun(`the staged diff holds ${unreadable}, which it cannot read`)
  const hits = unique(scanPatch(staged))
  if (hits.length > 0) return deny(denialText(hits))
  return settle(await runScanner(scanner, 'staged'))
}

export async function checkPush(git: GitReader, base: string, scanner?: Scanner): Promise<Check> {
  const commits = await attempt(() => git.commitsAhead(base))
  if (commits === undefined) return cannotRun(`origin/${base} is not fetched, has no merge base with HEAD, or cannot be read`)
  const hits: Hit[] = []
  for (const commit of commits) {
    const unreadable = unreadableCause(commit.patch)
    if (unreadable !== undefined) return cannotRun(`commit ${commit.sha.slice(0, 7)} holds ${unreadable}, which it cannot read`)
    hits.push(...scanMessage(commit.sha, commit.message), ...scanPatch(commit.patch, commit.sha))
  }
  if (hits.length > 0) return deny(denialText(hits))
  return settle(await runScanner(scanner, { base }))
}

// Each simple command of a shell command line as the guard reads it (segmentsOf): a command on its own line, in a subshell or a command
// substitution, behind assignments and wrappers, and inside the string of sh -c or eval.
function simpleCommands(command: string, depth = 0): { commands: string[][]; isUnclear: boolean; isMoved: boolean; hasXargs: boolean } {
  if (depth >= MAX_DEPTH) return { commands: [], isUnclear: true, isMoved: false, hasXargs: false }
  const commands: string[][] = []
  let isUnclear = false
  // isMoved: a cd, or git pointed at another directory, so the paths of a later command are not the project's.
  let isMoved = false
  // hasXargs: xargs appends arguments the command line does not show.
  let hasXargs = false
  for (const segment of segmentsOf(command, true)) {
    if (segment.unparseable) {
      isUnclear = true
      continue
    }
    if (segment.words.length === 0) continue
    commands.push(segment.words)
    const [first = '', ...args] = segment.words
    const name = lastWord(first)
    if (segment.repoOptions || name === 'cd' || name === 'pushd') isMoved = true
    if (segment.xargs) hasXargs = true
    if (SHELLS.has(name) || name === 'eval') {
      const flag = args.findIndex(word => /^-[A-Za-z]*c[A-Za-z]*$/.test(word))
      const inner = name === 'eval' ? args.join(' ') : flag >= 0 ? args[flag + 1] : undefined
      if (inner !== undefined && inner !== '') {
        const sub = simpleCommands(inner, depth + 1)
        commands.push(...sub.commands)
        isUnclear ||= sub.isUnclear
        isMoved ||= sub.isMoved
        hasXargs ||= sub.hasXargs
      }
    }
  }
  return { commands, isUnclear, isMoved, hasXargs }
}

const STDIN_CAUSE = (what: string, option: string): string =>
  `the ${what} comes from standard input, which only a heredoc, a here-string or < file on the same command can feed; give it with ${option} <file>`

const MOVED_CAUSE = (what: string, path: string): string =>
  `the command changes directory (cd, pushd, git -C), so the ${what} file ${path} cannot be placed; give the file as an absolute path or run the command without the change`

const UNCLEAR_CAUSE = 'the command hides what it runs (env -S) or nests shells deeper than the check reads'

// The heredocs of a command text: each body in order (the lines after a << operator up to its delimiter line, and whether the delimiter
// is quoted, which keeps the shell from expanding the body), and the text without the bodies. A here-string (<<<) has none. A body that
// never ends runs to the end of the text, as the shell reads it.
function heredocsOf(command: string): { bodies: { text: string; isQuoted: boolean }[]; rest: string } {
  const lines = command.split('\n')
  const bodies: { text: string; isQuoted: boolean }[] = []
  const rest: string[] = []
  for (let i = 0; i < lines.length; i += 1) {
    rest.push(lines[i] ?? '')
    const operators = [...(lines[i] ?? '').matchAll(/(?<!<)<<(-?)\s*(?:'([^']+)'|"([^"]+)"|(\\?)([A-Za-z0-9_]+))/g)]
    let next = i + 1
    for (const operator of operators) {
      const delimiter = operator[2] ?? operator[3] ?? operator[5] ?? ''
      const isQuoted = operator[2] !== undefined || operator[3] !== undefined || operator[4] === '\\'
      const body: string[] = []
      while (next < lines.length) {
        const line = lines[next] ?? ''
        next += 1
        if ((operator[1] === '-' ? line.replace(/^\t+/, '') : line) === delimiter) {
          rest.push(line)
          break
        }
        body.push(line)
      }
      bodies.push({ text: body.join('\n'), isQuoted })
    }
    i = next - 1
  }
  return { bodies, rest: rest.join('\n') }
}

// `$(cat file)` as a whole value: the check reads the file. `$(cat <<'EOF' ...)` is the lines of its heredoc, which are the lines of the
// message or body. Any other value is checked as the text it is written as; a value that a command builds in another way is not read.
const CAT_FILE = /^\$\(\s*cat\s+([^\s'"`$()|;&<>]+)\s*\)$/
const CAT_HEREDOC_HEAD = /^\$\(\s*cat\s+<<(-?)[ \t]*(?:'([A-Za-z0-9_]+)'|"([A-Za-z0-9_]+)"|\\?([A-Za-z0-9_]+))[ \t]*\n/

// The lines of `$(cat <<'EOF' ... EOF)` when that is the whole value: one heredoc, cat with no other argument, nothing between the delimiter
// and the line end, the delimiter line, then only the closing parenthesis. Any other shape is undefined, and the whole value is checked.
function catHeredocBody(value: string): string | undefined {
  const text = value.trim()
  const head = CAT_HEREDOC_HEAD.exec(text)
  if (head === null) return undefined
  const delimiter = head[2] ?? head[3] ?? head[4] ?? ''
  const lines = text.slice(head[0].length).split('\n')
  const end = lines.findIndex(line => (head[1] === '-' ? line.replace(/^\t+/, '') : line) === delimiter)
  if (end < 0 || !/^\s*\)\s*$/.test(lines.slice(end + 1).join('\n'))) return undefined
  return lines.slice(0, end).join('\n')
}

function addSource(value: string, texts: string[], files: string[]): void {
  const cat = CAT_FILE.exec(value.trim())
  if (cat?.[1] !== undefined) files.push(cat[1])
  else texts.push(catHeredocBody(value) ?? value)
}

// What feeds the standard input of one command: a heredoc, a here-string or a < file on that command itself. A cause when nothing does
// (a terminal, a heredoc on another command), when a pipe stands in the command line (it may feed the command instead), when the file is a
// device, or when the text is expanded by the shell and cannot be read as written. A heredoc's text is that of every heredoc in the command
// line, so none is missed.
const EXPANDED = /\$\(|`|\$\{|\$[A-Za-z_]/

function stdinFeed(words: string[], command: string, what: string, option: string): { texts: string[]; files: string[] } | { cause: string } {
  const texts: string[] = []
  const files: string[] = []
  let isFed = false
  const { bodies, rest } = heredocsOf(command)
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? ''
    if (word.startsWith('<<<')) {
      isFed = true
      const text = word.length > 3 ? word.slice(3) : (words[i + 1] ?? '')
      const own: string[] = []
      addSource(text, own, files)
      if (own.some(item => EXPANDED.test(item))) return { cause: `the ${what} is a here-string that the shell expands, so it cannot be read as written` }
      texts.push(...own)
    } else if (word.startsWith('<<')) {
      isFed = true
      for (const body of bodies) {
        if (!body.isQuoted && EXPANDED.test(body.text))
          return { cause: `the ${what} is a heredoc that the shell expands (its delimiter is not quoted), so it cannot be read as written` }
        texts.push(body.text)
      }
    } else if (word === '<' || (word.startsWith('<') && word.length > 1)) {
      isFed = true
      const path = word === '<' ? words[i + 1] : word.slice(1)
      if (path !== undefined) files.push(path)
    }
  }
  if (!isFed || rest.includes('|')) return { cause: STDIN_CAUSE(what, option) }
  if (files.some(path => path.startsWith('/dev/') || path.startsWith('/proc/'))) return { cause: STDIN_CAUSE(what, option) }
  return { texts, files }
}

// The words after gh pr create or gh pr edit, with an option such as -R <repo> allowed before the verb.
function ghPrArguments(words: string[]): string[] | undefined {
  if (lastWord(words[0] ?? '') !== 'gh') return undefined
  const at = words.indexOf('pr')
  if (at < 0) return undefined
  let i = at + 1
  while ((words[i] ?? '').startsWith('-')) i += words[i] === '-R' || words[i] === '--repo' ? 2 : 1
  const verb = words[i]
  return verb === 'create' || verb === 'edit' ? words.slice(i + 1) : undefined
}

// A gh pr create or gh pr edit command, wherever it stands in the command line (several lines, a subshell, sh -c, a command substitution):
// the PR body from --body, -b, --body-file or -F is checked line by line. Any other command passes.
export async function checkPrBody(command: string, readFile: (path: string) => Promise<string | undefined>): Promise<Check> {
  const hits: Hit[] = []
  const { commands, isUnclear, isMoved } = simpleCommands(command)
  if (isUnclear) return cannotRun(`${UNCLEAR_CAUSE}, so a PR body in it cannot be found`)
  for (const words of commands) {
    const rest = ghPrArguments(words)
    if (rest === undefined) continue
    const texts: string[] = []
    const files: string[] = []
    let isStdin = false
    const addFile = (path: string | undefined) => {
      if (path === '-') isStdin = true
      else if (path !== undefined) files.push(path)
    }
    for (let j = 0; j < rest.length; j += 1) {
      const word = rest[j] ?? ''
      const value = rest[j + 1]
      if (word === '--body' || word === '-b') {
        if (value !== undefined) addSource(value, texts, files)
        j += 1
      } else if (word.startsWith('--body=')) {
        addSource(word.slice('--body='.length), texts, files)
      } else if (word === '--body-file' || word === '-F') {
        addFile(value)
        j += 1
      } else if (word.startsWith('--body-file=')) {
        addFile(word.slice('--body-file='.length))
      } else if (/^-b./.test(word) && !word.startsWith('--')) {
        addSource(word.slice(2), texts, files)
      } else if (/^-F./.test(word) && !word.startsWith('--')) {
        addFile(word.slice(2))
      }
    }
    if (isStdin) {
      const feed = stdinFeed(words, command, 'PR body', '--body-file')
      if ('cause' in feed) return cannotRun(feed.cause)
      texts.push(...feed.texts)
      files.push(...feed.files)
    }
    for (const path of files) {
      if (isMoved && !path.startsWith('/')) return cannotRun(MOVED_CAUSE('PR body', path))
      const text = await attempt(() => readFile(path))
      if (text === undefined) return cannotRun(`the PR body file ${path} cannot be read`)
      texts.push(text)
    }
    for (const text of texts) {
      const found: Hit[] = shapesIn(textLines(text)).map(({ shape, line }) => ({ shape, place: { kind: 'pr-body', line } }))
      hits.push(...found)
    }
  }
  return hits.length > 0 ? deny(denialText(unique(hits))) : { verdict: 'pass', scanner: 'not scanned' }
}

// The untracked files a command puts into its commit. A commit takes tracked files only (git commit, git commit -a); an untracked file
// goes in when a git add of the same command names it. all: every untracked file (git add -A, --all, ., a glob or pathspec magic, a path
// that leaves the folder, -N, -i, -p, -e, --pathspec-from-file), and also any command the check cannot place: one that hides what it runs,
// appends arguments (xargs), changes directory, runs a script, passes git to another command (find -exec git add), or runs a git
// subcommand other than the ones known to leave the index alone (stage, update-index, apply, an alias).
export interface UntrackedScope {
  all: boolean
  paths: string[]
}

const ADD_ALL_OPTION = /^-[A-Za-z]*[ANipe][A-Za-z]*$/
const ADD_ALL_LONG: ReadonlySet<string> = new Set(['--all', '--intent-to-add', '--interactive', '--patch', '--edit'])
const INDEX_SAFE_GIT: ReadonlySet<string> = new Set([
  'commit',
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'ls-files',
  'branch',
  'remote',
  'fetch',
  'push',
  'ls-remote',
  'describe',
  'tag',
])
const EVERYTHING: UntrackedScope = { all: true, paths: [] }

export function untrackedScope(command: string): UntrackedScope {
  const { commands, isUnclear, isMoved, hasXargs } = simpleCommands(command)
  if (isUnclear || isMoved || hasXargs) return EVERYTHING
  const paths: string[] = []
  for (const words of commands) {
    const name = lastWord(words[0] ?? '')
    if (name !== 'git') {
      const isScript =
        (SHELLS.has(name) && !words.some(word => /^-[A-Za-z]*c[A-Za-z]*$/.test(word))) || name === 'source' || name === '.' || (words[0] ?? '').startsWith('.')
      if (isScript || words.some(word => lastWord(word) === 'git')) return EVERYTHING
      continue
    }
    const { at, isSure } = gitSubcommandAt(words)
    const sub = words[at]
    if (!isSure || at < 0 || sub === undefined) return EVERYTHING
    if (sub !== 'add') {
      if (!INDEX_SAFE_GIT.has(sub)) return EVERYTHING
      continue
    }
    let isPathList = false
    for (const word of words.slice(at + 1)) {
      if (!isPathList && word === '--') {
        isPathList = true
      } else if (!isPathList && word.startsWith('--')) {
        if (ADD_ALL_LONG.has(word) || word.startsWith('--pathspec-from-file')) return EVERYTHING
      } else if (!isPathList && word.startsWith('-') && word.length > 1) {
        if (ADD_ALL_OPTION.test(word)) return EVERYTHING
      } else {
        const path = word.replace(/^(?:\.\/)+/, '').replace(/\/+$/, '')
        const leaves = path.startsWith('/') || path.includes('//') || path.split('/').includes('..')
        if (path === '' || path === '.' || word.startsWith(':') || /[*?[\\]/.test(word) || leaves) return EVERYTHING
        paths.push(path)
      }
    }
  }
  return { all: false, paths }
}

// The words after git commit, with git's own options allowed before the subcommand.
function gitCommitArguments(words: string[]): string[] | undefined {
  if (lastWord(words[0] ?? '') !== 'git') return undefined
  const { at } = gitSubcommandAt(words)
  return at >= 0 && words[at] === 'commit' ? words.slice(at + 1) : undefined
}

// The message of a git commit command, checked line by line before the commit: from -m and --message (also in a bundle such as -am),
// from -F and --file, from a `$(cat file)` value, and from a heredoc on standard input (-F -). A message that is read from standard input
// without a heredoc cannot be read, so the check denies. A commit that takes its message from another commit (-C, --amend without -m) adds
// no text.
export async function checkCommitMessage(command: string, readFile: (path: string) => Promise<string | undefined>): Promise<Check> {
  const hits: Hit[] = []
  const { commands, isUnclear, isMoved } = simpleCommands(command)
  if (isUnclear) return cannotRun(`${UNCLEAR_CAUSE}, so a commit message in it cannot be found`)
  for (const words of commands) {
    const args = gitCommitArguments(words)
    if (args === undefined) continue
    const texts: string[] = []
    const files: string[] = []
    let isStdin = false
    const addFile = (path: string | undefined) => {
      if (path === '-') isStdin = true
      else if (path !== undefined) files.push(path)
    }
    for (let i = 0; i < args.length; i += 1) {
      const word = args[i] ?? ''
      if (word === '--') break
      if (word.startsWith('--')) {
        const equals = word.indexOf('=')
        const name = equals < 0 ? word : word.slice(0, equals)
        const inline = equals < 0 ? undefined : word.slice(equals + 1)
        const isMessage = name.length >= 3 && '--message'.startsWith(name)
        const isFile = name.length >= 5 && '--file'.startsWith(name)
        if (!isMessage && !isFile) continue
        const value = inline ?? args[i + 1]
        if (inline === undefined) i += 1
        if (value === undefined) continue
        if (isMessage) addSource(value, texts, files)
        else addFile(value)
      } else if (word.startsWith('-') && word.length > 1) {
        for (let j = 1; j < word.length; j += 1) {
          const flag = word.charAt(j)
          if (flag !== 'm' && flag !== 'F') continue
          const attached = word.slice(j + 1)
          const value = attached === '' ? args[i + 1] : attached
          if (attached === '') i += 1
          if (value !== undefined) {
            if (flag === 'm') addSource(value, texts, files)
            else addFile(value)
          }
          break
        }
      }
    }
    const sources = texts.length > 0 ? [texts.join('\n\n')] : []
    if (isStdin) {
      const feed = stdinFeed(words, command, 'commit message', '-F')
      if ('cause' in feed) return cannotRun(feed.cause)
      sources.push(...feed.texts)
      files.push(...feed.files)
    }
    for (const path of files) {
      if (isMoved && !path.startsWith('/')) return cannotRun(MOVED_CAUSE('commit message', path))
      const text = await attempt(() => readFile(path))
      if (text === undefined) return cannotRun(`the commit message file ${path} cannot be read`)
      sources.push(text)
    }
    for (const text of sources) {
      hits.push(...shapesIn(textLines(text)).map(({ shape, line }): Hit => ({ shape, place: { kind: 'commit-message', line } })))
    }
  }
  return hits.length > 0 ? deny(denialText(unique(hits))) : { verdict: 'pass', scanner: 'not scanned' }
}

// The scanner's JSON report: the rule, the file, the line and the commit of each finding. The secret in it is redacted and is never read.
function reportHits(report: string | undefined): Hit[] | undefined {
  if (report === undefined) return undefined
  try {
    const data: unknown = JSON.parse(report)
    if (!Array.isArray(data)) return undefined
    const hits: Hit[] = []
    for (const entry of data as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue
      const item = entry as { RuleID?: unknown; File?: unknown; StartLine?: unknown; Commit?: unknown }
      if (typeof item.File !== 'string' || typeof item.StartLine !== 'number') continue
      const shape = `scanner:${typeof item.RuleID === 'string' ? item.RuleID : 'rule'}` as const
      const commit = typeof item.Commit === 'string' && item.Commit !== '' ? item.Commit : undefined
      const place: Place =
        commit === undefined ? { kind: 'file', path: item.File, line: item.StartLine } : { kind: 'file', commit, path: item.File, line: item.StartLine }
      hits.push({ shape, place })
    }
    return hits
  } catch {
    return undefined
  }
}

const sameVersion = (found: string, pinned: string): boolean => found.trim().replace(/^v/, '') === pinned.replace(/^v/, '')

// Runs the scanner when it is installed at the pinned version and approved. A scanner that cannot run counts as "not scanned": the own
// checks have already run. The report is deleted after every scan.
async function runScanner(scanner: Scanner | undefined, target: ScanTarget): Promise<ScanOutcome> {
  if (scanner === undefined) return { kind: 'not scanned' }
  const version = await attempt(() => scanner.version())
  if (version === undefined || !sameVersion(version, GITLEAKS_VERSION) || !scanner.approved()) return { kind: 'not scanned' }
  let result: { exitCode: number; report?: string } | undefined
  try {
    result = await scanner.scan(target, scannerArgs(scanner.reportPath, scanner.trusted))
  } catch {
    result = undefined
  } finally {
    await attempt(() => scanner.removeReport())
  }
  if (result === undefined || (result.exitCode !== 0 && result.exitCode !== 1)) return { kind: 'not scanned' }
  if (result.exitCode === 0) return { kind: 'ran' }
  const hits = reportHits(result.report)
  if (hits === undefined || hits.length === 0) {
    return {
      kind: 'deny',
      reason: ['The scanner found a secret shape, but its report could not be read, so the action is denied.', 'What to do:', ...STEPS].join('\n'),
    }
  }
  return { kind: 'deny', reason: denialText(hits) }
}

// The pinned version of the optional scanner (gitleaks), checked against its README at this release: --redact, --report-format,
// --report-path, --ignore-gitleaks-allow and --log-opts. An installed version that differs counts as "not scanned".
export const GITLEAKS_VERSION = 'v8.30.1'

// The scanner's options: values redacted, a JSON report at the given path, an inline gitleaks:allow ignored, and, when given, the plugin's own
// config and ignore file in place of any the scanned repo holds.
export function scannerArgs(reportPath: string, trusted?: { config: string; ignorePath: string }): string[] {
  const args = ['--redact', '--report-format', 'json', '--report-path', reportPath, '--ignore-gitleaks-allow']
  return trusted === undefined ? args : [...args, '--config', trusted.config, '--gitleaks-ignore-path', trusted.ignorePath]
}

// The scanner part of the push dialog.
export function scannerLine(check: Check): string {
  if (check.verdict === 'deny') return 'Scanner (gitleaks): the secret check denied this action'
  return check.scanner === 'ran' ? `Scanner (gitleaks ${GITLEAKS_VERSION}): ran, nothing found` : 'Scanner (gitleaks): not scanned'
}

export interface PublishKinds {
  commit: boolean
  isPr: boolean
  forcedAdd: boolean
}

const MAX_DEPTH = 3
const lastWord = (word: string): string => word.split('/').pop() ?? word

// Which checks a Bash command needs: a git commit, a gh pr create or gh pr edit, and a forced git add, which stages files the check
// cannot read. The commands are found as the guard finds them (segmentsOf, gitSubcommandAt), looking into shell -c strings, eval and
// command substitutions. Where the command or git's subcommand cannot be told for sure, both checks run.
export function publishKinds(command: string, depth = 0): PublishKinds {
  const kinds: PublishKinds = { commit: false, isPr: false, forcedAdd: false }
  const absorb = (other: PublishKinds) => {
    kinds.commit ||= other.commit
    kinds.isPr ||= other.isPr
    kinds.forcedAdd ||= other.forcedAdd
  }
  const uncertain = () => {
    kinds.commit = true
    kinds.isPr = true
  }
  if (depth >= MAX_DEPTH) {
    uncertain()
    return kinds
  }
  for (const match of command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)) absorb(publishKinds(match[1] ?? match[2] ?? '', depth + 1))
  for (const segment of segmentsOf(command, true)) {
    if (segment.unparseable) {
      uncertain()
      continue
    }
    const [first = '', ...args] = segment.words
    if (first === '') continue
    if (/[$`(]/.test(first)) {
      uncertain()
      continue
    }
    const name = lastWord(first)
    if (name === 'git') {
      const { at, isSure } = gitSubcommandAt(segment.words)
      if (!isSure) uncertain()
      const sub = at < 0 ? undefined : segment.words[at]
      if (sub === 'commit') kinds.commit = true
      if (sub === 'add' && args.some(word => word === '--force' || /^-[A-Za-z]*f[A-Za-z]*$/.test(word))) kinds.forcedAdd = true
    } else if (name === 'gh') {
      if (ghPrArguments(segment.words) !== undefined) kinds.isPr = true
    } else if (SHELLS.has(name) || name === 'eval') {
      const flag = args.findIndex(word => /^-[A-Za-z]*c[A-Za-z]*$/.test(word))
      const inner = name === 'eval' ? args.join(' ') : flag >= 0 ? args[flag + 1] : undefined
      if (inner === undefined || inner === '') {
        if (name !== 'eval') uncertain()
      } else {
        absorb(publishKinds(inner, depth + 1))
      }
    }
  }
  return kinds
}

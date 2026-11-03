// Command parsing and learned allow rules. Whatever cannot be parsed with confidence gets no rule.

// gitOptions: git global options or GIT_* variables (other than GIT_TERMINAL_PROMPT) were present and dropped;
// configs: the values of -c; env: the names of the NAME=value assignments dropped; wrapped: a wrapper (env with options or
// assignments, xargs, timeout, nice, exec, nohup, time) was dropped; xargs: xargs was dropped, so arguments the command line does
// not show are appended; repoOptions: git was pointed at another directory (-C other than ., --git-dir, --work-tree,
// GIT_DIR, GIT_WORK_TREE, GIT_COMMON_DIR); unparseable: env -S hides the real command; raw: the words as written, before
// any prefix was dropped. A segment of assignments only has no words.
export interface Segment {
  words: string[]
  raw: string[]
  gitOptions: boolean
  configs: string[]
  env: string[]
  wrapped: boolean
  xargs: boolean
  repoOptions: boolean
  unparseable: boolean
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

const READ_ONLY_PREFIXES: readonly (readonly string[])[] = [
  ['gh', 'pr', 'checks'],
  ['gh', 'pr', 'view'],
  ['gh', 'pr', 'list'],
  ['gh', 'run', 'view'],
  ['gh', 'run', 'list'],
  ['gh', 'repo', 'view'],
  ['git', 'status'],
]

// Read-only git commands whose options can write files or run programs, so only the exact command is offered.
const EXACT_GIT_COMMANDS: ReadonlySet<string> = new Set(['log', 'diff', 'show', 'ls-remote'])

const WRITING_OPTIONS: readonly string[] = ['--output', '--upload-pack', '--ext-diff', '--textconv', '--exec']

// Variables that point git at another repository.
const REPO_ENV: ReadonlySet<string> = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'])

// GIT_* variables that do not change what git does with a push.
const HARMLESS_GIT_ENV: ReadonlySet<string> = new Set(['GIT_TERMINAL_PROMPT'])

// Words that can stand before a command in a compound statement or as a wrapper, dropped when unwrapping for the guard.
const LEADING_WORDS: ReadonlySet<string> = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'time', 'exec', 'nohup'])

const REDIRECT = /^(?:\d*[<>]|&>)/

const BARE_REDIRECT = /^(?:\d*|&)(?:>>?|<{1,3}|>&|<>)$/

const DURATION = /^(?:\d+\.?\d*|\.\d+)[smhd]?$/

const XARGS_VALUE: ReadonlySet<string> = new Set([
  '-I',
  '-n',
  '-P',
  '-L',
  '-d',
  '-s',
  '-E',
  '-a',
  '-l',
  '--max-args',
  '--max-procs',
  '--max-lines',
  '--max-chars',
  '--delimiter',
  '--arg-file',
  '--eof',
])

const TIMEOUT_VALUE: ReadonlySet<string> = new Set(['-k', '-s', '--kill-after', '--signal'])

const ENV_VALUE: ReadonlySet<string> = new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string'])

const RUNNERS: ReadonlySet<string> = new Set([
  'python',
  'python3',
  'node',
  'npx',
  'npm',
  'pnpm',
  'yarn',
  'uv',
  'poetry',
  'make',
  'mvn',
  './mvnw',
  'gradle',
  './gradlew',
  'go',
  'cargo',
])

// The shells whose -c string the guard and the secret check read as a command line. One list for all of them.
export const SHELLS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'csh', 'tcsh', 'fish'])

// Tokenizing

// For each segment's words, whether each word holds *, ? or [ outside quotes and not escaped, which the shell globs,
// whether it holds a $ outside quotes, which the shell expands and splits into more words, and whether it holds a { outside
// quotes, which brace expansion may turn into more words.
const UNQUOTED = new WeakMap<string[], { globs: boolean[]; dollars: boolean[]; braces: boolean[] }>()

// Whether the word at index of a segment's raw words holds a wildcard the shell globs; undefined when it is not known.
export function hasUnquotedGlob(raw: string[], index: number): boolean | undefined {
  return UNQUOTED.get(raw)?.globs[index]
}

// Whether the word at index of a segment's raw words holds a $ outside quotes; undefined when it is not known.
export function hasUnquotedDollar(raw: string[], index: number): boolean | undefined {
  return UNQUOTED.get(raw)?.dollars[index]
}

// Whether the word at index of a segment's raw words holds a { outside quotes; undefined when it is not known.
export function hasUnquotedBrace(raw: string[], index: number): boolean | undefined {
  return UNQUOTED.get(raw)?.braces[index]
}

function tokenize(command: string): string[][] {
  const segments: string[][] = []
  let words: string[] = []
  let globs: boolean[] = []
  let dollars: boolean[] = []
  let braces: boolean[] = []
  let word = ''
  let inWord = false
  let glob = false
  let dollar = false
  let brace = false
  const endWord = () => {
    if (inWord) {
      words.push(word)
      globs.push(glob)
      dollars.push(dollar)
      braces.push(brace)
    }
    word = ''
    inWord = false
    glob = false
    dollar = false
    brace = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) {
      segments.push(words)
      UNQUOTED.set(words, { globs, dollars, braces })
    }
    words = []
    globs = []
    dollars = []
    braces = []
  }
  const nested: string[][] = []
  for (let i = 0; i < command.length; i++) {
    const c = command.charAt(i)
    const next = command.charAt(i + 1)
    if (c === "'") {
      inWord = true
      const end = command.indexOf("'", i + 1)
      if (end === -1) {
        word += command.slice(i + 1)
        break
      }
      word += command.slice(i + 1, end)
      i = end
    } else if (c === '"') {
      inWord = true
      let j = i + 1
      let inner = ''
      while (j < command.length && command.charAt(j) !== '"') {
        if (command.charAt(j) === '\\' && '"\\$`'.includes(command.charAt(j + 1)) && j + 1 < command.length) j++
        inner += command.charAt(j)
        j++
      }
      word += inner
      // A substitution inside double quotes still runs, so its commands become segments of their own.
      if (/\$\(|`/.test(inner)) nested.push(...tokenize(inner))
      i = j
    } else if (c === '\\') {
      if (next === '\n') {
        i++
      } else if (next !== '') {
        inWord = true
        word += next
        i++
      }
    } else if (c === '$' && next === '(') {
      endSegment()
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
    } else if (c === '&' && (command.charAt(i - 1) === '>' || command.charAt(i - 1) === '<' || next === '>')) {
      inWord = true
      word += c
    } else if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') {
      endSegment()
    } else {
      inWord = true
      if (c === '*' || c === '?' || c === '[') glob = true
      if (c === '$') dollar = true
      if (c === '{') brace = true
      word += c
    }
  }
  endSegment()
  return [...segments, ...nested]
}

function isEnvSplit(option: string): boolean {
  if (option.startsWith('--')) return option.length > 2 && '--split-string'.startsWith(option.split('=')[0] ?? '')
  return /^-[^-]*S/.test(option)
}

function dropEnvOptions(words: string[], unwrap: boolean): { rest: string[]; options: boolean; split: boolean } {
  let rest = words
  let options = false
  let split = false
  while (rest[0]?.startsWith('-')) {
    const option = rest[0]
    options = true
    split ||= isEnvSplit(option)
    rest = rest.slice(option === '-u' || (unwrap && ENV_VALUE.has(option)) ? 2 : 1)
  }
  return { rest, options, split }
}

function skipOptions(words: string[], valued: ReadonlySet<string>): number {
  let i = 1
  while (words[i]?.startsWith('-')) {
    const word = words[i] ?? ''
    i += valued.has(word) ? 2 : 1
    if (word === '--') break
  }
  return i
}

// With unwrap, shell keywords, wrappers (time, exec, nice, nohup, xargs, timeout, env) and leading redirects are dropped as well.
function stripPrefix(words: string[], unwrap: boolean): { words: string[]; env: string[]; wrapped: boolean; xargs: boolean; unparseable: boolean } {
  let rest = words
  const env: string[] = []
  let wrapped = false
  let xargs = false
  let unparseable = false
  for (;;) {
    const first = rest[0]
    if (first === undefined) break
    if (ASSIGNMENT.test(first) || first === 'command' || first === 'builtin') {
      if (first !== 'command' && first !== 'builtin') env.push(first.slice(0, first.indexOf('=')))
      rest = rest.slice(1)
    } else if (first === 'env') {
      const dropped = dropEnvOptions(rest.slice(1), unwrap)
      rest = dropped.rest
      wrapped ||= dropped.options || ASSIGNMENT.test(rest[0] ?? '')
      unparseable ||= dropped.split
    } else if (unwrap && first === 'timeout') {
      const at = skipOptions(rest, TIMEOUT_VALUE)
      rest = rest.slice(DURATION.test(rest[at] ?? '') ? at + 1 : at)
      wrapped = true
    } else if (first === 'timeout' && /^\d+[smhd]?$/.test(rest[1] ?? '')) {
      rest = rest.slice(2)
      wrapped = true
    } else if (unwrap && LEADING_WORDS.has(first)) {
      rest = rest.slice(first === 'time' && rest[1] === '-p' ? 2 : 1)
      wrapped ||= first === 'time' || first === 'exec' || first === 'nohup'
    } else if (unwrap && first === 'nice') {
      rest = rest.slice(rest[1] === '-n' ? 3 : /^-\d+$|^--adjustment=/.test(rest[1] ?? '') ? 2 : 1)
      wrapped = true
    } else if (unwrap && first === 'xargs') {
      rest = rest.slice(skipOptions(rest, XARGS_VALUE))
      wrapped = true
      xargs = true
    } else if (unwrap && REDIRECT.test(first)) {
      rest = rest.slice(BARE_REDIRECT.test(first) ? 2 : 1)
    } else if (first.startsWith('/') && !first.endsWith('/')) {
      rest = [first.slice(first.lastIndexOf('/') + 1), ...rest.slice(1)]
    } else {
      break
    }
  }
  return { words: rest, env, wrapped, xargs, unparseable }
}

// Git's own options before the subcommand that take a value, as the next word or after =, and that stay in a segment's
// words. --exec-path and --list-cmds take theirs only after = in git, which exits or fails on the other form.
export const GIT_VALUED: ReadonlySet<string> = new Set(['--namespace', '--exec-path', '--attr-source', '--super-prefix', '--list-cmds', '--shallow-file'])

// Git's own options before the subcommand that take no value.
export const GIT_FLAGS: ReadonlySet<string> = new Set([
  '-p',
  '--paginate',
  '-P',
  '--no-pager',
  '--bare',
  '--no-replace-objects',
  '--no-lazy-fetch',
  '--no-optional-locks',
  '--no-advice',
  '--literal-pathspecs',
  '--glob-pathspecs',
  '--noglob-pathspecs',
  '--icase-pathspecs',
  '--html-path',
  '--man-path',
  '--info-path',
  '-v',
  '--version',
  '-h',
  '--help',
])

const valueOf = (word: string): string | undefined => {
  const name = word.startsWith('--') ? (word.split('=')[0] ?? '') : word
  return GIT_VALUED.has(name) ? name : undefined
}

// Where git's subcommand stands in a segment's words: the first word after git's own options and their values; -1 when
// there is none. isSure is false when an option no list here knows stands before it, since it may take the next word.
export function gitSubcommandAt(words: string[]): { at: number; isSure: boolean } {
  let isSure = true
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? ''
    if (!word.startsWith('-')) return { at: i, isSure }
    if (valueOf(word) !== undefined) {
      if (!word.includes('=')) i++
    } else if (!GIT_FLAGS.has(word)) {
      isSure = false
    }
  }
  return { at: -1, isSure }
}

// Walks git's options up to the subcommand: -c, --config-env, -C, --git-dir and --work-tree are dropped and recorded
// wherever they stand; the other options stay, a valued one with its value, so the walk goes on past it.
function dropGitOptions(words: string[], envGit: boolean, envRepo: boolean): Pick<Segment, 'words' | 'gitOptions' | 'configs' | 'repoOptions'> {
  if (words[0] !== 'git') return { words, gitOptions: false, configs: [], repoOptions: false }
  const kept = ['git']
  const configs: string[] = []
  let gitOptions = envGit
  let repoOptions = envRepo
  let i = 1
  while (i < words.length) {
    const word = words[i] ?? ''
    if (word === '-c' || word === '--config-env') {
      gitOptions = true
      configs.push(words[i + 1] ?? '')
      i += 2
    } else if (word === '-C' || word === '--git-dir' || word === '--work-tree') {
      gitOptions = true
      repoOptions ||= word !== '-C' || words[i + 1] !== '.'
      i += 2
    } else if (word.startsWith('-c') && !word.startsWith('--')) {
      gitOptions = true
      configs.push(word.slice(2))
      i += 1
    } else if (word.startsWith('--config-env=')) {
      gitOptions = true
      configs.push(word.slice('--config-env='.length))
      i += 1
    } else if (word.startsWith('--git-dir=') || word.startsWith('--work-tree=')) {
      gitOptions = true
      repoOptions = true
      i += 1
    } else if (word.startsWith('-')) {
      repoOptions ||= word.startsWith('-C')
      const isValued = valueOf(word) !== undefined && !word.includes('=') && i + 1 < words.length
      kept.push(...words.slice(i, isValued ? i + 2 : i + 1))
      i += isValued ? 2 : 1
    } else {
      break
    }
  }
  return { words: [...kept, ...words.slice(i)], gitOptions, configs, repoOptions }
}

// The words of each segment of a command as written, with nothing dropped: a bare `env` still shows here.
export function rawSegmentsOf(command: string): string[][] {
  return tokenize(command)
}

// The segments of a command. unwrap also looks through shell keywords, wrappers and leading redirects.
export function segmentsOf(command: string, unwrap = false): Segment[] {
  return tokenize(command)
    .map(raw => {
      const stripped = stripPrefix(raw, unwrap)
      const envGit = stripped.env.some(name => name.startsWith('GIT_') && !HARMLESS_GIT_ENV.has(name))
      const { env, wrapped, xargs, unparseable } = stripped
      const envRepo = stripped.env.some(name => REPO_ENV.has(name))
      return { ...dropGitOptions(stripped.words, envGit, envRepo), env, wrapped, xargs, unparseable, raw }
    })
    .filter(segment => segment.words.length > 0 || segment.env.length > 0 || segment.unparseable)
}

export function normalizeCommand(command: string): string[][] {
  return segmentsOf(command)
    .map(segment => segment.words)
    .filter(words => words.length > 0)
}

// Rules

export function ruleFor(tool: string, input: unknown, isReadOnly: boolean): string | undefined {
  if (tool.startsWith('mcp__')) return isReadOnly ? tool : undefined
  if (tool !== 'Bash') return undefined
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== 'string' || /[<>$`\\&;|()]/.test(command)) return undefined
  const segments = segmentsOf(command)
  const segment = segments[0]
  if (segments.length !== 1 || segment === undefined) return undefined
  const { words } = segment
  if (segment.repoOptions || (words[0] === 'git' && segment.configs.length > 0)) return undefined
  if (words[0] === 'git' && EXACT_GIT_COMMANDS.has(words[1] ?? '')) {
    const plain = !segment.gitOptions && !segment.wrapped && segment.env.length === 0
    return plain && !/['"*]/.test(command) && !hasWritingOption(words) ? `Bash(${words.join(' ')})` : undefined
  }
  const prefix = READ_ONLY_PREFIXES.find(p => p.every((word, i) => words[i] === word))
  if (prefix) return `Bash(${prefix.join(' ')} *)`
  if (RUNNERS.has(words[0] ?? '') && !/['"*]/.test(command)) return `Bash(${words.join(' ')})`
  return undefined
}

// Long options count by any prefix of their name, since git accepts unambiguous abbreviations.
function hasWritingOption(words: string[]): boolean {
  return words.slice(2).some(word => {
    if (word.startsWith('--')) {
      const name = word.split('=')[0] ?? ''
      return name.length > 2 && WRITING_OPTIONS.some(option => option.startsWith(name))
    }
    return words[1] === 'ls-remote' && word.startsWith('-u')
  })
}

// A rule as a person reads it: the command or the tool alone, a wildcard rule's prefix followed by an ellipsis.
export function ruleLabel(rule: string): string {
  const wildcard = /^Bash\((.*) \*\)$/.exec(rule)
  if (wildcard) return `${wildcard[1]} …`
  return /^Bash\((.*)\)$/.exec(rule)?.[1] ?? rule
}

// The rule dialog's labels: a rule's own label when it holds no comma, can't be read as a numbered label, and has no
// twin; else "Rule <n>". The dialog's answer joins picked labels with commas, so no label may hold one.
export function ruleChoiceLabels(rules: string[]): string[] {
  const own = rules.map(ruleLabel)
  return own.map((label, i) => (label.includes(',') || /^Rule \d+$/.test(label) || own.indexOf(label) !== own.lastIndexOf(label) ? `Rule ${i + 1}` : label))
}

// The indexes of the labels a dialog's answer picked. Every comma-separated part must be one label, each at most once;
// anything else picks nothing.
export function pickedRules(answer: string, labels: string[]): number[] {
  if (answer.trim() === '') return []
  const parts = answer.split(',').map(part => part.trim())
  const picked = parts.map(part => labels.indexOf(part))
  if (picked.some(i => i < 0) || new Set(picked).size !== picked.length) return []
  return picked.sort((a, b) => a - b)
}

const READS_ONLY = 'Reads only; changes nothing.'
const RUNS_CODE = 'Runs a project command (tests, build or a script); it can change files.'
const RUNS_PROGRAM = 'Runs a program; it can change files.'

// The runners' commands that run a command of the project's (its tests, its build, a script): a build tool, a package
// manager's test, run or build script, Go's and Cargo's test and build, Python's unittest and pytest.
const TEST_OR_BUILD: readonly (readonly string[])[] = [
  ['make'],
  ['mvn'],
  ['./mvnw'],
  ['gradle'],
  ['./gradlew'],
  ...['npm', 'pnpm', 'yarn'].flatMap(tool => ['test', 'run', 'build'].map(script => [tool, script])),
  ...['go', 'cargo'].flatMap(tool => ['test', 'build', 'vet', 'check'].map(sub => [tool, sub])),
  ...['python', 'python3'].flatMap(python => ['unittest', 'pytest'].map(module => [python, '-m', module])),
  ['uv', 'run', 'pytest'],
  ['poetry', 'run', 'pytest'],
]

// What a rule allows, from the kinds ruleFor offers: the read-only prefixes (a wildcard), read-only Git and tools marked
// read-only read only; a runner's project command runs the project's code; any other runner runs a program.
export function describeRule(rule: string): string {
  const wildcard = /^Bash\((.*) \*\)$/.exec(rule)
  if (wildcard) return `${READS_ONLY} Allowed with any arguments.`
  const exact = /^Bash\((.*)\)$/.exec(rule)?.[1]
  if (exact === undefined) return READS_ONLY
  const words = exact.split(' ')
  if (words[0] === 'git') return READS_ONLY
  return TEST_OR_BUILD.some(prefix => prefix.every((word, i) => words[i] === word)) ? RUNS_CODE : RUNS_PROGRAM
}

export function shouldSuggest(e: { decision: string; approver?: string; tool_use_id?: string; ceiling?: unknown; hook?: unknown; setting?: unknown }): boolean {
  return (
    e.decision === 'ask' &&
    e.approver === 'person' &&
    typeof e.tool_use_id === 'string' &&
    e.tool_use_id !== '' &&
    e.ceiling === undefined &&
    e.hook === undefined &&
    e.setting === undefined
  )
}

// Settings

function spaced(rule: string): string {
  return rule.endsWith(':*)') ? `${rule.slice(0, -3)} *)` : rule
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergeAllowRules(settingsText: string | undefined, rules: string[]): { text: string; added: string[] } | { error: string } {
  let settings: unknown = {}
  if (settingsText !== undefined && settingsText.trim() !== '') {
    try {
      settings = JSON.parse(settingsText)
    } catch (e) {
      return { error: `The settings file is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
    }
  }
  if (!isObject(settings)) return { error: 'The settings file is not a JSON object.' }
  const permissions = settings.permissions === undefined ? {} : settings.permissions
  if (!isObject(permissions)) return { error: 'The "permissions" entry of the settings file is not an object.' }
  const allow = permissions.allow === undefined ? [] : permissions.allow
  if (!Array.isArray(allow) || !allow.every((rule): rule is string => typeof rule === 'string')) {
    return { error: 'The "permissions.allow" entry of the settings file is not a list of strings.' }
  }
  const known = new Set(allow.map(spaced))
  const added: string[] = []
  for (const rule of rules.map(spaced)) {
    if (known.has(rule)) continue
    known.add(rule)
    added.push(rule)
  }
  const merged = { ...settings, permissions: { ...permissions, allow: [...allow, ...added] } }
  return { text: `${JSON.stringify(merged, null, 2)}\n`, added }
}

// What a call may reach: environment files, the account's credential stores, steering files, token prints and the
// reviewer's CLAUDE.md. Pure: the mod hands in what it knows (the environment files it listed, the approved plan's
// planned-paths) and gets a finding back; guard.ts turns a finding into the reason Claude reads.
import type { PhaseName } from '../types'
import { SHELLS, gitSubcommandAt, hasUnquotedBrace, hasUnquotedDollar, hasUnquotedGlob, rawSegmentsOf, segmentsOf, type Segment } from './permissions'

// root: the project root, absolute; '' when unknown. home: the mod's HOME, absolute; absent when unset. The other fields
// are the mod's listing and the approved plan's fields, absent before Plan approval or when the mod could not read them.
export interface ReachContext {
  phase: PhaseName
  root: string
  home?: string
  plannedPaths?: string[]
  envFiles?: string[]
  envFilesReachable?: string[]
  envFilesUnknown?: boolean
  envLinks?: string[]
  base?: string
  isReviewer?: boolean
}

export type ReachKey = 'envFile' | 'credentialStore' | 'folderSearch' | 'tokenReveal' | 'tokenPrint' | 'steeringFile' | 'reviewerClaudeMd'

export interface Finding {
  key: ReachKey
  arg?: string
}

const found = (key: ReachKey, arg?: string): Finding => (arg === undefined ? { key } : { key, arg })

// Paths and patterns

export function normalizedPath(path: string): string {
  const absolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else if (!absolute) parts.push(part)
  }
  return (absolute ? '/' : '') + parts.join('/')
}

// A path from the project root, or undefined for one outside it (or absolute, with the root unknown).
export function fromRoot(path: string, root: string): string | undefined {
  const base = normalizedPath(root)
  const file = normalizedPath(path.startsWith('/') ? path : base === '' ? path : `${base}/${path}`)
  if (!file.startsWith('/')) return file === '..' || file.startsWith('../') ? undefined : file
  if (base === '' || base === '/' || !file.startsWith(`${base}/`)) return undefined
  return file.slice(base.length + 1)
}

// A word's brace expansions, one level at a time, at most 64.
export function expandBraces(word: string): string[] {
  let words = [word]
  for (let round = 0; round < 8; round++) {
    const next: string[] = []
    for (const one of words) {
      const match = /\{([^{}]*,[^{}]*)\}/.exec(one)
      if (match === null) next.push(one)
      else for (const choice of (match[1] ?? '').split(',')) next.push(one.slice(0, match.index) + choice + one.slice(match.index + match[0].length))
    }
    if (next.length === words.length || next.length > 64) return next.slice(0, 64)
    words = next
  }
  return words
}

// Whether a shell pattern (*, ?, [...]) matches a name, in any case; a pattern it can't read matches.
export function globMatches(pattern: string, name: string): boolean {
  if (!/[*?[]/.test(pattern)) return pattern.toLowerCase() === name.toLowerCase()
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charAt(i)
    const end = c === '[' ? pattern.indexOf(']', i + 2) : -1
    if (c === '*') source += '.*'
    else if (c === '?') source += '.'
    else if (end > 0) {
      const body = pattern.slice(i + 1, end)
      source += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`.replace(/\\/g, '\\\\')
      i = end
    } else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  try {
    return new RegExp(`^${source}$`, 'i').test(name)
  } catch {
    return true
  }
}

const lastPart = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const HAS_WILDCARD = /[*?[]/

// A path as an absolute one: ~ and $HOME become the home folder (or stay ~ when it is unknown), a relative path is read
// from dir.
function absoluteOf(word: string, ctx: ReachContext, dir: string): string {
  const expanded = word.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, homeOf(ctx))
  const joined = expanded.startsWith('/') || expanded.startsWith('~') || dir === '' ? expanded : `${dir}/${expanded}`
  return normalizedPath(joined)
}

function homeOf(ctx: ReachContext): string {
  return ctx.home !== undefined && ctx.home.startsWith('/') && normalizedPath(ctx.home) !== '/' ? normalizedPath(ctx.home) : '~'
}

// A path from the project root, also for the root itself; undefined for one outside it.
function projectRelOf(abs: string, root: string): string | undefined {
  const base = normalizedPath(root)
  if (base !== '' && normalizedPath(abs).toLowerCase() === base.toLowerCase()) return ''
  return fromRoot(abs, root) ?? looseRelOf(abs, root)
}

// Deny side only: like fromRoot, but a root spelled in another case still counts as the root. A check that grants
// access uses fromRoot, which is case-sensitive.
function looseRelOf(abs: string, root: string): string | undefined {
  const base = normalizedPath(root)
  const file = normalizedPath(abs)
  if (base === '' || base === '/' || !file.startsWith('/')) return undefined
  return file.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? file.slice(base.length + 1) : undefined
}

// Whether a folder is above the project root (or is /), so a search rooted there reaches the project.
function containsRoot(folder: string, root: string): boolean {
  const base = normalizedPath(root).toLowerCase()
  const path = normalizedPath(folder).toLowerCase()
  return base.startsWith('/') && path.startsWith('/') && (path === '/' || base.startsWith(`${path}/`))
}

// Environment files

const EXAMPLE_SUFFIXES: ReadonlySet<string> = new Set(['example', 'sample', 'template', 'dist'])

// Names a wildcard in a word can stand for, to tell whether it can match an environment file.
const ENV_NAMES = ['.env', '.env.local', '.env.production', '.env.development', '.env.test']

// By the last path part: .env and .env.<suffix> are secret, unless the suffix ends in example, sample, template or dist.
export function isEnvFile(path: string): 'secret' | 'example' | 'none' {
  const name = lastPart(path).toLowerCase()
  if (name === '.env') return 'secret'
  if (!name.startsWith('.env.')) return 'none'
  const suffix = name.slice('.env.'.length)
  return EXAMPLE_SUFFIXES.has(suffix.slice(suffix.lastIndexOf('.') + 1)) ? 'example' : 'secret'
}

// A name in a command: a pattern that can match an environment file counts as one.
function envKindOf(candidate: string): 'secret' | 'example' | 'none' {
  const part = lastPart(candidate)
  if (!HAS_WILDCARD.test(part)) return isEnvFile(part)
  return part.startsWith('.') && ENV_NAMES.some(name => globMatches(part, name)) ? 'secret' : 'none'
}

// The folders the mod's listing of environment files skips.
const UNLISTED_FOLDERS: ReadonlySet<string> = new Set(['node_modules', '.git'])

// Characters the shell expands or zsh reads as glob syntax ($, backtick, ^, #, ~), so the name the guard sees is not the
// name the shell reads.
const SHELL_EXPANDS = /[$`^#~]/

// Whether a wildcard name in a command reaches no environment file: a plain path in the project, with the mod's listing
// of environment files and links, that matches none of the listed files and has no listed link on its path or among its
// matches, in a command of one segment, so that no part of it makes a link or file before the read, and only when the
// shell itself globs the word: a quoted wildcard goes to a tool such as find, which matches it somewhere else. And only
// for a plain reader (isPlainReader): an unmatched glob reaches other tools as a pattern of their own. Without a full
// listing, outside the project and in the folders the listing skips, it may reach one.
function reachesNoEnvFile(candidate: string, ctx: ReachContext, dir: string, isAlone: boolean, isGlobbed: boolean, isReader: boolean): boolean {
  if (!isAlone || !isGlobbed || !isReader || !HAS_WILDCARD.test(lastPart(candidate)) || SHELL_EXPANDS.test(candidate)) return false
  if (ctx.envFilesUnknown === true || ctx.envFiles === undefined || ctx.envLinks === undefined) return false
  const rel = projectRelOf(absoluteOf(candidate, ctx, dir), ctx.root)
  if (rel === undefined || rel === '') return false
  const parts = rel.split('/')
  if (parts.some(part => UNLISTED_FOLDERS.has(part))) return false
  const folders = parts.slice(0, -1).map((_, k) => parts.slice(0, k + 1).join('/'))
  const isLinked = (link: string): boolean => globMatches(rel, link) || folders.some(folder => globMatches(folder, link))
  if (ctx.envLinks.map(normalizedPath).some(isLinked)) return false
  return !ctx.envFiles.some(file => globMatches(rel, normalizedPath(file)))
}

// The commands whose first operand is a pattern, never a file name, with the flags that take no argument. Only grep: awk
// and sed programs can run commands, so they keep the old rule. Any other option, such as -e, -f or -m 1, may move the
// pattern word, so it leaves none.
const PATTERN_FLAGS: Readonly<Record<string, RegExp>> = {
  grep: /^-[EFGPiyvwxcoqsbHhnTZzlLrRaIU]+$/,
  egrep: /^-[EFGPiyvwxcoqsbHhnTZzlLrRaIU]+$/,
  fgrep: /^-[EFGPiyvwxcoqsbHhnTZzlLrRaIU]+$/,
}

// The commands that only read the files their operands name, each with the flags it may take, so a glob the shell can't
// match only fails to open. Any other option keeps the old rule: an abbreviated long option, a recursive one, or one that
// reads file names from a file (wc --files0-from, file -f). A tool such as tar, rsync, diff -r or xargs may read an
// unmatched glob as its own pattern or descend into a folder, so it is no reader.
const COUNTED = new Set(['-n', '-c'])
const READER_FLAGS: Readonly<Record<string, { flags: RegExp; valued?: ReadonlySet<string> }>> = {
  cat: { flags: /^-[nbsu]+$/ },
  head: { flags: /^-(?:\d+|[nc]\d+|[qv])$/, valued: COUNTED },
  tail: { flags: /^-(?:\d+|[nc]\d+|[qv])$/, valued: COUNTED },
  wc: { flags: /^-[lcwmL]+$/ },
  grep: { flags: /^-[EFGPiyvwxcoqsbHhnTZzlLaIU]+$/ },
  egrep: { flags: /^-[EFGPiyvwxcoqsbHhnTZzlLaIU]+$/ },
  fgrep: { flags: /^-[EFGPiyvwxcoqsbHhnTZzlLaIU]+$/ },
}

// xargs adds file names from its input, which the guard can't see, so a command behind it is no plain reader. Nor is one
// with a word the shell expands first, a brace or a $ outside quotes, or a glob that starts with a wildcard, since it may
// turn into an option after this check.
function isPlainReader(segment: Segment, cmdAt: number): boolean {
  const reader = READER_FLAGS[segment.raw[cmdAt] ?? '']
  if (segment.xargs || reader === undefined) return false
  const words = segment.raw.slice(cmdAt + 1)
  for (let k = 0; k < words.length; k++) {
    const word = words[k] ?? ''
    const at = cmdAt + 1 + k
    if (hasUnquotedDollar(segment.raw, at) !== false || hasUnquotedBrace(segment.raw, at) !== false) return false
    // A glob that starts with a wildcard can match a file named like an option, such as one the agent made, called -r.
    if (/^[*?[]/.test(word) && hasUnquotedGlob(segment.raw, at) !== false) return false
    // zsh expands more leading characters: ^ and ~ with extendedglob, = to a command's path. The guard can't tell whether
    // they were quoted, so it refuses them either way.
    if (/^[\^#~=]/.test(word)) return false
    if (word === '--') return true
    if (!word.startsWith('-') || word === '-' || reader.flags.test(word)) continue
    if (reader.valued?.has(word) === true && /^\d+$/.test(words[k + 1] ?? '')) {
      k++
      continue
    }
    return false
  }
  return true
}

// Whether a sed script only prints, deletes or substitutes: p, d, n, q, = and s///, each with an optional address, with s
// flags among g, p, i, I, m and digits. The e command and flag run a shell, and r and w name files, so they don't count.
function isSafeSedScript(script: string): boolean {
  let i = 0
  const at = (k = i) => script.charAt(k)
  const skipSpace = () => {
    while (i < script.length && /\s/.test(at())) i++
  }
  // Past a regex or a replacement up to its closing delimiter; false when it has none.
  const pastDelimited = (delim: string): boolean => {
    while (i < script.length) {
      const c = at()
      i += c === '\\' ? 2 : 1
      if (c === delim) return true
    }
    return false
  }
  const pastAddress = (): boolean => {
    if (/\d/.test(at())) {
      while (/\d/.test(at())) i++
      return true
    }
    if (at() === '$') {
      i++
      return true
    }
    if (at() === '/') {
      i++
      return pastDelimited('/')
    }
    return true
  }
  for (;;) {
    skipSpace()
    if (i >= script.length) return true
    if (!pastAddress()) return false
    if (at() === ',') {
      i++
      if (!pastAddress()) return false
    }
    skipSpace()
    if (at() === '!') i++
    skipSpace()
    const command = at()
    i++
    if (command === 's') {
      const delim = at()
      i++
      if (delim === '' || delim === '\\' || /\s/.test(delim) || !pastDelimited(delim) || !pastDelimited(delim)) return false
      while (/[gpiIm0-9]/.test(at())) i++
    } else if (command === '' || !'pdnq='.includes(command)) return false
    skipSpace()
    if (i >= script.length) return true
    if (at() !== ';' && at() !== '\n') return false
    i++
  }
}

// The index in segment.raw of the pattern word of grep, or -1. Only a word whose wildcards all sit inside quotes counts,
// since the shell globs any other, and only one with no $ outside quotes, which the shell splits into more words.
function patternWordAt(segment: Segment, cmdAt: number): number {
  const flags = cmdAt < 0 ? undefined : PATTERN_FLAGS[segment.raw[cmdAt] ?? '']
  if (flags === undefined) return -1
  let pattern = -1
  let isEnd = false
  for (let i = cmdAt + 1; i < segment.raw.length; i++) {
    const word = segment.raw[i] ?? ''
    if (!isEnd && word === '--') isEnd = true
    else if (!isEnd && word.startsWith('-') && word !== '-') {
      if (!flags.test(word)) return -1
    } else if (pattern < 0) pattern = i
  }
  if (pattern < 0 || hasUnquotedGlob(segment.raw, pattern) !== false || hasUnquotedDollar(segment.raw, pattern) !== false) return -1
  return pattern
}

// Credential stores

const STORE_FILES = [
  '.netrc',
  '.m2/settings.xml',
  '.gradle/gradle.properties',
  '.npmrc',
  '.aws/credentials',
  '.docker/config.json',
  '.claude.json',
  '.git-credentials',
  '.config/gh/hosts.yml',
  '.config/git/credentials',
]

const storeFilesOf = (ctx: ReachContext): string[] => STORE_FILES.map(file => `${homeOf(ctx)}/${file}`.toLowerCase())

const sshOf = (ctx: ReachContext): string => `${homeOf(ctx)}/.ssh`.toLowerCase()

function isStoreFile(abs: string, ctx: ReachContext): boolean {
  const path = abs.toLowerCase()
  return storeFilesOf(ctx).includes(path) || path.startsWith(`${sshOf(ctx)}/`)
}

// Whether a search rooted at a folder reaches a store file: the folder holds one, or is above or inside ~/.ssh (any file
// there is a store). A glob that cannot match the store file's name keeps the search out, except in ~/.ssh.
function holdsStore(folder: string, glob: string | undefined, ctx: ReachContext): boolean {
  const path = folder.toLowerCase()
  const ssh = sshOf(ctx)
  if (path === ssh || path.startsWith(`${ssh}/`)) return true
  const isUnder = (file: string): boolean => path === '/' || file.startsWith(`${path}/`)
  if (isUnder(`${ssh}/x`)) return true
  return storeFilesOf(ctx).some(file => isUnder(file) && (glob === undefined || globMatches(lastPart(glob), lastPart(file))))
}

// Steering files

const STARTUP_FILES: ReadonlySet<string> = new Set(['.zshrc', '.zprofile', '.zshenv', '.zlogin', '.bashrc', '.bash_profile', '.bash_login', '.profile'])

// settings: a settings file of the project's .claude folder, which no plan allows; rel: the project-relative path of the
// other steering files that a planned-paths entry can name; none for one in the home folder.
type Steering = { settings: true } | { settings?: false; rel?: string }

function steeringOf(abs: string, ctx: ReachContext, root = ctx.root): Steering | undefined {
  const rel = abs.startsWith('~') ? undefined : projectRelOf(abs, root)
  if (rel !== undefined && rel !== '') {
    const parts = rel.split('/')
    const base = (parts[parts.length - 1] ?? '').toLowerCase()
    const at = parts.findIndex(part => part.toLowerCase() === '.claude')
    if (/^\.claude\/settings(?:\.local)?\.json$/i.test(rel)) return { settings: true }
    if (base === 'claude.md' || base === '.mcp.json' || (at >= 0 && at < parts.length - 1) || (parts.length === 1 && STARTUP_FILES.has(base))) return { rel }
  }
  const home = homeOf(ctx).toLowerCase()
  const path = abs.toLowerCase()
  if (path.startsWith(`${home}/`)) {
    const homeRel = path.slice(home.length + 1)
    if (homeRel === '.claude/settings.json' || homeRel === '.claude/claude.md' || STARTUP_FILES.has(homeRel)) return {}
  }
  return undefined
}

// A grant: the path from the root, spelled and cased as the root and a planned-paths entry spell it.
function isPlanned(abs: string, ctx: ReachContext, root: string): boolean {
  const rel = abs.startsWith('~') ? undefined : fromRoot(abs, root)
  return rel !== undefined && (ctx.plannedPaths ?? []).some(entry => normalizedPath(entry) === rel)
}

function steeringFinding(spelled: string, abs: string, ctx: ReachContext, root = ctx.root, skipSettings = false): Finding | undefined {
  const steering = steeringOf(abs, ctx, root)
  if (steering === undefined) return undefined
  if (steering.settings === true) return skipSettings ? undefined : found('steeringFile', spelled)
  return isPlanned(abs, ctx, root) ? undefined : found('steeringFile', spelled)
}

// Words in a segment

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

const WORD_SPLIT = /[\s'"=:<>(),;`|&]+/

// The names a word holds, after brace expansion, split at the characters that join a path to something else (a ref, an
// option's =, a redirection).
function candidatesOf(word: string): string[] {
  return expandBraces(word)
    .flatMap(one => one.split(WORD_SPLIT))
    .filter(part => part !== '')
}

// The commands that list or test a name and read nothing.
const LISTERS: ReadonlySet<string> = new Set(['ls', 'stat', 'test', '[', 'cd', 'pushd', 'popd'])

// The commands whose words are text, not names: a quoted message with a name in it is no read.
const TEXT_COMMANDS: ReadonlySet<string> = new Set(['echo', 'printf', 'gh'])

const EXCLUDE_OPTIONS: ReadonlySet<string> = new Set(['--exclude', '--exclude-dir', '--exclude-from'])

// A word that excludes files from a search, which is no name of a file read.
function isExcludeWord(word: string, before: string | undefined): boolean {
  return /^(?:--exclude|--glob=!|--iglob=!|-g!|!|:[!^(])/.test(word) || (before !== undefined && EXCLUDE_OPTIONS.has(before))
}

function isCommitLike(segment: Segment): boolean {
  if (segment.words[0] !== 'git') return false
  return ['commit', 'tag', 'notes', 'stash'].includes(segment.words[gitSubcommandAt(segment.words).at] ?? '')
}

// Token names and reveals

const TOKEN_NAME = /_PAT$|TOKEN|KEY/

const PRINTERS: ReadonlySet<string> = new Set(['echo', 'printf', 'print'])

const variablesIn = (word: string): string[] => [...word.matchAll(/\$\{?[!#]?([A-Za-z_][A-Za-z0-9_]*)/g)].map(match => match[1] ?? '')

const positionalsOf = (args: string[]): string[] => {
  const positional: string[] = []
  for (let i = 0; i < args.length; i++) {
    const word = args[i] ?? ''
    if (word === '-R' || word === '--repo' || word === '--hostname') i++
    else if (!word.startsWith('-')) positional.push(word)
  }
  return positional
}

// A command that prints a token, the whole environment or a credential. A variable whose name matches *_PAT, *TOKEN* or
// *KEY* counts where a command prints it (echo, printf, print, a here-string, printenv NAME); as an argument of another
// command or in an assignment prefix it passes.
function revealFinding(command: string, segments: Segment[]): Finding | undefined {
  for (const raw of rawSegmentsOf(command)) {
    let at = 0
    while (at < raw.length && ASSIGNMENT.test(raw[at] ?? '')) at++
    if (raw[at] === 'env' && raw.slice(at + 1).every(word => word.startsWith('-'))) return found('tokenReveal')
  }
  for (const { words } of segments) {
    const [cmd = ''] = words
    const args = words.slice(1)
    if (words.some(word => word === '--show-token' || word.startsWith('--show-token='))) return found('tokenReveal')
    const positional = positionalsOf(args)
    if (cmd === 'gh' && positional[0] === 'auth' && positional[1] === 'token') return found('tokenReveal')
    if (cmd === 'git' && words[gitSubcommandAt(words).at] === 'credential') return found('tokenReveal')
    if (cmd === 'printenv') {
      if (args.every(word => word.startsWith('-'))) return found('tokenReveal')
      const named = args.find(word => !word.startsWith('-') && TOKEN_NAME.test(word))
      if (named !== undefined) return found('tokenPrint', named)
    }
    if (cmd === 'set' && args.length === 0) return found('tokenReveal')
    if (['export', 'declare', 'typeset'].includes(cmd) && (args.includes('-p') || (cmd === 'export' && args.length === 0))) return found('tokenReveal')
    const hereAt = words.findIndex(word => word.startsWith('<<<'))
    const printed = PRINTERS.has(cmd) ? args : hereAt >= 0 ? [(words[hereAt] ?? '').slice(3), ...words.slice(hereAt + 1)] : []
    for (const word of printed) {
      const name = variablesIn(word).find(variable => TOKEN_NAME.test(variable))
      if (name !== undefined) return found('tokenPrint', name)
    }
  }
  return undefined
}

// Writes by a shell command

const REDIRECT_OUT = /^(?:\d*|&)>>?\|?(.*)$/

// The names a segment writes: redirect targets, the files of tee, sed -i, perl -i, mv, the target of cp, install, ln and
// rsync, and what truncate, touch and dd name.
function writeTargets(segment: Segment): string[] {
  const targets: string[] = []
  const { raw } = segment
  for (let i = 0; i < raw.length; i++) {
    const match = REDIRECT_OUT.exec(raw[i] ?? '')
    if (match === null) continue
    const target = (match[1] ?? '') !== '' ? (match[1] ?? '') : (raw[i + 1] ?? '')
    if (target !== '' && !target.startsWith('&')) targets.push(target)
  }
  const [cmd = ''] = segment.words
  const args = segment.words.slice(1)
  const positional = args.filter(word => !word.startsWith('-') && !/^\d*[<>]|^&>/.test(word))
  if (cmd === 'tee' || cmd === 'mv' || cmd === 'truncate' || cmd === 'touch') targets.push(...positional)
  else if ((cmd === 'sed' || cmd === 'perl') && args.some(word => /^-[a-zA-Z]*i/.test(word) || word.startsWith('--in-place'))) targets.push(...positional)
  else if (['cp', 'install', 'ln', 'rsync'].includes(cmd)) {
    const into = args.indexOf('-t')
    const last = positional[positional.length - 1]
    if (into >= 0 && args[into + 1] !== undefined) targets.push(args[into + 1] ?? '')
    else if (last !== undefined) targets.push(last)
  } else if (cmd === 'dd') targets.push(...args.filter(word => word.startsWith('of=')).map(word => word.slice(3)))
  return targets
}

// Searches over a folder

interface Search {
  // grep -r reads every file; rg, ag, ack and git grep read what Git's rules let them see
  kind: 'all' | 'reach'
  scopes: string[]
  excludes: string[]
}

const GREP_VALUED: ReadonlySet<string> = new Set([
  '-e',
  '-f',
  '-m',
  '-A',
  '-B',
  '-C',
  '-d',
  '-D',
  '--include',
  '--exclude',
  '--exclude-dir',
  '--exclude-from',
  '--regexp',
  '--file',
  '--max-count',
  '--label',
  '--binary-files',
])

const RG_VALUED: ReadonlySet<string> = new Set([
  '-e',
  '-f',
  '-g',
  '-t',
  '-T',
  '-m',
  '-A',
  '-B',
  '-C',
  '-j',
  '-M',
  '-r',
  '-E',
  '-d',
  '--regexp',
  '--file',
  '--glob',
  '--iglob',
  '--type',
  '--type-not',
  '--max-count',
  '--threads',
  '--max-depth',
  '--max-columns',
  '--replace',
  '--sort',
  '--sortr',
  '--encoding',
  '--pre',
  '--pre-glob',
])

const GIT_GREP_VALUED: ReadonlySet<string> = new Set(['-e', '-f', '-m', '-A', '-B', '-C', '--max-depth', '--threads', '--open-files-in-pager'])

// Options that make ag read what its ignore files would skip.
const AG_WIDENING = /^(?:--(?:unrestricted|skip-vcs-ignores|hidden|all-types)|-[A-Za-z]*[uUa][A-Za-z]*)$/

// rg's -u in a bundle of short flags (-u, -uu, -nu).
const RG_BUNDLE_WIDENING = /^-[A-Za-z]*u[A-Za-z]*$/

// The options of ag that take a value, as the next word or after =.
const AG_VALUED: ReadonlySet<string> = new Set([
  '-A',
  '-B',
  '-C',
  '-G',
  '-g',
  '-m',
  '-p',
  '-W',
  '--after',
  '--before',
  '--context',
  '--depth',
  '--file-search-regex',
  '--ignore',
  '--ignore-dir',
  '--max-count',
  '--path-to-ignore',
  '--width',
  '--workers',
])

// A pathspec that excludes: :(exclude,glob)**/.env*, :!pattern, :^pattern; the pattern is its glob.
function pathspecExclude(spec: string): string | undefined {
  const magic = /^:\(([^)]*)\)(.*)$/.exec(spec)
  if (magic !== null) return /(?:^|,)exclude(?:,|$)/.test(magic[1] ?? '') ? (magic[2] ?? '') : undefined
  return /^:[!^]/.test(spec) ? spec.slice(2) : undefined
}

// The content search a segment runs over folders: grep with -r or -R, rg, ag, ack and git grep; undefined for anything else
// and for a search that names its files one by one.
function searchOf(words: string[]): Search | undefined {
  const [cmd = ''] = words
  let tool: 'grep' | 'rg' | 'git' | undefined
  let rest: string[] = []
  if (/^(?:e?grep|fgrep)$/.test(cmd)) {
    tool = 'grep'
    rest = words.slice(1)
  } else if (cmd === 'rg' || cmd === 'ag' || cmd === 'ack') {
    tool = 'rg'
    rest = words.slice(1)
  } else if (cmd === 'git') {
    const at = gitSubcommandAt(words).at
    if (words[at] === 'grep') {
      tool = 'git'
      rest = words.slice(at + 1)
    }
  }
  if (tool === undefined || words.includes('--files')) return undefined
  const valued = tool === 'grep' ? GREP_VALUED : tool === 'rg' ? (cmd === 'ag' ? AG_VALUED : RG_VALUED) : GIT_GREP_VALUED
  const positional: string[] = []
  const specs: string[] = []
  const excludes: string[] = []
  let isRecursive = tool !== 'grep'
  let isWidened = false
  let hasPatternOption = false
  let isAfterDashes = false
  let isEndOfOptions = false
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i] ?? ''
    if (isAfterDashes) {
      specs.push(word)
    } else if (word === '--') {
      if (tool === 'git') isAfterDashes = true
      else isEndOfOptions = true
    } else if (!isEndOfOptions && word.startsWith('-') && word !== '-') {
      const eq = word.indexOf('=')
      const name = eq >= 0 ? word.slice(0, eq) : word
      const value = (): string => (eq >= 0 ? word.slice(eq + 1) : (rest[++i] ?? ''))
      if (name === '--exclude') excludes.push(value())
      else if (cmd !== 'ag' && (name === '-g' || name === '--glob' || name === '--iglob')) {
        const glob = value()
        if (glob.startsWith('!')) excludes.push(glob.slice(1))
      } else if (tool === 'rg' && cmd !== 'ag' && /^-g./.test(word)) {
        if (word.startsWith('-g!')) excludes.push(word.slice(3))
      } else {
        if (name === '-e' || name === '--regexp' || name === '-f' || name === '--file') hasPatternOption = true
        if (tool === 'grep' && (/^-[a-zA-Z]*[rR]/.test(word) || name === '--recursive' || (name === '-d' && rest[i + 1] === 'recurse'))) isRecursive = true
        if (tool === 'rg' && (cmd === 'ag' ? AG_WIDENING.test(word) : RG_BUNDLE_WIDENING.test(word) || name.startsWith('--no-ignore'))) isWidened = true
        if (tool === 'git' && (name === '--untracked' || name === '--no-index')) isWidened = true
        if (valued.has(name) && eq < 0) i++
      }
    } else {
      positional.push(word)
    }
  }
  if (!isRecursive) return undefined
  if (!hasPatternOption) positional.shift()
  const scopes: string[] = []
  const paths = tool === 'git' ? [...positional.filter(word => /[/.*]/.test(word)), ...specs] : positional
  for (const spec of paths) {
    const excluded = tool === 'git' ? pathspecExclude(spec) : undefined
    if (excluded !== undefined) excludes.push(excluded.replace(/^\*\*\//, ''))
    else scopes.push(tool === 'git' ? spec.replace(/^:\([^)]*\)|^:\//, '') : spec)
  }
  return { kind: tool === 'grep' || cmd === 'ack' || isWidened ? 'all' : 'reach', scopes: scopes.length > 0 ? scopes : [''], excludes }
}

// Git subcommands that print a patch for every file they touch, and those that do only with a patch option.
const PATCH_ALWAYS: ReadonlySet<string> = new Set(['diff', 'show', 'format-patch', 'range-diff'])
const PATCH_ON_OPTION: ReadonlySet<string> = new Set(['log', 'reflog', 'whatchanged', 'diff-tree', 'diff-index', 'diff-files'])
// Options that turn a patch on: -p and -u (alone or in a bundle), -U<n>, -L<range>, the combined and word diffs, --binary.
const PATCH_OPTION =
  /^(?:-[A-Za-z]*[pu][A-Za-z]*|-U\d*|-L.+|--unified(?:=.*)?|--patch(?:-with-(?:stat|raw))?|--cc|--combined|--dense-combined|--remerge-diff|--word-diff(?:=.*)?|--color-words(?:=.*)?|--binary|-c|-m)$/
const NO_PATCH_OPTION =
  /^(?:--stat(?:=.*)?|--numstat|--shortstat|--dirstat(?:=.*)?|--name-only|--name-status|--summary|--raw|--check|--quiet|-q|-s|--no-patch)$/

// A pathspec as Git reads it: its magic (exclude, glob, icase) and its pattern.
interface Pathspec {
  pattern: string
  isExclude: boolean
  isGlob: boolean
  isIcase: boolean
  // top magic (:/ or :(top)): read from the project root, not from the folder the command runs in
  isTop: boolean
}

function pathspecOf(spec: string): Pathspec {
  const magic = /^:\(([^)]*)\)(.*)$/.exec(spec)
  if (magic !== null) {
    const words = (magic[1] ?? '').split(',')
    return {
      pattern: magic[2] ?? '',
      isExclude: words.includes('exclude'),
      isGlob: words.includes('glob'),
      isIcase: words.includes('icase'),
      isTop: words.includes('top'),
    }
  }
  if (/^:[!^]/.test(spec)) return { pattern: spec.slice(2), isExclude: true, isGlob: false, isIcase: false, isTop: false }
  const isTop = spec.startsWith(':/')
  return { pattern: isTop ? spec.slice(2) : spec, isExclude: false, isGlob: false, isIcase: false, isTop }
}

// Whether a pathspec's pattern matches a project-relative path as Git matches it: a pattern with no wildcard is the path
// or a folder above it; one with wildcards is read from the project root, with * crossing / unless the glob magic is on.
// A pattern it can't read matches nothing, so an exclude it can't read excludes nothing; `orUnreadable` flips that for a
// scope, which then reaches everything.
function pathspecMatches(spec: Pathspec, file: string, orUnreadable = false): boolean {
  const pattern = normalizedPath(spec.pattern.replace(/^\.\//, ''))
  const path = spec.isIcase ? file.toLowerCase() : file
  const want = spec.isIcase ? pattern.toLowerCase() : pattern
  if (pattern === '' || pattern === '.') return true
  if (!HAS_WILDCARD.test(want)) return path === want || path.startsWith(`${want}/`)
  let source = ''
  for (let i = 0; i < want.length; i++) {
    const c = want.charAt(i)
    const end = c === '[' ? want.indexOf(']', i + 2) : -1
    if (c === '*') {
      if (!spec.isGlob) source += '.*'
      else if (want.startsWith('**/', i) && (i === 0 || want.charAt(i - 1) === '/')) {
        source += '(?:.*/)?'
        i += 2
      } else if (want.startsWith('**', i)) {
        source += '.*'
        i += 1
      } else source += '[^/]*'
    } else if (c === '?') source += spec.isGlob ? '[^/]' : '.'
    else if (end > 0) {
      const body = want.slice(i + 1, end)
      source += `[${body.startsWith('!') ? `^${body.slice(1)}` : body}]`.replace(/\\/g, '\\\\')
      i = end
    } else source += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  try {
    return new RegExp(`^${source}(?:/.*)?$`).test(path)
  } catch {
    return orUnreadable
  }
}

// Paths one exclude must cover, all of them, to keep every environment file out when the mod could not list them.
const ENV_SAMPLE_PATHS = ['.env', 'a/.env', '.env.local', 'a/b/.env.production', 'a/b/c/.env.staging', 'a b/.env.foo.bar', '.env.x']

// A patch print: where it reaches (pathspecs after --, the whole project without them) and what it excludes.
interface PatchScan {
  scopes: Pathspec[]
  excludes: Pathspec[]
  // every word that may name a path, before -- or after, for the credential-store check
  named: string[]
}

// The patch print a segment runs over the repository: git diff, show, format-patch and range-diff, and git log, reflog,
// whatchanged, diff-tree, diff-index, diff-files and stash show or list with a patch option. A word before -- may be a
// revision, so it narrows nothing. A show of files at revisions alone (rev:path) prints no patch; the files' own names
// are judged where the segment's words are. A diff --no-index compares the paths it names, which the folder check judges.
function patchOf(words: string[]): { patch: PatchScan } | { search: Search } | undefined {
  if (words[0] !== 'git') return undefined
  const at = gitSubcommandAt(words).at
  const sub = words[at]
  if (at < 0 || sub === undefined) return undefined
  let rest = words.slice(at + 1)
  if (sub === 'stash') {
    if (rest[0] !== 'show' && rest[0] !== 'list') return undefined
    rest = rest.slice(1)
  } else if (!PATCH_ALWAYS.has(sub) && !PATCH_ON_OPTION.has(sub)) {
    return undefined
  }
  const dashes = rest.indexOf('--')
  const before = dashes >= 0 ? rest.slice(0, dashes) : rest
  const options = before.filter(word => word.startsWith('-') && word !== '-')
  const isPatch = options.some(word => PATCH_OPTION.test(word))
  if (!isPatch && !(PATCH_ALWAYS.has(sub) && !options.some(word => NO_PATCH_OPTION.test(word)))) return undefined
  if (options.includes('--no-index')) {
    const paths = rest.filter(word => !word.startsWith('-') || word === '-')
    return { search: { kind: 'all', scopes: paths.length > 0 ? paths : [''], excludes: [] } }
  }
  const others = before.filter(word => !word.startsWith('-') && !word.includes(':'))
  if (sub === 'show' && others.length === 0 && before.some(word => !word.startsWith('-') && word.includes(':'))) return undefined
  const scopes: Pathspec[] = []
  const excludes: Pathspec[] = []
  for (const spec of dashes >= 0 ? rest.slice(dashes + 1) : []) {
    const one = pathspecOf(spec)
    if (one.isExclude) excludes.push(one)
    else scopes.push(one)
  }
  const named = rest.filter(word => !word.startsWith('-') && word !== '--')
  return {
    patch: { scopes: scopes.length > 0 ? scopes : [{ pattern: '', isExclude: false, isGlob: false, isIcase: false, isTop: true }], excludes, named },
  }
}

// A patch print is judged by the environment files it reaches: a scope reaches a file by Git's pathspec rules, and an
// exclude that matches the file's whole path keeps it out. Pathspecs are read from the folder the command runs in (cwd,
// project-relative; undefined when it can't be told, such as under git -C): then no exclude counts and every scope is the
// whole project. With the listing unknown, only one exclude that covers every sample path keeps the print.
function patchFinding(patch: PatchScan, ctx: ReachContext, dir: string, cwd: string | undefined): Finding | undefined {
  const fromCwd = (spec: Pathspec): Pathspec => (spec.isTop || cwd === undefined || cwd === '' ? spec : { ...spec, pattern: `${cwd}/${spec.pattern}` })
  const excludes = cwd === undefined ? [] : patch.excludes.map(fromCwd)
  const scopes = cwd === undefined ? patch.scopes.map(spec => ({ ...spec, pattern: '', isTop: true })) : patch.scopes.map(fromCwd)
  const where = patch.scopes.map(spec => spec.pattern).join(', ')
  // A folder that holds the account's credential stores, as a search over it would be judged.
  for (const word of patch.named) {
    if (holdsStore(absoluteOf(pathspecOf(word).pattern || '.', ctx, dir), undefined, ctx)) return found('folderSearch', where === '' ? word : where)
  }
  const isCovered = (file: string): boolean => excludes.some(spec => pathspecMatches(spec, file))
  if (ctx.envFilesUnknown === true) {
    const isKept = excludes.some(spec => ENV_SAMPLE_PATHS.every(path => pathspecMatches(spec, path)))
    return isKept ? undefined : found('folderSearch', `${where}, the list of environment files could not be read`)
  }
  const list = (ctx.envFilesReachable ?? ctx.envFiles ?? []).map(normalizedPath)
  const hit = list.find(file => !isCovered(file) && scopes.some(spec => pathspecMatches(spec, file, true)))
  return hit === undefined ? undefined : found('folderSearch', where === '' ? 'the project folder' : where)
}

const coversEnv = (glob: string): boolean => ENV_NAMES.slice(0, 2).every(name => globMatches(lastPart(glob), name))

// A search over a folder is judged by what it reaches. The folder holds a store file (any glob that can match it), or an
// environment file the tool reads (from the mod's listing, or any when the listing failed) that no exclude and no
// include glob keeps out. A search whose scope names one environment file is judged by that name instead.
function folderFinding(
  spelled: string,
  abs: string,
  kind: 'all' | 'reach',
  excludes: string[],
  glob: string | undefined,
  ctx: ReachContext
): Finding | undefined {
  const where = spelled === '' ? 'the project folder' : spelled
  if (holdsStore(abs, glob, ctx)) return found('folderSearch', where)
  // A folder above the project root covers the whole project.
  const rel = projectRelOf(abs, ctx.root) ?? (containsRoot(abs, ctx.root) ? '' : undefined)
  if (rel === undefined || isEnvFile(spelled) !== 'none') return undefined
  const listed = ctx.envFiles ?? []
  const names = [...ENV_NAMES, ...listed.map(lastPart)]
  if (glob !== undefined && !names.some(name => globMatches(lastPart(glob), name))) return undefined
  if (ctx.envFilesUnknown === true) {
    return excludes.some(coversEnv) ? undefined : found('folderSearch', `${where}, the list of environment files could not be read`)
  }
  const list = kind === 'reach' ? (ctx.envFilesReachable ?? ctx.envFiles ?? []) : listed
  const hits = list.filter(file => {
    const path = normalizedPath(file)
    const isUnder = rel === '' || path === rel || path.startsWith(`${rel}/`)
    const isExcluded = excludes.some(pattern => globMatches(lastPart(pattern), lastPart(file)))
    return isUnder && !isExcluded && (glob === undefined || globMatches(lastPart(glob), lastPart(file)))
  })
  return hits.length > 0 ? found('folderSearch', where) : undefined
}

// The reviewer and CLAUDE.md

function isClaudeMd(abs: string, ctx: ReachContext): boolean {
  return lastPart(abs).toLowerCase() === 'claude.md' && projectRelOf(abs, ctx.root) !== undefined
}

const reviewerFinding = (ctx: ReachContext): Finding => found('reviewerClaudeMd', `git show origin/${ctx.base ?? '<base>'}:CLAUDE.md`)

const isReviewerInPr = (ctx: ReachContext): boolean => ctx.phase === 'PR' && ctx.isReviewer === true

// Shell

function segmentFinding(segment: Segment, ctx: ReachContext, dir: string, isAlone: boolean): Finding | undefined {
  const [cmd = ''] = segment.words
  if (!LISTERS.has(cmd)) {
    const isText = TEXT_COMMANDS.has(cmd) || isCommitLike(segment)
    const cmdAt = segment.raw.indexOf(cmd)
    const patternAt = patternWordAt(segment, cmdAt)
    const isSed = segment.raw[cmdAt] === 'sed'
    const isReader = isPlainReader(segment, cmdAt)
    for (let i = 0; i < segment.raw.length; i++) {
      const word = segment.raw[i] ?? ''
      if (i === cmdAt || (isText && /\s/.test(word)) || isExcludeWord(word, segment.raw[i - 1])) continue
      // A sed script that may run a shell (e) or name a file (r, w) is also read between its slashes.
      const extra = isSed && i > cmdAt && !isSafeSedScript(word) ? word.split('/').flatMap(candidatesOf) : []
      for (const candidate of [...candidatesOf(word), ...extra]) {
        // A wildcard in the pattern of grep is regex syntax; a name there still counts.
        const isRegex = i === patternAt && HAS_WILDCARD.test(lastPart(candidate))
        if (
          envKindOf(candidate) === 'secret' &&
          !isRegex &&
          !reachesNoEnvFile(candidate, ctx, dir, isAlone, hasUnquotedGlob(segment.raw, i) === true, isReader)
        )
          return found('envFile', candidate)
        const abs = absoluteOf(candidate, ctx, dir)
        if (isStoreFile(abs, ctx)) return found('credentialStore', candidate)
        if (isReviewerInPr(ctx) && cmd !== 'git' && isClaudeMd(abs, ctx)) return reviewerFinding(ctx)
      }
    }
  }
  for (const target of writeTargets(segment)) {
    for (const candidate of expandBraces(target)) {
      const finding = steeringFinding(candidate, absoluteOf(candidate, ctx, dir), ctx)
      if (finding !== undefined) return finding
    }
  }
  const patched = patchOf(segment.words)
  if (patched !== undefined && 'patch' in patched) {
    const isRoot = normalizedPath(dir) === normalizedPath(ctx.root)
    const rel = segment.repoOptions ? undefined : isRoot ? '' : fromRoot(dir, ctx.root)
    const finding = patchFinding(patched.patch, ctx, dir, rel)
    if (finding !== undefined) return finding
  }
  const search = searchOf(segment.words) ?? (patched !== undefined && 'search' in patched ? patched.search : undefined)
  if (search !== undefined) {
    for (const scope of search.scopes) {
      const finding = folderFinding(scope, absoluteOf(scope === '' ? '.' : scope, ctx, dir), search.kind, search.excludes, undefined, ctx)
      if (finding !== undefined) return finding
    }
  }
  return undefined
}

function shellFinding(command: string, ctx: ReachContext, depth = 0): Finding | undefined {
  const segments = segmentsOf(command, true)
  if (ctx.phase !== 'Intent') {
    const revealed = revealFinding(command, segments)
    if (revealed !== undefined) return revealed
  }
  let dir = ctx.root
  for (const segment of segments) {
    const finding = segmentFinding(segment, ctx, dir, depth === 0 && segments.length === 1)
    if (finding !== undefined) return finding
    const [cmd = '', first] = segment.words
    if ((cmd === 'cd' || cmd === 'pushd') && first !== undefined && first !== '-') dir = absoluteOf(first, ctx, dir)
    if (depth < 3 && (cmd === 'eval' || SHELLS.has(cmd))) {
      const at = cmd === 'eval' ? 0 : segment.words.findIndex(word => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word))
      const script = cmd === 'eval' ? segment.words.slice(1).join(' ') : at >= 0 ? segment.words[at + 1] : undefined
      const inner = script === undefined ? undefined : shellFinding(script, ctx, depth + 1)
      if (inner !== undefined) return inner
    }
  }
  return undefined
}

// The tools

const EDIT_PATH: Readonly<Record<string, string>> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }

const asString = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

// A named path: an environment file, a credential store, the reviewer's CLAUDE.md.
function pathFinding(spelled: string, ctx: ReachContext): Finding | undefined {
  if (envKindOf(spelled) === 'secret') return found('envFile', spelled)
  const abs = absoluteOf(spelled, ctx, ctx.root)
  if (isStoreFile(abs, ctx)) return found('credentialStore', spelled)
  if (isReviewerInPr(ctx) && isClaudeMd(abs, ctx)) return reviewerFinding(ctx)
  return undefined
}

function grepFinding(input: Record<string, unknown>, ctx: ReachContext): Finding | undefined {
  const path = asString(input.path)
  const glob = asString(input.glob)
  if (path !== undefined) {
    const named = pathFinding(path, ctx)
    if (named !== undefined) return named
  }
  let globName: string | undefined
  if (glob !== undefined) {
    for (const candidate of expandBraces(glob)) {
      if (envKindOf(candidate) === 'secret') return found('envFile', candidate)
      if (!HAS_WILDCARD.test(candidate)) globName = candidate
    }
    // A glob that names one file is judged by that name alone.
    if (globName !== undefined && glob === globName && isEnvFile(globName) !== 'none') return undefined
  }
  const spelled = path ?? ''
  return folderFinding(spelled, absoluteOf(spelled === '' ? '.' : spelled, ctx, ctx.root), 'reach', [], glob, ctx)
}

// The finding for a call: a read or search of an environment file or a credential store, a token print, a write to a
// steering file, the reviewer's read of the working-tree CLAUDE.md. real: where an edit's target and the root land with
// every symbolic link followed.
export function reachFinding(
  call: { tool: string; input: Record<string, unknown> },
  ctx: ReachContext,
  real?: { path: string; root: string }
): Finding | undefined {
  const { tool, input } = call
  if (tool === 'Read') {
    const path = asString(input.file_path)
    return path === undefined ? undefined : pathFinding(path, ctx)
  }
  if (tool === 'Grep') return grepFinding(input, ctx)
  const editKey = EDIT_PATH[tool]
  const target = editKey === undefined ? undefined : asString(input[editKey])
  if (target !== undefined) {
    const spelled = steeringFinding(target, absoluteOf(target, ctx, ctx.root), ctx, ctx.root, true)
    if (spelled !== undefined) return spelled
    return real === undefined || real.path === '' ? undefined : steeringFinding(target, real.path, ctx, real.root, true)
  }
  const command = tool.startsWith('mcp__') ? undefined : asString(input.command)
  return command === undefined ? undefined : shellFinding(command, ctx)
}

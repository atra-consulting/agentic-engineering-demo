// The check command for the goal-and-do plugin: every check in a fixed order, each to its end, then a summary.
// Exits 1 when any blocking check fails. Warnings (ESLint's warn rules, a newer Claude Code) never fail it.
// With --fix, the formatter, ESLint and markdownlint fix what they can first; the checks then run as usual.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const here = path.resolve(import.meta.dirname, '..')
const root = path.resolve(here, '../..')
const plugin = 'plugins/goal-and-do'
const bin = name => path.join(here, 'node_modules', '.bin', name)
const fix = process.argv.includes('--fix')

const typeScript = `${plugin}/**/*.{ts,tsx}`
const markdown = [`${plugin}/**/*.md`, `!${plugin}/docs/reviews/**`, `!${plugin}/**/node_modules/**`]
const eslintArgs = ['-c', path.join(here, 'eslint.config.mjs'), `${plugin}/hooks`]
const prettierArgs = ['--config', path.join(here, '.prettierrc.json'), '--ignore-path', path.join(here, '.prettierignore')]
const markdownlintArgs = ['--config', path.join(here, '.markdownlint-cli2.jsonc')]

// The API types are not committed (see README.md, The API types). Without them the type check and the
// type-aware lint can't run, so both are skipped with a warning instead of failing.
const typesFile = path.join(here, 'types', 'claude-code.d.ts')
const hasTypes = fs.existsSync(typesFile)
const needsTypes = new Set(['types (tsc)', 'lint (eslint)'])

const allChecks = [
  { name: 'types (tsc)', command: bin('tsc'), args: ['-p', path.join(here, 'tsconfig.check.json')] },
  { name: 'lint (eslint)', command: bin('eslint'), args: eslintArgs, fixArgs: ['--fix'] },
  { name: 'format (prettier)', command: bin('prettier'), args: [...prettierArgs, '--check', typeScript], fixWith: [...prettierArgs, '--write', typeScript] },
  { name: 'markdown (markdownlint)', command: bin('markdownlint-cli2'), args: [...markdownlintArgs, ...markdown], fixArgs: ['--fix'] },
  { name: 'rules (front matter, dashes)', command: process.execPath, args: [path.join(here, 'scripts', 'rules.mjs')] },
  { name: 'rules script tests (node:test)', command: process.execPath, args: ['--test', ...testFiles()] },
  { name: 'plugin (claude plugin validate)', command: 'claude', args: ['plugin', 'validate', plugin] },
  { name: 'suite (claude plugin test)', command: 'claude', args: ['plugin', 'test', plugin] },
]
const checks = hasTypes ? allChecks : allChecks.filter(check => !needsTypes.has(check.name))

function testFiles() {
  const folder = path.join(here, 'test')
  return fs
    .readdirSync(folder)
    .filter(name => name.endsWith('.test.mjs'))
    .map(name => path.join(folder, name))
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) console.error(`could not run ${command}: ${result.error.message}`)
  return result.status ?? 1
}

// The API types are a copy, written by one Claude Code version; a different one may have changed the API.
function versionNotice() {
  if (!hasTypes) return `warning: ${path.relative(root, typesFile)} is missing, so types and lint were skipped; copy it (see dev/goal-and-do/README.md)`
  const copy = fs.readFileSync(typesFile, 'utf8').split('\n', 1)[0] ?? ''
  const copied = /Claude Code (\S+?)\.?$/.exec(copy)?.[1]
  const installed = /^(\S+)/.exec(spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout ?? '')?.[1]
  if (copied && installed && copied !== installed)
    return `warning: the API types are from Claude Code ${copied}, this is ${installed}; copy the new types (see dev/goal-and-do/README.md)`
  return undefined
}

if (fix) {
  for (const check of checks) {
    if (check.fixWith) run(check.command, check.fixWith)
    else if (check.fixArgs) run(check.command, [...check.args, ...check.fixArgs])
  }
}

const results = checks.map(check => {
  console.log(`\n== ${check.name}`)
  return { name: check.name, status: run(check.command, check.args) }
})

const notice = versionNotice()
console.log('\n== summary')
for (const result of results) console.log(`${result.status === 0 ? 'pass' : 'FAIL'}  ${result.name}`)
if (!hasTypes) for (const name of needsTypes) console.log(`skip  ${name}`)
if (notice) console.log(notice)
const failed = results.filter(result => result.status !== 0).length
console.log(failed === 0 ? 'all checks passed' : `${failed} of ${results.length} checks failed`)
process.exitCode = failed === 0 ? 0 : 1

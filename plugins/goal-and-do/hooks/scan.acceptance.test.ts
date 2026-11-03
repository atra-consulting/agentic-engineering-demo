import { expect, test } from 'claude-code/testing'
import { checkCommit, checkPrBody, checkPush, denialText, GITLEAKS_VERSION, scanMessage, scanPatch, scannerArgs, scannerLine } from './scan'
import type { Check, CommitPatch, GitReader, Hit, Scanner, ShapeId } from './scan'

// Synthetic secrets are assembled at run time: no complete secret shape stands in this file as one literal.
const join = (...parts: string[]): string => parts.join('')

const PRIVATE_BEGIN = join('-----BEGIN', ' RSA PRIVATE', ' KEY-----')
const PRIVATE_END = join('-----END', ' RSA PRIVATE', ' KEY-----')
const PRIVATE_BODY = join('MIIEowIBAAKCAQEA', '7x9Qk2Lm4Zp8Vt3Rn6Yb', '1Hc5Wd0Sg9Fj2Ke4Ua7Ni3Ox6Pq8Rz')
const AWS_KEY = join('AKIA', 'QWERTY12', 'ZXCVBN34')
const GITHUB_TOKEN = join('ghp', '_', 'Ab12Cd34Ef56', 'Gh78Ij90Kl12', 'Mn34Op56Qr78')
const JIRA_TOKEN = join('ATATT', '3', 'xAbCdEfGh1Jk', 'LmNoPq2RsTuV')

// One character short of each shape: not a secret shape.
const NEAR_MISS_AWS = join('AKIA', 'QWERTY12', 'ZXCVBN3')
const NEAR_MISS_GITHUB = join('ghp', '_', 'Ab12Cd34Ef56', 'Gh78Ij90Kl12', 'Mn34Op56Qr7')

const SHA_A = 'c0ffee1' + 'a'.repeat(33)
const SHA_B = 'deadbee' + 'f'.repeat(33)
const SHORT_A = SHA_A.slice(0, 7)
const SHORT_B = SHA_B.slice(0, 7)

const FILE = 'src/config.ts'
const FILE_LINE = 37
const BODY_LINE = 11
const MESSAGE_LINE = 6
const REPORT_PATH = '/home/tester/.cache/goal-and-do/gitleaks-report.json'
const ALLOW = ' # gitleaks:allow'

// A new file's patch, as git show prints it.
function newFilePatch(path: string, lines: string[]): string {
  return (
    [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      'index 0000000..1111111',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map(line => `+${line}`),
    ].join('\n') + '\n'
  )
}

// Content whose first secret line is line `at`.
function contentAt(at: number, secretLines: string[]): string[] {
  const filler = Array.from({ length: at - 1 }, (_, index) => `// filler ${index + 1}`)
  return [...filler, ...secretLines, '// end']
}

const CLEAN_PATCH = newFilePatch('src/clean.ts', [
  'export const answer = 1',
  `// near miss ${NEAR_MISS_AWS}`,
  `// near miss ${NEAR_MISS_GITHUB}`,
  '-----BEGIN PUBLIC KEY-----',
])

const fakeGit = (staged: string | undefined, commits: CommitPatch[] | undefined): GitReader => ({
  stagedPatch: async () => staged,
  commitsAhead: async () => commits,
})

const commitOf = (sha: string, message: string, patch: string): CommitPatch => ({ sha, message, patch })

type ScanTarget = Parameters<Scanner['scan']>[0]

interface ScannerSetup {
  version?: string | undefined
  approved?: boolean
  outcome?: { exitCode: number; report?: string } | 'reject'
}

function fakeScanner(setup: ScannerSetup = {}) {
  const scans: { target: ScanTarget; args: string[] }[] = []
  const removed = { count: 0 }
  const version = 'version' in setup ? setup.version : GITLEAKS_VERSION
  const scanner: Scanner = {
    reportPath: REPORT_PATH,
    version: async () => version,
    approved: () => setup.approved ?? true,
    scan: async (target, args) => {
      scans.push({ target, args })
      const outcome = setup.outcome ?? { exitCode: 0 }
      if (outcome === 'reject') throw new Error('scanner timed out')
      return outcome
    },
    removeReport: async () => {
      removed.count += 1
    },
  }
  return { scanner, scans, removed }
}

// The scanner's JSON report: values redacted, but a "Match" field that carries a fragment, which a denial must not echo.
const reportFor = (file: string, line: number, commit = ''): string =>
  JSON.stringify([{ RuleID: 'generic-api-key', File: file, StartLine: line, Commit: commit, Secret: 'REDACTED', Match: `token = ${GITHUB_TOKEN}` }])

const files =
  (contents: Record<string, string>) =>
  async (path: string): Promise<string | undefined> =>
    contents[path]
const noFiles = files({})

const prCreate = (body: string): string => `gh pr create --title "Add feature" --body '${body}'`

const bodyAt = (at: number, secretLines: string[]): string =>
  [...Array.from({ length: at - 1 }, (_, index) => `Summary line ${index + 1}`), ...secretLines, 'Thanks'].join('\n')

const reasonOf = (check: Check): string => {
  expect(check.verdict).toBe('deny')
  return check.verdict === 'deny' ? check.reason : ''
}

function expectFourSteps(text: string, label = ''): void {
  const lower = text.toLowerCase()
  for (const word of ['stop', 'rotate', 'report', 'acdc', 'document']) {
    expect(lower, `${label}: the denial lists the step with "${word}"`).toContain(word)
  }
}

function expectNoValues(text: string, values: string[], label = ''): void {
  for (const value of values) {
    expect(text, `${label}: the denial holds no secret value`).not.toContain(value)
    expect(text, `${label}: the denial holds no part of a secret value`).not.toContain(value.slice(6))
  }
}

interface Denial {
  label: string
  mentions: string[]
  line?: number
  span?: number
  values: string[]
}

// A denial as AC-1 to AC-3 describe it: it names the place, lists the four steps, and shows no secret value.
function expectDenial(check: Check, denial: Denial): void {
  const reason = reasonOf(check)
  const lower = reason.toLowerCase()
  for (const mention of denial.mentions) {
    expect(lower, `${denial.label}: the denial names ${mention}`).toContain(mention.toLowerCase())
  }
  if (denial.line !== undefined) {
    const candidates = Array.from({ length: (denial.span ?? 0) + 1 }, (_, index) => String(denial.line! + index))
    expect(
      candidates.some(candidate => reason.includes(candidate)),
      `${denial.label}: the denial names the line ${candidates.join(' or ')}`
    ).toBe(true)
  }
  expectFourSteps(reason, denial.label)
  expectNoValues(reason, denial.values, denial.label)
}

interface Example {
  name: string
  shape: ShapeId
  values: string[]
  span: number
  lines: (allow: string) => string[]
}

const EXAMPLES: Example[] = [
  { name: 'private key', shape: 'private-key', values: [PRIVATE_BODY], span: 2, lines: allow => [PRIVATE_BEGIN + allow, PRIVATE_BODY, PRIVATE_END] },
  { name: 'cloud access key', shape: 'aws-access-key', values: [AWS_KEY], span: 0, lines: allow => [`aws_access_key_id = ${AWS_KEY}${allow}`] },
  { name: 'code host token', shape: 'github-token', values: [GITHUB_TOKEN], span: 0, lines: allow => [`const token = '${GITHUB_TOKEN}'${allow}`] },
  { name: 'ticket system token', shape: 'jira-token', values: [JIRA_TOKEN], span: 0, lines: allow => [`JIRA_TOKEN=${JIRA_TOKEN}${allow}`] },
]

const hitFor = (hits: Hit[], shape: ShapeId): Hit | undefined => hits.find(hit => hit.shape === shape)

test('AC-1: a commit of a staged private key is denied with the file and line, the four steps, and no key value', async () => {
  const staged = newFilePatch(FILE, contentAt(FILE_LINE, [PRIVATE_BEGIN, PRIVATE_BODY, PRIVATE_END]))
  const check = await checkCommit(fakeGit(staged, []))
  expectDenial(check, { label: 'private key', mentions: [FILE], line: FILE_LINE, span: 2, values: [PRIVATE_BODY] })
})

test('AC-1: scanPatch reports the shape and the file place of an added line, without a commit', () => {
  const hits = scanPatch(newFilePatch(FILE, contentAt(FILE_LINE, [PRIVATE_BEGIN, PRIVATE_BODY, PRIVATE_END])))
  const hit = hitFor(hits, 'private-key')
  expect(hit, 'a private-key hit').toBeDefined()
  expect(hit?.place.kind).toBe('file')
  if (hit?.place.kind === 'file') {
    expect(hit.place.path).toBe(FILE)
    expect(hit.place.commit).toBeUndefined()
    expect(hit.place.line).toBeGreaterThanOrEqual(FILE_LINE)
    expect(hit.place.line).toBeLessThanOrEqual(FILE_LINE + 2)
  }

  const single = scanPatch(newFilePatch(FILE, contentAt(FILE_LINE, [`aws_access_key_id = ${AWS_KEY}`])), SHA_A)
  expect(single.map(item => item.shape)).toContain('aws-access-key')
  expect(hitFor(single, 'aws-access-key')?.place).toEqual({ kind: 'file', commit: SHA_A, path: FILE, line: FILE_LINE })
})

test('AC-1: the line comes from the hunk header of a modified file', () => {
  const patch =
    [
      `diff --git a/${FILE} b/${FILE}`,
      'index 1111111..2222222 100644',
      `--- a/${FILE}`,
      `+++ b/${FILE}`,
      '@@ -200,2 +200,3 @@',
      ' const first = 1',
      ' const second = 2',
      `+const token = '${GITHUB_TOKEN}'`,
    ].join('\n') + '\n'
  expect(hitFor(scanPatch(patch), 'github-token')?.place).toEqual({ kind: 'file', path: FILE, line: 202 })
})

test('AC-1: denialText names each place, lists the four steps, and shows no value', () => {
  const hits: Hit[] = [
    { shape: 'github-token', place: { kind: 'file', commit: SHA_A, path: 'src/a.ts', line: 37 } },
    { shape: 'aws-access-key', place: { kind: 'message', commit: SHA_B, line: MESSAGE_LINE } },
    { shape: 'jira-token', place: { kind: 'pr-body', line: BODY_LINE } },
  ]
  const text = denialText(hits)
  const lower = text.toLowerCase()
  expect(lower).toContain('src/a.ts')
  expect(lower).toContain(SHORT_A)
  expect(lower).toContain(SHORT_B)
  expect(lower).toContain('pr body')
  expect(lower).toContain('message')
  expectFourSteps(text)
  expectNoValues(text, [GITHUB_TOKEN, AWS_KEY, JIRA_TOKEN, PRIVATE_BODY])
})

test('AC-2: a push is denied for a commit in origin/<base>..HEAD that holds a secret in a file, with the commit, file and line', async () => {
  const commits = [
    commitOf(SHA_A, 'feat: first change', CLEAN_PATCH),
    commitOf(SHA_B, 'feat: add the client', newFilePatch(FILE, contentAt(FILE_LINE, [`const token = '${GITHUB_TOKEN}'`]))),
  ]
  const check = await checkPush(fakeGit(undefined, commits), 'main')
  expectDenial(check, { label: 'file in a commit', mentions: [SHORT_B, FILE], line: FILE_LINE, values: [GITHUB_TOKEN] })

  const hits = scanPatch(commits[1]!.patch, SHA_B)
  expect(hitFor(hits, 'github-token')?.place).toEqual({ kind: 'file', commit: SHA_B, path: FILE, line: FILE_LINE })
})

test('AC-2: a secret only in a commit message is denied with the commit and the message, not a file', async () => {
  const message = ['feat: add the client', '', 'Body line 1', 'Body line 2', 'Body line 3', `token ${GITHUB_TOKEN}`].join('\n')
  expect(scanMessage(SHA_A, message)).toEqual([{ shape: 'github-token', place: { kind: 'message', commit: SHA_A, line: MESSAGE_LINE } }])

  const check = await checkPush(fakeGit(undefined, [commitOf(SHA_A, message, CLEAN_PATCH)]), 'main')
  expectDenial(check, { label: 'message', mentions: [SHORT_A, 'message'], line: MESSAGE_LINE, values: [GITHUB_TOKEN] })
  expect(reasonOf(check)).not.toContain('src/clean.ts')
})

test('AC-2: a secret that a later commit removed is still denied, with the commit that added it', async () => {
  const added = newFilePatch(FILE, contentAt(FILE_LINE, [`aws_access_key_id = ${AWS_KEY}`]))
  const removed =
    [
      `diff --git a/${FILE} b/${FILE}`,
      'index 2222222..3333333 100644',
      `--- a/${FILE}`,
      `+++ b/${FILE}`,
      `@@ -${FILE_LINE},1 +${FILE_LINE - 1},0 @@`,
      `-aws_access_key_id = ${AWS_KEY}`,
    ].join('\n') + '\n'
  expect(scanPatch(removed, SHA_B)).toEqual([])

  const check = await checkPush(fakeGit(undefined, [commitOf(SHA_A, 'feat: add a key', added), commitOf(SHA_B, 'fix: remove the key', removed)]), 'main')
  expectDenial(check, { label: 'removed later', mentions: [SHORT_A, FILE], line: FILE_LINE, values: [AWS_KEY] })
})

test('AC-2: a push cannot be checked when origin/<base> is unreadable, so it is denied and the denial names origin/<base>', async () => {
  const check = await checkPush(fakeGit(CLEAN_PATCH, undefined), 'main')
  expect(reasonOf(check).toLowerCase()).toContain('origin/main')

  const withScanner = fakeScanner()
  const second = await checkPush(fakeGit(CLEAN_PATCH, undefined), 'main', withScanner.scanner)
  expect(reasonOf(second).toLowerCase()).toContain('origin/main')
})

test('AC-1: a commit whose staged diff cannot be read is denied and the denial names the staged diff', async () => {
  const check = await checkCommit(fakeGit(undefined, []))
  expect(reasonOf(check).toLowerCase()).toContain('staged')
})

test('AC-2: scanPatch counts added lines only, not removed or context lines', () => {
  const patch =
    [
      `diff --git a/${FILE} b/${FILE}`,
      'index 1111111..2222222 100644',
      `--- a/${FILE}`,
      `+++ b/${FILE}`,
      '@@ -1,3 +1,2 @@',
      ` const kept = '${GITHUB_TOKEN}'`,
      `-const gone = '${AWS_KEY}'`,
      ' const last = 3',
    ].join('\n') + '\n'
  expect(scanPatch(patch)).toEqual([])
})

test('AC-3: gh pr create and gh pr edit with a secret in --body or --body-file are denied with the PR body and the line', async () => {
  const body = bodyAt(BODY_LINE, [`Deploy with ${GITHUB_TOKEN} please`])
  const expected = { mentions: ['pr body'], line: BODY_LINE, values: [GITHUB_TOKEN] }

  expectDenial(await checkPrBody(prCreate(body), noFiles), { label: 'create --body', ...expected })
  expectDenial(await checkPrBody(`gh pr edit 7 --body '${body}'`, noFiles), { label: 'edit --body', ...expected })

  const readFile = files({ '/tmp/pr-body.md': body })
  expectDenial(await checkPrBody('gh pr create --title t --body-file /tmp/pr-body.md', readFile), { label: 'create --body-file', ...expected })
  expectDenial(await checkPrBody('gh pr edit 7 --body-file /tmp/pr-body.md', readFile), { label: 'edit --body-file', ...expected })
})

test('AC-3: the short forms -b and -F are checked too', async () => {
  const body = bodyAt(BODY_LINE, [`key ${AWS_KEY}`])
  const expected = { mentions: ['pr body'], line: BODY_LINE, values: [AWS_KEY] }
  expectDenial(await checkPrBody(`gh pr create -t "Add feature" -b "${body}"`, noFiles), { label: '-b', ...expected })
  expectDenial(await checkPrBody('gh pr create -t t -F /tmp/pr-body.md', files({ '/tmp/pr-body.md': body })), { label: '-F', ...expected })
})

test('AC-3: a --body-file that cannot be read is denied and the denial names the file', async () => {
  const check = await checkPrBody('gh pr create --title t --body-file /tmp/missing-body.md', noFiles)
  expect(reasonOf(check)).toContain('/tmp/missing-body.md')
})

test('AC-4: each denying shape is denied in a commit, a push and a PR body, with or without an inline gitleaks:allow comment', async () => {
  for (const example of EXAMPLES) {
    for (const allow of ['', ALLOW]) {
      const label = `${example.name}${allow === '' ? '' : ' with the allow comment'}`
      const fileLines = contentAt(FILE_LINE, example.lines(allow))

      const commit = await checkCommit(fakeGit(newFilePatch(FILE, fileLines), []))
      expectDenial(commit, { label: `${label}, commit`, mentions: [FILE], line: FILE_LINE, span: example.span, values: example.values })

      const push = await checkPush(fakeGit(undefined, [commitOf(SHA_B, 'feat: add config', newFilePatch(FILE, fileLines))]), 'main')
      expectDenial(push, { label: `${label}, push`, mentions: [SHORT_B, FILE], line: FILE_LINE, span: example.span, values: example.values })

      const body = bodyAt(BODY_LINE, example.lines(allow))
      const pr = await checkPrBody(prCreate(body), noFiles)
      expectDenial(pr, { label: `${label}, PR body`, mentions: ['pr body'], line: BODY_LINE, span: example.span, values: example.values })
    }
  }
})

test('AC-4: scanPatch finds each shape by its shape id, and an inline gitleaks:allow comment changes nothing', () => {
  for (const example of EXAMPLES) {
    const plain = scanPatch(newFilePatch(FILE, contentAt(FILE_LINE, example.lines(''))))
    const allowed = scanPatch(newFilePatch(FILE, contentAt(FILE_LINE, example.lines(ALLOW))))
    expect(
      plain.map(hit => hit.shape),
      `${example.name}: shape`
    ).toContain(example.shape)
    expect(
      allowed.map(hit => hit.shape),
      `${example.name}: shape with the allow comment`
    ).toContain(example.shape)
    expect(allowed.length, `${example.name}: the same hits with the allow comment`).toBe(plain.length)
  }
})

test('AC-5: a change without a secret shape goes through a commit, a push, and gh pr create and gh pr edit', async () => {
  const cleanMessage = 'feat: add the answer\n\nNo secrets here.'
  expect(await checkCommit(fakeGit(CLEAN_PATCH, []))).toEqual({ verdict: 'pass', scanner: 'not scanned' })
  expect(await checkPush(fakeGit(undefined, [commitOf(SHA_A, cleanMessage, CLEAN_PATCH)]), 'main')).toEqual({ verdict: 'pass', scanner: 'not scanned' })

  const body = bodyAt(BODY_LINE, [`A near miss: ${NEAR_MISS_GITHUB}`, `and ${NEAR_MISS_AWS}`])
  expect((await checkPrBody(prCreate(body), noFiles)).verdict).toBe('pass')
  expect((await checkPrBody(`gh pr edit 7 --body '${body}'`, noFiles)).verdict).toBe('pass')
  expect((await checkPrBody('gh pr create --title t --body-file /tmp/pr-body.md', files({ '/tmp/pr-body.md': body }))).verdict).toBe('pass')
  expect((await checkPrBody('gh pr create --fill', noFiles)).verdict).toBe('pass')

  expect(scanPatch(CLEAN_PATCH)).toEqual([])
  expect(scanMessage(SHA_A, cleanMessage)).toEqual([])
})

test('AC-5: a command that is not gh pr create or gh pr edit passes the PR body check', async () => {
  for (const command of ['git status', 'gh pr view 1', 'gh pr checks 1', 'gh repo view']) {
    expect((await checkPrBody(command, noFiles)).verdict, command).toBe('pass')
  }
})

test('AC-6: with the scanner present and approved, a commit runs it at the pinned version with --redact and a JSON report, a hit denies, and the report is deleted', async () => {
  const args = scannerArgs(REPORT_PATH)
  expect(GITLEAKS_VERSION).toMatch(/^v?\d+\.\d+\.\d+/)
  expect(args).toContain('--redact')
  expect(args).toContain('--ignore-gitleaks-allow')
  expect(args).toContain(REPORT_PATH)
  expect(
    args.some(arg => /json/i.test(arg)),
    'a JSON report format'
  ).toBe(true)

  const run = fakeScanner({ outcome: { exitCode: 1, report: reportFor('src/vault.ts', 58) } })
  const check = await checkCommit(fakeGit(CLEAN_PATCH, []), run.scanner)
  expectDenial(check, { label: 'scanner hit on a commit', mentions: ['src/vault.ts'], line: 58, values: [GITHUB_TOKEN] })
  expect(run.scans.length).toBe(1)
  expect(run.scans[0]?.target).toBe('staged')
  expect(run.scans[0]?.args).toEqual(scannerArgs(run.scanner.reportPath))
  expect(run.removed.count, 'the report is deleted after the run').toBe(1)
})

test('AC-6: with the scanner present and approved, a push runs it over the branch, a hit denies, and the report is deleted', async () => {
  const run = fakeScanner({ outcome: { exitCode: 1, report: reportFor('src/vault.ts', 58, SHA_B) } })
  const check = await checkPush(fakeGit(undefined, [commitOf(SHA_A, 'feat: a change', CLEAN_PATCH)]), 'main', run.scanner)
  expectDenial(check, { label: 'scanner hit on a push', mentions: ['src/vault.ts'], line: 58, values: [GITHUB_TOKEN] })
  expect(run.scans.length).toBe(1)
  const target = run.scans[0]?.target
  expect(typeof target).toBe('object')
  expect(JSON.stringify(target)).toContain('main')
  expect(run.scans[0]?.args).toEqual(scannerArgs(run.scanner.reportPath))
  expect(run.removed.count, 'the report is deleted after the run').toBe(1)
})

test('AC-6: a scanner run without a hit passes as ran, and the report is deleted', async () => {
  const commitRun = fakeScanner({ outcome: { exitCode: 0 } })
  expect(await checkCommit(fakeGit(CLEAN_PATCH, []), commitRun.scanner)).toEqual({ verdict: 'pass', scanner: 'ran' })
  expect(commitRun.scans.length).toBe(1)
  expect(commitRun.removed.count).toBe(1)

  const pushRun = fakeScanner({ outcome: { exitCode: 0 } })
  expect(await checkPush(fakeGit(undefined, [commitOf(SHA_A, 'feat: a change', CLEAN_PATCH)]), 'main', pushRun.scanner)).toEqual({
    verdict: 'pass',
    scanner: 'ran',
  })
  expect(pushRun.scans.length).toBe(1)
  expect(pushRun.removed.count).toBe(1)
})

test('AC-6: the own shape checks still deny when the scanner finds nothing', async () => {
  const run = fakeScanner({ outcome: { exitCode: 0 } })
  const staged = newFilePatch(FILE, contentAt(FILE_LINE, [`const token = '${GITHUB_TOKEN}'`]))
  expectDenial(await checkCommit(fakeGit(staged, []), run.scanner), {
    label: 'own check with a scanner',
    mentions: [FILE],
    line: FILE_LINE,
    values: [GITHUB_TOKEN],
  })
})

test('AC-7: an absent, unapproved, other-version or failing scanner is "not scanned", and the own checks still pass a clean push', async () => {
  const variants: [string, ScannerSetup, boolean][] = [
    ['absent', { version: undefined }, false],
    ['not approved', { approved: false }, false],
    ['another version', { version: `${GITLEAKS_VERSION}-other` }, false],
    ['scan rejects', { outcome: 'reject' }, true],
    ['exit code 2', { outcome: { exitCode: 2 } }, true],
  ]
  for (const [name, setup, called] of variants) {
    const run = fakeScanner(setup)
    const check = await checkPush(fakeGit(undefined, [commitOf(SHA_A, 'feat: a change', CLEAN_PATCH)]), 'main', run.scanner)
    expect(check, name).toEqual({ verdict: 'pass', scanner: 'not scanned' })
    expect(scannerLine(check), name).toContain('not scanned')
    expect(run.scans.length, `${name}: scan calls`).toBe(called ? 1 : 0)
  }

  const noScanner = await checkPush(fakeGit(undefined, [commitOf(SHA_A, 'feat: a change', CLEAN_PATCH)]), 'main')
  expect(noScanner).toEqual({ verdict: 'pass', scanner: 'not scanned' })
  expect(scannerLine(noScanner)).toContain('not scanned')

  const ran = await checkPush(fakeGit(undefined, [commitOf(SHA_A, 'feat: a change', CLEAN_PATCH)]), 'main', fakeScanner().scanner)
  expect(scannerLine(ran)).not.toContain('not scanned')
})

test('AC-7: with the scanner absent or not approved, the own shape checks of a commit and a push still deny', async () => {
  const staged = newFilePatch(FILE, contentAt(FILE_LINE, [`aws_access_key_id = ${AWS_KEY}`]))
  for (const setup of [{ version: undefined }, { approved: false }] as ScannerSetup[]) {
    const run = fakeScanner(setup)
    expectDenial(await checkCommit(fakeGit(staged, []), run.scanner), { label: 'commit, scanner off', mentions: [FILE], line: FILE_LINE, values: [AWS_KEY] })
    expectDenial(await checkPush(fakeGit(undefined, [commitOf(SHA_B, 'feat: add a key', staged)]), 'main', run.scanner), {
      label: 'push, scanner off',
      mentions: [SHORT_B, FILE],
      line: FILE_LINE,
      values: [AWS_KEY],
    })
    expect(run.scans.length).toBe(0)
  }
})

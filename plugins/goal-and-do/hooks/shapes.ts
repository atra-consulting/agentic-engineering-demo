// The list file. Every pattern the secret check and the test-weakening signals use lives here, and the code owner approves each change to
// this file in the pull request. A pattern is never a secret value.

export type ShapeId = 'private-key' | 'aws-access-key' | 'azure-access-key' | 'github-token' | 'jira-token'

// Shapes found on one line. A multi-line private key block has its own patterns below.
export const LINE_SHAPES: readonly { id: Exclude<ShapeId, 'private-key'>; pattern: RegExp }[] = [
  { id: 'aws-access-key', pattern: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/ },
  { id: 'azure-access-key', pattern: /(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+\/]{43,88}={0,2}/ },
  { id: 'github-token', pattern: /(?<![A-Za-z0-9_])(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})(?![A-Za-z0-9_])/ },
  // The Atlassian prefix, and the assignment form for a Jira Data Center personal access token, which has no prefix.
  { id: 'jira-token', pattern: /ATATT3[A-Za-z0-9_=-]{24,}|(?<![A-Za-z0-9])JIRA_(?:PAT|TOKEN|API_TOKEN)\s*[=:]\s*['"]?[A-Za-z0-9_=+\/-]{20,}/ },
]

// A private key block: its begin marker anywhere on a line (after a comment mark, an assignment, an opening quote or a template literal's
// backtick), followed on the next line by a line of base64 or a header; or the block on one line with escaped line breaks.
export const PRIVATE_KEY_BEGIN = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/
export const PRIVATE_KEY_BODY = /^\s*(?:[#*\/;>-]+\s*)?(?:[A-Za-z0-9+\/]{40,}={0,2}|Proc-Type:.*|DEK-Info:.*)\s*$/
export const PRIVATE_KEY_INLINE = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----(?:\\r?\\n|\s)+[A-Za-z0-9+\/]{40,}/

// A false positive is released here, never inline. Each entry holds a path and a shape, never a value; the code owner approves each entry.
export const ALLOWLIST: readonly { path: string; shape: ShapeId }[] = []

// The optional scanner (gitleaks) runs only when the code owner has given the approval AZD rule 7 asks for. Until then it is "not scanned".
export const SCANNER_APPROVED = false

// Test files: Python test_*.py and *_test.py, JS and TS *.test.* and *.spec.*, and anything under tests/ or __tests__/.
export const PYTHON_TEST_FILE = /(?:^|\/)(?:test_[^\/]*\.py|[^\/]*_test\.py)$/
export const JS_TEST_FILE = /\.(?:test|spec)\.[^\/]+$/
export const TEST_DIR = /(?:^|\/)(?:tests|__tests__)\//

export const RUNNER_CONFIG = /(?:^|\/)(?:pytest\.ini|tox\.ini|setup\.cfg|(?:jest|vitest)\.config\.[^\/]+)$/
export const SETUP_FILE = /(?:^|\/)(?:conftest\.py|(?:jest|vitest)\.setup\.[^\/]+|setup[-_]?tests?\.[^\/]+)$/i

export const SKIP_MARKERS: readonly RegExp[] = [
  /pytest\.mark\.skip(?![A-Za-z0-9_])/,
  /unittest\.skip(?![A-Za-z0-9_])/,
  /(?<![\w.])(?:it|describe)\.skip(?![A-Za-z0-9_])/,
  /(?<![\w.])xit\s*\(/,
]

// New dependencies come from these manifests.
export const REQUIREMENTS_FILE = /^requirements[\w.-]*\.txt$/
export const REQUIREMENTS_LINE = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9._,-]+\])?\s*(?:[=<>!~]=?|@|;|$)/
export const PACKAGE_JSON_LINE =
  /^\s*"(@?[A-Za-z0-9][\w.\/-]*)"\s*:\s*"(?:[~^<>=]*\s*\d[^"]*|\*|latest|next|(?:workspace|npm|file|link|github|git\+[a-z]+|https?):[^"]*)"\s*,?\s*$/
export const PYPROJECT_LIST_LINE = /^\s*["'][A-Za-z0-9][A-Za-z0-9._-]*(?:\[[A-Za-z0-9._,-]+\])?\s*(?:(?:===?|~=|!=|<=?|>=?)[^"',;]*)?(?:;[^"']*)?["']\s*,?\s*$/
export const PYPROJECT_TABLE_LINE = /^\s*([A-Za-z0-9][\w.-]*)\s*=\s*"(?:[~^<>=]*\s*)?\d[^"]*"\s*$/
export const NON_DEPENDENCY_KEYS: ReadonlySet<string> = new Set([
  'version',
  'name',
  'description',
  'main',
  'module',
  'types',
  'typings',
  'type',
  'license',
  'author',
  'homepage',
  'node',
  'npm',
  'packageManager',
  'python',
  'requires-python',
])

// Personal-data shapes: e-mail, a phone number as + and 8 to 15 digits, an IBAN (country prefix, length and mod-97 checksum).
export const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
export const PHONE = /(?<![\w+])\+\d{8,15}(?!\d)/g
export const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g

export const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AT: 20,
  BE: 16,
  BG: 22,
  CH: 21,
  CY: 28,
  CZ: 24,
  DE: 22,
  DK: 18,
  EE: 20,
  ES: 24,
  FI: 18,
  FR: 27,
  GB: 22,
  GR: 27,
  HR: 21,
  HU: 28,
  IE: 22,
  IS: 26,
  IT: 27,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  MC: 27,
  MT: 31,
  NL: 18,
  NO: 15,
  PL: 28,
  PT: 25,
  RO: 24,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  TR: 26,
}

export function isIban(text: string): boolean {
  const compact = text.replace(/ /g, '').toUpperCase()
  const length = IBAN_LENGTHS[compact.slice(0, 2)]
  if (length === undefined || compact.length < length) return false
  const iban = compact.slice(0, length)
  let remainder = 0
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

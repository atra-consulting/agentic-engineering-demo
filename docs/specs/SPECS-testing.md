# SPECS-testing.md — CRM Testing Approach

Testing for this project is split across two stacks: Playwright API tests for the backend and Jasmine/Karma unit tests for the frontend.

---

## Cross-references

- Endpoint details, route auth, error shapes → `SPECS-backend.md`
- Entity schemas, fixture row counts, SQLite quirks → `SPECS-database.md`
- Component behavior, service contracts, guard logic → `SPECS-frontend.md`
- Starting the app, ports, `start.sh` → `SPECS-infrastructure.md`

---

## Backend Tests — @playwright/test

### Framework and location

- **Runner:** `@playwright/test` 1.52 — the only backend test runner
- **Test directory:** `backend/src/test/` — directory and files exist; the first spec files have been written
- **Config:** `backend/playwright.config.ts` — exists at the repo root of the backend package
- **Base URL:** `http://localhost:7070`
- **Parallelism:** `fullyParallel: false`, `workers: 1` — tests run serially to avoid SQLite write conflicts

### Test database isolation

The suite never touches the dev database (`backend/data/crmdb.sqlite`). `backend/src/config/db.ts` picks `crmdb.test.sqlite` when `NODE_ENV=test` and no `TURSO_DATABASE_URL` is set. `globalSetup.ts` sets `NODE_ENV=test` on the spawned backend, and `playwright.config.ts` sets it on the runner process too — spec files import the DB `client` directly, so both sides must point at the same file. On CI/Turso (`TURSO_DATABASE_URL` set), that remote DB is used and the file logic is skipped.

### Run commands

```bash
cd backend && npx playwright test          # full suite
cd backend && npm test                     # alias (maps to "playwright test" in package.json)
cd backend && npx playwright test src/test/<file>.spec.ts   # single file
cd backend && npx playwright test -g "<test title>"          # targeted by title
```

### Global setup

`backend/src/test/globalSetup.ts` runs before the suite:
1. Kills any existing process on port 7070.
2. Deletes the test DB file (`crmdb.test.sqlite` plus `-journal`/`-wal`/`-shm` sidecars) so each run starts fresh and fully seeded. Skipped when `TURSO_DATABASE_URL` is set. Never touches `crmdb.sqlite`.
3. Spawns the backend child process (`tsx src/index.ts`) with `NODE_ENV=test`, a fixed `AGENT_API_TOKEN` (exported as `TEST_AGENT_TOKEN`), and `AGENT_AUTH_ALLOW_LOOPBACK=1` — this bypasses the agent-token check for requests from localhost during the test run, so tests hitting agent-token-gated routes without a token from a loopback context may see a different status (e.g. 404 instead of 401) than a real deployment would return.
4. Polls `GET /api/health` until the backend responds (30 s deadline).
5. Returns a teardown function that SIGTERM-kills the backend.

### Authentication

#### Standard login (password-based)

POST `/api/auth/login` with `{ benutzername, passwort }`. On success, the server sets a `JSESSIONID` session cookie. Playwright's `APIRequestContext` stores the cookie automatically.

```ts
// helpers.ts — loginCtx()
const ctx = await playwrightRequest.newContext({ baseURL: 'http://localhost:7070' });
await ctx.post('/api/auth/login', { data: { benutzername: 'admin', passwort: 'admin123' } });
// ctx now carries the JSESSIONID cookie; reuse it across all tests in a describe block
```

#### Passwordless test-login helper

`POST /api/auth/test-login` accepts `{ benutzername }` with no password. It creates a valid session for the named user. Available only when `NODE_ENV !== 'production'`; returns 404 in production.

This endpoint is intended for test speed when the test cares about session state but not about the login flow itself. The standard login endpoint is used when the login flow is under test.

**Note:** No current test uses `POST /api/auth/test-login`. All existing tests authenticate via the password-based `loginCtx()` helper. The endpoint remains available for future tests where password validation is out of scope.

#### Session reuse pattern

Create one `APIRequestContext` per user role in `test.beforeAll`, log in once, and reuse the context across all tests in the suite. Dispose in `test.afterAll`.

```ts
let adminCtx: APIRequestContext;
let anonCtx: APIRequestContext;

test.beforeAll(async () => {
  adminCtx = await loginCtx('admin', 'admin123');  // helper from helpers.ts
  anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
});

test.afterAll(async () => {
  await adminCtx.dispose();
  await anonCtx.dispose();
});
```

### Authorization fixtures

Three hardcoded users (defined in `backend/src/config/users.ts`):

| Username | Password  | Roles   |
|----------|-----------|---------|
| admin    | admin123  | ADMIN   |
| user     | test123   | USER    |
| demo     | demo1234  | ADMIN   |

Roles are stored bare in `users.ts` (`ADMIN` / `USER`); the auth wire format prefixes them (`ROLE_ADMIN`). Only `user` lacks the ADMIN role — use it to test `requireRole('ADMIN')` 403 paths.

All three currently hold the full 7-permission set (`FIRMEN`, `PERSONEN`, `ABTEILUNGEN`, `ADRESSEN`, `AKTIVITAETEN`, `CHANCEN`, `BENUTZERVERWALTUNG`). When a new permission is added that not all users hold, test the 403 path with the user who lacks it. If no such user exists yet, document the gap in the test file rather than fabricating credentials.

### Shared helpers (`backend/src/test/helpers.ts`)

| Helper | Purpose |
|--------|---------|
| `loginCtx(benutzername, passwort)` | Creates a new `APIRequestContext` and logs in; returns the context with cookie. |
| `login(request, benutzername, passwort)` | Logs in on an existing context. |
| `resetDatabase()` | Deletes all rows in reverse FK order (including `szenario`), then re-seeds CRM data via `runDataMigration()`, agent tasks via `seedAgentTasks()` (fixed IDs 1–23), and the Standard-Szenario via `seedSzenario()` (id=1). |

### SQLite quirks in tests

- **Dates:** stored and returned as ISO-8601 text strings. Assert with string equality, not `Date` equality.
- **Monetary values:** stored as REAL. Use `toBeCloseTo` for computed amounts where floating-point drift is possible.
- **`@libsql/client` is async:** every raw DB call `await`s `client.execute(...)` / `client.batch(...)` inside helpers — no synchronous better-sqlite3 calls.
- **Foreign keys:** `PRAGMA foreign_keys = ON` is set once at startup in `config/migrate.ts` (standalone `execute`, never inside a batch). The `resetDatabase()` helper temporarily disables it with `OFF` for the bulk delete, then re-enables it.

### Fixture row counts

Seeded by `backend/src/seed/fixture.json` when the database is empty. These are the counts in the fixture file (verified against the actual file):

| Entity      | Rows |
|-------------|------|
| Firma       | 25   |
| Abteilung   | 50   |
| Person      | 100  |
| Adresse     | 100  |
| Aktivitaet  | 75   |
| Chance      | 40   |

No Gehalt or Vertrag seed rows exist in the fixture.

### What to test (backend)

For every route added or changed in `backend/src/routes/*.ts`:

1. **Happy path** — valid input, expected status code, expected response shape
2. **Authorization** — unauthenticated request returns 401; wrong role/permission returns 403
3. **Validation** — missing required fields, invalid types, and boundary values return 400 with a `fieldErrors` object
4. **Not found** — unknown id returns 404 with the standard error body
5. **Side effects** — for write routes, verify the mutation actually persisted (re-fetch the record)

For services, test through the HTTP route boundary unless the service logic is too complex or isolated to reach that way.

### Test file conventions

- One file per route file: `backend/src/test/<entity>.spec.ts`
- Group with `test.describe`; set up contexts in `test.beforeAll`/`test.beforeEach`
- Use `test.step(...)` for multi-phase tests to make failure output readable
- One assertion per behavior; do not bundle unrelated `expect` calls in one `test` block
- Clean up created rows in `afterAll` — or call `resetDatabase()` in `beforeAll` and accept that the suite is mutation-safe only when run in isolation

### Error response shape

All error responses follow:
```json
{ "status": 404, "message": "...", "timestamp": "...", "fieldErrors": { } }
```
`fieldErrors` is present on 400 validation errors (keyed by field name). See `middleware/errorHandler.ts`.

### Pagination response shape

```json
{ "content": [...], "totalElements": 25, "totalPages": 3, "size": 10, "number": 0, "first": true, "last": false }
```
`number` is 0-indexed. See `SPECS-backend.md` for sort and pagination parameter details.

### Existing test files

| File | Routes / concerns covered |
|------|--------------------------|
| `auth.spec.ts` | POST `/api/auth/login`, GET `/api/auth/me`, POST `/api/auth/logout` |
| `firmen-crud.spec.ts` | GET/POST/PUT/DELETE `/api/firmen` and `/api/firmen/:id` |
| `adressen-coords.spec.ts` | GET/POST/PUT `/api/adressen` — latitude/longitude fields |
| `adressen-typ.spec.ts` | GET/POST/PUT `/api/adressen` — `typ` field (WORK, HOME, null) |
| `adressen-search.spec.ts` | GET `/api/adressen?search=<term>` — city substring match, case-insensitive, empty-result handling, anon 401 |
| `aktivitaeten-crud.spec.ts` | GET `/api/aktivitaeten` (paginated) and `/all`, POST/PUT/DELETE `/api/aktivitaeten/:id` — full CRUD, `datum` DESC sort, 404 on unknown id, anon 401 |
| `agentTasks.spec.ts` | GET `/api/agent-tasks/next`, POST `/:id/reject`, POST `/:id/done`, GET `/api/agent-tasks`, GET `/api/agent-tasks/summary`, POST `/api/agent-tasks/reset`; derived ticketId on GET /:id — linked/unlinked, newest-ticket-wins tie-break, cleared to null by POST /api/tickets/reset |
| `agentTaskSeed.spec.ts` | `seedAgentTasks()` idempotency — 23 fixed-ID rows survive repeated seeding; per-source counts (7 EMAIL / 4 GITHUB_ISSUE / 6 APP_LOG / 6 ERROR_REPORT); row 23's title/subject/body (Chancen-Notiz) verified against the exported `AGENT_TASK_SEED` constant; separately, the one-time corrective UPDATE that converges an already-seeded row 23 from the old English title to German is verified against the live DB — convergence, idempotent no-op on a second call, a human-renamed title survives untouched, and a DONE row keeps status/resolvedAt/comment (only `title` is corrected) |
| `chancen-phase-filter.spec.ts` | GET `/api/chancen?phase=<value>` — per-phase filtering and invalid-phase 400 |
| `chancen-search.spec.ts` | GET `/api/chancen?search=<term>` — case-insensitive title search, combined search+phase filter |
| `cron.spec.ts` | GET `/api/cron/agent-tasks`, POST `/api/cron/runs/:id/complete`, GET `/api/cron/runs`, GET `/api/cron/jobs` |
| `health.spec.ts` | GET `/api/health` — status, timestamp, version fields |
| `personen-filter.spec.ts` | GET `/api/personen?abteilungId=<id>` — department filter, combined abteilungId+search |
| `sessions-persistence.spec.ts` | Session row creation on login, cross-request persistence, DB row deletion on logout |
| `szenario.spec.ts` | GET/POST/PUT/DELETE `/api/szenarien` and `/:id` — CRUD, works/waits JSON round-trip, structural (variable-length) step-count validation (1–50 works per process, waits = works−1, cross-field check) and duration-bound validation, optional `names` array validation (length match, 200-char cap), legacy 19/19/11/2 shape with no `names` accepted on POST and PUT, duplicate-name 409, seeded Standard-Szenario (id=1) |
| `ticketAgentTaskIdMigration.spec.ts` | Guarded `ticket.agentTaskId` column migration (`ensureTicketAgentTaskIdColumn`/`alterTicketAddAgentTaskIdColumn`) — repeat-call safety, duplicate-column ALTER swallowed, narrow re-throw on a genuinely different SQL error, full `runMigrations()` ordering-regression guard that recovers a simulated pre-fix DB (index + column both dropped), fresh-DB column shape (nullable, no DEFAULT), seeded rows read `agentTaskId = null` |
| `tickets.spec.ts` | Kanban lifecycle across `/api/tickets` — `/next`, `/:id/start`, `/:id/done`, `/:id/ask`, `/:id/comments`, `/:id/wont-do`, PATCH `/:id/status` and `/:id/owner`, POST `/api/tickets`, `/:id/hand-to-ai`, `/board`, `/summary`, `/reset` — auth matrix: agent-token-or-admin-session on start/done/ask/status/owner/comments/create; agent-token-or-authenticated-session (any logged-in role, no admin required) on board/GET :id; `/next` stays agent-token-only (GET-based CSRF surface); summary and list (GET /) widened to plain requireAuth (any role, no agent-token path); agentTaskId (link to app feedback, REQ-207) — create default/null/valid-id/unknown-id(400)/non-integer(400), round-trip across GET /:id, list, /board, /next, untouched by all 8 write endpoints |

---

## Frontend Tests — Jasmine / Karma

### Framework and location

- **Runner:** Jasmine 5 + Karma 6 (Angular CLI default via `@angular/build:karma` builder)
- **Config:** `frontend/tsconfig.spec.json` exists. `frontend/karma.conf.js` does **not** exist — the Angular build builder configures Karma directly from `angular.json` without a separate `karma.conf.js`.
- **Test files:** colocated with source — `foo.component.spec.ts` lives next to `foo.component.ts`

### Run commands

```bash
cd frontend && npx ng test                 # watch mode (development)
cd frontend && npm test                    # alias (maps to "ng test")
cd frontend && npm run test:ci             # single CI run — watch=false, ChromeHeadlessNoSandbox (preferred)
```

The `test:ci` script maps to `ng test --configuration=ci`. The `ci` configuration in `angular.json` sets `watch: false`, `progress: false`, and `browsers: ChromeHeadlessNoSandbox` (not `ChromeHeadless`).

### What to test (frontend)

For every new **component**:
1. Component instantiates without errors (`expect(component).toBeTruthy()`)
2. Template renders the correct data for given inputs (`fixture.detectChanges()` + DOM query)
3. User interactions (click, form submit) trigger the expected service method or emit the expected output
4. `@if`/`@for` branches render correct content for each state (loading, data, empty, error)
5. Edit-mode forms populate via `patchValue()` when the route provides an `id` param

For every new **service**:
1. HTTP methods call the right URL with the right body/params — use `HttpTestingController`
2. Pagination index conversion is correct (NgbPagination is 1-indexed, backend is 0-indexed: component passes `this.currentPage - 1` to the service)
3. Error responses are surfaced/handled as documented

For every new **guard**:
1. Returns `true` when the user has the required permission or role
2. Redirects (and returns `false`) when permission is missing
3. Redirects when `currentUser` is null (unauthenticated)
4. When a route's `canActivate` array changes (guard added, removed, or swapped), add a routing-composition test in `<feature>.routes.spec.ts`: pull the actual guard function out of the route's `canActivate` array and execute it via `TestBed.runInInjectionContext(...)` against a mocked `AuthService`, asserting the allow/deny outcome. Never compare guard factories (e.g. `roleGuard('ROLE_ADMIN')`) by identity or `toEqual` — each call returns a new closure, so two separately-created guards are never reference-equal. For a route where the guard was removed, assert `canActivate` is empty/absent instead. See `features/admin/admin.routes.spec.ts`.

### TestBed setup for standalone components

Angular 21 components are standalone by default. Tests import the component under test directly, not a module wrapper:

```ts
await TestBed.configureTestingModule({
  imports: [SidebarComponent],            // standalone component imports itself
  providers: [
    provideRouter([]),
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: AuthService, useValue: mockAuthService },
  ],
}).compileComponents();
```

Provide `HttpClientTestingModule` (or `provideHttpClient()` + `provideHttpClientTesting()`) for any component or service that makes HTTP calls. Never let real HTTP requests escape in unit tests.

### Dependency injection in tests

Angular 21 uses `inject()` inside components. Override dependencies via TestBed providers:

```ts
const userSignal = signal<BenutzerInfo | null>(null);
mockAuthService = { currentUser: userSignal };
{ provide: AuthService, useValue: mockAuthService }
```

For components using `inject()` that cannot be overridden by a provider, use `TestBed.overrideComponent`.

### Angular 21 template patterns

- Only `@if`, `@for`, `@switch` in templates — never `*ngIf`/`*ngFor`
- Every `@for` block requires a `track` expression
- Use `fakeAsync` + `tick()` for observables and timers; avoid real delays

### Key test locations

| Concern | Path |
|---------|------|
| Feature components | `frontend/src/app/features/<entity>/` |
| Models | `frontend/src/app/core/models/` |
| Services | `frontend/src/app/core/services/` |
| Guards | `frontend/src/app/core/guards/` |

### Existing spec files

| File (path relative to `frontend/src/app/`) | Covers |
|---------------------------------------------|--------|
| `core/services/layout.service.spec.ts` | `LayoutService` (collapsed signal, localStorage persistence, toggle) |
| `core/services/agent-task.service.spec.ts` | `AgentTaskService` HTTP methods and URL shapes |
| `core/services/cron.service.spec.ts` | `CronService` HTTP methods and URL shapes |
| `core/services/person.service.spec.ts` | `PersonService` — pagination index conversion, HTTP calls |
| `core/services/szenario.service.spec.ts` | `SzenarioService` — CRUD HTTP methods and URL shapes |
| `core/services/ticket.service.spec.ts` | `TicketService` — board/summary/CRUD HTTP methods, query params, status/owner transitions |
| `core/models/prozess-defaults.spec.ts` | `prozess-defaults` constants — canonical duration arrays, process metadata (titles, step counts, labels), role/minute splits |
| `core/pipes/markdown.pipe.spec.ts` | `MarkdownPipe` — markdown-to-HTML rendering (headings, lists, inline code, bold, plain text) |
| `shared/pipes/dauer.pipe.spec.ts` | `DauerPipe` / `minutenZuDauer` — minutes-to-duration formatting (d/h/m breakdown), null handling |
| `core/guards/role.guard.spec.ts` | `roleGuard` (allow with matching role, deny with wrong role, deny when null) |
| `layout/sidebar/sidebar.component.spec.ts` | `SidebarComponent` (render, permission filtering, collapse toggle) |
| `features/firma/firma-list/firma-list.component.spec.ts` | `FirmaListComponent` — render, data binding, interactions |
| `features/person/person-list/person-list.component.spec.ts` | `PersonListComponent` — render, data binding, interactions |
| `features/aktivitaet/aktivitaet-list/aktivitaet-list.component.spec.ts` | `AktivitaetListComponent` — render, data binding, interactions |
| `features/chance/chance-list/chance-list.component.spec.ts` | `ChanceListComponent` — render, data binding, interactions |
| `features/admin/admin.routes.spec.ts` | `ADMIN_ROUTES` guard composition — confirms `cron`, `agent-tasks`, `agent-tasks/:id` still redirect a `ROLE_USER` session away (guard function executed via `TestBed.runInInjectionContext`, not compared by identity); confirms `tickets`, `tickets/:id` now carry no `canActivate` guard |
| `features/admin/agent-tasks/agent-task-detail.component.spec.ts` | `AgentTaskDetailComponent` — detail view, `statusBadgeClass()`, ticket cross-link (renders Ticket #<id> link only when ticketId is set) |
| `features/admin/agent-tasks/agent-task-list.component.spec.ts` | `AgentTaskListComponent` — list view, source param, `statusBadgeClass()` |
| `features/admin/agent-tasks/agent-tasks-dashboard.component.spec.ts` | `AgentTasksDashboardComponent` — summary and per-source views |
| `features/admin/cron/cron-dashboard.component.spec.ts` | `CronDashboardComponent` — ngOnInit, pagination, runNow() |
| `features/admin/tickets/ticket-board.component.spec.ts` | `TicketBoardComponent` — board loading, drag-and-drop status transitions with rollback, badge helpers, recentOnly ("Kürzlich geändert") filter toggle with sessionStorage persistence, .ticket-number (#<id>) badge on each card |
| `features/admin/tickets/ticket-detail.component.spec.ts` | `TicketDetailComponent` — detail view, comment/hand-back-to-AI flow, "Won't Do" and owner-toggle actions, agent-task cross-link (renders App-Feedback #<id> link only when agentTaskId is set) |
| `features/produktivitaet/einheit.spec.ts` | Zeiteinheit helpers — `einheitZuFaktor`, `feldWertZuMinuten`, `maxWertFuerEinheit`, `durationValidatorsFor`, round-trip conversion |
| `features/produktivitaet/rechner.component.spec.ts` | `RechnerComponent` — productivity calculator: unit conversion, scenario load/save, role/pie/flowchart derivations, Prozessvergleich bar filter (barLimit) with sessionStorage persistence (explicit-toggle-only, not incidental widening), step add/remove (floor/cap, worked-example wait rule, role-array parity, focus management, polite live region), step rename, per-step role picker (agile tabs only), scenario-load rebuild-to-length |
| `features/produktivitaet/svg-util.spec.ts` | SVG utility functions — `computeSegments` (0-minute-work floor width, 150-unit reserve cap, zero-total fallback to equal-width segments), `computeComparisonBars`, `computePieSlices` |

### Code standards (both stacks)

- Strict TypeScript — no `any`
- One behavior per `it(...)` / `test(...)` block
- Descriptive describe/it text that reads as documentation
- Spies and mocks reset between tests (`afterEach`)
- For backend: clean up created rows in `afterAll` or mark the suite as relying on `resetDatabase()`
- For frontend: `afterEach(() => httpMock.verify())` to confirm no outstanding HTTP requests

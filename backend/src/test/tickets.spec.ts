/**
 * Playwright API tests for the tickets routes.
 *
 * Covers (PRD-KANBAN-TICKET-SYSTEM):
 *   GET  /api/tickets/next            — claim, type filter, 204 exhausted
 *   POST /api/tickets/:id/done        — happy path, 409 wrong state, 404 missing
 *   POST /api/tickets/:id/ask         — happy path, 400 empty question, 409 wrong state
 *   POST /api/tickets/:id/comments    — add HUMAN comment, handBackToAi flow
 *   POST /api/tickets/:id/wont-do     — owner=HUMAN only, 409 on owner=AI
 *   PATCH /api/tickets/:id/status     — drag-drop semantics, solution management
 *   PATCH /api/tickets/:id/owner      — flip owner only
 *   POST /api/tickets                 — create defaults (status=DEFINITION, owner=HUMAN)
 *   POST /api/tickets/:id/hand-to-ai  — DEFINITION → owner=AI, status=TODO (admin only)
 *   GET  /api/tickets                 — paginated list + filters (incl. status=DEFINITION)
 *   GET  /api/tickets/:id             — detail with comments
 *   GET  /api/tickets/board           — five-column board with commentCount (incl. DEFINITION)
 *   GET  /api/tickets/summary         — counts by status/type/owner/solution (incl. DEFINITION)
 *   POST /api/tickets/reset           — deletes and reseeds 12 tickets
 *   fullyReady (create) / clearFullyReady (comments) — ADD-FULLY-READY-FLAG:
 *     boolean create default/passthrough/validation, boolean round-trip typing
 *     across all read endpoints, clearFullyReady clear/no-op/idempotent,
 *     atomicity with handBackToAi, untouched by all 7 non-write endpoints.
 *     Migration tests for the underlying column live in
 *     ticketFullyReadyMigration.spec.ts, not here.
 *   agentTaskId (create) — TICKET-UI-LINK-FIXES: optional nullable link to
 *     the app-feedback item (agent_task) a ticket was filed from. Create
 *     default/explicit-null/valid-id/unknown-id(400)/non-integer(400), round
 *     -trip typing across GET /:id, the paginated list, /board, and /next,
 *     and untouched by all 8 write endpoints (REQ-207), including
 *     POST /:id/comments. Migration tests for the underlying column live in
 *     ticketAgentTaskIdMigration.spec.ts, not here. Reverse-direction tests
 *     (agent-task.ticketId, "newest ticket wins") live in agentTasks.spec.ts.
 *
 * Authorization matrix:
 *   - Agent-token-or-admin endpoints (/:id/start, /:id/done, /:id/ask, create,
 *     /:id, /:id/owner, /:id/comments, /board, /:id/status): agent token,
 *     loopback bypass, or admin session (first match wins). A wrong token is
 *     still rejected (401) regardless of loopback/session. /:id/start,
 *     /:id/done, and /:id/ask were widened from agent-token-only to this
 *     matrix so an admin session (not just a headless skill or the agent
 *     token) can also start/finish/ask on a ticket already claimed via
 *     /next. /board and /:id/status were widened from admin-only to this
 *     matrix so a skill can read the board / move a ticket without an admin
 *     login.
 *   - Agent-token-only endpoint: /next. It was briefly widened the same way
 *     as /:id/start, /:id/done, and /:id/ask, then REVERTED back to
 *     requireAgentToken after a review flagged it as a GET-based CSRF
 *     surface — an admin session alone (no CSRF protection on a simple GET)
 *     must not be able to claim a ticket.
 *   - Admin-only endpoints (summary, list, /:id/wont-do, /:id/hand-to-ai,
 *     reset): require ADMIN role (user=USER gets 403)
 *
 * Seeded state (after POST /reset or fresh DB):
 *   Ids 1-12. DEFINITION + owner=HUMAN: 1,2,3,4,5 (5 tickets, all FEATURE), each
 *   with 1 seeded AGENT comment.
 *   TODO + owner=AI: 6,8,10,11,12 (5 tickets; 8,10=CHORE, rest=FEATURE), no
 *   seeded comments.
 *   ON_HOLD + owner=HUMAN: 7,9 (2 tickets, FEATURE), each with 1 seeded AGENT
 *   comment (7 seeded comments total across 1,2,3,4,5,7,9).
 *   All solution=null.
 */
import { test, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { loginCtx } from './helpers.js';
import { TEST_AGENT_TOKEN } from './globalSetup.js';

const BASE_URL = 'http://localhost:7070';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TicketComment {
  id: number;
  ticketId: number;
  author: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

interface Ticket {
  id: number;
  owner: string;
  type: string;
  title: string;
  body: string;
  status: string;
  solution: string | null;
  fullyReady: boolean;
  // Nullable link back to the app-feedback item (agent_task) this ticket was
  // filed from — set only at create time (REQ-207). See the agentTaskId
  // suites near the end of this file.
  agentTaskId: number | null;
  pickedUpAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  comments: TicketComment[];
}

interface TicketListItem {
  id: number;
  owner: string;
  type: string;
  title: string;
  status: string;
  solution: string | null;
  fullyReady: boolean;
  agentTaskId: number | null;
  commentCount: number;
}

interface TicketBoard {
  DEFINITION: TicketListItem[];
  TODO: TicketListItem[];
  IN_PROGRESS: TicketListItem[];
  ON_HOLD: TicketListItem[];
  DONE: TicketListItem[];
}

interface TicketSummary {
  byStatus: Record<string, number>;
  byType: Record<string, number>;
  byOwner: Record<string, number>;
  bySolution: Record<string, number>;
}

interface PageResult<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  first: boolean;
  last: boolean;
}

interface ErrorBody {
  status: number;
  message: string;
  timestamp: string;
  fieldErrors: Record<string, string>;
}

// ─── Context factories ────────────────────────────────────────────────────────

async function agentCtx(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${TEST_AGENT_TOKEN}` },
  });
}

async function anonCtx(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL });
}

async function wrongTokenCtx(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { Authorization: 'Bearer wrong-token-for-tickets' },
  });
}

// ─── Ticket reset helper ──────────────────────────────────────────────────────

/**
 * Reset ticket state via the API endpoint.
 * Requires an admin context. Asserts 200 so tests fail clearly if reset breaks.
 */
async function resetTickets(admin: APIRequestContext): Promise<void> {
  const resp = await admin.post('/api/tickets/reset');
  if (resp.status() !== 200) {
    throw new Error(`POST /api/tickets/reset failed: ${resp.status()} ${await resp.text()}`);
  }
}

// ─── Shared fixture: fullyReady:true ticket for cross-suite reuse ────────────
//
// Set by the "create with fullyReady: true" test in the POST /api/tickets
// suite below. The atomicity test in the "POST /:id/comments —
// clearFullyReady flag" suite immediately after it reuses this exact ticket
// id rather than creating a fresh one — see that test for why the fixture
// must literally be the same row. No suite between the two calls
// resetTickets(), so the row survives untouched until reused.
let fullyReadyCreateFixtureId: number;

// ─── Suite: Auth matrix — agent endpoints ────────────────────────────────────

test.describe('Auth matrix — agent endpoints', () => {
  let anon: APIRequestContext;
  let wrong: APIRequestContext;
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    anon = await anonCtx();
    wrong = await wrongTokenCtx();
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterAll(async () => {
    await anon.dispose();
    await wrong.dispose();
    await admin.dispose();
  });

  // GET /next
  test('GET /next without token from localhost → 200 (localhost bypass)', async () => {
    const resp = await anon.get('/api/tickets/next');
    expect(resp.status()).toBe(200);
  });

  test('GET /next with wrong token → 401', async () => {
    const resp = await wrong.get('/api/tickets/next');
    expect(resp.status()).toBe(401);
  });

  // POST /:id/done — use ticket 8 (still TODO+AI; ticket 6 was claimed by GET /next above)
  test('POST /:id/done without token from localhost → 409 (auth bypassed, ticket not IN_PROGRESS)', async () => {
    // Ticket 8 is still TODO (only ticket 6 was claimed by the GET /next test).
    // 409 confirms auth was bypassed and the business-state guard fired.
    const resp = await anon.post('/api/tickets/8/done', { data: {} });
    expect(resp.status()).toBe(409);
  });

  test('POST /:id/done with wrong token → 401', async () => {
    const resp = await wrong.post('/api/tickets/8/done', { data: {} });
    expect(resp.status()).toBe(401);
  });

  // POST /:id/ask — ticket 6 is now IN_PROGRESS (claimed by GET /next above)
  test('POST /:id/ask without token from localhost → 200 (auth bypassed, ticket IN_PROGRESS)', async () => {
    // Ticket 6 is IN_PROGRESS after the GET /next test claimed it.
    // 200 confirms auth was bypassed and the endpoint is reachable.
    const resp = await anon.post('/api/tickets/6/ask', { data: { question: 'What?' } });
    expect(resp.status()).toBe(200);
  });

  test('POST /:id/ask with wrong token → 401', async () => {
    const resp = await wrong.post('/api/tickets/6/ask', { data: { question: 'What?' } });
    expect(resp.status()).toBe(401);
  });
});

// ─── Suite: Auth matrix — admin session on widened agent endpoints ───────────
//
// /:id/start, /:id/done, and /:id/ask were widened from requireAgentToken to
// requireAgentTokenOrAdminSession: agent token, loopback bypass, or admin
// session (first match wins).
//
// GET /next was widened the same way but has since been REVERTED back to
// requireAgentToken (agent-token-only) after a review flagged it as a
// GET-based CSRF surface — a bare admin session (no CSRF protection on a
// simple GET) must not be able to claim a ticket. The /next tests below
// assert that reverted, agent-token-only behavior, not a widening.
//
// IMPORTANT: this test environment sets AGENT_AUTH_ALLOW_LOOPBACK=1, and the
// loopback bypass fires FIRST — purely on remoteAddress plus the absence of
// an auth/forwarding header — before the middleware ever reaches the
// agent-token/admin-session check. A plain admin-context call from localhost
// would therefore return 200 regardless of which auth branch is configured,
// proving nothing. Every test below sends 'X-Forwarded-For' to disable the
// loopback bypass (same pattern as src/test/agentTasks.spec.ts:220-234 and
// :295-301), so the results here genuinely exercise the auth branch under
// test rather than the loopback bypass.
//
// Regression coverage for the agent-token happy path lives in the
// 'GET /api/tickets/next', 'POST /api/tickets/:id/done',
// 'POST /api/tickets/:id/ask', and 'POST /api/tickets/:id/start' suites
// below; the wrong-token → 401 case is covered in 'Auth matrix — agent
// endpoints' above (and again in the ':id/start' suite), so neither is
// duplicated here.
test.describe('Auth matrix — admin session on widened agent endpoints', () => {
  const NO_LOOPBACK_HEADERS = { 'X-Forwarded-For': '10.0.0.1' };

  let admin: APIRequestContext;
  let anon: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    anon = await anonCtx();
  });

  test.afterEach(async () => {
    await admin.dispose();
    await anon.dispose();
  });

  // ── GET /next (reverted to agent-token-only — GET-based CSRF surface) ───────

  test('GET /next with admin session + X-Forwarded-For (loopback bypass disabled) → 401 (admin session no longer accepted, reverted to agent-token-only)', async () => {
    const resp = await admin.get('/api/tickets/next', { headers: NO_LOOPBACK_HEADERS });
    expect(resp.status()).toBe(401);
  });

  test('GET /next without session + X-Forwarded-For (loopback bypass disabled) → 401 (negative control)', async () => {
    const resp = await anon.get('/api/tickets/next', { headers: NO_LOOPBACK_HEADERS });
    expect(resp.status()).toBe(401);
  });

  // ── POST /:id/start ─────────────────────────────────────────────────────────

  test('POST /:id/start with admin session + X-Forwarded-For (loopback bypass disabled) → 200, drives TODO+AI ticket to IN_PROGRESS', async () => {
    // Ticket 6 is TODO+AI after reset.
    const resp = await admin.post('/api/tickets/6/start', { data: {}, headers: NO_LOOPBACK_HEADERS });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;
    await test.step('status is IN_PROGRESS', () => { expect(body.status).toBe('IN_PROGRESS'); });
    await test.step('owner remains AI', () => { expect(body.owner).toBe('AI'); });
  });

  test('POST /:id/start without session + X-Forwarded-For (loopback bypass disabled) → 401 (negative control)', async () => {
    const resp = await anon.post('/api/tickets/6/start', { data: {}, headers: NO_LOOPBACK_HEADERS });
    expect(resp.status()).toBe(401);
  });

  // ── POST /:id/done ──────────────────────────────────────────────────────────

  test('POST /:id/done with admin session + X-Forwarded-For (loopback bypass disabled) → 200 on an IN_PROGRESS ticket', async () => {
    // Drive ticket 6 to IN_PROGRESS via the admin session first, same header
    // set throughout so the whole chain runs on the admin-session branch.
    const startResp = await admin.post('/api/tickets/6/start', { data: {}, headers: NO_LOOPBACK_HEADERS });
    expect(startResp.status()).toBe(200);
    const started = await startResp.json() as Ticket;
    expect(started.status).toBe('IN_PROGRESS');

    const resp = await admin.post('/api/tickets/6/done', { data: {}, headers: NO_LOOPBACK_HEADERS });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;
    await test.step('status is DONE', () => { expect(body.status).toBe('DONE'); });
    await test.step('solution is DONE', () => { expect(body.solution).toBe('DONE'); });
  });

  test('POST /:id/done without session + X-Forwarded-For (loopback bypass disabled) → 401 (negative control)', async () => {
    // Drive ticket 6 to IN_PROGRESS via the admin session (same header) first,
    // so the anon call below hits the auth guard rather than a 409 wrong-state.
    const startResp = await admin.post('/api/tickets/6/start', { data: {}, headers: NO_LOOPBACK_HEADERS });
    expect(startResp.status()).toBe(200);

    const resp = await anon.post('/api/tickets/6/done', { data: {}, headers: NO_LOOPBACK_HEADERS });
    expect(resp.status()).toBe(401);
  });

  // ── POST /:id/ask ───────────────────────────────────────────────────────────

  test('POST /:id/ask with admin session + X-Forwarded-For (loopback bypass disabled) → 200 on an IN_PROGRESS ticket', async () => {
    const startResp = await admin.post('/api/tickets/6/start', { data: {}, headers: NO_LOOPBACK_HEADERS });
    expect(startResp.status()).toBe(200);

    const resp = await admin.post('/api/tickets/6/ask', {
      data: { question: 'Admin-session question — is this reachable now?' },
      headers: NO_LOOPBACK_HEADERS,
    });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;
    await test.step('status is ON_HOLD', () => { expect(body.status).toBe('ON_HOLD'); });
    await test.step('owner is HUMAN', () => { expect(body.owner).toBe('HUMAN'); });
  });

  test('POST /:id/ask without session + X-Forwarded-For (loopback bypass disabled) → 401 (negative control)', async () => {
    const startResp = await admin.post('/api/tickets/6/start', { data: {}, headers: NO_LOOPBACK_HEADERS });
    expect(startResp.status()).toBe(200);

    const resp = await anon.post('/api/tickets/6/ask', {
      data: { question: 'Should be rejected before reaching the service.' },
      headers: NO_LOOPBACK_HEADERS,
    });
    expect(resp.status()).toBe(401);
  });
});

// ─── Suite: Auth matrix — admin endpoints ────────────────────────────────────

test.describe('Auth matrix — admin endpoints', () => {
  let anon: APIRequestContext;
  let user: APIRequestContext;
  let agent: APIRequestContext;
  let wrongToken: APIRequestContext;
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    anon = await anonCtx();
    user = await loginCtx('user', 'test123');
    agent = await agentCtx();
    wrongToken = await wrongTokenCtx();
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterAll(async () => {
    await anon.dispose();
    await user.dispose();
    await agent.dispose();
    await wrongToken.dispose();
    await admin.dispose();
  });

  // GET /board — widened (commit ff92664) to requireAgentTokenOrAdminSession:
  // agent token, loopback bypass, or admin session (first match wins). These
  // three assertions previously expected 401/403 back when /board was
  // admin-session-only; updated here to match the widened middleware, mirroring
  // the pattern already used below for POST / and GET /:id.
  test('GET /board without session → 200 (loopback bypass)', async () => {
    const resp = await anon.get('/api/tickets/board');
    expect(resp.status()).toBe(200);
  });

  test('GET /board with USER role → 200 (loopback bypass)', async () => {
    const resp = await user.get('/api/tickets/board');
    expect(resp.status()).toBe(200);
  });

  test('GET /board with agent token → 200', async () => {
    const resp = await agent.get('/api/tickets/board');
    expect(resp.status()).toBe(200);
  });

  test('GET /board with wrong token → 401', async () => {
    const resp = await wrongToken.get('/api/tickets/board');
    expect(resp.status()).toBe(401);
  });

  // GET /summary — NOT widened; still requireAuth + requireRole('ADMIN') only.
  test('GET /summary without session → 401', async () => {
    const resp = await anon.get('/api/tickets/summary');
    expect(resp.status()).toBe(401);
  });

  test('GET /summary with USER role → 403', async () => {
    const resp = await user.get('/api/tickets/summary');
    expect(resp.status()).toBe(403);
  });

  test('GET /summary with wrong agent token (no session) → 401 (regression guard: still admin-only, unaffected by the /board and /:id/status auth widening)', async () => {
    const resp = await wrongToken.get('/api/tickets/summary');
    expect(resp.status()).toBe(401);
  });

  // POST /reset
  test('POST /reset without session → 401', async () => {
    const resp = await anon.post('/api/tickets/reset');
    expect(resp.status()).toBe(401);
  });

  test('POST /reset with USER role → 403', async () => {
    const resp = await user.post('/api/tickets/reset');
    expect(resp.status()).toBe(403);
  });

  // GET /
  test('GET / without session → 401', async () => {
    const resp = await anon.get('/api/tickets');
    expect(resp.status()).toBe(401);
  });

  test('GET / with USER role → 403', async () => {
    const resp = await user.get('/api/tickets');
    expect(resp.status()).toBe(403);
  });

  // POST / (create) — loopback bypass / agent token active in test environment.
  // 401/403 only enforced in production (no loopback, no token).
  test('POST / without session → 201 (loopback bypass)', async () => {
    const resp = await anon.post('/api/tickets', { data: { type: 'FEATURE', title: 'T', body: 'B' } });
    expect(resp.status()).toBe(201);
  });

  test('POST / with USER role → 201 (loopback bypass)', async () => {
    const resp = await user.post('/api/tickets', { data: { type: 'FEATURE', title: 'T', body: 'B' } });
    expect(resp.status()).toBe(201);
  });

  test('POST / with agent token → 201', async () => {
    const resp = await agent.post('/api/tickets', { data: { type: 'FEATURE', title: 'T', body: 'B' } });
    expect(resp.status()).toBe(201);
  });

  test('POST / with wrong token → 401', async () => {
    const resp = await wrongToken.post('/api/tickets', { data: { type: 'FEATURE', title: 'T', body: 'B' } });
    expect(resp.status()).toBe(401);
  });

  // GET /:id — loopback bypass active in test environment; 401/403 only enforced in production
  test('GET /:id without session → 200 (loopback bypass)', async () => {
    const resp = await anon.get('/api/tickets/1');
    expect(resp.status()).toBe(200);
  });

  test('GET /:id with USER role → 200 (loopback bypass)', async () => {
    const resp = await user.get('/api/tickets/1');
    expect(resp.status()).toBe(200);
  });

  // PATCH /:id/status — widened (commit ff92664) to requireAgentTokenOrAdminSession:
  // agent token, loopback bypass, or admin session (first match wins). These
  // assertions previously expected 401/403 back when /:id/status was
  // admin-session-only; updated here to match the widened middleware, mirroring
  // the pattern already used below for PATCH /:id/owner.
  test('PATCH /:id/status without session → 200 (loopback bypass)', async () => {
    const resp = await anon.patch('/api/tickets/1/status', { data: { status: 'TODO' } });
    expect(resp.status()).toBe(200);
  });

  test('PATCH /:id/status with USER role → 200 (loopback bypass)', async () => {
    const resp = await user.patch('/api/tickets/1/status', { data: { status: 'TODO' } });
    expect(resp.status()).toBe(200);
  });

  test('PATCH /:id/status with agent token → 200', async () => {
    const resp = await agent.patch('/api/tickets/1/status', { data: { status: 'TODO' } });
    expect(resp.status()).toBe(200);
  });

  test('PATCH /:id/status with wrong token → 401', async () => {
    const resp = await wrongToken.patch('/api/tickets/1/status', { data: { status: 'TODO' } });
    expect(resp.status()).toBe(401);
  });

  // PATCH /:id/owner — loopback bypass / agent token active in test environment.
  // 401/403 only enforced in production (no loopback, no token).
  test('PATCH /:id/owner without session → 200 (loopback bypass)', async () => {
    const resp = await anon.patch('/api/tickets/1/owner', { data: { owner: 'AI' } });
    expect(resp.status()).toBe(200);
  });

  test('PATCH /:id/owner with USER role → 200 (loopback bypass)', async () => {
    const resp = await user.patch('/api/tickets/1/owner', { data: { owner: 'AI' } });
    expect(resp.status()).toBe(200);
  });

  test('PATCH /:id/owner with agent token → 200', async () => {
    const resp = await agent.patch('/api/tickets/1/owner', { data: { owner: 'HUMAN' } });
    expect(resp.status()).toBe(200);
  });

  test('PATCH /:id/owner with wrong token → 401', async () => {
    const resp = await wrongToken.patch('/api/tickets/1/owner', { data: { owner: 'AI' } });
    expect(resp.status()).toBe(401);
  });

  // POST /:id/wont-do
  test('POST /:id/wont-do without session → 401', async () => {
    const resp = await anon.post('/api/tickets/7/wont-do', { data: {} });
    expect(resp.status()).toBe(401);
  });

  test('POST /:id/wont-do with USER role → 403', async () => {
    const resp = await user.post('/api/tickets/7/wont-do', { data: {} });
    expect(resp.status()).toBe(403);
  });

  // POST /:id/comments — loopback bypass / agent token active in test environment.
  // 401/403 only enforced in production (no loopback, no token).
  test('POST /:id/comments without session → 200 (loopback bypass)', async () => {
    const resp = await anon.post('/api/tickets/1/comments', { data: { body: 'Hello' } });
    expect(resp.status()).toBe(200);
  });

  test('POST /:id/comments with USER role → 200 (loopback bypass)', async () => {
    const resp = await user.post('/api/tickets/1/comments', { data: { body: 'Hello' } });
    expect(resp.status()).toBe(200);
  });

  test('POST /:id/comments with agent token → 200', async () => {
    const resp = await agent.post('/api/tickets/1/comments', { data: { body: 'Hello from agent' } });
    expect(resp.status()).toBe(200);
  });

  test('POST /:id/comments with wrong token → 401', async () => {
    const resp = await wrongToken.post('/api/tickets/1/comments', { data: { body: 'Hello' } });
    expect(resp.status()).toBe(401);
  });
});

// ─── Suite: GET /api/tickets/next ────────────────────────────────────────────

test.describe('GET /api/tickets/next', () => {
  let agent: APIRequestContext;
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    agent = await agentCtx();
  });

  test.afterAll(async () => {
    await agent.dispose();
    await admin.dispose();
  });

  test('claims oldest TODO+owner=AI ticket, returns 200 with IN_PROGRESS status', async () => {
    // After reset: tickets 6,8,10,11,12 are TODO+AI. Oldest by createdAt is ticket 6.
    const resp = await agent.get('/api/tickets/next');

    await test.step('status 200', () => {
      expect(resp.status()).toBe(200);
    });

    const body = await resp.json() as Ticket;

    await test.step('status flipped to IN_PROGRESS', () => {
      expect(body.status).toBe('IN_PROGRESS');
    });

    await test.step('owner remains AI', () => {
      expect(body.owner).toBe('AI');
    });

    await test.step('pickedUpAt is set (non-empty ISO string)', () => {
      expect(typeof body.pickedUpAt).toBe('string');
      expect((body.pickedUpAt as string).length).toBeGreaterThan(0);
    });

    await test.step('oldest eligible ticket (id=6) is claimed first', () => {
      expect(body.id).toBe(6);
    });

    await test.step('response includes comments array', () => {
      expect(Array.isArray(body.comments)).toBe(true);
    });
  });

  test('second call returns next distinct TODO+AI ticket', async () => {
    // This test depends on the previous test having claimed ticket 6 (IN_PROGRESS).
    // The suite uses beforeAll (not beforeEach), so state persists between tests.
    // After reset: ids 6,8,10,11,12 are TODO+AI ordered by createdAt ASC.
    // First test claimed id=6. This call must claim id=8 (next oldest).
    const resp = await agent.get('/api/tickets/next');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    // Seed order: ticket 8 is the second-oldest TODO+AI ticket after ticket 6 is claimed.
    expect(body.id).toBe(8);
    expect(body.status).toBe('IN_PROGRESS');
  });

  test('type=CHORE filter claims a CHORE ticket', async () => {
    // Reset first to guarantee a clean slate independent of prior claims in this suite.
    // After reset: tickets 8 and 10 are both TODO+AI+CHORE; oldest by createdAt is ticket 8.
    await resetTickets(admin);
    const resp = await agent.get('/api/tickets/next?type=CHORE');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.type).toBe('CHORE');
    expect(body.id).toBe(8); // oldest TODO+AI CHORE ticket (8 before 10)
    expect(body.status).toBe('IN_PROGRESS');
  });

  test('returns 204 when no eligible TODO+AI ticket remains of requested type', async () => {
    // Reset then claim both TODO+AI+CHORE tickets (8, then 10) — two CHORE tickets
    // are seeded now, so both must be drained before 204 is returned.
    await resetTickets(admin);
    await agent.get('/api/tickets/next?type=CHORE'); // claim 8 (oldest)
    await agent.get('/api/tickets/next?type=CHORE'); // claim 10 (last CHORE ticket)
    const resp = await agent.get('/api/tickets/next?type=CHORE');
    expect(resp.status()).toBe(204);
  });

  test('invalid type value → 400 with fieldErrors.type', async () => {
    const resp = await agent.get('/api/tickets/next?type=NOPE');
    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    await test.step('fieldErrors.type present', () => {
      expect(typeof body.fieldErrors?.['type']).toBe('string');
    });
  });

  test('ON_HOLD+owner=HUMAN tickets are never claimed by /next', async () => {
    // After reset, tickets 7, 9 are ON_HOLD+HUMAN. They must never be returned.
    await resetTickets(admin);

    // Drain all 5 TODO+AI tickets (6,8,10,11,12)
    for (let i = 0; i < 5; i++) {
      await agent.get('/api/tickets/next');
    }

    // Next call must return 204, not one of the HUMAN tickets
    const resp = await agent.get('/api/tickets/next');
    expect(resp.status()).toBe(204);
  });

  test('DEFINITION tickets are never claimed by /next (only TODO+AI is claimable)', async () => {
    await resetTickets(admin);

    // Fresh ticket is HUMAN+DEFINITION, never TODO+AI.
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Should not be claimable', body: 'Still in DEFINITION.' },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    expect(created.status).toBe('DEFINITION');

    // Drain all 5 seeded TODO+AI tickets (6,8,10,11,12).
    for (let i = 0; i < 5; i++) {
      const resp = await agent.get('/api/tickets/next');
      expect(resp.status()).toBe(200);
      const claimed = await resp.json() as Ticket;
      expect(claimed.id).not.toBe(created.id);
    }

    // Next call must return 204 — the DEFINITION ticket must never surface here.
    const resp = await agent.get('/api/tickets/next');
    expect(resp.status()).toBe(204);

    // The DEFINITION ticket is untouched.
    const persisted = await (await admin.get(`/api/tickets/${created.id}`)).json() as Ticket;
    expect(persisted.status).toBe('DEFINITION');
    expect(persisted.owner).toBe('HUMAN');
  });
});

// ─── Suite: POST /api/tickets/:id/done ───────────────────────────────────────

test.describe('POST /api/tickets/:id/done', () => {
  let agent: APIRequestContext;
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    agent = await agentCtx();
  });

  test.afterEach(async () => {
    await agent.dispose();
    await admin.dispose();
  });

  test('done from IN_PROGRESS → status DONE, solution DONE, resolvedAt set', async () => {
    // Claim ticket 1 first
    const claimResp = await agent.get('/api/tickets/next');
    expect(claimResp.status()).toBe(200);
    const claimed = await claimResp.json() as Ticket;

    const resp = await agent.post(`/api/tickets/${claimed.id}/done`, { data: {} });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;

    await test.step('status is DONE', () => { expect(body.status).toBe('DONE'); });
    await test.step('solution is DONE', () => { expect(body.solution).toBe('DONE'); });
    await test.step('resolvedAt is set', () => {
      expect(typeof body.resolvedAt).toBe('string');
      expect((body.resolvedAt as string).length).toBeGreaterThan(0);
    });

    // Side-effect: re-fetch and confirm persisted fields match mutation response
    const persisted = await (await admin.get(`/api/tickets/${claimed.id}`)).json() as Ticket;
    await test.step('persisted status is DONE', () => { expect(persisted.status).toBe('DONE'); });
    await test.step('persisted solution is DONE', () => { expect(persisted.solution).toBe('DONE'); });
    await test.step('persisted resolvedAt matches response', () => {
      expect(persisted.resolvedAt).toBe(body.resolvedAt);
    });
  });

  test('done with optional comment → AGENT comment stored in thread', async () => {
    const claimResp = await agent.get('/api/tickets/next');
    const claimed = await claimResp.json() as Ticket;

    const resp = await agent.post(`/api/tickets/${claimed.id}/done`, {
      data: { comment: 'Implemented successfully' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('comment appears in thread', () => {
      const agentComments = body.comments.filter((c) => c.author === 'AGENT');
      const found = agentComments.some((c) => c.body === 'Implemented successfully');
      expect(found).toBe(true);
    });
  });

  test('done on a TODO ticket (not IN_PROGRESS) → 409', async () => {
    // Ticket 6 is TODO+AI after reset, not IN_PROGRESS
    const resp = await agent.post('/api/tickets/6/done', { data: {} });
    expect(resp.status()).toBe(409);
  });

  test('done on an ON_HOLD ticket → 409', async () => {
    // Ticket 7 is ON_HOLD+HUMAN after reset
    const resp = await agent.post('/api/tickets/7/done', { data: {} });
    expect(resp.status()).toBe(409);
  });

  test('done on unknown id → 404', async () => {
    const resp = await agent.post('/api/tickets/99999/done', { data: {} });
    expect(resp.status()).toBe(404);
  });

  test('done on a 409-state ticket does NOT create an orphan comment', async () => {
    // Ticket 6 is TODO (not IN_PROGRESS) → will yield 409
    const before = await (await admin.get('/api/tickets/6')).json() as Ticket;
    const commentCountBefore = before.comments.length;

    const resp = await agent.post('/api/tickets/6/done', { data: { comment: 'orphan?' } });
    expect(resp.status()).toBe(409);

    const after = await (await admin.get('/api/tickets/6')).json() as Ticket;
    expect(after.comments.length).toBe(commentCountBefore);
  });
});

// ─── Suite: POST /api/tickets/:id/ask ────────────────────────────────────────

test.describe('POST /api/tickets/:id/ask', () => {
  let agent: APIRequestContext;
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    agent = await agentCtx();
  });

  test.afterEach(async () => {
    await agent.dispose();
    await admin.dispose();
  });

  test('ask from IN_PROGRESS → ON_HOLD, owner=HUMAN, AGENT comment created', async () => {
    // Claim a ticket first
    const claimResp = await agent.get('/api/tickets/next');
    expect(claimResp.status()).toBe(200);
    const claimed = await claimResp.json() as Ticket;

    const resp = await agent.post(`/api/tickets/${claimed.id}/ask`, {
      data: { question: 'What format should the output be?' },
    });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;

    await test.step('status is ON_HOLD', () => { expect(body.status).toBe('ON_HOLD'); });
    await test.step('owner is HUMAN', () => { expect(body.owner).toBe('HUMAN'); });
    await test.step('AGENT comment with question is in the thread', () => {
      const agentComment = body.comments.find(
        (c) => c.author === 'AGENT' && c.body === 'What format should the output be?',
      );
      expect(agentComment).toBeDefined();
    });

    // Side-effect: re-fetch and confirm persisted fields match mutation response
    const persisted = await (await admin.get(`/api/tickets/${claimed.id}`)).json() as Ticket;
    await test.step('persisted status is ON_HOLD', () => { expect(persisted.status).toBe('ON_HOLD'); });
    await test.step('persisted owner is HUMAN', () => { expect(persisted.owner).toBe('HUMAN'); });
    await test.step('persisted AGENT comment present', () => {
      const agentComment = persisted.comments.find(
        (c) => c.author === 'AGENT' && c.body === 'What format should the output be?',
      );
      expect(agentComment).toBeDefined();
    });
  });

  test('ask with empty question → 400 with fieldErrors.question', async () => {
    const claimResp = await agent.get('/api/tickets/next');
    const claimed = await claimResp.json() as Ticket;

    const resp = await agent.post(`/api/tickets/${claimed.id}/ask`, {
      data: { question: '' },
    });

    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    await test.step('fieldErrors.question present', () => {
      expect(typeof body.fieldErrors?.['question']).toBe('string');
    });
  });

  test('ask with missing question field → 400', async () => {
    const claimResp = await agent.get('/api/tickets/next');
    const claimed = await claimResp.json() as Ticket;

    const resp = await agent.post(`/api/tickets/${claimed.id}/ask`, { data: {} });
    expect(resp.status()).toBe(400);
  });

  test('ask on a TODO ticket (not IN_PROGRESS) → 409', async () => {
    // Ticket 6 is TODO after reset
    const resp = await agent.post('/api/tickets/6/ask', {
      data: { question: 'What format?' },
    });
    expect(resp.status()).toBe(409);
  });

  test('ask on an ON_HOLD ticket → 409', async () => {
    // Ticket 7 is ON_HOLD
    const resp = await agent.post('/api/tickets/7/ask', {
      data: { question: 'Another question?' },
    });
    expect(resp.status()).toBe(409);
  });

  test('ask on unknown id → 404', async () => {
    const resp = await agent.post('/api/tickets/99999/ask', {
      data: { question: 'Does this exist?' },
    });
    expect(resp.status()).toBe(404);
  });

  test('ask on a 409-state ticket does NOT create an orphan comment', async () => {
    // Ticket 6 is TODO (not IN_PROGRESS) → will yield 409
    const before = await (await admin.get('/api/tickets/6')).json() as Ticket;
    const commentCountBefore = before.comments.length;

    const resp = await agent.post('/api/tickets/6/ask', {
      data: { question: 'Orphan question?' },
    });
    expect(resp.status()).toBe(409);

    const after = await (await admin.get('/api/tickets/6')).json() as Ticket;
    expect(after.comments.length).toBe(commentCountBefore);
  });
});

// ─── Suite: End-to-end answer/handback flow ───────────────────────────────────

test.describe('Answer/handback flow: claim → ask → answer → re-claim', () => {
  let agent: APIRequestContext;
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    agent = await agentCtx();
  });

  test.afterAll(async () => {
    await agent.dispose();
    await admin.dispose();
  });

  test('full lifecycle returns correct state and comment thread at each step', async () => {
    // Step 1: claim ticket 1 (oldest TODO+AI)
    const claimResp = await agent.get('/api/tickets/next');
    expect(claimResp.status()).toBe(200);
    const claimed = await claimResp.json() as Ticket;
    const ticketId = claimed.id;

    await test.step('claimed ticket is IN_PROGRESS, owner=AI', () => {
      expect(claimed.status).toBe('IN_PROGRESS');
      expect(claimed.owner).toBe('AI');
    });

    // Step 2: ask — hands back to human
    const askResp = await agent.post(`/api/tickets/${ticketId}/ask`, {
      data: { question: 'Which CSV delimiter should we use?' },
    });
    expect(askResp.status()).toBe(200);
    const afterAsk = await askResp.json() as Ticket;

    await test.step('after ask: ON_HOLD, owner=HUMAN', () => {
      expect(afterAsk.status).toBe('ON_HOLD');
      expect(afterAsk.owner).toBe('HUMAN');
    });

    await test.step('after ask: AGENT comment with question in thread', () => {
      const agentComment = afterAsk.comments.find(
        (c) => c.author === 'AGENT' && c.body === 'Which CSV delimiter should we use?',
      );
      expect(agentComment).toBeDefined();
    });

    // Step 3: human answers with handBackToAi=true
    const answerResp = await admin.post(`/api/tickets/${ticketId}/comments`, {
      data: { body: 'Use semicolon for German Excel compatibility.', handBackToAi: true },
    });
    expect(answerResp.status()).toBe(200);
    const afterAnswer = await answerResp.json() as Ticket;

    await test.step('after handback: status=TODO, owner=AI', () => {
      expect(afterAnswer.status).toBe('TODO');
      expect(afterAnswer.owner).toBe('AI');
    });

    await test.step('after handback: solution cleared', () => {
      expect(afterAnswer.solution).toBeNull();
    });

    await test.step('after handback: HUMAN comment in thread', () => {
      const humanComment = afterAnswer.comments.find(
        (c) => c.author === 'HUMAN' && c.body === 'Use semicolon for German Excel compatibility.',
      );
      expect(humanComment).toBeDefined();
    });

    // Step 4: re-claim via /next — must include full thread oldest-first
    // First reset claimed tickets so this specific one is available again without draining all
    // (ticketId is TODO+AI again after handback)
    const reclaimResp = await agent.get('/api/tickets/next');
    expect(reclaimResp.status()).toBe(200);
    const reclaimed = await reclaimResp.json() as Ticket;

    await test.step('re-claimed ticket is the same ticket (id matches)', () => {
      expect(reclaimed.id).toBe(ticketId);
    });

    await test.step('re-claimed ticket is IN_PROGRESS', () => {
      expect(reclaimed.status).toBe('IN_PROGRESS');
    });

    await test.step('re-claimed pickedUpAt is a non-empty string', () => {
      expect(typeof reclaimed.pickedUpAt).toBe('string');
      expect((reclaimed.pickedUpAt as string).length).toBeGreaterThan(0);
    });

    await test.step('full comment thread returned oldest-first', () => {
      expect(reclaimed.comments.length).toBeGreaterThanOrEqual(2);
      // First comment should be the AGENT question
      const firstComment = reclaimed.comments[0];
      expect(firstComment.author).toBe('AGENT');
      // Second should be HUMAN answer
      const secondComment = reclaimed.comments[1];
      expect(secondComment.author).toBe('HUMAN');
    });

    await test.step('comments are oldest-first (ascending createdAt)', () => {
      for (let i = 1; i < reclaimed.comments.length; i++) {
        const prev = reclaimed.comments[i - 1].createdAt;
        const curr = reclaimed.comments[i].createdAt;
        expect(prev <= curr).toBe(true);
      }
    });
  });
});

// ─── Suite: POST /api/tickets/:id/wont-do ────────────────────────────────────

test.describe('POST /api/tickets/:id/wont-do', () => {
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  test('wont-do on owner=HUMAN ticket → DONE, solution=WONT_DO, resolvedAt set', async () => {
    // Ticket 7 is ON_HOLD+HUMAN after reset
    const resp = await admin.post('/api/tickets/7/wont-do', { data: {} });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;
    await test.step('status is DONE', () => { expect(body.status).toBe('DONE'); });
    await test.step('solution is WONT_DO', () => { expect(body.solution).toBe('WONT_DO'); });
    await test.step('resolvedAt is set', () => {
      expect(typeof body.resolvedAt).toBe('string');
      expect((body.resolvedAt as string).length).toBeGreaterThan(0);
    });

    // Side-effect: re-fetch and confirm persisted fields match mutation response
    const persisted = await (await admin.get('/api/tickets/7')).json() as Ticket;
    await test.step('persisted status is DONE', () => { expect(persisted.status).toBe('DONE'); });
    await test.step('persisted solution is WONT_DO', () => { expect(persisted.solution).toBe('WONT_DO'); });
    await test.step('persisted resolvedAt matches response', () => {
      expect(persisted.resolvedAt).toBe(body.resolvedAt);
    });
  });

  test('wont-do with optional comment → HUMAN comment stored', async () => {
    const resp = await admin.post('/api/tickets/7/wont-do', {
      data: { comment: 'Descoped for this release.' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    const humanComment = body.comments.find(
      (c) => c.author === 'HUMAN' && c.body === 'Descoped for this release.',
    );
    expect(humanComment).toBeDefined();
  });

  test('wont-do on owner=AI ticket → 409 with status field in error body', async () => {
    // Ticket 6 is TODO+AI after reset
    const resp = await admin.post('/api/tickets/6/wont-do', { data: {} });
    expect(resp.status()).toBe(409);
    const body = await resp.json() as ErrorBody;
    expect(body.status).toBe(409);
  });

  test('wont-do on already-DONE ticket → 409', async () => {
    // Mark ticket 7 as wont-do first
    const first = await admin.post('/api/tickets/7/wont-do', { data: {} });
    expect(first.status()).toBe(200);

    // Try again on the now-DONE ticket
    const second = await admin.post('/api/tickets/7/wont-do', { data: {} });
    expect(second.status()).toBe(409);
  });

  test('wont-do on unknown id → 404', async () => {
    const resp = await admin.post('/api/tickets/99999/wont-do', { data: {} });
    expect(resp.status()).toBe(404);
  });

  test('no agent endpoint for wont-do — agent token returns 401 (no session)', async () => {
    const agent = await agentCtx();
    const resp = await agent.post('/api/tickets/7/wont-do', { data: {} });
    // agent context has no session cookie → 401
    expect(resp.status()).toBe(401);
    await agent.dispose();
  });
});

// ─── Suite: PATCH /api/tickets/:id/status ────────────────────────────────────

test.describe('PATCH /api/tickets/:id/status', () => {
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  test('move to IN_PROGRESS → status changed, owner unchanged', async () => {
    // Ticket 6 is TODO+AI after reset
    const resp = await admin.patch('/api/tickets/6/status', { data: { status: 'IN_PROGRESS' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.status).toBe('IN_PROGRESS');
    expect(body.owner).toBe('AI'); // owner never changed
    expect(body.solution).toBeNull();

    // Side-effect: re-fetch and confirm persisted status
    const persisted = await (await admin.get('/api/tickets/6')).json() as Ticket;
    expect(persisted.status).toBe('IN_PROGRESS');
    expect(persisted.owner).toBe('AI');
  });

  test('move into DONE → status=DONE, solution=DONE, resolvedAt set', async () => {
    // Ticket 6 is TODO+AI after reset
    const resp = await admin.patch('/api/tickets/6/status', { data: { status: 'DONE' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('status is DONE', () => { expect(body.status).toBe('DONE'); });
    await test.step('solution is DONE', () => { expect(body.solution).toBe('DONE'); });
    await test.step('resolvedAt is set', () => {
      expect(typeof body.resolvedAt).toBe('string');
      expect((body.resolvedAt as string).length).toBeGreaterThan(0);
    });
    await test.step('owner unchanged', () => { expect(body.owner).toBe('AI'); });
  });

  test('move out of DONE → solution cleared, resolvedAt cleared', async () => {
    // Ticket 6 is TODO+AI after reset. First move to DONE
    await admin.patch('/api/tickets/6/status', { data: { status: 'DONE' } });

    // Then drag back out to IN_PROGRESS
    const resp = await admin.patch('/api/tickets/6/status', { data: { status: 'IN_PROGRESS' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('status is IN_PROGRESS', () => { expect(body.status).toBe('IN_PROGRESS'); });
    await test.step('solution cleared', () => { expect(body.solution).toBeNull(); });
    await test.step('resolvedAt cleared', () => { expect(body.resolvedAt).toBeNull(); });
    await test.step('owner unchanged', () => { expect(body.owner).toBe('AI'); });
  });

  test('move a HUMAN-owned ticket to DONE → solution=DONE, owner stays HUMAN', async () => {
    // Ticket 7 is ON_HOLD+HUMAN
    const resp = await admin.patch('/api/tickets/7/status', { data: { status: 'DONE' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.status).toBe('DONE');
    expect(body.solution).toBe('DONE');
    expect(body.owner).toBe('HUMAN'); // owner never changed
  });

  test('invalid status value → 400 with fieldErrors.status', async () => {
    const resp = await admin.patch('/api/tickets/1/status', { data: { status: 'BOGUS' } });
    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    await test.step('fieldErrors.status present', () => {
      expect(typeof body.fieldErrors?.['status']).toBe('string');
    });
  });

  test('unknown id → 404', async () => {
    const resp = await admin.patch('/api/tickets/99999/status', { data: { status: 'TODO' } });
    expect(resp.status()).toBe(404);
  });

  test('PATCH status DEFINITION → TODO (drag-drop) keeps owner unchanged', async () => {
    // Fresh ticket starts as HUMAN+DEFINITION.
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Ready ticket', body: 'Should move to TODO.' },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    expect(created.status).toBe('DEFINITION');
    expect(created.owner).toBe('HUMAN');

    const resp = await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('status is TODO', () => { expect(body.status).toBe('TODO'); });
    await test.step('owner is still HUMAN', () => { expect(body.owner).toBe('HUMAN'); });
    await test.step('solution is null', () => { expect(body.solution).toBeNull(); });

    // Side-effect: re-fetch and confirm persisted state
    const persisted = await (await admin.get(`/api/tickets/${created.id}`)).json() as Ticket;
    await test.step('persisted status is TODO', () => { expect(persisted.status).toBe('TODO'); });
    await test.step('persisted owner is still HUMAN', () => { expect(persisted.owner).toBe('HUMAN'); });
  });

  test('drag any ticket back into DEFINITION (drop target) → status=DEFINITION', async () => {
    // Ticket 6 is TODO+AI after reset. DEFINITION is a valid drop target for all columns.
    const resp = await admin.patch('/api/tickets/6/status', { data: { status: 'DEFINITION' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.status).toBe('DEFINITION');
    expect(body.owner).toBe('AI'); // owner never changed by PATCH /status
    expect(body.solution).toBeNull();
  });

  test('agent token: move TODO+AI ticket 6 to DEFINITION → 200, status=DEFINITION', async () => {
    // /:id/status was widened (commit ff92664) to accept an agent token so a
    // skill can move a ticket to any column without an admin login.
    // Ticket 6 is TODO+AI after reset (beforeEach above resets before this test).
    const agent = await agentCtx();

    const resp = await agent.patch('/api/tickets/6/status', { data: { status: 'DEFINITION' } });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;
    await test.step('status is DEFINITION', () => { expect(body.status).toBe('DEFINITION'); });
    await test.step('owner unchanged (AI)', () => { expect(body.owner).toBe('AI'); });
    await test.step('solution is null', () => { expect(body.solution).toBeNull(); });

    // Side-effect: re-fetch and confirm persisted state (via the admin session,
    // which continues to work per the auth widening).
    const persisted = await (await admin.get('/api/tickets/6')).json() as Ticket;
    await test.step('persisted status is DEFINITION', () => { expect(persisted.status).toBe('DEFINITION'); });
    await test.step('persisted owner is still AI', () => { expect(persisted.owner).toBe('AI'); });

    await agent.dispose();
    // No manual restore needed — this describe's beforeEach resets before every
    // test, including whichever test runs next.
  });
});

// ─── Suite: PATCH /api/tickets/:id/owner ─────────────────────────────────────

test.describe('PATCH /api/tickets/:id/owner', () => {
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  test('flip AI → HUMAN: owner changes, status and solution unchanged', async () => {
    // Ticket 6 is TODO+AI after reset
    const resp = await admin.patch('/api/tickets/6/owner', { data: { owner: 'HUMAN' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.owner).toBe('HUMAN');
    expect(body.status).toBe('TODO'); // status unchanged
    expect(body.solution).toBeNull();

    // Side-effect: re-fetch and confirm persisted owner
    const persisted = await (await admin.get('/api/tickets/6')).json() as Ticket;
    expect(persisted.owner).toBe('HUMAN');
    expect(persisted.status).toBe('TODO');
  });

  test('flip HUMAN → AI: owner changes', async () => {
    // Ticket 7 is HUMAN-owned
    const resp = await admin.patch('/api/tickets/7/owner', { data: { owner: 'AI' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.owner).toBe('AI');
    expect(body.status).toBe('ON_HOLD'); // status unchanged
  });

  test('invalid owner value → 400 with fieldErrors.owner', async () => {
    const resp = await admin.patch('/api/tickets/1/owner', { data: { owner: 'ROBOT' } });
    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    await test.step('fieldErrors.owner present', () => {
      expect(typeof body.fieldErrors?.['owner']).toBe('string');
    });
  });

  test('unknown id → 404', async () => {
    const resp = await admin.patch('/api/tickets/99999/owner', { data: { owner: 'AI' } });
    expect(resp.status()).toBe(404);
  });
});

// ─── Suite: POST /api/tickets (create) ───────────────────────────────────────

test.describe('POST /api/tickets', () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  test('create with valid payload → 201, owner=HUMAN, status=DEFINITION, solution=null', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'BUG', title: 'Test Bug Ticket', body: 'Reproduction steps here.' },
    });

    await test.step('status 201', () => { expect(resp.status()).toBe(201); });

    const body = await resp.json() as Ticket;

    await test.step('owner defaults to HUMAN', () => { expect(body.owner).toBe('HUMAN'); });
    await test.step('status defaults to DEFINITION', () => { expect(body.status).toBe('DEFINITION'); });
    await test.step('solution is null', () => { expect(body.solution).toBeNull(); });
    await test.step('type is BUG', () => { expect(body.type).toBe('BUG'); });
    await test.step('title stored', () => { expect(body.title).toBe('Test Bug Ticket'); });
    await test.step('id is a positive integer', () => {
      expect(typeof body.id).toBe('number');
      expect(body.id).toBeGreaterThan(0);
    });
    await test.step('comments is empty array', () => {
      expect(Array.isArray(body.comments)).toBe(true);
      expect(body.comments.length).toBe(0);
    });
  });

  test('bad type value → 400 with fieldErrors.type', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'INVALID', title: 'T', body: 'B' },
    });
    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    await test.step('fieldErrors.type present', () => {
      expect(typeof body.fieldErrors?.['type']).toBe('string');
    });
  });

  test('missing title → 400 with fieldErrors', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', body: 'B' },
    });
    expect(resp.status()).toBe(400);
  });

  test('missing body → 400 with fieldErrors', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'T' },
    });
    expect(resp.status()).toBe(400);
  });

  // ── fullyReady (REQ-004, REQ-005) ───────────────────────────────────────────

  test('create without fullyReady → 201, defaults to false, boolean-typed', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'No fullyReady field', body: 'Defaults apply.' },
    });
    expect(resp.status()).toBe(201);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady is false', () => { expect(body.fullyReady).toBe(false); });
    await test.step('fullyReady is boolean-typed', () => { expect(typeof body.fullyReady).toBe('boolean'); });
  });

  test('create with fullyReady: true → 201, fullyReady true, DEFINITION+HUMAN, no side effects (REQ-005)', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Fully ready ticket', body: 'Ready to build.', fullyReady: true },
    });
    expect(resp.status()).toBe(201);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady is true', () => { expect(body.fullyReady).toBe(true); });
    await test.step('status defaults to DEFINITION', () => { expect(body.status).toBe('DEFINITION'); });
    await test.step('owner defaults to HUMAN', () => { expect(body.owner).toBe('HUMAN'); });
    await test.step('comments is empty (no routing side effects)', () => {
      expect(body.comments.length).toBe(0);
    });

    // Reused verbatim by the atomicity test in the next suite — see the
    // "Shared fixture" comment above resetTickets()'s declaration.
    fullyReadyCreateFixtureId = body.id;
  });

  test('create with non-boolean fullyReady ("yes") → 400 with fieldErrors.fullyReady', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Bad fullyReady', body: 'Should fail validation.', fullyReady: 'yes' },
    });
    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    await test.step('fieldErrors.fullyReady present', () => {
      expect(typeof body.fieldErrors?.['fullyReady']).toBe('string');
    });
  });
});

// ─── Suite: POST /:id/comments — clearFullyReady flag ───────────────────────
//
// Deliberately runs immediately after the POST /api/tickets suite above and
// never calls resetTickets() — every test here creates its own isolated
// ticket via POST, except the atomicity test, which reuses
// fullyReadyCreateFixtureId (set by the "create with fullyReady: true" test
// above) unmodified. See that test for why literal reuse (not a fresh
// fixture) matters.

test.describe('POST /:id/comments — clearFullyReady flag', () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  test('clearFullyReady:true on a fullyReady:true ticket → clears the flag, stores HUMAN comment', async () => {
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Clear flag ticket', body: 'Ready, will be cleared.', fullyReady: true },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    expect(created.fullyReady).toBe(true);

    const resp = await admin.post(`/api/tickets/${created.id}/comments`, {
      data: { body: 'Reviewed, clearing the ready flag.', clearFullyReady: true },
    });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });
    const body = await resp.json() as Ticket;
    await test.step('fullyReady is false', () => { expect(body.fullyReady).toBe(false); });
    await test.step('comment stored with author HUMAN', () => {
      const comment = body.comments.find((c) => c.body === 'Reviewed, clearing the ready flag.');
      expect(comment).toBeDefined();
      expect(comment?.author).toBe('HUMAN');
    });

    // Side-effect: re-fetch and confirm persisted
    const persisted = await (await admin.get(`/api/tickets/${created.id}`)).json() as Ticket;
    await test.step('persisted fullyReady is false', () => { expect(persisted.fullyReady).toBe(false); });
  });

  test('comment without clearFullyReady leaves fullyReady unchanged (stays true)', async () => {
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Untouched flag ticket', body: 'Ready, should stay ready.', fullyReady: true },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    expect(created.fullyReady).toBe(true);

    const resp = await admin.post(`/api/tickets/${created.id}/comments`, {
      data: { body: 'Just a note, no flag change.' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.fullyReady).toBe(true);
  });

  test('clearFullyReady:true sent twice in a row → 200 both times, fullyReady stays false (idempotent)', async () => {
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Idempotent clear ticket', body: 'Ready.', fullyReady: true },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    expect(created.fullyReady).toBe(true);

    const first = await admin.post(`/api/tickets/${created.id}/comments`, {
      data: { body: 'First clear.', clearFullyReady: true },
    });
    await test.step('first call 200', () => { expect(first.status()).toBe(200); });
    const firstBody = await first.json() as Ticket;
    await test.step('fullyReady false after first clear', () => { expect(firstBody.fullyReady).toBe(false); });

    const second = await admin.post(`/api/tickets/${created.id}/comments`, {
      data: { body: 'Second clear (already false).', clearFullyReady: true },
    });
    await test.step('second call 200', () => { expect(second.status()).toBe(200); });
    const secondBody = await second.json() as Ticket;
    await test.step('fullyReady still false after second clear', () => { expect(secondBody.fullyReady).toBe(false); });
  });

  test('clearFullyReady:true + handBackToAi:true on an ON_HOLD+HUMAN ticket (fullyReady:true fixture) → hand-back succeeds AND flag clears', async () => {
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Hand-back + clear ticket', body: 'Ready, on hold.', fullyReady: true },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;

    // Drive to ON_HOLD+HUMAN via admin drag-drop — PATCH /status never
    // touches owner, so owner stays HUMAN (as set by create).
    const holdResp = await admin.patch(`/api/tickets/${created.id}/status`, {
      data: { status: 'ON_HOLD' },
    });
    expect(holdResp.status()).toBe(200);
    const held = await holdResp.json() as Ticket;

    await test.step('fixture is ON_HOLD+HUMAN before the call', () => {
      expect(held.status).toBe('ON_HOLD');
      expect(held.owner).toBe('HUMAN');
    });
    // Explicit precondition per plan: seeded ON_HOLD+HUMAN tickets default to
    // fullyReady=false, which would make "clears too" trivially true even if
    // the clear never ran. This fixture starts true, so the assertion below
    // genuinely proves the clear happened.
    await test.step('fixture fullyReady is true before the call', () => {
      expect(held.fullyReady).toBe(true);
    });

    const resp = await admin.post(`/api/tickets/${created.id}/comments`, {
      data: { body: 'Answering and handing back.', handBackToAi: true, clearFullyReady: true },
    });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });
    const body = await resp.json() as Ticket;
    await test.step('hand-back succeeded: status TODO', () => { expect(body.status).toBe('TODO'); });
    await test.step('hand-back succeeded: owner AI', () => { expect(body.owner).toBe('AI'); });
    await test.step('fullyReady cleared to false', () => { expect(body.fullyReady).toBe(false); });
  });

  test('both flags together on a ticket that is NOT ON_HOLD+HUMAN → 409, no comment stored, fullyReady stays true (atomicity)', async () => {
    // Reuse the ticket created by the "create with fullyReady: true" test in
    // the POST /api/tickets suite above — it lands DEFINITION+HUMAN with 0
    // comments, already NOT ON_HOLD+HUMAN, and already fullyReady=true. Do
    // not create a fresh fixture: the bug this test guards against
    // (clearFullyReady leaking through the batch despite the handBackToAi
    // guard throwing) can only ever flip true → false, never the reverse — a
    // false-start "unchanged" fixture would pass even if the leak happens.
    expect(fullyReadyCreateFixtureId).toBeDefined();

    const before = await (await admin.get(`/api/tickets/${fullyReadyCreateFixtureId}`)).json() as Ticket;
    await test.step('fixture precondition: DEFINITION+HUMAN', () => {
      expect(before.status).toBe('DEFINITION');
      expect(before.owner).toBe('HUMAN');
    });
    await test.step('fixture precondition: fullyReady true, 0 comments', () => {
      expect(before.fullyReady).toBe(true);
      expect(before.comments.length).toBe(0);
    });

    const resp = await admin.post(`/api/tickets/${fullyReadyCreateFixtureId}/comments`, {
      data: { body: 'Should never land.', handBackToAi: true, clearFullyReady: true },
    });

    await test.step('status 409', () => { expect(resp.status()).toBe(409); });

    const after = await (await admin.get(`/api/tickets/${fullyReadyCreateFixtureId}`)).json() as Ticket;
    await test.step('no comment stored', () => { expect(after.comments.length).toBe(0); });
    await test.step('fullyReady still true, unchanged by the failed batch', () => {
      expect(after.fullyReady).toBe(true);
    });
    await test.step('status/owner also fully untouched', () => {
      expect(after.status).toBe('DEFINITION');
      expect(after.owner).toBe('HUMAN');
    });
  });
});

// ─── Suite: POST /api/tickets/:id/hand-to-ai ─────────────────────────────────

test.describe('POST /api/tickets/:id/hand-to-ai', () => {
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  test('DEFINITION ticket → 200, owner=AI, status=TODO', async () => {
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Hand to AI', body: 'Ready for the agent.' },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    expect(created.status).toBe('DEFINITION');
    expect(created.owner).toBe('HUMAN');

    const resp = await admin.post(`/api/tickets/${created.id}/hand-to-ai`);

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;
    await test.step('owner is AI', () => { expect(body.owner).toBe('AI'); });
    await test.step('status is TODO', () => { expect(body.status).toBe('TODO'); });
    await test.step('solution is null', () => { expect(body.solution).toBeNull(); });

    // Side-effect: re-fetch and confirm persisted state
    const persisted = await (await admin.get(`/api/tickets/${created.id}`)).json() as Ticket;
    await test.step('persisted owner is AI', () => { expect(persisted.owner).toBe('AI'); });
    await test.step('persisted status is TODO', () => { expect(persisted.status).toBe('TODO'); });
  });

  // ── 409 cases ───────────────────────────────────────────────────────────────

  test('non-DEFINITION ticket (TODO+AI) → 409', async () => {
    // Ticket 6 is TODO+AI after reset, not DEFINITION
    const resp = await admin.post('/api/tickets/6/hand-to-ai');

    await test.step('response is 409', () => { expect(resp.status()).toBe(409); });

    // Ticket must remain untouched
    const persisted = await (await admin.get('/api/tickets/6')).json() as Ticket;
    await test.step('ticket owner is still AI', () => { expect(persisted.owner).toBe('AI'); });
    await test.step('ticket status is still TODO', () => { expect(persisted.status).toBe('TODO'); });
  });

  test('ON_HOLD+HUMAN ticket → 409', async () => {
    // Ticket 7 is ON_HOLD+HUMAN after reset
    const resp = await admin.post('/api/tickets/7/hand-to-ai');

    await test.step('response is 409', () => { expect(resp.status()).toBe(409); });

    // Ticket must remain untouched
    const persisted = await (await admin.get('/api/tickets/7')).json() as Ticket;
    await test.step('ticket owner is still HUMAN', () => { expect(persisted.owner).toBe('HUMAN'); });
    await test.step('ticket status is still ON_HOLD', () => { expect(persisted.status).toBe('ON_HOLD'); });
  });

  // ── Not found ───────────────────────────────────────────────────────────────

  test('unknown id → 404', async () => {
    const resp = await admin.post('/api/tickets/99999/hand-to-ai');
    expect(resp.status()).toBe(404);
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  test('without session → 401', async () => {
    const anon = await anonCtx();
    const resp = await anon.post('/api/tickets/1/hand-to-ai');
    expect(resp.status()).toBe(401);
    await anon.dispose();
  });

  test('with USER role → 403', async () => {
    const userCtx = await loginCtx('user', 'test123');
    const resp = await userCtx.post('/api/tickets/1/hand-to-ai');
    expect(resp.status()).toBe(403);
    await userCtx.dispose();
  });

  test('with agent token only (no session) → 401', async () => {
    const agent = await agentCtx();
    const resp = await agent.post('/api/tickets/1/hand-to-ai');
    expect(resp.status()).toBe(401);
    await agent.dispose();
  });
});

// ─── Suite: GET /api/tickets (list) ──────────────────────────────────────────

test.describe('GET /api/tickets', () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  test('returns 200 with Spring-Data page shape and 12 total elements', async () => {
    const resp = await admin.get('/api/tickets');

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as PageResult<TicketListItem>;

    await test.step('totalElements is 12 (seeded count)', () => {
      expect(body.totalElements).toBe(12);
    });
    await test.step('content is an array', () => {
      expect(Array.isArray(body.content)).toBe(true);
    });
    await test.step('number is 0 (first page, 0-indexed)', () => {
      expect(body.number).toBe(0);
    });
    await test.step('first is true', () => {
      expect(body.first).toBe(true);
    });
    await test.step('size is a positive integer', () => {
      expect(body.size).toBeGreaterThan(0);
    });
    await test.step('totalPages is a positive integer', () => {
      expect(body.totalPages).toBeGreaterThan(0);
    });
    await test.step('last reflects whether this is the last page', () => {
      // With 12 elements on one page (default size >= 12), last should be true
      expect(typeof body.last).toBe('boolean');
      // If all fit on first page, last === true
      if (body.totalElements <= body.size) {
        expect(body.last).toBe(true);
      }
    });
  });

  test('filter by status=ON_HOLD returns only ON_HOLD tickets', async () => {
    const resp = await admin.get('/api/tickets?status=ON_HOLD');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as PageResult<TicketListItem>;

    await test.step('totalElements is 2 (7,9 are ON_HOLD)', () => {
      expect(body.totalElements).toBe(2);
    });
    await test.step('all content items have status ON_HOLD', () => {
      for (const item of body.content) {
        expect(item.status).toBe('ON_HOLD');
      }
    });
  });

  test('filter by owner=AI returns only AI-owned tickets', async () => {
    const resp = await admin.get('/api/tickets?owner=AI');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as PageResult<TicketListItem>;
    await test.step('totalElements is 5 (tickets 6,8,10,11,12)', () => {
      expect(body.totalElements).toBe(5);
    });
    for (const item of body.content) {
      expect(item.owner).toBe('AI');
    }
  });

  test('filter by type=CHORE returns only CHORE tickets', async () => {
    const resp = await admin.get('/api/tickets?type=CHORE');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as PageResult<TicketListItem>;
    await test.step('totalElements is 2 (tickets 8 and 10)', () => {
      expect(body.totalElements).toBe(2);
    });
    for (const item of body.content) {
      expect(item.type).toBe('CHORE');
    }
  });

  test('filter by status=DEFINITION is accepted (200) and returns only DEFINITION tickets', async () => {
    // 5 tickets already seed as DEFINITION (1,2,3,4,5) — create one more so the count
    // grows predictably instead of hard-coding a single expected match.
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'List Definition Ticket', body: 'Should be filterable.' },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;

    const resp = await admin.get('/api/tickets?status=DEFINITION');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as PageResult<TicketListItem>;

    await test.step('totalElements is 6 (5 seeded DEFINITION tickets + 1 created)', () => {
      expect(body.totalElements).toBe(6);
    });
    await test.step('all content items have status DEFINITION', () => {
      for (const item of body.content) {
        expect(item.status).toBe('DEFINITION');
      }
    });
    await test.step('the created ticket is in the result', () => {
      expect(body.content.some((item) => item.id === created.id)).toBe(true);
    });
    await test.step('all 5 seeded DEFINITION tickets (1,2,3,4,5) are in the result', () => {
      for (const seededId of [1, 2, 3, 4, 5]) {
        expect(body.content.some((item) => item.id === seededId)).toBe(true);
      }
    });
  });

  test('invalid status param → 400 with fieldErrors.status', async () => {
    const resp = await admin.get('/api/tickets?status=BOGUS');
    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors?.['status']).toBe('string');
  });

  test('invalid type param → 400 with fieldErrors.type', async () => {
    const resp = await admin.get('/api/tickets?type=NOPE');
    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors?.['type']).toBe('string');
  });

  test('invalid owner param → 400 with fieldErrors.owner', async () => {
    const resp = await admin.get('/api/tickets?owner=ROBOT');
    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors?.['owner']).toBe('string');
  });
});

// ─── Suite: GET /api/tickets/:id ─────────────────────────────────────────────

test.describe('GET /api/tickets/:id', () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  test('existing AI-owned ticket → 200 with correct shape', async () => {
    const resp = await admin.get('/api/tickets/6');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.id).toBe(6);
    expect(body.owner).toBe('AI');
    expect(body.status).toBe('TODO');
    expect(Array.isArray(body.comments)).toBe(true);
    expect(body.comments.length).toBe(0); // ticket 6 has no seeded comments
  });

  test('ON_HOLD ticket includes its seeded AGENT comment', async () => {
    // Ticket 7 has 1 seeded AGENT comment
    const resp = await admin.get('/api/tickets/7');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.status).toBe('ON_HOLD');
    expect(body.owner).toBe('HUMAN');
    expect(body.comments.length).toBe(1);
    expect(body.comments[0].author).toBe('AGENT');
  });

  test('unknown id → 404', async () => {
    const resp = await admin.get('/api/tickets/99999');
    expect(resp.status()).toBe(404);
  });
});

// ─── Suite: GET /api/tickets/board ───────────────────────────────────────────

test.describe('GET /api/tickets/board', () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  test('returns all five column arrays with correct counts', async () => {
    const resp = await admin.get('/api/tickets/board');

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as TicketBoard;

    await test.step('DEFINITION has 5 seeded tickets (1,2,3,4,5)', () => {
      expect(Array.isArray(body.DEFINITION)).toBe(true);
      expect(body.DEFINITION.length).toBe(5);
      for (const seededId of [1, 2, 3, 4, 5]) {
        expect(body.DEFINITION.some((t) => t.id === seededId)).toBe(true);
      }
    });
    await test.step('TODO has 5 tickets (6,8,10,11,12)', () => {
      expect(body.TODO.length).toBe(5);
    });
    await test.step('IN_PROGRESS is empty', () => {
      expect(body.IN_PROGRESS.length).toBe(0);
    });
    await test.step('ON_HOLD has 2 tickets (7,9)', () => {
      expect(body.ON_HOLD.length).toBe(2);
    });
    await test.step('DONE is empty', () => {
      expect(body.DONE.length).toBe(0);
    });
  });

  test('agent token: GET /board → 200 with all five status columns present', async () => {
    // /board was widened (commit ff92664) to accept an agent token so a skill
    // can peek the whole board without an admin login.
    const agent = await agentCtx();

    const resp = await agent.get('/api/tickets/board');

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as TicketBoard;

    await test.step('all five status columns are present as arrays', () => {
      expect(Array.isArray(body.DEFINITION)).toBe(true);
      expect(Array.isArray(body.TODO)).toBe(true);
      expect(Array.isArray(body.IN_PROGRESS)).toBe(true);
      expect(Array.isArray(body.ON_HOLD)).toBe(true);
      expect(Array.isArray(body.DONE)).toBe(true);
    });

    await agent.dispose();
  });

  test('a freshly created ticket appears in the DEFINITION column', async () => {
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Board Definition Ticket', body: 'Should land in DEFINITION.' },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;

    const resp = await admin.get('/api/tickets/board');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as TicketBoard;

    const found = body.DEFINITION.find((t) => t.id === created.id);
    expect(found).toBeDefined();
  });

  test('each ticket includes commentCount', async () => {
    // Reset first: an earlier test in this block creates an extra DEFINITION
    // ticket (0 comments), which would break the per-column commentCount checks.
    await resetTickets(admin);
    const resp = await admin.get('/api/tickets/board');
    const body = await resp.json() as TicketBoard;

    await test.step('TODO tickets have commentCount=0', () => {
      for (const t of body.TODO) {
        expect(typeof t.commentCount).toBe('number');
        expect(t.commentCount).toBe(0);
      }
    });

    await test.step('ON_HOLD tickets (7,9) have commentCount=1', () => {
      for (const t of body.ON_HOLD) {
        expect(t.commentCount).toBe(1);
      }
    });

    await test.step('all 5 DEFINITION tickets (1,2,3,4,5) have commentCount=1', () => {
      for (const t of body.DEFINITION) {
        expect(t.commentCount).toBe(1);
      }
    });
  });

  test('board items include owner, type, and solution fields', async () => {
    const resp = await admin.get('/api/tickets/board');
    const body = await resp.json() as TicketBoard;

    // All TODO items should be AI-owned
    for (const t of body.TODO) {
      expect(t.owner).toBe('AI');
      expect(t.solution).toBeNull();
    }
    // All ON_HOLD items should be HUMAN-owned
    for (const t of body.ON_HOLD) {
      expect(t.owner).toBe('HUMAN');
    }
  });
});

// ─── Suite: GET /api/tickets/summary ─────────────────────────────────────────

test.describe('GET /api/tickets/summary', () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  test('returns correct counts on fresh seeded data', async () => {
    const resp = await admin.get('/api/tickets/summary');

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as TicketSummary;

    await test.step('byStatus has all five keys', () => {
      expect(typeof body.byStatus['DEFINITION']).toBe('number');
      expect(typeof body.byStatus['TODO']).toBe('number');
      expect(typeof body.byStatus['IN_PROGRESS']).toBe('number');
      expect(typeof body.byStatus['ON_HOLD']).toBe('number');
      expect(typeof body.byStatus['DONE']).toBe('number');
    });

    await test.step('byStatus.DEFINITION is 5 (tickets 1,2,3,4,5)', () => {
      expect(body.byStatus['DEFINITION']).toBe(5);
    });

    await test.step('byStatus.TODO is 5', () => {
      expect(body.byStatus['TODO']).toBe(5);
    });

    await test.step('byStatus.ON_HOLD is 2', () => {
      expect(body.byStatus['ON_HOLD']).toBe(2);
    });

    await test.step('byStatus.IN_PROGRESS is 0', () => {
      expect(body.byStatus['IN_PROGRESS']).toBe(0);
    });

    await test.step('byStatus.DONE is 0', () => {
      expect(body.byStatus['DONE']).toBe(0);
    });

    await test.step('byType has FEATURE, BUG, CHORE keys', () => {
      expect(typeof body.byType['FEATURE']).toBe('number');
      expect(typeof body.byType['BUG']).toBe('number');
      expect(typeof body.byType['CHORE']).toBe('number');
    });

    await test.step('byType.CHORE is 2 (tickets 8 and 10)', () => {
      expect(body.byType['CHORE']).toBe(2);
    });

    await test.step('byType.FEATURE is 10 (12 total - 2 CHORE)', () => {
      expect(body.byType['FEATURE']).toBe(10);
    });

    await test.step('byOwner has AI and HUMAN keys', () => {
      expect(typeof body.byOwner['AI']).toBe('number');
      expect(typeof body.byOwner['HUMAN']).toBe('number');
    });

    await test.step('byOwner.AI is 5 (tickets 6,8,10,11,12)', () => {
      expect(body.byOwner['AI']).toBe(5);
    });

    await test.step('byOwner.HUMAN is 7 (tickets 1,2,3,4,5,7,9)', () => {
      expect(body.byOwner['HUMAN']).toBe(7);
    });

    await test.step('bySolution has DONE and WONT_DO keys', () => {
      expect(typeof body.bySolution['DONE']).toBe('number');
      expect(typeof body.bySolution['WONT_DO']).toBe('number');
    });

    await test.step('bySolution.DONE is 0 on fresh seed', () => {
      expect(body.bySolution['DONE']).toBe(0);
    });

    await test.step('bySolution.WONT_DO is 0 on fresh seed', () => {
      expect(body.bySolution['WONT_DO']).toBe(0);
    });
  });

  test('byStatus.DEFINITION reflects a freshly created ticket', async () => {
    // 5 tickets already seed as DEFINITION (1,2,3,4,5); creating one more should bump it to 6.
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Summary Definition Ticket', body: 'Should count as DEFINITION.' },
    });
    expect(createResp.status()).toBe(201);

    const resp = await admin.get('/api/tickets/summary');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as TicketSummary;
    expect(body.byStatus['DEFINITION']).toBe(6);
  });
});

// ─── Suite: POST /api/tickets/reset ──────────────────────────────────────────

test.describe('POST /api/tickets/reset', () => {
  let admin: APIRequestContext;
  let agent: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    agent = await agentCtx();
  });

  test.afterAll(async () => {
    await admin.dispose();
    await agent.dispose();
  });

  test('reset returns 200 with seeded count of 12', async () => {
    // Mutate state before reset to prove it actually resets
    const claimResp = await agent.get('/api/tickets/next');
    expect(claimResp.status()).toBe(200);

    const resetResp = await admin.post('/api/tickets/reset');

    await test.step('status 200', () => { expect(resetResp.status()).toBe(200); });

    const body = await resetResp.json() as { seeded: number };

    await test.step('response has seeded key', () => {
      expect(typeof body.seeded).toBe('number');
    });

    await test.step('seeded count is 12', () => {
      expect(body.seeded).toBe(12);
    });
  });

  test('after reset: board shows 5 TODO and 2 ON_HOLD', async () => {
    await admin.post('/api/tickets/reset');
    const boardResp = await admin.get('/api/tickets/board');
    const board = await boardResp.json() as TicketBoard;
    expect(board.TODO.length).toBe(5);
    expect(board.ON_HOLD.length).toBe(2);
    expect(board.IN_PROGRESS.length).toBe(0);
    expect(board.DONE.length).toBe(0);
  });

  test('after reset: ON_HOLD tickets (7,9) each have 1 seeded AGENT comment', async () => {
    await admin.post('/api/tickets/reset');

    for (const id of [7, 9]) {
      const resp = await admin.get(`/api/tickets/${id}`);
      expect(resp.status()).toBe(200);
      const ticket = await resp.json() as Ticket;
      await test.step(`ticket ${id} has status ON_HOLD`, () => {
        expect(ticket.status).toBe('ON_HOLD');
      });
      await test.step(`ticket ${id} has owner HUMAN`, () => {
        expect(ticket.owner).toBe('HUMAN');
      });
      await test.step(`ticket ${id} has exactly 1 comment`, () => {
        expect(ticket.comments.length).toBe(1);
      });
      await test.step(`ticket ${id} comment is from AGENT`, () => {
        expect(ticket.comments[0].author).toBe('AGENT');
      });
    }
  });

  test('after reset: a DEFINITION ticket body has both ## Business and ## Technical sections', async () => {
    await admin.post('/api/tickets/reset');

    const resp = await admin.get('/api/tickets/1');
    expect(resp.status()).toBe(200);
    const ticket = await resp.json() as Ticket;

    await test.step('ticket 1 is DEFINITION', () => {
      expect(ticket.status).toBe('DEFINITION');
    });
    await test.step('body contains ## Business', () => {
      expect(ticket.body).toContain('## Business');
    });
    await test.step('body contains ## Technical', () => {
      expect(ticket.body).toContain('## Technical');
    });
  });

  test('after reset: ticket 7 (CSV-export separator question) comment addresses @Entwickler', async () => {
    await admin.post('/api/tickets/reset');

    const resp = await admin.get('/api/tickets/7');
    expect(resp.status()).toBe(200);
    const ticket = await resp.json() as Ticket;

    await test.step('ticket 7 has exactly 1 seeded comment', () => {
      expect(ticket.comments.length).toBe(1);
    });
    await test.step('comment body starts with @Entwickler', () => {
      expect(ticket.comments[0].body.startsWith('@Entwickler')).toBe(true);
    });
  });

  test('after reset: ticket 1 (DEFINITION) comment addresses @Business Analyst', async () => {
    await admin.post('/api/tickets/reset');

    const resp = await admin.get('/api/tickets/1');
    expect(resp.status()).toBe(200);
    const ticket = await resp.json() as Ticket;

    await test.step('ticket 1 has exactly 1 seeded comment', () => {
      expect(ticket.comments.length).toBe(1);
    });
    await test.step('comment body starts with @Business Analyst', () => {
      expect(ticket.comments[0].body.startsWith('@Business Analyst')).toBe(true);
    });
  });

  test('after reset: mutations from previous tests are gone', async () => {
    // Create a new ticket to confirm it disappears after reset
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'BUG', title: 'Transient ticket', body: 'Should vanish after reset.' },
    });
    expect(createResp.status()).toBe(201);

    await admin.post('/api/tickets/reset');

    const listResp = await admin.get('/api/tickets');
    const list = await listResp.json() as PageResult<TicketListItem>;

    // After reset, only 12 seeded tickets remain
    expect(list.totalElements).toBe(12);
  });

  test('user role on reset → 403', async () => {
    const userCtx = await loginCtx('user', 'test123');
    const resp = await userCtx.post('/api/tickets/reset');
    expect(resp.status()).toBe(403);
    await userCtx.dispose();
  });
});

// ─── Suite: Validation — bad enum values ─────────────────────────────────────

test.describe('Validation — bad enum values', () => {
  let admin: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterAll(async () => {
    await admin.dispose();
  });

  test('PATCH /status with invalid status → 400', async () => {
    const resp = await admin.patch('/api/tickets/1/status', { data: { status: 'NOPE' } });
    expect(resp.status()).toBe(400);
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors).toBe('object');
  });

  test('PATCH /owner with invalid owner → 400', async () => {
    const resp = await admin.patch('/api/tickets/1/owner', { data: { owner: 'NOPE' } });
    expect(resp.status()).toBe(400);
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors).toBe('object');
  });

  test('POST / with invalid type → 400', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'INVALID_TYPE', title: 'T', body: 'B' },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors).toBe('object');
  });

  test('GET /?type=BAD → 400', async () => {
    const resp = await admin.get('/api/tickets?type=BAD');
    expect(resp.status()).toBe(400);
  });

  test('GET /?status=BAD → 400', async () => {
    const resp = await admin.get('/api/tickets?status=BAD');
    expect(resp.status()).toBe(400);
  });

  test('GET /?owner=BAD → 400', async () => {
    const resp = await admin.get('/api/tickets?owner=BAD');
    expect(resp.status()).toBe(400);
  });

  test('GET /next?type=BAD → 400', async () => {
    const agent = await agentCtx();
    const resp = await agent.get('/api/tickets/next?type=BAD');
    expect(resp.status()).toBe(400);
    await agent.dispose();
  });

  test('POST /:id/comments with empty body → 400', async () => {
    const resp = await admin.post('/api/tickets/1/comments', { data: { body: '' } });
    expect(resp.status()).toBe(400);
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors).toBe('object');
  });
});

// ─── Suite: POST /:id/comments with handBackToAi:false ───────────────────────

test.describe('POST /:id/comments — handBackToAi:false leaves status/owner unchanged', () => {
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  test('comment on ON_HOLD/owner=HUMAN ticket with handBackToAi:false → status and owner unchanged', async () => {
    // Ticket 7 is ON_HOLD+HUMAN after reset
    const before = await (await admin.get('/api/tickets/7')).json() as Ticket;
    const commentCountBefore = before.comments.length;

    const resp = await admin.post('/api/tickets/7/comments', {
      data: { body: 'Still looking into this.', handBackToAi: false },
    });

    await test.step('response is 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;

    await test.step('status remains ON_HOLD', () => { expect(body.status).toBe('ON_HOLD'); });
    await test.step('owner remains HUMAN', () => { expect(body.owner).toBe('HUMAN'); });
    await test.step('comment count increased by 1', () => {
      expect(body.comments.length).toBe(commentCountBefore + 1);
    });
    await test.step('new comment is from HUMAN with correct body', () => {
      const newComment = body.comments.find(
        (c) => c.author === 'HUMAN' && c.body === 'Still looking into this.',
      );
      expect(newComment).toBeDefined();
    });

    // Side-effect: re-fetch and confirm status/owner persisted unchanged
    const persisted = await (await admin.get('/api/tickets/7')).json() as Ticket;
    await test.step('persisted status is still ON_HOLD', () => { expect(persisted.status).toBe('ON_HOLD'); });
    await test.step('persisted owner is still HUMAN', () => { expect(persisted.owner).toBe('HUMAN'); });
    await test.step('persisted comment count matches', () => {
      expect(persisted.comments.length).toBe(commentCountBefore + 1);
    });
  });
});

// ─── Suite: POST /api/tickets/:id/start ──────────────────────────────────────

test.describe('POST /api/tickets/:id/start', () => {
  let agent: APIRequestContext;
  let anon: APIRequestContext;
  let wrong: APIRequestContext;
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    agent = await agentCtx();
    anon = await anonCtx();
    wrong = await wrongTokenCtx();
  });

  test.afterEach(async () => {
    await agent.dispose();
    await anon.dispose();
    await wrong.dispose();
    await admin.dispose();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  test('TODO+AI ticket → 200, status=IN_PROGRESS, pickedUpAt set, comments array present', async () => {
    // Ticket 6 is TODO+AI after reset
    const resp = await agent.post('/api/tickets/6/start', { data: {} });

    await test.step('status 200', () => { expect(resp.status()).toBe(200); });

    const body = await resp.json() as Ticket;

    await test.step('status is IN_PROGRESS', () => { expect(body.status).toBe('IN_PROGRESS'); });
    await test.step('owner remains AI', () => { expect(body.owner).toBe('AI'); });
    await test.step('pickedUpAt is a non-empty ISO string', () => {
      expect(typeof body.pickedUpAt).toBe('string');
      expect((body.pickedUpAt as string).length).toBeGreaterThan(0);
    });
    await test.step('comments is an array', () => {
      expect(Array.isArray(body.comments)).toBe(true);
    });
    await test.step('solution is null', () => { expect(body.solution).toBeNull(); });
    await test.step('resolvedAt is null', () => { expect(body.resolvedAt).toBeNull(); });

    // Side-effect: re-fetch and confirm persisted state
    const persisted = await (await admin.get('/api/tickets/6')).json() as Ticket;
    await test.step('persisted status is IN_PROGRESS', () => {
      expect(persisted.status).toBe('IN_PROGRESS');
    });
    await test.step('persisted pickedUpAt matches response', () => {
      expect(persisted.pickedUpAt).toBe(body.pickedUpAt);
    });
  });

  // ── 409 cases ───────────────────────────────────────────────────────────────

  test('TODO+HUMAN ticket → 409 (wrong owner)', async () => {
    // Create a new ticket — POST /api/tickets creates owner=HUMAN + status=DEFINITION.
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Human-owned ticket', body: 'Should not be startable.' },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    expect(created.owner).toBe('HUMAN');
    expect(created.status).toBe('DEFINITION');

    // Drive it to TODO via PATCH /status (drag-drop) — owner stays HUMAN.
    const readyResp = await admin.patch(`/api/tickets/${created.id}/status`, {
      data: { status: 'TODO' },
    });
    expect(readyResp.status()).toBe(200);
    const ready = await readyResp.json() as Ticket;
    expect(ready.owner).toBe('HUMAN');
    expect(ready.status).toBe('TODO');

    const resp = await agent.post(`/api/tickets/${created.id}/start`, { data: {} });
    expect(resp.status()).toBe(409);
  });

  test('already IN_PROGRESS ticket → 409 (wrong status)', async () => {
    // Claim ticket 1 via /next to put it IN_PROGRESS
    const claimResp = await agent.get('/api/tickets/next');
    expect(claimResp.status()).toBe(200);
    const claimed = await claimResp.json() as Ticket;
    expect(claimed.status).toBe('IN_PROGRESS');

    // Now try /start on the same ticket — already IN_PROGRESS, not TODO
    const resp = await agent.post(`/api/tickets/${claimed.id}/start`, { data: {} });
    expect(resp.status()).toBe(409);
  });

  test('ON_HOLD+HUMAN ticket → 409', async () => {
    // Ticket 7 is ON_HOLD+HUMAN after reset
    const resp = await agent.post('/api/tickets/7/start', { data: {} });
    expect(resp.status()).toBe(409);
  });

  test('ON_HOLD+AI ticket → 409 (status guard, independent of owner)', async () => {
    // Move an AI-owned ticket (6) to ON_HOLD via admin PATCH /status (preserves owner=AI)
    const patchResp = await admin.patch('/api/tickets/6/status', { data: { status: 'ON_HOLD' } });
    expect(patchResp.status()).toBe(200);
    const patched = await patchResp.json() as Ticket;
    expect(patched.owner).toBe('AI');
    expect(patched.status).toBe('ON_HOLD');

    // /start must reject: status is not TODO, even though owner=AI
    const resp = await agent.post('/api/tickets/6/start', { data: {} });
    expect(resp.status()).toBe(409);
  });

  test('DONE ticket → 409', async () => {
    // Move ticket 6 (TODO+AI) to DONE via admin PATCH /status
    const patchResp = await admin.patch('/api/tickets/6/status', { data: { status: 'DONE' } });
    expect(patchResp.status()).toBe(200);

    const resp = await agent.post('/api/tickets/6/start', { data: {} });
    expect(resp.status()).toBe(409);
  });

  // ── Not found ───────────────────────────────────────────────────────────────

  test('unknown id → 404', async () => {
    const resp = await agent.post('/api/tickets/99999/start', { data: {} });
    expect(resp.status()).toBe(404);
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  test('no auth token from localhost → 200 (loopback bypass, ticket transitions to IN_PROGRESS)', async () => {
    // AGENT_AUTH_ALLOW_LOOPBACK=1 is set in the test environment.
    // Ticket 8 is TODO+AI after reset — use a ticket other than 6 to avoid collision.
    const resp = await anon.post('/api/tickets/8/start', { data: {} });
    // Auth bypass passes; business guard allows TODO+AI → IN_PROGRESS
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.status).toBe('IN_PROGRESS');
  });

  test('wrong agent token → 401', async () => {
    const resp = await wrong.post('/api/tickets/3/start', { data: {} });
    expect(resp.status()).toBe(401);
  });
});

// ─── Suite: POST /:id/comments handBackToAi guard ────────────────────────────

test.describe('POST /:id/comments — handBackToAi guard (only ON_HOLD+HUMAN allowed)', () => {
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  test('handBackToAi:true on a DONE ticket → 409, ticket stays DONE', async () => {
    // Create a fresh ticket (HUMAN+DEFINITION), then drag it to DONE via PATCH /status
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'BUG', title: 'Will be done', body: 'To be resolved.' },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    const ticketId = created.id;

    // Move to DONE
    const doneResp = await admin.patch(`/api/tickets/${ticketId}/status`, {
      data: { status: 'DONE' },
    });
    expect(doneResp.status()).toBe(200);

    // Attempt hand-back — must be rejected
    const resp = await admin.post(`/api/tickets/${ticketId}/comments`, {
      data: { body: 'Trying to resurrect.', handBackToAi: true },
    });

    await test.step('response is 409', () => { expect(resp.status()).toBe(409); });

    // Confirm ticket is still DONE (not resurrected to TODO)
    const persisted = await (await admin.get(`/api/tickets/${ticketId}`)).json() as Ticket;
    await test.step('ticket status is still DONE', () => { expect(persisted.status).toBe('DONE'); });
    // POST /api/tickets creates owner=HUMAN; PATCH /status never changes owner
    await test.step('ticket owner is still HUMAN (unchanged)', () => { expect(persisted.owner).toBe('HUMAN'); });
  });

  test('handBackToAi:true on a TODO ticket (owner=HUMAN) → 409', async () => {
    // Create ticket: starts as HUMAN+DEFINITION
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Human TODO', body: 'Not on hold.' },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    const ticketId = created.id;

    expect(created.status).toBe('DEFINITION');
    expect(created.owner).toBe('HUMAN');

    // Drive it to TODO via PATCH /status (drag-drop) — owner stays HUMAN.
    const readyResp = await admin.patch(`/api/tickets/${ticketId}/status`, {
      data: { status: 'TODO' },
    });
    expect(readyResp.status()).toBe(200);
    const ready = await readyResp.json() as Ticket;

    // Verify it is TODO+HUMAN
    expect(ready.status).toBe('TODO');
    expect(ready.owner).toBe('HUMAN');

    // Attempt hand-back on a TODO ticket — must be rejected (not ON_HOLD)
    const resp = await admin.post(`/api/tickets/${ticketId}/comments`, {
      data: { body: 'Hand back attempt on TODO.', handBackToAi: true },
    });

    await test.step('response is 409', () => { expect(resp.status()).toBe(409); });

    // Ticket must remain untouched
    const persisted = await (await admin.get(`/api/tickets/${ticketId}`)).json() as Ticket;
    await test.step('ticket status is still TODO', () => { expect(persisted.status).toBe('TODO'); });
    await test.step('ticket owner is still HUMAN', () => { expect(persisted.owner).toBe('HUMAN'); });
  });

  test('lifecycle: claim → ask → ON_HOLD+HUMAN → handBackToAi:true → TODO+AI (happy path still works)', async () => {
    // Step 1: claim a TODO+AI ticket
    const agent = await agentCtx();
    const claimResp = await agent.get('/api/tickets/next');
    expect(claimResp.status()).toBe(200);
    const claimed = await claimResp.json() as Ticket;
    const ticketId = claimed.id;

    // Step 2: ask → ON_HOLD+HUMAN
    const askResp = await agent.post(`/api/tickets/${ticketId}/ask`, {
      data: { question: 'Which approach do you prefer?' },
    });
    expect(askResp.status()).toBe(200);
    const afterAsk = await askResp.json() as Ticket;
    expect(afterAsk.status).toBe('ON_HOLD');
    expect(afterAsk.owner).toBe('HUMAN');

    // Step 3: human answers with handBackToAi:true — must succeed (guard passes)
    const answerResp = await admin.post(`/api/tickets/${ticketId}/comments`, {
      data: { body: 'Use approach B.', handBackToAi: true },
    });

    await test.step('response is 200', () => { expect(answerResp.status()).toBe(200); });

    const afterHandback = await answerResp.json() as Ticket;

    await test.step('status is TODO after handback', () => { expect(afterHandback.status).toBe('TODO'); });
    await test.step('owner is AI after handback', () => { expect(afterHandback.owner).toBe('AI'); });
    await test.step('solution is cleared', () => { expect(afterHandback.solution).toBeNull(); });

    await agent.dispose();
  });

  test('plain comment WITHOUT handBackToAi works on any status (TODO, DONE)', async () => {
    // Ticket 6 is TODO+AI after reset — plain comment must work
    const resp1 = await admin.post('/api/tickets/6/comments', {
      data: { body: 'Note on TODO ticket.' },
    });
    await test.step('plain comment on TODO → 200', () => { expect(resp1.status()).toBe(200); });

    // Move ticket 6 to DONE, then add another plain comment
    await admin.patch('/api/tickets/6/status', { data: { status: 'DONE' } });
    const resp2 = await admin.post('/api/tickets/6/comments', {
      data: { body: 'Note on DONE ticket.' },
    });
    await test.step('plain comment on DONE → 200', () => { expect(resp2.status()).toBe(200); });
  });
});

// ─── Suite: fullyReady round-trip — boolean typing across read endpoints ────

test.describe('fullyReady round-trip — boolean typing across read endpoints', () => {
  let admin: APIRequestContext;
  let agent: APIRequestContext;
  // Populated by the "GET /:id" test below with a fullyReady:true ticket
  // that lands DEFINITION+HUMAN on create (REQ-005). Reused by the "GET
  // /board" test so it can assert an actual `true` value in the DEFINITION
  // column, not just boolean typing.
  let trueFixtureDefinitionId: number;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    agent = await agentCtx();
  });

  test.afterAll(async () => {
    await admin.dispose();
    await agent.dispose();
  });

  test('GET /:id: fullyReady is a real boolean for both a true and a false fixture', async () => {
    // Seeded ticket 1 (DEFINITION+HUMAN) defaults to fullyReady=false.
    const falseResp = await admin.get('/api/tickets/1');
    expect(falseResp.status()).toBe(200);
    const falseTicket = await falseResp.json() as Ticket;
    await test.step('seeded ticket fullyReady is false, boolean-typed', () => {
      expect(falseTicket.fullyReady).toBe(false);
      expect(typeof falseTicket.fullyReady).toBe('boolean');
    });

    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'GET :id true fixture', body: 'Ready.', fullyReady: true },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    trueFixtureDefinitionId = created.id;

    const trueResp = await admin.get(`/api/tickets/${created.id}`);
    expect(trueResp.status()).toBe(200);
    const trueTicket = await trueResp.json() as Ticket;
    await test.step('created ticket fullyReady is true, boolean-typed', () => {
      expect(trueTicket.fullyReady).toBe(true);
      expect(typeof trueTicket.fullyReady).toBe('boolean');
    });
  });

  test('GET / (paginated list): fullyReady is boolean-typed for every item, both true and false present', async () => {
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'List true fixture', body: 'Ready.', fullyReady: true },
    });
    expect(createResp.status()).toBe(201);

    const resp = await admin.get('/api/tickets?size=100');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as PageResult<TicketListItem>;

    await test.step('every item has boolean-typed fullyReady', () => {
      for (const item of body.content) {
        expect(typeof item.fullyReady).toBe('boolean');
      }
    });
    await test.step('at least one true item and one false item are present', () => {
      expect(body.content.some((item) => item.fullyReady === true)).toBe(true);
      expect(body.content.some((item) => item.fullyReady === false)).toBe(true);
    });
  });

  test('GET /board: fullyReady is boolean-typed for every ticket in every column', async () => {
    const resp = await admin.get('/api/tickets/board');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as TicketBoard;

    for (const column of ['DEFINITION', 'TODO', 'IN_PROGRESS', 'ON_HOLD', 'DONE'] as const) {
      await test.step(`${column} column: every item has boolean-typed fullyReady`, () => {
        for (const item of body[column]) {
          expect(typeof item.fullyReady).toBe('boolean');
        }
      });
    }

    // The `typeof === 'boolean'` checks above would still pass a mapper bug
    // that hardcoded `fullyReady: false` everywhere. Pin an actual `true`
    // value in the DEFINITION column: the "GET /:id" test earlier in this
    // describe block already created a fullyReady:true ticket that lands
    // DEFINITION+HUMAN on create (REQ-005), so it must be sitting there now.
    await test.step('DEFINITION column contains the known fullyReady:true fixture', () => {
      const fixture = body.DEFINITION.find((item) => item.id === trueFixtureDefinitionId);
      expect(fixture).toBeDefined();
      expect(fixture?.fullyReady).toBe(true);
    });
  });

  test('GET /board TODO column and GET /next: true fixture reaches TODO+AI only via explicit status+owner promotion', async () => {
    // TODO+AI is the only state /next and the board's TODO column ever
    // surface. A fullyReady:true ticket lands DEFINITION+HUMAN on create
    // (REQ-005), so reaching TODO+AI requires an explicit two-step
    // promotion — a false-only fixture is not enough to exercise this path.
    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'TODO+AI true fixture', body: 'Ready, promoted.', fullyReady: true },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    expect(created.status).toBe('DEFINITION');
    expect(created.owner).toBe('HUMAN');
    expect(created.fullyReady).toBe(true);

    const statusResp = await admin.patch(`/api/tickets/${created.id}/status`, {
      data: { status: 'TODO' },
    });
    expect(statusResp.status()).toBe(200);

    const ownerResp = await admin.patch(`/api/tickets/${created.id}/owner`, {
      data: { owner: 'AI' },
    });
    expect(ownerResp.status()).toBe(200);
    const promoted = await ownerResp.json() as Ticket;
    await test.step('promoted ticket is TODO+AI, fullyReady still true', () => {
      expect(promoted.status).toBe('TODO');
      expect(promoted.owner).toBe('AI');
      expect(promoted.fullyReady).toBe(true);
    });

    // GET /board TODO column
    const boardResp = await admin.get('/api/tickets/board');
    expect(boardResp.status()).toBe(200);
    const board = await boardResp.json() as TicketBoard;
    const boardItem = board.TODO.find((t) => t.id === created.id);
    await test.step('promoted ticket appears in board TODO column', () => {
      expect(boardItem).toBeDefined();
    });
    await test.step('board TODO item fullyReady is true, boolean-typed', () => {
      expect(boardItem?.fullyReady).toBe(true);
      expect(typeof boardItem?.fullyReady).toBe('boolean');
    });

    // GET /next: drain until this specific ticket is claimed — other TODO+AI
    // tickets (seeded, createdAt earlier) may be claimed first.
    let claimed: Ticket | undefined;
    for (let i = 0; i < 10 && !claimed; i++) {
      const nextResp = await agent.get('/api/tickets/next');
      if (nextResp.status() === 204) break;
      const candidate = await nextResp.json() as Ticket;
      // Every candidate drained along the way (seeded, fullyReady=false by
      // default) also gets checked, giving this loop false-fixture coverage
      // for /next too.
      expect(typeof candidate.fullyReady).toBe('boolean');
      if (candidate.id === created.id) claimed = candidate;
    }

    await test.step('the true-fixture ticket was claimable via /next', () => {
      expect(claimed).toBeDefined();
    });
    await test.step('claimed ticket fullyReady is true, boolean-typed', () => {
      expect(claimed?.fullyReady).toBe(true);
      expect(typeof claimed?.fullyReady).toBe('boolean');
    });
  });
});

// ─── Suite: fullyReady untouched by non-write endpoints (REQ-007) ───────────
//
// Covers all 7 REQ-007 endpoints: /start, /done, /ask, /wont-do, /hand-to-ai,
// PATCH /status, PATCH /owner. /wont-do and /hand-to-ai are admin-session-only
// (requireAuth + requireRole('ADMIN')), a different auth path from the other
// five (requireAgentTokenOrAdminSession) — both are included below, reusing
// the same loginCtx('admin', 'admin123') helper used elsewhere in this file.
// Every fixture starts fullyReady=true so a silent flip to false/0/1 would be
// caught, not just "unchanged" from an already-false baseline.

test.describe('fullyReady untouched by non-write endpoints', () => {
  let admin: APIRequestContext;
  let agent: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    agent = await agentCtx();
  });

  test.afterAll(async () => {
    await admin.dispose();
    await agent.dispose();
  });

  async function createFullyReadyTicket(title: string): Promise<Ticket> {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title, body: 'Ready ticket for untouched-by check.', fullyReady: true },
    });
    expect(resp.status()).toBe(201);
    const ticket = await resp.json() as Ticket;
    expect(ticket.fullyReady).toBe(true);
    return ticket;
  }

  test('POST /:id/start leaves fullyReady unchanged and boolean-typed', async () => {
    const created = await createFullyReadyTicket('start untouched');
    // Promote to TODO+AI so /start's guard passes.
    await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    await admin.patch(`/api/tickets/${created.id}/owner`, { data: { owner: 'AI' } });

    const resp = await agent.post(`/api/tickets/${created.id}/start`, { data: {} });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady unchanged (still true)', () => { expect(body.fullyReady).toBe(true); });
    await test.step('fullyReady is boolean-typed', () => { expect(typeof body.fullyReady).toBe('boolean'); });
  });

  test('POST /:id/done leaves fullyReady unchanged and boolean-typed', async () => {
    const created = await createFullyReadyTicket('done untouched');
    await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    await admin.patch(`/api/tickets/${created.id}/owner`, { data: { owner: 'AI' } });
    const startResp = await agent.post(`/api/tickets/${created.id}/start`, { data: {} });
    expect(startResp.status()).toBe(200);

    const resp = await agent.post(`/api/tickets/${created.id}/done`, { data: {} });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady unchanged (still true)', () => { expect(body.fullyReady).toBe(true); });
    await test.step('fullyReady is boolean-typed', () => { expect(typeof body.fullyReady).toBe('boolean'); });
  });

  test('POST /:id/ask leaves fullyReady unchanged and boolean-typed', async () => {
    const created = await createFullyReadyTicket('ask untouched');
    await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    await admin.patch(`/api/tickets/${created.id}/owner`, { data: { owner: 'AI' } });
    const startResp = await agent.post(`/api/tickets/${created.id}/start`, { data: {} });
    expect(startResp.status()).toBe(200);

    const resp = await agent.post(`/api/tickets/${created.id}/ask`, {
      data: { question: 'Untouched by ask?' },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady unchanged (still true)', () => { expect(body.fullyReady).toBe(true); });
    await test.step('fullyReady is boolean-typed', () => { expect(typeof body.fullyReady).toBe('boolean'); });
  });

  test('POST /:id/wont-do (admin-session-only) leaves fullyReady unchanged and boolean-typed', async () => {
    const created = await createFullyReadyTicket('wont-do untouched');
    // owner=HUMAN, status=DEFINITION (!= DONE) already satisfies the guard.

    const resp = await admin.post(`/api/tickets/${created.id}/wont-do`, { data: {} });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady unchanged (still true)', () => { expect(body.fullyReady).toBe(true); });
    await test.step('fullyReady is boolean-typed', () => { expect(typeof body.fullyReady).toBe('boolean'); });
  });

  test('POST /:id/hand-to-ai (admin-session-only) leaves fullyReady unchanged and boolean-typed', async () => {
    const created = await createFullyReadyTicket('hand-to-ai untouched');
    // status=DEFINITION already satisfies the guard.

    const resp = await admin.post(`/api/tickets/${created.id}/hand-to-ai`);
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady unchanged (still true)', () => { expect(body.fullyReady).toBe(true); });
    await test.step('fullyReady is boolean-typed', () => { expect(typeof body.fullyReady).toBe('boolean'); });
  });

  test('PATCH /:id/status leaves fullyReady unchanged and boolean-typed', async () => {
    const created = await createFullyReadyTicket('status untouched');

    const resp = await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady unchanged (still true)', () => { expect(body.fullyReady).toBe(true); });
    await test.step('fullyReady is boolean-typed', () => { expect(typeof body.fullyReady).toBe('boolean'); });
  });

  test('PATCH /:id/owner leaves fullyReady unchanged and boolean-typed', async () => {
    const created = await createFullyReadyTicket('owner untouched');

    const resp = await admin.patch(`/api/tickets/${created.id}/owner`, { data: { owner: 'AI' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;

    await test.step('fullyReady unchanged (still true)', () => { expect(body.fullyReady).toBe(true); });
    await test.step('fullyReady is boolean-typed', () => { expect(typeof body.fullyReady).toBe('boolean'); });
  });
});

// ─── Suite: POST /api/tickets — agentTaskId (link to app feedback) ──────────
//
// Isolation approach: like every other describe block in this file, each
// test below runs against a freshly reset ticket table (resetTickets(admin)
// = POST /api/tickets/reset) so link tests never depend on state left by an
// earlier test. agent_task ids 1-23 are the fixed seed set (see
// agentTaskSeed.ts) and are never deleted by resetTickets() (which only
// touches ticket/ticket_comment), so referencing a fixed id below is stable
// across this whole file's run. This file (tickets.spec.ts) is the LAST spec
// file Playwright runs alphabetically (playwright.config.ts:
// fullyParallel:false, workers:1), so nothing downstream depends on the
// ticket table's state once this file finishes — but the last of the three
// agentTaskId describe blocks below still resets the ticket table to exactly
// its seeded 12 rows in its own afterAll (see "agentTaskId untouched by
// write endpoints" below), both for defensiveness and to leave the DB in the
// same shape a developer would find after `./start.sh --reset-db`.

test.describe('POST /api/tickets — agentTaskId (link to app feedback)', () => {
  let admin: APIRequestContext;

  test.beforeEach(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
  });

  test.afterEach(async () => {
    await admin.dispose();
  });

  test('create without agentTaskId → 201, field is null', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'No link', body: 'No source feedback.' },
    });
    expect(resp.status()).toBe(201);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBeNull();
  });

  test('create with agentTaskId: null explicitly → 201, field is null (same as omitted)', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Explicit null link', body: 'No source feedback.', agentTaskId: null },
    });
    expect(resp.status()).toBe(201);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBeNull();
  });

  test('create with a valid existing agentTaskId → 201, field set, ticket still lands DEFINITION+HUMAN', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Linked ticket', body: 'From feedback #1.', agentTaskId: 1 },
    });
    expect(resp.status()).toBe(201);
    const body = await resp.json() as Ticket;

    await test.step('agentTaskId is set to the referenced id', () => { expect(body.agentTaskId).toBe(1); });
    await test.step('status defaults to DEFINITION (unaffected by the new field)', () => {
      expect(body.status).toBe('DEFINITION');
    });
    await test.step('owner defaults to HUMAN (unaffected by the new field)', () => {
      expect(body.owner).toBe('HUMAN');
    });
  });

  test('create with an unknown agentTaskId → 400 with fieldErrors.agentTaskId, no ticket created', async () => {
    const beforeResp = await admin.get('/api/tickets?size=1');
    expect(beforeResp.status()).toBe(200);
    const before = await beforeResp.json() as PageResult<TicketListItem>;

    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Bad link', body: 'Points at nothing.', agentTaskId: 99999 },
    });

    await test.step('status 400', () => { expect(resp.status()).toBe(400); });
    const body = await resp.json() as ErrorBody;
    await test.step('fieldErrors.agentTaskId present', () => {
      expect(typeof body.fieldErrors?.['agentTaskId']).toBe('string');
    });

    const afterResp = await admin.get('/api/tickets?size=1');
    expect(afterResp.status()).toBe(200);
    const after = await afterResp.json() as PageResult<TicketListItem>;
    await test.step('ticket row count unchanged (no orphan insert)', () => {
      expect(after.totalElements).toBe(before.totalElements);
    });
  });

  test('create with a non-integer agentTaskId (string) → 400', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Bad type (string)', body: 'String id.', agentTaskId: 'abc' },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors?.['agentTaskId']).toBe('string');
  });

  test('create with a non-integer agentTaskId (float) → 400', async () => {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Bad type (float)', body: 'Float id.', agentTaskId: 1.5 },
    });
    expect(resp.status()).toBe(400);
    const body = await resp.json() as ErrorBody;
    expect(typeof body.fieldErrors?.['agentTaskId']).toBe('string');
  });
});

// ─── Suite: agentTaskId round-trip — read endpoints ──────────────────────────
//
// Isolation approach: same as the create suite above — resetTickets(admin)
// in beforeAll gives this block a clean, known ticket table before it
// creates its own single linked fixture, which every test in this
// `beforeAll`-scoped (not `beforeEach`) block then reads back through a
// different endpoint. Mirrors the "fullyReady round-trip" suite's structure
// above (shared fixture, no reset between its own tests).

test.describe('agentTaskId round-trip — read endpoints', () => {
  let admin: APIRequestContext;
  let agent: APIRequestContext;
  let linkedTicketId: number;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    await resetTickets(admin);
    agent = await agentCtx();

    const createResp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title: 'Round-trip link fixture', body: 'From feedback #2.', agentTaskId: 2 },
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as Ticket;
    linkedTicketId = created.id;
  });

  test.afterAll(async () => {
    await admin.dispose();
    await agent.dispose();
  });

  test('GET /:id: agentTaskId is set for the linked fixture, null for a seeded ticket', async () => {
    const linkedResp = await admin.get(`/api/tickets/${linkedTicketId}`);
    expect(linkedResp.status()).toBe(200);
    const linked = await linkedResp.json() as Ticket;
    await test.step('linked ticket carries agentTaskId', () => { expect(linked.agentTaskId).toBe(2); });

    const seededResp = await admin.get('/api/tickets/1');
    expect(seededResp.status()).toBe(200);
    const seeded = await seededResp.json() as Ticket;
    await test.step('seeded ticket agentTaskId is null', () => { expect(seeded.agentTaskId).toBeNull(); });
  });

  test('GET / (paginated list): agentTaskId present on every item, both a value and null occur', async () => {
    const resp = await admin.get('/api/tickets?size=100');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as PageResult<TicketListItem>;

    const linkedItem = body.content.find((item) => item.id === linkedTicketId);
    await test.step('linked ticket item carries agentTaskId', () => {
      expect(linkedItem?.agentTaskId).toBe(2);
    });
    await test.step('at least one item has agentTaskId null (seeded tickets)', () => {
      expect(body.content.some((item) => item.agentTaskId === null)).toBe(true);
    });
  });

  test('GET /board: agentTaskId is present on the fixture in the DEFINITION column', async () => {
    const resp = await admin.get('/api/tickets/board');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as TicketBoard;

    const item = body.DEFINITION.find((t) => t.id === linkedTicketId);
    expect(item?.agentTaskId).toBe(2);
  });

  test('GET /next: agentTaskId survives claim TODO+AI → IN_PROGRESS', async () => {
    // Promote the fixture to TODO+AI so /next can claim it.
    const statusResp = await admin.patch(`/api/tickets/${linkedTicketId}/status`, { data: { status: 'TODO' } });
    expect(statusResp.status()).toBe(200);
    const ownerResp = await admin.patch(`/api/tickets/${linkedTicketId}/owner`, { data: { owner: 'AI' } });
    expect(ownerResp.status()).toBe(200);

    // Drain until this specific ticket is claimed — other TODO+AI seeded
    // tickets (createdAt earlier) may be claimed first.
    let claimed: Ticket | undefined;
    for (let i = 0; i < 10 && !claimed; i++) {
      const nextResp = await agent.get('/api/tickets/next');
      if (nextResp.status() === 204) break;
      const candidate = await nextResp.json() as Ticket;
      if (candidate.id === linkedTicketId) claimed = candidate;
    }

    await test.step('the linked fixture was claimable via /next', () => { expect(claimed).toBeDefined(); });
    await test.step('claimed ticket agentTaskId is unchanged', () => { expect(claimed?.agentTaskId).toBe(2); });
  });
});

// ─── Suite: agentTaskId untouched by write endpoints (REQ-207) ──────────────
//
// Covers /start, /done, /ask, /wont-do, /hand-to-ai, PATCH /status,
// PATCH /owner, and POST /:id/comments — REQ-207 says create is the only
// write path for agentTaskId; every other route must leave it alone. Mirrors
// the "fullyReady untouched by non-write endpoints" suite above; unlike that
// suite, POST /:id/comments is included here too — agentTaskId has no
// clearFullyReady-style toggle, so nothing exempts /comments from this check.
// /wont-do and /hand-to-ai are asserted explicitly below like every other
// endpoint; they are not treated as special cases.

test.describe('agentTaskId untouched by write endpoints (REQ-207)', () => {
  let admin: APIRequestContext;
  let agent: APIRequestContext;

  test.beforeAll(async () => {
    admin = await loginCtx('admin', 'admin123');
    agent = await agentCtx();
  });

  test.afterAll(async () => {
    // Final cleanup for this file: restore the ticket table to exactly its
    // seeded 12 rows. tickets.spec.ts is the last spec file Playwright runs
    // alphabetically (see the header comment above the first agentTaskId
    // suite in this file), so nothing downstream reads this state — this
    // call is defensive, matching the same discipline every other describe
    // block in this file already follows via resetTickets() in its own
    // beforeAll/beforeEach.
    await resetTickets(admin);
    await admin.dispose();
    await agent.dispose();
  });

  async function createLinkedTicket(title: string): Promise<Ticket> {
    const resp = await admin.post('/api/tickets', {
      data: { type: 'FEATURE', title, body: 'Linked ticket for untouched-by check.', agentTaskId: 3 },
    });
    expect(resp.status()).toBe(201);
    const ticket = await resp.json() as Ticket;
    expect(ticket.agentTaskId).toBe(3);
    return ticket;
  }

  test('POST /:id/start leaves agentTaskId unchanged', async () => {
    const created = await createLinkedTicket('start untouched (agentTaskId)');
    await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    await admin.patch(`/api/tickets/${created.id}/owner`, { data: { owner: 'AI' } });

    const resp = await agent.post(`/api/tickets/${created.id}/start`, { data: {} });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBe(3);
  });

  test('POST /:id/done leaves agentTaskId unchanged', async () => {
    const created = await createLinkedTicket('done untouched (agentTaskId)');
    await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    await admin.patch(`/api/tickets/${created.id}/owner`, { data: { owner: 'AI' } });
    const startResp = await agent.post(`/api/tickets/${created.id}/start`, { data: {} });
    expect(startResp.status()).toBe(200);

    const resp = await agent.post(`/api/tickets/${created.id}/done`, { data: {} });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBe(3);
  });

  test('POST /:id/ask leaves agentTaskId unchanged', async () => {
    const created = await createLinkedTicket('ask untouched (agentTaskId)');
    await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    await admin.patch(`/api/tickets/${created.id}/owner`, { data: { owner: 'AI' } });
    const startResp = await agent.post(`/api/tickets/${created.id}/start`, { data: {} });
    expect(startResp.status()).toBe(200);

    const resp = await agent.post(`/api/tickets/${created.id}/ask`, { data: { question: 'Untouched?' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBe(3);
  });

  test('POST /:id/wont-do (admin-session-only) leaves agentTaskId unchanged', async () => {
    const created = await createLinkedTicket('wont-do untouched (agentTaskId)');
    // owner=HUMAN, status=DEFINITION (!= DONE) already satisfies the guard.

    const resp = await admin.post(`/api/tickets/${created.id}/wont-do`, { data: {} });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBe(3);
  });

  test('POST /:id/hand-to-ai (admin-session-only) leaves agentTaskId unchanged', async () => {
    const created = await createLinkedTicket('hand-to-ai untouched (agentTaskId)');
    // status=DEFINITION already satisfies the guard.

    const resp = await admin.post(`/api/tickets/${created.id}/hand-to-ai`);
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBe(3);
  });

  test('PATCH /:id/status leaves agentTaskId unchanged', async () => {
    const created = await createLinkedTicket('status untouched (agentTaskId)');

    const resp = await admin.patch(`/api/tickets/${created.id}/status`, { data: { status: 'TODO' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBe(3);
  });

  test('PATCH /:id/owner leaves agentTaskId unchanged', async () => {
    const created = await createLinkedTicket('owner untouched (agentTaskId)');

    const resp = await admin.patch(`/api/tickets/${created.id}/owner`, { data: { owner: 'AI' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBe(3);
  });

  test('POST /:id/comments leaves agentTaskId unchanged', async () => {
    const created = await createLinkedTicket('comments untouched (agentTaskId)');

    const resp = await admin.post(`/api/tickets/${created.id}/comments`, { data: { body: 'Just a note.' } });
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Ticket;
    expect(body.agentTaskId).toBe(3);
  });
});

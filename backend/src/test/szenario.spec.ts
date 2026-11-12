/**
 * Playwright API tests for the Szenarien CRUD routes.
 *
 * Covers:
 *   GET  /api/szenarien         — 200, array shape, seeded "Standard-Szenario" present
 *   POST /api/szenarien         — 201, body shape, JSON round-trip of works/waits arrays
 *   GET  /api/szenarien/:id     — 200 for created; 404 for unknown
 *   PUT  /api/szenarien/:id     — 200, mutation reflected by GET
 *   DELETE /api/szenarien/:id   — 204; subsequent GET → 404
 *   Auth: no session → 401 (requireAuth only, no requireRole)
 *   Validation: missing name → 400 + fieldErrors.name
 *               wrong works length → 400 + fieldErrors key (all 4 processes)
 *               wrong waits length → 400 + fieldErrors key (all 4 processes)
 *               negative duration → 400
 *               duration > 479520 → 400
 *   Duplicate name → 409 with message
 *   Persistence: re-fetched humanSteps.works exactly matches the 19-element array sent;
 *                agileKiSteps round-trips element-by-element with values distinct from
 *                humanSteps, so a column-swap bug in create()/update() would be caught.
 *   Seed: after startup, the seeded Standard-Szenario (id=1) reflects the 4-process
 *         canonical totals (3,880 / 2,190 / 445 / 65) and has a valid 19-length
 *         agileKiSteps. The pre-existing-DB ALTER/upgrade path (adding the
 *         agileKiSteps column to an old 3-process DB) is NOT exercised here — it
 *         is a manual/scripted check (see PLAN-RECHNER-OVERHAUL.md §8), not
 *         automatable against the fresh CI DB this harness always starts with.
 *
 * Structural validation (CALCULATOR-SELECTABLE-STEPS, REQ-301/REQ-302):
 * `PROCESS_STEP_COUNTS` and its fixed-length rules are gone. Each of the four
 * processes (humanSteps/agileKiSteps/semiAutomatedSteps/automatedSteps) now
 * independently requires works.length in [1, 50] and waits.length === works.length - 1,
 * enforced by a cross-field superRefine with an explicit error path (so the
 * fieldErrors key stays `<process>.waits`). An optional `names` array, when
 * present, must match works.length (`<process>.names` on mismatch) and each
 * entry is capped at 200 characters. 19/19/11/2 (human/agileKi/semi/automated)
 * remains the seed default and a still-valid shape — it is no longer the only
 * valid shape.
 */
import { test, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loginCtx } from './helpers.js';

const BASE_URL = 'http://localhost:7070';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

// Valid 19-element works array (element 0 is 0 per convention)
const HUMAN_WORKS_19: number[] = [
  0, 60, 30, 60, 30, 15, 240, 30, 60, 60, 30, 15, 120, 15, 120, 20, 20, 15, 60,
];
// Valid 18-element waits array
const HUMAN_WAITS_18: number[] = [
  120, 120, 120, 960, 480, 0, 30, 120, 120, 120, 30, 240, 60, 0, 30, 240, 30, 60,
];

// agileKiSteps test values are intentionally DISTINCT from HUMAN_WORKS_19 /
// HUMAN_WAITS_18 (both are also 19/18-length arrays) so that a column-swap
// bug in szenarioService create()/update() — e.g. writing humanSteps' JSON
// into the agileKiSteps column or vice versa — is caught by the round-trip
// assertions below instead of silently passing on identical data.
const AGILE_KI_WORKS_19: number[] = [
  0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
];
const AGILE_KI_WAITS_18: number[] = [
  10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10,
];

// Used ONLY in the PUT round-trip test, in place of AGILE_KI_WORKS_19/
// AGILE_KI_WAITS_18. If the PUT test resent the same creation-time
// constants, the round-trip assertion would pass even if update() dropped
// agileKiSteps from its SET clause entirely (GET would still echo back the
// value written at create() time). Offsetting by +1 forces the assertion to
// fail unless update() actually persists the newly sent values.
const AGILE_KI_WORKS_19_ALT: number[] = AGILE_KI_WORKS_19.map((w) => w + 1);
const AGILE_KI_WAITS_18_ALT: number[] = AGILE_KI_WAITS_18.map((w) => w + 1);

const SEMI_WORKS_11: number[] = [0, 5, 10, 11, 5, 10, 11, 5, 11, 30, 22];
const SEMI_WAITS_10: number[] = [5, 60, 5, 60, 60, 5, 60, 5, 60, 5];

const AUTO_WORKS_2: number[] = [0, 60];
const AUTO_WAITS_1: number[] = [5];

// Seed-exact values for the "Seed defaults" suite below — kept as separate
// constants from AGILE_KI_WORKS_19/AGILE_KI_WAITS_18 (the CRUD-test payload
// values) even though the works arrays happen to coincide, because the two
// constants serve different purposes: these assert against the real seed
// written by szenarioSeed.ts, the others exist to catch column swaps in
// arbitrary CRUD payloads. SEMI_WORKS_11/SEMI_WAITS_10/AUTO_WORKS_2/AUTO_WAITS_1
// above are already seed-exact, so no separate SEED_* constants are needed
// for those two processes.
const SEED_AGILE_KI_WORKS: number[] = [
  0, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
];
// Own literal (halved from HUMAN_WAITS_18 starting at step 5) — must stay
// byte-identical to AGILE_KI_WAITS in szenarioSeed.ts / migrate.ts. Deliberately
// NOT `= HUMAN_WAITS_18` (that would make this assertion pass even if the seed's
// agileKiSteps waits were wrong, as long as they happened to equal the human waits).
const SEED_AGILE_KI_WAITS: number[] = [
  120, 120, 120, 960, 240, 0, 15, 60, 60, 60, 15, 120, 30, 0, 15, 120, 15, 30,
];

/** Build a minimal valid szenario payload with a unique name. */
function validPayload(name: string) {
  return {
    name,
    humanSteps: { works: HUMAN_WORKS_19, waits: HUMAN_WAITS_18 },
    agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
    semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
    automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
  };
}

interface ProzessDauer {
  works: number[];
  waits: number[];
  names?: string[];
}

interface SzenarioDTO {
  id: number;
  name: string;
  humanSteps: ProzessDauer;
  agileKiSteps: ProzessDauer;
  semiAutomatedSteps: ProzessDauer;
  automatedSteps: ProzessDauer;
  createdAt: string;
  updatedAt: string;
}

interface ErrorBody {
  status: number;
  message: string;
  timestamp: string;
  fieldErrors: Record<string, string>;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}

// ---------------------------------------------------------------------------
// Helpers for variable-length step arrays (REQ-301 / REQ-302).
// The fixed HUMAN_WORKS_19 / AGILE_KI_WORKS_19 / etc. constants above only
// exist at the old default lengths; these build synthetic, internally
// consistent arrays at any length so the new structural rule can be tested
// away from the old fixed boundaries.
// ---------------------------------------------------------------------------

/** Build a synthetic `works` array of the given length; every entry is a valid, in-range duration (10 minutes). */
function buildWorks(length: number): number[] {
  return Array.from({ length }, () => 10);
}

/** Build a synthetic `waits` array of the given length; every entry is a valid, in-range duration (5 minutes). */
function buildWaits(length: number): number[] {
  return Array.from({ length }, () => 5);
}

/** Build a synthetic `names` array of the given length: "Name 1", "Name 2", ... */
function buildNames(length: number): string[] {
  return Array.from({ length }, (_, i) => `Name ${i + 1}`);
}

type ProcessKey = 'humanSteps' | 'agileKiSteps' | 'semiAutomatedSteps' | 'automatedSteps';

/**
 * Build a full, otherwise-valid szenario payload (via validPayload()) with a
 * single process overridden. Used so only the process under test deviates
 * from the known-good default shape. Returns a loosely-typed object (not
 * `any`) since it exists only to be handed straight to `adminCtx.post`/`.put`.
 */
function payloadWithProcessOverride(
  name: string,
  process: ProcessKey,
  override: { works: number[]; waits: number[]; names?: string[] }
): Record<string, unknown> {
  const base = validPayload(name) as Record<string, unknown>;
  return { ...base, [process]: override };
}

// ---------------------------------------------------------------------------
// Suite: CRUD happy path
// ---------------------------------------------------------------------------

test.describe('CRUD happy path', () => {
  let adminCtx: APIRequestContext;
  let anonCtx: APIRequestContext;
  let createdId: number | undefined;
  let createdName: string;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
    anonCtx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  });

  test.afterAll(async () => {
    // Clean up: the DELETE test handles this, but guard against test failure.
    if (createdId !== undefined) {
      await adminCtx.delete(`/api/szenarien/${createdId}`).catch(() => undefined);
    }
    await adminCtx.dispose();
    await anonCtx.dispose();
  });

  // ── GET list ───────────────────────────────────────────────────────────────

  test('GET /api/szenarien returns 200 and an array', async () => {
    const resp = await adminCtx.get('/api/szenarien');

    await test.step('status 200', () => {
      expect(resp.status()).toBe(200);
    });

    const body = await resp.json() as unknown[];

    await test.step('body is an array', () => {
      expect(Array.isArray(body)).toBe(true);
    });
  });

  test('GET /api/szenarien list contains the seeded Standard-Szenario by id=1', async () => {
    const resp = await adminCtx.get('/api/szenarien');
    const body = await resp.json() as SzenarioDTO[];

    await test.step('at least one row exists (seeded row present)', () => {
      expect(body.length).toBeGreaterThan(0);
    });

    const seeded = body.find((s) => s.id === 1);

    await test.step('row with id=1 (Standard-Szenario) found in list', () => {
      expect(seeded).toBeDefined();
    });

    await test.step('seeded row has name Standard-Szenario', () => {
      expect(seeded?.name).toBe('Standard-Szenario');
    });
  });

  // ── POST create ────────────────────────────────────────────────────────────

  test('POST /api/szenarien returns 201 with correct body shape', async () => {
    createdName = `Test-Szenario-${Date.now()}`;
    const resp = await adminCtx.post('/api/szenarien', {
      data: validPayload(createdName),
    });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    const body = await resp.json() as SzenarioDTO;

    await test.step('id is a positive integer', () => {
      expect(typeof body.id).toBe('number');
      expect(body.id).toBeGreaterThan(0);
    });

    await test.step('name matches submitted value', () => {
      expect(body.name).toBe(createdName);
    });

    await test.step('createdAt is a non-empty string', () => {
      expect(typeof body.createdAt).toBe('string');
      expect(body.createdAt.length).toBeGreaterThan(0);
    });

    await test.step('updatedAt is a non-empty string', () => {
      expect(typeof body.updatedAt).toBe('string');
      expect(body.updatedAt.length).toBeGreaterThan(0);
    });

    await test.step('humanSteps is present', () => {
      expect(body.humanSteps).toBeDefined();
    });

    await test.step('agileKiSteps is present', () => {
      expect(body.agileKiSteps).toBeDefined();
    });

    await test.step('semiAutomatedSteps is present', () => {
      expect(body.semiAutomatedSteps).toBeDefined();
    });

    await test.step('automatedSteps is present', () => {
      expect(body.automatedSteps).toBeDefined();
    });

    createdId = body.id;
  });

  // ── Persistence round-trip ────────────────────────────────────────────────

  test('humanSteps.works round-trips exactly as the 19-element array sent', async () => {
    test.skip(createdId === undefined, 'POST did not return an id');

    const resp = await adminCtx.get(`/api/szenarien/${createdId}`);
    expect(resp.status()).toBe(200);

    const body = await resp.json() as SzenarioDTO;

    await test.step('works array has exactly 19 elements', () => {
      expect(body.humanSteps.works.length).toBe(19);
    });

    await test.step('every works element matches the sent value', () => {
      for (let i = 0; i < 19; i++) {
        expect(body.humanSteps.works[i]).toBe(HUMAN_WORKS_19[i]);
      }
    });

    await test.step('waits array has exactly 18 elements', () => {
      expect(body.humanSteps.waits.length).toBe(18);
    });
  });

  test('agileKiSteps round-trips exactly, with values distinct from humanSteps (column-swap guard)', async () => {
    test.skip(createdId === undefined, 'POST did not return an id');

    const resp = await adminCtx.get(`/api/szenarien/${createdId}`);
    expect(resp.status()).toBe(200);

    const body = await resp.json() as SzenarioDTO;

    await test.step('agileKiSteps.works has exactly 19 elements', () => {
      expect(body.agileKiSteps.works.length).toBe(19);
    });

    await test.step('every agileKiSteps.works element matches the sent value', () => {
      for (let i = 0; i < 19; i++) {
        expect(body.agileKiSteps.works[i]).toBe(AGILE_KI_WORKS_19[i]);
      }
    });

    await test.step('agileKiSteps.waits has exactly 18 elements', () => {
      expect(body.agileKiSteps.waits.length).toBe(18);
    });

    await test.step('every agileKiSteps.waits element matches the sent value', () => {
      for (let i = 0; i < 18; i++) {
        expect(body.agileKiSteps.waits[i]).toBe(AGILE_KI_WAITS_18[i]);
      }
    });

    await test.step('agileKiSteps.works differs from humanSteps.works (would fail on a column swap)', () => {
      expect(body.agileKiSteps.works).not.toEqual(body.humanSteps.works);
    });

    await test.step('agileKiSteps.waits differs from humanSteps.waits (would fail on a column swap)', () => {
      expect(body.agileKiSteps.waits).not.toEqual(body.humanSteps.waits);
    });
  });

  // ── GET list finds the created item ───────────────────────────────────────

  test('GET /api/szenarien list contains the newly created szenario by id', async () => {
    test.skip(createdId === undefined, 'POST did not return an id');

    const resp = await adminCtx.get('/api/szenarien');
    const body = await resp.json() as SzenarioDTO[];
    const found = body.find((s) => s.id === createdId);

    await test.step('created szenario appears in list', () => {
      expect(found).toBeDefined();
    });

    await test.step('name in list matches', () => {
      expect(found?.name).toBe(createdName);
    });
  });

  // ── GET /:id ───────────────────────────────────────────────────────────────

  test('GET /api/szenarien/:id returns 200 for the created szenario', async () => {
    test.skip(createdId === undefined, 'POST did not return an id');

    const resp = await adminCtx.get(`/api/szenarien/${createdId}`);

    await test.step('status 200', () => {
      expect(resp.status()).toBe(200);
    });

    const body = await resp.json() as SzenarioDTO;

    await test.step('returned id matches', () => {
      expect(body.id).toBe(createdId);
    });
  });

  // ── PUT update ────────────────────────────────────────────────────────────

  test('PUT /api/szenarien/:id returns 200 and change is reflected by GET', async () => {
    test.skip(createdId === undefined, 'POST did not return an id');

    // Deliberately do NOT reuse validPayload()'s agileKiSteps values here.
    // The row was created (above) with AGILE_KI_WORKS_19/AGILE_KI_WAITS_18;
    // resending those same constants in the PUT would make the round-trip
    // assertion pass even if update() silently dropped agileKiSteps from its
    // SET clause (GET would still echo back the value written at create()
    // time). Sending the _ALT variants and asserting GET reflects THEM
    // proves update() actually persists the column. humanSteps stays on its
    // own distinct constants throughout, so the column-swap guard elsewhere
    // in this suite is unaffected.
    const updatedName = `Updated-Szenario-${Date.now()}`;
    const putResp = await adminCtx.put(`/api/szenarien/${createdId}`, {
      data: {
        name: updatedName,
        humanSteps: { works: HUMAN_WORKS_19, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: AGILE_KI_WORKS_19_ALT, waits: AGILE_KI_WAITS_18_ALT },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('PUT returns 200', () => {
      expect(putResp.status()).toBe(200);
    });

    const putBody = await putResp.json() as SzenarioDTO;

    await test.step('PUT response contains updated name', () => {
      expect(putBody.name).toBe(updatedName);
    });

    const getResp = await adminCtx.get(`/api/szenarien/${createdId}`);

    await test.step('subsequent GET returns 200', () => {
      expect(getResp.status()).toBe(200);
    });

    const getBody = await getResp.json() as SzenarioDTO;

    await test.step('GET name reflects the update', () => {
      expect(getBody.name).toBe(updatedName);
    });

    await test.step('GET agileKiSteps.works reflects the NEW value sent in the PUT (proves update() writes the column)', () => {
      expect(getBody.agileKiSteps.works).toEqual(AGILE_KI_WORKS_19_ALT);
    });

    await test.step('GET agileKiSteps.waits reflects the NEW value sent in the PUT', () => {
      expect(getBody.agileKiSteps.waits).toEqual(AGILE_KI_WAITS_18_ALT);
    });

    await test.step('GET agileKiSteps.works differs from the value used at creation (not a stale echo)', () => {
      expect(getBody.agileKiSteps.works).not.toEqual(AGILE_KI_WORKS_19);
    });

    // Keep the name tracking consistent for cleanup
    createdName = updatedName;
  });

  // ── DELETE ────────────────────────────────────────────────────────────────

  test('DELETE /api/szenarien/:id returns 204; subsequent GET returns 404', async () => {
    test.skip(createdId === undefined, 'POST did not return an id');

    const deleteResp = await adminCtx.delete(`/api/szenarien/${createdId}`);

    await test.step('DELETE returns 204', () => {
      expect(deleteResp.status()).toBe(204);
    });

    const getResp = await adminCtx.get(`/api/szenarien/${createdId}`);

    await test.step('subsequent GET returns 404', () => {
      expect(getResp.status()).toBe(404);
    });

    // Prevent afterAll cleanup from issuing a second DELETE on a gone row
    createdId = undefined;
  });

  // ── Not found ─────────────────────────────────────────────────────────────

  test('GET /api/szenarien/99999 returns 404 with standard error body', async () => {
    const resp = await adminCtx.get('/api/szenarien/99999');

    await test.step('status 404', () => {
      expect(resp.status()).toBe(404);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('error body status field is 404', () => {
      expect(body.status).toBe(404);
    });

    await test.step('error body has non-empty message', () => {
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
    });

    await test.step('error body has timestamp string', () => {
      expect(typeof body.timestamp).toBe('string');
      expect(body.timestamp.length).toBeGreaterThan(0);
    });

    await test.step('error body has fieldErrors object', () => {
      expect(typeof body.fieldErrors).toBe('object');
      expect(body.fieldErrors).not.toBeNull();
    });
  });

  // ── Auth: unauthenticated → 401 ───────────────────────────────────────────

  test('GET /api/szenarien without session returns 401', async () => {
    const resp = await anonCtx.get('/api/szenarien');
    expect(resp.status()).toBe(401);
  });

  test('POST /api/szenarien without session returns 401', async () => {
    const resp = await anonCtx.post('/api/szenarien', {
      data: validPayload(`Anon-${Date.now()}`),
    });
    expect(resp.status()).toBe(401);
  });

  test('PUT /api/szenarien/1 without session returns 401', async () => {
    const resp = await anonCtx.put('/api/szenarien/1', {
      data: validPayload('Standard-Szenario'),
    });
    expect(resp.status()).toBe(401);
  });

  test('DELETE /api/szenarien/1 without session returns 401', async () => {
    const resp = await anonCtx.delete('/api/szenarien/1');
    expect(resp.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Suite: Validation errors
// ---------------------------------------------------------------------------

test.describe('Validation errors', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    await adminCtx.dispose();
  });

  // ── Missing name ──────────────────────────────────────────────────────────

  test('POST with missing name → 400 with fieldErrors.name', async () => {
    const payload = {
      // no name field
      humanSteps: { works: HUMAN_WORKS_19, waits: HUMAN_WAITS_18 },
      agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
      semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
      automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
    };

    const resp = await adminCtx.post('/api/szenarien', { data: payload });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors.name is present', () => {
      expect(typeof body.fieldErrors?.['name']).toBe('string');
    });
  });

  test('POST with empty name → 400 with fieldErrors.name', async () => {
    const resp = await adminCtx.post('/api/szenarien', {
      data: { ...validPayload(''), name: '' },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors.name is present', () => {
      expect(typeof body.fieldErrors?.['name']).toBe('string');
    });
  });

  // ── humanSteps.works shortened to 18, waits left at the old 18 → under the
  // new structural rule this is a works/waits MISMATCH (18 works needs 17
  // waits), not "wrong fixed length 19". The field-error key moves from
  // humanSteps.works to humanSteps.waits, per the superRefine's explicit path.

  test('POST with humanSteps.works length 18 (waits still 18, needs 17) → 400 works/waits mismatch on humanSteps.waits', async () => {
    const shortWorks = HUMAN_WORKS_19.slice(0, 18); // 18 elements; waits stays at the old 18, which no longer matches (18 works needs exactly 17 waits)

    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name: `Invalid-Works-${Date.now()}`,
        humanSteps: { works: shortWorks, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains a humanSteps.waits key (the superRefine path), not humanSteps.works', () => {
      expect(typeof body.fieldErrors?.['humanSteps.waits']).toBe('string');
      expect(body.fieldErrors?.['humanSteps.works']).toBeUndefined();
    });
  });

  // ── humanSteps.waits shortened to 17, works left at the old 19 → still a
  // works/waits MISMATCH under the new rule (19 works needs exactly 18
  // waits, not 17) — same field-error key as before, but for the new reason.

  test('POST with humanSteps.waits length 17 (works still 19, needs 18) → 400 works/waits mismatch on humanSteps.waits', async () => {
    const shortWaits = HUMAN_WAITS_18.slice(0, 17); // 17 elements; works stays at 19, which requires exactly 18 waits

    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name: `Invalid-Waits-${Date.now()}`,
        humanSteps: { works: HUMAN_WORKS_19, waits: shortWaits },
        agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains a humanSteps.waits key', () => {
      expect(typeof body.fieldErrors?.['humanSteps.waits']).toBe('string');
    });
  });

  // ── Negative duration ─────────────────────────────────────────────────────

  test('POST with a negative duration value → 400', async () => {
    const worksWithNegative: number[] = [...HUMAN_WORKS_19];
    worksWithNegative[5] = -1;

    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name: `Negative-Duration-${Date.now()}`,
        humanSteps: { works: worksWithNegative, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors is an object', () => {
      expect(typeof body.fieldErrors).toBe('object');
      expect(body.fieldErrors).not.toBeNull();
    });
  });

  // ── Duration exceeds 479520 ───────────────────────────────────────────────

  test('POST with duration > 479520 → 400', async () => {
    const worksOverMax: number[] = [...HUMAN_WORKS_19];
    worksOverMax[5] = 479521;

    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name: `Over-Max-Duration-${Date.now()}`,
        humanSteps: { works: worksOverMax, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors is an object', () => {
      expect(typeof body.fieldErrors).toBe('object');
      expect(body.fieldErrors).not.toBeNull();
    });
  });

  // ── Boundary: exactly 479520 is valid ─────────────────────────────────────

  test('POST with duration exactly 479520 → 201 (boundary is inclusive)', async () => {
    const worksAtMax: number[] = [...HUMAN_WORKS_19];
    worksAtMax[1] = 479520;

    const name = `At-Max-Duration-${Date.now()}`;
    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name,
        humanSteps: { works: worksAtMax, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    // Clean up
    const body = await resp.json() as SzenarioDTO;
    if (body.id) {
      await adminCtx.delete(`/api/szenarien/${body.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Suite: Duplicate name → 409
// ---------------------------------------------------------------------------

test.describe('Duplicate name → 409', () => {
  let adminCtx: APIRequestContext;
  let createdId: number | undefined;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    if (createdId !== undefined) {
      await adminCtx.delete(`/api/szenarien/${createdId}`).catch(() => undefined);
    }
    await adminCtx.dispose();
  });

  test('POST same name twice → second request returns 409 with message', async () => {
    const name = `Duplicate-${Date.now()}`;

    // First create
    const first = await adminCtx.post('/api/szenarien', { data: validPayload(name) });

    await test.step('first POST returns 201', () => {
      expect(first.status()).toBe(201);
    });

    const firstBody = await first.json() as SzenarioDTO;
    createdId = firstBody.id;

    // Second create with same name
    const second = await adminCtx.post('/api/szenarien', { data: validPayload(name) });

    await test.step('second POST returns 409', () => {
      expect(second.status()).toBe(409);
    });

    const secondBody = await second.json() as ErrorBody;

    await test.step('error body status field is 409', () => {
      expect(secondBody.status).toBe(409);
    });

    await test.step('error body has non-empty message', () => {
      expect(typeof secondBody.message).toBe('string');
      expect(secondBody.message.length).toBeGreaterThan(0);
    });
  });

  test('PUT with a name already used by another row → 409', async () => {
    // Use the seeded "Standard-Szenario" (id=1) as the existing name target.
    // Create a fresh szenario, then try to rename it to "Standard-Szenario".
    const name = `Rename-Test-${Date.now()}`;
    const createResp = await adminCtx.post('/api/szenarien', { data: validPayload(name) });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as SzenarioDTO;
    const tempId = created.id;

    const putResp = await adminCtx.put(`/api/szenarien/${tempId}`, {
      data: validPayload('Standard-Szenario'),
    });

    await test.step('PUT returns 409', () => {
      expect(putResp.status()).toBe(409);
    });

    // Clean up the temp row
    await adminCtx.delete(`/api/szenarien/${tempId}`);
  });
});

// ---------------------------------------------------------------------------
// Suite: semiAutomatedSteps and automatedSteps validation
// ---------------------------------------------------------------------------

test.describe('Validation for semiAutomated and automated step counts', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    await adminCtx.dispose();
  });

  // ── semiAutomatedSteps.works shortened to 10, waits left at the old 10 →
  // a works/waits MISMATCH under the new rule (10 works needs 9 waits, not
  // 10), not "wrong fixed length 11". The key moves to semiAutomatedSteps.waits.

  test('POST with semiAutomatedSteps.works length 10 (waits still 10, needs 9) → 400 works/waits mismatch on semiAutomatedSteps.waits', async () => {
    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name: `Invalid-Semi-Works-${Date.now()}`,
        humanSteps: { works: HUMAN_WORKS_19, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
        semiAutomatedSteps: { works: SEMI_WORKS_11.slice(0, 10), waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains a semiAutomatedSteps.waits key, not semiAutomatedSteps.works', () => {
      expect(typeof body.fieldErrors?.['semiAutomatedSteps.waits']).toBe('string');
      expect(body.fieldErrors?.['semiAutomatedSteps.works']).toBeUndefined();
    });
  });

  // ── automatedSteps.waits emptied to 0, works left at the old 2 → still a
  // works/waits MISMATCH under the new rule (2 works needs exactly 1 wait,
  // not 0) — same field-error key as before, but for the new reason.

  test('POST with automatedSteps.waits length 0 (works still 2, needs 1) → 400 works/waits mismatch on automatedSteps.waits', async () => {
    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name: `Invalid-Auto-Waits-${Date.now()}`,
        humanSteps: { works: HUMAN_WORKS_19, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: AGILE_KI_WORKS_19, waits: AGILE_KI_WAITS_18 },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: [] },
      },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains automatedSteps.waits key', () => {
      expect(typeof body.fieldErrors?.['automatedSteps.waits']).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: agileKiSteps validation (4th process, added by RECHNER-OVERHAUL)
// ---------------------------------------------------------------------------

test.describe('Validation for agileKiSteps step counts', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    await adminCtx.dispose();
  });

  // ── agileKiSteps.works shortened to 18, waits left at the old 18 → under
  // the new structural rule this is a works/waits MISMATCH (18 works needs
  // 17 waits), not "wrong fixed length 19". The key moves from
  // agileKiSteps.works to agileKiSteps.waits, exactly like the humanSteps.works
  // case above — this suite is the one most likely to be skipped in a
  // rewrite, since agileKiSteps was added later than the other three processes.

  test('POST with agileKiSteps.works length 18 (waits still 18, needs 17) → 400 works/waits mismatch on agileKiSteps.waits', async () => {
    const shortWorks = AGILE_KI_WORKS_19.slice(0, 18); // 18 elements; waits stays at the old 18, which no longer matches (18 works needs exactly 17 waits)

    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name: `Invalid-AgileKi-Works-${Date.now()}`,
        humanSteps: { works: HUMAN_WORKS_19, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: shortWorks, waits: AGILE_KI_WAITS_18 },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains an agileKiSteps.waits key (the superRefine path), not agileKiSteps.works', () => {
      expect(typeof body.fieldErrors?.['agileKiSteps.waits']).toBe('string');
      expect(body.fieldErrors?.['agileKiSteps.works']).toBeUndefined();
    });
  });

  // ── agileKiSteps.waits shortened to 17, works left at the old 19 → still a
  // works/waits MISMATCH under the new rule (19 works needs exactly 18
  // waits, not 17) — re-justified against the new rule, same field-error
  // key as before. Skipping this test would leave it passing with an
  // unchanged key even if agileKiSteps never got converted to the
  // structural rules at all.

  test('POST with agileKiSteps.waits length 17 (works still 19, needs 18) → 400 works/waits mismatch on agileKiSteps.waits', async () => {
    const shortWaits = AGILE_KI_WAITS_18.slice(0, 17); // 17 elements; works stays at 19, which requires exactly 18 waits

    const resp = await adminCtx.post('/api/szenarien', {
      data: {
        name: `Invalid-AgileKi-Waits-${Date.now()}`,
        humanSteps: { works: HUMAN_WORKS_19, waits: HUMAN_WAITS_18 },
        agileKiSteps: { works: AGILE_KI_WORKS_19, waits: shortWaits },
        semiAutomatedSteps: { works: SEMI_WORKS_11, waits: SEMI_WAITS_10 },
        automatedSteps: { works: AUTO_WORKS_2, waits: AUTO_WAITS_1 },
      },
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains an agileKiSteps.waits key', () => {
      expect(typeof body.fieldErrors?.['agileKiSteps.waits']).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: variable step counts (REQ-301) — proves the new structural rule
// genuinely ACCEPTS a non-default, internally-consistent step count. Every
// negative test above this point stays a 400 test; none of them would fail
// if variable step counts were rejected outright. These positive tests are
// the load-bearing ones.
// ---------------------------------------------------------------------------

test.describe('Validation for variable step counts (REQ-301)', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    await adminCtx.dispose();
  });

  test('POST with humanSteps 25 works / 24 waits (non-default) → 201, round-trips unchanged', async () => {
    const works = buildWorks(25);
    const waits = buildWaits(24);
    const name = `Variable-Human-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'humanSteps', { works, waits }),
    });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    const body = await resp.json() as SzenarioDTO;
    const getResp = await adminCtx.get(`/api/szenarien/${body.id}`);
    const getBody = await getResp.json() as SzenarioDTO;

    await test.step('humanSteps.works round-trips unchanged at 25 elements', () => {
      expect(getBody.humanSteps.works).toEqual(works);
    });

    await test.step('humanSteps.waits round-trips unchanged at 24 elements', () => {
      expect(getBody.humanSteps.waits).toEqual(waits);
    });

    await adminCtx.delete(`/api/szenarien/${body.id}`);
  });

  // agileKiSteps specifically: this file's shared constants and helpers lean
  // on humanSteps, so a generic "non-default count" test would default to
  // humanSteps and leave the other three processes — especially
  // agileKiSteps — with zero positive coverage.
  test('POST with agileKiSteps 25 works / 24 waits (non-default) → 201, round-trips unchanged', async () => {
    const works = buildWorks(25);
    const waits = buildWaits(24);
    const name = `Variable-AgileKi-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'agileKiSteps', { works, waits }),
    });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    const body = await resp.json() as SzenarioDTO;
    const getResp = await adminCtx.get(`/api/szenarien/${body.id}`);
    const getBody = await getResp.json() as SzenarioDTO;

    await test.step('agileKiSteps.works round-trips unchanged at 25 elements', () => {
      expect(getBody.agileKiSteps.works).toEqual(works);
    });

    await test.step('agileKiSteps.waits round-trips unchanged at 24 elements', () => {
      expect(getBody.agileKiSteps.waits).toEqual(waits);
    });

    await adminCtx.delete(`/api/szenarien/${body.id}`);
  });

  test('POST with semiAutomatedSteps 1 work / 0 waits (floor boundary) → 201', async () => {
    const name = `Variable-Floor-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'semiAutomatedSteps', {
        works: buildWorks(1),
        waits: buildWaits(0),
      }),
    });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    const body = await resp.json() as SzenarioDTO;
    await adminCtx.delete(`/api/szenarien/${body.id}`);
  });

  test('POST with automatedSteps 50 works / 49 waits (cap boundary) → 201', async () => {
    const name = `Variable-Cap-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'automatedSteps', {
        works: buildWorks(50),
        waits: buildWaits(49),
      }),
    });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    const body = await resp.json() as SzenarioDTO;
    await adminCtx.delete(`/api/szenarien/${body.id}`);
  });

  test('POST with humanSteps 51 works (over the cap) → 400', async () => {
    const name = `Variable-OverCap-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'humanSteps', {
        works: buildWorks(51),
        waits: buildWaits(50), // matches the works/waits rule, so this isolates the cap violation
      }),
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains a humanSteps.works key', () => {
      expect(typeof body.fieldErrors?.['humanSteps.works']).toBe('string');
    });
  });

  test('POST with humanSteps 0 works → 400', async () => {
    const name = `Variable-ZeroWorks-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'humanSteps', {
        works: [],
        waits: [],
      }),
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors is an object', () => {
      expect(typeof body.fieldErrors).toBe('object');
      expect(body.fieldErrors).not.toBeNull();
    });
  });

  test('POST with humanSteps 20 works / 15 waits (non-default count, mismatched) → 400 with fieldErrors key naming humanSteps.waits', async () => {
    const name = `Variable-Mismatch-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'humanSteps', {
        works: buildWorks(20), // needs exactly 19 waits
        waits: buildWaits(15),
      }),
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains a humanSteps.waits key, proving the mismatch check works at non-default counts too', () => {
      expect(typeof body.fieldErrors?.['humanSteps.waits']).toBe('string');
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: backward compatibility — legacy shape through the real validator
// (REQ-301). The seed test below only reads the seeded row back with a GET,
// which never runs through request validation. These tests prove the legacy
// 19/19/11/2 shape, with no names field, still passes POST/PUT validation.
// ---------------------------------------------------------------------------

test.describe('Backward compatibility — legacy shape (REQ-301)', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    await adminCtx.dispose();
  });

  test('POST with the exact legacy 19/19/11/2 shape, no names field → 201', async () => {
    const name = `Legacy-Shape-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', { data: validPayload(name) });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    const body = await resp.json() as SzenarioDTO;

    await test.step('humanSteps.works has 19 elements', () => {
      expect(body.humanSteps.works.length).toBe(19);
    });

    await test.step('agileKiSteps.works has 19 elements', () => {
      expect(body.agileKiSteps.works.length).toBe(19);
    });

    await test.step('semiAutomatedSteps.works has 11 elements', () => {
      expect(body.semiAutomatedSteps.works.length).toBe(11);
    });

    await test.step('automatedSteps.works has 2 elements', () => {
      expect(body.automatedSteps.works.length).toBe(2);
    });

    await adminCtx.delete(`/api/szenarien/${body.id}`);
  });

  test('PUT with the exact legacy 19/19/11/2 shape, no names field → 200', async () => {
    // Create a throwaway row to PUT against; its own initial shape does not
    // matter — only the PUT payload below is what gets validated.
    const createResp = await adminCtx.post('/api/szenarien', {
      data: validPayload(`Legacy-Put-Base-${Date.now()}`),
    });
    expect(createResp.status()).toBe(201);
    const created = await createResp.json() as SzenarioDTO;

    const updatedName = `Legacy-Put-${Date.now()}`;
    const putResp = await adminCtx.put(`/api/szenarien/${created.id}`, {
      data: validPayload(updatedName),
    });

    await test.step('status 200', () => {
      expect(putResp.status()).toBe(200);
    });

    const putBody = await putResp.json() as SzenarioDTO;

    await test.step('name reflects the PUT', () => {
      expect(putBody.name).toBe(updatedName);
    });

    await test.step('humanSteps.works has 19 elements', () => {
      expect(putBody.humanSteps.works.length).toBe(19);
    });

    await adminCtx.delete(`/api/szenarien/${created.id}`);
  });
});

// ---------------------------------------------------------------------------
// Suite: step names (REQ-302)
// ---------------------------------------------------------------------------

test.describe('Validation for step names (REQ-302)', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    await adminCtx.dispose();
  });

  test('POST with humanSteps.names length matching works.length → 201, round-trips', async () => {
    const names = buildNames(19); // matches HUMAN_WORKS_19's length
    const name = `Names-Match-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'humanSteps', {
        works: HUMAN_WORKS_19,
        waits: HUMAN_WAITS_18,
        names,
      }),
    });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    const body = await resp.json() as SzenarioDTO;
    const getResp = await adminCtx.get(`/api/szenarien/${body.id}`);
    const getBody = await getResp.json() as SzenarioDTO;

    await test.step('humanSteps.names round-trips unchanged', () => {
      expect(getBody.humanSteps.names).toEqual(names);
    });

    await adminCtx.delete(`/api/szenarien/${body.id}`);
  });

  test('POST with no names field on any process → 201, names is absent', async () => {
    const name = `Names-Absent-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', { data: validPayload(name) });

    await test.step('status 201', () => {
      expect(resp.status()).toBe(201);
    });

    const body = await resp.json() as SzenarioDTO;

    await test.step('humanSteps.names is absent (names is optional)', () => {
      expect(body.humanSteps.names).toBeUndefined();
    });

    await adminCtx.delete(`/api/szenarien/${body.id}`);
  });

  test('POST with humanSteps.names length different from works.length → 400 with fieldErrors key naming humanSteps.names', async () => {
    const name = `Names-Mismatch-${Date.now()}`;

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'humanSteps', {
        works: HUMAN_WORKS_19,
        waits: HUMAN_WAITS_18,
        names: buildNames(5), // 19 works, only 5 names
      }),
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains a humanSteps.names key', () => {
      expect(typeof body.fieldErrors?.['humanSteps.names']).toBe('string');
    });
  });

  test('POST with a humanSteps.names entry over 200 characters → 400 with a fieldErrors key under humanSteps.names', async () => {
    const name = `Names-TooLong-${Date.now()}`;
    const names = buildNames(19);
    names[0] = 'a'.repeat(201);

    const resp = await adminCtx.post('/api/szenarien', {
      data: payloadWithProcessOverride(name, 'humanSteps', {
        works: HUMAN_WORKS_19,
        waits: HUMAN_WAITS_18,
        names,
      }),
    });

    await test.step('status 400', () => {
      expect(resp.status()).toBe(400);
    });

    const body = await resp.json() as ErrorBody;

    await test.step('fieldErrors contains a key under humanSteps.names for the over-length entry', () => {
      const matchingKey = Object.keys(body.fieldErrors).find((k) => k.startsWith('humanSteps.names'));
      expect(matchingKey).toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// Suite: Seed defaults — Standard-Szenario reflects the new 4-process totals
//
// This only verifies the fresh-DB seed path, which the Playwright global
// setup always exercises (a clean `crmdb.sqlite` per CI run). The
// pre-existing-DB upgrade path — an old 3-process DB gaining the
// `agileKiSteps` column via `ensureSzenarioAgileKiColumn()` — is not
// automatable in this harness (there is no fixture representing the old
// schema shape to swap in) and is instead a manual/scripted check, see
// PLAN-RECHNER-OVERHAUL.md §8.
// ---------------------------------------------------------------------------

test.describe('Seed defaults — Standard-Szenario reflects canonical totals', () => {
  let adminCtx: APIRequestContext;

  test.beforeAll(async () => {
    adminCtx = await loginCtx('admin', 'admin123');
  });

  test.afterAll(async () => {
    await adminCtx.dispose();
  });

  test('GET /api/szenarien/1 reflects the exact 4-process canonical arrays and totals', async () => {
    const resp = await adminCtx.get('/api/szenarien/1');
    expect(resp.status()).toBe(200);

    const body = await resp.json() as SzenarioDTO;

    await test.step('name is Standard-Szenario', () => {
      expect(body.name).toBe('Standard-Szenario');
    });

    // Exact-array assertions — the point of this test. Summing works+waits
    // alone would pass even if individual elements were shuffled or wrong as
    // long as the total matched; toEqual against the byte-identical seed
    // constants catches that.
    await test.step('humanSteps matches the exact seeded arrays', () => {
      expect(body.humanSteps).toEqual({ works: HUMAN_WORKS_19, waits: HUMAN_WAITS_18 });
    });

    await test.step('agileKiSteps matches the exact seeded arrays', () => {
      expect(body.agileKiSteps).toEqual({ works: SEED_AGILE_KI_WORKS, waits: SEED_AGILE_KI_WAITS });
    });

    await test.step('semiAutomatedSteps matches the exact seeded arrays', () => {
      expect(body.semiAutomatedSteps).toEqual({ works: SEMI_WORKS_11, waits: SEMI_WAITS_10 });
    });

    await test.step('automatedSteps matches the exact seeded arrays', () => {
      expect(body.automatedSteps).toEqual({ works: AUTO_WORKS_2, waits: AUTO_WAITS_1 });
    });

    // Aggregate sums, retained as an easy-to-read cross-check of the totals
    // called out in PLAN-RECHNER-OVERHAUL.md's Canonical section.
    await test.step('humanSteps works+waits sums to 3,880', () => {
      const total = sum(body.humanSteps.works) + sum(body.humanSteps.waits);
      expect(total).toBe(3880);
    });

    await test.step('agileKiSteps works+waits sums to 2,190', () => {
      const total = sum(body.agileKiSteps.works) + sum(body.agileKiSteps.waits);
      expect(total).toBe(2190);
    });

    await test.step('semiAutomatedSteps works+waits sums to 445', () => {
      const total = sum(body.semiAutomatedSteps.works) + sum(body.semiAutomatedSteps.waits);
      expect(total).toBe(445);
    });

    await test.step('automatedSteps works+waits sums to 65', () => {
      const total = sum(body.automatedSteps.works) + sum(body.automatedSteps.waits);
      expect(total).toBe(65);
    });

    await test.step('agileKiSteps.works has exactly 19 elements', () => {
      expect(body.agileKiSteps.works.length).toBe(19);
    });

    await test.step('agileKiSteps.waits has exactly 18 elements', () => {
      expect(body.agileKiSteps.waits.length).toBe(18);
    });
  });
});

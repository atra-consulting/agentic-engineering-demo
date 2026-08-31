/**
 * Playwright tests for the guarded `agentTaskId` column migration
 * (backend/src/config/migrate.ts):
 *   - `ensureTicketAgentTaskIdColumn()` — checks `PRAGMA table_info(ticket)`,
 *     ALTERs when the column is missing, and — unlike
 *     `ensureTicketFullyReadyColumn()` — ALWAYS (re-)creates
 *     `idx_ticket_agentTaskId` afterwards, on both branches. That index lives
 *     inside this helper specifically so it never runs before the column
 *     exists — see the comment on `ensureTicketAgentTaskIdColumn()` itself.
 *   - `alterTicketAddAgentTaskIdColumn()` — the ALTER itself, split out so
 *     this suite can fire it directly against a table that already has the
 *     column, without relying on real concurrency timing to hit the catch
 *     branch.
 *
 * Covers (docs/plans/PLAN-TICKET-UI-LINK-FIXES.md, task group 9 / REQ-202):
 *   1. Repeat-call safety of `ensureTicketAgentTaskIdColumn()`.
 *   2. The duplicate-column ALTER is swallowed by
 *      `alterTicketAddAgentTaskIdColumn()`.
 *   3. A genuinely different SQL error still throws (narrow catch).
 *   4. THE ORDERING REGRESSION GUARD — the one test in this file with real
 *      teeth against the single highest-risk line in the whole PRD (REQ-202):
 *      it simulates a pre-Fix-2 database (index dropped, THEN column
 *      dropped — SQLite refuses to drop a column an index still
 *      references, so this order is required to reach that state at all),
 *      then calls the real, full `runMigrations()` and asserts it does not
 *      throw and that both the column and the index exist afterwards. This
 *      is what would fail if a future change moved `CREATE INDEX
 *      idx_ticket_agentTaskId` back into the shared index batch in
 *      `runMigrations()` (which runs BEFORE the guarded ALTER helpers, and
 *      on any database whose `ticket` table doesn't have the column yet,
 *      would throw `no such column: agentTaskId` and crash startup).
 *   5. A fresh DB gets the column from `CREATE TABLE` with the right
 *      `notnull`/`dflt_value` (nullable, no DEFAULT — unlike `fullyReady`,
 *      which is `NOT NULL DEFAULT 0`), and seeded tickets read
 *      `agentTaskId = null` at the raw-SQL level.
 *
 * Test isolation notes
 * --------------------
 * - This suite runs with `workers: 1` (playwright.config.ts), so all spec
 *   files are serial and ordering is deterministic. This file sorts
 *   alphabetically BEFORE ticketFullyReadyMigration.spec.ts and
 *   tickets.spec.ts (`ticketA...` < `ticketF...` < `tickets...`), but AFTER
 *   agentTasks.spec.ts and agentTaskSeed.spec.ts.
 * - We use `test.describe.serial` because these tests mutate the live
 *   `ticket` table's schema (test 3 renames the table temporarily; test 4
 *   drops its index and a column) and must run in declaration order.
 * - This file creates no ticket ROWS (only schema changes), so it needs no
 *   ticket-table cleanup of its own — unlike agentTasks.spec.ts and
 *   tickets.spec.ts, which create linked tickets and must restore the
 *   TICKET_SEED_COUNT row count before their own files finish (see those
 *   files' header/suite comments). Test 5 below still defensively asserts
 *   the row count before checking values, exactly mirroring the precedent in
 *   ticketFullyReadyMigration.spec.ts, in case an earlier file's cleanup
 *   ever regresses.
 * - Test 3 ("a different error still throws") renames `ticket` away and
 *   restores it in a `finally` block, so the rename cannot leak even if the
 *   assertion in between fails.
 * - `afterAll` is a belt-and-suspenders check: if a leaked `ticket_bak`
 *   table is ever found (e.g. the process crashed mid-test, before the
 *   `finally` in test 3 could run), rename it back to `ticket` so later spec
 *   files (in particular `ticketFullyReadyMigration.spec.ts` and
 *   `tickets.spec.ts`) find the DB in the expected shape.
 */
import { test, expect } from '@playwright/test';
import { client } from '../config/db.js';
import {
  ensureTicketAgentTaskIdColumn,
  alterTicketAddAgentTaskIdColumn,
  runMigrations,
} from '../config/migrate.js';
import { TICKET_SEED_COUNT } from '../seed/ticketSeed.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function countAgentTaskIdColumns(): Promise<number> {
  const info = await client.execute('PRAGMA table_info(ticket)');
  return info.rows.filter((row) => row.name === 'agentTaskId').length;
}

async function getAgentTaskIdColumnInfo() {
  const info = await client.execute('PRAGMA table_info(ticket)');
  return info.rows.find((row) => row.name === 'agentTaskId');
}

async function tableExists(name: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [name],
  });
  return result.rows.length > 0;
}

async function indexExists(name: string): Promise<boolean> {
  const result = await client.execute('PRAGMA index_list(ticket)');
  return result.rows.some((row) => row.name === name);
}

// ---------------------------------------------------------------------------
// Suite (serial — cases run in declaration order and share DB state)
// ---------------------------------------------------------------------------

test.describe.serial('agentTaskId migration — ensureTicketAgentTaskIdColumn / alterTicketAddAgentTaskIdColumn', () => {

  // -------------------------------------------------------------------------
  // Test 1: the real repeat test
  // -------------------------------------------------------------------------
  test('ensureTicketAgentTaskIdColumn() is safely re-callable', async () => {
    // In this test environment, `agentTaskId` always arrives via
    // `CREATE TABLE` on the fresh Playwright test DB (wiped every run — see
    // globalSetup.ts), so the `table_info` guard inside
    // `ensureTicketAgentTaskIdColumn()` finds the column already present on
    // BOTH calls below, and neither call ever reaches the ALTER/catch
    // branch. This test only proves the function is safely callable
    // repeatedly once the column already exists — it does NOT prove
    // anything about the ALTER path itself. The "duplicate-column ALTER is
    // swallowed" test below is the one that actually exercises the
    // ALTER/catch branch, by calling `alterTicketAddAgentTaskIdColumn()`
    // directly and bypassing the guard.
    await expect(ensureTicketAgentTaskIdColumn()).resolves.toBeUndefined();
    await expect(ensureTicketAgentTaskIdColumn()).resolves.toBeUndefined();

    const columnCount = await countAgentTaskIdColumns();
    expect(columnCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 2: duplicate-column ALTER is swallowed
  // -------------------------------------------------------------------------
  test('alterTicketAddAgentTaskIdColumn() swallows "duplicate column" when the column already exists', async () => {
    // Bypasses the `table_info` guard in `ensureTicketAgentTaskIdColumn()`
    // and fires the ALTER directly against the live `ticket` table, which
    // already has `agentTaskId` (added via CREATE TABLE on this fresh test
    // DB). SQLite has no `ADD COLUMN IF NOT EXISTS`, so this ALTER fails
    // with "duplicate column name" — the narrow catch in
    // `alterTicketAddAgentTaskIdColumn()` must swallow exactly that error
    // and resolve normally.
    await expect(alterTicketAddAgentTaskIdColumn()).resolves.toBeUndefined();

    const columnCount = await countAgentTaskIdColumns();
    expect(columnCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 3: a different error still throws
  // -------------------------------------------------------------------------
  test('alterTicketAddAgentTaskIdColumn() re-throws a genuinely different SQL error', async () => {
    // Safety notes (read before touching this test):
    // - This is safe specifically because this test file runs
    //   `test.describe.serial` under this suite's `workers: 1` config
    //   (confirmed in backend/playwright.config.ts) — there is no
    //   concurrent access to the `ticket` table to worry about while it is
    //   renamed away below.
    // - The restore happens in `finally`, so the rename cannot leak even if
    //   the assertions in between fail.
    //
    // Approach: rename the live `ticket` table away, so the real, exported
    // `alterTicketAddAgentTaskIdColumn()`'s hardcoded
    // `ALTER TABLE ticket ADD COLUMN ...` fails because `ticket` no longer
    // exists — a genuinely different SQL error than "duplicate column
    // name", proving the catch in `alterTicketAddAgentTaskIdColumn()` is
    // narrow (it does not swallow everything).
    await client.execute('ALTER TABLE ticket RENAME TO ticket_bak');
    try {
      let caughtError: unknown;
      try {
        await alterTicketAddAgentTaskIdColumn();
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as Error).message).not.toContain('duplicate column');
    } finally {
      await client.execute('ALTER TABLE ticket_bak RENAME TO ticket');
    }

    // Confirm the restore actually worked before moving on.
    expect(await tableExists('ticket')).toBe(true);
    expect(await tableExists('ticket_bak')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 4: THE ORDERING REGRESSION GUARD (REQ-202)
  // -------------------------------------------------------------------------
  test('ordering regression guard: runMigrations() recovers a ticket table missing both the column and its index', async () => {
    // Simulate a pre-Fix-2 database exactly as it would exist on every
    // already-deployed local SQLite file and the deployed Turso database:
    // no `agentTaskId` column, no `idx_ticket_agentTaskId` index.
    //
    // The DROP order below is mandatory, not stylistic: SQLite refuses to
    // drop a column an index still references
    // (`SQLITE_ERROR: error in index idx_ticket_agentTaskId after drop
    // column: no such column: agentTaskId`), so the index has to go first.
    await client.execute('DROP INDEX IF EXISTS idx_ticket_agentTaskId');
    await client.execute('ALTER TABLE ticket DROP COLUMN agentTaskId');

    // Confirm the simulated pre-Fix-2 state actually landed before trusting
    // the assertions below.
    expect(await countAgentTaskIdColumns()).toBe(0);
    expect(await indexExists('idx_ticket_agentTaskId')).toBe(false);

    // The real, full runMigrations() — not just ensureTicketAgentTaskIdColumn()
    // in isolation — is the regression guard here. This is exactly what
    // main() calls on every backend startup. If a future change ever moved
    // `CREATE INDEX idx_ticket_agentTaskId` back into the shared index batch
    // (which runs BEFORE the guarded ALTER helpers, at a point where this
    // simulated table still lacks the column), this call would throw
    // `no such column: agentTaskId`, runMigrations() would reject, and
    // main().catch() would call process.exit(1) — the backend would not
    // start. That is exactly the failure this test exists to catch.
    await expect(runMigrations()).resolves.toBeUndefined();

    await test.step('the column exists again afterwards', async () => {
      expect(await countAgentTaskIdColumns()).toBe(1);
    });
    await test.step('the index exists again afterwards', async () => {
      expect(await indexExists('idx_ticket_agentTaskId')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Test 5: fresh DB gets the column from CREATE TABLE, nullable, no DEFAULT
  // -------------------------------------------------------------------------
  test('fresh DB: agentTaskId is nullable with no DEFAULT, and every seeded ticket reads agentTaskId = null', async () => {
    // Test 4 above dropped and re-added the column via runMigrations(), so
    // by this point the column's shape reflects the ALTER path
    // (alterTicketAddAgentTaskIdColumn()), not the original CREATE TABLE —
    // both must agree on notnull/dflt_value (see the comment in migrate.ts
    // above the `ticket` table's `agentTaskId` column), so asserting here
    // covers both definitions.
    const columnInfo = await getAgentTaskIdColumnInfo();
    if (!columnInfo) {
      throw new Error('agentTaskId column not found via PRAGMA table_info(ticket)');
    }

    expect(Number(columnInfo['notnull'])).toBe(0);
    expect(columnInfo['dflt_value']).toBeNull();

    // Raw-SQL level check, independent of any service-layer mapping (that's
    // ticketService.ts's responsibility, not this migration test).
    //
    // File-ordering assumption (mirrors the precedent in
    // ticketFullyReadyMigration.spec.ts and agentTaskSeed.spec.ts): this only
    // proves "every seeded ticket reads agentTaskId = null" because, at this
    // point in the run, agentTasks.spec.ts is the only earlier-running spec
    // file that links tickets to agent-tasks, and its own suite resets the
    // `ticket` table back to exactly its seeded rows via
    // `POST /api/tickets/reset` after every test (see that file's
    // "Agent-task ↔ ticket link" suite header comment) — so at this point
    // the `ticket` table holds exactly the TICKET_SEED_COUNT seeded rows and
    // nothing else. We assert the row count against TICKET_SEED_COUNT before
    // checking values so a leak from an earlier suite (or a future ordering
    // change) fails loudly here instead of this test silently passing on a
    // different table shape.
    const rows = await client.execute('SELECT id, agentTaskId FROM ticket');
    expect(rows.rows.length).toBe(TICKET_SEED_COUNT);
    for (const row of rows.rows) {
      expect(row['agentTaskId']).toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // afterAll: restore a clean table state for subsequent suites
  // -------------------------------------------------------------------------
  test.afterAll(async () => {
    // Belt-and-suspenders: test 3 already restores the rename in its own
    // `finally` block, so this is normally a no-op. Guard against a leaked
    // `ticket_bak` table (e.g. a crash mid-test) so later spec files (in
    // particular ticketFullyReadyMigration.spec.ts and tickets.spec.ts)
    // never inherit a broken table state.
    if (await tableExists('ticket_bak')) {
      await client.execute('ALTER TABLE ticket_bak RENAME TO ticket');
    }
  });
});

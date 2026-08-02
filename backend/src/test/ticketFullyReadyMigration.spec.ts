/**
 * Playwright tests for the guarded `fullyReady` column migration
 * (backend/src/config/migrate.ts):
 *   - `ensureTicketFullyReadyColumn()` — checks `PRAGMA table_info(ticket)`
 *     and only ALTERs when the column is missing.
 *   - `alterTicketAddFullyReadyColumn()` — the ALTER itself, split out so
 *     this suite can fire it directly against a table that already has the
 *     column, without relying on real concurrency timing to hit the catch
 *     branch.
 *
 * Covers (REQ-002 Test Strategy in docs/plans/PLAN-ADD-FULLY-READY-FLAG.md):
 *   1. Repeat-call safety of `ensureTicketFullyReadyColumn()`.
 *   2. The duplicate-column ALTER is swallowed by `alterTicketAddFullyReadyColumn()`.
 *   3. A genuinely different SQL error still throws (narrow catch).
 *   4. A fresh DB gets the column from `CREATE TABLE` with the right
 *      `notnull`/`dflt_value`, and seeded rows read `fullyReady = 0` at the
 *      raw-SQL level.
 *
 * Test isolation notes
 * --------------------
 * - This suite runs with `workers: 1` (playwright.config.ts), so all spec
 *   files are serial and ordering is deterministic.
 * - We use `test.describe.serial` because these tests mutate the live
 *   `ticket` table's schema (test 3 even renames the table temporarily) and
 *   must run in declaration order.
 * - Test 3 ("a different error still throws") renames `ticket` away and
 *   restores it in a `finally` block, so the rename cannot leak even if the
 *   assertion in between fails.
 * - `afterAll` is a belt-and-suspenders check: if a leaked `ticket_bak`
 *   table is ever found (e.g. the process crashed mid-test, before the
 *   `finally` in test 3 could run), rename it back to `ticket` so later spec
 *   files (in particular `tickets.spec.ts`) find the DB in the expected
 *   shape.
 */
import { test, expect } from '@playwright/test';
import { client } from '../config/db.js';
import {
  ensureTicketFullyReadyColumn,
  alterTicketAddFullyReadyColumn,
} from '../config/migrate.js';
import { TICKET_SEED_COUNT } from '../seed/ticketSeed.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function countFullyReadyColumns(): Promise<number> {
  const info = await client.execute('PRAGMA table_info(ticket)');
  return info.rows.filter((row) => row.name === 'fullyReady').length;
}

async function getFullyReadyColumnInfo() {
  const info = await client.execute('PRAGMA table_info(ticket)');
  return info.rows.find((row) => row.name === 'fullyReady');
}

async function tableExists(name: string): Promise<boolean> {
  const result = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [name],
  });
  return result.rows.length > 0;
}

// ---------------------------------------------------------------------------
// Suite (serial — cases run in declaration order and share DB state)
// ---------------------------------------------------------------------------

test.describe.serial('fullyReady migration — ensureTicketFullyReadyColumn / alterTicketAddFullyReadyColumn', () => {

  // -------------------------------------------------------------------------
  // Test 1: the real repeat test
  // -------------------------------------------------------------------------
  test('ensureTicketFullyReadyColumn() is safely re-callable', async () => {
    // In this test environment, `fullyReady` always arrives via
    // `CREATE TABLE` on the fresh Playwright test DB (wiped every run — see
    // globalSetup.ts), so the `table_info` guard inside
    // `ensureTicketFullyReadyColumn()` finds the column already present on
    // BOTH calls below, and neither call ever reaches the ALTER/catch
    // branch. This test only proves the function is safely callable
    // repeatedly once the column already exists — it does NOT prove
    // anything about the ALTER path itself. The "duplicate-column ALTER is
    // swallowed" test below is the one that actually exercises the
    // ALTER/catch branch, by calling `alterTicketAddFullyReadyColumn()`
    // directly and bypassing the guard.
    await expect(ensureTicketFullyReadyColumn()).resolves.toBeUndefined();
    await expect(ensureTicketFullyReadyColumn()).resolves.toBeUndefined();

    const columnCount = await countFullyReadyColumns();
    expect(columnCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 2: duplicate-column ALTER is swallowed
  // -------------------------------------------------------------------------
  test('alterTicketAddFullyReadyColumn() swallows "duplicate column" when the column already exists', async () => {
    // Bypasses the `table_info` guard in `ensureTicketFullyReadyColumn()`
    // and fires the ALTER directly against the live `ticket` table, which
    // already has `fullyReady` (added via CREATE TABLE on this fresh test
    // DB). SQLite has no `ADD COLUMN IF NOT EXISTS`, so this ALTER fails
    // with "duplicate column name" — the narrow catch in
    // `alterTicketAddFullyReadyColumn()` must swallow exactly that error and
    // resolve normally.
    await expect(alterTicketAddFullyReadyColumn()).resolves.toBeUndefined();

    const columnCount = await countFullyReadyColumns();
    expect(columnCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 3: a different error still throws
  // -------------------------------------------------------------------------
  test('alterTicketAddFullyReadyColumn() re-throws a genuinely different SQL error', async () => {
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
    // `alterTicketAddFullyReadyColumn()`'s hardcoded
    // `ALTER TABLE ticket ADD COLUMN ...` fails because `ticket` no longer
    // exists — a genuinely different SQL error than "duplicate column
    // name", proving the catch in `alterTicketAddFullyReadyColumn()` is
    // narrow (it does not swallow everything).
    await client.execute('ALTER TABLE ticket RENAME TO ticket_bak');
    try {
      let caughtError: unknown;
      try {
        await alterTicketAddFullyReadyColumn();
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
  // Test 4: fresh DB gets the column from CREATE TABLE
  // -------------------------------------------------------------------------
  test('fresh DB: fullyReady is NOT NULL DEFAULT 0, and seeded rows read fullyReady = 0', async () => {
    const columnInfo = await getFullyReadyColumnInfo();
    if (!columnInfo) {
      throw new Error('fullyReady column not found via PRAGMA table_info(ticket)');
    }

    expect(Number(columnInfo['notnull'])).toBe(1);
    expect(columnInfo['dflt_value']).toBe('0');

    // Raw-SQL level check, independent of any service-layer boolean
    // coercion (that's Task 4's responsibility, not this migration test).
    //
    // File-ordering assumption (mirrors the precedent in
    // agentTaskSeed.spec.ts): this only proves "seeded rows read
    // fullyReady = 0" because this spec file runs alphabetically before
    // tickets.spec.ts — the only other spec file that creates
    // fullyReady=true rows — so at this point the `ticket` table holds
    // exactly the TICKET_SEED_COUNT seeded rows and nothing else. We assert
    // the row count against TICKET_SEED_COUNT before checking values so a
    // future ordering change (or an extra row from elsewhere) fails loudly
    // here instead of this test silently passing on a different table shape.
    const rows = await client.execute('SELECT id, fullyReady FROM ticket');
    expect(rows.rows.length).toBe(TICKET_SEED_COUNT);
    for (const row of rows.rows) {
      expect(row['fullyReady']).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  // afterAll: restore a clean table state for subsequent suites
  // -------------------------------------------------------------------------
  test.afterAll(async () => {
    // Belt-and-suspenders: test 3 already restores the rename in its own
    // `finally` block, so this is normally a no-op. Guard against a leaked
    // `ticket_bak` table (e.g. a crash mid-test) so later spec files (in
    // particular tickets.spec.ts) never inherit a broken table state.
    if (await tableExists('ticket_bak')) {
      await client.execute('ALTER TABLE ticket_bak RENAME TO ticket');
    }
  });
});

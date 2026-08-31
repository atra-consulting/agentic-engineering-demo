---
name: already-implemented-feedback
description: Feedback items that request a feature the CRM already ships — always verify the premise in code before judging BAUEN
metadata:
  type: project
---

Some agent-task / feedback items ask for something the CRM already has. Judge them "muss verfeinert werden", not BAUEN — building produces an empty diff.

**Why:** These items read perfectly: one change, clear actor, obvious approach, right stack. Every clarity check passes. Only a code check catches them. A BAUEN verdict here sends the agent into a no-op run.

**How to apply:** Before any BAUEN/build verdict on a "add field X to list Y" item, grep the three layers. Cheap, ~3 greps:
- DB: `backend/src/db/schema/schema.ts` + `backend/src/config/migrate.ts` (column exists?)
- API: `backend/src/services/<entity>Service.ts` — the `BASE_QUERY` and `toDTO` (field selected AND mapped?)
- UI: `frontend/src/app/features/<entity>/<entity>-list/*.component.ts` — the `columnDefs` array (AG Grid, data-driven; the `.html` only binds `[columnDefs]`)
Also check `backend/src/seed/fixture.json` — an empty-looking column is usually real data missing, not a missing column.

Confirmed instance (2026-08-30): "Show company phone number in the company list view" (sender k.bauer@mueller.de). Already fully shipped: `firma.phone` TEXT, in `BASE_QUERY` + `toDTO`, `{ field: 'phone', headerName: 'Telefon' }` in `firma-list.component.ts`, all 25 seed firms carry a phone, and `firma-list.component.spec.ts` asserts the column and its header. Nothing to build.

Type suggestion for these: BUG, not FEATURE — the only open work is why the reporter does not see it (wrong screen, stale build, saved AG Grid column state).

Related: [[semi-auto-ticket-build-patterns]] ("verify the described problem really exists"), [[agent-task-reject-patterns]].

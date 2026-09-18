# Implementation Plan: CALCULATOR-SELECTABLE-STEPS

## Summary

### Business Summary
The productivity calculator gets two improvements. People can now shape each of the four delivery processes themselves — add a step, remove a step, rename any step — instead of being stuck with our fixed 19/19/11/2 templates. And a short note at the top of the page tells every visitor, right away, that the shown times are examples they are free to change.

### Technical Summary
Six build slices. The backend slice replaces the fixed-length Zod rules in `backend/src/utils/validation.ts` with structural rules plus a cross-field refinement carrying an explicit error path. The frontend foundation slice makes step count, step name and step role live per-step state instead of position-matched constants — this is the load-bearing change and it rewires six name read sites. On top of it sit the add/remove actions (with focus management, a polite live region, role-array parity, and teardown of the unit-conversion subscription and map), the bar-view minimum-width marker inside the pure `computeSegments()` helper, and the scenario-load rebuild that reuses the add/remove resize primitives. A UI design slice lands the disclosure banner plus the static row structure and control styles, both of which have no precedent in this codebase. No DB change. Both existing test suites contain fixed-count assertions that must be rewritten, not merely extended — six suites on the backend, not four.

## Test Command

`(cd backend && npm test) && (cd frontend && npx ng test --watch=false)`

## Tasks

### 1. Backend — scenario validation rewrite
**Agent:** be-coder
**Model:** sonnet — one file, one schema, the exact rules and the error-path requirement are spelled out in the PRD

- [ ] In `backend/src/utils/validation.ts`, drop the fixed `PROCESS_STEP_COUNTS` enforcement from **all four** process schemas — `humanSteps`, `agileKiSteps`, `semiAutomatedSteps`, `automatedSteps`. None of the four keeps a fixed length.
- [ ] Per process, require `works` to hold at least 1 and at most 50 durations.
- [ ] Per process, add an **object-level** refinement: `waits.length` must equal `works.length - 1`. This spans two sibling fields, so it cannot be a per-array length rule.
- [ ] The refinement must set an explicit error path pointing at that process's wait array, so the emitted field-error key keeps today's dotted shape (for example the same key the frontend already renders for a bad wait count). Losing the path breaks REQ-301.
- [ ] Keep the existing per-duration rule unchanged: integer, min 0, max 479520.
- [ ] Add an **optional** `names` array inside each process object, alongside `works` and `waits` (REQ-302). When present, its length must equal `works.length`, enforced by the same kind of object-level refinement with an explicit path. Each entry is a string of at most 200 characters.
- [ ] Widen the exported DTO type so `szenarioService` compiles.
- [ ] Also widen the hand-written interfaces in `backend/src/services/szenarioService.ts`: `ProzessDauer` gains an optional `names` string array, so `SzenarioDTO` and the row-to-DTO mapping stay truthful. Runtime is JSON passthrough and unaffected, but the types must not lie about the shape.
- [ ] Do not touch `backend/src/config/migrate.ts` or `backend/src/seed/szenarioSeed.ts`. No DDL change, no seed value change (REQ-202, REQ-303).

**Acceptance**
- A payload with 25 works and 24 waits is accepted — for each of the four processes, not only `humanSteps`.
- A payload with 1 work and 0 waits is accepted.
- A payload with 50 works and 49 waits is accepted; 51 works is rejected.
- A payload with 0 works is rejected.
- A payload with 18 works and 18 waits is rejected, with a field error keyed to that process's waits.
- The legacy shape (19/19/11/2, no `names`) is still accepted on both POST and PUT.
- A `names` array whose length differs from `works` is rejected with a field error keyed to that process's names. A name over 200 characters is rejected.
- `ProzessDauer` in the service carries the optional names field.

---

### 2. UI design — disclosure banner, step-row structure, control styles
**Agent:** ui-designer
**Model:** sonnet — self-contained visual work, but three patterns are new to this codebase

**Disclosure note (REQ-201)**
- [ ] Implement it in `frontend/src/app/features/produktivitaet/rechner.component.html`, above the Prozessvergleich card, below the existing page header.
- [ ] German text stating both facts: the times are example values, and the user can change every value and add or remove steps.
- [ ] Always visible. Not dismissible, no auto-hide. The app's only existing info-alert is the dismissible notification component — do not reuse it. This is a new static pattern.
- [ ] Real text in the reading order. Informational tone, not warning or error styling.
- [ ] On a narrow viewport the note keeps its position as the first content block and wraps. It must not collapse, truncate, or move below the charts.

**Colour — do not take the obvious shortcut**
- [ ] Do **not** use `.text-muted` or `$secondary` for the disclosure note or for the blocked-state reason text. `$secondary` is `#777777` (see `docs/specs/SPECS-ui.md`), which lands at about 4.48:1 on white — just under the 4.5:1 bar these two elements must clear. It is this component's habitual secondary-text colour, so it is the easy wrong answer.
- [ ] Use `#495057` instead, at roughly 8.2:1. It is already in this component for `.bar-total`, `.pie-note` and `.cmp-col-header`, so it adds no new colour to the palette.

**Step-row structure — pin the order, land the markup**
- [ ] Fix the step row's element order and land it as real but unbound markup, so Group 3 and Group 4 bind behaviour into a settled structure instead of inventing a layout: number prefix → name input → the `Arbeitszeit` / `KI-Arbeitszeit` caption → value input → unit select → "Entfernen".
- [ ] The wait row below a step keeps its current shape, indentation and left border.
- [ ] The row must still fit a narrow screen with the extra name field and button: wrap, no horizontal scrolling.

**New controls**
- [ ] "Schritt hinzufügen" button, placed below the last step row of each process.
- [ ] Per-row "Entfernen" button.
- [ ] Per-row name text input.
- [ ] Blocked-state reason text, sitting next to its control, persistently visible — not a tooltip, not hover-only.
- [ ] Text labels, not icons. This component uses text buttons throughout and pulls in no icon library.
- [ ] All interactive targets meet the existing 44-pixel minimum, matching the `.view-toggle-btn` precedent already in this component.

**Blocked-state look**
- [ ] Define a visual style for a control carrying `aria-disabled="true"`. There are **zero** existing uses of `aria-disabled` in this codebase — every other disabled control uses the real `disabled` attribute, which REQ-106 forbids here because the control must stay focusable. With no style, a blocked button renders pixel-identical to a working one.
- [ ] Muted colour or reduced opacity, plus a not-allowed cursor, visually consistent with the reason text beside it. The focus ring must still be clearly visible on a blocked control.

**Acceptance**
- The note is visible without scrolling on a normal desktop window and is the first content block on a narrow one.
- The note cannot be dismissed and does not disappear on a timer.
- Neither the note nor the blocked-state text uses `.text-muted` / `#777777`.
- The step row's element order is settled in real markup, in the order listed above.
- A control with `aria-disabled="true"` looks clearly different from an active one and still shows a focus ring.
- No behaviour logic added in this group — markup and styles only. Group 3 binds the name input; Group 4 binds add, remove and the blocked states.

---

### 3. Frontend — dynamic step model foundation
**Agent:** fe-coder
**Model:** opus — cross-cutting: it changes the step's identity model and rewires six read sites plus four index-aligned features, over shared mutable constants that will silently corrupt the sibling tab if handled wrong

- [ ] In `frontend/src/app/core/models/prozess-defaults.ts`, demote `stepCount` to the **initial** step count. Do not delete it — the defaults still need it and `prozess-defaults.spec.ts` asserts it.
- [ ] Keep `PROZESS_STEP_LABELS` and `PROZESS_ROLLEN` exported and read-only. `agileKi` and `menschlich` share the *same array object* in both maps, and two existing specs assert that identity — keep it.
- [ ] In `rechner.component.ts`, make the step name part of each work step's own form data, seeded by **copying** from the label constants per process. Never mutate the exported arrays, and never let the two agile processes share one runtime array.
- [ ] Make the role per-process runtime state, seeded once by **copying** from the role constants. After that initial build, a step's role is never re-derived from its position.
- [ ] Rewire **all six** name read sites to read the step's own live name, with a "Schritt N" fallback computed from the step's *current* position:
  - `getWaitTooltip()`
  - `getWorkAriaLabel()`
  - `getFlowchartSchritte()`
  - the printed step name in the template row
  - the work value input's `aria-label`
  - the unit select's `aria-label`
- [ ] Replace the four `stepCount` readers with the live count: the tab caption (`rechner.component.html` line 278), the bar `<desc>` (line 28), the flow-diagram group `aria-label` (line 331), and the scenario-load length check (`rechner.component.ts` line 796 — Group 6 owns the rewrite, this group just stops it reading a constant).
- [ ] Update `getRollenSplit()` to read the per-step role state instead of `PROZESS_ROLLEN[key][i]`.
- [ ] Strengthen the role pie's note (REQ-107): always state that only steps with a role count. When role-less steps carry more than 0 work minutes, also name that amount, for example "Ohne Rolle: 30 Min.".
- [ ] Bind the name input Group 2 landed: to the step's own form data, with `aria-label` naming the step, for example "Name für Schritt 5". Max 200 characters. Empty allowed.
- [ ] Update the template comment that records the old "0-minute bar segments are intentionally not focusable" decision — Group 5 reverses it.

**Acceptance**
- First load still shows exactly today's step lists, names, durations and the four totals 3.880 / 2.190 / 445 / 65 minutes (REQ-202).
- Renaming a step in "Agile mit Menschen" changes nothing in "Agile mit KI".
- A renamed step shows its new name in the wait tooltip, the bar's spoken label, the flow-diagram box and the printed row — not only in the input.
- An empty name renders as "Schritt N" using the step's current position everywhere it appears.
- The tab caption number comes from the live step count, not a constant.
- `getRollenSplit()` returns the same three numbers as today for both agile processes on first load.
- The role runtime state starts exactly as long as the works array, for both agile processes.

---

### 4. Frontend — add and remove, role parity, focus, live region, teardown
**Agent:** fe-coder
**Model:** sonnet — well-specified behavior on top of the foundation; the exact rules are already pinned down

- [ ] Bind the "Schritt hinzufügen" action Group 2 placed below each process's last step row.
- [ ] **Add** appends one work step (0 minutes, name "Neuer Schritt") and one wait (0 minutes) placed after the previous last step. Counts both go up by one. The process total does not change.
- [ ] Wire **both** new controls through the same unit-conversion setup existing steps use — the new step's unit control and the new wait's unit control. Both are wired identically today; wiring only one leaves the wait's unit dropdown dead.
- [ ] **On the two agile processes, an add also appends an empty role entry** to that process's role runtime state (REQ-105). The role array must stay exactly as long as the works array after every add and every remove. Skip this and the role array runs short; a later removal of one of those trailing steps then splices an out-of-range index — a silent no-op in JavaScript — and the role array stops shrinking in lockstep. Every later step's role then attaches to the wrong step. That is precisely the bug REQ-107 exists to prevent, sneaking back in through the add path.
- [ ] After an add, move focus into the new step's name field, text ready to overwrite.
- [ ] Bind the per-row "Entfernen" action with `aria-label` naming the position, for example "Schritt 5 entfernen".
- [ ] **Remove — exact rule (REQ-102).** Removing the step at position `i` (0-based): if `i` is not the last step, remove the wait *after* it (the wait row shown directly beneath it); the wait *before* it survives and now joins the two new neighbours. If `i` is the last step, remove the wait *before* it. Either way the chain stays N steps / N−1 waits.
- [ ] **Worked example to verify against.** Steps A, B, C, D with waits after-A, after-B, after-C. Remove B → A, C, D with after-A and after-C. Remove D → A, B, C with after-A and after-B.
- [ ] Removing a step removes that step's role and only that role (REQ-107). Every other step keeps its own.
- [ ] No confirmation dialog. Removal is immediate.
- [ ] **Focus after removal.** To the remove action of the step now sitting in the removed step's position. If the removed step was last, to the remove action of the new last step. If the list is now at the floor, to the "Schritt hinzufügen" action.
- [ ] **Teardown on removal.** Unsubscribe that control's unit-conversion subscription and delete its entry from the `letzteEinheit` map — for the removed work step and for the removed wait. Nothing does this today, so every cycle leaks one of each.
- [ ] Expose the add-wiring and remove-teardown as reusable primitives, not inline code. Group 6 resizes the same arrays on scenario load and must reuse them.
- [ ] Enforce the limits: floor 1 step, cap 50 steps. A blocked control stays focusable, carries `aria-disabled="true"` with Group 2's style, and shows its reason as persistently visible text.
- [ ] Add one polite live region per process. After every add or remove it states the action and the new count: "Schritt hinzugefügt, jetzt 20 Schritte" / "Schritt entfernt, jetzt 18 Schritte". Polite only. It never steals focus.

**Acceptance**
- After any add or remove, step count minus wait count equals exactly 1.
- **The role array's length equals the works array's length after every add and every remove**, on both agile processes.
- A newly added step on an agile process carries no role and is excluded from the role pie, while its work minutes still count in the work-vs-wait pie — with the role pie's note naming the excluded amount.
- The worked example above produces exactly the stated results, checked on values not just lengths.
- On "Agile mit Menschen", removing step 3 leaves step 13 ("Tester testet …") still reporting Tester (REQ-107).
- Adding a step leaves the process total unchanged, and the new wait's unit dropdown converts like every other.
- Focus lands on the three specified targets in the three specified cases.
- At 1 step the remove control is blocked with visible reason text and is still reachable by keyboard. Same at 50 steps for add.
- Repeated add/remove cycles leave no growing set of live subscriptions or map entries.

---

### 5. Frontend — minimum-width bar marker for 0-minute steps
**Agent:** ui-designer
**Model:** sonnet — contained geometry change, but the numbers and the degenerate cases must be exact

**Where the logic lives**
- [ ] The width floor belongs inside `computeSegments()` in `frontend/src/app/features/produktivitaet/svg-util.ts` — the pure, already-unit-tested home for this codebase's chart geometry. `getSegments()` in the component is a thin wrapper; the template must not carry width maths.
- [ ] Scope therefore includes `svg-util.ts` and `svg-util.spec.ts`, plus the bar region of `rechner.component.html`.

**The rules, with numbers**
- [ ] The bar's viewBox is 600 units wide. A work segment with 0 minutes gets a floor width of **3 units**. Wait segments keep a 0 width at 0 minutes — a wait is not a step and needs no marker.
- [ ] When the process total is above 0: reserve the floor for every 0-minute work segment first, then distribute the remaining width proportionally among the segments that carry real minutes. Segments with real minutes keep their correct relative proportions.
- [ ] Cap the total reserved width at **150 units**, a quarter of the bar. At the REQ-106 cap of 50 steps, 50 markers at 3 units land exactly on 150, so the cap only ever bites if the step cap changes later. If the reserve would exceed 150, shrink the floor proportionally so the sum stays at 150.
- [ ] When the process total is exactly 0 — every work and every wait at 0 minutes, which a brand-new process built entirely from adds will hit — `computeSegments()` today gives every segment zero width and the bar disappears. New rule: fall back to equal-width work segments filling the bar, with all waits at 0 width. The bar stays visible and every step stays reachable.

**Focus and labels**
- [ ] Make every step's bar segment keyboard-focusable with its own spoken label — including a 0-minute step and the "Auslöser" trigger step. Today the template skips `tabindex` and the label when the work value is 0.
- [ ] This reverses an earlier deliberate decision, recorded in a template comment, that the bar skips focus on 0-work segments while the flow diagram does not. Expect the bar's tab-stop count to change, and leave the comment updated so nobody reverts it.

**Acceptance**
- Adding a step in the default Balken view produces a visible marker immediately (REQ-104).
- Every step in the bar is reachable by keyboard and announces its own label.
- A process with normal durations still shows visually correct proportions for its non-zero segments.
- A process whose total is 0 shows equal-width, focusable work segments — not an empty bar.
- A 50-step process with every step at 0 minutes renders 50 visible markers within the 150-unit reserve.
- The width-floor logic sits in `computeSegments()` and is covered by `svg-util.spec.ts`.

---

### 6. Frontend — scenario load rebuild, role re-derivation, names in the payload
**Agent:** fe-coder
**Model:** sonnet — fiddly but fully specified; the surrounding load mechanics and the resize primitives already exist

- [ ] Replace the `stored.works.length === p.stepCount` gate in `ladeScenario()` with a structural check per process: at least 1 step, at most 50, and `waits.length === works.length - 1`.
- [ ] On a valid process, **rebuild** that process's form arrays to the stored length before filling them. The current helper patches by index and silently no-ops past the existing length.
- [ ] **Reuse Group 4's resize primitives** when growing or shrinking — the add-side unit-conversion wiring and map registration when growing, the remove-side unsubscribe and `letzteEinheit` deletion when shrinking. A bare push or a bare remove-at leaks discarded controls' subscriptions and map entries on every scenario load, which is the same defect Group 4 just fixed for add and remove.
- [ ] Keep the per-process fallback to `DEFAULT_DURATIONS` when the check fails or the field is missing. One bad process must not stop the other three.
- [ ] Keep the existing load mechanics: silent patches that suppress `valueChanges`, the reset of each value control's validators back to the Minuten factory, the refresh of the tracked previous unit, and the single explicit recompute at the end.
- [ ] **Re-derive the agile role state on every load**, sized to the loaded step count: take the default role list, truncate it if shorter, pad with empty roles if longer. Roles are never stored in a scenario, so skipping this leaves a 19-entry role list on a 25-step process.
- [ ] **Copy, never mutate.** The default role list and the default label list are shared exported constants, and `agileKi` and `menschlich` point at the same objects. Truncating or padding in place would corrupt the other tab and break two existing specs that assert the shared identity. Build a fresh array per process, every load.
- [ ] Rebuild names on load: use the scenario's stored names when present; otherwise seed by copying from the example names for as many steps as exist, then fall back to "Schritt N" beyond them.
- [ ] Extend the save payload builder to emit the current, possibly non-default, counts per process plus the names array, matching the backend contract from Group 1.
- [ ] Extend the scenario model type in `frontend/src/app/core/models/szenario.model.ts` with the optional names field.
- [ ] Keep the field-error display working against the same error keys the backend emits.

**Acceptance**
- A scenario with 25 steps for one process loads with 25 step rows and a 25-entry role state for that process.
- A scenario with 1 step and 0 waits loads.
- A scenario with mismatched wait count, 0 steps, over the cap, or a missing process field falls back to defaults for that process only, and throws nothing.
- A scenario saved before this change (19/19/11/2, no names) loads and saves without error.
- Saving after adding steps sends the new counts, and loading that scenario restores them.
- Loading a shorter scenario repeatedly leaves no growing set of subscriptions or `letzteEinheit` entries.
- After any load, the exported default role and label constants are byte-identical to what they were at startup.

---

### 6b. Frontend — per-step role picker (added mid-implementation, REQ-108)
**Agent:** fe-coder
**Model:** sonnet — well-specified UI control on top of role state Groups 3/4/6 already built

Added after a user, watching the running app during implementation, found that a newly added step has no way to get a role at all. Resolved PRD Open Questions 6 and 7: add a picker, and make it apply to existing steps too (not just new ones), since a picker limited to new steps would look inconsistent against the 19/19 existing steps and give no way to fix a wrong role.

- [ ] Add a role `<select>` to every step row on "Agile mit Menschen" and "Agile mit KI" only (the two KI-only processes have no role concept — no picker there). Four options: "— Keine —" (no role), "BA", "Dev", "Tester".
- [ ] Read the current value from `getRollen(prozessKey)[index]` (existing primitive from Group 3); on `(change)`, write directly into that same live array (`getRollen(prozessKey)[index] = newValue`) — mutate in place, same pattern Group 4 already uses for `push`/`splice` on this array. No FormControl needed; a plain bound `<select>` with `(change)` is enough, matching how `addStep`/`removeStep` already trigger change detection without going through the reactive form.
- [ ] `aria-label` naming the step, e.g. "Rolle für Schritt 5".
- [ ] Position: after the unit select, before "Entfernen" — extend the existing settled row order rather than inserting in the middle of it.
- [ ] Changing a role must NOT touch any duration, name, or total, and must NOT cross between `menschlich`/`agileKi` (separate live arrays, already guaranteed by Group 3's per-process seeding).
- [ ] `getRollenSplit()`/`getRollenPieNote()` (existing, Group 3) already read `getRollen()` live — confirm the pie and its note update on the very next render after a picker change, with no extra wiring needed.
- [ ] Roles stay unpersisted, per REQ-303 — do not add anything to `formZuPayload()` for this.

**Acceptance**
- Every step row on the two agile tabs — old and new steps alike — shows the picker with the step's actual current role selected.
- Picking a role updates the role pie and its note on the same render, no save/reload.
- The two KI-only tabs show no picker.
- Existing add/remove/rename/save/load behavior (Groups 3, 4, 6) is unaffected — this only adds a new control and a new write path into an already-existing array.

---

### 7. Backend review
**Agent:** be-reviewer
**Model:** sonnet — focused review of one schema file and its error contract

- [ ] Confirm the waits rule is an object-level refinement, not two independent length rules.
- [ ] Confirm the refinement sets an explicit error path and the emitted field-error key keeps today's dotted shape.
- [ ] Confirm the optional names rule mirrors it, path included.
- [ ] Confirm **all four** processes lost their fixed length — including `agileKiSteps`, which is easy to miss because it was added later than the other three.
- [ ] Confirm `ProzessDauer` in `szenarioService.ts` carries the optional names field, so the hand-written DTOs match the schema.
- [ ] Confirm no DDL, seed, or service SQL change slipped in.
- [ ] Confirm duration bounds, duplicate-name handling and auth behavior are untouched.

---

### 8. Frontend review
**Agent:** fe-reviewer
**Model:** sonnet — pattern and correctness review across the changed component

- [ ] Confirm the exported label and role constants are never mutated, and the two agile processes hold separate runtime state — on the initial build *and* on every scenario load.
- [ ] Confirm all six name read sites read live form data, each with a current-position fallback.
- [ ] Walk the REQ-102 removal rule against the worked example, including the last-step case.
- [ ] Confirm an add appends an empty role on the agile processes, and that the role array length tracks the works array length after every add and every remove.
- [ ] Confirm role removal drops exactly one entry and never shifts the others.
- [ ] Confirm removal tears down the unit-conversion subscription and the `letzteEinheit` entry, for the work step and the wait.
- [ ] Confirm the **scenario-load** resize path uses the same wiring and teardown primitives — not a bare push or remove-at. Plain add/remove being clean says nothing about the load path.
- [ ] Confirm the scenario loader rebuilds rather than patches, and re-derives roles from a fresh copy.
- [ ] Confirm Angular 21 conventions: `inject()`, `@if`/`@for` with `track`, standalone imports, no `*ngIf`/`*ngFor`.
- [ ] Confirm the role picker (Group 6b) mutates `getRollen()`'s live array directly and never appears on the two KI-only processes.

---

### 9. UI review
**Agent:** ui-reviewer
**Model:** sonnet — accessibility and usability audit of three new patterns

- [ ] Disclosure note: position, persistence, contrast, reading order, narrow-viewport behavior.
- [ ] Confirm neither the note nor the blocked-state text uses `.text-muted` / `#777777`, which misses 4.5:1.
- [ ] Add, remove and name controls: accessible names, 44-pixel targets, text-not-icon convention.
- [ ] Blocked states: still focusable, marked with `aria-disabled`, visually distinct from an active control, reason visible as text and not hover-only.
- [ ] **Tab order through the extended step row** — number prefix, name input, value, unit, remove — reads in the order a sighted user scans it, with no jumps.
- [ ] **Focus indicator on minimum-width bar segments.** The existing focus outline was sized for normal segments. Check it stays visible and distinguishable on a 3-unit marker, and across a run of adjacent 0-minute markers, including a fully-zero 50-step process.
- [ ] Live region: polite, correct text, does not steal focus.
- [ ] Focus targets after add and after remove, in all three removal cases.
- [ ] 0-minute step visible and focusable in the Balken view; a zero-total process still shows a bar.
- [ ] Role pie note explains the exclusion and names the excluded minutes when there are any.
- [ ] Role picker (Group 6b): accessible name per step, keyboard-operable, visually consistent with the other select (unit dropdown) in the row, absent on the two KI-only tabs.

---

### 10. Test Implementation — Backend
**Agent:** be-test-coder
**Model:** sonnet — rewriting an existing suite against changed rules, not boilerplate

**Rewrite, do not delete — all six fixed-length suites**
`backend/src/test/szenario.spec.ts` holds **six**, not four. All six still return 400 under the new rules, because each payload leaves its sibling array at the old length and so violates the waits rule. Reassert each against the new reason and the new field-error key.
- [ ] `humanSteps.works` 18 instead of 19 (line ~540) — the asserted key moves from the works array to that process's waits array.
- [ ] `humanSteps.waits` 17 instead of 18 (line ~566).
- [ ] `semiAutomatedSteps.works` 10 instead of 11 (line ~763) — key moves to that process's waits.
- [ ] `automatedSteps.waits` 0 instead of 1 (line ~785).
- [ ] `agileKiSteps.works` 18 instead of 19 (line ~825) — **omitted from the first draft of this plan.** The asserted key moves from `agileKiSteps.works` to `agileKiSteps.waits`, exactly like the `humanSteps.works` case above.
- [ ] `agileKiSteps.waits` 17 instead of 18 (line ~851) — **also omitted.** Re-justify it against the new rule: 19 works needs 18 waits, so 17 is still a mismatch.
- [ ] Why this matters: leave these two alone and they keep passing with unchanged keys even if `agileKiSteps` never got converted to the structural rules at all. They would mask the exact regression this group exists to catch.

**Positive tests — the only ones that prove the new rule**
Every existing negative test stays negative, so the suite would still go green if variable step counts were rejected outright. These are load-bearing.
- [ ] Accepted: 25 works with 24 waits, round-tripping unchanged.
- [ ] Accepted, boundary: 1 work with 0 waits.
- [ ] Accepted, boundary: 50 works with 49 waits.
- [ ] **At least one positive non-default-count test must target a process other than `humanSteps`** — `agileKiSteps` preferred, since it is the one that got missed. The file's shared helpers lean on `humanSteps`, so a generic "non-default count" test will land there by default and leave the other three processes with zero positive coverage.
- [ ] Rejected, boundary: 51 works.
- [ ] Rejected: 0 works.
- [ ] Rejected: non-default step count with a mismatched wait count, asserting the field-error key names that process's waits.

**Backward compatibility and names**
- [ ] A POST and a PUT with the legacy 19/19/11/2 shape and no names field, run through the real validator. The existing seed test only does a GET, which never runs validation, so it proves nothing here.
- [ ] Names: accepted when length matches works; accepted when absent; rejected when length differs; rejected when a name exceeds 200 characters.
- [ ] Keep the existing duration bound, duplicate-name, auth and seed-defaults assertions passing unchanged, including the four totals 3.880 / 2.190 / 445 / 65.

---

### 11. Test Implementation — Frontend
**Agent:** fe-test-coder
**Model:** sonnet — many small specs against exact, already-stated rules

- [ ] **Note:** totals and bar segments recompute behind a 150 ms debounce on form changes. Any assertion made right after an add or remove needs that debounce to elapse (fake async plus a tick) or an explicit recompute. Skip this and the specs are flaky.
- [ ] **Re-scope**, do not delete, the existing specs asserting 19/19/11/2 in `rechner.component.spec.ts` and `prozess-defaults.spec.ts` — they now assert *default* counts, not permanent ones.
- [ ] Add raises step count and wait count by one; new work and new wait are 0; total unchanged.
- [ ] Add on one agile process leaves the other agile process's count and names untouched.
- [ ] **Role parity:** after an add on an agile process, the role array length equals the works array length; the new step has no role; a following remove of that new step still shrinks the role array in lockstep.
- [ ] A newly added agile step's work minutes appear in the work-vs-wait pie but not in the role pie, and the role note names the excluded amount.
- [ ] Remove a middle step drops the wait after it; the wait before it survives. Assert concrete values, not lengths.
- [ ] Remove the last step drops the wait before it.
- [ ] After any removal, counts still differ by exactly one.
- [ ] Remove step 3 on "Agile mit Menschen": step 13 still reports Tester; names and roles stay with their own steps.
- [ ] Remove blocked at 1 step, add blocked at 50; both stay focusable and carry `aria-disabled`.
- [ ] New step's default name is "Neuer Schritt".
- [ ] A rename appears in the wait tooltip, the bar's spoken label and the flow-diagram data — not only in the input.
- [ ] An empty name falls back to "Schritt N" using the current position.
- [ ] Focus lands in the new step's name field after an add.
- [ ] Focus lands on the expected remove action after a removal, and on the add action at the floor.
- [ ] The live region reports the new count after an add and after a remove.
- [ ] Charts reflect the new count: bar segments, pies, flow diagram, totals.
- [ ] Scenario load with a non-default step count rebuilds the form and the role state to that length.
- [ ] Scenario load with 0 steps, a mismatched wait count, over the cap, or a missing process falls back to defaults for that process only and does not throw.
- [ ] Scenario load does not leave the shared default label and role constants altered.
- [ ] The save payload carries the current non-default counts and the names.
- [ ] Role picker (Group 6b): shows the step's current role including "— Keine —"; changing it updates the role pie and note on the same render; never appears on the two KI-only tabs; never crosses between the two agile processes; changing a role does not touch duration/name/totals; roles are not included in the save payload.
- [ ] **In `svg-util.spec.ts`:** `computeSegments()` gives a 0-minute work segment the 3-unit floor while non-zero segments keep correct relative proportions; wait segments at 0 minutes stay at 0 width; a zero total yields equal-width work segments instead of an empty bar; 50 zero-minute steps stay inside the 150-unit reserve.

---

### 12. Test review — Backend
**Agent:** be-test-reviewer
**Model:** sonnet — checks the suite actually proves the new rule

- [ ] Confirm **all six** fixed-length suites were rewritten — including the two `agileKiSteps` suites, the ones most likely to be skipped.
- [ ] Confirm each rewritten suite asserts the new reason and the new field-error key, not the old fixed-length one.
- [ ] Confirm at least one positive test uses internally consistent non-default counts — the suite must fail if variable counts were rejected.
- [ ] Confirm at least one positive non-default-count test targets a process other than `humanSteps`.
- [ ] Confirm the legacy-shape POST and PUT run through the validator, not a GET.
- [ ] Confirm the seed totals assertions are unchanged.

---

### 13. Test review — Frontend
**Agent:** fe-test-reviewer
**Model:** sonnet — checks rule coverage and debounce handling

- [ ] Confirm the removal specs assert values, not just array lengths, and cover both the middle-step and last-step cases.
- [ ] Confirm the role-desync spec would fail if roles were re-derived by position.
- [ ] Confirm a spec covers the add-side role append — the role array must be proven to stay as long as the works array.
- [ ] Confirm the geometry specs live in `svg-util.spec.ts`, against the pure function, not asserted through the DOM.
- [ ] Confirm every spec asserting a total or a segment handles the 150 ms debounce.
- [ ] Confirm the old fixed-count specs were re-scoped, not removed.

---

### 14. Documentation — spec updates
**Agent:** ba-writer
**Model:** sonnet — four spec files, each needs the change understood before it is worded

- [ ] `docs/specs/SPECS-frontend.md` — the Produktivität → Rechner section: step counts are now per-process and editable; names and roles travel with the step; the disclosure note.
- [ ] `docs/specs/SPECS-backend.md` — remove the fixed step-count enforcement description, state the new structural rules.
- [ ] `docs/specs/SPECS-database.md` — the `szenario` table description still says `number[19]` / `number[11]` / `number[2]`; replace with the variable shape plus the optional names list. Note the storage itself did not change.
- [ ] `docs/specs/SPECS-testing.md` — the `szenario.spec.ts` row, the `rechner.component.spec.ts` row and the `svg-util.spec.ts` row.
- [ ] `docs/specs/SPECS-ui.md` — add the new `aria-disabled` blocked-state treatment and the disclosure-note pattern, and note that `$secondary` (`#777777`) is below 4.5:1 so it must not be used for either.
- [ ] Add the `## Implementierung` link block to `docs/prds/PRD-CALCULATOR-SELECTABLE-STEPS.md` per the repo's commit/PRD convention, and use the `PRD: docs/prds/PRD-CALCULATOR-SELECTABLE-STEPS.md` footer on the commits.

---

### 15. Verification
**Agent:** be-test-runner, then fe-test-runner
**Model:** haiku — running a suite and reporting pass/fail, nothing more

- [ ] Run `(cd backend && npm test)` and report pass/fail with failing test names.
- [ ] Run `(cd frontend && npx ng test --watch=false)` and report pass/fail with failing spec names.
- [ ] Run `(cd frontend && npx ng build)` as a build check.
- [ ] Report results only. Do not fix code — hand failures back to the owning coder group.

## Execution Order & Parallelism

**Wave 1 — run in parallel.**
- Group 1 (backend validation, `be-coder`)
- Group 2 (UI design: banner, row structure, control styles, `ui-designer`)

They touch different files and different layers. Group 2 edits `rechner.component.html` before any frontend logic work starts, on purpose — every later frontend group edits the same two files, so nothing else may run concurrently with it. Group 2 now also lands the settled step-row markup, so Groups 3 and 4 bind into a fixed structure instead of each inventing a layout.

**Wave 2 — after Group 2 lands.**
- Group 3 (frontend foundation, `fe-coder`). Blocked by Group 2 only because of the shared template file. Not blocked by Group 1.
- Group 7 (backend review) runs here, in parallel, as soon as Group 1 lands.

**Wave 3 — after Group 3. Strictly sequential among themselves.**
- Group 4 (add/remove, role parity, focus, live region, teardown) — needs Group 3's per-step name and role state. Owns REQ-105's add-side role append and publishes the resize primitives.
- Group 5 (minimum-width bar marker) — needs Group 3's live count. Most of its work lands in `svg-util.ts`, which nobody else touches, but it also edits the bar region of the shared template, so it runs after Group 4 rather than beside it.
- Group 6 (scenario load rebuild) — **depends on Group 3, Group 1 and Group 4.** Group 4 is a hard dependency now, not an optional one: Group 6 resizes the same form arrays and must reuse Group 4's add-wiring and remove-teardown primitives rather than re-implementing them.

Groups 4, 5 and 6 all edit `rechner.component.ts` and `rechner.component.html`. Run them one after another. Order 4 → 5 → 6 is the cheapest: 6 depends on the most, including on 4's primitives.

**Wave 4 — after Wave 3.**
- Group 8 (frontend review) and Group 9 (UI review) run in parallel.

**Wave 5 — test implementation.**
- Group 10 (backend tests) can start as soon as Group 1 and Group 7 land — it does not wait for any frontend work.
- Group 11 (frontend tests) waits for Wave 3, because its geometry specs need Group 5 and its role-parity specs need Group 4.
- The two run in parallel once both are unblocked.

**Wave 6.**
- Group 12 and Group 13 (test reviews) run in parallel.

**Wave 7.**
- Group 14 (spec updates) and Group 15 (verification) run in parallel. Verification gates the task; spec updates do not block it.

**Critical path:** 2 → 3 → 4 → 5 → 6 → 8/9 → 11 → 13 → 15. The whole backend track (1 → 7 → 10 → 12) runs beside it and finishes earlier.

## Tests

### Unit Tests

- [ ] Add appends one step and one wait; the new work and the new wait are both 0; the process total is unchanged.
- [ ] Add on `menschlich` leaves `agileKi`'s step count and names untouched, and the reverse.
- [ ] After an add on an agile process, the role array length equals the works array length, and the new step carries no role.
- [ ] A new step's default name is "Neuer Schritt".
- [ ] A renamed step's new name appears in the wait tooltip, the bar's spoken label, the flow-diagram box data and the printed row.
- [ ] An empty name renders as "Schritt N" using the step's current position, in all four places.
- [ ] A name is capped at 200 characters.
- [ ] `getRollenSplit()` returns today's numbers on first load for both agile processes.
- [ ] The role pie note names the excluded work minutes when a role-less step carries time, and states nothing extra when none does.
- [ ] The tab caption number equals the live step count after an add and after a remove.
- [ ] The live region text reads "Schritt hinzugefügt, jetzt N Schritte" after an add, "Schritt entfernt, jetzt N Schritte" after a remove.
- [ ] `computeSegments()`: a 0-minute work segment gets the 3-unit floor; non-zero segments keep correct relative proportions; a 0-minute wait stays at 0 width.

### Integration Tests

- [ ] Backend accepts 25 works with 24 waits and round-trips the arrays unchanged.
- [ ] Backend accepts a non-default count on `agileKiSteps` specifically, not only on `humanSteps`.
- [ ] Backend accepts the legacy 19/19/11/2 shape with no names field, on both POST and PUT.
- [ ] Backend accepts a names array matching the step count, and rejects one that does not — with a field error keyed to that process's names.
- [ ] Backend rejects a mismatched wait count with a field error keyed to that process's waits, using today's dotted key shape — checked for all four processes, including `agileKiSteps`.
- [ ] The seeded `Standard-Szenario` still returns the exact canonical arrays and the four totals 3.880 / 2.190 / 445 / 65.
- [ ] Frontend scenario load with 25 steps rebuilds the form to 25 rows and the role state to 25 entries.
- [ ] Frontend save after adding steps sends the new counts and names; loading that scenario restores both.
- [ ] Bar, both pies and the flow diagram all reflect the new step list right after an add or a remove (past the 150 ms debounce).

### Edge Cases

- [ ] Remove a middle step: the wait *after* it goes, the wait *before* it survives. Verified on values against the A/B/C/D worked example.
- [ ] Remove the last step: the wait *before* it goes.
- [ ] Remove step 3 on "Agile mit Menschen": step 13 still reports Tester. This spec must fail if roles are re-derived by position.
- [ ] Add a step on an agile process, then remove it: the role array shrinks in lockstep. This spec must fail if the add path forgot to append an empty role.
- [ ] Floor: at 1 step, remove is blocked, stays focusable, carries `aria-disabled`, and shows a visible reason.
- [ ] Cap: at 50 steps, add is blocked the same way. Backend rejects 51.
- [ ] Backend accepts exactly 1 work with 0 waits.
- [ ] Backend accepts exactly 50 works with 49 waits.
- [ ] Backend rejects 0 works.
- [ ] Frontend scenario load falls back to defaults for one bad process only, loading the other three, and throws nothing — for each of: 0 steps, mismatched wait count, over the cap, missing process field.
- [ ] Scenario load leaves the shared default label and role constants unchanged.
- [ ] Scenario load that shrinks a process releases the discarded controls' subscriptions and map entries, same as a manual remove.
- [ ] A 0-minute step renders a visible marker in the Balken view and is keyboard-focusable with a label.
- [ ] A process whose total is 0 renders equal-width, focusable work segments — not an empty bar.
- [ ] A 50-step process with every step at 0 minutes stays inside the 150-unit marker reserve and still renders 50 distinguishable, focusable markers.
- [ ] Focus after removal: to the step now in that position; to the new last step when the removed one was last; to "Schritt hinzufügen" at the floor.
- [ ] Repeated add/remove cycles leave no growing set of unit-conversion subscriptions or `letzteEinheit` entries.
- [ ] A name containing markup is rendered as text, never executed.

## Open Questions

The PRD's own Open Questions (insert-in-middle, reordering, floor, cap, default name, new-step role, editable roles, persisting names, reset button, unsaved-changes warning) stand and are not re-litigated here. This plan builds the recommended defaults from the PRD: append-only, floor 1, cap 50, default name "Neuer Schritt", new step gets no role, names persisted.

Three items the plan itself surfaces:

1. **Group 2 and Group 3 both edit `rechner.component.html`.** The plan sequences them rather than parallelising, which costs wall-clock time. Group 2's scope grew — it now lands the step-row structure too — so the overlap with Group 3 is larger than in the first draft, and sequencing is the safer call. Confirm whether concurrent edits to one template are ever acceptable in this workflow.
2. **The 3-unit marker floor and the 150-unit reserve are this plan's numbers, not the PRD's.** The PRD only requires "a thin marker" and "proportions stay correct". The numbers are chosen so the REQ-106 cap of 50 steps lands exactly on the reserve. If the step cap changes in the PRD's Open Question 4, revisit both numbers.
3. **Group 14's owner.** Spec updates under `docs/specs/` are technical, and no dedicated docs agent exists in the roster. `ba-writer` is the closest fit. If the project prefers each area's own coder to update its spec, split Group 14 across `be-coder`, `fe-coder`, `ui-designer` and the test coders instead.

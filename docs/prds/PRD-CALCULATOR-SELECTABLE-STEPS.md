# PRD: CALCULATOR-SELECTABLE-STEPS

## Summary

### Business Summary
The productivity calculator compares four ways of delivering one software ticket. Today the steps of each process are locked: people can change how long a step takes, but they cannot add a step or drop one. That forces every real-world process into our fixed template. This change lets people shape each process themselves — add steps, remove steps, rename them — and adds a clear note at the top of the page saying the shown times are examples that anyone can edit.

### Technical Summary
The four `ProzessDescriptor` entries in `frontend/src/app/core/models/prozess-defaults.ts` carry a fixed `stepCount` (19/19/11/2), and `PROZESS_STEP_LABELS` / `PROZESS_ROLLEN` are index-aligned constants — `agileKi` even shares the same array *reference* as `menschlich`, so any in-place mutation would leak across tabs. `RechnerComponent` builds `works`/`waits` FormArrays once in `ngOnInit` and never resizes them; names, roles, tooltips, ARIA text, bars, pies, flowchart and the tab caption all read by index. Scenario load gates on `stored.works.length === p.stepCount`. Backend `SzenarioSchema` (`backend/src/utils/validation.ts`) hard-enforces the same counts via `PROCESS_STEP_COUNTS` and `z.array(...).length(...)`, so this is **not** frontend-only — but the `szenario` table's only constraint is `json_valid`, so no DDL change is needed. Work: make per-process step count dynamic (name and role carried by the step itself, not by position), replace the fixed-length Zod rules with structural rules plus a cross-field refinement (`works ≥ 1`, `waits === works − 1`, cap), redesign scenario load to rebuild arrays, and rewrite the frontend and backend tests that assert 19/19/11/2.

## Source

User request via /plan-and-do.

## Problem Statement

**Problem 1 — the process shape is frozen.** The calculator ships four example processes. Their step lists are fixed: 19, 19, 11 and 2 steps. A visitor can change a duration but not the process itself. Real teams have different steps. A team with an extra approval round, or without a separate tester, cannot model their reality. The tool then compares our template against our template — not against their process. That weakens the whole point of the page.

**Problem 2 — the numbers look authoritative.** The page header says "Ein Ticket, vier Prozesse" and one subtitle line. Nothing says the times are examples. Nothing says they can be changed. A first-time visitor sees precise numbers ("3.880 Minuten") in a polished chart and reasonably assumes these are measured facts we stand behind. They are not — they are illustrative defaults. Two harms follow: people quote our example numbers as data, and people never discover the inputs they are meant to edit.

**Why now.** Both problems hit the same screen and the same first-visit moment. Fixing them together is one change to one page.

## Requirements

### Data model the requirements build on

One process is a chain: N steps, N−1 waits between them. A wait always belongs to the step **before** it. In the step-time form, a step's wait row sits directly beneath that step. The last step has no wait row of its own. Every requirement below uses this rule.

### Group 1 — Add and remove steps

**[REQ-101] A user can add a step to any of the four processes.**
Priority: High.
Reason: Without adding, the process shape stays ours, not theirs.
Acceptance:
- Each process's step-time form ("Schritt-Zeiten") has one action to add a step. German label: "Schritt hinzufügen". Text label, not an icon — matching every other button in this form.
- The action sits below the last step row of that process.
- The new step lands at the **end** of that process's list.
- Adding a step appends one step and one wait. The new wait goes after the previous last step, so it separates the old last step from the new one. Step count grows by one, wait count grows by one.
- The new step starts with a work time of 0 minutes, and the new wait starts at 0 minutes. Adding a step never changes the process total.
- The new step's time fields behave exactly like existing ones: number field plus Minuten/Stunden/Tage unit, same limits, same error text.
- Adding a step affects only the process the user is looking at. The other three are untouched — including the two agile processes, which today happen to show the same step list.
- After adding, keyboard focus moves into the new step's name field, with the text ready to overwrite. The placeholder name is meant to be replaced, so the user lands there.
- The action is reachable and operable by keyboard alone.
- A polite screen-reader announcement states the result, for example "Schritt hinzugefügt, jetzt 20 Schritte". See REQ-104.

**[REQ-102] A user can remove any step from any process.**
Priority: High.
Reason: Teams need to drop steps they do not have, not just append ones they do.
Acceptance:
- Every step row offers a remove action with an accessible name that names the step's position, for example "Schritt 5 entfernen". Text label ("Entfernen"), not an icon-only control.
- **Which wait goes with it — exact rule.** Removing the step at position `i` (counting from 0):
  - If step `i` is **not** the last step: remove the wait *after* step `i` — the wait row shown directly beneath that step. The wait that came *before* step `i` stays and now separates the two steps that became neighbours.
  - If step `i` **is** the last step: remove the wait *before* it, because the last step has no wait of its own.
  - Either way, the chain stays valid: N steps, N−1 waits.
- **Worked example.** Steps A, B, C, D. Waits: after-A, after-B, after-C.
  - Remove B: drop after-B. Result — A, C, D with after-A and after-C. After-A now sits between A and C.
  - Remove D (the last): drop after-C. Result — A, B, C with after-A and after-B.
- A process never drops below **one** step. At the floor, the remove action stays focusable but does not act, and says why. See REQ-106.
- Removal takes effect immediately. No confirmation dialog — the change is local and only becomes permanent when the user saves a scenario.
- **Focus after removal.** Focus moves to the remove action of the step that now sits in the removed step's position. If the removed step was the last in the list, focus moves to the remove action of the new last step. If the list is now at the floor and no removal is possible, focus moves to the "Schritt hinzufügen" action. Focus never lands on the page top or on nothing.
- A polite screen-reader announcement states the result, for example "Schritt entfernt, jetzt 18 Schritte". See REQ-104.

**[REQ-103] Each step has its own editable name.**
Priority: High.
Reason: A step added by a user has no preset German name, and a renamed step is how a team recognises its own process.
Acceptance:
- Every step row shows its name in an editable text field, for existing steps as well as new ones.
- The name field carries an accessible name that identifies the step, for example "Name für Schritt 5". This matches the existing convention in this form, where every input carries its own spoken label.
- A new step starts with the name "Neuer Schritt". It does **not** start with "Schritt N": the row already prints its position number in front of the name, so a stored number would go stale the moment steps are added or removed above it.
- An empty name is allowed. Wherever a name is shown — chart tooltips, flow-diagram boxes, screen-reader text — an empty name falls back to "Schritt N" using the step's **current** position.
- A rename shows up everywhere the step's name appears, not only in the input field. Tooltips, the flow diagram and all screen-reader text use the live name.
- Editing a name never changes any duration or total.
- Names are per process. Renaming a step in "Agile mit Menschen" does not rename anything in "Agile mit KI".
- A name holds at most 200 characters.

**[REQ-104] Everything tied to a step stays correct after add or remove.**
Priority: High.
Reason: Many parts of the page read steps by position. A shifted position silently mislabels charts.
Acceptance:
- The step count in the tab caption (today "Agile mit Menschen (19)") shows the live count.
- The bar chart, that process's pie chart or charts, and the flow diagram all reflect the new step list right away. Only the two agile processes show a second, role-split pie.
- Tooltips and screen-reader descriptions name the right step. "Wartezeit nach Schritt 7" refers to the step now in position 7.
- Screen-reader summaries that state a step count ("… mit 19 Schritten", "Ablaufdiagramm …, 19 Schritte") state the live count.
- The process total recomputes to the correct sum.
- **A 0-minute step is still visible and reachable in the bar view.** New steps start at 0 minutes, and the bar view is the default view. Every step gets at least a thin visible marker in the bar, and every step's marker is keyboard-focusable and carries its own spoken label — including a step with 0 minutes. The remaining bar width stays proportional to the real durations. Without this, adding a step in the default view produces no visible feedback at all.
- **One polite live region per process announces count changes.** After every add or remove, it states the action and the new count, for example "Schritt hinzugefügt, jetzt 20 Schritte" or "Schritt entfernt, jetzt 18 Schritte". The announcement is polite, never interrupting, and never steals focus.

**[REQ-105] A new step on the two agile processes has no role yet.**
Priority: Medium.
Reason: Only "Agile mit Menschen" and "Agile mit KI" split work across Business Analyst, Entwickler and Tester. A newly added step has no obvious owner.
Acceptance:
- A newly added step on those two processes starts with **no role**.
- A step without a role does not count towards any of the three slices in the role-split pie.
- Removing a step removes its role with it. See REQ-107 for the exact rule and for how the page keeps the two pies honest.
- See Open Questions: whether users should be able to pick a role per step is not decided here.

**[REQ-107] The role stays attached to its own step, and the two pies stay reconcilable.**
Priority: High.
Reason: Today the role is looked up purely by position. Remove one step above a "Tester" step and every later step silently gets the wrong role — the role pie then reports wrong numbers with no error and no hint. And work time on a step with no role vanishes from the role pie while the work-vs-wait pie still counts it, so the two pies on the same tab stop adding up.
Acceptance:
- Each step on the two agile processes carries its own role. The role is set once when the process is first built, from the existing role list. From then on, the role travels with its step. It is never re-derived from position.
- Adding a step gives that step no role, per REQ-105. Removing a step removes that step's role, and only that one. Every other step keeps its role.
- Worked check: on "Agile mit Menschen", remove step 3. Step 13 ("Tester testet …") must still report Tester, not the role of step 12.
- The role pie's note explains the rule so the difference is visible, never silent. It always states that only steps with a role are counted.
- When steps without a role carry more than 0 minutes of work, the note also names that amount, for example "Ohne Rolle: 30 Min.". A user can then reconcile the role pie against the work-vs-wait pie by hand.
- The role pie never shows a slice for a role that no step carries, and never shows a total larger than the process's work time.

**[REQ-106] Sensible limits.**
Priority: Medium.
Reason: The page must not break on an empty or absurd process.
Acceptance:
- Minimum one step per process.
- Maximum 50 steps per process.
- At a limit, the blocked action stays reachable by keyboard and is marked as unavailable to assistive technology, rather than being removed from the tab order. A keyboard user must still be able to land on it and learn why it does nothing.
- The reason is shown as text next to the control and stays visible — not hover-only, not a tooltip. Same visibility bar as the disclosure note in REQ-201.
- The same limits hold when a saved scenario is loaded. A scenario outside the limits is rejected and the process falls back to its example values, exactly as a malformed scenario does today.

### Group 2 — Sample-data disclosure

**[REQ-201] The page states up front that the times are examples and editable.**
Priority: High.
Reason: A first-time visitor must not mistake illustrative defaults for measured facts.
Acceptance:
- A short note sits near the top of the page, above the process-comparison card, visible without scrolling on a normal desktop window.
- The note says two things in plain German: the shown times are example values, and the user can change every value and add or remove steps.
- It is always visible. It cannot be dismissed away, so the next visitor sees it too. It does not auto-hide.
- It is real text, part of the reading order, and read by screen readers in the same place a sighted user sees it. Not an image, not a tooltip, not hover-only.
- Its colours meet the standard 4.5:1 text contrast.
- It reads as helpful information, not as a warning or an error.
- On a narrow screen the note keeps its position — first block of page content, above everything else. It may wrap onto more lines. It must not be collapsed, truncated, or moved below the charts. Some scrolling to see the charts underneath is fine; scrolling to *find the note* is not.

**[REQ-202] The example numbers themselves do not change.**
Priority: High.
Reason: The four totals (3.880 / 2.190 / 445 / 65 minutes) are the story the page tells and are asserted in tests and seed data.
Acceptance:
- On first load, all four processes show exactly today's step lists, names, durations and totals.
- The saved default scenario ("Standard-Szenario") still restores exactly those values.

### Group 3 — Saving and loading still works

**[REQ-301] A saved scenario keeps whatever step count each process had.**
Priority: High.
Reason: Saving is pointless if it silently throws away the steps a user just added.
Acceptance:
- Saving a scenario stores each process's full step list, whatever its length.
- Loading it restores that length — the form grows or shrinks to match, per process.
- Each process is handled on its own. One process with unusable data must not stop the other three from loading.
- A scenario whose data is unusable (no steps, wait count that does not match the step count, over the maximum) falls back to that process's example values, as today. No crash, no half-loaded state.
- Saving is rejected with a clear field-level message when the data is invalid. The message appears in the same place and the same style the page uses today, keyed to the same process field.
- A scenario saved before this change — the fixed 19/19/11/2 shape, no names — still saves and loads without error.

**[REQ-302] Step names are saved with the scenario.**
Priority: Medium.
Reason: Without this, a user names their steps, saves, reloads — and the names are gone.
Acceptance:
- Names travel with the scenario as a third list inside each process's stored data, alongside the work times and the wait times, in step order. One entry per step.
- The name list is optional. When it is present, its length must equal the step count. A mismatch is rejected the same way a wrong wait count is rejected: a field-level error naming that process.
- Each name holds at most 200 characters. Longer is rejected.
- Loading a scenario restores its names. A scenario saved before this change has no names stored; those processes fall back to the example names for as many steps as exist, then to "Schritt N".
- Names are plain text. Any markup or script in a name is displayed as text, never executed.
- See Open Questions: whether this may be deferred to a follow-up.

**[REQ-303] No database change.**
Priority: High.
Reason: Keeping storage untouched keeps this change small and deployable.
Acceptance:
- No new table, no new column, no change to any database constraint.
- The existing per-process storage already holds free-form structured data, so a different step count and an extra name list need no storage change.

### Open Questions

The requirements above state working defaults. They are firm enough to build against today — an implementer never has to guess. The questions below ask for final confirmation of the same values. A different answer changes a number or a default, not the design.

1. **Insert in the middle?** This PRD requires adding at the end only. Is inserting a step between two existing steps expected for the demo, or is append plus rename enough?
2. **Reorder existing steps?** Only append-at-end and delete-anywhere are covered. The Problem Statement's own example — a team with an extra approval round mid-process — is only half solved by append plus delete if step order matters to them. Is drag-or-move reordering in scope?
3. **Minimum step count.** Recommended floor is 1 step. Confirm — an alternative reading is 2 (a trigger plus at least one real step), which matches how every example process is built today.
4. **Maximum step count.** Recommended cap is 50 per process. Any number works technically; confirm the cap, because it also becomes a server-side validation rule.
5. **New-step name.** Recommended default is "Neuer Schritt", because the row already prints the position number and a stored "Schritt 20" would go stale after a removal. Confirm this over the literal "Schritt N".
6. **Role for a new step (agile processes only).** Recommended default is no role, with the role pie naming the excluded amount (REQ-107). The alternatives are: copy the role of the step above, add a fourth "Ohne Rolle" slice to the pie, or add a per-step role picker (bigger scope, also affects the saved scenario). Which?
7. **Editing roles at all.** Should existing steps' roles become editable, or stay fixed as today? This PRD assumes they stay fixed.
8. **Saving step names (REQ-302).** Recommended to include, because without it the rename feature loses its value on reload. It adds a field to the scenario payload and its validation. Confirm, or explicitly defer to a follow-up.
9. **Reset to defaults.** With editable steps, an explicit "Zurücksetzen" action becomes more useful. Today the only way back is loading the "Standard-Szenario". In scope or not?
10. **Unsaved-changes warning.** Added steps live only in the browser until a scenario is saved; a page reload drops them. Is a warning on leaving the page wanted, or is silent loss acceptable for a demo page?

## Out of Scope

These are deliberately not part of this change. Each maps to an Open Question above; if that question resolves the other way, the item moves into scope and this section shrinks.

- **Reordering or dragging existing steps.** Order is set by the order steps were created. See Open Question 2.
- **Inserting a step anywhere but the end.** Append only. See Open Question 1.
- **Editing the role of an existing step** on the two agile processes. Roles come from the example data and stay put. See Open Questions 6 and 7.
- **A "Zurücksetzen" button.** Loading the "Standard-Szenario" already restores the example values. See Open Question 9.
- **An unsaved-changes warning** when leaving the page. See Open Question 10.
- **Any database change.** No new table, column or constraint. See REQ-303.
- **Changing the example numbers** or the four canonical totals. See REQ-202.
- **Undo for a removed step.** Removal is immediate and final until the page is reloaded or a scenario is loaded.
- **A charting library.** Bars, pies and the flow diagram stay hand-built.

## Special Instructions

None beyond what's captured in Problem Statement and Requirements above.

## Implementation Approach (high-level, no code)

**1. Make step count a live value, not a constant.**
Today four constants declare how many steps each process has, and the screen reads those constants in four places: the tab caption, the bar chart's screen-reader description, the flow diagram's group label, and the scenario-load length check. Each of those becomes a read of the actual number of step rows currently in the form. The constants stay, but demoted to "how many steps this process starts with".

**2. Carry the name with the step, and rewire every read of it.**
The name currently lives in a separate constant list, matched to the step by position. Positions now move. Make the name part of the step's own form data.
Two halves here, and the second is easy to miss:
- Build the initial names from the existing constants — by **copying** them, never by using the shared lists directly. The two agile processes currently share one name list object; edits on one tab must not appear on the other.
- From then on the constant list is **only** a seed. Every runtime read of a step's name must switch to the step's own form value. That means the three component helpers that build the wait tooltip, the bar's spoken label and the flow-diagram box data, plus the three template reads (the step row's printed name, and the two spoken labels on the value input and the unit select). All six keep their "Schritt N" fallback, but computed from the step's **current** position. Miss any one of them and a renamed step keeps showing its old name there, which fails REQ-103 outright.

**3. Add and remove, with teardown.**
Adding appends one step entry and one wait entry. Removing drops the step entry plus exactly one wait entry, per the rule pinned down in REQ-102. Both actions run entirely in the browser and trigger the existing recalculation, which already refreshes the bar, the pies, the flow diagram and the totals. Apply the floor and cap from REQ-106 by marking the blocked control unavailable while keeping it focusable.
Removal must also clean up. Each step's unit dropdown holds a live subscription for unit conversion plus an entry in a lookup map that remembers the previously selected unit. Those live for the whole page session today. When a step or wait is removed, unsubscribe that control's conversion subscription and delete its map entry — for the removed work step and, when one is removed, the wait too. Otherwise every add/remove cycle leaves another detached control referenced for the rest of the session.

**4. Role travels with the step.**
The role map for the two agile processes is also position-matched. Turn it into per-process runtime state, seeded once from the constant list, then kept aligned with the steps: add appends an empty role, remove drops the role at that index. Never re-derive a role from a position after the initial build. Feed the role pie's note from this state so a role-less step's work time is named, not silently dropped (REQ-107).

**5. Scenario load: rebuild instead of patch, and re-derive roles.**
Today loading patches values into fixed-size arrays and rejects anything whose length does not match. Replace that with: validate the stored data structurally (at least one step, wait count exactly one less, within the cap), then rebuild that process's step rows to the stored length and fill them. Keep the existing per-process fallback to example values when validation fails. Keep the existing behaviour that suppresses the live recalculation during the load and then recomputes once.
Roles are not stored in a scenario. So a load must also rebuild each agile process's role state to the loaded step count: take the default role list, truncate it if the loaded process is shorter, pad with empty roles if it is longer. Skip this and a loaded 25-step process keeps a 19-entry role list, and the role pie goes wrong again.
Names follow the same shape rule: if REQ-302 ships, use the stored names; otherwise, or when a scenario predates the change, seed from the example names and fall back to "Schritt N" beyond them.

**6. Server-side validation.**
The scenario API currently rejects any payload whose step arrays are not exactly 19/19/11/2. Replace the exact-length rule per process with structural rules: at least one step, at most the cap, each duration an integer within today's bounds.
The "one fewer wait than steps" rule is a **cross-field** check — it compares two arrays inside the same process object, so it cannot be expressed as an independent per-array length rule. It needs an object-level refinement, and that refinement must attach an explicit error path pointing at the offending process's wait list. Without an explicit path the emitted field-error key changes shape, and the page's existing field-level error display stops finding the message. REQ-301 depends on that key shape staying the same.
If REQ-302 is confirmed, add an optional name list per process with the same cross-field treatment: present means length must equal the step count, explicit error path, plus a per-name character cap.

**7. Storage and seed.**
No table, column or constraint change: the existing per-process columns already accept any valid structured payload. The default-scenario seed keeps writing today's exact numbers, so the four canonical totals stay intact. If names ship, decide whether the seed writes them too — omitting them is fine, the fallback covers it.

**8. Disclosure note.**
Add the note to the page header area, above the comparison card. Plain text, always visible, informational styling consistent with the rest of the page, contrast-checked, and holding its position on narrow screens.

**Suggested sequencing.** Steps 1–4 are one frontend workstream. Step 6 is an independent backend workstream. Step 5 depends on both being agreed. Step 8 is independent of all of them and can ship first.

## Test Strategy

**Frontend unit tests (Jasmine/Karma).**

Note for the test author: totals and bar segments recompute through a 150 ms debounce on form changes. A test that asserts a total right after an add or remove needs to let that debounce elapse, or trigger the recompute explicitly. Assert without it and the test is flaky.

- Adding a step raises that process's step count by one and its wait count by one; the added step's work and the added wait are both 0; the process total is unchanged.
- Adding a step to one agile process leaves the other agile process's count and names untouched.
- Removing a middle step drops the wait **after** it; the wait before it survives and now separates the new neighbours. Assert on concrete values, not just lengths.
- Removing the last step drops the wait **before** it.
- After any removal, step count and wait count still differ by exactly one.
- Removing a middle step keeps every later step's name and role attached to the right step — the "Tester" step still reports Tester after a step above it is removed.
- The remove action is blocked at the minimum; the add action is blocked at the maximum; both stay focusable when blocked.
- Step names: default name of a new step; a rename shows up in the wait tooltip, the bar's spoken label and the flow-diagram data, not only in the input; an empty name falls back to "Schritt N" using the current position.
- Focus lands in the new step's name field after an add.
- Focus lands on the expected remove action after a removal, and on the add action when the list reaches the floor.
- The live region's text reports the new count after an add and after a remove.
- Charts after a change: bar segments, the pies and the flow diagram all report the new step count and the new totals. The role pie excludes steps with no role, and its note names the excluded work minutes when there are any.
- A 0-minute step still produces a focusable, labelled marker in the bar view.
- Scenario load with a step count different from the default rebuilds the form to the stored length, and rebuilds the agile role state to the same length.
- Scenario load with an invalid shape (zero steps, mismatched wait count, over the cap, missing process) falls back to defaults for that process only, and does not throw.
- Saving produces a payload matching the current, possibly non-default, step counts.
- Existing specs that assert the fixed 19/19/11/2 counts must be re-scoped to assert **default** counts, not permanent ones. This affects the calculator component spec and the process-defaults spec.

**Backend API tests (Playwright).**
- A scenario with a non-default but internally consistent step count (for example 25 steps and 24 waits) is accepted and round-trips unchanged. This is the test that actually proves the new rule works — the existing rewritten negative tests do not.
- Boundary, accepted: exactly 1 step with 0 waits.
- Boundary, accepted: exactly the cap — 50 steps with 49 waits.
- Boundary, rejected: 51 steps, over the cap.
- Rejected: 0 steps.
- Rejected: wait count that does not match the step count, with a field error naming that process's wait list. Cover a payload where the step count itself is non-default, so the failure is clearly the mismatch rule and not a leftover fixed-length rule.
- **Backward compatibility, through the real validator:** a POST and a PUT using the legacy default shape — 19/19/11/2, no name list — are accepted. The existing seed test only reads the seeded row back with a GET, which never runs through validation, so it proves nothing about the new rules.
- If names ship: accepted with a name list matching the step count; rejected when the name list length differs; rejected when a name exceeds the character cap; accepted when the name list is absent.
- Existing duration bound, duplicate-name and auth behaviour is unchanged.
- The seeded default scenario still returns the exact canonical arrays and the four totals 3.880 / 2.190 / 445 / 65.

**Manual / accessibility check.**
- Keyboard-only: reach add and remove, add a step, remove a step, confirm focus lands where REQ-101 and REQ-102 say, confirm blocked controls are still reachable and state their reason.
- Screen reader: the disclosure note is read near the top; the live region announces count changes; step counts in chart descriptions match what is on screen; the name input announces which step it renames.
- Contrast check on the disclosure note, the add/remove controls, and the blocked-state explanation text.
- Visual check of the flow diagram and the bar at the minimum (1 step) and at the cap.
- Narrow-viewport check: the disclosure note keeps its position and wraps; step rows with a name field plus a remove action fit without horizontal scrolling.

## Non-Functional Requirements

- **No new dependencies.** Charts stay hand-built; forms stay on the existing reactive-forms approach.
- **No database change.** No new table, column or constraint.
- **German UI.** All new labels, names and messages are German, in the existing plain tone.
- **Accessibility.** Every new control has an accessible name that identifies the step it acts on. Interactive targets meet the page's existing 44-pixel minimum. A control that is unavailable stays focusable, is marked unavailable to assistive technology, and shows its reason as persistently visible text — never hover-only. Text contrast at least 4.5:1. No information conveyed by colour alone. Count changes are announced politely and never steal focus.
- **UI convention.** This component uses text-label buttons throughout. No icon library is in play. Add and remove use text labels ("Schritt hinzufügen", "Entfernen"), not icons.
- **Responsive.** Step rows with a name field plus a remove action must still work on a narrow screen without horizontal scrolling.
- **Performance.** Adding or removing a step feels instant at the cap. The existing debounced recalculation stays. Typing in a name field must not cost more than the form already spends on a keystroke.
- **Memory.** Repeated add/remove cycles must not accumulate live subscriptions or map entries for controls that no longer exist.
- **Compatibility.** Scenarios saved before this change still load and still save.
- **Security.** Step names are user input. They are rendered as text and length-limited to 200 characters. They are never interpreted as markup.

## Success Criteria

1. On each of the four tabs, a user can add a step and see it appear at the end with 0 minutes of work and a 0-minute wait before it — visible in the default bar view, not just in the form. (REQ-101, REQ-104)
2. On each of the four tabs, a user can remove a step, and the correct wait goes with it per the REQ-102 rule — verified against the worked example.
3. Removing a step keeps the totals, the bar, the pies and the flow diagram correct, and keeps every remaining step's name and role attached to the right step. (REQ-104, REQ-107)
4. A user can rename any step, and the new name appears in the chart tooltips, the flow diagram and the screen-reader text — not only in the input field. (REQ-103)
5. The tab caption's step number matches the number of step rows actually shown, at all times. (REQ-104)
6. A newly added step on an agile process has no role, is excluded from the role pie, and the role pie's note names the excluded work minutes so the two pies reconcile. (REQ-105, REQ-107)
7. At 1 step the remove action is blocked with a visible reason; at 50 steps the add action is blocked with a visible reason; both stay reachable by keyboard. (REQ-106)
8. A scenario saved with a changed step count loads back with exactly that step count, and its agile role state matches that length. (REQ-301)
9. A scenario with unusable data for one process still loads the other three, with no error thrown. (REQ-301)
10. If REQ-302 ships: a user renames steps, saves, reloads the page, loads the scenario, and sees their names again. A scenario saved before this change still loads and still saves. (REQ-302)
11. A first-time visitor sees, without scrolling, that the times are examples and can be edited — on a desktop window and on a narrow screen. (REQ-201)
12. On a fresh load, the four totals are still 3.880 / 2.190 / 445 / 65 minutes. (REQ-202)
13. The manual accessibility pass is clean: keyboard-only add and remove with the specified focus targets, announced count changes, contrast checks, and the narrow-viewport check.
14. Frontend unit suite and backend API suite both pass, with the old fixed-count assertions rewritten rather than removed, and with at least one new positive test proving a non-default step count is accepted end to end.

## Technical Notes

*For implementers only.*

**Files in scope**
- `frontend/src/app/core/models/prozess-defaults.ts`
- `frontend/src/app/features/produktivitaet/rechner.component.ts`
- `frontend/src/app/features/produktivitaet/rechner.component.html`
- `frontend/src/app/core/models/szenario.model.ts` (only if REQ-302 is confirmed)
- `backend/src/utils/validation.ts`
- `backend/src/services/szenarioService.ts` (only if REQ-302 is confirmed — the DTO type widens; the SQL is already shape-agnostic)
- Tests: `frontend/src/app/features/produktivitaet/rechner.component.spec.ts`, `frontend/src/app/core/models/prozess-defaults.spec.ts`, `backend/src/test/szenario.spec.ts`
- Specs to update after the change: `docs/specs/SPECS-frontend.md` (Produktivität → Rechner section), `docs/specs/SPECS-backend.md` (documents the fixed step-count enforcement — goes stale the moment this ships), `docs/specs/SPECS-database.md` (the `szenario` table description still says `number[19]` / `number[11]` / `number[2]`), `docs/specs/SPECS-testing.md` (szenario spec row)

**Landmines found during investigation**

1. **Backend validation is NOT shape-agnostic.** `backend/src/utils/validation.ts` exports `PROCESS_STEP_COUNTS = { human: 19, agileKi: 19, semiAutomated: 11, automated: 2 }` and builds each process schema with a fixed array length for works and works−1 for waits. Any non-default step count is rejected with 400 today. This must change — the original task brief's assumption that no backend change is needed holds for the *database* but not for validation.

2. **The database really is shape-agnostic.** The `szenario` DDL in `backend/src/config/migrate.ts` constrains each of the four columns with a JSON-validity check only. No length constraint. No DDL change needed. Confirmed.

3. **The waits rule is cross-field.** Comparing the works length against the waits length spans two sibling fields, so it cannot be an independent per-array length rule. It needs an object-level refinement per process, with an explicit error path set on the issue. The frontend reads field errors by a dotted key naming the process and the array; lose the path and that key changes shape and the message stops rendering.

4. **Shared array references across the two agile processes.** In `prozess-defaults.ts`, the name lists for `agileKi` and `menschlich` are the *same array object*, and so are their role lists. The process descriptor's own name list points at the same object. Mutating any of these in place would corrupt the other tab. Copy on init; never mutate the exported constants. Two existing specs assert the identity of these shared references — keep the constants shared and read-only so those specs stay valid.

5. **`stepCount` has four live readers.** `rechner.component.html` lines 28 (bar description), 278 (tab caption), 331 (flow-diagram group label), plus `rechner.component.ts` line 796 (the length equality check in the scenario loader). `prozess-defaults.spec.ts` line 109 asserts the four counts directly.

6. **The scenario loader patches, it does not resize.** It iterates the incoming arrays and addresses the existing controls by index — indexes past the current array length silently no-op. It must resize before patching.

7. **Unit-conversion side effects have no teardown.** Each step group registers an entry in a map keyed by the unit control instance and subscribes for the component's lifetime. Newly added groups must be wired the same way. Removed groups need their subscription closed and their map entry deleted — today nothing removes either, so every add/remove cycle leaks one of each.

8. **Six name read sites, not one.** The name is template-and-helper-read by position today: the printed step row, the value input's spoken label, the unit select's spoken label, plus the wait tooltip helper, the bar's spoken-label helper and the flow-diagram data helper. All six have a "Schritt N" fallback already — which makes them easy to overlook, because they will never crash. They will just keep showing stale names. All six must read the step's own live name.

9. **The waits invariant is assumed everywhere.** The segment builder in `svg-util.ts` emits work/wait pairs and stops emitting waits past the wait array's length; the template gates the wait row on the index being inside the wait array; the flow-diagram helper returns no wait for the last step. All of this already tolerates a variable length — provided the "one fewer wait than steps" rule holds after every add and remove.

10. **The bar view deliberately skips focus on 0-minute steps today.** A template comment records this as an intentional earlier decision: the flow diagram makes every box focusable, the bar does not, because the single 0-minute trigger step was the only case. REQ-104 reverses that for the bar, since every new step starts at 0. Expect the tab-stop count in the bar to change, and update that template comment so the next reader does not "fix" it back.

11. **Only one FormArray exists in the whole frontend** — this component. There is no existing add-row / remove-row pattern to copy from. The add/remove interaction is new and needs a `ui-designer` / `ui-reviewer` pass rather than an assumed pattern. The same applies to the REQ-201 disclosure note: the app's only info-alert usage today is the dismissible notification component, which is the opposite of a persistent, non-dismissible banner. That pattern does not exist yet either and needs the same design review.

12. **The seed row is force-overwritten on every startup.** `backend/src/seed/szenarioSeed.ts` runs an unconditional update of the default-scenario row (id 1) after its insert-or-ignore. Any UI edit to that specific row is reverted on the next restart, by design. If REQ-302 ships, decide whether the seed also writes names — omitting them is fine, the fallback covers it.

13. **Backend test coupling — and a correction.** `backend/src/test/szenario.spec.ts` has four suites asserting 400 on a wrong array length: works 18 instead of 19, waits 17 instead of 18, semiAutomated works 10 instead of 11, automated waits 0 instead of 1. It is tempting to assume the first and third become valid payloads under the new rules. They do not. Each of those payloads leaves the *other* array at its original length, so all four still violate the "one fewer wait than steps" rule and still return 400 — for a different reason than before. All four need rewriting against the new rules; none can simply be deleted, and none flips to a passing 201 as written. Because every existing negative test stays negative, the suite would still pass even if variable step counts were rejected outright. Genuinely new positive tests are required, with internally consistent non-default counts — 18 works together with 17 waits, 1 with 0, 50 with 49 — to prove the new rule actually accepts a changed step count.

14. **The seed test proves nothing about validation.** The only test touching the default scenario reads it back with a GET. Reads never run through the request validator. Backward compatibility with the legacy 19/19/11/2 shape must be proven with a POST and a PUT.

15. **The recompute is debounced by 150 ms.** Form changes flow through a debounce before totals and segments update. Frontend tests that assert a total straight after an add or remove must account for it. The scenario loader already works around this by suppressing events during the patch and recomputing once at the end — keep that behaviour when the loader starts resizing arrays.

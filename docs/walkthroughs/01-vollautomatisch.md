[← README](../../README.MD) · **1 Vollautomatisch** · [2 Halbautomatisch: Erfolg](02-halbautomatisch-erfolg.md) · [3 Halbautomatisch: scheitert](03-halbautomatisch-scheitert.md)

# Walkthrough 1: Vollautomatisch — Ticket #10 ohne Rückfrage bauen

## Ziel

Dieser Walkthrough zeigt den vollautomatischen Weg der Software-Factory.

Ein Ticket ist fertig beschrieben. Ein Mensch hat es der KI zugewiesen und ins „Bereit" verschoben. Kein Klick fehlt mehr.

Du startest einen Skill. Der Skill prüft das Ticket, baut das Feature, testet es und schließt das Ticket ab. Ohne Rückfrage. Ohne dass du irgendwo klickst.

## Voraussetzungen

- App läuft: `./start.sh`. Frontend unter <http://localhost:7200>, Backend unter <http://localhost:7070>.
- `backend/.env` mit Agent-Token gesetzt. Details: [README → Voraussetzung: backend/.env für die headless Skills](../../README.MD#voraussetzung-backendenv-für-die-headless-skills). Fehlt die Datei, legt `./start.sh` sie automatisch aus dem Beispiel an.
- Ein Login-Account. Jeder reicht: `admin`/`admin123`, `user`/`test123` oder `demo`/`demo1234`. Das Board sieht jeder eingeloggte Nutzer.
- Repo steht auf Branch `main`. Kein offener Stand (`git status` zeigt „clean").
- Claude Code läuft im Repo-Root — dort rufst du den Skill auf.

## Vorgehen

1. **Git-Hygiene prüfen.**
   - Tu das: `git status` ausführen, dann `git checkout main`.
   - Du siehst: „On branch main. Your branch is up to date... nothing to commit, working tree clean."
   - Warum wichtig: `/plan-and-do` legt nur auf `main` automatisch einen neuen Branch an. Auf einem Feature-Branch würde es fragen — und der Skill läuft ja ohne Mensch.

2. **Einloggen.**
   - Tu das: <http://localhost:7200> öffnen, Karte „Admin User" anklicken (oder einen anderen Login).
   - Du siehst: Das Dashboard lädt.

3. **Ticket #10 auf dem Board finden.**
   - Tu das: <http://localhost:7200/admin/tickets> öffnen.
   - Du siehst: In Spalte „Bereit" liegt Karte **#10 „Chancen-Phase als farbiger Badge"**. Badges: „Aufgabe" und „KI" (Roboter-Symbol). Kein Kommentar-Symbol — noch keine Kommentare.
   - Optional: Karte anklicken. Body zeigt einen Business-Abschnitt (Farb-Mapping je Phase) und einen Technical-Abschnitt (Bootstrap-Klassen, eine gemeinsame Pipe/Helper-Funktion). Kein Klick nötig, um weiterzumachen — das Ticket ist schon „Bereit" und gehört der KI.

4. **Skill starten.**
   - Tu das: In Claude Code eingeben: `/do-fully-automatic 10`.
   - Du siehst: Der Skill lädt Ticket #10 per API. `status=TODO` und `owner=AI` → Klasse „Bereit". Kein Beförderungsschritt nötig, das Ticket ist schon in „Bereit".

5. **Beurteilung durch requirements-reviewer.**
   - Tu das: Nichts — läuft automatisch.
   - Du siehst: Der Skill ruft den `requirements-reviewer`-Subagenten auf. Urteil im Terminal: „gut genug zum Bauen" — das Ticket beschreibt eine klare, konkrete Änderung mit offensichtlich richtigem Ansatz.

6. **Ticket claimen.**
   - Tu das: Nichts — läuft automatisch.
   - Du siehst: Der Skill setzt das Ticket auf „In Bearbeitung" und hinterlässt den Kommentar „In Bearbeitung genommen. Baue jetzt via plan-and-do." Lädst du das Board neu, liegt Karte #10 jetzt in Spalte „In Arbeit".

7. **plan-and-do baut ohne Rückfrage.**
   - Tu das: Nichts — der Skill hat feste Standardantworten für jeden Checkpoint.
   - Du siehst im Terminal: kein PRD (direkt zum Plan), Plan automatisch freigegeben („Approve, implement, and review"), Code entsteht (gemeinsame Farb-Mapping-Pipe, Badge in Chancen-Liste **und** Chancen-Detail), Frontend-Tests laufen (`cd frontend && npm run test:ci`), eine Review-Runde. Keine Pause, keine Frage.

8. **Ticket abschließen.**
   - Tu das: Nichts — läuft automatisch.
   - Du siehst: Der Skill ruft `POST /:id/done` auf. Kommentar mit Kurz-Zusammenfassung und Branch-Name. Terminal meldet den Abschluss.

9. **Board erneut prüfen.**
   - Tu das: <http://localhost:7200/admin/tickets> neu laden.
   - Du siehst: Karte #10 liegt in Spalte „Erledigt". Badges: „Aufgabe", „KI", „Erledigt". Karte anklicken zeigt den Kommentar-Thread — jeder Statuswechsel des Skills steht dort.

10. **Feature verifizieren.**
    - Tu das: <http://localhost:7200/chancen> öffnen.
    - Du siehst: Spalte „Phase" zeigt jetzt einen farbigen Badge statt reinem Text.
    - Tu das: Eine Chance anklicken, z. B. <http://localhost:7200/chancen/1>.
    - Du siehst: Die Detailseite zeigt die Phase ebenfalls als farbigen Badge. Farben: NEU blau, QUALIFIZIERT hellblau, ANGEBOT gelb, VERHANDLUNG dunkelgrau, GEWONNEN grün, VERLOREN rot.
    - Hinweis: Die Detailseite zeigt den farbigen Badge schon vor dem Lauf. Sichtbar ändert sich nur die Liste. Der Skill legt das Farb-Mapping aber an einer Stelle ab und nutzt es an beiden Stellen.

11. **Git-Ergebnis prüfen.**
    - Tu das: `git branch` und `git log --oneline -5` ausführen.
    - Du siehst: Ein neuer lokaler Branch mit eigenen Commits für das Feature. Kein Push, kein Pull Request — der Skill lässt beides absichtlich aus.

## Erwartetes Ergebnis

- Ticket #10 steht auf dem Board in Spalte „Erledigt", `solution=DONE`.
- Der Kommentar-Thread des Tickets dokumentiert jeden Schritt: Claim, Fertigstellung.
- Chancen-Liste **und** Chancen-Detailseite zeigen die Phase als farbigen Badge.
- Ein neuer lokaler Git-Branch mit den Commits liegt vor. Nichts wurde gepusht, kein PR ist offen.

Der Skill läuft auch ganz ohne Claude Code im Vordergrund — headless, z. B. in CI. Der Aufruf folgt demselben Muster wie `/do-semi-automatic` in CI: `claude -p "/project:do-fully-automatic 10"`. Details zur headless-Form und zum nötigen `backend/.env`: [README → Voraussetzung: backend/.env für die headless Skills](../../README.MD#voraussetzung-backendenv-für-die-headless-skills).

## Zurücksetzen

Nach einem Durchlauf stehen Tickets und Feedback-Items nicht mehr im Ausgangszustand. So setzt du zurück:

- **Alles zurücksetzen (empfohlen):** App stoppen, dann `./start.sh --reset-db`. Das löscht die SQLite-Datenbank und legt sie mit den Seed-Daten neu an. Nur so starten neue Ticket-IDs wieder bei **13**.
- **Nur Feedback-Items:** Auf `/admin/agent-tasks` den Button **„Alle Aufgaben zurücksetzen"** klicken. Tickets bleiben unverändert.
- **Nur Tickets:** Dafür gibt es keinen Button. Per `curl` als Admin anmelden und den Reset aufrufen:

  ```bash
  curl -s -c /tmp/crm-cookies.txt -H 'Content-Type: application/json' \
    -d '{"benutzername":"admin","passwort":"admin123"}' \
    http://localhost:7070/api/auth/login
  curl -s -b /tmp/crm-cookies.txt -X POST http://localhost:7070/api/tickets/reset
  ```

  Achtung: Dieser Reset setzt die ID-Vergabe **nicht** zurück. Neue Tickets bekommen danach höhere IDs als 13.

- **Git:** Der Skill hat einen lokalen Branch angelegt. Zurück mit `git checkout main`. Den Branch löschen mit `git branch -D <branch-name>`.

> **Ticket-IDs sind nicht fest.** Lies die ID immer vom Board oder aus der Ausgabe des Skills ab, bevor du sie weitergibst.

## Hintergrund

- Ticket-Lebenszyklus, Owner-Modell, Board-API im Detail: [docs/specs/SPEC-API-TICKETS.md](../specs/SPEC-API-TICKETS.md).
- Genauer Ablauf des Skills, Schritt für Schritt: [.claude/skills/do-fully-automatic/SKILL.md](../../.claude/skills/do-fully-automatic/SKILL.md).
- Konzept-Überblick der ganzen Pipeline (Feedback → Ticket → Build): [docs/WALKTHROUGH.md](../WALKTHROUGH.md).

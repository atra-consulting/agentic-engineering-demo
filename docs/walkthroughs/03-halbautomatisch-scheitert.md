[← README](../../README.md) · [1 Vollautomatisch](01-vollautomatisch.md) · [2 Halbautomatisch: Erfolg](02-halbautomatisch-erfolg.md) · **3 Halbautomatisch: scheitert**

# Walkthrough 3: Halbautomatisch — wenn die Anforderung zu vage ist

## Ziel

Dieser Walkthrough zeigt einen Feedback-Satz, der zu vage zum Bauen ist.

Du siehst: Die KI rät nicht. Sie stoppt zweimal — einmal beim Ticket-Anlegen,
einmal beim Bauversuch. Beide Male schickt sie das Ticket zurück an den
Menschen, mit einer konkreten Frage statt einer Vermutung.

Anders als in [Walkthrough 2](02-halbautomatisch-erfolg.md) endet dieser Lauf
**ohne** Code. Das ist kein Fehler. Das ist das gewünschte Ergebnis.

## Voraussetzungen

- App läuft: `./start.sh` (Frontend <http://localhost:7200>, Backend <http://localhost:7070>).
- `backend/.env` enthält `AGENT_API_TOKEN` und `AGENT_AUTH_ALLOW_LOOPBACK=1`.
  Details: [Voraussetzung: `backend/.env` für die headless Skills](../../README.md#voraussetzung-backendenv-für-die-headless-skills).
- Du bist als `admin` / `admin123` im Frontend eingeloggt. Ticket-Aktionen
  brauchen Admin-Rechte.
- Du stehst lokal auf `main`, Arbeitsverzeichnis sauber (`git status`).

## Vorgehen

1. **Git-Hygiene prüfen.**
   - Tippe `git status` und `git branch --show-current`.
   - Du siehst: Branch `main`, keine offenen Änderungen.
   - Grund: Falls das Ticket am Ende doch gebaut wird (optionaler Schritt 10),
     legt `plan-and-do` einen neuen Branch an — und das geht nur sauber von `main` aus.

2. **Als Admin einloggen.**
   - Öffne <http://localhost:7200/login>.
   - Melde dich an mit `admin` / `admin123`.
   - Du siehst: das Dashboard der App.

3. **Feedback-Element #4 ansehen.**
   - Öffne <http://localhost:7200/admin/agent-tasks?source=EMAIL>.
   - Suche Eintrag **#4 „Fix the broken feature"**, Status `OPEN`.
   - Klick auf die Zeile. Body: „Something is broken. Please fix it as soon
     as possible." — ein Satz, kein Detail, keine Funktion genannt.

4. **`/write-ticket 4` ausführen.**
   - Tippe in Claude Code: `/write-ticket 4`
   - Im Verlauf siehst du: Der Skill lädt Aufgabe #4 und setzt sie auf
     `IN_PROGRESS`. Er ruft den `requirements-reviewer`-Subagenten. Urteil:
     „muss verfeinert werden" — der Satz beschreibt keine konkrete Änderung.
   - Der Skill legt trotzdem **immer** ein Ticket an: Status **Definition**,
     Eigentümer **Mensch**, `fullyReady=false`. Der Typ (Feature, Bug oder
     Aufgabe) kommt vom Subagenten — bei diesem Feedback ist `Bug`
     naheliegend, kann im Einzelfall aber abweichen.
   - Er hinterlässt einen Kommentar mit **nur Fragen** — zum Beispiel
     sinngemäß: Welche Funktion ist betroffen? Wie äußert sich der Fehler
     genau? Seit wann tritt er auf? (Der genaue Wortlaut entsteht live, kann
     also anders ausfallen.)
   - Er schließt Aufgabe #4 (Status `DONE`) mit dem Kommentar „Triagiert in
     Ticket #<id> (Definition, Mensch). Rückfrage im Ticket hinterlegt."
   - Letzte Ausgabe des Skills:
     ```
     ============================================
     TICKET #<id> ANGELEGT
     http://localhost:7200/admin/tickets/<id>
     ============================================
     ```
   - Notiere dir die ID. Auf einer frischen Datenbank ist sie wahrscheinlich
     **13** — oder **14**, falls zuvor schon Walkthrough 2 gelaufen ist.
     Verlass dich nicht auf eine feste Zahl. Lies sie aus der Ausgabe.

5. **Ticket öffnen und den Kommentar lesen.**
   - Öffne die ausgegebene URL.
   - Der Ticket-Text hat vier Abschnitte: „Feedback" (Originaltext als
     Zitat, plus ein Link zurück zur Aufgabe #4), „Fachlich (für Business)",
     „Technisch (für Entwickler)", „Akzeptanzkriterien".
   - Darunter: ein Kommentar mit den offenen Fragen. Der Autor steht als
     **„Mensch"** — nicht „Claude Code". Grund: Der Kommentar-Endpunkt
     speichert jeden Kommentar immer als `author=HUMAN`, egal wer ihn
     schreibt. Das gilt für jeden Kommentar, den ein Skill über die API
     absetzt — merk dir das für Schritt 9.
   - Alternativ: Öffne <http://localhost:7200/admin/tickets>. Das Ticket
     steht in der Spalte **Definition**.

6. **Absichtlich NICHT antworten.**
   - Lass die Fragen offen. Schreib keinen Kommentar.
   - Das ist der Kern dieses Walkthroughs: Was passiert, wenn ein Mensch das
     Ticket trotzdem weiterschickt, ohne es zu klären?

7. **„Nach Bereit" klicken.**
   - Rechts unter „Aktionen" → „Definition abschließen" → Button
     **„Nach Bereit"**.
   - Du siehst: Status wechselt zu **Bereit**, Eigentümer zu **KI**.
   - Warum das erlaubt ist: Der Klick setzt nur Status und Eigentümer. Er
     prüft nicht, ob der Inhalt fertig ist. Diese Prüfung übernimmt erst der
     nächste Schritt.

8. **`/do-semi-automatic <id>` ausführen.**
   - Tippe: `/do-semi-automatic <id>` (deine ID aus Schritt 4).
   - Der Skill lädt das Ticket und prüft nur zwei Dinge: Eigentümer `AI`?
     Status `TODO`? Beides stimmt — diese Vorprüfung sagt nichts über den
     Inhalt aus.
   - Er liest den Kommentar-Thread: die Fragen stehen unbeantwortet da.
   - Er ruft wieder den `requirements-reviewer`-Subagenten, dieses Mal mit
     Ticket-Text **und** Kommentar-Thread. Urteil: **„zurückgeben"** — die
     offene Entscheidung fehlt weiterhin.

9. **Die Ablehnung beobachten.**
   - Im Verlauf siehst du drei Aufrufe: einen neuen Kommentar (was genau
     fehlt), Eigentümer zurück auf `HUMAN`, Status zurück auf `DEFINITION`.
   - Kein `/start` — das Ticket war nie „In Arbeit". Kein `plan-and-do`.
     Kein Branch, kein Commit, kein Push, kein PR.
   - Lade die Ticket-Seite neu. Du siehst: Status **Definition**, Eigentümer
     **Mensch**, **2 Kommentare**. Auch der neue Kommentar zeigt Autor
     **„Mensch"** — aus demselben Grund wie in Schritt 5.

10. **(Optional) Fragen beantworten und erneut versuchen.**
    - Schreib die Antworten als normalen Kommentar. Klick **„Kommentar
      senden"** — **nicht** „Zurück an KI". Der Button „Zurück an KI"
      funktioniert nur bei Status **Wartet**. Unser Ticket steht auf
      **Definition** — dort schlägt der Aufruf fehl.
    - Klick danach erneut **„Nach Bereit"**.
    - Führe `/do-semi-automatic <id>` erneut aus. Sind die Fragen jetzt klar
      beantwortet, baut der Skill das Ticket über `plan-and-do` — genau wie
      in [Walkthrough 2](02-halbautomatisch-erfolg.md).

## Erwartetes Ergebnis

- Ticket steht wieder auf **Definition**, Eigentümer **Mensch**.
- Zwei Kommentare: die ursprünglichen Fragen und die Begründung der
  Ablehnung. Beide zeigen Autor „Mensch", obwohl beide von der KI stammen.
- Kein Code geschrieben. Kein Branch, kein Commit, kein Push, kein PR.
- Aufgabe #4 steht auf `DONE` und verweist auf das Ticket.
- Das ist der Erfolg dieses Walkthroughs: Die KI rät nicht, wenn ihr Fakten
  fehlen. Sie fragt — und wartet.

## Zurücksetzen

Nach einem Durchlauf stehen Tickets und Feedback-Items nicht mehr im Ausgangszustand. So setzt du zurück:

- **Alles zurücksetzen (empfohlen):** App stoppen, dann `./start.sh --reset-db`. Das löscht die SQLite-Datenbank und legt sie mit den Seed-Daten neu an. Nur so starten neue Ticket-IDs wieder bei **13**.
- **Nur Feedback-Items:** Auf `/admin/agent-tasks` den Button **„Zurücksetzen"** klicken. Tickets bleiben unverändert.
- **Nur Tickets:** Dafür gibt es keinen Button. Per `curl` als Admin anmelden und den Reset aufrufen:

  ```bash
  curl -s -c /tmp/crm-cookies.txt -H 'Content-Type: application/json' \
    -d '{"benutzername":"admin","passwort":"admin123"}' \
    http://localhost:7070/api/auth/login
  curl -s -b /tmp/crm-cookies.txt -X POST http://localhost:7070/api/tickets/reset
  ```

  Achtung: Dieser Reset setzt die ID-Vergabe **nicht** zurück. Neue Tickets bekommen danach höhere IDs als 13.

- **Git:** Nichts zu tun. `/do-semi-automatic` hat nichts gebaut — kein Branch, kein Commit.

> **Ticket-IDs sind nicht fest.** Lies die ID immer vom Board oder aus der Ausgabe des Skills ab, bevor du sie weitergibst.

## Hintergrund

- [`docs/specs/SPEC-API-TICKETS.md`](../specs/SPEC-API-TICKETS.md) — die
  Ticket-API im Detail: Zustandsmaschine, Endpunkte, wer welchen Kommentar
  wie speichert.
- [`.claude/skills/write-ticket/SKILL.md`](../../.claude/skills/write-ticket/SKILL.md) —
  der Skill aus Schritt 4: wie er Feedback beurteilt und immer ein Ticket
  anlegt, egal wie das Urteil ausfällt.
- [`.claude/skills/do-semi-automatic/SKILL.md`](../../.claude/skills/do-semi-automatic/SKILL.md) —
  der Skill aus Schritt 8, insbesondere „Schritt 3a — Nicht gut genug → zurück
  auf Definition + Human": genau der Pfad, den dieser Walkthrough auslöst.
- [`docs/WALKTHROUGH.md`](../WALKTHROUGH.md) — die Pipeline im Überblick:
  Feedback triagieren, dann bauen (oder eben nicht).

Die Lektion dieses Walkthroughs: Ein Ticket in der Spalte „Bereit" ist nicht
automatisch fertig gedacht. Nur ein Mensch, der „Nach Bereit" klickt, oder
`do-fully-automatic`, das selbst befördert, garantiert, dass jemand den
Inhalt geprüft hat. `do-semi-automatic` verlässt sich nie allein auf den
Status — es liest den Kommentar-Thread und urteilt selbst, jedes Mal neu.

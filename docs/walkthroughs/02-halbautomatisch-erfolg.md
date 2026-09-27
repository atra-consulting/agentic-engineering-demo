[← README](../../README.MD) · [1 Vollautomatisch](01-vollautomatisch.md) · **2 Halbautomatisch: Erfolg** · [3 Halbautomatisch: scheitert](03-halbautomatisch-scheitert.md)

# Walkthrough 2: Halbautomatisch — vom Feedback zum fertigen Feature

## Ziel

Ein Kundenwunsch kommt per E-Mail rein. Die KI schreibt daraus ein Ticket.
Ein Mensch prüft es kurz und gibt es frei. Danach baut die KI das Feature
komplett allein — ohne weitere Rückfragen.

Der Unterschied zu Walkthrough 1: Hier gibt ein Mensch aktiv das OK, bevor
die KI baut. Der Klick auf **„Nach Bereit"** ist die Freigabe.

## Voraussetzungen

- App läuft: `./start.sh` (Backend Port 7070, Frontend Port 7200).
- `backend/.env` ist eingerichtet. Siehe [README → Voraussetzung: backend/.env](../../README.MD#voraussetzung-backendenv-für-die-headless-skills).
- Du bist als Admin eingeloggt (`admin` / `admin123`). Login-Daten: [README → Demo-Login](../../README.MD#demo-login).
- Dein Git-Arbeitsverzeichnis ist sauber und steht auf `main`. `plan-and-do` legt einen neuen Branch nur von `main` aus an. Falls nicht: erst committen oder stashen.
- Aufgabe #18 in der Feedback-Queue steht auf Status `OPEN`. Frisch installiert ist das automatisch so. Lief dieses Walkthrough schon einmal, setz erst zurück (siehe [Zurücksetzen](#zurücksetzen)).

## Vorgehen

1. **Git-Hygiene prüfen.** Terminal: `git status` und `git branch --show-current`.
   Erwartung: Branch `main`, keine offenen Änderungen.

2. **Einloggen.** Öffne <http://localhost:7200/login>. Melde dich als
   `admin` / `admin123` an. Du landest auf dem Dashboard.

3. **Das Feedback ansehen.** Öffne <http://localhost:7200/admin/agent-tasks>.
   Klick die Kachel **„Customer Emails"** → Button **„Aufgaben anzeigen"**.
   (Oder direkt die gefilterte URL: <http://localhost:7200/admin/agent-tasks?source=EMAIL>.)
   Du siehst eine Tabelle mit Kunden-E-Mails. Aufgabe **#18 „Show the website
   in the company list"** steht auf Status `OPEN`. Klick die Zeile an: Der
   Kunde vermisst die Webseite in der Firmen-Liste — er sieht dort nur Name,
   Branche, E-Mail und Telefon.

4. **Ticket erzeugen lassen.** Öffne ein Terminal im Projekt-Root, starte
   Claude Code, und tippe:
   ```
   /write-ticket 18
   ```
   Der Skill läuft headless. Er lädt Aufgabe #18, lässt den
   `requirements-reviewer`-Subagenten urteilen, legt ein neues Ticket an und
   schließt Aufgabe #18 ab. Die Anfrage ist klar und konkret — der Subagent
   urteilt „gut genug zum Bauen", also bekommt das Ticket `fullyReady=true`
   und **keinen** Kommentar. Am Ende druckt der Skill einen Block wie:
   ```
   ============================================
   TICKET #13 ANGELEGT
   http://localhost:7200/admin/tickets/13
   ============================================
   ```
   **Notiere dir diese ID.** Auf einer frischen Datenbank ist sie vermutlich
   `13` — verlass dich aber nicht darauf. Lies sie immer aus dieser Ausgabe.

5. **Aufgabe #18 als abgeschlossen prüfen.** Lade die Aufgaben-Liste neu.
   Aufgabe #18 steht jetzt auf `DONE`. Öffne sie: Der Kommentar erklärt die
   Triage, und ein direkter Link **„Ticket #<id>"** führt dich zum neuen
   Ticket.

6. **Das neue Ticket öffnen.** Öffne den Link aus Schritt 4
   (`http://localhost:7200/admin/tickets/<id>`). Du siehst:
   - Status **Definition**, Eigentümer **Mensch**.
   - Keinen Kommentar — die Anfrage war klar genug.
   - Den Ticket-Text mit vier Abschnitten: **Feedback** (die Original-E-Mail
     als Zitat, plus Link zur Quell-Aufgabe), **Fachlich (für Business)**,
     **Technisch (für Entwickler)**, **Akzeptanzkriterien**.

   Intern trägt das Ticket jetzt `fullyReady=true`. Das siehst du im UI
   nicht — dieses Flag zählt nur für `/do-fully-automatic`, das wir hier
   nicht nutzen.

7. **Freigeben: „Nach Bereit" klicken.** Rechts auf der Ticket-Seite, im
   Kasten „Aktionen" → „Definition abschließen", stehen zwei Buttons:
   - **„An KI übergeben"** — setzt nur den Eigentümer auf KI. Das Ticket
     bleibt in „Definition". Noch nicht baubar.
   - **„Nach Bereit"** — setzt den Eigentümer auf KI **und** verschiebt das
     Ticket nach „Bereit" (`status=TODO`).

   Klick **„Nach Bereit"**. Der Status-Badge wechselt auf **Bereit**,
   Eigentümer bleibt **KI**.

   > **Warum dieser Klick die eigentliche Freigabe ist:**
   > `/do-fully-automatic` könnte ein `fullyReady`-Ticket auch ohne Klick
   > selbst befördern. `/do-semi-automatic` kann das nicht — es rührt
   > ausschließlich Tickets an, die schon in „Bereit" liegen und der KI
   > gehören. Dein Klick auf „Nach Bereit" ist hier die einzige
   > menschliche Entscheidung im ganzen Ablauf. Danach fragt die KI nichts
   > mehr — sie läuft komplett headless und beantwortet jeden
   > Plan-Checkpoint selbst.

8. **Bauen lassen.** Zurück im Terminal. Setze die ID aus Schritt 4 ein:
   ```
   /do-semi-automatic 13
   ```
   Beobachte, was passiert:
   - Der Skill lädt das Ticket, prüft `owner=AI` und `status=TODO` — beides
     erfüllt dank Schritt 7.
   - Der `requirements-reviewer`-Subagent liest den (leeren) Kommentar-Thread
     und urteilt „gut genug zum Bauen".
   - Der Skill claimt das Ticket (Status → **In Arbeit**) und hinterlässt
     einen kurzen Kommentar dazu.
   - Er ruft `/plan-and-do` auf — mit fest vorgegebenen Antworten für jeden
     Checkpoint: Er überspringt das PRD, der Plan gilt automatisch als
     freigegeben, er übernimmt jeden Review-Befund automatisch. **Kein
     einziger Checkpoint hält an. Die KI fragt zu keinem Zeitpunkt
     `AskUserQuestion`.**
   - Nach Build, Test und Review markiert der Skill das Ticket als erledigt.

9. **Ergebnis auf dem Ticket prüfen.** Lade die Ticket-Seite neu. Status
   steht auf **Erledigt**, Lösung auf **Erledigt**. Im Kommentar-Verlauf
   stehen jetzt zwei neue Kommentare:
   - „In Bearbeitung genommen. Baue jetzt via plan-and-do." — technisch als
     Mensch-Kommentar gespeichert (der Skill nutzt hier den generischen
     Kommentar-Endpunkt, der jeden Kommentar als `author=HUMAN` ablegt).
   - Ein Abschluss-Kommentar von **„Claude Code"** mit einer kurzen
     Zusammenfassung, was gebaut wurde, inklusive Branch-Name.

10. **Das Feature verifizieren.** Öffne <http://localhost:7200/firmen>. Die
    Firmen-Liste zeigt jetzt eine zusätzliche Spalte mit der Webseite jeder
    Firma, neben Name, Branche, E-Mail, Telefon und Personen. (Der genaue
    Spaltenname kann leicht abweichen — die KI entscheidet das beim Bauen.)

11. **Git-Ergebnis ansehen.** Terminal: `git branch --show-current` zeigt
    einen neuen, lokalen Branch — nicht `main`. `git log --oneline -5` zeigt
    neue Commits. Kein Push, kein PR: `/do-semi-automatic` macht beides nie.

## Erwartetes Ergebnis

- Aufgabe #18 steht auf `DONE`, mit Kommentar zur Triage und Link zum Ticket.
- Ein Ticket ist komplett durchgelaufen: Definition → Bereit → In Arbeit → Erledigt.
- Die Firmen-Liste zeigt die Webseite an.
- Ein neuer lokaler Branch mit Commits existiert. Kein Push, kein PR.
- Im ganzen Lauf hat die KI nichts gefragt — außer deinem einen Klick auf
  „Nach Bereit". Das war die einzige menschliche Entscheidung.

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

- **Git:** `/do-semi-automatic` hat einen lokalen Branch angelegt. Zurück mit `git checkout main`. Den Branch löschen mit `git branch -D <branch-name>`.

> **Ticket-IDs sind nicht fest.** Lies die ID immer vom Board oder aus der Ausgabe des Skills ab, bevor du sie weitergibst.

## Hintergrund

- Konzept-Überblick der ganzen Pipeline (Feedback → Ticket → Build):
  [docs/WALKTHROUGH.md](../WALKTHROUGH.md)
- Ticket-API im Detail, inklusive Status-Maschine und Owner-Modell:
  [docs/specs/SPEC-API-TICKETS.md](../specs/SPEC-API-TICKETS.md)
- Skill-Ablauf Schritt für Schritt:
  [.claude/skills/write-ticket/SKILL.md](../../.claude/skills/write-ticket/SKILL.md) ·
  [.claude/skills/do-semi-automatic/SKILL.md](../../.claude/skills/do-semi-automatic/SKILL.md)
- Alle Skills und Subagents im Überblick: [README → Die Skills](../../README.MD#die-skills)

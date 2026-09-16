# Walkthrough: Vom Feedback zum fertigen Ticket

Diese Seite zeigt die Pipeline von einem rohen Feedback-Element bis zum fertig gebauten Kanban-Ticket. Drei Skills spielen zusammen: `/write-ticket` triagiert, `/do-semi-automatic` und `/do-fully-automatic` bauen.

Login-Daten stehen in der [README](../README.MD#demo-login). Details zu den Skills: [README → Die Skills](../README.MD#die-skills).

## Schritt 0: Ein Feedback-Element existiert

Am Anfang steht ein Stück Feedback. Zum Beispiel:

- ein Bug-Report,
- eine Feature-Idee,
- ein Fehlerbericht aus den Logs.

Das Feedback kommt entweder aus der `agent_task`-Queue (Quellen `EMAIL`, `GITHUB_ISSUE`, `APP_LOG`, `ERROR_REPORT` — sichtbar unter <http://localhost:7200/admin/agent-tasks>) oder als freier Text.

## Schritt 1: `/write-ticket` — Triage

`/write-ticket` verwandelt das Feedback in ein neues Kanban-Ticket.

- Nimmt eine Task-ID, eine Task-URL, oder freien Text als Argument. Ohne Argument holt sich der Skill die nächste offene Task aus der Queue.
- Beurteilt das Feedback mit dem `requirements-reviewer`-Subagent.
- Legt **immer** ein neues Ticket an — Status `Definition`, Owner `HUMAN`.
- Ist das Feedback detailliert genug, markiert der Skill das Ticket als `fullyReady`. Das ist ein Signal für `/do-fully-automatic`, das Ticket später ohne Rückfrage zu befördern.
- Ist das Feedback zu dünn, hinterlässt der Skill einen Kommentar mit dem, was fehlt.
- Baut nie Code. Pusht nie. Öffnet nie einen PR.

Nach `/write-ticket` liegt das Ticket in der Spalte „Definition" auf dem Board. Ein Mensch schaut es sich an.

## Schritt 2: Ein Mensch entscheidet, wie es weitergeht

In „Definition" hat ein Mensch zwei Optionen:

- **„An KI übergeben"** — weist das Ticket der KI zu (`owner=AI`), bleibt aber in „Definition". Die KI muss die Beförderung nach „Bereit" noch selbst beurteilen.
- **„Nach Bereit"** — weist das Ticket der KI zu **und** verschiebt es direkt nach „Bereit" (`status=TODO`). Sofort bereit zum Bauen.

Ein `fullyReady`-Ticket braucht diesen Schritt nicht — `/do-fully-automatic` befördert es später selbst.

## Schritt 3: Bauen — zwei Skills zur Auswahl

Beide Skills laufen headless, arbeiten genau ein Ticket pro Lauf, fragen nie nach (kein `AskUserQuestion`), pushen nie und öffnen nie einen PR.

### `/do-semi-automatic`

Baut genau ein `Bereit+KI`-Ticket. Voraussetzung: ein Mensch hat das Ticket schon per „Nach Bereit" freigegeben.

- Ohne Argument nimmt der Skill das nächste `Bereit+KI`-Ticket.
- Beurteilt es: zu dünn beschrieben? Zurück nach „Definition", Owner Mensch. Gut genug? Baut es komplett über `/plan-and-do`.

### `/do-fully-automatic`

Macht alles, was `/do-semi-automatic` macht — plus einen zusätzlichen Fall.

- Nimmt zuerst ein `Bereit+KI`-Ticket, genau wie `/do-semi-automatic`.
- Gibt es keins, nimmt er ein `Definition+KI`-Ticket — ein Ticket, das ein Mensch per „An KI übergeben" zugewiesen, aber nicht per „Nach Bereit" freigegeben hat.
- Bei so einem Ticket beurteilt der Skill selbst, ob es beförderungsreif ist. Ist ja: er befördert es selbst nach „Bereit" und baut es. Ist nein: Kommentar, zurück an den Menschen.

## Wann welchen Skill nutzen

| Situation | Skill |
|-----------|-------|
| Ein Mensch hat das Ticket geprüft und explizit per „Nach Bereit" freigegeben | `/do-semi-automatic` |
| Kontrollierte, zweistufige Übergabe gewünscht — Mensch entscheidet über die Reife | `/do-semi-automatic` |
| Möglichst wenig menschliche Eingriffe, auch die Reife-Entscheidung soll die KI treffen | `/do-fully-automatic` |
| Ticket steht bei „An KI übergeben" fest, aber noch nicht bei „Nach Bereit" | `/do-fully-automatic` |

Kurz: `/do-semi-automatic` für den kontrollierten Weg mit menschlichem Freigabe-Klick. `/do-fully-automatic` für den autonomeren Weg — die KI trifft auch die Beförderungs-Entscheidung.

## Das Ticket-Board live verfolgen

Öffne <http://localhost:7200/admin/tickets>. Jeder eingeloggte Nutzer sieht das Board, Ändern per Drag-and-Drop darf nur Admin.

Während die Pipeline läuft, wandert das Ticket sichtbar durch die Spalten:

```
Definition → (Bereit) → In Arbeit → Erledigt
                              │
                              └→ Wartet (bei einer Rückfrage der KI)
```

Ein `ask` schickt das Ticket nach „Wartet", Owner zurück auf `HUMAN`. Ein Mensch antwortet per Kommentar mit `handBackToAi` — das Ticket geht zurück nach „Bereit", Owner `AI`.

## Beispielablauf

```
/write-ticket http://localhost:7200/admin/agent-tasks/23
  → neues Ticket #13, Status „Definition", Owner HUMAN

# Mensch klickt "Nach Bereit" im Board
  → Ticket #13, Status „Bereit", Owner AI

/do-semi-automatic 13
  → Ticket #13, Status „In Arbeit" → „Erledigt"
```

Oder vollautomatisch ohne den manuellen Klick:

```
/write-ticket Dark-Mode-Umschalter im Header ergänzen
  → neues Ticket #14, Status „Definition", Owner HUMAN, fullyReady=true

/do-fully-automatic
  → Skill findet Ticket #14 als Definition+KI/fullyReady, befördert es selbst
  → Status „Bereit" → „In Arbeit" → „Erledigt"
```

## Weiterführend

Volle API-Details zum Ticket-Lebenszyklus, Owner-Modell und den Endpunkten: [docs/specs/SPEC-API-TICKETS.md](specs/SPEC-API-TICKETS.md).

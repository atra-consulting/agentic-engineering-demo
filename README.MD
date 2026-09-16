<p align="center">
  <a href="https://atra.consulting/">
    <img src="docs/assets/atra-logo.svg" alt="atra.consulting" width="320">
  </a>
</p>

<h1 align="center">AI Coding Lab — CRM Demo</h1>

<p align="center">
  <em>Eine produktionsnahe Full-Stack-Anwendung des <a href="https://atra.consulting/">atra.consulting</a> <strong>AI Coding Lab</strong> —<br>
  entstanden, um zu zeigen, wie AI-gestützte Softwareentwicklung in der Praxis funktioniert.</em>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20.19%2B-339933.svg">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Express-3178c6.svg">
  <img alt="Angular 21" src="https://img.shields.io/badge/Angular-21-dd0031.svg">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-Drizzle%20ORM-003b57.svg">
</p>

> **Erstmal hier starten:** Für die vollständige Installationsanleitung (Node.js, Claude Code, IDE) bitte **[docs/SETUP.md](docs/SETUP.md)** lesen.

---

## Training

atra.consulting [bietet KI-Training an](https://atra.consulting/ki-loesungen/), inklusive zweier Hands-on-Training-Workshops für Agenten-basierte Entwicklung.

## Inhalt

- [Voraussetzungen](#voraussetzungen)
- [Schnellstart](#schnellstart)
- [Demo-Login](#demo-login)
- [Tools](#tools)
- [Skills & Subagents übernehmen](#skills--subagents-übernehmen)
- [Nützliche Befehle](#nützliche-befehle)
- [Playwright-MCP: Browser-Automation](#playwright-mcp-browser-automation)
- [Features](#features)
- [Tech-Stack](#tech-stack)
- [Weiterführende Dokumentation](#weiterführende-dokumentation)
- [Lizenz](#lizenz)

---

## Voraussetzungen

| Tool | Version | Zweck |
|------|---------|-------|
| **Node.js** | 20.19+ | Backend + Frontend bauen und starten |
| **Git CLI** | beliebig | Versionskontrolle und Branches |
| **Claude Code** | aktuell | AI-gestütztes Programmieren im Terminal |

Vollständige Installationsanleitung: **[docs/SETUP.md](docs/SETUP.md)**

---

## Schnellstart

Repository klonen:

```bash
git clone https://github.com/ksilz/coding-with-ai-demo.git
cd coding-with-ai-demo
```

Stack starten:

```bash
./start.sh           # macOS / Linux
start.bat            # Windows
```

Das Skript installiert npm-Abhängigkeiten, startet Backend und Frontend und wartet, bis beide bereit sind.

| URL | Beschreibung |
|-----|-------------|
| <http://localhost:7200> | Frontend |
| <http://localhost:7070> | Backend API |

### Startskript-Flags

| Flag | Beschreibung |
|------|-------------|
| `--reset-db` | SQLite-Datenbank löschen (wird beim nächsten Start neu aufgebaut) |

### Einzeln starten

```bash
cd backend  && npx tsx --watch src/index.ts                                      # Port 7070, Hot Reload
cd frontend && npx ng serve --port 7200 --proxy-config proxy.conf.json           # Port 7200, Hot Reload
```

---

## Demo-Login

Drei vorkonfigurierte Benutzer:

| Benutzername | Passwort | Rolle | Zweck |
|--------------|----------|-------|-------|
| `admin` | `admin123` | ADMIN | Voller Zugriff inkl. Admin-Bereich |
| `user` | `test123` | USER | Standard-CRM-Nutzer |
| `demo` | `demo1234` | ADMIN | Schnellstart-Login für Demos |

---

## Tools

Die App hat drei Tools für die Demo. Starte die App, dann öffne die URL.

| Tool | URL | Zugang |
|------|-----|--------|
| **Produktivitäts-Rechner** | <http://localhost:7200/produktivitaet/rechner> | Jeder Login |
| **Agent-Task-Dashboard** | <http://localhost:7200/admin/agent-tasks> | Nur Admin |
| **Ticket-Board** | <http://localhost:7200/admin/tickets> | Ansehen: jeder Login. Ändern: nur Admin |

Details zu jedem Tool: **[docs/TOOLS.md](docs/TOOLS.md)**

---

## Skills & Subagents übernehmen

Dieses Repo baut auf 27 Subagents und 6 Skills für AI-gestützte Entwicklung. Du kannst beides in dein eigenes Projekt übernehmen. Diese Sektion erklärt, was es gibt — und wie du es holst.

### Die Subagents

Dieses Projekt hat 27 Subagents. Sie liegen in `.claude/agents/`. Jeder Agent ist eine Markdown-Datei.

#### Was ist ein Subagent?

Ein Subagent ist ein Spezialist. Claude ruft ihn für eine klare Aufgabe auf. Der Subagent bekommt eigenen Kontext, eigene Werkzeuge und einen eigenen Auftrag.

Beispiel: Du willst neuen Backend-Code. Claude ruft `be-coder`. Der schreibt den Code. Danach ruft Claude `be-reviewer`. Der prüft den Code.

#### Warum Subagents nutzen?

- **Fokus.** Jeder Agent kennt nur seinen Bereich. Er liest die passenden Specs. Er kennt die Regeln.
- **Weniger Fehler.** Ein Reviewer prüft, was ein Coder baut. Vier Augen.
- **Passendes Modell.** Einfache Aufgaben laufen auf `haiku`. Schwere auf `opus`. Das spart Zeit und Geld.
- **Sauberer Kontext.** Der Haupt-Chat bleibt kurz. Der Agent arbeitet in seinem eigenen Fenster.

#### Wie rufst du einen Subagent auf?

Zwei Wege:

1. **Automatisch.** Claude liest die `description` jedes Agents. Passt die Aufgabe, ruft Claude den Agent selbst. Du machst nichts.
2. **Per Name.** Du bittest direkt: „Nutze den `be-reviewer`, um diese Route zu prüfen." Claude startet genau diesen Agent.

Skills wie `/plan-and-do` rufen viele Agents nacheinander. Erst Coder, dann Tester, dann Reviewer.

#### Die Agents im Überblick

Jede Zeile: Name, Zweck, Modell. Das Modell steht in der Agent-Datei (`model:`).

##### Coding — Code schreiben

| Agent | Zweck | Modell |
|-------|-------|--------|
| `be-coder` | Node.js / Express / TypeScript Backend. Routen, Services, Middleware. | sonnet |
| `fe-coder` | Angular 21 Frontend. Komponenten, Services, Routing. | sonnet |
| `db-coder` | SQLite-Queries, Drizzle-Schema, `migrate.ts`. | sonnet |
| `ui-designer` | UI/UX. Layout, Styling, SCSS, Barrierefreiheit. | sonnet |

##### Review — Code und Anforderungen prüfen

| Agent | Zweck | Modell |
|-------|-------|--------|
| `be-reviewer` | Prüft Backend-Code. Bugs, Sicherheit, Muster. | sonnet |
| `fe-reviewer` | Prüft Frontend-Code. Bugs, Barrierefreiheit. | sonnet |
| `db-reviewer` | Prüft Queries und Schema. Performance, Schema-Drift. | sonnet |
| `ui-reviewer` | Prüft die UI. Usability, WCAG, UX-Probleme. | sonnet |
| `ba-reviewer` | Prüft PRDs, Specs, Pläne. Findet Lücken. | sonnet |
| `requirements-reviewer` | Prüft Anforderungen und User Stories. Findet fehlende Akzeptanzkriterien. | opus |

##### Writing — Anforderungen schreiben

| Agent | Zweck | Modell |
|-------|-------|--------|
| `ba-writer` | Schreibt Business-Specs, User Stories, Prozessabläufe. | sonnet |

##### Testing — Tests schreiben, prüfen, ausführen

| Agent | Zweck | Modell |
|-------|-------|--------|
| `be-test-coder` | Schreibt Playwright-API-Tests fürs Backend. | sonnet |
| `be-test-reviewer` | Prüft Backend-Tests. Abdeckung, Assertions. | sonnet |
| `be-test-runner` | Führt die Backend-Test-Suite aus. Meldet Pass/Fail. | haiku |
| `fe-test-coder` | Schreibt Jasmine/Karma-Unit-Tests fürs Frontend. | sonnet |
| `fe-test-reviewer` | Prüft Frontend-Tests. Abdeckung, DI-Setup. | sonnet |
| `fe-test-runner` | Führt die Frontend-Test-Suite aus. Meldet Pass/Fail. | haiku |

##### Ops — Entwicklungsumgebung

| Agent | Zweck | Modell |
|-------|-------|--------|
| `admin` | Lokale Dev-Umgebung, SQLite-Datenbank, Prozesse. Fragt vor Änderungen. | sonnet |

##### Tooling — allgemein, nicht an die CRM-Domäne gebunden

Diese neun Agents kennen die CRM-Specs nicht. Sie lesen nur die Root-`CLAUDE.md`. `shell-*` liest zusätzlich `docs/specs/SPECS-infrastructure.md`. Du kannst sie leicht in andere Projekte übernehmen.

| Agent | Zweck | Modell |
|-------|-------|--------|
| `planner` | Entwirft PRDs und Implementierungspläne. Weist Agent und Modell pro Aufgabengruppe zu. | sonnet |
| `python-coder` | Schreibt plattformübergreifende Python-Skripte. Datenanalyse. | sonnet |
| `python-reviewer` | Prüft Python. Korrektheit, Portabilität, externe Daten. | sonnet |
| `shell-coder` | Schreibt Shell-Skripte für macOS, Linux, WSL. | sonnet |
| `shell-reviewer` | Prüft Shell-Skripte. Hänger, Endlosschleifen, Portabilität. | sonnet |
| `skill-coder` | Erstellt und ändert Claude-Code-Skills und -Subagents. | sonnet |
| `skill-reviewer` | Prüft Skills und Subagents. | sonnet |
| `data-reader` | Sucht rein lesend Fakten in Dateien oder im Web. Meldet die Ergebnisse. | haiku |
| `data-writer` | Speichert fertigen Inhalt unverändert in eine Datei an bekanntem Pfad. | haiku |

#### Domänengebunden oder allgemein?

- **18 Agents sind an die CRM-Domäne gebunden.** Sie lesen die Specs in `docs/specs/`. Sie kennen Firma, Person, Chance und die Regeln. Willst du sie übernehmen, passt du die Specs an dein Projekt an. Siehe [Skills und Subagents ins eigene Projekt übernehmen](#skills-und-subagents-ins-eigene-projekt-übernehmen).
- **9 Tooling-Agents sind allgemein** (`planner`, `python-*`, `shell-*`, `skill-*`, `data-*`). Sie passen fast überall.

#### CI-Workflow: `do-semi-automatic.yml`

Die Subagents laufen nicht nur lokal. Ein GitHub-Actions-Workflow startet die ganze Kette unbeaufsichtigt in CI. Datei: `.github/workflows/do-semi-automatic.yml`.

Der Workflow ruft den Skill `/do-semi-automatic` headless auf (`claude -p`). Der Skill treibt dann die Subagents: erst `requirements-reviewer` (bauen oder zurückgeben?), dann — beim Bauen — die volle `plan-and-do`-Kette aus Coder-, Test- und Reviewer-Agents. Ein Ticket pro Lauf.

**Wann läuft er?**

- **Manuell** (`workflow_dispatch`) — mit optionaler Eingabe `ticket_id`. Leer → der Skill nimmt das nächste Ready+AI-Ticket.
- **Täglich** (`schedule`) — 02:00 UTC.
- **Auf Zuruf** (`repository_dispatch`, Typ `solve-tickets`) — schlummert noch. Kein Backend-Cron feuert diesen Typ bisher.

Nur eine Instanz zur Zeit (`concurrency`). Überlappende Läufe warten in der Schlange.

**Was macht er?**

1. Repo auschecken (volle History, damit `plan-and-do` branchen kann), Node einrichten, `npm ci`, Claude Code installieren, Git-Identität setzen.
2. `claude -p "/project:do-semi-automatic [id]"` laufen lassen. Die Eingabe `ticket_id` muss eine **positive ganze Zahl** sein — der Workflow lehnt alles andere ab (`exit 1`). Ticket-URLs sind nur für den lokalen/interaktiven Aufruf; CI nutzt die reine ID.
3. Nach dem Lauf: uncommittete Änderungen sichern. Gibt es Commits über dem Basis-Stand? → gebaut. Der Skill selbst pusht nie und öffnet keinen PR. Also pusht **der Workflow** den Branch und öffnet einen PR gegen den Basis-Branch. Nichts wird je automatisch gemergt.
4. Kam der Lauf aus dem Vercel-Cron (`client_payload.cronRunId`), meldet der Workflow das Ergebnis an den Cron-Run zurück.

Nicht-Bau-Ausgänge des Skills (zurück nach Definition, oder `ON_HOLD` bei einem Blocker) erzeugen keine Commits — also keinen PR.

**Nötige Secrets:** `AGENT_API_TOKEN`, `APP_BASE_URL` (die DEPLOYTE App), `CLAUDE_CODE_OAUTH_TOKEN` (per `claude setup-token` erstellt — **nicht** zusätzlich `ANTHROPIC_API_KEY` setzen). `GITHUB_TOKEN` kommt automatisch und pusht den Branch bzw. öffnet den PR. Ohne diese Secrets läuft der Workflow nicht sinnvoll.

Skill-Details: [Die Skills](#die-skills) · API-Hintergrund: [docs/specs/SPEC-API-TICKETS.md](docs/specs/SPEC-API-TICKETS.md).

Agent-Dateien: `.claude/agents/`. Rollen-Tabelle und Spec-Zuordnung: [CLAUDE.md](CLAUDE.md).

### Die Skills

Dieses Projekt hat sechs eigene Skills. Sie liegen in `.claude/skills/`. Jeder Skill ist ein Ordner mit einer `SKILL.md`.

#### Was ist ein Skill?

Ein Skill ist ein fester Arbeitsablauf. Du rufst ihn mit einem Schrägstrich auf: `/name`. Claude folgt dann den Schritten in der `SKILL.md`.

Ein Subagent ist ein Spezialist für eine Aufgabe. Ein Skill ist ein ganzer Prozess. Skills rufen oft mehrere Subagents nacheinander. Mehr zu Agents: [Die Subagents](#die-subagents).

#### Wie rufst du einen Skill auf?

Tippe den Namen mit Schrägstrich in Claude Code:

```
/plan-and-do <Aufgabenbeschreibung>
```

Manche Skills nehmen Argumente. Manche laufen ohne. Details stehen unten.

#### Voraussetzung: `backend/.env` für die headless Skills

Drei Skills laufen headless (`claude -p`) und sprechen die lokale API an: `/do-fully-automatic`, `/do-semi-automatic` und `/write-ticket`. Damit sie funktionieren, muss `backend/.env` **genau so** aussehen:

```
AGENT_API_TOKEN=test-secret-123
AGENT_AUTH_ALLOW_LOOPBACK=1
```

- `AGENT_API_TOKEN` — geteiltes Geheimnis für die API-Aufrufe. Fehlt es, bricht der Skill in Schritt 0 sofort ab.
- `AGENT_AUTH_ALLOW_LOOPBACK=1` — erlaubt lokalen Aufrufen den Zugriff ohne Admin-Login.

Fehlt die Datei oder eine der Variablen, meldet der Skill den Fehler und beendet sich. Ohne laufendes Backend (`./start.sh`) schlagen die API-Aufrufe fehl.

#### `/plan-and-do` — von der Idee zum Review

End-to-End-Ablauf. Planung → Implementierung → Tests → Code Review.

- **Wann nutzen:** Neues Feature bauen. Aufgabe umsetzen. Schweren Bug fixen.
- **Was passiert:** Der Skill legt einen Branch an. Er schreibt bei Bedarf eine PRD. Er schreibt einen Plan. Du gibst den Plan frei. Dann baut er den Code, testet ihn und prüft ihn. Am Ende gibt es optional einen PR.
- **Argumente:** `["Beschreibung"] [Sonderanweisungen | resume:<schritt>]` oder Ticket-Modus: eine Ticket-URL (z. B. `http://localhost:7200/admin/tickets/8`) oder eine reine Ticket-Nummer. `resume:<schritt>` gilt nur im Freitext-Modus.
- **Beispiel:**
  ```
  /plan-and-do "Redis-Cache für Sessions" "Nutze node-cache mit 5 Minuten TTL"
  ```
- **Ohne Argument:** Der Skill sucht angefangene Aufgaben und fragt, ob du weitermachst.
- **`help` / `doctor`:** Zeigt Hilfe oder läuft einen Selbsttest.
- **Checkpoints:** Der Skill hält an festen Punkten an. Du behältst die Kontrolle.
- Datei: `.claude/skills/plan-and-do/SKILL.md`

#### `/review` — lokaler Code Review

Prüft deinen Branch gegen `main`. Mit mehreren Runden aus Prüfen und Fixen.

- **Wann nutzen:** Vor einem PR. Nach einer Änderung. Wenn du Feedback willst.
- **Was passiert:** Der Skill sammelt die Änderungen. Reviewer-Agents prüfen sie. Der Skill schreibt die Findings nach `docs/reviews/`. Du entscheidest, welche Findings du fixt.
- **Argumente (optional):**
  - leer → normaler Review
  - `dryrun` → zeigt das Ergebnis nur am Bildschirm, schreibt keine Datei
  - `base:<ref>` → prüft gegen einen anderen Branch oder Commit statt `main`
  - `embedded` → Aufruf aus `plan-and-do` mitten im Lauf. Überspringt Header, Plancheck und Bestätigung
  - `help` / `doctor` → Hilfe anzeigen oder Selbsttest laufen lassen
  - freier Text → Sonderanweisungen für den Review
- **Beispiel:**
  ```
  /review Prüfe besonders die Fehlerbehandlung
  ```
- Datei: `.claude/skills/review/SKILL.md`

#### `/update-claude-files` — Doku mit dem Code synchron halten

Aktualisiert `.claude/agents/`, `docs/specs/` und `CLAUDE.md`. Passend zu den Code-Änderungen.

- **Wann nutzen:** Ein Feature ist fertig. Das Schema ändert sich. Die Infrastruktur wandert.
- **Was passiert:** Reviewer-Agents vergleichen Code und Doku. Sie melden, was veraltet ist. Writer-Agents fixen genau diese Stellen. Der Skill legt keine neue Agent- oder Spec-Datei an. Er passt nur bestehende an.
- **Argumente (optional):** freier Text als Fokus, oder `embedded` (Aufruf aus `plan-and-do`). Zweites Token `embedded base:<sha>` grenzt den Lauf auf einen Branch ein.
- **Beispiel:**
  ```
  /update-claude-files Fokus auf die neue Ticket-API
  ```
- Datei: `.claude/skills/update-claude-files/SKILL.md`

#### `/do-semi-automatic` — autonom, ein Ticket pro Lauf

Läuft headless (`claude -p`). Kein Mensch antwortet. Arbeitet genau ein Kanban-Ticket pro Lauf.

- **Wann nutzen:** In CI. Für unbeaufsichtigte Läufe. Wenn ein Ticket „Bereit" ist und der KI gehört.
- **Was passiert:** Der Skill nimmt ein Ticket (oder eines per ID). Er beurteilt es. Zu dünn beschrieben? Zurück nach „Definition", Owner Mensch. Gut genug? Er baut es voll über `plan-and-do`. Jede Status-Änderung dokumentiert er mit einem kleinen Kommentar. Kein Push, kein PR.
- **Argumente (optional):** `[ticket-id | ticket-url] [comment]`. Ohne Argument nimmt der Skill das nächste Ready+AI-Ticket. Reine Zahl → Ticket-ID. Ticket-URL (z. B. `http://localhost:7200/admin/tickets/11`) → Ticket-ID aus der URL. Mit ID oder URL überspringt der Skill die Suche. Nach ID oder URL darf ein freier Hinweis folgen — ohne Anführungszeichen, alles nach dem ersten Token zählt. Er geht beim Bauen unverändert an `plan-and-do`.
- **Wichtig:** Der Skill ruft nie `AskUserQuestion`. Er hält nie an. Er braucht `AGENT_API_TOKEN` in der Umgebung (siehe [Voraussetzung](#voraussetzung-backendenv-für-die-headless-skills)).
- **Beispiel:**
  ```
  /do-semi-automatic 7
  /do-semi-automatic http://localhost:7200/admin/tickets/11
  /do-semi-automatic 7 nur das Backend anfassen
  ```
- Datei: `.claude/skills/do-semi-automatic/SKILL.md`
- Hintergrund: [docs/specs/SPEC-API-TICKETS.md](docs/specs/SPEC-API-TICKETS.md)

#### `/do-fully-automatic` — autonom, inklusive Beförderung aus Definition

Läuft headless (`claude -p`). Kein Mensch antwortet. Arbeitet genau ein Kanban-Ticket pro Lauf.

- **Wann nutzen:** In CI. Für unbeaufsichtigte Läufe. Wie `/do-semi-automatic`, aber auch für Tickets, die ein Mensch per „An KI übergeben" der KI zugewiesen hat, aber noch nicht per „Nach Bereit" freigegeben hat.
- **Was passiert:** Bereit+KI-Tickets baut der Skill exakt wie `/do-semi-automatic`. Bei Definition+KI-Tickets beurteilt er zusätzlich selbst, ob sie beförderungsreif sind: ist ja, befördert er sie selbst nach „Bereit" und baut sie über `plan-and-do`; ist nein, hinterlässt er einen Kommentar und gibt an einen Menschen zurück (gleiches „zurück auf Definition"-Ergebnis wie bei einem zu dünnen Bereit-Ticket). Kein Push, kein PR.
- **Argumente (optional):** `[ticket-id | ticket-url] [comment]`. Ohne Argument nimmt der Skill zuerst das nächste Ready+AI-Ticket, sonst das nächste Definition+AI-Ticket. Reine Zahl → Ticket-ID. Ticket-URL (z. B. `http://localhost:7200/admin/tickets/11`) → Ticket-ID aus der URL. Mit ID oder URL überspringt der Skill die Suche. Nach ID oder URL darf ein freier Hinweis folgen — ohne Anführungszeichen, alles nach dem ersten Token zählt. Er geht beim Bauen unverändert an `plan-and-do`.
- **Wichtig:** Der Skill ruft nie `AskUserQuestion`. Er hält nie an. Er braucht `AGENT_API_TOKEN` in der Umgebung (siehe [Voraussetzung](#voraussetzung-backendenv-für-die-headless-skills)). „An KI übergeben" bleibt der einzige Mensch-Checkpoint — dieser Skill entscheidet nur, ob ein bereits der KI zugewiesenes Ticket weiterlaufen darf.
- **Beispiel:**
  ```
  /do-fully-automatic 7
  /do-fully-automatic http://localhost:7200/admin/tickets/11
  /do-fully-automatic 7 nur das Backend anfassen
  ```
- Datei: `.claude/skills/do-fully-automatic/SKILL.md`
- Hintergrund: [docs/specs/SPEC-API-TICKETS.md](docs/specs/SPEC-API-TICKETS.md)

#### `/write-ticket` — Feedback in ein neues Ticket triagieren

Läuft headless (`claude -p`). Kein Mensch antwortet. Baut nie Code.

- **Wann nutzen:** In CI. Um Feedback aus der Agent-Task-Queue in ein Kanban-Ticket zu verwandeln. Oder um freien Text direkt in ein Ticket zu triagieren.
- **Was passiert:** Der Skill nimmt ein Feedback-Element (Agent-Task aus der Queue, per ID, per Task-URL, oder freier Text). Er beurteilt es mit dem `requirements-reviewer`-Subagent. Er legt immer ein neues Ticket an — Status „Definition", Owner Mensch. Ist das Feedback zu dünn, kommentiert er genau, was fehlt. Er pusht nie und öffnet nie einen PR.
- **Argumente (optional):** `[task-id | task-url | feedback-text]`. Ohne Argument beansprucht der Skill das nächste Feedback aus der Queue. Reine Zahl → Task-ID. Task-URL (z. B. `http://localhost:7200/admin/agent-tasks/23`) → Task-ID aus der URL. Sonstiger freier Text → direktes Prosa-Feedback (überspringt die Queue).
- **Wichtig:** Der Skill ruft nie `AskUserQuestion`. Er hält nie an. Er braucht `AGENT_API_TOKEN` in der Umgebung.
- **Beispiel:**
  ```
  /write-ticket 14
  /write-ticket http://localhost:7200/admin/agent-tasks/23
  /write-ticket Dark-Mode-Umschalter im Header ergänzen
  ```
- Datei: `.claude/skills/write-ticket/SKILL.md`
- Hintergrund: [docs/specs/SPEC-API-TASKS.md](docs/specs/SPEC-API-TASKS.md) · [docs/specs/SPEC-API-TICKETS.md](docs/specs/SPEC-API-TICKETS.md)

### Skills und Subagents ins eigene Projekt übernehmen

Du willst die Skills und Subagents aus diesem Repo in dein eigenes Projekt holen? So geht es.

#### Warum das nicht nur Kopieren ist

Die Agents und Skills kennen dieses Projekt. Sie reden von Firma, Person, Chance. Sie kennen Node.js, Angular, Drizzle. Dein Projekt sieht anders aus. Also musst du sie anpassen.

Der Trick: Kopieren, dann Claude anpassen lassen, dann prüfen. Mehrmals.

#### Voraussetzung

- Claude Code läuft in deinem Projekt.
- Dein Projekt ist ein Git-Repo. So siehst du jede Änderung.

#### Der Prozess

##### Schritt 1 — Dateien kopieren

Kopiere die Subagents und Skills in den `.claude`-Ordner deines Projekts.

```bash
mkdir -p dein-projekt/.claude
cp -r coding-with-ai-lab/.claude/agents dein-projekt/.claude/
cp -r coding-with-ai-lab/.claude/skills dein-projekt/.claude/
```

Tipp: Nimm nur, was du brauchst. Die Tooling-Agents (`python-*`, `shell-*`, `skill-*`) passen fast überall. Die CRM-Agents (`be-coder`, `fe-coder` …) musst du stark anpassen.

##### Schritt 2 — Claude anpassen lassen

Starte Claude Code in deinem Projekt. Gib diesen Prompt:

```
Ich habe Subagents und Skills aus einem anderen Projekt kopiert.
Sie liegen in .claude/agents und .claude/skills.
Passe sie an dieses Projekt an: Technologie, Regeln, Ordnerstruktur,
Domänenbegriffe. Entferne, was hier nicht passt. Think hard!
```

Claude liest deinen Code. Claude ändert die Agent- und Skill-Dateien.

##### Schritt 3 — Claude neu starten

Beende Claude Code. Starte es neu.

**Warum?** Claude lädt Agents, Skills und `CLAUDE.md` beim Start. Neue oder geänderte Dateien greifen erst nach einem Neustart.

##### Schritt 4 — Prüfen (mindestens 3×)

Lass Claude die angepassten Dateien prüfen. Nutze `/review`. Wiederhole den Prompt. Stopp erst, wenn keine nützlichen Findings mehr kommen. Meist reichen drei Runden.

```
/review Du hast gerade diese Subagents und Skills kopiert und angepasst: ...
Prüfe, ob sie wirklich zur Technologie, zu den Regeln und zu den
Best Practices dieses Projekts passen. Think hard!
```

Nach jeder Runde: Findings anschauen. Fixen lassen. Nochmal prüfen.

##### Schritt 5 — Claude neu starten

Beende Claude Code. Starte es neu. Gleicher Grund wie in Schritt 3.

##### Schritt 6 — Specs und Domänen-Doku neu erstellen

Jetzt braucht dein Projekt eigene Specs. Nutze `/update-claude-files`:

```
/update-claude-files Erstelle alle Specs und die Domänen-Doku komplett neu.
Sie müssen wirklich zur Technologie, zu den Regeln und zu den
Best Practices dieses Projekts passen.
```

Claude schreibt die Specs in `docs/specs/` und passt `CLAUDE.md` an.

##### Schritt 7 — Prüfen (mindestens 3×)

Wie Schritt 4. Diesmal für die Specs und die Domänen-Doku. Wiederhole. Stopp, wenn keine nützlichen Findings mehr kommen.

```
/review Du hast gerade die Specs und die Domänen-Doku für dieses Projekt
erstellt. Prüfe, ob sie wirklich zur Technologie, zu den Regeln und zu den
Best Practices dieses Projekts passen. Think hard!
```

##### Schritt 8 — Claude neu starten

Beende Claude Code. Starte es neu. Fertig.

#### Kurzfassung

1. Dateien nach `.claude/` kopieren.
2. Claude anpassen lassen.
3. Neu starten.
4. `/review` 3× (Agents + Skills).
5. Neu starten.
6. `/update-claude-files` (Specs + Domäne neu).
7. `/review` 3× (Specs + Domäne).
8. Neu starten.

#### Danach

Teste die Skills an einer kleinen Aufgabe. Zum Beispiel `/plan-and-do "kleines Feature"`. Läuft das sauber, passt die Übernahme.

Mehr zu den Bausteinen: [Die Subagents](#die-subagents) · [Die Skills](#die-skills)

---

## Nützliche Befehle

| Befehl | Zweck |
|--------|-------|
| `/plan-and-do <Aufgabe>` | End-to-End-Implementierung (Planung → Coding → Testing → Review) |
| `/review` | Code-Änderungen mit iterativem Feedback prüfen |
| `/simplify` | Code auf Qualität, Wiederverwendung und Effizienz prüfen |
| `/help` | Hilfe zu Claude Code |
| `/clear` | Konversationshistorie löschen |
| `/compact` | Kontext komprimieren |

---

## Playwright-MCP: Browser-Automation

Playwright-MCP ermöglicht der AI, direkt mit der laufenden Anwendung im Browser zu interagieren:

- **Screenshots** der UI machen und Änderungen visuell validieren
- **Formulare ausfüllen und Buttons klicken** um Features zu testen
- Durch die Anwendung **navigieren** und Workflows verifizieren
- **Grenzfälle** und Benutzerinteraktionen automatisch testen
- **UI-Probleme debuggen** durch visuelle Kontrolle der Anwendung

---

## Features

- **CRM-Stammdaten** — Firmen, Personen, Abteilungen, Adressen mit AG-Grid-Tabellen
- **Chancen & Aktivitäten** — Vertriebspipeline und Aktivitäten-Tracking
- **Dashboard** — KPI-Tiles und Übersicht der jüngsten Datensätze
- **Adress-Geocoding** — Admin-Tool für Nominatim-basiertes Geocoding mit Karten-Ansicht
- **Feedback** — Nutzerfeedback per QR-Code mit Thank-You-Page
- **Session-Authentifizierung** — bcrypt-Passwörter mit rollenbasierter Zugriffskontrolle

---

## Tech-Stack

| Schicht | Technologie |
|---------|-------------|
| **Backend** | Node.js · TypeScript · Express · Drizzle ORM · `@libsql/client` |
| **Frontend** | Angular 21 · Bootstrap 5 · AG Grid · Chart.js |
| **Datenbank** | SQLite (via `@libsql/client`, Turso-kompatibel) |
| **Auth** | Session-basiert (bcrypt + `express-session`) |

Architektur-Details: **[docs/specs/SPECS.md](docs/specs/SPECS.md)**

Konventionen und Patterns für AI-gestützte Entwicklung: **[AGENTS.md](AGENTS.md)**

---

## Weiterführende Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [docs/SETUP.md](docs/SETUP.md) | Vollständige Installationsanleitung (Node.js, Claude Code, IDE) |
| [docs/CHEATSHEET-CLAUDE-CODE.md](docs/CHEATSHEET-CLAUDE-CODE.md) | Claude Code Spickzettel für Einsteiger |
| [docs/TOOLS.md](docs/TOOLS.md) | Produktivitäts-Rechner, Agent-Tasks, Ticket-Board |
| [AGENTS.md](AGENTS.md) | Anweisungen und Konventionen für AI-Coding-Assistenten (tool-neutral) |
| [CLAUDE.md](CLAUDE.md) | Claude-Code-Spezifika (Subagents, Spec-Leselisten) — importiert `AGENTS.md` |
| [docs/specs/SPECS.md](docs/specs/SPECS.md) | Detaillierte Spezifikationen pro Bereich |
| [docs/adr/](docs/adr/) | Architecture Decision Records |
| [docs/prds/](docs/prds/) | Product Requirement Documents |

### Projektstruktur

```
├── backend/          Node.js/TypeScript Backend (Express + Drizzle ORM)
│   ├── src/          config · db · middleware · routes · seed · services
│   └── data/         SQLite-Datenbankdatei (gitignored)
├── frontend/         Angular 21 SPA (core · features · layout · shared)
├── docs/             Installationsanleitung, Architektur, Specs, ADRs, PRDs
├── start.sh          Startskript (macOS/Linux)
├── start.bat         Startskript (Windows)
├── AGENTS.md         Anweisungen für AI-Coding-Assistenten (tool-neutral)
└── CLAUDE.md         Claude-Code-Spezifika (importiert AGENTS.md)
```

---

## Lizenz

Veröffentlicht unter der **[MIT-Lizenz](LICENSE)** © 2026 [atra.consulting](https://atra.consulting/).

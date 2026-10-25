# PEP Stufe 1 – Einsatzplan, Regelprüfung, Kopieren, Vorausplanung, Druck, Startseite: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Filialleitung plant im Reiter „Einsatzplan“ halbstündlich per Malen, sieht Verstöße sofort, kopiert Tage, Wochen und Vorlagen, meldet Krankheit mit Ersatzsuche, plant sechs Wochen voraus, druckt die tegut-ähnlichen Berichte und sieht auf der Startseite, was zu tun ist; dazu eine Überarbeitung der Gestaltung aller vorhandenen Reiter.

**Architecture:** Wie Stufe 0: statische Seite in `docs/` (ES-Module, kein Build) ruft nur `security definer`-Funktionen `public.pep_*` auf; alle Regeln laufen serverseitig in PL/pgSQL im Schema `pep`. Planblöcke sind zusammenhängende Zeiträume je Mitarbeiter und Tag; die Regelprüfung ist eine interne Funktion `pep.pruefung`, deren Ergebnis jede Plan-Antwort mitliefert. Reine Rechenlogik der Oberfläche (Zeitraster, Abdeckung, Druckzeilen) liegt in DOM-freien Modulen mit `node --test`; die Oberfläche wird über eine Vorschau-Seite mit Testdaten per Headless-Chrome fotografiert.

**Tech Stack:** PostgreSQL 15+ (Supabase, PL/pgSQL), HTML/CSS/JavaScript (ES-Module), Node 20+ mit `node --test`, `@electric-sql/pglite`, Chrome headless für Vorschau-Fotos.

**Spec:** `docs/superpowers/specs/2026-10-24-pep-stufe-0-1-design.md`, Abschnitte 6 (Tabellen `wochen`, `plan_bloecke`, `plan_kommentare`, `vorlagen`) und 10–15. Stufe 0 ist gemergt (`main` 3cdbf91, Plan `docs/superpowers/plans/2026-10-24-pep-stufe-0-grundgeruest.md`).

## Global Constraints

Alle Regeln aus dem Stufe-0-Plan („Global Constraints“) gelten weiter, insbesondere:
- `supabase/schema.sql` bleibt **eine** idempotente Datei (`begin;` … `commit;`, `create table if not exists`, `create or replace`, `alter table … add column if not exists`). Neue Teile kommen als eigene Abschnitte **vor** den abschließenden `revoke`/`grant`-Block und `commit;`.
- Nur `public.pep_*` ist aus dem Browser aufrufbar: `security definer`, `set search_path = ''`, je Funktion `revoke all … from public, anon, authenticated; grant execute … to authenticated;`. Interne Funktionen in `pep` ohne `security definer`.
- Fehler als `raise exception 'CODE'` (Großbuchstaben). **Jeder neue Code bekommt einen Alltagsdeutsch-Text in `FEHLER` in `docs/hilfe.js`**, sonst schlägt `tests/hilfe.test.mjs` fehl.
- Jede schreibende Funktion ruft `pep.protokolliere(...)`.
- „Heute“ ist `pep.heute()`, nie `current_date`. Tests setzen die Uhr mit `heuteSetzen(db, '2026-11-02')`.
- Uhrzeiten `time` nur :00/:30 (`HALBE_STUNDE`), in JSON als Text `'HH:MI'` (`to_char(x, 'HH24:MI')`). Stunden `numeric(5,2)`.
- Rechte: **alle** neuen Funktionen dürfen `leitung` und `stellvertretung` (`pep.leitung_oder_stellvertretung()`), außer `pep_mitarbeiter_reihenfolge` (nur `leitung`, Stammdaten).
- **Jede neue `public.pep_*`-Funktion wird im selben Task in `tests/rechte.test.mjs` eingetragen**: lesende in `NUR_LESEN`, schreibende mit Dummy-Aufruf in `aufrufe()` und, wenn für die Stellvertretung erlaubt, in `AUCH_STELLVERTRETUNG`. Sonst schlägt der Rechtetest fehl.
- Fremde Filiale: Mitarbeiter, Bereich, Vorlage einer anderen Filiale → `MITARBEITER_NICHT_GEFUNDEN` / `BEREICH_NICHT_GEFUNDEN` / `VORLAGE_NICHT_GEFUNDEN`; je Task mit DB-Funktionen ein Test.
- Kein Framework, kein Build, keine Laufzeit-Abhängigkeit. CSP in `docs/index.html` unverändert: keine Inline-Skripte oder -Styles, keine fremden Schriften. Element-Styles nur über Klassen oder `element.style.<eigenschaft>` aus JS (CSSOM ist mit `style-src 'self'` erlaubt).
- Netto-Farben `--netto-gelb #FFE500`, `--netto-rot #E30613`. Rot nur für Verstöße und „unbesetzt“, nie als Bereichsfarbe. Planzellen tragen Kürzel **und** Farbe.
- **Keine echten Mitarbeiternamen** in Code, Tests, Vorschau-Daten, Commits und Doku (das Repo ist öffentlich). Testnamen wie „Test, Anna“.
- Arbeit im Worktree `.worktrees/stufe-1`, Branch `stufe-1` (Basis `origin/main` 3cdbf91 plus Commit 48ade32 „Palette zeigt Codes wieder“). Commit nach jedem Task, Deutsch, erste Zeile höchstens 72 Zeichen, Abschluss `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Oberflächen-Tasks belegen ihr Ergebnis mit Vorschau-Fotos** (Task 1 richtet das ein): `node tests/vorschau/daten-erzeugen.mjs`, dann `node tests/vorschau/foto.mjs <ansicht> tests/vorschau/<name>.png 1440 900`, zusätzlich `1024 768` für Tablet. Die PNG-Dateien sind gitignored. Der Bericht nennt ihre Pfade, der Reviewer öffnet sie.
- Testwoche in DB-Tests: KW 46/2026, Mo 09.11. bis Sa 14.11.2026 (keine Feiertage in Bayern); `heute` = 02.11.2026. Standard-Rahmen Mo–Sa 06:00–21:30, Öffnung 07:00–20:00, So geschlossen.

## Fachliche Festlegungen dieses Plans

Diese Punkte lässt der Spec offen, oder sie wären wörtlich genommen unbrauchbar. Jede Task, die sie braucht, verweist hierher.

- **F1 Kasse und VP erkennen**: neue Spalte `bereiche.bedeutung text check (bedeutung in ('kasse', 'vp'))`, eindeutig je Filiale (`unique (filiale_id, bedeutung)`, NULL mehrfach erlaubt). Startset und vorhandene Filialen: KA → `kasse`, VP → `vp` (Nachziehen im Schema nur, wo in der Filiale noch keine Bedeutung gesetzt ist). Grund: Kürzel sind in den Einstellungen frei änderbar; eine Regel am Kürzel „KA“ würde nach Umbenennen still ausfallen. In den Einstellungen bleibt die Bedeutung unsichtbar und fest.
- **F2 „Unbesetzt“** ist kein gespeicherter Zustand und gilt **je halbe Stunde**: Unbesetzt ist der Teil eines Blocks, der eine Abwesenheit seines Mitarbeiters mit `sperrt = true` überschneidet (ohne `von/bis` = ganzer Tag). Ausgaben (`bloecke` in `pep.tag_antwort` und `pep_einsatzplan_woche`) teilen einen gespeicherten Block an den Abwesenheitsgrenzen in Abschnitte mit derselben `id` und je eigenem `unbesetzt`. Unbesetzte halbe Stunden zählen **nirgends** mit (keine Abdeckung, keine Stunden, keine anderen Regeln) und erzeugen je zusammenhängendem unbesetztem Abschnitt die Warnung `unbesetzt`. (Korrigiert nach Review Task 2: blockweise Definition ließ gültige Zeit beim Verschmelzen unbesetzt werden.)
- **F3 Anwesend** in einer halben Stunde ist, wer dort einen nicht unbesetzten Block hat. Pause zählt als anwesend, aber nicht als arbeitend und nicht als Kasse.
- **F4 Stunden**: Tagesstunden = Summe der nicht unbesetzten Blöcke ohne Pause. Wochenstunden (ISO-Woche) = Summe der Tagesstunden. Anwesenheit eines Tages = erster Beginn bis letztes Ende, inklusive Pausen und Lücken.
- **F5 „Keine VP anwesend“** gilt in jeder halben Stunde der Öffnungszeit. Außerhalb der Öffnung, aber innerhalb der Rahmenzeit, gilt es nur, wenn mindestens eine Person anwesend ist. VP ist, wer die Kompetenz des Bereichs mit `bedeutung = 'vp'` hat.
- **F6 Wochenstunden über Vertrag**: geplante Wochenstunden **plus angerechnete Abwesenheitsstunden der Woche** größer als Vertrag + `wochen_toleranz_h` (Minijob: Toleranz 0). Das ist dieselbe Rechnung wie das Soll der Seitenleiste (Vertrag − Abwesenheiten).
- **F7 JArbSchG-Werte** (`u18_fruehestens`, `u18_spaetestens`, `max_tag_u18_h`, `max_woche_u18_h`, `ruhezeit_u18_h`) gelten für Personen **unter 18** am Plantag, unabhängig von der Vertragsart. Das Gesetz gilt für Jugendliche, nicht für erwachsene Azubis. Ohne Geburtsdatum gilt „volljährig“.
- **F8 Schichtlage** eines Tages: `frueh` = erster Block beginnt zur Rahmenöffnung (`rahmen_von`), `spaet` = letzter Block endet nach `spaet_grenze`, beides = `lang`, sonst `mitte`; ohne Block keine Lage. Lage der Vorwoche = `frueh`, wenn dort mehr Früh- als Spätschichten waren (`lang` zählt für beide), `spaet` umgekehrt, sonst keine.
- **F9 Freie Samstage**: Ein Samstag ist frei, wenn der Mitarbeiter dort keinen nicht unbesetzten Arbeitsblock hat. Urlaub, Krankheit, geschlossener Tag und noch nicht geplante Zukunft zählen als frei.
- **F10 Rückgängig** schickt die gemerkte Zeile (alle Blöcke des Mitarbeiters an dem Tag vor dem Strich) an `pep_plan_zeile_setzen`, das die Zeile atomar ersetzt. Ein Aufruf statt mehrerer Gegenstriche, damit kein halber Rückschritt entstehen kann.
- **F11 Kopieren** prüft am Ziel: vergangene oder geschlossene Tage überspringen; Mitarbeiter ohne Vertrag, inaktiv oder ausgetreten am Ziel auslassen; Blöcke auf die Ziel-Rahmenzeit kürzen (ganz außerhalb = verworfen, zählt als gekürzt); fehlende Kompetenz oder verletzte Pflicht-Vorgabe → Block auslassen; abwesende Mitarbeiter → Block trotzdem einfügen (wird nach F2 unbesetzt).
- **F12 Mitarbeiter-Reihenfolge** im Raster = `mitarbeiter.position`, dann Name. Geändert wird sie im Reiter „Mitarbeiter“ mit Knöpfen ▲/▼ statt per Ziehen: tablet-tauglich, ein Klick ist eine Speicherung.
- **F13 Urlaubs-Übersicht** im Reiter Abwesenheiten wandert von der rechten Seitenleiste unter das Raster (aufklappbar, offen), damit das Monatsraster die volle Breite bekommt.

## Review Focus

1. **KW 53/2026 und Jahreswechsel**: 2026 hat 53 ISO-Wochen (Montag 28.12.2026). `montagDerKw(2026, 53)` = `'2026-12-28'`, `kwVorZurueck(2026, 53, 1)` = `{ jahr: 2027, kw: 1 }`, `pep_einsatzplan_woche(2026, 53)` liefert 28.12.2026–03.01.2027, `pep_einsatzplan_woche(2026, 54)` → `DATUM_UNGUELTIG`. Tests in Task 2 und Task 4.
2. **Malen mitten in einen anderen Block** teilt ihn in drei, gleicher Bereich daneben verschmilzt, Radieren in der Mitte teilt in zwei; nie zwei überlappende Blöcke. Tests in Task 2.
3. **Teilabwesenheit** (Berufsschule 08:00–13:00 mit `von/bis`): Malen 13:00–18:00 geht, 12:00–14:00 → `ABWESEND`; ein vorher geplanter Block 09:00–12:00 wird unbesetzt, einer 14:00–18:00 nicht. Tests in Task 2 und Task 3.
4. **Abweichender Tag** (Heiligabend Do 24.12.2026 mit Rahmen 06:00–14:30 als `tag_abweichungen`): Kopieren eines normalen Donnerstags dorthin kürzt Blöcke und meldet `gekuerzt`. Test in Task 6.
5. **Vertrag beginnt oder endet mitten in der Woche** (Eintritt Mi, Austritt Fr): Der Mitarbeiter steht in der Wochenliste; Malen davor oder danach → `MITARBEITER_INAKTIV`, Malen vor dem ersten Vertrag → `KEIN_VERTRAG`. Test in Task 2.

---

## Dateistruktur

| Pfad | Zuständigkeit | Task |
| --- | --- | --- |
| `docs/style.css` | Gestaltung: Tokens, Knöpfe, Karten, Raster, Druck (`@media print`) | 1, 5, 10 |
| `docs/dialog.js` | gemeinsamer Dialog (aus `abwesenheiten.js` herausgelöst) | 1 |
| `docs/abwesenheiten.js` | Werkzeugleiste statt Palettenspalte, Raster volle Breite, Urlaub unter dem Raster | 1, 10 |
| `tests/vorschau/` | Vorschau-Server, App-Attrappe, Datenerzeugung, Foto-Skript | 1, jede UI-Task ergänzt Daten |
| `tests/fixtures/pep-schema-stufe-0.sql` | eingefrorenes Stufe-0-Schema für den Umstellungstest | 2 |
| `supabase/schema.sql` | Abschnitte „Einsatzplan“, „Regelprüfung“, „Kopieren und Vorlagen“, „Ersatz und Eckdaten“, „Vorausplanung“, „Berichte“, „Startseite“ | 2, 3, 6–11 |
| `docs/zeit.js` | rein: Halbstunden, ISO-KW, Stundenformat | 4 |
| `docs/plan-raster.js` | rein: Blöcke↔Zellen, Strich, Abdeckung, Summen, Rückgängig-Stapel | 4 |
| `docs/einsatzplan.js` | Reiter Einsatzplan | 5 |
| `docs/plan-dialoge.js` | Dialoge Kopieren, Vorlagen, Krank/ZA, Ersatz, Eckdaten | 6, 7, 8 |
| `docs/vorausplanung.js` | Reiter Vorausplanung | 9 |
| `docs/druck-daten.js` | rein: Zeilen für Tagesplan, Wochenplan, Abwesenheitsmonat, Resturlaub | 10 |
| `docs/druck.js`, `docs/xlsx.js` | Druckansicht, Excel-Export (Kopie aus dem Urlaubstool) | 10 |
| `docs/start.js` | Reiter Start | 11 |
| `tests/*.test.mjs` | `umstellung`, `einsatzplan`, `regeln`, `plan-raster`, `kopieren`, `ersatz`, `eckdaten`, `vorausplanung`, `druck-daten`, `berichte`, `startseite` | je Task |

---

### Task 1: Gestaltung überarbeiten und Vorschau einrichten

Auslöser: dtn findet die Oberfläche „nicht so schön“: Kalender zu klein, Tabelle statisch. Vorher-Foto (Vorschau 1440×900): Das Raster nutzt etwa 55 % der Breite, die Palette ist eine hohe Radioliste links, die Summenzeile überlappt („13,005,00“), die Urlaubstabelle läuft rechts aus dem Bild und erzeugt Querscrollen der ganzen Seite.

**Files:**
- Create: `docs/dialog.js`
- Modify: `docs/style.css` (Tokens und Komponenten), `docs/abwesenheiten.js` (Werkzeugleiste, Raster, Urlaub unten), `docs/app.js` (Filialname im Kopf), `docs/hilfe.js` (Erfolgsmeldung als Toast), `docs/kalender.js` (`kurzStunden`), `docs/index.html` (Kopf-Element für den Filialnamen)
- Übernehmen und erweitern: `tests/vorschau/server.mjs`, `app-attrappe.js`, `daten-erzeugen.mjs`, `foto.mjs` (liegen als funktionierender Prototyp im Worktree, noch nicht committet), `.gitignore` (enthält schon `tests/vorschau/*.png`)
- Test: `tests/kalender.test.mjs`

**Interfaces:**
- Produces: `dialog(titel, koerper, aktionen, beimSchliessen?) → HTMLDialogElement` in `docs/dialog.js`. Verhalten exakt wie bisher in `abwesenheiten.js`: `aktionen = [{ text, aktion, danach, sekundaer, gefahr }]`, Fehler erscheinen im Dialog, Abbrechen-Knopf immer da. Alle späteren Dialoge benutzen ihn.
- Produces: `kurzStunden(n) → string` in `docs/kalender.js`: ganze Zahl ohne Nachkommastellen, sonst zwei Stellen mit Komma, 0 und NULL als leerer Text.
- Produces: CSS-Klassen für spätere Tasks: `.knopf` (sekundär), `.knopf.primaer`, `.knopf.gefahr`, `.chip` mit `[aria-pressed="true"]`, `.werkzeugleiste`, `.karte` (`.box` bleibt als gleichwertiger Alias), `.raster-scroll` (Scroll-Container mit klebender Kopfzeile und Namensspalte), `.zahl` (rechtsbündig, `font-variant-numeric: tabular-nums`), `.warnung`, `.hinweis-gelb`, `.unbesetzt` (rot schraffiert).
- Produces: Vorschau. `node tests/vorschau/server.mjs [port]` liefert `/vorschau?ansicht=<name>` = `docs/index.html` ohne CSP, mit Import-Map `/docs/app.js → /tests/vorschau/app-attrappe.js`. Die Attrappe beantwortet `aufruf(funktion)` aus `tests/vorschau/daten/<funktion>.json` (fehlt die Datei: `null`). `daten-erzeugen.mjs` erzeugt diese Dateien aus einer PGlite-Datenbank mit erfundenen Namen über die echten Funktionen. `foto.mjs` nimmt Chrome vor Edge (Edge headless schreibt unter Windows keinen Screenshot, wenn Edge schon läuft).

Gestaltungsvorgaben (verbindlich, Feinheiten entscheidet der Implementierer):
- Tokens in `:root` zusätzlich zu den vorhandenen (vorhandene Namen bleiben, sie werden benutzt): `--text #1a1a1a`, `--text-2 #5f6368`, `--hintergrund #f4f4f1`, `--flaeche #fff`, `--linie-stark #b9b9b0`, `--hinweis #fff4b3`, `--ok #2e7d32`, `--radius 8px`, `--schatten-1: 0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.08)`, `--schatten-2: 0 6px 20px rgba(0,0,0,.16)`, `--dauer 150ms`, Abstände `--a1 4px`, `--a2 8px`, `--a3 12px`, `--a4 16px`, `--a5 24px`, `--a6 32px`. Schrift `system-ui, "Segoe UI", Roboto, Arial, sans-serif`, Grundgröße 16 px, Datenzellen nie unter 12 px.
- Knöpfe: Mindesthöhe 40 px, auf Touch (`@media (pointer: coarse)`) 44 px. Sichtbarer Fokus `:focus-visible { outline: 3px solid var(--schwarz); outline-offset: 2px }`. Hover und aktiv mit Übergang `var(--dauer)`; `@media (prefers-reduced-motion: reduce)` schaltet Übergänge ab. Nur eine gelbe Primäraktion je Bereich; Monatspfeile sind sekundär.
- Kopf: gelb, „PEP“ plus Filialname aus `ich.filiale.name`, rechts der Benutzer. Reiterleiste weiß, klebt oben (`position: sticky`), aktiver Reiter fett mit roter Unterlinie.
- Erfolgsmeldung „Gespeichert.“ als Toast unten mittig (`position: fixed`), verschwindet nach 3 s. Fehler bleiben oben in der Seite wie bisher. `meldung(text, art)` behält die Signatur.
- Abwesenheiten: oben eine Werkzeugleiste in einer Karte mit Monatsnavigation `◀ November 2026 ▶` und „Heute“, daneben die Palette als Chips (`button.chip` mit `aria-pressed`, Farbfeld + Kürzel, `title` = Name; „Ansehen“ und „Löschen“ als erste Chips), Schalter „mit Uhrzeit“, Knopf „Wiederholung …“, Legende rechts. Darunter das Raster über die **volle Breite**: `table-layout: fixed`, Namensspalte 200 px klebend links, Tagesspalten gleich breit mit mindestens 34 px (reicht die Breite nicht, scrollt nur der Raster-Container), Zeilenhöhe 40 px, Kopfzeilen kleben oben im Container (`max-height: calc(100vh - 230px)`). Heutiger Tag: Kopf gelb, Spalte mit schwarzen Seitenlinien. Zeilen-Hover hellgelb; Spalten-Hover per JS-Klasse `spalte-hover` an allen Zellen desselben Datums. Belegte Zellen als Chip (Codefarbe, Radius 4 px, Kürzel fett 12 px, Stunden 11 px). Summenzeile mit `kurzStunden`, ohne Überlappen. Urlaubsübersicht nach F13 unter dem Raster als `<details open>` mit Spalten Mitarbeiter, Anspruch, genehmigt, offen im Monat, Rest (h), Rest (Tage); Rest unter 0 rot mit „−“. **Kein** Querscrollen der ganzen Seite bei 1366 px und bei 1024 px Breite.
- Mitarbeiter, Einstellungen, Login: Karten mit Schatten und Radius, Formularfelder 40 px hoch, Login-Karte zentriert. Keine Funktionsänderung.

- [ ] **Step 1: Vorschau übernehmen.** Prototyp-Dateien in `tests/vorschau/` prüfen. `daten-erzeugen.mjs` schreibt zusätzlich `pep_mitarbeiter` (erster Mitarbeiter), `pep_bereiche`, `pep_feiertage`, `pep_urlaub_umfragen`, `pep_urlaub_zuordnung`, jeweils als Ausgabe der echten Funktion. `abwesenheiten.js` übernimmt beim Start `?jahr=2026&monat=11` aus `location.search`, wenn vorhanden; sonst wie bisher das heutige Datum. So zeigt die Vorschau „November 2026“ passend zu den Daten.
- [ ] **Step 2: Vorher-Fotos** `abwesenheiten`, `mitarbeiter`, `einstellungen` mit 1440×900. Erwartet: drei PNG-Dateien.
- [ ] **Step 3: Failing test** in `tests/kalender.test.mjs`:
```js
test('kurzStunden: 13 → "13", 6.25 → "6,25", 14.5 → "14,50", 0 und null → ""', () => {
  assert.equal(kurzStunden(13), '13');
  assert.equal(kurzStunden(6.25), '6,25');
  assert.equal(kurzStunden(14.5), '14,50');
  assert.equal(kurzStunden(0), '');
  assert.equal(kurzStunden(null), '');
});
```
Run: `node --test tests/kalender.test.mjs`. Expected: FAIL, `kurzStunden` fehlt.
- [ ] **Step 4: Umsetzen** nach den Gestaltungsvorgaben; `dialog` nach `docs/dialog.js` verschieben und in `abwesenheiten.js` importieren.
- [ ] **Step 5: Prüfen.** `npm test`: alle grün. `node --check` für jede geänderte `docs/*.js`. Nachher-Fotos `abwesenheiten` (1440×900, 1366×768, 1024×768), `mitarbeiter`, `einstellungen`. Im Bericht die Pfade nennen und je Vorgabe sagen, wo sie im Foto sichtbar ist. Erwartet: kein Seiten-Scrollbalken quer bei 1366 und 1024, Summenzeile ohne Überlappung, Palette als eine Chip-Zeile.
- [ ] **Step 6: Commit** `Gestaltung: Werkzeugleiste, Raster volle Breite, Toast, Vorschau`.

---

### Task 2: Datenbank Einsatzplan-Grundlage

**Files:**
- Create: `tests/fixtures/pep-schema-stufe-0.sql` (Kopie von `supabase/schema.sql` auf `origin/main` 3cdbf91, Kopfkommentar „eingefroren: Stufe 0, main 3cdbf91“), `tests/umstellung.test.mjs`, `tests/einsatzplan.test.mjs`
- Modify: `supabase/schema.sql` (Abschnitt „Einsatzplan“), `tests/helfer.mjs` (`planGrundlage`), `tests/rechte.test.mjs`, `docs/hilfe.js` (Fehlertexte)

**Interfaces:**
- Produces (Tabellen, alle mit `filiale_id … on delete cascade`, RLS an):
  - `pep.bereiche.bedeutung` nach F1; `pep.grundausstattung` setzt sie für KA und VP.
  - `pep.plan_bloecke (id, filiale_id, mitarbeiter_id → mitarbeiter on delete cascade, datum, von time, bis time, bereich_id → bereiche, angelegt_von uuid, geaendert_am timestamptz default now())`, Checks halbe Stunde und `von < bis`, Index `(filiale_id, datum)`. Trigger `pep.bloecke_ohne_ueberlappung` (before insert or update) wirft `UEBERLAPPUNG`, wenn ein anderer Block desselben Mitarbeiters am selben Tag überlappt.
  - `pep.plan_kommentare (filiale_id, mitarbeiter_id, datum, text not null, primary key (mitarbeiter_id, datum))`.
  - `pep.wochen (filiale_id, jahr, kw, planumsatz numeric(12,2), stundenleistung_eur_pro_h numeric(8,2), stundenvorgabe_manuell numeric(7,2), primary key (filiale_id, jahr, kw))`.
  - `pep.vorlagen (id, filiale_id, name, art check in ('tag', 'woche'), daten jsonb not null, angelegt_am timestamptz default now(), unique (filiale_id, name))`.
- Produces (intern):
  - `pep.zeile_pruefen(p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date, p_alt jsonb, p_neu jsonb) → void`: alle **Sperren** für die künftige Zeile `p_neu = [{von, bis, bereich_id}]` gegenüber der bisherigen `p_alt`. Prüfreihenfolge und Codes: `VERGANGEN` (datum < heute), `MITARBEITER_INAKTIV` (inaktiv, `eintritt > datum` oder `austritt < datum`), `KEIN_VERTRAG`, `GESCHLOSSEN`, `AUSSERHALB_RAHMEN`, `BEREICH_NICHT_GEFUNDEN` (fremd oder inaktiv), `BEREICH_NICHT_MALBAR` (art `funktion`), `KOMPETENZ_FEHLT`, `ABWESEND` (nur für Zeit, die gegenüber `p_alt` **neu belegt** wird; bestehende unbesetzte Blöcke dürfen stehen bleiben), `VORGABE_VERLETZT` (Pflicht-Wochenvorgabe: `nicht_verfuegbar` ganztags oder im Zeitraum, außerhalb `nur_zwischen`, `max_stunden_tag`, `max_stunden_woche` mit der künftigen Zeile).
  - `pep.zeile_schreiben(p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date, p_bloecke jsonb, p_user_id uuid) → void`: ersetzt die Zeile, sortiert, verschmilzt angrenzende Blöcke gleichen Bereichs, protokolliert (`vorher`/`nachher` = Blocklisten).
  - `pep.zeile_mit_strich(p_bloecke jsonb, p_von time, p_bis time, p_bereich_id bigint) → jsonb`: rein; alte Zeile plus Strich (Bereich, oder NULL = radieren) ergibt die neue Zeile (teilen, kürzen, verschmelzen).
  - `pep.unbesetzt(p_mitarbeiter_id bigint, p_datum date, p_von time, p_bis time) → boolean` nach F2.
  - `pep.tag_antwort(p_filiale_id bigint, p_datum date, p_mitarbeiter_ids bigint[]) → jsonb` = `{ datum, bloecke: [Block …] (nur diese Mitarbeiter an diesem Tag), pruefung: {} }`. Task 3 füllt `pruefung`.
  - `pep.kw_montag(p_jahr int, p_kw int) → date`: `DATUM_UNGUELTIG`, wenn es die KW im Jahr nicht gibt (Probe: ISO-Jahr und ISO-KW des Ergebnisses gleich der Eingabe).
  - `pep.woche_kennzahlen(p_filiale_id bigint, p_jahr int, p_kw int) → jsonb`: Felder und Rechnung stehen in Task 9; sie wird schon hier vollständig gebaut, weil `pep_einsatzplan_woche` die Stundenvorgabe braucht. Die Tests dazu liegen in Task 9.
- Produces (öffentlich):
  - `public.pep_einsatzplan_woche(p_jahr int, p_kw int) → jsonb`:
    ```
    { jahr, kw, montag, heute,
      tage: [{datum, wochentag, geoeffnet, oeffnung_von, oeffnung_bis, rahmen_von, rahmen_bis, feiertag, vergangen}],  -- 7 Einträge Mo–So
      bereiche: [{id, kuerzel, name, farbe, art, bedeutung, kompetenz_noetig}],  -- aktiv, art bereich|pause, nach position
      mitarbeiter: [{id, name, personalnummer, vertragsart, wochenstunden, kompetenzen: [bereich_id], vp: bool,
                     u18: {"YYYY-MM-DD": bool}}],
      bloecke: [{id, mitarbeiter_id, datum, von, bis, bereich_id, unbesetzt}],
      abwesenheiten: [{mitarbeiter_id, datum, code, name, farbe, sperrt, stunden, von, bis}],
      kommentare: [{mitarbeiter_id, datum, text}],
      pruefung: { "YYYY-MM-DD": [] },   -- Task 3 füllt
      kennzahlen: <pep.woche_kennzahlen> }
    ```
    Mitarbeiter: aktiv oder mit Block in der Woche, Vertrag an mindestens einem Tag der Woche, `eintritt ≤ Sonntag`, `austritt` leer oder `≥ Montag`. Reihenfolge `position, name, id` (F12). `wochenstunden` = Vertrag am Montag, sonst am ersten Vertragstag der Woche.
  - `public.pep_plan_malen(p_mitarbeiter_id bigint, p_datum date, p_von time, p_bis time, p_bereich_id bigint) → jsonb`. `p_bereich_id` NULL = radieren; Radieren prüft nur `VERGANGEN`, Zeiten und Rechte. Antwort `pep.tag_antwort(…, [mitarbeiter])`.
  - `public.pep_plan_zeile_setzen(p_mitarbeiter_id bigint, p_datum date, p_bloecke jsonb) → jsonb` (F10), gleiche Antwort.
  - `public.pep_kommentar_setzen(p_mitarbeiter_id bigint, p_datum date, p_text text) → void`. Leer oder NULL löscht; mehr als 200 Zeichen → `TEXT_ZU_LANG`. Auch an vergangenen Tagen erlaubt.
  - `public.pep_mitarbeiter_reihenfolge(p_ids bigint[]) → void` (nur Leitung): setzt `position` = Index für genau die aktiven Mitarbeiter der Filiale; fehlende, fremde oder doppelte Id → `WERT_UNGUELTIG`.
- Produces (Tests): `planGrundlage(db, { heute = '2026-11-02' } = {})` in `tests/helfer.mjs` liefert `{ leitung, stellv, fil, bereich, code, json(nutzer, sql, params), ma(name, { stunden = 37.5, art = 'vollzeit', ab = '2026-01-01', geburtsdatum = null, kompetenzen = ['KA'] }) → id, malen(nutzer, maId, datum, von, bis, kuerzel | null) → tag_antwort }`. `bereich` und `code` sind Objekte Kürzel → Id. Alle späteren DB-Tests bauen darauf auf.

- [ ] **Step 1: Umstellungstest** (`tests/umstellung.test.mjs`):
```js
test('Stufe-0-Datenbank mit Daten → aktuelles Schema zweimal: Daten bleiben, KA/VP haben Bedeutung, neue Tabellen da', async () => {
  // neueDatenbank({ schema: false }), Fixture laden, Leitung + Filiale + 1 Mitarbeiter + 1 Abwesenheit anlegen,
  // dann SCHEMA zweimal ausführen.
  assert.deepEqual(mitarbeiterNachher, mitarbeiterVorher);
  assert.deepEqual(abwesenheitenNachher, abwesenheitenVorher);
  assert.deepEqual(bedeutungen, { KA: 'kasse', VP: 'vp' });
  for (const t of ['plan_bloecke', 'plan_kommentare', 'wochen', 'vorlagen']) assert.ok(tabellen.includes(t), t);
});
```
- [ ] **Step 2: Einsatzplan-Tests** (`tests/einsatzplan.test.mjs`), Testname und Kern-Assertion:
  - `malen KA 08:00–12:00 → ein Block` mit `bloecke = [{ von: '08:00', bis: '12:00', bereich_id: KA, unbesetzt: false }]`
  - `OG 10:00–11:00 in KA 08–12 → KA 08–10, OG 10–11, KA 11–12` (Review Focus 2)
  - `KA 12:00–14:00 neben KA 08–12 → ein Block 08–14; radieren 10–11 → 08–10 und 11–14`
  - `Pause 12:00–12:30 ohne Kompetenz erlaubt; OG ohne Kompetenz → KOMPETENZ_FEHLT; VP → BEREICH_NICHT_MALBAR`
  - `05:30 oder bis 22:00 → AUSSERHALB_RAHMEN; So 15.11. → GESCHLOSSEN; 01.11. → VERGANGEN; heute 02.11. erlaubt; 08:15 → HALBE_STUNDE`
  - `U ganztags → malen ABWESEND; vorher geplanter Block wird unbesetzt und lässt sich radieren`
  - `BS 08:00–13:00 mit von/bis: 13–18 erlaubt, 12–14 ABWESEND; vorher 09–12 unbesetzt, 14–18 nicht` (Review Focus 3)
  - `Pflicht nicht_verfuegbar Sa → VORGABE_VERLETZT; Pflicht nur_zwischen 08–14: 13–15 → VORGABE_VERLETZT; Pflicht max_stunden_tag 6: 08–15 → VORGABE_VERLETZT, 08–14 erlaubt; dieselben Vorgaben mit pflicht = false sperren nicht`
  - `Eintritt Mi 11.11., Austritt Fr 13.11.: steht in KW 46; malen Di → MITARBEITER_INAKTIV, Sa → MITARBEITER_INAKTIV; Vertrag erst ab Mi: Di → KEIN_VERTRAG` (Review Focus 5)
  - `direktes Insert eines überlappenden Blocks → UEBERLAPPUNG`
  - `pep_plan_zeile_setzen ersetzt die Zeile; [] löscht sie; Zeile mit 05:00 → AUSSERHALB_RAHMEN und die alte Zeile bleibt`
  - `pep_einsatzplan_woche(2026, 46): 7 Tage, Sonntag geoeffnet = false, Mitarbeiter in position-Reihenfolge, Blöcke, Abwesenheiten und Kommentare der Woche`
  - `pep_einsatzplan_woche(2026, 53) beginnt 2026-12-28; (2026, 54) und (2027, 0) → DATUM_UNGUELTIG` (Review Focus 1)
  - `Kommentar setzen, ändern, leeren; 201 Zeichen → TEXT_ZU_LANG`
  - `Reihenfolge [c, a, b] → Wochenliste c, a, b; fremde Id → WERT_UNGUELTIG; Stellvertretung → NUR_LEITUNG`
  - `malen schreibt Protokoll (tabelle plan_bloecke, vorher und nachher)`
  - `fremde Filiale: Mitarbeiter → MITARBEITER_NICHT_GEFUNDEN, Bereich → BEREICH_NICHT_GEFUNDEN`
- [ ] **Step 3:** Run `node --test tests/umstellung.test.mjs tests/einsatzplan.test.mjs`. Expected: FAIL, Funktionen fehlen.
- [ ] **Step 4: Umsetzen**: Schema-Abschnitt „Einsatzplan“, `planGrundlage`, Rechtetest-Einträge, Fehlertexte für `UEBERLAPPUNG`, `VERGANGEN`, `GESCHLOSSEN`, `AUSSERHALB_RAHMEN`, `BEREICH_NICHT_MALBAR`, `KOMPETENZ_FEHLT`, `ABWESEND`, `VORGABE_VERLETZT`, `TEXT_ZU_LANG`. Beispieltexte: `ABWESEND: 'Der Mitarbeiter ist zu dieser Zeit abwesend.'`, `VORGABE_VERLETZT: 'Das verstößt gegen eine Pflicht-Vorgabe des Mitarbeiters (siehe Mitarbeiterkarte).'`.
- [ ] **Step 5:** `npm test`: alle grün, auch Rechte- und Hilfe-Test.
- [ ] **Step 6: Commit** `Einsatzplan-Datenbank: Blöcke malen, Sperren, Wochendaten`.

---

### Task 3: Regelprüfung

**Files:**
- Modify: `supabase/schema.sql` (Abschnitt „Regelprüfung“), `tests/rechte.test.mjs`
- Create: `tests/regeln.test.mjs`

**Interfaces:**
- Consumes: Tabellen, `pep.unbesetzt`, `pep.tag_antwort`, `pep_einsatzplan_woche`, `planGrundlage` (Task 2); Einstellungen `pause_ab_6h_min`, `pause_ab_9h_min`, `ruhezeit_h`, `ruhezeit_u18_h`, `max_tag_h`, `max_tag_u18_h`, `max_woche_u18_h`, `spaet_grenze`, `u18_fruehestens`, `u18_spaetestens`, `freie_samstage_monat`, `freie_samstage_jahr`, `wochen_toleranz_h` über `pep.einstellung(filiale, schluessel)`.
- Produces: `pep.pruefung(p_filiale_id bigint, p_datum date) → jsonb` = Liste `[{art, schwere, mitarbeiter_id, von, bis, text}]`, sortiert nach `schwere` (`warnung` vor `hinweis`), dann `von`, dann Mitarbeitername. `von`/`bis` als `'HH:MI'` oder NULL. Zusammenhängende Halbstunden derselben Art und desselben Mitarbeiters ergeben **einen** Eintrag.
- Produces: `pep.lage(p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date) → text` (`frueh|spaet|lang|mitte` oder NULL, F8). Task 7 und 8 benutzen sie.
- Produces: `pep.tag_antwort(...).pruefung` = Listen für Vortag, Tag und Folgetag (Ruhezeit wirkt auf Nachbartage). `pep_einsatzplan_woche().pruefung` = alle 7 Tage.
- Produces: `public.pep_pruefung_zeitraum(p_von date, p_bis date) → jsonb` = `{ "YYYY-MM-DD": [...] }`; mehr als 42 Tage → `ZEITRAUM_ZU_LANG`; `bis < von` → `ZEITRAUM_UNGUELTIG`.

Regeln (Zeiten im Text „07:00–08:00“, Stunden mit Komma und zwei Stellen):

| art | schwere | Bedingung | text |
| --- | --- | --- | --- |
| `unbesetzt` | warnung | Block nach F2 | „Unbesetzt (KM): 08:00–14:00“ (Code der Abwesenheit) |
| `kasse_unbesetzt` | warnung | Halbstunde der Öffnungszeit ohne arbeitenden Block mit `bedeutung = 'kasse'` | „Kasse unbesetzt 07:00–08:00“ |
| `keine_vp` | warnung | F5 | „Keine VP anwesend 06:00–07:00“ |
| `vp_allein` | warnung | Halbstunde der Öffnungszeit mit genau einer anwesenden Person | „Nur eine Person anwesend 19:30–20:00“ |
| `pausenabloese` | warnung | Pause eines Mitarbeiters, der am Tag einen Kassenblock hat; in einer Pausen-Halbstunde ist die Kasse unbesetzt oder niemand mit Kassenkompetenz anwesend, der nicht selbst Kasse oder Pause hat | „Pausenablöse fehlt 12:00–12:30“ |
| `pause_fehlt` | warnung | Anwesenheit über 6 h und Pausen unter `pause_ab_6h_min`, oder über 9 h und unter `pause_ab_9h_min` | „Pause fehlt oder zu kurz: 7,50 h anwesend, 0 min Pause (mind. 30 min)“ |
| `ruhezeit` | warnung | letztes Ende Vortag bis erster Beginn heute unter `ruhezeit_h` (unter 18: `ruhezeit_u18_h`); ebenso heute bis Folgetag, wenn dort geplant | „Ruhezeit 9,50 h (mind. 11 h) vor 07:00“ |
| `hoechstarbeitszeit` | warnung | Tagesstunden über `max_tag_h`; unter 18 über `max_tag_u18_h`; unter 18 Woche über `max_woche_u18_h` | „10,50 h am Tag (höchstens 10 h)“ |
| `wochenstunden` | warnung | F6 | „Woche: 40,00 h geplant + 6,25 h abwesend, Vertrag 37,50 h“ |
| `jarbschg` | warnung | unter 18 (F7): Beginn vor `u18_fruehestens` oder Ende nach `u18_spaetestens` | „Unter 18: nicht vor 06:00 und nicht nach 20:00“ |
| `wochenstunden_unter` | hinweis | alle geöffneten Tage der KW haben mindestens einen Block (irgendein Mitarbeiter), und geplant + abwesend liegt unter Vertrag − Toleranz | „Woche: 30,00 h von 37,50 h verplant“ |
| `vorgabe_bevorzugt` | hinweis | nicht-Pflicht-Wochenvorgabe verletzt (gleiche Prüfung wie die Sperre) | „Bevorzugt: nur 08:00–14:00“, oder die `notiz` der Vorgabe, wenn gesetzt |
| `schichtlage` | hinweis | Lage heute (F8) ist `frueh` oder `spaet` und gleich der Lage der Vorwoche | „Letzte Woche überwiegend früh“ |
| `samstag_spaet` | hinweis | Samstag mit Lage `spaet` oder `lang`, und der letzte vorherige Samstag mit Arbeit war auch `spaet` oder `lang` | „Zweiter Samstag spät in Folge“ |
| `freier_samstag` | hinweis | Samstag mit Arbeit, und kein anderer Samstag des Monats ist frei (F9); oder freie Samstage des Jahres vor dem Datum plus Samstage nach dem Datum liegen unter `freie_samstage_jahr` | „Noch kein freier Samstag im November“ bzw. „Jahresziel 12 freie Samstage nicht mehr erreichbar“ |
| `wunsch_offen` | hinweis | offener Urlaubswunsch (Stufe 0: `pep.urlaubswuensche` ohne entschiedene Freigabe) an einem Tag mit Arbeit | „Urlaubswunsch offen“ |

- [ ] **Step 1: Failing tests** in `tests/regeln.test.mjs`: **für jede Zeile der Tabelle ein Positiv- und ein Negativfall** (Spec 16), Name `<art>: <Fall>`, zum Beispiel:
```js
test('kasse_unbesetzt: Öffnung 07–20, KA nur 07–19 → genau ein Eintrag 19:00–20:00', …);
test('kasse_unbesetzt: KA 07–20 durchgehend → kein Eintrag', …);
test('keine_vp: niemand vor 07:00 anwesend → kein Eintrag 06:00–07:00 (F5)', …);
test('ruhezeit: Vortag bis 21:30, heute ab 07:00 → 9,50 h, Eintrag an beiden Tagen', …);
test('jarbschg: 17 Jahre am 10.11.2026, Ende 21:00 → Eintrag; am 18. Geburtstag kein Eintrag', …);
test('unbesetzt: KM ganztags über geplantem KA 07–14 → unbesetzt-Eintrag und zusätzlich kasse_unbesetzt 07–14', …);
```
  Außerdem: `pep_plan_malen` liefert `pruefung` für Vortag, Tag und Folgetag; `pep_einsatzplan_woche().pruefung` hat 7 Schlüssel; `pep_pruefung_zeitraum` über 43 Tage → `ZEITRAUM_ZU_LANG`.
- [ ] **Step 2:** Run `node --test tests/regeln.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Umsetzen.** Halbstunden über `generate_series` zwischen `rahmen_von` und `rahmen_bis`; je Halbstunde und Mitarbeiter ein Zustand (`kasse`, `arbeit`, `pause` oder nichts) aus nicht unbesetzten Blöcken; danach zu Intervallen zusammenfassen.
- [ ] **Step 4:** `npm test`: alle grün.
- [ ] **Step 5: Commit** `Regelprüfung: Warnungen und Hinweise je Tag`.

---

### Task 4: Reine Plan-Logik der Oberfläche

**Files:**
- Create: `docs/zeit.js`, `docs/plan-raster.js`, `tests/plan-raster.test.mjs`

**Interfaces:**
- Produces in `docs/zeit.js` (keine Importe, kein DOM):
  - `minuten('06:30') → 390`, `uhrzeit(390) → '06:30'`
  - `halbstunden(von, bis) → ['06:00', '06:30', …]` (Beginnzeiten, `bis` exklusiv)
  - `isoWoche(iso) → { jahr, kw }`, `montagDerKw(jahr, kw) → 'YYYY-MM-DD'`, `kwVorZurueck(jahr, kw, schritt) → { jahr, kw }`, `tageDerWoche(jahr, kw) → ['YYYY-MM-DD' × 7]`, `plusTage(iso, n) → iso`
  - `zeitspanne('07:00', '15:30') → '07:00–15:30'`, `stundenText(7.5) → '7,50'`
- Produces in `docs/plan-raster.js` (importiert nur `zeit.js`):
  - `zellen(bloecke, spalten) → Array<{ bereich_id, block_id, unbesetzt } | null>`, eine Position je Halbstunde
  - `strich(spalten, startIndex, endIndex) → { von, bis }`: Richtung egal, `bis` = Ende der letzten Zelle
  - `abdeckung(woche, datum, spalten) → { kasse: number[], vp: number[], anwesend: number[] }` nach F2, F3, F5; `woche` = Antwort von `pep_einsatzplan_woche`
  - `abdeckungsKlasse(art, anzahl, inOeffnung, anwesend) → 'rot' | 'gelb' | ''`: Kasse 0 in der Öffnung rot, genau 1 gelb; VP 0 in der Öffnung rot, außerhalb der Öffnung rot nur bei `anwesend > 0`
  - `tagesStunden(bloecke, pauseIds) → number`, `wochenSummen(woche) → Map<mitarbeiter_id, { soll, geplant, differenz }>` (Soll = Vertrag − Abwesenheitsstunden der Woche), `bereichsStunden(woche, datum) → Map<bereich_id, number>`
  - `rueckgaengigStapel(max = 20) → { merken(eintrag), holen() → eintrag | undefined, leer() → boolean }`; bei mehr als `max` fällt der älteste heraus

- [ ] **Step 1: Failing tests** in `tests/plan-raster.test.mjs`, unter anderem:
```js
assert.deepEqual(halbstunden('06:00', '07:30'), ['06:00', '06:30', '07:00']);
assert.deepEqual(isoWoche('2026-12-31'), { jahr: 2026, kw: 53 });
assert.equal(montagDerKw(2026, 53), '2026-12-28');
assert.deepEqual(kwVorZurueck(2026, 53, 1), { jahr: 2027, kw: 1 });
assert.deepEqual(kwVorZurueck(2027, 1, -1), { jahr: 2026, kw: 53 });
assert.deepEqual(strich(halbstunden('06:00', '21:30'), 5, 2), { von: '07:00', bis: '09:00' });
// abdeckung: Kasse 07–10 und 09–12, der zweite unbesetzt → kasse an 06:00 = 0, 07:00 = 1, 10:00 = 0
// rueckgaengigStapel(2): drei merken → holen() liefert den dritten, dann den zweiten, dann undefined
```
- [ ] **Step 2:** Run `node --test tests/plan-raster.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Umsetzen.** ISO-Wochen mit `Date.UTC`, nie mit Ortszeit, damit die Sommerzeit nichts verschiebt.
- [ ] **Step 4:** `npm test`: grün.
- [ ] **Step 5: Commit** `Plan-Logik: Zeitraster, ISO-Wochen, Abdeckung, Rückgängig`.

---

### Task 5: Einsatzplan-Oberfläche

**Files:**
- Create: `docs/einsatzplan.js`
- Modify: `docs/main.js` (Import), `docs/index.html` (Platzhalter „Folgt in Stufe 1.“ in `ansicht-einsatzplan` entfernen), `docs/style.css` (Raster-Klassen), `docs/mitarbeiter.js` (▲/▼ nach F12), `tests/vorschau/daten-erzeugen.mjs` (KW 46 → `pep_einsatzplan_woche.json`)

**Interfaces:**
- Consumes: `pep_einsatzplan_woche`, `pep_plan_malen`, `pep_plan_zeile_setzen`, `pep_kommentar_setzen`, `pep_mitarbeiter_reihenfolge` (Task 2, 3); `docs/zeit.js`, `docs/plan-raster.js` (Task 4); `dialog` und CSS-Klassen (Task 1).
- Produces: `reiter.einsatzplan = { zeigen }`; Export `oeffneWoche(jahr, kw, datum?)` als Sprungziel für Startseite und Vorausplanung (Task 9, 11); Export `planNeuLaden()` für die Dialoge aus Task 6–8.
- Produces: Export `aktionen = { kopieren: null, vorlagen: null, krank: null, ersatz: null, eckdaten: null, drucken: null }`. Task 6–10 belegen die Einträge mit Funktionen (`ersatz(mitarbeiterId, datum)`, `eckdaten(mitarbeiterId, datum)`, die übrigen ohne Argumente). Ein Knopf ist ausgeblendet, solange sein Eintrag `null` ist.

Aufbau (Spec 11, Skizze `.superpowers/brainstorm/*/content/tagesansicht.html`):
- Kopf (Karte): `◀ KW 46 ▶` mit Datumsauswahl und „Heute“; sieben Tages-Reiter „Mo 09.11. 07–20“ (geschlossen grau, vergangen kursiv); Knöpfe „Rückgängig“, „Kopieren“, „Vorlagen“, „Krank/ZA“, „Drucken“.
- Pinsel: Chips aller `bereiche` (Farbe + Kürzel) plus „Radieren“. Die Auswahl merkt sich `localStorage` (Zugriff in `try/catch`).
- Raster: Zeilen = `mitarbeiter`. Links der Name als Knopf (→ `aktionen.eckdaten`), darunter Vertrag „VZ 37,5“ und Kompetenz-Kürzel; dann Tagesstunden; dann Halbstunden-Zellen von `rahmen_von` bis `rahmen_bis` des gewählten Tages (volle Stunde mit stärkerer Linie, Öffnungszeit hinterlegt); rechts der Kommentar (Klick öffnet ein Eingabefeld, Enter oder Verlassen speichert). Ganztags abwesende Zeilen grau mit „U – Urlaub“. Unbesetzte Blöcke mit Klasse `.unbesetzt` und Knopf „Ersatz“ (→ `aktionen.ersatz`).
- Malen: Pointer-Events wie in `abwesenheiten.js` (Pointer-Capture, Markierung während des Ziehens, nur innerhalb einer Zeile). Loslassen → `pep_plan_malen`; vorher die Zeile im `rueckgaengigStapel` merken. Die Antwort ersetzt die Blöcke dieses Mitarbeiters an diesem Tag und die `pruefung` der gelieferten Tage. Bei einer Sperre erscheint der Fehlertext 3 s lang als kleiner Hinweis an der Zeigerposition und oben als Meldung; die Zeile bleibt unverändert.
- Abdeckungszeilen unter dem Raster: „Kasse“ und „VP“ je Halbstunde mit `abdeckungsKlasse`.
- Seitenleiste (rechts ab 1600 px Breite, sonst unter dem Raster): (1) Regelprüfung des Tages, Warnungen rot, Hinweise gelb, Klick markiert Zeile und Zellen; (2) Woche: je Mitarbeiter Soll, geplant, Differenz (rot unter 0, grün ab 0), Summe gegen `kennzahlen.stundenvorgabe`, mit dem Zusatz „ohne Planumsatz“, wenn `vorgabe_quelle = 'verfuegbar'`; (3) Abteilungen heute: Stunden je Bereich.
- Vergangene Tage: kein Pinsel, Hinweis „Vergangene Tage sind schreibgeschützt. Die IST-Erfassung folgt in der nächsten Stufe.“
- Reiter Mitarbeiter: je aktivem Mitarbeiter ▲/▼ (nur Leitung) → `pep_mitarbeiter_reihenfolge` mit der neuen Reihenfolge.

- [ ] **Step 1:** Vorschau-Daten für KW 46 erzeugen: mindestens 8 Mitarbeiter mit Blöcken Mo–Sa, eine Krankmeldung über geplanten Blöcken, eine Berufsschule 08–13, ein Kommentar, eine Lücke an der Kasse, eine Pause ohne Ablöse.
- [ ] **Step 2: Umsetzen.**
- [ ] **Step 3: Prüfen.** `npm test` grün; `node --check docs/einsatzplan.js docs/mitarbeiter.js`; Fotos `einsatzplan` mit 1440×900, 1366×768, 1024×768 und `mitarbeiter`. Erwartet im Foto: Halbstundenraster 06:00–21:30 mit Kürzeln in den Blöcken, rot schraffierte unbesetzte Blöcke mit „Ersatz“, rote und gelbe Abdeckungszellen, Regelliste mit mindestens „Kasse unbesetzt“ und „Pausenablöse fehlt“, kein Seiten-Querscrollen.
- [ ] **Step 4:** Handprüf-Punkte für die ANLEITUNG im Bericht notieren (Task 11 übernimmt sie): Malen mit Maus und Finger, Sperre am Zeiger, dreimal Rückgängig, Kommentar, Tageswechsel, KW 53.
- [ ] **Step 5: Commit** `Einsatzplan: Tagesraster mit Malen, Abdeckung und Seitenleiste`.

---

### Task 6: Kopieren und Vorlagen

**Files:**
- Modify: `supabase/schema.sql` (Abschnitt „Kopieren und Vorlagen“), `tests/rechte.test.mjs`, `docs/hilfe.js`, `docs/einsatzplan.js` (`aktionen.kopieren`, `aktionen.vorlagen`)
- Create: `docs/plan-dialoge.js`, `tests/kopieren.test.mjs`

**Interfaces:**
- Consumes: `pep.zeile_pruefen`, `pep.zeile_schreiben` (Task 2). Kopieren benutzt dieselben Prüfungen, lässt aber nach F11 **aus, statt abzubrechen**.
- Produces (intern): `pep.tag_einfuegen(p_filiale_id bigint, p_ziel date, p_bloecke jsonb, p_modus text, p_user_id uuid) → jsonb` mit `p_bloecke = [{mitarbeiter_id, von, bis, bereich_id}]` und Bericht `{ bloecke, unbesetzt, gekuerzt, ausgelassen, ausgeschieden: [name] }`.
- Produces (öffentlich), `p_modus` ∈ `pruefen | ersetzen | leere`, sonst `MODUS_UNGUELTIG`:
  - `pep_tag_kopieren(p_quelle date, p_ziele date[], p_modus text) → jsonb`: höchstens 60 Ziele (`ZU_VIELE_ZIELE`), die Quelle selbst wird aus den Zielen entfernt. `pruefen` schreibt nichts und liefert `{ belegt: [Zieldaten mit Blöcken] }`. `ersetzen` löscht vorher alle Blöcke des Zieltags; `leere` lässt Mitarbeiter aus, die am Zieltag schon Blöcke haben. Antwort `{ tage, bloecke, unbesetzt, gekuerzt, ausgelassen, uebersprungen: [{datum, grund: 'vergangen' | 'geschlossen'}] }`.
  - `pep_woche_kopieren(p_jahr int, p_kw int, p_ziele jsonb, p_modus text) → jsonb` mit `p_ziele = [{jahr, kw}]`: je Wochentag Mo–So auf denselben Wochentag der Ziel-KW; höchstens 12 Ziel-KWs; gleiche Antwortform, summiert.
  - `pep_vorlage_speichern(p_name text, p_art text, p_datum date) → bigint`: `tag` nimmt die Blöcke des Tages, `woche` die der ISO-Woche von `p_datum` mit `wochentag` 1–7 je Block; `daten = [{wochentag | null, mitarbeiter_id, von, bis, bereich_id}]`. Ohne Blöcke → `VORLAGE_LEER`; Name doppelt → `VORLAGE_DOPPELT`; Name leer → `NAME_LEER`.
  - `pep_vorlagen() → jsonb` = `[{id, name, art, angelegt_am, bloecke}]` (lesend).
  - `pep_vorlage_laden(p_id bigint, p_ziel date, p_modus text) → jsonb`: `woche` verlangt einen Montag (`DATUM_UNGUELTIG`). Antwort wie beim Kopieren plus `ausgeschieden` (Namen inaktiver Mitarbeiter; gelöschte als „gelöschter Mitarbeiter“).
  - `pep_vorlage_loeschen(p_id bigint) → void`; fremd oder fehlend → `VORLAGE_NICHT_GEFUNDEN`.
- Produces (UI): `docs/plan-dialoge.js` exportiert `kopierenDialog(kontext)` und `vorlagenDialog(kontext)` mit `kontext = { woche, datum, neuLaden }`. Kopieren-Dialog: „Diesen Tag“ mit Zieldatum oder „alle <Wochentag>e bis <Datum>“; „Diese Woche“ mit Ziel-KW und „die nächsten n Wochen“. Zuerst `pruefen`; sind Ziele belegt, Rückfrage „Ersetzen“ / „Nur leere Zeilen füllen“ / „Abbrechen“. Ergebnis als Meldung, zum Beispiel „5 Tage kopiert: 42 Blöcke, 3 unbesetzt, 1 gekürzt, 2 ausgelassen“.

- [ ] **Step 1: Failing tests** in `tests/kopieren.test.mjs`:
  - `Tag Mo 09.11. → Mo 16.11.: gleiche Blöcke, Bericht bloecke = Anzahl`
  - `Ziel mit U für einen Mitarbeiter → seine Blöcke eingefügt und unbesetzt; Bericht unbesetzt = Anzahl`
  - `Heiligabend Do 24.12.2026 mit Abweichung Rahmen 06:00–14:30: Kopie von Do 10.12. kürzt bis 14:30, verwirft Blöcke ab 14:30, gekuerzt = Anzahl` (Review Focus 4)
  - `vergangenes Ziel und Sonntag → uebersprungen mit grund`
  - `pruefen schreibt nichts und meldet belegte Ziele; leere füllt nur leere Zeilen; ersetzen löscht vorher`
  - `Pflicht-Vorgabe am Ziel (Sa nicht verfügbar) → Block ausgelassen`
  - `Woche KW 46 → KW 47 und KW 48 in einem Aufruf; 13 Ziel-KWs → ZU_VIELE_ZIELE; 61 Zieltage → ZU_VIELE_ZIELE`
  - `Vorlage Woche speichern, Mitarbeiter danach inaktiv, Laden auf KW 48 → ausgeschieden = [Name], übrige Blöcke da`
  - `Vorlage art woche auf einen Dienstag laden → DATUM_UNGUELTIG; leeren Tag speichern → VORLAGE_LEER; doppelter Name → VORLAGE_DOPPELT`
  - `fremde Vorlage laden oder löschen → VORLAGE_NICHT_GEFUNDEN; je Zieltag ein Protokolleintrag`
- [ ] **Step 2:** Run `node --test tests/kopieren.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Umsetzen**: Schema, Rechtetest, Fehlertexte `MODUS_UNGUELTIG`, `ZU_VIELE_ZIELE`, `VORLAGE_LEER`, `VORLAGE_DOPPELT`, `VORLAGE_NICHT_GEFUNDEN`, Dialoge, Knöpfe im Einsatzplan.
- [ ] **Step 4:** `npm test` grün; Vorschau-Daten `pep_vorlagen.json`; Foto `einsatzplan` neu (Knöpfe sichtbar).
- [ ] **Step 5: Commit** `Kopieren und Vorlagen für Tag und Woche`.

---

### Task 7: Krank/ZA-Schnellerfassung und Ersatz finden

**Files:**
- Modify: `supabase/schema.sql` (Abschnitt „Ersatz und Eckdaten“), `tests/rechte.test.mjs`, `docs/hilfe.js`, `docs/plan-dialoge.js`, `docs/einsatzplan.js` (`aktionen.krank`, `aktionen.ersatz`)
- Create: `tests/ersatz.test.mjs`

**Interfaces:**
- Consumes: `pep.abwesenheit_schreiben` (Stufe 0, einziger Schreibweg für Abwesenheiten), `pep.zeile_pruefen`, `pep.zeile_schreiben`, `pep.tag_antwort`, `pep.lage`, `pep.pruefung`.
- Produces:
  - `public.pep_schnell_abwesend(p_mitarbeiter_id bigint, p_code text, p_von date, p_bis date) → jsonb`: `p_code` nur `'KM'` oder `'ZA'` (sonst `CODE_UNGUELTIG`), schreibt mit `quelle = 'schnell'`, auch in der Vergangenheit. Antwort wie `pep_abwesenheit_setzen` (`{ tage, uebersprungen }`). Geplante Blöcke bleiben stehen und werden nach F2 unbesetzt.
  - `public.pep_ersatz_kandidaten(p_mitarbeiter_id bigint, p_datum date) → jsonb` = `{ unbesetzt: [{von, bis, bereich_id}], kandidaten: [{mitarbeiter_id, name, luecke, samstage_monat, spaet_woche, hinweise: [text]}] }`. Ohne unbesetzte Blöcke → `NICHTS_UNBESETZT`. Kandidat ist ein aktiver Mitarbeiter mit Vertrag am Tag, nicht der Abwesende, für den `pep.zeile_pruefen` mit seiner Zeile plus allen unbesetzten Blöcken nicht wirft **und** danach weder `ruhezeit` noch `hoechstarbeitszeit` verletzt wäre. `luecke` = Wochensoll − geplant (F6, vor der Übernahme). Sortierung: `luecke` absteigend, dann `samstage_monat + spaet_woche` aufsteigend, dann Name. `hinweise` = Texte der `vorgabe_bevorzugt`- und `schichtlage`-Hinweise, die mit der Übernahme entstünden.
  - `public.pep_ersatz_uebernehmen(p_mitarbeiter_id bigint, p_datum date, p_ersatz_id bigint) → jsonb`: verschiebt alle unbesetzten Blöcke des Tages auf den Ersatz (Sperren wie beim Malen; bei Verstoß Fehler und keine Änderung) und löscht sie beim Abwesenden. Antwort `pep.tag_antwort(…, [abwesender, ersatz])`.
- Produces (UI): `krankDialog(kontext, mitarbeiterId?, datum?)` mit Mitarbeiter, KM/ZA, von (Vorbelegung gewählter Tag) und bis; `ersatzDialog(kontext, mitarbeiterId, datum)` mit der Kandidatenliste (Name, Lücke, Hinweise), ein Klick übernimmt.

- [ ] **Step 1: Failing tests** in `tests/ersatz.test.mjs`:
  - `KM Mo–Mi über geplanten Blöcken: Blöcke bleiben, unbesetzt = true, Stunden zählen nicht; KM löschen → wieder besetzt`
  - `pep_schnell_abwesend mit 'U' → CODE_UNGUELTIG; geschriebene Zeilen haben quelle = 'schnell'`
  - `Kandidaten: ohne Kassenkompetenz, abwesend, zur Zeit schon geplant, Pflicht nicht verfügbar, Ruhezeit verletzt → jeweils nicht dabei`
  - `Sortierung: größere Lücke zuerst; bei gleicher Lücke weniger Samstage und Spätschichten zuerst`
  - `bevorzugte Vorgabe „nur bis 14:00“ → Kandidat bleibt, hinweise enthält den Text`
  - `uebernehmen: Ersatz hat die Blöcke, der Abwesende keine mehr; danach ersatz_kandidaten → NICHTS_UNBESETZT`
  - `uebernehmen auf einen inzwischen gesperrten Ersatz → Fehler, nichts verschoben`
  - `fremde Filiale → MITARBEITER_NICHT_GEFUNDEN; uebernehmen schreibt Protokoll`
- [ ] **Step 2:** Run `node --test tests/ersatz.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Umsetzen**, Fehlertexte `CODE_UNGUELTIG`, `NICHTS_UNBESETZT`.
- [ ] **Step 4:** `npm test` grün; Foto `einsatzplan` mit unbesetztem Block.
- [ ] **Step 5: Commit** `Krankmeldung, Zeitausgleich und Ersatzsuche im Einsatzplan`.

---

### Task 8: Eckdaten-Fenster

**Files:**
- Modify: `supabase/schema.sql` (Abschnitt „Ersatz und Eckdaten“), `tests/rechte.test.mjs`, `docs/plan-dialoge.js`, `docs/einsatzplan.js` (`aktionen.eckdaten`), `docs/mitarbeiter.js` (Export `waehleMitarbeiter(id)` für den Sprung „Zur Mitarbeiterkarte“)
- Create: `tests/eckdaten.test.mjs`

**Interfaces:**
- Consumes: `pep.lage` (Task 3), F9, Soll-Rechnung wie `pep.woche_kennzahlen`; `krankDialog` (Task 7); `zeigeAnsicht` aus `docs/app.js`.
- Produces: `public.pep_eckdaten(p_mitarbeiter_id bigint, p_datum date) → jsonb`:
  ```
  { mitarbeiter: {id, name, personalnummer, alter},
    vertrag: {vertragsart, wochenstunden} | null,
    kompetenzen: [kuerzel],
    vorgaben: [{pflicht, wochentag, art, von, bis, max_stunden_tag, max_stunden_woche, notiz}],  -- gültig am Datum
    abwesenheiten: [{datum, code, stunden, von, bis}],   -- Montag dieser bis Sonntag nächster Woche
    woche: {soll, geplant},
    samstage: {monat: [{datum, status: 'gearbeitet' | 'frei' | 'abwesend' | 'geschlossen'}], frei_jahr, ziel_jahr, ziel_monat},
    vorwoche: [{datum, lage}], vorwoche_lage: 'frueh' | 'spaet' | null, letzter_samstag_spaet: bool,
    hinweise: [text],     -- „hatte letzte Woche früh – eher spät planen“ bzw. umgekehrt; „letzter Samstag spät“
    kommentar: text | null,
    zeitkonto: null }     -- Anzeige „ab Zeitkonto-Stufe“
  ```
- Produces (UI): `eckdatenDialog(kontext, mitarbeiterId, datum)` mit Knöpfen „Krank melden“ (→ `krankDialog` mit KM vorbelegt), „Zeitausgleich“ (ZA vorbelegt), „Zur Mitarbeiterkarte“. Pflicht-Vorgaben fett.

- [ ] **Step 1: Failing tests** in `tests/eckdaten.test.mjs`: Samstage November 2026 (07., 14., 21., 28.) mit einem gearbeiteten, einem mit U und einem unverplanten → Status `gearbeitet`, `abwesend`, `frei`; `frei_jahr` zählt nur Samstage vor dem Datum; Vorwoche mit drei Frühschichten → `vorwoche_lage = 'frueh'` und Hinweis mit „eher spät planen“; `letzter_samstag_spaet`; nur die am Datum gültigen Vorgaben; ohne Vertrag am Datum `vertrag = null` statt Fehler; fremde Filiale → `MITARBEITER_NICHT_GEFUNDEN`.
- [ ] **Step 2:** Run `node --test tests/eckdaten.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Umsetzen**; Vorschau-Daten `pep_eckdaten.json`.
- [ ] **Step 4:** `npm test` grün.
- [ ] **Step 5: Commit** `Eckdaten-Fenster im Einsatzplan`.

---

### Task 9: Vorausplanung

**Files:**
- Modify: `supabase/schema.sql` (Abschnitt „Vorausplanung“), `tests/rechte.test.mjs`, `docs/main.js`, `docs/index.html` (Platzhalter entfernen), `docs/style.css`
- Create: `docs/vorausplanung.js`, `tests/vorausplanung.test.mjs`

**Interfaces:**
- Consumes: `pep.woche_kennzahlen` (gebaut in Task 2, hier getestet); `oeffneWoche(jahr, kw)` aus `docs/einsatzplan.js` (Task 5).
- Produces: Felder von `pep.woche_kennzahlen` (Spec 10, verbindlich): `{ jahr, kw, montag, planumsatz, stundenleistung, soll, vertragsstunden, abwesend, davon_urlaub, verfuegbar, ueberhang, stundenvorgabe, stundenvorgabe_manuell, vorgabe_quelle, geplant }` mit
  - `stundenleistung` = Wochenwert, sonst Einstellung `stundenleistung_eur_h`;
  - `soll` = `round(planumsatz / stundenleistung * 2) / 2`, NULL ohne Planumsatz;
  - `vertragsstunden` = Summe `wochenstunden` (Vertrag am Montag, sonst erster Vertragstag der Woche) der aktiven Mitarbeiter mit `eintritt ≤ Sonntag` und `austritt` leer oder `≥ Montag`;
  - `abwesend` = Summe der Abwesenheitsstunden dieser Mitarbeiter in der Woche, `davon_urlaub` nur Code `U`;
  - `verfuegbar = vertragsstunden − abwesend`; `ueberhang = verfuegbar − soll` (NULL ohne Soll);
  - `stundenvorgabe` = manuell, sonst Soll, sonst Verfügbar; `vorgabe_quelle` ∈ `manuell | planumsatz | verfuegbar`;
  - `geplant` = Summe der Tagesstunden aller nicht unbesetzten Blöcke (F4).
- Produces: `public.pep_vorausplanung(p_jahr int, p_kw int) → jsonb` = `{ wochen: [6 × kennzahlen] }` ab der angegebenen KW, über den Jahreswechsel. `public.pep_woche_speichern(p_jahr int, p_kw int, p_daten jsonb) → jsonb` (Kennzahlen der Woche): Felder `planumsatz`, `stundenleistung_eur_pro_h`, `stundenvorgabe_manuell` sind jeweils eine Zahl größer 0 (Vorgabe ab 0) oder `null` zum Leeren, sonst `WERT_UNGUELTIG`.
- Produces (UI): Reiter „Vorausplanung“ mit sechs Spalten (KW mit Datum) und den Zeilen aus Spec 10. Eingaben (Planumsatz, Stundenleistung, Vorgabe manuell) speichern beim Verlassen des Feldes. Überhang rot unter 0, grün ab 0. Spaltenkopf springt in den Einsatzplan dieser KW. ◀ ▶ verschiebt um eine Woche.

- [ ] **Step 1: Failing tests** in `tests/vorausplanung.test.mjs`: Planumsatz 60 000 bei 200 €/h → `soll = 300`; 60 050 → `300.5` (300,25 auf halbe Stunden gerundet); ohne Planumsatz `soll = null`, `stundenvorgabe = verfuegbar`, `vorgabe_quelle = 'verfuegbar'`; manuell 250 hat Vorrang; Eintritt am Mittwoch zählt, Austritt in der Vorwoche zählt nicht; `abwesend` und `davon_urlaub`; sechs Wochen ab KW 52/2026 → 52, 53, 1, 2, 3, 4; negativer Planumsatz → `WERT_UNGUELTIG`; `null` leert den Wert; `geplant` ohne unbesetzte Blöcke und ohne Pausen.
- [ ] **Step 2:** Run `node --test tests/vorausplanung.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Umsetzen**; Vorschau-Daten `pep_vorausplanung.json`.
- [ ] **Step 4:** `npm test` grün; Fotos `vorausplanung` 1440×900 und 1024×768.
- [ ] **Step 5: Commit** `Vorausplanung: sechs Wochen mit Soll, Verfügbar und Überhang`.

---

### Task 10: Ausdrucke und Excel

**Files:**
- Modify: `supabase/schema.sql` (Abschnitt „Berichte“), `tests/rechte.test.mjs`, `docs/style.css` (`@media print`, `@page { size: A4 landscape; margin: 10mm }`), `docs/index.html` (`<section id="ansicht-druck" hidden>`), `docs/einsatzplan.js` (`aktionen.drucken`), `docs/abwesenheiten.js` (Knopf „Drucken“ für Monat und Resturlaub)
- Create: `docs/druck-daten.js`, `docs/druck.js`, `docs/xlsx.js` (Kopie von `Urlaubsvertretung/docs/xlsx.js`, Kopfkommentar „Kopie aus Urlaub2027/urlaub docs/xlsx.js, dort pflegen“), `tests/druck-daten.test.mjs`, `tests/berichte.test.mjs`

**Interfaces:**
- Consumes: `pep_einsatzplan_woche` (Tages- und Wochenplan), `pep_abwesenheiten` (Monat), `zeit.js`, `plan-raster.js`.
- Produces: `public.pep_resturlaub(p_jahr int) → jsonb` = `{ jahr, stand, mitarbeiter: [{id, name, personalnummer, wochenstunden, tagesstunden, anspruch, rest_vorjahr, monate: [12 Zahlen], genehmigt, rest, rest_tage}] }`. `stand` = heute; Monatswerte = Stunden des Codes `U` je Monat; `genehmigt` = Summe; `rest = anspruch + rest_vorjahr − genehmigt` (wie die Urlaubsübersicht im Reiter Abwesenheiten); `tagesstunden = wochenstunden ÷ abwesenheit_teiler` mit dem Vertrag am 01.01. des Jahres, sonst dem ersten Vertrag im Jahr; `rest_tage = round(rest / tagesstunden, 2)`.
- Produces in `docs/druck-daten.js` (rein):
  - `tagesplanZeilen(woche, datum)` → `{ zeilen: [{name, zeiten, stunden, kommentar, zellen: [{kuerzel, farbe} | null]}], abwesende: [{name, code}] }`, nur Mitarbeiter mit Blöcken.
  - `wochenplanZeilen(woche)` → `[{name, personalnummer, vertrag, tage: [text × 7], summe, differenz}]`; Tages-Text „07:00–15:30 / 8,00 (P 0:30)“, Abwesenheit „U/6,25“.
  - `monatZeilen(monatsdaten)` und `resturlaubZeilen(daten)`.
- Produces (UI): `druck.js` exportiert `drucke(art, daten)`, baut die Druckansicht in `ansicht-druck`, ruft `window.print()` und stellt danach die vorige Ansicht wieder her; und `exportiereWochenplan(woche)`, das `Wochenplan-KW46-2026.xlsx` herunterlädt (Blob und `a.download` wie `Urlaubsvertretung/docs/admin-hilfe.js` Zeile 110–120). Kopf jeder Druckseite: Filiale, Titel, Zeitraum, „erstellt am <Datum Uhrzeit>“.

- [ ] **Step 1: Failing tests.** `druck-daten`: Block 07:00–15:30 mit Pause 12:00–12:30 → „07:00–15:30 / 8,00 (P 0:30)“; Abwesenheit „U/6,25“; Summe und Differenz zum Vertrag; Tagesplan ohne ungeplante Mitarbeiter, Abwesende in `abwesende`. `berichte`: U im Januar und März → `monate[0]`, `monate[2]`, `rest`, `rest_tage`; ohne Urlaubsjahr `anspruch = 0`; nur Mitarbeiter der eigenen Filiale.
- [ ] **Step 2:** Run `node --test tests/druck-daten.test.mjs tests/berichte.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Umsetzen.**
- [ ] **Step 4: Prüfen.** `npm test` grün. Druckbild als PDF: Chrome `--headless=new --print-to-pdf=tests/vorschau/wochenplan.pdf` auf `/vorschau?ansicht=druck&art=woche` (die Attrappe ruft dafür `drucke` ohne `window.print()` auf; `tests/vorschau/*.pdf` in `.gitignore`). Erwartet: A4 quer, 12 Mitarbeiter auf einer Seite, Kürzel in den Zellen lesbar.
- [ ] **Step 5: Commit** `Ausdrucke: Tagesplan, Wochenplan, Abwesenheitsmonat, Resturlaub, Excel`.

---

### Task 11: Startseite und Dokumentation

**Files:**
- Modify: `supabase/schema.sql` (Abschnitt „Startseite“), `tests/rechte.test.mjs`, `docs/main.js`, `docs/index.html` (Platzhalter „Startseite folgt.“ entfernen), `ANLEITUNG.md`, `README.md`
- Create: `docs/start.js`, `tests/startseite.test.mjs`

**Interfaces:**
- Consumes: `pep.woche_kennzahlen`, `pep.pruefung`, `pep.urlaubswuensche` und `pep.freigabe_zum_wunsch` (Stufe 0), `oeffneWoche` (Task 5).
- Produces: `public.pep_startseite() → jsonb` = `{ heute, abwesend: {anzahl, liste: [{mitarbeiter_id, name, code, von, bis}]}, luecke: {summe, wochen: [{jahr, kw, ueberhang}]}, verstoesse: [{datum, warnungen, hinweise}], offene_wuensche }`. `abwesend` = laufende ISO-Woche, je Mitarbeiter und Code zusammengefasst; `luecke` = nächste 6 Wochen ab der laufenden, nur `ueberhang < 0`; `verstoesse` = heute bis heute + 6, nur Tage mit mindestens einem Eintrag; `offene_wuensche` = Anzahl offener Wünsche von heute bis heute + 365.
- Produces (UI): vier Kacheln mit großer Zahl und Sprung: Abwesende diese Woche → Abwesenheiten; Stunden-Lücke → Vorausplanung; Regelverstöße → Einsatzplan am ersten betroffenen Tag; offene Urlaubswünsche → Abwesenheiten. Eine Kachel ohne Befund zeigt „alles im grünen Bereich“.

- [ ] **Step 1: Failing tests** in `tests/startseite.test.mjs`: Zählungen gegen einen aufgebauten Bestand (2 Abwesende, 1 Woche mit negativem Überhang, Kassenlücke morgen, 1 offener Wunsch über das Urlaubstool-Fixture); Stellvertretung darf lesen, Rolle `mitarbeiter` nicht.
- [ ] **Step 2:** Run `node --test tests/startseite.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Umsetzen**; Vorschau-Daten `pep_startseite.json`; Foto `start`.
- [ ] **Step 4: Doku.** `ANLEITUNG.md`: Abschnitt 3 um „Einsatzplan“, „Vorausplanung“, „Drucken“, „Startseite“ ergänzen; Handprüf-Checkliste um die Punkte aus Task 5–10; „Bekannte Grenzen“ auf Stufe 1 bringen (Reihenfolge per ▲/▼ statt Ziehen; Bedarfsplanung, IST-Erfassung und Zeitkonto folgen). `README.md`: Aufbau um die neuen Module, Abschnitt „Vorschau“ (Server, Daten, Foto), Testanzahl.
- [ ] **Step 5:** `npm test` grün. Namensprüfung: `git grep -n -i` auf jeden Nachnamen aus `privat/stammdaten-aschaffenburg.sql` über das ganze Repo ergibt 0 Treffer. Im Bericht nur „0 Treffer“ nennen, **keine** Namen.
- [ ] **Step 6: Commit** `Startseite mit Kacheln; Anleitung und README für Stufe 1`.

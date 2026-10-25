# PEP Stufe 2 – IST-Erfassung, Zeitkonto und Journal: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Leitung erfasst vergangene Tage als IST (vorbelegt aus dem Plan), bestätigt sie, schließt Wochen ins Zeitkonto ab und kann jedem Mitarbeiter sein Stundenkonto mit lückenlosem Journal zeigen; dazu zwei Nachträge aus Stufe 1.

**Architecture:** Wie Stufe 0/1: alle Regeln in PL/pgSQL im Schema `pep`, Browser ruft nur `public.pep_*`. IST-Blöcke liegen neben den Planblöcken in eigener Tabelle; die Wochenrechnung ist eine interne Funktion; das Journal ist append-only, und Änderungen an abgeschlossenen Wochen bucht ein Trigger automatisch als Korrektur nach. Die Oberfläche erweitert den Einsatzplan um einen IST-Modus (gleiche Malfunktion, andere Aufrufe) und bekommt einen Reiter „Zeitkonto“.

**Tech Stack:** PostgreSQL 15+ (Supabase, PL/pgSQL), ES-Module ohne Build, `node --test` mit PGlite, Browser-Test `tests/browser/` (Chrome über CDP, nachgebautes PostgREST).

**Spec:** `docs/superpowers/specs/2026-10-25-pep-stufe-2-ist-zeitkonto-design.md` (Stufe 2) auf Basis von `docs/superpowers/specs/2026-10-24-pep-stufe-0-1-design.md`.

## Global Constraints

Alle Global Constraints und fachlichen Festlegungen F1–F13 aus `docs/superpowers/plans/2026-10-24-pep-stufe-1-einsatzplan.md` gelten weiter (ein idempotentes `supabase/schema.sql`; nur `public.pep_*` mit `security definer` und `set search_path = ''`; je neue Funktion revoke/grant und Eintrag in `tests/rechte.test.mjs` — lesende in `NUR_LESEN` plus ausdrückliche Ablehnungs-Assertion für Rolle `mitarbeiter` und Leitung ohne Filiale, schreibende mit Dummy-Aufruf mit echten Ids; jeder neue Fehlercode mit Text in `docs/hilfe.js`; `pep.protokolliere` in jeder Schreibfunktion; `pep.heute()`; Halbstunden; F2 „unbesetzt je halbe Stunde“; keine echten Namen; Commit-Abschluss `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; Vorschau-Fotos für Oberflächen). Zusätzlich:
- Arbeit im Worktree `.worktrees/stufe-2`, Branch `stufe-2`, Basis `origin/main` 8000ecb plus die zwei Entwurfs-Commits.
- Umstellungstest gegen ein eingefrorenes Stufe-1-Schema: `tests/fixtures/pep-schema-stufe-1.sql` = `supabase/schema.sql` auf 8000ecb (Kopfkommentar „eingefroren: Stufe 1, main 8000ecb“).
- Der Browser-Test (`node tests/browser/szenarien.mjs`) bleibt nach jeder Oberflächen-Task vollständig grün; Task 9 erweitert ihn.
- Rechte: IST erfassen und bestätigen sowie Zeitkonto ansehen dürfen Leitung und Stellvertretung; Woche abschließen, Startsaldo und manuelle Buchung nur Leitung.
- Testwochen: Stichtag `heute` = 2026-11-16 (Montag KW 47); vergangene Testwoche KW 46 = 09.–15.11.2026; Feiertagswoche für Tests: KW 1/2027 (Mi 06.01.2027 Heilige Drei Könige, Bayern) mit `heute` = 2027-01-11.

## Fachliche Festlegungen dieses Plans

- **G1 Wochenrechnung** je Mitarbeiter m und Woche (Montag `mo`, Tage Mo–So), nur wenn m in der Woche einen Vertrag hat (`pep.wochenvertrag(m, mo)`):
  - *beschäftigte Tage* = Mo–Sa-Tage der Woche mit Vertrag, `eintritt ≤ Tag`, `austritt` leer oder `≥ Tag`;
  - *soll* = `round(wochenstunden × beschäftigte Tage / 6, 2)`;
  - *ist* = Summe `pep.arbeitsstunden(m, Tag, IST-Zeile)` über **bestätigte** Tage (Pause und unbesetzte Abschnitte zählen nicht, F2/F4);
  - *abwesend* = Summe `abwesenheiten.stunden` der Woche mit Code `gutschrift = true`;
  - *feiertag* = Anzahl beschäftigter Tage, an denen `pep.feiertag(f, Tag)` nicht NULL ist **und** `pep.tag_status(f, Tag).geoeffnet = false`, × `round(wochenstunden / feiertag_teiler, 2)`;
  - *summe* = ist + abwesend + feiertag;
  - *diff* (nicht Führung) = summe − soll; *diff* (Vertragsart `fuehrung`) = summe − grenze, wenn summe > grenze; summe − soll, wenn summe < soll; sonst 0; mit grenze = `round(coalesce(zeitkonto_grenze, 42) × beschäftigte Tage / 6, 2)`;
  - *spaet* = IST-Arbeitsstunden (ohne Pause, besetzt) in Halbstunden mit Beginn ≥ `spaet_grenze`, bestätigte Tage;
  - *offene_tage* = Tage ≤ heute der Woche, die geöffnet sind (`tag_status.geoeffnet`), beschäftigt sind, keine ganztägige sperrende Abwesenheit haben und keinen `ist_tage`-Eintrag.
- **G2 Saldo** je Mitarbeiter = Summe aller Journalbuchungen. *saldo_vorwoche* einer Woche W = Summe der Buchungen mit `datum < Montag(W)`; *saldo_aktuell* = saldo_vorwoche + (W abgeschlossen ? Summe der Buchungen mit `datum` in W : diff(W) + Summe der Buchungen mit `datum` in W). Sortiert und verglichen wird immer über Datumswerte, nie über (jahr, kw)-Paare (Jahreswechsel, KW 53).
- **G3 Journal** `pep.zeitkonto_buchungen` (id, filiale_id, mitarbeiter_id, datum date, art `start|woche|korrektur|manuell`, stunden numeric(7,2), saldo_nach numeric(8,2), grund text, angelegt_von uuid, angelegt_am timestamptz). Buchungen der Art `woche` und `korrektur` tragen als `datum` den Montag der Woche. `saldo_nach` = vorheriges `saldo_nach` des Mitarbeiters (höchste id) + stunden, unter `pg_advisory_xact_lock` je Mitarbeiter. Update und Delete wirft `JOURNAL_UNVERAENDERBAR` (Trigger).
- **G4 Abschluss** einer Woche W (`pep.wochen_abschluesse`: filiale_id, montag date, abgeschlossen_am, abgeschlossen_von, primary key (filiale_id, montag)): nur wenn Sonntag(W) < heute (`WOCHE_NICHT_VORBEI`), keine offenen Tage (`IST_OFFEN`), noch nicht abgeschlossen (`WOCHE_GEBUCHT`) und — sobald die Filiale schon einen Abschluss hat — W genau die Woche nach dem letzten Abschluss ist (`VORWOCHE_OFFEN`). Bucht je Mitarbeiter mit Vertrag in W eine Zeile `woche` mit diff (auch 0).
- **G5 Nachbuchen**: Ändert sich danach etwas, das diff(W) einer abgeschlossenen Woche beeinflusst, bucht die Datenbank in derselben Transaktion je betroffenem (Mitarbeiter, Woche) genau eine `korrektur` = diff(W) jetzt − Summe(`woche`+`korrektur` von W), wenn ≠ 0. Auslöser per Trigger (statement-level, Transition-Tabellen; je Ereignis ein eigener Trigger, falls Postgres das verlangt): `ist_bloecke`, `ist_tage`, `abwesenheiten`, `vertraege`, `mitarbeiter` (eintritt/austritt), `tag_abweichungen` (alle Mitarbeiter der Filiale), `abwesenheitscodes` (Spalte gutschrift, alle Wochen mit Abwesenheiten dieses Codes). Grund: `current_setting('pep.grund', true)`, falls gesetzt (IST-Funktionen setzen ihn per `set_config(…, true)`), sonst fester Text je Tabelle („Abwesenheit geändert“, „IST geändert“, „Vertrag geändert“, „Ein-/Austritt geändert“, „Öffnungstag geändert“, „Gutschrift eines Codes geändert“), immer mit „KW <kw>/<isojahr>“ davor.
- **G6 IST-Malen** prüft nur: Datum ≤ heute (`ZUKUNFT`); Vertrag am Tag (`KEIN_VERTRAG`); Mitarbeiter beschäftigt (`MITARBEITER_INAKTIV` wie Stufe 1); Halbstunden (`HALBE_STUNDE`); 04:00 ≤ von < bis ≤ 24:00 (`AUSSERHALB_ZEITRAHMEN`); Bereich der Filiale, aktiv, malbar (`BEREICH_NICHT_GEFUNDEN`, `BEREICH_NICHT_MALBAR`); sperrende Abwesenheit überschneidet neu belegte Zeit (`ABWESEND`, gleiche Halbstunden-Logik wie Stufe 1 über `pep.zeile_aenderungen`); kein Überlappen. Keine Rahmen-, Kompetenz- oder Vorgabenprüfung. Ist der Tag bereits bestätigt, ist `p_grund` Pflicht (`GRUND_FEHLT`).
- **G7 Vorschlag**: Für einen offenen Tag ohne IST-Blöcke ist der Vorschlag die *besetzte* Plan-Zeile (`pep.zeile_teil(m, Tag, false)`). Der erste IST-Strich auf so einem Tag startet von diesem Vorschlag. „Tag bestätigen“ schreibt für jeden offenen, beschäftigten Mitarbeiter ohne IST-Blöcke den Vorschlag als IST und legt `ist_tage` an.
- **G8 IST-Modus der Oberfläche** statt Herauslösen der Malfunktion (Abweichung vom Entwurf Abschnitt 4, meine Wahl): `docs/einsatzplan.js` bekommt einen Modus `plan | ist`; im IST-Modus ruft dieselbe Mal- und Rückgängig-Logik `pep_ist_*` statt `pep_plan_*`, IST-eigene Darstellung liegt in `docs/ist-ansicht.js`. Grund: weniger Umbau an frisch getestetem Code.

## Review Focus

1. **Eintritt oder Austritt mitten in der Woche**: soll und grenze anteilig (G1); ein Mitarbeiter, der Mittwoch eintritt, bekommt kein volles Wochensoll als Minus. Test in Task 3.
2. **Urlaub über zwei abgeschlossene Wochen nachträglich eingetragen**: genau eine Korrektur je Woche und Mitarbeiter, Saldo = Summe des Journals. Test in Task 4.
3. **Feiertag am Samstag und als geöffnet eingestellter Feiertag**: Samstag gibt Gutschrift, geöffneter Feiertag nicht. Test in Task 3.
4. **Saldo über den Jahreswechsel mit KW 53/2026**: saldo_vorwoche von KW 1/2027 enthält KW 53/2026. Test in Task 4.
5. **Zwei Leitungen schließen dieselbe Woche**: zweiter Versuch `WOCHE_GEBUCHT`, keine doppelten `woche`-Zeilen (eindeutiger Index auf (mitarbeiter_id, datum) für art = 'woche'). Test in Task 4.

---

## Dateistruktur

| Pfad | Zuständigkeit | Task |
| --- | --- | --- |
| `supabase/schema.sql` | Abschnitte „Nachträge Stufe 1“, „IST-Erfassung“, „Zeitkonto-Rechnung“, „Journal und Abschluss“, „Berichte Stufe 2“ | 1–4, 8 |
| `tests/fixtures/pep-schema-stufe-1.sql` | eingefrorenes Stufe-1-Schema | 2 |
| `tests/ist.test.mjs`, `tests/zeitkonto.test.mjs`, `tests/journal.test.mjs`, `tests/umstellung.test.mjs` | DB-Tests | 2–4 |
| `docs/einsatzplan.js`, `docs/ist-ansicht.js` | IST-Modus im Einsatzplan | 5 |
| `docs/zeitkonto.js`, `docs/zeitkonto-daten.js` | Reiter Zeitkonto; reine Rechen-/Formatierhilfen | 6 |
| `docs/plan-dialoge.js`, `docs/start.js`, `docs/einstellungen.js` | Eckdaten-Zeitkonto, Kacheln, Code-Gutschrift | 7 |
| `docs/druck.js`, `docs/druck-daten.js` | Wocheneinsatz-IST, Stundenblatt, Journal-Excel | 8 |
| `tests/browser/*`, `tests/vorschau/daten-erzeugen.mjs`, `ANLEITUNG.md`, `README.md` | Browser-Szenarien, Vorschau, Doku | 5–9 |

---

### Task 1: Nachträge aus Stufe 1

**Files:** Modify `supabase/schema.sql` (`public.pep_startseite`, `pep.ersatz_kandidaten`), `tests/startseite.test.mjs`, `tests/ersatz.test.mjs`, `ANLEITUNG.md` (Abschnitte Startseite und Ersatz).

**Interfaces:** Produces unveränderte Signaturen; `pep_startseite().abwesend` zählt nur Abwesenheiten mit Code `sperrt = true` und Code ≠ `'FT'`.

- [ ] **Step 1: Failing tests.** `startseite`: Woche mit U, KM, BS, NV (sperrt false lt. Startset? — Test nimmt den tatsächlichen `sperrt`-Wert aus `pep_einstellungen().codes`), FT und einem selbst angelegten Code „FB“ (sperrt true): `abwesend.anzahl` zählt U, KM, BS, FB, nicht FT und keinen Code mit sperrt = false. `ersatz`: Kandidat mit schon vorher bestehender Ruhezeit-Warnung am Tag, deren Wert die Übernahme nicht verschlechtert → **in** der Liste; Kandidat, dem die Übernahme eine neue Ruhezeit- oder Höchstarbeitszeit-Warnung bringt → nicht in der Liste; Kandidat, dessen bestehende Höchstarbeitszeit-Warnung sich verschärft → nicht in der Liste.
- [ ] **Step 2:** `node --test tests/startseite.test.mjs tests/ersatz.test.mjs` → FAIL.
- [ ] **Step 3: Umsetzen.** Ersatz: Vergleich der Warnungen (`ruhezeit`, `hoechstarbeitszeit`) des Kandidaten vor und nach der Probe; ausgeschlossen wird, wer nachher eine Warnung hat, die vorher nicht da war oder deren Text sich geändert hat (gleiche Art und gleiche Uhrzeit, aber andere Stunden = verschärft).
- [ ] **Step 4:** `npm test` grün; Browser-Test grün.
- [ ] **Step 5: Commit** `Startseite zählt sperrende Abwesenheiten; Ersatz nur bei neuen Verstößen`.

---

### Task 2: Datenbank IST-Erfassung

**Files:** Create `tests/fixtures/pep-schema-stufe-1.sql`, `tests/ist.test.mjs`; Modify `supabase/schema.sql` (Abschnitt „IST-Erfassung“), `tests/umstellung.test.mjs`, `tests/rechte.test.mjs`, `docs/hilfe.js`.

**Interfaces:**
- Produces (Tabellen): `pep.ist_bloecke` (Spalten wie `plan_bloecke`, eigener Überlappungs-Trigger), `pep.ist_tage` (filiale_id, mitarbeiter_id, datum, bestaetigt_am timestamptz default now(), bestaetigt_von uuid, primary key (mitarbeiter_id, datum)); Spalte `pep.abwesenheitscodes.gutschrift boolean not null default true`, Startset und bestehende Filialen: ZA → false (nur wo ZA noch nie geändert wurde, d. h. beim Hinzufügen der Spalte).
- Produces (intern): `pep.ist_zeile_lesen(m bigint, d date) → jsonb`, `pep.ist_vorschlag(m bigint, d date) → jsonb` (G7), `pep.ist_zeile_pruefen(f bigint, m bigint, d date, p_alt jsonb, p_neu jsonb) → void` (G6), `pep.ist_zeile_schreiben(f, m, d, p_bloecke jsonb, p_user uuid) → void` (verschmilzt wie `pep.zeile_schreiben`), `pep.ist_tag_antwort(f bigint, d date, ids bigint[]) → jsonb` = `{ datum, bloecke: [Segment + vorschlag:bool], status: [{mitarbeiter_id, datum, bestaetigt, bestaetigt_am}] }`.
- Produces (öffentlich):
  - `pep_ist_woche(p_jahr int, p_kw int) → jsonb`: gleiche Schlüssel wie `pep_einsatzplan_woche` (tage, bereiche inkl. aller malbaren, mitarbeiter, bloecke, abwesenheiten, kommentare, kennzahlen), dazu `modus: 'ist'`, `pruefung: {}`, `plan_bloecke` (Plan-Segmente der Woche), `status` (wie oben, je beschäftigtem Mitarbeiter und geöffnetem Tag ≤ heute), `bloecke` = IST-Segmente bzw. bei offenen Tagen ohne IST der Vorschlag mit `vorschlag: true`; `tage[].ist_erlaubt` = Tag ≤ heute.
  - `pep_ist_malen(p_mitarbeiter_id bigint, p_datum date, p_von time, p_bis time, p_bereich_id bigint, p_grund text) → jsonb` (= `pep.ist_tag_antwort`); NULL-Bereich radiert.
  - `pep_ist_zeile_setzen(p_mitarbeiter_id bigint, p_datum date, p_bloecke jsonb, p_grund text) → jsonb` (Rückgängig).
  - `pep_ist_bestaetigen(p_datum date, p_mitarbeiter_ids bigint[]) → jsonb` (NULL = alle) = `{ bestaetigt: n }` (G7).
  - Neue Fehlercodes: `ZUKUNFT`, `AUSSERHALB_ZEITRAHMEN`, `GRUND_FEHLT`.

- [ ] **Step 1: Fixture** aus `git show 8000ecb:supabase/schema.sql`; Umstellungstest um „Stufe-1-DB mit Planblöcken → neues Schema zweimal: Daten bleiben, ZA.gutschrift = false, U.gutschrift = true“ erweitern.
- [ ] **Step 2: Failing tests** `tests/ist.test.mjs`: Vorschlag = besetzter Plan (Plan KA 08–16 mit KM 12–16 → Vorschlag 08–12); erster Strich auf offenem Tag startet vom Vorschlag; 05:00–06:00 erlaubt (außerhalb Rahmen), 03:30 → `AUSSERHALB_ZEITRAHMEN`; morgen → `ZUKUNFT`; heute erlaubt; Kompetenz fehlt → trotzdem erlaubt; ganztägig U → `ABWESEND`; bestätigter Tag ohne Grund → `GRUND_FEHLT`, mit Grund erlaubt und Grund im Protokoll; `pep_ist_bestaetigen(Tag, null)` legt für alle offenen Beschäftigten IST aus dem Vorschlag an, zählt sie, lässt ganztägig Abwesende aus, zweiter Aufruf bestätigt 0; Plan bleibt unverändert; `pep_ist_woche` liefert `vorschlag:true` nur für offene Tage ohne IST; Überlappungs-Trigger; fremde Filiale; Stellvertretung darf; Rolle mitarbeiter nicht.
- [ ] **Step 3:** FAIL bestätigen. **Step 4:** umsetzen (Rechtetest, FEHLER-Texte). **Step 5:** `npm test` grün. **Step 6: Commit** `IST-Erfassung: Tabellen, Vorschlag aus dem Plan, Malen, Bestätigen`.

---

### Task 3: Zeitkonto-Rechnung

**Files:** Modify `supabase/schema.sql` (Abschnitt „Zeitkonto-Rechnung“), `tests/rechte.test.mjs`; Create `tests/zeitkonto.test.mjs`.

**Interfaces:**
- Consumes: Task 2 (`ist_tage`, `pep.ist_zeile_lesen`), `pep.wochenvertrag`, `pep.arbeitsstunden`, `pep.feiertag`, `pep.tag_status`, `pep.einstellung`.
- Produces: `pep.zeitkonto_woche(p_mitarbeiter_id bigint, p_montag date) → jsonb` = `{ vertragsart, wochenstunden, soll, grenze, ist, abwesend, feiertag, summe, diff, spaet, offene_tage }` nach G1, oder NULL ohne Vertrag in der Woche.
- Produces: `public.pep_zeitkonto_woche(p_jahr int, p_kw int) → jsonb` = `{ jahr, kw, montag, abgeschlossen: {am, von_name} | null, offene_tage, mitarbeiter: [{id, name, …alle Felder von pep.zeitkonto_woche, saldo_vorwoche, saldo_aktuell, warnung: 'plus'|'minus'|null}] }` nach G2 (Journal aus Task 4: bis dahin sind Saldo-Summen 0, die Funktion liest die Tabelle, die Task 4 anlegt — darum legt diese Task die Tabelle `pep.zeitkonto_buchungen` und `pep.wochen_abschluesse` schon an, Trigger und Buchungsfunktionen folgen in Task 4). Warnung: saldo_aktuell > `zeitkonto_warnfaktor` × wochenstunden → `plus`, < −Faktor × wochenstunden → `minus`.

- [ ] **Step 1: Failing tests** `tests/zeitkonto.test.mjs`, je mit konkreten Zahlen:
  - Vollzeit 37,5, KW 46 an Mo–Fr je 8 h IST bestätigt, Sa frei → ist 40, soll 37,5, diff 2,5.
  - gleiche Woche, Mi nicht bestätigt → ist 32, offene_tage 1.
  - U Mo–Sa (6 × 6,25) → abwesend 37,5, diff 0; ZA Mo (gutschrift false) + 4 × 8 h IST → abwesend 0, diff −5,5.
  - Feiertagswoche KW 1/2027 (Mi 06.01. geschlossen): Feiertag 6,25, soll 37,5; mit Abweichung „geöffnet“ für den 06.01. → Feiertag 0.
  - Feiertag an einem Samstag (Testjahr mit Samstag-Feiertag aus `urlaub.landesfeiertage`, z. B. 26.12.2026) → Gutschrift (Review Focus 3).
  - Eintritt Mi 11.11.2026 → beschäftigte Tage 4, soll 25,0 (Review Focus 1).
  - Führung 42 (wochenstunden 42, grenze 42): summe 45 → diff 3; summe 42 → 0; summe 40 → −2. Führung wochenstunden 37,5, grenze 42: summe 40 → 0; 44 → 2; 35 → −2,5.
  - spaet: IST 14:00–20:00 mit Pause 17:00–17:30 → spaet 2,0 (18–20).
  - `pep_zeitkonto_woche` ohne Buchungen: saldo_vorwoche 0, saldo_aktuell = diff; Warnung plus bei diff > 37,5 (Faktor 1).
  - fremde Filiale; Rolle mitarbeiter → `NUR_LEITUNG`; Stellvertretung darf lesen.
- [ ] **Step 2–5:** FAIL, umsetzen, `npm test` grün, **Commit** `Zeitkonto: Wochenrechnung mit Feiertag, ZA und Führungsgrenze`.

---

### Task 4: Journal, Abschluss und Nachbuchen

**Files:** Modify `supabase/schema.sql` (Abschnitt „Journal und Abschluss“), `tests/rechte.test.mjs`, `docs/hilfe.js`; Create `tests/journal.test.mjs`.

**Interfaces:**
- Consumes: Task 3 (`pep.zeitkonto_woche`, Tabellen).
- Produces (intern): `pep.zeitkonto_buchen(f bigint, m bigint, p_datum date, p_art text, p_stunden numeric, p_grund text) → void` (G3), `pep.zeitkonto_abgleichen(f bigint, p_paare jsonb /* [{mitarbeiter_id, montag}] oder null */, p_ab date, p_grund text) → int` (G5; Anzahl gebuchter Korrekturen), die Auslöse-Trigger aus G5, Append-only-Trigger.
- Produces (öffentlich):
  - `pep_wochenabschluss(p_jahr int, p_kw int) → jsonb` (nur Leitung) = `{ gebucht: n }` (G4).
  - `pep_zeitkonto_buchen(p_mitarbeiter_id bigint, p_art text, p_stunden numeric, p_grund text, p_datum date) → jsonb` (nur Leitung; art `start|manuell`, sonst `ART_UNGUELTIG`; `start` nur als erste Buchung des Mitarbeiters → `START_NICHT_ERSTE`; Grund leer → `GRUND_FEHLT`; stunden 0 oder |stunden| > 999 → `STUNDEN_UNGUELTIG`) = die neue Journalzeile.
  - `pep_zeitkonto_journal(p_mitarbeiter_id bigint, p_von date, p_bis date) → jsonb` (Leitung und Stellvertretung; `p_mitarbeiter_id` NULL = alle) = `[{id, mitarbeiter_id, name, datum, kw, jahr, art, stunden, saldo_nach, grund, angelegt_von_name, angelegt_am}]` nach datum, id.
  - Neue Fehlercodes: `IST_OFFEN`, `VORWOCHE_OFFEN`, `WOCHE_NICHT_VORBEI`, `WOCHE_GEBUCHT`, `JOURNAL_UNVERAENDERBAR`, `START_NICHT_ERSTE`.

- [ ] **Step 1: Failing tests** `tests/journal.test.mjs`:
  - Abschluss KW 46 mit offenen Tagen → `IST_OFFEN`; nach Bestätigen → je Mitarbeiter eine `woche`-Zeile mit diff; saldo_nach fortlaufend; zweiter Abschluss → `WOCHE_GEBUCHT`; KW 48 vor KW 47 → `VORWOCHE_OFFEN`; laufende Woche → `WOCHE_NICHT_VORBEI`.
  - Nach Abschluss: IST-Strich mit Grund „später gegangen“ an einem Tag der KW 46 → genau eine `korrektur` mit Grund „KW 46/2026: später gegangen“ und Differenz; Saldo = Summe der Zeilen.
  - U nachträglich über KW 45 und KW 46 (beide abgeschlossen) → genau eine Korrektur je Woche (Review Focus 2).
  - Vertrag rückwirkend von 37,5 auf 30 ab 01.11. → Korrekturen für die abgeschlossenen Wochen ab dann; Feiertag „geöffnet“ in abgeschlossener Woche → Korrektur für alle Beschäftigten; ZA-Gutschrift umgeschaltet → Korrektur nur für Wochen mit ZA.
  - Änderung ohne Wirkung auf diff (Kommentar, Planblock) → keine Buchung.
  - Update/Delete auf `pep.zeitkonto_buchungen` → `JOURNAL_UNVERAENDERBAR`.
  - Startsaldo +13,75 als erste Buchung; zweiter Start → `START_NICHT_ERSTE`; manuell −4 mit Grund; ohne Grund → `GRUND_FEHLT`; Stellvertretung → `NUR_LEITUNG`.
  - Jahreswechsel: Abschlüsse KW 52, 53/2026, KW 1/2027 → `pep_zeitkonto_woche(2027, 1).mitarbeiter[].saldo_vorwoche` enthält KW 53 (Review Focus 4).
  - Doppelter Abschluss in zwei Sitzungen nacheinander ohne Commit-Zwischenstand ist in PGlite nicht nachstellbar → eindeutiger Teilindex `on pep.zeitkonto_buchungen (mitarbeiter_id, datum) where art = 'woche'` und Test, dass ein direktes zweites Insert scheitert (Review Focus 5).
  - `pep_zeitkonto_journal` gibt laufende Summe und Namen; fremde Filiale nicht.
- [ ] **Step 2–5:** FAIL, umsetzen, `npm test` grün, **Commit** `Zeitkonto: Journal, Wochenabschluss und automatische Korrekturen`.

---

### Task 5: IST-Modus im Einsatzplan

**Files:** Modify `docs/einsatzplan.js`; Create `docs/ist-ansicht.js`; Modify `docs/style.css`, `docs/hilfe.js` (falls neue Texte), `tests/vorschau/daten-erzeugen.mjs` (`pep_ist_woche.json` mit KW 46, bestätigten und offenen Tagen).

**Interfaces:**
- Consumes: `pep_ist_woche`, `pep_ist_malen`, `pep_ist_zeile_setzen`, `pep_ist_bestaetigen` (Task 2).
- Produces: Modus `plan | ist` im Einsatzplan; Export `oeffneIst(jahr, kw, datum)` für Startseite und Zeitkonto (Task 6/7).

Verhalten (G8): Umschalter „Plan | IST“ im Kopf. Vergangene Tage öffnen im IST-Modus, künftige nur im Plan-Modus, heute in beiden. IST-Modus: Raster von min(rahmen_von, frühester Block, 06:00) bis max(rahmen_bis, spätester Block); Knopf „Zeitrahmen erweitern“ zeigt 04:00–24:00. Plan-Segmente als dünne Umrisslinie hinter den IST-Zellen; Vorschlag-Segmente (offen) blass mit gestrichelter Kante; je Zeile Statusfeld „offen“/„bestätigt ✓“ und Abweichung IST−Plan in Stunden; Knopf „Tag bestätigen“ (alle) und je Zeile „✓“; Strich auf bestätigtem Tag öffnet zuerst einen kleinen Dialog „Grund der Änderung“ (Pflicht), der Grund geht mit allen Strichen dieser Zeile und dieses Tages bis zum Tageswechsel mit. Rückgängig über `pep_ist_zeile_setzen` (mit demselben Grund). Seitenleiste im IST-Modus: Tagessummen Plan/IST je Mitarbeiter, offene Zeilen der Woche, keine Regelprüfung. Alle Strich-Warteschlangen- und Wochenwechsel-Regeln aus Stufe 1 gelten unverändert.

- [ ] **Step 1:** Vorschau-Daten erweitern. **Step 2: Umsetzen.** **Step 3: Prüfen:** `npm test` grün; `node --check`; Fotos `einsatzplan?modus=ist` 1440×900 und 1024×768; Browser-Test grün (bestehende Szenarien unverändert). **Step 4: Commit** `Einsatzplan: IST-Modus mit Vorschlag, Bestätigen und Grund`.

---

### Task 6: Reiter Zeitkonto

**Files:** Create `docs/zeitkonto.js`, `docs/zeitkonto-daten.js`, `tests/zeitkonto-daten.test.mjs`; Modify `docs/index.html` (Reiter „Zeitkonto“ nach Einsatzplan, Abschnitt `ansicht-zeitkonto`), `docs/app.js` (Ansichtenliste), `docs/main.js`, `docs/style.css`, `tests/vorschau/daten-erzeugen.mjs`.

**Interfaces:**
- Consumes: `pep_zeitkonto_woche`, `pep_wochenabschluss`, `pep_zeitkonto_journal`, `pep_zeitkonto_buchen` (Task 3/4), `oeffneIst` (Task 5).
- Produces: `reiter.zeitkonto = { zeigen }`, Export `oeffneZeitkonto(jahr, kw, mitarbeiterId?)`; in `docs/zeitkonto-daten.js` (rein): `vorzeichen(n) → '+2,50' | '−1,25' | '0,00'`, `journalZeilen(buchungen) → [{datum, kw, art, stunden, saldo, grund, von}]`, `wochenSumme(mitarbeiter) → { soll, ist, abwesend, feiertag, diff }`.

Oberfläche: KW-Wahl ◀ ▶; Tabelle je Mitarbeiter: Vertrag, Soll, IST, Abwesend, Feiertag, Diff, Saldo Vorwoche, Saldo aktuell (mit Warnsymbol und Farbe), Spätstunden, „n Tage offen“ (Sprung `oeffneIst` auf den ersten offenen Tag); Kopf zeigt „abgeschlossen am … von …“ oder Knopf „Woche buchen“ (nur Leitung, aktiv nur ohne offene Tage; Fehler `VORWOCHE_OFFEN`/`WOCHE_NICHT_VORBEI` als Meldung). Klick auf Namen öffnet das Journal (Dialog): Zeilen mit laufendem Saldo, Knöpfe „Korrektur buchen“ und „Startsaldo“ (nur Leitung, Grund Pflicht, Stunden mit Komma).

- [ ] **Step 1: Failing test** `tests/zeitkonto-daten.test.mjs` (`vorzeichen(2.5) === '+2,50'`, `vorzeichen(-1.25) === '−1,25'`, `vorzeichen(0) === '0,00'`, `journalZeilen` übernimmt saldo_nach und sortiert nach datum, id). **Step 2–4:** FAIL, umsetzen, Fotos `zeitkonto` 1440×900 und 1024×768, Browser-Test grün. **Step 5: Commit** `Reiter Zeitkonto mit Wochenabschluss und Journal`.

---

### Task 7: Zeitkonto in Eckdaten, Startseite und Einstellungen

**Files:** Modify `supabase/schema.sql` (`public.pep_eckdaten`: Feld `zeitkonto` = `{ saldo, stand_montag, warnung }` statt NULL; `public.pep_startseite`: neue Felder `ist_offen` = Anzahl offener Tage bis gestern in den letzten 6 Wochen, mit erstem offenem Datum, und `zeitkonto_auffaellig` = Personen mit Warnung im Saldo der zuletzt abgeschlossenen Woche), `public.pep_einstellungen` und `public.pep_code_speichern` (Feld `gutschrift`), `docs/plan-dialoge.js`, `docs/start.js`, `docs/einstellungen.js`, Tests `eckdaten`, `startseite`, `einstellungen`.

**Interfaces:** Consumes Task 3/4/5/6 (`oeffneIst`, `oeffneZeitkonto`). Produces zwei neue Kacheln „IST offen“ (Sprung `oeffneIst` zum ersten offenen Tag) und „Zeitkonto auffällig“ (Sprung `oeffneZeitkonto`), Haken „Gutschrift im Zeitkonto“ je Code.

- [ ] **Step 1: Failing tests** (Eckdaten zeigt Saldo und Warnung; Startseite zählt offene Tage nur ≤ gestern und nur geöffnete, beschäftigte, nicht ganztägig abwesende; Code-Gutschrift speichern und lesen). **Step 2–4:** FAIL, umsetzen, Fotos `start`, Browser-Test grün. **Step 5: Commit** `Zeitkonto in Eckdaten, Startseite und Code-Einstellungen`.

---

### Task 8: Ausdrucke Stufe 2

**Files:** Modify `supabase/schema.sql` (`public.pep_stundenblatt(p_mitarbeiter_id bigint, p_von date, p_bis date) → jsonb` = `{ von, bis, mitarbeiter: [{id, name, personalnummer, tage: [{datum, anwesend_von, anwesend_bis, pause, abwesend: {code, stunden} | null, arbeitszeit}], wochen: [{montag, soll, ist, abwesend, feiertag, diff, saldo_nach}]}] }`, höchstens 62 Tage → sonst `ZEITRAUM_ZU_LANG`; NULL-Mitarbeiter = alle), `tests/berichte.test.mjs`, `docs/druck.js`, `docs/druck-daten.js`, `tests/druck-daten.test.mjs`, `docs/zeitkonto.js` (Knöpfe „Drucken“, „Journal als Excel“), `docs/einsatzplan.js` (im IST-Modus „Wocheneinsatz-IST drucken“).

**Interfaces:** Consumes `pep_ist_woche`, `pep_zeitkonto_woche`, `pep_zeitkonto_journal`. Produces in `druck-daten.js`: `wochenIstZeilen(istWoche, zeitkontoWoche)`, `stundenblattSeiten(daten)`, `journalTabelle(buchungen)`.

Druckbilder: **Wocheneinsatz-IST** (A4 quer) je Mitarbeiter Soll, je Tag „07:00–15:30 / 8,00 (P 0:30)“ bzw. „U/6,25“, IST-Summe, Spätstunden, Diff, Saldo Vorwoche/aktuell; **Stundenblatt** (A4 hoch, eine Seite je Mitarbeiter): Datum, Anwesend von/bis, Pause, Abwesenheit, Arbeitszeit, Wochensummen mit Saldo; **Journal-Excel** `Zeitkonto-Journal-<von>-<bis>.xlsx`, ein Blatt, Spalten Datum, KW, Mitarbeiter, Art, Stunden, Saldo, Grund, Von.

- [ ] **Step 1: Failing tests** (druck-daten: Zeilentexte mit konkreten Zahlen; berichte: Stundenblatt einer Woche mit IST, U und Feiertag, Zeitraum 63 Tage → `ZEITRAUM_ZU_LANG`, fremde Filiale). **Step 2–4:** FAIL, umsetzen, PDF per Chrome-Druck geprüft (Stundenblatt eine Seite je Person), Browser-Test grün. **Step 5: Commit** `Ausdrucke: Wocheneinsatz-IST, Stundenblatt, Journal als Excel`.

---

### Task 9: Browser-Szenarien, Vorschau und Dokumentation

**Files:** Modify `tests/browser/daten.mjs` (IST- und Zeitkonto-Startdaten), `tests/browser/szenarien.mjs`, `tests/browser/server.mjs` (nur falls neue Funktionen eine Sonderbehandlung brauchen), `ANLEITUNG.md`, `README.md`.

- [ ] **Step 1: Szenarien** (Maus und Tablet): IST-Modus öffnen, Vorschlag sichtbar, Strich auf offenem Tag, Tag bestätigen, Strich auf bestätigtem Tag verlangt Grund, Rückgängig; Zeitkonto: offene Tage verhindern Abschluss, nach Bestätigen „Woche buchen“, Journal zeigt Zeilen, Korrektur nach IST-Änderung erscheint automatisch, Startsaldo, Stellvertretung ohne Buchungsknöpfe; Startseite-Kacheln „IST offen“ und „Zeitkonto auffällig“ springen richtig; Drucke rendern, Journal-Excel ist eine gültige Datei.
- [ ] **Step 2:** Volllauf grün, keine Konsolenfehler; Fotos angesehen.
- [ ] **Step 3: Doku.** ANLEITUNG: Abschnitte „IST-Erfassung“ und „Zeitkonto“ (Ablauf: Tage bestätigen → Woche buchen; Korrekturen; Startsaldo aus tegut eintragen), Handprüf-Punkte, Bekannte Grenzen (kein Zeitzuschlag in Spätzuschlag, Wochen nur in Reihenfolge abschließbar). README: Module, Testanzahl, Umstellung auf Stufe 2 (Schema erneut ausführen).
- [ ] **Step 4:** `npm test` grün, Namensprüfung (0 Treffer echter Namen, nur Zählung). **Step 5: Commit** `Browser-Szenarien und Anleitung für IST und Zeitkonto`.

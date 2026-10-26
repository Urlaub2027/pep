# Lieferung & Bedarf – Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warengruppen mit Minuten je Rolli, Wochenmuster und Tageswerte für Lieferungen; im Einsatzplan nötig/eingeplant/fehlt je Bereich und ein halbautomatischer Vorschlag mit Kandidaten und Eintragen per Klick.

**Architecture:** Fünf neue Tabellen im Schema `pep` mit SECURITY-DEFINER-Funktionen `public.pep_*`. Die Datenbank liefert nur die gültigen Werte (Tag vor Muster). Rechnung und Aufteilung sind reine Browser-Logik in `docs/plan-raster.js`. Die Kandidatensuche teilt sich den Kern mit der bestehenden Ersatzsuche. Eingetragen wird über das bestehende `pep_plan_malen`.

**Tech Stack:** Vanilla-JS-Module (`docs/`), PostgreSQL/Supabase (`supabase/schema.sql`), Tests mit `node --test` und PGlite (`tests/*.test.mjs`), Browser-Test `node tests/browser/szenarien.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-26-pep-lieferung-bedarf-design.md`, vor dem Start lesen. Bei Widersprüchen gilt die Spec.

## Global Constraints

- Arbeit im Worktree `C:\Users\dtn\Documents\PEP\.worktrees\lieferung`, Branch `lieferung`, Basis `origin/main` bb36bcb.
- `supabase/schema.sql` bleibt idempotent: `create table if not exists`, `create or replace`, ein zweiter Lauf ändert nichts. Neue Tabellen stehen **vor** der Zeile `select pep.grundausstattung(id) from pep.filialen;` (~Z. 4735), weil dieser Aufruf sie schon braucht.
- Nur `public.pep_*` ist von außen aufrufbar: `security definer`, `set search_path = ''`. Je neue Funktion `revoke all … from public, anon, authenticated;` und `grant execute … to authenticated;` am Dateiende, mit voller Signatur.
- Jede neue `public.pep_*`-Funktion bekommt einen Eintrag in `tests/rechte.test.mjs`. Lesende kommen in `NUR_LESEN`, schreibende brauchen einen Dummy-Aufruf mit echten Ids, der für `mitarbeiter` und für eine Leitung ohne Filiale abgelehnt wird.
- Jeder neue Fehlercode (`GROSS_MIT_UNTERSTRICH`) bekommt einen Text in `docs/hilfe.js` `FEHLER`. Vorhandene Codes werden wiederverwendet: `WERT_UNGUELTIG`, `HALBE_STUNDE`, `NAME_LEER`, `BEREICH_NICHT_GEFUNDEN`, `VERGANGEN`, `GESCHLOSSEN`, `DATUM_UNGUELTIG`, `ZEITRAUM_UNGUELTIG`.
- Jede Schreibfunktion ruft `pep.protokolliere(filiale, aktion, tabelle, schluessel, vorher, nachher)` auf.
- „Heute“ kommt immer aus `pep.heute()`. Zeiten liegen nur auf :00/:30.
- **Jede neue pep-Tabelle braucht eine Spalte `filiale_id`.** `pep.sicherung_bedingung` wirft sonst „hat keinen Bezug zur Filiale“, und die Sicherung bricht. Deshalb tragen auch die Rollis-Tabellen `filiale_id`, abweichend von der Spec, Abschnitt 8.
- Neue Tabellen gehören in `pep.sicherung_tabellen()` und zwar in Fremdschlüssel-Reihenfolge: `tests/sicherung.test.mjs` prüft das.
- Keine echten Namen in Tests, Beispielen, Commits. Testnamen haben die Form „Test, Vorname“. Den Ordner `privat/` niemals öffnen.
- Commits enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Hilfe-Texte: höchstens 180 Wörter je Ansicht (`tests/hilfe-texte.test.mjs`). `einsatzplan` steht heute bei 178, `einstellungen` bei 179. Wer einen Satz ergänzt, kürzt dafür einen anderen.
- Testdaten: `planGrundlage(db)` aus `tests/helfer.mjs`, `heute` = Mo 2026-11-02, Testwoche KW 46 = 09.–15.11.2026.
- `npm test` und `node tests/browser/szenarien.mjs` bleiben nach jeder Task vollständig grün.

## Festlegungen dieses Plans (Spec präzisiert)

- **L1 Tabellen**, alle mit `alter table … enable row level security`, ohne Policies:
  - `pep.warengruppen` (id identity pk, filiale_id → filialen on delete cascade, name text not null check btrim ≠ '', bereich_id → bereiche not null, minuten int not null check 1–240, aktiv bool default true, position int not null default 0, unique (filiale_id, name)).
  - `pep.liefer_muster` (filiale_id → filialen on delete cascade, wochentag int check 1–7, lkw_zeit time not null, pk (filiale_id, wochentag)).
  - `pep.liefer_muster_rollis` (filiale_id, warengruppe_id → warengruppen on delete cascade, wochentag 1–7, rollis int not null check 0–99, pk (warengruppe_id, wochentag)).
  - `pep.liefer_tag` (filiale_id, datum date, lkw_zeit time not null, pk (filiale_id, datum)).
  - `pep.liefer_tag_rollis` (filiale_id, warengruppe_id → warengruppen on delete cascade, datum, rollis int not null check 0–99, pk (warengruppe_id, datum)).
  - „Zurück auf Muster“ löscht die Tageszeile. Eine Musterzelle mit 0 oder leer löscht die Musterzeile.
- **L2 Gültiger Tag** `pep.lieferung_tag(p_filiale_id bigint, p_datum date) returns jsonb`:
  `{lkw: 'HH:MM'|null, lkw_aus_muster: bool, rollis: [{warengruppe_id, rollis, aus_muster}]}`.
  - LKW: Tageswert, sonst Muster des ISO-Wochentags, sonst null.
  - `rollis`: je **zählende** Warengruppe (aktiv, Bereich aktiv und `art = 'bereich'`), sortiert nach position, id. Wert = Tageswert, sonst Musterwert, sonst 0. `aus_muster` = kein Tageswert gesetzt.
- **L3 Rechnung (Browser)**:
  - nötig je Bereich = `ceil(Σ rollis × minuten / 30) / 2` Stunden.
  - eingeplant = besetzte Planstunden des Bereichs (ohne Pause, ohne unbesetzt) ab `lkw`. Blöcke, die über die LKW-Zeit reichen, zählen nur ab dort. Bei `lkw = null` zählt der ganze Tag.
  - fehlt = max(0, nötig − eingeplant).
- **L4 Aufteilung** `aufteilung(fehlt)`: Varianten für n = 1, 2, 3. Eine Variante verteilt fehlt in halben Stunden möglichst gleich, die größeren Anteile zuerst, und hat keinen Überhang. n = 1 gibt es immer (bei fehlt > 0). n = 2 und n = 3 nur, wenn der kleinste Anteil ≥ 1 h ist.
- **L5 Block** `vorschlagBlock(lkw, anteil, rahmen)`:
  - von = max(lkw ?? rahmen.von, rahmen.von), bis = min(von + anteil, rahmen.bis).
  - Ergebnis `{von, bis}` oder null, wenn von ≥ bis.
  - `rahmen` = `{von, bis}` des Tages aus `woche.tage` (`rahmen_von/rahmen_bis`).
- **L6 Rechte**:
  - Warengruppen und Muster schreiben: nur Leitung (`pep.leitung()`).
  - Tageswerte und Kandidaten: Leitung oder Stellvertretung (`pep.leitung_oder_stellvertretung()`).
  - Lesen über `pep_einstellungen` und `pep_einsatzplan_woche`, wie bisher.

## Review Focus

1. LKW-Zeit so spät, dass der Block über das Rahmenende reicht oder ganz außerhalb liegt: Der Block wird gekürzt, bei leerem Block gibt es keinen Knopf „Vorschlag“ (Task 4 `vorschlagBlock`, Task 6).
2. Der Bereich einer Warengruppe wird deaktiviert: Die Gruppe zählt nirgends mehr (Task 2 Test, Task 5 Hinweis).
3. Die Stellvertretung ändert Tageswerte. Muster und Warengruppen darf sie nicht ändern (Task 1 und Task 2 Tests).
4. Ein ausnahmsweise geöffneter Sonntag ohne Muster: `lkw = null`, Rollis 0, ein Tageswert lässt sich setzen, eingeplant zählt den ganzen Tag (Task 2, Task 4).
5. Zweiter Schema-Lauf und umbenannte oder deaktivierte Startgruppe: „Trockensortiment“ entsteht nicht neu und nicht doppelt (Task 1).

---

### Task 1: Datenbank – Tabellen, Startausstattung, Sicherung, Warengruppen und Muster

**Files:**
- Modify: `supabase/schema.sql` (Tabellen nach `pep.vorlagen` ~Z. 2597; `pep.grundausstattung` ~Z. 258; `public.pep_einstellungen` ~Z. 1038; `pep.sicherung_tabellen` ~Z. 6569; Grants am Ende)
- Modify: `docs/hilfe.js` (FEHLER), `tests/rechte.test.mjs`, `tests/einstellungen.test.mjs` (falls er die Schlüssel von `pep_einstellungen` zählt)
- Create: `tests/lieferung.test.mjs`

**Interfaces:**
- Produces: Tabellen L1.
- Produces: `public.pep_warengruppe_speichern(p_id bigint, p_daten jsonb) returns bigint`, Schlüssel `name, bereich_id, minuten, aktiv, position`.
- Produces: `public.pep_liefer_muster_setzen(p_wochentag int, p_daten jsonb) returns void`, Schlüssel `lkw` ('HH:MM') und/oder `rollis` ({warengruppe_id: zahl|null}).
- Produces: `pep_einstellungen` liefert zusätzlich `warengruppen: [{id, name, bereich_id, minuten, aktiv, position}]` (alle, sortiert position, id) und `liefer_muster: {lkw: {"1": "07:00", …}, rollis: [{warengruppe_id, wochentag, rollis}]}`.
- Fehlercodes neu: `WARENGRUPPE_NICHT_GEFUNDEN`, `WARENGRUPPE_DOPPELT`.

- [ ] **Step 1: Failing tests** in `tests/lieferung.test.mjs` (Aufbau wie `tests/ersatz.test.mjs`, `planGrundlage`):
  - `grundausstattung: Trockensortiment → TS 45 min, LKW Mo–Sa 07:00, keine Rollis`. Erwartet: `warengruppen` = `[{name:'Trockensortiment', bereich_id: bereich.TS, minuten:45, aktiv:true, …}]`, `liefer_muster.lkw` = `{"1":"07:00",…,"6":"07:00"}`, `rollis` = [].
  - `grundausstattung zweimal: nichts doppelt; umbenannte Gruppe kommt nicht zurück`. Gruppe umbenennen, `select pep.grundausstattung(id) from pep.filialen` ausführen, danach genau eine Gruppe mit dem neuen Namen.
  - `warengruppe_speichern: anlegen, ändern, Fehler`:
    - Fehler: `NAME_LEER`, `WARENGRUPPE_DOPPELT`, `BEREICH_NICHT_GEFUNDEN` (Bereich PA, VP oder Fremdfiliale), `WERT_UNGUELTIG` (minuten 0, 241, 2.5), `WARENGRUPPE_NICHT_GEFUNDEN`.
    - Anlegen und Ändern schreiben je eine Protokollzeile.
  - `muster_setzen: LKW und Rollis, 0/null löscht die Zeile, Fehler`:
    - Fehler: `HALBE_STUNDE` ('07:15'), `WERT_UNGUELTIG` (wochentag 8, rollis 100, −1, 2.5).
    - Fremde Warengruppe → `WARENGRUPPE_NICHT_GEFUNDEN`.
  - `Rechte: Stellvertretung darf Warengruppen und Muster nicht` → `NUR_LEITUNG`.
  - `Sicherung enthält die fünf Tabellen`: `pep_sicherung().tabellen` hat die Schlüssel `warengruppen, liefer_muster, liefer_muster_rollis, liefer_tag, liefer_tag_rollis`.
- [ ] **Step 2: Run** `node --test tests/lieferung.test.mjs`. Expected: FAIL (Funktionen fehlen).
- [ ] **Step 3: Implement**
  - Tabellen L1.
  - `grundausstattung`:
    - Gruppe nur, wenn die Filiale noch keine Warengruppe hat **und** ein Bereich `TS` existiert.
    - `liefer_muster` für die Wochentage 1–6 mit `on conflict do nothing`.
  - `sicherung_tabellen`: die fünf Namen direkt nach `'schulferien'`, Reihenfolge wie L1.
  - Setter nach dem Muster von `public.pep_bereich_speichern`. Bereich gültig = gleiche Filiale, `art = 'bereich'`, aktiv.
  - Ganzzahlen mit `jsonb_typeof = 'number'` und `x = trunc(x)` prüfen, sonst `WERT_UNGUELTIG`.
  - FEHLER-Texte: „Diese Warengruppe gibt es nicht (mehr).“ und „Eine Warengruppe mit diesem Namen gibt es schon.“
  - Rechte-Test ergänzen.
- [ ] **Step 4: Run** `npm test`. Expected: alles grün, darunter `sicherung.test.mjs` und `rechte.test.mjs`.
- [ ] **Step 5: Commit** „Lieferung: Tabellen, Warengruppen und Wochenmuster in der Datenbank“.

### Task 2: Datenbank – Tageswerte und Woche

**Files:** Modify `supabase/schema.sql` (`pep.woche_antwort` ~Z. 3137, neue Funktionen nach den Funktionen aus Task 1), `tests/lieferung.test.mjs`, `tests/rechte.test.mjs`.

**Interfaces:**
- Consumes: Tabellen und Setter aus Task 1.
- Produces: `pep.lieferung_tag(p_filiale_id bigint, p_datum date) returns jsonb` (L2).
- Produces: `public.pep_liefer_tag_setzen(p_datum date, p_daten jsonb) returns jsonb`.
  - Schlüssel `lkw` ('HH:MM' oder null = zurück auf Muster) und/oder `rollis` ({warengruppe_id: zahl oder null = Muster}).
  - Nur vorhandene Schlüssel werden geändert. Antwort ist `pep.lieferung_tag` des Tages.
  - Fehler: `DATUM_UNGUELTIG`, `VERGANGEN` (vor heute), `GESCHLOSSEN` (`pep.tag_status` nicht geöffnet), `HALBE_STUNDE`, `WERT_UNGUELTIG`, `WARENGRUPPE_NICHT_GEFUNDEN`.
- Produces: `pep_einsatzplan_woche` (über `pep.woche_antwort`, nur bei `p_ist = false`) liefert zusätzlich:
  - `warengruppen`: die zählenden, `[{id, name, bereich_id, minuten, position}]`,
  - `lieferung`: `{ 'YYYY-MM-DD': pep.lieferung_tag(...) }` für jeden geöffneten Tag der Woche.

- [ ] **Step 1: Failing tests**:
  - `lieferung_tag: Muster, Tageswert schlägt Muster, 0 überschreibt, null zurück auf Muster`. Ablauf:
    1. Muster Di TS = 12, LKW 07:00.
    2. Tag 2026-11-10 TS = 0 → `{rollis:[{…, rollis:0, aus_muster:false}]}`.
    3. TS = null → wieder 12, `aus_muster:true`.
    4. LKW '08:30' → `lkw_aus_muster:false`.
  - `liefer_tag_setzen: Stellvertretung darf; VERGANGEN (2026-11-01); GESCHLOSSEN (So 2026-11-08); HALBE_STUNDE; Protokoll`.
  - `geöffneter Sonntag ohne Muster`: Abweichung `verkaufsoffen` am So 2026-11-15 anlegen → `lieferung['2026-11-15'].lkw = null`, Rollis 0. Ein Tageswert lässt sich setzen.
  - `einsatzplan_woche: lieferung nur für geöffnete Tage; Gruppe mit inaktivem Bereich fehlt in warengruppen und rollis`.
- [ ] **Step 2: Run** `node --test tests/lieferung.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement** die Funktionen und die zwei Schlüssel in `pep.woche_antwort` (neben `kennzahlen`).
- [ ] **Step 4: Run** `npm test`. Expected: grün, `einsatzplan.test.mjs` unverändert grün.
- [ ] **Step 5: Commit** „Lieferung: Tageswerte und Lieferung in der Wochenantwort“.

### Task 3: Datenbank – Kandidaten für einen Bedarfsblock

**Files:** Modify `supabase/schema.sql` (`pep.ersatz_kandidaten` ~Z. 4425), `tests/lieferung.test.mjs`, `tests/rechte.test.mjs` (`NUR_LESEN`).

**Interfaces:**
- Produces: `pep.kandidaten(p_filiale_id bigint, p_datum date, p_bloecke jsonb, p_ausser bigint) returns jsonb`.
  - Kern aus `pep.ersatz_kandidaten` herausgezogen: Schleife mit `zeile_ueberschneidet`/`zeile_pruefen`, Probe mit `PEP01`, Sortierung, `hinweise`.
  - Gibt das Array der Kandidaten zurück. `p_ausser` = Mitarbeiter, der nicht in Frage kommt (oder null).
- `pep.ersatz_kandidaten` ruft danach `pep.kandidaten(…, v_unb, p_mitarbeiter_id)` auf. Verhalten und Antwort bleiben gleich.
- Produces: `public.pep_bedarf_kandidaten(p_datum date, p_bereich_id bigint, p_von time, p_bis time) returns jsonb`.
  - Antwort: `{block: {von, bis, bereich_id}, kandidaten: [{mitarbeiter_id, name, luecke, samstage_monat, spaet_woche, hinweise}]}`.
  - Rechte: Leitung oder Stellvertretung.
  - Fehler: `DATUM_UNGUELTIG`, `VERGANGEN`, `HALBE_STUNDE`, `ZEITRAUM_UNGUELTIG` (von ≥ bis), `BEREICH_NICHT_GEFUNDEN` (nicht eigene Filiale, nicht aktiv oder nicht `art = 'bereich'`).

- [ ] **Step 1: Failing tests**:
  - `bedarf_kandidaten: Kompetenz, Abwesenheit, schon geplant, Sortierung nach offenen Stunden`. Bereich KA (Kompetenz nötig) 07:00–10:00 am 2026-11-10:
    - Kandidat ist, wer KA darf und frei ist.
    - Kein Kandidat: wer kein KA darf, wer Urlaub hat, wer 08:00–09:00 schon geplant ist.
    - Bei zwei Kandidaten steht der mit den meisten offenen Wochenstunden zuerst.
  - `bedarf_kandidaten: neue Höchstarbeitszeit schließt aus`. Wer schon 08:00 bis 18:00 geplant ist, fällt für einen Block 18:00–21:00 heraus.
  - `bedarf_kandidaten: Fehler`, je Code ein Fall.
  - Bestehende `tests/ersatz.test.mjs` unverändert grün (Rückwärtsschutz).
- [ ] **Step 2: Run** `node --test tests/lieferung.test.mjs tests/ersatz.test.mjs`. Expected: neue Tests FAIL, ersatz grün.
- [ ] **Step 3: Implement** den herausgezogenen Kern und die neue Funktion. Die Kommentarzeilen der Ersatzsuche ziehen mit um.
- [ ] **Step 4: Run** `npm test`. Expected: grün.
- [ ] **Step 5: Commit** „Lieferung: Kandidatensuche für einen Bedarfsblock (Kern mit der Ersatzsuche geteilt)“.

### Task 4: Browser-Logik – Bedarf, Aufteilung, Block

**Files:** Modify `docs/plan-raster.js` (bei `bereichsStunden`), `tests/plan-raster.test.mjs`.

**Interfaces:**
- Consumes: Form von `woche.warengruppen` und `woche.lieferung` aus Task 2.
- Produces: `lieferBedarf(woche, datum)` → `{ lkw, lkwAusMuster, gruppen: [{id, name, bereich_id, minuten, rollis, ausMuster}], bereiche: [{bereich_id, noetig, geplant, fehlt}] }`.
  - `bereiche` enthält jeden Bereich mit mindestens einer zählenden Warengruppe, in der Reihenfolge von `woche.bereiche`.
  - Ohne `woche.lieferung[datum]` kommt `{ lkw: null, lkwAusMuster: true, gruppen: [], bereiche: [] }` zurück.
- Produces: `aufteilung(fehlt: number) → number[][]` (L4).
- Produces: `vorschlagBlock(lkw: string|null, anteil: number, rahmen: {von, bis}) → {von, bis}|null` (L5).

- [ ] **Step 1: Failing tests**:
  ```js
  assert.deepEqual(aufteilung(3), [[3], [1.5, 1.5], [1, 1, 1]]);
  assert.deepEqual(aufteilung(2.5), [[2.5], [1.5, 1]]);
  assert.deepEqual(aufteilung(1.5), [[1.5]]);
  assert.deepEqual(aufteilung(0.5), [[0.5]]);
  assert.deepEqual(aufteilung(0), []);
  assert.deepEqual(vorschlagBlock('07:00', 3, { von: '06:00', bis: '21:30' }), { von: '07:00', bis: '10:00' });
  assert.deepEqual(vorschlagBlock('20:00', 3, { von: '06:00', bis: '21:30' }), { von: '20:00', bis: '21:30' });
  assert.equal(vorschlagBlock('21:30', 1, { von: '06:00', bis: '21:30' }), null);
  assert.deepEqual(vorschlagBlock(null, 2, { von: '06:00', bis: '21:30' }), { von: '06:00', bis: '08:00' });
  ```
  `lieferBedarf` mit einer kleinen Woche:
  - TS 45 min × 12 Rollis = 9 h und eine zweite Gruppe „Aktion“ → TS 30 min × 1 Rolli: nötig `9.5`.
  - Ein TS-Block 06:00–10:00 bei LKW 07:00 zählt 3 h, ein TS-Block 12:00–14:00 zählt 2 h, eine Pause im TS-Zeitraum zählt nicht → geplant 5, fehlt 4.5.
  - 7 Rollis × 25 min = 175 min → nötig 3 (aufgerundet).
  - `lkw = null` → der ganze Tag zählt.
  - Kein Lieferungseintrag → leere Liste.
- [ ] **Step 2: Run** `node --test tests/plan-raster.test.mjs`. Expected: FAIL (Export fehlt).
- [ ] **Step 3: Implement** die drei Funktionen. Zeiten mit `minuten`/`uhrzeit` aus `docs/zeit.js` rechnen.
- [ ] **Step 4: Run** `node --test tests/plan-raster.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** „Lieferung: Rechnung nötig/eingeplant/fehlt, Aufteilung und Vorschlagsblock“.

### Task 5: Einstellungen – Unterreiter „Lieferung“ und Kassierleistung

**Files:** Modify `docs/einstellungen.js`, `docs/style.css` (nur falls nötig), `docs/hilfe-texte.js` (`einstellungen`), `ANLEITUNG.md` (Abschnitt Einstellungen), `tests/browser/szenarien.mjs`.

**Interfaces:**
- Consumes: `pep_einstellungen` mit `warengruppen` und `liefer_muster`, dazu `pep_warengruppe_speichern` und `pep_liefer_muster_setzen` (Task 1).
- Produces: `TEILE` erhält nach `bereiche` den Eintrag `['lieferung', 'Lieferung', ['warengruppen', 'liefermuster']]`. `ZEICHNER` erhält `warengruppen: zeichneWarengruppen, liefermuster: zeichneLiefermuster`.

- [ ] **Step 1: Failing browser scenario** „Einstellungen: Lieferung – Warengruppe anlegen, Muster setzen“:
  - Unterreiter wählen und Gruppe „Aktionsware“ → TS, 30 min anlegen.
  - Im Muster Di Rollis 5 und LKW Di 08:00 eintragen.
  - Per `sql()` prüfen: Zeilen in `pep.warengruppen`, `pep.liefer_muster_rollis` (5) und `pep.liefer_muster` (08:00).
  - Die Erklärung der Kassierleistung enthält „noch nicht gebaut“.
- [ ] **Step 2: Run** `node tests/browser/szenarien.mjs "Lieferung"`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Warengruppen: Zeilen wie `zeichneBereiche`, mit Name, Auswahl Bereich (aktive `art = 'bereich'`), Minuten, aktiv und „Anlegen“. Hinweis „Bereich inaktiv – zählt nicht“, wenn der Bereich der Gruppe inaktiv ist.
  - Muster: Tabelle mit Zeilen = aktive Gruppen und Spalten = geöffnete Wochentage aus `daten.rahmen`, erste Zeile LKW-Zeit (Typ time, step 1800). Speichern bei `change`, leere Zelle = 0.
  - Kassierleistung: Erklärung genau „Wirkt erst mit der Kassenplanung (noch nicht gebaut).“
  - Hilfe-Satz und ANLEITUNG ergänzen.
  - Die Stellvertretung sieht alles schreibgeschützt (vorhandenes `eingabe` erledigt das).
- [ ] **Step 4: Run** `npm test` und `node tests/browser/szenarien.mjs`. Expected: alles grün, Foto `fotos/einstellungen-lieferung.png` ansehen.
- [ ] **Step 5: Commit** „Einstellungen: Unterreiter Lieferung; Kassierleistung als noch wirkungslos beschriftet“.

### Task 6: Einsatzplan – Kasten „Lieferung & Bedarf“ und Vorschlag

**Files:** Modify `docs/einsatzplan.js` (`abteilungsBox` ~Z. 918, `zeichneSeite`), `docs/plan-dialoge.js` (neben `ersatzDialog`), `docs/style.css`, `docs/hilfe-texte.js` (`einsatzplan`), `ANLEITUNG.md`, `README.md` (Ausblick: Kassenplanung offen), `tests/browser/szenarien.mjs`.

**Interfaces:**
- Consumes: `lieferBedarf`, `aufteilung`, `vorschlagBlock` (Task 4), `pep_liefer_tag_setzen` (Task 2), `pep_bedarf_kandidaten` (Task 3), `pep_plan_malen` (bestehend).
- Produces: `lieferBox()` ersetzt `abteilungsBox()` in `zeichneSeite`. Neu ist `bedarfDialog(kontext, bereichId)` in `docs/plan-dialoge.js`.

- [ ] **Step 1: Failing browser scenario** „Einsatzplan: Lieferung & Bedarf – Tag überschreiben, Vorschlag eintragen“ (Tag DI = 2026-11-10):
  - Muster TS 12 per `sql()` setzen, danach Seite neu laden (`c.navigiere`, siehe vorhandenes VP-Szenario).
  - Der Kasten zeigt TS „9 h nötig“.
  - Rollis-Feld auf 8 setzen → gelb umrandet, nötig 6 h. Danach „↺ Muster“ → wieder 12.
  - „Vorschlag“ öffnen, 1 Person wählen, ersten Kandidaten „eintragen“. Danach in der DB ein TS-Block ab 07:00 für diese Person, „fehlt“ im Kasten kleiner.
  - Vergangener Tag: Felder `disabled`.
- [ ] **Step 2: Run** `node tests/browser/szenarien.mjs "Lieferung"`. Expected: FAIL.
- [ ] **Step 3: Implement**
  - Kasten:
    - Titel „Lieferung & Bedarf“, Kopf mit LKW-Feld.
    - Je Gruppe ein Rollis-Feld (Abweichung vom Muster = Klasse für gelben Rand) und ein Knopf „↺ Muster“, wenn `ausMuster === false`.
    - Tabelle je Bereich mit nötig, eingeplant, fehlt (rot) oder ✓ (grün). Bereiche ohne Gruppe nur mit „eingeplant“, wie bisher.
    - Knopf „Vorschlag“, wenn fehlt > 0 und `vorschlagBlock` nicht null ist.
    - Ohne zählende Gruppe der Hinweis aus der Spec, Abschnitt 5. Für die Leitung führt er per Link zu Einstellungen → Lieferung.
  - Speichern: `pep_liefer_tag_setzen`, dann `woche.lieferung[datum]` aus der Antwort ersetzen und nur die Seitenleiste neu zeichnen.
  - Dialog:
    - Varianten aus `aufteilung` als Chips, Standard 1 Person.
    - Block aus `vorschlagBlock` mit dem größten Anteil der Variante.
    - Kandidaten über `pep_bedarf_kandidaten`, je Kandidat ein Knopf „HH:MM–HH:MM eintragen“ → `pep_plan_malen`.
    - Danach `kontext.neuLaden()`. Ist für den Bereich noch etwas offen, öffnet sich der Dialog mit dem Rest wieder.
    - Ohne Kandidaten der Text „Niemand frei, der den Bereich darf. Von Hand malen.“
  - Hilfe-Satz (Grenze 180 Wörter), ANLEITUNG-Abschnitt, README-Ausblick.
- [ ] **Step 4: Run** `npm test` und `node tests/browser/szenarien.mjs`. Expected: alles grün, Foto des Kastens ansehen.
- [ ] **Step 5: Commit** „Einsatzplan: Lieferung & Bedarf mit Vorschlag und Eintragen per Klick“.

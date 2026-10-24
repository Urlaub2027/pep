# PEP Stufe 0 – Grundgerüst, Stammdaten, Einstellungen, Abwesenheiten: Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine anmeldepflichtige Web-App, in der die Filialleitung Mitarbeiter, Verträge, Kompetenzen und Wochenvorgaben pflegt, Öffnungs-/Rahmenzeiten und Codes einstellt und Abwesenheiten im Monatsraster setzt, inklusive Freigabe der Urlaubswünsche aus dem Urlaubstool.

**Architecture:** Statische Seite (reines JS, ES-Module, kein Build) spricht ausschließlich `SECURITY DEFINER`-Funktionen `public.pep_*` in derselben Supabase-Datenbank an, in der das Urlaubstool (Schema `urlaub`) liegt. Alle PEP-Tabellen liegen im neuen Schema `pep` mit RLS ohne Policies; Rechte prüft `pep.ich()`/`pep.leitung()`. Jede schreibende Funktion protokolliert in `pep.protokoll`. Tests laufen mit PGlite gegen `supabase/schema.sql`, mit einer eingefrorenen Kopie des Urlaubstool-Schemas als Fixture.

**Tech Stack:** PostgreSQL 15+ (Supabase, PL/pgSQL), HTML/CSS/JavaScript (ES-Module), Node 20+ mit `node --test`, `@electric-sql/pglite`.

**Spec:** `docs/superpowers/specs/2026-10-24-pep-stufe-0-1-design.md` (Abschnitte 1–9 und 15–17; Einsatzplan, Vorausplanung, Druck und Startseite kommen in Folgeplänen).

## Global Constraints

- Projektordner `C:\Users\dtn\Documents\PEP`; Seite in `docs/`, Schema in `supabase/schema.sql`, Tests in `tests/`.
- Kein Framework, kein Build-Schritt, keine Laufzeit-Abhängigkeiten im Browser; einzige Dev-Abhängigkeit `@electric-sql/pglite`.
- `docs/index.html` trägt die CSP `default-src 'none'; script-src 'self'; style-src 'self'; connect-src https://*.supabase.co; img-src data:; base-uri 'none'; form-action 'none'` und `<meta name="robots" content="noindex, nofollow">`.
- `supabase/schema.sql` beginnt mit `begin;`, endet mit `commit;`, ist idempotent (zweimal ausführen = gleicher Zustand) und legt alle Tabellen mit `create table if not exists` im Schema `pep` an; `revoke all on schema pep from public, anon, authenticated;`; jede Tabelle `enable row level security`, keine Policies.
- Nur Funktionen in `public` mit Präfix `pep_` sind aus dem Browser aufrufbar: `security definer`, `set search_path = ''`, je Funktion `revoke all … from public, anon, authenticated; grant execute … to authenticated;`. Funktionen in `pep` sind intern (kein `security definer`).
- Fehler als `raise exception 'CODE'` mit Großbuchstaben-Codes (wie `KEIN_ZUGRIFF` im Urlaubstool); der Browser übersetzt Codes in `docs/hilfe.js`.
- Ändert sich die Parameterliste einer `public.pep_*`-Funktion, steht davor `drop function if exists public.<name>(<alte Typen>);` (Kommentar im Urlaubstool-Schema, Zeile 8–11).
- Jede Tabelle trägt `filiale_id bigint not null references pep.filialen (id) on delete cascade` (außer `filialen`, `benutzer` siehe Task 1).
- Uhrzeiten `time` mit Check `extract(minute from x) in (0, 30)`; Stunden `numeric(5,2)`.
- „Heute“ ist `pep.heute()` = `(now() at time zone 'Europe/Berlin')::date`, nie `current_date`.
- Jede schreibende `pep_*`-Funktion ruft `pep.protokolliere(...)` (Task 1) auf.
- Oberflächentexte Deutsch, deutsche Anführungszeichen „…“ in Texten; Namen von Dateien, Funktionen und Spalten Deutsch, Kleinbuchstaben, Unterstrich.
- Netto-Farben als CSS-Variablen in `docs/style.css`: `--netto-gelb: #FFE500; --netto-rot: #E30613; --schwarz: #111;`. Rot nur für Verstöße/„unbesetzt“, nie als Bereichsfarbe.
- Rechte: lesen dürfen `leitung` und `stellvertretung`; Stammdaten, Einstellungen, Benutzer und Urlaubsfreigabe schreibt nur `leitung`; Abwesenheiten schreiben beide.
- Das Urlaubstool wird nicht verändert. Gelesen wird aus `urlaub` nur über `urlaub.organisatoren`, `urlaub.umfragen`, `urlaub.fragen`, `urlaub.mitarbeiter`, `urlaub.abgaben`, `urlaub.antworten`, die Funktionen `urlaub.antwort_wochen(jsonb)`, `urlaub.antwort_tage(jsonb)`, `urlaub.kalender(bigint)`, `urlaub.landesfeiertage(int, text)`, `urlaub.trim_alles(text)`.
- **Keine personenbezogenen Daten im Repo** (es wird öffentlich): tegut-Reports, Transkript und die Startdatei mit Mitarbeiternamen liegen in `privat/` (gitignored). Tests, Commits, Docs und Code enthalten keine echten Mitarbeiternamen; Testdaten heißen „Test, Anna“ o. ä.
- Arbeit im Worktree `.worktrees/stufe-0` auf dem Branch `stufe-0` (Basis: erster Commit auf `main`, siehe Task 1); Commit nach jedem Task. Commit-Texte Deutsch, erste Zeile ≤ 72 Zeichen, Abschluss `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **Abwesenheit an einem Tag ohne gültigen Vertrag** (Datum vor dem ersten `gueltig_ab`): Erwartung Fehler `KEIN_VERTRAG`, nicht 0 Stunden oder NULL. Test in Task 4.
2. **Monat über einen Jahreswechsel** (`pep_abwesenheiten(2026, 12)` und `(2027, 1)`): KW-Nummern 53/1 nach ISO, Feiertage beider Jahre, Schulferien über den Wechsel. Test in Task 4.
3. **Namen mit Tabs, doppelten Leerzeichen oder anderer Groß-/Kleinschreibung** beim Zuordnungsvorschlag Urlaubstool ↔ PEP (das Urlaubstool hatte genau diesen Fehler, Commit be9ac1f): Vorschlag muss trotzdem treffen. Test in Task 5.
4. **Wiederholung mit `bis_datum` in der Vergangenheit oder länger als 12 Monate**: Fehler `ZEITRAUM_UNGUELTIG` bzw. `ZEITRAUM_ZU_LANG`, keine Teilschreibung. Test in Task 4.
5. **Zweiter Schema-Lauf nach geänderter Funktionssignatur** hinterlässt keine zweite Funktion gleichen Namens: Test zählt Überladungen je `public.pep_*`-Name. Test in Task 1.

---

## Dateistruktur

| Pfad | Zuständigkeit |
| --- | --- |
| `package.json`, `.gitignore`, `README.md`, `ANLEITUNG.md` | Projekt, Einrichtung, Bedienung |
| `supabase/schema.sql` | gesamtes `pep`-Schema und alle Funktionen |
| `privat/stammdaten-aschaffenburg.sql` | Startbestand Mitarbeiter mit echten Namen, **nicht im Repo** (Task 10) |
| `supabase/schulferien-BY.sql` | Schulferien Bayern als Startwerte (Task 10) |
| `tests/helfer.mjs` | PGlite mit Supabase-Rollen, Urlaubstool-Fixture, PEP-Schema, Hilfsfunktionen |
| `tests/fixtures/urlaub-schema.sql` | eingefrorene Kopie von `Urlaub2027/urlaub` `supabase/schema.sql`, Commit `97333f5` |
| `tests/*.test.mjs` | ein Testfile je Task |
| `docs/index.html` | eine Seite, alle Reiter als `<section id="ansicht-…">` |
| `docs/style.css` | Farben, Raster, Formulare |
| `docs/config.js` | Supabase-URL und publishable key (identisch mit dem Urlaubstool) |
| `docs/api.js`, `docs/sitzung.js` | Kopien aus dem Urlaubstool (Kopfkommentar „Kopie aus Urlaub2027/urlaub docs/, dort pflegen“); in `sitzung.js` nur `SCHLUESSEL = 'pep-sitzung'` |
| `docs/hilfe.js` | `$`, `meldung`, `fehlerText`, `element`, Datumsformat |
| `docs/app.js` | Anmeldung, Navigation, Filiale anlegen, lädt die Reiter-Module |
| `docs/kalender.js` | reine Logik: Monatsraster, KW, Zieh-Bereiche (getestet, kein DOM) |
| `docs/mitarbeiter.js` | Reiter Mitarbeiter |
| `docs/einstellungen.js` | Reiter Einstellungen |
| `docs/abwesenheiten.js` | Reiter Abwesenheiten inkl. Wünsche-Freigabe |

---

### Task 1: Projektgerüst, Schema-Basis, Rechte, Protokoll

**Files:**
- Create: `package.json`, `.gitignore` (ergänzen), `tests/helfer.mjs`, `tests/fixtures/urlaub-schema.sql`, `supabase/schema.sql`, `tests/basis.test.mjs`

**Interfaces:**
- Consumes: Urlaubstool-Fixture (`urlaub.organisatoren`, `urlaub.start_einladung()`, Trigger auf `auth.users`).
- Produces:
  - `tests/helfer.mjs`: `neueDatenbank()` (lädt Rollen, `auth.users`, `auth.uid()`, Fixture, dann `supabase/schema.sql` zweimal), `als(db, rolle, userId, sql, params)`, `browser(db, sql, params)`, `organisator(db, benutzername, {gesperrt})` → `user_id` (Zeile in `urlaub.organisatoren` wie im Urlaubstool-Helfer), `pepBenutzer(db, benutzername, rolle = 'leitung', filialeId = null)` → `user_id` (legt Organisator an; `leitung` ohne `filialeId` über `pep.start_leitung(benutzername)`, sonst direkter Insert in `pep.benutzer` mit `filiale_id`), `filiale(db, userId, {name='Netto Aschaffenburg', nummer='2558', bundesland='BY'})` → `filiale_id` (ruft `public.pep_filiale_anlegen` als dieser Benutzer).
  - Tabellen `pep.filialen (id, name, nummer, bundesland, angelegt_am)`, `pep.benutzer (user_id uuid primary key references urlaub.organisatoren on delete cascade, filiale_id bigint null references pep.filialen on delete set null, rolle text check (rolle in ('leitung','stellvertretung','mitarbeiter')), angelegt_am)`, `pep.protokoll (id, filiale_id null, zeit, user_id, aktion, tabelle, schluessel text, vorher jsonb, nachher jsonb)`.
  - `pep.heute() returns date`.
  - `pep.ich() returns pep.benutzer`: Zeile zu `auth.uid()`, deren Organisator nicht `gesperrt` ist; sonst `KEIN_ZUGRIFF`.
  - `pep.leitung() returns pep.benutzer`: wie `ich()`, zusätzlich `rolle = 'leitung'`, sonst `NUR_LEITUNG`.
  - `pep.meine_filiale() returns bigint`: `filiale_id` von `ich()`, sonst `KEINE_FILIALE`.
  - `pep.protokolliere(p_filiale_id bigint, p_aktion text, p_tabelle text, p_schluessel text, p_vorher jsonb, p_nachher jsonb) returns void`.
  - `pep.grundausstattung(p_filiale_id bigint) returns void`: in diesem Task leer; Task 2 und 3 erweitern sie.
  - `pep.start_leitung(p_benutzername text) returns void`: nur per SQL-Editor; legt `pep.benutzer` (rolle leitung, filiale_id null) für den Organisator mit diesem Benutzernamen an; `BENUTZER_NICHT_GEFUNDEN`.
  - `public.pep_ich() returns jsonb`: `{anzeigename, benutzername, rolle, filiale: null | {id, name, nummer, bundesland}}`.
  - `public.pep_filiale_anlegen(p_name text, p_nummer text, p_bundesland text) returns jsonb` (die Filiale wie in `pep_ich().filiale`): nur `leitung` mit `filiale_id is null`; sonst `FILIALE_VORHANDEN`; Bundesland aus `('BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH')`, sonst `BUNDESLAND_UNGUELTIG`; `NAME_LEER` bei leerem Namen (nach `urlaub.trim_alles`); ruft `grundausstattung` und protokolliert.

- [ ] **Step 1: Ersten Commit auf `main` anlegen und Branch `stufe-0` abzweigen**

```bash
cd C:/Users/dtn/Documents/PEP
git add PEP_HANDOFF.md ENTSCHEIDUNGEN.md .gitignore docs/
git commit -m "Übergabe, Entscheidungen, Design und Plan Stufe 0"
git worktree add .worktrees/stufe-0 -b stufe-0
cd .worktrees/stufe-0      # alle weiteren Schritte im Worktree; privat/ dort per Symlink oder Kopie bereitstellen (bleibt gitignored)
```

- [ ] **Step 2: `package.json` und Fixture anlegen**

`package.json`: `"name": "pep"`, `"type": "module"`, `"scripts": {"test": "node --test tests/*.test.mjs"}`, `"devDependencies": {"@electric-sql/pglite": "^0.5.8"}`; `npm install`.
Fixture: `git -C C:/Users/dtn/Documents/Urlaubsvertretung show 97333f5:supabase/schema.sql > tests/fixtures/urlaub-schema.sql`, erste Zeile ergänzen: `-- Eingefrorene Kopie von Urlaub2027/urlaub supabase/schema.sql, Commit 97333f5 (24.10.2026). Nur für Tests.`

- [ ] **Step 3: Failing Tests schreiben (`tests/basis.test.mjs`)**

```js
test('Schema zweimal ausführen ist unschädlich und erzeugt keine Überladungen', async () => {
  // neueDatenbank() hat das Schema bereits zweimal geladen
  const r = await db.query(`select proname, count(*)::int as n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname like 'pep\\_%' group by proname having count(*) > 1`);
  assert.deepEqual(r.rows, []);
});
test('ohne pep.benutzer-Zeile: KEIN_ZUGRIFF', async () => {
  const fremd = await organisator(db, 'fremd');
  await assert.rejects(als(db, 'authenticated', fremd, 'select public.pep_ich()'), /KEIN_ZUGRIFF/);
});
test('gesperrter Organisator: KEIN_ZUGRIFF', ...);           // update urlaub.organisatoren set gesperrt = true
test('anon darf pep_ich nicht aufrufen', async () => {
  await assert.rejects(browser(db, 'select public.pep_ich()'), /permission denied|KEIN_ZUGRIFF/);
});
test('pep_ich ohne Filiale liefert filiale null', ...);     // leitung = await pepBenutzer(db, 'chef')
test('pep_filiale_anlegen setzt Filiale, zweiter Aufruf FILIALE_VORHANDEN', async () => {
  const f = (await als(db, 'authenticated', leitung,
    "select public.pep_filiale_anlegen('Netto Aschaffenburg', '2558', 'BY') as r"))[0].r;
  assert.equal(f.bundesland, 'BY');
  assert.equal((await als(db, 'authenticated', leitung, 'select public.pep_ich() as r'))[0].r.filiale.id, f.id);
  await assert.rejects(als(db, 'authenticated', leitung,
    "select public.pep_filiale_anlegen('X', '1', 'BY')"), /FILIALE_VORHANDEN/);
});
test('Stellvertretung darf keine Filiale anlegen: NUR_LEITUNG', ...);
test('BUNDESLAND_UNGUELTIG und NAME_LEER', ...);           // 'XX' bzw. '  \t '
test('Filiale anlegen schreibt Protokoll', async () => {
  const p = (await db.query("select * from pep.protokoll where tabelle = 'filialen'")).rows;
  assert.equal(p.length, 1); assert.equal(p[0].aktion, 'anlegen'); assert.equal(p[0].user_id, leitung);
});
test('pep.heute() liefert Datum in Europe/Berlin', async () => {
  const r = (await db.query("select pep.heute() = (now() at time zone 'Europe/Berlin')::date as ok")).rows[0];
  assert.equal(r.ok, true);
});
```

- [ ] **Step 4: Tests laufen lassen, Fehlschlag prüfen**

Run: `npm test`
Expected: FAIL (Schema fehlt / Funktionen nicht vorhanden).

- [ ] **Step 5: `tests/helfer.mjs` und `supabase/schema.sql` schreiben**

Helfer nach dem Muster von `Urlaubsvertretung/tests/helfer.mjs` (Rollen, `auth.users`, `auth.uid()`), danach Fixture laden, dann PEP-Schema zweimal. `pepBenutzer` wie oben beschrieben; Stellvertretungen entstehen in Tests nach `filiale()` mit `pepBenutzer(db, 'vize', 'stellvertretung', fil)`.
Schema: Kopfkommentar wie im Urlaubstool (Zweck, Sicherheitsprinzip, Warnung zu Signaturänderungen), dann Tabellen, interne Funktionen, `public.pep_*`, Grants.

- [ ] **Step 6: Tests laufen lassen**

Run: `npm test`
Expected: PASS, alle Tests in `basis.test.mjs`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tests/ supabase/schema.sql
git commit -m "Grundgerüst: Schema pep, Rechteprüfung, Protokoll, Filiale anlegen, Testaufbau"
```

---

### Task 2: Stammdaten (Mitarbeiter, Verträge, Bereiche, Kompetenzen, Wochenvorgaben, Urlaubsjahre)

**Files:**
- Modify: `supabase/schema.sql`
- Test: `tests/stammdaten.test.mjs`

**Interfaces:**
- Consumes: `pep.ich()`, `pep.leitung()`, `pep.meine_filiale()`, `pep.protokolliere`, `pep.grundausstattung` (Task 1).
- Produces:
  - Tabellen: `pep.mitarbeiter (id, filiale_id, name text check (btrim(name) <> ''), personalnummer text null, geburtsdatum date null, aktiv boolean default true, eintritt date null, austritt date null, notiz text, position int, angelegt_am)`; `pep.vertraege (id, mitarbeiter_id, gueltig_ab date, vertragsart text check in ('vollzeit','teilzeit','minijob','azubi','fuehrung'), wochenstunden numeric(5,2) check (> 0 and <= 60), zeitkonto_grenze numeric(5,2) null, unique (mitarbeiter_id, gueltig_ab))`; `pep.urlaubsjahre (mitarbeiter_id, jahr int, anspruch_stunden numeric(6,2), rest_vorjahr_stunden numeric(6,2) default 0, primary key (mitarbeiter_id, jahr))`; `pep.bereiche (id, filiale_id, kuerzel text, name text, farbe text check (farbe ~ '^#[0-9A-Fa-f]{6}$'), art text check in ('bereich','funktion','pause'), kompetenz_noetig boolean default false, aktiv boolean default true, position int, unique (filiale_id, kuerzel))`; `pep.kompetenzen (mitarbeiter_id, bereich_id, primary key)`; `pep.wochenvorgaben (id, mitarbeiter_id, gueltig_von date, gueltig_bis date null, pflicht boolean, wochentag int null check (1..7), art text check in ('nicht_verfuegbar','nur_zwischen'), von time null, bis time null, max_stunden_tag numeric(4,2) null, max_stunden_woche numeric(5,2) null, notiz text)`.
  - `pep.grundausstattung` legt je Filiale die Bereiche an (Reihenfolge = position): `KA Kasse #7FD1FF bereich kompetenz_noetig`, `OG Obst #9BE38A`, `BB Backen #F3C96B`, `TS TroSo #D9B38C`, `MO MoPro #F5F5F5`, `TK TK #B8C4FF`, `FÜ Führung #2E7D4F`, `RE Reinigung #C9C9C9`, `BO Backoffice #AEE0D6`, `PA Pause #555555 art pause`, `PO Post #E6E600 aktiv=false`, `KI Kiosk #FF8C42 aktiv=false`, `GM Getränkemarkt #333333 aktiv=false`, `BE Bedienbäckerei #B5651D aktiv=false`, `VP VP #9A5AD0 art funktion`.
  - `pep.vertrag_am(p_mitarbeiter_id bigint, p_datum date) returns pep.vertraege`: jüngster Vertrag mit `gueltig_ab <= p_datum`; keiner → `KEIN_VERTRAG`.
  - `pep.alter_am(p_mitarbeiter_id bigint, p_datum date) returns int` (null ohne Geburtsdatum).
  - `pep.eigener_mitarbeiter(p_id bigint) returns pep.mitarbeiter`: Zeile der eigenen Filiale, sonst `MITARBEITER_NICHT_GEFUNDEN`.
  - `public.pep_mitarbeiter_liste() returns jsonb`: Array sortiert `aktiv desc, position, name`: `{id, name, personalnummer, aktiv, vertragsart, wochenstunden, kompetenzen: [kuerzel]}` (Vertrag zu `pep.heute()`, Felder null ohne Vertrag).
  - `public.pep_mitarbeiter(p_id bigint) returns jsonb`: alle Spalten + `vertraege` (Array, `gueltig_ab desc`), `kompetenzen` (Array `bereich_id`), `wochenvorgaben` (Array), `urlaubsjahre` (Array).
  - `public.pep_mitarbeiter_speichern(p_id bigint, p_daten jsonb) returns bigint` (leitung; `p_id` null = anlegen; Schlüssel `name, personalnummer, geburtsdatum, aktiv, eintritt, austritt, notiz, position`; `NAME_LEER`; `name` durch `urlaub.trim_alles`).
  - `public.pep_vertrag_speichern(p_mitarbeiter_id bigint, p_daten jsonb) returns bigint` (`{id?, gueltig_ab, vertragsart, wochenstunden, zeitkonto_grenze}`; `VERTRAGSART_UNGUELTIG`, `STUNDEN_UNGUELTIG`, `VERTRAG_DOPPELT` bei gleichem `gueltig_ab`; `zeitkonto_grenze` Standard 42 bei `fuehrung`, sonst null).
  - `public.pep_vertrag_loeschen(p_id bigint) returns void` (`LETZTER_VERTRAG`, wenn es der einzige ist).
  - `public.pep_kompetenz_setzen(p_mitarbeiter_id bigint, p_bereich_id bigint, p_aktiv boolean) returns void` (Bereich muss `art in ('bereich','funktion')` und eigene Filiale sein: `BEREICH_NICHT_GEFUNDEN`).
  - `public.pep_wochenvorgabe_speichern(p_mitarbeiter_id bigint, p_daten jsonb) returns bigint` (`{id?, gueltig_von, gueltig_bis, pflicht, wochentag, art, von, bis, max_stunden_tag, max_stunden_woche, notiz}`; `nur_zwischen` braucht `von < bis`, sonst `ZEITEN_UNGUELTIG`; Minuten nur 0/30: `HALBE_STUNDE`).
  - `public.pep_wochenvorgabe_loeschen(p_id bigint) returns void`.
  - `public.pep_urlaubsjahr_speichern(p_mitarbeiter_id bigint, p_jahr int, p_anspruch numeric, p_rest_vorjahr numeric) returns void` (upsert).
  - `public.pep_bereiche() returns jsonb` (alle Bereiche der Filiale, `position`).

- [ ] **Step 1: Failing Tests schreiben (`tests/stammdaten.test.mjs`)**

```js
before: db, leitung = pepBenutzer('chef'), stellv = pepBenutzer('vize','stellvertretung'), fil = filiale(db, leitung)
test('Grundausstattung legt 15 Bereiche an, KA braucht Kompetenz, PO inaktiv', ...);   // pep_bereiche()
test('Mitarbeiter anlegen, Name wird getrimmt, Liste ohne Vertrag hat vertragsart null', async () => {
  const id = (await als(db,'authenticated',leitung,
    `select public.pep_mitarbeiter_speichern(null, '{"name":"  Test,\\tAnna "}') as r`))[0].r;
  const l = (await als(db,'authenticated',leitung,'select public.pep_mitarbeiter_liste() as r'))[0].r;
  assert.equal(l.find(m => m.id === id).name, 'Test, Anna');
  assert.equal(l.find(m => m.id === id).vertragsart, null);
});
test('NAME_LEER', ...);
test('Stellvertretung darf lesen, nicht schreiben: NUR_LEITUNG', ...);
test('Vertrag: Speichern, vertrag_am, Doppelt, Löschen des letzten', async () => {
  // gueltig_ab 2026-01-01 teilzeit 30 → vertrag_am('2026-06-01').wochenstunden == 30.00
  // zweiter Vertrag 2026-07-01 vollzeit 37.5 → vertrag_am('2026-07-01') == 37.50, ('2026-06-30') == 30.00
  // vertrag_am('2025-12-31') → KEIN_VERTRAG
  // gleiches gueltig_ab erneut → VERTRAG_DOPPELT; pep_vertrag_loeschen beider → zweiter wirft LETZTER_VERTRAG
});
test('fuehrung bekommt zeitkonto_grenze 42, STUNDEN_UNGUELTIG bei 0 und 61, VERTRAGSART_UNGUELTIG', ...);
test('Kompetenz setzen/entfernen, Pause ist nicht wählbar: BEREICH_NICHT_GEFUNDEN', ...);
test('Wochenvorgabe nur_zwischen 14:00–20:00 Pflicht; 14:15 → HALBE_STUNDE; bis<von → ZEITEN_UNGUELTIG', ...);
test('Urlaubsjahr upsert: 2027 225.00, erneut 2027 210.00 → eine Zeile mit 210.00', ...);
test('pep_mitarbeiter liefert vertraege, kompetenzen, wochenvorgaben, urlaubsjahre', ...);
test('fremde Filiale: MITARBEITER_NICHT_GEFUNDEN', ...);  // zweite Filiale mit eigener Leitung
test('alter_am: Geburtstag 2009-03-15 → am 2027-03-14 = 17, am 2027-03-15 = 18', ...);
test('jedes Speichern schreibt Protokoll mit tabelle und schluessel', ...);
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `node --test tests/stammdaten.test.mjs`
Expected: FAIL (Funktionen fehlen).

- [ ] **Step 3: Tabellen, `grundausstattung`-Erweiterung und Funktionen in `supabase/schema.sql` schreiben**

`grundausstattung` fügt Bereiche mit `insert … on conflict (filiale_id, kuerzel) do nothing` ein, damit der zweite Schema-Lauf und ein erneuter Aufruf unschädlich sind.

- [ ] **Step 4: Alle Tests laufen lassen**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql tests/stammdaten.test.mjs
git commit -m "Stammdaten: Mitarbeiter, Verträge, Bereiche, Kompetenzen, Wochenvorgaben, Urlaubsjahre"
```

---

### Task 3: Einstellungen (Rahmen, abweichende Tage, Parameter, Codes, Schulferien, Benutzer, Tagesstatus)

**Files:**
- Modify: `supabase/schema.sql`
- Test: `tests/einstellungen.test.mjs`

**Interfaces:**
- Consumes: Task 1 und 2; `urlaub.landesfeiertage(int, text)`, `urlaub.organisatoren`.
- Produces:
  - Tabellen: `pep.rahmen (filiale_id, wochentag int 1–7, geoeffnet boolean, oeffnung_von time, oeffnung_bis time, rahmen_von time, rahmen_bis time, primary key (filiale_id, wochentag))`; `pep.tag_abweichungen (filiale_id, datum date, art text check in ('feiertag','heiligabend','silvester','vor_feiertag','verkaufsoffen','sonstiges'), geoeffnet boolean, oeffnung_von, oeffnung_bis, rahmen_von, rahmen_bis, name text, primary key (filiale_id, datum))`; `pep.einstellungen (filiale_id, schluessel text, wert jsonb, primary key (filiale_id, schluessel))`; `pep.abwesenheitscodes (id, filiale_id, code text, name text, farbe text, stundenregel text check in ('teiler','tatsaechlich','keine'), sperrt boolean default true, aktiv boolean default true, position int, unique (filiale_id, code))`; `pep.schulferien (id, filiale_id, von date, bis date check (bis >= von), name text)`.
  - `grundausstattung` ergänzt: Rahmen Mo–Sa `geoeffnet, 07:00–20:00, 06:00–21:30`, So `geoeffnet=false`; Codes `U Urlaub #4CAF50 teiler`, `KM Krank #E53935 teiler`, `BS Berufsschule #1E88E5 tatsaechlich`, `ZA Zeitausgleich #F9A825 teiler`, `AF Andere Filiale #1565C0 tatsaechlich`, `BV Berufliche Veranstaltung #3949AB teiler`, `FT Feiertag #8E24AA teiler`, `NV Nicht verfügbar #80CBC4 keine`, `T Termin/Schulung #5C6BC0 tatsaechlich`; Einstellungen (jsonb): `abwesenheit_teiler 6`, `feiertag_teiler 6`, `pause_ab_6h_min 30`, `pause_ab_9h_min 45`, `ruhezeit_h 11`, `ruhezeit_u18_h 12`, `max_tag_h 10`, `max_tag_u18_h 8`, `max_woche_u18_h 40`, `spaet_grenze "18:00"`, `u18_fruehestens "06:00"`, `u18_spaetestens "20:00"`, `freie_samstage_monat 1`, `freie_samstage_jahr 12`, `wochen_toleranz_h 0`, `zeitkonto_warnfaktor 1`, `stundenleistung_eur_h 200`, `kassierleistung_eur_halbe_h 900`. Alle mit `on conflict do nothing`.
  - `pep.einstellung(p_filiale_id bigint, p_schluessel text) returns jsonb` (`EINSTELLUNG_FEHLT`).
  - `pep.feiertag(p_filiale_id bigint, p_datum date) returns text` (Name oder null, über `urlaub.landesfeiertage(extract(year), bundesland)`).
  - `pep.tag_status(p_filiale_id bigint, p_datum date) returns table (geoeffnet boolean, oeffnung_von time, oeffnung_bis time, rahmen_von time, rahmen_bis time, feiertag text, abweichung text)`: Abweichung gewinnt; sonst Feiertag → `geoeffnet=false`, Zeiten null; sonst Rahmen des Wochentags.
  - `public.pep_einstellungen() returns jsonb`: `{filiale, rahmen: [7 Objekte mit wochentag], abweichungen: [...], werte: {schluessel: wert}, codes: [...], bereiche: [...], schulferien: [...], benutzer: [{user_id, benutzername, anzeigename, rolle}]}`.
  - `public.pep_rahmen_speichern(p_wochentag int, p_daten jsonb) returns void` (leitung; `geoeffnet` false erlaubt Zeiten null; sonst `oeffnung_von < oeffnung_bis`, `rahmen_von <= oeffnung_von`, `rahmen_bis >= oeffnung_bis`: `ZEITEN_UNGUELTIG`; Minuten 0/30: `HALBE_STUNDE`).
  - `public.pep_abweichung_speichern(p_datum date, p_daten jsonb) returns void`, `public.pep_abweichung_loeschen(p_datum date) returns void`.
  - `public.pep_einstellung_setzen(p_schluessel text, p_wert jsonb) returns void` (nur bekannte Schlüssel: `EINSTELLUNG_UNBEKANNT`; Zahlen > 0 wo Zahl erwartet: `WERT_UNGUELTIG`).
  - `public.pep_code_speichern(p_id bigint, p_daten jsonb) returns bigint`, `public.pep_bereich_speichern(p_id bigint, p_daten jsonb) returns bigint` (Kürzel 1–3 Zeichen, eindeutig: `KUERZEL_DOPPELT`; `art` nachträglich nicht änderbar: `ART_FEST`).
  - `public.pep_schulferien_speichern(p_id bigint, p_von date, p_bis date, p_name text) returns bigint`, `public.pep_schulferien_loeschen(p_id bigint) returns void`.
  - `public.pep_feiertage(p_jahr int) returns jsonb` (`[{datum, name}]`).
  - `public.pep_benutzer_setzen(p_benutzername text, p_rolle text) returns void` (leitung; sucht `urlaub.organisatoren.benutzername`; legt an oder ändert Rolle; eigene Rolle nicht änderbar: `NICHT_SELBST`; `BENUTZER_NICHT_GEFUNDEN`, `ROLLE_UNGUELTIG` außerhalb `leitung|stellvertretung`).
  - `public.pep_benutzer_entfernen(p_user_id uuid) returns void` (`NICHT_SELBST`).

- [ ] **Step 1: Failing Tests schreiben (`tests/einstellungen.test.mjs`)**

```js
test('Grundausstattung: 7 Rahmen, So geschlossen, 9 Codes, 18 Einstellungen', ...);
test('tag_status: Dienstag 2027-03-02 geöffnet 07:00–20:00 / Rahmen 06:00–21:30', ...);
test('tag_status: Sonntag geschlossen; Karfreitag 2027-03-26 geschlossen mit feiertag "Karfreitag"', ...);
test('Abweichung verkaufsoffener Sonntag 2027-10-03 13:00–18:00 öffnet den Tag', ...);
test('Rahmen: 07:15 → HALBE_STUNDE; Rahmen enger als Öffnung → ZEITEN_UNGUELTIG', ...);
test('Einstellung setzen und lesen; unbekannter Schlüssel → EINSTELLUNG_UNBEKANNT; Teiler 0 → WERT_UNGUELTIG', ...);
test('Code anlegen "SP" und Kürzel doppelt → KUERZEL_DOPPELT; Bereich art ändern → ART_FEST', ...);
test('Schulferien anlegen 2027-08-02..2027-09-13 "Sommerferien", bis<von → Fehler', ...);
test('pep_feiertage(2027) enthält 2027-01-06 Heilige Drei Könige (BY) und nicht 2027-03-08', ...);
test('Benutzer setzen: Organisator "vize" wird stellvertretung, erscheint in pep_einstellungen().benutzer', ...);
test('eigene Rolle ändern → NICHT_SELBST; unbekannter Name → BENUTZER_NICHT_GEFUNDEN; Stellvertretung darf nicht', ...);
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `node --test tests/einstellungen.test.mjs` → FAIL.

- [ ] **Step 3: Tabellen, `grundausstattung`-Erweiterung, `tag_status` und Funktionen schreiben**

- [ ] **Step 4: Alle Tests laufen lassen** → `npm test` PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "Einstellungen: Rahmen, abweichende Tage, Parameter, Codes, Schulferien, Benutzer, Tagesstatus"
```

---

### Task 4: Abwesenheiten (Tage, Stundenregel, Wiederholungen, Monatsdaten, Neuberechnung)

**Files:**
- Modify: `supabase/schema.sql`
- Test: `tests/abwesenheiten.test.mjs`

**Interfaces:**
- Consumes: `pep.vertrag_am`, `pep.tag_status`, `pep.einstellung`, `pep.feiertag`, Codes (Task 2/3).
- Produces:
  - Tabellen: `pep.abwesenheiten (id, filiale_id, mitarbeiter_id, code_id, datum date, stunden numeric(5,2) not null, von time null, bis time null, quelle text check in ('manuell','urlaubstool','schnell','wiederholung'), wiederholung_id bigint null, freigabe_id bigint null, notiz text, angelegt_von uuid, angelegt_am timestamptz, unique (mitarbeiter_id, datum), check ((von is null) = (bis is null)), check (von is null or von < bis))`; `pep.wiederholungen (id, filiale_id, mitarbeiter_id, code_id, wochentag int 1–7, von_datum date, bis_datum date, von time null, bis time null, stunden numeric(5,2) null, notiz text)`.
  - `pep.abwesenheit_stunden(p_mitarbeiter_id bigint, p_datum date, p_code pep.abwesenheitscodes, p_stunden numeric) returns numeric`: `teiler` → `round(vertrag_am(...).wochenstunden / einstellung('abwesenheit_teiler'), 2)`; `tatsaechlich` → `p_stunden` (null → `STUNDEN_FEHLEN`); `keine` → 0.
  - `pep.abwesenheit_schreiben(p_filiale_id bigint, p_mitarbeiter_id bigint, p_code_id bigint, p_von date, p_bis date, p_stunden numeric, p_von_zeit time, p_bis_zeit time, p_quelle text, p_wiederholung_id bigint, p_freigabe_id bigint, p_notiz text, p_user_id uuid) returns jsonb` (`{tage, uebersprungen}`): zerlegt in Tage, überspringt Tage mit `tag_status.geoeffnet = false`, ersetzt vorhandene Zeilen (`on conflict (mitarbeiter_id, datum) do update`), `p_bis < p_von` → `ZEITRAUM_UNGUELTIG`, über 366 Tage → `ZEITRAUM_ZU_LANG`; mit Uhrzeit sind Stunden Pflicht (`STUNDEN_FEHLEN`). Wird von Task 5 wiederverwendet.
  - `public.pep_abwesenheit_setzen(p_mitarbeiter_id bigint, p_code_id bigint, p_von date, p_bis date, p_stunden numeric, p_von_zeit time, p_bis_zeit time, p_notiz text) returns jsonb` (leitung oder stellvertretung; `quelle = 'manuell'`; inaktiver Mitarbeiter → `MITARBEITER_INAKTIV`).
  - `public.pep_abwesenheit_loeschen(p_mitarbeiter_id bigint, p_von date, p_bis date) returns int` (Anzahl gelöschter Tage; Zeilen mit `freigabe_id` werden mitgelöscht und ihre Freigabe auf `abgelehnt` gesetzt — Task 5 ergänzt das).
  - `public.pep_wiederholung_speichern(p_mitarbeiter_id bigint, p_daten jsonb) returns bigint` (`{id?, code_id, wochentag, von_datum, bis_datum, von, bis, stunden, notiz}`; `bis_datum < pep.heute()` → `ZEITRAUM_UNGUELTIG`; `bis_datum > von_datum + 12 Monate` → `ZEITRAUM_ZU_LANG`; löscht künftige Tage (`datum >= pep.heute()`) dieser Wiederholung und erzeugt sie neu ab `greatest(von_datum, pep.heute())`, `quelle = 'wiederholung'`).
  - `public.pep_wiederholung_loeschen(p_id bigint) returns void` (entfernt künftige Tage, vergangene bleiben mit `wiederholung_id = null`).
  - `pep.stunden_neu_berechnen(p_mitarbeiter_id bigint, p_ab date) returns int`: setzt `stunden` neu für Zeilen mit Code `teiler` und `von is null` ab `p_ab`; Protokoll ein Eintrag `aktion = 'neu_berechnet'` mit `nachher = {anzahl, ab}`. Aufruf aus `pep_vertrag_speichern`/`pep_vertrag_loeschen` (Task 2, `p_ab = gueltig_ab` des gespeicherten bzw. gelöschten Vertrags) und aus `pep_einstellung_setzen('abwesenheit_teiler')` für alle Mitarbeiter der Filiale mit `p_ab = '1900-01-01'` (alle Zeilen).
  - `public.pep_abwesenheiten(p_jahr int, p_monat int) returns jsonb`:
    `{tage: [{datum, wochentag (1–7), kw, geoeffnet, feiertag, schulferien (Name|null)}], mitarbeiter: [{id, name, aktiv, wochenstunden, tage: {"YYYY-MM-DD": {id, code, code_id, stunden, von, bis, quelle, freigabe_id, wiederholung_id}}}], summen: {"YYYY-MM-DD": stunden}, codes: [...], wuensche: [], urlaub: [{mitarbeiter_id, anspruch, rest_vorjahr, genehmigt, rest}]}`; `mitarbeiter` nur aktive plus inaktive mit Einträgen im Monat; `urlaub.genehmigt` = Summe U-Stunden im Jahr; `rest = anspruch + rest_vorjahr − genehmigt`.

- [ ] **Step 1: Failing Tests schreiben (`tests/abwesenheiten.test.mjs`)**

```js
// before: Leitung, Filiale BY, drei Mitarbeiter mit Verträgen ab 2026-01-01: anna 37.5, ben 30, cem 20; Code-IDs aus pep_einstellungen().codes
test('Teiler: 37,5 → 6.25; 30 → 5.00; 20 → 3.33', ...);          // je ein Tag KM
test('Woche Mo–So setzen: 6 Tage (So übersprungen), Summe 37.50, uebersprungen 1', ...);  // U 2027-03-01..07
test('Feiertag wird übersprungen: 2027-03-25..2027-03-27 U → 2 Tage (Karfreitag fehlt)', ...);
test('Samstag zählt mit: 2027-03-06 (Sa) U → 1 Tag 6.25', ...);
test('erneut setzen ersetzt: KM über U am selben Tag → eine Zeile mit code KM', ...);
test('BS ohne Stunden → STUNDEN_FEHLEN; BS mit 8 → 8.00; NV → 0.00', ...);
test('mit Uhrzeit 08:00–13:00 und 5 Stunden: von/bis gespeichert; ohne Stunden → STUNDEN_FEHLEN', ...);
test('ZEITRAUM_UNGUELTIG bei bis<von, ZEITRAUM_ZU_LANG bei 367 Tagen', ...);
test('ohne Vertrag am Datum → KEIN_VERTRAG (2025-12-31)', ...);               // Review Focus 1
test('löschen 2027-03-01..07 → 6', ...);
test('Wiederholung BS jeden Dienstag 2027-01-01..2027-06-30 8h: 26 Dienstage, Vergangene nicht', async () => {
  // Alle 26 Dienstage liegen in der Zukunft (heute = Oktober 2026 oder später).
  // bis_datum 2026-01-01 → ZEITRAUM_UNGUELTIG; von 2027-01-01 bis 2028-02-01 → ZEITRAUM_ZU_LANG   // Review Focus 4
});
test('Wiederholung ändern auf Mittwoch: Dienstage weg, Mittwoche da; löschen entfernt künftige', ...);
test('neuer Vertrag ab 2027-03-01 mit 30 h rechnet U-Tage ab März auf 5.00 um, Februar bleibt 6.25; ein Protokolleintrag neu_berechnet', ...);
test('Teiler auf 5 setzen rechnet alle Teiler-Zeilen um (6.25 → 7.50), tatsaechlich-Zeilen bleiben', ...);
test('pep_abwesenheiten(2026,12): 31 Tage, 2026-12-28 hat kw 53, 2026-12-25 feiertag; (2027,1): 2027-01-01 kw 53, 2027-01-04 kw 1', ...);  // Review Focus 2
test('pep_abwesenheiten: Schulferien-Name am Tag, Summen je Datum, urlaub.rest = 225 + 0 − genehmigt', ...);
test('inaktiver Mitarbeiter → MITARBEITER_INAKTIV; Stellvertretung darf setzen', ...);
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen** → FAIL.

- [ ] **Step 3: Tabellen und Funktionen schreiben; `pep_vertrag_speichern`, `pep_vertrag_loeschen`, `pep_einstellung_setzen` um `stunden_neu_berechnen` ergänzen**

- [ ] **Step 4: Alle Tests laufen lassen** → `npm test` PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "Abwesenheiten: Tage mit Stundenregel, Wiederholungen, Monatsdaten, Neuberechnung"
```

---

### Task 5: Urlaubstool-Anbindung (Umfragen, Zuordnung, Wünsche, Freigabe)

**Files:**
- Modify: `supabase/schema.sql`, `tests/helfer.mjs` (Umfrage-Helfer aus dem Urlaubstool übernehmen: `umfrageAnlegen`, `urlaubsfrageId`, neu `umfrageMitarbeiter(db, umfrageId, name)` → `{id, code}` per Insert in `urlaub.mitarbeiter`, `abgeben(db, code, antworten)` → `browser(db, 'select public.umfrage_absenden($1, $2)', [code, JSON.stringify(antworten)])`)
- Test: `tests/urlaubstool.test.mjs`

**Interfaces:**
- Consumes: `pep.abwesenheit_schreiben` (Task 4), `urlaub.*` laut Global Constraints.
- Produces:
  - Tabellen: `pep.urlaub_umfragen (filiale_id, umfrage_id bigint references urlaub.umfragen on delete cascade, primary key)`; `pep.urlaub_zuordnung (urlaub_mitarbeiter_id bigint primary key references urlaub.mitarbeiter on delete cascade, mitarbeiter_id bigint references pep.mitarbeiter on delete cascade, filiale_id)`; `pep.urlaub_freigaben (id, filiale_id, mitarbeiter_id, von date, bis date, status text check in ('offen','genehmigt','abgelehnt'), wunsch jsonb, entschieden_von uuid, entschieden_am timestamptz, notiz text)`. `wunsch` = `{umfrage_id, urlaub_mitarbeiter_id, art: 'kw'|'tag', kw, datum}`.
  - `public.pep_urlaub_umfragen() returns jsonb`: alle `urlaub.umfragen` mit Urlaubswochen-Frage, deren `organisator_id` ein `pep.benutzer` der eigenen Filiale ist: `[{id, titel, jahr, bundesland, frist, aktiv (in urlaub_umfragen), teilnehmer, abgaben}]`.
  - `public.pep_urlaub_umfrage_schalten(p_umfrage_id bigint, p_aktiv boolean) returns void` (leitung; fremde Umfrage → `UMFRAGE_NICHT_GEFUNDEN`).
  - `public.pep_urlaub_zuordnung() returns jsonb`: je Teilnehmer der eingeschalteten Umfragen `{urlaub_mitarbeiter_id, umfrage_id, umfrage_titel, name, mitarbeiter_id, vorschlag_id}`; `vorschlag_id` = PEP-Mitarbeiter mit gleichem Namen nach `lower(regexp_replace(urlaub.trim_alles(name), '\s+', ' ', 'g'))`, nur wenn genau einer passt.
  - `public.pep_urlaub_zuordnung_setzen(p_urlaub_mitarbeiter_id bigint, p_mitarbeiter_id bigint) returns void` (null löst; `MITARBEITER_NICHT_GEFUNDEN`).
  - `pep.urlaubswuensche(p_filiale_id bigint, p_von date, p_bis date) returns table (mitarbeiter_id bigint, umfrage_id bigint, urlaub_mitarbeiter_id bigint, art text, kw int, von date, bis date)`: KW → `montag` aus `urlaub.kalender(umfrage_id)` bis `montag + 5` (Mo–Sa); Tage aus `urlaub.antwort_tage`; nur Teilnehmer mit Zeile in `urlaub.abgaben`; nur Wünsche, die den Zeitraum schneiden.
  - `pep_abwesenheiten` (Task 4) ergänzt: `wuensche: [{mitarbeiter_id, art, kw, von, bis, status ('offen'|'genehmigt'|'abgelehnt'), freigabe_id}]` (Status aus `urlaub_freigaben` mit gleichem `wunsch` (umfrage_id, urlaub_mitarbeiter_id, art, kw/datum)); je Abwesenheit mit `freigabe_id`: `wunsch_geaendert: true`, wenn der Wunsch des Schnappschusses nicht mehr in der Antwort steht.
  - `public.pep_urlaub_freigeben(p_mitarbeiter_id bigint, p_von date, p_bis date, p_wunsch jsonb, p_notiz text) returns bigint` (leitung; legt Freigabe `genehmigt` an und schreibt U-Tage über `abwesenheit_schreiben` mit `quelle = 'urlaubstool'`, `freigabe_id`; Code U = `abwesenheitscodes.code = 'U'`).
  - `public.pep_urlaub_ablehnen(p_mitarbeiter_id bigint, p_wunsch jsonb, p_notiz text) returns bigint` (Freigabe `abgelehnt`, keine Tage).
  - `public.pep_freigabe_zuruecknehmen(p_freigabe_id bigint) returns int` (löscht die U-Tage der Freigabe, setzt `abgelehnt`; Anzahl Tage).
  - `pep_abwesenheit_loeschen` (Task 4) ergänzt: gelöschte Zeilen mit `freigabe_id` setzen ihre Freigabe auf `abgelehnt`, wenn keine Tage mehr übrig sind.

- [ ] **Step 1: Failing Tests schreiben (`tests/urlaubstool.test.mjs`)**

```js
// before: Leitung 'chef' (ist Organisator), Filiale BY, PEP-Mitarbeiter 'Test, Anna' 37.5 h ab 2026-01-01;
// Umfrage 2027 BY von chef; Teilnehmer 'Test,\tAnna' und 'Muster, Ben'; frageId = urlaubsfrageId
test('pep_urlaub_umfragen listet die Umfrage mit teilnehmer 2, abgaben 0; fremde Organisatoren nicht', ...);
test('Umfrage einschalten; Zuordnungsvorschlag trifft trotz Tab und Groß/Klein', async () => {
  const z = ...pep_urlaub_zuordnung();
  assert.equal(z.find(t => t.name.includes('Test')).vorschlag_id, annaId);       // Review Focus 3
  assert.equal(z.find(t => t.name.includes('Muster')).vorschlag_id, null);
});
test('ohne Abgabe keine Wünsche; nach Abgabe [12, "2027-03-05"] zwei Wünsche: KW 12 = 2027-03-22..27, Tag 2027-03-05', ...);
test('pep_abwesenheiten(2027,3).wuensche enthält beide mit status offen', ...);
test('freigeben KW 12 → 6 U-Tage à 6.25 mit quelle urlaubstool; status genehmigt; urlaub.genehmigt 37.50', ...);
test('ablehnen Tag 2027-03-05 → status abgelehnt, keine Abwesenheit', ...);
test('Wunsch geändert: neue Abgabe [13] → Abwesenheiten der KW 12 haben wunsch_geaendert true; KW 13 offen', ...);
test('zuruecknehmen löscht 6 Tage, Freigabe abgelehnt', ...);
test('pep_abwesenheit_loeschen über genehmigte Tage setzt Freigabe auf abgelehnt', ...);
test('Stellvertretung darf nicht freigeben: NUR_LEITUNG; nicht zugeordnete Teilnehmer liefern keine Wünsche', ...);
test('Umfrage im Urlaubstool löschen (org_umfrage_loeschen) bricht nicht: Zuordnung und urlaub_umfragen verschwinden, Freigaben bleiben', ...);
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen** → FAIL.

- [ ] **Step 3: Tabellen und Funktionen schreiben; `pep_abwesenheiten` und `pep_abwesenheit_loeschen` erweitern**

- [ ] **Step 4: Alle Tests laufen lassen** → `npm test` PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "Urlaubstool-Anbindung: Umfragen, Zuordnung, Wünsche, Freigabe"
```

---

### Task 6: Seite, Anmeldung, Navigation, Filiale anlegen

**Files:**
- Create: `docs/index.html`, `docs/style.css`, `docs/config.js`, `docs/api.js`, `docs/sitzung.js`, `docs/hilfe.js`, `docs/app.js`
- Test: `tests/hilfe.test.mjs`

**Interfaces:**
- Consumes: `pep_ich`, `pep_filiale_anlegen`.
- Produces:
  - `docs/hilfe.js`: `$(id)`, `meldung(text, art = 'fehler'|'ok'|'')` (schreibt in `#meldung`, leer = ausblenden), `fehlerText(code)` (Tabelle aller Codes aus Task 1–5 → deutscher Satz; unbekannt → „Unerwarteter Fehler: CODE“), `element(tag, attrs, ...kinder)`, `datumDE(iso)` → `'02.03.2027'`, `stundenDE(n)` → `'6,25'`, `WOCHENTAGE = ['Mo','Di','Mi','Do','Fr','Sa','So']`.
  - `docs/app.js`: `export async function aufruf(funktion, parameter)` (wie `aufruf` in Urlaubstool `admin.js`: `NICHT_ANGEMELDET`/401/`KEIN_ZUGRIFF` → Abmelden mit Meldung), `export function zeigeAnsicht(name)`, `export let ich` (Ergebnis von `pep_ich`), `export const reiter = {}` (Module registrieren `reiter.<name> = { zeigen() }`), `export function aktualisiereIch()`.
  - `docs/index.html`: Kopfzeile in Netto-Gelb mit schwarzem Titel „PEP“ und `#wer`; `<nav id="navigation">` mit Knöpfen `data-ziel` = `start, abwesenheiten, vorausplanung, einsatzplan, mitarbeiter, einstellungen` (Einstellungen nur bei `rolle = 'leitung'`) und „Abmelden“; Sections `ansicht-login` (Formular wie Urlaubstool `admin.html`), `ansicht-filiale` (Name, Nummer, Bundesland-Select mit 16 Ländern, Knopf „Filiale anlegen“), `ansicht-start` (Text „Startseite folgt“), `ansicht-vorausplanung` und `ansicht-einsatzplan` (Text „folgt in Stufe 1“), `ansicht-mitarbeiter`, `ansicht-einstellungen`, `ansicht-abwesenheiten` (leer, Module füllen).
  - Ablauf: Laden → Sitzung vorhanden? `pep_ich` → `filiale` null und `leitung` → `ansicht-filiale`; sonst `ansicht-start`. Kein Token → `ansicht-login`.

- [ ] **Step 1: Failing Tests schreiben (`tests/hilfe.test.mjs`)**

```js
import { fehlerText, datumDE, stundenDE } from '../docs/hilfe.js';
test('fehlerText kennt alle Codes des Schemas', async () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  const codes = [...new Set([...schema.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))];
  for (const c of codes) assert.doesNotMatch(fehlerText(c), /Unerwarteter Fehler/, c);
});
test('datumDE("2027-03-02") = "02.03.2027"; stundenDE(6.25) = "6,25"; stundenDE(5) = "5,00"', ...);
```

- [ ] **Step 2: Test laufen lassen** → FAIL (Modul fehlt).

- [ ] **Step 3: `hilfe.js` schreiben, dann `api.js`/`sitzung.js` kopieren, `config.js` (Werte aus `Urlaubsvertretung/docs/config.js`), `index.html`, `style.css`, `app.js`**

`style.css`: CSS-Variablen aus Global Constraints; Grundlayout (Kopf, Navigation als Reiterleiste mit aktivem Reiter in Netto-Rot unterstrichen, `main` max 1600 px, `.box`, `.feld`, `.meldung`, Tabellen); Schrift `system-ui`.

- [ ] **Step 4: Prüfen**

Run: `npm test` → PASS; `node --check docs/app.js docs/hilfe.js docs/api.js docs/sitzung.js` → keine Ausgabe.
Handprüfung: `cd docs && python -m http.server 8081`, `http://localhost:8081/` öffnen: Login-Maske sichtbar, falsches Passwort zeigt Meldung, nach Anmeldung als Leitung ohne Filiale erscheint „Filiale anlegen“, danach die Reiterleiste. (Supabase-Projekt muss das PEP-Schema bereits haben; sonst Prüfung auf das Erscheinen der Login-Maske und der Meldung `KEINE_VERBINDUNG`-Text beschränken und das im Commit-Text vermerken.)

- [ ] **Step 5: Commit**

```bash
git add docs/ tests/hilfe.test.mjs
git commit -m "Seite: Anmeldung, Navigation, Filiale anlegen, Netto-Farben"
```

---

### Task 7: Reiter Mitarbeiter

**Files:**
- Create: `docs/mitarbeiter.js`
- Modify: `docs/index.html` (Section füllen), `docs/app.js` (Modul importieren), `docs/style.css`

**Interfaces:**
- Consumes: `aufruf`, `reiter`, `hilfe.js`; `pep_mitarbeiter_liste`, `pep_mitarbeiter`, `pep_mitarbeiter_speichern`, `pep_vertrag_speichern/loeschen`, `pep_kompetenz_setzen`, `pep_wochenvorgabe_speichern/loeschen`, `pep_urlaubsjahr_speichern`, `pep_bereiche`.
- Produces: `reiter.mitarbeiter = { zeigen() }`; Ansicht: links Liste (Name, Vertrag, Kürzel-Badges; inaktive am Ende grau; Knopf „Neuer Mitarbeiter“), rechts Karte des gewählten Mitarbeiters mit Abschnitten: Stammdaten (Formular, Speichern), Verträge (Tabelle, Zeile „Neuer Vertrag ab …“, Löschen), Kompetenzen (Haken je Bereich mit `kompetenz_noetig` oder `art = 'funktion'`), Wochenvorgaben (Tabelle, Formular, Pflicht als Haken), Urlaubsjahre (Jahr, Anspruch, Rest Vorjahr). Jedes Speichern ruft die Funktion sofort auf und lädt die Karte neu; Fehlercodes über `meldung(fehlerText(...))`. Schreibende Elemente sind für `stellvertretung` ausgeblendet (`ich.rolle`).

- [ ] **Step 1: Modul und Markup schreiben**

- [ ] **Step 2: Prüfen**

Run: `node --check docs/mitarbeiter.js`; `npm test` → PASS.
Handprüfung mit Supabase: Mitarbeiter „Test, Person“ anlegen, Vertrag 30 h Teilzeit ab 01.01.2026, Kompetenz Kasse setzen, Wochenvorgabe „nie samstags“ (wochentag 6, nicht_verfuegbar, Pflicht), Urlaubsjahr 2027 180 h; Seite neu laden: alles sichtbar. Als Stellvertretung: keine Speichern-Knöpfe.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "Reiter Mitarbeiter: Liste, Karte, Verträge, Kompetenzen, Wochenvorgaben, Urlaubsjahre"
```

---

### Task 8: Reiter Einstellungen

**Files:**
- Create: `docs/einstellungen.js`
- Modify: `docs/index.html`, `docs/app.js`, `docs/style.css`

**Interfaces:**
- Consumes: `pep_einstellungen`, `pep_rahmen_speichern`, `pep_abweichung_speichern/loeschen`, `pep_einstellung_setzen`, `pep_code_speichern`, `pep_bereich_speichern`, `pep_schulferien_speichern/loeschen`, `pep_feiertage`, `pep_benutzer_setzen/entfernen`, `pep_urlaub_umfragen`, `pep_urlaub_umfrage_schalten`, `pep_urlaub_zuordnung`, `pep_urlaub_zuordnung_setzen`.
- Produces: `reiter.einstellungen = { zeigen() }`; eine Seite mit Abschnitten in dieser Reihenfolge: Öffnungs- und Rahmenzeiten (Tabelle 7 Zeilen, Haken „geöffnet“, vier Zeitfelder mit `step="1800"`), Abweichende Tage (Liste mit Jahr-Wahl; gesetzliche Feiertage des Jahres aus `pep_feiertage` erscheinen grau mit Knopf „öffnen …“, der eine Abweichung anlegt), Abteilungen/Bereiche (Tabelle: Kürzel, Name, Farbe `<input type="color">`, aktiv, Kompetenz nötig; neue Zeile), Abwesenheitscodes (Tabelle), Regelparameter (je Schlüssel ein Feld mit Erklärungstext aus einer Tabelle im Modul), Schulferien (Liste, Formular), Urlaubstool (Umfragen mit Haken; Zuordnungstabelle Teilnehmer → Select PEP-Mitarbeiter, Vorschlag vorbelegt und per Knopf „Vorschläge übernehmen“ gesammelt gespeichert), Benutzer (Tabelle, Formular Benutzername + Rolle).

- [ ] **Step 1: Modul und Markup schreiben**

- [ ] **Step 2: Prüfen**

Run: `node --check docs/einstellungen.js`; `npm test` → PASS.
Handprüfung: Samstag auf 07:00–18:00 ändern und neu laden; Feiertag 03.10.2027 auf „geöffnet 13:00–18:00“; Teiler auf 6 belassen, 0 eingeben → Meldung „Der Wert muss größer als 0 sein“; Umfrage einschalten, Vorschläge übernehmen; Benutzer „vize“ als Stellvertretung.

- [ ] **Step 3: Commit**

```bash
git add docs/
git commit -m "Reiter Einstellungen: Zeiten, abweichende Tage, Bereiche, Codes, Parameter, Schulferien, Urlaubstool, Benutzer"
```

---

### Task 9: Reiter Abwesenheiten (Monatsraster, Palette, Ziehen, Wünsche, Seitenleiste)

**Files:**
- Create: `docs/kalender.js`, `docs/abwesenheiten.js`
- Modify: `docs/index.html`, `docs/app.js`, `docs/style.css`
- Test: `tests/kalender.test.mjs`

**Interfaces:**
- Consumes: `pep_abwesenheiten`, `pep_abwesenheit_setzen/loeschen`, `pep_wiederholung_speichern/loeschen`, `pep_urlaub_freigeben/ablehnen`, `pep_freigabe_zuruecknehmen`, `pep_mitarbeiter_liste` (für Wiederholungs-Dialog).
- Produces:
  - `docs/kalender.js` (kein DOM): `export function wochenGruppen(tage)` → `[{kw, tage: [...]}]` aus `pep_abwesenheiten().tage`; `export function ziehBereich(startDatum, endDatum)` → `{von, bis}` sortiert (ISO-Strings); `export function monatVorZurueck(jahr, monat, schritt)` → `{jahr, monat}`; `export function zellenKlasse(tag)` → Array aus `'wochenende' | 'feiertag' | 'schulferien' | 'geschlossen'`; `export function stundenAnzeige(eintrag)` → `'U 6,25'`, mit Uhrzeit `'BS 08–13'`.
  - `reiter.abwesenheiten = { zeigen() }`: Kopf (Monat ◀ ▶, Monatsname, Legende Schulferien/Feiertag), links Palette (Radios: „keine“ + alle aktiven Codes in ihrer Farbe, „Wiederholung …“-Knopf öffnet Dialog für BS), Raster als `<table>` (Zeile je Mitarbeiter, Zelle je Tag mit `data-datum`, Tagessummen-Zeile unten), Pointer-Events: `pointerdown` auf Zelle merkt Start, `pointerover` markiert Bereich derselben Zeile, `pointerup` ruft `pep_abwesenheit_setzen` (Code aus Palette; `keine` → `pep_abwesenheit_loeschen`; Code `tatsaechlich` oder mit Uhrzeit → kleines Dialogfeld für Stunden/von/bis vor dem Speichern), danach Monat neu laden. Wünsche: Zellen mit `wuensche`-Treffer und `status = 'offen'` bekommen Klasse `wunsch` (gestrichelter Rahmen, Text „U?“); Klick öffnet Dialog „Urlaubswunsch KW 12 (22.–27.03.2027)“ mit Feldern von/bis (vorbelegt), Knöpfen Genehmigen/Ablehnen; genehmigte mit `wunsch_geaendert` zeigen ein „!“ mit Tooltip und Knopf „Zurücknehmen“. Rechts Seitenleiste „Urlaub <Jahr>“: je Mitarbeiter Anspruch, genehmigt, offen (Summe offener Wünsche in Stunden = Tage × Teiler-Stunden), Rest.

- [ ] **Step 1: Failing Tests schreiben (`tests/kalender.test.mjs`)**

```js
test('wochenGruppen fasst Tage je kw zusammen und behält die Reihenfolge', ...);
test('ziehBereich("2027-03-10","2027-03-03") → {von:"2027-03-03", bis:"2027-03-10"}', ...);
test('monatVorZurueck(2026,12,+1) → {2027,1}; (2027,1,-1) → {2026,12}', ...);
test('zellenKlasse: So → wochenende+geschlossen; Feiertag → feiertag+geschlossen; Schulferien → schulferien', ...);
test('stundenAnzeige({code:"U",stunden:6.25}) = "U 6,25"; mit von 08:00 bis 13:00 → "BS 08–13"', ...);
```

- [ ] **Step 2: Test laufen lassen** → FAIL.

- [ ] **Step 3: `kalender.js` schreiben** → `node --test tests/kalender.test.mjs` PASS.

- [ ] **Step 4: `abwesenheiten.js`, Markup und CSS schreiben**

Zellen 26 px breit, Code-Kürzel plus Stunden klein darunter; Farben aus `codes[].farbe` als Inline-Style; abwesende Wochenenden/Feiertage grau; Schulferien hellgrün hinterlegt wie tegut.

- [ ] **Step 5: Prüfen**

Run: `node --check docs/abwesenheiten.js`; `npm test` → PASS.
Handprüfung: Monat März 2027: U über Mo–So ziehen → 6 Zellen „U 6,25“, Sonntag leer; KM über U → Zelle wird KM; BS-Wiederholung Dienstag bis 30.06. → Dienstage „BS 8,00“; Wunsch „U?“ genehmigen → Zellen voll; im Urlaubstool Antwort ändern → „!“ erscheint; Zurücknehmen leert die Zellen.

- [ ] **Step 6: Commit**

```bash
git add docs/ tests/kalender.test.mjs
git commit -m "Reiter Abwesenheiten: Monatsraster, Palette, Ziehen, Wiederholungen, Wünsche-Freigabe"
```

---

### Task 10: Startbestand, Schulferien, Anleitung, README

**Files:**
- Create: `privat/stammdaten-aschaffenburg.sql` (gitignored), `supabase/schulferien-BY.sql`, `ANLEITUNG.md`, `README.md`
- Test: `tests/startbestand.test.mjs`

**Interfaces:**
- Consumes: Tabellen aus Task 2–3.
- Produces:
  - `privat/stammdaten-aschaffenburg.sql` (nicht committen): `do $$ … $$` Block, der die Filiale mit `nummer = '2558'` sucht (Fehler `FILIALE_FEHLT`, wenn keine) und je Person per `insert … where not exists (gleicher Name in dieser Filiale)` anlegt, mit Vertrag `gueltig_ab = '2026-01-01'`. Namen und Vertragsstunden kommen aus `privat/tegut/report-einsatzplanung-2.pdf` (Spalte „Vertr.-Std.“) und `privat/tegut/report-abwesenheit-1.pdf` (für Personen ohne Wochenplan-Zeile: Stunden = angerechnete U-Stunden × 6); 19 Personen, davon die zwei im Bild `01-abwesenheitsplanung.jpg` hellblau dargestellten mit `aktiv = false`. Vertragsart `vollzeit` bei 37,50, sonst `teilzeit`; `personalnummer` leer; Urlaubsjahr 2027 = `wochenstunden × 6` (Beleg `report-abwesenheit-2.pdf`: 225,00 h bei 37,5 h). Kommentar im Kopf: Herkunft, dass Azubi/F vom Filialleiter nachgetragen werden.
  - `supabase/schulferien-BY.sql`: Schulferien Bayern für die Schuljahre 2026/27 und 2027/28 für die Filiale `2558`, je Zeile `insert … where not exists`; Quelle im Kopfkommentar (offizielle Ferientermine des Bayerischen Staatsministeriums für Unterricht und Kultus, mit Abrufdatum). Werte vor dem Eintragen aus der Quelle abrufen, nicht aus dem Gedächtnis.
  - `ANLEITUNG.md`: Einrichtung (Supabase SQL-Editor: `schema.sql`, dann `select pep.start_leitung('<benutzername>')`, dann in der Seite Filiale anlegen, dann optional `stammdaten-aschaffenburg.sql` und `schulferien-BY.sql`; GitHub Pages aus `docs/`), Bedienung je Reiter, Handprüf-Checkliste aus Task 6–9.
  - `README.md`: Zweck, Aufbau-Tabelle wie im Urlaubstool, Sicherheitsprinzip, Tests.

- [ ] **Step 1: Failing Test schreiben (`tests/startbestand.test.mjs`)**

```js
// Die Startdatei liegt in privat/ und fehlt in fremden Checkouts: Test überspringen (test.skip), wenn die Datei fehlt,
// wie der Excel-Test im Urlaubstool bei fehlendem openpyxl.
test('Startbestand: 19 Mitarbeiter, 2 inaktiv, alle mit Vertrag ab 2026-01-01 und Urlaubsjahr 2027 = wochenstunden × 6', ...);
test('Startbestand zweimal ausführen legt nichts doppelt an', ...);
test('Schulferien-Datei: Sommerferien 2027 vorhanden, zweimal ausführen unschädlich', ...);
test('ohne Filiale 2558 → FILIALE_FEHLT', ...);
```

- [ ] **Step 2: Test laufen lassen** → FAIL.

- [ ] **Step 3: SQL-Dateien, ANLEITUNG.md, README.md schreiben**

- [ ] **Step 4: Alle Tests laufen lassen** → `npm test` PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/schulferien-BY.sql ANLEITUNG.md README.md tests/startbestand.test.mjs   # privat/ bleibt draußen
git commit -m "Startbestand Aschaffenburg, Schulferien Bayern, Anleitung, README"
```

---

## Nach Abschluss

Branch `stufe-0` gegen `main` reviewen und mergen (superpowers:finishing-a-development-branch). Danach folgt der Plan für Stufe 1 (Einsatzplan, Regelprüfung, Kopieren, Vorlagen, Eckdaten, Ersatz finden) auf diesem Schema.

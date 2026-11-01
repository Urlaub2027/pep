# PEP Mitarbeiter-Zugang Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mitarbeiter melden sich mit eigenem Konto an und sehen nach Datenschutzbestätigung nur ihren eigenen Plan der freigegebenen Wochen, die Kollegen am selben Tag (ohne Abwesende), ihren Urlaub und ihr Zeitkonto.

**Architecture:** Eigene Konten-Schiene neben `pep.benutzer`: Einladung je `pep.mitarbeiter`-Eintrag, eigener Trigger auf `auth.users`, eigener Helfer `pep.ich_mitarbeiter()` und eigene Funktionen `public.pep_mein_*`. Alle bestehenden `pep_*`-Funktionen bleiben für Mitarbeiter-Konten gesperrt, weil `pep.ich()` sie nicht kennt. Das Urlaubstool lässt PEP-Einladungen in seinem Konto-Trigger durch. Frontend: dieselbe Seite, nach der Anmeldung entweder die Reiter (Leitung/Stellvertretung) oder die Mitarbeiter-Ansicht. Dazu ein Web-App-Manifest, damit sich die Seite als App auf den Homebildschirm legen lässt.

**Tech Stack:** PostgreSQL/Supabase (plpgsql, SECURITY DEFINER), Vanilla JS ohne Build (`docs/`), Tests `node --test` mit PGlite, Browser-Szenarien `tests/browser`.

**Spec:** `docs/superpowers/specs/2026-11-01-pep-mitarbeiter-zugang-design.md`

## Global Constraints

- Repository öffentlich: keine echten Namen in Code, Tests, Doku. Testnamen wie „Test, Ida“.
- Jede neue `public.pep_*`-Funktion: `security definer`, `set search_path = ''`, `revoke all … from public, anon, authenticated`, `grant execute … to authenticated`. Einzige neue anon-Funktion: `pep_zugang_pruefen` (zusätzlich `grant … to anon`).
- Parameter einer bestehenden Funktion ändern ⇒ alte Fassung vorher `drop function if exists` (Hinweis im Schema-Kopf).
- `schema.sql` bleibt mehrfach ausführbar (`if not exists`, Trigger auf `auth.users` nur über `do $$ … if not exists … $$`, kein `drop trigger` dort).
- Fehlercodes als `raise exception '<CODE>'`, Texte dazu in `docs/hilfe.js` (`fehlerText`).
- Kein bestehender Helfer (`pep.ich`, `pep.leitung`, `pep.leitung_oder_stellvertretung`) wird gelockert.
- Rechenregeln (`pep.urlaub_konto`, `pep.zeitkonto_woche`, Journal) werden nur aufgerufen, nicht verändert.
- Benutzernamen-Regel (Urlaubstool `admin.js` `BENUTZERNAME`): `^(?=.{2,30}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$`, Mailadresse `<name>@example.com`. Passwort mindestens 10 Zeichen (nur im Browser, wie Urlaubstool).
- Einladung gültig 7 Tage; Code `replace(gen_random_uuid()::text, '-', '')` wie `urlaub.einladungen`.
- Testlauf PEP: `npm test` im Repo-Wurzelordner. Urlaubstool: `npm test` dort.

## Review Focus

1. **Abwesenheits-Leck über Umwege:** Kollege mit stundenweiser Abwesenheit und Blöcken am selben Tag; Kollege mit Abwesenheit, aber ohne Blöcke; eigene Abwesenheit. Kein Name, kein Code eines abwesenden Kollegen in irgendeinem `pep_mein_*`-Ergebnis (auch nicht in Zählern wie „3 Kollegen“).
2. **Fremde Daten per Parameter:** `pep_mein_plan` mit Jahr/KW einer nicht freigegebenen Woche, einer Woche einer anderen Filiale, absurden Werten (KW 0, 54) → leer bzw. Fehler, nie Daten.
3. **Konto-Wechsel:** Neuer Link, alter noch nicht eingelöst → altes Passwort funktioniert weiter; nach Einlösen ist das alte Konto ohne Zugang und die alte Zustimmung zählt nicht.
4. **Mitarbeiter ausgetreten/inaktiv/gesperrt** während er angemeldet ist → nächster Aufruf `KEIN_ZUGRIFF`, Seite meldet ab.
5. **Doppeltes Einlösen** desselben Codes (zwei Registrierungen gleichzeitig) → genau ein Konto.

---

### Task 1: Urlaubstool lässt PEP-Einladungen durch

**Repo:** `C:\Users\dtn\Documents\Urlaubsvertretung` (eigener Worktree von `origin/main`, Branch `pep-mitarbeiter-einladung`).

**Files:**
- Modify: `supabase/schema.sql` (`urlaub.neuer_benutzer()`, ca. Zeile 2640)
- Test: `tests/einladung.test.mjs`

**Interfaces:**
- Produces: `urlaub.neuer_benutzer()` gibt `new` unverändert zurück, wenn `new.raw_user_meta_data ? 'pep_einladung'` **und** `to_regclass('pep.mitarbeiter_einladungen') is not null` – als **erste** Prüfung, vor `EINLADUNG_FEHLT` und `NAME_LEER`. Kommentar: „Fachregel-Duplikat: Gegenstück in Urlaub2027/pep supabase/schema.sql (pep.neuer_mitarbeiter), dort prüft die PEP den Code.“

- [ ] **Step 1: Failing tests** in `tests/einladung.test.mjs`:
  - `test('PEP-Einladung: ohne PEP-Schema bleibt die Einladungspflicht')` – Konto mit Metadaten `{ pep_einladung: 'x'.repeat(32) }` → rejects `/EINLADUNG_FEHLT/`, Kontenzahl unverändert.
  - `test('PEP-Einladung: mit PEP-Schema legt der Urlaubstool-Trigger keinen Organisator an')` – vorher `create schema pep; create table pep.mitarbeiter_einladungen (code text);` → Insert gelingt, `select count(*) from urlaub.organisatoren where user_id = <id>` = 0.
  - Für die Metadaten einen Helfer `registriereMit(db, benutzername, daten)` neben `registriere` in `tests/helfer.mjs`.
- [ ] **Step 2:** `npm test` → beide neuen Tests rot (der zweite mit `EINLADUNG_FEHLT`).
- [ ] **Step 3:** Frühe Rückgabe in `urlaub.neuer_benutzer()` einbauen, Kommentar wie oben.
- [ ] **Step 4:** `npm test` → alles grün.
- [ ] **Step 5:** Commit `Konto-Trigger: Mitarbeiter-Einladungen der PEP durchlassen`.

### Task 2: Konten, Einladung, Datenschutz – Datenbank

**Files:**
- Modify: `tests/fixtures/urlaub-schema.sql` (neu einfrieren aus Task-1-Commit, Kopfzeile mit Commit-Hash und Datum anpassen)
- Modify: `supabase/schema.sql` (neuer Abschnitt „Mitarbeiter-Zugang (Stufe 3)“ vor dem Rechte-Block; Rechte-Block am Ende ergänzen; `pep.sicherung_ausnahmen()`, `pep.sicherung_tabellen()`)
- Modify: `supabase/schema.sql` `public.pep_mitarbeiter(p_id)` – Feld `zugang` ergänzen
- Create: `tests/zugang.test.mjs`
- Modify: `tests/rechte.test.mjs`, `tests/sicherung.test.mjs` (nur wo der Inventar-Test es verlangt)
- Modify: `tests/helfer.mjs` (`registriereMitarbeiter`)

**Interfaces:**
- Produces (Tabellen):
  - `pep.mitarbeiter_zugaenge (mitarbeiter_id bigint pk → pep.mitarbeiter on delete cascade, user_id uuid unique → auth.users on delete set null, gesperrt boolean not null default false, angelegt_von uuid, angelegt_am timestamptz default now(), aktiv_seit timestamptz)`
  - `pep.mitarbeiter_einladungen (code text pk default …, mitarbeiter_id bigint not null → pep.mitarbeiter on delete cascade, erstellt_von uuid, erstellt_am timestamptz default now(), gueltig_bis timestamptz not null default now() + interval '7 days', eingeloest_von uuid, eingeloest_am timestamptz, ersetzt_am timestamptz)`
  - `pep.datenschutz_texte (filiale_id bigint → pep.filialen on delete cascade, version int, text text not null check (btrim(text) <> ''), am timestamptz default now(), von uuid, primary key (filiale_id, version))`
  - `pep.zustimmungen (id identity pk, mitarbeiter_id bigint → pep.mitarbeiter on delete cascade, version int not null, user_id uuid not null, am timestamptz default now())` – Trigger verbietet update/delete (Muster `pep.journal_unveraenderbar`).
  - RLS an für alle vier.
- Produces (intern):
  - `pep.neuer_mitarbeiter() returns trigger` (security definer) + Trigger `pep_neuer_mitarbeiter after insert on auth.users`. Ohne `pep_einladung` → `return new`. Sonst: Code `for update` sperren; gültig = vorhanden, `eingeloest_von is null`, `ersetzt_am is null`, `gueltig_bis > now()`, Mitarbeiter aktiv, kein Austritt vor heute, Filiale hat einen Datenschutztext – sonst `EINLADUNG_UNGUELTIG`. Benutzername (`split_part(new.email,'@',1)`) gegen die Regel und Domain `example.com` – sonst `BENUTZERNAME_UNGUELTIG`. Dann Einladung einlösen, `pep.mitarbeiter_zugaenge` upsert: `user_id = new.id, gesperrt = false, aktiv_seit = now()`; Protokoll `zugang_aktiv`.
  - `pep.ich_mitarbeiter(p_zustimmung_noetig boolean default true) returns pep.mitarbeiter` – Zugang mit `user_id = auth.uid()`, nicht gesperrt, Mitarbeiter `aktiv` und (`austritt is null or austritt >= pep.heute()`) – sonst `KEIN_ZUGRIFF`. Mit `p_zustimmung_noetig`: Zustimmung für die höchste Version der Filiale mit `user_id = auth.uid()` vorhanden – sonst `ZUSTIMMUNG_FEHLT`.
- Produces (public):
  - `pep_zugang_pruefen(p_code text) returns jsonb` → `{"gueltig": bool}` (anon erlaubt, keine Namen).
  - `pep_zugang_einladen(p_mitarbeiter_id bigint) returns jsonb` → `{"code", "gueltig_bis"}`. Nur `pep.leitung()`, eigene Filiale, Mitarbeiter aktiv; ohne Datenschutztext `DATENSCHUTZ_FEHLT`. Offene ältere Einladungen dieses Mitarbeiters: `ersetzt_am = now()`. Zugangszeile anlegen, falls fehlt. Protokoll `zugang_einladen`.
  - `pep_zugang_sperren(p_mitarbeiter_id bigint, p_gesperrt boolean) returns void` – nur Leitung, eigene Filiale; Protokoll.
  - `pep_datenschutz() returns jsonb` → `{"version", "text", "am"}` oder `null` – Leitung und Stellvertretung.
  - `pep_datenschutz_speichern(p_text text) returns jsonb` – nur Leitung; gleicher Text wie aktuelle Version ⇒ keine neue Version; leer ⇒ `TEXT_LEER`. Protokoll.
  - `pep_mitarbeiter(p_id)` Ergebnis + `"zugang": {"stand": "kein"|"eingeladen"|"aktiv"|"gesperrt", "gueltig_bis", "aktiv_seit", "zustimmung_am"}` (`zustimmung_am` = jüngste Zustimmung des aktuellen Kontos zur aktuellen Version, sonst null).
  - `pep_mein_konto() returns jsonb` – `null`, wenn `auth.uid()` keinen Zugang hat (kein Fehler, damit die Seite unterscheiden kann); sonst `pep.ich_mitarbeiter(false)` und `{"name", "filiale": {"name"}, "zustimmung": {"noetig": bool, "version", "text"}}`.
  - `pep_mein_zustimmen(p_version int) returns void` – `pep.ich_mitarbeiter(false)`; `p_version` ≠ aktuelle ⇒ `VERSION_VERALTET`; sonst Zeile anfügen. Protokoll.
- Sicherung: `datenschutz_texte` in `sicherung_tabellen()`; `mitarbeiter_zugaenge`, `mitarbeiter_einladungen`, `zustimmungen` in `sicherung_ausnahmen()` mit Grund „Konten hängen am Supabase-Projekt, nicht an der Filiale; nach dem Einspielen neu einladen“.

- [ ] **Step 1: Fixture neu einfrieren** aus dem Task-1-Commit; `npm test` → bestehende Tests grün.
- [ ] **Step 2: Failing tests** `tests/zugang.test.mjs` (Helfer `registriereMitarbeiter(db, name, code)` = Insert in `auth.users` als `supabase_auth_admin` mit `{pep_einladung: code}`):
  - `einladen ohne Datenschutztext → DATENSCHUTZ_FEHLT`
  - `einladen + registrieren: Zugang aktiv, kein Organisator, Einladung eingelöst`
  - `Code ungültig/abgelaufen/eingelöst/ersetzt → EINLADUNG_UNGUELTIG, kein Konto`
  - `Benutzername "A b" oder fremde Domain → BENUTZERNAME_UNGUELTIG`
  - `zweites Einlösen desselben Codes → genau ein Konto`
  - `neuer Link ersetzt alten; altes Konto bis zum Einlösen gültig, danach KEIN_ZUGRIFF` (Review Focus 3)
  - `pep_mein_konto: null für Organisator, Daten für Mitarbeiter, zustimmung.noetig true`
  - `ZUSTIMMUNG_FEHLT bis pep_mein_zustimmen; neue Textversion → wieder ZUSTIMMUNG_FEHLT; neues Konto → wieder ZUSTIMMUNG_FEHLT`
  - `VERSION_VERALTET bei alter Version`
  - `gesperrt / inaktiv / austritt gestern → KEIN_ZUGRIFF` (Review Focus 4)
  - `Stellvertretung darf nicht einladen/sperren/Text speichern → NUR_LEITUNG`
  - `Mitarbeiter-Konto bekommt von jeder bestehenden public.pep_*-Funktion KEIN_ZUGRIFF` – Schleife über die Aufrufliste aus `tests/rechte.test.mjs` (Aufrufliste dafür exportieren), außer `pep_lebenszeichen`, `pep_zugang_pruefen` und `pep_mein_*`.
  - `zustimmungen lassen sich nicht ändern oder löschen`
  - `pep_zugang_pruefen als anon: {gueltig} ohne weitere Felder`
- [ ] **Step 3:** `npm test` → neue Tests rot.
- [ ] **Step 4:** Tabellen, Trigger, Helfer und Funktionen implementieren; Rechte-Block; `pep_mitarbeiter` erweitern; Sicherungslisten.
- [ ] **Step 5:** `tests/rechte.test.mjs`: anon-Ausnahme um `pep_zugang_pruefen` erweitern; neue Funktionen in `NUR_LESEN` bzw. Aufrufliste aufnehmen, wie der Inventartest verlangt (`pep_mein_*` und `pep_zugang_pruefen` als eigene Gruppe „eigene Prüfung“, da sie nicht über `pep.ich()` laufen).
- [ ] **Step 6:** `npm test` → alles grün.
- [ ] **Step 7:** Commit `Mitarbeiter-Zugang: Einladung, Konto, Datenschutzbestätigung (Datenbank)`.

### Task 3: Wochenfreigabe – Datenbank

**Files:**
- Modify: `supabase/schema.sql` (Abschnitt aus Task 2; `public.pep_einsatzplan_woche` Ergebnis ergänzen)
- Create: `tests/freigabe.test.mjs`
- Modify: `tests/rechte.test.mjs`, `tests/sicherung.test.mjs` (falls nötig)

**Interfaces:**
- Consumes: `pep.leitung_oder_stellvertretung()`, `pep.protokolliere(...)`.
- Produces:
  - `pep.wochen_freigaben (filiale_id bigint → pep.filialen on delete cascade, montag date check (extract(isodow from montag) = 1), freigegeben_am timestamptz not null default now(), freigegeben_von uuid, zuletzt_geaendert timestamptz, primary key (filiale_id, montag))`, RLS an, in `sicherung_tabellen()`.
  - `pep.freigabe_aenderung() returns trigger` + Trigger auf `pep.plan_bloecke`, `pep.plan_kommentare`, `pep.abwesenheiten` (after insert/update/delete, for each row): setzt `zuletzt_geaendert = now()` der freigegebenen Woche von `coalesce(new.datum, old.datum)` (bei update mit geändertem Datum beide Wochen). Läuft nicht während `pep.einspielen` (Muster der Nachbuch-Trigger).
  - `pep_woche_freigeben(p_jahr int, p_kw int, p_frei boolean) returns jsonb` → Freigabe-Objekt oder null. Leitung oder Stellvertretung; Protokoll `woche_freigeben`/`woche_zuruecknehmen`. In `AUCH_STELLVERTRETUNG`.
  - `pep_einsatzplan_woche` Ergebnis + `"freigabe": {"am", "von_name"} | null`.

- [ ] **Step 1: Failing tests** `tests/freigabe.test.mjs`: freigeben/zurücknehmen (Leitung, Stellvertretung), Mitarbeiter-Konto → `KEIN_ZUGRIFF`; `zuletzt_geaendert` wird gesetzt bei Block einfügen, Block **löschen**, Kommentar ändern, Abwesenheit eintragen; nicht gesetzt für nicht freigegebene Woche; `pep_einsatzplan_woche` liefert `freigabe`.
- [ ] **Step 2:** `npm test` → rot.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npm test` → grün.
- [ ] **Step 5:** Commit `Wochenfreigabe für die Mitarbeiter-Ansicht (Datenbank)`.

### Task 4: Mitarbeiter-Lesefunktionen

**Files:**
- Modify: `supabase/schema.sql`
- Create: `tests/mein.test.mjs`
- Modify: `tests/rechte.test.mjs`

**Interfaces:**
- Consumes: `pep.ich_mitarbeiter()`, `pep.tag_status(f, datum)`, `pep.urlaub_konto(m, jahr)`, `pep.zeitkonto_woche(m, montag)`, `pep.zeitkonto_buchungen`, `pep.wochen_abschluesse`, `pep.wochen_freigaben`.
- Produces:
  - `pep_mein_wochen() returns jsonb` → Liste `[{jahr, kw, montag, zuletzt_geaendert}]` der freigegebenen Wochen der Filiale ab der laufenden Woche (`pep.heute()`), aufsteigend, höchstens 8.
  - `pep_mein_plan(p_jahr int, p_kw int) returns jsonb` – Woche nicht freigegeben oder ungültig ⇒ `WOCHE_NICHT_FREIGEGEBEN` (gleicher Code für „andere Filiale“, „KW 54“, „nicht freigegeben“ – kein Unterschied erkennbar). Ergebnis `{jahr, kw, zuletzt_geaendert, tage: [{datum, geoeffnet, feiertag, bloecke: [{von, bis, bereich_kuerzel, bereich_name, pause: bool}], kommentar, abwesenheit: {code, name, stunden, von, bis} | null, kollegen: [{name, zeiten: [{von, bis}]}]}]}`. `kollegen` = andere Mitarbeiter der Filiale mit Blöcken (ohne `art = 'pause'`) an diesem Datum **und ohne jede Zeile in `pep.abwesenheiten` an diesem Datum**; aneinandergrenzende Blöcke zu einem Zeitraum zusammengefasst; sortiert nach erster Zeit, dann Name.
  - `pep_mein_urlaub(p_jahr int) returns jsonb` → `{jahr, anspruch, rest_vorjahr, genehmigt, rest, tage: [{datum, stunden}]}` aus `pep.urlaub_konto` und den eigenen `U`-Abwesenheiten des Jahres.
  - `pep_mein_zeitkonto() returns jsonb` → `{saldo, stand: date | null, wochen: [{montag, soll, ist, diff, saldo}]}`: `saldo`/`stand` = jüngste eigene `zeitkonto_buchungen`-Zeile (`saldo_nach`, `datum`); `wochen` = die letzten 6 Einträge aus `pep.wochen_abschluesse` der Filiale, je `pep.zeitkonto_woche(m, montag)` (soll/ist/diff) und `saldo_nach` der letzten eigenen Buchung mit `datum <= montag + 6`.
  - Alle vier: `pep.ich_mitarbeiter()` (Zustimmung nötig), in `NUR_LESEN`-ähnlicher eigener Gruppe des Rechtetests.

- [ ] **Step 1: Failing tests** `tests/mein.test.mjs` mit Fixture: Filiale, Ida (Konto, zugestimmt), Jo (arbeitet am selben Tag), Kai (arbeitet vormittags, **KM** stundenweise nachmittags), Lea (U ganztägig, ohne Blöcke), zweite Filiale mit Ola:
  - `nicht freigegebene Woche → WOCHE_NICHT_FREIGEGEBEN; KW 54 → derselbe Code`
  - `eigener Plan mit Blöcken, Pause, Kommentar, eigener Abwesenheit`
  - `Kollegen: Jo mit Zeiten; Kai, Lea, Ola tauchen nirgends im JSON auf` – Prüfung `!JSON.stringify(r).includes('Kai')` usw., ebenso kein `"KM"` (Review Focus 1)
  - `pep_mein_wochen nur freigegebene ab laufender Woche`
  - `Urlaub: Werte gleich pep.urlaub_konto`
  - `Zeitkonto: saldo = jüngstes saldo_nach; ohne Buchungen saldo null`
  - `ohne Zustimmung → ZUSTIMMUNG_FEHLT`
- [ ] **Step 2:** `npm test` → rot.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** `npm test` → grün.
- [ ] **Step 5:** Commit `Mitarbeiter-Ansicht: Plan, Kollegen, Urlaub, Zeitkonto (Datenbank)`.

### Task 5: Leitung – Oberfläche (Zugang, Datenschutztext, Freigabe)

**Files:**
- Modify: `docs/mitarbeiter.js` (neuer Abschnitt `zugang(m)` in `zeichneKarte`, nur bei `darfSchreiben()`)
- Modify: `docs/einstellungen.js` (neuer Teil „Datenschutz“ neben `zeichneBenutzer`)
- Modify: `docs/einsatzplan.js` (Freigabe-Zeile in der Wochenansicht)
- Modify: `docs/hilfe.js` (Fehlertexte: `DATENSCHUTZ_FEHLT`, `EINLADUNG_UNGUELTIG`, `BENUTZERNAME_UNGUELTIG`, `ZUSTIMMUNG_FEHLT`, `VERSION_VERALTET`, `WOCHE_NICHT_FREIGEGEBEN`, `TEXT_LEER`), `docs/hilfe-texte.js` (Hilfetexte der neuen Abschnitte)
- Create: `docs/zugang-text.js` (reine Funktionen: `einladungsLink(basisUrl, code)`, `zugangsStandText(zugang)`, `DATENSCHUTZ_ENTWURF`), Test `tests/zugang-text.test.mjs`

**Interfaces:**
- Consumes: `pep_mitarbeiter` (`zugang`), `pep_zugang_einladen`, `pep_zugang_sperren`, `pep_datenschutz`, `pep_datenschutz_speichern`, `pep_woche_freigeben`, `pep_einsatzplan_woche.freigabe`.
- Produces: `einladungsLink(basisUrl, code) → '<basisUrl ohne Hash>#zugang=<code>'`; `DATENSCHUTZ_ENTWURF` = Entwurfstext, erste Zeile „Entwurf – rechtlich nicht geprüft“.

- [ ] **Step 1: Failing test** `tests/zugang-text.test.mjs`: Link ohne vorhandenen Hash/mit Hash, Standtexte für alle vier Stände („kein Zugang“, „eingeladen bis 08.11.2026“, „aktiv seit …“, „gesperrt“), Entwurf beginnt mit dem Hinweis.
- [ ] **Step 2:** `npm test` → rot. **Step 3:** `docs/zugang-text.js` implementieren. **Step 4:** grün.
- [ ] **Step 5:** Mitarbeiter-Karte: Stand, Zustimmungsdatum, „Zugang einrichten“/„Neuer Link“ (zeigt Link mit Kopieren und `navigator.share`, falls vorhanden), „Sperren“/„Entsperren“ mit Rückfrage. Einstellungen „Datenschutz“: Textfeld, „Entwurf einfügen“, Speichern, Version und Datum. Einsatzplan-Woche: „Woche für Mitarbeiter freigeben“ bzw. „Freigegeben am … von … · Freigabe zurücknehmen“ (Leitung und Stellvertretung).
- [ ] **Step 6:** Browser-Szenario in `tests/browser/szenarien.mjs`: Leitung richtet Zugang ein (Link erscheint), gibt Woche frei. Lauf nach README-Abschnitt „Browser-Tests“.
- [ ] **Step 7:** `npm test` grün; Commit `Mitarbeiter-Zugang: Oberfläche der Leitung`.

### Task 6: Mitarbeiter – Oberfläche und App auf dem Homebildschirm

**Files:**
- Modify: `docs/index.html` (Ansichten `registrieren`, `zustimmung`, `mein`; Manifest- und Icon-Links, `theme-color`)
- Modify: `docs/app.js` (`ANSICHTEN`, Hash `#zugang=` beim Start, `nachLogin` fragt zuerst `pep_mein_konto`)
- Create: `docs/mein.js` (Mitarbeiter-Ansicht), `docs/mein-daten.js` (reine Aufbereitung, z. B. `tagZeilen(tag)`, `kollegenText(kollegen)`, `saldoText(saldo)`), Test `tests/mein-daten.test.mjs`
- Create: `docs/manifest.webmanifest`, `docs/icon-192.png`, `docs/icon-512.png` (schlichtes Logo „PEP“, selbst erzeugt)
- Modify: `docs/sw.js` (neue Dateien in die Liste, falls dort eine steht), `docs/style.css` (Handy-Layout der Mitarbeiter-Ansicht)

**Interfaces:**
- Consumes: `pep_zugang_pruefen`, `api.registrieren(email, passwort, { pep_einladung })`, `sitzung.login`, `pep_mein_konto`, `pep_mein_zustimmen`, `pep_mein_wochen`, `pep_mein_plan`, `pep_mein_urlaub`, `pep_mein_zeitkonto`.
- `aufruf()` meldet heute bei `KEIN_ZUGRIFF` ab – das bleibt; `nachLogin` ruft `pep_mein_konto` über `sitzung.orgRpc` direkt: Ergebnis ≠ null ⇒ Mitarbeiter-Ansicht (Navigation bleibt versteckt), sonst wie bisher `aktualisiereIch()`. `ZUSTIMMUNG_FEHLT` aus `pep_mein_*` ⇒ Ansicht `zustimmung`.

- [ ] **Step 1: Failing test** `tests/mein-daten.test.mjs`: Tageszeile mit Blöcken und Pause („08:00–12:00 KA, Pause 12:00–12:30, 12:30–16:00 TS“), Feiertag, eigene Abwesenheit („U“), Kollegentext („Jo 08:00–16:00“), Saldo („+12,5 h, Stand 26.10.2026“, „noch keine Buchung“).
- [ ] **Step 2:** rot. **Step 3:** `docs/mein-daten.js`. **Step 4:** grün.
- [ ] **Step 5:** Registrierung: `#zugang=<code>` → `pep_zugang_pruefen`; ungültig ⇒ Hinweis „Link ungültig, abgelaufen oder schon benutzt – bitte bei der Leitung einen neuen anfordern“; Formular Benutzername (Regel aus Global Constraints) + Passwort ×2; nach Erfolg Hash entfernen, anmelden, weiter zu `nachLogin`. Fehlertexte wie Urlaubstool `registrierenAbsenden` (bereits vergeben, Status 500 = Link ungültig).
- [ ] **Step 6:** Zustimmung: Text, Knopf „Ich habe den Text gelesen und stimme zu“, danach `mein`.
- [ ] **Step 7:** `mein`: Wochenwahl (freigegebene Wochen), Tageskarten (eigener Plan, darunter „Mit dir eingeteilt: …“), „zuletzt geändert am …“, Kacheln Resturlaub und Zeitkonto-Saldo, Abmelden. Keine freigegebene Woche ⇒ „Noch keine Woche freigegeben“.
- [ ] **Step 8:** Manifest (`name` „PEP“, `display` `standalone`, `start_url` `./`, Icons), Links im `<head>`, `apple-touch-icon`. In `docs/hilfe-texte.js` ein Tipp „Als App nutzen: im Browser-Menü ‚Zum Home-Bildschirm‘“.
- [ ] **Step 9:** Browser-Szenario: Registrierung über Link, Zustimmung, Wochenansicht auf 390 px Breite ohne waagerechtes Scrollen; Prüfung, dass ein abwesender Kollege nicht im DOM steht.
- [ ] **Step 10:** `npm test` grün; Commit `Mitarbeiter-Ansicht und App-Manifest`.

### Task 7: Doku

**Files:**
- Modify: `README.md` (Rollen, neue Funktionen, Einspiel-Reihenfolge: erst Urlaubstool-Schema, dann PEP-Schema), `ANLEITUNG.md` (Abschnitt „Mitarbeiter-Zugang“: Datenschutztext hinterlegen, Zugang einrichten, Woche freigeben, Passwort vergessen, Sperren, nach Sicherung neu einladen, als App auf den Homebildschirm), Statuszeile der Spec

- [ ] **Step 1:** Doku schreiben; Hinweis „Datenschutzentwurf rechtlich ungeprüft“.
- [ ] **Step 2:** `npm test` grün (Hilfetext-Tests).
- [ ] **Step 3:** Commit `Doku: Mitarbeiter-Zugang`.

### Task 8: Schalter „Kollegen in der Mitarbeiter-Ansicht“ (Nachtrag 01.11.2026)

Anlass: Rückfrage des Key Users („nur persönliche Schicht oder ganzer Plan?“). Entscheidung dtn: Schalter in den Einstellungen, **Vorgabe „mit Kollegen“** (heutiges Verhalten). „Ganzer Plan wie am Aushang“ (mit Abwesenden) wird nicht angeboten.

**Files:**
- Modify: `supabase/schema.sql` (`public.pep_einstellung_setzen` Schlüssel-Liste + Prüfung, `public.pep_einstellungen` liefert den Wert, `public.pep_mein_plan`)
- Modify: `docs/einstellungen-datenschutz.js` (Schalter im selben Abschnitt), `docs/mein.js` / `docs/mein-daten.js` (Zeile „Mit dir eingeteilt“ entfällt bei ausgeschaltetem Schalter), `docs/hilfe-texte.js` (180-Wörter-Grenze beachten)
- Modify: `tests/mein.test.mjs`, `tests/einstellungen.test.mjs`, `tests/mein-daten.test.mjs`, Browser-Szenario „Mitarbeiter-Ansicht“
- Modify: `ANLEITUNG.md` (Abschnitt Mitarbeiter-Zugang), Spec §5.2 (ein Satz zum Schalter)

**Interfaces:**
- Einstellung `mitarbeiter_kollegen` in `pep.einstellungen`, Wert JSON-Boolean; fehlt die Zeile ⇒ `true`. Setzen nur Leitung über `pep_einstellung_setzen('mitarbeiter_kollegen', true|false)`; andere Werte ⇒ bestehender Fehlercode für ungültige Einstellungswerte der Funktion.
- `pep_mein_plan`: bei `false` ist `kollegen` an **jedem** Tag `null` (nicht `[]`) – die Datenbank liefert dann keine Kollegennamen aus; bei `true` unverändert (`[]` = niemand sonst eingeteilt).
- UI: `kollegen === null` ⇒ keine Kollegenzeile; `[]` ⇒ wie bisher.

- [ ] **Step 1: Failing tests**: `mein.test.mjs` – Schalter aus ⇒ `kollegen` überall `null`, `JSON.stringify` enthält „Jo“ nicht; Schalter an bzw. nicht gesetzt ⇒ Jo sichtbar. `einstellungen.test.mjs` – Leitung setzt `true/false`, Wert `"ja"` abgelehnt, Stellvertretung ⇒ `NUR_LEITUNG`. `mein-daten.test.mjs` – Kollegentext bei `null` leer/kein Eintrag.
- [ ] **Step 2:** `npm test` → rot.
- [ ] **Step 3:** Schema und Oberfläche umsetzen.
- [ ] **Step 4:** `npm test` grün; Browser-Szenario „Mitarbeiter-Ansicht“ um „Schalter aus ⇒ keine Kollegenzeile“ erweitern und gefiltert laufen lassen.
- [ ] **Step 5:** Commit `Mitarbeiter-Ansicht: Schalter für Kollegenanzeige`.

# PEP – Personaleinsatzplanung

Webseite für die Personaleinsatzplanung einer Filiale: Mitarbeiter mit Verträgen,
Kompetenzen und Urlaubsansprüchen, Einstellungen (Öffnungszeiten, Bereiche,
Abwesenheitscodes, Schulferien) und ein Abwesenheitskalender, in den auch die
Urlaubswünsche aus dem Urlaubstool einfließen (Stufe 0). Dazu kommen in Stufe 1
der Einsatzplan in halben Stunden mit Regelprüfung, Kopieren und Vorlagen,
Krankmeldung mit Ersatzsuche, Eckdaten, die Vorausplanung über sechs Wochen, die
Ausdrucke mit Excel-Export und die Startseite. Stufe 2 bringt die IST-Erfassung
(tatsächliche Zeiten je Tag, Vorschlag aus dem Plan, Bestätigen, Grund bei Änderungen)
und das Zeitkonto (Wochenabschluss, Journal mit automatischen Korrekturen,
Startsaldo, Korrektur von Hand) mit Stundenblatt, Wocheneinsatz-IST und dem Journal
als Excel, dazu eine eigene Sicherung (Datei herunterladen und in eine leere Filiale
einspielen; Supabase sichert im kostenlosen Tarif nichts).
Einrichtung und Bedienung: [ANLEITUNG.md](ANLEITUNG.md).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `docs/` | Statische Seite (GitHub Pages), ohne Framework und ohne Build. `index.html`, `main.js` (Einstieg), `app.js` (Anmeldung, Reiter), `api.js`, `sitzung.js`, `config.js`, `hilfe.js` (Helfer, Fehlertexte), `dialog.js`, `style.css` |
| `docs/` – Reiter | `start.js` (Startseite), `abwesenheiten.js`, `vorausplanung.js`, `einsatzplan.js` (Plan und IST), `zeitkonto.js`, `mitarbeiter.js`, `einstellungen.js`, `sicherung.js` (Abschnitt „Sicherung“ der Einstellungen und Hinweis der Startseite) |
| `docs/` – Einsatzplan | `plan-raster.js` (reine Logik: Zeitraster, Striche, Abdeckung, Stunden, Rückgängig), `plan-dialoge.js` (Kopieren, Vorlagen, Krank/ZA, Ersatz, Eckdaten), `ist-ansicht.js` (Modus IST: Status, Vorschlag, Bestätigen, Grund-Dialog) |
| `docs/` – Zeitkonto | `zeitkonto.js` (Reiter: Woche, „Woche buchen“, Journal, Startsaldo, Korrektur von Hand), `zeitkonto-daten.js` (reine Logik: Vorzeichen, Journalzeilen, Stunden-Eingabe) |
| `docs/` – Druck | `druck.js` (Druckansicht und Auswahl-Dialoge, auch Stundenblatt und Wocheneinsatz-IST), `druck-daten.js` (reine Aufbereitung), `xlsx.js` (Excel-Datei ohne Bibliothek, mit Datumszellen) |
| `docs/` – reine Logik | `kalender.js` (Monatsraster der Abwesenheiten), `zeit.js` (Uhrzeiten, ISO-Wochen, KW 53) |
| `supabase/schema.sql` | Schema `pep` mit allen Tabellen, Prüffunktionen (z. B. `pep.pruefung`, `pep.woche_kennzahlen`, `pep.zeitkonto_woche`), den Nachbuch-Triggern des Zeitkontos und den Browser-Funktionen `public.pep_*`. Eine idempotente Datei: erneutes Ausführen ist unschädlich und behält die Daten |
| `supabase/schulferien-BY.sql` | Schulferien Bayern 2026/27 und 2027/28 für Filiale 2558 (Quelle im Kopf), idempotent |
| `tests/` | Tests gegen eine lokale Postgres-Instanz (PGlite) mit nachgebildeten Supabase-Rollen und dem eingefrorenen Urlaubstool-Schema (`tests/fixtures/`); reine JS-Module ohne DOM mit `node --test` |
| `tests/vorschau/` | Vorschau der Oberfläche ohne Supabase (siehe unten) |
| `privat/` | Nicht im Repo (gitignored): Startbestand mit echten Namen, Referenzmaterial |

## Einrichtung und Umstellung

Erstmals: `supabase/schema.sql` im SQL-Editor von Supabase ausführen, dann die
Schritte in [ANLEITUNG.md](ANLEITUNG.md), Abschnitt 1.

**Von Stufe 0 auf Stufe 1:** `supabase/schema.sql` im SQL-Editor **erneut**
ausführen. Die Datei ist idempotent (`create … if not exists`, `create or replace`,
`add column if not exists`) und behält alle Daten. Neu sind die Tabellen für Plan,
Kommentare, Vorlagen und Wochenwerte sowie die feste Bedeutung „Kasse“/„VP“ der
Bereiche KA und VP. `tests/umstellung.test.mjs` belegt das: Eine Stufe-0-Datenbank
mit Daten bekommt das aktuelle Schema zweimal, die Daten bleiben gleich.

**Von Stufe 1 auf Stufe 2:** ebenfalls nur `supabase/schema.sql` im SQL-Editor
**erneut** ausführen; die Datei ist idempotent und behält alle Daten. Neu sind die
Tabellen für IST (`ist_bloecke`, `ist_tage`, `ist_leer`), Wochenabschlüsse und das
Zeitkonto-Journal samt Nachbuch-Triggern, die Spalte „Gutschrift im Zeitkonto“ der
Abwesenheitscodes (ZA aus) und die Einstellung `ist_ab`. **`ist_ab` steht danach auf
dem Montag der Woche, in der das Schema eingespielt wurde** (Start der IST-Erfassung);
früher oder später starten geht nur vor dem ersten Wochenabschluss (Einstellungen →
„IST-Erfassung ab“). Startsalden aus der bisherigen Zeiterfassung vor dem ersten
Abschluss eintragen (ANLEITUNG, Abschnitt 1). `tests/umstellung.test.mjs` spielt das
aktuelle Schema auch auf eine eingefrorene Stufe-1-Datenbank
(`tests/fixtures/pep-schema-stufe-1.sql`).

## Sicherheitsprinzip

Das Repository ist öffentlich, die Daten sind es nicht. Alle Tabellen liegen im
Schema `pep`; Row Level Security ist eingeschaltet, es gibt bewusst keine Policies,
und `anon`/`authenticated` haben keinen Zugriff auf das Schema. Der Browser ruft
ausschließlich `SECURITY DEFINER`-Funktionen `public.pep_*` auf, die Anmeldung,
Rolle (Leitung, Stellvertretung, Mitarbeiter) und Filiale serverseitig prüfen;
`anon` (ohne Anmeldung) darf davon nur `pep_lebenszeichen` aufrufen (Weckruf, liest nichts).
Die Anmeldung läuft über die Konten des Urlaubstools. Der Schlüssel in
`docs/config.js` ist absichtlich öffentlich. `tests/rechte.test.mjs` prüft jede
`public.pep_*`-Funktion: neue Funktionen müssen dort eingetragen werden.

## Pausieren verhindern und Projekt wiederherstellen

Das kostenlose Supabase-Projekt wird nach etwa sieben Tagen mit wenig Aktivität
pausiert. Dagegen ruft GitHub alle zwei Tage von selbst eine harmlose Funktion
(`pep_lebenszeichen`) auf; sie liest keine Daten. Das erledigt der Workflow
„Weckruf“ (`.github/workflows/weckruf.yml`), es ist nichts zu tun.

- **Vor dem ersten Lauf** muss `pep_lebenszeichen` in Supabase eingespielt sein.
  Sie gehört zum Schema-Update (`supabase/schema.sql` im SQL-Editor ausführen).
- **Schlägt ein Lauf fehl**, schickt GitHub eine E-Mail.
- **GitHub schaltet zeitgesteuerte Workflows ab**, wenn das Repository 60 Tage
  ohne Änderung bleibt. Dann auf GitHub unter Actions → Weckruf auf
  „Enable workflow“ klicken.
- **Wurde das Projekt trotzdem pausiert:** im Supabase-Dashboard das Projekt
  öffnen und „Restore project“ wählen. Die Daten bleiben erhalten, wenn das
  innerhalb von 90 Tagen geschieht.
- Ein Projekt trägt PEP und das Urlaubstool zusammen; der Weckruf schützt beide.

## Sicherung

Supabase sichert im kostenlosen Tarif nichts. Die Leitung lädt unter Einstellungen →
Sicherung eine JSON-Datei mit allen Daten der Filiale herunter (`pep_sicherung`) und
kann sie in eine **leere** Filiale einspielen (`pep_sicherung_pruefen` für die Vorschau,
`pep_sicherung_einspielen`), z. B. nach einem Datenverlust in ein neues Projekt.
Schritte und Grenzen: [ANLEITUNG.md](ANLEITUNG.md), Abschnitt „Sicherung“.

- **Format** (`version: 1`, im Kopf des Abschnitts „Sicherung“ in `schema.sql`):
  `filiale`, `benutzer` (Benutzername und Rolle), `konten` (user_id → Benutzername),
  `tabellen` (jede Tabelle mit allen Spalten, nach Primärschlüssel; `protokoll` nur ab
  `protokoll_ab` = jetzt − 12 Monate), `anzahl`, `urlaub` (Titel, Jahr und Organisator
  jeder Umfrage, Name jedes Teilnehmers) und `pruefsumme` = md5 über den Text von
  `tabellen`. Zahlen stehen in der Form, die JavaScript schreibt, damit die Prüfsumme
  `JSON.parse`/`JSON.stringify` im Browser übersteht. Geprüft wird auch die Kette des
  Journals (`saldo_nach` = vorheriges + `stunden`).
- **Vollständigkeit:** `pep.sicherung_tabellen()` (gesichert, in Einspiel-Reihenfolge)
  und `pep.sicherung_ausnahmen()` (mit Grund: `sicherungen`, `zeitkonto_vormerkungen`,
  `filialen` und `benutzer` als eigene Abschnitte). `tests/sicherung.test.mjs` schlägt
  fehl, wenn eine Tabelle des Schemas `pep` in keiner der beiden Listen steht, wenn eine
  `…_id`-Spalte kein Fremdschlüssel ist, eine jsonb-Spalte nicht eingeordnet ist oder ein
  Fremdschlüssel-Ziel in der Liste nach der verweisenden Tabelle steht.
  **Neue Tabelle in einer späteren Stufe → dort eintragen.**
- **Einspielen:** neue Ids; Verweise zwischen pep-Tabellen über die Fremdschlüssel im
  Katalog umgeschlüsselt, dazu die Ids in `vorlagen.daten`; Benutzer über den
  Benutzernamen; die Nachbuch-Trigger laufen nicht (`pep.einspielen`), das Journal kommt
  mit seinen Werten. Urlaubstool-Verweise (Schaltung, Zuordnung, Ids im Wunsch einer
  Freigabe) über Organisator/Titel/Jahr bzw. Namen, weil das Urlaubstool beim eigenen
  Einspielen neue Ids vergibt; erlaubt sind nur Umfragen nach `pep.umfrage_erlaubt`
  (dieselbe Regel wie beim Einschalten: Organisator ist Leitung der Filiale; die
  Benutzer der Datei werden darum vorher zugeordnet). Eine Datei einer neueren Stufe (unbekannte Tabelle
  mit Zeilen oder Spalte mit Werten) lehnt schon die Vorschau ab (`SICHERUNG_NEUER`);
  einer älteren fehlende Einstellungen ergänzt `pep.grundausstattung`.

## Verhältnis zum Urlaubstool

PEP nutzt dieselbe Supabase-Datenbank. Das Schema `urlaub` des Urlaubstools bleibt
unverändert: PEP liest daraus nur (Konten, Umfragen, Teilnehmer und Antworten der
Urlaubswünsche) und schreibt nie hinein. Freigaben und Zuordnungen speichert PEP
im eigenen Schema `pep`.

## Tests

```
npm install
npm test
```

Stand Stufe 2: **361 Tests, alle grün** (rund 35 s). Die zwei Startbestand-Tests
lesen `privat/stammdaten-aschaffenburg.sql` und werden ohne diese Datei
übersprungen; alle anderen Tests laufen in jedem Checkout.

## Vorschau

Die Oberfläche lässt sich ohne Supabase ansehen, mit erfundenen Daten.

- **Daten erzeugen:** `node tests/vorschau/daten-erzeugen.mjs` baut in PGlite einen
  Bestand mit erfundenen Namen („Test, Anna“ …) und schreibt die echten
  Funktionsausgaben nach `tests/vorschau/daten/<funktion>.json`. Stichtag ist der
  02.11.2026, die Planwoche KW 46/2026.
- **Server:** `node tests/vorschau/server.mjs [port]` liefert das Repo aus.
  `http://localhost:8123/vorschau?ansicht=einsatzplan` zeigt `docs/index.html`; statt
  `app.js` lädt dabei `tests/vorschau/app-attrappe.js`, das die JSON-Dateien liefert.
  Schreibende Aufrufe tun nichts. Weitere Parameter (z. B. `klick=`, `toast=`) sind
  in der Attrappe beschrieben.
- **Foto:** `node tests/vorschau/foto.mjs <ansicht> tests/vorschau/<name>.png 1440 900`
  macht mit Chrome oder Edge (headless) ein Bildschirmfoto; mit Endung `.pdf` druckt
  es die Seite als PDF (`ansicht=druck`, Parameter `art=woche|tag|tage|monat|resturlaub`).
  PNG- und PDF-Dateien in `tests/vorschau/` sind gitignored.

## Browser-Test

Durchklickt die echte Oberfläche in Chrome (headless) gegen die echten SQL-Funktionen.

- **Lauf:** `node tests/browser/szenarien.mjs [filter]` startet den Testserver und Chrome,
  spielt **56 Szenarien** durch (Maus und Touch, Tablet 1024×768; rund 2,5 min) und
  prüft jeweils Oberfläche und Datenbankstand. Die Szenarien 1–44 decken Stufe 1 ab,
  45–54 IST-Erfassung, Zeitkonto, die neuen Kacheln und Ausdrucke von Stufe 2, 55 die
  Sicherung (herunterladen, in eine zweite, leere Filiale einspielen), 56 die
  Urlaubstool-Umfrage einer zweiten Leitung samt Zuordnungsvorschlägen. Fotos,
  PDFs, die Excel-Dateien und `ergebnis.json` landen in `tests/browser/fotos/` (gitignored).
- **Server:** `tests/browser/server.mjs` baut die Datenbank wie `tests/helfer.mjs` in
  PGlite, füllt sie mit erfundenen Daten (`daten.mjs`, Stichtag 02.11.2026, Start der
  IST-Erfassung 02.11.2026; ab Szenario 45 stellt der Test heute auf 16.11.2026) und bildet
  PostgREST (`/rest/v1/rpc/…`) und die Anmeldung nach. `docs/` läuft unverändert, nur
  `config.js` zeigt auf den Testserver und die CSP erlaubt `connect-src 'self'`.
  Allein gestartet (`node tests/browser/server.mjs 8124`) lässt sich unter
  `http://localhost:8124/browser/` von Hand testen: `chef` oder `vize`, Passwort `test`.
- **Treiber:** `tests/browser/cdp.mjs` steuert Chrome (ersatzweise Edge) über das
  DevTools-Protokoll, ohne weitere Abhängigkeit (Node 22+).
- **Grenzen:** Der Testserver führt alle RPCs streng nacheinander aus (eine
  PGlite-Verbindung); Wettläufe zwischen gleichzeitigen Anfragen wie beim echten
  PostgREST mit Verbindungs-Pool kommen also nicht vor. Den `apikey`-Header prüft er
  nicht. Alle Szenarien eines Laufs teilen sich einen Datenbankstand, auch mit
  `[filter]`: spätere Szenarien können auf Daten früherer aufbauen, ein gefilterter
  Lauf kann deshalb anders ausgehen als der volle.

## Ausblick

Nächste Stufen: Bedarfsplanung (Vorgaben je Bereich und Uhrzeit), eine Seite für die
Rolle „Mitarbeiter“, Tausch und Fairness auf der Startseite.

# PEP – Personaleinsatzplanung

Webseite für die Personaleinsatzplanung einer Filiale: Mitarbeiter mit Verträgen,
Kompetenzen und Urlaubsansprüchen, Einstellungen (Öffnungszeiten, Bereiche,
Abwesenheitscodes, Schulferien) und ein Abwesenheitskalender, in den auch die
Urlaubswünsche aus dem Urlaubstool einfließen (Stufe 0). Dazu kommen in Stufe 1
der Einsatzplan in halben Stunden mit Regelprüfung, Kopieren und Vorlagen,
Krankmeldung mit Ersatzsuche, Eckdaten, die Vorausplanung über sechs Wochen, die
Ausdrucke mit Excel-Export und die Startseite.
Einrichtung und Bedienung: [ANLEITUNG.md](ANLEITUNG.md).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `docs/` | Statische Seite (GitHub Pages), ohne Framework und ohne Build. `index.html`, `main.js` (Einstieg), `app.js` (Anmeldung, Reiter), `api.js`, `sitzung.js`, `config.js`, `hilfe.js` (Helfer, Fehlertexte), `dialog.js`, `style.css` |
| `docs/` – Reiter | `start.js` (Startseite), `abwesenheiten.js`, `vorausplanung.js`, `einsatzplan.js`, `mitarbeiter.js`, `einstellungen.js` |
| `docs/` – Einsatzplan | `plan-raster.js` (reine Logik: Zeitraster, Striche, Abdeckung, Stunden, Rückgängig), `plan-dialoge.js` (Kopieren, Vorlagen, Krank/ZA, Ersatz, Eckdaten) |
| `docs/` – Druck | `druck.js` (Druckansicht und Auswahl-Dialoge), `druck-daten.js` (reine Aufbereitung), `xlsx.js` (Excel-Datei ohne Bibliothek) |
| `docs/` – reine Logik | `kalender.js` (Monatsraster der Abwesenheiten), `zeit.js` (Uhrzeiten, ISO-Wochen, KW 53) |
| `supabase/schema.sql` | Schema `pep` mit allen Tabellen, Prüffunktionen (z. B. `pep.pruefung`, `pep.woche_kennzahlen`) und den Browser-Funktionen `public.pep_*`. Eine idempotente Datei: erneutes Ausführen ist unschädlich und behält die Daten |
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

## Sicherheitsprinzip

Das Repository ist öffentlich, die Daten sind es nicht. Alle Tabellen liegen im
Schema `pep`; Row Level Security ist eingeschaltet, es gibt bewusst keine Policies,
und `anon`/`authenticated` haben keinen Zugriff auf das Schema. Der Browser ruft
ausschließlich `SECURITY DEFINER`-Funktionen `public.pep_*` auf, die Anmeldung,
Rolle (Leitung, Stellvertretung, Mitarbeiter) und Filiale serverseitig prüfen.
Die Anmeldung läuft über die Konten des Urlaubstools. Der Schlüssel in
`docs/config.js` ist absichtlich öffentlich. `tests/rechte.test.mjs` prüft jede
`public.pep_*`-Funktion: neue Funktionen müssen dort eingetragen werden.

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

Stand Stufe 1: **246 Tests, alle grün** (rund 30 s). Die zwei Startbestand-Tests
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
  spielt alle Szenarien der Stufe 1 durch (Maus und Touch, Tablet 1024×768) und prüft
  jeweils Oberfläche und Datenbankstand. Fotos, PDFs, die Excel-Datei und
  `ergebnis.json` landen in `tests/browser/fotos/` (gitignored).
- **Server:** `tests/browser/server.mjs` baut die Datenbank wie `tests/helfer.mjs` in
  PGlite, füllt sie mit erfundenen Daten (`daten.mjs`, Stichtag 02.11.2026) und bildet
  PostgREST (`/rest/v1/rpc/…`) und die Anmeldung nach. `docs/` läuft unverändert, nur
  `config.js` zeigt auf den Testserver und die CSP erlaubt `connect-src 'self'`.
  Allein gestartet (`node tests/browser/server.mjs 8124`) lässt sich unter
  `http://localhost:8124/browser/` von Hand testen: `chef` oder `vize`, Passwort `test`.
- **Treiber:** `tests/browser/cdp.mjs` steuert Chrome über das DevTools-Protokoll,
  ohne weitere Abhängigkeit (Node 22+).

## Ausblick

Nächste Stufen: Bedarfsplanung (Vorgaben je Bereich und Uhrzeit), IST-Erfassung
und Zeitkonto, eine Seite für die Rolle „Mitarbeiter“, Tausch und Fairness auf der
Startseite.

# PEP – Personaleinsatzplanung

Webseite für die Personaleinsatzplanung einer Filiale: Mitarbeiter mit Verträgen,
Kompetenzen und Urlaubsansprüchen, Einstellungen (Öffnungszeiten, Bereiche,
Abwesenheitscodes, Schulferien) und ein Abwesenheitskalender, in den auch die
Urlaubswünsche aus dem Urlaubstool einfließen. Stufe 0 ist das Grundgerüst.
Einrichtung und Bedienung: [ANLEITUNG.md](ANLEITUNG.md).

## Aufbau

| Pfad | Inhalt |
|---|---|
| `docs/` | Statische Seite (GitHub Pages): `index.html`, `main.js` (Einstieg), `app.js` (Anmeldung, Reiter), Reiter-Module `mitarbeiter.js`, `einstellungen.js`, `abwesenheiten.js`, `kalender.js` (reine Logik), außerdem `api.js`, `sitzung.js`, `hilfe.js`, `config.js`, `style.css` |
| `supabase/schema.sql` | Schema `pep` mit allen Tabellen, Prüffunktionen und den Browser-Funktionen `public.pep_*`. Einmal im SQL-Editor ausführen; erneutes Ausführen ist unschädlich |
| `supabase/schulferien-BY.sql` | Schulferien Bayern 2026/27 und 2027/28 für Filiale 2558 (Quelle im Kopf), idempotent |
| `tests/` | Tests gegen eine lokale Postgres-Instanz (PGlite) mit nachgebildeten Supabase-Rollen und dem eingefrorenen Urlaubstool-Schema (`tests/fixtures/`) |
| `privat/` | Nicht im Repo (gitignored): Startbestand mit echten Namen, Referenzmaterial |

## Sicherheitsprinzip

Das Repository ist öffentlich, die Daten sind es nicht. Alle Tabellen liegen im
Schema `pep`; Row Level Security ist eingeschaltet, es gibt bewusst keine Policies,
und `anon`/`authenticated` haben keinen Zugriff auf das Schema. Der Browser ruft
ausschließlich `SECURITY DEFINER`-Funktionen `public.pep_*` auf, die Anmeldung,
Rolle (Leitung, Stellvertretung, Mitarbeiter) und Filiale serverseitig prüfen.
Die Anmeldung läuft über die Konten des Urlaubstools. Der Schlüssel in
`docs/config.js` ist absichtlich öffentlich.

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

Der Startbestand-Test liest `privat/stammdaten-aschaffenburg.sql` und wird ohne
diese Datei übersprungen; alle anderen Tests laufen in jedem Checkout.

## Ausblick

Stufe 1: Einsatzplan mit Regelprüfung, Kopieren, Vorlagen, Eckdaten und
„Ersatz finden“ auf diesem Schema.

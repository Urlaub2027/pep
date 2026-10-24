# PEP – Personaleinsatzplanung für eine Netto-Filiale

Übergabe an Claude Code. Dieses Dokument enthält alle Anforderungen aus dem Interview mit dem Filialleiter (24.10.2026) und der Analyse der bisherigen tegut-PEP.

## Kontext

- Filiale wechselt gerade von tegut zu Netto, daher kaum Netto-Erfahrungswerte → **alle Vorgaben müssen einstellbar sein**.
- Heute wird auf **Papier** geplant (Monatsplan, 3–4 h Aufwand). Stundenkonto ebenfalls auf Papier.
- Die tegut-PEP war funktional, aber **nicht nutzerfreundlich und kompliziert**. Oberstes Designziel: **einfache Bedienung**.
- Über 30 Mitarbeiter, keine festen Schichtmodelle, kein Betriebsrat.
- Es existiert bereits ein **Urlaubstool in diesem Repo** (Supabase als DB). Die PEP wird **in dieses Projekt integriert** und nutzt dieselbe Supabase-Datenbank und denselben Login.

## Arbeitsweise für Claude Code

1. Zuerst das bestehende Urlaubstool analysieren: Tech-Stack, Supabase-Schema, Auth, Rollen, Struktur. Kurz zusammenfassen.
2. Einen Plan vorschlagen, wie die PEP-Module in das Projekt passen (Schema-Erweiterungen als Migrationen, Routen, Komponenten). Vor dem Bauen bestätigen lassen.
3. In der Reihenfolge der Stufen unten bauen. Jede Stufe muss für sich nutzbar sein.
4. Bestehende Tabellen und Funktionen des Urlaubstools nicht brechen.
5. Supabase Row Level Security für alle neuen Tabellen.

## Rollen und Zugang

| Rolle | Rechte | Login |
| --- | --- | --- |
| Filialleitung | Alles: planen, freigeben, einstellen, Reports | Passkey übers Handy (Fallback: Passwort) |
| Stellvertretung | Planen, Abwesenheiten pflegen | Passwort oder Passkey |
| Mitarbeiter | Eigenen Plan sehen, Tausch anfragen, eigene Stunden sehen | Benutzername + Passwort |

Alles hinter Login, keine Seite öffentlich. Gemeinsamer Login mit dem Urlaubstool.

## Stammdaten

### Mitarbeiter
- Name, Personalnummer
- Vertragsart: Vollzeit, Teilzeit, Minijob, Azubi, **F (Führungskraft)**
- Vertragsstunden pro Woche
- Geburtsdatum (Jugendarbeitsschutz)
- Kompetenzen (Mehrfachauswahl, siehe unten)
- Individuelle Wochenvorgaben (siehe unten)

### Kompetenzen / Bereiche
- Funktionen: **Kasse**, **VP (Schlüssel, verantwortliche Person)**, Backoffice
- Eingabefelder im Raster (je halbe Stunde, Standard): Obst, Backen, Kasse, TroSo, MoPro, TK, FÜ, Reinigung, Pause
- Optional zuschaltbar (pro Filiale): Führung, Post, Reinigung, Kiosk, Getränkemarkt, Bedienbäckerei
- Jeder Bereich hat Kürzel und Farbe (für Raster und Druck)

### Abwesenheitscodes (einstellbar, Startset)
| Code | Bedeutung |
| --- | --- |
| U | Urlaub |
| KM | Krank (Arbeitsunfähigkeit) |
| BS | Berufsschule / Studium |
| ZA | Zeitausgleich |
| AF | Andere Filiale (Springer) |
| BV | Berufliche Veranstaltung (Schulung, Besprechung) |
| FT | Feiertag |
| NV | Nicht verfügbar |

## Datenfluss (von links nach rechts)

Die Module bauen aufeinander auf, Daten fließen immer nach rechts weiter:

**Abwesenheitsplanung → Vorausplanung → Bedarfsplanung → Einsatzplanung → IST-Erfassung → Zeitkonto/Journal**

- Abwesenheiten bestimmen die verfügbaren Stunden (Vorausplanung).
- Vorausplanung + Bedarf ergeben die Stundenvorgabe für die Einsatzplanung.
- Der fertige Einsatzplan wird als Vorbelegung in die IST-Erfassung übernommen.
- Die IST-Erfassung speist Zeitkonto und Journal.
- Navigation als Reiter in dieser Reihenfolge.

## Stufe 0 – Abwesenheitsplanung (GRUNDSTEIN, zuerst bauen)

- Monatsraster: Zeilen = Mitarbeiter, Spalten = Tage, gruppiert nach KW; **Schulferien und Feiertage immer sichtbar**.
- Abwesenheit per Klick setzen: Code wählen, Tag oder Zeitraum markieren.
- **Urlaub und Wünsche automatisch aus dem Urlaubstool**: Sobald ein Urlaub genehmigt ist, erscheint er hier (gleiche DB, kein doppeltes Eintragen). Storno hebt ihn wieder auf. Offene/abgelehnte Anträge werden nicht übernommen.
- Wünsche (frei, früh, spät) sperren nicht, sondern erscheinen als Hinweis.
- **Berufsschule wird hier gepflegt** (nicht im Urlaubstool), wiederkehrend (z. B. jeden Dienstag) oder als Block von–bis.
- Jede Abwesenheit **sperrt** den Mitarbeiter im Einsatzplan.
- Angerechnete Stunden je Abwesenheitstag: **Vertragsstunden ÷ 6** (37,5 h → 6,25 h; 30 h → 5,00 h). BS und AF mit tatsächlichen Stunden. Teiler einstellbar.

## Stufe 1 – Planungsrahmen + Einsatzplan mit Regelprüfung

### Planungsrahmen (Einstellungen)
- Öffnungszeiten pro Wochentag (Standard Mo–Sa 7:00–20:00).
- Rahmenzeiten Einsatzplanung pro Wochentag (Standard Mo–Sa 6:00–21:30). Feste Wochenvorlage.
- **Abweichende Tage**: Feiertage, Heiligabend, Silvester, Tag vor Feiertag, verkaufsoffener Sonntag mit eigenen Zeiten.
- Gesetzliche Feiertage automatisch nach Bundesland.
- Abteilungen per Haken an/aus.

### Einsatzplan (Tagesansicht)
- **Nur für künftige Tage.** Vergangene Tage sind im Einsatzplan schreibgeschützt; ein Klick darauf öffnet die IST-Erfassung.
- Raster in **halben Stunden** innerhalb der Rahmenzeit; Zeilen = Mitarbeiter.
- Bereiche per Klick/Ziehen „malen“ (Farbcodes), Pausen markieren.
- Pro Mitarbeiter und Tag ein **Kommentar/Aufgaben**-Feld (z. B. „TK abscannen, einräumen“).
- Seitenleiste: Soll-Stunden der KW vs. geplant, je Abteilung Plan/Vorgabe/Differenz.
- Gesperrte Mitarbeiter (Abwesenheit) können nicht eingeplant werden.
- Schichten außerhalb der Rahmenzeit nicht möglich.
- **Kopiervorlagen**: mehrere Tages-/Wochen-/Monatsvorlagen speichern, benennen, laden.

### Schnellerfassung KM/ZA im Einsatzplan
- Klick auf Mitarbeiter → „Krank“ / „Zeitausgleich“ für Tag/Zeitraum.
- Wird automatisch in die Abwesenheitsplanung geschrieben, Mitarbeiter gesperrt.
- Bereits geplante Schichten werden rot markiert → Krankmeldungs-Assistent (Stufe 2).

### Regelprüfung (live, als Warnung/Sperre)
- VP nie allein; zu jeder Öffnungszeit mind. eine VP.
- Mindestens eine Kasse besetzt.
- **Pausenablöse** muss möglich sein (jemand mit Kassenkompetenz übernimmt).
- **Meldung bei nicht erfüllter Pausenvorgabe**: 30 min ab 6 h, 45 min ab 9 h.
- **Spät auf früh**: Meldung bei zu kurzer Ruhezeit (11 h; Azubis/Jugendliche unter 18: 12 h).
- Höchstarbeitszeit: max. 10 h/Tag; unter 18: max. 8 h/Tag, 40 h/Woche.
- Soll-Stunden über-/unterschritten, Minijob-Grenze in Gefahr.
- **Pflicht-Wochenvorgaben** verletzt (siehe unten).

### Individuelle Wochenvorgaben pro Mitarbeiter
- Wochenmuster: Tage, Uhrzeiten, Bereiche, max. Stunden (z. B. „nur ab 14:00“, „nie samstags“).
- Gültig ab/bis.
- Pro Vorgabe wählbar: **Pflicht** (harte Regel, z. B. Teilzeit wegen Kinderbetreuung – Einplanen außerhalb blockiert, auch beim Krankheitsersatz) oder **bevorzugt** (nur Hinweis).

### Eckdaten-Fenster pro Mitarbeiter
- Freie Samstage (Monat/Quartal, einstellbar)
- Spätschichten letzte Woche → Hinweis „diese Woche eher früh“ (Grenze für „spät“ einstellbar, z. B. Ende nach 18:00)
- Urlaub/Abwesenheiten der Woche
- Zeitkonto-Stand, Soll/Ist der Woche, Kompetenzen, Wochenvorgaben

## Stufe 2 – Bedarf und halbautomatischer Vorschlag

### Bedarfslogik (aus tegut übernommen, vereinfacht, alles einstellbar)
1. Planumsatz pro Woche eintragen (**Pflichtfeld**: ohne Umsatz keine Stundenvorgabe).
2. Verteilung auf Tage in % (Startwerte z. B. Mo 14, Di 13, Mi 13, Do 13, Fr 20, Sa 27).
3. Tagesumsatz ÷ **Kassierleistung pro halbe Stunde** (z. B. 800–1.200 €) = Mindestanzahl Kassenfelder je halbe Stunde und Tag, mit Aufrundungsschwelle.
4. Bedarfsvorlage pro Wochentag (z. B. „immer 1 VP + mind. 1 Kasse“).
5. Summe = Stundenvorgabe; Vergleich mit verfügbaren Stunden (Vertragsstunden − Abwesenheiten) → Über-/Unterdeckung rot/grün.

### Zeitvorgaben für Lieferungen
- Zeitvorgabe pro Aufgabe frei einstellbar (Startwert z. B. Trockensortiment 45 min pro Rolli). Eigene Aufgaben anlegbar.
- Lieferung erfassen: Anzahl Rollis je Warengruppe.
- Tool rechnet: **12 Rollis × 45 min = 540 min = 9 h** → Vorschlag z. B. 2 MA × 4,5 h oder 3 MA × 3 h.

### Halbautomatischer Vorschlag
- Constraint-Solver (z. B. Google OR-Tools CP-SAT, als eigener Dienst/Edge Function) oder pragmatische Heuristik als Start.
- Harte Regeln: Gesetz, Kompetenzen, Abwesenheiten, Pflicht-Wochenvorgaben, Rahmenzeiten, VP/Kasse.
- Weiche Ziele: Wünsche, faire Samstage, Spät/Früh-Wechsel, Stundenausgleich zum Soll.
- Ergebnis ist ein Vorschlag; Filialleitung passt per Drag & Drop an.

### Krankmeldungs-Assistent
- Knopf „Ersatz finden“: zeigt Mitarbeiter mit passender Kompetenz, frei an dem Tag, Regel-konform, mit offenen Stunden – sortiert nach Eignung.
- Optional: Push-Anfrage „Kannst du einspringen?“

## Stufe 3 – Mitarbeiter-Seite
- Eigenen Plan, Urlaub und Stundenstand per Klick sehen (PWA).
- **Schichttausch** anfragen; Tausch wird erst wirksam, wenn die **Filialleitung freigibt**.
- Benachrichtigung bei Planänderung.

## Stufe 4 – Mehrere Filialen
- Datenmodell von Anfang an mit `filiale_id` (mandantenfähig), Funktionen aber erst später.
- Springer zwischen Filialen (AF), Übersicht für Bezirksleitung.

## IST-Erfassung
- **Für alle rückwirkenden Änderungen.** Vergangene Tage werden ausschließlich hier geändert.
- Gleiches Halbstunden-Raster wie der Einsatzplan, **vorbelegt mit dem Plan** des Tages.
- Filialleitung korrigiert nur Abweichungen (später gegangen, eingesprungen, Pause verschoben).
- „Erweiterung des Zeitrahmens“: IST darf über die Rahmenzeit hinausgehen (z. B. Inventur, Nachlauf).
- Erst die bestätigte IST-Zeit wird ins Zeitkonto und Journal gebucht; Abweichungen Plan ↔ IST protokolliert.
- Report IST-Erfassung (Tag/Woche).

## Zeitkonto
- Ersetzt das Papier-Stundenkonto, für alle Mitarbeiter.
- Wöchentlich: Saldo Vorwoche + (Ist-Stunden + angerechnete Abwesenheit − Vertragsstunden) = Saldo aktuell.
- **F-Verträge**: alle Stunden **über 42 h/Woche** werden erfasst und wie ein normales Zeitkonto dokumentiert (Grenze pro Vertrag einstellbar).
- **Feiertage tariflich anteilig** gutschreiben (Standard Vertragsstunden ÷ 6, Regel einstellbar), Soll der Woche sinkt entsprechend.
- ZA baut den Saldo ab.
- **Warnung**, wenn der Saldo im Verhältnis zur Arbeitszeit zu hoch wird (Standard: doppelte Wochenarbeitszeit, einstellbar).
- **Option: Zeitzuschlag in Spätzuschlag umwandeln** (Regel einstellbar, Netto-Vorgabe noch offen).

## Permanentes Stunden-Journal (Nachvollziehbarkeit)
- Append-only: jede Buchung (Datum, Mitarbeiter, Stunden, Art, laufende Summe) wird addiert, nie überschrieben.
- Korrekturen als neue Zeile mit Grund und Name.
- Änderungsprotokoll im Plan (wer, wann, was).
- Export pro Monat/Jahr als PDF und Excel.
- **Aufbewahrung 6 Monate**, danach automatische Löschung bzw. Archiv-Export.
- Hinweis: § 16 Abs. 2 ArbZG verlangt für Arbeitszeit über 8 h/Tag mind. 2 Jahre Aufbewahrung → Löschfrist konfigurierbar halten, mit HR klären.

## Reports / Druck (PDF, A4 quer)
1. **Tageseinsatzplan** für den Aushang: Kopf (Filiale, Datum, erstellt am), je Mitarbeiter Arbeitszeit + Kommentar/Aufgaben, farbiges Halbstunden-Raster.
2. **Wocheneinsatzplan**: je Mitarbeiter Vertragsstunden, Zeiten pro Tag, Arbeitszeit/Pause, Abwesenheiten mit Stunden (z. B. „U/6,25“), bez. Ist-Stunden, Differenz zu Vertragsstunden, Zeitkonto Vorwoche/aktuell.
3. **Urlaubsübersicht pro Mitarbeiter** zum Ausdrucken (genommen, geplant, Rest).
4. **Stundenausdruck** für Tag oder Woche, **als Einzelblatt pro Mitarbeiter** (wird an die Mitarbeiter ausgehändigt) oder Gesamtliste; zusätzlich Excel/CSV. Beim Weitergeben wird gleichzeitig ins Journal gebucht.

## Dashboard (Startseite)
Kacheln, die per Klick in die jeweilige Seite führen:
- Abwesenheiten diese Woche → Abwesenheitsplanung
- Stunden-Lücke pro Woche → Vorausplanung
- Regelverstöße → direkt an die Stelle im Einsatzplan
- Offene Tauschanfragen → Freigabe
- Fairness (Samstage, Spätschichten) → Eckdaten-Fenster

## Bewusst weggelassen (aus tegut)
- Zeilen zu Rahmenverträgen, Spezial-MA, Regalservice, Praktikanten.
- Doppelte Soll-Werte → eine Zahl.
- Selten genutzte Abwesenheitscodes zusammengefasst zu „T – Termin/Schulung“.

## Offene Punkte
- Aufteilung der Mitarbeiter nach Vertragsart (wird nachgereicht).
- Liefertage und Zeitvorgaben je Warengruppe (Netto neu, Erfahrungswerte folgen).
- Gibt es bei Netto einen wöchentlichen Planumsatz, und wer liefert ihn?
- Wie handhabt Netto die Umwandlung von Zeitzuschlag in Spätzuschlag?
- Tarifliche Feiertagsregel genau (Teiler 6 oder 5, Minijobber, Azubis) mit HR klären.
- Hinweis: Vor offiziellem Einsatz in der Filiale klären, ob Netto ein Konzernsystem vorschreibt, und Datenschutz (DSGVO) beachten.

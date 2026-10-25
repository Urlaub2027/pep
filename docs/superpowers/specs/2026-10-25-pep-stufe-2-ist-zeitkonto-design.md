# PEP Stufe 2 – IST-Erfassung, Zeitkonto und Journal: Design

Stand 25.10.2026. Baut auf Stufe 0 und 1 auf (Spec `2026-10-24-pep-stufe-0-1-design.md`, gemergt bis `main` a2517cf).
Markierungen: **[dtn]** = Entscheidung dtn, **[Filialleiter]** = Aussage des Filialleiters (Sprachnachricht 24.10.2026,
Handoff), **[meine Wahl]** = von mir entschieden, weil dtn auf Rückfragen verzichtet hat („Mache stufe 2 direkt drauf“).

## 1. Zweck

Der Filialleiter will rückwirkend je Woche zeigen können, wo ein Mitarbeiter Plus- oder Minusstunden aufgebaut hat:
„Nicht dass jemand nach drei Wochen kommt und fragt, warum er im Minus ist, und ich kann es nicht zeigen.
Transparenz und Glaubwürdigkeit.“ **[Filialleiter]** Netto speichert die Mehrarbeit offiziell selbst; die PEP führt
das Stundenkonto als nachvollziehbaren Beleg der Filiale, nicht als Lohngrundlage. Das Netto-System nutzt er nicht
**[Filialleiter]**, also trägt die Leitung die tatsächlichen Zeiten in der PEP ein.

Ablauf laut Handoff: Einsatzplan → IST-Erfassung → Zeitkonto/Journal. Der Plan eines Tages wird zur Vorbelegung der
IST-Erfassung; die Leitung korrigiert nur Abweichungen; erst bestätigte IST-Zeiten zählen im Zeitkonto.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

Ziele:
- IST-Erfassung je Tag im gleichen Halbstunden-Raster wie der Einsatzplan, vorbelegt mit dem Plan.
- Zeitkonto je Mitarbeiter und Woche mit Saldo Vorwoche → Saldo aktuell, Warnung bei zu hohem Saldo.
- Stunden-Journal: jede Buchung als neue Zeile, nie überschrieben, Korrekturen mit Grund und Name.
- Ausdrucke: Wocheneinsatz-IST (wie tegut `report-generator.pdf`), Stundenblatt je Mitarbeiter, Journal als Excel.
- Zwei Änderungen aus Stufe 1 **[dtn, 25.10.2026]**: Startseiten-Kachel „Abwesend“ zählt nur Urlaub (U) und Krank (KM);
  die Ersatzsuche schließt nur Kandidaten aus, die durch die Übernahme einen **neuen** Ruhezeit- oder
  Höchstarbeitszeit-Verstoß bekämen (bestehende Verstöße schließen nicht mehr aus).

Nicht-Ziele (spätere Stufen): Bedarfsplanung Kasse/Lieferzeiten, halbautomatischer Vorschlag, Mitarbeiter-App,
mehrere Filialen, Umwandlung von Zeitzuschlag in Spätzuschlag (Netto-Regel offen **[Filialleiter]**), Lohnexport,
Buchung beim Aushändigen eines Ausdrucks (Handoff-Idee, zu unklar).

Anti-Ziele: Pflichtfelder vor dem Arbeiten; stille Änderungen an gebuchten Wochen; ein Zeitkonto, dessen Stand
sich nicht aus dem Journal nachrechnen lässt.

## 3. Rahmen

Alles aus Stufe 0/1 gilt weiter: ein idempotentes `supabase/schema.sql`, nur `public.pep_*` (security definer,
`search_path = ''`), RLS ohne Policies, Protokoll für jede Schreibfunktion, `pep.heute()`, Halbstunden, keine echten
Namen im Repo, Tests mit PGlite, Vorschau-Fotos für Oberflächen. Umstellungstest gegen ein eingefrorenes
Stufe-1-Schema (`main` a2517cf), weil in Supabase echte Daten liegen.

## 4. IST-Erfassung

**Daten [meine Wahl]**: `pep.ist_bloecke` (gleiche Spalten wie `plan_bloecke`) und `pep.ist_tage`
(filiale_id, mitarbeiter_id, datum, bestaetigt_am, bestaetigt_von, primary key (mitarbeiter_id, datum)). Ein Tag eines
Mitarbeiters ist **offen** (kein `ist_tage`-Eintrag), oder **bestätigt**. Bereiche bleiben in den IST-Blöcken, damit
Plan und IST vergleichbar sind und das Raster wiederverwendet werden kann; für das Zeitkonto zählen nur die Stunden.

**Vorbelegung**: Ein offener Tag zeigt den Plan des Tages als IST-Vorschlag (nicht gespeichert). Der erste Strich auf
einem offenen Tag übernimmt den Plan dieses Mitarbeiters in `ist_bloecke` und wendet dann den Strich an. „Tag
bestätigen“ übernimmt für alle Mitarbeiter ohne eigene IST-Blöcke den Plan unverändert und setzt alle auf bestätigt.
Einzelne Zeilen lassen sich auch einzeln bestätigen.

**Regeln beim Malen [meine Wahl]**: IST bildet Tatsachen ab, darum gelten nur: Datum ≤ heute; Mitarbeiter mit
Vertrag am Tag; Halbstunden; kein Überlappen; ganztägige sperrende Abwesenheit → `ABWESEND` (erst Abwesenheit
ändern); Teilabwesenheit sperrt ihr Zeitfenster. **Nicht** geprüft werden Rahmenzeit („Erweiterung des Zeitrahmens“,
Handoff; zulässig 04:00–24:00), Kompetenz und Wochenvorgaben. Pause wie im Plan als eigener Bereich. Arbeitszeit
= Summe der Nicht-Pause-Blöcke (F4 aus Stufe 1).

**Ändern nach dem Bestätigen**: erlaubt, verlangt einen Grund (Pflichtfeld im Dialog, gespeichert im Protokoll). Liegt
der Tag in einer abgeschlossenen Woche, entsteht automatisch eine Korrekturbuchung im Journal (Abschnitt 5).

**Oberfläche [meine Wahl]**: Der Einsatzplan erhält oben einen Umschalter **Plan | IST**. Vergangene Tage und heute
öffnen sich im IST-Modus; künftige Tage nur im Plan-Modus. Im IST-Modus: Raster 04:00–24:00 mit Hinweis
„Zeitrahmen erweitert“, Plan als dünne Umrisslinie hinter den IST-Blöcken, je Zeile Status „offen“/„bestätigt“ und
Abweichung Plan↔IST in Stunden, Knopf „Tag bestätigen“, Seitenleiste mit Tagessumme Plan/IST und Zahl offener Tage
der Woche. Das Malen nutzt dieselbe Rasterlogik wie der Plan; die gemeinsame Zeichen- und Malfunktion wird dafür
aus `einsatzplan.js` in ein eigenes Modul gezogen.

**Rechte**: IST malen und bestätigen dürfen Leitung und Stellvertretung.

## 5. Zeitkonto und Journal

**Wochenrechnung (Handoff)**: Saldo aktuell = Saldo Vorwoche + (IST-Stunden + angerechnete Abwesenheit +
Feiertagsgutschrift − Vertragsstunden).
- IST-Stunden: nur bestätigte Tage, Arbeitszeit ohne Pause.
- Angerechnete Abwesenheit: Stunden der Abwesenheitszeilen der Woche, außer Codes ohne Gutschrift. Neue Spalte
  `abwesenheitscodes.gutschrift boolean default true`; **ZA** bekommt `false` („ZA baut den Saldo ab“, Handoff),
  im Reiter Einstellungen je Code schaltbar.
- Feiertagsgutschrift: je gesetzlichem Feiertag Mo–Sa, an dem die Filiale geschlossen ist,
  Vertragsstunden ÷ `feiertag_teiler` (Standard 6) **[Handoff]**. Ein als geöffnet eingestellter Feiertag gibt
  keine Gutschrift.
- Vertragsstunden: Vertrag der Woche (`pep.wochenvertrag` aus Stufe 1).
- **F-Verträge** (Handoff): Stunden über der Zeitkonto-Grenze des Vertrags (Standard 42) zählen als Plus. Unter den
  Vertragsstunden zählt die Differenz als Minus. Zwischen Vertragsstunden und Grenze zählt nichts **[meine Wahl]**.
- Unbestätigte Tage zählen nicht; die Woche zeigt „n Tage offen“.

**Abschluss [meine Wahl]**: Die Leitung schließt eine Woche ab („Woche buchen“). Dabei entsteht je aktivem
Mitarbeiter eine Journalzeile der Art `woche` mit der Wochendifferenz. Abschluss nur, wenn die Woche vorbei ist
(Sonntag < heute) und alle geöffneten Tage aller Mitarbeiter bestätigt sind, sonst Fehler mit der Zahl offener Tage.
Ändert sich danach etwas, das die Woche betrifft (IST, Abwesenheit, Vertrag, Feiertagseinstellung), bucht die
Datenbank automatisch die Differenz als `korrektur` mit erzeugtem Grund („IST 12.11. geändert: …“). So stimmt der
Saldo immer mit dem Journal überein.

**Journal** `pep.zeitkonto_buchungen` (id, filiale_id, mitarbeiter_id, jahr, kw, art `start|woche|korrektur|manuell`,
stunden, saldo_nach, grund, angelegt_von, angelegt_am). Append-only per Trigger (kein Update, kein Delete).
`saldo_nach` ist die laufende Summe je Mitarbeiter. Manuelle Buchungen (z. B. Auszahlung, Fehler aus tegut) und
der **Startsaldo** (Übertrag aus tegut, Spalte „+/- aktuell“ im tegut-Bericht) verlangen einen Grund; nur Leitung.

**Warnung**: Saldo über `zeitkonto_warnfaktor` × Wochenstunden (Standard 1 **[Filialleiter]**: „30 Stunden Vertrag
und 30 Stunden Plus, dann soll das System meckern“). Minus mit gleicher Grenze ebenfalls **[meine Wahl]**.

**Spätstunden**: Wochenweise Anzeige der IST-Stunden nach `spaet_grenze` (18:00) als Information (tegut-Spalte
„Zuschläge“); keine Buchung.

**Rechte [meine Wahl]**: Zeitkonto ansehen Leitung und Stellvertretung; Woche abschließen, Startsaldo und manuelle
Buchung nur Leitung.

**Oberfläche**: neuer Reiter **Zeitkonto** nach Einsatzplan: Wochenwahl, Tabelle je Mitarbeiter (Vertrag, IST,
Abwesend, Feiertag, Differenz, Saldo Vorwoche, Saldo aktuell, Spätstunden, offen/gebucht, Warnsymbol), Knopf „Woche
buchen“. Klick auf einen Namen öffnet das Journal mit laufender Summe, „Korrektur buchen“ und „Startsaldo“.
Eckdaten-Fenster: Zeitkonto-Stand statt Platzhalter. Startseite: zwei neue Kacheln „IST offen“ (Tage) und
„Zeitkonto auffällig“ (Personen über der Warngrenze).

## 6. Ausdrucke

- **Wocheneinsatz-IST** (Vorbild tegut `report-generator.pdf`): je Mitarbeiter Soll, je Tag Zeit von–bis mit
  Arbeitszeit und Pause, Abwesenheiten „U/6,25“, IST-Summe, Spätstunden, Differenz, Saldo Vorwoche/aktuell.
- **Stundenblatt je Mitarbeiter** (Woche oder Monat, eine Seite pro Person, Vorbild `report-isteingabe.pdf`): Datum,
  Anwesenheit von/bis, Pause, Abwesenheit, Arbeitszeit, laufender Saldo.
- **Journal** als Excel je Monat oder Jahr (gleicher xlsx-Weg wie Stufe 1).

## 7. Tests

Wie Stufe 1: jede neue Funktion mit Positiv- und Negativfall, Rechtetest-Einträge, fremde Filiale, Protokoll,
Umstellungstest Stufe 1 → 2. Fachfälle: Woche mit Feiertag, ZA-Woche, F-Vertrag über/zwischen/unter Grenze,
Vertragswechsel mitten in der Woche, Korrektur nach Abschluss (IST, Abwesenheit, Vertrag), Journal-Saldo = Summe,
Append-only-Trigger, KW 53. Oberfläche: Vorschau-Fotos und der Browser-Test aus `tests/browser/` (wird gerade
für Stufe 1 gebaut) um IST und Zeitkonto erweitert.

## 8. Dem Builder überlassen

Dateiaufteilung der Oberfläche, genaue Funktionssignaturen und Fehlercodes, Layout-Details, Reihenfolge der Aufgaben.

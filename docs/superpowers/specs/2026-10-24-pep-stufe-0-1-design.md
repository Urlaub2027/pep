# PEP – Personaleinsatzplanung, Design für Stufe 0 und 1

Stand 24.10.2026, **von dtn freigegeben am 24.10.2026**. Grundlage: `PEP_HANDOFF.md` (Interview mit dem Filialleiter),
die tegut-Bildschirme und -Reports unter `privat/tegut/`, und das Gespräch mit dtn.
Dieses Dokument beschreibt, **was** gebaut wird und **warum**. Der Bauplan
(Reihenfolge, Tasks) folgt daraus.

Kennzeichnung: Sätze mit **[dtn]** sind Entscheidungen des Auftraggebers.
Sätze mit **[meine Wahl]** habe ich getroffen; sie sind begründet und können
widerrufen werden. Alles andere stammt aus dem Handoff.

---

## 1. Zweck

Eine Netto-Filiale (bisher tegut, Aschaffenburg, über 30 Mitarbeiter) plant
heute Monatspläne auf Papier, drei bis vier Stunden je Monat, plus
Stundenkonto und Urlaubskalender auf Zetteln. Die tegut-PEP war funktional,
aber kompliziert. Die neue PEP soll dem Filialleiter das tägliche Planen
abnehmen und dabei **einfacher** sein als tegut.

Der Filialleiter plant **Tag für Tag** **[dtn]**. Der Hauptbildschirm ist
deshalb die Tagesansicht des Einsatzplans (von dtn an einer Skizze bestätigt).

Die drei Dinge, die ihn an tegut am meisten gestört haben **[dtn]**:
1. keine Kopierfunktion,
2. bei Krankheit nicht direkt gesehen, wer ersetzen kann,
3. ein Klick auf den Mitarbeiter muss mehr Informationen geben.

Alle drei sind Teil dieser Stufe.

Ergänzungen des Filialleiters (Sprachnachricht 24.10.2026, Transkript in
`privat/interview/2026-10-24-filialleiter-sprachnachricht.md`) sind unten mit
**[Filialleiter]** markiert.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

**Ziele dieser Stufe**
- Stammdaten der Mitarbeiter pflegen (Vertrag, Stunden, Kompetenzen, Wochenvorgaben).
- Abwesenheiten im Monatsraster pflegen; Urlaubswünsche aus dem Urlaubstool
  sehen und freigeben; Berufsschule wiederkehrend eintragen.
- Öffnungs- und Rahmenzeiten, Feiertage, Abteilungen einstellen.
- Einen Tag im Halbstunden-Raster planen, mit Live-Regelprüfung, Kopieren,
  Vorlagen, Kommentaren, Eckdaten-Fenster, Krank-Schnellerfassung und
  „Ersatz finden“.
- Einfache Vorausplanung: Soll-Stunden der Woche aus Planumsatz und
  Stundenleistung, verfügbare Stunden, Überhang.
- Ausdrucke: Tagesplan, Wochenplan, Abwesenheitsmonat, Resturlaub.
- Jede Änderung ist nachvollziehbar (Protokoll).

**Nicht-Ziele dieser Stufe** (kommen als eigene Designs auf diesem Datenmodell)
- Bedarfsplanung Kasse je Abteilung, Lieferzeit-Rechnung, Solver-Vorschlag.
- IST-Erfassung, Zeitkonto, Stunden-Journal mit Aufbewahrungsfrist.
- Mitarbeiter-Login, PWA, Schichttausch, Push-Benachrichtigung.
- Mehrere Filialen bedienen (Datenmodell ist vorbereitet, Oberfläche nicht).
- Passkey-Login (ob Supabase Auth das kann, ist ungeprüft; Passwort reicht jetzt).
- Schicht- und Verfügbarkeitswünsche (früh/spät/frei) aus dem Urlaubstool
  **[meine Wahl]**: Das Urlaubstool speichert sie als freie Auswahlfragen ohne
  festes Format; eine Zuordnung wäre geraten. Erst wenn ein Format steht.

**Anti-Ziele** (so wäre es ein Fehlschlag, auch wenn es läuft)
- Mehr Klicks als tegut für denselben Tag.
- Eine Oberfläche, die man erklären muss. Der Filialleiter plant ohne Anleitung.
- Regelverstöße, die man erst per Knopf suchen muss.
- Leere Pflichtfelder oder Formulare, bevor man planen darf.

## 3. Rahmenbedingungen

- **Eigenes Projekt** in `C:\Users\dtn\Documents\PEP` (eigenes git-Repo)
  **[dtn]**.
- **Keine personenbezogenen Daten im Repo** **[meine Wahl]**: Das Repo wird
  für GitHub Pages öffentlich sein. tegut-Reports (Namen, Krankheitstage,
  Personalnummern), das Transkript und die Startdatei mit Mitarbeiternamen
  liegen im Ordner `privat/`, der in `.gitignore` steht. Design und Plan
  nennen keine Mitarbeiternamen. Das Urlaubstool (`Urlaubsvertretung`, GitHub `Urlaub2027/urlaub`)
  wird nicht verändert.
- **Gleiche Supabase-Datenbank** wie das Urlaubstool (Handoff). Dort liegen
  die Tabellen des Urlaubstools im Schema `urlaub`; Zugriff aus dem Browser
  nur über `SECURITY DEFINER`-Funktionen in `public`; Tabellen mit RLS ohne
  Policies (damit ist direkter Tabellenzugriff gesperrt).
- **Login**: bestehende Supabase-Auth-Konten des Urlaubstools
  (Benutzername, intern `name@example.com`, Passwort). Neue Konten entstehen
  nur per Einladung des Urlaubstools (Trigger auf `auth.users`).
- **Alles hinter Login.** Die statische Seite ist öffentlich abrufbar, zeigt
  aber ohne Anmeldung nichts; Daten gibt es nur mit Token. Das ist dasselbe
  Schutzniveau wie das Urlaubstool; ein „gar nicht erreichbar“ ginge nur mit
  eigenem Server (Nicht-Ziel).
- Alle Vorgaben (Zeiten, Teiler, Grenzen, Codes, Farben) sind einstellbar,
  weil Netto-Erfahrungswerte fehlen (Handoff).
- Kein Betriebsrat, keine festen Schichtmodelle.

## 4. Technik **[meine Wahl]**

Gleiches Muster wie das Urlaubstool, weil dtn es kennt und pflegt, es nichts
kostet und die Regeln ohnehin serverseitig liegen müssen:

- **Browser**: reines JavaScript (ES-Module), HTML, CSS. Kein Framework, kein
  Build-Schritt. Strenge Content Security Policy wie `docs/index.html` im
  Urlaubstool. Hosting als statische Seite: neues Repo in der
  GitHub-Organisation `Urlaub2027`, GitHub Pages aus `docs/` **[dtn]**.
- **Datenbank**: PostgreSQL/Supabase. Neues Schema `pep`. Alle Logik in
  SQL/PL/pgSQL-Funktionen `public.pep_*` (`SECURITY DEFINER`,
  `set search_path = ''`), die Rolle und Filiale des Anrufers prüfen.
  RLS auf allen `pep`-Tabellen aktiviert, keine Policies.
- **Eine Datei `supabase/schema.sql`**, idempotent (`create … if not exists`,
  `create or replace`), wie im Urlaubstool. Für spätere Änderungen an
  bestehenden Tabellen gibt es wie dort einen Umstellungstest gegen eine
  eingefrorene ältere Schemaversion. Keine Migrations-Nummern.
- **Tests**: `node --test` mit PGlite und nachgebildeten Supabase-Rollen
  (Muster: `Urlaubsvertretung/tests/helfer.mjs`), plus reine Logikmodule
  ohne DOM. Kein Browser-Test.
- `api.js` und `sitzung.js` werden aus dem Urlaubstool kopiert, mit
  Kopfkommentar „Kopie aus Urlaub2027/urlaub, dort pflegen“.
- Die Feiertagsfunktion `urlaub.landesfeiertage(jahr, land)` wird
  wiederverwendet (gleiche Datenbank), nicht nachgebaut.

Schwäche dieser Wahl, offen benannt: Das Raster mit Malen, Ziehen und
Live-Warnungen ist mehr Oberflächencode als mit einem Framework. Das ist
Aufwand, kein Risiko.

## 5. Rollen

| Rolle | Darf |
| --- | --- |
| Leitung | alles: planen, Abwesenheiten, Urlaub freigeben, Stammdaten, Einstellungen, Benutzer der Filiale anlegen |
| Stellvertretung | planen, Abwesenheiten pflegen, Ausdrucke; **keine** Urlaubsfreigabe, keine Stammdaten/Einstellungen **[meine Wahl]**, abgeleitet aus Handoff „Planen, Abwesenheiten pflegen“ |
| Mitarbeiter | in dieser Stufe nicht vorgesehen (Rolle existiert in der Tabelle, hat keine Funktionen) |

`pep.benutzer (user_id, filiale_id, rolle)`. Der erste Leitungs-Benutzer wird
per SQL eingetragen (wie die Start-Einladung im Urlaubstool), weitere legt
die Leitung in den Einstellungen an, indem sie einen vorhandenen
Urlaubstool-Benutzernamen wählt.

**[dtn]** Akzeptiert: Jeder PEP-Benutzer ist damit zugleich Organisator im
Urlaubstool (Konten entstehen nur über dessen Einladung und landen in
`urlaub.organisatoren`). Ein im Urlaubstool gesperrtes Konto
(`organisatoren.gesperrt`) hat auch in der PEP keinen Zugang. Kein eigener
Einladungsweg in dieser Stufe.

Die Filiale selbst (Name, Nummer, Bundesland) legt der erste
Leitungs-Benutzer beim ersten Start in der Oberfläche an **[meine Wahl]**;
bis dahin zeigt die PEP nur diesen Schritt.

## 6. Datenmodell (Schema `pep`)

Alle Tabellen tragen `filiale_id`. In dieser Stufe gibt es genau eine Filiale.
Zeiten sind `time` auf halbe Stunden gerundet (Check-Constraint Minute 0/30).
Stunden sind `numeric(5,2)`.

**Stammdaten**
- `filialen` (id, name, nummer, bundesland, angelegt_am)
- `benutzer` (user_id → auth.users, filiale_id, rolle)
- `mitarbeiter` (id, filiale_id, name, personalnummer, geburtsdatum, aktiv,
  eintritt, austritt, notiz)
- `vertraege` (mitarbeiter_id, gueltig_ab, vertragsart
  `vollzeit|teilzeit|minijob|azubi|fuehrung`, wochenstunden,
  zeitkonto_grenze_wochenstunden für F, Standard 42) **[meine Wahl]**:
  Verträge mit Gültigkeit statt Feldern am Mitarbeiter, weil Stunden sich
  ändern und die Abwesenheitsstunden rückwirkend stimmen müssen.
  Wird ein Vertrag mit `gueltig_ab` in der Vergangenheit angelegt oder der
  Teiler geändert, rechnet die Funktion alle Abwesenheitszeilen mit
  `stundenregel = teiler` ab `gueltig_ab` neu, auch vergangene, mit einem
  Protokolleintrag (Anzahl, vorher/nachher je Zeile im `nachher`-JSON)
  **[meine Wahl]**: In dieser Stufe ist nichts gebucht, also gibt es nichts
  einzufrieren. Die Zeitkonto-Stufe muss gebuchte Wochen davon ausnehmen.
- `urlaubsjahre` (mitarbeiter_id, jahr, anspruch_stunden,
  rest_vorjahr_stunden). Urlaub wird **in Stunden** geführt, wie der
  tegut-Resturlaubsbericht (225,00 h bei 37,5 h).
- `bereiche` (id, filiale_id, kuerzel, name, farbe, art
  `bereich|funktion|pause`, kompetenz_noetig, aktiv, position).
  Startset: Kasse KA (kompetenz_noetig), Obst OG, Backen BB, TroSo TS,
  MoPro MO, TK, Führung FÜ, Reinigung RE, Backoffice BO, Pause PA
  (art pause, fest); optional Post PO, Kiosk KI, Getränkemarkt GM,
  Bedienbäckerei BE (inaktiv). Funktion VP (art funktion, nicht malbar,
  nur als Kompetenz).
- `kompetenzen` (mitarbeiter_id, bereich_id).
- `wochenvorgaben` (id, mitarbeiter_id, gueltig_von, gueltig_bis, pflicht,
  wochentag 1–7 oder null = alle, art `nicht_verfuegbar|nur_zwischen`,
  von, bis, max_stunden_tag, max_stunden_woche, notiz). Kein Bezug auf
  Bereiche **[meine Wahl]**: Wo jemand eingesetzt werden darf, regeln die
  Kompetenzen; eine Vorgabe gilt immer für die ganze Anwesenheit.
- `abwesenheitscodes` (id, filiale_id, code, name, farbe, stundenregel
  `teiler|tatsaechlich|keine`, sperrt, aktiv, position). Startset aus dem
  Handoff: U, KM, BS (tatsaechlich), ZA, AF (tatsaechlich), BV, FT, NV; plus
  T – Termin/Schulung. FT ist zusätzlich das, was ein gesetzlicher
  Feiertag automatisch erzeugt (siehe Abwesenheiten).

**Abwesenheiten**
- `abwesenheiten` (id, filiale_id, mitarbeiter_id, code_id, datum, stunden,
  von, bis (optional, halbe Stunden), quelle
  `manuell|urlaubstool|schnell|wiederholung`, wiederholung_id,
  freigabe_id, notiz, angelegt_von, angelegt_am). Mit `von`/`bis` sperrt
  die Abwesenheit nur diesen Zeitraum (Berufsschule bis 13:00, danach
  Arbeit; zweistündiger Termin); dann sind die Stunden immer
  `tatsaechlich` **[meine Wahl]**, weil die Spalte jetzt billig ist und
  später Raster, Sperre und Reports ändern würde. **Eine Zeile je Tag**
  **[meine Wahl]**: Zeiträume werden serverseitig in Tage zerlegt. Das macht
  Raster, Summen und Reports trivial; der Preis ist eine Zeile pro Tag, bei
  30 Mitarbeitern und 30 Tagen Urlaub im Jahr unter 1 000 Zeilen je Jahr.
- `wiederholungen` (id, mitarbeiter_id, code_id, wochentag, von_datum,
  bis_datum, stunden): erzeugt beim Anlegen die Tage bis `bis_datum`
  (Pflichtfeld, höchstens 12 Monate). Ändern oder Löschen entfernt alle
  künftigen erzeugten Tage und erzeugt neu; vergangene Tage bleiben.
- `schulferien` (filiale_id, von, bis, name): manuell gepflegt, Startwerte
  aus einer Datei für das Bundesland der Filiale **[meine Wahl]**, weil es
  keine verlässliche Quelle zum automatischen Abruf gibt.
- `tag_abweichungen` siehe Planungsrahmen.

**Urlaubstool-Anbindung**
- `urlaub_umfragen` (filiale_id, umfrage_id → urlaub.umfragen): welche
  Umfragen Wünsche liefern.
- `urlaub_zuordnung` (mitarbeiter_id, urlaub_mitarbeiter_id →
  urlaub.mitarbeiter): welcher Umfrage-Teilnehmer welcher PEP-Mitarbeiter
  ist. Vorschlag per Namensgleichheit, Bestätigung durch die Leitung.
- `urlaub_freigaben` (id, filiale_id, mitarbeiter_id, von, bis, status
  `offen|genehmigt|abgelehnt`, wunsch jsonb (Schnappschuss: Umfrage, KW
  oder Tage), entschieden_von, entschieden_am, notiz).

**Planungsrahmen**
- `rahmen` (filiale_id, wochentag, geoeffnet, oeffnung_von, oeffnung_bis,
  rahmen_von, rahmen_bis). Standard Mo–Sa 7:00–20:00 / 6:00–21:30, So
  geschlossen.
- `tag_abweichungen` (filiale_id, datum, art
  `feiertag|heiligabend|silvester|vor_feiertag|verkaufsoffen|sonstiges`,
  geoeffnet, oeffnung_von, oeffnung_bis, rahmen_von, rahmen_bis, name).
  Gesetzliche Feiertage werden aus `urlaub.landesfeiertage` gelesen und
  gelten als geschlossen, solange keine Abweichung etwas anderes sagt.
- `einstellungen` (filiale_id, schluessel, wert jsonb): alle Regelparameter
  (Abschnitt 12), Abwesenheitsteiler (6, gilt auch für Azubis
  **[Filialleiter]**), Spät-Grenze (18:00, dort beginnt der Spätzuschlag
  **[Filialleiter]**), freie Samstage (Ziel 1 je Monat, 12 je Jahr;
  Samstage im Urlaub zählen als frei **[Filialleiter]**),
  Standard-Stundenleistung, Standard-Kassierleistung (für die
  Bedarfsstufe; muss auf Netto-Niveau anpassbar sein **[Filialleiter]**),
  Zeitkonto-Warngrenze (Standard 1 × Wochenstunden **[Filialleiter]**, der
  Handoff sagte 2 ×; wirkt erst in der Zeitkonto-Stufe).

**Vorausplanung**
- `wochen` (filiale_id, jahr, kw, planumsatz, stundenleistung_eur_pro_h,
  stundenvorgabe_manuell). Ohne Planumsatz gilt als Stundenvorgabe die Summe
  der verfügbaren Stunden (siehe Abschnitt 10).

**Einsatzplan**
- `plan_bloecke` (id, filiale_id, mitarbeiter_id, datum, von, bis,
  bereich_id). Zusammenhängende Blöcke gleichen Bereichs, nicht Zellen
  **[meine Wahl]**: Malen im Browser wird serverseitig in Blöcke umgerechnet
  und benachbarte gleiche Blöcke verschmolzen. Reports und Regeln rechnen
  mit Blöcken. Constraint: kein Überlappen je Mitarbeiter und Tag.
- `plan_kommentare` (filiale_id, mitarbeiter_id, datum, text).
- `vorlagen` (id, filiale_id, name, art `tag|woche`, daten jsonb,
  angelegt_am). `daten` enthält Blöcke je Mitarbeiter und (bei Woche)
  Wochentag, relativ, ohne Datum.

**Protokoll**
- `protokoll` (id, filiale_id, zeit, user_id, aktion, tabelle, schluessel,
  vorher jsonb, nachher jsonb). Append-only: nur Insert-Recht über die
  Funktionen, kein Update/Delete. Jede schreibende `pep_*`-Funktion schreibt
  einen Eintrag.

## 7. Stammdaten (Reiter „Mitarbeiter“)

Liste aller Mitarbeiter (aktiv zuerst), Klick öffnet die Karte mit Name,
Personalnummer, Geburtsdatum, Verträgen (Verlauf, neuen Vertrag ab Datum
anlegen), Kompetenzen (Haken je Bereich mit `kompetenz_noetig` und je
Funktion), Wochenvorgaben (Liste, jede mit Pflicht/bevorzugt), Urlaubsjahr
(Anspruch, Rest Vorjahr), Zuordnung zum Urlaubstool-Teilnehmer.

Startbestand **[dtn]**: Die Mitarbeiter aus den tegut-Reports werden als
Datei `privat/stammdaten-aschaffenburg.sql` angelegt (Name und
Vertragsstunden aus `report-einsatzplanung-2.pdf`; Vertragsart aus den
Stunden abgeleitet, 37,5 h = Vollzeit, sonst Teilzeit) **[Filialleiter:
so ist es gemeint]**. Wer Azubi oder F ist, nennt der Filialleiter noch;
Minijobs gibt es keine, Azubis unter 18 derzeit keine. Die tegut-
Personalnummern werden **nicht** übernommen **[dtn]**; das Feld bleibt leer,
bis Netto-Nummern vorliegen.
Die zwei im tegut-Bild hellblau dargestellten Personen werden als inaktiv
angelegt. Die Datei ist ein Startpunkt; die Leitung korrigiert
in der Oberfläche. Der Handoff sagt, die Aufteilung nach Vertragsart wird
nachgereicht.

## 8. Abwesenheitsplanung (Reiter „Abwesenheiten“)

Monatsraster wie tegut (`privat/tegut/01-abwesenheitsplanung.jpg`): Zeilen =
aktive Mitarbeiter, Spalten = Tage, gruppiert nach KW, Wochenenden grau,
gesetzliche Feiertage und Schulferien farbig hinterlegt und benannt. Monat
vor/zurück. In jeder belegten Zelle Code und angerechnete Stunden
(z. B. „U 6,25“), wie im tegut-Monatsreport.

**Eintragen**: Code links wählen (Radio/Palette wie tegut), dann im Raster
klicken oder über mehrere Tage ziehen; für BS/AF fragt ein kleines Feld nach
den tatsächlichen Stunden (Vorbelegung: letzter Wert dieses Mitarbeiters).
Rechtsklick oder Klick mit Code „keine“ löscht. Ziehen lässt nur Tage aus,
an denen die Filiale **geschlossen** ist (laut `rahmen` und
`tag_abweichungen`, also Sonntag und Feiertage); der Samstag zählt mit.
**[meine Wahl, Beleg tegut]**: Der Teiler 6 ist eine Sechs-Tage-Basis
(37,5 h ÷ 6 = 6,25 h), und in `report-abwesenheit-1.pdf` haben zwei
Teilzeitkräfte je sechs U-Tage Mo–Sa in einer Woche. Eine ganze Urlaubswoche
kostet damit 6 × 6,25 = 37,5 h = eine Vertragswoche. Wer nie samstags
arbeitet, bekommt trotzdem sechs Tage angerechnet, wie bei tegut. Alles wird sofort gespeichert; kein
Speichern-Knopf (tegut hatte einen, das ist eine Fehlerquelle).

**Angerechnete Stunden**: `wochenstunden ÷ teiler` (Standard 6) für Codes mit
`stundenregel = teiler`, gerundet auf 2 Stellen; `tatsaechlich` fragt nach;
`keine` = 0. Teiler je Filiale einstellbar. Gesetzliche Feiertage werden
**nicht** als Abwesenheitszeilen gespeichert **[meine Wahl]**: Sie kommen
aus `urlaub.landesfeiertage`, sind im Raster hinterlegt, gelten als
geschlossen (kein Plan möglich, keine Sperre nötig) und werden beim Ziehen
ausgelassen. Stellt die Leitung einen Feiertag auf „geöffnet“, ist er ein
normaler Plantag. Die tarifliche Gutschrift (Teiler für FT separat
einstellbar, Standard 6; Handoff: mit HR klären) rechnet erst die
Zeitkonto-Stufe aus Vertrag und Feiertagsliste. Der Code FT bleibt für
manuelle Fälle (z. B. Betriebsruhe) im Startset.
Je Mitarbeiter und Tag gibt es höchstens eine Abwesenheit (Unique).

**Berufsschule**: eigener Dialog „wiederkehrend“: Wochentag, Gültigkeit
von–bis, optional Uhrzeit von–bis (sonst ganzer Tag), Stunden; alternativ
Block von–bis als normaler Zieh-Eintrag.

**Urlaubswünsche aus dem Urlaubstool** **[dtn: Übernahme erst nach Freigabe
durch die Leitung]**:
- Die Funktion `pep_urlaubswuensche(monat)` liest für zugeordnete
  Mitarbeiter die Antworten der Urlaubswochen-Frage der verknüpften
  Umfragen über `urlaub.antwort_wochen` (KW-Nummern) und
  `urlaub.antwort_tage` (einzelne Tage als „YYYY-MM-DD“); Jahr und
  Bundesland stehen an der Frage. Nur Umfragen mit Abgabe (`urlaub.abgaben`).
  **Achtung Stand**: Diese beiden Funktionen und die Einzeltage gibt es erst
  auf `origin/main` des Urlaubstools (PRs #3/#4, Oktober 2026); der lokale
  Checkout unter `Urlaubsvertretung` hängt dahinter. Maßgeblich ist
  `origin/main`.
- **[meine Wahl]** Das Urlaubstool wird nicht angefasst; die PEP liest nur
  über diese zwei Funktionen (der Schema-Kommentar dort erklärt sie zur
  einzigen erlaubten Lesart der Antwort). Der PEP-Test lädt eine
  **eingefrorene Kopie** des Urlaubstool-Schemas aus `tests/fixtures/`
  (kein Pfad ins Nachbar-Repo); beim Nachziehen der Kopie zeigt der Test,
  ob die Lesart noch stimmt.
- Fremdschlüssel aus `urlaub_zuordnung` auf `urlaub.mitarbeiter` mit
  `on delete set null`, damit Löschen im Urlaubstool weiter funktioniert.
- Wünsche erscheinen im Raster als **umrandete, nicht gefüllte** Zellen mit
  „U?“. Sie sperren nichts.
- Klick auf einen Wunsch öffnet: Zeitraum (ganze KW = alle geöffneten
  Tage Mo–Sa, einzelne Tage), „Genehmigen“ / „Ablehnen“ / Zeitraum
  anpassen. Die Einstellung `arbeitstage_pro_woche` der Umfrage spielt für
  die Stunden keine Rolle. Genehmigen erzeugt
  die U-Tage (quelle urlaubstool, freigabe_id) und die Zelle wird voll.
  Abgelehnte Wünsche werden blass dargestellt, bleiben aber sichtbar.
- Ändert oder entfernt der Mitarbeiter seinen Wunsch später im Urlaubstool,
  bleibt eine genehmigte Abwesenheit bestehen, bekommt aber eine Markierung
  „Wunsch zurückgezogen/geändert“; die Leitung entfernt sie mit einem Klick
  **[meine Wahl]**, weil eine Genehmigung eine Entscheidung der Leitung ist
  und nicht stillschweigend verschwinden darf.
- Urlaub lässt sich auch ohne Wunsch direkt als U eintragen (Zuruf, Papier).

**Seitenleiste**: je Mitarbeiter Urlaubsanspruch, genehmigt, offen gewünscht,
Rest (in Stunden, zusätzlich in Tagen = Stunden ÷ Tagesstunden des Vertrags).

## 9. Einstellungen (Reiter „Einstellungen“, nur Leitung)

Wie `privat/tegut/02-planungsrahmen.jpg`, aber als eine Seite mit Abschnitten:
- Öffnungszeiten und Rahmenzeiten je Wochentag (Wochenvorlage).
- Abweichende Tage: Liste mit Datum, Art, Zeiten; gesetzliche Feiertage des
  Bundeslands erscheinen automatisch und lassen sich auf „geöffnet“ mit
  Zeiten umstellen (verkaufsoffener Sonntag, Tag vor Feiertag).
- Abteilungen/Bereiche: Reihenfolge, Kürzel, Farbe, aktiv, Kompetenz nötig.
- Abwesenheitscodes: Liste, bearbeitbar.
- Regelparameter (Abschnitt 12) mit Standardwerten und Erklärung je Feld.
- Schulferien: Liste von–bis, Name; Import aus Datei.
- Urlaubstool: alle Umfragen mit Urlaubswochen-Frage werden angeboten, die
  Leitung hakt an, welche gelten **[dtn]**; Zuordnung der Teilnehmer.
- Benutzer der Filiale: Urlaubstool-Benutzername wählen, Rolle setzen.

## 10. Vorausplanung (Reiter „Vorausplanung“)

Sechs Wochen nebeneinander ab gewählter KW, wie `privat/tegut/05-vorausplanung.jpg`,
auf eine Zahl je Zeile reduziert (Handoff: „Doppelte Soll-Werte → eine Zahl“,
Rahmenverträge/Spezial-MA/Regalservice weg):

| Zeile | Rechnung |
| --- | --- |
| Planumsatz (Netto) | Eingabe |
| Stundenleistung €/h | Eingabe, Vorbelegung aus Einstellungen |
| Soll-Stunden | Planumsatz ÷ Stundenleistung, gerundet auf 0,5 |
| Vertragsstunden | Summe Wochenstunden aller aktiven Mitarbeiter (Vertrag gültig in der KW) |
| Abwesenheiten, davon Urlaub | Summe angerechneter Stunden der KW |
| Verfügbar | Vertragsstunden − Abwesenheiten |
| Überhang | Verfügbar − Soll-Stunden, rot wenn negativ, grün sonst |
| Stundenvorgabe Einsatzplan | Soll-Stunden; ohne Planumsatz = Verfügbar; manuell überschreibbar |

Der Handoff macht den Planumsatz zum Pflichtfeld. **[Filialleiter]**: Ein
Wochenumsatzplan wird von Netto vorgegeben und von Hand eingetragen.
**[meine Wahl]**: Fehlt er noch, wird trotzdem geplant; die Vorgabe ist dann
„Verfügbar“ und die Seitenleiste sagt „ohne Planumsatz“ (Anti-Ziel
„Pflichtfelder vor dem Planen“).

## 11. Einsatzplan (Reiter „Einsatzplan“) – der Hauptbildschirm

Aufbau wie die bestätigte Skizze (`.superpowers/brainstorm/*/content/tagesansicht.html`)
und `privat/tegut/03-einsatzplanung-woche.jpg`:

**Kopf**: KW-Wahl, sieben Tages-Reiter (Mo–So mit Datum und Öffnungszeit,
geschlossene Tage grau), Knöpfe „Kopieren“, „Vorlagen“, „Drucken“.

**Pinsel**: alle aktiven Bereiche als farbige Felder mit Kürzel, dazu Pause
und Radieren. Einer ist gewählt (Standard: der zuletzt benutzte).

**Raster**: Zeilen = alle aktiven Mitarbeiter der Filiale in fester
Reihenfolge (Einstellungen: Reihenfolge per Ziehen, sonst alphabetisch);
abwesende Mitarbeiter ausgegraut mit Code und Grund, nicht bemalbar.
Spalten = halbe Stunden innerhalb der Rahmenzeit des Tages; volle Stunden
mit stärkerer Linie; Öffnungszeit leicht hinterlegt. Je Zeile links Name,
Vertrag, Kompetenz-Kürzel; dann die Tagesstunden ohne Pause; rechts das
Kommentarfeld (ein Klick, Text, sofort gespeichert).

**Malen**: Zeiger drücken, über Zellen einer Zeile ziehen, loslassen =
ein Speichern (`pep_plan_malen(mitarbeiter, datum, von, bis, bereich)`),
Antwort enthält den neuen Tag und die Regelprüfung. Pointer-Events, damit
Maus und Touch gehen. „Rückgängig“ für die letzten 20 Striche dieser
Sitzung **[meine Wahl]**, clientseitig als Gegenstrich.

**Zeilen unter dem Raster**: je halbe Stunde Anzahl Kasse besetzt und
Anzahl VP anwesend; rot bei 0 innerhalb der Öffnungszeit (Kasse) bzw. der
Rahmenzeit (VP), gelb bei genau 1 Kasse.

**Seitenleiste rechts**:
1. Regelprüfung heute: Liste der Verstöße mit Mitarbeiter, Zeit, Text;
   Klick markiert die Stelle im Raster. Sperren erscheinen gar nicht als
   Verstoß, weil sie beim Malen verhindert werden (Hinweis am Zeiger).
2. Woche: je Mitarbeiter Soll (Vertrag − Abwesenheiten) und geplant,
   Differenz farbig; Summe gegen Stundenvorgabe der KW.
3. Abteilungen heute: geplante Stunden je Bereich. Eine Vorgabe je Bereich
   gibt es erst mit der Bedarfsplanung (nächste Stufe); bis dahin nur Plan.

**Eckdaten-Fenster** (Klick auf den Namen) **[dtn: Pflicht]**: Vertrag und
Stunden, Kompetenzen, Wochenvorgaben (Pflicht fett), Abwesenheiten dieser
und nächster Woche, Soll/geplant dieser Woche, freie Samstage im
eingestellten Zeitraum (gearbeitet/frei, mit Daten; Samstage im Urlaub
zählen als frei), Früh- und Spätschichten der Vorwoche (Spät = Ende nach
Spät-Grenze, Früh = Beginn zur Rahmenöffnung) mit Hinweis „hatte letzte
Woche früh“ bzw. „eher früh planen“, und ob der letzte gearbeitete Samstag
spät war **[Filialleiter: Abwechslung früh/spät und nicht zwei Samstage
spät hintereinander, als Hinweis, nie als Sperre]**. Kommentar heute. Zeitkonto-Stand: Platzhalter „ab Zeitkonto-Stufe“.
Von hier aus: „Krank melden“, „Zeitausgleich“, „Zur Mitarbeiterkarte“.

**Schnellerfassung KM/ZA**: Zeitraum wählen (Vorbelegung heute), erzeugt
Abwesenheiten (quelle schnell). Bereits geplante Blöcke dieser Tage bleiben
stehen, werden rot schraffiert als „unbesetzt (krank)“ gezeichnet und
zählen in der Abdeckung nicht mehr. Sie verschwinden erst durch „Ersatz
finden“, Radieren oder Zurücknahme der Krankmeldung.

**Ersatz finden** **[dtn: in diese Stufe vorgezogen]**: Knopf an jedem roten
Block. Zeigt eine Liste der Mitarbeiter, die an dem Tag nicht abwesend sind,
im Zeitraum des Blocks nichts geplant haben, alle Kompetenzen der Blöcke
haben (z. B. Kasse), deren Pflicht-Wochenvorgaben den Zeitraum erlauben und
bei denen Ruhezeit und Höchstarbeitszeit eingehalten blieben. Sortierung:
größte Lücke zum Wochensoll zuerst, dann wenigste Samstage/Spätschichten.
Je Zeile: Name, Lücke, Hinweise (z. B. „bevorzugt nicht nach 14:00“).
Ein Klick überträgt alle roten Blöcke des Tages dieses Mitarbeiters auf den
Ersatz und löscht sie beim Kranken; Teilübernahme durch anschließendes
Radieren/Malen. Keine Push-Anfrage in dieser Stufe.

**Kopieren** **[dtn: wichtigster Mangel bei tegut]**:
- „Tag kopieren nach …“: Zieldatum(e) wählen (einzeln oder alle gleichen
  Wochentage bis Datum). „Woche kopieren nach …“: Ziel-KW(s).
- Beim Einfügen werden Blöcke von Mitarbeitern, die am Zieltag abwesend
  sind, als rot „unbesetzt“ eingefügt (gleicher Mechanismus wie
  Krankmeldung), Blöcke außerhalb der Ziel-Rahmenzeit abgeschnitten, und
  das Ergebnis gemeldet („3 Blöcke unbesetzt, 1 gekürzt“). Vorhandene
  Blöcke am Zieltag: Rückfrage „ersetzen“ oder „nur leere Zeilen füllen“.
- Vorlagen: „Als Vorlage speichern“ (Tag oder Woche, Name), „Vorlage
  laden“ auf Tag/Woche mit denselben Regeln. Vorlagen speichern
  Mitarbeiter-IDs; ausgeschiedene Mitarbeiter werden beim Laden gemeldet
  und übersprungen. Monatsvorlagen aus dem Handoff entfallen **[meine
  Wahl]**: Wochenkopie auf mehrere Ziel-KWs deckt das ab.

**Vergangene Tage**: schreibgeschützt (kein Pinsel, Hinweis „IST-Erfassung
folgt in der nächsten Stufe“). „Vergangen“ = Datum < heute; der heutige Tag
ist planbar.

## 12. Regelprüfung

Serverseitig als Funktion `pep.pruefung(filiale, datum)`, liefert JSON-Liste
`{art, schwere, mitarbeiter_id, von, bis, text}`. Wird nach jedem Strich mit
zurückgegeben und beim Öffnen eines Tages geladen. Für die Startseite gibt
es `pep_pruefung_zeitraum(von, bis)`.

**Sperren** (beim Malen verhindert, Funktion lehnt ab):
- Mitarbeiter am Tag abwesend (Code mit `sperrt`).
- Block außerhalb der Rahmenzeit des Tages.
- Bereich mit `kompetenz_noetig` ohne Kompetenz.
- Pflicht-Wochenvorgabe verletzt (nicht verfügbar / außerhalb nur-zwischen /
  über max Stunden Tag oder Woche).

**Warnungen** (rot, erscheinen in der Liste, blockieren nicht):
- Kasse unbesetzt in einer halben Stunde der Öffnungszeit.
- Keine VP anwesend in einer halben Stunde der Rahmenzeit; VP allein (nur
  eine anwesende Person insgesamt) während der Öffnungszeit.
- Pausenablöse: während der Pause einer Kassenkraft ist Kasse unbesetzt
  oder niemand mit Kassenkompetenz anwesend und frei (nicht selbst Kasse,
  nicht Pause).
- Pause fehlt oder zu kurz: Anwesenheit (erster bis letzter Block, inkl.
  Pausen) über 6 h ohne 30 min Pause, über 9 h ohne 45 min; Parameter.
- Ruhezeit: Ende Vortag → Beginn heute unter 11 h, unter 18 Jahren 12 h;
  ebenso heute → Folgetag, wenn der Folgetag geplant ist.
- Höchstarbeitszeit: über 10 h/Tag; unter 18: über 8 h/Tag, über 40 h/Woche.
- Wochenstunden über Vertrag + Toleranz (Parameter, Standard 0); Minijob:
  über Vertragsstunden ohne Toleranz. **Unter** Vertrag ist kein Verstoß
  **[meine Wahl]**: Es würde beim Planen des Montags für jeden feuern. Die
  Lücke steht farbig in der Wochen-Seitenleiste; sobald alle geöffneten Tage
  der KW mindestens einen Block haben, wird „unter Vertrag − Toleranz“ zum
  gelben Hinweis.
- Azubi/unter 18: Beginn vor 6:00 oder Ende nach 20:00 (JArbSchG; Parameter).

**Hinweise** (gelb):
- Bevorzugte Wochenvorgabe verletzt.
- Gleiche Schichtlage wie in der Vorwoche (früh nach früh, spät nach spät)
  und zweiter Samstag spät in Folge **[Filialleiter: nur Hinweis]**.
- Freier Samstag im Monat fehlt noch / Jahresziel 12 in Gefahr.
- Wunsch „U?“ offen an einem Tag mit Plan.

„Alter“ wird am Tag des Plans aus dem Geburtsdatum berechnet.
Parameter liegen in `einstellungen` mit Standardwerten aus dem Handoff.

## 13. Ausdrucke (Reiter „Drucken“ in Einsatzplan und Abwesenheiten)

Druckansichten als HTML mit `@page { size: A4 landscape }` und Browser-Druck
(„Als PDF speichern“) **[meine Wahl]** statt serverseitiger PDF-Erzeugung:
kein Dienst nötig, Layout in CSS, Vorlagen sind die tegut-Reports:
1. **Tagesplan** (`report-einsatzplanung-1.pdf`): Kopf Filiale, Datum,
   erstellt am; je Mitarbeiter Zeiten von–bis, Kommentar, farbiges Raster
   mit Kürzeln; nur geplante Mitarbeiter; Abwesende als Fußzeile mit Code.
2. **Wochenplan** (`report-einsatzplanung-2.pdf`): Name, Personalnummer,
   Vertragsstunden, je Tag Zeiten mit Arbeitszeit und Pause, Abwesenheiten
   als „U/6,25“, Summe geplante Stunden, Differenz zu Vertrag. Zeitkonto-
   Spalten entfallen bis zur Zeitkonto-Stufe.
3. **Abwesenheitsmonat** (`report-abwesenheit-1.pdf`): Raster mit Code und
   Stunden, Tagessummen, Monatssumme.
4. **Resturlaub** (`report-abwesenheit-2.pdf`): Anspruch, Rest Vorjahr,
   genehmigt je Monat, Rest heute; in Stunden und Tagen.
Zusätzlich Excel-Export des Wochenplans über das `xlsx.js` des Urlaubstools
(Kopie mit Herkunftshinweis).

## 14. Startseite

Kacheln mit Zahl und Sprung: Abwesende diese Woche → Abwesenheiten;
Stunden-Lücke nächste 6 Wochen (Überhang) → Vorausplanung; Regelverstöße
nächste 7 Tage → Einsatzplan am betroffenen Tag; offene Urlaubswünsche →
Abwesenheiten. Kacheln für Tausch und Fairness kommen mit ihren Stufen.

## 15. Gestaltung **[dtn: Netto-Farben]**

- Rahmen (Kopf, Reiter, Knöpfe) in Netto-Gelb, Netto-Rot und Schwarz/Weiß.
  Farbwerte **[dtn]**: Gelb `#FFE500`, Rot `#E30613` (übliche Werte), als
  CSS-Variablen an einer Stelle, damit sie austauschbar bleiben.
- Die Bereichsfarben im Raster dürfen **nicht** mit Rot und Gelb des Rahmens
  verwechselbar sein, und Rot bleibt für Verstöße und „unbesetzt“ reserviert.
  Startfarben der Bereiche: Kasse Hellblau, Obst Grün, Backen Ocker, TroSo
  Braun-Beige, MoPro Weiß, TK Lila-Blau, Führung Dunkelgrün, Reinigung Grau,
  Pause Dunkelgrau, Backoffice Türkis; in Einstellungen änderbar.
- Zellen tragen immer Kürzel **und** Farbe (tegut-Muster), damit Druck in
  Schwarz-Weiß und Farbsehschwäche funktionieren.
- Bedienung ohne Anleitung: höchstens eine Ebene Menü, Sofortspeichern,
  kein Speichern-Knopf, Fehlertexte in Alltagsdeutsch.
- Zielgerät: der private Laptop des Filialleiters, eventuell ein kleines
  Tablet **[Filialleiter: Netto gibt kein System vor]**. Also PC-Bildschirm
  ab 1366 px Breite und Touch-Bedienung auf Tablet; Handy ist nicht Ziel
  dieser Stufe.

## 16. Tests

- Jede `pep_*`-Funktion mit PGlite: Rechte (falsche Rolle, fremde Filiale),
  Idempotenz des Schemas (zweimal ausführen), Zerlegung von Zeiträumen,
  Stundenregeln, Wiederholungen, Block-Verschmelzung und Überlappungsverbot,
  jede Sperre und jede Warnung aus Abschnitt 12 mit einem Positiv- und einem
  Negativfall, Kopieren mit abwesenden Mitarbeitern, Ersatz-Kandidaten,
  Urlaubswünsche aus einer nachgebildeten `urlaub`-Umfrage (das
  Urlaubstool-Schema wird in den Test geladen), Protokoll-Einträge.
- Reine JS-Module (Raster↔Blöcke, Druck-Aufbereitung, Rückgängig) mit
  `node --test`, ohne DOM.
- Oberfläche: Handprüfung anhand einer Checkliste in `ANLEITUNG.md`.

## 17. Dem Builder überlassen

- Dateiaufteilung in `docs/` (Vorschlag: ein Modul je Reiter plus
  `raster.js`, `regeln-anzeige.js`, `druck.js`).
- Genaue Signaturen der `pep_*`-Funktionen und Fehlercodes (Muster:
  Großbuchstaben-Codes wie im Urlaubstool).
- Layout-Details, Breiten, Tastaturbedienung.
- Reihenfolge der Umsetzung (Vorschlag: Schema und Rechte → Stammdaten →
  Abwesenheiten → Einstellungen → Einsatzplan ohne Regeln → Regeln →
  Kopieren/Vorlagen → Ersatz finden → Vorausplanung → Druck → Startseite).
- Welche Schulferien-Daten als Startdatei mitkommen.

## 18. Offene Punkte für dtn

- Name und Nummer der Filiale (trägt die Leitung beim ersten Start ein).
  Bundesland ist Bayern **[Filialleiter]**; verkaufsoffene Sonntage gibt
  es nicht.
- Welche Mitarbeiter Azubi oder F sind (Filialleiter nennt sie).
- Aus dem Handoff weiterhin offen: Feiertags-Teiler (HR), Spätzuschlag-
  Regel (Filialleiter klärt), Liefertage und Zeitvorgaben je Warengruppe.
  Geklärt: Planumsatz kommt von Netto; kein Konzernsystem vorgeschrieben,
  Betrieb auf dem Laptop des Filialleiters.

## 19. Ausblick (nicht Teil dieses Designs)

Bedarfsplanung Kasse und Lieferzeiten (tegut `04-bedarfsplanung-kasse.jpg`),
halbautomatischer Vorschlag, IST-Erfassung mit Vorbelegung aus dem Plan,
Zeitkonto und Journal (tegut `report-generator.pdf`, `report-isteingabe.pdf`;
der Filialleiter will rückwirkend je Woche zeigen können, wo Plus- oder
Minusstunden entstanden sind, als Beleg gegenüber den Mitarbeitern
**[Filialleiter]**),
Mitarbeiter-App mit Tausch, mehrere Filialen. Das Datenmodell dieser Stufe
(Blöcke, Abwesenheiten je Tag mit Stunden, Verträge mit Gültigkeit,
Protokoll) ist dafür ausgelegt.

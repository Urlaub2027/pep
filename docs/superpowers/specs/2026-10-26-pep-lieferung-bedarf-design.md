# PEP – Lieferung & Bedarf (Design)

Stand 26.10.2026. Grundlage: PEP_HANDOFF.md „Zeitvorgaben für Lieferungen“ und
„Halbautomatischer Vorschlag“, Gespräch mit dtn am 26.10.2026.
Kennzeichnung: **[dtn]** = so gesagt oder bestätigt, **[meine Wahl]** = von mir
entschieden, vom Builder nicht zu ändern ohne Rückfrage.

## 1. Zweck

Mit dem Wechsel zu Netto ändern sich Liefertage, Warengruppen und Zeiten je
Rolli; nichts davon steht fest **[dtn]**. Die PEP soll trotzdem jetzt zeigen,
wie viele Stunden das Einräumen einer Lieferung braucht, wie viele davon schon
eingeplant sind, und wer die fehlenden Stunden übernehmen könnte. Alles muss
in der PEP einstellbar sein, ohne Code-Änderung **[dtn]**.

Erfolg: Die Leitung sieht am Planungstag „TS: 9 h nötig, 6 h eingeplant,
3 h fehlen“, bekommt einen Vorschlag „1 × 3 h oder 2 × 1,5 h“ samt Leuten,
die es machen könnten, und trägt den Block mit einem Klick ein.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

Ziele
- Warengruppen mit Minuten je Rolli, je einer Abteilung (Bereich) zugeordnet.
- Wochenmuster: je Wochentag übliche LKW-Zeit und übliche Rollis je Warengruppe.
- Je Tag überschreibbar (echte Liefermenge, andere LKW-Zeit) **[dtn]**.
- Bedarf gegen Plan je Bereich im Einsatzplan, Vorschlag mit Kandidaten,
  Eintragen per Klick **[dtn]**, halbautomatisch.

Nicht-Ziele
- Kein kompletter Plan durch die PEP. Sie schlägt vor, die Leitung entscheidet.
- **Keine Kassenplanung.** Die Einstellung „Kassierleistung“ bleibt ohne Wirkung
  und wird nur ehrlich beschriftet (Abschnitt 7) **[dtn folgt meiner Empfehlung]**.
  Grund: Die PEP kennt nur den Planumsatz je Woche, keinen Umsatz je halbe Stunde.
- Lieferstunden fließen **nicht** in die Soll-Stunden der Vorausplanung ein
  (die decken alle Arbeit schon ab; sonst doppelt gezählt) **[meine Wahl]**.
- Keine Anzeige im IST-Modus, nicht im Ausdruck.

Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)
- Ein Vorschlag, der an den Regeln vorbei schreibt. Eintragen läuft über
  `pep_plan_malen` mit allen Sperren und der normalen Regelprüfung.
- Rot und Warnungen ohne Lieferung: Ein Tag ohne Rollis zeigt keinen Bedarf.
- Fest verdrahtete Netto-Werte im Code.

## 3. Begriffe und Rechnung

- **Warengruppe**: Name, Bereich (nur `art = 'bereich'`, aktiv), Minuten je
  Rolli (ganze Zahl 1–240), aktiv, Position. Mehrere Warengruppen dürfen
  denselben Bereich haben (z. B. „Trockensortiment“ und „Aktionsware“ → TS).
- **Rollis**: ganze Zahl 0–99 je Warengruppe und Tag. 0 = keine Lieferung dieser
  Gruppe **[meine Wahl]**.
- **LKW-Zeit**: Uhrzeit auf :00/:30 (Raster der PEP). Meist 07:00–08:00 **[dtn]**.
- **Gültiger Wert eines Tages** = Tageswert, falls für diesen Tag gesetzt, sonst
  Musterwert des Wochentags. Gilt getrennt für die LKW-Zeit und für die Rollis
  jeder Warengruppe. Ein gesetzter Tageswert 0 überschreibt ein Muster > 0.
- **Nötig je Bereich** = Σ (Rollis × Minuten) der aktiven Warengruppen dieses
  Bereichs ÷ 60, **auf halbe Stunden aufgerundet** **[meine Wahl]**.
- **Eingeplant je Bereich** = besetzte Planstunden des Tages in diesem Bereich
  **ab der LKW-Zeit** (vorher ist keine Ware da) **[meine Wahl]**; wie
  `bereichsStunden` (ohne Pause, ohne unbesetzt), nur mit Zeitgrenze.
- **Fehlt** = max(0, nötig − eingeplant).
- Ein Tag „hat Lieferung“, wenn die Summe der gültigen Rollis > 0 ist.

## 4. Einstellungen → neuer Unterreiter „Lieferung“

Neuer Eintrag in `TEILE` (docs/einstellungen.js) nach „Bereiche“, zwei Abschnitte:

1. **Warengruppen**: Tabelle Name | Bereich (Auswahl der aktiven Bereiche der Art
   „Bereich“) | Minuten je Rolli | aktiv; Knopf „Warengruppe anlegen“. Wie die
   Bereiche-Tabelle bedienbar (ändern beim Verlassen des Feldes).
   Deaktivieren statt Löschen (wie Bereiche); inaktive zählen nirgends.
2. **Wochenmuster**: Raster Zeilen = aktive Warengruppen, Spalten = geöffnete
   Wochentage Mo–Sa laut Rahmen; erste Zeile „LKW-Zeit“ je Wochentag; Zellen
   = Rollis. Leere Zelle = 0.

Schreiben nur Leitung (wie alle Einstellungen); Stellvertretung sieht lesend.
Startausstattung (`pep.grundausstattung` bzw. Nachrüstung für bestehende
Filialen, idempotent): Warengruppe „Trockensortiment“ → Bereich mit Kürzel TS,
45 min **[Handoff]**, falls TS existiert; LKW-Zeit Mo–Sa 07:00 **[dtn: meist 7–8]**;
keine Rollis (also zunächst nirgends Bedarf).

## 5. Einsatzplan → Kasten „Abteilungen heute“ wird „Lieferung & Bedarf“

Der vorhandene Kasten `abteilungsBox` (docs/einsatzplan.js, Fußtext „Vorgaben je
Bereich kommen mit der Bedarfsplanung.“) wird erweitert, kein zweiter Kasten
**[meine Wahl]**. Nur im Plan-Modus und an geöffneten Tagen (wie heute).

Inhalt (Entwurf A, von dtn gewählt):
- Kopf: „LKW“ mit Zeitfeld (gültiger Wert; abweichend vom Muster gelb umrandet).
- Je **Warengruppe** eine Zeile mit Rollis-Feld (gültiger Wert, Abweichung gelb
  umrandet; ein Klick „↺ Muster“ setzt den Tageswert zurück).
- Je **Bereich** (alle Bereiche mit geplanten Stunden oder mit Warengruppe):
  Kürzel/Name | nötig | eingeplant | fehlt. „fehlt“ rot, „✓“ grün wenn gedeckt;
  Bereiche ohne Warengruppe zeigen nur „eingeplant“ wie heute.
- Bei „fehlt“ > 0 Knopf „Vorschlag“ (Abschnitt 6).
- Gibt es keine aktive Warengruppe: Hinweis „Warengruppen unter Einstellungen →
  Lieferung anlegen.“ (nur für Leitung als Link).
- Vergangene Tage: Felder schreibgeschützt (wie das Raster).
- Ausnahmsweise geöffnete Tage ohne Muster (z. B. verkaufsoffener Sonntag):
  Rollis und LKW-Zeit lassen sich als Tageswert eintragen; ohne LKW-Zeit zählt
  „eingeplant“ den ganzen Tag **[meine Wahl]**.

Tageswerte ändern dürfen Leitung **und** Stellvertretung (beide planen)
**[meine Wahl]**. Nach dem Speichern wird der Kasten neu gezeichnet; das Raster
nicht (Rollis ändern keine Blöcke).

## 6. Vorschlag

Klick auf „Vorschlag“ bei Bereich B mit Fehlstunden f:
1. **Aufteilung**: „1 × f“ gibt es immer, auch bei 0,5 h. Varianten für 2 und
   3 Personen verteilen f in halben Stunden möglichst gleich (2,5 h → 1,5 h + 1 h),
   ohne Überhang: Summe der Anteile = f. Eine Variante erscheint nur, wenn der
   kleinste Anteil ≥ 1 h ist **[meine Wahl]**. Text „3 h fehlen: 1 × 3 h ·
   2 × 1,5 h“. Die Leitung wählt eine Variante (Standard: 1 Person); bei
   ungleichen Anteilen bekommt der erste eingetragene Kandidat den größeren.
   Nach jedem Eintragen wird „fehlt“ neu berechnet, der Vorschlag rechnet mit
   dem Rest weiter.
2. **Block** = LKW-Zeit bis LKW-Zeit + Anteil, begrenzt auf den Rahmen des Tages.
3. **Kandidaten** für diesen Block, neue Funktion `public.pep_bedarf_kandidaten
   (p_datum date, p_bereich_id bigint, p_von time, p_bis time)`; Leitung oder
   Stellvertretung; `VERGANGEN` für Tage vor heute. Filter wie
   `pep.ersatz_kandidaten`, nur ohne „unbesetzte Blöcke“:
   - aktive Mitarbeiter der Filiale, im Block nichts geplant;
   - `pep.zeile_pruefen` mit dem Block würde nicht werfen (Kompetenz, Vertrag,
     Abwesenheit, Pflicht-Vorgaben, Rahmen);
   - keine neue oder verschärfte Warnung `ruhezeit` / `hoechstarbeitszeit`
     (Probe im zurückgerollten Unterblock wie bei der Ersatzsuche);
   - Rückgabe und Sortierung wie Ersatz: `luecke` (offene Wochenstunden) absteigend,
     dann Samstage/Spät, Name; `hinweise` = neue Texte `vorgabe_bevorzugt`/`schichtlage`.
   Gemeinsame Teile mit `pep.ersatz_kandidaten` darf der Builder in eine
   Hilfsfunktion herausziehen; das Verhalten der Ersatzsuche bleibt gleich.
4. **Eintragen**: Knopf je Kandidat „06:30–09:30 eintragen“ ruft das bestehende
   `pep_plan_malen(ma, datum, von, bis, B)` auf; danach Woche neu laden. Fehler
   kommen als normale Meldung (z. B. wenn sich inzwischen etwas geändert hat).
- Keine Kandidaten: „Niemand frei, der den Bereich darf. Von Hand malen.“

## 7. Kassierleistung beschriften

In `PARAMETER` (docs/einstellungen.js) Erklärung von `kassierleistung_eur_halbe_h`
ersetzen durch „Wirkt erst mit der Kassenplanung (noch nicht gebaut).“ Wert und
Speicherung bleiben.

## 8. Daten und Schnittstellen

Neue Tabellen im Schema `pep` (RLS an, keine Policies, Zugriff nur über
SECURITY-DEFINER-Funktionen, `set search_path = ''`, Grants wie üblich):
- `warengruppen` (id, filiale_id, name, bereich_id → bereiche, minuten int
  check 1–240, aktiv, position; unique filiale_id + name).
- `liefer_muster` (filiale_id, wochentag 1–7, lkw_zeit time; PK filiale + wochentag).
- `liefer_muster_rollis` (warengruppe_id, wochentag, rollis int check 0–99; PK beide).
- `liefer_tag` (filiale_id, datum, lkw_zeit time; PK filiale + datum).
- `liefer_tag_rollis` (warengruppe_id, datum, rollis int check 0–99; PK beide).
Löschen einer Warengruppe gibt es nicht (nur aktiv = false).

Funktionen (Namen verbindlich, Parameter Builder):
- `pep_einstellungen` liefert zusätzlich `warengruppen[]` und `liefer_muster`.
- `pep_warengruppe_speichern` (anlegen/ändern; Leitung), `pep_liefer_muster_setzen`
  (Wochentag, LKW-Zeit oder Rollis einer Gruppe; Leitung).
- `pep_liefer_tag_setzen` (Datum, LKW-Zeit und/oder Rollis einer Gruppe, `null` =
  zurück auf Muster; Leitung oder Stellvertretung; `VERGANGEN` vor heute).
- `pep_einsatzplan_woche` liefert zusätzlich `warengruppen[]` (aktive) und
  `lieferung{datum: {lkw, lkw_aus_muster, rollis: [{warengruppe_id, rollis,
  aus_muster}]}}` für die geöffneten Tage der Woche.
- `pep_bedarf_kandidaten` (Abschnitt 6).
- Alle Schreibfunktionen protokollieren (`pep.protokolliere`).
- Neue Fehlercodes mit Texten in docs/hilfe.js `FEHLER`; Zeitwerte nur :00/:30
  (`HALBE_STUNDE`, wie bei den Einstellungen).
- Sicherung: die fünf Tabellen in `pep.sicherung_tabellen()` in Fremdschlüssel-
  Reihenfolge (tests/sicherung.test.mjs verlangt das).
- Die Rechnung nötig/eingeplant/fehlt/Aufteilung ist reine Browser-Logik in
  docs/plan-raster.js (Datenbank liefert nur die gültigen Werte).

## 9. Texte

- Hilfe „?“ (docs/hilfe-texte.js): je ein Satz für Einsatzplan und Einstellungen
  (Grenze 180 Wörter je Ansicht beachten).
- ANLEITUNG.md: Abschnitt Einstellungen → Lieferung, Einsatzplan → Kasten.
- Keine echten Namen in Tests, Beispielen, Commits.

## 10. Prüfung

- node-Tests: Rechnung (gültiger Wert Muster/Tag, 0 überschreibt, Aufrunden,
  eingeplant erst ab LKW-Zeit, mehrere Gruppen je Bereich, Aufteilung);
  Rechte (Stellvertretung darf Tag, nicht Muster/Warengruppen); Kandidaten
  (Kompetenz, Abwesenheit, schon geplant, Ruhezeit/Höchstarbeitszeit, Sortierung,
  VERGANGEN); Sicherung enthält die Tabellen; Grundausstattung idempotent.
- Browser-Szenario: Muster anlegen, Tag überschreiben (gelb), Vorschlag öffnen,
  Kandidat eintragen, „fehlt“ sinkt, Regelprüfung unverändert gültig.

## 11. Bewusst so entschieden **[meine Wahl]**

- Kein „gültig ab“: Ändert die Leitung Muster oder Minuten je Rolli, rechnen auch
  vergangene Tage ohne Tageswert mit den neuen Werten. Die Anzeige vergangener
  Tage ist nur Rückblick, nichts hängt daran (kein Zeitkonto, kein Ausdruck).
- Kopieren von Tag/Woche und Vorlagen übernimmt **keine** Lieferwerte; das Muster
  deckt die übliche Lieferung ab.
- Wird der Bereich einer Warengruppe deaktiviert, zählt die Gruppe nicht mehr,
  bis ihr ein aktiver Bereich zugeordnet ist (Hinweis in den Einstellungen).
- „Trockensortiment“ wird nur angelegt, wenn die Filiale noch keine Warengruppe
  hat (wie bei Bereichen und Abwesenheitscodes).

## 12. Offen / dem Builder überlassen

- Optik im Rahmen des bestehenden Stils (Tabellen `ep-klein`, Chips, Felder).
- Ob der Vorschlag als Dialog oder ausgeklappt im Kasten erscheint.
- Interne Hilfsfunktionen und Testaufteilung.

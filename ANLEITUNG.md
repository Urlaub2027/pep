# PEP – Anleitung

Für die Filialleitung und für dtn (Einrichtung). PEP läuft als statische Seite
(GitHub Pages) auf der Supabase-Datenbank des Urlaubstools.

- **Stufe 0** (Grundgerüst): Mitarbeiter, Einstellungen, Abwesenheitskalender.
- **Stufe 1** (dieser Stand): Einsatzplan mit Regelprüfung, Kopieren und Vorlagen,
  Krankmeldung mit Ersatzsuche, Eckdaten, Vorausplanung, Ausdrucke und Startseite.

**Datenschutz:** Das Repository ist öffentlich. Echte Namen, Vertragsstunden und
Geburtsdaten gehören nie hinein. Die Startdatei mit den Namen liegt in `privat/`
(durch `.gitignore` ausgeschlossen) und wird nie committet.

## 1. Einrichtung (einmalig)

1. **Schema einspielen.** In Supabase den SQL-Editor öffnen, den Inhalt von
   `supabase/schema.sql` einfügen und ausführen. Das Urlaubstool muss bereits
   installiert sein. Erneutes Ausführen ist unschädlich.
2. **Ersten Leitungs-Benutzer festlegen.** Der Benutzer muss im Urlaubstool als
   Organisator existieren. Im SQL-Editor:
   `select pep.start_leitung('<benutzername>');`
3. **Seite öffnen und anmelden** mit denselben Zugangsdaten wie im Urlaubstool
   (Benutzername und Passwort).
4. **Filiale anlegen.** Beim ersten Anmelden erscheint „Filiale anlegen“:
   Name (z. B. Netto Aschaffenburg), Nummer **2558**, Bundesland **Bayern**.
5. **Optional: Startbestand und Schulferien.** Im SQL-Editor ausführen:
   - `privat/stammdaten-aschaffenburg.sql` – legt die Mitarbeiter mit Vertrag ab
     01.01.2026 und Urlaubsjahr 2027 an (nur auf dem Rechner von dtn vorhanden;
     Azubi/F-Kennzeichnung und Geburtsdaten trägt der Filialleiter in der Seite nach),
   - `supabase/schulferien-BY.sql` – Schulferien Bayern 2026/27 und 2027/28
     (Quelle im Kopf der Datei).

   Beide setzen die Filiale mit Nummer 2558 voraus (sonst Fehler `FILIALE_FEHLT`)
   und können gefahrlos mehrfach laufen.
6. **GitHub Pages einschalten.** Repository → Settings → Pages → Branch `main`,
   Ordner `/docs`. Die Zugangsdaten in `docs/config.js` sind absichtlich öffentlich;
   die Daten schützt die Datenbank (siehe README).

### Umstellung von Stufe 0 auf Stufe 1

Wer Stufe 0 schon eingerichtet hat, macht nur einen Schritt:

1. Im SQL-Editor den **aktuellen** Inhalt von `supabase/schema.sql` noch einmal
   ausführen.

Das Schema ist idempotent: Vorhandene Mitarbeiter, Verträge und Abwesenheiten
bleiben stehen. Neu kommen die Tabellen für Plan, Kommentare, Vorlagen und
Wochenwerte dazu. Die Bereiche KA und VP bekommen ihre feste Bedeutung „Kasse“
und „VP“, falls in der Filiale noch keine gesetzt ist. Danach heißt die Kasse für
die Regelprüfung immer „Kasse“, auch wenn ihr Kürzel später umbenannt wird.
Der Test `tests/umstellung.test.mjs` spielt genau das durch: eine Stufe-0-Datenbank
mit Daten, dann das neue Schema zweimal.

Danach die Seite im Browser neu laden (Strg+F5), damit die neuen Dateien kommen.

## 2. Rollen

| Rolle | Darf |
|---|---|
| Leitung | alles: Mitarbeiter und Reihenfolge, Einstellungen, Abwesenheiten, Urlaubswünsche freigeben, Einsatzplan, Vorausplanung, Drucken, Benutzer verwalten |
| Stellvertretung | Startseite, Abwesenheiten eintragen, Einsatzplan (Malen, Kommentare, Kopieren, Vorlagen, Krank/ZA, Ersatz), Vorausplanung eintragen, Drucken; Mitarbeiter nur ansehen; kein Reiter Einstellungen, keine Freigabe von Urlaubswünschen |
| Mitarbeiter | noch keine Seite |

Weitere Benutzer legt die Leitung unter Einstellungen → Benutzer an. Der Benutzer
braucht dafür ein Konto im Urlaubstool.

## 3. Bedienung

Reiter: Start, Abwesenheiten, Vorausplanung, Einsatzplan, Mitarbeiter,
Einstellungen (nur Leitung). Es gibt keinen Speichern-Knopf: Jede Änderung wird
sofort gespeichert („Gespeichert.“ erscheint unten kurz).

### Startseite
Nach dem Anmelden erscheint die Startseite mit vier Kacheln. Jede zeigt eine große
Zahl und hat einen Knopf, der zur passenden Stelle springt. Eine Kachel ohne Befund
hat einen grünen Rand und zeigt „alles im grünen Bereich“.

- **Abwesend diese Woche:** wie viele Personen in der laufenden Kalenderwoche
  (Montag bis Sonntag) mindestens einen Abwesenheitstag haben, gleich mit welchem
  Code. Darunter je Person und Code ein Eintrag, z. B. „KM 03.11.–05.11.“.
  Sprung: Abwesenheiten.
- **Stunden-Lücke:** die Summe aller negativen Überhänge der nächsten sechs Wochen
  (ab der laufenden). Darunter die Wochen mit Lücke. Wochen ohne Planumsatz haben
  keinen Überhang und zählen nicht. Sprung: Vorausplanung.
- **Regelverstöße:** die Warnungen von heute bis in sechs Tagen. Darunter die Tage
  mit Warnungen oder Hinweisen; ein Klick auf den Tag öffnet den Einsatzplan an
  diesem Tag. Gezählt wird wie folgt:
  - Wochenregeln (Wochenstunden über oder unter dem Vertrag, unter 18: Wochenhöchstzeit)
    stehen in der Regelprüfung an jedem Arbeitstag der Woche. Auf der Startseite
    zählen sie einmal je Person und Woche.
  - Eine zu kurze Ruhezeit zwischen zwei Tagen zählt einmal, nicht an beiden Tagen.
  - Ein geöffneter Tag ganz ohne Planung steht getrennt unter „Noch nicht geplant“
    und zählt nicht als Verstoß.
  Sprung: Einsatzplan am ersten Tag mit Warnung.
- **Offene Urlaubswünsche:** Wünsche aus dem Urlaubstool für die nächsten zwölf
  Monate, die noch weder genehmigt noch abgelehnt sind. Sprung: Abwesenheiten im
  Monat des frühesten Wunsches.

### Mitarbeiter
Links die Liste (inaktive grau am Ende, Kompetenz-Kürzel als Badges), rechts die
Karte der gewählten Person. „Neuer Mitarbeiter“ legt eine Person an. Auf der Karte:
Stammdaten (Name, Personalnummer, Geburtsdatum, Eintritt/Austritt, aktiv, Notiz),
**Verträge** (Gültig ab, Art, Wochenstunden; pro Datum nur einer, der letzte lässt
sich nicht löschen), **Kompetenzen** (Haken je Bereich/Funktion), **Wochenvorgaben**
(Wochentag, nicht verfügbar / nur zwischen, Pflicht, Gültigkeit) und **Urlaubsjahre**
(Anspruch und Rest aus dem Vorjahr in Stunden).

**Reihenfolge im Einsatzplan** (nur Leitung): Mit ▲ und ▼ neben einem aktiven
Mitarbeiter in der Liste tauscht er den Platz mit dem Nachbarn. Jeder Klick wird
sofort gespeichert. So steht die Reihenfolge auch im Einsatzplan und im Ausdruck.

### Einstellungen (Leitung)
- **Rahmen:** Öffnungszeiten je Wochentag.
- **Abweichende Tage:** Feiertage erscheinen grau; „öffnen …“ macht daraus eine
  Abweichung mit eigenen Zeiten. Eigene Abweichungen mit Datum, Art, Name.
- **Bereiche:** Kürzel, Name, Farbe, Art, ob eine Kompetenz nötig ist, aktiv.
- **Codes:** Abwesenheitscodes (z. B. U, KM, BS) mit Stundenregel, sperren, neu anlegen.
- **Parameter:** Rechenwerte mit Erklärung (z. B. Teiler 6 für Urlaubsstunden je Tag,
  Ruhezeit, Pausen, Stundenleistung in €/h für die Vorausplanung).
- **Schulferien:** anlegen und löschen.
- **Urlaubstool:** welche Umfragen als Urlaubswünsche einfließen; Zuordnung der
  Teilnehmer zu Mitarbeitern (Vorschläge übernehmen). Die Umfrage muss der
  PEP-Leitung der Filiale selbst gehören (Anmeldung der Leitung im Urlaubstool
  als Organisator) und wird von dieser Leitung eingeschaltet; Umfragen anderer
  Organisatoren, auch wenn sie als Stellvertretung eingetragen sind, lassen sich
  nicht einschalten. Ausschalten kann jede Leitung der Filiale.
- **Benutzer:** Stellvertretung hinzufügen, Rolle ändern, entfernen.

### Abwesenheiten
Monatsraster mit Kalenderwochen, Tagen und Summenzeile. Sa/So grau, Feiertage
gelb, Schulferien hellgrün.
- **Zeichnen:** Code in der Palette wählen und mit gedrückter Maustaste (oder Finger)
  entlang einer Zeile ziehen. Geschlossene Tage werden übersprungen, ein Hinweis
  nennt sie. „Löschen“ entfernt. Bei Codes mit Stundenregel „tatsächlich“ fragt ein
  Dialog nach den Stunden, bei „mit Uhrzeit“ zusätzlich nach von/bis.
- **Wiederholung …:** Code, Wochentag und Ende wählen (z. B. BS jeden Dienstag bis
  30.06.). „In Schulferien aussetzen“ (Standard an) lässt die Tage in den
  eingetragenen Schulferien aus; nachträglich geänderte Schulferien wirken erst, wenn die
  Wiederholung neu gespeichert wird. Löschen einer Wiederholung entfernt alle künftigen Tage.
- **Ansehen** (Standard-Modus): Klick auf eine Zelle öffnet den Info- oder
  Wunsch-Dialog.
- **Urlaubswünsche freigeben (nur Leitung):** Offene Wünsche aus dem Urlaubstool
  erscheinen gestrichelt („U?“). Im Dialog genehmigen oder ablehnen; genehmigte
  werden zu Urlaubstagen. Abgelehnte Wünsche bleiben abgeblendet („U?“ grau) sichtbar;
  ein Klick erlaubt erneutes Genehmigen. Ändert ein Mitarbeiter seine Antwort im Urlaubstool,
  zeigt die Zelle „!“; die Leitung kann die Freigabe zurücknehmen.
- **Übersicht „Urlaub <Jahr>“** unter dem Raster (aufklappbar): Anspruch, genehmigt,
  offen im Monat (geschätzt), Rest in Stunden und Tagen.
- **Drucken:** Monat wie angezeigt oder Resturlaub des Jahres (siehe „Drucken“).

### Einsatzplan
Oben die Woche (◀ ▶, Datumsfeld, „Heute“) und die Tage Mo–So mit Öffnungszeit.
Darunter die Pinsel (ein Bereich je Knopf, dazu „Radieren“) und die Knöpfe
Rückgängig, Kopieren, Vorlagen, Krank/ZA und Drucken. Das Raster zeigt je
Mitarbeiter eine Zeile in halben Stunden, rechts die Kommentarspalte. Unter dem
Raster stehen die Abdeckungszeilen Kasse und VP: Rot heißt „niemand da“.

- **Malen:** Pinsel wählen, in der Zeile des Mitarbeiters über die Zeit ziehen.
  Nach dem Loslassen steht der Block mit Kürzel und Farbe da. Malen mitten in einen
  anderen Block teilt ihn; gleicher Bereich daneben verschmilzt. „Radieren“ leert
  die gezogenen halben Stunden. Die Stunden der Zeile und die Abdeckung ändern sich sofort.
- **Tablet:** Waagerecht ziehen malt, senkrecht wischen scrollt die Seite. Auf
  Kopfzeile, Namen und Abdeckung wischen scrollt das Raster quer.
- **Sperren:** Geht ein Strich nicht (Kompetenz fehlt, Mitarbeiter abwesend,
  Pflicht-Vorgabe, außerhalb der Planungszeit, kein Vertrag, vergangener Tag),
  steht der Grund 3 Sekunden am Zeiger und oben als Meldung. Die Zeile bleibt, wie sie war.
- **Rückgängig:** nimmt die letzten Striche zurück (bis zu 20), auch an anderen Tagen;
  der Plan springt dann zu diesem Tag.
- **Kommentar:** in die Kommentarspalte klicken, Text tippen, Enter. Escape verwirft,
  leeren löscht.
- **Vergangene Tage** sind schreibgeschützt (die IST-Erfassung kommt später).
- **Unbesetzt:** Wird jemand krank oder abwesend, der schon geplant ist, bleiben seine
  Blöcke stehen, werden aber rot gestreift. Sie zählen nirgends mit. Daneben steht
  der Knopf „Ersatz“.

**Seitenleiste:**
- *Regelprüfung* des gewählten Tags: Warnungen rot, Hinweise gelb. Ein Klick markiert
  Zeile und Zeit im Raster, ein zweiter Klick hebt die Markierung auf.
  Warnungen: unbesetzt, Kasse unbesetzt, keine VP, nur eine Person da, Pausenablöse
  fehlt, Pause fehlt oder zu kurz, Ruhezeit, Höchstarbeitszeit, unter 18 (Uhrzeit und
  Stunden), Wochenstunden über dem Vertrag. Hinweise: Woche nicht voll verplant,
  bevorzugte Vorgabe verletzt, Schichtlage wie letzte Woche, zweiter Samstag spät,
  freie Samstage im Monat/Jahr, Urlaubswunsch offen.
- *Woche:* je Mitarbeiter Soll (Vertrag − Abwesenheiten), geplant, Differenz; unten die
  Summe gegen die Stundenvorgabe aus der Vorausplanung.
- *Abteilungen heute:* Stunden je Bereich.

**Eckdaten:** Klick auf den Namen öffnet ein Fenster mit Vertrag und Kompetenzen,
Stunden der Woche, Wochenvorgaben, Abwesenheiten dieser und nächster Woche, Samstagen
im Monat, Lage der Vorwoche und Kommentar. Von dort: „Krank melden“,
„Zeitausgleich“ und „Zur Mitarbeiterkarte“.

**Krank/ZA:** Mitarbeiter, Code (KM oder ZA) und Zeitraum wählen. Ganze Tage werden
eingetragen, auch rückwirkend; geschlossene Tage werden übersprungen. Geplante Blöcke
bleiben stehen und werden unbesetzt (rot). Stundenweise Abwesenheit (z. B. Arzttermin)
gehört in den Reiter Abwesenheiten.

**Ersatz:** zeigt, wer die unbesetzten Blöcke des Tages übernehmen kann – zuerst
die mit den meisten offenen Wochenstunden, dann weniger Samstage und Spätschichten.
Nicht aufgeführt ist, wer schon eingeplant oder abwesend ist, die Kompetenz nicht hat
oder gegen eine Pflicht-Vorgabe, die Ruhezeit oder die Höchstarbeitszeit verstoßen
würde. Ein Klick auf einen Namen übernimmt alle unbesetzten Blöcke des Tages.

**Kopieren:** Quelle ist der gewählte Tag oder die angezeigte Woche. Ziel für einen Tag:
ein anderer Tag oder alle gleichen Wochentage bis zu einem Datum (z. B. „alle Montage
bis 30.11.“). Ziel für eine Woche: eine andere Woche oder die nächsten Wochen. Ist ein Ziel schon geplant, fragt PEP:
„Ersetzen“ (Ziel vorher leeren), „Nur leere Zeilen füllen“ oder „Abbrechen“.
Beim Kopieren gilt:
- vergangene und geschlossene Tage werden übersprungen,
- Mitarbeiter ohne Vertrag, inaktiv oder ausgetreten fallen weg,
- Blöcke werden auf die Planungszeit des Ziels gekürzt (z. B. Heiligabend),
- fehlt die Kompetenz oder verstößt ein Block gegen eine Pflicht-Vorgabe, fällt er weg,
- ist jemand am Ziel abwesend, wird sein Block trotzdem eingefügt und ist unbesetzt.
Das Ergebnis steht danach oben als Meldung (kopiert, gekürzt, unbesetzt, ausgelassen).

**Vorlagen:** den gewählten Tag oder die Woche unter einem Namen speichern; später auf
den gewählten Tag bzw. die angezeigte Woche laden (gleiche Rückfrage wie beim Kopieren)
oder löschen. Der Plan selbst ändert sich beim Löschen nicht.

### Vorausplanung
Sechs Wochen nebeneinander, ◀ ▶ blättert, „Aktuelle Woche“ springt zurück.
- **Planumsatz** (von Hand, in €): „60.000“ heißt sechzigtausend, „60000,50“ hat Cent.
  Gespeichert wird beim Verlassen des Feldes.
- **Stundenleistung** (€ Umsatz je Arbeitsstunde): leer = Wert aus den Einstellungen.
- **Soll-Stunden** = Planumsatz ÷ Stundenleistung, auf halbe Stunden gerundet.
- **Vertragsstunden**, **Abwesend**, **davon Urlaub**, **Verfügbar** (Vertrag − Abwesend).
- **Überhang** = Verfügbar − Soll; unter 0 rot – dann fehlen Stunden.
- **Stundenvorgabe von Hand** überschreibt das Soll; leer = Soll bzw. Verfügbar.
- **Vorgabe für den Einsatzplan:** diese Zahl steht in der Seitenleiste des Einsatzplans.
- **Geplant:** bisher im Einsatzplan eingetragen (ohne Pausen, ohne Unbesetztes).

Ein Klick auf den Kopf einer Woche öffnet den Einsatzplan dieser Woche.

### Drucken
Alle Ausdrucke sind A4 quer, mit Kopf (Titel, Zeitraum, Filiale, „erstellt am“).
Jede Zelle trägt Kürzel **und** Farbe, damit Schwarz-Weiß lesbar bleibt. Fehlen die
Farben, im Druckdialog „Hintergrundgrafiken“ einschalten.
- **Einsatzplan → Drucken:** Wochenplan, Tagesplan des gewählten Tags, Tagespläne der
  ganzen Woche, „Excel (Wochenplan)“ lädt eine .xlsx-Datei herunter.
- **Abwesenheiten → Drucken:** der angezeigte Monat oder „Resturlaub <Jahr>“.

## 4. Handprüf-Checkliste

Nach der Einrichtung einmal durchgehen (als Leitung, jeweils am Schluss als
Stellvertretung). Diese Punkte konnten bisher nicht im echten Browser oder nicht
gegen Supabase geprüft werden. Die Tests laufen gegen eine nachgebildete Datenbank.

**Supabase (zuerst)**
1. Schema im SQL-Editor ausführen (Umstellung, siehe 1.). Keine Fehlermeldung.
2. Alle neuen Funktionen wurden bisher **nie gegen Supabase** ausgeführt, nur gegen
   die Testdatenbank. Deshalb jeden Reiter einmal öffnen und jede Aktion einmal
   auslösen: Startseite, Einsatzplan (Malen, Radieren, Rückgängig, Kommentar),
   Kopieren (Tag und Woche, mit Rückfrage), Vorlagen (speichern, laden, löschen),
   Krank/ZA, Ersatz, Eckdaten, Vorausplanung (Planumsatz speichern), alle Ausdrucke,
   Excel, Reihenfolge ▲/▼. Jede Fehlermeldung mit Wortlaut an dtn.
3. Besonders: Kopieren mit mehreren Zieltagen (die Liste der Tage geht als Datumsliste
   an Supabase; das ist Standard, aber nicht gemessen).
4. Startseite: Die Seite muss in wenigen Sekunden stehen. In der Testdatenbank braucht
   sie mit 20 Mitarbeitern rund 0,3 s; in Supabase nicht gemessen.

**Mitarbeiter**
1. „Neuer Mitarbeiter“, Name „Test, Person“ speichern: erscheint in der Liste.
2. Vertrag ab 01.01.2026, Teilzeit, 30 h: Liste zeigt „Teilzeit · 30,0 h“. Zweiter
   Vertrag mit gleichem Datum: Fehler VERTRAG_DOPPELT; letzten Vertrag löschen: LETZTER_VERTRAG.
3. Kompetenz Kasse haken: Badge in der Liste; abhaken entfernt es.
4. Wochenvorgabe Sa, nicht verfügbar, Pflicht: Zeile erscheint; Löschen geht.
5. Urlaubsjahr 2027, 180 h, Rest 0: Zeile mit gesperrtem Jahr; Ändern speichert.
6. Seite neu laden: alles da. Mitarbeiter inaktiv: grau, am Listenende.
7. Als Stellvertretung: lesbar, aber keine Speichern-/Löschen-Knöpfe und kein ▲/▼.
8. Breite unter 900 px: Liste über Karte; breiter: nebeneinander.
9. ▲/▼ ändern die Reihenfolge; im Einsatzplan stehen die Zeilen danach genauso.

**Einstellungen**
1. Reiter für Stellvertretung nicht sichtbar.
2. Rahmen: Samstag 07:00–18:00, speichern, neu laden: bleibt. „geöffnet“ abwählen: Zeiten leer.
3. Jahr 2027: 03.10.2027 grau; „öffnen …“ erzeugt Abweichung, Zeiten 13:00–18:00
   speichern; Löschen: Feiertag wieder grau.
4. Bereiche: Farbe, aktiv, Kompetenz umschalten; Neuanlage mit Art; doppeltes Kürzel
   meldet „Dieses Kürzel gibt es schon.“
5. Codes: Stundenregel wechseln, sperren, neuer Code.
6. Parameter: Teiler 6 auf 0: Meldung, Feld springt zurück; spaet_grenze 18:30 gespeichert,
   18:15 Hinweis auf halbe Stunde.
7. Schulferien anlegen und löschen.
8. Urlaubstool: Umfrage-Haken an/aus; Zuordnung mit Vorschlag; „Vorschläge übernehmen“.
9. Benutzer: „vize“ als Stellvertretung hinzufügen, Rolle ändern, entfernen; sich selbst
   entfernen: Meldung NICHT_SELBST.

**Abwesenheiten** (Monat März 2027)
1. Raster mit KW-Kopf, Tagen 1–31, Summenzeile; Sa/So grau, Karfreitag (26.03.) gelb
   mit Tooltip, Schulferien hellgrün.
2. Code „U“, Zeile von Mo 22. bis So 28. ziehen (auch mit der Maus aus der Zelle
   heraus): Markierung gelb, nach Loslassen „Gespeichert.“, 6 Zellen „U 6,25“.
3. Ziehen über mehrere Zeilen: Markierung bleibt in der Startzeile.
4. KM über U ziehen: Zellen werden KM. „Löschen“ ziehen: Zellen leer.
5. Code mit Regel „tatsächlich“: Dialog fragt Stunden; leer: Fehler im Dialog;
   Abbrechen/Escape: nichts gespeichert.
6. „mit Uhrzeit“ + BS: Dialog verlangt Stunden und von/bis; Zelle zeigt „BS 08–13“.
7. „Wiederholung …“: BS, Dienstag, bis 30.06.: Dienstage „BS 8,00“.
8. Offener Wunsch: Zellen gestrichelt „U?“; Modus „Ansehen“, Klick: Dialog mit vorbelegtem
   Zeitraum; Genehmigen: volle Zellen. Als Stellvertretung keine Genehmigen/Ablehnen-Knöpfe.
9. Im Urlaubstool Antwort ändern, Reiter neu laden: „!“ mit Tooltip; Klick: Info-Dialog
   mit „Zurücknehmen“ (nur Leitung): Zellen leer.
10. Übersicht „Urlaub 2027“ unter dem Raster: Anspruch, genehmigt, offen, Rest stimmig;
    zuklappen bleibt beim Monatswechsel zu.
11. Tablet: Ziehen ohne Seitenscrollen. Monat ◀ ▶ über den Jahreswechsel.

**Einsatzplan** (eine Woche in der Zukunft)
1. **Malen mit der Maus:** Pinsel „KA“, in einer Zeile von 08:00 bis 12:00 ziehen. Beim
   Ziehen werden die Zellen gelb markiert; danach steht der Block mit „KA“ da, die Stunden
   der Zeile und die Kasse-Zeile ändern sich. Kurz in die Nachbarzeile ziehen: Der Strich
   bleibt in der eigenen Zeile.
2. **Malen mit dem Finger (Tablet):** waagerecht ziehen malt, senkrecht wischen scrollt
   die Seite. Auf Kopfzeile, Namen oder Abdeckungszeilen wischen scrollt das Raster quer.
   Das ist auf einem echten Tablet noch nie geprüft worden.
3. **Sperre am Zeiger:** bei einem Mitarbeiter ohne Kassenkompetenz „KA“ malen. Der Text
   „… fehlt die Kompetenz …“ steht 3 s am Zeiger und oben als Meldung; die Zeile bleibt
   unverändert. Ebenso: Malen in die Berufsschulzeit → „abwesend“. Auch auf dem Tablet
   prüfen, ob der Hinweis am Finger lesbar ist.
4. **Dreimal Rückgängig:** drei Striche in verschiedenen Zeilen, dann dreimal
   „Rückgängig“. Jede Zeile kehrt zum Stand vor ihrem Strich zurück, danach ist der
   Knopf gesperrt. Mit einem Strich an einem anderen Tag springt Rückgängig zu diesem Tag.
5. **Kommentar:** in die Kommentarspalte klicken, Text tippen, Enter. Nach dem Neuladen
   (F5) steht er noch da. Escape verwirft, Leeren löscht.
6. **Tageswechsel:** Reiter Di anklicken; Raster, Abdeckung und Regelprüfung zeigen
   Dienstag. Sonntag zeigt „geschlossen“. Ein vergangener Tag zeigt keinen Pinsel, aber
   den Hinweis zur IST-Erfassung.
7. **KW 53:** Datum 28.12.2026 wählen → KW 53 (28.12.–03.01.). ▶ → KW 1/2027, ◀ zurück
   → KW 53. Der Wochentag bleibt beim Blättern gewählt.
8. Klick auf eine Warnung in der Regelprüfung markiert Zeile und Zeit, ein zweiter Klick
   hebt die Markierung auf.

**Kopieren und Vorlagen**
1. Einen geplanten Montag auf den nächsten Montag kopieren (Ziel leer): Meldung „1 Tag
   kopiert: … Blöcke“, ohne Rückfrage.
2. Dasselbe noch einmal: Rückfrage „Ziel schon geplant“ mit dem Tag. „Nur leere Zeilen
   füllen“ lässt die Zeilen mit Blöcken unverändert; „Ersetzen“ leert vorher.
3. „alle Montage bis …“ und „die nächsten 2 Wochen“: Die Zielzeile im Dialog nennt
   alle Ziele.
4. Leeren Sonntag kopieren: Meldung „… nichts geplant – es gibt nichts zu kopieren.“
5. Woche als Vorlage speichern, eine Woche weiter blättern, Vorlage laden: gleiche Rückfrage.
   Vorlage löschen: Plan bleibt.
6. Kopieren auf einen Tag, an dem jemand Urlaub hat: Sein Block ist danach rot (unbesetzt).

**Krank, Ersatz, Eckdaten**
1. Krank/ZA → Mitarbeiter mit geplanten Blöcken, KM für heute → Blöcke rot, Meldung
   bleibt stehen.
2. „Ersatz“ → Liste → Klick auf einen Namen → Blöcke wandern, Toast.
3. Zweiter Ersatz-Klick am selben Mitarbeiter: nicht mehr möglich (kein roter Block).
4. Klick auf einen Namen im Raster: Eckdaten-Fenster. „Zur Mitarbeiterkarte“ öffnet
   den Reiter Mitarbeiter mit genau dieser Person. Auch auf dem Tablet unter 900 px
   Breite prüfen: Die Karte steht dort unter der Liste; man muss sie sehen oder
   hinscrollen können.
5. „Krank melden“ und „Zeitausgleich“ im Eckdaten-Fenster öffnen den Krank-Dialog
   mit KM bzw. ZA vorgewählt.

**Vorausplanung**
1. Planumsatz „60.000“ eintragen, Feld verlassen: „Gespeichert.“, Soll 300 (bei 200 €/h).
2. „60000,50“ wird 60.000,5; „abc“ meldet „Der Wert ist ungültig.“ und setzt das Feld zurück.
3. Stundenvorgabe von Hand 250: „Vorgabe für den Einsatzplan“ zeigt 250 „von Hand“;
   Feld leeren: wieder das Soll.
4. Schnell blättern, während gespeichert wird: Die Werte landen in der richtigen Woche.
5. Klick auf „KW …“ im Tabellenkopf öffnet den Einsatzplan dieser Woche.

**Drucken**
1. Wochenplan, Tagesplan, Tagespläne der Woche, Monat und Resturlaub einmal drucken
   (PDF genügt). Kopf mit Filiale und „erstellt am“ auf jeder Seite.
2. **Schwarz-Weiß:** einmal auf einem echten S/W-Drucker oder als Graustufen-PDF. Alle
   Kürzel müssen lesbar sein. Bisher nur farbig geprüft.
3. **Mehrseitig:** Tagespläne der Woche oder eine Filiale mit vielen Mitarbeitern: Der
   Kopf muss auf jeder Seite wiederkommen. Bisher hat jeder Testausdruck auf eine Seite gepasst.
4. **Safari/iPad:** „Resturlaub“ lädt erst Daten und öffnet danach den Druckdialog.
   Safari kann einen Druckdialog nach so einer Wartezeit blockieren. Prüfen, ob er
   erscheint; sonst an dtn melden. Auch prüfen, ob die Farben mitdrucken.
5. „Excel (Wochenplan)“: Datei öffnet sich in Excel, Zahlen sind Zahlen (Summe geht).

**Startseite**
1. Nach dem Anmelden erscheint die Startseite mit vier Kacheln.
2. Jede Zahl mit dem Reiter vergleichen: Abwesende der Woche im Reiter Abwesenheiten,
   Lücke in der Vorausplanung (Summe der roten Überhänge), Warnungen in der
   Regelprüfung der Tage (Wochenregeln dort an jedem Arbeitstag, hier einmal).
3. Jeder Knopf springt richtig: Abwesenheiten (Monat), Vorausplanung (laufende Woche),
   Einsatzplan (erster Tag mit Warnung), Abwesenheiten (Monat des ersten Wunsches).
   Ein Klick auf einen Tag in der Kachel Regelverstöße öffnet genau diesen Tag.
4. Eine Kachel ohne Befund zeigt „alles im grünen Bereich“ mit grünem Rand.
5. Tablet (1024 px): zwei Kacheln nebeneinander.

## 5. Bekannte Grenzen (Stufe 1)
- Die Reihenfolge der Mitarbeiter wird mit ▲/▼ geändert, nicht per Ziehen.
- Bedarfsplanung (Vorgaben je Bereich und Uhrzeit), IST-Erfassung und Zeitkonto
  folgen in späteren Stufen. Vergangene Tage im Einsatzplan sind bis dahin schreibgeschützt.
- Kopieren fügt Blöcke eines Mitarbeiters, der am Ziel abwesend ist, trotzdem ein
  (unbesetzt) und prüft dabei die Pflicht-Vorgaben gegen diese Zeit nicht. Wird die
  Abwesenheit später gelöscht, kann ein Block einer Pflicht-Vorgabe widersprechen,
  bis jemand ihn ändert.
- Die Ersatzsuche lässt jeden aus, der danach an dem Tag irgendeine Ruhezeit- oder
  Höchstarbeitszeit-Warnung hätte – auch eine, die schon vorher bestand.
- Freie Samstage im Jahr zählen erst ab dem Eintritt (bzw. ab 01.01.).
- Eine Wiederholung bei den Abwesenheiten lässt sich nur löschen, nicht ändern.
- Der Reiter für die Rolle „Mitarbeiter“ fehlt noch.

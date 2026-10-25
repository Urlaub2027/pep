# PEP – Anleitung

Für die Filialleitung und für dtn (Einrichtung). PEP läuft als statische Seite
(GitHub Pages) auf der Supabase-Datenbank des Urlaubstools.

Auf jeder Seite erklärt der runde „?“-Knopf oben rechts die Seite.

- **Stufe 0** (Grundgerüst): Mitarbeiter, Einstellungen, Abwesenheitskalender.
- **Stufe 1:** Einsatzplan mit Regelprüfung, Kopieren und Vorlagen,
  Krankmeldung mit Ersatzsuche, Eckdaten, Vorausplanung, Ausdrucke und Startseite.
- **Stufe 2** (dieser Stand): IST-Erfassung (tatsächliche Arbeitszeiten je Tag bestätigen)
  und Zeitkonto (Woche buchen, Journal, Korrekturen), dazu Stundenblatt,
  Wocheneinsatz-IST, das Journal als Excel und die Sicherung (Datei herunterladen und
  in eine leere Filiale einspielen).

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

### Umstellung von Stufe 1 auf Stufe 2

**Reihenfolge: erst die Datenbank, dann die Seite.** Die Seite der Stufe 1 läuft
mit der Datenbank der Stufe 2 weiter (alle ihre Funktionen gibt es dort unverändert),
umgekehrt nicht: Die Seite der Stufe 2 ruft Funktionen auf, die eine Stufe-1-Datenbank
nicht kennt. Auch der Weckruf (GitHub-Workflow) braucht `pep_lebenszeichen` aus dem
neuen Schema.

1. Im SQL-Editor den **aktuellen** Inhalt von `supabase/schema.sql` (Stand Stufe 2)
   noch einmal ausführen. Das Schema ist idempotent: Plan, Mitarbeiter, Verträge und
   Abwesenheiten bleiben stehen; neu kommen die Tabellen für IST, Wochenabschlüsse
   und das Zeitkonto-Journal. Der Test `tests/umstellung.test.mjs` spielt das mit
   einer eingefrorenen Stufe-1-Datenbank durch.
2. **Erst danach** Stufe 2 nach `main` übernehmen (Merge), damit GitHub Pages die
   neue Seite ausliefert.
3. Die Seite im Browser neu laden (Strg+F5).

**Start von IST und Zeitkonto (einmalig, wichtig):**

1. **Startwoche prüfen.** Nach dem Einspielen steht unter Einstellungen →
   „IST-Erfassung ab“ der **Montag der Woche, in der das Schema eingespielt wurde**.
   Ab diesem Tag gibt es IST, offene Tage und Wochenabschlüsse; davor nur den Plan.
   Wer früher oder später anfangen will, ändert das Datum **vor dem ersten
   „Woche buchen“**. Nach dem ersten Abschluss ist das Feld gesperrt.
   Achtung beim Vorverlegen: Jeder vergangene Tag ab dem neuen Datum gilt dann als
   „offen“; diese Wochen müssen alle der Reihe nach bestätigt und gebucht werden.
2. **Startsalden eintragen.** Den Stand des Zeitkontos aus der bisherigen
   Zeiterfassung (tegut) je Mitarbeiter im Reiter Zeitkonto eintragen: Namen
   anklicken → Journal → „Startsaldo“. Als Datum den **Sonntag vor der Startwoche**
   nehmen (ist die Startwoche angezeigt, ist das Feld so vorbelegt; ein früheres
   Datum geht auch; ein Datum in der Startwoche wird zwar gebucht, erscheint dann
   aber nicht als „Saldo Vorwoche“). Dann steht der Startsaldo in der
   Startwoche als „Saldo Vorwoche“. Das geht nur als erste
   Buchung eines Mitarbeiters, also **vor dem ersten Abschluss**. Danach geht nur
   noch „Korrektur von Hand“.
3. **Wochen der Reihe nach abschließen.** Die erste Woche, die sich buchen lässt,
   ist die Startwoche; danach immer die folgende.

## 2. Rollen

| Rolle | Darf |
|---|---|
| Leitung | alles: Mitarbeiter und Reihenfolge, Einstellungen, Abwesenheiten, Urlaubswünsche freigeben, Einsatzplan, IST erfassen und bestätigen, Zeitkonto (Woche buchen, Startsaldo, Korrektur von Hand), Vorausplanung, Drucken, Benutzer verwalten |
| Stellvertretung | Startseite, Abwesenheiten eintragen, Einsatzplan (Malen, Kommentare, Kopieren, Vorlagen, Krank/ZA, Ersatz), IST erfassen und bestätigen, Zeitkonto ansehen (Journal, Drucken, Excel), Vorausplanung eintragen, Drucken; Mitarbeiter nur ansehen; kein Reiter Einstellungen, keine Freigabe von Urlaubswünschen, kein „Woche buchen“, keine Buchungen im Zeitkonto |
| Mitarbeiter | noch keine Seite |

Weitere Benutzer legt die Leitung unter Einstellungen → Benutzer an. Der Benutzer
braucht dafür ein Konto im Urlaubstool.

## 3. Bedienung

Reiter: Start, Abwesenheiten, Vorausplanung, Einsatzplan, Zeitkonto, Mitarbeiter,
Einstellungen (nur Leitung). Es gibt keinen Speichern-Knopf: Jede Änderung wird
sofort gespeichert („Gespeichert.“ erscheint unten kurz).

### Startseite
Nach dem Anmelden erscheint die Startseite mit sechs Kacheln. Jede zeigt eine große
Zahl und hat einen Knopf, der zur passenden Stelle springt. Eine Kachel ohne Befund
hat einen grünen Rand und zeigt „alles im grünen Bereich“.

Über den Kacheln steht für die Leitung, wann zuletzt eine Sicherung heruntergeladen
wurde („Letzte Sicherung vor 3 Tagen“). Ab 8 Tagen und solange es noch keine gibt
(„Noch keine Sicherung“), ist die Zeile gelb. „Sicherung →“ springt zu Einstellungen →
Sicherung (siehe Abschnitt „Sicherung“ unten).

- **Abwesend diese Woche:** wie viele Personen in der laufenden Kalenderwoche
  (Montag bis Sonntag) mindestens einen Abwesenheitstag haben, an dem sie nicht
  eingeplant werden können: alle Codes mit „sperrt“ (Urlaub, Krank, Berufsschule,
  andere Filiale, Schulung, auch selbst angelegte wie „Fortbildung“). Nicht gezählt
  werden der Feiertag FT (er betrifft alle) und Codes, die nicht sperren. Darunter je
  Person und Code ein Eintrag, z. B. „KM 03.11.–05.11.“. Sprung: Abwesenheiten.
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
- **IST offen:** an wie vielen Tagen der letzten sechs Wochen (bis gestern, frühestens
  ab dem Start der IST-Erfassung) noch Zeilen nicht bestätigt sind; darunter die Zahl
  der offenen Zeilen und der früheste Tag. Offene Tage verhindern „Woche buchen“.
  Sprung: Einsatzplan im Modus IST am ersten offenen Tag.
- **Zeitkonto auffällig:** wer nach der zuletzt abgeschlossenen Woche zu viel Plus
  oder zu viel Minus hat (Warnfaktor × Wochenstunden, siehe Einstellungen). Gezählt
  wird nur Gebuchtes bis zum Sonntag dieser Woche. Ohne Abschluss: „Noch keine Woche
  abgeschlossen.“ Sprung: Reiter Zeitkonto in dieser Woche.

### Mitarbeiter
Links die Liste (inaktive grau am Ende, Kompetenz-Kürzel als Badges), rechts die
Karte der gewählten Person. „Neuer Mitarbeiter“ legt eine Person an. Auf der Karte:
Stammdaten (Name, Personalnummer, Geburtsdatum, Eintritt/Austritt, aktiv, Notiz),
**Verträge** (Gültig ab, Art, Wochenstunden, bei Führung die Zeitkonto-Grenze; pro
Datum nur einer, der letzte lässt sich nicht löschen), **Kompetenzen** (Haken je Bereich/Funktion), **Wochenvorgaben**
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
  „Gutschrift im Zeitkonto“ heißt: Die Stunden zählen im Zeitkonto wie Arbeitszeit
  (Standard: an; bei ZA aus, weil ZA das Zeitkonto abbaut). Ein neuer Code ohne
  „sperrt“ bekommt die Gutschrift standardmäßig nicht: An so einem Tag darf auch IST
  stehen, mit Gutschrift zählte der Tag doppelt (bestehende Codes mit dieser Kombination
  sind gelb markiert). Wer den Haken oder „sperrt“ ändert, nachdem schon Wochen
  abgeschlossen sind, bekommt für diese Wochen automatisch Korrekturen.
- **Parameter:** Rechenwerte mit Erklärung (z. B. Teiler 6 für Urlaubsstunden je Tag,
  Feiertags-Teiler, Ruhezeit, Pausen, „Späte Schicht ab“ für die Spalte „Spät“,
  Zeitkonto-Warnfaktor, Stundenleistung in €/h für die Vorausplanung).
- **IST-Erfassung ab:** Montag, ab dem es IST und Wochenabschlüsse gibt (siehe
  „Start von IST und Zeitkonto“ in Abschnitt 1). Nach dem ersten Wochenabschluss
  gesperrt.
- **Schulferien:** anlegen und löschen.
- **Urlaubstool:** welche Umfragen als Urlaubswünsche einfließen und welcher
  Teilnehmer welcher Mitarbeiter ist.
  - **Umfragen:** Angezeigt werden die Umfragen des Urlaubstools mit
    Urlaubswochen-Frage, deren Organisator unter „Benutzer“ dieser Filiale als
    **Leitung** eingetragen ist und sich seitdem **einmal selbst in der PEP angemeldet**
    hat (Umfragen der Stellvertretung erscheinen nicht), dazu die schon eingeschalteten.
    Bis zur ersten Anmeldung steht unter „Benutzer“ hinter dem Namen „noch nicht
    angemeldet“; so kann niemand die Umfragen eines anderen Organisators ohne dessen
    Zutun lesen. Die Stellvertretung sieht nur die eingeschalteten Umfragen. Jede Zeile nennt den Organisator („von …“, bei den
    eigenen „eigene Umfrage“). **Jede Leitung der Filiale** kann jede dieser Umfragen
    einschalten, auch die einer anderen Leitung. Eine Umfrage kann nur in einer
    Filiale eingeschaltet sein; ist sie schon in einer anderen eingeschaltet, meldet
    PEP „Diese Umfrage ist schon in einer anderen Filiale eingeschaltet.“ Ausschalten
    kann jede Leitung der Filiale, auch wenn der Organisator nicht mehr dabei ist.
    Die Zuordnungen bleiben dabei erhalten: Wird die Umfrage wieder eingeschaltet, sind
    sie wieder da, auch die von Hand gemachten.
    Wer als Leitung in die PEP aufgenommen wird, macht damit nach seiner ersten
    Anmeldung seine Urlaubstool-Umfragen für die anderen Leitungen der Filiale sichtbar.
  - **Teilnehmer zuordnen, Schritt für Schritt:**
    1. Oben die Umfrage mit dem Haken „aktiv“ einschalten. Solange keine Umfrage
       eingeschaltet ist, steht unter „Teilnehmer zuordnen“ nur der Hinweis
       „Zuerst oben eine Umfrage einschalten …“.
    2. Unter „Teilnehmer zuordnen“ stehen alle Teilnehmer der eingeschalteten
       Umfragen, die noch nicht zugeordneten zuerst. Die Kopfzeile zählt
       „n von m zugeordnet“.
    3. Wo PEP einen Mitarbeiter vorschlägt, steht er schon in der Auswahl, daneben
       „Vorschlag (noch nicht gespeichert)“. „Vorschläge übernehmen (k)“ speichert alle
       Vorschläge auf einmal, „Speichern“ in der Zeile nur diesen.
    4. Ohne Vorschlag den Mitarbeiter in der Auswahl wählen und „Speichern“.
       „— keine Zuordnung —“ und „Speichern“ löst eine Zuordnung.
    5. Erst danach erscheinen die Wünsche des Teilnehmers unter Abwesenheiten zum
       Freigeben.
  - **Vorschlag:** PEP vergleicht die Namensteile unabhängig von Reihenfolge,
    Groß-/Kleinschreibung, Komma und Bindestrich („Anna Muster-Beispiel“ =
    „Muster-Beispiel, Anna“) und schlägt den einen aktiven Mitarbeiter mit denselben
    Teilen vor, sonst den einen, dessen Name alle Teile enthält (z. B. nur der
    Vorname); passt es auf mehrere, gibt es keinen Vorschlag.
- **Benutzer:** Stellvertretung hinzufügen, Rolle ändern, entfernen.
- **Sicherung:** Sicherungsdatei herunterladen und in eine leere Filiale einspielen
  (siehe Abschnitt „Sicherung“ unten).

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
Ganz links der Umschalter **Plan | IST** (IST siehe nächster Abschnitt). Daneben die
Woche (◀ ▶, Datumsfeld, „Heute“) und die Tage Mo–So mit Öffnungszeit.
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
- **Vergangene Tage** sind im Plan schreibgeschützt; nur Kommentare lassen sich dort
  noch schreiben. Der Knopf „IST erfassen“ öffnet den Tag im Modus IST.
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
im Monat, Lage der Vorwoche, Zeitkonto und Kommentar. Die Zeile „Zeitkonto: +6,50 h
(aktuell · zuletzt gebucht KW 45)“ zeigt die Summe aller Buchungen (⚠ bei Warnung);
ein Klick öffnet das Journal. Von dort außerdem: „Krank melden“, „Zeitausgleich“ und
„Zur Mitarbeiterkarte“.

**Krank/ZA:** Mitarbeiter, Code (KM oder ZA) und Zeitraum wählen. Ganze Tage werden
eingetragen, auch rückwirkend; geschlossene Tage werden übersprungen. Geplante Blöcke
bleiben stehen und werden unbesetzt (rot). Stundenweise Abwesenheit (z. B. Arzttermin)
gehört in den Reiter Abwesenheiten.

**Ersatz:** zeigt, wer die unbesetzten Blöcke des Tages übernehmen kann – zuerst
die mit den meisten offenen Wochenstunden, dann weniger Samstage und Spätschichten.
Nicht aufgeführt ist, wer schon eingeplant oder abwesend ist, die Kompetenz nicht hat,
gegen eine Pflicht-Vorgabe verstoßen würde oder durch die Übernahme einen neuen oder
schärferen Verstoß gegen Ruhezeit oder Höchstarbeitszeit bekäme. Ein Verstoß, der schon
vorher bestand und durch die Übernahme nicht schlimmer wird, schließt nicht aus.
Ein Klick auf einen Namen übernimmt alle unbesetzten Blöcke des Tages.

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

### IST-Erfassung
Im Einsatzplan oben auf **IST** schalten. IST sind die Zeiten, die wirklich gearbeitet
wurden. Es gibt sie für heute und vergangene Tage ab dem Start der IST-Erfassung
(Einstellungen); künftige Tage und Tage vor dem Start zeigen nur den Plan.

- **Vorschlag:** Solange ein Tag offen ist und niemand etwas eingetragen hat, steht der
  Plan blass und gestrichelt in der Zeile. Nur besetzte Blöcke werden vorgeschlagen
  (nicht, was wegen Krankheit oder Urlaub unbesetzt ist). Der dünne Rahmen zeigt
  immer den Plan, auch wenn das IST schon abweicht.
- **Ändern:** malen wie im Plan (Pinsel, „Radieren“, Rückgängig). Der erste Strich
  übernimmt den Vorschlag und ändert ihn. Länger geblieben: weiter malen; früher
  gegangen: radieren. „Zeitrahmen erweitern“ zeigt 04:00 bis 24:00. Im IST gibt es
  keine Regelprüfung und keine Kompetenzprüfung; gesperrt sind nur künftige Zeiten,
  Zeiten ohne Vertrag, außerhalb 04:00–24:00, während einer sperrenden Abwesenheit
  und Überschneidungen.
- **Nicht gekommen:** die ganze Zeile radieren. Sie heißt dann „offen, leer“; beim
  Bestätigen zählen 0 Stunden. Krankheit gehört trotzdem als KM eingetragen.
- **Rechts in jeder Zeile:** Status („offen“, „offen, leer“, „bestätigt ✓“) und
  „Abw.“ = IST minus Plan in Stunden. Die Seitenleiste zeigt Plan und IST des Tages
  und welche Zeilen der Woche noch offen sind (Klick wählt den Tag).

**Jeden Tag** (nach Feierabend oder am nächsten Morgen):
1. Den Tag im Modus IST öffnen (die Startseite „IST offen“ springt zum ersten offenen Tag).
2. Abweichungen vom Plan malen.
3. **„Tag bestätigen“** – PEP fragt nach („… offene Zeilen bestätigen?“). Zeilen ohne
   eigenes IST übernehmen dabei den Vorschlag. Bestätigen lässt sich nicht
   zurücknehmen. Einzelne Zeilen bestätigt der Haken ✓ in der Zeile.

**Bestätigte Zeilen ändern:** Beim ersten Strich fragt PEP nach dem **Grund** (Pflicht,
z. B. „Inventur länger“). Der Grund gilt für alle Striche in dieser Zeile, bis der Tag
gewechselt wird, und steht im Protokoll. Ist die Woche schon gebucht, sagt der Dialog
das; PEP bucht die Änderung dann automatisch als Korrektur ins Zeitkonto.

**Ausdruck:** „Wocheneinsatz-IST drucken“ (siehe „Drucken“).

### Zeitkonto
Der Reiter zeigt eine Woche, zuerst die **Vorwoche** (das ist die Woche, die man am
Montag bucht). Je Mitarbeiter:

- **Soll:** Wochenstunden laut Vertrag, anteilig für die Tage Mo–Sa, an denen er
  beschäftigt ist (Eintritt oder Austritt mitten in der Woche zählt anteilig).
- **IST:** bestätigte Arbeitszeit ohne Pausen. Nicht bestätigte Tage zählen nicht.
- **Abwesend:** Abwesenheiten mit „Gutschrift im Zeitkonto“ (z. B. Urlaub, krank; ZA
  nicht).
- **Feiertag:** gesetzlicher Feiertag Mo–Sa, an dem die Filiale geschlossen ist:
  Wochenstunden ÷ Feiertags-Teiler.
- **Diff** = IST + Abwesend + Feiertag − Soll. Bei Führung zählt Plus erst über der
  Zeitkonto-Grenze (Vertrag, Standard 42 h).
- **Saldo Vorwoche**, **Saldo aktuell**, **Spät** (Arbeitszeit ab „Späte Schicht ab“)
  und **Offen** (Tage, die im IST noch offen sind; Klick springt hin).
- ⚠ auf gelbem Grund: Der Saldo liegt über Warnfaktor × Wochenstunden (Plus oder
  Minus). In der laufenden Woche sind Diff und Saldo aktuell grau („vorläufig“), weil
  das Soll der ganzen Woche gegen das IST bis heute steht.
- Diff grau mit **„nicht gebucht“**: Diese Diff bucht der Wochenabschluss nicht bzw. hat
  sie nicht gebucht – der Mitarbeiter ist inaktiv oder war beim Abschluss noch nicht
  angelegt (bzw. hatte da noch keinen Vertrag für die Woche). Sie zählt weder im Saldo noch in der Summe; wer
  sie trotzdem im Zeitkonto haben will, bucht sie als „Korrektur von Hand“.

**Jede Woche (Montag, nur Leitung):**
1. Reiter Zeitkonto öffnen; er zeigt die Vorwoche.
2. Steht dort „n Tage im IST offen“, darauf klicken und die Tage bestätigen.
   Solange etwas offen ist, ist „Woche buchen“ gesperrt.
3. **„Woche buchen“** – nach einer Rückfrage bucht PEP für jeden aktiven Mitarbeiter
   mit Vertrag die Diff dieser Woche ins Journal, auch 0. Ein Abschluss lässt sich
   nicht zurücknehmen. Wochen gehen nur der Reihe nach; vor dem ersten Abschluss
   erinnert der Dialog an die Startsalden.

**Korrekturen kommen automatisch.** Ändert sich nach dem Abschluss etwas, das die
Woche betrifft (IST, Abwesenheit, Vertrag, Ein- oder Austritt, Öffnungstag, Gutschrift
oder „sperrt“ eines Codes, Abwesenheits- oder Feiertags-Teiler), bucht PEP sofort für jeden Betroffenen
genau eine „Korrektur (automatisch)“ mit der Differenz. Der Grund im Journal beginnt
mit der Woche, z. B. „KW 46/2026: Inventur länger“ (bei IST-Änderungen der
eingegebene Grund, sonst z. B. „Abwesenheit geändert“).

**Journal:** Klick auf einen Namen. Alle Buchungen in der Reihenfolge, in der sie
gebucht wurden: Gebucht am, KW (für welche Woche), Art (Startsaldo, Wochenabschluss,
Korrektur (automatisch), Korrektur von Hand), Stunden, Saldo danach, Grund, Von.
Buchungen lassen sich nicht ändern oder löschen.

**Korrektur von Hand** (nur Leitung): im Journal „Korrektur buchen“. Stunden mit
Vorzeichen (z. B. „−4,5“ für ausgezahlte Überstunden, „2,25“), Datum (die Buchung
zählt in der Woche dieses Datums) und Grund (Pflicht). **Startsaldo** heißt der Knopf,
solange das Journal eines Mitarbeiters leer ist (siehe Abschnitt 1).

**Drucken** und **Journal als Excel** (auch für die Stellvertretung): siehe „Drucken“.

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
Die Ausdrucke sind A4 quer (das Stundenblatt A4 hoch), mit Kopf (Titel, Zeitraum,
Filiale, „erstellt am“).
Jede Zelle trägt Kürzel **und** Farbe, damit Schwarz-Weiß lesbar bleibt. Fehlen die
Farben, im Druckdialog „Hintergrundgrafiken“ einschalten.
- **Einsatzplan → Drucken:** Wochenplan, Tagesplan des gewählten Tags, Tagespläne der
  ganzen Woche, „Excel (Wochenplan)“ lädt eine .xlsx-Datei herunter.
- **Abwesenheiten → Drucken:** der angezeigte Monat oder „Resturlaub <Jahr>“.
- **Zeitkonto → Drucken:**
  - **Stundenblatt** für einen oder alle Mitarbeiter und einen Zeitraum (höchstens
    62 Tage, vorbelegt mit der angezeigten Woche), A4 hoch. Jeder Mitarbeiter beginnt
    auf einer neuen Seite: je Tag Anwesend von/bis, Pause, Abwesenheit, Arbeitszeit;
    darunter die Wochen mit Soll, IST, Diff und Saldo, am Ende Unterschriftszeilen
    für Mitarbeiter und Filialleitung. Nur Bestätigtes zählt; offene Tage stehen als
    „offen“ da.
  - **Wocheneinsatz-IST** der angezeigten Woche, A4 quer: je Mitarbeiter und Tag das
    bestätigte IST, dazu Soll, IST, Spät, Diff und Saldo. Derselbe Ausdruck kommt im
    Einsatzplan (Modus IST) über „Wocheneinsatz-IST drucken“.
- **Zeitkonto → Journal als Excel:** alle Buchungen eines Zeitraums (vorbelegt:
  01.01. bis heute) als .xlsx; das Datum ist eine echte Datumsspalte (TT.MM.JJJJ).

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
8. Urlaubstool: Umfrage einer zweiten Leitung („von …“) einschalten; ohne eingeschaltete
   Umfrage der Hinweis „Zuerst oben eine Umfrage einschalten …“; Vorschlag bei
   „Vorname Nachname“; „Vorschläge übernehmen“; Kopfzeile „n von m zugeordnet“ zählt mit.
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
1. Nach dem Anmelden erscheint die Startseite mit sechs Kacheln.
2. Jede Zahl mit dem Reiter vergleichen: Abwesende der Woche im Reiter Abwesenheiten
   (ohne Feiertag FT und ohne nicht sperrende Codes),
   Lücke in der Vorausplanung (Summe der roten Überhänge), Warnungen in der
   Regelprüfung der Tage (Wochenregeln dort an jedem Arbeitstag, hier einmal).
3. Jeder Knopf springt richtig: Abwesenheiten (Monat), Vorausplanung (laufende Woche),
   Einsatzplan (erster Tag mit Warnung), Abwesenheiten (Monat des ersten Wunsches).
   Ein Klick auf einen Tag in der Kachel Regelverstöße öffnet genau diesen Tag.
4. Eine Kachel ohne Befund zeigt „alles im grünen Bereich“ mit grünem Rand.
5. Tablet (1024 px): zwei Kacheln nebeneinander.

**IST und Zeitkonto (nach dem Einspielen von Stufe 2 in Supabase)**

Diese Punkte kann der automatische Test nicht abdecken: Er läuft gegen eine
nachgebildete Datenbank, nicht gegen Supabase, und ohne echtes Excel und echten Drucker.
1. **Automatische Korrektur auf Supabase:** In einer schon gebuchten Woche bei einem
   Mitarbeiter das IST eines Tages ändern (Grund eingeben). Danach im Journal dieses
   Mitarbeiters nachsehen: Es muss **genau eine** neue Zeile „Korrektur (automatisch)“
   mit „KW …: <Grund>“ und der richtigen Stundenzahl stehen. Das prüft den Trigger, der
   erst beim Speichern bucht; in Supabase ist er nie gelaufen.
2. **Excel:** „Journal als Excel“ herunterladen und in Excel öffnen. Die Spalte Datum
   muss TT.MM.JJJJ zeigen und sich nach Datum richtig sortieren lassen (nicht wie Text).
3. **Stundenblatt drucken:** einmal für alle Mitarbeiter auf Papier oder als PDF. Jede
   Person auf einer eigenen Seite, mit beiden Unterschriftszeilen.
4. Einstellungen → „IST-Erfassung ab“ zeigt den Montag der Einspielwoche (oder den
   gewünschten Start, siehe Abschnitt 1).
5. Als Stellvertretung: Zeitkonto ansehen, drucken, Excel – aber kein „Woche buchen“,
   im Journal nur „Schließen“.

**Sicherung (gegen Supabase)**
1. Einstellungen → Sicherung → „Sicherung herunterladen“: Die Datei
   `PEP-Sicherung-2558-<Datum>.json` landet im Download-Ordner; Dauer und Größe notieren.
   Die Startseite zeigt danach „Letzte Sicherung heute“.
2. Dieselbe Datei unter „Datei wählen“ auswählen: Die Vorschau zeigt die Filiale, die
   Anzahlen und „nicht leer“ (Einspielen geht hier nicht – das ist richtig).
3. **Einspielen gegen Supabase** einmal in einem **zweiten, leeren Supabase-Projekt**
   ausprobieren, nie im echten: Eine eingespielte Filiale lässt sich nicht wieder löschen,
   weil Zeitkonto-Buchungen unveränderbar sind. Schritte wie unter „Nach einem Datenverlust
   in ein neues Supabase-Projekt“; die Seite dafür lokal mit einer `docs/config.js` öffnen,
   die auf das Testprojekt zeigt. Dauer notieren. Zeigt PEP einen Fehler (z. B. Anfrage zu
   groß oder Zeitüberschreitung), den Wortlaut an dtn.

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

Supabase sichert im kostenlosen Tarif nichts. Darum hat PEP eine eigene
Sicherungsdatei mit allen Daten der Filiale: Mitarbeiter, Verträge, Abwesenheiten,
Plan, IST, Zeitkonto-Journal, Abschlüsse und Einstellungen. Das **Protokoll** (wer hat
wann was geändert) ist nur für die **letzten 12 Monate** dabei; ältere Einträge fehlen
nach einem Einspielen.

**Herunterladen (jede Woche, nur Leitung).** Einstellungen → Sicherung →
„Sicherung herunterladen“. Die Datei heißt `PEP-Sicherung-2558-<Datum>.json`.

- Die Datei enthält Personaldaten. **Auf dem PC oder einem USB-Stick aufbewahren,
  nicht per E-Mail verschicken** und nicht in ein öffentliches Verzeichnis legen.
- Ein paar ältere Dateien aufheben, damit auch eine Sicherung von vor einem Fehler da ist.
- Die Startseite erinnert daran: Ab 8 Tagen ohne Sicherung ist die Zeile gelb.
- Ein Jahr mit 18 Mitarbeitern ergibt eine Datei von rund 16 MB, zwei Jahre rund 24 MB
  (gemessen mit erfundenen Daten, siehe Bekannte Grenzen).
- **Das Urlaubstool hat seine eigene Sicherung je Umfrage** (dort herunterladen).
  Die PEP-Sicherung enthält nur, welche Umfragen die Filiale liest
  und wie die Teilnehmer zugeordnet sind, nicht die Umfragen selbst.

**Einspielen.** Das geht nur in eine **leere** Filiale: ohne Mitarbeiter,
Abwesenheiten, Plan, IST, Zeitkonto-Buchungen und Wochenabschlüsse. Bereiche, Codes,
Zeiten und Einstellungen einer neuen Filiale zählen nicht; sie werden durch die aus
der Datei ersetzt, ebenso Name, Nummer und Bundesland der Filiale. Eine volle Filiale
lässt sich so nicht überschreiben.

1. Einstellungen → Sicherung → „Datei wählen“ und die Sicherung auswählen.
2. PEP zeigt eine Vorschau: Filiale, Datum der Sicherung, wie viele Mitarbeiter,
   Abwesenheiten, Blöcke, Buchungen usw. und ob die eigene Filiale leer ist.
3. Zur Bestätigung die **Filialnummer aus der Datei** eintippen (z. B. 2558) und
   „Einspielen“ klicken.
4. PEP zeigt, was eingespielt und was ausgelassen wurde:
   - **Benutzer** (Stellvertretung usw.) werden nur zugeordnet, wenn es den
     Benutzernamen im Urlaubstool gibt und er keiner anderen Filiale gehört. Wer
     einspielt, bleibt Leitung.
   - Steht in einem Eintrag ein Benutzer, den es hier nicht gibt (z. B. „angelegt von“),
     bleibt das Feld leer.
   - **Urlaubstool-Umfragen** sucht PEP über Organisator, Titel und Jahr, die Teilnehmer
     über ihren Namen. Die Nummern (Ids) im Urlaubstool sind nach dessen eigenem
     Einspielen andere, darum nicht über die Nummer. Eingeschaltet wird eine Umfrage nur,
     wenn ihr Organisator nach dem Einspielen Leitung der Filiale (nach ihrer ersten
     Anmeldung) ist und keine andere Filiale sie nutzt. Beim Einspielen gilt das nur für
     die Umfragen der Leitung, die einspielt; die anderer Leitungen werden ausgelassen
     und gezählt, bis diese sich angemeldet haben. Was nicht eindeutig gefunden wird,
     zählt als ausgelassen:
     danach unter Einstellungen → Urlaubstool die Umfrage einschalten und die Teilnehmer
     zuordnen. Genehmigte Urlaubstage bleiben in jedem Fall erhalten; nur wenn die Umfrage
     fehlt, erscheint der Wunsch dazu wieder als offen.
   - Stammt die Datei aus einer **neueren PEP-Version** (sie enthält Daten, die diese
     Datenbank noch nicht kennt), lehnt PEP sie schon in der Vorschau ab. Dann zuerst
     `supabase/schema.sql` in der neuesten Fassung einspielen.

Das Zeitkonto kommt genau so zurück, wie es war: alle Buchungen mit Saldo, Grund und
Zeitpunkt, alle abgeschlossenen Wochen und der Start der IST-Erfassung. Beim
Einspielen bucht PEP keine automatischen Korrekturen.

**Nach einem Datenverlust in ein neues Supabase-Projekt:**

1. Neues Supabase-Projekt anlegen. Zuerst das **Urlaubstool** dort einrichten (wie in
   seiner Anleitung) und die Organisatoren mit **denselben Benutzernamen** wie vorher
   anlegen. Jede Umfrage aus den Sicherungen des Urlaubstools spielt **ihr bisheriger
   Organisator** ein (derselbe Benutzername; wer einspielt, wird Organisator), und zwar
   **mit unverändertem Titel**: PEP findet sie über Organisator, Titel und Jahr wieder.
   Gehört eine Umfrage einer anderen Leitung, wird sie beim Einspielen nicht verknüpft:
   Diese Leitung meldet sich nach dem Einspielen einmal in der PEP an, danach wird ihre
   Umfrage unter Einstellungen → Urlaubstool von Hand eingeschaltet und die Teilnehmer
   werden zugeordnet (Schritt 7).
2. Im SQL-Editor den Inhalt von `supabase/schema.sql` ausführen.
3. Im SQL-Editor die erste Leitung festlegen:
   `select pep.start_leitung('<benutzername>');`
4. In `docs/config.js` Adresse und öffentlichen Schlüssel des neuen Projekts
   eintragen und auf GitHub hochladen (die Seite und der Weckruf lesen beides von dort).
5. Seite öffnen, anmelden, **Filiale anlegen** (Name, Nummer und Bundesland werden
   beim Einspielen aus der Datei übernommen).
6. Einstellungen → Sicherung → die letzte Sicherung einspielen (wie oben).
7. Danach prüfen: Benutzer (Stellvertretung), Einstellungen → Urlaubstool (Umfragen
   und Zuordnungen), Reiter Zeitkonto (Salden). Andere Leitungen melden sich einmal an;
   danach ihre Umfragen einschalten und zuordnen.

## 5. Bekannte Grenzen
- Die Reihenfolge der Mitarbeiter wird mit ▲/▼ geändert, nicht per Ziehen.
- Bedarfsplanung (Vorgaben je Bereich und Uhrzeit) folgt in einer späteren Stufe.
- Kopieren fügt Blöcke eines Mitarbeiters, der am Ziel abwesend ist, trotzdem ein
  (unbesetzt) und prüft dabei die Pflicht-Vorgaben gegen diese Zeit nicht. Wird die
  Abwesenheit später gelöscht, kann ein Block einer Pflicht-Vorgabe widersprechen,
  bis jemand ihn ändert.
- Freie Samstage im Jahr zählen erst ab dem Eintritt (bzw. ab 01.01.).
- Eine Wiederholung bei den Abwesenheiten lässt sich nur löschen, nicht ändern.
- Der Reiter für die Rolle „Mitarbeiter“ fehlt noch.

**IST und Zeitkonto (Stufe 2)**
- Die Spalte „Spät“ zählt nur die Stunden ab „Späte Schicht ab“. Einen Zeitzuschlag
  (z. B. Prozent auf Spätstunden) rechnet PEP nicht.
- Wochen lassen sich nur der Reihe nach abschließen, beginnend mit der Startwoche. Ein
  Abschluss lässt sich nicht zurücknehmen, und der Start der IST-Erfassung lässt sich
  danach nicht mehr ändern.
- Deaktivierte Mitarbeiter und solche, deren Austritt vor der Woche liegt, bekommen
  beim Abschluss keine Zeile – und damit auch keine automatischen Korrekturen für
  diese Woche.
- Wer nach einem Wochenabschluss deaktiviert wird, bekommt für die schon gebuchten
  Wochen keine automatischen Korrekturen mehr (etwa nach Änderung eines Teilers); dann
  von Hand korrigieren.
- Wer nachträglich angelegt wird und einen Vertrag rückwirkend bekommt, erhält für
  schon abgeschlossene Wochen keine automatischen Korrekturen. Das bei Bedarf mit
  „Korrektur von Hand“ nachbuchen.
- Selten meldet PEP einen Fehler, wenn „Woche buchen“ und das Speichern eines Vertrags
  genau gleichzeitig laufen. Dann einfach noch einmal klicken.

**Sicherung (Stufe 2)**
- Einspielen geht nur in eine leere Filiale, nicht als „Zurückspulen“ einer vollen. Eine
  Filiale mit Zeitkonto-Buchungen lässt sich nicht löschen (das Journal ist unveränderbar):
  Zum Ausprobieren also nie in eine zweite Filiale des echten Projekts einspielen.
- Im Protokoll stehen nach dem Einspielen die alten Einträge mit den Nummern (Ids) der
  alten Datenbank; die übrigen Daten bekommen neue Nummern.
- Das Protokoll ist nur für die letzten 12 Monate in der Datei.
- Größe (erfundene Daten, 18 Mitarbeiter): ein Jahr rund 16 MB, zwei Jahre rund 24 MB.
  Plan, IST und Zeitkonto enthält die Datei immer für alle Jahre, sie wächst also um
  rund 8 MB je Jahr. Ob Supabase eine so große Datei beim Einspielen in einem Stück
  annimmt und ob das Zeitlimit einer Anfrage reicht, ist **nicht geprüft** (in der
  Testdatenbank dauerte das Einspielen 2,5 s bzw. 4 s). Siehe Handprüf-Checkliste.
- Die Datei ist gegen Beschädigung geschützt (Prüfsumme, Prüfung der Zeitkonto-Salden),
  nicht gegen absichtliche Fälschung. Deshalb bleibt sie als Datei auf dem PC oder
  USB-Stick und wird nicht weitergegeben.

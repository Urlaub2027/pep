# PEP – Anleitung

Für die Filialleitung und für dtn (Einrichtung). PEP läuft als statische Seite
(GitHub Pages) auf der Supabase-Datenbank des Urlaubstools. Stufe 0 ist das
Grundgerüst: Mitarbeiter, Einstellungen und der Abwesenheitskalender.

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

## 2. Rollen

| Rolle | Darf |
|---|---|
| Leitung | alles: Mitarbeiter, Einstellungen, Abwesenheiten, Urlaubswünsche freigeben, Benutzer verwalten |
| Stellvertretung | Abwesenheiten eintragen und Wiederholungen löschen, Mitarbeiter ansehen; kein Reiter Einstellungen, keine Freigabe von Urlaubswünschen |
| Mitarbeiter | in Stufe 0 noch keine Seite |

Weitere Benutzer legt die Leitung unter Einstellungen → Benutzer an. Der Benutzer
braucht dafür ein Konto im Urlaubstool.

## 3. Bedienung

Reiter: Start, Abwesenheiten, Vorausplanung, Einsatzplan (Start, Vorausplanung und
Einsatzplan folgen in Stufe 1), Mitarbeiter, Einstellungen (nur Leitung).

### Mitarbeiter
Links die Liste (inaktive grau am Ende, Kompetenz-Kürzel als Badges), rechts die
Karte der gewählten Person. „Neuer Mitarbeiter“ legt eine Person an. Auf der Karte:
Stammdaten (Name, Personalnummer, Geburtsdatum, Eintritt/Austritt, aktiv, Notiz),
**Verträge** (Gültig ab, Art, Wochenstunden; pro Datum nur einer, der letzte lässt
sich nicht löschen), **Kompetenzen** (Haken je Bereich/Funktion), **Wochenvorgaben**
(Wochentag, nicht verfügbar / nur zwischen, Pflicht, Gültigkeit) und **Urlaubsjahre**
(Anspruch und Rest aus dem Vorjahr in Stunden).

### Einstellungen (Leitung)
- **Rahmen:** Öffnungszeiten je Wochentag.
- **Abweichende Tage:** Feiertage erscheinen grau; „öffnen …“ macht daraus eine
  Abweichung mit eigenen Zeiten. Eigene Abweichungen mit Datum, Art, Name.
- **Bereiche:** Kürzel, Name, Farbe, Art, ob eine Kompetenz nötig ist, aktiv.
- **Codes:** Abwesenheitscodes (z. B. U, KM, BS) mit Stundenregel, sperren, neu anlegen.
- **Parameter:** Rechenwerte mit Erklärung (z. B. Teiler 6 für Urlaubsstunden je Tag).
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
  nennt sie. „keine“ löscht. Bei Codes mit Stundenregel „tatsächlich“ fragt ein
  Dialog nach den Stunden, bei „mit Uhrzeit“ zusätzlich nach von/bis.
- **Wiederholung …:** Code, Wochentag und Ende wählen (z. B. BS jeden Dienstag bis
  30.06.). „In Schulferien aussetzen“ (Standard an) lässt die Tage in den
  eingetragenen Schulferien aus. Löschen einer Wiederholung entfernt alle künftigen Tage.
- **Ansehen** (Standard-Modus): Klick auf eine Zelle öffnet den Info- oder
  Wunsch-Dialog.
- **Urlaubswünsche freigeben (nur Leitung):** Offene Wünsche aus dem Urlaubstool
  erscheinen gestrichelt („U?“). Im Dialog genehmigen oder ablehnen; genehmigte
  werden zu Urlaubstagen. Abgelehnte Wünsche bleiben abgeblendet („U?“ grau) sichtbar;
  ein Klick erlaubt erneutes Genehmigen. Ändert ein Mitarbeiter seine Antwort im Urlaubstool,
  zeigt die Zelle „!“; die Leitung kann die Freigabe zurücknehmen.
- Seitenleiste „Urlaub <Jahr>“: Anspruch, genehmigt, offen (geschätzt), Rest.

## 4. Handprüf-Checkliste

Nach der Einrichtung einmal durchgehen (als Leitung, jeweils am Schluss als
Stellvertretung). Diese Punkte konnten bisher nicht im Browser geprüft werden.

**Mitarbeiter**
1. „Neuer Mitarbeiter“, Name „Test, Person“ speichern: erscheint in der Liste.
2. Vertrag ab 01.01.2026, Teilzeit, 30 h: Liste zeigt „Teilzeit · 30,0 h“. Zweiter
   Vertrag mit gleichem Datum: Fehler VERTRAG_DOPPELT; letzten Vertrag löschen: LETZTER_VERTRAG.
3. Kompetenz Kasse haken: Badge in der Liste; abhaken entfernt es.
4. Wochenvorgabe Sa, nicht verfügbar, Pflicht: Zeile erscheint; Löschen geht.
5. Urlaubsjahr 2027, 180 h, Rest 0: Zeile mit gesperrtem Jahr; Ändern speichert.
6. Seite neu laden: alles da. Mitarbeiter inaktiv: grau, am Listenende.
7. Als Stellvertretung: lesbar, aber keine Speichern-/Löschen-Knöpfe.
8. Breite unter 900 px: Liste über Karte; breiter: nebeneinander.

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
4. KM über U ziehen: Zellen werden KM. „keine“ ziehen: Zellen leer.
5. Code mit Regel „tatsächlich“: Dialog fragt Stunden; leer: Fehler im Dialog;
   Abbrechen/Escape: nichts gespeichert.
6. „mit Uhrzeit“ + BS: Dialog verlangt Stunden und von/bis; Zelle zeigt „BS 08–13“.
7. „Wiederholung …“: BS, Dienstag, bis 30.06.: Dienstage „BS 8,00“.
8. Offener Wunsch: Zellen gestrichelt „U?“; Modus „Ansehen“, Klick: Dialog mit vorbelegtem
   Zeitraum; Genehmigen: volle Zellen. Als Stellvertretung keine Genehmigen/Ablehnen-Knöpfe.
9. Im Urlaubstool Antwort ändern, Reiter neu laden: „!“ mit Tooltip; Klick: Info-Dialog
   mit „Zurücknehmen“ (nur Leitung): Zellen leer.
10. Seitenleiste „Urlaub 2027“: Anspruch, genehmigt, offen, Rest stimmig.
11. Tablet: Ziehen ohne Seitenscrollen. Monat ◀ ▶ über den Jahreswechsel.

## 5. Bekannte Grenzen (Stufe 0)
- Eine Wiederholung lässt sich nur löschen, nicht ändern.
- Start, Vorausplanung und Einsatzplan sind noch nicht gebaut.

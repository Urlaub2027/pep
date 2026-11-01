# PEP – Mitarbeiter-Zugang (Design)

Stand: umgesetzt auf Branch mitarbeiter-zugang (01.11.2026).
Entwurf vom 01.11.2026. Grundlage: PEP_HANDOFF.md „Stufe 3 – Mitarbeiter-Seite“, Wunsch der
Filialleitung (31.10.2026) und Gespräch mit dtn am 01.11.2026.
Kennzeichnung: **[dtn]** = so gesagt oder bestätigt, **[meine Wahl]** = von mir
entschieden, vom Builder nicht zu ändern ohne Rückfrage.

Das Repository ist öffentlich: keine echten Namen in Code, Tests oder Doku.

## 1. Zweck

Die Mitarbeiter sollen auf dem Handy nachsehen können, wann sie arbeiten, statt am
Aushang oder per WhatsApp nachzufragen **[dtn]**. Dazu ihren eigenen Urlaub und ihr
eigenes Zeitkonto **[dtn]**. Sie dürfen „nicht zu viel sehen“ **[dtn]**, und vor dem
ersten Blick bestätigen sie einen Datenschutztext **[Filialleitung]**.

Erfolg: Eine Mitarbeiterin öffnet die PEP auf dem Handy, sieht ihre Schichten der
freigegebenen Wochen, wer an diesen Tagen mit ihr eingeteilt ist, ihren Resturlaub und
ihren Zeitkonto-Saldo – und nichts über Abwesenheiten, Stunden oder Urlaub der Kollegen.

## 2. Ziele, Nicht-Ziele, Anti-Ziele

Ziele
- Einladung je Mitarbeiter-Eintrag durch die Leitung, Konto fest an diesen Eintrag
  gebunden **[dtn]**.
- Datenschutzbestätigung vor dem ersten Blick, versioniert und nachweisbar **[dtn]**.
- Freigabe je Woche: Mitarbeiter sehen eine Woche erst, wenn die Leitung sie
  freigegeben hat **[dtn]**.
- Nur-Lese-Ansicht für Mitarbeiter, fürs Handy gebaut.

Nicht-Ziele
- **Kein Schichttausch**, keine Urlaubsanträge, keine Benachrichtigungen in dieser
  Stufe **[meine Wahl, von dtn bestätigt]**. Bleiben Ausbaustufen.
- Keine Passwort-zurücksetzen-Mail: die Konten haben keine echte Mailadresse.
  Vergessenes Passwort = neuer Einladungslink **[meine Wahl, von dtn bestätigt]**.
- Keine Anzeige von IST-Zeiten einzelner Tage; das Zeitkonto zeigt nur Wochenwerte
  (Abschnitt 5.3).
- Kein Zugang zum Urlaubstool für Mitarbeiter-Konten.

Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)
- **Ein Mitarbeiter-Konto erfährt, wer fehlt oder warum** – weder Code noch Hinweis
  „abwesend“ noch eine auffällige Lücke mit Namen **[dtn: „keine KM und von wem“]**.
- Schutz nur in der Oberfläche. Jede Grenze dieses Dokuments sitzt in den
  `pep_*`-Funktionen; wer die API direkt aufruft, bekommt dasselbe wie die Seite.
- Ein Mitarbeiter-Konto wird Organisator im Urlaubstool (sähe dann dessen Verwaltung
  und könnte Umfragen anlegen).
- Ein bestehender `pep_*`-Aufruf liefert einem Mitarbeiter-Konto irgendetwas.

## 3. Konten und Einladung

### 3.1 Ausgangslage (gemessen im Code, 01.11.2026)

- Konten entstehen über Supabase-Auth (`Benutzername@example.com` + Passwort). Der
  Trigger `urlaub_neuer_benutzer` auf `auth.users` (Urlaubstool-Repo,
  `urlaub.neuer_benutzer()`) **lehnt jedes Konto ohne Urlaubstool-Einladung ab** und
  legt jedes neue Konto als `urlaub.organisatoren`-Zeile an.
- `pep.benutzer.user_id` verweist auf `urlaub.organisatoren`; `pep.ich()` verlangt
  Benutzer **und** nicht gesperrten Organisator. Ein Konto ohne beides bekommt von
  allen bestehenden `pep_*`-Funktionen `KEIN_ZUGRIFF` – das ist erwünscht und bleibt so.

### 3.2 Neuer Weg

- Neue Tabelle `pep.mitarbeiter_zugaenge`: `mitarbeiter_id` (PK, → `pep.mitarbeiter`,
  cascade), `user_id` (unique, → `auth.users`, nullable bis eingelöst),
  `gesperrt` (bool), `angelegt_von`, `angelegt_am`. Ein Zugang je Mitarbeiter-Eintrag
  **[meine Wahl]**.
- Neue Tabelle `pep.mitarbeiter_einladungen`: `code` (zufällig, wie
  `urlaub.einladungen`), `mitarbeiter_id`, `gueltig_bis` (**7 Tage** **[meine Wahl]**),
  `eingeloest_am`, `erstellt_von`. Eine neue Einladung macht offene ältere desselben
  Mitarbeiters ungültig.
- Registrierung: Die PEP-Seite ruft Supabase-Signup mit Metadaten
  `{ pep_einladung: <code> }` auf. Der Mitarbeiter wählt den Benutzernamen selbst
  und ein Passwort. Die Benutzernamen-Regeln des Urlaubstools prüft der PEP-Trigger
  zusätzlich in der Datenbank; Kollisionen mit Organisatoren verhindert schon die
  eindeutige Mailadresse in `auth.users` (gleiche Domain) **[meine Wahl]**.
- **Änderung im Urlaubstool-Repo nötig:** `urlaub.neuer_benutzer()` gibt bei
  vorhandenem `pep_einladung` sofort `new` zurück – **vor** den Prüfungen
  `EINLADUNG_FEHLT` und `NAME_LEER` (kein Organisator, keine Urlaubstool-Prüfung),
  aber **nur, wenn `to_regclass('pep.mitarbeiter_einladungen')` existiert**: in einer
  Urlaubstool-Installation ohne PEP-Schema bleibt alles wie heute, sonst ließe der
  Metadaten-Schlüssel dort jeden ein Konto anlegen **[meine Wahl]**. Beide Apps
  liegen im selben Supabase-Projekt (PEP_HANDOFF.md). Ein neuer PEP-Trigger auf `auth.users` prüft dann den Code
  (sperren `for update`, gültig, nicht eingelöst) und trägt `user_id` in
  `pep.mitarbeiter_zugaenge` ein; ungültig → Ausnahme, das Konto entsteht nicht.
  Beide Trigger laufen in derselben Transaktion; ein Konto mit gefälschtem
  `pep_einladung` scheitert also am PEP-Trigger. Der Wortlaut der Ausnahme im
  Urlaubstool ist ein **Fachregel-Duplikat** und wird in beiden Repos kommentiert.
  Reihenfolge: Urlaubstool-Änderung zuerst einspielen, sonst lehnt dessen Trigger
  jede Mitarbeiter-Registrierung ab.
- Erneutes Einladen eines Mitarbeiters mit bestehendem Konto (Passwort vergessen):
  Der neue Link macht ältere offene Links ungültig; das bisherige Konto bleibt gültig,
  bis der neue Link eingelöst ist (niemand wird vorzeitig ausgesperrt). Danach zeigt
  der Zugang auf das neue Konto, das alte Auth-Konto bleibt ohne Zugang zurück und
  wird nicht gelöscht **[meine Wahl]**. Das neue Konto muss die
  Datenschutzbestätigung **neu** abgeben – ein weitergegebener Link könnte bei einer
  anderen Person gelandet sein **[meine Wahl]**.

### 3.3 Verwaltung durch die Leitung

- Im Reiter „Mitarbeiter“ je Eintrag: Zustand „kein Zugang / eingeladen bis … /
  aktiv seit … / gesperrt“, Datum der Datenschutzbestätigung, Knöpfe „Zugang
  einrichten“ (bzw. „Neuer Link“), „Sperren“/„Entsperren“.
- „Zugang einrichten“ zeigt den Link zum Kopieren und Teilen (Teilen-Dialog des
  Handys, wo vorhanden).
- **Nur die Leitung** darf einladen und sperren, nicht die Stellvertretung
  **[meine Wahl]** – passt zu „Stammdaten nur Leitung“ aus Stufe 0/1.
- Mitarbeiter inaktiv oder Austritt erreicht → Zugang wirkt wie gesperrt, ohne dass
  jemand klicken muss **[meine Wahl]**.

## 4. Datenschutzbestätigung

- Eigene Tabelle `pep.datenschutz_texte` (`filiale_id`, `version`, `text`, `am`,
  `von`), nur anfügen; gültig ist die höchste Version. Eigene Funktionen zum Lesen und
  Speichern (Leitung), **nicht** über `pep.einstellungen` und dessen Schlüssel-Liste;
  Speichern mit unverändertem Text legt keine neue Version an **[meine Wahl]**. Die
  Texte kommen mit in die Sicherung (Inhalt der Filiale).
- Tabelle `pep.zustimmungen` (`mitarbeiter_id`, `version`, `user_id`, `am`), nur
  anfügen, nie ändern. Gültig ist eine Zustimmung nur für die aktuelle Version **und**
  das aktuelle Konto (`user_id`) des Mitarbeiters.
- Solange für die aktuelle Version keine Zustimmung vorliegt, liefert jede
  Mitarbeiter-Funktion `ZUSTIMMUNG_FEHLT`; die Seite zeigt dann nur den Text und
  „Ich habe den Text gelesen und stimme zu“. Prüfung **in der Datenbank** **[meine Wahl]**.
- Ohne hinterlegten Text gibt es keinen Mitarbeiter-Zugang (Einladen geht nicht,
  Fehlermeldung nennt den Grund) **[meine Wahl]**.
- Den Text liefern Filialleitung/Personalabteilung. Ein Entwurf liegt bei, ist aber
  **rechtlich ungeprüft** und so beschriftet.

## 5. Was ein Mitarbeiter sieht

Alles nur für die **freigegebenen** Wochen (Abschnitt 6), außer Urlaub und Zeitkonto.

### 5.1 Eigener Plan [dtn]
Je Tag der Woche: eigene Blöcke (von–bis, Bereich), Pausen, Arbeitszeit, eigener
Tageskommentar (Aufgabe). Feiertag/geschlossen als solcher erkennbar. Eigene
Abwesenheiten mit Code (z. B. „U“) – das sind seine eigenen Daten, auch stundenweise
neben Blöcken am selben Tag.

### 5.2 Kollegen am selben Tag [dtn]
Name und Arbeitszeit(en) der Kollegen, die an diesem Tag **eingeplant** sind.
- Wer an diesem Tag abwesend ist, erscheint **gar nicht** – auch nicht ohne Grund
  **[dtn]**. Regel: Hat ein Kollege an dem Datum **irgendeine** Abwesenheitszeile
  (ganz- oder stundenweise, jeder Code), fällt er für diesen Tag ganz aus der Liste,
  auch wenn er daneben Blöcke hat **[meine Wahl]**. Preis: Wer z. B. zwei Stunden
  beim Arzt ist und sonst arbeitet, fehlt in der Kollegenliste. Dafür verrät auch
  eine gekürzte Schicht nichts.
- Keine Bereiche, Kommentare, Stunden, Verträge der Kollegen **[meine Wahl]**.
- Nur für freigegebene Wochen, nur die eigene Filiale.
- Schalter `mitarbeiter_kollegen` (Einstellungen → Datenschutz, nur Leitung, Vorgabe an
  **[dtn]**): Aus ⇒ `kollegen` ist an jedem Tag `null`, die Datenbank liefert keine
  Kollegennamen aus (nicht nur die Oberfläche blendet sie aus).

### 5.3 Eigener Urlaub und eigenes Zeitkonto [dtn]
- Urlaub: genommene und eingetragene Urlaubstage des laufenden Jahres, Resturlaub –
  über den internen Kern `pep.urlaub_konto(mitarbeiter, jahr)`, den auch
  `pep_resturlaub` nutzt (kein Nachbau). „Eingetragen“ = Zeilen in
  `pep.abwesenheiten`; noch nicht übernommene Wünsche aus dem Urlaubstool zählen
  nicht **[meine Wahl]**.
- Zeitkonto: Saldo der zuletzt abgeschlossenen Woche und die letzten Wochen
  (Saldo Vorwoche, Ist, Soll, Saldo) – dieselbe Rechnung wie das Zeitkonto der
  Leitung, gefiltert auf den einen Mitarbeiter, kein Nachbau. Wo der Kern nur in einer
  Leitungs-Funktion steckt, wird er in einen internen Helfer herausgezogen, den beide
  aufrufen; die Rechenregeln ändern sich dabei nicht, und die bestehenden
  Zeitkonto-Tests müssen unverändert grün bleiben **[meine Wahl]**. Urlaub und Zeitkonto
  hängen **nicht** an der Wochenfreigabe **[meine Wahl]**.

## 6. Wochenfreigabe

- Tabelle `pep.wochen_freigaben` (`filiale_id`, `montag`, `freigegeben_am`,
  `freigegeben_von`). Leitung **und Stellvertretung** dürfen freigeben und
  zurücknehmen – beide planen **[meine Wahl]**.
- Im Einsatzplan der Wochenansicht: Knopf „Woche für Mitarbeiter freigeben“ bzw.
  Hinweis „freigegeben am … von …“ mit „Freigabe zurücknehmen“.
- Änderungen nach der Freigabe sind sofort sichtbar, ohne erneute Freigabe
  **[meine Wahl]**. Die Mitarbeiter-Ansicht zeigt je Woche „zuletzt geändert am …“,
  damit eine Änderung auffällt. Quelle: Spalte `zuletzt_geaendert` in
  `pep.wochen_freigaben`, gesetzt von Triggern auf `plan_bloecke`,
  `plan_kommentare` und `abwesenheiten` (Einfügen, Ändern, **Löschen**) für Daten in
  einer freigegebenen Woche – `plan_bloecke.geaendert_am` allein sähe kein Löschen
  **[meine Wahl]**.
- Bestehende Wochen sind nicht freigegeben; nach dem Einspielen ist für Mitarbeiter
  zunächst nichts sichtbar.

## 7. Technik

- Statische Seite wie bisher (`docs/`), Anmeldung über dieselbe Maske. `pep_ich`
  bleibt unverändert; eine neue Funktion `pep_mein_konto` sagt der Seite, ob ein
  Mitarbeiter-Konto angemeldet ist (`null` = kein Mitarbeiter-Konto). Die Seite zeigt dann statt der Reiter nur die
  Mitarbeiter-Ansicht.
- Neue Funktionen `public.pep_mein_*` (SECURITY DEFINER, `set search_path = ''`,
  Rechte wie alle anderen: `revoke all … from public, anon, authenticated`, dann
  `grant execute … to authenticated`) mit eigenem Helfer
  `pep.ich_mitarbeiter()`: Konto → Zugang nicht gesperrt → Mitarbeiter aktiv →
  Zustimmung aktuell. Kein bestehender Helfer wird gelockert.
- Leitung/Stellvertretung bleiben in `pep.benutzer`; ein Organisator-Konto wird nie
  zum Mitarbeiter-Konto und umgekehrt.
- **Sicherung:** Zugänge, Einladungen und Zustimmungen kommen **nicht** in die
  Sicherungsdatei (Konten hängen am Supabase-Projekt, nicht an der Filiale)
  **[meine Wahl]**; sie gehören mit Begründung in `sicherung_ausnahmen` (der Test
  `tests/sicherung.test.mjs` verlangt für jede Tabelle eine der beiden Listen).
  Freigaben und Datenschutztexte kommen mit. Nach dem Einspielen müssen Mitarbeiter
  neu eingeladen werden und neu zustimmen; die Anleitung sagt das.
- Protokoll (`pep.protokoll`): Einladen, Sperren, Entsperren, Freigeben,
  Zurücknehmen, Textänderung.

## 8. Tests

- PGlite wie bisher: jede `pep_mein_*`-Funktion mit fremdem Mitarbeiter, gesperrtem
  Zugang, inaktivem Mitarbeiter, fehlender Zustimmung, nicht freigegebener Woche,
  fremder Filiale.
- **Kein Abwesenheits-Leck:** Fixture mit krankem Kollegen am selben Tag; das
  JSON von `pep_mein_*` enthält weder seinen Namen noch einen Code.
- Jede bestehende `pep_*`-Funktion mit einem Mitarbeiter-Konto → `KEIN_ZUGRIFF`
  (Schleife über alle `public.pep_*` außer `pep_lebenszeichen` und den neuen).
- Registrierung: gültiger Code, abgelaufener, eingelöster, gefälschter, gleichzeitiges
  Einlösen; Urlaubstool-Trigger legt keinen Organisator an. Dafür das eingefrorene
  Urlaubstool-Schema in `tests/fixtures/` nachziehen.
- Browser-Szenario (tests/browser): Mitarbeiter-Ansicht auf Handybreite.

## 9. Offen

- Datenschutztext: liefert Filialleitung/Personalabteilung.
- Vor dem echten Einsatz bleibt der Hinweis aus PEP_HANDOFF.md: klären, ob Netto ein
  Konzernsystem vorschreibt, und DSGVO mit HR abstimmen.

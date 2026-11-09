# Entscheidungen zur PEP (Stand 24.10.2026, Nachtrag 09.11.2026)

Festgehalten aus dem Gespräch mit dtn, ergänzend zu PEP_HANDOFF.md.

- **Eigenes Projekt.** Die PEP wird in diesem Ordner gebaut, nicht im
  Urlaubstool-Repo (`C:\Users\dtn\Documents\Urlaubsvertretung`,
  GitHub `Urlaub2027/urlaub`).
- **Urlaubstool = das Umfrage-Tool „Urlaubswünsche 2027“.** Dort tragen die
  Mitarbeiter ihren Urlaub ein (persönlicher Link, kein Login). Es kennt heute
  keinen Genehmigungsstatus.
- **Übernahme in die PEP erst nach Freigabe** durch die Filialleitung. Wo die
  Freigabe erfasst wird (Urlaubstool oder PEP), ist noch offen.
- **Gleiche Supabase-Datenbank** wie das Urlaubstool (laut Handoff). Dort:
  Tabellen in Schema `urlaub`, RLS ohne Policies, Zugriff nur über
  SECURITY-DEFINER-Funktionen in `public`; Login nur für Organisatoren
  (Benutzername@example.com + Passwort, per Einladung).
- **Mitarbeiter-Login** (Stufe 3) wird gebraucht, ist aber neu: heute haben
  Mitarbeiter keine Konten.
- **15-Minuten-Takt (09.11.2026).** Einsatzplan und IST planen in Viertelstunden (Wunsch
  dtn: „so einfach wie möglich, aber 15-min-Takt muss rein“). Gewählt: das Raster selbst
  auf Viertelstunden (eine Zelle = 15 min), nicht „Raster halbstündig, nur von/bis auf
  :15/:45“. Grund: Bei Letzterem hätte ein Strich in einer Zeile mit 7:45-Beginn den
  Beginn still auf die halbe Stunde verschoben, und die Abdeckung je halbe Stunde wäre
  bei angeschnittenen Zellen mehrdeutig. Öffnung, Rahmen, Abwesenheiten mit Uhrzeit,
  Zeitvorgaben, LKW-Zeit und Einstellungs-Uhrzeiten bleiben bei halben Stunden (jede
  halbe Stunde ist auch eine Viertelstunde). „VP gebunden“ gilt weiter ab mehr als
  30 min am Stück, also jetzt schon ab 45 min (vorher erst ab 60 min).
- **Nachtrag 09.11.2026: Raster wieder halbstündig, Viertelstunde per Klick (wie bei
  Tegut).** Das Viertelstunden-Raster war auf dem Tablet zu fummelig (Zellen zu klein).
  Jetzt: Raster in halben Stunden mit den alten Zellbreiten, angeschnittene Halbstunde
  halb gefüllt; im Fenster „Zeit eingeben“ Beginn/Ende 15 min früher/später (auch im
  IST). Die Begründung oben („ein Strich hätte den Beginn still verschoben“) war falsch:
  Ein Strich ändert nur sein eigenes von/bis (`pep_plan_malen`), ein 7:45-Beginn
  außerhalb bleibt. Die Abdeckungszeilen rechnen je Viertelstunde und zeigen je halbe
  Stunde die schlechtere Viertelstunde, damit sie zur Regelprüfung passen. Schema
  unverändert.

# Entscheidungen zur PEP (Stand 24.10.2026)

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

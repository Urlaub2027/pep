// Aufruflisten aller public.pep_*-Funktionen für die Rechte-Tests (tests/rechte.test.mjs, tests/zugang.test.mjs).
// Eigenes Modul: Ein Import aus einer Testdatei würde deren Tests ein zweites Mal registrieren.
// ma, jo: echte Mitarbeiter-Ids; stellv: user_id der Stellvertretung; wg: Warengruppe; vorlage: echte Vorlage;
// sicherung: echte Sicherungsdatei der Filiale (Antwort von pep_sicherung).

// Schreibende Funktionen. Plausible Dummy-Aufrufe (Mitarbeiter-Id echt, damit ein fehlender Rechtecheck sichtbar
// etwas ändern würde).
export const aufrufe = ({ ma, jo, stellv, wg, vorlage, sicherung }) => ({
  pep_filiale_anlegen: `select public.pep_filiale_anlegen('X', '1', 'BY')`,
  pep_mitarbeiter_speichern: `select public.pep_mitarbeiter_speichern(null, '{"name":"X, Y"}')`,
  pep_vertrag_speichern: `select public.pep_vertrag_speichern(${ma}, '{"vertragsart":"teilzeit","wochenstunden":30,"gueltig_ab":"2026-01-01"}')`,
  pep_vertrag_loeschen: `select public.pep_vertrag_loeschen(1)`,
  pep_kompetenz_setzen: `select public.pep_kompetenz_setzen(${ma}, 1, true)`,
  pep_wochenvorgabe_speichern: `select public.pep_wochenvorgabe_speichern(${ma}, '{}')`,
  pep_wochenvorgabe_loeschen: `select public.pep_wochenvorgabe_loeschen(1)`,
  pep_urlaubsjahr_speichern: `select public.pep_urlaubsjahr_speichern(${ma}, 2027, 30, 0)`,
  pep_rahmen_speichern: `select public.pep_rahmen_speichern(1, '{}')`,
  pep_abweichung_speichern: `select public.pep_abweichung_speichern('2027-05-01', '{}')`,
  pep_abweichung_loeschen: `select public.pep_abweichung_loeschen('2027-05-01')`,
  pep_einstellung_setzen: `select public.pep_einstellung_setzen('x', '1')`,
  pep_code_speichern: `select public.pep_code_speichern(null, '{"code":"ZZ","name":"Test"}')`,
  pep_bereich_speichern: `select public.pep_bereich_speichern(null, '{"kuerzel":"ZZ","name":"Test"}')`,
  // Nur Leitung. Echte Warengruppe: ohne Rechtecheck würde sie umbenannt, das Muster geändert (und protokolliert).
  pep_warengruppe_speichern: `select public.pep_warengruppe_speichern(${wg}, '{"name":"Zzz"}')`,
  pep_liefer_muster_setzen: `select public.pep_liefer_muster_setzen(2, '{"lkw":"08:30"}')`,
  // Leitung oder Stellvertretung; geöffneter Tag (Mo 03.05.2027): ohne Rechtecheck entstünde ein Tageswert.
  pep_liefer_tag_setzen: `select public.pep_liefer_tag_setzen('2027-05-03', '{"lkw":"08:30"}')`,
  pep_schulferien_speichern: `select public.pep_schulferien_speichern(null, '2027-04-05', '2027-04-16', 'Test')`,
  pep_schulferien_loeschen: `select public.pep_schulferien_loeschen(1)`,
  pep_benutzer_setzen: `select public.pep_benutzer_setzen('vize', 'leitung')`,
  pep_benutzer_entfernen: `select public.pep_benutzer_entfernen('${stellv}')`,
  pep_abwesenheit_setzen: `select public.pep_abwesenheit_setzen(${ma}, 1, '2027-05-03', '2027-05-03', null, null, null, null)`,
  pep_abwesenheit_loeschen: `select public.pep_abwesenheit_loeschen(${ma}, '2027-05-03', '2027-05-03')`,
  pep_wiederholung_speichern: `select public.pep_wiederholung_speichern(${ma}, '{"code_id":1,"wochentag":2,"von_datum":"2027-05-01","bis_datum":"2027-06-30","stunden":8}')`,
  pep_wiederholung_loeschen: `select public.pep_wiederholung_loeschen(1)`,
  pep_urlaub_umfrage_schalten: `select public.pep_urlaub_umfrage_schalten(1, true)`,
  pep_urlaub_zuordnung_setzen: `select public.pep_urlaub_zuordnung_setzen(1, ${ma})`,
  pep_urlaub_freigeben: `select public.pep_urlaub_freigeben(${ma}, null, null, '{"umfrage_id":1,"urlaub_mitarbeiter_id":1,"art":"kw","kw":12,"datum":null}', null)`,
  pep_urlaub_ablehnen: `select public.pep_urlaub_ablehnen(${ma}, '{"umfrage_id":1,"urlaub_mitarbeiter_id":1,"art":"kw","kw":12,"datum":null}', null)`,
  pep_freigabe_zuruecknehmen: `select public.pep_freigabe_zuruecknehmen(1)`,
  pep_plan_malen: `select public.pep_plan_malen(${ma}, '2027-05-03', '08:00', '12:00', 2)`,
  pep_plan_zeile_setzen: `select public.pep_plan_zeile_setzen(${ma}, '2027-05-03', '[{"von":"08:00","bis":"12:00","bereich_id":2}]')`,
  pep_kommentar_setzen: `select public.pep_kommentar_setzen(${ma}, '2027-05-03', 'Test')`,
  // Ida und Jo sind die einzigen aktiven Mitarbeiter: ohne Rechtecheck würde die Position geschrieben.
  pep_mitarbeiter_reihenfolge: `select public.pep_mitarbeiter_reihenfolge(array[${ma}, ${jo}]::bigint[])`,
  // Kopieren und Laden schreiben je geöffnetem Zieltag einen Protokolleintrag, auch ohne passende Blöcke.
  pep_tag_kopieren: `select public.pep_tag_kopieren('2027-05-03', array['2027-05-10']::date[], 'ersetzen')`,
  pep_woche_kopieren: `select public.pep_woche_kopieren(2027, 18, '[{"jahr":2027,"kw":19}]', 'ersetzen')`,
  pep_vorlage_speichern: `select public.pep_vorlage_speichern('Test', 'tag', '2027-05-03')`,
  pep_vorlage_laden: `select public.pep_vorlage_laden(${vorlage}, '2027-05-10', 'ersetzen')`,
  pep_vorlage_loeschen: `select public.pep_vorlage_loeschen(${vorlage})`,
  pep_schnell_abwesend: `select public.pep_schnell_abwesend(${ma}, 'ZA', '2027-05-04', '2027-05-04')`,
  pep_ersatz_uebernehmen: `select public.pep_ersatz_uebernehmen(${ma}, '2027-05-03', ${jo})`,
  // Schreibt Planumsatz und Vorgabe der Woche (und ein Protokoll): ohne Rechtecheck wäre das sichtbar.
  pep_woche_speichern: `select public.pep_woche_speichern(2027, 18, '{"planumsatz":61000,"stundenvorgabe_manuell":240}')`,
  // IST an einem vergangenen Montag (Ida hat seit 01.01.2026 Vertrag): ohne Rechtecheck entstünden IST-Blöcke
  // bzw. ein ist_tage-Eintrag.
  pep_ist_malen: `select public.pep_ist_malen(${ma}, '2026-03-02', '08:00', '12:00', 2, null)`,
  pep_ist_zeile_setzen: `select public.pep_ist_zeile_setzen(${ma}, '2026-03-02', '[{"von":"08:00","bis":"12:00","bereich_id":2}]', null)`,
  pep_ist_bestaetigen: `select public.pep_ist_bestaetigen('2026-03-02', array[${ma}]::bigint[])`,
  // Nur Leitung. Abschluss einer vergangenen Woche (ohne Rechtecheck: IST_OFFEN, also ebenfalls kein Treffer für FEHLER);
  // Buchung für Ida: ohne Rechtecheck entstünde eine Journalzeile.
  pep_wochenabschluss: `select public.pep_wochenabschluss(2026, 10)`,
  pep_zeitkonto_buchen: `select public.pep_zeitkonto_buchen(${ma}, 'manuell', 5, 'Test', '2026-03-02')`,
  // Nur Leitung. Sichern schreibt pep.sicherungen und das Protokoll; Einspielen mit der echten Datei und richtiger
  // Bestätigung (ohne Rechtecheck: FILIALE_NICHT_LEER, also kein Treffer für FEHLER).
  pep_sicherung: 'select public.pep_sicherung()',
  pep_sicherung_einspielen: `select public.pep_sicherung_einspielen('${JSON.stringify(sicherung).replaceAll("'", "''")}'::jsonb, '2558')`,
  // Mitarbeiter-Zugang, nur Leitung. Ohne Rechtecheck entstünden Einladung und Zugangszeile (ohne Datenschutztext:
  // DATENSCHUTZ_FEHLT, kein Treffer für FEHLER), eine Sperre bzw. eine neue Textversion, jeweils mit Protokoll.
  pep_zugang_einladen: `select public.pep_zugang_einladen(${ma})`,
  pep_zugang_sperren: `select public.pep_zugang_sperren(${ma}, true)`,
  pep_datenschutz_speichern: `select public.pep_datenschutz_speichern('Test')`,
});

// Nur lesende Funktionen (NUR_LESEN in tests/rechte.test.mjs), je ein gültiger Aufruf.
export const leseAufrufe = ({ ma, sicherung }) => ({
  pep_ich: 'select public.pep_ich()',
  pep_bereiche: 'select public.pep_bereiche()',
  pep_mitarbeiter_liste: 'select public.pep_mitarbeiter_liste()',
  pep_mitarbeiter: `select public.pep_mitarbeiter(${ma})`,
  pep_einstellungen: 'select public.pep_einstellungen()',
  pep_feiertage: 'select public.pep_feiertage(2027)',
  pep_abwesenheiten: 'select public.pep_abwesenheiten(2027, 5)',
  pep_urlaub_umfragen: 'select public.pep_urlaub_umfragen()',
  pep_urlaub_zuordnung: 'select public.pep_urlaub_zuordnung()',
  pep_einsatzplan_woche: 'select public.pep_einsatzplan_woche(2027, 18)',
  pep_pruefung_zeitraum: `select public.pep_pruefung_zeitraum('2027-05-03', '2027-05-09')`,
  pep_vorlagen: 'select public.pep_vorlagen()',
  pep_ersatz_kandidaten: `select public.pep_ersatz_kandidaten(${ma}, '2027-05-03')`,
  pep_bedarf_kandidaten: `select public.pep_bedarf_kandidaten('2027-05-03', 1, '07:00', '10:00')`,
  pep_eckdaten: `select public.pep_eckdaten(${ma}, '2027-05-03')`,
  pep_vorausplanung: 'select public.pep_vorausplanung(2027, 18)',
  pep_resturlaub: 'select public.pep_resturlaub(2027)',
  pep_startseite: 'select public.pep_startseite()',
  pep_ist_woche: 'select public.pep_ist_woche(2026, 10)',
  pep_zeitkonto_woche: 'select public.pep_zeitkonto_woche(2026, 10)',
  pep_zeitkonto_journal: `select public.pep_zeitkonto_journal(${ma}, '2026-01-01', '2026-12-31')`,
  pep_stundenblatt: `select public.pep_stundenblatt(${ma}, '2026-03-02', '2026-03-08')`,
  pep_sicherung_pruefen: `select public.pep_sicherung_pruefen('${JSON.stringify(sicherung).replaceAll("'", "''")}'::jsonb)`,
  pep_datenschutz: 'select public.pep_datenschutz()',
});

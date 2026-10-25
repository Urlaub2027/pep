// Testbestand für den Browser-Test: erfundene Namen, Stichtag Mo 02.11.2026, Planwoche KW 46/2026.
// Übernimmt den Aufbau von tests/vorschau/daten-erzeugen.mjs (dort mit Dateiausgabe) und ergänzt
// Stellvertretung, Schulferien und eine Urlaubstool-Umfrage mit zwei offenen Wünschen.
import {
  als, pepBenutzer, filiale, heuteSetzen, umfrageAnlegen, urlaubsfrageId, umfrageMitarbeiter, abgeben,
} from '../helfer.mjs';

export const HEUTE = '2026-11-02';
export const NAMEN = ['Test, Anna', 'Muster, Ben', 'Beispiel, Cem', 'Probe, Dana', 'Demo, Emil', 'Fiktiv, Frieda',
  'Platzhalter, Gustav', 'Vorlage, Hanna', 'Entwurf, Ivo', 'Skizze, Jana', 'Modell, Kai', 'Attrappe, Lea'];
export const TAGE = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];

// Liefert { leitung, stellv, fil, ids, reserve, code, bereich, umfrage }.
export async function befuellen(db) {
  await heuteSetzen(db, HEUTE);
  const leitung = await pepBenutzer(db, 'chef');
  const fil = await filiale(db, leitung);
  const stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  const q = async (sql, p = []) => (await als(db, 'authenticated', leitung, sql, p))[0]?.r;
  const stunden = [37.5, 37.5, 30, 20, 37.5, 42, 25, 37.5, 30, 37.5, 20, 42];
  const ids = [];
  for (const [i, name] of NAMEN.entries()) {
    const id = await q('select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r',
      [JSON.stringify({ name, personalnummer: String(90001 + i) })]); // erfundene Personalnummern
    await q('select public.pep_vertrag_speichern($1, $2::jsonb) as r', [id, JSON.stringify({
      vertragsart: stunden[i] === 42 ? 'fuehrung' : stunden[i] === 37.5 ? 'vollzeit' : 'teilzeit',
      wochenstunden: stunden[i], gueltig_ab: '2026-01-01' })]);
    await q('select public.pep_urlaubsjahr_speichern($1, 2026, $2, 0) as r', [id, stunden[i] * 6]);
    ids.push(id);
  }
  const e = await q('select public.pep_einstellungen() as r');
  const code = Object.fromEntries(e.codes.map((c) => [c.code, c.id]));
  const bereich = Object.fromEntries(e.bereiche.map((b) => [b.kuerzel, b.id]));
  const setzen = (m, c, von, bis) => q(
    'select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, null, null, null, null) as r', [m, code[c], von, bis]);
  await setzen(ids[0], 'U', '2026-11-09', '2026-11-14');
  await setzen(ids[2], 'KM', '2026-11-03', '2026-11-05');
  await setzen(ids[4], 'U', '2026-11-23', '2026-11-28');
  await setzen(ids[7], 'ZA', '2026-11-12', '2026-11-12');
  await setzen(ids[9], 'U', '2026-11-16', '2026-11-20');
  await q('select public.pep_urlaubsjahr_speichern($1, 2026, 20, 0) as r', [ids[9]]);
  await q('select public.pep_wiederholung_speichern($1, $2::jsonb) as r', [ids[10], JSON.stringify(
    { code_id: code.BS, wochentag: 2, von_datum: '2026-11-01', bis_datum: '2026-12-31', stunden: 8 })]);

  for (const i of [1, 2, 3, 6, 9]) await q('select public.pep_kompetenz_setzen($1, $2, true) as r', [ids[i], bereich.KA]);
  for (const i of [1, 5, 11]) await q('select public.pep_kompetenz_setzen($1, $2, true) as r', [ids[i], bereich.VP]);
  const plan = {
    1: { frei: 2, bloecke: [['07:00', '12:30', 'KA'], ['12:30', '13:00', 'PA'], ['13:00', '15:30', 'KA']] },
    2: { frei: 3, bloecke: [['14:30', '17:30', 'KA'], ['17:30', '18:00', 'PA'], ['18:00', '20:00', 'KA']] },
    3: { frei: 4, bloecke: [['16:00', '20:00', 'KA']] },
    4: { frei: 5, bloecke: [['06:00', '09:00', 'OG'], ['09:00', '12:00', 'TS'], ['12:00', '12:30', 'PA'], ['12:30', '14:00', 'MO']] },
    5: { frei: 2, bloecke: [['06:00', '10:00', 'FÜ'], ['10:00', '10:30', 'PA'], ['10:30', '14:30', 'FÜ']] },
    6: { frei: 1, bloecke: [['07:00', '09:00', 'KA'], ['09:00', '11:00', 'BB']] },
    7: { frei: 5, bloecke: [['12:00', '16:00', 'TS'], ['16:00', '16:30', 'PA'], ['16:30', '20:00', 'TK']] },
    8: { frei: 4, bloecke: [['06:00', '10:00', 'TK'], ['10:00', '12:00', 'MO']] },
    9: { frei: 1, bloecke: [['12:30', '16:30', 'KA'], ['16:30', '17:00', 'PA'], ['17:00', '20:30', 'KA']] },
    10: { frei: 1, bloecke: [['17:00', '20:00', 'RE']] },
    11: { frei: 3, bloecke: [['13:00', '17:00', 'FÜ'], ['17:00', '17:30', 'PA'], ['17:30', '21:30', 'FÜ']] },
  };
  const malen = (m, datum, von, bis, kuerzel) => q('select public.pep_plan_malen($1, $2::date, $3::time, $4::time, $5) as r',
    [m, datum, von, bis, kuerzel ? bereich[kuerzel] : null]);
  for (const [i, p] of Object.entries(plan)) {
    for (const [t, datum] of TAGE.entries()) {
      if (t === p.frei) continue;
      for (const [von, bis, k] of p.bloecke) {
        try { await malen(ids[i], datum, von, bis, k); } catch { /* abwesend: Lücke */ }
      }
    }
  }
  await malen(ids[1], TAGE[0], '07:00', '15:30', 'KA');
  await malen(ids[1], TAGE[0], '11:00', '11:30', 'PA');
  const reserve = [];
  for (const [name, art, std] of [['Reserve, Mia', 'teilzeit', 20], ['Aushilfe, Nico', 'minijob', 10]]) {
    const id = await q('select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name })]);
    await q('select public.pep_vertrag_speichern($1, $2::jsonb) as r',
      [id, JSON.stringify({ vertragsart: art, wochenstunden: std, gueltig_ab: '2026-01-01' })]);
    await q('select public.pep_kompetenz_setzen($1, $2, true) as r', [id, bereich.KA]);
    reserve.push(id);
  }
  for (const t of [1, 3]) await malen(reserve[0], TAGE[t], '08:00', '12:00', 'KA');
  await q('select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [reserve[0], JSON.stringify(
    { art: 'nur_zwischen', von: '06:00', bis: '18:00', pflicht: false, gueltig_von: '2026-01-01', notiz: 'Kinderbetreuung: nur bis 18:00' })]);
  await q(`select public.pep_schnell_abwesend($1, 'KM', $2::date, $2::date) as r`, [ids[3], TAGE[0]]);
  await q(`select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, 5, '08:00', '13:00', null) as r`, [ids[8], code.BS, TAGE[0]]);
  await malen(ids[8], TAGE[0], '13:30', '17:30', 'TS');
  await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[5], TAGE[0], 'Lieferung TroSo annehmen']);
  await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[11], TAGE[0], 'Abschluss, Schlüssel']);
  await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[7], TAGE[1], 'Inventur TK vorbereiten']);
  // Laufende Woche KW 45 (heute = Mo 02.11.): Emil früh, Samstag spät – Vorwoche für die Eckdaten von KW 46.
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) await malen(ids[4], d, '06:00', '12:00', 'OG');
  await malen(ids[4], '2026-11-05', '12:00', '20:00', 'OG');
  await malen(ids[4], '2026-11-07', '13:00', '21:30', 'TK');
  await q('select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [ids[4], JSON.stringify(
    { art: 'nicht_verfuegbar', max_stunden_tag: 9, pflicht: true, gueltig_von: '2026-01-01', notiz: 'ärztliche Vorgabe' })]);
  await q('select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [ids[4], JSON.stringify(
    { art: 'nur_zwischen', wochentag: 2, von: '06:00', bis: '14:00', pflicht: false, gueltig_von: '2026-01-01', notiz: 'Sportverein dienstags' })]);
  await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[4], TAGE[0], 'Obstlieferung prüfen']);
  await setzen(ids[4], 'ZA', '2026-11-20', '2026-11-20');
  await q(`select public.pep_vorlage_speichern('Standardwoche November', 'woche', $1::date) as r`, [TAGE[0]]);
  const woche = (kw, daten) => q('select public.pep_woche_speichern(2026, $1, $2::jsonb) as r', [kw, JSON.stringify(daten)]);
  await woche(46, { planumsatz: 61000 });
  await woche(47, { planumsatz: 52500, stundenvorgabe_manuell: 240 });
  await woche(48, { planumsatz: 70000, stundenleistung_eur_pro_h: 210 });
  await woche(50, { planumsatz: 95000 });
  await q(`select public.pep_schulferien_speichern(null, '2026-12-23'::date, '2027-01-09'::date, 'Weihnachtsferien') as r`);
  // Urlaubstool: Umfrage 2026, zwei Teilnehmer zugeordnet, je ein Wochenwunsch (Gustav KW 48, Lea KW 47).
  const umfrage = await umfrageAnlegen(db, leitung, { titel: 'Urlaub 2026', jahr: 2026 });
  const frage = await urlaubsfrageId(db, umfrage);
  await q('select public.pep_urlaub_umfrage_schalten($1, true) as r', [umfrage]);
  for (const [i, kw] of [[6, 48], [11, 47]]) {
    const tn = await umfrageMitarbeiter(db, umfrage, NAMEN[i]);
    await q('select public.pep_urlaub_zuordnung_setzen($1, $2) as r', [tn.id, ids[i]]);
    await abgeben(db, tn.code, { [frage]: [kw] });
  }
  return { leitung, stellv, fil, ids, reserve, code, bereich, umfrage };
}

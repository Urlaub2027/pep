// Erzeugt die Vorschau-Daten aus einer PGlite-Testdatenbank (echte Funktionsausgaben, erfundene Namen).
import { writeFileSync } from 'node:fs';
import { neueDatenbank, als, pepBenutzer, filiale, heuteSetzen } from '../helfer.mjs';

const db = await neueDatenbank();
await heuteSetzen(db, '2026-11-02');
const leitung = await pepBenutzer(db, 'chef');
await filiale(db, leitung);
const q = async (sql, p = []) => (await als(db, 'authenticated', leitung, sql, p))[0]?.r;
const namen = ['Test, Anna', 'Muster, Ben', 'Beispiel, Cem', 'Probe, Dana', 'Demo, Emil', 'Fiktiv, Frieda',
  'Platzhalter, Gustav', 'Vorlage, Hanna', 'Entwurf, Ivo', 'Skizze, Jana', 'Modell, Kai', 'Attrappe, Lea'];
const stunden = [37.5, 37.5, 30, 20, 37.5, 42, 25, 37.5, 30, 37.5, 20, 42];
const ids = [];
for (const [i, name] of namen.entries()) {
  const id = await q('select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name })]);
  await q('select public.pep_vertrag_speichern($1, $2::jsonb) as r', [id, JSON.stringify({
    vertragsart: stunden[i] === 42 ? 'fuehrung' : stunden[i] === 37.5 ? 'vollzeit' : 'teilzeit', wochenstunden: stunden[i], gueltig_ab: '2026-01-01' })]);
  await q('select public.pep_urlaubsjahr_speichern($1, 2026, $2, 0) as r', [id, stunden[i] * 6]);
  ids.push(id);
}
const e = await q('select public.pep_einstellungen() as r');
const code = Object.fromEntries(e.codes.map((c) => [c.code, c.id]));
const setzen = (m, c, von, bis) => q(`select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, null, null, null, null) as r`, [m, code[c], von, bis]);
await setzen(ids[0], 'U', '2026-11-09', '2026-11-14');
await setzen(ids[2], 'KM', '2026-11-03', '2026-11-05');
await setzen(ids[4], 'U', '2026-11-23', '2026-11-28');
await setzen(ids[7], 'ZA', '2026-11-12', '2026-11-12');
await setzen(ids[9], 'U', '2026-11-16', '2026-11-20');
// Kleiner Anspruch: Rest unter 0, damit die Vorschau die rote Darstellung zeigt.
await q('select public.pep_urlaubsjahr_speichern($1, 2026, 20, 0) as r', [ids[9]]);
await q(`select public.pep_wiederholung_speichern($1, $2::jsonb) as r`, [ids[10], JSON.stringify({ code_id: code.BS, wochentag: 2, von_datum: '2026-11-01', bis_datum: '2026-12-31', stunden: 8 })]);

// ---- Einsatzplan KW 46 (Mo 09.11.–Sa 14.11.2026): Kompetenzen, Blöcke, Krankmeldung, Berufsschule, Kommentare.
const bereich = Object.fromEntries(e.bereiche.map((b) => [b.kuerzel, b.id]));
for (const i of [1, 2, 3, 6, 9]) await q('select public.pep_kompetenz_setzen($1, $2, true) as r', [ids[i], bereich.KA]);
for (const i of [1, 5, 11]) await q('select public.pep_kompetenz_setzen($1, $2, true) as r', [ids[i], bereich.VP]);
const TAGE = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
// Je Mitarbeiter: Blöcke [von, bis, Kürzel] und der freie Tag (Index in TAGE). ids[0] hat die ganze Woche Urlaub.
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
let gesperrt = 0;
for (const [i, p] of Object.entries(plan)) {
  for (const [t, datum] of TAGE.entries()) {
    if (t === p.frei) continue;
    for (const [von, bis, k] of p.bloecke) {
      try { await malen(ids[i], datum, von, bis, k); } catch { gesperrt += 1; } // abwesend (ZA, Berufsschule): Lücke
    }
  }
}
// Montag: Kassenkraft macht 11:00 Pause, niemand löst ab (Kasse unbesetzt + Pausenablöse fehlt).
await malen(ids[1], TAGE[0], '07:00', '15:30', 'KA');
await malen(ids[1], TAGE[0], '11:00', '11:30', 'PA');
// Montag: Krankmeldung über geplanten Blöcken (werden unbesetzt), Berufsschule 08–13 mitten in der Frühschicht.
await setzen(ids[3], 'KM', TAGE[0], TAGE[0]);
await q(`select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, 5, '08:00', '13:00', null) as r`, [ids[8], code.BS, TAGE[0]]);
await malen(ids[8], TAGE[0], '13:30', '17:30', 'TS');
await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[5], TAGE[0], 'Lieferung TroSo annehmen']);
await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[11], TAGE[0], 'Abschluss, Schlüssel']);
await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[7], TAGE[1], 'Inventur TK vorbereiten']);
console.log(`Einsatzplan: ${gesperrt} Striche wegen Abwesenheit übersprungen`);

const aus = new URL('./daten/', import.meta.url);
const schreib = (name, wert) => writeFileSync(new URL(`${name}.json`, aus), JSON.stringify(wert, null, 1));
schreib('pep_ich', await q('select public.pep_ich() as r'));
schreib('pep_einstellungen', e);
schreib('pep_abwesenheiten', await q('select public.pep_abwesenheiten(2026, 11) as r'));
schreib('pep_mitarbeiter_liste', await q('select public.pep_mitarbeiter_liste() as r'));
// Die Attrappe kennt keine Parameter: pep_mitarbeiter ist immer der erste Mitarbeiter.
schreib('pep_mitarbeiter', await q('select public.pep_mitarbeiter($1) as r', [ids[0]]));
schreib('pep_bereiche', await q('select public.pep_bereiche() as r'));
schreib('pep_feiertage', await q('select public.pep_feiertage(2026) as r'));
schreib('pep_urlaub_umfragen', await q('select public.pep_urlaub_umfragen() as r'));
schreib('pep_urlaub_zuordnung', await q('select public.pep_urlaub_zuordnung() as r'));
schreib('pep_einsatzplan_woche', await q('select public.pep_einsatzplan_woche(2026, 46) as r'));
console.log('Vorschau-Daten geschrieben');

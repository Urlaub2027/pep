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
console.log('Vorschau-Daten geschrieben');

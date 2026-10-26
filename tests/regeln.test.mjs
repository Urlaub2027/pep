// Regelprüfung: je Regel ein Positiv- und ein Negativfall (Spec 16), Lage (F8), Zeitraum-Abfrage.
// Eine Datenbank für alle Tests; Regeln über die ganze Filiale (Kasse, VP, eine Person) brauchen
// je Test einen eigenen Tag, deshalb nutzt jeder Test eigene Daten ab heute = Mo 02.11.2026.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  neueDatenbank, als, pepBenutzer, filiale, planGrundlage, umfrageAnlegen, urlaubsfrageId, umfrageMitarbeiter, abgeben,
} from './helfer.mjs';

let db, leitung, stellv, bereich, code, json, ma, malen, chef2, azubi;

const aufruf = (nutzer, sql, params = []) => als(db, 'authenticated', nutzer, sql, params);
const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

// Zeile setzen aus Kurzform „08:00-12:00 KA, 12:00-12:30 PA“.
const plan = (maId, datum, kurz) => json(leitung, 'select public.pep_plan_zeile_setzen($1, $2::date, $3::jsonb) as r',
  [maId, datum, JSON.stringify(kurz.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [zeit, k] = s.split(' ');
    const [von, bis] = zeit.split('-');
    return { von, bis, bereich_id: bereich[k] };
  }))]);
const abwesend = (maId, c, datum, stunden = null, von = null, bis = null) =>
  json(leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, $4::numeric, $5::time, $6::time, null) as r',
    [maId, code[c], datum, stunden, von, bis]);
const zeitraum = (von, bis, nutzer = leitung) =>
  json(nutzer, 'select public.pep_pruefung_zeitraum($1::date, $2::date) as r', [von, bis]);
const RANG = { warnung: 0, hinweis: 1 };
// Prüfliste eines Tages; prüft nebenbei die Sortierung nach schwere, dann von (ohne Uhrzeit zuerst).
const pr = async (datum, nutzer = leitung) => {
  const l = (await zeitraum(datum, datum, nutzer))[datum];
  for (let i = 1; i < l.length; i++) {
    const a = l[i - 1], b = l[i];
    assert.ok(RANG[a.schwere] <= RANG[b.schwere], `Sortierung schwere: ${JSON.stringify([a, b])}`);
    if (a.schwere === b.schwere) assert.ok((a.von ?? '') <= (b.von ?? ''), `Sortierung von: ${JSON.stringify([a, b])}`);
  }
  return l;
};
// Einträge einer Art (optional nur eines Mitarbeiters), ohne art/schwere/mitarbeiter_id.
const nur = (liste, art, maId) => liste
  .filter((e) => e.art === art && (maId === undefined || e.mitarbeiter_id === maId))
  .map(({ von, bis, text }) => ({ von, bis, text }));
const schwere = (liste, art) => [...new Set(liste.filter((e) => e.art === art).map((e) => e.schwere))];
const einstellen = (schluessel, wert) =>
  aufruf(leitung, 'select public.pep_einstellung_setzen($1, $2::jsonb)', [schluessel, JSON.stringify(wert)]);
const lage = async (maId, datum) =>
  (await db.query('select pep.lage(m.filiale_id, m.id, $2::date) as l from pep.mitarbeiter m where m.id = $1',
    [maId, datum])).rows[0].l;

before(async () => {
  db = await neueDatenbank();
  ({ leitung, stellv, bereich, code, json, ma, malen } = await planGrundlage(db));
  chef2 = await pepBenutzer(db, 'chef2');
  await filiale(db, chef2, { name: 'Netto Zweitfiliale', nummer: '9999' });
  const fil = (await db.query('select filiale_id from pep.benutzer where user_id = $1', [leitung])).rows[0].filiale_id;
  azubi = await pepBenutzer(db, 'azubi', 'mitarbeiter', fil);
});

// ---------------------------------------------------------------------------
// unbesetzt

test('unbesetzt: KM ganztags über geplantem KA 07–14 → unbesetzt-Eintrag und zusätzlich kasse_unbesetzt 07–14', async () => {
  const a = await ma('Test, Udo');
  const b = await ma('Test, Bea');
  await plan(a, '2026-11-16', '07:00-14:00 KA');
  await plan(b, '2026-11-16', '14:00-20:00 KA');
  await abwesend(a, 'KM', '2026-11-16');
  const l = await pr('2026-11-16');
  assert.deepEqual(nur(l, 'unbesetzt'), [{ von: '07:00', bis: '14:00', text: 'Unbesetzt (KM): 07:00–14:00' }]);
  assert.equal(l.find((e) => e.art === 'unbesetzt').mitarbeiter_id, a);
  assert.deepEqual(schwere(l, 'unbesetzt'), ['warnung']);
  assert.deepEqual(nur(l, 'kasse_unbesetzt'), [{ von: '07:00', bis: '14:00', text: 'Kasse unbesetzt 07:00–14:00' }]);
  assert.equal(l.find((e) => e.art === 'kasse_unbesetzt').mitarbeiter_id, null);
  // Unbesetzte Zeit zählt nirgends: keine Pausen-, Stunden- oder Lage-Regel für Udo
  assert.deepEqual(l.filter((e) => e.mitarbeiter_id === a).map((e) => e.art), ['unbesetzt']);
});

test('unbesetzt: Berufsschule 08–13 → Block 14–18 ohne Eintrag, Block 09–12 mit Eintrag (BS)', async () => {
  const a = await ma('Test, Bodo', { kompetenzen: ['KA', 'OG'] });
  await plan(a, '2026-11-17', '14:00-18:00 OG');
  await abwesend(a, 'BS', '2026-11-17', 5, '08:00', '13:00');
  assert.deepEqual(nur(await pr('2026-11-17'), 'unbesetzt', a), []);
  // Teilabwesenheit nach dem Planen: nur der überschneidende Teil wird unbesetzt
  await plan(a, '2026-11-24', '09:00-12:00 KA, 12:00-14:00 OG');
  await abwesend(a, 'BS', '2026-11-24', 5, '08:00', '13:00');
  assert.deepEqual(nur(await pr('2026-11-24'), 'unbesetzt', a),
    [{ von: '09:00', bis: '13:00', text: 'Unbesetzt (BS): 09:00–13:00' }]);
});

// ---------------------------------------------------------------------------
// kasse_unbesetzt

test('kasse_unbesetzt: Öffnung 07–20, KA nur 07–19 → genau ein Eintrag 19:00–20:00', async () => {
  const a = await ma('Test, Kai');
  await plan(a, '2026-11-18', '07:00-19:00 KA');
  const l = await pr('2026-11-18');
  assert.deepEqual(nur(l, 'kasse_unbesetzt'), [{ von: '19:00', bis: '20:00', text: 'Kasse unbesetzt 19:00–20:00' }]);
  assert.deepEqual(schwere(l, 'kasse_unbesetzt'), ['warnung']);
});

test('kasse_unbesetzt: KA 07–20 durchgehend → kein Eintrag; Pause oder anderer Bereich zählt nicht als Kasse', async () => {
  const a = await ma('Test, Kim', { kompetenzen: ['KA', 'OG'] });
  await plan(a, '2026-11-19', '07:00-20:00 KA');
  assert.deepEqual(nur(await pr('2026-11-19'), 'kasse_unbesetzt'), []);
  await plan(a, '2026-11-19', '07:00-12:00 KA, 12:00-12:30 PA, 12:30-13:00 OG, 13:00-20:00 KA');
  assert.deepEqual(nur(await pr('2026-11-19'), 'kasse_unbesetzt'),
    [{ von: '12:00', bis: '13:00', text: 'Kasse unbesetzt 12:00–13:00' }]);
});

// ---------------------------------------------------------------------------
// keine_vp

test('keine_vp: Nicht-VP ab 06:00, VP erst ab 07:00 → Eintrag 06:00–07:00; ohne VP in der Öffnung → Eintrag', async () => {
  const n = await ma('Test, Nils', { kompetenzen: ['KA', 'OG'] });
  const v = await ma('Test, Vera', { kompetenzen: ['KA', 'VP'] });
  await plan(n, '2026-11-20', '06:00-14:00 OG');
  await plan(v, '2026-11-20', '07:00-20:00 KA');
  let l = await pr('2026-11-20');
  assert.deepEqual(nur(l, 'keine_vp'), [{ von: '06:00', bis: '07:00', text: 'Keine VP anwesend 06:00–07:00' }]);
  assert.deepEqual(schwere(l, 'keine_vp'), ['warnung']);
  // VP-Pause zählt als anwesend (F3); VP-Block am Abend kürzer → Öffnungszeit ohne VP
  await plan(v, '2026-11-20', '07:00-12:00 KA, 12:00-12:30 PA, 12:30-19:00 KA');
  await plan(n, '2026-11-20', '06:00-14:00 OG, 14:00-20:00 KA');
  l = await pr('2026-11-20');
  assert.deepEqual(nur(l, 'keine_vp'), [
    { von: '06:00', bis: '07:00', text: 'Keine VP anwesend 06:00–07:00' },
    { von: '19:00', bis: '20:00', text: 'Keine VP anwesend 19:00–20:00' }]);
});

test('keine_vp: niemand vor 07:00 anwesend → kein Eintrag 06:00–07:00 (F5)', async () => {
  const v = await ma('Test, Viola', { kompetenzen: ['KA', 'VP'] });
  const w = await ma('Test, Wim', { kompetenzen: ['KA', 'VP'] });
  await plan(v, '2026-11-21', '07:00-14:00 KA');
  await plan(w, '2026-11-21', '13:30-20:00 KA');
  assert.deepEqual(nur(await pr('2026-11-21'), 'keine_vp'), []);
});

// ---------------------------------------------------------------------------
// vp_allein

test('vp_allein: nur eine Person 19:30–20:00 → Eintrag; nach Ladenschluss nicht', async () => {
  const a = await ma('Test, Alma', { kompetenzen: ['KA', 'VP'] });
  const b = await ma('Test, Bruno', { kompetenzen: ['KA', 'VP'] });
  await plan(a, '2026-11-23', '07:00-19:30 KA');
  await plan(b, '2026-11-23', '07:00-21:00 OG');
  const l = await pr('2026-11-23');
  assert.deepEqual(nur(l, 'vp_allein'), [{ von: '19:30', bis: '20:00', text: 'Nur eine Person anwesend 19:30–20:00' }]);
  assert.equal(l.find((e) => e.art === 'vp_allein').mitarbeiter_id, null);
  assert.deepEqual(schwere(l, 'vp_allein'), ['warnung']);
});

test('vp_allein: zwei Personen 07–20 → kein Eintrag', async () => {
  const a = await ma('Test, Arne', { kompetenzen: ['KA', 'VP'] });
  const b = await ma('Test, Berta', { kompetenzen: ['KA', 'VP'] });
  await plan(a, '2026-11-25', '07:00-20:00 KA');
  await plan(b, '2026-11-25', '06:00-20:00 OG');
  assert.deepEqual(nur(await pr('2026-11-25'), 'vp_allein'), []);
});

// ---------------------------------------------------------------------------
// vp_gebunden

test('vp_gebunden: VP an der Kasse, niemand mit Kassenkompetenz frei → Eintrag', async () => {
  const v = await ma('Test, Vera', { kompetenzen: ['KA', 'VP'] });
  const o = await ma('Test, Olaf', { kompetenzen: ['OG'] });
  await plan(v, '2027-01-22', '08:00-12:00 KA');
  await plan(o, '2027-01-22', '08:00-12:00 OG');
  const l = await pr('2027-01-22');
  assert.deepEqual(nur(l, 'vp_gebunden'), [
    { von: '08:00', bis: '12:00', text: 'VP an der Kasse, keine Ablösung frei 08:00–12:00' }]);
  assert.equal(l.find((e) => e.art === 'vp_gebunden').mitarbeiter_id, null);
  assert.deepEqual(schwere(l, 'vp_gebunden'), ['warnung']);
});

test('vp_gebunden: Pausenablöse 30 min zu zweit → kein Eintrag; 60 min → Eintrag', async () => {
  const v = await ma('Test, Valentin', { kompetenzen: ['KA', 'OG', 'VP'] });
  const k = await ma('Test, Kira');
  await plan(v, '2027-01-23', '08:00-12:00 OG, 12:00-12:30 KA, 12:30-16:00 OG');
  await plan(k, '2027-01-23', '08:00-12:00 KA, 12:00-12:30 PA, 12:30-16:00 KA');
  assert.deepEqual(nur(await pr('2027-01-23'), 'vp_gebunden'), []);
  const v2 = await ma('Test, Vinzenz', { kompetenzen: ['KA', 'OG', 'VP'] });
  const k2 = await ma('Test, Kai');
  await plan(v2, '2027-01-25', '08:00-12:00 OG, 12:00-13:00 KA, 13:00-16:00 OG');
  await plan(k2, '2027-01-25', '08:00-12:00 KA, 12:00-13:00 PA, 13:00-16:00 KA');
  assert.deepEqual(nur(await pr('2027-01-25'), 'vp_gebunden'), [
    { von: '12:00', bis: '13:00', text: 'VP an der Kasse, keine Ablösung frei 12:00–13:00' }]);
});

test('vp_gebunden: Ablösung frei, zweite VP frei oder allein → kein Eintrag', async () => {
  // Kollegin mit Kassenkompetenz räumt Obst ein: kann ablösen
  const v = await ma('Test, Viktor', { kompetenzen: ['KA', 'VP'] });
  const f = await ma('Test, Frieda', { kompetenzen: ['KA', 'OG'] });
  await plan(v, '2027-01-26', '08:00-12:00 KA');
  await plan(f, '2027-01-26', '08:00-12:00 OG');
  assert.deepEqual(nur(await pr('2027-01-26'), 'vp_gebunden'), []);
  // zweite VP nicht an der Kasse
  const v2 = await ma('Test, Vroni', { kompetenzen: ['KA', 'VP'] });
  const w2 = await ma('Test, Wilma', { kompetenzen: ['OG', 'VP'] });
  await plan(v2, '2027-01-27', '08:00-12:00 KA');
  await plan(w2, '2027-01-27', '08:00-12:00 OG');
  assert.deepEqual(nur(await pr('2027-01-27'), 'vp_gebunden'), []);
  // allein: das meldet vp_allein, nicht vp_gebunden
  const a = await ma('Test, Anton', { kompetenzen: ['KA', 'VP'] });
  await plan(a, '2027-01-28', '08:00-12:00 KA');
  const l = await pr('2027-01-28');
  assert.deepEqual(nur(l, 'vp_gebunden'), []);
  assert.equal(nur(l, 'vp_allein').length, 1);
});

// ---------------------------------------------------------------------------
// pausenabloese

test('pausenabloese: Kasse in der Pause leer und niemand mit Kassenkompetenz frei → Eintrag', async () => {
  const k = await ma('Test, Kassia');
  const o = await ma('Test, Otto', { kompetenzen: ['OG'] });
  const q = await ma('Test, Quirin', { kompetenzen: ['KA', 'OG'] });
  await plan(k, '2026-11-26', '08:00-12:00 KA, 12:00-12:30 PA, 12:30-16:00 KA');
  await plan(o, '2026-11-26', '08:00-16:00 OG');
  // Quirin hat Kassenkompetenz, macht aber zur selben Zeit Pause: nicht frei
  await plan(q, '2026-11-26', '08:00-12:00 OG, 12:00-12:30 PA, 12:30-16:00 OG');
  const l = await pr('2026-11-26');
  assert.deepEqual(nur(l, 'pausenabloese', k), [{ von: '12:00', bis: '12:30', text: 'Pausenablöse fehlt 12:00–12:30' }]);
  assert.deepEqual(schwere(l, 'pausenabloese'), ['warnung']);
  assert.deepEqual(nur(l, 'pausenabloese', q), []); // Pause ohne Kassenblock
});

test('pausenabloese: Kasse von jemand anderem besetzt → kein Eintrag; Kasse leer, aber Kraft mit Kassenkompetenz frei → kein Eintrag', async () => {
  const k = await ma('Test, Karla');
  const z = await ma('Test, Zora');
  const o = await ma('Test, Odile', { kompetenzen: ['OG'] });
  await plan(k, '2026-11-27', '08:00-12:00 KA, 12:00-12:30 PA, 12:30-16:00 KA');
  await plan(z, '2026-11-27', '12:00-12:30 KA');
  await plan(o, '2026-11-27', '08:00-16:00 OG'); // niemand mit Kassenkompetenz frei
  assert.deepEqual(nur(await pr('2026-11-27'), 'pausenabloese'), []);
  const k2 = await ma('Test, Konrad');
  const f = await ma('Test, Fritz', { kompetenzen: ['KA', 'OG'] });
  await plan(k2, '2026-12-28', '08:00-12:00 KA, 12:00-12:30 PA, 12:30-16:00 KA');
  await plan(f, '2026-12-28', '08:00-16:00 OG');
  const l = await pr('2026-12-28');
  assert.deepEqual(nur(l, 'kasse_unbesetzt').filter((e) => e.von === '12:00'), [
    { von: '12:00', bis: '12:30', text: 'Kasse unbesetzt 12:00–12:30' }]);
  assert.deepEqual(nur(l, 'pausenabloese'), []);
});

test('pausenabloese: Pause nach Ladenschluss 20:00 oder vor Öffnung 07:00 → kein Eintrag', async () => {
  const k = await ma('Test, Abend', { kompetenzen: ['KA', 'OG'] });
  await plan(k, '2027-01-18', '13:00-20:00 KA, 20:00-20:30 PA, 20:30-21:30 OG');
  assert.deepEqual(nur(await pr('2027-01-18'), 'pausenabloese'), []);
  const f = await ma('Test, Morgen', { kompetenzen: ['KA', 'OG'] });
  await plan(f, '2027-01-19', '06:00-06:30 OG, 06:30-07:00 PA, 07:00-13:00 KA');
  assert.deepEqual(nur(await pr('2027-01-19'), 'pausenabloese'), []);
});

// ---------------------------------------------------------------------------
// pause_fehlt (§ 4 ArbZG: Schwellen an der Arbeitszeit, Pause = Anwesenheit ohne Arbeit)

test('pause_fehlt: 6,5 h Arbeit ohne Pause → Eintrag; 9,5 h Arbeit mit 30 min → Eintrag mit mind. 45 min', async () => {
  const a = await ma('Test, Paula', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-09', '08:00-14:30 OG');
  let l = await pr('2026-11-09');
  assert.deepEqual(nur(l, 'pause_fehlt', a),
    [{ von: '08:00', bis: '14:30', text: 'Pause fehlt oder zu kurz: 6,50 h Arbeit, 0 min Pause (mind. 30 min)' }]);
  assert.deepEqual(schwere(l, 'pause_fehlt'), ['warnung']);
  await plan(a, '2026-11-10', '07:00-12:00 OG, 12:00-12:30 PA, 12:30-17:00 OG');
  l = await pr('2026-11-10');
  assert.deepEqual(nur(l, 'pause_fehlt', a),
    [{ von: '07:00', bis: '17:00', text: 'Pause fehlt oder zu kurz: 9,50 h Arbeit, 30 min Pause (mind. 45 min)' }]);
});

test('pause_fehlt: 9 h Arbeit mit 30 min, genau 6 h ohne Pause, Lücke als Pause → kein Eintrag', async () => {
  const a = await ma('Test, Pit', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-11', '07:00-12:00 OG, 12:00-12:30 PA, 12:30-16:30 OG');
  await plan(a, '2026-11-12', '08:00-14:00 OG');
  // Geteilter Dienst: die Lücke 11–15 ist Pause (Entscheidung im Bericht)
  await plan(a, '2026-11-13', '07:00-11:00 OG, 15:00-19:00 OG');
  for (const d of ['2026-11-11', '2026-11-12', '2026-11-13']) assert.deepEqual(nur(await pr(d), 'pause_fehlt', a), [], d);
});

// ---------------------------------------------------------------------------
// ruhezeit

test('ruhezeit: Vortag bis 21:30, heute ab 07:00 → 9,50 h, Eintrag an beiden Tagen', async () => {
  const a = await ma('Test, Ruth', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-30', '13:30-21:30 OG');
  const r = await malen(leitung, a, '2026-12-01', '07:00', '12:00', 'OG');
  // pep_plan_malen am Dienstag liefert die Prüfung für Mo–So dieser Woche (Vortag liegt darin)
  assert.deepEqual(Object.keys(r.pruefung).sort(), ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03',
    '2026-12-04', '2026-12-05', '2026-12-06']);
  assert.deepEqual(nur(r.pruefung['2026-12-01'], 'ruhezeit', a),
    [{ von: '07:00', bis: null, text: 'Ruhezeit 9,50 h (mind. 11 h) vor 07:00' }]);
  assert.deepEqual(nur(r.pruefung['2026-11-30'], 'ruhezeit', a),
    [{ von: '21:30', bis: null, text: 'Ruhezeit 9,50 h (mind. 11 h) nach 21:30' }]);
  assert.deepEqual(r.pruefung, await zeitraum('2026-11-30', '2026-12-06'));
  assert.deepEqual(schwere(r.pruefung['2026-12-01'], 'ruhezeit'), ['warnung']);
});

test('ruhezeit: Vortag bis 20:00, heute ab 07:00 → 11 h, kein Eintrag; unter 18 → Eintrag mit mind. 12 h', async () => {
  const a = await ma('Test, Rolf', { kompetenzen: ['OG'] });
  await plan(a, '2026-12-02', '12:00-20:00 OG');
  await plan(a, '2026-12-03', '07:00-12:00 OG');
  assert.deepEqual(nur(await pr('2026-12-03'), 'ruhezeit', a), []);
  assert.deepEqual(nur(await pr('2026-12-02'), 'ruhezeit', a), []);
  const j = await ma('Test, Jan', { kompetenzen: ['OG'], geburtsdatum: '2010-05-05' });
  await plan(j, '2026-12-02', '12:00-20:00 OG');
  await plan(j, '2026-12-03', '07:00-12:00 OG');
  assert.deepEqual(nur(await pr('2026-12-03'), 'ruhezeit', j),
    [{ von: '07:00', bis: null, text: 'Ruhezeit 11,00 h (mind. 12 h) vor 07:00' }]);
});

// ---------------------------------------------------------------------------
// hoechstarbeitszeit

test('hoechstarbeitszeit: 10,50 h am Tag → Eintrag; unter 18 über 8 h am Tag und über 40 h in der Woche → Eintrag', async () => {
  const a = await ma('Test, Hugo', { kompetenzen: ['OG'] });
  await plan(a, '2026-12-04', '07:00-12:00 OG, 12:00-12:30 PA, 12:30-18:00 OG');
  let l = await pr('2026-12-04');
  assert.deepEqual(nur(l, 'hoechstarbeitszeit', a),
    [{ von: '07:00', bis: '18:00', text: '10,50 h am Tag (höchstens 10 h)' }]);
  assert.deepEqual(schwere(l, 'hoechstarbeitszeit'), ['warnung']);
  const j = await ma('Test, Jonas', { kompetenzen: ['OG'], geburtsdatum: '2010-01-01' });
  await plan(j, '2026-12-05', '07:00-11:00 OG, 11:00-11:30 PA, 11:30-16:00 OG');
  assert.deepEqual(nur(await pr('2026-12-05'), 'hoechstarbeitszeit', j),
    [{ von: '07:00', bis: '16:00', text: '8,50 h am Tag (höchstens 8 h)' }]);
  // KW 50: 6 × 7 h = 42 h
  const tage = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12'];
  for (const d of tage) await plan(j, d, '08:00-11:00 OG, 11:00-11:30 PA, 11:30-15:30 OG');
  l = await pr('2026-12-09');
  assert.deepEqual(nur(l, 'hoechstarbeitszeit', j), [{ von: null, bis: null, text: '42,00 h in der Woche (höchstens 40 h)' }]);
});

test('hoechstarbeitszeit: genau 10 h am Tag; unter 18 genau 8 h am Tag und 40 h in der Woche → kein Eintrag', async () => {
  const a = await ma('Test, Henni', { kompetenzen: ['OG'] });
  await plan(a, '2026-12-14', '07:00-12:00 OG, 12:00-13:00 PA, 13:00-18:00 OG');
  assert.deepEqual(nur(await pr('2026-12-14'), 'hoechstarbeitszeit', a), []);
  const j = await ma('Test, Jule', { kompetenzen: ['OG'], geburtsdatum: '2010-01-01' });
  const tage = ['2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11'];
  for (const d of tage) await plan(j, d, '08:00-12:00 OG, 12:00-12:30 PA, 12:30-16:30 OG');
  for (const d of tage) assert.deepEqual(nur(await pr(d), 'hoechstarbeitszeit', j), [], d);
});

// ---------------------------------------------------------------------------
// wochenstunden (F6)

test('wochenstunden: 40 h geplant + 6,25 h abwesend über Vertrag 37,5 → Eintrag; Minijob ohne Toleranz', async () => {
  const a = await ma('Test, Wanda', { kompetenzen: ['OG'] });
  const m = await ma('Test, Mini', { kompetenzen: ['OG'], art: 'minijob', stunden: 10 });
  await einstellen('wochen_toleranz_h', 3);
  try {
    await abwesend(a, 'U', '2026-12-14');
    for (const d of ['2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18']) {
      await plan(a, d, '07:00-12:00 OG, 12:00-12:30 PA, 12:30-17:30 OG');
    }
    await plan(m, '2026-12-15', '08:00-13:30 OG');
    await plan(m, '2026-12-16', '08:00-13:00 OG');
    const l = await pr('2026-12-16');
    assert.deepEqual(nur(l, 'wochenstunden', a),
      [{ von: null, bis: null, text: 'Woche: 40,00 h geplant + 6,25 h abwesend, Vertrag 37,50 h' }]);
    assert.deepEqual(nur(l, 'wochenstunden', m),
      [{ von: null, bis: null, text: 'Woche: 10,50 h geplant + 0,00 h abwesend, Vertrag 10,00 h' }]);
    assert.deepEqual(schwere(l, 'wochenstunden'), ['warnung']);
    // Nur an Tagen mit Arbeit: nicht am freien Samstag 19.12. und nicht am U-Tag 14.12.
    assert.deepEqual(nur(await pr('2026-12-19'), 'wochenstunden', a), []);
    assert.deepEqual(nur(await pr('2026-12-14'), 'wochenstunden', a), []);
    assert.equal(nur(await pr('2026-12-15'), 'wochenstunden', a).length, 1);
  } finally {
    await einstellen('wochen_toleranz_h', 0);
  }
});

test('wochenstunden: 40 h bei Vertrag 37,5 und Toleranz 3 → kein Eintrag; genau Vertrag ohne Toleranz → kein Eintrag', async () => {
  const a = await ma('Test, Wolf', { kompetenzen: ['OG'] });
  const b = await ma('Test, Wilma', { kompetenzen: ['OG'] });
  const tage = ['2026-12-14', '2026-12-15', '2026-12-16', '2026-12-17', '2026-12-18'];
  for (const d of tage) await plan(b, d, '08:00-12:00 OG, 12:00-12:30 PA, 12:30-16:00 OG');
  assert.deepEqual(nur(await pr('2026-12-16'), 'wochenstunden', b), []);
  await einstellen('wochen_toleranz_h', 3);
  try {
    for (const d of tage) await plan(a, d, '08:00-12:00 OG, 12:00-12:30 PA, 12:30-16:30 OG');
    assert.deepEqual(nur(await pr('2026-12-16'), 'wochenstunden', a), []);
  } finally {
    await einstellen('wochen_toleranz_h', 0);
  }
});

// ---------------------------------------------------------------------------
// jarbschg (F7)

test('jarbschg: 17 Jahre am 10.11.2026, Ende 21:00 → Eintrag; am 18. Geburtstag kein Eintrag', async () => {
  const j = await ma('Test, Jens', { kompetenzen: ['OG'], geburtsdatum: '2008-11-11' });
  await plan(j, '2026-11-10', '13:00-21:00 OG');
  await plan(j, '2026-11-11', '13:00-21:00 OG');
  const l = await pr('2026-11-10');
  assert.deepEqual(nur(l, 'jarbschg', j),
    [{ von: '20:00', bis: '21:00', text: 'Unter 18: nicht vor 06:00 und nicht nach 20:00' }]);
  assert.deepEqual(schwere(l, 'jarbschg'), ['warnung']);
  assert.deepEqual(nur(await pr('2026-11-11'), 'jarbschg', j), []);
});

test('jarbschg: unter 18 von 06:00 bis 20:00 → kein Eintrag; Beginn vor u18_fruehestens 07:00 → Eintrag', async () => {
  const j = await ma('Test, Jakob', { kompetenzen: ['OG'], geburtsdatum: '2010-03-03' });
  await plan(j, '2026-11-12', '06:00-10:00 OG');
  await plan(j, '2026-11-13', '16:00-20:00 OG');
  assert.deepEqual(nur(await pr('2026-11-12'), 'jarbschg', j), []);
  assert.deepEqual(nur(await pr('2026-11-13'), 'jarbschg', j), []);
  await einstellen('u18_fruehestens', '07:00');
  try {
    assert.deepEqual(nur(await pr('2026-11-12'), 'jarbschg', j),
      [{ von: '06:00', bis: '07:00', text: 'Unter 18: nicht vor 07:00 und nicht nach 20:00' }]);
  } finally {
    await einstellen('u18_fruehestens', '06:00');
  }
});

// ---------------------------------------------------------------------------
// wochenstunden_unter (KW 2/2027: 11.–16.01.2027, nur diese beiden Tests)

test('wochenstunden_unter: alle geöffneten Tage der KW geplant, 30 h von 37,5 → Hinweis; vorher keiner', async () => {
  const a = await ma('Test, Ulla', { kompetenzen: ['OG'] });
  const tage = ['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15'];
  for (const d of tage) await plan(a, d, '08:00-14:00 OG');
  // Samstag 16.01. hat noch keinen Block → noch kein Hinweis
  assert.deepEqual(nur(await pr('2027-01-15'), 'wochenstunden_unter', a), []);
  const b = await ma('Test, Udine', { kompetenzen: ['OG'] });
  await plan(b, '2027-01-16', '08:00-09:00 OG');
  const l = await pr('2027-01-15');
  assert.deepEqual(nur(l, 'wochenstunden_unter', a), [{ von: null, bis: null, text: 'Woche: 30,00 h von 37,50 h verplant' }]);
  assert.deepEqual(schwere(l, 'wochenstunden_unter'), ['hinweis']);
  // nicht am Samstag ohne Arbeit für Ulla
  assert.deepEqual(nur(await pr('2027-01-16'), 'wochenstunden_unter', a), []);
});

test('wochenstunden_unter: geplant + abwesend erreicht den Vertrag → kein Hinweis', async () => {
  const a = await ma('Test, Uwe', { kompetenzen: ['OG'] });
  await abwesend(a, 'U', '2027-01-11');
  for (const d of ['2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15']) {
    await plan(a, d, '08:00-12:00 OG, 12:00-12:30 PA, 12:30-16:00 OG');
  }
  await plan(a, '2027-01-16', '08:00-11:00 OG, 11:00-11:30 RE');
  // 4 × 7,5 h + 3,5 h + 6,25 h abwesend = 39,75 h ≥ 37,5
  const l = await pr('2027-01-13');
  assert.deepEqual(nur(l, 'wochenstunden_unter', a), []);
  assert.equal(nur(l, 'wochenstunden_unter', (await db.query("select id from pep.mitarbeiter where name = 'Test, Ulla'")).rows[0].id).length, 1);
});

// ---------------------------------------------------------------------------
// vorgabe_bevorzugt

test('vorgabe_bevorzugt: bevorzugt nur 08–14, geplant bis 16 → Hinweis; mit Notiz → Notiz als Text', async () => {
  const a = await ma('Test, Vroni', { kompetenzen: ['OG'] });
  const id = await json(leitung, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [a, JSON.stringify(
    { gueltig_von: '2026-11-01', wochentag: 1, art: 'nur_zwischen', von: '08:00', bis: '14:00' })]);
  await plan(a, '2026-12-07', '08:00-16:00 OG');
  let l = await pr('2026-12-07');
  assert.deepEqual(nur(l, 'vorgabe_bevorzugt', a), [{ von: null, bis: null, text: 'Bevorzugt: nur 08:00–14:00' }]);
  assert.deepEqual(schwere(l, 'vorgabe_bevorzugt'), ['hinweis']);
  await json(leitung, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [a, JSON.stringify(
    { id, gueltig_von: '2026-11-01', wochentag: 1, art: 'nur_zwischen', von: '08:00', bis: '14:00', notiz: 'Kind abholen' })]);
  l = await pr('2026-12-07');
  assert.deepEqual(nur(l, 'vorgabe_bevorzugt', a), [{ von: null, bis: null, text: 'Kind abholen' }]);
});

test('vorgabe_bevorzugt: innerhalb 08–14 geplant oder anderer Wochentag → kein Hinweis', async () => {
  const a = await ma('Test, Valentin', { kompetenzen: ['OG'] });
  await json(leitung, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [a, JSON.stringify(
    { gueltig_von: '2026-11-01', wochentag: 1, art: 'nur_zwischen', von: '08:00', bis: '14:00' })]);
  await plan(a, '2026-12-07', '08:00-14:00 OG');
  await plan(a, '2026-12-08', '08:00-16:00 OG');
  assert.deepEqual(nur(await pr('2026-12-07'), 'vorgabe_bevorzugt', a), []);
  assert.deepEqual(nur(await pr('2026-12-08'), 'vorgabe_bevorzugt', a), []);
});

// ---------------------------------------------------------------------------
// Lage (F8) und schichtlage

test('pep.lage: frueh, spaet, lang, mitte; ohne Block oder nur unbesetzt NULL', async () => {
  const a = await ma('Test, Lars', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-09', '06:00-12:00 OG');
  await plan(a, '2026-11-10', '13:00-18:30 OG');
  await plan(a, '2026-11-11', '06:00-12:00 OG, 12:00-12:30 PA, 12:30-18:30 OG');
  await plan(a, '2026-11-12', '09:00-18:00 OG');
  await plan(a, '2026-11-13', '06:00-12:00 OG');
  await abwesend(a, 'KM', '2026-11-13');
  assert.equal(await lage(a, '2026-11-09'), 'frueh');
  assert.equal(await lage(a, '2026-11-10'), 'spaet');
  assert.equal(await lage(a, '2026-11-11'), 'lang');
  assert.equal(await lage(a, '2026-11-12'), 'mitte'); // Ende genau 18:00 ist nicht spät
  assert.equal(await lage(a, '2026-11-13'), null);
  assert.equal(await lage(a, '2026-11-14'), null);
});

test('pep.lage: Rahmen nachträglich auf 06:30 gekürzt → Block ab 06:00 bleibt frueh bzw. lang', async () => {
  const a = await ma('Test, Rahmen', { kompetenzen: ['OG'] });
  await plan(a, '2027-01-20', '06:00-12:00 OG');
  await plan(a, '2027-01-21', '06:00-12:00 OG, 12:00-12:30 PA, 12:30-18:30 OG');
  for (const d of ['2027-01-20', '2027-01-21']) {
    await aufruf(leitung, 'select public.pep_abweichung_speichern($1::date, $2::jsonb)', [d, JSON.stringify({
      art: 'sonstiges', geoeffnet: true, oeffnung_von: '07:00', oeffnung_bis: '20:00', rahmen_von: '06:30', rahmen_bis: '21:30' })]);
  }
  assert.equal(await lage(a, '2027-01-20'), 'frueh');
  assert.equal(await lage(a, '2027-01-21'), 'lang');
});

test('schichtlage: Vorwoche überwiegend früh, heute früh → Hinweis', async () => {
  const a = await ma('Test, Frieda', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-09', '06:00-12:00 OG');
  await plan(a, '2026-11-10', '06:00-12:00 OG');
  await plan(a, '2026-11-11', '14:00-20:00 OG');
  await plan(a, '2026-11-16', '06:00-12:00 OG');
  const l = await pr('2026-11-16');
  assert.deepEqual(nur(l, 'schichtlage', a), [{ von: null, bis: null, text: 'Letzte Woche überwiegend früh' }]);
  assert.deepEqual(schwere(l, 'schichtlage'), ['hinweis']);
  const s = await ma('Test, Sven', { kompetenzen: ['OG'] });
  await plan(s, '2026-11-09', '14:00-20:00 OG');
  await plan(s, '2026-11-17', '14:00-20:00 OG');
  assert.deepEqual(nur(await pr('2026-11-17'), 'schichtlage', s), [{ von: null, bis: null, text: 'Letzte Woche überwiegend spät' }]);
});

test('schichtlage: heute mitte, Vorwoche ausgeglichen oder heute andere Lage → kein Hinweis', async () => {
  const a = await ma('Test, Gerd', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-09', '06:00-12:00 OG');
  await plan(a, '2026-11-10', '06:00-12:00 OG');
  await plan(a, '2026-11-16', '09:00-15:00 OG'); // mitte
  await plan(a, '2026-11-17', '14:00-20:00 OG'); // spät nach früher Vorwoche
  assert.deepEqual(nur(await pr('2026-11-16'), 'schichtlage', a), []);
  assert.deepEqual(nur(await pr('2026-11-17'), 'schichtlage', a), []);
  const b = await ma('Test, Greta', { kompetenzen: ['OG'] });
  await plan(b, '2026-11-09', '06:00-12:00 OG');
  await plan(b, '2026-11-10', '14:00-20:00 OG'); // 1 früh, 1 spät → keine Lage der Vorwoche
  await plan(b, '2026-11-16', '06:00-12:00 OG');
  assert.deepEqual(nur(await pr('2026-11-16'), 'schichtlage', b), []);
});

// ---------------------------------------------------------------------------
// samstag_spaet

test('samstag_spaet: zweiter Samstag spät in Folge → Hinweis, auch über einen freien Samstag hinweg', async () => {
  const a = await ma('Test, Sabine', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-14', '14:00-21:00 OG');
  await plan(a, '2026-11-21', '12:00-20:00 OG');
  let l = await pr('2026-11-21');
  assert.deepEqual(nur(l, 'samstag_spaet', a), [{ von: null, bis: null, text: 'Zweiter Samstag spät in Folge' }]);
  assert.deepEqual(schwere(l, 'samstag_spaet'), ['hinweis']);
  const b = await ma('Test, Selma', { kompetenzen: ['OG'] });
  await plan(b, '2026-11-14', '06:00-21:00 OG'); // lang
  await plan(b, '2026-11-28', '14:00-21:00 OG'); // 21.11. frei
  l = await pr('2026-11-28');
  assert.deepEqual(nur(l, 'samstag_spaet', b), [{ von: null, bis: null, text: 'Zweiter Samstag spät in Folge' }]);
});

test('samstag_spaet: vorheriger Samstag früh oder kein vorheriger Samstag → kein Hinweis', async () => {
  const a = await ma('Test, Sigi', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-14', '06:00-12:00 OG');
  await plan(a, '2026-11-21', '14:00-21:00 OG');
  assert.deepEqual(nur(await pr('2026-11-21'), 'samstag_spaet', a), []);
  assert.deepEqual(nur(await pr('2026-11-14'), 'samstag_spaet', a), []);
});

// ---------------------------------------------------------------------------
// freier_samstag (F9)

test('freier_samstag: alle Samstage im November gearbeitet → Hinweis „Noch kein freier Samstag im November“', async () => {
  const a = await ma('Test, Samira', { kompetenzen: ['OG'] });
  for (const d of ['2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']) await plan(a, d, '08:00-12:00 OG');
  const l = await pr('2026-11-28');
  assert.deepEqual(nur(l, 'freier_samstag', a), [{ von: null, bis: null, text: 'Noch kein freier Samstag im November' }]);
  assert.deepEqual(schwere(l, 'freier_samstag'), ['hinweis']);
  assert.equal(nur(await pr('2026-11-07'), 'freier_samstag', a).length, 1);
});

test('freier_samstag: ein Samstag im Monat mit Urlaub oder noch ungeplant → kein Hinweis', async () => {
  const a = await ma('Test, Sonja', { kompetenzen: ['OG'] });
  for (const d of ['2026-11-07', '2026-11-14', '2026-11-21']) await plan(a, d, '08:00-12:00 OG');
  assert.deepEqual(nur(await pr('2026-11-21'), 'freier_samstag', a), []); // 28.11. noch ungeplant
  await plan(a, '2026-11-28', '08:00-12:00 OG');
  await abwesend(a, 'U', '2026-11-28'); // Block bleibt, ist aber unbesetzt → frei
  assert.deepEqual(nur(await pr('2026-11-21'), 'freier_samstag', a), []);
});

test('freier_samstag: Jahresziel nicht mehr erreichbar → Hinweis; erreichbar → keiner', async () => {
  // 2026 hat 52 Samstage; der 14.11. ist der 46.: 45 davor frei + 6 danach = 51
  const a = await ma('Test, Jette', { kompetenzen: ['OG'] });
  await plan(a, '2026-11-14', '08:00-12:00 OG');
  await einstellen('freie_samstage_jahr', 52);
  try {
    assert.deepEqual(nur(await pr('2026-11-14'), 'freier_samstag', a),
      [{ von: null, bis: null, text: 'Jahresziel 52 freie Samstage nicht mehr erreichbar' }]);
    await einstellen('freie_samstage_jahr', 51);
    assert.deepEqual(nur(await pr('2026-11-14'), 'freier_samstag', a), []);
  } finally {
    await einstellen('freie_samstage_jahr', 12);
  }
});

test('freier_samstag: Jahresziel zählt erst ab Eintritt – Neuling Ende November ja, Mitarbeiter ohne Eintritt nein', async () => {
  // Sa 12.12.2026. Neuling ab 30.11.: Samstage ab Eintritt 05., 12., 19., 26.12. → 1 frei davor (05.12.) + 2 danach = 3.
  // Ohne Eintritt: 49 Samstage vor dem 12.12. frei + 2 danach = 51.
  const neu = await ma('Test, Nele', { kompetenzen: ['OG'] });
  await aufruf(leitung, `select public.pep_mitarbeiter_speichern($1, '{"eintritt":"2026-11-30"}')`, [neu]);
  const alt = await ma('Test, Olaf', { kompetenzen: ['OG'] });
  await plan(neu, '2026-12-12', '08:00-12:00 OG');
  await plan(alt, '2026-12-12', '12:00-16:00 OG');
  const hinweis = (n) => [{ von: null, bis: null, text: `Jahresziel ${n} freie Samstage nicht mehr erreichbar` }];
  try {
    let l = await pr('2026-12-12'); // Ziel 12 (Standard)
    assert.deepEqual(nur(l, 'freier_samstag', neu), hinweis(12)); // nur Jahr; Monat: 3 andere Samstage frei
    assert.deepEqual(nur(l, 'freier_samstag', alt), []);
    await einstellen('freie_samstage_jahr', 3);
    assert.deepEqual(nur(await pr('2026-12-12'), 'freier_samstag', neu), []);
    await einstellen('freie_samstage_jahr', 4);
    assert.deepEqual(nur(await pr('2026-12-12'), 'freier_samstag', neu), hinweis(4));
    await einstellen('freie_samstage_jahr', 51);
    assert.deepEqual(nur(await pr('2026-12-12'), 'freier_samstag', alt), []);
    await einstellen('freie_samstage_jahr', 52);
    l = await pr('2026-12-12');
    assert.deepEqual(nur(l, 'freier_samstag', alt), hinweis(52));
  } finally {
    await einstellen('freie_samstage_jahr', 12);
  }
});

// ---------------------------------------------------------------------------
// wunsch_offen (Urlaubstool, Stufe 0)

test('wunsch_offen: offener Wunsch KW 47 und Arbeit am 17.11. → Hinweis; abgelehnt oder ohne Arbeit → keiner', async () => {
  const a = await ma('Test, Wiebke', { kompetenzen: ['OG'] });
  const umfrage = await umfrageAnlegen(db, leitung, { titel: 'Urlaub 2026', jahr: 2026 });
  const frage = await urlaubsfrageId(db, umfrage);
  const t = await umfrageMitarbeiter(db, umfrage, 'Test, Wiebke');
  await aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [umfrage]);
  await aufruf(leitung, 'select public.pep_urlaub_zuordnung_setzen($1, $2)', [t.id, a]);
  await abgeben(db, t.code, { [frage]: [47] });
  await plan(a, '2026-11-17', '08:00-12:00 OG');
  let l = await pr('2026-11-17');
  assert.deepEqual(nur(l, 'wunsch_offen', a), [{ von: null, bis: null, text: 'Urlaubswunsch offen' }]);
  assert.deepEqual(schwere(l, 'wunsch_offen'), ['hinweis']);
  assert.deepEqual(nur(await pr('2026-11-18'), 'wunsch_offen', a), []); // keine Arbeit
  await aufruf(leitung, 'select public.pep_urlaub_ablehnen($1, $2::jsonb, null)', [a, JSON.stringify(
    { umfrage_id: umfrage, urlaub_mitarbeiter_id: t.id, art: 'kw', kw: 47, datum: null })]);
  l = await pr('2026-11-17');
  assert.deepEqual(nur(l, 'wunsch_offen', a), []);
});

// ---------------------------------------------------------------------------
// Zusammenspiel, Sortierung, Abfragen

test('Sortierung: Warnungen vor Hinweisen, dann von, dann Mitarbeitername', async () => {
  const z = await ma('Test, Zacharias', { kompetenzen: ['OG'] });
  const b = await ma('Test, Bernd', { kompetenzen: ['OG'] });
  await plan(z, '2026-12-21', '08:00-15:30 OG');
  await plan(b, '2026-12-21', '08:00-15:30 OG');
  const l = await pr('2026-12-21');
  const pf = l.filter((e) => e.art === 'pause_fehlt').map((e) => e.mitarbeiter_id);
  assert.deepEqual(pf, [b, z]);
  const ersterHinweis = l.findIndex((e) => e.schwere === 'hinweis');
  if (ersterHinweis >= 0) assert.ok(l.slice(ersterHinweis).every((e) => e.schwere === 'hinweis'));
  for (const e of l) assert.deepEqual(Object.keys(e).sort(), ['art', 'bis', 'mitarbeiter_id', 'schwere', 'text', 'von']);
});

// Tage ab mo (YYYY-MM-DD), n Stück
const tageAb = (mo, n = 7) => Array.from({ length: n }, (_, i) => {
  const d = new Date(mo + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
});

test('pep_plan_malen: Mittwoch → Prüfung Mo–So der Woche; Montag zusätzlich der Sonntag davor; Wochenwarnung an allen Arbeitstagen', async () => {
  const a = await ma('Test, Mattis', { kompetenzen: ['OG'] });
  let r = await malen(leitung, a, '2026-12-23', '08:00', '12:00', 'OG');
  assert.deepEqual(Object.keys(r.pruefung).sort(), tageAb('2026-12-21'));
  r = await malen(leitung, a, '2026-12-21', '08:00', '12:00', 'OG');
  assert.deepEqual(Object.keys(r.pruefung).sort(), tageAb('2026-12-20', 8));
  // 3 × 10,5 h + 10 h = 41,5 h: nach dem Strich am Donnerstag steht die Wochenwarnung an allen Arbeitstagen
  for (const d of ['2026-12-21', '2026-12-22', '2026-12-23']) {
    await plan(a, d, '07:00-12:00 OG, 12:00-12:30 PA, 12:30-18:00 OG');
  }
  r = await malen(leitung, a, '2026-12-24', '07:00', '17:00', 'OG');
  for (const d of ['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24']) {
    assert.equal(nur(r.pruefung[d], 'wochenstunden', a).length, 1, d);
  }
  assert.deepEqual(nur(r.pruefung['2026-12-26'], 'wochenstunden', a), []);
});

test('pep_einsatzplan_woche().pruefung hat 7 Schlüssel mit den Listen von pep.pruefung', async () => {
  const w = await json(leitung, 'select public.pep_einsatzplan_woche(2026, 48) as r');
  const tage = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29'];
  assert.deepEqual(Object.keys(w.pruefung).sort(), tage);
  assert.deepEqual(w.pruefung, await zeitraum('2026-11-23', '2026-11-29'));
  assert.ok(w.pruefung['2026-11-26'].some((e) => e.art === 'pausenabloese'));
  assert.deepEqual(w.pruefung['2026-11-29'], []); // Sonntag geschlossen
});

test('pep_pruefung_zeitraum: 42 Tage gehen, 43 → ZEITRAUM_ZU_LANG, bis < von → ZEITRAUM_UNGUELTIG; Stellvertretung darf, Rolle mitarbeiter nicht', async () => {
  const r = await zeitraum('2026-11-09', '2026-12-20', stellv);
  assert.equal(Object.keys(r).length, 42);
  await wirft(zeitraum('2026-11-09', '2026-12-21'), 'ZEITRAUM_ZU_LANG');
  await wirft(zeitraum('2026-11-10', '2026-11-09'), 'ZEITRAUM_UNGUELTIG');
  await wirft(zeitraum(null, '2026-11-09'), 'DATUM_UNGUELTIG');
  await wirft(zeitraum('2026-11-09', '2026-11-09', azubi), 'NUR_LEITUNG');
});

test('pep_pruefung_zeitraum: fremde Filiale sieht keine Einträge der eigenen', async () => {
  const eigen = await zeitraum('2026-11-26', '2026-11-26');
  assert.ok(eigen['2026-11-26'].length > 0);
  // Die fremde Filiale hat an dem Tag niemanden geplant: nur ihre eigene leere Kasse und fehlende VP
  const fremd = (await zeitraum('2026-11-26', '2026-11-26', chef2))['2026-11-26'];
  assert.deepEqual(fremd.map((e) => [e.art, e.mitarbeiter_id, e.text]), [
    ['kasse_unbesetzt', null, 'Kasse unbesetzt 07:00–20:00'],
    ['keine_vp', null, 'Keine VP anwesend 07:00–20:00']]);
});

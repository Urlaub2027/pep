// Abwesenheiten: Tage, Stundenregel, Wiederholungen, Monatsdaten, Neuberechnung.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, heuteSetzen } from './helfer.mjs';

let db, leitung, stellv, fil, anna, ben, cem;
const code = {};

const aufruf = (nutzer, sql, params = []) => als(db, 'authenticated', nutzer, sql, params);
const json = async (nutzer, sql, params = []) => (await aufruf(nutzer, sql, params))[0].r;
const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

const setzen = (nutzer, ma, c, von, bis, stunden = null, vonZeit = null, bisZeit = null) =>
  json(nutzer, `select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, $5::numeric,
                $6::time, $7::time, null) as r`, [ma, code[c], von, bis, stunden, vonZeit, bisZeit]);
const loeschen = (ma, von, bis) =>
  json(leitung, 'select public.pep_abwesenheit_loeschen($1, $2::date, $3::date) as r', [ma, von, bis]);
const zeilen = async (ma, von, bis) => (await db.query(
  `select a.datum::text as datum, c.code, a.stunden::float as stunden, a.von::text as von, a.bis::text as bis,
          a.quelle, a.wiederholung_id
     from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
    where a.mitarbeiter_id = $1 and a.datum between $2::date and $3::date order by a.datum`,
  [ma, von, bis])).rows;
const neuerMa = async (name, std, ab = '2026-01-01') => {
  const id = await json(leitung, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name })]);
  await aufruf(leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
    [id, JSON.stringify({ vertragsart: 'teilzeit', wochenstunden: std, gueltig_ab: ab })]);
  return id;
};
const monat = (j, m) => json(leitung, 'select public.pep_abwesenheiten($1, $2) as r', [j, m]);

before(async () => {
  db = await neueDatenbank();
  await heuteSetzen(db, '2026-10-24'); // fester Stichtag, damit die Tests nie ablaufen
  leitung = await pepBenutzer(db, 'chef');
  fil = await filiale(db, leitung);
  stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  anna = await neuerMa('Test, Anna', 37.5);
  ben = await neuerMa('Muster, Ben', 30);
  cem = await neuerMa('Beispiel, Cem', 20);
  const e = await json(leitung, 'select public.pep_einstellungen() as r');
  for (const c of e.codes) code[c.code] = c.id;
});

test('Teiler: 37,5 → 6.25; 30 → 5.00; 20 → 3.33', async () => {
  await setzen(leitung, anna, 'KM', '2026-11-03', '2026-11-03');
  await setzen(leitung, ben, 'KM', '2026-11-03', '2026-11-03');
  await setzen(leitung, cem, 'KM', '2026-11-03', '2026-11-03');
  assert.equal((await zeilen(anna, '2026-11-03', '2026-11-03'))[0].stunden, 6.25);
  assert.equal((await zeilen(ben, '2026-11-03', '2026-11-03'))[0].stunden, 5);
  assert.equal((await zeilen(cem, '2026-11-03', '2026-11-03'))[0].stunden, 3.33);
});

test('Woche Mo–So setzen: 6 Tage (So übersprungen), Summe 37.50, uebersprungen 1', async () => {
  const r = await setzen(leitung, anna, 'U', '2027-03-01', '2027-03-07');
  assert.deepEqual(r, { tage: 6, uebersprungen: 1 });
  const z = await zeilen(anna, '2027-03-01', '2027-03-07');
  assert.equal(z.length, 6);
  assert.equal(z.reduce((s, x) => s + x.stunden, 0), 37.5);
  assert.ok(!z.some((x) => x.datum === '2027-03-07'));
});

test('Feiertag wird übersprungen: 2027-03-25..2027-03-27 U → 2 Tage (Karfreitag fehlt)', async () => {
  const r = await setzen(leitung, ben, 'U', '2027-03-25', '2027-03-27');
  assert.deepEqual(r, { tage: 2, uebersprungen: 1 });
  const z = await zeilen(ben, '2027-03-25', '2027-03-27');
  assert.deepEqual(z.map((x) => x.datum), ['2027-03-25', '2027-03-27']);
});

test('Samstag zählt mit: 2027-03-06 (Sa) U → 1 Tag 6.25', async () => {
  const m = await neuerMa('Test, Sabine', 37.5);
  const r = await setzen(leitung, m, 'U', '2027-03-06', '2027-03-06');
  assert.deepEqual(r, { tage: 1, uebersprungen: 0 });
  assert.equal((await zeilen(m, '2027-03-06', '2027-03-06'))[0].stunden, 6.25);
});

test('erneut setzen ersetzt: KM über U am selben Tag → eine Zeile mit code KM', async () => {
  const m = await neuerMa('Test, Erika', 37.5);
  await setzen(leitung, m, 'U', '2027-04-06', '2027-04-06');
  await setzen(leitung, m, 'KM', '2027-04-06', '2027-04-06');
  const z = await zeilen(m, '2027-04-06', '2027-04-06');
  assert.equal(z.length, 1);
  assert.equal(z[0].code, 'KM');
});

test('BS ohne Stunden → STUNDEN_FEHLEN; BS mit 8 → 8.00; NV → 0.00', async () => {
  const m = await neuerMa('Test, Bernd', 37.5);
  await wirft(setzen(leitung, m, 'BS', '2027-04-07', '2027-04-07'), 'STUNDEN_FEHLEN');
  await setzen(leitung, m, 'BS', '2027-04-07', '2027-04-07', 8);
  await setzen(leitung, m, 'NV', '2027-04-08', '2027-04-08');
  const z = await zeilen(m, '2027-04-07', '2027-04-08');
  assert.deepEqual(z.map((x) => [x.code, x.stunden]), [['BS', 8], ['NV', 0]]);
});

test('mit Uhrzeit 08:00–13:00 und 5 Stunden: von/bis gespeichert; ohne Stunden → STUNDEN_FEHLEN', async () => {
  const m = await neuerMa('Test, Uwe', 37.5);
  await setzen(leitung, m, 'ZA', '2027-04-09', '2027-04-09', 5, '08:00', '13:00');
  const z = await zeilen(m, '2027-04-09', '2027-04-09');
  assert.equal(z[0].von, '08:00:00');
  assert.equal(z[0].bis, '13:00:00');
  assert.equal(z[0].stunden, 5);
  await wirft(setzen(leitung, m, 'ZA', '2027-04-10', '2027-04-10', null, '08:00', '13:00'), 'STUNDEN_FEHLEN');
  await wirft(setzen(leitung, m, 'ZA', '2027-04-10', '2027-04-10', 5, '08:15', '13:00'), 'HALBE_STUNDE');
  await wirft(setzen(leitung, m, 'ZA', '2027-04-10', '2027-04-10', 5, '13:00', '08:00'), 'ZEITEN_UNGUELTIG');
});

test('ZEITRAUM_UNGUELTIG bei bis<von, ZEITRAUM_ZU_LANG bei 367 Tagen', async () => {
  await wirft(setzen(leitung, anna, 'U', '2027-05-10', '2027-05-09'), 'ZEITRAUM_UNGUELTIG');
  await wirft(setzen(leitung, anna, 'U', '2027-01-01', '2028-01-02'), 'ZEITRAUM_ZU_LANG');
});

test('ohne Vertrag am Datum → KEIN_VERTRAG (2025-12-31)', async () => {
  await wirft(setzen(leitung, anna, 'U', '2025-12-31', '2025-12-31'), 'KEIN_VERTRAG');
});

test('löschen 2027-03-01..07 → 6', async () => {
  assert.equal(await loeschen(anna, '2027-03-01', '2027-03-07'), 6);
  assert.equal((await zeilen(anna, '2027-03-01', '2027-03-07')).length, 0);
});

test('Wiederholung BS jeden Dienstag 2027-01-01..2027-06-30 8h: 26 Dienstage, Vergangene nicht', async () => {
  const m = await neuerMa('Test, Walter', 30);
  const daten = (extra) => JSON.stringify({ code_id: code.BS, wochentag: 2, von_datum: '2027-01-01',
    bis_datum: '2027-06-30', stunden: 8, ...extra });
  const id = await json(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb) as r', [m, daten({})]);
  const z = await zeilen(m, '2027-01-01', '2027-06-30');
  assert.equal(z.length, 26);
  assert.ok(z.every((x) => x.code === 'BS' && x.stunden === 8 && x.quelle === 'wiederholung' && x.wiederholung_id == id));
  await wirft(aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [m, daten({ von_datum: '2025-12-01', bis_datum: '2026-01-01' })]), 'ZEITRAUM_UNGUELTIG');
  await wirft(aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [m, daten({ bis_datum: '2028-02-01' })]), 'ZEITRAUM_ZU_LANG');
  await wirft(aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [m, daten({ wochentag: 8 })]), 'WOCHENTAG_UNGUELTIG');
});

test('Wiederholung ändern auf Mittwoch: Dienstage weg, Mittwoche da; löschen entfernt künftige', async () => {
  const m = await neuerMa('Test, Wilma', 30);
  const daten = (extra) => JSON.stringify({ code_id: code.BS, wochentag: 2, von_datum: '2027-01-01',
    bis_datum: '2027-06-30', stunden: 8, ...extra });
  const id = await json(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb) as r', [m, daten({})]);
  const id2 = await json(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb) as r',
    [m, daten({ id, wochentag: 3 })]);
  assert.equal(id2, id);
  const z = await zeilen(m, '2027-01-01', '2027-06-30');
  // 2027-01-06 (Heilige Drei Könige, Mittwoch) ist in Bayern ein Feiertag und fällt weg
  assert.equal(z.length, 25);
  assert.ok(z.every((x) => new Date(x.datum + 'T00:00:00Z').getUTCDay() === 3));
  await aufruf(leitung, 'select public.pep_wiederholung_loeschen($1)', [id]);
  assert.equal((await zeilen(m, '2027-01-01', '2027-06-30')).length, 0);
  assert.equal((await db.query('select count(*)::int as n from pep.wiederholungen where id = $1', [id])).rows[0].n, 0);
});

test('neuer Vertrag ab 2027-03-01 mit 30 h rechnet U-Tage ab März auf 5.00 um, Februar bleibt 6.25; ein Protokolleintrag neu_berechnet', async () => {
  const m = await neuerMa('Test, Vera', 37.5);
  await setzen(leitung, m, 'U', '2027-02-26', '2027-03-02');
  const vorher = (await db.query("select count(*)::int as n from pep.protokoll where aktion = 'neu_berechnet'")).rows[0].n;
  await aufruf(leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
    [m, JSON.stringify({ vertragsart: 'teilzeit', wochenstunden: 30, gueltig_ab: '2027-03-01' })]);
  const z = await zeilen(m, '2027-02-26', '2027-03-02');
  assert.deepEqual(z.map((x) => [x.datum, x.stunden]),
    [['2027-02-26', 6.25], ['2027-02-27', 6.25], ['2027-03-01', 5], ['2027-03-02', 5]]);
  const nachher = (await db.query("select count(*)::int as n from pep.protokoll where aktion = 'neu_berechnet'")).rows[0].n;
  assert.equal(nachher - vorher, 1);
  const p = (await db.query("select nachher from pep.protokoll where aktion = 'neu_berechnet' order by id desc limit 1")).rows[0].nachher;
  assert.equal(p.anzahl, 2);
  assert.equal(p.ab, '2027-03-01');
});

test('Teiler auf 5 setzen rechnet alle Teiler-Zeilen um (6.25 → 7.50), tatsaechlich-Zeilen bleiben', async () => {
  const m = await neuerMa('Test, Tina', 37.5);
  await setzen(leitung, m, 'U', '2027-06-01', '2027-06-01');
  await setzen(leitung, m, 'BS', '2027-06-02', '2027-06-02', 8);
  await aufruf(leitung, `select public.pep_einstellung_setzen('abwesenheit_teiler', '5'::jsonb)`);
  try {
    const z = await zeilen(m, '2027-06-01', '2027-06-02');
    assert.deepEqual(z.map((x) => [x.code, x.stunden]), [['U', 7.5], ['BS', 8]]);
  } finally {
    await aufruf(leitung, `select public.pep_einstellung_setzen('abwesenheit_teiler', '6'::jsonb)`);
  }
  assert.equal((await zeilen(m, '2027-06-01', '2027-06-01'))[0].stunden, 6.25);
});

test('pep_abwesenheiten(2026,12) und (2027,1): Kalenderwochen und Feiertage', async () => {
  const d = await monat(2026, 12);
  assert.equal(d.tage.length, 31);
  const t = (datum) => d.tage.find((x) => x.datum === datum);
  assert.equal(t('2026-12-28').kw, 53);
  assert.equal(t('2026-12-28').wochentag, 1);
  assert.equal(t('2026-12-25').feiertag !== null, true);
  assert.equal(t('2026-12-25').geoeffnet, false);
  assert.equal(t('2026-12-27').geoeffnet, false);
  const j = await monat(2027, 1);
  assert.equal(j.tage.find((x) => x.datum === '2027-01-01').kw, 53);
  assert.equal(j.tage.find((x) => x.datum === '2027-01-04').kw, 1);
  await wirft(aufruf(leitung, 'select public.pep_abwesenheiten(2027, 13)'), 'DATUM_UNGUELTIG');
});

test('pep_abwesenheiten: Schulferien-Name, Summen je Datum, urlaub.rest = 225 + 0 − genehmigt', async () => {
  const m = await neuerMa('Test, Gerda', 37.5);
  const k = await neuerMa('Muster, Kurt', 30);
  await aufruf(leitung, 'select public.pep_schulferien_speichern(null, $1::date, $2::date, $3)',
    ['2027-08-02', '2027-08-06', 'Testferien']);
  await aufruf(leitung, 'select public.pep_urlaubsjahr_speichern($1, 2027, 225, 0)', [m]);
  await setzen(leitung, m, 'U', '2027-08-02', '2027-08-03');
  await setzen(leitung, k, 'U', '2027-08-02', '2027-08-02');
  await setzen(leitung, k, 'KM', '2027-08-03', '2027-08-03');
  const d = await monat(2027, 8);
  assert.equal(d.tage.find((x) => x.datum === '2027-08-02').schulferien, 'Testferien');
  assert.equal(d.tage.find((x) => x.datum === '2027-08-09').schulferien, null);
  assert.equal(d.summen['2027-08-02'], 11.25);
  assert.equal(d.summen['2027-08-03'], 11.25);
  assert.equal(d.summen['2027-08-04'], undefined);
  const ma = d.mitarbeiter.find((x) => x.id === m);
  assert.equal(ma.wochenstunden, 37.5);
  assert.deepEqual(Object.keys(ma.tage), ['2027-08-02', '2027-08-03']);
  assert.equal(ma.tage['2027-08-02'].code, 'U');
  assert.equal(ma.tage['2027-08-02'].stunden, 6.25);
  const u = d.urlaub.find((x) => x.mitarbeiter_id === m);
  assert.equal(u.anspruch, 225);
  assert.equal(u.genehmigt, 12.5);
  assert.equal(u.rest, 212.5);
  const uk = d.urlaub.find((x) => x.mitarbeiter_id === k);
  assert.deepEqual([uk.anspruch, uk.genehmigt, uk.rest], [0, 5, -5]);
  assert.ok(d.codes.some((c) => c.code === 'U'));
  assert.deepEqual(d.wuensche, []);
});

test('inaktiver Mitarbeiter → MITARBEITER_INAKTIV; Stellvertretung darf setzen', async () => {
  const m = await neuerMa('Test, Ida', 37.5);
  await aufruf(leitung, 'select public.pep_mitarbeiter_speichern($1, $2::jsonb)', [m, JSON.stringify({ aktiv: false })]);
  await wirft(setzen(leitung, m, 'U', '2027-09-01', '2027-09-01'), 'MITARBEITER_INAKTIV');
  const r = await setzen(stellv, anna, 'U', '2027-09-01', '2027-09-01');
  assert.equal(r.tage, 1);
  assert.equal(await json(stellv, 'select public.pep_abwesenheit_loeschen($1, $2::date, $3::date) as r',
    [anna, '2027-09-01', '2027-09-01']), 1);
});

test('Stunden: Teiltag und Wiederholung mit 0, negativen oder zu großen Stunden → STUNDEN_UNGUELTIG', async () => {
  const m = await neuerMa('Test, Stefan', 37.5);
  for (const h of [-1, 0, 25]) {
    await wirft(setzen(leitung, m, 'ZA', '2027-04-12', '2027-04-12', h, '08:00', '13:00'), 'STUNDEN_UNGUELTIG');
  }
  await wirft(setzen(leitung, m, 'BS', '2027-04-12', '2027-04-12', 25), 'STUNDEN_UNGUELTIG');
  const w = (extra) => aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [m, JSON.stringify({ code_id: code.BS, wochentag: 2, von_datum: '2027-01-01', bis_datum: '2027-06-30', ...extra })]);
  for (const h of [-1, 0, 25]) await wirft(w({ stunden: h }), 'STUNDEN_UNGUELTIG');
  await wirft(w({ stunden: 30, von: '08:00', bis: '13:00' }), 'STUNDEN_UNGUELTIG');
  assert.equal((await db.query('select count(*)::int as n from pep.wiederholungen where mitarbeiter_id = $1', [m])).rows[0].n, 0);
});

test('Wiederholung mit tatsaechlich-Code ohne Stunden → STUNDEN_FEHLEN, nichts gespeichert', async () => {
  const m = await neuerMa('Test, Sven', 37.5);
  await wirft(aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [m, JSON.stringify({ code_id: code.BS, wochentag: 2, von_datum: '2027-01-01', bis_datum: '2027-06-30' })]),
    'STUNDEN_FEHLEN');
  assert.equal((await db.query('select count(*)::int as n from pep.wiederholungen where mitarbeiter_id = $1', [m])).rows[0].n, 0);
  // Teiler-Code braucht keine Stunden
  await aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [m, JSON.stringify({ code_id: code.U, wochentag: 2, von_datum: '2027-01-01', bis_datum: '2027-01-31' })]);
});

test('Wiederholung überschreibt keine manuellen Einträge', async () => {
  const m = await neuerMa('Test, Marta', 37.5);
  await setzen(leitung, m, 'KM', '2027-02-02', '2027-02-02');
  await aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [m, JSON.stringify({ code_id: code.BS, wochentag: 2, von_datum: '2027-02-01', bis_datum: '2027-02-28', stunden: 8 })]);
  const z = await zeilen(m, '2027-02-01', '2027-02-28');
  assert.deepEqual(z.map((x) => [x.datum, x.code, x.quelle]), [
    ['2027-02-02', 'KM', 'manuell'], ['2027-02-09', 'BS', 'wiederholung'],
    ['2027-02-16', 'BS', 'wiederholung'], ['2027-02-23', 'BS', 'wiederholung']]);
});

test('Rolle mitarbeiter darf nichts: NUR_LEITUNG bei setzen, loeschen, Wiederholung, Monatsdaten', async () => {
  const ma = await pepBenutzer(db, 'azubi', 'mitarbeiter', fil);
  await wirft(setzen(ma, anna, 'U', '2027-09-02', '2027-09-02'), 'NUR_LEITUNG');
  await wirft(aufruf(ma, 'select public.pep_abwesenheit_loeschen($1, $2::date, $2::date)', [anna, '2027-09-02']), 'NUR_LEITUNG');
  await wirft(aufruf(ma, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [anna, JSON.stringify({ code_id: code.U, wochentag: 2, von_datum: '2027-01-01', bis_datum: '2027-01-31' })]), 'NUR_LEITUNG');
  await wirft(aufruf(ma, 'select public.pep_wiederholung_loeschen(1)'), 'NUR_LEITUNG');
  await wirft(aufruf(ma, 'select public.pep_abwesenheiten(2027, 9)'), 'NUR_LEITUNG');
});

test('fremde Filiale: Mitarbeiter, Code und Wiederholung sind gesperrt, nichts wird geschrieben', async () => {
  const chef2 = await pepBenutzer(db, 'chef2');
  await filiale(db, chef2, { name: 'Netto Fremd', nummer: '9999' });
  const fremd = await json(chef2, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name: 'Fremd, Frank' })]);
  await aufruf(chef2, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
    [fremd, JSON.stringify({ vertragsart: 'teilzeit', wochenstunden: 30, gueltig_ab: '2026-01-01' })]);
  const fremdCode = (await json(chef2, 'select public.pep_einstellungen() as r')).codes.find((c) => c.code === 'U').id;
  const eigeneW = await json(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb) as r',
    [cem, JSON.stringify({ code_id: code.U, wochentag: 3, von_datum: '2027-01-01', bis_datum: '2027-01-31' })]);
  const zaehle = async () => (await db.query('select (select count(*) from pep.abwesenheiten)::int as a, (select count(*) from pep.wiederholungen)::int as w')).rows[0];
  const vorher = await zaehle();

  await wirft(setzen(leitung, fremd, 'U', '2027-09-03', '2027-09-03'), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(aufruf(leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, null, null, null, null)',
    [anna, fremdCode, '2027-09-03']), 'CODE_NICHT_GEFUNDEN');
  await wirft(aufruf(leitung, 'select public.pep_abwesenheit_loeschen($1, $2::date, $2::date)', [fremd, '2027-09-03']),
    'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [fremd, JSON.stringify({ code_id: code.U, wochentag: 2, von_datum: '2027-01-01', bis_datum: '2027-01-31' })]),
    'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [anna, JSON.stringify({ code_id: fremdCode, wochentag: 2, von_datum: '2027-01-01', bis_datum: '2027-01-31' })]),
    'CODE_NICHT_GEFUNDEN');
  // eine Regel der ersten Filiale lässt sich von der zweiten weder ändern noch löschen
  await wirft(aufruf(chef2, 'select public.pep_wiederholung_loeschen($1)', [eigeneW]), 'WIEDERHOLUNG_NICHT_GEFUNDEN');
  await wirft(aufruf(chef2, 'select public.pep_wiederholung_speichern($1, $2::jsonb)',
    [fremd, JSON.stringify({ id: eigeneW, code_id: fremdCode, wochentag: 2, von_datum: '2027-01-01', bis_datum: '2027-01-31' })]),
    'WIEDERHOLUNG_NICHT_GEFUNDEN');
  assert.deepEqual(await zaehle(), vorher);
});

test('pep_abwesenheiten liefert die Notiz des Tages (notiz); ohne Notiz null', async () => {
  await json(leitung, `select public.pep_abwesenheit_setzen($1, $2, '2027-08-10'::date, '2027-08-10'::date,
    null, null, null, 'Arzttermin') as r`, [cem, code.KM]);
  await setzen(leitung, cem, 'KM', '2027-08-11', '2027-08-11');
  const tage = (await monat(2027, 8)).mitarbeiter.find((x) => x.id === cem).tage;
  assert.equal(tage['2027-08-10'].notiz, 'Arzttermin');
  assert.equal(tage['2027-08-11'].notiz, null);
});

test('Wiederholung setzt in Schulferien aus; mit schulferien_aussetzen false nicht', async () => {
  await aufruf(leitung, 'select public.pep_schulferien_speichern(null, $1::date, $2::date, $3)',
    ['2027-04-05', '2027-04-16', 'Osterferien Test']);
  const regel = (extra) => JSON.stringify({ code_id: code.BS, wochentag: 2, von_datum: '2027-03-01',
    bis_datum: '2027-04-30', stunden: 8, ...extra });
  const m1 = await neuerMa('Test, Ferienfrei', 30);
  await aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)', [m1, regel({})]);
  const d1 = (await zeilen(m1, '2027-03-01', '2027-04-30')).map((x) => x.datum);
  assert.ok(!d1.includes('2027-04-06') && !d1.includes('2027-04-13'));
  assert.ok(d1.includes('2027-03-30') && d1.includes('2027-04-20'));
  const m2 = await neuerMa('Test, Ferienmit', 30);
  await aufruf(leitung, 'select public.pep_wiederholung_speichern($1, $2::jsonb)', [m2, regel({ schulferien_aussetzen: false })]);
  const d2 = (await zeilen(m2, '2027-03-01', '2027-04-30')).map((x) => x.datum);
  assert.ok(d2.includes('2027-04-06') && d2.includes('2027-04-13'));
});

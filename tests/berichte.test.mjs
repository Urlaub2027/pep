// Berichte: public.pep_resturlaub (Ausdruck „Resturlaub“, Spec 13). Heute = Mo 02.11.2026.
// Urlaub = Stunden des Codes U im Kalenderjahr; rest = anspruch + rest_vorjahr − genehmigt wie die Urlaubsübersicht
// im Reiter Abwesenheiten (pep_abwesenheiten → urlaub).
// Dazu public.pep_stundenblatt (Stufe 2, Ausdruck „Stundenblatt“) in einer eigenen Datenbank (describe unten).
import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, planGrundlage, pepBenutzer, filiale, als } from './helfer.mjs';

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

let t, anna, ben, cem, fremd, chef2;

const setzen = (maId, code, von, bis, nutzer = t.leitung) => t.json(nutzer,
  'select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, null, null, null, null) as r', [maId, t.code[code], von, bis]);
const resturlaub = (jahr, nutzer = t.leitung) => t.json(nutzer, 'select public.pep_resturlaub($1) as r', [jahr]);
const zeile = (daten, id) => daten.mitarbeiter.find((m) => m.id === id);

before(async () => {
  const db = await neueDatenbank();
  t = { db, ...(await planGrundlage(db)) };
  anna = await t.ma('Test, Anna', { stunden: 37.5, ab: '2025-01-01' });
  await t.json(t.leitung, `select public.pep_mitarbeiter_speichern($1, '{"personalnummer":"1001"}') as r`, [anna]);
  await t.json(t.leitung, 'select public.pep_urlaubsjahr_speichern($1, 2026, 150, 10) as r', [anna]);
  await setzen(anna, 'U', '2026-01-12', '2026-01-16'); // Mo–Fr, 5 × 6,25
  await setzen(anna, 'U', '2026-03-02', '2026-03-02');
  await setzen(anna, 'KM', '2026-02-02', '2026-02-03'); // zählt nicht als Urlaub
  await setzen(anna, 'U', '2025-12-29', '2025-12-30'); // Vorjahr
  await setzen(anna, 'U', '2027-01-04', '2027-01-04'); // Folgejahr
  // Ben: Vertrag am 01.01. 30 h (ab 2025), ab April 37,5 h; kein Urlaubsjahr 2026.
  ben = await t.ma('Muster, Ben', { stunden: 30, art: 'teilzeit', ab: '2025-06-01' });
  await t.json(t.leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb) as r',
    [ben, JSON.stringify({ vertragsart: 'vollzeit', wochenstunden: 37.5, gueltig_ab: '2026-04-01' })]);
  await setzen(ben, 'U', '2026-11-16', '2026-11-16'); // 37,5 / 6 = 6,25
  // Cem: erster Vertrag erst im März.
  cem = await t.ma('Beispiel, Cem', { stunden: 20, art: 'teilzeit', ab: '2026-03-01' });
  await t.json(t.leitung, 'select public.pep_urlaubsjahr_speichern($1, 2026, 60, 0) as r', [cem]);
  // Zweite Filiale mit eigenem Mitarbeiter und Urlaub.
  chef2 = await pepBenutzer(db, 'chef2');
  await filiale(db, chef2, { name: 'Netto Testort', nummer: '9999' });
  fremd = (await als(db, 'authenticated', chef2,
    `select public.pep_mitarbeiter_speichern(null, '{"name":"Fremd, Fritz"}') as r`))[0].r;
  await als(db, 'authenticated', chef2, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
    [fremd, JSON.stringify({ vertragsart: 'vollzeit', wochenstunden: 37.5, gueltig_ab: '2026-01-01' })]);
  await als(db, 'authenticated', chef2, 'select public.pep_urlaubsjahr_speichern($1, 2026, 200, 0)', [fremd]);
});

test('Urlaub im Januar und März → monate[0], monate[2], genehmigt, rest, rest_tage', async () => {
  const r = await resturlaub(2026);
  assert.equal(r.jahr, 2026);
  assert.equal(r.stand, '2026-11-02');
  const a = zeile(r, anna);
  assert.equal(a.name, 'Test, Anna');
  assert.equal(a.personalnummer, '1001');
  assert.equal(a.wochenstunden, 37.5);
  assert.equal(a.tagesstunden, 6.25);
  assert.equal(a.anspruch, 150);
  assert.equal(a.rest_vorjahr, 10);
  assert.equal(a.monate.length, 12);
  assert.equal(a.monate[0], 31.25);
  assert.equal(a.monate[1], 0, 'KM im Februar ist kein Urlaub');
  assert.equal(a.monate[2], 6.25);
  assert.equal(a.monate.reduce((s, x) => s + x, 0), 37.5);
  assert.equal(a.genehmigt, 37.5, 'Vor- und Folgejahr zählen nicht');
  assert.equal(a.rest, 122.5);
  assert.equal(a.rest_tage, 19.6);
});

test('ohne Urlaubsjahr: anspruch = 0, rest negativ; Tagesstunden nach dem Vertrag am 01.01.', async () => {
  const b = zeile(await resturlaub(2026), ben);
  assert.equal(b.anspruch, 0);
  assert.equal(b.rest_vorjahr, 0);
  assert.equal(b.monate[10], 6.25);
  assert.equal(b.genehmigt, 6.25);
  assert.equal(b.rest, -6.25);
  assert.equal(b.wochenstunden, 30);
  assert.equal(b.tagesstunden, 5);
  assert.equal(b.rest_tage, -1.25);
});

test('Vertrag erst im Jahr: erster Vertrag im Jahr; Tage aus ungerundeten Tagesstunden', async () => {
  const c = zeile(await resturlaub(2026), cem);
  assert.equal(c.wochenstunden, 20);
  assert.equal(c.tagesstunden, 3.33);
  assert.equal(c.rest, 60);
  assert.equal(c.rest_tage, 18); // 60 / (20 / 6)
});

test('nur Mitarbeiter der eigenen Filiale', async () => {
  const eigene = await resturlaub(2026);
  assert.deepEqual(eigene.mitarbeiter.map((m) => m.id).sort(), [anna, ben, cem].sort());
  const andere = await resturlaub(2026, chef2);
  assert.deepEqual(andere.mitarbeiter.map((m) => m.id), [fremd]);
  assert.equal(andere.mitarbeiter[0].anspruch, 200);
});

test('gleiche Rechnung wie die Urlaubsübersicht in pep_abwesenheiten', async () => {
  const r = await resturlaub(2026);
  const monat = await t.json(t.leitung, 'select public.pep_abwesenheiten(2026, 11) as r');
  for (const u of monat.urlaub) {
    const z = zeile(r, u.mitarbeiter_id);
    assert.deepEqual([z.anspruch, z.rest_vorjahr, z.genehmigt, z.rest], [u.anspruch, u.rest_vorjahr, u.genehmigt, u.rest]);
  }
});

test('Stellvertretung darf; Jahr außerhalb 2000–2100 → DATUM_UNGUELTIG', async () => {
  const r = await resturlaub(2026, t.stellv);
  assert.equal(r.mitarbeiter.length, 3);
  await wirft(resturlaub(1999), 'DATUM_UNGUELTIG');
  await wirft(resturlaub(null), 'DATUM_UNGUELTIG');
});

// ---------------------------------------------------------------- Stundenblatt (Stufe 2, eine Seite je Mitarbeiter)
// Eigene Datenbank: heute = Mo 11.01.2027, IST-Erfassung ab Mo 04.01.2027 (KW 1/2027 mit Mi 06.01. Heilige Drei Könige,
// Bayern, geschlossen). Der Zeitraum Fr 01.01.–So 10.01.2027 berührt KW 53/2026 und KW 1/2027.
describe('pep_stundenblatt', () => {
  let s, anna2, ben2, cem2, emil2, fremd2, chef3;
  const blatt = (mid, von, bis, nutzer = s.leitung) =>
    s.json(nutzer, 'select public.pep_stundenblatt($1, $2::date, $3::date) as r', [mid, von, bis]);
  const tag = (m, datum) => m.tage.find((x) => x.datum === datum);
  const leer = { vor_start: false, offen: false, feiertag: null, anwesend_von: null, anwesend_bis: null, pause: null,
    abwesend: null, arbeitszeit: null };

  before(async () => {
    const db = await neueDatenbank();
    s = { db, ...(await planGrundlage(db, { heute: '2027-01-11', istAb: '2027-01-04' })) };
    const { json, bereich, code } = s;
    const istSetzen = (mid, datum, bloecke) => json(s.leitung,
      'select public.pep_ist_zeile_setzen($1, $2::date, $3::jsonb, null) as r',
      [mid, datum, JSON.stringify(bloecke.map(([von, bis, k]) => ({ von, bis, bereich_id: bereich[k] })))]);
    const bestaetigen = (mid, datum) =>
      json(s.leitung, 'select public.pep_ist_bestaetigen($1::date, array[$2]::bigint[]) as r', [datum, mid]);
    const abwesend = (mid, c, datum, stunden = null, von = null, bis = null) => json(s.leitung,
      'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, $4, $5::time, $6::time, null) as r',
      [mid, code[c], datum, stunden, von, bis]);
    const buchen = (mid, art, stunden, datum) => json(s.leitung,
      'select public.pep_zeitkonto_buchen($1, $2, $3, $4, $5::date) as r', [mid, art, stunden, 'Test', datum]);

    anna2 = await s.ma('Test, Anna', { stunden: 37.5, ab: '2026-01-01' });
    await json(s.leitung, `select public.pep_mitarbeiter_speichern($1, '{"personalnummer":"1001"}') as r`, [anna2]);
    // Mo 04.01.: 07:00–15:30 mit Pause 12:00–12:30, bestätigt
    await istSetzen(anna2, '2027-01-04', [['07:00', '12:00', 'KA'], ['12:00', '12:30', 'PA'], ['12:30', '15:30', 'KA']]);
    await bestaetigen(anna2, '2027-01-04');
    await abwesend(anna2, 'U', '2027-01-05'); // Di: Urlaub 6,25
    // Do 07.01.: IST erfasst, aber nicht bestätigt → offen, keine Stunden
    await istSetzen(anna2, '2027-01-07', [['08:00', '16:00', 'KA']]);
    // Fr 08.01.: bis Mitternacht, bestätigt
    await istSetzen(anna2, '2027-01-08', [['22:00', '24:00', 'KA']]);
    await bestaetigen(anna2, '2027-01-08');
    // Sa 09.01.: offen ohne IST
    await buchen(anna2, 'start', -3.5, '2026-12-27'); // vor KW 53
    await buchen(anna2, 'manuell', 2, '2027-01-05'); // in KW 1
    await buchen(anna2, 'manuell', 1, '2027-01-11'); // nach dem Zeitraum: zählt in keinem Wochensaldo

    ben2 = await s.ma('Muster, Ben', { stunden: 20, art: 'teilzeit', ab: '2026-01-01' });
    await bestaetigen(ben2, '2027-01-04'); // ohne Plan: leer bestätigt
    await abwesend(ben2, 'KM', '2027-01-05', 2, '08:00', '10:00'); // Teil-KM
    await istSetzen(ben2, '2027-01-05', [['10:00', '14:00', 'KA']]);
    await bestaetigen(ben2, '2027-01-05');

    cem2 = await s.ma('Beispiel, Cem', { ab: '2026-01-01' });
    await json(s.leitung, `select public.pep_mitarbeiter_speichern($1, '{"aktiv":false}') as r`, [cem2]);
    await s.ma('Probe, Dana', { ab: '2027-02-01' }); // Vertrag erst nach dem Zeitraum
    emil2 = await s.ma('Demo, Emil', { ab: '2026-01-01' });
    await json(s.leitung, `select public.pep_mitarbeiter_speichern($1, '{"austritt":"2026-12-20"}') as r`, [emil2]);

    chef3 = await pepBenutzer(db, 'chef3');
    await filiale(db, chef3, { name: 'Netto Testort', nummer: '9998' });
    fremd2 = (await als(db, 'authenticated', chef3,
      `select public.pep_mitarbeiter_speichern(null, '{"name":"Fremd, Fritz"}') as r`))[0].r;
    await als(db, 'authenticated', chef3, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
      [fremd2, JSON.stringify({ vertragsart: 'vollzeit', wochenstunden: 37.5, gueltig_ab: '2026-01-01' })]);
  });

  test('Woche mit IST, U und Feiertag: Tageszeilen und Wochenzeilen mit Saldo', async () => {
    const r = await blatt(anna2, '2027-01-01', '2027-01-10');
    assert.equal(r.von, '2027-01-01');
    assert.equal(r.bis, '2027-01-10');
    assert.equal(r.mitarbeiter.length, 1);
    const a = r.mitarbeiter[0];
    assert.deepEqual([a.id, a.name, a.personalnummer], [anna2, 'Test, Anna', '1001']);
    assert.deepEqual(a.tage.map((x) => x.datum), ['2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05',
      '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10']);
    // Vor dem Start der IST-Erfassung: keine Werte, auch kein Feiertag (Neujahr)
    assert.deepEqual(tag(a, '2027-01-01'), { datum: '2027-01-01', ...leer, vor_start: true });
    assert.deepEqual(tag(a, '2027-01-02'), { datum: '2027-01-02', ...leer, vor_start: true });
    // Bestätigt mit Pause
    assert.deepEqual(tag(a, '2027-01-04'), { datum: '2027-01-04', ...leer,
      anwesend_von: '07:00', anwesend_bis: '15:30', pause: 0.5, arbeitszeit: 8 });
    // Urlaub ganztägig: nie offen, keine Zeiten
    assert.deepEqual(tag(a, '2027-01-05'), { datum: '2027-01-05', ...leer, abwesend: { code: 'U', stunden: 6.25 } });
    // Feiertag, Filiale geschlossen
    assert.deepEqual(tag(a, '2027-01-06'), { datum: '2027-01-06', ...leer, feiertag: 'Heilige Drei Könige' });
    // IST erfasst, nicht bestätigt: offen, nichts vom IST
    assert.deepEqual(tag(a, '2027-01-07'), { datum: '2027-01-07', ...leer, offen: true });
    // Mitternacht als 24:00
    assert.deepEqual(tag(a, '2027-01-08'), { datum: '2027-01-08', ...leer,
      anwesend_von: '22:00', anwesend_bis: '24:00', pause: 0, arbeitszeit: 2 });
    assert.deepEqual(tag(a, '2027-01-09'), { datum: '2027-01-09', ...leer, offen: true }, 'Samstag ohne IST offen');
    assert.deepEqual(tag(a, '2027-01-10'), { datum: '2027-01-10', ...leer }, 'Sonntag geschlossen, nie offen');

    assert.deepEqual(a.wochen, [
      { montag: '2026-12-28', kw: 53, jahr: 2026, soll: 37.5, ist: 0, abwesend: 0, feiertag: 6.25, diff: -31.25,
        saldo_nach: -3.5, abgeschlossen: false, vor_ist_start: true },
      { montag: '2027-01-04', kw: 1, jahr: 2027, soll: 37.5, ist: 10, abwesend: 6.25, feiertag: 6.25, diff: -15,
        saldo_nach: -1.5, abgeschlossen: false, vor_ist_start: false },
    ]);
    // Arbeitszeit der Tage = IST der Woche (dieselbe Rechnung pep.arbeitsstunden)
    const summe = a.tage.filter((x) => x.datum >= '2027-01-04').reduce((n, x) => n + (x.arbeitszeit ?? 0), 0);
    assert.equal(summe, a.wochen[1].ist);
  });

  test('leer bestätigter Tag: Arbeitszeit 0; Teil-Abwesenheit neben IST', async () => {
    const [b] = (await blatt(ben2, '2027-01-04', '2027-01-05')).mitarbeiter;
    assert.deepEqual(tag(b, '2027-01-04'), { datum: '2027-01-04', ...leer, pause: 0, arbeitszeit: 0 });
    assert.deepEqual(tag(b, '2027-01-05'), { datum: '2027-01-05', ...leer,
      anwesend_von: '10:00', anwesend_bis: '14:00', pause: 0, abwesend: { code: 'KM', stunden: 2 }, arbeitszeit: 4 });
    assert.equal(b.wochen.length, 1);
    assert.equal(b.wochen[0].soll, 20);
  });

  test('NULL = alle aktiven mit Vertrag im Zeitraum; ausdrücklich gewählt auch inaktiv; Stellvertretung darf', async () => {
    const r = await blatt(null, '2027-01-01', '2027-01-10');
    assert.deepEqual(r.mitarbeiter.map((m) => m.id), [anna2, ben2],
      'ohne Inaktive, ohne Vertrag erst nach dem Zeitraum, ohne Ausgetretene');
    const c = await blatt(cem2, '2027-01-04', '2027-01-04');
    assert.deepEqual(c.mitarbeiter.map((m) => m.id), [cem2]);
    assert.deepEqual(await blatt(null, '2027-01-01', '2027-01-10', s.stellv), r);
  });

  test('Zeitraum: 62 Tage gehen, 63 → ZEITRAUM_ZU_LANG; bis vor von → ZEITRAUM_UNGUELTIG; ohne Datum → DATUM_UNGUELTIG', async () => {
    const r = await blatt(anna2, '2026-11-10', '2027-01-10');
    assert.equal(r.mitarbeiter[0].tage.length, 62);
    assert.equal(r.mitarbeiter[0].wochen[0].montag, '2026-11-09', 'Wochen, die der Zeitraum berührt, ganz');
    assert.equal(r.mitarbeiter[0].wochen.length, 9);
    await wirft(blatt(anna2, '2026-11-09', '2027-01-10'), 'ZEITRAUM_ZU_LANG');
    await wirft(blatt(null, '2027-01-10', '2027-01-09'), 'ZEITRAUM_UNGUELTIG');
    await wirft(blatt(null, null, '2027-01-09'), 'DATUM_UNGUELTIG');
    await wirft(blatt(null, '2027-01-09', null), 'DATUM_UNGUELTIG');
  });

  test('fremde Filiale: fremder Mitarbeiter → MITARBEITER_NICHT_GEFUNDEN, NULL zeigt nur die eigenen', async () => {
    await wirft(blatt(fremd2, '2027-01-04', '2027-01-10'), 'MITARBEITER_NICHT_GEFUNDEN');
    await wirft(blatt(anna2, '2027-01-04', '2027-01-10', chef3), 'MITARBEITER_NICHT_GEFUNDEN');
    const r = await blatt(null, '2027-01-04', '2027-01-10', chef3);
    assert.deepEqual(r.mitarbeiter.map((m) => m.id), [fremd2]);
  });
});

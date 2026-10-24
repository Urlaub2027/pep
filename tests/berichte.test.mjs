// Berichte: public.pep_resturlaub (Ausdruck „Resturlaub“, Spec 13). Heute = Mo 02.11.2026.
// Urlaub = Stunden des Codes U im Kalenderjahr; rest = anspruch + rest_vorjahr − genehmigt wie die Urlaubsübersicht
// im Reiter Abwesenheiten (pep_abwesenheiten → urlaub).
import { test, before } from 'node:test';
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

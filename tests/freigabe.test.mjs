// Wochenfreigabe (Stufe 3, Task 3): pep_woche_freigeben, „zuletzt geändert“ per Auslöser, freigabe in der Wochenantwort.
// Testwoche KW 46/2026 (Mo 09.11.–So 15.11.), Nachbarwoche KW 47, heute Mo 02.11.2026.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, planGrundlage, registriereMitarbeiter } from './helfer.mjs';

let db, g, leitung, stellv, code, json, ma, malen, anna;

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);
const freigeben = (jahr, kw, frei, nutzer = leitung) =>
  json(nutzer, 'select public.pep_woche_freigeben($1, $2, $3) as r', [jahr, kw, frei]);
const woche = (jahr = 2026, kw = 46, nutzer = leitung) =>
  json(nutzer, 'select public.pep_einsatzplan_woche($1, $2) as r', [jahr, kw]);
const zeile = async (montag) => (await db.query(
  'select * from pep.wochen_freigaben where montag = $1::date', [montag])).rows[0];
// Setzt den Vermerk zurück, damit der nächste Schritt für sich beobachtet wird.
const zuruecksetzen = (montag) => db.query(
  'update pep.wochen_freigaben set zuletzt_geaendert = null where montag = $1::date', [montag]);
const geaendert = async (montag) => (await zeile(montag)).zuletzt_geaendert !== null;
const protokollAnzahl = async (aktion) => (await db.query(
  'select count(*)::int as n from pep.protokoll where aktion = $1', [aktion])).rows[0].n;
const kommentar = (maId, datum, text) =>
  als(db, 'authenticated', leitung, 'select public.pep_kommentar_setzen($1, $2::date, $3)', [maId, datum, text]);

before(async () => {
  db = await neueDatenbank();
  g = await planGrundlage(db);
  ({ leitung, stellv, code, json, ma, malen } = g);
  anna = await ma('Test, Anna');
});

test('freigeben: Leitung und Stellvertretung, Antwort {am, von_name}, Protokoll, zweites Mal ändert nichts', async () => {
  const f = await freigeben(2026, 46, true);
  assert.deepEqual(Object.keys(f).sort(), ['am', 'von_name']);
  assert.equal(f.von_name, 'chef');
  const z = await zeile('2026-11-09');
  assert.equal(z.freigegeben_am.toISOString(), new Date(f.am).toISOString());
  assert.equal(z.zuletzt_geaendert, null);
  // Schon freigegeben: bleibt, wie sie ist (kein neuer Name, kein neues Protokoll)
  assert.deepEqual(await freigeben(2026, 46, true, stellv), f);
  assert.equal(await protokollAnzahl('woche_freigeben'), 1);

  const f2 = await freigeben(2026, 47, true, stellv);
  assert.equal(f2.von_name, 'vize');
});

test('zurücknehmen: Zeile weg, Antwort null, Protokoll; erneut zurücknehmen ist still', async () => {
  assert.equal(await freigeben(2026, 47, false), null);
  assert.equal(await zeile('2026-11-16'), undefined);
  assert.equal(await protokollAnzahl('woche_zuruecknehmen'), 1);
  assert.equal(await freigeben(2026, 47, false, stellv), null);
  assert.equal(await protokollAnzahl('woche_zuruecknehmen'), 1);
});

test('ungültige Woche → DATUM_UNGUELTIG, p_frei null → WERT_UNGUELTIG', async () => {
  await wirft(freigeben(2027, 53, true), 'DATUM_UNGUELTIG'); // 2027 hat keine KW 53
  await wirft(freigeben(2026, 0, true), 'DATUM_UNGUELTIG');
  await wirft(json(leitung, 'select public.pep_woche_freigeben(2026, 46, null) as r'), 'WERT_UNGUELTIG');
});

test('Mitarbeiter-Konto → KEIN_ZUGRIFF, nichts freigegeben', async () => {
  await json(leitung, 'select public.pep_datenschutz_speichern($1) as r', ['Datenschutzhinweis (Entwurf)']);
  const { code: einl } = await json(leitung, 'select public.pep_zugang_einladen($1) as r', [anna]);
  const u = await registriereMitarbeiter(db, 'anna', einl);
  await wirft(freigeben(2026, 48, true, u), 'KEIN_ZUGRIFF');
  assert.equal(await zeile('2026-11-23'), undefined);
});

test('zuletzt_geaendert: Block einfügen und löschen, Kommentar, Abwesenheit – nur in der freigegebenen Woche', async () => {
  await zuruecksetzen('2026-11-09');
  assert.equal(await geaendert('2026-11-09'), false);

  await malen(leitung, anna, '2026-11-10', '08:00', '12:00', 'KA');
  assert.equal(await geaendert('2026-11-09'), true, 'Block einfügen');

  await zuruecksetzen('2026-11-09');
  await malen(leitung, anna, '2026-11-10', '08:00', '12:00', null);
  assert.equal(await geaendert('2026-11-09'), true, 'Block löschen');

  await zuruecksetzen('2026-11-09');
  await kommentar(anna, '2026-11-11', 'Test');
  assert.equal(await geaendert('2026-11-09'), true, 'Kommentar einfügen');
  await zuruecksetzen('2026-11-09');
  await kommentar(anna, '2026-11-11', 'Neu');
  assert.equal(await geaendert('2026-11-09'), true, 'Kommentar ändern');
  await zuruecksetzen('2026-11-09');
  await kommentar(anna, '2026-11-11', null);
  assert.equal(await geaendert('2026-11-09'), true, 'Kommentar löschen');

  await zuruecksetzen('2026-11-09');
  await als(db, 'authenticated', leitung,
    `select public.pep_abwesenheit_setzen($1, $2, '2026-11-12'::date, '2026-11-12'::date, null, null, null, null)`,
    [anna, Object.values(code)[0]]);
  assert.equal(await geaendert('2026-11-09'), true, 'Abwesenheit eintragen');

  // Nicht freigegebene Woche: es entsteht keine Zeile
  await malen(leitung, anna, '2026-11-24', '08:00', '12:00', 'KA'); // KW 48
  assert.equal(await zeile('2026-11-23'), undefined);
  // Andere Woche der Filiale berührt die freigegebene nicht (KW 47 ist zurückgenommen)
  await zuruecksetzen('2026-11-09');
  await malen(leitung, anna, '2026-11-17', '08:00', '12:00', 'KA');
  assert.equal(await geaendert('2026-11-09'), false);
});

test('Block auf anderen Tag verschoben: alte und neue Woche gelten als geändert', async () => {
  await freigeben(2026, 47, true);
  await malen(leitung, anna, '2026-11-10', '14:00', '16:00', 'KA'); // KW 46
  await zuruecksetzen('2026-11-09');
  await zuruecksetzen('2026-11-16');
  await db.query(`update pep.plan_bloecke set datum = '2026-11-17' where mitarbeiter_id = $1 and datum = '2026-11-10'`, [anna]);
  assert.equal(await geaendert('2026-11-09'), true, 'alte Woche');
  assert.equal(await geaendert('2026-11-16'), true, 'neue Woche');
});

test('beim Einspielen einer Sicherung läuft der Auslöser nicht', async () => {
  await zuruecksetzen('2026-11-09');
  await db.exec(`select set_config('pep.einspielen', '1', false)`);
  try {
    await db.query(`insert into pep.plan_kommentare (filiale_id, mitarbeiter_id, datum, text)
                    values ($1, $2, '2026-11-13', 'Eingespielt')`, [g.fil, anna]);
  } finally {
    await db.exec(`select set_config('pep.einspielen', '', false)`);
  }
  assert.equal(await geaendert('2026-11-09'), false);
});

test('pep_einsatzplan_woche liefert freigabe (null ohne Freigabe)', async () => {
  const w = await woche(2026, 46);
  assert.deepEqual(Object.keys(w.freigabe).sort(), ['am', 'von_name']);
  assert.equal(w.freigabe.von_name, 'chef');
  assert.equal((await woche(2026, 48)).freigabe, null);
  await freigeben(2026, 46, false);
  assert.equal((await woche(2026, 46)).freigabe, null);
});

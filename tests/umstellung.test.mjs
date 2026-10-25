// Umstellung: eine Stufe-0-Datenbank mit Daten verträgt das aktuelle Schema (zweimal ausgeführt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { neueDatenbank, als, pepBenutzer, filiale, heuteSetzen, SCHEMA } from './helfer.mjs';

const STUFE_0 = readFileSync(new URL('./fixtures/pep-schema-stufe-0.sql', import.meta.url), 'utf8');
const STUFE_1 = readFileSync(new URL('./fixtures/pep-schema-stufe-1.sql', import.meta.url), 'utf8');

test('Stufe-0-Datenbank mit Daten → aktuelles Schema zweimal: Daten bleiben, KA/VP haben Bedeutung, neue Tabellen da', async () => {
  const db = await neueDatenbank({ schema: false });
  await db.exec(STUFE_0);
  const leitung = await pepBenutzer(db, 'chef');
  await filiale(db, leitung);
  const json = async (sql, params = []) => (await als(db, 'authenticated', leitung, sql, params))[0].r;
  const ma = await json(`select public.pep_mitarbeiter_speichern(null, '{"name":"Test, Anna"}') as r`);
  await json(`select public.pep_vertrag_speichern($1, '{"vertragsart":"vollzeit","wochenstunden":37.5,"gueltig_ab":"2026-01-01"}') as r`, [ma]);
  const e = await json('select public.pep_einstellungen() as r');
  const urlaub = e.codes.find((c) => c.code === 'U').id;
  await json(`select public.pep_abwesenheit_setzen($1, $2, '2026-11-10', '2026-11-10', null, null, null, null) as r`, [ma, urlaub]);

  const lesen = async (tabelle) => (await db.query(`select * from pep.${tabelle} order by id`)).rows;
  const mitarbeiterVorher = await lesen('mitarbeiter');
  const abwesenheitenVorher = await lesen('abwesenheiten');

  await db.exec(SCHEMA);
  await db.exec(SCHEMA);

  const mitarbeiterNachher = await lesen('mitarbeiter');
  const abwesenheitenNachher = await lesen('abwesenheiten');
  const bedeutungen = Object.fromEntries((await db.query(
    'select kuerzel, bedeutung from pep.bereiche where bedeutung is not null order by kuerzel')).rows
    .map((r) => [r.kuerzel, r.bedeutung]));
  const tabellen = (await db.query(
    "select table_name from information_schema.tables where table_schema = 'pep'")).rows.map((r) => r.table_name);

  assert.equal(mitarbeiterVorher.length, 1);
  assert.equal(abwesenheitenVorher.length, 1);
  assert.deepEqual(mitarbeiterNachher, mitarbeiterVorher);
  assert.deepEqual(abwesenheitenNachher, abwesenheitenVorher);
  assert.deepEqual(bedeutungen, { KA: 'kasse', VP: 'vp' });
  for (const t of ['plan_bloecke', 'plan_kommentare', 'wochen', 'vorlagen']) assert.ok(tabellen.includes(t), t);
});

test('Stufe-1-Datenbank mit Planblöcken → neues Schema zweimal: Daten bleiben, ZA.gutschrift = false, U.gutschrift = true', async () => {
  const db = await neueDatenbank({ schema: false });
  await db.exec(STUFE_1);
  await heuteSetzen(db, '2026-11-02');
  const leitung = await pepBenutzer(db, 'chef');
  const fil = await filiale(db, leitung);
  const json = async (sql, params = []) => (await als(db, 'authenticated', leitung, sql, params))[0].r;
  const ma = await json(`select public.pep_mitarbeiter_speichern(null, '{"name":"Test, Anna"}') as r`);
  await json(`select public.pep_vertrag_speichern($1, '{"vertragsart":"vollzeit","wochenstunden":37.5,"gueltig_ab":"2026-01-01"}') as r`, [ma]);
  const e = await json('select public.pep_einstellungen() as r');
  const og = e.bereiche.find((b) => b.kuerzel === 'OG').id;
  const urlaub = e.codes.find((c) => c.code === 'U').id;
  await json(`select public.pep_plan_malen($1, '2026-11-09', '08:00', '12:00', $2) as r`, [ma, og]);
  await json(`select public.pep_abwesenheit_setzen($1, $2, '2026-11-10', '2026-11-10', null, null, null, null) as r`, [ma, urlaub]);

  const lesen = async (tabelle) => (await db.query(`select * from pep.${tabelle} order by id`)).rows;
  const vorher = {};
  for (const t of ['mitarbeiter', 'vertraege', 'plan_bloecke', 'abwesenheiten']) vorher[t] = await lesen(t);
  assert.equal(vorher.plan_bloecke.length, 1);
  const planWoche = () => json('select public.pep_einsatzplan_woche(2026, 46) as r');
  const wocheVorher = await planWoche();

  await db.exec(SCHEMA);
  await db.exec(SCHEMA);

  for (const t of Object.keys(vorher)) assert.deepEqual(await lesen(t), vorher[t], t);
  // Plan-Antwort unverändert (pep_einsatzplan_woche läuft jetzt über pep.woche_antwort), bis auf das neue Feld ist_ab:
  // die bestehende Filiale bekommt beim Einspielen den Montag der laufenden Woche als Start der IST-Erfassung.
  const { ist_ab: istAb, ...wocheNachher } = await planWoche();
  assert.deepEqual(wocheNachher, wocheVorher);
  assert.equal(istAb, '2026-11-02');
  const istAbWert = async () => (await db.query(
    "select wert #>> '{}' as w from pep.einstellungen where filiale_id = $1 and schluessel = 'ist_ab'", [fil])).rows[0].w;
  // Ein von der Leitung geänderter Start übersteht weitere Schema-Läufe, auch in einer späteren Woche.
  await json(`select public.pep_einstellung_setzen('ist_ab', '"2026-10-26"'::jsonb) as r`);
  await heuteSetzen(db, '2026-11-18');
  try {
    await db.exec(SCHEMA);
    await db.exec(SCHEMA);
    assert.equal(await istAbWert(), '2026-10-26');
  } finally {
    await heuteSetzen(db, '2026-11-02');
  }
  const gutschrift = async () => Object.fromEntries((await db.query(
    'select code, gutschrift from pep.abwesenheitscodes where filiale_id = $1', [fil])).rows.map((r) => [r.code, r.gutschrift]));
  const g = await gutschrift();
  assert.equal(g.ZA, false);
  for (const c of ['U', 'KM', 'BS', 'AF', 'BV', 'FT', 'NV', 'T']) assert.equal(g[c], true, c);
  const tabellen = (await db.query(
    "select table_name from information_schema.tables where table_schema = 'pep'")).rows.map((r) => r.table_name);
  for (const t of ['ist_bloecke', 'ist_tage']) assert.ok(tabellen.includes(t), t);

  // Eine spätere Änderung der Leitung (ZA doch mit Gutschrift) übersteht weitere Schema-Läufe.
  await db.query("update pep.abwesenheitscodes set gutschrift = true where filiale_id = $1 and code = 'ZA'", [fil]);
  await db.exec(SCHEMA);
  assert.equal((await gutschrift()).ZA, true);
  // Eine nach der Umstellung angelegte Filiale bekommt ZA gleich ohne Gutschrift.
  const fil2 = await filiale(db, await pepBenutzer(db, 'chef2'), { name: 'Filiale Zwei', nummer: '9002' });
  const za2 = (await db.query("select gutschrift from pep.abwesenheitscodes where filiale_id = $1 and code = 'ZA'", [fil2])).rows[0];
  assert.equal(za2.gutschrift, false);
});

test('MoPro-Farbe: altes Grau #F5F5F5 (auch klein geschrieben) wird beim Schema-Lauf Rosa, eigene Farbe bleibt', async () => {
  const db = await neueDatenbank();
  const filialen = [];
  for (const [name, nummer] of [['Filiale A', '9001'], ['Filiale B', '9002'], ['Filiale C', '9003']]) {
    filialen.push(await filiale(db, await pepBenutzer(db, `leitung${nummer}`), { name, nummer }));
  }
  const mo = async (f) => (await db.query("select farbe from pep.bereiche where filiale_id = $1 and kuerzel = 'MO'", [f])).rows[0].farbe;
  assert.equal(await mo(filialen[0]), '#F7C6DA', 'neue Filiale bekommt gleich die neue Farbe');
  // Stand vor dem Update: Startfarbe Grau; Einstellungen speichern Farben aus <input type=color> klein geschrieben.
  await db.query("update pep.bereiche set farbe = '#F5F5F5' where filiale_id = $1 and kuerzel = 'MO'", [filialen[0]]);
  await db.query("update pep.bereiche set farbe = '#f5f5f5' where filiale_id = $1 and kuerzel = 'MO'", [filialen[1]]);
  await db.query("update pep.bereiche set farbe = '#336699' where filiale_id = $1 and kuerzel = 'MO'", [filialen[2]]);
  // Ein anderer Bereich mit #F5F5F5 bleibt, wie er ist.
  await db.query("update pep.bereiche set farbe = '#F5F5F5' where filiale_id = $1 and kuerzel = 'RE'", [filialen[0]]);

  await db.exec(SCHEMA);
  await db.exec(SCHEMA);

  assert.equal(await mo(filialen[0]), '#F7C6DA');
  assert.equal(await mo(filialen[1]), '#F7C6DA');
  assert.equal(await mo(filialen[2]), '#336699', 'von der Leitung gewählte Farbe bleibt');
  const re = (await db.query("select farbe from pep.bereiche where filiale_id = $1 and kuerzel = 'RE'", [filialen[0]])).rows[0].farbe;
  assert.equal(re, '#F5F5F5', 'nur MoPro wird umgefärbt');
});

test('benutzer.bestaetigt_am: beim ersten Schema-Lauf gelten vorhandene Benutzer als angemeldet, später angelegte nicht', async () => {
  const db = await neueDatenbank({ schema: false });
  await db.exec(STUFE_1);
  const chef = await pepBenutzer(db, 'chef');
  const fil = await filiale(db, chef);
  const vize = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  await db.exec(SCHEMA);
  const am = async (u) => (await db.query('select bestaetigt_am from pep.benutzer where user_id = $1', [u])).rows[0].bestaetigt_am;
  assert.ok((await am(chef)) instanceof Date);
  assert.ok((await am(vize)) instanceof Date);
  // Nach der Umstellung eingetragen: nicht bestätigt, auch nicht durch einen weiteren Schema-Lauf
  const neu = await pepBenutzer(db, 'neu', 'leitung', fil);
  await db.exec(SCHEMA);
  assert.equal(await am(neu), null);
});

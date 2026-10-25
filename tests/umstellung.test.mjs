// Umstellung: eine Stufe-0-Datenbank mit Daten verträgt das aktuelle Schema (zweimal ausgeführt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { neueDatenbank, als, pepBenutzer, filiale, SCHEMA } from './helfer.mjs';

const STUFE_0 = readFileSync(new URL('./fixtures/pep-schema-stufe-0.sql', import.meta.url), 'utf8');

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

test('MoPro-Farbe: altes Grau #F5F5F5 (auch klein geschrieben) wird beim Schema-Lauf Creme, eigene Farbe bleibt', async () => {
  const db = await neueDatenbank();
  const filialen = [];
  for (const [name, nummer] of [['Filiale A', '9001'], ['Filiale B', '9002'], ['Filiale C', '9003']]) {
    filialen.push(await filiale(db, await pepBenutzer(db, `leitung${nummer}`), { name, nummer }));
  }
  const mo = async (f) => (await db.query("select farbe from pep.bereiche where filiale_id = $1 and kuerzel = 'MO'", [f])).rows[0].farbe;
  assert.equal(await mo(filialen[0]), '#FEEFB3', 'neue Filiale bekommt gleich die neue Farbe');
  // Stand vor dem Update: Startfarbe Grau; Einstellungen speichern Farben aus <input type=color> klein geschrieben.
  await db.query("update pep.bereiche set farbe = '#F5F5F5' where filiale_id = $1 and kuerzel = 'MO'", [filialen[0]]);
  await db.query("update pep.bereiche set farbe = '#f5f5f5' where filiale_id = $1 and kuerzel = 'MO'", [filialen[1]]);
  await db.query("update pep.bereiche set farbe = '#336699' where filiale_id = $1 and kuerzel = 'MO'", [filialen[2]]);
  // Ein anderer Bereich mit #F5F5F5 bleibt, wie er ist.
  await db.query("update pep.bereiche set farbe = '#F5F5F5' where filiale_id = $1 and kuerzel = 'RE'", [filialen[0]]);

  await db.exec(SCHEMA);
  await db.exec(SCHEMA);

  assert.equal(await mo(filialen[0]), '#FEEFB3');
  assert.equal(await mo(filialen[1]), '#FEEFB3');
  assert.equal(await mo(filialen[2]), '#336699', 'von der Leitung gewählte Farbe bleibt');
  const re = (await db.query("select farbe from pep.bereiche where filiale_id = $1 and kuerzel = 'RE'", [filialen[0]])).rows[0].farbe;
  assert.equal(re, '#F5F5F5', 'nur MoPro wird umgefärbt');
});

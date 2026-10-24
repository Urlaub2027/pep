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

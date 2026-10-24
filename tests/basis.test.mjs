import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, browser, organisator, pepBenutzer, filiale } from './helfer.mjs';

let db;
before(async () => { db = await neueDatenbank(); });

test('Schema zweimal ausführen ist unschädlich und erzeugt keine Überladungen', async () => {
  // neueDatenbank() hat das Schema bereits zweimal geladen
  const r = await db.query(`select proname, count(*)::int as n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and proname like 'pep\_%' group by proname having count(*) > 1`);
  assert.deepEqual(r.rows, []);
});

test('ohne pep.benutzer-Zeile: KEIN_ZUGRIFF', async () => {
  const fremd = await organisator(db, 'fremd');
  await assert.rejects(als(db, 'authenticated', fremd, 'select public.pep_ich()'), /KEIN_ZUGRIFF/);
});

test('gesperrter Organisator: KEIN_ZUGRIFF', async () => {
  const g = await pepBenutzer(db, 'gesperrt1');
  await db.query('update urlaub.organisatoren set gesperrt = true where user_id = $1', [g]);
  await assert.rejects(als(db, 'authenticated', g, 'select public.pep_ich()'), /KEIN_ZUGRIFF/);
});

test('anon darf pep_ich nicht aufrufen', async () => {
  await assert.rejects(browser(db, 'select public.pep_ich()'), /permission denied|KEIN_ZUGRIFF/);
});

test('pep_ich ohne Filiale liefert filiale null', async () => {
  const leitung = await pepBenutzer(db, 'chef');
  const r = (await als(db, 'authenticated', leitung, 'select public.pep_ich() as r'))[0].r;
  assert.equal(r.rolle, 'leitung');
  assert.equal(r.benutzername, 'chef');
  assert.equal(r.filiale, null);
});

test('pep_filiale_anlegen setzt Filiale, zweiter Aufruf FILIALE_VORHANDEN', async () => {
  const leitung = await pepBenutzer(db, 'chef2');
  const f = (await als(db, 'authenticated', leitung,
    "select public.pep_filiale_anlegen('Netto Aschaffenburg', '2558', 'BY') as r"))[0].r;
  assert.equal(f.bundesland, 'BY');
  assert.equal((await als(db, 'authenticated', leitung, 'select public.pep_ich() as r'))[0].r.filiale.id, f.id);
  await assert.rejects(als(db, 'authenticated', leitung,
    "select public.pep_filiale_anlegen('X', '1', 'BY')"), /FILIALE_VORHANDEN/);
});

test('Stellvertretung darf keine Filiale anlegen: NUR_LEITUNG', async () => {
  const leitung = await pepBenutzer(db, 'chef3');
  const fil = await filiale(db, leitung);
  const vize = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  await assert.rejects(als(db, 'authenticated', vize,
    "select public.pep_filiale_anlegen('X', '1', 'BY')"), /NUR_LEITUNG/);
});

test('BUNDESLAND_UNGUELTIG und NAME_LEER', async () => {
  const leitung = await pepBenutzer(db, 'chef4');
  await assert.rejects(als(db, 'authenticated', leitung,
    "select public.pep_filiale_anlegen('Netto', '1', 'XX')"), /BUNDESLAND_UNGUELTIG/);
  await assert.rejects(als(db, 'authenticated', leitung,
    "select public.pep_filiale_anlegen(E'  \t ', '1', 'BY')"), /NAME_LEER/);
});

test('Filiale anlegen schreibt Protokoll', async () => {
  const leitung = await pepBenutzer(db, 'chef5');
  const fil = await filiale(db, leitung, { name: 'Protokolltest', nummer: '9999' });
  const p = (await db.query("select * from pep.protokoll where tabelle = 'filialen' and filiale_id = $1", [fil])).rows;
  assert.equal(p.length, 1);
  assert.equal(p[0].aktion, 'anlegen');
  assert.equal(p[0].user_id, leitung);
});

test('pep.heute() liefert Datum in Europe/Berlin', async () => {
  const r = (await db.query("select pep.heute() = (now() at time zone 'Europe/Berlin')::date as ok")).rows[0];
  assert.equal(r.ok, true);
});

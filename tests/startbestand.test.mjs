// Startbestand und Schulferien: die Startdatei mit echten Namen liegt in privat/
// (gitignored) und fehlt in fremden Checkouts - dann wird ihr Test übersprungen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { neueDatenbank, pepBenutzer, filiale } from './helfer.mjs';

const STAMM_PFAD = new URL('../privat/stammdaten-aschaffenburg.sql', import.meta.url);
const FERIEN = readFileSync(new URL('../supabase/schulferien-BY.sql', import.meta.url), 'utf8');
const stammVorhanden = existsSync(STAMM_PFAD);

async function mitFiliale() {
  const db = await neueDatenbank();
  const leitung = await pepBenutzer(db, 'leitung1');
  const filialeId = await filiale(db, leitung, { nummer: '2558', bundesland: 'BY' });
  return { db, filialeId };
}

const zaehlen = async (db, tabelle) => (await db.query(`select count(*)::int as n from pep.${tabelle}`)).rows[0].n;

test('Startbestand: 19 Mitarbeiter, 2 inaktiv, alle mit Vertrag ab 2026-01-01 und Urlaubsjahr 2027 = wochenstunden × 6',
  { skip: !stammVorhanden && 'privat/stammdaten-aschaffenburg.sql fehlt (nicht im Repo) - Test übersprungen' },
  async () => {
    const { db } = await mitFiliale();
    await db.exec(readFileSync(STAMM_PFAD, 'utf8'));
    assert.equal(await zaehlen(db, 'mitarbeiter'), 19);
    assert.equal((await db.query('select count(*)::int as n from pep.mitarbeiter where not aktiv')).rows[0].n, 2);
    const r = await db.query(`
      select m.id, v.wochenstunden, v.vertragsart, v.gueltig_ab::text as ab, u.anspruch_stunden, u.rest_vorjahr_stunden
      from pep.mitarbeiter m
      left join pep.vertraege v on v.mitarbeiter_id = m.id and v.gueltig_ab = date '2026-01-01'
      left join pep.urlaubsjahre u on u.mitarbeiter_id = m.id and u.jahr = 2027
      where m.personalnummer is null`);
    assert.equal(r.rows.length, 19);
    for (const z of r.rows) {
      assert.equal(z.ab, '2026-01-01');
      assert.equal(Number(z.anspruch_stunden), Number(z.wochenstunden) * 6);
      assert.equal(Number(z.rest_vorjahr_stunden), 0);
      assert.equal(z.vertragsart, Number(z.wochenstunden) === 37.5 ? 'vollzeit' : 'teilzeit');
    }
  });

test('Startbestand zweimal ausführen legt nichts doppelt an',
  { skip: !stammVorhanden && 'privat/stammdaten-aschaffenburg.sql fehlt (nicht im Repo) - Test übersprungen' },
  async () => {
    const { db } = await mitFiliale();
    const sql = readFileSync(STAMM_PFAD, 'utf8');
    await db.exec(sql);
    const vorher = [await zaehlen(db, 'mitarbeiter'), await zaehlen(db, 'vertraege'), await zaehlen(db, 'urlaubsjahre')];
    await db.exec(sql);
    const nachher = [await zaehlen(db, 'mitarbeiter'), await zaehlen(db, 'vertraege'), await zaehlen(db, 'urlaubsjahre')];
    assert.deepEqual(nachher, vorher);
  });

test('Schulferien-Datei: Sommerferien 2027 vorhanden, zweimal ausführen unschädlich', async () => {
  const { db, filialeId } = await mitFiliale();
  await db.exec(FERIEN);
  const n1 = await zaehlen(db, 'schulferien');
  await db.exec(FERIEN);
  assert.equal(await zaehlen(db, 'schulferien'), n1);
  const r = await db.query(
    `select von::text as von, bis::text as bis from pep.schulferien where filiale_id = $1 and name = 'Sommerferien 2027'`,
    [filialeId]);
  assert.deepEqual(r.rows, [{ von: '2027-08-02', bis: '2027-09-13' }]);
});

test('ohne Filiale 2558 → FILIALE_FEHLT', async () => {
  const db = await neueDatenbank();
  await assert.rejects(db.exec(FERIEN), /FILIALE_FEHLT/);
  if (stammVorhanden) await assert.rejects(db.exec(readFileSync(STAMM_PFAD, 'utf8')), /FILIALE_FEHLT/);
});

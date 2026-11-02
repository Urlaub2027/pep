// Logo der Filiale für das Formblatt PEP: liegt in der Datenbank (pep.filialen.logo), nie im öffentlichen Repo.
// Speichern nur Leitung, lesen Leitung und Stellvertretung (beide drucken); nur PNG/JPEG als data-URL, begrenzt.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, planGrundlage } from './helfer.mjs';

let db, leitung, stellv, fil, json;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);
const speichern = (bild, nutzer = leitung) => als(db, 'authenticated', nutzer, 'select public.pep_filiale_logo_speichern($1)', [bild]);
const lesen = (nutzer = leitung) => json(nutzer, 'select public.pep_filiale_logo() as r');

before(async () => {
  db = await neueDatenbank();
  ({ leitung, stellv, fil, json } = await planGrundlage(db));
});

test('Logo: ohne Eintrag null; Leitung speichert PNG, Leitung und Stellvertretung lesen es', async () => {
  assert.equal(await lesen(), null);
  await speichern(PNG);
  assert.equal(await lesen(), PNG);
  assert.equal(await lesen(stellv), PNG);
});

test('Logo: JPEG erlaubt; leer oder null löscht', async () => {
  const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
  await speichern(jpeg);
  assert.equal(await lesen(), jpeg);
  await speichern('');
  assert.equal(await lesen(), null);
  await speichern(PNG);
  await speichern(null);
  assert.equal(await lesen(), null);
});

test('Logo: nur PNG/JPEG als data-URL, höchstens 400.000 Zeichen → sonst BILD_UNGUELTIG', async () => {
  await wirft(speichern('https://example.org/logo.png'), 'BILD_UNGUELTIG');
  await wirft(speichern('data:image/svg+xml;base64,PHN2Zz4='), 'BILD_UNGUELTIG');
  await wirft(speichern('data:image/png;base64,<script>'), 'BILD_UNGUELTIG');
  await wirft(speichern(`data:image/png;base64,${'A'.repeat(400_000)}`), 'BILD_UNGUELTIG');
});

test('Logo: Stellvertretung darf nicht speichern (NUR_LEITUNG); Protokoll ohne das Bild selbst', async () => {
  await wirft(speichern(PNG, stellv), 'NUR_LEITUNG');
  await speichern(PNG);
  const p = (await db.query(`select vorher, nachher from pep.protokoll
    where filiale_id = $1 and tabelle = 'filialen' and aktion = 'logo' order by id desc limit 1`, [fil])).rows[0];
  assert.deepEqual(p.nachher, { logo: true });
});

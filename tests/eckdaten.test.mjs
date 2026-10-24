// Eckdaten-Fenster: public.pep_eckdaten(mitarbeiter, datum) – alles, was die Leitung beim Klick auf einen Namen
// im Einsatzplan sieht. Heute = Mo 02.11.2026; Stichtag meist Mo 16.11.2026 (KW 47), Vorwoche KW 46 (09.–15.11.).
// Alle Tests teilen sich eine Datenbank; jeder legt eigene Mitarbeiter an (die Eckdaten betrachten nur einen).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, planGrundlage } from './helfer.mjs';

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

let t;

before(async () => {
  const db = await neueDatenbank();
  const g = await planGrundlage(db);
  const { leitung, code, json } = g;
  const eck = (maId, datum, nutzer = leitung) =>
    json(nutzer, 'select public.pep_eckdaten($1, $2::date) as r', [maId, datum]);
  const abwesend = (maId, c, von, bis = von, stunden = null, vonZeit = null, bisZeit = null) =>
    json(leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, $5::numeric, $6::time, $7::time, null) as r',
      [maId, code[c], von, bis, stunden, vonZeit, bisZeit]);
  const vorgabe = (maId, daten) =>
    json(leitung, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [maId, JSON.stringify(daten)]);
  t = { db, ...g, eck, abwesend, vorgabe };
});

// Samstage des Jahres von p_datum, die vor p_datum liegen.
const samstageVor = (datum) => {
  let n = 0;
  for (let d = new Date(`${datum.slice(0, 4)}-01-01T00:00:00Z`); d.toISOString().slice(0, 10) < datum; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === 6) n += 1;
  }
  return n;
};

test('Samstage im November: gearbeitet, abwesend (U), frei; frei_jahr zählt nur Samstage vor dem Datum', async () => {
  const a = await t.ma('Test, Anna');
  await t.malen(t.leitung, a, '2026-11-07', '14:00', '21:30', 'KA');
  await t.abwesend(a, 'U', '2026-11-14');
  await t.malen(t.leitung, a, '2026-11-21', '08:00', '14:00', 'KA');
  // 28.11. bleibt ungeplant
  const r = await t.eck(a, '2026-11-16');
  assert.deepEqual(r.samstage.monat, [
    { datum: '2026-11-07', status: 'gearbeitet', code: null },
    { datum: '2026-11-14', status: 'abwesend', code: 'U' },
    { datum: '2026-11-21', status: 'gearbeitet', code: null },
    { datum: '2026-11-28', status: 'frei', code: null }]);
  assert.equal(samstageVor('2026-11-16'), 46);
  // Vor dem 16.11. ist nur der 07.11. gearbeitet; der 21.11. liegt danach und zählt nicht.
  assert.equal(r.samstage.frei_jahr, 45);
  assert.equal(r.samstage.ziel_jahr, 12);
  assert.equal(r.samstage.ziel_monat, 1);
  // Am Samstag selbst zählt er nicht mit, am Tag danach schon.
  assert.equal((await t.eck(a, '2026-11-07')).samstage.frei_jahr, samstageVor('2026-11-07'));
  assert.equal((await t.eck(a, '2026-11-08')).samstage.frei_jahr, samstageVor('2026-11-08') - 1);
});

test('Samstage im Dezember: Krankmeldung über geplantem Samstag → abwesend, Feiertag 26.12. → geschlossen', async () => {
  const b = await t.ma('Test, Bea');
  await t.malen(t.leitung, b, '2026-12-05', '08:00', '14:00', 'KA');
  await t.json(t.leitung, `select public.pep_schnell_abwesend($1, 'KM', '2026-12-05', '2026-12-05') as r`, [b]);
  await t.malen(t.leitung, b, '2026-12-19', '08:00', '14:00', 'KA');
  // Ein Samstag nur mit Pause ist frei (F9)
  await t.malen(t.leitung, b, '2026-12-12', '10:00', '10:30', 'PA');
  const r = await t.eck(b, '2026-12-28');
  assert.deepEqual(r.samstage.monat, [
    { datum: '2026-12-05', status: 'abwesend', code: 'KM' },
    { datum: '2026-12-12', status: 'frei', code: null },
    { datum: '2026-12-19', status: 'gearbeitet', code: null },
    { datum: '2026-12-26', status: 'geschlossen', code: null }]);
  // 2026 hat 52 Samstage; gearbeitet nur der 19.12. (der 05.12. ist unbesetzt)
  assert.equal(r.samstage.frei_jahr, 51);
});

test('Vorwoche mit drei Frühschichten → vorwoche_lage frueh, Hinweis „eher spät planen“; letzter Samstag spät', async () => {
  const c = await t.ma('Test, Cora');
  await t.malen(t.leitung, c, '2026-11-07', '14:00', '21:30', 'KA'); // Samstag KW 45 spät
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11']) await t.malen(t.leitung, c, d, '06:00', '12:00', 'KA');
  await t.malen(t.leitung, c, '2026-11-12', '10:00', '16:00', 'KA'); // mitte
  const r = await t.eck(c, '2026-11-16');
  assert.deepEqual(r.vorwoche, [
    { datum: '2026-11-09', lage: 'frueh' }, { datum: '2026-11-10', lage: 'frueh' },
    { datum: '2026-11-11', lage: 'frueh' }, { datum: '2026-11-12', lage: 'mitte' },
    { datum: '2026-11-13', lage: null }, { datum: '2026-11-14', lage: null }, { datum: '2026-11-15', lage: null }]);
  assert.equal(r.vorwoche_lage, 'frueh');
  assert.equal(r.letzter_samstag_spaet, true);
  assert.deepEqual(r.hinweise, [
    'Hatte letzte Woche überwiegend früh – eher spät planen',
    'Letzter gearbeiteter Samstag war spät – nicht wieder spät planen']);
});

test('Vorwoche überwiegend spät, letzter Samstag früh → „eher früh planen“; ohne Blöcke keine Hinweise', async () => {
  const d = await t.ma('Test, Dirk');
  await t.malen(t.leitung, d, '2026-11-07', '14:00', '21:30', 'KA'); // älterer Samstag spät
  for (const x of ['2026-11-09', '2026-11-10']) await t.malen(t.leitung, d, x, '14:00', '21:30', 'KA');
  await t.malen(t.leitung, d, '2026-11-11', '06:00', '21:00', 'KA'); // lang: zählt für beide
  await t.malen(t.leitung, d, '2026-11-14', '06:00', '12:00', 'KA'); // letzter Samstag früh
  const r = await t.eck(d, '2026-11-16');
  assert.equal(r.vorwoche[2].lage, 'lang');
  assert.equal(r.vorwoche_lage, 'spaet');
  assert.equal(r.letzter_samstag_spaet, false);
  assert.deepEqual(r.hinweise, ['Hatte letzte Woche überwiegend spät – eher früh planen']);

  const e = await t.ma('Test, Edda');
  const leer = await t.eck(e, '2026-11-16');
  assert.equal(leer.vorwoche_lage, null);
  assert.equal(leer.letzter_samstag_spaet, false);
  assert.deepEqual(leer.hinweise, []);
  assert.ok(leer.vorwoche.every((v) => v.lage === null));
});

test('nur die am Datum gültigen Vorgaben, Pflicht zuerst', async () => {
  const f = await t.ma('Test, Finn');
  await t.vorgabe(f, { art: 'nicht_verfuegbar', wochentag: 3, gueltig_von: '2026-01-01', gueltig_bis: '2026-11-15', pflicht: true });
  await t.vorgabe(f, { art: 'nicht_verfuegbar', max_stunden_tag: 6, gueltig_von: '2026-01-01', notiz: 'lieber kurze Tage' });
  await t.vorgabe(f, { art: 'nur_zwischen', wochentag: 6, von: '06:00', bis: '14:00', gueltig_von: '2026-11-16', gueltig_bis: '2026-11-16', pflicht: true });
  await t.vorgabe(f, { art: 'nicht_verfuegbar', wochentag: 1, gueltig_von: '2026-11-17', pflicht: true });
  const r = await t.eck(f, '2026-11-16');
  assert.deepEqual(r.vorgaben, [
    { pflicht: true, wochentag: 6, art: 'nur_zwischen', von: '06:00', bis: '14:00', max_stunden_tag: null, max_stunden_woche: null, notiz: null },
    { pflicht: false, wochentag: null, art: 'nicht_verfuegbar', von: null, bis: null, max_stunden_tag: 6, max_stunden_woche: null, notiz: 'lieber kurze Tage' }]);
  assert.equal((await t.eck(f, '2026-11-15')).vorgaben.length, 2); // abgelaufene noch gültig, Pflicht Sa noch nicht
  assert.equal((await t.eck(f, '2026-11-17')).vorgaben.length, 2); // Pflicht Sa vorbei, Montag-Vorgabe neu
});

test('Stammdaten, Abwesenheiten dieser und nächster Woche, Soll/geplant, Kommentar; Stellvertretung darf', async () => {
  const g = await t.ma('Test, Gina', { stunden: 30, art: 'teilzeit', geburtsdatum: '2009-11-20', kompetenzen: ['VP', 'KA'] });
  await t.json(t.leitung, `select public.pep_mitarbeiter_speichern($1, '{"personalnummer":"4711"}') as r`, [g]);
  await t.abwesend(g, 'U', '2026-11-13');                          // Vorwoche: nicht dabei
  await t.abwesend(g, 'ZA', '2026-11-17');                         // 30 / 6 = 5 h
  await t.malen(t.leitung, g, '2026-11-16', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, g, '2026-11-16', '12:00', '12:30', 'PA'); // Pause zählt nicht
  await t.malen(t.leitung, g, '2026-11-16', '12:30', '14:00', 'KA');
  await t.malen(t.leitung, g, '2026-11-19', '08:00', '12:00', 'KA');
  await t.json(t.leitung, `select public.pep_schnell_abwesend($1, 'KM', '2026-11-19', '2026-11-19') as r`, [g]); // Block unbesetzt
  await t.abwesend(g, 'BS', '2026-11-24', '2026-11-24', 5, '08:00', '13:00'); // nächste Woche, Teiltag
  await t.abwesend(g, 'U', '2026-11-30');                          // übernächste Woche: nicht dabei
  await t.json(t.leitung, `select public.pep_kommentar_setzen($1, '2026-11-16', 'Schlüssel holen') as r`, [g]);
  await t.json(t.leitung, `select public.pep_kommentar_setzen($1, '2026-11-17', 'anderer Tag') as r`, [g]);

  const r = await t.eck(g, '2026-11-16');
  assert.deepEqual(r.mitarbeiter, { id: g, name: 'Test, Gina', personalnummer: '4711', alter: 16 });
  assert.deepEqual(r.vertrag, { vertragsart: 'teilzeit', wochenstunden: 30 });
  assert.deepEqual(r.kompetenzen, ['KA', 'VP']); // nach Position der Bereiche
  assert.deepEqual(r.abwesenheiten, [
    { datum: '2026-11-17', code: 'ZA', stunden: 5, von: null, bis: null },
    { datum: '2026-11-19', code: 'KM', stunden: 5, von: null, bis: null },
    { datum: '2026-11-24', code: 'BS', stunden: 5, von: '08:00', bis: '13:00' }]);
  // Soll = 30 − 5 (ZA) − 5 (KM); geplant = 4 + 1,5 (Montag ohne Pause), der Donnerstag ist unbesetzt
  assert.deepEqual(r.woche, { soll: 20, geplant: 5.5 });
  assert.equal(r.kommentar, 'Schlüssel holen');
  assert.equal(r.zeitkonto, null);
  // Am Geburtstag 17 Jahre; Kommentar je Tag
  const geburtstag = await t.eck(g, '2026-11-20');
  assert.equal(geburtstag.mitarbeiter.alter, 17);
  assert.equal(geburtstag.kommentar, null);
  // Die Stellvertretung sieht dasselbe
  assert.deepEqual(await t.eck(g, '2026-11-16', t.stellv), r);
});

test('ohne Vertrag am Datum: vertrag null statt Fehler; späterer Vertrag gilt ab seinem Datum', async () => {
  const h = await t.ma('Test, Hugo', { ab: '2026-12-01' });
  const r = await t.eck(h, '2026-11-16');
  assert.equal(r.vertrag, null);
  assert.deepEqual(r.woche, { soll: null, geplant: 0 });
  assert.deepEqual((await t.eck(h, '2026-12-01')).vertrag, { vertragsart: 'vollzeit', wochenstunden: 37.5 });
  await t.json(t.leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb) as r',
    [h, JSON.stringify({ vertragsart: 'teilzeit', wochenstunden: 20, gueltig_ab: '2027-01-01' })]);
  assert.deepEqual((await t.eck(h, '2026-12-31')).vertrag, { vertragsart: 'vollzeit', wochenstunden: 37.5 });
  assert.deepEqual((await t.eck(h, '2027-01-04')).vertrag, { vertragsart: 'teilzeit', wochenstunden: 20 });
});

test('fremde Filiale → MITARBEITER_NICHT_GEFUNDEN; ohne Datum → DATUM_UNGUELTIG; Rolle mitarbeiter und Leitung ohne Filiale nicht', async () => {
  const eigene = await t.ma('Test, Ida');
  const fremdeLeitung = await pepBenutzer(t.db, 'chef2');
  await filiale(t.db, fremdeLeitung, { name: 'Netto Testdorf', nummer: '9999' });
  const fremd = (await als(t.db, 'authenticated', fremdeLeitung,
    `select public.pep_mitarbeiter_speichern(null, '{"name":"Test, Fremd"}') as r`))[0].r;
  await wirft(t.eck(fremd, '2026-11-16'), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(t.eck(eigene, null), 'DATUM_UNGUELTIG');
  const azubi = await pepBenutzer(t.db, 'azubi', 'mitarbeiter', t.fil);
  await wirft(t.eck(eigene, '2026-11-16', azubi), 'NUR_LEITUNG');
  const ohne = await pepBenutzer(t.db, 'chefOhne');
  await wirft(t.eck(eigene, '2026-11-16', ohne), 'KEINE_FILIALE');
});

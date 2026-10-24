// Vorausplanung: pep.woche_kennzahlen (Spec 10) über public.pep_vorausplanung und public.pep_woche_speichern.
// Heute = Mo 02.11.2026 (KW 45). Alle Tests teilen sich eine Datenbank, jeder nutzt eigene Wochen.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, planGrundlage } from './helfer.mjs';

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);
const nahe = (ist, soll, text) => assert.ok(Math.abs(ist - soll) < 0.005, `${text}: ${ist} ≠ ${soll}`);

let t, anna, ben, cem, dora;

const speichern = (jahr, kw, daten, nutzer = t.leitung) =>
  t.json(nutzer, 'select public.pep_woche_speichern($1, $2, $3::jsonb) as r', [jahr, kw, JSON.stringify(daten)]);
const vorausplanung = (jahr, kw, nutzer = t.leitung) =>
  t.json(nutzer, 'select public.pep_vorausplanung($1, $2) as r', [jahr, kw]);
const woche = async (jahr, kw) => (await vorausplanung(jahr, kw)).wochen[0];

before(async () => {
  const db = await neueDatenbank();
  t = { db, ...(await planGrundlage(db)) };
  anna = await t.ma('Test, Anna', { stunden: 37.5 });
  ben = await t.ma('Muster, Ben', { stunden: 20, art: 'teilzeit' });
  // Cem tritt am Mittwoch KW 47 ein, Dora scheidet am Sonntag KW 45 aus.
  cem = await t.ma('Beispiel, Cem', { stunden: 30, art: 'teilzeit' });
  await t.json(t.leitung, `select public.pep_mitarbeiter_speichern($1, '{"eintritt":"2026-11-18"}') as r`, [cem]);
  dora = await t.ma('Probe, Dora', { stunden: 10, art: 'minijob', kompetenzen: [] });
  await t.json(t.leitung, `select public.pep_mitarbeiter_speichern($1, '{"austritt":"2026-11-08"}') as r`, [dora]);
});

test('Planumsatz 60 000 bei 200 €/h → soll 300; Quelle planumsatz, Vorgabe = Soll', async () => {
  const w = await speichern(2026, 45, { planumsatz: 60000 });
  assert.equal(w.soll, 300);
  assert.equal(w.stundenleistung, 200);
  assert.equal(w.planumsatz, 60000);
  assert.equal(w.stundenvorgabe, 300);
  assert.equal(w.vorgabe_quelle, 'planumsatz');
  assert.equal(w.stundenvorgabe_manuell, null);
});

test('Planumsatz 60 050 → 300,25 auf halbe Stunden gerundet = 300.5; Wochen-Stundenleistung hat Vorrang', async () => {
  const w = await speichern(2026, 46, { planumsatz: 60050 });
  assert.equal(w.soll, 300.5);
  const v = await speichern(2026, 46, { stundenleistung_eur_pro_h: 250 });
  assert.equal(v.stundenleistung, 250);
  assert.equal(v.soll, 240); // 60 050 / 250 = 240,2 → 240
  assert.equal(v.planumsatz, 60050, 'ein Feld ändern lässt die anderen stehen');
});

test('ohne Planumsatz: soll und Überhang null, Vorgabe = verfügbar, Quelle verfuegbar', async () => {
  const w = await woche(2026, 48);
  assert.equal(w.planumsatz, null);
  assert.equal(w.soll, null);
  assert.equal(w.ueberhang, null);
  assert.equal(w.vertragsstunden, 87.5);
  assert.equal(w.verfuegbar, 87.5);
  assert.equal(w.stundenvorgabe, 87.5);
  assert.equal(w.vorgabe_quelle, 'verfuegbar');
});

test('manuelle Vorgabe 250 hat Vorrang vor dem Soll; Leeren (null) stellt das Soll wieder her', async () => {
  await speichern(2026, 49, { planumsatz: 60000 });
  const m = await speichern(2026, 49, { stundenvorgabe_manuell: 250 });
  assert.equal(m.stundenvorgabe, 250);
  assert.equal(m.vorgabe_quelle, 'manuell');
  assert.equal(m.soll, 300);
  const leer = await speichern(2026, 49, { stundenvorgabe_manuell: null });
  assert.equal(leer.stundenvorgabe, 300);
  assert.equal(leer.vorgabe_quelle, 'planumsatz');
  const ohne = await speichern(2026, 49, { planumsatz: null });
  assert.equal(ohne.planumsatz, null);
  assert.equal(ohne.soll, null);
  assert.equal(ohne.vorgabe_quelle, 'verfuegbar');
  const null0 = await speichern(2026, 49, { stundenvorgabe_manuell: 0 });
  assert.equal(null0.stundenvorgabe, 0, 'Vorgabe 0 ist erlaubt');
  assert.equal(null0.vorgabe_quelle, 'manuell');
});

test('Eintritt am Mittwoch zählt, Austritt in der Vorwoche zählt nicht, Austritt am Sonntag zählt noch', async () => {
  const w45 = await woche(2026, 45);
  const w46 = await woche(2026, 46);
  const w47 = await woche(2026, 47);
  assert.equal(w45.vertragsstunden, 67.5); // Anna 37,5 + Ben 20 + Dora 10; Cem noch nicht eingetreten
  assert.equal(w46.vertragsstunden, 57.5); // Dora seit dem 08.11. ausgetreten
  assert.equal(w47.vertragsstunden, 87.5); // Cem tritt Mi 18.11. ein
});

test('abwesend und davon_urlaub: nur Mitarbeiter der Woche, Urlaub getrennt; verfügbar und Überhang', async () => {
  await t.json(t.leitung, `select public.pep_abwesenheit_setzen($1, $2, '2026-11-16', '2026-11-16', null, null, null, null) as r`, [anna, t.code.U]);
  await t.json(t.leitung, `select public.pep_abwesenheit_setzen($1, $2, '2026-11-17', '2026-11-17', null, null, null, null) as r`, [ben, t.code.KM]);
  // Doras Abwesenheit liegt nach ihrem Austritt in KW 47 und zählt nicht
  await t.db.query(`insert into pep.abwesenheiten (filiale_id, mitarbeiter_id, code_id, datum, stunden, quelle)
    values ($1, $2, $3, '2026-11-18', 2, 'manuell')`, [t.fil, dora, t.code.U]);
  await speichern(2026, 47, { planumsatz: 20000 });
  const w = await woche(2026, 47);
  nahe(w.abwesend, 6.25 + 3.33, 'abwesend');
  assert.equal(w.davon_urlaub, 6.25);
  nahe(w.verfuegbar, 87.5 - 9.58, 'verfuegbar');
  assert.equal(w.soll, 100);
  nahe(w.ueberhang, 87.5 - 9.58 - 100, 'ueberhang');
  assert.ok(w.ueberhang < 0);
});

test('sechs Wochen ab KW 52/2026: 52, 53, 1, 2, 3, 4 über den Jahreswechsel', async () => {
  const r = await vorausplanung(2026, 52);
  assert.equal(r.wochen.length, 6);
  assert.deepEqual(r.wochen.map((w) => w.kw), [52, 53, 1, 2, 3, 4]);
  assert.deepEqual(r.wochen.map((w) => w.jahr), [2026, 2026, 2027, 2027, 2027, 2027]);
  assert.deepEqual(r.wochen.map((w) => w.montag),
    ['2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25']);
});

test('ungültige Werte: negativ, 0 (Planumsatz, Leistung), Text, zu groß → WERT_UNGUELTIG; ungültige KW → DATUM_UNGUELTIG', async () => {
  await wirft(speichern(2026, 50, { planumsatz: -1 }), 'WERT_UNGUELTIG');
  await wirft(speichern(2026, 50, { planumsatz: 0 }), 'WERT_UNGUELTIG');
  await wirft(speichern(2026, 50, { stundenleistung_eur_pro_h: 0 }), 'WERT_UNGUELTIG');
  await wirft(speichern(2026, 50, { stundenvorgabe_manuell: -0.5 }), 'WERT_UNGUELTIG');
  await wirft(speichern(2026, 50, { planumsatz: 'viel' }), 'WERT_UNGUELTIG');
  await wirft(speichern(2026, 50, { planumsatz: 1e12 }), 'WERT_UNGUELTIG');
  await wirft(t.json(t.leitung, `select public.pep_woche_speichern(2026, 50, '[1]'::jsonb) as r`), 'WERT_UNGUELTIG');
  await wirft(speichern(2027, 53, { planumsatz: 1000 }), 'DATUM_UNGUELTIG'); // 2027 hat nur 52 Wochen
  await wirft(vorausplanung(2026, 0), 'DATUM_UNGUELTIG');
  const w = await woche(2026, 50);
  assert.equal(w.planumsatz, null, 'nichts gespeichert');
});

test('geplant: nur besetzte Blöcke ohne Pause; unbesetzte Blöcke (Krankmeldung) zählen nicht', async () => {
  // Anna: KA 08:00–12:00, Pause 12:00–12:30, KA 12:30–14:30 → 6 h. Ben: 4 h geplant, dann ganztags krank.
  await t.malen(t.leitung, anna, '2026-12-07', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, anna, '2026-12-07', '12:00', '12:30', 'PA');
  await t.malen(t.leitung, anna, '2026-12-07', '12:30', '14:30', 'KA');
  await t.malen(t.leitung, ben, '2026-12-08', '08:00', '12:00', 'KA');
  await t.json(t.leitung, `select public.pep_abwesenheit_setzen($1, $2, '2026-12-08', '2026-12-08', null, null, null, null) as r`, [ben, t.code.KM]);
  const w = await woche(2026, 50);
  assert.equal(w.geplant, 6);
  assert.equal((await woche(2026, 51)).geplant, 0);
});

test('Stellvertretung darf lesen und speichern; Speichern protokolliert, unverändertes Speichern nicht', async () => {
  const zaehle = async () => (await t.db.query(`select count(*)::int as n from pep.protokoll where tabelle = 'wochen'`)).rows[0].n;
  const vorher = await zaehle();
  const w = await speichern(2027, 3, { planumsatz: 45000 }, t.stellv);
  assert.equal(w.soll, 225);
  await speichern(2027, 3, { planumsatz: 45000 }, t.stellv);
  assert.equal(await zaehle(), vorher + 1);
  assert.equal((await vorausplanung(2027, 3, t.stellv)).wochen[0].planumsatz, 45000);
});

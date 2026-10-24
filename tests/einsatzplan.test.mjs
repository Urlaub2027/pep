// Einsatzplan-Grundlage: Blöcke malen und radieren, Sperren, Zeile setzen, Wochendaten,
// Kommentare, Reihenfolge, Protokoll. Testwoche KW 46/2026 (Mo 09.11.–So 15.11.), heute Mo 02.11.2026.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, planGrundlage } from './helfer.mjs';

let db, g, leitung, stellv, bereich, code, json, ma, malen;
let chef2, vize2, fremdMa, fremdBereich;

const aufruf = (nutzer, sql, params = []) => als(db, 'authenticated', nutzer, sql, params);
const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);
// Blöcke einer Antwort ohne id/datum, auf einen Mitarbeiter beschränkt.
const zeile = (antwort, maId) => antwort.bloecke.filter((b) => b.mitarbeiter_id === maId)
  .map(({ von, bis, bereich_id, unbesetzt }) => ({ von, bis, bereich_id, unbesetzt }));
const blk = (von, bis, k, unbesetzt = false) => ({ von, bis, bereich_id: bereich[k], unbesetzt });
const woche = (jahr = 2026, kw = 46, nutzer = leitung) =>
  json(nutzer, 'select public.pep_einsatzplan_woche($1, $2) as r', [jahr, kw]);
const setzen = (maId, datum, bloecke, nutzer = leitung) =>
  json(nutzer, 'select public.pep_plan_zeile_setzen($1, $2::date, $3::jsonb) as r', [maId, datum, JSON.stringify(bloecke)]);
const abwesend = (maId, c, datum, stunden = null, von = null, bis = null) =>
  json(leitung, `select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, $4::numeric, $5::time, $6::time, null) as r`,
    [maId, code[c], datum, stunden, von, bis]);
const vorgabe = (maId, daten) =>
  json(leitung, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r',
    [maId, JSON.stringify({ gueltig_von: '2026-11-01', ...daten })]);
// Arbeitsstunden (F4) der gespeicherten Zeile.
const stunden = async (maId, datum) => Number((await db.query(
  'select pep.arbeitsstunden($1, $2::date, pep.zeile_lesen($1, $2::date)) as h', [maId, datum])).rows[0].h);
const kommentar = (maId, datum, text, nutzer = leitung) =>
  aufruf(nutzer, 'select public.pep_kommentar_setzen($1, $2::date, $3)', [maId, datum, text]);

before(async () => {
  db = await neueDatenbank();
  g = await planGrundlage(db);
  ({ leitung, stellv, bereich, code, json, ma, malen } = g);
  // Zweite Filiale für Fremdzugriffe und die Reihenfolge
  chef2 = await pepBenutzer(db, 'chef2');
  const fil2 = await filiale(db, chef2, { name: 'Netto Zweitfiliale', nummer: '9999' });
  vize2 = await pepBenutzer(db, 'vize2', 'stellvertretung', fil2);
  fremdMa = await json(chef2, `select public.pep_mitarbeiter_speichern(null, '{"name":"Fremd, Frieda"}') as r`);
  fremdBereich = (await json(chef2, 'select public.pep_bereiche() as r')).find((b) => b.kuerzel === 'KA').id;
});

test('malen KA 08:00–12:00 → ein Block', async () => {
  const a = await ma('Test, Anna');
  const r = await malen(stellv, a, '2026-11-09', '08:00', '12:00', 'KA');
  assert.equal(r.datum, '2026-11-09');
  assert.deepEqual(zeile(r, a), [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA, unbesetzt: false }]);
  assert.deepEqual(r.pruefung, {});
});

test('OG 10:00–11:00 in KA 08–12 → KA 08–10, OG 10–11, KA 11–12', async () => {
  const a = await ma('Test, Olaf', { kompetenzen: ['KA', 'OG'] });
  await malen(leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  const r = await malen(leitung, a, '2026-11-09', '10:00', '11:00', 'OG');
  assert.deepEqual(zeile(r, a), [blk('08:00', '10:00', 'KA'), blk('10:00', '11:00', 'OG'), blk('11:00', '12:00', 'KA')]);
  const n = (await db.query('select count(*)::int as n from pep.plan_bloecke where mitarbeiter_id = $1', [a])).rows[0].n;
  assert.equal(n, 3);
});

test('KA 12:00–14:00 neben KA 08–12 → ein Block 08–14; radieren 10–11 → 08–10 und 11–14', async () => {
  const a = await ma('Test, Karl');
  await malen(leitung, a, '2026-11-10', '08:00', '12:00', 'KA');
  let r = await malen(leitung, a, '2026-11-10', '12:00', '14:00', 'KA');
  assert.deepEqual(zeile(r, a), [blk('08:00', '14:00', 'KA')]);
  r = await malen(leitung, a, '2026-11-10', '10:00', '11:00', null);
  assert.deepEqual(zeile(r, a), [blk('08:00', '10:00', 'KA'), blk('11:00', '14:00', 'KA')]);
  // Radieren über Blockgrenzen hinweg und Übermalen der ganzen Zeile
  r = await malen(leitung, a, '2026-11-10', '09:00', '12:00', null);
  assert.deepEqual(zeile(r, a), [blk('08:00', '09:00', 'KA'), blk('12:00', '14:00', 'KA')]);
  r = await malen(leitung, a, '2026-11-10', '07:00', '15:00', 'PA');
  assert.deepEqual(zeile(r, a), [blk('07:00', '15:00', 'PA')]);
});

test('Pause 12:00–12:30 ohne Kompetenz erlaubt; OG ohne Kompetenz → KOMPETENZ_FEHLT; VP → BEREICH_NICHT_MALBAR', async () => {
  const a = await ma('Test, Paul', { kompetenzen: [] });
  const r = await malen(leitung, a, '2026-11-09', '12:00', '12:30', 'PA');
  assert.deepEqual(zeile(r, a), [blk('12:00', '12:30', 'PA')]);
  await aufruf(leitung, `select public.pep_bereich_speichern($1, '{"kompetenz_noetig":true}')`, [bereich.OG]);
  try {
    await wirft(malen(leitung, a, '2026-11-09', '08:00', '12:00', 'OG'), 'KOMPETENZ_FEHLT');
    await wirft(malen(leitung, a, '2026-11-09', '08:00', '12:00', 'KA'), 'KOMPETENZ_FEHLT');
  } finally {
    await aufruf(leitung, `select public.pep_bereich_speichern($1, '{"kompetenz_noetig":false}')`, [bereich.OG]);
  }
  await wirft(malen(leitung, a, '2026-11-09', '08:00', '12:00', 'VP'), 'BEREICH_NICHT_MALBAR');
  // Ein inaktiver Bereich (PO) gilt als nicht vorhanden
  await wirft(malen(leitung, a, '2026-11-09', '08:00', '12:00', 'PO'), 'BEREICH_NICHT_GEFUNDEN');
});

test('05:30 oder bis 22:00 → AUSSERHALB_RAHMEN; So 15.11. → GESCHLOSSEN; 01.11. → VERGANGEN; heute 02.11. erlaubt; 08:15 → HALBE_STUNDE', async () => {
  const a = await ma('Test, Rita');
  await wirft(malen(leitung, a, '2026-11-12', '05:30', '08:00', 'KA'), 'AUSSERHALB_RAHMEN');
  await wirft(malen(leitung, a, '2026-11-12', '20:00', '22:00', 'KA'), 'AUSSERHALB_RAHMEN');
  await wirft(malen(leitung, a, '2026-11-15', '08:00', '12:00', 'KA'), 'GESCHLOSSEN');
  await wirft(malen(leitung, a, '2026-11-01', '08:00', '12:00', 'KA'), 'VERGANGEN');
  await wirft(malen(leitung, a, '2026-11-01', '08:00', '12:00', null), 'VERGANGEN');
  const r = await malen(leitung, a, '2026-11-02', '06:00', '21:30', 'KA');
  assert.deepEqual(zeile(r, a), [blk('06:00', '21:30', 'KA')]);
  await wirft(malen(leitung, a, '2026-11-12', '08:15', '12:00', 'KA'), 'HALBE_STUNDE');
  await wirft(malen(leitung, a, '2026-11-12', '12:00', '08:00', 'KA'), 'ZEITEN_UNGUELTIG');
});

test('U ganztags → malen ABWESEND; vorher geplanter Block wird unbesetzt und lässt sich radieren', async () => {
  const a = await ma('Test, Ute');
  await malen(leitung, a, '2026-11-10', '08:00', '12:00', 'KA');
  await abwesend(a, 'U', '2026-11-10');
  await wirft(malen(leitung, a, '2026-11-10', '14:00', '16:00', 'KA'), 'ABWESEND');
  assert.deepEqual(zeile(await woche(), a), [blk('08:00', '12:00', 'KA', true)]);
  assert.equal(await stunden(a, '2026-11-10'), 0);
  // Unveränderte Zeile wiederherstellen geht; den Bereich eines unbesetzten Blocks wechseln nicht
  await setzen(a, '2026-11-10', [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA }]);
  await wirft(malen(leitung, a, '2026-11-10', '08:00', '12:00', 'PA'), 'ABWESEND');
  const r = await malen(leitung, a, '2026-11-10', '08:00', '12:00', null);
  assert.deepEqual(zeile(r, a), []);
});

// Spätere Änderungen an Stammdaten und Einstellungen blockieren nur, was ein Strich ändert.
test('Kompetenz KA nach Block KA 08–12 entzogen: Pause 12:00–12:30 daneben erlaubt, KA 13–14 → KOMPETENZ_FEHLT', async () => {
  const a = await ma('Test, Kora');
  await malen(leitung, a, '2026-11-12', '08:00', '12:00', 'KA');
  await aufruf(leitung, 'select public.pep_kompetenz_setzen($1, $2, false)', [a, bereich.KA]);
  const r = await malen(leitung, a, '2026-11-12', '12:00', '12:30', 'PA');
  assert.deepEqual(zeile(r, a), [blk('08:00', '12:00', 'KA'), blk('12:00', '12:30', 'PA')]);
  await wirft(malen(leitung, a, '2026-11-12', '13:00', '14:00', 'KA'), 'KOMPETENZ_FEHLT');
  await wirft(malen(leitung, a, '2026-11-12', '07:30', '08:00', 'KA'), 'KOMPETENZ_FEHLT'); // KA-Block wächst
  await setzen(a, '2026-11-12', [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA },
    { von: '12:00', bis: '12:30', bereich_id: bereich.PA }]);
});

test('Rahmen Fr auf bis 18:00 verkürzt nach Block 16–20: 08–10 in der Zeile erlaubt, Verlängern bis 21:00 → AUSSERHALB_RAHMEN', async () => {
  const a = await ma('Test, Rahel');
  await malen(leitung, a, '2026-11-13', '16:00', '20:00', 'KA');
  const rahmen = (bis) => aufruf(leitung, 'select public.pep_rahmen_speichern(5, $1::jsonb)', [JSON.stringify({
    geoeffnet: true, oeffnung_von: '07:00', oeffnung_bis: bis === '21:30' ? '20:00' : bis, rahmen_von: '06:00', rahmen_bis: bis })]);
  await rahmen('18:00');
  try {
    const r = await malen(leitung, a, '2026-11-13', '08:00', '10:00', 'KA');
    assert.deepEqual(zeile(r, a), [blk('08:00', '10:00', 'KA'), blk('16:00', '20:00', 'KA')]);
    await wirft(malen(leitung, a, '2026-11-13', '20:00', '21:00', 'KA'), 'AUSSERHALB_RAHMEN');
    await wirft(malen(leitung, a, '2026-11-13', '18:00', '20:00', 'PA'), 'AUSSERHALB_RAHMEN'); // Bereichswechsel
    await setzen(a, '2026-11-13', [{ von: '08:00', bis: '10:00', bereich_id: bereich.KA },
      { von: '16:00', bis: '20:00', bereich_id: bereich.KA }]);
  } finally {
    await rahmen('21:30');
  }
});

test('Pflicht max_stunden_tag 6 nach 8-h-Zeile angelegt: radieren 1 h erlaubt, +0,5 h → VORGABE_VERLETZT', async () => {
  const a = await ma('Test, Malte');
  await malen(leitung, a, '2026-11-12', '08:00', '16:00', 'KA');
  await vorgabe(a, { pflicht: true, wochentag: 4, art: 'nicht_verfuegbar', max_stunden_tag: 6 });
  await malen(leitung, a, '2026-11-12', '15:00', '16:00', null);
  await wirft(malen(leitung, a, '2026-11-12', '15:00', '15:30', 'KA'), 'VORGABE_VERLETZT');
  // Pause statt Kasse senkt die Stunden (6,5 h, weiter über 6): erlaubt
  const r = await malen(leitung, a, '2026-11-12', '12:00', '12:30', 'PA');
  assert.deepEqual(zeile(r, a), [blk('08:00', '12:00', 'KA'), blk('12:00', '12:30', 'PA'), blk('12:30', '15:00', 'KA')]);
  // Nur Stundengrenze, nicht ganztags gesperrt: an einem anderen Do ist 08–14 erlaubt
  await malen(leitung, a, '2026-11-19', '08:00', '14:00', 'KA');
});

test('pep_plan_zeile_setzen mit unveränderter Zeile scheitert an keiner nachträglichen Sperre', async () => {
  const a = await ma('Test, Doro', { kompetenzen: ['KA', 'OG'] });
  const tag = '2026-11-14';
  const z = [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA }, { von: '12:00', bis: '12:30', bereich_id: bereich.PA },
    { von: '12:30', bis: '16:00', bereich_id: bereich.OG }];
  await setzen(a, tag, z);
  // Danach: Kompetenz KA weg, OG braucht Kompetenz und ist inaktiv, Pflicht nur 08–10, BS 10–12, Sa ganztags nicht verfügbar
  await aufruf(leitung, 'select public.pep_kompetenz_setzen($1, $2, false)', [a, bereich.KA]);
  await vorgabe(a, { pflicht: true, wochentag: 6, art: 'nur_zwischen', von: '08:00', bis: '10:00' });
  await vorgabe(a, { pflicht: true, wochentag: 6, art: 'nicht_verfuegbar' });
  await abwesend(a, 'BS', tag, 2, '10:00', '12:00');
  await aufruf(leitung, `select public.pep_bereich_speichern($1, '{"kompetenz_noetig":true,"aktiv":false}')`, [bereich.OG]);
  try {
    const r = await setzen(a, tag, z);
    assert.deepEqual(zeile(r, a), [blk('08:00', '10:00', 'KA'), blk('10:00', '12:00', 'KA', true),
      blk('12:00', '12:30', 'PA'), blk('12:30', '16:00', 'OG')]);
    // Jede echte Änderung prüft wieder: neue halbe Stunde am ganztags gesperrten Samstag
    await wirft(malen(leitung, a, tag, '16:00', '16:30', 'PA'), 'VORGABE_VERLETZT');
  } finally {
    await aufruf(leitung, `select public.pep_bereich_speichern($1, '{"kompetenz_noetig":false,"aktiv":true}')`, [bereich.OG]);
  }
});

test('BS 08:00–13:00 mit von/bis: 13–18 erlaubt, 12–14 ABWESEND; vorher 09–12 unbesetzt, 14–18 nicht', async () => {
  const a = await ma('Test, Bert');
  await malen(leitung, a, '2026-11-11', '09:00', '12:00', 'KA');
  await malen(leitung, a, '2026-11-11', '14:00', '18:00', 'KA');
  await abwesend(a, 'BS', '2026-11-11', 5, '08:00', '13:00');
  assert.deepEqual(zeile(await woche(), a), [blk('09:00', '12:00', 'KA', true), blk('14:00', '18:00', 'KA')]);
  const r = await malen(leitung, a, '2026-11-11', '13:00', '18:00', 'KA');
  assert.deepEqual(zeile(r, a), [blk('09:00', '12:00', 'KA', true), blk('13:00', '18:00', 'KA')]);
  await wirft(malen(leitung, a, '2026-11-11', '12:00', '14:00', 'KA'), 'ABWESEND');
});

// F2 je halbe Stunde: ein gespeicherter Block wird in der Ausgabe an der Abwesenheitsgrenze geteilt.
test('KA 10–14, BS 08–13, malen KA 14–16 → gespeichert ein Block 10–16; Abschnitte 10–13 unbesetzt, 13–16 besetzt (gleiche id); 3,00 h', async () => {
  const a = await ma('Test, Selma');
  await malen(leitung, a, '2026-11-12', '10:00', '14:00', 'KA');
  await abwesend(a, 'BS', '2026-11-12', 5, '08:00', '13:00');
  const r = await malen(leitung, a, '2026-11-12', '14:00', '16:00', 'KA');
  const gespeichert = (await db.query(
    "select to_char(von, 'HH24:MI') as von, to_char(bis, 'HH24:MI') as bis from pep.plan_bloecke where mitarbeiter_id = $1",
    [a])).rows;
  assert.deepEqual(gespeichert, [{ von: '10:00', bis: '16:00' }]);
  assert.deepEqual(zeile(r, a), [blk('10:00', '13:00', 'KA', true), blk('13:00', '16:00', 'KA')]);
  const ids = r.bloecke.filter((b) => b.mitarbeiter_id === a).map((b) => b.id);
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.deepEqual(zeile(await woche(), a), zeile(r, a));
  assert.equal(await stunden(a, '2026-11-12'), 3);
});

test('dieselbe Lage, 13–14 auf OG umfärben → erlaubt: KA 10–13 unbesetzt, OG 13–14, KA 14–16; 3,00 h', async () => {
  const a = await ma('Test, Olga', { kompetenzen: ['KA', 'OG'] });
  await malen(leitung, a, '2026-11-12', '10:00', '14:00', 'KA');
  await abwesend(a, 'BS', '2026-11-12', 5, '08:00', '13:00');
  await malen(leitung, a, '2026-11-12', '14:00', '16:00', 'KA');
  const r = await malen(leitung, a, '2026-11-12', '13:00', '14:00', 'OG');
  assert.deepEqual(zeile(r, a), [blk('10:00', '13:00', 'KA', true), blk('13:00', '14:00', 'OG'), blk('14:00', '16:00', 'KA')]);
  assert.equal(await stunden(a, '2026-11-12'), 3);
});

test('Pflicht max_stunden_tag zählt nur besetzte Stunden', async () => {
  const a = await ma('Test, Hanna');
  await malen(leitung, a, '2026-11-12', '10:00', '16:00', 'KA');
  await abwesend(a, 'BS', '2026-11-12', 5, '08:00', '13:00'); // 3 h besetzt
  await vorgabe(a, { pflicht: true, wochentag: 4, art: 'nicht_verfuegbar', max_stunden_tag: 4 });
  // 4 h besetzt: erlaubt (gespeicherte 7 h würden die Grenze reißen)
  await malen(leitung, a, '2026-11-12', '16:00', '17:00', 'KA');
  await wirft(malen(leitung, a, '2026-11-12', '17:00', '17:30', 'KA'), 'VORGABE_VERLETZT');
});

test('Pflicht nicht_verfuegbar Sa → VORGABE_VERLETZT; Pflicht nur_zwischen 08–14: 13–15 → VORGABE_VERLETZT; Pflicht max_stunden_tag 6: 08–15 → VORGABE_VERLETZT, 08–14 erlaubt; dieselben Vorgaben mit pflicht = false sperren nicht', async () => {
  // Sa nicht verfügbar; Di nur 08–14; Mi höchstens 6 h (Art wie in der Oberfläche vorbelegt, ohne Uhrzeit)
  const vorgaben = async (maId, pflicht) => {
    await vorgabe(maId, { pflicht, wochentag: 6, art: 'nicht_verfuegbar' });
    await vorgabe(maId, { pflicht, wochentag: 2, art: 'nur_zwischen', von: '08:00', bis: '14:00' });
    await vorgabe(maId, { pflicht, wochentag: 3, art: 'nicht_verfuegbar', max_stunden_tag: 6 });
  };
  const p = await ma('Test, Pia');
  await vorgaben(p, true);
  await wirft(malen(leitung, p, '2026-11-14', '08:00', '12:00', 'KA'), 'VORGABE_VERLETZT');
  await wirft(malen(leitung, p, '2026-11-10', '13:00', '15:00', 'KA'), 'VORGABE_VERLETZT');
  await malen(leitung, p, '2026-11-10', '08:00', '14:00', 'KA');
  await wirft(malen(leitung, p, '2026-11-11', '08:00', '15:00', 'KA'), 'VORGABE_VERLETZT');
  await malen(leitung, p, '2026-11-11', '08:00', '14:00', 'KA');
  // Pause zählt nicht zu den Stunden: 6 h Kasse plus 30 min Pause bleibt erlaubt
  await malen(leitung, p, '2026-11-11', '14:00', '14:30', 'PA');
  const q = await ma('Test, Quirin');
  await vorgaben(q, false);
  await malen(leitung, q, '2026-11-14', '08:00', '12:00', 'KA');
  await malen(leitung, q, '2026-11-10', '13:00', '15:00', 'KA');
  await malen(leitung, q, '2026-11-11', '08:00', '15:00', 'KA');
  // Pflicht höchstens 10 h in der Woche: Mo 6 h, dann Di 5 h → Verstoß, Di 4 h erlaubt
  const w = await ma('Test, Wanda');
  await vorgabe(w, { pflicht: true, art: 'nicht_verfuegbar', max_stunden_woche: 10 });
  await malen(leitung, w, '2026-11-09', '08:00', '14:00', 'KA');
  await wirft(malen(leitung, w, '2026-11-10', '08:00', '13:00', 'KA'), 'VORGABE_VERLETZT');
  await malen(leitung, w, '2026-11-10', '08:00', '12:00', 'KA');
});

test('Eintritt Mi 11.11., Austritt Fr 13.11.: steht in KW 46; malen Di → MITARBEITER_INAKTIV, Sa → MITARBEITER_INAKTIV; Vertrag erst ab Mi: Di → KEIN_VERTRAG', async () => {
  const e = await ma('Test, Eva');
  await aufruf(leitung, `select public.pep_mitarbeiter_speichern($1, '{"eintritt":"2026-11-11","austritt":"2026-11-13"}')`, [e]);
  const v = await ma('Test, Vito', { ab: '2026-11-11', stunden: 20, art: 'teilzeit' });
  const weg = await ma('Test, Weg');
  await aufruf(leitung, `select public.pep_mitarbeiter_speichern($1, '{"austritt":"2026-11-06"}')`, [weg]);
  const w = await woche();
  const ids = w.mitarbeiter.map((m) => m.id);
  assert.ok(ids.includes(e) && ids.includes(v), 'Eintritt/Vertrag mitten in der Woche stehen in der Liste');
  assert.ok(!ids.includes(weg), 'Austritt vor der Woche steht nicht in der Liste');
  // Bewusste Obermenge: wer in der Woche Blöcke hat, steht in der Liste, auch inaktiv oder ausgetreten
  const inaktiv = await ma('Test, Ina');
  const raus = await ma('Test, Raus');
  await malen(leitung, inaktiv, '2026-11-10', '08:00', '12:00', 'KA');
  await malen(leitung, raus, '2026-11-10', '08:00', '12:00', 'KA');
  await aufruf(leitung, `select public.pep_mitarbeiter_speichern($1, '{"aktiv":false}')`, [inaktiv]);
  await aufruf(leitung, `select public.pep_mitarbeiter_speichern($1, '{"austritt":"2026-11-06"}')`, [raus]);
  const liste = (await woche()).mitarbeiter.map((m) => m.id);
  assert.ok(liste.includes(inaktiv) && liste.includes(raus), 'mit Block in der Woche immer in der Liste');
  const vito = w.mitarbeiter.find((m) => m.id === v);
  assert.equal(vito.wochenstunden, 20); // erster Vertragstag der Woche
  assert.equal(vito.vertragsart, 'teilzeit');
  await wirft(malen(leitung, e, '2026-11-10', '08:00', '12:00', 'KA'), 'MITARBEITER_INAKTIV');
  await wirft(malen(leitung, e, '2026-11-14', '08:00', '12:00', 'KA'), 'MITARBEITER_INAKTIV');
  await malen(leitung, e, '2026-11-11', '08:00', '12:00', 'KA');
  await malen(leitung, e, '2026-11-13', '08:00', '12:00', 'KA');
  await wirft(malen(leitung, v, '2026-11-10', '08:00', '12:00', 'KA'), 'KEIN_VERTRAG');
  await malen(leitung, v, '2026-11-11', '08:00', '12:00', 'KA');
});

test('direktes Insert eines überlappenden Blocks → UEBERLAPPUNG', async () => {
  const a = await ma('Test, Ida');
  await malen(leitung, a, '2026-11-12', '08:00', '12:00', 'KA');
  const einfuegen = (von, bis) => db.query(
    `insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
     values ($1, $2, '2026-11-12', $3, $4, $5)`, [g.fil, a, von, bis, bereich.OG]);
  await wirft(einfuegen('11:00', '14:00'), 'UEBERLAPPUNG');
  await wirft(einfuegen('07:00', '08:30'), 'UEBERLAPPUNG');
  await einfuegen('12:00', '13:00'); // angrenzend ist erlaubt
  await wirft(db.query(`update pep.plan_bloecke set bis = '12:30' where mitarbeiter_id = $1 and von = '08:00'`, [a]), 'UEBERLAPPUNG');
});

test('pep_plan_zeile_setzen ersetzt die Zeile; [] löscht sie; Zeile mit 05:00 → AUSSERHALB_RAHMEN und die alte Zeile bleibt', async () => {
  const a = await ma('Test, Zora');
  await malen(leitung, a, '2026-11-13', '08:00', '12:00', 'KA');
  let r = await setzen(a, '2026-11-13', [
    { von: '14:00', bis: '16:00', bereich_id: bereich.KA },
    { von: '10:00', bis: '12:00', bereich_id: bereich.KA },
    { von: '12:00', bis: '14:00', bereich_id: bereich.KA },
  ], stellv);
  assert.deepEqual(zeile(r, a), [blk('10:00', '16:00', 'KA')]);
  await wirft(setzen(a, '2026-11-13', [{ von: '05:00', bis: '08:00', bereich_id: bereich.KA }]), 'AUSSERHALB_RAHMEN');
  assert.deepEqual(zeile(await woche(), a), [blk('10:00', '16:00', 'KA')]);
  await wirft(setzen(a, '2026-11-13', [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA },
    { von: '11:00', bis: '13:00', bereich_id: bereich.OG }]), 'UEBERLAPPUNG');
  await wirft(setzen(a, '2026-11-13', [{ von: '08:15', bis: '12:00', bereich_id: bereich.KA }]), 'HALBE_STUNDE');
  await wirft(setzen(a, '2026-11-13', { von: '08:00' }), 'WERT_UNGUELTIG');
  await wirft(setzen(a, '2026-11-13', [{ von: '08:00', bis: '12:00', bereich_id: 1.5 }]), 'WERT_UNGUELTIG');
  await wirft(setzen(a, '2026-11-13', [{ von: '08:00', bis: '12:00', bereich_id: 1e30 }]), 'WERT_UNGUELTIG');
  await wirft(setzen(a, '2026-11-13', [{ von: '08:00', bis: '12:00', bereich_id: '3' }]), 'WERT_UNGUELTIG');
  assert.deepEqual(zeile(await woche(), a), [blk('10:00', '16:00', 'KA')]);
  r = await setzen(a, '2026-11-13', []);
  assert.deepEqual(zeile(r, a), []);
});

test('pep_einsatzplan_woche(2026, 46): 7 Tage, Sonntag geoeffnet = false, Mitarbeiter in position-Reihenfolge, Blöcke, Abwesenheiten und Kommentare der Woche', async () => {
  const j = await ma('Test, Jule', { geburtsdatum: '2008-11-11', kompetenzen: ['KA', 'VP'] });
  await malen(leitung, j, '2026-11-12', '08:00', '12:00', 'KA');
  await malen(leitung, j, '2026-11-16', '08:00', '12:00', 'KA'); // nächste Woche
  await abwesend(j, 'KM', '2026-11-13');
  await kommentar(j, '2026-11-12', 'Früher gehen');
  const w = await woche();
  assert.equal(w.jahr, 2026);
  assert.equal(w.kw, 46);
  assert.equal(w.montag, '2026-11-09');
  assert.equal(w.heute, '2026-11-02');
  assert.equal(w.tage.length, 7);
  assert.deepEqual(w.tage[0], { datum: '2026-11-09', wochentag: 1, geoeffnet: true, oeffnung_von: '07:00',
    oeffnung_bis: '20:00', rahmen_von: '06:00', rahmen_bis: '21:30', feiertag: null, vergangen: false });
  assert.equal(w.tage[6].datum, '2026-11-15');
  assert.equal(w.tage[6].geoeffnet, false);
  // Bereiche: aktiv und malbar (ohne VP, ohne inaktive), nach position
  assert.deepEqual(w.bereiche.map((b) => b.kuerzel), ['KA', 'OG', 'BB', 'TS', 'MO', 'TK', 'FÜ', 'RE', 'BO', 'PA']);
  assert.equal(w.bereiche[0].bedeutung, 'kasse');
  // Mitarbeiter nach position
  const pos = Object.fromEntries((await db.query('select id, position from pep.mitarbeiter')).rows.map((r) => [r.id, r.position]));
  const reihe = w.mitarbeiter.map((m) => pos[m.id]);
  assert.deepEqual(reihe, [...reihe].sort((x, y) => x - y));
  const jule = w.mitarbeiter.find((m) => m.id === j);
  assert.deepEqual([...jule.kompetenzen].sort((x, y) => x - y), [bereich.KA, bereich.VP].sort((x, y) => x - y));
  assert.equal(jule.vp, true);
  assert.equal(jule.wochenstunden, 37.5);
  assert.equal(jule.u18['2026-11-10'], true);
  assert.equal(jule.u18['2026-11-11'], false); // 18. Geburtstag
  assert.deepEqual(zeile(w, j), [blk('08:00', '12:00', 'KA')]);
  assert.ok(w.bloecke.every((b) => b.datum >= '2026-11-09' && b.datum <= '2026-11-15'));
  const ab = w.abwesenheiten.filter((x) => x.mitarbeiter_id === j);
  assert.deepEqual(ab, [{ mitarbeiter_id: j, datum: '2026-11-13', code: 'KM', name: 'Krank', farbe: '#E53935',
    sperrt: true, stunden: 6.25, von: null, bis: null }]);
  assert.deepEqual(w.kommentare.filter((k) => k.mitarbeiter_id === j), [{ mitarbeiter_id: j, datum: '2026-11-12', text: 'Früher gehen' }]);
  assert.deepEqual(Object.keys(w.pruefung).sort(),
    ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  assert.ok(Object.values(w.pruefung).every((l) => Array.isArray(l) && l.length === 0));
});

test('pep_einsatzplan_woche().kennzahlen hat alle Felder aus Task 9', async () => {
  const w = await woche();
  assert.deepEqual(Object.keys(w.kennzahlen).sort(), ['abwesend', 'davon_urlaub', 'geplant', 'jahr', 'kw', 'montag',
    'planumsatz', 'soll', 'stundenleistung', 'stundenvorgabe', 'stundenvorgabe_manuell', 'ueberhang', 'verfuegbar',
    'vertragsstunden', 'vorgabe_quelle'].sort());
});

test('pep_einsatzplan_woche(2026, 53) beginnt 2026-12-28; (2026, 54) und (2027, 0) → DATUM_UNGUELTIG', async () => {
  const w = await woche(2026, 53);
  assert.equal(w.montag, '2026-12-28');
  assert.equal(w.tage[0].datum, '2026-12-28');
  assert.equal(w.tage[6].datum, '2027-01-03');
  assert.equal((await woche(2027, 1)).montag, '2027-01-04');
  await wirft(woche(2026, 54), 'DATUM_UNGUELTIG');
  await wirft(woche(2027, 0), 'DATUM_UNGUELTIG');
  await wirft(woche(2027, 53), 'DATUM_UNGUELTIG'); // 2027 hat nur 52 Wochen
});

test('Kommentar setzen, ändern, leeren; 201 Zeichen → TEXT_ZU_LANG', async () => {
  const a = await ma('Test, Kai');
  const lesen = async () => (await woche()).kommentare.filter((k) => k.mitarbeiter_id === a).map((k) => k.text);
  await kommentar(a, '2026-11-10', 'Arzttermin', stellv);
  assert.deepEqual(await lesen(), ['Arzttermin']);
  await kommentar(a, '2026-11-10', '  Arzt 10 Uhr ');
  assert.deepEqual(await lesen(), ['Arzt 10 Uhr']);
  await kommentar(a, '2026-11-10', '');
  assert.deepEqual(await lesen(), []);
  await kommentar(a, '2026-11-10', 'x');
  await kommentar(a, '2026-11-10', null);
  assert.deepEqual(await lesen(), []);
  await wirft(kommentar(a, '2026-11-10', 'x'.repeat(201)), 'TEXT_ZU_LANG');
  await kommentar(a, '2026-11-10', 'x'.repeat(200));
  await kommentar(a, '2026-10-30', 'vergangen geht'); // auch an vergangenen Tagen
  const n = (await db.query('select count(*)::int as n from pep.plan_kommentare where mitarbeiter_id = $1', [a])).rows[0].n;
  assert.equal(n, 2);
});

test('Reihenfolge [c, a, b] → Wochenliste c, a, b; fremde Id → WERT_UNGUELTIG; Stellvertretung → NUR_LEITUNG', async () => {
  const neu = async (name) => {
    const id = await json(chef2, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name })]);
    await aufruf(chef2, `select public.pep_vertrag_speichern($1, '{"vertragsart":"vollzeit","wochenstunden":37.5,"gueltig_ab":"2026-01-01"}')`, [id]);
    return id;
  };
  const a = await neu('Reihe, A'); const b = await neu('Reihe, B'); const c = await neu('Reihe, C');
  // fremdMa (aktiv, ohne Vertrag) gehört zu den aktiven Mitarbeitern der Filiale und wird mitsortiert
  const reihenfolge = (ids, nutzer = chef2) =>
    aufruf(nutzer, 'select public.pep_mitarbeiter_reihenfolge($1::bigint[])', [ids]);
  await reihenfolge([c, a, fremdMa, b]);
  assert.deepEqual((await woche(2026, 46, chef2)).mitarbeiter.map((m) => m.id), [c, a, b]);
  const fremd = await ma('Test, Fremd');
  await wirft(reihenfolge([c, a, fremdMa, b, fremd]), 'WERT_UNGUELTIG');
  await wirft(reihenfolge([c, a, fremdMa]), 'WERT_UNGUELTIG');
  await wirft(reihenfolge([c, a, fremdMa, b, b]), 'WERT_UNGUELTIG');
  await wirft(reihenfolge([c, a, fremdMa, null]), 'WERT_UNGUELTIG');
  await wirft(reihenfolge([b, a, fremdMa, c], vize2), 'NUR_LEITUNG');
  assert.deepEqual((await woche(2026, 46, chef2)).mitarbeiter.map((m) => m.id), [c, a, b]);
});

test('malen schreibt Protokoll (tabelle plan_bloecke, vorher und nachher)', async () => {
  const a = await ma('Test, Lena');
  await malen(leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  await malen(leitung, a, '2026-11-09', '10:00', '11:00', 'PA');
  const p = (await db.query(
    `select vorher, nachher, user_id from pep.protokoll where tabelle = 'plan_bloecke' and schluessel = $1 order by id`,
    [`${a}:2026-11-09`])).rows;
  assert.equal(p.length, 2);
  assert.deepEqual(p[0].vorher, []);
  assert.deepEqual(p[0].nachher, [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA }]);
  assert.deepEqual(p[1].vorher, p[0].nachher);
  assert.deepEqual(p[1].nachher, [{ von: '08:00', bis: '10:00', bereich_id: bereich.KA },
    { von: '10:00', bis: '11:00', bereich_id: bereich.PA }, { von: '11:00', bis: '12:00', bereich_id: bereich.KA }]);
  assert.equal(p[1].user_id, leitung);
});

test('fremde Filiale: Mitarbeiter → MITARBEITER_NICHT_GEFUNDEN, Bereich → BEREICH_NICHT_GEFUNDEN', async () => {
  const a = await ma('Test, Nina');
  await wirft(malen(leitung, fremdMa, '2026-11-09', '08:00', '12:00', 'KA'), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(setzen(fremdMa, '2026-11-09', []), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(kommentar(fremdMa, '2026-11-09', 'x'), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(json(leitung, 'select public.pep_plan_malen($1, $2::date, $3::time, $4::time, $5) as r',
    [a, '2026-11-09', '08:00', '12:00', fremdBereich]), 'BEREICH_NICHT_GEFUNDEN');
  await wirft(setzen(a, '2026-11-09', [{ von: '08:00', bis: '12:00', bereich_id: fremdBereich }]), 'BEREICH_NICHT_GEFUNDEN');
  // Die Wochenliste der anderen Filiale enthält keine Mitarbeiter dieser Filiale
  assert.ok(!(await woche(2026, 46, chef2)).mitarbeiter.some((m) => m.id === a));
});

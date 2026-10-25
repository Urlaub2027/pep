// Journal, Wochenabschluss und Nachbuchen (Stufe 2, G3–G5): pep_wochenabschluss, pep_zeitkonto_buchen,
// pep_zeitkonto_journal und die automatischen Korrekturen bei Änderungen in abgeschlossenen Wochen.
// Stichtag heute = Mo 16.11.2026 (KW 47); KW 45 = 02.–08.11., KW 46 = 09.–15.11.2026.
// Jahreswechsel und Feiertag: KW 52/2026, KW 53/2026 (Fr 01.01.2027 Neujahr), KW 1/2027 (Mi 06.01.) mit heute = 11.01.2027.
// Drei Datenbanken: A (KW 46 abgeschlossen, Buchen und Journal), B (KW 45 und 46 abgeschlossen, Nachbuchen),
// C (Jahreswechsel). Die Tests einer Datenbank bauen in Dateireihenfolge aufeinander auf.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, planGrundlage, heuteSetzen } from './helfer.mjs';

const HEUTE = '2026-11-16';
const KW45 = '2026-11-02';
const KW46 = '2026-11-09';

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);
// Tag i (0 = Montag) der Woche ab montag, als "YYYY-MM-DD".
const tag = (montag, i) => new Date(Date.parse(`${montag}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10);

// istAb = Start der IST-Erfassung = erste abschließbare Woche (der erste Abschluss muss genau diese Woche sein).
async function aufbau(heute = HEUTE, istAb = KW46) {
  const db = await neueDatenbank();
  const g = await planGrundlage(db, { heute, istAb });
  const { leitung, bereich, code, json } = g;
  const istSetzen = (maId, datum, bloecke, grund = null) =>
    json(leitung, 'select public.pep_ist_zeile_setzen($1, $2::date, $3::jsonb, $4) as r',
      [maId, datum, JSON.stringify(bloecke.map(([von, bis, k]) => ({ von, bis, bereich_id: bereich[k] }))), grund]);
  const istMalen = (maId, datum, von, bis, k, grund = null) =>
    json(leitung, 'select public.pep_ist_malen($1, $2::date, $3::time, $4::time, $5, $6) as r',
      [maId, datum, von, bis, k === null ? null : bereich[k], grund]);
  const bestaetigen = (datum, ids = null) =>
    json(leitung, 'select public.pep_ist_bestaetigen($1::date, $2::bigint[]) as r',
      [datum, ids === null ? null : `{${ids.join(',')}}`]);
  // Alle offenen Zeilen Mo–Sa einer Woche bestätigen (ohne IST und Plan: leer bestätigt).
  const wocheBestaetigen = async (montag) => { for (let i = 0; i < 6; i++) await bestaetigen(tag(montag, i)); };
  const abschluss = (jahr, kw, nutzer = leitung) =>
    json(nutzer, 'select public.pep_wochenabschluss($1, $2) as r', [jahr, kw]);
  const buchen = (maId, art, stunden, grund, datum = null, nutzer = leitung) =>
    json(nutzer, 'select public.pep_zeitkonto_buchen($1, $2, $3::numeric, $4, $5::date) as r',
      [maId, art, stunden, grund, datum]);
  const journal = (maId = null, von = null, bis = null, nutzer = leitung) =>
    json(nutzer, 'select public.pep_zeitkonto_journal($1, $2::date, $3::date) as r', [maId, von, bis]);
  const abwesend = (maId, c, von, bis = von) =>
    json(leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, null, null, null, null) as r',
      [maId, code[c], von, bis]);
  const speichern = (maId, daten) =>
    json(leitung, 'select public.pep_mitarbeiter_speichern($1, $2::jsonb) as r', [maId, JSON.stringify(daten)]);
  const vertrag = (maId, daten) =>
    json(leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb) as r', [maId, JSON.stringify(daten)]);
  const zkWoche = (jahr, kw) => json(leitung, 'select public.pep_zeitkonto_woche($1, $2) as r', [jahr, kw]);
  // Journalzeilen eines Mitarbeiters in Buchungsreihenfolge.
  const zeilen = async (maId) => (await db.query(`select art, to_char(datum, 'YYYY-MM-DD') as datum,
      stunden::float8 as stunden, saldo_nach::float8 as saldo_nach, grund
    from pep.zeitkonto_buchungen where mitarbeiter_id = $1 order by id`, [maId])).rows;
  const korrekturen = async (maId) => (await zeilen(maId)).filter((z) => z.art === 'korrektur')
    .map(({ datum, stunden, grund }) => ({ datum, stunden, grund }));
  const anzahl = async () => (await db.query('select count(*)::int as n from pep.zeitkonto_buchungen')).rows[0].n;
  // Saldo = Summe aller Buchungen = saldo_nach der letzten Buchung.
  const saldoStimmt = async (maId) => {
    const z = await zeilen(maId);
    const summe = Math.round(z.reduce((s, x) => s + x.stunden, 0) * 100) / 100;
    assert.equal(z.at(-1).saldo_nach, summe, `Saldo ${maId}`);
    return summe;
  };
  return { db, ...g, istSetzen, istMalen, bestaetigen, wocheBestaetigen, abschluss, buchen, journal, abwesend,
    speichern, vertrag, zkWoche, zeilen, korrekturen, anzahl, saldoStimmt };
}

let A; // KW 46 abgeschlossen: Anna, Berta, Ina (inaktiv)
let B; // KW 45 und 46 abgeschlossen: Uwe, Vera, Zora (ZA am Mo KW 46), Emil, Sam (Eintritt erst 16.11.)
let C; // KW 52/2026, 53/2026, 1/2027 abgeschlossen: Fritz, Tina (Teilzeit 20), Otto (ohne Vertrag), Ines (inaktiv)

before(async () => {
  A = await aufbau();
  A.anna = await A.ma('Voll, Anna');
  A.berta = await A.ma('Voll, Berta');
  A.ina = await A.ma('Inaktiv, Ina');
  await A.speichern(A.ina, { aktiv: false });
  for (const m of [A.anna, A.berta]) {
    for (let i = 0; i < 5; i++) await A.istSetzen(m, tag(KW46, i), [['08:00', '16:00', 'KA']]);
  }
  // Alles bestätigt außer Bertas Mittwoch
  for (let i = 0; i < 6; i++) await A.bestaetigen(tag(KW46, i), i === 2 ? [A.anna] : null);
  A.chef2 = await pepBenutzer(A.db, 'chef2');
  await filiale(A.db, A.chef2, { name: 'Netto Zweitfiliale', nummer: '9999' });
  A.fremdMa = await A.json(A.chef2, `select public.pep_mitarbeiter_speichern(null, '{"name":"Fremd, Frieda"}') as r`);
  A.azubi = await pepBenutzer(A.db, 'azubi', 'mitarbeiter', A.fil);

  B = await aufbau(HEUTE, KW45);
  B.uwe = await B.ma('Urlaub, Uwe');
  B.vera = await B.ma('Vertrag, Vera');
  B.zora = await B.ma('Ausgleich, Zora');
  B.emil = await B.ma('Ende, Emil');
  await B.abwesend(B.zora, 'ZA', KW46);
  B.sam = await B.ma('Spaet, Sam');
  await B.speichern(B.sam, { eintritt: '2026-11-16' }); // Vertrag seit 01.01., beschäftigt aber erst nach KW 46
  B.walter = await B.ma('Weg, Walter');
  await B.speichern(B.walter, { austritt: '2026-10-30' }); // ausgetreten vor KW 45, aber noch aktiv

  C = await aufbau('2027-01-11', '2026-12-21'); // erste Woche KW 52/2026
  C.fritz = await C.ma('Feier, Fritz');
  C.tina = await C.ma('Teil, Tina', { stunden: 20, art: 'teilzeit' });
  C.otto = await C.json(C.leitung, `select public.pep_mitarbeiter_speichern(null, '{"name":"Ohne, Otto"}') as r`);
  C.ines = await C.ma('Inaktiv, Ines');
  await C.speichern(C.ines, { aktiv: false });
});

// ---------------------------------------------------------------------------------------------------------------
// Datenbank A
// ---------------------------------------------------------------------------------------------------------------

test('Abschluss KW 46: nicht vorbei, IST offen, dann je aktivem Mitarbeiter eine Zeile woche; saldo_nach fortlaufend', async () => {
  const { abschluss, buchen, bestaetigen, zeilen, anna, berta, ina, db, stellv } = A;
  // Sonntag 15.11. ist die Woche noch nicht vorbei; die laufende KW 47 auch nicht
  await heuteSetzen(db, '2026-11-15');
  try {
    await wirft(abschluss(2026, 46), 'WOCHE_NICHT_VORBEI');
  } finally {
    await heuteSetzen(db, HEUTE);
  }
  await wirft(abschluss(2026, 47), 'WOCHE_NICHT_VORBEI');
  await wirft(abschluss(2026, 46), 'IST_OFFEN');
  await wirft(abschluss(2026, 46, stellv), 'NUR_LEITUNG');

  // Startsaldo vor dem ersten Abschluss
  const s = await buchen(anna, 'start', 13.75, 'Übernahme aus Excel', KW45);
  assert.deepEqual([s.art, s.datum, s.kw, s.jahr, Number(s.stunden), Number(s.saldo_nach), s.grund, s.name, s.angelegt_von_name],
    ['start', KW45, 45, 2026, 13.75, 13.75, 'Übernahme aus Excel', 'Voll, Anna', 'chef']);

  await bestaetigen(tag(KW46, 2), [berta]);
  assert.deepEqual(await abschluss(2026, 46), { gebucht: 2 });
  assert.deepEqual(await zeilen(anna), [
    { art: 'start', datum: KW45, stunden: 13.75, saldo_nach: 13.75, grund: 'Übernahme aus Excel' },
    { art: 'woche', datum: KW46, stunden: 2.5, saldo_nach: 16.25, grund: null }]);
  assert.deepEqual(await zeilen(berta), [{ art: 'woche', datum: KW46, stunden: 2.5, saldo_nach: 2.5, grund: null }]);
  assert.deepEqual(await zeilen(ina), [], 'inaktiv: keine Zeile woche');

  const r = await A.zkWoche(2026, 46);
  assert.equal(r.abgeschlossen.von_name, 'chef');
  assert.equal(Number(r.mitarbeiter.find((m) => m.id === anna).saldo_aktuell), 16.25);
  const p = (await db.query(`select aktion, schluessel from pep.protokoll where tabelle = 'wochen_abschluesse'`)).rows;
  assert.deepEqual(p, [{ aktion: 'abschliessen', schluessel: KW46 }]);

  // Zweiter Abschluss derselben Woche, Wochen außer der Reihe
  await wirft(abschluss(2026, 46), 'WOCHE_GEBUCHT');
  assert.equal((await zeilen(anna)).length, 2);
  await heuteSetzen(db, '2026-12-07');
  try {
    await wirft(abschluss(2026, 48), 'VORWOCHE_OFFEN');
    await wirft(abschluss(2026, 45), 'VOR_IST_START'); // vor der Startwoche KW 46 (vor ist_ab: VORWOCHE_OFFEN)
  } finally {
    await heuteSetzen(db, HEUTE);
  }
});

test('Inaktive bekommen keine Korrektur, Aktive schon (Vertrag rückwirkend ab 01.11. auf 30 h)', async () => {
  const { vertrag, korrekturen, ina, berta, saldoStimmt } = A;
  await vertrag(ina, { vertragsart: 'teilzeit', wochenstunden: 30, gueltig_ab: '2026-11-01' });
  assert.deepEqual(await A.zeilen(ina), []);
  await vertrag(berta, { vertragsart: 'teilzeit', wochenstunden: 30, gueltig_ab: '2026-11-01' });
  assert.deepEqual(await korrekturen(berta), [{ datum: KW46, stunden: 7.5, grund: 'KW 46/2026: Vertrag geändert' }]);
  assert.equal(await saldoStimmt(berta), 10);
});

test('IST-Strich mit Grund in abgeschlossener Woche → genau eine Korrektur „KW 46/2026: später gegangen“', async () => {
  const { istMalen, istSetzen, korrekturen, saldoStimmt, anna, db, fil, bereich } = A;
  await wirft(istMalen(anna, tag(KW46, 2), '16:00', '17:00', 'KA'), 'GRUND_FEHLT');
  await istMalen(anna, tag(KW46, 2), '16:00', '17:00', 'KA', 'später gegangen');
  assert.deepEqual(await korrekturen(anna), [{ datum: KW46, stunden: 1, grund: 'KW 46/2026: später gegangen' }]);
  assert.equal(await saldoStimmt(anna), 17.25);
  // Rückgängig ersetzt die Zeile (Löschen + Einfügen) und bucht trotzdem genau eine Gegenbuchung
  await istSetzen(anna, tag(KW46, 2), [['08:00', '16:00', 'KA']], 'Rückgängig');
  assert.deepEqual(await korrekturen(anna), [
    { datum: KW46, stunden: 1, grund: 'KW 46/2026: später gegangen' },
    { datum: KW46, stunden: -1, grund: 'KW 46/2026: Rückgängig' }]);
  assert.equal(await saldoStimmt(anna), 16.25);

  // Änderungen ohne Wirkung auf diff: anderer Bereich, Planblock, Kommentar
  const vorher = await A.anzahl();
  await istSetzen(anna, tag(KW46, 2), [['08:00', '16:00', 'OG']], 'Bereich verwechselt');
  await db.query(`insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
    values ($1, $2, $3::date, '08:00', '12:00', $4)`, [fil, anna, tag(KW46, 5), bereich.KA]);
  await db.query(`insert into pep.plan_kommentare (filiale_id, mitarbeiter_id, datum, text)
    values ($1, $2, $3::date, 'Test')`, [fil, anna, tag(KW46, 5)]);
  assert.equal(await A.anzahl(), vorher);
});

test('Journal ist unveränderbar: Update, Delete, Truncate und Löschen des Mitarbeiters scheitern; zweite Zeile woche auch', async () => {
  const { db, anna, fil, zeilen, ma } = A;
  const vorher = await zeilen(anna);
  await wirft(db.query('update pep.zeitkonto_buchungen set stunden = 0 where mitarbeiter_id = $1', [anna]), 'JOURNAL_UNVERAENDERBAR');
  await wirft(db.query('delete from pep.zeitkonto_buchungen where mitarbeiter_id = $1', [anna]), 'JOURNAL_UNVERAENDERBAR');
  await wirft(db.query('truncate pep.zeitkonto_buchungen'), 'JOURNAL_UNVERAENDERBAR');
  await wirft(db.query('delete from pep.mitarbeiter where id = $1', [anna]), 'JOURNAL_UNVERAENDERBAR');
  // Zwei Leitungen schließen gleichzeitig ab: der eindeutige Teilindex verhindert eine zweite Zeile woche
  await assert.rejects(db.query(`insert into pep.zeitkonto_buchungen (filiale_id, mitarbeiter_id, datum, art, stunden, saldo_nach)
    values ($1, $2, $3::date, 'woche', 1, 1)`, [fil, anna, KW46]), /duplicate|unique/i);
  assert.deepEqual(await zeilen(anna), vorher);
  // Ohne Journalzeilen lässt sich ein Mitarbeiter weiter löschen
  const weg = await ma('Weg, Willi', { ab: '2026-11-16' });
  await db.query('delete from pep.mitarbeiter where id = $1', [weg]);
});

test('pep_zeitkonto_buchen: Startsaldo nur als erste Buchung, manuell mit Grund, Prüfungen, nur Leitung', async () => {
  const { buchen, zeilen, anna, berta, ma, stellv, fremdMa, db } = A;
  const nils = await ma('Neu, Nils', { ab: '2026-11-16' });
  const s = await buchen(nils, 'start', -3.5, ' Übernahme ', '2026-11-16');
  assert.deepEqual([s.art, Number(s.stunden), Number(s.saldo_nach), s.grund], ['start', -3.5, -3.5, 'Übernahme']);
  await wirft(buchen(nils, 'start', 1, 'nochmal'), 'START_NICHT_ERSTE');
  await wirft(buchen(berta, 'start', 1, 'zu spät'), 'START_NICHT_ERSTE');
  const m = await buchen(nils, 'manuell', 2, 'Excel-Korrektur', '2026-11-20');
  assert.deepEqual([m.art, m.datum, Number(m.saldo_nach)], ['manuell', '2026-11-20', -1.5]);

  // Ohne Datum: heute
  const a = await buchen(anna, 'manuell', -4, 'Auszahlung');
  assert.deepEqual([a.datum, a.kw, Number(a.stunden), Number(a.saldo_nach)], [HEUTE, 47, -4, 12.25]);

  for (const g of [null, '', '   ']) await wirft(buchen(anna, 'manuell', -4, g), 'GRUND_FEHLT');
  await wirft(buchen(anna, 'manuell', -4, 'x'.repeat(201)), 'TEXT_ZU_LANG');
  for (const art of ['woche', 'korrektur', 'quatsch', null]) await wirft(buchen(anna, art, 1, 'Test'), 'ART_UNGUELTIG');
  for (const std of [0, 999.01, -1000, null, 1.234]) await wirft(buchen(anna, 'manuell', std, 'Test'), 'STUNDEN_UNGUELTIG');
  await buchen(anna, 'manuell', -999, 'Grenzwert');
  await buchen(anna, 'manuell', 999, 'Grenzwert zurück');
  await wirft(buchen(anna, 'manuell', 1, 'Test', null, stellv), 'NUR_LEITUNG');
  await wirft(buchen(fremdMa, 'manuell', 1, 'Test'), 'MITARBEITER_NICHT_GEFUNDEN');
  assert.equal((await zeilen(anna)).at(-1).saldo_nach, 12.25);
  await A.saldoStimmt(anna);
  await A.saldoStimmt(nils);
  const p = (await db.query(`select count(*)::int as n from pep.protokoll where tabelle = 'zeitkonto_buchungen'
    and aktion = 'buchen'`)).rows[0].n;
  assert.equal(p, (await db.query('select count(*)::int as n from pep.zeitkonto_buchungen')).rows[0].n);
});

test('pep_zeitkonto_journal: laufende Summe und Namen, nach Datum, Filter, fremde Filiale nicht', async () => {
  const { journal, anna, berta, fremdMa, chef2, stellv, azubi } = A;
  const j = await journal(anna);
  assert.deepEqual(Object.keys(j[0]).sort(), ['angelegt_am', 'angelegt_von_name', 'art', 'datum', 'grund', 'id', 'jahr', 'kw',
    'mitarbeiter_id', 'name', 'saldo_nach', 'stunden'].sort());
  assert.deepEqual([j[0].art, j[0].datum, j[0].kw, j[0].jahr, j[0].name, j[0].mitarbeiter_id, j[0].angelegt_von_name],
    ['start', KW45, 45, 2026, 'Voll, Anna', anna, 'chef']);
  assert.ok(j.every((z) => z.name === 'Voll, Anna' && z.angelegt_von_name === 'chef'));
  const sortiert = [...j].sort((x, y) => x.datum.localeCompare(y.datum) || x.id - y.id);
  assert.deepEqual(j.map((z) => z.id), sortiert.map((z) => z.id));
  // Saldo der letzten Buchung (höchste id) = Summe aller Zeilen
  const letzte = j.reduce((x, y) => (y.id > x.id ? y : x));
  assert.equal(Number(letzte.saldo_nach), Math.round(j.reduce((s, z) => s + Number(z.stunden), 0) * 100) / 100);
  // Jede Zeile: saldo_nach = Summe aller Buchungen bis zu ihrer id
  for (const z of j) {
    const bis = j.filter((y) => y.id <= z.id).reduce((s, y) => s + Number(y.stunden), 0);
    assert.equal(Number(z.saldo_nach), Math.round(bis * 100) / 100, `Zeile ${z.id}`);
  }
  const korrektur = j.find((z) => z.art === 'korrektur');
  assert.deepEqual([korrektur.datum, korrektur.kw, korrektur.grund], [KW46, 46, 'KW 46/2026: später gegangen']);

  // Zeitraum
  const w = await journal(anna, KW46, '2026-11-15');
  assert.ok(w.length >= 3);
  assert.ok(w.every((z) => z.datum === KW46));
  await wirft(journal(anna, '2026-11-15', KW46), 'ZEITRAUM_UNGUELTIG');
  // Alle Mitarbeiter der Filiale
  const alle = await journal();
  assert.ok(alle.some((z) => z.mitarbeiter_id === berta && z.name === 'Voll, Berta'));
  assert.ok(alle.some((z) => z.mitarbeiter_id === anna));
  assert.deepEqual(alle.map((z) => z.id), [...alle].sort((x, y) => x.datum.localeCompare(y.datum) || x.id - y.id).map((z) => z.id));
  // Fremde Filiale: nicht sichtbar, und die fremde Leitung sieht unsere Buchungen nicht
  await wirft(journal(fremdMa), 'MITARBEITER_NICHT_GEFUNDEN');
  assert.deepEqual(await journal(null, null, null, chef2), []);
  await wirft(journal(anna, null, null, chef2), 'MITARBEITER_NICHT_GEFUNDEN');
  // Stellvertretung liest dasselbe, Rolle mitarbeiter nicht
  assert.deepEqual(await journal(anna, null, null, stellv), j);
  await wirft(journal(anna, null, null, azubi), 'NUR_LEITUNG');
});

test('Führung ohne eingetragene Grenze: grenze = größer von 42 und Vertragsstunden', async () => {
  const { ma, db } = A;
  const f = await ma('Fuehrung, Fred', { art: 'fuehrung', stunden: 45, ab: '2026-11-16' });
  await db.query('update pep.vertraege set zeitkonto_grenze = null where mitarbeiter_id = $1', [f]);
  const z = (await db.query(`select pep.zeitkonto_woche($1, '2026-11-16') as z`, [f])).rows[0].z;
  assert.equal(Number(z.grenze), 45);
});

// ---------------------------------------------------------------------------------------------------------------
// Datenbank B
// ---------------------------------------------------------------------------------------------------------------

test('Abschluss KW 45 und KW 46 hintereinander: ohne IST je −37,5, ZA ohne Gutschrift; noch nicht eingetreten → 0, ausgetreten → keine Zeile', async () => {
  const { wocheBestaetigen, abschluss, zeilen, uwe, zora, sam, walter } = B;
  await wocheBestaetigen(KW45);
  await wocheBestaetigen(KW46);
  assert.deepEqual(await abschluss(2026, 45), { gebucht: 5 });
  assert.deepEqual(await abschluss(2026, 46), { gebucht: 5 });
  assert.deepEqual((await zeilen(sam)).map((z) => [z.art, z.datum, z.stunden]), [['woche', KW45, 0], ['woche', KW46, 0]]);
  assert.deepEqual(await zeilen(walter), [], 'Austritt vor dem Montag: keine Zeile woche');
  assert.deepEqual(await zeilen(uwe), [
    { art: 'woche', datum: KW45, stunden: -37.5, saldo_nach: -37.5, grund: null },
    { art: 'woche', datum: KW46, stunden: -37.5, saldo_nach: -75, grund: null }]);
  assert.deepEqual((await zeilen(zora)).map((z) => z.stunden), [-37.5, -37.5]);
});

test('Nur Wochen mit Zeile woche: Eintritt vorverlegt → Korrektur; neuer Mitarbeiter mit rückdatiertem Vertrag → keine', async () => {
  const { speichern, korrekturen, saldoStimmt, zeilen, ma, sam } = B;
  // Sam war beim Abschluss mit Vertrag dabei (Zeilen 0): Eintritt Mi 11.11. → KW 46 Soll 25, KW 45 weiter ohne Rechnung
  await speichern(sam, { eintritt: '2026-11-11' });
  assert.deepEqual(await korrekturen(sam), [{ datum: KW46, stunden: -25, grund: 'KW 46/2026: Ein-/Austritt geändert' }]);
  assert.equal(await saldoStimmt(sam), -25);
  // Nach den Abschlüssen angelegt, Vertrag seit 01.01.: gehörte zu keiner abgeschlossenen Woche
  const nina = await ma('Neu, Nina');
  assert.deepEqual(await zeilen(nina), []);
});

test('Urlaub nachträglich über KW 45 und KW 46: genau eine Korrektur je Woche, Saldo = Summe des Journals', async () => {
  const { abwesend, korrekturen, saldoStimmt, uwe } = B;
  assert.deepEqual(await abwesend(uwe, 'U', '2026-11-05', '2026-11-10'), { tage: 5, uebersprungen: 1 });
  assert.deepEqual(await korrekturen(uwe), [
    { datum: KW45, stunden: 18.75, grund: 'KW 45/2026: Abwesenheit geändert' },
    { datum: KW46, stunden: 12.5, grund: 'KW 46/2026: Abwesenheit geändert' }]);
  assert.equal(await saldoStimmt(uwe), -43.75);
});

test('Vertrag rückwirkend 37,5 → 30 ab 01.11.: Korrektur je abgeschlossener Woche, mit Urlaub genau eine; Löschen bucht zurück', async () => {
  const { vertrag, korrekturen, saldoStimmt, uwe, vera, zora, emil, json, leitung } = B;
  const zoraVorher = await B.zeilen(zora);
  const v = await vertrag(vera, { vertragsart: 'teilzeit', wochenstunden: 30, gueltig_ab: '2026-11-01' });
  assert.deepEqual(await korrekturen(vera), [
    { datum: KW45, stunden: 7.5, grund: 'KW 45/2026: Vertrag geändert' },
    { datum: KW46, stunden: 7.5, grund: 'KW 46/2026: Vertrag geändert' }]);
  assert.equal(await saldoStimmt(vera), -60);
  // Uwe: Soll sinkt und die Urlaubsstunden werden neu gerechnet (5 statt 6,25) – trotzdem eine Korrektur je Woche
  await vertrag(uwe, { vertragsart: 'teilzeit', wochenstunden: 30, gueltig_ab: '2026-11-01' });
  assert.deepEqual((await korrekturen(uwe)).slice(2), [
    { datum: KW45, stunden: 3.75, grund: 'KW 45/2026: Vertrag geändert' },
    { datum: KW46, stunden: 5, grund: 'KW 46/2026: Vertrag geändert' }]);
  assert.equal(await saldoStimmt(uwe), -35);
  assert.deepEqual(await B.zeilen(zora), zoraVorher);
  assert.deepEqual(await korrekturen(emil), []);

  await json(leitung, 'select public.pep_vertrag_loeschen($1) as r', [v]);
  assert.deepEqual((await korrekturen(vera)).slice(2), [
    { datum: KW45, stunden: -7.5, grund: 'KW 45/2026: Vertrag geändert' },
    { datum: KW46, stunden: -7.5, grund: 'KW 46/2026: Vertrag geändert' }]);
  assert.equal(await saldoStimmt(vera), -75);
});

test('Gutschrift des Codes ZA umgeschaltet: Korrektur nur für Wochen mit ZA; anderes Feld des Codes ändert nichts', async () => {
  const { db, fil, korrekturen, anzahl, zora } = B;
  const vorher = await anzahl();
  await db.query(`update pep.abwesenheitscodes set gutschrift = true where filiale_id = $1 and code = 'ZA'`, [fil]);
  assert.deepEqual(await korrekturen(zora), [{ datum: KW46, stunden: 6.25, grund: 'KW 46/2026: Gutschrift eines Codes geändert' }]);
  assert.equal(await anzahl(), vorher + 1);
  await db.query(`update pep.abwesenheitscodes set name = 'Urlaub (bezahlt)' where filiale_id = $1 and code = 'U'`, [fil]);
  assert.equal(await anzahl(), vorher + 1);
  await db.query(`update pep.abwesenheitscodes set gutschrift = false where filiale_id = $1 and code = 'ZA'`, [fil]);
  assert.deepEqual((await korrekturen(zora)).map((k) => k.stunden), [6.25, -6.25]);
});

test('Austritt rückwirkend vor die Wochen: Wochenrechnung wird NULL, Korrektur auf 0; Eintritt Mittwoch → anteilig', async () => {
  const { speichern, korrekturen, saldoStimmt, anzahl, emil } = B;
  await speichern(emil, { austritt: '2026-11-01' });
  assert.deepEqual(await korrekturen(emil), [
    { datum: KW45, stunden: 37.5, grund: 'KW 45/2026: Ein-/Austritt geändert' },
    { datum: KW46, stunden: 37.5, grund: 'KW 46/2026: Ein-/Austritt geändert' }]);
  assert.equal(await saldoStimmt(emil), 0);
  const vorher = await anzahl();
  await speichern(emil, { name: 'Ende, Emil Erwin' });
  assert.equal(await anzahl(), vorher);
  // Austritt weg, Eintritt Mi 11.11.: KW 45 bleibt ohne Beschäftigung, KW 46 Soll 25
  await speichern(emil, { austritt: null, eintritt: '2026-11-11' });
  assert.deepEqual((await korrekturen(emil)).slice(2), [{ datum: KW46, stunden: -25, grund: 'KW 46/2026: Ein-/Austritt geändert' }]);
  assert.equal(await saldoStimmt(emil), -25);
});

test('Weiche pep.einspielen: Änderung in abgeschlossener Woche bucht nichts; ohne Weiche schon', async () => {
  const { db, fil, bereich, vera, zeilen, korrekturen } = B;
  const vorher = await zeilen(vera);
  try {
    await db.exec(`begin;
      select set_config('pep.einspielen', '1', true);
      insert into pep.ist_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
        values (${fil}, ${vera}, '2026-11-10', '08:00', '12:00', ${bereich.KA});
      commit;`);
  } catch (fehler) {
    await db.exec('rollback');
    throw fehler;
  }
  assert.deepEqual(await zeilen(vera), vorher);
  // Gegenprobe: dieselbe Art Änderung ohne Weiche; die Korrektur gleicht auch die eingespielten 4 h ab
  await db.query(`insert into pep.ist_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
    values ($1, $2, '2026-11-10', '13:00', '15:00', $3)`, [fil, vera, bereich.KA]);
  assert.deepEqual((await korrekturen(vera)).at(-1), { datum: KW46, stunden: 6, grund: 'KW 46/2026: IST geändert' });
});

test('Sperre eines Codes umgeschaltet: IST während der Abwesenheit zählt wieder bzw. nicht mehr → Korrektur', async () => {
  const { db, fil, json, leitung, code, vera, korrekturen, anzahl, saldoStimmt } = B;
  // Termin 10–12 am 10.11. (sperrt): IST 10–12 wird unbesetzt (−2), der Termin zählt 2 → diff unverändert
  const vorher = await anzahl();
  await json(leitung, `select public.pep_abwesenheit_setzen($1, $2, '2026-11-10', '2026-11-10', 2, '10:00', '12:00', null) as r`,
    [vera, code.T]);
  assert.equal(await anzahl(), vorher);
  await db.query(`update pep.abwesenheitscodes set sperrt = false where filiale_id = $1 and code = 'T'`, [fil]);
  assert.deepEqual((await korrekturen(vera)).at(-1), { datum: KW46, stunden: 2, grund: 'KW 46/2026: Sperre eines Codes geändert' });
  await db.query(`update pep.abwesenheitscodes set sperrt = true where filiale_id = $1 and code = 'T'`, [fil]);
  assert.deepEqual((await korrekturen(vera)).at(-1), { datum: KW46, stunden: -2, grund: 'KW 46/2026: Sperre eines Codes geändert' });
  await saldoStimmt(vera);
});

// ---------------------------------------------------------------------------------------------------------------
// Datenbank C (heute = 11.01.2027)
// ---------------------------------------------------------------------------------------------------------------

test('Jahreswechsel: Abschlüsse KW 52, 53/2026 und KW 1/2027; saldo_vorwoche von KW 1/2027 enthält KW 53', async () => {
  const { wocheBestaetigen, abschluss, zeilen, zkWoche, fritz, tina, otto, ines } = C;
  for (const [mo, jahr, kw] of [['2026-12-21', 2026, 52], ['2026-12-28', 2026, 53], ['2027-01-04', 2027, 1]]) {
    await wocheBestaetigen(mo);
    assert.deepEqual(await abschluss(jahr, kw), { gebucht: 2 }, `KW ${kw}`);
  }
  assert.deepEqual((await zeilen(fritz)).map((z) => [z.datum, z.stunden]),
    [['2026-12-21', -25], ['2026-12-28', -31.25], ['2027-01-04', -31.25]]);
  assert.deepEqual((await zeilen(tina)).map((z) => z.stunden), [-13.34, -16.67, -16.67]);
  assert.deepEqual(await zeilen(otto), []);
  assert.deepEqual(await zeilen(ines), [], 'inaktiv: keine Zeile woche');
  const kw1 = (await zkWoche(2027, 1)).mitarbeiter.find((m) => m.id === fritz);
  assert.deepEqual([Number(kw1.saldo_vorwoche), Number(kw1.saldo_aktuell)], [-56.25, -87.5]);
  const kw53 = (await zkWoche(2026, 53)).mitarbeiter.find((m) => m.id === fritz);
  assert.equal(Number(kw53.saldo_vorwoche), -25);
});

test('Feiertag 06.01.2027 nachträglich geöffnet: Korrektur für alle mit Vertrag (auch ohne Abwesenheit); zurück → Gegenbuchung', async () => {
  const { korrekturen, saldoStimmt, fritz, tina, otto, ines, leitung, speichern } = C;
  await speichern(ines, { aktiv: true }); // wieder aktiv, war beim Abschluss aber nicht dabei
  await als(C.db, 'authenticated', leitung, 'select public.pep_abweichung_speichern($1::date, $2::jsonb)', ['2027-01-06',
    JSON.stringify({ art: 'feiertag', geoeffnet: true, oeffnung_von: '07:00', oeffnung_bis: '20:00', rahmen_von: '06:00', rahmen_bis: '21:30' })]);
  assert.deepEqual(await korrekturen(fritz), [{ datum: '2027-01-04', stunden: -6.25, grund: 'KW 1/2027: Öffnungstag geändert' }]);
  assert.deepEqual(await korrekturen(tina), [{ datum: '2027-01-04', stunden: -3.33, grund: 'KW 1/2027: Öffnungstag geändert' }]);
  assert.deepEqual(await C.zeilen(otto), []);
  assert.deepEqual(await C.zeilen(ines), [], 'beim Abschluss inaktiv: keine Korrektur');
  await als(C.db, 'authenticated', leitung, 'select public.pep_abweichung_loeschen($1::date)', ['2027-01-06']);
  assert.deepEqual((await korrekturen(fritz)).map((k) => k.stunden), [-6.25, 6.25]);
  assert.deepEqual((await korrekturen(tina)).map((k) => k.stunden), [-3.33, 3.33]);
  assert.equal(await saldoStimmt(fritz), -87.5);
});

test('Feiertagsteiler geändert: Korrektur in jeder abgeschlossenen Woche mit Feiertag; anderer Schlüssel oder gleicher Wert nichts', async () => {
  const { korrekturen, saldoStimmt, anzahl, fritz, tina, otto, ines, leitung, db } = C;
  const setzen = (k, w) => als(db, 'authenticated', leitung, 'select public.pep_einstellung_setzen($1, $2::jsonb)', [k, w]);
  const vorher = (await korrekturen(fritz)).length;
  await setzen('feiertag_teiler', '5');
  assert.deepEqual((await korrekturen(fritz)).slice(vorher), [
    { datum: '2026-12-21', stunden: 2.5, grund: 'KW 52/2026: Feiertagsteiler geändert' },
    { datum: '2026-12-28', stunden: 1.25, grund: 'KW 53/2026: Feiertagsteiler geändert' },
    { datum: '2027-01-04', stunden: 1.25, grund: 'KW 1/2027: Feiertagsteiler geändert' }]);
  assert.deepEqual((await korrekturen(tina)).slice(-3).map((k) => k.stunden), [1.34, 0.67, 0.67]);
  assert.deepEqual(await C.zeilen(otto), []);
  assert.deepEqual(await C.zeilen(ines), []);
  const n = await anzahl();
  await setzen('feiertag_teiler', '5');
  await setzen('spaet_grenze', '"19:00"');
  assert.equal(await anzahl(), n);
  await setzen('feiertag_teiler', '6');
  assert.deepEqual((await korrekturen(fritz)).slice(-3).map((k) => k.stunden), [-2.5, -1.25, -1.25]);
  assert.equal(await saldoStimmt(fritz), -87.5);
});

test('Erster Abschluss nur in der Startwoche (ist_ab): KW 45 vor KW 44 → VORWOCHE_OFFEN, danach der Reihe nach', async () => {
  // Eigene Datenbank ohne Mitarbeiter (nichts offen): ist_ab = Mo 26.10.2026 (KW 44), heute 16.11.
  const D = await aufbau(HEUTE, '2026-10-26');
  await wirft(D.abschluss(2026, 45), 'VORWOCHE_OFFEN');
  await wirft(D.abschluss(2026, 43), 'VOR_IST_START');
  assert.deepEqual(await D.abschluss(2026, 44), { gebucht: 0 });
  assert.deepEqual(await D.abschluss(2026, 45), { gebucht: 0 });
  await wirft(D.abschluss(2026, 44), 'WOCHE_GEBUCHT');
});

test('gebucht: Inaktiver ohne Austritt und nach dem Abschluss Angelegter → Diff grau, nicht im Saldo aktuell; Regel wie der Abschluss', async () => {
  // Eigene Datenbank: Anna aktiv, Ina inaktiv ohne Austritt, beide ohne IST (Diff −37,5); Paul erst nach dem Abschluss.
  const D = await aufbau(HEUTE, KW46);
  const anna = await D.ma('Voll, Anna');
  const ina = await D.ma('Inaktiv, Ina');
  await D.speichern(ina, { aktiv: false });
  await D.wocheBestaetigen(KW46);
  const zeile = async (id) => (await D.zkWoche(2026, 46)).mitarbeiter.find((m) => m.id === id);
  const werte = async (id) => { const m = await zeile(id); return [m.gebucht, Number(m.diff), Number(m.saldo_aktuell)]; };
  // Offene Woche: gebucht = der Abschluss würde die Person buchen
  assert.deepEqual(await werte(anna), [true, -37.5, -37.5]);
  assert.deepEqual(await werte(ina), [false, -37.5, 0], 'inaktiv: Diff nicht im Saldo aktuell');
  const offen = (await D.zkWoche(2026, 46)).mitarbeiter;
  assert.deepEqual(await D.abschluss(2026, 46), { gebucht: offen.filter((m) => m.gebucht).length },
    'gebucht der offenen Woche = Zeilen des Abschlusses');
  // Abgeschlossene Woche: gebucht = Zeile woche vorhanden
  assert.deepEqual(await werte(anna), [true, -37.5, -37.5]);
  assert.deepEqual(await werte(ina), [false, -37.5, 0]);
  assert.deepEqual(await D.zeilen(ina), []);
  // Nach dem Abschluss angelegt, Vertrag seit 01.01.: Diff ohne Buchung
  const paul = await D.ma('Spaet, Paul');
  assert.deepEqual(await werte(paul), [false, -37.5, 0]);
  assert.deepEqual(await D.zeilen(paul), []);
});

test('Abwesenheits-Teiler geändert: Korrektur mit Grund „Abwesenheits-Teiler geändert“ (nicht „Abwesenheit geändert“)', async () => {
  // Eigene Datenbank: Urs mit U am Mo der abgeschlossenen KW 46 (6,25 h); Teiler 6 → 5 macht daraus 7,5 h.
  const D = await aufbau(HEUTE, KW46);
  const urs = await D.ma('Urlaub, Urs');
  await D.abwesend(urs, 'U', KW46);
  await D.wocheBestaetigen(KW46);
  await D.abschluss(2026, 46);
  await als(D.db, 'authenticated', D.leitung, `select public.pep_einstellung_setzen('abwesenheit_teiler', '5'::jsonb)`);
  assert.deepEqual(await D.korrekturen(urs), [{ datum: KW46, stunden: 1.25, grund: 'KW 46/2026: Abwesenheits-Teiler geändert' }]);
  // Der Grund gilt nur für diese Transaktion: eine spätere Änderung trägt wieder ihren eigenen Grund
  await D.abwesend(urs, 'U', tag(KW46, 1));
  assert.equal((await D.korrekturen(urs)).at(-1).grund, 'KW 46/2026: Abwesenheit geändert');
});

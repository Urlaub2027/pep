// Zeitkonto-Rechnung (Stufe 2, G1/G2): pep.zeitkonto_woche je Mitarbeiter und Woche, pep_zeitkonto_woche für den Browser.
// Stichtag heute = Mo 16.11.2026 (KW 47); vergangene Testwoche KW 46 = 09.–15.11.2026.
// Feiertagswochen: KW 52/2026 (Fr 25.12. und Sa 26.12. Weihnachten) und KW 1/2027 (Mi 06.01. Heilige Drei Könige,
// Bayern) mit heute = 11.01.2027 – beide Tage liefert urlaub.landesfeiertage(…, 'BY').
// Journal und Abschluss (Task 4) gibt es hier nur als Tabellen: die Saldo-Tests schreiben Zeilen direkt hinein.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, planGrundlage, heuteSetzen } from './helfer.mjs';

const HEUTE = '2026-11-16';
const KW46 = '2026-11-09';
// Tage Mo–Sa der KW 46
const TAGE = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];

let t; // gemeinsame Datenbank
let chef2, fremdMa, azubiNutzer;

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);
const uhr = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`;

before(async () => {
  const db = await neueDatenbank();
  const g = await planGrundlage(db, { heute: HEUTE });
  const { leitung, bereich, code, json } = g;
  const istSetzen = (maId, datum, bloecke) =>
    json(leitung, 'select public.pep_ist_zeile_setzen($1, $2::date, $3::jsonb, null) as r',
      [maId, datum, JSON.stringify(bloecke.map(([von, bis, k]) => ({ von, bis, bereich_id: bereich[k] })))]);
  const bestaetigen = (maId, datum) =>
    json(leitung, 'select public.pep_ist_bestaetigen($1::date, array[$2]::bigint[]) as r', [datum, maId]);
  // Je Tag Mo–Sa der KW 46 h Stunden KA ab 08:00 (0 = leer), bestätigt (offen = Tage, die unbestätigt bleiben).
  const woche = async (maId, stunden, { offen = [], ab = 8 } = {}) => {
    for (let i = 0; i < stunden.length; i++) {
      if (stunden[i] > 0) await istSetzen(maId, TAGE[i], [[uhr(ab), uhr(ab + stunden[i]), 'KA']]);
      if (!offen.includes(i)) await bestaetigen(maId, TAGE[i]);
    }
  };
  const abwesend = (maId, c, von, bis = von) =>
    json(leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, null, null, null, null) as r',
      [maId, code[c], von, bis]);
  const zk = async (maId, montag = KW46) =>
    (await db.query('select pep.zeitkonto_woche($1, $2::date) as z', [maId, montag])).rows[0].z;
  const zkWoche = (jahr, kw, nutzer = leitung) =>
    json(nutzer, 'select public.pep_zeitkonto_woche($1, $2) as r', [jahr, kw]);
  const abweichung = (datum, geoeffnet) => als(db, 'authenticated', leitung,
    'select public.pep_abweichung_speichern($1::date, $2::jsonb)', [datum, JSON.stringify(geoeffnet
      ? { art: 'feiertag', geoeffnet: true, oeffnung_von: '07:00', oeffnung_bis: '20:00', rahmen_von: '06:00', rahmen_bis: '21:30' }
      : { art: 'feiertag', geoeffnet: false })]);
  const abweichungLoeschen = (datum) => als(db, 'authenticated', leitung, 'select public.pep_abweichung_loeschen($1::date)', [datum]);
  t = { db, ...g, istSetzen, bestaetigen, woche, abwesend, zk, zkWoche, abweichung, abweichungLoeschen };

  chef2 = await pepBenutzer(db, 'chef2');
  await filiale(db, chef2, { name: 'Netto Zweitfiliale', nummer: '9999' });
  fremdMa = await json(chef2, `select public.pep_mitarbeiter_speichern(null, '{"name":"Fremd, Frieda"}') as r`);
  await als(db, 'authenticated', chef2, `select public.pep_vertrag_speichern($1, '{"vertragsart":"vollzeit","wochenstunden":37.5,"gueltig_ab":"2026-01-01"}')`, [fremdMa]);
  azubiNutzer = await pepBenutzer(db, 'azubi', 'mitarbeiter', g.fil);
});

// Nur die Rechenfelder (ohne vertragsart), als Zahlen.
const zahlen = (z) => Object.fromEntries(Object.entries(z).filter(([k]) => k !== 'vertragsart')
  .map(([k, v]) => [k, v === null ? null : Number(v)]));

test('Vollzeit 37,5: Mo–Fr je 8 h bestätigt, Sa frei → ist 40, diff 2,5; Mi unbestätigt → ist 32, 1 Tag offen', async () => {
  const a = await t.ma('Voll, Anna');
  await t.woche(a, [8, 8, 8, 8, 8, 0]);
  const z = await t.zk(a);
  assert.equal(z.vertragsart, 'vollzeit');
  assert.deepEqual(zahlen(z), { wochenstunden: 37.5, soll: 37.5, grenze: null, ist: 40, abwesend: 0, feiertag: 0,
    summe: 40, diff: 2.5, spaet: 0, offene_tage: 0 });

  const b = await t.ma('Voll, Berta');
  await t.woche(b, [8, 8, 8, 8, 8, 0], { offen: [2] });
  const zb = zahlen(await t.zk(b));
  assert.equal(zb.ist, 32);
  assert.equal(zb.offene_tage, 1);
  assert.equal(zb.diff, -5.5);
  // Bestätigen zählt den Mittwoch mit
  await t.bestaetigen(b, TAGE[2]);
  assert.deepEqual([zahlen(await t.zk(b)).ist, zahlen(await t.zk(b)).offene_tage], [40, 0]);
  // Sonntag (geschlossen) mit bestätigtem IST zählt mit (Inventur), ohne IST ist er nie offen
  const c = await t.ma('Voll, Carla');
  await t.woche(c, [8, 8, 8, 8, 8, 0]);
  await t.istSetzen(c, '2026-11-15', [['10:00', '12:00', 'KA']]);
  assert.equal(zahlen(await t.zk(c)).offene_tage, 1, 'unbestätigtes IST am Sonntag ist offen');
  assert.equal(zahlen(await t.zk(c)).ist, 40);
  await t.bestaetigen(c, '2026-11-15');
  assert.deepEqual([zahlen(await t.zk(c)).ist, zahlen(await t.zk(c)).offene_tage], [42, 0]);
});

test('Abwesenheit: U Mo–Sa → abwesend 37,5, diff 0; ZA Mo (gutschrift false) + 4 × 8 h → abwesend 0, diff −5,5', async () => {
  const u = await t.ma('Urlaub, Uwe');
  await t.abwesend(u, 'U', TAGE[0], TAGE[5]);
  assert.deepEqual(zahlen(await t.zk(u)), { wochenstunden: 37.5, soll: 37.5, grenze: null, ist: 0, abwesend: 37.5,
    feiertag: 0, summe: 37.5, diff: 0, spaet: 0, offene_tage: 0 });

  const za = await t.ma('Ausgleich, Zora');
  await t.abwesend(za, 'ZA', TAGE[0]);
  await t.woche(za, [0, 8, 8, 8, 8, 0], { offen: [0] });
  const z = zahlen(await t.zk(za));
  assert.deepEqual([z.ist, z.abwesend, z.summe, z.diff, z.offene_tage], [32, 0, 32, -5.5, 0]);
});

test('Feiertag KW 1/2027: Mi 06.01. geschlossen → Feiertag 6,25, soll 37,5; als geöffnet eingestellt → 0', async () => {
  await heuteSetzen(t.db, '2027-01-11');
  try {
    const f = await t.ma('Feier, Fritz');
    const tz = await t.ma('Teil, Tina', { stunden: 20, art: 'teilzeit' });
    let z = zahlen(await t.zk(f, '2027-01-04'));
    assert.deepEqual([z.soll, z.feiertag, z.ist, z.summe, z.diff], [37.5, 6.25, 0, 6.25, -31.25]);
    assert.equal(z.offene_tage, 5, 'Mo, Di, Do, Fr, Sa offen – der geschlossene Feiertag nicht');
    assert.equal(zahlen(await t.zk(tz, '2027-01-04')).feiertag, 3.33, 'round(20 / 6, 2)');

    await t.abweichung('2027-01-06', true);
    z = zahlen(await t.zk(f, '2027-01-04'));
    assert.deepEqual([z.feiertag, z.diff, z.offene_tage], [0, -37.5, 6]);
    await t.abweichungLoeschen('2027-01-06');
    assert.equal(zahlen(await t.zk(f, '2027-01-04')).feiertag, 6.25);
  } finally {
    await heuteSetzen(t.db, HEUTE);
  }
});

test('Feiertag am Samstag (26.12.2026) gibt Gutschrift; geöffneter Feiertag nicht', async () => {
  await heuteSetzen(t.db, '2027-01-11');
  try {
    const s = await t.ma('Samstag, Sina');
    const tz = await t.ma('Samstag, Teo', { stunden: 20, art: 'teilzeit' });
    // KW 52/2026: Fr 25.12. und Sa 26.12. geschlossen
    assert.equal(zahlen(await t.zk(s, '2026-12-21')).feiertag, 12.5);
    assert.equal(zahlen(await t.zk(tz, '2026-12-21')).feiertag, 6.66, '2 × round(20 / 6, 2)');
    // Fr 25.12. als geöffnet eingestellt → nur noch der Samstag
    await t.abweichung('2026-12-25', true);
    const z = zahlen(await t.zk(s, '2026-12-21'));
    assert.deepEqual([z.feiertag, z.soll, z.diff], [6.25, 37.5, -31.25]);
    await t.abweichungLoeschen('2026-12-25');
    // Ein nicht gesetzlicher Tag, den die Filiale schließt (Heiligabend), gibt keine Gutschrift
    await t.abweichung('2026-12-24', false);
    assert.equal(zahlen(await t.zk(s, '2026-12-21')).feiertag, 12.5);
    await t.abweichungLoeschen('2026-12-24');
  } finally {
    await heuteSetzen(t.db, HEUTE);
  }
});

test('Feiertag hat Vorrang vor Abwesenheit: U bei geöffnetem Feiertag, danach wieder geschlossen → nicht doppelt', async () => {
  await heuteSetzen(t.db, '2027-01-11');
  try {
    // geöffnet → U 04.–09.01. (6 × 6,25) → Öffnung gelöscht
    const u = await t.ma('Doppel, Dora');
    await t.abweichung('2027-01-06', true);
    await t.abwesend(u, 'U', '2027-01-04', '2027-01-09');
    let z = zahlen(await t.zk(u, '2027-01-04'));
    assert.deepEqual([z.abwesend, z.feiertag, z.diff], [37.5, 0, 0], 'solange geöffnet: Urlaub zählt');
    await t.abweichungLoeschen('2027-01-06');
    z = zahlen(await t.zk(u, '2027-01-04'));
    assert.deepEqual([z.soll, z.abwesend, z.feiertag, z.summe, z.diff], [37.5, 31.25, 6.25, 37.5, 0]);
    // dasselbe mit „geschlossen“ als Abweichung statt Löschen
    await t.abweichung('2027-01-06', false);
    z = zahlen(await t.zk(u, '2027-01-04'));
    assert.deepEqual([z.abwesend, z.feiertag, z.diff], [31.25, 6.25, 0]);
    await t.abweichungLoeschen('2027-01-06');

    // FT an einem als geöffnet eingestellten Feiertag zählt genau einmal – geöffnet wie geschlossen
    const ft = await t.ma('Doppel, Fiona');
    await t.abweichung('2027-01-06', true);
    await t.abwesend(ft, 'FT', '2027-01-06');
    z = zahlen(await t.zk(ft, '2027-01-04'));
    assert.deepEqual([z.abwesend, z.feiertag, z.summe], [6.25, 0, 6.25]);
    await t.abweichungLoeschen('2027-01-06');
    z = zahlen(await t.zk(ft, '2027-01-04'));
    assert.deepEqual([z.abwesend, z.feiertag, z.summe], [0, 6.25, 6.25]);
  } finally {
    await heuteSetzen(t.db, HEUTE);
  }
});

test('Geschlossener Nicht-Feiertag (Heiligabend): Urlaub behält die Gutschrift', async () => {
  await heuteSetzen(t.db, '2027-01-11');
  try {
    const h = await t.ma('Heilig, Hanna');
    await t.abwesend(h, 'U', '2026-12-24');
    await t.abweichung('2026-12-24', false);
    const z = zahlen(await t.zk(h, '2026-12-21'));
    assert.deepEqual([z.soll, z.abwesend, z.feiertag, z.summe], [37.5, 6.25, 12.5, 18.75]);
    await t.abweichungLoeschen('2026-12-24');
  } finally {
    await heuteSetzen(t.db, HEUTE);
  }
});

test('Abwesenheit zählt nur an beschäftigten Tagen: Austritt Mi, Urlaub Mo und Do → nur Mo', async () => {
  const a = await t.ma('Austritt, Ali');
  await t.abwesend(a, 'U', TAGE[0]);
  await t.abwesend(a, 'U', TAGE[3]);
  assert.equal(zahlen(await t.zk(a)).abwesend, 12.5);
  await t.db.query("update pep.mitarbeiter set austritt = '2026-11-11' where id = $1", [a]);
  const z = zahlen(await t.zk(a));
  assert.deepEqual([z.soll, z.abwesend, z.diff], [18.75, 6.25, -12.5]);
});

test('Eintritt Mi 11.11.2026 → 4 beschäftigte Tage, soll 25,0 (Führung: grenze 28); Austritt Fr → soll 31,25', async () => {
  const e = await t.ma('Neu, Nora');
  await t.db.query("update pep.mitarbeiter set eintritt = '2026-11-11' where id = $1", [e]);
  let z = zahlen(await t.zk(e));
  assert.deepEqual([z.soll, z.diff, z.offene_tage], [25, -25, 4]);

  const fe = await t.ma('Neu, Felix', { art: 'fuehrung', stunden: 37.5 });
  await t.db.query("update pep.mitarbeiter set eintritt = '2026-11-11' where id = $1", [fe]);
  z = zahlen(await t.zk(fe));
  assert.deepEqual([z.soll, z.grenze], [25, 28]);

  const a = await t.ma('Alt, Albert');
  await t.db.query("update pep.mitarbeiter set austritt = '2026-11-13' where id = $1", [a]);
  z = zahlen(await t.zk(a));
  assert.deepEqual([z.soll, z.offene_tage], [31.25, 5]);
  // Vertrag erst ab Do 12.11. → beschäftigt Do–Sa
  const v = await t.ma('Spaet, Vera', { ab: '2026-11-12' });
  assert.equal(zahlen(await t.zk(v)).soll, 18.75);
  // Feiertag zählt nur an beschäftigten Tagen: Eintritt Do 07.01.2027 → kein Feiertag in KW 1/2027
  const n = await t.ma('Neu, Jana');
  await t.db.query("update pep.mitarbeiter set eintritt = '2027-01-07' where id = $1", [n]);
  z = zahlen(await t.zk(n, '2027-01-04'));
  assert.deepEqual([z.soll, z.feiertag], [18.75, 0]);
});

test('ohne Vertrag oder nicht beschäftigt in der Woche → NULL', async () => {
  const o = await t.json(t.leitung, `select public.pep_mitarbeiter_speichern(null, '{"name":"Ohne, Otto"}') as r`);
  assert.equal(await t.zk(o), null);
  const spaeter = await t.ma('Spaeter, Paul', { ab: '2026-11-16' });
  assert.equal(await t.zk(spaeter), null, 'Vertrag erst nach der Woche');
  const weg = await t.ma('Weg, Wanda');
  await t.db.query("update pep.mitarbeiter set austritt = '2026-11-06' where id = $1", [weg]);
  assert.equal(await t.zk(weg), null, 'vor der Woche ausgetreten');
  assert.equal(zahlen(await t.zk(weg, '2026-11-02')).soll, 31.25, 'Woche des Austritts');
  const kommt = await t.ma('Kommt, Karl');
  await t.db.query("update pep.mitarbeiter set eintritt = '2026-11-16' where id = $1", [kommt]);
  assert.equal(await t.zk(kommt), null, 'erst nach der Woche eingetreten');
  const liste = (await t.zkWoche(2026, 46)).mitarbeiter.map((m) => m.id);
  for (const id of [o, spaeter, weg, kommt]) assert.ok(!liste.includes(id), `${id} nicht in der Liste`);
});

test('Führung: über der Grenze Plus, unter dem Soll Minus, dazwischen 0', async () => {
  const faelle = [
    // [wochenstunden, Stunden Mo–Sa, summe, diff]
    [42, [9, 9, 9, 9, 9, 0], 45, 3],
    [42, [7, 7, 7, 7, 7, 7], 42, 0],
    [42, [8, 8, 8, 8, 8, 0], 40, -2],
    [37.5, [8, 8, 8, 8, 8, 0], 40, 0],
    [37.5, [9, 9, 9, 9, 8, 0], 44, 2],
    [37.5, [7, 7, 7, 7, 7, 0], 35, -2.5],
  ];
  for (const [i, [ws, std, summe, diff]] of faelle.entries()) {
    const id = await t.ma(`Fuehrung, F${i}`, { art: 'fuehrung', stunden: ws });
    await t.woche(id, std);
    const z = await t.zk(id);
    assert.equal(z.vertragsart, 'fuehrung');
    const n = zahlen(z);
    assert.deepEqual([n.wochenstunden, n.soll, n.grenze, n.summe, n.diff], [ws, ws, 42, summe, diff], `Fall ${i}`);
  }
  // Grenze aus dem Vertrag (zeitkonto_grenze 45): summe 45 → 0
  const g = await t.ma('Fuehrung, Grenze', { art: 'fuehrung', stunden: 42 });
  await t.db.query('update pep.vertraege set zeitkonto_grenze = 45 where mitarbeiter_id = $1', [g]);
  await t.woche(g, [9, 9, 9, 9, 9, 0]);
  assert.deepEqual([zahlen(await t.zk(g)).grenze, zahlen(await t.zk(g)).diff], [45, 0]);
});

test('Spätstunden: IST 14–20 mit Pause 17–17:30 → spaet 2,0; unbestätigt und unbesetzt zählen nicht', async () => {
  const s = await t.ma('Spaet, Sven');
  await t.istSetzen(s, TAGE[0], [['14:00', '17:00', 'KA'], ['17:00', '17:30', 'PA'], ['17:30', '20:00', 'KA']]);
  await t.bestaetigen(s, TAGE[0]);
  let z = zahlen(await t.zk(s));
  assert.deepEqual([z.ist, z.spaet], [5.5, 2]);
  // Di 18–21 unbestätigt: zählt nicht
  await t.istSetzen(s, TAGE[1], [['18:00', '21:00', 'KA']]);
  z = zahlen(await t.zk(s));
  assert.deepEqual([z.ist, z.spaet], [5.5, 2]);
  // Pause nach der Grenze zählt nicht: Mi 17–19 KA, 19–19:30 PA, 19:30–20 KA → 1,5 spät
  await t.istSetzen(s, TAGE[2], [['17:00', '19:00', 'KA'], ['19:00', '19:30', 'PA'], ['19:30', '20:00', 'KA']]);
  await t.bestaetigen(s, TAGE[2]);
  z = zahlen(await t.zk(s));
  assert.deepEqual([z.ist, z.spaet], [8, 3.5]);
  // Unbesetzt (sperrende Abwesenheit) zählt nicht: Do 18–20 bestätigt, danach Krank 19–20 → nur 18–19
  await t.istSetzen(s, TAGE[3], [['18:00', '20:00', 'KA']]);
  await t.bestaetigen(s, TAGE[3]);
  await t.json(t.leitung, `select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, 1, '19:00', '20:00', null) as r`,
    [s, t.code.KM, TAGE[3]]);
  z = zahlen(await t.zk(s));
  assert.deepEqual([z.ist, z.spaet, z.abwesend], [9, 4.5, 1]);
  // Grenze aus den Einstellungen (19:00): Mo 1,0 + Mi 0,5
  await als(t.db, 'authenticated', t.leitung, `select public.pep_einstellung_setzen('spaet_grenze', '"19:00"')`);
  try {
    assert.equal(zahlen(await t.zk(s)).spaet, 1.5);
  } finally {
    await als(t.db, 'authenticated', t.leitung, `select public.pep_einstellung_setzen('spaet_grenze', '"18:00"')`);
  }
});

test('pep_zeitkonto_woche ohne Buchungen: saldo_vorwoche 0, saldo_aktuell = diff, Warnung plus über 37,5', async () => {
  const w = await t.ma('Viel, Willi');
  await t.woche(w, [13, 13, 13, 13, 13, 13], { ab: 4 }); // 78 h → diff 40,5
  const grenzfall = await t.ma('Grenz, Gabi');
  await t.woche(grenzfall, [12.5, 12.5, 12.5, 12.5, 12.5, 12.5], { ab: 4 }); // 75 h → diff 37,5
  const r = await t.zkWoche(2026, 46);
  assert.deepEqual([r.jahr, r.kw, r.montag, r.abgeschlossen], [2026, 46, KW46, null]);
  assert.ok(r.mitarbeiter.length > 5);
  for (const m of r.mitarbeiter) {
    const z = await t.zk(m.id);
    for (const k of Object.keys(z)) assert.deepEqual(m[k], z[k], `${m.name}: ${k}`);
    assert.equal(Number(m.saldo_vorwoche), 0);
    assert.equal(Number(m.saldo_aktuell), Number(m.diff));
    const erwartet = Number(m.diff) > Number(m.wochenstunden) ? 'plus'
      : Number(m.diff) < -Number(m.wochenstunden) ? 'minus' : null;
    assert.equal(m.warnung, erwartet, m.name);
  }
  const willi = r.mitarbeiter.find((m) => m.id === w);
  assert.deepEqual([willi.name, Number(willi.diff), willi.warnung], ['Viel, Willi', 40.5, 'plus']);
  // genau auf der Grenze (diff 37,5 = Faktor 1 × 37,5) keine Warnung
  const gl = r.mitarbeiter.find((m) => m.id === grenzfall);
  assert.deepEqual([Number(gl.diff), gl.warnung], [37.5, null]);
  // offene Tage der Filiale = Summe der offenen Tage je Mitarbeiter
  assert.equal(r.offene_tage, r.mitarbeiter.reduce((s, m) => s + m.offene_tage, 0));
  assert.ok(r.offene_tage > 0);
  // Reihenfolge wie im Raster (aktiv, position, name, id)
  const reihenfolge = (await t.db.query(`select id from pep.mitarbeiter where id = any ($1)
    order by aktiv desc, position, name, id`, [r.mitarbeiter.map((m) => m.id)])).rows.map((x) => Number(x.id));
  assert.deepEqual(r.mitarbeiter.map((m) => m.id), reihenfolge);
  // Faktor 2 → keine Warnung mehr für Willi
  await als(t.db, 'authenticated', t.leitung, `select public.pep_einstellung_setzen('zeitkonto_warnfaktor', '2')`);
  try {
    assert.equal((await t.zkWoche(2026, 46)).mitarbeiter.find((m) => m.id === w).warnung, null);
  } finally {
    await als(t.db, 'authenticated', t.leitung, `select public.pep_einstellung_setzen('zeitkonto_warnfaktor', '1')`);
  }
  await wirft(t.zkWoche(2026, 54), 'DATUM_UNGUELTIG');
});

test('pep_zeitkonto_woche: fremde Filiale, Rolle mitarbeiter → NUR_LEITUNG, Stellvertretung darf lesen', async () => {
  const eigen = await t.zkWoche(2026, 46);
  assert.ok(!eigen.mitarbeiter.some((m) => m.id === fremdMa));
  const fremd = await t.zkWoche(2026, 46, chef2);
  assert.deepEqual(fremd.mitarbeiter.map((m) => m.id), [fremdMa]);
  assert.equal(fremd.offene_tage, 6);
  await wirft(t.zkWoche(2026, 46, azubiNutzer), 'NUR_LEITUNG');
  assert.deepEqual(await t.zkWoche(2026, 46, t.stellv), eigen);
});

// Schreibt Journal- und Abschlusszeilen direkt (Buchungsfunktionen kommen mit Task 4); darum nach allen Tests, die
// pep_zeitkonto_woche ohne Buchungen erwarten. Danach läuft nur noch der Tabellen-Test.
test('Saldo aus dem Journal: Vorwoche über Datum (auch KW 53), abgeschlossene Woche ohne erneutes diff, Warnung minus', async () => {
  const k = await t.ma('Konto, Kai'); // KW 46 ohne IST: diff −37,5
  const anna = (await t.zkWoche(2026, 46)).mitarbeiter.find((m) => m.name === 'Voll, Anna').id;
  const buchen = (maId, datum, art, stunden) => t.db.query(`insert into pep.zeitkonto_buchungen
      (filiale_id, mitarbeiter_id, datum, art, stunden, saldo_nach, grund) values ($1, $2, $3::date, $4, $5, 0, 'Test')`,
  [t.fil, maId, datum, art, stunden]);
  await buchen(k, '2026-11-02', 'start', -10);
  await buchen(k, '2026-11-10', 'manuell', 5);
  await buchen(k, '2026-11-16', 'manuell', 100); // nach der Woche: zählt in KW 46 nicht
  let m = (await t.zkWoche(2026, 46)).mitarbeiter.find((x) => x.id === k);
  assert.deepEqual([Number(m.diff), Number(m.saldo_vorwoche), Number(m.saldo_aktuell), m.warnung], [-37.5, -10, -42.5, 'minus']);

  // Woche abgeschlossen: saldo_aktuell = Vorwoche + Buchungen der Woche (diff steckt in der Buchung „woche“)
  await t.db.query(`insert into pep.wochen_abschluesse (filiale_id, montag, abgeschlossen_von) values ($1, $2::date, $3)`,
    [t.fil, KW46, t.leitung]);
  await buchen(anna, KW46, 'woche', 2.5);
  await buchen(k, KW46, 'woche', -37.5);
  const r = await t.zkWoche(2026, 46);
  assert.equal(r.abgeschlossen.von_name, 'chef');
  assert.ok(r.abgeschlossen.am);
  m = r.mitarbeiter.find((x) => x.id === k);
  assert.deepEqual([Number(m.saldo_vorwoche), Number(m.saldo_aktuell), m.warnung], [-10, -42.5, 'minus']);
  assert.equal(Number(r.mitarbeiter.find((x) => x.id === anna).saldo_aktuell), 2.5);
  // KW 47: Vorwoche = alles vor dem 16.11.
  const r47 = await t.zkWoche(2026, 47);
  assert.equal(r47.abgeschlossen, null);
  assert.equal(Number(r47.mitarbeiter.find((x) => x.id === anna).saldo_vorwoche), 2.5);
  assert.equal(Number(r47.mitarbeiter.find((x) => x.id === k).saldo_vorwoche), -42.5);

  // Jahreswechsel: Buchung am Montag der KW 53/2026 (28.12.) zählt zur Vorwoche von KW 1/2027, nicht zu KW 53
  await buchen(anna, '2026-12-28', 'korrektur', 1.5);
  await heuteSetzen(t.db, '2027-01-11');
  try {
    assert.equal(Number((await t.zkWoche(2027, 1)).mitarbeiter.find((x) => x.id === anna).saldo_vorwoche), 4);
    assert.equal(Number((await t.zkWoche(2026, 53)).mitarbeiter.find((x) => x.id === anna).saldo_vorwoche), 2.5);
  } finally {
    await heuteSetzen(t.db, HEUTE);
  }

  // Nur eine Buchung „woche“ je Mitarbeiter und Montag
  await assert.rejects(buchen(k, KW46, 'woche', 1), /duplicate|unique/i);
  // Wochenbuchungen tragen den Montag
  await assert.rejects(buchen(k, '2026-11-10', 'woche', 1), /check/i);
});

test('Tabellen: RLS an, Browser-Rollen haben keinen direkten Zugriff', async () => {
  const r = (await t.db.query(`select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pep' and relname in ('zeitkonto_buchungen', 'wochen_abschluesse') order by relname`)).rows;
  assert.deepEqual(r, [{ relname: 'wochen_abschluesse', relrowsecurity: true }, { relname: 'zeitkonto_buchungen', relrowsecurity: true }]);
  await assert.rejects(als(t.db, 'authenticated', t.leitung, 'select * from pep.zeitkonto_buchungen'), /permission denied/);
});

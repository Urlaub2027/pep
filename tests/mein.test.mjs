// Mitarbeiter-Ansicht (Stufe 3, Task 4): pep_mein_wochen, pep_mein_plan, pep_mein_urlaub, pep_mein_zeitkonto.
// Leitung „chef“ mit Filiale und Datenschutztext; heute = Mo 02.11.2026 (KW 45), Testwoche KW 46 (09.–15.11.2026).
// Am Di 10.11.: Ida (Konto, zugestimmt) arbeitet mit Pause, Jo, Ben und Uwe arbeiten, Kai arbeitet vormittags und ist
// nachmittags krank (KM stundenweise), Lea hat ganztägig Urlaub ohne Blöcke; Ola arbeitet in einer zweiten Filiale.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, planGrundlage, pepBenutzer, filiale, registriereMitarbeiter } from './helfer.mjs';

let db, leitung, fil, code, json, ma, malen, ida, idaU, jo, kai, lea, ben, uwe, ola, chef2;

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);
const freigeben = (jahr, kw, nutzer = leitung) =>
  json(nutzer, 'select public.pep_woche_freigeben($1, $2, true) as r', [jahr, kw]);
const abwesend = (maId, kuerzel, datum, stunden = null, von = null, bis = null) =>
  als(db, 'authenticated', leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, $4, $5, $6, null)',
    [maId, code[kuerzel], datum, stunden, von, bis]);
const mein = {
  wochen: (u) => json(u, 'select public.pep_mein_wochen() as r'),
  plan: (u, jahr, kw) => json(u, 'select public.pep_mein_plan($1, $2) as r', [jahr, kw]),
  urlaub: (u, jahr) => json(u, 'select public.pep_mein_urlaub($1) as r', [jahr]),
  zeitkonto: (u) => json(u, 'select public.pep_mein_zeitkonto() as r'),
};
// Schalter „Kollegen in der Mitarbeiter-Ansicht“ der Leitung; null entfernt die Zeile (Vorgabe).
const kollegenSchalter = (w) => (w === null
  ? db.query("delete from pep.einstellungen where filiale_id = $1 and schluessel = 'mitarbeiter_kollegen'", [fil])
  : als(db, 'authenticated', leitung, 'select public.pep_einstellung_setzen($1, $2::jsonb)', ['mitarbeiter_kollegen', JSON.stringify(w)]));
// Interne Rechnungen als Eigentümer, zum Vergleich.
const tagStatus = async (datum) => (await db.query('select * from pep.tag_status($1, $2::date)', [fil, datum])).rows[0];

// Mitarbeiter mit eingelöster Einladung; mit zustimmung auch der aktuellen Datenschutz-Version zugestimmt.
async function konto(maId, benutzername, { zustimmung = true } = {}) {
  const { code: einl } = await json(leitung, 'select public.pep_zugang_einladen($1) as r', [maId]);
  const u = await registriereMitarbeiter(db, benutzername, einl);
  if (zustimmung) {
    const { version } = (await json(u, 'select public.pep_mein_konto() as r')).zustimmung;
    await als(db, 'authenticated', u, 'select public.pep_mein_zustimmen($1)', [version]);
  }
  return u;
}

before(async () => {
  db = await neueDatenbank();
  ({ leitung, fil, code, json, ma, malen } = await planGrundlage(db));
  await json(leitung, 'select public.pep_datenschutz_speichern($1) as r', ['Datenschutzhinweis (Entwurf)']);
  ida = await ma('Test, Ida');
  jo = await ma('Test, Jo');
  kai = await ma('Test, Kai');
  lea = await ma('Test, Lea');
  ben = await ma('Test, Ben');
  uwe = await ma('Test, Uwe');
  idaU = await konto(ida, 'ida');

  // Di 10.11.
  await malen(leitung, ida, '2026-11-10', '08:00', '12:00', 'KA');
  await malen(leitung, ida, '2026-11-10', '12:00', '12:30', 'PA');
  await malen(leitung, ida, '2026-11-10', '12:30', '16:30', 'KA');
  await als(db, 'authenticated', leitung, `select public.pep_kommentar_setzen($1, '2026-11-10', 'Kasse 2 einräumen')`, [ida]);
  await malen(leitung, jo, '2026-11-10', '07:00', '10:00', 'KA');
  await malen(leitung, jo, '2026-11-10', '10:00', '12:00', 'OG'); // grenzt an: ein Zeitraum 07:00–12:00
  await malen(leitung, jo, '2026-11-10', '12:00', '12:30', 'PA');
  await malen(leitung, jo, '2026-11-10', '12:30', '14:00', 'OG');
  await malen(leitung, uwe, '2026-11-10', '08:00', '10:00', 'OG');
  await malen(leitung, ben, '2026-11-10', '08:00', '11:00', 'OG');
  await malen(leitung, kai, '2026-11-10', '08:00', '12:00', 'KA');
  await abwesend(kai, 'KM', '2026-11-10', 4, '13:00', '17:00');
  await abwesend(lea, 'U', '2026-11-10');
  // Mi 11.11.: Ida ganztägig Urlaub; Do 12.11.: Ida vormittags Kasse, nachmittags Zeitausgleich
  await abwesend(ida, 'U', '2026-11-11');
  await malen(leitung, ida, '2026-11-12', '08:00', '12:00', 'KA');
  await abwesend(ida, 'ZA', '2026-11-12', 2, '13:00', '15:00');

  // Zweite Filiale mit Ola am selben Tag
  chef2 = await pepBenutzer(db, 'chef2');
  const fil2 = await filiale(db, chef2, { name: 'Netto Zweit', nummer: '2559' });
  ola = await json(chef2, `select public.pep_mitarbeiter_speichern(null, '{"name":"Test, Ola"}') as r`);
  await als(db, 'authenticated', chef2, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
    [ola, JSON.stringify({ vertragsart: 'vollzeit', wochenstunden: 37.5, gueltig_ab: '2026-01-01' })]);
  const og2 = (await db.query(`select id from pep.bereiche where filiale_id = $1 and kuerzel = 'OG'`, [fil2])).rows[0].id;
  await json(chef2, `select public.pep_plan_malen($1, '2026-11-10', '08:00', '12:00', $2) as r`, [ola, og2]);

  await freigeben(2026, 46);
  await freigeben(2026, 46, chef2);
  await freigeben(2026, 47, chef2); // nur die zweite Filiale
});

test('nicht freigegebene Woche → WOCHE_NICHT_FREIGEGEBEN; KW 54, andere Filiale, ungültige Eingaben → derselbe Code', async () => {
  await wirft(mein.plan(idaU, 2026, 48), 'WOCHE_NICHT_FREIGEGEBEN'); // nicht freigegeben
  await wirft(mein.plan(idaU, 2026, 47), 'WOCHE_NICHT_FREIGEGEBEN'); // nur in der anderen Filiale freigegeben
  await wirft(mein.plan(idaU, 2026, 54), 'WOCHE_NICHT_FREIGEGEBEN'); // gibt es nicht (kein DATUM_UNGUELTIG)
  await wirft(mein.plan(idaU, 2027, 53), 'WOCHE_NICHT_FREIGEGEBEN');
  await wirft(mein.plan(idaU, 2026, 0), 'WOCHE_NICHT_FREIGEGEBEN');
  await wirft(mein.plan(idaU, 1999, 46), 'WOCHE_NICHT_FREIGEGEBEN');
  await wirft(mein.plan(idaU, null, null), 'WOCHE_NICHT_FREIGEGEBEN');
});

test('eigener Plan mit Blöcken, Pause, Kommentar, eigener Abwesenheit', async () => {
  const r = await mein.plan(idaU, 2026, 46);
  assert.deepEqual(Object.keys(r).sort(), ['jahr', 'kw', 'tage', 'zuletzt_geaendert']);
  assert.equal(r.jahr, 2026);
  assert.equal(r.kw, 46);
  assert.equal(r.zuletzt_geaendert, null); // seit der Freigabe nichts geändert (Gegenprobe im Test zu pep_mein_wochen)
  assert.deepEqual(r.tage.map((t) => t.datum),
    ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  for (const t of r.tage) {
    assert.deepEqual(Object.keys(t).sort(),
      ['abwesenheit', 'bloecke', 'datum', 'feiertag', 'geoeffnet', 'kollegen', 'kommentar'], t.datum);
    const s = await tagStatus(t.datum);
    assert.equal(t.geoeffnet, s.geoeffnet, t.datum);
    assert.equal(t.feiertag, s.feiertag, t.datum);
  }
  const [mo, di, mi, don] = r.tage;
  assert.deepEqual(mo.bloecke, []);
  assert.equal(mo.kommentar, null);
  assert.equal(mo.abwesenheit, null);
  assert.deepEqual(di.bloecke, [
    { von: '08:00', bis: '12:00', bereich_kuerzel: 'KA', bereich_name: 'Kasse', pause: false },
    { von: '12:00', bis: '12:30', bereich_kuerzel: 'PA', bereich_name: 'Pause', pause: true },
    { von: '12:30', bis: '16:30', bereich_kuerzel: 'KA', bereich_name: 'Kasse', pause: false },
  ]);
  assert.equal(di.kommentar, 'Kasse 2 einräumen');
  assert.equal(di.abwesenheit, null);
  const uStunden = Number((await db.query(`select stunden from pep.abwesenheiten where mitarbeiter_id = $1 and datum = '2026-11-11'`,
    [ida])).rows[0].stunden);
  assert.ok(uStunden > 0);
  assert.deepEqual(mi.abwesenheit, { code: 'U', name: 'Urlaub', stunden: uStunden, von: null, bis: null });
  assert.deepEqual(mi.bloecke, []);
  // Stundenweise neben Blöcken am selben Tag
  assert.deepEqual(don.bloecke, [{ von: '08:00', bis: '12:00', bereich_kuerzel: 'KA', bereich_name: 'Kasse', pause: false }]);
  assert.equal(don.abwesenheit.code, 'ZA');
  assert.equal(don.abwesenheit.stunden, 2);
  assert.equal(don.abwesenheit.von, '13:00');
  assert.equal(don.abwesenheit.bis, '15:00');
  assert.ok(don.abwesenheit.name);
});

test('Kollegen (Schalter an): Jo mit Zeiten; Kai, Lea, Ola tauchen nirgends im JSON auf', async () => {
  await kollegenSchalter(true);
  const r = await mein.plan(idaU, 2026, 46);
  const di = r.tage[1];
  // Pausen zählen nicht, aneinandergrenzende Blöcke sind ein Zeitraum; nach erster Zeit, dann Name; nur Name und Zeiten.
  assert.deepEqual(di.kollegen, [
    { name: 'Test, Jo', zeiten: [{ von: '07:00', bis: '12:00' }, { von: '12:30', bis: '14:00' }] },
    { name: 'Test, Ben', zeiten: [{ von: '08:00', bis: '11:00' }] },
    { name: 'Test, Uwe', zeiten: [{ von: '08:00', bis: '10:00' }] },
  ]);
  // Ida sieht sich selbst nicht als Kollegin
  for (const t of r.tage) assert.ok(!t.kollegen.some((k) => k.name === 'Test, Ida'), t.datum);
  // Kein Abwesenheits-Leck: weder Name noch Code noch Grund, in keiner der vier Antworten
  const alle = [r, await mein.wochen(idaU), await mein.urlaub(idaU, 2026), await mein.zeitkonto(idaU)];
  for (const x of alle) {
    const s = JSON.stringify(x);
    for (const name of ['Kai', 'Lea', 'Ola']) assert.ok(!s.includes(name), `${name} in ${s}`);
    assert.ok(!s.includes('"KM"'), `KM in ${s}`);
    assert.ok(!s.includes('Krank'), `Krank in ${s}`);
  }
  // Gegenprobe: Kai hat am Tag Blöcke, Lea eine Abwesenheit, Ola Blöcke in der anderen Filiale
  for (const id of [kai, ola]) {
    assert.ok((await db.query(`select 1 from pep.plan_bloecke where mitarbeiter_id = $1 and datum = '2026-11-10'`, [id])).rows.length);
  }
  assert.ok((await db.query(`select 1 from pep.abwesenheiten where mitarbeiter_id = $1 and datum = '2026-11-10'`, [lea])).rows.length);
  await kollegenSchalter(null);
});

test('Schalter mitarbeiter_kollegen: Vorgabe (Zeile fehlt) und aus ⇒ kollegen überall null, kein Kollegenname im JSON; an ⇒ sichtbar', async () => {
  const ohne = async () => {
    const r = await mein.plan(idaU, 2026, 46);
    assert.equal(r.tage.length, 7);
    for (const t of r.tage) assert.strictEqual(t.kollegen, null, t.datum);
    assert.ok(!JSON.stringify(r).includes('Jo'));
    assert.ok(r.tage[1].bloecke.length > 0); // der eigene Plan bleibt
  };
  await ohne(); // Vorgabe: aus
  await kollegenSchalter(true);
  assert.ok(JSON.stringify(await mein.plan(idaU, 2026, 46)).includes('Test, Jo'));
  await kollegenSchalter(false);
  await ohne();
  await kollegenSchalter(null);
});

test('pep_mein_wochen nur freigegebene ab laufender Woche, aufsteigend, höchstens 8', async () => {
  assert.deepEqual(await mein.wochen(idaU), [
    { jahr: 2026, kw: 46, montag: '2026-11-09', zuletzt_geaendert: null },
  ]);
  await freigeben(2026, 44); // vorbei
  await freigeben(2026, 45); // laufende Woche
  for (const kw of [49, 50, 51, 52, 53]) await freigeben(2026, kw);
  await freigeben(2027, 1);
  await freigeben(2027, 2);
  const w = await mein.wochen(idaU);
  assert.deepEqual(w.map((x) => `${x.jahr}-${x.kw}`),
    ['2026-45', '2026-46', '2026-49', '2026-50', '2026-51', '2026-52', '2026-53', '2027-1']);
  assert.deepEqual(Object.keys(w[0]).sort(), ['jahr', 'kw', 'montag', 'zuletzt_geaendert']);
  assert.equal(w[7].montag, '2027-01-04');
  // „zuletzt geändert“ kommt aus der Freigabe
  await malen(leitung, ida, '2026-11-13', '08:00', '10:00', 'KA');
  const fz = (await db.query(`select zuletzt_geaendert from pep.wochen_freigaben where filiale_id = $1 and montag = '2026-11-09'`,
    [fil])).rows[0].zuletzt_geaendert;
  assert.ok(fz);
  assert.equal(Date.parse((await mein.wochen(idaU))[1].zuletzt_geaendert), fz.getTime());
  assert.equal(Date.parse((await mein.plan(idaU, 2026, 46)).zuletzt_geaendert), fz.getTime());
});

test('Urlaub: Werte gleich pep.urlaub_konto, Tage nur eigener Code U des Jahres', async () => {
  await als(db, 'authenticated', leitung, 'select public.pep_urlaubsjahr_speichern($1, 2026, 200, 10)', [ida]);
  await abwesend(ida, 'U', '2026-12-28');
  await abwesend(ida, 'U', '2027-01-05'); // anderes Jahr
  const r = await mein.urlaub(idaU, 2026);
  const k = (await db.query('select * from pep.urlaub_konto($1, 2026)', [ida])).rows[0];
  assert.deepEqual(Object.keys(r).sort(), ['anspruch', 'genehmigt', 'jahr', 'rest', 'rest_vorjahr', 'tage']);
  assert.equal(r.jahr, 2026);
  assert.equal(r.anspruch, Number(k.anspruch));
  assert.equal(r.rest_vorjahr, Number(k.rest_vorjahr));
  assert.equal(r.genehmigt, Number(k.genehmigt));
  assert.equal(r.rest, Number(k.rest));
  assert.equal(r.anspruch, 200);
  const st = async (d) => Number((await db.query('select stunden from pep.abwesenheiten where mitarbeiter_id = $1 and datum = $2::date',
    [ida, d])).rows[0].stunden);
  assert.deepEqual(r.tage, [
    { datum: '2026-11-11', stunden: await st('2026-11-11') },
    { datum: '2026-12-28', stunden: await st('2026-12-28') },
  ]);
  assert.equal(r.genehmigt, r.tage.reduce((s, t) => s + t.stunden, 0));
  assert.deepEqual((await mein.urlaub(idaU, 2027)).tage, [{ datum: '2027-01-05', stunden: await st('2027-01-05') }]);
  await wirft(mein.urlaub(idaU, null), 'DATUM_UNGUELTIG');
  await wirft(mein.urlaub(idaU, 1999), 'DATUM_UNGUELTIG');
});

test('Zeitkonto: saldo = jüngstes saldo_nach; ohne Buchungen saldo null; letzte 6 abgeschlossene Wochen', async () => {
  const montage = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
  for (const m of montage) {
    await db.query('insert into pep.wochen_abschluesse (filiale_id, montag) values ($1, $2::date)', [fil, m]);
  }
  const leer = await mein.zeitkonto(idaU);
  assert.deepEqual(Object.keys(leer).sort(), ['saldo', 'stand', 'wochen']);
  assert.equal(leer.saldo, null);
  assert.equal(leer.stand, null);
  assert.ok(leer.wochen.every((w) => w.saldo === null));

  const buchen = (art, stunden, datum) => als(db, 'authenticated', leitung,
    'select public.pep_zeitkonto_buchen($1, $2, $3, $4, $5::date)', [ida, art, stunden, 'Test', datum]);
  await buchen('start', 5, '2026-09-14');
  await buchen('manuell', -2, '2026-10-14');
  await buchen('manuell', 1.5, '2026-10-27');
  // Buchung eines anderen Mitarbeiters zählt nicht
  await als(db, 'authenticated', leitung, `select public.pep_zeitkonto_buchen($1, 'start', 9, 'Test', '2026-09-14')`, [jo]);

  const r = await mein.zeitkonto(idaU);
  assert.equal(r.saldo, 4.5);
  assert.equal(r.stand, '2026-10-27');
  // Neueste zuerst, die älteste der sieben fällt weg; saldo = Saldo nach allen eigenen Buchungen bis Sonntag
  assert.deepEqual(r.wochen.map((w) => [w.montag, w.saldo]), [
    ['2026-10-26', 4.5], ['2026-10-19', 3], ['2026-10-12', 3], ['2026-10-05', 5], ['2026-09-28', 5], ['2026-09-21', 5]]);
  for (const w of r.wochen) {
    assert.deepEqual(Object.keys(w).sort(), ['diff', 'ist', 'montag', 'saldo', 'soll'], w.montag);
    const zk = (await db.query('select pep.zeitkonto_woche($1, $2::date) as r', [ida, w.montag])).rows[0].r;
    assert.equal(w.soll, zk.soll, w.montag);
    assert.equal(w.ist, zk.ist, w.montag);
    assert.equal(w.diff, zk.diff, w.montag);
  }
  assert.ok(r.wochen[0].soll > 0);

  // Nachträglich gebucht (datum vor der letzten Buchung, höchste id): saldo = Saldo nach allen Buchungen, stand bleibt
  // das späteste Buchungsdatum; die Woche der Buchung zählt sie mit, die späteren Wochen auch, die früheren nicht.
  await buchen('manuell', 1, '2026-09-30');
  const n = await mein.zeitkonto(idaU);
  assert.equal(n.saldo, 5.5);
  assert.equal(n.stand, '2026-10-27');
  assert.deepEqual(n.wochen.map((w) => [w.montag, w.saldo]), [
    ['2026-10-26', 5.5], ['2026-10-19', 4], ['2026-10-12', 4], ['2026-10-05', 6], ['2026-09-28', 6], ['2026-09-21', 5]]);
});

test('ohne Zustimmung → ZUSTIMMUNG_FEHLT; Leitung → KEIN_ZUGRIFF', async () => {
  const max = await ma('Test, Max');
  const u = await konto(max, 'max', { zustimmung: false });
  for (const nutzer of [[u, 'ZUSTIMMUNG_FEHLT'], [leitung, 'KEIN_ZUGRIFF']]) {
    const [n, c] = nutzer;
    await wirft(mein.wochen(n), c);
    await wirft(mein.plan(n, 2026, 46), c);
    await wirft(mein.plan(n, 2026, 54), c); // die Zustimmung wird vor der Woche geprüft
    await wirft(mein.urlaub(n, 2026), c);
    await wirft(mein.zeitkonto(n), c);
  }
});

test('Kollegen nur an Tagen, an denen der Mitarbeiter selbst arbeitet (eine Pause allein zählt nicht)', async () => {
  await kollegenSchalter(true);
  try {
    await malen(leitung, jo, '2026-11-09', '08:00', '12:00', 'KA'); // Mo: Ida hat keine Blöcke
    await malen(leitung, jo, '2026-11-14', '08:00', '16:00', 'KA'); // Sa: Ida hat nur eine Pause
    await malen(leitung, ida, '2026-11-14', '12:00', '12:30', 'PA');
    await malen(leitung, jo, '2026-11-11', '08:00', '12:00', 'KA'); // Mi: Ida hat ganztägig Urlaub
    const r = await mein.plan(idaU, 2026, 46);
    const tag = (d) => r.tage.find((t) => t.datum === d);
    for (const d of ['2026-11-09', '2026-11-11', '2026-11-14']) {
      assert.deepEqual(tag(d).kollegen, [], d);
      assert.ok(!JSON.stringify(tag(d)).includes('Jo'), d);
    }
    assert.ok(tag('2026-11-10').kollegen.some((k) => k.name === 'Test, Jo')); // Di: Ida arbeitet
  } finally {
    await kollegenSchalter(null);
  }
});

test('ganz abwesender Mitarbeiter sieht an keinem Tag Kollegen', async () => {
  const zoe = await ma('Test, Zoe');
  const zoeU = await konto(zoe, 'zoe');
  await als(db, 'authenticated', leitung,
    "select public.pep_abwesenheit_setzen($1, $2, '2026-11-09'::date, '2026-11-15'::date, null, null, null, null)", [zoe, code.U]);
  await kollegenSchalter(true);
  try {
    const r = await mein.plan(zoeU, 2026, 46);
    for (const t of r.tage) assert.deepEqual(t.kollegen, [], t.datum);
    assert.ok(!JSON.stringify(r).includes('Test, Jo'));
  } finally {
    await kollegenSchalter(null);
  }
});

test('Kollegen: nur aktive Mitarbeiter, Austritt vor dem Tag fällt weg, Austritt am Tag bleibt', async () => {
  const namen = async () => (await mein.plan(idaU, 2026, 46)).tage[1].kollegen.map((k) => k.name);
  await kollegenSchalter(true);
  try {
    assert.ok((await namen()).includes('Test, Ben'));
    assert.ok((await namen()).includes('Test, Uwe'));
    await db.query('update pep.mitarbeiter set aktiv = false where id = $1', [ben]);
    await db.query("update pep.mitarbeiter set austritt = '2026-11-09' where id = $1", [uwe]);
    assert.ok(!(await namen()).includes('Test, Ben'), 'inaktiv');
    assert.ok(!(await namen()).includes('Test, Uwe'), 'vor dem Tag ausgetreten');
    await db.query("update pep.mitarbeiter set austritt = '2026-11-10' where id = $1", [uwe]);
    assert.ok((await namen()).includes('Test, Uwe'), 'Austritt am Tag selbst: noch beschäftigt');
  } finally {
    await db.query('update pep.mitarbeiter set aktiv = true where id = $1', [ben]);
    await db.query('update pep.mitarbeiter set austritt = null where id = $1', [uwe]);
    await kollegenSchalter(null);
  }
});

test('Kollege mit Abwesenheit an einem anderen Tag bleibt am getesteten Tag sichtbar', async () => {
  await abwesend(jo, 'U', '2026-11-12');
  await kollegenSchalter(true);
  try {
    const r = await mein.plan(idaU, 2026, 46);
    assert.ok(r.tage[1].kollegen.some((k) => k.name === 'Test, Jo'), 'Di');
  } finally {
    await kollegenSchalter(null);
  }
});

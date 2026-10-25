// Startseite: public.pep_startseite (Spec 14). Heute = Mo 02.11.2026 (KW 45), für die Zählregeln Mo 16.11.2026.
// Alle Tests teilen sich eine Datenbank; der Bestand entsteht vollständig in before().
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  neueDatenbank, als, pepBenutzer, filiale, heuteSetzen, planGrundlage,
  umfrageAnlegen, urlaubsfrageId, umfrageMitarbeiter, abgeben, istAbSetzen,
} from './helfer.mjs';

let db, t, anna, ben, cem, mini, wiebke, azubi, ohne;

const startseite = (nutzer = t.leitung) => t.json(nutzer, 'select public.pep_startseite() as r');
const abwesend = (m, c, von, bis) => t.json(t.leitung,
  'select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, null, null, null, null) as r', [m, t.code[c], von, bis]);
const woche = (jahr, kw, daten) => t.json(t.leitung, 'select public.pep_woche_speichern($1, $2, $3::jsonb) as r',
  [jahr, kw, JSON.stringify(daten)]);

before(async () => {
  db = await neueDatenbank();
  t = await planGrundlage(db); // heute = Mo 02.11.2026
  anna = await t.ma('Test, Anna');
  ben = await t.ma('Muster, Ben', { kompetenzen: ['KA', 'VP'] });
  cem = await t.ma('Beispiel, Cem', { stunden: 30, art: 'teilzeit' });
  mini = await t.ma('Probe, Mini', { stunden: 10, art: 'minijob' });
  wiebke = await t.ma('Test, Wiebke', { kompetenzen: ['OG'] });

  // Laufende Woche KW 45 (02.–08.11.): Anna U Di–Mi und ZA Fr, Ben KM Do → 2 Abwesende, 3 Einträge.
  // Cem erst in KW 46 → zählt nicht.
  await abwesend(anna, 'U', '2026-11-03', '2026-11-04');
  await abwesend(anna, 'ZA', '2026-11-06', '2026-11-06');
  await abwesend(ben, 'KM', '2026-11-05', '2026-11-05');
  await abwesend(cem, 'U', '2026-11-09', '2026-11-10');

  // Morgen (Di 03.11.): nur Ben 07:00–13:00 an der Kasse → Kasse unbesetzt und keine VP ab 13:00, VP allein bis 13:00.
  await t.malen(t.leitung, ben, '2026-11-03', '07:00', '13:00', 'KA');

  // Vorausplanung: KW 46 Planumsatz 60 000 (Soll 300) → Überhang < 0; KW 48 klein → Überhang > 0.
  // KW 44 (vergangen) und KW 51 (außerhalb der 6 Wochen) negativ, zählen nicht.
  await woche(2026, 46, { planumsatz: 60000 });
  await woche(2026, 48, { planumsatz: 2000 });
  await woche(2026, 44, { planumsatz: 60000 });
  await woche(2026, 51, { planumsatz: 60000 });

  // Urlaubstool: Wiebke wünscht KW 44 (vorbei), KW 46 (abgelehnt) und KW 47 (offen) → 1 offener Wunsch.
  const umfrage = await umfrageAnlegen(db, t.leitung, { titel: 'Urlaub 2026', jahr: 2026 });
  const frage = await urlaubsfrageId(db, umfrage);
  const tn = await umfrageMitarbeiter(db, umfrage, 'Test, Wiebke');
  await als(db, 'authenticated', t.leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [umfrage]);
  await als(db, 'authenticated', t.leitung, 'select public.pep_urlaub_zuordnung_setzen($1, $2)', [tn.id, wiebke]);
  await abgeben(db, tn.code, { [frage]: [44, 46, 47] });
  await als(db, 'authenticated', t.leitung, 'select public.pep_urlaub_ablehnen($1, $2::jsonb, null)', [wiebke, JSON.stringify(
    { umfrage_id: umfrage, urlaub_mitarbeiter_id: tn.id, art: 'kw', kw: 46, datum: null })]);

  // Zählregeln (KW 47): Mini 16.11. 15:30–21:30 und 17.11. 06:00–12:00 = 12 h > 10 h Vertrag (Wochenregel an beiden
  // Tagen) und 8,5 h Ruhezeit (steht am 16.11. als „nach“ und am 17.11. als „vor“).
  await t.malen(t.leitung, mini, '2026-11-16', '15:30', '21:30', 'KA');
  await t.malen(t.leitung, mini, '2026-11-17', '06:00', '12:00', 'KA');

  // Fremde Filiale: eigener Mitarbeiter, diese Woche abwesend, Block morgen → taucht nirgends auf.
  const fremd = await pepBenutzer(db, 'fremdchef');
  const fremdFil = await filiale(db, fremd, { name: 'Netto Zweitfiliale', nummer: '9999' });
  const fj = async (sql, p = []) => (await als(db, 'authenticated', fremd, sql, p))[0].r;
  const fe = await fj('select public.pep_einstellungen() as r');
  const fx = await fj(`select public.pep_mitarbeiter_speichern(null, '{"name":"Fremd, Xaver"}') as r`);
  await fj(`select public.pep_vertrag_speichern($1, '{"vertragsart":"vollzeit","wochenstunden":37.5,"gueltig_ab":"2026-01-01"}') as r`, [fx]);
  await fj('select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, null, null, null, null) as r',
    [fx, fe.codes.find((c) => c.code === 'U').id, '2026-11-04']);
  await fj(`select public.pep_woche_speichern(2026, 47, '{"planumsatz":90000}') as r`);
  assert.ok(fremdFil);

  azubi = await pepBenutzer(db, 'azubi', 'mitarbeiter', t.fil);
  ohne = await pepBenutzer(db, 'chefOhne');
});

test('abwesend: laufende ISO-Woche, je Mitarbeiter und Code zusammengefasst; Anzahl = Personen', async () => {
  await heuteSetzen(db, '2026-11-02');
  const s = await startseite();
  assert.equal(s.heute, '2026-11-02');
  assert.equal(s.abwesend.anzahl, 2);
  assert.deepEqual(s.abwesend.liste, [
    { mitarbeiter_id: ben, name: 'Muster, Ben', code: 'KM', von: '2026-11-05', bis: '2026-11-05' },
    { mitarbeiter_id: anna, name: 'Test, Anna', code: 'U', von: '2026-11-03', bis: '2026-11-04' },
    { mitarbeiter_id: anna, name: 'Test, Anna', code: 'ZA', von: '2026-11-06', bis: '2026-11-06' },
  ]);
});

test('luecke: nächste 6 Wochen ab der laufenden, nur Überhang < 0; Summe der Lücken', async () => {
  await heuteSetzen(db, '2026-11-02');
  const s = await startseite();
  const kw46 = (await t.json(t.leitung, 'select public.pep_vorausplanung(2026, 46) as r')).wochen[0];
  assert.ok(kw46.ueberhang < 0);
  assert.deepEqual(s.luecke.wochen, [{ jahr: 2026, kw: 46, montag: '2026-11-09', ueberhang: kw46.ueberhang }]);
  assert.equal(s.luecke.summe, kw46.ueberhang);
});

test('verstoesse: Kassenlücke morgen; offene Tage ohne Block stehen getrennt als ungeplant; Sonntag fehlt', async () => {
  await heuteSetzen(db, '2026-11-02');
  const s = await startseite();
  const tag = (d) => s.verstoesse.find((v) => v.datum === d);
  // Di 03.11.: Kasse unbesetzt 13–20, keine VP 13–20, nur eine Person 07–13
  assert.deepEqual(tag('2026-11-03'), { datum: '2026-11-03', warnungen: 3, hinweise: 0, ungeplant: false });
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']) {
    assert.deepEqual(tag(d), { datum: d, warnungen: 0, hinweise: 0, ungeplant: true }, d);
  }
  assert.equal(tag('2026-11-08'), undefined, 'Sonntag geschlossen');
  assert.deepEqual(s.verstoesse.map((v) => v.datum),
    ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07']);
});

test('offene_wuensche: offene Wünsche von heute bis heute + 365 (vorbei und abgelehnt zählen nicht)', async () => {
  await heuteSetzen(db, '2026-11-02');
  const s = await startseite();
  assert.equal(s.offene_wuensche, 1);
  assert.equal(s.erster_wunsch, '2026-11-16');
  // Ein Jahr später liegt KW 47/2026 in der Vergangenheit
  await heuteSetzen(db, '2027-11-02');
  const spaeter = await startseite();
  assert.equal(spaeter.offene_wuensche, 0);
  assert.equal(spaeter.erster_wunsch, null);
  await heuteSetzen(db, '2026-11-02');
});

test('Zählregeln: Wochenregel einmal je Mitarbeiter und ISO-Woche, Ruhezeit zwischen zwei Tagen einmal', async () => {
  await heuteSetzen(db, '2026-11-16');
  const s = await startseite();
  const roh = await t.json(t.leitung, `select public.pep_pruefung_zeitraum('2026-11-16', '2026-11-22') as r`);
  const arten = (d) => roh[d].filter((e) => e.schwere === 'warnung' && e.mitarbeiter_id === mini).map((e) => e.art).sort();
  // Rohdaten: beide Tage tragen die Wochenregel und je eine Ruhezeit-Warnung (nach / vor)
  assert.deepEqual(arten('2026-11-16'), ['ruhezeit', 'wochenstunden']);
  assert.deepEqual(arten('2026-11-17'), ['ruhezeit', 'wochenstunden']);
  const warn = (d) => roh[d].filter((e) => e.schwere === 'warnung').length;
  const hinw = (d) => roh[d].filter((e) => e.schwere === 'hinweis').length;
  const tag = (d) => s.verstoesse.find((v) => v.datum === d);
  // 16.11.: Ruhezeit „nach“ fällt weg (steht am 17.11. als „vor“); 17.11.: Wochenregel schon am 16.11. gezählt
  assert.deepEqual(tag('2026-11-16'), { datum: '2026-11-16', warnungen: warn('2026-11-16') - 1, hinweise: hinw('2026-11-16'), ungeplant: false });
  assert.deepEqual(tag('2026-11-17'), { datum: '2026-11-17', warnungen: warn('2026-11-17') - 1, hinweise: hinw('2026-11-17'), ungeplant: false });
  for (const d of ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21']) assert.equal(tag(d).ungeplant, true, d);
  // Wiebkes offener Wunsch KW 47 betrifft diese Woche, sie arbeitet aber nicht → kein Hinweis; gezählt wird er trotzdem
  assert.equal(s.offene_wuensche, 1);
  // Abwesend in KW 47: niemand; Lücke ab KW 47 (KW 46 liegt jetzt vor der laufenden Woche)
  assert.equal(s.abwesend.anzahl, 0);
  assert.deepEqual(s.abwesend.liste, []);
  assert.ok(s.luecke.wochen.every((w) => w.kw !== 46));
  await heuteSetzen(db, '2026-11-02');
});

test('letzter Tag des Fensters: Ruhezeit „nach“ zählt, wenn der Folgetag außerhalb liegt', async () => {
  // Fenster 10.11.–16.11.: am 16.11. steht die Ruhezeit nur als „nach“ (17.11. liegt außerhalb) und zählt
  await heuteSetzen(db, '2026-11-10');
  const s = await startseite();
  const roh = await t.json(t.leitung, `select public.pep_pruefung_zeitraum('2026-11-16', '2026-11-16') as r`);
  const warn = roh['2026-11-16'].filter((e) => e.schwere === 'warnung').length;
  assert.equal(s.verstoesse.find((v) => v.datum === '2026-11-16').warnungen, warn);
  await heuteSetzen(db, '2026-11-02');
});

test('fremde Filiale: Abwesende, Blöcke und Wochen der anderen Filiale zählen nicht', async () => {
  await heuteSetzen(db, '2026-11-02');
  const s = await startseite();
  assert.ok(s.abwesend.liste.every((a) => [anna, ben].includes(a.mitarbeiter_id)));
  assert.ok(s.luecke.wochen.every((w) => w.kw === 46));
});

test('Rechte: Stellvertretung liest dasselbe; Rolle mitarbeiter → NUR_LEITUNG; Leitung ohne Filiale → KEINE_FILIALE', async () => {
  await heuteSetzen(db, '2026-11-02');
  assert.deepEqual(await startseite(t.stellv), await startseite(t.leitung));
  await assert.rejects(startseite(azubi), /NUR_LEITUNG/);
  await assert.rejects(startseite(ohne), /KEINE_FILIALE/);
});

test('abwesend zählt nur sperrende Codes ohne Feiertag: U, KM, BS, AF, T, eigener Code ja; FT und nicht sperrende nein', async () => {
  // Eigene Woche KW 49 (30.11.–06.12.2026), damit der Bestand der anderen Tests unberührt bleibt.
  await heuteSetzen(db, '2026-11-30');
  const code = async (daten) => t.json(t.leitung, 'select public.pep_code_speichern(null, $1::jsonb) as r', [JSON.stringify(daten)]);
  const fb = await code({ code: 'FB', name: 'Fortbildung', farbe: '#123456', stundenregel: 'teiler', sperrt: true });
  const inf = await code({ code: 'IN', name: 'Info', farbe: '#654321', stundenregel: 'keine', sperrt: false });
  const setzen = (m, codeId, datum, stunden = null) => t.json(t.leitung,
    'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, $4::numeric, null, null, null) as r',
    [m, codeId, datum, stunden]);
  const fred = await t.ma('Test, Fred');
  const ida = await t.ma('Test, Ida');
  const theo = await t.ma('Test, Theo');
  const alf = await t.ma('Test, Alf');
  await setzen(anna, t.code.U, '2026-11-30');
  await setzen(ben, t.code.KM, '2026-12-01');
  await setzen(cem, t.code.BS, '2026-12-02', 8);
  await setzen(mini, t.code.NV, '2026-12-03');
  await setzen(wiebke, t.code.FT, '2026-12-04');
  await setzen(fred, fb, '2026-12-05');
  await setzen(ida, inf, '2026-11-30');
  await setzen(theo, t.code.T, '2026-12-01', 4);
  await setzen(alf, t.code.AF, '2026-12-02', 8);

  // Erwartung aus dem tatsächlichen sperrt-Wert der Codes, nicht aus einer Annahme über das Startset.
  const codes = (await t.json(t.leitung, 'select public.pep_einstellungen() as r')).codes;
  const sperrt = Object.fromEntries(codes.map((c) => [c.code, c.sperrt]));
  assert.equal(sperrt.FB, true);
  assert.equal(sperrt.IN, false);
  const alle = [[anna, 'U'], [ben, 'KM'], [cem, 'BS'], [mini, 'NV'], [wiebke, 'FT'], [fred, 'FB'], [ida, 'IN'],
    [theo, 'T'], [alf, 'AF']];
  const erwartet = alle.filter(([, c]) => sperrt[c] && c !== 'FT');

  const s = await startseite();
  const liste = s.abwesend.liste.map((a) => [a.mitarbeiter_id, a.code]).sort((x, y) => x[0] - y[0]);
  assert.deepEqual(liste, [...erwartet].sort((x, y) => x[0] - y[0]));
  assert.equal(s.abwesend.anzahl, erwartet.length);
  const gezaehlt = s.abwesend.liste.map((a) => a.code);
  for (const c of ['U', 'KM', 'BS', 'AF', 'T', 'FB']) assert.ok(gezaehlt.includes(c), c);
  for (const c of ['FT', 'IN']) assert.ok(!gezaehlt.includes(c), c);
  await heuteSetzen(db, '2026-11-02');
});

// ---------------------------------------------------------------- Stufe 2: IST offen und Zeitkonto auffällig
// Eigene Datenbank Z, heute = Mo 16.11.2026 (KW 47). Fenster „IST offen“ = heute − 42 bis gestern = 05.10.–15.11.2026.
// Anna: Vertrag seit 01.01., alle Tage im Fenster bestätigt außer Mo 05.10. (erster Tag des Fensters) und Sa 14.11.;
//       Sa 03.10. (vor dem Fenster) bleibt auch offen.
// Nora: Eintritt Do 12.11. → offen Do, Fr, Sa (davor nicht beschäftigt).
// Kurt: Vertrag erst ab Mo 09.11.; KM ganztägig Mo 09.11. (zählt nicht), Teilzeit-Abwesenheit Di 10.11. (zählt);
//       Mi 11.11. als geschlossen eingestellt (zählt bei niemandem).
// Ina:  inaktiv → zählt nie.
let Z;

before(async () => {
  const zdb = await neueDatenbank();
  const g = await planGrundlage(zdb, { heute: '2026-11-16' });
  const speichern = (id, daten) => g.json(g.leitung, 'select public.pep_mitarbeiter_speichern($1, $2::jsonb) as r',
    [id, JSON.stringify(daten)]);
  const za = await g.ma('Zeit, Anna');
  const zn = await g.ma('Zeit, Nora');
  await speichern(zn, { eintritt: '2026-11-12' });
  const zk = await g.ma('Zeit, Kurt', { ab: '2026-11-09' });
  const zi = await g.ma('Zeit, Ina');
  await speichern(zi, { aktiv: false });
  await g.json(g.leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, null, null, null, null) as r',
    [zk, g.code.KM, '2026-11-09']);
  await g.json(g.leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, 2, $4::time, $5::time, null) as r',
    [zk, g.code.BS, '2026-11-10', '08:00', '10:00']);
  await als(zdb, 'authenticated', g.leitung, 'select public.pep_abweichung_speichern($1::date, $2::jsonb)',
    ['2026-11-11', JSON.stringify({ art: 'sonstiges', geoeffnet: false, name: 'Umbau' })]);
  // Annas Tage im Fenster bestätigen (direkt, ohne IST-Blöcke = leer bestätigt), außer 05.10. und 14.11.
  await zdb.query(`insert into pep.ist_tage (filiale_id, mitarbeiter_id, datum)
    select $1, $2, d::date from generate_series('2026-10-06'::date, '2026-11-13'::date, interval '1 day') d`, [g.fil, za]);
  const startseite = (nutzer = g.leitung) => g.json(nutzer, 'select public.pep_startseite() as r');
  const bestaetigen = (datum) => g.json(g.leitung, 'select public.pep_ist_bestaetigen($1::date, null) as r', [datum]);
  const buchen = (maId, art, stunden, grund, datum) => g.json(g.leitung,
    'select public.pep_zeitkonto_buchen($1, $2, $3::numeric, $4, $5::date) as r', [maId, art, stunden, grund, datum]);
  Z = { db: zdb, ...g, za, zn, zk, zi, startseite, bestaetigen, buchen };
});

test('ist_offen: offene IST-Zeilen der letzten 6 Wochen bis gestern; nur geöffnet, beschäftigt, nicht ganztägig abwesend', async () => {
  await heuteSetzen(Z.db, '2026-11-16');
  try {
    const s = await Z.startseite();
    // Anna 05.10. und 14.11.; Nora 12.–14.11.; Kurt 10., 12., 13., 14.11. (09.11. KM ganztägig, 11.11. geschlossen)
    assert.deepEqual(s.ist_offen, { tage: 5, zeilen: 9, erster: '2026-10-05' });
    // Dieselbe Definition wie IST-Ansicht und Zeitkonto: pep.ist_zeilen, offen = nicht bestätigt
    const roh = (await Z.db.query(`select count(*)::int as n, count(distinct datum)::int as t,
        to_char(min(datum), 'YYYY-MM-DD') as erster
      from pep.ist_zeilen($1, '2026-10-05', '2026-11-15', null) where bestaetigt_am is null`, [Z.fil])).rows[0];
    assert.deepEqual(s.ist_offen, { tage: roh.t, zeilen: roh.n, erster: roh.erster });

    // Einen Tag später: 05.10. fällt aus dem Fenster, Mo 16.11. (jetzt gestern) kommt für alle drei dazu
    await heuteSetzen(Z.db, '2026-11-17');
    const morgen = await Z.startseite();
    assert.deepEqual(morgen.ist_offen, { tage: 5, zeilen: 11, erster: '2026-11-10' });

    // Alles bis gestern bestätigt → 0, erster null; die Stellvertretung sieht dasselbe
    for (const d of ['2026-10-05', '2026-11-10', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-16']) {
      await Z.bestaetigen(d);
    }
    const leer = await Z.startseite();
    assert.deepEqual(leer.ist_offen, { tage: 0, zeilen: 0, erster: null });
    assert.deepEqual(await Z.startseite(Z.stellv), leer);
  } finally {
    await heuteSetzen(Z.db, '2026-11-16');
  }
});

test('zeitkonto_auffaellig: Warnung im Saldo der zuletzt abgeschlossenen Woche (Buchungen bis Sonntag), Regel wie im Reiter', async () => {
  await heuteSetzen(Z.db, '2026-11-16');
  try {
    // Startsalden vor dem ersten Abschluss: noch keine abgeschlossene Woche → leer
    await Z.buchen(Z.za, 'start', 100, 'Übernahme', '2026-11-02');
    await Z.buchen(Z.zk, 'start', -10, 'Übernahme', '2026-11-02');
    assert.deepEqual((await Z.startseite()).zeitkonto_auffaellig, { jahr: null, kw: null, montag: null, liste: [] });

    // Start der IST-Erfassung auf KW 46 (der erste Abschluss muss die Startwoche sein; noch kein Abschluss, also änderbar).
    await istAbSetzen(Z.db, Z.fil, '2026-11-09');
    // KW 46 abschließen (die offenen Tage wurden im vorigen Test bestätigt). diff: Anna −37,5 (ohne IST),
    // Nora −18,75 (Eintritt Do), Kurt −29,25 (KM Mo 6,25 + BS Di 2 zählen). Saldo: Anna 62,5 > 37,5 → plus;
    // Kurt −39,25 < −37,5 → minus; Nora −18,75 → keine Warnung; Ina inaktiv → keine Buchung, Saldo 0.
    assert.deepEqual(await Z.json(Z.leitung, 'select public.pep_wochenabschluss(2026, 46) as r'), { gebucht: 3 });
    // Eine Buchung nach dem Sonntag zählt nicht (Kurt läge sonst bei −34,25 und ohne Warnung)
    await Z.buchen(Z.zk, 'manuell', 5, 'Ausgleich', '2026-11-16');
    const s = await Z.startseite();
    assert.deepEqual(s.zeitkonto_auffaellig, {
      jahr: 2026, kw: 46, montag: '2026-11-09',
      liste: [
        { id: Z.za, name: 'Zeit, Anna', saldo: 62.5, warnung: 'plus' },
        { id: Z.zk, name: 'Zeit, Kurt', saldo: -39.25, warnung: 'minus' },
      ],
    });
    // Gleiche Zahlen und Warnungen wie der Reiter Zeitkonto für KW 46 (dort ohne die Buchung vom 16.11.)
    const zk = await Z.json(Z.leitung, 'select public.pep_zeitkonto_woche(2026, 46) as r');
    const reiter = zk.mitarbeiter.filter((m) => m.warnung).map((m) => ({ id: m.id, saldo: m.saldo_aktuell, warnung: m.warnung }));
    assert.deepEqual(reiter, s.zeitkonto_auffaellig.liste.map(({ id, saldo, warnung }) => ({ id, saldo, warnung })));

    // Faktor 2 → niemand auffällig; Stellvertretung sieht dasselbe
    await als(Z.db, 'authenticated', Z.leitung, `select public.pep_einstellung_setzen('zeitkonto_warnfaktor', '2'::jsonb)`);
    const ruhig = await Z.startseite();
    assert.deepEqual(ruhig.zeitkonto_auffaellig, { jahr: 2026, kw: 46, montag: '2026-11-09', liste: [] });
    assert.deepEqual(await Z.startseite(Z.stellv), ruhig);
    await als(Z.db, 'authenticated', Z.leitung, `select public.pep_einstellung_setzen('zeitkonto_warnfaktor', '1'::jsonb)`);
  } finally {
    await heuteSetzen(Z.db, '2026-11-16');
  }
});

test('ist_ab: Tage vor dem Start der IST-Erfassung sind nicht offen (Kachel, Zeitkonto), nicht erfassbar, Abschluss → VOR_IST_START', async () => {
  // Eigene Datenbank mit dem Standard der Datenbank: ist_ab = Montag von heute = 16.11.2026.
  const sdb = await neueDatenbank();
  const g = await planGrundlage(sdb, { heute: '2026-11-16', istAb: null });
  try {
    const leo = await g.ma('Start, Leo'); // Vertrag seit 01.01.2026
    await heuteSetzen(sdb, '2026-11-10');
    await g.malen(g.leitung, leo, '2026-11-13', '08:00', '12:00', 'KA'); // Plan, aus dem sonst der Vorschlag käme
    await heuteSetzen(sdb, '2026-11-16');
    assert.equal((await g.json(g.leitung, 'select public.pep_einstellungen() as r')).werte.ist_ab, '2026-11-16');

    const s = await g.json(g.leitung, 'select public.pep_startseite() as r');
    assert.deepEqual(s.ist_offen, { tage: 0, zeilen: 0, erster: null });
    const zk = await g.json(g.leitung, 'select public.pep_zeitkonto_woche(2026, 46) as r');
    assert.equal(zk.offene_tage, 0);
    assert.equal(zk.mitarbeiter.find((m) => m.id === leo).offene_tage, 0);
    // IST-Ansicht KW 46: kein Tag erfassbar, alle vor dem Start, kein Status, kein Vorschlag
    const w = await g.json(g.leitung, 'select public.pep_ist_woche(2026, 46) as r');
    assert.equal(w.ist_ab, '2026-11-16');
    assert.ok(w.tage.every((t) => t.ist_erlaubt === false && t.vor_ist_start === true));
    assert.deepEqual(w.status, []);
    assert.deepEqual(w.bloecke.filter((b) => b.mitarbeiter_id === leo), []);
    // KW 47: Montag erfassbar, nicht vor dem Start
    const w47 = await g.json(g.leitung, 'select public.pep_ist_woche(2026, 47) as r');
    assert.deepEqual([w47.tage[0].ist_erlaubt, w47.tage[0].vor_ist_start], [true, false]);
    await assert.rejects(g.json(g.leitung, `select public.pep_ist_malen($1, '2026-11-13', '08:00', '12:00', $2, null) as r`,
      [leo, g.bereich.KA]), /IST_VOR_START/);
    // Radieren (Bereich null) prüft den Start genauso
    await assert.rejects(g.json(g.leitung, `select public.pep_ist_malen($1, '2026-11-13', '08:00', '12:00', null, null) as r`,
      [leo]), /IST_VOR_START/);
    // Reiter Zeitkonto: KW 46 liegt vor dem Start – diff sichtbar, aber nicht im Saldo aktuell (wird nie gebucht)
    await g.json(g.leitung, `select public.pep_zeitkonto_buchen($1, 'start', 10, 'Übernahme', '2026-11-02') as r`, [leo]);
    const vor = await g.json(g.leitung, 'select public.pep_zeitkonto_woche(2026, 46) as r');
    assert.deepEqual([vor.vor_ist_start, vor.ist_ab, vor.abgeschlossen], [true, '2026-11-16', null]);
    const leoVor = vor.mitarbeiter.find((m) => m.id === leo);
    assert.deepEqual([leoVor.diff, leoVor.saldo_vorwoche, leoVor.saldo_aktuell, leoVor.warnung], [-37.5, 10, 10, null]);
    // KW 47 (ab dem Start, laufend): diff zählt wie bisher vorläufig im Saldo aktuell
    const ab = await g.json(g.leitung, 'select public.pep_zeitkonto_woche(2026, 47) as r');
    assert.equal(ab.vor_ist_start, false);
    const leoAb = ab.mitarbeiter.find((m) => m.id === leo);
    assert.deepEqual([leoAb.saldo_vorwoche, leoAb.saldo_aktuell], [10, 10 + leoAb.diff]);
    await assert.rejects(g.json(g.leitung, 'select public.pep_wochenabschluss(2026, 46) as r'), /VOR_IST_START/);
    assert.deepEqual(await g.json(g.leitung, `select public.pep_ist_bestaetigen('2026-11-13', null) as r`), { bestaetigt: 0 });

    // Start eine Woche früher: KW 46 ist jetzt offen (Mo–Sa), der Abschluss scheitert an den offenen Tagen
    await als(sdb, 'authenticated', g.leitung, `select public.pep_einstellung_setzen('ist_ab', '"2026-11-09"'::jsonb)`);
    assert.deepEqual((await g.json(g.leitung, 'select public.pep_startseite() as r')).ist_offen,
      { tage: 6, zeilen: 6, erster: '2026-11-09' });
    assert.equal((await g.json(g.leitung, 'select public.pep_zeitkonto_woche(2026, 46) as r')).offene_tage, 6);
    await assert.rejects(g.json(g.leitung, 'select public.pep_wochenabschluss(2026, 46) as r'), /IST_OFFEN/);
  } finally {
    await heuteSetzen(sdb, '2026-11-16');
  }
});

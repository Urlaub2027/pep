// Startseite: public.pep_startseite (Spec 14). Heute = Mo 02.11.2026 (KW 45), für die Zählregeln Mo 16.11.2026.
// Alle Tests teilen sich eine Datenbank; der Bestand entsteht vollständig in before().
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  neueDatenbank, als, pepBenutzer, filiale, heuteSetzen, planGrundlage,
  umfrageAnlegen, urlaubsfrageId, umfrageMitarbeiter, abgeben,
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

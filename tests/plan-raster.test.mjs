import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  minuten, uhrzeit, halbstunden, isoWoche, montagDerKw, kwVorZurueck, tageDerWoche, plusTage,
  zeitspanne, stundenText, heuteDatum,
} from '../docs/zeit.js';
import {
  zellen, strich, abdeckung, abdeckungsKlasse, tagesStunden, wochenSummen, bereichsStunden,
  rueckgaengigStapel, gleicheWochentageBis, naechsteWochen, tagKurz, kopierErgebnis, tageText, lueckeText,
  vorgabeText, ersatzBloecke, uebernahmeText, lieferBedarf, aufteilung, standardVariante, vorschlagBlock,
} from '../docs/plan-raster.js';

test('heuteDatum: lokales Datum zum Aufrufzeitpunkt; ?heute= ersetzt es nur bei gültigem Datum', () => {
  assert.equal(heuteDatum(null, new Date(2026, 10, 2, 23, 59)), '2026-11-02');
  assert.equal(heuteDatum(null, new Date(2026, 10, 3, 0, 1)), '2026-11-03'); // Tablet über Nacht offen
  assert.equal(heuteDatum('2026-11-09', new Date(2026, 10, 3)), '2026-11-09');
  assert.equal(heuteDatum('quatsch', new Date(2026, 0, 5)), '2026-01-05');
  assert.match(heuteDatum(), /^\d{4}-\d{2}-\d{2}$/);
});

test('Zeit: Minuten, Uhrzeit, Halbstunden', () => {
  assert.equal(minuten('06:30'), 390);
  assert.equal(uhrzeit(390), '06:30');
  assert.equal(uhrzeit(0), '00:00');
  assert.deepEqual(halbstunden('06:00', '07:30'), ['06:00', '06:30', '07:00']);
  assert.deepEqual(halbstunden('07:00', '07:00'), []);
  assert.equal(zeitspanne('07:00', '15:30'), '07:00–15:30');
  assert.equal(stundenText(7.5), '7,50');
  assert.equal(stundenText('8'), '8,00');
});

test('Zeit: ISO-Wochen, KW 53 und Jahreswechsel', () => {
  assert.deepEqual(isoWoche('2026-12-31'), { jahr: 2026, kw: 53 });
  assert.deepEqual(isoWoche('2027-01-03'), { jahr: 2026, kw: 53 });
  assert.deepEqual(isoWoche('2027-01-04'), { jahr: 2027, kw: 1 });
  assert.deepEqual(isoWoche('2026-11-09'), { jahr: 2026, kw: 46 });
  assert.equal(montagDerKw(2026, 53), '2026-12-28');
  assert.equal(montagDerKw(2026, 46), '2026-11-09');
  assert.equal(montagDerKw(2027, 1), '2027-01-04');
  assert.deepEqual(kwVorZurueck(2026, 53, 1), { jahr: 2027, kw: 1 });
  assert.deepEqual(kwVorZurueck(2027, 1, -1), { jahr: 2026, kw: 53 });
  assert.deepEqual(kwVorZurueck(2026, 46, 0), { jahr: 2026, kw: 46 });
  assert.deepEqual(kwVorZurueck(2026, 46, 10), { jahr: 2027, kw: 3 });
  assert.deepEqual(tageDerWoche(2026, 53), [
    '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03',
  ]);
  // Sommerzeitwechsel verschiebt nichts
  assert.equal(plusTage('2026-10-24', 2), '2026-10-26');
  assert.equal(plusTage('2026-03-28', 1), '2026-03-29');
  assert.equal(plusTage('2026-03-29', 1), '2026-03-30');
  assert.equal(plusTage('2026-03-01', -1), '2026-02-28');
});

const SP = halbstunden('06:00', '21:30');

test('zellen: eine Position je Halbstunde, Lücken null, unbesetzt weitergereicht', () => {
  const z = zellen([
    { id: 1, von: '07:00', bis: '08:00', bereich_id: 10, unbesetzt: false },
    { id: 1, von: '08:00', bis: '08:30', bereich_id: 10, unbesetzt: true },
  ], SP);
  assert.equal(z.length, SP.length);
  assert.equal(z[0], null);
  assert.deepEqual(z[2], { bereich_id: 10, block_id: 1, unbesetzt: false });
  assert.deepEqual(z[3], { bereich_id: 10, block_id: 1, unbesetzt: false });
  assert.deepEqual(z[4], { bereich_id: 10, block_id: 1, unbesetzt: true });
  assert.equal(z[5], null);
  assert.deepEqual(zellen([], SP).filter(Boolean), []);
});

test('strich: Richtung egal, bis = Ende der letzten Zelle', () => {
  assert.deepEqual(strich(SP, 5, 2), { von: '07:00', bis: '09:00' });
  assert.deepEqual(strich(SP, 2, 5), { von: '07:00', bis: '09:00' });
  assert.deepEqual(strich(SP, 3, 3), { von: '07:30', bis: '08:00' });
  const letzte = SP.length - 1;
  assert.deepEqual(strich(SP, letzte, letzte), { von: '21:00', bis: '21:30' });
});

const woche = {
  bereiche: [
    { id: 1, kuerzel: 'KA', art: 'bereich', bedeutung: 'kasse' },
    { id: 2, kuerzel: 'OG', art: 'bereich', bedeutung: null },
    { id: 3, kuerzel: 'P', art: 'pause', bedeutung: null },
  ],
  mitarbeiter: [
    { id: 100, wochenstunden: '20.00', vp: true },
    { id: 101, wochenstunden: 10, vp: false },
    { id: 102, wochenstunden: 40, vp: false },
  ],
  bloecke: [
    { id: 1, mitarbeiter_id: 100, datum: '2026-11-09', von: '07:00', bis: '10:00', bereich_id: 1, unbesetzt: false },
    { id: 2, mitarbeiter_id: 101, datum: '2026-11-09', von: '09:00', bis: '12:00', bereich_id: 1, unbesetzt: true },
    { id: 3, mitarbeiter_id: 100, datum: '2026-11-09', von: '10:00', bis: '10:30', bereich_id: 3, unbesetzt: false },
    { id: 4, mitarbeiter_id: 102, datum: '2026-11-09', von: '08:00', bis: '09:00', bereich_id: 2, unbesetzt: false },
    { id: 5, mitarbeiter_id: 100, datum: '2026-11-10', von: '07:00', bis: '09:00', bereich_id: 2, unbesetzt: false },
  ],
  abwesenheiten: [
    { mitarbeiter_id: 100, datum: '2026-11-11', stunden: '4' },
    { mitarbeiter_id: 100, datum: '2026-11-12', stunden: null },
  ],
};

test('abdeckung: Kasse, VP, anwesend je Halbstunde (F2, F3, F5)', () => {
  const a = abdeckung(woche, '2026-11-09', SP);
  const i = (h) => SP.indexOf(h);
  assert.equal(a.kasse.length, SP.length);
  assert.equal(a.kasse[i('06:00')], 0);
  assert.equal(a.kasse[i('07:00')], 1);
  assert.equal(a.kasse[i('09:30')], 1); // zweiter Kassenblock ist unbesetzt
  assert.equal(a.kasse[i('10:00')], 0); // Pause ist keine Kasse
  assert.equal(a.vp[i('07:00')], 1);
  assert.equal(a.vp[i('10:00')], 1); // VP in der Pause ist anwesend (F3/F5), wie pep.pruefung
  assert.equal(a.anwesend[i('06:30')], 0);
  assert.equal(a.anwesend[i('08:00')], 2);
  assert.equal(a.anwesend[i('10:00')], 1); // Pause zählt als anwesend
  assert.equal(a.anwesend[i('11:00')], 0); // unbesetzt zählt nirgends
});

test('abdeckung: Kasse 07-10 und 09-12 (zweiter unbesetzt) und leere Woche', () => {
  const w = {
    bereiche: woche.bereiche, mitarbeiter: woche.mitarbeiter, abwesenheiten: [],
    bloecke: [
      { id: 1, mitarbeiter_id: 100, datum: 'd', von: '07:00', bis: '10:00', bereich_id: 1, unbesetzt: false },
      { id: 2, mitarbeiter_id: 101, datum: 'd', von: '09:00', bis: '12:00', bereich_id: 1, unbesetzt: true },
    ],
  };
  const a = abdeckung(w, 'd', SP);
  assert.deepEqual([a.kasse[0], a.kasse[2], a.kasse[8]], [0, 1, 0]);
  const leer = abdeckung({ bereiche: [], mitarbeiter: [], bloecke: [], abwesenheiten: [] }, 'd', SP);
  assert.ok(leer.kasse.every((n) => n === 0) && leer.vp.every((n) => n === 0) && leer.anwesend.every((n) => n === 0));
  assert.equal(leer.kasse.length, SP.length);
});

test('abdeckungsKlasse', () => {
  assert.equal(abdeckungsKlasse('kasse', 0, true, 0), 'rot');
  assert.equal(abdeckungsKlasse('kasse', 1, true, 1), 'gelb');
  assert.equal(abdeckungsKlasse('kasse', 2, true, 2), '');
  assert.equal(abdeckungsKlasse('kasse', 0, false, 3), '');
  assert.equal(abdeckungsKlasse('vp', 0, true, 0), 'rot');
  assert.equal(abdeckungsKlasse('vp', 1, true, 2), ''); // zwei da, nicht gebunden
  assert.equal(abdeckungsKlasse('vp', 0, false, 0), '');
  assert.equal(abdeckungsKlasse('vp', 0, false, 2), 'rot');
  assert.equal(abdeckungsKlasse('vp', 1, false, 2), '');
  assert.equal(abdeckungsKlasse('vp', 1, true, 1), 'gelb'); // allein in der Öffnungszeit
  assert.equal(abdeckungsKlasse('vp', 1, false, 1), '');
});

// Freie VPs: eine VP an der Kasse ist gebunden, wenn in der Öffnungszeit niemand mit Kassenkompetenz frei ist
// (nicht Kasse, nicht Pause), und erst ab mehr als 30 min am Stück.
const wocheVp = (bloecke, { kompetenzNoetig = true } = {}) => ({
  bereiche: [
    { id: 1, kuerzel: 'KA', art: 'bereich', bedeutung: 'kasse', kompetenz_noetig: kompetenzNoetig },
    { id: 2, kuerzel: 'OG', art: 'bereich', bedeutung: null, kompetenz_noetig: false },
    { id: 3, kuerzel: 'P', art: 'pause', bedeutung: null, kompetenz_noetig: false },
  ],
  mitarbeiter: [
    { id: 1, vp: true, kompetenzen: [1] },
    { id: 2, vp: false, kompetenzen: [] },
    { id: 3, vp: false, kompetenzen: [1] },
    { id: 4, vp: true, kompetenzen: [1] },
  ],
  bloecke: bloecke.map(([ma, von, bis, bereich], i) => ({
    id: i + 1, mitarbeiter_id: ma, datum: 'd', von, bis, bereich_id: bereich, unbesetzt: false })),
  abwesenheiten: [],
});
const SP8 = halbstunden('08:00', '10:00'); // 08:00 08:30 09:00 09:30
const frei = (bloecke, optionen, offen) => abdeckung(wocheVp(bloecke, optionen), 'd', SP8, offen).vpFrei;

test('abdeckung.vpFrei: VP an der Kasse ohne Ablösung zählt nicht', () => {
  // Kollege ohne Kassenkompetenz: VP gebunden
  const w = abdeckung(wocheVp([[1, '08:00', '10:00', 1], [2, '08:00', '10:00', 2]]), 'd', SP8);
  assert.deepEqual(w.vp, [1, 1, 1, 1]);
  assert.deepEqual(w.vpFrei, [0, 0, 0, 0]);
  // Kollegin mit Kassenkompetenz erst frei (OG), dann in Pause
  assert.deepEqual(frei([[1, '08:00', '10:00', 1], [3, '08:00', '09:00', 2], [3, '09:00', '10:00', 3]]), [1, 1, 0, 0]);
  // ohne Kassenkompetenz-Pflicht kann jeder ablösen
  assert.deepEqual(frei([[1, '08:00', '10:00', 1], [2, '08:00', '10:00', 2]], { kompetenzNoetig: false }), [1, 1, 1, 1]);
  // zweite VP auf OG kann ablösen: beide frei
  assert.deepEqual(frei([[1, '08:00', '10:00', 1], [4, '08:00', '10:00', 2]]), [2, 2, 2, 2]);
  // VP in Pause, andere an der Kasse
  assert.deepEqual(frei([[1, '08:00', '10:00', 3], [3, '08:00', '10:00', 1]]), [1, 1, 1, 1]);
});

test('abdeckung.vpFrei: allein, eigene Pause, 30 min überbrückbar, nur in der Öffnungszeit', () => {
  // allein an der Kasse, Pause 09:00–09:30, danach 30 min Kasse: die halbe Stunde allein zählt noch
  assert.deepEqual(frei([[1, '08:00', '09:00', 1], [1, '09:00', '09:30', 3], [1, '09:30', '10:00', 1]]), [0, 0, 1, 1]);
  // außerhalb der Öffnung bindet die Kasse nicht
  assert.deepEqual(frei([[1, '08:00', '10:00', 1]], {}, [false, false, true, true]), [1, 1, 0, 0]);
  assert.deepEqual(frei([[1, '08:00', '10:00', 1]], {}, [true, false, true, false]), [1, 1, 1, 1]);
  assert.deepEqual(abdeckung(wocheVp([]), 'd', SP8).vpFrei, [0, 0, 0, 0]);
});

test('tagesStunden: ohne Pause und ohne unbesetzt', () => {
  const tag = woche.bloecke.filter((b) => b.datum === '2026-11-09');
  assert.equal(tagesStunden(tag, new Set([3])), 4); // 3 + 1; Pause und unbesetzt raus
  assert.equal(tagesStunden(tag, [3]), 4);
  assert.equal(tagesStunden([], []), 0);
});

test('wochenSummen: Soll = Vertrag - Abwesenheit, geplant ohne Pause/unbesetzt', () => {
  const s = wochenSummen(woche);
  assert.deepEqual(s.get(100), { soll: 16, geplant: 2 + 3, differenz: -11 });
  assert.deepEqual(s.get(101), { soll: 10, geplant: 0, differenz: -10 });
  assert.deepEqual(s.get(102), { soll: 40, geplant: 1, differenz: -39 });
  assert.equal(wochenSummen({ bereiche: [], mitarbeiter: [], bloecke: [], abwesenheiten: [] }).size, 0);
});

test('bereichsStunden: je Bereich am Tag, ohne Pause und unbesetzt', () => {
  const m = bereichsStunden(woche, '2026-11-09');
  assert.equal(m.get(1), 3);
  assert.equal(m.get(2), 1);
  assert.equal(m.has(3), false);
});

test('rueckgaengigStapel: begrenzt, ältester fällt heraus', () => {
  const s = rueckgaengigStapel(2);
  assert.equal(s.leer(), true);
  assert.equal(s.holen(), undefined);
  s.merken('a'); s.merken('b'); s.merken('c');
  assert.equal(s.leer(), false);
  assert.equal(s.holen(), 'c');
  assert.equal(s.holen(), 'b');
  assert.equal(s.holen(), undefined);
  assert.equal(s.leer(), true);
  const g = rueckgaengigStapel();
  for (let i = 0; i < 25; i++) g.merken(i);
  let n = 0;
  while (g.holen() !== undefined) n++;
  assert.equal(n, 20);
});

test('Kopier-Ziele: gleiche Wochentage bis Datum, nächste n Wochen über den Jahreswechsel', () => {
  assert.deepEqual(gleicheWochentageBis('2026-11-09', '2026-11-30'), ['2026-11-16', '2026-11-23', '2026-11-30']);
  assert.deepEqual(gleicheWochentageBis('2026-11-09', '2026-11-15'), []);
  assert.deepEqual(gleicheWochentageBis('2026-11-09', ''), []);
  assert.deepEqual(naechsteWochen(2026, 52, 3), [{ jahr: 2026, kw: 53 }, { jahr: 2027, kw: 1 }, { jahr: 2027, kw: 2 }]);
  assert.deepEqual(naechsteWochen(2026, 46, 0), []);
  assert.equal(tagKurz('2026-11-16'), 'Mo 16.11.');
  assert.equal(tagKurz('2027-01-03'), 'So 03.01.');
});

test('kopierErgebnis: Meldung nach dem Kopieren, Nullen fallen weg', () => {
  const r = { tage: 5, bloecke: 42, unbesetzt: 3, gekuerzt: 1, ausgelassen: 2, ausgeschieden: [], uebersprungen: [] };
  assert.equal(kopierErgebnis(r), '5 Tage kopiert: 42 Blöcke, 3 unbesetzt, 1 gekürzt, 2 ausgelassen');
  assert.equal(kopierErgebnis({ ...r, tage: 1, bloecke: 1, unbesetzt: 0, gekuerzt: 0, ausgelassen: 0 }),
    '1 Tag kopiert: 1 Block');
  assert.equal(kopierErgebnis({ ...r, tage: 6, bloecke: 12, unbesetzt: 0, gekuerzt: 0, ausgelassen: 3,
    ausgeschieden: ['Test, Anna', 'gelöschter Mitarbeiter'],
    uebersprungen: [{ datum: '2026-11-15', grund: 'geschlossen' }] }, 'geladen'),
  '6 Tage geladen: 12 Blöcke, 3 ausgelassen. Übersprungen: So 15.11. (geschlossen). '
    + 'Nicht mehr beschäftigt: Test, Anna · gelöschter Mitarbeiter');
  // leere: Zeilen mit vorhandenen Blöcken bleiben unverändert und werden genannt
  assert.equal(kopierErgebnis({ ...r, tage: 2, bloecke: 3, unbesetzt: 0, gekuerzt: 0, ausgelassen: 0,
    belegt_uebersprungen: 3 }), '2 Tage kopiert: 3 Blöcke. 3 Zeilen schon belegt, nicht geändert');
  assert.equal(kopierErgebnis({ ...r, tage: 1, bloecke: 0, unbesetzt: 0, gekuerzt: 0, ausgelassen: 0,
    belegt_uebersprungen: 1 }), '1 Tag kopiert: 0 Blöcke. 1 Zeile schon belegt, nicht geändert');
});

test('tageText: ein Tag oder Spanne mit Wochentagen', () => {
  assert.equal(tageText('2026-11-09', '2026-11-09'), 'Mo 09.11.');
  assert.equal(tageText('2026-11-09', '2026-11-11'), 'Mo 09.11.–Mi 11.11.');
  assert.equal(tageText('2026-12-31', '2027-01-02'), 'Do 31.12.–Sa 02.01.');
});

test('lueckeText: offene Wochenstunden des Ersatzes, voll oder über Soll', () => {
  assert.equal(lueckeText(12.5), 'noch 12,50 h offen');
  assert.equal(lueckeText(37.5), 'noch 37,50 h offen');
  assert.equal(lueckeText('8'), 'noch 8,00 h offen');
  assert.equal(lueckeText(0), 'Woche voll');
  assert.equal(lueckeText(-1e-9), 'Woche voll');
  assert.equal(lueckeText(-1.25), '1,25 h über Soll');
});

test('ersatzBloecke: Pausen nicht als eigene Blöcke, Stunden der Übernahme ohne Pause', () => {
  const pausen = new Set([10]);
  const r = ersatzBloecke([
    { von: '07:00', bis: '12:30', bereich_id: 1 },
    { von: '12:30', bis: '13:00', bereich_id: 10 },
    { von: '13:00', bis: '15:30', bereich_id: 1 },
  ], pausen);
  assert.deepEqual(r.arbeit.map((b) => b.von), ['07:00', '13:00']);
  assert.equal(r.pauseText, 'inkl. Pause 12:30–13:00');
  assert.equal(r.stunden, 8);
  const zwei = ersatzBloecke([{ von: '08:00', bis: '12:00', bereich_id: 1 }, { von: '12:00', bis: '12:15', bereich_id: 10 },
    { von: '12:15', bis: '16:00', bereich_id: 2 }, { von: '16:00', bis: '16:30', bereich_id: 10 }], [10]);
  assert.equal(zwei.pauseText, 'inkl. Pausen 12:00–12:15, 16:00–16:30');
  assert.equal(zwei.stunden, 7.75);
  const ohne = ersatzBloecke([{ von: '08:00', bis: '10:00', bereich_id: 1 }], pausen);
  assert.equal(ohne.pauseText, '');
  assert.equal(ohne.stunden, 2);
  // Nur eine Pause unbesetzt: dann steht sie selbst da (sonst wäre die Zeile leer), 0 h Arbeit.
  const nurPause = ersatzBloecke([{ von: '12:30', bis: '13:00', bereich_id: 10 }], pausen);
  assert.deepEqual(nurPause.arbeit.map((b) => b.von), ['12:30']);
  assert.equal(nurPause.pauseText, '');
  assert.equal(nurPause.stunden, 0);
});

test('uebernahmeText: Stunden der Übernahme und was danach von der Woche offen bleibt', () => {
  assert.deepEqual(uebernahmeText(8, 10), { text: 'Übernahme 8,00 h · danach noch 2,00 h offen', ueber: false });
  assert.deepEqual(uebernahmeText(8, '6.5'), { text: 'Übernahme 8,00 h · danach 1,50 h über Soll', ueber: true });
  assert.deepEqual(uebernahmeText(7.75, 7.75), { text: 'Übernahme 7,75 h · danach Woche voll', ueber: false });
  assert.deepEqual(uebernahmeText(4, 10.25), { text: 'Übernahme 4,00 h · danach noch 6,25 h offen', ueber: false });
  assert.deepEqual(uebernahmeText(4, -1), { text: 'Übernahme 4,00 h · danach 5,00 h über Soll', ueber: true });
  assert.deepEqual(uebernahmeText(8, 8 + 1e-9), { text: 'Übernahme 8,00 h · danach Woche voll', ueber: false });
});

test('vorgabeText: Wochenvorgabe als Zeile im Eckdaten-Fenster', () => {
  const v = { wochentag: null, art: 'nicht_verfuegbar', von: null, bis: null, max_stunden_tag: null, max_stunden_woche: null };
  assert.equal(vorgabeText({ ...v, wochentag: 6, art: 'nur_zwischen', von: '06:00', bis: '14:00' }), 'Sa: nur 06:00–14:00');
  assert.equal(vorgabeText({ ...v, wochentag: 3 }), 'Mi: nicht verfügbar');
  assert.equal(vorgabeText({ ...v, max_stunden_tag: 6 }), 'alle Tage: höchstens 6 h am Tag');
  assert.equal(vorgabeText({ ...v, wochentag: 7, von: '18:00' }), 'So: nicht 18:00–24:00');
  assert.equal(vorgabeText({ ...v, wochentag: 1, art: 'nur_zwischen', von: '08:00', bis: '13:30', max_stunden_tag: 5.5,
    max_stunden_woche: '20.00' }), 'Mo: nur 08:00–13:30, höchstens 5,5 h am Tag, höchstens 20 h in der Woche');
});

test('aufteilung: Varianten mit 1 bis 3 Personen, kleinster Anteil mindestens 1 h', () => {
  assert.deepEqual(aufteilung(3), [[3], [1.5, 1.5], [1, 1, 1]]);
  assert.deepEqual(aufteilung(2.5), [[2.5], [1.5, 1]]);
  assert.deepEqual(aufteilung(1.5), [[1.5]]);
  assert.deepEqual(aufteilung(0.5), [[0.5]]);
  assert.deepEqual(aufteilung(0), []);
});

test('vorschlagBlock: ab LKW-Zeit, gekürzt auf den Rahmen, sonst null', () => {
  const rahmen = { von: '06:00', bis: '21:30' };
  assert.deepEqual(vorschlagBlock('07:00', 3, rahmen), { von: '07:00', bis: '10:00' });
  assert.deepEqual(vorschlagBlock('20:00', 3, rahmen), { von: '20:00', bis: '21:30' });
  assert.equal(vorschlagBlock('21:30', 1, rahmen), null);
  assert.deepEqual(vorschlagBlock(null, 2, rahmen), { von: '06:00', bis: '08:00' });
  assert.deepEqual(vorschlagBlock('05:00', 2, rahmen), { von: '06:00', bis: '08:00' });
});

function lieferWoche(extra = {}) {
  return {
    bereiche: [
      { id: 1, kuerzel: 'KA', name: 'Kasse', art: 'bereich', bedeutung: 'kasse' },
      { id: 2, kuerzel: 'TS', name: 'Trockensortiment', art: 'bereich', bedeutung: null },
      { id: 9, kuerzel: 'P', name: 'Pause', art: 'pause', bedeutung: null },
    ],
    warengruppen: [
      { id: 10, name: 'Trockensortiment', bereich_id: 2, minuten: 45, position: 1 },
      { id: 11, name: 'Aktion', bereich_id: 2, minuten: 30, position: 2 },
    ],
    lieferung: {
      '2026-11-09': {
        lkw: '07:00', lkw_aus_muster: true,
        rollis: [
          { warengruppe_id: 10, rollis: 12, aus_muster: true },
          { warengruppe_id: 11, rollis: 1, aus_muster: false },
        ],
      },
    },
    bloecke: [
      { id: 1, mitarbeiter_id: 1, datum: '2026-11-09', von: '06:00', bis: '10:00', bereich_id: 2, unbesetzt: false },
      { id: 2, mitarbeiter_id: 2, datum: '2026-11-09', von: '12:00', bis: '14:00', bereich_id: 2, unbesetzt: false },
      { id: 3, mitarbeiter_id: 1, datum: '2026-11-09', von: '08:00', bis: '08:30', bereich_id: 9, unbesetzt: false },
    ],
    ...extra,
  };
}

test('lieferBedarf: nötig aus Rollis × Minuten, geplant ab LKW ohne Pause, fehlt', () => {
  const b = lieferBedarf(lieferWoche(), '2026-11-09');
  assert.equal(b.lkw, '07:00');
  assert.equal(b.lkwAusMuster, true);
  assert.deepEqual(b.gruppen, [
    { id: 10, name: 'Trockensortiment', bereich_id: 2, minuten: 45, rollis: 12, ausMuster: true },
    { id: 11, name: 'Aktion', bereich_id: 2, minuten: 30, rollis: 1, ausMuster: false },
  ]);
  assert.deepEqual(b.bereiche, [{ bereich_id: 2, noetig: 9.5, geplant: 5, fehlt: 4.5 }]);
});

test('lieferBedarf: aufgerundet auf halbe Stunden', () => {
  const w = lieferWoche();
  w.warengruppen = [{ id: 10, name: 'Obst', bereich_id: 2, minuten: 25, position: 1 }];
  w.lieferung['2026-11-09'].rollis = [{ warengruppe_id: 10, rollis: 7, aus_muster: false }];
  assert.equal(lieferBedarf(w, '2026-11-09').bereiche[0].noetig, 3);
});

test('lieferBedarf: ohne LKW zählt der ganze Tag; ohne Eintrag leer', () => {
  const w = lieferWoche();
  w.lieferung['2026-11-09'].lkw = null;
  assert.equal(lieferBedarf(w, '2026-11-09').bereiche[0].geplant, 6);
  assert.deepEqual(lieferBedarf(w, '2026-11-10'), { lkw: null, lkwAusMuster: true, gruppen: [], bereiche: [] });
});

test('standardVariante: wenigste Personen mit größtem Anteil höchstens 6 h, sonst kleinster größter Anteil', () => {
  assert.equal(standardVariante(aufteilung(3)), 0); // 1 × 3 h
  assert.equal(standardVariante(aufteilung(6)), 0); // 1 × 6 h
  assert.equal(standardVariante(aufteilung(9)), 1); // 2 × 4,5 h
  assert.deepEqual(aufteilung(9)[1], [4.5, 4.5]);
  assert.equal(standardVariante(aufteilung(20)), 2); // 3 Personen, auch wenn der Anteil über 6 h bleibt
  assert.equal(standardVariante([]), -1); // nichts fehlt: keine Variante
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  minuten, uhrzeit, halbstunden, isoWoche, montagDerKw, kwVorZurueck, tageDerWoche, plusTage,
  zeitspanne, stundenText,
} from '../docs/zeit.js';
import {
  zellen, strich, abdeckung, abdeckungsKlasse, tagesStunden, wochenSummen, bereichsStunden,
  rueckgaengigStapel, gleicheWochentageBis, naechsteWochen, tagKurz, kopierErgebnis,
} from '../docs/plan-raster.js';

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
  assert.equal(abdeckungsKlasse('vp', 1, true, 1), '');
  assert.equal(abdeckungsKlasse('vp', 0, false, 0), '');
  assert.equal(abdeckungsKlasse('vp', 0, false, 2), 'rot');
  assert.equal(abdeckungsKlasse('vp', 1, false, 2), '');
  assert.equal(abdeckungsKlasse('vp', 1, true, 1), '');
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
});

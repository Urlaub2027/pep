import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wochenGruppen, ziehBereich, monatVorZurueck, zellenKlasse, stundenAnzeige,
} from '../docs/kalender.js';

const tag = (datum, wochentag, kw, extra = {}) =>
  ({ datum, wochentag, kw, geoeffnet: true, feiertag: null, schulferien: null, ...extra });

test('wochenGruppen fasst Tage je kw zusammen und behält die Reihenfolge', () => {
  const tage = [tag('2027-03-01', 1, 9), tag('2027-03-02', 2, 9), tag('2027-03-08', 1, 10), tag('2027-03-09', 2, 10), tag('2027-03-10', 3, 10)];
  const gruppen = wochenGruppen(tage);
  assert.deepEqual(gruppen.map((g) => [g.kw, g.tage.length]), [[9, 2], [10, 3]]);
  assert.equal(gruppen[1].tage[0].datum, '2027-03-08');
  assert.deepEqual(wochenGruppen([]), []);
});

test('ziehBereich("2027-03-10","2027-03-03") → {von:"2027-03-03", bis:"2027-03-10"}', () => {
  assert.deepEqual(ziehBereich('2027-03-10', '2027-03-03'), { von: '2027-03-03', bis: '2027-03-10' });
  assert.deepEqual(ziehBereich('2027-03-03', '2027-03-10'), { von: '2027-03-03', bis: '2027-03-10' });
  assert.deepEqual(ziehBereich('2027-03-05', '2027-03-05'), { von: '2027-03-05', bis: '2027-03-05' });
});

test('monatVorZurueck(2026,12,+1) → {2027,1}; (2027,1,-1) → {2026,12}', () => {
  assert.deepEqual(monatVorZurueck(2026, 12, 1), { jahr: 2027, monat: 1 });
  assert.deepEqual(monatVorZurueck(2027, 1, -1), { jahr: 2026, monat: 12 });
  assert.deepEqual(monatVorZurueck(2027, 3, 1), { jahr: 2027, monat: 4 });
});

test('zellenKlasse: So → wochenende+geschlossen; Feiertag → feiertag+geschlossen; Schulferien → schulferien', () => {
  assert.deepEqual(zellenKlasse(tag('2027-03-07', 7, 9, { geoeffnet: false })), ['wochenende', 'geschlossen']);
  assert.deepEqual(zellenKlasse(tag('2027-03-26', 5, 12, { geoeffnet: false, feiertag: 'Karfreitag' })), ['feiertag', 'geschlossen']);
  assert.deepEqual(zellenKlasse(tag('2027-03-24', 3, 12, { schulferien: 'Osterferien' })), ['schulferien']);
  assert.deepEqual(zellenKlasse(tag('2027-03-23', 2, 12)), []);
  assert.deepEqual(zellenKlasse(tag('2027-03-27', 6, 12)), ['wochenende']);
});

test('stundenAnzeige({code:"U",stunden:6.25}) = "U 6,25"; mit von 08:00 bis 13:00 → "BS 08–13"', () => {
  assert.equal(stundenAnzeige({ code: 'U', stunden: 6.25 }), 'U 6,25');
  assert.equal(stundenAnzeige({ code: 'BS', stunden: 8 }), 'BS 8,00');
  assert.equal(stundenAnzeige({ code: 'BS', stunden: 5, von: '08:00:00', bis: '13:00:00' }), 'BS 08–13');
  assert.equal(stundenAnzeige({ code: 'BS', stunden: 5, von: '08:30', bis: '13:00' }), 'BS 08:30–13');
  assert.equal(stundenAnzeige({ code: 'KM', stunden: null }), 'KM');
});

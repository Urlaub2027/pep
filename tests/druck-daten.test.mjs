// Druckzeilen (docs/druck-daten.js): reine Aufbereitung der Antworten von pep_einsatzplan_woche,
// pep_abwesenheiten und pep_resturlaub für die Ausdrucke und den Excel-Export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tagesplanZeilen, wochenplanZeilen, monatZeilen, resturlaubZeilen, wochenplanBlatt,
} from '../docs/druck-daten.js';

const TAGE = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'];
const KA = 1;
const TS = 4;
const PA = 10;

// Kleine Woche KW 46/2026 im Format von pep_einsatzplan_woche (Blöcke als Abschnitte, F2).
function woche() {
  const block = (id, mid, datum, von, bis, bereich, unbesetzt = false) =>
    ({ id, mitarbeiter_id: mid, datum, von, bis, bereich_id: bereich, unbesetzt });
  return {
    jahr: 2026, kw: 46, montag: TAGE[0], heute: '2026-11-02',
    tage: TAGE.map((datum, i) => ({
      datum, wochentag: i + 1, geoeffnet: i < 6, vergangen: false, feiertag: null,
      rahmen_von: i < 6 ? '06:00' : null, rahmen_bis: i < 6 ? '21:30' : null,
      oeffnung_von: i < 6 ? '07:00' : null, oeffnung_bis: i < 6 ? '20:00' : null,
    })),
    bereiche: [
      { id: KA, kuerzel: 'KA', name: 'Kasse', farbe: '#7FD1FF', art: 'bereich', bedeutung: 'kasse' },
      { id: TS, kuerzel: 'TS', name: 'TroSo', farbe: '#D9B38C', art: 'bereich', bedeutung: null },
      { id: PA, kuerzel: 'PA', name: 'Pause', farbe: '#555555', art: 'pause', bedeutung: null },
    ],
    mitarbeiter: [
      { id: 1, name: 'Test, Anna', personalnummer: '1001', vertragsart: 'vollzeit', wochenstunden: 37.5 },
      { id: 2, name: 'Muster, Ben', personalnummer: null, vertragsart: 'teilzeit', wochenstunden: 20 },
      { id: 3, name: 'Beispiel, Cem', personalnummer: '1003', vertragsart: 'vollzeit', wochenstunden: 37.5 },
      { id: 4, name: 'Probe, Dana', personalnummer: null, vertragsart: 'teilzeit', wochenstunden: 25 },
    ],
    bloecke: [
      // Anna Mo und Di: 07:00–15:30 mit Pause 12:00–12:30
      ...[0, 1].flatMap((t) => [
        block(10 + t, 1, TAGE[t], '07:00', '12:00', KA), block(20 + t, 1, TAGE[t], '12:00', '12:30', PA),
        block(30 + t, 1, TAGE[t], '12:30', '15:30', KA)]),
      // Ben Mo 16:00–20:00; Mi geteilter Dienst 07:00–11:00 und 16:00–20:00
      block(40, 2, TAGE[0], '16:00', '20:00', TS),
      block(41, 2, TAGE[2], '07:00', '11:00', KA), block(42, 2, TAGE[2], '16:00', '20:00', KA),
      // Dana Do: Berufsschule 08:00–13:00, Block 07:00–17:00 → 08:00–13:00 unbesetzt (drei Abschnitte gleicher id)
      block(50, 4, TAGE[3], '07:00', '08:00', TS), block(50, 4, TAGE[3], '08:00', '13:00', TS, true),
      block(50, 4, TAGE[3], '13:00', '17:00', TS),
    ],
    abwesenheiten: [
      ...TAGE.slice(0, 6).map((datum) => ({ mitarbeiter_id: 3, datum, code: 'U', name: 'Urlaub', farbe: '#4CAF50',
        sperrt: true, stunden: 6.25, von: null, bis: null })),
      { mitarbeiter_id: 4, datum: TAGE[3], code: 'BS', name: 'Berufsschule', farbe: '#1E88E5', sperrt: true,
        stunden: 5, von: '08:00', bis: '13:00' },
    ],
    kommentare: [{ mitarbeiter_id: 1, datum: TAGE[0], text: 'Kasse 1' }],
    pruefung: {},
  };
}

test('Wochenplan: Block 07:00–15:30 mit Pause 12:00–12:30 → „07:00–15:30 / 8,00 (P 0:30)“', () => {
  const [anna] = wochenplanZeilen(woche());
  assert.equal(anna.name, 'Test, Anna');
  assert.equal(anna.personalnummer, '1001');
  assert.equal(anna.vertrag, 37.5);
  assert.equal(anna.tage.length, 7);
  assert.equal(anna.tage[0], '07:00–15:30 / 8,00 (P 0:30)');
  assert.equal(anna.tage[1], '07:00–15:30 / 8,00 (P 0:30)');
  assert.equal(anna.tage[2], '');
});

test('Wochenplan: ohne Pause kein „(P …)“, geteilter Dienst zeigt beide Zeiten', () => {
  const ben = wochenplanZeilen(woche())[1];
  assert.equal(ben.tage[0], '16:00–20:00 / 4,00');
  assert.equal(ben.tage[2], '07:00–11:00, 16:00–20:00 / 8,00');
});

test('Wochenplan: Abwesenheit „U/6,25“; Summe und Differenz zum Vertrag (Soll = Vertrag − Abwesenheit)', () => {
  const [anna, ben, cem] = wochenplanZeilen(woche());
  assert.equal(cem.tage[0], 'U/6,25');
  assert.equal(cem.tage[5], 'U/6,25');
  assert.equal(cem.tage[6], '');
  assert.equal(cem.summe, 0);
  assert.equal(cem.abwesend, 37.5);
  assert.equal(cem.differenz, 0); // 0 geplant − (37,5 Vertrag − 37,5 Urlaub)
  assert.equal(anna.summe, 16);
  assert.equal(anna.differenz, -21.5);
  assert.equal(ben.summe, 12);
  assert.equal(ben.differenz, -8);
});

test('Wochenplan: unbesetzte Abschnitte zählen nicht (F2), Teilabwesenheit steht vor den Zeiten', () => {
  const dana = wochenplanZeilen(woche())[3];
  assert.equal(dana.tage[3], 'BS/5,00\n07:00–08:00, 13:00–17:00 / 5,00');
  assert.equal(dana.summe, 5);
  assert.equal(dana.differenz, -15); // 5 − (25 − 5)
});

test('Tagesplan: nur Mitarbeiter mit Blöcken, Zeiten, Stunden, Kommentar, Zellen mit Kürzel und Farbe', () => {
  const { zeilen, abwesende, spalten } = tagesplanZeilen(woche(), TAGE[0]);
  assert.equal(spalten.length, 31); // 06:00–21:30
  assert.deepEqual(zeilen.map((z) => z.name), ['Test, Anna', 'Muster, Ben']);
  const [anna] = zeilen;
  assert.equal(anna.zeiten, '07:00–15:30');
  assert.equal(anna.stunden, 8);
  assert.equal(anna.kommentar, 'Kasse 1');
  assert.equal(anna.zellen.length, 31);
  assert.equal(anna.zellen[0], null); // 06:00
  assert.deepEqual(anna.zellen[2], { kuerzel: 'KA', farbe: '#7FD1FF', unbesetzt: false }); // 07:00
  assert.deepEqual(anna.zellen[12], { kuerzel: 'PA', farbe: '#555555', unbesetzt: false }); // 12:00
  assert.equal(anna.zellen[19], null); // 15:30
  assert.deepEqual(abwesende, [{ name: 'Beispiel, Cem', code: 'U', zeiten: '' }]);
});

test('Tagesplan: Teilabwesende stehen im Raster (unbesetzt markiert) und in den Abwesenden', () => {
  const { zeilen, abwesende } = tagesplanZeilen(woche(), TAGE[3]);
  const dana = zeilen.find((z) => z.name === 'Probe, Dana');
  assert.equal(dana.zeiten, '07:00–08:00, 13:00–17:00');
  assert.equal(dana.stunden, 5);
  assert.deepEqual(dana.zellen[4], { kuerzel: 'TS', farbe: '#D9B38C', unbesetzt: true }); // 08:00
  assert.deepEqual(abwesende.map((a) => [a.name, a.code, a.zeiten]),
    [['Beispiel, Cem', 'U', ''], ['Probe, Dana', 'BS', '08:00–13:00']]);
});

test('Tagesplan: geschlossener Tag ohne Spalten und Zeilen', () => {
  const { zeilen, spalten } = tagesplanZeilen(woche(), TAGE[6]);
  assert.deepEqual(spalten, []);
  assert.deepEqual(zeilen, []);
});

test('Excel-Blatt Wochenplan: Kopf mit Tagen, Zeilen mit Text und Zahlen', () => {
  const blatt = wochenplanBlatt(woche());
  assert.equal(blatt.name, 'KW 46 2026');
  assert.deepEqual(blatt.spalten.map((s) => s.titel), ['Name', 'Personalnr.', 'Vertrag (h)',
    'Mo 09.11.', 'Di 10.11.', 'Mi 11.11.', 'Do 12.11.', 'Fr 13.11.', 'Sa 14.11.', 'So 15.11.',
    'geplant (h)', 'abwesend (h)', 'Differenz (h)']);
  assert.deepEqual(blatt.zeilen[0], ['Test, Anna', '1001', 37.5,
    '07:00–15:30 / 8,00 (P 0:30)', '07:00–15:30 / 8,00 (P 0:30)', '', '', '', '', '', 16, 0, -21.5]);
  assert.equal(blatt.zeilen.length, 4);
});

// Monatsdaten im Format von pep_abwesenheiten (gekürzt auf drei Tage).
const monat = () => ({
  tage: [
    { datum: '2026-11-01', wochentag: 7, kw: 44, geoeffnet: false, feiertag: 'Allerheiligen', schulferien: null },
    { datum: '2026-11-02', wochentag: 1, kw: 45, geoeffnet: true, feiertag: null, schulferien: 'Herbstferien' },
    { datum: '2026-11-03', wochentag: 2, kw: 45, geoeffnet: true, feiertag: null, schulferien: null },
  ],
  codes: [{ id: 1, code: 'U', farbe: '#4CAF50' }, { id: 5, code: 'BS', farbe: '#1E88E5' }],
  mitarbeiter: [
    { id: 1, name: 'Test, Anna', aktiv: true, tage: {
      '2026-11-02': { code: 'U', code_id: 1, stunden: 6.25, von: null, bis: null },
      '2026-11-03': { code: 'U', code_id: 1, stunden: 6.25, von: null, bis: null } } },
    { id: 2, name: 'Muster, Ben', aktiv: true, tage: {
      '2026-11-03': { code: 'BS', code_id: 5, stunden: 5, von: '08:00', bis: '13:00' } } },
    { id: 3, name: 'Beispiel, Cem', aktiv: true, tage: {} },
  ],
  summen: { '2026-11-02': 6.25, '2026-11-03': 11.25 },
  wuensche: [{ mitarbeiter_id: 3, von: '2026-11-03', bis: '2026-11-03', status: 'offen' }],
});

test('Abwesenheitsmonat: Zellen mit Code, Stunden und Farbe; Zeilen-, Tages- und Monatssumme; Wünsche nicht', () => {
  const m = monatZeilen(monat());
  assert.deepEqual(m.tage.map((t) => [t.datum, t.text, t.kw, t.frei]),
    [['2026-11-01', 'So 1.', 44, true], ['2026-11-02', 'Mo 2.', 45, false], ['2026-11-03', 'Di 3.', 45, false]]);
  assert.deepEqual(m.zeilen.map((z) => z.name), ['Test, Anna', 'Muster, Ben', 'Beispiel, Cem']);
  assert.deepEqual(m.zeilen[0].zellen, [null, { code: 'U', text: '6,25', farbe: '#4CAF50' },
    { code: 'U', text: '6,25', farbe: '#4CAF50' }]);
  assert.deepEqual(m.zeilen[1].zellen[2], { code: 'BS', text: '08–13', farbe: '#1E88E5' });
  assert.deepEqual(m.zeilen.map((z) => z.summe), [12.5, 5, 0]);
  assert.deepEqual(m.zeilen[2].zellen, [null, null, null]); // offener Wunsch erscheint nicht
  assert.deepEqual(m.tagessummen, [0, 6.25, 11.25]);
  assert.equal(m.monatssumme, 17.5);
});

test('Resturlaub: Zeilen wie geliefert, Summenzeile über Anspruch, Monate, genehmigt und Rest', () => {
  const daten = {
    jahr: 2026, stand: '2026-11-02',
    mitarbeiter: [
      { id: 1, name: 'Test, Anna', personalnummer: '1001', wochenstunden: 37.5, tagesstunden: 6.25, anspruch: 150,
        rest_vorjahr: 10, monate: [31.25, 0, 6.25, 0, 0, 0, 0, 0, 0, 0, 0, 0], genehmigt: 37.5, rest: 122.5, rest_tage: 19.6 },
      { id: 2, name: 'Muster, Ben', personalnummer: null, wochenstunden: 20, tagesstunden: 3.33, anspruch: 0,
        rest_vorjahr: 0, monate: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0], genehmigt: 10, rest: -10, rest_tage: -3 },
    ],
  };
  const r = resturlaubZeilen(daten);
  assert.equal(r.zeilen.length, 2);
  assert.equal(r.zeilen[0].rest_tage, 19.6);
  assert.deepEqual(r.summe.monate, [31.25, 0, 6.25, 0, 0, 0, 0, 0, 0, 0, 10, 0]);
  assert.equal(r.summe.anspruch, 150);
  assert.equal(r.summe.rest_vorjahr, 10);
  assert.equal(r.summe.genehmigt, 47.5);
  assert.equal(r.summe.rest, 112.5);
});

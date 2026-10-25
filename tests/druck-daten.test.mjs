// Druckzeilen (docs/druck-daten.js): reine Aufbereitung der Antworten von pep_einsatzplan_woche,
// pep_abwesenheiten und pep_resturlaub für die Ausdrucke und den Excel-Export; Stufe 2: pep_ist_woche mit
// pep_zeitkonto_woche (Wocheneinsatz-IST), pep_stundenblatt (Stundenblatt) und pep_zeitkonto_journal (Excel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tagesplanZeilen, wochenplanZeilen, monatZeilen, resturlaubZeilen, wochenplanBlatt,
  wochenIstZeilen, stundenblattSeiten, journalTabelle,
} from '../docs/druck-daten.js';
import { erzeugeXlsx, excelDatum } from '../docs/xlsx.js';

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

// ---------------------------------------------------------------- Stufe 2: Wocheneinsatz-IST, Stundenblatt, Journal

// IST-Woche KW 46 im Format von pep_ist_woche, heute = Do 12.11.: Blöcke = IST bzw. Vorschlag (vorschlag: true),
// status je IST-Zeile (fehlt = keine IST-Zeile: künftig, geschlossen, ganztägig abwesend).
function istWoche() {
  const w = woche();
  const seg = (mid, datum, von, bis, bereich, extra = {}) =>
    ({ id: 1, mitarbeiter_id: mid, datum, von, bis, bereich_id: bereich, unbesetzt: false, vorschlag: false, ...extra });
  const st = (mid, datum, bestaetigt) =>
    ({ mitarbeiter_id: mid, datum, bestaetigt, bestaetigt_am: bestaetigt ? '2026-11-12T20:00:00+01:00' : null });
  return {
    ...w, modus: 'ist', heute: '2026-11-12',
    bloecke: [
      // Anna Mo bestätigt 07:00–15:30 mit Pause; Mi offen nur mit Vorschlag; Do offen mit eigenem IST
      seg(1, TAGE[0], '07:00', '12:00', KA), seg(1, TAGE[0], '12:00', '12:30', PA), seg(1, TAGE[0], '12:30', '15:30', KA),
      seg(1, TAGE[2], '08:00', '12:00', KA, { id: null, vorschlag: true }),
      seg(1, TAGE[3], '07:00', '09:00', KA),
      // Dana Mo: KM 08–10, danach IST 10–14 bestätigt; Di: KM 08–10, offen mit Vorschlag
      seg(4, TAGE[0], '10:00', '14:00', TS),
      seg(4, TAGE[1], '10:00', '14:00', TS, { id: null, vorschlag: true }),
    ],
    abwesenheiten: [
      ...TAGE.slice(0, 6).map((datum) => ({ mitarbeiter_id: 3, datum, code: 'U', name: 'Urlaub', farbe: '#4CAF50',
        sperrt: true, stunden: 6.25, von: null, bis: null })),
      ...[0, 1].map((t) => ({ mitarbeiter_id: 4, datum: TAGE[t], code: 'KM', name: 'Krank', farbe: '#E53935', sperrt: true,
        stunden: 2, von: '08:00', bis: '10:00' })),
    ],
    status: [
      st(1, TAGE[0], true), st(1, TAGE[1], true), st(1, TAGE[2], false), st(1, TAGE[3], false),
      st(4, TAGE[0], true), st(4, TAGE[1], false),
    ],
  };
}

// pep_zeitkonto_woche KW 46 (Ben ohne Vertrag, also ohne Zeile).
const zkWoche = () => ({
  jahr: 2026, kw: 46, montag: TAGE[0], abgeschlossen: null, offene_tage: 3,
  mitarbeiter: [
    { id: 1, name: 'Test, Anna', aktiv: true, vertragsart: 'vollzeit', wochenstunden: 37.5, soll: 37.5, ist: 8, abwesend: 0,
      feiertag: 0, summe: 8, diff: -29.5, spaet: 1.5, offene_tage: 2, saldo_vorwoche: 4, saldo_aktuell: -25.5, warnung: null },
    { id: 3, name: 'Beispiel, Cem', aktiv: true, vertragsart: 'vollzeit', wochenstunden: 37.5, soll: 37.5, ist: 0,
      abwesend: 37.5, feiertag: 0, summe: 37.5, diff: 0, spaet: 0, offene_tage: 0, saldo_vorwoche: -2.25,
      saldo_aktuell: -2.25, warnung: null },
    { id: 4, name: 'Probe, Dana', aktiv: true, vertragsart: 'teilzeit', wochenstunden: 25, soll: 25, ist: 4, abwesend: 4,
      feiertag: 0, summe: 8, diff: -17, spaet: 0, offene_tage: 1, saldo_vorwoche: 0, saldo_aktuell: -17, warnung: null },
  ],
});

test('Wocheneinsatz-IST: bestätigt „07:00–15:30 / 8,00 (P 0:30)“, offen „offen“, Vorschlag zählt nicht, geschlossen „–“', () => {
  const [anna] = wochenIstZeilen(istWoche(), zkWoche());
  assert.equal(anna.name, 'Test, Anna');
  assert.equal(anna.personalnummer, '1001');
  // Mo bestätigt, Di bestätigt ohne IST, Mi offen (nur Vorschlag), Do offen mit IST, Fr/Sa künftig, So geschlossen
  assert.deepEqual(anna.tage, ['07:00–15:30 / 8,00 (P 0:30)', '–', 'offen', 'offen', '', '', '–']);
  assert.deepEqual([anna.vertrag, anna.soll, anna.ist, anna.spaet, anna.diff, anna.saldo_vorwoche, anna.saldo_aktuell],
    [37.5, 37.5, 8, 1.5, -29.5, 4, -25.5]);
  assert.equal(anna.gebucht, true, 'ohne Feld gebucht: wie gebucht');
});

test('Wocheneinsatz-IST: Abwesenheit ohne Gutschrift (zaehlt false) wie im Stundenblatt „ZA (ohne Gutschrift)“', () => {
  const ist = istWoche();
  const abw = (mid, datum) => ist.abwesenheiten.find((a) => a.mitarbeiter_id === mid && a.datum === datum);
  Object.assign(abw(3, TAGE[1]), { code: 'ZA', zaehlt: false }); // keine IST-Zeile
  Object.assign(abw(3, TAGE[2]), { zaehlt: true });
  abw(4, TAGE[0]).zaehlt = false; // bestätigt mit IST
  abw(4, TAGE[1]).zaehlt = false; // offen
  const [, , cem, dana] = wochenIstZeilen(ist, zkWoche());
  assert.deepEqual(cem.tage.slice(0, 3), ['U/6,25', 'ZA (ohne Gutschrift)', 'U/6,25']);
  assert.equal(dana.tage[0], 'KM (ohne Gutschrift)\n10:00–14:00 / 4,00');
  assert.equal(dana.tage[1], 'KM (ohne Gutschrift)\noffen');
});

test('Wocheneinsatz-IST: gebucht aus dem Zeitkonto (false = Diff nicht gebucht), ohne Zeitkonto-Zeile null', () => {
  const zk = zkWoche();
  zk.mitarbeiter[1] = { ...zk.mitarbeiter[1], gebucht: false, diff: -37.5, saldo_aktuell: -2.25 };
  const [anna, ben, cem] = wochenIstZeilen(istWoche(), zk);
  assert.deepEqual([anna.gebucht, ben.gebucht, cem.gebucht], [true, null, false]);
  assert.deepEqual([cem.diff, cem.saldo_aktuell], [-37.5, -2.25]);
});

test('Wocheneinsatz-IST: Abwesenheit „U/6,25“; Teil-KM vor dem IST bzw. vor „offen“; ohne Zeitkonto-Zeile leer', () => {
  const [, ben, cem, dana] = wochenIstZeilen(istWoche(), zkWoche());
  assert.deepEqual(cem.tage, ['U/6,25', 'U/6,25', 'U/6,25', 'U/6,25', 'U/6,25', 'U/6,25', '–']);
  assert.equal(cem.saldo_vorwoche, -2.25);
  assert.equal(dana.tage[0], 'KM/2,00\n10:00–14:00 / 4,00');
  assert.equal(dana.tage[1], 'KM/2,00\noffen');
  assert.equal(ben.name, 'Muster, Ben');
  assert.deepEqual([ben.vertrag, ben.soll, ben.ist, ben.diff, ben.saldo_aktuell], [20, null, null, null, null]);
  assert.deepEqual(ben.tage, ['', '', '', '', '', '', '–'], 'Plan-Blöcke stehen nicht in der IST-Woche');
});

// pep_stundenblatt: eine Person, Fr 01.01.–Fr 08.01.2027 (IST ab 04.01.), Tage gekürzt.
const tagZeile = (datum, werte = {}) => ({ datum, vor_start: false, offen: false, feiertag: null, anwesend_von: null,
  anwesend_bis: null, pause: null, abwesend: null, arbeitszeit: null, spannen: null, ...werte });
const stundenblatt = () => ({
  von: '2027-01-01', bis: '2027-01-10',
  mitarbeiter: [{
    id: 1, name: 'Test, Anna', personalnummer: '1001',
    tage: [
      tagZeile('2027-01-01', { vor_start: true }),
      tagZeile('2027-01-04', { anwesend_von: '07:00', anwesend_bis: '15:30', pause: 0.5, arbeitszeit: 8,
        spannen: [{ von: '07:00', bis: '15:30' }] }),
      tagZeile('2027-01-05', { abwesend: { code: 'U', stunden: 6.25, zaehlt: true } }),
      // U am geschlossenen Feiertag: die Feiertagsgutschrift hat Vorrang, U zählt nicht
      tagZeile('2027-01-06', { feiertag: 'Heilige Drei Könige', abwesend: { code: 'U', stunden: 6.25, zaehlt: false } }),
      tagZeile('2027-01-07', { offen: true }),
      tagZeile('2027-01-08', { anwesend_von: '22:00', anwesend_bis: '24:00', pause: 0,
        abwesend: { code: 'KM', stunden: 2, zaehlt: true }, arbeitszeit: 2, spannen: [{ von: '22:00', bis: '24:00' }] }),
      tagZeile('2027-01-09', { abwesend: { code: 'ZA', stunden: 6.25, zaehlt: false } }), // ohne Gutschrift
      tagZeile('2027-01-10', { anwesend_von: '06:00', anwesend_bis: '17:30', pause: 0, arbeitszeit: 6,
        spannen: [{ von: '06:00', bis: '08:00' }, { von: '13:30', bis: '17:30' }] }),
    ],
    wochen: [
      { montag: '2026-12-28', kw: 53, jahr: 2026, soll: 37.5, ist: 0, abwesend: 0, feiertag: 6.25, diff: -31.25,
        saldo_nach: -3.5, abgeschlossen: false, vor_ist_start: true },
      { montag: '2027-01-04', kw: 1, jahr: 2027, soll: 37.5, ist: 10, abwesend: 6.25, feiertag: 6.25, diff: -15,
        saldo_nach: -1.5, abgeschlossen: false, vor_ist_start: false },
      { montag: '2027-01-11', kw: 2, jahr: 2027, soll: 37.5, ist: 40, abwesend: 0, feiertag: 0, diff: 2.5,
        saldo_nach: 1, abgeschlossen: true, vor_ist_start: false },
      // abgeschlossen, aber ohne Zeile woche (etwa inaktiv): Diff steht da, ist aber nicht gebucht
      { montag: '2027-01-18', kw: 3, jahr: 2027, soll: 37.5, ist: 0, abwesend: 0, feiertag: 0, diff: -37.5,
        saldo_nach: 1, abgeschlossen: true, vor_ist_start: false, gebucht: false },
    ],
  }],
});

test('Stundenblatt: Tageszeilen mit Zeiten, Pause „0:30“, Abwesenheit, Arbeitszeit, Hinweis; ZA zählt nicht in der Summe', () => {
  const [seite] = stundenblattSeiten(stundenblatt());
  assert.equal(seite.name, 'Test, Anna');
  assert.equal(seite.personalnummer, '1001');
  assert.deepEqual(seite.zeilen.map((z) => [z.tag, z.von, z.bis, z.pause, z.abwesend, z.arbeitszeit, z.hinweis]), [
    ['Fr 01.01.', '', '', '', '', '', 'vor IST-Start'],
    ['Mo 04.01.', '07:00', '15:30', '0:30', '', '8,00', ''],
    ['Di 05.01.', '', '', '', 'U/6,25', '', ''],
    ['Mi 06.01.', '', '', '', 'U (ohne Gutschrift)', '', 'Heilige Drei Könige'],
    ['Do 07.01.', '', '', '', '', '', 'offen'],
    ['Fr 08.01.', '22:00', '24:00', '', 'KM/2,00', '2,00', ''],
    ['Sa 09.01.', '', '', '', 'ZA (ohne Gutschrift)', '', ''],
    ['So 10.01.', '06:00', '17:30', '', '', '6,00', 'geteilter Dienst 06:00–08:00, 13:30–17:30'],
  ]);
  assert.deepEqual(seite.zeilen.map((z) => z.datum), ['2027-01-01', '2027-01-04', '2027-01-05', '2027-01-06',
    '2027-01-07', '2027-01-08', '2027-01-09', '2027-01-10']);
  // Abwesenheit wie im Zeitkonto: nur U 05.01. und KM 08.01. (ZA und U am Feiertag ohne Gutschrift)
  assert.deepEqual(seite.summe, { arbeitszeit: '16,00', abwesend: '8,25' });
});

test('Stundenblatt: Wochenzeilen mit Soll, IST, Abwesend, Feiertag, Diff und Saldo; nicht Gebuchtes markiert', () => {
  const [seite] = stundenblattSeiten(stundenblatt());
  assert.deepEqual(seite.wochen.map((w) => [w.kw, w.zeitraum, w.soll, w.ist, w.abwesend, w.feiertag, w.diff, w.saldo, w.hinweis]), [
    ['KW 53/2026', '28.12.–03.01.', '37,50', '0,00', '0,00', '6,25', '−31,25', '−3,50', 'vor IST-Start, nicht gebucht'],
    ['KW 1/2027', '04.01.–10.01.', '37,50', '10,00', '6,25', '6,25', '−15,00', '−1,50', 'nicht abgeschlossen'],
    ['KW 2/2027', '11.01.–17.01.', '37,50', '40,00', '0,00', '0,00', '+2,50', '+1,00', ''],
    ['KW 3/2027', '18.01.–24.01.', '37,50', '0,00', '0,00', '0,00', '−37,50', '+1,00', 'nicht gebucht'],
  ]);
});

test('Stundenblatt: ohne Mitarbeiter keine Seite', () => {
  assert.deepEqual(stundenblattSeiten({ von: '2027-01-01', bis: '2027-01-08', mitarbeiter: [] }), []);
});

// pep_zeitkonto_journal (Sortierung datum, id) mit zwei Mitarbeitern; die Korrektur für KW 45 wurde nach dem Abschluss
// von KW 46 gebucht (id 5), ihr saldo_nach folgt der Buchungsreihenfolge.
const journal = () => [
  { id: 1, mitarbeiter_id: 2, name: 'Muster, Ben', datum: '2026-11-01', kw: 44, jahr: 2026, art: 'start', stunden: 45,
    saldo_nach: 45, grund: 'Übernahme', angelegt_von_name: 'chef', angelegt_am: '2026-11-02T08:00:00+01:00' },
  { id: 2, mitarbeiter_id: 1, name: 'Test, Anna', datum: '2026-11-01', kw: 44, jahr: 2026, art: 'start', stunden: -40,
    saldo_nach: -40, grund: 'Übernahme', angelegt_von_name: 'chef', angelegt_am: '2026-11-02T08:00:00+01:00' },
  { id: 3, mitarbeiter_id: 1, name: 'Test, Anna', datum: '2026-11-02', kw: 45, jahr: 2026, art: 'woche', stunden: 2.5,
    saldo_nach: -37.5, grund: null, angelegt_von_name: 'chef', angelegt_am: '2026-11-09T08:00:00+01:00' },
  { id: 5, mitarbeiter_id: 1, name: 'Test, Anna', datum: '2026-11-02', kw: 45, jahr: 2026, art: 'korrektur', stunden: 1,
    saldo_nach: -38.5, grund: 'KW 45/2026: IST geändert', angelegt_von_name: 'vize', angelegt_am: '2026-11-17T08:00:00+01:00' },
  { id: 4, mitarbeiter_id: 1, name: 'Test, Anna', datum: '2026-11-09', kw: 46, jahr: 2026, art: 'woche', stunden: -2,
    saldo_nach: -39.5, grund: null, angelegt_von_name: null, angelegt_am: '2026-11-16T08:00:00+01:00' },
];

test('Journal-Excel: ein Blatt, Spalten Datum, KW, Mitarbeiter, Art, Stunden, Saldo, Grund, Von; nach Name, dann id', () => {
  const blatt = journalTabelle(journal());
  assert.equal(blatt.name, 'Journal');
  assert.deepEqual(blatt.spalten.map((s) => s.titel), ['Datum', 'KW', 'Mitarbeiter', 'Art', 'Stunden', 'Saldo', 'Grund', 'Von']);
  assert.deepEqual(blatt.zeilen, [
    [{ datum: '2026-11-01' }, 44, 'Muster, Ben', 'Startsaldo', 45, 45, 'Übernahme', 'chef'],
    [{ datum: '2026-11-01' }, 44, 'Test, Anna', 'Startsaldo', -40, -40, 'Übernahme', 'chef'],
    [{ datum: '2026-11-02' }, 45, 'Test, Anna', 'Wochenabschluss', 2.5, -37.5, '', 'chef'],
    [{ datum: '2026-11-09' }, 46, 'Test, Anna', 'Wochenabschluss', -2, -39.5, '', ''],
    [{ datum: '2026-11-02' }, 45, 'Test, Anna', 'Korrektur (automatisch)', 1, -38.5, 'KW 45/2026: IST geändert', 'vize'],
  ]);
  // Zahlen bleiben Zahlen (xlsx.js schreibt nur echte Zahlen als Zahlzellen)
  for (const z of blatt.zeilen) for (const i of [1, 4, 5]) assert.equal(typeof z[i], 'number');
  // Zahlen aus der Datenbank kommen als JSON-Zahl, numeric kann aber auch als Text ankommen
  const text = journalTabelle([{ ...journal()[0], stunden: '45.00', saldo_nach: '45.00' }]);
  assert.deepEqual(text.zeilen[0].slice(4, 6), [45, 45]);
});

// docs/xlsx.js: Datumszelle { datum: 'JJJJ-MM-TT' } = Excel-Seriennummer (Tage seit 30.12.1899) mit Zahlenformat
// dd.mm.yyyy (eigenes numFmtId 164, Stil 3). Die Datei ist unkomprimiert, die XML-Teile sind also direkt lesbar.
test('Excel-Datum: Seriennummer seit 30.12.1899, Zelle mit Datumsstil, Format dd.mm.yyyy in styles.xml', () => {
  assert.equal(excelDatum('2026-11-16'), 46342);
  assert.equal(excelDatum('2026-11-01'), 46327);
  assert.equal(excelDatum('1900-03-01'), 61); // nach Excels Schaltjahr-Fehler 1900 stimmt die Zählung ab März 1900
  assert.equal(excelDatum('quatsch'), null);
  const text = new TextDecoder().decode(erzeugeXlsx([journalTabelle(journal())]));
  const blatt = text.slice(text.indexOf('<worksheet'), text.indexOf('</worksheet>'));
  assert.match(blatt, /<c r="A2" s="3"><v>46327<\/v><\/c>/, 'Datum als Zahl mit Stil 3');
  assert.match(blatt, /<c r="B2" s="2"><v>44<\/v><\/c>/, 'KW bleibt Zahl mit Datenstil');
  const styles = text.slice(text.indexOf('<styleSheet'), text.indexOf('</styleSheet>'));
  assert.match(styles, /<numFmts count="1"><numFmt numFmtId="164" formatCode="dd\.mm\.yyyy"\/><\/numFmts>/);
  assert.match(styles, /<cellXfs count="4">/);
  const xfs = [...styles.slice(styles.indexOf('<cellXfs')).matchAll(/<xf [^>]*>/g)].map((m) => m[0]);
  assert.match(xfs[3], /numFmtId="164"/);
  assert.match(xfs[3], /applyNumberFormat="1"/);
  // Ohne gültiges Datum leere Zelle; der Wochenplan nutzt keinen Datumsstil
  const leer = new TextDecoder().decode(erzeugeXlsx([{ name: 'X', spalten: [{ titel: 'D' }], zeilen: [[{ datum: null }]] }]));
  assert.match(leer, /<row r="2"><\/row>/);
  const plan = new TextDecoder().decode(erzeugeXlsx([wochenplanBlatt(woche())]));
  assert.ok(!plan.slice(plan.indexOf('<worksheet')).includes('s="3"'));
});

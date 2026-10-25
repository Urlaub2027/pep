// Reine Aufbereitung des Reiters Zeitkonto (docs/zeitkonto-daten.js): Vorzeichen-Format, Journalzeilen,
// Wochensumme und Stunden-Eingabe. Kein DOM, keine Datenbank.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vorzeichen, journalZeilen, wochenSumme, stundenEingabe } from '../docs/zeitkonto-daten.js';

test('vorzeichen: zwei Stellen mit Komma, Plus und echtes Minuszeichen, 0 ohne Vorzeichen', () => {
  assert.equal(vorzeichen(2.5), '+2,50');
  assert.equal(vorzeichen(-1.25), '−1,25');
  assert.equal(vorzeichen(0), '0,00');
  assert.equal(vorzeichen(-0), '0,00');
  assert.equal(vorzeichen(-0.001), '0,00'); // Rechenrest wird 0, nicht „−0,00“
  assert.equal(vorzeichen('37.5'), '+37,50'); // jsonb-Zahl als Text
  assert.equal(vorzeichen(1234.5), '+1234,50');
  assert.equal(vorzeichen(null), '–');
});

// Antwort von pep_zeitkonto_journal: nach datum, id sortiert. Die Korrektur für KW 45 (id 4) ist nach dem Abschluss
// von KW 46 (id 3) gebucht; saldo_nach folgt der Buchungsreihenfolge (id).
const JOURNAL = [
  { id: 1, mitarbeiter_id: 7, name: 'Demo, Emil', datum: '2026-11-01', kw: 44, jahr: 2026, art: 'start', stunden: 12.5,
    saldo_nach: 12.5, grund: 'Übernahme aus Excel', angelegt_von_name: 'chef', angelegt_am: '2026-11-01T09:00:00+01:00' },
  { id: 2, mitarbeiter_id: 7, name: 'Demo, Emil', datum: '2026-11-02', kw: 45, jahr: 2026, art: 'woche', stunden: -3,
    saldo_nach: 9.5, grund: null, angelegt_von_name: 'chef', angelegt_am: '2026-11-09T08:00:00+01:00' },
  { id: 4, mitarbeiter_id: 7, name: 'Demo, Emil', datum: '2026-11-02', kw: 45, jahr: 2026, art: 'korrektur', stunden: 1,
    saldo_nach: 6, grund: 'KW 45/2026: Inventur länger', angelegt_von_name: 'chef', angelegt_am: '2026-11-17T10:00:00+01:00' },
  { id: 3, mitarbeiter_id: 7, name: 'Demo, Emil', datum: '2026-11-09', kw: 46, jahr: 2026, art: 'woche', stunden: -4.5,
    saldo_nach: 5, grund: null, angelegt_von_name: null, angelegt_am: '2026-11-16T08:00:00+01:00' },
  { id: 5, mitarbeiter_id: 7, name: 'Demo, Emil', datum: '2026-12-28', kw: 53, jahr: 2026, art: 'manuell', stunden: -2.25,
    saldo_nach: 3.75, grund: 'ausgezahlt', angelegt_von_name: 'chef', angelegt_am: '2026-11-17T11:00:00+01:00' },
];

test('journalZeilen: Buchungsreihenfolge (id), saldo_nach unverändert übernommen, KW mit ISO-Jahr, Art als Text', () => {
  const zeilen = journalZeilen(JOURNAL);
  assert.deepEqual(zeilen.map((z) => z.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(zeilen.map((z) => z.saldo), [12.5, 9.5, 5, 6, 3.75]); // saldo_nach, nicht neu gerechnet
  assert.deepEqual(zeilen[3], {
    id: 4, datum: '2026-11-02', kw: 'KW 45/2026', art: 'Korrektur (automatisch)', stunden: 1, saldo: 6,
    grund: 'KW 45/2026: Inventur länger', von: 'chef', am: '2026-11-17',
  });
  assert.deepEqual(zeilen.map((z) => z.art), ['Startsaldo', 'Wochenabschluss', 'Wochenabschluss', 'Korrektur (automatisch)', 'Korrektur von Hand']);
  assert.equal(zeilen[0].kw, 'KW 44/2026');
  assert.equal(zeilen[4].kw, 'KW 53/2026');
  assert.equal(zeilen[2].von, ''); // Anleger unbekannt: leer statt „null“
  assert.equal(zeilen[1].grund, '');
  // Eingabe bleibt unverändert (sortiert wird eine Kopie)
  assert.deepEqual(JOURNAL.map((b) => b.id), [1, 2, 4, 3, 5]);
  assert.deepEqual(journalZeilen([]), []);
  assert.deepEqual(journalZeilen(null), []);
});

test('journalZeilen: ISO-Jahr der Woche, nicht das Kalenderjahr des Datums (Jahreswechsel)', () => {
  const [z] = journalZeilen([{ ...JOURNAL[0], datum: '2027-01-01', kw: 53, jahr: 2026 }]);
  assert.equal(z.kw, 'KW 53/2026');
});

test('wochenSumme: Summe von Soll, IST, Abwesend, Feiertag und Diff über alle Zeilen, auf zwei Stellen', () => {
  const ma = [
    { soll: 37.5, ist: 40, abwesend: 0, feiertag: 0, diff: 2.5 },
    { soll: 13.33, ist: 6.67, abwesend: 3.33, feiertag: 3.33, diff: 0 },
    { soll: 25, ist: '0.1', abwesend: 0.2, feiertag: 0, diff: -24.7 },
  ];
  assert.deepEqual(wochenSumme(ma), { soll: 75.83, ist: 46.77, abwesend: 3.53, feiertag: 3.33, diff: -22.2 });
  assert.deepEqual(wochenSumme([]), { soll: 0, ist: 0, abwesend: 0, feiertag: 0, diff: 0 });
});

test('stundenEingabe: Komma oder Punkt, Minus auch typografisch, höchstens zwei Stellen, 0 und Unsinn ungültig', () => {
  assert.equal(stundenEingabe('2,25'), 2.25);
  assert.equal(stundenEingabe('−4,5'), -4.5);
  assert.equal(stundenEingabe('-4,5'), -4.5);
  assert.equal(stundenEingabe('+8'), 8);
  assert.equal(stundenEingabe(' 12 '), 12);
  assert.equal(stundenEingabe('7.5'), 7.5);
  assert.equal(stundenEingabe('− 3,75'), -3.75);
  assert.equal(stundenEingabe(',5'), 0.5);
  assert.equal(stundenEingabe('999'), 999);
  assert.equal(stundenEingabe(''), null);
  assert.equal(stundenEingabe('   '), null);
  assert.equal(stundenEingabe(null), null);
  for (const falsch of ['0', '0,00', '-0', '1,234', 'abc', '1,2,3', '--2', '2-', '1000', '1e2', ',', '-', '2,']) {
    assert.ok(Number.isNaN(stundenEingabe(falsch)), falsch);
  }
});

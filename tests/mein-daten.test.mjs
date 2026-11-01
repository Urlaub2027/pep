// Mitarbeiter-Ansicht, reine Aufbereitung (docs/mein-daten.js): Tageszeilen, Kollegen, Saldo, Wochenkopf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagZeilen, kollegenText, saldoText, stundenKurz, tagKopf, wochenText, geaendertText } from '../docs/mein-daten.js';

const tag = (ueberschreibe = {}) => ({
  datum: '2026-11-10', geoeffnet: true, feiertag: null, bloecke: [], kommentar: null, abwesenheit: null, kollegen: [],
  ...ueberschreibe,
});

test('Tageszeile: Blöcke und Pause in Reihenfolge, Pause ohne Bereichskürzel', () => {
  const z = tagZeilen(tag({ bloecke: [
    { von: '08:00', bis: '12:00', bereich_kuerzel: 'KA', bereich_name: 'Kasse', pause: false },
    { von: '12:00', bis: '12:30', bereich_kuerzel: 'PA', bereich_name: 'Pause', pause: true },
    { von: '12:30', bis: '16:00', bereich_kuerzel: 'TS', bereich_name: 'Tiefkühl', pause: false },
  ] }));
  assert.deepEqual(z, [{ art: 'zeit', text: '08:00–12:00 KA, Pause 12:00–12:30, 12:30–16:00 TS' }]);
});

test('Tageszeile: Feiertag, Kommentar, nicht eingeteilt, geschlossen', () => {
  assert.deepEqual(tagZeilen(tag({ geoeffnet: false, feiertag: 'Allerheiligen' })), [{ art: 'feiertag', text: 'Feiertag: Allerheiligen' }]);
  assert.deepEqual(tagZeilen(tag()), [{ art: 'leer', text: 'Nicht eingeteilt' }]);
  assert.deepEqual(tagZeilen(tag({ geoeffnet: false })), [{ art: 'leer', text: 'Geschlossen' }]);
  const z = tagZeilen(tag({ kommentar: 'Lieferung abladen', bloecke: [{ von: '06:00', bis: '10:00', bereich_kuerzel: 'WA', bereich_name: 'Ware', pause: false }] }));
  assert.deepEqual(z, [{ art: 'zeit', text: '06:00–10:00 WA' }, { art: 'kommentar', text: 'Lieferung abladen' }]);
});

test('Tageszeile: eigene Abwesenheit mit und ohne Uhrzeit', () => {
  assert.deepEqual(tagZeilen(tag({ abwesenheit: { code: 'U', name: 'Urlaub', stunden: 8, von: null, bis: null } })),
    [{ art: 'abwesenheit', text: 'Urlaub (U)' }]);
  assert.deepEqual(tagZeilen(tag({
    abwesenheit: { code: 'KM', name: 'Krank', stunden: 4, von: '12:00', bis: '16:00' },
    bloecke: [{ von: '08:00', bis: '12:00', bereich_kuerzel: 'KA', bereich_name: 'Kasse', pause: false }],
  })), [{ art: 'zeit', text: '08:00–12:00 KA' }, { art: 'abwesenheit', text: 'Krank (KM) 12:00–16:00' }]);
  assert.deepEqual(tagZeilen(tag({ abwesenheit: { code: 'KM', name: 'Krank', stunden: 4, von: null, bis: null } })),
    [{ art: 'abwesenheit', text: 'Krank (KM)' }]);
});

test('Kollegentext: Name mit Zeiten, mehrere Zeiträume, leer', () => {
  assert.equal(kollegenText([{ name: 'Jo', zeiten: [{ von: '08:00', bis: '16:00' }] }]), 'Jo 08:00–16:00');
  assert.equal(kollegenText([
    { name: 'Jo', zeiten: [{ von: '08:00', bis: '12:00' }, { von: '13:00', bis: '16:00' }] },
    { name: 'Ida', zeiten: [{ von: '12:00', bis: '20:00' }] },
  ]), 'Jo 08:00–12:00, 13:00–16:00; Ida 12:00–20:00');
  assert.equal(kollegenText([]), '');
  assert.equal(kollegenText(null), ''); // Schalter aus: die Datenbank liefert null
});

test('Saldo: Vorzeichen, Stand als Woche ab, ohne Buchung', () => {
  assert.equal(saldoText(12.5, '2026-10-26'), '+12,5 h, Stand: Woche ab 26.10.2026');
  assert.equal(saldoText(-3, '2026-10-26'), '−3 h, Stand: Woche ab 26.10.2026');
  assert.equal(saldoText(0, '2026-10-26'), '0 h, Stand: Woche ab 26.10.2026');
  assert.equal(saldoText(1.25, null), '+1,25 h');
  assert.equal(saldoText(null, null), 'noch keine Buchung');
  assert.equal(saldoText(undefined, '2026-10-26'), 'noch keine Buchung');
});

test('Stunden kurz: ohne überflüssige Nullen, echtes Minuszeichen, ohne Wert „—“', () => {
  assert.equal(stundenKurz(80), '80 h');
  assert.equal(stundenKurz('7.50'), '7,5 h');
  assert.equal(stundenKurz(null), '—');
});

test('Tageskopf, Wochentext, „zuletzt geändert“', () => {
  assert.equal(tagKopf('2026-11-10'), 'Di 10.11.');
  assert.equal(wochenText({ jahr: 2026, kw: 46, montag: '2026-11-09' }), 'KW 46 · 09.11.–15.11.2026');
  assert.equal(geaendertText('2026-11-05T10:00:00Z'), 'zuletzt geändert am 05.11.2026');
  assert.equal(geaendertText(null), '');
});

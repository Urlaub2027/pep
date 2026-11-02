// Urlaubsjahre in Tagen eingeben (docs/urlaub-tage.js): Stunden je Urlaubstag = Wochenstunden ÷ Abwesenheits-Teiler,
// Vertrag wie pep_resturlaub (am 01.01., sonst der erste im Jahr).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { urlaubTagesstunden, tageZuStunden, stundenZuTage } from '../docs/urlaub-tage.js';

const v = (gueltig_ab, wochenstunden) => ({ gueltig_ab, wochenstunden });

test('Tagesstunden: Vertrag am 01.01. (der letzte davor) zählt, nicht ein späterer Wechsel im Jahr', () => {
  const vertraege = [v('2024-03-01', 20), v('2025-06-01', 37.5), v('2027-04-01', 30)];
  assert.equal(urlaubTagesstunden(vertraege, 2027, 6), 6.25);
  assert.equal(urlaubTagesstunden(vertraege, 2025, 6), 20 / 6);
});

test('Tagesstunden: ohne Vertrag am 01.01. der erste im Jahr; ohne Vertrag bis Jahresende oder ohne Teiler null', () => {
  assert.equal(urlaubTagesstunden([v('2027-05-01', 30), v('2027-03-01', 24)], 2027, 6), 4);
  assert.equal(urlaubTagesstunden([v('2028-01-01', 30)], 2027, 6), null);
  assert.equal(urlaubTagesstunden([], 2027, 6), null);
  assert.equal(urlaubTagesstunden([v('2026-01-01', 30)], 2027, null), null);
  assert.equal(urlaubTagesstunden([v('2026-01-01T00:00:00', 30)], 2027, '6'), 5, 'Datum mit Uhrzeit, Teiler als Text');
});

test('Tage ↔ Stunden: 36 Tage × 6,25 h = 225 h; Teilzeit; auf zwei Stellen', () => {
  assert.equal(tageZuStunden(36, 6.25), 225);
  assert.equal(tageZuStunden(36, 20 / 6), 120);
  assert.equal(tageZuStunden(1, 40 / 6), 6.67);
  assert.equal(stundenZuTage(225, 6.25), 36);
  assert.equal(stundenZuTage(180, 6.25), 28.8);
  assert.equal(stundenZuTage(100, 40 / 6), 15);
  assert.equal(stundenZuTage(null, 6.25), null);
});

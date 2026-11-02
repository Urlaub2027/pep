// Logo für das Formblatt (docs/einstellungen-logo.js): Zielgröße beim Verkleinern vor dem Speichern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logoMasse } from '../docs/einstellungen-logo.js';

test('Logo verkleinern: höchstens 200 px hoch und 800 px breit, Seitenverhältnis bleibt, nie vergrößern', () => {
  assert.deepEqual(logoMasse(1000, 500), { breite: 400, hoehe: 200 });
  assert.deepEqual(logoMasse(4000, 400), { breite: 800, hoehe: 80 });
  assert.deepEqual(logoMasse(120, 60), { breite: 120, hoehe: 60 });
  assert.deepEqual(logoMasse(333, 1000), { breite: 67, hoehe: 200 });
});

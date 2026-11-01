// Reine Texte der Zugangs-Oberfläche (docs/zugang-text.js): Einladungslink, Standtext, Entwurf des Datenschutztextes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { einladungsLink, zugangsStandText, DATENSCHUTZ_ENTWURF } from '../docs/zugang-text.js';

test('Einladungslink: Seiten-Adresse ohne Hash plus #zugang=<code>', () => {
  assert.equal(einladungsLink('https://beispiel.test/pep/', 'abc123'), 'https://beispiel.test/pep/#zugang=abc123');
  assert.equal(einladungsLink('https://beispiel.test/pep/index.html#start', 'abc123'),
    'https://beispiel.test/pep/index.html#zugang=abc123');
  assert.equal(einladungsLink('https://beispiel.test/pep/?heute=2026-11-02#zugang=alt', 'neu'),
    'https://beispiel.test/pep/?heute=2026-11-02#zugang=neu');
});

test('Standtext für alle vier Stände', () => {
  assert.equal(zugangsStandText({ stand: 'kein' }), 'kein Zugang');
  assert.equal(zugangsStandText({ stand: 'eingeladen', gueltig_bis: '2026-11-08T12:00:00+00:00' }), 'eingeladen bis 08.11.2026');
  assert.equal(zugangsStandText({ stand: 'aktiv', aktiv_seit: '2026-10-20T08:00:00+00:00' }), 'aktiv seit 20.10.2026');
  assert.equal(zugangsStandText({ stand: 'gesperrt' }), 'gesperrt');
});

test('Standtext ohne Datum und ohne Zugang-Objekt fällt nicht um', () => {
  assert.equal(zugangsStandText({ stand: 'eingeladen' }), 'eingeladen');
  assert.equal(zugangsStandText({ stand: 'aktiv' }), 'aktiv');
  assert.equal(zugangsStandText(null), 'kein Zugang');
});

test('Datenschutz-Entwurf beginnt mit dem Hinweis und hat Inhalt', () => {
  assert.ok(DATENSCHUTZ_ENTWURF.startsWith('Entwurf – rechtlich nicht geprüft\n'));
  assert.ok(DATENSCHUTZ_ENTWURF.split('\n').length > 5);
});

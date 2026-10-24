import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fehlerText, datumDE, stundenDE, element, geldZahl } from '../docs/hilfe.js';

test('fehlerText kennt alle Codes des Schemas', () => {
  const schema = readFileSync('supabase/schema.sql', 'utf8');
  const codes = [...new Set([...schema.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]))];
  assert.ok(codes.length > 20);
  for (const c of codes) assert.doesNotMatch(fehlerText(c), /Unerwarteter Fehler/, c);
});

test('fehlerText kennt Codes der Browser-Schicht, unbekannte werden benannt', () => {
  for (const c of ['KEINE_VERBINDUNG', 'NICHT_ANGEMELDET', 'invalid_credentials', 'invalid_grant']) {
    assert.doesNotMatch(fehlerText(c), /Unerwarteter Fehler/, c);
  }
  assert.equal(fehlerText('QUATSCH'), 'Unerwarteter Fehler: QUATSCH');
});

test('datumDE("2027-03-02") = "02.03.2027"; stundenDE(6.25) = "6,25"; stundenDE(5) = "5,00"', () => {
  assert.equal(datumDE('2027-03-02'), '02.03.2027');
  assert.equal(stundenDE(6.25), '6,25');
  assert.equal(stundenDE(5), '5,00');
});

// Minimales DOM-Double: element() braucht nur createElement, createTextNode und Node.
function kleinesDom() {
  class Knoten { constructor(name) { this.name = name; this.kinder = []; } append(k) { this.kinder.push(k); } }
  globalThis.Node = Knoten;
  globalThis.document = {
    createElement: (tag) => Object.assign(new Knoten(tag), { setAttribute() {}, addEventListener() {} }),
    createTextNode: (t) => Object.assign(new Knoten('#text'), { text: t }),
  };
  return () => { delete globalThis.Node; delete globalThis.document; };
}

test('element() hängt beliebig tief verschachtelte Kinderlisten als Elemente an, nie als Text', () => {
  const aufraeumen = kleinesDom();
  try {
    const a = element('label'); const b = element('label'); const c = element('label');
    const box = element('div', {}, [a, [b, [c]], null, false, 'Text']);
    assert.deepEqual(box.kinder.map((k) => k.name), ['label', 'label', 'label', '#text']);
    assert.equal(box.kinder[3].text, 'Text');
  } finally {
    aufraeumen();
  }
});

test('geldZahl: deutsche Eingabe mit Tausenderpunkt und Komma', () => {
  assert.equal(geldZahl('60.000'), 60000);
  assert.equal(geldZahl('60000'), 60000);
  assert.equal(geldZahl('60000,50'), 60000.5);
  assert.equal(geldZahl('60.000,50'), 60000.5);
  assert.equal(geldZahl('1.234.567'), 1234567);
  assert.equal(geldZahl('250,5'), 250.5);
  assert.equal(geldZahl('250.5'), 250.5);
  assert.equal(geldZahl(' 60 000 € '), 60000);
  assert.equal(geldZahl(''), null);
  assert.equal(geldZahl(null), null);
  for (const falsch of ['abc', '1,2,3', '1.2.3', '60,000.50', ',', '.', '-5', '1e5']) {
    assert.ok(Number.isNaN(geldZahl(falsch)), falsch);
  }
});

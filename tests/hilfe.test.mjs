import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fehlerText, datumDE, stundenDE } from '../docs/hilfe.js';

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

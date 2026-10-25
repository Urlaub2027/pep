// Service Worker (docs/sw.js): fragt bei eigenen GET-Anfragen immer beim Server nach, lässt alles andere durch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const QUELLE = readFileSync(new URL('../docs/sw.js', import.meta.url), 'utf8');

function lade() {
  const horcher = {};
  const aufrufe = [];
  const self = {
    location: { origin: 'https://urlaub2027.github.io' },
    addEventListener: (art, f) => { horcher[art] = f; },
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve() },
  };
  const fetch = (anfrage, optionen) => { aufrufe.push([anfrage, optionen]); return Promise.resolve('antwort'); };
  new Function('self', 'fetch', QUELLE)(self, fetch);
  const abruf = (url, method = 'GET') => {
    let antwort = null;
    horcher.fetch({ request: { url, method }, respondWith: (p) => { antwort = p; } });
    return antwort;
  };
  return { horcher, aufrufe, abruf };
}

test('eigene GET-Anfragen gehen mit cache: no-cache an den Server', async () => {
  const { aufrufe, abruf } = lade();
  const antwort = abruf('https://urlaub2027.github.io/pep/einstellungen.js');
  assert.equal(await antwort, 'antwort');
  assert.deepEqual(aufrufe.map(([a, o]) => [a.url, o]), [['https://urlaub2027.github.io/pep/einstellungen.js', { cache: 'no-cache' }]]);
});

test('Supabase, andere Adressen und Nicht-GET laufen am Service Worker vorbei', () => {
  const { aufrufe, abruf } = lade();
  assert.equal(abruf('https://abc.supabase.co/rest/v1/rpc/pep_ich', 'POST'), null);
  assert.equal(abruf('https://abc.supabase.co/auth/v1/user'), null);
  assert.equal(abruf('https://urlaub2027.github.io/pep/', 'POST'), null);
  assert.equal(aufrufe.length, 0);
});

test('neue Fassung übernimmt sofort (skipWaiting, clients.claim)', () => {
  const { horcher } = lade();
  assert.ok(horcher.install && horcher.activate && horcher.fetch);
});

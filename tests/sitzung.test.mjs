// Anmelde-Sitzung: Leitung nur im Tab (sessionStorage), Mitarbeiter-Konten dauerhaft (localStorage).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

class Speicher {
  constructor() { this.daten = new Map(); }
  getItem(k) { return this.daten.has(k) ? this.daten.get(k) : null; }
  setItem(k, v) { this.daten.set(k, String(v)); }
  removeItem(k) { this.daten.delete(k); }
}

const SCHLUESSEL = 'pep-sitzung';
let nr = 0;

beforeEach(() => {
  globalThis.sessionStorage = new Speicher();
  globalThis.localStorage = new Speicher();
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ access_token: 'a', refresh_token: 'r', expires_in: 3600 }),
  });
});

// Jedes Laden ist ein frischer Seitenaufruf (eigene Modulinstanz).
const laden = () => import(`../docs/sitzung.js?seite=${nr++}`);

test('Sitzung: nach dem Login liegt sie nur im Tab', async () => {
  const s = await laden();
  await s.login('chef', 'pw');
  assert.ok(sessionStorage.getItem(SCHLUESSEL));
  assert.equal(localStorage.getItem(SCHLUESSEL), null);
});

test('Sitzung: dauerhaft(true) verschiebt sie in den localStorage, ein neuer Tab ist angemeldet', async () => {
  const s = await laden();
  await s.login('dana', 'pw');
  s.dauerhaft(true);
  assert.equal(sessionStorage.getItem(SCHLUESSEL), null);
  assert.ok(localStorage.getItem(SCHLUESSEL));
  globalThis.sessionStorage = new Speicher(); // App geschlossen, neu geöffnet
  const neu = await laden();
  assert.equal(neu.istAngemeldet(), true);
});

test('Sitzung: erneuertes Token bleibt dauerhaft gespeichert', async () => {
  const s = await laden();
  await s.login('dana', 'pw');
  s.dauerhaft(true);
  localStorage.setItem(SCHLUESSEL, JSON.stringify({ token: 'alt', refresh: 'r', ablauf: 0 }));
  const neu = await laden();
  assert.equal(await neu.token(), 'a');
  assert.equal(JSON.parse(localStorage.getItem(SCHLUESSEL)).token, 'a');
  assert.equal(sessionStorage.getItem(SCHLUESSEL), null);
});

test('Sitzung: dauerhaft(false) holt sie zurück in den Tab (Leitung bleibt nie dauerhaft)', async () => {
  const s = await laden();
  await s.login('chef', 'pw');
  s.dauerhaft(true);
  s.dauerhaft(false);
  assert.ok(sessionStorage.getItem(SCHLUESSEL));
  assert.equal(localStorage.getItem(SCHLUESSEL), null);
});

test('Sitzung: neue Anmeldung in einem Browser mit gemerktem Mitarbeiter-Konto liegt erst nur im Tab', async () => {
  localStorage.setItem(SCHLUESSEL, JSON.stringify({ token: 'mitarbeiter', refresh: 'r', ablauf: Date.now() + 3600_000 }));
  const s = await laden();
  await s.login('chef', 'pw');
  assert.equal(JSON.parse(sessionStorage.getItem(SCHLUESSEL)).token, 'a');
  assert.equal(JSON.parse(localStorage.getItem(SCHLUESSEL)).token, 'mitarbeiter');
});

test('Sitzung: Abmelden löscht beide Speicher', async () => {
  const s = await laden();
  await s.login('dana', 'pw');
  s.dauerhaft(true);
  s.logout();
  assert.equal(sessionStorage.getItem(SCHLUESSEL), null);
  assert.equal(localStorage.getItem(SCHLUESSEL), null);
  assert.equal(s.istAngemeldet(), false);
});

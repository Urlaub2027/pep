// Hilfetexte je Seite (docs/hilfe-texte.js, Task 10): vollständig, kurz und nur mit Knöpfen, die es gibt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { HILFE } from '../docs/hilfe-texte.js';

// Ansichten aus docs/app.js (ohne Anmeldung, Filiale anlegen und Druck) plus der IST-Modus des Einsatzplans.
const quelle = readFileSync('docs/app.js', 'utf8');
const liste = /const ANSICHTEN = \[([^\]]*)\]/.exec(quelle);
const ANSICHTEN = [...liste[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
  .filter((a) => !['login', 'filiale', 'druck'].includes(a)).concat('einsatzplan_ist');

const alleTexte = (h) => [h.titel, h.wozu, ...h.schritte, ...h.gut_zu_wissen];
const woerter = (h) => alleTexte(h).join(' ').split(/\s+/).filter(Boolean).length;

test('Ansichtenliste aus app.js gelesen', () => {
  assert.deepEqual(ANSICHTEN, ['start', 'abwesenheiten', 'vorausplanung', 'einsatzplan', 'zeitkonto', 'mitarbeiter',
    'einstellungen', 'einsatzplan_ist']);
});

test('jede Ansicht hat Titel, „Wozu“, mindestens zwei Schritte und „Gut zu wissen“; keine übrigen Einträge', () => {
  for (const a of ANSICHTEN) {
    const h = HILFE[a];
    assert.ok(h, `Eintrag fehlt: ${a}`);
    assert.ok(typeof h.titel === 'string' && h.titel.trim(), `${a}: titel`);
    assert.ok(typeof h.wozu === 'string' && h.wozu.trim(), `${a}: wozu`);
    assert.ok(Array.isArray(h.schritte) && h.schritte.length >= 2, `${a}: mindestens zwei Schritte`);
    assert.ok(Array.isArray(h.gut_zu_wissen) && h.gut_zu_wissen.length >= 1, `${a}: gut_zu_wissen`);
    for (const t of alleTexte(h)) assert.ok(typeof t === 'string' && t.trim(), `${a}: leerer Text`);
  }
  assert.deepEqual(Object.keys(HILFE).sort(), [...ANSICHTEN].sort());
});

test('kein „TODO“, höchstens 180 Wörter je Ansicht', () => {
  for (const a of ANSICHTEN) {
    for (const t of alleTexte(HILFE[a])) assert.doesNotMatch(t, /TODO/i, `${a}: ${t}`);
    assert.ok(woerter(HILFE[a]) <= 180, `${a}: ${woerter(HILFE[a])} Wörter`);
  }
});

test('Titel sind verschieden (die Überschrift zeigt, welche Seite erklärt wird)', () => {
  const titel = ANSICHTEN.map((a) => HILFE[a].titel);
  assert.equal(new Set(titel).size, titel.length);
});

// Alles in „…“ ist ein Wortlaut der Oberfläche (Knopf, Abschnitt, Hinweis) und muss so in docs/ vorkommen.
test('jeder Text in „…“ steht wörtlich in der Oberfläche (docs/*.js außer den Hilfetexten, index.html)', () => {
  const oberflaeche = readdirSync('docs').filter((d) => (d.endsWith('.js') && d !== 'hilfe-texte.js') || d === 'index.html')
    .map((d) => readFileSync(`docs/${d}`, 'utf8')).join('\n');
  const fehlt = [];
  for (const a of ANSICHTEN) {
    for (const t of alleTexte(HILFE[a])) {
      for (const [, zitat] of t.matchAll(/„([^“]+)“/g)) if (!oberflaeche.includes(zitat)) fehlt.push(`${a}: „${zitat}“`);
    }
  }
  assert.deepEqual(fehlt, []);
});

test('Nur-Leitung-Hinweise: Buchen im Zeitkonto und die Einstellungen', () => {
  assert.ok(alleTexte(HILFE.zeitkonto).some((t) => t.includes('Nur Leitung') && t.includes('Woche buchen')));
  assert.match(HILFE.einstellungen.wozu, /nur die Leitung/);
});

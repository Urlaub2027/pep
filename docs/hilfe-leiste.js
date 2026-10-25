// „?“-Knopf rechts in der Reiterleiste und die Hilfe-Leiste von rechts (Task 10). Die Texte stehen in hilfe-texte.js.
// Die Leiste ist ein modaler <dialog> wie in dialog.js: Tab bleibt darin, Escape schließt; zusätzlich schließt ein Klick
// daneben. Danach steht der Fokus wieder auf dem „?“. Am Tablet (bis 1200 px wie die Kacheln) füllt sie den Bildschirm.
// Beim ersten Besuch einer Ansicht zeigt ein kleiner Tipp auf den Knopf; er fängt keine Klicks ab und geht von selbst.
// Bewusst ohne Import von app.js (kein Importzyklus): app.js richtet den Knopf ein und meldet jede Ansicht.
import { element } from './hilfe.js';
import { HILFE } from './hilfe-texte.js';

const TIPP_SCHLUESSEL = 'pep-hilfe-tipp-'; // + Ansicht; Wert '1' = Tipp schon gezeigt
const TIPP_DAUER_MS = 6000;

let knopf = null;
let leiste = null; // offene Hilfe-Leiste
let tipp = null;
let tippUhr = null;
const gezeigt = new Set(); // Ansichten mit Tipp in dieser Sitzung (falls localStorage nicht geht)

// Öffnet die Hilfe-Leiste für eine Ansicht (Schlüssel von HILFE, im IST-Modus 'einsatzplan_ist'). Rückgabe: der Dialog.
export function oeffneHilfe(ansicht) {
  const h = HILFE[ansicht];
  if (!h) return null;
  schliesseTipp();
  leiste?.close();
  const titel = element('h2', { id: 'hilfe-titel', tabindex: '-1' }, h.titel);
  const d = element('dialog', { class: 'hilfe-leiste', 'aria-labelledby': 'hilfe-titel', 'data-ansicht': ansicht },
    element('div', { class: 'hilfe-inhalt' },
      titel,
      element('h3', {}, 'Wozu dient diese Seite'),
      element('p', {}, h.wozu),
      element('h3', {}, "So geht's"),
      element('ol', { class: 'hilfe-schritte' }, h.schritte.map((t) => element('li', {}, t))),
      element('h3', {}, 'Gut zu wissen'),
      element('ul', { class: 'hilfe-liste' }, h.gut_zu_wissen.map((t) => element('li', {}, t)))),
    element('div', { class: 'hilfe-knoepfe' },
      element('button', { type: 'button', class: 'knopf primaer', onclick: () => d.close() }, 'Schließen')));
  // Klick auf den abgedunkelten Rand: Ziel ist der Dialog selbst, die Stelle liegt außerhalb seines Rechtecks.
  d.addEventListener('click', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) d.close();
  });
  d.addEventListener('close', () => {
    d.remove();
    if (leiste === d) leiste = null;
    knopf?.focus();
  });
  document.body.append(d);
  leiste = d;
  d.showModal();
  titel.focus(); // Vorleser beginnt mit der Überschrift; die Pfeiltasten scrollen die Leiste
  return d;
}

// Von app.js beim Start: Knopf verdrahten. welcheAnsicht() liefert den Hilfe-Schlüssel der aktiven Ansicht.
export function richteHilfeEin(hilfeKnopf, welcheAnsicht) {
  knopf = hilfeKnopf;
  knopf.addEventListener('click', () => oeffneHilfe(welcheAnsicht()));
}

// Von app.js bei jedem Ansichtswechsel: einmal je Ansicht den Tipp zeigen (gemerkt im localStorage; im privaten
// Modus kann der Zugriff werfen – dann gilt „einmal“ nur für diese Sitzung).
export function ansichtGezeigt(ansicht) {
  schliesseTipp();
  if (!knopf || !HILFE[ansicht] || knopf.closest('[hidden]')) return;
  if (gezeigt.has(ansicht) || lies(TIPP_SCHLUESSEL + ansicht)) return;
  gezeigt.add(ansicht);
  merke(TIPP_SCHLUESSEL + ansicht);
  tipp = element('p', { class: 'hilfe-tipp', role: 'status' }, 'Tipp: Das ? erklärt diese Seite');
  knopf.parentElement.append(tipp);
  tippUhr = setTimeout(schliesseTipp, TIPP_DAUER_MS);
}

function schliesseTipp() {
  clearTimeout(tippUhr);
  tipp?.remove();
  tipp = null;
}

function lies(schluessel) {
  try { return localStorage.getItem(schluessel); } catch { return null; }
}

function merke(schluessel) {
  try { localStorage.setItem(schluessel, '1'); } catch { /* nur für diese Sitzung */ }
}

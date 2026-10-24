// Ersatz für docs/app.js in der Vorschau: gleiche Exporte, Daten aus tests/vorschau/daten/<funktion>.json
// statt Supabase. Schreibende Aufrufe ohne Datei liefern null. Ansicht per ?ansicht=<name>.
import { $, meldung } from '/docs/hilfe.js';

export let ich = null;
export const reiter = {};
const ANSICHTEN = ['login', 'filiale', 'start', 'abwesenheiten', 'vorausplanung', 'einsatzplan', 'mitarbeiter', 'einstellungen'];

export function zeigeAnsicht(name) {
  for (const a of ANSICHTEN) { const s = $(`ansicht-${a}`); if (s) s.hidden = a !== name; }
  for (const k of document.querySelectorAll('[data-ziel]')) k.classList.toggle('aktiv', k.dataset.ziel === name);
  meldung('');
  Promise.resolve(reiter[name]?.zeigen?.()).catch((f) => meldung(String(f.message)));
}

export async function aufruf(funktion, parameter = {}) {
  const antwort = await fetch(`/tests/vorschau/daten/${funktion}.json`);
  if (!antwort.ok) return null;
  return antwort.json();
}

// Wie app.js: Kopf und Reiter „Einstellungen“ nach der Rolle.
export async function aktualisiereIch() {
  ich = await aufruf('pep_ich');
  $('wer').textContent = `Angemeldet als ${ich.anzeigename}`;
  $('kopf-filiale').textContent = ich.filiale?.name ?? '';
  $('nav-einstellungen').hidden = ich.rolle !== 'leitung';
  return ich;
}
export function abmelden() {}

export async function start() {
  await aktualisiereIch();
  const parameter = new URLSearchParams(location.search);
  const ansicht = parameter.get('ansicht') || 'start';
  $('navigation').hidden = ansicht === 'login';
  for (const k of document.querySelectorAll('[data-ziel]')) k.addEventListener('click', () => zeigeAnsicht(k.dataset.ziel));
  // Einsatzplan: Knöpfe der Dialoge späterer Tasks mit Platzhaltern belegen, damit das Foto den fertigen Bildschirm
  // zeigt (ohne Belegung sind sie ausgeblendet). ?aktionen=0 zeigt den Stand ohne Dialoge.
  if (ansicht === 'einsatzplan' && parameter.get('aktionen') !== '0') {
    const { aktionen } = await import('/docs/einsatzplan.js');
    for (const k of Object.keys(aktionen)) aktionen[k] ??= () => meldung(`Vorschau: „${k}“ folgt mit einer späteren Aufgabe.`, 'ok');
  }
  zeigeAnsicht(ansicht);
  // ?toast=<Text> zeigt die Erfolgsmeldung, damit sie im Foto zu sehen ist (verzögert: das Foto entsteht
  // nach 4 s virtueller Zeit, der Toast verschwindet nach 3 s).
  if (parameter.get('toast')) setTimeout(() => meldung(parameter.get('toast'), 'ok'), 1500);
  // ?klick=<CSS-Selektor> klickt nach dem Laden darauf (z. B. eine Zelle, um einen Dialog zu zeigen).
  if (parameter.get('klick')) setTimeout(() => document.querySelector(parameter.get('klick'))?.click(), 1000);
  // Für Prüfungen per --dump-dom: wie viele Pixel die Seite breiter ist als das Fenster (0 = kein Querscrollen).
  setTimeout(() => {
    const html = document.documentElement;
    html.dataset.querUeberstand = String(html.scrollWidth - html.clientWidth);
  }, 1500);
}

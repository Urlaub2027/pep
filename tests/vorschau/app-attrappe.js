// Ersatz für docs/app.js in der Vorschau: gleiche Exporte, Daten aus tests/vorschau/daten/<funktion>.json
// statt Supabase. Schreibende Aufrufe ohne Datei liefern null. Ansicht per ?ansicht=<name>.
import { $, meldung } from '/docs/hilfe.js';

export let ich = null;
export const reiter = {};
const ANSICHTEN = ['login', 'filiale', 'start', 'abwesenheiten', 'vorausplanung', 'einsatzplan', 'zeitkonto', 'mitarbeiter', 'einstellungen'];

export function zeigeAnsicht(name) {
  for (const a of ANSICHTEN) { const s = $(`ansicht-${a}`); if (s) s.hidden = a !== name; }
  for (const k of document.querySelectorAll('[data-ziel]')) k.classList.toggle('aktiv', k.dataset.ziel === name);
  meldung('');
  Promise.resolve(reiter[name]?.zeigen?.()).catch((f) => meldung(String(f.message)));
}

// Ausnahme: Funktionen in JE_WOCHE suchen zuerst <funktion>_<jahr>_<kw>.json (Zeitkonto: offene und abgeschlossene Woche).
const JE_WOCHE = new Set(['pep_zeitkonto_woche']);

export async function aufruf(funktion, parameter = {}) {
  if (JE_WOCHE.has(funktion) && parameter.p_jahr && parameter.p_kw) {
    const woche = await fetch(`/tests/vorschau/daten/${funktion}_${parameter.p_jahr}_${parameter.p_kw}.json`);
    if (woche.ok) return woche.json();
  }
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
  // ?ansicht=druck&art=tag|tage|woche|monat|resturlaub baut die Druckansicht wie der Knopf „Drucken“, aber ohne
  // window.print(): foto.mjs mit Ausgabe *.pdf druckt sie dann per Chrome --print-to-pdf (?tag= wählt den Tag).
  if (ansicht === 'druck') {
    const { baueDruck } = await import('/docs/druck.js');
    const art = parameter.get('art') || 'woche';
    const woche = await aufruf('pep_einsatzplan_woche');
    const daten = art === 'monat'
      ? { daten: await aufruf('pep_abwesenheiten'), jahr: Number(parameter.get('jahr')) || 2026, monat: Number(parameter.get('monat')) || 11 }
      : art === 'resturlaub' ? await aufruf('pep_resturlaub')
        : { woche, datum: parameter.get('tag') || woche.montag };
    baueDruck(art, daten);
  }
  // ?toast=<Text> zeigt die Erfolgsmeldung, damit sie im Foto zu sehen ist (verzögert: das Foto entsteht
  // nach 4 s virtueller Zeit, der Toast verschwindet nach 3 s).
  if (parameter.get('toast')) setTimeout(() => meldung(parameter.get('toast'), 'ok'), 1500);
  // ?klick=<CSS-Selektor> klickt nach dem Laden darauf (z. B. eine Zelle, um einen Dialog zu zeigen).
  if (parameter.get('klick')) setTimeout(() => document.querySelector(parameter.get('klick'))?.click(), 1000);
  // ?dialogende=1 scrollt den offenen Dialog ans Ende (zeigt, dass ein langer Dialog in sich scrollt, nicht die Seite).
  if (parameter.get('dialogende')) {
    setTimeout(() => {
      const d = document.querySelector('dialog[open]');
      if (!d) return;
      d.scrollTop = d.scrollHeight;
      document.documentElement.dataset.dialogScroll = `${d.scrollTop}/${d.scrollHeight - d.clientHeight}`;
    }, 2500);
  }
  // Für Prüfungen per --dump-dom: wie viele Pixel die Seite breiter ist als das Fenster (0 = kein Querscrollen).
  setTimeout(() => {
    const html = document.documentElement;
    html.dataset.querUeberstand = String(html.scrollWidth - html.clientWidth);
  }, 1500);
}

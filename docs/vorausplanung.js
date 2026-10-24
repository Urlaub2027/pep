// Reiter „Vorausplanung“: sechs Wochen nebeneinander – Planumsatz (von Hand), Soll-Stunden, Vertrag, Abwesenheiten,
// Verfügbar, Überhang und die Stundenvorgabe, die der Einsatzplan benutzt. Die Rechnung steht in
// pep.woche_kennzahlen (schema.sql); hier wird nur angezeigt und gespeichert.
import { $, meldung, fehlerText, element, eingabe, geldZahl } from './hilfe.js';
import { aufruf, ich, reiter } from './app.js';
import { isoWoche, kwVorZurueck, plusTage } from './zeit.js';
import { oeffneWoche } from './einsatzplan.js';

// Adresse: ?jahr=&kw= wählen die erste Woche, ?heute=JJJJ-MM-TT ersetzt das heutige Datum (Vorschau).
const adresse = new URLSearchParams(location.search);
const ganzzahl = (name, min, max) => {
  const n = Number(adresse.get(name));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const jetzt = new Date();
const heuteIso = /^\d{4}-\d{2}-\d{2}$/.test(adresse.get('heute') ?? '') ? adresse.get('heute')
  : `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
const start = isoWoche(heuteIso);
let jahr = ganzzahl('jahr', 2000, 2100) ?? start.jahr;
let kw = ganzzahl('kw', 1, 53) ?? start.kw;
let wochen = []; // Antwort von pep_vorausplanung: sechs Kennzahlen-Objekte
const rahmen = {}; // Container: kopf, tabelle
let zellen = []; // zellen[zeile][woche] = <td>

const darfSchreiben = () => ich?.rolle === 'leitung' || ich?.rolle === 'stellvertretung';
const zeigeFehler = (fehler) => { if (!fehler.behandelt) meldung(fehlerText(fehler.message)); };

// ---------------------------------------------------------------- Formate

// Stunden mit Komma, ohne überflüssige Nullen: 300 · 300,5 · 77,92; negativ mit echtem Minuszeichen.
const rund = (n) => Math.round(n * 100) / 100 || 0; // Rechenreste wie −1e-15 und −0 werden 0
const stunden = (n) => (n == null ? '–'
  : `${rund(n) < 0 ? '−' : ''}${Math.abs(rund(n)).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}`);
const zahlDE = (n) => (n == null ? '' : Number(n).toLocaleString('de-DE', { maximumFractionDigits: 2 }));
const kurzDatum = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const QUELLE = {
  manuell: 'von Hand',
  planumsatz: 'aus dem Planumsatz',
  verfuegbar: 'ohne Planumsatz: Verfügbar',
};

// ---------------------------------------------------------------- Speichern

// feld = Schlüssel in pep_woche_speichern, anzeige = aktueller Wert der Woche (zum Erkennen von „unverändert“).
async function speichere(index, feld, roh, eingabefeld, anzeige) {
  const w = wochen[index];
  const wert = geldZahl(roh);
  if (Number.isNaN(wert) || (wert !== null && wert < 0)) {
    meldung(fehlerText('WERT_UNGUELTIG'));
    eingabefeld.value = zahlDE(anzeige(w));
    return;
  }
  if (wert === (anzeige(w) ?? null)) { eingabefeld.value = zahlDE(wert); return; }
  meldung('');
  try {
    const neu = await aufruf('pep_woche_speichern', { p_jahr: w.jahr, p_kw: w.kw, p_daten: { [feld]: wert } });
    if (neu) wochen[index] = neu;
    meldung('Gespeichert.', 'ok');
  } catch (fehler) {
    zeigeFehler(fehler);
    eingabefeld.value = zahlDE(anzeige(w));
    return;
  }
  fuelleWoche(index);
}

// ---------------------------------------------------------------- Zeilen

const eingabeZeile = (titel, hinweis, feld, anzeige, einheit) => ({
  titel, hinweis,
  fuellen(td, w, i) {
    let e = td.querySelector('input');
    if (!e) {
      e = eingabe('text', '', {
        inputmode: 'decimal', 'aria-label': `${titel} KW ${w.kw}`, autocomplete: 'off',
        class: 'zahl', ...(darfSchreiben() ? {} : { disabled: true }),
      });
      e.addEventListener('change', () => speichere(i, feld, e.value, e, anzeige));
      td.replaceChildren(element('div', { class: 'eingabe-mit-einheit' }, e, element('span', { class: 'einheit' }, einheit)));
    }
    if (document.activeElement !== e) e.value = zahlDE(anzeige(w));
  },
});

const wertZeile = (titel, hinweis, text, klasse = () => '') => ({
  titel, hinweis,
  fuellen(td, w) {
    td.className = `zahl ${klasse(w)}`.trim();
    td.replaceChildren(text(w));
  },
});

const ZEILEN = [
  eingabeZeile('Planumsatz', 'von Hand eingetragen', 'planumsatz', (w) => w.planumsatz, '€'),
  eingabeZeile('Stundenleistung', 'Euro Umsatz je Arbeitsstunde; leer = Standard aus den Einstellungen',
    'stundenleistung_eur_pro_h', (w) => w.stundenleistung, '€/h'),
  wertZeile('Soll-Stunden', 'Planumsatz ÷ Stundenleistung, auf halbe Stunden gerundet', (w) => stunden(w.soll)),
  wertZeile('Vertragsstunden', 'Summe der Wochenstunden aller Beschäftigten dieser Woche', (w) => stunden(w.vertragsstunden)),
  wertZeile('Abwesend', 'Urlaub, Krank, Zeitausgleich u. a. in dieser Woche', (w) => stunden(w.abwesend)),
  wertZeile('davon Urlaub', 'nur Code U', (w) => stunden(w.davon_urlaub)),
  wertZeile('Verfügbar', 'Vertragsstunden − Abwesend', (w) => stunden(w.verfuegbar)),
  wertZeile('Überhang', 'Verfügbar − Soll; unter 0 fehlen Stunden',
    (w) => (w.ueberhang == null ? '–' : stunden(w.ueberhang)),
    (w) => (w.ueberhang == null ? '' : w.ueberhang < 0 ? 'minus' : 'plus')),
  eingabeZeile('Stundenvorgabe von Hand', 'überschreibt das Soll; leer = Soll bzw. Verfügbar',
    'stundenvorgabe_manuell', (w) => w.stundenvorgabe_manuell, 'h'),
  {
    titel: 'Vorgabe für den Einsatzplan', hinweis: 'Diese Zahl steht im Einsatzplan als Stundenvorgabe',
    fuellen(td, w) {
      td.className = 'zahl vorgabe';
      td.replaceChildren(element('strong', {}, stunden(w.stundenvorgabe)),
        element('small', { class: 'quelle' }, QUELLE[w.vorgabe_quelle] ?? ''));
    },
  },
  wertZeile('Geplant', 'bisher im Einsatzplan eingetragen (besetzt, ohne Pausen)', (w) => stunden(w.geplant)),
];

// ---------------------------------------------------------------- Zeichnen

function fuelleWoche(index) {
  ZEILEN.forEach((zeile, z) => zeile.fuellen(zellen[z][index], wochen[index], index));
}

function zeichneTabelle() {
  zellen = ZEILEN.map(() => wochen.map(() => element('td')));
  const kopf = element('tr', {}, element('th', { scope: 'col' }, ''), wochen.map((w) => {
    const so = plusTage(w.montag, 6);
    return element('th', { scope: 'col', class: 'woche-kopf' },
      element('button', {
        type: 'button', class: 'woche-sprung', title: `Einsatzplan KW ${w.kw} öffnen`,
        onclick: () => oeffneWoche(w.jahr, w.kw),
      }, element('strong', {}, `KW ${w.kw}`),
      element('small', {}, `${kurzDatum(w.montag)}–${kurzDatum(so)}${w.jahr !== wochen[0].jahr ? ` ${w.jahr}` : ''}`)));
  }));
  const koerper = ZEILEN.map((zeile, z) => element('tr', { class: `vp-${z}` },
    element('th', { scope: 'row', title: zeile.hinweis }, zeile.titel), zellen[z]));
  rahmen.tabelle.replaceChildren(element('div', { class: 'tabelle-scroll' },
    element('table', { class: 'vorausplanung' }, element('thead', {}, kopf), element('tbody', {}, koerper))));
  wochen.forEach((_, i) => fuelleWoche(i));
}

function zeichneKopf() {
  const von = wochen[0];
  const bis = wochen[wochen.length - 1];
  rahmen.kopf.replaceChildren(element('div', { class: 'werkzeug-zeile' },
    element('div', { class: 'monatsnavi' },
      element('button', { type: 'button', class: 'knopf pfeil', 'aria-label': 'Eine Woche zurück', onclick: () => verschiebe(-1) }, '◀'),
      element('strong', { class: 'monatsname' }, `KW ${von.kw}/${von.jahr} – KW ${bis.kw}/${bis.jahr}`),
      element('button', { type: 'button', class: 'knopf pfeil', 'aria-label': 'Eine Woche weiter', onclick: () => verschiebe(1) }, '▶'),
      element('button', { type: 'button', class: 'knopf', onclick: heute }, 'Aktuelle Woche')),
    element('p', { class: 'hinweis' },
      'Planumsatz und Stundenleistung eintragen (z. B. 60.000 oder 60000,50); gespeichert wird beim Verlassen des Feldes.')));
}

// ---------------------------------------------------------------- Laden

let ladeNummer = 0; // verwirft veraltete Antworten, wenn schnell geblättert wird
async function lade() {
  const nummer = ++ladeNummer;
  const antwort = await aufruf('pep_vorausplanung', { p_jahr: jahr, p_kw: kw });
  if (nummer !== ladeNummer || !antwort) return;
  wochen = antwort.wochen;
  zeichneKopf();
  zeichneTabelle();
}

function verschiebe(schritt) {
  ({ jahr, kw } = kwVorZurueck(jahr, kw, schritt));
  lade().catch(zeigeFehler);
}

function heute() {
  ({ jahr, kw } = isoWoche(heuteIso));
  lade().catch(zeigeFehler);
}

async function zeigen() {
  meldung('');
  if (!rahmen.kopf) {
    rahmen.kopf = element('div', { class: 'box werkzeugleiste' });
    rahmen.tabelle = element('div', { class: 'box' });
    $('ansicht-vorausplanung').replaceChildren(rahmen.kopf, rahmen.tabelle);
  }
  try {
    await lade();
  } catch (fehler) {
    zeigeFehler(fehler);
  }
}

reiter.vorausplanung = { zeigen };

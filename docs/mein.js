// Mitarbeiter-Ansicht (Stufe 3): Datenschutz-Zustimmung und der eigene Plan, nur lesend. Alles kommt aus den
// Funktionen pep_mein_* (die Datenbank entscheidet, was ein Mitarbeiter sieht); hier wird nur angezeigt.
// Kein innerHTML: Namen, Kommentare und der Datenschutztext sind Daten und werden als Text eingesetzt.
import { $, element, meldung, fehlerText } from './hilfe.js';
import { aufruf, reiter, zeigeAnsicht, abmelden } from './app.js';
import { heuteDatum } from './zeit.js';
import { tagZeilen, kollegenText, saldoText, stundenKurz, tagKopf, wochenText, geaendertText } from './mein-daten.js';

let konto = null; // Antwort von pep_mein_konto
let wochen = []; // freigegebene Wochen
let gewaehlt = null; // Index in wochen

const abmeldeKnopf = () => element('button', { type: 'button', class: 'knopf', onclick: () => abmelden() }, 'Abmelden');

// Eigene Abfragen: fehlt die Zustimmung (z. B. der Text wurde inzwischen neu gefasst), geht es zurück zur Zustimmung.
// Ein gesperrtes Konto (KEIN_ZUGRIFF) meldet aufruf() selbst ab.
async function meinAufruf(funktion, parameter) {
  try {
    return await aufruf(funktion, parameter);
  } catch (fehler) {
    if (fehler.message === 'ZUSTIMMUNG_FEHLT') {
      fehler.behandelt = true;
      konto = await aufruf('pep_mein_konto');
      zeigeAnsicht('zustimmung');
    }
    throw fehler;
  }
}

// ---------------------------------------------------------------- Zustimmung

function zustimmungZeigen() {
  const z = konto.zustimmung;
  const knopf = element('button', { type: 'button', class: 'knopf primaer', onclick: async () => {
    knopf.disabled = true;
    meldung('');
    try {
      await aufruf('pep_mein_zustimmen', { p_version: z.version });
      konto.zustimmung.noetig = false;
      zeigeAnsicht('mein');
    } catch (fehler) {
      if (fehler.message === 'VERSION_VERALTET') {
        konto = await aufruf('pep_mein_konto'); // neuen Text laden und anzeigen
        zustimmungZeigen();
        meldung('Der Datenschutztext wurde inzwischen geändert. Bitte lies den neuen Text und bestätige ihn.');
      } else if (!fehler.behandelt) meldung(fehlerText(fehler.message));
    } finally {
      knopf.disabled = false;
    }
  } }, 'Ich habe den Text gelesen und stimme zu');
  $('ansicht-zustimmung').replaceChildren(element('div', { class: 'box mein-box' },
    element('h2', {}, 'Datenschutz'),
    element('p', {}, 'Bevor du deinen Plan siehst, lies bitte diesen Text und bestätige ihn.'),
    element('div', { class: 'mein-text' }, z.text),
    element('div', { class: 'mein-knoepfe' }, knopf, abmeldeKnopf())));
}

// ---------------------------------------------------------------- Plan

function tagKarte(tag) {
  const arbeitet = tag.bloecke.length > 0;
  return element('article', { class: `mein-tag${tag.geoeffnet ? '' : ' zu'}`, 'data-datum': tag.datum },
    element('h3', {}, tagKopf(tag.datum)),
    tagZeilen(tag).map((z) => element('p', { class: `mein-zeile ${z.art}` }, z.text)),
    arbeitet && tag.kollegen?.length // null: Leitung hat die Kollegenanzeige ausgeschaltet
      ? element('p', { class: 'mein-kollegen' }, element('strong', {}, 'Mit dir eingeteilt: '), kollegenText(tag.kollegen))
      : null);
}

function planZeigen(plan) {
  const w = wochen[gewaehlt];
  $('mein-plan').replaceChildren(
    element('h3', { class: 'mein-wochenkopf' }, wochenText(w), ' ',
      plan.zuletzt_geaendert ? element('span', { class: 'mein-geaendert' }, geaendertText(plan.zuletzt_geaendert)) : null),
    ...plan.tage.map(tagKarte));
}

async function wocheLaden(index) {
  gewaehlt = index;
  const w = wochen[index];
  try {
    const plan = await meinAufruf('pep_mein_plan', { p_jahr: w.jahr, p_kw: w.kw });
    if (gewaehlt === index) planZeigen(plan); // eine schnellere spätere Wahl nicht überschreiben
  } catch (fehler) {
    if (fehler.message === 'WOCHE_NICHT_FREIGEGEBEN') { // inzwischen zurückgenommen: Liste neu holen
      meldung(fehlerText(fehler.message));
      return zeigen(true);
    }
    if (!fehler.behandelt) meldung(fehlerText(fehler.message));
  }
}

function kachel(titel, wert, zusatz) {
  return element('div', { class: 'mein-kachel' }, element('h3', {}, titel), element('p', { class: 'mein-wert' }, wert),
    zusatz ? element('p', { class: 'mein-zusatz' }, zusatz) : null);
}

function kacheln(urlaub, zeitkonto) {
  return element('div', { class: 'mein-kacheln' },
    kachel(`Resturlaub ${urlaub.jahr}`, stundenKurz(urlaub.rest),
      `Anspruch ${stundenKurz(urlaub.anspruch)}, genehmigt ${stundenKurz(urlaub.genehmigt)}`),
    kachel('Zeitkonto', saldoText(zeitkonto.saldo, zeitkonto.stand)));
}

// behalteWoche: nach einer zurückgenommenen Woche die Auswahl nicht auf die erste zurücksetzen müssen – die Liste ist neu.
async function zeigen(behalteWoche = false) {
  if (!konto) return;
  const jahr = Number(heuteDatum().slice(0, 4));
  const [liste, urlaub, zeitkonto] = await Promise.all([
    meinAufruf('pep_mein_wochen'), meinAufruf('pep_mein_urlaub', { p_jahr: jahr }), meinAufruf('pep_mein_zeitkonto')]);
  const vorher = behalteWoche && wochen[gewaehlt] ? wochen[gewaehlt].montag : null;
  wochen = liste;
  gewaehlt = Math.max(0, wochen.findIndex((w) => w.montag === vorher));
  const auswahl = wochen.length > 1
    ? element('select', { class: 'mein-wochenwahl', 'aria-label': 'Woche', onchange: (e) => wocheLaden(Number(e.target.value)) },
      wochen.map((w, i) => element('option', { value: i }, wochenText(w))))
    : null;
  if (auswahl) auswahl.value = String(gewaehlt);
  $('ansicht-mein').replaceChildren(
    element('div', { class: 'mein-kopf' }, element('h2', {}, 'Mein Plan'), auswahl),
    wochen.length ? element('div', { id: 'mein-plan' }) : element('p', { class: 'box' }, 'Noch keine Woche freigegeben'),
    kacheln(urlaub, zeitkonto),
    element('p', { class: 'mein-app' }, 'Als App nutzen: im Browser-Menü „Zum Home-Bildschirm“ wählen.'),
    element('div', { class: 'mein-knoepfe' }, abmeldeKnopf()));
  if (wochen.length) await wocheLaden(gewaehlt);
}

reiter.mein = {
  zeigen: () => zeigen(),
  // Nach der Anmeldung: erst die Zustimmung, wenn sie fehlt (app.js nachLogin).
  oeffne(k) {
    konto = k;
    zeigeAnsicht(k.zustimmung.noetig ? 'zustimmung' : 'mein');
  },
  zuruecksetzen() {
    konto = null;
    wochen = [];
    gewaehlt = null;
    $('ansicht-mein').replaceChildren();
    $('ansicht-zustimmung').replaceChildren();
  },
};
reiter.zustimmung = { zeigen: () => konto && zustimmungZeigen() };

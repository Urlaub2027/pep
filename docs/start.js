// Reiter „Start“: sechs Kacheln mit großer Zahl und Sprung (Spec 14). Gezählt wird in public.pep_startseite
// (schema.sql): Abwesende der laufenden Woche, Stunden-Lücke der nächsten 6 Wochen, Regelverstöße der nächsten
// 7 Tage (Wochenregeln und Ruhezeiten je einmal, Tage ganz ohne Block getrennt als „noch nicht geplant“),
// offene Urlaubswünsche und (Stufe 2) offene IST-Tage der letzten 6 Wochen bis gestern sowie Mitarbeiter mit
// Zeitkonto-Warnung in der zuletzt abgeschlossenen Woche. Hier wird nur angezeigt. Darüber (nur Leitung) eine Zeile zur
// letzten Sicherung.
import { $, meldung, fehlerText, element, datumDE, WOCHENTAGE } from './hilfe.js';
import { aufruf, reiter, ich } from './app.js';
import { isoWoche, plusTage, kwVorZurueck } from './zeit.js';
import { oeffneWoche, oeffneIst } from './einsatzplan.js';
import { oeffneZeitkonto } from './zeitkonto.js';
import { vorzeichen } from './zeitkonto-daten.js';
import { oeffneMonat } from './abwesenheiten.js';
import { oeffneVorausplanung } from './vorausplanung.js';
import { oeffneSicherung } from './einstellungen.js';
import { sicherungHinweis } from './sicherung.js';

const GRUEN = 'alles im grünen Bereich';
const MAX_ZEILEN = 6; // längere Listen enden mit „+ n weitere“

const zeigeFehler = (fehler) => { if (!fehler.behandelt) meldung(fehlerText(fehler.message)); };

// ---------------------------------------------------------------- Formate

// Stunden mit Komma, ohne überflüssige Nullen, negativ mit echtem Minuszeichen (wie in der Vorausplanung).
const rund = (n) => Math.round(n * 100) / 100 || 0;
const stunden = (n) => `${rund(n) < 0 ? '−' : ''}${Math.abs(rund(n)).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}`;
const kurzDatum = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const wochentag = (iso) => WOCHENTAGE[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7];
const tagText = (iso) => `${wochentag(iso)} ${kurzDatum(iso)}`;
const spanne = (von, bis) => (von === bis ? kurzDatum(von) : `${kurzDatum(von)}–${kurzDatum(bis)}`);
const anzahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
const monatVon = (iso) => [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];

// ---------------------------------------------------------------- Sprünge

function oeffneTag(iso) {
  const { jahr, kw } = isoWoche(iso);
  oeffneWoche(jahr, kw, iso);
}

// ---------------------------------------------------------------- Kacheln

// befund = false: grüner Rand und gruen (Standard „alles im grünen Bereich“) statt der Liste. art: 'rot'
// (Verstoß/Lücke) oder 'gelb'.
function kachel({ titel, zeitraum, zahl, einheit, befund, art = 'gelb', inhalt = [], sprungText, sprung, gruen = GRUEN }) {
  return element('section', { class: `karte kachel ${befund ? art : 'gruen'}`, 'aria-label': titel },
    element('h2', {}, titel),
    element('p', { class: 'kachel-zeitraum' }, zeitraum),
    element('p', { class: 'kachel-zahl' }, String(zahl), element('span', { class: 'kachel-einheit' }, einheit)),
    befund ? inhalt : element('p', { class: 'kachel-gruen' }, gruen),
    element('button', { type: 'button', class: 'knopf kachel-sprung', onclick: sprung }, `${sprungText} →`));
}

// Liste mit höchstens MAX_ZEILEN Einträgen und „+ n weitere“.
function kurzListe(eintraege) {
  const rest = eintraege.length - MAX_ZEILEN;
  return element('ul', { class: 'kachel-liste' }, eintraege.slice(0, MAX_ZEILEN),
    rest > 0 ? element('li', { class: 'hinweis' }, `+ ${rest} weitere`) : null);
}

function abwesendKachel(d) {
  const { jahr, kw } = isoWoche(d.heute);
  const mo = plusTage(d.heute, -((new Date(`${d.heute}T12:00:00Z`).getUTCDay() + 6) % 7));
  const a = d.abwesend;
  const ziel = monatVon(a.liste[0]?.von ?? d.heute);
  return kachel({
    titel: 'Abwesend diese Woche',
    zeitraum: `KW ${kw}/${jahr} · ${kurzDatum(mo)}–${kurzDatum(plusTage(mo, 6))}`,
    zahl: a.anzahl,
    einheit: a.anzahl === 1 ? 'Person' : 'Personen',
    befund: a.anzahl > 0,
    inhalt: kurzListe(a.liste.map((e) => element('li', {},
      element('strong', {}, e.name), ` · ${e.code} ${spanne(e.von, e.bis)}`))),
    sprungText: 'Abwesenheiten',
    sprung: () => oeffneMonat(...ziel),
  });
}

function lueckeKachel(d) {
  const start = isoWoche(d.heute);
  const ende = kwVorZurueck(start.jahr, start.kw, 5);
  const l = d.luecke;
  return kachel({
    titel: 'Stunden-Lücke',
    zeitraum: `KW ${start.kw} bis KW ${ende.kw}${ende.jahr !== start.jahr ? `/${ende.jahr}` : ''} (6 Wochen)`,
    zahl: stunden(l.summe),
    einheit: 'h',
    befund: l.wochen.length > 0,
    art: 'rot',
    inhalt: [
      kurzListe(l.wochen.map((w) => element('li', {},
        element('strong', {}, `KW ${w.kw}`), ` (ab ${kurzDatum(w.montag)}): ${stunden(w.ueberhang)} h`))),
      element('p', { class: 'hinweis kachel-fuss' }, 'Überhang = Verfügbar − Soll. Wochen ohne Planumsatz zählen nicht.'),
    ],
    sprungText: 'Vorausplanung',
    sprung: () => oeffneVorausplanung(start.jahr, start.kw),
  });
}

function verstossKachel(d) {
  const tage = d.verstoesse;
  const geplant = tage.filter((t) => !t.ungeplant);
  const ungeplant = tage.filter((t) => t.ungeplant);
  const warnungen = geplant.reduce((s, t) => s + t.warnungen, 0);
  // Erster betroffener Tag: zuerst mit Warnung, dann mit Hinweis, dann der erste noch nicht geplante.
  const erster = (geplant.find((t) => t.warnungen > 0) ?? geplant[0] ?? ungeplant[0])?.datum ?? d.heute;
  const tagKnopf = (iso, text) => element('button', { type: 'button', class: 'kachel-tag', onclick: () => oeffneTag(iso) }, text);
  return kachel({
    titel: 'Regelverstöße',
    zeitraum: `${tagText(d.heute)} bis ${tagText(plusTage(d.heute, 6))} (7 Tage)`,
    zahl: warnungen,
    einheit: warnungen === 1 ? 'Warnung' : 'Warnungen',
    befund: tage.length > 0,
    art: warnungen > 0 ? 'rot' : 'gelb',
    inhalt: [
      geplant.length ? kurzListe(geplant.map((t) => element('li', {}, tagKnopf(t.datum, tagText(t.datum)), ': ',
        [t.warnungen ? anzahl(t.warnungen, 'Warnung', 'Warnungen') : null,
          t.hinweise ? anzahl(t.hinweise, 'Hinweis', 'Hinweise') : null].filter(Boolean).join(', ')))) : null,
      ungeplant.length ? element('p', { class: 'hinweis-gelb kachel-ungeplant' }, 'Noch nicht geplant: ',
        ungeplant.map((t, i) => [i ? ', ' : '', tagKnopf(t.datum, tagText(t.datum))])) : null,
      element('p', { class: 'hinweis kachel-fuss' }, 'Wochenstunden und Ruhezeiten zählen je einmal.'),
    ],
    sprungText: `Einsatzplan ${tagText(erster)}`,
    sprung: () => oeffneTag(erster),
  });
}

function wunschKachel(d) {
  const n = d.offene_wuensche;
  const ziel = monatVon(d.erster_wunsch ?? d.heute);
  return kachel({
    titel: 'Offene Urlaubswünsche',
    zeitraum: 'aus dem Urlaubstool, nächste 12 Monate',
    zahl: n,
    einheit: n === 1 ? 'Wunsch' : 'Wünsche',
    befund: n > 0,
    inhalt: [
      d.erster_wunsch ? element('p', {}, 'Der früheste beginnt am ', element('strong', {}, datumDE(d.erster_wunsch)), '.') : null,
      element('p', { class: 'hinweis kachel-fuss' }, 'Noch weder genehmigt noch abgelehnt.'),
    ],
    sprungText: 'Abwesenheiten',
    sprung: () => oeffneMonat(...ziel),
  });
}

// Offene IST-Zeilen (nicht bestätigt) von heute − 42 bis gestern; Sprung in den IST-Modus zum ersten offenen Tag,
// ohne offenen Tag zu gestern.
function istKachel(d) {
  const o = d.ist_offen;
  const gestern = plusTage(d.heute, -1);
  const ziel = o.erster ?? gestern;
  const { jahr, kw } = isoWoche(ziel);
  return kachel({
    titel: 'IST offen',
    zeitraum: `${tagText(plusTage(d.heute, -42))} bis gestern (6 Wochen)`,
    zahl: o.tage,
    einheit: o.tage === 1 ? 'Tag' : 'Tage',
    befund: o.tage > 0,
    inhalt: [
      element('p', {}, `${anzahl(o.zeilen, 'offene Zeile', 'offene Zeilen')}, die früheste am `,
        element('strong', {}, tagText(ziel))),
      element('p', { class: 'hinweis kachel-fuss' }, 'Offene Tage verhindern den Wochenabschluss im Zeitkonto.'),
    ],
    sprungText: `IST ${tagText(ziel)}`,
    sprung: () => oeffneIst(jahr, kw, ziel),
  });
}

// Mitarbeiter mit Warnung am Saldo der zuletzt abgeschlossenen Woche (Buchungen bis zu deren Sonntag).
function zeitkontoKachel(d) {
  const z = d.zeitkonto_auffaellig;
  const n = z.liste.length;
  const ziel = z.montag ? { jahr: z.jahr, kw: z.kw } : isoWoche(plusTage(d.heute, -7));
  return kachel({
    titel: 'Zeitkonto auffällig',
    zeitraum: z.montag ? `Stand KW ${z.kw}/${z.jahr} (zuletzt abgeschlossen)` : 'noch keine Woche abgeschlossen',
    zahl: n,
    einheit: n === 1 ? 'Person' : 'Personen',
    befund: n > 0,
    inhalt: [
      kurzListe(z.liste.map((m) => element('li', {}, '⚠ ', element('strong', {}, m.name),
        ` · ${vorzeichen(m.saldo)} h ${m.warnung === 'plus' ? '(zu viel Plus)' : '(zu viel Minus)'}`))),
      element('p', { class: 'hinweis kachel-fuss' }, 'Warnung ab Zeitkonto-Warnfaktor × Wochenstunden (Einstellungen).'),
    ],
    sprungText: `Zeitkonto KW ${ziel.kw}`,
    sprung: () => oeffneZeitkonto(ziel.jahr, ziel.kw),
    gruen: z.montag ? GRUEN : 'Noch keine Woche abgeschlossen.',
  });
}

// Letzte Sicherung (Stufe 2): nur für die Leitung, nur sie kann sichern. Gelb ab 8 Tagen oder ohne Sicherung.
function sicherungZeile(d) {
  if (ich?.rolle !== 'leitung') return [];
  const h = sicherungHinweis(d.letzte_sicherung, d.heute);
  return [element('p', { class: `start-sicherung ${h.gelb ? 'hinweis-gelb gelb' : 'hinweis'}` }, h.text,
    h.gelb ? ' – bitte jede Woche eine Sicherung herunterladen. ' : ' · ',
    element('button', { type: 'button', class: 'kachel-tag', onclick: oeffneSicherung }, 'Sicherung →'))];
}

function zeichne(d) {
  const { kw } = isoWoche(d.heute);
  $('ansicht-start').replaceChildren(
    element('p', { class: 'start-kopf' }, element('strong', {}, `Heute: ${wochentag(d.heute)}, ${datumDE(d.heute)}`), ` · KW ${kw}`),
    ...sicherungZeile(d),
    element('div', { class: 'kacheln' }, abwesendKachel(d), lueckeKachel(d), verstossKachel(d), wunschKachel(d),
      istKachel(d), zeitkontoKachel(d)));
}

// ---------------------------------------------------------------- Laden

let ladeNummer = 0; // eine spätere Anfrage gewinnt, wenn der Reiter schnell erneut geöffnet wird
async function zeigen() {
  meldung('');
  const nummer = ++ladeNummer;
  let daten;
  try {
    daten = await aufruf('pep_startseite');
  } catch (fehler) {
    if (nummer === ladeNummer) zeigeFehler(fehler);
    return;
  }
  if (nummer !== ladeNummer || !daten) return;
  zeichne(daten);
}

reiter.start = { zeigen };

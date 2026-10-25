// Reiter „Zeitkonto“: Wochenübersicht je Mitarbeiter (Soll, IST, Abwesend, Feiertag, Diff, Saldo), Wochenabschluss
// („Woche buchen“) und das Journal je Mitarbeiter mit Startsaldo und Korrektur von Hand. Gerechnet und gebucht wird in
// der Datenbank (pep_zeitkonto_woche, pep_wochenabschluss, pep_zeitkonto_journal, pep_zeitkonto_buchen).
// Ansehen, drucken (Stundenblatt, Wocheneinsatz-IST) und das Journal als Excel dürfen Leitung und Stellvertretung;
// buchen (Woche, Startsaldo, Korrektur) nur die Leitung.
import { $, meldung, fehlerText, element, stundenDE, datumDE } from './hilfe.js';
import { aufruf, ich, reiter, zeigeAnsicht } from './app.js';
import { dialog } from './dialog.js';
import { isoWoche, kwVorZurueck, plusTage, heuteDatum, montagDerKw } from './zeit.js';
import { kurz } from './plan-raster.js';
import { oeffneIst } from './einsatzplan.js';
import { druckAuswahlZeitkonto, journalExcelDialog } from './druck.js';
import {
  vorzeichen, journalZeilen, wochenSumme, stundenEingabe, saldoWarnung, laufendeWoche,
} from './zeitkonto-daten.js';

// Adresse: ?jahr=&kw= wählen die Woche, ?heute=JJJJ-MM-TT ersetzt das heutige Datum (Vorschau).
const adresse = new URLSearchParams(location.search);
const ganzzahl = (name, min, max) => {
  const n = Number(adresse.get(name));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const heuteIso = () => heuteDatum(adresse.get('heute')); // bei jedem Aufruf neu (Tablet über Nacht offen)
// Ohne Angabe die Vorwoche: das ist die Woche, die am Montag abgeschlossen wird.
const start = isoWoche(plusTage(heuteIso(), -7));
let jahr = ganzzahl('jahr', 2000, 2100) ?? start.jahr;
let kw = ganzzahl('kw', 1, 53) ?? start.kw;
let woche = null; // Antwort von pep_zeitkonto_woche
let journalNachLaden = null; // Mitarbeiter-Id: Journal öffnen, sobald die Woche geladen ist (oeffneZeitkonto)
// zeitkonto_warnfaktor aus pep_einstellungen (je Anzeigen des Reiters neu): für die Warnung am Saldo Vorwoche in der
// laufenden Woche (saldoWarnung spiegelt die Regel des Servers). Fehlt er, warnt die laufende Woche nicht.
let warnfaktor = null;
let warnfaktorLaden = Promise.resolve(null);
const rahmen = {}; // Container: kopf, tabelle

const darfBuchen = () => ich?.rolle === 'leitung';
const zeigeFehler = (fehler) => { if (!fehler.behandelt) meldung(fehlerText(fehler.message)); };

const VERTRAG_KURZ = { vollzeit: 'VZ', teilzeit: 'TZ', minijob: 'MJ', azubi: 'AZ', fuehrung: 'F' };
const kurzDatum = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const anzahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
const vorzeichenKlasse = (n) => (Math.round(Number(n) * 100) > 0 ? 'plus' : Math.round(Number(n) * 100) < 0 ? 'minus' : '');
const uhrzeitAus = (zeitstempel) => new Date(zeitstempel).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const datumAus = (zeitstempel) => new Date(zeitstempel).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const laeuft = () => laufendeWoche(woche, heuteIso());
// Woche vor dem Start der IST-Erfassung (pep_zeitkonto_woche.vor_ist_start): wird nie gebucht; Diff nur zur Ansicht,
// „Saldo aktuell“ ohne Diff (Server). Abgeschlossene Wochen davor gibt es nicht (VOR_IST_START).
const vorStart = () => Boolean(woche?.vor_ist_start) && !woche.abgeschlossen;
const VOR_START = 'vor dem Start der IST-Erfassung: wird nicht gebucht, zählt nicht im Saldo';
const VORLAEUFIG = 'vorläufig: Soll der ganzen Woche, IST erst bis heute';
// Zeile mit gebucht = false (pep_zeitkonto_woche): Der Abschluss bucht diese Diff nicht bzw. hat sie nicht gebucht.
const NICHT_GEBUCHT = 'nicht gebucht: inaktiv oder beim Abschluss nicht dabei – zählt nicht im Saldo und nicht in der '
  + 'Summe; Korrektur von Hand möglich';

// ---------------------------------------------------------------- Laden

let ladeNummer = 0; // verwirft veraltete Antworten, wenn schnell geblättert wird
// jahr/kw gelten erst nach Erfolg, damit Zustand und Anzeige übereinstimmen.
async function lade(j = jahr, k = kw) {
  const nummer = ++ladeNummer;
  let antwort;
  try {
    [antwort, warnfaktor] = await Promise.all([aufruf('pep_zeitkonto_woche', { p_jahr: j, p_kw: k }), warnfaktorLaden]);
  } catch (fehler) {
    if (nummer !== ladeNummer) return; // veraltete Anfrage: Fehler egal
    throw fehler;
  }
  if (nummer !== ladeNummer || !antwort) return;
  jahr = j;
  kw = k;
  woche = antwort;
  zeichneKopf();
  zeichneTabelle();
}

function verschiebe(schritt) {
  const ziel = kwVorZurueck(jahr, kw, schritt);
  lade(ziel.jahr, ziel.kw).catch(zeigeFehler);
}

function vorwoche() {
  const ziel = isoWoche(plusTage(heuteIso(), -7));
  lade(ziel.jahr, ziel.kw).catch(zeigeFehler);
}

// Sprungziel (Startseite, spätere Tasks): öffnet den Reiter mit dieser Woche, optional gleich das Journal.
export function oeffneZeitkonto(j, k, mitarbeiterId = null) {
  jahr = j;
  kw = k;
  journalNachLaden = mitarbeiterId;
  zeigeAnsicht('zeitkonto');
}

// „n Tage offen“: in den IST-Modus auf den ersten offenen Tag (mid null = der ganzen Filiale). pep_zeitkonto_woche
// nennt nur die Anzahl; welcher Tag offen ist, steht im Status von pep_ist_woche. Ohne Treffer der Montag.
async function zumErstenOffenenTag(mid = null) {
  const { jahr: j, kw: k, montag } = woche;
  let ziel = montag;
  try {
    const ist = await aufruf('pep_ist_woche', { p_jahr: j, p_kw: k });
    const offen = (ist?.status ?? []).filter((s) => !s.bestaetigt && (mid == null || s.mitarbeiter_id === mid))
      .map((s) => s.datum).sort();
    if (offen.length) ziel = offen[0];
  } catch (fehler) {
    if (fehler.behandelt) return; // abgemeldet
  }
  oeffneIst(j, k, ziel);
}

// ---------------------------------------------------------------- Kopf: Woche und Abschluss

function abschlussTeil() {
  const a = woche.abgeschlossen;
  if (a) {
    return element('p', { class: 'zk-status zk-gebucht' }, element('span', { 'aria-hidden': 'true' }, '✓ '),
      `Abgeschlossen am ${datumAus(a.am)} um ${uhrzeitAus(a.am)}${a.von_name ? ` von ${a.von_name}` : ''}`);
  }
  const sonntag = plusTage(woche.montag, 6);
  const laufend = laeuft();
  const offen = woche.offene_tage;
  const teile = [];
  const vor = vorStart();
  if (darfBuchen()) {
    teile.push(element('button', {
      type: 'button', class: 'knopf primaer', disabled: offen > 0 || laufend || vor, onclick: (e) => wocheBuchen(e.currentTarget),
      title: 'Bucht je Mitarbeiter die Differenz dieser Woche ins Zeitkonto',
    }, 'Woche buchen'));
  } else {
    teile.push(element('span', { class: 'zk-status' }, 'Noch nicht abgeschlossen (bucht die Filialleitung).'));
  }
  if (offen > 0) {
    teile.push(element('button', {
      type: 'button', class: 'zk-offen', onclick: () => zumErstenOffenenTag(), title: 'Zum ersten offenen Tag im IST',
    }, `${anzahl(offen, 'Tag', 'Tage')} im IST offen`));
  }
  if (vor) {
    teile.push(element('span', { class: 'hinweis' },
      `Vor dem Start der IST-Erfassung (${datumDE(woche.ist_ab)}) – diese Woche wird nicht gebucht.`));
  } else if (laufend) {
    teile.push(element('span', { class: 'hinweis' },
      `Die Woche läuft noch; abschließen geht ab ${datumDE(plusTage(sonntag, 1))}.`));
  } else if (offen > 0 && darfBuchen()) {
    teile.push(element('span', { class: 'hinweis' }, 'Erst alle Tage im IST bestätigen, dann die Woche buchen.'));
  }
  return element('div', { class: 'zk-status-zeile' }, teile);
}

function zeichneKopf() {
  const so = plusTage(woche.montag, 6);
  rahmen.kopf.replaceChildren(element('div', { class: 'werkzeug-zeile' },
    element('div', { class: 'monatsnavi' },
      element('button', { type: 'button', class: 'knopf pfeil', 'aria-label': 'Eine Woche zurück', onclick: () => verschiebe(-1) }, '◀'),
      element('strong', { class: 'monatsname' }, `KW ${woche.kw}/${woche.jahr}`),
      element('button', { type: 'button', class: 'knopf pfeil', 'aria-label': 'Eine Woche weiter', onclick: () => verschiebe(1) }, '▶'),
      element('span', { class: 'hinweis' }, `${kurzDatum(woche.montag)}–${kurzDatum(so)}${so.slice(0, 4)}`),
      element('button', { type: 'button', class: 'knopf', onclick: vorwoche }, 'Vorwoche')),
    // Drucken und Journal als Excel: nur lesend, darum auch für die Stellvertretung.
    element('div', { class: 'zk-knoepfe' },
      element('button', {
        type: 'button', class: 'knopf', 'data-aktion': 'zk-drucken', onclick: () => druckAuswahlZeitkonto(woche),
        title: 'Stundenblatt oder Wocheneinsatz-IST drucken',
      }, 'Drucken'),
      element('button', {
        type: 'button', class: 'knopf', 'data-aktion': 'zk-journal-excel', onclick: () => journalExcelDialog(heuteIso()),
        title: 'Alle Buchungen eines Zeitraums als Excel-Datei',
      }, 'Journal als Excel')),
    abschlussTeil()));
}

// ---------------------------------------------------------------- Tabelle

const SPALTEN = [
  ['Vertrag', 'Vertragsart und Wochenstunden'],
  ['Soll', 'Wochenstunden anteilig für die beschäftigten Tage Mo–Sa'],
  ['IST', 'bestätigte Arbeitszeit ohne Pausen'],
  ['Abwesend', 'Abwesenheiten mit Gutschrift (z. B. Urlaub, krank)'],
  ['Feiertag', 'Gutschrift für gesetzliche Feiertage, an denen die Filiale geschlossen ist'],
  ['Diff', 'IST + Abwesend + Feiertag − Soll (Führung: Plus erst über der Grenze)'],
  ['Saldo Vorwoche', 'Zeitkonto vor dieser Woche'],
  ['Saldo aktuell', 'Saldo Vorwoche + Buchungen dieser Woche; solange die Woche offen ist, mit der Diff (vorläufig)'],
  ['Spät', 'bestätigte Arbeitszeit ab der Spätgrenze (Einstellungen)'],
  ['Offen', 'Tage dieser Woche, die im IST noch nicht bestätigt sind'],
];

function vertragText(m) {
  return `${VERTRAG_KURZ[m.vertragsart] ?? m.vertragsart ?? ''} ${kurz(Number(m.wochenstunden) || 0)}`.trim();
}

const zahlZelle = (wert, klasse = '') => element('td', { class: `zahl ${klasse}`.trim() }, wert);

// Saldo-Zelle mit Warnung ('plus' | 'minus' | null): ⚠ und gelber Grund, Erklärung im title.
function saldoZelle(wert, warnung, klasse) {
  const warn = warnung === 'plus' || warnung === 'minus';
  const td = zahlZelle(vorzeichen(wert), `${klasse}${warn ? ' zk-warnung' : ''}`);
  if (warn) {
    td.title = warnung === 'plus'
      ? 'Saldo über dem Warnwert (Warnfaktor × Wochenstunden, Einstellungen)'
      : 'Saldo unter dem Warnwert (−Warnfaktor × Wochenstunden, Einstellungen)';
    td.prepend(element('span', { class: 'zk-warnsymbol', 'aria-label': 'Warnung' }, '⚠ '));
  }
  return td;
}

// Laufende Woche: Diff und Saldo aktuell grau und ohne Vorzeichenfarbe (vorläufig); die Warnung hängt dann am Saldo
// Vorwoche, im Browser nach der Regel des Servers gerechnet. Sonst wie geliefert: Warnung am Saldo aktuell.
function saldoZellen(m, laufend) {
  if (vorStart()) { // grau wie vorläufig; die Warnung des Servers hängt am Saldo aktuell (ohne Diff)
    const diff = zahlZelle(vorzeichen(m.diff), 'vorlaeufig');
    diff.title = VOR_START;
    const aktuell = saldoZelle(m.saldo_aktuell, m.warnung, 'vorlaeufig');
    if (!aktuell.title) aktuell.title = VOR_START;
    return [diff, zahlZelle(vorzeichen(m.saldo_vorwoche)), aktuell];
  }
  if (m.gebucht === false) { // grau mit „nicht gebucht“; Saldo aktuell ohne die Diff (Server)
    const diff = zahlZelle(vorzeichen(m.diff), 'vorlaeufig zk-nicht-gebucht');
    diff.title = NICHT_GEBUCHT;
    diff.append(element('small', { class: 'zk-nicht-gebucht-marke' }, 'nicht gebucht'));
    const vorwoche = laufend
      ? saldoZelle(m.saldo_vorwoche, saldoWarnung(m.saldo_vorwoche, m.wochenstunden, warnfaktor), '')
      : zahlZelle(vorzeichen(m.saldo_vorwoche));
    const aktuell = laufend ? zahlZelle(vorzeichen(m.saldo_aktuell))
      : saldoZelle(m.saldo_aktuell, m.warnung, vorzeichenKlasse(m.saldo_aktuell));
    return [diff, vorwoche, aktuell];
  }
  if (laufend) {
    const diff = zahlZelle(vorzeichen(m.diff), 'vorlaeufig');
    diff.title = VORLAEUFIG;
    const aktuell = zahlZelle(vorzeichen(m.saldo_aktuell), 'vorlaeufig');
    aktuell.title = VORLAEUFIG;
    return [diff, saldoZelle(m.saldo_vorwoche, saldoWarnung(m.saldo_vorwoche, m.wochenstunden, warnfaktor), ''), aktuell];
  }
  return [zahlZelle(vorzeichen(m.diff), vorzeichenKlasse(m.diff)), zahlZelle(vorzeichen(m.saldo_vorwoche)),
    saldoZelle(m.saldo_aktuell, m.warnung, vorzeichenKlasse(m.saldo_aktuell))];
}

function zeile(m, laufend) {
  const fuehrung = m.vertragsart === 'fuehrung' && m.grenze != null;
  return element('tr', { 'data-mitarbeiter': m.id, class: m.aktiv ? '' : 'inaktiv' },
    element('th', { scope: 'row' },
      element('button', { type: 'button', class: 'zk-name', title: 'Journal öffnen', onclick: () => oeffneJournal(m) }, m.name),
      m.aktiv ? null : element('small', {}, ' (inaktiv)')),
    element('td', { class: 'zk-vertrag', title: fuehrung ? `Führung: Plus zählt erst über ${stundenDE(m.grenze)} h` : null }, vertragText(m)),
    zahlZelle(stundenDE(m.soll)),
    zahlZelle(stundenDE(m.ist)),
    zahlZelle(stundenDE(m.abwesend)),
    zahlZelle(stundenDE(m.feiertag)),
    saldoZellen(m, laufend),
    zahlZelle(stundenDE(m.spaet)),
    element('td', { class: 'zk-offen-zelle' }, m.offene_tage > 0
      ? element('button', {
        type: 'button', class: 'zk-offen', title: 'Zum ersten offenen Tag im IST', onclick: () => zumErstenOffenenTag(m.id),
      }, anzahl(m.offene_tage, 'Tag', 'Tage'))
      : element('span', { class: 'hinweis' }, '–')));
}

function zeichneTabelle() {
  const liste = woche.mitarbeiter ?? [];
  if (!liste.length) {
    rahmen.tabelle.replaceChildren(element('p', { class: 'hinweis' }, 'In dieser Woche hat niemand einen Vertrag.'));
    return;
  }
  const laufend = laeuft();
  const vor = vorStart();
  const s = wochenSumme(liste, { vorStart: vor });
  const grau = laufend || vor;
  const nichtGebucht = !vor && liste.some((m) => m.gebucht === false);
  const kopf = element('tr', {}, element('th', { scope: 'col' }, 'Mitarbeiter'),
    SPALTEN.map(([titel, hinweis], i) => element('th', {
      scope: 'col', title: hinweis, class: i > 0 && i < SPALTEN.length - 1 ? 'zahl' : '',
    }, titel, grau && (titel === 'Diff' || titel === 'Saldo aktuell')
      ? element('small', { class: 'zk-vorlaeufig-marke' },
        !vor ? 'vorläufig' : titel === 'Diff' ? 'nicht gebucht' : 'ohne Diff') : null)));
  const fuss = element('tr', {}, element('th', { scope: 'row' }, 'Summe'), element('td'),
    zahlZelle(stundenDE(s.soll)), zahlZelle(stundenDE(s.ist)), zahlZelle(stundenDE(s.abwesend)),
    zahlZelle(stundenDE(s.feiertag)),
    Object.assign(zahlZelle(vorzeichen(s.diff), grau ? 'vorlaeufig' : vorzeichenKlasse(s.diff)),
      { title: vor ? 'Vor dem Start der IST-Erfassung – nichts gebucht'
        : nichtGebucht ? 'Summe ohne die nicht gebuchten Diffs' : '' }),
    element('td'), element('td'), element('td'), element('td'));
  rahmen.tabelle.replaceChildren(
    element('div', { class: 'tabelle-scroll' },
      element('table', { class: 'zk-tabelle' },
        element('thead', {}, kopf), element('tbody', {}, liste.map((m) => zeile(m, laufend))), element('tfoot', {}, fuss))),
    element('p', { class: 'hinweis zk-fuss' }, 'Klick auf einen Namen öffnet das Journal. ', vor
      ? 'Die Woche liegt vor dem Start der IST-Erfassung: Die Diff steht nur zur Ansicht da, sie wird nicht gebucht '
        + 'und zählt nicht im Saldo aktuell. ⚠ = Saldo über dem Warnwert (Warnfaktor × Wochenstunden, Einstellungen).'
      : laufend
        ? 'Die Woche läuft noch: Diff und Saldo aktuell sind vorläufig (Soll der ganzen Woche, IST erst bis heute). '
          + '⚠ = Saldo Vorwoche über dem Warnwert (Warnfaktor × Wochenstunden, Einstellungen).'
        : '⚠ = Saldo über dem Warnwert (Warnfaktor × Wochenstunden, Einstellungen).',
    woche.abgeschlossen || grau ? '' : ' Solange die Woche nicht gebucht ist, enthält „Saldo aktuell“ die Diff.',
    nichtGebucht ? element('span', { class: 'zk-legende-nicht-gebucht' }, ' Grau mit „nicht gebucht“: inaktiv oder beim '
      + 'Abschluss nicht dabei – die Diff zählt weder im Saldo noch in der Summe; Korrektur von Hand möglich.') : ''));
}

// ---------------------------------------------------------------- Woche buchen

const ERSTER_ABSCHLUSS = 'Erster Wochenabschluss: Startsalden (Übernahme aus der bisherigen Zeiterfassung) bitte vorher '
  + 'im Journal je Mitarbeiter eintragen – danach geht nur noch „Korrektur von Hand“.';

// Erster Abschluss der Filiale? Ohne Schemaänderung: Ist die Vorwoche abgeschlossen, nein. Sonst entscheidet das Journal
// der ganzen Filiale – jeder Abschluss bucht Zeilen „woche“. Den Journal-Abruf gibt es also nur, wenn die Vorwoche offen
// ist (erster Abschluss oder Abschluss außer der Reihe). Bei Fehler lieber mit Hinweis.
async function ersterAbschluss(montag) {
  try {
    const vor = isoWoche(plusTage(montag, -7));
    if ((await aufruf('pep_zeitkonto_woche', { p_jahr: vor.jahr, p_kw: vor.kw }))?.abgeschlossen) return false;
    const journal = await aufruf('pep_zeitkonto_journal', { p_mitarbeiter_id: null, p_von: null, p_bis: null });
    return !(journal ?? []).some((b) => b.art === 'woche');
  } catch (fehler) {
    if (fehler.behandelt) throw fehler;
    return true;
  }
}

async function wocheBuchen(knopf) {
  const { jahr: j, kw: k, montag } = woche;
  let antwort = null;
  knopf.disabled = true; // Doppelklick während der Prüfung öffnet keinen zweiten Dialog
  let erster;
  try {
    erster = await ersterAbschluss(montag);
  } catch {
    return; // abgemeldet
  } finally {
    knopf.disabled = false;
  }
  dialog(`KW ${k}/${j} abschließen`, [
    erster ? element('p', { class: 'hinweis-gelb zk-erster' }, ERSTER_ABSCHLUSS) : null,
    element('p', {}, 'Bucht für jeden Mitarbeiter die Diff dieser Woche ins Zeitkonto.'),
    element('p', { class: 'hinweis' },
      'Ein Abschluss lässt sich nicht zurücknehmen. Ändert sich danach etwas in dieser Woche (IST, Abwesenheit, Vertrag), '
      + 'bucht PEP die Änderung automatisch als Korrektur nach.'),
  ], [{
    text: 'Woche buchen',
    aktion: async () => { antwort = await aufruf('pep_wochenabschluss', { p_jahr: j, p_kw: k }); },
    danach: async () => {
      meldung(`KW ${k}/${j} abgeschlossen: ${anzahl(antwort?.gebucht ?? 0, 'Buchung', 'Buchungen')}.`, 'ok');
      await lade();
    },
  }]);
}

// ---------------------------------------------------------------- Journal

// Dialog mit allen Buchungen eines Mitarbeiters in Buchungsreihenfolge (journalZeilen), darunter für die Leitung
// „Korrektur buchen“ und – nur solange das Journal leer ist – „Startsaldo“ (der Server lehnt sonst START_NICHT_ERSTE ab).
// Die Buchungsknöpfe stehen vor „Schließen“ in der Knopfleiste des Dialogs; sie öffnen einen zweiten Dialog darüber,
// danach werden Journal und Wochentabelle neu geladen.
function oeffneJournal(m) {
  const inhalt = element('div', { class: 'zk-journal' }, element('p', { class: 'hinweis' }, 'Lädt …'));
  const knoepfe = element('span', { class: 'zk-journal-knoepfe' });
  const d = dialog(`Zeitkonto: ${m.name}`, [inhalt], [], () => {}, 'Schließen');
  d.classList.add('zk-journal-dialog');
  d.querySelector('.dialog-knoepfe').prepend(knoepfe);
  // Nach einer Buchung: Wochentabelle (Fehler als Seitenmeldung) und Journal (Fehler im offenen Dialog) unabhängig neu.
  const nachBuchung = async () => {
    lade().catch(zeigeFehler);
    await fuellen();
  };
  const fuellen = async () => {
    try {
      const zeilen = journalZeilen(await aufruf('pep_zeitkonto_journal', { p_mitarbeiter_id: m.id, p_von: null, p_bis: null }));
      inhalt.replaceChildren(...journalInhalt(zeilen));
      knoepfe.replaceChildren(...buchungsKnoepfe(m, zeilen, nachBuchung));
    } catch (fehler) {
      if (fehler.behandelt) { d.close(); return; }
      inhalt.replaceChildren(element('p', { class: 'meldung fehler', role: 'alert' }, fehlerText(fehler.message)));
      knoepfe.replaceChildren();
    }
  };
  fuellen();
}

function journalInhalt(zeilen) {
  const saldo = zeilen.length ? zeilen[zeilen.length - 1].saldo : 0;
  const teile = [element('p', { class: 'zk-saldo' }, 'Saldo: ',
    element('strong', { class: `zahl ${vorzeichenKlasse(saldo)}`.trim() }, `${vorzeichen(saldo)} h`),
    element('span', { class: 'hinweis' }, ` · ${anzahl(zeilen.length, 'Buchung', 'Buchungen')}`))];
  if (zeilen.length) {
    teile.push(element('div', { class: 'tabelle-scroll' }, element('table', { class: 'zk-journal-tabelle' },
      element('thead', {}, element('tr', {},
        ['Gebucht am', 'KW', 'Art', 'Stunden', 'Saldo', 'Grund', 'Von'].map((t, i) =>
          element('th', { scope: 'col', class: i === 3 || i === 4 ? 'zahl' : '' }, t)))),
      element('tbody', {}, zeilen.map((z) => element('tr', {},
        element('td', {}, z.am ? datumDE(z.am) : ''),
        element('td', { class: 'zk-kw' }, z.kw),
        element('td', {}, z.art),
        zahlZelle(vorzeichen(z.stunden), vorzeichenKlasse(z.stunden)),
        zahlZelle(vorzeichen(z.saldo)),
        element('td', { class: 'zk-grund' }, z.grund),
        element('td', {}, z.von)))))));
    teile.push(element('p', { class: 'hinweis zk-fuss' },
      'Reihenfolge wie gebucht; „Saldo“ ist der Stand nach der Buchung. KW = Woche, für die gebucht wurde.'));
  } else {
    teile.push(element('p', { class: 'hinweis' }, 'Noch keine Buchungen.'));
  }
  return teile;
}

// Nur die Leitung bucht. „Startsaldo“ nur bei leerem Journal (sonst START_NICHT_ERSTE vom Server).
function buchungsKnoepfe(m, zeilen, nachBuchung) {
  if (!darfBuchen()) return [];
  return [
    zeilen.length ? null
      : element('button', { type: 'button', class: 'knopf', onclick: () => buchungsDialog(m, 'start', nachBuchung) }, 'Startsaldo'),
    element('button', { type: 'button', class: 'knopf', onclick: () => buchungsDialog(m, 'manuell', nachBuchung) }, 'Korrektur buchen'),
  ].filter(Boolean);
}

// Startsaldo oder Korrektur von Hand. Stunden mit Komma („−4,5“, „2,25“), Grund Pflicht, Datum bestimmt die Woche,
// in deren Saldo die Buchung zählt. Vorbelegt: Korrektur heute; Startsaldo der Sonntag vor der angezeigten Woche, damit er
// dort als „Saldo Vorwoche“ erscheint (mit heute stünde er erst in der laufenden Woche, nach den ersten Abschlüssen) –
// höchstens aber der Sonntag vor der aktuellen Woche, damit er nie in der Zukunft liegt.
function buchungsDialog(m, art, nachBuchung) {
  const heute = isoWoche(heuteIso());
  const startDatum = [plusTage(woche.montag, -1), plusTage(montagDerKw(heute.jahr, heute.kw), -1)].sort()[0];
  const startKw = isoWoche(plusTage(startDatum, 1));
  const stunden = element('input', {
    type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'z. B. −4,5 oder 2,25', class: 'zk-stunden',
  });
  const datum = element('input', { type: 'date', value: art === 'start' ? startDatum : heuteIso() });
  const grund = element('input', {
    type: 'text', maxlength: '200', autocomplete: 'off',
    placeholder: art === 'start' ? 'z. B. Übernahme aus der bisherigen Liste' : 'z. B. Überstunden ausgezahlt',
  });
  const d = dialog(art === 'start' ? `Startsaldo: ${m.name}` : `Korrektur buchen: ${m.name}`, [
    element('p', { class: 'hinweis' }, art === 'start'
      ? `Stand des Zeitkontos zu Beginn; das Datum ist auf den Tag vor KW ${startKw.kw}/${startKw.jahr} vorbelegt. `
        + 'Geht nur als erste Buchung des Mitarbeiters.'
      : 'Plus schreibt Stunden gut, Minus zieht sie ab. Die Buchung zählt in der Woche des Datums.'),
    element('label', { class: 'feld' }, 'Stunden (Plus oder Minus)', stunden),
    element('label', { class: 'feld' }, 'Datum', datum),
    element('label', { class: 'feld' }, 'Grund (Pflicht)', grund),
  ], [{
    text: 'Buchen',
    aktion: async () => {
      const n = stundenEingabe(stunden.value);
      if (n === null) throw new Error('STUNDEN_FEHLEN');
      if (Number.isNaN(n)) throw new Error('STUNDEN_UNGUELTIG');
      const g = grund.value.trim();
      if (!g) throw new Error('GRUND_FEHLT');
      if (!datum.value) throw new Error('DATUM_UNGUELTIG');
      await aufruf('pep_zeitkonto_buchen', { p_mitarbeiter_id: m.id, p_art: art, p_stunden: n, p_grund: g, p_datum: datum.value });
    },
    danach: async () => {
      meldung('Gebucht.', 'ok');
      await nachBuchung();
    },
  }]);
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    d.querySelector('.dialog-knoepfe .knopf.primaer')?.click();
  });
  stunden.focus();
}

// ---------------------------------------------------------------- Anzeigen

async function zeigen() {
  meldung('');
  warnfaktorLaden = aufruf('pep_einstellungen')
    .then((e) => e?.werte?.zeitkonto_warnfaktor ?? null)
    .catch((fehler) => { if (fehler.behandelt) throw fehler; return null; });
  if (!rahmen.kopf) {
    rahmen.kopf = element('div', { class: 'box werkzeugleiste' });
    rahmen.tabelle = element('div', { class: 'box' });
    $('ansicht-zeitkonto').replaceChildren(rahmen.kopf, rahmen.tabelle);
  }
  try {
    await lade();
  } catch (fehler) {
    zeigeFehler(fehler);
    return;
  }
  const mid = journalNachLaden;
  journalNachLaden = null;
  const m = mid == null ? null : woche?.mitarbeiter.find((x) => x.id === mid);
  if (m) oeffneJournal(m);
}

reiter.zeitkonto = { zeigen };

// Reiter „Einstellungen“ (nur Filialleitung): Zeiten, abweichende Tage, Bereiche, Codes, Regelparameter,
// Schulferien, Urlaubstool, Benutzer, Sicherung. Jede Zeile speichert für sich und lädt danach ihren Abschnitt neu.
// Die Abschnitte sind auf sechs Unterreiter verteilt (TEILE); alle bleiben im DOM, nur der gewählte Teil ist sichtbar.
import {
  $, meldung, fehlerText, element, datumDE, WOCHENTAGE,
  zahl, uhrzeit, feld, eingabe as eingabeBasis, auswahlfeld as auswahlBasis,
  zeilenformular, abschnitt, fuehreAus,
} from './hilfe.js';
import { aufruf, ich, reiter, zeigeAnsicht, aktualisiereIch } from './app.js';
import { zeichneSicherung } from './sicherung.js';

const ARTEN_ABWEICHUNG = [
  ['feiertag', 'Feiertag'], ['heiligabend', 'Heiligabend'], ['silvester', 'Silvester'],
  ['vor_feiertag', 'Tag vor Feiertag'], ['verkaufsoffen', 'Verkaufsoffener Sonntag'], ['sonstiges', 'Sonstiges'],
];
const ARTEN_BEREICH = [['bereich', 'Bereich'], ['funktion', 'Funktion']];
const STUNDENREGELN = [
  ['teiler', 'Vertragsstunden ÷ Teiler'], ['tatsaechlich', 'Tatsächliche Stunden'], ['keine', 'Keine Stunden'],
];
const ROLLEN = [['leitung', 'Leitung'], ['stellvertretung', 'Stellvertretung']];

// Schlüssel → [Beschriftung, Schrittweite oder 'zeit', Erklärung]
const PARAMETER = {
  abwesenheit_teiler: ['Abwesenheits-Teiler', 0.5, 'Vertragsstunden ÷ Teiler = Stunden je Abwesenheitstag (z. B. 40 h ÷ 6 = 6,67 h).'],
  feiertag_teiler: ['Feiertags-Teiler', 0.5, 'Wie der Abwesenheits-Teiler, aber für gesetzliche Feiertage.'],
  pause_ab_6h_min: ['Pause ab 6 h (Min.)', 1, 'Mindestpause in Minuten, wenn ein Tag mehr als 6 Stunden hat.'],
  pause_ab_9h_min: ['Pause ab 9 h (Min.)', 1, 'Mindestpause in Minuten, wenn ein Tag mehr als 9 Stunden hat.'],
  ruhezeit_h: ['Ruhezeit (h)', 0.5, 'Mindestens so viele Stunden müssen zwischen zwei Schichten liegen.'],
  ruhezeit_u18_h: ['Ruhezeit unter 18 (h)', 0.5, 'Mindestruhezeit zwischen zwei Schichten für Jugendliche.'],
  max_tag_h: ['Höchstarbeitszeit pro Tag (h)', 0.5, 'Mehr als so viele Stunden an einem Tag gelten als Verstoß.'],
  max_tag_u18_h: ['Höchstarbeitszeit pro Tag unter 18 (h)', 0.5, 'Tageshöchstgrenze für Jugendliche.'],
  max_woche_u18_h: ['Höchstarbeitszeit pro Woche unter 18 (h)', 0.5, 'Wochenhöchstgrenze für Jugendliche.'],
  spaet_grenze: ['Späte Schicht ab', 'zeit', 'Uhrzeit, ab der eine Schicht als „spät“ gilt.'],
  u18_fruehestens: ['Jugendliche frühestens ab', 'zeit', 'Frühester erlaubter Schichtbeginn für Jugendliche.'],
  u18_spaetestens: ['Jugendliche spätestens bis', 'zeit', 'Spätestes erlaubtes Schichtende für Jugendliche.'],
  freie_samstage_monat: ['Freie Samstage pro Monat', 1, 'Mindestens so viele Samstage im Monat sollen frei sein.'],
  freie_samstage_jahr: ['Freie Samstage pro Jahr', 1, 'Mindestens so viele Samstage im Jahr sollen frei sein.'],
  wochen_toleranz_h: ['Wochen-Toleranz (h)', 0.5, 'So viele Stunden darf die Wochensumme von den Vertragsstunden abweichen, ohne dass gewarnt wird.'],
  zeitkonto_warnfaktor: ['Zeitkonto-Warnfaktor', 0.5, 'Warnung, sobald das Zeitkonto diesen Faktor der Zeitkonto-Grenze erreicht.'],
  stundenleistung_eur_h: ['Stundenleistung (€ pro h)', 0.5, 'Umsatz je Arbeitsstunde, Richtwert für die Bedarfsplanung.'],
  kassierleistung_eur_halbe_h: ['Kassierleistung (€ je halbe Stunde)', 0.5, 'Wirkt erst mit der Kassenplanung (noch nicht gebaut).'],
};

let daten = null; // Antwort von pep_einstellungen
let jahr = new Date().getFullYear();
let feiertage = [];
let umfragen = [];
let zuordnung = [];
let mitarbeiter = [];
const boxen = {}; // Abschnittsname → Container
let zurSicherung = false; // nach dem Laden zum Abschnitt „Sicherung“ springen (Hinweis auf der Startseite)

// Unterreiter: Schlüssel, Beschriftung, Abschnitte (Namen aus ZEICHNER). Der gewählte Teil wird im Browser gemerkt.
const TEILE = [
  ['zeiten', 'Filiale & Zeiten', ['rahmen', 'abweichungen', 'schulferien']],
  ['bereiche', 'Bereiche & Codes', ['bereiche', 'codes']],
  ['lieferung', 'Lieferung', ['warengruppen', 'liefermuster']],
  ['regeln', 'Regeln & Zeitkonto', ['parameter', 'ist']],
  ['urlaub', 'Urlaubstool', ['urlaub']],
  ['benutzer', 'Benutzer & Sicherung', ['benutzer', 'sicherung']],
];
const TEIL_SCHLUESSEL = 'pep-einstellungen-teil';
let teil = (() => { try { return localStorage.getItem(TEIL_SCHLUESSEL); } catch { return null; } })();
if (!TEILE.some(([k]) => k === teil)) teil = TEILE[0][0];
let teilLeiste = null;

const darfSchreiben = () => ich?.rolle === 'leitung';
const eingabe = (typ, wert, attrs = {}) => eingabeBasis(typ, wert, { disabled: !darfSchreiben(), ...attrs });
const auswahlfeld = (optionen, wert) => auswahlBasis(optionen, wert, { disabled: !darfSchreiben() });
const knopfSpeichern = (beschriftung = 'Speichern') =>
  darfSchreiben() ? element('button', { type: 'submit' }, beschriftung) : null;
const knopf = (beschriftung, aktion) =>
  darfSchreiben() ? element('button', { type: 'button', class: 'knopf', onclick: aktion }, beschriftung) : null;
const haken = (beschriftung, kasten) => element('label', { class: 'feld haken' }, kasten, ` ${beschriftung}`);
const farbe = (wert) => eingabe('color', wert || '#cccccc');
const tagIso = (wert) => String(wert).slice(0, 10);

// ---------------------------------------------------------------- Laden und Speichern

async function ladeDaten() { daten = await aufruf('pep_einstellungen'); }
async function ladeUrlaub() {
  [umfragen, zuordnung, mitarbeiter] = await Promise.all(
    [aufruf('pep_urlaub_umfragen'), aufruf('pep_urlaub_zuordnung'), aufruf('pep_mitarbeiter_liste')]);
}

// Schreibt, lädt `pep_einstellungen` neu und zeichnet nur die genannten Abschnitte neu.
const speichere = (aktion, ...namen) => fuehreAus(aktion, async () => {
  await ladeDaten();
  namen.forEach((n) => ZEICHNER[n]());
});
const speichereUrlaub = (aktion) => fuehreAus(aktion, async () => { await ladeUrlaub(); zeichneUrlaub(); });

async function zeigen() {
  meldung('');
  if (!boxen.rahmen) {
    for (const [schluessel, , namen] of TEILE) {
      for (const name of namen) boxen[name] = element('div', { 'data-abschnitt': name, 'data-teil': schluessel });
    }
    teilLeiste = element('div', { class: 'chip-gruppe einst-teile', role: 'group', 'aria-label': 'Bereich der Einstellungen' },
      ...TEILE.map(([schluessel, text]) => element('button', {
        type: 'button', class: 'chip', 'data-teil': schluessel, onclick: () => waehleTeil(schluessel),
      }, text)));
    $('ansicht-einstellungen').replaceChildren(teilLeiste, ...TEILE.flatMap(([, , namen]) => namen.map((n) => boxen[n])));
    zeigeTeil();
  }
  try {
    await Promise.all([ladeDaten(), ladeUrlaub(), aufruf('pep_feiertage', { p_jahr: jahr }).then((f) => { feiertage = f; })]);
  } catch (fehler) {
    if (!fehler.behandelt) meldung(fehlerText(fehler.message));
    return;
  }
  Object.values(ZEICHNER).forEach((zeichne) => zeichne());
  if (zurSicherung) { waehleTeil('benutzer'); boxen.sicherung.scrollIntoView({ block: 'start' }); }
  zurSicherung = false;
}

// Zeigt nur die Abschnitte des gewählten Unterreiters; der Knopf des Teils ist gedrückt.
function zeigeTeil() {
  for (const k of teilLeiste.querySelectorAll('[data-teil]')) k.setAttribute('aria-pressed', String(k.dataset.teil === teil));
  for (const box of Object.values(boxen)) box.hidden = box.dataset.teil !== teil;
}

function waehleTeil(schluessel) {
  teil = schluessel;
  try { localStorage.setItem(TEIL_SCHLUESSEL, teil); } catch { /* nur für diese Sitzung */ }
  if (teilLeiste) zeigeTeil();
}

// Reiter öffnen und zum Abschnitt „Sicherung“ springen (Startseite).
export function oeffneSicherung() {
  zurSicherung = true;
  zeigeAnsicht('einstellungen');
}

// ---------------------------------------------------------------- Zeiten (Rahmen und Abweichungen)

// Vier Zeitfelder; `lesen(geoeffnet)` liefert die Werte, bei geschlossen alle null.
function zeitfelder(z) {
  const f = {
    oeffnung_von: eingabe('time', uhrzeit(z.oeffnung_von), { step: '1800' }),
    oeffnung_bis: eingabe('time', uhrzeit(z.oeffnung_bis), { step: '1800' }),
    rahmen_von: eingabe('time', uhrzeit(z.rahmen_von), { step: '1800' }),
    rahmen_bis: eingabe('time', uhrzeit(z.rahmen_bis), { step: '1800' }),
  };
  const knoten = [feld('Öffnung von', f.oeffnung_von), feld('Öffnung bis', f.oeffnung_bis),
    feld('Rahmen von', f.rahmen_von), feld('Rahmen bis', f.rahmen_bis)];
  const lesen = (auf) => Object.fromEntries(Object.entries(f).map(([k, e]) => [k, auf ? e.value || null : null]));
  return { knoten, lesen };
}

function zeichneRahmen() {
  const zeilen = daten.rahmen.map((r) => {
    const auf = eingabe('checkbox', r.geoeffnet);
    const zeiten = zeitfelder(r);
    return zeilenformular(
      () => speichere(() => aufruf('pep_rahmen_speichern',
        { p_wochentag: r.wochentag, p_daten: { geoeffnet: auf.checked, ...zeiten.lesen(auf.checked) } }), 'rahmen'),
      element('strong', { class: 'zeilentitel' }, WOCHENTAGE[r.wochentag - 1]),
      haken('geöffnet', auf), ...zeiten.knoten, knopfSpeichern());
  });
  boxen.rahmen.replaceChildren(abschnitt('Öffnungs- und Rahmenzeiten', ...zeilen));
}

// Zeiten für einen neu geöffneten Feiertag: die des Wochentags, sonst die des ersten geöffneten Tags.
function vorlageZeiten(datumIso) {
  const wochentag = ((new Date(`${datumIso}T12:00:00`).getDay() + 6) % 7) + 1;
  const tag = daten.rahmen.find((r) => r.wochentag === wochentag && r.geoeffnet) || daten.rahmen.find((r) => r.geoeffnet);
  if (!tag) return {};
  return {
    oeffnung_von: uhrzeit(tag.oeffnung_von), oeffnung_bis: uhrzeit(tag.oeffnung_bis),
    rahmen_von: uhrzeit(tag.rahmen_von), rahmen_bis: uhrzeit(tag.rahmen_bis),
  };
}

function zeichneAbweichungen() {
  const zuJahr = daten.abweichungen.filter((a) => String(a.datum).startsWith(`${jahr}-`));
  const belegt = new Set(daten.abweichungen.map((a) => tagIso(a.datum)));
  const jahrFeld = eingabeBasis('number', jahr, { step: '1', min: '2000', max: '2100' });
  jahrFeld.addEventListener('change', async () => {
    const neu = Number(jahrFeld.value);
    if (!Number.isInteger(neu) || neu < 2000 || neu > 2100) { jahrFeld.value = jahr; return; }
    try {
      feiertage = await aufruf('pep_feiertage', { p_jahr: neu });
      jahr = neu;
      zeichneAbweichungen();
    } catch (fehler) {
      if (!fehler.behandelt) meldung(fehlerText(fehler.message));
      jahrFeld.value = jahr;
    }
  });

  const offene = feiertage.filter((f) => !belegt.has(tagIso(f.datum))).map((f) => {
    const iso = tagIso(f.datum);
    return element('div', { class: 'zeile grau' },
      element('strong', { class: 'zeilentitel' }, `${datumDE(iso)} · ${f.name}`),
      element('span', {}, 'gesetzlicher Feiertag, geschlossen'),
      knopf('öffnen …', () => speichere(() => aufruf('pep_abweichung_speichern', {
        p_datum: iso, p_daten: { art: 'feiertag', geoeffnet: true, name: f.name, ...vorlageZeiten(iso) },
      }), 'abweichungen')));
  });

  const zeile = (a) => {
    const neu = !a.datum;
    const tag = eingabe('date', neu ? '' : tagIso(a.datum), { required: true, disabled: !neu || !darfSchreiben() });
    const art = auswahlfeld(ARTEN_ABWEICHUNG, a.art ?? 'sonstiges');
    const auf = eingabe('checkbox', neu ? true : a.geoeffnet);
    const zeiten = zeitfelder(a);
    const name = eingabe('text', a.name);
    return zeilenformular(
      () => speichere(() => aufruf('pep_abweichung_speichern', {
        p_datum: tag.value || null,
        p_daten: { art: art.value, geoeffnet: auf.checked, name: name.value || null, ...zeiten.lesen(auf.checked) },
      }), 'abweichungen'),
      feld(neu ? 'Neue Abweichung am …' : 'Datum', tag), feld('Art', art), haken('geöffnet', auf),
      ...zeiten.knoten, feld('Name', name), knopfSpeichern(neu ? 'Anlegen' : 'Speichern'),
      neu ? null : knopf('Löschen', () => speichere(
        () => aufruf('pep_abweichung_loeschen', { p_datum: tagIso(a.datum) }), 'abweichungen')));
  };
  boxen.abweichungen.replaceChildren(abschnitt('Abweichende Tage',
    feld('Jahr', jahrFeld),
    element('h3', {}, 'Gesetzliche Feiertage'),
    offene.length ? offene : element('p', { class: 'hinweis' }, 'Alle Feiertage dieses Jahres sind unten als Abweichung angelegt.'),
    element('h3', {}, `Abweichungen ${jahr}`),
    zuJahr.map(zeile), darfSchreiben() ? zeile({}) : null));
}

// ---------------------------------------------------------------- Bereiche und Codes

function zeichneBereiche() {
  const zeile = (b) => {
    const neu = !b.id;
    const kuerzel = eingabe('text', b.kuerzel, { maxlength: '3', required: true });
    const name = eingabe('text', b.name, { required: true });
    const f = farbe(b.farbe);
    const art = neu ? auswahlfeld(ARTEN_BEREICH, 'bereich')
      : auswahlBasis([...ARTEN_BEREICH, ['pause', 'Pause']], b.art, { disabled: true });
    const aktiv = eingabe('checkbox', neu ? true : b.aktiv);
    const kompetenz = eingabe('checkbox', b.kompetenz_noetig);
    return zeilenformular(
      () => speichere(() => aufruf('pep_bereich_speichern', {
        p_id: b.id ?? null,
        p_daten: {
          kuerzel: kuerzel.value, name: name.value, farbe: f.value, kompetenz_noetig: kompetenz.checked,
          aktiv: aktiv.checked, ...(neu ? { art: art.value } : {}),
        },
      }), 'bereiche'),
      feld('Kürzel', kuerzel), feld('Name', name), feld('Farbe', f), feld('Art', art),
      haken('aktiv', aktiv), haken('Kompetenz nötig', kompetenz), knopfSpeichern(neu ? 'Anlegen' : 'Speichern'));
  };
  boxen.bereiche.replaceChildren(abschnitt('Abteilungen und Bereiche',
    daten.bereiche.map(zeile), darfSchreiben() ? zeile({}) : null));
}

// ---------------------------------------------------------------- Lieferung (Warengruppen und Liefermuster)

function zeichneWarengruppen() {
  const bereichAktiv = (id) => daten.bereiche.find((b) => b.id === id)?.aktiv;
  const zeile = (g) => {
    const neu = !g.id;
    // Aktive Bereiche; der Bereich einer vorhandenen Gruppe bleibt auch dann wählbar, wenn er inzwischen inaktiv ist.
    const optionen = daten.bereiche.filter((b) => b.art === 'bereich' && (b.aktiv || b.id === g.bereich_id))
      .map((b) => [b.id, `${b.kuerzel} – ${b.name}`]);
    const name = eingabe('text', g.name, { required: true });
    const bereich = auswahlfeld(optionen, g.bereich_id ?? optionen[0]?.[0]);
    const minuten = eingabe('number', g.minuten ?? 30, { min: '1', max: '240', step: '1' });
    const aktiv = eingabe('checkbox', neu ? true : g.aktiv);
    return zeilenformular(
      () => speichere(() => aufruf('pep_warengruppe_speichern', {
        p_id: g.id ?? null,
        p_daten: { name: name.value, bereich_id: Number(bereich.value), minuten: zahl(minuten.value), aktiv: aktiv.checked },
      }), 'warengruppen', 'liefermuster'),
      feld('Name', name), feld('Bereich', bereich), feld('Minuten je Rolli', minuten), haken('aktiv', aktiv),
      knopfSpeichern(neu ? 'Anlegen' : 'Speichern'),
      !neu && bereichAktiv(g.bereich_id) === false ? element('small', { class: 'hinweis-gelb' }, 'Bereich inaktiv – zählt nicht') : null);
  };
  boxen.warengruppen.replaceChildren(abschnitt('Warengruppen',
    element('p', { class: 'hinweis' }, 'Jede Warengruppe gehört zu einem Bereich; die Minuten gelten je Rolli.'),
    daten.warengruppen.map(zeile), darfSchreiben() ? zeile({}) : null));
}

function zeichneLiefermuster() {
  const tage = daten.rahmen.filter((r) => r.geoeffnet);
  const gruppen = daten.warengruppen.filter((g) => g.aktiv);
  const lkw = daten.liefer_muster?.lkw ?? {};
  const rollis = new Map((daten.liefer_muster?.rollis ?? []).map((r) => [`${r.warengruppe_id}-${r.wochentag}`, r.rollis]));
  // Speichert beim Verlassen des Feldes; bei Fehler zeigt das Feld wieder den gespeicherten Wert.
  const zelle = (e, vorher, aktion) => {
    e.addEventListener('change', async () => {
      const ok = await speichere(aktion, 'liefermuster');
      if (ok === undefined && e.isConnected) e.value = vorher ?? '';
    });
    return element('td', {}, e);
  };
  const kopf = element('tr', {}, element('th', {}, ''), ...tage.map((r) => element('th', {}, WOCHENTAGE[r.wochentag - 1])));
  const lkwZeile = element('tr', {}, element('th', { scope: 'row' }, 'LKW-Zeit'),
    ...tage.map((r) => {
      const e = eingabe('time', lkw[r.wochentag], { step: '1800', 'aria-label': `LKW ${WOCHENTAGE[r.wochentag - 1]}` });
      return zelle(e, lkw[r.wochentag], () => aufruf('pep_liefer_muster_setzen',
        { p_wochentag: r.wochentag, p_daten: { lkw: e.value || null } }));
    }));
  const zeilen = gruppen.map((g) => element('tr', {}, element('th', { scope: 'row' }, g.name),
    ...tage.map((r) => {
      const wert = rollis.get(`${g.id}-${r.wochentag}`);
      const e = eingabe('number', wert, { min: '0', max: '99', step: '1', placeholder: '0',
        'aria-label': `Rollis ${g.name} ${WOCHENTAGE[r.wochentag - 1]}` });
      return zelle(e, wert, () => aufruf('pep_liefer_muster_setzen',
        { p_wochentag: r.wochentag, p_daten: { rollis: { [g.id]: e.value === '' ? 0 : zahl(e.value) } } }));
    })));
  boxen.liefermuster.replaceChildren(abschnitt('Liefermuster',
    element('p', { class: 'hinweis' }, 'Rollis je Warengruppe und Wochentag; leer = 0. Einzelne Tage ändert man im Einsatzplan.'),
    gruppen.length ? element('div', { class: 'tabelle-scroll' }, element('table', { class: 'liefermuster' }, kopf, lkwZeile, ...zeilen))
      : element('p', { class: 'hinweis' }, 'Noch keine aktive Warengruppe.')));
}

// Nach dem ersten Wochenabschluss: gutschrift und sperrt ändern auch abgeschlossene Wochen (die Datenbank bucht
// Korrekturen, pep.nachbuchen_codes). Der Hinweis steht über den Codes und, wenn sich einer der beiden Haken
// tatsächlich geändert hat, noch einmal in der Bestätigung.
const KORREKTUR_HINWEIS = 'Ändert die Wirkung in schon abgeschlossenen Wochen – das Zeitkonto bucht dann automatisch Korrekturen.';
// Nicht sperrender Code mit Gutschrift: IST am selben Tag ist erlaubt und zählt, die Abwesenheit zählt dazu.
const DOPPELT_HINWEIS = 'Achtung: Nicht sperrender Code mit Gutschrift – an Tagen mit IST zählt der Tag doppelt.';

function zeichneCodes() {
  const zeile = (c) => {
    const neu = !c.id;
    const code = eingabe('text', c.code, { maxlength: '3', required: true });
    const name = eingabe('text', c.name, { required: true });
    const f = farbe(c.farbe);
    const regel = auswahlfeld(STUNDENREGELN, c.stundenregel ?? 'teiler');
    const sperrt = eingabe('checkbox', neu ? true : c.sperrt);
    const aktiv = eingabe('checkbox', neu ? true : c.aktiv);
    const gutschrift = eingabe('checkbox', neu ? true : c.gutschrift);
    // Neuer Code: Gutschrift folgt „sperrt“ (Vorgabe wie pep_code_speichern), danach frei wählbar.
    if (neu) sperrt.addEventListener('change', () => { gutschrift.checked = sperrt.checked; });
    return zeilenformular(
      async () => {
        const wirkt = !neu && daten.abschluss_vorhanden
          && (gutschrift.checked !== c.gutschrift || sperrt.checked !== c.sperrt);
        const ok = await speichere(() => aufruf('pep_code_speichern', {
          p_id: c.id ?? null,
          p_daten: {
            code: code.value, name: name.value, farbe: f.value, stundenregel: regel.value,
            sperrt: sperrt.checked, aktiv: aktiv.checked, gutschrift: gutschrift.checked,
          },
        }), 'codes');
        if (ok && wirkt) meldung(`Gespeichert. ${KORREKTUR_HINWEIS}`, 'ok');
      },
      feld('Code', code), feld('Name', name), feld('Farbe', f), feld('Stundenregel', regel),
      haken('sperrt', sperrt), haken('aktiv', aktiv), haken('Gutschrift im Zeitkonto', gutschrift),
      knopfSpeichern(neu ? 'Anlegen' : 'Speichern'),
      !neu && !c.sperrt && c.gutschrift ? element('p', { class: 'hinweis-gelb code-doppelt' }, DOPPELT_HINWEIS) : null);
  };
  boxen.codes.replaceChildren(abschnitt('Abwesenheitscodes',
    element('p', { class: 'hinweis' }, '„Gutschrift im Zeitkonto“: Die Abwesenheit zählt im Zeitkonto als geleistete Zeit. ',
      'Ohne Haken zählt sie nicht – so beim Zeitausgleich (ZA), der Stunden aus dem Zeitkonto abbaut.'),
    daten.abschluss_vorhanden
      ? element('p', { class: 'hinweis-gelb' }, '„Gutschrift im Zeitkonto“ und „sperrt“: ', KORREKTUR_HINWEIS) : null,
    daten.codes.map(zeile), darfSchreiben() ? zeile({}) : null));
  boxen.codes.firstChild.classList.add('codes'); // drei Haken: schmal, damit „Speichern“ bei 1440 px in der Zeile bleibt
}

// ---------------------------------------------------------------- Regelparameter

// Teiler, deren Änderung abgeschlossene Wochen nachbucht (Abwesenheitsstunden bzw. Feiertagsgutschrift neu gerechnet).
const NACHBUCHENDE_PARAMETER = ['abwesenheit_teiler', 'feiertag_teiler'];

function zeichneParameter() {
  const zeilen = Object.entries(PARAMETER).map(([schluessel, [beschriftung, art, erklaerung]]) => {
    const zeit = art === 'zeit';
    const e = zeit ? eingabe('time', daten.werte[schluessel], { step: '1800' })
      : eingabe('number', daten.werte[schluessel], { step: String(art), min: '0' });
    e.addEventListener('change', async () => {
      const wert = zeit ? e.value : zahl(e.value);
      const wirkt = daten.abschluss_vorhanden && NACHBUCHENDE_PARAMETER.includes(schluessel);
      const ok = await speichere(
        () => aufruf('pep_einstellung_setzen', { p_schluessel: schluessel, p_wert: wert }), 'parameter');
      // Bei Fehler bleibt der Abschnitt stehen: Feld zeigt wieder den gespeicherten Wert.
      if (ok === undefined && e.isConnected) e.value = daten.werte[schluessel] ?? '';
      if (ok && wirkt) meldung(`Gespeichert. ${KORREKTUR_HINWEIS}`, 'ok');
    });
    return element('div', { class: 'zeile' }, feld(beschriftung, e),
      element('small', { class: 'hinweis erklaerung' }, erklaerung));
  });
  boxen.parameter.replaceChildren(abschnitt('Regelparameter',
    daten.abschluss_vorhanden
      ? element('p', { class: 'hinweis-gelb' }, 'Abwesenheits- und Feiertags-Teiler: ', KORREKTUR_HINWEIS) : null,
    ...zeilen));
}

// ---------------------------------------------------------------- IST-Erfassung (Stufe 2)

// Start der IST-Erfassung (Einstellung ist_ab, ein Montag): davor keine offenen Tage und kein Wochenabschluss.
// Nach dem ersten Wochenabschluss fest (IST_AB_FEST): das Feld ist dann nur lesbar.
function zeichneIst() {
  const fest = Boolean(daten.abschluss_vorhanden);
  const ab = eingabe('date', daten.werte.ist_ab ?? '', { required: true, ...(fest ? { disabled: true } : {}) });
  ab.addEventListener('change', async () => {
    if (!ab.value) { ab.value = daten.werte.ist_ab ?? ''; return; }
    const ok = await speichere(
      () => aufruf('pep_einstellung_setzen', { p_schluessel: 'ist_ab', p_wert: ab.value }), 'ist');
    if (ok === undefined && ab.isConnected) ab.value = daten.werte.ist_ab ?? ''; // Fehler: gespeicherter Wert
  });
  boxen.ist.replaceChildren(abschnitt('IST-Erfassung',
    element('div', { class: 'zeile' }, feld('IST-Erfassung ab (Montag)', ab),
      element('small', { class: 'hinweis erklaerung' },
        'Tage davor gelten nicht als offen und werden nicht abgeschlossen. Startsalden zum Sonntag davor im Journal eintragen.')),
    fest ? element('p', { class: 'hinweis-gelb' }, fehlerText('IST_AB_FEST')) : null));
}

// ---------------------------------------------------------------- Schulferien

function zeichneSchulferien() {
  const zeilen = daten.schulferien.map((s) => element('div', { class: 'zeile' },
    element('strong', { class: 'zeilentitel' }, `${datumDE(s.von)} – ${datumDE(s.bis)}`), element('span', {}, s.name),
    knopf('Löschen', () => speichere(() => aufruf('pep_schulferien_loeschen', { p_id: s.id }), 'schulferien'))));
  const von = eingabe('date', '', { required: true });
  const bis = eingabe('date', '', { required: true });
  const name = eingabe('text', '', { required: true });
  const formular = darfSchreiben() ? zeilenformular(
    () => speichere(() => aufruf('pep_schulferien_speichern',
      { p_id: null, p_von: von.value || null, p_bis: bis.value || null, p_name: name.value }), 'schulferien'),
    feld('Neu: von', von), feld('bis', bis), feld('Name', name), knopfSpeichern('Anlegen')) : null;
  boxen.schulferien.replaceChildren(abschnitt('Schulferien', zeilen, formular));
}

// ---------------------------------------------------------------- Urlaubstool

function zeichneUrlaub() {
  const umfrageZeilen = umfragen.map((u) => {
    const kasten = eingabe('checkbox', u.aktiv);
    kasten.addEventListener('change', async () => {
      kasten.disabled = true;
      const ok = await speichereUrlaub(() => aufruf('pep_urlaub_umfrage_schalten',
        { p_umfrage_id: u.id, p_aktiv: kasten.checked }));
      if (ok === undefined) { kasten.checked = u.aktiv; kasten.disabled = !darfSchreiben(); }
    });
    return element('div', { class: 'zeile' },
      element('strong', { class: 'zeilentitel' }, `${u.titel} (${u.jahr})`),
      element('span', { class: 'hinweis' }, `${u.eigene ? 'eigene Umfrage' : `von ${u.organisator ?? '–'}`} · `
        + `Bundesland ${u.bundesland} · Frist ${u.frist ? datumDE(u.frist) : '–'} · ${u.abgaben} von ${u.teilnehmer} haben abgegeben`),
      haken('aktiv', kasten));
  });

  const optionen = [['', '— keine Zuordnung —'], ...mitarbeiter.map((m) => [String(m.id), m.name])];
  const offen = zuordnung.filter((z) => !z.mitarbeiter_id && z.vorschlag_id);
  const zugeordnet = zuordnung.filter((z) => z.mitarbeiter_id).length;
  // Nicht zugeordnete zuerst, sonst in der Reihenfolge der Datenbank (Umfrage, Name)
  const sortiert = [...zuordnung.filter((z) => !z.mitarbeiter_id), ...zuordnung.filter((z) => z.mitarbeiter_id)];
  const zuordnungsZeilen = sortiert.map((z) => {
    const wahl = auswahlfeld(optionen, z.mitarbeiter_id ?? z.vorschlag_id ?? '');
    return zeilenformular(
      () => speichereUrlaub(() => aufruf('pep_urlaub_zuordnung_setzen', {
        p_urlaub_mitarbeiter_id: z.urlaub_mitarbeiter_id, p_mitarbeiter_id: wahl.value ? Number(wahl.value) : null,
      })),
      element('strong', { class: 'zeilentitel' }, z.name), element('span', { class: 'hinweis' }, z.umfrage_titel),
      feld('PEP-Mitarbeiter', wahl),
      !z.mitarbeiter_id && z.vorschlag_id ? element('span', { class: 'hinweis' }, 'Vorschlag (noch nicht gespeichert)') : null,
      knopfSpeichern());
  });
  const uebernehmen = offen.length ? knopf(`Vorschläge übernehmen (${offen.length})`, () => speichereUrlaub(async () => {
    for (const z of offen) {
      await aufruf('pep_urlaub_zuordnung_setzen',
        { p_urlaub_mitarbeiter_id: z.urlaub_mitarbeiter_id, p_mitarbeiter_id: z.vorschlag_id });
    }
  })) : null;
  let teilnehmer;
  if (!umfragen.some((u) => u.aktiv)) {
    teilnehmer = element('p', { class: 'hinweis' }, 'Zuerst oben eine Umfrage einschalten – dann erscheinen hier ihre Teilnehmer.');
  } else if (!zuordnungsZeilen.length) {
    teilnehmer = element('p', { class: 'hinweis' }, 'Keine Teilnehmer vorhanden.');
  } else {
    const kopf = element('p', { class: 'urlaub-zaehler' }, element('strong', {}, `${zugeordnet} von ${zuordnung.length} zugeordnet`));
    teilnehmer = [kopf, uebernehmen, ...zuordnungsZeilen];
  }
  boxen.urlaub.replaceChildren(abschnitt('Urlaubstool',
    element('h3', {}, 'Umfragen'),
    umfrageZeilen.length ? umfrageZeilen : element('p', { class: 'hinweis' }, 'Keine Umfragen vorhanden.'),
    element('h3', {}, 'Teilnehmer zuordnen'),
    element('p', { class: 'hinweis' }, 'Jeder Teilnehmer der Umfrage wird einem PEP-Mitarbeiter zugeordnet; '
      + 'erst dann erscheinen seine Wünsche unter Abwesenheiten zum Freigeben.'),
    teilnehmer));
}

// ---------------------------------------------------------------- Benutzer

function zeichneBenutzer() {
  const zeile = (b) => {
    const rolle = auswahlfeld(ROLLEN, b.rolle);
    return zeilenformular(
      () => speichere(() => aufruf('pep_benutzer_setzen', { p_benutzername: b.benutzername, p_rolle: rolle.value }), 'benutzer'),
      element('strong', { class: 'zeilentitel' }, `${b.benutzername} · ${b.anzeigename}`,
        // Umfragen einer Leitung erscheinen unter Urlaubstool erst nach ihrer ersten eigenen Anmeldung
        b.angemeldet === false ? element('span', { class: 'hinweis' }, ' · noch nicht angemeldet') : null),
      feld('Rolle', rolle), knopfSpeichern(),
      knopf('Entfernen', () => speichere(() => aufruf('pep_benutzer_entfernen', { p_user_id: b.user_id }), 'benutzer')));
  };
  const name = eingabe('text', '', { required: true, autocomplete: 'off' });
  const rolle = auswahlfeld(ROLLEN, 'stellvertretung');
  const formular = darfSchreiben() ? zeilenformular(
    () => speichere(() => aufruf('pep_benutzer_setzen', { p_benutzername: name.value.trim(), p_rolle: rolle.value }), 'benutzer'),
    feld('Neu: Benutzername', name), feld('Rolle', rolle), knopfSpeichern('Hinzufügen')) : null;
  boxen.benutzer.replaceChildren(abschnitt('Benutzer', daten.benutzer.map(zeile), formular));
}

// ---------------------------------------------------------------- Sicherung (Stufe 2, nur Leitung)

function zeichneSicherungAbschnitt() {
  if (!darfSchreiben()) { boxen.sicherung.replaceChildren(); return; }
  zeichneSicherung(boxen.sicherung, {
    aufruf,
    abschnitt,
    // Nach dem Einspielen: Kopfzeile (Name der Filiale) und die übrigen Abschnitte neu; das Ergebnis bleibt stehen.
    nachEinspielen: async () => {
      await aktualisiereIch();
      await Promise.all([ladeDaten(), ladeUrlaub()]);
      for (const [name, zeichne] of Object.entries(ZEICHNER)) if (name !== 'sicherung') zeichne();
    },
  });
}

// Alle Abschnitte; Reihenfolge und Zuordnung zu den Unterreitern stehen in TEILE.
const ZEICHNER = {
  rahmen: zeichneRahmen, abweichungen: zeichneAbweichungen, bereiche: zeichneBereiche, codes: zeichneCodes,
  warengruppen: zeichneWarengruppen, liefermuster: zeichneLiefermuster,
  parameter: zeichneParameter, ist: zeichneIst, schulferien: zeichneSchulferien, urlaub: zeichneUrlaub, benutzer: zeichneBenutzer,
  sicherung: zeichneSicherungAbschnitt,
};

reiter.einstellungen = { zeigen };

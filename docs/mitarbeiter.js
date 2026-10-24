// Reiter „Mitarbeiter“: Liste links, Karte rechts. Jede Aktion ruft die Datenbankfunktion
// sofort auf und lädt danach Liste und Karte neu.
import {
  $, meldung, fehlerText, element, stundenDE, WOCHENTAGE,
  zahl, text, datum, uhrzeit, feld, eingabe as eingabeBasis, auswahlfeld as auswahlBasis,
  zeilenformular, abschnitt, fuehreAus,
} from './hilfe.js';
import { aufruf, ich, reiter } from './app.js';

const VERTRAGSARTEN = {
  vollzeit: 'Vollzeit', teilzeit: 'Teilzeit', minijob: 'Minijob', azubi: 'Azubi', fuehrung: 'F (Führungskraft)',
};
const ARTEN = { nicht_verfuegbar: 'Nicht verfügbar', nur_zwischen: 'Nur zwischen …' };

let liste = [];
let bereiche = [];
let auswahl = null; // Mitarbeiter-ID, 'neu' oder null
let karte = null;

const darfSchreiben = () => ich?.rolle === 'leitung';
const vertragsText = (m) => (m.vertragsart
  ? `${VERTRAGSARTEN[m.vertragsart]} · ${stundenDE(m.wochenstunden).replace(',00', ',0')} h` : 'kein Vertrag');

// ---------------------------------------------------------------- Ablauf

function fehlerMelden(fehler) {
  if (!fehler.behandelt) meldung(fehlerText(fehler.message));
}

// Führt eine schreibende Aktion aus, zeigt „Gespeichert.“ und lädt Liste und Karte neu.
const speichere = (aktion) => fuehreAus(aktion, async () => {
  await ladeListe();
  if (auswahl !== 'neu') await ladeKarte();
});

async function ladeListe() {
  liste = await aufruf('pep_mitarbeiter_liste');
  if (auswahl !== 'neu' && !liste.some((m) => m.id === auswahl)) { auswahl = null; karte = null; }
  zeichneListe();
}

async function ladeKarte() {
  karte = auswahl && auswahl !== 'neu' ? await aufruf('pep_mitarbeiter', { p_id: auswahl }) : null;
  zeichneKarte();
}

async function waehle(id) {
  auswahl = id;
  meldung('');
  zeichneListe();
  try { await ladeKarte(); } catch (fehler) { fehlerMelden(fehler); }
}

async function zeigen() {
  bereiche = await aufruf('pep_bereiche');
  await ladeListe();
  if (!auswahl && liste.length) auswahl = liste[0].id;
  zeichneListe();
  await ladeKarte();
}

// ---------------------------------------------------------------- Liste

function zeichneListe() {
  const knoten = [];
  if (darfSchreiben()) {
    knoten.push(element('button', { type: 'button', class: 'knopf primaer', onclick: neuer }, 'Neuer Mitarbeiter'));
  }
  const eintraege = liste.map((m) => element('li', {},
    element('button', {
      type: 'button',
      class: `ma-eintrag${m.id === auswahl ? ' gewaehlt' : ''}${m.aktiv ? '' : ' inaktiv'}`,
      onclick: () => waehle(m.id),
    },
    element('span', { class: 'ma-name' }, m.name,
      m.kompetenzen.map((k) => element('span', { class: 'badge' }, k))),
    element('small', {}, vertragsText(m)))));
  knoten.push(element('ul', { class: 'ma-liste' }, eintraege));
  if (!liste.length) knoten.push(element('p', { class: 'hinweis' }, 'Noch keine Mitarbeiter.'));
  $('ma-liste').replaceChildren(...knoten);
}

function neuer() {
  auswahl = 'neu';
  karte = null;
  meldung('');
  zeichneListe();
  zeichneKarte();
}

// ---------------------------------------------------------------- Karte

const eingabe = (typ, wert, attrs = {}) => eingabeBasis(typ, wert, { disabled: !darfSchreiben(), ...attrs });
const auswahlfeld = (optionen, wert) => auswahlBasis(optionen, wert, { disabled: !darfSchreiben() });

const knopfSpeichern = (beschriftung = 'Speichern') =>
  darfSchreiben() ? element('button', { type: 'submit' }, beschriftung) : null;

function loeschknopf(aktion) {
  return darfSchreiben()
    ? element('button', { type: 'button', class: 'knopf', onclick: aktion }, 'Löschen') : null;
}

function zeichneKarte() {
  const ziel = $('ma-karte');
  if (auswahl === 'neu') {
    ziel.replaceChildren(stammdaten({ aktiv: true }));
  } else if (!karte) {
    ziel.replaceChildren(element('div', { class: 'box' }, element('p', {}, 'Bitte einen Mitarbeiter wählen.')));
  } else {
    ziel.replaceChildren(stammdaten(karte), vertraege(), kompetenzen(), wochenvorgaben(), urlaubsjahre());
  }
}

// ---- Stammdaten

function stammdaten(m) {
  const name = eingabe('text', m.name, { required: true });
  const nummer = eingabe('text', m.personalnummer);
  const geburt = eingabe('date', datum(m.geburtsdatum));
  const eintritt = eingabe('date', datum(m.eintritt));
  const austritt = eingabe('date', datum(m.austritt));
  const aktiv = eingabe('checkbox', m.aktiv);
  const notiz = element('textarea', { rows: 3, disabled: !darfSchreiben() });
  notiz.value = text(m.notiz);
  const senden = async () => {
    const daten = {
      name: name.value, personalnummer: nummer.value, geburtsdatum: geburt.value || null,
      eintritt: eintritt.value || null, austritt: austritt.value || null,
      aktiv: aktiv.checked, notiz: notiz.value,
    };
    const id = await speichere(() => aufruf('pep_mitarbeiter_speichern', { p_id: m.id ?? null, p_daten: daten }));
    if (id && auswahl === 'neu') await waehle(id);
  };
  return abschnitt(m.id ? 'Stammdaten' : 'Neuer Mitarbeiter',
    zeilenformular(senden,
      feld('Name (Nachname, Vorname)', name), feld('Personalnummer', nummer),
      feld('Geburtsdatum', geburt), feld('Eintritt', eintritt), feld('Austritt', austritt),
      element('label', { class: 'feld haken' }, aktiv, ' Aktiv'),
      element('label', { class: 'feld breit' }, 'Notiz', notiz),
      knopfSpeichern()));
}

// ---- Verträge

function vertraege() {
  const zeile = (v) => {
    const ab = eingabe('date', datum(v.gueltig_ab), { required: true });
    const art = auswahlfeld(Object.entries(VERTRAGSARTEN), v.vertragsart ?? 'vollzeit');
    const std = eingabe('number', v.wochenstunden, { step: '0.5', min: '0', max: '60' });
    const grenze = eingabe('number', v.zeitkonto_grenze, { step: '0.5' });
    const senden = () => speichere(() => aufruf('pep_vertrag_speichern', {
      p_mitarbeiter_id: karte.id,
      p_daten: {
        id: v.id ?? null, gueltig_ab: ab.value, vertragsart: art.value,
        wochenstunden: zahl(std.value), zeitkonto_grenze: zahl(grenze.value),
      },
    }));
    return zeilenformular(senden,
      feld(v.id ? 'Gültig ab' : 'Neuer Vertrag ab …', ab), feld('Vertragsart', art),
      feld('Wochenstunden', std), feld('Zeitkonto-Grenze (h)', grenze),
      knopfSpeichern(v.id ? 'Speichern' : 'Vertrag anlegen'),
      v.id ? loeschknopf(() => speichere(() => aufruf('pep_vertrag_loeschen', { p_id: v.id }))) : null);
  };
  return abschnitt('Verträge', karte.vertraege.map(zeile), darfSchreiben() ? zeile({}) : null);
}

// ---- Kompetenzen

function kompetenzen() {
  const waehlbar = bereiche.filter((b) => b.aktiv && (b.kompetenz_noetig || b.art === 'funktion'));
  const haken = waehlbar.map((b) => {
    const kasten = eingabe('checkbox', karte.kompetenzen.includes(b.id));
    kasten.addEventListener('change', async () => {
      kasten.disabled = true;
      let gespeichert = false;
      await speichere(async () => {
        await aufruf('pep_kompetenz_setzen',
          { p_mitarbeiter_id: karte.id, p_bereich_id: b.id, p_aktiv: kasten.checked });
        gespeichert = true;
      });
      if (!gespeichert) kasten.checked = !kasten.checked; // Fehler: Haken zeigt wieder den Stand der Datenbank
      kasten.disabled = !darfSchreiben();
    });
    return element('label', { class: 'haken' }, kasten, ` ${b.name} (${b.kuerzel})`);
  });
  return abschnitt('Kompetenzen', element('div', { class: 'haken-liste' }, haken));
}

// ---- Wochenvorgaben

function wochenvorgaben() {
  const zeile = (w) => {
    const tag = auswahlfeld([['', 'alle Tage'], ...WOCHENTAGE.map((t, i) => [String(i + 1), t])], w.wochentag);
    const art = auswahlfeld(Object.entries(ARTEN), w.art ?? 'nicht_verfuegbar');
    const von = eingabe('time', uhrzeit(w.von), { step: '1800' });
    const bis = eingabe('time', uhrzeit(w.bis), { step: '1800' });
    const zeiten = element('div', { class: 'zeiten' }, feld('Von', von), feld('Bis', bis));
    const zeitenAnzeigen = () => { zeiten.hidden = art.value !== 'nur_zwischen'; };
    art.addEventListener('change', zeitenAnzeigen);
    zeitenAnzeigen();
    const tagMax = eingabe('number', w.max_stunden_tag, { step: '0.5', min: '0' });
    const wocheMax = eingabe('number', w.max_stunden_woche, { step: '0.5', min: '0' });
    const pflicht = eingabe('checkbox', w.pflicht);
    const vonDatum = eingabe('date', datum(w.gueltig_von), { required: true });
    const bisDatum = eingabe('date', datum(w.gueltig_bis));
    const notiz = eingabe('text', w.notiz);
    const senden = () => speichere(() => aufruf('pep_wochenvorgabe_speichern', {
      p_mitarbeiter_id: karte.id,
      p_daten: {
        id: w.id ?? null, gueltig_von: vonDatum.value, gueltig_bis: bisDatum.value || null,
        pflicht: pflicht.checked, wochentag: tag.value ? Number(tag.value) : null, art: art.value,
        von: art.value === 'nur_zwischen' ? von.value || null : null,
        bis: art.value === 'nur_zwischen' ? bis.value || null : null,
        max_stunden_tag: zahl(tagMax.value), max_stunden_woche: zahl(wocheMax.value),
        notiz: notiz.value || null,
      },
    }));
    return zeilenformular(senden,
      element('strong', { class: 'zeilentitel' }, w.id ? 'Vorgabe' : 'Neue Vorgabe'),
      feld('Wochentag', tag), feld('Art', art), zeiten,
      feld('Max. Stunden pro Tag', tagMax), feld('Max. Stunden pro Woche', wocheMax),
      feld('Gültig von', vonDatum), feld('Gültig bis', bisDatum), feld('Notiz', notiz),
      element('label', { class: 'feld haken' }, pflicht, ' Pflicht'),
      knopfSpeichern(w.id ? 'Speichern' : 'Vorgabe anlegen'),
      w.id ? loeschknopf(() => speichere(() => aufruf('pep_wochenvorgabe_loeschen', { p_id: w.id }))) : null);
  };
  return abschnitt('Wochenvorgaben', karte.wochenvorgaben.map(zeile), darfSchreiben() ? zeile({}) : null);
}

// ---- Urlaubsjahre

function urlaubsjahre() {
  const zeile = (u) => {
    const jahr = eingabe('number', u.jahr ?? new Date().getFullYear() + 1, { step: '1', min: '2000', max: '2100' });
    if (u.jahr) jahr.disabled = true;
    const anspruch = eingabe('number', u.anspruch_stunden, { step: '0.5', min: '0' });
    const rest = eingabe('number', u.rest_vorjahr_stunden ?? 0, { step: '0.5', min: '0' });
    const senden = () => speichere(() => aufruf('pep_urlaubsjahr_speichern', {
      p_mitarbeiter_id: karte.id, p_jahr: Number(jahr.value),
      p_anspruch: zahl(anspruch.value), p_rest_vorjahr: zahl(rest.value),
    }));
    return zeilenformular(senden, feld('Jahr', jahr), feld('Anspruch (h)', anspruch),
      feld('Rest Vorjahr (h)', rest), knopfSpeichern(u.jahr ? 'Speichern' : 'Jahr anlegen'));
  };
  return abschnitt('Urlaubsjahre', karte.urlaubsjahre.map(zeile), darfSchreiben() ? zeile({}) : null);
}

reiter.mitarbeiter = { zeigen };

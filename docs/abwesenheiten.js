// Reiter „Abwesenheiten“: Monatsraster mit Palette, Ziehen per Pointer-Events, Wiederholungen,
// Urlaubswünsche (Genehmigen/Ablehnen/Zurücknehmen) und Übersicht „Urlaub <Jahr>“ unter dem Raster.
import {
  $, meldung, fehlerText, element, datumDE, stundenDE, WOCHENTAGE, textfarbe,
  zahl, feld, eingabe, auswahlfeld,
} from './hilfe.js';
import { aufruf, ich, reiter } from './app.js';
import { dialog } from './dialog.js';
import {
  wochenGruppen, ziehBereich, monatVorZurueck, zellenKlasse, stundenAnzeige, kurzStunden,
} from './kalender.js';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const HINWEIS_WUNSCH_GEAENDERT = 'Wunsch im Urlaubstool geändert oder zurückgezogen';
const STANDARD_TEILER = 6;

const MIN_SPALTE_PX = 34; // Tagesspalte; reicht die Breite nicht, scrollt nur der Raster-Container
const NAME_SPALTE_PX = 200;

// Adresse: ?jahr=2026&monat=11 wählt den Startmonat, ?heute=JJJJ-MM-TT nur die Markierung „heute“
// (beides für die Vorschau mit festen Daten). Ohne Angabe gilt das heutige Datum.
const adresse = new URLSearchParams(location.search);
const ganzzahl = (name, min, max) => {
  const n = Number(adresse.get(name));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const jetzt = new Date();
const heuteIso = /^\d{4}-\d{2}-\d{2}$/.test(adresse.get('heute') ?? '') ? adresse.get('heute')
  : `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
let jahr = ganzzahl('jahr', 2000, 2100) ?? Number(heuteIso.slice(0, 4));
let monat = ganzzahl('monat', 1, 12) ?? Number(heuteIso.slice(5, 7));
let daten = null; // Antwort von pep_abwesenheiten
let teiler = STANDARD_TEILER;
let wahl = 'ansehen'; // 'ansehen' | 'keine' | Code-Id als Text
let mitUhrzeit = false;
let zug = null; // laufendes Ziehen: { mitarbeiter, zeile, start, ende, pointerId }
const rahmen = {}; // Container: kopf (Werkzeugleiste), raster, seite (Urlaubsübersicht)
let hoverDatum = null; // Datum der Spalte unter dem Zeiger (Klasse spalte-hover)

const darfZeichnen = () => ich?.rolle === 'leitung' || ich?.rolle === 'stellvertretung';
const istLeitung = () => ich?.rolle === 'leitung';
const tagIso = (wert) => String(wert).slice(0, 10);
const zeigeFehler = (fehler) => { if (!fehler.behandelt) meldung(fehlerText(fehler.message)); };

// ---------------------------------------------------------------- Laden

let ladeNummer = 0; // verwirft veraltete Antworten, wenn der Monat schnell gewechselt wird
async function lade() {
  const nummer = ++ladeNummer;
  const antwort = await aufruf('pep_abwesenheiten', { p_jahr: jahr, p_monat: monat });
  if (nummer !== ladeNummer) return;
  daten = antwort;
  zeichneAlles();
}

const neuLaden = () => lade().catch(zeigeFehler);

// Nach einer erfolgreichen Aktion im Dialog: Meldung und Monat neu laden.
const nachSpeichern = async () => {
  meldung('Gespeichert.', 'ok');
  await lade();
};

// Schreibt (mit Meldung „Gespeichert.“) und lädt den Monat neu; bei Fehler Meldung, Rückgabe undefined.
async function speichere(aktion) {
  meldung('');
  try {
    const ergebnis = await aktion();
    await nachSpeichern();
    return ergebnis ?? true;
  } catch (fehler) {
    zeigeFehler(fehler);
  }
}

async function zeigen() {
  meldung('');
  if (!rahmen.kopf) {
    for (const name of ['kopf', 'raster', 'seite']) rahmen[name] = element('div', { class: `abw-${name}` });
    $('ansicht-abwesenheiten').replaceChildren(rahmen.kopf, rahmen.raster, rahmen.seite);
    rahmen.raster.addEventListener('pointerdown', beiPointerAb);
    rahmen.raster.addEventListener('pointermove', beiPointerBewegung);
    rahmen.raster.addEventListener('pointerup', beiPointerAuf);
    rahmen.raster.addEventListener('pointercancel', raeumeAuf);
    rahmen.raster.addEventListener('click', beiKlick);
    rahmen.raster.addEventListener('pointerover', (e) => spalteHover(e.target.closest?.('[data-datum]')?.dataset.datum ?? null));
    rahmen.raster.addEventListener('pointerleave', () => spalteHover(null));
  }
  try {
    const [monatsdaten, einstellungen] = await Promise.all([
      aufruf('pep_abwesenheiten', { p_jahr: jahr, p_monat: monat }),
      // Der Teiler stammt aus den Einstellungen; ohne Recht dazu gilt der Standardwert.
      aufruf('pep_einstellungen').catch((fehler) => { if (fehler.behandelt) throw fehler; return null; }),
    ]);
    daten = monatsdaten;
    teiler = Number(einstellungen?.werte?.abwesenheit_teiler) || STANDARD_TEILER;
  } catch (fehler) {
    zeigeFehler(fehler);
    return;
  }
  zeichneAlles();
}

function zeichneAlles() {
  zeichneKopf();
  zeichneRaster();
  zeichneSeite();
}

// ---------------------------------------------------------------- Werkzeugleiste (Monat, Palette, Legende)

function wechsleMonat(schritt) {
  ({ jahr, monat } = monatVorZurueck(jahr, monat, schritt));
  neuLaden();
}

function zuHeute() {
  jahr = Number(heuteIso.slice(0, 4));
  monat = Number(heuteIso.slice(5, 7));
  neuLaden();
}

function farbfeld(farbe, klasse = '') {
  const f = element('span', { class: `farbfeld ${klasse}`.trim(), 'aria-hidden': 'true' });
  if (farbe) f.style.background = farbe;
  return f;
}

// Palette als Chips: genau einer ist gedrückt (aria-pressed). Ein Klick wechselt nur die Wahl, ohne neu zu zeichnen.
// Beim Malen fängt das Raster Wischgesten ab (Klasse malt); beim Ansehen scrollt es per Touch.
function waehle(wert) {
  wahl = wert;
  rahmen.raster.classList.toggle('malt', wahl !== 'ansehen');
  for (const k of rahmen.kopf.querySelectorAll('.chip[data-wahl]')) k.setAttribute('aria-pressed', String(k.dataset.wahl === wert));
}

const chip = (wert, titel, ...inhalt) => element('button', {
  type: 'button', class: 'chip', 'data-wahl': wert, 'aria-pressed': String(wahl === wert), title: titel,
  onclick: () => waehle(wert),
}, ...inhalt);

function palette() {
  const uhr = eingabe('checkbox', mitUhrzeit, { class: 'schalter', role: 'switch' });
  uhr.addEventListener('change', () => { mitUhrzeit = uhr.checked; });
  return [
    element('div', { class: 'chip-gruppe', role: 'group', 'aria-label': 'Palette' },
      chip('ansehen', 'Ansehen: Klick auf eine Zelle öffnet die Details', 'Ansehen'),
      chip('keine', 'Löschen: gezogene Tage leeren', farbfeld(null, 'leer'), 'Löschen'),
      daten.codes.map((c) => chip(String(c.id), c.name, farbfeld(c.farbe), c.code))),
    element('label', { class: 'schalter-feld' }, uhr, 'mit Uhrzeit'),
    element('button', { type: 'button', class: 'knopf', onclick: oeffneWiederholung }, 'Wiederholung …'),
  ];
}

function zeichneKopf() {
  if (wahl !== 'ansehen' && wahl !== 'keine' && !daten.codes.some((c) => String(c.id) === wahl)) wahl = 'ansehen';
  rahmen.raster.classList.toggle('malt', wahl !== 'ansehen');
  // Zwei Zeilen: oben Monat und Legende, darunter die Palette mit ihren Schaltern.
  rahmen.kopf.replaceChildren(element('div', { class: 'karte werkzeugleiste' },
    element('div', { class: 'werkzeug-zeile' },
      element('div', { class: 'monatsnavi' },
        element('button', { type: 'button', class: 'knopf pfeil', 'aria-label': 'Vorheriger Monat', onclick: () => wechsleMonat(-1) }, '◀'),
        element('strong', { class: 'abw-monat' }, `${MONATE[monat - 1]} ${jahr}`),
        element('button', { type: 'button', class: 'knopf pfeil', 'aria-label': 'Nächster Monat', onclick: () => wechsleMonat(1) }, '▶'),
        element('button', { type: 'button', class: 'knopf', onclick: zuHeute }, 'Heute')),
      element('div', { class: 'legende' },
        element('span', {}, farbfeld(null, 'schulferien'), 'Schulferien'),
        element('span', {}, farbfeld(null, 'feiertag'), 'Feiertag'),
        element('span', {}, farbfeld(null, 'geschlossen'), 'geschlossen'))),
    element('div', { class: 'werkzeug-zeile' },
      darfZeichnen() ? palette() : element('p', { class: 'hinweis' }, 'Keine Berechtigung zum Bearbeiten.'))));
}

// ---------------------------------------------------------------- Raster


const wuenscheVon = (m) => (daten.wuensche || []).filter((w) => w.mitarbeiter_id === m.id);
// Offene Wünsche gehen vor; abgelehnte bleiben (abgeblendet) sichtbar und lassen sich erneut genehmigen.
const wunschAm = (m, datum) => {
  const treffer = wuenscheVon(m).filter((w) => tagIso(w.von) <= datum && datum <= tagIso(w.bis));
  return treffer.find((w) => w.status === 'offen') ?? treffer.find((w) => w.status === 'abgelehnt');
};

// Klassen, die alle Zellen eines Tages tragen (Kopf, Mitarbeiter, Summe).
const tagKlassen = (tag) => [...zellenKlasse(tag), ...(tagIso(tag.datum) === heuteIso ? ['heute'] : [])];

function zelle(m, tag, farben) {
  const datum = tagIso(tag.datum);
  const eintrag = m.tage?.[datum];
  const wunsch = wunschAm(m, datum);
  // Abgelehnte Wünsche zeigen sich nur in leeren Zellen; ein echter Eintrag geht vor.
  const abgelehnt = wunsch?.status === 'abgelehnt' && !eintrag;
  const klassen = ['abw-zelle', ...tagKlassen(tag)];
  if (wunsch && (abgelehnt || wunsch.status === 'offen')) klassen.push(abgelehnt ? 'wunsch-abgelehnt' : 'wunsch');
  const td = element('td', { class: klassen.join(' '), 'data-datum': datum, 'data-mitarbeiter': m.id });
  const titel = [tag.feiertag, tag.schulferien].filter(Boolean);
  if (eintrag) {
    const anzeige = stundenAnzeige(eintrag);
    const farbe = farben.get(eintrag.code_id);
    // Mit Uhrzeit „08–13“, sonst die Stunden kurz („6,25“, „8“).
    const zeit = eintrag.von && eintrag.bis ? anzeige.slice(eintrag.code.length + 1) : kurzStunden(eintrag.stunden);
    const belegt = element('span', { class: 'belegt' }, element('span', { class: 'kz' }, eintrag.code),
      zeit ? element('small', {}, zeit) : null);
    if (farbe) { belegt.style.background = farbe; belegt.style.color = textfarbe(farbe); }
    td.append(belegt);
    titel.push(`${anzeige} (${eintrag.quelle})`);
    if (eintrag.freigabe_id && eintrag.wunsch_geaendert) {
      td.append(element('span', { class: 'warn', title: HINWEIS_WUNSCH_GEAENDERT }, '!'));
      titel.push(HINWEIS_WUNSCH_GEAENDERT);
    }
  } else if (wunsch) {
    td.append(element('span', { class: 'kz' }, 'U?'));
  }
  if (wunsch && (abgelehnt || wunsch.status === 'offen')) titel.push(abgelehnt ? 'Abgelehnter Wunsch' : 'Urlaubswunsch (offen)');
  if (titel.length) td.title = titel.join(' · ');
  return td;
}

function zeichneRaster() {
  const farben = new Map(daten.codes.map((c) => [c.id, c.farbe]));
  const gruppen = wochenGruppen(daten.tage);
  const spalten = element('colgroup', {}, element('col', { class: 'name-spalte' }), daten.tage.map(() => element('col', {})));
  const kwZeile = element('tr', { class: 'kw-zeile' }, element('th', { class: 'abw-name' }, 'KW'),
    gruppen.map((g) => element('th', { colspan: g.tage.length, class: 'abw-kw' }, `KW ${g.kw}`)));
  const tagZeile = element('tr', {}, element('th', { class: 'abw-name' }, 'Mitarbeiter'),
    daten.tage.map((t) => element('th', {
      class: ['abw-tag', ...tagKlassen(t)].join(' '), 'data-datum': tagIso(t.datum),
      title: [t.feiertag, t.schulferien].filter(Boolean).join(' · ') || null,
    }, element('span', {}, WOCHENTAGE[t.wochentag - 1]), element('small', {}, String(Number(tagIso(t.datum).slice(8)))))));
  const zeilen = daten.mitarbeiter.map((m) => element('tr', { class: m.aktiv ? '' : 'inaktiv' },
    element('th', { class: 'abw-name', title: m.name }, m.name),
    daten.tage.map((t) => zelle(m, t, farben))));
  const summe = element('tr', { class: 'abw-summe' }, element('th', { class: 'abw-name' }, 'Summe (h)'),
    daten.tage.map((t) => element('td', { class: ['zahl', ...tagKlassen(t)].join(' '), 'data-datum': tagIso(t.datum) },
      kurzStunden(daten.summen?.[tagIso(t.datum)]))));
  const tabelle = element('table', { class: 'raster abw-tabelle' },
    spalten, element('thead', {}, kwZeile, tagZeile), element('tbody', {}, zeilen, summe));
  tabelle.style.minWidth = `${NAME_SPALTE_PX + daten.tage.length * MIN_SPALTE_PX}px`;
  hoverDatum = null;
  rahmen.raster.replaceChildren(element('div', { class: 'raster-scroll' }, tabelle));
}

// Spalten-Hover: alle Zellen desselben Datums (Kopf, Mitarbeiter, Summe) bekommen die Klasse spalte-hover.
function spalteHover(datum) {
  if (datum === hoverDatum) return;
  for (const z of rahmen.raster.querySelectorAll('.spalte-hover')) z.classList.remove('spalte-hover');
  hoverDatum = datum;
  if (datum) for (const z of rahmen.raster.querySelectorAll(`[data-datum="${datum}"]`)) z.classList.add('spalte-hover');
}

// ---------------------------------------------------------------- Ziehen (Pointer-Events)

const zellenSelektor = 'td[data-datum][data-mitarbeiter]';
const zelleUnter = (x, y) => document.elementFromPoint(x, y)?.closest?.(zellenSelektor) ?? null;

function markiere(zeile, start, ende) {
  const { von, bis } = ziehBereich(start, ende);
  for (const td of zeile.querySelectorAll('td[data-datum]')) {
    td.classList.toggle('markiert', td.dataset.datum >= von && td.dataset.datum <= bis);
  }
}

// Löscht die Markierung und gibt den Pointer frei (auch bei Abbruch und Fehlern).
function raeumeAuf() {
  if (zug) {
    zug.zeile.querySelectorAll('.markiert').forEach((td) => td.classList.remove('markiert'));
    try { rahmen.raster.releasePointerCapture(zug.pointerId); } catch { /* schon freigegeben */ }
  }
  zug = null;
}

function beiPointerAb(e) {
  if (!darfZeichnen() || wahl === 'ansehen' || (e.pointerType === 'mouse' && e.button !== 0)) return;
  const td = e.target.closest?.(zellenSelektor);
  if (!td) return;
  zug = { mitarbeiter: Number(td.dataset.mitarbeiter), zeile: td.parentElement, start: td.dataset.datum, ende: td.dataset.datum, pointerId: e.pointerId };
  rahmen.raster.setPointerCapture(e.pointerId);
  markiere(zug.zeile, zug.start, zug.ende);
  e.preventDefault();
}

// Mit Pointer-Capture liegen alle Ereignisse am Raster; die Zelle unter dem Zeiger wird per Position gesucht.
function beiPointerBewegung(e) {
  if (!zug || e.pointerId !== zug.pointerId) return;
  const td = zelleUnter(e.clientX, e.clientY);
  if (!td || Number(td.dataset.mitarbeiter) !== zug.mitarbeiter) return;
  zug.ende = td.dataset.datum;
  markiere(zug.zeile, zug.start, zug.ende);
}

async function beiPointerAuf(e) {
  if (!zug || e.pointerId !== zug.pointerId) return;
  const td = zelleUnter(e.clientX, e.clientY);
  if (td && Number(td.dataset.mitarbeiter) === zug.mitarbeiter) zug.ende = td.dataset.datum;
  const { mitarbeiter } = zug;
  const { von, bis } = ziehBereich(zug.start, zug.ende);
  raeumeAuf();
  if (wahl === 'keine') {
    await speichere(() => aufruf('pep_abwesenheit_loeschen', { p_mitarbeiter_id: mitarbeiter, p_von: von, p_bis: bis }));
    return;
  }
  const code = daten.codes.find((c) => String(c.id) === wahl);
  if (!code) return;
  let angaben = { stunden: null, von: null, bis: null };
  if (code.stundenregel === 'tatsaechlich' || mitUhrzeit) {
    angaben = await frageStunden(code, mitUhrzeit);
    if (!angaben) return;
  }
  const ergebnis = await speichere(() => aufruf('pep_abwesenheit_setzen', {
    p_mitarbeiter_id: mitarbeiter, p_code_id: code.id, p_von: von, p_bis: bis,
    p_stunden: angaben.stunden, p_von_zeit: angaben.von, p_bis_zeit: angaben.bis, p_notiz: null,
  }));
  if (ergebnis?.uebersprungen) {
    meldung(`Gespeichert. ${ergebnis.uebersprungen} Tag(e) übersprungen (geschlossen oder gesperrt).`, 'ok');
  }
}

// ---------------------------------------------------------------- Dialoge

function pruefeZeiten(von, bis) {
  if (!von !== !bis || (von && bis <= von)) throw new Error('ZEITEN_UNGUELTIG');
}

// Fragt Stunden (und von/bis); Ergebnis { stunden, von, bis } oder null bei Abbruch.
function frageStunden(code, mitZeit) {
  return new Promise((aufloesen) => {
    let ergebnis = null;
    const stunden = eingabe('text', '', { inputmode: 'decimal' });
    const von = eingabe('time', '', { step: '1800' });
    const bis = eingabe('time', '', { step: '1800' });
    dialog(`${code.code} ${code.name}: Stunden`,
      [feld('Stunden', stunden), feld(mitZeit ? 'von' : 'von (optional)', von), feld(mitZeit ? 'bis' : 'bis (optional)', bis)],
      [{
        text: 'Übernehmen',
        aktion: () => {
          const s = zahl(stunden.value);
          if (s == null) throw new Error('STUNDEN_FEHLEN');
          if (Number.isNaN(s) || s < 0) throw new Error('STUNDEN_UNGUELTIG');
          pruefeZeiten(von.value, bis.value);
          if (mitZeit && !von.value) throw new Error('ZEITEN_UNGUELTIG');
          ergebnis = { stunden: s, von: von.value || null, bis: bis.value || null };
        },
      }], () => aufloesen(ergebnis));
    stunden.focus();
  });
}

function wunschTitel(w) {
  if (w.art !== 'kw') return `Urlaubswunsch ${datumDE(w.von)}`;
  const [, vm, vt] = tagIso(w.von).split('-');
  const gleicherMonat = vm === tagIso(w.bis).slice(5, 7);
  return `Urlaubswunsch KW ${w.kw} (${vt}.${gleicherMonat ? '' : `${vm}.`}–${datumDE(w.bis)})`;
}

// Der Wunsch, wie pep_urlaub_freigeben/-ablehnen ihn erwarten (Schnappschuss-Schlüssel).
const wunschFuerDb = (w) => ({
  umfrage_id: w.umfrage_id, urlaub_mitarbeiter_id: w.urlaub_mitarbeiter_id, art: w.art,
  kw: w.art === 'kw' ? w.kw : null, datum: w.art === 'tag' ? w.datum : null,
});

function oeffneWunsch(m, w) {
  const von = eingabe('date', tagIso(w.von), { min: tagIso(w.von), max: tagIso(w.bis) });
  const bis = eingabe('date', tagIso(w.bis), { min: tagIso(w.von), max: tagIso(w.bis) });
  const notiz = eingabe('text', '');
  const aktionen = istLeitung() ? [
    {
      text: 'Genehmigen',
      aktion: () => aufruf('pep_urlaub_freigeben', {
        p_mitarbeiter_id: m.id, p_von: von.value || null, p_bis: bis.value || null,
        p_wunsch: wunschFuerDb(w), p_notiz: notiz.value || null,
      }),
      danach: nachSpeichern,
    },
    ...(w.status === 'abgelehnt' ? [] : [{
      text: 'Ablehnen', sekundaer: true,
      aktion: () => aufruf('pep_urlaub_ablehnen',
        { p_mitarbeiter_id: m.id, p_wunsch: wunschFuerDb(w), p_notiz: notiz.value || null }),
      danach: nachSpeichern,
    }]),
  ] : [];
  dialog(wunschTitel(w), [
    element('p', { class: 'hinweis' }, w.status === 'abgelehnt' ? `${m.name} – abgelehnter Wunsch, kann erneut genehmigt werden` : m.name),
    feld('von', von), feld('bis', bis), feld('Notiz', notiz),
    istLeitung() ? null : element('p', { class: 'hinweis' }, 'Nur die Filialleitung kann Wünsche genehmigen oder ablehnen.'),
  ], aktionen);
}

function oeffneInfo(m, datum) {
  const e = m.tage[datum];
  const art = daten.codes.find((c) => c.id === e.code_id);
  const zeilen = [
    ['Mitarbeiter', m.name], ['Datum', datumDE(datum)], ['Code', art ? `${e.code} ${art.name}` : e.code],
    ['Anzeige', stundenAnzeige(e)], ['Quelle', e.quelle],
    ...(e.notiz ? [['Notiz', e.notiz]] : []),
  ];
  const aktionen = [];
  if (e.freigabe_id && istLeitung()) {
    aktionen.push({
      text: 'Zurücknehmen', sekundaer: true,
      aktion: () => aufruf('pep_freigabe_zuruecknehmen', { p_freigabe_id: e.freigabe_id }),
      danach: nachSpeichern,
    });
  }
  if (e.wiederholung_id && darfZeichnen()) {
    aktionen.push({
      text: 'Wiederholung löschen', sekundaer: true,
      aktion: () => aufruf('pep_wiederholung_loeschen', { p_id: e.wiederholung_id }),
      danach: nachSpeichern,
    });
  }
  dialog(`${e.code} am ${datumDE(datum)}`, [
    element('dl', { class: 'abw-info' }, zeilen.map(([k, v]) => [element('dt', {}, k), element('dd', {}, String(v))])),
    e.wiederholung_id ? element('p', { class: 'hinweis' },
      'Dieser Tag gehört zu einer Wiederholung. „Wiederholung löschen“ löscht alle künftigen Tage dieser Wiederholung. Ändern ist in dieser Stufe nicht möglich.') : null,
    e.freigabe_id && e.wunsch_geaendert ? element('p', { class: 'meldung fehler' }, `! ${HINWEIS_WUNSCH_GEAENDERT}`) : null,
  ], aktionen);
}

function beiKlick(e) {
  if (wahl !== 'ansehen') return;
  const td = e.target.closest?.(zellenSelektor);
  const m = td && daten.mitarbeiter.find((x) => x.id === Number(td.dataset.mitarbeiter));
  if (!m) return;
  const datum = td.dataset.datum;
  const wunsch = wunschAm(m, datum);
  if (wunsch && (wunsch.status === 'offen' || !m.tage?.[datum])) oeffneWunsch(m, wunsch);
  else if (m.tage?.[datum]) oeffneInfo(m, datum);
}

async function oeffneWiederholung() {
  let personen;
  try {
    personen = (await aufruf('pep_mitarbeiter_liste')).filter((m) => m.aktiv);
  } catch (fehler) { zeigeFehler(fehler); return; }
  const wer = auswahlfeld(personen.map((m) => [String(m.id), m.name]), personen[0]?.id);
  const code = auswahlfeld(daten.codes.map((c) => [String(c.id), `${c.code} ${c.name}`]),
    (daten.codes.find((c) => c.code === 'BS') ?? daten.codes[0])?.id);
  const tag = auswahlfeld(WOCHENTAGE.map((t, i) => [String(i + 1), t]), '2');
  const von = eingabe('date', '');
  const bis = eingabe('date', '');
  const vonZeit = eingabe('time', '', { step: '1800' });
  const bisZeit = eingabe('time', '', { step: '1800' });
  const stunden = eingabe('text', '', { inputmode: 'decimal' });
  const notiz = eingabe('text', '');
  const ferien = eingabe('checkbox', true);
  dialog('Wiederholung …', [
    element('p', { class: 'hinweis' }, 'Bestehende Wiederholungen werden über das Raster sichtbar (Quelle „wiederholung“).'),
    feld('Mitarbeiter', wer), feld('Code', code), feld('Wochentag', tag),
    feld('von Datum', von), feld('bis Datum', bis),
    feld('von (optional)', vonZeit), feld('bis (optional)', bisZeit),
    feld('Stunden (leer = nach Regel)', stunden), feld('Notiz', notiz),
    element('label', { class: 'haken' }, ferien, ' In Schulferien aussetzen'),
  ], [{
    text: 'Speichern',
    aktion: async () => {
      if (!wer.value) throw new Error('MITARBEITER_NICHT_GEFUNDEN');
      if (!von.value || !bis.value) throw new Error('DATUM_UNGUELTIG');
      pruefeZeiten(vonZeit.value, bisZeit.value);
      const s = zahl(stunden.value);
      if (Number.isNaN(s)) throw new Error('STUNDEN_UNGUELTIG');
      await aufruf('pep_wiederholung_speichern', {
        p_mitarbeiter_id: Number(wer.value),
        p_daten: {
          code_id: Number(code.value), wochentag: Number(tag.value), von_datum: von.value, bis_datum: bis.value,
          von: vonZeit.value || null, bis: bisZeit.value || null, stunden: s, notiz: notiz.value || null,
          schulferien_aussetzen: ferien.checked,
        },
      });
    },
    danach: nachSpeichern,
  }]);
}

// ---------------------------------------------------------------- Übersicht „Urlaub <Jahr>“ (unter dem Raster)

function tageIn(von, bis) {
  const tage = [];
  for (let t = Date.parse(`${von}T00:00:00Z`); t <= Date.parse(`${bis}T00:00:00Z`); t += 86400000) {
    tage.push(new Date(t).toISOString().slice(0, 10));
  }
  return tage;
}

// Geschätzte Stunden offener Wünsche, nur geöffnete Tage des angezeigten Monats;
// mal Wochenstunden durch Teiler.
function offeneStunden(m) {
  const geoeffnet = new Map(daten.tage.map((t) => [tagIso(t.datum), t.geoeffnet]));
  let tage = 0;
  for (const w of wuenscheVon(m).filter((x) => x.status === 'offen')) {
    for (const d of tageIn(tagIso(w.von), tagIso(w.bis))) if (geoeffnet.get(d)) tage += 1;
  }
  return tage * ((m.wochenstunden || 0) / teiler);
}

// Zahl als Tabellenzelle; unter 0 rot und mit echtem Minuszeichen.
function zahlZelle(wert, format, attrs = {}) {
  if (wert == null) return element('td', { class: 'zahl', ...attrs }, '–');
  const minus = wert < 0;
  return element('td', { class: minus ? 'zahl minus' : 'zahl', ...attrs }, `${minus ? '−' : ''}${format(Math.abs(wert))}`);
}

const tageDE = (n) => n.toFixed(1).replace('.', ',');

function zeichneSeite() {
  const offen = rahmen.seite.querySelector('details')?.open ?? true; // Zugeklappt bleibt zugeklappt
  const urlaub = new Map((daten.urlaub || []).map((u) => [u.mitarbeiter_id, u]));
  const zeilen = daten.mitarbeiter.filter((m) => m.aktiv).map((m) => {
    const u = urlaub.get(m.id) || { anspruch: 0, rest_vorjahr: 0, genehmigt: 0, rest: 0 };
    const stundenProTag = (m.wochenstunden || 0) / teiler; // wie die Stundenregel „teiler“
    return element('tr', {}, element('th', {}, m.name),
      zahlZelle(u.anspruch + u.rest_vorjahr, stundenDE, { title: `davon Rest Vorjahr ${stundenDE(u.rest_vorjahr)} h` }),
      zahlZelle(u.genehmigt, stundenDE), zahlZelle(offeneStunden(m), stundenDE),
      zahlZelle(u.rest, stundenDE), zahlZelle(stundenProTag ? u.rest / stundenProTag : null, tageDE));
  });
  const details = element('details', { class: 'karte abw-urlaub-box', open: offen },
    element('summary', {}, element('h2', {}, `Urlaub ${jahr}`)),
    element('div', { class: 'tabelle-scroll' }, element('table', { class: 'abw-urlaub' },
      element('thead', {}, element('tr', {},
        element('th', {}, 'Mitarbeiter'),
        ['Anspruch', 'genehmigt', 'offen im Monat', 'Rest (h)', 'Rest (Tage)'].map((t) => element('th', { class: 'zahl' }, t)))),
      element('tbody', {}, zeilen))),
    element('p', { class: 'hinweis' }, 'Angaben in Stunden; „Rest (Tage)“ = Rest ÷ (Wochenstunden ÷ Teiler). '
      + '„offen im Monat“ schätzt die offenen Wunschtage des angezeigten Monats, die übrigen Spalten gelten für das ganze Jahr.'));
  rahmen.seite.replaceChildren(details);
}

reiter.abwesenheiten = { zeigen };

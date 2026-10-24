// Reiter „Abwesenheiten“: Monatsraster mit Palette, Ziehen per Pointer-Events, Wiederholungen,
// Urlaubswünsche (Genehmigen/Ablehnen/Zurücknehmen) und Seitenleiste „Urlaub <Jahr>“.
import {
  $, meldung, fehlerText, element, datumDE, stundenDE, WOCHENTAGE,
  zahl, feld, eingabe, auswahlfeld,
} from './hilfe.js';
import { aufruf, ich, reiter } from './app.js';
import { wochenGruppen, ziehBereich, monatVorZurueck, zellenKlasse, stundenAnzeige } from './kalender.js';

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const HINWEIS_WUNSCH_GEAENDERT = 'Wunsch im Urlaubstool geändert oder zurückgezogen';
const STANDARD_TEILER = 6;

const heute = new Date();
let jahr = heute.getFullYear();
let monat = heute.getMonth() + 1;
let daten = null; // Antwort von pep_abwesenheiten
let teiler = STANDARD_TEILER;
let wahl = 'ansehen'; // 'ansehen' | 'keine' | Code-Id als Text
let mitUhrzeit = false;
let zug = null; // laufendes Ziehen: { mitarbeiter, zeile, start, ende, pointerId }
const rahmen = {}; // Container: kopf, palette, raster, seite

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
    for (const name of ['kopf', 'palette', 'raster', 'seite']) rahmen[name] = element('div', { class: `abw-${name}` });
    $('ansicht-abwesenheiten').replaceChildren(rahmen.kopf,
      element('div', { class: 'abw-layout' }, rahmen.palette, rahmen.raster, rahmen.seite));
    rahmen.raster.addEventListener('pointerdown', beiPointerAb);
    rahmen.raster.addEventListener('pointermove', beiPointerBewegung);
    rahmen.raster.addEventListener('pointerup', beiPointerAuf);
    rahmen.raster.addEventListener('pointercancel', raeumeAuf);
    rahmen.raster.addEventListener('click', beiKlick);
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
  zeichnePalette();
  zeichneRaster();
  zeichneSeite();
}

// ---------------------------------------------------------------- Kopf und Palette

function wechsleMonat(schritt) {
  ({ jahr, monat } = monatVorZurueck(jahr, monat, schritt));
  neuLaden();
}

function zeichneKopf() {
  rahmen.kopf.replaceChildren(element('div', { class: 'box abw-kopfzeile' },
    element('button', { type: 'button', class: 'knopf', 'aria-label': 'Vorheriger Monat', onclick: () => wechsleMonat(-1) }, '◀'),
    element('strong', { class: 'abw-monat' }, `${MONATE[monat - 1]} ${jahr}`),
    element('button', { type: 'button', class: 'knopf', 'aria-label': 'Nächster Monat', onclick: () => wechsleMonat(1) }, '▶'),
    element('span', { class: 'abw-legende' },
      element('span', { class: 'abw-farbe schulferien' }), ' Schulferien ',
      element('span', { class: 'abw-farbe feiertag' }), ' Feiertag ',
      element('span', { class: 'abw-farbe geschlossen' }), ' geschlossen')));
}

function paletteEintrag(wert, beschriftung, farbe) {
  const radio = element('input', { type: 'radio', name: 'abw-palette', value: wert });
  radio.checked = wahl === wert;
  radio.addEventListener('change', () => { wahl = wert; });
  const farbfeld = element('span', { class: 'abw-farbe' });
  if (farbe) farbfeld.style.background = farbe;
  return element('label', { class: 'abw-pal-eintrag' }, radio, farbfeld, beschriftung);
}

function zeichnePalette() {
  if (wahl !== 'ansehen' && wahl !== 'keine' && !daten.codes.some((c) => String(c.id) === wahl)) wahl = 'ansehen';
  const uhr = eingabe('checkbox', mitUhrzeit);
  uhr.addEventListener('change', () => { mitUhrzeit = uhr.checked; });
  rahmen.palette.replaceChildren(element('div', { class: 'box' },
    element('h2', {}, 'Palette'),
    darfZeichnen() ? [
      paletteEintrag('ansehen', 'Ansehen (Klick öffnet Details)', null),
      paletteEintrag('keine', 'keine (löschen)', null),
      daten.codes.map((c) => paletteEintrag(String(c.id), `${c.code} ${c.name}`, c.farbe)),
      element('label', { class: 'haken' }, uhr, ' mit Uhrzeit'),
      element('button', { type: 'button', class: 'knopf', onclick: oeffneWiederholung }, 'Wiederholung …'),
    ] : element('p', { class: 'hinweis' }, 'Keine Berechtigung zum Bearbeiten.')));
}

// ---------------------------------------------------------------- Raster

function textfarbe(farbe) {
  const m = /^#([0-9a-f]{6})$/i.exec(farbe || '');
  if (!m) return '';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#111' : '#fff';
}

const wuenscheVon = (m) => (daten.wuensche || []).filter((w) => w.mitarbeiter_id === m.id);
// Offene Wünsche gehen vor; abgelehnte bleiben (abgeblendet) sichtbar und lassen sich erneut genehmigen.
const wunschAm = (m, datum) => {
  const treffer = wuenscheVon(m).filter((w) => tagIso(w.von) <= datum && datum <= tagIso(w.bis));
  return treffer.find((w) => w.status === 'offen') ?? treffer.find((w) => w.status === 'abgelehnt');
};

function zelle(m, tag, farben) {
  const datum = tagIso(tag.datum);
  const eintrag = m.tage?.[datum];
  const wunsch = wunschAm(m, datum);
  const abgelehnt = wunsch?.status === 'abgelehnt';
  const klassen = ['abw-zelle', ...zellenKlasse(tag)];
  if (wunsch) klassen.push(abgelehnt ? 'wunsch-abgelehnt' : 'wunsch');
  const td = element('td', { class: klassen.join(' '), 'data-datum': datum, 'data-mitarbeiter': m.id });
  const titel = [tag.feiertag, tag.schulferien].filter(Boolean);
  if (eintrag) {
    const anzeige = stundenAnzeige(eintrag);
    const farbe = farben.get(eintrag.code_id);
    if (farbe) { td.style.background = farbe; td.style.color = textfarbe(farbe); }
    td.append(element('span', { class: 'kz' }, eintrag.code),
      element('small', {}, anzeige.slice(eintrag.code.length + 1)));
    titel.push(`${anzeige} (${eintrag.quelle})`);
    if (eintrag.freigabe_id && eintrag.wunsch_geaendert) {
      td.append(element('span', { class: 'warn', title: HINWEIS_WUNSCH_GEAENDERT }, '!'));
      titel.push(HINWEIS_WUNSCH_GEAENDERT);
    }
  } else if (wunsch) {
    td.append(element('span', { class: 'kz' }, 'U?'));
  }
  if (wunsch) titel.push(abgelehnt ? 'Abgelehnter Wunsch' : 'Urlaubswunsch (offen)');
  if (titel.length) td.title = titel.join(' · ');
  return td;
}

function zeichneRaster() {
  const farben = new Map(daten.codes.map((c) => [c.id, c.farbe]));
  const gruppen = wochenGruppen(daten.tage);
  const kwZeile = element('tr', {}, element('th', { class: 'abw-name' }, 'KW'),
    gruppen.map((g) => element('th', { colspan: g.tage.length, class: 'abw-kw' }, `KW ${g.kw}`)));
  const tagZeile = element('tr', {}, element('th', { class: 'abw-name' }, 'Mitarbeiter'),
    daten.tage.map((t) => element('th', {
      class: ['abw-tag', ...zellenKlasse(t)].join(' '), title: [t.feiertag, t.schulferien].filter(Boolean).join(' · ') || null,
    }, element('span', {}, WOCHENTAGE[t.wochentag - 1]), element('small', {}, String(Number(tagIso(t.datum).slice(8)))))));
  const zeilen = daten.mitarbeiter.map((m) => element('tr', { class: m.aktiv ? '' : 'inaktiv' },
    element('th', { class: 'abw-name' }, m.name),
    daten.tage.map((t) => zelle(m, t, farben))));
  const summe = element('tr', { class: 'abw-summe' }, element('th', { class: 'abw-name' }, 'Summe'),
    daten.tage.map((t) => {
      const s = daten.summen?.[tagIso(t.datum)];
      return element('td', { class: 'abw-zelle' }, s ? stundenDE(s) : '');
    }));
  rahmen.raster.replaceChildren(element('div', { class: 'abw-scroll' },
    element('table', { class: 'abw-tabelle' }, element('thead', {}, kwZeile, tagZeile), element('tbody', {}, zeilen, summe))));
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

// aktionen: [{ text, aktion, danach, sekundaer }]. Fehler erscheinen im Dialog; bei Erfolg schließt er und `danach` läuft.
function dialog(titel, koerper, aktionen, beimSchliessen = () => {}) {
  const fehlerZeile = element('p', { class: 'meldung fehler', role: 'alert', hidden: true });
  const knoepfe = aktionen.map((a) => element('button', {
    type: 'button', class: a.sekundaer ? 'knopf' : '',
    onclick: async () => {
      fehlerZeile.hidden = true;
      alle.forEach((k) => { k.disabled = true; });
      let geschafft = false;
      try {
        await a.aktion();
        geschafft = true;
        d.close();
      } catch (fehler) {
        if (fehler.behandelt) d.close();
        else { fehlerZeile.textContent = fehlerText(fehler.message); fehlerZeile.hidden = false; }
      } finally {
        alle.forEach((k) => { k.disabled = false; });
      }
      // Fehler beim Neuladen erscheinen auf der Seite, der Dialog ist dann schon geschlossen.
      if (geschafft && a.danach) {
        try { await a.danach(); } catch (fehler) { zeigeFehler(fehler); }
      }
    },
  }, a.text));
  const abbrechen = element('button', { type: 'button', class: 'knopf', onclick: () => d.close() }, 'Abbrechen');
  const alle = [...knoepfe, abbrechen];
  const d = element('dialog', { class: 'abw-dialog' }, element('h2', {}, titel), ...koerper, fehlerZeile,
    element('div', { class: 'dialog-knoepfe' }, ...alle));
  d.addEventListener('close', () => { d.remove(); beimSchliessen(); });
  document.body.append(d);
  d.showModal();
  return d;
}

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
  if (wunsch) oeffneWunsch(m, wunsch);
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

// ---------------------------------------------------------------- Seitenleiste „Urlaub <Jahr>“

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

function zeichneSeite() {
  const urlaub = new Map((daten.urlaub || []).map((u) => [u.mitarbeiter_id, u]));
  const zeilen = daten.mitarbeiter.filter((m) => m.aktiv).map((m) => {
    const u = urlaub.get(m.id) || { anspruch: 0, rest_vorjahr: 0, genehmigt: 0, rest: 0 };
    return element('tr', {}, element('th', {}, m.name),
      element('td', { title: `davon Rest Vorjahr ${stundenDE(u.rest_vorjahr)} h` }, stundenDE(u.anspruch + u.rest_vorjahr)),
      element('td', {}, stundenDE(u.genehmigt)), element('td', {}, stundenDE(offeneStunden(m))),
      element('td', {}, stundenDE(u.rest)));
  });
  rahmen.seite.replaceChildren(element('div', { class: 'box' }, element('h2', {}, `Urlaub ${jahr}`),
    element('table', { class: 'abw-urlaub' },
      element('thead', {}, element('tr', {}, ['Mitarbeiter', 'Anspruch', 'genehmigt', 'offen im Monat (geschätzt)', 'Rest'].map((t) => element('th', {}, t)))),
      element('tbody', {}, zeilen)),
    element('p', { class: 'hinweis' }, 'Angaben in Stunden. „offen im Monat“ zählt nur die offenen Wunschtage des angezeigten Monats; die übrigen Spalten gelten für das ganze Jahr.')));
}

reiter.abwesenheiten = { zeigen };

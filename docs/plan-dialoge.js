// Dialoge „Kopieren“ und „Vorlagen“ des Einsatzplans (F11). Bewusst ohne Import von einsatzplan.js (Zyklus):
// einsatzplan.js trägt die Funktionen in `aktionen` ein und übergibt kontext = { woche, datum, neuLaden }.
// Ablauf beim Schreiben: zuerst Modus „pruefen“; sind Ziele schon belegt, Rückfrage „Ersetzen“ /
// „Nur leere Zeilen füllen“ / „Abbrechen“; das Ergebnis erscheint als Meldung, danach wird die Woche neu geladen.
import { element, feld, eingabe, meldung, datumDE } from './hilfe.js';
import { aufruf } from './app.js';
import { dialog } from './dialog.js';
import { plusTage, montagDerKw } from './zeit.js';
import { gleicheWochentageBis, naechsteWochen, tagKurz, kopierErgebnis } from './plan-raster.js';

const WOCHENTAG_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const wochentagIndex = (iso) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
const kwText = ({ jahr, kw }) => {
  const mo = montagDerKw(jahr, kw);
  return `KW ${kw} (${datumDE(mo).slice(0, 6)}–${datumDE(plusTage(mo, 6))})`;
};
// Zeitstempel (timestamptz, UTC oder mit Versatz) als lokales Datum des Browsers, z. B. „24.10.2026“.
const angelegt = (zeitstempel) => new Date(zeitstempel)
  .toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const liste = (eintraege, max = 6) =>
  eintraege.slice(0, max).join(', ') + (eintraege.length > max ? ` … (${eintraege.length})` : '');

// Ergebnis als Meldung: ohne Auffälligkeiten als Toast, sonst stehend, damit Ausgelassenes lesbar bleibt.
async function fertig(ergebnis, kontext, verb, vorne = '') {
  if (!ergebnis) return; // Vorschau ohne Datenbank
  const auffaellig = ergebnis.unbesetzt || ergebnis.gekuerzt || ergebnis.ausgelassen
    || ergebnis.uebersprungen?.length || ergebnis.ausgeschieden?.length;
  await kontext.neuLaden();
  meldung(`${vorne}${kopierErgebnis(ergebnis, verb)}.`, auffaellig ? 'ergebnis' : 'ok');
}

// Rückfrage, wenn Zieltage schon Blöcke haben.
function rueckfrage(belegt, ausfuehren, kontext, verb, vorne) {
  let ergebnis = null;
  const fertigDanach = () => fertig(ergebnis, kontext, verb, vorne);
  dialog('Ziel schon geplant', [
    element('p', {}, belegt.length === 1 ? 'Dieser Tag ist schon (teilweise) geplant: ' : `Diese ${belegt.length} Tage sind schon (teilweise) geplant: `,
      element('strong', {}, liste(belegt.map(tagKurz), 10))),
    element('p', { class: 'hinweis' },
      '„Ersetzen“ löscht dort vorher alle Blöcke. „Nur leere Zeilen füllen“ lässt Mitarbeiter, die dort schon Blöcke haben, unverändert.'),
  ], [
    { text: 'Ersetzen', gefahr: true, aktion: async () => { ergebnis = await ausfuehren('ersetzen'); }, danach: fertigDanach },
    { text: 'Nur leere Zeilen füllen', aktion: async () => { ergebnis = await ausfuehren('leere'); }, danach: fertigDanach },
  ]);
}

// Dialog-Aktion mit dem Ablauf pruefen → (Rückfrage) → schreiben. ziele() wirft bei ungültiger Eingabe.
function schreibAktion(text, ausfuehren, kontext, verb, vorne = () => '') {
  let stand = null;
  return {
    text,
    aktion: async () => {
      stand = null;
      const p = await ausfuehren('pruefen');
      if (!p) return; // Vorschau ohne Datenbank
      stand = p.belegt.length ? { belegt: p.belegt } : { ergebnis: await ausfuehren('leere') };
    },
    danach: async () => {
      if (stand?.ergebnis) await fertig(stand.ergebnis, kontext, verb, vorne());
      else if (stand?.belegt) rueckfrage(stand.belegt, ausfuehren, kontext, verb, vorne());
    },
  };
}

// Radio mit Beschriftung; weitere Eingaben stehen in derselben Zeile daneben.
function wahl(name, wert, text, gewaehlt = false) {
  const r = element('input', { type: 'radio', name, value: wert, checked: gewaehlt });
  return { r, label: element('label', { class: 'haken' }, r, ` ${text}`) };
}

// ---------------------------------------------------------------- Kopieren

export function kopierenDialog(kontext) {
  const { woche, datum } = kontext;
  if (!woche || !datum) return;
  const index = wochentagIndex(datum);
  const bloeckeAm = (tage) => woche.bloecke.some((b) => tage.includes(b.datum));

  const artTag = wahl('pd-art', 'tag', `Diesen Tag: ${tagKurz(datum)}${datum.slice(0, 4)}`, true);
  const artWoche = wahl('pd-art', 'woche', `Diese Woche: ${kwText(woche)}`);
  const tagEinzeln = wahl('pd-tag', 'einzeln', 'auf den', true);
  const tagSerie = wahl('pd-tag', 'serie', `alle ${WOCHENTAG_LANG[index]}e bis`);
  const wocheEinzeln = wahl('pd-woche', 'einzeln', 'auf', true);
  const wocheSerie = wahl('pd-woche', 'serie', 'die nächsten');

  const zielTag = eingabe('date', plusTage(datum, 7), { 'aria-label': 'Zieltag' });
  const serieBis = eingabe('date', plusTage(datum, 28), { 'aria-label': `alle ${WOCHENTAG_LANG[index]}e bis` });
  const kandidaten = naechsteWochen(woche.jahr, woche.kw, 26);
  const zielKw = element('select', { 'aria-label': 'Ziel-KW' },
    kandidaten.map((w) => element('option', { value: `${w.jahr}-${w.kw}` }, kwText(w))));
  const anzahlWochen = eingabe('number', 4, { min: '1', max: '12', step: '1', inputmode: 'numeric', 'aria-label': 'Anzahl Wochen' });
  const vorschau = element('p', { class: 'hinweis pd-ziele', 'aria-live': 'polite' });

  const gewaehlt = (w) => w.r.checked;
  const zieleTag = () => (gewaehlt(tagEinzeln) ? (zielTag.value ? [zielTag.value] : [])
    : gleicheWochentageBis(datum, serieBis.value));
  const zieleWoche = () => {
    if (gewaehlt(wocheEinzeln)) {
      const [j, k] = zielKw.value.split('-').map(Number);
      return j ? [{ jahr: j, kw: k }] : [];
    }
    const n = Number(anzahlWochen.value);
    return Number.isInteger(n) && n >= 1 ? naechsteWochen(woche.jahr, woche.kw, n) : [];
  };

  const unterTag = element('div', { class: 'pd-unter' },
    element('div', { class: 'pd-option' }, tagEinzeln.label, zielTag),
    element('div', { class: 'pd-option' }, tagSerie.label, serieBis));
  const unterWoche = element('div', { class: 'pd-unter' },
    element('div', { class: 'pd-option' }, wocheEinzeln.label, zielKw),
    element('div', { class: 'pd-option' }, wocheSerie.label, anzahlWochen, ' Wochen'));

  const aktualisiere = () => {
    const tag = gewaehlt(artTag);
    // Nicht sperren, nur abblenden: ein Klick in ein Feld wählt seine Option (gesperrte Felder bekämen keinen Fokus).
    unterTag.classList.toggle('aus', !tag);
    unterWoche.classList.toggle('aus', tag);
    const z = tag ? zieleTag().map(tagKurz) : zieleWoche().map((w) => `KW ${w.kw}`);
    vorschau.textContent = z.length ? `Ziel: ${liste(z)}` : 'Kein Ziel gewählt.';
  };
  // Wer ein Feld anfasst, meint die Option daneben.
  const koppeln = (feldElement, ...radios) => feldElement.addEventListener('focus', () => {
    for (const w of radios) w.r.checked = true;
    aktualisiere();
  });
  koppeln(zielTag, artTag, tagEinzeln);
  koppeln(serieBis, artTag, tagSerie);
  koppeln(zielKw, artWoche, wocheEinzeln);
  koppeln(anzahlWochen, artWoche, wocheSerie);

  const ausfuehren = (modus) => {
    if (gewaehlt(artTag)) {
      const ziele = zieleTag();
      if (!ziele.length) throw new Error('DATUM_UNGUELTIG');
      if (!bloeckeAm([datum])) throw new Error('NICHTS_ZU_KOPIEREN');
      return aufruf('pep_tag_kopieren', { p_quelle: datum, p_ziele: ziele, p_modus: modus });
    }
    const ziele = zieleWoche();
    if (!ziele.length) throw new Error('DATUM_UNGUELTIG');
    if (!bloeckeAm(woche.tage.map((t) => t.datum))) throw new Error('NICHTS_ZU_KOPIEREN');
    return aufruf('pep_woche_kopieren', { p_jahr: woche.jahr, p_kw: woche.kw, p_ziele: ziele, p_modus: modus });
  };

  const d = dialog('Kopieren', [
    element('fieldset', { class: 'pd-gruppe' }, element('legend', { class: 'pd-legende' }, 'Was?'),
      artTag.label, unterTag, artWoche.label, unterWoche),
    vorschau,
    element('p', { class: 'hinweis' },
      'Vergangene und geschlossene Tage werden übersprungen, Blöcke auf die Planungszeit des Ziels gekürzt. '
      + 'Fehlt am Ziel Vertrag, Kompetenz oder passt eine Pflicht-Vorgabe nicht, bleibt der Block weg. '
      + 'Abwesende werden trotzdem eingetragen und erscheinen als unbesetzt.'),
  ], [schreibAktion('Kopieren', async (modus) => ausfuehren(modus), kontext, 'kopiert')]);
  d.addEventListener('change', aktualisiere);
  d.addEventListener('input', aktualisiere);
  aktualisiere();
}

// ---------------------------------------------------------------- Vorlagen

export async function vorlagenDialog(kontext) {
  const { woche, datum } = kontext;
  if (!woche || !datum) return;
  const vorlagen = (await aufruf('pep_vorlagen')) ?? [];

  const name = eingabe('text', '', { maxlength: '60', placeholder: 'z. B. Standardwoche', autocomplete: 'off' });
  const artTag = wahl('pd-vorlage-art', 'tag', `diesen Tag (${tagKurz(datum)})`);
  const artWoche = wahl('pd-vorlage-art', 'woche', `diese Woche (KW ${woche.kw})`, true);

  const zeile = (v) => element('div', { class: 'pd-vorlage' },
    element('div', { class: 'pd-vorlage-text' }, element('strong', {}, v.name),
      element('small', {}, `${v.art === 'woche' ? 'Woche' : 'Tag'} · ${v.bloecke} ${v.bloecke === 1 ? 'Block' : 'Blöcke'}`
        + ` · ${angelegt(v.angelegt_am)}`)),
    element('button', { type: 'button', class: 'knopf', onclick: () => { d.close(); ladenDialog(v, kontext); } },
      v.art === 'woche' ? `Laden auf KW ${woche.kw}` : `Laden auf ${tagKurz(datum)}`),
    element('button', {
      type: 'button', class: 'knopf gefahr', 'aria-label': `Vorlage ${v.name} löschen`,
      onclick: () => { d.close(); loeschenDialog(v, kontext); },
    }, 'Löschen'));

  let gespeichert = null;
  const d = dialog('Vorlagen', [
    element('h3', { class: 'pd-titel' }, 'Gespeicherte Vorlagen'),
    vorlagen.length ? element('div', { class: 'pd-vorlagen' }, vorlagen.map(zeile))
      : element('p', { class: 'hinweis' }, 'Noch keine Vorlage gespeichert.'),
    element('h3', { class: 'pd-titel' }, 'Plan als Vorlage speichern'),
    feld('Name', name),
    element('fieldset', { class: 'pd-gruppe' }, element('legend', { class: 'pd-legende' }, 'Speichern:'),
      artWoche.label, artTag.label),
  ], [{
    text: 'Als Vorlage speichern',
    aktion: async () => {
      gespeichert = name.value.trim();
      await aufruf('pep_vorlage_speichern', { p_name: name.value, p_art: artTag.r.checked ? 'tag' : 'woche', p_datum: datum });
    },
    danach: () => meldung(`Vorlage „${gespeichert}“ gespeichert.`, 'ok'),
  }]);
  d.classList.add('pd-breit');
}

// Lädt eine Vorlage auf den gewählten Tag bzw. den Montag der angezeigten Woche.
function ladenDialog(v, kontext) {
  const { woche, datum } = kontext;
  const ziel = v.art === 'woche' ? woche.montag : datum;
  const zielText = v.art === 'woche' ? kwText(woche) : `${tagKurz(datum)}${datum.slice(0, 4)}`;
  dialog(`Vorlage „${v.name}“ laden`, [
    element('p', {}, 'Ziel: ', element('strong', {}, zielText)),
    element('p', { class: 'hinweis' },
      'Vergangene und geschlossene Tage werden übersprungen. Mitarbeiter, die nicht mehr beschäftigt sind, '
      + 'bleiben weg und werden danach genannt.'),
  ], [schreibAktion('Laden', (modus) => aufruf('pep_vorlage_laden', { p_id: v.id, p_ziel: ziel, p_modus: modus }),
    kontext, 'geladen', () => `Vorlage „${v.name}“: `)],
  );
}

function loeschenDialog(v, kontext) {
  dialog(`Vorlage „${v.name}“ löschen?`, [element('p', {}, 'Der Plan selbst bleibt unverändert.')], [{
    text: 'Löschen', gefahr: true,
    aktion: () => aufruf('pep_vorlage_loeschen', { p_id: v.id }),
    danach: () => { meldung(`Vorlage „${v.name}“ gelöscht.`, 'ok'); return vorlagenDialog(kontext); },
  }]);
}

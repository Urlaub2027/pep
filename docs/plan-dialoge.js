// Dialoge des Einsatzplans: „Kopieren“ und „Vorlagen“ (F11), „Krank/ZA“ und „Ersatz“. Bewusst ohne Import von
// einsatzplan.js (Zyklus): einsatzplan.js trägt die Funktionen in `aktionen` ein und übergibt
// kontext = { woche, datum, neuLaden }. Nach jedem Schreiben wird die Woche neu geladen (kontext.neuLaden).
// Kopieren/Vorlagen: zuerst Modus „pruefen“; sind Ziele schon belegt, Rückfrage „Ersetzen“ /
// „Nur leere Zeilen füllen“ / „Abbrechen“; das Ergebnis erscheint als Meldung.
import { element, feld, eingabe, meldung, datumDE, fehlerText } from './hilfe.js';
import { aufruf } from './app.js';
import { dialog } from './dialog.js';
import { plusTage, montagDerKw, zeitspanne } from './zeit.js';
import {
  gleicheWochentageBis, naechsteWochen, tagKurz, kopierErgebnis, tageText, lueckeText,
} from './plan-raster.js';

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

// ---------------------------------------------------------------- Krank/ZA

// Krankmeldung oder Zeitausgleich für ganze Tage (pep_schnell_abwesend). Geplante Blöcke bleiben stehen und
// erscheinen danach rot als unbesetzt; „Ersatz“ am Block öffnet ersatzDialog.
export function krankDialog(kontext, mitarbeiterId = null, tag = null) {
  const { woche } = kontext;
  const datum = tag ?? kontext.datum;
  if (!woche || !datum) return;

  const person = element('select', { 'aria-label': 'Mitarbeiter' },
    element('option', { value: '' }, '– bitte wählen –'),
    woche.mitarbeiter.map((m) => element('option', { value: String(m.id) }, m.name)));
  person.value = mitarbeiterId == null ? '' : String(mitarbeiterId);
  const km = wahl('pd-krank-code', 'KM', 'Krank (KM)', true);
  const za = wahl('pd-krank-code', 'ZA', 'Zeitausgleich (ZA)');
  const von = eingabe('date', datum);
  const bis = eingabe('date', datum);
  // „bis“ läuft mit, sobald es vor „von“ läge
  von.addEventListener('change', () => { if (von.value && (!bis.value || bis.value < von.value)) bis.value = von.value; });

  let stand = null;
  dialog('Krank / Zeitausgleich', [
    feld('Mitarbeiter', person),
    element('fieldset', { class: 'pd-gruppe' }, element('legend', { class: 'pd-legende' }, 'Was?'),
      element('div', { class: 'pd-option' }, km.label, za.label)),
    element('div', { class: 'pd-zeitraum' }, feld('von', von), feld('bis', bis)),
    element('p', { class: 'hinweis' },
      'Ganze Tage, auch rückwirkend; geschlossene Tage werden übersprungen. Geplante Blöcke bleiben stehen und '
      + 'werden rot (unbesetzt) – „Ersatz“ am Block zeigt, wer einspringen kann. Stundenweise Abwesenheit '
      + '(z. B. Arzttermin) bitte im Reiter Abwesenheiten eintragen.'),
  ], [{
    text: 'Eintragen',
    aktion: async () => {
      stand = null;
      if (!person.value) throw new Error('MITARBEITER_WAEHLEN');
      if (!von.value || !bis.value) throw new Error('DATUM_UNGUELTIG');
      const code = km.r.checked ? 'KM' : 'ZA';
      const ergebnis = await aufruf('pep_schnell_abwesend', {
        p_mitarbeiter_id: Number(person.value), p_code: code, p_von: von.value, p_bis: bis.value,
      });
      stand = { ergebnis, code, id: Number(person.value), von: von.value, bis: bis.value };
    },
    danach: async () => {
      if (!stand?.ergebnis) return; // Vorschau ohne Datenbank
      const { ergebnis, code, id, von: v, bis: b } = stand;
      const name = woche.mitarbeiter.find((m) => m.id === id)?.name ?? '';
      // Geplante Blöcke im Zeitraum (soweit die geladene Woche sie kennt) sind jetzt unbesetzt.
      const geplant = woche.bloecke.some((x) => x.mitarbeiter_id === id && x.datum >= v && x.datum <= b);
      await kontext.neuLaden();
      let text = `${code} eingetragen: ${name}, ${tageText(v, b)} (${ergebnis.tage} ${ergebnis.tage === 1 ? 'Tag' : 'Tage'}`
        + `${ergebnis.uebersprungen ? `, ${ergebnis.uebersprungen} geschlossen übersprungen` : ''}).`;
      if (geplant) text += ' Geplante Blöcke sind jetzt unbesetzt (rot) – „Ersatz“ am Block zeigt, wer einspringen kann.';
      meldung(text, geplant ? 'ergebnis' : 'ok');
    },
  }]);
}

// ---------------------------------------------------------------- Ersatz finden

// Kandidaten für die unbesetzten Blöcke eines Mitarbeiters an einem Tag (pep_ersatz_kandidaten). Ein Klick auf
// einen Namen verschiebt alle unbesetzten Blöcke auf ihn (pep_ersatz_uebernehmen), danach wird die Woche neu geladen.
export async function ersatzDialog(kontext, mitarbeiterId, datum) {
  const { woche } = kontext;
  if (!woche || !datum) return;
  const antwort = await aufruf('pep_ersatz_kandidaten', { p_mitarbeiter_id: mitarbeiterId, p_datum: datum });
  if (!antwort) return; // Vorschau ohne Daten
  const name = woche.mitarbeiter.find((m) => m.id === mitarbeiterId)?.name ?? '';
  const bereich = (id) => woche.bereiche.find((b) => b.id === id);
  const kuerzel = (u) => `${bereich(u.bereich_id)?.kuerzel ?? '?'} ${zeitspanne(u.von, u.bis)}`;
  const blockText = antwort.unbesetzt.map(kuerzel).join(', ');

  let d = null;
  const uebernehmen = async (k, knopf) => {
    const fehlerZeile = d.querySelector('[role="alert"]');
    const alle = [...d.querySelectorAll('button')];
    fehlerZeile.hidden = true;
    alle.forEach((x) => { x.disabled = true; });
    knopf.classList.add('laeuft');
    try {
      await aufruf('pep_ersatz_uebernehmen', { p_mitarbeiter_id: mitarbeiterId, p_datum: datum, p_ersatz_id: k.mitarbeiter_id });
    } catch (fehler) {
      knopf.classList.remove('laeuft');
      alle.forEach((x) => { x.disabled = false; });
      if (fehler.behandelt) d.close();
      else { fehlerZeile.textContent = fehlerText(fehler.message); fehlerZeile.hidden = false; }
      return;
    }
    d.close();
    await kontext.neuLaden();
    meldung(`${k.name} übernimmt ${blockText} von ${name} (${tagKurz(datum)}).`, 'ok');
  };

  const zeile = (k) => {
    const knopf = element('button', { type: 'button', class: 'pd-kandidat', title: `${k.name} übernimmt ${blockText}` },
      element('span', { class: 'pd-kandidat-kopf' },
        element('strong', {}, k.name),
        element('span', { class: `pd-luecke${Number(k.luecke) < 0 ? ' ueber' : ''}` }, lueckeText(k.luecke))),
      element('small', {}, `${k.samstage_monat} ${k.samstage_monat === 1 ? 'Samstag' : 'Samstage'} im Monat · `
        + `${k.spaet_woche} ${k.spaet_woche === 1 ? 'Spätschicht' : 'Spätschichten'} in der Woche`),
      k.hinweise.map((h) => element('span', { class: 'pd-hinweis' }, h)));
    knopf.addEventListener('click', () => uebernehmen(k, knopf));
    return knopf;
  };

  d = dialog(`Ersatz für ${name}`, [
    element('p', { class: 'pd-unbesetzt' }, element('strong', {}, `${tagKurz(datum)} unbesetzt:`),
      antwort.unbesetzt.map((u) => element('span', { class: 'pd-block' }, farbfeld(bereich(u.bereich_id)?.farbe), kuerzel(u)))),
    antwort.kandidaten.length
      ? element('div', { class: 'pd-kandidaten' }, antwort.kandidaten.map(zeile))
      : element('p', { class: 'warnung' }, 'Niemand kann einspringen, ohne eine Sperre, die Ruhezeit oder die '
        + 'Höchstarbeitszeit zu verletzen. Die Blöcke bleiben unbesetzt.'),
    element('p', { class: 'hinweis' },
      'Ein Klick auf einen Namen übernimmt alle unbesetzten Blöcke des Tages. Reihenfolge: die meisten offenen '
      + 'Wochenstunden zuerst, dann weniger Samstage und Spätschichten. Nicht aufgeführt ist, wer zu der Zeit schon '
      + 'eingeplant oder abwesend ist, die Kompetenz nicht hat oder gegen eine Pflicht-Vorgabe, die Ruhezeit oder die '
      + 'Höchstarbeitszeit verstoßen würde.'),
  ], []);
  d.classList.add('pd-breit');
  // showModal fokussiert den ersten Kandidaten; Enter würde ihn sofort einsetzen. Deshalb steht der Fokus auf „Abbrechen“.
  d.querySelector('.dialog-knoepfe .knopf')?.focus();
}

function farbfeld(farbe) {
  const f = element('span', { class: 'farbfeld', 'aria-hidden': 'true' });
  if (farbe) f.style.backgroundColor = farbe;
  return f;
}

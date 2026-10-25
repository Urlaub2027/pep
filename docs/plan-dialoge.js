// Dialoge des Einsatzplans: „Kopieren“ und „Vorlagen“ (F11), „Krank/ZA“, „Ersatz“ und „Eckdaten“. Bewusst ohne Import von
// einsatzplan.js (Zyklus): einsatzplan.js trägt die Funktionen in `aktionen` ein und übergibt
// kontext = { woche, datum, neuLaden }. Nach jedem Schreiben wird die Woche neu geladen (kontext.neuLaden).
// Kopieren/Vorlagen: zuerst Modus „pruefen“; sind Ziele schon belegt, Rückfrage „Ersetzen“ /
// „Nur leere Zeilen füllen“ / „Abbrechen“; das Ergebnis erscheint als Meldung.
import { element, feld, eingabe, meldung, datumDE, fehlerText, stundenDE } from './hilfe.js';
import { aufruf, zeigeAnsicht } from './app.js';
import { dialog } from './dialog.js';
import { waehleMitarbeiter, VERTRAGSARTEN } from './mitarbeiter.js';
import { plusTage, montagDerKw, zeitspanne, isoWoche, heuteDatum } from './zeit.js';
import { vorzeichen } from './zeitkonto-daten.js';
import {
  gleicheWochentageBis, naechsteWochen, tagKurz, kopierErgebnis, tageText, lueckeText, vorgabeText, ersatzBloecke,
  uebernahmeText,
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
  const auffaellig = ergebnis.unbesetzt || ergebnis.gekuerzt || ergebnis.ausgelassen || ergebnis.belegt_uebersprungen
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
// erscheinen danach rot als unbesetzt; „Ersatz“ am Block öffnet ersatzDialog. vorwahl ('KM' | 'ZA') ist vorgewählt.
export function krankDialog(kontext, mitarbeiterId = null, tag = null, vorwahl = 'KM') {
  const { woche } = kontext;
  const datum = tag ?? kontext.datum;
  if (!woche || !datum) return;

  const person = element('select', { 'aria-label': 'Mitarbeiter' },
    element('option', { value: '' }, '– bitte wählen –'),
    woche.mitarbeiter.map((m) => element('option', { value: String(m.id) }, m.name)));
  person.value = mitarbeiterId == null ? '' : String(mitarbeiterId);
  const km = wahl('pd-krank-code', 'KM', 'Krank (KM)', vorwahl !== 'ZA');
  const za = wahl('pd-krank-code', 'ZA', 'Zeitausgleich (ZA)', vorwahl === 'ZA');
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
  // Pausen stehen nicht als eigener Block da, sondern als „inkl. Pause …“ hinter der Schicht.
  const pausen = woche.bereiche.filter((b) => b.art === 'pause').map((b) => b.id);
  const bloecke = ersatzBloecke(antwort.unbesetzt, pausen);
  const blockText = [bloecke.arbeit.map(kuerzel).join(', '), bloecke.pauseText].filter(Boolean).join(' ');

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
    const verbrauch = uebernahmeText(bloecke.stunden, k.luecke); // wie viel der offenen Wochenstunden die Übernahme braucht
    const knopf = element('button', { type: 'button', class: 'pd-kandidat', title: `${k.name} übernimmt ${blockText}` },
      element('span', { class: 'pd-kandidat-kopf' },
        element('strong', {}, k.name),
        element('span', { class: `pd-luecke${Number(k.luecke) < 0 ? ' ueber' : ''}` }, lueckeText(k.luecke))),
      element('span', { class: `pd-uebernahme${verbrauch.ueber ? ' ueber' : ''}` }, verbrauch.text),
      element('small', {}, `${k.samstage_monat} ${k.samstage_monat === 1 ? 'Samstag' : 'Samstage'} im Monat · `
        + `${k.spaet_woche} ${k.spaet_woche === 1 ? 'Spätschicht' : 'Spätschichten'} in der Woche`),
      k.hinweise.map((h) => element('span', { class: 'pd-hinweis' }, h)));
    knopf.addEventListener('click', () => uebernehmen(k, knopf));
    return knopf;
  };

  d = dialog(`Ersatz für ${name}`, [
    element('p', { class: 'pd-unbesetzt' }, element('strong', {}, `${tagKurz(datum)} unbesetzt:`),
      bloecke.arbeit.map((u) => element('span', { class: 'pd-block' }, farbfeld(bereich(u.bereich_id)?.farbe), kuerzel(u))),
      bloecke.pauseText ? element('span', { class: 'pd-pause' }, bloecke.pauseText) : null),
    antwort.kandidaten.length
      ? element('div', { class: 'pd-kandidaten' }, antwort.kandidaten.map(zeile))
      : element('p', { class: 'warnung' }, 'Niemand kann einspringen, ohne eine Sperre zu verletzen oder Ruhezeit '
        + 'bzw. Höchstarbeitszeit neu oder stärker zu verletzen. Die Blöcke bleiben unbesetzt.'),
    element('p', { class: 'hinweis' },
      'Ein Klick auf einen Namen übernimmt alle unbesetzten Blöcke des Tages. Reihenfolge: die meisten offenen '
      + 'Wochenstunden zuerst, dann weniger Samstage und Spätschichten. Nicht aufgeführt ist, wer zu der Zeit schon '
      + 'eingeplant oder abwesend ist, die Kompetenz nicht hat, gegen eine Pflicht-Vorgabe verstoßen würde oder durch '
      + 'die Übernahme einen neuen oder schärferen Verstoß gegen Ruhezeit oder Höchstarbeitszeit bekäme.'),
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

// ---------------------------------------------------------------- Eckdaten

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober',
  'November', 'Dezember'];
const LAGE = { frueh: 'früh', spaet: 'spät', lang: 'lang', mitte: 'mitte' };
const h = (n) => `${stundenDE(n)} h`;

// Zeitkonto-Zeile (pep_eckdaten.zeitkonto): „Zeitkonto: +2,50 h (aktuell · zuletzt gebucht KW 46)“, ⚠ bei Warnung. Klick schließt den
// Dialog und öffnet den Reiter Zeitkonto mit dem Journal des Mitarbeiters – in der zuletzt abgeschlossenen Woche, ohne
// Abschluss in der Vorwoche (wie der Reiter selbst). zeitkonto.js wird erst beim Klick geladen: ein statischer Import
// schlösse den Kreis zeitkonto.js → einsatzplan.js → plan-dialoge.js.
function zeitkontoZeile(z, mitarbeiterId, datum) {
  const stand = z.stand_montag ? isoWoche(z.stand_montag) : null;
  const ziel = stand ?? isoWoche(plusTage(heuteDatum(new URLSearchParams(location.search).get('heute')), -7));
  // Der Saldo sind alle Buchungen (auch nach dem letzten Abschluss), darum „aktuell“; die KW nennt den letzten Abschluss.
  const standText = !stand ? 'aktuell · noch keine Woche abgeschlossen'
    : `aktuell · zuletzt gebucht KW ${stand.kw}${stand.jahr !== isoWoche(datum).jahr ? `/${stand.jahr}` : ''}`;
  const warnung = z.warnung === 'plus' || z.warnung === 'minus';
  const knopf = element('button', {
    type: 'button', class: `pd-eck-zk${warnung ? ' warnung' : ''}`,
    title: warnung ? `Saldo über der Warngrenze (${z.warnung === 'plus' ? 'zu viel Plus' : 'zu viel Minus'}) – zum Zeitkonto`
      : 'Zum Zeitkonto',
    onclick: async (e) => {
      e.currentTarget.closest('dialog')?.close();
      const { oeffneZeitkonto } = await import('./zeitkonto.js');
      oeffneZeitkonto(ziel.jahr, ziel.kw, mitarbeiterId);
    },
  }, warnung ? '⚠ ' : '', `Zeitkonto: ${vorzeichen(z.saldo)} h (${standText})`);
  return element('p', {}, knopf);
}

// Abschnitt des Eckdaten-Fensters: Überschrift und Inhalt; leere Listen zeigen „keine“.
function eckTeil(titel, ...inhalt) {
  const leer = inhalt.flat(Infinity).every((x) => x == null || x === false);
  return element('section', { class: 'pd-eck-teil' }, element('h3', { class: 'pd-eck-titel' }, titel),
    leer ? element('p', { class: 'hinweis' }, 'keine') : inhalt);
}

// Klick auf einen Namen im Raster (pep_eckdaten): alles für eine faire Planung auf einen Blick, nur Hinweise.
// Von hier: „Krank melden“ / „Zeitausgleich“ (krankDialog vorbelegt) und „Zur Mitarbeiterkarte“.
export async function eckdatenDialog(kontext, mitarbeiterId, datum) {
  if (!datum) return;
  const e = await aufruf('pep_eckdaten', { p_mitarbeiter_id: mitarbeiterId, p_datum: datum });
  if (!e) return; // Vorschau ohne Daten
  const m = e.mitarbeiter;
  const kw = isoWoche(datum).kw;
  const monat = MONATE[Number(datum.slice(5, 7)) - 1];

  const kopf = element('p', { class: 'pd-eck-kopf' },
    [`Stand ${tagKurz(datum)}${datum.slice(0, 4)}`, m.alter != null ? `${m.alter} Jahre` : null,
      m.personalnummer ? `Pers.-Nr. ${m.personalnummer}` : null].filter(Boolean).join(' · '));
  const hinweise = e.hinweise.length
    ? element('div', { class: 'pd-eck-hinweise' }, e.hinweise.map((x) => element('span', { class: 'pd-hinweis' }, x)))
    : null;

  const vertrag = eckTeil('Vertrag und Kompetenzen',
    element('p', {}, e.vertrag
      ? `${VERTRAGSARTEN[e.vertrag.vertragsart] ?? e.vertrag.vertragsart} · ${h(e.vertrag.wochenstunden)} pro Woche`
      : 'Kein Vertrag an diesem Tag'),
    element('p', {}, e.kompetenzen.length ? e.kompetenzen.map((k) => element('span', { class: 'badge' }, k))
      : element('span', { class: 'hinweis' }, 'keine Kompetenzen')),
    e.zeitkonto ? zeitkontoZeile(e.zeitkonto, m.id, datum) : null);

  const soll = e.woche.soll;
  const woche = eckTeil(`Woche KW ${kw}`,
    element('dl', { class: 'pd-eck-werte' },
      element('dt', {}, 'Soll'), element('dd', {}, soll == null ? '–' : h(soll)),
      element('dt', {}, 'geplant'), element('dd', {}, h(e.woche.geplant))),
    soll == null ? null : element('p', { class: `pd-luecke${soll - e.woche.geplant < 0 ? ' ueber' : ''}` },
      lueckeText(soll - e.woche.geplant)),
    element('p', { class: 'hinweis' }, 'Soll = Vertrag − Abwesenheiten der Woche'));

  const vorgaben = eckTeil('Wochenvorgaben', e.vorgaben.length ? element('ul', { class: 'pd-eck-liste' },
    e.vorgaben.map((v) => element('li', { class: v.pflicht ? 'pflicht' : '' },
      element(v.pflicht ? 'strong' : 'span', {}, `${v.pflicht ? 'Pflicht' : 'bevorzugt'} – ${vorgabeText(v)}`),
      v.notiz ? element('small', {}, v.notiz) : null))) : null);

  const abwesenheiten = eckTeil('Abwesenheiten diese und nächste Woche', e.abwesenheiten.length
    ? element('ul', { class: 'pd-eck-liste' }, e.abwesenheiten.map((a) => element('li', {},
      `${tagKurz(a.datum)} ${a.code}${a.von ? ` ${zeitspanne(a.von, a.bis)}` : ''} (${h(a.stunden)})`)))
    : null);

  const s = e.samstage;
  const beschaeftigt = s.monat.filter((x) => x.status !== 'vor_eintritt'); // davor weder frei noch gearbeitet
  const freiMonat = beschaeftigt.filter((x) => x.status !== 'gearbeitet').length;
  const saText = (x) => (x.status === 'abwesend' ? `frei (${x.code})` : x.status === 'vor_eintritt' ? 'vor Eintritt' : x.status);
  const samstage = eckTeil(`Samstage im ${monat}`,
    element('ul', { class: 'pd-samstage' }, s.monat.map((x) => element('li', { class: `pd-sa ${x.status}` },
      element('strong', {}, `${x.datum.slice(8, 10)}.${x.datum.slice(5, 7)}.`),
      ` ${saText(x)}`))),
    element('p', {}, `Frei im ${monat}: ${freiMonat} von ${beschaeftigt.length} (Ziel ${s.ziel_monat})`),
    element('p', {}, `Frei im Jahr vor dem ${datumDE(datum).slice(0, 6)}: ${s.frei_jahr} (Ziel ${s.ziel_jahr})`),
    element('p', { class: 'hinweis' }, 'Urlaub, Krankheit, geschlossene und noch nicht geplante Samstage zählen als frei, Samstage vor dem Eintritt gar nicht.'));

  const tage = e.vorwoche.filter((v, i) => i < 6 || v.lage); // Mo–Sa, Sonntag nur mit Arbeit
  const vorwoche = eckTeil(`Vorwoche KW ${isoWoche(plusTage(datum, -7)).kw}`,
    element('ul', { class: 'pd-lagen' }, tage.map((v) => element('li', { class: `pd-lage${v.lage ? ` ${v.lage}` : ''}` },
      element('small', {}, tagKurz(v.datum).slice(0, 2)), v.lage ? LAGE[v.lage] : '–'))),
    element('p', {}, e.vorwoche_lage ? `Überwiegend ${LAGE[e.vorwoche_lage]}` : 'Früh und spät ausgeglichen oder nicht geplant'),
    element('p', {}, `Letzter gearbeiteter Samstag: ${e.letzter_samstag_spaet ? 'spät' : 'nicht spät'}`),
    element('p', { class: 'hinweis' }, 'Früh = Beginn zur Rahmenöffnung, spät = Ende nach der Spät-Grenze.'));

  const kommentar = eckTeil(`Kommentar ${tagKurz(datum)}`, e.kommentar ? element('p', {}, e.kommentar) : null);

  const d = dialog(m.name, [
    kopf, hinweise,
    element('div', { class: 'pd-eck' }, vertrag, woche, vorgaben, abwesenheiten, samstage, vorwoche, kommentar),
  ], [
    { text: 'Krank melden', sekundaer: true, aktion: () => {}, danach: () => krankDialog(kontext, m.id, datum, 'KM') },
    { text: 'Zeitausgleich', sekundaer: true, aktion: () => {}, danach: () => krankDialog(kontext, m.id, datum, 'ZA') },
    {
      text: 'Zur Mitarbeiterkarte', sekundaer: true, aktion: () => {},
      danach: () => { waehleMitarbeiter(m.id); zeigeAnsicht('mitarbeiter'); },
    },
  ], undefined, 'Schließen');
  d.classList.add('pd-eck-dialog');
  // showModal fokussiert sonst „Krank melden“; Enter soll nichts auslösen.
  d.querySelector('.dialog-knoepfe .knopf:last-child')?.focus();
}

// Sicherung (Stufe 2): Abschnitt „Sicherung“ in den Einstellungen (nur Leitung) und der Hinweis auf der Startseite.
// Supabase sichert im kostenlosen Tarif nichts; die PEP-Sicherung ist eine JSON-Datei aller Daten der Filiale
// (public.pep_sicherung in schema.sql, Format dort beschrieben). Einspielen geht nur in eine leere Filiale
// (pep_sicherung_pruefen zeigt vorher Filiale, Anzahlen und ob das Ziel leer ist; pep_sicherung_einspielen).
// Bewusst ohne Import von app.js: die reinen Hilfen laufen in node (tests/sicherung.test.mjs); aufruf und was nach
// dem Einspielen neu zu laden ist, reicht einstellungen.js herein.
import { element, meldung, fehlerText, feld, eingabe, zeilenformular } from './hilfe.js';
import { heuteDatum } from './zeit.js';

export const HINWEIS_PERSONALDATEN =
  'Die Datei enthält Personaldaten. Auf dem PC oder USB-Stick aufbewahren, nicht per E-Mail verschicken.';
const GELB_AB_TAGEN = 8;

// Beschriftung der Anzahlen in der Vorschau und im Ergebnis; die übrigen Tabellen erscheinen zusammengefasst.
const TABELLEN = [
  ['mitarbeiter', 'Mitarbeiter'], ['vertraege', 'Verträge'], ['abwesenheiten', 'Abwesenheitstage'],
  ['plan_bloecke', 'Plan-Blöcke'], ['ist_bloecke', 'IST-Blöcke'], ['ist_tage', 'bestätigte IST-Zeilen'],
  ['wochen_abschluesse', 'abgeschlossene Wochen'], ['zeitkonto_buchungen', 'Zeitkonto-Buchungen'],
  ['protokoll', 'Protokolleinträge'],
];
const AUSGELASSEN = {
  benutzer: 'Benutzer (im Urlaubstool unbekannt oder schon einer anderen Filiale zugeordnet)',
  benutzerverweise: 'Verweise auf Benutzer, die es hier nicht gibt (bleiben leer)',
  urlaub_umfragen: 'Urlaubstool-Umfragen (fehlen hier, gehören einem anderen Organisator oder einer anderen Filiale)',
  urlaub_zuordnung: 'Zuordnungen von Umfrage-Teilnehmern (deren Umfrage ist hier nicht eingeschaltet)',
};

const tageZwischen = (von, bis) => Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 864e5);

// Startseite: „Letzte Sicherung vor n Tagen“ bzw. „Noch keine Sicherung“; gelb ab 8 Tagen und ohne Sicherung.
// letzte und heute als 'JJJJ-MM-TT'. Liegt letzte nach heute (Testbetrieb mit fester Uhr), gilt „heute“.
export function sicherungHinweis(letzte, heute) {
  if (!letzte) return { text: 'Noch keine Sicherung', gelb: true };
  const n = Math.max(0, tageZwischen(letzte, heute));
  const text = n === 0 ? 'Letzte Sicherung heute' : n === 1 ? 'Letzte Sicherung gestern' : `Letzte Sicherung vor ${n} Tagen`;
  return { text, gelb: n >= GELB_AB_TAGEN };
}

// PEP-Sicherung-<nummer>-<JJJJ-MM-TT>.json; ohne Nummer der Name der Filiale, nur Buchstaben und Ziffern.
export function dateiname(filiale, heute) {
  const teil = String(filiale?.nummer || filiale?.name || 'Filiale').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return `PEP-Sicherung-${teil}-${heute}.json`;
}

const zahl = (n) => n.toLocaleString('de-DE');
function anzahlListe(anzahl) {
  const bekannt = new Set(TABELLEN.map(([t]) => t));
  const uebrige = Object.entries(anzahl).filter(([t]) => !bekannt.has(t)).reduce((s, [, n]) => s + n, 0);
  return element('ul', { class: 'sicherung-anzahl' },
    TABELLEN.map(([t, text]) => element('li', {}, element('strong', {}, zahl(anzahl[t] ?? 0)), ` ${text}`)),
    element('li', {}, element('strong', {}, zahl(uebrige)), ' weitere Einträge (Bereiche, Codes, Zeiten, Einstellungen, …)'));
}

// Liste (leer oder ein Absatz), damit sie auch in replaceChildren passt.
function unbekanntHinweis(u) {
  const teile = [...u.tabellen, ...Object.entries(u.spalten).map(([t, s]) => `${t}: ${s.join(', ')}`)];
  return teile.length ? [element('p', { class: 'hinweis-gelb' },
    'Die Datei stammt aus einer neueren Version und enthält Teile, die hier fehlen. Sie werden nicht eingespielt: ',
    teile.join('; '), '.')] : [];
}

// Füllt `box` mit dem Abschnitt. aufruf = app.aufruf; nachEinspielen() lädt Kopfzeile und übrige Abschnitte neu.
export function zeichneSicherung(box, { aufruf, nachEinspielen, abschnitt }) {
  const vorschau = element('div', { class: 'sicherung-vorschau' });
  const fehler = (f) => { if (!f.behandelt) meldung(fehlerText(f.message)); };

  const laden = element('button', { type: 'button', class: 'knopf primaer', 'data-aktion': 'sicherung-laden' },
    'Sicherung herunterladen');
  laden.addEventListener('click', async () => {
    meldung('');
    laden.disabled = true;
    try {
      const daten = await aufruf('pep_sicherung');
      // Blob und a.download wie die Excel-Datei (druck.js)
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(daten)], { type: 'application/json' }));
      a.download = dateiname(daten.filiale, heuteDatum(new URLSearchParams(location.search).get('heute')));
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      meldung('Sicherung heruntergeladen.', 'ok');
    } catch (f) {
      fehler(f);
    } finally {
      laden.disabled = false;
    }
  });

  const datei = eingabe('file', '', { accept: '.json,application/json', 'data-aktion': 'sicherung-datei' });
  datei.addEventListener('change', async () => {
    meldung('');
    vorschau.replaceChildren();
    const f = datei.files?.[0];
    if (!f) return;
    let daten;
    try {
      daten = JSON.parse(await f.text());
    } catch {
      meldung(fehlerText('SICHERUNG_UNGUELTIG'));
      return;
    }
    let p;
    try {
      p = await aufruf('pep_sicherung_pruefen', { p_daten: daten });
    } catch (e) {
      fehler(e);
      return;
    }
    zeichneVorschau(p, daten);
  });

  function zeichneVorschau(p, daten) {
    const fil = p.filiale;
    const mitNummer = Boolean(fil.nummer);
    const kopf = element('p', {}, 'Sicherung der Filiale ', element('strong', {}, fil.name),
      mitNummer ? ` (Nr. ${fil.nummer}, ${fil.bundesland})` : ` (${fil.bundesland})`,
      p.erstellt_am ? `, erstellt am ${new Date(p.erstellt_am).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}` : '', ':');
    if (!p.ziel_leer) {
      vorschau.replaceChildren(kopf, anzahlListe(p.anzahl), ...unbekanntHinweis(p.unbekannt),
        element('p', { class: 'hinweis-gelb', 'data-ziel-leer': 'nein' }, fehlerText('FILIALE_NICHT_LEER')));
      return;
    }
    const bestaetigung = eingabe('text', '', { autocomplete: 'off', required: true });
    const formular = zeilenformular(async () => {
      meldung('');
      const knopf = formular.querySelector('button[type="submit"]');
      knopf.disabled = true;
      try {
        const r = await aufruf('pep_sicherung_einspielen', { p_daten: daten, p_bestaetigung: bestaetigung.value });
        meldung('Sicherung eingespielt.', 'ok');
        zeichneErgebnis(r);
        datei.value = '';
        await nachEinspielen();
      } catch (e) {
        fehler(e);
        knopf.disabled = false;
      }
    }, feld(mitNummer ? 'Filialnummer zur Bestätigung' : 'Name der Filiale zur Bestätigung',
      bestaetigung), element('button', { type: 'submit' }, 'Einspielen'));
    vorschau.replaceChildren(kopf, anzahlListe(p.anzahl), ...unbekanntHinweis(p.unbekannt),
      element('p', { class: 'hinweis-gelb', 'data-ziel-leer': 'ja' },
        'Diese Filiale ist leer. Name, Nummer, Bundesland, Bereiche, Codes, Zeiten und Einstellungen werden durch die der Datei ersetzt.'),
      formular);
  }

  function zeichneErgebnis(r) {
    const aus = Object.entries(r.ausgelassen);
    const ein = r.eingespielt;
    vorschau.replaceChildren(element('div', { class: 'sicherung-ergebnis', 'data-ergebnis': 'eingespielt' },
      element('p', {}, element('strong', {}, 'Eingespielt:')),
      anzahlListe(Object.fromEntries(Object.entries(ein).filter(([t]) => t !== 'benutzer'))),
      ein.benutzer ? element('p', {}, `${ein.benutzer} Benutzer zugeordnet.`) : null,
      aus.length ? [element('p', {}, element('strong', {}, 'Ausgelassen:')),
        element('ul', { class: 'sicherung-anzahl' }, aus.map(([k, n]) => element('li', {},
          element('strong', {}, zahl(n)), ` ${AUSGELASSEN[k] ?? `${k} (Verweis fehlt)`}`)))]
        : element('p', {}, 'Nichts ausgelassen.'),
      unbekanntHinweis(r.unbekannt)));
  }

  box.replaceChildren(abschnitt('Sicherung',
    element('p', { class: 'hinweis' }, 'Supabase sichert die Daten im kostenlosen Tarif nicht. Bitte jede Woche eine ',
      'Sicherung herunterladen. Das Urlaubstool hat seine eigene Sicherung je Umfrage.'),
    element('p', { class: 'hinweis-gelb' }, HINWEIS_PERSONALDATEN),
    element('div', { class: 'zeile' }, laden),
    element('h3', {}, 'Sicherung einspielen'),
    element('p', { class: 'hinweis' }, 'Nur in eine leere Filiale (ohne Mitarbeiter, Abwesenheiten, Plan, IST und ',
      'Zeitkonto), z. B. nach einem Datenverlust in eine neu angelegte Filiale.'),
    element('div', { class: 'zeile' }, element('label', { class: 'feld breit' }, 'Datei wählen', datei)),
    vorschau));
}

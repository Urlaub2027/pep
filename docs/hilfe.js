// Gemeinsame Helfer der PEP-Oberfläche. Beim Import wird nichts am DOM angefasst.
export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export const $ = (id) => document.getElementById(id);

// Fehler (und Hinweise) stehen oben in der Seite, bis die nächste Meldung kommt.
// Erfolg (art 'ok') erscheint als Toast unten mittig und verschwindet nach 3 s.
let toastUhr = null;
export function meldung(text, art = 'fehler') {
  const m = $('meldung');
  const alsToast = Boolean(text) && art === 'ok';
  m.textContent = alsToast ? '' : text || '';
  m.hidden = alsToast || !text;
  m.className = `meldung ${art}`.trim();
  if (alsToast) zeigeToast(text);
  else if (text) m.scrollIntoView({ block: 'nearest' });
}

function zeigeToast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastUhr);
  toastUhr = setTimeout(() => { t.hidden = true; }, 3000);
}

const FEHLER = {
  // Browser-Schicht
  KEINE_VERBINDUNG: 'Keine Verbindung. Bitte prüfe dein Internet.',
  NICHT_ANGEMELDET: 'Deine Anmeldung ist abgelaufen. Bitte melde dich neu an.',
  invalid_credentials: 'Benutzername oder Passwort stimmt nicht.',
  invalid_grant: 'Benutzername oder Passwort stimmt nicht.',
  // Datenbank
  ABWEICHUNG_NICHT_GEFUNDEN: 'Diese Abweichung gibt es nicht (mehr).',
  ART_FEST: 'Die Art dieses Eintrags ist fest vorgegeben und lässt sich nicht ändern.',
  ART_UNGUELTIG: 'Die Art ist ungültig.',
  BENUTZER_NICHT_GEFUNDEN: 'Diesen Benutzer gibt es nicht (mehr).',
  BEREICH_NICHT_GEFUNDEN: 'Diesen Bereich gibt es nicht (mehr).',
  BUNDESLAND_UNGUELTIG: 'Bitte ein gültiges Bundesland wählen.',
  CODE_NICHT_GEFUNDEN: 'Diesen Code gibt es nicht (mehr).',
  DATUM_UNGUELTIG: 'Das Datum ist ungültig.',
  EINSTELLUNG_FEHLT: 'Diese Einstellung fehlt.',
  EINSTELLUNG_UNBEKANNT: 'Diese Einstellung gibt es nicht.',
  FARBE_UNGUELTIG: 'Die Farbe ist ungültig. Bitte eine Farbe wie #FFE500 angeben.',
  FILIALE_VORHANDEN: 'Es gibt schon eine Filiale.',
  FREIGABE_NICHT_GEFUNDEN: 'Diese Freigabe gibt es nicht (mehr).',
  FREIGABE_VORHANDEN: 'Diese Freigabe gibt es schon.',
  HALBE_STUNDE: 'Uhrzeiten nur in halben Stunden (:00 oder :30).',
  KEINE_FILIALE: 'Es ist noch keine Filiale angelegt.',
  KEIN_VERTRAG: 'Für dieses Datum gibt es keinen Vertrag.',
  KEIN_ZUGRIFF: 'Kein Zugriff: Dein Konto ist nicht für die PEP freigeschaltet.',
  KUERZEL_DOPPELT: 'Dieses Kürzel gibt es schon.',
  KUERZEL_UNGUELTIG: 'Das Kürzel ist ungültig.',
  LETZTER_VERTRAG: 'Der letzte Vertrag eines Mitarbeiters kann nicht gelöscht werden.',
  MITARBEITER_INAKTIV: 'Dieser Mitarbeiter ist nicht mehr aktiv.',
  MITARBEITER_NICHT_GEFUNDEN: 'Diesen Mitarbeiter gibt es nicht (mehr).',
  NAME_LEER: 'Bitte einen Namen eingeben.',
  NICHT_SELBST: 'Das kannst du bei dir selbst nicht machen.',
  NUR_LEITUNG: 'Das darf nur die Filialleitung.',
  ROLLE_UNGUELTIG: 'Die Rolle ist ungültig.',
  SCHULFERIEN_NICHT_GEFUNDEN: 'Diese Schulferien gibt es nicht (mehr).',
  STUNDENREGEL_UNGUELTIG: 'Die Stundenregel ist ungültig.',
  STUNDEN_FEHLEN: 'Bitte die Stunden angeben.',
  STUNDEN_UNGUELTIG: 'Die Stunden sind ungültig.',
  TEILNEHMER_NICHT_GEFUNDEN: 'Diesen Teilnehmer gibt es nicht (mehr).',
  UMFRAGE_NICHT_GEFUNDEN: 'Diese Umfrage gibt es nicht (mehr).',
  VERTRAGSART_UNGUELTIG: 'Die Vertragsart ist ungültig.',
  VERTRAG_DOPPELT: 'Für diesen Zeitraum gibt es schon einen Vertrag.',
  VERTRAG_NICHT_GEFUNDEN: 'Diesen Vertrag gibt es nicht (mehr).',
  WERT_UNGUELTIG: 'Der Wert ist ungültig.',
  WIEDERHOLUNG_NICHT_GEFUNDEN: 'Diese Wiederholung gibt es nicht (mehr).',
  WOCHENTAG_UNGUELTIG: 'Der Wochentag ist ungültig.',
  WOCHENVORGABE_NICHT_GEFUNDEN: 'Diese Wochenvorgabe gibt es nicht (mehr).',
  WUNSCH_UNGUELTIG: 'Der Wunsch ist ungültig.',
  ZEITEN_UNGUELTIG: 'Die Zeiten sind ungültig. „Bis“ muss nach „von“ liegen.',
  ZEITRAUM_UNGUELTIG: 'Der Zeitraum ist ungültig. „Bis“ darf nicht vor „von“ liegen.',
  ZEITRAUM_ZU_LANG: 'Der Zeitraum ist zu lang.',
};

export function fehlerText(code) {
  return FEHLER[code] || `Unerwarteter Fehler: ${code}`;
}

// element('button', { class: 'x', onclick: fn, hidden: true }, 'Text', kindElement)
export function element(tag, attrs = {}, ...kinder) {
  const e = document.createElement(tag);
  for (const [name, wert] of Object.entries(attrs || {})) {
    if (wert === false || wert == null) continue;
    if (name.startsWith('on') && typeof wert === 'function') e.addEventListener(name.slice(2), wert);
    else if (name === 'class') e.className = wert;
    else e.setAttribute(name, wert === true ? '' : wert);
  }
  for (const k of kinder.flat(Infinity)) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}

export function datumDE(iso) {
  const [j, m, t] = String(iso).slice(0, 10).split('-');
  return `${t}.${m}.${j}`;
}

export function stundenDE(n) {
  return Number(n).toFixed(2).replace('.', ',');
}

// ---------------------------------------------------------------- Formular-Bausteine (mehrere Reiter)

export const zahl = (wert) => (wert === '' || wert == null ? null : Number(String(wert).replace(',', '.')));
export const text = (wert) => (wert == null ? '' : String(wert));
export const datum = (wert) => (wert ? String(wert).slice(0, 10) : '');
export const uhrzeit = (wert) => (wert ? String(wert).slice(0, 5) : '');

export function feld(beschriftung, eingabefeld) {
  return element('label', { class: 'feld' }, beschriftung, eingabefeld);
}

export function eingabe(typ, wert, attrs = {}) {
  const e = element('input', { type: typ, ...attrs });
  if (typ === 'checkbox') e.checked = Boolean(wert);
  else e.value = text(wert);
  return e;
}

export function auswahlfeld(optionen, wert, attrs = {}) {
  const s = element('select', attrs,
    optionen.map(([schluessel, beschriftung]) => element('option', { value: schluessel }, beschriftung)));
  s.value = text(wert);
  return s;
}

export function zeilenformular(beimSenden, ...kinder) {
  return element('form', {
    class: 'zeile', novalidate: true,
    onsubmit: (ereignis) => { ereignis.preventDefault(); beimSenden(); },
  }, ...kinder);
}

export function abschnitt(titel, ...kinder) {
  return element('div', { class: 'box' }, element('h2', {}, titel), ...kinder);
}

// Führt eine schreibende Aktion aus: „Gespeichert.“, danach `danach()` (Neuladen).
// Rückgabe: Ergebnis der Aktion (bei leerem Ergebnis true). Bei Fehler Meldung (außer der Fehler ist schon behandelt, z. B. Abmeldung) und Rückgabe undefined.
export async function fuehreAus(aktion, danach) {
  meldung('');
  try {
    const ergebnis = await aktion();
    meldung('Gespeichert.', 'ok');
    await danach();
    return ergebnis ?? true; // Funktionen ohne Rückgabe: true; undefined bleibt dem Fehlerfall
  } catch (fehler) {
    if (!fehler.behandelt) meldung(fehlerText(fehler.message));
  }
}

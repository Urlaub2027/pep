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
  ABWESEND: 'Der Mitarbeiter ist zu dieser Zeit abwesend.',
  ART_FEST: 'Die Art dieses Eintrags ist fest vorgegeben und lässt sich nicht ändern.',
  ART_UNGUELTIG: 'Die Art ist ungültig.',
  AUSSERHALB_RAHMEN: 'Das liegt außerhalb der Planungszeit dieses Tages.',
  AUSSERHALB_ZEITRAHMEN: 'Arbeitszeiten lassen sich nur zwischen 04:00 und 24:00 Uhr erfassen.',
  BENUTZER_NICHT_GEFUNDEN: 'Diesen Benutzer gibt es nicht (mehr).',
  BESTAETIGUNG_FALSCH: 'Die Bestätigung stimmt nicht. Bitte die Filialnummer aus der Sicherung eintippen (ohne Nummer den Namen der Filiale).',
  BEREICH_NICHT_GEFUNDEN: 'Diesen Bereich gibt es nicht (mehr).',
  BEREICH_NICHT_MALBAR: 'Das ist eine Funktion (z. B. VP), kein Bereich – sie wird nur als Kompetenz vergeben.',
  BUNDESLAND_UNGUELTIG: 'Bitte ein gültiges Bundesland wählen.',
  CODE_NICHT_GEFUNDEN: 'Diesen Code gibt es nicht (mehr).',
  CODE_UNGUELTIG: 'Hier geht nur KM (krank) oder ZA (Zeitausgleich). Andere Abwesenheiten bitte im Reiter Abwesenheiten eintragen.',
  DATUM_UNGUELTIG: 'Das Datum ist ungültig.',
  EINSTELLUNG_FEHLT: 'Diese Einstellung fehlt.',
  EINSTELLUNG_UNBEKANNT: 'Diese Einstellung gibt es nicht.',
  FARBE_UNGUELTIG: 'Die Farbe ist ungültig. Bitte eine Farbe wie #FFE500 angeben.',
  FILIALE_NICHT_LEER: 'Diese Filiale ist nicht leer. Eine Sicherung lässt sich nur in eine Filiale ohne Mitarbeiter, Abwesenheiten, Plan, IST und Zeitkonto einspielen, z. B. in eine neu angelegte.',
  FILIALE_VORHANDEN: 'Es gibt schon eine Filiale.',
  FREIGABE_NICHT_GEFUNDEN: 'Diese Freigabe gibt es nicht (mehr).',
  FREIGABE_VORHANDEN: 'Diese Freigabe gibt es schon.',
  GESCHLOSSEN: 'An diesem Tag ist die Filiale geschlossen.',
  GRENZE_UNTER_VERTRAG: 'Die Grenze für Mehrarbeit darf nicht unter den Vertragsstunden liegen.',
  GRUND_FEHLT: 'Bitte einen Grund angeben. Er ist Pflicht bei Änderungen an bestätigten Tagen und bei Buchungen im Zeitkonto.',
  HALBE_STUNDE: 'Uhrzeiten nur in halben Stunden (:00 oder :30).',
  IST_AB_FEST: 'Nach dem ersten Wochenabschluss lässt sich der Start der IST-Erfassung nicht mehr ändern.',
  IST_OFFEN: 'In dieser Woche sind noch Tage offen. Bitte erst alle Tage im IST bestätigen, dann die Woche abschließen.',
  IST_VOR_START: 'Vor dem Start der IST-Erfassung (Einstellungen) gibt es kein IST – diese Tage zeigt nur der Plan.',
  JOURNAL_UNVERAENDERBAR: 'Buchungen im Zeitkonto lassen sich nicht ändern oder löschen. Bitte stattdessen eine Buchung zum Ausgleich anlegen.',
  KEIN_MONTAG: 'Bitte einen Montag wählen.',
  KEINE_FILIALE: 'Es ist noch keine Filiale angelegt.',
  KEIN_VERTRAG: 'Für dieses Datum gibt es keinen Vertrag.',
  KEIN_ZUGRIFF: 'Kein Zugriff: Dein Konto ist nicht für die PEP freigeschaltet.',
  KOMPETENZ_FEHLT: 'Dem Mitarbeiter fehlt die Kompetenz für diesen Bereich (siehe Mitarbeiterkarte).',
  KUERZEL_DOPPELT: 'Dieses Kürzel gibt es schon.',
  KUERZEL_UNGUELTIG: 'Das Kürzel ist ungültig.',
  LETZTER_VERTRAG: 'Der letzte Vertrag eines Mitarbeiters kann nicht gelöscht werden.',
  MITARBEITER_INAKTIV: 'Dieser Mitarbeiter ist an diesem Tag nicht beschäftigt (inaktiv, noch nicht eingetreten oder schon ausgetreten).',
  MITARBEITER_NICHT_GEFUNDEN: 'Diesen Mitarbeiter gibt es nicht (mehr).',
  MITARBEITER_WAEHLEN: 'Bitte einen Mitarbeiter wählen.',
  MODUS_UNGUELTIG: 'Bitte wählen, ob belegte Tage ersetzt oder nur leere Zeilen gefüllt werden sollen.',
  NAME_LEER: 'Bitte einen Namen eingeben.',
  NICHTS_UNBESETZT: 'An diesem Tag ist bei diesem Mitarbeiter nichts unbesetzt – es braucht keinen Ersatz.',
  NICHTS_ZU_KOPIEREN: 'An diesem Tag bzw. in dieser Woche ist nichts geplant – es gibt nichts zu kopieren.',
  NICHT_SELBST: 'Das kannst du bei dir selbst nicht machen.',
  NUR_LEITUNG: 'Das darf nur die Filialleitung.',
  ROLLE_UNGUELTIG: 'Die Rolle ist ungültig.',
  SCHULFERIEN_NICHT_GEFUNDEN: 'Diese Schulferien gibt es nicht (mehr).',
  SICHERUNG_NEUER: 'Die Sicherung stammt aus einer neueren PEP-Version. Bitte zuerst das Datenbank-Schema aktualisieren.',
  SICHERUNG_UNGUELTIG: 'Die Datei ist keine gültige PEP-Sicherung oder wurde verändert (Prüfsumme stimmt nicht).',
  START_NICHT_ERSTE: 'Ein Startsaldo geht nur als erste Buchung eines Mitarbeiters. Für spätere Änderungen bitte eine manuelle Buchung anlegen.',
  STUNDENREGEL_UNGUELTIG: 'Die Stundenregel ist ungültig.',
  STUNDEN_FEHLEN: 'Bitte die Stunden angeben.',
  STUNDEN_UNGUELTIG: 'Die Stunden sind ungültig.',
  TEILNEHMER_NICHT_GEFUNDEN: 'Diesen Teilnehmer gibt es nicht (mehr).',
  TEXT_ZU_LANG: 'Der Text ist zu lang (höchstens 200 Zeichen).',
  UEBERLAPPUNG: 'Dieser Mitarbeiter ist zu dieser Zeit schon eingeplant.',
  UMFRAGE_NICHT_GEFUNDEN: 'Diese Umfrage gibt es nicht (mehr).',
  UMFRAGE_ANDERE_FILIALE: 'Diese Umfrage ist schon in einer anderen Filiale eingeschaltet.',
  VERGANGEN: 'Vergangene Tage lassen sich nicht mehr ändern.',
  VERTRAGSART_UNGUELTIG: 'Die Vertragsart ist ungültig.',
  VERTRAG_DOPPELT: 'Für diesen Zeitraum gibt es schon einen Vertrag.',
  VERTRAG_NICHT_GEFUNDEN: 'Diesen Vertrag gibt es nicht (mehr).',
  VOR_IST_START: 'Vor dem Start der IST-Erfassung (Einstellungen) kann keine Woche abgeschlossen werden.',
  VORGABE_VERLETZT: 'Das verstößt gegen eine Pflicht-Vorgabe des Mitarbeiters (siehe Mitarbeiterkarte).',
  VORLAGE_DOPPELT: 'Eine Vorlage mit diesem Namen gibt es schon.',
  VORLAGE_LEER: 'An diesem Tag bzw. in dieser Woche ist nichts geplant – eine leere Vorlage lässt sich nicht speichern.',
  VORLAGE_NICHT_GEFUNDEN: 'Diese Vorlage gibt es nicht (mehr).',
  VORWOCHE_OFFEN: 'Wochen lassen sich nur der Reihe nach abschließen: zuerst die Woche, in der die IST-Erfassung startet (Einstellungen), danach jeweils die folgende.',
  WARENGRUPPE_DOPPELT: 'Eine Warengruppe mit diesem Namen gibt es schon.',
  WARENGRUPPE_NICHT_GEFUNDEN: 'Diese Warengruppe gibt es nicht (mehr).',
  WERT_UNGUELTIG: 'Der Wert ist ungültig.',
  WIEDERHOLUNG_NICHT_GEFUNDEN: 'Diese Wiederholung gibt es nicht (mehr).',
  WOCHE_GEBUCHT: 'Diese Woche ist schon abgeschlossen.',
  WOCHE_NICHT_VORBEI: 'Diese Woche ist noch nicht vorbei. Abschließen geht ab dem Montag danach.',
  WOCHENTAG_UNGUELTIG: 'Der Wochentag ist ungültig.',
  WOCHENVORGABE_NICHT_GEFUNDEN: 'Diese Wochenvorgabe gibt es nicht (mehr).',
  WUNSCH_UNGUELTIG: 'Der Wunsch ist ungültig.',
  ZEITEN_UNGUELTIG: 'Die Zeiten sind ungültig. „Bis“ muss nach „von“ liegen.',
  ZEITRAUM_UNGUELTIG: 'Der Zeitraum ist ungültig. „Bis“ darf nicht vor „von“ liegen.',
  ZEITRAUM_ZU_LANG: 'Der Zeitraum ist zu lang.',
  ZUKUNFT: 'Arbeitszeiten (IST) lassen sich erst ab dem Tag selbst erfassen, nicht für künftige Tage.',
  ZU_VIELE_ZIELE: 'Zu viele Ziele auf einmal (höchstens 60 Tage oder 12 Wochen).',
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

// Lesbare Schrift auf einer Code- oder Bereichsfarbe (#RRGGBB): dunkel auf hellem Grund, sonst weiß.
export function textfarbe(farbe) {
  const m = /^#([0-9a-f]{6})$/i.exec(farbe || '');
  if (!m) return '';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 > 140 ? '#111' : '#fff';
}

// ---------------------------------------------------------------- Formular-Bausteine (mehrere Reiter)

export const zahl = (wert) => (wert === '' || wert == null ? null : Number(String(wert).replace(',', '.')));
// Zahl aus deutscher Eingabe: '60.000' → 60000 (Punkt vor genau drei Ziffern = Tausendertrennung),
// '60000,50' und '60.000,50' → Komma ist das Dezimalzeichen, '60.5' → 60,5; Leerzeichen und € werden ignoriert.
// Leer → null, Unlesbares → NaN (der Aufrufer meldet WERT_UNGUELTIG).
export function geldZahl(wert) {
  const t = String(wert ?? '').replace(/[\s€]/g, '');
  if (t === '') return null;
  let n = t;
  if (t.includes(',')) n = /^(\d{1,3}(\.\d{3})*|\d*),\d*$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : '';
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = t.replace(/\./g, '');
  return /^(\d+(\.\d*)?|\.\d+)$/.test(n) && n !== '.' ? Number(n) : NaN;
}
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

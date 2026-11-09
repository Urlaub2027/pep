// Reine Zeit- und Kalenderhilfen (kein DOM, keine Importe).
// Alle Datumsrechnung läuft über Date.UTC, nie über Ortszeit: die Sommerzeit verschiebt nichts.

const TAG_MS = 86400000;

export function minuten(hhmm) {
  const [h, m] = String(hhmm).split(':');
  return Number(h) * 60 + Number(m);
}

export function uhrzeit(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Beginnzeiten aller Halbstunden von `von` bis `bis` (exklusiv).
export function halbstunden(von, bis) {
  const liste = [];
  for (let m = minuten(von); m < minuten(bis); m += 30) liste.push(uhrzeit(m));
  return liste;
}

function utc(iso) {
  const [j, m, t] = String(iso).slice(0, 10).split('-').map(Number);
  return Date.UTC(j, m - 1, t);
}

function iso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Heutiges Datum 'JJJJ-MM-TT' in Ortszeit, bei jedem Aufruf neu (ein über Nacht offenes Tablet springt mit).
// ersatz (z. B. ?heute= der Vorschau) gilt, wenn es ein Datum dieser Form ist. Einzige Stelle mit Ortszeit.
export function heuteDatum(ersatz = null, jetzt = new Date()) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ersatz ?? '')) return ersatz;
  const zwei = (n) => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}`;
}

export function plusTage(datum, n) {
  return iso(utc(datum) + n * TAG_MS);
}

// ISO-Woche: der Donnerstag der Woche bestimmt das Jahr.
export function isoWoche(datum) {
  const ms = utc(datum);
  const wochentag = (new Date(ms).getUTCDay() + 6) % 7; // Mo = 0
  const donnerstag = ms + (3 - wochentag) * TAG_MS;
  const jahr = new Date(donnerstag).getUTCFullYear();
  const kw = Math.floor((donnerstag - Date.UTC(jahr, 0, 1)) / TAG_MS / 7) + 1;
  return { jahr, kw };
}

// Montag der KW 1 ist der Montag der Woche mit dem 4. Januar.
export function montagDerKw(jahr, kw) {
  const vierter = Date.UTC(jahr, 0, 4);
  const wochentag = (new Date(vierter).getUTCDay() + 6) % 7;
  return iso(vierter - wochentag * TAG_MS + (kw - 1) * 7 * TAG_MS);
}

export function kwVorZurueck(jahr, kw, schritt) {
  return isoWoche(plusTage(montagDerKw(jahr, kw), schritt * 7));
}

export function tageDerWoche(jahr, kw) {
  const montag = montagDerKw(jahr, kw);
  return Array.from({ length: 7 }, (_, i) => plusTage(montag, i));
}

export function zeitspanne(von, bis) {
  return `${von}–${bis}`;
}

// Gleiche Schreibweise wie stundenDE in hilfe.js (zwei Stellen, Komma); hier doppelt,
// weil zeit.js bewusst ohne Importe bleibt.
export function stundenText(n) {
  return Number(n).toFixed(2).replace('.', ',');
}

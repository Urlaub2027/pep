// Reine Aufbereitung für die Mitarbeiter-Ansicht (docs/mein.js): kein DOM. Gerechnet wird in der Datenbank
// (pep_mein_*); hier wird nur zu Text gemacht.
import { plusTage } from './zeit.js';

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const rund = (n) => Math.round(Number(n) * 100) / 100 || 0; // Rechenreste wie −0 werden 0
const kurz = (n) => Math.abs(rund(n)).toFixed(2).replace(/\.?0+$/, '').replace('.', ',') || '0';
const tm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const tmj = (iso) => `${tm(iso)}${iso.slice(0, 4)}`;

// Stunden ohne überflüssige Nullen: '80 h', '7,5 h', negativ mit echtem Minuszeichen; ohne Wert '—'.
export function stundenKurz(n) {
  if (n == null || n === '') return '—';
  return `${rund(n) < 0 ? '−' : ''}${kurz(n)} h`;
}

const zeitraum = (von, bis) => `${von}–${bis}`;

// Zeilen einer Tageskarte: Arbeitszeiten (Pause mit Wort statt Bereichskürzel), eigene Abwesenheit, Kommentar.
// art: 'feiertag' | 'zeit' | 'abwesenheit' | 'kommentar' | 'leer'.
export function tagZeilen(tag) {
  const zeilen = [];
  if (tag.feiertag) zeilen.push({ art: 'feiertag', text: `Feiertag: ${tag.feiertag}` });
  if (tag.bloecke?.length) {
    zeilen.push({
      art: 'zeit',
      text: tag.bloecke.map((b) => (b.pause ? `Pause ${zeitraum(b.von, b.bis)}` : `${zeitraum(b.von, b.bis)} ${b.bereich_kuerzel}`)).join(', '),
    });
  }
  const a = tag.abwesenheit;
  if (a) {
    const zusatz = a.von && a.bis ? ` ${zeitraum(a.von, a.bis)}` : '';
    zeilen.push({ art: 'abwesenheit', text: `${a.name} (${a.code})${zusatz}` });
  }
  if (tag.kommentar) zeilen.push({ art: 'kommentar', text: tag.kommentar });
  if (!zeilen.length) zeilen.push({ art: 'leer', text: tag.geoeffnet ? 'Nicht eingeteilt' : 'Geschlossen' });
  return zeilen;
}

// Arbeitet der Mitarbeiter an dem Tag? Mindestens ein Block, der keine Pause ist (wie pep.mein_tag für die Kollegen).
export function arbeitetAn(tag) {
  return (tag.bloecke ?? []).some((b) => !b.pause);
}

// „Jo 08:00–16:00; Ida 12:00–20:00“ (mehrere Zeiträume einer Person mit Komma).
export function kollegenText(kollegen) {
  return (kollegen ?? []).map((k) => `${k.name} ${k.zeiten.map((z) => zeitraum(z.von, z.bis)).join(', ')}`).join('; ');
}

// Eine Wochenbuchung trägt das Datum des Montags; „stand“ ist also kein Tag, sondern eine Woche.
export function saldoText(saldo, stand) {
  if (saldo == null) return 'noch keine Buchung';
  const n = rund(saldo);
  const text = `${n > 0 ? '+' : n < 0 ? '−' : ''}${kurz(n)} h`;
  return stand ? `${text}, Stand: Woche ab ${tmj(stand)}` : text;
}

export function tagKopf(datum) {
  return `${WOCHENTAGE[(new Date(`${datum}T12:00:00Z`).getUTCDay() + 6) % 7]} ${tm(datum)}`;
}

export function wochenText(w) {
  return `KW ${w.kw} · ${tm(w.montag)}–${tmj(plusTage(w.montag, 6))}`;
}

// Zeitstempel in Ortszeit; je Woche, nicht je Person – darum nie neben der Kollegenliste.
export function geaendertText(zeitstempel) {
  if (!zeitstempel) return '';
  const d = new Date(zeitstempel);
  const zwei = (n) => String(n).padStart(2, '0');
  return `zuletzt geändert am ${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}.${d.getFullYear()}`;
}

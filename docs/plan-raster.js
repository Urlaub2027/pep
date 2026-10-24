// Reine Plan-Logik (kein DOM). Eingabe `woche` = Antwort von public.pep_einsatzplan_woche.
// Blöcke sind Abschnitte: dieselbe id kann mehrfach vorkommen, jeder Abschnitt hat sein eigenes
// `unbesetzt`. Unbesetzte Abschnitte zählen nirgends (F2).
import { minuten, uhrzeit, plusTage, kwVorZurueck } from './zeit.js';
import { WOCHENTAGE } from './hilfe.js';

const stunden = (b) => (minuten(b.bis) - minuten(b.von)) / 60;
const alsMenge = (ids) => (ids instanceof Set ? ids : new Set(ids ?? []));

// Eine Position je Halbstunde der Spalten: Zellbeschreibung oder null. Erwartet die Abschnitte EINER Zeile (ein Mitarbeiter, ein Tag).
export function zellen(bloecke, spalten) {
  return spalten.map((beginn) => {
    const m = minuten(beginn);
    const b = bloecke.find((x) => minuten(x.von) <= m && m < minuten(x.bis));
    return b ? { bereich_id: b.bereich_id, block_id: b.id, unbesetzt: !!b.unbesetzt } : null;
  });
}

// Zieh-Strich über Zellindizes; Richtung egal, `bis` ist das Ende der letzten Zelle.
export function strich(spalten, startIndex, endIndex) {
  const a = Math.min(startIndex, endIndex);
  const z = Math.max(startIndex, endIndex);
  return { von: spalten[a], bis: uhrzeit(minuten(spalten[z]) + 30) };
}

// Abdeckung je Halbstunde eines Tages (F2, F3, F5): nur besetzte Abschnitte.
export function abdeckung(woche, datum, spalten) {
  const bereiche = new Map((woche.bereiche ?? []).map((b) => [b.id, b]));
  const vpIds = new Set((woche.mitarbeiter ?? []).filter((m) => m.vp === true).map((m) => m.id));
  const tag = (woche.bloecke ?? []).filter((b) => b.datum === datum && !b.unbesetzt);
  const kasse = [];
  const vp = [];
  const anwesend = [];
  for (const beginn of spalten) {
    const m = minuten(beginn);
    const da = tag.filter((b) => minuten(b.von) <= m && m < minuten(b.bis));
    const arbeit = da.filter((b) => bereiche.get(b.bereich_id)?.art !== 'pause');
    kasse.push(new Set(arbeit.filter((b) => bereiche.get(b.bereich_id)?.bedeutung === 'kasse').map((b) => b.mitarbeiter_id)).size);
    vp.push(new Set(da.filter((b) => vpIds.has(b.mitarbeiter_id)).map((b) => b.mitarbeiter_id)).size);
    anwesend.push(new Set(da.map((b) => b.mitarbeiter_id)).size);
  }
  return { kasse, vp, anwesend };
}

// Ampelklasse einer Abdeckungszelle. art: 'kasse' | 'vp'.
export function abdeckungsKlasse(art, anzahl, inOeffnung, anwesend) {
  if (art === 'kasse') {
    if (!inOeffnung) return '';
    return anzahl === 0 ? 'rot' : anzahl === 1 ? 'gelb' : '';
  }
  if (art === 'vp') {
    if (anzahl > 0) return '';
    return inOeffnung || anwesend > 0 ? 'rot' : '';
  }
  return '';
}

// Stunden einer Block-Liste (F4): ohne unbesetzte Abschnitte und ohne Pause-Bereiche.
export function tagesStunden(bloecke, pauseIds) {
  const pausen = alsMenge(pauseIds);
  return bloecke
    .filter((b) => !b.unbesetzt && !pausen.has(b.bereich_id))
    .reduce((summe, b) => summe + stunden(b), 0);
}

const pauseIdsDerWoche = (woche) => new Set((woche.bereiche ?? []).filter((b) => b.art === 'pause').map((b) => b.id));

// Je Mitarbeiter: soll = Vertrag - Abwesenheitsstunden der Woche (F6; abwesenheiten[].stunden sind schon die angerechneten Stunden),
// geplant = besetzte Stunden ohne Pause, differenz = geplant - soll.
export function wochenSummen(woche) {
  const pausen = pauseIdsDerWoche(woche);
  const ergebnis = new Map();
  for (const m of woche.mitarbeiter ?? []) {
    const abwesend = (woche.abwesenheiten ?? [])
      .filter((a) => a.mitarbeiter_id === m.id)
      .reduce((s, a) => s + (Number(a.stunden) || 0), 0);
    const soll = (Number(m.wochenstunden) || 0) - abwesend;
    const geplant = tagesStunden((woche.bloecke ?? []).filter((b) => b.mitarbeiter_id === m.id), pausen);
    ergebnis.set(m.id, { soll, geplant, differenz: geplant - soll });
  }
  return ergebnis;
}

// Besetzte Stunden je Bereich an einem Tag (Pause-Bereiche kommen nicht vor).
export function bereichsStunden(woche, datum) {
  const pausen = pauseIdsDerWoche(woche);
  const ergebnis = new Map();
  for (const b of woche.bloecke ?? []) {
    if (b.datum !== datum || b.unbesetzt || pausen.has(b.bereich_id)) continue;
    ergebnis.set(b.bereich_id, (ergebnis.get(b.bereich_id) ?? 0) + stunden(b));
  }
  return ergebnis;
}

// Rückgängig-Stapel (F10): der älteste Eintrag fällt heraus, wenn mehr als `max` gemerkt sind.
export function rueckgaengigStapel(max = 20) {
  const eintraege = [];
  return {
    merken(eintrag) {
      eintraege.push(eintrag);
      while (eintraege.length > max) eintraege.shift();
    },
    holen: () => eintraege.pop(),
    leer: () => eintraege.length === 0,
  };
}

// ---------------------------------------------------------------- Kopieren und Vorlagen

// Derselbe Wochentag wie `datum` in jeder folgenden Woche bis einschließlich `bis` (ISO-Text vergleicht wie Datum).
export function gleicheWochentageBis(datum, bis) {
  const liste = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bis ?? '')) return liste;
  for (let d = plusTage(datum, 7); d <= bis; d = plusTage(d, 7)) liste.push(d);
  return liste;
}

// Die n ISO-Wochen nach (jahr, kw) als [{ jahr, kw }].
export function naechsteWochen(jahr, kw, n) {
  return Array.from({ length: Math.max(0, n) }, (_, i) => kwVorZurueck(jahr, kw, i + 1));
}

// „Mo 16.11.“
export function tagKurz(iso) {
  const [j, m, t] = iso.split('-').map(Number);
  return `${WOCHENTAGE[(new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

const anzahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;

// Meldung nach Kopieren oder Vorlage laden, z. B. „5 Tage kopiert: 42 Blöcke, 3 unbesetzt, 1 gekürzt, 2 ausgelassen“.
export function kopierErgebnis(r, verb = 'kopiert') {
  const teile = [anzahl(r.bloecke, 'Block', 'Blöcke')];
  if (r.unbesetzt) teile.push(`${r.unbesetzt} unbesetzt`);
  if (r.gekuerzt) teile.push(`${r.gekuerzt} gekürzt`);
  if (r.ausgelassen) teile.push(`${r.ausgelassen} ausgelassen`);
  let text = `${anzahl(r.tage, 'Tag', 'Tage')} ${verb}: ${teile.join(', ')}`;
  if (r.uebersprungen?.length) {
    text += `. Übersprungen: ${r.uebersprungen.map((u) => `${tagKurz(u.datum)} (${u.grund})`).join(', ')}`;
  }
  if (r.ausgeschieden?.length) text += `. Nicht mehr beschäftigt: ${r.ausgeschieden.join(' · ')}`;
  return text;
}

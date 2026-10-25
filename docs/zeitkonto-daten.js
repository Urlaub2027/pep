// Reine Aufbereitung für den Reiter Zeitkonto (docs/zeitkonto.js): kein DOM, keine Importe.
// Gerechnet wird in der Datenbank (pep.zeitkonto_woche, Journal); hier wird nur formatiert, sortiert und summiert.

const rund = (n) => Math.round(Number(n) * 100) / 100 || 0; // Rechenreste wie −0 und −0,001 werden 0

// Stunden mit Vorzeichen und zwei Stellen: '+2,50', '−1,25' (echtes Minuszeichen), '0,00'; ohne Wert '–'.
export function vorzeichen(n) {
  if (n == null || n === '') return '–';
  const r = rund(n);
  const betrag = Math.abs(r).toFixed(2).replace('.', ',');
  return r > 0 ? `+${betrag}` : r < 0 ? `−${betrag}` : betrag;
}

// korrektur bucht die Datenbank selbst (G5, Änderung in einer abgeschlossenen Woche); manuell ist „Korrektur buchen“.
export const ART_TEXT = {
  start: 'Startsaldo', woche: 'Wochenabschluss', korrektur: 'Korrektur (automatisch)', manuell: 'Korrektur von Hand',
};

// Zeilen des Journal-Dialogs aus pep_zeitkonto_journal. Reihenfolge = Buchungsreihenfolge (id), nicht datum: saldo_nach
// ist der Saldo nach der Buchung in id-Reihenfolge (G3). Nach datum sortiert spränge die Saldo-Spalte, sobald eine
// Korrektur für eine alte Woche später gebucht wird. Die Woche steht darum in einer eigenen Spalte („KW 45/2026“,
// ISO-Jahr aus der Antwort).
export function journalZeilen(buchungen) {
  return [...(buchungen ?? [])].sort((a, b) => a.id - b.id).map((b) => ({
    id: b.id,
    datum: b.datum,
    kw: `KW ${b.kw}/${b.jahr}`,
    art: ART_TEXT[b.art] ?? b.art,
    stunden: Number(b.stunden),
    saldo: Number(b.saldo_nach),
    grund: b.grund ?? '',
    von: b.angelegt_von_name ?? '',
    am: b.angelegt_am ? String(b.angelegt_am).slice(0, 10) : '',
  }));
}

// Summenzeile der Wochentabelle über alle angezeigten Mitarbeiter.
export function wochenSumme(mitarbeiter) {
  const summe = { soll: 0, ist: 0, abwesend: 0, feiertag: 0, diff: 0 };
  for (const m of mitarbeiter ?? []) {
    for (const k of Object.keys(summe)) summe[k] += Number(m[k] ?? 0);
  }
  for (const k of Object.keys(summe)) summe[k] = rund(summe[k]);
  return summe;
}

// Stunden aus der Eingabe einer Buchung: Komma oder Punkt als Dezimalzeichen, Minus auch als „−“, höchstens zwei
// Nachkommastellen, Betrag bis 999, nicht 0 (dieselben Regeln prüft pep_zeitkonto_buchen: STUNDEN_UNGUELTIG).
// Leer → null (STUNDEN_FEHLEN), Unlesbares → NaN.
export function stundenEingabe(wert) {
  const t = String(wert ?? '').replace(/\s/g, '').replace(/−/g, '-');
  if (t === '') return null;
  const m = /^([+-]?)(\d{0,3})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m || (m[2] === '' && m[3] === undefined)) return NaN;
  const n = Number(`${m[1]}${m[2] || '0'}.${m[3] ?? '0'}`);
  return n === 0 ? NaN : n;
}

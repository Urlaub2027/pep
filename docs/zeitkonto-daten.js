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
    am: b.angelegt_am ? ortsDatum(b.angelegt_am) : '',
  }));
}

// Datum 'JJJJ-MM-TT' eines Zeitstempels in Ortszeit (wie die Uhrzeit im Kopf „Abgeschlossen am …“), nicht der
// Text vor dem 'T': eine Buchung um 00:30 deutscher Zeit trägt in UTC noch das Vortagsdatum.
function ortsDatum(zeitstempel) {
  const d = new Date(zeitstempel);
  const zwei = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${zwei(d.getMonth() + 1)}-${zwei(d.getDate())}`;
}

// Summenzeile der Wochentabelle über alle angezeigten Mitarbeiter. Die Diff zählt nur, wo sie gebucht ist bzw. beim
// Abschluss gebucht wird (pep_zeitkonto_woche.gebucht; fehlt das Feld, wie gebucht): Die Summe soll zeigen, was ins
// Zeitkonto geht, nicht die Diff von Inaktiven oder nach dem Abschluss Angelegten. vorStart (Woche vor dem Start der
// IST-Erfassung, pep_zeitkonto_woche.vor_ist_start): nichts wird gebucht, Diff null (Anzeige „–“ statt einer 0,00).
export function wochenSumme(mitarbeiter, { vorStart = false } = {}) {
  const summe = { soll: 0, ist: 0, abwesend: 0, feiertag: 0, diff: 0 };
  for (const m of mitarbeiter ?? []) {
    for (const k of Object.keys(summe)) {
      if (k !== 'diff' || m.gebucht !== false) summe[k] += Number(m[k] ?? 0);
    }
  }
  for (const k of Object.keys(summe)) summe[k] = rund(summe[k]);
  if (vorStart) summe.diff = null;
  return summe;
}

// Stunden aus der Eingabe einer Buchung: Komma oder Punkt als Dezimalzeichen, Minus auch als „−“, höchstens zwei
// Nachkommastellen, Betrag bis 999, nicht 0 (dieselben Regeln prüft pep_zeitkonto_buchen: STUNDEN_UNGUELTIG).
// Leerzeichen nur am Rand und eines direkt nach dem Vorzeichen („− 3,75“); „1 2“ ist ungültig.
// Leer → null (STUNDEN_FEHLEN), Unlesbares → NaN.
export function stundenEingabe(wert) {
  const t = String(wert ?? '').trim().replace(/−/g, '-');
  if (t === '') return null;
  const m = /^(?:([+-]) ?)?(\d{0,3})(?:[.,](\d{1,2}))?$/.exec(t);
  if (!m || (m[2] === '' && m[3] === undefined)) return NaN;
  const n = Number(`${m[1] ?? ''}${m[2] || '0'}.${m[3] ?? '0'}`);
  return n === 0 ? NaN : n;
}

// Warnung zum Saldo – Spiegel der Regel in public.pep_zeitkonto_woche (supabase/schema.sql): 'plus', wenn der Saldo über
// zeitkonto_warnfaktor × wochenstunden liegt, 'minus', wenn er unter dem Negativen davon liegt, sonst null (die Grenze
// selbst warnt nicht). Der Browser braucht sie für die laufende Woche, in der die Warnung am Saldo Vorwoche hängt; ändert
// sich die Regel im Schema, muss sie hier mitgeändert werden. Ohne Faktor keine Warnung (SQL: Vergleich mit NULL).
export function saldoWarnung(saldo, wochenstunden, faktor) {
  if (faktor == null || faktor === '') return null;
  const s = Number(saldo);
  const grenze = Number(faktor) * Number(wochenstunden);
  return s > grenze ? 'plus' : s < -grenze ? 'minus' : null;
}

// Laufende (oder künftige) Woche: nicht abgeschlossen und ihr Sonntag ist nicht vor heute. Diff und Saldo aktuell sind
// dann vorläufig (das Soll gilt für die ganze Woche, das IST erst bis heute).
export function laufendeWoche(woche, heute) {
  if (woche.abgeschlossen) return false;
  const [j, m, t] = woche.montag.split('-').map(Number);
  const sonntag = new Date(Date.UTC(j, m - 1, t + 6)).toISOString().slice(0, 10);
  return sonntag >= heute;
}

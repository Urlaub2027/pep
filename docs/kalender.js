// Reine Logik für das Abwesenheitsraster (kein DOM, keine Importe).

// Fasst aufeinanderfolgende Tage mit gleicher Kalenderwoche zusammen: [{kw, tage}]
export function wochenGruppen(tage) {
  const gruppen = [];
  for (const t of tage) {
    const letzte = gruppen[gruppen.length - 1];
    if (letzte && letzte.kw === t.kw) letzte.tage.push(t);
    else gruppen.push({ kw: t.kw, tage: [t] });
  }
  return gruppen;
}

// ISO-Daten lassen sich als Text ordnen.
export function ziehBereich(startDatum, endDatum) {
  return startDatum <= endDatum ? { von: startDatum, bis: endDatum } : { von: endDatum, bis: startDatum };
}

export function monatVorZurueck(jahr, monat, schritt) {
  const index = jahr * 12 + (monat - 1) + schritt;
  return { jahr: Math.floor(index / 12), monat: (index % 12) + 1 };
}

// Klassen einer Tageszelle (tag = Eintrag aus pep_abwesenheiten().tage)
export function zellenKlasse(tag) {
  const klassen = [];
  if (tag.wochentag >= 6) klassen.push('wochenende');
  if (tag.feiertag) klassen.push('feiertag');
  if (tag.schulferien) klassen.push('schulferien');
  if (!tag.geoeffnet) klassen.push('geschlossen');
  return klassen;
}

const stunde = (zeit) => {
  const [h, m] = String(zeit).split(':');
  return m && m !== '00' ? `${h}:${m}` : h;
};

// 'U 6,25'; mit Uhrzeit 'BS 08–13'; ohne Stunden nur das Kürzel
export function stundenAnzeige(eintrag) {
  if (eintrag.von && eintrag.bis) return `${eintrag.code} ${stunde(eintrag.von)}–${stunde(eintrag.bis)}`;
  if (eintrag.stunden == null) return eintrag.code;
  return `${eintrag.code} ${Number(eintrag.stunden).toFixed(2).replace('.', ',')}`;
}

// Kurze Stundenanzeige für enge Zellen: 13 → '13', 6.25 → '6,25', 14.5 → '14,50'; 0 und null → ''.
export function kurzStunden(n) {
  if (n == null || Number(n) === 0) return '';
  const zahl = Number(n);
  return Number.isInteger(zahl) ? String(zahl) : zahl.toFixed(2).replace('.', ',');
}

// Reine Plan-Logik (kein DOM). Eingabe `woche` = Antwort von public.pep_einsatzplan_woche.
// Blöcke sind Abschnitte: dieselbe id kann mehrfach vorkommen, jeder Abschnitt hat sein eigenes
// `unbesetzt`. Unbesetzte Abschnitte zählen nirgends (F2).
import { minuten, uhrzeit, plusTage, kwVorZurueck, stundenText } from './zeit.js';
import { WOCHENTAGE } from './hilfe.js';

const stunden = (b) => (minuten(b.bis) - minuten(b.von)) / 60;
const alsMenge = (ids) => (ids instanceof Set ? ids : new Set(ids ?? []));

// Stunden kurz und mit Komma: 7,5 · 8 · 6,25; negative mit echtem Minuszeichen (Einsatzplan, Plan und IST).
export const rund = (n) => Math.round(n * 100) / 100 || 0; // Rechenreste wie −1e-15 und −0 werden 0
export const kurz = (n) => `${rund(n) < 0 ? '−' : ''}${Math.abs(rund(n)).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}`;

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

// Abdeckung je Halbstunde eines Tages (F2, F3, F5): nur besetzte Abschnitte. vp = VPs anwesend, vpFrei = davon nicht
// an der Kasse gebunden: in der Öffnungszeit (offen je Spalte) an der Kasse, niemand mit Kassenkompetenz frei (nicht
// Kasse, nicht Pause), erst ab mehr als 30 min am Stück. Fachregel-Duplikat von vp_kasse/gebunden in pep.pruefung.
export function abdeckung(woche, datum, spalten, offen = spalten.map(() => true)) {
  const bereiche = new Map((woche.bereiche ?? []).map((b) => [b.id, b]));
  const vpIds = new Set((woche.mitarbeiter ?? []).filter((m) => m.vp === true).map((m) => m.id));
  const kassenBereich = (woche.bereiche ?? []).find((b) => b.bedeutung === 'kasse');
  const kannKasse = new Set((woche.mitarbeiter ?? [])
    .filter((m) => !kassenBereich?.kompetenz_noetig || (m.kompetenzen ?? []).includes(kassenBereich.id)).map((m) => m.id));
  const tag = (woche.bloecke ?? []).filter((b) => b.datum === datum && !b.unbesetzt);
  const kasse = [];
  const vp = [];
  const anwesend = [];
  const anKasse = new Map(); // VP → je Halbstunde an der Kasse ohne Ablösung
  spalten.forEach((beginn, i) => {
    const m = minuten(beginn);
    const da = tag.filter((b) => minuten(b.von) <= m && m < minuten(b.bis));
    const arbeit = da.filter((b) => bereiche.get(b.bereich_id)?.art !== 'pause');
    const anDerKasse = arbeit.filter((b) => bereiche.get(b.bereich_id)?.bedeutung === 'kasse');
    kasse.push(new Set(anDerKasse.map((b) => b.mitarbeiter_id)).size);
    vp.push(new Set(da.filter((b) => vpIds.has(b.mitarbeiter_id)).map((b) => b.mitarbeiter_id)).size);
    anwesend.push(new Set(da.map((b) => b.mitarbeiter_id)).size);
    const abloese = arbeit.some((b) => !anDerKasse.includes(b) && kannKasse.has(b.mitarbeiter_id));
    if (!offen[i] || abloese) return;
    for (const b of anDerKasse.filter((x) => vpIds.has(x.mitarbeiter_id))) {
      if (!anKasse.has(b.mitarbeiter_id)) anKasse.set(b.mitarbeiter_id, []);
      anKasse.get(b.mitarbeiter_id)[i] = true;
    }
  });
  const vpFrei = vp.map((n, i) => n - [...anKasse.values()].filter((x) => x[i] && (x[i - 1] || x[i + 1])).length);
  return { kasse, vp, vpFrei, anwesend };
}

// Ampelklasse einer Abdeckungszelle. art: 'kasse' | 'vp' (anzahl = freie VPs). VP gelb: allein in der Öffnungszeit.
export function abdeckungsKlasse(art, anzahl, inOeffnung, anwesend) {
  if (art === 'kasse') {
    if (!inOeffnung) return '';
    return anzahl === 0 ? 'rot' : anzahl === 1 ? 'gelb' : '';
  }
  if (art === 'vp') {
    if (anzahl > 0) return inOeffnung && anwesend === 1 ? 'gelb' : '';
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

// Lieferung (L3): je Bereich mit zählender Warengruppe nötig (Rollis × Minuten, auf halbe Stunden aufgerundet),
// geplant (besetzt, ohne Pause, ab LKW-Zeit; ohne LKW der ganze Tag) und fehlt. Ohne Eintrag für den Tag: leer.
export function lieferBedarf(woche, datum) {
  const tag = woche.lieferung?.[datum];
  if (!tag) return { lkw: null, lkwAusMuster: true, gruppen: [], bereiche: [] };
  const rollis = new Map((tag.rollis ?? []).map((r) => [r.warengruppe_id, r]));
  const gruppen = (woche.warengruppen ?? []).map((g) => ({
    id: g.id, name: g.name, bereich_id: g.bereich_id, minuten: g.minuten,
    rollis: rollis.get(g.id)?.rollis ?? 0, ausMuster: rollis.get(g.id)?.aus_muster ?? true,
  }));
  const ab = tag.lkw ? minuten(tag.lkw) : 0;
  const pausen = pauseIdsDerWoche(woche);
  const bereiche = (woche.bereiche ?? [])
    .filter((b) => gruppen.some((g) => g.bereich_id === b.id))
    .map((b) => {
      const summe = gruppen.filter((g) => g.bereich_id === b.id).reduce((s, g) => s + g.rollis * g.minuten, 0);
      const noetig = Math.ceil(summe / 30) / 2;
      const geplant = (woche.bloecke ?? [])
        .filter((x) => x.datum === datum && !x.unbesetzt && !pausen.has(x.bereich_id) && x.bereich_id === b.id)
        .reduce((s, x) => s + Math.max(0, minuten(x.bis) - Math.max(minuten(x.von), ab)) / 60, 0);
      return { bereich_id: b.id, noetig, geplant, fehlt: Math.max(0, noetig - geplant) };
    });
  return { lkw: tag.lkw ?? null, lkwAusMuster: tag.lkw_aus_muster ?? true, gruppen, bereiche };
}

// Lieferung (L4): Varianten für 1 bis 3 Personen; Anteile in halben Stunden, die größeren zuerst. Mehr als eine
// Person nur, wenn der kleinste Anteil mindestens 1 h hat. fehlt <= 0 gibt keine Variante.
export function aufteilung(fehlt) {
  if (!(fehlt > 0)) return [];
  const halbe = Math.round(fehlt * 2);
  const varianten = [];
  for (const n of [1, 2, 3]) {
    const basis = Math.floor(halbe / n);
    const rest = halbe % n;
    if (n > 1 && basis < 2) continue;
    varianten.push(Array.from({ length: n }, (_, i) => (basis + (i < rest ? 1 : 0)) / 2));
  }
  return varianten;
}

// Lieferung (L4): vorausgewählte Variante. Die mit den wenigsten Personen, deren größter Anteil höchstens 6 h hat;
// gibt es keine, die mit dem kleinsten größten Anteil (also die mit den meisten Personen). Leere Liste: -1.
export function standardVariante(varianten) {
  if (!varianten.length) return -1;
  const groesste = varianten.map((v) => Math.max(...v));
  const passend = groesste.findIndex((g) => g <= 6);
  if (passend >= 0) return passend;
  return groesste.indexOf(Math.min(...groesste));
}

// Lieferung (L5): Vorschlagsblock ab LKW-Zeit (ohne LKW ab Rahmenbeginn), auf den Rahmen gekürzt; null, wenn nichts bleibt.
export function vorschlagBlock(lkw, anteil, rahmen) {
  const von = Math.max(lkw ? minuten(lkw) : minuten(rahmen.von), minuten(rahmen.von));
  const bis = Math.min(von + Math.round(anteil * 60), minuten(rahmen.bis));
  return von < bis ? { von: uhrzeit(von), bis: uhrzeit(bis) } : null;
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
  if (r.belegt_uebersprungen) text += `. ${anzahl(r.belegt_uebersprungen, 'Zeile', 'Zeilen')} schon belegt, nicht geändert`;
  if (r.uebersprungen?.length) {
    text += `. Übersprungen: ${r.uebersprungen.map((u) => `${tagKurz(u.datum)} (${u.grund})`).join(', ')}`;
  }
  if (r.ausgeschieden?.length) text += `. Nicht mehr beschäftigt: ${r.ausgeschieden.join(' · ')}`;
  return text;
}

// ---------------------------------------------------------------- Krank/ZA und Ersatz

// „Mo 09.11.“ oder „Mo 09.11.–Mi 11.11.“
export function tageText(von, bis) {
  return von === bis ? tagKurz(von) : `${tagKurz(von)}–${tagKurz(bis)}`;
}

// Offene Wochenstunden eines Ersatzes (luecke = Soll − geplant, F6): „noch 12,50 h offen“, „Woche voll“, „1,25 h über Soll“.
// Zahlen wie überall im Ersatz- und Eckdaten-Fenster mit zwei Stellen (stundenText).
export function lueckeText(luecke) {
  const n = Math.round(Number(luecke) * 100) / 100 || 0;
  if (n > 0) return `noch ${stundenText(n)} h offen`;
  if (n < 0) return `${stundenText(-n)} h über Soll`;
  return 'Woche voll';
}

// Unbesetzte Blöcke im Ersatz-Fenster (Antwort von pep_ersatz_kandidaten, [{von, bis, bereich_id}]): Pausen stehen
// nicht als eigener Block da, sondern als „inkl. Pause 12:30–13:00“ (der Ersatz übernimmt die Schicht samt Pause).
// stunden = Arbeitsstunden der Übernahme ohne Pause, wie pep.arbeitsstunden (F4). Ist nur eine Pause unbesetzt,
// bleibt sie als Block stehen (0 h).
export function ersatzBloecke(unbesetzt, pauseIds) {
  const pausen = alsMenge(pauseIds);
  const istPause = (b) => pausen.has(b.bereich_id);
  const arbeit = (unbesetzt ?? []).filter((b) => !istPause(b));
  const pause = (unbesetzt ?? []).filter(istPause);
  if (!arbeit.length) return { arbeit: pause, pauseText: '', stunden: 0 };
  const pauseText = pause.length
    ? `inkl. ${pause.length === 1 ? 'Pause' : 'Pausen'} ${pause.map((b) => `${b.von}–${b.bis}`).join(', ')}` : '';
  return { arbeit, pauseText, stunden: arbeit.reduce((summe, b) => summe + stunden(b), 0) };
}

// Was die Übernahme von den offenen Wochenstunden eines Kandidaten verbraucht (luecke = Soll − geplant vor der
// Übernahme): „Übernahme 8,00 h · danach noch 2,00 h offen“ bzw. „… danach 1,50 h über Soll“ (ueber = true).
export function uebernahmeText(stundenUebernahme, luecke) {
  const h = Math.round(Number(stundenUebernahme) * 100) / 100 || 0;
  const rest = Math.round((Number(luecke) - h) * 100) / 100 || 0;
  const danach = rest > 0 ? `danach noch ${stundenText(rest)} h offen` : rest < 0 ? `danach ${stundenText(-rest)} h über Soll` : 'danach Woche voll';
  return { text: `Übernahme ${stundenText(h)} h · ${danach}`, ueber: rest < 0 };
}

// ---------------------------------------------------------------- Eckdaten

const kurzZahl = (n) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');

// Wochenvorgabe als Zeile im Eckdaten-Fenster, z. B. „Sa: nur 06:00–14:00“ oder „alle Tage: höchstens 6 h am Tag“.
// Gleiche Lesart wie pep.vorgabe_text in supabase/schema.sql (Anzeige-Duplikat): nicht_verfuegbar ohne Zeiten, aber
// mit Stundengrenze ist nur eine Stundengrenze; ohne beides gilt der ganze Tag. Die Notiz zeigt der Dialog daneben.
export function vorgabeText(v) {
  const tag = v.wochentag ? WOCHENTAGE[v.wochentag - 1] : 'alle Tage';
  const teile = [];
  if (v.art === 'nur_zwischen') teile.push(`nur ${v.von}–${v.bis}`);
  else if (v.von || v.bis) teile.push(`nicht ${v.von ?? '00:00'}–${v.bis ?? '24:00'}`);
  if (v.max_stunden_tag != null) teile.push(`höchstens ${kurzZahl(v.max_stunden_tag)} h am Tag`);
  if (v.max_stunden_woche != null) teile.push(`höchstens ${kurzZahl(v.max_stunden_woche)} h in der Woche`);
  if (!teile.length) teile.push('nicht verfügbar');
  return `${tag}: ${teile.join(', ')}`;
}

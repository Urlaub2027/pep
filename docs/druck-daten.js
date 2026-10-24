// Reine Aufbereitung für die Ausdrucke (Spec 13) und den Excel-Export des Wochenplans (kein DOM).
// Eingaben sind die Antworten von pep_einsatzplan_woche, pep_abwesenheiten und pep_resturlaub.
// Stunden folgen F2/F4: unbesetzte Abschnitte und Pausen zählen nicht; Soll und Differenz wie die Seitenleiste
// des Einsatzplans (wochenSummen aus plan-raster.js).
import { minuten, halbstunden, zeitspanne, stundenText } from './zeit.js';
import { zellen as rasterZellen, tagesStunden, wochenSummen, tagKurz } from './plan-raster.js';
import { stundenAnzeige } from './kalender.js';
import { WOCHENTAGE } from './hilfe.js';

const rund = (n) => Math.round(Number(n) * 100) / 100 || 0; // Rechenreste und −0 werden 0
const summe = (liste) => rund(liste.reduce((s, x) => s + (Number(x) || 0), 0));
const pauseIds = (woche) => new Set((woche.bereiche ?? []).filter((b) => b.art === 'pause').map((b) => b.id));
const nachBeginn = (a, b) => minuten(a.von) - minuten(b.von);

// Zusammenhängende Zeiten der besetzten Abschnitte (Pausen eingeschlossen), Lücken trennen:
// „07:00–15:30“ oder bei geteiltem Dienst „07:00–11:00, 16:00–20:00“.
function zeitenText(segmente) {
  const bereiche = [];
  for (const s of segmente.filter((x) => !x.unbesetzt).sort(nachBeginn)) {
    const letzter = bereiche.at(-1);
    if (letzter && minuten(s.von) <= minuten(letzter.bis)) {
      if (minuten(s.bis) > minuten(letzter.bis)) letzter.bis = s.bis;
    } else bereiche.push({ von: s.von, bis: s.bis });
  }
  return bereiche.map((b) => zeitspanne(b.von, b.bis)).join(', ');
}

// „P 0:30“: Pausenminuten der besetzten Abschnitte als Stunden:Minuten.
function pauseText(segmente, pausen) {
  const min = segmente.filter((s) => !s.unbesetzt && pausen.has(s.bereich_id))
    .reduce((n, s) => n + minuten(s.bis) - minuten(s.von), 0);
  return min ? `P ${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}` : '';
}

const abwesenheitText = (a) => (a.stunden == null ? a.code : `${a.code}/${stundenText(a.stunden)}`);

// Ein Tag im Wochenplan: „07:00–15:30 / 8,00 (P 0:30)“, Abwesenheit „U/6,25“, beides untereinander.
function tagText(segmente, abwesenheit, pausen) {
  const teile = [];
  if (abwesenheit) teile.push(abwesenheitText(abwesenheit));
  const zeiten = zeitenText(segmente);
  if (zeiten) {
    const pause = pauseText(segmente, pausen);
    teile.push(`${zeiten} / ${stundenText(rund(tagesStunden(segmente, pausen)))}${pause ? ` (${pause})` : ''}`);
  }
  return teile.join('\n');
}

// Wochenplan: alle Mitarbeiter der Woche, je Tag ein Text, Summe der geplanten Stunden, Abwesenheitsstunden
// und Differenz = geplant − (Vertrag − Abwesenheit).
export function wochenplanZeilen(woche) {
  const pausen = pauseIds(woche);
  const summen = wochenSummen(woche);
  return (woche.mitarbeiter ?? []).map((m) => {
    const eigene = (woche.bloecke ?? []).filter((b) => b.mitarbeiter_id === m.id);
    const abwesenheiten = (woche.abwesenheiten ?? []).filter((a) => a.mitarbeiter_id === m.id);
    const s = summen.get(m.id);
    return {
      name: m.name,
      personalnummer: m.personalnummer ?? '',
      vertrag: m.wochenstunden == null ? null : Number(m.wochenstunden),
      tage: woche.tage.map((t) => tagText(eigene.filter((b) => b.datum === t.datum),
        abwesenheiten.find((a) => a.datum === t.datum), pausen)),
      summe: rund(s.geplant),
      abwesend: summe(abwesenheiten.map((a) => a.stunden)),
      differenz: rund(s.differenz),
    };
  });
}

// Tagesplan: nur Mitarbeiter mit Blöcken (auch unbesetzten, die im Raster markiert sind); je Halbstunde der
// Rahmenzeit Kürzel und Bereichsfarbe. Abwesende (ganz oder teilweise) stehen gesondert mit Code.
export function tagesplanZeilen(woche, datum) {
  const tag = (woche.tage ?? []).find((t) => t.datum === datum);
  const spalten = tag?.geoeffnet ? halbstunden(tag.rahmen_von, tag.rahmen_bis) : [];
  const pausen = pauseIds(woche);
  const bereiche = new Map((woche.bereiche ?? []).map((b) => [b.id, b]));
  const zeilen = [];
  if (spalten.length) {
    for (const m of woche.mitarbeiter ?? []) {
      const segmente = (woche.bloecke ?? []).filter((b) => b.mitarbeiter_id === m.id && b.datum === datum);
      if (!segmente.length) continue;
      zeilen.push({
        name: m.name,
        zeiten: zeitenText(segmente),
        stunden: rund(tagesStunden(segmente, pausen)),
        kommentar: (woche.kommentare ?? []).find((k) => k.mitarbeiter_id === m.id && k.datum === datum)?.text ?? '',
        zellen: rasterZellen(segmente, spalten).map((z) => (z ? {
          kuerzel: bereiche.get(z.bereich_id)?.kuerzel ?? '?',
          farbe: bereiche.get(z.bereich_id)?.farbe ?? null,
          unbesetzt: z.unbesetzt,
        } : null)),
      });
    }
  }
  const abwesende = [];
  for (const m of woche.mitarbeiter ?? []) {
    const a = (woche.abwesenheiten ?? []).find((x) => x.mitarbeiter_id === m.id && x.datum === datum);
    if (a) abwesende.push({ name: m.name, code: a.code, zeiten: a.von && a.bis ? zeitspanne(a.von, a.bis) : '' });
  }
  return { spalten, zeilen, abwesende };
}

// Excel-Blatt des Wochenplans für xlsx.js: Texte wie im Ausdruck, Stunden als Zahlen.
export function wochenplanBlatt(woche) {
  return {
    name: `KW ${woche.kw} ${woche.jahr}`,
    fixiereSpalten: 1,
    spalten: [
      { titel: 'Name', breite: 26 }, { titel: 'Personalnr.', breite: 12 }, { titel: 'Vertrag (h)', breite: 11 },
      ...woche.tage.map((t) => ({ titel: tagKurz(t.datum), breite: 24 })),
      { titel: 'geplant (h)', breite: 11 }, { titel: 'abwesend (h)', breite: 12 }, { titel: 'Differenz (h)', breite: 12 },
    ],
    zeilen: wochenplanZeilen(woche).map((z) =>
      [z.name, z.personalnummer, z.vertrag, ...z.tage, z.summe, z.abwesend, z.differenz]),
  };
}

// Abwesenheitsmonat aus pep_abwesenheiten: je Mitarbeiter und Tag Code, Stunden (bzw. Uhrzeit) und Code-Farbe;
// Zeilensumme, Tagessummen und Monatssumme. Offene oder abgelehnte Urlaubswünsche gehören nicht in den Ausdruck.
export function monatZeilen(daten) {
  const farben = new Map((daten.codes ?? []).map((c) => [c.id, c.farbe]));
  const tage = (daten.tage ?? []).map((t) => {
    const datum = String(t.datum).slice(0, 10);
    return {
      datum, kw: t.kw, text: `${WOCHENTAGE[t.wochentag - 1]} ${Number(datum.slice(8))}.`,
      frei: !t.geoeffnet, wochenende: t.wochentag >= 6, feiertag: t.feiertag ?? null, schulferien: t.schulferien ?? null,
    };
  });
  const zeilen = (daten.mitarbeiter ?? []).map((m) => {
    const eintraege = tage.map((t) => m.tage?.[t.datum] ?? null);
    return {
      name: m.name,
      zellen: eintraege.map((e) => (e ? {
        code: e.code,
        text: e.von && e.bis ? stundenAnzeige(e).slice(e.code.length + 1) : e.stunden == null ? '' : stundenText(e.stunden),
        farbe: farben.get(e.code_id) ?? null,
      } : null)),
      summe: summe(eintraege.map((e) => e?.stunden)),
      stunden: eintraege.map((e) => (e?.stunden == null ? 0 : Number(e.stunden))),
    };
  });
  const tagessummen = tage.map((_, i) => summe(zeilen.map((z) => z.stunden[i])));
  for (const z of zeilen) delete z.stunden;
  return { tage, zeilen, tagessummen, monatssumme: summe(tagessummen) };
}

// Resturlaub aus pep_resturlaub: Zeilen unverändert (Zahlen), dazu die Summenzeile.
export function resturlaubZeilen(daten) {
  const zeilen = (daten.mitarbeiter ?? []).map((m) => ({
    ...m,
    monate: Array.from({ length: 12 }, (_, i) => Number(m.monate?.[i]) || 0),
  }));
  const spalte = (name) => summe(zeilen.map((z) => z[name]));
  return {
    zeilen,
    summe: {
      anspruch: spalte('anspruch'),
      rest_vorjahr: spalte('rest_vorjahr'),
      monate: Array.from({ length: 12 }, (_, i) => summe(zeilen.map((z) => z.monate[i]))),
      genehmigt: spalte('genehmigt'),
      rest: spalte('rest'),
    },
  };
}

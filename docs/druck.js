// Ausdrucke (Spec 13) und Excel-Export des Wochenplans. Die Druckansicht entsteht in <section id="ansicht-druck">,
// die am Bildschirm verborgen bleibt; die Klasse `druckt` am <body> blendet beim Drucken alles andere aus
// (style.css, @media print). Die sichtbare Ansicht ändert sich dadurch nie, nach dem Drucken wird nur aufgeräumt.
// Kopf jeder Druckseite: Titel, Zeitraum, Filiale, „erstellt am“ – als erste Zeile des <thead>, das der Browser
// auf jeder Seite wiederholt.
import { $, element, datumDE, stundenDE, textfarbe } from './hilfe.js';
import { ich } from './app.js';
import { dialog } from './dialog.js';
import { erzeugeXlsx } from './xlsx.js';
import { plusTage } from './zeit.js';
import { tagKurz } from './plan-raster.js';
import {
  tagesplanZeilen, wochenplanZeilen, monatZeilen, resturlaubZeilen, wochenplanBlatt,
} from './druck-daten.js';

const WOCHENTAG_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONATE_KURZ = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const wochentagLang = (iso) => WOCHENTAG_LANG[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];
// Stunden mit zwei Stellen, negativ mit echtem Minuszeichen; leer bei null.
const zahl = (n) => (n == null ? '' : `${Number(n) < 0 ? '−' : ''}${stundenDE(Math.abs(Number(n)))}`);
const zahlOderLeer = (n) => (Number(n) ? zahl(n) : '');
const mitVorzeichen = (n) => `${Number(n) > 0 ? '+' : ''}${zahl(n)}`;

function erstelltAm() {
  const jetzt = new Date();
  const zwei = (n) => String(n).padStart(2, '0');
  return `${zwei(jetzt.getDate())}.${zwei(jetzt.getMonth() + 1)}.${jetzt.getFullYear()} ${zwei(jetzt.getHours())}:${zwei(jetzt.getMinutes())}`;
}

function filialeText() {
  const f = ich?.filiale;
  if (!f) return '';
  return f.nummer ? `${f.name} (${f.nummer})` : f.name;
}

// Seitenkopf als erste thead-Zeile über alle Spalten.
function kopfZeile(titel, zeitraum, spalten) {
  return element('tr', { class: 'dr-kopfzeile' }, element('th', { colspan: spalten },
    element('div', { class: 'dr-kopf' },
      element('div', {}, element('strong', { class: 'dr-titel' }, titel), ' ', element('span', {}, zeitraum)),
      element('div', { class: 'dr-kopf-rechts' }, element('span', {}, filialeText()),
        element('span', {}, `erstellt am ${erstelltAm()}`)))));
}

function farbig(td, farbe) {
  if (!farbe) return td;
  td.style.backgroundColor = farbe;
  td.style.color = textfarbe(farbe);
  return td;
}

// ---------------------------------------------------------------- Tagesplan

function tagesplan(woche, datum) {
  const { spalten, zeilen, abwesende } = tagesplanZeilen(woche, datum);
  const tag = woche.tage.find((t) => t.datum === datum);
  const titel = `${wochentagLang(datum)}, ${datumDE(datum)}`;
  if (!spalten.length) {
    return element('div', { class: 'dr-seite' }, element('table', { class: 'dr-tabelle' },
      element('thead', {}, kopfZeile('Tagesplan', titel, 1)),
      element('tbody', {}, element('tr', {}, element('td', {}, tag?.feiertag ? `Geschlossen (${tag.feiertag})` : 'Geschlossen')))));
  }
  // Kopf: eine Zelle je Stunde über zwei halbe Stunden (wie im Einsatzplan), Öffnungszeit fett.
  const stunden = [];
  for (const von of spalten) {
    const letzte = stunden.at(-1);
    if (letzte && von.endsWith(':30') && letzte.von.slice(0, 2) === von.slice(0, 2)) letzte.breite += 1;
    else stunden.push({ von, breite: 1 });
  }
  const offen = (von) => von >= tag.oeffnung_von && von < tag.oeffnung_bis;
  const benutzt = new Map();
  const reihen = zeilen.map((z) => element('tr', {},
    element('th', { class: 'dr-name' }, z.name),
    element('td', { class: 'dr-zeiten' }, z.zeiten ? z.zeiten.replace(/, /g, '\n') : '–'),
    element('td', { class: 'zahl' }, stundenDE(z.stunden)),
    element('td', { class: 'dr-kommentar' }, z.kommentar),
    z.zellen.map((c, i) => {
      const td = element('td', { class: ['dr-z', spalten[i].endsWith(':00') ? 'voll' : ''].filter(Boolean).join(' ') });
      if (!c) return td;
      td.textContent = c.kuerzel;
      if (c.unbesetzt) td.classList.add('dr-unbesetzt');
      else {
        farbig(td, c.farbe);
        benutzt.set(c.kuerzel, woche.bereiche.find((b) => b.kuerzel === c.kuerzel));
      }
      return td;
    })));
  const spaltenZahl = 4 + spalten.length;
  const tabelle = element('table', { class: 'dr-tabelle dr-tagesplan' },
    element('colgroup', {}, element('col', { class: 'dr-c-name' }), element('col', { class: 'dr-c-zeiten' }),
      element('col', { class: 'dr-c-std' }), element('col', { class: 'dr-c-kommentar' }), spalten.map(() => element('col', {}))),
    element('thead', {}, kopfZeile('Tagesplan', titel, spaltenZahl),
      element('tr', {}, element('th', { class: 'dr-name' }, 'Mitarbeiter'), element('th', {}, 'Zeiten'),
        element('th', { class: 'zahl' }, 'Std.'), element('th', {}, 'Kommentar'),
        stunden.map((s) => element('th', { colspan: s.breite, class: `dr-stunde${offen(s.von) ? ' offen' : ''}` }, s.von.slice(0, 2))))),
    element('tbody', {}, reihen.length ? reihen
      : element('tr', {}, element('td', { colspan: spaltenZahl }, 'An diesem Tag ist niemand eingeplant.'))));
  const legende = [...benutzt.values()].filter(Boolean)
    .sort((a, b) => woche.bereiche.indexOf(a) - woche.bereiche.indexOf(b)).map((b) => `${b.kuerzel} ${b.name}`);
  return element('div', { class: 'dr-seite' }, tabelle,
    element('p', { class: 'dr-fuss' }, element('strong', {}, 'Abwesend: '),
      abwesende.length ? abwesende.map((a) => `${a.name} (${a.code}${a.zeiten ? ` ${a.zeiten}` : ''})`).join(' · ') : 'niemand'),
    legende.length ? element('p', { class: 'dr-fuss dr-legende' }, legende.join(' · '),
      zeilen.some((z) => z.zellen.some((c) => c?.unbesetzt)) ? ' · schraffiert = unbesetzt (abwesend)' : '') : null);
}

// ---------------------------------------------------------------- Wochenplan

function wochenplan(woche) {
  const zeilen = wochenplanZeilen(woche);
  // Geschlossene Tage ohne jeden Eintrag (meist der Sonntag) entfallen, damit die Woche auf eine Seite passt.
  const tage = woche.tage.map((t, i) => ({ ...t, i })).filter((t) => t.geoeffnet || zeilen.some((z) => z.tage[t.i]));
  const zeitraum = `KW ${woche.kw}/${woche.jahr}: ${datumDE(woche.montag)} – ${datumDE(plusTage(woche.montag, 6))}`;
  const spaltenZahl = 5 + tage.length;
  // „07:00–15:30 / 8,00 (P 0:30)“ untereinander: Zeiten, darunter Stunden und Pause.
  const zelle = (text) => element('td', { class: 'dr-tag' }, text.replace(' / ', '\n').replace(/, /g, '\n'));
  let geplant = 0;
  let abwesend = 0;
  const reihen = zeilen.map((z) => {
    geplant += z.summe;
    abwesend += z.abwesend;
    return element('tr', {},
      element('th', { class: 'dr-name' }, z.name, z.personalnummer ? element('small', {}, z.personalnummer) : null),
      element('td', { class: 'zahl' }, zahl(z.vertrag)),
      tage.map((t) => zelle(z.tage[t.i])),
      element('td', { class: 'zahl' }, zahl(z.summe)),
      element('td', { class: 'zahl' }, zahlOderLeer(z.abwesend)),
      element('td', { class: `zahl${z.differenz < 0 ? ' minus' : ''}` }, mitVorzeichen(z.differenz)));
  });
  const k = woche.kennzahlen ?? {};
  const fuss = [`Summe geplant: ${zahl(geplant)} h`, `Abwesenheiten: ${zahl(abwesend)} h`];
  if (k.stundenvorgabe != null) fuss.push(`Stundenvorgabe: ${zahl(k.stundenvorgabe)} h`);
  if (k.planumsatz != null) fuss.push(`Planumsatz: ${Number(k.planumsatz).toLocaleString('de-DE')} €`);
  return element('div', { class: 'dr-seite' },
    element('table', { class: 'dr-tabelle dr-wochenplan' },
      element('colgroup', {}, element('col', { class: 'dr-c-name' }), element('col', { class: 'dr-c-zahl' }),
        tage.map(() => element('col', {})), [1, 2, 3].map(() => element('col', { class: 'dr-c-zahl' }))),
      element('thead', {}, kopfZeile('Wochenplan', zeitraum, spaltenZahl),
        element('tr', {}, element('th', { class: 'dr-name' }, 'Name / Personalnr.'), element('th', { class: 'zahl' }, 'Vertrag'),
          tage.map((t) => element('th', {}, `${WOCHENTAG_LANG[t.wochentag - 1]}`, element('small', {}, datumDE(t.datum).slice(0, 6)))),
          element('th', { class: 'zahl' }, 'geplant'), element('th', { class: 'zahl' }, 'abwesend'),
          element('th', { class: 'zahl' }, 'Differenz'))),
      element('tbody', {}, reihen)),
    element('p', { class: 'dr-fuss' }, fuss.join(' · ')),
    element('p', { class: 'dr-fuss dr-legende' },
      'Je Tag: Zeiten, darunter Arbeitsstunden ohne Pause und (P Pause). Abwesenheit als Code/Stunden. '
      + 'Differenz = geplant − (Vertrag − Abwesenheit).'));
}

// ---------------------------------------------------------------- Abwesenheitsmonat

function abwesenheitsMonat({ daten, jahr, monat }) {
  const m = monatZeilen(daten);
  const gruppen = [];
  for (const t of m.tage) {
    const letzte = gruppen.at(-1);
    if (letzte && letzte.kw === t.kw) letzte.breite += 1;
    else gruppen.push({ kw: t.kw, breite: 1 });
  }
  const tagKlasse = (t) => ['dr-mt', t.frei || t.wochenende ? 'frei' : ''].filter(Boolean).join(' ');
  const spaltenZahl = 2 + m.tage.length;
  return element('div', { class: 'dr-seite' },
    element('table', { class: 'dr-tabelle dr-monat' },
      element('colgroup', {}, element('col', { class: 'dr-c-name' }), m.tage.map(() => element('col', {})),
        element('col', { class: 'dr-c-zahl' })),
      element('thead', {}, kopfZeile('Abwesenheiten', `${MONATE[monat - 1]} ${jahr}`, spaltenZahl),
        element('tr', {}, element('th', {}), gruppen.map((g) => element('th', { colspan: g.breite, class: 'dr-kw' }, `KW ${g.kw}`)),
          element('th', {})),
        element('tr', {}, element('th', { class: 'dr-name' }, 'Name'),
          m.tage.map((t) => element('th', { class: tagKlasse(t), title: t.feiertag ?? null }, t.text.replace(' ', '\n'))),
          element('th', { class: 'zahl' }, 'Summe'))),
      element('tbody', {}, m.zeilen.map((z) => element('tr', {},
        element('th', { class: 'dr-name' }, z.name),
        z.zellen.map((c, i) => {
          const td = element('td', { class: tagKlasse(m.tage[i]) });
          if (c) {
            td.append(element('strong', {}, c.code), c.text ? element('span', {}, c.text) : '');
            farbig(td, c.farbe);
          }
          return td;
        }),
        element('td', { class: 'zahl' }, zahlOderLeer(z.summe))))),
      element('tfoot', {}, element('tr', {}, element('th', { class: 'dr-name' }, 'Summe (h)'),
        m.tagessummen.map((s, i) => element('td', { class: `zahl ${tagKlasse(m.tage[i])}` }, zahlOderLeer(s))),
        element('td', { class: 'zahl' }, zahl(m.monatssumme))))),
    element('p', { class: 'dr-fuss dr-legende' }, 'Code und Stunden je Tag (mit Uhrzeit: von–bis). Grau: Wochenende oder geschlossen.',
      (daten.codes ?? []).length ? ` Codes: ${daten.codes.map((c) => `${c.code} ${c.name}`).join(' · ')}` : ''));
}

// ---------------------------------------------------------------- Resturlaub

function resturlaub(daten) {
  const { zeilen, summe } = resturlaubZeilen(daten);
  const spaltenZahl = 18;
  const reihe = (name, z, tage) => element('tr', {}, element('th', { class: 'dr-name' }, name),
    element('td', { class: 'zahl' }, zahl(z.anspruch)), element('td', { class: 'zahl' }, zahl(z.rest_vorjahr)),
    z.monate.map((x) => element('td', { class: 'zahl' }, zahlOderLeer(x))),
    element('td', { class: 'zahl' }, zahl(z.genehmigt)),
    element('td', { class: `zahl${z.rest < 0 ? ' minus' : ''}` }, zahl(z.rest)),
    element('td', { class: `zahl${tage < 0 ? ' minus' : ''}` }, tage == null ? '' : zahl(tage)));
  return element('div', { class: 'dr-seite' },
    element('table', { class: 'dr-tabelle dr-resturlaub' },
      element('colgroup', {}, element('col', { class: 'dr-c-name' }), Array.from({ length: 17 }, () => element('col', {}))),
      element('thead', {}, kopfZeile('Resturlaub', `${daten.jahr}, Stand ${datumDE(daten.stand)}`, spaltenZahl),
        element('tr', {}, element('th', { class: 'dr-name' }, 'Name'), element('th', { class: 'zahl' }, 'Anspruch'),
          element('th', { class: 'zahl' }, 'Rest Vorjahr'), MONATE_KURZ.map((n) => element('th', { class: 'zahl' }, n)),
          element('th', { class: 'zahl' }, 'genehmigt'), element('th', { class: 'zahl' }, 'Rest (h)'),
          element('th', { class: 'zahl' }, 'Rest (Tage)'))),
      element('tbody', {}, zeilen.map((z) => reihe(z.name, z, z.rest_tage))),
      element('tfoot', {}, reihe('Summe', summe, null))),
    element('p', { class: 'dr-fuss dr-legende' },
      'Stunden des Codes U je Monat. Rest = Anspruch + Rest Vorjahr − genehmigt; Tage = Rest ÷ (Wochenstunden ÷ Teiler), '
      + 'Vertrag am 01.01. bzw. erster Vertrag im Jahr.'));
}

// ---------------------------------------------------------------- Ablauf

const BAUER = {
  tag: ({ woche, datum }) => [tagesplan(woche, datum)],
  tage: ({ woche }) => woche.tage.filter((t) => t.geoeffnet).map((t) => tagesplan(woche, t.datum)),
  woche: ({ woche }) => [wochenplan(woche)],
  monat: (daten) => [abwesenheitsMonat(daten)],
  resturlaub: (daten) => [resturlaub(daten)],
};

// Baut die Druckansicht und schaltet den Druckmodus ein, ohne den Druckdialog (Vorschau, Prüfung per PDF).
// art: 'tag' { woche, datum } · 'tage' { woche } · 'woche' { woche } · 'monat' { daten, jahr, monat } · 'resturlaub' Antwort von pep_resturlaub
export function baueDruck(art, daten) {
  const bauer = BAUER[art];
  if (!bauer) throw new Error('ART_UNGUELTIG');
  $('ansicht-druck').replaceChildren(...bauer(daten));
  document.body.classList.add('druckt');
}

function raeumeAuf() {
  document.body.classList.remove('druckt');
  $('ansicht-druck').replaceChildren();
}

// Druckansicht bauen, Druckdialog öffnen, danach aufräumen. In Browsern, deren print() nicht wartet,
// räumt erst afterprint auf; die Bildschirmansicht bleibt in beiden Fällen unverändert.
export function drucke(art, daten) {
  baueDruck(art, daten);
  window.addEventListener('afterprint', raeumeAuf, { once: true });
  window.print();
}

// Lädt den Wochenplan als Excel-Datei herunter (Blob und a.download wie Urlaubsvertretung/docs/admin-hilfe.js).
export function exportiereWochenplan(woche) {
  const blob = new Blob([erzeugeXlsx([wochenplanBlatt(woche)])],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Wochenplan-KW${woche.kw}-${woche.jahr}.xlsx`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ---------------------------------------------------------------- Auswahl-Dialoge

// Einsatzplan: kontext = planKontext() aus einsatzplan.js ({ woche, datum }).
export function druckAuswahlPlan(kontext) {
  const { woche, datum } = kontext;
  if (!woche) return;
  const tag = woche.tage.find((t) => t.datum === datum);
  dialog(`Drucken – KW ${woche.kw}`, [
    element('p', { class: 'hinweis' }, 'Der Ausdruck ist A4 quer. Im Druckdialog „Hintergrundgrafiken“ einschalten, '
      + 'falls die Bereichsfarben fehlen; die Kürzel sind auch ohne Farbe lesbar.'),
  ], [
    { text: 'Wochenplan', aktion: () => {}, danach: () => drucke('woche', { woche }) },
    ...(tag?.geoeffnet ? [{ text: `Tagesplan ${tagKurz(datum)}`, sekundaer: true, aktion: () => {}, danach: () => drucke('tag', { woche, datum }) }] : []),
    { text: 'Tagespläne der Woche', sekundaer: true, aktion: () => {}, danach: () => drucke('tage', { woche }) },
    { text: 'Excel (Wochenplan)', sekundaer: true, aktion: () => exportiereWochenplan(woche) },
  ]);
}

// Abwesenheiten: Monat wie angezeigt, Resturlaub des Jahres (lädt pep_resturlaub; Fehler erscheinen im Dialog).
export function druckAuswahlAbwesenheiten({ daten, jahr, monat, laden }) {
  let rest = null;
  dialog('Drucken – Abwesenheiten', [
    element('p', { class: 'hinweis' }, 'Der Ausdruck ist A4 quer.'),
  ], [
    { text: `Monat ${MONATE[monat - 1]} ${jahr}`, aktion: () => {}, danach: () => drucke('monat', { daten, jahr, monat }) },
    {
      text: `Resturlaub ${jahr}`, sekundaer: true,
      aktion: async () => { rest = await laden(jahr); },
      danach: () => { if (rest) drucke('resturlaub', rest); },
    },
  ]);
}

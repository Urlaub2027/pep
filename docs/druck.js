// Ausdrucke (Spec 13) und Excel-Export des Wochenplans. Die Druckansicht entsteht in <section id="ansicht-druck">,
// die am Bildschirm verborgen bleibt; die Klasse `druckt` am <body> blendet beim Drucken alles andere aus
// (style.css, @media print). Die sichtbare Ansicht ändert sich dadurch nie, nach dem Drucken wird nur aufgeräumt.
// Kopf jeder Druckseite: Titel, Zeitraum, Filiale, „erstellt am“ – als erste Zeile des <thead>, das der Browser
// auf jeder Seite wiederholt.
import { $, element, datumDE, stundenDE, textfarbe } from './hilfe.js';
import { ich, aufruf } from './app.js';
import { dialog } from './dialog.js';
import { erzeugeXlsx } from './xlsx.js';
import { plusTage, heuteDatum } from './zeit.js';
import { tagKurz } from './plan-raster.js';
import {
  tagesplanZeilen, wochenplanZeilen, monatZeilen, resturlaubZeilen, wochenplanBlatt,
  wochenIstZeilen, stundenblattSeiten, journalTabelle,
} from './druck-daten.js';
import { vorzeichen } from './zeitkonto-daten.js';

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

// ---------------------------------------------------------------- Wocheneinsatz-IST (Stufe 2)

// ist = pep_ist_woche, zeitkonto = pep_zeitkonto_woche derselben Woche. Wie der Wochenplan, aber mit dem bestätigten
// IST je Tag und den Zahlen des Zeitkontos (Soll, IST-Summe, Spät, Diff, Saldo Vorwoche/aktuell).
function wochenIst({ ist, zeitkonto }) {
  const zeilen = wochenIstZeilen(ist, zeitkonto);
  // Geschlossene Tage ohne Eintrag (meist der Sonntag) entfallen, damit die Woche auf eine Seite passt.
  const tage = ist.tage.map((t, i) => ({ ...t, i }))
    .filter((t) => t.geoeffnet || zeilen.some((z) => z.tage[t.i] && z.tage[t.i] !== '–'));
  const a = zeitkonto?.abgeschlossen;
  const vor = Boolean(zeitkonto?.vor_ist_start) && !a;
  const am = a ? new Date(a.am).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const stand = a ? `abgeschlossen am ${am}${a.von_name ? ` von ${a.von_name}` : ''}`
    : vor ? 'vor dem Start der IST-Erfassung, wird nicht gebucht' : 'nicht abgeschlossen, Diff und Saldo aktuell vorläufig';
  const zeitraum = `KW ${ist.kw}/${ist.jahr}: ${datumDE(ist.montag)} – ${datumDE(plusTage(ist.montag, 6))} · ${stand}`;
  const spaltenZahl = 7 + tage.length;
  const zelle = (text) => element('td', { class: `dr-tag${text === 'offen' || text.endsWith('\noffen') ? ' dr-offen' : ''}` },
    text.replace(' / ', '\n').replace(/, /g, '\n'));
  const zahlZelle = (n, mitVz = false) => element('td', { class: `zahl${n < 0 ? ' minus' : ''}` },
    n == null ? '' : mitVz ? vorzeichen(n) : zahl(n));
  const reihen = zeilen.map((z) => element('tr', {},
    element('th', { class: 'dr-name' }, z.name, z.personalnummer ? element('small', {}, z.personalnummer) : null),
    zahlZelle(z.soll),
    tage.map((t) => zelle(z.tage[t.i])),
    zahlZelle(z.ist), zahlZelle(z.spaet), zahlZelle(z.diff, true), zahlZelle(z.saldo_vorwoche, true),
    zahlZelle(z.saldo_aktuell, true)));
  const summe = (feld) => zeilen.reduce((s, z) => s + (z[feld] ?? 0), 0);
  return element('div', { class: 'dr-seite' },
    element('table', { class: 'dr-tabelle dr-wochenplan dr-wochenist' },
      element('colgroup', {}, element('col', { class: 'dr-c-name' }), element('col', { class: 'dr-c-zahl' }),
        tage.map(() => element('col', {})), [1, 2, 3, 4, 5].map(() => element('col', { class: 'dr-c-zahl' }))),
      element('thead', {}, kopfZeile('Wocheneinsatz-IST', zeitraum, spaltenZahl),
        element('tr', {}, element('th', { class: 'dr-name' }, 'Name / Personalnr.'), element('th', { class: 'zahl' }, 'Soll'),
          tage.map((t) => element('th', {}, `${WOCHENTAG_LANG[t.wochentag - 1]}`, element('small', {}, datumDE(t.datum).slice(0, 6)))),
          element('th', { class: 'zahl' }, 'IST'), element('th', { class: 'zahl' }, 'Spät'),
          element('th', { class: 'zahl' }, 'Diff'), element('th', { class: 'zahl' }, 'Saldo Vorwoche'),
          element('th', { class: 'zahl' }, 'Saldo aktuell'))),
      element('tbody', {}, reihen.length ? reihen
        : element('tr', {}, element('td', { colspan: spaltenZahl }, 'In dieser Woche ist niemand eingeplant.')))),
    element('p', { class: 'dr-fuss' }, `Summe Soll: ${zahl(summe('soll'))} h · Summe IST: ${zahl(summe('ist'))} h · `
      + `Offene IST-Tage: ${zeitkonto?.offene_tage ?? 0}`),
    element('p', { class: 'dr-fuss dr-legende' },
      'Je Tag das bestätigte IST: Zeiten, darunter Arbeitsstunden ohne Pause und (P Pause); Abwesenheit als Code/Stunden; '
      + '„offen“ = noch nicht bestätigt (zählt nicht); „–“ = geschlossen oder nicht gearbeitet. '
      + 'IST = bestätigte Arbeitszeit ohne Pausen; Spät = davon ab der Spätgrenze; '
      + 'Diff = IST + Abwesend + Feiertag − Soll (Führung: Plus erst über der Grenze); Saldo = Zeitkonto.'));
}

// ---------------------------------------------------------------- Stundenblatt (Stufe 2, A4 hoch)

// Eine Seite je Mitarbeiter (.dr-seite bricht danach um, .dr-hoch druckt auf der benannten Seite „hoch“ = A4 hoch):
// Tageszeilen aus dem bestätigten IST, darunter die Wochen mit Saldo. daten = Antwort von pep_stundenblatt.
function stundenblatt(daten) {
  const seiten = stundenblattSeiten(daten);
  const zeitraum = `${datumDE(daten.von)} – ${datumDE(daten.bis)}`;
  if (!seiten.length) {
    return [element('div', { class: 'dr-seite dr-hoch' }, element('table', { class: 'dr-tabelle' },
      element('thead', {}, kopfZeile('Stundenblatt', zeitraum, 1)),
      element('tbody', {}, element('tr', {}, element('td', {}, 'In diesem Zeitraum hat niemand einen Vertrag.')))))];
  }
  return seiten.map((s) => {
    const person = `${s.name}${s.personalnummer ? ` (Personalnr. ${s.personalnummer})` : ''}`;
    const tage = element('table', { class: 'dr-tabelle dr-stundenblatt' },
      element('colgroup', {}, element('col', { class: 'dr-c-sb-tag' }), [1, 2, 3].map(() => element('col', { class: 'dr-c-sb-zeit' })),
        element('col', { class: 'dr-c-sb-abw' }), element('col', { class: 'dr-c-sb-zeit' }), element('col', {})),
      element('thead', {},
        element('tr', { class: 'dr-kopfzeile' }, element('th', { colspan: 7 },
          element('div', { class: 'dr-kopf' },
            element('div', {}, element('strong', { class: 'dr-titel' }, 'Stundenblatt'), ' ', element('span', {}, zeitraum),
              element('strong', { class: 'dr-person' }, person)),
            element('div', { class: 'dr-kopf-rechts' }, element('span', {}, filialeText()),
              element('span', {}, `erstellt am ${erstelltAm()}`))))),
        element('tr', {}, element('th', {}, 'Datum'), element('th', {}, 'Anwesend von'), element('th', {}, 'bis'),
          element('th', {}, 'Pause'), element('th', {}, 'Abwesenheit'), element('th', { class: 'zahl' }, 'Arbeitszeit'),
          element('th', {}, 'Hinweis'))),
      element('tbody', {}, s.zeilen.map((z) => element('tr', { class: [z.hinweis === 'offen' ? 'dr-offen' : '',
        /^(Sa|So) /.test(z.tag) ? 'dr-we' : ''].filter(Boolean).join(' ') || null },
      element('td', {}, z.tag), element('td', {}, z.von), element('td', {}, z.bis), element('td', {}, z.pause),
      element('td', {}, z.abwesend), element('td', { class: 'zahl' }, z.arbeitszeit), element('td', {}, z.hinweis)))),
      element('tfoot', {}, element('tr', {}, element('th', { colspan: 4 }, 'Summe im Zeitraum'),
        element('td', {}, s.summe.abwesend === '0,00' ? '' : `${s.summe.abwesend} h`),
        element('td', { class: 'zahl' }, s.summe.arbeitszeit), element('td', {}))));
    const wochen = element('table', { class: 'dr-tabelle dr-stundenblatt-wochen' },
      element('colgroup', {}, element('col', { class: 'dr-c-sb-kw' }), element('col', { class: 'dr-c-sb-abw' }),
        [1, 2, 3, 4, 5, 6].map(() => element('col', { class: 'dr-c-sb-zeit' })), element('col', {})),
      element('thead', {}, element('tr', {}, element('th', {}, 'Woche'), element('th', {}, 'Zeitraum'),
        ['Soll', 'IST', 'Abwesend', 'Feiertag', 'Diff', 'Saldo'].map((t) => element('th', { class: 'zahl' }, t)),
        element('th', {}, 'Hinweis'))),
      element('tbody', {}, s.wochen.length ? s.wochen.map((w) => element('tr', {},
        element('td', {}, w.kw), element('td', {}, w.zeitraum),
        [w.soll, w.ist, w.abwesend, w.feiertag].map((x) => element('td', { class: 'zahl' }, x)),
        element('td', { class: `zahl${w.diff.startsWith('−') ? ' minus' : ''}` }, w.diff),
        element('td', { class: `zahl${w.saldo.startsWith('−') ? ' minus' : ''}` }, w.saldo),
        element('td', {}, w.hinweis)))
        : element('tr', {}, element('td', { colspan: 9 }, 'Ohne Vertrag in diesen Wochen.'))));
    // Legende und Unterschriften in einem Block, der nicht umbricht: sonst kann die Unterschrift allein auf eine
    // neue Seite rutschen (bei mehreren Seiten stehen beide auf der letzten Seite der Person).
    return element('div', { class: 'dr-seite dr-hoch' }, tage, element('h3', { class: 'dr-zwischentitel' }, 'Wochen'), wochen,
      element('div', { class: 'dr-sb-ende' }, element('p', { class: 'dr-fuss dr-legende' },
        'Jeder Mitarbeiter beginnt auf einer neuen Seite. '
        + 'Nur bestätigtes IST: Anwesend = erster Beginn bis letztes Ende (Pausen eingeschlossen), Arbeitszeit ohne Pause. '
        + 'Abwesenheit „ohne Gutschrift“ (z. B. ZA) zählt nicht in der Summe. '
        + '„offen“ = noch nicht bestätigt, ohne Stunden. Wochen ganz, auch Tage außerhalb des Zeitraums. '
        + 'Saldo = gebuchtes Zeitkonto nach dem Sonntag der Woche; die Diff einer nicht abgeschlossenen Woche ist darin '
        + 'noch nicht enthalten.'),
      // Unterschriften am Ende der Person: bei mehreren Seiten nur auf ihrer letzten.
      element('div', { class: 'dr-unterschriften' },
        element('div', { class: 'dr-unterschrift' }, 'Datum, Unterschrift Mitarbeiter/in'),
        element('div', { class: 'dr-unterschrift' }, 'Datum, Unterschrift Filialleitung'))));
  });
}

// ---------------------------------------------------------------- Ablauf

const BAUER = {
  tag: ({ woche, datum }) => [tagesplan(woche, datum)],
  tage: ({ woche }) => woche.tage.filter((t) => t.geoeffnet).map((t) => tagesplan(woche, t.datum)),
  woche: ({ woche }) => [wochenplan(woche)],
  monat: (daten) => [abwesenheitsMonat(daten)],
  resturlaub: (daten) => [resturlaub(daten)],
  wochenist: (daten) => [wochenIst(daten)],
  stundenblatt: (daten) => stundenblatt(daten),
};

// Baut die Druckansicht und schaltet den Druckmodus ein, ohne den Druckdialog (Vorschau, Prüfung per PDF).
// art: 'tag' { woche, datum } · 'tage' { woche } · 'woche' { woche } · 'monat' { daten, jahr, monat } · 'resturlaub' Antwort von pep_resturlaub
// · 'wochenist' { ist: pep_ist_woche, zeitkonto: pep_zeitkonto_woche } · 'stundenblatt' Antwort von pep_stundenblatt
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

// Lädt Blätter als Excel-Datei herunter (Blob und a.download wie Urlaubsvertretung/docs/admin-hilfe.js).
function herunterladen(blaetter, dateiname) {
  const blob = new Blob([erzeugeXlsx(blaetter)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = dateiname;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function exportiereWochenplan(woche) {
  herunterladen([wochenplanBlatt(woche)], `Wochenplan-KW${woche.kw}-${woche.jahr}.xlsx`);
}

// Journal aller Mitarbeiter (Antwort von pep_zeitkonto_journal) als Zeitkonto-Journal-<von>-<bis>.xlsx, ein Blatt.
export function exportiereJournal(buchungen, von, bis) {
  herunterladen([journalTabelle(buchungen)], `Zeitkonto-Journal-${von}-${bis}.xlsx`);
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

// ---------------------------------------------------------------- Stufe 2: IST und Zeitkonto

// Einsatzplan im Modus IST: Wocheneinsatz-IST der geladenen Woche (ist = pep_ist_woche); das Zeitkonto derselben Woche
// wird dazugeladen. Fehler gehen an den Aufrufer (Meldung auf der Seite).
export async function druckeWochenIst(ist) {
  const zeitkonto = await aufruf('pep_zeitkonto_woche', { p_jahr: ist.jahr, p_kw: ist.kw });
  if (zeitkonto) drucke('wochenist', { ist, zeitkonto });
}

// Reiter Zeitkonto, Knopf „Drucken“ (zeitkonto = angezeigte Woche aus pep_zeitkonto_woche): Stundenblatt für einen oder
// alle Mitarbeiter (Zeitraum vorbelegt mit der angezeigten Woche) oder Wocheneinsatz-IST der angezeigten Woche.
export function druckAuswahlZeitkonto(zeitkonto) {
  const { jahr, kw, montag } = zeitkonto;
  const wer = element('select', {},
    element('option', { value: '' }, 'Alle (aktiv, mit Vertrag im Zeitraum)'),
    (zeitkonto.mitarbeiter ?? []).map((m) => element('option', { value: String(m.id) }, m.name)));
  const von = element('input', { type: 'date', value: montag });
  const bis = element('input', { type: 'date', value: plusTage(montag, 6) });
  let blatt = null;
  let ist = null;
  dialog(`Drucken – Zeitkonto KW ${kw}/${jahr}`, [
    element('p', { class: 'hinweis' }, 'Stundenblatt: A4 hoch, jeder Mitarbeiter beginnt auf einer neuen Seite '
      + '(höchstens 62 Tage). '
      + 'Wocheneinsatz-IST: A4 quer, die angezeigte Woche.'),
    element('label', { class: 'feld' }, 'Mitarbeiter (Stundenblatt)', wer),
    element('div', { class: 'zk-zeitraum' },
      element('label', { class: 'feld' }, 'Von', von), element('label', { class: 'feld' }, 'Bis', bis)),
  ], [
    {
      text: 'Stundenblatt',
      aktion: async () => {
        if (!von.value || !bis.value) throw new Error('DATUM_UNGUELTIG');
        blatt = await aufruf('pep_stundenblatt',
          { p_mitarbeiter_id: wer.value ? Number(wer.value) : null, p_von: von.value, p_bis: bis.value });
      },
      danach: () => { if (blatt) drucke('stundenblatt', blatt); },
    },
    {
      text: `Wocheneinsatz-IST KW ${kw}`, sekundaer: true,
      aktion: async () => { ist = await aufruf('pep_ist_woche', { p_jahr: jahr, p_kw: kw }); },
      danach: () => { if (ist) drucke('wochenist', { ist, zeitkonto }); },
    },
  ]);
}

// Reiter Zeitkonto, Knopf „Journal als Excel“: Buchungen aller Mitarbeiter mit Datum im Zeitraum (vorbelegt: 01.01. des
// laufenden Jahres bis heute; heute = 'JJJJ-MM-TT', in der Vorschau ersetzbar).
export function journalExcelDialog(heute = heuteDatum()) {
  const von = element('input', { type: 'date', value: `${heute.slice(0, 4)}-01-01` });
  const bis = element('input', { type: 'date', value: heute });
  dialog('Journal als Excel', [
    element('p', { class: 'hinweis' }, 'Alle Buchungen des Zeitkontos mit Datum im Zeitraum, je Mitarbeiter in '
      + 'Buchungsreihenfolge. „Saldo“ ist der Stand nach der Buchung.'),
    element('div', { class: 'zk-zeitraum' },
      element('label', { class: 'feld' }, 'Von', von), element('label', { class: 'feld' }, 'Bis', bis)),
  ], [{
    text: 'Herunterladen',
    aktion: async () => {
      if (!von.value || !bis.value) throw new Error('DATUM_UNGUELTIG');
      const buchungen = await aufruf('pep_zeitkonto_journal', { p_mitarbeiter_id: null, p_von: von.value, p_bis: bis.value });
      exportiereJournal(buchungen ?? [], von.value, bis.value);
    },
  }]);
}

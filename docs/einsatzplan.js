// Reiter „Einsatzplan“: Tagesraster in halben Stunden, Malen per Ziehen (Pointer-Events), Rückgängig,
// Abdeckung Kasse/VP, Seitenleiste mit Regelprüfung, Wochenstunden und Abteilungen.
// Blöcke kommen als Abschnitte (F2): dieselbe id kann mehrfach vorkommen, je Abschnitt eigenes `unbesetzt`.
import { $, meldung, fehlerText, element, datumDE, WOCHENTAGE, textfarbe } from './hilfe.js';
import { aufruf, ich, reiter, zeigeAnsicht } from './app.js';
import { minuten, halbstunden, plusTage, isoWoche, kwVorZurueck, zeitspanne } from './zeit.js';
import {
  zellen, strich, abdeckung, abdeckungsKlasse, tagesStunden, wochenSummen, bereichsStunden, rueckgaengigStapel,
} from './plan-raster.js';
import { kopierenDialog, vorlagenDialog, krankDialog, ersatzDialog, eckdatenDialog } from './plan-dialoge.js';

// Dialoge späterer Tasks tragen sich hier ein; ein Knopf erscheint erst, wenn sein Eintrag gesetzt ist.
// ersatz(mitarbeiterId, datum), eckdaten(mitarbeiterId, datum), die übrigen ohne Argumente.
export const aktionen = { kopieren: null, vorlagen: null, krank: null, ersatz: null, eckdaten: null, drucken: null };
aktionen.kopieren = () => kopierenDialog(planKontext());
aktionen.vorlagen = () => vorlagenDialog(planKontext());
aktionen.krank = (mitarbeiterId, tag) => krankDialog(planKontext(), mitarbeiterId, tag);
aktionen.ersatz = (mitarbeiterId, tag) => ersatzDialog(planKontext(), mitarbeiterId, tag);
aktionen.eckdaten = (mitarbeiterId, tag) => eckdatenDialog(planKontext(), mitarbeiterId, tag);

const VERTRAG_KURZ = { vollzeit: 'VZ', teilzeit: 'TZ', minijob: 'MJ', azubi: 'AZ', fuehrung: 'F' };
const VERGANGEN_TEXT = 'Vergangene Tage sind schreibgeschützt. Die IST-Erfassung folgt in der nächsten Stufe.';
const PINSEL_SCHLUESSEL = 'pep-einsatzplan-pinsel';
const MIN_ZELLE_PX = 24; // halbe Stunde; reicht die Breite nicht, scrollt nur der Raster-Container
const FESTE_SPALTEN_PX = 168 + 52 + 170; // Name, Stunden, Kommentar (wie die col-Breiten in style.css)

// Adresse: ?tag=JJJJ-MM-TT oder ?jahr=&kw= wählen die Woche, ?heute= ersetzt das heutige Datum (Vorschau).
const adresse = new URLSearchParams(location.search);
const istDatum = (w) => /^\d{4}-\d{2}-\d{2}$/.test(w ?? '');
const ganzzahl = (name, min, max) => {
  const n = Number(adresse.get(name));
  return adresse.get(name) && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const jetzt = new Date();
const heuteLokal = istDatum(adresse.get('heute')) ? adresse.get('heute')
  : `${jetzt.getFullYear()}-${String(jetzt.getMonth() + 1).padStart(2, '0')}-${String(jetzt.getDate()).padStart(2, '0')}`;
let datum = istDatum(adresse.get('tag')) ? adresse.get('tag') : null;
let { jahr, kw } = datum ? isoWoche(datum)
  : ganzzahl('jahr', 2000, 2100) && ganzzahl('kw', 1, 53) ? { jahr: ganzzahl('jahr', 2000, 2100), kw: ganzzahl('kw', 1, 53) }
    : isoWoche(heuteLokal);

let woche = null; // Antwort von pep_einsatzplan_woche
let pinsel = lesePinsel(); // Bereich-Id als Text oder 'radieren'
let zug = null; // laufendes Ziehen: { mitarbeiter, zellen, start, ende, pointerId }
let hervor = null; // in der Regelprüfung angeklickter Eintrag
let wunschTag = null; // Wochentag-Index (0 = Mo), der nach dem Blättern gewählt bleibt
const stapel = rueckgaengigStapel(20);
const laufend = new Set(); // „mitarbeiter|datum“ mit offener Anfrage: dort startet kein neuer Strich
const rahmen = {}; // Container: kopf, raster, seite

const darfZeichnen = () => ich?.rolle === 'leitung' || ich?.rolle === 'stellvertretung';
const zeigeFehler = (fehler) => { if (!fehler.behandelt) meldung(fehlerText(fehler.message)); };
const tag = () => woche?.tage.find((t) => t.datum === datum);
const darfMalen = () => darfZeichnen() && tag()?.geoeffnet && !tag().vergangen;
const spalten = () => (tag()?.geoeffnet ? halbstunden(tag().rahmen_von, tag().rahmen_bis) : []);
const bereichVon = (id) => woche.bereiche.find((b) => b.id === id);
const pauseIds = () => new Set(woche.bereiche.filter((b) => b.art === 'pause').map((b) => b.id));
const segmenteVon = (mid, d = datum) => woche.bloecke.filter((b) => b.mitarbeiter_id === mid && b.datum === d);
const abwesenheitVon = (mid) => woche.abwesenheiten.find((a) => a.mitarbeiter_id === mid && a.datum === datum);
const kommentarVon = (mid) => woche.kommentare.find((k) => k.mitarbeiter_id === mid && k.datum === datum)?.text ?? '';
const inWoche = (d) => Boolean(woche?.tage.some((t) => t.datum === d));
const nameVon = (mid) => woche.mitarbeiter.find((m) => m.id === mid)?.name ?? '';

// Stunden kurz und mit Komma: 7,5 · 8 · 6,25; negative mit echtem Minuszeichen.
const rund = (n) => Math.round(n * 100) / 100 || 0; // Rechenreste wie −1e-15 und −0 werden 0
const kurz = (n) => `${rund(n) < 0 ? '−' : ''}${Math.abs(rund(n)).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}`;
// Uhrzeit kurz für die Tages-Reiter: 07:00 → 07, 07:30 bleibt.
const kurzZeit = (t) => (t?.endsWith(':00') ? t.slice(0, 2) : t);

function lesePinsel() {
  try { return localStorage.getItem(PINSEL_SCHLUESSEL); } catch { return null; }
}

function waehlePinsel(wert) {
  pinsel = wert;
  try { localStorage.setItem(PINSEL_SCHLUESSEL, wert); } catch { /* nur für diese Sitzung */ }
  for (const k of rahmen.kopf.querySelectorAll('.chip[data-pinsel]')) k.setAttribute('aria-pressed', String(k.dataset.pinsel === wert));
}

// ---------------------------------------------------------------- Laden und Sprungziele

let ladeNummer = 0; // verwirft veraltete Antworten, wenn die Woche schnell gewechselt wird
async function lade() {
  const nummer = ++ladeNummer;
  const antwort = await aufruf('pep_einsatzplan_woche', { p_jahr: jahr, p_kw: kw });
  if (nummer !== ladeNummer || !antwort) return;
  woche = antwort;
  if (!woche.tage.some((t) => t.datum === datum)) {
    datum = wunschTag != null ? woche.tage[wunschTag].datum
      : woche.tage.some((t) => t.datum === woche.heute) ? woche.heute : woche.montag;
  }
  wunschTag = null;
  zeichneAlles();
}

// Für die Dialoge aus Task 6–8: Woche neu laden, Fehler erscheinen als Meldung.
export const planNeuLaden = () => lade().catch(zeigeFehler);

// Was die Dialoge über den aktuellen Stand wissen müssen.
export const planKontext = () => ({ woche, datum, neuLaden: planNeuLaden });

// Sprungziel für Startseite und Vorausplanung: öffnet den Reiter mit dieser Woche (und diesem Tag).
export function oeffneWoche(j, k, d = null) {
  jahr = j;
  kw = k;
  datum = d;
  zeigeAnsicht('einsatzplan');
}

// Beim Blättern bleibt der Wochentag gewählt.
function wechsleWoche(schritt) {
  const index = woche ? woche.tage.findIndex((t) => t.datum === datum) : -1;
  ({ jahr, kw } = kwVorZurueck(jahr, kw, schritt));
  datum = null;
  wunschTag = index >= 0 ? index : null;
  planNeuLaden();
}

function springeZu(d) {
  if (!istDatum(d)) return;
  ({ jahr, kw } = isoWoche(d));
  datum = d;
  if (woche?.tage.some((t) => t.datum === d)) zeichneAlles();
  else planNeuLaden();
}

function waehleTag(d) {
  datum = d;
  zeichneAlles();
}

async function zeigen() {
  meldung('');
  if (!rahmen.kopf) {
    for (const name of ['kopf', 'raster', 'seite']) rahmen[name] = element('div', { class: `ep-${name}` });
    $('ansicht-einsatzplan').replaceChildren(rahmen.kopf, element('div', { class: 'ep-layout' }, rahmen.raster, rahmen.seite));
    rahmen.raster.addEventListener('pointerdown', beiPointerAb);
    rahmen.raster.addEventListener('pointermove', beiPointerBewegung);
    rahmen.raster.addEventListener('pointerup', beiPointerAuf);
    rahmen.raster.addEventListener('pointercancel', raeumeAuf);
    window.addEventListener('resize', passeHoeheAn);
  }
  await lade().catch(zeigeFehler);
}

function zeichneAlles() {
  hervor = null;
  zeichneKopf();
  zeichneRaster();
  zeichneSeite();
}

// ---------------------------------------------------------------- Kopf: Woche, Tage, Pinsel, Knöpfe

function tagesReiter(t) {
  const klassen = ['ep-tag', t.geoeffnet ? '' : 'geschlossen', t.vergangen ? 'vergangen' : '', t.datum === woche.heute ? 'heute' : ''];
  const zeit = t.geoeffnet ? `${kurzZeit(t.oeffnung_von)}–${kurzZeit(t.oeffnung_bis)}` : t.feiertag ? 'Feiertag' : 'geschlossen';
  return element('button', {
    type: 'button', class: klassen.filter(Boolean).join(' '), 'aria-pressed': String(t.datum === datum),
    title: [datumDE(t.datum), t.feiertag, t.vergangen ? 'vergangen' : null].filter(Boolean).join(' · '),
    onclick: () => waehleTag(t.datum),
  }, element('span', {}, `${WOCHENTAGE[t.wochentag - 1]} ${t.datum.slice(8)}.${t.datum.slice(5, 7)}.`), element('small', {}, zeit));
}

function farbfeld(farbe, klasse = '') {
  const f = element('span', { class: `farbfeld ${klasse}`.trim(), 'aria-hidden': 'true' });
  if (farbe) f.style.background = farbe;
  return f;
}

function pinselLeiste() {
  if (!tag()?.geoeffnet) return element('p', { class: 'hinweis' }, 'An diesem Tag ist geschlossen.');
  if (tag().vergangen) return element('p', { class: 'hinweis-gelb' }, VERGANGEN_TEXT);
  if (!darfZeichnen()) return element('p', { class: 'hinweis' }, 'Keine Berechtigung zum Bearbeiten.');
  const gueltig = pinsel === 'radieren' || woche.bereiche.some((b) => String(b.id) === pinsel);
  if (!gueltig) pinsel = String((woche.bereiche.find((b) => b.bedeutung === 'kasse') ?? woche.bereiche[0])?.id ?? 'radieren');
  const chip = (wert, titel, ...inhalt) => element('button', {
    type: 'button', class: 'chip', 'data-pinsel': wert, 'aria-pressed': String(pinsel === wert), title: titel,
    onclick: () => waehlePinsel(wert),
  }, ...inhalt);
  return element('div', { class: 'chip-gruppe ep-pinsel', role: 'group', 'aria-label': 'Pinsel' },
    woche.bereiche.map((b) => chip(String(b.id), b.name, farbfeld(b.farbe), b.kuerzel)),
    chip('radieren', 'Radieren: gezogene halbe Stunden leeren', farbfeld(null, 'leer'), 'Radieren'));
}

function aktionsKnopf(name, text) {
  return aktionen[name]
    ? element('button', { type: 'button', class: 'knopf', 'data-aktion': name, onclick: () => starte(() => aktionen[name]()) }, text)
    : null;
}

// Aktionen aus den Dialog-Modulen: Fehler (auch synchrone) erscheinen als Meldung.
const starte = (fn) => Promise.resolve().then(fn).catch(zeigeFehler);

function zeichneKopf() {
  const auswahl = element('input', { type: 'date', class: 'ep-datum', 'aria-label': 'Datum wählen', value: datum });
  auswahl.addEventListener('change', () => springeZu(auswahl.value));
  rahmen.rueckgaengig = element('button', {
    type: 'button', class: 'knopf', disabled: stapel.leer(), onclick: rueckgaengig,
    title: 'Letzten Strich zurücknehmen (bis zu 20 Schritte)',
  }, '↶ Rückgängig');
  rahmen.kopf.replaceChildren(element('div', { class: 'karte werkzeugleiste ep-werkzeug' },
    element('div', { class: 'werkzeug-zeile' },
      element('div', { class: 'monatsnavi' },
        element('button', { type: 'button', class: 'knopf pfeil', 'aria-label': 'Vorherige Woche', onclick: () => wechsleWoche(-1) }, '◀'),
        element('strong', { class: 'ep-kw', title: `${datumDE(woche.montag)} – ${datumDE(plusTage(woche.montag, 6))}` }, `KW ${woche.kw}`),
        element('button', { type: 'button', class: 'knopf pfeil', 'aria-label': 'Nächste Woche', onclick: () => wechsleWoche(1) }, '▶'),
        auswahl,
        element('button', { type: 'button', class: 'knopf', onclick: () => springeZu(woche?.heute ?? heuteLokal) }, 'Heute')),
      element('div', { class: 'ep-tage', role: 'group', 'aria-label': 'Tag' }, woche.tage.map(tagesReiter))),
    element('div', { class: 'werkzeug-zeile' },
      pinselLeiste(),
      element('div', { class: 'ep-knoepfe' }, rahmen.rueckgaengig,
        aktionsKnopf('kopieren', 'Kopieren'), aktionsKnopf('vorlagen', 'Vorlagen'),
        aktionsKnopf('krank', 'Krank/ZA'), aktionsKnopf('drucken', 'Drucken')))));
}

// ---------------------------------------------------------------- Raster

function namensZelle(m) {
  const kuerzel = m.kompetenzen.map((id) => bereichVon(id)?.kuerzel).filter(Boolean);
  if (m.vp) kuerzel.push('VP');
  const vertrag = m.vertragsart ? `${VERTRAG_KURZ[m.vertragsart] ?? m.vertragsart} ${kurz(Number(m.wochenstunden) || 0)}` : 'kein Vertrag';
  const a = abwesenheitVon(m.id);
  const name = aktionen.eckdaten
    ? element('button', { type: 'button', class: 'ep-name-knopf', title: `Eckdaten: ${m.name}`, onclick: () => starte(() => aktionen.eckdaten(m.id, datum)) }, m.name)
    : element('span', { class: 'ep-name-text', title: m.name }, m.name);
  return element('th', { class: 'ep-name' }, name, element('small', { class: 'ep-info' },
    vertrag, kuerzel.map((k) => element('span', { class: 'badge' }, k)),
    a ? element('span', { class: 'ep-abw-kz', title: a.name }, ` · ${a.code}${a.von ? ` ${zeitspanne(a.von, a.bis)}` : ''}`) : null));
}

function kommentarZelle(m) {
  const td = element('td', { class: 'ep-kom', 'data-kommentar': m.id });
  const text = kommentarVon(m.id);
  const bearbeitbar = darfZeichnen() && !tag()?.vergangen;
  td.append(text ? element('span', { title: text }, text) : bearbeitbar ? element('span', { class: 'ep-kom-leer' }, '+ Notiz') : '');
  if (bearbeitbar) {
    td.classList.add('bearbeitbar');
    td.addEventListener('click', () => bearbeiteKommentar(td, m));
  }
  return td;
}

// Ein Klick öffnet ein Eingabefeld; Enter oder Verlassen speichert, Escape bricht ab.
function bearbeiteKommentar(td, m) {
  if (td.querySelector('input')) return;
  const alt = kommentarVon(m.id);
  const tagDesKommentars = datum;
  const feld = element('input', { type: 'text', maxlength: '200', 'aria-label': `Kommentar ${m.name}` });
  feld.value = alt;
  let abbrechen = false;
  feld.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') feld.blur();
    if (e.key === 'Escape') { abbrechen = true; feld.blur(); }
  });
  feld.addEventListener('blur', async () => {
    const neu = feld.value.trim();
    if (!abbrechen && neu !== alt) {
      try {
        await aufruf('pep_kommentar_setzen', { p_mitarbeiter_id: m.id, p_datum: tagDesKommentars, p_text: neu });
        if (inWoche(tagDesKommentars)) {
          woche.kommentare = woche.kommentare.filter((k) => !(k.mitarbeiter_id === m.id && k.datum === tagDesKommentars));
          if (neu) woche.kommentare.push({ mitarbeiter_id: m.id, datum: tagDesKommentars, text: neu });
        }
      } catch (fehler) { zeigeFehler(fehler); }
    }
    // Wurde die Zeile inzwischen neu gezeichnet, gilt die neue Zelle; nach einem Tageswechsel bleibt alles, wie es ist.
    const ziel = td.isConnected ? td : rahmen.raster.querySelector(`td[data-kommentar="${m.id}"]`);
    if (ziel && tagDesKommentars === datum) ziel.replaceWith(kommentarZelle(m));
  });
  td.replaceChildren(feld);
  feld.focus();
}

function zeile(m, sp, oeffnung) {
  const tr = element('tr', { 'data-mitarbeiter': m.id });
  const segmente = segmenteVon(m.id);
  const a = abwesenheitVon(m.id);
  const stunden = tagesStunden(segmente, pauseIds());
  tr.append(namensZelle(m), element('td', { class: 'ep-std zahl' }, segmente.length ? kurz(stunden) : '–'));
  if (a?.sperrt && !a.von && !segmente.length) {
    // Ganztags abwesend ohne geplante Blöcke: graue Zeile, nicht bemalbar.
    tr.classList.add('ep-abwesend');
    tr.append(element('td', { class: 'ep-sperre', colspan: sp.length }, `${a.code} – ${a.name}`), kommentarZelle(m));
    return tr;
  }
  if (a?.sperrt) tr.classList.add('ep-teilabwesend');
  const belegung = zellen(segmente, sp);
  sp.forEach((von, i) => {
    const z = belegung[i];
    const klassen = ['ep-z'];
    if (von.endsWith(':00')) klassen.push('voll');
    if (von < oeffnung.von || von >= oeffnung.bis) klassen.push('zu');
    if (a?.sperrt && (!a.von || (von >= a.von && von < a.bis))) klassen.push('ep-abw');
    const td = element('td', { class: klassen.join(' '), 'data-i': i, 'data-von': von });
    const titel = [von];
    if (z) {
      const b = bereichVon(z.bereich_id);
      const vorher = belegung[i - 1];
      const beginn = !vorher || vorher.block_id !== z.block_id || vorher.unbesetzt !== z.unbesetzt;
      td.classList.add('belegt');
      if (z.unbesetzt) td.classList.add('unbesetzt');
      else if (b?.farbe) { td.style.backgroundColor = b.farbe; td.style.color = textfarbe(b.farbe); }
      if (beginn) {
        td.classList.add('ep-start');
        td.append(element('span', { class: 'ep-kz' }, b?.kuerzel ?? '?'));
        if (z.unbesetzt && aktionen.ersatz && !tag().vergangen) {
          td.append(element('button', { type: 'button', class: 'ep-ersatz', onclick: () => starte(() => aktionen.ersatz(m.id, datum)) }, 'Ersatz'));
        }
      }
      titel.push(b ? `${b.kuerzel} ${b.name}` : '', z.unbesetzt ? `unbesetzt (${a?.code ?? 'abwesend'})` : '');
    } else if (klassen.includes('ep-abw')) titel.push(`${a.code} ${a.name}`);
    td.title = titel.filter(Boolean).join(' · ');
    tr.append(td);
  });
  tr.append(kommentarZelle(m));
  return tr;
}

function abdeckungsZeilen(sp, oeffnung) {
  const { kasse, vp, anwesend } = abdeckung(woche, datum, sp);
  const reihe = (titel, art, werte) => element('tr', { class: `ep-deckung ep-deckung-${art}` },
    element('th', { class: 'ep-name' }, titel), element('td', {}),
    sp.map((von, i) => {
      const offen = von >= oeffnung.von && von < oeffnung.bis;
      const klasse = abdeckungsKlasse(art, werte[i], offen, anwesend[i]);
      const zeigen = werte[i] > 0 || klasse;
      return element('td', { class: ['ep-dz', von.endsWith(':00') ? 'voll' : '', klasse].filter(Boolean).join(' '), 'data-von': von }, zeigen ? String(werte[i]) : '');
    }),
    element('td', {}));
  return element('tfoot', {}, reihe('Kasse', 'kasse', kasse), reihe('VP', 'vp', vp));
}

function zeichneRaster() {
  raeumeAuf(); // ein laufender Strich gehört zu Zellen, die es gleich nicht mehr gibt
  const t = tag();
  if (!t?.geoeffnet) {
    rahmen.raster.classList.remove('malt');
    rahmen.raster.replaceChildren(element('div', { class: 'karte ep-geschlossen' },
      element('h2', {}, `${WOCHENTAGE[(t?.wochentag ?? 7) - 1]}, ${datumDE(datum)}: geschlossen`),
      t?.feiertag ? element('p', {}, t.feiertag) : null));
    return;
  }
  const sp = spalten();
  const oeffnung = { von: t.oeffnung_von, bis: t.oeffnung_bis };
  // Kopf: eine Zelle je Stunde (zwei halbe Stunden), Öffnungszeit mit gelbem Strich.
  const stunden = [];
  for (const von of sp) {
    const letzte = stunden.at(-1);
    if (letzte && von.endsWith(':30') && letzte.von.slice(0, 2) === von.slice(0, 2)) letzte.breite += 1;
    else stunden.push({ von, breite: 1 });
  }
  const kopf = element('tr', {}, element('th', { class: 'ep-name' }, 'Mitarbeiter'), element('th', { class: 'zahl' }, 'Std.'),
    stunden.map((s) => element('th', {
      colspan: s.breite, class: ['ep-stunde', s.von >= oeffnung.von && s.von < oeffnung.bis ? 'offen' : ''].filter(Boolean).join(' '),
    }, s.von)),
    element('th', { class: 'ep-kom' }, 'Kommentar'));
  const tabelle = element('table', { class: 'raster ep-tabelle' },
    element('colgroup', {}, element('col', { class: 'ep-name-spalte' }), element('col', { class: 'ep-std-spalte' }),
      sp.map(() => element('col', {})), element('col', { class: 'ep-kom-spalte' })),
    element('thead', {}, kopf),
    element('tbody', {}, woche.mitarbeiter.map((m) => zeile(m, sp, oeffnung))),
    abdeckungsZeilen(sp, oeffnung));
  tabelle.style.minWidth = `${FESTE_SPALTEN_PX + sp.length * MIN_ZELLE_PX}px`;
  rahmen.raster.classList.toggle('malt', Boolean(darfMalen()));
  const leer = woche.mitarbeiter.length ? null
    : element('p', { class: 'hinweis' }, 'In dieser Woche ist niemand beschäftigt. Mitarbeiter und Verträge pflegt der Reiter „Mitarbeiter“.');
  rahmen.raster.replaceChildren(...[element('div', { class: 'raster-scroll ep-scroll' }, tabelle), leer].filter(Boolean));
  passeHoeheAn();
}

// Das Raster endet am unteren Fensterrand, damit die Abdeckungszeilen (unten klebend) ohne Seitenscrollen sichtbar
// bleiben; der Kopf ist je nach Breite zwei oder drei Zeilen hoch.
function passeHoeheAn() {
  const scroll = rahmen.raster?.querySelector('.ep-scroll');
  if (!scroll || $('ansicht-einsatzplan').hidden) return;
  const oben = scroll.getBoundingClientRect().top + window.scrollY;
  scroll.style.maxHeight = `calc(100vh - ${Math.round(oben) + 16}px)`;
}

// Nach einem Strich: nur die geänderten Zeilen, die Abdeckung und die Seitenleiste neu zeichnen.
function zeichneZeilen(ids) {
  const t = tag();
  const tabelle = rahmen.raster.querySelector('.ep-tabelle');
  if (!t?.geoeffnet || !tabelle) { zeichneAlles(); return; }
  const sp = spalten();
  const oeffnung = { von: t.oeffnung_von, bis: t.oeffnung_bis };
  if (zug && ids.includes(zug.mitarbeiter)) raeumeAuf();
  for (const id of ids) {
    const m = woche.mitarbeiter.find((x) => x.id === id);
    const alt = tabelle.querySelector(`tbody tr[data-mitarbeiter="${id}"]`);
    if (m && alt) alt.replaceWith(zeile(m, sp, oeffnung));
  }
  tabelle.querySelector('tfoot').replaceWith(abdeckungsZeilen(sp, oeffnung));
  for (const x of tabelle.querySelectorAll('.hervor, .hervor-zelle')) x.classList.remove('hervor', 'hervor-zelle');
  hervor = null;
  zeichneSeite();
}

// ---------------------------------------------------------------- Malen (Pointer-Events)

// Zelle der gezogenen Zeile unter dem Zeiger, nur nach x; außerhalb der Zeile die nächste Randzelle.
function indexBei(x) {
  const z = zug.zellen;
  if (x < z[0].getBoundingClientRect().left) return 0;
  const i = z.findIndex((td) => x < td.getBoundingClientRect().right);
  return i < 0 ? z.length - 1 : i;
}

function markiere() {
  const a = Math.min(zug.start, zug.ende);
  const b = Math.max(zug.start, zug.ende);
  zug.zellen.forEach((td, i) => td.classList.toggle('markiert', i >= a && i <= b));
}

// Löscht die Markierung und gibt den Pointer frei (auch bei Abbruch und Fehlern).
function raeumeAuf() {
  if (zug) {
    zug.zellen.forEach((td) => td.classList.remove('markiert'));
    try { rahmen.raster.releasePointerCapture(zug.pointerId); } catch { /* schon freigegeben */ }
  }
  zug = null;
}

function beiPointerAb(e) {
  if (zug || !darfMalen() || (e.pointerType === 'mouse' && e.button !== 0) || e.target.closest?.('button, input')) return;
  const td = e.target.closest?.('td.ep-z');
  if (!td) return;
  const tr = td.parentElement;
  if (laufend.has(`${tr.dataset.mitarbeiter}|${datum}`)) return; // erst die Antwort des vorigen Strichs abwarten
  zug = {
    mitarbeiter: Number(tr.dataset.mitarbeiter), zellen: [...tr.querySelectorAll('td.ep-z')],
    start: Number(td.dataset.i), ende: Number(td.dataset.i), pointerId: e.pointerId,
  };
  rahmen.raster.setPointerCapture(e.pointerId);
  markiere();
  e.preventDefault();
}

function beiPointerBewegung(e) {
  if (!zug || e.pointerId !== zug.pointerId) return;
  const i = indexBei(e.clientX);
  if (i === zug.ende) return;
  zug.ende = i;
  markiere();
}

async function beiPointerAuf(e) {
  if (!zug || e.pointerId !== zug.pointerId) return;
  zug.ende = indexBei(e.clientX);
  const { mitarbeiter, start, ende } = zug;
  raeumeAuf();
  const { von, bis } = strich(spalten(), start, ende);
  const tagDesStrichs = datum;
  const vorher = gespeicherteZeile(mitarbeiter, tagDesStrichs);
  const schluessel = `${mitarbeiter}|${tagDesStrichs}`;
  laufend.add(schluessel);
  try {
    const antwort = await aufruf('pep_plan_malen', {
      p_mitarbeiter_id: mitarbeiter, p_datum: tagDesStrichs, p_von: von, p_bis: bis,
      p_bereich_id: pinsel === 'radieren' ? null : Number(pinsel),
    });
    if (!antwort) return; // Vorschau ohne Datenbank
    if (inWoche(tagDesStrichs)) {
      uebernehme(antwort, [mitarbeiter]);
      if (JSON.stringify(gespeicherteZeile(mitarbeiter, tagDesStrichs)) !== JSON.stringify(vorher)) {
        stapel.merken({ mitarbeiterId: mitarbeiter, datum: tagDesStrichs, bloecke: vorher });
      }
      if (tagDesStrichs === datum) zeichneZeilen([mitarbeiter]);
      else zeichneSeite(); // Tag inzwischen gewechselt: Wochenstunden trotzdem aktuell halten
    } else {
      // Woche inzwischen gewechselt: die Antwort gehört nicht zu den geladenen Daten, Rückgängig gilt trotzdem.
      stapel.merken({ mitarbeiterId: mitarbeiter, datum: tagDesStrichs, bloecke: vorher });
    }
    rahmen.rueckgaengig.disabled = stapel.leer();
  } catch (fehler) {
    if (fehler.behandelt) return;
    sperreAmZeiger(fehlerText(fehler.message), e.clientX, e.clientY);
    meldung(fehlerText(fehler.message));
  } finally {
    laufend.delete(schluessel);
  }
}

// Kleiner Hinweis an der Zeigerposition, 3 s lang.
function sperreAmZeiger(text, x, y) {
  const hinweis = element('div', { class: 'ep-sperre-hinweis', role: 'status' }, text);
  document.body.append(hinweis);
  const breite = hinweis.offsetWidth;
  hinweis.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - breite - 8))}px`;
  hinweis.style.top = `${Math.max(8, y - hinweis.offsetHeight - 12)}px`;
  setTimeout(() => hinweis.remove(), 3000);
}

// Gespeicherte Blöcke einer Zeile (Abschnitte derselben id wieder zusammengesetzt), wie pep_plan_zeile_setzen sie nimmt.
function gespeicherteZeile(mid, d) {
  const bloecke = new Map();
  for (const s of segmenteVon(mid, d)) {
    const b = bloecke.get(s.id);
    if (!b) bloecke.set(s.id, { von: s.von, bis: s.bis, bereich_id: s.bereich_id });
    else {
      if (minuten(s.von) < minuten(b.von)) b.von = s.von;
      if (minuten(s.bis) > minuten(b.bis)) b.bis = s.bis;
    }
  }
  return [...bloecke.values()].sort((a, b) => minuten(a.von) - minuten(b.von));
}

// Tag-Antwort einarbeiten: Abschnitte dieser Mitarbeiter am Tag ersetzen, Prüfung der gelieferten Tage der Woche übernehmen.
function uebernehme(antwort, ids) {
  woche.bloecke = woche.bloecke
    .filter((b) => !(b.datum === antwort.datum && ids.includes(b.mitarbeiter_id)))
    .concat(antwort.bloecke ?? []);
  for (const [d, liste] of Object.entries(antwort.pruefung ?? {})) {
    if (d in woche.pruefung) woche.pruefung[d] = liste;
  }
}

async function rueckgaengig() {
  const eintrag = stapel.holen();
  rahmen.rueckgaengig.disabled = stapel.leer();
  if (!eintrag) return;
  const schluessel = `${eintrag.mitarbeiterId}|${eintrag.datum}`;
  laufend.add(schluessel);
  try {
    const antwort = await aufruf('pep_plan_zeile_setzen', {
      p_mitarbeiter_id: eintrag.mitarbeiterId, p_datum: eintrag.datum, p_bloecke: eintrag.bloecke,
    });
    if (!antwort) return;
    if (inWoche(eintrag.datum)) {
      uebernehme(antwort, [eintrag.mitarbeiterId]);
      if (eintrag.datum === datum) zeichneZeilen([eintrag.mitarbeiterId]);
      else waehleTag(eintrag.datum);
    } else {
      springeZu(eintrag.datum); // Strich aus einer anderen Woche: dorthin wechseln, damit man sieht, was zurückging
    }
    meldung(`Rückgängig: ${nameVon(eintrag.mitarbeiterId) || 'Zeile'}, ${datumDE(eintrag.datum)}`, 'ok');
  } catch (fehler) {
    zeigeFehler(fehler);
  } finally {
    laufend.delete(schluessel);
  }
}

// ---------------------------------------------------------------- Seitenleiste

// Klick auf einen Prüf-Eintrag markiert Zeile und Zellen (ohne Mitarbeiter: die Abdeckungszeile).
function markiereEintrag(e, knopf) {
  for (const x of rahmen.raster.querySelectorAll('.hervor, .hervor-zelle')) x.classList.remove('hervor', 'hervor-zelle');
  for (const k of rahmen.seite.querySelectorAll('.ep-eintrag[aria-pressed="true"]')) k.setAttribute('aria-pressed', 'false');
  if (hervor === e) { hervor = null; return; }
  hervor = e;
  knopf.setAttribute('aria-pressed', 'true');
  const tabelle = rahmen.raster.querySelector('.ep-tabelle');
  if (!tabelle) return;
  const reihe = e.mitarbeiter_id ? tabelle.querySelector(`tbody tr[data-mitarbeiter="${e.mitarbeiter_id}"]`)
    : tabelle.querySelector(e.art === 'kasse_unbesetzt' ? '.ep-deckung-kasse' : '.ep-deckung-vp');
  if (!reihe) return;
  reihe.classList.add('hervor');
  const zellenDerZeit = [...reihe.querySelectorAll('td[data-von]')]
    .filter((td) => e.von && td.dataset.von >= e.von && td.dataset.von < e.bis);
  zellenDerZeit.forEach((td) => td.classList.add('hervor-zelle'));
  (zellenDerZeit[0] ?? reihe.firstElementChild).scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

const anzahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;

function regelBox() {
  // Je Schwere zuerst Einträge mit Uhrzeit, dann die Wochenregeln (die sich an jedem Tag wiederholen);
  // sonst gilt die Reihenfolge des Servers (sort ist stabil, Warnungen liefert er vor Hinweisen).
  const rang = (e) => (e.schwere === 'warnung' ? 0 : 2) + (e.von ? 0 : 1);
  const liste = [...(woche.pruefung[datum] ?? [])].sort((a, b) => rang(a) - rang(b));
  const eintraege = liste.map((e) => {
    const knopf = element('button', {
      type: 'button', class: `ep-eintrag ${e.schwere === 'warnung' ? 'warnung' : 'hinweis-gelb'}`, 'aria-pressed': 'false',
      onclick: () => markiereEintrag(e, knopf),
    }, e.mitarbeiter_id ? element('strong', {}, nameVon(e.mitarbeiter_id)) : null, element('span', {}, e.text));
    return element('li', {}, knopf);
  });
  const warnungen = liste.filter((e) => e.schwere === 'warnung').length;
  return element('section', { class: 'karte ep-box' },
    element('h3', {}, `Regelprüfung ${WOCHENTAGE[tag().wochentag - 1]} ${datumDE(datum).slice(0, 6)}`,
      liste.length ? element('small', {}, ` ${anzahl(warnungen, 'Warnung', 'Warnungen')}, ${anzahl(liste.length - warnungen, 'Hinweis', 'Hinweise')}`) : null),
    liste.length ? element('ul', { class: 'ep-regeln' }, eintraege) : element('p', { class: 'hinweis' }, 'Keine Auffälligkeiten.'));
}

function differenzZelle(roh) {
  const wert = rund(roh);
  return element('td', { class: `zahl ${wert < 0 ? 'minus' : 'plus'}` }, `${wert > 0 ? '+' : ''}${kurz(wert)}`);
}

function wochenBox() {
  const summen = wochenSummen(woche);
  let geplant = 0;
  const zeilen = woche.mitarbeiter.map((m) => {
    const s = summen.get(m.id);
    geplant += s.geplant;
    return element('tr', {}, element('th', { title: m.name }, m.name),
      element('td', { class: 'zahl' }, kurz(s.soll)), element('td', { class: 'zahl' }, kurz(s.geplant)), differenzZelle(s.differenz));
  });
  const k = woche.kennzahlen ?? {};
  const vorgabe = k.stundenvorgabe == null ? null : Number(k.stundenvorgabe);
  return element('section', { class: 'karte ep-box' },
    element('h3', {}, `Woche KW ${woche.kw}`),
    element('table', { class: 'ep-klein' },
      element('thead', {}, element('tr', {}, element('th', {}, 'Mitarbeiter'),
        element('th', { class: 'zahl' }, 'Soll'), element('th', { class: 'zahl' }, 'geplant'), element('th', { class: 'zahl' }, 'Diff.'))),
      element('tbody', {}, zeilen),
      element('tfoot', {}, element('tr', {}, element('th', {}, 'Summe / Vorgabe'),
        element('td', { class: 'zahl' }, vorgabe == null ? '–' : kurz(vorgabe)), element('td', { class: 'zahl' }, kurz(geplant)),
        vorgabe == null ? element('td', {}) : differenzZelle(geplant - vorgabe)))),
    element('p', { class: 'hinweis ep-fuss' }, 'Soll = Vertrag − Abwesenheiten.',
      k.vorgabe_quelle === 'verfuegbar' ? ' Vorgabe ohne Planumsatz (verfügbare Stunden).' : ''));
}

function abteilungsBox() {
  const stunden = bereichsStunden(woche, datum);
  const zeilen = woche.bereiche.filter((b) => stunden.has(b.id)).map((b) => element('tr', {},
    element('th', {}, farbfeld(b.farbe), ` ${b.name}`), element('td', { class: 'zahl' }, kurz(stunden.get(b.id)))));
  const summe = [...stunden.values()].reduce((a, b) => a + b, 0);
  return element('section', { class: 'karte ep-box' },
    element('h3', {}, 'Abteilungen heute'),
    zeilen.length ? element('table', { class: 'ep-klein' }, element('tbody', {}, zeilen),
      element('tfoot', {}, element('tr', {}, element('th', {}, 'Summe'), element('td', { class: 'zahl' }, kurz(summe)))))
      : element('p', { class: 'hinweis' }, 'Noch nichts geplant.'),
    element('p', { class: 'hinweis ep-fuss' }, 'Vorgaben je Bereich kommen mit der Bedarfsplanung.'));
}

function zeichneSeite() {
  rahmen.seite.replaceChildren(...(tag()?.geoeffnet ? [regelBox(), wochenBox(), abteilungsBox()] : [wochenBox()]));
}

reiter.einsatzplan = { zeigen };

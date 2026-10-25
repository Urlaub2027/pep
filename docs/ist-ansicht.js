// IST-Modus des Einsatzplans (G8): was nur der IST-Modus zeigt, und die reinen Hilfen dazu. Malen, Rückgängig und die
// Strich-Warteschlange bleiben in einsatzplan.js (dort ruft der IST-Modus pep_ist_* statt pep_plan_*). Bewusst ohne
// Import von app.js und einsatzplan.js: kein Importzyklus, und die reinen Hilfen laufen in node (tests/ist-ansicht.test.mjs).
// Eingabe `woche` = Antwort von pep_ist_woche: bloecke = IST bzw. Vorschlag (vorschlag: true, negative id), dazu
// plan_bloecke (Plan-Segmente) und status [{mitarbeiter_id, datum, bestaetigt}] je IST-Zeile bis heute.
import { element } from './hilfe.js';
import { minuten, uhrzeit, halbstunden } from './zeit.js';
import { tagesStunden, tagKurz, kurz, rund } from './plan-raster.js';
import { dialog } from './dialog.js';

const STANDARD_VON = '06:00'; // das IST-Raster beginnt spätestens hier
const GESCHLOSSEN_BIS = '22:00'; // geschlossener Tag (ohne Rahmen), z. B. Inventur
const ERWEITERT = ['04:00', '24:00']; // Grenzen der IST-Erfassung (G6)

export const GRUND_ALLGEMEIN = 'Bestätigte Tage werden mit Grund geändert. Der Grund steht im Protokoll und gilt für alle '
  + 'Striche in dieser Zeile, bis du den Tag wechselst.';
export const GRUND_ABGESCHLOSSEN = 'Die Woche ist schon abgeschlossen – die Änderung wird im Zeitkonto nachgebucht.';

const vonZeile = (mid, d) => (x) => x.mitarbeiter_id === mid && x.datum === d;
const pausenVon = (woche) => new Set((woche.bereiche ?? []).filter((b) => b.art === 'pause').map((b) => b.id));
const anzahl = (n, eins, mehr) => `${n} ${n === 1 ? eins : mehr}`;
const statusVon = (woche, mid, d) => (woche.status ?? []).find(vonZeile(mid, d));

// ---------------------------------------------------------------- Reine Hilfen

// Halbstunden des IST-Rasters: von min(Rahmen, frühester Block, 06:00) bis max(Rahmen, spätester Block); `segmente`
// sind alle IST-, Vorschlag- und Plan-Segmente des Tages. erweitert: 04:00–24:00. Mitternacht ist '24:00'.
// Der Beginn rundet auf die volle Stunde ab (05:30 → 05:00), sonst bekäme der Stundenkopf eine halbe, abgeschnittene Zelle.
export function istSpalten(tag, segmente, erweitert = false) {
  if (erweitert) return halbstunden(...ERWEITERT);
  let von = minuten(STANDARD_VON);
  let bis = minuten(tag?.rahmen_bis ?? GESCHLOSSEN_BIS);
  if (tag?.rahmen_von) von = Math.min(von, minuten(tag.rahmen_von));
  for (const s of segmente) {
    von = Math.min(von, minuten(s.von));
    bis = Math.max(bis, minuten(s.bis));
  }
  return halbstunden(uhrzeit(von - (von % 60)), uhrzeit(bis));
}

// Status einer Zeile (Mitarbeiter, Tag): art keine | bestaetigt | vorschlag | offen | leer.
// „leer“: offen, ohne IST und ohne Vorschlag, obwohl der Plan besetzte Zeit hat. Das gibt es nur, wenn jemand die Zeile
// ausdrücklich leer gemacht hat (pep.ist_leer); der Vorschlag kommt dann nicht von selbst wieder.
export function zeilenStatus(woche, mid, d) {
  const s = statusVon(woche, mid, d);
  if (!s) return { art: 'keine', text: '–' };
  if (s.bestaetigt) return { art: 'bestaetigt', text: 'bestätigt ✓', titel: 'Bestätigt. Änderungen nur mit Grund.' };
  const segmente = (woche.bloecke ?? []).filter(vonZeile(mid, d));
  if (segmente.some((x) => x.vorschlag)) {
    return { art: 'vorschlag', text: 'offen', titel: 'Noch nicht bestätigt. Blass = Vorschlag aus dem Plan.' };
  }
  if (segmente.length) return { art: 'offen', text: 'offen', titel: 'Noch nicht bestätigt.' };
  if ((woche.plan_bloecke ?? []).some((x) => vonZeile(mid, d)(x) && !x.unbesetzt)) {
    return { art: 'leer', text: 'offen, leer', titel: 'Ausdrücklich leer gemacht: kein Vorschlag mehr. Bestätigen erfasst 0 Stunden.' };
  }
  return { art: 'offen', text: 'offen', titel: 'Noch nicht bestätigt. Nichts geplant.' };
}

// Stunden IST (gespeichert oder Vorschlag) und Plan eines Tages ohne Pause und ohne unbesetzte Teile; diff = IST − Plan.
export function istAbweichung(woche, mid, d) {
  const pausen = pausenVon(woche);
  const ist = rund(tagesStunden((woche.bloecke ?? []).filter(vonZeile(mid, d)), pausen));
  const plan = rund(tagesStunden((woche.plan_bloecke ?? []).filter(vonZeile(mid, d)), pausen));
  return { ist, plan, diff: rund(ist - plan) };
}

// Offene Zeilen der Woche je Tag: [{ datum, ids }] in Datumsfolge.
export function offeneTage(woche) {
  const tage = new Map();
  const offen = (woche.status ?? []).filter((s) => !s.bestaetigt).sort((a, b) => a.datum.localeCompare(b.datum));
  for (const s of offen) {
    if (!tage.has(s.datum)) tage.set(s.datum, []);
    tage.get(s.datum).push(s.mitarbeiter_id);
  }
  return [...tage].map(([datum, ids]) => ({ datum, ids }));
}

// Plan- und IST-Stunden eines Tages je Mitarbeiter (Reihenfolge der Woche); nur wer geplant ist, IST hat oder eine Zeile.
export function tagesSummen(woche, d) {
  return (woche.mitarbeiter ?? [])
    .map((m) => ({ id: m.id, name: m.name, ...istAbweichung(woche, m.id, d) }))
    .filter((x) => x.plan || x.ist || statusVon(woche, x.id, d))
    .map(({ id, name, plan, ist }) => ({ id, name, plan, ist }));
}

// Kleiner Text unter dem Tages-Reiter im IST-Modus.
export function tagesReiterText(woche, t) {
  if (!t.ist_erlaubt) return 'nur Plan';
  const zeilen = (woche.status ?? []).filter((s) => s.datum === t.datum);
  const offen = zeilen.filter((s) => !s.bestaetigt).length;
  if (offen) return `${offen} offen`;
  if (zeilen.length) return 'bestätigt ✓';
  return t.feiertag ? 'Feiertag' : t.geoeffnet ? '–' : 'geschlossen';
}

// Klassen für den Plan-Umriss einer Zelle; `plan` = zellen(besetzte Plan-Segmente, Spalten). Der Umriss läuft über
// zusammenhängende geplante Zeit; Kanten an Anfang (plan-a) und Ende (plan-e).
export function planUmriss(plan, i) {
  if (!plan[i]) return [];
  return ['plan', !plan[i - 1] ? 'plan-a' : null, !plan[i + 1] ? 'plan-e' : null].filter(Boolean);
}

// Klassen für eine Zelle einer Vorschlag-Zeile: blass, gestrichelte Kante je Block.
function vorschlagKanten(belegung, i) {
  const z = belegung[i];
  if (!z) return [];
  const gleich = (x) => x && x.block_id === z.block_id;
  return ['vorschlag', !gleich(belegung[i - 1]) ? 'v-a' : null, !gleich(belegung[i + 1]) ? 'v-e' : null].filter(Boolean);
}

// Zusatzklassen einer IST-Zelle. Eine Vorschlag-Zeile ist der besetzte Plan selbst: dort kein zweiter Umriss.
export function istZellKlassen(belegung, plan, i, vorschlag) {
  return vorschlag ? vorschlagKanten(belegung, i) : planUmriss(plan, i);
}

// ---------------------------------------------------------------- Kopf, Raster und Seitenleiste

// Knöpfe im Kopf: Zeitrahmen 04:00–24:00 ein/aus und „Tag bestätigen“ (alle offenen Zeilen des Tages).
// gesperrt: ein Bestätigen läuft gerade; darfBestaetigen: Rolle und Tag (≤ heute) erlauben es.
export function istKnopfLeiste({ woche, datum, erweitert, gesperrt, darfBestaetigen, umschalten, bestaetigen }) {
  const offen = (woche.status ?? []).filter((s) => s.datum === datum && !s.bestaetigt).length;
  return [
    element('button', {
      type: 'button', class: 'knopf', 'aria-pressed': String(erweitert), title: 'Raster von 04:00 bis 24:00 zeigen', onclick: umschalten,
    }, erweitert ? 'Zeitrahmen normal' : 'Zeitrahmen erweitern'),
    darfBestaetigen ? element('button', {
      type: 'button', class: 'knopf primaer', 'data-aktion': 'tag-bestaetigen', disabled: !offen || gesperrt,
      title: offen ? `${anzahl(offen, 'offene Zeile', 'offene Zeilen')} bestätigen (Zeilen ohne IST übernehmen den Vorschlag)`
        : 'Alle Zeilen dieses Tages sind bestätigt.',
      onclick: bestaetigen,
    }, 'Tag bestätigen') : null,
  ];
}

// Statt des Rasters an einem künftigen Tag: Hinweis und Sprung in den Plan.
export function zukunftKarte(t, zumPlan) {
  return element('div', { class: 'karte ep-geschlossen' },
    element('h2', {}, `${tagKurz(t.datum)}${t.datum.slice(0, 4)}: noch kein IST`),
    element('p', {}, 'Arbeitszeiten lassen sich erst ab dem Tag selbst erfassen. Künftige Tage gibt es nur im Plan.'),
    element('button', { type: 'button', class: 'knopf', onclick: zumPlan }, 'Plan zeigen'));
}

// Statusfeld einer Zeile; bestaetigen = Funktion für den Knopf „✓“ (nur bei offenen Zeilen) oder null.
export function statusZelle(status, bestaetigen) {
  const knopf = bestaetigen && !['keine', 'bestaetigt'].includes(status.art)
    ? element('button', {
      type: 'button', class: 'ist-ok-knopf', title: 'Diese Zeile bestätigen', 'aria-label': 'Zeile bestätigen', onclick: bestaetigen,
    }, '✓') : null;
  return element('td', { class: `ist-status ist-${status.art}`, title: status.titel ?? null },
    element('div', { class: 'ist-status-inhalt' }, element('span', {}, status.text), knopf));
}

const vorzeichen = (n) => `${rund(n) > 0 ? '+' : ''}${kurz(n)}`;
const diffKlasse = (n) => (rund(n) < 0 ? 'minus' : rund(n) > 0 ? 'plus' : '');

// Abweichung IST − Plan in Stunden.
export function abweichungsZelle(a, status) {
  if (status.art === 'keine' && !a.ist && !a.plan) return element('td', { class: 'ist-abw zahl' }, '–');
  return element('td', {
    class: `ist-abw zahl ${diffKlasse(a.diff)}`.trim(), title: `IST ${kurz(a.ist)} h − Plan ${kurz(a.plan)} h`,
  }, vorzeichen(a.diff));
}

// Seitenleiste: Plan und IST des gewählten Tages je Mitarbeiter.
export function istTagBox(woche, d) {
  const zeilen = tagesSummen(woche, d);
  const summe = zeilen.reduce((s, z) => ({ plan: s.plan + z.plan, ist: s.ist + z.ist }), { plan: 0, ist: 0 });
  const diffZelle = (n) => element('td', { class: `zahl ${diffKlasse(n)}`.trim() }, vorzeichen(n));
  const tabelle = element('table', { class: 'ep-klein' },
    element('thead', {}, element('tr', {}, element('th', {}, 'Mitarbeiter'), element('th', { class: 'zahl' }, 'Plan'),
      element('th', { class: 'zahl' }, 'IST'), element('th', { class: 'zahl' }, 'Diff.'))),
    element('tbody', {}, zeilen.map((z) => element('tr', {}, element('th', { title: z.name }, z.name),
      element('td', { class: 'zahl' }, kurz(z.plan)), element('td', { class: 'zahl' }, kurz(z.ist)), diffZelle(z.ist - z.plan)))),
    element('tfoot', {}, element('tr', {}, element('th', {}, 'Summe'), element('td', { class: 'zahl' }, kurz(summe.plan)),
      element('td', { class: 'zahl' }, kurz(summe.ist)), diffZelle(summe.ist - summe.plan))));
  return element('section', { class: 'karte ep-box' },
    element('h3', {}, `Tag ${tagKurz(d)}`, element('small', {}, ' Plan und IST in Stunden')),
    zeilen.length ? tabelle : element('p', { class: 'hinweis' }, 'An diesem Tag ist niemand geplant oder erfasst.'),
    element('p', { class: 'hinweis ep-fuss' }, 'Ohne Pause. Offene Zeilen zählen mit ihrem Vorschlag aus dem Plan.'));
}

// Seitenleiste: offene Zeilen der Woche je Tag; ein Klick wählt den Tag.
export function offeneBox(woche, d, waehleTag) {
  const tage = offeneTage(woche);
  const reihenfolge = new Map((woche.mitarbeiter ?? []).map((m, i) => [m.id, i]));
  const name = (id) => woche.mitarbeiter?.find((m) => m.id === id)?.name ?? '';
  const gesamt = tage.reduce((s, t) => s + t.ids.length, 0);
  const eintraege = tage.map(({ datum, ids }) => {
    const namen = [...ids].sort((a, b) => (reihenfolge.get(a) ?? 0) - (reihenfolge.get(b) ?? 0)).map(name);
    const text = namen.slice(0, 4).join(' · ') + (namen.length > 4 ? ` … (+${namen.length - 4})` : '');
    return element('li', {}, element('button', {
      type: 'button', class: 'ep-eintrag hinweis-gelb ist-offen-tag', 'aria-pressed': String(datum === d), onclick: () => waehleTag(datum),
    }, element('strong', {}, `${tagKurz(datum)} ${anzahl(ids.length, 'Zeile', 'Zeilen')}`), element('span', {}, text)));
  });
  return element('section', { class: 'karte ep-box' },
    element('h3', {}, `Offen in KW ${woche.kw}`, gesamt ? element('small', {}, ` ${anzahl(gesamt, 'Zeile', 'Zeilen')}`) : null),
    eintraege.length ? element('ul', { class: 'ep-regeln' }, eintraege)
      : element('p', { class: 'hinweis' }, 'Alle Zeilen bis heute sind bestätigt.'),
    element('p', { class: 'hinweis ep-fuss' }, 'Offen = noch nicht bestätigt. Abschließen lässt sich eine Woche erst, wenn nichts mehr offen ist.'));
}

// „Grund der Änderung“ vor dem ersten Strich auf einer bestätigten Zeile. Antwort: der Grund oder null (abgebrochen).
// hinweis: Promise auf einen besseren Hinweistext (Woche abgeschlossen) oder null; bis dahin gilt der allgemeine.
export function grundDialog({ name, datum, hinweis = null }) {
  return new Promise((fertig) => {
    let grund = null;
    const text = element('p', { class: 'hinweis ist-grund-hinweis' }, GRUND_ALLGEMEIN);
    Promise.resolve(hinweis).then((t) => { if (t) text.textContent = t; }).catch(() => {});
    const feld = element('input', { type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'z. B. Kasse länger besetzt' });
    const d = dialog('Grund der Änderung', [
      element('p', {}, `${name}, ${tagKurz(datum)}: Die Zeile ist schon bestätigt.`),
      text,
      element('label', { class: 'feld ist-grund' }, 'Grund (Pflicht)', feld),
    ], [{
      text: 'Weiter',
      aktion: () => {
        const g = feld.value.trim();
        if (!g) throw new Error('GRUND_FEHLT');
        grund = g;
      },
    }], () => fertig(grund));
    feld.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      d.querySelector('.dialog-knoepfe .knopf.primaer')?.click();
    });
    feld.focus();
  });
}

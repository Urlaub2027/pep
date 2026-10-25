// Browser-Test Stufe 1 und 2: echte Oberfläche (docs/) in Chrome headless gegen die echten SQL-Funktionen (PGlite im
// Testserver tests/browser/server.mjs). Jedes Szenario prüft DOM und Datenbankstand, macht ein Foto
// (tests/browser/fotos/, gitignored) und sammelt Konsolenfehler. Ein Fehlschlag hält den Lauf nicht an.
// Start: node tests/browser/szenarien.mjs [filter]   (filter: Teil des Szenario-Namens, optional)
// Ergebnis: Zusammenfassung auf der Konsole und tests/browser/fotos/ergebnis.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { starteServer, PASSWORT } from './server.mjs';
import { starteChrome } from './cdp.mjs';
import { HEUTE, TAGE, IST_AB, HEUTE_IST } from './daten.mjs';
import { HILFE } from '../../docs/hilfe-texte.js';

const FOTOS = fileURLToPath(new URL('./fotos/', import.meta.url)); // mit abschließendem Trenner
rmSync(FOTOS, { recursive: true, force: true });
mkdirSync(FOTOS, { recursive: true });
const filter = process.argv[2] ?? '';
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

const s = await starteServer();
const c = await starteChrome({ heute: HEUTE });
const notAus = (e) => { console.error(e); c.notAus(); process.exit(2); }; // Chrome beenden, Wegwerf-Profil löschen
process.on('uncaughtException', notAus);
process.on('unhandledRejection', notAus);
const B = s.bestand;
const ID = B.ids;
const [MO, DI, MI, DO, FR, SA] = TAGE; // KW 46

// Zählt laufende fetch-Aufrufe der Seite (für „Netz ruhig“); wie die Uhr vor jedem Laden eingespielt.
await c.sende('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  window.__offen = 0; const f = window.fetch.bind(window);
  window.fetch = (...a) => { window.__offen++; return f(...a).finally(() => { window.__offen--; }); };
})();` });
try { await c.sende('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: FOTOS.replace(/\//g, '\\') }); } catch {
  try { await c.sende('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: FOTOS.replace(/\//g, '\\') }); } catch { /* egal */ }
}

// ---------------------------------------------------------------- Ablauf

const ergebnisse = [];
let nummer = 0;
let aktuell = null;

function pruefe(bedingung, text, ist) {
  if (!bedingung) aktuell.fehler.push(ist === undefined ? text : `${text} — ist: ${typeof ist === 'string' ? ist : JSON.stringify(ist)}`);
  return Boolean(bedingung);
}
const gleich = (ist, soll, text) => pruefe(JSON.stringify(ist) === JSON.stringify(soll),
  `${text}: erwartet ${JSON.stringify(soll)}`, ist);
const notiz = (text) => aktuell.notizen.push(text);

async function szenario(name, fn, { erlaubeHttp = [] } = {}) {
  nummer += 1;
  if (filter && !name.toLowerCase().includes(filter.toLowerCase()) && !name.startsWith('Anmelden')) return;
  const slug = `${String(nummer).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/-+$/, '').slice(0, 50)}`;
  aktuell = { nr: nummer, name, fehler: [], notizen: [], konsole: [], rpcFehler: [], foto: `tests/browser/fotos/${slug}.png` };
  const startProtokoll = c.protokoll.length;
  const startRpc = s.aufrufe.length;
  const t0 = Date.now();
  try {
    await fn();
  } catch (e) {
    aktuell.fehler.push(`Abbruch: ${e.message}`);
  }
  try { await ruhe(); } catch { /* egal */ }
  try { await c.foto(`${FOTOS}${slug}.png`); } catch (e) { aktuell.notizen.push(`Foto fehlgeschlagen: ${e.message}`); }
  // Erwartete Fachfehler (HTTP 400 mit Code) erscheinen auch als „Failed to load resource“ in der Konsole.
  const erwartet = (e) => (erlaubeHttp.includes('LOGIN') && /status of 400|^400 /.test(e.text) && String(e.url ?? e.text).includes('/auth/v1/token')) || erlaubeHttp.some((code) => (e.art === 'http' || e.art.startsWith('log.network'))
    && /status of 400|^400 /.test(e.text) && s.aufrufe.slice(startRpc).some((a) => a.status === 400 && a.fehler === code));
  for (const e of c.protokoll.slice(startProtokoll)) {
    (erwartet(e) ? aktuell.notizen : aktuell.konsole).push(`${e.art}: ${e.text}`);
  }
  aktuell.rpcFehler = s.aufrufe.slice(startRpc).filter((a) => a.status >= 300)
    .map((a) => `${a.status} ${a.funktion} → ${a.fehler} ${JSON.stringify(a.body).slice(0, 200)}`);
  for (const r of aktuell.rpcFehler) if (!erlaubeHttp.some((code) => r.includes(`→ ${code} `))) aktuell.fehler.push(`Unerwarteter RPC-Fehler: ${r}`);
  aktuell.ok = aktuell.fehler.length === 0 && aktuell.konsole.length === 0;
  aktuell.dauer_ms = Date.now() - t0;
  ergebnisse.push(aktuell);
  console.log(`${aktuell.ok ? 'OK  ' : 'FAIL'} ${String(nummer).padStart(2)} ${name} (${aktuell.dauer_ms} ms)`);
  for (const f of aktuell.fehler) console.log(`       ✗ ${f}`);
  for (const k of aktuell.konsole) console.log(`       ! Konsole: ${k}`);
  for (const n of aktuell.notizen) console.log(`       · ${n}`);
}

// ---------------------------------------------------------------- Helfer Seite

async function ruhe() {
  for (let i = 0; i < 2; i++) {
    await c.warteAuf(() => window.__offen === 0, { text: 'Netz ruhig', ms: 15000 });
    await pause(120);
  }
}
const sichtbar = (sel) => c.werte((x) => { const e = document.querySelector(x); return Boolean(e && !e.closest('[hidden]') && e.getClientRects().length); }, sel);
const text = (sel) => c.werte((x) => document.querySelector(x)?.textContent?.trim() ?? null, sel);
const texte = (sel) => c.werte((x) => [...document.querySelectorAll(x)].map((e) => e.textContent.trim()), sel);
const anzahl = (sel) => c.werte((x) => document.querySelectorAll(x).length, sel);
const meldungen = () => c.werte(() => {
  const m = document.getElementById('meldung'); const t = document.getElementById('toast');
  return { fehler: m.hidden ? '' : m.textContent, art: m.className, toast: t.hidden ? '' : t.textContent };
});
async function reiter(name) {
  await c.klick(`[data-ziel="${name}"]`);
  await ruhe();
}
const dialogTitel = () => c.werte(() => document.querySelector('dialog[open] h2')?.textContent ?? null);
async function warteDialog(teil = '') {
  return c.warteAuf((t) => { const h = document.querySelector('dialog[open] h2')?.textContent; return h && h.includes(t) ? h : null; },
    { text: `Dialog „${teil}“` }, teil);
}
const dKnopf = async (beschriftung) => { await c.klick({ text: beschriftung, in: 'dialog[open]', sel: 'button', genau: true }); await ruhe(); };
const dFehler = () => c.werte(() => { const f = document.querySelector('dialog[open] [role="alert"]'); return f && !f.hidden ? f.textContent : ''; });
async function dialogZu() {
  if (await c.werte(() => Boolean(document.querySelector('dialog[open]')))) {
    await c.werte(() => { for (const d of document.querySelectorAll('dialog[open]')) d.close(); });
  }
}
// Markiert ein Eingabefeld per Beschriftung (label.feld/haken beginnt mit `beschriftung`) und liefert einen Selektor.
let markenZaehler = 0;
async function feldUnter(scope, beschriftung, nr = 0) {
  const marke = `m${++markenZaehler}`;
  const ok = await c.werte((sc, b, n, m) => {
    const labels = [...document.querySelectorAll(`${sc} label`)].filter((l) => l.textContent.trim().startsWith(b));
    const e = labels[n]?.querySelector('input, select, textarea');
    if (!e) return false;
    e.dataset.t = m;
    return true;
  }, scope, beschriftung, nr, marke);
  if (!ok) throw new Error(`Feld „${beschriftung}“ in ${scope} nicht gefunden`);
  return `[data-t="${marke}"]`;
}
// deutsche Zahl aus der Oberfläche: „−3,5“ → -3.5, „60.000“ → 60000, „–“/leer → null
const zahlDE = (t) => {
  const x = String(t ?? '').replace(/\s|h|€/g, '').replace('−', '-').replace(/\.(?=\d{3})/g, '').replace(',', '.');
  return x === '' || x === '–' || x === '-' ? null : Number(x);
};

// ---------------------------------------------------------------- Helfer Datenbank

const sql = (q, p = []) => s.sql(q, p);
const bloecke = async (mid, datum) => (await sql(
  `select b.kuerzel || ' ' || to_char(p.von, 'HH24:MI') || '-' || to_char(p.bis, 'HH24:MI') as x
     from pep.plan_bloecke p join pep.bereiche b on b.id = p.bereich_id
    where p.mitarbeiter_id = $1 and p.datum = $2::date order by p.von`, [mid, datum])).map((r) => r.x);
const abwesenheiten = async (mid, von, bis) => (await sql(
  `select a.datum::text as datum, c.code, a.stunden::float as stunden, to_char(a.von, 'HH24:MI') as von,
          to_char(a.bis, 'HH24:MI') as bis, a.quelle
     from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
    where a.mitarbeiter_id = $1 and a.datum between $2::date and $3::date order by a.datum`, [mid, von, bis]));
const blockZahl = async (datum) => Number((await sql('select count(*)::int as n from pep.plan_bloecke where datum = $1::date', [datum]))[0].n);

// ---------------------------------------------------------------- Helfer Einsatzplan

async function epTag(datum) {
  if (!(await sichtbar('#ansicht-einsatzplan'))) await reiter('einsatzplan');
  await c.setzeWert('#ansicht-einsatzplan .ep-datum', datum);
  await ruhe();
  await c.warteAuf((d) => document.querySelector('#ansicht-einsatzplan .ep-datum')?.value === d, { text: `Einsatzplan ${datum}` }, datum);
}
const epZelle = (mid, von) => `#ansicht-einsatzplan tr[data-mitarbeiter="${mid}"] td.ep-z[data-von="${von}"]`;
async function pinsel(kuerzel) {
  await c.klick({ text: kuerzel, in: '#ansicht-einsatzplan .ep-pinsel', sel: '.chip', genau: true });
}
// Mitte einer Zelle, ohne zu scrollen (die erste Zelle des Strichs wird vorher ins Bild geholt).
async function zellPunkt(sel, scrollen) {
  return c.werte((x, sc) => {
    const e = document.querySelector(x);
    if (!e) return null;
    if (sc) e.scrollIntoView({ block: 'center', inline: 'center' });
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel, scrollen);
}
async function epStrich(mid, von, bis, { touch = false } = {}) {
  const a = await zellPunkt(epZelle(mid, von), true);
  const b = await zellPunkt(epZelle(mid, bis), false);
  if (!a || !b) throw new Error(`Zelle fehlt: ${mid} ${von}/${bis}`);
  if (touch) await c.wische(a, b); else await c.ziehe(a, b);
  await ruhe();
  return b;
}
const zeilenBelegung = (mid) => c.werte((m) => [...document.querySelectorAll(`#ansicht-einsatzplan tr[data-mitarbeiter="${m}"] td.ep-z`)]
  .filter((td) => td.classList.contains('belegt')).map((td) => td.dataset.von), mid);

// ---------------------------------------------------------------- Helfer Abwesenheiten

const abwZelle = (mid, datum) => `#ansicht-abwesenheiten td[data-mitarbeiter="${mid}"][data-datum="${datum}"]`;
async function abwChip(beschriftung) {
  await c.klick({ text: beschriftung, in: '#ansicht-abwesenheiten .chip-gruppe', sel: '.chip', genau: true });
}
async function abwZiehen(mid, von, bis) {
  const a = await zellPunkt(abwZelle(mid, von), true);
  const b = await zellPunkt(abwZelle(mid, bis), false);
  if (!a || !b) throw new Error(`Zelle fehlt: ${mid} ${von}/${bis}`);
  await c.ziehe(a, b);
  await pause(150);
}
async function abwMonat(ziel) { // ziel: „November 2026“
  if (!(await sichtbar('#ansicht-abwesenheiten'))) await reiter('abwesenheiten');
  for (let i = 0; i < 24; i++) {
    const ist = await text('#ansicht-abwesenheiten .abw-monat');
    if (ist === ziel) return;
    const [mn, j] = ist.split(' ');
    const MON = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
    const [zm, zj] = ziel.split(' ');
    const vor = Number(zj) * 12 + MON.indexOf(zm) > Number(j) * 12 + MON.indexOf(mn);
    await c.klick(`#ansicht-abwesenheiten [aria-label="${vor ? 'Nächster Monat' : 'Vorheriger Monat'}"]`);
    await ruhe();
  }
  throw new Error(`Monat ${ziel} nicht erreicht`);
}

async function anmelden(name) {
  await c.navigiere(`${s.adresse}/browser/`);
  await c.warteAuf(() => !document.getElementById('ansicht-login').hidden || !document.getElementById('ansicht-start').hidden);
  if (await sichtbar('#ansicht-login')) {
    await c.tippe('#login-name', name);
    await c.tippe('#login-passwort', PASSWORT);
    await c.klick('#login-knopf');
  }
  await c.warteAuf(() => document.querySelector('#ansicht-start .kachel'), { text: 'Startseite', ms: 20000 });
  await ruhe();
}

// Druck: window.print abfangen (headless wäre es ein No-op); danach afterprint selbst auslösen.
const druckStub = () => c.werte(() => { window.__gedruckt = 0; window.print = () => { window.__gedruckt += 1; }; });
const druckAufraeumen = () => c.werte(() => window.dispatchEvent(new Event('afterprint')));

// ================================================================ Szenarien

await szenario('Anmelden: falsches Passwort, dann Leitung', async () => {
  await c.navigiere(`${s.adresse}/browser/`);
  await c.warteAuf(() => !document.getElementById('ansicht-login').hidden, { text: 'Login sichtbar' });
  await c.tippe('#login-name', 'chef');
  await c.tippe('#login-passwort', 'falsch');
  await c.klick('#login-knopf');
  await c.warteAuf(() => !document.getElementById('meldung').hidden, { text: 'Fehlermeldung' });
  gleich((await meldungen()).fehler, 'Benutzername oder Passwort stimmt nicht.', 'Meldung bei falschem Passwort');
  await c.tippe('#login-passwort', PASSWORT);
  await c.klick('#login-knopf');
  await c.warteAuf(() => document.querySelector('#ansicht-start .kachel'), { text: 'Startseite' });
  await ruhe();
  gleich(await text('#wer'), 'Angemeldet als chef', 'Kopfzeile');
  gleich(await text('#kopf-filiale'), 'Netto Aschaffenburg', 'Filiale im Kopf');
  pruefe(await sichtbar('#nav-einstellungen'), 'Leitung sieht Reiter Einstellungen');
}, { erlaubeHttp: ['LOGIN'] });

const REITER = ['start', 'abwesenheiten', 'vorausplanung', 'einsatzplan', 'mitarbeiter', 'einstellungen'];
await szenario('Navigation 1440×900: alle Reiter', async () => {
  for (const r of REITER) {
    await reiter(r);
    pruefe(await sichtbar(`#ansicht-${r}`), `Reiter ${r} sichtbar`);
    const inhalt = await c.werte((x) => document.getElementById(`ansicht-${x}`).textContent.trim().length, r);
    pruefe(inhalt > 20, `Reiter ${r} hat Inhalt`, inhalt);
    const m = await meldungen();
    pruefe(!m.fehler, `Reiter ${r} ohne Fehlermeldung`, m.fehler);
    await c.foto(`${FOTOS}02-nav-${r}.png`);
  }
});

await szenario('Startseite: Kacheln gegen Datenbank, Sprünge', async () => {
  await reiter('start');
  const kacheln = await c.werte(() => [...document.querySelectorAll('#ansicht-start .kachel')].map((k) => ({
    titel: k.querySelector('h2').textContent, zahl: k.querySelector('.kachel-zahl').firstChild.textContent,
    liste: [...k.querySelectorAll('.kachel-liste li')].map((l) => l.textContent),
  })));
  gleich(kacheln.map((k) => k.titel), ['Abwesend diese Woche', 'Stunden-Lücke', 'Regelverstöße', 'Offene Urlaubswünsche',
    'IST offen', 'Zeitkonto auffällig'], 'Kacheln');
  // 1) Abwesende KW 45 (02.–08.11.)
  const abw = await sql(`select count(distinct a.mitarbeiter_id)::int as n from pep.abwesenheiten a
    join pep.mitarbeiter m on m.id = a.mitarbeiter_id where m.aktiv and a.datum between '2026-11-02' and '2026-11-08'`);
  gleich(Number(kacheln[0].zahl), abw[0].n, 'Abwesend diese Woche = DB');
  // 2) Stunden-Lücke = Summe negativer Überhänge der sechs Wochen (pep_vorausplanung)
  const vp = (await s.rpc('pep_vorausplanung', { p_jahr: 2026, p_kw: 45 }, B.leitung)).json;
  const luecke = vp.wochen.filter((w) => w.ueberhang != null && w.ueberhang < 0).reduce((x, w) => x + Number(w.ueberhang), 0);
  pruefe(Math.abs(zahlDE(kacheln[1].zahl) - luecke) < 0.01, `Stunden-Lücke = Σ negativer Überhang (${luecke})`, kacheln[1].zahl);
  // 3) Regelverstöße: Zahl = Summe der Warnungen der Liste
  const summe = kacheln[2].liste.reduce((x, l) => x + (Number(/(\d+) Warnung/.exec(l)?.[1]) || 0), 0);
  gleich(Number(kacheln[2].zahl), summe, 'Regelverstöße: Zahl = Summe der Liste');
  const pr = (await s.rpc('pep_pruefung_zeitraum', { p_von: HEUTE, p_bis: '2026-11-08' }, B.leitung)).json;
  notiz(`pep_pruefung_zeitraum 02.–08.11.: ${JSON.stringify(pr).slice(0, 300)}`);
  // 4) Offene Wünsche: Seed hat zwei (Gustav KW 48, Lea KW 47)
  gleich(Number(kacheln[3].zahl), 2, 'Offene Urlaubswünsche');
  // Sprünge
  await c.klick({ text: 'Abwesenheiten →', in: '#ansicht-start .kachel:nth-child(1)', sel: 'button' });
  await ruhe();
  pruefe(await sichtbar('#ansicht-abwesenheiten'), 'Kachel 1 → Abwesenheiten');
  gleich(await text('#ansicht-abwesenheiten .abw-monat'), 'November 2026', 'Kachel 1 → Monat');
  await reiter('start');
  await c.klick({ text: 'Vorausplanung →', in: '#ansicht-start', sel: 'button' });
  await ruhe();
  pruefe(await sichtbar('#ansicht-vorausplanung'), 'Kachel 2 → Vorausplanung');
  gleich(await text('#ansicht-vorausplanung .monatsname'), 'KW 45/2026 – KW 50/2026', 'Kachel 2 → Wochen');
  await reiter('start');
  const sprung = await text('#ansicht-start .kachel:nth-child(3) .kachel-sprung');
  await c.klick('#ansicht-start .kachel:nth-child(3) .kachel-sprung');
  await ruhe();
  pruefe(await sichtbar('#ansicht-einsatzplan'), 'Kachel 3 → Einsatzplan');
  const tagIst = await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-datum')?.value);
  pruefe(sprung.includes(`${tagIst.slice(8, 10)}.${tagIst.slice(5, 7)}.`), `Kachel 3 → Tag passt zur Beschriftung „${sprung}“`, tagIst);
  await reiter('start');
  // Ein Tag-Knopf in der Liste
  const tagKnopf = await text('#ansicht-start .kachel:nth-child(3) .kachel-tag');
  if (tagKnopf) {
    await c.klick('#ansicht-start .kachel:nth-child(3) .kachel-tag');
    await ruhe();
    const t2 = await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-datum')?.value);
    pruefe(tagKnopf.includes(`${t2.slice(8, 10)}.${t2.slice(5, 7)}.`), `Listen-Tag „${tagKnopf}“ → Einsatzplan`, t2);
    await reiter('start');
  }
  await c.klick('#ansicht-start .kachel:nth-child(4) .kachel-sprung');
  await ruhe();
  pruefe(await sichtbar('#ansicht-abwesenheiten'), 'Kachel 4 → Abwesenheiten');
  gleich(await text('#ansicht-abwesenheiten .abw-monat'), 'November 2026', 'Kachel 4 → Monat des ersten Wunsches');
  await reiter('start');
});

await szenario('Navigation Tablet 1024×768 (Touch): alle Reiter', async () => {
  await c.tablet(true);
  await pause(300);
  for (const r of REITER) {
    await c.tippeTouch(`[data-ziel="${r}"]`);
    await ruhe();
    pruefe(await sichtbar(`#ansicht-${r}`), `Reiter ${r} per Touch sichtbar`);
    const quer = await c.werte(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    pruefe(quer <= 0, `Reiter ${r}: Seite scrollt nicht quer`, `${quer}px Überstand`);
    await c.foto(`${FOTOS}04-tablet-${r}.png`);
  }
  await c.tablet(false);
  await pause(300);
});

// ---------------------------------------------------------------- Abwesenheiten

await szenario('Abwesenheiten: Code wählen, Tage ziehen, Löschen', async () => {
  await reiter('abwesenheiten');
  await abwMonat('November 2026');
  const hanna = ID[7];
  await abwChip('U');
  await abwZiehen(hanna, '2026-11-24', '2026-11-26');
  await ruhe();
  const db = await abwesenheiten(hanna, '2026-11-24', '2026-11-26');
  gleich(db.map((a) => `${a.datum} ${a.code} ${a.stunden} ${a.quelle}`),
    ['2026-11-24 U 6.25 manuell', '2026-11-25 U 6.25 manuell', '2026-11-26 U 6.25 manuell'], 'DB nach Ziehen U');
  const zellen = await c.werte((m) => ['2026-11-24', '2026-11-25', '2026-11-26'].map((d) =>
    document.querySelector(`#ansicht-abwesenheiten td[data-mitarbeiter="${m}"][data-datum="${d}"]`)?.textContent), hanna);
  gleich(zellen, ['U6,25', 'U6,25', 'U6,25'], 'Zellen nach Ziehen');
  gleich((await meldungen()).toast, 'Gespeichert.', 'Toast');
  // über einen Sonntag ziehen: geschlossene Tage werden übersprungen und gemeldet
  await abwZiehen(hanna, '2026-11-28', '2026-11-30');
  await ruhe();
  const db2 = await abwesenheiten(hanna, '2026-11-28', '2026-11-30');
  gleich(db2.map((a) => a.datum), ['2026-11-28', '2026-11-30'], 'Sonntag 29.11. übersprungen');
  const m2 = await meldungen();
  pruefe(/übersprungen/.test(m2.toast + m2.fehler), 'Meldung nennt übersprungene Tage', m2);
  // Löschen-Chip
  await abwChip('Löschen');
  await abwZiehen(hanna, '2026-11-25', '2026-11-30');
  await ruhe();
  const db3 = await abwesenheiten(hanna, '2026-11-24', '2026-11-30');
  gleich(db3.map((a) => a.datum), ['2026-11-24'], 'Nach Löschen bleibt nur 24.11.');
  gleich(await text(abwZelle(hanna, '2026-11-25')), '', 'Zelle 25.11. leer');
});

await szenario('Abwesenheiten: Code mit tatsächlichen Stunden fragt nach Stunden', async () => {
  await abwMonat('November 2026');
  const hanna = ID[7];
  await abwChip('T');
  await abwZiehen(hanna, '2026-11-27', '2026-11-27');
  const titel = await warteDialog('Stunden');
  gleich(titel, 'T Termin/Schulung: Stunden', 'Dialogtitel');
  // ohne Stunden → Fehlermeldung im Dialog
  await dKnopf('Übernehmen');
  gleich(await dFehler(), 'Bitte die Stunden angeben.', 'Fehler ohne Stunden');
  await c.tippe(await feldUnter('dialog[open]', 'Stunden'), '3,5');
  await dKnopf('Übernehmen');
  await ruhe();
  gleich((await abwesenheiten(hanna, '2026-11-27', '2026-11-27')).map((a) => `${a.code} ${a.stunden} ${a.von}`), ['T 3.5 null'], 'DB T 3,5 h');
  gleich(await text(abwZelle(hanna, '2026-11-27')), 'T3,50', 'Zelle zeigt T 3,50');
});

await szenario('Abwesenheiten: „mit Uhrzeit“', async () => {
  await abwMonat('November 2026');
  const hanna = ID[7];
  await c.klick({ text: 'mit Uhrzeit', in: '#ansicht-abwesenheiten', sel: 'label' });
  pruefe(await c.werte(() => document.querySelector('#ansicht-abwesenheiten .schalter').checked), 'Schalter an');
  await abwChip('ZA');
  await abwZiehen(hanna, '2026-11-23', '2026-11-23');
  await warteDialog('Stunden');
  await c.tippe(await feldUnter('dialog[open]', 'Stunden'), '4');
  await c.setzeWert(await feldUnter('dialog[open]', 'von'), '08:00');
  await c.setzeWert(await feldUnter('dialog[open]', 'bis'), '12:00');
  await dKnopf('Übernehmen');
  await ruhe();
  gleich((await abwesenheiten(hanna, '2026-11-23', '2026-11-23')).map((a) => `${a.code} ${a.stunden} ${a.von}-${a.bis}`),
    ['ZA 4 08:00-12:00'], 'DB ZA mit Uhrzeit');
  gleich(await text(abwZelle(hanna, '2026-11-23')), 'ZA08–12', 'Zelle zeigt ZA 08–12');
  await c.klick({ text: 'mit Uhrzeit', in: '#ansicht-abwesenheiten', sel: 'label' }); // wieder aus
});

await szenario('Abwesenheiten: Wiederholung anlegen und löschen', async () => {
  await abwMonat('November 2026');
  await abwChip('Ansehen');
  const hanna = ID[7];
  await c.klick({ text: 'Wiederholung …', in: '#ansicht-abwesenheiten', sel: 'button' });
  await warteDialog('Wiederholung');
  await c.setzeWert(await feldUnter('dialog[open]', 'Mitarbeiter'), String(hanna));
  await c.setzeWert(await feldUnter('dialog[open]', 'Code'), String(B.code.BS));
  await c.setzeWert(await feldUnter('dialog[open]', 'Wochentag'), '3');
  await c.setzeWert(await feldUnter('dialog[open]', 'von Datum'), '2026-12-01');
  await c.setzeWert(await feldUnter('dialog[open]', 'bis Datum'), '2026-12-31');
  await c.tippe(await feldUnter('dialog[open]', 'Stunden'), '8');
  await dKnopf('Speichern');
  await ruhe();
  pruefe(!(await c.werte(() => Boolean(document.querySelector('dialog[open]')))), 'Dialog geschlossen', await dFehler());
  const w = await sql('select wochentag, von_datum::text as v, bis_datum::text as b, schulferien_aussetzen as f from pep.wiederholungen where mitarbeiter_id = $1', [hanna]);
  gleich(w, [{ wochentag: 3, v: '2026-12-01', b: '2026-12-31', f: true }], 'DB Wiederholung');
  const tage = await abwesenheiten(hanna, '2026-12-01', '2026-12-31');
  gleich(tage.map((a) => `${a.datum} ${a.code} ${a.quelle}`),
    ['2026-12-02 BS wiederholung', '2026-12-09 BS wiederholung', '2026-12-16 BS wiederholung'], 'Mittwoche im Dezember ohne Schulferien');
  await abwMonat('Dezember 2026');
  gleich(await text(abwZelle(hanna, '2026-12-09')), 'BS8', 'Zelle 09.12. zeigt BS 8');
  // Info-Dialog → Wiederholung löschen
  await c.klick(abwZelle(hanna, '2026-12-16'));
  const t = await warteDialog('BS am');
  gleich(t, 'BS am 16.12.2026', 'Info-Dialog');
  await dKnopf('Wiederholung löschen');
  await ruhe();
  gleich((await abwesenheiten(hanna, '2026-12-01', '2026-12-31')).length, 0, 'Nach „Wiederholung löschen“ keine Tage mehr');
  gleich(await text(abwZelle(hanna, '2026-12-09')), '', 'Zelle 09.12. leer');
});

await szenario('Abwesenheiten: Urlaubswunsch „U?“ genehmigen und ablehnen', async () => {
  await abwMonat('November 2026');
  await abwChip('Ansehen');
  const lea = ID[11];
  const gustav = ID[6];
  gleich(await text(abwZelle(lea, '2026-11-16')), 'U?', 'Wunsch Lea als U?');
  pruefe(await c.werte((s1) => document.querySelector(s1)?.classList.contains('wunsch'), abwZelle(lea, '2026-11-17')), 'Klasse wunsch');
  gleich(await text(abwZelle(gustav, '2026-11-23')), 'U?', 'Wunsch Gustav als U?');
  await c.klick(abwZelle(lea, '2026-11-16'));
  gleich(await warteDialog('Urlaubswunsch'), 'Urlaubswunsch KW 47 (16.–21.11.2026)', 'Wunsch-Dialog');
  await dKnopf('Genehmigen');
  await ruhe();
  const fr = await sql("select status, von::text, bis::text from pep.urlaub_freigaben where mitarbeiter_id = $1", [lea]);
  gleich(fr, [{ status: 'genehmigt', von: '2026-11-16', bis: '2026-11-21' }], 'DB Freigabe Lea');
  const u = await abwesenheiten(lea, '2026-11-16', '2026-11-22');
  gleich(u.map((a) => `${a.datum.slice(8)} ${a.code} ${a.quelle}`),
    ['16 U urlaubstool', '17 U urlaubstool', '18 U urlaubstool', '19 U urlaubstool', '20 U urlaubstool', '21 U urlaubstool'], 'DB U-Tage Lea');
  gleich(await text(abwZelle(lea, '2026-11-16')), 'U7', 'Zelle Lea nach Genehmigung (42 h ÷ 6 = 7)');
  await c.klick(abwZelle(gustav, '2026-11-23'));
  await warteDialog('Urlaubswunsch');
  await dKnopf('Ablehnen');
  await ruhe();
  const fr2 = await sql("select status from pep.urlaub_freigaben where mitarbeiter_id = $1", [gustav]);
  gleich(fr2, [{ status: 'abgelehnt' }], 'DB Ablehnung Gustav');
  pruefe(await c.werte((s1) => document.querySelector(s1)?.classList.contains('wunsch-abgelehnt'), abwZelle(gustav, '2026-11-24')), 'Abgelehnt sichtbar (abgeblendet)');
  gleich((await abwesenheiten(gustav, '2026-11-23', '2026-11-29')).length, 0, 'Keine Abwesenheit für Gustav');
});

await szenario('Abwesenheiten: Monatswechsel über den Jahreswechsel', async () => {
  await abwMonat('November 2026');
  await c.klick('#ansicht-abwesenheiten [aria-label="Nächster Monat"]'); await ruhe();
  gleich(await text('#ansicht-abwesenheiten .abw-monat'), 'Dezember 2026', 'Dezember');
  pruefe((await anzahl('#ansicht-abwesenheiten td.schulferien')) > 0, 'Dezember zeigt Schulferien');
  pruefe((await anzahl('#ansicht-abwesenheiten th.abw-tag.feiertag')) >= 2, 'Dezember zeigt Feiertage (25./26.)');
  await c.klick('#ansicht-abwesenheiten [aria-label="Nächster Monat"]'); await ruhe();
  gleich(await text('#ansicht-abwesenheiten .abw-monat'), 'Januar 2027', 'Januar 2027');
  const kws = await texte('#ansicht-abwesenheiten .abw-kw');
  gleich(kws[0], 'KW 53', 'Januar 2027 beginnt mit KW 53');
  gleich(kws[1], 'KW 1', 'dann KW 1');
  gleich(await anzahl('#ansicht-abwesenheiten th.abw-tag'), 31, '31 Tage');
  await c.klick('#ansicht-abwesenheiten [aria-label="Vorheriger Monat"]'); await ruhe();
  gleich(await text('#ansicht-abwesenheiten .abw-monat'), 'Dezember 2026', 'zurück: Dezember 2026');
  await c.klick({ text: 'Heute', in: '#ansicht-abwesenheiten', sel: 'button', genau: true }); await ruhe();
  gleich(await text('#ansicht-abwesenheiten .abw-monat'), 'November 2026', '„Heute“ → November 2026');
  pruefe((await anzahl('#ansicht-abwesenheiten th.abw-tag.heute')) === 1, 'Spalte heute markiert');
});

await szenario('Abwesenheiten: Übersicht „Urlaub 2026“ gegen DB', async () => {
  await abwMonat('November 2026');
  const zeilen = await c.werte(() => [...document.querySelectorAll('#ansicht-abwesenheiten .abw-urlaub tbody tr')]
    .map((tr) => [tr.querySelector('th').textContent, ...[...tr.querySelectorAll('td')].map((td) => td.textContent)]));
  const db = await sql(`select m.name, coalesce(j.anspruch_stunden, 0)::float + coalesce(j.rest_vorjahr_stunden, 0)::float as anspruch,
      coalesce((select sum(a.stunden) from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
        where a.mitarbeiter_id = m.id and c.code = 'U' and a.datum between '2026-01-01' and '2026-12-31'), 0)::float as genehmigt
    from pep.mitarbeiter m left join pep.urlaubsjahre j on j.mitarbeiter_id = m.id and j.jahr = 2026
    where m.aktiv order by m.position, m.id`);
  gleich(zeilen.length, db.length, 'Zeilenzahl');
  for (const d of db) {
    const z = zeilen.find((x) => x[0] === d.name);
    if (!pruefe(z, `Zeile für ${d.name}`)) continue;
    pruefe(Math.abs(zahlDE(z[1]) - d.anspruch) < 0.01, `${d.name}: Anspruch ${d.anspruch}`, z[1]);
    pruefe(Math.abs(zahlDE(z[2]) - d.genehmigt) < 0.01, `${d.name}: genehmigt ${d.genehmigt}`, z[2]);
    pruefe(Math.abs(zahlDE(z[4]) - (d.anspruch - d.genehmigt)) < 0.01, `${d.name}: Rest ${d.anspruch - d.genehmigt}`, z[4]);
  }
  const jana = zeilen.find((x) => x[0] === 'Skizze, Jana');
  pruefe(jana && jana[4].startsWith('−'), 'Jana: Rest negativ mit echtem Minus', jana?.[4]);
});

await szenario('Abwesenheiten: Drucken (Monat, Resturlaub)', async () => {
  await abwMonat('November 2026');
  await druckStub();
  await c.klick({ text: 'Drucken', in: '#ansicht-abwesenheiten', sel: 'button', genau: true });
  await warteDialog('Drucken');
  await dKnopf('Monat November 2026');
  await c.warteAuf(() => document.querySelector('#ansicht-druck .dr-monat'), { text: 'Druck Monat' });
  gleich(await c.werte(() => window.__gedruckt), 1, 'print() aufgerufen');
  pruefe(await c.werte(() => document.body.classList.contains('druckt')), 'body.druckt gesetzt');
  const zeilen = await anzahl('#ansicht-druck .dr-monat tbody tr');
  const ma = await anzahl('#ansicht-abwesenheiten .abw-tabelle tbody tr:not(.abw-summe)');
  gleich(zeilen, ma, 'Druck Monat: eine Zeile je Mitarbeiter');
  pruefe((await text('#ansicht-druck .dr-titel')) === 'Abwesenheiten', 'Titel Abwesenheiten');
  pruefe((await text('#ansicht-druck .dr-kopf-rechts')).includes('Netto Aschaffenburg (2558)'), 'Kopf mit Filiale und Nummer');
  pruefe(!(await sichtbar('#ansicht-druck')), 'Druckansicht am Bildschirm verborgen');
  await druckAufraeumen();
  pruefe(!(await c.werte(() => document.body.classList.contains('druckt'))), 'afterprint räumt auf');
  await c.klick({ text: 'Drucken', in: '#ansicht-abwesenheiten', sel: 'button', genau: true });
  await warteDialog('Drucken');
  await dKnopf('Resturlaub 2026');
  await c.warteAuf(() => document.querySelector('#ansicht-druck .dr-resturlaub'), { text: 'Druck Resturlaub' });
  const rz = await anzahl('#ansicht-druck .dr-resturlaub tbody tr');
  pruefe(rz >= 12, 'Resturlaub: Zeilen je Mitarbeiter', rz);
  const pdf = await c.sende('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${FOTOS}resturlaub.pdf`, Buffer.from(pdf.data, 'base64'));
  notiz(`PDF Resturlaub: ${Math.round(pdf.data.length * 0.75 / 1024)} KB (tests/browser/fotos/resturlaub.pdf)`);
  await druckAufraeumen();
});

// ---------------------------------------------------------------- Einsatzplan

await szenario('Einsatzplan: KW-Wechsel inkl. KW 53/2026, Tages-Reiter', async () => {
  await reiter('einsatzplan');
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 45', 'Start in KW 45 (heute)');
  await c.klick('#ansicht-einsatzplan [aria-label="Nächste Woche"]'); await ruhe();
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 46', '▶ → KW 46');
  gleich(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-datum').value), MO, 'Wochentag Mo bleibt gewählt');
  const reiterTexte = await texte('#ansicht-einsatzplan .ep-tag span');
  gleich(reiterTexte, ['Mo 09.11.', 'Di 10.11.', 'Mi 11.11.', 'Do 12.11.', 'Fr 13.11.', 'Sa 14.11.', 'So 15.11.'], 'Tages-Reiter');
  for (const [i, d] of TAGE.entries()) {
    await c.klick(`#ansicht-einsatzplan .ep-tag:nth-child(${i + 1})`);
    pruefe(await c.werte((n) => document.querySelector(`#ansicht-einsatzplan .ep-tag:nth-child(${n})`).getAttribute('aria-pressed') === 'true', i + 1), `Reiter ${d} gedrückt`);
    pruefe((await anzahl('#ansicht-einsatzplan .ep-tabelle tbody tr')) > 10, `Raster ${d} hat Zeilen`);
  }
  await c.klick('#ansicht-einsatzplan .ep-tag:nth-child(7)');
  pruefe((await text('#ansicht-einsatzplan .ep-geschlossen h2'))?.includes('geschlossen'), 'Sonntag: geschlossen');
  await epTag('2026-12-28');
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 53', '28.12.2026 liegt in KW 53');
  gleich(await texte('#ansicht-einsatzplan .ep-tag span'),
    ['Mo 28.12.', 'Di 29.12.', 'Mi 30.12.', 'Do 31.12.', 'Fr 01.01.', 'Sa 02.01.', 'So 03.01.'], 'Tage KW 53');
  pruefe((await texte('#ansicht-einsatzplan .ep-tag small'))[4] === 'Feiertag', 'Neujahr als Feiertag', await texte('#ansicht-einsatzplan .ep-tag small'));
  await c.klick('#ansicht-einsatzplan [aria-label="Nächste Woche"]'); await ruhe();
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 1', 'KW 53 ▶ → KW 1');
  gleich(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-datum').value), '2027-01-04', 'Mo 04.01.2027');
  await c.klick('#ansicht-einsatzplan [aria-label="Vorherige Woche"]'); await ruhe();
  await c.klick('#ansicht-einsatzplan [aria-label="Vorherige Woche"]'); await ruhe();
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 52', '◀◀ → KW 52');
  await c.klick({ text: 'Heute', in: '#ansicht-einsatzplan', sel: 'button', genau: true }); await ruhe();
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 45', '„Heute“ → KW 45');
});

const MIA = B.reserve[0];
const NICO = B.reserve[1];
await szenario('Einsatzplan: Block malen per Maus', async () => {
  await epTag(MI);
  await pinsel('KA');
  await epStrich(MIA, '08:00', '11:30');
  gleich(await bloecke(MIA, MI), ['KA 08:00-12:00'], 'DB nach Strich');
  const belegt = await zeilenBelegung(MIA);
  gleich(belegt, ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'], 'Zellen belegt');
  gleich(await text(`#ansicht-einsatzplan tr[data-mitarbeiter="${MIA}"] .ep-std`), '4', 'Stunden der Zeile');
  pruefe(!(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-knoepfe .knopf').disabled)), 'Rückgängig aktiv');
});

await szenario('Einsatzplan: Block malen per Touch (Tablet)', async () => {
  await c.tablet(true);
  await pause(300);
  await epTag(MI);
  await pinsel('KA');
  await epStrich(NICO, '13:00', '15:30', { touch: true });
  const db = await bloecke(NICO, MI);
  gleich(db, ['KA 13:00-16:00'], 'DB nach Touch-Strich');
  await c.foto(`${FOTOS}touch-strich.png`);
  await c.tablet(false);
  await pause(300);
});

await szenario('Einsatzplan: über bestehenden Block malen (Teilung)', async () => {
  await epTag(MI);
  await pinsel('OG');
  await epStrich(MIA, '09:00', '09:30');
  gleich(await bloecke(MIA, MI), ['KA 08:00-09:00', 'OG 09:00-10:00', 'KA 10:00-12:00'], 'DB geteilt');
});

await szenario('Einsatzplan: Radieren', async () => {
  await epTag(MI);
  await pinsel('Radieren');
  await epStrich(MIA, '11:00', '11:30');
  gleich(await bloecke(MIA, MI), ['KA 08:00-09:00', 'OG 09:00-10:00', 'KA 10:00-11:00'], 'DB nach Radieren');
});

await szenario('Einsatzplan: gesperrte Striche (abwesend, Kompetenz, Pflicht-Vorgabe, außerhalb Rahmen)', async () => {
  const hinweis = () => c.werte(() => [...document.querySelectorAll('.ep-sperre-hinweis')].map((h) => ({
    text: h.textContent, x: parseFloat(h.style.left), y: parseFloat(h.style.top) })));
  const fall = async (titel, mid, datum, von, bis, k, erwarteText) => {
    await epTag(datum);
    await pinsel(k);
    const vorher = await bloecke(mid, datum);
    const ende = await epStrich(mid, von, bis);
    const h = await hinweis();
    const ok = pruefe(h.some((x) => x.text === erwarteText), `${titel}: Hinweis „${erwarteText}“`, h.map((x) => x.text));
    if (ok) {
      const x = h.find((y) => y.text === erwarteText);
      pruefe(Math.abs(x.x - (ende.x + 12)) < 300 && x.y < ende.y, `${titel}: Hinweis am Zeiger`, { hinweis: x, zeiger: ende });
    }
    gleich(await bloecke(mid, datum), vorher, `${titel}: DB unverändert`);
    await pause(3100); // Hinweis verschwindet nach 3 s
  };
  await fall('abwesend', ID[8], MO, '09:00', '10:00', 'TS', 'Der Mitarbeiter ist zu dieser Zeit abwesend.');
  await fall('Kompetenz', ID[7], MI, '08:00', '09:00', 'KA', 'Dem Mitarbeiter fehlt die Kompetenz für diesen Bereich (siehe Mitarbeiterkarte).');
  await fall('Pflicht-Vorgabe', ID[4], DI, '14:00', '17:30', 'TK', 'Das verstößt gegen eine Pflicht-Vorgabe des Mitarbeiters (siehe Mitarbeiterkarte).');
  // Rahmen am Samstag wird „von anderer Stelle“ verkürzt, die Seite zeigt noch den alten Rahmen.
  await epTag(SA);
  await sql("update pep.rahmen set rahmen_von = '07:00' where wochentag = 6");
  try {
    await fall('außerhalb Rahmen', NICO, SA, '06:00', '06:30', 'KA', 'Das liegt außerhalb der Planungszeit dieses Tages.');
  } finally {
    await sql("update pep.rahmen set rahmen_von = '06:00' where wochentag = 6");
  }
  // Ganztags abwesend ohne Blöcke: graue Zeile ohne Malzellen (Anna, Urlaub)
  await epTag(MO);
  pruefe(await c.werte((m) => document.querySelector(`#ansicht-einsatzplan tr[data-mitarbeiter="${m}"]`)?.classList.contains('ep-abwesend'), ID[0]),
    'Anna (Urlaub) als graue Zeile');
  gleich(await anzahl(`#ansicht-einsatzplan tr[data-mitarbeiter="${ID[0]}"] td.ep-z`), 0, 'Anna: keine Malzellen');
}, { erlaubeHttp: ['ABWESEND', 'KOMPETENZ_FEHLT', 'VORGABE_VERLETZT', 'AUSSERHALB_RAHMEN'] });

await szenario('Einsatzplan: Rückgängig 3×', async () => {
  await epTag(MI);
  for (let i = 0; i < 3; i++) {
    await c.klick({ text: 'Rückgängig', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button' });
    await ruhe();
  }
  gleich(await bloecke(MIA, MI), ['KA 08:00-12:00'], 'Mia: Zustand nach dem ersten Strich');
  gleich(await bloecke(NICO, MI), [], 'Nico: Touch-Strich zurückgenommen');
  gleich((await meldungen()).toast, `Rückgängig: Aushilfe, Nico, ${MI.split('-').reverse().join('.')}`, 'Toast nennt Zeile');
  gleich(await zeilenBelegung(NICO), [], 'Nico: Zeile leer');
  pruefe(!(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-knoepfe .knopf').disabled)), 'Rückgängig noch aktiv (ein Schritt übrig)');
});

await szenario('Einsatzplan: Kommentar anlegen, ändern, löschen (auch vergangener Tag)', async () => {
  await epTag(MI);
  const zelle = `#ansicht-einsatzplan td[data-kommentar="${MIA}"]`;
  const kom = async (d) => (await sql('select text from pep.plan_kommentare where mitarbeiter_id = $1 and datum = $2::date', [MIA, d]))[0]?.text ?? null;
  await c.klick(zelle);
  await c.tippe(`${zelle} input`, 'Testnotiz Kasse', { enter: true });
  await ruhe();
  gleich(await kom(MI), 'Testnotiz Kasse', 'DB angelegt');
  gleich(await text(zelle), 'Testnotiz Kasse', 'Zelle zeigt Kommentar');
  await c.klick(zelle);
  await c.tippe(`${zelle} input`, 'Geändert', { enter: true });
  await ruhe();
  gleich(await kom(MI), 'Geändert', 'DB geändert');
  await c.klick(zelle);
  await c.tippe(`${zelle} input`, '', { enter: true });
  await ruhe();
  gleich(await kom(MI), null, 'DB gelöscht');
  gleich(await text(zelle), '+ Notiz', 'Zelle leer');
  // Escape bricht ab
  await c.klick(zelle);
  await c.tippe(`${zelle} input`, 'nicht speichern');
  await c.taste('Escape');
  await ruhe();
  gleich(await kom(MI), null, 'Escape speichert nicht');
  // vergangener Tag (Fr 30.10.)
  await epTag('2026-10-30');
  await c.klick(zelle);
  await c.tippe(`${zelle} input`, 'Nachtrag', { enter: true });
  await ruhe();
  gleich(await kom('2026-10-30'), 'Nachtrag', 'DB Kommentar am vergangenen Tag');
});

await szenario('Einsatzplan: Abdeckungszeilen Kasse gegen DB', async () => {
  await epTag(MO);
  const ui = await c.werte(() => Object.fromEntries([...document.querySelectorAll('#ansicht-einsatzplan .ep-deckung-kasse td[data-von]')]
    .map((td) => [td.dataset.von, td.textContent])));
  const abweichend = [];
  for (const [von, t] of Object.entries(ui)) {
    const r = await sql(`select count(distinct p.mitarbeiter_id)::int as n from pep.plan_bloecke p join pep.bereiche b on b.id = p.bereich_id
      where p.datum = $1::date and b.bedeutung = 'kasse' and p.von <= $2::time and $2::time < p.bis
        and not exists (select 1 from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
          where a.mitarbeiter_id = p.mitarbeiter_id and a.datum = p.datum and c.sperrt
            and (a.von is null or ($2::time >= a.von and $2::time < a.bis)))`, [MO, von]);
    if ((zahlDE(t) ?? 0) !== r[0].n) abweichend.push(`${von}: UI ${t || '∅'} / DB ${r[0].n}`);
  }
  gleich(abweichend, [], 'Kasse je halbe Stunde');
  const rot = await c.werte(() => [...document.querySelectorAll('#ansicht-einsatzplan .ep-deckung-kasse td.rot')].map((td) => td.dataset.von));
  pruefe(rot.every((v) => v >= '07:00' && v < '20:00'), 'Rot nur in der Öffnungszeit', rot);
});

await szenario('Einsatzplan: Regelprüfung – Klick markiert Zellen', async () => {
  await epTag(MO);
  const eintraege = await texte('#ansicht-einsatzplan .ep-regeln .ep-eintrag');
  pruefe(eintraege.length > 0, 'Regelprüfung hat Einträge');
  notiz(`Regelprüfung Mo 09.11.: ${eintraege.join(' | ').slice(0, 400)}`);
  // ersten Eintrag mit Uhrzeit wählen (die stehen oben)
  await c.klick('#ansicht-einsatzplan .ep-regeln li:first-child .ep-eintrag');
  pruefe(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-regeln li:first-child .ep-eintrag').getAttribute('aria-pressed') === 'true'), 'Eintrag gedrückt');
  const markiert = await c.werte(() => ({ zeilen: document.querySelectorAll('#ansicht-einsatzplan .hervor').length, zellen: document.querySelectorAll('#ansicht-einsatzplan .hervor-zelle').length }));
  pruefe(markiert.zeilen === 1, 'Eine Zeile hervorgehoben', markiert);
  pruefe(markiert.zellen > 0, 'Zellen der Uhrzeit hervorgehoben', markiert);
  await c.klick('#ansicht-einsatzplan .ep-regeln li:first-child .ep-eintrag');
  gleich(await anzahl('#ansicht-einsatzplan .hervor'), 0, 'Zweiter Klick hebt auf');
});

await szenario('Einsatzplan: Wochen-Seitenleiste gegen DB', async () => {
  await epTag(MO);
  const ui = await c.werte(() => {
    const box = [...document.querySelectorAll('#ansicht-einsatzplan .ep-box')].find((b) => b.querySelector('h3')?.textContent.startsWith('Woche'));
    return [...box.querySelectorAll('tbody tr')].map((tr) => [tr.querySelector('th').textContent, ...[...tr.querySelectorAll('td')].map((td) => td.textContent)]);
  });
  const db = await sql(`select m.id, m.name, v.wochenstunden::float as vertrag,
      coalesce((select sum(a.stunden) from pep.abwesenheiten a where a.mitarbeiter_id = m.id and a.datum between '2026-11-09' and '2026-11-15'), 0)::float as abw,
      exists (select 1 from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id where a.mitarbeiter_id = m.id and c.sperrt and a.datum between '2026-11-09' and '2026-11-15') as hat_sperre,
      coalesce((select sum(extract(epoch from (p.bis - p.von)) / 3600) from pep.plan_bloecke p join pep.bereiche b on b.id = p.bereich_id
                 where p.mitarbeiter_id = m.id and b.art <> 'pause' and p.datum between '2026-11-09' and '2026-11-15'), 0)::float as geplant
    from pep.mitarbeiter m join lateral (select wochenstunden from pep.vertraege where mitarbeiter_id = m.id and gueltig_ab <= '2026-11-15' order by gueltig_ab desc limit 1) v on true
    where m.aktiv order by m.position, m.id`);
  for (const d of db) {
    const z = ui.find((x) => x[0] === d.name);
    if (!pruefe(z, `Seitenleiste: Zeile ${d.name}`)) continue;
    pruefe(Math.abs(zahlDE(z[1]) - (d.vertrag - d.abw)) < 0.01, `${d.name}: Soll = Vertrag ${d.vertrag} − Abw. ${d.abw}`, z[1]);
    if (!d.hat_sperre) pruefe(Math.abs(zahlDE(z[2]) - d.geplant) < 0.01, `${d.name}: geplant ${d.geplant}`, z[2]);
    pruefe(Math.abs(zahlDE(z[3]) - (zahlDE(z[2]) - zahlDE(z[1]))) < 0.01, `${d.name}: Diff. = geplant − Soll`, z);
  }
  const fuss = await c.werte(() => {
    const box = [...document.querySelectorAll('#ansicht-einsatzplan .ep-box')].find((b) => b.querySelector('h3')?.textContent.startsWith('Woche'));
    return [...box.querySelectorAll('tfoot td')].map((td) => td.textContent);
  });
  const kz = (await sql('select planumsatz::float as p from pep.wochen where jahr = 2026 and kw = 46'))[0];
  notiz(`Fußzeile Woche: ${fuss.join(' | ')} (Planumsatz KW 46: ${kz?.p})`);
  const vp = (await s.rpc('pep_vorausplanung', { p_jahr: 2026, p_kw: 46 }, B.leitung)).json.wochen[0];
  pruefe(Math.abs(zahlDE(fuss[0]) - Number(vp.stundenvorgabe)) < 0.01, 'Vorgabe = Vorausplanung KW 46', { ui: fuss[0], vp: vp.stundenvorgabe });
  pruefe(Math.abs(zahlDE(fuss[1]) - Number(vp.geplant)) < 0.01, 'Summe geplant = Vorausplanung „Geplant“', { ui: fuss[1], vp: vp.geplant });
});

await szenario('Einsatzplan: vergangener Tag schreibgeschützt', async () => {
  await epTag('2026-10-30');
  pruefe((await text('#ansicht-einsatzplan .hinweis-gelb'))?.startsWith('Vergangene Tage sind schreibgeschützt.'), 'Hinweis vergangen');
  gleich(await anzahl('#ansicht-einsatzplan .ep-pinsel'), 0, 'Keine Pinsel');
  pruefe(!(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-raster').classList.contains('malt'))), 'Raster nicht im Malmodus');
  const vorher = s.aufrufe.length;
  await epStrich(MIA, '09:00', '10:00');
  gleich(s.aufrufe.slice(vorher).filter((a) => a.funktion === 'pep_plan_malen').length, 0, 'Kein pep_plan_malen');
  gleich(await bloecke(MIA, '2026-10-30'), [], 'DB unverändert');
});

// ---------------------------------------------------------------- Kopieren und Vorlagen

await szenario('Kopieren: Tag → Tag', async () => {
  await epTag(MO);
  await c.klick({ text: 'Kopieren', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
  await warteDialog('Kopieren');
  gleich(await text('dialog[open] .pd-ziele'), 'Ziel: Mo 16.11.', 'Vorschau Ziel');
  await dKnopf('Kopieren');
  await ruhe();
  const m = await meldungen();
  const n = await blockZahl('2026-11-16');
  pruefe(n > 0, 'DB: Blöcke am 16.11.', n);
  const anzeige = m.toast || m.fehler;
  pruefe(anzeige.startsWith('1 Tag kopiert:'), 'Ergebnis-Meldung', anzeige);
  const gemeldet = Number(/(\d+) Blöcke?/.exec(anzeige)?.[1]);
  gleich(gemeldet, n, 'Gemeldete Blockzahl = DB');
  notiz(`Meldung: ${anzeige}`);
});

await szenario('Kopieren: Tag → alle gleichen Wochentage bis Datum', async () => {
  await epTag(DI);
  await c.klick({ text: 'Kopieren', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
  await warteDialog('Kopieren');
  await c.setzeWert('dialog[open] input[aria-label="alle Dienstage bis"]', '2026-12-01');
  gleich(await text('dialog[open] .pd-ziele'), 'Ziel: Di 17.11., Di 24.11., Di 01.12.', 'Vorschau Ziele');
  await dKnopf('Kopieren');
  await ruhe();
  for (const d of ['2026-11-17', '2026-11-24', '2026-12-01']) pruefe((await blockZahl(d)) > 0, `DB: Blöcke am ${d}`);
  const m = await meldungen();
  notiz(`Meldung: ${m.toast || m.fehler}`);
  pruefe((m.toast || m.fehler).startsWith('3 Tage kopiert:'), 'Meldung 3 Tage', m);
});

await szenario('Kopieren: Woche → nächste Wochen mit Rückfrage (leere Zeilen / Ersetzen)', async () => {
  await epTag(MO);
  const vorher16 = await bloecke(ID[1], '2026-11-16');
  await sql("delete from pep.plan_bloecke where datum = '2026-11-16' and mitarbeiter_id = $1", [ID[5]]); // eine leere Zeile im Ziel
  await c.klick({ text: 'Kopieren', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
  await warteDialog('Kopieren');
  await c.setzeWert('dialog[open] input[aria-label="Anzahl Wochen"]', '2');
  gleich(await text('dialog[open] .pd-ziele'), 'Ziel: KW 47, KW 48', 'Vorschau Ziele');
  await dKnopf('Kopieren');
  gleich(await warteDialog('Ziel schon geplant'), 'Ziel schon geplant', 'Rückfrage');
  notiz(`Rückfrage: ${await text('dialog[open] p')}`);
  await dKnopf('Nur leere Zeilen füllen');
  await ruhe();
  const m = await meldungen();
  notiz(`Meldung: ${m.toast || m.fehler}`);
  pruefe(/schon belegt, nicht geändert/.test(m.toast + m.fehler), 'Meldung nennt belegte Zeilen', m);
  gleich(await bloecke(ID[1], '2026-11-16'), vorher16, 'Belegte Zeile Ben 16.11. unverändert');
  pruefe((await bloecke(ID[5], '2026-11-16')).length > 0, 'Leere Zeile Frieda 16.11. gefüllt');
  pruefe((await blockZahl('2026-11-25')) > 0, 'KW 48 (25.11.) gefüllt');
  // Ersetzen: Tag 10.11. → 17.11. (belegt)
  await epTag(DI);
  await sql("insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id) values ($1, $2, '2026-11-17', '19:00', '21:00', $3)",
    [B.fil, NICO, B.bereich.RE]);
  await c.klick({ text: 'Kopieren', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
  await warteDialog('Kopieren');
  await dKnopf('Kopieren');
  await warteDialog('Ziel schon geplant');
  await dKnopf('Ersetzen');
  await ruhe();
  gleich(await bloecke(NICO, '2026-11-17'), [], 'Ersetzen löscht Zusatzblock im Ziel');
  const quelle = await sql("select count(*)::int as n from pep.plan_bloecke where datum = '2026-11-10'");
  const ziel = await sql("select count(*)::int as n from pep.plan_bloecke where datum = '2026-11-17'");
  notiz(`Blöcke 10.11.: ${quelle[0].n}, 17.11. nach Ersetzen: ${ziel[0].n}`);
});

await szenario('Vorlagen: Tag und Woche speichern, laden, löschen, doppelter Name', async () => {
  await epTag(MO);
  const oeffnen = async () => {
    await c.klick({ text: 'Vorlagen', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
    await warteDialog('Vorlagen');
    await ruhe();
  };
  await oeffnen();
  await c.tippe('dialog[open] input[placeholder="z. B. Standardwoche"]', 'Test-Tag');
  await c.klick({ text: 'diesen Tag', in: 'dialog[open]', sel: 'label' });
  await dKnopf('Als Vorlage speichern');
  gleich((await meldungen()).toast, 'Vorlage „Test-Tag“ gespeichert.', 'Toast Tag-Vorlage');
  await oeffnen();
  await c.tippe('dialog[open] input[placeholder="z. B. Standardwoche"]', 'Test-Woche');
  await dKnopf('Als Vorlage speichern');
  const db = await sql('select name, art from pep.vorlagen order by id');
  gleich(db.map((v) => `${v.name}/${v.art}`), ['Standardwoche November/woche', 'Test-Tag/tag', 'Test-Woche/woche'], 'DB Vorlagen');
  await oeffnen();
  const liste = await texte('dialog[open] .pd-vorlage strong');
  gleich(liste.sort(), ['Standardwoche November', 'Test-Tag', 'Test-Woche'], 'Liste im Dialog');
  await c.tippe('dialog[open] input[placeholder="z. B. Standardwoche"]', 'Test-Tag');
  await c.klick({ text: 'diesen Tag', in: 'dialog[open]', sel: 'label' });
  await dKnopf('Als Vorlage speichern');
  gleich(await dFehler(), 'Eine Vorlage mit diesem Namen gibt es schon.', 'Doppelter Name');
  await dialogZu();
  // Laden auf Mo 30.11. (leer)
  await epTag('2026-11-30');
  gleich(await blockZahl('2026-11-30'), 0, '30.11. vorher leer');
  await oeffnen();
  await c.klick({ text: 'Laden auf Mo 30.11.', in: 'dialog[open]', sel: 'button' });
  await warteDialog('laden');
  await dKnopf('Laden');
  await ruhe();
  const n = await blockZahl('2026-11-30');
  pruefe(n > 0, 'DB: Blöcke am 30.11. nach Laden', n);
  const m = await meldungen();
  notiz(`Meldung: ${m.toast || m.fehler}`);
  pruefe((m.toast || m.fehler).startsWith('Vorlage „Test-Tag“: 1 Tag geladen'), 'Meldung Vorlage geladen', m);
  // Löschen
  await oeffnen();
  await c.klick('dialog[open] [aria-label="Vorlage Test-Woche löschen"]');
  await warteDialog('löschen?');
  await dKnopf('Löschen');
  await ruhe();
  gleich((await sql("select count(*)::int as n from pep.vorlagen where name = 'Test-Woche'"))[0].n, 0, 'DB: Test-Woche gelöscht');
  pruefe((await dialogTitel()) === 'Vorlagen', 'Liste öffnet sich wieder', await dialogTitel());
  gleich((await texte('dialog[open] .pd-vorlage strong')).includes('Test-Woche'), false, 'Liste ohne Test-Woche');
  await dialogZu();
}, { erlaubeHttp: ['VORLAGE_DOPPELT'] });

// ---------------------------------------------------------------- Krank/ZA, Ersatz, Eckdaten

await szenario('Krank melden über geplanten Blöcken, Ersatz übernehmen', async () => {
  const ben = ID[1];
  await epTag(DO);
  const geplant = await bloecke(ben, DO);
  pruefe(geplant.length > 0, 'Ben ist am 12.11. geplant', geplant);
  await c.klick({ text: 'Krank/ZA', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
  await warteDialog('Krank');
  await c.setzeWert('dialog[open] select[aria-label="Mitarbeiter"]', String(ben));
  await dKnopf('Eintragen');
  await ruhe();
  gleich((await abwesenheiten(ben, DO, DO)).map((a) => `${a.code} ${a.quelle}`), ['KM schnell'], 'DB KM');
  const m = await meldungen();
  pruefe(/KM eingetragen: Muster, Ben, Do 12\.11\./.test(m.fehler + m.toast), 'Meldung KM', m);
  const zeile = `#ansicht-einsatzplan tr[data-mitarbeiter="${ben}"]`;
  const unbesetzt = await anzahl(`${zeile} td.unbesetzt`);
  pruefe(unbesetzt > 0, 'Blöcke schraffiert (unbesetzt)', unbesetzt);
  gleich(await bloecke(ben, DO), geplant, 'Blöcke bleiben in der DB');
  pruefe((await anzahl(`${zeile} .ep-ersatz`)) > 0, 'Knopf „Ersatz“ am Block');
  await c.foto(`${FOTOS}krank-unbesetzt.png`);
  await c.klick(`${zeile} .ep-ersatz`);
  await warteDialog('Ersatz für');
  await ruhe();
  const kandidaten = await texte('dialog[open] .pd-kandidat strong');
  pruefe(kandidaten.length > 0, 'Kandidaten gelistet', kandidaten);
  notiz(`Kandidaten: ${kandidaten.join(', ')}; unbesetzt: ${await text('dialog[open] .pd-unbesetzt')}`);
  const bloeckeText = await texte('dialog[open] .pd-block');
  pruefe(bloeckeText.length > 0 && bloeckeText.every((x) => !x.startsWith('PA')), 'Pause nicht als eigener unbesetzter Block', bloeckeText);
  const pausen = geplant.filter((x) => x.startsWith('PA ')).map((x) => x.slice(3).replace('-', '–'));
  gleich(await text('dialog[open] .pd-pause'), pausen.length ? `inkl. Pause ${pausen.join(', ')}` : null, 'Schichtzeile nennt die Pause');
  // Arbeitsstunden der Übernahme = Ben am Tag ohne Pause (alle seine Blöcke sind unbesetzt)
  const arbeit = (await sql(`select coalesce(sum(extract(epoch from (p.bis - p.von)) / 3600), 0)::float as h from pep.plan_bloecke p
    join pep.bereiche b on b.id = p.bereich_id where p.mitarbeiter_id = $1 and p.datum = $2::date and b.art <> 'pause'`, [ben, DO]))[0].h;
  const verbrauch = await texte('dialog[open] .pd-uebernahme');
  gleich(verbrauch.length, kandidaten.length, 'Jeder Kandidat zeigt den Verbrauch der Übernahme');
  pruefe(verbrauch.every((x) => x.startsWith(`Übernahme ${arbeit.toFixed(2).replace('.', ',')} h · danach `)), `Übernahme ${arbeit} h`, verbrauch);
  await c.foto(`${FOTOS}ersatz-dialog.png`);
  if (kandidaten.length) {
    const ersatzName = kandidaten[0];
    const ersatzId = (await sql('select id from pep.mitarbeiter where name = $1', [ersatzName]))[0].id;
    const vorherErsatz = await bloecke(ersatzId, DO);
    await c.klick('dialog[open] .pd-kandidat');
    await ruhe();
    gleich(await bloecke(ben, DO), [], 'Ben hat keine Blöcke mehr');
    const nachher = await bloecke(ersatzId, DO);
    gleich(nachher.length, vorherErsatz.length + geplant.length, `${ersatzName} übernimmt die Blöcke`);
    const t = await meldungen();
    pruefe(t.toast.startsWith(`${ersatzName} übernimmt`), 'Toast Ersatz', t);
  }
});

await szenario('Zeitausgleich melden', async () => {
  const frieda = ID[5];
  await epTag(FR);
  await c.klick({ text: 'Krank/ZA', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
  await warteDialog('Krank');
  await c.setzeWert('dialog[open] select[aria-label="Mitarbeiter"]', String(frieda));
  await c.klick({ text: 'Zeitausgleich (ZA)', in: 'dialog[open]', sel: 'label' });
  await dKnopf('Eintragen');
  await ruhe();
  gleich((await abwesenheiten(frieda, FR, FR)).map((a) => `${a.code} ${a.stunden}`), ['ZA 7'], 'DB ZA (42 h ÷ 6)');
  // ohne Mitarbeiter → Fehlermeldung im Dialog
  await c.klick({ text: 'Krank/ZA', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
  await warteDialog('Krank');
  await dKnopf('Eintragen');
  gleich(await dFehler(), 'Bitte einen Mitarbeiter wählen.', 'Fehler ohne Mitarbeiter');
  await dialogZu();
});

await szenario('Eckdaten: Inhalt, Krank/ZA vorbelegt, Sprung zur Mitarbeiterkarte', async () => {
  const emil = ID[4];
  await epTag(MO);
  const oeffnen = async () => {
    await c.klick({ text: 'Demo, Emil', in: '#ansicht-einsatzplan', sel: '.ep-name-knopf', genau: true });
    await warteDialog('Demo, Emil');
    await ruhe();
  };
  await oeffnen();
  const inhalt = await c.werte(() => document.querySelector('dialog[open]').innerText);
  for (const t of ['Vertrag und Kompetenzen', 'Vollzeit · 37,50 h pro Woche', 'Woche KW 46', 'Pflicht – alle Tage: höchstens 9 h am Tag',
    'bevorzugt – Di: nur 06:00–14:00', 'Samstage im November', 'Vorwoche KW 45', 'Obstlieferung prüfen', 'Pers.-Nr. 90005']) {
    pruefe(inhalt.includes(t), `Eckdaten enthalten „${t}“`);
  }
  const soll = await c.werte(() => [...document.querySelectorAll('dialog[open] .pd-eck-werte dd')].map((d) => d.textContent));
  const geplantDb = (await sql(`select coalesce(sum(extract(epoch from (p.bis - p.von)) / 3600), 0)::float as h from pep.plan_bloecke p
    join pep.bereiche b on b.id = p.bereich_id where p.mitarbeiter_id = $1 and b.art <> 'pause' and p.datum between '2026-11-09' and '2026-11-15'`, [emil]))[0].h;
  pruefe(Math.abs(zahlDE(soll[1]) - geplantDb) < 0.01, `Eckdaten geplant = DB ${geplantDb}`, soll);
  await c.foto(`${FOTOS}eckdaten.png`);
  await dKnopf('Krank melden');
  await warteDialog('Krank');
  gleich(await c.werte(() => document.querySelector('dialog[open] select[aria-label="Mitarbeiter"]').value), String(emil), 'Krank: Emil vorgewählt');
  gleich(await c.werte(() => document.querySelector('dialog[open] input[value="KM"]').checked), true, 'Krank: KM gewählt');
  await dialogZu();
  await oeffnen();
  await dKnopf('Zeitausgleich');
  await warteDialog('Krank');
  gleich(await c.werte(() => document.querySelector('dialog[open] input[value="ZA"]').checked), true, 'ZA gewählt');
  gleich(await c.werte(() => document.querySelector('dialog[open] input[type="date"]').value), MO, 'Datum vorbelegt');
  await dialogZu();
  await oeffnen();
  await dKnopf('Zur Mitarbeiterkarte');
  await ruhe();
  pruefe(await sichtbar('#ansicht-mitarbeiter'), 'Reiter Mitarbeiter');
  gleich(await text('#ma-liste .ma-eintrag.gewaehlt .ma-name'), 'Demo, Emil', 'Emil in der Liste gewählt');
  gleich(await c.werte(() => document.querySelector('#ma-karte input[type="text"]')?.value), 'Demo, Emil', 'Karte zeigt Emil');
});

// ---------------------------------------------------------------- Vorausplanung

await szenario('Vorausplanung: Eingaben, Neuladen, Sprung, Jahreswechsel', async () => {
  await reiter('vorausplanung');
  gleich(await text('#ansicht-vorausplanung .monatsname'), 'KW 45/2026 – KW 50/2026', 'Sechs Wochen ab heute');
  const feld = (zeile, kw) => `#ansicht-vorausplanung input[aria-label="${zeile} KW ${kw}"]`;
  await c.tippe(feld('Planumsatz', 49), '60.000', { tab: true }); await ruhe();
  await c.tippe(feld('Stundenleistung', 49), '180', { tab: true }); await ruhe();
  await c.tippe(feld('Stundenvorgabe von Hand', 49), '250', { tab: true }); await ruhe();
  const w = await sql('select planumsatz::float as p, stundenleistung_eur_pro_h::float as s, stundenvorgabe_manuell::float as v from pep.wochen where jahr = 2026 and kw = 49');
  gleich(w, [{ p: 60000, s: 180, v: 250 }], 'DB KW 49');
  // Soll = 60000 / 180 = 333,33 → auf halbe Stunden 333,5; Vorgabe von Hand 250
  const spalte = await c.werte(() => {
    const kopf = [...document.querySelectorAll('#ansicht-vorausplanung thead th')].map((th) => th.textContent);
    const i = kopf.findIndex((t) => t.startsWith('KW 49'));
    return [...document.querySelectorAll('#ansicht-vorausplanung tbody tr')].map((tr) => [tr.querySelector('th').textContent, tr.children[i]?.textContent]);
  });
  const wert = (z) => spalte.find((x) => x[0] === z)?.[1];
  gleich(wert('Soll-Stunden'), '333,5', 'Soll-Stunden KW 49');
  pruefe(wert('Vorgabe für den Einsatzplan')?.startsWith('250'), 'Vorgabe 250 von Hand', wert('Vorgabe für den Einsatzplan'));
  // ungültige Eingabe
  await c.tippe(feld('Planumsatz', 50), 'abc', { tab: true }); await ruhe();
  gleich((await meldungen()).fehler, 'Der Wert ist ungültig.', 'Ungültige Eingabe gemeldet');
  gleich(await c.werte((x) => document.querySelector(x).value, feld('Planumsatz', 50)), '95.000', 'Feld zeigt wieder den gespeicherten Wert');
  // Neuladen der Seite
  await c.navigiere(`${s.adresse}/browser/`);
  await c.warteAuf(() => document.querySelector('#ansicht-start .kachel'), { text: 'Start nach Neuladen' });
  await ruhe();
  await reiter('vorausplanung');
  gleich([await c.werte((x) => document.querySelector(x).value, feld('Planumsatz', 49)),
    await c.werte((x) => document.querySelector(x).value, feld('Stundenleistung', 49)),
    await c.werte((x) => document.querySelector(x).value, feld('Stundenvorgabe von Hand', 49))], ['60.000', '180', '250'], 'Werte nach Neuladen');
  // Spaltenkopf → Einsatzplan
  await c.klick({ text: 'KW 47', in: '#ansicht-vorausplanung thead', sel: 'button' });
  await ruhe();
  pruefe(await sichtbar('#ansicht-einsatzplan'), 'Sprung in den Einsatzplan');
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 47', 'Einsatzplan KW 47');
  await reiter('vorausplanung');
  for (let i = 0; i < 8; i++) { await c.klick('#ansicht-vorausplanung [aria-label="Eine Woche weiter"]'); await ruhe(); }
  gleich(await text('#ansicht-vorausplanung .monatsname'), 'KW 53/2026 – KW 5/2027', '▶×8 → ab KW 53');
  const koepfe = await texte('#ansicht-vorausplanung thead .woche-sprung');
  gleich(koepfe[0], 'KW 5328.12.–03.01.', 'Kopf KW 53');
  gleich(koepfe[1], 'KW 104.01.–10.01. 2027', 'Kopf KW 1 mit Jahr');
  await c.klick('#ansicht-vorausplanung [aria-label="Eine Woche weiter"]'); await ruhe();
  gleich(await text('#ansicht-vorausplanung .monatsname'), 'KW 1/2027 – KW 6/2027', '▶ → ab KW 1/2027');
  await c.klick('#ansicht-vorausplanung [aria-label="Eine Woche zurück"]'); await ruhe();
  await c.klick('#ansicht-vorausplanung [aria-label="Eine Woche zurück"]'); await ruhe();
  gleich(await text('#ansicht-vorausplanung .monatsname'), 'KW 52/2026 – KW 4/2027', '◀◀ → ab KW 52');
  await c.klick({ text: 'Aktuelle Woche', in: '#ansicht-vorausplanung', sel: 'button' }); await ruhe();
  gleich(await text('#ansicht-vorausplanung .monatsname'), 'KW 45/2026 – KW 50/2026', '„Aktuelle Woche“');
});

// ---------------------------------------------------------------- Druck und Excel (Einsatzplan)

function pruefeXlsx(puffer) {
  const u8 = new Uint8Array(puffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('kein ZIP (End of Central Directory fehlt)');
  const anzahlEintraege = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dateien = {};
  for (let n = 0; n < anzahlEintraege; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Central Directory beschädigt');
    const methode = dv.getUint16(p + 10, true);
    const crc = dv.getUint32(p + 16, true);
    const groesse = dv.getUint32(p + 20, true);
    const nameLaenge = dv.getUint16(p + 28, true);
    const extra = dv.getUint16(p + 30, true);
    const kommentar = dv.getUint16(p + 32, true);
    const lokal = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLaenge));
    if (methode !== 0) throw new Error(`${name}: Methode ${methode} (erwartet stored)`);
    const lName = dv.getUint16(lokal + 26, true);
    const lExtra = dv.getUint16(lokal + 28, true);
    const daten = u8.subarray(lokal + 30 + lName + lExtra, lokal + 30 + lName + lExtra + groesse);
    if (crc32(daten) >>> 0 !== crc) throw new Error(`${name}: CRC falsch`);
    dateien[name] = new TextDecoder().decode(daten);
    p += 46 + nameLaenge + extra + kommentar;
  }
  return dateien;
}

await szenario('Druck Einsatzplan: Tagesplan, Wochenplan, Tagespläne, Excel', async () => {
  await epTag(MO);
  await druckStub();
  const drucken = async (knopf, warteSel) => {
    await c.klick({ text: 'Drucken', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button', genau: true });
    await warteDialog('Drucken');
    await dKnopf(knopf);
    if (warteSel) await c.warteAuf((x) => document.querySelector(x), { text: knopf }, warteSel);
  };
  const zeilenRaster = await anzahl('#ansicht-einsatzplan .ep-tabelle tbody tr');
  await drucken('Wochenplan', '#ansicht-druck .dr-wochenplan');
  gleich(await anzahl('#ansicht-druck .dr-wochenplan tbody tr'), zeilenRaster, 'Wochenplan: Zeile je Mitarbeiter');
  gleich(await texte('#ansicht-druck .dr-wochenplan thead tr:nth-child(2) th'),
    ['Name / Personalnr.', 'Vertrag', 'Montag09.11.', 'Dienstag10.11.', 'Mittwoch11.11.', 'Donnerstag12.11.', 'Freitag13.11.', 'Samstag14.11.', 'geplant', 'abwesend', 'Differenz'], 'Wochenplan-Kopf ohne Sonntag');
  notiz(`Wochenplan-Fuß: ${await text('#ansicht-druck .dr-fuss')}`);
  const pdf = await c.sende('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${FOTOS}wochenplan.pdf`, Buffer.from(pdf.data, 'base64'));
  await druckAufraeumen();
  await drucken('Tagesplan Mo 09.11.', '#ansicht-druck .dr-tagesplan');
  gleich(await text('#ansicht-druck .dr-titel'), 'Tagesplan', 'Tagesplan-Titel');
  pruefe((await text('#ansicht-druck .dr-kopf span'))?.includes('Montag, 09.11.2026'), 'Tagesplan-Datum', await text('#ansicht-druck .dr-kopf span'));
  const abw = await text('#ansicht-druck .dr-fuss');
  pruefe(abw.includes('Test, Anna (U)') && abw.includes('Probe, Dana (KM)'), 'Tagesplan nennt Abwesende', abw);
  const pdf2 = await c.sende('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${FOTOS}tagesplan.pdf`, Buffer.from(pdf2.data, 'base64'));
  await druckAufraeumen();
  await drucken('Tagespläne der Woche', '#ansicht-druck .dr-tagesplan');
  gleich(await anzahl('#ansicht-druck .dr-seite'), 6, 'Tagespläne: sechs offene Tage');
  await druckAufraeumen();
  gleich(await c.werte(() => window.__gedruckt), 3, 'print() dreimal');
  // Excel
  await c.werte(() => {
    window.__blobs = [];
    const echt = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__blobs.push(b); return echt(b); };
  });
  await drucken('Excel (Wochenplan)');
  await c.warteAuf(() => window.__blobs.length > 0, { text: 'Excel-Blob' });
  const b64 = await c.werte(async () => {
    const b = window.__blobs[0];
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s1 = ''; for (const x of bytes) s1 += String.fromCharCode(x);
    return { typ: b.type, daten: btoa(s1) };
  });
  gleich(b64.typ, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Blob-Typ');
  const puffer = Buffer.from(b64.daten, 'base64');
  writeFileSync(`${FOTOS}Wochenplan-KW46-2026.xlsx`, puffer);
  pruefe(puffer.length > 1000, 'xlsx nicht leer', puffer.length);
  try {
    const dateien = pruefeXlsx(puffer);
    const namen = Object.keys(dateien);
    for (const n of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) pruefe(namen.includes(n), `xlsx enthält ${n}`, namen);
    const blatt = dateien['xl/worksheets/sheet1.xml'] ?? '';
    pruefe(blatt.includes('Muster, Ben'), 'Blatt enthält Mitarbeiter');
    notiz(`xlsx: ${namen.length} Dateien, Blattname ${/<sheet name="([^"]+)"/.exec(dateien['xl/workbook.xml'] ?? '')?.[1]}, ${(blatt.match(/<row /g) ?? []).length} Zeilen`);
  } catch (e) {
    pruefe(false, `xlsx gültig: ${e.message}`);
  }
});

// ---------------------------------------------------------------- Mitarbeiter

await szenario('Mitarbeiter: Reihenfolge ▲/▼, Stammdaten, Kompetenz, Vertrag, neu', async () => {
  await reiter('mitarbeiter');
  const anna = ID[0];
  const ben = ID[1];
  await c.klick('#ma-liste [aria-label="Test, Anna nach unten"]');
  await ruhe();
  const reihe = await sql('select id from pep.mitarbeiter where aktiv order by position, id limit 2');
  gleich(reihe.map((r) => r.id), [ben, anna], 'DB: Ben vor Anna');
  gleich((await texte('#ma-liste .ma-name')).slice(0, 2).map((t) => t.replace(/(KA|VP)+$/, '')), ['Muster, Ben', 'Test, Anna'], 'Liste umsortiert');
  await reiter('einsatzplan');
  await epTag(MI);
  const ersteZeilen = await c.werte(() => [...document.querySelectorAll('#ansicht-einsatzplan .ep-tabelle tbody tr')].slice(0, 2).map((tr) => Number(tr.dataset.mitarbeiter)));
  gleich(ersteZeilen, [ben, anna], 'Einsatzplan folgt der Reihenfolge');
  await reiter('mitarbeiter');
  // Stammdaten Jana
  const jana = ID[9];
  await c.klick({ text: 'Skizze, Jana', in: '#ma-liste', sel: '.ma-eintrag' });
  await ruhe();
  await c.tippe(await feldUnter('#ma-karte', 'Personalnummer'), '99999');
  await c.tippe(await feldUnter('#ma-karte', 'Notiz'), 'Testnotiz Stammdaten');
  await c.klick({ text: 'Speichern', in: '#ma-karte .box:nth-child(1)', sel: 'button', genau: true });
  await ruhe();
  gleich(await sql('select personalnummer, notiz from pep.mitarbeiter where id = $1', [jana]), [{ personalnummer: '99999', notiz: 'Testnotiz Stammdaten' }], 'DB Stammdaten');
  gleich((await meldungen()).toast, 'Gespeichert.', 'Toast');
  // Kompetenz VP an/aus
  const vp = B.bereich.VP;
  const vpHaken = async () => c.werte(() => [...document.querySelectorAll('#ma-karte .haken')].find((l) => l.textContent.includes('(VP)'))?.querySelector('input').checked);
  const vpKlick = async () => { await c.klick({ text: '(VP)', in: '#ma-karte', sel: 'label.haken' }); await ruhe(); };
  gleich(await vpHaken(), false, 'VP vorher aus');
  await vpKlick();
  gleich((await sql('select count(*)::int as n from pep.kompetenzen where mitarbeiter_id = $1 and bereich_id = $2', [jana, vp]))[0].n, 1, 'DB VP an');
  gleich(await vpHaken(), true, 'Haken an');
  await vpKlick();
  gleich((await sql('select count(*)::int as n from pep.kompetenzen where mitarbeiter_id = $1 and bereich_id = $2', [jana, vp]))[0].n, 0, 'DB VP aus');
  // Vertrag ändern
  await c.tippe(await feldUnter('#ma-karte', 'Wochenstunden', 0), '35');
  await c.klick({ text: 'Speichern', in: '#ma-karte .box:nth-child(2)', sel: 'button', genau: true });
  await ruhe();
  gleich(await sql('select wochenstunden::float as w, vertragsart as a from pep.vertraege where mitarbeiter_id = $1 order by gueltig_ab', [jana]), [{ w: 35, a: 'vollzeit' }], 'DB Vertrag 35 h');
  pruefe((await text('#ma-liste .ma-eintrag.gewaehlt small')) === 'Vollzeit · 35,0 h', 'Liste zeigt 35,0 h', await text('#ma-liste .ma-eintrag.gewaehlt small'));
  // Neuer Vertrag ab 2027
  await c.setzeWert(await feldUnter('#ma-karte', 'Neuer Vertrag ab'), '2027-01-01');
  await c.setzeWert(await feldUnter('#ma-karte', 'Vertragsart', 1), 'teilzeit');
  await c.tippe(await feldUnter('#ma-karte', 'Wochenstunden', 1), '30');
  await c.klick({ text: 'Vertrag anlegen', in: '#ma-karte', sel: 'button' });
  await ruhe();
  gleich((await sql('select count(*)::int as n from pep.vertraege where mitarbeiter_id = $1', [jana]))[0].n, 2, 'DB: zweiter Vertrag');
  // Neuer Mitarbeiter
  await c.klick({ text: 'Neuer Mitarbeiter', in: '#ma-liste', sel: 'button' });
  await c.tippe(await feldUnter('#ma-karte', 'Name'), 'Neu, Testperson');
  await c.klick({ text: 'Speichern', in: '#ma-karte', sel: 'button', genau: true });
  await ruhe();
  gleich((await sql("select count(*)::int as n from pep.mitarbeiter where name = 'Neu, Testperson'"))[0].n, 1, 'DB neuer Mitarbeiter');
  gleich(await text('#ma-liste .ma-eintrag.gewaehlt .ma-name'), 'Neu, Testperson', 'Neuer Mitarbeiter gewählt');
  pruefe(await sichtbar('#ma-karte .box:nth-child(2)'), 'Karte mit Verträgen sichtbar');
});

// ---------------------------------------------------------------- Einstellungen

await szenario('Einstellungen: Rahmen, Bereich, Code, Parameter, Schulferien, Abweichung', async () => {
  await reiter('einstellungen');
  const box = (titel) => c.werte((t) => {
    const b = [...document.querySelectorAll('#ansicht-einstellungen .box')].findIndex((x) => x.querySelector('h2')?.textContent === t);
    return b;
  }, titel);
  const boxSel = async (titel) => `#ansicht-einstellungen > div:nth-child(${(await box(titel)) + 1})`;
  // Rahmen Samstag bis 21:00
  const rahmen = await boxSel('Öffnungs- und Rahmenzeiten');
  await c.setzeWert(await feldUnter(`${rahmen} form:nth-of-type(6)`, 'Rahmen bis'), '21:00');
  await c.klick(`${rahmen} form:nth-of-type(6) button[type="submit"]`);
  await ruhe();
  gleich(await sql("select to_char(rahmen_bis, 'HH24:MI') as b from pep.rahmen where wochentag = 6"), [{ b: '21:00' }], 'DB Rahmen Sa');
  gleich((await meldungen()).toast, 'Gespeichert.', 'Toast Rahmen');
  // Bereich OG: Kompetenz nötig
  const bereiche = await boxSel('Abteilungen und Bereiche');
  const ogForm = await c.werte((sel) => [...document.querySelectorAll(`${sel} form`)].findIndex((f) => f.querySelector('input[type="text"]')?.value === 'OG') + 1, bereiche);
  await c.klick({ text: 'Kompetenz nötig', in: `${bereiche} form:nth-of-type(${ogForm})`, sel: 'label' });
  await c.klick(`${bereiche} form:nth-of-type(${ogForm}) button[type="submit"]`);
  await ruhe();
  gleich(await sql("select kompetenz_noetig as k from pep.bereiche where kuerzel = 'OG'"), [{ k: true }], 'DB OG Kompetenz nötig');
  // Code BV: Name ändern
  const codes = await boxSel('Abwesenheitscodes');
  const bvForm = await c.werte((sel) => [...document.querySelectorAll(`${sel} form`)].findIndex((f) => f.querySelector('input[type="text"]')?.value === 'BV') + 1, codes);
  await c.tippe(await feldUnter(`${codes} form:nth-of-type(${bvForm})`, 'Name'), 'Fortbildung');
  await c.klick(`${codes} form:nth-of-type(${bvForm}) button[type="submit"]`);
  await ruhe();
  gleich(await sql("select name from pep.abwesenheitscodes where code = 'BV'"), [{ name: 'Fortbildung' }], 'DB Code BV');
  // Parameter Ruhezeit 11 → 12 (speichert bei change)
  const param = await boxSel('Regelparameter');
  await c.tippe(await feldUnter(param, 'Ruhezeit (h)'), '12', { tab: true });
  await ruhe();
  gleich(await sql("select wert from pep.einstellungen where schluessel = 'ruhezeit_h'"), [{ wert: 12 }], 'DB Ruhezeit');
  // Schulferien anlegen und löschen
  const ferien = await boxSel('Schulferien');
  await c.setzeWert(await feldUnter(ferien, 'Neu: von'), '2027-11-01');
  await c.setzeWert(await feldUnter(ferien, 'bis'), '2027-11-05');
  await c.tippe(await feldUnter(ferien, 'Name'), 'Herbstferien Test');
  await c.klick(`${ferien} button[type="submit"]`);
  await ruhe();
  gleich((await sql("select count(*)::int as n from pep.schulferien where name = 'Herbstferien Test'"))[0].n, 1, 'DB Schulferien angelegt');
  const ferienNr = await c.werte((sel) => [...document.querySelectorAll(`${sel} .zeile`)].findIndex((z) => z.textContent.includes('Herbstferien Test')) + 1, ferien);
  await c.klick({ text: 'Löschen', in: `${ferien} .zeile:nth-of-type(${ferienNr})`, sel: 'button' });
  await ruhe();
  gleich((await sql("select count(*)::int as n from pep.schulferien where name = 'Herbstferien Test'"))[0].n, 0, 'DB Schulferien gelöscht');
  // Abweichung Heiligabend 2026 (geöffnet 07–14)
  const abw = await boxSel('Abweichende Tage');
  await c.setzeWert(await feldUnter(abw, 'Neue Abweichung am'), '2026-12-24');
  await c.setzeWert(await feldUnter(`${abw} form:last-of-type`, 'Art'), 'heiligabend');
  await c.setzeWert(await feldUnter(`${abw} form:last-of-type`, 'Öffnung von'), '07:00');
  await c.setzeWert(await feldUnter(`${abw} form:last-of-type`, 'Öffnung bis'), '14:00');
  await c.setzeWert(await feldUnter(`${abw} form:last-of-type`, 'Rahmen von'), '06:00');
  await c.setzeWert(await feldUnter(`${abw} form:last-of-type`, 'Rahmen bis'), '15:00');
  await c.klick(`${abw} form:last-of-type button[type="submit"]`);
  await ruhe();
  gleich(await sql("select art, geoeffnet, to_char(oeffnung_bis, 'HH24:MI') as ob from pep.tag_abweichungen where datum = '2026-12-24'"),
    [{ art: 'heiligabend', geoeffnet: true, ob: '14:00' }], 'DB Abweichung 24.12.');
  const m = await meldungen();
  pruefe(!m.fehler, 'keine Fehlermeldung', m.fehler);
});

// ---------------------------------------------------------------- Zusätzliche Risiken

await szenario('Vorausplanung: Stundenleistung gleich dem Standardwert eintippen', async () => {
  await reiter('vorausplanung');
  const f = '#ansicht-vorausplanung input[aria-label="Stundenleistung KW 50"]';
  const feldWert = () => c.werte((x) => document.querySelector(x).value, f);
  const dbWert = async () => (await sql('select stundenleistung_eur_pro_h::float as s from pep.wochen where jahr = 2026 and kw = 50'))[0]?.s ?? null;
  gleich(await dbWert(), null, 'DB vorher: kein eigener Wert');
  gleich(await feldWert(), '', 'Feld ohne eigenen Wert ist leer (Hinweis: „leer = Standard aus den Einstellungen“)');
  gleich(await c.werte((x) => document.querySelector(x).placeholder, f), 'Standard 200', 'Platzhalter nennt den Standard');
  gleich(await c.werte(() => document.querySelector('#ansicht-vorausplanung input[aria-label="Stundenleistung KW 48"]').value), '210',
    'KW 48 zeigt ihren eigenen Wert');
  await c.tippe(f, '200', { tab: true });
  await ruhe();
  gleich(await dbWert(), 200, 'Getippte Stundenleistung 200 wird für die Woche gespeichert');
  gleich(await feldWert(), '200', 'Feld zeigt den eigenen Wert 200');
  await c.foto(`${FOTOS}vorausplanung-stundenleistung.png`);
  await c.tippe(f, '', { tab: true });
  await ruhe();
  gleich(await dbWert(), null, 'Leeren speichert null (wieder Standard)');
  gleich(await feldWert(), '', 'Feld nach dem Leeren leer');
  gleich((await meldungen()).fehler, '', 'keine Fehlermeldung');
});

await szenario('Abwesenheiten: Ziehen per Touch (Tablet)', async () => {
  await c.tablet(true);
  await pause(300);
  try {
    await reiter('abwesenheiten');
    await abwMonat('November 2026');
    await abwChip('U');
    const a = await zellPunkt(abwZelle(ID[8], '2026-11-25'), true);
    const b = await zellPunkt(abwZelle(ID[8], '2026-11-27'), false);
    await c.wische(a, b);
    await ruhe();
    gleich((await abwesenheiten(ID[8], '2026-11-25', '2026-11-27')).map((x) => `${x.datum.slice(8)} ${x.code}`), ['25 U', '26 U', '27 U'], 'DB nach Touch-Ziehen');
    await c.foto(`${FOTOS}touch-abwesenheit.png`);
    await abwChip('Ansehen');
  } finally {
    await c.tablet(false);
    await pause(300);
  }
});

await szenario('Einsatzplan: zwei schnelle Striche in einer Zeile bei langsamer Verbindung', async () => {
  await epTag(MI);
  await pinsel('KA');
  const vorher = await bloecke(MIA, MI);
  const belegtVorher = await zeilenBelegung(MIA);
  const wartendeZellen = () => c.werte((m) => [...document.querySelectorAll(`#ansicht-einsatzplan tr[data-mitarbeiter="${m}"] td.ep-z.wartet`)]
    .map((td) => td.dataset.von), MIA);
  const hinweis = () => c.werte(() => { const e = document.querySelector('#ansicht-einsatzplan .ep-speichert'); return e && !e.hidden ? e.textContent : ''; });
  s.verzoegere(800);
  try {
    const p = async (von) => zellPunkt(epZelle(MIA, von), false);
    await c.ziehe(await p('13:00'), await p('13:30'));
    await c.ziehe(await p('15:00'), await p('15:30'));
    gleich(await wartendeZellen(), ['13:00', '13:30', '15:00', '15:30'], 'Beide Striche markiert, solange sie warten');
    gleich(await hinweis(), 'wird gespeichert …', 'Hinweis „wird gespeichert …“');
    await pause(350); // der Hinweis blendet nach 300 ms ein
    await c.foto(`${FOTOS}zwei-striche-wartend.png`);
    await ruhe();
    await c.warteAuf(() => !document.querySelector('#ansicht-einsatzplan td.ep-z.wartet'), { text: 'Markierung weg', ms: 8000 });
  } finally {
    s.verzoegere(0);
  }
  gleich(await bloecke(MIA, MI), [...vorher, 'KA 13:00-14:00', 'KA 15:00-16:00'], 'Beide Striche gespeichert');
  gleich(await hinweis(), '', 'Hinweis nach dem Speichern weg');
  const belegt = await zeilenBelegung(MIA);
  pruefe(['13:00', '13:30', '15:00', '15:30'].every((v) => belegt.includes(v)), 'Beide Blöcke im Raster', belegt);
  // Zwei schnelle Rückgängig (langsam): jeder nimmt genau einen Strich zurück, zusammen der Ausgangszustand.
  s.verzoegere(400);
  try {
    await c.klick({ text: 'Rückgängig', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button' });
    await c.klick({ text: 'Rückgängig', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button' });
    await ruhe();
  } finally {
    s.verzoegere(0);
  }
  gleich(await bloecke(MIA, MI), vorher, 'Zwei Rückgängig: Zeile wie vorher');
  gleich(await zeilenBelegung(MIA), belegtVorher, 'Raster zeigt die Zeile wie vorher');
});

await szenario('Einsatzplan: Strich, dann sofort Tageswechsel (langsame Verbindung)', async () => {
  await epTag(MI);
  await pinsel('KA');
  const vorher = await bloecke(NICO, MI);
  s.verzoegere(800);
  try {
    const a = await zellPunkt(epZelle(NICO, '17:00'), true);
    const b = await zellPunkt(epZelle(NICO, '17:30'), false);
    await c.ziehe(a, b);
    await c.klick('#ansicht-einsatzplan .ep-tag:nth-child(4)');
    await ruhe();
  } finally {
    s.verzoegere(0);
  }
  gleich(await bloecke(NICO, MI), [...vorher, 'KA 17:00-18:00'].sort(), 'DB: Strich am Mittwoch gespeichert');
  gleich(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-datum').value), DO, 'Donnerstag angezeigt');
  const ui = await c.werte((n) => {
    const box = [...document.querySelectorAll('#ansicht-einsatzplan .ep-box')].find((x) => x.querySelector('h3')?.textContent.startsWith('Woche'));
    return [...box.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('th').textContent === n)?.children[2]?.textContent;
  }, 'Aushilfe, Nico');
  const db = (await sql(`select coalesce(sum(extract(epoch from (p.bis - p.von)) / 3600), 0)::float as h from pep.plan_bloecke p join pep.bereiche b on b.id = p.bereich_id
    where p.mitarbeiter_id = $1 and b.art <> 'pause' and p.datum between '2026-11-09' and '2026-11-15'`, [NICO]))[0].h;
  pruefe(Math.abs(zahlDE(ui) - db) < 0.01, `Seitenleiste Nico geplant = DB ${db}`, ui);
  await c.klick('#ansicht-einsatzplan .ep-tag:nth-child(3)');
  pruefe((await zeilenBelegung(NICO)).includes('17:30'), 'Zurück am Mittwoch: Block sichtbar', await zeilenBelegung(NICO));
});

await szenario('Einsatzplan: Kommentar tippen, dann Tag wechseln', async () => {
  await epTag(MI);
  const zelle = `#ansicht-einsatzplan td[data-kommentar="${MIA}"]`;
  await c.klick(zelle);
  await c.tippe(`${zelle} input`, 'Wechselnotiz');
  await c.klick('#ansicht-einsatzplan .ep-tag:nth-child(5)');
  await ruhe();
  const db = await sql('select datum::text as d, text from pep.plan_kommentare where mitarbeiter_id = $1 and text = $2', [MIA, 'Wechselnotiz']);
  gleich(db, [{ d: MI, text: 'Wechselnotiz' }], 'DB: Kommentar am Mittwoch');
  gleich(await text(zelle), '+ Notiz', 'Freitag zeigt keinen Kommentar');
  await c.klick('#ansicht-einsatzplan .ep-tag:nth-child(3)');
  gleich(await text(zelle), 'Wechselnotiz', 'Mittwoch zeigt den Kommentar');
});

await szenario('Vorausplanung: tippen und sofort blättern (langsame Verbindung)', async () => {
  await reiter('vorausplanung');
  const f = '#ansicht-vorausplanung input[aria-label="Planumsatz KW 48"]';
  s.verzoegere(600);
  try {
    await c.tippe(f, '75.000');
    await c.klick('#ansicht-vorausplanung [aria-label="Eine Woche weiter"]');
    await ruhe();
  } finally {
    s.verzoegere(0);
  }
  gleich(await sql('select planumsatz::float as p from pep.wochen where jahr = 2026 and kw = 48'), [{ p: 75000 }], 'DB KW 48');
  gleich(await text('#ansicht-vorausplanung .monatsname'), 'KW 46/2026 – KW 51/2026', 'eine Woche weiter');
  gleich(await c.werte((x) => document.querySelector(x).value, f), '75.000', 'Feld zeigt den neuen Wert');
});

await szenario('Einsatzplan: erster Strich abgelehnt, zweiter wartet, Wochenwechsel, dann Rückgängig', async () => {
  // Hanna hat keine Kasse-Kompetenz: der KA-Strich scheitert, der BB-Strich danach (wartet in derselben Zeile) gelingt.
  // Während beide laufen, wechselt die Seite die Woche. Rückgängig muss Hannas Zeile von vorher herstellen, nicht leeren.
  const hanna = ID[7];
  await epTag(MI);
  const vorher = await bloecke(hanna, MI);
  pruefe(vorher.length > 0, 'Hanna ist am Mittwoch geplant', vorher);
  s.verzoegere(800);
  try {
    const p = async (von, sc = false) => zellPunkt(epZelle(hanna, von), sc);
    await pinsel('KA');
    const a = await p('08:00', true);
    await c.ziehe(a, await p('08:30'));
    await pinsel('BB');
    await c.ziehe(await p('09:00'), await p('09:30'));
    // Die Woche wechselt, bevor die (langsame) Antwort auf den ersten Strich kommt.
    s.verzoegere(0);
    await c.klick('#ansicht-einsatzplan [aria-label="Nächste Woche"]');
    await c.warteAuf(() => document.querySelector('#ansicht-einsatzplan .ep-kw')?.textContent === 'KW 47', { text: 'KW 47', ms: 5000 });
    await ruhe();
  } finally {
    s.verzoegere(0);
  }
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 47', 'Woche gewechselt');
  gleich((await bloecke(hanna, MI)).sort(), [...vorher, 'BB 09:00-10:00'].sort(), 'DB: nur der BB-Strich gespeichert');
  await c.klick({ text: 'Rückgängig', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button' });
  await ruhe();
  gleich(await bloecke(hanna, MI), vorher, 'Rückgängig stellt Hannas Zeile her (nicht leer)');
  gleich(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-datum').value), MI, 'Rückgängig springt zum Mittwoch');
}, { erlaubeHttp: ['KOMPETENZ_FEHLT'] });

await szenario('Einsatzplan: Rückgängig während des Speicherns, danach noch ein Strich', async () => {
  // Strich A läuft (langsam), Klick auf Rückgängig, dann Strich B. Rückgängig wartet auf beide und nimmt B zurück
  // (den letzten Strich); A bleibt.
  await epTag(MI);
  await pinsel('KA');
  const vorher = await bloecke(MIA, MI);
  await epStrich(MIA, '06:00', '06:30'); // Strich 0, schnell: Rückgängig ist damit sicher aktiv
  s.verzoegere(800);
  try {
    const p = async (von, sc = false) => zellPunkt(epZelle(MIA, von), sc);
    const a = await p('17:00', true);
    await c.ziehe(a, await p('17:30'));
    await c.klick({ text: 'Rückgängig', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button' });
    await c.ziehe(await p('19:00'), await p('19:30'));
    await ruhe();
    await c.warteAuf(() => !document.querySelector('#ansicht-einsatzplan td.ep-z.wartet'), { text: 'Markierung weg', ms: 8000 });
    await ruhe();
  } finally {
    s.verzoegere(0);
  }
  gleich((await bloecke(MIA, MI)).sort(), [...vorher, 'KA 06:00-07:00', 'KA 17:00-18:00'].sort(), 'Strich 0 und A bleiben, B zurückgenommen');
});

// ---------------------------------------------------------------- Stellvertretung

await szenario('Stellvertretung: Rechte in allen Reitern', async () => {
  await c.klick('#abmelden');
  await c.warteAuf(() => !document.getElementById('ansicht-login').hidden, { text: 'Login nach Abmelden' });
  pruefe(!(await sichtbar('#navigation')), 'Navigation nach Abmelden verborgen');
  await c.tippe('#login-name', 'vize');
  await c.tippe('#login-passwort', PASSWORT);
  await c.klick('#login-knopf');
  await c.warteAuf(() => document.querySelector('#ansicht-start .kachel'), { text: 'Startseite vize' });
  await ruhe();
  gleich(await text('#wer'), 'Angemeldet als vize', 'Kopf vize');
  pruefe(!(await sichtbar('#nav-einstellungen')), 'Kein Reiter Einstellungen');
  // Mitarbeiter: nur lesen
  await reiter('mitarbeiter');
  gleich(await anzahl('#ma-liste button.primaer'), 0, 'Kein „Neuer Mitarbeiter“');
  gleich(await anzahl('#ma-karte button[type="submit"]'), 0, 'Keine Speichern-Knöpfe');
  gleich(await anzahl('#ma-liste .ma-pfeile'), 0, 'Keine ▲/▼');
  pruefe(await c.werte(() => [...document.querySelectorAll('#ma-karte input, #ma-karte select, #ma-karte textarea')].every((e) => e.disabled)), 'Alle Felder gesperrt');
  // Abwesenheiten: malen geht
  await reiter('abwesenheiten');
  await abwMonat('November 2026');
  await abwChip('U');
  await abwZiehen(ID[8], '2026-11-30', '2026-11-30');
  await ruhe();
  gleich((await abwesenheiten(ID[8], '2026-11-30', '2026-11-30')).map((a) => a.code), ['U'], 'DB: Stellvertretung trägt U ein');
  // abgelehnter Wunsch: Hinweis statt Knöpfe
  await abwChip('Ansehen');
  await c.klick(abwZelle(ID[6], '2026-11-24'));
  await warteDialog('Urlaubswunsch');
  pruefe((await c.werte(() => document.querySelector('dialog[open]').innerText)).includes('Nur die Filialleitung kann Wünsche genehmigen oder ablehnen.'), 'Hinweis nur Leitung');
  gleich(await c.werte(() => [...document.querySelectorAll('dialog[open] button')].map((b) => b.textContent)), ['Abbrechen'], 'Nur „Abbrechen“');
  await dialogZu();
  // Einsatzplan: malen geht
  await epTag(FR);
  await pinsel('KA');
  await epStrich(NICO, '08:00', '09:30');
  gleich(await bloecke(NICO, FR), ['KA 08:00-10:00'], 'DB: Stellvertretung malt');
  // Vorausplanung: Eingaben frei
  await reiter('vorausplanung');
  pruefe(await c.werte(() => [...document.querySelectorAll('#ansicht-vorausplanung input')].every((e) => !e.disabled)), 'Vorausplanung beschreibbar');
  await reiter('start');
  pruefe((await anzahl('#ansicht-start .kachel')) === 6, 'Startseite mit sechs Kacheln');
});

// ================================================================ Stufe 2: IST-Erfassung und Zeitkonto
// Ab hier ist heute = Mo 16.11.2026 (KW 47), in der Datenbank (pep.heute) und im Browser (feste Uhr, ab dem nächsten
// Laden). Start der IST-Erfassung ist IST_AB = Mo 02.11. (KW 45, daten.mjs): KW 45 und KW 46 sind vorbei und lassen
// sich bestätigen und abschließen, KW 44 liegt vor dem Start. Die Szenarien bauen aufeinander auf (Bestätigen →
// Abschluss → Korrektur → Ausdrucke); Vorbereitungen per RPC sind wiederholbar, damit auch ein gefilterter Lauf geht.
await sql("select set_config('pep.heute', $1, false)", [HEUTE_IST]);
await c.uhr(HEUTE_IST);
const K45 = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];

async function alsBenutzer(name) {
  if (await sichtbar('#abmelden')) {
    await c.klick('#abmelden');
    await c.warteAuf(() => !document.getElementById('ansicht-login').hidden, { text: 'Login nach Abmelden' });
  }
  await anmelden(name); // lädt die Seite neu: die Uhr des Browsers steht danach auf HEUTE_IST
  gleich(await text('#wer'), `Angemeldet als ${name}`, 'Angemeldet');
}
const istBloecke = async (mid, datum) => (await sql(
  `select b.kuerzel || ' ' || to_char(i.von, 'HH24:MI') || '-' || to_char(i.bis, 'HH24:MI') as x
     from pep.ist_bloecke i join pep.bereiche b on b.id = i.bereich_id
    where i.mitarbeiter_id = $1 and i.datum = $2::date order by i.von`, [mid, datum])).map((r) => r.x);
const offeneZeilen = async (von, bis = von) => sql(
  `select z.mitarbeiter_id as id, z.datum::text as datum from pep.ist_zeilen($1, $2::date, $3::date, null) z
    where z.bestaetigt_am is null order by z.datum, z.mitarbeiter_id`, [B.fil, von, bis]);
const journalDB = async (mid) => sql(`select art, stunden::float as stunden, datum::text as datum, grund
  from pep.zeitkonto_buchungen where mitarbeiter_id = $1 order by id`, [mid]);
const abschluesse = async () => (await sql('select montag::text as m from pep.wochen_abschluesse order by montag')).map((r) => r.m);
const istStatus = (mid) => text(`#ansicht-einsatzplan tr[data-mitarbeiter="${mid}"] .ist-status span`);
const rpcSeit = (n, funktion) => s.aufrufe.slice(n).filter((a) => a.funktion === funktion);
// Alle offenen Zeilen dieser Tage bestätigen (wie „Tag bestätigen“, Vorbereitung ohne Oberfläche).
async function bestaetigeTage(tage) {
  for (const d of tage) {
    const r = await s.rpc('pep_ist_bestaetigen', { p_datum: d, p_mitarbeiter_ids: null }, B.leitung);
    if (r.status !== 200) throw new Error(`pep_ist_bestaetigen ${d}: ${r.json?.message}`);
  }
}
// Einsatzplan im Modus IST an diesem Tag.
async function istTag(datum) {
  await epTag(datum);
  if (await c.werte(() => document.querySelector('#ansicht-einsatzplan [data-modus="ist"]')?.getAttribute('aria-pressed') !== 'true')) {
    await c.klick('#ansicht-einsatzplan [data-modus="ist"]');
    await ruhe();
  }
  await c.warteAuf((d) => document.querySelector('#ansicht-einsatzplan [data-modus="ist"]')?.getAttribute('aria-pressed') === 'true'
    && document.querySelector('#ansicht-einsatzplan .ep-datum')?.value === d, { text: `IST ${datum}` }, datum);
}
// Die Meldung unten (Toast, z. B. „Rückgängig: …“) kann einen Knopf verdecken; vor einem Klick dorthin ausblenden.
const toastWeg = () => c.werte(() => { document.getElementById('toast').hidden = true; });
// abgeschlossen_am ist die echte Uhrzeit des Servers (now()), nicht pep.heute(): Datum wie der Browser es zeigt.
const abschlussDatum = async (montag) => c.werte((iso) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  (await sql('select abgeschlossen_am as a from pep.wochen_abschluesse where montag = $1::date', [montag]))[0].a.toISOString());
const rueckgaengigKlick = () => c.klick({ text: 'Rückgängig', in: '#ansicht-einsatzplan .ep-knoepfe', sel: 'button' });
const zkWoche = () => text('#ansicht-zeitkonto .monatsname');
const zkKnopf = () => c.werte(() => {
  const k = [...document.querySelectorAll('#ansicht-zeitkonto button')].find((b) => b.textContent === 'Woche buchen');
  return k ? (k.disabled ? 'aus' : 'an') : 'fehlt';
});
async function zkBlaettern(richtung) {
  await c.klick(`#ansicht-zeitkonto [aria-label="${richtung < 0 ? 'Eine Woche zurück' : 'Eine Woche weiter'}"]`);
  await ruhe();
}
const oben = 'dialog[open]:last-of-type'; // der oberste von zwei Dialogen (Buchung über dem Journal)
const obenKnopf = async (beschriftung) => { await c.klick({ text: beschriftung, in: oben, sel: 'button', genau: true }); await ruhe(); };
const journalZeilen = () => c.werte(() => [...document.querySelectorAll('dialog[open] .zk-journal-tabelle tbody tr')]
  .map((r) => [...r.cells].slice(1, 6).map((x) => x.textContent)));
const journalKnoepfe = () => c.werte(() => [...document.querySelectorAll('dialog[open] .dialog-knoepfe button')].map((b) => b.textContent));
const zkDatum = (serie) => new Date(Date.UTC(1899, 11, 30) + Number(serie) * 86400000).toISOString().slice(0, 10);
const pdfSeiten = (pdf) => (Buffer.from(pdf.data, 'base64').toString('latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
async function blobFangen() {
  await c.werte(() => {
    window.__blobs = [];
    const echt = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => { window.__blobs.push(b); return echt(b); };
  });
}
async function blobHolen() {
  await c.warteAuf(() => window.__blobs.length > 0, { text: 'Excel-Blob' });
  const b64 = await c.werte(async () => {
    const b = window.__blobs[0];
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s1 = ''; for (const x of bytes) s1 += String.fromCharCode(x);
    return { typ: b.type, daten: btoa(s1) };
  });
  return { typ: b64.typ, puffer: Buffer.from(b64.daten, 'base64') };
}

const CEM = ID[2];
await szenario('IST: Vorschlag, Strich, Rückgängig, Tag bestätigen mit Rückfrage, Grund', async () => {
  await alsBenutzer('chef');
  await istTag(MI);
  pruefe(await sichtbar('#ansicht-einsatzplan .ist-tabelle'), 'IST-Tabelle sichtbar');
  const plan = await bloecke(CEM, MI);
  gleich(plan, ['KA 14:30-17:30', 'PA 17:30-18:00', 'KA 18:00-20:00'], 'Cem: Plan am Mittwoch');
  gleich(await istStatus(CEM), 'offen', 'Cem: Status offen');
  pruefe(await c.werte((x) => document.querySelector(x)?.classList.contains('vorschlag'), epZelle(CEM, '15:00')), 'Vorschlag aus dem Plan blass sichtbar');
  gleich(await istBloecke(CEM, MI), [], 'DB: noch kein IST');
  // Erster Strich auf der offenen Zeile startet vom Vorschlag, ohne Grund
  await pinsel('KA');
  let n = s.aufrufe.length;
  await epStrich(CEM, '20:00', '20:30');
  gleich(await istBloecke(CEM, MI), ['KA 14:30-17:30', 'PA 17:30-18:00', 'KA 18:00-21:00'], 'DB: Vorschlag + Strich');
  gleich(rpcSeit(n, 'pep_ist_malen').map((a) => [a.status, a.body.p_grund]), [[200, null]], 'pep_ist_malen ohne Grund');
  gleich(await istStatus(CEM), 'offen', 'nach dem Strich weiter offen');
  // Rückgängig setzt den Vorschlag als IST zurück (nicht „leer“)
  await rueckgaengigKlick();
  await ruhe();
  gleich(await istBloecke(CEM, MI), plan, 'Rückgängig: wieder der Vorschlag');
  gleich((await sql('select count(*)::int as n from pep.ist_leer where mitarbeiter_id = $1', [CEM]))[0].n, 0, 'kein „ausdrücklich leer“');
  // „Tag bestätigen“ fragt nach; Abbrechen lässt alles offen
  const offen = (await offeneZeilen(MI)).length;
  pruefe(offen > 5, 'Mittwoch hat offene Zeilen', offen);
  await c.klick('#ansicht-einsatzplan [data-aktion="tag-bestaetigen"]');
  gleich(await warteDialog('Tag bestätigen'), 'Tag bestätigen', 'Rückfrage');
  const frage = await text('dialog[open] p');
  pruefe(frage.includes(`${offen} offene Zeilen bestätigen? Zeilen ohne IST übernehmen den Plan-Vorschlag.`), 'Rückfrage nennt die offenen Zeilen', frage);
  pruefe(!(await c.werte(() => document.querySelector('dialog[open] .hinweis-gelb'))), 'kein „Heute wird noch gearbeitet“ (Mittwoch ist vorbei)');
  n = s.aufrufe.length;
  await dKnopf('Abbrechen');
  gleich(rpcSeit(n, 'pep_ist_bestaetigen').length, 0, 'Abbrechen: kein pep_ist_bestaetigen');
  gleich((await offeneZeilen(MI)).length, offen, 'Abbrechen: alles bleibt offen');
  await c.klick('#ansicht-einsatzplan [data-aktion="tag-bestaetigen"]');
  await warteDialog('Tag bestätigen');
  await dKnopf('Bestätigen');
  await ruhe();
  gleich((await offeneZeilen(MI)).length, 0, 'DB: nichts mehr offen');
  gleich((await meldungen()).toast, `11.11.2026: ${offen} Zeilen bestätigt`, 'Toast');
  gleich(await istBloecke(CEM, MI), plan, 'Cem: Vorschlag als IST geschrieben');
  gleich(await c.werte(() => [...document.querySelectorAll('#ansicht-einsatzplan .ist-status span')].filter((x) => x.textContent.startsWith('offen')).length),
    0, 'Oberfläche: keine Zeile mehr offen');
  pruefe(await c.werte(() => document.querySelector('#ansicht-einsatzplan [data-aktion="tag-bestaetigen"]').disabled), '„Tag bestätigen“ danach gesperrt');
  gleich(await istStatus(CEM), 'bestätigt ✓', 'Cem bestätigt');
  // Strich auf der bestätigten Zeile verlangt einen Grund; Abbrechen sendet nichts, leer wird abgelehnt
  n = s.aufrufe.length;
  await epStrich(CEM, '20:00', '20:30');
  await warteDialog('Grund der Änderung');
  pruefe((await text('dialog[open] .ist-grund-hinweis'))?.startsWith('Bestätigte Tage werden mit Grund geändert.'), 'allgemeiner Hinweis (KW 46 offen)',
    await text('dialog[open] .ist-grund-hinweis'));
  await dKnopf('Abbrechen');
  gleich(rpcSeit(n, 'pep_ist_malen').length, 0, 'Abbrechen: kein pep_ist_malen');
  gleich(await istBloecke(CEM, MI), plan, 'Abbrechen: DB unverändert');
  await epStrich(CEM, '20:00', '20:30');
  await warteDialog('Grund der Änderung');
  await dKnopf('Weiter');
  pruefe((await dFehler()).startsWith('Bitte einen Grund angeben.'), 'leerer Grund abgelehnt', await dFehler());
  await c.tippe('dialog[open] input', 'Kasse länger besetzt', { enter: true });
  await ruhe();
  gleich(await istBloecke(CEM, MI), ['KA 14:30-17:30', 'PA 17:30-18:00', 'KA 18:00-21:00'], 'DB: Strich mit Grund gespeichert');
  gleich(rpcSeit(n, 'pep_ist_malen').map((a) => [a.status, a.body.p_grund]), [[200, 'Kasse länger besetzt']], 'pep_ist_malen mit Grund');
  gleich(await istStatus(CEM), 'bestätigt ✓', 'bleibt bestätigt');
  // Rückgängig schickt denselben Grund
  n = s.aufrufe.length;
  await rueckgaengigKlick();
  await ruhe();
  gleich(rpcSeit(n, 'pep_ist_zeile_setzen').map((a) => [a.status, a.body.p_grund]), [[200, 'Kasse länger besetzt']], 'Rückgängig mit Grund');
  gleich(await istBloecke(CEM, MI), plan, 'Rückgängig: wieder wie bestätigt');
});

await szenario('IST: Strich per Touch und Zeile bestätigen (Tablet), Zeitkonto ohne Querscrollen', async () => {
  const dana = ID[3];
  await c.tablet(true);
  await pause(300);
  try {
    await istTag(DI);
    gleich(await bloecke(dana, DI), ['KA 16:00-20:00'], 'Dana: Plan am Dienstag');
    await pinsel('KA');
    await epStrich(dana, '20:00', '20:30', { touch: true });
    gleich(await istBloecke(dana, DI), ['KA 16:00-21:00'], 'DB nach Touch-Strich');
    await c.klick(`#ansicht-einsatzplan tr[data-mitarbeiter="${dana}"] .ist-ok-knopf`);
    await ruhe();
    gleich(await istStatus(dana), 'bestätigt ✓', 'Dana per ✓ bestätigt');
    gleich((await sql('select count(*)::int as n from pep.ist_tage where mitarbeiter_id = $1 and datum = $2::date', [dana, DI]))[0].n, 1, 'DB: ist_tage Dana');
    await c.foto(`${FOTOS}ist-tablet.png`);
    await c.tippeTouch('[data-ziel="zeitkonto"]');
    await ruhe();
    pruefe(await sichtbar('#ansicht-zeitkonto .zk-tabelle'), 'Zeitkonto per Touch');
    const quer = await c.werte(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    pruefe(quer <= 0, 'Zeitkonto: Seite scrollt nicht quer', `${quer}px Überstand`);
    await c.foto(`${FOTOS}zeitkonto-tablet.png`);
  } finally {
    await c.tablet(false);
    await pause(300);
  }
});

await szenario('IST: Rückgängig aus der Plan-Ansicht fragt nach dem Grund (GRUND_FEHLT)', async () => {
  const hanna = ID[7];
  await istTag(DI);
  const plan = await bloecke(hanna, DI);
  gleich(plan, ['TS 12:00-16:00', 'PA 16:00-16:30', 'TK 16:30-20:00'], 'Hanna: Plan am Dienstag');
  await pinsel('TK');
  await epStrich(hanna, '20:00', '20:30');
  gleich(await istBloecke(hanna, DI), ['TS 12:00-16:00', 'PA 16:00-16:30', 'TK 16:30-21:00'], 'DB: Strich auf offener Zeile');
  await c.klick(`#ansicht-einsatzplan tr[data-mitarbeiter="${hanna}"] .ist-ok-knopf`);
  await ruhe();
  gleich(await istStatus(hanna), 'bestätigt ✓', 'Zeile danach bestätigt');
  await c.klick('#ansicht-einsatzplan [data-modus="plan"]');
  await ruhe();
  pruefe(await sichtbar('#ansicht-einsatzplan td[data-kommentar]'), 'Plan-Ansicht geladen');
  // Erstes Rückgängig: Server verlangt den Grund (400 GRUND_FEHLT), dann der Dialog; Abbrechen lässt den Eintrag stehen
  let n = s.aufrufe.length;
  await rueckgaengigKlick();
  await warteDialog('Grund der Änderung');
  gleich(rpcSeit(n, 'pep_ist_zeile_setzen').map((a) => [a.status, a.fehler]), [[400, 'GRUND_FEHLT']], 'erst GRUND_FEHLT vom Server');
  await dKnopf('Abbrechen');
  pruefe(!(await c.werte(() => [...document.querySelectorAll('#ansicht-einsatzplan .ep-knoepfe button')].find((b) => b.textContent.includes('Rückgängig')).disabled)),
    'Abbrechen: Rückgängig bleibt möglich');
  gleich(await istBloecke(hanna, DI), ['TS 12:00-16:00', 'PA 16:00-16:30', 'TK 16:30-21:00'], 'Abbrechen: DB unverändert');
  // Zweites Rückgängig: Grund eingeben, Wiederholung mit Grund
  n = s.aufrufe.length;
  await rueckgaengigKlick();
  await warteDialog('Grund der Änderung');
  await c.tippe('dialog[open] input', 'Nachtrag Rückgängig', { enter: true });
  await ruhe();
  gleich(rpcSeit(n, 'pep_ist_zeile_setzen').map((a) => [a.status, a.body.p_grund]), [[400, null], [200, 'Nachtrag Rückgängig']], 'Wiederholung mit Grund');
  gleich(await istBloecke(hanna, DI), plan, 'DB: Hanna zurück');
  gleich(await c.werte(() => document.querySelector('#ansicht-einsatzplan [data-modus="ist"]').getAttribute('aria-pressed')), 'true', 'Ansicht wechselt in den IST');
  gleich(await istStatus(hanna), 'bestätigt ✓', 'bleibt bestätigt');
}, { erlaubeHttp: ['GRUND_FEHLT'] });

await szenario('Startseite: Kachel „IST offen“ springt auf den ersten offenen Tag', async () => {
  await bestaetigeTage([K45[0]]); // Montag 02.11. bestätigt: der erste offene Tag ist dann nicht der Montag
  await reiter('start');
  const db = (await sql(`select count(distinct z.datum)::int as tage, count(*)::int as zeilen, min(z.datum)::text as erster
    from pep.ist_zeilen($1, $2::date - 42, $2::date - 1, null) z where z.bestaetigt_am is null`, [B.fil, HEUTE_IST]))[0];
  gleich(db.erster, K45[1], 'DB: erster offener Tag Di 03.11.');
  const k = await c.werte(() => {
    const e = [...document.querySelectorAll('#ansicht-start .kachel')].find((x) => x.querySelector('h2').textContent === 'IST offen');
    return { zahl: e.querySelector('.kachel-zahl').firstChild.textContent, text: e.textContent, sprung: e.querySelector('.kachel-sprung').textContent };
  });
  gleich(Number(k.zahl), db.tage, 'Kachel: Zahl der offenen Tage = DB');
  pruefe(k.text.includes(`${db.zeilen} offene Zeilen, die früheste am Di 03.11.`), 'Kachel nennt Zeilen und frühesten Tag', k.text);
  gleich(k.sprung, 'IST Di 03.11. →', 'Sprung-Beschriftung');
  await toastWeg();
  await c.klick('#ansicht-start .kachel:nth-child(5) .kachel-sprung');
  await ruhe();
  pruefe(await sichtbar('#ansicht-einsatzplan .ist-tabelle'), 'Einsatzplan im IST');
  gleich(await c.werte(() => document.querySelector('#ansicht-einsatzplan [data-modus="ist"]').getAttribute('aria-pressed')), 'true', 'Modus IST');
  gleich(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-datum').value), db.erster, 'Tag = erster offener Tag');
  gleich(await text('#ansicht-einsatzplan .ep-kw'), 'KW 45', 'KW 45');
});

await szenario('Zeitkonto: offene Tage sperren „Woche buchen“, Woche vor dem Start, Sprung zum offenen Tag', async () => {
  const dana = ID[3];
  await reiter('zeitkonto');
  gleich(await zkWoche(), 'KW 46/2026', 'Start in der Vorwoche KW 46');
  const offen46 = await offeneZeilen(TAGE[0], '2026-11-15');
  pruefe(offen46.length > 0, 'KW 46 hat offene Zeilen', offen46.length);
  gleich(await zkKnopf(), 'aus', '„Woche buchen“ gesperrt');
  gleich(await text('#ansicht-zeitkonto .zk-status-zeile .zk-offen'), `${offen46.length} Tage im IST offen`, 'Chip nennt die offenen Tage (Mitarbeiter-Tage)');
  pruefe((await text('#ansicht-zeitkonto .zk-status-zeile'))?.includes('Erst alle Tage im IST bestätigen, dann die Woche buchen.'), 'Hinweis bestätigen');
  // Spalte „Offen“ springt auf den ersten offenen Tag der Person (Dana: Mo KM, Di und Mi bestätigt → Do)
  const erster = offen46.find((z) => z.id === dana)?.datum;
  gleich(erster, DO, 'DB: Danas erster offener Tag Do 12.11.');
  await c.klick(`#ansicht-zeitkonto tr[data-mitarbeiter="${dana}"] .zk-offen`);
  await ruhe();
  pruefe(await sichtbar('#ansicht-einsatzplan .ist-tabelle'), 'Sprung in den IST');
  gleich(await c.werte(() => document.querySelector('#ansicht-einsatzplan .ep-datum').value), erster, 'Sprung auf Danas ersten offenen Tag');
  // Vor dem Start der IST-Erfassung: im IST nur der Plan
  await istTag('2026-10-30');
  pruefe((await text('#ansicht-einsatzplan .ep-geschlossen h2'))?.includes('vor dem Start der IST-Erfassung'), 'IST am 30.10.: vor dem Start',
    await text('#ansicht-einsatzplan .ep-geschlossen h2'));
  gleich((await texte('#ansicht-einsatzplan .ep-tag small')).slice(0, 6), ['nur Plan', 'nur Plan', 'nur Plan', 'nur Plan', 'nur Plan', 'nur Plan'], 'KW 44: Tage „nur Plan“');
  // Zeitkonto KW 45 (offen) und KW 44 (vor dem Start)
  await reiter('zeitkonto');
  await zkBlaettern(-1);
  gleich(await zkWoche(), 'KW 45/2026', 'KW 45');
  gleich(await zkKnopf(), 'aus', 'KW 45: gesperrt (offene Tage)');
  await zkBlaettern(-1);
  gleich(await zkWoche(), 'KW 44/2026', 'KW 44');
  gleich(await zkKnopf(), 'aus', 'KW 44: „Woche buchen“ gesperrt');
  pruefe((await text('#ansicht-zeitkonto .zk-status-zeile'))?.includes('Vor dem Start der IST-Erfassung (02.11.2026) – diese Woche wird nicht gebucht.'),
    'KW 44: Hinweis vor dem Start', await text('#ansicht-zeitkonto .zk-status-zeile'));
  gleich(await texte('#ansicht-zeitkonto .zk-vorlaeufig-marke'), ['nicht gebucht', 'ohne Diff'], 'KW 44: Diff nicht gebucht, Saldo ohne Diff');
  await c.klick({ text: 'Vorwoche', in: '#ansicht-zeitkonto', sel: 'button', genau: true });
  await ruhe();
  gleich(await zkWoche(), 'KW 46/2026', '„Vorwoche“ → KW 46');
});

const BEN = ID[1];
await szenario('Zeitkonto: Startsaldo, erster Abschluss nur in der Startwoche, Hinweis, Einstellungen fest', async () => {
  await bestaetigeTage([...K45, ...TAGE]);
  gleich((await offeneZeilen(K45[0], '2026-11-15')).length, 0, 'Vorbereitung: KW 45 und 46 bestätigt');
  await reiter('zeitkonto');
  await c.klick({ text: 'Vorwoche', in: '#ansicht-zeitkonto', sel: 'button', genau: true });
  await ruhe();
  gleich(await zkWoche(), 'KW 46/2026', 'KW 46');
  gleich(await zkKnopf(), 'an', 'KW 46: „Woche buchen“ frei');
  // KW 46 zuerst: Server lehnt ab, die Startwoche ist KW 45
  await c.klick({ text: 'Woche buchen', in: '#ansicht-zeitkonto', sel: 'button', genau: true });
  gleich(await warteDialog('abschließen'), 'KW 46/2026 abschließen', 'Rückfrage KW 46');
  pruefe((await text('dialog[open] .zk-erster'))?.startsWith('Erster Wochenabschluss: Startsalden'), 'Hinweis Startsalden (noch nichts abgeschlossen)');
  await dKnopf('Woche buchen');
  pruefe((await dFehler()).startsWith('Wochen lassen sich nur der Reihe nach abschließen: zuerst die Woche, in der die IST-Erfassung startet'),
    'VORWOCHE_OFFEN im Dialog', await dFehler());
  gleich(await abschluesse(), [], 'DB: kein Abschluss');
  await dialogZu();
  // Startsaldo vor dem ersten Abschluss (Journal Ben, KW 45 angezeigt → Sonntag davor)
  await zkBlaettern(-1);
  gleich(await zkWoche(), 'KW 45/2026', 'KW 45');
  await c.klick(`#ansicht-zeitkonto tr[data-mitarbeiter="${BEN}"] .zk-name`);
  gleich(await warteDialog('Zeitkonto: Muster, Ben'), 'Zeitkonto: Muster, Ben', 'Journal Ben');
  await ruhe();
  pruefe((await text('dialog[open] .zk-journal'))?.includes('Noch keine Buchungen.'), 'Journal leer');
  gleich(await journalKnoepfe(), ['Startsaldo', 'Korrektur buchen', 'Schließen'], 'Leitung: Startsaldo und Korrektur');
  await c.klick({ text: 'Startsaldo', in: 'dialog[open] .dialog-knoepfe', sel: 'button', genau: true });
  await c.warteAuf((x) => document.querySelector(`${x} h2`)?.textContent === 'Startsaldo: Muster, Ben', { text: 'Startsaldo-Dialog' }, oben);
  gleich(await c.werte((x) => document.querySelector(`${x} input[type="date"]`).value, oben), '2026-11-01', 'Datum: Sonntag vor KW 45');
  await c.tippe(`${oben} input.zk-stunden`, '100');
  await c.tippe(`${oben} input[maxlength="200"]`, 'Übernahme aus der bisherigen Zeiterfassung');
  await obenKnopf('Buchen');
  gleich((await meldungen()).toast, 'Gebucht.', 'Toast');
  gleich(await journalDB(BEN), [{ art: 'start', stunden: 100, datum: '2026-11-01', grund: 'Übernahme aus der bisherigen Zeiterfassung' }], 'DB: Startsaldo');
  gleich(await journalZeilen(), [['KW 44/2026', 'Startsaldo', '+100,00', '+100,00', 'Übernahme aus der bisherigen Zeiterfassung']], 'Journal: Startsaldo');
  gleich(await journalKnoepfe(), ['Korrektur buchen', 'Schließen'], 'danach kein Startsaldo-Knopf');
  await dialogZu();
  gleich(await text(`#ansicht-zeitkonto tr[data-mitarbeiter="${BEN}"] td:nth-of-type(7)`), '+100,00', 'Tabelle: Saldo Vorwoche Ben');
  const anna = await s.rpc('pep_zeitkonto_buchen', { p_mitarbeiter_id: ID[0], p_art: 'start', p_stunden: -20, p_grund: 'Übernahme', p_datum: '2026-11-01' }, B.leitung);
  gleich(anna.status, 200, 'Vorbereitung: Startsaldo Anna −20 (RPC)');
  // Erster Abschluss: KW 45 (Startwoche)
  await zkBlaettern(1);
  await zkBlaettern(-1);
  gleich(await zkKnopf(), 'an', 'KW 45: „Woche buchen“ frei');
  await c.klick({ text: 'Woche buchen', in: '#ansicht-zeitkonto', sel: 'button', genau: true });
  gleich(await warteDialog('abschließen'), 'KW 45/2026 abschließen', 'Rückfrage KW 45');
  pruefe(await sichtbar('dialog[open] .zk-erster'), 'Hinweis Startsalden beim ersten Abschluss');
  await c.foto(`${FOTOS}zeitkonto-erster-abschluss.png`);
  await dKnopf('Woche buchen');
  const n45 = (await sql("select count(*)::int as n from pep.zeitkonto_buchungen where art = 'woche' and datum = '2026-11-02'"))[0].n;
  pruefe(n45 >= 14, 'DB: Zeile „woche“ je Mitarbeiter mit Vertrag', n45);
  gleich((await meldungen()).toast, `KW 45/2026 abgeschlossen: ${n45} Buchungen.`, 'Toast Abschluss');
  gleich(await abschluesse(), ['2026-11-02'], 'DB: KW 45 abgeschlossen');
  const kopf = await text('#ansicht-zeitkonto .zk-gebucht');
  pruefe(kopf?.startsWith(`✓ Abgeschlossen am ${await abschlussDatum(K45[0])} um`) && kopf.endsWith('von chef'), 'Kopf: abgeschlossen von chef', kopf);
  // Einstellungen: Start der IST-Erfassung jetzt fest
  await reiter('einstellungen');
  const feld = await feldUnter('#ansicht-einstellungen', 'IST-Erfassung ab');
  gleich(await c.werte((x) => [document.querySelector(x).value, document.querySelector(x).disabled], feld), [IST_AB, true], 'Feld „IST-Erfassung ab“ gesperrt');
  pruefe((await c.werte(() => document.getElementById('ansicht-einstellungen').textContent))
    .includes('Nach dem ersten Wochenabschluss lässt sich der Start der IST-Erfassung nicht mehr ändern.'), 'Hinweis IST_AB_FEST');
  // Zweiter Abschluss: KW 46, Vorwoche abgeschlossen → kein Startsaldo-Hinweis
  await reiter('zeitkonto');
  await zkBlaettern(1);
  gleich(await zkWoche(), 'KW 46/2026', 'KW 46');
  await c.klick({ text: 'Woche buchen', in: '#ansicht-zeitkonto', sel: 'button', genau: true });
  gleich(await warteDialog('abschließen'), 'KW 46/2026 abschließen', 'Rückfrage KW 46');
  await ruhe();
  gleich(await anzahl('dialog[open] .zk-erster'), 0, 'kein Startsaldo-Hinweis nach dem ersten Abschluss');
  await dKnopf('Woche buchen');
  gleich(await abschluesse(), ['2026-11-02', '2026-11-09'], 'DB: KW 46 abgeschlossen');
  pruefe((await meldungen()).toast.startsWith('KW 46/2026 abgeschlossen:'), 'Toast KW 46', (await meldungen()).toast);
}, { erlaubeHttp: ['VORWOCHE_OFFEN'] });

await szenario('Zeitkonto: automatische Korrektur nach IST-Änderung im Journal, Korrektur von Hand', async () => {
  const vorher = await journalDB(CEM);
  // IST in der abgeschlossenen KW 46 ändern: Grund-Dialog nennt die Nachbuchung
  await istTag(MI);
  gleich(await istStatus(CEM), 'bestätigt ✓', 'Cem bestätigt');
  await pinsel('KA');
  await epStrich(CEM, '20:00', '20:30');
  await warteDialog('Grund der Änderung');
  await c.warteAuf(() => document.querySelector('dialog[open] .ist-grund-hinweis')?.textContent
    === 'Die Woche ist schon abgeschlossen – die Änderung wird im Zeitkonto nachgebucht.', { text: 'Hinweis Woche abgeschlossen' });
  await c.tippe('dialog[open] input', 'Inventur länger', { enter: true });
  await ruhe();
  gleich(await istBloecke(CEM, MI), ['KA 14:30-17:30', 'PA 17:30-18:00', 'KA 18:00-21:00'], 'DB: IST geändert');
  const neu = (await journalDB(CEM)).slice(vorher.length);
  gleich(neu, [{ art: 'korrektur', stunden: 1, datum: TAGE[0], grund: 'KW 46/2026: Inventur länger' }], 'DB: genau eine automatische Korrektur +1');
  // Journal im Reiter Zeitkonto
  await reiter('zeitkonto');
  gleich(await zkWoche(), 'KW 46/2026', 'KW 46');
  await c.klick(`#ansicht-zeitkonto tr[data-mitarbeiter="${CEM}"] .zk-name`);
  await warteDialog('Zeitkonto: Beispiel, Cem');
  await ruhe();
  const zeilen = await journalZeilen();
  gleich(zeilen.length, vorher.length + 1, 'Journal: alle Buchungen');
  gleich(zeilen.map((z) => z[1]), ['Wochenabschluss', 'Wochenabschluss', 'Korrektur (automatisch)'], 'Journal: Arten in Buchungsreihenfolge');
  gleich(zeilen[2].slice(0, 3).concat(zeilen[2][4]), ['KW 46/2026', 'Korrektur (automatisch)', '+1,00', 'KW 46/2026: Inventur länger'], 'Journal: Korrektur mit Grund „KW 46/2026: …“');
  // Korrektur von Hand
  await c.klick({ text: 'Korrektur buchen', in: 'dialog[open] .dialog-knoepfe', sel: 'button', genau: true });
  await c.warteAuf((x) => document.querySelector(`${x} h2`)?.textContent === 'Korrektur buchen: Beispiel, Cem', { text: 'Korrektur-Dialog' }, oben);
  gleich(await c.werte((x) => document.querySelector(`${x} input[type="date"]`).value, oben), HEUTE_IST, 'Datum: heute');
  await c.tippe(`${oben} input.zk-stunden`, '−2,5');
  await c.tippe(`${oben} input[maxlength="200"]`, 'Überstunden ausgezahlt');
  await obenKnopf('Buchen');
  const db = await journalDB(CEM);
  gleich(db.at(-1), { art: 'manuell', stunden: -2.5, datum: HEUTE_IST, grund: 'Überstunden ausgezahlt' }, 'DB: Korrektur von Hand');
  const letzte = (await journalZeilen()).at(-1);
  gleich([letzte[0], letzte[1], letzte[2], letzte[4]], ['KW 47/2026', 'Korrektur von Hand', '−2,50', 'Überstunden ausgezahlt'], 'Journal: Korrektur von Hand');
  const summe = db.reduce((x, b) => x + b.stunden, 0);
  pruefe(Math.abs(zahlDE(await text('dialog[open] .zk-saldo strong')) - summe) < 0.005, `Journal-Saldo = Summe der Buchungen (${summe})`, await text('dialog[open] .zk-saldo strong'));
  await c.foto(`${FOTOS}zeitkonto-journal.png`);
  await dialogZu();
});

await szenario('Startseite: Kachel „Zeitkonto auffällig“ springt ins Zeitkonto, „IST offen“ ohne Befund', async () => {
  await reiter('start');
  const kachel = (titel) => c.werte((t) => {
    const e = [...document.querySelectorAll('#ansicht-start .kachel')].find((x) => x.querySelector('h2').textContent === t);
    return { gruen: e.classList.contains('gruen'), zahl: e.querySelector('.kachel-zahl').firstChild.textContent,
      zeitraum: e.querySelector('.kachel-zeitraum').textContent, liste: [...e.querySelectorAll('.kachel-liste li')].map((l) => l.textContent),
      sprung: e.querySelector('.kachel-sprung').textContent };
  }, titel);
  const ist = await kachel('IST offen');
  gleich([ist.zahl, ist.gruen], ['0', true], '„IST offen“: 0 und grün');
  const zk = await kachel('Zeitkonto auffällig');
  const woche = (await s.rpc('pep_zeitkonto_woche', { p_jahr: 2026, p_kw: 46 }, B.leitung)).json;
  const warn = woche.mitarbeiter.filter((m) => m.warnung);
  gleich(zk.zeitraum, 'Stand KW 46/2026 (zuletzt abgeschlossen)', 'Stand der Kachel');
  gleich(Number(zk.zahl), warn.length, 'Zahl = Mitarbeiter mit Warnung in KW 46');
  // Die Kachel zeigt höchstens einige Namen und dann „+ n weitere“.
  const gezeigt = zk.liste.filter((l) => !l.startsWith('+ ')).map((l) => l.replace(/^⚠ /, '').split(' · ')[0]);
  const weitere = Number(/^\+ (\d+) weitere$/.exec(zk.liste.find((l) => l.startsWith('+ ')) ?? '')?.[1] ?? 0);
  pruefe(gezeigt.every((name) => warn.some((m) => m.name === name)), 'Liste: nur Mitarbeiter mit Warnung', gezeigt);
  gleich(gezeigt.length + weitere, warn.length, 'Liste + „weitere“ = alle Warnungen');
  pruefe(zk.liste.some((l) => l.startsWith('⚠ Muster, Ben · +') && l.endsWith('(zu viel Plus)')), 'Ben: zu viel Plus', zk.liste);
  pruefe(zk.liste.some((l) => l.startsWith('⚠ Test, Anna · −') && l.endsWith('(zu viel Minus)')), 'Anna: zu viel Minus', zk.liste);
  gleich(zk.sprung, 'Zeitkonto KW 46 →', 'Sprung-Beschriftung');
  await c.klick('#ansicht-start .kachel:nth-child(6) .kachel-sprung');
  await ruhe();
  pruefe(await sichtbar('#ansicht-zeitkonto .zk-tabelle'), 'Sprung → Zeitkonto');
  gleich(await zkWoche(), 'KW 46/2026', 'Zeitkonto KW 46');
  gleich(await anzahl('#ansicht-zeitkonto tbody .zk-warnung'), warn.length, 'Reiter zeigt dieselben Warnungen');
});

await szenario('Ausdrucke: Stundenblatt, Wocheneinsatz-IST, Journal als Excel', async () => {
  await reiter('zeitkonto');
  gleich(await zkWoche(), 'KW 46/2026', 'KW 46');
  await druckStub();
  // Stundenblatt aller Mitarbeiter für KW 46: eine Seite je Person, mit Unterschriften
  await c.klick('#ansicht-zeitkonto [data-aktion="zk-drucken"]');
  gleich(await warteDialog('Drucken'), 'Drucken – Zeitkonto KW 46/2026', 'Druckdialog');
  gleich(await c.werte(() => [...document.querySelectorAll('dialog[open] input[type="date"]')].map((e) => e.value)), [TAGE[0], '2026-11-15'], 'Zeitraum vorbelegt');
  await dKnopf('Stundenblatt');
  await c.warteAuf(() => document.querySelector('#ansicht-druck .dr-stundenblatt'), { text: 'Stundenblatt' });
  const blatt = (await s.rpc('pep_stundenblatt', { p_mitarbeiter_id: null, p_von: TAGE[0], p_bis: '2026-11-15' }, B.leitung)).json;
  const seiten = await anzahl('#ansicht-druck .dr-seite.dr-hoch');
  gleich(seiten, blatt.mitarbeiter.length, 'Stundenblatt: ein Blatt je Mitarbeiter (wie pep_stundenblatt)');
  gleich(await anzahl('#ansicht-druck .dr-sb-ende .dr-unterschriften'), seiten, 'je Blatt Legende und Unterschriften in einem Block');
  pruefe((await texte('#ansicht-druck .dr-person')).includes('Muster, Ben (Personalnr. 90002)'), 'Person mit Personalnummer');
  const cemZeit = await c.werte((n) => {
    const s1 = [...document.querySelectorAll('#ansicht-druck .dr-seite')].find((x) => x.querySelector('.dr-person')?.textContent.startsWith(n));
    return [...s1.querySelectorAll('.dr-stundenblatt tbody tr')].find((tr) => tr.cells[0].textContent === 'Mi 11.11.')?.textContent;
  }, 'Beispiel, Cem');
  pruefe(cemZeit?.includes('14:30') && cemZeit.includes('21:00'), 'Cem Mi 11.11.: 14:30 bis 21:00 (geändertes IST)', cemZeit);
  gleich(await c.werte(() => window.__gedruckt), 1, 'print() aufgerufen');
  const pdf = await c.sende('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${FOTOS}stundenblatt.pdf`, Buffer.from(pdf.data, 'base64'));
  gleich(pdfSeiten(pdf), seiten, 'PDF: eine Seite je Mitarbeiter (A4 hoch)');
  notiz(`PDF Stundenblatt: ${pdfSeiten(pdf)} Seiten (tests/browser/fotos/stundenblatt.pdf)`);
  await druckAufraeumen();
  // Wocheneinsatz-IST KW 46 aus dem Reiter Zeitkonto
  await c.klick('#ansicht-zeitkonto [data-aktion="zk-drucken"]');
  await warteDialog('Drucken');
  await dKnopf('Wocheneinsatz-IST KW 46');
  await c.warteAuf(() => document.querySelector('#ansicht-druck .dr-wochenist'), { text: 'Wocheneinsatz-IST' });
  const istWoche = (await s.rpc('pep_ist_woche', { p_jahr: 2026, p_kw: 46 }, B.leitung)).json;
  gleich(await anzahl('#ansicht-druck .dr-wochenist tbody tr'), istWoche.mitarbeiter.length, 'Wocheneinsatz-IST: Zeile je Mitarbeiter');
  gleich(await text('#ansicht-druck .dr-titel'), 'Wocheneinsatz-IST', 'Titel');
  const kopf = await text('#ansicht-druck .dr-kopf');
  pruefe(kopf.includes(`KW 46/2026: 09.11.2026 – 15.11.2026 · abgeschlossen am ${await abschlussDatum(TAGE[0])} von chef`), 'Kopf: Woche und Abschluss', kopf);
  const pdf2 = await c.sende('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true });
  writeFileSync(`${FOTOS}wocheneinsatz-ist.pdf`, Buffer.from(pdf2.data, 'base64'));
  gleich(pdfSeiten(pdf2), 1, 'PDF Wocheneinsatz-IST: eine Seite');
  await druckAufraeumen();
  // Derselbe Ausdruck aus dem IST-Modus des Einsatzplans
  await istTag(MI);
  await c.klick('#ansicht-einsatzplan [data-aktion="wochenist-drucken"]');
  await c.warteAuf(() => document.querySelector('#ansicht-druck .dr-wochenist'), { text: 'Wocheneinsatz-IST aus dem IST' });
  gleich(await anzahl('#ansicht-druck .dr-wochenist tbody tr'), istWoche.mitarbeiter.length, 'aus dem IST: Zeile je Mitarbeiter');
  await druckAufraeumen();
  gleich(await c.werte(() => window.__gedruckt), 3, 'print() dreimal');
  // Journal als Excel: gültige Datei, Datum als echte Datumszelle (Zahlenformat 164 dd.mm.yyyy)
  await reiter('zeitkonto');
  await blobFangen();
  await c.klick('#ansicht-zeitkonto [data-aktion="zk-journal-excel"]');
  await warteDialog('Journal als Excel');
  gleich(await c.werte(() => [...document.querySelectorAll('dialog[open] input[type="date"]')].map((e) => e.value)), ['2026-01-01', HEUTE_IST], 'Zeitraum vorbelegt');
  await dKnopf('Herunterladen');
  const { typ, puffer } = await blobHolen();
  gleich(typ, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Blob-Typ');
  writeFileSync(`${FOTOS}Zeitkonto-Journal-2026-01-01-${HEUTE_IST}.xlsx`, puffer);
  try {
    const dateien = pruefeXlsx(puffer);
    const stile = dateien['xl/styles.xml'] ?? '';
    pruefe(stile.includes('<numFmt numFmtId="164" formatCode="dd.mm.yyyy"/>'), 'styles.xml: numFmt 164 dd.mm.yyyy');
    pruefe(/<cellXfs count="4">(?:<xf[^>]*\/>|<xf[^>]*>.*?<\/xf>){3}<xf numFmtId="164"[^>]*applyNumberFormat="1"/.test(stile), 'Stil 3 nutzt numFmt 164');
    const blatt1 = dateien['xl/worksheets/sheet1.xml'] ?? '';
    const datum = [...blatt1.matchAll(/<c r="A(\d+)" s="3"><v>(\d+)<\/v><\/c>/g)].map((m) => zkDatum(m[2])).sort();
    const db = (await sql(`select datum::text as d from pep.zeitkonto_buchungen where datum between '2026-01-01' and $1::date order by datum`, [HEUTE_IST])).map((r) => r.d);
    gleich(datum, db, 'Spalte Datum: Datumszellen (Stil 3) = Buchungsdaten der DB');
    gleich((blatt1.match(/<row /g) ?? []).length, db.length + 1, 'Zeilen = Kopf + Buchungen');
    pruefe(blatt1.includes('KW 46/2026: Inventur länger'), 'Grund der automatischen Korrektur im Blatt');
    notiz(`Journal-Excel: ${db.length} Buchungen, ${Object.keys(dateien).length} Teile`);
  } catch (e) {
    pruefe(false, `xlsx gültig: ${e.message}`);
  }
});

await szenario('Stellvertretung: Zeitkonto ansehen, Journal lesen, Drucken und Excel, keine Buchungsknöpfe', async () => {
  await alsBenutzer('vize');
  pruefe(!(await sichtbar('#nav-einstellungen')), 'Kein Reiter Einstellungen');
  await reiter('zeitkonto');
  gleich(await zkWoche(), 'KW 46/2026', 'Start in KW 46');
  pruefe((await text('#ansicht-zeitkonto .zk-gebucht'))?.endsWith('von chef'), 'KW 46 abgeschlossen von chef');
  gleich(await zkKnopf(), 'fehlt', 'KW 46: kein „Woche buchen“');
  await zkBlaettern(1);
  gleich(await zkWoche(), 'KW 47/2026', 'KW 47 (laufend)');
  gleich(await zkKnopf(), 'fehlt', 'KW 47: kein „Woche buchen“');
  pruefe((await text('#ansicht-zeitkonto .zk-status-zeile'))?.includes('Noch nicht abgeschlossen (bucht die Filialleitung).'), 'Hinweis: bucht die Filialleitung');
  await zkBlaettern(-1);
  // Journal lesen, ohne Buchungsknöpfe
  await c.klick(`#ansicht-zeitkonto tr[data-mitarbeiter="${CEM}"] .zk-name`);
  await warteDialog('Zeitkonto: Beispiel, Cem');
  await ruhe();
  gleich((await journalZeilen()).length, (await journalDB(CEM)).length, 'Journal: alle Buchungen lesbar');
  gleich(await journalKnoepfe(), ['Schließen'], 'nur „Schließen“');
  await c.foto(`${FOTOS}zeitkonto-journal-stellvertretung.png`);
  await dialogZu();
  // Drucken: Stundenblatt für Cem
  await druckStub();
  await c.klick('#ansicht-zeitkonto [data-aktion="zk-drucken"]');
  await warteDialog('Drucken');
  await c.setzeWert('dialog[open] select', String(CEM));
  await dKnopf('Stundenblatt');
  await c.warteAuf(() => document.querySelector('#ansicht-druck .dr-stundenblatt'), { text: 'Stundenblatt' });
  gleich(await texte('#ansicht-druck .dr-person'), ['Beispiel, Cem (Personalnr. 90003)'], 'Stundenblatt Cem');
  gleich(await c.werte(() => window.__gedruckt), 1, 'print() aufgerufen');
  await druckAufraeumen();
  // Journal als Excel
  await blobFangen();
  await c.klick('#ansicht-zeitkonto [data-aktion="zk-journal-excel"]');
  await warteDialog('Journal als Excel');
  await dKnopf('Herunterladen');
  const { puffer } = await blobHolen();
  try {
    const dateien = pruefeXlsx(puffer);
    pruefe((dateien['xl/worksheets/sheet1.xml'] ?? '').includes('Beispiel, Cem'), 'Excel der Stellvertretung enthält das Journal');
  } catch (e) {
    pruefe(false, `xlsx gültig: ${e.message}`);
  }
  // IST: die Stellvertretung erfasst und bestätigt auch
  await istTag(HEUTE_IST);
  pruefe(await sichtbar('#ansicht-einsatzplan [data-aktion="tag-bestaetigen"]'), 'IST: „Tag bestätigen“ auch für die Stellvertretung');
});

// ================================================================ Stufe 2: Sicherung
// Herunterladen als chef (Blob abfangen: gültiges JSON, Prüfsumme wie der Server sie rechnet), dann als Leitung einer
// zweiten, leeren Filiale derselben Datenbank einspielen (Datei per DataTransfer in das Dateifeld); danach zeigt die
// zweite Filiale die Mitarbeiterliste der ersten. Umfrage, Zuordnungen und die Benutzer chef/vize gehören der ersten
// Filiale und werden ausgelassen.
await szenario('Sicherung: herunterladen, in zweite leere Filiale einspielen, Mitarbeiterliste erscheint', async () => {
  if (!(await sql("select 1 from urlaub.organisatoren where benutzername = 'zweit'")).length) {
    await sql("insert into urlaub.organisatoren (user_id, anzeigename, benutzername) values (gen_random_uuid(), 'zweit', 'zweit')");
    await sql("select pep.start_leitung('zweit')");
    const uid = (await sql("select user_id from urlaub.organisatoren where benutzername = 'zweit'"))[0].user_id;
    const r = await s.rpc('pep_filiale_anlegen', { p_name: 'Netto Zweitfiliale', p_nummer: '9999', p_bundesland: 'BY' }, uid);
    if (r.status !== 200) throw new Error(`pep_filiale_anlegen: ${r.json?.message}`);
  }
  const zweitFil = (await sql(`select b.filiale_id as f from pep.benutzer b join urlaub.organisatoren o on o.user_id = b.user_id
    where o.benutzername = 'zweit'`))[0].f;
  await sql('delete from pep.sicherungen where filiale_id = $1', [B.fil]); // wiederholbar: „noch keine Sicherung“

  // Startseite der Leitung: noch keine Sicherung → gelb, Sprung zur Sicherung
  await alsBenutzer('chef');
  await reiter('start');
  const zeile = () => c.werte(() => {
    const p = document.querySelector('#ansicht-start .start-sicherung');
    return p ? { text: p.textContent, gelb: p.classList.contains('hinweis-gelb') } : null;
  });
  gleich(await zeile(), { text: 'Noch keine Sicherung – bitte jede Woche eine Sicherung herunterladen. Sicherung →', gelb: true },
    'Startseite ohne Sicherung');
  await c.foto(`${FOTOS}sicherung-startseite-gelb.png`);
  await c.klick({ text: 'Sicherung →', in: '#ansicht-start', sel: 'button' });
  await ruhe();
  pruefe(await sichtbar('#ansicht-einstellungen [data-aktion="sicherung-laden"]'), 'Einstellungen → Sicherung sichtbar');
  pruefe((await text('#ansicht-einstellungen')).includes('Die Datei enthält Personaldaten. Auf dem PC oder USB-Stick aufbewahren, nicht per E-Mail verschicken.'),
    'Hinweis Personaldaten');

  // Herunterladen
  await blobFangen();
  await c.werte(() => {
    window.__downloads = [];
    const klick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { window.__downloads.push(this.download); return klick.call(this); };
  });
  await c.klick('#ansicht-einstellungen [data-aktion="sicherung-laden"]');
  const { typ, puffer } = await blobHolen();
  gleich(typ, 'application/json', 'Blob-Typ');
  gleich(await c.werte(() => window.__downloads), [`PEP-Sicherung-2558-${HEUTE_IST}.json`], 'Dateiname');
  const inhalt = puffer.toString('utf8');
  const datei = JSON.parse(inhalt);
  writeFileSync(`${FOTOS}PEP-Sicherung-2558-${HEUTE_IST}.json`, puffer);
  gleich([datei.format, datei.version], ['pep-sicherung', 1], 'Format');
  gleich(datei.pruefsumme, (await sql("select md5(($1::jsonb -> 'tabellen')::text) as p", [inhalt]))[0].p, 'Prüfsumme der Datei');
  const maQuelle = (await sql('select count(*)::int as n from pep.mitarbeiter where filiale_id = $1', [B.fil]))[0].n;
  gleich(datei.anzahl.mitarbeiter, maQuelle, 'Mitarbeiter in der Datei');
  notiz(`Sicherung: ${puffer.length} Bytes, ${Object.values(datei.anzahl).reduce((x, n) => x + n, 0)} Zeilen`);
  gleich((await meldungen()).toast, 'Sicherung heruntergeladen.', 'Toast');
  // erstellt_am ist die echte Uhrzeit des Servers (now()), heute im Test aber fest HEUTE_IST (in Produktion dasselbe
  // Datum): Zeitpunkt der Sicherung auf HEUTE_IST bzw. 9 Tage davor legen.
  const sicherungAm = (tage) => sql("update pep.sicherungen set erstellt_am = ($1::date - $2::int) + time '10:00' where filiale_id = $3",
    [HEUTE_IST, tage, B.fil]);
  await sicherungAm(0);
  await reiter('start');
  gleich(await zeile(), { text: 'Letzte Sicherung heute · Sicherung →', gelb: false }, 'Startseite nach der Sicherung');
  await c.foto(`${FOTOS}sicherung-startseite-heute.png`);
  await sicherungAm(9);
  await reiter('start');
  gleich(await zeile(), { text: 'Letzte Sicherung vor 9 Tagen – bitte jede Woche eine Sicherung herunterladen. Sicherung →', gelb: true },
    'Startseite 9 Tage nach der Sicherung');
  await c.foto(`${FOTOS}sicherung-startseite-9-tage.png`);

  // Einspielen in die zweite Filiale
  await alsBenutzer('zweit');
  gleich(await text('#kopf-filiale'), 'Netto Zweitfiliale', 'Kopf vor dem Einspielen');
  await reiter('einstellungen');
  await c.werte((t) => {
    const e = document.querySelector('#ansicht-einstellungen [data-aktion="sicherung-datei"]');
    const dt = new DataTransfer();
    dt.items.add(new File([t], 'PEP-Sicherung-2558.json', { type: 'application/json' }));
    e.files = dt.files;
    e.dispatchEvent(new Event('change', { bubbles: true }));
  }, inhalt);
  await c.warteAuf(() => document.querySelector('#ansicht-einstellungen [data-ziel-leer]'), { text: 'Vorschau' });
  await ruhe();
  gleich(await c.werte(() => document.querySelector('#ansicht-einstellungen [data-ziel-leer]').dataset.zielLeer), 'ja', 'Ziel leer');
  const vorschau = await text('#ansicht-einstellungen .sicherung-vorschau');
  pruefe(vorschau.includes('Sicherung der Filiale Netto Aschaffenburg (Nr. 2558, BY)'), 'Vorschau: Filiale', vorschau);
  pruefe(vorschau.includes(`${maQuelle} Mitarbeiter`), 'Vorschau: Anzahl Mitarbeiter', vorschau);
  await c.werte(() => document.querySelector('#ansicht-einstellungen .sicherung-vorschau').closest('.box').scrollIntoView());
  await c.foto(`${FOTOS}sicherung-einstellungen-vorschau.png`);
  // Falsche Nummer, dann die richtige
  const bestaetigung = await feldUnter('#ansicht-einstellungen .sicherung-vorschau', 'Filialnummer zur Bestätigung');
  await c.tippe(bestaetigung, '9999');
  await c.klick('#ansicht-einstellungen .sicherung-vorschau button[type="submit"]');
  await ruhe();
  pruefe((await meldungen()).fehler.startsWith('Die Bestätigung stimmt nicht.'), 'Meldung bei falscher Nummer', (await meldungen()).fehler);
  gleich((await sql('select count(*)::int as n from pep.mitarbeiter where filiale_id = $1', [zweitFil]))[0].n, 0, 'nichts eingespielt');
  await c.tippe(bestaetigung, '2558');
  await c.klick('#ansicht-einstellungen .sicherung-vorschau button[type="submit"]');
  await ruhe();
  await c.warteAuf(() => document.querySelector('#ansicht-einstellungen [data-ergebnis]'), { text: 'Ergebnis' });
  gleich((await meldungen()).toast, 'Sicherung eingespielt.', 'Toast eingespielt');
  gleich(await text('#kopf-filiale'), 'Netto Aschaffenburg', 'Kopf nach dem Einspielen');
  const ergebnis = await text('#ansicht-einstellungen [data-ergebnis]');
  pruefe(ergebnis.includes(`${maQuelle} Mitarbeiter`) && ergebnis.includes('Ausgelassen:'), 'Ergebnis: eingespielt und ausgelassen', ergebnis);
  await c.werte(() => document.querySelector('#ansicht-einstellungen [data-ergebnis]').closest('.box').scrollIntoView());
  await c.foto(`${FOTOS}sicherung-einstellungen-ergebnis.png`);
  // Datenbank: gleiche Mitarbeiter und Salden, keine Vormerkung
  const salden = (f) => sql(`select m.name, coalesce(sum(k.stunden), 0)::float8 as s, count(k.id)::int as n
    from pep.mitarbeiter m left join pep.zeitkonto_buchungen k on k.mitarbeiter_id = m.id
   where m.filiale_id = $1 group by m.name order by m.name`, [f]);
  gleich(await salden(zweitFil), await salden(B.fil), 'Mitarbeiter und Salden gleich');
  gleich((await sql('select count(*)::int as n from pep.zeitkonto_vormerkungen'))[0].n, 0, 'keine Vormerkung');

  // Mitarbeiterliste der zweiten Filiale
  await reiter('mitarbeiter');
  const namen = (await sql('select name from pep.mitarbeiter where filiale_id = $1 and aktiv order by position, name', [zweitFil])).map((r) => r.name);
  const liste = await texte('#ma-liste .ma-name');
  gleich(liste.length, namen.length, 'Mitarbeiterliste: Anzahl');
  pruefe(namen.every((n, i) => (liste[i] ?? '').startsWith(n)), 'Mitarbeiterliste: Namen in Reihenfolge', liste);
  pruefe(liste.some((n) => n.startsWith('Beispiel, Cem')), 'Cem in der Liste');
  // Die Stellvertretung sieht die Zeile zur Sicherung nicht (sie kann nicht sichern)
  await alsBenutzer('vize');
  await reiter('start');
  pruefe(!(await sichtbar('#ansicht-start .start-sicherung')), 'Stellvertretung: keine Zeile zur Sicherung');
}, { erlaubeHttp: ['BESTAETIGUNG_FALSCH'] });

// ================================================================ Stufe 2: Urlaubstool aller Leitungen
// Eine zweite Leitung der Filiale („Leiterin Süd“) hat eine eigene Umfrage; ihre Teilnehmer schreiben sich „Vorname
// Nachname“ bzw. nur den Vornamen. Vor ihrer ersten Anmeldung sieht chef die Umfrage nicht (Benutzer: „noch nicht
// angemeldet“). Danach schaltet chef erst die eigene Umfrage aus (Hinweis statt Teilnehmerliste; ihre Zuordnungen
// bleiben), dann beide ein, übernimmt die Vorschläge; die Kopfzeile zählt mit. Am Ende, damit kein anderes Szenario die
// zweite Leitung sieht.
await szenario('Urlaubstool: Umfrage einer zweiten Leitung einschalten, Vorschläge übernehmen, Kopfzeile zählt', async () => {
  if (!(await sql("select 1 from urlaub.organisatoren where benutzername = 'leiterin'")).length) {
    await sql("insert into urlaub.organisatoren (user_id, anzeigename, benutzername) values (gen_random_uuid(), 'Leiterin Süd', 'leiterin')");
    const uid = (await sql("select user_id from urlaub.organisatoren where benutzername = 'leiterin'"))[0].user_id;
    await sql("insert into pep.benutzer (user_id, filiale_id, rolle) values ($1, $2, 'leitung')", [uid, B.fil]);
    const u = (await sql("insert into urlaub.umfragen (organisator_id, titel, frist) values ($1, 'Urlaub 2026 Frühschicht', now() + interval '1 day') returning id",
      [uid]))[0].id;
    await sql("select urlaub.standard_urlaubsfrage($1, 2026, 'BY')", [u]);
    for (const name of ['Cem Beispiel', 'Dana', 'Ohnetreffer, Zoe']) await sql('insert into urlaub.mitarbeiter (umfrage_id, name) values ($1, $2)', [u, name]);
  }
  const fremd = (await sql("select u.id from urlaub.umfragen u join urlaub.organisatoren o on o.user_id = u.organisator_id where o.benutzername = 'leiterin'"))[0].id;
  const maId = async (name) => (await sql('select id from pep.mitarbeiter where filiale_id = $1 and name = $2', [B.fil, name]))[0].id;
  const box = '#ansicht-einstellungen .box';
  const urlaubBox = async () => c.werte((sel) => {
    const b = [...document.querySelectorAll(sel)].find((x) => x.querySelector('h2')?.textContent === 'Urlaubstool');
    if (b) b.dataset.t = 'urlaubbox';
    return Boolean(b);
  }, box);
  // Haken „aktiv“ der Umfragezeile, deren Titel mit `titel` beginnt
  const haken = async (titel) => {
    const ok = await c.werte((t) => {
      const z = [...document.querySelectorAll('[data-t="urlaubbox"] .zeile')].find((x) => x.querySelector('.zeilentitel')?.textContent.startsWith(t));
      const k = z?.querySelector('input[type="checkbox"]');
      if (k) k.dataset.t = 'umfragehaken';
      return Boolean(k);
    }, titel);
    if (!ok) throw new Error(`Umfrage „${titel}“ nicht gefunden`);
    await c.klick('[data-t="umfragehaken"]');
    await ruhe();
    await urlaubBox();
  };
  const geschaltet = async () => (await sql('select umfrage_id from pep.urlaub_umfragen where filiale_id = $1 order by umfrage_id', [B.fil]))
    .map((r) => r.umfrage_id);
  const zaehler = () => text('[data-t="urlaubbox"] .urlaub-zaehler');
  const zeilenTitel = () => texte('[data-t="urlaubbox"] form .zeilentitel');

  // Vor ihrer ersten Anmeldung: Umfrage unsichtbar, Hinweis unter Benutzer
  await alsBenutzer('chef');
  await reiter('einstellungen');
  pruefe(await urlaubBox(), 'Abschnitt Urlaubstool');
  pruefe(!(await texte('[data-t="urlaubbox"] .zeile:not(form)')).some((z) => z.startsWith('Urlaub 2026 Frühschicht')),
    'Umfrage vor der Anmeldung der Leiterin unsichtbar');
  const benutzerTitel = () => c.werte(() => [...([...document.querySelectorAll('#ansicht-einstellungen .box')]
    .find((b) => b.querySelector('h2')?.textContent === 'Benutzer')?.querySelectorAll('form .zeilentitel') ?? [])].map((e) => e.textContent));
  pruefe((await benutzerTitel()).includes('leiterin · Leiterin Süd · noch nicht angemeldet'), 'Benutzer: „noch nicht angemeldet“', await benutzerTitel());
  // Die Leiterin meldet sich einmal an (Anzeigename statt Benutzername in der Kopfzeile, darum nicht alsBenutzer)
  await c.klick('#abmelden');
  await c.warteAuf(() => !document.getElementById('ansicht-login').hidden, { text: 'Login nach Abmelden' });
  await anmelden('leiterin');
  gleich(await text('#wer'), 'Angemeldet als Leiterin Süd', 'Angemeldet als Leiterin');
  pruefe((await sql("select b.bestaetigt_am from pep.benutzer b join urlaub.organisatoren o on o.user_id = b.user_id where o.benutzername = 'leiterin'"))[0]
    .bestaetigt_am !== null, 'DB: Leiterin bestätigt');
  await alsBenutzer('chef');
  await reiter('einstellungen');
  pruefe((await benutzerTitel()).includes('leiterin · Leiterin Süd'), 'Benutzer: nach der Anmeldung ohne Hinweis', await benutzerTitel());
  pruefe(await urlaubBox(), 'Abschnitt Urlaubstool');
  const umfrageZeilen = await texte('[data-t="urlaubbox"] .zeile:not(form)');
  pruefe(umfrageZeilen.some((z) => z.startsWith('Urlaub 2026 Frühschicht (2026)') && z.includes('von Leiterin Süd')), 'Zeile „von Leiterin Süd“', umfrageZeilen);
  pruefe(umfrageZeilen.some((z) => z.startsWith('Urlaub 2026 (2026)') && z.includes('eigene Umfrage')), 'Zeile „eigene Umfrage“', umfrageZeilen);
  pruefe((await text('[data-t="urlaubbox"]')).includes('Jeder Teilnehmer der Umfrage wird einem PEP-Mitarbeiter zugeordnet; erst dann erscheinen seine Wünsche unter Abwesenheiten zum Freigeben.'),
    'Erklärung über der Liste');

  // Eigene Umfrage aus: keine eingeschaltet → Hinweis statt Liste; die Zuordnungen von Gustav und Lea bleiben
  await haken('Urlaub 2026 (2026)');
  gleich(await geschaltet(), [], 'DB: keine Umfrage eingeschaltet');
  gleich((await sql(`select count(*)::int as n from pep.urlaub_zuordnung z join urlaub.mitarbeiter t on t.id = z.urlaub_mitarbeiter_id
    where t.umfrage_id = $1`, [B.umfrage]))[0].n, 2, 'DB: Zuordnungen der ausgeschalteten Umfrage bleiben');
  pruefe((await text('[data-t="urlaubbox"]')).includes('Zuerst oben eine Umfrage einschalten – dann erscheinen hier ihre Teilnehmer.'), 'Hinweis ohne eingeschaltete Umfrage');
  gleich(await zaehler(), null, 'keine Kopfzeile ohne eingeschaltete Umfrage');

  // Beide einschalten (die der Leiterin schaltet chef ein)
  await haken('Urlaub 2026 (2026)');
  await haken('Urlaub 2026 Frühschicht (2026)');
  gleich(await geschaltet(), [B.umfrage, fremd].sort((a, b) => a - b), 'DB: beide Umfragen eingeschaltet');
  gleich(await zaehler(), '2 von 5 zugeordnet', 'Kopfzeile vorher (Gustav und Lea wieder da)');
  gleich(await zeilenTitel(), ['Cem Beispiel', 'Dana', 'Ohnetreffer, Zoe', 'Attrappe, Lea', 'Platzhalter, Gustav'], 'nicht zugeordnete zuerst');
  await c.werte(() => document.querySelector('[data-t="urlaubbox"]').scrollIntoView());
  await c.foto(`${FOTOS}urlaubstool-vorschlaege.png`);

  // Vorschläge übernehmen: Cem (andere Reihenfolge) und Dana (nur Vorname); Zoe ohne Treffer bleibt offen
  await c.klick({ text: 'Vorschläge übernehmen (2)', in: '[data-t="urlaubbox"]', sel: 'button', genau: true });
  await ruhe();
  await urlaubBox();
  const zuordnung = await sql(`select t.name, z.mitarbeiter_id as m from urlaub.mitarbeiter t
      left join pep.urlaub_zuordnung z on z.urlaub_mitarbeiter_id = t.id where t.umfrage_id = $1 order by t.name`, [fremd]);
  gleich(zuordnung, [{ name: 'Cem Beispiel', m: await maId('Beispiel, Cem') }, { name: 'Dana', m: await maId('Probe, Dana') },
    { name: 'Ohnetreffer, Zoe', m: null }], 'DB: Zuordnung nach „Vorschläge übernehmen“');
  gleich(await sql(`select t.name, z.mitarbeiter_id as m from urlaub.mitarbeiter t
      left join pep.urlaub_zuordnung z on z.urlaub_mitarbeiter_id = t.id where t.umfrage_id = $1 order by t.name`, [B.umfrage]),
  [{ name: 'Attrappe, Lea', m: await maId('Attrappe, Lea') }, { name: 'Platzhalter, Gustav', m: await maId('Platzhalter, Gustav') }],
  'DB: Gustav und Lea weiter zugeordnet');
  gleich(await zaehler(), '4 von 5 zugeordnet', 'Kopfzeile nachher');
  gleich((await zeilenTitel())[0], 'Ohnetreffer, Zoe', 'der nicht zugeordnete steht oben');
  pruefe(!(await texte('[data-t="urlaubbox"] button')).some((t) => t.startsWith('Vorschläge übernehmen')), 'kein Knopf „Vorschläge übernehmen“ mehr');
  gleich((await meldungen()).toast, 'Gespeichert.', 'Toast');
});

// Hilfe (Task 10): „?“ auf jedem Reiter öffnet die Leiste mit den Texten der Ansicht; Escape und Klick daneben schließen,
// der Fokus kehrt zum Knopf zurück; im Modus IST eigene Texte; am Tablet bildschirmfüllend; Tipp nur beim ersten Besuch.
await szenario('Hilfe: „?“ auf jedem Reiter, Escape, Klick daneben, IST, Tablet, Tipp nur beim ersten Besuch', async () => {
  const hilfeOffen = () => c.werte(() => {
    const d = document.querySelector('dialog.hilfe-leiste[open]');
    if (!d) return null;
    return { ansicht: d.dataset.ansicht, titel: d.querySelector('h2')?.textContent,
      abschnitte: [...d.querySelectorAll('h3')].map((h) => h.textContent), schritte: d.querySelectorAll('ol li').length,
      wissen: d.querySelectorAll('ul li').length, knoepfe: [...d.querySelectorAll('button')].map((k) => k.textContent) };
  });
  const oeffne = async () => {
    await c.klick('#hilfe-knopf');
    return c.warteAuf(() => document.querySelector('dialog.hilfe-leiste[open] h2')?.textContent ?? null, { text: 'Hilfe-Leiste offen' });
  };
  const zu = () => c.warteAuf(() => !document.querySelector('dialog.hilfe-leiste'), { text: 'Hilfe-Leiste zu' });
  const fokusAufKnopf = () => c.werte(() => document.activeElement?.id === 'hilfe-knopf');

  // Tipp: Merker löschen und die Seite neu laden (anmelden), dann erscheint er je Ansicht genau einmal
  await alsBenutzer('chef');
  await c.werte(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pep-hilfe-tipp-')) localStorage.removeItem(k); });
  await anmelden('chef');
  gleich(await text('.hilfe-tipp'), 'Tipp: Das ? erklärt diese Seite', 'Tipp beim ersten Besuch der Startseite');
  gleich(await c.werte(() => getComputedStyle(document.querySelector('.hilfe-tipp')).pointerEvents), 'none', 'Tipp fängt keine Klicks ab');
  gleich(await c.werte(() => localStorage.getItem('pep-hilfe-tipp-start')), '1', 'Tipp gemerkt (localStorage)');
  await c.foto(`${FOTOS}hilfe-tipp.png`);
  await reiter('abwesenheiten');
  pruefe(await sichtbar('.hilfe-tipp'), 'Tipp beim ersten Besuch der Abwesenheiten');
  await reiter('start');
  gleich(await anzahl('.hilfe-tipp'), 0, 'kein Tipp beim zweiten Besuch der Startseite');
  await reiter('abwesenheiten');
  gleich(await anzahl('.hilfe-tipp'), 0, 'kein Tipp beim zweiten Besuch der Abwesenheiten');

  // Jeder Reiter am PC: Überschrift und Abschnitte passen, Escape schließt, Fokus zurück auf „?“
  gleich(await c.werte(() => document.getElementById('hilfe-knopf').getAttribute('aria-label')), 'Hilfe zu dieser Seite', 'aria-label');
  for (const r of ['start', 'abwesenheiten', 'vorausplanung', 'einsatzplan', 'zeitkonto', 'mitarbeiter', 'einstellungen']) {
    await reiter(r);
    await oeffne();
    const h = await hilfeOffen();
    gleich(h, { ansicht: r, titel: HILFE[r].titel, abschnitte: ['Wozu dient diese Seite', "So geht's", 'Gut zu wissen'],
      schritte: HILFE[r].schritte.length, wissen: HILFE[r].gut_zu_wissen.length, knoepfe: ['Schließen'] }, `Hilfe ${r}`);
    const breite = await c.werte(() => Math.round(document.querySelector('dialog.hilfe-leiste[open]').getBoundingClientRect().width));
    pruefe(breite > 300 && breite < 500, `${r}: Leiste am PC schmal (rechts)`, breite);
    await c.foto(`${FOTOS}hilfe-pc-${r}.png`);
    await c.taste('Escape');
    await zu();
    pruefe(await fokusAufKnopf(), `${r}: nach Escape Fokus auf „?“`);
  }

  // Tab bleibt in der Leiste und erreicht „Schließen“; Klick daneben schließt
  await oeffne();
  await c.taste('Tab');
  gleich(await c.werte(() => [document.activeElement?.textContent, Boolean(document.activeElement?.closest('dialog.hilfe-leiste'))]),
    ['Schließen', true], 'Tab erreicht „Schließen“ in der Leiste');
  await c.maus('mouseMoved', 200, 450, { button: 'none' });
  await c.maus('mousePressed', 200, 450, { buttons: 1 });
  await c.maus('mouseReleased', 200, 450, { buttons: 0 });
  await zu();
  pruefe(await fokusAufKnopf(), 'nach Klick daneben Fokus auf „?“');

  // Einsatzplan im Modus IST: eigene Texte
  await reiter('einsatzplan');
  await c.klick('#ansicht-einsatzplan [data-modus="ist"]');
  await ruhe();
  pruefe(await sichtbar('#ansicht-einsatzplan .ist-tabelle'), 'IST-Modus aktiv');
  gleich(await oeffne(), HILFE.einsatzplan_ist.titel, 'Hilfe im Modus IST');
  gleich((await hilfeOffen()).ansicht, 'einsatzplan_ist', 'Ansicht einsatzplan_ist');
  await c.foto(`${FOTOS}hilfe-pc-einsatzplan-ist.png`);
  await c.taste('Escape');
  await zu();
  await c.klick('#ansicht-einsatzplan [data-modus="plan"]');
  await ruhe();
  gleich(await oeffne(), HILFE.einsatzplan.titel, 'zurück im Plan: Plan-Hilfe');
  await c.taste('Escape');
  await zu();

  // Modus-Wechsel: die Hilfe folgt sofort dem gewünschten Modus (Woche lädt noch) und fällt mit der Ansicht zurück,
  // wenn das Laden scheitert (dann bleibt der Plan stehen).
  s.verzoegere(800);
  try {
    await c.klick('#ansicht-einsatzplan [data-modus="ist"]');
    gleich(await oeffne(), HILFE.einsatzplan_ist.titel, 'IST angeklickt, Woche lädt noch: IST-Hilfe');
    await c.taste('Escape');
    await zu();
  } finally {
    s.verzoegere(0);
  }
  await ruhe();
  await c.klick('#ansicht-einsatzplan [data-modus="plan"]');
  await ruhe();
  await c.werte(() => {
    window.__fetchVorher = window.fetch;
    window.fetch = (u, ...r) => (String(u).includes('pep_ist_woche') ? Promise.reject(new TypeError('Failed to fetch'))
      : window.__fetchVorher(u, ...r));
  });
  try {
    await c.klick('#ansicht-einsatzplan [data-modus="ist"]');
    await ruhe();
    gleich((await meldungen()).fehler, 'Keine Verbindung. Bitte prüfe dein Internet.', 'Laden des IST gescheitert: Meldung');
    pruefe(!(await sichtbar('#ansicht-einsatzplan .ist-tabelle')), 'Laden gescheitert: der Plan bleibt stehen');
    gleich(await oeffne(), HILFE.einsatzplan.titel, 'Laden gescheitert: Plan-Hilfe');
    await c.taste('Escape');
    await zu();
  } finally {
    await c.werte(() => { window.fetch = window.__fetchVorher; });
  }

  // Tablet: Leiste füllt den Bildschirm, „Schließen“ per Finger
  await c.tablet(true);
  await pause(300);
  await reiter('zeitkonto');
  await oeffne();
  const masse = await c.werte(() => {
    const r = document.querySelector('dialog.hilfe-leiste[open]').getBoundingClientRect();
    return { links: Math.round(r.left), breite: Math.round(r.width), hoehe: Math.round(r.height), fenster: [innerWidth, innerHeight] };
  });
  gleich([masse.links, masse.breite, masse.hoehe], [0, masse.fenster[0], masse.fenster[1]], 'Tablet: Leiste bildschirmfüllend');
  await c.foto(`${FOTOS}hilfe-tablet-zeitkonto.png`);
  await c.klick({ text: 'Schließen', in: 'dialog.hilfe-leiste[open]', sel: 'button', genau: true });
  await zu();
  const quer = await c.werte(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  pruefe(quer <= 0, 'Tablet: Reiterleiste mit „?“ scrollt nicht quer', `${quer}px Überstand`);
  await c.tablet(false);
  await pause(300);
});

await szenario('Zeitkonto: nach dem Abschluss angelegt → Diff grau „nicht gebucht“, nicht im Saldo und nicht in der Summe', async () => {
  // Vorbereitung (auch im gefilterten Lauf): KW 45 und KW 46 abgeschlossen
  if (!(await abschluesse()).includes(TAGE[0])) {
    await bestaetigeTage([...K45, ...TAGE]);
    for (const kw of [45, 46]) {
      if (!(await abschluesse()).includes(kw === 45 ? K45[0] : TAGE[0])) {
        const r = await s.rpc('pep_wochenabschluss', { p_jahr: 2026, p_kw: kw }, B.leitung);
        if (r.status !== 200) throw new Error(`pep_wochenabschluss KW ${kw}: ${r.json?.message}`);
      }
    }
  }
  const nils = (await s.rpc('pep_mitarbeiter_speichern', { p_id: null, p_daten: { name: 'Nachtrag, Nils' } }, B.leitung)).json;
  await s.rpc('pep_vertrag_speichern', { p_mitarbeiter_id: nils, p_daten:
    { vertragsart: 'vollzeit', wochenstunden: 37.5, gueltig_ab: '2026-01-01' } }, B.leitung);
  const woche = (await s.rpc('pep_zeitkonto_woche', { p_jahr: 2026, p_kw: 46 }, B.leitung)).json;
  const n = woche.mitarbeiter.find((m) => m.id === nils);
  gleich([n.gebucht, Number(n.diff), Number(n.saldo_aktuell)], [false, -37.5, 0], 'DB: Nils nicht gebucht, Saldo ohne Diff');
  gleich(await journalDB(nils), [], 'DB: Nils ohne Buchung');
  await alsBenutzer('chef');
  await reiter('zeitkonto');
  await c.klick({ text: 'Vorwoche', in: '#ansicht-zeitkonto', sel: 'button', genau: true });
  await ruhe();
  gleich(await zkWoche(), 'KW 46/2026', 'KW 46 (abgeschlossen)');
  const zeile = await c.werte((id) => {
    const r = document.querySelector(`#ansicht-zeitkonto tr[data-mitarbeiter="${id}"]`);
    const td = [...r.querySelectorAll('td')];
    return { diff: td[5].textContent, marke: td[5].querySelector('.zk-nicht-gebucht-marke')?.textContent ?? null,
      grau: td[5].classList.contains('vorlaeufig'), title: td[5].title, aktuell: td[7].textContent };
  }, nils);
  gleich([zeile.diff, zeile.marke, zeile.grau, zeile.aktuell], ['−37,50nicht gebucht', 'nicht gebucht', true, '0,00'],
    'Nils: Diff grau mit „nicht gebucht“, Saldo aktuell ohne Diff');
  pruefe(zeile.title.startsWith('nicht gebucht: inaktiv oder beim Abschluss nicht dabei'), 'Tooltip erklärt den Grund', zeile.title);
  gleich(await anzahl('#ansicht-zeitkonto .zk-nicht-gebucht-marke'), 1, 'nur Nils ist nicht gebucht');
  const summe = Math.round(woche.mitarbeiter.filter((m) => m.gebucht).reduce((x, m) => x + Number(m.diff), 0) * 100) / 100;
  const fuss = await c.werte(() => [...document.querySelectorAll('#ansicht-zeitkonto tfoot td')][5].textContent);
  gleich(zahlDE(fuss), summe, 'Summe Diff ohne die nicht gebuchte Diff');
  pruefe((await text('#ansicht-zeitkonto .zk-legende-nicht-gebucht'))?.includes('inaktiv oder beim Abschluss nicht dabei'),
    'Legende unter der Tabelle', await text('#ansicht-zeitkonto .zk-fuss'));
  await c.foto(`${FOTOS}zeitkonto-nicht-gebucht.png`);
  // Ausdrucke: Wocheneinsatz-IST und Stundenblatt nennen die Woche ebenso „nicht gebucht“
  await druckStub();
  await c.klick('#ansicht-zeitkonto [data-aktion="zk-drucken"]');
  await warteDialog('Drucken');
  await dKnopf('Wocheneinsatz-IST KW 46');
  await c.warteAuf(() => document.querySelector('#ansicht-druck .dr-wochenist'), { text: 'Wocheneinsatz-IST' });
  const druckZeile = (name) => c.werte((n) => {
    const tr = [...document.querySelectorAll('#ansicht-druck .dr-wochenist tbody tr')].find((r) => r.cells[0].textContent.startsWith(n));
    return tr ? [...tr.cells].slice(-3).map((td) => [td.textContent, td.classList.contains('dr-nicht-gebucht')]) : null;
  }, name);
  gleich(await druckZeile('Nachtrag, Nils'), [['−37,50nicht gebucht', true], ['0,00', false], ['0,00', false]],
    'Wocheneinsatz-IST: Diff „nicht gebucht“, Saldo ohne Diff');
  const ben = Number(woche.mitarbeiter.find((m) => m.id === BEN).diff);
  gleich([zahlDE((await druckZeile('Muster, Ben'))[0][0]), (await druckZeile('Muster, Ben'))[0][1]], [ben, false],
    'Wocheneinsatz-IST: gebuchte Diff wie bisher (Ben)');
  await druckAufraeumen();
  await c.klick('#ansicht-zeitkonto [data-aktion="zk-drucken"]');
  await warteDialog('Drucken');
  await dKnopf('Stundenblatt');
  await c.warteAuf(() => document.querySelector('#ansicht-druck .dr-stundenblatt'), { text: 'Stundenblatt' });
  const hinweis = await c.werte(() => {
    const seite = [...document.querySelectorAll('#ansicht-druck .dr-seite')].find((x) => x.querySelector('.dr-person')?.textContent.startsWith('Nachtrag, Nils'));
    return seite ? [...seite.querySelectorAll('.dr-stundenblatt-wochen tbody tr')].map((tr) => [tr.cells[0].textContent, [...tr.cells].at(-1).textContent]) : null;
  });
  gleich(hinweis, [['KW 46/2026', 'nicht gebucht']], 'Stundenblatt: Woche „nicht gebucht“');
  await druckAufraeumen();
});

// ================================================================ Ende

const ok = ergebnisse.filter((e) => e.ok).length;
console.log(`\n${ok} von ${ergebnisse.length} Szenarien bestanden.`);
writeFileSync(`${FOTOS}ergebnis.json`, JSON.stringify({ ergebnisse, rpc: s.aufrufe.filter((a) => a.status >= 300) }, null, 1));
await c.schliessen();
await s.schliessen();
process.exitCode = ok === ergebnisse.length ? 0 : 1;

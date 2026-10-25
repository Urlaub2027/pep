// Browser-Test Stufe 1: echte Oberfläche (docs/) in Chrome headless gegen die echten SQL-Funktionen (PGlite im
// Testserver tests/browser/server.mjs). Jedes Szenario prüft DOM und Datenbankstand, macht ein Foto
// (tests/browser/fotos/, gitignored) und sammelt Konsolenfehler. Ein Fehlschlag hält den Lauf nicht an.
// Start: node tests/browser/szenarien.mjs [filter]   (filter: Teil des Szenario-Namens, optional)
// Ergebnis: Zusammenfassung auf der Konsole und tests/browser/fotos/ergebnis.json.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { crc32 } from 'node:zlib';
import { starteServer, PASSWORT } from './server.mjs';
import { starteChrome } from './cdp.mjs';
import { HEUTE, TAGE } from './daten.mjs';

const FOTOS = new URL('./fotos/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
rmSync(FOTOS, { recursive: true, force: true });
mkdirSync(FOTOS, { recursive: true });
const filter = process.argv[2] ?? '';
const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

const s = await starteServer();
const c = await starteChrome({ heute: HEUTE });
const notAus = (e) => { console.error(e); try { process.kill(c.pid); } catch { /* schon zu */ } process.exit(2); };
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
  gleich(kacheln.map((k) => k.titel), ['Abwesend diese Woche', 'Stunden-Lücke', 'Regelverstöße', 'Offene Urlaubswünsche'], 'Kacheln');
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
  s.verzoegere(800);
  try {
    const p = async (von) => zellPunkt(epZelle(MIA, von), false);
    await c.ziehe(await p('13:00'), await p('13:30'));
    await c.ziehe(await p('15:00'), await p('15:30'));
    const sichtbarerHinweis = await c.werte(() => document.getElementById('meldung').hidden ? '' : document.getElementById('meldung').textContent);
    await ruhe();
    notiz(`Meldung nach dem zweiten Strich: „${sichtbarerHinweis}“`);
  } finally {
    s.verzoegere(0);
  }
  gleich(await bloecke(MIA, MI), [...vorher, 'KA 13:00-14:00', 'KA 15:00-16:00'], 'Beide Striche gespeichert');
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
  pruefe((await anzahl('#ansicht-start .kachel')) === 4, 'Startseite mit vier Kacheln');
});

// ================================================================ Ende

const ok = ergebnisse.filter((e) => e.ok).length;
console.log(`\n${ok} von ${ergebnisse.length} Szenarien bestanden.`);
writeFileSync(`${FOTOS}ergebnis.json`, JSON.stringify({ ergebnisse, rpc: s.aufrufe.filter((a) => a.status >= 300) }, null, 1));
await c.schliessen();
await s.schliessen();
process.exitCode = ok === ergebnisse.length ? 0 : 1;

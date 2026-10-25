// Krank/ZA-Schnellerfassung und Ersatz finden: pep_schnell_abwesend, pep_ersatz_kandidaten, pep_ersatz_uebernehmen.
// Jede Prüfung bekommt eine eigene Datenbank, weil die Kandidatenliste alle Mitarbeiter der Filiale betrachtet.
// Heute = Mo 02.11.2026, Testwoche KW 46 (09.–15.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, heuteSetzen, planGrundlage } from './helfer.mjs';

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

async function aufbau() {
  const db = await neueDatenbank();
  const g = await planGrundlage(db);
  const { leitung, code, json } = g;
  const aufruf = (nutzer, sql, params = []) => als(db, 'authenticated', nutzer, sql, params);
  const schnell = (maId, c, von, bis = von, nutzer = leitung) =>
    json(nutzer, 'select public.pep_schnell_abwesend($1, $2, $3::date, $4::date) as r', [maId, c, von, bis]);
  const kandidaten = (maId, datum, nutzer = leitung) =>
    json(nutzer, 'select public.pep_ersatz_kandidaten($1, $2::date) as r', [maId, datum]);
  const uebernehmen = (maId, datum, ersatzId, nutzer = leitung) =>
    json(nutzer, 'select public.pep_ersatz_uebernehmen($1, $2::date, $3) as r', [maId, datum, ersatzId]);
  const abwesend = (maId, c, datum, stunden = null, von = null, bis = null) =>
    json(leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, $4::numeric, $5::time, $6::time, null) as r',
      [maId, code[c], datum, stunden, von, bis]);
  const vorgabe = (maId, daten) =>
    json(leitung, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [maId, JSON.stringify({ gueltig_von: '2026-01-01', ...daten })]);
  const woche = () => json(leitung, 'select public.pep_einsatzplan_woche(2026, 46) as r');
  // Gespeicherte Zeile [{von, bis, k}] eines Mitarbeiters an einem Tag.
  const zeile = async (maId, datum) => (await db.query(
    `select to_char(b.von, 'HH24:MI') as von, to_char(b.bis, 'HH24:MI') as bis, r.kuerzel as k
       from pep.plan_bloecke b join pep.bereiche r on r.id = b.bereich_id
      where b.mitarbeiter_id = $1 and b.datum = $2::date order by b.von`, [maId, datum])).rows;
  const protokolle = async () => (await db.query('select count(*)::int as n from pep.protokoll')).rows[0].n;
  return { db, ...g, aufruf, schnell, kandidaten, uebernehmen, abwesend, vorgabe, woche, zeile, protokolle };
}

const ids = (r) => r.kandidaten.map((k) => k.mitarbeiter_id).sort((x, y) => x - y);

test('KM Mo–Mi über geplanten Blöcken: Blöcke bleiben, unbesetzt = true, Stunden zählen nicht; KM löschen → wieder besetzt', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']) await t.malen(t.leitung, a, d, '08:00', '12:00', 'KA');
  // Die Stellvertretung darf die Krankmeldung erfassen
  assert.deepEqual(await t.schnell(a, 'KM', '2026-11-09', '2026-11-11', t.stellv), { tage: 3, uebersprungen: 0 });
  let w = await t.woche();
  const bloeckeVon = () => w.bloecke.filter((b) => b.mitarbeiter_id === a).map((b) => [b.datum, b.von, b.bis, b.unbesetzt]);
  assert.deepEqual(bloeckeVon(), [
    ['2026-11-09', '08:00', '12:00', true], ['2026-11-10', '08:00', '12:00', true],
    ['2026-11-11', '08:00', '12:00', true], ['2026-11-12', '08:00', '12:00', false]]);
  assert.equal(Number(w.kennzahlen.geplant), 4); // nur Donnerstag zählt
  assert.equal((await t.db.query('select count(*)::int as n from pep.plan_bloecke where mitarbeiter_id = $1', [a])).rows[0].n, 4);
  // Unbesetzt erscheint in der Regelprüfung
  assert.ok(w.pruefung['2026-11-10'].some((e) => e.art === 'unbesetzt' && e.mitarbeiter_id === a && e.text === 'Unbesetzt (KM): 08:00–12:00'));

  await t.aufruf(t.leitung, `select public.pep_abwesenheit_loeschen($1, '2026-11-09', '2026-11-11')`, [a]);
  w = await t.woche();
  assert.ok(bloeckeVon().every(([, , , u]) => u === false));
  assert.equal(Number(w.kennzahlen.geplant), 16);
});

test("pep_schnell_abwesend mit 'U' → CODE_UNGUELTIG; geschriebene Zeilen haben quelle = 'schnell'", async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  for (const c of ['U', 'BS', 'km', '', null]) await wirft(t.schnell(a, c, '2026-11-09'), 'CODE_UNGUELTIG');
  // ZA Sa–So: Sonntag geschlossen → übersprungen
  assert.deepEqual(await t.schnell(a, 'ZA', '2026-11-14', '2026-11-15'), { tage: 1, uebersprungen: 1 });
  // KM auch in der Vergangenheit (heute = 02.11.)
  assert.deepEqual(await t.schnell(a, 'KM', '2026-10-29', '2026-10-30'), { tage: 2, uebersprungen: 0 });
  const zeilen = (await t.db.query(
    `select to_char(a.datum, 'YYYY-MM-DD') as datum, c.code, a.quelle, a.stunden::float as stunden, a.von
       from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
      where a.mitarbeiter_id = $1 order by a.datum`, [a])).rows;
  assert.deepEqual(zeilen, [
    { datum: '2026-10-29', code: 'KM', quelle: 'schnell', stunden: 6.25, von: null },
    { datum: '2026-10-30', code: 'KM', quelle: 'schnell', stunden: 6.25, von: null },
    { datum: '2026-11-14', code: 'ZA', quelle: 'schnell', stunden: 6.25, von: null }]);
  // KM ersetzt einen vorhandenen Tag (ZA → KM)
  await t.schnell(a, 'KM', '2026-11-14');
  assert.equal((await t.db.query(`select c.code from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
    where a.mitarbeiter_id = $1 and a.datum = '2026-11-14'`, [a])).rows[0].code, 'KM');
  // Deaktivierter Code der eigenen Filiale → CODE_NICHT_GEFUNDEN
  await t.db.query("update pep.abwesenheitscodes set aktiv = false where id = $1", [t.code.ZA]);
  await wirft(t.schnell(a, 'ZA', '2026-11-16'), 'CODE_NICHT_GEFUNDEN');
  // Inaktiver Mitarbeiter wie bei pep_abwesenheit_setzen
  await t.aufruf(t.leitung, `select public.pep_mitarbeiter_speichern($1, '{"aktiv":false}')`, [a]);
  await wirft(t.schnell(a, 'KM', '2026-11-16'), 'MITARBEITER_INAKTIV');
  // Rolle mitarbeiter darf nicht
  const azubi = await pepBenutzer(t.db, 'azubi', 'mitarbeiter', t.fil);
  await wirft(t.schnell(a, 'KM', '2026-11-16', '2026-11-16', azubi), 'NUR_LEITUNG');
});

test('Kandidaten: ohne Kassenkompetenz, abwesend, zur Zeit schon geplant, Pflicht nicht verfügbar, Ruhezeit verletzt → jeweils nicht dabei', async () => {
  const t = await aufbau();
  const D = '2026-11-10'; // Dienstag
  const krank = await t.ma('Krank, Karl');
  await t.malen(t.leitung, krank, D, '14:00', '20:00', 'KA');
  const olga = await t.ma('Test, Olga'); // frei, Kasse → dabei
  const nils = await t.ma('Test, Nils'); // morgens schon geplant, ohne Überschneidung → dabei
  await t.malen(t.leitung, nils, D, '08:00', '12:00', 'KA');
  const otto = await t.ma('Test, Otto', { kompetenzen: ['OG'] }); // ohne Kassenkompetenz
  const ulla = await t.ma('Test, Ulla'); // Urlaub
  await t.abwesend(ulla, 'U', D);
  const bea = await t.ma('Test, Bea'); // Berufsschule 15–17 mitten im Block
  await t.abwesend(bea, 'BS', D, 2, '15:00', '17:00');
  const gerd = await t.ma('Test, Gerd'); // 12–15 geplant, überschneidet 14–15
  await t.malen(t.leitung, gerd, D, '12:00', '15:00', 'KA');
  const pia = await t.ma('Test, Pia'); // Pflicht: dienstags ab 18:00 nicht verfügbar
  await t.vorgabe(pia, { pflicht: true, wochentag: 2, art: 'nicht_verfuegbar', von: '18:00', bis: '21:30' });
  const rolf = await t.ma('Test, Rolf'); // Mittwoch ab 06:00 → nur 10 h Ruhezeit
  await t.malen(t.leitung, rolf, '2026-11-11', '06:00', '10:00', 'KA');
  const hans = await t.ma('Test, Hans'); // 06–11 geplant: mit 14–20 wären es 11 h am Tag
  await t.malen(t.leitung, hans, D, '06:00', '11:00', 'KA');
  const ines = await t.ma('Test, Ines'); // inaktiv
  await t.aufruf(t.leitung, `select public.pep_mitarbeiter_speichern($1, '{"aktiv":false}')`, [ines]);
  const vera = await t.ma('Test, Vera', { ab: '2026-12-01' }); // Vertrag erst ab Dezember
  await t.schnell(krank, 'KM', D);

  const bloecke = async () => (await t.db.query('select count(*)::int as n from pep.plan_bloecke')).rows[0].n;
  const vorher = { bloecke: await bloecke(), protokoll: await t.protokolle() };
  const r = await t.kandidaten(krank, D, t.stellv); // die Stellvertretung darf suchen
  // Die Probe-Übernahme ist zurückgerollt: keine Blöcke, kein Protokoll
  assert.deepEqual({ bloecke: await bloecke(), protokoll: await t.protokolle() }, vorher);
  assert.deepEqual(r.unbesetzt, [{ von: '14:00', bis: '20:00', bereich_id: t.bereich.KA }]);
  assert.deepEqual(ids(r), [olga, nils].sort((x, y) => x - y));
  for (const k of r.kandidaten) {
    assert.deepEqual(Object.keys(k).sort(), ['hinweise', 'luecke', 'mitarbeiter_id', 'name', 'samstage_monat', 'spaet_woche']);
    assert.deepEqual(k.hinweise, []);
  }
  // Gegenprobe: ohne die jeweilige Sperre wären sie dabei
  await t.malen(t.leitung, rolf, '2026-11-11', '06:00', '07:00', null);
  await t.malen(t.leitung, hans, D, '06:00', '07:00', null);
  assert.deepEqual(ids(await t.kandidaten(krank, D)), [olga, nils, rolf, hans].sort((x, y) => x - y));
  for (const x of [otto, ulla, bea, gerd, pia, ines, vera]) assert.ok(x);
  // Ohne unbesetzte Blöcke
  const leer = await t.ma('Test, Leer');
  await wirft(t.kandidaten(leer, D), 'NICHTS_UNBESETZT');
  await wirft(t.kandidaten(krank, '2026-11-11'), 'NICHTS_UNBESETZT');
  await wirft(t.kandidaten(krank, null), 'DATUM_UNGUELTIG');
  // Vergangener Tag
  await heuteSetzen(t.db, '2026-11-11');
  await wirft(t.kandidaten(krank, D), 'VERGANGEN');
});

test('Sortierung: größere Lücke zuerst; bei gleicher Lücke weniger Samstage und Spätschichten zuerst', async () => {
  const t = await aufbau();
  const D = '2026-11-13'; // Freitag
  const krank = await t.ma('Krank, Karl');
  await t.malen(t.leitung, krank, D, '08:00', '12:00', 'KA');
  await t.schnell(krank, 'KM', D);
  const a = await t.ma('Sort, A', { stunden: 37.5 }); // Lücke 37,5
  const b = await t.ma('Sort, B', { stunden: 20, art: 'teilzeit' }); // Lücke 20
  const c = await t.ma('Sort, C', { stunden: 24, art: 'teilzeit' }); // Lücke 20, ein Samstag
  await t.malen(t.leitung, c, '2026-11-14', '08:00', '12:00', 'KA');
  const d = await t.ma('Sort, D', { stunden: 28, art: 'teilzeit' }); // Lücke 20, zwei Spätschichten
  await t.malen(t.leitung, d, '2026-11-10', '16:00', '20:00', 'KA');
  await t.malen(t.leitung, d, '2026-11-11', '16:00', '20:00', 'KA');
  const e = await t.ma('Sort, E', { stunden: 20, art: 'teilzeit' }); // wie B, Name danach
  const f = await t.ma('Sort, F', { stunden: 37.5 }); // Urlaub Montag: Soll 31,25
  await t.schnell(f, 'ZA', '2026-11-09');

  const r = await t.kandidaten(krank, D);
  assert.deepEqual(r.kandidaten.map((k) => k.mitarbeiter_id), [a, f, b, e, c, d]);
  assert.deepEqual(r.kandidaten.map((k) => [k.name, Number(k.luecke), k.samstage_monat, k.spaet_woche]), [
    ['Sort, A', 37.5, 0, 0], ['Sort, F', 31.25, 0, 0], ['Sort, B', 20, 0, 0], ['Sort, E', 20, 0, 0],
    ['Sort, C', 20, 1, 0], ['Sort, D', 20, 0, 2]]);
});

test('bevorzugte Vorgabe „nur bis 14:00“ → Kandidat bleibt, hinweise enthält den Text', async () => {
  const t = await aufbau();
  const D = '2026-11-12'; // Donnerstag
  const krank = await t.ma('Krank, Karl');
  await t.malen(t.leitung, krank, D, '12:00', '19:00', 'KA');
  await t.schnell(krank, 'KM', D);
  const vivi = await t.ma('Test, Vivi');
  await t.vorgabe(vivi, { pflicht: false, wochentag: 4, art: 'nur_zwischen', von: '06:00', bis: '14:00', notiz: 'nur bis 14:00' });
  const wim = await t.ma('Test, Wim'); // ohne Notiz: Text aus der Vorgabe
  await t.vorgabe(wim, { pflicht: false, wochentag: 4, art: 'nur_zwischen', von: '06:00', bis: '14:00' });
  const lars = await t.ma('Test, Lars'); // Vorwoche überwiegend spät, 12–19 ist wieder spät
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) await t.malen(t.leitung, lars, d, '16:00', '20:00', 'KA');
  const olga = await t.ma('Test, Olga'); // ohne Hinweis
  // Ein Hinweis, der schon vorher besteht, entsteht nicht durch die Übernahme
  const jan = await t.ma('Test, Jan');
  await t.vorgabe(jan, { pflicht: false, wochentag: 4, art: 'nur_zwischen', von: '06:00', bis: '08:00', notiz: 'lieber früh' });
  await t.malen(t.leitung, jan, D, '08:00', '10:00', 'KA');

  const r = await t.kandidaten(krank, D);
  const hinweise = Object.fromEntries(r.kandidaten.map((k) => [k.mitarbeiter_id, k.hinweise]));
  assert.deepEqual(hinweise[vivi], ['nur bis 14:00']);
  assert.deepEqual(hinweise[wim], ['Bevorzugt: nur 06:00–14:00']);
  assert.deepEqual(hinweise[lars], ['Letzte Woche überwiegend spät']);
  assert.deepEqual(hinweise[olga], []);
  assert.deepEqual(hinweise[jan], []);
  assert.equal(r.kandidaten[r.kandidaten.length - 1].mitarbeiter_id, jan); // 2 h in KW 46 geplant: kleinste Lücke
});

test('uebernehmen: Ersatz hat die Blöcke, der Abwesende keine mehr; danach ersatz_kandidaten → NICHTS_UNBESETZT', async () => {
  const t = await aufbau();
  const D = '2026-11-09';
  const a = await t.ma('Test, Anna');
  await t.malen(t.leitung, a, D, '08:00', '12:00', 'KA');
  await t.malen(t.leitung, a, D, '12:00', '12:30', 'PA');
  await t.malen(t.leitung, a, D, '12:30', '15:00', 'KA');
  const b = await t.ma('Test, Bert');
  await t.malen(t.leitung, b, D, '16:00', '18:00', 'KA');
  await t.schnell(a, 'KM', D);
  await wirft(t.uebernehmen(a, D, a), 'WERT_UNGUELTIG');

  const r = await t.uebernehmen(a, D, b, t.stellv); // die Stellvertretung darf übernehmen
  assert.equal(r.datum, D);
  assert.deepEqual(r.bloecke.map((x) => [x.mitarbeiter_id, x.von, x.bis, x.bereich_id, x.unbesetzt]), [
    [b, '08:00', '12:00', t.bereich.KA, false], [b, '12:00', '12:30', t.bereich.PA, false],
    [b, '12:30', '15:00', t.bereich.KA, false], [b, '16:00', '18:00', t.bereich.KA, false]]);
  assert.ok(D in r.pruefung && '2026-11-15' in r.pruefung);
  assert.deepEqual(await t.zeile(a, D), []);
  await wirft(t.kandidaten(a, D), 'NICHTS_UNBESETZT');
  await wirft(t.uebernehmen(a, D, b), 'NICHTS_UNBESETZT');

  // Teilabwesenheit: nur der unbesetzte Teil wandert, der Rest bleibt beim Abwesenden
  const c = await t.ma('Test, Cora');
  await t.malen(t.leitung, c, '2026-11-10', '10:00', '16:00', 'KA');
  await t.abwesend(c, 'BS', '2026-11-10', 5, '08:00', '13:00');
  assert.deepEqual((await t.kandidaten(c, '2026-11-10')).unbesetzt, [{ von: '10:00', bis: '13:00', bereich_id: t.bereich.KA }]);
  await t.uebernehmen(c, '2026-11-10', b);
  assert.deepEqual(await t.zeile(c, '2026-11-10'), [{ von: '13:00', bis: '16:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(b, '2026-11-10'), [{ von: '10:00', bis: '13:00', k: 'KA' }]);

  // Vergangener Tag
  const d = await t.ma('Test, Dora');
  await t.malen(t.leitung, d, '2026-11-11', '08:00', '12:00', 'KA');
  await t.schnell(d, 'KM', '2026-11-11');
  await heuteSetzen(t.db, '2026-11-12');
  await wirft(t.uebernehmen(d, '2026-11-11', b), 'VERGANGEN');
  assert.deepEqual(await t.zeile(d, '2026-11-11'), [{ von: '08:00', bis: '12:00', k: 'KA' }]);
});

test('uebernehmen auf einen inzwischen gesperrten Ersatz → Fehler, nichts verschoben', async () => {
  const t = await aufbau();
  const D = '2026-11-11';
  const a = await t.ma('Test, Anna');
  await t.malen(t.leitung, a, D, '08:00', '12:00', 'KA');
  await t.schnell(a, 'KM', D);
  const b = await t.ma('Test, Bert');
  const c = await t.ma('Test, Cora');
  const e = await t.ma('Test, Emil');
  assert.deepEqual(ids(await t.kandidaten(a, D)), [b, c, e].sort((x, y) => x - y));

  const stand = async () => ({ a: await t.zeile(a, D), b: await t.zeile(b, D), c: await t.zeile(c, D),
    e: await t.zeile(e, D), protokoll: await t.protokolle() });
  // b meldet sich inzwischen selbst krank
  await t.schnell(b, 'KM', D);
  // c ist inzwischen 11–13 eingeplant
  await t.malen(t.leitung, c, D, '11:00', '13:00', 'KA');
  // e verliert die Kassenkompetenz
  await t.aufruf(t.leitung, 'select public.pep_kompetenz_setzen($1, $2, false)', [e, t.bereich.KA]);
  const vorher = await stand();
  await wirft(t.uebernehmen(a, D, b), 'ABWESEND');
  await wirft(t.uebernehmen(a, D, c), 'UEBERLAPPUNG');
  await wirft(t.uebernehmen(a, D, e), 'KOMPETENZ_FEHLT');
  assert.deepEqual(await stand(), vorher);
  assert.deepEqual(vorher.a, [{ von: '08:00', bis: '12:00', k: 'KA' }]);
  assert.deepEqual((await t.kandidaten(a, D)).kandidaten, []);
});

test('fremde Filiale → MITARBEITER_NICHT_GEFUNDEN; uebernehmen schreibt Protokoll', async () => {
  const t = await aufbau();
  const D = '2026-11-12';
  const chef2 = await pepBenutzer(t.db, 'chef2');
  await filiale(t.db, chef2, { name: 'Netto Zweitfiliale', nummer: '9999' });
  const fremd = await t.json(chef2, `select public.pep_mitarbeiter_speichern(null, '{"name":"Fremd, Frieda"}') as r`);
  await t.aufruf(chef2, `select public.pep_vertrag_speichern($1, '{"vertragsart":"vollzeit","wochenstunden":37.5,"gueltig_ab":"2026-01-01"}')`, [fremd]);
  const fremdKa = (await t.json(chef2, 'select public.pep_bereiche() as r')).find((x) => x.kuerzel === 'KA').id;
  await t.aufruf(chef2, 'select public.pep_kompetenz_setzen($1, $2, true)', [fremd, fremdKa]);

  const a = await t.ma('Test, Anna');
  await t.malen(t.leitung, a, D, '08:00', '12:00', 'KA');
  await t.schnell(a, 'KM', D);
  const b = await t.ma('Test, Bert');

  await wirft(t.schnell(fremd, 'KM', D), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(t.kandidaten(fremd, D), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(t.uebernehmen(fremd, D, b), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(t.uebernehmen(a, D, fremd), 'MITARBEITER_NICHT_GEFUNDEN');
  assert.deepEqual(ids(await t.kandidaten(a, D)), [b]); // die fremde Kassenkraft steht nicht in der Liste
  // Die Zweitfiliale nimmt ihren eigenen KM-Code
  assert.deepEqual(await t.schnell(fremd, 'KM', D, D, chef2), { tage: 1, uebersprungen: 0 });
  assert.equal((await t.db.query(`select c.filiale_id = m.filiale_id as passt from pep.abwesenheiten a
    join pep.abwesenheitscodes c on c.id = a.code_id join pep.mitarbeiter m on m.id = a.mitarbeiter_id
   where a.mitarbeiter_id = $1`, [fremd])).rows[0].passt, true);

  const bisher = (await t.db.query('select max(id) as id from pep.protokoll')).rows[0].id;
  await t.uebernehmen(a, D, b);
  const neu = (await t.db.query(
    `select aktion, tabelle, schluessel, vorher, nachher, user_id from pep.protokoll where id > $1 order by id`, [bisher])).rows;
  const ka = t.bereich.KA;
  assert.deepEqual(neu.map((p) => [p.aktion, p.tabelle, p.schluessel]), [
    ['setzen', 'plan_bloecke', `${a}:${D}`], ['setzen', 'plan_bloecke', `${b}:${D}`], ['ersatz', 'plan_bloecke', `${a}:${D}`]]);
  assert.deepEqual(neu[0].vorher, [{ von: '08:00', bis: '12:00', bereich_id: ka }]);
  assert.deepEqual(neu[0].nachher, []);
  assert.deepEqual(neu[1].nachher, [{ von: '08:00', bis: '12:00', bereich_id: ka }]);
  assert.deepEqual(neu[2].nachher, { ersatz_id: b, bloecke: [{ von: '08:00', bis: '12:00', bereich_id: ka }] });
  assert.ok(neu.every((p) => p.user_id === t.leitung));
});

test('Ruhezeit und Höchstarbeitszeit: nur neue oder verschärfte Verstöße schließen aus, schon bestehende nicht', async () => {
  const t = await aufbau();
  const D = '2026-11-10'; // Dienstag; Vortag Montag 09.11., Folgetag Mittwoch 11.11.
  const krank = await t.ma('Krank, Karl'); // 20:00–21:30 unbesetzt
  await t.malen(t.leitung, krank, D, '20:00', '21:30', 'KA');
  await t.schnell(krank, 'KM', D);
  const olga = await t.ma('Test, Olga'); // frei → dabei
  // Rita: Montag bis 21:30, Dienstag ab 06:00 → schon vorher 8,5 h Ruhezeit „vor 06:00“; die Übernahme am Abend
  // ändert daran nichts → dabei
  const rita = await t.ma('Test, Rita');
  await t.malen(t.leitung, rita, '2026-11-09', '17:00', '21:30', 'KA');
  await t.malen(t.leitung, rita, D, '06:00', '08:00', 'KA');
  // Rolf: Mittwoch ab 06:00; mit der Übernahme bis 21:30 nur 8,5 h Ruhezeit → neu → nicht dabei
  const rolf = await t.ma('Test, Rolf');
  await t.malen(t.leitung, rolf, '2026-11-11', '06:00', '10:00', 'KA');
  // Hans: 06:00–15:00 = 9 h; mit 1,5 h dazu 10,5 h am Tag → neue Höchstarbeitszeit → nicht dabei
  const hans = await t.ma('Test, Hans');
  await t.malen(t.leitung, hans, D, '06:00', '15:00', 'KA');
  // Hugo: 06:00–17:30 = 11,5 h schon vorher über 10 h; mit der Übernahme 13 h → verschärft → nicht dabei
  const hugo = await t.ma('Test, Hugo');
  await t.malen(t.leitung, hugo, D, '06:00', '17:30', 'KA');

  // Ausgangslage: Rita und Hugo haben ihre Warnung schon ohne Übernahme
  const pr = (await t.json(t.leitung, `select public.pep_pruefung_zeitraum($1::date, $1::date) as r`, [D]))[D];
  const warn = (m) => pr.filter((e) => e.mitarbeiter_id === m && ['ruhezeit', 'hoechstarbeitszeit'].includes(e.art))
    .map((e) => e.text);
  assert.deepEqual(warn(rita), ['Ruhezeit 8,50 h (mind. 11 h) vor 06:00']);
  assert.deepEqual(warn(hugo), ['11,50 h am Tag (höchstens 10 h)']);
  assert.deepEqual(warn(rolf), []);
  assert.deepEqual(warn(hans), []);

  assert.deepEqual(ids(await t.kandidaten(krank, D)), [olga, rita].sort((x, y) => x - y));

  // Verschärfte Ruhezeit: Kurt fehlt 06:00–07:00. Rudi hat Montag bis 21:30 und Dienstag ab 08:00 → 10,5 h
  // „vor 08:00“; mit der Übernahme ab 06:00 nur noch 8,5 h → nicht dabei. Rita ist 06:00–08:00 schon geplant.
  const kurt = await t.ma('Test, Kurt');
  await t.malen(t.leitung, kurt, D, '06:00', '07:00', 'KA');
  await t.schnell(kurt, 'KM', D);
  const rudi = await t.ma('Test, Rudi');
  await t.malen(t.leitung, rudi, '2026-11-09', '17:00', '21:30', 'KA');
  await t.malen(t.leitung, rudi, D, '08:00', '10:00', 'KA');
  const r = await t.kandidaten(kurt, D);
  assert.ok(!ids(r).includes(rudi), 'Rudi: verschärfte Ruhezeit');
  assert.ok(!ids(r).includes(rita), 'Rita: zur Zeit schon geplant');
  assert.ok(ids(r).includes(olga));
  // Gegenprobe: ohne den Montag hätte Rudi keine Ruhezeit-Warnung und wäre dabei
  await t.malen(t.leitung, rudi, '2026-11-09', '17:00', '21:30', null);
  assert.ok(ids(await t.kandidaten(kurt, D)).includes(rudi));
});

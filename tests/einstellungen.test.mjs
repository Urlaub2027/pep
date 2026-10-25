// Einstellungen: Rahmen, abweichende Tage, Parameter, Codes, Bereiche, Schulferien, Benutzer, Tagesstatus.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, organisator, pepBenutzer, filiale } from './helfer.mjs';

let db, leitung, stellv, fil;

const aufruf = (nutzer, sql, params = []) => als(db, 'authenticated', nutzer, sql, params);
const json = async (nutzer, sql, params = []) => (await aufruf(nutzer, sql, params))[0].r;
const wirft = (versprechen, code) =>
  assert.rejects(versprechen, (e) => e.message.includes(code), code);
const alle = () => json(leitung, 'select public.pep_einstellungen() as r');
const status = async (datum) =>
  (await db.query('select * from pep.tag_status($1, $2::date)', [fil, datum])).rows[0];
const rahmen = (tag, daten) =>
  aufruf(leitung, 'select public.pep_rahmen_speichern($1, $2::jsonb)', [tag, JSON.stringify(daten)]);

before(async () => {
  db = await neueDatenbank();
  leitung = await pepBenutzer(db, 'chef');
  fil = await filiale(db, leitung);
  stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
});

test('Grundausstattung: 7 Rahmen, So geschlossen, 9 Codes, 18 Einstellungen', async () => {
  const e = await alle();
  assert.equal(e.rahmen.length, 7);
  assert.deepEqual(e.rahmen.map((r) => r.wochentag), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(e.rahmen[6].geoeffnet, false);
  assert.equal(e.rahmen[0].oeffnung_von, '07:00:00');
  assert.equal(e.rahmen[5].rahmen_bis, '21:30:00');
  assert.equal(e.codes.length, 9);
  assert.deepEqual(e.codes.map((c) => c.code), ['U', 'KM', 'BS', 'ZA', 'AF', 'BV', 'FT', 'NV', 'T']);
  assert.equal(e.codes.find((c) => c.code === 'BS').stundenregel, 'tatsaechlich');
  assert.equal(e.codes.find((c) => c.code === 'NV').stundenregel, 'keine');
  assert.equal(Object.keys(e.werte).length, 18);
  assert.equal(e.werte.abwesenheit_teiler, 6);
  assert.equal(e.werte.spaet_grenze, '18:00');
  assert.equal(e.werte.kassierleistung_eur_halbe_h, 900);
  assert.equal(e.bereiche.length, 15);
  assert.equal(e.filiale.bundesland, 'BY');
  // Nachholen: gelöschte Rahmen/Einstellungen kommen zurück (on conflict do nothing), geänderte bleiben
  await db.query('delete from pep.rahmen where filiale_id = $1 and wochentag = 3', [fil]);
  await db.query("update pep.einstellungen set wert = '7' where filiale_id = $1 and schluessel = 'ruhezeit_h'", [fil]);
  await db.query('select pep.grundausstattung($1)', [fil]);
  const e2 = await alle();
  assert.equal(e2.rahmen.length, 7);
  assert.equal(e2.werte.ruhezeit_h, 7);
  await db.query("update pep.einstellungen set wert = '11' where filiale_id = $1 and schluessel = 'ruhezeit_h'", [fil]);
});

test('tag_status: Dienstag 2027-03-02 geöffnet 07:00–20:00 / Rahmen 06:00–21:30', async () => {
  const s = await status('2027-03-02');
  assert.equal(s.geoeffnet, true);
  assert.equal(s.oeffnung_von, '07:00:00');
  assert.equal(s.oeffnung_bis, '20:00:00');
  assert.equal(s.rahmen_von, '06:00:00');
  assert.equal(s.rahmen_bis, '21:30:00');
  assert.equal(s.feiertag, null);
  assert.equal(s.abweichung, null);
});

test('tag_status: Sonntag geschlossen; Karfreitag 2027-03-26 geschlossen mit feiertag "Karfreitag"', async () => {
  const so = await status('2027-03-07');
  assert.equal(so.geoeffnet, false);
  assert.equal(so.oeffnung_von, null);
  const kf = await status('2027-03-26');
  assert.equal(kf.geoeffnet, false);
  assert.equal(kf.oeffnung_von, null);
  assert.equal(kf.rahmen_bis, null);
  assert.equal(kf.feiertag, 'Karfreitag');
  assert.equal((await db.query('select pep.feiertag($1, $2::date) as f', [fil, '2027-03-26'])).rows[0].f, 'Karfreitag');
  assert.equal((await db.query('select pep.feiertag($1, $2::date) as f', [fil, '2027-03-02'])).rows[0].f, null);
});

test('Abweichung verkaufsoffener Sonntag 2027-10-03 13:00–18:00 öffnet den Tag', async () => {
  const vorher = await status('2027-10-03');
  assert.equal(vorher.geoeffnet, false);
  assert.equal(vorher.feiertag, 'Tag der Deutschen Einheit');
  await aufruf(leitung, 'select public.pep_abweichung_speichern($1::date, $2::jsonb)', ['2027-10-03', JSON.stringify({
    art: 'verkaufsoffen', geoeffnet: true, oeffnung_von: '13:00', oeffnung_bis: '18:00',
    rahmen_von: '12:00', rahmen_bis: '18:30', name: 'Verkaufsoffener Sonntag' })]);
  const s = await status('2027-10-03');
  assert.equal(s.geoeffnet, true);
  assert.equal(s.oeffnung_von, '13:00:00');
  assert.equal(s.rahmen_bis, '18:30:00');
  assert.equal(s.abweichung, 'verkaufsoffen');
  assert.equal((await alle()).abweichungen.length, 1);
  await wirft(aufruf(leitung, 'select public.pep_abweichung_speichern($1::date, $2::jsonb)', ['2027-10-04',
    JSON.stringify({ art: 'quatsch', geoeffnet: false })]), 'ART_UNGUELTIG');
  await aufruf(leitung, 'select public.pep_abweichung_loeschen($1::date)', ['2027-10-03']);
  assert.equal((await status('2027-10-03')).abweichung, null);
  assert.equal((await alle()).abweichungen.length, 0);
});

test('Rahmen: 07:15 → HALBE_STUNDE; Rahmen enger als Öffnung → ZEITEN_UNGUELTIG', async () => {
  const ok = { geoeffnet: true, oeffnung_von: '07:00', oeffnung_bis: '20:00', rahmen_von: '06:00', rahmen_bis: '21:30' };
  await wirft(rahmen(2, { ...ok, oeffnung_von: '07:15' }), 'HALBE_STUNDE');
  await wirft(rahmen(2, { ...ok, rahmen_von: '07:30' }), 'ZEITEN_UNGUELTIG');
  await wirft(rahmen(2, { ...ok, rahmen_bis: '19:30' }), 'ZEITEN_UNGUELTIG');
  await wirft(rahmen(2, { ...ok, oeffnung_von: '20:00' }), 'ZEITEN_UNGUELTIG');
  await wirft(rahmen(8, ok), 'WOCHENTAG_UNGUELTIG');
  await rahmen(7, { geoeffnet: false });
  await rahmen(2, { ...ok, oeffnung_von: '08:00' });
  assert.equal((await status('2027-03-02')).oeffnung_von, '08:00:00');
  await rahmen(2, ok);
});

test('Einstellung setzen und lesen; unbekannter Schlüssel → EINSTELLUNG_UNBEKANNT; Teiler 0 → WERT_UNGUELTIG', async () => {
  const setze = (k, w) => aufruf(leitung, 'select public.pep_einstellung_setzen($1, $2::jsonb)', [k, JSON.stringify(w)]);
  await setze('ruhezeit_h', 10);
  assert.equal((await alle()).werte.ruhezeit_h, 10);
  assert.equal((await db.query('select pep.einstellung($1, $2) as w', [fil, 'ruhezeit_h'])).rows[0].w, 10);
  await setze('spaet_grenze', '18:30');
  await setze('wochen_toleranz_h', 0);
  await wirft(setze('gibt_es_nicht', 1), 'EINSTELLUNG_UNBEKANNT');
  await wirft(setze('abwesenheit_teiler', 0), 'WERT_UNGUELTIG');
  await wirft(setze('abwesenheit_teiler', '6'), 'WERT_UNGUELTIG');
  await wirft(setze('wochen_toleranz_h', -1), 'WERT_UNGUELTIG');
  await wirft(setze('spaet_grenze', '18:15'), 'HALBE_STUNDE');
  await wirft(setze('spaet_grenze', 18), 'WERT_UNGUELTIG');
  await wirft(db.query('select pep.einstellung($1, $2)', [fil, 'gibt_es_nicht']), 'EINSTELLUNG_FEHLT');
  await setze('ruhezeit_h', 11);
  await setze('spaet_grenze', '18:00');
});

test('grundausstattung nach Umbenennen: kein neues U/KA, Anzahlen unverändert', async () => {
  const f2 = await filiale(db, await pepBenutzer(db, 'chef3'), { name: 'Netto Fulda', nummer: '1111' });
  const zaehle = async () => (await db.query(
    `select (select count(*) from pep.abwesenheitscodes where filiale_id = $1)::int as c,
            (select count(*) from pep.bereiche where filiale_id = $1)::int as b`, [f2])).rows[0];
  const vorher = await zaehle();
  await db.query("update pep.abwesenheitscodes set code = 'UR' where filiale_id = $1 and code = 'U'", [f2]);
  await db.query("update pep.bereiche set kuerzel = 'KS' where filiale_id = $1 and kuerzel = 'KA'", [f2]);
  await db.query('select pep.grundausstattung($1)', [f2]);
  assert.deepEqual(await zaehle(), vorher);
  assert.equal((await db.query("select 1 from pep.abwesenheitscodes where filiale_id = $1 and code = 'U'", [f2])).rows.length, 0);
  assert.equal((await db.query("select 1 from pep.bereiche where filiale_id = $1 and kuerzel = 'KA'", [f2])).rows.length, 0);
});

test('Code anlegen "SP" und Kürzel doppelt → KUERZEL_DOPPELT; Bereich art ändern → ART_FEST', async () => {
  const codeSpeichern = (id, d) =>
    json(leitung, 'select public.pep_code_speichern($1, $2::jsonb) as r', [id, JSON.stringify(d)]);
  const bereichSpeichern = (id, d) =>
    json(leitung, 'select public.pep_bereich_speichern($1, $2::jsonb) as r', [id, JSON.stringify(d)]);
  const id = await codeSpeichern(null, { code: ' sp ', name: 'Sonderurlaub', farbe: '#00BCD4', stundenregel: 'teiler' });
  const sp = (await alle()).codes.find((c) => c.id === id);
  assert.equal(sp.code, 'SP');
  assert.equal(sp.sperrt, true);
  await wirft(codeSpeichern(null, { code: 'SP', name: 'Doppelt', farbe: '#00BCD4', stundenregel: 'keine' }), 'KUERZEL_DOPPELT');
  await wirft(codeSpeichern(null, { code: 'ABCD', name: 'Lang', farbe: '#00BCD4', stundenregel: 'keine' }), 'KUERZEL_UNGUELTIG');
  await wirft(codeSpeichern(null, { code: 'XX', name: 'X', farbe: '#00BCD4', stundenregel: 'egal' }), 'STUNDENREGEL_UNGUELTIG');
  await codeSpeichern(id, { name: 'Sonderurlaub neu', aktiv: false });
  const sp2 = (await alle()).codes.find((c) => c.id === id);
  assert.equal(sp2.name, 'Sonderurlaub neu');
  assert.equal(sp2.aktiv, false);
  assert.equal(sp2.stundenregel, 'teiler');
  await wirft(codeSpeichern(id, { code: 'U' }), 'KUERZEL_DOPPELT');

  const b = await bereichSpeichern(null, { kuerzel: 'XY', name: 'Neu', farbe: '#112233' });
  const neu = (await alle()).bereiche.find((x) => x.id === b);
  assert.equal(neu.art, 'bereich');
  await wirft(bereichSpeichern(b, { art: 'funktion' }), 'ART_FEST');
  await wirft(bereichSpeichern(null, { kuerzel: 'ZZ', name: 'Pause 2', farbe: '#112233', art: 'pause' }), 'ART_UNGUELTIG');
  await wirft(bereichSpeichern(null, { kuerzel: 'KA', name: 'Doppelt', farbe: '#112233' }), 'KUERZEL_DOPPELT');
  await bereichSpeichern(b, { name: 'Neu2', art: 'bereich', aktiv: false });
  assert.equal((await alle()).bereiche.find((x) => x.id === b).aktiv, false);
  const f = await bereichSpeichern(null, { kuerzel: 'FX', name: 'Fkt', farbe: '#112233', art: 'funktion' });
  assert.equal((await alle()).bereiche.find((x) => x.id === f).art, 'funktion');
});

test('Schulferien anlegen 2027-08-02..2027-09-13 "Sommerferien", bis<von → Fehler', async () => {
  const id = await json(leitung, 'select public.pep_schulferien_speichern(null, $1::date, $2::date, $3) as r',
    ['2027-08-02', '2027-09-13', 'Sommerferien']);
  const s = (await alle()).schulferien.find((x) => x.id === id);
  assert.equal(s.name, 'Sommerferien');
  assert.equal(s.von, '2027-08-02');
  await wirft(aufruf(leitung, 'select public.pep_schulferien_speichern(null, $1::date, $2::date, $3)',
    ['2027-09-13', '2027-08-02', 'Falsch']), 'ZEITRAUM_UNGUELTIG');
  await aufruf(leitung, 'select public.pep_schulferien_speichern($1, $2::date, $3::date, $4)',
    [id, '2027-08-02', '2027-09-10', 'Sommerferien']);
  assert.equal((await alle()).schulferien.find((x) => x.id === id).bis, '2027-09-10');
  await aufruf(leitung, 'select public.pep_schulferien_loeschen($1)', [id]);
  assert.equal((await alle()).schulferien.length, 0);
  await wirft(aufruf(leitung, 'select public.pep_schulferien_loeschen($1)', [id]), 'SCHULFERIEN_NICHT_GEFUNDEN');
});

test('pep_feiertage(2027) enthält 2027-01-06 Heilige Drei Könige (BY) und nicht 2027-03-08', async () => {
  const f = await json(stellv, 'select public.pep_feiertage(2027) as r');
  assert.ok(f.some((x) => x.datum === '2027-01-06' && x.name === 'Heilige Drei Könige'));
  assert.ok(!f.some((x) => x.datum === '2027-03-08'));
  assert.ok(f.some((x) => x.datum === '2027-03-26' && x.name === 'Karfreitag'));
});

test('Benutzer setzen: Organisator "vize2" wird stellvertretung, erscheint in pep_einstellungen().benutzer', async () => {
  const uid = await organisator(db, 'vize2');
  await aufruf(leitung, 'select public.pep_benutzer_setzen($1, $2)', ['  VIZE2 ', 'stellvertretung']);
  let b = (await alle()).benutzer.find((x) => x.user_id === uid);
  assert.equal(b.rolle, 'stellvertretung');
  assert.equal(b.benutzername, 'vize2');
  assert.equal(b.anzeigename, 'vize2');
  await aufruf(leitung, 'select public.pep_benutzer_setzen($1, $2)', ['vize2', 'leitung']);
  b = (await alle()).benutzer.find((x) => x.user_id === uid);
  assert.equal(b.rolle, 'leitung');
  await aufruf(leitung, 'select public.pep_benutzer_entfernen($1)', [uid]);
  assert.ok(!(await alle()).benutzer.some((x) => x.user_id === uid));
  assert.equal((await db.query('select 1 from urlaub.organisatoren where user_id = $1', [uid])).rows.length, 1);
});

test('eigene Rolle ändern → NICHT_SELBST; unbekannter Name → BENUTZER_NICHT_GEFUNDEN; Stellvertretung darf nicht', async () => {
  const setze = (nutzer, name, rolle) => aufruf(nutzer, 'select public.pep_benutzer_setzen($1, $2)', [name, rolle]);
  await wirft(setze(leitung, 'chef', 'stellvertretung'), 'NICHT_SELBST');
  await wirft(aufruf(leitung, 'select public.pep_benutzer_entfernen($1)', [leitung]), 'NICHT_SELBST');
  await wirft(setze(leitung, 'niemand', 'leitung'), 'BENUTZER_NICHT_GEFUNDEN');
  await organisator(db, 'neuling');
  await wirft(setze(leitung, 'neuling', 'mitarbeiter'), 'ROLLE_UNGUELTIG');
  await wirft(setze(stellv, 'neuling', 'leitung'), 'NUR_LEITUNG');
  await wirft(aufruf(stellv, 'select public.pep_rahmen_speichern(1, $1::jsonb)', ['{"geoeffnet":false}']), 'NUR_LEITUNG');
  await wirft(aufruf(stellv, 'select public.pep_einstellung_setzen($1, $2::jsonb)', ['ruhezeit_h', '10']), 'NUR_LEITUNG');
  await wirft(aufruf(stellv, 'select public.pep_schulferien_speichern(null, $1::date, $2::date, $3)',
    ['2027-01-01', '2027-01-02', 'X']), 'NUR_LEITUNG');
  // Lesen darf die Stellvertretung
  assert.equal((await json(stellv, 'select public.pep_einstellungen() as r')).rahmen.length, 7);
  // Benutzer einer anderen Filiale werden nicht übernommen
  const chef2 = await pepBenutzer(db, 'chef2');
  await filiale(db, chef2, { name: 'Netto Hanau', nummer: '9999' });
  await wirft(setze(leitung, 'chef2', 'stellvertretung'), 'BENUTZER_NICHT_GEFUNDEN');
  // Leitung ohne Filiale (start_leitung) darf zugeordnet werden
  const ohne = await pepBenutzer(db, 'ohnefiliale');
  await setze(leitung, 'ohnefiliale', 'stellvertretung');
  const z = (await alle()).benutzer.find((x) => x.user_id === ohne);
  assert.equal(z.rolle, 'stellvertretung');
});

test('Schreibzugriffe landen im Protokoll', async () => {
  const r = await db.query(
    'select distinct tabelle from pep.protokoll where filiale_id = $1 order by 1', [fil]);
  const t = r.rows.map((x) => x.tabelle);
  for (const n of ['rahmen', 'tag_abweichungen', 'einstellungen', 'abwesenheitscodes', 'bereiche', 'schulferien', 'benutzer']) {
    assert.ok(t.includes(n), n);
  }
});

test('Code-Gutschrift (Stufe 2): lesen, beim Anlegen Standard true, beim Ändern ohne Schlüssel unverändert; abschluss_vorhanden', async () => {
  const codeSpeichern = (id, d) =>
    json(leitung, 'select public.pep_code_speichern($1, $2::jsonb) as r', [id, JSON.stringify(d)]);
  const gutschrift = async (id) => (await alle()).codes.find((c) => c.id === id).gutschrift;
  const e = await alle();
  const g = Object.fromEntries(e.codes.map((c) => [c.code, c.gutschrift]));
  assert.equal(g.ZA, false);
  assert.equal(g.U, true);
  assert.equal(g.KM, true);
  assert.equal(e.abschluss_vorhanden, false);

  const gs = await codeSpeichern(null, { code: 'GS', name: 'Gutschrift-Test', farbe: '#123456', stundenregel: 'teiler' });
  assert.equal(await gutschrift(gs), true);
  const ng = await codeSpeichern(null, { code: 'NG', name: 'Ohne Gutschrift', farbe: '#123456', stundenregel: 'teiler', gutschrift: false });
  assert.equal(await gutschrift(ng), false);
  await codeSpeichern(ng, { name: 'Ohne Gutschrift neu' });
  assert.equal(await gutschrift(ng), false);
  await codeSpeichern(ng, { gutschrift: true });
  assert.equal(await gutschrift(ng), true);
  await codeSpeichern(ng, { gutschrift: false, sperrt: false });
  const ngNeu = (await alle()).codes.find((c) => c.id === ng);
  assert.deepEqual([ngNeu.gutschrift, ngNeu.sperrt, ngNeu.name], [false, false, 'Ohne Gutschrift neu']);
  // Die Stellvertretung liest die Codes mit, darf aber nicht schreiben
  assert.equal((await json(stellv, 'select public.pep_einstellungen() as r')).codes.find((c) => c.id === ng).gutschrift, false);
  await wirft(json(stellv, 'select public.pep_code_speichern($1, $2::jsonb) as r', [ng, '{"gutschrift":true}']), 'NUR_LEITUNG');

  // Nach dem ersten Wochenabschluss (Filiale ohne Mitarbeiter: eine vergangene Woche geht sofort)
  await json(leitung, 'select public.pep_wochenabschluss(2026, 10) as r');
  assert.equal((await alle()).abschluss_vorhanden, true);
  assert.equal((await json(stellv, 'select public.pep_einstellungen() as r')).abschluss_vorhanden, true);
});

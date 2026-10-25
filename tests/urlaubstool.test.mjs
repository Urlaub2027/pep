// Urlaubstool-Anbindung: Umfragen schalten, Teilnehmer zuordnen, Wünsche lesen, freigeben/ablehnen.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  neueDatenbank, als, pepBenutzer, organisator, filiale, heuteSetzen, umfrageAnlegen, urlaubsfrageId,
  umfrageMitarbeiter, abgeben,
} from './helfer.mjs';

let db, leitung, stellv, fremd, fil, anna, umfrage, frageId, tAnna, tBen, fremdeUmfrage;

const aufruf = (nutzer, sql, params = []) => als(db, 'authenticated', nutzer, sql, params);
const json = async (nutzer, sql, params = []) => (await aufruf(nutzer, sql, params))[0].r;
const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

const wunschKw = (kw, teilnehmer = tAnna) =>
  ({ umfrage_id: umfrage, urlaub_mitarbeiter_id: teilnehmer.id, art: 'kw', kw, datum: null });
const wunschTag = (datum, teilnehmer = tAnna) =>
  ({ umfrage_id: umfrage, urlaub_mitarbeiter_id: teilnehmer.id, art: 'tag', kw: null, datum });
const freigeben = (nutzer, von, bis, wunsch) => json(nutzer,
  'select public.pep_urlaub_freigeben($1, $2::date, $3::date, $4::jsonb, null) as r',
  [anna, von, bis, JSON.stringify(wunsch)]);
const monat = (j, m) => json(leitung, 'select public.pep_abwesenheiten($1, $2) as r', [j, m]);
const annaTage = async (m = 3) => (await monat(2027, m)).mitarbeiter.find((x) => x.id === anna).tage;
const wuensche = async (m = 3) => (await monat(2027, m)).wuensche;
const uTage = async (von, bis) => (await db.query(
  `select a.datum::text as datum, a.stunden::float as stunden, a.quelle, a.freigabe_id, c.code
     from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
    where a.mitarbeiter_id = $1 and a.datum between $2::date and $3::date order by a.datum`,
  [anna, von, bis])).rows;
const freigabe = async (id) => (await db.query(
  'select status, von::text as von, bis::text as bis, entschieden_von from pep.urlaub_freigaben where id = $1', [id])).rows[0];

before(async () => {
  db = await neueDatenbank();
  await heuteSetzen(db, '2026-10-24');
  leitung = await pepBenutzer(db, 'chef');
  fil = await filiale(db, leitung);
  stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  fremd = await pepBenutzer(db, 'fremdchef');
  await filiale(db, fremd, { name: 'Netto Fremdstadt', nummer: '9999' });
  anna = await json(leitung, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r',
    [JSON.stringify({ name: 'Test, Anna' })]);
  await aufruf(leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
    [anna, JSON.stringify({ vertragsart: 'teilzeit', wochenstunden: 37.5, gueltig_ab: '2026-01-01' })]);
  umfrage = await umfrageAnlegen(db, leitung);
  frageId = await urlaubsfrageId(db, umfrage);
  // Einzeltage sind in der Standardfrage aus und gelten erst, wenn die Höchstzahl Wochen voll ist:
  // hier eine Woche plus Einzeltage (wie im Editor des Urlaubstools eingestellt).
  await db.query("insert into urlaub.regeln (frage_id, art, wert) values ($1, 'einzeltage', 'null')", [frageId]);
  await db.query("update urlaub.regeln set wert = '1' where frage_id = $1 and art = 'max_wochen'", [frageId]);
  tAnna = await umfrageMitarbeiter(db, umfrage, 'Test,\tAnna');
  tBen = await umfrageMitarbeiter(db, umfrage, 'Muster, Ben');
  fremdeUmfrage = await umfrageAnlegen(db, fremd, { titel: 'Fremd 2027' });
});

test('pep_urlaub_umfragen listet die eigene Umfrage mit teilnehmer 2, abgaben 0; fremde Organisatoren nicht', async () => {
  const l = await json(leitung, 'select public.pep_urlaub_umfragen() as r');
  assert.equal(l.length, 1);
  assert.equal(l[0].id, umfrage);
  assert.equal(l[0].jahr, 2027);
  assert.equal(l[0].bundesland, 'BY');
  assert.equal(l[0].aktiv, false);
  assert.equal(l[0].teilnehmer, 2);
  assert.equal(l[0].abgaben, 0);
  assert.equal(l[0].organisator, 'chef');
  assert.equal(l[0].eigene, true);
  // Die Stellvertretung sieht nur, was für die Filiale schon eingeschaltet ist (sie kann nicht einschalten).
  assert.deepEqual(await json(stellv, 'select public.pep_urlaub_umfragen() as r'), []);
});

test('Umfrage schalten: nur Leitung, fremde Umfrage UMFRAGE_NICHT_GEFUNDEN', async () => {
  await wirft(aufruf(stellv, 'select public.pep_urlaub_umfrage_schalten($1, true)', [umfrage]), 'NUR_LEITUNG');
  await wirft(aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [fremdeUmfrage]), 'UMFRAGE_NICHT_GEFUNDEN');
  await aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [umfrage]);
  const l = await json(leitung, 'select public.pep_urlaub_umfragen() as r');
  assert.equal(l[0].aktiv, true);
  const sv = await json(stellv, 'select public.pep_urlaub_umfragen() as r');
  assert.deepEqual(sv.map((u) => [u.id, u.organisator, u.eigene, u.aktiv]), [[umfrage, 'chef', false, true]]);
});

test('Umfrage eines Organisators: als Stellvertretung unsichtbar, als Leitung erst nach eigener Anmeldung; entfernt: nur noch die eingeschaltete', async () => {
  const extern = await organisator(db, 'extern');
  const externeUmfrage = await umfrageAnlegen(db, extern, { titel: 'Extern 2027' });
  const sichtbar = async () => (await json(leitung, 'select public.pep_urlaub_umfragen() as r')).some((u) => u.id === externeUmfrage);
  const einschalten = (wer) => aufruf(wer, 'select public.pep_urlaub_umfrage_schalten($1, true)', [externeUmfrage]);
  // Noch kein PEP-Benutzer: unsichtbar, Einschalten UMFRAGE_NICHT_GEFUNDEN
  assert.equal(await sichtbar(), false);
  await wirft(einschalten(leitung), 'UMFRAGE_NICHT_GEFUNDEN');
  // Als Stellvertretung der Filiale eingetragen: weiter unsichtbar und nicht einschaltbar (nur Umfragen von Leitungen)
  await aufruf(leitung, 'select public.pep_benutzer_setzen($1, $2)', ['extern', 'stellvertretung']);
  assert.equal(await sichtbar(), false);
  await wirft(einschalten(leitung), 'UMFRAGE_NICHT_GEFUNDEN');
  await wirft(einschalten(extern), 'NUR_LEITUNG');
  // Rolle mitarbeiter (nur über eine Sicherung möglich): ebenso nicht
  await db.query("update pep.benutzer set rolle = 'mitarbeiter' where user_id = $1", [extern]);
  assert.equal(await sichtbar(), false);
  await wirft(einschalten(leitung), 'UMFRAGE_NICHT_GEFUNDEN');
  // Als Leitung eingetragen, aber noch nie selbst angemeldet: weiter unsichtbar (sonst könnte jede Leitung fremde
  // Organisatoren eintragen und deren Umfragen lesen)
  await aufruf(leitung, 'select public.pep_benutzer_setzen($1, $2)', ['extern', 'leitung']);
  assert.equal(await sichtbar(), false);
  await wirft(einschalten(leitung), 'UMFRAGE_NICHT_GEFUNDEN');
  // Nach der eigenen Anmeldung (pep_ich): sichtbar und einschaltbar
  await aufruf(extern, 'select public.pep_ich()');
  assert.equal(await sichtbar(), true);
  await einschalten(leitung);
  // Wieder entfernt: die eingeschaltete Umfrage bleibt sichtbar und lässt sich ausschalten, danach ist sie weg
  await aufruf(leitung, 'select public.pep_benutzer_entfernen($1)', [extern]);
  assert.equal(await sichtbar(), true);
  await aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, false)', [externeUmfrage]);
  assert.equal(await sichtbar(), false);
  await wirft(einschalten(leitung), 'UMFRAGE_NICHT_GEFUNDEN');
  assert.equal((await db.query('select count(*)::int as n from pep.urlaub_umfragen where umfrage_id = $1', [externeUmfrage])).rows[0].n, 0);
});

test('Zuordnungsvorschlag trifft trotz Tab und Groß/Klein; setzen und lösen', async () => {
  const z = await json(stellv, 'select public.pep_urlaub_zuordnung() as r');
  assert.equal(z.length, 2);
  assert.equal(z.find((t) => t.name.includes('Test')).vorschlag_id, anna);
  assert.equal(z.find((t) => t.name.includes('Test')).mitarbeiter_id, null);
  assert.equal(z.find((t) => t.name.includes('Muster')).vorschlag_id, null);
  await wirft(aufruf(stellv, 'select public.pep_urlaub_zuordnung_setzen($1, $2)', [tAnna.id, anna]), 'NUR_LEITUNG');
  await wirft(aufruf(leitung, 'select public.pep_urlaub_zuordnung_setzen($1, 999999)', [tAnna.id]), 'MITARBEITER_NICHT_GEFUNDEN');
  await aufruf(leitung, 'select public.pep_urlaub_zuordnung_setzen($1, $2)', [tAnna.id, anna]);
  const z2 = await json(leitung, 'select public.pep_urlaub_zuordnung() as r');
  assert.equal(z2.find((t) => t.urlaub_mitarbeiter_id === tAnna.id).mitarbeiter_id, anna);
  await aufruf(leitung, 'select public.pep_urlaub_zuordnung_setzen($1, null)', [tAnna.id]);
  assert.equal((await json(leitung, 'select public.pep_urlaub_zuordnung() as r'))
    .find((t) => t.urlaub_mitarbeiter_id === tAnna.id).mitarbeiter_id, null);
  await aufruf(leitung, 'select public.pep_urlaub_zuordnung_setzen($1, $2)', [tAnna.id, anna]);
});

const wunschZeilen = async () => (await db.query(
  `select mitarbeiter_id, umfrage_id, urlaub_mitarbeiter_id, art, kw, von::text as von, bis::text as bis
     from pep.urlaubswuensche($1, '2027-01-01', '2027-12-31') order by von`, [fil])).rows;

test('ohne Abgabe keine Wünsche; nach Abgabe [12, "2027-03-05"] zwei Wünsche; Nichtzugeordnete liefern keine', async () => {
  assert.deepEqual(await wunschZeilen(), []);
  await abgeben(db, tAnna.code, { [frageId]: [12, '2027-03-05'] });
  await abgeben(db, tBen.code, { [frageId]: [14] }); // nicht zugeordnet
  assert.deepEqual(await wunschZeilen(), [
    { mitarbeiter_id: anna, umfrage_id: umfrage, urlaub_mitarbeiter_id: tAnna.id, art: 'tag', kw: null, von: '2027-03-05', bis: '2027-03-05' },
    { mitarbeiter_id: anna, umfrage_id: umfrage, urlaub_mitarbeiter_id: tAnna.id, art: 'kw', kw: 12, von: '2027-03-22', bis: '2027-03-27' },
  ]);
  const nurApril = (await db.query(
    "select count(*)::int as n from pep.urlaubswuensche($1, '2027-04-01', '2027-04-30')", [fil])).rows[0].n;
  assert.equal(nurApril, 0);
});

test('pep_abwesenheiten(2027,3).wuensche enthält beide mit status offen', async () => {
  const w = await wuensche();
  assert.equal(w.length, 2);
  assert.ok(w.every((x) => x.status === 'offen' && x.freigabe_id === null && x.mitarbeiter_id === anna));
  assert.equal(w.find((x) => x.art === 'kw').kw, 12);
  assert.equal(w.find((x) => x.art === 'kw').von, '2027-03-22');
  assert.equal(w.find((x) => x.art === 'tag').von, '2027-03-05');
  assert.equal((await wuensche(5)).length, 0);
  // Schnappschuss-Schlüssel, die pep_urlaub_freigeben/-ablehnen im p_wunsch erwarten
  assert.ok(w.every((x) => x.umfrage_id === umfrage && x.urlaub_mitarbeiter_id === tAnna.id));
  assert.equal(w.find((x) => x.art === 'tag').datum, '2027-03-05');
  assert.equal(w.find((x) => x.art === 'kw').datum, null);
});

let freigabeKw12;
test('freigeben KW 12 → U-Tage à 6.25 mit quelle urlaubstool (Karfreitag zu); genehmigt', async () => {
  await wirft(freigeben(stellv, '2027-03-22', '2027-03-27', wunschKw(12)), 'NUR_LEITUNG');
  await wirft(freigeben(leitung, '2027-03-27', '2027-03-22', wunschKw(12)), 'ZEITRAUM_UNGUELTIG');
  await wirft(freigeben(leitung, '2027-03-22', '2027-03-27', { art: 'kw', kw: 12 }), 'WUNSCH_UNGUELTIG');
  freigabeKw12 = await freigeben(leitung, '2027-03-22', '2027-03-27', wunschKw(12));
  const t = await uTage('2027-03-01', '2027-03-31');
  // Mo–Sa 22.–27.03.; Karfreitag 26.03. ist Feiertag in Bayern und bleibt zu
  assert.deepEqual(t.map((x) => x.datum), ['2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-27']);
  assert.ok(t.every((x) => x.stunden === 6.25 && x.quelle === 'urlaubstool' && x.code === 'U' && x.freigabe_id === freigabeKw12));
  const f = await freigabe(freigabeKw12);
  assert.equal(f.status, 'genehmigt');
  assert.equal(f.entschieden_von, leitung);
  const u = (await monat(2027, 3)).urlaub.find((x) => x.mitarbeiter_id === anna);
  assert.equal(u.genehmigt, 31.25);
  const w = (await wuensche()).find((x) => x.art === 'kw');
  assert.equal(w.status, 'genehmigt');
  assert.equal(w.freigabe_id, freigabeKw12);
  assert.equal((await annaTage())['2027-03-22'].wunsch_geaendert, false);
  await wirft(freigeben(leitung, '2027-03-22', '2027-03-27', wunschKw(12)), 'FREIGABE_VORHANDEN');
});

test('ablehnen Tag 2027-03-05 → status abgelehnt, keine Abwesenheit', async () => {
  const id = await json(leitung, 'select public.pep_urlaub_ablehnen($1, $2::jsonb, $3) as r',
    [anna, JSON.stringify(wunschTag('2027-03-05')), 'zu viel los']);
  assert.equal((await freigabe(id)).status, 'abgelehnt');
  assert.deepEqual(await uTage('2027-03-05', '2027-03-05'), []);
  const w = (await wuensche()).find((x) => x.art === 'tag');
  assert.equal(w.status, 'abgelehnt');
  assert.equal(w.freigabe_id, id);
  await wirft(aufruf(stellv, 'select public.pep_urlaub_ablehnen($1, $2::jsonb, null)',
    [anna, JSON.stringify(wunschTag('2027-03-05'))]), 'NUR_LEITUNG');
});

test('Wunsch geändert: neue Abgabe [13] → Tage der KW 12 wunsch_geaendert true; KW 13 offen', async () => {
  await abgeben(db, tAnna.code, { [frageId]: [13] });
  const tage = await annaTage();
  assert.equal(tage['2027-03-22'].wunsch_geaendert, true);
  assert.equal(tage['2027-03-27'].wunsch_geaendert, true);
  const w = await wuensche();
  assert.deepEqual(w.map((x) => [x.art, x.kw, x.status]), [['kw', 13, 'offen']]);
});

test('zuruecknehmen löscht die Tage, Freigabe abgelehnt', async () => {
  await wirft(aufruf(stellv, 'select public.pep_freigabe_zuruecknehmen($1)', [freigabeKw12]), 'NUR_LEITUNG');
  await wirft(aufruf(leitung, 'select public.pep_freigabe_zuruecknehmen(999999)'), 'FREIGABE_NICHT_GEFUNDEN');
  const n = await json(leitung, 'select public.pep_freigabe_zuruecknehmen($1) as r', [freigabeKw12]);
  assert.equal(n, 5);
  assert.deepEqual(await uTage('2027-03-01', '2027-03-31'), []);
  assert.equal((await freigabe(freigabeKw12)).status, 'abgelehnt');
});

const anzahlFreigaben = async () => (await db.query('select count(*)::int as n from pep.urlaub_freigaben')).rows[0].n;

test('Wunsch muss zum Mitarbeiter passen und in der Antwort stehen: sonst WUNSCH_UNGUELTIG, nichts geschrieben', async () => {
  const ben = await json(leitung, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r',
    [JSON.stringify({ name: 'Muster, Ben' })]);
  await aufruf(leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
    [ben, JSON.stringify({ vertragsart: 'teilzeit', wochenstunden: 30, gueltig_ab: '2026-01-01' })]);
  const vorher = await anzahlFreigaben();
  const fremderMa = (sql, wunsch) => aufruf(leitung, sql, [ben, JSON.stringify(wunsch)]);
  // Annas Wunsch (Teilnehmer Anna) mit Bens mitarbeiter_id; Ben ist nicht zugeordnet
  await wirft(aufruf(leitung, 'select public.pep_urlaub_freigeben($1, null, null, $2::jsonb, null)',
    [ben, JSON.stringify(wunschKw(13))]), 'WUNSCH_UNGUELTIG');
  await wirft(fremderMa('select public.pep_urlaub_ablehnen($1, $2::jsonb, null)', wunschKw(13)), 'WUNSCH_UNGUELTIG');
  // KW 40 hat sich Anna nie gewünscht
  await wirft(freigeben(leitung, '2027-10-04', '2027-10-09', wunschKw(40)), 'WUNSCH_UNGUELTIG');
  await wirft(aufruf(leitung, 'select public.pep_urlaub_ablehnen($1, $2::jsonb, null)',
    [anna, JSON.stringify(wunschKw(40))]), 'WUNSCH_UNGUELTIG');
  await wirft(freigeben(leitung, '2027-03-06', '2027-03-06', wunschTag('2027-03-06')), 'WUNSCH_UNGUELTIG');
  assert.equal(await anzahlFreigaben(), vorher);
  assert.deepEqual(await uTage('2027-01-01', '2027-12-31'), []);
});

test('Zeitraum der Freigabe: ohne Angabe die ganze Woche, kürzen erlaubt, länger/außerhalb ZEITRAUM_UNGUELTIG', async () => {
  const frei = (von, bis) => json(leitung,
    'select public.pep_urlaub_freigeben($1, $2::date, $3::date, $4::jsonb, null) as r',
    [anna, von, bis, JSON.stringify(wunschKw(13))]);
  const zurueck = (id) => json(leitung, 'select public.pep_freigabe_zuruecknehmen($1) as r', [id]);
  // KW 13 = Mo 29.03. (Ostermontag, zu) bis Sa 03.04.2027
  await wirft(frei('2027-03-29', '2027-04-04'), 'ZEITRAUM_UNGUELTIG'); // länger als die Woche
  await wirft(frei('2027-03-28', '2027-04-03'), 'ZEITRAUM_UNGUELTIG'); // beginnt vor der Woche
  await wirft(frei('2027-01-01', '2027-12-31'), 'ZEITRAUM_UNGUELTIG'); // ganzes Jahr
  assert.deepEqual(await uTage('2027-01-01', '2027-12-31'), []);
  const id = await frei(null, null);
  const voll = await uTage('2027-03-01', '2027-04-30');
  assert.deepEqual(voll.map((x) => x.datum), ['2027-03-30', '2027-03-31', '2027-04-01', '2027-04-02', '2027-04-03']);
  assert.equal(await zurueck(id), 5);
  assert.equal(await frei('2027-03-30', '2027-04-01'), id); // Di–Do
  assert.deepEqual((await uTage('2027-03-01', '2027-04-30')).map((x) => x.datum), ['2027-03-30', '2027-03-31', '2027-04-01']);
  const f = await freigabe(id);
  assert.deepEqual([f.von, f.bis, f.status], ['2027-03-30', '2027-04-01', 'genehmigt']);
  await zurueck(id);
  assert.deepEqual(await uTage('2027-01-01', '2027-12-31'), []);
});

test('pep_abwesenheit_loeschen setzt die Freigabe erst auf abgelehnt, wenn kein Tag übrig ist', async () => {
  const id = await freigeben(leitung, '2027-03-29', '2027-04-03', wunschKw(13));
  assert.equal((await freigabe(id)).status, 'genehmigt');
  const loesche = (von, bis) => json(leitung,
    'select public.pep_abwesenheit_loeschen($1, $2::date, $3::date) as r', [anna, von, bis]);
  assert.equal(await loesche('2027-03-30', '2027-03-30'), 1);
  assert.equal((await freigabe(id)).status, 'genehmigt');
  assert.ok((await uTage('2027-03-29', '2027-04-03')).length > 0);
  await loesche('2027-03-29', '2027-04-03');
  assert.equal((await freigabe(id)).status, 'abgelehnt');
});

test('Umfrage im Urlaubstool löschen bricht nicht: Zuordnung und urlaub_umfragen weg, Freigaben und Tage bleiben', async () => {
  const id = await freigeben(leitung, '2027-04-01', '2027-04-01', wunschKw(13));
  await aufruf(leitung, 'select public.org_umfrage_loeschen($1)', [umfrage]);
  const n = async (t) => (await db.query(`select count(*)::int as n from ${t}`)).rows[0].n;
  assert.equal(await n('pep.urlaub_umfragen'), 0);
  assert.equal(await n('pep.urlaub_zuordnung'), 0);
  assert.equal(await n('pep.urlaub_freigaben'), 3); // KW 12, Tag 05.03., KW 13
  assert.equal((await freigabe(id)).status, 'genehmigt');
  assert.equal((await uTage('2027-04-01', '2027-04-01')).length, 1);
});

test('Ausschalten klappt auch, wenn der Eigentümer nicht mehr in der Filiale ist', async () => {
  const chef2 = await pepBenutzer(db, 'chef2', 'leitung', fil);
  const o = await pepBenutzer(db, 'ehemalig', 'leitung', fil);
  const u = await umfrageAnlegen(db, o, { titel: 'Ehemalig 2027' });
  await aufruf(o, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]);
  await aufruf(chef2, 'select public.pep_benutzer_entfernen($1)', [o]);
  await aufruf(chef2, 'select public.pep_urlaub_umfrage_schalten($1, false)', [u]);
  assert.equal((await db.query('select count(*)::int as n from pep.urlaub_umfragen where umfrage_id = $1', [u])).rows[0].n, 0);
  await wirft(aufruf(chef2, 'select public.pep_urlaub_umfrage_schalten($1, false)', [u]), 'UMFRAGE_NICHT_GEFUNDEN');
});

// ------------------------------------------------------------ Task 13: Umfragen anderer Leitungen der Filiale (nach ihrer ersten Anmeldung)

test('Umfrage einer anderen Leitung der Filiale: nach ihrer ersten Anmeldung sichtbar mit Organisator, jede Leitung schaltet ein, Stellvertretung nicht', async () => {
  const leiterin = await pepBenutzer(db, 'leiterin', 'leitung', fil);
  await db.query("update urlaub.organisatoren set anzeigename = 'Leiterin Nord' where user_id = $1", [leiterin]);
  const u = await umfrageAnlegen(db, leiterin, { titel: 'Wünsche Leiterin 2027' });
  // Neu eingetragen, noch nicht selbst angemeldet: für chef unsichtbar und nicht einschaltbar
  assert.ok(!(await json(leitung, 'select public.pep_urlaub_umfragen() as r')).some((x) => x.id === u));
  await wirft(aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]), 'UMFRAGE_NICHT_GEFUNDEN');
  assert.equal((await db.query('select bestaetigt_am from pep.benutzer where user_id = $1', [leiterin])).rows[0].bestaetigt_am, null);
  await aufruf(leiterin, 'select public.pep_ich()');
  const l = await json(leitung, 'select public.pep_urlaub_umfragen() as r');
  const zeile = l.find((x) => x.id === u);
  assert.ok(zeile, 'für chef sichtbar');
  assert.deepEqual([zeile.organisator, zeile.eigene, zeile.aktiv, zeile.jahr], ['Leiterin Nord', false, false, 2027]);
  assert.equal((await json(leiterin, 'select public.pep_urlaub_umfragen() as r')).find((x) => x.id === u).eigene, true);
  await wirft(aufruf(stellv, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]), 'NUR_LEITUNG');
  await aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]);
  assert.deepEqual((await db.query('select filiale_id from pep.urlaub_umfragen where umfrage_id = $1', [u])).rows, [{ filiale_id: fil }]);
  assert.equal((await json(stellv, 'select public.pep_urlaub_umfragen() as r')).find((x) => x.id === u).aktiv, true);
  // Teilnehmer erscheinen zum Zuordnen; die Leiterin schaltet wieder aus
  await umfrageMitarbeiter(db, u, 'Anna Test');
  assert.ok((await json(leitung, 'select public.pep_urlaub_zuordnung() as r')).some((t) => t.umfrage_id === u));
  await aufruf(leiterin, 'select public.pep_urlaub_umfrage_schalten($1, false)', [u]);
  assert.equal((await db.query('select count(*)::int as n from pep.urlaub_umfragen where umfrage_id = $1', [u])).rows[0].n, 0);
});

test('Organisator ohne PEP-Benutzer oder aus einer fremden Filiale: unsichtbar und UMFRAGE_NICHT_GEFUNDEN', async () => {
  const ohne = await organisator(db, 'nurumfrage');
  const u = await umfrageAnlegen(db, ohne, { titel: 'Ohne PEP 2027' });
  const ids = (await json(leitung, 'select public.pep_urlaub_umfragen() as r')).map((x) => x.id);
  assert.ok(!ids.includes(u));
  assert.ok(!ids.includes(fremdeUmfrage));
  await wirft(aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]), 'UMFRAGE_NICHT_GEFUNDEN');
  await wirft(aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [fremdeUmfrage]), 'UMFRAGE_NICHT_GEFUNDEN');
  // Umfrage ohne Urlaubswochen-Frage einer Leitung der Filiale: ebenfalls nicht
  const ohneFrage = (await db.query("insert into urlaub.umfragen (organisator_id, titel, frist) values ($1, 'Nur Text', now() + interval '1 day') returning id",
    [leitung])).rows[0].id;
  assert.ok(!(await json(leitung, 'select public.pep_urlaub_umfragen() as r')).some((x) => x.id === ohneFrage));
  await wirft(aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [ohneFrage]), 'UMFRAGE_NICHT_GEFUNDEN');
  assert.equal((await db.query('select count(*)::int as n from pep.urlaub_umfragen where umfrage_id = any ($1)',
    [[u, fremdeUmfrage, ohneFrage]])).rows[0].n, 0);
});

test('pep.namensteile: Kleinschreibung, Kommas weg, Bindestrich und Leerraum trennen, sortiert und ohne Doppelte', async () => {
  const teile = async (t) => (await db.query('select pep.namensteile($1) as t', [t])).rows[0].t;
  assert.deepEqual(await teile('Muster-Beispiel,\tAnna '), ['anna', 'beispiel', 'muster']);
  assert.deepEqual(await teile('Anna  MUSTER - Beispiel'), ['anna', 'beispiel', 'muster']);
  assert.deepEqual(await teile('anna, Anna'), ['anna']);
  assert.deepEqual(await teile(' , - '), []);
  assert.deepEqual(await teile(null), []);
  // Punkte weg, Halbgeviert- und Geviertstrich trennen wie der Bindestrich
  assert.deepEqual(await teile('Dr. Muster–Beispiel — Anna'), ['anna', 'beispiel', 'dr', 'muster']);
  assert.deepEqual(await teile('A.Muster'), ['a', 'muster']);
  assert.deepEqual(await teile(' . – — '), []);
  // pep.name_normal (Sicherung: Titel und Teilnehmer) bleibt unverändert
  assert.equal((await db.query("select pep.name_normal(' Dr.  Muster–Beispiel,\tAnna ') as n")).rows[0].n, 'dr. muster–beispiel, anna');
});

test('Zuordnungsvorschlag unabhängig von der Reihenfolge: gleiche Menge vor Teilmenge, mehrdeutig und inaktiv nie', async () => {
  // Eigene Filiale mit festem Mitarbeiterbestand (erfundene Namen)
  const nord = await pepBenutzer(db, 'nordchef');
  await filiale(db, nord, { name: 'Netto Nordstadt', nummer: '8888' });
  const ma = {};
  // Vorlage, Eva gibt es zweimal (alter Eintrag inaktiv, neuer aktiv); ma hält den zuletzt angelegten
  for (const [name, aktiv] of [['Probe, Lena', true], ['Demo, Karl', true], ['Skizze, Mia', true], ['Vorlage, Mia', true],
    ['Muster-Beispiel, Anna', true], ['Fiktiv, Uwe', false], ['Probe, Tom', true], ['Probe-Lang, Tom', true], ['Ng, J', true],
    ['Beispiel, Ole', false], ['Beispiel-Hof, Ole', true], ['Vorlage, Eva', false], ['Vorlage, Eva', true]]) {
    ma[name] = await json(nord, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name, aktiv })]);
  }
  const u = await umfrageAnlegen(db, nord, { titel: 'Nord 2027' });
  await aufruf(nord, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]);
  const faelle = [
    ['Lena Probe', 'Probe, Lena'], // Vorname Nachname ↔ Nachname, Vorname
    ['Karl', 'Demo, Karl'], // nur Vorname, eindeutig
    ['Mia', null], // nur Vorname, zweimal vorhanden
    ['Anna Muster-Beispiel', 'Muster-Beispiel, Anna'], // Doppelname mit Bindestrich
    ['Anna Muster Beispiel', 'Muster-Beispiel, Anna'], // Doppelname ohne Bindestrich
    ['anna muster', 'Muster-Beispiel, Anna'], // Teil des Doppelnamens, eindeutig
    ['Uwe Fiktiv', null], // inaktiv
    ['Tom Probe', 'Probe, Tom'], // gleiche Menge schlägt die Obermenge „Probe-Lang, Tom“
    ['Tom', null], // zwei Obermengen
    ['J', null], // nur ein einzelner Buchstabe
    ['Lena Probe Extra', null], // mehr Teile als jeder Mitarbeiter
    ['Ole Beispiel', null], // gleiche Menge nur bei einem Inaktiven: die aktive Obermenge „Beispiel-Hof, Ole“ wird nicht vorgeschlagen
    ['Eva Vorlage', null], // zweimal dieselbe Menge (einer inaktiv): mehrdeutig
  ];
  const tn = {};
  for (const [name] of faelle) tn[name] = (await umfrageMitarbeiter(db, u, name)).id;
  const v = Object.fromEntries((await json(nord, 'select public.pep_urlaub_zuordnung() as r')).map((t) => [t.name, t.vorschlag_id]));
  for (const [name, erwartet] of faelle) assert.equal(v[name], erwartet === null ? null : ma[erwartet], name);
  // Schon zugeordnete Mitarbeiter werden nicht ausgeschlossen (zwei Umfragen dürfen auf denselben zeigen)
  await aufruf(nord, 'select public.pep_urlaub_zuordnung_setzen($1, $2)', [tn['Lena Probe'], ma['Probe, Lena']]);
  const zweite = await umfrageAnlegen(db, nord, { titel: 'Nord Nachtrag 2027' });
  await aufruf(nord, 'select public.pep_urlaub_umfrage_schalten($1, true)', [zweite]);
  const nochmal = (await umfrageMitarbeiter(db, zweite, 'Probe,  Lena')).id;
  const z = await json(nord, 'select public.pep_urlaub_zuordnung() as r');
  assert.equal(z.find((t) => t.urlaub_mitarbeiter_id === nochmal).vorschlag_id, ma['Probe, Lena']);
  assert.equal(z.find((t) => t.urlaub_mitarbeiter_id === tn['Lena Probe']).vorschlag_id, ma['Probe, Lena']);
});

test('schon in einer anderen Filiale eingeschaltet → UMFRAGE_ANDERE_FILIALE, nichts geändert', async () => {
  // Organisator wechselt die Filiale: seine Umfrage bleibt in der alten eingeschaltet
  const wechsler = await pepBenutzer(db, 'wechsler', 'leitung', fil);
  const u = await umfrageAnlegen(db, wechsler, { titel: 'Wechsel 2027' });
  await aufruf(wechsler, 'select public.pep_ich()');
  await aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]);
  await aufruf(leitung, 'select public.pep_benutzer_entfernen($1)', [wechsler]);
  await aufruf(fremd, 'select public.pep_benutzer_setzen($1, $2)', ['wechsler', 'leitung']);
  await aufruf(wechsler, 'select public.pep_ich()'); // in der neuen Filiale erneut angemeldet
  const vorher = (await db.query('select count(*)::int as n from pep.protokoll')).rows[0].n;
  assert.ok((await json(fremd, 'select public.pep_urlaub_umfragen() as r')).some((x) => x.id === u && !x.aktiv));
  await wirft(aufruf(fremd, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]), 'UMFRAGE_ANDERE_FILIALE');
  assert.deepEqual((await db.query('select filiale_id from pep.urlaub_umfragen where umfrage_id = $1', [u])).rows, [{ filiale_id: fil }]);
  assert.equal((await db.query('select count(*)::int as n from pep.protokoll')).rows[0].n, vorher);
  // In der eigenen Filiale bleibt erneutes Einschalten unschädlich
  await aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]);
  assert.deepEqual((await db.query('select filiale_id from pep.urlaub_umfragen where umfrage_id = $1', [u])).rows, [{ filiale_id: fil }]);
});

// ------------------------------------------------------------ Task 13, Nacharbeit: Anmeldung und Filialwechsel

test('bestaetigt_am: pep_ich setzt es einmal für sich selbst; Rollenwechsel behält es, Wechsel der Filiale löscht es', async () => {
  const neu = await pepBenutzer(db, 'neuleitung', 'leitung', fil);
  const am = async (u) => (await db.query('select bestaetigt_am from pep.benutzer where user_id = $1', [u])).rows[0]?.bestaetigt_am ?? null;
  assert.equal(await am(neu), null);
  // Ein anderer meldet sich an: ändert nichts an neu
  await aufruf(stellv, 'select public.pep_ich()');
  assert.equal(await am(neu), null);
  await aufruf(neu, 'select public.pep_ich()');
  const erst = await am(neu);
  assert.ok(erst instanceof Date);
  await db.query("update pep.benutzer set bestaetigt_am = '2026-01-01T12:00:00Z' where user_id = $1", [neu]);
  await aufruf(neu, 'select public.pep_ich()'); // spätere Anmeldungen überschreiben nicht
  assert.equal((await am(neu)).toISOString().slice(0, 10), '2026-01-01');
  // Rolle in derselben Filiale ändern: bleibt bestätigt
  await aufruf(leitung, 'select public.pep_benutzer_setzen($1, $2)', ['neuleitung', 'stellvertretung']);
  assert.notEqual(await am(neu), null);
  await aufruf(leitung, 'select public.pep_benutzer_setzen($1, $2)', ['neuleitung', 'leitung']);
  assert.notEqual(await am(neu), null);
  // Ohne Filiale (z. B. per SQL gelöst) und von einer anderen Leitung eingetragen: muss sich erneut anmelden
  await db.query('update pep.benutzer set filiale_id = null where user_id = $1', [neu]);
  await aufruf(fremd, 'select public.pep_benutzer_setzen($1, $2)', ['neuleitung', 'leitung']);
  assert.equal(await am(neu), null);
  await aufruf(fremd, 'select public.pep_benutzer_entfernen($1)', [neu]);
});

test('Übergabe einer Umfrage an eine andere Filiale: Ausschalten löscht die Zuordnungen, alte Zeilen werden übernommen', async () => {
  const gast = await pepBenutzer(db, 'gast', 'leitung', fil);
  await aufruf(gast, 'select public.pep_ich()');
  const u = await umfrageAnlegen(db, gast, { titel: 'Übergabe 2027' });
  const t = await umfrageMitarbeiter(db, u, 'Test, Anna');
  const anzahl = async (sql, p) => (await db.query(sql, p)).rows[0].n;
  const andere = await anzahl('select count(*)::int as n from pep.urlaub_zuordnung z join urlaub.mitarbeiter m on m.id = z.urlaub_mitarbeiter_id where m.umfrage_id <> $1', [u]);
  await aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]);
  await aufruf(leitung, 'select public.pep_urlaub_zuordnung_setzen($1, $2)', [t.id, anna]);
  // Ausschalten in A: Zuordnungen dieser Umfrage in A weg, andere bleiben
  await aufruf(leitung, 'select public.pep_urlaub_umfrage_schalten($1, false)', [u]);
  assert.equal(await anzahl('select count(*)::int as n from pep.urlaub_zuordnung where urlaub_mitarbeiter_id = $1', [t.id]), 0);
  assert.equal(await anzahl('select count(*)::int as n from pep.urlaub_zuordnung z join urlaub.mitarbeiter m on m.id = z.urlaub_mitarbeiter_id where m.umfrage_id <> $1', [u]), andere);
  // Zeile aus der Zeit vor dieser Regel (Filiale A, Umfrage nicht mehr eingeschaltet)
  await db.query('insert into pep.urlaub_zuordnung (urlaub_mitarbeiter_id, mitarbeiter_id, filiale_id) values ($1, $2, $3)', [t.id, anna, fil]);
  // gast wechselt nach B (Fremdstadt) und meldet sich dort an; B schaltet ein und ordnet zu
  await aufruf(leitung, 'select public.pep_benutzer_entfernen($1)', [gast]);
  await aufruf(fremd, 'select public.pep_benutzer_setzen($1, $2)', ['gast', 'leitung']);
  await aufruf(gast, 'select public.pep_ich()');
  await aufruf(fremd, 'select public.pep_urlaub_umfrage_schalten($1, true)', [u]);
  const annaB = await json(fremd, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name: 'Test, Anna' })]);
  const fremdFil = (await db.query('select filiale_id from pep.benutzer where user_id = $1', [fremd])).rows[0].filiale_id;
  await aufruf(fremd, 'select public.pep_urlaub_zuordnung_setzen($1, $2)', [t.id, annaB]);
  assert.deepEqual((await db.query('select mitarbeiter_id, filiale_id from pep.urlaub_zuordnung where urlaub_mitarbeiter_id = $1', [t.id])).rows,
    [{ mitarbeiter_id: annaB, filiale_id: fremdFil }]);
  assert.equal((await json(fremd, 'select public.pep_urlaub_zuordnung() as r')).find((x) => x.urlaub_mitarbeiter_id === t.id).mitarbeiter_id, annaB);
});

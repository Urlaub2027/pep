// Stammdaten: Mitarbeiter, Verträge, Bereiche, Kompetenzen, Wochenvorgaben, Urlaubsjahre.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale } from './helfer.mjs';

let db, leitung, stellv, fil;

const aufruf = (nutzer, sql, params = []) => als(db, 'authenticated', nutzer, sql, params);
const json = async (nutzer, sql, params = []) => (await aufruf(nutzer, sql, params))[0].r;
const fehler = (nutzer, sql, params, code) =>
  assert.rejects(aufruf(nutzer, sql, params), (e) => e.message.includes(code), code);
const wirft = (versprechen, code) =>
  assert.rejects(versprechen, (e) => e.message.includes(code), code);

const neuerMitarbeiter = (name = 'Muster, Ben') =>
  json(leitung, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name })]);
const bereiche = () => json(leitung, 'select public.pep_bereiche() as r');
const vertrag = (mid, daten) =>
  json(leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb) as r', [mid, JSON.stringify(daten)]);
const vorgabe = (mid, daten) =>
  json(leitung, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [mid, JSON.stringify(daten)]);

before(async () => {
  db = await neueDatenbank();
  leitung = await pepBenutzer(db, 'chef');
  fil = await filiale(db, leitung);
  stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
});

test('Grundausstattung legt 15 Bereiche an, KA braucht Kompetenz, PO inaktiv', async () => {
  const b = await bereiche();
  assert.equal(b.length, 15);
  assert.deepEqual(b.map((x) => x.kuerzel),
    ['KA', 'OG', 'BB', 'TS', 'MO', 'TK', 'FÜ', 'RE', 'BO', 'PA', 'PO', 'KI', 'GM', 'BE', 'VP']);
  const ka = b.find((x) => x.kuerzel === 'KA');
  assert.equal(ka.kompetenz_noetig, true);
  assert.equal(ka.farbe, '#7FD1FF');
  assert.equal(b.find((x) => x.kuerzel === 'PO').aktiv, false);
  assert.equal(b.find((x) => x.kuerzel === 'PA').art, 'pause');
  assert.equal(b.find((x) => x.kuerzel === 'VP').art, 'funktion');
  // erneuter Aufruf ist unschädlich
  await db.query('select pep.grundausstattung($1)', [fil]);
  assert.equal((await bereiche()).length, 15);
});

test('Mitarbeiter anlegen, Name wird getrimmt, Liste ohne Vertrag hat vertragsart null', async () => {
  const id = (await aufruf(leitung,
    `select public.pep_mitarbeiter_speichern(null, '{"name":"  Test,\\tAnna "}') as r`))[0].r;
  const l = await json(leitung, 'select public.pep_mitarbeiter_liste() as r');
  const m = l.find((x) => x.id === id);
  assert.equal(m.name, 'Test, Anna');
  assert.equal(m.vertragsart, null);
  assert.equal(m.wochenstunden, null);
  assert.deepEqual(m.kompetenzen, []);
});

test('Mitarbeiter ändern, Liste sortiert aktive zuerst', async () => {
  const a = await neuerMitarbeiter('Sortiert, Zora');
  const b = await neuerMitarbeiter('Sortiert, Yvo');
  await json(leitung, 'select public.pep_mitarbeiter_speichern($1, $2::jsonb) as r',
    [a, JSON.stringify({ name: 'Sortiert, Zora', aktiv: false })]);
  const l = await json(leitung, 'select public.pep_mitarbeiter_liste() as r');
  assert.ok(l.findIndex((m) => m.id === b) < l.findIndex((m) => m.id === a));
  assert.equal(l.find((m) => m.id === a).aktiv, false);
});

test('NAME_LEER', async () => {
  await fehler(leitung, `select public.pep_mitarbeiter_speichern(null, '{"name":"  \\t "}') as r`, [], 'NAME_LEER');
  await fehler(leitung, `select public.pep_mitarbeiter_speichern(null, '{}') as r`, [], 'NAME_LEER');
});

test('Stellvertretung darf lesen, nicht schreiben: NUR_LEITUNG', async () => {
  const id = await neuerMitarbeiter('Lesbar, Lena');
  assert.ok(Array.isArray(await json(stellv, 'select public.pep_mitarbeiter_liste() as r')));
  assert.equal((await json(stellv, 'select public.pep_bereiche() as r')).length, 15);
  assert.equal((await json(stellv, 'select public.pep_mitarbeiter($1) as r', [id])).name, 'Lesbar, Lena');
  await fehler(stellv, `select public.pep_mitarbeiter_speichern(null, '{"name":"X"}') as r`, [], 'NUR_LEITUNG');
  await fehler(stellv, `select public.pep_vertrag_speichern($1, '{}') as r`, [id], 'NUR_LEITUNG');
  await fehler(stellv, 'select public.pep_vertrag_loeschen(1)', [], 'NUR_LEITUNG');
  await fehler(stellv, 'select public.pep_kompetenz_setzen($1, 1, true)', [id], 'NUR_LEITUNG');
  await fehler(stellv, `select public.pep_wochenvorgabe_speichern($1, '{}') as r`, [id], 'NUR_LEITUNG');
  await fehler(stellv, 'select public.pep_wochenvorgabe_loeschen(1)', [], 'NUR_LEITUNG');
  await fehler(stellv, 'select public.pep_urlaubsjahr_speichern($1, 2027, 1, 0)', [id], 'NUR_LEITUNG');
});

test('Vertrag: Speichern, vertrag_am, Doppelt, Löschen des letzten', async () => {
  const m = await neuerMitarbeiter('Vertrag, Vera');
  const v1 = await vertrag(m, { gueltig_ab: '2026-01-01', vertragsart: 'teilzeit', wochenstunden: 30 });
  const v2 = await vertrag(m, { gueltig_ab: '2026-07-01', vertragsart: 'vollzeit', wochenstunden: 37.5 });
  const std = async (d) => (await db.query(
    'select (pep.vertrag_am($1, $2::date)).wochenstunden::text as s', [m, d])).rows[0].s;
  assert.equal(await std('2026-06-01'), '30.00');
  assert.equal(await std('2026-07-01'), '37.50');
  assert.equal(await std('2026-06-30'), '30.00');
  await wirft(std('2025-12-31'), 'KEIN_VERTRAG');

  await wirft(vertrag(m, { gueltig_ab: '2026-01-01', vertragsart: 'minijob', wochenstunden: 10 }), 'VERTRAG_DOPPELT');

  // Aktualisieren über id; Doppelt gilt auch beim Verschieben auf ein belegtes Datum
  await vertrag(m, { id: v2, gueltig_ab: '2026-07-01', vertragsart: 'vollzeit', wochenstunden: 38 });
  assert.equal(await std('2026-07-01'), '38.00');
  await wirft(vertrag(m, { id: v2, gueltig_ab: '2026-01-01', vertragsart: 'vollzeit', wochenstunden: 38 }), 'VERTRAG_DOPPELT');

  // Die Liste zeigt den Vertrag, der heute gilt (beide Verträge liegen in der Vergangenheit oder heute)
  const l = await json(leitung, 'select public.pep_mitarbeiter_liste() as r');
  assert.ok(l.find((x) => x.id === m).vertragsart !== null);

  await aufruf(leitung, 'select public.pep_vertrag_loeschen($1)', [v1]);
  await fehler(leitung, 'select public.pep_vertrag_loeschen($1)', [v2], 'LETZTER_VERTRAG');
});

test('fuehrung bekommt zeitkonto_grenze 42, STUNDEN_UNGUELTIG bei 0 und 61, VERTRAGSART_UNGUELTIG', async () => {
  const m = await neuerMitarbeiter('Fuehrung, Falk');
  const v = await vertrag(m, { gueltig_ab: '2026-01-01', vertragsart: 'fuehrung', wochenstunden: 40 });
  const grenze = async (id) =>
    (await db.query('select zeitkonto_grenze::text g from pep.vertraege where id = $1', [id])).rows[0].g;
  assert.equal(await grenze(v), '42.00');
  const w = await vertrag(m, { gueltig_ab: '2026-02-01', vertragsart: 'teilzeit', wochenstunden: 20 });
  assert.equal(await grenze(w), null);
  for (const s of [0, 61]) {
    await wirft(vertrag(m, { gueltig_ab: '2026-03-01', vertragsart: 'teilzeit', wochenstunden: s }), 'STUNDEN_UNGUELTIG');
  }
  await wirft(vertrag(m, { gueltig_ab: '2026-03-01', vertragsart: 'beamter', wochenstunden: 20 }), 'VERTRAGSART_UNGUELTIG');
});

test('Kompetenz setzen/entfernen, Pause ist nicht wählbar: BEREICH_NICHT_GEFUNDEN', async () => {
  const m = await neuerMitarbeiter('Kompetent, Karl');
  const b = await bereiche();
  const ka = b.find((x) => x.kuerzel === 'KA').id;
  const pa = b.find((x) => x.kuerzel === 'PA').id;
  const kompetenzen = async () =>
    (await json(leitung, 'select public.pep_mitarbeiter_liste() as r')).find((x) => x.id === m).kompetenzen;
  await aufruf(leitung, 'select public.pep_kompetenz_setzen($1, $2, true)', [m, ka]);
  await aufruf(leitung, 'select public.pep_kompetenz_setzen($1, $2, true)', [m, ka]); // kein Fehler
  assert.deepEqual(await kompetenzen(), ['KA']);
  await aufruf(leitung, 'select public.pep_kompetenz_setzen($1, $2, false)', [m, ka]);
  assert.deepEqual(await kompetenzen(), []);
  await fehler(leitung, 'select public.pep_kompetenz_setzen($1, $2, true)', [m, pa], 'BEREICH_NICHT_GEFUNDEN');
});

test('Wochenvorgabe nur_zwischen 14:00–20:00 Pflicht; 14:15 → HALBE_STUNDE; bis<von → ZEITEN_UNGUELTIG', async () => {
  const m = await neuerMitarbeiter('Vorgabe, Veit');
  const basis = { gueltig_von: '2026-01-01', pflicht: true, wochentag: 2, art: 'nur_zwischen' };
  const id = await vorgabe(m, { ...basis, von: '14:00', bis: '20:00' });
  const r = await db.query('select von::text, bis::text, pflicht from pep.wochenvorgaben where id = $1', [id]);
  assert.deepEqual(r.rows[0], { von: '14:00:00', bis: '20:00:00', pflicht: true });
  await wirft(vorgabe(m, { ...basis, von: '14:15', bis: '20:00' }), 'HALBE_STUNDE');
  await wirft(vorgabe(m, { ...basis, von: '20:00', bis: '14:00' }), 'ZEITEN_UNGUELTIG');
  const nv = await vorgabe(m, { gueltig_von: '2026-01-01', pflicht: false, wochentag: 5, art: 'nicht_verfuegbar' });
  await aufruf(leitung, 'select public.pep_wochenvorgabe_loeschen($1)', [nv]);
  const n = (await db.query('select count(*)::int n from pep.wochenvorgaben where mitarbeiter_id = $1', [m])).rows[0].n;
  assert.equal(n, 1);
});

test('Urlaubsjahr upsert: 2027 225.00, erneut 2027 210.00 → eine Zeile mit 210.00', async () => {
  const m = await neuerMitarbeiter('Urlaub, Uwe');
  await aufruf(leitung, 'select public.pep_urlaubsjahr_speichern($1, 2027, 225, 0)', [m]);
  await aufruf(leitung, 'select public.pep_urlaubsjahr_speichern($1, 2027, 210, 8)', [m]);
  const r = await db.query(
    `select anspruch_stunden::text a, rest_vorjahr_stunden::text r
       from pep.urlaubsjahre where mitarbeiter_id = $1`, [m]);
  assert.deepEqual(r.rows, [{ a: '210.00', r: '8.00' }]);
});

test('pep_mitarbeiter liefert vertraege, kompetenzen, wochenvorgaben, urlaubsjahre', async () => {
  const m = await neuerMitarbeiter('Komplett, Kim');
  await vertrag(m, { gueltig_ab: '2026-01-01', vertragsart: 'teilzeit', wochenstunden: 20 });
  await vertrag(m, { gueltig_ab: '2026-06-01', vertragsart: 'vollzeit', wochenstunden: 40 });
  const ka = (await bereiche()).find((x) => x.kuerzel === 'KA').id;
  await aufruf(leitung, 'select public.pep_kompetenz_setzen($1, $2, true)', [m, ka]);
  await vorgabe(m, { gueltig_von: '2026-01-01', pflicht: false, wochentag: 3, art: 'nicht_verfuegbar' });
  await aufruf(leitung, 'select public.pep_urlaubsjahr_speichern($1, 2027, 225, 0)', [m]);
  const r = await json(leitung, 'select public.pep_mitarbeiter($1) as r', [m]);
  assert.equal(r.name, 'Komplett, Kim');
  assert.deepEqual(r.vertraege.map((v) => v.gueltig_ab), ['2026-06-01', '2026-01-01']);
  assert.deepEqual(r.kompetenzen, [ka]);
  assert.equal(r.wochenvorgaben.length, 1);
  assert.equal(r.urlaubsjahre.length, 1);
});

test('fremde Filiale: MITARBEITER_NICHT_GEFUNDEN', async () => {
  const m = await neuerMitarbeiter('Eigen, Emil');
  const leitung2 = await pepBenutzer(db, 'chef2');
  await filiale(db, leitung2, { name: 'Netto Hanau', nummer: '1234', bundesland: 'HE' });
  await fehler(leitung2, 'select public.pep_mitarbeiter($1) as r', [m], 'MITARBEITER_NICHT_GEFUNDEN');
  await fehler(leitung2, `select public.pep_mitarbeiter_speichern($1, '{"name":"X"}') as r`, [m], 'MITARBEITER_NICHT_GEFUNDEN');
  await fehler(leitung2, `select public.pep_vertrag_speichern($1, '{}') as r`, [m], 'MITARBEITER_NICHT_GEFUNDEN');
  await fehler(leitung2, 'select public.pep_urlaubsjahr_speichern($1, 2027, 1, 0)', [m], 'MITARBEITER_NICHT_GEFUNDEN');
  assert.equal((await json(leitung2, 'select public.pep_mitarbeiter_liste() as r')).length, 0);
});

test('alter_am: Geburtstag 2009-03-15 → am 2027-03-14 = 17, am 2027-03-15 = 18', async () => {
  const m = await json(leitung, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r',
    [JSON.stringify({ name: 'Jung, Jan', geburtsdatum: '2009-03-15' })]);
  const alter = async (id, d) => (await db.query('select pep.alter_am($1, $2::date) a', [id, d])).rows[0].a;
  assert.equal(await alter(m, '2027-03-14'), 17);
  assert.equal(await alter(m, '2027-03-15'), 18);
  assert.equal(await alter(await neuerMitarbeiter('Ohne, Olga'), '2027-03-15'), null);
});

test('jedes Speichern schreibt Protokoll mit tabelle und schluessel', async () => {
  const m = await neuerMitarbeiter('Protokoll, Paul');
  const v = await vertrag(m, { gueltig_ab: '2026-01-01', vertragsart: 'minijob', wochenstunden: 10 });
  const ka = (await bereiche()).find((x) => x.kuerzel === 'KA').id;
  await aufruf(leitung, 'select public.pep_kompetenz_setzen($1, $2, true)', [m, ka]);
  const w = await vorgabe(m, { gueltig_von: '2026-01-01', pflicht: false, art: 'nicht_verfuegbar', wochentag: 1 });
  await aufruf(leitung, 'select public.pep_urlaubsjahr_speichern($1, 2027, 100, 0)', [m]);
  await aufruf(leitung, 'select public.pep_wochenvorgabe_loeschen($1)', [w]);
  const p = (await db.query('select tabelle, aktion, schluessel from pep.protokoll where filiale_id = $1', [fil])).rows;
  const hat = (tabelle, aktion, schluessel) =>
    p.some((r) => r.tabelle === tabelle && r.aktion === aktion && (schluessel === undefined || r.schluessel === schluessel));
  assert.ok(hat('mitarbeiter', 'anlegen', String(m)));
  assert.ok(hat('vertraege', 'anlegen', String(v)));
  assert.ok(hat('kompetenzen', 'anlegen', `${m}:${ka}`));
  assert.ok(hat('wochenvorgaben', 'anlegen', String(w)));
  assert.ok(hat('wochenvorgaben', 'loeschen', String(w)));
  assert.ok(hat('urlaubsjahre', 'anlegen', `${m}:2027`));
});

test('fremde Filiale: Löschen, Kompetenz und Wochenvorgabe sind gesperrt, nichts ändert sich', async () => {
  const m = await neuerMitarbeiter('Fremd, Fritz');
  const v1 = await vertrag(m, { gueltig_ab: '2026-01-01', vertragsart: 'teilzeit', wochenstunden: 20 });
  await vertrag(m, { gueltig_ab: '2026-06-01', vertragsart: 'vollzeit', wochenstunden: 40 });
  const w = await vorgabe(m, { gueltig_von: '2026-01-01', pflicht: false, wochentag: 4, art: 'nicht_verfuegbar' });
  const ka = (await bereiche()).find((x) => x.kuerzel === 'KA').id;

  const leitung2 = await pepBenutzer(db, 'chef3');
  await filiale(db, leitung2, { name: 'Netto Fulda', nummer: '4321', bundesland: 'HE' });
  const ka2 = (await json(leitung2, 'select public.pep_bereiche() as r')).find((x) => x.kuerzel === 'KA').id;
  assert.notEqual(ka2, ka);

  await fehler(leitung2, 'select public.pep_vertrag_loeschen($1)', [v1], 'VERTRAG_NICHT_GEFUNDEN');
  await fehler(leitung2, 'select public.pep_wochenvorgabe_loeschen($1)', [w], 'WOCHENVORGABE_NICHT_GEFUNDEN');
  await fehler(leitung2, 'select public.pep_kompetenz_setzen($1, $2, true)', [m, ka2], 'MITARBEITER_NICHT_GEFUNDEN');
  await fehler(leitung2, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r',
    [m, JSON.stringify({ gueltig_von: '2026-01-01', pflicht: false, art: 'nicht_verfuegbar' })],
    'MITARBEITER_NICHT_GEFUNDEN');

  // Bereich einer anderen Filiale beim eigenen Mitarbeiter
  const m2 = await json(leitung2, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r',
    [JSON.stringify({ name: 'Eigen, Erna' })]);
  await fehler(leitung2, 'select public.pep_kompetenz_setzen($1, $2, true)', [m2, ka], 'BEREICH_NICHT_GEFUNDEN');

  // In der ersten Filiale ist nichts verändert worden
  const r = await json(leitung, 'select public.pep_mitarbeiter($1) as r', [m]);
  assert.equal(r.vertraege.length, 2);
  assert.equal(r.wochenvorgaben.length, 1);
  assert.deepEqual(r.kompetenzen, []);
  const k = await db.query('select count(*)::int n from pep.kompetenzen where mitarbeiter_id in ($1, $2)', [m, m2]);
  assert.equal(k.rows[0].n, 0);
});

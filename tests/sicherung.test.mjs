// Sicherung (Stufe 2, Task 12): pep_sicherung (Datei herunterladen), pep_sicherung_pruefen (Vorschau) und
// pep_sicherung_einspielen (nur in eine leere Filiale).
// Quelle A: volle Filiale (Stammdaten, Plan, Kommentar, Vorlage, Wochenwerte, Abwesenheiten mit Wiederholung und
// Urlaubstool-Freigabe, IST mit leerer Zeile, KW 45 und 46 abgeschlossen, Journal mit Start-, Wochen-, Korrektur- und
// manueller Buchung), dazu eine leere Zweitfiliale (Einspielen in derselben Datenbank).
// Ziel Z: eigene Datenbank wie ein neues Projekt. chef und vize gibt es dort im Urlaubstool, aushilfe nicht. Die
// Umfrage kommt wie im Ernstfall über die Sicherung des Urlaubstools (org_sicherung / org_sicherung_einspielen) und
// bekommt dabei NEUE Ids; vorher liegen dort schon zwei Umfragen (eine mit gleichem Titel, aber anderem Jahr), damit
// keine Id zufällig gleich ist.
// Stichtag heute = Mo 16.11.2026 (KW 47); KW 45 = 02.–08.11., KW 46 = 09.–15.11.2026.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  neueDatenbank, als, pepBenutzer, organisator, filiale, planGrundlage, heuteSetzen,
  umfrageAnlegen, urlaubsfrageId, umfrageMitarbeiter, abgeben,
} from './helfer.mjs';
import { sicherungHinweis, dateiname } from '../docs/sicherung.js';

const HEUTE = '2026-11-16';
const KW45 = '2026-11-02';
const KW46 = '2026-11-09';
const tag = (montag, i) => new Date(Date.parse(`${montag}T00:00:00Z`) + i * 864e5).toISOString().slice(0, 10);
const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

const sichern = async (db, nutzer) => (await als(db, 'authenticated', nutzer, 'select public.pep_sicherung() as r'))[0].r;
const pruefen = async (db, nutzer, daten) => (await als(db, 'authenticated', nutzer,
  'select public.pep_sicherung_pruefen($1::jsonb) as r', [JSON.stringify(daten)]))[0].r;
const einspielen = async (db, nutzer, daten, bestaetigung) => (await als(db, 'authenticated', nutzer,
  'select public.pep_sicherung_einspielen($1::jsonb, $2) as r', [JSON.stringify(daten), bestaetigung]))[0].r;
// Prüfsumme wie der Server sie bildet, nach einer absichtlichen Änderung der Datei im Test.
const neuePruefsumme = async (db, daten) => ({ ...daten,
  pruefsumme: (await db.query("select md5(($1::jsonb -> 'tabellen')::text) as p", [JSON.stringify(daten)])).rows[0].p });

// Zeilenzahl aller Tabellen des Schemas pep (zum Nachweis „nichts geändert“).
async function zaehlen(db) {
  const tabellen = (await db.query(
    "select table_name as t from information_schema.tables where table_schema = 'pep' and table_type = 'BASE TABLE' order by 1")).rows;
  const z = {};
  for (const { t } of tabellen) z[t] = (await db.query(`select count(*)::int as n from pep.${t}`)).rows[0].n;
  return z;
}
const saldi = async (db, fil) => (await db.query(`select m.name, sum(k.stunden)::float8 as summe,
    (array_agg(k.saldo_nach order by k.id desc))[1]::float8 as letzter, count(*)::int as n,
    count(*) filter (where k.art = 'korrektur')::int as korrekturen
  from pep.zeitkonto_buchungen k join pep.mitarbeiter m on m.id = k.mitarbeiter_id
 where k.filiale_id = $1 group by m.name order by m.name`, [fil])).rows;

// Inhalt einer Sicherung ohne die Ids dieser Datenbank: eigene Ids → Position in der Tabelle (die Zeilen sind nach id
// sortiert, das Einspielen vergibt neue Ids in derselben Reihenfolge), Verweise → Position im Ziel, user_id →
// Benutzername, filiale_id → F. Das Protokoll behält vorher/nachher/schluessel als Schnappschuss und verliert die id.
const VERWEIS = { mitarbeiter_id: 'mitarbeiter', bereich_id: 'bereiche', code_id: 'abwesenheitscodes',
  wiederholung_id: 'wiederholungen', freigabe_id: 'urlaub_freigaben' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function kanonisch(s) {
  const umfrage = (id) => (s.urlaub.umfragen[id] ? `U:${s.urlaub.umfragen[id].titel}/${s.urlaub.umfragen[id].jahr}` : `U?${id}`);
  const teilnehmer = (id) => (s.urlaub.teilnehmer[id] ? `T:${s.urlaub.teilnehmer[id].name}` : `T?${id}`);
  const pos = {};
  for (const [t, zeilen] of Object.entries(s.tabellen)) pos[t] = new Map(zeilen.map((z, i) => [z.id, i]));
  const wert = (t, k, v) => {
    if (v === null) return null;
    if (k === 'filiale_id') return 'F';
    if (k === 'id') return `#${pos[t].get(v)}`;
    if (VERWEIS[k]) return `${VERWEIS[k]}#${pos[VERWEIS[k]].get(v) ?? 'fehlt'}`;
    if (typeof v === 'string' && UUID.test(v)) return `@${s.konten[v] ?? '?'}`;
    return v;
  };
  return Object.fromEntries(Object.entries(s.tabellen).map(([t, zeilen]) => [t, zeilen.map((z) => Object.fromEntries(
    Object.entries(z).filter(([k]) => !(t === 'protokoll' && k === 'id')).map(([k, v]) => {
      if (t === 'protokoll' && ['vorher', 'nachher', 'schluessel'].includes(k)) return [k, v];
      if (t === 'urlaub_umfragen' && k === 'umfrage_id') return [k, umfrage(v)];
      if (k === 'urlaub_mitarbeiter_id') return [k, teilnehmer(v)];
      if (t === 'urlaub_freigaben' && k === 'wunsch') {
        return [k, { ...v, umfrage_id: umfrage(v.umfrage_id), urlaub_mitarbeiter_id: teilnehmer(v.urlaub_mitarbeiter_id) }];
      }
      if (t === 'vorlagen' && k === 'daten') {
        return [k, v.map((e) => ({ ...e, mitarbeiter_id: wert(t, 'mitarbeiter_id', e.mitarbeiter_id),
          bereich_id: wert(t, 'bereich_id', e.bereich_id) }))];
      }
      return [k, wert(t, k, v)];
    })))]));
}
// Antwort ohne Ids (für den Vergleich zweier Datenbanken); kompetenzen ist eine Liste von Bereichs-Ids (die Tabelle
// kompetenzen vergleicht der Rundlauf über kanonisch).
const ohneIds = (x) => JSON.parse(JSON.stringify(x,
  (k, v) => (k === 'id' || k.endsWith('_id') || k === 'kompetenzen' ? undefined : v)));

let A; // Quelle
let Z; // Ziel (neues Projekt)
let sA; // Sicherung von A, wie der Browser sie bekommt (JSON.parse der Antwort)

before(async () => {
  // ------------------------------------------------------------ Quelle A
  const db = await neueDatenbank();
  // Geplant wird ab Mo 02.11. (vergangene Tage lassen sich nicht planen), danach ist heute = 16.11.
  const g = await planGrundlage(db, { heute: KW45, istAb: KW45 });
  const { leitung, json, bereich, code } = g;
  const q = (sql, p = []) => json(leitung, sql, p);
  const anna = await g.ma('Test, Anna', { kompetenzen: ['KA', 'OG'], geburtsdatum: '1990-05-01' });
  const ben = await g.ma('Muster, Ben', { stunden: 20, art: 'teilzeit' });
  const cem = await g.ma('Beispiel, Cem', { stunden: 42, art: 'fuehrung' });
  await q('select public.pep_vertrag_speichern($1, $2::jsonb) as r', [ben, JSON.stringify(
    { vertragsart: 'teilzeit', wochenstunden: 25.5, gueltig_ab: '2026-11-16' })]);
  await q('select public.pep_urlaubsjahr_speichern($1, 2026, 150, 12.5) as r', [anna]);
  await q('select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [ben, JSON.stringify(
    { art: 'nur_zwischen', von: '06:00', bis: '18:00', pflicht: false, gueltig_von: '2026-01-01', notiz: 'nur bis 18 Uhr' })]);
  // Eigener Bereich und Code, geänderte Einstellung, Schulferien, abweichender Tag
  const inv = await q(`select public.pep_bereich_speichern(null, '{"kuerzel":"IN","name":"Inventur","farbe":"#123456"}') as r`);
  await q('select public.pep_kompetenz_setzen($1, $2, true)', [cem, inv]);
  await q(`select public.pep_code_speichern(null, '{"code":"SU","name":"Sonderurlaub","farbe":"#654321","stundenregel":"teiler"}') as r`);
  await q(`select public.pep_einstellung_setzen('zeitkonto_warnfaktor', '1.5'::jsonb)`);
  await q(`select public.pep_schulferien_speichern(null, '2026-12-23', '2027-01-09', 'Weihnachtsferien') as r`);
  await q(`select public.pep_abweichung_speichern('2026-12-24', '{"art":"heiligabend","geoeffnet":true,
    "oeffnung_von":"07:00","oeffnung_bis":"14:00","rahmen_von":"06:00","rahmen_bis":"14:30","name":"Heiligabend"}')`);
  // Abwesenheiten: Urlaub, Wiederholung Berufsschule (dienstags)
  await q('select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, null, null, null, null) as r',
    [anna, code.U, '2026-11-23', '2026-11-25']);
  await q('select public.pep_wiederholung_speichern($1, $2::jsonb) as r', [ben, JSON.stringify(
    { code_id: code.BS, wochentag: 2, von_datum: '2026-11-01', bis_datum: '2026-12-31', stunden: 4 })]);
  // Plan KW 45–47; aushilfe (Stellvertretung, im Ziel unbekannt) malt auch
  const aushilfe = await pepBenutzer(db, 'aushilfe', 'stellvertretung', g.fil);
  for (const montag of [KW45, KW46, HEUTE]) {
    for (let i = 0; i < 5; i++) {
      await g.malen(leitung, anna, tag(montag, i), '08:00', '16:30', 'KA');
      await g.malen(leitung, anna, tag(montag, i), '12:00', '12:30', 'PA');
      await g.malen(i === 4 ? aushilfe : leitung, cem, tag(montag, i), '10:00', '18:00', 'KA');
    }
    await g.malen(leitung, ben, tag(montag, 0), '14:00', '18:00', 'KA');
  }
  await q('select public.pep_kommentar_setzen($1, $2::date, $3)', [anna, tag(HEUTE, 1), 'Lieferung annehmen']);
  await q(`select public.pep_vorlage_speichern('Standardwoche', 'woche', $1::date) as r`, [HEUTE]);
  await q(`select public.pep_woche_speichern(2026, 48, '{"planumsatz":61000.5,"stundenvorgabe_manuell":240}') as r`);
  await heuteSetzen(db, HEUTE);
  // Urlaubstool: Umfrage, zwei Teilnehmer zugeordnet, ein Wunsch freigegeben (→ Abwesenheiten mit freigabe_id)
  const umfrage = await umfrageAnlegen(db, leitung, { titel: 'Urlaub 2026', jahr: 2026 });
  const frage = await urlaubsfrageId(db, umfrage);
  await q('select public.pep_urlaub_umfrage_schalten($1, true)', [umfrage]);
  const tAnna = await umfrageMitarbeiter(db, umfrage, 'Test, Anna');
  const tBen = await umfrageMitarbeiter(db, umfrage, 'Muster, Ben');
  await q('select public.pep_urlaub_zuordnung_setzen($1, $2)', [tAnna.id, anna]);
  await q('select public.pep_urlaub_zuordnung_setzen($1, $2)', [tBen.id, ben]);
  await abgeben(db, tBen.code, { [frage]: [48] });
  await abgeben(db, tAnna.code, { [frage]: [47] }); // bleibt offen
  await q('select public.pep_urlaub_freigeben($1, null, null, $2::jsonb, null) as r', [ben, JSON.stringify(
    { umfrage_id: umfrage, urlaub_mitarbeiter_id: tBen.id, art: 'kw', kw: 48, datum: null })]);
  // Startsalden, IST (Mittwoch KW 45 bei Cem leer gemacht → ist_leer), Bestätigen, Abschluss KW 45 und 46
  await q(`select public.pep_zeitkonto_buchen($1, 'start', 12.5, 'Übernahme', '2026-11-01') as r`, [anna]);
  await q(`select public.pep_zeitkonto_buchen($1, 'start', -3.25, 'Übernahme', '2026-11-01') as r`, [cem]);
  await q("select public.pep_ist_zeile_setzen($1, $2::date, '[]'::jsonb, null) as r", [cem, tag(KW45, 2)]);
  for (const montag of [KW45, KW46]) {
    for (let i = 0; i < 6; i++) await q('select public.pep_ist_bestaetigen($1::date, null) as r', [tag(montag, i)]);
  }
  assert.deepEqual(await q('select public.pep_wochenabschluss(2026, 45) as r'), { gebucht: 3 });
  assert.deepEqual(await q('select public.pep_wochenabschluss(2026, 46) as r'), { gebucht: 3 });
  // Nachträgliche IST-Änderung in KW 45 → automatische Korrektur; manuelle Buchung
  await q(`select public.pep_ist_malen($1, $2::date, '16:30'::time, '18:00'::time, $3, 'vergessen') as r`,
    [anna, tag(KW45, 0), bereich.KA]);
  await q(`select public.pep_zeitkonto_buchen($1, 'manuell', 2, 'Ausgleich', '2026-11-16') as r`, [ben]);
  // Zahlen im Protokoll, die der Browser beim Weiterreichen umschreiben würde (37.50 → 37.5, 17 Stellen → 16)
  await db.query(`insert into pep.protokoll (filiale_id, aktion, tabelle, nachher)
    values ($1, 'test', 'test', '{"a": 37.50, "b": 6.6666666666666667, "c": [1.10, 2]}')`, [g.fil]);
  // Protokoll älter als 12 Monate: nicht in der Sicherung
  await db.query(`insert into pep.protokoll (filiale_id, zeit, aktion, tabelle)
    values ($1, now() - interval '13 months', 'alt', 'test')`, [g.fil]);
  // Sicherung des Urlaubstools (die Leitung ist Organisatorin der Umfrage)
  const urlaubDatei = (await als(db, 'authenticated', leitung, 'select public.org_sicherung($1) as r', [umfrage]))[0].r;
  // Zweitfiliale in derselben Datenbank, leer
  const zweit = await pepBenutzer(db, 'zweit');
  const fil2 = await filiale(db, zweit, { name: 'Netto Zweitfiliale', nummer: '9999' });
  A = { db, ...g, anna, ben, cem, aushilfe, umfrage, tAnna, tBen, zweit, fil2 };
  const offeneWuensche = async (adb, nutzer) =>
    (await als(adb, 'authenticated', nutzer, 'select public.pep_startseite() as r'))[0].r.offene_wuensche;
  A.offeneWuensche = await offeneWuensche(db, leitung);
  assert.equal(A.offeneWuensche, 1, 'in der Quelle ist nur Annas Wunsch offen');

  sA = await sichern(db, leitung);

  // ------------------------------------------------------------ Ziel Z (neues Projekt)
  const zdb = await neueDatenbank();
  await heuteSetzen(zdb, HEUTE);
  const zchef = await pepBenutzer(zdb, 'chef');
  const zfil = await filiale(zdb, zchef, { name: 'Netto Neu', nummer: '7777', bundesland: 'HE' });
  await organisator(zdb, 'vize');
  // Urlaubstool wie nach einem Datenverlust: erst andere Umfragen (gleicher Titel, anderes Jahr; anderer Titel), dann
  // die Sicherung der Umfrage aus A – sie bekommt neue Ids für Umfrage und Teilnehmer.
  for (const [titel, jahr] of [['Urlaub 2026', 2027], ['Urlaub 2025', 2025]]) {
    const u = await umfrageAnlegen(zdb, zchef, { titel, jahr });
    for (const name of ['Test, Anna', 'Muster, Ben', 'Platzhalter, Gustav']) await umfrageMitarbeiter(zdb, u, name);
  }
  const zUmfrage = (await als(zdb, 'authenticated', zchef, 'select public.org_sicherung_einspielen($1::jsonb) as r',
    [JSON.stringify(urlaubDatei)]))[0].r.id;
  const zTeilnehmer = Object.fromEntries((await zdb.query('select name, id from urlaub.mitarbeiter where umfrage_id = $1',
    [zUmfrage])).rows.map((t) => [t.name, t.id]));
  assert.notEqual(zUmfrage, umfrage);
  assert.notEqual(zTeilnehmer['Test, Anna'], tAnna.id);
  assert.notEqual(zTeilnehmer['Muster, Ben'], tBen.id);
  const dritt = await pepBenutzer(zdb, 'dritt');
  const zfil3 = await filiale(zdb, dritt, { name: 'Netto Dritt', nummer: '3333' });
  const zvize = (await zdb.query(`select user_id from urlaub.organisatoren where benutzername = 'vize'`)).rows[0].user_id;
  Z = { db: zdb, chef: zchef, fil: zfil, dritt, fil3: zfil3, vize: zvize, umfrage: zUmfrage, teilnehmer: zTeilnehmer,
    offeneWuensche };
});

// ------------------------------------------------------------ Format

test('pep_sicherung: Format, Abschnitte, Anzahlen, Prüfsumme über tabellen; Eintrag in sicherungen und Protokoll', async () => {
  assert.equal(sA.format, 'pep-sicherung');
  assert.equal(sA.version, 1);
  assert.match(sA.erstellt_am, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(sA.filiale, { name: 'Netto Aschaffenburg', nummer: '2558', bundesland: 'BY' });
  assert.deepEqual(sA.benutzer, [
    { benutzername: 'aushilfe', rolle: 'stellvertretung' },
    { benutzername: 'chef', rolle: 'leitung' },
    { benutzername: 'vize', rolle: 'stellvertretung' }]);
  // konten: jede user_id, die in den Tabellen vorkommt → Benutzername
  assert.equal(sA.konten[A.leitung], 'chef');
  assert.equal(sA.konten[A.aushilfe], 'aushilfe');
  for (const [t, zeilen] of Object.entries(sA.tabellen)) assert.equal(sA.anzahl[t], zeilen.length, t);
  assert.equal(sA.anzahl.mitarbeiter, 3);
  assert.equal(sA.anzahl.wochen_abschluesse, 2);
  assert.ok(sA.tabellen.zeitkonto_buchungen.some((k) => k.art === 'korrektur'), 'Journal enthält eine Korrektur');
  assert.equal(sA.anzahl.ist_leer, 1);
  assert.equal(sA.anzahl.urlaub_freigaben, 1);
  assert.ok(sA.tabellen.abwesenheiten.some((a) => a.freigabe_id !== null && a.quelle === 'urlaubstool'));
  assert.ok(sA.tabellen.abwesenheiten.some((a) => a.wiederholung_id !== null));
  // Nur die eigene Filiale: nichts aus der Zweitfiliale
  for (const [t, zeilen] of Object.entries(sA.tabellen)) {
    for (const z of zeilen) if ('filiale_id' in z) assert.equal(z.filiale_id, A.fil, t);
  }
  // Zeilen nach Primärschlüssel sortiert
  const ids = sA.tabellen.plan_bloecke.map((b) => b.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  // Zahlen in der Form, die JSON.parse/JSON.stringify nicht mehr ändern
  const test = sA.tabellen.protokoll.find((p) => p.aktion === 'test');
  assert.deepEqual(test.nachher, { a: 37.5, b: 6.666666666666667, c: [1.1, 2] });
  const p = (await A.db.query("select md5(($1::jsonb -> 'tabellen')::text) as p", [JSON.stringify(sA)])).rows[0].p;
  assert.equal(sA.pruefsumme, p);
  // Protokolliert: sicherungen und Protokoll
  const s = (await A.db.query('select filiale_id, erstellt_von, anzahl from pep.sicherungen')).rows;
  assert.equal(s.length, 1);
  assert.equal(s[0].filiale_id, A.fil);
  assert.equal(s[0].erstellt_von, A.leitung);
  assert.deepEqual(s[0].anzahl, sA.anzahl);
  const prot = (await A.db.query("select tabelle from pep.protokoll where aktion = 'sichern'")).rows;
  assert.deepEqual(prot, [{ tabelle: 'sicherungen' }]);
  // Protokoll nur der letzten 12 Monate
  const ab = Date.parse(sA.protokoll_ab);
  assert.ok(Date.now() - ab > 360 * 864e5 && Date.now() - ab < 370 * 864e5, sA.protokoll_ab);
  assert.ok(!sA.tabellen.protokoll.some((x) => x.aktion === 'alt'), 'altes Protokoll ausgelassen');
  assert.ok(sA.tabellen.protokoll.every((x) => Date.parse(x.zeit) >= ab));
  // Urlaubstool: Merkmale zum Wiederfinden in einem anderen Projekt
  assert.deepEqual(sA.urlaub, {
    umfragen: { [A.umfrage]: { titel: 'Urlaub 2026', jahr: 2026, organisator: 'chef' } },
    teilnehmer: { [A.tAnna.id]: { umfrage_id: A.umfrage, name: 'Test, Anna' },
      [A.tBen.id]: { umfrage_id: A.umfrage, name: 'Muster, Ben' } },
  });
});

test('Vollständigkeit: jede Tabelle des Schemas pep ist gesichert oder ausdrücklich ausgenommen; Ids und jsonb eingeordnet', async () => {
  const tabellen = (await A.db.query(
    "select table_name as t from information_schema.tables where table_schema = 'pep' and table_type = 'BASE TABLE'")).rows.map((r) => r.t);
  const gesichert = (await A.db.query('select pep.sicherung_tabellen() as t')).rows[0].t;
  const ausnahmen = (await A.db.query('select pep.sicherung_ausnahmen() as a')).rows[0].a;
  assert.deepEqual(Object.keys(ausnahmen).sort(), ['benutzer', 'filialen', 'sicherungen', 'zeitkonto_vormerkungen']);
  for (const [t, grund] of Object.entries(ausnahmen)) assert.ok(grund.length > 10, `Grund für ${t}`);
  for (const t of tabellen) {
    assert.ok(gesichert.includes(t) !== Object.hasOwn(ausnahmen, t),
      `pep.${t}: weder gesichert noch ausgenommen (neue Tabelle → pep.sicherung_tabellen oder pep.sicherung_ausnahmen)`);
  }
  for (const t of gesichert) assert.ok(tabellen.includes(t), `${t} gibt es nicht`);
  assert.deepEqual(Object.keys(sA.tabellen).sort(), [...gesichert].sort());
  // Jede bigint-Spalte „…_id“ (außer filiale_id) ist ein Fremdschlüssel: nur so schlüsselt das Einspielen sie um.
  // Jede jsonb-Spalte ist eingeordnet (Ids darin schlüsselt nur pep.sicherung_vorlage um).
  const JSON_SPALTEN = {
    'vorlagen.daten': 'mitarbeiter_id und bereich_id werden umgeschlüsselt (pep.sicherung_vorlage)',
    'einstellungen.wert': 'Werte ohne Ids',
    'urlaub_freigaben.wunsch': 'Ids des Urlaubstools, beim Einspielen über Titel/Jahr und Namen umgeschlüsselt (pep.sicherung_wunsch)',
    'protokoll.vorher': 'Schnappschuss mit den Ids der Quelle',
    'protokoll.nachher': 'Schnappschuss mit den Ids der Quelle',
  };
  for (const t of gesichert) {
    const spalten = (await A.db.query('select * from pep.sicherung_spalten($1)', [t])).rows;
    for (const s of spalten) {
      if (s.typ === 'int8' && s.spalte.endsWith('_id') && s.spalte !== 'filiale_id') {
        assert.ok(s.ziel_tabelle, `${t}.${s.spalte}: Id ohne Fremdschlüssel wird beim Einspielen nicht umgeschlüsselt`);
      }
      if (s.typ === 'jsonb') assert.ok(JSON_SPALTEN[`${t}.${s.spalte}`], `${t}.${s.spalte}: jsonb-Spalte nicht eingeordnet`);
      // Einspiel-Reihenfolge: das Ziel eines Fremdschlüssels steht vor der verweisenden Tabelle
      if (s.ziel_schema === 'pep' && gesichert.includes(s.ziel_tabelle) && s.ziel_tabelle !== t) {
        assert.ok(gesichert.indexOf(s.ziel_tabelle) < gesichert.indexOf(t),
          `${t}.${s.spalte} → ${s.ziel_tabelle}: Ziel muss in pep.sicherung_tabellen() davor stehen`);
      }
    }
  }
});

// ------------------------------------------------------------ Prüfen

test('pep_sicherung_pruefen: Filiale, Anzahlen, ob das Ziel leer ist; schreibt nichts', async () => {
  const vorher = await zaehlen(Z.db);
  const v = await pruefen(Z.db, Z.chef, sA);
  assert.equal(v.gueltig, true);
  assert.deepEqual(v.filiale, sA.filiale);
  assert.deepEqual(v.anzahl, sA.anzahl);
  assert.equal(v.ziel_leer, true);
  assert.equal(v.erstellt_am, sA.erstellt_am);
  assert.deepEqual(v.unbekannt, { tabellen: [], spalten: {} });
  assert.deepEqual(await zaehlen(Z.db), vorher);
  // Die eigene, volle Filiale ist nicht leer
  assert.equal((await pruefen(A.db, A.leitung, sA)).ziel_leer, false);
  // Die Grundausstattung allein zählt nicht als Inhalt
  assert.equal((await pruefen(A.db, A.zweit, sA)).ziel_leer, true);
});

test('Prüfsumme übersteht JSON.parse/JSON.stringify im Browser (Zahlenformate)', async () => {
  const text = (await als(A.db, 'authenticated', A.leitung, 'select public.pep_sicherung()::text as r'))[0].r;
  const neu = JSON.stringify(JSON.parse(text));
  const v = (await als(A.db, 'authenticated', A.leitung, 'select public.pep_sicherung_pruefen($1::jsonb) as r', [neu]))[0].r;
  assert.equal(v.gueltig, true);
  // Auch eingerückt (andere Leerzeichen) und mit anderer Schlüsselreihenfolge
  const umgestellt = JSON.parse(neu);
  umgestellt.tabellen = Object.fromEntries(Object.entries(umgestellt.tabellen).reverse());
  assert.equal((await pruefen(A.db, A.leitung, JSON.parse(JSON.stringify(umgestellt, null, 2)))).gueltig, true);
});

test('manipulierte oder fremde Datei → SICHERUNG_UNGUELTIG (Format, Version, Prüfsumme, Aufbau)', async () => {
  const kopie = () => JSON.parse(JSON.stringify(sA));
  const faelle = [];
  let d = kopie(); d.tabellen.mitarbeiter[0].name = 'Anders, Name'; faelle.push(['Wert geändert', d]);
  d = kopie(); d.tabellen.zeitkonto_buchungen.pop(); faelle.push(['Zeile entfernt', d]);
  d = kopie(); delete d.pruefsumme; faelle.push(['ohne Prüfsumme', d]);
  d = kopie(); d.format = 'urlaub-sicherung'; faelle.push(['Format', d]);
  d = kopie(); d.version = 2; faelle.push(['Version', d]);
  d = kopie(); delete d.tabellen; faelle.push(['ohne tabellen', d]);
  d = await neuePruefsumme(A.db, { ...kopie(), tabellen: { ...kopie().tabellen, mitarbeiter: { x: 1 } } });
  faelle.push(['Tabelle ist kein Array', d]);
  d = await neuePruefsumme(A.db, { ...kopie(), filiale: { name: '', nummer: '1', bundesland: 'BY' } });
  faelle.push(['Filiale ohne Namen', d]);
  d = await neuePruefsumme(A.db, { ...kopie(), filiale: { name: 'X', nummer: '1', bundesland: 'XX' } });
  faelle.push(['Bundesland ungültig', d]);
  d = kopie();
  d.tabellen.zeitkonto_buchungen.at(-1).saldo_nach += 1;
  faelle.push(['Journal: saldo_nach passt nicht zur Kette (Prüfsumme neu)', await neuePruefsumme(A.db, d)]);
  d = kopie();
  d.tabellen.zeitkonto_buchungen[0].stunden += 0.5;
  faelle.push(['Journal: stunden passen nicht zur Kette (Prüfsumme neu)', await neuePruefsumme(A.db, d)]);
  // Abschnitt urlaub (nicht in der Prüfsumme): falsche Form → SICHERUNG_UNGUELTIG statt SQL-Fehler
  const urlaubFalsch = [
    ['urlaub ist Liste', []],
    ['umfragen ist Liste', { umfragen: [], teilnehmer: {} }],
    ['Umfrage-Id kein Zahltext', { umfragen: { abc: { titel: 'x', jahr: 2026, organisator: 'chef' } }, teilnehmer: {} }],
    ['Jahr als Text', { umfragen: { 1: { titel: 'x', jahr: '2026', organisator: 'chef' } }, teilnehmer: {} }],
    ['Jahr zu groß', { umfragen: { 1: { titel: 'x', jahr: 123456, organisator: 'chef' } }, teilnehmer: {} }],
    ['Titel als Zahl', { umfragen: { 1: { titel: 5, jahr: 2026, organisator: 'chef' } }, teilnehmer: {} }],
    ['Teilnehmer ohne umfrage_id', { umfragen: {}, teilnehmer: { 1: { name: 'x' } } }],
    ['Teilnehmer umfrage_id als Text', { umfragen: {}, teilnehmer: { 1: { umfrage_id: '1', name: 'x' } } }],
    ['Teilnehmer ist Zahl', { umfragen: {}, teilnehmer: { 1: 5 } }],
  ];
  for (const [name, urlaub] of urlaubFalsch) { d = kopie(); d.urlaub = urlaub; faelle.push([`urlaub: ${name}`, d]); }
  faelle.push(['Liste statt Objekt', [1, 2]]);
  faelle.push(['Zahl', 5]);
  for (const [name, datei] of faelle) {
    await assert.rejects(pruefen(Z.db, Z.chef, datei), /SICHERUNG_UNGUELTIG/, `prüfen: ${name}`);
    await assert.rejects(einspielen(Z.db, Z.chef, datei, '2558'), /SICHERUNG_UNGUELTIG/, `einspielen: ${name}`);
  }
  await assert.rejects(als(Z.db, 'authenticated', Z.chef, 'select public.pep_sicherung_pruefen(null)'), /SICHERUNG_UNGUELTIG/);
});

// ------------------------------------------------------------ Rechte und Ablehnungen

test('Stellvertretung → NUR_LEITUNG (alle drei), Rolle mitarbeiter → NUR_LEITUNG; nichts geändert', async () => {
  const azubi = await pepBenutzer(A.db, 'azubi', 'mitarbeiter', A.fil);
  const vorher = await zaehlen(A.db);
  for (const nutzer of [A.stellv, azubi]) {
    await wirft(sichern(A.db, nutzer), 'NUR_LEITUNG');
    await wirft(pruefen(A.db, nutzer, sA), 'NUR_LEITUNG');
    await wirft(einspielen(A.db, nutzer, sA, '2558'), 'NUR_LEITUNG');
  }
  assert.deepEqual(await zaehlen(A.db), vorher);
  await A.db.query('delete from pep.benutzer where user_id = $1', [azubi]);
});

test('falsche Bestätigung → BESTAETIGUNG_FALSCH, nichts geändert (auch nicht die Grundausstattung)', async () => {
  const vorher = await zaehlen(Z.db);
  const bereiche = (await Z.db.query('select * from pep.bereiche where filiale_id = $1 order by id', [Z.fil])).rows;
  for (const falsch of ['7777', '255', '', null, 'Netto Aschaffenburg']) {
    await wirft(einspielen(Z.db, Z.chef, sA, falsch), 'BESTAETIGUNG_FALSCH');
  }
  assert.deepEqual(await zaehlen(Z.db), vorher);
  assert.deepEqual((await Z.db.query('select * from pep.bereiche where filiale_id = $1 order by id', [Z.fil])).rows, bereiche);
});

test('nicht leere Filiale → FILIALE_NICHT_LEER, nichts geändert', async () => {
  const vorher = await zaehlen(A.db);
  await wirft(einspielen(A.db, A.leitung, sA, '2558'), 'FILIALE_NICHT_LEER');
  assert.deepEqual(await zaehlen(A.db), vorher);
});

// ------------------------------------------------------------ Einspielen (neues Projekt)

test('Rundlauf: in leere Filiale eines neuen Projekts einspielen, erneut sichern → inhaltlich gleich, Saldo gleich, keine Korrektur', async () => {
  const korrekturenVorher = sA.tabellen.zeitkonto_buchungen.filter((k) => k.art === 'korrektur').length;
  const eigeneProtokolle = (await Z.db.query('select count(*)::int as n from pep.protokoll where filiale_id = $1', [Z.fil])).rows[0].n;
  // Bestätigung: Filialnummer aus der Datei (Leerzeichen egal)
  const r = await einspielen(Z.db, Z.chef, sA, ' 2558 ');
  const erwartet = Object.fromEntries(Object.entries(sA.anzahl).filter(([, n]) => n > 0));
  assert.deepEqual(r.eingespielt, { ...erwartet, benutzer: 1 });
  // aushilfe gibt es im Ziel nicht: als Benutzer ausgelassen, ihre Verweise (Plan-Blöcke, Protokoll) geleert
  const verweise = sA.tabellen.plan_bloecke.filter((b) => b.angelegt_von === A.aushilfe).length
    + sA.tabellen.protokoll.filter((p) => p.user_id === A.aushilfe).length;
  assert.ok(verweise >= 2);
  assert.deepEqual(r.ausgelassen, { benutzer: 1, benutzerverweise: verweise });
  assert.deepEqual(r.unbekannt, { tabellen: [], spalten: {} });

  // Filiale übernommen; vize als Stellvertretung zugeordnet, chef bleibt Leitung
  assert.deepEqual((await Z.db.query('select name, nummer, bundesland from pep.filialen where id = $1', [Z.fil])).rows[0],
    sA.filiale);
  assert.deepEqual((await Z.db.query(`select o.benutzername, b.rolle from pep.benutzer b
      join urlaub.organisatoren o on o.user_id = b.user_id where b.filiale_id = $1 order by 1`, [Z.fil])).rows,
  [{ benutzername: 'chef', rolle: 'leitung' }, { benutzername: 'vize', rolle: 'stellvertretung' }]);

  // Erneut sichern: gleich bis auf Ids (Verweise zeigen auf dieselben Zeilen), Prüfsumme und die Einträge des Ziels
  const sZ = await sichern(Z.db, Z.chef);
  assert.deepEqual(sZ.filiale, sA.filiale);
  assert.deepEqual(sZ.benutzer, sA.benutzer.filter((b) => b.benutzername !== 'aushilfe'));
  const soll = JSON.parse(JSON.stringify(kanonisch(sA)).replaceAll('"@aushilfe"', 'null'));
  const ist = kanonisch(sZ);
  // Protokoll des Ziels: eigene Einträge davor (Filiale anlegen), danach die Datei, zuletzt sicherung_eingespielt
  const eigen = ist.protokoll.splice(0, eigeneProtokolle);
  assert.deepEqual(eigen.map((p) => p.aktion), ['anlegen']);
  const letzter = ist.protokoll.pop();
  assert.equal(letzter.aktion, 'sicherung_eingespielt');
  assert.equal(letzter.tabelle, 'sicherungen');
  assert.equal(letzter.user_id, '@chef');
  assert.deepEqual(letzter.nachher.eingespielt, r.eingespielt);
  // urlaub_umfragen/urlaub_zuordnung sind nach den Ids des Urlaubstools sortiert, die im Ziel andere sind
  const sortiert = (zeilen) => [...zeilen].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const t of ['urlaub_umfragen', 'urlaub_zuordnung']) { ist[t] = sortiert(ist[t]); soll[t] = sortiert(soll[t]); }
  for (const t of Object.keys(soll)) assert.deepEqual(ist[t], soll[t], t);
  assert.notEqual(sZ.pruefsumme, sA.pruefsumme);

  // Saldo je Mitarbeiter gleich, keine neue Korrektur, keine Vormerkung; die Wochenrechnung stimmt mit dem Journal
  assert.deepEqual(await saldi(Z.db, Z.fil), await saldi(A.db, A.fil));
  const korrekturen = (await Z.db.query("select count(*)::int as n from pep.zeitkonto_buchungen where art = 'korrektur'")).rows[0].n;
  assert.equal(korrekturen, korrekturenVorher);
  assert.equal((await Z.db.query('select count(*)::int as n from pep.zeitkonto_vormerkungen')).rows[0].n, 0);
  for (const db of [A.db, Z.db]) {
    const f = db === A.db ? A.fil : Z.fil;
    assert.equal((await db.query("select pep.zeitkonto_abgleichen($1, null, null, 'Probe') as n", [f])).rows[0].n, 0);
  }
  // Zeitkonto KW 46 und Einsatzplan KW 47 wie in der Quelle
  for (const sql of ['select public.pep_zeitkonto_woche(2026, 46) as r', 'select public.pep_einsatzplan_woche(2026, 47) as r',
    'select public.pep_ist_woche(2026, 45) as r']) {
    const a = (await als(A.db, 'authenticated', A.leitung, sql))[0].r;
    const z = (await als(Z.db, 'authenticated', Z.chef, sql))[0].r;
    assert.deepEqual(ohneIds(z), ohneIds(a), sql);
  }
  // Urlaubstool mit den neuen Ids: Umfrage eingeschaltet, Teilnehmer den richtigen Mitarbeitern zugeordnet, der
  // genehmigte Wunsch bleibt genehmigt (nicht wieder offen), Annas Wunsch bleibt offen
  assert.deepEqual((await Z.db.query('select umfrage_id from pep.urlaub_umfragen where filiale_id = $1', [Z.fil])).rows,
    [{ umfrage_id: Z.umfrage }]);
  assert.deepEqual((await Z.db.query(`select t.id, t.name as teilnehmer, m.name as mitarbeiter from pep.urlaub_zuordnung z
      join urlaub.mitarbeiter t on t.id = z.urlaub_mitarbeiter_id join pep.mitarbeiter m on m.id = z.mitarbeiter_id
     where z.filiale_id = $1 order by t.name`, [Z.fil])).rows,
  [{ id: Z.teilnehmer['Muster, Ben'], teilnehmer: 'Muster, Ben', mitarbeiter: 'Muster, Ben' },
    { id: Z.teilnehmer['Test, Anna'], teilnehmer: 'Test, Anna', mitarbeiter: 'Test, Anna' }]);
  const wunsch = (await Z.db.query('select pep.wunsch_json($1, $2, $3, $4, null) as w',
    [Z.umfrage, Z.teilnehmer['Muster, Ben'], 'kw', 48])).rows[0].w;
  assert.equal((await Z.db.query('select pep.wunsch_vorhanden($1) as v', [wunsch])).rows[0].v, true);
  assert.equal((await Z.db.query('select (pep.freigabe_zum_wunsch($1, $2)).status as s', [Z.fil, wunsch])).rows[0].s, 'genehmigt');
  assert.equal(await Z.offeneWuensche(Z.db, Z.chef), A.offeneWuensche);
  // Nach dem Einspielen ist die Filiale nicht mehr leer
  await wirft(einspielen(Z.db, Z.chef, sA, '2558'), 'FILIALE_NICHT_LEER');
  // vize darf sich jetzt anmelden und liest dieselbe Filiale
  const vize = (await als(Z.db, 'authenticated', Z.vize, 'select public.pep_ich() as r'))[0].r;
  assert.equal(vize.filiale.nummer, '2558');
});

test('Startseite: letzte_sicherung null ohne Sicherung, danach das Datum (Ortszeit)', async () => {
  const s3 = (await als(Z.db, 'authenticated', Z.dritt, 'select public.pep_startseite() as r'))[0].r;
  assert.equal(s3.letzte_sicherung, null);
  const sa = (await als(A.db, 'authenticated', A.leitung, 'select public.pep_startseite() as r'))[0].r;
  const heute = (await A.db.query("select to_char((now() at time zone 'Europe/Berlin')::date, 'YYYY-MM-DD') as d")).rows[0].d;
  assert.equal(sa.letzte_sicherung, heute);
  // Die Stellvertretung bekommt dasselbe (die Oberfläche zeigt den Hinweis nur der Leitung)
  const sv = (await als(A.db, 'authenticated', A.stellv, 'select public.pep_startseite() as r'))[0].r;
  assert.equal(sv.letzte_sicherung, heute);
});

test('Hinweis auf der Startseite: „vor n Tagen“, gelb ab 8 Tagen oder ohne Sicherung; Dateiname', () => {
  assert.deepEqual(sicherungHinweis(null, '2026-11-16'), { text: 'Noch keine Sicherung', gelb: true });
  assert.deepEqual(sicherungHinweis('2026-11-16', '2026-11-16'), { text: 'Letzte Sicherung heute', gelb: false });
  assert.deepEqual(sicherungHinweis('2026-11-15', '2026-11-16'), { text: 'Letzte Sicherung gestern', gelb: false });
  assert.deepEqual(sicherungHinweis('2026-11-09', '2026-11-16'), { text: 'Letzte Sicherung vor 7 Tagen', gelb: false });
  assert.deepEqual(sicherungHinweis('2026-11-08', '2026-11-16'), { text: 'Letzte Sicherung vor 8 Tagen', gelb: true });
  // Uhr des Servers nach dem Browser-Datum (Testbetrieb): nie „vor −n Tagen“
  assert.deepEqual(sicherungHinweis('2026-11-20', '2026-11-16'), { text: 'Letzte Sicherung heute', gelb: false });
  assert.equal(dateiname({ nummer: '2558', name: 'Netto Aschaffenburg' }, '2026-11-16'), 'PEP-Sicherung-2558-2026-11-16.json');
  assert.equal(dateiname({ nummer: null, name: 'Netto Äpfel/Birnen' }, '2026-11-16'), 'PEP-Sicherung-Netto-Äpfel-Birnen-2026-11-16.json');
});

// ------------------------------------------------------------ Sonderfälle

test('Einspielen in derselben Datenbank: belegte Umfragen und Teilnehmer, Benutzer anderer Filialen werden ausgelassen', async () => {
  const r = await einspielen(A.db, A.zweit, sA, '2558');
  assert.equal(r.eingespielt.mitarbeiter, 3);
  assert.equal(r.eingespielt.zeitkonto_buchungen, sA.anzahl.zeitkonto_buchungen);
  // Die Umfrage gehört chef, nicht zweit (Einschalten ginge auch nicht): Schaltung, Zuordnungen und die Ids im Wunsch
  // der Freigabe werden nicht zugeordnet; die Freigabe selbst kommt mit
  assert.deepEqual(r.ausgelassen, { urlaub_umfragen: 1, urlaub_zuordnung: 2, wunsch_nicht_zugeordnet: 1, benutzer: 3 });
  assert.equal(r.eingespielt.urlaub_freigaben, 1);
  assert.equal(r.eingespielt.urlaub_umfragen, undefined);
  assert.deepEqual(await saldi(A.db, A.fil2), await saldi(A.db, A.fil));
  // Die erste Filiale ist unverändert
  assert.equal((await A.db.query('select count(*)::int as n from pep.urlaub_zuordnung where filiale_id = $1', [A.fil])).rows[0].n, 2);
  assert.equal((await A.db.query('select count(*)::int as n from pep.zeitkonto_vormerkungen')).rows[0].n, 0);
});

test('Datei einer neueren Stufe (Tabelle mit Zeilen, Spalte mit Werten) → SICHERUNG_NEUER, schon in der Vorschau', async () => {
  const vorher = await zaehlen(Z.db);
  const mitTabelle = JSON.parse(JSON.stringify(sA));
  mitTabelle.tabellen.zukunft = [{ id: 1, filiale_id: A.fil, wert: 'x' }];
  const mitSpalte = JSON.parse(JSON.stringify(sA));
  mitSpalte.tabellen.mitarbeiter[1].neue_spalte = 'x';
  for (const d of [mitTabelle, mitSpalte]) {
    const datei = await neuePruefsumme(Z.db, d);
    await wirft(pruefen(Z.db, Z.dritt, datei), 'SICHERUNG_NEUER');
    await wirft(einspielen(Z.db, Z.dritt, datei, '2558'), 'SICHERUNG_NEUER');
  }
  assert.deepEqual(await zaehlen(Z.db), vorher);
});

test('ältere Datei (fehlende Einstellung und Spalte), leere unbekannte Teile; fremde und fehlende Umfragen gezählt', async () => {
  const d = JSON.parse(JSON.stringify(sA));
  // Neuere Stufe, aber ohne Inhalt: gemeldet, eingespielt wird trotzdem
  d.tabellen.zukunft = [];
  for (const m of d.tabellen.mitarbeiter) m.neue_spalte = null;
  // Ältere Stufe: eine Einstellung und die Spalte gutschrift fehlen
  d.tabellen.einstellungen = d.tabellen.einstellungen.filter((e) => e.schluessel !== 'zeitkonto_warnfaktor');
  for (const c of d.tabellen.abwesenheitscodes) delete c.gutschrift;
  // Eine Umfrage ohne Eintrag im Abschnitt urlaub (fehlt im Ziel). Die Umfrage der Datei gehört chef, nicht dritt.
  d.tabellen.urlaub_umfragen.push({ ...d.tabellen.urlaub_umfragen[0], umfrage_id: 999999 });
  const datei = await neuePruefsumme(Z.db, d);
  const v = await pruefen(Z.db, Z.dritt, datei);
  assert.deepEqual(v.unbekannt, { tabellen: ['zukunft'], spalten: { mitarbeiter: ['neue_spalte'] } });
  assert.equal(v.ziel_leer, true);
  const r = await einspielen(Z.db, Z.dritt, datei, '2558');
  assert.deepEqual(r.unbekannt, v.unbekannt);
  assert.equal(r.eingespielt.mitarbeiter, 3);
  // chef und vize gehören zur ersten Filiale, aushilfe gibt es nicht
  assert.deepEqual(r.ausgelassen, { urlaub_umfragen: 2, urlaub_zuordnung: 2, wunsch_nicht_zugeordnet: 1, benutzer: 3,
    benutzerverweise: sA.tabellen.plan_bloecke.filter((b) => b.angelegt_von === A.aushilfe).length
      + sA.tabellen.protokoll.filter((p) => p.user_id === A.aushilfe).length });
  assert.deepEqual(await saldi(Z.db, Z.fil3), await saldi(A.db, A.fil));
  assert.equal((await Z.db.query('select count(*)::int as n from pep.urlaub_umfragen where filiale_id = $1', [Z.fil3])).rows[0].n, 0);
  // Grundausstattung ergänzt die fehlende Einstellung (Standardwert), ändert sonst nichts; gutschrift = Standard true
  const e = (await Z.db.query("select schluessel, wert from pep.einstellungen where filiale_id = $1 order by 1", [Z.fil3])).rows;
  assert.equal(e.length, sA.anzahl.einstellungen);
  assert.deepEqual(e.find((x) => x.schluessel === 'zeitkonto_warnfaktor').wert, 1);
  assert.deepEqual(e.find((x) => x.schluessel === 'ist_ab').wert, sA.tabellen.einstellungen.find((x) => x.schluessel === 'ist_ab').wert);
  assert.equal((await Z.db.query('select count(*)::int as n from pep.bereiche where filiale_id = $1', [Z.fil3])).rows[0].n,
    sA.anzahl.bereiche);
  assert.equal((await Z.db.query('select count(*)::int as n from pep.abwesenheitscodes where filiale_id = $1 and gutschrift',
    [Z.fil3])).rows[0].n, sA.anzahl.abwesenheitscodes);
});

test('nicht zugeordneter Wunsch wird markiert: gleiche Ids im neuen Projekt machen einen fremden Wunsch nicht genehmigt', async () => {
  // Neues Projekt, in dem die Ids zufällig gleich sind: chef legt zuerst eine ANDERE Umfrage an (anderer Titel), mit
  // Teilnehmern in derselben Reihenfolge – Umfrage- und Teilnehmer-Ids wie in A.
  const db = await neueDatenbank();
  await heuteSetzen(db, HEUTE);
  const chef = await pepBenutzer(db, 'chef');
  const fil = await filiale(db, chef, { name: 'Netto Neu', nummer: '7777' });
  const umfrage = await umfrageAnlegen(db, chef, { titel: 'Ganz andere Umfrage', jahr: 2026 });
  const anna = await umfrageMitarbeiter(db, umfrage, 'Test, Anna');
  const ben = await umfrageMitarbeiter(db, umfrage, 'Muster, Ben');
  assert.deepEqual([umfrage, anna.id, ben.id], [A.umfrage, A.tAnna.id, A.tBen.id], 'Voraussetzung: gleiche Ids');
  const r = await einspielen(db, chef, sA, '2558');
  assert.equal(r.ausgelassen.wunsch_nicht_zugeordnet, 1);
  assert.equal(r.ausgelassen.urlaub_umfragen, 1);
  const f = (await db.query('select wunsch, status from pep.urlaub_freigaben where filiale_id = $1', [fil])).rows;
  assert.equal(f.length, 1);
  assert.equal(f[0].status, 'genehmigt');
  assert.equal(f[0].wunsch.nicht_zugeordnet, true);
  // Die eigene Umfrage einschalten, Ben zuordnen, Ben wünscht dieselbe KW 48 wie in A
  const json = async (sql, p = []) => (await als(db, 'authenticated', chef, sql, p))[0]?.r;
  const ma = Object.fromEntries((await db.query('select name, id from pep.mitarbeiter where filiale_id = $1', [fil])).rows
    .map((m) => [m.name, m.id]));
  await json('select public.pep_urlaub_umfrage_schalten($1, true) as r', [umfrage]);
  await json('select public.pep_urlaub_zuordnung_setzen($1, $2) as r', [ben.id, ma['Muster, Ben']]);
  await abgeben(db, ben.code, { [await urlaubsfrageId(db, umfrage)]: [48] });
  const wunsch = (await db.query("select pep.wunsch_json($1, $2, 'kw', 48, null) as w", [umfrage, ben.id])).rows[0].w;
  // Ohne die Markierung wäre f[0].wunsch genau dieser Wunsch und er stünde als genehmigt da
  assert.deepEqual({ ...f[0].wunsch, nicht_zugeordnet: undefined }, { ...wunsch, nicht_zugeordnet: undefined });
  assert.equal((await db.query('select (pep.freigabe_zum_wunsch($1, $2)).id as id', [fil, wunsch])).rows[0].id, null);
  assert.equal((await json('select public.pep_startseite() as r')).offene_wuensche, 1, 'Bens neuer Wunsch ist offen');
  // Abwesenheiten: die Tage der Freigabe bleiben genehmigt, ohne Warnung „Wunsch geändert“, mit Hinweis wunsch_fehlt
  const monat = await json('select public.pep_abwesenheiten(2026, 11) as r');
  const tag = monat.mitarbeiter.find((m) => m.id === ma['Muster, Ben']).tage['2026-11-23'];
  assert.equal(tag.code, 'U');
  assert.equal(tag.wunsch_fehlt, true);
  assert.equal(tag.wunsch_geaendert, false);
  assert.equal((await db.query('select pep.wunsch_vorhanden($1) as v', [f[0].wunsch])).rows[0].v, false);
  // Erneut sichern: der markierte Wunsch bleibt markiert und wird nie über den Abschnitt urlaub zugeordnet
  assert.equal((await db.query(`select pep.sicherung_wunsch($1, '{"urlaub.umfragen": {"1": 5}, "urlaub.mitarbeiter": {"2": 6}}')
    as w`, [JSON.stringify({ umfrage_id: 1, urlaub_mitarbeiter_id: 2, nicht_zugeordnet: true })])).rows[0].w, null);
  const s = await sichern(db, chef);
  assert.equal(s.tabellen.urlaub_freigaben[0].wunsch.nicht_zugeordnet, true);
});

// ------------------------------------------------------------ Größe

// Bestand von `jahre` Jahren bis Sa 26.12.2026 direkt per SQL (die Funktionen dafür einzeln aufzurufen dauert in PGlite
// zu lange). Annahmen: 18 Mitarbeiter mit Vertrag, je Woche 5 Arbeitstage (ein freier Tag Mo–Sa), Plan und IST mit je
// 3 Blöcken (Arbeit, Pause, Arbeit), alle Tage Mo–Sa bestätigt, je Jahr 30 Urlaubs- und 10 Krankheitstage je
// Mitarbeiter, jede Woche abgeschlossen mit einer Journalzeile je Mitarbeiter; Protokoll: 3 Einträge je Planzeile
// (malen, Pause, Änderung), 1 je IST-Zeile, 1 je Abwesenheitstag, Zeitpunkt so weit vor jetzt wie der Tag vor dem
// 04.01.2027 (heute im Test) – nur die letzten 12 Monate kommen in die Sicherung.
async function groesseMessen(jahre) {
  const db = await neueDatenbank();
  await heuteSetzen(db, '2027-01-04');
  const leitung = await pepBenutzer(db, 'chef');
  const fil = await filiale(db, leitung);
  const leer = await pepBenutzer(db, 'leer');
  await filiale(db, leer, { name: 'Netto Leer', nummer: '1' });
  const start = new Date(Date.parse('2025-12-29T00:00:00Z') - (jahre - 1) * 364 * 864e5).toISOString().slice(0, 10);
  const zeit = (spalte) => `now() - ('2027-01-04'::date - ${spalte}) * interval '1 day'`;
  await db.query(`insert into pep.mitarbeiter (filiale_id, name, personalnummer, eintritt)
    select $1, 'Jahr, Person ' || lpad(i::text, 2, '0'), (90000 + i)::text, '2020-01-01' from generate_series(1, 18) i`, [fil]);
  await db.query(`insert into pep.vertraege (mitarbeiter_id, gueltig_ab, vertragsart, wochenstunden)
    select id, '2020-01-01', 'vollzeit', 37.5 from pep.mitarbeiter where filiale_id = $1`, [fil]);
  await db.query(`
    with tage as (
      select m.id as m, d::date as datum
        from pep.mitarbeiter m, generate_series($3::date, '2026-12-26'::date, interval '1 day') d
       where m.filiale_id = $1 and extract(isodow from d) <= 6 and (extract(isodow from d)::int - 1) <> m.id % 6),
    bloecke as (
      select m, datum, v::time as von, b::time as bis, k
        from tage, (values ('07:00', '11:00', 'KA'), ('11:00', '11:30', 'PA'), ('11:30', '15:30', 'OG')) x (v, b, k))
    insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id, angelegt_von)
    select $1, b.m, b.datum, b.von, b.bis, r.id, $2 from bloecke b join pep.bereiche r on r.filiale_id = $1 and r.kuerzel = b.k`,
  [fil, leitung, start]);
  await db.query(`insert into pep.ist_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id, angelegt_von)
    select filiale_id, mitarbeiter_id, datum, von, bis, bereich_id, angelegt_von from pep.plan_bloecke where filiale_id = $1`, [fil]);
  await db.query(`insert into pep.ist_tage (filiale_id, mitarbeiter_id, datum, bestaetigt_von)
    select $1, m.id, d::date, $2 from pep.mitarbeiter m, generate_series($3::date, '2026-12-26'::date, interval '1 day') d
     where m.filiale_id = $1 and extract(isodow from d) <= 6`, [fil, leitung, start]);
  await db.query(`insert into pep.abwesenheiten (filiale_id, mitarbeiter_id, code_id, datum, stunden, quelle, angelegt_von)
    select $1, m.id, c.id, '2026-02-02'::date - 364 * j + (n * 7 + (m.id % 5))::int, 6.25, 'manuell', $2
      from pep.mitarbeiter m, generate_series(0, $3::int - 1) j, generate_series(0, 39) n, pep.abwesenheitscodes c
     where m.filiale_id = $1 and c.filiale_id = $1 and c.code = case when n < 30 then 'U' else 'KM' end`, [fil, leitung, jahre]);
  await db.query(`insert into pep.wochen_abschluesse (filiale_id, montag, abgeschlossen_von)
    select $1, d::date, $2 from generate_series($3::date, '2026-12-21'::date, interval '7 days') d`, [fil, leitung, start]);
  await db.query(`insert into pep.zeitkonto_buchungen (filiale_id, mitarbeiter_id, datum, art, stunden, saldo_nach, grund, angelegt_von)
    select $1, m.id, a.montag, 'woche', 0.25, 0.25 * row_number() over (partition by m.id order by a.montag), null, $2
      from pep.mitarbeiter m join pep.wochen_abschluesse a on a.filiale_id = m.filiale_id
     where m.filiale_id = $1 order by m.id, a.montag`, [fil, leitung]);
  await db.query(`insert into pep.protokoll (filiale_id, zeit, user_id, aktion, tabelle, schluessel, vorher, nachher)
    select $1, ${zeit('t.datum')}, $2, 'setzen', 'plan_bloecke', t.mitarbeiter_id || ':' || t.datum,
           case when n > 1 then t.zeile end, t.zeile
      from (select mitarbeiter_id, datum, jsonb_agg(pep.block_json(von, bis, bereich_id) order by von) as zeile
              from pep.plan_bloecke where filiale_id = $1 group by mitarbeiter_id, datum) t, generate_series(1, 3) n`,
  [fil, leitung]);
  await db.query(`insert into pep.protokoll (filiale_id, zeit, user_id, aktion, tabelle, schluessel, vorher, nachher)
    select $1, ${zeit('t.datum')}, $2, 'setzen', 'ist_bloecke', t.mitarbeiter_id || ':' || t.datum, '[]', t.zeile
      from (select mitarbeiter_id, datum, jsonb_agg(pep.block_json(von, bis, bereich_id) order by von) as zeile
              from pep.ist_bloecke where filiale_id = $1 group by mitarbeiter_id, datum) t`, [fil, leitung]);
  await db.query(`insert into pep.protokoll (filiale_id, zeit, user_id, aktion, tabelle, schluessel, vorher, nachher)
    select $1, ${zeit('a.datum')}, $2, 'anlegen', 'abwesenheiten', a.id::text, null, to_jsonb(a)
      from pep.abwesenheiten a where a.filiale_id = $1`, [fil, leitung]);
  const protokollGesamt = (await db.query('select count(*)::int as n from pep.protokoll where filiale_id = $1', [fil])).rows[0].n;

  let t0 = performance.now();
  const text = (await als(db, 'authenticated', leitung, 'select public.pep_sicherung()::text as r'))[0].r;
  const msSichern = performance.now() - t0;
  const bytes = Buffer.byteLength(text, 'utf8');
  const datei = JSON.parse(text);
  t0 = performance.now();
  await pruefen(db, leer, datei);
  const msPruefen = performance.now() - t0;
  t0 = performance.now();
  const r = await einspielen(db, leer, datei, datei.filiale.nummer);
  const msEinspielen = performance.now() - t0;
  const zeilen = Object.values(datei.anzahl).reduce((s, n) => s + n, 0);
  const mb = (n) => (n / 1048576).toFixed(2);
  const anteile = Object.entries(datei.tabellen).map(([k, z]) => [k, Buffer.byteLength(JSON.stringify(z), 'utf8')])
    .sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${mb(n)} MB`).join(', ');
  const meldung = `${jahre} ${jahre === 1 ? 'Jahr' : 'Jahre'}, 18 Mitarbeiter: ${zeilen} Zeilen, ${mb(bytes)} MB `
    + `(${Object.entries(datei.anzahl).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ')}; `
    + `Protokoll gesamt ${protokollGesamt}); pep_sicherung ${Math.round(msSichern)} ms, `
    + `pep_sicherung_pruefen ${Math.round(msPruefen)} ms, pep_sicherung_einspielen ${Math.round(msEinspielen)} ms (PGlite); `
    + `größte Teile: ${anteile}`;
  for (const [k, n] of Object.entries(datei.anzahl)) if (n > 0) assert.equal(r.eingespielt[k], n, k);
  return { meldung, protokoll: datei.anzahl.protokoll, protokollGesamt };
}

test('Größe und Laufzeit: ein und zwei Jahre mit 18 Mitarbeitern (Protokoll nur 12 Monate)', { timeout: 600000 }, async (t) => {
  const eins = await groesseMessen(1);
  const zwei = await groesseMessen(2);
  for (const m of [eins.meldung, zwei.meldung]) { t.diagnostic(m); console.log(m); }
  // Im zweiten Jahr bleibt das Protokoll der Datei etwa gleich groß (nur die letzten 12 Monate)
  assert.ok(zwei.protokollGesamt > 1.9 * eins.protokollGesamt);
  assert.ok(Math.abs(zwei.protokoll - eins.protokoll) < 0.05 * eins.protokoll, `${zwei.protokoll} / ${eins.protokoll}`);
});

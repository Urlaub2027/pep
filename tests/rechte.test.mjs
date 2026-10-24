// Rechte: Funktionsrechte aller public.pep_*-Funktionen und Zugriffsprüfung jeder schreibenden Funktion.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale } from './helfer.mjs';

let db, leitung, stellv, azubi, ohne, fil, ma;

const aufruf = (nutzer, sql) => als(db, 'authenticated', nutzer, sql);

before(async () => {
  db = await neueDatenbank();
  leitung = await pepBenutzer(db, 'chef');
  fil = await filiale(db, leitung);
  stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  azubi = await pepBenutzer(db, 'azubi', 'mitarbeiter', fil);
  ohne = await pepBenutzer(db, 'chefOhne'); // Leitung ohne Filiale
  ma = (await aufruf(leitung, `select public.pep_mitarbeiter_speichern(null, '{"name":"Test, Ida"}') as r`))[0].r;
});

const pepFunktionen = async () => (await db.query(`
  select p.proname as name, p.oid, p.prosecdef, p.proconfig,
         has_function_privilege('anon', p.oid, 'execute') as anon,
         has_function_privilege('authenticated', p.oid, 'execute') as angemeldet
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'pep\_%' order by p.proname`)).rows;

test('Rechte: jede public.pep_*-Funktion ist security definer mit search_path, anon ohne, angemeldet mit Ausführungsrecht', async () => {
  const fns = await pepFunktionen();
  assert.ok(fns.length > 30);
  for (const f of fns) {
    assert.equal(f.anon, false, `anon: ${f.name}`);
    assert.equal(f.angemeldet, true, `angemeldet: ${f.name}`);
    assert.equal(f.prosecdef, true, `security definer: ${f.name}`);
    assert.ok((f.proconfig ?? []).some((c) => /^search_path=/.test(c)), `search_path: ${f.name}`);
  }
});

// Nur lesende Funktionen; alles andere gilt als schreibend und muss unten abgedeckt sein.
const NUR_LESEN = ['pep_ich', 'pep_bereiche', 'pep_mitarbeiter_liste', 'pep_mitarbeiter', 'pep_einstellungen',
  'pep_feiertage', 'pep_abwesenheiten', 'pep_urlaub_umfragen', 'pep_urlaub_zuordnung', 'pep_einsatzplan_woche',
  'pep_pruefung_zeitraum'];
// Auch für die Stellvertretung erlaubt.
const AUCH_STELLVERTRETUNG = ['pep_abwesenheit_setzen', 'pep_abwesenheit_loeschen',
  'pep_wiederholung_speichern', 'pep_wiederholung_loeschen',
  'pep_plan_malen', 'pep_plan_zeile_setzen', 'pep_kommentar_setzen'];
// Legt für die Leitung ohne Filiale die Filiale an – das ist gewollt und in basis.test.mjs geprüft.
const OHNE_FILIALE_ERLAUBT = ['pep_filiale_anlegen'];

// Plausible Dummy-Aufrufe (Mitarbeiter-Id echt, damit ein fehlender Rechtecheck sichtbar etwas ändern würde).
const aufrufe = () => ({
  pep_filiale_anlegen: `select public.pep_filiale_anlegen('X', '1', 'BY')`,
  pep_mitarbeiter_speichern: `select public.pep_mitarbeiter_speichern(null, '{"name":"X, Y"}')`,
  pep_vertrag_speichern: `select public.pep_vertrag_speichern(${ma}, '{"vertragsart":"teilzeit","wochenstunden":30,"gueltig_ab":"2026-01-01"}')`,
  pep_vertrag_loeschen: `select public.pep_vertrag_loeschen(1)`,
  pep_kompetenz_setzen: `select public.pep_kompetenz_setzen(${ma}, 1, true)`,
  pep_wochenvorgabe_speichern: `select public.pep_wochenvorgabe_speichern(${ma}, '{}')`,
  pep_wochenvorgabe_loeschen: `select public.pep_wochenvorgabe_loeschen(1)`,
  pep_urlaubsjahr_speichern: `select public.pep_urlaubsjahr_speichern(${ma}, 2027, 30, 0)`,
  pep_rahmen_speichern: `select public.pep_rahmen_speichern(1, '{}')`,
  pep_abweichung_speichern: `select public.pep_abweichung_speichern('2027-05-01', '{}')`,
  pep_abweichung_loeschen: `select public.pep_abweichung_loeschen('2027-05-01')`,
  pep_einstellung_setzen: `select public.pep_einstellung_setzen('x', '1')`,
  pep_code_speichern: `select public.pep_code_speichern(null, '{"code":"ZZ","name":"Test"}')`,
  pep_bereich_speichern: `select public.pep_bereich_speichern(null, '{"kuerzel":"ZZ","name":"Test"}')`,
  pep_schulferien_speichern: `select public.pep_schulferien_speichern(null, '2027-04-05', '2027-04-16', 'Test')`,
  pep_schulferien_loeschen: `select public.pep_schulferien_loeschen(1)`,
  pep_benutzer_setzen: `select public.pep_benutzer_setzen('vize', 'leitung')`,
  pep_benutzer_entfernen: `select public.pep_benutzer_entfernen('${stellv}')`,
  pep_abwesenheit_setzen: `select public.pep_abwesenheit_setzen(${ma}, 1, '2027-05-03', '2027-05-03', null, null, null, null)`,
  pep_abwesenheit_loeschen: `select public.pep_abwesenheit_loeschen(${ma}, '2027-05-03', '2027-05-03')`,
  pep_wiederholung_speichern: `select public.pep_wiederholung_speichern(${ma}, '{"code_id":1,"wochentag":2,"von_datum":"2027-05-01","bis_datum":"2027-06-30","stunden":8}')`,
  pep_wiederholung_loeschen: `select public.pep_wiederholung_loeschen(1)`,
  pep_urlaub_umfrage_schalten: `select public.pep_urlaub_umfrage_schalten(1, true)`,
  pep_urlaub_zuordnung_setzen: `select public.pep_urlaub_zuordnung_setzen(1, ${ma})`,
  pep_urlaub_freigeben: `select public.pep_urlaub_freigeben(${ma}, null, null, '{"umfrage_id":1,"urlaub_mitarbeiter_id":1,"art":"kw","kw":12,"datum":null}', null)`,
  pep_urlaub_ablehnen: `select public.pep_urlaub_ablehnen(${ma}, '{"umfrage_id":1,"urlaub_mitarbeiter_id":1,"art":"kw","kw":12,"datum":null}', null)`,
  pep_freigabe_zuruecknehmen: `select public.pep_freigabe_zuruecknehmen(1)`,
  pep_plan_malen: `select public.pep_plan_malen(${ma}, '2027-05-03', '08:00', '12:00', 2)`,
  pep_plan_zeile_setzen: `select public.pep_plan_zeile_setzen(${ma}, '2027-05-03', '[{"von":"08:00","bis":"12:00","bereich_id":2}]')`,
  pep_kommentar_setzen: `select public.pep_kommentar_setzen(${ma}, '2027-05-03', 'Test')`,
  // Ida ist die einzige aktive Mitarbeiterin: ohne Rechtecheck würde die Position geschrieben.
  pep_mitarbeiter_reihenfolge: `select public.pep_mitarbeiter_reihenfolge(array[${ma}]::bigint[])`,
});

const zaehlen = async () => {
  const tabellen = (await db.query(
    "select table_name from information_schema.tables where table_schema = 'pep' and table_type = 'BASE TABLE' order by 1")).rows;
  const z = {};
  for (const t of tabellen) z[t.table_name] = (await db.query(`select count(*)::int as n from pep.${t.table_name}`)).rows[0].n;
  return z;
};

test('jede schreibende pep_*-Funktion ist abgedeckt (neue Funktion → hier eintragen)', async () => {
  const schreibend = (await pepFunktionen()).map((f) => f.name).filter((n) => !NUR_LESEN.includes(n));
  const karte = aufrufe();
  for (const n of schreibend) assert.ok(karte[n], `kein Dummy-Aufruf für ${n}`);
  for (const n of Object.keys(karte)) assert.ok(schreibend.includes(n), `${n} ist nicht (mehr) schreibend/vorhanden`);
  for (const n of NUR_LESEN) assert.ok((await pepFunktionen()).some((f) => f.name === n), `${n} fehlt`);
});

test('schreibende Funktionen: Stellvertretung, Rolle mitarbeiter, Leitung ohne Filiale scheitern, nichts ändert sich', async () => {
  const FEHLER = /NUR_LEITUNG|KEIN_ZUGRIFF|KEINE_FILIALE/;
  const vorher = await zaehlen();
  const karte = aufrufe();
  for (const [name, sql] of Object.entries(karte)) {
    if (!AUCH_STELLVERTRETUNG.includes(name)) {
      await assert.rejects(aufruf(stellv, sql), FEHLER, `Stellvertretung: ${name}`);
    }
    await assert.rejects(aufruf(azubi, sql), FEHLER, `mitarbeiter: ${name}`);
    if (!OHNE_FILIALE_ERLAUBT.includes(name)) {
      await assert.rejects(aufruf(ohne, sql), FEHLER, `Leitung ohne Filiale: ${name}`);
    }
  }
  // Die Filiale-anlegen-Prüfung gilt für Stellvertretung und Mitarbeiter (oben), nicht für die Leitung ohne Filiale.
  assert.deepEqual(await zaehlen(), vorher);
});

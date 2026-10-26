// Rechte: Funktionsrechte aller public.pep_*-Funktionen und Zugriffsprüfung jeder schreibenden Funktion.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale } from './helfer.mjs';

let db, leitung, stellv, azubi, ohne, fil, ma, jo, vorlage, sicherung, wg;

const aufruf = (nutzer, sql) => als(db, 'authenticated', nutzer, sql);

before(async () => {
  db = await neueDatenbank();
  leitung = await pepBenutzer(db, 'chef');
  fil = await filiale(db, leitung);
  stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  azubi = await pepBenutzer(db, 'azubi', 'mitarbeiter', fil);
  ohne = await pepBenutzer(db, 'chefOhne'); // Leitung ohne Filiale
  ma = (await aufruf(leitung, `select public.pep_mitarbeiter_speichern(null, '{"name":"Test, Ida"}') as r`))[0].r;
  // Echte Vorlage: ohne Rechtecheck würde Laden protokollieren, Löschen sie entfernen.
  vorlage = (await db.query(`insert into pep.vorlagen (filiale_id, name, art, daten)
    values ($1, 'Rechte', 'tag', $2::jsonb) returning id`,
    [fil, JSON.stringify([{ wochentag: null, mitarbeiter_id: ma, von: '08:00', bis: '12:00', bereich_id: 2 }])])).rows[0].id;
  // Krank/ZA und Ersatz: Ida mit Vertrag, KA-Block und Krankmeldung am 03.05.2027, Jo als möglicher Ersatz.
  // Ohne Rechtecheck würde pep_schnell_abwesend einen Tag schreiben und pep_ersatz_uebernehmen den Block verschieben.
  jo = (await aufruf(leitung, `select public.pep_mitarbeiter_speichern(null, '{"name":"Test, Jo"}') as r`))[0].r;
  await db.query(`insert into pep.vertraege (mitarbeiter_id, gueltig_ab, vertragsart, wochenstunden)
    values ($1, '2026-01-01', 'vollzeit', 37.5), ($2, '2026-01-01', 'vollzeit', 37.5)`, [ma, jo]);
  await db.query(`insert into pep.kompetenzen (mitarbeiter_id, bereich_id)
    select $1, id from pep.bereiche where filiale_id = $2 and kuerzel = 'KA'`, [jo, fil]);
  await db.query(`insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
    select $1, $2, '2027-05-03', '08:00', '12:00', id from pep.bereiche where filiale_id = $1 and kuerzel = 'KA'`, [fil, ma]);
  await db.query(`insert into pep.abwesenheiten (filiale_id, mitarbeiter_id, code_id, datum, stunden, quelle)
    select $1, $2, id, '2027-05-03', 6.25, 'manuell' from pep.abwesenheitscodes where filiale_id = $1 and code = 'KM'`, [fil, ma]);
  wg = (await db.query('select id from pep.warengruppen where filiale_id = $1', [fil])).rows[0].id; // Startgruppe
  // Echte Sicherung dieser Filiale: ohne Rechtecheck scheiterte das Einspielen erst an FILIALE_NICHT_LEER (sichtbar).
  sicherung = (await aufruf(leitung, 'select public.pep_sicherung() as r'))[0].r;
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
    // Einzige Ausnahme: der Weckruf gegen das Pausieren (GitHub Actions ruft ihn ohne Anmeldung auf, s. u.).
    assert.equal(f.anon, f.name === 'pep_lebenszeichen', `anon: ${f.name}`);
    assert.equal(f.angemeldet, true, `angemeldet: ${f.name}`);
    assert.equal(f.prosecdef, true, `security definer: ${f.name}`);
    assert.ok((f.proconfig ?? []).some((c) => /^search_path=/.test(c)), `search_path: ${f.name}`);
  }
});

// Nur lesende Funktionen; alles andere gilt als schreibend und muss unten abgedeckt sein. pep_ich schreibt einmal die
// eigene erste Anmeldung (benutzer.bestaetigt_am) und ist für jede Rolle erlaubt, darum hier.
const NUR_LESEN = ['pep_ich', 'pep_bereiche', 'pep_mitarbeiter_liste', 'pep_mitarbeiter', 'pep_einstellungen',
  'pep_feiertage', 'pep_abwesenheiten', 'pep_urlaub_umfragen', 'pep_urlaub_zuordnung', 'pep_einsatzplan_woche',
  'pep_pruefung_zeitraum', 'pep_vorlagen', 'pep_ersatz_kandidaten', 'pep_eckdaten', 'pep_vorausplanung', 'pep_resturlaub',
  'pep_startseite', 'pep_ist_woche', 'pep_zeitkonto_woche', 'pep_zeitkonto_journal', 'pep_stundenblatt',
  'pep_sicherung_pruefen'];
// Auch für die Stellvertretung erlaubt.
const AUCH_STELLVERTRETUNG = ['pep_abwesenheit_setzen', 'pep_abwesenheit_loeschen',
  'pep_wiederholung_speichern', 'pep_wiederholung_loeschen',
  'pep_plan_malen', 'pep_plan_zeile_setzen', 'pep_kommentar_setzen',
  'pep_tag_kopieren', 'pep_woche_kopieren', 'pep_vorlage_speichern', 'pep_vorlage_laden', 'pep_vorlage_loeschen',
  'pep_schnell_abwesend', 'pep_ersatz_uebernehmen', 'pep_woche_speichern',
  'pep_ist_malen', 'pep_ist_zeile_setzen', 'pep_ist_bestaetigen'];
// Legt für die Leitung ohne Filiale die Filiale an – das ist gewollt und in basis.test.mjs geprüft.
// Weckruf: ohne Anmeldung aufrufbar, ohne Rollenprüfung, ohne Daten; eigener Test am Dateiende.
const OHNE_ANMELDUNG = ['pep_lebenszeichen'];
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
  // Nur Leitung. Echte Warengruppe: ohne Rechtecheck würde sie umbenannt, das Muster geändert (und protokolliert).
  pep_warengruppe_speichern: `select public.pep_warengruppe_speichern(${wg}, '{"name":"Zzz"}')`,
  pep_liefer_muster_setzen: `select public.pep_liefer_muster_setzen(2, '{"lkw":"08:30"}')`,
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
  // Ida und Jo sind die einzigen aktiven Mitarbeiter: ohne Rechtecheck würde die Position geschrieben.
  pep_mitarbeiter_reihenfolge: `select public.pep_mitarbeiter_reihenfolge(array[${ma}, ${jo}]::bigint[])`,
  // Kopieren und Laden schreiben je geöffnetem Zieltag einen Protokolleintrag, auch ohne passende Blöcke.
  pep_tag_kopieren: `select public.pep_tag_kopieren('2027-05-03', array['2027-05-10']::date[], 'ersetzen')`,
  pep_woche_kopieren: `select public.pep_woche_kopieren(2027, 18, '[{"jahr":2027,"kw":19}]', 'ersetzen')`,
  pep_vorlage_speichern: `select public.pep_vorlage_speichern('Test', 'tag', '2027-05-03')`,
  pep_vorlage_laden: `select public.pep_vorlage_laden(${vorlage}, '2027-05-10', 'ersetzen')`,
  pep_vorlage_loeschen: `select public.pep_vorlage_loeschen(${vorlage})`,
  pep_schnell_abwesend: `select public.pep_schnell_abwesend(${ma}, 'ZA', '2027-05-04', '2027-05-04')`,
  pep_ersatz_uebernehmen: `select public.pep_ersatz_uebernehmen(${ma}, '2027-05-03', ${jo})`,
  // Schreibt Planumsatz und Vorgabe der Woche (und ein Protokoll): ohne Rechtecheck wäre das sichtbar.
  pep_woche_speichern: `select public.pep_woche_speichern(2027, 18, '{"planumsatz":61000,"stundenvorgabe_manuell":240}')`,
  // IST an einem vergangenen Montag (Ida hat seit 01.01.2026 Vertrag): ohne Rechtecheck entstünden IST-Blöcke
  // bzw. ein ist_tage-Eintrag.
  pep_ist_malen: `select public.pep_ist_malen(${ma}, '2026-03-02', '08:00', '12:00', 2, null)`,
  pep_ist_zeile_setzen: `select public.pep_ist_zeile_setzen(${ma}, '2026-03-02', '[{"von":"08:00","bis":"12:00","bereich_id":2}]', null)`,
  pep_ist_bestaetigen: `select public.pep_ist_bestaetigen('2026-03-02', array[${ma}]::bigint[])`,
  // Nur Leitung. Abschluss einer vergangenen Woche (ohne Rechtecheck: IST_OFFEN, also ebenfalls kein Treffer für FEHLER);
  // Buchung für Ida: ohne Rechtecheck entstünde eine Journalzeile.
  pep_wochenabschluss: `select public.pep_wochenabschluss(2026, 10)`,
  pep_zeitkonto_buchen: `select public.pep_zeitkonto_buchen(${ma}, 'manuell', 5, 'Test', '2026-03-02')`,
  // Nur Leitung. Sichern schreibt pep.sicherungen und das Protokoll; Einspielen mit der echten Datei und richtiger
  // Bestätigung (ohne Rechtecheck: FILIALE_NICHT_LEER, also kein Treffer für FEHLER).
  pep_sicherung: 'select public.pep_sicherung()',
  pep_sicherung_einspielen: `select public.pep_sicherung_einspielen('${JSON.stringify(sicherung).replaceAll("'", "''")}'::jsonb, '2558')`,
});

const zaehlen = async () => {
  const tabellen = (await db.query(
    "select table_name from information_schema.tables where table_schema = 'pep' and table_type = 'BASE TABLE' order by 1")).rows;
  const z = {};
  for (const t of tabellen) z[t.table_name] = (await db.query(`select count(*)::int as n from pep.${t.table_name}`)).rows[0].n;
  return z;
};

test('jede schreibende pep_*-Funktion ist abgedeckt (neue Funktion → hier eintragen)', async () => {
  const schreibend = (await pepFunktionen()).map((f) => f.name).filter((n) => !NUR_LESEN.includes(n) && !OHNE_ANMELDUNG.includes(n));
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

// Lesende Funktionen mit Mitarbeiterbezug werden oben nicht aufgerufen: Rolle mitarbeiter und Leitung ohne Filiale
// dürfen auch die Eckdaten und die Ersatzliste eines Mitarbeiters nicht sehen.
test('lesend mit Mitarbeiter: Rolle mitarbeiter → NUR_LEITUNG, Leitung ohne Filiale → KEINE_FILIALE', async () => {
  for (const sql of [`select public.pep_eckdaten(${ma}, '2027-05-03')`,
    `select public.pep_ersatz_kandidaten(${ma}, '2027-05-03')`]) {
    await assert.rejects(aufruf(azubi, sql), /NUR_LEITUNG/, `mitarbeiter: ${sql}`);
    await assert.rejects(aufruf(ohne, sql), /KEINE_FILIALE/, `Leitung ohne Filiale: ${sql}`);
  }
  // Gegenprobe: Leitung und Stellvertretung dürfen
  for (const nutzer of [leitung, stellv]) await aufruf(nutzer, `select public.pep_eckdaten(${ma}, '2027-05-03')`);
});

// Der Resturlaub zeigt Anspruch und Urlaub aller Mitarbeiter: nur Leitung und Stellvertretung mit Filiale.
test('pep_resturlaub: Rolle mitarbeiter → NUR_LEITUNG, Leitung ohne Filiale → KEINE_FILIALE', async () => {
  const sql = 'select public.pep_resturlaub(2027)';
  await assert.rejects(aufruf(azubi, sql), /NUR_LEITUNG/);
  await assert.rejects(aufruf(ohne, sql), /KEINE_FILIALE/);
  for (const nutzer of [leitung, stellv]) await aufruf(nutzer, sql);
});

// Die Startseite zählt Abwesende, Lücken, Verstöße und Wünsche der Filiale: nur Leitung und Stellvertretung mit Filiale.
test('pep_startseite: Rolle mitarbeiter → NUR_LEITUNG, Leitung ohne Filiale → KEINE_FILIALE', async () => {
  const sql = 'select public.pep_startseite()';
  await assert.rejects(aufruf(azubi, sql), /NUR_LEITUNG/);
  await assert.rejects(aufruf(ohne, sql), /KEINE_FILIALE/);
  for (const nutzer of [leitung, stellv]) await aufruf(nutzer, sql);
});

// Die IST-Woche zeigt Arbeitszeiten aller Mitarbeiter: nur Leitung und Stellvertretung mit Filiale.
test('pep_ist_woche: Rolle mitarbeiter → NUR_LEITUNG, Leitung ohne Filiale → KEINE_FILIALE', async () => {
  const sql = 'select public.pep_ist_woche(2026, 10)';
  await assert.rejects(aufruf(azubi, sql), /NUR_LEITUNG/);
  await assert.rejects(aufruf(ohne, sql), /KEINE_FILIALE/);
  for (const nutzer of [leitung, stellv]) await aufruf(nutzer, sql);
});

// Das Zeitkonto zeigt Stunden und Salden aller Mitarbeiter: nur Leitung und Stellvertretung mit Filiale.
test('pep_zeitkonto_woche: Rolle mitarbeiter → NUR_LEITUNG, Leitung ohne Filiale → KEINE_FILIALE', async () => {
  const sql = 'select public.pep_zeitkonto_woche(2026, 10)';
  await assert.rejects(aufruf(azubi, sql), /NUR_LEITUNG/);
  await assert.rejects(aufruf(ohne, sql), /KEINE_FILIALE/);
  for (const nutzer of [leitung, stellv]) await aufruf(nutzer, sql);
});

// Das Journal zeigt Buchungen und Salden aller Mitarbeiter: nur Leitung und Stellvertretung mit Filiale.
test('pep_zeitkonto_journal: Rolle mitarbeiter → NUR_LEITUNG, Leitung ohne Filiale → KEINE_FILIALE', async () => {
  for (const sql of ['select public.pep_zeitkonto_journal(null, null, null)',
    `select public.pep_zeitkonto_journal(${ma}, '2026-01-01', '2026-12-31')`]) {
    await assert.rejects(aufruf(azubi, sql), /NUR_LEITUNG/, `mitarbeiter: ${sql}`);
    await assert.rejects(aufruf(ohne, sql), /KEINE_FILIALE/, `Leitung ohne Filiale: ${sql}`);
    for (const nutzer of [leitung, stellv]) await aufruf(nutzer, sql);
  }
});

// Das Stundenblatt zeigt Arbeitszeiten und Salden aller Mitarbeiter: nur Leitung und Stellvertretung mit Filiale.
test('pep_stundenblatt: Rolle mitarbeiter → NUR_LEITUNG, Leitung ohne Filiale → KEINE_FILIALE', async () => {
  for (const sql of ["select public.pep_stundenblatt(null, '2026-03-02', '2026-03-08')",
    `select public.pep_stundenblatt(${ma}, '2026-03-02', '2026-03-08')`]) {
    await assert.rejects(aufruf(azubi, sql), /NUR_LEITUNG/, `mitarbeiter: ${sql}`);
    await assert.rejects(aufruf(ohne, sql), /KEINE_FILIALE/, `Leitung ohne Filiale: ${sql}`);
    for (const nutzer of [leitung, stellv]) await aufruf(nutzer, sql);
  }
});

// Die Vorschau einer Sicherung zeigt Filialnummer und Anzahlen und ob die eigene Filiale leer ist: nur Leitung.
test('pep_sicherung_pruefen: Stellvertretung und Rolle mitarbeiter → NUR_LEITUNG, Leitung ohne Filiale → KEINE_FILIALE', async () => {
  const sql = `select public.pep_sicherung_pruefen('${JSON.stringify(sicherung).replaceAll("'", "''")}'::jsonb)`;
  await assert.rejects(aufruf(stellv, sql), /NUR_LEITUNG/);
  await assert.rejects(aufruf(azubi, sql), /NUR_LEITUNG/);
  await assert.rejects(aufruf(ohne, sql), /KEINE_FILIALE/);
  await aufruf(leitung, sql);
});

test('Weckruf: pep_lebenszeichen liefert anon true, liest keine Tabelle, sonst bleibt anon überall gesperrt', async () => {
  const r = await als(db, 'anon', null, 'select public.pep_lebenszeichen() as r');
  assert.equal(r[0].r, true);
  const fns = await pepFunktionen();
  const offen = fns.filter((f) => f.anon).map((f) => f.name);
  assert.deepEqual(offen, ['pep_lebenszeichen']);
  const q = (await db.query(`select prosrc from pg_proc where proname = 'pep_lebenszeichen'`)).rows[0].prosrc;
  assert.doesNotMatch(q, /from/i, 'darf keine Tabelle lesen');
});

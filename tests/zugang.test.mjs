// Mitarbeiter-Zugang (Stufe 3, Task 2): Einladung je Mitarbeiter, eigenes Konto über den Trigger auf auth.users,
// Datenschutztext und -bestätigung, pep.ich_mitarbeiter, pep_mein_konto und pep_mein_zustimmen.
// Leitung „chef“ mit Filiale und Datenschutztext, Stellvertretung „vize“; heute = Mo 02.11.2026.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, heuteSetzen, registriereMitarbeiter } from './helfer.mjs';
import { aufrufe, leseAufrufe } from './rechte-aufrufe.mjs';

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

let db, leitung, stellv, fil;
const json = async (nutzer, sql, params = []) => (await als(db, 'authenticated', nutzer, sql, params))[0].r;
const neuerMa = (name, daten = {}) => json(leitung, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r',
  [JSON.stringify({ name, ...daten })]);
const aendern = (ma, daten) => json(leitung, 'select public.pep_mitarbeiter_speichern($1, $2::jsonb) as r',
  [ma, JSON.stringify(daten)]);
const einladen = (ma, nutzer = leitung) => json(nutzer, 'select public.pep_zugang_einladen($1) as r', [ma]);
const sperren = (ma, gesperrt, nutzer = leitung) =>
  als(db, 'authenticated', nutzer, 'select public.pep_zugang_sperren($1, $2)', [ma, gesperrt]);
const zugang = async (ma) => (await json(leitung, 'select public.pep_mitarbeiter($1) as r', [ma])).zugang;
const pruefen = async (code) => (await als(db, 'anon', null, 'select public.pep_zugang_pruefen($1) as r', [code]))[0].r;
const meinKonto = (u) => json(u, 'select public.pep_mein_konto() as r');
const zustimmenVersion = (u, version) => als(db, 'authenticated', u, 'select public.pep_mein_zustimmen($1)', [version]);
// Stimmt der aktuellen Version zu (die Version liest das Konto selbst, wie die Seite).
const zustimmen = async (u) => zustimmenVersion(u, (await meinKonto(u)).zustimmung.version);
const textSpeichern = (text, nutzer = leitung) => json(nutzer, 'select public.pep_datenschutz_speichern($1) as r', [text]);
// Der interne Helfer, mit dem die Mitarbeiter-Funktionen beginnen (als Eigentümer, mit dem Konto als auth.uid()).
const ichMitarbeiter = async (u, zustimmungNoetig = true) =>
  (await als(db, 'postgres', u, 'select (pep.ich_mitarbeiter($1)).id as r', [zustimmungNoetig]))[0].r;
const kontenAnzahl = async () => (await db.query('select count(*)::int as n from auth.users')).rows[0].n;
const protokoll = async (aktion) => (await db.query(
  'select * from pep.protokoll where aktion = $1 order by id', [aktion])).rows;

// Neuer Mitarbeiter mit eingelöster Einladung (Konto benutzername) und, wenn gewünscht, Zustimmung.
async function mitKonto(name, benutzername, { zustimmung = true } = {}) {
  const ma = await neuerMa(name);
  const { code } = await einladen(ma);
  const u = await registriereMitarbeiter(db, benutzername, code);
  if (zustimmung) await zustimmen(u);
  return { ma, u, code };
}

before(async () => {
  db = await neueDatenbank();
  await heuteSetzen(db, '2026-11-02');
  leitung = await pepBenutzer(db, 'chef');
  fil = await filiale(db, leitung);
  stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  await textSpeichern('Datenschutzhinweis (Entwurf, rechtlich ungeprüft)');
});

test('einladen ohne Datenschutztext → DATENSCHUTZ_FEHLT, nichts angelegt', async () => {
  const chef2 = await pepBenutzer(db, 'chef2');
  await filiale(db, chef2, { name: 'Netto Ohne Text', nummer: '1111' });
  const ma = await json(chef2, `select public.pep_mitarbeiter_speichern(null, '{"name":"Test, Ohne"}') as r`);
  assert.equal(await json(chef2, 'select public.pep_datenschutz() as r'), null);
  await wirft(einladen(ma, chef2), 'DATENSCHUTZ_FEHLT');
  assert.equal((await db.query('select count(*)::int as n from pep.mitarbeiter_einladungen where mitarbeiter_id = $1',
    [ma])).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int as n from pep.mitarbeiter_zugaenge where mitarbeiter_id = $1',
    [ma])).rows[0].n, 0);
});

test('einladen + registrieren: Zugang aktiv, kein Organisator, Einladung eingelöst', async () => {
  const ma = await neuerMa('Test, Ida');
  assert.deepEqual(await zugang(ma), { stand: 'kein', gueltig_bis: null, aktiv_seit: null, zustimmung_am: null });
  const e = await einladen(ma);
  assert.deepEqual(Object.keys(e).sort(), ['code', 'gueltig_bis']);
  assert.match(e.code, /^[0-9a-f]{32}$/);
  const tage = (Date.parse(e.gueltig_bis) - Date.now()) / 864e5;
  assert.ok(tage > 6.9 && tage <= 7, `gültig 7 Tage: ${tage}`);
  const z1 = await zugang(ma);
  assert.equal(z1.stand, 'eingeladen');
  assert.equal(Date.parse(z1.gueltig_bis), Date.parse(e.gueltig_bis));
  // Die Stellvertretung sieht den Stand mit (lesen), einladen darf sie nicht (eigener Test).
  assert.equal((await json(stellv, 'select public.pep_mitarbeiter($1) as r', [ma])).zugang.stand, 'eingeladen');

  const u = await registriereMitarbeiter(db, 'ida', e.code);
  assert.equal((await db.query('select count(*)::int as n from urlaub.organisatoren where user_id = $1', [u])).rows[0].n, 0);
  const einl = (await db.query('select * from pep.mitarbeiter_einladungen where code = $1', [e.code])).rows[0];
  assert.equal(einl.eingeloest_von, u);
  assert.ok(einl.eingeloest_am);
  const z2 = await zugang(ma);
  assert.equal(z2.stand, 'aktiv');
  assert.ok(z2.aktiv_seit);
  assert.equal(z2.gueltig_bis, null);
  assert.equal(z2.zustimmung_am, null);
  assert.equal(await ichMitarbeiter(u, false), ma);
  // Das Mitarbeiter-Konto ist kein PEP-Benutzer
  await wirft(json(u, 'select public.pep_ich() as r'), 'KEIN_ZUGRIFF');
  // Protokoll: Einladen (ohne den Code, er ist ein Geheimnis) und Aktivieren
  const pe = (await protokoll('zugang_einladen')).filter((p) => p.schluessel === String(ma));
  assert.equal(pe.length, 1);
  assert.equal(pe[0].filiale_id, fil);
  assert.doesNotMatch(JSON.stringify(pe[0]), new RegExp(e.code));
  const pa = (await protokoll('zugang_aktiv')).filter((p) => p.schluessel === String(ma));
  assert.equal(pa.length, 1);
  assert.equal(pa[0].nachher.user_id, u);
});

test('Code ungültig/abgelaufen/eingelöst/ersetzt, Mitarbeiter inaktiv oder ausgetreten → EINLADUNG_UNGUELTIG, kein Konto', async () => {
  const vorher = await kontenAnzahl();
  const unbekannt = '0123456789abcdef0123456789abcdef';
  // abgelaufen
  const maAb = await neuerMa('Test, Abgelaufen');
  const ab = (await einladen(maAb)).code;
  await db.query("update pep.mitarbeiter_einladungen set gueltig_bis = now() - interval '1 second' where code = $1", [ab]);
  // eingelöst
  const maEin = await neuerMa('Test, Eingeloest');
  const ein = (await einladen(maEin)).code;
  await registriereMitarbeiter(db, 'eingeloest', ein);
  // ersetzt
  const maErs = await neuerMa('Test, Ersetzt');
  const ers = (await einladen(maErs)).code;
  await einladen(maErs);
  // Mitarbeiter inaktiv bzw. gestern ausgetreten (nach dem Einladen)
  const maIn = await neuerMa('Test, Inaktiv');
  const inaktiv = (await einladen(maIn)).code;
  await aendern(maIn, { aktiv: false });
  const maAus = await neuerMa('Test, Ausgetreten');
  const aus = (await einladen(maAus)).code;
  await aendern(maAus, { austritt: '2026-11-01' });

  for (const [fall, code] of [['unbekannt', unbekannt], ['leer', null], ['abgelaufen', ab], ['eingelöst', ein],
    ['ersetzt', ers], ['inaktiv', inaktiv], ['ausgetreten', aus]]) {
    await wirft(registriereMitarbeiter(db, `konto-${fall === 'eingelöst' ? 'zwei' : fall}`, code), 'EINLADUNG_UNGUELTIG');
    assert.deepEqual(await pruefen(code), { gueltig: false }, fall);
  }
  assert.equal(await kontenAnzahl(), vorher + 1, 'nur das eine eingelöste Konto');
  assert.equal((await zugang(maAb)).stand, 'kein');
});

test('Benutzername "A b", zu kurz oder fremde Domain → BENUTZERNAME_UNGUELTIG; der Code bleibt gültig', async () => {
  const ma = await neuerMa('Test, Name');
  const { code } = await einladen(ma);
  const vorher = await kontenAnzahl();
  await wirft(registriereMitarbeiter(db, 'A b', code), 'BENUTZERNAME_UNGUELTIG');
  await wirft(registriereMitarbeiter(db, 'x', code), 'BENUTZERNAME_UNGUELTIG');
  await wirft(registriereMitarbeiter(db, 'name', code, { domain: 'example.org' }), 'BENUTZERNAME_UNGUELTIG');
  assert.equal(await kontenAnzahl(), vorher);
  assert.deepEqual(await pruefen(code), { gueltig: true });
  await registriereMitarbeiter(db, 'test.name-1', code);
  assert.equal((await zugang(ma)).stand, 'aktiv');
});

test('zweites Einlösen desselben Codes → genau ein Konto', async () => {
  const ma = await neuerMa('Test, Kai');
  const { code } = await einladen(ma);
  const u = await registriereMitarbeiter(db, 'kai', code);
  await wirft(registriereMitarbeiter(db, 'kai2', code), 'EINLADUNG_UNGUELTIG');
  assert.equal((await db.query("select count(*)::int as n from auth.users where email like 'kai%'")).rows[0].n, 1);
  assert.equal((await db.query('select user_id from pep.mitarbeiter_zugaenge where mitarbeiter_id = $1', [ma])).rows[0].user_id, u);
});

test('neuer Link ersetzt alten; altes Konto bis zum Einlösen gültig, danach KEIN_ZUGRIFF', async () => {
  const { ma, u: alt } = await mitKonto('Test, Lea', 'lea');
  assert.equal(await ichMitarbeiter(alt), ma);
  // Passwort vergessen: neuer Link. Das alte Konto bleibt gültig, der Stand zeigt den offenen Link.
  const zweit = (await einladen(ma)).code;
  const z = await zugang(ma);
  assert.equal(z.stand, 'aktiv');
  assert.ok(z.gueltig_bis);
  assert.ok(z.zustimmung_am);
  assert.equal(await ichMitarbeiter(alt), ma);
  // Noch ein Link: der zweite gilt nicht mehr, das alte Konto weiterhin.
  const dritt = (await einladen(ma)).code;
  assert.deepEqual(await pruefen(zweit), { gueltig: false });
  await wirft(registriereMitarbeiter(db, 'lea2', zweit), 'EINLADUNG_UNGUELTIG');
  assert.equal(await ichMitarbeiter(alt), ma);
  // Eingelöst: der Zugang zeigt auf das neue Konto, das alte bleibt in auth.users, aber ohne Zugang.
  const neu = await registriereMitarbeiter(db, 'lea3', dritt);
  await wirft(ichMitarbeiter(alt), 'KEIN_ZUGRIFF');
  await wirft(zustimmenVersion(alt, 1), 'KEIN_ZUGRIFF');
  assert.equal(await meinKonto(alt), null);
  assert.equal((await db.query('select count(*)::int as n from auth.users where id = $1', [alt])).rows[0].n, 1);
  // Das neue Konto muss neu zustimmen (ein weitergegebener Link könnte bei jemand anderem gelandet sein).
  await wirft(ichMitarbeiter(neu), 'ZUSTIMMUNG_FEHLT');
  assert.equal((await meinKonto(neu)).zustimmung.noetig, true);
  const z2 = await zugang(ma);
  assert.equal(z2.stand, 'aktiv');
  assert.equal(z2.gueltig_bis, null);
  assert.equal(z2.zustimmung_am, null);
});

test('pep_mein_konto: null für Organisator, Daten für Mitarbeiter, zustimmung.noetig true', async () => {
  assert.equal(await meinKonto(leitung), null);
  assert.equal(await meinKonto(stellv), null);
  const { u } = await mitKonto('Test, Mia', 'mia', { zustimmung: false });
  const d = await json(leitung, 'select public.pep_datenschutz() as r');
  assert.deepEqual(await meinKonto(u), {
    name: 'Test, Mia',
    filiale: { name: 'Netto Aschaffenburg' },
    zustimmung: { noetig: true, version: d.version, text: d.text },
  });
  await zustimmen(u);
  assert.equal((await meinKonto(u)).zustimmung.noetig, false);
});

test('ZUSTIMMUNG_FEHLT bis pep_mein_zustimmen; neue Textversion → wieder ZUSTIMMUNG_FEHLT; neues Konto → wieder ZUSTIMMUNG_FEHLT', async () => {
  const { ma, u } = await mitKonto('Test, Nils', 'nils', { zustimmung: false });
  await wirft(ichMitarbeiter(u), 'ZUSTIMMUNG_FEHLT');
  assert.equal(await ichMitarbeiter(u, false), ma, 'ohne Zustimmungspflicht geht es');
  await zustimmen(u);
  assert.equal(await ichMitarbeiter(u), ma);
  assert.ok((await zugang(ma)).zustimmung_am);
  const pz = (await protokoll('zustimmung')).filter((p) => p.schluessel === String(ma));
  assert.equal(pz.length, 1);
  // Doppelt zustimmen fügt nichts hinzu
  await zustimmen(u);
  assert.equal((await db.query('select count(*)::int as n from pep.zustimmungen where mitarbeiter_id = $1', [ma])).rows[0].n, 1);

  const alt = (await meinKonto(u)).zustimmung.version;
  const neu = await textSpeichern(`Datenschutzhinweis, Fassung für Nils ${Date.now()}`);
  assert.equal(neu.version, alt + 1);
  await wirft(ichMitarbeiter(u), 'ZUSTIMMUNG_FEHLT');
  assert.deepEqual((await meinKonto(u)).zustimmung, { noetig: true, version: neu.version, text: neu.text });
  assert.equal((await zugang(ma)).zustimmung_am, null);
  await zustimmen(u);
  assert.equal(await ichMitarbeiter(u), ma);

  // Neues Konto (neuer Link eingelöst): die Zustimmung des alten Kontos zählt nicht
  const { code } = await einladen(ma);
  const u2 = await registriereMitarbeiter(db, 'nils2', code);
  await wirft(ichMitarbeiter(u2), 'ZUSTIMMUNG_FEHLT');
  await zustimmen(u2);
  assert.equal(await ichMitarbeiter(u2), ma);
});

test('VERSION_VERALTET bei alter, künftiger oder fehlender Version; nichts angefügt', async () => {
  await textSpeichern(`Datenschutzhinweis, Fassung für Ole ${Date.now()}`); // es gibt sicher eine ältere Version
  const { ma, u } = await mitKonto('Test, Ole', 'ole', { zustimmung: false });
  const aktuell = (await meinKonto(u)).zustimmung.version;
  for (const v of [aktuell - 1, aktuell + 1, null]) await wirft(zustimmenVersion(u, v), 'VERSION_VERALTET');
  assert.equal((await db.query('select count(*)::int as n from pep.zustimmungen where mitarbeiter_id = $1', [ma])).rows[0].n, 0);
  await wirft(ichMitarbeiter(u), 'ZUSTIMMUNG_FEHLT');
});

test('gesperrt / inaktiv / austritt gestern → KEIN_ZUGRIFF; Sperren schließt offene Links', async () => {
  const { ma, u } = await mitKonto('Test, Pia', 'pia');
  assert.equal(await ichMitarbeiter(u), ma);

  await sperren(ma, true);
  assert.equal((await zugang(ma)).stand, 'gesperrt');
  await wirft(ichMitarbeiter(u, false), 'KEIN_ZUGRIFF');
  await wirft(meinKonto(u), 'KEIN_ZUGRIFF');
  await wirft(zustimmen(u), 'KEIN_ZUGRIFF');
  await sperren(ma, false);
  assert.equal((await zugang(ma)).stand, 'aktiv');
  assert.equal(await ichMitarbeiter(u), ma);
  assert.equal((await protokoll('zugang_sperren')).filter((p) => p.schluessel === String(ma)).length, 1);
  assert.equal((await protokoll('zugang_entsperren')).filter((p) => p.schluessel === String(ma)).length, 1);

  await aendern(ma, { aktiv: false });
  await wirft(ichMitarbeiter(u, false), 'KEIN_ZUGRIFF');
  await wirft(meinKonto(u), 'KEIN_ZUGRIFF');
  await aendern(ma, { aktiv: true });
  assert.equal(await ichMitarbeiter(u), ma);

  await aendern(ma, { austritt: '2026-11-01' });
  await wirft(ichMitarbeiter(u, false), 'KEIN_ZUGRIFF');
  await wirft(meinKonto(u), 'KEIN_ZUGRIFF');
  await aendern(ma, { austritt: '2026-11-02' }); // Austritt heute: heute noch beschäftigt
  assert.equal(await ichMitarbeiter(u), ma);
  await aendern(ma, { austritt: null });

  // Ein offener Link darf eine Sperre nicht aufheben: Sperren macht ihn ungültig.
  const { code } = await einladen(ma);
  await sperren(ma, true);
  assert.deepEqual(await pruefen(code), { gueltig: false });
  await wirft(registriereMitarbeiter(db, 'pia2', code), 'EINLADUNG_UNGUELTIG');
  await wirft(ichMitarbeiter(u, false), 'KEIN_ZUGRIFF');
  // Einladen inaktiver Mitarbeiter geht nicht
  await aendern(ma, { aktiv: false });
  await wirft(einladen(ma), 'MITARBEITER_INAKTIV');
});

test('Stellvertretung darf nicht einladen/sperren/Text speichern → NUR_LEITUNG; lesen darf sie; fremde Filiale nicht', async () => {
  const ma = await neuerMa('Test, Rosa');
  const vorher = (await json(leitung, 'select public.pep_datenschutz() as r'));
  await wirft(einladen(ma, stellv), 'NUR_LEITUNG');
  await wirft(sperren(ma, true, stellv), 'NUR_LEITUNG');
  await wirft(textSpeichern('Anderer Text', stellv), 'NUR_LEITUNG');
  assert.deepEqual(await json(stellv, 'select public.pep_datenschutz() as r'), vorher);
  assert.equal((await zugang(ma)).stand, 'kein');
  // Leitung einer anderen Filiale
  const fremd = await pepBenutzer(db, 'fremd');
  await filiale(db, fremd, { name: 'Netto Fremd', nummer: '2222' });
  await json(fremd, `select public.pep_datenschutz_speichern('Fremder Text') as r`);
  await wirft(einladen(ma, fremd), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(sperren(ma, true, fremd), 'MITARBEITER_NICHT_GEFUNDEN');
  assert.equal((await zugang(ma)).stand, 'kein');
});

test('pep_datenschutz_speichern: neue Version nur bei geändertem Text, leer → TEXT_LEER, Protokoll', async () => {
  const vorher = await json(leitung, 'select public.pep_datenschutz() as r');
  assert.deepEqual(Object.keys(vorher).sort(), ['am', 'text', 'version']);
  const gleich = await textSpeichern(vorher.text);
  assert.deepEqual(gleich, vorher, 'gleicher Text: keine neue Version');
  for (const leer of ['', '   ', null]) await wirft(textSpeichern(leer), 'TEXT_LEER');
  const n = (await protokoll('datenschutz_text')).length;
  const neu = await textSpeichern('  Neuer Datenschutzhinweis  ');
  assert.equal(neu.version, vorher.version + 1);
  assert.equal(neu.text, 'Neuer Datenschutzhinweis');
  assert.deepEqual(await json(leitung, 'select public.pep_datenschutz() as r'), neu);
  assert.equal((await protokoll('datenschutz_text')).length, n + 1);
  // Die alte Fassung bleibt stehen
  assert.equal((await db.query('select count(*)::int as n from pep.datenschutz_texte where filiale_id = $1 and version = $2',
    [fil, vorher.version])).rows[0].n, 1);
});

test('Mitarbeiter-Konto bekommt von jeder bestehenden public.pep_*-Funktion KEIN_ZUGRIFF, nichts ändert sich', async () => {
  const { ma, u } = await mitKonto('Test, Sven', 'sven');
  assert.equal(await ichMitarbeiter(u), ma, 'Konto aktiv und zugestimmt');
  const jo = await neuerMa('Test, Jo');
  const wg = (await db.query('select id from pep.warengruppen where filiale_id = $1 order by id', [fil])).rows[0].id;
  const vorlage = (await db.query(`insert into pep.vorlagen (filiale_id, name, art, daten)
    values ($1, 'Zugang', 'tag', '[]'::jsonb) returning id`, [fil])).rows[0].id;
  const sicherung = await json(leitung, 'select public.pep_sicherung() as r');
  const ids = { ma, jo, stellv, wg, vorlage, sicherung };
  const karte = { ...aufrufe(ids), ...leseAufrufe(ids) };
  // Vollständig: jede public.pep_*-Funktion außer den eigenen Prüfungen hat einen Aufruf.
  const AUSSER = (n) => n === 'pep_lebenszeichen' || n === 'pep_zugang_pruefen' || n.startsWith('pep_mein_');
  const fns = (await db.query(`select p.proname as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname = 'public' and p.proname like 'pep\\_%'`)).rows.map((r) => r.n);
  for (const n of fns.filter((x) => !AUSSER(x))) assert.ok(karte[n], `kein Aufruf für ${n}`);

  const zaehlen = async () => (await db.query(`select table_name as t from information_schema.tables
    where table_schema = 'pep' and table_type = 'BASE TABLE' order by 1`)).rows;
  const stand = async () => {
    const z = {};
    for (const { t } of await zaehlen()) z[t] = (await db.query(`select count(*)::int as n from pep.${t}`)).rows[0].n;
    return z;
  };
  const vorher = await stand();
  for (const [name, sql] of Object.entries(karte)) {
    await assert.rejects(als(db, 'authenticated', u, sql), /KEIN_ZUGRIFF/, name);
  }
  assert.deepEqual(await stand(), vorher);
});

test('zustimmungen lassen sich nicht ändern oder löschen', async () => {
  const { ma } = await mitKonto('Test, Tom', 'tom');
  await wirft(db.query('update pep.zustimmungen set version = version + 1 where mitarbeiter_id = $1', [ma]),
    'ZUSTIMMUNG_UNVERAENDERBAR');
  await wirft(db.query('delete from pep.zustimmungen where mitarbeiter_id = $1', [ma]), 'ZUSTIMMUNG_UNVERAENDERBAR');
  await wirft(db.query('truncate pep.zustimmungen'), 'ZUSTIMMUNG_UNVERAENDERBAR');
  assert.equal((await db.query('select count(*)::int as n from pep.zustimmungen where mitarbeiter_id = $1', [ma])).rows[0].n, 1);
});

test('pep_zugang_pruefen als anon: {gueltig} ohne weitere Felder', async () => {
  const ma = await neuerMa('Test, Uwe');
  const { code } = await einladen(ma);
  assert.deepEqual(await pruefen(code), { gueltig: true });
  assert.deepEqual(await pruefen('gibtsnicht'), { gueltig: false });
  assert.deepEqual(await pruefen(null), { gueltig: false });
  // Angemeldet geht es genauso (die Seite prüft den Link vor der Registrierung, ggf. noch angemeldet).
  assert.deepEqual(await json(leitung, 'select public.pep_zugang_pruefen($1) as r', [code]), { gueltig: true });
});

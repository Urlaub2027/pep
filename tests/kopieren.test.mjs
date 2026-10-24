// Kopieren und Vorlagen (F11): Tag und Woche kopieren, Vorlagen speichern, laden, löschen.
// Jede Prüfung bekommt eine eigene Datenbank, weil Kopieren immer alle Blöcke eines Tages der Filiale nimmt.
// Heute = Mo 02.11.2026, Testwoche KW 46 (09.–15.11.2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, planGrundlage } from './helfer.mjs';

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

async function aufbau() {
  const db = await neueDatenbank();
  const g = await planGrundlage(db);
  const { leitung, code, json } = g;
  const aufruf = (nutzer, sql, params = []) => als(db, 'authenticated', nutzer, sql, params);
  const kopieren = (quelle, ziele, modus = 'leere', nutzer = leitung) =>
    json(nutzer, 'select public.pep_tag_kopieren($1::date, $2::date[], $3) as r', [quelle, ziele, modus]);
  const wocheKopieren = (jahr, kw, ziele, modus = 'leere', nutzer = leitung) =>
    json(nutzer, 'select public.pep_woche_kopieren($1, $2, $3::jsonb, $4) as r', [jahr, kw, JSON.stringify(ziele), modus]);
  const speichern = (name, art, datum, nutzer = leitung) =>
    json(nutzer, 'select public.pep_vorlage_speichern($1, $2, $3::date) as r', [name, art, datum]);
  const vorlagen = (nutzer = leitung) => json(nutzer, 'select public.pep_vorlagen() as r');
  const laden = (id, ziel, modus = 'leere', nutzer = leitung) =>
    json(nutzer, 'select public.pep_vorlage_laden($1, $2::date, $3) as r', [id, ziel, modus]);
  const loeschen = (id, nutzer = leitung) => aufruf(nutzer, 'select public.pep_vorlage_loeschen($1)', [id]);
  const abwesend = (maId, c, datum, stunden = null, von = null, bis = null) =>
    json(leitung, 'select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, $4::numeric, $5::time, $6::time, null) as r',
      [maId, code[c], datum, stunden, von, bis]);
  const vorgabe = (maId, daten) =>
    json(leitung, 'select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [maId, JSON.stringify(daten)]);
  // Gespeicherte Zeile [{von, bis, k}] eines Mitarbeiters an einem Tag.
  const zeile = async (maId, datum) => (await db.query(
    `select to_char(b.von, 'HH24:MI') as von, to_char(b.bis, 'HH24:MI') as bis, r.kuerzel as k
       from pep.plan_bloecke b join pep.bereiche r on r.id = b.bereich_id
      where b.mitarbeiter_id = $1 and b.datum = $2::date order by b.von`, [maId, datum])).rows;
  const anzahl = async () => (await db.query('select count(*)::int as n from pep.plan_bloecke')).rows[0].n;
  const protokolle = async () => (await db.query('select count(*)::int as n from pep.protokoll')).rows[0].n;
  return { db, ...g, aufruf, kopieren, wocheKopieren, speichern, vorlagen, laden, loeschen, abwesend, vorgabe,
    zeile, anzahl, protokolle };
}

const LEER = { unbesetzt: 0, gekuerzt: 0, ausgelassen: 0, ausgeschieden: [], uebersprungen: [] };

test('Tag Mo 09.11. → Mo 16.11.: gleiche Blöcke, Bericht bloecke = Anzahl', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  const b = await t.ma('Test, Bert', { kompetenzen: ['KA', 'OG'] });
  await t.malen(t.leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, a, '2026-11-09', '12:00', '12:30', 'PA');
  await t.malen(t.leitung, a, '2026-11-09', '12:30', '16:00', 'KA');
  await t.malen(t.leitung, b, '2026-11-09', '10:00', '14:00', 'OG');
  // Die Stellvertretung darf kopieren
  const r = await t.kopieren('2026-11-09', ['2026-11-16'], 'leere', t.stellv);
  assert.deepEqual(r, { tage: 1, bloecke: 4, ...LEER });
  assert.deepEqual(await t.zeile(a, '2026-11-16'), await t.zeile(a, '2026-11-09'));
  assert.deepEqual(await t.zeile(b, '2026-11-16'), [{ von: '10:00', bis: '14:00', k: 'OG' }]);
  assert.equal((await t.zeile(a, '2026-11-09')).length, 3); // Quelle unverändert
  // Die Quelle selbst fällt aus den Zielen, doppelte Ziele zählen einmal
  const r2 = await t.kopieren('2026-11-09', ['2026-11-09', '2026-11-16', '2026-11-16'], 'ersetzen');
  assert.deepEqual(r2, { tage: 1, bloecke: 4, ...LEER });
  assert.equal(await t.anzahl(), 8);
  await wirft(t.kopieren('2026-11-09', ['2026-11-16'], 'quatsch'), 'MODUS_UNGUELTIG');
  await wirft(t.kopieren('2026-11-09', ['2026-11-16'], null), 'MODUS_UNGUELTIG');
  await wirft(t.kopieren(null, ['2026-11-16']), 'DATUM_UNGUELTIG');
  await wirft(t.kopieren('2026-11-09', null), 'DATUM_UNGUELTIG');
});

test('Ziel mit U für einen Mitarbeiter → seine Blöcke eingefügt und unbesetzt; Bericht unbesetzt = Anzahl', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  const b = await t.ma('Test, Bert');
  const c = await t.ma('Test, Cora');
  await t.malen(t.leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, a, '2026-11-09', '13:00', '16:00', 'KA');
  await t.malen(t.leitung, b, '2026-11-09', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, c, '2026-11-09', '14:00', '18:00', 'KA');
  await t.abwesend(a, 'U', '2026-11-16');
  await t.abwesend(b, 'BS', '2026-11-16', 2, '08:00', '10:00'); // Teilabwesenheit: Block 08–12 halb unbesetzt
  const r = await t.kopieren('2026-11-09', ['2026-11-16']);
  assert.deepEqual(r, { tage: 1, bloecke: 4, ...LEER, unbesetzt: 3 });
  assert.deepEqual(await t.zeile(a, '2026-11-16'),
    [{ von: '08:00', bis: '12:00', k: 'KA' }, { von: '13:00', bis: '16:00', k: 'KA' }]);
  const w = await t.json(t.leitung, 'select public.pep_einsatzplan_woche(2026, 47) as r');
  const ab = (m) => w.bloecke.filter((x) => x.mitarbeiter_id === m && x.datum === '2026-11-16')
    .map(({ von, bis, unbesetzt }) => ({ von, bis, unbesetzt }));
  assert.deepEqual(ab(a), [{ von: '08:00', bis: '12:00', unbesetzt: true }, { von: '13:00', bis: '16:00', unbesetzt: true }]);
  assert.deepEqual(ab(b), [{ von: '08:00', bis: '10:00', unbesetzt: true }, { von: '10:00', bis: '12:00', unbesetzt: false }]);
  assert.deepEqual(ab(c), [{ von: '14:00', bis: '18:00', unbesetzt: false }]);
});

test('Heiligabend Do 24.12.2026 mit Abweichung Rahmen 06:00–14:30: Kopie von Do 10.12. kürzt bis 14:30, verwirft Blöcke ab 14:30, gekuerzt = Anzahl', async () => {
  const t = await aufbau();
  await t.aufruf(t.leitung, 'select public.pep_abweichung_speichern($1::date, $2::jsonb)', ['2026-12-24', JSON.stringify({
    art: 'heiligabend', geoeffnet: true, oeffnung_von: '07:00', oeffnung_bis: '14:00',
    rahmen_von: '06:00', rahmen_bis: '14:30', name: 'Heiligabend' })]);
  const a = await t.ma('Test, Anna');
  const b = await t.ma('Test, Bert');
  const c = await t.ma('Test, Cora');
  const d = await t.ma('Test, Dirk');
  await t.malen(t.leitung, a, '2026-12-10', '08:00', '12:00', 'KA'); // bleibt
  await t.malen(t.leitung, b, '2026-12-10', '12:00', '16:00', 'KA'); // gekürzt auf 12:00–14:30
  await t.malen(t.leitung, c, '2026-12-10', '14:30', '20:00', 'KA'); // ganz außerhalb: verworfen
  await t.malen(t.leitung, d, '2026-12-10', '06:00', '07:00', 'PA'); // bleibt
  await t.malen(t.leitung, d, '2026-12-10', '14:00', '21:30', 'KA'); // gekürzt auf 14:00–14:30
  const r = await t.kopieren('2026-12-10', ['2026-12-24']);
  assert.deepEqual(r, { tage: 1, bloecke: 4, ...LEER, gekuerzt: 3 });
  assert.deepEqual(await t.zeile(a, '2026-12-24'), [{ von: '08:00', bis: '12:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(b, '2026-12-24'), [{ von: '12:00', bis: '14:30', k: 'KA' }]);
  assert.deepEqual(await t.zeile(c, '2026-12-24'), []);
  assert.deepEqual(await t.zeile(d, '2026-12-24'), [{ von: '06:00', bis: '07:00', k: 'PA' }, { von: '14:00', bis: '14:30', k: 'KA' }]);
});

test('vergangenes Ziel und Sonntag → uebersprungen mit grund', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  await t.malen(t.leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  // Ein Block an einem vergangenen Tag (malen geht dort nicht mehr): ersetzen darf ihn nicht löschen
  await t.db.query(`insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
                    values ($1, $2, '2026-10-26', '09:00', '10:00', $3)`, [t.fil, a, t.bereich.KA]);
  const r = await t.kopieren('2026-11-09',
    ['2026-12-25', '2026-11-16', '2026-11-15', '2026-10-26', '2026-11-02'], 'ersetzen');
  assert.deepEqual(r, { tage: 2, bloecke: 2, ...LEER, uebersprungen: [
    { datum: '2026-10-26', grund: 'vergangen' },
    { datum: '2026-11-15', grund: 'geschlossen' },
    { datum: '2026-12-25', grund: 'geschlossen' }] }); // 1. Weihnachtstag
  assert.deepEqual(await t.zeile(a, '2026-10-26'), [{ von: '09:00', bis: '10:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(a, '2026-11-15'), []);
  assert.deepEqual(await t.zeile(a, '2026-11-02'), [{ von: '08:00', bis: '12:00', k: 'KA' }]); // heute geht
  // pruefen meldet übersprungene Tage ebenfalls, belegte nur unter den übrigen
  const p = await t.kopieren('2026-11-09', ['2026-10-26', '2026-11-16'], 'pruefen');
  assert.deepEqual(p, { belegt: ['2026-11-16'], uebersprungen: [{ datum: '2026-10-26', grund: 'vergangen' }] });
});

test('pruefen schreibt nichts und meldet belegte Ziele; leere füllt nur leere Zeilen; ersetzen löscht vorher', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  const b = await t.ma('Test, Bert');
  const c = await t.ma('Test, Cora', { kompetenzen: ['KA', 'OG'] });
  await t.malen(t.leitung, a, '2026-11-10', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, b, '2026-11-10', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, a, '2026-11-17', '14:00', '18:00', 'KA');
  await t.malen(t.leitung, c, '2026-11-17', '16:00', '18:00', 'OG');
  const vorher = { bloecke: await t.anzahl(), protokoll: await t.protokolle() };
  const p = await t.kopieren('2026-11-10', ['2026-11-17', '2026-11-24'], 'pruefen');
  assert.deepEqual(p, { belegt: ['2026-11-17'], uebersprungen: [] });
  assert.deepEqual({ bloecke: await t.anzahl(), protokoll: await t.protokolle() }, vorher);

  // leere: Anna hat am 17.11. schon Blöcke und bleibt unverändert, Bert kommt dazu; am 24.11. beide
  let r = await t.kopieren('2026-11-10', ['2026-11-17', '2026-11-24'], 'leere');
  assert.deepEqual(r, { tage: 2, bloecke: 3, ...LEER });
  assert.deepEqual(await t.zeile(a, '2026-11-17'), [{ von: '14:00', bis: '18:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(b, '2026-11-17'), [{ von: '08:00', bis: '12:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(c, '2026-11-17'), [{ von: '16:00', bis: '18:00', k: 'OG' }]);
  assert.deepEqual(await t.zeile(a, '2026-11-24'), [{ von: '08:00', bis: '12:00', k: 'KA' }]);

  // ersetzen: alle Blöcke des Zieltags weg, auch die von Mitarbeitern, die in der Quelle nicht vorkommen
  r = await t.kopieren('2026-11-10', ['2026-11-17'], 'ersetzen');
  assert.deepEqual(r, { tage: 1, bloecke: 2, ...LEER });
  assert.deepEqual(await t.zeile(a, '2026-11-17'), [{ von: '08:00', bis: '12:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(b, '2026-11-17'), [{ von: '08:00', bis: '12:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(c, '2026-11-17'), []);
});

test('Pflicht-Vorgabe am Ziel (Sa nicht verfügbar) → Block ausgelassen', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  const b = await t.ma('Test, Bert');
  const c = await t.ma('Test, Cora', { kompetenzen: ['KA', 'OG'] });
  await t.malen(t.leitung, a, '2026-11-14', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, b, '2026-11-14', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, c, '2026-11-14', '12:00', '14:00', 'KA');
  await t.malen(t.leitung, c, '2026-11-14', '14:00', '16:00', 'OG');
  // Erst nach dem Quelltag: Anna samstags nicht verfügbar, Cora verliert die Kassen-Kompetenz
  await t.vorgabe(a, { gueltig_von: '2026-11-16', pflicht: true, wochentag: 6, art: 'nicht_verfuegbar' });
  await t.aufruf(t.leitung, 'select public.pep_kompetenz_setzen($1, $2, false)', [c, t.bereich.KA]);
  const r = await t.kopieren('2026-11-14', ['2026-11-21']);
  assert.deepEqual(r, { tage: 1, bloecke: 2, ...LEER, ausgelassen: 2 });
  assert.deepEqual(await t.zeile(a, '2026-11-21'), []);
  assert.deepEqual(await t.zeile(b, '2026-11-21'), [{ von: '08:00', bis: '12:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(c, '2026-11-21'), [{ von: '14:00', bis: '16:00', k: 'OG' }]);

  // Stundengrenze zählt Block für Block: der erste passt, der zweite nicht mehr
  const d = await t.ma('Test, Dirk');
  await t.malen(t.leitung, d, '2026-11-13', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, d, '2026-11-13', '13:00', '16:00', 'KA');
  await t.vorgabe(d, { gueltig_von: '2026-11-16', pflicht: true, wochentag: 5, art: 'nicht_verfuegbar', max_stunden_tag: 5 });
  const r2 = await t.kopieren('2026-11-13', ['2026-11-20']);
  assert.deepEqual(r2, { tage: 1, bloecke: 1, ...LEER, ausgelassen: 1 });
  assert.deepEqual(await t.zeile(d, '2026-11-20'), [{ von: '08:00', bis: '12:00', k: 'KA' }]);
});

test('Woche KW 46 → KW 47 und KW 48 in einem Aufruf; 13 Ziel-KWs → ZU_VIELE_ZIELE; 61 Zieltage → ZU_VIELE_ZIELE', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  const b = await t.ma('Test, Bert');
  await t.malen(t.leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, a, '2026-11-11', '12:00', '16:00', 'KA');
  await t.malen(t.leitung, b, '2026-11-14', '07:00', '13:00', 'KA');
  const r = await t.wocheKopieren(2026, 46, [{ jahr: 2026, kw: 47 }, { jahr: 2026, kw: 48 }, { jahr: 2026, kw: 46 }]);
  // Mo–Sa je Ziel-KW (So geschlossen und in der Quelle leer: kein Eintrag), Quell-KW fällt aus den Zielen
  assert.deepEqual(r, { tage: 12, bloecke: 6, ...LEER });
  for (const [m, tag, erwartet] of [[a, '2026-11-16', '08:00'], [a, '2026-11-18', '12:00'], [b, '2026-11-21', '07:00'],
    [a, '2026-11-23', '08:00'], [a, '2026-11-25', '12:00'], [b, '2026-11-28', '07:00']]) {
    assert.equal((await t.zeile(m, tag))[0]?.von, erwartet, tag);
  }
  assert.equal(await t.anzahl(), 9);
  // KW 53/2026 über den Jahreswechsel (28.12.2026–03.01.2027)
  const r53 = await t.wocheKopieren(2026, 46, [{ jahr: 2026, kw: 53 }]);
  assert.equal(r53.tage, 5); // Fr 01.01.2027 Neujahr geschlossen
  assert.deepEqual(r53.uebersprungen, []); // Quelle Fr 13.11. leer: nichts verloren, kein Eintrag
  assert.deepEqual(await t.zeile(b, '2027-01-02'), [{ von: '07:00', bis: '13:00', k: 'KA' }]);

  const ziele13 = Array.from({ length: 13 }, (_, i) => ({ jahr: 2027, kw: i + 2 }));
  await wirft(t.wocheKopieren(2026, 46, ziele13), 'ZU_VIELE_ZIELE');
  await wirft(t.wocheKopieren(2026, 46, [{ jahr: 2026, kw: 54 }]), 'DATUM_UNGUELTIG');
  await wirft(t.wocheKopieren(2026, 46, [{ jahr: 2026 }]), 'DATUM_UNGUELTIG');
  await wirft(t.wocheKopieren(2026, 46, [{ jahr: 2026, kw: 'x' }]), 'DATUM_UNGUELTIG');
  await wirft(t.wocheKopieren(2026, 54, [{ jahr: 2026, kw: 47 }]), 'DATUM_UNGUELTIG');
  await wirft(t.wocheKopieren(2026, 46, [{ jahr: 2026, kw: 47 }], 'quatsch'), 'MODUS_UNGUELTIG');
  const tage = (n) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2027, 0, 4 + i)).toISOString().slice(0, 10));
  await wirft(t.kopieren('2026-11-09', tage(61)), 'ZU_VIELE_ZIELE');
  const r60 = await t.kopieren('2026-11-09', tage(60), 'pruefen'); // 60 Ziele sind erlaubt
  assert.deepEqual(r60.belegt, []);
});

test('Vorlage Woche speichern, Mitarbeiter danach inaktiv, Laden auf KW 48 → ausgeschieden = [Name], übrige Blöcke da', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  const b = await t.ma('Test, Bert');
  const c = await t.ma('Test, Cora');
  await t.malen(t.leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, a, '2026-11-10', '08:00', '12:00', 'KA');
  await t.malen(t.leitung, b, '2026-11-09', '10:00', '14:00', 'KA');
  await t.malen(t.leitung, b, '2026-11-14', '12:00', '16:00', 'KA');
  await t.malen(t.leitung, c, '2026-11-12', '12:00', '16:00', 'KA');
  const id = await t.speichern('  Standardwoche ', 'woche', '2026-11-11', t.stellv);
  const tagId = await t.speichern('Montag', 'tag', '2026-11-09');
  const liste = await t.vorlagen(t.stellv);
  assert.deepEqual(liste.map(({ id: i, name, art, bloecke }) => ({ id: i, name, art, bloecke })), [
    { id: tagId, name: 'Montag', art: 'tag', bloecke: 2 },
    { id, name: 'Standardwoche', art: 'woche', bloecke: 5 }]);
  assert.match(liste[0].angelegt_am, /^\d{4}-\d{2}-\d{2}/);
  const daten = (await t.db.query('select daten from pep.vorlagen where id = $1', [id])).rows[0].daten;
  assert.deepEqual(daten[0], { wochentag: 1, mitarbeiter_id: a, von: '08:00', bis: '12:00', bereich_id: t.bereich.KA });
  assert.equal((await t.db.query('select daten from pep.vorlagen where id = $1', [tagId])).rows[0].daten[0].wochentag, null);

  await t.json(t.leitung, 'select public.pep_mitarbeiter_speichern($1, $2::jsonb) as r', [a, '{"aktiv":false}']);
  await t.db.query('delete from pep.mitarbeiter where id = $1', [c]); // gelöscht (seine Blöcke gehen mit)
  const r = await t.laden(id, '2026-11-23');
  assert.deepEqual(r, { tage: 6, bloecke: 2, unbesetzt: 0, gekuerzt: 0, ausgelassen: 3,
    ausgeschieden: ['Test, Anna', 'gelöschter Mitarbeiter'], uebersprungen: [] });
  assert.deepEqual(await t.zeile(a, '2026-11-23'), []);
  assert.deepEqual(await t.zeile(b, '2026-11-23'), [{ von: '10:00', bis: '14:00', k: 'KA' }]);
  assert.deepEqual(await t.zeile(b, '2026-11-28'), [{ von: '12:00', bis: '16:00', k: 'KA' }]);
  // Tagesvorlage auf einen beliebigen Tag; pruefen meldet den belegten Tag
  assert.deepEqual(await t.laden(tagId, '2026-11-28', 'pruefen'), { belegt: ['2026-11-28'], uebersprungen: [] });
  const rt = await t.laden(tagId, '2026-12-01');
  assert.deepEqual(rt, { tage: 1, bloecke: 1, unbesetzt: 0, gekuerzt: 0, ausgelassen: 1,
    ausgeschieden: ['Test, Anna'], uebersprungen: [] });
  await wirft(t.laden(tagId, '2026-12-01', 'quatsch'), 'MODUS_UNGUELTIG');
});

test('Vorlage art woche auf einen Dienstag laden → DATUM_UNGUELTIG; leeren Tag speichern → VORLAGE_LEER; doppelter Name → VORLAGE_DOPPELT', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  await t.malen(t.leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  const id = await t.speichern('Woche A', 'woche', '2026-11-09');
  await wirft(t.laden(id, '2026-11-17'), 'DATUM_UNGUELTIG');
  await wirft(t.laden(id, null), 'DATUM_UNGUELTIG');
  await wirft(t.speichern('Leer', 'tag', '2026-11-10'), 'VORLAGE_LEER');
  await wirft(t.speichern('Leer', 'woche', '2026-11-18'), 'VORLAGE_LEER');
  await wirft(t.speichern('Woche A', 'tag', '2026-11-09'), 'VORLAGE_DOPPELT');
  await wirft(t.speichern(' Woche A  ', 'tag', '2026-11-09'), 'VORLAGE_DOPPELT');
  await wirft(t.speichern('   ', 'tag', '2026-11-09'), 'NAME_LEER');
  await wirft(t.speichern(null, 'tag', '2026-11-09'), 'NAME_LEER');
  await wirft(t.speichern('X'.repeat(201), 'tag', '2026-11-09'), 'TEXT_ZU_LANG');
  await wirft(t.speichern('Monat', 'monat', '2026-11-09'), 'ART_UNGUELTIG');
  await wirft(t.speichern('Ohne Datum', 'tag', null), 'DATUM_UNGUELTIG');
  assert.equal((await t.vorlagen()).length, 1);
});

test('fremde Vorlage laden oder löschen → VORLAGE_NICHT_GEFUNDEN; je Zieltag ein Protokolleintrag', async () => {
  const t = await aufbau();
  const a = await t.ma('Test, Anna');
  await t.malen(t.leitung, a, '2026-11-09', '08:00', '12:00', 'KA');
  const id = await t.speichern('Montag', 'tag', '2026-11-09');
  // Zweite Filiale
  const chef2 = await pepBenutzer(t.db, 'chef2');
  await filiale(t.db, chef2, { name: 'Netto Zweitfiliale', nummer: '9999' });
  await wirft(t.laden(id, '2026-11-16', 'leere', chef2), 'VORLAGE_NICHT_GEFUNDEN');
  await wirft(t.loeschen(id, chef2), 'VORLAGE_NICHT_GEFUNDEN');
  await wirft(t.loeschen(999999), 'VORLAGE_NICHT_GEFUNDEN');
  await wirft(t.laden(999999, '2026-11-16'), 'VORLAGE_NICHT_GEFUNDEN');
  assert.deepEqual(await t.vorlagen(chef2), []);
  assert.equal((await t.vorlagen()).length, 1);

  // Protokoll: je bearbeitetem Zieltag genau ein Eintrag der Aktion, übersprungene Tage und pruefen keinen
  const eintraege = async (aktion) => (await t.db.query(
    `select schluessel, nachher from pep.protokoll where aktion = $1 and tabelle = 'plan_bloecke' order by schluessel`,
    [aktion])).rows;
  await t.kopieren('2026-11-09', ['2026-11-16', '2026-11-23', '2026-11-15'], 'pruefen');
  assert.deepEqual(await eintraege('kopieren'), []);
  await t.kopieren('2026-11-09', ['2026-11-16', '2026-11-23', '2026-11-15']);
  const k = await eintraege('kopieren');
  assert.deepEqual(k.map((e) => e.schluessel), ['2026-11-16', '2026-11-23']);
  assert.equal(k[0].nachher.quelle, '2026-11-09');
  assert.equal(k[0].nachher.modus, 'leere');
  assert.equal(k[0].nachher.bloecke, 1);
  await t.laden(id, '2026-11-30');
  const v = await eintraege('vorlage_laden');
  assert.deepEqual(v.map((e) => e.schluessel), ['2026-11-30']);
  assert.equal(v[0].nachher.vorlage, 'Montag');
  // Dazu je geänderter Zeile ein Eintrag „setzen“ wie beim Malen
  const zeilen = (await t.db.query(
    `select schluessel from pep.protokoll where aktion = 'setzen' and tabelle = 'plan_bloecke' and schluessel like $1`,
    [`${a}:2026-11-%`])).rows.map((x) => x.schluessel).sort();
  assert.deepEqual(zeilen, [`${a}:2026-11-09`, `${a}:2026-11-16`, `${a}:2026-11-23`, `${a}:2026-11-30`]);

  // Löschen: eigene Vorlage weg, mit Protokoll
  await t.loeschen(id, t.stellv);
  assert.deepEqual(await t.vorlagen(), []);
  const n = async (aktion) => (await t.db.query(
    `select count(*)::int as n from pep.protokoll where aktion = $1 and tabelle = 'vorlagen'`, [aktion])).rows[0].n;
  assert.equal(await n('anlegen'), 1);
  assert.equal(await n('loeschen'), 1);
});

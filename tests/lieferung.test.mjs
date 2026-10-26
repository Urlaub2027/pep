// Lieferung & Bedarf, Task 1: Warengruppen, Wochenmuster (LKW-Zeit, Rollis), Startausstattung, Sicherung.
// Heute = Mo 02.11.2026.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, planGrundlage } from './helfer.mjs';

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);

async function aufbau() {
  const db = await neueDatenbank();
  const g = await planGrundlage(db);
  const { leitung, json } = g;
  const einst = () => json(leitung, 'select public.pep_einstellungen() as r');
  const gruppe = (id, d, nutzer = leitung) =>
    json(nutzer, 'select public.pep_warengruppe_speichern($1, $2::jsonb) as r', [id, JSON.stringify(d)]);
  const muster = (tag, d, nutzer = leitung) =>
    json(nutzer, 'select public.pep_liefer_muster_setzen($1, $2::jsonb) as r', [tag, JSON.stringify(d)]);
  const protokoll = async (aktion, tabelle) => (await db.query(
    'select count(*)::int as n from pep.protokoll where aktion = $1 and tabelle = $2', [aktion, tabelle])).rows[0].n;
  // Zweite Filiale mit Grundausstattung, für Fremdfiliale-Prüfungen.
  const fremd = async () => {
    const f = (await db.query(`insert into pep.filialen (name, nummer, bundesland) values ('Fremd', '9999', 'BY') returning id`)).rows[0].id;
    await db.query('select pep.grundausstattung($1)', [f]);
    return {
      bereich: (await db.query(`select id from pep.bereiche where filiale_id = $1 and kuerzel = 'KA'`, [f])).rows[0].id,
      gruppe: (await db.query('select id from pep.warengruppen where filiale_id = $1', [f])).rows[0].id,
    };
  };
  return { db, ...g, einst, gruppe, muster, protokoll, fremd };
}

test('grundausstattung: Trockensortiment → TS 45 min, LKW Mo–Sa 07:00, keine Rollis', async () => {
  const t = await aufbau();
  const e = await t.einst();
  assert.equal(e.warengruppen.length, 1);
  assert.equal(e.warengruppen[0].name, 'Trockensortiment');
  assert.equal(e.warengruppen[0].bereich_id, t.bereich.TS);
  assert.equal(e.warengruppen[0].minuten, 45);
  assert.equal(e.warengruppen[0].aktiv, true);
  assert.deepEqual(e.liefer_muster.lkw, { 1: '07:00', 2: '07:00', 3: '07:00', 4: '07:00', 5: '07:00', 6: '07:00' });
  assert.deepEqual(e.liefer_muster.rollis, []);
});

test('grundausstattung zweimal: nichts doppelt; umbenannte Gruppe kommt nicht zurück', async () => {
  const t = await aufbau();
  const id = (await t.einst()).warengruppen[0].id;
  await t.gruppe(id, { name: 'Trocken neu' });
  await t.db.query('select pep.grundausstattung(id) from pep.filialen');
  const w = (await t.einst()).warengruppen;
  assert.equal(w.length, 1);
  assert.equal(w[0].name, 'Trocken neu');
  assert.equal((await t.db.query('select count(*)::int as n from pep.liefer_muster where filiale_id = $1', [t.fil])).rows[0].n, 6);
});

test('warengruppe_speichern: anlegen, ändern, Fehler', async () => {
  const t = await aufbau();
  const id = await t.gruppe(null, { name: '  Getränke ', bereich_id: t.bereich.OG, minuten: 30 });
  let w = (await t.einst()).warengruppen.find((x) => x.id === id);
  assert.deepEqual([w.name, w.bereich_id, w.minuten, w.aktiv], ['Getränke', t.bereich.OG, 30, true]);
  assert.equal(await t.protokoll('anlegen', 'warengruppen'), 1);
  await t.gruppe(id, { minuten: 60, aktiv: false, position: 9 });
  w = (await t.einst()).warengruppen.find((x) => x.id === id);
  assert.deepEqual([w.name, w.minuten, w.aktiv, w.position], ['Getränke', 60, false, 9]);
  assert.equal(await t.protokoll('aendern', 'warengruppen'), 1);
  assert.equal((await t.einst()).warengruppen.at(-1).id, id); // sortiert nach position, id

  await wirft(t.gruppe(null, { name: ' ', bereich_id: t.bereich.OG, minuten: 30 }), 'NAME_LEER');
  await wirft(t.gruppe(null, { name: 'Getränke', bereich_id: t.bereich.OG, minuten: 30 }), 'WARENGRUPPE_DOPPELT');
  await wirft(t.gruppe(id, { name: 'Trockensortiment' }), 'WARENGRUPPE_DOPPELT');
  for (const b of [t.bereich.PA, t.bereich.VP, 999999, null]) {
    await wirft(t.gruppe(null, { name: 'X', bereich_id: b, minuten: 30 }), 'BEREICH_NICHT_GEFUNDEN');
  }
  for (const m of [0, 241, 2.5, '30']) {
    await wirft(t.gruppe(null, { name: 'X', bereich_id: t.bereich.OG, minuten: m }), 'WERT_UNGUELTIG');
  }
  await wirft(t.gruppe(null, { name: 'X', bereich_id: t.bereich.OG }), 'WERT_UNGUELTIG');
  await wirft(t.gruppe(999999, { name: 'X' }), 'WARENGRUPPE_NICHT_GEFUNDEN');
  const f = await t.fremd();
  await wirft(t.gruppe(null, { name: 'X', bereich_id: f.bereich, minuten: 30 }), 'BEREICH_NICHT_GEFUNDEN');
  await wirft(t.gruppe(f.gruppe, { name: 'Y' }), 'WARENGRUPPE_NICHT_GEFUNDEN');
});

test('muster_setzen: LKW und Rollis, 0/null löscht die Zeile, Fehler', async () => {
  const t = await aufbau();
  const g1 = (await t.einst()).warengruppen[0].id;
  const g2 = await t.gruppe(null, { name: 'Getränke', bereich_id: t.bereich.OG, minuten: 30 });
  await t.muster(1, { lkw: '08:30', rollis: { [g1]: 4, [g2]: 2 } });
  await t.muster(7, { lkw: '09:00' });
  let m = (await t.einst()).liefer_muster;
  assert.equal(m.lkw[1], '08:30');
  assert.equal(m.lkw[7], '09:00');
  assert.deepEqual(m.rollis.map((r) => [r.warengruppe_id, r.wochentag, r.rollis]).sort(),
    [[g1, 1, 4], [g2, 1, 2]].sort());
  assert.equal(await t.protokoll('aendern', 'liefer_muster'), 2);
  await t.muster(1, { rollis: { [g1]: 0, [g2]: null } });
  m = (await t.einst()).liefer_muster;
  assert.deepEqual(m.rollis, []);
  assert.equal(m.lkw[1], '08:30'); // LKW bleibt, wenn nicht genannt
  assert.ok((await t.protokoll('aendern', 'liefer_muster_rollis')) >= 1);
  await t.muster(7, { lkw: null }); // LKW null löscht die Musterzeile
  assert.equal((await t.einst()).liefer_muster.lkw[7], undefined);

  await wirft(t.muster(1, { lkw: '07:15' }), 'HALBE_STUNDE');
  await wirft(t.muster(1, { lkw: 'abc' }), 'WERT_UNGUELTIG');
  await wirft(t.muster(8, { lkw: '07:00' }), 'WERT_UNGUELTIG');
  await wirft(t.muster(0, { lkw: '07:00' }), 'WERT_UNGUELTIG');
  for (const r of [100, -1, 2.5, '3']) await wirft(t.muster(1, { rollis: { [g1]: r } }), 'WERT_UNGUELTIG');
  await wirft(t.muster(1, { rollis: { [g1]: 4, [g2]: 100 } }), 'WERT_UNGUELTIG');
  assert.deepEqual((await t.einst()).liefer_muster.rollis, []); // atomar: nichts geschrieben
  await wirft(t.muster(1, { rollis: { 999999: 1 } }), 'WARENGRUPPE_NICHT_GEFUNDEN');
  await wirft(t.muster(1, { rollis: { abc: 1 } }), 'WARENGRUPPE_NICHT_GEFUNDEN');
  const f = await t.fremd();
  await wirft(t.muster(1, { rollis: { [f.gruppe]: 1 } }), 'WARENGRUPPE_NICHT_GEFUNDEN');
});

test('Rechte: Stellvertretung darf Warengruppen und Muster nicht', async () => {
  const t = await aufbau();
  const g1 = (await t.einst()).warengruppen[0].id;
  await wirft(t.gruppe(null, { name: 'X', bereich_id: t.bereich.OG, minuten: 30 }, t.stellv), 'NUR_LEITUNG');
  await wirft(t.gruppe(g1, { name: 'X' }, t.stellv), 'NUR_LEITUNG');
  await wirft(t.muster(1, { lkw: '08:00' }, t.stellv), 'NUR_LEITUNG');
  await wirft(t.muster(1, { rollis: { [g1]: 3 } }, t.stellv), 'NUR_LEITUNG');
  const e = await t.json(t.stellv, 'select public.pep_einstellungen() as r'); // Lesen darf sie
  assert.equal(e.warengruppen.length, 1);
});

test('Sicherung enthält die fünf Tabellen', async () => {
  const t = await aufbau();
  const s = await t.json(t.leitung, 'select public.pep_sicherung() as r');
  for (const n of ['warengruppen', 'liefer_muster', 'liefer_muster_rollis', 'liefer_tag', 'liefer_tag_rollis']) {
    assert.ok(Array.isArray(s.tabellen[n]), n);
  }
  assert.equal(s.tabellen.warengruppen.length, 1);
  assert.equal(s.tabellen.liefer_muster.length, 6);
});

// IST-Erfassung (Stufe 2, G6/G7): Vorschlag aus dem Plan, Malen, Rückgängig, Bestätigen, Wochenansicht, Rechte.
// Stichtag heute = Mo 16.11.2026 (KW 47); vergangene Testwoche KW 46 = 09.–15.11.2026.
// Planblöcke für vergangene Tage entstehen mit heute = 02.11. (Plan-Malen lehnt vergangene Tage ab).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { neueDatenbank, als, pepBenutzer, filiale, planGrundlage, heuteSetzen } from './helfer.mjs';

const HEUTE = '2026-11-16';

// Aufbau einer Datenbank mit Leitung, Stellvertretung und Helfern; mehrere Tests teilen sich eine,
// Tests mit „alle Mitarbeiter“ bekommen eine eigene.
async function aufbau() {
  const db = await neueDatenbank();
  const g = await planGrundlage(db, { heute: HEUTE });
  const { leitung, bereich, code, json } = g;
  const plan = async (maId, datum, von, bis, k) => {
    await heuteSetzen(db, '2026-11-02');
    try {
      return await g.malen(leitung, maId, datum, von, bis, k);
    } finally {
      await heuteSetzen(db, HEUTE);
    }
  };
  const ist = (nutzer, maId, datum, von, bis, k, grund = null) =>
    json(nutzer, 'select public.pep_ist_malen($1, $2::date, $3::time, $4::time, $5, $6) as r',
      [maId, datum, von, bis, k === null ? null : bereich[k], grund]);
  const istSetzen = (nutzer, maId, datum, bloecke, grund = null) =>
    json(nutzer, 'select public.pep_ist_zeile_setzen($1, $2::date, $3::jsonb, $4) as r',
      [maId, datum, JSON.stringify(bloecke), grund]);
  const bestaetigen = (nutzer, datum, ids = null) =>
    json(nutzer, `select public.pep_ist_bestaetigen($1::date, ${ids === null ? 'null' : `array[${ids.join(',')}]`}::bigint[]) as r`,
      [datum]);
  const istWoche = (jahr, kw, nutzer = leitung) =>
    json(nutzer, 'select public.pep_ist_woche($1, $2) as r', [jahr, kw]);
  const abwesend = (maId, c, datum, stunden = null, von = null, bis = null) =>
    json(leitung, `select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, $4::numeric, $5::time, $6::time, null) as r`,
      [maId, code[c], datum, stunden, von, bis]);
  const gespeichert = async (maId, datum) => (await db.query(
    'select pep.ist_zeile_lesen($1, $2::date) as z', [maId, datum])).rows[0].z;
  const planZeile = async (maId, datum) => (await db.query(
    'select pep.zeile_lesen($1, $2::date) as z', [maId, datum])).rows[0].z;
  const bestaetigt = async (maId, datum) => (await db.query(
    'select count(*)::int as n from pep.ist_tage where mitarbeiter_id = $1 and datum = $2::date', [maId, datum])).rows[0].n === 1;
  return { db, ...g, plan, ist, istSetzen, bestaetigen, istWoche, abwesend, gespeichert, planZeile, bestaetigt };
}

const wirft = (versprechen, c) => assert.rejects(versprechen, (e) => e.message.includes(c), c);
// Segmente einer Antwort für einen Mitarbeiter (und optional einen Tag), ohne id/mitarbeiter_id.
const segmente = (antwort, maId, datum = null) => antwort.bloecke
  .filter((b) => b.mitarbeiter_id === maId && (datum === null || b.datum === datum))
  .map(({ datum: d, von, bis, bereich_id, unbesetzt, vorschlag }) => ({ datum: d, von, bis, bereich_id, unbesetzt, vorschlag }));

let t; // gemeinsame Datenbank
let chef2, fremdMa, fremdBereich, azubiNutzer;

before(async () => {
  t = await aufbau();
  chef2 = await pepBenutzer(t.db, 'chef2');
  await filiale(t.db, chef2, { name: 'Netto Zweitfiliale', nummer: '9999' });
  fremdMa = await t.json(chef2, `select public.pep_mitarbeiter_speichern(null, '{"name":"Fremd, Frieda"}') as r`);
  await als(t.db, 'authenticated', chef2, `select public.pep_vertrag_speichern($1, '{"vertragsart":"vollzeit","wochenstunden":37.5,"gueltig_ab":"2026-01-01"}')`, [fremdMa]);
  fremdBereich = (await t.json(chef2, 'select public.pep_bereiche() as r')).find((b) => b.kuerzel === 'KA').id;
  azubiNutzer = await pepBenutzer(t.db, 'azubi', 'mitarbeiter', (await t.db.query('select filiale_id from pep.benutzer where user_id = $1', [t.leitung])).rows[0].filiale_id);
});

test('Vorschlag = besetzter Plan: Plan KA 08–16 mit KM 12–16 → Vorschlag 08–12 (nicht gespeichert)', async () => {
  const { ma, plan, abwesend, istWoche, gespeichert, bereich, db } = t;
  const a = await ma('Test, Vera');
  await plan(a, '2026-11-09', '08:00', '16:00', 'KA');
  await abwesend(a, 'KM', '2026-11-09', 4, '12:00', '16:00');
  const v = (await db.query("select pep.ist_vorschlag($1, '2026-11-09') as v", [a])).rows[0].v;
  assert.deepEqual(v, [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA }]);
  const w = await istWoche(2026, 46);
  assert.deepEqual(segmente(w, a, '2026-11-09'),
    [{ datum: '2026-11-09', von: '08:00', bis: '12:00', bereich_id: bereich.KA, unbesetzt: false, vorschlag: true }]);
  assert.equal(w.bloecke.find((b) => b.mitarbeiter_id === a && b.datum === '2026-11-09').id, null);
  assert.deepEqual(await gespeichert(a, '2026-11-09'), []);
  // Plan-Segmente der Woche liegen daneben (mit dem unbesetzten Teil)
  assert.deepEqual(w.plan_bloecke.filter((b) => b.mitarbeiter_id === a).map(({ von, bis, unbesetzt }) => ({ von, bis, unbesetzt })),
    [{ von: '08:00', bis: '12:00', unbesetzt: false }, { von: '12:00', bis: '16:00', unbesetzt: true }]);
});

test('erster Strich auf offenem Tag startet vom Vorschlag; Plan bleibt unverändert', async () => {
  const { ma, plan, ist, gespeichert, planZeile, bereich, stellv } = t;
  const a = await ma('Test, Erik');
  await plan(a, '2026-11-10', '08:00', '16:00', 'KA');
  const r = await ist(stellv, a, '2026-11-10', '16:00', '17:00', 'KA');
  assert.equal(r.datum, '2026-11-10');
  assert.deepEqual(segmente(r, a), [{ datum: '2026-11-10', von: '08:00', bis: '17:00', bereich_id: bereich.KA, unbesetzt: false, vorschlag: false }]);
  assert.ok(r.bloecke[0].id > 0);
  assert.deepEqual(r.status, [{ mitarbeiter_id: a, datum: '2026-11-10', bestaetigt: false, bestaetigt_am: null }]);
  assert.deepEqual(await gespeichert(a, '2026-11-10'), [{ von: '08:00', bis: '17:00', bereich_id: bereich.KA }]);
  assert.deepEqual(await planZeile(a, '2026-11-10'), [{ von: '08:00', bis: '16:00', bereich_id: bereich.KA }]);
  // zweiter Strich arbeitet auf dem gespeicherten IST: Pause 12:00–12:30
  const r2 = await ist(stellv, a, '2026-11-10', '12:00', '12:30', 'PA');
  assert.deepEqual(segmente(r2, a).map((s) => `${s.von}-${s.bis}`), ['08:00-12:00', '12:00-12:30', '12:30-17:00']);
  // radieren
  const r3 = await ist(stellv, a, '2026-11-10', '16:00', '17:00', null);
  assert.deepEqual(segmente(r3, a).map((s) => `${s.von}-${s.bis}`), ['08:00-12:00', '12:00-12:30', '12:30-16:00']);
  assert.deepEqual(await planZeile(a, '2026-11-10'), [{ von: '08:00', bis: '16:00', bereich_id: bereich.KA }]);
});

test('Zeitrahmen 04:00–24:00: 05:00–06:00 erlaubt (außerhalb Rahmen), 03:30 → AUSSERHALB_ZEITRAHMEN, 22:00–24:00 erlaubt', async () => {
  const { ma, ist, istSetzen, leitung, gespeichert, bereich } = t;
  const a = await ma('Test, Frieder');
  let r = await ist(leitung, a, '2026-11-11', '05:00', '06:00', 'KA');
  assert.deepEqual(segmente(r, a).map((s) => `${s.von}-${s.bis}`), ['05:00-06:00']);
  await wirft(ist(leitung, a, '2026-11-11', '03:30', '05:00', 'KA'), 'AUSSERHALB_ZEITRAHMEN');
  await wirft(ist(leitung, a, '2026-11-11', '03:30', '05:00', null), 'AUSSERHALB_ZEITRAHMEN');
  await wirft(istSetzen(leitung, a, '2026-11-11', [{ von: '03:30', bis: '05:00', bereich_id: bereich.KA }]), 'AUSSERHALB_ZEITRAHMEN');
  r = await ist(leitung, a, '2026-11-11', '04:00', '05:00', 'KA');
  assert.deepEqual(segmente(r, a).map((s) => `${s.von}-${s.bis}`), ['04:00-06:00']);
  // bis Mitternacht: 22–23 und 23–24 verschmelzen, Ausgabe „24:00“
  await ist(leitung, a, '2026-11-11', '22:00', '23:00', 'KA');
  r = await ist(leitung, a, '2026-11-11', '23:00', '24:00', 'KA');
  assert.deepEqual(segmente(r, a).map((s) => `${s.von}-${s.bis}`), ['04:00-06:00', '22:00-24:00']);
  assert.deepEqual(await gespeichert(a, '2026-11-11'),
    [{ von: '04:00', bis: '06:00', bereich_id: bereich.KA }, { von: '22:00', bis: '24:00', bereich_id: bereich.KA }]);
  r = await ist(leitung, a, '2026-11-11', '23:30', '24:00', null);
  assert.deepEqual(segmente(r, a).map((s) => `${s.von}-${s.bis}`), ['04:00-06:00', '22:00-23:30']);
  const h = (await t.db.query("select pep.arbeitsstunden($1, '2026-11-11', pep.ist_zeile_lesen($1, '2026-11-11')) as h", [a])).rows[0].h;
  assert.equal(Number(h), 3.5);
  await wirft(ist(leitung, a, '2026-11-11', '08:15', '09:00', 'KA'), 'HALBE_STUNDE');
  await wirft(ist(leitung, a, '2026-11-11', '09:00', '08:00', 'KA'), 'ZEITEN_UNGUELTIG');
});

test('Datum: morgen → ZUKUNFT, heute erlaubt; Sonntag (geschlossen) erlaubt; Bestätigen morgen → ZUKUNFT', async () => {
  const { ma, ist, istSetzen, bestaetigen, leitung, bereich } = t;
  const a = await ma('Test, Gerd');
  await wirft(ist(leitung, a, '2026-11-17', '08:00', '12:00', 'KA'), 'ZUKUNFT');
  await wirft(ist(leitung, a, '2026-11-17', '08:00', '12:00', null), 'ZUKUNFT');
  await wirft(istSetzen(leitung, a, '2026-11-17', [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA }]), 'ZUKUNFT');
  await wirft(bestaetigen(leitung, '2026-11-17', [a]), 'ZUKUNFT');
  const r = await ist(leitung, a, HEUTE, '08:00', '12:00', 'KA');
  assert.equal(segmente(r, a).length, 1);
  // IST prüft weder Öffnung noch Rahmen: Inventur am Sonntag
  const s = await ist(leitung, a, '2026-11-15', '08:00', '12:00', 'KA');
  assert.equal(segmente(s, a).length, 1);
  assert.deepEqual(s.status, [{ mitarbeiter_id: a, datum: '2026-11-15', bestaetigt: false, bestaetigt_am: null }]);
});

test('Kompetenz fehlt → trotzdem erlaubt; VP → BEREICH_NICHT_MALBAR; inaktiver/fremder Bereich → BEREICH_NICHT_GEFUNDEN', async () => {
  const { ma, ist, leitung, json, bereich } = t;
  const a = await ma('Test, Hanna', { kompetenzen: [] });
  const r = await ist(leitung, a, '2026-11-12', '08:00', '12:00', 'KA');
  assert.deepEqual(segmente(r, a).map((s) => s.bereich_id), [bereich.KA]);
  await wirft(ist(leitung, a, '2026-11-12', '12:00', '13:00', 'VP'), 'BEREICH_NICHT_MALBAR');
  await wirft(ist(leitung, a, '2026-11-12', '12:00', '13:00', 'PO'), 'BEREICH_NICHT_GEFUNDEN'); // Post: inaktiv
  await wirft(json(leitung, 'select public.pep_ist_malen($1, $2::date, $3::time, $4::time, $5, null) as r',
    [a, '2026-11-12', '12:00', '13:00', fremdBereich]), 'BEREICH_NICHT_GEFUNDEN');
});

test('Abwesenheit: ganztägig U → ABWESEND; Teilabwesenheit sperrt nur ihr Fenster', async () => {
  const { ma, ist, abwesend, leitung } = t;
  const a = await ma('Test, Ines');
  await abwesend(a, 'U', '2026-11-12');
  await wirft(ist(leitung, a, '2026-11-12', '08:00', '12:00', 'KA'), 'ABWESEND');
  await abwesend(a, 'KM', '2026-11-13', 4, '12:00', '16:00');
  await wirft(ist(leitung, a, '2026-11-13', '11:00', '13:00', 'KA'), 'ABWESEND');
  const r = await ist(leitung, a, '2026-11-13', '08:00', '12:00', 'KA');
  assert.equal(segmente(r, a).length, 1);
  await ist(leitung, a, '2026-11-13', '16:00', '18:00', 'KA');
  // nicht sperrender Code (NV) sperrt nicht
  const nv = (await t.json(leitung, 'select public.pep_einstellungen() as r')).codes.find((c) => c.code === 'NV');
  if (!nv.sperrt) {
    await abwesend(a, 'NV', '2026-11-14');
    await ist(leitung, a, '2026-11-14', '08:00', '12:00', 'KA');
  }
});

test('nicht beschäftigt: vor Eintritt → MITARBEITER_INAKTIV, ohne Vertrag → KEIN_VERTRAG', async () => {
  const { ma, ist, leitung, json } = t;
  const a = await ma('Test, Jan', { ab: '2026-11-12' });
  await wirft(ist(leitung, a, '2026-11-10', '08:00', '12:00', 'KA'), 'KEIN_VERTRAG');
  await ist(leitung, a, '2026-11-12', '08:00', '12:00', 'KA');
  const b = await ma('Test, Jule');
  await json(leitung, 'select public.pep_mitarbeiter_speichern($1, $2::jsonb) as r',
    [b, JSON.stringify({ name: 'Test, Jule', eintritt: '2026-11-12' })]);
  await wirft(ist(leitung, b, '2026-11-10', '08:00', '12:00', 'KA'), 'MITARBEITER_INAKTIV');
});

test('bestätigter Tag: ohne Grund → GRUND_FEHLT, mit Grund erlaubt, Grund im Protokoll; Tag bleibt bestätigt', async () => {
  const { ma, ist, istSetzen, bestaetigen, leitung, db, bestaetigt, gespeichert, bereich } = t;
  const a = await ma('Test, Karla');
  await ist(leitung, a, '2026-11-12', '08:00', '16:00', 'KA');
  assert.deepEqual(await bestaetigen(leitung, '2026-11-12', [a]), { bestaetigt: 1 });
  assert.ok(await bestaetigt(a, '2026-11-12'));
  await wirft(ist(leitung, a, '2026-11-12', '16:00', '17:00', 'KA'), 'GRUND_FEHLT');
  await wirft(ist(leitung, a, '2026-11-12', '16:00', '17:00', 'KA', '   '), 'GRUND_FEHLT');
  await wirft(ist(leitung, a, '2026-11-12', '15:00', '16:00', null), 'GRUND_FEHLT');
  await wirft(istSetzen(leitung, a, '2026-11-12', []), 'GRUND_FEHLT');
  await wirft(ist(leitung, a, '2026-11-12', '16:00', '17:00', 'KA', 'x'.repeat(201)), 'TEXT_ZU_LANG');
  const r = await ist(leitung, a, '2026-11-12', '16:00', '17:00', 'KA', ' später gegangen ');
  assert.deepEqual(segmente(r, a).map((s) => `${s.von}-${s.bis}`), ['08:00-17:00']);
  assert.equal(r.status[0].bestaetigt, true);
  assert.ok(r.status[0].bestaetigt_am);
  const p = (await db.query(`select aktion, schluessel, vorher, nachher, grund from pep.protokoll
    where tabelle = 'ist_bloecke' order by id desc limit 1`)).rows[0];
  assert.equal(p.grund, 'später gegangen');
  assert.equal(p.schluessel, `${a}:2026-11-12`);
  assert.deepEqual(p.vorher, [{ von: '08:00', bis: '16:00', bereich_id: bereich.KA }]);
  assert.deepEqual(p.nachher, [{ von: '08:00', bis: '17:00', bereich_id: bereich.KA }]);
  // Rückgängig mit demselben Grund
  const u = await istSetzen(leitung, a, '2026-11-12', [{ von: '08:00', bis: '16:00', bereich_id: bereich.KA }], 'später gegangen');
  assert.deepEqual(segmente(u, a).map((s) => `${s.von}-${s.bis}`), ['08:00-16:00']);
  assert.deepEqual(await gespeichert(a, '2026-11-12'), [{ von: '08:00', bis: '16:00', bereich_id: bereich.KA }]);
  assert.ok(await bestaetigt(a, '2026-11-12'));
});

test('Grund steht während des Aufrufs in pep.grund (für das Nachbuchen), danach nicht mehr', async () => {
  const { ma, leitung, db, bereich } = t;
  const a = await ma('Test, Lars');
  const claims = JSON.stringify({ sub: leitung, role: 'authenticated' });
  let erg;
  try {
    erg = await db.exec(`begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '${claims}', true);
      select public.pep_ist_malen(${a}, '2026-11-12', '08:00', '12:00', ${bereich.KA}, 'Inventur');
      select current_setting('pep.grund', true) as g;
      commit;`);
  } catch (fehler) {
    await db.exec('rollback');
    throw fehler;
  }
  assert.equal(erg.at(-2).rows[0].g, 'Inventur');
  const danach = (await db.query("select coalesce(current_setting('pep.grund', true), '') as g")).rows[0].g;
  assert.equal(danach, '');
});

test('Rückgängig (pep_ist_zeile_setzen): ersetzt die Zeile, prüft Werte, Überlappung → UEBERLAPPUNG', async () => {
  const { ma, ist, istSetzen, leitung, stellv, gespeichert, bereich, db, fil } = t;
  const a = await ma('Test, Mia');
  await ist(leitung, a, '2026-11-13', '08:00', '12:00', 'KA');
  const r = await istSetzen(stellv, a, '2026-11-13', [{ von: '09:00', bis: '10:00', bereich_id: bereich.OG },
    { von: '10:00', bis: '11:00', bereich_id: bereich.OG }]);
  assert.deepEqual(segmente(r, a).map((s) => `${s.von}-${s.bis}`), ['09:00-11:00']);
  await wirft(istSetzen(leitung, a, '2026-11-13', [{ von: '09:00', bis: '11:00', bereich_id: bereich.OG },
    { von: '10:00', bis: '12:00', bereich_id: bereich.KA }]), 'UEBERLAPPUNG');
  await wirft(istSetzen(leitung, a, '2026-11-13', [{ von: '09:00', bis: '11:00', bereich_id: 1.5 }]), 'WERT_UNGUELTIG');
  await wirft(istSetzen(leitung, a, '2026-11-13', [{ von: 'neun', bis: '11:00', bereich_id: bereich.OG }]), 'WERT_UNGUELTIG');
  await wirft(t.json(leitung, `select public.pep_ist_zeile_setzen($1, '2026-11-13', '{}'::jsonb, null) as r`, [a]), 'WERT_UNGUELTIG');
  assert.deepEqual(await gespeichert(a, '2026-11-13'), [{ von: '09:00', bis: '11:00', bereich_id: bereich.OG }]);
  // eigener Überlappungs-Trigger auf pep.ist_bloecke (direkt geschrieben)
  await wirft(db.query(`insert into pep.ist_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
    values ($1, $2, '2026-11-13', '10:30', '12:00', $3)`, [fil, a, bereich.KA]), 'UEBERLAPPUNG');
  await db.query(`insert into pep.ist_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
    values ($1, $2, '2026-11-13', '11:00', '12:00', $3)`, [fil, a, bereich.KA]);
  // IST und Plan stören sich nicht: Planblock zur selben Zeit bleibt möglich
  await db.query(`insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
    values ($1, $2, '2026-11-13', '09:00', '12:00', $3)`, [fil, a, bereich.KA]);
});

test('leer radierte offene Zeile: Vorschlag kommt nicht zurück, Bestätigen schreibt keinen Plan', async () => {
  const { ma, plan, ist, istSetzen, istWoche, bestaetigen, leitung, gespeichert, bestaetigt, bereich } = t;
  const a = await ma('Test, Nora');
  await plan(a, '2026-11-14', '08:00', '12:00', 'KA');
  const r = await ist(leitung, a, '2026-11-14', '07:00', '13:00', null);
  assert.deepEqual(segmente(r, a), []);
  assert.deepEqual(r.status, [{ mitarbeiter_id: a, datum: '2026-11-14', bestaetigt: false, bestaetigt_am: null }]);
  assert.deepEqual(segmente(await istWoche(2026, 46), a, '2026-11-14'), []);
  assert.deepEqual(await bestaetigen(leitung, '2026-11-14', [a]), { bestaetigt: 1 });
  assert.deepEqual(await gespeichert(a, '2026-11-14'), []);
  assert.ok(await bestaetigt(a, '2026-11-14'));
  // Rückgängig vor dem Bestätigen bringt die gemerkte Zeile zurück (zweiter Mitarbeiter)
  const b = await ma('Test, Nils');
  await plan(b, '2026-11-14', '08:00', '12:00', 'KA');
  await istSetzen(leitung, b, '2026-11-14', []);
  assert.deepEqual(segmente(await istWoche(2026, 46), b, '2026-11-14'), []);
  const u = await istSetzen(leitung, b, '2026-11-14', [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA }]);
  assert.deepEqual(segmente(u, b).map((s) => `${s.von}-${s.bis}/${s.vorschlag}`), ['08:00-12:00/false']);
});

test('pep_ist_woche: Form wie pep_einsatzplan_woche plus modus/status/plan_bloecke; vorschlag nur an offenen Tagen ohne IST', async () => {
  const { ma, plan, ist, bestaetigen, istWoche, leitung, stellv, json, bereich } = t;
  const a = await ma('Test, Olga');
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11']) await plan(a, d, '08:00', '12:00', 'KA');
  await ist(leitung, a, '2026-11-10', '12:00', '13:00', 'KA');     // offen, mit IST
  await bestaetigen(leitung, '2026-11-11', [a]);                    // bestätigt aus Vorschlag
  await plan(a, '2026-11-17', '08:00', '12:00', 'KA');               // Zukunft (KW 47)
  const w = await istWoche(2026, 46, stellv);
  const p = await json(leitung, 'select public.pep_einsatzplan_woche(2026, 46) as r');
  for (const k of Object.keys(p)) assert.ok(k in w, `Schlüssel ${k}`);
  assert.equal(w.modus, 'ist');
  assert.deepEqual(w.pruefung, {});
  assert.ok(w.tage.every((d) => d.ist_erlaubt === true));
  assert.deepEqual(segmente(w, a).map((s) => `${s.datum} ${s.von}-${s.bis} ${s.vorschlag}`), [
    '2026-11-09 08:00-12:00 true',
    '2026-11-10 08:00-13:00 false',
    '2026-11-11 08:00-12:00 false']);
  const st = w.status.filter((s) => s.mitarbeiter_id === a);
  // Mo–Sa geöffnet und vergangen, Sonntag geschlossen ohne IST → kein Status
  assert.deepEqual(st.map((s) => `${s.datum} ${s.bestaetigt}`), ['2026-11-09 false', '2026-11-10 false',
    '2026-11-11 true', '2026-11-12 false', '2026-11-13 false', '2026-11-14 false']);
  assert.deepEqual(w.plan_bloecke.filter((b) => b.mitarbeiter_id === a).map((b) => b.datum),
    ['2026-11-09', '2026-11-10', '2026-11-11']);
  assert.ok(w.mitarbeiter.some((m) => m.id === a));
  assert.ok(w.bereiche.some((b) => b.id === bereich.PA));
  // KW 47: nur heute (Mo) ist erlaubt; Plan von morgen ist kein Vorschlag, Status nur für heute
  const w47 = await istWoche(2026, 47);
  assert.deepEqual(w47.tage.map((d) => d.ist_erlaubt), [true, false, false, false, false, false, false]);
  assert.deepEqual(segmente(w47, a), []);
  assert.deepEqual(w47.status.filter((s) => s.mitarbeiter_id === a).map((s) => s.datum), [HEUTE]);
  assert.equal(w47.plan_bloecke.filter((b) => b.mitarbeiter_id === a).length, 1);
});

test('fremde Filiale: Mitarbeiter → MITARBEITER_NICHT_GEFUNDEN; Woche der anderen Filiale zeigt nichts von hier', async () => {
  const { ist, istSetzen, bestaetigen, istWoche, leitung, json, ma } = t;
  await wirft(ist(leitung, fremdMa, '2026-11-12', '08:00', '12:00', 'KA'), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(istSetzen(leitung, fremdMa, '2026-11-12', []), 'MITARBEITER_NICHT_GEFUNDEN');
  await wirft(bestaetigen(leitung, '2026-11-12', [fremdMa]), 'MITARBEITER_NICHT_GEFUNDEN');
  const a = await ma('Test, Paula');
  await ist(leitung, a, '2026-11-12', '08:00', '12:00', 'KA');
  const w2 = await istWoche(2026, 46, chef2);
  assert.ok(!w2.bloecke.some((b) => b.mitarbeiter_id === a));
  assert.ok(!w2.status.some((s) => s.mitarbeiter_id === a));
  assert.ok(w2.status.some((s) => s.mitarbeiter_id === fremdMa));
  // die andere Leitung darf ihre eigenen malen
  const r = await json(chef2, 'select public.pep_ist_malen($1, $2::date, $3::time, $4::time, $5, null) as r',
    [fremdMa, '2026-11-12', '08:00', '12:00', fremdBereich]);
  assert.equal(r.bloecke.length, 1);
});

test('Rechte: Stellvertretung darf malen, setzen, bestätigen, lesen; Rolle mitarbeiter → NUR_LEITUNG', async () => {
  const { ma, ist, istSetzen, bestaetigen, istWoche, stellv } = t;
  const a = await ma('Test, Quirin');
  await ist(stellv, a, '2026-11-13', '08:00', '12:00', 'KA');
  await istSetzen(stellv, a, '2026-11-13', []);
  assert.deepEqual(await bestaetigen(stellv, '2026-11-13', [a]), { bestaetigt: 1 });
  await istWoche(2026, 46, stellv);
  await wirft(ist(azubiNutzer, a, '2026-11-13', '08:00', '12:00', 'KA', 'x'), 'NUR_LEITUNG');
  await wirft(istSetzen(azubiNutzer, a, '2026-11-13', [], 'x'), 'NUR_LEITUNG');
  await wirft(bestaetigen(azubiNutzer, '2026-11-13', [a]), 'NUR_LEITUNG');
  await wirft(istWoche(2026, 46, azubiNutzer), 'NUR_LEITUNG');
});

test('pep_ist_bestaetigen(Tag, null): alle offenen Beschäftigten aus dem Vorschlag, ganztägig Abwesende aus, zweiter Aufruf 0', async () => {
  const e = await aufbau();
  const { ma, plan, ist, bestaetigen, abwesend, leitung, json, gespeichert, planZeile, bestaetigt, bereich, istWoche } = e;
  const tag = '2026-11-11';
  const a = await ma('Test, Anton');   // Plan 08–16, kein IST → IST aus dem Vorschlag
  const b = await ma('Test, Berta');   // Plan 08–16, eigenes IST 09–17 → bleibt
  const c = await ma('Test, Cem');     // Plan, aber ganztägig Urlaub → nicht bestätigt
  const d = await ma('Test, Dora');    // ohne Plan → bestätigt mit leerem IST
  const k = await ma('Test, Kuno');    // Plan 08–16, KM 12–16 → IST 08–12
  const n = await ma('Test, Nele', { ab: '2026-11-12' }); // Vertrag erst ab Do → nicht beschäftigt
  const x = await ma('Test, Xaver');   // inaktiv
  await json(leitung, 'select public.pep_mitarbeiter_speichern($1, $2::jsonb) as r', [x, JSON.stringify({ name: 'Test, Xaver', aktiv: false })]);
  for (const m of [a, b, c, k]) await plan(m, tag, '08:00', '16:00', 'KA');
  await ist(leitung, b, tag, '09:00', '17:00', 'OG');
  await ist(leitung, b, tag, '08:00', '09:00', null);
  await abwesend(c, 'U', tag);
  await abwesend(k, 'KM', tag, 4, '12:00', '16:00');
  const planVorher = {};
  for (const m of [a, b, c, k]) planVorher[m] = await planZeile(m, tag);

  assert.deepEqual(await bestaetigen(leitung, tag), { bestaetigt: 4 });
  assert.deepEqual(await gespeichert(a, tag), [{ von: '08:00', bis: '16:00', bereich_id: bereich.KA }]);
  assert.deepEqual(await gespeichert(b, tag), [{ von: '09:00', bis: '17:00', bereich_id: bereich.OG }]);
  assert.deepEqual(await gespeichert(c, tag), []);
  assert.deepEqual(await gespeichert(d, tag), []);
  assert.deepEqual(await gespeichert(k, tag), [{ von: '08:00', bis: '12:00', bereich_id: bereich.KA }]);
  for (const m of [a, b, d, k]) assert.ok(await bestaetigt(m, tag), `bestätigt ${m}`);
  for (const m of [c, n, x]) assert.ok(!(await bestaetigt(m, tag)), `nicht bestätigt ${m}`);
  for (const m of [a, b, c, k]) assert.deepEqual(await planZeile(m, tag), planVorher[m], `Plan ${m}`);

  assert.deepEqual(await bestaetigen(leitung, tag), { bestaetigt: 0 });
  const w = await istWoche(2026, 46);
  assert.deepEqual(w.status.filter((s) => s.datum === tag).map((s) => [s.mitarbeiter_id, s.bestaetigt]),
    [[a, true], [b, true], [d, true], [k, true]]);
  assert.ok(!w.bloecke.some((s) => s.datum === tag && s.vorschlag));
  // leere Liste bestätigt nichts; Protokoll je bestätigter Zeile
  assert.deepEqual(await bestaetigen(leitung, '2026-11-12', []), { bestaetigt: 0 });
  const prot = (await e.db.query("select count(*)::int as n from pep.protokoll where tabelle = 'ist_tage'")).rows[0].n;
  assert.equal(prot, 4);
});

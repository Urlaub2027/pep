// Gemeinsamer Aufbau für alle Datenbanktests: PGlite mit nachgebildeten
// Supabase-Rollen, Standardrechten, auth.uid() und auth.users, dem
// eingefrorenen Urlaubstool-Schema und danach dem PEP-Schema (zweimal geladen).
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const SCHEMA = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
export const URLAUB_SCHEMA = readFileSync(new URL('./fixtures/urlaub-schema.sql', import.meta.url), 'utf8');

export async function neueDatenbank({ schema = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create schema auth;
    grant usage on schema auth to anon, authenticated, supabase_auth_admin;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null,
      raw_user_meta_data jsonb not null default '{}'
    );
    grant select, insert on auth.users to supabase_auth_admin;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
  `);
  await db.exec(URLAUB_SCHEMA); // das Urlaubstool ist in Produktion bereits installiert
  if (schema) {
    await db.exec(SCHEMA);
    await db.exec(SCHEMA); // erneutes Ausführen muss unschädlich sein
  }
  return db;
}

// Führt SQL als Rolle aus, wie PostgREST es mit einem JWT tut.
export async function als(db, rolle, nutzer, sql, params = []) {
  await db.exec(`set role ${rolle}`);
  await db.query("select set_config('request.jwt.claims', $1, false)",
    [nutzer ? JSON.stringify({ sub: nutzer, role: rolle }) : '']);
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

export const browser = (db, sql, params) => als(db, 'anon', null, sql, params);

export async function organisator(db, benutzername, { hauptadmin = false, gesperrt = false } = {}) {
  const r = await db.query(
    `insert into urlaub.organisatoren (user_id, anzeigename, benutzername, ist_hauptadmin, gesperrt)
     values (gen_random_uuid(), $1, $1, $2, $3) returning user_id`, [benutzername, hauptadmin, gesperrt]);
  return r.rows[0].user_id;
}

// Legt Organisator und pep.benutzer an. Leitung ohne Filiale geht wie in
// Produktion über pep.start_leitung (als Datenbank-Eigentümer).
export async function pepBenutzer(db, benutzername, rolle = 'leitung', filialeId = null) {
  const userId = await organisator(db, benutzername);
  if (rolle === 'leitung' && filialeId === null) {
    await db.query('select pep.start_leitung($1)', [benutzername]);
  } else {
    await db.query('insert into pep.benutzer (user_id, filiale_id, rolle) values ($1, $2, $3)',
      [userId, filialeId, rolle]);
  }
  return userId;
}

// Legt eine Filiale als dieser Benutzer an und liefert die filiale_id.
export async function filiale(db, userId, { name = 'Netto Aschaffenburg', nummer = '2558', bundesland = 'BY' } = {}) {
  const r = await als(db, 'authenticated', userId,
    'select public.pep_filiale_anlegen($1, $2, $3) as r', [name, nummer, bundesland]);
  return r[0].r.id;
}

// Fixiert pep.heute() für Tests (Datum "YYYY-MM-DD"); null hebt die Fixierung auf.
export async function heuteSetzen(db, datum) {
  await db.query("select set_config('pep.heute', $1, false)", [datum ?? '']);
}

// Legt eine Urlaubstool-Umfrage mit der Standard-Urlaubsfrage an (aus dem Urlaubstool übernommen).
export async function umfrageAnlegen(db, organisatorId,
  { titel = 'Urlaubswünsche 2027', jahr = 2027, bundesland = 'BY', frist = "now() + interval '1 day'" } = {}) {
  const r = await db.query(
    `insert into urlaub.umfragen (organisator_id, titel, frist) values ($1, $2, ${frist}) returning id`,
    [organisatorId, titel]);
  const id = r.rows[0].id;
  await db.query('select urlaub.standard_urlaubsfrage($1, $2, $3)', [id, jahr, bundesland]);
  return id;
}

export async function urlaubsfrageId(db, umfrageId) {
  const r = await db.query("select id from urlaub.fragen where umfrage_id = $1 and typ = 'urlaubswochen'", [umfrageId]);
  return r.rows[0].id;
}

// Teilnehmer einer Umfrage per Insert; liefert { id, code }.
export async function umfrageMitarbeiter(db, umfrageId, name) {
  const r = await db.query(
    'insert into urlaub.mitarbeiter (umfrage_id, name) values ($1, $2) returning id, code', [umfrageId, name]);
  return r.rows[0];
}

// Abgabe wie im Browser: antworten = { "<frage_id>": wert }.
export const abgeben = (db, code, antworten) =>
  browser(db, 'select public.umfrage_absenden($1, $2)', [code, JSON.stringify(antworten)]);

// Grundlage aller Einsatzplan-Tests: Leitung „chef“ mit Filiale, Stellvertretung „vize“,
// Stichtag heute (Standard Mo 02.11.2026, Testwoche KW 46 = 09.–15.11.2026).
// bereich und code bilden Kürzel → Id ab. ma() legt Mitarbeiter mit Vertrag und Kompetenzen an,
// malen() ruft pep_plan_malen (kuerzel null = radieren) und liefert die Tag-Antwort.
export async function planGrundlage(db, { heute = '2026-11-02' } = {}) {
  await heuteSetzen(db, heute);
  const leitung = await pepBenutzer(db, 'chef');
  const fil = await filiale(db, leitung);
  const stellv = await pepBenutzer(db, 'vize', 'stellvertretung', fil);
  const json = async (nutzer, sql, params = []) => (await als(db, 'authenticated', nutzer, sql, params))[0].r;
  const e = await json(leitung, 'select public.pep_einstellungen() as r');
  const bereich = Object.fromEntries(e.bereiche.map((b) => [b.kuerzel, b.id]));
  const code = Object.fromEntries(e.codes.map((c) => [c.code, c.id]));

  const ma = async (name, { stunden = 37.5, art = 'vollzeit', ab = '2026-01-01', geburtsdatum = null,
    kompetenzen = ['KA'] } = {}) => {
    const id = await json(leitung, 'select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r',
      [JSON.stringify({ name, geburtsdatum })]);
    await als(db, 'authenticated', leitung, 'select public.pep_vertrag_speichern($1, $2::jsonb)',
      [id, JSON.stringify({ vertragsart: art, wochenstunden: stunden, gueltig_ab: ab })]);
    for (const k of kompetenzen) {
      await als(db, 'authenticated', leitung, 'select public.pep_kompetenz_setzen($1, $2, true)', [id, bereich[k]]);
    }
    return id;
  };

  const malen = (nutzer, maId, datum, von, bis, kuerzel) =>
    json(nutzer, 'select public.pep_plan_malen($1, $2::date, $3::time, $4::time, $5) as r',
      [maId, datum, von, bis, kuerzel === null ? null : bereich[kuerzel]]);

  return { leitung, stellv, fil, bereich, code, json, ma, malen };
}

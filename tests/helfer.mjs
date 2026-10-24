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

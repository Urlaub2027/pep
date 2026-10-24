-- PEP – Personaleinsatzplanung – Datenbank (Stufe 0: Grundgerüst)
--
-- Einmal komplett im Supabase SQL-Editor ausführen, in derselben Datenbank, in
-- der das Urlaubstool (Schema "urlaub") bereits installiert ist. Erneutes
-- Ausführen ist unschädlich.
--
-- Die erste Leitung wird danach im SQL-Editor angelegt (der Organisator mit
-- diesem Benutzernamen muss im Urlaubstool existieren):
--   select pep.start_leitung('benutzername');
--
-- ACHTUNG bei späteren Änderungen: Ändern sich die Parameter einer Funktion,
-- legt "create or replace" eine ZWEITE Funktion an; die alte bleibt mitsamt
-- ihren Rechten aufrufbar. Dann vorher die alte Fassung ausdrücklich löschen:
--   drop function if exists public.<name>(<alte Parametertypen>);
--
-- Sicherheitsprinzip: Alle Tabellen liegen im Schema "pep"; darauf haben die
-- Rollen anon und authenticated keinen Zugriff, Row Level Security ist überall
-- aktiv und es gibt keine Policies. Der Browser ruft nur Funktionen in "public"
-- mit Präfix pep_ auf (security definer, angemeldet, Rechte über pep.ich()).
-- Funktionen im Schema "pep" sind intern.

begin;

create schema if not exists pep;
revoke all on schema pep from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists pep.filialen (
  id          bigint generated always as identity primary key,
  name        text not null check (btrim(name) <> ''),
  nummer      text,
  bundesland  text not null,
  angelegt_am timestamptz not null default now()
);

create table if not exists pep.benutzer (
  user_id     uuid primary key references urlaub.organisatoren (user_id) on delete cascade,
  filiale_id  bigint references pep.filialen (id) on delete set null,
  rolle       text not null check (rolle in ('leitung', 'stellvertretung', 'mitarbeiter')),
  angelegt_am timestamptz not null default now()
);

create table if not exists pep.protokoll (
  id         bigint generated always as identity primary key,
  filiale_id bigint,
  zeit       timestamptz not null default now(),
  user_id    uuid,
  aktion     text not null,
  tabelle    text not null,
  schluessel text,
  vorher     jsonb,
  nachher    jsonb
);

alter table pep.filialen  enable row level security;
alter table pep.benutzer  enable row level security;
alter table pep.protokoll enable row level security;

-- ---------------------------------------------------------------------------
-- Interne Funktionen (nicht aus dem Browser aufrufbar)
-- ---------------------------------------------------------------------------

-- „Heute“ in der Zeitzone des Marktes, nie current_date.
create or replace function pep.heute()
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Berlin')::date
$$;

-- Der angemeldete, nicht gesperrte Benutzer.
create or replace function pep.ich()
returns pep.benutzer
language plpgsql stable
set search_path = ''
as $$
declare
  v_b pep.benutzer;
begin
  select b.* into v_b
    from pep.benutzer b
    join urlaub.organisatoren o on o.user_id = b.user_id
   where b.user_id = auth.uid() and not o.gesperrt;
  if not found then
    raise exception 'KEIN_ZUGRIFF';
  end if;
  return v_b;
end;
$$;

create or replace function pep.leitung()
returns pep.benutzer
language plpgsql stable
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.ich();
begin
  if v_b.rolle <> 'leitung' then
    raise exception 'NUR_LEITUNG';
  end if;
  return v_b;
end;
$$;

create or replace function pep.meine_filiale()
returns bigint
language plpgsql stable
set search_path = ''
as $$
declare
  v_f bigint := (pep.ich()).filiale_id;
begin
  if v_f is null then
    raise exception 'KEINE_FILIALE';
  end if;
  return v_f;
end;
$$;

create or replace function pep.protokolliere(
  p_filiale_id bigint, p_aktion text, p_tabelle text, p_schluessel text,
  p_vorher jsonb, p_nachher jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into pep.protokoll (filiale_id, user_id, aktion, tabelle, schluessel, vorher, nachher)
  values (p_filiale_id, auth.uid(), p_aktion, p_tabelle, p_schluessel, p_vorher, p_nachher)
$$;

-- Legt die Grunddaten einer neuen Filiale an; spätere Tasks erweitern sie.
create or replace function pep.grundausstattung(p_filiale_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  null;
end;
$$;

-- Nur per SQL-Editor (Datenbank-Eigentümer): erste Leitung anlegen.
create or replace function pep.start_leitung(p_benutzername text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  select user_id into v_uid from urlaub.organisatoren where benutzername = p_benutzername;
  if not found then
    raise exception 'BENUTZER_NICHT_GEFUNDEN';
  end if;
  insert into pep.benutzer (user_id, filiale_id, rolle)
  values (v_uid, null, 'leitung')
  on conflict (user_id) do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Funktionen für den Browser
-- ---------------------------------------------------------------------------

create or replace function public.pep_ich()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.ich();
  v_o urlaub.organisatoren;
  v_f pep.filialen;
begin
  select * into v_o from urlaub.organisatoren where user_id = v_b.user_id;
  select * into v_f from pep.filialen where id = v_b.filiale_id;
  return jsonb_build_object(
    'anzeigename',  v_o.anzeigename,
    'benutzername', v_o.benutzername,
    'rolle',        v_b.rolle,
    'filiale',      case when v_f.id is null then null else jsonb_build_object(
                      'id', v_f.id, 'name', v_f.name, 'nummer', v_f.nummer, 'bundesland', v_f.bundesland) end);
end;
$$;

create or replace function public.pep_filiale_anlegen(p_name text, p_nummer text, p_bundesland text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung();
  v_name   text := urlaub.trim_alles(p_name);
  v_nummer text := nullif(urlaub.trim_alles(p_nummer), '');
  v_f      pep.filialen;
begin
  if v_b.filiale_id is not null then
    raise exception 'FILIALE_VORHANDEN';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'NAME_LEER';
  end if;
  if p_bundesland is null or p_bundesland not in
     ('BW','BY','BE','BB','HB','HH','HE','MV','NI','NW','RP','SL','SN','ST','SH','TH') then
    raise exception 'BUNDESLAND_UNGUELTIG';
  end if;

  insert into pep.filialen (name, nummer, bundesland)
  values (v_name, v_nummer, p_bundesland) returning * into v_f;
  update pep.benutzer set filiale_id = v_f.id where user_id = v_b.user_id;

  perform pep.grundausstattung(v_f.id);
  perform pep.protokolliere(v_f.id, 'anlegen', 'filialen', v_f.id::text, null, to_jsonb(v_f));

  return jsonb_build_object('id', v_f.id, 'name', v_f.name, 'nummer', v_f.nummer, 'bundesland', v_f.bundesland);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

revoke all on function public.pep_ich()                              from public, anon, authenticated;
revoke all on function public.pep_filiale_anlegen(text, text, text)  from public, anon, authenticated;
grant execute on function public.pep_ich()                              to authenticated;
grant execute on function public.pep_filiale_anlegen(text, text, text)  to authenticated;

commit;

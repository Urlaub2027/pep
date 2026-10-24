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
-- Stammdaten: Tabellen
-- ---------------------------------------------------------------------------

create table if not exists pep.mitarbeiter (
  id            bigint generated always as identity primary key,
  filiale_id    bigint not null references pep.filialen (id) on delete cascade,
  name          text not null check (btrim(name) <> ''),
  personalnummer text,
  geburtsdatum  date,
  aktiv         boolean not null default true,
  eintritt      date,
  austritt      date,
  notiz         text,
  position      int not null default 0,
  angelegt_am   timestamptz not null default now()
);
create index if not exists mitarbeiter_filiale_idx on pep.mitarbeiter (filiale_id);

create table if not exists pep.vertraege (
  id               bigint generated always as identity primary key,
  mitarbeiter_id   bigint not null references pep.mitarbeiter (id) on delete cascade,
  gueltig_ab       date not null,
  vertragsart      text not null check (vertragsart in ('vollzeit', 'teilzeit', 'minijob', 'azubi', 'fuehrung')),
  wochenstunden    numeric(5,2) not null check (wochenstunden > 0 and wochenstunden <= 60),
  zeitkonto_grenze numeric(5,2),
  unique (mitarbeiter_id, gueltig_ab)
);

create table if not exists pep.urlaubsjahre (
  mitarbeiter_id       bigint not null references pep.mitarbeiter (id) on delete cascade,
  jahr                 int not null,
  anspruch_stunden     numeric(6,2) not null,
  rest_vorjahr_stunden numeric(6,2) not null default 0,
  primary key (mitarbeiter_id, jahr)
);

create table if not exists pep.bereiche (
  id              bigint generated always as identity primary key,
  filiale_id      bigint not null references pep.filialen (id) on delete cascade,
  kuerzel         text not null check (btrim(kuerzel) <> ''),
  name            text not null check (btrim(name) <> ''),
  farbe           text not null check (farbe ~ '^#[0-9A-Fa-f]{6}$'),
  art             text not null default 'bereich' check (art in ('bereich', 'funktion', 'pause')),
  kompetenz_noetig boolean not null default false,
  aktiv           boolean not null default true,
  position        int not null default 0,
  unique (filiale_id, kuerzel)
);

create table if not exists pep.kompetenzen (
  mitarbeiter_id bigint not null references pep.mitarbeiter (id) on delete cascade,
  bereich_id     bigint not null references pep.bereiche (id) on delete cascade,
  primary key (mitarbeiter_id, bereich_id)
);

create table if not exists pep.wochenvorgaben (
  id                bigint generated always as identity primary key,
  mitarbeiter_id    bigint not null references pep.mitarbeiter (id) on delete cascade,
  gueltig_von       date not null,
  gueltig_bis       date,
  pflicht           boolean not null default false,
  wochentag         int check (wochentag between 1 and 7),
  art               text not null check (art in ('nicht_verfuegbar', 'nur_zwischen')),
  von               time check (von is null or extract(minute from von) in (0, 30)),
  bis               time check (bis is null or extract(minute from bis) in (0, 30)),
  max_stunden_tag   numeric(4,2),
  max_stunden_woche numeric(5,2),
  notiz             text,
  check (gueltig_bis is null or gueltig_bis >= gueltig_von)
);
create index if not exists wochenvorgaben_mitarbeiter_idx on pep.wochenvorgaben (mitarbeiter_id);

alter table pep.mitarbeiter     enable row level security;
alter table pep.vertraege       enable row level security;
alter table pep.urlaubsjahre    enable row level security;
alter table pep.bereiche        enable row level security;
alter table pep.kompetenzen     enable row level security;
alter table pep.wochenvorgaben  enable row level security;

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
  -- Nur bei einer Filiale ohne Bereiche: umbenannte oder gelöschte Bereiche kommen nicht zurück.
  if not exists (select 1 from pep.bereiche where filiale_id = p_filiale_id) then
    insert into pep.bereiche (filiale_id, kuerzel, name, farbe, art, kompetenz_noetig, aktiv, position)
    values
      (p_filiale_id, 'KA', 'Kasse',         '#7FD1FF', 'bereich',  true,  true,  1),
      (p_filiale_id, 'OG', 'Obst',          '#9BE38A', 'bereich',  false, true,  2),
      (p_filiale_id, 'BB', 'Backen',        '#F3C96B', 'bereich',  false, true,  3),
      (p_filiale_id, 'TS', 'TroSo',         '#D9B38C', 'bereich',  false, true,  4),
      (p_filiale_id, 'MO', 'MoPro',         '#F5F5F5', 'bereich',  false, true,  5),
      (p_filiale_id, 'TK', 'TK',            '#B8C4FF', 'bereich',  false, true,  6),
      (p_filiale_id, 'FÜ', 'Führung',       '#2E7D4F', 'bereich',  false, true,  7),
      (p_filiale_id, 'RE', 'Reinigung',     '#C9C9C9', 'bereich',  false, true,  8),
      (p_filiale_id, 'BO', 'Backoffice',    '#AEE0D6', 'bereich',  false, true,  9),
      (p_filiale_id, 'PA', 'Pause',         '#555555', 'pause',    false, true,  10),
      (p_filiale_id, 'PO', 'Post',          '#E6E600', 'bereich',  false, false, 11),
      (p_filiale_id, 'KI', 'Kiosk',         '#FF8C42', 'bereich',  false, false, 12),
      (p_filiale_id, 'GM', 'Getränkemarkt', '#333333', 'bereich',  false, false, 13),
      (p_filiale_id, 'BE', 'Bedienbäckerei','#B5651D', 'bereich',  false, false, 14),
      (p_filiale_id, 'VP', 'VP',            '#9A5AD0', 'funktion', false, true,  15)
    on conflict (filiale_id, kuerzel) do nothing;
  end if;

  -- Planungsrahmen: Mo–Sa 07:00–20:00 (Rahmen 06:00–21:30), Sonntag geschlossen.
  insert into pep.rahmen (filiale_id, wochentag, geoeffnet, oeffnung_von, oeffnung_bis, rahmen_von, rahmen_bis)
  select p_filiale_id, t, t <= 6,
         case when t <= 6 then time '07:00' end, case when t <= 6 then time '20:00' end,
         case when t <= 6 then time '06:00' end, case when t <= 6 then time '21:30' end
    from generate_series(1, 7) t
  on conflict (filiale_id, wochentag) do nothing;

  -- Nur bei einer Filiale ohne Codes (siehe Bereiche).
  if not exists (select 1 from pep.abwesenheitscodes where filiale_id = p_filiale_id) then
    insert into pep.abwesenheitscodes (filiale_id, code, name, farbe, stundenregel, position)
    values
      (p_filiale_id, 'U',  'Urlaub',                  '#4CAF50', 'teiler',       1),
      (p_filiale_id, 'KM', 'Krank',                   '#E53935', 'teiler',       2),
      (p_filiale_id, 'BS', 'Berufsschule',            '#1E88E5', 'tatsaechlich', 3),
      (p_filiale_id, 'ZA', 'Zeitausgleich',           '#F9A825', 'teiler',       4),
      (p_filiale_id, 'AF', 'Andere Filiale',          '#1565C0', 'tatsaechlich', 5),
      (p_filiale_id, 'BV', 'Berufliche Veranstaltung','#3949AB', 'teiler',       6),
      (p_filiale_id, 'FT', 'Feiertag',                '#8E24AA', 'teiler',       7),
      (p_filiale_id, 'NV', 'Nicht verfügbar',         '#80CBC4', 'keine',        8),
      (p_filiale_id, 'T',  'Termin/Schulung',         '#5C6BC0', 'tatsaechlich', 9)
    on conflict (filiale_id, code) do nothing;
  end if;

  insert into pep.einstellungen (filiale_id, schluessel, wert)
  values
    (p_filiale_id, 'abwesenheit_teiler',         '6'),
    (p_filiale_id, 'feiertag_teiler',            '6'),
    (p_filiale_id, 'pause_ab_6h_min',            '30'),
    (p_filiale_id, 'pause_ab_9h_min',            '45'),
    (p_filiale_id, 'ruhezeit_h',                 '11'),
    (p_filiale_id, 'ruhezeit_u18_h',             '12'),
    (p_filiale_id, 'max_tag_h',                  '10'),
    (p_filiale_id, 'max_tag_u18_h',              '8'),
    (p_filiale_id, 'max_woche_u18_h',            '40'),
    (p_filiale_id, 'spaet_grenze',               '"18:00"'),
    (p_filiale_id, 'u18_fruehestens',            '"06:00"'),
    (p_filiale_id, 'u18_spaetestens',            '"20:00"'),
    (p_filiale_id, 'freie_samstage_monat',       '1'),
    (p_filiale_id, 'freie_samstage_jahr',        '12'),
    (p_filiale_id, 'wochen_toleranz_h',          '0'),
    (p_filiale_id, 'zeitkonto_warnfaktor',       '1'),
    (p_filiale_id, 'stundenleistung_eur_h',      '200'),
    (p_filiale_id, 'kassierleistung_eur_halbe_h','900')
  on conflict (filiale_id, schluessel) do nothing;
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
-- Stammdaten: interne Funktionen
-- ---------------------------------------------------------------------------

-- Mitarbeiter der eigenen Filiale, sonst MITARBEITER_NICHT_GEFUNDEN.
create or replace function pep.eigener_mitarbeiter(p_id bigint)
returns pep.mitarbeiter
language plpgsql stable
set search_path = ''
as $$
declare
  v_m pep.mitarbeiter;
begin
  select * into v_m from pep.mitarbeiter
   where id = p_id and filiale_id = pep.meine_filiale();
  if not found then
    raise exception 'MITARBEITER_NICHT_GEFUNDEN';
  end if;
  return v_m;
end;
$$;

-- Jüngster Vertrag mit gueltig_ab <= p_datum.
create or replace function pep.vertrag_am(p_mitarbeiter_id bigint, p_datum date)
returns pep.vertraege
language plpgsql stable
set search_path = ''
as $$
declare
  v_v pep.vertraege;
begin
  select * into v_v from pep.vertraege
   where mitarbeiter_id = p_mitarbeiter_id and gueltig_ab <= p_datum
   order by gueltig_ab desc limit 1;
  if not found then
    raise exception 'KEIN_VERTRAG';
  end if;
  return v_v;
end;
$$;

-- Alter in vollen Jahren am Stichtag; null ohne Geburtsdatum.
create or replace function pep.alter_am(p_mitarbeiter_id bigint, p_datum date)
returns int
language sql stable
set search_path = ''
as $$
  select date_part('year', age(p_datum, geburtsdatum))::int
    from pep.mitarbeiter where id = p_mitarbeiter_id
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
-- Stammdaten: Funktionen für den Browser
-- ---------------------------------------------------------------------------

-- Lesen: Leitung und Stellvertretung.
create or replace function public.pep_bereiche()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_f bigint;
begin
  perform pep.ich();
  v_f := pep.meine_filiale();
  return coalesce((select jsonb_agg(to_jsonb(b) order by b.position, b.id)
                     from pep.bereiche b where b.filiale_id = v_f), '[]'::jsonb);
end;
$$;

create or replace function public.pep_mitarbeiter_liste()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_f bigint;
begin
  perform pep.ich();
  v_f := pep.meine_filiale();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', m.id,
             'name', m.name,
             'personalnummer', m.personalnummer,
             'aktiv', m.aktiv,
             'vertragsart', v.vertragsart,
             'wochenstunden', v.wochenstunden,
             'kompetenzen', coalesce((
                select jsonb_agg(b.kuerzel order by b.position, b.id)
                  from pep.kompetenzen k
                  join pep.bereiche b on b.id = k.bereich_id
                 where k.mitarbeiter_id = m.id), '[]'::jsonb))
           order by m.aktiv desc, m.position, m.name, m.id)
      from pep.mitarbeiter m
      left join lateral (
        select x.vertragsart, x.wochenstunden from pep.vertraege x
         where x.mitarbeiter_id = m.id and x.gueltig_ab <= pep.heute()
         order by x.gueltig_ab desc limit 1) v on true
     where m.filiale_id = v_f), '[]'::jsonb);
end;
$$;

create or replace function public.pep_mitarbeiter(p_id bigint)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_m pep.mitarbeiter;
begin
  perform pep.ich();
  v_m := pep.eigener_mitarbeiter(p_id);
  return to_jsonb(v_m) || jsonb_build_object(
    'vertraege', coalesce((select jsonb_agg(to_jsonb(v) order by v.gueltig_ab desc)
                             from pep.vertraege v where v.mitarbeiter_id = v_m.id), '[]'::jsonb),
    'kompetenzen', coalesce((select jsonb_agg(k.bereich_id order by k.bereich_id)
                               from pep.kompetenzen k where k.mitarbeiter_id = v_m.id), '[]'::jsonb),
    'wochenvorgaben', coalesce((select jsonb_agg(to_jsonb(w) order by w.gueltig_von, w.id)
                                  from pep.wochenvorgaben w where w.mitarbeiter_id = v_m.id), '[]'::jsonb),
    'urlaubsjahre', coalesce((select jsonb_agg(to_jsonb(u) order by u.jahr)
                                from pep.urlaubsjahre u where u.mitarbeiter_id = v_m.id), '[]'::jsonb));
end;
$$;

-- Schreiben: nur Leitung. p_id null = anlegen. Fehlende Schlüssel in p_daten
-- lassen beim Ändern den bisherigen Wert stehen.
create or replace function public.pep_mitarbeiter_speichern(p_id bigint, p_daten jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung();
  v_alt  pep.mitarbeiter;
  v_neu  pep.mitarbeiter;
  v_name text;
begin
  if p_id is not null then
    v_alt := pep.eigener_mitarbeiter(p_id);
  end if;

  -- trim_alles kürzt nur die Ränder; Tabs und Mehrfach-Leerzeichen im Namen werden zu einem Leerzeichen.
  v_name := case when p_daten ? 'name'
                 then regexp_replace(urlaub.trim_alles(p_daten ->> 'name'), '\s+', ' ', 'g')
                 else v_alt.name end;
  if v_name is null or v_name = '' then
    raise exception 'NAME_LEER';
  end if;

  if p_id is null then
    insert into pep.mitarbeiter (filiale_id, name, personalnummer, geburtsdatum, aktiv, eintritt, austritt, notiz, position)
    values (
      v_b.filiale_id,
      v_name,
      nullif(urlaub.trim_alles(p_daten ->> 'personalnummer'), ''),
      nullif(p_daten ->> 'geburtsdatum', '')::date,
      coalesce((p_daten ->> 'aktiv')::boolean, true),
      nullif(p_daten ->> 'eintritt', '')::date,
      nullif(p_daten ->> 'austritt', '')::date,
      p_daten ->> 'notiz',
      coalesce((p_daten ->> 'position')::int,
               (select coalesce(max(position), 0) + 1 from pep.mitarbeiter where filiale_id = v_b.filiale_id)))
    returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'mitarbeiter', v_neu.id::text, null, to_jsonb(v_neu));
  else
    update pep.mitarbeiter set
      name           = v_name,
      personalnummer = case when p_daten ? 'personalnummer'
                            then nullif(urlaub.trim_alles(p_daten ->> 'personalnummer'), '') else personalnummer end,
      geburtsdatum   = case when p_daten ? 'geburtsdatum' then nullif(p_daten ->> 'geburtsdatum', '')::date else geburtsdatum end,
      aktiv          = case when p_daten ? 'aktiv' then coalesce((p_daten ->> 'aktiv')::boolean, aktiv) else aktiv end,
      eintritt       = case when p_daten ? 'eintritt' then nullif(p_daten ->> 'eintritt', '')::date else eintritt end,
      austritt       = case when p_daten ? 'austritt' then nullif(p_daten ->> 'austritt', '')::date else austritt end,
      notiz          = case when p_daten ? 'notiz' then p_daten ->> 'notiz' else notiz end,
      position       = case when p_daten ? 'position' then coalesce((p_daten ->> 'position')::int, position) else position end
     where id = p_id
    returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'aendern', 'mitarbeiter', v_neu.id::text, to_jsonb(v_alt), to_jsonb(v_neu));
  end if;
  return v_neu.id;
end;
$$;

create or replace function public.pep_vertrag_speichern(p_mitarbeiter_id bigint, p_daten jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung();
  v_m      pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_id     bigint := (p_daten ->> 'id')::bigint;
  v_art    text := p_daten ->> 'vertragsart';
  v_std    numeric := (p_daten ->> 'wochenstunden')::numeric;
  v_ab     date := (p_daten ->> 'gueltig_ab')::date;
  v_grenze numeric;
  v_alt    pep.vertraege;
  v_neu    pep.vertraege;
begin
  if v_art is null or v_art not in ('vollzeit', 'teilzeit', 'minijob', 'azubi', 'fuehrung') then
    raise exception 'VERTRAGSART_UNGUELTIG';
  end if;
  if v_std is null or v_std <= 0 or v_std > 60 then
    raise exception 'STUNDEN_UNGUELTIG';
  end if;
  if v_ab is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  v_grenze := case when p_daten ? 'zeitkonto_grenze' and p_daten ->> 'zeitkonto_grenze' is not null
                   then (p_daten ->> 'zeitkonto_grenze')::numeric
                   when v_art = 'fuehrung' then 42
                   else null end;

  if v_id is not null then
    select * into v_alt from pep.vertraege where id = v_id and mitarbeiter_id = v_m.id;
    if not found then
      raise exception 'VERTRAG_NICHT_GEFUNDEN';
    end if;
  end if;
  if exists (select 1 from pep.vertraege
              where mitarbeiter_id = v_m.id and gueltig_ab = v_ab and id is distinct from v_id) then
    raise exception 'VERTRAG_DOPPELT';
  end if;

  if v_id is null then
    insert into pep.vertraege (mitarbeiter_id, gueltig_ab, vertragsart, wochenstunden, zeitkonto_grenze)
    values (v_m.id, v_ab, v_art, v_std, v_grenze) returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'vertraege', v_neu.id::text, null, to_jsonb(v_neu));
  else
    update pep.vertraege
       set gueltig_ab = v_ab, vertragsart = v_art, wochenstunden = v_std, zeitkonto_grenze = v_grenze
     where id = v_id returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'aendern', 'vertraege', v_neu.id::text, to_jsonb(v_alt), to_jsonb(v_neu));
  end if;
  return v_neu.id;
end;
$$;

create or replace function public.pep_vertrag_loeschen(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung();
  v_alt pep.vertraege;
begin
  select v.* into v_alt
    from pep.vertraege v
    join pep.mitarbeiter m on m.id = v.mitarbeiter_id
   where v.id = p_id and m.filiale_id = v_b.filiale_id;
  if not found then
    raise exception 'VERTRAG_NICHT_GEFUNDEN';
  end if;
  if (select count(*) from pep.vertraege where mitarbeiter_id = v_alt.mitarbeiter_id) <= 1 then
    raise exception 'LETZTER_VERTRAG';
  end if;
  delete from pep.vertraege where id = p_id;
  perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'vertraege', p_id::text, to_jsonb(v_alt), null);
end;
$$;

-- p_aktiv true: Kompetenz setzen (schon gesetzt = nichts zu tun); false: entfernen.
create or replace function public.pep_kompetenz_setzen(p_mitarbeiter_id bigint, p_bereich_id bigint, p_aktiv boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung();
  v_m      pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_zeilen int;
  v_schl   text := p_mitarbeiter_id || ':' || p_bereich_id;
begin
  if not exists (select 1 from pep.bereiche
                  where id = p_bereich_id and filiale_id = v_b.filiale_id and art in ('bereich', 'funktion')) then
    raise exception 'BEREICH_NICHT_GEFUNDEN';
  end if;

  if p_aktiv then
    insert into pep.kompetenzen (mitarbeiter_id, bereich_id) values (v_m.id, p_bereich_id)
    on conflict do nothing;
    get diagnostics v_zeilen = row_count;
    if v_zeilen > 0 then
      perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'kompetenzen', v_schl, null,
        jsonb_build_object('mitarbeiter_id', v_m.id, 'bereich_id', p_bereich_id));
    end if;
  else
    delete from pep.kompetenzen where mitarbeiter_id = v_m.id and bereich_id = p_bereich_id;
    get diagnostics v_zeilen = row_count;
    if v_zeilen > 0 then
      perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'kompetenzen', v_schl,
        jsonb_build_object('mitarbeiter_id', v_m.id, 'bereich_id', p_bereich_id), null);
    end if;
  end if;
end;
$$;

create or replace function public.pep_wochenvorgabe_speichern(p_mitarbeiter_id bigint, p_daten jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung();
  v_m    pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_id   bigint := (p_daten ->> 'id')::bigint;
  v_von  time := (p_daten ->> 'von')::time;
  v_bis  time := (p_daten ->> 'bis')::time;
  v_art  text := p_daten ->> 'art';
  v_ab   date := (p_daten ->> 'gueltig_von')::date;
  v_bisd date := (p_daten ->> 'gueltig_bis')::date;
  v_tag  int  := (p_daten ->> 'wochentag')::int;
  v_alt  pep.wochenvorgaben;
  v_neu  pep.wochenvorgaben;
begin
  if v_art is null or v_art not in ('nicht_verfuegbar', 'nur_zwischen') then
    raise exception 'ART_UNGUELTIG';
  end if;
  if v_ab is null or (v_bisd is not null and v_bisd < v_ab) or (v_tag is not null and v_tag not between 1 and 7) then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if extract(minute from v_von) not in (0, 30) or extract(minute from v_bis) not in (0, 30) then
    raise exception 'HALBE_STUNDE';
  end if;
  if v_art = 'nur_zwischen' and (v_von is null or v_bis is null or v_von >= v_bis) then
    raise exception 'ZEITEN_UNGUELTIG';
  end if;

  if v_id is not null then
    select * into v_alt from pep.wochenvorgaben where id = v_id and mitarbeiter_id = v_m.id;
    if not found then
      raise exception 'WOCHENVORGABE_NICHT_GEFUNDEN';
    end if;
    update pep.wochenvorgaben set
      gueltig_von = v_ab, gueltig_bis = v_bisd,
      pflicht = coalesce((p_daten ->> 'pflicht')::boolean, false),
      wochentag = v_tag, art = v_art, von = v_von, bis = v_bis,
      max_stunden_tag = (p_daten ->> 'max_stunden_tag')::numeric,
      max_stunden_woche = (p_daten ->> 'max_stunden_woche')::numeric,
      notiz = p_daten ->> 'notiz'
     where id = v_id returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'aendern', 'wochenvorgaben', v_neu.id::text, to_jsonb(v_alt), to_jsonb(v_neu));
  else
    insert into pep.wochenvorgaben (mitarbeiter_id, gueltig_von, gueltig_bis, pflicht, wochentag, art, von, bis,
                                    max_stunden_tag, max_stunden_woche, notiz)
    values (v_m.id, v_ab, v_bisd, coalesce((p_daten ->> 'pflicht')::boolean, false), v_tag, v_art, v_von, v_bis,
            (p_daten ->> 'max_stunden_tag')::numeric, (p_daten ->> 'max_stunden_woche')::numeric, p_daten ->> 'notiz')
    returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'wochenvorgaben', v_neu.id::text, null, to_jsonb(v_neu));
  end if;
  return v_neu.id;
end;
$$;

create or replace function public.pep_wochenvorgabe_loeschen(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung();
  v_alt pep.wochenvorgaben;
begin
  select w.* into v_alt
    from pep.wochenvorgaben w
    join pep.mitarbeiter m on m.id = w.mitarbeiter_id
   where w.id = p_id and m.filiale_id = v_b.filiale_id;
  if not found then
    raise exception 'WOCHENVORGABE_NICHT_GEFUNDEN';
  end if;
  delete from pep.wochenvorgaben where id = p_id;
  perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'wochenvorgaben', p_id::text, to_jsonb(v_alt), null);
end;
$$;

create or replace function public.pep_urlaubsjahr_speichern(
  p_mitarbeiter_id bigint, p_jahr int, p_anspruch numeric, p_rest_vorjahr numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung();
  v_m   pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_alt pep.urlaubsjahre;
  v_neu pep.urlaubsjahre;
begin
  if p_jahr is null or p_anspruch is null or p_anspruch < 0 or coalesce(p_rest_vorjahr, 0) < 0 then
    raise exception 'STUNDEN_UNGUELTIG';
  end if;
  select * into v_alt from pep.urlaubsjahre where mitarbeiter_id = v_m.id and jahr = p_jahr;

  insert into pep.urlaubsjahre (mitarbeiter_id, jahr, anspruch_stunden, rest_vorjahr_stunden)
  values (v_m.id, p_jahr, p_anspruch, coalesce(p_rest_vorjahr, 0))
  on conflict (mitarbeiter_id, jahr) do update
    set anspruch_stunden = excluded.anspruch_stunden,
        rest_vorjahr_stunden = excluded.rest_vorjahr_stunden
  returning * into v_neu;

  perform pep.protokolliere(v_b.filiale_id,
    case when v_alt.jahr is null then 'anlegen' else 'aendern' end,
    'urlaubsjahre', v_m.id || ':' || p_jahr,
    case when v_alt.jahr is null then null else to_jsonb(v_alt) end, to_jsonb(v_neu));
end;
$$;

-- ---------------------------------------------------------------------------
-- Einstellungen: Tabellen
-- ---------------------------------------------------------------------------

-- Regelöffnungszeiten und Planungsrahmen je Wochentag (ISO: 1 = Montag … 7 = Sonntag).
create table if not exists pep.rahmen (
  filiale_id   bigint not null references pep.filialen (id) on delete cascade,
  wochentag    int not null check (wochentag between 1 and 7),
  geoeffnet    boolean not null,
  oeffnung_von time,
  oeffnung_bis time,
  rahmen_von   time,
  rahmen_bis   time,
  primary key (filiale_id, wochentag),
  check (extract(minute from oeffnung_von) in (0, 30) and extract(minute from oeffnung_bis) in (0, 30)
     and extract(minute from rahmen_von) in (0, 30) and extract(minute from rahmen_bis) in (0, 30))
);

-- Einzelne Tage, die vom Rahmen abweichen (verkaufsoffener Sonntag, Heiligabend, …).
create table if not exists pep.tag_abweichungen (
  filiale_id   bigint not null references pep.filialen (id) on delete cascade,
  datum        date not null,
  art          text not null check (art in ('feiertag', 'heiligabend', 'silvester', 'vor_feiertag', 'verkaufsoffen', 'sonstiges')),
  geoeffnet    boolean not null,
  oeffnung_von time,
  oeffnung_bis time,
  rahmen_von   time,
  rahmen_bis   time,
  name         text,
  primary key (filiale_id, datum),
  check (extract(minute from oeffnung_von) in (0, 30) and extract(minute from oeffnung_bis) in (0, 30)
     and extract(minute from rahmen_von) in (0, 30) and extract(minute from rahmen_bis) in (0, 30))
);

create table if not exists pep.einstellungen (
  filiale_id bigint not null references pep.filialen (id) on delete cascade,
  schluessel text not null,
  wert       jsonb not null,
  primary key (filiale_id, schluessel)
);

create table if not exists pep.abwesenheitscodes (
  id           bigint generated always as identity primary key,
  filiale_id   bigint not null references pep.filialen (id) on delete cascade,
  code         text not null check (char_length(code) between 1 and 3),
  name         text not null check (btrim(name) <> ''),
  farbe        text not null check (farbe ~ '^#[0-9A-Fa-f]{6}$'),
  stundenregel text not null check (stundenregel in ('teiler', 'tatsaechlich', 'keine')),
  sperrt       boolean not null default true,
  aktiv        boolean not null default true,
  position     int not null default 0,
  unique (filiale_id, code)
);

create table if not exists pep.schulferien (
  id         bigint generated always as identity primary key,
  filiale_id bigint not null references pep.filialen (id) on delete cascade,
  von        date not null,
  bis        date not null check (bis >= von),
  name       text not null check (btrim(name) <> '')
);

alter table pep.rahmen            enable row level security;
alter table pep.tag_abweichungen  enable row level security;
alter table pep.einstellungen     enable row level security;
alter table pep.abwesenheitscodes enable row level security;
alter table pep.schulferien       enable row level security;

-- ---------------------------------------------------------------------------
-- Einstellungen: interne Funktionen
-- ---------------------------------------------------------------------------

-- Wert eines Parameters der Filiale, sonst EINSTELLUNG_FEHLT.
create or replace function pep.einstellung(p_filiale_id bigint, p_schluessel text)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_wert jsonb;
begin
  select e.wert into v_wert from pep.einstellungen e
   where e.filiale_id = p_filiale_id and e.schluessel = p_schluessel;
  if not found then
    raise exception 'EINSTELLUNG_FEHLT';
  end if;
  return v_wert;
end;
$$;

-- Name des gesetzlichen Feiertags am Datum (Bundesland der Filiale) oder null.
create or replace function pep.feiertag(p_filiale_id bigint, p_datum date)
returns text
language sql stable
set search_path = ''
as $$
  select l.name
    from pep.filialen f,
         urlaub.landesfeiertage(extract(year from p_datum)::int, f.bundesland) l
   where f.id = p_filiale_id and l.datum = p_datum
   limit 1
$$;

-- Öffnung und Planungsrahmen eines Tages. Vorrang: abweichender Tag, dann
-- gesetzlicher Feiertag (geschlossen), dann Rahmen des Wochentags.
create or replace function pep.tag_status(p_filiale_id bigint, p_datum date)
returns table (geoeffnet boolean, oeffnung_von time, oeffnung_bis time,
               rahmen_von time, rahmen_bis time, feiertag text, abweichung text)
language plpgsql stable
set search_path = ''
as $$
declare
  v_feiertag text := pep.feiertag(p_filiale_id, p_datum);
  v_a        pep.tag_abweichungen;
  v_r        pep.rahmen;
begin
  select * into v_a from pep.tag_abweichungen a
   where a.filiale_id = p_filiale_id and a.datum = p_datum;
  if found then
    return query select v_a.geoeffnet, v_a.oeffnung_von, v_a.oeffnung_bis,
                        v_a.rahmen_von, v_a.rahmen_bis, v_feiertag, v_a.art;
    return;
  end if;
  if v_feiertag is not null then
    return query select false, null::time, null::time, null::time, null::time, v_feiertag, null::text;
    return;
  end if;
  select * into v_r from pep.rahmen r
   where r.filiale_id = p_filiale_id and r.wochentag = extract(isodow from p_datum)::int;
  if not found then
    return query select false, null::time, null::time, null::time, null::time, null::text, null::text;
    return;
  end if;
  return query select v_r.geoeffnet, v_r.oeffnung_von, v_r.oeffnung_bis,
                      v_r.rahmen_von, v_r.rahmen_bis, null::text, null::text;
end;
$$;

-- Prüft Öffnungs- und Rahmenzeiten eines Tages (Rahmen, abweichender Tag).
create or replace function pep.zeiten_pruefen(
  p_geoeffnet boolean, p_o_von time, p_o_bis time, p_r_von time, p_r_bis time)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if extract(minute from p_o_von) not in (0, 30) or extract(minute from p_o_bis) not in (0, 30)
     or extract(minute from p_r_von) not in (0, 30) or extract(minute from p_r_bis) not in (0, 30) then
    raise exception 'HALBE_STUNDE';
  end if;
  if p_geoeffnet then
    if p_o_von is null or p_o_bis is null or p_r_von is null or p_r_bis is null
       or p_o_von >= p_o_bis or p_r_von > p_o_von or p_r_bis < p_o_bis then
      raise exception 'ZEITEN_UNGUELTIG';
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Einstellungen: Funktionen für den Browser
-- ---------------------------------------------------------------------------

-- Lesen: Leitung und Stellvertretung.
create or replace function public.pep_einstellungen()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.ich();
  v_f bigint;
begin
  if v_b.rolle not in ('leitung', 'stellvertretung') then
    raise exception 'KEIN_ZUGRIFF';
  end if;
  v_f := pep.meine_filiale();
  return jsonb_build_object(
    'filiale', (select jsonb_build_object('id', f.id, 'name', f.name, 'nummer', f.nummer, 'bundesland', f.bundesland)
                  from pep.filialen f where f.id = v_f),
    'rahmen', coalesce((select jsonb_agg(to_jsonb(r) - 'filiale_id' order by r.wochentag)
                          from pep.rahmen r where r.filiale_id = v_f), '[]'::jsonb),
    'abweichungen', coalesce((select jsonb_agg(to_jsonb(a) - 'filiale_id' order by a.datum)
                                from pep.tag_abweichungen a where a.filiale_id = v_f), '[]'::jsonb),
    'werte', coalesce((select jsonb_object_agg(e.schluessel, e.wert)
                         from pep.einstellungen e where e.filiale_id = v_f), '{}'::jsonb),
    'codes', coalesce((select jsonb_agg(to_jsonb(c) - 'filiale_id' order by c.position, c.id)
                         from pep.abwesenheitscodes c where c.filiale_id = v_f), '[]'::jsonb),
    'bereiche', coalesce((select jsonb_agg(to_jsonb(b) - 'filiale_id' order by b.position, b.id)
                            from pep.bereiche b where b.filiale_id = v_f), '[]'::jsonb),
    'schulferien', coalesce((select jsonb_agg(to_jsonb(s) - 'filiale_id' order by s.von, s.id)
                               from pep.schulferien s where s.filiale_id = v_f), '[]'::jsonb),
    'benutzer', coalesce((select jsonb_agg(jsonb_build_object(
                                   'user_id', bn.user_id, 'benutzername', o.benutzername,
                                   'anzeigename', o.anzeigename, 'rolle', bn.rolle)
                                 order by o.benutzername)
                            from pep.benutzer bn
                            join urlaub.organisatoren o on o.user_id = bn.user_id
                           where bn.filiale_id = v_f), '[]'::jsonb));
end;
$$;

-- Gesetzliche Feiertage des Bundeslands der eigenen Filiale.
create or replace function public.pep_feiertage(p_jahr int)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.ich();
  v_f bigint;
begin
  if v_b.rolle not in ('leitung', 'stellvertretung') then
    raise exception 'KEIN_ZUGRIFF';
  end if;
  v_f := pep.meine_filiale();
  return coalesce((select jsonb_agg(jsonb_build_object('datum', l.datum, 'name', l.name) order by l.datum)
                     from pep.filialen f, urlaub.landesfeiertage(p_jahr, f.bundesland) l
                    where f.id = v_f), '[]'::jsonb);
end;
$$;

-- p_daten: geoeffnet, oeffnung_von, oeffnung_bis, rahmen_von, rahmen_bis ("HH:MM").
create or replace function public.pep_rahmen_speichern(p_wochentag int, p_daten jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung();
  v_auf  boolean := coalesce((p_daten ->> 'geoeffnet')::boolean, false);
  v_ov   time := (p_daten ->> 'oeffnung_von')::time;
  v_ob   time := (p_daten ->> 'oeffnung_bis')::time;
  v_rv   time := (p_daten ->> 'rahmen_von')::time;
  v_rb   time := (p_daten ->> 'rahmen_bis')::time;
  v_alt  pep.rahmen;
  v_neu  pep.rahmen;
begin
  if p_wochentag is null or p_wochentag not between 1 and 7 then
    raise exception 'WOCHENTAG_UNGUELTIG';
  end if;
  perform pep.zeiten_pruefen(v_auf, v_ov, v_ob, v_rv, v_rb);

  select * into v_alt from pep.rahmen where filiale_id = v_b.filiale_id and wochentag = p_wochentag;
  insert into pep.rahmen (filiale_id, wochentag, geoeffnet, oeffnung_von, oeffnung_bis, rahmen_von, rahmen_bis)
  values (v_b.filiale_id, p_wochentag, v_auf, v_ov, v_ob, v_rv, v_rb)
  on conflict (filiale_id, wochentag) do update set
    geoeffnet = excluded.geoeffnet, oeffnung_von = excluded.oeffnung_von, oeffnung_bis = excluded.oeffnung_bis,
    rahmen_von = excluded.rahmen_von, rahmen_bis = excluded.rahmen_bis
  returning * into v_neu;
  perform pep.protokolliere(v_b.filiale_id, case when v_alt.wochentag is null then 'anlegen' else 'aendern' end,
    'rahmen', p_wochentag::text,
    case when v_alt.wochentag is null then null else to_jsonb(v_alt) end, to_jsonb(v_neu));
end;
$$;

-- p_daten: art, geoeffnet, oeffnung_von, oeffnung_bis, rahmen_von, rahmen_bis, name.
create or replace function public.pep_abweichung_speichern(p_datum date, p_daten jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung();
  v_art  text := p_daten ->> 'art';
  v_auf  boolean := coalesce((p_daten ->> 'geoeffnet')::boolean, false);
  v_ov   time := (p_daten ->> 'oeffnung_von')::time;
  v_ob   time := (p_daten ->> 'oeffnung_bis')::time;
  v_rv   time := (p_daten ->> 'rahmen_von')::time;
  v_rb   time := (p_daten ->> 'rahmen_bis')::time;
  v_alt  pep.tag_abweichungen;
  v_neu  pep.tag_abweichungen;
begin
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if v_art is null or v_art not in ('feiertag', 'heiligabend', 'silvester', 'vor_feiertag', 'verkaufsoffen', 'sonstiges') then
    raise exception 'ART_UNGUELTIG';
  end if;
  perform pep.zeiten_pruefen(v_auf, v_ov, v_ob, v_rv, v_rb);

  select * into v_alt from pep.tag_abweichungen where filiale_id = v_b.filiale_id and datum = p_datum;
  insert into pep.tag_abweichungen (filiale_id, datum, art, geoeffnet, oeffnung_von, oeffnung_bis, rahmen_von, rahmen_bis, name)
  values (v_b.filiale_id, p_datum, v_art, v_auf, v_ov, v_ob, v_rv, v_rb, nullif(urlaub.trim_alles(p_daten ->> 'name'), ''))
  on conflict (filiale_id, datum) do update set
    art = excluded.art, geoeffnet = excluded.geoeffnet,
    oeffnung_von = excluded.oeffnung_von, oeffnung_bis = excluded.oeffnung_bis,
    rahmen_von = excluded.rahmen_von, rahmen_bis = excluded.rahmen_bis, name = excluded.name
  returning * into v_neu;
  perform pep.protokolliere(v_b.filiale_id, case when v_alt.datum is null then 'anlegen' else 'aendern' end,
    'tag_abweichungen', p_datum::text,
    case when v_alt.datum is null then null else to_jsonb(v_alt) end, to_jsonb(v_neu));
end;
$$;

create or replace function public.pep_abweichung_loeschen(p_datum date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung();
  v_alt pep.tag_abweichungen;
begin
  delete from pep.tag_abweichungen where filiale_id = v_b.filiale_id and datum = p_datum
  returning * into v_alt;
  if not found then
    raise exception 'ABWEICHUNG_NICHT_GEFUNDEN';
  end if;
  perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'tag_abweichungen', p_datum::text, to_jsonb(v_alt), null);
end;
$$;

-- Nur die bekannten Schlüssel; Zahlen müssen > 0 sein (wochen_toleranz_h: >= 0),
-- Uhrzeiten "HH:MM" mit Minute 00 oder 30.
create or replace function public.pep_einstellung_setzen(p_schluessel text, p_wert jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung();
  v_typ  text := coalesce(jsonb_typeof(p_wert), '');
  v_alt  jsonb;
begin
  if p_schluessel is null or p_schluessel not in (
       'abwesenheit_teiler', 'feiertag_teiler', 'pause_ab_6h_min', 'pause_ab_9h_min', 'ruhezeit_h',
       'ruhezeit_u18_h', 'max_tag_h', 'max_tag_u18_h', 'max_woche_u18_h', 'spaet_grenze',
       'u18_fruehestens', 'u18_spaetestens', 'freie_samstage_monat', 'freie_samstage_jahr',
       'wochen_toleranz_h', 'zeitkonto_warnfaktor', 'stundenleistung_eur_h', 'kassierleistung_eur_halbe_h') then
    raise exception 'EINSTELLUNG_UNBEKANNT';
  end if;

  if p_schluessel in ('spaet_grenze', 'u18_fruehestens', 'u18_spaetestens') then
    if v_typ <> 'string' or (p_wert #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'WERT_UNGUELTIG';
    end if;
    if (p_wert #>> '{}') !~ ':(00|30)$' then
      raise exception 'HALBE_STUNDE';
    end if;
  elsif v_typ <> 'number' then
    raise exception 'WERT_UNGUELTIG';
  elsif (p_wert #>> '{}')::numeric < 0 or ((p_wert #>> '{}')::numeric = 0 and p_schluessel <> 'wochen_toleranz_h') then
    raise exception 'WERT_UNGUELTIG';
  end if;

  select wert into v_alt from pep.einstellungen where filiale_id = v_b.filiale_id and schluessel = p_schluessel;
  insert into pep.einstellungen (filiale_id, schluessel, wert)
  values (v_b.filiale_id, p_schluessel, p_wert)
  on conflict (filiale_id, schluessel) do update set wert = excluded.wert;
  perform pep.protokolliere(v_b.filiale_id, 'aendern', 'einstellungen', p_schluessel,
    to_jsonb(v_alt), to_jsonb(p_wert));
end;
$$;

-- p_id null = anlegen. Fehlende Schlüssel in p_daten lassen beim Ändern den
-- bisherigen Wert stehen. Schlüssel: code, name, farbe, stundenregel, sperrt, aktiv, position.
create or replace function public.pep_code_speichern(p_id bigint, p_daten jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     pep.benutzer := pep.leitung();
  v_alt   pep.abwesenheitscodes;
  v_neu   pep.abwesenheitscodes;
  v_code  text;
  v_name  text;
  v_farbe text;
  v_regel text;
begin
  if p_id is not null then
    select * into v_alt from pep.abwesenheitscodes where id = p_id and filiale_id = v_b.filiale_id;
    if not found then
      raise exception 'CODE_NICHT_GEFUNDEN';
    end if;
  end if;
  v_code  := upper(coalesce(urlaub.trim_alles(p_daten ->> 'code'), v_alt.code));
  v_name  := coalesce(urlaub.trim_alles(p_daten ->> 'name'), v_alt.name);
  v_farbe := coalesce(p_daten ->> 'farbe', v_alt.farbe);
  v_regel := coalesce(p_daten ->> 'stundenregel', v_alt.stundenregel);

  if v_code is null or char_length(v_code) not between 1 and 3 then
    raise exception 'KUERZEL_UNGUELTIG';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'NAME_LEER';
  end if;
  if v_farbe is null or v_farbe !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'FARBE_UNGUELTIG';
  end if;
  if v_regel is null or v_regel not in ('teiler', 'tatsaechlich', 'keine') then
    raise exception 'STUNDENREGEL_UNGUELTIG';
  end if;
  if exists (select 1 from pep.abwesenheitscodes
              where filiale_id = v_b.filiale_id and code = v_code and id is distinct from p_id) then
    raise exception 'KUERZEL_DOPPELT';
  end if;

  if p_id is null then
    insert into pep.abwesenheitscodes (filiale_id, code, name, farbe, stundenregel, sperrt, aktiv, position)
    values (v_b.filiale_id, v_code, v_name, v_farbe, v_regel,
            coalesce((p_daten ->> 'sperrt')::boolean, true), coalesce((p_daten ->> 'aktiv')::boolean, true),
            coalesce((p_daten ->> 'position')::int,
                     (select coalesce(max(c.position), 0) + 1 from pep.abwesenheitscodes c where c.filiale_id = v_b.filiale_id)))
    returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'abwesenheitscodes', v_neu.id::text, null, to_jsonb(v_neu));
  else
    update pep.abwesenheitscodes set
      code = v_code, name = v_name, farbe = v_farbe, stundenregel = v_regel,
      sperrt = coalesce((p_daten ->> 'sperrt')::boolean, sperrt),
      aktiv = coalesce((p_daten ->> 'aktiv')::boolean, aktiv),
      position = coalesce((p_daten ->> 'position')::int, position)
     where id = p_id returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'aendern', 'abwesenheitscodes', v_neu.id::text, to_jsonb(v_alt), to_jsonb(v_neu));
  end if;
  return v_neu.id;
end;
$$;

-- p_id null = anlegen (art bereich oder funktion, Standard bereich). art ist danach fest.
-- Schlüssel: kuerzel, name, farbe, art, kompetenz_noetig, aktiv, position.
create or replace function public.pep_bereich_speichern(p_id bigint, p_daten jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung();
  v_alt    pep.bereiche;
  v_neu    pep.bereiche;
  v_kuerz  text;
  v_name   text;
  v_farbe  text;
  v_art    text := p_daten ->> 'art';
begin
  if p_id is not null then
    select * into v_alt from pep.bereiche where id = p_id and filiale_id = v_b.filiale_id;
    if not found then
      raise exception 'BEREICH_NICHT_GEFUNDEN';
    end if;
    if v_art is not null and v_art <> v_alt.art then
      raise exception 'ART_FEST';
    end if;
  elsif v_art is not null and v_art not in ('bereich', 'funktion') then
    raise exception 'ART_UNGUELTIG';
  end if;
  v_kuerz := coalesce(urlaub.trim_alles(p_daten ->> 'kuerzel'), v_alt.kuerzel);
  v_name  := coalesce(urlaub.trim_alles(p_daten ->> 'name'), v_alt.name);
  v_farbe := coalesce(p_daten ->> 'farbe', v_alt.farbe);

  if v_kuerz is null or char_length(v_kuerz) not between 1 and 3 then
    raise exception 'KUERZEL_UNGUELTIG';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'NAME_LEER';
  end if;
  if v_farbe is null or v_farbe !~ '^#[0-9A-Fa-f]{6}$' then
    raise exception 'FARBE_UNGUELTIG';
  end if;
  if exists (select 1 from pep.bereiche
              where filiale_id = v_b.filiale_id and kuerzel = v_kuerz and id is distinct from p_id) then
    raise exception 'KUERZEL_DOPPELT';
  end if;

  if p_id is null then
    insert into pep.bereiche (filiale_id, kuerzel, name, farbe, art, kompetenz_noetig, aktiv, position)
    values (v_b.filiale_id, v_kuerz, v_name, v_farbe, coalesce(v_art, 'bereich'),
            coalesce((p_daten ->> 'kompetenz_noetig')::boolean, false), coalesce((p_daten ->> 'aktiv')::boolean, true),
            coalesce((p_daten ->> 'position')::int,
                     (select coalesce(max(x.position), 0) + 1 from pep.bereiche x where x.filiale_id = v_b.filiale_id)))
    returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'bereiche', v_neu.id::text, null, to_jsonb(v_neu));
  else
    update pep.bereiche set
      kuerzel = v_kuerz, name = v_name, farbe = v_farbe,
      kompetenz_noetig = coalesce((p_daten ->> 'kompetenz_noetig')::boolean, kompetenz_noetig),
      aktiv = coalesce((p_daten ->> 'aktiv')::boolean, aktiv),
      position = coalesce((p_daten ->> 'position')::int, position)
     where id = p_id returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'aendern', 'bereiche', v_neu.id::text, to_jsonb(v_alt), to_jsonb(v_neu));
  end if;
  return v_neu.id;
end;
$$;

create or replace function public.pep_schulferien_speichern(p_id bigint, p_von date, p_bis date, p_name text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung();
  v_name text := urlaub.trim_alles(p_name);
  v_alt  pep.schulferien;
  v_neu  pep.schulferien;
begin
  if p_von is null or p_bis is null or p_bis < p_von then
    raise exception 'ZEITRAUM_UNGUELTIG';
  end if;
  if v_name is null or v_name = '' then
    raise exception 'NAME_LEER';
  end if;
  if p_id is null then
    insert into pep.schulferien (filiale_id, von, bis, name)
    values (v_b.filiale_id, p_von, p_bis, v_name) returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'schulferien', v_neu.id::text, null, to_jsonb(v_neu));
  else
    select * into v_alt from pep.schulferien where id = p_id and filiale_id = v_b.filiale_id;
    if not found then
      raise exception 'SCHULFERIEN_NICHT_GEFUNDEN';
    end if;
    update pep.schulferien set von = p_von, bis = p_bis, name = v_name
     where id = p_id returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'aendern', 'schulferien', v_neu.id::text, to_jsonb(v_alt), to_jsonb(v_neu));
  end if;
  return v_neu.id;
end;
$$;

create or replace function public.pep_schulferien_loeschen(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung();
  v_alt pep.schulferien;
begin
  delete from pep.schulferien where id = p_id and filiale_id = v_b.filiale_id returning * into v_alt;
  if not found then
    raise exception 'SCHULFERIEN_NICHT_GEFUNDEN';
  end if;
  perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'schulferien', p_id::text, to_jsonb(v_alt), null);
end;
$$;

-- Ordnet einen Organisator des Urlaubstools der eigenen Filiale zu (oder ändert
-- seine Rolle). Ohne Filiale (start_leitung) wird zugeordnet; Benutzer einer
-- anderen Filiale bleiben unberührt.
create or replace function public.pep_benutzer_setzen(p_benutzername text, p_rolle text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung();
  v_name text := lower(urlaub.trim_alles(p_benutzername));
  v_uid  uuid;
  v_alt  pep.benutzer;
  v_neu  pep.benutzer;
begin
  if p_rolle is null or p_rolle not in ('leitung', 'stellvertretung') then
    raise exception 'ROLLE_UNGUELTIG';
  end if;
  select o.user_id into v_uid from urlaub.organisatoren o where o.benutzername = v_name;
  if not found then
    raise exception 'BENUTZER_NICHT_GEFUNDEN';
  end if;
  if v_uid = v_b.user_id then
    raise exception 'NICHT_SELBST';
  end if;
  select * into v_alt from pep.benutzer where user_id = v_uid;
  if found and v_alt.filiale_id is not null and v_alt.filiale_id <> v_b.filiale_id then
    raise exception 'BENUTZER_NICHT_GEFUNDEN';
  end if;

  insert into pep.benutzer (user_id, filiale_id, rolle) values (v_uid, v_b.filiale_id, p_rolle)
  on conflict (user_id) do update set rolle = excluded.rolle, filiale_id = excluded.filiale_id
  returning * into v_neu;
  perform pep.protokolliere(v_b.filiale_id, case when v_alt.user_id is null then 'anlegen' else 'aendern' end,
    'benutzer', v_uid::text,
    case when v_alt.user_id is null then null else to_jsonb(v_alt) end, to_jsonb(v_neu));
end;
$$;

-- Entfernt die Zuordnung zur Filiale (der Zugang im Urlaubstool bleibt bestehen).
create or replace function public.pep_benutzer_entfernen(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung();
  v_alt pep.benutzer;
begin
  if p_user_id = v_b.user_id then
    raise exception 'NICHT_SELBST';
  end if;
  delete from pep.benutzer where user_id = p_user_id and filiale_id = v_b.filiale_id returning * into v_alt;
  if not found then
    raise exception 'BENUTZER_NICHT_GEFUNDEN';
  end if;
  perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'benutzer', p_user_id::text, to_jsonb(v_alt), null);
end;
$$;

-- Bestehende Filialen nachrüsten (zweiter Schema-Lauf nach einem Update).
select pep.grundausstattung(id) from pep.filialen;

-- ---------------------------------------------------------------------------
-- Rechte
-- ---------------------------------------------------------------------------

revoke all on function public.pep_ich()                              from public, anon, authenticated;
revoke all on function public.pep_filiale_anlegen(text, text, text)  from public, anon, authenticated;
grant execute on function public.pep_ich()                              to authenticated;
grant execute on function public.pep_filiale_anlegen(text, text, text)  to authenticated;

-- Stammdaten
revoke all on function public.pep_bereiche()                                         from public, anon, authenticated;
revoke all on function public.pep_mitarbeiter_liste()                                from public, anon, authenticated;
revoke all on function public.pep_mitarbeiter(bigint)                                from public, anon, authenticated;
revoke all on function public.pep_mitarbeiter_speichern(bigint, jsonb)               from public, anon, authenticated;
revoke all on function public.pep_vertrag_speichern(bigint, jsonb)                   from public, anon, authenticated;
revoke all on function public.pep_vertrag_loeschen(bigint)                           from public, anon, authenticated;
revoke all on function public.pep_kompetenz_setzen(bigint, bigint, boolean)          from public, anon, authenticated;
revoke all on function public.pep_wochenvorgabe_speichern(bigint, jsonb)             from public, anon, authenticated;
revoke all on function public.pep_wochenvorgabe_loeschen(bigint)                     from public, anon, authenticated;
revoke all on function public.pep_urlaubsjahr_speichern(bigint, int, numeric, numeric) from public, anon, authenticated;
grant execute on function public.pep_bereiche()                                         to authenticated;
grant execute on function public.pep_mitarbeiter_liste()                                to authenticated;
grant execute on function public.pep_mitarbeiter(bigint)                                to authenticated;
grant execute on function public.pep_mitarbeiter_speichern(bigint, jsonb)               to authenticated;
grant execute on function public.pep_vertrag_speichern(bigint, jsonb)                   to authenticated;
grant execute on function public.pep_vertrag_loeschen(bigint)                           to authenticated;
grant execute on function public.pep_kompetenz_setzen(bigint, bigint, boolean)          to authenticated;
grant execute on function public.pep_wochenvorgabe_speichern(bigint, jsonb)             to authenticated;
grant execute on function public.pep_wochenvorgabe_loeschen(bigint)                     to authenticated;
grant execute on function public.pep_urlaubsjahr_speichern(bigint, int, numeric, numeric) to authenticated;

-- Einstellungen
revoke all on function public.pep_einstellungen() from public, anon, authenticated;
revoke all on function public.pep_feiertage(int) from public, anon, authenticated;
revoke all on function public.pep_rahmen_speichern(int, jsonb) from public, anon, authenticated;
revoke all on function public.pep_abweichung_speichern(date, jsonb) from public, anon, authenticated;
revoke all on function public.pep_abweichung_loeschen(date) from public, anon, authenticated;
revoke all on function public.pep_einstellung_setzen(text, jsonb) from public, anon, authenticated;
revoke all on function public.pep_code_speichern(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.pep_bereich_speichern(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.pep_schulferien_speichern(bigint, date, date, text) from public, anon, authenticated;
revoke all on function public.pep_schulferien_loeschen(bigint) from public, anon, authenticated;
revoke all on function public.pep_benutzer_setzen(text, text) from public, anon, authenticated;
revoke all on function public.pep_benutzer_entfernen(uuid) from public, anon, authenticated;
grant execute on function public.pep_einstellungen() to authenticated;
grant execute on function public.pep_feiertage(int) to authenticated;
grant execute on function public.pep_rahmen_speichern(int, jsonb) to authenticated;
grant execute on function public.pep_abweichung_speichern(date, jsonb) to authenticated;
grant execute on function public.pep_abweichung_loeschen(date) to authenticated;
grant execute on function public.pep_einstellung_setzen(text, jsonb) to authenticated;
grant execute on function public.pep_code_speichern(bigint, jsonb) to authenticated;
grant execute on function public.pep_bereich_speichern(bigint, jsonb) to authenticated;
grant execute on function public.pep_schulferien_speichern(bigint, date, date, text) to authenticated;
grant execute on function public.pep_schulferien_loeschen(bigint) to authenticated;
grant execute on function public.pep_benutzer_setzen(text, text) to authenticated;
grant execute on function public.pep_benutzer_entfernen(uuid) to authenticated;

commit;

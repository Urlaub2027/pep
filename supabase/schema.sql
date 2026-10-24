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
-- Bedeutung für die Regeln (Kasse, VP): erkannt an dieser Spalte, nicht am frei änderbaren Kürzel.
-- Je Filiale höchstens ein Bereich je Bedeutung; in den Einstellungen unsichtbar und fest.
alter table pep.bereiche add column if not exists bedeutung text check (bedeutung in ('kasse', 'vp'));
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bereiche_bedeutung_eindeutig') then
    alter table pep.bereiche add constraint bereiche_bedeutung_eindeutig unique (filiale_id, bedeutung);
  end if;
end
$$;

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

-- „Heute“ in der Zeitzone des Marktes, nie current_date. Die Einstellung
-- pep.heute (GUC) gibt es nur für Tests und fixiert das Datum; in Produktion ist sie leer.
create or replace function pep.heute()
returns date
language sql stable
set search_path = ''
as $$
  select coalesce(nullif(current_setting('pep.heute', true), '')::date,
                  (now() at time zone 'Europe/Berlin')::date)
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
  if v_b.filiale_id is null then
    raise exception 'KEINE_FILIALE';
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
    insert into pep.bereiche (filiale_id, kuerzel, name, farbe, art, kompetenz_noetig, aktiv, position, bedeutung)
    values
      (p_filiale_id, 'KA', 'Kasse',         '#7FD1FF', 'bereich',  true,  true,  1,  'kasse'),
      (p_filiale_id, 'OG', 'Obst',          '#9BE38A', 'bereich',  false, true,  2,  null),
      (p_filiale_id, 'BB', 'Backen',        '#F3C96B', 'bereich',  false, true,  3,  null),
      (p_filiale_id, 'TS', 'TroSo',         '#D9B38C', 'bereich',  false, true,  4,  null),
      (p_filiale_id, 'MO', 'MoPro',         '#F5F5F5', 'bereich',  false, true,  5,  null),
      (p_filiale_id, 'TK', 'TK',            '#B8C4FF', 'bereich',  false, true,  6,  null),
      (p_filiale_id, 'FÜ', 'Führung',       '#2E7D4F', 'bereich',  false, true,  7,  null),
      (p_filiale_id, 'RE', 'Reinigung',     '#C9C9C9', 'bereich',  false, true,  8,  null),
      (p_filiale_id, 'BO', 'Backoffice',    '#AEE0D6', 'bereich',  false, true,  9,  null),
      (p_filiale_id, 'PA', 'Pause',         '#555555', 'pause',    false, true,  10, null),
      (p_filiale_id, 'PO', 'Post',          '#E6E600', 'bereich',  false, false, 11, null),
      (p_filiale_id, 'KI', 'Kiosk',         '#FF8C42', 'bereich',  false, false, 12, null),
      (p_filiale_id, 'GM', 'Getränkemarkt', '#333333', 'bereich',  false, false, 13, null),
      (p_filiale_id, 'BE', 'Bedienbäckerei','#B5651D', 'bereich',  false, false, 14, null),
      (p_filiale_id, 'VP', 'VP',            '#9A5AD0', 'funktion', false, true,  15, 'vp')
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
  v_b      pep.benutzer := pep.ich();
  v_name   text := urlaub.trim_alles(p_name);
  v_nummer text := nullif(urlaub.trim_alles(p_nummer), '');
  v_f      pep.filialen;
begin
  if v_b.rolle <> 'leitung' then
    raise exception 'NUR_LEITUNG';
  end if;
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
  v_f := (pep.leitung_oder_stellvertretung()).filiale_id;
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
  v_f := (pep.leitung_oder_stellvertretung()).filiale_id;
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
  perform pep.leitung_oder_stellvertretung();
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
  -- Abwesenheitstage ab dem frühesten betroffenen Datum neu rechnen
  perform pep.stunden_neu_berechnen(v_m.id, least(v_ab, coalesce(v_alt.gueltig_ab, v_ab)));
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
  perform pep.stunden_neu_berechnen(v_alt.mitarbeiter_id, v_alt.gueltig_ab);
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
  if p_schluessel = 'abwesenheit_teiler' then
    -- alle Teiler-Tage der Filiale mit dem neuen Teiler neu rechnen
    perform pep.stunden_neu_berechnen(m.id, date '1900-01-01')
       from pep.mitarbeiter m where m.filiale_id = v_b.filiale_id;
  end if;
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

-- ---------------------------------------------------------------------------
-- Abwesenheiten: Tabellen
-- ---------------------------------------------------------------------------

-- Wiederholungsregel: jeden <wochentag> zwischen von_datum und bis_datum (höchstens 12 Monate).
create table if not exists pep.wiederholungen (
  id             bigint generated always as identity primary key,
  filiale_id     bigint not null references pep.filialen (id) on delete cascade,
  mitarbeiter_id bigint not null references pep.mitarbeiter (id) on delete cascade,
  code_id        bigint not null references pep.abwesenheitscodes (id),
  wochentag      int not null check (wochentag between 1 and 7),
  von_datum      date not null,
  bis_datum      date not null check (bis_datum >= von_datum),
  von            time check (von is null or extract(minute from von) in (0, 30)),
  bis            time check (bis is null or extract(minute from bis) in (0, 30)),
  stunden        numeric(5,2) check (stunden is null or (stunden >= 0 and stunden <= 24)),
  notiz          text,
  check ((von is null) = (bis is null)),
  check (von is null or von < bis)
);
alter table pep.wiederholungen add column if not exists schulferien_aussetzen boolean not null default true;
create index if not exists wiederholungen_mitarbeiter_idx on pep.wiederholungen (mitarbeiter_id);

-- Ein Tag, eine Abwesenheit je Mitarbeiter. Mit von/bis ist der Tag nur teilweise abwesend.
create table if not exists pep.abwesenheiten (
  id             bigint generated always as identity primary key,
  filiale_id     bigint not null references pep.filialen (id) on delete cascade,
  mitarbeiter_id bigint not null references pep.mitarbeiter (id) on delete cascade,
  code_id        bigint not null references pep.abwesenheitscodes (id),
  datum          date not null,
  stunden        numeric(5,2) not null check (stunden >= 0 and stunden <= 24),
  von            time check (von is null or extract(minute from von) in (0, 30)),
  bis            time check (bis is null or extract(minute from bis) in (0, 30)),
  quelle         text not null check (quelle in ('manuell', 'urlaubstool', 'schnell', 'wiederholung')),
  wiederholung_id bigint references pep.wiederholungen (id) on delete set null,
  freigabe_id    bigint,
  notiz          text,
  angelegt_von   uuid,
  angelegt_am    timestamptz not null default now(),
  unique (mitarbeiter_id, datum),
  check ((von is null) = (bis is null)),
  check (von is null or von < bis)
);
create index if not exists abwesenheiten_filiale_datum_idx on pep.abwesenheiten (filiale_id, datum);

alter table pep.wiederholungen enable row level security;
alter table pep.abwesenheiten  enable row level security;

-- ---------------------------------------------------------------------------
-- Abwesenheiten: interne Funktionen
-- ---------------------------------------------------------------------------

-- Leitung oder Stellvertretung mit Filiale; sonst NUR_LEITUNG (auch für die Rolle
-- mitarbeiter) bzw. KEINE_FILIALE.
create or replace function pep.leitung_oder_stellvertretung()
returns pep.benutzer
language plpgsql stable
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.ich();
begin
  if v_b.rolle not in ('leitung', 'stellvertretung') then
    raise exception 'NUR_LEITUNG';
  end if;
  if v_b.filiale_id is null then
    raise exception 'KEINE_FILIALE';
  end if;
  return v_b;
end;
$$;

-- Prüft die Uhrzeiten eines Teiltags; ohne Uhrzeit nichts zu prüfen.
create or replace function pep.abwesenheit_zeiten_pruefen(p_von time, p_bis time, p_stunden numeric)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if (p_von is null) <> (p_bis is null) then
    raise exception 'ZEITEN_UNGUELTIG';
  end if;
  if p_von is null then
    return;
  end if;
  if extract(minute from p_von) not in (0, 30) or extract(minute from p_bis) not in (0, 30) then
    raise exception 'HALBE_STUNDE';
  end if;
  if p_von >= p_bis then
    raise exception 'ZEITEN_UNGUELTIG';
  end if;
  if p_stunden is null then
    raise exception 'STUNDEN_FEHLEN';
  end if;
  if p_stunden <= 0 or p_stunden > 24 then
    raise exception 'STUNDEN_UNGUELTIG';
  end if;
end;
$$;

-- Stunden eines ganzen Abwesenheitstags nach der Stundenregel des Codes.
-- teiler: Wochenstunden des Vertrags am Tag / abwesenheit_teiler (KEIN_VERTRAG ohne Vertrag).
create or replace function pep.abwesenheit_stunden(
  p_mitarbeiter_id bigint, p_datum date, p_code pep.abwesenheitscodes, p_stunden numeric)
returns numeric
language plpgsql stable
set search_path = ''
as $$
begin
  if p_code.stundenregel = 'teiler' then
    return round((pep.vertrag_am(p_mitarbeiter_id, p_datum)).wochenstunden
                 / (pep.einstellung(p_code.filiale_id, 'abwesenheit_teiler') #>> '{}')::numeric, 2);
  elsif p_code.stundenregel = 'tatsaechlich' then
    if p_stunden is null then
      raise exception 'STUNDEN_FEHLEN';
    end if;
    if p_stunden < 0 or p_stunden > 24 then
      raise exception 'STUNDEN_UNGUELTIG';
    end if;
    return p_stunden;
  end if;
  return 0;
end;
$$;

-- Einziger Schreibweg für Abwesenheitstage (auch für Freigaben und Wiederholungen).
-- Zerlegt den Zeitraum in Tage, überspringt geschlossene Tage (Sonntag, Feiertag,
-- geschlossene Abweichung) und ersetzt vorhandene Tage desselben Mitarbeiters.
create or replace function pep.abwesenheit_schreiben(
  p_filiale_id bigint, p_mitarbeiter_id bigint, p_code_id bigint, p_von date, p_bis date,
  p_stunden numeric, p_von_zeit time, p_bis_zeit time, p_quelle text,
  p_wiederholung_id bigint, p_freigabe_id bigint, p_notiz text, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_code  pep.abwesenheitscodes;
  v_tag   date;
  v_std   numeric;
  v_tage  int := 0;
  v_uebersprungen int := 0;
begin
  if p_von is null or p_bis is null or p_bis < p_von then
    raise exception 'ZEITRAUM_UNGUELTIG';
  end if;
  if p_bis - p_von + 1 > 366 then
    raise exception 'ZEITRAUM_ZU_LANG';
  end if;
  if not exists (select 1 from pep.mitarbeiter where id = p_mitarbeiter_id and filiale_id = p_filiale_id) then
    raise exception 'MITARBEITER_NICHT_GEFUNDEN';
  end if;
  select * into v_code from pep.abwesenheitscodes
   where id = p_code_id and filiale_id = p_filiale_id and aktiv;
  if not found then
    raise exception 'CODE_NICHT_GEFUNDEN';
  end if;
  perform pep.abwesenheit_zeiten_pruefen(p_von_zeit, p_bis_zeit, p_stunden);

  for v_tag in select p_von + i from generate_series(0, p_bis - p_von) i loop
    if not (select s.geoeffnet from pep.tag_status(p_filiale_id, v_tag) s) then
      v_uebersprungen := v_uebersprungen + 1;
      continue;
    end if;
    v_std := case when p_von_zeit is not null then p_stunden
                  else pep.abwesenheit_stunden(p_mitarbeiter_id, v_tag, v_code, p_stunden) end;
    insert into pep.abwesenheiten (filiale_id, mitarbeiter_id, code_id, datum, stunden, von, bis,
                                   quelle, wiederholung_id, freigabe_id, notiz, angelegt_von)
    values (p_filiale_id, p_mitarbeiter_id, p_code_id, v_tag, v_std, p_von_zeit, p_bis_zeit,
            p_quelle, p_wiederholung_id, p_freigabe_id, p_notiz, p_user_id)
    on conflict (mitarbeiter_id, datum) do update
      set code_id = excluded.code_id, stunden = excluded.stunden, von = excluded.von, bis = excluded.bis,
          quelle = excluded.quelle, wiederholung_id = excluded.wiederholung_id,
          freigabe_id = excluded.freigabe_id, notiz = excluded.notiz,
          angelegt_von = excluded.angelegt_von, angelegt_am = now();
    v_tage := v_tage + 1;
  end loop;

  perform pep.protokolliere(p_filiale_id, 'setzen', 'abwesenheiten', p_mitarbeiter_id::text, null,
    jsonb_build_object('code', v_code.code, 'von', p_von, 'bis', p_bis,
                       'tage', v_tage, 'uebersprungen', v_uebersprungen));
  return jsonb_build_object('tage', v_tage, 'uebersprungen', v_uebersprungen);
end;
$$;

-- Rechnet die Stunden der Teiler-Tage ganztägiger Abwesenheiten ab p_ab neu.
-- Tage ohne Vertrag am Datum bleiben unverändert. Liefert die Zahl der Zeilen.
create or replace function pep.stunden_neu_berechnen(p_mitarbeiter_id bigint, p_ab date)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_m      pep.mitarbeiter;
  v_anzahl int;
begin
  select * into v_m from pep.mitarbeiter where id = p_mitarbeiter_id;
  if not found then
    raise exception 'MITARBEITER_NICHT_GEFUNDEN';
  end if;
  update pep.abwesenheiten a
     set stunden = pep.abwesenheit_stunden(a.mitarbeiter_id, a.datum, c, null)
    from pep.abwesenheitscodes c
   where c.id = a.code_id and c.stundenregel = 'teiler' and a.von is null
     and a.mitarbeiter_id = p_mitarbeiter_id and a.datum >= p_ab
     and exists (select 1 from pep.vertraege v
                  where v.mitarbeiter_id = a.mitarbeiter_id and v.gueltig_ab <= a.datum);
  get diagnostics v_anzahl = row_count;
  perform pep.protokolliere(v_m.filiale_id, 'neu_berechnet', 'abwesenheiten', p_mitarbeiter_id::text, null,
    jsonb_build_object('anzahl', v_anzahl, 'ab', p_ab));
  return v_anzahl;
end;
$$;

-- Erzeugt die Tage einer Wiederholungsregel ab heute (vergangene bleiben unberührt).
create or replace function pep.wiederholung_erzeugen(p_w pep.wiederholungen, p_user_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_start date := greatest(p_w.von_datum, pep.heute());
  v_tag   date;
  v_belegt int := 0;
begin
  for v_tag in select v_start + i from generate_series(0, p_w.bis_datum - v_start) i
                where extract(isodow from v_start + i)::int = p_w.wochentag loop
    -- Manuelle, Urlaubstool- und Schnell-Einträge sowie Freigaben bleiben stehen
    if exists (select 1 from pep.abwesenheiten
                where mitarbeiter_id = p_w.mitarbeiter_id and datum = v_tag and quelle <> 'wiederholung') then
      v_belegt := v_belegt + 1;
      continue;
    end if;
    -- In den Schulferien der Filiale fällt die Berufsschule aus.
    if p_w.schulferien_aussetzen and exists (
         select 1 from pep.schulferien sf
          where sf.filiale_id = p_w.filiale_id and v_tag between sf.von and sf.bis) then
      continue;
    end if;
    perform pep.abwesenheit_schreiben(p_w.filiale_id, p_w.mitarbeiter_id, p_w.code_id, v_tag, v_tag,
      p_w.stunden, p_w.von, p_w.bis, 'wiederholung', p_w.id, null, p_w.notiz, p_user_id);
  end loop;
  return v_belegt;
end;
$$;

-- ---------------------------------------------------------------------------
-- Abwesenheiten: Funktionen für den Browser
-- ---------------------------------------------------------------------------

-- Leitung und Stellvertretung. Ohne p_von_zeit/p_bis_zeit ganze Tage; mit Uhrzeit
-- ist der Tag nur teilweise abwesend und p_stunden Pflicht.
create or replace function public.pep_abwesenheit_setzen(
  p_mitarbeiter_id bigint, p_code_id bigint, p_von date, p_bis date,
  p_stunden numeric, p_von_zeit time, p_bis_zeit time, p_notiz text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
begin
  if not v_m.aktiv then
    raise exception 'MITARBEITER_INAKTIV';
  end if;
  return pep.abwesenheit_schreiben(v_b.filiale_id, v_m.id, p_code_id, p_von, p_bis, p_stunden,
    p_von_zeit, p_bis_zeit, 'manuell', null, null, p_notiz, v_b.user_id);
end;
$$;

-- Liefert die Zahl der gelöschten Tage.
create or replace function public.pep_abwesenheit_loeschen(p_mitarbeiter_id bigint, p_von date, p_bis date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m      pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_anzahl int;
  v_freigaben bigint[];
begin
  if p_von is null or p_bis is null or p_bis < p_von then
    raise exception 'ZEITRAUM_UNGUELTIG';
  end if;
  with d as (
    delete from pep.abwesenheiten
     where mitarbeiter_id = v_m.id and filiale_id = v_b.filiale_id and datum between p_von and p_bis
    returning freigabe_id)
  select count(*), array_agg(distinct freigabe_id) filter (where freigabe_id is not null)
    into v_anzahl, v_freigaben from d;
  -- Freigaben ohne verbleibende Tage gelten als abgelehnt.
  update pep.urlaub_freigaben f
     set status = 'abgelehnt', entschieden_von = v_b.user_id, entschieden_am = now()
   where f.id = any (v_freigaben) and f.status = 'genehmigt'
     and not exists (select 1 from pep.abwesenheiten a where a.freigabe_id = f.id);
  perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'abwesenheiten', v_m.id::text, null,
    jsonb_build_object('von', p_von, 'bis', p_bis, 'tage', v_anzahl));
  return v_anzahl;
end;
$$;

-- p_daten: id (zum Ändern), code_id, wochentag (1–7), von_datum, bis_datum, von, bis, stunden, notiz,
-- schulferien_aussetzen (Standard true; beim Ändern bleibt der bisherige Wert, wenn der Schlüssel fehlt).
-- Ändern löscht die künftigen Tage der Regel und erzeugt sie neu.
create or replace function public.pep_wiederholung_speichern(p_mitarbeiter_id bigint, p_daten jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m    pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_id   bigint := (p_daten ->> 'id')::bigint;
  v_code bigint := (p_daten ->> 'code_id')::bigint;
  v_wt   int := (p_daten ->> 'wochentag')::int;
  v_von  date := (p_daten ->> 'von_datum')::date;
  v_bis  date := (p_daten ->> 'bis_datum')::date;
  v_vz   time := (p_daten ->> 'von')::time;
  v_bz   time := (p_daten ->> 'bis')::time;
  v_std  numeric := (p_daten ->> 'stunden')::numeric;
  v_ferien boolean := (p_daten ->> 'schulferien_aussetzen')::boolean;
  v_regel text;
  v_alt  pep.wiederholungen;
  v_neu  pep.wiederholungen;
begin
  if not v_m.aktiv then
    raise exception 'MITARBEITER_INAKTIV';
  end if;
  if v_wt is null or v_wt not between 1 and 7 then
    raise exception 'WOCHENTAG_UNGUELTIG';
  end if;
  if v_von is null or v_bis is null or v_bis < v_von or v_bis < pep.heute() then
    raise exception 'ZEITRAUM_UNGUELTIG';
  end if;
  if v_bis > (v_von + interval '12 months')::date then
    raise exception 'ZEITRAUM_ZU_LANG';
  end if;
  select stundenregel into v_regel from pep.abwesenheitscodes
   where id = v_code and filiale_id = v_b.filiale_id and aktiv;
  if not found then
    raise exception 'CODE_NICHT_GEFUNDEN';
  end if;
  perform pep.abwesenheit_zeiten_pruefen(v_vz, v_bz, v_std);
  if v_std is null and v_regel = 'tatsaechlich' then
    raise exception 'STUNDEN_FEHLEN';
  end if;
  if v_std is not null and (v_std > 24 or v_std < 0 or (v_std = 0 and (v_regel = 'tatsaechlich' or v_vz is not null))) then
    raise exception 'STUNDEN_UNGUELTIG';
  end if;

  if v_id is null then
    insert into pep.wiederholungen (filiale_id, mitarbeiter_id, code_id, wochentag, von_datum, bis_datum,
                                    von, bis, stunden, notiz, schulferien_aussetzen)
    values (v_b.filiale_id, v_m.id, v_code, v_wt, v_von, v_bis, v_vz, v_bz, v_std, p_daten ->> 'notiz',
            coalesce(v_ferien, true))
    returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'wiederholungen', v_neu.id::text, null, to_jsonb(v_neu));
  else
    select * into v_alt from pep.wiederholungen
     where id = v_id and mitarbeiter_id = v_m.id and filiale_id = v_b.filiale_id;
    if not found then
      raise exception 'WIEDERHOLUNG_NICHT_GEFUNDEN';
    end if;
    delete from pep.abwesenheiten where wiederholung_id = v_id and datum >= pep.heute();
    update pep.wiederholungen
       set code_id = v_code, wochentag = v_wt, von_datum = v_von, bis_datum = v_bis,
           von = v_vz, bis = v_bz, stunden = v_std, notiz = p_daten ->> 'notiz',
           schulferien_aussetzen = coalesce(v_ferien, v_alt.schulferien_aussetzen)
     where id = v_id returning * into v_neu;
    perform pep.protokolliere(v_b.filiale_id, 'aendern', 'wiederholungen', v_neu.id::text, to_jsonb(v_alt), to_jsonb(v_neu));
  end if;
  perform pep.wiederholung_erzeugen(v_neu, v_b.user_id);
  return v_neu.id;
end;
$$;

-- Künftige Tage der Regel verschwinden; vergangene bleiben ohne Verweis auf die Regel.
create or replace function public.pep_wiederholung_loeschen(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung_oder_stellvertretung();
  v_alt pep.wiederholungen;
begin
  select * into v_alt from pep.wiederholungen where id = p_id and filiale_id = v_b.filiale_id;
  if not found then
    raise exception 'WIEDERHOLUNG_NICHT_GEFUNDEN';
  end if;
  delete from pep.abwesenheiten where wiederholung_id = p_id and datum >= pep.heute();
  update pep.abwesenheiten set wiederholung_id = null where wiederholung_id = p_id;
  delete from pep.wiederholungen where id = p_id;
  perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'wiederholungen', p_id::text, to_jsonb(v_alt), null);
end;
$$;

-- Monatsdaten für die Abwesenheitsansicht (Leitung und Stellvertretung).
create or replace function public.pep_abwesenheiten(p_jahr int, p_monat int)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung_oder_stellvertretung();
  v_f   bigint := v_b.filiale_id;
  v_von date;
  v_bis date;
  v_ids bigint[];
begin
  if p_jahr is null or p_monat is null or p_jahr not between 2000 and 2100 or p_monat not between 1 and 12 then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  v_von := make_date(p_jahr, p_monat, 1);
  v_bis := (v_von + interval '1 month' - interval '1 day')::date;

  select array_agg(m.id order by m.aktiv desc, m.position, m.name, m.id) into v_ids
    from pep.mitarbeiter m
   where m.filiale_id = v_f
     and (m.aktiv or exists (select 1 from pep.abwesenheiten a
                              where a.mitarbeiter_id = m.id and a.datum between v_von and v_bis));

  return jsonb_build_object(
    'tage', coalesce((
      select jsonb_agg(jsonb_build_object(
               'datum', d.tag,
               'wochentag', extract(isodow from d.tag)::int,
               'kw', extract(week from d.tag)::int,
               'geoeffnet', s.geoeffnet,
               'feiertag', s.feiertag,
               'schulferien', (select sf.name from pep.schulferien sf
                                where sf.filiale_id = v_f and d.tag between sf.von and sf.bis
                                order by sf.von, sf.id limit 1))
             order by d.tag)
        from (select v_von + i as tag from generate_series(0, v_bis - v_von) i) d
        cross join lateral pep.tag_status(v_f, d.tag) s), '[]'::jsonb),
    'mitarbeiter', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'name', m.name,
               'aktiv', m.aktiv,
               'wochenstunden', (select x.wochenstunden from pep.vertraege x
                                  where x.mitarbeiter_id = m.id and x.gueltig_ab <= v_von
                                  order by x.gueltig_ab desc limit 1),
               'tage', coalesce((
                  select jsonb_object_agg(a.datum::text, jsonb_build_object(
                           'id', a.id, 'code', c.code, 'code_id', a.code_id, 'stunden', a.stunden,
                           'von', a.von, 'bis', a.bis, 'quelle', a.quelle,
                           'freigabe_id', a.freigabe_id, 'wiederholung_id', a.wiederholung_id, 'notiz', a.notiz,
                           'wunsch_geaendert', coalesce(fg.status = 'genehmigt' and not pep.wunsch_vorhanden(fg.wunsch), false)))
                    from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
                    left join pep.urlaub_freigaben fg on fg.id = a.freigabe_id
                   where a.mitarbeiter_id = m.id and a.datum between v_von and v_bis), '{}'::jsonb))
             order by u.ord)
        from unnest(v_ids) with ordinality u(id, ord)
        join pep.mitarbeiter m on m.id = u.id), '[]'::jsonb),
    'summen', coalesce((
      select jsonb_object_agg(s.datum::text, s.summe)
        from (select a.datum, sum(a.stunden) as summe from pep.abwesenheiten a
               where a.filiale_id = v_f and a.datum between v_von and v_bis
               group by a.datum) s), '{}'::jsonb),
    'codes', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'farbe', c.farbe,
                                          'stundenregel', c.stundenregel, 'sperrt', c.sperrt)
                       order by c.position, c.id)
        from pep.abwesenheitscodes c where c.filiale_id = v_f and c.aktiv), '[]'::jsonb),
    'wuensche', coalesce((
      select jsonb_agg(jsonb_build_object(
               'mitarbeiter_id', w.mitarbeiter_id, 'art', w.art, 'kw', w.kw, 'von', w.von, 'bis', w.bis,
               'status', coalesce(fg.status, 'offen'), 'freigabe_id', fg.id,
               'umfrage_id', w.umfrage_id, 'urlaub_mitarbeiter_id', w.urlaub_mitarbeiter_id,
               'datum', case when w.art = 'tag' then to_char(w.von, 'YYYY-MM-DD') end)
             order by w.von, w.mitarbeiter_id, w.art)
        from pep.urlaubswuensche(v_f, v_von, v_bis) w
        left join lateral pep.freigabe_zum_wunsch(v_f,
          pep.wunsch_json(w.umfrage_id, w.urlaub_mitarbeiter_id, w.art, w.kw,
                          case when w.art = 'tag' then w.von end)) fg on true), '[]'::jsonb),
    'urlaub', coalesce((
      select jsonb_agg(jsonb_build_object(
               'mitarbeiter_id', u.id,
               'anspruch', j.anspruch,
               'rest_vorjahr', j.rest_vorjahr,
               'genehmigt', j.genehmigt,
               'rest', j.anspruch + j.rest_vorjahr - j.genehmigt)
             order by u.ord)
        from unnest(v_ids) with ordinality u(id, ord)
        cross join lateral (
          select coalesce((select y.anspruch_stunden from pep.urlaubsjahre y
                            where y.mitarbeiter_id = u.id and y.jahr = p_jahr), 0) as anspruch,
                 coalesce((select y.rest_vorjahr_stunden from pep.urlaubsjahre y
                            where y.mitarbeiter_id = u.id and y.jahr = p_jahr), 0) as rest_vorjahr,
                 coalesce((select sum(a.stunden) from pep.abwesenheiten a
                             join pep.abwesenheitscodes c on c.id = a.code_id
                            where a.mitarbeiter_id = u.id and c.code = 'U'
                              and a.datum >= make_date(p_jahr, 1, 1)
                              and a.datum < make_date(p_jahr + 1, 1, 1)), 0) as genehmigt) j), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Urlaubstool-Anbindung: Tabellen
-- ---------------------------------------------------------------------------

-- Umfragen des Urlaubstools, die diese Filiale als Urlaubswünsche liest.
create table if not exists pep.urlaub_umfragen (
  filiale_id bigint not null references pep.filialen (id) on delete cascade,
  umfrage_id bigint primary key references urlaub.umfragen (id) on delete cascade
);

-- Teilnehmer der Umfrage -> Mitarbeiter der Filiale (null/fehlt = nicht zugeordnet).
create table if not exists pep.urlaub_zuordnung (
  urlaub_mitarbeiter_id bigint primary key references urlaub.mitarbeiter (id) on delete cascade,
  mitarbeiter_id        bigint references pep.mitarbeiter (id) on delete cascade,
  filiale_id            bigint not null references pep.filialen (id) on delete cascade
);

-- Entscheidung über einen Wunsch. wunsch = {umfrage_id, urlaub_mitarbeiter_id, art, kw, datum}
-- (Schnappschuss, ohne Fremdschlüssel: Freigaben überleben das Löschen der Umfrage).
create table if not exists pep.urlaub_freigaben (
  id             bigint generated always as identity primary key,
  filiale_id     bigint not null references pep.filialen (id) on delete cascade,
  mitarbeiter_id bigint not null references pep.mitarbeiter (id) on delete cascade,
  von            date not null,
  bis            date not null check (bis >= von),
  status         text not null check (status in ('offen', 'genehmigt', 'abgelehnt')),
  wunsch         jsonb not null,
  entschieden_von uuid,
  entschieden_am timestamptz,
  notiz          text
);
create index if not exists urlaub_freigaben_filiale_idx on pep.urlaub_freigaben (filiale_id, mitarbeiter_id);

alter table pep.urlaub_umfragen  enable row level security;
alter table pep.urlaub_zuordnung enable row level security;
alter table pep.urlaub_freigaben enable row level security;

-- abwesenheiten.freigabe_id wurde vor der Freigaben-Tabelle angelegt: Fremdschlüssel nachträglich.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'abwesenheiten_freigabe_fk') then
    alter table pep.abwesenheiten add constraint abwesenheiten_freigabe_fk
      foreign key (freigabe_id) references pep.urlaub_freigaben (id) on delete set null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Urlaubstool-Anbindung: interne Funktionen
-- ---------------------------------------------------------------------------

-- Kanonischer Schnappschuss eines Wunsches (Vergleich per jsonb-Gleichheit).
create or replace function pep.wunsch_json(
  p_umfrage_id bigint, p_urlaub_mitarbeiter_id bigint, p_art text, p_kw int, p_datum date)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('umfrage_id', p_umfrage_id, 'urlaub_mitarbeiter_id', p_urlaub_mitarbeiter_id,
                            'art', p_art, 'kw', p_kw,
                            'datum', case when p_art = 'tag' then to_char(p_datum, 'YYYY-MM-DD') end)
$$;

-- Prüft einen vom Browser gelieferten Wunsch und liefert ihn kanonisch (WUNSCH_UNGUELTIG).
-- Die Umfrage muss für die Filiale eingeschaltet sein, der Teilnehmer ihr Teilnehmer und dem
-- Mitarbeiter zugeordnet, und der Wunsch muss in seiner aktuellen Antwort stehen.
create or replace function pep.wunsch_normalisieren(p_filiale_id bigint, p_mitarbeiter_id bigint, p_wunsch jsonb)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_art   text;
  v_umf   bigint;
  v_tn    bigint;
  v_kw    int;
  v_datum date;
  v_json  jsonb;
begin
  if p_wunsch is null or jsonb_typeof(p_wunsch) <> 'object' then
    raise exception 'WUNSCH_UNGUELTIG';
  end if;
  begin
    v_art := p_wunsch ->> 'art';
    v_umf := (p_wunsch ->> 'umfrage_id')::bigint;
    v_tn  := (p_wunsch ->> 'urlaub_mitarbeiter_id')::bigint;
    if v_art = 'kw' then
      v_kw := (p_wunsch ->> 'kw')::int;
    elsif v_art = 'tag' then
      v_datum := (p_wunsch ->> 'datum')::date;
    end if;
  exception when invalid_text_representation or numeric_value_out_of_range
                 or invalid_datetime_format or datetime_field_overflow then
    raise exception 'WUNSCH_UNGUELTIG';
  end;
  if v_umf is null or v_tn is null or v_art is null
     or (v_art = 'kw' and v_kw is null) or (v_art = 'tag' and v_datum is null)
     or v_art not in ('kw', 'tag') then
    raise exception 'WUNSCH_UNGUELTIG';
  end if;
  if not exists (select 1 from pep.urlaub_umfragen s
                   join urlaub.mitarbeiter t on t.umfrage_id = s.umfrage_id
                  where s.filiale_id = p_filiale_id and s.umfrage_id = v_umf and t.id = v_tn) then
    raise exception 'WUNSCH_UNGUELTIG';
  end if;
  if not exists (select 1 from pep.urlaub_zuordnung z
                  where z.urlaub_mitarbeiter_id = v_tn and z.mitarbeiter_id = p_mitarbeiter_id
                    and z.filiale_id = p_filiale_id) then
    raise exception 'WUNSCH_UNGUELTIG';
  end if;
  v_json := pep.wunsch_json(v_umf, v_tn, v_art, v_kw, v_datum);
  if not pep.wunsch_vorhanden(v_json) then
    raise exception 'WUNSCH_UNGUELTIG';
  end if;
  return v_json;
end;
$$;

-- Zeitraum eines kanonischen Wunsches: KW = Montag bis Samstag, Tag = der Tag (null, wenn die KW fehlt).
create or replace function pep.wunsch_zeitraum(p_wunsch jsonb)
returns table (von date, bis date)
language sql stable
set search_path = ''
as $$
  select (p_wunsch ->> 'datum')::date, (p_wunsch ->> 'datum')::date where p_wunsch ->> 'art' = 'tag'
  union all
  select k.montag, k.montag + 5
    from urlaub.kalender((p_wunsch ->> 'umfrage_id')::bigint) k
   where p_wunsch ->> 'art' = 'kw' and k.kw = (p_wunsch ->> 'kw')::int
$$;

-- Steht der Wunsch noch in der aktuellen Antwort des Teilnehmers (Abgabe vorhanden)?
create or replace function pep.wunsch_vorhanden(p_wunsch jsonb)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
      from urlaub.abgaben ab
      join urlaub.fragen f on f.umfrage_id = (p_wunsch ->> 'umfrage_id')::bigint and f.typ = 'urlaubswochen'
      join urlaub.antworten an on an.mitarbeiter_id = ab.mitarbeiter_id and an.frage_id = f.id
     where ab.mitarbeiter_id = (p_wunsch ->> 'urlaub_mitarbeiter_id')::bigint
       and case p_wunsch ->> 'art'
             when 'kw'  then (p_wunsch ->> 'kw')::int = any (urlaub.antwort_wochen(an.wert))
             when 'tag' then (p_wunsch ->> 'datum')::date = any (urlaub.antwort_tage(an.wert))
             else false
           end)
$$;

-- Die Freigabe zu einem (kanonischen) Wunsch; genehmigte vor anderen, sonst die jüngste.
create or replace function pep.freigabe_zum_wunsch(p_filiale_id bigint, p_wunsch jsonb)
returns pep.urlaub_freigaben
language sql stable
set search_path = ''
as $$
  select f.* from pep.urlaub_freigaben f
   where f.filiale_id = p_filiale_id and f.wunsch = p_wunsch
   order by (f.status = 'genehmigt') desc, f.id desc
   limit 1
$$;

-- Wünsche aus den Antworten der eingeschalteten Umfragen: nur zugeordnete Teilnehmer mit
-- Abgabe, nur Wünsche, die [p_von, p_bis] schneiden. Eine KW gilt Montag bis Samstag.
create or replace function pep.urlaubswuensche(p_filiale_id bigint, p_von date, p_bis date)
returns table (mitarbeiter_id bigint, umfrage_id bigint, urlaub_mitarbeiter_id bigint,
               art text, kw int, von date, bis date)
language sql stable
set search_path = ''
as $$
  select z.mitarbeiter_id, s.umfrage_id, t.id, w.art, w.kw, w.von, w.bis
    from pep.urlaub_umfragen s
    join urlaub.mitarbeiter t on t.umfrage_id = s.umfrage_id
    join pep.urlaub_zuordnung z on z.urlaub_mitarbeiter_id = t.id and z.mitarbeiter_id is not null
                              and z.filiale_id = s.filiale_id
    join urlaub.abgaben ab on ab.mitarbeiter_id = t.id
    join urlaub.fragen f on f.umfrage_id = s.umfrage_id and f.typ = 'urlaubswochen'
    join urlaub.antworten an on an.mitarbeiter_id = t.id and an.frage_id = f.id
    cross join lateral (
      select 'kw'::text as art, k.kw::int as kw, k.montag as von, (k.montag + 5) as bis
        from urlaub.kalender(s.umfrage_id) k
       where k.kw = any (urlaub.antwort_wochen(an.wert))
      union all
      select 'tag'::text, null::int, d, d from unnest(urlaub.antwort_tage(an.wert)) d
    ) w
   where s.filiale_id = p_filiale_id and w.bis >= p_von and w.von <= p_bis
   order by w.von, z.mitarbeiter_id, w.art
$$;

-- ---------------------------------------------------------------------------
-- Urlaubstool-Anbindung: Funktionen für den Browser
-- ---------------------------------------------------------------------------

-- Umfragen mit Urlaubswochen-Frage: die eigenen des Aufrufers sowie die für die Filiale eingeschalteten.
create or replace function public.pep_urlaub_umfragen()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_f bigint := (pep.leitung_oder_stellvertretung()).filiale_id;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id, 'titel', u.titel, 'jahr', f.jahr, 'bundesland', f.bundesland, 'frist', u.frist,
             'aktiv', exists (select 1 from pep.urlaub_umfragen s where s.umfrage_id = u.id and s.filiale_id = v_f),
             'teilnehmer', (select count(*) from urlaub.mitarbeiter t where t.umfrage_id = u.id),
             'abgaben', (select count(*) from urlaub.mitarbeiter t
                          join urlaub.abgaben ab on ab.mitarbeiter_id = t.id where t.umfrage_id = u.id))
           order by u.angelegt_am desc, u.id desc)
      from urlaub.umfragen u
      join urlaub.fragen f on f.umfrage_id = u.id and f.typ = 'urlaubswochen'
     where u.organisator_id = auth.uid()
        or exists (select 1 from pep.urlaub_umfragen s where s.umfrage_id = u.id and s.filiale_id = v_f)), '[]'::jsonb);
end;
$$;

create or replace function public.pep_urlaub_umfrage_schalten(p_umfrage_id bigint, p_aktiv boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.leitung();
begin
  if p_aktiv is null then
    raise exception 'WERT_UNGUELTIG';
  end if;
  -- Einschalten nur für die eigenen Umfragen; Ausschalten darf die Leitung der Filiale,
  -- solange die Umfrage für die Filiale eingeschaltet ist (auch wenn der Eigentümer weg ist).
  if not exists (select 1 from urlaub.umfragen u
                   join urlaub.fragen f on f.umfrage_id = u.id and f.typ = 'urlaubswochen'
                  where u.id = p_umfrage_id
                    and case when p_aktiv then u.organisator_id = v_b.user_id
                             else exists (select 1 from pep.urlaub_umfragen s
                                           where s.umfrage_id = u.id and s.filiale_id = v_b.filiale_id)
                         end) then
    raise exception 'UMFRAGE_NICHT_GEFUNDEN';
  end if;
  if p_aktiv then
    insert into pep.urlaub_umfragen (filiale_id, umfrage_id) values (v_b.filiale_id, p_umfrage_id)
      on conflict (umfrage_id) do nothing;
  else
    delete from pep.urlaub_umfragen where umfrage_id = p_umfrage_id and filiale_id = v_b.filiale_id;
  end if;
  perform pep.protokolliere(v_b.filiale_id, 'schalten', 'urlaub_umfragen', p_umfrage_id::text, null,
    jsonb_build_object('aktiv', p_aktiv));
end;
$$;

-- Teilnehmer der eingeschalteten Umfragen mit Zuordnung und Namensvorschlag.
create or replace function public.pep_urlaub_zuordnung()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_f bigint := (pep.leitung_oder_stellvertretung()).filiale_id;
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'urlaub_mitarbeiter_id', t.id, 'umfrage_id', u.id, 'umfrage_titel', u.titel, 'name', t.name,
             'mitarbeiter_id', z.mitarbeiter_id,
             'vorschlag_id', (select case when count(*) = 1 then min(m.id) end
                                from pep.mitarbeiter m
                               where m.filiale_id = v_f and m.aktiv
                                 and lower(regexp_replace(urlaub.trim_alles(m.name), '\s+', ' ', 'g'))
                                   = lower(regexp_replace(urlaub.trim_alles(t.name), '\s+', ' ', 'g'))))
           order by u.id, t.name, t.id)
      from pep.urlaub_umfragen s
      join urlaub.umfragen u on u.id = s.umfrage_id
      join urlaub.mitarbeiter t on t.umfrage_id = u.id
      left join pep.urlaub_zuordnung z on z.urlaub_mitarbeiter_id = t.id and z.filiale_id = s.filiale_id
     where s.filiale_id = v_f), '[]'::jsonb);
end;
$$;

-- p_mitarbeiter_id null löst die Zuordnung.
create or replace function public.pep_urlaub_zuordnung_setzen(p_urlaub_mitarbeiter_id bigint, p_mitarbeiter_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.leitung();
  v_m pep.mitarbeiter;
begin
  if not exists (select 1 from urlaub.mitarbeiter t
                   join pep.urlaub_umfragen s on s.umfrage_id = t.umfrage_id
                  where t.id = p_urlaub_mitarbeiter_id and s.filiale_id = v_b.filiale_id) then
    raise exception 'TEILNEHMER_NICHT_GEFUNDEN';
  end if;
  if p_mitarbeiter_id is null then
    delete from pep.urlaub_zuordnung where urlaub_mitarbeiter_id = p_urlaub_mitarbeiter_id;
  else
    v_m := pep.eigener_mitarbeiter(p_mitarbeiter_id);
    insert into pep.urlaub_zuordnung (urlaub_mitarbeiter_id, mitarbeiter_id, filiale_id)
    values (p_urlaub_mitarbeiter_id, v_m.id, v_b.filiale_id)
    on conflict (urlaub_mitarbeiter_id) do update set mitarbeiter_id = excluded.mitarbeiter_id;
  end if;
  perform pep.protokolliere(v_b.filiale_id, 'zuordnen', 'urlaub_zuordnung', p_urlaub_mitarbeiter_id::text, null,
    jsonb_build_object('mitarbeiter_id', p_mitarbeiter_id));
end;
$$;

-- Genehmigt einen Wunsch und schreibt die U-Tage (nur geöffnete Tage, Stunden nach Teiler-Regel).
-- Liefert die Freigabe-Id; eine frühere Ablehnung desselben Wunsches wird wiederverwendet.
create or replace function public.pep_urlaub_freigeben(
  p_mitarbeiter_id bigint, p_von date, p_bis date, p_wunsch jsonb, p_notiz text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung();
  v_m      pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_wunsch jsonb;
  v_alt    pep.urlaub_freigaben;
  v_code   bigint;
  v_id     bigint;
  v_von    date;
  v_bis    date;
  v_w      record;
begin
  v_wunsch := pep.wunsch_normalisieren(v_b.filiale_id, v_m.id, p_wunsch);
  select * into v_w from pep.wunsch_zeitraum(v_wunsch);
  if v_w.von is null then
    raise exception 'WUNSCH_UNGUELTIG';
  end if;
  -- Ohne Angabe der ganze Wunsch; Kürzen erlaubt, Verlängern nicht.
  v_von := coalesce(p_von, v_w.von);
  v_bis := coalesce(p_bis, v_w.bis);
  if v_bis < v_von or v_von < v_w.von or v_bis > v_w.bis then
    raise exception 'ZEITRAUM_UNGUELTIG';
  end if;
  v_alt := pep.freigabe_zum_wunsch(v_b.filiale_id, v_wunsch);
  if v_alt.status = 'genehmigt' then
    raise exception 'FREIGABE_VORHANDEN';
  end if;
  select c.id into v_code from pep.abwesenheitscodes c
   where c.filiale_id = v_b.filiale_id and c.code = 'U' and c.aktiv;
  if v_code is null then
    raise exception 'CODE_NICHT_GEFUNDEN';
  end if;
  if v_alt.id is null then
    insert into pep.urlaub_freigaben (filiale_id, mitarbeiter_id, von, bis, status, wunsch,
                                      entschieden_von, entschieden_am, notiz)
    values (v_b.filiale_id, v_m.id, v_von, v_bis, 'genehmigt', v_wunsch, v_b.user_id, now(), p_notiz)
    returning id into v_id;
  else
    update pep.urlaub_freigaben
       set mitarbeiter_id = v_m.id, von = v_von, bis = v_bis, status = 'genehmigt',
           entschieden_von = v_b.user_id, entschieden_am = now(), notiz = p_notiz
     where id = v_alt.id;
    v_id := v_alt.id;
  end if;
  perform pep.abwesenheit_schreiben(v_b.filiale_id, v_m.id, v_code, v_von, v_bis, null, null, null,
    'urlaubstool', null, v_id, p_notiz, v_b.user_id);
  perform pep.protokolliere(v_b.filiale_id, 'freigeben', 'urlaub_freigaben', v_id::text, to_jsonb(v_alt),
    jsonb_build_object('mitarbeiter_id', v_m.id, 'von', v_von, 'bis', v_bis, 'wunsch', v_wunsch));
  return v_id;
end;
$$;

-- Lehnt einen Wunsch ab (keine Tage). Liefert die Freigabe-Id.
create or replace function public.pep_urlaub_ablehnen(p_mitarbeiter_id bigint, p_wunsch jsonb, p_notiz text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung();
  v_m      pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_wunsch jsonb;
  v_alt    pep.urlaub_freigaben;
  v_id     bigint;
  v_von    date;
  v_bis    date;
begin
  v_wunsch := pep.wunsch_normalisieren(v_b.filiale_id, v_m.id, p_wunsch);
  v_alt := pep.freigabe_zum_wunsch(v_b.filiale_id, v_wunsch);
  if v_alt.status = 'genehmigt' then
    raise exception 'FREIGABE_VORHANDEN';
  end if;
  select z.von, z.bis into v_von, v_bis from pep.wunsch_zeitraum(v_wunsch) z;
  if v_von is null then
    raise exception 'WUNSCH_UNGUELTIG';
  end if;
  if v_alt.id is null then
    insert into pep.urlaub_freigaben (filiale_id, mitarbeiter_id, von, bis, status, wunsch,
                                      entschieden_von, entschieden_am, notiz)
    values (v_b.filiale_id, v_m.id, v_von, v_bis, 'abgelehnt', v_wunsch, v_b.user_id, now(), p_notiz)
    returning id into v_id;
  else
    update pep.urlaub_freigaben
       set mitarbeiter_id = v_m.id, von = v_von, bis = v_bis, status = 'abgelehnt',
           entschieden_von = v_b.user_id, entschieden_am = now(), notiz = p_notiz
     where id = v_alt.id;
    v_id := v_alt.id;
  end if;
  perform pep.protokolliere(v_b.filiale_id, 'ablehnen', 'urlaub_freigaben', v_id::text, to_jsonb(v_alt),
    jsonb_build_object('mitarbeiter_id', v_m.id, 'wunsch', v_wunsch));
  return v_id;
end;
$$;

-- Löscht die U-Tage der Freigabe und setzt sie auf abgelehnt. Liefert die Zahl gelöschter Tage.
create or replace function public.pep_freigabe_zuruecknehmen(p_freigabe_id bigint)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung();
  v_f      pep.urlaub_freigaben;
  v_anzahl int;
begin
  select * into v_f from pep.urlaub_freigaben where id = p_freigabe_id and filiale_id = v_b.filiale_id;
  if not found then
    raise exception 'FREIGABE_NICHT_GEFUNDEN';
  end if;
  delete from pep.abwesenheiten where freigabe_id = v_f.id and filiale_id = v_b.filiale_id;
  get diagnostics v_anzahl = row_count;
  update pep.urlaub_freigaben
     set status = 'abgelehnt', entschieden_von = v_b.user_id, entschieden_am = now()
   where id = v_f.id;
  perform pep.protokolliere(v_b.filiale_id, 'zuruecknehmen', 'urlaub_freigaben', v_f.id::text, to_jsonb(v_f),
    jsonb_build_object('tage', v_anzahl));
  return v_anzahl;
end;
$$;

-- ---------------------------------------------------------------------------
-- Einsatzplan: Tabellen
-- ---------------------------------------------------------------------------

-- Bestehende Filialen: KA → kasse, VP → vp, solange die Filiale diese Bedeutung noch nicht vergeben hat.
update pep.bereiche b
   set bedeutung = x.bedeutung
  from (values ('KA', 'kasse'), ('VP', 'vp')) x (kuerzel, bedeutung)
 where b.kuerzel = x.kuerzel and b.bedeutung is null
   and not exists (select 1 from pep.bereiche y where y.filiale_id = b.filiale_id and y.bedeutung = x.bedeutung);

-- Zusammenhängende Zeit eines Mitarbeiters in einem Bereich. Nie zwei überlappende Blöcke
-- desselben Mitarbeiters am selben Tag (Trigger unten; btree_gist steht nicht überall bereit).
-- „Unbesetzt“ wird nicht gespeichert, sondern aus den Abwesenheiten berechnet (pep.unbesetzt).
create table if not exists pep.plan_bloecke (
  id             bigint generated always as identity primary key,
  filiale_id     bigint not null references pep.filialen (id) on delete cascade,
  mitarbeiter_id bigint not null references pep.mitarbeiter (id) on delete cascade,
  datum          date not null,
  von            time not null,
  bis            time not null,
  bereich_id     bigint not null references pep.bereiche (id),
  angelegt_von   uuid,
  geaendert_am   timestamptz not null default now(),
  check (extract(minute from von) in (0, 30) and extract(second from von) = 0
     and extract(minute from bis) in (0, 30) and extract(second from bis) = 0),
  check (von < bis)
);
create index if not exists plan_bloecke_filiale_datum_idx on pep.plan_bloecke (filiale_id, datum);
create index if not exists plan_bloecke_mitarbeiter_datum_idx on pep.plan_bloecke (mitarbeiter_id, datum);

-- Ein Kommentar je Mitarbeiter und Tag (Kommentarfeld rechts im Raster).
create table if not exists pep.plan_kommentare (
  filiale_id     bigint not null references pep.filialen (id) on delete cascade,
  mitarbeiter_id bigint not null references pep.mitarbeiter (id) on delete cascade,
  datum          date not null,
  text           text not null check (char_length(text) between 1 and 200),
  primary key (mitarbeiter_id, datum)
);
create index if not exists plan_kommentare_filiale_datum_idx on pep.plan_kommentare (filiale_id, datum);

-- Eckdaten einer ISO-Woche für die Vorausplanung.
create table if not exists pep.wochen (
  filiale_id                bigint not null references pep.filialen (id) on delete cascade,
  jahr                      int not null,
  kw                        int not null check (kw between 1 and 53),
  planumsatz                numeric(12,2),
  stundenleistung_eur_pro_h numeric(8,2),
  stundenvorgabe_manuell    numeric(7,2),
  primary key (filiale_id, jahr, kw)
);

-- Gespeicherte Tages- oder Wochenpläne (Blöcke ohne Datum).
create table if not exists pep.vorlagen (
  id          bigint generated always as identity primary key,
  filiale_id  bigint not null references pep.filialen (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  art         text not null check (art in ('tag', 'woche')),
  daten       jsonb not null,
  angelegt_am timestamptz not null default now(),
  unique (filiale_id, name)
);

alter table pep.plan_bloecke    enable row level security;
alter table pep.plan_kommentare enable row level security;
alter table pep.wochen          enable row level security;
alter table pep.vorlagen        enable row level security;

create or replace function pep.bloecke_ohne_ueberlappung()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from pep.plan_bloecke b
              where b.mitarbeiter_id = new.mitarbeiter_id and b.datum = new.datum and b.id <> new.id
                and b.von < new.bis and b.bis > new.von) then
    raise exception 'UEBERLAPPUNG';
  end if;
  return new;
end;
$$;

drop trigger if exists bloecke_ohne_ueberlappung on pep.plan_bloecke;
create trigger bloecke_ohne_ueberlappung
  before insert or update on pep.plan_bloecke
  for each row execute function pep.bloecke_ohne_ueberlappung();

-- ---------------------------------------------------------------------------
-- Einsatzplan: interne Funktionen
-- ---------------------------------------------------------------------------

-- Zeilen und Blöcke als JSON: Zeile = [{von, bis, bereich_id}] mit Uhrzeiten "HH:MI", nach von sortiert.
create or replace function pep.block_json(p_von time, p_bis time, p_bereich_id bigint)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object('von', to_char(p_von, 'HH24:MI'), 'bis', to_char(p_bis, 'HH24:MI'),
                            'bereich_id', p_bereich_id)
$$;

-- Prüft die Uhrzeiten eines Strichs oder Blocks.
create or replace function pep.plan_zeiten_pruefen(p_von time, p_bis time)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_von is null or p_bis is null then
    raise exception 'ZEITEN_UNGUELTIG';
  end if;
  if extract(minute from p_von) not in (0, 30) or extract(second from p_von) <> 0
     or extract(minute from p_bis) not in (0, 30) or extract(second from p_bis) <> 0 then
    raise exception 'HALBE_STUNDE';
  end if;
  if p_von >= p_bis then
    raise exception 'ZEITEN_UNGUELTIG';
  end if;
end;
$$;

-- Sortiert eine Zeile und verschmilzt aneinandergrenzende Blöcke desselben Bereichs.
-- Überlappungen bleiben stehen (der Trigger lehnt sie beim Schreiben ab).
create or replace function pep.bloecke_normalisieren(p_bloecke jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_erg jsonb := '[]'::jsonb;
  v_von time;
  v_bis time;
  v_ber bigint;
  r     record;
begin
  for r in select (e ->> 'von')::time as von, (e ->> 'bis')::time as bis, (e ->> 'bereich_id')::bigint as bereich_id
             from jsonb_array_elements(coalesce(p_bloecke, '[]'::jsonb)) e
            order by 1, 2 loop
    if v_von is not null and r.von = v_bis and r.bereich_id = v_ber then
      v_bis := r.bis;
    else
      if v_von is not null then
        v_erg := v_erg || jsonb_build_array(pep.block_json(v_von, v_bis, v_ber));
      end if;
      v_von := r.von;
      v_bis := r.bis;
      v_ber := r.bereich_id;
    end if;
  end loop;
  if v_von is not null then
    v_erg := v_erg || jsonb_build_array(pep.block_json(v_von, v_bis, v_ber));
  end if;
  return v_erg;
end;
$$;

-- Rein: alte Zeile plus Strich [p_von, p_bis) im Bereich p_bereich_id (NULL = radieren) ergibt die
-- neue Zeile. Getroffene Blöcke werden gekürzt oder geteilt, gleiche Nachbarn verschmolzen.
create or replace function pep.zeile_mit_strich(p_bloecke jsonb, p_von time, p_bis time, p_bereich_id bigint)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  v_teile jsonb := '[]'::jsonb;
  r       record;
begin
  for r in select (e ->> 'von')::time as von, (e ->> 'bis')::time as bis, (e ->> 'bereich_id')::bigint as bereich_id
             from jsonb_array_elements(coalesce(p_bloecke, '[]'::jsonb)) e loop
    if r.von < p_von then
      v_teile := v_teile || jsonb_build_array(pep.block_json(r.von, least(r.bis, p_von), r.bereich_id));
    end if;
    if r.bis > p_bis then
      v_teile := v_teile || jsonb_build_array(pep.block_json(greatest(r.von, p_bis), r.bis, r.bereich_id));
    end if;
  end loop;
  if p_bereich_id is not null then
    v_teile := v_teile || jsonb_build_array(pep.block_json(p_von, p_bis, p_bereich_id));
  end if;
  return pep.bloecke_normalisieren(v_teile);
end;
$$;

-- Die gespeicherte Zeile eines Mitarbeiters an einem Tag.
create or replace function pep.zeile_lesen(p_mitarbeiter_id bigint, p_datum date)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(pep.block_json(b.von, b.bis, b.bereich_id) order by b.von), '[]'::jsonb)
    from pep.plan_bloecke b
   where b.mitarbeiter_id = p_mitarbeiter_id and b.datum = p_datum
$$;

-- F2 (je halbe Stunde): Zerlegt [p_von, p_bis) an den Grenzen der sperrenden Abwesenheit des Tages
-- (ohne von/bis = ganzer Tag) in Abschnitte; unbesetzt ist genau der überschneidende Teil.
-- Einzige Stelle, die Abwesenheiten auf Planzeit abbildet (je Mitarbeiter und Tag gibt es höchstens eine).
create or replace function pep.abschnitte(p_mitarbeiter_id bigint, p_datum date, p_von time, p_bis time)
returns table (von time, bis time, unbesetzt boolean)
language sql stable
set search_path = ''
as $$
  with sperre as (
    select coalesce(a.von, time '00:00') as av, coalesce(a.bis, time '24:00') as ab
      from pep.abwesenheiten a
      join pep.abwesenheitscodes c on c.id = a.code_id
     where a.mitarbeiter_id = p_mitarbeiter_id and a.datum = p_datum and c.sperrt
     limit 1
  ), teile as (
    select p_von as v, least(p_bis, greatest(p_von, s.av)) as b, false as u from sperre s
    union all
    select greatest(p_von, s.av), least(p_bis, s.ab), true from sperre s
    union all
    select greatest(p_von, s.ab), p_bis, false from sperre s
    union all
    select p_von, p_bis, false where not exists (select 1 from sperre)
  )
  select t.v, t.b, t.u from teile t where t.v < t.b order by t.v
$$;

-- Ist irgendein Teil von [p_von, p_bis) unbesetzt? Für eine halbe Stunde = diese halbe Stunde ist unbesetzt.
create or replace function pep.unbesetzt(p_mitarbeiter_id bigint, p_datum date, p_von time, p_bis time)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from pep.abschnitte(p_mitarbeiter_id, p_datum, p_von, p_bis) x where x.unbesetzt)
$$;

-- F4: Arbeitsstunden einer Zeile = besetzte Zeit ohne Pause (je halbe Stunde nach F2).
create or replace function pep.arbeitsstunden(p_mitarbeiter_id bigint, p_datum date, p_bloecke jsonb)
returns numeric
language sql stable
set search_path = ''
as $$
  select round(coalesce(sum(extract(epoch from x.bis - x.von) / 3600), 0), 2)
    from jsonb_array_elements(coalesce(p_bloecke, '[]'::jsonb)) e
    join pep.bereiche b on b.id = (e ->> 'bereich_id')::bigint
    cross join lateral pep.abschnitte(p_mitarbeiter_id, p_datum, (e ->> 'von')::time, (e ->> 'bis')::time) x
   where b.art <> 'pause' and not x.unbesetzt
$$;

-- Halbe Stunden der Zeile p_neu, die gegenüber p_alt neu belegt sind (neu_belegt) oder den Bereich
-- wechseln. Nur sie prüfen die Sperren, damit spätere Änderungen an Einstellungen oder Stammdaten
-- (Kompetenz entzogen, Rahmen verkürzt, Vorgabe angelegt) nicht jeden weiteren Strich der Zeile blockieren.
-- p_alt = [] liefert die ganze Zeile.
create or replace function pep.zeile_aenderungen(p_alt jsonb, p_neu jsonb)
returns table (von time, bereich_id bigint, neu_belegt boolean)
language sql immutable
set search_path = ''
as $$
  select t::time, (e ->> 'bereich_id')::bigint,
         not exists (select 1 from jsonb_array_elements(coalesce(p_alt, '[]'::jsonb)) a
                      where (a ->> 'von')::time <= t::time and (a ->> 'bis')::time > t::time)
    from jsonb_array_elements(coalesce(p_neu, '[]'::jsonb)) e
    cross join lateral generate_series(date '2000-01-01' + (e ->> 'von')::time,
                                       date '2000-01-01' + (e ->> 'bis')::time - interval '30 minutes',
                                       interval '30 minutes') t
   where not exists (select 1 from jsonb_array_elements(coalesce(p_alt, '[]'::jsonb)) a
                      where (a ->> 'von')::time <= t::time and (a ->> 'bis')::time > t::time
                        and (a ->> 'bereich_id')::bigint = (e ->> 'bereich_id')::bigint)
$$;

-- Wochenvorgaben (p_pflicht: Pflicht oder bevorzugt), die der Wechsel von p_alt auf p_neu am Tag
-- verletzt; p_alt = [] prüft die ganze Zeile p_neu.
-- Zeitvorgaben (nicht_verfuegbar, nur_zwischen) zählen nur geänderte halbe Stunden (pep.zeile_aenderungen),
-- Stundengrenzen nur, wenn die Stunden steigen und danach über der Grenze liegen.
-- Unbesetzte Zeit zählt nicht (F2); Pausen zählen zur Anwesenheit, nicht zu den Stunden (F4).
-- nicht_verfuegbar mit von/bis sperrt den Zeitraum, ohne Uhrzeit den ganzen Tag. Ausnahme: ohne Uhrzeit,
-- aber mit Stundengrenze ist es eine reine Stundengrenze (so legt die Mitarbeiterkarte sie an, weil dort
-- die Art mit „Nicht verfügbar“ vorbelegt ist und Uhrzeiten nur bei „Nur zwischen“ erscheinen).
-- max_stunden_woche rechnet die ISO-Woche mit der neuen statt der gespeicherten Zeile des Tages.
drop function if exists pep.vorgaben_verletzt(bigint, date, jsonb, boolean);
create or replace function pep.vorgaben_verletzt(
  p_mitarbeiter_id bigint, p_datum date, p_alt jsonb, p_neu jsonb, p_pflicht boolean)
returns setof pep.wochenvorgaben
language plpgsql stable
set search_path = ''
as $$
declare
  v_slots    jsonb;
  v_tag_alt  numeric := pep.arbeitsstunden(p_mitarbeiter_id, p_datum, p_alt);
  v_tag_neu  numeric := pep.arbeitsstunden(p_mitarbeiter_id, p_datum, p_neu);
  v_rest     numeric;
  v_montag   date := p_datum - (extract(isodow from p_datum)::int - 1);
  v_w        pep.wochenvorgaben;
begin
  select coalesce(jsonb_agg(z.von), '[]'::jsonb) into v_slots
    from pep.zeile_aenderungen(p_alt, p_neu) z
   where not pep.unbesetzt(p_mitarbeiter_id, p_datum, z.von, z.von + interval '30 minutes');

  for v_w in select * from pep.wochenvorgaben w
              where w.mitarbeiter_id = p_mitarbeiter_id and w.pflicht = p_pflicht
                and w.gueltig_von <= p_datum and (w.gueltig_bis is null or w.gueltig_bis >= p_datum)
                and (w.wochentag is null or w.wochentag = extract(isodow from p_datum)::int)
              order by w.id loop
    if v_w.max_stunden_woche is not null and v_rest is null then
      v_rest := coalesce((
        select sum(pep.arbeitsstunden(p_mitarbeiter_id, d.tag, pep.zeile_lesen(p_mitarbeiter_id, d.tag)))
          from (select v_montag + i as tag from generate_series(0, 6) i) d
         where d.tag <> p_datum), 0);
    end if;
    if (v_w.art = 'nicht_verfuegbar' and v_w.von is null and v_w.bis is null
          and v_w.max_stunden_tag is null and v_w.max_stunden_woche is null
          and jsonb_array_length(v_slots) > 0)
       or (v_w.art = 'nicht_verfuegbar' and (v_w.von is not null or v_w.bis is not null)
          and exists (select 1 from jsonb_array_elements_text(v_slots) s
                       where s::time >= coalesce(v_w.von, time '00:00') and s::time < coalesce(v_w.bis, time '24:00')))
       or (v_w.art = 'nur_zwischen'
          and exists (select 1 from jsonb_array_elements_text(v_slots) s
                       where s::time < v_w.von or s::time >= v_w.bis))
       or (v_tag_neu > v_tag_alt and v_tag_neu > v_w.max_stunden_tag)
       or (v_tag_neu > v_tag_alt and v_rest + v_tag_neu > v_w.max_stunden_woche) then
      return next v_w;
    end if;
  end loop;
end;
$$;

-- Alle Sperren für den Wechsel der Zeile von p_alt auf p_neu (beide [{von, bis, bereich_id}]).
-- Reihenfolge der Prüfungen = Reihenfolge der Fehler. Uhrzeiten prüfen die Aufrufer (pep.plan_zeiten_pruefen).
-- Für die ganze Zeile: VERGANGEN, MITARBEITER_INAKTIV, KEIN_VERTRAG, GESCHLOSSEN. Rahmen, Bereich,
-- Kompetenz, Abwesenheit und Zeitvorgaben nur für geänderte halbe Stunden (pep.zeile_aenderungen),
-- Stundengrenzen nur bei steigenden Stunden. Eine unveränderte Zeile besteht daher immer.
-- Eine leere Zeile löscht nur; dafür genügt wie beim Radieren, dass der Tag nicht vergangen ist.
create or replace function pep.zeile_pruefen(
  p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date, p_alt jsonb, p_neu jsonb)
returns void
language plpgsql stable
set search_path = ''
as $$
declare
  v_m   pep.mitarbeiter;
  v_tag record;
  v_alt jsonb := coalesce(p_alt, '[]'::jsonb);
  v_neu jsonb := coalesce(p_neu, '[]'::jsonb);
begin
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if p_datum < pep.heute() then
    raise exception 'VERGANGEN';
  end if;
  select * into v_m from pep.mitarbeiter where id = p_mitarbeiter_id and filiale_id = p_filiale_id;
  if not found then
    raise exception 'MITARBEITER_NICHT_GEFUNDEN';
  end if;
  if jsonb_array_length(v_neu) = 0 then
    return;
  end if;
  if not v_m.aktiv or v_m.eintritt > p_datum or v_m.austritt < p_datum then
    raise exception 'MITARBEITER_INAKTIV';
  end if;
  perform pep.vertrag_am(p_mitarbeiter_id, p_datum); -- KEIN_VERTRAG
  select * into v_tag from pep.tag_status(p_filiale_id, p_datum);
  if not v_tag.geoeffnet then
    raise exception 'GESCHLOSSEN';
  end if;
  -- Halbe Stunden liegen auf :00/:30 wie der Rahmen: eine beginnt außerhalb, wenn vor rahmen_von oder ab rahmen_bis.
  if exists (select 1 from pep.zeile_aenderungen(v_alt, v_neu) z
              where z.von < v_tag.rahmen_von or z.von >= v_tag.rahmen_bis) then
    raise exception 'AUSSERHALB_RAHMEN';
  end if;
  if exists (select 1 from pep.zeile_aenderungen(v_alt, v_neu) z
              where not exists (select 1 from pep.bereiche b
                                 where b.id = z.bereich_id and b.filiale_id = p_filiale_id and b.aktiv)) then
    raise exception 'BEREICH_NICHT_GEFUNDEN';
  end if;
  if exists (select 1 from pep.zeile_aenderungen(v_alt, v_neu) z
               join pep.bereiche b on b.id = z.bereich_id
              where b.art = 'funktion') then
    raise exception 'BEREICH_NICHT_MALBAR';
  end if;
  if exists (select 1 from pep.zeile_aenderungen(v_alt, v_neu) z
               join pep.bereiche b on b.id = z.bereich_id
              where b.kompetenz_noetig
                and not exists (select 1 from pep.kompetenzen k
                                 where k.mitarbeiter_id = p_mitarbeiter_id and k.bereich_id = b.id)) then
    raise exception 'KOMPETENZ_FEHLT';
  end if;
  -- Geplante Blöcke dürfen nach einer Krankmeldung stehen bleiben (dann unbesetzt), aber nicht wachsen
  -- oder den Bereich wechseln.
  if exists (select 1 from pep.zeile_aenderungen(v_alt, v_neu) z
              where pep.unbesetzt(p_mitarbeiter_id, p_datum, z.von, z.von + interval '30 minutes')) then
    raise exception 'ABWESEND';
  end if;
  if exists (select 1 from pep.vorgaben_verletzt(p_mitarbeiter_id, p_datum, v_alt, v_neu, true)) then
    raise exception 'VORGABE_VERLETZT';
  end if;
end;
$$;

-- Ersetzt die Zeile (sortiert, verschmolzen) und protokolliert vorher/nachher. Unverändert = nichts zu tun.
-- Keine Prüfung außer der Überlappung: Aufrufer prüfen vorher mit pep.zeile_pruefen.
create or replace function pep.zeile_schreiben(
  p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date, p_bloecke jsonb, p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_vorher  jsonb;
  v_nachher jsonb := pep.bloecke_normalisieren(p_bloecke);
begin
  -- Schreibvorgänge desselben Mitarbeiters nacheinander (der Trigger sieht fremde offene Transaktionen nicht).
  perform 1 from pep.mitarbeiter where id = p_mitarbeiter_id for update;
  v_vorher := pep.zeile_lesen(p_mitarbeiter_id, p_datum);
  if v_vorher = v_nachher then
    return;
  end if;
  delete from pep.plan_bloecke where mitarbeiter_id = p_mitarbeiter_id and datum = p_datum;
  insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id, angelegt_von)
  select p_filiale_id, p_mitarbeiter_id, p_datum, (e ->> 'von')::time, (e ->> 'bis')::time,
         (e ->> 'bereich_id')::bigint, p_user_id
    from jsonb_array_elements(v_nachher) e;
  perform pep.protokolliere(p_filiale_id, 'setzen', 'plan_bloecke',
    p_mitarbeiter_id || ':' || to_char(p_datum, 'YYYY-MM-DD'), v_vorher, v_nachher);
end;
$$;

-- Blöcke für den Browser zwischen p_von und p_bis (p_mitarbeiter_ids null = alle der Filiale).
-- Ein gespeicherter Block wird an den Abwesenheitsgrenzen in Abschnitte mit derselben id und je
-- eigenem unbesetzt geteilt (F2).
drop function if exists pep.block_antwort(pep.plan_bloecke);
create or replace function pep.bloecke_antwort(p_filiale_id bigint, p_von date, p_bis date, p_mitarbeiter_ids bigint[])
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'mitarbeiter_id', b.mitarbeiter_id, 'datum', to_char(b.datum, 'YYYY-MM-DD'),
           'von', to_char(x.von, 'HH24:MI'), 'bis', to_char(x.bis, 'HH24:MI'), 'bereich_id', b.bereich_id,
           'unbesetzt', x.unbesetzt)
         order by b.datum, b.mitarbeiter_id, x.von), '[]'::jsonb)
    from pep.plan_bloecke b
    cross join lateral pep.abschnitte(b.mitarbeiter_id, b.datum, b.von, b.bis) x
   where b.filiale_id = p_filiale_id and b.datum between p_von and p_bis
     and (p_mitarbeiter_ids is null or b.mitarbeiter_id = any (p_mitarbeiter_ids))
$$;

-- pep.tag_antwort steht im Abschnitt „Regelprüfung“ (braucht pep.pruefung).

-- Montag der ISO-KW; DATUM_UNGUELTIG, wenn es die KW im ISO-Jahr nicht gibt (KW 53 nur in manchen Jahren).
create or replace function pep.kw_montag(p_jahr int, p_kw int)
returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v_4jan date;
  v_mo   date;
begin
  if p_jahr is null or p_kw is null or p_jahr not between 2000 and 2100 or p_kw not between 1 and 53 then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  v_4jan := make_date(p_jahr, 1, 4); -- liegt immer in KW 1
  v_mo := v_4jan - (extract(isodow from v_4jan)::int - 1) + (p_kw - 1) * 7;
  if extract(isoyear from v_mo)::int <> p_jahr or extract(week from v_mo)::int <> p_kw then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  return v_mo;
end;
$$;

-- Vertrag einer Woche: der am Montag gültige, sonst der erste, der in der Woche beginnt (sonst leer).
create or replace function pep.wochenvertrag(p_mitarbeiter_id bigint, p_montag date)
returns pep.vertraege
language sql stable
set search_path = ''
as $$
  select v.* from pep.vertraege v
   where v.mitarbeiter_id = p_mitarbeiter_id and v.gueltig_ab <= p_montag + 6
   order by v.gueltig_ab <= p_montag desc, abs(v.gueltig_ab - p_montag)
   limit 1
$$;

-- F6/F4 je Mitarbeiter und ISO-Woche: Vertrag der Woche (pep.wochenvertrag, NULL ohne Vertrag), angerechnete
-- Abwesenheitsstunden und geplante Arbeitsstunden (pep.arbeitsstunden: nur besetzt, ohne Pause). Soll = vertrag − abwesend
-- (wie wochenSummen in docs/plan-raster.js). Genutzt von Ersatzsuche und Eckdaten.
create or replace function pep.woche_stunden(p_mitarbeiter_id bigint, p_montag date)
returns table (vertrag numeric, abwesend numeric, geplant numeric)
language sql stable
set search_path = ''
as $$
  select (pep.wochenvertrag(p_mitarbeiter_id, p_montag)).wochenstunden,
         coalesce((select sum(a.stunden) from pep.abwesenheiten a
                    where a.mitarbeiter_id = p_mitarbeiter_id and a.datum between p_montag and p_montag + 6), 0),
         coalesce((select sum(pep.arbeitsstunden(p_mitarbeiter_id, p_montag + i,
                                                 pep.zeile_lesen(p_mitarbeiter_id, p_montag + i)))
                     from generate_series(0, 6) i), 0)
$$;

-- Kennzahlen einer Woche (Spec 10; getestet in tests/vorausplanung.test.mjs).
create or replace function pep.woche_kennzahlen(p_filiale_id bigint, p_jahr int, p_kw int)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_mo       date := pep.kw_montag(p_jahr, p_kw);
  v_so       date := v_mo + 6;
  v_w        pep.wochen;
  v_ids      bigint[];
  v_leistung numeric;
  v_soll     numeric;
  v_vertrag  numeric;
  v_abw      numeric;
  v_urlaub   numeric;
  v_verf     numeric;
  v_geplant  numeric;
begin
  select * into v_w from pep.wochen w where w.filiale_id = p_filiale_id and w.jahr = p_jahr and w.kw = p_kw;
  v_leistung := coalesce(v_w.stundenleistung_eur_pro_h,
                         (pep.einstellung(p_filiale_id, 'stundenleistung_eur_h') #>> '{}')::numeric);
  if v_w.planumsatz is not null and v_leistung > 0 then
    v_soll := round(round(v_w.planumsatz / v_leistung * 2) / 2, 1);
  end if;

  -- Aktive Mitarbeiter mit Vertrag in der Woche, eingetreten bis Sonntag, nicht vor Montag ausgetreten
  select coalesce(array_agg(m.id), '{}'), coalesce(sum(v.wochenstunden), 0) into v_ids, v_vertrag
    from pep.mitarbeiter m
    cross join lateral pep.wochenvertrag(m.id, v_mo) v
   where m.filiale_id = p_filiale_id and m.aktiv
     and (m.eintritt is null or m.eintritt <= v_so) and (m.austritt is null or m.austritt >= v_mo)
     and v.id is not null;

  select coalesce(sum(a.stunden), 0), coalesce(sum(a.stunden) filter (where c.code = 'U'), 0)
    into v_abw, v_urlaub
    from pep.abwesenheiten a
    join pep.abwesenheitscodes c on c.id = a.code_id
   where a.filiale_id = p_filiale_id and a.datum between v_mo and v_so and a.mitarbeiter_id = any (v_ids);
  v_verf := v_vertrag - v_abw;

  select coalesce(sum(pep.arbeitsstunden(z.mitarbeiter_id, z.datum, pep.zeile_lesen(z.mitarbeiter_id, z.datum))), 0)
    into v_geplant
    from (select distinct b.mitarbeiter_id, b.datum from pep.plan_bloecke b
           where b.filiale_id = p_filiale_id and b.datum between v_mo and v_so) z;

  return jsonb_build_object(
    'jahr', p_jahr,
    'kw', p_kw,
    'montag', to_char(v_mo, 'YYYY-MM-DD'),
    'planumsatz', v_w.planumsatz,
    'stundenleistung', v_leistung,
    'soll', v_soll,
    'vertragsstunden', v_vertrag,
    'abwesend', v_abw,
    'davon_urlaub', v_urlaub,
    'verfuegbar', v_verf,
    'ueberhang', v_verf - v_soll,
    'stundenvorgabe', coalesce(v_w.stundenvorgabe_manuell, v_soll, v_verf),
    'stundenvorgabe_manuell', v_w.stundenvorgabe_manuell,
    'vorgabe_quelle', case when v_w.stundenvorgabe_manuell is not null then 'manuell'
                           when v_soll is not null then 'planumsatz'
                           else 'verfuegbar' end,
    'geplant', v_geplant);
end;
$$;

-- ---------------------------------------------------------------------------
-- Einsatzplan: Funktionen für den Browser
-- ---------------------------------------------------------------------------

-- Alles, was der Reiter Einsatzplan für eine ISO-Woche braucht (Leitung und Stellvertretung).
create or replace function public.pep_einsatzplan_woche(p_jahr int, p_kw int)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung_oder_stellvertretung();
  v_f   bigint := v_b.filiale_id;
  v_mo  date := pep.kw_montag(p_jahr, p_kw);
  v_so  date := v_mo + 6;
  v_ids bigint[];
begin
  -- Wer in der Woche beschäftigt ist; wer Blöcke in der Woche hat, steht immer in der Liste.
  select array_agg(m.id order by m.position, m.name, m.id) into v_ids
    from pep.mitarbeiter m
   where m.filiale_id = v_f
     and ((m.aktiv and (m.eintritt is null or m.eintritt <= v_so) and (m.austritt is null or m.austritt >= v_mo)
           and exists (select 1 from pep.vertraege v where v.mitarbeiter_id = m.id and v.gueltig_ab <= v_so))
          or exists (select 1 from pep.plan_bloecke b
                      where b.mitarbeiter_id = m.id and b.datum between v_mo and v_so));

  return jsonb_build_object(
    'jahr', p_jahr,
    'kw', p_kw,
    'montag', to_char(v_mo, 'YYYY-MM-DD'),
    'heute', to_char(pep.heute(), 'YYYY-MM-DD'),
    'tage', (
      select jsonb_agg(jsonb_build_object(
               'datum', to_char(d.tag, 'YYYY-MM-DD'),
               'wochentag', extract(isodow from d.tag)::int,
               'geoeffnet', s.geoeffnet,
               'oeffnung_von', to_char(s.oeffnung_von, 'HH24:MI'),
               'oeffnung_bis', to_char(s.oeffnung_bis, 'HH24:MI'),
               'rahmen_von', to_char(s.rahmen_von, 'HH24:MI'),
               'rahmen_bis', to_char(s.rahmen_bis, 'HH24:MI'),
               'feiertag', s.feiertag,
               'vergangen', d.tag < pep.heute())
             order by d.tag)
        from (select v_mo + i as tag from generate_series(0, 6) i) d
        cross join lateral pep.tag_status(v_f, d.tag) s),
    'bereiche', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', b.id, 'kuerzel', b.kuerzel, 'name', b.name, 'farbe', b.farbe, 'art', b.art,
               'bedeutung', b.bedeutung, 'kompetenz_noetig', b.kompetenz_noetig)
             order by b.position, b.id)
        from pep.bereiche b
       where b.filiale_id = v_f and b.aktiv and b.art in ('bereich', 'pause')), '[]'::jsonb),
    'mitarbeiter', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id,
               'name', m.name,
               'personalnummer', m.personalnummer,
               'vertragsart', v.vertragsart,
               'wochenstunden', v.wochenstunden,
               'kompetenzen', coalesce((select jsonb_agg(k.bereich_id order by k.bereich_id)
                                          from pep.kompetenzen k where k.mitarbeiter_id = m.id), '[]'::jsonb),
               'vp', exists (select 1 from pep.kompetenzen k
                               join pep.bereiche b on b.id = k.bereich_id
                              where k.mitarbeiter_id = m.id and b.bedeutung = 'vp'),
               'u18', (select jsonb_object_agg(to_char(v_mo + i, 'YYYY-MM-DD'),
                                               coalesce(pep.alter_am(m.id, v_mo + i) < 18, false))
                         from generate_series(0, 6) i))
             order by u.ord)
        from unnest(v_ids) with ordinality u (id, ord)
        join pep.mitarbeiter m on m.id = u.id
        left join lateral pep.wochenvertrag(m.id, v_mo) v on true), '[]'::jsonb),
    'bloecke', pep.bloecke_antwort(v_f, v_mo, v_so, null),
    'abwesenheiten', coalesce((
      select jsonb_agg(jsonb_build_object(
               'mitarbeiter_id', a.mitarbeiter_id, 'datum', to_char(a.datum, 'YYYY-MM-DD'),
               'code', c.code, 'name', c.name, 'farbe', c.farbe, 'sperrt', c.sperrt, 'stunden', a.stunden,
               'von', to_char(a.von, 'HH24:MI'), 'bis', to_char(a.bis, 'HH24:MI'))
             order by a.datum, a.mitarbeiter_id)
        from pep.abwesenheiten a
        join pep.abwesenheitscodes c on c.id = a.code_id
       where a.filiale_id = v_f and a.datum between v_mo and v_so), '[]'::jsonb),
    'kommentare', coalesce((
      select jsonb_agg(jsonb_build_object(
               'mitarbeiter_id', k.mitarbeiter_id, 'datum', to_char(k.datum, 'YYYY-MM-DD'), 'text', k.text)
             order by k.datum, k.mitarbeiter_id)
        from pep.plan_kommentare k
       where k.filiale_id = v_f and k.datum between v_mo and v_so), '[]'::jsonb),
    'pruefung', (select jsonb_object_agg(to_char(v_mo + i, 'YYYY-MM-DD'), pep.pruefung(v_f, v_mo + i))
                   from generate_series(0, 6) i),
    'kennzahlen', pep.woche_kennzahlen(v_f, p_jahr, p_kw));
end;
$$;

-- Ein Strich: p_bereich_id malt [p_von, p_bis), NULL radiert. Radieren prüft nur Zeiten, Rechte
-- und VERGANGEN, damit Blöcke inaktiver oder abwesender Mitarbeiter immer entfernt werden können.
create or replace function public.pep_plan_malen(
  p_mitarbeiter_id bigint, p_datum date, p_von time, p_bis time, p_bereich_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m   pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_alt jsonb;
  v_neu jsonb;
begin
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  perform pep.plan_zeiten_pruefen(p_von, p_bis);
  -- Zeile erst nach der Sperre lesen, sonst überschreibt ein gleichzeitiger Strich den anderen.
  perform 1 from pep.mitarbeiter where id = v_m.id for update;
  v_alt := pep.zeile_lesen(v_m.id, p_datum);
  v_neu := pep.zeile_mit_strich(v_alt, p_von, p_bis, p_bereich_id);
  if p_bereich_id is null then
    if p_datum < pep.heute() then
      raise exception 'VERGANGEN';
    end if;
  else
    perform pep.zeile_pruefen(v_b.filiale_id, v_m.id, p_datum, v_alt, v_neu);
  end if;
  perform pep.zeile_schreiben(v_b.filiale_id, v_m.id, p_datum, v_neu, v_b.user_id);
  return pep.tag_antwort(v_b.filiale_id, p_datum, array[v_m.id]);
end;
$$;

-- Ersetzt die ganze Zeile eines Tages atomar (Rückgängig, F10). p_bloecke = [{von, bis, bereich_id}], [] löscht.
create or replace function public.pep_plan_zeile_setzen(p_mitarbeiter_id bigint, p_datum date, p_bloecke jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m   pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_e   jsonb;
  v_von time;
  v_bis time;
  v_alt jsonb;
  v_neu jsonb;
begin
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if p_bloecke is null or jsonb_typeof(p_bloecke) <> 'array' then
    raise exception 'WERT_UNGUELTIG';
  end if;
  for v_e in select e from jsonb_array_elements(p_bloecke) e loop
    -- bereich_id muss eine ganze Zahl im bigint-Bereich sein (1.5 oder 1e30 sonst roher Cast-Fehler)
    if jsonb_typeof(v_e) <> 'object' or coalesce(jsonb_typeof(v_e -> 'bereich_id'), '') <> 'number'
       or (v_e ->> 'bereich_id') !~ '^[0-9]{1,18}$' then
      raise exception 'WERT_UNGUELTIG';
    end if;
    begin
      v_von := (v_e ->> 'von')::time;
      v_bis := (v_e ->> 'bis')::time;
    exception when others then
      raise exception 'WERT_UNGUELTIG';
    end;
    perform pep.plan_zeiten_pruefen(v_von, v_bis);
  end loop;

  perform 1 from pep.mitarbeiter where id = v_m.id for update;
  v_alt := pep.zeile_lesen(v_m.id, p_datum);
  v_neu := pep.bloecke_normalisieren(p_bloecke);
  perform pep.zeile_pruefen(v_b.filiale_id, v_m.id, p_datum, v_alt, v_neu);
  perform pep.zeile_schreiben(v_b.filiale_id, v_m.id, p_datum, v_neu, v_b.user_id);
  return pep.tag_antwort(v_b.filiale_id, p_datum, array[v_m.id]);
end;
$$;

-- Kommentar eines Mitarbeiters an einem Tag; leer oder NULL löscht. Auch an vergangenen Tagen.
create or replace function public.pep_kommentar_setzen(p_mitarbeiter_id bigint, p_datum date, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m    pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_text text := nullif(urlaub.trim_alles(p_text), '');
  v_alt  pep.plan_kommentare;
  v_neu  pep.plan_kommentare;
  v_da   boolean;
  v_schl text;
begin
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if char_length(v_text) > 200 then
    raise exception 'TEXT_ZU_LANG';
  end if;
  v_schl := v_m.id || ':' || to_char(p_datum, 'YYYY-MM-DD');
  select * into v_alt from pep.plan_kommentare where mitarbeiter_id = v_m.id and datum = p_datum;
  v_da := found;

  if v_text is null then
    if v_da then
      delete from pep.plan_kommentare where mitarbeiter_id = v_m.id and datum = p_datum;
      perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'plan_kommentare', v_schl, to_jsonb(v_alt), null);
    end if;
    return;
  end if;
  if v_da and v_alt.text = v_text then
    return;
  end if;
  insert into pep.plan_kommentare (filiale_id, mitarbeiter_id, datum, text)
  values (v_b.filiale_id, v_m.id, p_datum, v_text)
  on conflict (mitarbeiter_id, datum) do update set text = excluded.text
  returning * into v_neu;
  perform pep.protokolliere(v_b.filiale_id, case when v_da then 'aendern' else 'anlegen' end,
    'plan_kommentare', v_schl, case when v_da then to_jsonb(v_alt) end, to_jsonb(v_neu));
end;
$$;

-- Reihenfolge im Raster (F12), nur Leitung: p_ids = genau die aktiven Mitarbeiter der Filiale,
-- jede Id einmal; position = Index (ab 1). Inaktive behalten ihre Position.
create or replace function public.pep_mitarbeiter_reihenfolge(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b      pep.benutzer := pep.leitung();
  v_aktive bigint[];
  v_vorher jsonb;
  v_nachher jsonb;
begin
  select coalesce(array_agg(m.id order by m.id), '{}'),
         coalesce(jsonb_object_agg(m.id::text, m.position), '{}'::jsonb)
    into v_aktive, v_vorher
    from pep.mitarbeiter m
   where m.filiale_id = v_b.filiale_id and m.aktiv;
  -- Sortiert verglichen: fehlende, fremde, doppelte und leere Ids fallen alle auf.
  if p_ids is null
     or v_aktive is distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(p_ids) x) then
    raise exception 'WERT_UNGUELTIG';
  end if;

  update pep.mitarbeiter m
     set position = u.ord::int
    from unnest(p_ids) with ordinality u (id, ord)
   where m.id = u.id;
  select coalesce(jsonb_object_agg(m.id::text, m.position), '{}'::jsonb) into v_nachher
    from pep.mitarbeiter m
   where m.filiale_id = v_b.filiale_id and m.aktiv;
  perform pep.protokolliere(v_b.filiale_id, 'reihenfolge', 'mitarbeiter', null, v_vorher, v_nachher);
end;
$$;

-- ---------------------------------------------------------------------------
-- Regelprüfung
-- ---------------------------------------------------------------------------

-- Zahl für Prüftexte: zwei Stellen mit Komma („9,50“); p_kurz ohne überflüssige Nullen („11“, „7,5“).
create or replace function pep.zahl_text(p_wert numeric, p_kurz boolean default false)
returns text
language sql immutable
set search_path = ''
as $$
  select replace(case when p_kurz then trim_scale(p_wert)::text
                      else to_char(round(p_wert, 2), 'FM999999990.00') end, '.', ',')
$$;

-- Uhrzeit „07:00“ oder Spanne „07:00–08:00“ für Prüftexte.
create or replace function pep.zeit_text(p_von time, p_bis time default null)
returns text
language sql immutable
set search_path = ''
as $$
  select to_char(p_von, 'HH24:MI') || coalesce('–' || to_char(p_bis, 'HH24:MI'), '')
$$;

-- Zustand je Mitarbeiter und halber Stunde eines Tages (p_mitarbeiter_id null = alle der Filiale), t = Beginn:
-- unbesetzt (F2, code = Code der Abwesenheit), sonst kasse (Bereich mit bedeutung kasse), pause oder arbeit.
create or replace function pep.halbstunden(p_filiale_id bigint, p_datum date, p_mitarbeiter_id bigint)
returns table (mitarbeiter_id bigint, t time, zustand text, code text)
language sql stable
set search_path = ''
as $$
  select b.mitarbeiter_id, s::time,
         case when x.unbesetzt then 'unbesetzt' when r.bedeutung = 'kasse' then 'kasse'
              when r.art = 'pause' then 'pause' else 'arbeit' end,
         case when x.unbesetzt then (select c.code from pep.abwesenheiten a
                                       join pep.abwesenheitscodes c on c.id = a.code_id
                                      where a.mitarbeiter_id = b.mitarbeiter_id and a.datum = b.datum) end
    from pep.plan_bloecke b
    join pep.bereiche r on r.id = b.bereich_id
    cross join lateral pep.abschnitte(b.mitarbeiter_id, b.datum, b.von, b.bis) x
    cross join lateral generate_series(date '2000-01-01' + x.von,
                                       date '2000-01-01' + x.bis - interval '30 minutes', interval '30 minutes') s
   where b.filiale_id = p_filiale_id and b.datum = p_datum
     and (p_mitarbeiter_id is null or b.mitarbeiter_id = p_mitarbeiter_id)
$$;

-- F8: Schichtlage aus der besetzten Arbeit des Tages (ohne Pause): frueh = Beginn zur Rahmenöffnung,
-- spaet = Ende nach spaet_grenze, beides = lang, sonst mitte; ohne Arbeit NULL.
create or replace function pep.lage(p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date)
returns text
language sql stable
set search_path = ''
as $$
  select case when a.erster is null then null
              when a.erster = s.rahmen_von and a.ende > g.grenze then 'lang'
              when a.erster = s.rahmen_von then 'frueh'
              when a.ende > g.grenze then 'spaet'
              else 'mitte' end
    from (select min(h.t) as erster, max(h.t) + interval '30 minutes' as ende
            from pep.halbstunden(p_filiale_id, p_datum, p_mitarbeiter_id) h
           where h.zustand in ('kasse', 'arbeit')) a
    cross join lateral pep.tag_status(p_filiale_id, p_datum) s
    cross join (select (pep.einstellung(p_filiale_id, 'spaet_grenze') #>> '{}')::time as grenze) g
$$;

-- F8: Lage der ISO-Woche vor p_datum: frueh bei mehr Früh- als Spätschichten (lang zählt für beide),
-- spaet umgekehrt, sonst NULL.
create or replace function pep.lage_vorwoche(p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date)
returns text
language sql stable
set search_path = ''
as $$
  select case when x.frueh > x.spaet then 'frueh' when x.spaet > x.frueh then 'spaet' end
    from (select count(*) filter (where l.lage in ('frueh', 'lang')) as frueh,
                 count(*) filter (where l.lage in ('spaet', 'lang')) as spaet
            from (select distinct b.datum from pep.plan_bloecke b
                   where b.mitarbeiter_id = p_mitarbeiter_id
                     and b.datum between p_datum - extract(isodow from p_datum)::int - 6
                                     and p_datum - extract(isodow from p_datum)::int) d
            cross join lateral (select pep.lage(p_filiale_id, p_mitarbeiter_id, d.datum) as lage) l) x
$$;

-- Lage des letzten Samstags vor p_datum, an dem der Mitarbeiter gearbeitet hat (NULL, wenn keiner).
create or replace function pep.lage_letzter_samstag(p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date)
returns text
language plpgsql stable
set search_path = ''
as $$
declare
  v_datum date;
  v_lage  text;
begin
  for v_datum in select distinct b.datum from pep.plan_bloecke b
                  where b.mitarbeiter_id = p_mitarbeiter_id and b.datum < p_datum
                    and extract(isodow from b.datum) = 6
                  order by 1 desc loop
    v_lage := pep.lage(p_filiale_id, p_mitarbeiter_id, v_datum);
    if v_lage is not null then
      return v_lage;
    end if;
  end loop;
  return null;
end;
$$;

-- F9: Samstage in [p_von, p_bis] ab Eintritt, an denen der Mitarbeiter besetzte Arbeit (ohne Pause) hat. Alle anderen
-- Samstage ab Eintritt (Urlaub, Krankheit, geschlossen, ungeplant, nur Pause) sind frei; Samstage vor dem Eintritt
-- sind weder frei noch gearbeitet. Einzige Stelle dieser Definition (Regelprüfung, Ersatzsuche, Eckdaten).
create or replace function pep.gearbeitete_samstage(p_mitarbeiter_id bigint, p_von date, p_bis date)
returns table (datum date)
language sql stable
set search_path = ''
as $$
  select distinct b.datum
    from pep.plan_bloecke b
    join pep.mitarbeiter m on m.id = b.mitarbeiter_id
    join pep.bereiche r on r.id = b.bereich_id
    cross join lateral pep.abschnitte(b.mitarbeiter_id, b.datum, b.von, b.bis) x
   where b.mitarbeiter_id = p_mitarbeiter_id and b.datum between p_von and p_bis
     and (m.eintritt is null or b.datum >= m.eintritt)
     and extract(isodow from b.datum) = 6 and r.art <> 'pause' and not x.unbesetzt
$$;

-- F9: Zahl der Samstage in [p_von, p_bis] ab dem Eintritt des Mitarbeiters (ohne Eintritt alle). Freie Samstage =
-- diese Zahl − gearbeitete (pep.gearbeitete_samstage); das Jahresziel bleibt wie eingestellt (nicht anteilig).
create or replace function pep.samstage_beschaeftigt(p_mitarbeiter_id bigint, p_von date, p_bis date)
returns int
language sql stable
set search_path = ''
as $$
  select count(*)::int
    from pep.mitarbeiter m
    cross join generate_series(greatest(p_von, coalesce(m.eintritt, p_von)), p_bis, interval '1 day') x
   where m.id = p_mitarbeiter_id and extract(isodow from x) = 6
$$;

-- Text einer verletzten Wochenvorgabe ohne Notiz, z. B. „Bevorzugt: nur 08:00–14:00“.
create or replace function pep.vorgabe_text(p_w pep.wochenvorgaben)
returns text
language sql immutable
set search_path = ''
as $$
  select 'Bevorzugt: ' || case
    when p_w.art = 'nur_zwischen' then 'nur ' || pep.zeit_text(p_w.von, p_w.bis)
    when p_w.von is not null or p_w.bis is not null
      then 'nicht ' || pep.zeit_text(coalesce(p_w.von, time '00:00'), coalesce(p_w.bis, time '24:00'))
    when p_w.max_stunden_tag is not null and p_w.max_stunden_woche is not null
      then 'höchstens ' || pep.zahl_text(p_w.max_stunden_tag, true) || ' h am Tag und '
           || pep.zahl_text(p_w.max_stunden_woche, true) || ' h in der Woche'
    when p_w.max_stunden_tag is not null then 'höchstens ' || pep.zahl_text(p_w.max_stunden_tag, true) || ' h am Tag'
    when p_w.max_stunden_woche is not null
      then 'höchstens ' || pep.zahl_text(p_w.max_stunden_woche, true) || ' h in der Woche'
    else 'nicht an diesem Tag' end
$$;

-- Regelprüfung eines Tages (Spec 12): Liste [{art, schwere, mitarbeiter_id, von, bis, text}], Warnungen vor
-- Hinweisen, dann von (ohne Uhrzeit zuerst), dann Mitarbeitername. Zusammenhängende halbe Stunden derselben
-- Art und desselben Mitarbeiters ergeben einen Eintrag. Regeln über die ganze Filiale (Kasse, VP, eine Person)
-- haben mitarbeiter_id NULL. Unbesetzte Zeit zählt nirgends mit (F2), Pause zählt als anwesend (F3).
-- Wochenregeln (wochenstunden, wochenstunden_unter, Woche unter 18) stehen an jedem Tag der ISO-Woche,
-- an dem der Mitarbeiter besetzte Blöcke hat.
create or replace function pep.pruefung(p_filiale_id bigint, p_datum date)
returns jsonb
language plpgsql stable
set search_path = ''
as $$
declare
  v_tag         record;
  v_mo          date := p_datum - (extract(isodow from p_datum)::int - 1);
  v_kasse       pep.bereiche;
  v_vp          bigint;
  v_p6          numeric := (pep.einstellung(p_filiale_id, 'pause_ab_6h_min') #>> '{}')::numeric;
  v_p9          numeric := (pep.einstellung(p_filiale_id, 'pause_ab_9h_min') #>> '{}')::numeric;
  v_ruhe        numeric := (pep.einstellung(p_filiale_id, 'ruhezeit_h') #>> '{}')::numeric;
  v_ruhe_u18    numeric := (pep.einstellung(p_filiale_id, 'ruhezeit_u18_h') #>> '{}')::numeric;
  v_max         numeric := (pep.einstellung(p_filiale_id, 'max_tag_h') #>> '{}')::numeric;
  v_max_u18     numeric := (pep.einstellung(p_filiale_id, 'max_tag_u18_h') #>> '{}')::numeric;
  v_woche_u18   numeric := (pep.einstellung(p_filiale_id, 'max_woche_u18_h') #>> '{}')::numeric;
  v_frueh_u18   time    := (pep.einstellung(p_filiale_id, 'u18_fruehestens') #>> '{}')::time;
  v_spaet_u18   time    := (pep.einstellung(p_filiale_id, 'u18_spaetestens') #>> '{}')::time;
  v_sa_monat    numeric := (pep.einstellung(p_filiale_id, 'freie_samstage_monat') #>> '{}')::numeric;
  v_sa_jahr     numeric := (pep.einstellung(p_filiale_id, 'freie_samstage_jahr') #>> '{}')::numeric;
  v_toleranz    numeric := (pep.einstellung(p_filiale_id, 'wochen_toleranz_h') #>> '{}')::numeric;
  v_samstag     boolean := extract(isodow from p_datum) = 6;
  v_monat_von   date := date_trunc('month', p_datum)::date;
  v_monat_bis   date := (date_trunc('month', p_datum) + interval '1 month')::date - 1;
  v_jahr_von    date := date_trunc('year', p_datum)::date;
  v_jahr_bis    date := (date_trunc('year', p_datum) + interval '1 year')::date - 1;
  v_woche_voll  boolean;
  v_monate      text[] := array['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August',
                                'September', 'Oktober', 'November', 'Dezember'];
begin
  select * into v_tag from pep.tag_status(p_filiale_id, p_datum);
  select * into v_kasse from pep.bereiche b where b.filiale_id = p_filiale_id and b.bedeutung = 'kasse';
  select b.id into v_vp from pep.bereiche b where b.filiale_id = p_filiale_id and b.bedeutung = 'vp';
  -- wochenstunden_unter erst, wenn alle geöffneten Tage der KW mindestens einen Block haben
  v_woche_voll := not exists (
    select 1 from generate_series(0, 6) i
     cross join lateral pep.tag_status(p_filiale_id, v_mo + i) s
     where s.geoeffnet
       and not exists (select 1 from pep.plan_bloecke b where b.filiale_id = p_filiale_id and b.datum = v_mo + i));

  return (
    with h as (
      select * from pep.halbstunden(p_filiale_id, p_datum, null)
    ), da as (  -- anwesend (F3)
      select * from h where h.zustand <> 'unbesetzt'
    ), ma as (  -- je anwesendem Mitarbeiter: Anwesenheit und Arbeitsstunden (F4), unter 18 (F7)
      select da.mitarbeiter_id, min(da.t) as erster, max(da.t) + interval '30 minutes' as ende,
             extract(epoch from min(da.t)) / 3600 as erster_h,
             extract(epoch from max(da.t)) / 3600 + 0.5 as ende_h,
             extract(epoch from max(da.t) - min(da.t)) / 3600 + 0.5 as anwesend_h,
             count(*) filter (where da.zustand in ('kasse', 'arbeit')) * 0.5 as arbeit_h,
             coalesce(pep.alter_am(da.mitarbeiter_id, p_datum) < 18, false) as u18
        from da
       group by da.mitarbeiter_id
    ), slots as (  -- halbe Stunden des Rahmens
      select s::time as t, s::time >= v_tag.oeffnung_von and s::time < v_tag.oeffnung_bis as offen
        from generate_series(date '2000-01-01' + v_tag.rahmen_von,
                             date '2000-01-01' + v_tag.rahmen_bis - interval '30 minutes', interval '30 minutes') s
       where v_tag.geoeffnet
    ), abdeckung as (
      select s.t, s.offen,
             count(da.mitarbeiter_id) as anwesend,
             count(da.mitarbeiter_id) filter (where da.zustand = 'kasse') as kasse,
             count(da.mitarbeiter_id) filter (where exists (select 1 from pep.kompetenzen k
                                                             where k.mitarbeiter_id = da.mitarbeiter_id
                                                               and k.bereich_id = v_vp)) as vp
        from slots s
        left join da on da.t = s.t
       group by s.t, s.offen
    ), roh (art, mitarbeiter_id, t, info) as (  -- Verstöße je halbe Stunde
      select 'unbesetzt', h.mitarbeiter_id, h.t, h.code from h where h.zustand = 'unbesetzt'
      union all
      select 'kasse_unbesetzt', null::bigint, a.t, null::text
        from abdeckung a where a.offen and a.kasse = 0 and v_kasse.id is not null
      union all
      select 'keine_vp', null, a.t, null
        from abdeckung a where v_vp is not null and a.vp = 0 and (a.offen or a.anwesend > 0)  -- F5
      union all
      select 'vp_allein', null, a.t, null from abdeckung a where a.offen and a.anwesend = 1
      union all
      -- Pause einer Kassenkraft: Kasse leer und niemand mit Kassenkompetenz frei (nicht Kasse, nicht Pause)
      select 'pausenabloese', p.mitarbeiter_id, p.t, null
        from da p
       where p.zustand = 'pause'
         and exists (select 1 from da k where k.mitarbeiter_id = p.mitarbeiter_id and k.zustand = 'kasse')
         and (not exists (select 1 from da k where k.t = p.t and k.zustand = 'kasse')
              and not exists (select 1 from da f
                              where f.t = p.t and f.zustand = 'arbeit' and f.mitarbeiter_id <> p.mitarbeiter_id
                                and (not v_kasse.kompetenz_noetig
                                     or exists (select 1 from pep.kompetenzen k
                                                 where k.mitarbeiter_id = f.mitarbeiter_id
                                                   and k.bereich_id = v_kasse.id))))
      union all
      select 'jarbschg', da.mitarbeiter_id, da.t, null
        from da join ma on ma.mitarbeiter_id = da.mitarbeiter_id
       where ma.u18 and (da.t < v_frueh_u18 or da.t >= v_spaet_u18)
    ), inseln as (  -- zusammenhängende halbe Stunden je Art und Mitarbeiter
      select r.art, r.mitarbeiter_id, r.info, min(r.t) as von, max(r.t) + interval '30 minutes' as bis
        from (select roh.*, extract(epoch from roh.t) / 1800
                            - row_number() over (partition by roh.art, roh.mitarbeiter_id, roh.info order by roh.t) as g
                from roh) r
       group by r.art, r.mitarbeiter_id, r.info, r.g
    ), ruhe as (  -- Ruhezeit zum Vortag und zum Folgetag; „unter 18“ am jeweils späteren Tag
      select ma.mitarbeiter_id, ma.erster as von, 24 - v.ende_h + ma.erster_h as stunden, 'vor' as wo,
             case when coalesce(pep.alter_am(ma.mitarbeiter_id, p_datum) < 18, false)
                  then v_ruhe_u18 else v_ruhe end as mind
        from ma
        join (select x.mitarbeiter_id, extract(epoch from max(x.t)) / 3600 + 0.5 as ende_h
                from pep.halbstunden(p_filiale_id, p_datum - 1, null) x
               where x.zustand <> 'unbesetzt' group by x.mitarbeiter_id) v on v.mitarbeiter_id = ma.mitarbeiter_id
      union all
      select ma.mitarbeiter_id, ma.ende, 24 - ma.ende_h + f.erster_h, 'nach',
             case when coalesce(pep.alter_am(ma.mitarbeiter_id, p_datum + 1) < 18, false)
                  then v_ruhe_u18 else v_ruhe end
        from ma
        join (select x.mitarbeiter_id, extract(epoch from min(x.t)) / 3600 as erster_h
                from pep.halbstunden(p_filiale_id, p_datum + 1, null) x
               where x.zustand <> 'unbesetzt' group by x.mitarbeiter_id) f on f.mitarbeiter_id = ma.mitarbeiter_id
    ), woche as (  -- F6: Vertrag, geplante (F4) und angerechnete abwesende Stunden der ISO-Woche
      select m.id as mitarbeiter_id, v.wochenstunden as vertrag,
             case when v.vertragsart = 'minijob' then 0 else v_toleranz end as toleranz,
             coalesce((select sum(extract(epoch from x.bis - x.von) / 3600)
                         from pep.plan_bloecke b
                         join pep.bereiche r on r.id = b.bereich_id
                         cross join lateral pep.abschnitte(b.mitarbeiter_id, b.datum, b.von, b.bis) x
                        where b.mitarbeiter_id = m.id and b.datum between v_mo and v_mo + 6
                          and r.art <> 'pause' and not x.unbesetzt), 0) as geplant,
             coalesce((select sum(a.stunden) from pep.abwesenheiten a
                        where a.mitarbeiter_id = m.id and a.datum between v_mo and v_mo + 6), 0) as abwesend
        from pep.mitarbeiter m
        cross join lateral pep.wochenvertrag(m.id, v_mo) v
       where m.filiale_id = p_filiale_id and v.id is not null
         and exists (select 1 from ma where ma.mitarbeiter_id = m.id)  -- nur an Tagen mit besetzten Blöcken
    ), lagen as (
      select ma.mitarbeiter_id, ma.arbeit_h, pep.lage(p_filiale_id, ma.mitarbeiter_id, p_datum) as lage from ma
    ), samstage as (  -- nur samstags: gearbeitete Samstage (F9) der Samstagsarbeiter vom Jahresbeginn bis Monatsende
      select l.mitarbeiter_id, s.datum
        from lagen l
        cross join lateral pep.gearbeitete_samstage(l.mitarbeiter_id, v_jahr_von, v_monat_bis) s
       where v_samstag and l.arbeit_h > 0
    ), frei as (  -- je Samstagsarbeiter, Samstage erst ab Eintritt: freie andere Samstage im Monat,
                  -- höchstens erreichbare im Jahr (frei davor + alle danach, auch schon geplante)
      select l.mitarbeiter_id,
             pep.samstage_beschaeftigt(l.mitarbeiter_id, v_monat_von, v_monat_bis) - 1
             - (select count(*) from samstage s where s.mitarbeiter_id = l.mitarbeiter_id
                   and s.datum >= v_monat_von and s.datum <> p_datum) as monat,
             pep.samstage_beschaeftigt(l.mitarbeiter_id, v_jahr_von, p_datum - 1)
             - (select count(*) from samstage s where s.mitarbeiter_id = l.mitarbeiter_id and s.datum < p_datum)
             + pep.samstage_beschaeftigt(l.mitarbeiter_id, p_datum + 1, v_jahr_bis) as jahr
        from lagen l
       where v_samstag and l.arbeit_h > 0
    ), wuensche as (  -- offene Urlaubswünsche (ohne entschiedene Freigabe) am Tag
      select distinct w.mitarbeiter_id
        from pep.urlaubswuensche(p_filiale_id, p_datum, p_datum) w
        left join lateral pep.freigabe_zum_wunsch(p_filiale_id,
          pep.wunsch_json(w.umfrage_id, w.urlaub_mitarbeiter_id, w.art, w.kw,
                          case when w.art = 'tag' then w.von end)) fg on true
       where coalesce(fg.status, 'offen') = 'offen'
    ), eintraege (art, schwere, mitarbeiter_id, von, bis, text) as (
      select i.art, 'warnung', i.mitarbeiter_id, i.von, i.bis,
             case i.art
               when 'unbesetzt'       then 'Unbesetzt (' || i.info || '): ' || pep.zeit_text(i.von, i.bis)
               when 'kasse_unbesetzt' then 'Kasse unbesetzt ' || pep.zeit_text(i.von, i.bis)
               when 'keine_vp'        then 'Keine VP anwesend ' || pep.zeit_text(i.von, i.bis)
               when 'vp_allein'       then 'Nur eine Person anwesend ' || pep.zeit_text(i.von, i.bis)
               when 'pausenabloese'   then 'Pausenablöse fehlt ' || pep.zeit_text(i.von, i.bis)
               when 'jarbschg'        then 'Unter 18: nicht vor ' || pep.zeit_text(v_frueh_u18)
                                           || ' und nicht nach ' || pep.zeit_text(v_spaet_u18)
             end
        from inseln i
      union all
      -- § 4 ArbZG: Schwellen an der Arbeitszeit; Pause = Anwesenheit ohne Arbeit (Pausenblöcke und Lücken)
      select 'pause_fehlt', 'warnung', p.mitarbeiter_id, p.erster, p.ende,
             'Pause fehlt oder zu kurz: ' || pep.zahl_text(p.arbeit_h) || ' h Arbeit, '
             || pep.zahl_text(p.pause_min, true) || ' min Pause (mind. ' || pep.zahl_text(p.mind, true) || ' min)'
        from (select ma.*, (ma.anwesend_h - ma.arbeit_h) * 60 as pause_min,
                     case when ma.arbeit_h > 9 and (ma.anwesend_h - ma.arbeit_h) * 60 < v_p9 then v_p9
                          when ma.arbeit_h > 6 and (ma.anwesend_h - ma.arbeit_h) * 60 < v_p6 then v_p6 end as mind
                from ma) p
       where p.mind is not null
      union all
      select 'ruhezeit', 'warnung', r.mitarbeiter_id, r.von, null::time,
             'Ruhezeit ' || pep.zahl_text(r.stunden) || ' h (mind. ' || pep.zahl_text(r.mind, true) || ' h) '
             || r.wo || ' ' || pep.zeit_text(r.von)
        from ruhe r
       where r.stunden < r.mind
      union all
      select 'hoechstarbeitszeit', 'warnung', g.mitarbeiter_id, g.erster, g.ende,
             pep.zahl_text(g.arbeit_h) || ' h am Tag (höchstens ' || pep.zahl_text(g.grenze, true) || ' h)'
        from (select ma.*, case when ma.u18 then v_max_u18 else v_max end as grenze from ma) g
       where g.arbeit_h > g.grenze
      union all
      select 'hoechstarbeitszeit', 'warnung', w.mitarbeiter_id, null, null,
             pep.zahl_text(w.geplant) || ' h in der Woche (höchstens ' || pep.zahl_text(v_woche_u18, true) || ' h)'
        from woche w
       where w.geplant > v_woche_u18 and coalesce(pep.alter_am(w.mitarbeiter_id, p_datum) < 18, false)
      union all
      select 'wochenstunden', 'warnung', w.mitarbeiter_id, null, null,
             'Woche: ' || pep.zahl_text(w.geplant) || ' h geplant + ' || pep.zahl_text(w.abwesend)
             || ' h abwesend, Vertrag ' || pep.zahl_text(w.vertrag) || ' h'
        from woche w
       where w.geplant + w.abwesend > w.vertrag + w.toleranz
      union all
      select 'wochenstunden_unter', 'hinweis', w.mitarbeiter_id, null, null,
             'Woche: ' || pep.zahl_text(w.geplant + w.abwesend) || ' h von ' || pep.zahl_text(w.vertrag) || ' h verplant'
        from woche w
       where v_woche_voll and w.geplant + w.abwesend < w.vertrag - w.toleranz
      union all
      select 'vorgabe_bevorzugt', 'hinweis', ma.mitarbeiter_id, null, null,
             coalesce(nullif(btrim(v.notiz), ''), pep.vorgabe_text(v))
        from ma
        cross join lateral pep.vorgaben_verletzt(ma.mitarbeiter_id, p_datum, '[]'::jsonb,
                                                 pep.zeile_lesen(ma.mitarbeiter_id, p_datum), false) v
      union all
      select 'schichtlage', 'hinweis', l.mitarbeiter_id, null, null,
             'Letzte Woche überwiegend ' || case l.lage when 'frueh' then 'früh' else 'spät' end
        from lagen l
       where l.lage in ('frueh', 'spaet') and l.lage = pep.lage_vorwoche(p_filiale_id, l.mitarbeiter_id, p_datum)
      union all
      select 'samstag_spaet', 'hinweis', l.mitarbeiter_id, null, null, 'Zweiter Samstag spät in Folge'
        from lagen l
       where v_samstag and l.lage in ('spaet', 'lang')
         and pep.lage_letzter_samstag(p_filiale_id, l.mitarbeiter_id, p_datum) in ('spaet', 'lang')
      union all
      select 'freier_samstag', 'hinweis', f.mitarbeiter_id, null, null,
             case when f.monat = 0 then 'Noch kein freier Samstag im ' || v_monate[extract(month from p_datum)::int]
                  else 'Erst ' || f.monat || ' von ' || pep.zahl_text(v_sa_monat, true) || ' freien Samstagen im '
                       || v_monate[extract(month from p_datum)::int] end
        from frei f
       where f.monat < v_sa_monat
      union all
      select 'freier_samstag', 'hinweis', f.mitarbeiter_id, null, null,
             'Jahresziel ' || pep.zahl_text(v_sa_jahr, true) || ' freie Samstage nicht mehr erreichbar'
        from frei f
       where f.jahr < v_sa_jahr
      union all
      select 'wunsch_offen', 'hinweis', ma.mitarbeiter_id, null, null, 'Urlaubswunsch offen'
        from ma join wuensche w on w.mitarbeiter_id = ma.mitarbeiter_id
       where ma.arbeit_h > 0
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'art', e.art, 'schwere', e.schwere, 'mitarbeiter_id', e.mitarbeiter_id,
             'von', to_char(e.von, 'HH24:MI'), 'bis', to_char(e.bis, 'HH24:MI'), 'text', e.text)
           order by e.schwere = 'hinweis', e.von nulls first, m.name nulls first, e.mitarbeiter_id nulls first,
                    e.art, e.text), '[]'::jsonb)
      from eintraege e
      left join pep.mitarbeiter m on m.id = e.mitarbeiter_id);
end;
$$;

-- Antwort auf einen Strich: Blöcke dieser Mitarbeiter an dem Tag und die Prüfung für alle Tage der ISO-Woche
-- (Wochenregeln) plus Vortag und Folgetag, wenn sie außerhalb der Woche liegen (Ruhezeit).
create or replace function pep.tag_antwort(p_filiale_id bigint, p_datum date, p_mitarbeiter_ids bigint[])
returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'datum', to_char(p_datum, 'YYYY-MM-DD'),
    'bloecke', pep.bloecke_antwort(p_filiale_id, p_datum, p_datum, coalesce(p_mitarbeiter_ids, '{}')),
    'pruefung', (select jsonb_object_agg(to_char(d.tag, 'YYYY-MM-DD'), pep.pruefung(p_filiale_id, d.tag))
                   from (select p_datum - extract(isodow from p_datum)::int + 1 + i as tag
                           from generate_series(0, 6) i
                         union
                         select p_datum + i from generate_series(-1, 1) i) d))
$$;

-- Regelprüfung für einen Zeitraum von höchstens 42 Tagen (Startseite): {"YYYY-MM-DD": [...]}.
create or replace function public.pep_pruefung_zeitraum(p_von date, p_bis date)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.leitung_oder_stellvertretung();
begin
  if p_von is null or p_bis is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if p_bis < p_von then
    raise exception 'ZEITRAUM_UNGUELTIG';
  end if;
  if p_bis - p_von + 1 > 42 then
    raise exception 'ZEITRAUM_ZU_LANG';
  end if;
  return (select jsonb_object_agg(to_char(p_von + i, 'YYYY-MM-DD'), pep.pruefung(v_b.filiale_id, p_von + i))
            from generate_series(0, p_bis - p_von) i);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kopieren und Vorlagen: interne Funktionen
-- ---------------------------------------------------------------------------

-- p_modus der Kopier- und Ladefunktionen: pruefen (schreibt nichts), ersetzen, leere.
create or replace function pep.modus_pruefen(p_modus text)
returns void
language plpgsql immutable
set search_path = ''
as $$
begin
  if p_modus is null or p_modus not in ('pruefen', 'ersetzen', 'leere') then
    raise exception 'MODUS_UNGUELTIG';
  end if;
end;
$$;

-- Gespeicherte Blöcke eines Tages der Filiale als [{mitarbeiter_id, von, bis, bereich_id}].
create or replace function pep.tag_bloecke(p_filiale_id bigint, p_datum date)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('mitarbeiter_id', b.mitarbeiter_id,
           'von', to_char(b.von, 'HH24:MI'), 'bis', to_char(b.bis, 'HH24:MI'), 'bereich_id', b.bereich_id)
         order by b.mitarbeiter_id, b.von), '[]'::jsonb)
    from pep.plan_bloecke b
   where b.filiale_id = p_filiale_id and b.datum = p_datum
$$;

-- F11: Fügt p_bloecke = [{mitarbeiter_id, von, bis, bereich_id}] am Tag p_ziel ein. Statt abzubrechen wird
-- ausgelassen. Dieselben Sperren wie pep.zeile_pruefen, aber je Block und ohne ABWESEND; deshalb hier eigene
-- Prüfungen statt zeile_pruefen (das bricht beim ersten Verstoß ab und lehnt Abwesende ab):
-- - ganze Zeile: Mitarbeiter fehlt (gelöscht) oder inaktiv/ausgetreten → ausgeschieden; noch nicht eingetreten
--   oder ohne Vertrag → nur ausgelassen;
-- - je Block in Reihenfolge von: auf den Rahmen kürzen (ganz außerhalb = verworfen; beides zählt als gekuerzt),
--   Bereich fehlt/inaktiv/Funktion, Kompetenz fehlt oder Pflicht-Vorgabe verletzt (gegen die bis dahin
--   angenommenen Blöcke, Stundengrenzen also kumulativ) → ausgelassen;
-- - Abwesenheit sperrt nicht: Der Block wird eingefügt und ist nach F2 unbesetzt (zählt in unbesetzt).
-- - Bleibt einem Mitarbeiter kein Arbeitsblock (nur Pausen), fallen auch die Pausen weg und zählen als
--   ausgelassen: Eine Pause allein würde Anwesenheit und VP verfälschen (F3).
-- p_modus: ersetzen = alle Zeilen des Tages werden ersetzt (auch die von Mitarbeitern ohne Quellblöcke →
-- leer); leere = Mitarbeiter mit Blöcken am Ziel bleiben unberührt. Geschrieben wird je Zeile über
-- pep.zeile_schreiben (ein Protokolleintrag „setzen“ je geänderter Zeile).
-- Vergangene oder geschlossene Tage lehnt die Funktion ab; pep.kopie_ausfuehren überspringt sie vorher.
-- Bericht: {bloecke, unbesetzt, gekuerzt, ausgelassen, ausgeschieden: [name]} (bloecke = eingefügte Quellblöcke).
create or replace function pep.tag_einfuegen(
  p_filiale_id bigint, p_ziel date, p_bloecke jsonb, p_modus text, p_user_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_quelle    jsonb := coalesce(p_bloecke, '[]'::jsonb);
  v_tag       record;
  v_ma        bigint;
  v_m         pep.mitarbeiter;
  v_n         int;
  v_e         jsonb;
  v_von       time;
  v_bis       time;
  v_bereich   pep.bereiche;
  v_zeile     jsonb;
  v_kandidat  jsonb;
  v_bloecke   int := 0;
  v_unbesetzt int := 0;
  v_gekuerzt  int := 0;
  v_ausgel    int := 0;
  v_weg       text[] := '{}';
  l_bloecke   int; -- Zähler je Mitarbeiter, erst am Ende übernommen (Pausen-Regel)
  l_unbesetzt int;
  l_gekuerzt  int;
  l_arbeit    int;
begin
  perform pep.modus_pruefen(p_modus);
  if p_modus = 'pruefen' then
    raise exception 'MODUS_UNGUELTIG';
  end if;
  if p_ziel is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if p_ziel < pep.heute() then
    raise exception 'VERGANGEN';
  end if;
  select * into v_tag from pep.tag_status(p_filiale_id, p_ziel);
  if not v_tag.geoeffnet then
    raise exception 'GESCHLOSSEN';
  end if;

  if p_modus = 'ersetzen' then
    -- Zeilen von Mitarbeitern ohne Quellblöcke leeren; die übrigen ersetzt die Schleife unten.
    for v_ma in select distinct b.mitarbeiter_id from pep.plan_bloecke b
                 where b.filiale_id = p_filiale_id and b.datum = p_ziel
                   and not exists (select 1 from jsonb_array_elements(v_quelle) e
                                    where (e ->> 'mitarbeiter_id')::bigint = b.mitarbeiter_id)
                 order by 1 loop
      perform pep.zeile_schreiben(p_filiale_id, v_ma, p_ziel, '[]'::jsonb, p_user_id);
    end loop;
  end if;

  for v_ma, v_n in select (e ->> 'mitarbeiter_id')::bigint, count(*)::int
                     from jsonb_array_elements(v_quelle) e group by 1 order by 1 loop
    select * into v_m from pep.mitarbeiter m where m.id = v_ma and m.filiale_id = p_filiale_id for update;
    if not found then
      v_weg := v_weg || 'gelöschter Mitarbeiter'::text;
      v_ausgel := v_ausgel + v_n;
      continue;
    end if;
    if p_modus = 'leere' and exists (select 1 from pep.plan_bloecke b where b.mitarbeiter_id = v_ma and b.datum = p_ziel) then
      continue;
    end if;
    v_zeile := '[]'::jsonb;
    if not v_m.aktiv or v_m.austritt < p_ziel then
      v_weg := v_weg || v_m.name;
      v_ausgel := v_ausgel + v_n;
    elsif v_m.eintritt > p_ziel
       or not exists (select 1 from pep.vertraege v where v.mitarbeiter_id = v_ma and v.gueltig_ab <= p_ziel) then
      v_ausgel := v_ausgel + v_n;
    else
      l_bloecke := 0; l_unbesetzt := 0; l_gekuerzt := 0; l_arbeit := 0;
      for v_e in select e from jsonb_array_elements(v_quelle) e
                  where (e ->> 'mitarbeiter_id')::bigint = v_ma order by (e ->> 'von')::time loop
        v_von := greatest((v_e ->> 'von')::time, v_tag.rahmen_von);
        v_bis := least((v_e ->> 'bis')::time, v_tag.rahmen_bis);
        if v_von >= v_bis then
          v_gekuerzt := v_gekuerzt + 1; -- ganz außerhalb des Rahmens: verworfen
          continue;
        end if;
        select * into v_bereich from pep.bereiche b
         where b.id = (v_e ->> 'bereich_id')::bigint and b.filiale_id = p_filiale_id and b.aktiv and b.art <> 'funktion';
        if not found
           or (v_bereich.kompetenz_noetig
               and not exists (select 1 from pep.kompetenzen k where k.mitarbeiter_id = v_ma and k.bereich_id = v_bereich.id)) then
          v_ausgel := v_ausgel + 1;
          continue;
        end if;
        v_kandidat := v_zeile || jsonb_build_array(pep.block_json(v_von, v_bis, v_bereich.id));
        if exists (select 1 from pep.vorgaben_verletzt(v_ma, p_ziel, v_zeile, v_kandidat, true)) then
          v_ausgel := v_ausgel + 1;
          continue;
        end if;
        if v_von <> (v_e ->> 'von')::time or v_bis <> (v_e ->> 'bis')::time then
          l_gekuerzt := l_gekuerzt + 1;
        end if;
        v_zeile := v_kandidat;
        l_bloecke := l_bloecke + 1;
        if v_bereich.art <> 'pause' then
          l_arbeit := l_arbeit + 1;
        end if;
        if pep.unbesetzt(v_ma, p_ziel, v_von, v_bis) then
          l_unbesetzt := l_unbesetzt + 1;
        end if;
      end loop;
      if l_arbeit = 0 then
        v_zeile := '[]'::jsonb; -- nur Pausen übrig: weglassen
        v_ausgel := v_ausgel + l_bloecke;
      else
        v_bloecke := v_bloecke + l_bloecke;
        v_unbesetzt := v_unbesetzt + l_unbesetzt;
        v_gekuerzt := v_gekuerzt + l_gekuerzt;
      end if;
    end if;
    -- leere: nur schreiben, was dazukommt; ersetzen: die Zeile immer ersetzen (auch durch eine leere)
    if p_modus = 'ersetzen' or jsonb_array_length(v_zeile) > 0 then
      perform pep.zeile_schreiben(p_filiale_id, v_ma, p_ziel, v_zeile, p_user_id);
    end if;
  end loop;

  return jsonb_build_object('bloecke', v_bloecke, 'unbesetzt', v_unbesetzt, 'gekuerzt', v_gekuerzt,
    'ausgelassen', v_ausgel,
    'ausgeschieden', (select coalesce(jsonb_agg(x order by x), '[]'::jsonb) from (select distinct unnest(v_weg) x) s));
end;
$$;

-- Gemeinsamer Ablauf für Kopieren und Vorlage laden. p_paare = [{ziel, bloecke, herkunft}] mit bloecke wie bei
-- pep.tag_einfuegen und herkunft = {quelle: Datum} oder {vorlage: Name, vorlage_id} für das Protokoll.
-- Vergangene und geschlossene Ziele werden übersprungen; gemeldet (uebersprungen) nur, wenn die Quelle dort
-- Blöcke hätte – sonst geht nichts verloren, und bei jeder Wochenkopie stünde der Sonntag in der Liste.
-- pruefen schreibt nichts: {belegt: [Zieltage mit Blöcken, ohne übersprungene], uebersprungen}.
-- Sonst: {tage, bloecke, unbesetzt, gekuerzt, ausgelassen, ausgeschieden, uebersprungen} (Summe über die Tage).
-- ersetzen leert zuerst ALLE bearbeiteten Zieltage und fügt erst danach ein. Sonst rechnete die Wochengrenze
-- (max_stunden_woche in pep.vorgaben_verletzt) für frühe Tage noch mit den alten Blöcken späterer Zieltage,
-- die gleich ersetzt werden, und ließe gültige Blöcke aus. Der Aufruf ist eine Transaktion: Scheitert
-- etwas, ist auch das Leeren zurückgenommen.
-- Protokoll: je bearbeitetem Zieltag genau ein Eintrag (p_aktion, 'plan_bloecke', 'YYYY-MM-DD') mit Herkunft,
-- Modus und Bericht des Tages; die geänderten Zeilen protokolliert pep.zeile_schreiben zusätzlich wie beim Malen
-- (bei ersetzen je Zeile zweimal: alt → leer, leer → neu).
create or replace function pep.kopie_ausfuehren(
  p_filiale_id bigint, p_user_id uuid, p_aktion text, p_paare jsonb, p_modus text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_p       jsonb;
  v_ziel    date;
  v_tag     record;
  v_grund   text;
  v_r       jsonb;
  v_belegt  jsonb := '[]'::jsonb;
  v_ueber   jsonb := '[]'::jsonb;
  v_tage    int := 0;
  v_summe   jsonb := '{"bloecke": 0, "unbesetzt": 0, "gekuerzt": 0, "ausgelassen": 0}'::jsonb;
  v_weg     text[] := '{}';
  v_k       text;
  v_offen   jsonb := '[]'::jsonb; -- zu bearbeitende Paare, nach Ziel sortiert
  v_ma      bigint;
begin
  perform pep.modus_pruefen(p_modus);
  -- 1. Ziele einteilen: übersprungen, (pruefen) belegt, sonst zu bearbeiten
  for v_p in select p from jsonb_array_elements(p_paare) p order by (p ->> 'ziel')::date loop
    v_ziel := (v_p ->> 'ziel')::date;
    select * into v_tag from pep.tag_status(p_filiale_id, v_ziel);
    v_grund := case when v_ziel < pep.heute() then 'vergangen' when not v_tag.geoeffnet then 'geschlossen' end;
    if v_grund is not null then
      if jsonb_array_length(coalesce(v_p -> 'bloecke', '[]'::jsonb)) > 0 then
        v_ueber := v_ueber || jsonb_build_array(jsonb_build_object('datum', to_char(v_ziel, 'YYYY-MM-DD'), 'grund', v_grund));
      end if;
      continue;
    end if;
    if p_modus = 'pruefen' then
      if exists (select 1 from pep.plan_bloecke b where b.filiale_id = p_filiale_id and b.datum = v_ziel) then
        v_belegt := v_belegt || jsonb_build_array(to_char(v_ziel, 'YYYY-MM-DD'));
      end if;
      continue;
    end if;
    v_offen := v_offen || jsonb_build_array(v_p);
  end loop;
  if p_modus = 'pruefen' then
    return jsonb_build_object('belegt', v_belegt, 'uebersprungen', v_ueber);
  end if;

  -- 2. ersetzen: alle Zieltage leeren, bevor irgendetwas eingefügt wird
  if p_modus = 'ersetzen' then
    for v_p in select p from jsonb_array_elements(v_offen) p loop
      v_ziel := (v_p ->> 'ziel')::date;
      for v_ma in select distinct b.mitarbeiter_id from pep.plan_bloecke b
                   where b.filiale_id = p_filiale_id and b.datum = v_ziel order by 1 loop
        perform pep.zeile_schreiben(p_filiale_id, v_ma, v_ziel, '[]'::jsonb, p_user_id);
      end loop;
    end loop;
  end if;

  -- 3. einfügen
  for v_p in select p from jsonb_array_elements(v_offen) p loop
    v_ziel := (v_p ->> 'ziel')::date;
    v_r := pep.tag_einfuegen(p_filiale_id, v_ziel, v_p -> 'bloecke', p_modus, p_user_id);
    perform pep.protokolliere(p_filiale_id, p_aktion, 'plan_bloecke', to_char(v_ziel, 'YYYY-MM-DD'), null,
      coalesce(v_p -> 'herkunft', '{}'::jsonb) || jsonb_build_object('modus', p_modus) || v_r);
    v_tage := v_tage + 1;
    foreach v_k in array array['bloecke', 'unbesetzt', 'gekuerzt', 'ausgelassen'] loop
      v_summe := v_summe || jsonb_build_object(v_k, (v_summe ->> v_k)::int + (v_r ->> v_k)::int);
    end loop;
    v_weg := v_weg || array(select jsonb_array_elements_text(v_r -> 'ausgeschieden'));
  end loop;

  return jsonb_build_object('tage', v_tage) || v_summe || jsonb_build_object(
    'ausgeschieden', (select coalesce(jsonb_agg(x order by x = 'gelöschter Mitarbeiter', x), '[]'::jsonb)
                        from (select distinct unnest(v_weg) x) s),
    'uebersprungen', v_ueber);
end;
$$;

-- ---------------------------------------------------------------------------
-- Kopieren und Vorlagen: Funktionen für den Browser (Leitung und Stellvertretung)
-- ---------------------------------------------------------------------------

-- Kopiert alle Blöcke des Tages p_quelle auf bis zu 60 Zieltage (die Quelle selbst und doppelte Ziele fallen weg).
create or replace function public.pep_tag_kopieren(p_quelle date, p_ziele date[], p_modus text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b       pep.benutzer := pep.leitung_oder_stellvertretung();
  v_ziele   date[];
  v_bloecke jsonb;
begin
  perform pep.modus_pruefen(p_modus);
  -- Länge vor jeder Arbeit je Eintrag; ein Eintrag mehr erlaubt (die Quelle selbst darf in der Liste stehen)
  if cardinality(p_ziele) > 61 then
    raise exception 'ZU_VIELE_ZIELE';
  end if;
  if p_quelle is null or p_ziele is null or array_position(p_ziele, null) is not null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  select coalesce(array_agg(distinct z), '{}') into v_ziele from unnest(p_ziele) z where z <> p_quelle;
  if cardinality(v_ziele) > 60 then
    raise exception 'ZU_VIELE_ZIELE';
  end if;
  v_bloecke := pep.tag_bloecke(v_b.filiale_id, p_quelle);
  return pep.kopie_ausfuehren(v_b.filiale_id, v_b.user_id, 'kopieren',
    (select coalesce(jsonb_agg(jsonb_build_object('ziel', to_char(z, 'YYYY-MM-DD'), 'bloecke', v_bloecke,
                                                  'herkunft', jsonb_build_object('quelle', to_char(p_quelle, 'YYYY-MM-DD')))), '[]'::jsonb)
       from unnest(v_ziele) z),
    p_modus);
end;
$$;

-- Kopiert die ISO-Woche (p_jahr, p_kw) Tag für Tag (Mo → Mo … So → So) auf bis zu 12 Zielwochen
-- p_ziele = [{jahr, kw}] (die Quellwoche selbst und doppelte Ziele fallen weg). Antwort wie pep_tag_kopieren.
create or replace function public.pep_woche_kopieren(p_jahr int, p_kw int, p_ziele jsonb, p_modus text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b       pep.benutzer := pep.leitung_oder_stellvertretung();
  v_mo      date;
  v_e       jsonb;
  v_montage date[] := '{}';
  v_quelle  jsonb[] := '{}';
  v_paare   jsonb := '[]'::jsonb;
  v_zm      date;
  i         int;
begin
  perform pep.modus_pruefen(p_modus);
  if p_ziele is null or jsonb_typeof(p_ziele) <> 'array' then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  -- Länge vor jeder Arbeit je Eintrag; ein Eintrag mehr erlaubt (die Quellwoche selbst darf in der Liste stehen)
  if jsonb_array_length(p_ziele) > 13 then
    raise exception 'ZU_VIELE_ZIELE';
  end if;
  v_mo := pep.kw_montag(p_jahr, p_kw);
  for v_e in select e from jsonb_array_elements(p_ziele) e loop
    if jsonb_typeof(v_e) <> 'object' or coalesce(jsonb_typeof(v_e -> 'jahr'), '') <> 'number'
       or coalesce(jsonb_typeof(v_e -> 'kw'), '') <> 'number'
       or (v_e ->> 'jahr') !~ '^[0-9]{4}$' or (v_e ->> 'kw') !~ '^[0-9]{1,2}$' then
      raise exception 'DATUM_UNGUELTIG';
    end if;
    v_zm := pep.kw_montag((v_e ->> 'jahr')::int, (v_e ->> 'kw')::int);
    if v_zm <> v_mo and not v_zm = any (v_montage) then
      v_montage := v_montage || v_zm;
    end if;
  end loop;
  if cardinality(v_montage) > 12 then
    raise exception 'ZU_VIELE_ZIELE';
  end if;
  for i in 0 .. 6 loop
    v_quelle := array_append(v_quelle, pep.tag_bloecke(v_b.filiale_id, v_mo + i));
  end loop;
  foreach v_zm in array v_montage loop
    for i in 0 .. 6 loop
      v_paare := v_paare || jsonb_build_array(jsonb_build_object('ziel', to_char(v_zm + i, 'YYYY-MM-DD'),
        'bloecke', v_quelle[i + 1], 'herkunft', jsonb_build_object('quelle', to_char(v_mo + i, 'YYYY-MM-DD'))));
    end loop;
  end loop;
  return pep.kopie_ausfuehren(v_b.filiale_id, v_b.user_id, 'kopieren', v_paare, p_modus);
end;
$$;

-- Speichert die Blöcke eines Tages (art tag) oder der ISO-Woche von p_datum (art woche) als Vorlage.
-- daten = [{wochentag (1–7, bei tag null), mitarbeiter_id, von, bis, bereich_id}]. Liefert die Id.
create or replace function public.pep_vorlage_speichern(p_name text, p_art text, p_datum date)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     pep.benutzer := pep.leitung_oder_stellvertretung();
  v_name  text := regexp_replace(urlaub.trim_alles(p_name), '\s+', ' ', 'g');
  v_von   date;
  v_bis   date;
  v_daten jsonb;
  v_neu   pep.vorlagen;
begin
  if v_name is null or v_name = '' then
    raise exception 'NAME_LEER';
  end if;
  if char_length(v_name) > 200 then
    raise exception 'TEXT_ZU_LANG';
  end if;
  if p_art is null or p_art not in ('tag', 'woche') then
    raise exception 'ART_UNGUELTIG';
  end if;
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  v_von := case when p_art = 'tag' then p_datum else p_datum - (extract(isodow from p_datum)::int - 1) end;
  v_bis := case when p_art = 'tag' then p_datum else v_von + 6 end;
  select jsonb_agg(jsonb_build_object(
           'wochentag', case when p_art = 'woche' then extract(isodow from b.datum)::int end,
           'mitarbeiter_id', b.mitarbeiter_id, 'von', to_char(b.von, 'HH24:MI'), 'bis', to_char(b.bis, 'HH24:MI'),
           'bereich_id', b.bereich_id)
         order by b.datum, b.mitarbeiter_id, b.von)
    into v_daten
    from pep.plan_bloecke b
   where b.filiale_id = v_b.filiale_id and b.datum between v_von and v_bis;
  if v_daten is null then
    raise exception 'VORLAGE_LEER';
  end if;
  if exists (select 1 from pep.vorlagen v where v.filiale_id = v_b.filiale_id and v.name = v_name) then
    raise exception 'VORLAGE_DOPPELT';
  end if;
  begin
    insert into pep.vorlagen (filiale_id, name, art, daten)
    values (v_b.filiale_id, v_name, p_art, v_daten)
    returning * into v_neu;
  exception when unique_violation then
    raise exception 'VORLAGE_DOPPELT';
  end;
  perform pep.protokolliere(v_b.filiale_id, 'anlegen', 'vorlagen', v_neu.id::text, null, to_jsonb(v_neu));
  return v_neu.id;
end;
$$;

-- Vorlagen der Filiale: [{id, name, art, angelegt_am, bloecke (Anzahl)}], nach Name.
create or replace function public.pep_vorlagen()
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.leitung_oder_stellvertretung();
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'art', v.art,
                   'angelegt_am', v.angelegt_am, 'bloecke', jsonb_array_length(v.daten)) order by v.name, v.id), '[]'::jsonb)
            from pep.vorlagen v where v.filiale_id = v_b.filiale_id);
end;
$$;

-- Lädt eine Vorlage auf p_ziel (art woche: p_ziel muss ein Montag sein, Wochentag 1 → p_ziel, … 7 → Sonntag).
-- Antwort wie pep_tag_kopieren; ausgeschieden nennt inaktive oder ausgetretene Mitarbeiter der Vorlage,
-- gelöschte als „gelöschter Mitarbeiter“.
create or replace function public.pep_vorlage_laden(p_id bigint, p_ziel date, p_modus text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     pep.benutzer := pep.leitung_oder_stellvertretung();
  v_v     pep.vorlagen;
  v_paare jsonb;
begin
  perform pep.modus_pruefen(p_modus);
  select * into v_v from pep.vorlagen where id = p_id and filiale_id = v_b.filiale_id;
  if not found then
    raise exception 'VORLAGE_NICHT_GEFUNDEN';
  end if;
  if p_ziel is null or (v_v.art = 'woche' and extract(isodow from p_ziel)::int <> 1) then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  select jsonb_agg(jsonb_build_object('ziel', to_char(p_ziel + t.i - 1, 'YYYY-MM-DD'),
           'bloecke', coalesce((select jsonb_agg(e) from jsonb_array_elements(v_v.daten) e
                                 where v_v.art = 'tag' or (e ->> 'wochentag')::int = t.i), '[]'::jsonb),
           'herkunft', jsonb_build_object('vorlage', v_v.name, 'vorlage_id', v_v.id)))
    into v_paare
    from generate_series(1, case when v_v.art = 'tag' then 1 else 7 end) t (i);
  return pep.kopie_ausfuehren(v_b.filiale_id, v_b.user_id, 'vorlage_laden', v_paare, p_modus);
end;
$$;

create or replace function public.pep_vorlage_loeschen(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.leitung_oder_stellvertretung();
  v_v pep.vorlagen;
begin
  delete from pep.vorlagen where id = p_id and filiale_id = v_b.filiale_id returning * into v_v;
  if not found then
    raise exception 'VORLAGE_NICHT_GEFUNDEN';
  end if;
  perform pep.protokolliere(v_b.filiale_id, 'loeschen', 'vorlagen', v_v.id::text, to_jsonb(v_v), null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Krank/ZA und Ersatz: interne Funktionen
-- ---------------------------------------------------------------------------

-- Gespeicherte Zeile eines Tages, aufgeteilt nach F2 (pep.abschnitte): p_unbesetzt = true liefert nur die
-- unbesetzten Abschnitte, false nur die besetzten; jeweils als Zeile [{von, bis, bereich_id}] (normalisiert).
create or replace function pep.zeile_teil(p_mitarbeiter_id bigint, p_datum date, p_unbesetzt boolean)
returns jsonb
language sql stable
set search_path = ''
as $$
  select pep.bloecke_normalisieren(coalesce(jsonb_agg(pep.block_json(x.von, x.bis, b.bereich_id)), '[]'::jsonb))
    from pep.plan_bloecke b
    cross join lateral pep.abschnitte(b.mitarbeiter_id, b.datum, b.von, b.bis) x
   where b.mitarbeiter_id = p_mitarbeiter_id and b.datum = p_datum and x.unbesetzt = p_unbesetzt
$$;

-- Hat der Mitarbeiter am Tag einen gespeicherten Block, der eine der Zeiten aus p_bloecke überschneidet?
create or replace function pep.zeile_ueberschneidet(p_mitarbeiter_id bigint, p_datum date, p_bloecke jsonb)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (select 1 from pep.plan_bloecke b
                   cross join jsonb_array_elements(coalesce(p_bloecke, '[]'::jsonb)) u
                  where b.mitarbeiter_id = p_mitarbeiter_id and b.datum = p_datum
                    and b.von < (u ->> 'bis')::time and b.bis > (u ->> 'von')::time)
$$;

-- Wer kann die unbesetzten Blöcke von p_mitarbeiter_id am Tag übernehmen?
-- Kandidat: jeder andere aktive Mitarbeiter der Filiale, der zu diesen Zeiten nichts geplant hat, für den
-- pep.zeile_pruefen (dieselben Sperren wie beim Malen: beschäftigt, Vertrag, Kompetenz, Abwesenheit,
-- Pflicht-Vorgabe …) mit seiner Zeile plus den unbesetzten Blöcken nicht wirft und für den danach weder
-- ruhezeit noch hoechstarbeitszeit verletzt wäre.
-- Die Regeln rechnet pep.pruefung, keine Kopie davon: Die unbesetzten Blöcke werden in einem Unterblock für
-- alle Kandidaten zugleich eingefügt, pep.pruefung des Tages gelesen und der Unterblock mit einer absichtlichen
-- Ausnahme (SQLSTATE PEP01) zurückgerollt. Gemeinsam geht das, weil ruhezeit, hoechstarbeitszeit,
-- vorgabe_bevorzugt und schichtlage nur von der eigenen Zeile abhängen (die Ruhezeit zu Vor- und Folgetag
-- steht in der Prüfung des Tages). So kostet die Suche zwei Prüfungen statt einer je Kandidat.
-- luecke = Wochensoll (Vertrag − angerechnete Abwesenheit, F6) − geplant (F4), vor der Übernahme.
-- samstage_monat = gearbeitete Samstage im Monat (F9), spaet_woche = Tage der ISO-Woche mit Lage spaet/lang (F8).
-- hinweise = Texte der vorgabe_bevorzugt- und schichtlage-Hinweise, die mit der Übernahme neu entstünden.
create or replace function pep.ersatz_kandidaten(p_filiale_id bigint, p_mitarbeiter_id bigint, p_datum date)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_unb     jsonb;
  v_mo      date := p_datum - (extract(isodow from p_datum)::int - 1);
  v_monat   date := date_trunc('month', p_datum)::date;
  v_id      bigint;
  v_alt     jsonb;
  v_ok      bigint[] := '{}';
  v_vorher  jsonb;
  v_nachher jsonb;
begin
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if p_datum < pep.heute() then
    raise exception 'VERGANGEN';
  end if;
  v_unb := pep.zeile_teil(p_mitarbeiter_id, p_datum, true);
  if jsonb_array_length(v_unb) = 0 then
    raise exception 'NICHTS_UNBESETZT';
  end if;

  -- Sperren wie beim Malen; wer zu diesen Zeiten schon geplant ist, fällt vorher heraus.
  for v_id in select m.id from pep.mitarbeiter m
                where m.filiale_id = p_filiale_id and m.id <> p_mitarbeiter_id and m.aktiv
                  and not pep.zeile_ueberschneidet(m.id, p_datum, v_unb)
                order by m.id loop
    v_alt := pep.zeile_lesen(v_id, p_datum);
    begin
      perform pep.zeile_pruefen(p_filiale_id, v_id, p_datum, v_alt, pep.bloecke_normalisieren(v_alt || v_unb));
      v_ok := v_ok || v_id;
    exception when raise_exception then
      null; -- gesperrt (fachlicher Code): kein Kandidat; echte Fehler laufen weiter
    end;
  end loop;
  if cardinality(v_ok) = 0 then
    return jsonb_build_object('unbesetzt', v_unb, 'kandidaten', '[]'::jsonb);
  end if;

  -- Prüfung vor und nach der gedachten Übernahme; der Unterblock wird immer zurückgerollt.
  v_vorher := pep.pruefung(p_filiale_id, p_datum);
  begin
    insert into pep.plan_bloecke (filiale_id, mitarbeiter_id, datum, von, bis, bereich_id)
    select p_filiale_id, k.id, p_datum, (u ->> 'von')::time, (u ->> 'bis')::time, (u ->> 'bereich_id')::bigint
      from unnest(v_ok) k (id)
      cross join jsonb_array_elements(v_unb) u;
    v_nachher := pep.pruefung(p_filiale_id, p_datum);
    raise sqlstate 'PEP01'; -- eigener Zustand nur für dieses Zurückrollen; alle anderen Fehler laufen weiter
  exception when sqlstate 'PEP01' then
    null;
  end;

  return jsonb_build_object('unbesetzt', v_unb, 'kandidaten', coalesce((
    select jsonb_agg(jsonb_build_object(
             'mitarbeiter_id', k.id, 'name', k.name, 'luecke', k.luecke, 'samstage_monat', k.samstage,
             'spaet_woche', k.spaet, 'hinweise', k.hinweise)
           order by k.luecke desc, k.samstage + k.spaet, k.name, k.id)
      from (
        select m.id, m.name,
               (select round(coalesce(w.vertrag, 0) - w.abwesend - w.geplant, 2)
                  from pep.woche_stunden(m.id, v_mo) w) as luecke,
               (select count(*)::int
                  from pep.gearbeitete_samstage(m.id, v_monat, (v_monat + interval '1 month')::date - 1)) as samstage,
               (select count(*)::int from generate_series(0, 6) i
                 where pep.lage(p_filiale_id, m.id, v_mo + i) in ('spaet', 'lang')) as spaet,
               coalesce((select jsonb_agg(n.e ->> 'text' order by n.ord)
                           from jsonb_array_elements(v_nachher) with ordinality n (e, ord)
                          where (n.e ->> 'mitarbeiter_id')::bigint = m.id
                            and n.e ->> 'art' in ('vorgabe_bevorzugt', 'schichtlage')
                            and not exists (select 1 from jsonb_array_elements(v_vorher) v
                                             where (v ->> 'mitarbeiter_id')::bigint = m.id
                                               and v ->> 'art' = n.e ->> 'art' and v ->> 'text' = n.e ->> 'text')),
                        '[]'::jsonb) as hinweise
          from pep.mitarbeiter m
         where m.id = any (v_ok)
           and not exists (select 1 from jsonb_array_elements(v_nachher) e
                            where (e ->> 'mitarbeiter_id')::bigint = m.id
                              and e ->> 'art' in ('ruhezeit', 'hoechstarbeitszeit'))) k), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Krank/ZA und Ersatz: Funktionen für den Browser (Leitung und Stellvertretung)
-- ---------------------------------------------------------------------------

-- Krankmeldung (KM) oder Zeitausgleich (ZA) ganztags von p_von bis p_bis, auch rückwirkend. Geschrieben wird
-- über den einzigen Schreibweg pep.abwesenheit_schreiben mit quelle 'schnell'. Geplante Blöcke bleiben
-- stehen und werden nach F2 unbesetzt. Antwort wie pep_abwesenheit_setzen: {tage, uebersprungen}.
create or replace function public.pep_schnell_abwesend(p_mitarbeiter_id bigint, p_code text, p_von date, p_bis date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m    pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_code bigint;
begin
  if p_code is null or p_code not in ('KM', 'ZA') then
    raise exception 'CODE_UNGUELTIG';
  end if;
  if not v_m.aktiv then
    raise exception 'MITARBEITER_INAKTIV';
  end if;
  -- Codes gehören der Filiale: KM bzw. ZA der eigenen Filiale, nur aktive.
  select c.id into v_code from pep.abwesenheitscodes c
   where c.filiale_id = v_b.filiale_id and c.code = p_code and c.aktiv;
  if not found then
    raise exception 'CODE_NICHT_GEFUNDEN';
  end if;
  return pep.abwesenheit_schreiben(v_b.filiale_id, v_m.id, v_code, p_von, p_bis, null, null, null,
    'schnell', null, null, null, v_b.user_id);
end;
$$;

-- Ersatz für die unbesetzten Blöcke eines Tages: {unbesetzt: [{von, bis, bereich_id}], kandidaten: [{mitarbeiter_id,
-- name, luecke, samstage_monat, spaet_woche, hinweise}]}; ohne unbesetzte Blöcke NICHTS_UNBESETZT.
-- Ändert nichts (die Probe in pep.ersatz_kandidaten wird zurückgerollt), ist aber deshalb nicht stable.
create or replace function public.pep_ersatz_kandidaten(p_mitarbeiter_id bigint, p_datum date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
begin
  return pep.ersatz_kandidaten(v_b.filiale_id, v_m.id, p_datum);
end;
$$;

-- Verschiebt alle unbesetzten Blöcke (Abschnitte nach F2) von p_mitarbeiter_id am Tag auf p_ersatz_id.
-- Für den Ersatz gelten die Sperren wie beim Malen (pep.zeile_pruefen); ist er zu diesen Zeiten schon geplant,
-- UEBERLAPPUNG. Bei jedem Fehler bleibt alles unverändert. Der Abwesende behält nur seine besetzten Abschnitte.
-- Antwort: pep.tag_antwort für beide.
create or replace function public.pep_ersatz_uebernehmen(p_mitarbeiter_id bigint, p_datum date, p_ersatz_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b   pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m   pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_e   pep.mitarbeiter := pep.eigener_mitarbeiter(p_ersatz_id);
  v_unb jsonb;
  v_alt jsonb;
  v_neu jsonb;
begin
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  if v_e.id = v_m.id then
    raise exception 'WERT_UNGUELTIG';
  end if;
  if p_datum < pep.heute() then
    raise exception 'VERGANGEN';
  end if;
  -- Beide Zeilen sperren (feste Reihenfolge gegen Verklemmung), erst danach lesen.
  perform 1 from pep.mitarbeiter where id in (v_m.id, v_e.id) order by id for update;
  v_unb := pep.zeile_teil(v_m.id, p_datum, true);
  if jsonb_array_length(v_unb) = 0 then
    raise exception 'NICHTS_UNBESETZT';
  end if;
  if pep.zeile_ueberschneidet(v_e.id, p_datum, v_unb) then
    raise exception 'UEBERLAPPUNG';
  end if;
  v_alt := pep.zeile_lesen(v_e.id, p_datum);
  v_neu := pep.bloecke_normalisieren(v_alt || v_unb);
  perform pep.zeile_pruefen(v_b.filiale_id, v_e.id, p_datum, v_alt, v_neu);
  -- Beim Abwesenden ist es Radieren der unbesetzten Zeit; dafür genügt VERGANGEN (wie bei pep_plan_malen).
  perform pep.zeile_schreiben(v_b.filiale_id, v_m.id, p_datum, pep.zeile_teil(v_m.id, p_datum, false), v_b.user_id);
  perform pep.zeile_schreiben(v_b.filiale_id, v_e.id, p_datum, v_neu, v_b.user_id);
  perform pep.protokolliere(v_b.filiale_id, 'ersatz', 'plan_bloecke',
    v_m.id || ':' || to_char(p_datum, 'YYYY-MM-DD'), null, jsonb_build_object('ersatz_id', v_e.id, 'bloecke', v_unb));
  return pep.tag_antwort(v_b.filiale_id, p_datum, array[v_m.id, v_e.id]);
end;
$$;

-- ---------------------------------------------------------------------------
-- Eckdaten: Funktion für den Browser (Leitung und Stellvertretung)
-- ---------------------------------------------------------------------------

-- Alles, was die Leitung beim Klick auf einen Namen im Einsatzplan für eine faire Planung braucht. Nur lesend.
-- vertrag: der am Datum gültige (wie pep.vertrag_am, aber NULL statt KEIN_VERTRAG).
-- vorgaben: alle am Datum gültigen Wochenvorgaben, Pflicht zuerst.
-- abwesenheiten: Montag dieser bis Sonntag nächster ISO-Woche.
-- woche: Soll = Vertrag der Woche − angerechnete Abwesenheit (F6, NULL ohne Vertrag), geplant (F4), wie die Seitenleiste.
-- samstage: jeder Samstag des Monats als vor_eintritt / gearbeitet (F9) / abwesend (mit Code) / geschlossen / frei –
--   abwesend, geschlossen und frei zählen als frei, vor_eintritt weder als frei noch als gearbeitet;
--   frei_jahr = freie Samstage des Jahres ab Eintritt vor dem Datum; Ziele aus den Einstellungen.
-- vorwoche: Lage (F8) je Tag der ISO-Woche davor; vorwoche_lage und letzter_samstag_spaet wie in pep.pruefung
--   (pep.lage_vorwoche, pep.lage_letzter_samstag). hinweise: Texte dazu, nie Sperren.
create or replace function public.pep_eckdaten(p_mitarbeiter_id bigint, p_datum date)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b         pep.benutzer := pep.leitung_oder_stellvertretung();
  v_m         pep.mitarbeiter := pep.eigener_mitarbeiter(p_mitarbeiter_id);
  v_f         bigint := v_b.filiale_id;
  v_mo        date;
  v_monat     date;
  v_monat_bis date;
  v_jahr      date;
  v_vertrag   pep.vertraege;
  v_vorwoche  text;
  v_sa_spaet  boolean;
begin
  if p_datum is null then
    raise exception 'DATUM_UNGUELTIG';
  end if;
  v_mo        := p_datum - (extract(isodow from p_datum)::int - 1);
  v_monat     := date_trunc('month', p_datum)::date;
  v_monat_bis := (v_monat + interval '1 month')::date - 1;
  v_jahr      := date_trunc('year', p_datum)::date;
  select * into v_vertrag from pep.vertraege v
   where v.mitarbeiter_id = v_m.id and v.gueltig_ab <= p_datum
   order by v.gueltig_ab desc limit 1;
  v_vorwoche := pep.lage_vorwoche(v_f, v_m.id, p_datum);
  v_sa_spaet := coalesce(pep.lage_letzter_samstag(v_f, v_m.id, p_datum) in ('spaet', 'lang'), false);

  return jsonb_build_object(
    'mitarbeiter', jsonb_build_object('id', v_m.id, 'name', v_m.name, 'personalnummer', v_m.personalnummer,
                                      'alter', pep.alter_am(v_m.id, p_datum)),
    'vertrag', case when v_vertrag.id is not null then
                 jsonb_build_object('vertragsart', v_vertrag.vertragsart, 'wochenstunden', v_vertrag.wochenstunden) end,
    'kompetenzen', coalesce((
      select jsonb_agg(r.kuerzel order by r.position, r.id)
        from pep.kompetenzen k join pep.bereiche r on r.id = k.bereich_id
       where k.mitarbeiter_id = v_m.id and r.aktiv), '[]'::jsonb),
    'vorgaben', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pflicht', w.pflicht, 'wochentag', w.wochentag, 'art', w.art,
               'von', to_char(w.von, 'HH24:MI'), 'bis', to_char(w.bis, 'HH24:MI'),
               'max_stunden_tag', w.max_stunden_tag, 'max_stunden_woche', w.max_stunden_woche,
               'notiz', nullif(btrim(w.notiz), ''))
             order by w.pflicht desc, w.wochentag nulls first, w.von nulls first, w.id)
        from pep.wochenvorgaben w
       where w.mitarbeiter_id = v_m.id and w.gueltig_von <= p_datum
         and (w.gueltig_bis is null or w.gueltig_bis >= p_datum)), '[]'::jsonb),
    'abwesenheiten', coalesce((
      select jsonb_agg(jsonb_build_object(
               'datum', to_char(a.datum, 'YYYY-MM-DD'), 'code', c.code, 'stunden', a.stunden,
               'von', to_char(a.von, 'HH24:MI'), 'bis', to_char(a.bis, 'HH24:MI'))
             order by a.datum)
        from pep.abwesenheiten a join pep.abwesenheitscodes c on c.id = a.code_id
       where a.mitarbeiter_id = v_m.id and a.datum between v_mo and v_mo + 13), '[]'::jsonb),
    'woche', (select jsonb_build_object('soll', w.vertrag - w.abwesend, 'geplant', w.geplant)
                from pep.woche_stunden(v_m.id, v_mo) w),
    'samstage', jsonb_build_object(
      'monat', (
        select jsonb_agg(jsonb_build_object(
                 'datum', to_char(s.d, 'YYYY-MM-DD'),
                 'status', case when s.d < v_m.eintritt then 'vor_eintritt'
                                when g.datum is not null then 'gearbeitet' when a.code is not null then 'abwesend'
                                when not t.geoeffnet then 'geschlossen' else 'frei' end,
                 'code', case when g.datum is null and not coalesce(s.d < v_m.eintritt, false) then a.code end)
               order by s.d)
          from (select x::date as d from generate_series(v_monat, v_monat_bis, interval '1 day') x) s
          left join pep.gearbeitete_samstage(v_m.id, v_monat, v_monat_bis) g on g.datum = s.d
          left join lateral (select c.code from pep.abwesenheiten a2 join pep.abwesenheitscodes c on c.id = a2.code_id
                              where a2.mitarbeiter_id = v_m.id and a2.datum = s.d) a on true
          cross join lateral pep.tag_status(v_f, s.d) t
         where extract(isodow from s.d) = 6),
      'frei_jahr', pep.samstage_beschaeftigt(v_m.id, v_jahr, p_datum - 1)
                   - (select count(*) from pep.gearbeitete_samstage(v_m.id, v_jahr, p_datum - 1)),
      'ziel_jahr', pep.einstellung(v_f, 'freie_samstage_jahr'),
      'ziel_monat', pep.einstellung(v_f, 'freie_samstage_monat')),
    'vorwoche', (select jsonb_agg(jsonb_build_object('datum', to_char(v_mo - 7 + i, 'YYYY-MM-DD'),
                                                     'lage', pep.lage(v_f, v_m.id, v_mo - 7 + i)) order by i)
                   from generate_series(0, 6) i),
    'vorwoche_lage', v_vorwoche,
    'letzter_samstag_spaet', v_sa_spaet,
    'hinweise', to_jsonb(array_remove(array[
      case v_vorwoche when 'frueh' then 'Hatte letzte Woche überwiegend früh – eher spät planen'
                      when 'spaet' then 'Hatte letzte Woche überwiegend spät – eher früh planen' end,
      case when v_sa_spaet then 'Letzter gearbeiteter Samstag war spät – nicht wieder spät planen' end], null)),
    'kommentar', (select k.text from pep.plan_kommentare k where k.mitarbeiter_id = v_m.id and k.datum = p_datum),
    'zeitkonto', null);  -- Platzhalter: Anzeige „ab Zeitkonto-Stufe“
end;
$$;

-- Bestehende Filialen nachrüsten (zweiter Schema-Lauf nach einem Update).
select pep.grundausstattung(id) from pep.filialen;

-- ---------------------------------------------------------------------------
-- Vorausplanung: sechs Wochen mit Soll, Verfügbar und Überhang (Spec 10)
-- ---------------------------------------------------------------------------

-- Sechs Wochen ab der angegebenen KW (über den Jahreswechsel) – Leitung und Stellvertretung.
create or replace function public.pep_vorausplanung(p_jahr int, p_kw int)
returns jsonb
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_b  pep.benutzer := pep.leitung_oder_stellvertretung();
  v_mo date := pep.kw_montag(p_jahr, p_kw);
begin
  return jsonb_build_object('wochen', (
    select jsonb_agg(pep.woche_kennzahlen(v_b.filiale_id, k.jahr, k.kw) order by i)
      from generate_series(0, 5) i
      cross join lateral (select extract(isoyear from v_mo + 7 * i)::int as jahr,
                                 extract(week from v_mo + 7 * i)::int as kw) k));
end;
$$;

-- Planumsatz, Stundenleistung und manuelle Stundenvorgabe einer Woche. Enthaltene Schlüssel werden
-- gesetzt (Zahl > 0, Vorgabe ab 0, oder null zum Leeren), fehlende bleiben unverändert.
-- Antwort: die Kennzahlen der Woche.
create or replace function public.pep_woche_speichern(p_jahr int, p_kw int, p_daten jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b    pep.benutzer := pep.leitung_oder_stellvertretung();
  v_f    bigint := v_b.filiale_id;
  v_alt  pep.wochen;
  v_neu  pep.wochen;
  v_da   boolean;
  v_umsatz numeric;
  v_leist  numeric;
  v_vorg   numeric;
begin
  perform pep.kw_montag(p_jahr, p_kw);
  if p_daten is null or jsonb_typeof(p_daten) <> 'object' then
    raise exception 'WERT_UNGUELTIG';
  end if;
  -- Jedes vorhandene Feld: JSON-Zahl oder null; Grenzen passen zu numeric(12,2), (8,2), (7,2)
  if p_daten ? 'planumsatz' and (jsonb_typeof(p_daten -> 'planumsatz') not in ('number', 'null')
       or (p_daten ->> 'planumsatz')::numeric not between 0.01 and 9999999999.99) then
    raise exception 'WERT_UNGUELTIG';
  end if;
  if p_daten ? 'stundenleistung_eur_pro_h' and (jsonb_typeof(p_daten -> 'stundenleistung_eur_pro_h') not in ('number', 'null')
       or (p_daten ->> 'stundenleistung_eur_pro_h')::numeric not between 0.01 and 999999.99) then
    raise exception 'WERT_UNGUELTIG';
  end if;
  if p_daten ? 'stundenvorgabe_manuell' and (jsonb_typeof(p_daten -> 'stundenvorgabe_manuell') not in ('number', 'null')
       or (p_daten ->> 'stundenvorgabe_manuell')::numeric not between 0 and 99999.99) then
    raise exception 'WERT_UNGUELTIG';
  end if;

  select * into v_alt from pep.wochen where filiale_id = v_f and jahr = p_jahr and kw = p_kw;
  v_da := found;
  v_umsatz := case when p_daten ? 'planumsatz' then (p_daten ->> 'planumsatz')::numeric else v_alt.planumsatz end;
  v_leist  := case when p_daten ? 'stundenleistung_eur_pro_h' then (p_daten ->> 'stundenleistung_eur_pro_h')::numeric
                   else v_alt.stundenleistung_eur_pro_h end;
  v_vorg   := case when p_daten ? 'stundenvorgabe_manuell' then (p_daten ->> 'stundenvorgabe_manuell')::numeric
                   else v_alt.stundenvorgabe_manuell end;

  if v_umsatz is null and v_leist is null and v_vorg is null then
    if v_da then
      delete from pep.wochen where filiale_id = v_f and jahr = p_jahr and kw = p_kw;
      perform pep.protokolliere(v_f, 'loeschen', 'wochen', p_jahr || '-' || p_kw, to_jsonb(v_alt), null);
    end if;
  else
    insert into pep.wochen (filiale_id, jahr, kw, planumsatz, stundenleistung_eur_pro_h, stundenvorgabe_manuell)
    values (v_f, p_jahr, p_kw, v_umsatz, v_leist, v_vorg)
    on conflict (filiale_id, jahr, kw) do update
      set planumsatz = excluded.planumsatz,
          stundenleistung_eur_pro_h = excluded.stundenleistung_eur_pro_h,
          stundenvorgabe_manuell = excluded.stundenvorgabe_manuell
    returning * into v_neu;
    if not v_da or to_jsonb(v_alt) is distinct from to_jsonb(v_neu) then
      perform pep.protokolliere(v_f, case when v_da then 'aendern' else 'anlegen' end, 'wochen',
        p_jahr || '-' || p_kw, case when v_da then to_jsonb(v_alt) end, to_jsonb(v_neu));
    end if;
  end if;
  return pep.woche_kennzahlen(v_f, p_jahr, p_kw);
end;
$$;


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

-- Abwesenheiten
revoke all on function public.pep_abwesenheit_setzen(bigint, bigint, date, date, numeric, time, time, text) from public, anon, authenticated;
revoke all on function public.pep_abwesenheit_loeschen(bigint, date, date) from public, anon, authenticated;
revoke all on function public.pep_wiederholung_speichern(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.pep_wiederholung_loeschen(bigint) from public, anon, authenticated;
revoke all on function public.pep_abwesenheiten(int, int) from public, anon, authenticated;
grant execute on function public.pep_abwesenheit_setzen(bigint, bigint, date, date, numeric, time, time, text) to authenticated;
grant execute on function public.pep_abwesenheit_loeschen(bigint, date, date) to authenticated;
grant execute on function public.pep_wiederholung_speichern(bigint, jsonb) to authenticated;
grant execute on function public.pep_wiederholung_loeschen(bigint) to authenticated;
grant execute on function public.pep_abwesenheiten(int, int) to authenticated;

-- Urlaubstool-Anbindung
revoke all on function public.pep_urlaub_umfragen() from public, anon, authenticated;
revoke all on function public.pep_urlaub_umfrage_schalten(bigint, boolean) from public, anon, authenticated;
revoke all on function public.pep_urlaub_zuordnung() from public, anon, authenticated;
revoke all on function public.pep_urlaub_zuordnung_setzen(bigint, bigint) from public, anon, authenticated;
revoke all on function public.pep_urlaub_freigeben(bigint, date, date, jsonb, text) from public, anon, authenticated;
revoke all on function public.pep_urlaub_ablehnen(bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.pep_freigabe_zuruecknehmen(bigint) from public, anon, authenticated;
grant execute on function public.pep_urlaub_umfragen() to authenticated;
grant execute on function public.pep_urlaub_umfrage_schalten(bigint, boolean) to authenticated;
grant execute on function public.pep_urlaub_zuordnung() to authenticated;
grant execute on function public.pep_urlaub_zuordnung_setzen(bigint, bigint) to authenticated;
grant execute on function public.pep_urlaub_freigeben(bigint, date, date, jsonb, text) to authenticated;
grant execute on function public.pep_urlaub_ablehnen(bigint, jsonb, text) to authenticated;
grant execute on function public.pep_freigabe_zuruecknehmen(bigint) to authenticated;

-- Einsatzplan
revoke all on function public.pep_einsatzplan_woche(int, int) from public, anon, authenticated;
revoke all on function public.pep_plan_malen(bigint, date, time, time, bigint) from public, anon, authenticated;
revoke all on function public.pep_plan_zeile_setzen(bigint, date, jsonb) from public, anon, authenticated;
revoke all on function public.pep_kommentar_setzen(bigint, date, text) from public, anon, authenticated;
revoke all on function public.pep_mitarbeiter_reihenfolge(bigint[]) from public, anon, authenticated;
grant execute on function public.pep_einsatzplan_woche(int, int) to authenticated;
grant execute on function public.pep_plan_malen(bigint, date, time, time, bigint) to authenticated;
grant execute on function public.pep_plan_zeile_setzen(bigint, date, jsonb) to authenticated;
grant execute on function public.pep_kommentar_setzen(bigint, date, text) to authenticated;
grant execute on function public.pep_mitarbeiter_reihenfolge(bigint[]) to authenticated;

-- Regelprüfung
revoke all on function public.pep_pruefung_zeitraum(date, date) from public, anon, authenticated;
grant execute on function public.pep_pruefung_zeitraum(date, date) to authenticated;

-- Kopieren und Vorlagen
revoke all on function public.pep_tag_kopieren(date, date[], text) from public, anon, authenticated;
revoke all on function public.pep_woche_kopieren(int, int, jsonb, text) from public, anon, authenticated;
revoke all on function public.pep_vorlage_speichern(text, text, date) from public, anon, authenticated;
revoke all on function public.pep_vorlagen() from public, anon, authenticated;
revoke all on function public.pep_vorlage_laden(bigint, date, text) from public, anon, authenticated;
revoke all on function public.pep_vorlage_loeschen(bigint) from public, anon, authenticated;
grant execute on function public.pep_tag_kopieren(date, date[], text) to authenticated;
grant execute on function public.pep_woche_kopieren(int, int, jsonb, text) to authenticated;
grant execute on function public.pep_vorlage_speichern(text, text, date) to authenticated;
grant execute on function public.pep_vorlagen() to authenticated;
grant execute on function public.pep_vorlage_laden(bigint, date, text) to authenticated;
grant execute on function public.pep_vorlage_loeschen(bigint) to authenticated;

-- Krank/ZA und Ersatz
revoke all on function public.pep_schnell_abwesend(bigint, text, date, date) from public, anon, authenticated;
revoke all on function public.pep_ersatz_kandidaten(bigint, date) from public, anon, authenticated;
revoke all on function public.pep_ersatz_uebernehmen(bigint, date, bigint) from public, anon, authenticated;
grant execute on function public.pep_schnell_abwesend(bigint, text, date, date) to authenticated;
grant execute on function public.pep_ersatz_kandidaten(bigint, date) to authenticated;
grant execute on function public.pep_ersatz_uebernehmen(bigint, date, bigint) to authenticated;

-- Eckdaten
revoke all on function public.pep_eckdaten(bigint, date) from public, anon, authenticated;
grant execute on function public.pep_eckdaten(bigint, date) to authenticated;

-- Vorausplanung
revoke all on function public.pep_vorausplanung(int, int) from public, anon, authenticated;
revoke all on function public.pep_woche_speichern(int, int, jsonb) from public, anon, authenticated;
grant execute on function public.pep_vorausplanung(int, int) to authenticated;
grant execute on function public.pep_woche_speichern(int, int, jsonb) to authenticated;

commit;

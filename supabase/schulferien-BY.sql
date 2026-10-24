-- Schulferien Bayern fuer die Schuljahre 2026/27 und 2027/28, Filiale 2558.
-- Quelle: Bayerisches Staatsministerium fuer Unterricht und Kultus, Ferientermine
--   https://www.km.bayern.de/ferientermine-herunterladen (offizielle Kalenderdatei,
--   DTEND dort exklusiv, hier als letzter Ferientag eingetragen),
--   gegengeprueft fuer 2026/27 mit https://www.kmk.org/service/ferienregelung/ferienkalender.html
-- Abruf: 24.10.2026
-- Die Herbstferien fuehrt das Ministerium als "unterrichtsfreie Tage"; dazu je ein
-- einzelner unterrichtsfreier Tag im November.
-- Idempotent: zweimal ausfuehren aendert nichts.
do $$
declare
  v_filiale bigint;
begin
  select id into v_filiale from pep.filialen where nummer = '2558' order by id limit 1;
  if v_filiale is null then
    raise exception 'FILIALE_FEHLT';
  end if;

  insert into pep.schulferien (filiale_id, von, bis, name)
  select v_filiale, t.von::date, t.bis::date, t.name
  from (values
    ('2026-11-02', '2026-11-06', 'Herbstferien 2026'),
    ('2026-11-18', '2026-11-18', 'Unterrichtsfreier Tag 2026'),
    ('2026-12-24', '2027-01-08', 'Weihnachtsferien 2026/27'),
    ('2027-02-08', '2027-02-12', 'Frühjahrsferien 2027'),
    ('2027-03-22', '2027-04-02', 'Osterferien 2027'),
    ('2027-05-18', '2027-05-28', 'Pfingstferien 2027'),
    ('2027-08-02', '2027-09-13', 'Sommerferien 2027'),
    ('2027-11-02', '2027-11-05', 'Herbstferien 2027'),
    ('2027-11-17', '2027-11-17', 'Unterrichtsfreier Tag 2027'),
    ('2027-12-24', '2028-01-07', 'Weihnachtsferien 2027/28'),
    ('2028-02-28', '2028-03-03', 'Frühjahrsferien 2028'),
    ('2028-04-10', '2028-04-21', 'Osterferien 2028'),
    ('2028-06-06', '2028-06-16', 'Pfingstferien 2028'),
    ('2028-07-31', '2028-09-11', 'Sommerferien 2028')
  ) as t(von, bis, name)
  where not exists (
    select 1 from pep.schulferien s
    where s.filiale_id = v_filiale and s.von = t.von::date and s.name = t.name);
end $$;

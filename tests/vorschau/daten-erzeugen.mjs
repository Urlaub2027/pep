// Erzeugt die Vorschau-Daten aus einer PGlite-Testdatenbank (echte Funktionsausgaben, erfundene Namen).
import { writeFileSync } from 'node:fs';
import {
  neueDatenbank, als, pepBenutzer, filiale, heuteSetzen, umfrageAnlegen, urlaubsfrageId, umfrageMitarbeiter, abgeben,
} from '../helfer.mjs';

const db = await neueDatenbank();
await heuteSetzen(db, '2026-11-02');
const leitung = await pepBenutzer(db, 'chef');
await filiale(db, leitung);
const q = async (sql, p = []) => (await als(db, 'authenticated', leitung, sql, p))[0]?.r;
const namen = ['Test, Anna', 'Muster, Ben', 'Beispiel, Cem', 'Probe, Dana', 'Demo, Emil', 'Fiktiv, Frieda',
  'Platzhalter, Gustav', 'Vorlage, Hanna', 'Entwurf, Ivo', 'Skizze, Jana', 'Modell, Kai', 'Attrappe, Lea'];
const stunden = [37.5, 37.5, 30, 20, 37.5, 42, 25, 37.5, 30, 37.5, 20, 42];
const ids = [];
for (const [i, name] of namen.entries()) {
  const id = await q('select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name, personalnummer: String(90001 + i) })]); // erfundene Personalnummern
  await q('select public.pep_vertrag_speichern($1, $2::jsonb) as r', [id, JSON.stringify({
    vertragsart: stunden[i] === 42 ? 'fuehrung' : stunden[i] === 37.5 ? 'vollzeit' : 'teilzeit', wochenstunden: stunden[i], gueltig_ab: '2026-01-01' })]);
  await q('select public.pep_urlaubsjahr_speichern($1, 2026, $2, 0) as r', [id, stunden[i] * 6]);
  ids.push(id);
}
const e = await q('select public.pep_einstellungen() as r');
const code = Object.fromEntries(e.codes.map((c) => [c.code, c.id]));
const setzen = (m, c, von, bis) => q(`select public.pep_abwesenheit_setzen($1, $2, $3::date, $4::date, null, null, null, null) as r`, [m, code[c], von, bis]);
await setzen(ids[0], 'U', '2026-11-09', '2026-11-14');
await setzen(ids[2], 'KM', '2026-11-03', '2026-11-05');
await setzen(ids[4], 'U', '2026-11-23', '2026-11-28');
await setzen(ids[7], 'ZA', '2026-11-12', '2026-11-12');
await setzen(ids[9], 'U', '2026-11-16', '2026-11-20');
// Kleiner Anspruch: Rest unter 0, damit die Vorschau die rote Darstellung zeigt.
await q('select public.pep_urlaubsjahr_speichern($1, 2026, 20, 0) as r', [ids[9]]);
await q(`select public.pep_wiederholung_speichern($1, $2::jsonb) as r`, [ids[10], JSON.stringify({ code_id: code.BS, wochentag: 2, von_datum: '2026-11-01', bis_datum: '2026-12-31', stunden: 8 })]);

// ---- Einsatzplan KW 46 (Mo 09.11.–Sa 14.11.2026): Kompetenzen, Blöcke, Krankmeldung, Berufsschule, Kommentare.
const bereich = Object.fromEntries(e.bereiche.map((b) => [b.kuerzel, b.id]));
for (const i of [1, 2, 3, 6, 9]) await q('select public.pep_kompetenz_setzen($1, $2, true) as r', [ids[i], bereich.KA]);
for (const i of [1, 5, 11]) await q('select public.pep_kompetenz_setzen($1, $2, true) as r', [ids[i], bereich.VP]);
const TAGE = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'];
// Je Mitarbeiter: Blöcke [von, bis, Kürzel] und der freie Tag (Index in TAGE). ids[0] hat die ganze Woche Urlaub.
const plan = {
  1: { frei: 2, bloecke: [['07:00', '12:30', 'KA'], ['12:30', '13:00', 'PA'], ['13:00', '15:30', 'KA']] },
  2: { frei: 3, bloecke: [['14:30', '17:30', 'KA'], ['17:30', '18:00', 'PA'], ['18:00', '20:00', 'KA']] },
  3: { frei: 4, bloecke: [['16:00', '20:00', 'KA']] },
  4: { frei: 5, bloecke: [['06:00', '09:00', 'OG'], ['09:00', '12:00', 'TS'], ['12:00', '12:30', 'PA'], ['12:30', '14:00', 'MO']] },
  5: { frei: 2, bloecke: [['06:00', '10:00', 'FÜ'], ['10:00', '10:30', 'PA'], ['10:30', '14:30', 'FÜ']] },
  6: { frei: 1, bloecke: [['07:00', '09:00', 'KA'], ['09:00', '11:00', 'BB']] },
  7: { frei: 5, bloecke: [['12:00', '16:00', 'TS'], ['16:00', '16:30', 'PA'], ['16:30', '20:00', 'TK']] },
  8: { frei: 4, bloecke: [['06:00', '10:00', 'TK'], ['10:00', '12:00', 'MO']] },
  9: { frei: 1, bloecke: [['12:30', '16:30', 'KA'], ['16:30', '17:00', 'PA'], ['17:00', '20:30', 'KA']] },
  10: { frei: 1, bloecke: [['17:00', '20:00', 'RE']] },
  11: { frei: 3, bloecke: [['13:00', '17:00', 'FÜ'], ['17:00', '17:30', 'PA'], ['17:30', '21:30', 'FÜ']] },
};
const malen = (m, datum, von, bis, kuerzel) => q('select public.pep_plan_malen($1, $2::date, $3::time, $4::time, $5) as r',
  [m, datum, von, bis, kuerzel ? bereich[kuerzel] : null]);
let gesperrt = 0;
for (const [i, p] of Object.entries(plan)) {
  for (const [t, datum] of TAGE.entries()) {
    if (t === p.frei) continue;
    for (const [von, bis, k] of p.bloecke) {
      try { await malen(ids[i], datum, von, bis, k); } catch { gesperrt += 1; } // abwesend (ZA, Berufsschule): Lücke
    }
  }
}
// Montag: Kassenkraft macht 11:00 Pause, niemand löst ab (Kasse unbesetzt + Pausenablöse fehlt).
await malen(ids[1], TAGE[0], '07:00', '15:30', 'KA');
await malen(ids[1], TAGE[0], '11:00', '11:30', 'PA');
// Zwei Kassenkräfte mit wenig Stunden als mögliche Ersatzleute; eine mag bevorzugt nur bis 18:00.
const reserve = [];
for (const [name, art, std] of [['Reserve, Mia', 'teilzeit', 20], ['Aushilfe, Nico', 'minijob', 10]]) {
  const id = await q('select public.pep_mitarbeiter_speichern(null, $1::jsonb) as r', [JSON.stringify({ name })]);
  await q('select public.pep_vertrag_speichern($1, $2::jsonb) as r', [id, JSON.stringify({ vertragsart: art, wochenstunden: std, gueltig_ab: '2026-01-01' })]);
  await q('select public.pep_kompetenz_setzen($1, $2, true) as r', [id, bereich.KA]);
  reserve.push(id);
}
for (const t of [1, 3]) await malen(reserve[0], TAGE[t], '08:00', '12:00', 'KA');
await q('select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [reserve[0], JSON.stringify(
  { art: 'nur_zwischen', von: '06:00', bis: '18:00', pflicht: false, gueltig_von: '2026-01-01', notiz: 'Kinderbetreuung: nur bis 18:00' })]);
// Montag: Krankmeldung (Schnellerfassung) über geplanten Blöcken (werden unbesetzt), Berufsschule 08–13 mitten in der Frühschicht.
await q(`select public.pep_schnell_abwesend($1, 'KM', $2::date, $2::date) as r`, [ids[3], TAGE[0]]);
await q(`select public.pep_abwesenheit_setzen($1, $2, $3::date, $3::date, 5, '08:00', '13:00', null) as r`, [ids[8], code.BS, TAGE[0]]);
await malen(ids[8], TAGE[0], '13:30', '17:30', 'TS');
await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[5], TAGE[0], 'Lieferung TroSo annehmen']);
await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[11], TAGE[0], 'Abschluss, Schlüssel']);
await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[7], TAGE[1], 'Inventur TK vorbereiten']);
console.log(`Einsatzplan: ${gesperrt} Striche wegen Abwesenheit übersprungen`);
// Eckdaten-Fenster für „Demo, Emil“ (ids[4]): Vorwoche KW 45 überwiegend früh, Samstag 07.11. spät, Vorgaben
// (eine Pflicht), Kommentar, ZA am 20.11.; im November außerdem Urlaub 23.–28.11. (Samstag 28.11. frei mit U).
for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) await malen(ids[4], d, '06:00', '12:00', 'OG');
await malen(ids[4], '2026-11-05', '12:00', '20:00', 'OG');
await malen(ids[4], '2026-11-07', '13:00', '21:30', 'TK');
await q('select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [ids[4], JSON.stringify(
  { art: 'nicht_verfuegbar', max_stunden_tag: 9, pflicht: true, gueltig_von: '2026-01-01', notiz: 'ärztliche Vorgabe' })]);
await q('select public.pep_wochenvorgabe_speichern($1, $2::jsonb) as r', [ids[4], JSON.stringify(
  { art: 'nur_zwischen', wochentag: 2, von: '06:00', bis: '14:00', pflicht: false, gueltig_von: '2026-01-01', notiz: 'Sportverein dienstags' })]);
await q('select public.pep_kommentar_setzen($1, $2::date, $3) as r', [ids[4], TAGE[0], 'Obstlieferung prüfen']);
await setzen(ids[4], 'ZA', '2026-11-20', '2026-11-20');
// Vorlagen für den Dialog „Vorlagen“; die Probe-Kopie KW 46 → KW 47 zeigt den Bericht mit echten Daten
// (Urlaub, Krankmeldung, Berufsschule) und wird danach zurückgerollt, damit KW 47 leer bleibt.
await q(`select public.pep_vorlage_speichern('Standardwoche November', 'woche', $1::date) as r`, [TAGE[0]]);
await q(`select public.pep_vorlage_speichern('Samstag kurz', 'tag', $1::date) as r`, [TAGE[5]]);
await db.exec('begin');
console.log('Probe-Kopie KW 46 → KW 47:', JSON.stringify(await q(
  `select public.pep_woche_kopieren(2026, 46, '[{"jahr":2026,"kw":47}]', 'leere') as r`)));
await db.exec('rollback');

// Vorausplanung ab KW 46: Planumsatz für drei Wochen (eine mit eigener Stundenleistung), eine manuelle Vorgabe,
// der Rest ohne Planumsatz. Zuletzt, damit die Wochen KW 46/47 die Abwesenheiten und Blöcke oben enthalten.
const woche = (kw, daten) => q('select public.pep_woche_speichern(2026, $1, $2::jsonb) as r', [kw, JSON.stringify(daten)]);
await woche(46, { planumsatz: 61000 });
await woche(47, { planumsatz: 52500, stundenvorgabe_manuell: 240 });
await woche(48, { planumsatz: 70000, stundenleistung_eur_pro_h: 210 });

const aus = new URL('./daten/', import.meta.url);
const schreib = (name, wert) => writeFileSync(new URL(`${name}.json`, aus), JSON.stringify(wert, null, 1));
schreib('pep_ich', await q('select public.pep_ich() as r'));
// Die Attrappe kennt keine Parameter: Kandidaten für den ersten roten Block der Woche (Krankmeldung Montag).
schreib('pep_ersatz_kandidaten', await q('select public.pep_ersatz_kandidaten($1, $2::date) as r', [ids[3], TAGE[0]]));
schreib('pep_abwesenheiten', await q('select public.pep_abwesenheiten(2026, 11) as r'));
schreib('pep_mitarbeiter_liste', await q('select public.pep_mitarbeiter_liste() as r'));
// Die Attrappe kennt keine Parameter: pep_mitarbeiter ist immer der erste Mitarbeiter.
schreib('pep_mitarbeiter', await q('select public.pep_mitarbeiter($1) as r', [ids[0]]));
schreib('pep_bereiche', await q('select public.pep_bereiche() as r'));
schreib('pep_feiertage', await q('select public.pep_feiertage(2026) as r'));
schreib('pep_urlaub_umfragen', await q('select public.pep_urlaub_umfragen() as r'));
schreib('pep_urlaub_zuordnung', await q('select public.pep_urlaub_zuordnung() as r'));
schreib('pep_einsatzplan_woche', await q('select public.pep_einsatzplan_woche(2026, 46) as r'));
schreib('pep_vorlagen', await q('select public.pep_vorlagen() as r'));
schreib('pep_vorausplanung', await q('select public.pep_vorausplanung(2026, 46) as r'));
schreib('pep_resturlaub', await q('select public.pep_resturlaub(2026) as r'));
// Startseite: zuletzt, mit zwei offenen Urlaubswünschen aus einer Urlaubstool-Umfrage und einer Woche mit Stunden-Lücke
// (KW 50, Planumsatz 95 000). Beides entsteht erst nach den übrigen Dateien, damit deren Vorschau (Abwesenheiten,
// Einsatzplan, Vorausplanung) unverändert bleibt.
await woche(50, { planumsatz: 95000 });
const umfrage = await umfrageAnlegen(db, leitung, { titel: 'Urlaub 2026', jahr: 2026 });
const frage = await urlaubsfrageId(db, umfrage);
await q('select public.pep_urlaub_umfrage_schalten($1, true) as r', [umfrage]);
for (const [i, kw] of [[6, 48], [11, 47]]) {
  const tn = await umfrageMitarbeiter(db, umfrage, namen[i]);
  await q('select public.pep_urlaub_zuordnung_setzen($1, $2) as r', [tn.id, ids[i]]);
  await abgeben(db, tn.code, { [frage]: [kw] });
}

// IST-Modus KW 46 (pep_ist_woche), ganz zuletzt, damit alle übrigen Dateien unverändert bleiben. „Heute“ ist dafür
// Do 12.11.: Mo und Di bestätigt (Mo mit einer Änderung samt Grund), Mi gemischt, Do offen mit Vorschlag, Fr/Sa künftig.
await heuteSetzen(db, '2026-11-12');
const istMalen = (m, datum, von, bis, kuerzel, grund = null) => q(
  'select public.pep_ist_malen($1, $2::date, $3::time, $4::time, $5, $6) as r', [m, datum, von, bis, kuerzel ? bereich[kuerzel] : null, grund]);
const bestaetigen = (datum, mids = null) => q(
  `select public.pep_ist_bestaetigen($1::date, ${mids ? `array[${mids.join(',')}]` : 'null'}::bigint[]) as r`, [datum]);
await istMalen(ids[2], TAGE[1], '14:30', '15:00', null); // Di: 30 Minuten später gekommen
await bestaetigen(TAGE[0]);
await bestaetigen(TAGE[1]);
await istMalen(ids[1], TAGE[0], '15:30', '16:30', 'KA', 'Kassenabschluss übernommen'); // bestätigter Tag: mit Grund
await istMalen(ids[3], TAGE[2], '20:00', '21:00', 'KA'); // Mi: eine Stunde länger
await istMalen(ids[4], TAGE[2], '05:30', '06:00', 'OG'); // Mi: vor der Rahmenzeit angefangen (Raster ab 05:30)
await istMalen(ids[6], TAGE[2], '10:30', '11:00', null); // Mi: früher gegangen
await q('select public.pep_ist_zeile_setzen($1, $2::date, $3::jsonb, null) as r', [ids[8], TAGE[2], '[]']); // Mi: nicht gekommen
await bestaetigen(TAGE[2], [ids[11]]); // Mi: eine Zeile einzeln bestätigt
schreib('pep_ist_woche', await q('select public.pep_ist_woche(2026, 46) as r'));

// Zeitkonto, nach dem IST (damit pep_ist_woche unverändert bleibt); „heute“ bleibt Do 12.11. KW 45 (02.–07.11.) bekommt
// IST nach dem Muster des Plans von KW 46 (Emil hat dort eigenen Plan und bekommt beim Bestätigen den Vorschlag),
// alle Tage werden bestätigt und die Woche abgeschlossen. Davor drei Startsalden (Ben und Anna über dem Warnwert),
// danach eine Änderung mit Grund in KW 45 (automatische Korrektur) und eine Korrektur von Hand in KW 46.
// KW 46 bleibt offen (Mi teilweise, Do offen). Die Attrappe liefert pep_zeitkonto_woche je Woche
// (pep_zeitkonto_woche_2026_45.json), das Journal immer das von „Demo, Emil“.
const KW45 = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'];
const istPlan = { ...plan, 0: { frei: 6, bloecke: [['06:00', '12:30', 'OG']] } };
let istGesperrt = 0;
for (const [i, p] of Object.entries(istPlan)) {
  if (Number(i) === 4) continue; // Emil: Vorschlag aus seinem Plan
  for (const [t, datum] of KW45.entries()) {
    if (t === p.frei) continue;
    for (const [von, bis, k] of p.bloecke) {
      try { await istMalen(ids[i], datum, von, bis, k); } catch { istGesperrt += 1; } // abwesend (KM, Berufsschule)
    }
  }
}
const buchen = (m, art, stunden, grund, datum) => q('select public.pep_zeitkonto_buchen($1, $2, $3, $4, $5::date) as r',
  [m, art, stunden, grund, datum]);
await buchen(ids[1], 'start', 45, 'Übernahme aus der bisherigen Liste', '2026-11-01');
await buchen(ids[0], 'start', -40, 'Übernahme aus der bisherigen Liste', '2026-11-01');
await buchen(ids[4], 'start', 12.5, 'Übernahme aus der bisherigen Liste', '2026-11-01');
for (const d of KW45) await bestaetigen(d);
console.log(`Zeitkonto: ${istGesperrt} IST-Striche wegen Abwesenheit übersprungen; Abschluss KW 45:`,
  JSON.stringify(await q('select public.pep_wochenabschluss(2026, 45) as r')));
await istMalen(ids[4], KW45[1], '12:00', '13:00', 'OG', 'Inventur länger'); // bestätigt und abgeschlossen: Korrektur +1
await buchen(ids[4], 'manuell', -4, 'Überstunden ausgezahlt', TAGE[0]);
schreib('pep_zeitkonto_woche', await q('select public.pep_zeitkonto_woche(2026, 46) as r'));
schreib('pep_zeitkonto_woche_2026_45', await q('select public.pep_zeitkonto_woche(2026, 45) as r'));
// KW 44 liegt vor dem Start der IST-Erfassung (ist_ab = 02.11.): Diff nur zur Ansicht, kein „Woche buchen“.
schreib('pep_zeitkonto_woche_2026_44', await q('select public.pep_zeitkonto_woche(2026, 44) as r'));
schreib('pep_zeitkonto_journal', await q('select public.pep_zeitkonto_journal($1, null, null) as r', [ids[4]]));

// Startseite, Eckdaten und Einstellungen ganz zuletzt, damit sie das Zeitkonto zeigen (Stufe 2; „heute“ bleibt Do 12.11.):
// Kachel „Zeitkonto auffällig“ (KW 45 abgeschlossen, Ben und Anna über dem Warnwert), Kachel „IST offen“ (der
// gemischte Mi 11.11.; Tage vor dem Start der IST-Erfassung ist_ab = Mo 02.11., dem Montag beim Anlegen, zählen nicht),
// Zeitkonto-Zeile der Eckdaten und der Hinweis an den Codes (abschluss_vorhanden).
schreib('pep_startseite', await q('select public.pep_startseite() as r'));
// Die Attrappe kennt keine Parameter: Eckdaten immer für „Demo, Emil“ am Montag der Vorschauwoche.
schreib('pep_eckdaten', await q('select public.pep_eckdaten($1, $2::date) as r', [ids[4], TAGE[0]]));
schreib('pep_einstellungen', await q('select public.pep_einstellungen() as r'));
// Stundenblatt (nur lesend, ändert nichts): 31 Tage Mo 12.10.–Mi 11.11. – vor dem Start der IST-Erfassung (ist_ab
// 02.11.), KW 45 bestätigt und abgeschlossen, KW 46 gemischt. Die ersten drei Personen von „alle“ (Anna mit Urlaub,
// Ben, Cem mit KM), damit der PDF-Druck drei Seiten zeigen muss.
const blatt = await q('select public.pep_stundenblatt(null, $1::date, $2::date) as r', ['2026-10-12', '2026-11-11']);
schreib('pep_stundenblatt', { ...blatt, mitarbeiter: blatt.mitarbeiter.slice(0, 3) });
console.log('Vorschau-Daten geschrieben');

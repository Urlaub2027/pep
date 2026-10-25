// Reine Logik des IST-Modus im Einsatzplan (docs/ist-ansicht.js), ohne DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istSpalten, zeilenStatus, istAbweichung, offeneTage, tagesSummen, planUmriss } from '../docs/ist-ansicht.js';
import { strich, zellen } from '../docs/plan-raster.js';

const TAG = { datum: '2026-11-11', geoeffnet: true, rahmen_von: '06:00', rahmen_bis: '21:30', ist_erlaubt: true };
const seg = (mitarbeiter_id, von, bis, bereich_id = 1, extra = {}) => ({
  id: extra.id ?? 1, mitarbeiter_id, datum: '2026-11-11', von, bis, bereich_id, unbesetzt: false, vorschlag: false, ...extra,
});

test('istSpalten: min(Rahmen, frühester Block, 06:00) bis max(Rahmen, spätester Block); erweitert 04:00–24:00', () => {
  const sp = istSpalten(TAG, []);
  assert.equal(sp[0], '06:00');
  assert.equal(sp.at(-1), '21:00');
  assert.equal(istSpalten({ ...TAG, rahmen_von: '07:00' }, [])[0], '06:00'); // nie später als 06:00
  const weit = istSpalten(TAG, [seg(1, '05:30', '06:00'), seg(2, '21:00', '23:00')]);
  assert.equal(weit[0], '05:00'); // frühester Block 05:30, Beginn auf die volle Stunde
  assert.equal(weit.at(-1), '22:30');
  const nacht = istSpalten(TAG, [seg(1, '22:00', '24:00')]); // Mitternacht kommt als '24:00'
  assert.equal(nacht.at(-1), '23:30');
  assert.deepEqual(strich(nacht, nacht.length - 4, nacht.length - 1), { von: '22:00', bis: '24:00' });
  const voll = istSpalten(TAG, [], true);
  assert.equal(voll.length, 40);
  assert.equal(voll[0], '04:00');
  assert.equal(voll.at(-1), '23:30');
  // Geschlossener Tag (Rahmen leer): 06:00–22:00 und die Blöcke
  assert.deepEqual([istSpalten({ geoeffnet: false }, [])[0], istSpalten({ geoeffnet: false }, []).at(-1)], ['06:00', '21:30']);
  assert.equal(istSpalten({ geoeffnet: false }, [seg(1, '04:00', '05:00')])[0], '04:00');
});

test('zeilenStatus: keine, bestätigt, offen mit Vorschlag, offen mit IST, offen leer, offen ohne Plan', () => {
  const woche = {
    status: [
      { mitarbeiter_id: 1, datum: TAG.datum, bestaetigt: true },
      { mitarbeiter_id: 2, datum: TAG.datum, bestaetigt: false },
      { mitarbeiter_id: 3, datum: TAG.datum, bestaetigt: false },
      { mitarbeiter_id: 4, datum: TAG.datum, bestaetigt: false },
      { mitarbeiter_id: 5, datum: TAG.datum, bestaetigt: false },
    ],
    bloecke: [seg(1, '08:00', '12:00'), seg(2, '08:00', '12:00', 1, { id: -1, vorschlag: true }), seg(3, '08:00', '13:00')],
    plan_bloecke: [seg(2, '08:00', '12:00'), seg(3, '08:00', '12:00'), seg(4, '08:00', '12:00'),
      seg(5, '08:00', '12:00', 1, { unbesetzt: true })],
  };
  assert.equal(zeilenStatus(woche, 9, TAG.datum).art, 'keine');
  assert.deepEqual([zeilenStatus(woche, 1, TAG.datum).art, zeilenStatus(woche, 1, TAG.datum).text], ['bestaetigt', 'bestätigt ✓']);
  assert.deepEqual([zeilenStatus(woche, 2, TAG.datum).art, zeilenStatus(woche, 2, TAG.datum).text], ['vorschlag', 'offen']);
  assert.equal(zeilenStatus(woche, 3, TAG.datum).art, 'offen');
  // Plan besetzt, aber kein Vorschlag und kein IST: ausdrücklich leer gemacht (pep.ist_leer)
  assert.deepEqual([zeilenStatus(woche, 4, TAG.datum).art, zeilenStatus(woche, 4, TAG.datum).text], ['leer', 'offen, leer']);
  // Plan nur unbesetzt (abwesend): kein Vorschlag zu erwarten, also nicht „leer“
  assert.equal(zeilenStatus(woche, 5, TAG.datum).art, 'offen');
});

test('istAbweichung: IST − Plan ohne Pause und ohne unbesetzte Teile', () => {
  const woche = {
    bereiche: [{ id: 1, art: 'bereich' }, { id: 10, art: 'pause' }],
    bloecke: [seg(1, '08:00', '12:00'), seg(1, '12:00', '12:30', 10), seg(1, '12:30', '17:30')],
    plan_bloecke: [seg(1, '08:00', '12:00'), seg(1, '12:00', '12:30', 10), seg(1, '12:30', '16:30'),
      seg(1, '16:30', '18:00', 1, { unbesetzt: true })],
  };
  assert.deepEqual(istAbweichung(woche, 1, TAG.datum), { ist: 9, plan: 8, diff: 1 });
  assert.deepEqual(istAbweichung(woche, 2, TAG.datum), { ist: 0, plan: 0, diff: 0 });
});

test('offeneTage: offene Zeilen je Tag in Datumsfolge', () => {
  const woche = {
    status: [
      { mitarbeiter_id: 2, datum: '2026-11-10', bestaetigt: false },
      { mitarbeiter_id: 1, datum: '2026-11-09', bestaetigt: true },
      { mitarbeiter_id: 1, datum: '2026-11-10', bestaetigt: false },
      { mitarbeiter_id: 3, datum: '2026-11-09', bestaetigt: false },
    ],
  };
  assert.deepEqual(offeneTage(woche), [{ datum: '2026-11-09', ids: [3] }, { datum: '2026-11-10', ids: [2, 1] }]);
  assert.deepEqual(offeneTage({ status: [] }), []);
});

test('tagesSummen: Plan und IST je Mitarbeiter, nur wer geplant, erfasst oder eine Zeile hat', () => {
  const woche = {
    mitarbeiter: [{ id: 1, name: 'Test, Anna' }, { id: 2, name: 'Muster, Ben' }, { id: 3, name: 'Beispiel, Cem' }],
    bereiche: [{ id: 1, art: 'bereich' }],
    status: [{ mitarbeiter_id: 3, datum: TAG.datum, bestaetigt: false }],
    bloecke: [seg(1, '08:00', '12:00')],
    plan_bloecke: [seg(1, '08:00', '11:00')],
  };
  assert.deepEqual(tagesSummen(woche, TAG.datum), [
    { id: 1, name: 'Test, Anna', plan: 3, ist: 4 },
    { id: 3, name: 'Beispiel, Cem', plan: 0, ist: 0 },
  ]);
});

test('planUmriss: Umriss über zusammenhängende Plan-Halbstunden, Kanten an Anfang und Ende', () => {
  const sp = ['08:00', '08:30', '09:00', '09:30', '10:00'];
  const plan = zellen([seg(1, '08:30', '09:30', 1, { id: 5 }), seg(1, '09:30', '10:00', 10, { id: 6 })], sp);
  assert.deepEqual(sp.map((_, i) => planUmriss(plan, i)), [
    [], ['plan', 'plan-a'], ['plan'], ['plan', 'plan-e'], [],
  ]);
});

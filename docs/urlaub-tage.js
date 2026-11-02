// Urlaubsjahre in Tagen eingeben (Mitarbeiterkarte): gespeichert wird weiter in Stunden, umgerechnet mit den Stunden je
// Urlaubstag = Wochenstunden ÷ Abwesenheits-Teiler (Einstellung, Vorgabe 6; 37,5 h ÷ 6 = 6,25 h).
// FACHREGEL-DUPLIKAT: dieselbe Vertragswahl wie public.pep_resturlaub (supabase/schema.sql, „tagesstunden“): Vertrag am
// 01.01. (der letzte davor), sonst der erste im Jahr; ohne beides null. Ändert sich die Regel dort, hier nachziehen.
const rund2 = (n) => Math.round(n * 100) / 100;
const tag = (d) => String(d).slice(0, 10);

export function urlaubTagesstunden(vertraege, jahr, teiler) {
  const t = Number(teiler);
  if (!t) return null;
  const von = `${jahr}-01-01`;
  const kandidaten = (vertraege ?? []).filter((x) => tag(x.gueltig_ab) <= `${jahr}-12-31`);
  const davor = kandidaten.filter((x) => tag(x.gueltig_ab) <= von).sort((a, b) => tag(b.gueltig_ab).localeCompare(tag(a.gueltig_ab)));
  const danach = kandidaten.filter((x) => tag(x.gueltig_ab) > von).sort((a, b) => tag(a.gueltig_ab).localeCompare(tag(b.gueltig_ab)));
  const v = davor[0] ?? danach[0];
  return v ? Number(v.wochenstunden) / t : null;
}

export const tageZuStunden = (tage, tagesstunden) => rund2(Number(tage) * tagesstunden);
export const stundenZuTage = (stunden, tagesstunden) => (stunden == null ? null : rund2(Number(stunden) / tagesstunden));

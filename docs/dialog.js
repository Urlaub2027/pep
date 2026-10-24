// Gemeinsamer modaler Dialog aller Reiter (aus abwesenheiten.js herausgelöst).
import { meldung, fehlerText, element } from './hilfe.js';

// aktionen: [{ text, aktion, danach, sekundaer, gefahr }]. Fehler erscheinen im Dialog; bei Erfolg schließt er
// und `danach` läuft. Ohne `sekundaer`/`gefahr` ist die Aktion die (gelbe) Hauptaktion. „Abbrechen“ gibt es immer;
// reine Anzeige-Dialoge nennen den Knopf mit `schliessenText` z. B. „Schließen“.
export function dialog(titel, koerper, aktionen, beimSchliessen = () => {}, schliessenText = 'Abbrechen') {
  const fehlerZeile = element('p', { class: 'meldung fehler', role: 'alert', hidden: true });
  const knoepfe = aktionen.map((a) => element('button', {
    type: 'button', class: `knopf${a.gefahr ? ' gefahr' : a.sekundaer ? '' : ' primaer'}`,
    onclick: async () => {
      fehlerZeile.hidden = true;
      alle.forEach((k) => { k.disabled = true; });
      let geschafft = false;
      try {
        await a.aktion();
        geschafft = true;
        d.close();
      } catch (fehler) {
        if (fehler.behandelt) d.close();
        else { fehlerZeile.textContent = fehlerText(fehler.message); fehlerZeile.hidden = false; }
      } finally {
        alle.forEach((k) => { k.disabled = false; });
      }
      // Fehler beim Neuladen erscheinen auf der Seite, der Dialog ist dann schon geschlossen.
      if (geschafft && a.danach) {
        try { await a.danach(); } catch (fehler) { if (!fehler.behandelt) meldung(fehlerText(fehler.message)); }
      }
    },
  }, a.text));
  const abbrechen = element('button', { type: 'button', class: 'knopf', onclick: () => d.close() }, schliessenText);
  const alle = [...knoepfe, abbrechen];
  const d = element('dialog', { class: 'dialog' }, element('h2', {}, titel), ...koerper, fehlerZeile,
    element('div', { class: 'dialog-knoepfe' }, ...alle));
  d.addEventListener('close', () => { d.remove(); beimSchliessen(); });
  document.body.append(d);
  d.showModal();
  return d;
}

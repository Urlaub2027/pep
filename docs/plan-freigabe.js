// Einsatzplan, Wochenansicht: Freigabe der Woche für die Mitarbeiter-Ansicht (Leitung und Stellvertretung).
import { element } from './hilfe.js';
import { tagDE } from './zugang-text.js';

// woche = Antwort von pep_einsatzplan_woche (jahr, kw, freigabe); `setzen(frei)` ruft pep_woche_freigeben und lädt neu.
export function freigabeZeile(woche, setzen) {
  const f = woche.freigabe;
  // von_name kann fehlen (Freigebender ohne Organisator-Eintrag): dann ohne Namen
  const text = f ? `Freigegeben am ${tagDE(f.am)}${f.von_name ? ` von ${f.von_name}` : ''}` : 'Für Mitarbeiter noch nicht freigegeben.';
  return element('div', { class: 'ep-freigabe', 'data-freigabe': f ? 'ja' : 'nein' },
    element('span', { class: 'hinweis' }, text),
    element('button', { type: 'button', class: f ? 'knopf' : 'knopf primaer', onclick: () => setzen(!f) },
      f ? 'Freigabe zurücknehmen' : 'Woche für Mitarbeiter freigeben'));
}

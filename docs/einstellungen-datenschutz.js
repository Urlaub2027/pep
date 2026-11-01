// Einstellungen, Abschnitt „Datenschutz“: der Text, dem Mitarbeiter bei der ersten Anmeldung zustimmen.
// Ändern nur die Leitung; ein geänderter Text wird eine neue Version, alle müssen dann erneut zustimmen.
import { element, abschnitt, fuehreAus } from './hilfe.js';
import { DATENSCHUTZ_ENTWURF, tagDE } from './zugang-text.js';

// stand = Antwort von pep_datenschutz ({ version, text, am } oder null); neuLaden holt sie neu und zeichnet.
// kollegen = Schalter „Kollegen in der Mitarbeiter-Ansicht“ (Vorgabe true); kollegenSetzen(wert) speichert und zeichnet neu.
export function zeichneDatenschutz(box, stand, { darfSchreiben, aufruf, neuLaden, kollegen = true, kollegenSetzen }) {
  const text = element('textarea', { class: 'datenschutz-text', rows: 14, disabled: !darfSchreiben, 'aria-label': 'Datenschutztext' });
  text.value = stand?.text ?? '';
  const speichern = () => fuehreAus(() => aufruf('pep_datenschutz_speichern', { p_text: text.value }), neuLaden);
  const haken = element('input', { type: 'checkbox', class: 'schalter', role: 'switch', disabled: !darfSchreiben });
  haken.checked = kollegen;
  haken.addEventListener('change', () => { haken.disabled = true; kollegenSetzen(haken.checked); });
  box.replaceChildren(abschnitt('Datenschutz',
    element('label', { class: 'zeile' }, haken, ' Mitarbeiter sehen Kollegen am selben Tag'),
    element('p', { class: 'hinweis' }, 'Aus: Mitarbeiter sehen nur ihre eigenen Zeiten; Kollegennamen werden gar nicht erst übertragen.'),
    element('p', { class: 'hinweis' }, 'Diesen Text bestätigen Mitarbeiter bei der ersten Anmeldung. Ohne Text gibt es keinen Zugang. '
      + 'Ändert sich der Text, müssen alle erneut zustimmen.'),
    element('p', {}, stand ? `Aktuell: Version ${stand.version} vom ${tagDE(stand.am)}` : 'Noch kein Text hinterlegt.'),
    element('label', { class: 'feld breit' }, 'Text', text),
    darfSchreiben ? element('div', { class: 'zeile' },
      element('button', { type: 'button', class: 'knopf primaer', onclick: speichern }, 'Speichern'),
      element('button', { type: 'button', class: 'knopf', onclick: () => { text.value = DATENSCHUTZ_ENTWURF; } }, 'Entwurf einfügen'),
      element('span', { class: 'hinweis' }, 'Der Entwurf ist rechtlich nicht geprüft.')) : null));
}

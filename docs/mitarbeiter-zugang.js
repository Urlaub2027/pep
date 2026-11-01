// Mitarbeiter-Karte, Abschnitt „Zugang“: Stand, Einladungslink, Sperren/Entsperren (nur Leitung).
// Wird von mitarbeiter.js mit dessen `speichere` und `aufruf` aufgerufen; der Link steht nur, solange der Server eine offene, gültige Einladung meldet (`gueltig_bis`, auch neben
// einem aktiven Konto) und die Karte dieser Person offen bleibt (Sperren/Entsperren und der Wechsel zu einer anderen
// Person lassen ihn verschwinden).
import { element, abschnitt, meldung } from './hilfe.js';
import { dialog } from './dialog.js';
import { einladungsLink, zugangsStandText, tagDE } from './zugang-text.js';

let einladung = null; // { id, link, gueltig_bis } der zuletzt erzeugten Einladung

function linkZeile(link) {
  const feld = element('input', { type: 'text', readonly: true, class: 'zugang-link', 'aria-label': 'Einladungslink', value: link });
  const kopieren = element('button', { type: 'button', class: 'knopf', onclick: async () => {
    try { await navigator.clipboard.writeText(link); meldung('Link kopiert.', 'ok'); } catch { feld.select(); meldung('Bitte den markierten Link von Hand kopieren.', 'ergebnis'); }
  } }, 'Kopieren');
  const teilen = typeof navigator.share === 'function'
    ? element('button', { type: 'button', class: 'knopf', onclick: () => navigator.share({ title: 'PEP-Zugang', url: link }).catch(() => {}) }, 'Teilen')
    : null;
  return element('div', { class: 'zeile zugang-linkzeile' }, feld, kopieren, teilen);
}

export function zugangAbschnitt(m, { speichere, aufruf }) {
  if (einladung && einladung.id !== m.id) einladung = null; // Karte einer anderen Person
  const zugang = m.zugang ?? { stand: 'kein' };
  const frage = (titel, text, knopf, aktion, gefahr = false) =>
    dialog(titel, [element('p', {}, text)], [{ text: knopf, gefahr, aktion }]);
  const einladen = (text) => element('button', { type: 'button', class: 'knopf primaer', onclick: () => speichere(async () => {
    const r = await aufruf('pep_zugang_einladen', { p_mitarbeiter_id: m.id });
    einladung = { id: m.id, link: einladungsLink(location.href, r.code), gueltig_bis: r.gueltig_bis };
  }) }, text);
  const sperren = (gesperrt) => element('button', { type: 'button', class: 'knopf', onclick: () => frage(
    gesperrt ? 'Zugang sperren?' : 'Zugang entsperren?',
    gesperrt ? `${m.name} kann sich nicht mehr anmelden; offene Einladungen werden ungültig.`
      : `${m.name} kann sich wieder anmelden.`,
    gesperrt ? 'Sperren' : 'Entsperren',
    () => speichere(async () => {
      einladung = null; // Sperren macht offene Einladungen ungültig, Entsperren stellt sie nicht wieder her
      await aufruf('pep_zugang_sperren', { p_mitarbeiter_id: m.id, p_gesperrt: gesperrt });
    }), gesperrt) },
  gesperrt ? 'Sperren' : 'Entsperren');

  // Gesperrt: nur „Entsperren“ (einladen ginge nicht: ZUGANG_GESPERRT). Ruht (inaktiv oder ausgetreten): kein neuer
  // Link, der Server lehnt ihn ab (MITARBEITER_INAKTIV); Sperren bleibt möglich.
  const knoepfe = {
    kein: [einladen('Zugang einrichten')],
    eingeladen: [einladen('Neuer Link'), sperren(true)],
    aktiv: [einladen('Neuer Link'), sperren(true)],
    ruht: [sperren(true)],
    gesperrt: [sperren(false)],
  }[zugang.stand] ?? [];
  const zeigeLink = einladung?.id === m.id && zugang.gueltig_bis && zugang.stand !== 'gesperrt';
  return abschnitt('Zugang',
    element('p', {}, `Stand: ${zugangsStandText(zugang)}`),
    zugang.zustimmung_am ? element('p', { class: 'hinweis' }, `Datenschutz bestätigt am ${tagDE(zugang.zustimmung_am)}`) : null,
    element('div', { class: 'zeile' }, knoepfe),
    zeigeLink ? element('div', {},
      element('p', { class: 'hinweis' }, `Einladungslink für ${m.name}, gültig bis ${tagDE(einladung.gueltig_bis)}. Er bleibt sichtbar, solange er gültig ist und du diese Karte offen lässt.`),
      linkZeile(einladung.link)) : null);
}

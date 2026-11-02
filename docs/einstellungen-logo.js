// Einstellungen, Abschnitt „Logo für PEP Mitarbeiter“: das Logo oben rechts auf dem Ausdruck „PEP Mitarbeiter“ (Einsatzplan →
// Drucken). Es liegt in der Datenbank der Filiale (pep.filialen.logo), nie im öffentlichen Repo. Vor dem Speichern
// wird es im Browser verkleinert, damit die data-URL klein bleibt (die Datenbank nimmt höchstens 400.000 Zeichen).
import { element, abschnitt, fuehreAus } from './hilfe.js';

const MAX_HOEHE = 200;
const MAX_BREITE = 800;

// Zielgröße in Pixeln: höchstens MAX_HOEHE hoch und MAX_BREITE breit, Seitenverhältnis bleibt, nie vergrößern.
export function logoMasse(breite, hoehe) {
  const faktor = Math.min(1, MAX_HOEHE / hoehe, MAX_BREITE / breite);
  return { breite: Math.round(breite * faktor), hoehe: Math.round(hoehe * faktor) };
}

// Datei → verkleinerte data-URL (JPEG bleibt JPEG, alles andere wird PNG). Kein Bild: Fehler BILD_UNGUELTIG.
// Eingelesen als data-URL, nicht über URL.createObjectURL: die CSP der Seite erlaubt Bilder nur aus 'self' und data:.
async function verkleinern(datei) {
  const quelle = await new Promise((fertig, fehler) => {
    const leser = new FileReader();
    leser.onload = () => fertig(leser.result);
    leser.onerror = () => fehler(new Error('BILD_UNGUELTIG'));
    leser.readAsDataURL(datei);
  });
  const bild = new Image();
  bild.src = quelle;
  await bild.decode().catch(() => { throw new Error('BILD_UNGUELTIG'); });
  const { breite, hoehe } = logoMasse(bild.naturalWidth, bild.naturalHeight);
  const leinwand = element('canvas', { width: breite, height: hoehe });
  leinwand.getContext('2d').drawImage(bild, 0, 0, breite, hoehe);
  return datei.type === 'image/jpeg' ? leinwand.toDataURL('image/jpeg', 0.9) : leinwand.toDataURL('image/png');
}

// logo = Antwort von pep_filiale_logo (data-URL oder null); neuLaden holt es neu und zeichnet.
export function zeichneLogo(box, logo, { darfSchreiben, aufruf, neuLaden }) {
  // bild: data-URL, null (entfernen) oder eine Datei, die erst verkleinert wird (Fehler zeigt fuehreAus an).
  const speichere = (bild) => fuehreAus(async () => aufruf('pep_filiale_logo_speichern',
    { p_bild: bild instanceof Blob ? await verkleinern(bild) : bild }), neuLaden);
  const datei = element('input', { type: 'file', accept: 'image/png,image/jpeg', 'aria-label': 'Logo-Datei' });
  datei.addEventListener('change', () => { if (datei.files?.[0]) speichere(datei.files[0]); });
  box.replaceChildren(abschnitt('Logo für PEP Mitarbeiter',
    element('p', { class: 'hinweis' }, 'Erscheint oben rechts auf dem Ausdruck „PEP Mitarbeiter“ (Einsatzplan → Drucken). '
      + 'PNG oder JPG; das Bild wird beim Hochladen verkleinert.'),
    logo ? element('img', { class: 'einst-logo', src: logo, alt: 'Logo der Filiale' }) : element('p', {}, 'Kein Logo hinterlegt.'),
    darfSchreiben ? element('div', { class: 'zeile' },
      element('label', { class: 'feld' }, logo ? 'Anderes Logo' : 'Logo hochladen', datei),
      logo ? element('button', { type: 'button', class: 'knopf', onclick: () => speichere(null) }, 'Logo entfernen') : null) : null));
}

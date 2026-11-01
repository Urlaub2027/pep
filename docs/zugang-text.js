// Reine Texte der Zugangs-Oberfläche (Mitarbeiter-Karte, Einstellungen „Datenschutz“). Kein DOM, kein Netz.

// Datum einer Zeitangabe der Datenbank in deutscher Schreibweise (Berliner Tag, nicht UTC).
function tagDE(zeitpunkt) {
  if (!zeitpunkt) return '';
  const d = new Date(zeitpunkt);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
}
export { tagDE };

// Einladungslink: Adresse der PEP-Seite ohne ihren Hash, dazu #zugang=<code>.
export function einladungsLink(basisUrl, code) {
  return `${String(basisUrl).split('#')[0]}#zugang=${code}`;
}

// Stand des Mitarbeiter-Zugangs als Satzteil für die Karte.
export function zugangsStandText(zugang) {
  const mit = (text, zeitpunkt) => (tagDE(zeitpunkt) ? `${text} ${tagDE(zeitpunkt)}` : text.replace(/ (bis|seit)$/, ''));
  switch (zugang?.stand) {
    case 'eingeladen': return mit('eingeladen bis', zugang.gueltig_bis);
    case 'aktiv': return mit('aktiv seit', zugang.aktiv_seit);
    case 'ruht': return 'ruht (inaktiv oder ausgetreten)';
    case 'gesperrt': return 'gesperrt';
    default: return 'kein Zugang';
  }
}

// Vorlage für den Datenschutztext der Mitarbeiter-Ansicht. Muss von der Leitung geprüft und angepasst werden.
export const DATENSCHUTZ_ENTWURF = [
  'Entwurf – rechtlich nicht geprüft',
  '',
  'Datenschutzhinweis zur Mitarbeiter-Ansicht des Personaleinsatzplans (PEP)',
  '',
  'Wofür wir deine Daten verarbeiten: Du kannst in der Mitarbeiter-Ansicht deinen Einsatzplan, deinen Urlaub und dein Zeitkonto einsehen.',
  '',
  'Welche Daten: dein Name, dein Benutzername, deine freigegebenen Dienstzeiten, Abwesenheiten und Urlaubstage sowie dein Zeitkonto. Ohne Freigabe der Leitung siehst du keinen Plan.',
  '',
  'Wer sieht was: Du siehst nur deine eigenen Daten und die Pläne, die die Leitung freigegeben hat. Leitung und Stellvertretung sehen die Daten aller Mitarbeiter ihrer Filiale.',
  '',
  'Wo die Daten liegen: bei einem Datenbank-Anbieter, mit dem ein Vertrag zur Auftragsverarbeitung besteht. Die Daten werden nicht an Dritte weitergegeben.',
  '',
  'Deine Rechte: Auskunft, Berichtigung und Löschung, soweit keine gesetzliche Aufbewahrung entgegensteht. Wende dich dazu an die Filialleitung.',
  '',
  'Mit deiner Bestätigung erklärst du, dass du diesen Hinweis gelesen hast.',
].join('\n');

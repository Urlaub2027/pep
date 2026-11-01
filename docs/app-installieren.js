// „Als App installieren“ in der Mitarbeiter-Ansicht. Android/Chrome melden mit beforeinstallprompt, dass sie
// installieren können: dann ein Knopf, der den Installationsdialog des Browsers öffnet. iPhone/iPad kennen das
// Ereignis nicht (nur Teilen → Zum Home-Bildschirm), dafür eine kurze Anleitung. Läuft PEP schon als App, nichts.
import { element } from './hilfe.js';
import { installArt, istIos } from './mein-daten.js';

let angebot = null; // gemerktes beforeinstallprompt-Ereignis
let bereich = null; // zuletzt gezeichneter Hinweis (die Ansicht wird bei jedem Laden neu gebaut)

window.addEventListener('beforeinstallprompt', (ereignis) => {
  ereignis.preventDefault(); // statt der Browser-Leiste unser Knopf
  angebot = ereignis;
  zeichne();
});
window.addEventListener('appinstalled', () => {
  angebot = null;
  zeichne();
});

const installiert = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

async function installieren() {
  const e = angebot;
  if (!e) return;
  angebot = null; // prompt() geht je Ereignis nur einmal
  await e.prompt();
  const { outcome } = await e.userChoice;
  zeichne(outcome === 'accepted');
}

function inhalt(fertig = false) {
  const art = fertig ? null : installArt({
    installiert: installiert(),
    kannFragen: Boolean(angebot),
    ios: istIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
  });
  if (art === 'knopf') {
    return [element('button', { type: 'button', class: 'knopf primaer mein-installieren', onclick: () => installieren() }, 'Als App installieren'),
      element('span', { class: 'klein' }, ' Dann öffnet sich PEP wie eine App, ohne Browser.')];
  }
  if (art === 'ios') {
    // Safari: Teilen-Symbol unten; Chrome & Co. (ab iOS 16.4): oben in der Adressleiste.
    return ['Als App nutzen: auf das Teilen-Symbol tippen (Viereck mit Pfeil nach oben – in Safari unten, in Chrome oben ',
      'in der Adressleiste), dann „Zum Home-Bildschirm“.'];
  }
  if (art === 'menue') {
    return ['Als App nutzen: im Browser-Menü „App installieren“ oder „Zum Startbildschirm hinzufügen“ wählen.'];
  }
  return [];
}

function zeichne(fertig = false) {
  if (!bereich?.isConnected) return;
  bereich.replaceChildren(...inhalt(fertig));
  bereich.hidden = !bereich.childNodes.length;
}

// Für mein.js: der Hinweis-Bereich, der sich selbst aktualisiert, wenn das Angebot des Browsers später kommt.
export function installBereich() {
  bereich = element('p', { class: 'mein-app' });
  bereich.replaceChildren(...inhalt());
  bereich.hidden = !bereich.childNodes.length;
  return bereich;
}

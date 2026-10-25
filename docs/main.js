// Einstieg der Seite: erst app.js, dann die Reiter-Module, dann Start.
import { start } from './app.js';

// Reiter-Module (jedes trägt sich mit reiter.<name> = { zeigen } ein)
import './mitarbeiter.js';
import './einstellungen.js';
import './abwesenheiten.js';
import './einsatzplan.js';
import './zeitkonto.js';
import './vorausplanung.js';
import './start.js';

start();

// Nach einem Update sofort die neue Fassung laden (sw.js). Nur über https (GitHub Pages), nicht auf den Testservern.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Service Worker gilt der normale Zwischenspeicher */ });
}

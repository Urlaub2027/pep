// Einstieg der Seite: erst app.js, dann die Reiter-Module, dann Start.
import { start } from './app.js';

// Reiter-Module (jedes trägt sich mit reiter.<name> = { zeigen } ein)
import './mitarbeiter.js';
import './einstellungen.js';
import './abwesenheiten.js';
import './einsatzplan.js';
import './vorausplanung.js';
import './start.js';

start();

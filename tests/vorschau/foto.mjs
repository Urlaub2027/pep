// Screenshot einer Vorschau-Ansicht mit Edge/Chrome headless.
// node tests/vorschau/foto.mjs <ansicht> <ausgabe.png> [breite] [hoehe] [zusatz]
// zusatz: weitere Abfrage-Parameter, z. B. 'toast=Gespeichert.' oder 'tag=2026-11-10'. Monat, KW und „heute“ passen zu den Vorschau-Daten.
// Die Ausgabe gehört nicht ins Repo (*.png in tests/vorschau ist gitignored).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [ansicht = 'abwesenheiten', ausgabe = 'vorschau.png', breite = '1440', hoehe = '900', zusatz = ''] = process.argv.slice(2);
const abfrage = new URLSearchParams(`ansicht=${ansicht}&jahr=2026&monat=11&kw=46&heute=2026-11-02&${zusatz}`);
// Chrome zuerst: Edge headless schreibt unter Windows keinen Screenshot, wenn Edge schon offen ist.
const BROWSER = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
if (!BROWSER) { console.error('Kein Edge/Chrome gefunden'); process.exit(1); }

const port = 8100 + Math.floor(Math.random() * 800);
const server = spawn(process.execPath, [new URL('./server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
try {
  const profil = mkdtempSync(join(tmpdir(), 'pep-vorschau-'));
  execFileSync(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${profil}`,
    '--hide-scrollbars', `--window-size=${breite},${hoehe}`,
    '--virtual-time-budget=4000', `--screenshot=${resolve(ausgabe)}`,
    `http://localhost:${port}/vorschau?${abfrage}`], { stdio: 'ignore', timeout: 60000 });
  console.log(`Gespeichert: ${resolve(ausgabe)}`);
} finally {
  server.kill();
}

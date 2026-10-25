// Vorschau-Server: liefert das Repo aus; /vorschau ist docs/index.html mit app.js → app-attrappe.js (Import-Map).
// Start: node tests/vorschau/server.mjs [port]   Aufruf: http://localhost:8123/vorschau?ansicht=abwesenheiten
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const WURZEL = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const port = Number(process.argv[2]) || 8123;

async function vorschauSeite() {
  const html = await readFile(join(WURZEL, 'docs/index.html'), 'utf8');
  return html
    .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/s, '')
    .replace('<head>', '<head>\n  <base href="/docs/">')
    .replace('<script type="module" src="main.js"></script>',
      '<script type="importmap">{"imports":{"/docs/app.js":"/tests/vorschau/app-attrappe.js"}}</script>\n  <script type="module" src="/docs/main.js"></script>');
}

createServer(async (anfrage, antwort) => {
  try {
    const pfad = decodeURIComponent(new URL(anfrage.url, 'http://x').pathname);
    if (pfad === '/vorschau') {
      antwort.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return antwort.end(await vorschauSeite());
    }
    const datei = normalize(join(WURZEL, pfad));
    if (!datei.startsWith(normalize(WURZEL))) throw new Error('außerhalb');
    const inhalt = await readFile(datei);
    antwort.writeHead(200, { 'content-type': `${TYPEN[extname(datei)] || 'application/octet-stream'}; charset=utf-8` });
    antwort.end(inhalt);
  } catch {
    antwort.writeHead(404);
    antwort.end();
  }
}).listen(port, () => console.log(`Vorschau: http://localhost:${port}/vorschau?ansicht=abwesenheiten`));

// Live-Testserver für den Browser-Test: echte Oberfläche (docs/, unverändert bis auf zwei Stellen) gegen die
// echten SQL-Funktionen in PGlite. Nachgebildet werden die beiden Supabase-Dienste, die der Browser anspricht:
//   POST /rest/v1/rpc/<funktion>  wie PostgREST (benannte Argumente aus dem JSON-Body, json_to_recordset mit den
//                                 Parametertypen der Funktion, Rolle authenticated, request.jwt.claims)
//   POST /auth/v1/token|logout    wie GoTrue (Benutzername@example.com, Passwort „test“)
// Unter /browser/ liefert er docs/ aus. Geändert werden nur: config.js (SUPABASE_URL = dieser Server) und im
// Content-Security-Policy-Meta connect-src (https://*.supabase.co → 'self'); die übrige CSP bleibt scharf.
// app.js, sitzung.js und api.js laufen unverändert.
//
// Allein starten (zum Ausprobieren): node tests/browser/server.mjs [port] → http://localhost:<port>/browser/
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { neueDatenbank } from '../helfer.mjs';
import { befuellen } from './daten.mjs';

const WURZEL = fileURLToPath(new URL('../../', import.meta.url));
const DOCS = join(WURZEL, 'docs');
const TYPEN = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
export const PASSWORT = 'test';

// PostgREST: SQLSTATE → HTTP-Status (Auszug aus PostgREST/Error.hs, für die hier vorkommenden Codes).
function httpStatus(code, angemeldet) {
  if (!code) return 500;
  if (code === '42501') return angemeldet ? 403 : 401;
  if (code === '42883' || code === '42P01') return 404;
  if (code === '23503' || code === '23505') return 409;
  if (code === 'P0001' || code.startsWith('22') || code.startsWith('23')) return 400;
  if (code === '25006') return 405;
  if (code.startsWith('P0')) return 500;
  if (code.startsWith('42')) return 400; // u. a. 42P13 (Typfehler), 42703
  return 500;
}

export async function starteServer({ port = 0, protokoll = () => {} } = {}) {
  const db = await neueDatenbank();
  const bestand = await befuellen(db);

  // Alle Datenbankzugriffe hintereinander (PGlite hat eine Verbindung; Rolle und Claims gelten je Transaktion).
  let kette = Promise.resolve();
  const exklusiv = (fn) => {
    const lauf = kette.then(fn);
    kette = lauf.catch(() => {});
    return lauf;
  };

  // Signaturen der öffentlichen Funktionen (wie der Schema-Cache von PostgREST).
  const sig = new Map();
  const ladeSignaturen = async () => {
    sig.clear();
    const r = await db.query(`
      select p.proname as name, p.pronargdefaults::int as defaults, t.typname = 'void' as void,
             coalesce((select json_agg(json_build_object('name', a.n, 'typ', format_type(a.t, null)) order by a.o)
                         from unnest(p.proargnames, p.proargtypes::oid[]) with ordinality as a(n, t, o)), '[]') as args
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype
       where n.nspname = 'public' and p.proname like 'pep\\_%'`);
    for (const f of r.rows) {
      if (!sig.has(f.name)) sig.set(f.name, []);
      sig.get(f.name).push(f);
    }
  };
  await ladeSignaturen();

  let verzoegerung = 0; // ms je RPC (langsame Verbindung nachstellen)
  const aufrufe = []; // Protokoll aller RPCs: { funktion, body, status, fehler }

  async function rpc(funktion, body, nutzer) {
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { status: 400, json: { code: 'PGRST102', message: 'Nur ein JSON-Objekt als Body unterstützt (Test-Server)' } };
    }
    const schluessel = Object.keys(body);
    const kandidaten = (sig.get(funktion) ?? []).filter((f) => {
      const namen = f.args.map((a) => a.name);
      const pflicht = namen.slice(0, namen.length - f.defaults);
      return schluessel.every((k) => namen.includes(k)) && pflicht.every((n) => schluessel.includes(n));
    });
    if (kandidaten.length !== 1) {
      return {
        status: kandidaten.length ? 300 : 404,
        json: {
          code: kandidaten.length ? 'PGRST203' : 'PGRST202',
          message: `Could not find the function public.${funktion}(${[...schluessel].sort().join(', ')}) in the schema cache`,
          details: null, hint: null,
        },
      };
    }
    const f = kandidaten[0];
    const benutzt = f.args.filter((a) => schluessel.includes(a.name));
    const q = (n) => `"${n.replace(/"/g, '""')}"`;
    const aufruf = `public.${q(funktion)}(${benutzt.map((a) => `${q(a.name)} := a.${q(a.name)}`).join(', ')})`;
    const sql = benutzt.length
      ? `select ${f.void ? aufruf : `to_json(${aufruf})`} as r from json_to_recordset($1::json) as a(${benutzt.map((a) => `${q(a.name)} ${a.typ}`).join(', ')})`
      : `select ${f.void ? aufruf : `to_json(${aufruf})`} as r`;
    const claims = nutzer ? JSON.stringify({ sub: nutzer, role: 'authenticated' }) : '';
    try {
      const r = await exklusiv(() => db.transaction(async (tx) => {
        await tx.exec(`set local role ${nutzer ? 'authenticated' : 'anon'}`);
        await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
        return tx.query(sql, benutzt.length ? [JSON.stringify([body])] : []);
      }));
      if (f.void) return { status: 204, json: null };
      return { status: 200, json: r.rows[0]?.r ?? null };
    } catch (e) {
      return {
        status: httpStatus(e.code, Boolean(nutzer)),
        json: { code: e.code ?? null, message: e.message, details: e.detail ?? null, hint: e.hint ?? null },
      };
    }
  }

  async function anmelden(email, passwort) {
    const name = String(email ?? '').replace(/@example\.com$/i, '');
    const r = await exklusiv(() => db.query(
      'select user_id from urlaub.organisatoren where lower(benutzername) = lower($1) and not gesperrt', [name]));
    if (!r.rows.length || passwort !== PASSWORT) {
      return { status: 400, json: { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' } };
    }
    const id = r.rows[0].user_id;
    return { status: 200, json: { access_token: `test.${id}`, refresh_token: `erneuern.${id}`, expires_in: 3600, token_type: 'bearer' } };
  }

  async function seite(pfad) {
    const datei = normalize(join(DOCS, pfad.replace(/^\/browser\/?/, '') || 'index.html'));
    if (!datei.startsWith(normalize(DOCS) + sep)) throw new Error('außerhalb'); // mit Trenner: nicht „docs-alt/…“
    if (datei.endsWith(`${normalize('/config.js')}`) || datei.endsWith('\\config.js')) {
      return { typ: 'text/javascript', inhalt: "export const SUPABASE_URL = location.origin;\nexport const SUPABASE_KEY = 'sb_publishable_browsertest';\n" };
    }
    let inhalt = await readFile(datei);
    if (extname(datei) === '.html') {
      const html = inhalt.toString('utf8');
      const neu = html.replace('connect-src https://*.supabase.co', "connect-src 'self'");
      if (neu === html) throw new Error('CSP connect-src in index.html nicht gefunden – Testserver anpassen');
      inhalt = neu;
    }
    return { typ: TYPEN[extname(datei)] || 'application/octet-stream', inhalt };
  }

  const lesen = (anfrage) => new Promise((ok, fehler) => {
    const teile = [];
    anfrage.on('data', (t) => teile.push(t));
    anfrage.on('end', () => ok(Buffer.concat(teile).toString('utf8')));
    anfrage.on('error', fehler);
  });

  const server = createServer(async (anfrage, antwort) => {
    let url;
    let pfad;
    try {
      url = new URL(anfrage.url, 'http://x');
      pfad = decodeURIComponent(url.pathname);
    } catch { // z. B. „%E0%A4%A“: ungültige Adresse ist ein Fehler der Anfrage, kein Absturz
      antwort.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      antwort.end('Ungültige Adresse');
      return;
    }
    const senden = ({ status, json }) => {
      if (status === 204) { antwort.writeHead(204); antwort.end(); return; }
      antwort.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      antwort.end(JSON.stringify(json));
    };
    try {
      if (pfad === '/' || pfad === '/browser') { antwort.writeHead(302, { location: '/browser/' }); antwort.end(); return; }
      if (pfad.startsWith('/rest/v1/rpc/') && anfrage.method === 'POST') {
        const funktion = pfad.slice('/rest/v1/rpc/'.length);
        const text = await lesen(anfrage);
        let body;
        try { body = text ? JSON.parse(text) : {}; } catch { senden({ status: 400, json: { code: 'PGRST102', message: 'Empty or invalid json' } }); return; }
        const auth = anfrage.headers.authorization ?? '';
        const nutzer = /^Bearer test\.([0-9a-f-]{36})$/.exec(auth)?.[1] ?? null;
        if (auth && !nutzer && !auth.includes('sb_publishable')) { senden({ status: 401, json: { code: 'PGRST301', message: 'JWT invalid' } }); return; }
        if (verzoegerung) await new Promise((ok) => setTimeout(ok, verzoegerung));
        const ergebnis = await rpc(funktion, body, nutzer);
        aufrufe.push({ funktion, body, status: ergebnis.status, fehler: ergebnis.status >= 300 ? ergebnis.json?.message : null });
        protokoll(funktion, body, ergebnis);
        senden(ergebnis);
        return;
      }
      if (pfad === '/auth/v1/token' && anfrage.method === 'POST') {
        const body = JSON.parse(await lesen(anfrage) || '{}');
        if (url.searchParams.get('grant_type') === 'refresh_token') {
          const id = /^erneuern\.(.+)$/.exec(body.refresh_token ?? '')?.[1];
          senden(id ? { status: 200, json: { access_token: `test.${id}`, refresh_token: `erneuern.${id}`, expires_in: 3600 } }
            : { status: 400, json: { error_code: 'invalid_grant' } });
          return;
        }
        senden(await anmelden(body.email, body.password));
        return;
      }
      if (pfad === '/auth/v1/logout') { await lesen(anfrage); senden({ status: 204 }); return; }
      if (pfad.startsWith('/browser/')) {
        const { typ, inhalt } = await seite(pfad);
        antwort.writeHead(200, { 'content-type': `${typ}; charset=utf-8`, 'cache-control': 'no-store' });
        antwort.end(inhalt);
        return;
      }
      antwort.writeHead(404); antwort.end();
    } catch (e) {
      antwort.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      antwort.end(String(e?.message ?? e));
    }
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const adresse = `http://127.0.0.1:${server.address().port}`;

  return {
    db, bestand, adresse, aufrufe,
    // SQL als Datenbank-Eigentümer, in der Warteschlange der RPCs (für Prüfungen des DB-Stands).
    sql: (text, params = []) => exklusiv(() => db.query(text, params)).then((r) => r.rows),
    // Eine pep_-Funktion wie der Browser aufrufen (z. B. zum Vorbereiten), als Benutzer-ID.
    rpc: (funktion, body, nutzer) => rpc(funktion, body, nutzer),
    verzoegere: (ms) => { verzoegerung = ms; },
    schliessen: async () => { server.closeAllConnections?.(); await new Promise((ok) => server.close(ok)); await db.close(); },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await starteServer({
    port: Number(process.argv[2]) || 8124,
    protokoll: (f, b, e) => console.log(e.status, f, JSON.stringify(b).slice(0, 160), e.status >= 300 ? e.json?.message : ''),
  });
  console.log(`Browser-Test-Server: ${s.adresse}/browser/  (chef / vize, Passwort „${PASSWORT}“)`);
}

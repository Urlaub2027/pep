// Minimaler Chrome-Treiber über das DevTools-Protokoll (CDP), ohne npm-Abhängigkeit (Node 22+: fetch, WebSocket).
// Startet Chrome headless mit eigenem Wegwerf-Profil, verbindet sich mit dem ersten Tab und bietet:
// navigiere, werte (evaluate), warteAuf, klick(selector|{text}), tippe, setzeWert, ziehe (Maus), wische (Touch),
// foto, Tablet-Modus, feste Uhr (uhr) und ein Protokoll von Konsolenfehlern, Ausnahmen und fehlgeschlagenen Anfragen.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Chrome zuerst (wie tests/vorschau/foto.mjs), sonst Edge – beide sprechen dasselbe DevTools-Protokoll.
const BROWSER = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(existsSync);
// Wegwerf-Profil löschen; Chrome gibt Dateien nach dem Beenden evtl. erst kurz danach frei.
const profilWeg = (profil) => {
  try { rmSync(profil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* bleibt liegen */ }
};

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Feste Uhr im Browser: new Date() / Date.now() beginnen bei `heute` 10:00 Ortszeit und laufen normal weiter.
const uhrSkript = (heute) => `(() => {
  const Echt = Date; const basis = new Echt('${heute}T10:00:00').getTime(); const start = Echt.now();
  const jetzt = () => basis + (Echt.now() - start);
  class TestDate extends Echt {
    constructor(...a) { if (a.length === 0) super(jetzt()); else super(...a); }
    static now() { return jetzt(); }
  }
  globalThis.Date = TestDate;
})();`;

export async function starteChrome({ heute = null, breite = 1440, hoehe = 900 } = {}) {
  if (!BROWSER) throw new Error('Kein Chrome/Edge gefunden');
  const profil = mkdtempSync(join(tmpdir(), 'pep-cdp-'));
  const prozess = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profil}`, '--hide-scrollbars', '--disable-extensions',
    `--window-size=${breite},${hoehe}`, '--lang=de-DE', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsBrowser = await new Promise((ok, fehler) => {
    let text = '';
    const uhr = setTimeout(() => fehler(new Error(`Chrome meldet keinen DevTools-Port:\n${text}`)), 20000);
    prozess.stderr.on('data', (d) => {
      text += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(text);
      if (m) { clearTimeout(uhr); ok(m[1]); }
    });
  });
  const port = new URL(wsBrowser).port;
  let ziel;
  for (let i = 0; i < 50 && !ziel; i++) {
    const liste = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    ziel = liste.find((t) => t.type === 'page');
    if (!ziel) await pause(100);
  }
  const ws = new WebSocket(ziel.webSocketDebuggerUrl);
  await new Promise((ok, fehler) => { ws.onopen = ok; ws.onerror = fehler; });

  let naechsteId = 1;
  const offen = new Map();
  const hoerer = new Map(); // methode → Set(fn)
  ws.onmessage = (nachricht) => {
    const m = JSON.parse(nachricht.data);
    if (m.id && offen.has(m.id)) {
      const { ok, fehler, methode } = offen.get(m.id);
      offen.delete(m.id);
      if (m.error) fehler(new Error(`${methode}: ${m.error.message}`));
      else ok(m.result);
    } else if (m.method) {
      for (const fn of hoerer.get(m.method) ?? []) fn(m.params);
    }
  };
  const sende = (methode, params = {}, ms = 20000) => new Promise((ok, fehler) => {
    const id = naechsteId++;
    const uhr = setTimeout(() => { offen.delete(id); fehler(new Error(`Zeitüberschreitung CDP ${methode}`)); }, ms);
    offen.set(id, { ok: (x) => { clearTimeout(uhr); ok(x); }, fehler: (e) => { clearTimeout(uhr); fehler(e); }, methode });
    ws.send(JSON.stringify({ id, method: methode, params }));
  });
  const auf = (methode, fn) => {
    if (!hoerer.has(methode)) hoerer.set(methode, new Set());
    hoerer.get(methode).add(fn);
    return () => hoerer.get(methode).delete(fn);
  };
  const einmal = (methode, ms = 30000) => new Promise((ok, fehler) => {
    const uhr = setTimeout(() => { weg(); fehler(new Error(`Zeitüberschreitung: ${methode}`)); }, ms);
    const weg = auf(methode, (p) => { clearTimeout(uhr); weg(); ok(p); });
  });

  // ---- Protokoll: Konsole, Ausnahmen, Netzwerk
  const protokoll = []; // { art, text, url? }
  const anfragen = new Map();
  auf('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'assert' || p.type === 'warning') {
      protokoll.push({ art: `console.${p.type}`, text: p.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    }
  });
  auf('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    protokoll.push({ art: 'exception', text: `${d.exception?.description ?? d.text} (${d.url ?? ''}:${d.lineNumber})` });
  });
  auf('Log.entryAdded', (p) => {
    if (p.entry.level === 'error' || p.entry.level === 'warning') {
      protokoll.push({ art: `log.${p.entry.source}.${p.entry.level}`, text: p.entry.text, url: p.entry.url });
    }
  });
  auf('Network.requestWillBeSent', (p) => anfragen.set(p.requestId, { url: p.request.url, methode: p.request.method, body: p.request.postData }));
  auf('Network.responseReceived', (p) => {
    const a = anfragen.get(p.requestId);
    if (a) a.status = p.response.status;
    if (p.response.status >= 400) protokoll.push({ art: 'http', text: `${p.response.status} ${p.response.url}`, url: p.response.url, body: a?.body });
  });
  auf('Network.loadingFailed', (p) => {
    const a = anfragen.get(p.requestId);
    if (!p.canceled) protokoll.push({ art: 'netz', text: `${p.errorText} ${a?.url ?? ''}`, url: a?.url });
  });
  const dialoge = [];
  auf('Page.javascriptDialogOpening', (p) => {
    dialoge.push(p);
    sende('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });

  await Promise.all([sende('Page.enable'), sende('Runtime.enable'), sende('Log.enable'), sende('Network.enable')]);
  let uhrId = heute ? (await sende('Page.addScriptToEvaluateOnNewDocument', { source: uhrSkript(heute) })).identifier : null;
  await sende('Emulation.setDeviceMetricsOverride', { width: breite, height: hoehe, deviceScaleFactor: 1, mobile: false });

  // ---------------------------------------------------------------- API

  async function werte(ausdruck, ...argumente) {
    const text = typeof ausdruck === 'function'
      ? `(${ausdruck.toString()})(...${JSON.stringify(argumente)})` : ausdruck;
    const r = await sende('Runtime.evaluate', { expression: text, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result.value;
  }

  async function warteAuf(ausdruck, { ms = 10000, text = null } = {}, ...argumente) {
    const ende = Date.now() + ms;
    let letzter;
    while (Date.now() < ende) {
      try { letzter = await werte(ausdruck, ...argumente); if (letzter) return letzter; } catch (e) { letzter = e.message; }
      await pause(50);
    }
    throw new Error(`Zeitüberschreitung beim Warten auf ${text ?? String(ausdruck).slice(0, 160)} (zuletzt: ${JSON.stringify(letzter)?.slice(0, 200)})`);
  }

  async function navigiere(url) {
    const geladen = einmal('Page.loadEventFired');
    await sende('Page.navigate', { url });
    await geladen;
  }

  // Mitte eines Elements in Viewport-Koordinaten (scrollt es ins Bild). ziel: CSS-Selektor oder { text, in, nr }.
  async function punkt(ziel) {
    const p = await werte((z) => {
      let el;
      if (typeof z === 'string') el = document.querySelector(z);
      else {
        const wurzel = z.in ? document.querySelector(z.in) : document;
        const alle = [...(wurzel?.querySelectorAll(z.sel ?? 'button, [role="button"], a, label, summary') ?? [])]
          .filter((e) => (z.genau ? e.textContent.trim() === z.text : e.textContent.includes(z.text)) && e.getClientRects().length);
        el = alle[z.nr ?? 0];
      }
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, b: r.width, h: r.height };
    }, ziel);
    if (!p) throw new Error(`Element nicht gefunden: ${JSON.stringify(ziel)}`);
    return p;
  }

  const maus = (type, x, y, extra = {}) => sende('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra });

  let tabletAn = false;
  async function klick(ziel) {
    if (tabletAn) { await tippeTouch(ziel); return; } // im Tablet-Modus tippt der Finger
    const { x, y } = await punkt(ziel);
    await maus('mouseMoved', x, y, { button: 'none' });
    await maus('mousePressed', x, y, { buttons: 1 });
    await maus('mouseReleased', x, y, { buttons: 0 });
    await pause(30);
  }

  // Tippt Text in das (fokussierte) Feld; vorher wird der Inhalt geleert. tab: danach Tab drücken (change/blur).
  async function tippe(ziel, text, { tab = false, enter = false } = {}) {
    await klick(ziel);
    await werte(() => { const e = document.activeElement; if (e && 'value' in e) e.select?.(); });
    await taste('Delete');
    if (text) await sende('Input.insertText', { text });
    if (enter) await taste('Enter');
    if (tab) await taste('Tab');
  }

  const TASTEN = { Tab: 9, Enter: 13, Escape: 27, Delete: 46, Backspace: 8 };
  async function taste(key) {
    const code = TASTEN[key];
    await sende('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code });
    if (key === 'Enter') await sende('Input.dispatchKeyEvent', { type: 'char', key, text: '\r' });
    await sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
  }

  // Für Datum/Zeit/Select: Wert setzen und input+change auslösen (wie nach einer Auswahl im Picker).
  async function setzeWert(selector, wert) {
    const ok = await werte((s, w) => {
      const e = typeof s === 'string' ? document.querySelector(s) : null;
      if (!e) return false;
      e.focus();
      e.value = w;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, selector, wert);
    if (!ok) throw new Error(`Feld nicht gefunden: ${selector}`);
  }

  // Maus-Ziehen von a nach b (Viewport-Koordinaten) in `schritte` Zwischenschritten.
  async function ziehe(a, b, schritte = 8) {
    await maus('mouseMoved', a.x, a.y, { button: 'none' });
    await maus('mousePressed', a.x, a.y, { buttons: 1 });
    for (let i = 1; i <= schritte; i++) {
      await maus('mouseMoved', a.x + ((b.x - a.x) * i) / schritte, a.y + ((b.y - a.y) * i) / schritte, { buttons: 1 });
    }
    await maus('mouseReleased', b.x, b.y, { buttons: 0 });
    await pause(50);
  }

  // Touch-Wischen (ein Finger) von a nach b; braucht tablet().
  async function wische(a, b, schritte = 10) {
    const tp = (x, y) => [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
    await sende('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(a.x, a.y) });
    for (let i = 1; i <= schritte; i++) {
      await sende('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: tp(a.x + ((b.x - a.x) * i) / schritte, a.y + ((b.y - a.y) * i) / schritte),
      });
      await pause(16);
    }
    await sende('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(50);
  }

  async function tippeTouch(ziel) {
    const { x, y } = await punkt(ziel);
    const tp = [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
    await sende('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp });
    await sende('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await pause(80);
  }

  async function tablet(an = true) {
    tabletAn = an;
    if (an) {
      await sende('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: true });
      await sende('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    } else {
      await sende('Emulation.setTouchEmulationEnabled', { enabled: false });
      await sende('Emulation.setDeviceMetricsOverride', { width: breite, height: hoehe, deviceScaleFactor: 1, mobile: false });
    }
  }

  // Stellt die feste Uhr auf einen anderen Tag (wirkt ab dem nächsten Laden der Seite).
  async function uhr(heute) {
    if (uhrId) await sende('Page.removeScriptToEvaluateOnNewDocument', { identifier: uhrId });
    uhrId = (await sende('Page.addScriptToEvaluateOnNewDocument', { source: uhrSkript(heute) })).identifier;
  }

  async function foto(datei, { ganz = false } = {}) {
    const r = await sende('Page.captureScreenshot', { format: 'png', captureBeyondViewport: ganz });
    writeFileSync(datei, Buffer.from(r.data, 'base64'));
  }

  async function schliessen() {
    try { await sende('Browser.close'); } catch { /* schon zu */ }
    try { ws.close(); } catch { /* egal */ }
    await new Promise((ok) => { if (prozess.exitCode !== null) ok(); else { prozess.once('exit', ok); setTimeout(ok, 5000); } });
    if (prozess.exitCode === null) prozess.kill('SIGKILL');
    profilWeg(profil);
  }

  // Notbremse bei einem Absturz des Testlaufs (synchron, vor process.exit): Chrome beenden, Profil löschen.
  function notAus() {
    try { if (prozess.exitCode === null) prozess.kill('SIGKILL'); } catch { /* schon zu */ }
    profilWeg(profil);
  }

  return {
    sende, auf, werte, warteAuf, navigiere, punkt, klick, tippe, taste, setzeWert, ziehe, wische, tippeTouch,
    tablet, uhr, foto, schliessen, notAus, protokoll, dialoge, maus, pid: prozess.pid,
  };
}

// Ursprünglich Kopie aus Urlaub2027/urlaub docs/ (dort pflegen); PEP-eigene Erweiterung: dauerhaft().
// Anmelde-Sitzung. Leitung und Stellvertretung: nur im sessionStorage dieses Tabs. Mitarbeiter-Konten (app.js
// nachLogin ruft dauerhaft(true)): im localStorage, damit die App auf dem Handy angemeldet bleibt, bis man sich
// abmeldet oder die Leitung den Zugang sperrt (dann KEIN_ZUGRIFF → Abmelden löscht die Sitzung).
import { rpc, anmelden, erneuern, abmeldenServer } from './api.js';

const SCHLUESSEL = 'pep-sitzung';
// Supabase verlangt eine E-Mail-Adresse. Getippt wird nur der Benutzername;
// die Domain ist reserviert (RFC 2606) und kann keine Post empfangen.
const LOGIN_DOMAIN = 'example.com';

let istDauerhaft = false;
let sitzung = lesen();

function holen(speicher) {
  try { return JSON.parse(speicher.getItem(SCHLUESSEL)); } catch { return null; }
}

function lesen() {
  const imTab = holen(sessionStorage);
  if (imTab) return imTab;
  const gemerkt = holen(localStorage);
  if (gemerkt) istDauerhaft = true;
  return gemerkt;
}

function schreiben() {
  try { (istDauerhaft ? localStorage : sessionStorage).setItem(SCHLUESSEL, JSON.stringify(sitzung)); } catch { /* nur im Speicher */ }
}

function speichern(antwort) {
  sitzung = {
    token: antwort.access_token,
    refresh: antwort.refresh_token,
    ablauf: Date.now() + (antwort.expires_in || 3600) * 1000,
  };
  schreiben();
}

// true: Sitzung überlebt das Schließen des Tabs bzw. der App (nur Mitarbeiter-Konten); false: nur dieser Tab.
export function dauerhaft(an) {
  istDauerhaft = Boolean(an);
  if (!sitzung) return;
  schreiben();
  try { (istDauerhaft ? sessionStorage : localStorage).removeItem(SCHLUESSEL); } catch { /* egal */ }
}

export function emailFuer(benutzername) {
  const name = benutzername.trim().toLowerCase();
  return name.includes('@') ? name : `${name}@${LOGIN_DOMAIN}`;
}

export function istAngemeldet() {
  return Boolean(sitzung);
}

export async function login(benutzername, passwort) {
  istDauerhaft = false; // neue Anmeldung erst nur im Tab, bis nachLogin die Art des Kontos kennt
  speichern(await anmelden(emailFuer(benutzername), passwort));
}

export function logout() {
  // Anmeldung auch bei Supabase beenden, damit das Erneuerungs-Token ungültig wird.
  if (sitzung?.token) abmeldenServer(sitzung.token).catch(() => {});
  sitzung = null;
  istDauerhaft = false;
  try { sessionStorage.removeItem(SCHLUESSEL); } catch { /* egal */ }
  try { localStorage.removeItem(SCHLUESSEL); } catch { /* egal */ }
}

export async function token() {
  if (!sitzung) throw new Error('NICHT_ANGEMELDET');
  if (Date.now() > sitzung.ablauf - 60_000) {
    try {
      speichern(await erneuern(sitzung.refresh));
    } catch {
      throw new Error('NICHT_ANGEMELDET');
    }
  }
  return sitzung.token;
}

export async function orgRpc(funktion, parameter = {}) {
  return rpc(funktion, parameter, await token());
}

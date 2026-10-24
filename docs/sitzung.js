// Kopie aus Urlaub2027/urlaub docs/, dort pflegen.
// Anmelde-Sitzung der Verwaltung. Liegt nur im sessionStorage dieses Tabs.
import { rpc, anmelden, erneuern, abmeldenServer } from './api.js';

const SCHLUESSEL = 'pep-sitzung';
// Supabase verlangt eine E-Mail-Adresse. Getippt wird nur der Benutzername;
// die Domain ist reserviert (RFC 2606) und kann keine Post empfangen.
const LOGIN_DOMAIN = 'example.com';

let sitzung = lesen();

function lesen() {
  try { return JSON.parse(sessionStorage.getItem(SCHLUESSEL)); } catch { return null; }
}

function speichern(antwort) {
  sitzung = {
    token: antwort.access_token,
    refresh: antwort.refresh_token,
    ablauf: Date.now() + (antwort.expires_in || 3600) * 1000,
  };
  try { sessionStorage.setItem(SCHLUESSEL, JSON.stringify(sitzung)); } catch { /* nur im Speicher */ }
}

export function emailFuer(benutzername) {
  const name = benutzername.trim().toLowerCase();
  return name.includes('@') ? name : `${name}@${LOGIN_DOMAIN}`;
}

export function istAngemeldet() {
  return Boolean(sitzung);
}

export async function login(benutzername, passwort) {
  speichern(await anmelden(emailFuer(benutzername), passwort));
}

export function logout() {
  // Anmeldung auch bei Supabase beenden, damit das Erneuerungs-Token ungültig wird.
  if (sitzung?.token) abmeldenServer(sitzung.token).catch(() => {});
  sitzung = null;
  try { sessionStorage.removeItem(SCHLUESSEL); } catch { /* egal */ }
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

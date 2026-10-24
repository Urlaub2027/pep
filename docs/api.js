// Kopie aus Urlaub2027/urlaub docs/, dort pflegen.
// Verbindung zu Supabase (REST und Auth). Fehler werden als Error geworfen:
// message = Fehlercode der Datenbank (z. B. "LINK_UNGUELTIG"), Auth-Fehlercode
// (z. B. "user_already_exists") oder "KEINE_VERBINDUNG"; status = HTTP-Status;
// details = PostgREST-Feld "details" (bei ANTWORTEN_UNGUELTIG: JSON-Text {"<frage_id>": "<CODE>"}).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

async function anfrage(pfad, body, token, methode = 'POST') {
  const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_KEY };
  // Angemeldet: Sitzungs-Token. Sonst: alte "anon"-Schlüssel sind JWTs und gehen
  // zusätzlich als Bearer mit; neue "publishable"-Schlüssel nur als apikey.
  if (token) headers.Authorization = `Bearer ${token}`;
  else if (SUPABASE_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_KEY}`;
  let antwort;
  try {
    antwort = await fetch(`${SUPABASE_URL}${pfad}`, {
      method: methode, headers, body: JSON.stringify(body),
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new Error('KEINE_VERBINDUNG');
  }
  const inhalt = antwort.status === 204 ? null : await antwort.json().catch(() => null);
  if (!antwort.ok) {
    const fehler = new Error(inhalt?.message || inhalt?.error_code || inhalt?.msg || `HTTP_${antwort.status}`);
    fehler.status = antwort.status;
    fehler.details = inhalt?.details ?? null;
    throw fehler;
  }
  return inhalt;
}

export function rpc(funktion, parameter = {}, token = null) {
  return anfrage(`/rest/v1/rpc/${funktion}`, parameter, token);
}

export function anmelden(email, passwort) {
  return anfrage('/auth/v1/token?grant_type=password', { email, password: passwort });
}

export function erneuern(refreshToken) {
  return anfrage('/auth/v1/token?grant_type=refresh_token', { refresh_token: refreshToken });
}

export function abmeldenServer(token) {
  return anfrage('/auth/v1/logout?scope=local', {}, token);
}

// daten landet in raw_user_meta_data und wird vom Datenbank-Trigger geprüft.
export function registrieren(email, passwort, daten) {
  return anfrage('/auth/v1/signup', { email, password: passwort, data: daten });
}

export function passwortAendern(token, passwort) {
  return anfrage('/auth/v1/user', { password: passwort }, token, 'PUT');
}

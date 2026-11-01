// Registrierung über den Einladungslink (#zugang=<code>): Link prüfen, Benutzername und Passwort wählen, Konto anlegen,
// anmelden. Das Konto gehört danach zu dem Mitarbeiter, für den die Leitung den Link erzeugt hat (Datenbank-Trigger).
import { $, meldung, fehlerText } from './hilfe.js';
import { reiter, zeigeAnsicht, nachLogin } from './app.js';
import * as sitzung from './sitzung.js';
import { registrieren, rpc } from './api.js';

// Regel wie im Urlaubstool (admin.js) und im Datenbank-Trigger pep_neuer_mitarbeiter.
const BENUTZERNAME = /^(?=.{2,30}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const MIND_PASSWORT = 10;
const LINK_UNGUELTIG = 'Link ungültig, abgelaufen oder schon benutzt – bitte bei der Leitung einen neuen anfordern';

let code = null;

const codeAusHash = () => /^#zugang=([0-9a-f]{32})$/.exec(location.hash)?.[1] ?? null;
const hashEntfernen = () => history.replaceState(null, '', location.pathname + location.search);

async function zeigen() {
  code = codeAusHash();
  $('reg-form').hidden = true;
  if (!code) return meldung(LINK_UNGUELTIG);
  try {
    // anon-Aufruf ohne Sitzung: aufruf() aus app.js wäre hier falsch (es verlangt eine Anmeldung)
    const antwort = await rpc('pep_zugang_pruefen', { p_code: code });
    if (!antwort?.gueltig) return meldung(LINK_UNGUELTIG);
    $('reg-form').hidden = false;
    $('reg-name').focus();
  } catch (fehler) {
    meldung(fehlerText(fehler.message));
  }
}

function registrierFehler(fehler) {
  const m = fehler.message;
  if (m === 'user_already_exists' || m === 'email_exists') return 'Diesen Benutzernamen gibt es schon. Bitte wähle einen anderen.';
  if (m === 'weak_password') return 'Das Passwort ist zu schwach. Bitte wähle ein längeres.';
  if (m === 'KEINE_VERBINDUNG') return fehlerText('KEINE_VERBINDUNG');
  if (fehler.status === 500) return 'Registrierung abgelehnt: Der Link ist ungültig, abgelaufen oder schon benutzt – oder der Benutzername ist vergeben. Bitte bei der Leitung einen neuen Link anfordern.';
  return 'Registrierung fehlgeschlagen. Der Link ist eventuell abgelaufen oder schon benutzt.';
}

async function absenden(ereignis) {
  ereignis.preventDefault();
  meldung('');
  const name = $('reg-name').value.trim().toLowerCase();
  const passwort = $('reg-passwort').value;
  if (!BENUTZERNAME.test(name)) return meldung(fehlerText('BENUTZERNAME_UNGUELTIG'));
  if (passwort.length < MIND_PASSWORT) return meldung(`Das Passwort muss mindestens ${MIND_PASSWORT} Zeichen lang sein.`);
  if (passwort !== $('reg-passwort2').value) return meldung('Die beiden Passwörter stimmen nicht überein.');
  $('reg-knopf').disabled = true;
  try {
    await registrieren(sitzung.emailFuer(name), passwort, { pep_einladung: code });
    hashEntfernen();
    code = null;
    for (const id of ['reg-passwort', 'reg-passwort2']) $(id).value = '';
    try {
      await sitzung.login(name, passwort);
    } catch {
      // Konto existiert, Einladung ist verbraucht: nur die Anmeldung muss wiederholt werden.
      zeigeAnsicht('login');
      return meldung('Registrierung erfolgreich. Bitte melde dich jetzt mit deinem Benutzernamen an.');
    }
    await nachLogin();
  } catch (fehler) {
    meldung(registrierFehler(fehler));
  } finally {
    $('reg-knopf').disabled = false;
  }
}

reiter.registrieren = { zeigen };
$('reg-form').addEventListener('submit', absenden);
$('reg-zum-login').addEventListener('click', () => { hashEntfernen(); code = null; zeigeAnsicht('login'); });

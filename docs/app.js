// PEP: Anmeldung, Navigation, Filiale anlegen.
import { $, meldung, fehlerText } from './hilfe.js';
import * as sitzung from './sitzung.js';

const ANSICHTEN = ['login', 'filiale', 'start', 'abwesenheiten', 'vorausplanung', 'einsatzplan', 'mitarbeiter', 'einstellungen'];

export let ich = null;
// Reiter-Module tragen sich beim Import ein: reiter.<name> = { zeigen() }.
export const reiter = {};

export function zeigeAnsicht(name) {
  for (const a of ANSICHTEN) $(`ansicht-${a}`).hidden = a !== name;
  for (const k of document.querySelectorAll('[data-ziel]')) {
    k.classList.toggle('aktiv', k.dataset.ziel === name);
  }
  meldung('');
  window.scrollTo(0, 0);
  reiter[name]?.zeigen?.();
}

// Ruft eine pep_-Funktion auf. Abgelaufene Anmeldung oder fehlende Rechte → Login.
export async function aufruf(funktion, parameter = {}) {
  try {
    return await sitzung.orgRpc(funktion, parameter);
  } catch (fehler) {
    if (fehler.message === 'NICHT_ANGEMELDET' || fehler.status === 401 || fehler.message === 'KEIN_ZUGRIFF') {
      abmelden(fehlerText(fehler.message === 'KEIN_ZUGRIFF' ? 'KEIN_ZUGRIFF' : 'NICHT_ANGEMELDET'));
      fehler.behandelt = true;
    }
    throw fehler;
  }
}

export async function aktualisiereIch() {
  ich = await aufruf('pep_ich');
  $('wer').textContent = `Angemeldet als ${ich.anzeigename}`;
  $('nav-einstellungen').hidden = ich.rolle !== 'leitung';
  return ich;
}

function fehlerAnzeigen(fehler) {
  if (!fehler.behandelt) meldung(fehlerText(fehler.message));
}

// ---------------------------------------------------------------- Anmeldung

export function abmelden(text = '') {
  sitzung.logout();
  ich = null;
  $('wer').textContent = '';
  $('navigation').hidden = true;
  zeigeAnsicht('login');
  meldung(text);
  $('login-name').focus();
}

async function nachLogin() {
  try {
    await aktualisiereIch();
  } catch (fehler) {
    fehlerAnzeigen(fehler);
    return;
  }
  if (!ich.filiale && ich.rolle === 'leitung') {
    $('navigation').hidden = true;
    zeigeAnsicht('filiale');
    return;
  }
  $('navigation').hidden = false;
  zeigeAnsicht('start');
}

async function login(ereignis) {
  ereignis.preventDefault();
  meldung('');
  const name = $('login-name').value;
  const passwort = $('login-passwort').value;
  if (!name.trim() || !passwort) return meldung('Bitte Benutzername und Passwort eingeben.');
  $('login-knopf').disabled = true;
  try {
    await sitzung.login(name, passwort);
    $('login-passwort').value = '';
  } catch (fehler) {
    $('login-knopf').disabled = false;
    return meldung(fehler.status === 429
      ? 'Zu viele Versuche. Bitte warte einige Minuten.'
      : fehlerText(fehler.message === 'KEINE_VERBINDUNG' ? 'KEINE_VERBINDUNG' : 'invalid_credentials'));
  }
  try {
    await nachLogin();
  } finally {
    $('login-knopf').disabled = false;
  }
}

// ---------------------------------------------------------------- Filiale anlegen

async function filialeAnlegen(ereignis) {
  ereignis.preventDefault();
  meldung('');
  const name = $('filiale-name').value.trim();
  const nummer = $('filiale-nummer').value.trim();
  const land = $('filiale-land').value;
  if (!name) return meldung(fehlerText('NAME_LEER'));
  if (!land) return meldung(fehlerText('BUNDESLAND_UNGUELTIG'));
  $('filiale-knopf').disabled = true;
  try {
    await aufruf('pep_filiale_anlegen', { p_name: name, p_nummer: nummer, p_bundesland: land });
    await aktualisiereIch();
    $('navigation').hidden = false;
    zeigeAnsicht('start');
  } catch (fehler) {
    fehlerAnzeigen(fehler);
  } finally {
    $('filiale-knopf').disabled = false;
  }
}

// ---------------------------------------------------------------- Start

function start() {
  $('login-form').addEventListener('submit', login);
  $('filiale-form').addEventListener('submit', filialeAnlegen);
  $('abmelden').addEventListener('click', () => abmelden());
  for (const k of document.querySelectorAll('[data-ziel]')) {
    k.addEventListener('click', () => zeigeAnsicht(k.dataset.ziel));
  }
  if (sitzung.istAngemeldet()) nachLogin();
  else zeigeAnsicht('login');
}

start();

// Reiter-Module (werden in späteren Tasks ergänzt)
// Jedes Modul trägt sich beim Import mit reiter.<name> = { zeigen } ein.

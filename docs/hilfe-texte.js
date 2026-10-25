// Hilfetexte je Seite für den „?“-Knopf (hilfe-leiste.js). Reine Daten, verdichtet aus ANLEITUNG.md.
// Alles in „…“ ist Wortlaut der Oberfläche; tests/hilfe-texte.test.mjs prüft, dass es ihn in docs/ gibt.
// Schlüssel = Ansicht aus app.js; der Einsatzplan hat für den Modus IST einen eigenen Eintrag (einsatzplan_ist).
export const HILFE = {
  start: {
    titel: 'Startseite',
    wozu: 'Die Startseite zeigt auf einen Blick, wo etwas zu tun ist. Jede Kachel hat eine große Zahl und einen Knopf, '
      + 'der zur passenden Stelle springt.',
    schritte: [
      'Kacheln mit gelbem oder rotem Rand ansehen: Dort gibt es etwas zu tun.',
      'Auf den Knopf unten in der Kachel klicken. PEP öffnet die passende Seite, z. B. den Einsatzplan am ersten Tag mit Warnung.',
      'In der Kachel „Regelverstöße“ öffnet ein Klick auf einen Tag den Einsatzplan an genau diesem Tag.',
      'Nur Leitung: Ist die Zeile „Letzte Sicherung“ gelb, über „Sicherung →“ eine Sicherung herunterladen.',
    ],
    gut_zu_wissen: [
      'Grüner Rand heißt „alles im grünen Bereich“.',
      '„IST offen“ zählt Tage der letzten sechs Wochen, die noch nicht bestätigt sind. Offene Tage verhindern „Woche buchen“ im Zeitkonto.',
      '„Zeitkonto auffällig“ nennt, wer nach der zuletzt gebuchten Woche zu viel Plus oder Minus hat.',
      'Die Zahlen werden bei jedem Öffnen der Startseite neu berechnet.',
    ],
  },

  abwesenheiten: {
    titel: 'Abwesenheiten',
    wozu: 'Hier stehen Urlaub, Krankheit, Berufsschule und andere Abwesenheiten aller Mitarbeiter, ein Monat auf einmal. '
      + 'Sperrende Abwesenheiten verhindern, dass jemand im Einsatzplan eingeplant wird.',
    schritte: [
      'Monat mit ◀ ▶ oder „Heute“ wählen.',
      'Code in der Palette wählen (z. B. U) und mit gedrückter Maustaste oder dem Finger entlang der Zeile ziehen. Gespeichert wird sofort.',
      '„Löschen“ wählen und über die Tage ziehen: Die Einträge verschwinden.',
      'Feste Termine wie Berufsschule jeden Dienstag: „Wiederholung …“.',
      '„Ansehen“ wählen und auf eine Zelle klicken: Details. Nur Leitung: Urlaubswünsche („U?“, gestrichelt) dort genehmigen oder ablehnen.',
    ],
    gut_zu_wissen: [
      'Geschlossene Tage überspringt PEP beim Ziehen.',
      'Bei Codes mit tatsächlichen Stunden fragt PEP nach den Stunden. Ist „mit Uhrzeit“ an, auch nach von und bis.',
      'Unter dem Raster zeigt die aufklappbare Übersicht Anspruch, genehmigt und Rest im Urlaubsjahr.',
      '„Drucken“: der Monat oder der Resturlaub des Jahres.',
    ],
  },

  vorausplanung: {
    titel: 'Vorausplanung',
    wozu: 'Sechs Wochen nebeneinander: Wie viele Stunden braucht die Filiale laut Umsatz, und wie viele sind verfügbar? '
      + 'Daraus kommt die Stundenvorgabe für den Einsatzplan.',
    schritte: [
      'Wochen mit ◀ ▶ blättern, „Aktuelle Woche“ springt zurück.',
      'Planumsatz in Euro eintragen, z. B. 60.000. Gespeichert wird beim Verlassen des Feldes.',
      'Stundenleistung nur eintragen, wenn sie abweichen soll. Leer gilt der Wert aus den Einstellungen.',
      'Bei Bedarf eine „Stundenvorgabe von Hand“ eintragen. Sie ersetzt das Soll.',
      'Klick auf eine Kalenderwoche im Tabellenkopf öffnet den Einsatzplan dieser Woche.',
    ],
    gut_zu_wissen: [
      'Soll-Stunden = Planumsatz ÷ Stundenleistung.',
      'Überhang = Verfügbar − Soll. Rot heißt: Es fehlen Stunden.',
      'Die „Vorgabe für den Einsatzplan“ steht dort in der Seitenleiste bei der Woche.',
      '„Geplant“ zeigt, was im Einsatzplan schon eingetragen ist (ohne Pausen).',
    ],
  },

  einsatzplan: {
    titel: 'Einsatzplan',
    wozu: 'Hier wird geplant, wer an welchem Tag wann in welchem Bereich arbeitet, in halben Stunden. '
      + 'Die Seitenleiste prüft die Regeln und zählt die Stunden der Woche.',
    schritte: [
      'Oben links „Plan“ gewählt lassen. Woche mit ◀ ▶, Datumsfeld oder „Heute“ wählen, dann den Tag.',
      'Pinsel wählen (ein Bereich je Knopf) und in der Zeile des Mitarbeiters über die Zeit ziehen.',
      '„Radieren“ leert die gezogenen halben Stunden. „Rückgängig“ nimmt die letzten Striche zurück.',
      'Notiz: in die Kommentarspalte klicken, tippen, Enter.',
      '„Kopieren“ und „Vorlagen“ übertragen einen Tag oder eine Woche. „Krank/ZA“ trägt Krankheit oder Zeitausgleich ein.',
    ],
    gut_zu_wissen: [
      'Geht ein Strich nicht (z. B. Kompetenz fehlt), steht der Grund kurz am Zeiger und oben als Meldung.',
      'Rot gestreift = unbesetzt, weil die Person abwesend ist. „Ersatz“ zeigt, wer einspringen kann.',
      'Kasse und VP unter dem Raster: Rot heißt, niemand ist da.',
      'Klick auf einen Namen öffnet die Eckdaten der Person.',
      'Vergangene Tage sind schreibgeschützt. „IST erfassen“ wechselt in den Modus IST.',
      'Am Tablet: waagerecht ziehen malt, senkrecht wischen scrollt.',
    ],
  },

  einsatzplan_ist: {
    titel: 'Einsatzplan: IST erfassen',
    wozu: 'Im Modus IST stehen die Zeiten, die wirklich gearbeitet wurden. Nur bestätigte Tage zählen im Zeitkonto. '
      + 'IST gibt es für heute und vergangene Tage ab dem Start der IST-Erfassung.',
    schritte: [
      'Oben links „IST“ wählen und den Tag öffnen. Die Kachel „IST offen“ auf der Startseite springt zum ersten offenen Tag.',
      'Blass und gestrichelt steht der Plan als Vorschlag in der Zeile.',
      'Abweichungen malen wie im Plan: länger geblieben weiter malen, früher gegangen radieren. Nicht gekommen: die ganze Zeile radieren.',
      'Nach Feierabend „Tag bestätigen“: PEP fragt vorher nach. Zeilen ohne eigenes IST übernehmen den Vorschlag. '
        + 'Der Haken ✓ in einer Zeile bestätigt nur diese, ohne Rückfrage.',
    ],
    gut_zu_wissen: [
      'Bestätigen lässt sich nicht zurücknehmen. Bestätigte Zeilen ändern geht nur mit Grund.',
      'Ist die Woche schon gebucht, bucht PEP die Änderung automatisch als Korrektur ins Zeitkonto.',
      'Rechts in jeder Zeile: der Status und „Abw.“ (IST minus Plan in Stunden).',
      '„Zeitrahmen erweitern“ zeigt 04:00 bis 24:00. Im IST gibt es keine Regel- und Kompetenzprüfung.',
      'Krankheit trotzdem eintragen: im Modus „Plan“ über „Krank/ZA“ oder im Reiter Abwesenheiten.',
      '„Wocheneinsatz-IST drucken“ druckt die ganze Woche.',
    ],
  },

  zeitkonto: {
    titel: 'Zeitkonto',
    wozu: 'Je Woche und Mitarbeiter: Stunden mehr oder weniger als im Vertrag, dazu der Saldo. Zuerst steht die Vorwoche da.',
    schritte: [
      'Woche mit ◀ ▶ wählen, „Vorwoche“ springt zurück.',
      'Offene Tage: auf „im IST offen“ klicken und im Einsatzplan bestätigen.',
      'Nur Leitung, einmal vor dem ersten „Woche buchen“: je Mitarbeiter im Journal „Startsaldo“ buchen, '
        + 'Datum = Sonntag vor der Startwoche.',
      'Nur Leitung: „Woche buchen“ geht, wenn die Woche vorbei und kein Tag mehr offen ist. '
        + 'PEP bucht für jeden aktiven Mitarbeiter mit Vertrag die Diff ins Journal.',
      'Klick auf einen Namen öffnet das Journal. Nur Leitung: dort „Korrektur buchen“ mit Stunden, Datum und Grund.',
    ],
    gut_zu_wissen: [
      'Zuerst buchbar ist die Startwoche („IST-Erfassung ab“ in den Einstellungen), danach immer die nächste.',
      'Nach dem ersten Abschluss geht nur noch „Korrektur buchen“. Abschlüsse lassen sich nicht zurücknehmen; '
        + 'spätere Änderungen bucht PEP automatisch nach.',
      'Diff = IST + Abwesend + Feiertag − Soll, nur bestätigte Tage. Grau = laufende Woche, vorläufig. '
        + '⚠ = Saldo über dem Warnwert.',
      '„Drucken“: Stundenblatt oder Wocheneinsatz-IST. „Journal als Excel“ lädt die Buchungen eines gewählten Zeitraums herunter.',
    ],
  },

  mitarbeiter: {
    titel: 'Mitarbeiter',
    wozu: 'Alle Mitarbeiter mit Stammdaten, Verträgen, Kompetenzen, Wochenvorgaben und Urlaubsjahren. '
      + 'Damit rechnet und prüft PEP überall. Ändern darf nur die Leitung, die Stellvertretung liest.',
    schritte: [
      'Links einen Namen wählen. Rechts (am Tablet darunter) erscheint die Karte der Person.',
      'Angaben ändern und im selben Abschnitt „Speichern“ klicken. Haken bei den Kompetenzen speichern sofort.',
      'Neuer Vertrag: unter „Verträge“ „Gültig ab“, Art und Wochenstunden eintragen, dann „Vertrag anlegen“.',
      '„Neuer Mitarbeiter“ legt eine Person an.',
      'Mit ▲ und ▼ neben einem Namen die Reihenfolge im Einsatzplan ändern.',
    ],
    gut_zu_wissen: [
      'Inaktive Mitarbeiter stehen grau am Ende der Liste.',
      'Kompetenzen bestimmen, in welchem Bereich jemand eingeplant werden kann.',
      'Wochenvorgaben mit „Pflicht“ sperren im Einsatzplan, die anderen geben nur einen Hinweis.',
      'Der letzte Vertrag eines Mitarbeiters lässt sich nicht löschen.',
    ],
  },

  einstellungen: {
    titel: 'Einstellungen',
    wozu: 'Hier steht, wie die Filiale arbeitet; den Reiter sieht nur die Leitung. Oben den Teil wählen: „Filiale & Zeiten“, '
      + '„Bereiche & Codes“, „Regeln & Zeitkonto“, „Urlaubstool“ oder „Benutzer & Sicherung“.',
    schritte: [
      'Wert ändern, dann in der Zeile „Speichern“ bzw. „Anlegen“. Sofort gespeichert werden die Regelparameter, '
        + '„IST-Erfassung ab“ und der Haken „aktiv“ einer Umfrage.',
      'Feiertage stehen unter „Abweichende Tage“. „öffnen …“ macht einen Feiertag zum Öffnungstag.',
      'Urlaubstool: Umfrage mit „aktiv“ einschalten, dann unter „Teilnehmer zuordnen“ „Vorschläge übernehmen“ '
        + 'oder je Zeile wählen und „Speichern“.',
      'Jede Woche „Sicherung herunterladen“. Die Datei auf dem PC oder USB-Stick aufheben, nie per E-Mail schicken.',
    ],
    gut_zu_wissen: [
      '„IST-Erfassung ab“ lässt sich nur vor dem ersten „Woche buchen“ ändern.',
      '„Gutschrift im Zeitkonto“: Die Stunden des Codes zählen wie Arbeitszeit (bei ZA aus).',
      'Eine Umfrage lässt sich nur in einer Filiale einschalten. Ausschalten behält die Zuordnungen. '
        + 'Umfragen anderer Leitungen erscheinen erst nach deren erster Anmeldung.',
      'Stellvertretung unter „Benutzer“ hinzufügen; sie braucht ein Urlaubstool-Konto.',
      'Die Sicherung enthält das Protokoll nur der letzten 12 Monate. Einspielen geht nur in eine leere Filiale.',
      'GitHub weckt die Datenbank alle zwei Tage; nichts zu tun.',
    ],
  },
};

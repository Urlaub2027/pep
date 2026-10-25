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
      'Nach Feierabend „Tag bestätigen“. Zeilen ohne eigenes IST übernehmen den Vorschlag. Einzelne Zeilen bestätigt der Haken ✓.',
    ],
    gut_zu_wissen: [
      'Bestätigen lässt sich nicht zurücknehmen. Wer eine bestätigte Zeile ändert, muss einen Grund angeben.',
      'Ist die Woche schon gebucht, bucht PEP die Änderung automatisch als Korrektur ins Zeitkonto.',
      'Rechts in jeder Zeile: der Status und „Abw.“ (IST minus Plan in Stunden).',
      '„Zeitrahmen erweitern“ zeigt 04:00 bis 24:00. Im IST gibt es keine Regel- und Kompetenzprüfung.',
      'Krankheit trotzdem im Plan über „Krank/ZA“ eintragen.',
      '„Wocheneinsatz-IST drucken“ druckt die ganze Woche.',
    ],
  },

  zeitkonto: {
    titel: 'Zeitkonto',
    wozu: 'Das Zeitkonto zeigt je Woche, wie viele Stunden jeder mehr oder weniger gearbeitet hat als im Vertrag, '
      + 'und führt den Saldo. Zuerst steht die Vorwoche da: Sie wird am Montag gebucht.',
    schritte: [
      'Woche mit ◀ ▶ wählen. „Vorwoche“ springt zurück.',
      'Sind noch Tage offen, auf „im IST offen“ klicken und die Tage im Einsatzplan bestätigen.',
      'Nur Leitung: „Woche buchen“. PEP bucht für jeden Mitarbeiter die Diff ins Journal. Wochen gehen nur der Reihe nach.',
      'Klick auf einen Namen öffnet das Journal mit allen Buchungen.',
      'Nur Leitung: im Journal „Startsaldo“ (nur als erste Buchung) oder „Korrektur buchen“ mit Stunden, Datum und Grund.',
    ],
    gut_zu_wissen: [
      'Diff = IST + Abwesend + Feiertag − Soll. Nur bestätigte Tage zählen.',
      'In der laufenden Woche sind Diff und Saldo grau, also vorläufig.',
      '⚠ auf gelbem Grund: Der Saldo liegt über dem Warnwert.',
      'Ein Abschluss lässt sich nicht zurücknehmen. Ändert sich danach etwas, bucht PEP automatisch eine Korrektur.',
      '„Drucken“: Stundenblatt oder Wocheneinsatz-IST. „Journal als Excel“ lädt alle Buchungen herunter.',
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
    wozu: 'Hier wird festgelegt, wie die Filiale arbeitet: Öffnungszeiten, Bereiche, Codes, Regeln, Urlaubstool, '
      + 'Benutzer und Sicherung. Diesen Reiter sieht nur die Leitung.',
    schritte: [
      'Wert ändern und in der Zeile „Speichern“ klicken. Regelparameter speichern sofort beim Verlassen des Feldes.',
      'Feiertage stehen unter „Abweichende Tage“. „öffnen …“ macht einen Feiertag zum Öffnungstag.',
      'Urlaubstool: eine Umfrage mit „aktiv“ einschalten, dann unter „Teilnehmer zuordnen“ „Vorschläge übernehmen“ oder je Zeile wählen und „Speichern“.',
      'Jede Woche unter „Sicherung“ auf „Sicherung herunterladen“ klicken. Die Datei auf dem PC oder USB-Stick aufheben, nicht per E-Mail schicken.',
    ],
    gut_zu_wissen: [
      '„IST-Erfassung ab“ lässt sich nur vor dem ersten „Woche buchen“ ändern.',
      '„Gutschrift im Zeitkonto“ bei einem Code: Die Stunden zählen wie Arbeitszeit (bei ZA aus).',
      'Umfragen einer anderen Leitung erscheinen erst nach deren erster Anmeldung in der PEP.',
      'Unter „Benutzer“ eine Stellvertretung hinzufügen. Sie braucht ein Konto im Urlaubstool.',
      'Eine Sicherung lässt sich nur in eine leere Filiale einspielen.',
      'Damit die Datenbank nicht pausiert, weckt GitHub sie alle zwei Tage von selbst. Dafür ist nichts zu tun.',
    ],
  },
};

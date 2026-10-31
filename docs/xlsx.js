// Kopie aus Urlaub2027/urlaub docs/xlsx.js (Stand c7454fe), WEICHT AB: PEP hat zusätzlich Datumszellen
// ({ datum: 'JJJJ-MM-TT' } → excelDatum, Stil 3 mit numFmt 164 „dd.mm.yyyy“; Stufe 2, Journal als Excel). Beim
// Übernehmen einer neueren Urlaubstool-Fassung diese Teile mitnehmen (oder sie dort einbauen).
// Minimaler Excel-Schreiber (.xlsx) ohne fremde Bibliothek.
// Eine .xlsx-Datei ist ein ZIP-Archiv mit XML-Dateien; hier unkomprimiert ("stored").
//
// blaetter: [{ name, spalten: [{ titel, breite }], zeilen: [[wert, ...]], fixiereSpalten }]
// Werte: Zahl → Zahlzelle, { datum: 'JJJJ-MM-TT' } → Datumszelle (Anzeige TT.MM.JJJJ), alles andere → Text.
// null/undefined, '' und ein ungültiges Datum → leere Zelle.
// Texte stehen wie bei Excel in xl/sharedStrings.xml: Die iPhone-/Mac-Vorschau zeigt
// Inline-Texte (t="inlineStr") nicht an, die Blätter blieben dort leer.

const enc = new TextEncoder();

// In XML 1.0 ungültig: Steuerzeichen außer Tab/Zeilenumbruch, U+FFFE, U+FFFF und
// einzelne (nicht gepaarte) Surrogate. Gepaarte Surrogate (z. B. Emoji) bleiben.
// Ohne Lookbehind (Safari/iOS < 16.4 würde sonst schon beim Parsen scheitern): gültige Paare
// werden als Treffer erkannt und unverändert zurückgegeben, alles andere entfällt.
const UNGUELTIG = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

export function bereinige(text) {
  return String(text).replace(UNGUELTIG, (m) => (m.length === 2 ? m : ''));
}

function xml(text) {
  return bereinige(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function spaltenName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

// Excel-Seriennummer eines Datums 'JJJJ-MM-TT': Tage seit dem 30.12.1899 (so zählt Excel ab März 1900 richtig,
// einschließlich des erfundenen 29.02.1900). Ungültig → null.
export function excelDatum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000) : null;
}

const DATUMSSTIL = 3; // cellXfs-Index in styles.xml: numFmt 164 „dd.mm.yyyy“

// texte: { index: Map(Text → Nr.), anzahl } — wird über alle Blätter gemeinsam befüllt.
function zelle(wert, ref, stil, texte) {
  const s = stil ? ` s="${stil}"` : '';
  if (wert === null || wert === undefined || wert === '') return '';
  if (typeof wert === 'object' && 'datum' in wert) {
    const n = excelDatum(wert.datum);
    return n === null ? '' : `<c r="${ref}" s="${DATUMSSTIL}"><v>${n}</v></c>`;
  }
  if (typeof wert === 'number' && Number.isFinite(wert)) return `<c r="${ref}"${s}><v>${wert}</v></c>`;
  const text = bereinige(wert);
  if (!texte.index.has(text)) texte.index.set(text, texte.index.size);
  texte.anzahl += 1;
  return `<c r="${ref}" t="s"${s}><v>${texte.index.get(text)}</v></c>`;
}

function blattXml(blatt, texte) {
  const fixiert = blatt.fixiereSpalten || 0;
  const pane = fixiert
    ? `<pane xSplit="${fixiert}" ySplit="1" topLeftCell="${spaltenName(fixiert)}2" activePane="bottomRight" state="frozen"/>`
    : '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>';
  const cols = blatt.spalten.map((s, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${s.breite || 12}" customWidth="1"/>`).join('');
  const kopf = `<row r="1">${blatt.spalten.map((s, i) => zelle(s.titel, `${spaltenName(i)}1`, 1, texte)).join('')}</row>`;
  const daten = blatt.zeilen.map((zeile, z) =>
    `<row r="${z + 2}">${zeile.map((w, i) => zelle(w, `${spaltenName(i)}${z + 2}`, 2, texte)).join('')}</row>`).join('');
  const letzte = `${spaltenName(blatt.spalten.length - 1)}${blatt.zeilen.length + 1}`;
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`
    + `<cols>${cols}</cols><sheetData>${kopf}${daten}</sheetData>`
    + `<autoFilter ref="A1:${letzte}"/>`
    + '</worksheet>';
}

function blattName(name) {
  return xml(String(name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
}

function sstXml(texte) {
  const eintraege = [...texte.index.keys()].map((t) => `<si><t xml:space="preserve">${xml(t)}</t></si>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ` count="${texte.anzahl}" uniqueCount="${texte.index.size}">${eintraege}</sst>`;
}

function dateien(blaetter) {
  const texte = { index: new Map(), anzahl: 0 };
  const blattDateien = blaetter.map((b, i) => [`xl/worksheets/sheet${i + 1}.xml`, blattXml(b, texte)]);
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + blaetter.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${blaetter.map((b, i) => `<sheet name="${blattName(b.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + '<definedNames>'
    + blaetter.map((b, i) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${blattName(b.name)}'!$A$1:$${spaltenName(b.spalten.length - 1)}$${b.zeilen.length + 1}</definedName>`).join('')
    + '</definedNames></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + blaetter.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${blaetter.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + `<Relationship Id="rId${blaetter.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>`
    + '</Relationships>';
  // Stil 0 = Standard, 1 = Kopfzeile (fett, grau), 2 = Daten (oben ausgerichtet, Umbruch), 3 = Datum (PEP, wie 2 mit
  // eigenem Zahlenformat 164 „dd.mm.yyyy“; eigene Formate beginnen bei 164)
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<numFmts count="1"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFDDE3EA"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
    + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
    + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';
  return [
    ['[Content_Types].xml', ct],
    ['_rels/.rels', rels],
    ['xl/workbook.xml', workbook],
    ['xl/_rels/workbook.xml.rels', wbRels],
    ['xl/styles.xml', styles],
    ['xl/sharedStrings.xml', sstXml(texte)],
    ...blattDateien,
  ];
}

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABELLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(eintraege) {
  const teile = [];
  const verzeichnis = [];
  let versatz = 0;
  for (const [name, inhalt] of eintraege) {
    const n = enc.encode(name);
    const d = enc.encode(inhalt);
    const crc = crc32(d);
    const lokal = new DataView(new ArrayBuffer(30));
    lokal.setUint32(0, 0x04034b50, true);
    lokal.setUint16(4, 20, true);
    lokal.setUint16(6, 0x0800, true);        // Dateinamen in UTF-8
    lokal.setUint16(8, 0, true);             // keine Kompression
    lokal.setUint16(10, 0, true);
    lokal.setUint16(12, 0x21, true);         // 01.01.1980
    lokal.setUint32(14, crc, true);
    lokal.setUint32(18, d.length, true);
    lokal.setUint32(22, d.length, true);
    lokal.setUint16(26, n.length, true);
    lokal.setUint16(28, 0, true);
    teile.push(new Uint8Array(lokal.buffer), n, d);

    const zentral = new DataView(new ArrayBuffer(46));
    zentral.setUint32(0, 0x02014b50, true);
    zentral.setUint16(4, 20, true);
    zentral.setUint16(6, 20, true);
    zentral.setUint16(8, 0x0800, true);
    zentral.setUint16(10, 0, true);
    zentral.setUint16(12, 0, true);
    zentral.setUint16(14, 0x21, true);
    zentral.setUint32(16, crc, true);
    zentral.setUint32(20, d.length, true);
    zentral.setUint32(24, d.length, true);
    zentral.setUint16(28, n.length, true);
    zentral.setUint32(42, versatz, true);
    verzeichnis.push(new Uint8Array(zentral.buffer), n);
    versatz += 30 + n.length + d.length;
  }
  const groesse = verzeichnis.reduce((s, t) => s + t.length, 0);
  const ende = new DataView(new ArrayBuffer(22));
  ende.setUint32(0, 0x06054b50, true);
  ende.setUint16(8, eintraege.length, true);
  ende.setUint16(10, eintraege.length, true);
  ende.setUint32(12, groesse, true);
  ende.setUint32(16, versatz, true);
  const alle = [...teile, ...verzeichnis, new Uint8Array(ende.buffer)];
  const ergebnis = new Uint8Array(alle.reduce((s, t) => s + t.length, 0));
  let pos = 0;
  for (const t of alle) { ergebnis.set(t, pos); pos += t.length; }
  return ergebnis;
}

export function erzeugeXlsx(blaetter) {
  return zip(dateien(blaetter));
}

import { zipSync, strToU8 } from 'fflate';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { REGULAR_FONT, BOLD_FONT } from './assets/fonts.js';

// Exports are generated in the Worker; no document or font is sent to a converter.
const MAX_CHARS = 100000;
const PAGE = { width: 595.28, height: 841.89, margin: 52, bottom: 57 };
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf' };
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOCREL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const ICONS = /[⏱🎬🎤🎭📄📋👥⚙✅☑📌📍📝📚🔊🎵🎶🏆🥇🥈🥉🎓🏛💡💐📣📱📦🔄➕➖⬆⬇⬅➡🧩🔍📥📤🚪⏰🔧📅🕒👤]/gu;
const escapeXml = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function cleanExportText(value) {
  return String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(ICONS, '').replace(/[\ufe0e\ufe0f\u200d]/g, '')
    .split('\n').map(line => line.replace(/^\s*#{1,6}\s+/u, '').replace(/\*\*([^*]+)\*\*/g, '$1').trim()).join('\n').trim();
}

function paragraphKind(text) {
  // Timing rows form a list, not a chain of keep-with-next headings.
  if (/^\d{1,2}:\d{2}(?:\s*\(\+\d+\))?\s*[–—-]\s*\d{1,2}:\d{2}.+$/u.test(text)) return 'timeline';
  if (text.length <= 180 && (/^[\p{Lu}\d][\p{Lu}\d\s·:–—()\-/]+$/u.test(text)
    || /^\d{1,2}\.\s+.+\s+·\s+\d{1,2}:\d{2}(?:\s*\(\+\d+\))?\s*[–—-]\s*\d{1,2}:\d{2}/u.test(text))) return 'heading';
  return 'body';
}

export function exportParagraphs(text) {
  let gap = false;
  return cleanExportText(text).split('\n').flatMap(line => {
    if (!line) { gap = true; return []; }
    const paragraph = { text: line, kind: paragraphKind(line), gap };
    gap = false;
    return [paragraph];
  });
}

function run(text, bold = false) {
  return `<w:r>${bold ? '<w:rPr><w:b/><w:color w:val="000000"/></w:rPr>' : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function docxParagraph({ text, kind = 'body', gap = false }) {
  const style = kind === 'title' ? 'Title' : kind === 'heading' ? 'Heading1' : kind === 'timeline' ? 'Timeline' : 'Normal';
  const prefix = kind === 'body' && text.match(/^((?:Ведущ(?:ий|ая)|Жүргізуші|Host|Музыка|Звук|Дыбыс|Sound|Координатор|Coordinator)\s*\d*(?:\s*(?:\([^)]*\)|·[^:]{1,80}))?\s*:)/iu);
  const content = prefix ? run(prefix[0], true) + run(text.slice(prefix[0].length)) : run(text);
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:widowControl/>${gap && kind === 'body' ? '<w:spacing w:before="120" w:after="100"/>' : ''}</w:pPr>${content}</w:p>`;
}

function buildDocx(title, paragraphs) {
  const styles = `${XML}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="24"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:after="280"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="000000"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Timeline"><w:name w:val="Іс-шара жоспары"/><w:basedOn w:val="Normal"/><w:next w:val="Timeline"/><w:pPr><w:keepNext w:val="0"/><w:spacing w:before="0" w:after="60" w:line="260" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="22"/></w:rPr></w:style></w:styles>`;
  const document = `${XML}<w:document xmlns:w="${W}" xmlns:r="${DOCREL}"><w:body>${docxParagraph({ text: title, kind: 'title' })}${paragraphs.map(docxParagraph).join('')}<w:sectPr><w:footerReference w:type="default" r:id="rFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1040" w:right="1040" w:bottom="1140" w:left="1040" w:header="480" w:footer="480" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const footer = `${XML}<w:ftr xmlns:w="${W}"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">OAIU · </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple><w:r><w:t xml:space="preserve"> / </w:t></w:r><w:fldSimple w:instr="NUMPAGES"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;
  const files = {
    '[Content_Types].xml': `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
    '_rels/.rels': `${XML}<Relationships xmlns="${REL}"><Relationship Id="rMain" Type="${DOCREL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    'word/_rels/document.xml.rels': `${XML}<Relationships xmlns="${REL}"><Relationship Id="rStyles" Type="${DOCREL}/styles" Target="styles.xml"/><Relationship Id="rFooter" Type="${DOCREL}/footer" Target="footer1.xml"/></Relationships>`,
    'word/document.xml': document, 'word/styles.xml': styles, 'word/footer1.xml': footer,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)])), { level: 6, mtime: new Date('2020-01-01T00:00:00Z') });
}

let regularBytes, boldBytes;
function fontBytes(encoded) { return Uint8Array.from(atob(encoded), char => char.charCodeAt(0)); }

export function wrapText(text, width, measure) {
  const lines = []; let line = '';
  for (const word of text.split(/\s+/u)) {
    if (!word) continue;
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= width) { line = candidate; continue; }
    if (line) { lines.push(line); line = ''; }
    if (measure(word) <= width) { line = word; continue; }
    // Long URLs and unbroken tokens must never run outside the page.
    for (const character of word) {
      if (line && measure(line + character) > width) { lines.push(line); line = ''; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

async function buildPdf(title, paragraphs) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  regularBytes ||= fontBytes(REGULAR_FONT); boldBytes ||= fontBytes(BOLD_FONT);
  const regular = await pdf.embedFont(regularBytes, { subset: true });
  const bold = await pdf.embedFont(boldBytes, { subset: true });
  const supported = new Set(regular.getCharacterSet());
  // RU, KK and EN are fully covered. Preserve uncommon unsupported symbols
  // explicitly as their Unicode code rather than silently printing a square.
  const supportedText = value => [...value].map(char => supported.has(char.codePointAt(0)) ? char : `[U+${char.codePointAt(0).toString(16).toUpperCase()}]`).join('');
  pdf.setTitle(title); pdf.setCreator('OAIU көмекшісі'); pdf.setProducer('OAIU көмекшісі');
  let page, y;
  const newPage = () => {
    if (pdf.getPageCount() >= 150) throw new RangeError('Document has too many pages');
    page = pdf.addPage([PAGE.width, PAGE.height]); y = PAGE.height - PAGE.margin;
  };
  newPage();
  for (const paragraph of [{ text: title, kind: 'title' }, ...paragraphs]) {
    const heading = paragraph.kind === 'title' || paragraph.kind === 'heading', timing = paragraph.kind === 'timeline', font = heading ? bold : regular;
    const size = paragraph.kind === 'title' ? 18 : heading ? 12 : 11;
    const lineHeight = paragraph.kind === 'title' ? 25 : heading ? 17 : timing ? 14 : 16;
    const before = paragraph.kind === 'title' ? 0 : heading ? 11 : paragraph.gap ? 6 : 0;
    const after = paragraph.kind === 'title' ? 13 : heading ? 6 : timing ? 2 : 4;
    const cache = new Map(), measure = text => { if (!cache.has(text)) cache.set(text, font.widthOfTextAtSize(text, size)); return cache.get(text); };
    const lines = wrapText(supportedText(paragraph.text), PAGE.width - 2 * PAGE.margin, measure);
    const needed = lines.length * lineHeight + before + after + (heading ? 32 : 0);
    if (needed <= PAGE.height - PAGE.margin - PAGE.bottom && y - needed < PAGE.bottom) newPage();
    y -= before;
    for (const line of lines) {
      if (y - lineHeight < PAGE.bottom) newPage();
      y -= lineHeight;
      page.drawText(line, { x: PAGE.margin, y, size, font, color: rgb(0, 0, 0) });
    }
    y -= after;
  }
  const count = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    const footer = `OAIU · ${i + 1} / ${count}`;
    p.drawText(footer, { x: (PAGE.width - regular.widthOfTextAtSize(footer, 9)) / 2, y: 28, font: regular, size: 9, color: rgb(0, 0, 0) });
  });
  return pdf.save();
}

export async function buildDocument({ text, title = 'OAIU құжаты', format = 'docx', filename } = {}) {
  if (!Object.hasOwn(MIME, format)) throw new TypeError('Unsupported export format');
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('Document text is empty');
  if (text.length > MAX_CHARS) throw new RangeError('Document is too long');
  const cleanedTitle = cleanExportText(title).replace(/\n/g, ' ').slice(0, 180) || 'OAIU құжаты';
  const paragraphs = exportParagraphs(text);
  if (!paragraphs.length) throw new TypeError('Document text is empty');
  const bytes = format === 'docx' ? buildDocx(cleanedTitle, paragraphs) : await buildPdf(cleanedTitle, paragraphs);
  const stem = String(filename || 'OAIU-document').replace(/\.(?:docx|pdf)$/i, '').replace(/[^\p{L}\p{N}_ -]/gu, '-').slice(0, 80) || 'OAIU-document';
  return { bytes, mime: MIME[format], filename: `${stem}.${format}` };
}

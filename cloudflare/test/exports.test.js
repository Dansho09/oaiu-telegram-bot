import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { buildDocument, cleanExportText, exportParagraphs, wrapText } from '../src/exports.js';

test('DOCX is a real editable package, escapes input, preserves Kazakh and defines pagination', async () => {
  const result = await buildDocument({ title: 'Волейбол OAIU', text: '🎬 СЦЕНАРИЙ\n\nЖүргізуші 1: Ә Ғ Қ Ң Ө Ұ Ү Һ І ә ғ қ ң ө ұ ү һ і\nA < B & «тест»\nTHE END', format: 'docx' });
  assert.equal(result.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.match(result.filename, /\.docx$/);
  const archive = unzipSync(result.bytes), document = strFromU8(archive['word/document.xml']);
  assert.match(document, /Ә Ғ Қ Ң Ө Ұ Ү Һ І ә ғ қ ң ө ұ ү һ і/);
  assert.match(document, /A &lt; B &amp; «тест»/);
  assert.match(document, /THE END/);
  assert.match(document, /w:pStyle w:val="Title"/);
  assert.match(document, /w:footerReference/);
  assert.match(strFromU8(archive['word/footer1.xml']), /NUMPAGES/);
  assert.doesNotMatch(document, /🎬/);
  assert.ok(archive['[Content_Types].xml']);
  assert.ok(archive['_rels/.rels']);
});

test('PDF has embedded Unicode fonts, complete Kazakh character mappings and multiple pages', async () => {
  const text = 'Ә Ғ Қ Ң Ө Ұ Ү Һ І ә ғ қ ң ө ұ ү һ і\n' + Array.from({ length: 110 }, (_, i) => `Жүргізуші ${i + 1}: Құрметті қонақтар! Добро пожаловать на мероприятие OAIU.`).join('\n') + '\nFINAL SENTINEL';
  const result = await buildDocument({ title: 'OAIU сценарий', text, format: 'pdf' });
  assert.equal(result.mime, 'application/pdf');
  assert.equal(new TextDecoder().decode(result.bytes.subarray(0, 4)), '%PDF');
  const pdf = await PDFDocument.load(result.bytes);
  assert.ok(pdf.getPageCount() >= 3);
  assert.ok(pdf.getPageCount() <= 7);
  const streams = pdf.context.enumerateIndirectObjects().flatMap(([, object]) => object instanceof PDFRawStream ? [new TextDecoder().decode(decodePDFRawStream(object).decode())] : []);
  const cmaps = streams.filter(stream => stream.includes('begincmap')).join('\n').toUpperCase();
  for (const character of 'ӘҒҚҢӨҰҮҺІәғқңөұүһі') assert.ok(cmaps.includes(character.charCodeAt(0).toString(16).padStart(4, '0').toUpperCase()), `Missing Unicode ${character}`);
  assert.ok(result.bytes.length < 150000, 'Font subset should keep documents small');
});

test('wrapping never drops words or clips long identifiers and handles astral codepoints', () => {
  const input = 'start ' + 'abc'.repeat(60) + ' ә🌍 finish';
  const lines = wrapText(input, 20, value => [...value].length);
  assert.ok(lines.every(line => [...line].length <= 20));
  assert.equal(lines.join('').replaceAll(' ', ''), input.replaceAll(' ', ''));
  assert.ok(lines.some(line => line.includes('🌍')));
});

test('export formatting retains content, strips only decorative markup and blocks unreasonable inputs', async () => {
  assert.equal(cleanExportText('📄 **Сценарий**\r\n\u0000Әңгіме'), 'Сценарий\nӘңгіме');
  assert.equal(exportParagraphs('СЦЕНАРИЙ\n\nВедущий 1: Спасибо.')[1].gap, true);
  await assert.rejects(buildDocument({ text: '' }), /empty/);
  await assert.rejects(buildDocument({ text: 'a'.repeat(100001) }), /too long/);
  await assert.rejects(buildDocument({ text: 'a', format: 'exe' }), /Unsupported/);
  const result = await buildDocument({ text: 'Текст', filename: '../../bad\nname.pdf' });
  assert.doesNotMatch(result.filename, /[/\n]/);
});

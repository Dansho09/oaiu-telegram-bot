import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { fixture } from './fixture.js';
import { OaiuBot, readDocumentBytes, ServiceError } from '../src/worker.js';
import { MAX_DOCX_BYTES, ImportError } from '../src/imports.js';
import { catalog } from '../src/directory.js';

let sequence = 900000;
const update = (text, document, id = 70, username = 'owner_test') => ({ update_id: sequence++, message: { chat: { id, type: 'private' }, from: { id, username }, ...(text ? { text } : {}), ...(document ? { document } : {}) } });
const tap = (data, id = 70) => ({ update_id: sequence++, callback_query: { id: String(sequence), from: { id }, data, message: { chat: { id, type: 'private' }, from: { id: 999, is_bot: true } } } });
const metadata = { file_id: 'attached-docx-id', file_name: 'people.docx', file_size: 5000, mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const document = () => zipSync({ '[Content_Types].xml': strToU8('<Types/>'), 'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Новый Имя Отчество; Ректор OAIU</w:t></w:r></w:p></w:body></w:document>') });
function configured() { const f = fixture({ BOT_OWNER_USERNAME: 'owner_test' }); f.dialogue.accept(update('/admin')); f.dialogue.accept(tap('admin:import:directory')); f.store.exec('DELETE FROM outbox'); return f; }
function queued(f) { f.dialogue.accept(update('', metadata)); return JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='import_document'").payload); }
function fileStub(f, result = { file_path: 'documents/file_1.docx', file_size: 5000 }) { const original = f.bot.telegram; f.bot.telegram = async (method, payload, form) => { if (method === 'getFile') { f.sent.push({ method, payload }); return result; } return original(method, payload, form); }; }
async function mockFetch(handler, run) { const original = globalThis.fetch; globalThis.fetch = handler; try { return await run(); } finally { globalThis.fetch = original; } }

test('Telegram document update downloads only the official path and publishes only after owner review', async () => {
  const f = configured(), payload = queued(f), before = catalog(f.store); fileStub(f);
  await mockFetch(async (url, options) => {
    assert.equal(url, 'https://api.telegram.org/file/bottest-token/documents/file_1.docx'); assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal);
    return new Response(document());
  }, () => f.bot.flushOutbox());
  assert.equal(f.sent[0].method, 'sendMessage'); assert.equal(f.sent[0].payload.text, 'Құжатты оқып жатырмын…');
  assert.deepEqual(f.sent.find(call => call.method === 'getFile').payload, { file_id: metadata.file_id });
  assert.equal(f.store.get(70).step, 'admin_import_review'); assert.deepEqual(catalog(f.store), before); assert.equal(f.store.one("SELECT * FROM outbox WHERE kind='import_document'"), undefined);
  const preview = f.sent.filter(c => c.method === 'sendMessage').at(-1).payload; assert.match(preview.text, /аты-жөні мен лауазымын тексеріңіз/); assert.ok(JSON.stringify(preview.reply_markup).includes(payload.nonce));
  f.dialogue.accept(tap('admin:import_confirm:' + payload.nonce)); assert.equal(catalog(f.store)[0].name, 'Новый Имя Отчество');
});

test('untrusted attachments never queue downloads or expose the admin interface', async () => {
  const f = configured(); f.dialogue.accept(update('', metadata, 71, 'owner_test'));
  assert.equal(f.store.one("SELECT * FROM outbox WHERE kind='import_document'"), undefined); assert.equal(f.store.get(71).step, 'type');
  await mockFetch(() => { throw new Error('No external request allowed'); }, () => f.bot.flushOutbox());
  const denied = f.sent.find(c => c.payload?.chat_id === 71); assert.match(denied.payload.text, /қолжетімсіз/); assert.equal(denied.payload.reply_markup, undefined);
});

test('download rejects traversal, foreign URLs and oversized getFile metadata before fetching', async () => {
  for (const result of [
    { file_path: '../private.docx' }, { file_path: '/documents/secret.docx' }, { file_path: 'https://example.invalid/file.docx' }, { file_path: 'documents/%2e%2e.docx' }, { file_path: 'documents/first.docx?token=abc' },
    { file_path: 'documents/file.docx', file_size: MAX_DOCX_BYTES + 1 },
  ]) {
    const f = configured(), payload = queued(f); fileStub(f, result);
    await mockFetch(() => { throw new Error('Validation must precede fetch'); }, async () => { await assert.rejects(f.bot.importDocument(70, payload), ImportError); });
    assert.equal(f.store.get(70).step, 'admin_import_loading'); assert.equal(f.store.meta('directory_overrides'), null);
  }
});

test('bounded download rejects announced and streamed oversize without trusting Content-Length', async () => {
  let canceled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(600000)); c.enqueue(new Uint8Array(600000)); }, cancel() { canceled = true; } });
  await assert.rejects(readDocumentBytes(new Response(stream, { headers: { 'Content-Length': '10' } })), ImportError); assert.equal(canceled, true);
  await assert.rejects(readDocumentBytes(new Response('x', { headers: { 'Content-Length': String(MAX_DOCX_BYTES + 1) } })), ImportError);
  await assert.rejects(readDocumentBytes(new Response(null)), ImportError);
  assert.deepEqual(await readDocumentBytes(new Response(new Uint8Array([1, 2, 3]))), new Uint8Array([1, 2, 3]));
});

test('an upload that finishes after cancellation cannot restore or publish its proposal', async () => {
  const f = configured(), payload = queued(f); fileStub(f);
  let release, fetching; const started = new Promise(resolve => { fetching = resolve; });
  await mockFetch(async () => { fetching(); return new Promise(resolve => { release = () => resolve(new Response(document())); }); }, async () => {
    const pending = f.bot.importDocument(70, payload); await started; f.dialogue.accept(update('/cancel')); release(); await pending;
  });
  assert.equal(f.store.get(70).step, 'type'); assert.equal(f.store.get(70).import_proposal, undefined); assert.equal(f.store.meta('directory_overrides'), null);
});

test('permanent upload failure returns to upload mode with no stale outbox download', async () => {
  const f = configured(); queued(f); fileStub(f);
  await mockFetch(async () => new Response('', { status: 404 }), () => f.bot.flushOutbox());
  assert.equal(f.store.get(70).step, 'admin_import_upload'); assert.equal(f.store.one("SELECT * FROM outbox WHERE kind='import_document'"), undefined);
  assert.ok(f.sent.some(c => c.method === 'sendMessage' && /Құжатты жүктеу мүмкін болмады/.test(c.payload.text)));
});

test('transient upload failure retries but cancellation immediately removes the blocking retry', async () => {
  const f = configured(); queued(f); fileStub(f);
  await mockFetch(async () => new Response('', { status: 503 }), () => f.bot.flushOutbox());
  const pending = f.store.one("SELECT * FROM outbox WHERE kind='import_document'"); assert.equal(pending.attempts, 1); assert.ok(pending.due > Date.now());
  f.dialogue.accept(update('/cancel'));
  assert.equal(f.store.one("SELECT * FROM outbox WHERE kind='import_document'"), undefined, 'A canceled retry must not block the new menu until its due time');
  await f.bot.flushOutbox(); assert.ok(f.sent.some(c => c.method === 'sendMessage' && /Не дайындаймыз/.test(c.payload.text)));
});

test('failed getFile requests never copy secrets or network diagnostics to the user', async () => {
  const f = configured(); queued(f);
  f.bot.telegram = OaiuBot.prototype.telegram.bind(f.bot);
  await mockFetch(async (url) => { assert.ok(url.startsWith('https://api.telegram.org/bottest-token/')); return Response.json({ ok: false, error_code: 404, description: 'Secret transport detail' }, { status: 404 }); }, async () => {
    const payload = JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='import_document'").payload);
    await assert.rejects(f.bot.importDocument(70, payload), e => e instanceof ServiceError && e.status === 404 && !e.message.includes('test-token') && !e.message.includes('Secret transport detail'));
  });
});

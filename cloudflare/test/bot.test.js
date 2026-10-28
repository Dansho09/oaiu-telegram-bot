import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { Store, Dialogue, splitText, parseDelay, messagesFor, outputBudget } from '../src/core.js';
import worker, { OaiuBot, ServiceError, readJson, secretEqual } from '../src/worker.js';


let updateId = 1;
function message(text, chat = 10) { return { update_id: updateId++, message: { chat: { id: chat, type: 'private' }, text } }; }
function button(data, chat = 10) { return { update_id: updateId++, callback_query: { id: `callback-${updateId}`, data, message: { chat: { id: chat, type: 'private' } } } }; }
const ready = { step: 'ready', format: 'speech', language: 'kk', length: '3', tone: 'warm', brief: 'Студенттерге құттықтау', result: 'Құрметті студенттер!' };
function backup(tables = {}) { return { version: 1, tables: { sessions: [], drafts: [], meta: [], authorized: [], quota: [], generation_jobs: [], inbox: [], ...tables } }; }
function texts(f) { return f.store.rows("SELECT payload FROM outbox WHERE kind='message' ORDER BY id").map(r => JSON.parse(r.payload).text); }

test('Telegram chunks respect UTF-16 and keep emoji intact', () => {
  const paragraphs = 'Первый абзац. '.repeat(150) + '\n\n' + 'Следующий абзац. '.repeat(150);
  const readable = splitText(paragraphs); assert.equal(readable.join(''), paragraphs); assert.ok(readable[0].endsWith('\n\n'));
  const text = 'а'.repeat(3599) + '🙂'.repeat(4) + 'Қазақша';
  const chunks = splitText(text); assert.equal(chunks.join(''), text); assert.ok(chunks.every(c => c.length <= 3600)); assert.ok(chunks.every(c => !/[\uD800-\uDBFF]$/.test(c)));
});
test('fractional and compound provider delays are rounded up', () => {
  assert.equal(parseDelay('1m2.5s'), 63); assert.equal(parseDelay('250ms'), 1); assert.equal(parseDelay('1.2'), 2); assert.equal(parseDelay('garbage'), 0);
});
test('model context contains facts and no Telegram identifier', () => {
  const messages = messagesFor({ session: { ...ready, chat_id: 998877 }, instruction: 'Сократи' });
  assert.equal(messages.length, 3); assert.match(messages[0].content, /Қазақша/); assert.ok(!JSON.stringify(messages).includes('998877')); assert.equal(messages[1].content, ready.result);
});
test('answer budgets account for format and long translations', () => {
  assert.equal(outputBudget(messagesFor({ session: { ...ready, length: '1' } })), 900);
  assert.equal(outputBudget(messagesFor({ session: { ...ready, format: 'kit' } })), 3000);
  assert.equal(outputBudget(messagesFor({ session: { ...ready, result: 'x'.repeat(6000) }, instruction: 'Translate' })), 3200);
});
test('wizard retains choices through a complete Kazakh brief', () => {
  const f = fixture(); for (const data of ['type:speech', 'language:kk', 'length:1', 'tone:formal']) f.dialogue.accept(button(data));
  f.dialogue.accept(message('OAIU студенттеріне құттықтау'));
  assert.equal(f.store.job(10).session.language, 'kk'); assert.equal(f.store.job(10).session.length, '1'); assert.equal(f.store.job(10).session.tone, 'formal'); assert.equal(texts(f).filter(t => t === 'Мәтін дайындап жатырмын…').length, 1);
});
test('duplicate Telegram delivery changes nothing twice', () => {
  const f = fixture(), u = message('/start'); f.dialogue.accept(u); const count = f.store.counts().outbox;
  assert.equal(f.dialogue.accept(u), false); assert.equal(f.store.counts().outbox, count);
});
test('public bot accepts a new visitor without an invitation', () => {
  const f = fixture(); f.dialogue.accept(message('/start', 999)); assert.equal(f.store.get(999).step, 'type'); assert.ok(texts(f).some(t => t.includes('Не дайындаймыз')));
});
test('optional invitation mode remains available', () => {
  const f = fixture({ BOT_ACCESS_CODE: 'invite' }); f.dialogue.accept(message('/start')); assert.match(texts(f)[0], /шақыру арқылы/);
  f.dialogue.accept(message('/start invite')); assert.ok(f.store.one('SELECT 1 FROM authorized WHERE chat_id=10'));
});
test('draft lookup and history are isolated by owner', () => {
  const f = fixture(); f.store.exec('INSERT INTO drafts(id,chat_id,title,text,context) VALUES (1,20,?,?,?)', 'Чужой', 'Private', '{}');
  f.dialogue.accept(button('history:1')); assert.ok(!texts(f).includes('Private')); f.dialogue.accept(message('/history')); assert.match(texts(f).at(-1), /Әзірге нобай жоқ/);
});
test('finished drafts keep ten versions per user and preserve other users', () => {
  const f = fixture();
  for (let i = 0; i < 12; i++) { f.store.saveJob(10, { id: String(i), session: ready }); f.store.finish(10, String(i), ready, `Text ${i}`); }
  f.store.saveJob(20, { id: 'other', session: ready }); f.store.finish(20, 'other', ready, 'Other');
  assert.equal(f.store.one('SELECT COUNT(*) AS n FROM drafts WHERE chat_id=10').n, 10); assert.equal(f.store.one('SELECT COUNT(*) AS n FROM drafts WHERE chat_id=20').n, 1);
});
test('restored draft uses its original event context', () => {
  const f = fixture(); f.store.exec('INSERT INTO drafts(id,chat_id,title,text,context) VALUES (1,10,?,?,?)', 'First', 'Original', JSON.stringify({ brief: 'First event', language: 'en' }));
  f.store.put(10, { ...ready, brief: 'Unrelated event' }); f.dialogue.accept(button('history:1'));
  assert.equal(f.store.get(10).brief, 'First event'); assert.equal(f.store.get(10).language, 'en');
});
test('a direct Russian brief starts a Kazakh speech by default', () => {
  const f = fixture(); f.dialogue.accept(message('Текст для открытия конференции'));
  assert.equal(f.store.job(10).session.format, 'speech'); assert.equal(f.store.job(10).session.language, 'kk'); assert.match(messagesFor(f.store.job(10))[0].content, /Язык: Қазақша/); assert.equal(texts(f).at(-1), 'Мәтін дайындап жатырмын…');
});
test('editing buttons and translations preserve the original text', () => {
  for (const data of ['edit:short', 'edit:formal', 'edit:thanks', 'edit:simple', 'translate:kk', 'translate:ru', 'translate:en']) {
    const f = fixture(); f.store.put(10, ready); f.dialogue.accept(button(data)); const job = f.store.job(10);
    assert.equal(job.session.result, ready.result); assert.ok(job.instruction); if (data.startsWith('translate:')) assert.equal(job.session.language, data.split(':')[1]);
  }
});
test('free-form edits apply to a ready document', () => {
  const f = fixture(); f.store.put(10, ready); f.dialogue.accept(message('Добавь благодарность организаторам'));
  assert.equal(f.store.job(10).instruction, 'Добавь благодарность организаторам');
});
test('TXT delivery sends a named UTF-8 file with BOM', async () => {
  const f = fixture(); f.store.put(10, ready); f.dialogue.accept(button('export:txt')); await f.bot.flushOutbox();
  const form = f.sent.find(s => s.method === 'sendDocument').payload; const file = form.get('document');
  assert.equal(file.name, 'OAIU-text.txt'); assert.deepEqual([...new Uint8Array(await file.arrayBuffer()).slice(0, 3)], [239, 187, 191]);
});
test('cancel invalidates an in-flight result', () => {
  const f = fixture(); f.dialogue.accept(message('Задание')); const job = f.store.job(10); f.dialogue.accept(message('/cancel'));
  assert.equal(f.store.finish(10, job.id, job.session, 'Stale answer'), false); assert.equal(f.store.counts().drafts, 0);
});
test('stored jobs survive object eviction and a fresh constructor', async () => {
  const f = fixture(); f.dialogue.accept(message('Сохрани задачу'));
  const fresh = new OaiuBot(f.ctx, f.bot.env); fresh.telegram = f.bot.telegram; fresh.generate = async () => 'Восстановленный текст';
  await fresh.alarm(); assert.equal(f.store.get(10).result, 'Восстановленный текст'); assert.equal(f.store.counts().generation_jobs, 0);
});
test('a completed job creates its draft exactly once', () => {
  const f = fixture(); f.dialogue.accept(message('Текст')); const job = f.store.job(10);
  assert.equal(f.store.finish(10, job.id, job.session, 'Done'), true); assert.equal(f.store.finish(10, job.id, job.session, 'Again'), false); assert.equal(f.store.counts().drafts, 1);
});
test('Groq rate limit waits silently and retains the task', async () => {
  const f = fixture(); f.dialogue.accept(message('Текст')); f.bot.generate = async () => { throw new ServiceError('Groq', 429, 60); };
  await f.bot.alarm(); assert.ok(f.store.job(10)); assert.ok(f.alarm() >= Date.now() + 59000);
  assert.equal(f.sent.filter(s => s.payload?.text).length, 1); assert.equal(f.sent[0].payload.text, 'Мәтін дайындап жатырмын…');
});
test('quotas enforce personal and shared request budgets', () => {
  const f = fixture(), now = Date.now(); for (let i = 0; i < 4; i++) assert.equal(f.store.reserve(10, now), 0);
  assert.ok(f.store.reserve(10, now) > now); for (let i = 0; i < 16; i++) assert.equal(f.store.reserve(100 + i, now), 0);
  assert.ok(f.store.reserve(999, now) > now); assert.equal(f.store.reserve(10, now + 62000), 0);
});
test('webhook is fail-closed without the correct secret', async () => {
  let calls = 0; const env = { TELEGRAM_BOT_TOKEN: 'token', TELEGRAM_WEBHOOK_SECRET: 'secret', BOT: { idFromName: () => 'id', get: () => ({ fetch: () => { calls++; return new Response('ok'); } }) } };
  for (const token of ['', 'wrong']) assert.equal((await worker.fetch(new Request('https://bot/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': token }, body: '{}' }), env)).status, 403);
  assert.equal(calls, 0); assert.equal((await worker.fetch(new Request('https://bot/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' }, body: '{}' }), env)).status, 200);
});
test('migration endpoint cannot be used without a configured secret', async () => {
  for (const env of [{}, { MIGRATION_TOKEN: 'secret' }]) assert.equal((await worker.fetch(new Request('https://bot/admin/status', { headers: { Authorization: 'Bearer wrong' } }), env)).status, 403);
  assert.equal(secretEqual('', ''), false); assert.equal(secretEqual('a', 'a'), true); assert.equal(secretEqual('a', 'ab'), false);
});
test('oversized and malformed request bodies are rejected', async () => {
  await assert.rejects(readJson(new Request('https://bot', { method: 'POST', body: 'x'.repeat(20) }), 10), RangeError);
  const f = fixture(); assert.equal((await f.bot.fetch(new Request('https://bot/telegram', { method: 'POST', body: '{' }))).status, 400);
});
test('import preserves history, sessions and queued results once', () => {
  const f = fixture(), job = { id: 'old-job', session: ready, result: 'Saved result', notice_sent: true };
  const data = backup({ sessions: [[10, JSON.stringify(ready)]], drafts: [[1, 10, 'Old', ready.result, '2026-10-23 00:00:00', '{}']], generation_jobs: [[10, JSON.stringify(job)]] });
  f.bot.importData(data); assert.equal(f.store.get(10).result, ready.result); assert.equal(f.store.counts().drafts, 1); assert.ok(texts(f).includes('Saved result'));
  assert.throws(() => f.bot.importData(data)); assert.equal(f.store.counts().drafts, 1);
});
test('invalid import rolls back all rows and allows a corrected retry', () => {
  const f = fixture(); assert.throws(() => f.bot.importData(backup({ sessions: [[10, '{']] })));
  assert.equal(f.store.counts().sessions, 0); assert.equal(f.store.meta('cloudflare_imported'), null); f.bot.importData(backup());
  assert.ok(f.store.meta('cloudflare_imported'));
});
test('import refuses to overwrite a running bot', () => {
  const f = fixture(); f.dialogue.accept(message('/start')); assert.throws(() => f.bot.importData(backup())); assert.equal(f.store.get(10).step, 'type');
});
test('pending Python inbox is replayed after import', async () => {
  const f = fixture(), u = message('/start'); f.bot.importData(backup({ inbox: [[u.update_id, JSON.stringify(u)]] }));
  await f.bot.alarm(); assert.equal(f.store.get(10).step, 'type'); assert.equal(f.store.one('SELECT COUNT(*) AS n FROM inbox').n, 0); assert.equal(f.dialogue.accept(u), false);
});
test('expired Telegram callbacks do not retry forever', async () => {
  const f = fixture(); f.dialogue.accept(button('edit:custom')); f.bot.telegram = async () => { throw new ServiceError('Telegram', 400); };
  await f.bot.flushOutbox(); assert.equal(f.store.rows("SELECT * FROM outbox WHERE kind='callback'").length, 0);
});
test('Telegram delivery failures preserve completed text until accepted', async () => {
  const f = fixture(); f.dialogue.accept(message('Текст')); await f.bot.flushOutbox(); const job = f.store.job(10); f.store.finish(10, job.id, job.session, 'Saved answer');
  const original = f.bot.telegram; f.bot.telegram = async () => { throw new ServiceError('Telegram', 429, 30); }; await f.bot.flushOutbox();
  assert.equal(f.store.job(10).result, 'Saved answer'); assert.equal(f.store.counts().drafts, 1);
  f.store.exec('UPDATE outbox SET due=0'); f.bot.telegram = original; await f.bot.flushOutbox(); assert.equal(f.store.job(10), null); assert.ok(f.sent.some(s => s.payload.text === 'Saved answer'));
});
test('outbox preserves per-chat order without blocking other users', async () => {
  const f = fixture(); f.store.send(10, 'First'); f.store.send(10, 'Second'); f.store.send(20, 'Other');
  f.store.exec('UPDATE outbox SET due=? WHERE id=(SELECT MIN(id) FROM outbox)', Date.now() + 60000); await f.bot.flushOutbox();
  assert.deepEqual(f.sent.map(s => s.payload.text), ['Other']);
});
test('a shared provider pause prevents extra AI requests', async () => {
  const f = fixture(); f.dialogue.accept(message('Текст')); f.store.setMeta('groq_pause', { until: Date.now() / 1000 + 3600 });
  let calls = 0; f.bot.generate = async () => { calls++; return 'Text'; }; await f.bot.alarm(); assert.equal(calls, 0); assert.ok(f.store.job(10));
});
test('cancel stays responsive while generation is awaiting the network', async () => {
  const f = fixture(); f.dialogue.accept(message('Текст')); let release, started;
  const entered = new Promise(resolve => { started = resolve; }); f.bot.generate = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const running = f.bot.alarm(); await entered; f.dialogue.accept(message('/cancel')); release('Stale'); await running;
  assert.equal(f.store.counts().drafts, 0); assert.ok(!f.sent.some(s => s.payload.text === 'Stale'));
});
test('transient Groq errors retry in the background', async () => {
  const f = fixture(); f.dialogue.accept(message('Текст')); f.bot.generate = async () => { throw new ServiceError('Groq', 503); }; await f.bot.alarm();
  assert.equal(f.store.job(10).failures, 1); assert.ok(f.store.job(10).next_at > Date.now()); assert.equal(f.sent.filter(s => s.payload.text).length, 1);
});
test('bad provider credentials preserve the brief for manual retry', async () => {
  const f = fixture(); f.dialogue.accept(message('Описание')); f.bot.generate = async () => { throw new ServiceError('Groq', 401); }; await f.bot.alarm();
  assert.equal(f.store.job(10), null); assert.equal(f.store.get(10).brief, 'Описание'); assert.ok(f.sent.some(s => /API кілтін/.test(s.payload.text)));
});
test('webhook acknowledges durable acceptance before slow delivery finishes', async () => {
  const f = fixture(); let release; f.bot.telegram = () => new Promise(resolve => { release = resolve; });
  const response = await f.bot.fetch(new Request('https://bot/telegram', { method: 'POST', body: JSON.stringify(message('/start')) }));
  assert.equal(response.status, 200); assert.ok(f.alarm()); assert.ok(f.store.counts().outbox); release({}); await Promise.all(f.background);
});
test('delete removes only the requesting users records after confirmation', () => {
  const f = fixture(); f.store.put(10, ready); f.store.put(20, ready); f.dialogue.accept(message('/delete'));
  assert.equal(f.store.get(10).result, ready.result); f.dialogue.accept(button('delete:confirm'));
  assert.equal(f.store.get(10).step, 'type'); assert.equal(f.store.get(20).result, ready.result);
});
test('health response contains no credentials or user records', async () => {
  const response = await worker.fetch(new Request('https://bot/health'), { TELEGRAM_BOT_TOKEN: 'top-secret' });
  assert.equal(response.status, 200); assert.ok(!(await response.text()).includes('top-secret'));
});

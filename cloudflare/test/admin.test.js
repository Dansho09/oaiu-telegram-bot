import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { PUBLIC_COMMANDS } from '../src/admin.js';
import { catalog, detectPeople, selectedPeople, snapshotPeople } from '../src/directory.js';
import { scriptSchema, renderStructuredScenario, timeline } from '../src/scenario.js';
import { ServiceError } from '../src/worker.js';
let sequence = 300000;
const send = (text, id = 70, username = 'owner_test') => ({ update_id: sequence++, message: { chat: { id, type: 'private' }, from: { id, username, is_bot: false }, text } });
const tap = (data, id = 70, username = 'owner_test') => ({ update_id: sequence++, callback_query: { id: String(sequence), from: { id, username }, data, message: { chat: { id, type: 'private' }, from: { id: 999, is_bot: true } } } });
const configured = () => fixture({ BOT_OWNER_USERNAME: 'owner_test' });
const messages = f => f.store.rows("SELECT payload FROM outbox WHERE kind='message'").map(r => JSON.parse(r.payload));
const script = { format: 'script', language: 'kk', event_preset: 'volleyball', event_minutes: 120, event_start: 840, host_count: 2, stage_key: 'right_left', people: ['rector'] };
const blocks = s => ({ blocks: timeline(s).map((_, index) => ({ index, lines: Object.fromEntries(Array.from({ length: s.host_count }, (_, n) => [`host_${n + 1}`, 'Құрметті қонақтар, қош келдіңіздер!'])) })) });

test('only the designated Telegram sender can claim ownership', () => {
  const f = configured(); f.dialogue.accept(send('/admin', 71, 'another')); assert.equal(f.store.meta('admin_owner_id'), null);
  f.dialogue.accept(send('@owner_test /admin', 71, 'another')); assert.equal(f.store.meta('admin_owner_id'), null);
  f.dialogue.accept(send('/admin')); assert.equal(f.store.meta('admin_owner_id'), 70);
  const ownerCommands = f.store.one("SELECT payload FROM outbox WHERE kind='commands'");
  assert.equal(JSON.parse(ownerCommands.payload).scope.chat_id, 70); assert.ok(!PUBLIC_COMMANDS.some(c => c.command === 'admin'));
});
test('ownership fails closed without sender metadata or configured username', () => {
  const f = configured(); f.dialogue.accept({ update_id: sequence++, message: { text: '/admin', chat: { id: 70, type: 'private' } } }); assert.equal(f.store.meta('admin_owner_id'), null);
  const g = fixture(); g.dialogue.accept(send('/admin')); assert.equal(g.store.meta('admin_owner_id'), null);
});
test('pinned owner ID survives username changes and rejects username reuse', () => {
  const f = configured(); f.dialogue.accept(send('/admin')); f.store.exec('DELETE FROM outbox');
  f.dialogue.accept(send('/admin', 71)); assert.match(messages(f).at(-1).text, /недоступна/);
  f.dialogue.accept(send('/admin', 70, 'changed')); assert.match(messages(f).at(-1).text, /Админ-панель/);
});
test('callback ownership uses the human sender rather than the bot message author', () => {
  const f = configured(); f.dialogue.accept(send('/admin')); f.dialogue.accept(tap('admin:stats')); assert.match(messages(f).at(-1).text, /Сессии:/);
  f.dialogue.accept(tap('admin:stats', 71)); assert.match(messages(f).at(-1).text, /недоступна/);
  assert.ok(!messages(f).at(-1).text.includes('Сессии:'));
});
test('public menu hides admin controls and owner menu shows them after claim', () => {
  const f = configured(); f.dialogue.accept(send('/start', 71, 'visitor'));
  assert.ok(!JSON.stringify(messages(f).at(-1)).includes('admin:'));
  f.dialogue.accept(send('/admin')); f.dialogue.accept(send('/start'));
  assert.ok(JSON.stringify(messages(f).at(-1)).includes('admin:open'));
});
test('admin can edit the shared directory without rewriting an old draft snapshot', () => {
  const f = configured(), old = snapshotPeople({ people: ['rector'] }, f.store);
  f.dialogue.accept(send('/admin')); f.dialogue.accept(tap('admin:person:rector')); f.dialogue.accept(send('Тест Новый Ректор; Ректор OAIU'));
  assert.equal(catalog(f.store)[0].name, 'Тест Новый Ректор'); assert.equal(catalog(f.store)[0].degree, '');
  assert.equal(selectedPeople(snapshotPeople(old, f.store))[0].name, 'Ажидинов Акмалдин Сапардинович');
  assert.equal(selectedPeople(snapshotPeople({ people: ['rector'] }, f.store))[0].name, 'Тест Новый Ректор');
  assert.deepEqual(detectPeople('Слово Ажидинову', f.store), []);
  f.dialogue.accept(tap('admin:undo')); assert.equal(catalog(f.store)[0].name, 'Ажидинов Акмалдин Сапардинович');
});
test('non-owner cannot mutate global entries even with a forged admin session', () => {
  const f = configured(); f.store.put(71, { step: 'admin_edit', admin_person: 'rector' }); f.dialogue.accept(send('Подмена Имя; Ректор', 71, 'visitor'));
  assert.equal(catalog(f.store)[0].name, 'Ажидинов Акмалдин Сапардинович');
});
test('admin added profiles are selectable by ordinary users and can be undone', () => {
  const f = configured(); f.dialogue.accept(send('/admin')); f.dialogue.accept(tap('admin:group:deans')); f.dialogue.accept(send('Тест Аты Жөні; Декан тестового факультета'));
  const added = catalog(f.store).at(-1); assert.match(added.id, /^extra_/);
  f.dialogue.accept(tap(`person:${added.id}`, 71, 'visitor')); f.dialogue.accept(tap('staff:done', 71, 'visitor')); f.dialogue.accept(send('Поздравление', 71, 'visitor'));
  assert.equal(selectedPeople(f.store.job(71).session)[0].name, 'Тест Аты Жөні');
  f.dialogue.accept(tap('admin:undo')); assert.equal(catalog(f.store).length, 13);
});
test('admin rejects contact details and handles punctuation in a name safely', () => {
  const f = configured(); f.dialogue.accept(send('/admin')); f.dialogue.accept(tap('admin:person:rector'));
  f.dialogue.accept(send('Тест Имя; Ректор +77771234567')); assert.equal(catalog(f.store)[0].name, 'Ажидинов Акмалдин Сапардинович');
  f.dialogue.accept(send('Тест(ов) Имя; Ректор')); assert.doesNotThrow(() => detectPeople('Тест(ов)', f.store));
});
test('owner commands use setMyCommands with a private chat scope', async () => {
  const f = configured(); f.dialogue.accept(send('/admin')); await f.bot.flushOutbox();
  assert.equal(f.sent[0].method, 'setMyCommands'); assert.deepEqual(f.sent[0].payload.scope, { type: 'chat', chat_id: 70 });
});
test('structured script renders exact times, localized roles, stage routes and selected FIO', () => {
  const generated = blocks(script); generated.blocks[7].lines.host_2 = 'Жеңімпаздарға медальдер мен кубоктар табыстайды.';
  const result = renderStructuredScenario(script, generated);
  assert.ok(!result.includes('медальдер')); assert.match(result, /келісілген марапаттарды/);
  assert.match(result, /120 минут/); assert.match(result, /14:00/); assert.match(result, /16:00/);
  assert.match(result, /Жүргізуші 2:/); assert.ok(!result.includes('Ведущий')); assert.match(result, /Ажидинов Акмалдин Сапардинұлы/);
  assert.match(result, /оң жақ/); assert.match(result, /сол жақ/); assert.match(result, /Б ЖОСПАРЫ/);
  const schema = scriptSchema(script).json_schema.schema; assert.equal(schema.properties.blocks.minItems, timeline(script).length);
});
test('structured renderer rejects duplicate blocks, missing hosts and partial JSON', () => {
  const data = blocks(script); data.blocks[1].index = 0; assert.throws(() => renderStructuredScenario(script, data));
  const other = blocks(script); delete other.blocks[0].lines.host_2; assert.throws(() => renderStructuredScenario(script, other));
  assert.throws(() => renderStructuredScenario(script, { blocks: [] }));
});
test('oversized provider request is a permanent configuration error without a silent retry loop', async () => {
  const f = configured(), original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: { message: 'Request too large for output tokens per minute' } }, { status: 429 });
  try { await assert.rejects(f.bot.generate({ session: { format: 'speech', brief: 'Приветствие' } }), e => e instanceof ServiceError && e.status === 413); } finally { globalThis.fetch = original; }
});

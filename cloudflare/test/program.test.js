import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { programBlocks, timeline, withProgramDuration, validProgram, scenarioChange, scenarioPrompt, renderStructuredScenario, structuredScenarioData } from '../src/scenario.js';

let sequence = 700000;
const base = { step: 'event_settings', format: 'script', language: 'ru', event_preset: 'general', event_minutes: 60, host_count: 2, stage_key: 'right_left', brief: 'Встреча студентов' };
const msg = text => ({ update_id: sequence++, message: { chat: { id: 80, type: 'private' }, from: { id: 80 }, text } });
const tap = data => ({ update_id: sequence++, callback_query: { id: String(sequence), data, from: { id: 80 }, message: { chat: { id: 80, type: 'private' } } } });
const click = (f, action, id = '') => f.dialogue.accept(tap(`program:${action}:${f.store.get(80).program_revision}${id ? ':' + id : ''}`));
const init = (session = base) => { const f = fixture(); f.store.put(80, session); f.dialogue.accept(tap('program:open')); return f; };
const texts = f => f.store.rows("SELECT payload FROM outbox WHERE kind='message' ORDER BY id").map(row => JSON.parse(row.payload));
const blocks = (count, minutes = 5) => Array.from({ length: count }, (_, i) => ({ id: `b${i}`, titles: [`Блок ${i}`, `Бөлім ${i}`, `Segment ${i}`], minutes }));

test('constructor materializes current preset timing without changing its total or localized titles', () => {
  for (const language of ['ru', 'kk', 'en']) {
    const f = init({ ...base, language }); const s = f.store.get(80);
    assert.ok(validProgram(s.program_blocks)); assert.equal(s.event_minutes, 60);
    assert.deepEqual(timeline(s), timeline({ ...base, language }));
    assert.equal(s.program_before.blocks, null);
    assert.ok(texts(f).at(-1).reply_markup.inline_keyboard.flat().some(b => b.callback_data.includes(':add:')));
  }
});
test('add, rename, move, time and remove operate on stable block IDs and exact totals', () => {
  const f = init(); click(f, 'add'); click(f, 'custom'); f.dialogue.accept(msg('Танец студентов; 7'));
  let s = f.store.get(80); const added = s.program_blocks.at(-1).id;
  assert.equal(s.event_minutes, 67); assert.equal(s.program_blocks.at(-1).titles[0], 'Танец студентов');
  click(f, 'view', added); click(f, 'up', added);
  s = f.store.get(80); assert.equal(s.program_blocks.at(-2).id, added);
  click(f, 'view', added); click(f, 'rename', added); f.dialogue.accept(msg('Студенческий вальс'));
  click(f, 'view', added); click(f, 'time', added); f.dialogue.accept(msg('10'));
  s = f.store.get(80); assert.equal(s.event_minutes, 70); assert.equal(s.program_blocks.find(b => b.id === added).titles[0], 'Студенческий вальс');
  click(f, 'view', added); click(f, 'remove', added); s = f.store.get(80);
  assert.equal(s.event_minutes, 60); assert.ok(!s.program_blocks.some(b => b.id === added));
  click(f, 'done'); assert.equal(f.store.get(80).step, 'event_settings'); assert.equal(f.store.get(80).program_revision, undefined);
});
test('stale callback cannot mutate after a different edit or program exit', () => {
  const f = init(); const first = f.store.get(80).program_blocks[0].id;
  click(f, 'view', first); const stale = `program:remove:${f.store.get(80).program_revision}:${first}`;
  click(f, 'down', first); const after = f.store.get(80).program_blocks;
  f.dialogue.accept(tap(stale)); assert.deepEqual(f.store.get(80).program_blocks, after);
  const staleDone = `program:done:${f.store.get(80).program_revision}`;
  click(f, 'done'); f.dialogue.accept(tap(staleDone)); assert.equal(f.store.get(80).step, 'event_settings');
  assert.match(texts(f).at(-1).text, /ескірді/);
});
test('constructor bounds reject empty, undersized, oversized and too many blocks without data loss', () => {
  const one = init({ ...base, event_minutes: 15, program_blocks: blocks(1, 15) });
  click(one, 'view', 'b0'); click(one, 'remove', 'b0'); assert.equal(one.store.get(80).program_blocks.length, 1);
  click(one, 'time', 'b0'); one.dialogue.accept(msg('14')); assert.equal(one.store.get(80).event_minutes, 15);
  one.dialogue.accept(msg('481')); assert.equal(one.store.get(80).event_minutes, 15);
  const full = init({ ...base, event_minutes: 80, program_blocks: blocks(16) }); click(full, 'add'); assert.equal(full.store.get(80).step, 'program_list');
  const long = init({ ...base, event_minutes: 480, program_blocks: blocks(1, 480) }); click(long, 'add'); click(long, 'pick', 'dance'); assert.equal(long.store.get(80).event_minutes, 480);
  assert.ok(!validProgram(blocks(17))); assert.ok(!validProgram([{ id: 'a', titles: ['x', 'x', 'x'], minutes: 0 }]));
});
test('custom title validation and ordinary text cannot bypass program bounds', () => {
  const f = init(); click(f, 'add'); click(f, 'custom');
  for (const text of ['; 5', 'X\nY; 5', 'X; -1', 'X; 1.5', 'X'.repeat(101) + '; 5']) f.dialogue.accept(msg(text));
  assert.equal(f.store.get(80).program_blocks.length, 8); assert.equal(f.store.get(80).event_minutes, 60);
  f.dialogue.accept(msg('Назад')); assert.equal(f.store.get(80).step, 'program_list');
});
test('discard restores pre-constructor program, timing and selected sample while keeping the saved draft', () => {
  const f = init({ ...base, result: 'Saved text', program_blocks: blocks(3, 20), sample_id: 'old', sample_title: 'Old' });
  click(f, 'add'); click(f, 'pick', 'dance'); click(f, 'cancel');
  const s = f.store.get(80); assert.equal(s.event_minutes, 60); assert.deepEqual(s.program_blocks, blocks(3, 20));
  assert.equal(s.result, 'Saved text'); assert.equal(s.sample_id, 'old'); assert.equal(s.script_editing, true); assert.equal(s.step, 'event_settings');
  const fresh = init(); click(fresh, 'add'); click(fresh, 'pick', 'dance'); click(fresh, 'cancel'); assert.equal(fresh.store.get(80).program_blocks, undefined);
});
test('global duration and language edits preserve custom block identities and exact ordered timelines', () => {
  const initial = { ...base, program_blocks: blocks(3, 20) };
  for (let total = 15; total <= 480; total++) {
    const s = withProgramDuration(initial, total), rows = timeline(s);
    assert.equal(s.event_minutes, total); assert.equal(rows.at(-1).end, total);
    assert.deepEqual(s.program_blocks.map(b => b.id), ['b0', 'b1', 'b2']);
    rows.forEach((r, i) => { assert.ok(r.minutes > 0); if (i) assert.equal(r.start, rows[i - 1].end); });
  }
  assert.equal(withProgramDuration({ ...initial, program_blocks: blocks(16) }, 15), null);
  const uneven = { ...initial, program_blocks: [{ id: 'short', titles: ['x', 'x', 'x'], minutes: 1 }, { id: 'long', titles: ['y', 'y', 'y'], minutes: 59 }] };
  assert.deepEqual(withProgramDuration(uneven, 60).program_blocks.map(b => b.minutes), [1, 59]);
  const changed = scenarioChange(initial, 'Сделай длительность 90 минут'); assert.equal(timeline(changed).at(-1).end, 90);
  assert.equal(timeline({ ...changed, language: 'kk' })[0].title, 'Бөлім 0');
  assert.match(scenarioPrompt(changed), /не возвращай удалённые блоки/);
});
test('approved owner sample becomes ordered program and cancel restores previous preset', () => {
  const f = init(); f.store.setMeta('approved_samples', [{ id: 'sample1', title: 'День учителя', preset: 'teachers', blocks: [{ key: 'opening', title: ['Открытие', 'Ашылу', 'Opening'] }, { key: 'dance', title: ['Танец', 'Би', 'Dance'] }] }]);
  click(f, 'samples'); click(f, 'use', 'sample1'); let s = f.store.get(80);
  assert.equal(s.program_blocks.length, 2); assert.equal(s.event_minutes, 60); assert.equal(s.sample_id, 'sample1'); assert.equal(s.event_preset, 'teachers');
  assert.deepEqual(timeline(s).map(r => r.minutes), [30, 30]); click(f, 'cancel'); s = f.store.get(80);
  assert.equal(s.sample_id, undefined); assert.equal(s.event_preset, 'general');
});
test('spoken snapshots contain final guarded roles and separate stage notes', () => {
  const session = { ...base, event_preset: 'volleyball', event_minutes: 120, people: ['rector'] };
  const raw = { blocks: timeline(session).map((row, index) => ({ index, lines: { host_1: /Награждение/.test(row.title) ? 'Вручаем кубки победителям!' : 'Добро пожаловать!', host_2: 'Спасибо!' } })) };
  const text = renderStructuredScenario(session, raw), snapshot = session.script_data;
  assert.equal(snapshot.version, 1); assert.equal(snapshot.blocks.length, timeline(session).length);
  const welcome = snapshot.blocks.find(b => /Приветственное/.test(b.title));
  assert.match(welcome.lines.host_1, /Ажидинов/); assert.ok(!welcome.lines.host_1.startsWith('Ведущий')); assert.ok(welcome.notes.length);
  const awards = snapshot.blocks.find(b => /Награждение/.test(b.title)); assert.ok(!awards.lines.host_1.includes('кубки')); assert.match(awards.lines.host_1, /согласованные награды/);
  assert.ok(snapshot.blocks.every(b => b.cue && Number.isInteger(b.start) && Number.isInteger(b.end)));
  assert.deepEqual(structuredScenarioData(session, raw), snapshot); assert.ok(text.includes(snapshot.blocks[0].lines.host_1));
});
test('callbacks stay below Telegram limit and program is unavailable for normal speeches', () => {
  const f = init(); click(f, 'add'); click(f, 'pick', 'dance');
  for (const message of texts(f)) for (const button of message.reply_markup?.inline_keyboard.flat() || []) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
  const speech = init({ ...base, format: 'speech' }); assert.equal(speech.store.get(80).program_blocks, undefined);
});

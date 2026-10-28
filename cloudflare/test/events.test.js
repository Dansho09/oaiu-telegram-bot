import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { PEOPLE, detectPeople, selectedPeople, peopleFacts } from '../src/directory.js';
import { parseDuration, parseStart, PRESETS, timeline, timelineText, scenarioPrompt, scenarioBody, renderScenario, scenarioChange } from '../src/scenario.js';
import { messagesFor, resultButtons, outputBudget } from '../src/core.js';

let id = 100000;
const message = (text, chat = 50) => ({ update_id: id++, message: { chat: { id: chat, type: 'private' }, text } });
const click = (data, chat = 50) => ({ update_id: id++, callback_query: { id: `event-${id}`, data, message: { chat: { id: chat, type: 'private' } } } });
const ready = { step: 'ready', format: 'speech', language: 'kk', length: '3', tone: 'formal', brief: 'Құттықтау', result: 'Алдыңғы мәтін' };
const script = { ...ready, format: 'script', event_preset: 'volleyball', event_minutes: 120, host_count: 2, stage_key: 'right_left', event_start: 14 * 60 };
const texts = f => f.store.rows("SELECT payload FROM outbox WHERE kind='message' ORDER BY id").map(r => JSON.parse(r.payload).text);

test('directory has exactly the supplied two deans and eight heads, plus verified leadership', () => {
  assert.equal(PEOPLE.length, 13); assert.equal(new Set(PEOPLE.map(p => p.id)).size, 13);
  assert.equal(PEOPLE.filter(p => p.group === 'deans').length, 2); assert.equal(PEOPLE.filter(p => p.group === 'departments').length, 8);
  assert.equal(PEOPLE[0].name, 'Ажидинов Акмалдин Сапардинович'); assert.equal(PEOPLE.find(p => p.id === 'dept_math').name, 'Кошкинбаева Мадина Жолдыкараевна');
  assert.ok(PEOPLE.every(p => !/\d{7}|@/.test(p.name + p.role)));
});
test('rector is resolved by role without confusing a vice-rector', () => {
  assert.deepEqual(detectPeople('Позови ректора для приветствия'), ['rector']);
  assert.deepEqual(detectPeople('Слово проректору Дуйсенову'), ['vice_academic']);
  assert.deepEqual(detectPeople('Бүгін ректорсыз өткіземіз'), []);
});
test('known department resolves its head from the supplied list', () => {
  assert.deepEqual(detectPeople('Меңгеруші: информатика кафедрасы'), ['dept_math']);
  assert.deepEqual(detectPeople('Заведующая кафедрой экологии'), ['dept_chemistry']);
});
test('leadership order puts the rector before departments regardless of click order', () => {
  const names = selectedPeople({ people: ['dept_law', 'dean_science', 'rector'] }).map(p => p.id);
  assert.deepEqual(names, ['rector', 'dean_science', 'dept_law']);
});
test('directory selection works for every writing format', () => {
  for (const format of ['speech', 'script', 'announcement', 'post', 'thanks', 'kit']) {
    const f = fixture(); f.store.put(50, { step: 'brief', format, language: 'kk' });
    f.dialogue.accept(click('staff:open')); f.dialogue.accept(click('person:rector')); f.dialogue.accept(click('staff:done')); f.dialogue.accept(message('Университет іс-шарасы'));
    assert.ok(peopleFacts(f.store.job(50).session).includes('Ажидинов Акмалдин Сапардинұлы'));
  }
});
test('typing rector alone opens the directory instead of generating a speech', () => {
  const f = fixture(); f.dialogue.accept(message('Ректор кім?'));
  assert.equal(f.store.job(50), null); assert.ok(texts(f).some(text => text.includes('Ажидинов')));
});
test('an ambiguous dean pauses generation until the user chooses', () => {
  const f = fixture(); f.dialogue.accept(message('Речь: выступает декан на открытии'));
  assert.equal(f.store.job(50), null); assert.ok(texts(f).some(text => text.includes('Ризаходжаев') && text.includes('Сыдыкова')));
  f.dialogue.accept(click('person:dean_languages')); f.dialogue.accept(click('staff:done'));
  const job = f.store.job(50); assert.ok(job); assert.match(peopleFacts(job.session), /Сыдыкова Зухра Ештаевна/); assert.ok(!peopleFacts(job.session).includes('Ризаходжаев'));
});
test('an unselected department head is requested rather than invented', () => {
  const f = fixture(); f.dialogue.accept(message('Пригласи заведующего кафедрой на открытие'));
  assert.equal(f.store.job(50), null); assert.ok(texts(f).some(text => text.includes('Кошкинбаева')));
  f.dialogue.accept(click('staff:none')); assert.ok(f.store.job(50)); assert.equal(peopleFacts(f.store.job(50).session), '');
});
test('custom people stay in one users session and never enter the shared directory', () => {
  const f = fixture(); f.store.put(50, { step: 'brief', format: 'speech' }); f.dialogue.accept(click('staff:open')); f.dialogue.accept(click('staff:custom')); f.dialogue.accept(message('Тест Қатысушы; бас төреші')); f.dialogue.accept(click('staff:done')); f.dialogue.accept(message('Жарыс ашылуы'));
  assert.match(peopleFacts(f.store.job(50).session), /Тест Қатысушы/); assert.equal(peopleFacts(f.store.get(99)), ''); assert.ok(!PEOPLE.some(p => p.name === 'Тест Қатысушы'));
});
test('directory is available while viewing an existing draft and changes it only after apply', () => {
  const f = fixture(); f.store.put(50, ready); f.dialogue.accept(message('/people'));
  assert.equal(f.store.job(50), null); assert.equal(f.store.get(50).result, ready.result);
  f.dialogue.accept(click('person:rector')); f.dialogue.accept(click('staff:done'));
  assert.ok(f.store.job(50)); assert.equal(f.store.job(50).session.result, ready.result);
});
test('six-person limit prevents hidden extra guests', () => {
  const f = fixture(); f.store.put(50, { step: 'brief', people: PEOPLE.slice(0, 6).map(p => p.id) }); f.dialogue.accept(click('person:dept_chemistry'));
  assert.equal(f.store.get(50).people.length, 6); assert.ok(!f.store.get(50).people.includes('dept_chemistry'));
});
test('the chosen person survives selecting the writing format', () => {
  const f = fixture(); f.dialogue.accept(message('/people')); f.dialogue.accept(click('person:rector')); f.dialogue.accept(click('staff:done')); f.dialogue.accept(click('type:thanks'));
  assert.deepEqual(f.store.get(50).people, ['rector']);
});
test('removing a selected rector does not leave him in the factual prompt', () => {
  const f = fixture(); f.store.put(50, { ...ready, people: ['rector'] }); f.dialogue.accept(message('Сделай текст без ректора'));
  assert.deepEqual(f.store.job(50).session.people, []); assert.equal(peopleFacts(f.store.job(50).session), '');
});
test('full volleyball wizard stores duration, clock, hosts, direction and rector', () => {
  const f = fixture();
  for (const data of ['type:script', 'language:kk', 'event:profile:volleyball', 'event:duration:120', 'event:start']) f.dialogue.accept(click(data));
  f.dialogue.accept(message('14:30')); f.dialogue.accept(click('event:hosts:1')); f.dialogue.accept(click('event:stage:left_right')); f.dialogue.accept(click('event:ready')); f.dialogue.accept(click('tone:formal')); f.dialogue.accept(click('person:rector')); f.dialogue.accept(click('staff:done')); f.dialogue.accept(message('Ертең университетте волейбол жарысы болады.'));
  const job = f.store.job(50); assert.ok(job); assert.equal(job.session.event_minutes, 120); assert.equal(job.session.event_start, 870); assert.equal(job.session.host_count, 1); assert.equal(job.session.stage_key, 'left_right');
  const prompt = messagesFor(job)[0].content; assert.match(prompt, /Акмалдин Сапардинұлы/); assert.match(prompt, /14:30/); assert.match(prompt, /Ведущий 1/); assert.ok(!prompt.includes('Ведущий 2'));
});
test('script duration is a whole event, and has a suitable response budget', () => {
  const f = fixture(); for (const data of ['type:script', 'language:ru']) f.dialogue.accept(click(data)); assert.equal(f.store.get(50).step, 'event_profile');
  const messages = messagesFor({ session: script }); assert.ok(!messages[0].content.includes('Объём: 3 мин')); assert.equal(outputBudget(messages), 3200);
});
test('every duration in the supported range sums exactly for all presets', () => {
  for (const event_preset of Object.keys(PRESETS)) for (let event_minutes = 15; event_minutes <= 480; event_minutes++) {
    const rows = timeline({ event_preset, event_minutes, language: 'kk' });
    assert.equal(rows.reduce((n, r) => n + r.minutes, 0), event_minutes); assert.equal(rows[0].start, 0); assert.equal(rows.at(-1).end, event_minutes);
    rows.forEach((row, i) => { assert.ok(Number.isInteger(row.minutes) && row.minutes >= 1); if (i) assert.equal(rows[i - 1].end, row.start); });
  }
});
test('duration parser understands hours, minutes and HH:MM with safe bounds', () => {
  for (const [text, expected] of [['2 часа', 120], ['1,5 сағат', 90], ['02:30', 150], ['90 минут', 90], ['8 сағат', 480], ['1 час 30 минут', 90]]) assert.equal(parseDuration(text), expected, text);
  for (const text of ['9 часов', '-60', '00:10', '0', 'завтра', '2', '2:99']) assert.equal(parseDuration(text), null, text);
  assert.equal(parseStart('00:00'), 0); assert.equal(parseStart('23:59'), 1439); assert.equal(parseStart('24:00'), null);
});
test('custom duration errors keep the user in the wizard', () => {
  const f = fixture(); f.store.put(50, { step: 'event_duration_custom', format: 'script', language: 'kk' }); f.dialogue.accept(message('24 сағат'));
  assert.equal(f.store.get(50).step, 'event_duration_custom'); assert.equal(f.store.job(50), null); f.dialogue.accept(message('1,5 сағат')); assert.equal(f.store.get(50).event_minutes, 90);
});
test('timing that crosses midnight marks the following day', () => {
  const text = timelineText({ ...script, event_start: 23 * 60 }); assert.match(text, /23:00/); assert.match(text, /01:00 \(\+1\)/);
});
test('host names must match the selected host count', () => {
  const f = fixture(); f.store.put(50, { ...script, step: 'event_names' }); f.dialogue.accept(message('Сабина'));
  assert.equal(f.store.get(50).step, 'event_names'); f.dialogue.accept(message('Сабина; Ернар')); assert.deepEqual(f.store.get(50).host_names, ['Сабина', 'Ернар']);
});
test('custom staging is stored without changing the audience perspective', () => {
  const f = fixture(); f.store.put(50, { ...script, step: 'event_stage_custom' }); f.dialogue.accept(message('Көрерменге қатысты оң жақтан шығып, сол жақтан түседі.'));
  const session = f.store.get(50); assert.equal(session.stage_key, 'custom'); assert.match(scenarioPrompt(session), /оң жақтан/); assert.match(scenarioPrompt(session), /с точки зрения зрителей/);
});
test('sports hall mode does not impose a raised stage or auditorium entrance', () => {
  const text = scenarioPrompt({ ...script, stage_key: 'gym' }); assert.match(text, /Сахнасыз спортзал/); assert.match(text, /Не требуй сцены/); assert.ok(!text.includes('Көрерменге қатысты: оң жақтан'));
});
test('natural language scenario requests can prefill event and duration', () => {
  const f = fixture(); f.dialogue.accept(message('Ертең волейбол жарысы болады, 2 сағаттық сценарий керек.'));
  const session = f.store.get(50); assert.equal(session.format, 'script'); assert.equal(session.language, 'kk'); assert.equal(session.event_minutes, 120); assert.equal(session.event_preset, 'volleyball'); assert.equal(session.step, 'event_settings');
});
test('reconfiguring a draft cancels stale jobs and preserves event facts', () => {
  const f = fixture(); f.store.put(50, script); f.store.saveJob(50, { id: 'stale', session: script, instruction: null });
  f.dialogue.accept(click('event:config')); assert.equal(f.store.job(50), null); f.dialogue.accept(click('event:duration:180')); f.dialogue.accept(click('event:hosts:1')); f.dialogue.accept(click('event:ready'));
  const job = f.store.job(50); assert.equal(job.session.event_minutes, 180); assert.equal(job.session.host_count, 1); assert.equal(job.session.brief, script.brief);
});
test('new timing is considered when deduplicating a queued generation', () => {
  const f = fixture(); f.dialogue.generate(50, script); const first = f.store.job(50).id; f.dialogue.generate(50, { ...script, event_minutes: 180 }); assert.notEqual(f.store.job(50).id, first);
});
test('plain-language edits change the structured timing rather than contradict it', () => {
  assert.equal(scenarioChange(script, 'Сделай на 3 часа').event_minutes, 180); assert.equal(scenarioChange(script, 'Сократи на 30 минут').event_minutes, 90);
  assert.equal(scenarioChange(script, '1 ведущий, начало в 16:00').host_count, 1); assert.equal(scenarioChange(script, '1 ведущий, начало в 16:00').event_start, 960);
  assert.equal(scenarioChange(script, 'Сделай менее официально').event_minutes, 120);
});
test('rendered script has one exact timeline and edit context excludes the old header', () => {
  const result = renderScenario(script, 'Жүргізуші 1: Қош келдіңіздер!');
  assert.equal(result.split('⏱').length - 1, 1); assert.equal(scenarioBody(result), 'Жүргізуші 1: Қош келдіңіздер!');
  assert.equal(renderScenario(script, result), result);
  const messages = messagesFor({ session: { ...script, result }, instruction: 'Қысқарт' }); assert.equal(messages[1].content, 'Жүргізуші 1: Қош келдіңіздер!');
});
test('old drafts retain normal speech controls while scripts get settings', () => {
  assert.ok(!resultButtons(ready).flat().some(b => b.callback_data === 'event:config')); assert.ok(resultButtons(script).flat().some(b => b.callback_data === 'event:config'));
});
test('stale scenario buttons cannot turn a speech into a tournament', () => {
  const f = fixture(); f.store.put(50, ready); f.dialogue.accept(click('event:duration:120')); assert.equal(f.store.get(50).format, 'speech'); assert.equal(f.store.get(50).event_minutes, undefined);
});
test('scenario settings and participants are restored with their own draft', () => {
  const f = fixture(); const context = { ...script, people: ['rector'] }; f.store.saveJob(50, { id: 'save', session: context }); f.store.finish(50, 'save', context, 'Сценарий'); const draft = f.store.one('SELECT id FROM drafts WHERE chat_id=50');
  f.store.put(50, { ...ready, brief: 'Другое событие' }); f.dialogue.accept(click(`history:${draft.id}`)); const restored = f.store.get(50);
  assert.equal(restored.event_minutes, 120); assert.deepEqual(restored.people, ['rector']); assert.equal(restored.brief, script.brief);
});
test('source scenario style does not copy its performers or award recipients', () => {
  const teacher = scenarioPrompt({ ...script, event_preset: 'teachers' }), dedication = scenarioPrompt({ ...script, event_preset: 'dedication' });
  assert.match(teacher, /чередующиеся реплики/); assert.match(dedication, /Ключ знаний/); assert.ok(!teacher.includes('Таукебаева')); assert.ok(!dedication.includes('БАРАБАН-ШОУ ТОБЫНЫҢ АТАУЫ'));
});
test('relative event dates keep their original reference through edits', () => {
  const f = fixture(); f.dialogue.generate(50, { ...script, reference_date: '2026-10-28', brief: 'Ертең жарыс болады' }, 'Сөздерін қысқарт');
  const session = f.store.job(50).session; assert.equal(session.reference_date, '2026-10-28'); assert.match(session.edit_reference_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(messagesFor(f.store.job(50))[0].content, /не сдвигай дату при повторе/);
});
test('callback payloads stay within Telegrams byte limit', () => {
  const f = fixture(); f.store.put(50, script); for (const data of ['staff:open', 'staff:departments', 'event:config', 'event:stage']) f.dialogue.accept(click(data));
  for (const row of f.store.rows('SELECT payload FROM outbox')) {
    const payload = JSON.parse(row.payload); for (const button of payload.reply_markup?.inline_keyboard.flat() || []) assert.ok(new TextEncoder().encode(button.callback_data).length <= 64);
  }
});

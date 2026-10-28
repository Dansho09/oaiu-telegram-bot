import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { scenarioChange, timeline, parseDuration, renderStructuredScenario, updateConfirmedPrizes } from '../src/scenario.js';

const base = { step: 'ready', format: 'script', language: 'kk', event_preset: 'general', event_minutes: 60, host_count: 2, stage_key: 'right_left', brief: 'Ертең акт залында студенттер кездесуі өтеді.', result: 'Алдыңғы сценарий.', program_blocks: [{ id: 'first', titles: ['Открытие', 'Ашылу', 'Opening'], minutes: 20 }, { id: 'awards', titles: ['Награждение', 'Марапаттау', 'Awards'], minutes: 40 }] };

test('duration edits distinguish relative changes from a new total in Russian, Kazakh and English', () => {
  for (const [instruction, expected] of [
    ['Сократи на 10 минут', 50], ['Уменьши на 1 минуту', 59], ['Увеличь на 30 минут', 90], ['Продли на 1 час 30 минут', 150],
    ['Ұзақтығын 15 минутқа ұзарт', 75], ['10 минутқа қысқарт', 50], ['5 минутқа арттыр', 65],
    ['Shorten by 10 minutes', 50], ['Extend by 30 mins', 90], ['Add 5 minutes', 65],
    ['Сократи до 30 минут', 30], ['Сделай длительность 90 минут', 90], ['30 минутқа дейін қысқарт', 30], ['Ұзақтығын 30 минут ет', 30], ['Reduce to 30 minutes', 30], ['Make the duration 90 minutes', 90],
  ]) {
    const changed = scenarioChange(base, instruction), plan = timeline(changed);
    assert.equal(changed.event_minutes, expected, instruction);
    assert.equal(plan.at(-1).end, expected, instruction);
    assert.deepEqual(changed.program_blocks.map(block => block.id), ['first', 'awards']);
    assert.equal(plan[0].end, plan[1].start);
  }
  assert.equal(parseDuration('10 минут'), null, 'wizard still requires an event of at least 15 minutes');
});

test('invalid duration changes leave a valid ordered program untouched', () => {
  for (const instruction of ['Сократи на 46 минут', 'Увеличь на 421 минуту', 'Shorten by 0 minutes', 'Reduce to 10 minutes']) {
    assert.deepEqual(scenarioChange(base, instruction).program_blocks, base.program_blocks, instruction);
    assert.equal(scenarioChange(base, instruction).event_minutes, 60, instruction);
  }
  const many = { ...base, event_minutes: 16, program_blocks: Array.from({ length: 16 }, (_, i) => ({ id: `b${i}`, titles: ['x', 'x', 'x'], minutes: 1 })) };
  assert.equal(scenarioChange(many, 'Сократи на 1 минуту').event_minutes, 16, 'every segment still requires one minute');
});

test('reviewing an ambiguous participant applies a relative duration change only once', () => {
  const f = fixture(), chat = 815;
  f.store.put(chat, base);
  f.dialogue.accept({ update_id: 950000, message: { chat: { id: chat, type: 'private' }, from: { id: chat }, text: 'Увеличь на 30 минут и пригласи декана.' } });
  assert.equal(f.store.job(chat), null);
  assert.equal(f.store.get(chat).directory_mode, 'generate');
  f.dialogue.accept({ update_id: 950001, callback_query: { id: 'dean-review', data: 'staff:none', from: { id: chat }, message: { chat: { id: chat, type: 'private' } } } });
  const job = f.store.job(chat);
  assert.equal(job.session.event_minutes, 90);
  assert.equal(timeline(job.session).at(-1).end, 90);
});

test('an unrelated edit preserves explicitly confirmed prizes, but an explicit removal persists', async () => {
  const f = fixture(), chat = 813;
  f.store.put(chat, base);
  const raw = { blocks: [{ index: 0, lines: { host_1: 'Қош келдіңіздер!', host_2: 'Кешімізді бастаймыз!' } }, { index: 1, lines: { host_1: 'Жеңімпаздарға кубоктарды табыстаймыз!', host_2: 'Қатысушыларды құттықтаймыз!' } }] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }] }));
  let update = 930000;
  const edit = async text => {
    f.dialogue.accept({ update_id: update++, message: { chat: { id: chat, type: 'private' }, from: { id: chat }, text } });
    const job = f.store.job(chat), result = await f.bot.generate(job);
    assert.equal(f.store.finish(chat, job.id, job.session, result), true);
    return f.store.get(chat);
  };
  try {
    assert.match((await edit('Жеңімпаздарға кубоктарды табыстауды қос.')).result, /кубоктарды табыстаймыз/);
    const styled = await edit('Мәтінді салтанатты ет. Фактілерді сақта.');
    assert.match(styled.result, /кубоктарды табыстаймыз/);
    assert.match(styled.result_context.event_fact_evidence.join('\n'), /кубоктарды/);
    let repeated;
    for (let i = 1; i <= 26; i++) repeated = await edit(`Мәтіннің ${i}-нұсқасын табиғи әрі әсерлі ет. Фактілерді сақта.`);
    assert.doesNotMatch(repeated.event_fact_evidence.join('\n'), /кубоктарды/, 'generic correction history is still bounded');
    assert.match(repeated.result, /кубоктарды табыстаймыз/, 'persistent prize facts survive more than 25 unrelated edits');
    assert.equal(repeated.result_context.confirmed_prizes.cups, true, 'history captures persistent facts');
    assert.doesNotMatch((await edit('Кубоктарды алып таста.')).result, /кубоктарды табыстаймыз/);
    for (let i = 1; i <= 26; i++) repeated = await edit(`Мәтіннің ${i}-нұсқасын жылы ет.`);
    assert.doesNotMatch(repeated.result, /кубоктарды табыстаймыз/, 'explicit removal also survives bounded evidence eviction');
    assert.match((await edit('Кубоктарды қайта қос.')).result, /кубоктарды табыстаймыз/);
  } finally { globalThis.fetch = originalFetch; }
});

test('persistent prize facts migrate legacy evidence once and ignore unrelated bounded history afterwards', () => {
  const original = { ...base, event_fact_evidence: ['We will present cups.', 'There will be medals.', 'Remove cups.'] };
  const migrated = updateConfirmedPrizes(original);
  assert.deepEqual(migrated.confirmed_prizes, { version: 1, medals: true, cups: false, trophies: false });
  assert.equal(original.confirmed_prizes, undefined);
  const cropped = { ...migrated, event_fact_evidence: ['We will present cups.'], pending_instruction: 'We will present cups.' };
  assert.equal(updateConfirmedPrizes(cropped, 'Make the language warmer.').confirmed_prizes.cups, false, 'old evidence cannot resurrect an explicitly removed prize');
  assert.equal(updateConfirmedPrizes(cropped, 'Bring back cups.').confirmed_prizes.cups, true);
  const speech = { format: 'speech', brief: 'A speech about cups.' };
  assert.equal(updateConfirmedPrizes(speech, 'Add cups.'), speech);
});

test('confirming medals does not authorize invented cups and an award removal overrides old confirmation', () => {
  const raw = { blocks: [{ index: 0, lines: { host_1: 'Welcome!', host_2: 'Hello!' } }, { index: 1, lines: { host_1: 'We present cups to the winners.', host_2: 'Congratulations!' } }] };
  for (const facts of [['There will be medals.'], ['We will present cups.', 'Remove cups.'], ['We will present cups.', 'No awards.']]) {
    assert.doesNotMatch(renderStructuredScenario({ ...base, language: 'en', event_fact_evidence: facts }, raw), /present cups/);
  }
});

test('scenario settings and constructor guidance stay Kazakh when generated output is English', () => {
  const f = fixture(), chat = 814; let update = 940000;
  f.store.put(chat, { ...base, language: 'en' });
  for (const data of ['event:config', 'event:profiles', 'event:profile:general', 'program:open']) f.dialogue.accept({ update_id: update++, callback_query: { id: `kk-${update}`, data, from: { id: chat }, message: { chat: { id: chat, type: 'private' } } } });
  const messages = f.store.rows("SELECT payload FROM outbox WHERE kind='message'").map(row => JSON.parse(row.payload).text).join('\n');
  assert.match(messages, /Ұзақтығы/);
  assert.match(messages, /Қандай іс-шараға сценарий керек/);
  assert.match(messages, /Бағдарлама құрастыру/);
  assert.doesNotMatch(messages, /Duration|Select a segment|How long|Ведущих|Конструктор программы/);
  assert.equal(f.store.get(chat).language, 'en');
});

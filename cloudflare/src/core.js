import { FORMATS, LANGUAGES, TONES, SYSTEM, RESULT_BUTTONS } from './ui.js';
import { catalog, snapshotPeople, showDirectory, enrichPeople, ambiguousPeople, peopleFacts, directoryQuery } from './directory.js';
import { isScenario, scenarioPrompt, scenarioBody, scenarioChange, mentionedDuration, inferPreset, showProfiles, showDuration, showSettings, handleScenario, updateConfirmedPrizes } from './scenario.js';

import { ownerIdentity, handleAdmin } from './admin.js';
import { captureResultContext, handleCompanion } from './companion.js';
import { samplePrompt } from './imports.js';
import { localizeButtons } from './buttons.js';
import { handleOperations, operationsPrompt, filterAbsentGuests, finalizeOperationsResult } from './operations.js';
import { handleRehearsal } from './rehearsal.js';
import { handleTournament, tournamentPrompt } from './tournament.js';
import { handleAwards, awardsPrompt } from './awards.js';
import { handleVoice } from './voice.js';

export { SYSTEM, RESULT_BUTTONS };
// Interface messages always use Kazakh; generated text has its own language.
const choose = (_session, _ru, kk) => kk;
export function resultButtons(session) {
  return [...RESULT_BUTTONS, [{ text: '✅ Сөз алдындағы тексеру', callback_data: 'check:open' }], [{ text: '👥 Басшылық / қатысушылар', callback_data: 'staff:open' }], ...(isScenario(session) ? [[{ text: '🧩 Бағдарлама құрастыру', callback_data: 'program:open' }, ...(session.format === 'script' ? [{ text: '👥 Командаға жеке парақтар', callback_data: 'sheet:menu' }] : [])], [{ text: '⚙️ Уақыт, жүргізушілер, сахна', callback_data: 'event:config' }]] : []), [{ text: '🧰 Ұйымдастырушы құралдары', callback_data: 'tools:open' }]];
}
export const RETRY_BUTTONS = [[{ text: 'Қайталау', callback_data: 'retry:yes' }]];
export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS sessions(chat_id INTEGER PRIMARY KEY,value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS drafts(id INTEGER PRIMARY KEY,chat_id INTEGER,title TEXT,text TEXT,created TEXT DEFAULT CURRENT_TIMESTAMP,context TEXT)',
  'CREATE INDEX IF NOT EXISTS draft_owner ON drafts(chat_id,id)',
  'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT)',
  'CREATE TABLE IF NOT EXISTS authorized(chat_id INTEGER PRIMARY KEY)',
  'CREATE TABLE IF NOT EXISTS quota(chat_id INTEGER,created REAL)',
  'CREATE INDEX IF NOT EXISTS quota_time ON quota(created)',
  'CREATE TABLE IF NOT EXISTS generation_jobs(chat_id INTEGER PRIMARY KEY,value TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY,payload TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS seen_updates(id INTEGER PRIMARY KEY,created INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS seen_update_age ON seen_updates(created)',
  'CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY AUTOINCREMENT,chat_id INTEGER,kind TEXT NOT NULL,payload TEXT NOT NULL,job_id TEXT,due INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS outbox_owner ON outbox(chat_id,id)',
];

export function splitText(text, limit = 3600) {
  const chunks = []; let rest = String(text);
  while (rest.length > limit) {
    let end = limit;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    const paragraph = rest.lastIndexOf('\n\n', end - 2), line = rest.lastIndexOf('\n', end - 1), space = rest.lastIndexOf(' ', end - 1);
    if (paragraph >= limit / 2) end = paragraph + 2;
    else if (line >= limit / 2) end = line + 1;
    else if (space >= limit / 2) end = space + 1;
    chunks.push(rest.slice(0, end)); rest = rest.slice(end);
  }
  if (rest) chunks.push(rest);
  return chunks.length ? chunks : ['Мәтін әзірге бос.'];
}

export function keyboard(mapping, prefix, columns = 2) {
  const buttons = Object.entries(mapping).map(([key, text]) => ({ text, callback_data: `${prefix}:${key}` }));
  return Array.from({ length: Math.ceil(buttons.length / columns) }, (_, i) => buttons.slice(i * columns, (i + 1) * columns));
}

export function parseDelay(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.ceil(Number(raw));
  const matches = [...raw.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)];
  if (!matches.length || raw.replace(/\d+(?:\.\d+)?\s*(?:ms|h|m|s)/g, '').trim()) return 0;
  const seconds = matches.reduce((sum, [, n, unit]) => sum + Number(n) * ({ ms: .001, s: 1, m: 60, h: 3600 })[unit], 0);
  return Number.isFinite(seconds) ? Math.ceil(seconds) : 0;
}

export function briefPrompt(s) {
  const size = isScenario(s) ? 'Объём: готовый сценарий с репликами; длительность программы указана в режиссёрских параметрах.' : `Объём: ${s.length || '3'} мин для речи; для других форматов — соразмерно задаче.`;
  const corrections = s.event_fact_evidence?.length ? '\nУточнения организатора в порядке поступления (позднее уточнение заменяет противоречащее раннее; не выполняй стилистическую правку повторно):\n' + s.event_fact_evidence.map((fact, i) => `${i + 1}. ${fact}`).join('\n') : '';
  const prizeFacts = s.confirmed_prizes?.version === 1 ? '\nПодтверждённые виды наград (актуальное состояние, неизвестные виды не добавлять): ' + [['medals', 'медали'], ['cups', 'кубки'], ['trophies', 'трофеи']].filter(([key]) => s.confirmed_prizes[key]).map(([, label]) => label).join(', ') + '. Неподтверждённые награды обозначай плейсхолдером.' : '';
  return `Формат: ${FORMATS[s.format] || 'Сұраныс бойынша мәтін'}.\nЯзык: ${LANGUAGES[s.language || 'kk'] || 'Қазақша'}.\nТон: ${TONES[s.tone || 'warm'] || 'Жылы'}.\n${size}\nЗадание и подтверждённые сведения:\n${s.brief || ''}${corrections}${prizeFacts}${peopleFacts(s)}${scenarioPrompt(s)}${operationsPrompt(s)}${tournamentPrompt(s)}${awardsPrompt(s)}${s.reference_date ? `\nДата исходного задания по Алматы: ${s.reference_date}. В исходном задании «завтра/ертең/tomorrow» относится к этому дню; не сдвигай дату при повторе и не подменяй явно указанную дату.${s.edit_reference_date ? ` Новая правка сделана ${s.edit_reference_date}: относительные даты в самой новой правке считай от этого дня.` : ''}` : ''}`;
}

export function messagesFor(job) {
  const messages = [{ role: 'user', content: briefPrompt(job.session) + samplePrompt(job.session) }];
  if (job.instruction && job.session.result) messages.push({ role: 'assistant', content: isScenario(job.session) ? scenarioBody(job.session.result) : job.session.result }, { role: 'user', content: job.instruction });
  return messages;
}

export function outputBudget(messages) {
  const prompt = messages[0]?.content || '';
  let budget = ({ 1: 900, 3: 1800, 5: 2800 })[prompt.match(/Объём: ([135]) мин/)?.[1] || '3'];
  if (/Формат: (📣 (?:Анонс|Хабарландыру)|📱 (?:Пост|Жарияланым))/u.test(prompt)) budget = 900;
  else if (/Формат: 💐 (?:Благодарность|Алғыс)/u.test(prompt)) budget = 1100;
  else if (/Формат: 📦 (?:Всё для события|Іс-шараға толық жинақ)/u.test(prompt)) budget = 3000;
  else if (prompt.includes('Формат: 🎭 Сценарий')) budget = 3200;
  if (messages.length >= 3) budget = Math.min(3200, Math.max(budget, Math.ceil([...messages.at(-2).content].length / 2) + 300));
  return budget;
}

export class Store {
  constructor(storage) {
    this.storage = storage; this.sql = storage.sql;
    for (const query of SCHEMA) this.sql.exec(query);
  }
  rows(query, ...args) { return this.sql.exec(query, ...args).toArray(); }
  one(query, ...args) { return this.rows(query, ...args)[0]; }
  exec(query, ...args) { this.sql.exec(query, ...args); }
  transaction(callback) { return this.storage.transactionSync(callback); }
  get(chat) { return JSON.parse(this.one('SELECT value FROM sessions WHERE chat_id=?', chat)?.value || '{"step":"type","language":"kk"}'); }
  put(chat, value) { this.exec('INSERT OR REPLACE INTO sessions VALUES (?,?)', chat, JSON.stringify(value)); }
  meta(key, fallback = null) { const row = this.one('SELECT value FROM meta WHERE key=?', key); return row ? JSON.parse(row.value) : fallback; }
  setMeta(key, value) { this.exec('INSERT OR REPLACE INTO meta VALUES (?,?)', key, JSON.stringify(value)); }
  job(chat) { const row = this.one('SELECT value FROM generation_jobs WHERE chat_id=?', chat); return row ? JSON.parse(row.value) : null; }
  saveJob(chat, job) { this.exec('INSERT OR REPLACE INTO generation_jobs VALUES (?,?)', chat, JSON.stringify(job)); }
  updateJob(chat, id, changes) { const job = this.job(chat); if (!job || job.id !== id) return false; this.saveJob(chat, { ...job, ...changes }); return true; }
  cancel(chat) {
    this.exec('DELETE FROM generation_jobs WHERE chat_id=?', chat);
    this.exec('DELETE FROM outbox WHERE chat_id=? AND job_id IS NOT NULL', chat);
    this.exec("DELETE FROM outbox WHERE chat_id=? AND kind='import_document'", chat);
    this.exec("DELETE FROM outbox WHERE chat_id=? AND kind='voice_transcribe'", chat);
  }
  effect(chat, kind, payload, jobId = null) {
    this.exec('INSERT INTO outbox(chat_id,kind,payload,job_id) VALUES (?,?,?,?)', chat, kind, JSON.stringify(payload), jobId);
  }
  send(chat, text, buttons = null, jobId = null) {
    if (buttons) buttons = localizeButtons(buttons, this.get(chat), this);
    const chunks = splitText(text);
    chunks.forEach((chunk, i) => this.effect(chat, 'message', {
      chat_id: chat, text: chunk, link_preview_options: { is_disabled: true },
      ...(buttons && i === chunks.length - 1 ? { reply_markup: { inline_keyboard: buttons } } : {}),
    }, jobId));
  }
  pauseUntil() { return (this.meta('groq_pause', {})?.until || 0) * 1000; }
  reserve(chat, now) {
    this.exec('DELETE FROM quota WHERE created<?', now / 1000 - 60);
    const own = this.rows('SELECT created FROM quota WHERE chat_id=? ORDER BY created', chat);
    const all = this.rows('SELECT created FROM quota ORDER BY created');
    if (own.length >= 4 || all.length >= 20) return Math.max(own.length >= 4 ? own[0].created * 1000 + 61000 : 0, all.length >= 20 ? all[0].created * 1000 + 61000 : 0);
    this.exec('INSERT INTO quota VALUES (?,?)', chat, now / 1000);
    return 0;
  }
  finish(chat, id, session, result) {
    return this.transaction(() => {
      const job = this.job(chat); if (!job || job.id !== id || job.result) return false;
      result = finalizeOperationsResult(session, result);
      const ready = { ...session, step: 'ready', result };
      ready.result_context = captureResultContext(ready);
      for (const key of ['pending_instruction', 'pending_generation_instruction', 'directory_mode', 'directory_group', 'directory_return_step', 'script_editing', 'brief_prefilled', 'operation_generation', 'operations_notice']) delete ready[key];
      const { result: unused, ...context } = ready;
      this.put(chat, ready);
      this.exec('INSERT INTO drafts(chat_id,title,text,context) VALUES (?,?,?,?)', chat, (ready.brief || 'Текст OAIU').split('\n')[0].slice(0, 100), result, JSON.stringify(context));
      this.exec('DELETE FROM drafts WHERE chat_id=? AND id NOT IN (SELECT id FROM drafts WHERE chat_id=? ORDER BY id DESC LIMIT 10)', chat, chat);
      this.saveJob(chat, { ...job, result });
      this.send(chat, result, resultButtons(ready), id);
      if (session.operations_notice) this.send(chat, session.operations_notice, null, id);
      return true;
    });
  }
  counts() {
    return Object.fromEntries(['sessions', 'drafts', 'generation_jobs', 'outbox'].map(table => [table, this.one(`SELECT COUNT(*) AS n FROM ${table}`).n]));
  }
}

export class Dialogue {
  constructor(store, env) { this.store = store; this.env = env; }
  accept(update) {
    if (!Number.isSafeInteger(update?.update_id)) throw new TypeError('Invalid update');
    return this.store.transaction(() => {
      if (this.store.one('SELECT 1 FROM seen_updates WHERE id=?', update.update_id)) return false;
      const callback = update.callback_query;
      const message = callback?.message || update.message || {};
      const chat = message.chat?.id;
      if (callback?.id && Number.isSafeInteger(chat)) this.store.effect(chat, 'callback', { callback_query_id: callback.id });
      if (Number.isSafeInteger(chat) && message.chat.type === 'private') this.process(chat, String(message.text || '').trim(), String(callback?.data || ''), callback?.from || message.from, callback ? null : message.document, callback ? null : message.voice);
      this.store.exec('INSERT INTO seen_updates VALUES (?,?)', update.update_id, Date.now());
      this.store.exec('DELETE FROM seen_updates WHERE created<?', Date.now() - 7 * 86400000);
      return true;
    });
  }
  menu(chat, owner = false) {
    this.store.cancel(chat); this.store.put(chat, { step: 'type', language: 'kk' });
    this.store.send(chat, 'Сәлем! Мен OAIU көмекшісімін. Университет іс-шарасына сөз, уақыт кестесі бар сценарий және басқа мәтіндер дайындаймын.\n\nНе дайындаймыз?', [...keyboard(FORMATS, 'type'), [{ text: '👥 Басшылық / кафедралар', callback_data: 'staff:open' }], [{ text: '🧰 Ұйымдастырушы құралдары', callback_data: 'tools:open' }], ...(owner ? [[{ text: '⚙️ Басқару панелім', callback_data: 'admin:open' }]] : [])]);
  }
  askTone(chat, session) {
    const tones = session.language === 'kk' ? { warm: 'Жылы', formal: 'Салтанатты', inspiring: 'Шабыттандыратын', business: 'Іскерлік' } : TONES;
    this.store.send(chat, choose(session, 'Выберите настроение текста:', 'Мәтіннің мәнерін таңдаңыз:', 'Choose the tone:'), keyboard(tones, 'tone'));
  }
  askBrief(chat, session) {
    this.store.send(chat, isScenario(session)
      ? choose(session, 'Опишите событие: название, дата, место, аудитория, команды/номера программы, судьи и награждение — что известно. Если чего-то нет, оставлю место для заполнения. Параметры времени и сцены уже сохранены.', 'Іс-шараны сипаттаңыз: атауы, күні, орны, аудиториясы, командалар не өнер нөмірлері, төрешілер және марапаттау — белгілі мәліметті ғана жазыңыз. Белгісіз дерекке толтыратын орын қалдырамын. Уақыт пен сахна параметрлері сақталды.', 'Describe the event: name, date, venue, audience, teams or performances, officials and awards, using known facts. Timing and staging are already saved.')
      : choose(session, 'Теперь опишите событие одним сообщением: название, аудитория, от чьего имени текст, главная мысль, дата и место — если известны. Выбранные ФИО подставлю из справочника.', 'Енді іс-шараны бір хабарламамен сипаттаңыз: атауы, аудиториясы, кімнің атынан айтылатыны, негізгі ойы, белгілі болса күні мен орны. Таңдалған адамның аты-жөнін анықтамалықтан қосамын.', 'Describe the event, audience, speaker, main idea, date and place if known. Selected names will come from the directory.'));
  }
  openPeople(chat, session, group = 'all', mode = null) {
    showDirectory(this.store, chat, { ...session, directory_return_step: session.directory_return_step || session.step, directory_mode: mode || (session.result ? 'edit' : 'manual') }, group);
  }
  finishPeople(chat, session) {
    const mode = session.directory_mode, pending = session.pending_generation_instruction;
    const next = { ...session, step: session.directory_return_step || session.step };
    for (const key of ['directory_mode', 'directory_group', 'directory_return_step', 'pending_generation_instruction']) delete next[key];
    this.store.put(chat, next);
    if (mode === 'generate') this.generate(chat, next, pending ?? null, true);
    else if (mode === 'edit' && next.result) this.generate(chat, { ...next, step: 'ready' }, 'Обнови участников по выбранному справочнику. Используй точные ФИО и должности. Убери прежние имена руководителей, которых больше нет в выбранном списке; не добавляй неизвестных гостей. Сохрани тему, язык, время и остальные подтверждённые факты.', true);
    else if (mode === 'wizard') { this.store.put(chat, { ...next, step: 'brief' }); next.brief ? this.generate(chat, { ...next, step: 'brief' }, null, true) : this.askBrief(chat, next); }
    else this.store.send(chat, choose(next, 'Выбор сохранён. Продолжите текущую задачу кнопками выше или опишите событие.', 'Таңдау сақталды. Жоғарыдағы батырмалармен жалғастырыңыз немесе іс-шараны сипаттаңыз.', 'Selection saved. Continue with the buttons above or describe the event.'));
  }
  handlePeople(chat, text, callback, command) {
    const s = this.store; let session = s.get(chat);
    const query = !callback && !command && !session.step?.startsWith('program_') ? directoryQuery(text) : null;
    if (command === '/people' || callback === 'staff:open' || query) { this.openPeople(chat, session, query || 'all'); return true; }
    if (callback.startsWith('person:')) {
      const person = catalog(s).find(person => person.id === callback.slice(7)); if (!person) return true;
      s.cancel(chat);
      if (!session.directory_mode) session = { ...session, directory_mode: session.result ? 'edit' : 'manual', directory_return_step: session.step };
      const people = [...(session.people || [])], index = people.indexOf(person.id);
      if (index >= 0) people.splice(index, 1);
      else if (people.length < 6) people.push(person.id);
      else { s.send(chat, choose(session, 'Можно выбрать до 6 участников.', '6 адамға дейін таңдауға болады.', 'Select up to 6 participants.')); return true; }
      showDirectory(s, chat, { ...session, people }, session.directory_group || 'all'); return true;
    }
    if (callback.startsWith('staff:')) {
      const action = callback.slice(6);
      if (!session.directory_mode) session = { ...session, directory_mode: session.result ? 'edit' : 'manual', directory_return_step: session.step };
      if (['leadership', 'deans', 'departments', 'all'].includes(action)) showDirectory(s, chat, session, action);
      else if (action === 'custom') { s.cancel(chat); s.put(chat, { ...session, step: 'staff_custom' }); s.send(chat, choose(session, 'Укажите ФИО и должность через точку с запятой: «Имя Фамилия; главный судья». Этот участник останется только в вашей задаче.', 'Аты-жөні мен лауазымын нүктелі үтірмен бөліп жазыңыз: «Аты Жөні; бас төреші». Бұл адам тек сіздің тапсырмаңызда сақталады.', 'Enter full name; role. This person is saved only in your task.')); }
      else if (action === 'done' || action === 'none') { if (action === 'none') session = { ...session, people: [], custom_people: [] }; this.finishPeople(chat, session); }
      return true;
    }
    if (!callback && !command && session.step === 'staff_custom') {
      const parts = text.split(';').map(v => v.trim());
      if (parts.length !== 2 || !parts.every(Boolean) || [...parts[0]].length > 120 || [...parts[1]].length > 200) { s.send(chat, choose(session, 'Нужны ФИО; должность. Например: «Алия Садыкова; ведущая».', 'Аты-жөні; лауазымы керек. Мысалы: «Алия Садыкова; жүргізуші».', 'Use full name; role.')); return true; }
      if ((session.people || []).length >= 6) { s.send(chat, choose(session, 'Сначала уберите одного участника: максимум 6.', 'Алдымен бір адамды алып тастаңыз: ең көбі 6.', 'Remove a participant first; maximum 6.')); return true; }
      const person = { id: 'custom_' + crypto.randomUUID().slice(0, 8), name: parts[0], role: parts[1] };
      showDirectory(s, chat, { ...session, step: session.directory_return_step || 'brief', people: [...(session.people || []), person.id], custom_people: [...(session.custom_people || []).filter(p => (session.people || []).includes(p.id)), person] }); return true;
    }
    return false;
  }
  generate(chat, session, instruction = null, reviewed = false) {
    session = updateConfirmedPrizes(session, instruction);
    const evidence = Array.isArray(session.event_fact_evidence) ? session.event_fact_evidence.filter(value => typeof value === 'string').slice(-20) : [];
    if (instruction && evidence.at(-1) !== instruction) evidence.push(instruction);
    while (evidence.length > 20 || evidence.reduce((sum, value) => sum + value.length, 0) > 6000) evidence.shift();
    session = { ...session, language: session.language || 'kk', event_fact_evidence: evidence };
    if (session.sample_id && session.reference_sample?.id !== session.sample_id) {
      const sample = this.store.meta('approved_samples', []).find(sample => sample.id === session.sample_id);
      session = { ...session, reference_sample: sample ? structuredClone(sample) : null };
    } else if (!session.sample_id) { session = { ...session }; delete session.reference_sample; }
    if (!reviewed) session = enrichPeople(session, instruction || session.brief || '', this.store);
    session = snapshotPeople(session, this.store);
    session = filterAbsentGuests(session);
    const ambiguous = !reviewed && ambiguousPeople(instruction || session.brief || '', session);
    if (ambiguous) { this.openPeople(chat, { ...session, pending_generation_instruction: instruction }, ambiguous, 'generate'); return; }
    // Apply relative edits only after an optional people-selection round trip.
    if (!session.operation_generation) session = scenarioChange(session, instruction);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const today = ['year', 'month', 'day'].map(key => parts.find(part => part.type === key).value).join('-');
    session.reference_date ||= today;
    if (instruction) session.edit_reference_date = today; else delete session.edit_reference_date;
    session = { ...session, pending_instruction: instruction }; this.store.put(chat, session);
    if (!this.env.GROQ_API_KEY) { this.store.send(chat, 'Мәтін жасау үшін иесі Groq кілтін қосуы керек. Тапсырма сақталды.', RETRY_BUTTONS); return; }
    const existing = this.store.job(chat);
    if (existing && existing.instruction === instruction && ['format', 'language', 'tone', 'length', 'brief', 'result', 'people', 'custom_people', 'event_preset', 'event_minutes', 'event_start', 'host_count', 'host_names', 'stage_key', 'stage_note', 'program_blocks', 'reference_sample', 'locked_fragments', 'guest_statuses', 'guest_records', 'emergency_state', 'tournament', 'awards_data', 'operation_generation'].every(key => JSON.stringify(existing.session[key]) === JSON.stringify(session[key]))) return;
    this.store.cancel(chat);
    const generationSession = { ...session };
    delete generationSession.result_context;
    delete generationSession.script_data;
    const job = { id: crypto.randomUUID(), session: generationSession, instruction, notice_sent: true, next_at: 0, failures: 0 };
    this.store.saveJob(chat, job);
    if (!existing?.notice_sent) this.store.send(chat, 'Мәтін дайындап жатырмын…', null, job.id);
  }
  process(chat, text, callback, sender, document = null, voice = null) {
    const s = this.store;
    let command = text.startsWith('/') ? text.split(/\s/, 1)[0].split('@', 1)[0] : '';
    if (this.env.BOT_ACCESS_CODE && !s.one('SELECT 1 FROM authorized WHERE chat_id=?', chat)) {
      if (command === '/start' && text.split(/\s+/)[1] === this.env.BOT_ACCESS_CODE) s.exec('INSERT OR IGNORE INTO authorized VALUES (?)', chat);
      else { s.send(chat, 'Бот шақыру арқылы жұмыс істейді. Иесі берген кіру сілтемесін ашыңыз.'); return; }
    }
    const owner = ownerIdentity(s, this.env, chat, sender, command === '/admin');
    if (handleAdmin(this, chat, text, callback, command, owner, document)) return;
    if (['/start', '/new', '/cancel'].includes(command) || callback === 'new:yes') { this.menu(chat, owner); return; }
    const shortcut = { '/word': 'export:docx', '/pdf': 'export:pdf', '/txt': 'export:txt', '/check': 'check:open', '/sheets': 'sheet:menu', '/program': 'program:open' }[command];
    if (shortcut) { callback = shortcut; command = ''; }
    if (command === '/help') { s.send(chat, 'Форматты, мәтін тілін, көлемі мен мәнерін таңдап, іс-шараны сипаттаңыз. Әдепкі мәтін тілі — қазақша. Сценарийде ұзақтығын, басталу уақытын, жүргізушілерді және шығу жолдарын баптай аласыз. Басшылықты батырмамен немесе /people арқылы таңдаңыз. Дайын мәтінге түзетуді жай хабарламамен жіберіңіз.\n\n/new — жаңа мәтін\n/people — басшылық пен кафедралар\n/history — соңғы нобайлар\n/word · /pdf · /txt — дайын мәтінді жүктеу\n/program — бағдарламаны құрастыру\n/sheets — сценарий қатысушыларына жеке парақтар\n/tools — ұйымдастырушы құралдары\n/emergency — жедел өзгеріс\n/rehearse — репетиция\n/tournament — турнир кестесі\n/locks — бекітілген мәтін\n/awards — марапаттау шебері\n/guests — қонақтар мәртебесі\n/voice — дауыспен тапсырма\n/check — іс-шара алдындағы тексеру\n/privacy — деректерді өңдеу\n/delete — сақталған мәтіндерді өшіру\n/cancel — ағымдағы тапсырмадан бас тарту'); return; }
    if (command === '/privacy') { s.send(chat, 'Хабарламалар Telegram арқылы өтеді. Мәтін жасау үшін іс-шара сипаттамасы, нақтылаулар және ағымдағы мәтін Groq қызметіне жіберіледі; Telegram идентификаторы модельге берілмейді. Cloudflare ішінде ағымдағы тапсырма мен мәтіннің соңғы 10 нұсқасына дейін сақталады. Word пен PDF сыртқы түрлендіргішсіз Cloudflare ішінде жасалады. Иесі DOCX жүктей алады: тексеріп, растаған соң ортақ анықтамалыққа аты-жөні мен лауазымдар, ал үлгілерге сценарий бөлімдерінің атаулары сақталады. Файлдың өзі сақталмайды. Дауыстық хабарлама келісіміңізбен Groq қызметіне тануға жіберіледі; дыбыс бот базасында сақталмайды. Танылған мәтін қолданар алдында көрсетіледі. Қонақтар мәртебесін, марапат алушылар тізімін және турнир командаларын тек өз тапсырмаңызда сақтаймын. /delete бот базасындағы өз деректеріңізді өшіреді; Telegram не Groq деректерін өшірмейді.'); return; }
    if (command === '/delete') { s.send(chat, 'Ағымдағы тапсырма мен барлық сақталған нобайларыңызды бот базасынан өшірейін бе?', [[{ text: 'Мәтіндерімді өшіру', callback_data: 'delete:confirm' }, { text: 'Бас тарту', callback_data: 'delete:cancel' }]]); return; }
    if (callback === 'delete:confirm') {
      s.cancel(chat); for (const table of ['sessions', 'drafts', 'quota', 'outbox']) s.exec(`DELETE FROM ${table} WHERE chat_id=?`, chat);
      s.send(chat, 'Мәтіндеріңіз бот базасынан өшірілді. Жаңа мәтін: /new'); return;
    }
    if (callback === 'delete:cancel') { s.send(chat, 'Сақталған мәтіндер өзгеріссіз қалды.'); return; }
    if (handleCompanion(this, chat, text, callback, command)) return;
    if (command === '/history') {
      const rows = s.rows('SELECT id,title,created FROM drafts WHERE chat_id=? ORDER BY id DESC LIMIT 5', chat);
      s.send(chat, rows.length ? 'Соңғы нобайларыңыз:' : 'Әзірге нобай жоқ. Алғашқысын жасау: /new', rows.length ? rows.map(d => [{ text: d.title.slice(0, 45) || d.created, callback_data: `history:${d.id}` }]) : null); return;
    }
    if (callback.startsWith('history:')) {
      const value = callback.slice(8);
      const draft = /^\d+$/.test(value) ? s.one('SELECT text,context FROM drafts WHERE chat_id=? AND id=?', chat, Number(value)) : null;
      if (!draft) { s.send(chat, 'Бұл нобай қолжетімсіз. Тізімді жаңарту: /history'); return; }
      s.cancel(chat);
      const session = { step: 'ready', format: 'speech', language: 'kk', tone: 'warm', length: '3', brief: 'Отредактировать сохранённый текст, сохранив содержащиеся в нём факты.', ...JSON.parse(draft.context || '{}'), result: draft.text };
      s.put(chat, session); s.send(chat, draft.text, resultButtons(session)); return;
    }
    if (callback === 'tools:open' || command === '/tools') {
      s.send(chat, 'Ұйымдастырушы құралдары\n\nСценарий дайын болса — жедел өзгеріс, репетиция және бекітілген мәтіндер қолжетімді. Турнир мен марапаттауды бөлек дайындауға да болады.', [
        [{text:'🚨 Жедел өзгеріс',callback_data:'ops:open'},{text:'🎙 Репетиция',callback_data:'rehearsal:open'}],
        [{text:'🏐 Турнир кестесі',callback_data:'tournament:open'},{text:'🔒 Бекітілген мәтін',callback_data:'lock:open'}],
        [{text:'🏆 Марапаттау шебері',callback_data:'awards:open'},{text:'👥 Қонақтар мәртебесі',callback_data:'guest:open'}],
        [{text:'🎤 Дауыспен тапсырма',callback_data:'voice:help'}],
      ]); return;
    }
    if (callback === 'voice:help') { callback = ''; command = '/voice'; }
    if (handleVoice(this, chat, text, callback, command, voice)) return;
    if (handleOperations(this, chat, text, callback, command)) return;
    if (handleRehearsal(this, chat, text, callback, command)) return;
    if (handleTournament(this, chat, text, callback, command)) return;
    if (handleAwards(this, chat, text, callback, command)) return;
    if (!command && !callback) {
      const current = s.get(chat), answer = text.trim().toLocaleLowerCase();
      if (current.step === 'event_settings' && /^(?:жалғастыру|продолжить|continue|дайын|готово|done)$/.test(answer)) callback = 'event:ready';
      else if (current.directory_mode && /^(?:жалғастыру|продолжить|continue|дайын|готово|done)$/.test(answer)) callback = 'staff:done';
      else if (current.step === 'tone') {
        const tone = { 'жылы': 'warm', 'тёплый': 'warm', 'теплый': 'warm', 'warm': 'warm', 'салтанатты': 'formal', 'торжественный': 'formal', 'formal': 'formal', 'шабыттандыратын': 'inspiring', 'вдохновляющий': 'inspiring', 'inspiring': 'inspiring', 'іскерлік': 'business', 'деловой': 'business', 'business': 'business' }[answer];
        if (tone) callback = 'tone:' + tone;
      }
    }
    if (this.handlePeople(chat, text, callback, command)) return;
    if (!command && handleScenario(this, chat, text, callback)) return;
    let session = s.get(chat);
    const [kind, value] = callback.split(':', 2);
    if (kind === 'type' && Object.hasOwn(FORMATS, value)) {
      s.put(chat, { ...Object.fromEntries(['guest_statuses', 'guest_records', 'tournament', 'awards_data'].filter(key => session[key] !== undefined).map(key => [key, session[key]])), step: 'language', language: 'kk', format: value, people: session.people || [], custom_people: session.custom_people || [], directory_people: session.directory_people || [] }); s.send(chat, 'Мәтінді қай тілде дайындаймыз? Әдепкі тіл — қазақша.', keyboard(LANGUAGES, 'language', 3)); return;
    }
    if (kind === 'language') {
      if (session.step !== 'language' || !Object.hasOwn(LANGUAGES, value)) { s.send(chat, 'Бұл батырма басқа тапсырмаға арналған. Жаңасын бастау: /new'); return; }
      if (isScenario(session)) { showProfiles(s, chat, { ...session, language: value }); return; }
      s.put(chat, { ...session, language: value, step: 'length' });
      s.send(chat, 'Қандай көлем керек? Сөз үшін — шамамен сөйлеу уақыты, басқа форматтар үшін — толықтық деңгейі.', keyboard({ 1: 'Қысқа · ≈1 минут', 3: 'Орташа · ≈3 минут', 5: 'Толық · ≈5 минут' }, 'length', 1)); return;
    }
    if (kind === 'length' && session.step === 'length' && ['1', '3', '5'].includes(value)) {
      if (isScenario(session)) { showDuration(s, chat, session); return; }
      s.put(chat, { ...session, length: value, step: 'tone' }); this.askTone(chat, session); return;
    }
    if (kind === 'tone' && session.step === 'tone' && Object.hasOwn(TONES, value)) {
      const next = enrichPeople({ ...session, tone: value, step: 'brief' }, session.brief || '', s);
      this.openPeople(chat, next, 'all', 'wizard'); return;
    }
    if (callback === 'export:txt') { if (session.result) s.effect(chat, 'document', { chat_id: chat, text: session.result }); else s.send(chat, 'Алдымен мәтін жасаңыз: /new'); return; }
    if (callback === 'again:yes' || callback === 'retry:yes') { if (session.brief) this.generate(chat, session, callback === 'retry:yes' ? session.pending_instruction ?? null : null); return; }
    if (callback === 'edit:custom') { s.send(chat, session.result ? 'Ағымдағы мәтінде нені өзгерту керегін жазыңыз.' : 'Алдымен мәтін жасаңыз: /new'); return; }
    if (kind === 'edit' || kind === 'translate') {
      if (!session.result) return;
      let instruction = ({ short: 'Сократи текущий текст примерно вдвое, сохранив ключевые мысли и факты. Язык не меняй.', formal: 'Сделай текст торжественнее, сохранив естественную речь, факты и язык.', thanks: 'Добавь уместную благодарность преподавателям. Сохрани язык, смысл и факты; имена не придумывай.', simple: 'Сделай текст менее официальным, живым и естественным. Сохрани язык и факты.' })[value];
      if (kind === 'translate' && Object.hasOwn(LANGUAGES, value)) { instruction = `Переведи текст на ${LANGUAGES[value]}, сохрани смысл и факты.`; session = { ...session, language: value }; }
      if (instruction) this.generate(chat, session, instruction); return;
    }
    if (callback) return;
    if (command) { s.send(chat, 'Мұндай команда әзірге жоқ. Нұсқаулық: /help'); return; }
    if (!text) { s.send(chat, 'Әзірге мәтіндік хабарламалармен жұмыс істеймін. Іс-шараны сипаттаңыз немесе /new арқылы бастаңыз.'); return; }
    if ([...text].length > 3000) { s.send(chat, 'Хабарламаны 3000 таңбаға дейін қысқартыңыз: негізгі деректер мен тілектерді қалдырыңыз.'); return; }
    if (session.step === 'ready' && session.result) this.generate(chat, session, text);
    else if (session.step === 'brief') this.generate(chat, { ...session, brief: text });
    else if (session.step === 'type') {
      if (/сценари|сценарий|scenario|event script/iu.test(text)) {
        let next = { ...session, format: 'script', language: 'kk', event_preset: inferPreset(text), event_minutes: mentionedDuration(text), host_count: 2, stage_key: /спортзал|gym/iu.test(text) ? 'gym' : 'right_left', brief: text, brief_prefilled: true };
        next = scenarioChange(next, text);
        if (next.stage_key === 'custom') next.stage_note = text.split(/(?<=[.!?])\s+/u).filter(part => /справа|слева|оң\s*жақ|сол\s*жақ/iu.test(part)).join(' ').slice(0, 500) || next.stage_note;
        next.event_minutes ? showSettings(s, chat, next) : showDuration(s, chat, next);
      } else this.generate(chat, { ...session, step: 'brief', format: 'speech', language: 'kk', length: '3', tone: 'warm', brief: text });
    }
    else s.send(chat, 'Алдымен жоғарыдағы батырмамен нұсқа таңдаңыз. Немесе қайта бастаңыз: /new');
  }
}

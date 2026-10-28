import { FORMATS, LANGUAGES, TONES, SYSTEM, RESULT_BUTTONS } from './ui.js';

export { SYSTEM, RESULT_BUTTONS };
export const RETRY_BUTTONS = [[{ text: 'Повторить', callback_data: 'retry:yes' }]];
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
  const chunks = []; let current = '';
  for (const char of String(text)) {
    if (current.length + char.length > limit) { chunks.push(current); current = ''; }
    current += char;
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : ['Текст пока пуст.'];
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
  return `Формат: ${FORMATS[s.format] || 'Текст по запросу'}.\nЯзык: ${LANGUAGES[s.language || 'ru'] || 'сохранить язык исходного текста'}.\nТон: ${TONES[s.tone || 'warm'] || 'Тёплый'}.\nОбъём: ${s.length || '3'} мин для речи; для других форматов — соразмерно задаче.\nЗадание и подтверждённые сведения:\n${s.brief || ''}`;
}

export function messagesFor(job) {
  const messages = [{ role: 'user', content: briefPrompt(job.session) }];
  if (job.instruction && job.session.result) messages.push({ role: 'assistant', content: job.session.result }, { role: 'user', content: job.instruction });
  return messages;
}

export function outputBudget(messages) {
  const prompt = messages[0]?.content || '';
  let budget = ({ 1: 900, 3: 1800, 5: 2800 })[prompt.match(/Объём: ([135]) мин/)?.[1] || '3'];
  if (/Формат: (📣 Анонс|📱 Пост)/u.test(prompt)) budget = 900;
  else if (prompt.includes('Формат: 💐 Благодарность')) budget = 1100;
  else if (prompt.includes('Формат: 📦 Всё для события')) budget = 3000;
  else if (prompt.includes('Формат: 🎭 Сценарий')) budget = Math.max(budget, 2000);
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
  get(chat) { return JSON.parse(this.one('SELECT value FROM sessions WHERE chat_id=?', chat)?.value || '{"step":"type"}'); }
  put(chat, value) { this.exec('INSERT OR REPLACE INTO sessions VALUES (?,?)', chat, JSON.stringify(value)); }
  meta(key, fallback = null) { const row = this.one('SELECT value FROM meta WHERE key=?', key); return row ? JSON.parse(row.value) : fallback; }
  setMeta(key, value) { this.exec('INSERT OR REPLACE INTO meta VALUES (?,?)', key, JSON.stringify(value)); }
  job(chat) { const row = this.one('SELECT value FROM generation_jobs WHERE chat_id=?', chat); return row ? JSON.parse(row.value) : null; }
  saveJob(chat, job) { this.exec('INSERT OR REPLACE INTO generation_jobs VALUES (?,?)', chat, JSON.stringify(job)); }
  updateJob(chat, id, changes) { const job = this.job(chat); if (!job || job.id !== id) return false; this.saveJob(chat, { ...job, ...changes }); return true; }
  cancel(chat) {
    this.exec('DELETE FROM generation_jobs WHERE chat_id=?', chat);
    this.exec('DELETE FROM outbox WHERE chat_id=? AND job_id IS NOT NULL', chat);
  }
  effect(chat, kind, payload, jobId = null) {
    this.exec('INSERT INTO outbox(chat_id,kind,payload,job_id) VALUES (?,?,?,?)', chat, kind, JSON.stringify(payload), jobId);
  }
  send(chat, text, buttons = null, jobId = null) {
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
      const ready = { ...session, step: 'ready', result }; delete ready.pending_instruction;
      const { result: unused, ...context } = ready;
      this.put(chat, ready);
      this.exec('INSERT INTO drafts(chat_id,title,text,context) VALUES (?,?,?,?)', chat, (ready.brief || 'Текст OAIU').split('\n')[0].slice(0, 100), result, JSON.stringify(context));
      this.exec('DELETE FROM drafts WHERE chat_id=? AND id NOT IN (SELECT id FROM drafts WHERE chat_id=? ORDER BY id DESC LIMIT 10)', chat, chat);
      this.saveJob(chat, { ...job, result });
      this.send(chat, result, RESULT_BUTTONS, id);
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
      if (Number.isSafeInteger(chat) && message.chat.type === 'private') this.process(chat, String(message.text || '').trim(), String(callback?.data || ''));
      this.store.exec('INSERT INTO seen_updates VALUES (?,?)', update.update_id, Date.now());
      this.store.exec('DELETE FROM seen_updates WHERE created<?', Date.now() - 7 * 86400000);
      return true;
    });
  }
  menu(chat) {
    this.store.cancel(chat); this.store.put(chat, { step: 'type' });
    this.store.send(chat, 'Привет! Я OAIU Помощник. Подготовлю текст для университетского события.\n\nЧто создадим?', keyboard(FORMATS, 'type'));
  }
  generate(chat, session, instruction = null) {
    session = { ...session, pending_instruction: instruction }; this.store.put(chat, session);
    if (!this.env.GROQ_API_KEY) { this.store.send(chat, 'Для генерации владелец должен подключить ключ Groq. Задание сохранено.', RETRY_BUTTONS); return; }
    const existing = this.store.job(chat);
    if (existing && existing.instruction === instruction && ['format', 'language', 'tone', 'length', 'brief', 'result'].every(key => existing.session[key] === session[key])) return;
    this.store.cancel(chat);
    const job = { id: crypto.randomUUID(), session, instruction, notice_sent: true, next_at: 0, failures: 0 };
    this.store.saveJob(chat, job);
    if (!existing?.notice_sent) this.store.send(chat, 'Готовлю текст…', null, job.id);
  }
  process(chat, text, callback) {
    const s = this.store, command = text.startsWith('/') ? text.split(/\s/, 1)[0].split('@', 1)[0] : '';
    if (this.env.BOT_ACCESS_CODE && !s.one('SELECT 1 FROM authorized WHERE chat_id=?', chat)) {
      if (command === '/start' && text.split(/\s+/)[1] === this.env.BOT_ACCESS_CODE) s.exec('INSERT OR IGNORE INTO authorized VALUES (?)', chat);
      else { s.send(chat, 'Бот работает по приглашению. Откройте ссылку доступа, которую выдаёт владелец.'); return; }
    }
    if (['/start', '/new', '/cancel'].includes(command) || callback === 'new:yes') { this.menu(chat); return; }
    if (command === '/help') { s.send(chat, 'Выберите формат, язык, объём и тон, затем опишите событие. После ответа можно написать правки обычным сообщением.\n\n/new — новый текст\n/history — последние черновики\n/privacy — обработка данных\n/delete — удалить сохранённые тексты\n/cancel — отменить текущую задачу'); return; }
    if (command === '/privacy') { s.send(chat, 'Сообщения проходят через Telegram. Для генерации описание события и текущий текст отправляются в Groq; идентификатор Telegram в запрос модели не входит. В Cloudflare хранятся текущая задача и до 10 последних версий текста. /delete удаляет эти записи из базы бота, но не переписку и данные у Telegram или Groq.'); return; }
    if (command === '/delete') { s.send(chat, 'Удалить текущую задачу и все ваши сохранённые черновики из базы бота?', [[{ text: 'Удалить мои тексты', callback_data: 'delete:confirm' }, { text: 'Отмена', callback_data: 'delete:cancel' }]]); return; }
    if (callback === 'delete:confirm') {
      s.cancel(chat); for (const table of ['sessions', 'drafts', 'quota', 'outbox']) s.exec(`DELETE FROM ${table} WHERE chat_id=?`, chat);
      s.send(chat, 'Ваши тексты удалены из базы бота. Новый текст: /new'); return;
    }
    if (callback === 'delete:cancel') { s.send(chat, 'Сохранённые тексты оставлены.'); return; }
    if (command === '/history') {
      const rows = s.rows('SELECT id,title,created FROM drafts WHERE chat_id=? ORDER BY id DESC LIMIT 5', chat);
      s.send(chat, rows.length ? 'Ваши последние черновики:' : 'Черновиков пока нет. Создать первый: /new', rows.length ? rows.map(d => [{ text: d.title.slice(0, 45) || d.created, callback_data: `history:${d.id}` }]) : null); return;
    }
    let session = s.get(chat);
    const [kind, value] = callback.split(':', 2);
    if (kind === 'history') {
      const draft = /^\d+$/.test(value) ? s.one('SELECT text,context FROM drafts WHERE chat_id=? AND id=?', chat, Number(value)) : null;
      if (!draft) { s.send(chat, 'Этот черновик недоступен. Обновите список: /history'); return; }
      session = { step: 'ready', format: 'speech', language: 'auto', tone: 'warm', length: '3', brief: 'Отредактировать сохранённый текст, сохранив содержащиеся в нём факты.', ...JSON.parse(draft.context || '{}'), result: draft.text };
      s.put(chat, session); s.send(chat, draft.text, RESULT_BUTTONS); return;
    }
    if (kind === 'type' && Object.hasOwn(FORMATS, value)) {
      s.put(chat, { step: 'language', format: value }); s.send(chat, 'На каком языке подготовить текст?', keyboard(LANGUAGES, 'language', 3)); return;
    }
    if (kind === 'language') {
      if (session.step !== 'language' || !Object.hasOwn(LANGUAGES, value)) { s.send(chat, 'Эта кнопка относится к другой задаче. Начать новую: /new'); return; }
      s.put(chat, { ...session, language: value, step: 'length' });
      s.send(chat, 'Какой объём нужен? Для речи — примерное время выступления; для других форматов — степень подробности.', keyboard({ 1: 'Коротко · ~1 мин', 3: 'Стандарт · ~3 мин', 5: 'Подробно · ~5 мин' }, 'length', 1)); return;
    }
    if (kind === 'length' && session.step === 'length' && ['1', '3', '5'].includes(value)) {
      s.put(chat, { ...session, length: value, step: 'tone' }); s.send(chat, 'Выберите настроение текста:', keyboard(TONES, 'tone')); return;
    }
    if (kind === 'tone' && session.step === 'tone' && Object.hasOwn(TONES, value)) {
      s.put(chat, { ...session, tone: value, step: 'brief' });
      s.send(chat, 'Теперь опишите событие одним сообщением: название, аудитория, от чьего имени текст, главная мысль, дата и место — если известны.\n\nНапример: «Посвящение в студенты OAIU. Выступает преподаватель. Поздравить первокурсников, пожелать смелости и новых знакомств. Без лишнего официоза».\n\nИмена и неизвестные факты я придумывать не буду.'); return;
    }
    if (callback === 'export:txt') { if (session.result) s.effect(chat, 'document', { chat_id: chat, text: session.result }); else s.send(chat, 'Сначала создайте текст: /new'); return; }
    if (callback === 'again:yes' || callback === 'retry:yes') { if (session.brief) this.generate(chat, session, callback === 'retry:yes' ? session.pending_instruction ?? null : null); return; }
    if (callback === 'edit:custom') { s.send(chat, session.result ? 'Напишите, что изменить в текущем тексте.' : 'Сначала создайте текст: /new'); return; }
    if (kind === 'edit' || kind === 'translate') {
      if (!session.result) return;
      let instruction = ({ short: 'Сократи текущий текст примерно вдвое, сохранив ключевые мысли и факты. Язык не меняй.', formal: 'Сделай текст торжественнее, сохранив естественную речь, факты и язык.', thanks: 'Добавь уместную благодарность преподавателям. Сохрани язык, смысл и факты; имена не придумывай.', simple: 'Сделай текст менее официальным, живым и естественным. Сохрани язык и факты.' })[value];
      if (kind === 'translate' && Object.hasOwn(LANGUAGES, value)) { instruction = `Переведи текст на ${LANGUAGES[value]}, сохрани смысл и факты.`; session = { ...session, language: value }; }
      if (instruction) this.generate(chat, session, instruction); return;
    }
    if (callback) return;
    if (command) { s.send(chat, 'Такой команды пока нет. Подсказки: /help'); return; }
    if (!text) { s.send(chat, 'Пока я работаю с текстовыми сообщениями. Напишите описание события или начните с /new.'); return; }
    if ([...text].length > 3000) { s.send(chat, 'Сократите сообщение до 3000 символов: оставьте основные факты и пожелания.'); return; }
    if (session.step === 'ready' && session.result) this.generate(chat, session, text);
    else if (session.step === 'brief') this.generate(chat, { ...session, brief: text });
    else if (session.step === 'type') this.generate(chat, { step: 'brief', format: 'speech', language: 'ru', length: '3', tone: 'warm', brief: text });
    else s.send(chat, 'Сначала выберите вариант кнопкой выше. Или начните заново: /new');
  }
}

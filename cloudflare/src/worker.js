import { Store, Dialogue, SYSTEM, RETRY_BUTTONS, resultButtons, messagesFor, outputBudget, parseDelay } from './core.js';
import { renderScenario, isScenario, timeline, scriptSchema, scriptStructurePrompt, renderStructuredScenario } from './scenario.js';
import { buildDocument } from './exports.js';
import { MAX_DOCX_BYTES, ImportError, importIsCurrent, completeDocumentImport, failDocumentImport } from './imports.js';

const json = (data, status = 200) => Response.json(data, { status });
export function secretEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return mismatch === 0;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if ((path === '/' || path === '/health') && request.method === 'GET') return json({ service: 'OAIU Assistant', runtime: 'Cloudflare Workers' });
    if (path === '/telegram' && request.method === 'POST') {
      if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) return json({ error: 'Not configured' }, 503);
      if (!secretEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) return json({ error: 'Forbidden' }, 403);
    } else if ((path === '/admin/status' && request.method === 'GET') || (path === '/admin/import' && request.method === 'POST')) {
      if (!secretEqual(request.headers.get('Authorization'), env.MIGRATION_TOKEN ? `Bearer ${env.MIGRATION_TOKEN}` : null)) return json({ error: 'Forbidden' }, 403);
    } else return json({ error: 'Not found' }, 404);
    try {
      return await env.BOT.get(env.BOT.idFromName('oaiu-assistant')).fetch(request);
    } catch {
      // Never log the request URL, message body, Authorization header or keys.
      console.error('Bot storage request failed');
      return json({ error: 'Please retry' }, 503);
    }
  },
};

export class ServiceError extends Error {
  constructor(service, status = 0, retryAfter = 0, kind = '') {
    super(`${service}: status=${status}`);
    this.service = service; this.status = status; this.retryAfter = retryAfter; this.kind = kind;
  }
}

export async function readJson(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) throw new RangeError('Request too large');
  const reader = request.body?.getReader(); if (!reader) throw new TypeError('Missing body');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('Request too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function readDocumentBytes(response, limit = MAX_DOCX_BYTES) {
  if (Number(response.headers.get('Content-Length')) > limit) throw new ImportError('Құжат 1 МБ-тан үлкен. Көлемі кішірек DOCX жіберіңіз.');
  const reader = response.body?.getReader(); if (!reader) throw new ImportError('Файлды оқу мүмкін болмады.');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ImportError('Құжат 1 МБ-тан үлкен. Көлемі кішірек DOCX жіберіңіз.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export class OaiuBot {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.store = new Store(ctx.storage);
    this.dialogue = new Dialogue(this.store, env);
    this.flushing = null; this.running = false;
  }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/admin/status') return json({ ...this.store.counts(), imported: Boolean(this.store.meta('cloudflare_imported')), pending_inbox: this.store.one('SELECT COUNT(*) AS n FROM inbox').n });
    if (path === '/admin/import') {
      try {
        this.importData(await readJson(request, 2 * 1024 * 1024));
      } catch (error) {
        return json({ error: error instanceof RangeError ? 'Import too large' : 'Import rejected: target must be empty and backup valid' }, error instanceof RangeError ? 413 : 409);
      }
      await this.arm();
      return json({ imported: true, ...this.store.counts() });
    }
    if (path !== '/telegram') return json({ error: 'Not found' }, 404);
    try { this.dialogue.accept(await readJson(request, 64 * 1024)); }
    catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError) return json({ error: 'Invalid update' }, 400);
      throw error;
    }
    // Persist the wake-up before acknowledging Telegram. An eviction cannot
    // strand a saved task, even if this request ends before delivery finishes.
    await this.arm();
    this.ctx.waitUntil(this.flushOutbox().finally(() => this.arm()));
    return json({ ok: true });
  }
  importData(data) {
    const columns = {
      sessions: ['chat_id', 'value'], drafts: ['id', 'chat_id', 'title', 'text', 'created', 'context'],
      authorized: ['chat_id'], quota: ['chat_id', 'created'], meta: ['key', 'value'],
      generation_jobs: ['chat_id', 'value'], inbox: ['id', 'payload'],
    };
    if (data?.version !== 1 || !data.tables || Object.keys(data.tables).some(t => !Object.hasOwn(columns, t))) throw new TypeError('Invalid backup');
    for (const [table, rows] of Object.entries(data.tables)) {
      if (!Array.isArray(rows) || rows.length > 20000 || rows.some(row => !Array.isArray(row) || row.length !== columns[table].length || row.some(value => value !== null && !['string', 'number'].includes(typeof value)))) throw new TypeError('Invalid row');
    }
    this.store.transaction(() => {
      const counts = this.store.counts();
      if (this.store.meta('cloudflare_imported') || Object.values(counts).some(Boolean)) throw new Error('Target is not empty');
      for (const [table, rows] of Object.entries(data.tables)) {
        for (const row of rows) {
          // Keep transport offsets and model pauses, never admin state.
          if (table === 'meta' && !['offset', 'automatic_wait_migrated', 'groq_pause'].includes(row[0])) continue;
          this.store.exec(`INSERT INTO ${table}(${columns[table].join(',')}) VALUES (${columns[table].map(() => '?').join(',')})`, ...row);
        }
      }
      for (const row of this.store.rows('SELECT chat_id,value FROM generation_jobs')) {
        const job = JSON.parse(row.value);
        if (!job?.id || !job.session?.brief) throw new TypeError('Invalid job');
        if (job.result) this.store.send(row.chat_id, job.result, resultButtons(job.session), job.id);
        else if (!job.notice_sent) this.store.send(row.chat_id, 'Мәтін дайындап жатырмын…', null, job.id);
        this.store.saveJob(row.chat_id, { ...job, notice_sent: true, next_at: 0, failures: 0 });
      }
      for (const row of this.store.rows('SELECT value FROM sessions')) JSON.parse(row.value);
      this.store.setMeta('cloudflare_imported', { at: Date.now() });
    });
  }
  async telegram(method, payload, form = false) {
    let response, data;
    try {
      response = await fetch(`https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/${method}`, {
        method: 'POST', ...(form ? {} : { headers: { 'Content-Type': 'application/json' } }),
        body: form ? payload : JSON.stringify(payload), signal: AbortSignal.timeout(12000),
      });
      data = await response.json();
    } catch { throw new ServiceError('Telegram'); }
    if (!response.ok || !data.ok) throw new ServiceError('Telegram', data.error_code || response.status, parseDelay(data.parameters?.retry_after || response.headers.get('Retry-After')));
    return data.result;
  }
  async generate(job) {
    const messages = messagesFor(job), model = this.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    const payload = { model, messages: [{ role: 'system', content: SYSTEM }, ...messages], temperature: .75, max_completion_tokens: outputBudget(messages) };
    if (model === 'qwen/qwen3.8-27b') Object.assign(payload, { reasoning_effort: 'none', reasoning_format: 'hidden' });
    if (model.startsWith('openai/gpt-oss-')) Object.assign(payload, { reasoning_effort: 'low', include_reasoning: false });
    const structured = job.session.format === 'script' && timeline(job.session).length && model.startsWith('openai/gpt-oss-');
    if (structured) { payload.max_completion_tokens = Math.max(payload.max_completion_tokens, 1400 + 900 * (job.session.host_count || 2)); payload.response_format = scriptSchema(job.session); payload.messages.push({ role: 'user', content: scriptStructurePrompt(job.session) }); }
    let response, data;
    try {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.GROQ_API_KEY}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(75000) });
      data = await response.json();
    } catch { throw new ServiceError('Groq'); }
    if (!response.ok) {
      const description = String(data.error?.message || '').toLowerCase();
      const kind = /per day|per_day/.test(description) ? 'day' : /per minute|per_minute/.test(description) ? 'minute' : '';
      const delay = Math.max(parseDelay(response.headers.get('Retry-After')), parseDelay(description.match(/try again in\s+([\d.hms ]+)/)?.[1]?.replace(/[. ]+$/, '')));
      throw new ServiceError('Groq', /request too large/.test(description) ? 413 : response.status, delay, kind);
    }
    const choice = data.choices?.[0];
    const text = String(choice?.message?.content || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trim();
    if (!text) throw new ServiceError('Groq', 502);
    if (structured) {
      try { return renderStructuredScenario(job.session, JSON.parse(text)); }
      catch { throw new ServiceError('Groq', 502); }
    }
    return renderScenario(job.session, text + (choice.finish_reason === 'length' ? '\n\n[Жауап көлемінің шегіне жеттік. Жалғастыруды немесе мәтінді қысқартуды сұраңыз.]' : ''));
  }
  async importDocument(chat, payload) {
    if (!importIsCurrent(this.store, chat, payload)) return;
    const file = await this.telegram('getFile', { file_id: payload.file_id });
    if (file.file_size > MAX_DOCX_BYTES) throw new ImportError('Құжат 1 МБ-тан үлкен. Көлемі кішірек DOCX жіберіңіз.');
    const path = String(file.file_path || '');
    if (!/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(path) || path.includes('..') || path.startsWith('/')) throw new ImportError('Telegram жарамды файлды қайтармады. Құжатты қайта жіберіңіз.');
    let response;
    try { response = await fetch(`https://api.telegram.org/file/bot${this.env.TELEGRAM_BOT_TOKEN}/${path}`, { redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new ServiceError('Telegram'); }
    if (!response.ok) throw new ServiceError('Telegram', response.status);
    let bytes;
    try { bytes = await readDocumentBytes(response); }
    catch (error) { if (error instanceof ImportError) throw error; throw new ServiceError('Telegram'); }
    completeDocumentImport(this.store, chat, payload, bytes);
  }
  async flushOutbox() {
    if (this.flushing) return this.flushing;
    this.flushing = this.deliver();
    try { await this.flushing; } finally { this.flushing = null; }
  }
  async deliver() {
    for (let i = 0; i < 6; i++) {
      const row = this.store.one('SELECT * FROM outbox AS o WHERE due<=? AND NOT EXISTS (SELECT 1 FROM outbox AS p WHERE p.chat_id=o.chat_id AND p.id<o.id) ORDER BY id LIMIT 1', Date.now());
      if (!row) break;
      if (row.job_id && this.store.job(row.chat_id)?.id !== row.job_id) { this.store.exec('DELETE FROM outbox WHERE id=?', row.id); continue; }
      const payload = JSON.parse(row.payload);
      try {
        if (row.kind === 'import_document') {
          await this.importDocument(row.chat_id, payload);
        } else if (row.kind === 'document') {
          const form = new FormData(); form.set('chat_id', String(row.chat_id));
          if (['docx', 'pdf'].includes(payload.format)) {
            let file;
            try { file = await buildDocument(payload); }
            catch {
              this.store.exec('DELETE FROM outbox WHERE id=?', row.id);
              this.store.send(row.chat_id, 'Құжат жасау мүмкін болмады. Дайын мәтін сақталды — TXT жүктеуге немесе қайта жүктеп алуға болады.');
              continue;
            }
            form.set('document', new Blob([file.bytes], { type: file.mime }), file.filename);
          } else form.set('document', new Blob(['\uFEFF', payload.text], { type: 'text/plain;charset=utf-8' }), 'OAIU-text.txt');
          await this.telegram('sendDocument', form, true);
        } else await this.telegram(row.kind === 'callback' ? 'answerCallbackQuery' : row.kind === 'commands' ? 'setMyCommands' : 'sendMessage', payload);
        this.store.exec('DELETE FROM outbox WHERE id=?', row.id);
        const job = this.store.job(row.chat_id);
        if (row.job_id && job?.id === row.job_id && job.result && !this.store.one('SELECT 1 FROM outbox WHERE job_id=?', row.job_id)) this.store.exec('DELETE FROM generation_jobs WHERE chat_id=?', row.chat_id);
      } catch (error) {
        if (row.kind === 'import_document' && (error instanceof ImportError || error instanceof ServiceError && ([400, 403, 404].includes(error.status) || row.attempts >= 5))) {
          this.store.exec('DELETE FROM outbox WHERE id=?', row.id);
          failDocumentImport(this.store, row.chat_id, payload.nonce, error instanceof ImportError ? error.message : undefined);
          continue;
        }
        if (!(error instanceof ServiceError)) throw error;
        console.warn('Telegram delivery delayed', error.status);
        if (error.status === 403) { this.store.cancel(row.chat_id); this.store.exec('DELETE FROM outbox WHERE chat_id=?', row.chat_id); }
        else if (error.status === 400) {
          // Expired callback queries and other permanently invalid messages
          // must not create an endless retry loop.
          this.store.exec('DELETE FROM outbox WHERE id=?', row.id);
          const job = this.store.job(row.chat_id);
          if (row.job_id && job?.id === row.job_id && job.result && !this.store.one('SELECT 1 FROM outbox WHERE job_id=?', row.job_id)) this.store.exec('DELETE FROM generation_jobs WHERE chat_id=?', row.chat_id);
        } else this.store.exec('UPDATE outbox SET attempts=attempts+1,due=? WHERE id=?', Date.now() + 1000 * Math.max(error.retryAfter || 0, Math.min(300, 2 ** Math.min(row.attempts + 1, 8))), row.id);
        break;
      }
    }
  }
  async arm() {
    const s = this.store; let next = Infinity;
    const pending = s.one('SELECT MIN(due) AS due FROM outbox');
    if (pending?.due !== null && pending?.due !== undefined) next = Math.min(next, pending.due);
    if (s.one('SELECT 1 FROM inbox LIMIT 1')) next = 0;
    for (const row of s.rows('SELECT value FROM generation_jobs')) {
      const job = JSON.parse(row.value);
      if (!job.result) next = Math.min(next, Math.max(job.next_at || 0, s.pauseUntil()));
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Math.max(Date.now() + 25, next));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    if (this.running) return;
    this.running = true;
    try {
      const inbox = this.store.one('SELECT id,payload FROM inbox ORDER BY id LIMIT 1');
      if (inbox) { this.dialogue.accept(JSON.parse(inbox.payload)); this.store.exec('DELETE FROM inbox WHERE id=?', inbox.id); }
      await this.flushOutbox();
      const row = this.store.rows('SELECT chat_id,value FROM generation_jobs ORDER BY rowid').map(r => ({ chat: r.chat_id, job: JSON.parse(r.value) })).find(r => !r.job.result && (r.job.next_at || 0) <= Date.now());
      if (!row || this.store.pauseUntil() > Date.now()) return;
      const { chat, job } = row;
      const until = this.store.reserve(chat, Date.now());
      if (until) { this.store.updateJob(chat, job.id, { next_at: until }); return; }
      try {
        const result = await this.generate(job);
        this.store.finish(chat, job.id, job.session, result);
      } catch (error) {
        if (!(error instanceof ServiceError)) throw error;
        if (this.store.job(chat)?.id !== job.id) return;
        console.warn('Generation delayed', error.status);
        if (error.status === 429) this.store.setMeta('groq_pause', { until: Date.now() / 1000 + (error.retryAfter || (error.kind === 'day' ? 86400 : 60)), kind: error.kind });
        else if (![400, 401, 403, 404, 413].includes(error.status) && (job.failures || 0) < 7) this.store.updateJob(chat, job.id, { failures: (job.failures || 0) + 1, next_at: Date.now() + Math.min(300000, 5000 * 2 ** (job.failures || 0)) });
        else {
          this.store.cancel(chat);
          this.store.send(chat, [401, 403].includes(error.status) ? 'Мәтінді алу мүмкін болмады: иесі API кілтін және модельге қолжетімділікті тексеруі керек.' : [400, 404, 413].includes(error.status) ? 'Мәтінді алу мүмкін болмады: иесі модель баптауларын тексеруі керек.' : 'Мәтінді алу мүмкін болмады. Тапсырма мен соңғы нобай сақталды.', RETRY_BUTTONS);
        }
      }
      await this.flushOutbox();
    } finally { this.running = false; await this.arm(); }
  }
}

import { DatabaseSync } from 'node:sqlite';
import { OaiuBot } from '../src/worker.js';

export function fixture(env = {}) {
  const db = new DatabaseSync(':memory:'); let alarm = null;
  const storage = {
    sql: { exec(query, ...args) { const stmt = db.prepare(query); const rows = stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []); return { toArray: () => rows }; } },
    transactionSync(callback) { db.exec('BEGIN'); try { const value = callback(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    async setAlarm(at) { alarm = Number(at); }, async getAlarm() { return alarm; }, async deleteAlarm() { alarm = null; },
  };
  const background = [], ctx = { storage, waitUntil(promise) { background.push(promise); } };
  const bot = new OaiuBot(ctx, { GROQ_API_KEY: 'test-key', TELEGRAM_BOT_TOKEN: 'test-token', ...env });
  const sent = []; bot.telegram = async (method, payload) => { sent.push({ method, payload }); return { message_id: sent.length }; };
  return { db, bot, store: bot.store, dialogue: bot.dialogue, sent, ctx, background, alarm: () => alarm };
}

import { readSecrets, workerOrigin, checkedJson } from './private-config.mjs';

const [url, secretsPath] = process.argv.slice(2);
if (!url || !secretsPath) throw new Error('Usage: node scripts/activate.mjs WORKER_URL PRIVATE_CONFIG');
const origin = workerOrigin(url), secrets = await readSecrets(secretsPath);
if (!secrets.TELEGRAM_BOT_TOKEN || !/^[A-Za-z0-9_-]{32,256}$/.test(secrets.TELEGRAM_WEBHOOK_SECRET || '')) throw new Error('Missing Telegram token or strong webhook secret');
const telegram = (method, payload = {}) => checkedJson(`https://api.telegram.org/bot${secrets.TELEGRAM_BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
const me = (await telegram('getMe')).result;
if (me.username !== 'OAIUHELPbot') throw new Error('Wrong bot: migration stopped');
const health = await checkedJson(`${origin}/health`);
if (health.service !== 'OAIU Assistant') throw new Error('Unexpected deployment');
await telegram('setWebhook', { url: `${origin}/telegram`, secret_token: secrets.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], max_connections: 1, drop_pending_updates: false });
const info = (await telegram('getWebhookInfo')).result;
if (info.url !== `${origin}/telegram`) throw new Error('Webhook verification failed');
console.log('OAIU Assistant connected to Cloudflare. Pending updates:', info.pending_update_count);

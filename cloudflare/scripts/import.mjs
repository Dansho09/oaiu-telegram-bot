import { readFile } from 'node:fs/promises';
import { readSecrets, workerOrigin, checkedJson } from './private-config.mjs';

const [url, secretsPath, backupPath] = process.argv.slice(2);
if (!url || !secretsPath || !backupPath) throw new Error('Usage: node scripts/import.mjs WORKER_URL PRIVATE_CONFIG PRIVATE_BACKUP');
const origin = workerOrigin(url), secrets = await readSecrets(secretsPath);
if (!secrets.MIGRATION_TOKEN) throw new Error('Missing one-time migration secret');
const result = await checkedJson(`${origin}/admin/import`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secrets.MIGRATION_TOKEN}` }, body: await readFile(backupPath, 'utf8'),
});
console.log('Private history imported:', result);

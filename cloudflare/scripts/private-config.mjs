import { readFile } from 'node:fs/promises';

export async function readSecrets(path) {
  const raw = await readFile(path, 'utf8');
  if (raw.trimStart().startsWith('{')) return JSON.parse(raw);
  return Object.fromEntries(raw.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).map(line => {
    const index = line.indexOf('='); if (index < 1) throw new Error('Invalid private configuration');
    return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
  }));
}

export function workerOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.workers.dev') || url.username || url.password || url.port) throw new Error('Expected the HTTPS workers.dev deployment URL');
  return url.origin;
}

export async function checkedJson(url, options) {
  let response, data;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(60000) }); data = await response.json(); }
  catch { throw new Error('Network request failed; credentials were not printed'); }
  if (!response.ok || data.ok === false) throw new Error(`Service request failed (${response.status}); credentials were not printed`);
  return data;
}

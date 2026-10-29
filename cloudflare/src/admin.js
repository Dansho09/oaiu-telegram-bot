import { catalog, directoryRoleKk, importedRoleKk } from './directory.js';
import { handleImport, clearImport } from './imports.js';

export const PUBLIC_COMMANDS = [
  ['start', 'Басты мәзір'], ['help', 'Қалай қолданамын?'],
].map(([command, description]) => ({ command, description }));

export function ownerIdentity(store, env, chat, sender, claim = false) {
  if (!sender || sender.is_bot || !Number.isSafeInteger(sender.id) || sender.id !== chat) return false;
  const bound = store.meta('admin_owner_id');
  if (bound !== null) {
    if (bound === sender.id && (claim||store.meta('admin_commands_version')!==2)) {store.setMeta('admin_commands_version',2);store.effect(chat, 'commands', { scope: { type: 'chat', chat_id: chat }, commands: [...PUBLIC_COMMANDS, { command: 'admin', description: 'Жеке басқару панелі' }] });}
    return bound === sender.id;
  }
  const expected = String(env.BOT_OWNER_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (!claim || !expected || String(sender.username || '').toLowerCase() !== expected) return false;
  store.setMeta('admin_owner_id', sender.id);
  store.setMeta('admin_commands_version',2);
  store.effect(chat, 'commands', { scope: { type: 'chat', chat_id: chat }, commands: [...PUBLIC_COMMANDS, { command: 'admin', description: 'Менің басқару панелім' }] });
  return true;
}

export function showAdmin(store, chat, session) {
  store.send(chat, 'Басқару панелі · тек иесіне ашық\nОртақ анықтамалықты өзгертіп, есептегіштерді көруге болады. Басқа пайдаланушылардың мәтіндері көрсетілмейді.', [
    [{ text: '📊 Көрсеткіштер', callback_data: 'admin:stats' }],
    [{ text: '🎓 Ректор / проректорлар', callback_data: 'admin:list:leadership' }],
    [{ text: '🏛 Декандар', callback_data: 'admin:list:deans' }, { text: '📚 Кафедралар', callback_data: 'admin:list:departments' }],
    [{ text: '➕ Анықтамалыққа қосу', callback_data: 'admin:add' }],
    [{ text: '📤 Word-тен анықтамалық', callback_data: 'admin:import:directory' }, { text: '📚 Сценарий үлгілері', callback_data: 'admin:samples' }],
    [{ text: '↩️ Соңғы өзгерісті қайтару', callback_data: 'admin:undo' }],
    [{ text: '⬅️ Ботқа оралу', callback_data: 'admin:close' }],
  ]);
}
const validPerson = parts => parts.length === 2 && parts.every(Boolean) && [...parts[0]].length <= 120 && [...parts[1]].length <= 200 && !/[@\d\n]/u.test(parts[0]) && !/[@\n]|https?:|\+?\d[\d ()-]{6,}/iu.test(parts[1]);
function restoreStep(session) { const next = { ...clearImport(session), step: session.admin_return_step || 'type' }; for (const key of ['admin_return_step', 'admin_person', 'admin_group']) delete next[key]; return next; }

export function handleAdmin(dialogue, chat, text, callback, command, owner, document = null) {
  const store = dialogue.store, session = store.get(chat);
  if (!document && command !== '/admin' && !callback.startsWith('admin:') && !(session.step?.startsWith('admin_') && !command && !callback)) return false;
  if (!owner) { store.send(chat, 'Бұл команда қолжетімсіз.'); return true; }
  const [action, value, pageRaw] = callback.slice(6).split(':');
  if (command === '/admin' || action === 'open') { if (session.step?.startsWith('admin_import_')) store.put(chat, restoreStep(session)); showAdmin(store, chat, store.get(chat)); return true; }
  if (handleImport(dialogue, chat, text, callback, document)) return true;
  if (action === 'stats') {
    const counts = store.counts(), pause = Math.max(0, Math.ceil((store.pauseUntil() - Date.now()) / 1000));
    store.send(chat, 'Көрсеткіштер' + `\nСессиялар: ${counts.sessions}\nНобайлар: ${counts.drafts}\nТапсырмалар: ${counts.generation_jobs}\nЖіберуді күтіп тұр: ${counts.outbox}\nГенерация қызметінің үзілісі: ${pause} сек.\nАнықтамалықтағы жазбалар: ${catalog(store).length}`, [[{ text: '⬅️ Басқару панелі', callback_data: 'admin:open' }]]); return true;
  }
  if (action === 'list' && ['leadership', 'deans', 'departments'].includes(value)) {
    const all = catalog(store).filter(person => person.group === value), page = Math.max(0, Math.min(Math.floor(Number(pageRaw) || 0), Math.floor(Math.max(0, all.length - 1) / 8))), people = all.slice(page * 8, page * 8 + 8);
    const rows = people.map(person => [{ text: person.short || person.name, callback_data: `admin:person:${person.id}` }]);
    if (all.length > 8) rows.push([{ text: '◀', callback_data: `admin:list:${value}:${Math.max(0, page - 1)}` }, { text: '▶', callback_data: `admin:list:${value}:${Math.min(Math.floor((all.length - 1) / 8), page + 1)}` }]);
    rows.push([{ text: '⬅️ Басқару панелі', callback_data: 'admin:open' }]);
    store.send(chat, 'Өзгертетін жазбаны таңдаңыз:' + '\n\n' + people.map(person => `${directoryRoleKk(person)}\n${person.name}`).join('\n\n'), rows); return true;
  }
  if (action === 'person') {
    const person = catalog(store).find(person => person.id === value); if (!person) return true;
    dialogue.store.cancel(chat);
    store.put(chat, { ...session, admin_return_step: session.admin_return_step || session.step, step: 'admin_edit', admin_person: person.id });
    store.send(chat, `${person.name}\n${directoryRoleKk(person)}\n\n` + 'Жаңа аты-жөні; лауазымын жіберіңіз. Ортақ анықтамалық барлық адамға жаңартылады. Жеке байланыс деректері керек емес. /cancel — шығу.'); return true;
  }
  if (action === 'add') { store.send(chat, 'Қай бөлімге қосу керек?', [[{ text: '🎓 Басшылық', callback_data: 'admin:group:leadership' }], [{ text: '🏛 Декандар', callback_data: 'admin:group:deans' }, { text: '📚 Кафедралар', callback_data: 'admin:group:departments' }]]); return true; }
  if (action === 'group' && ['leadership', 'deans', 'departments'].includes(value)) {
    if (catalog(store).length >= 60) { store.send(chat, 'Анықтамалықта ең көбі 60 жазба болуы мүмкін.'); return true; }
    store.put(chat, { ...session, admin_return_step: session.admin_return_step || session.step, step: 'admin_add', admin_group: value });
    store.send(chat, 'Жаңа басшының аты-жөні; лауазымын жіберіңіз. Бұл жазба бәріне көрінеді.'); return true;
  }
  if (action === 'undo') {
    const undo = store.meta('directory_undo');
    if (!undo) store.send(chat, 'Бас тартатын өзгеріс жоқ.');
    else { store.setMeta('directory_overrides', undo.overrides); store.setMeta('directory_extra', undo.extra); store.setMeta('directory_undo', null); store.setMeta('directory_revision', store.meta('directory_revision', 0) + 1); store.send(chat, 'Анықтамалықтың соңғы өзгерісі қайтарылды.'); }
    return true;
  }
  if (action === 'close') { const next = restoreStep(session); store.put(chat, next); store.send(chat, 'Ботқа оралдыңыз. Жаңа тапсырма: /new'); return true; }
  if (!callback && session.step?.startsWith('admin_')) {
    const parts = text.split(';').map(part => part.trim());
    if (!validPerson(parts)) { store.send(chat, 'Үлгі: аты-жөні; лауазымы. Телефон не пошта қоспаңыз. Аты-жөні 120, лауазымы 200 таңбаға дейін.'); return true; }
    const overrides = store.meta('directory_overrides', {}), extra = store.meta('directory_extra', []);
    store.setMeta('directory_undo', { overrides, extra });
    if (session.step === 'admin_edit') {
      const person = catalog(store).find(person => person.id === session.admin_person); if (!person) return true;
      store.setMeta('directory_overrides', { ...overrides, [person.id]: { name: parts[0], nameKk: parts[0], role: parts[1], roleKk: importedRoleKk(parts[1], person), short: `${parts[1].slice(0, 22)} · ${parts[0].split(' ')[0]}`, degree: '', aliases: [parts[0].split(' ')[0].toLowerCase()] } });
    } else {
      const person = { id: 'extra_' + crypto.randomUUID().slice(0, 8), group: session.admin_group, name: parts[0], role: parts[1], roleKk: importedRoleKk(parts[1], { group: session.admin_group }), short: `${parts[1].slice(0, 22)} · ${parts[0].split(' ')[0]}`, aliases: [parts[0].split(' ')[0].toLowerCase()], source: 'owner' };
      store.setMeta('directory_extra', [...extra, person]);
    }
    store.setMeta('directory_revision', store.meta('directory_revision', 0) + 1);
    store.put(chat, restoreStep(session)); store.send(chat, 'Ортақ анықтамалық жаңартылды. Бұрын дайындалған мәтіндер сақталды.', [[{ text: '⬅️ Басқару панелі', callback_data: 'admin:open' }]]); return true;
  }
  return true;
}

import { catalog, choose } from './directory.js';
import { handleImport, clearImport } from './imports.js';

export const PUBLIC_COMMANDS = [
  ['start', 'Жұмысты бастау'], ['new', 'Жаңа мәтін жасау'], ['people', 'Басшылық пен кафедралар'], ['history', 'Соңғы нобайлар'], ['word', 'Word жүктеп алу'], ['pdf', 'PDF жүктеп алу'], ['program', 'Бағдарламаны құрастыру'], ['sheets', 'Ұйымдастырушыларға арналған парақтар'], ['check', 'Іс-шара алдындағы тексеріс'], ['help', 'Қолдану нұсқаулығы'], ['privacy', 'Деректерді өңдеу'], ['delete', 'Мәтіндерімді жою'], ['cancel', 'Ағымдағы тапсырмадан бас тарту'],
].map(([command, description]) => ({ command, description }));

export function ownerIdentity(store, env, chat, sender, claim = false) {
  if (!sender || sender.is_bot || !Number.isSafeInteger(sender.id) || sender.id !== chat) return false;
  const bound = store.meta('admin_owner_id');
  if (bound !== null) {
    if (bound === sender.id && claim) store.effect(chat, 'commands', { scope: { type: 'chat', chat_id: chat }, commands: [...PUBLIC_COMMANDS, { command: 'admin', description: 'Жеке басқару панелі' }] });
    return bound === sender.id;
  }
  const expected = String(env.BOT_OWNER_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (!claim || !expected || String(sender.username || '').toLowerCase() !== expected) return false;
  store.setMeta('admin_owner_id', sender.id);
  store.effect(chat, 'commands', { scope: { type: 'chat', chat_id: chat }, commands: [...PUBLIC_COMMANDS, { command: 'admin', description: 'Менің басқару панелім' }] });
  return true;
}

export function showAdmin(store, chat, session) {
  store.send(chat, choose(session, 'Админ-панель · доступ только владельцу\nЗдесь можно обновлять общий справочник и смотреть счётчики. Переписки других пользователей не показываются.', 'Админ-панель · тек иесіне ашық\nОртақ анықтамалықты өзгертіп, есептегіштерді көруге болады. Басқа пайдаланушылардың мәтіндері көрсетілмейді.', 'Owner-only admin panel. Update the shared directory and view counters; other users drafts are not shown.'), [
    [{ text: '📊 Статистика', callback_data: 'admin:stats' }],
    [{ text: '🎓 Ректор / проректоры', callback_data: 'admin:list:leadership' }],
    [{ text: '🏛 Деканы', callback_data: 'admin:list:deans' }, { text: '📚 Кафедры', callback_data: 'admin:list:departments' }],
    [{ text: '➕ Добавить в справочник', callback_data: 'admin:add' }],
    [{ text: '📤 Справочник из Word', callback_data: 'admin:import:directory' }, { text: '📚 Образцы сценариев', callback_data: 'admin:samples' }],
    [{ text: '↩️ Отменить последнее изменение', callback_data: 'admin:undo' }],
    [{ text: '⬅️ Вернуться к боту', callback_data: 'admin:close' }],
  ]);
}
const validPerson = parts => parts.length === 2 && parts.every(Boolean) && [...parts[0]].length <= 120 && [...parts[1]].length <= 200 && !/[@\d\n]/u.test(parts[0]) && !/[@\n]|https?:|\+?\d[\d ()-]{6,}/iu.test(parts[1]);
function restoreStep(session) { const next = { ...clearImport(session), step: session.admin_return_step || 'type' }; for (const key of ['admin_return_step', 'admin_person', 'admin_group']) delete next[key]; return next; }

export function handleAdmin(dialogue, chat, text, callback, command, owner, document = null) {
  const store = dialogue.store, session = store.get(chat);
  if (!document && command !== '/admin' && !callback.startsWith('admin:') && !(session.step?.startsWith('admin_') && !command && !callback)) return false;
  if (!owner) { store.send(chat, choose(session, 'Команда недоступна.', 'Бұл команда қолжетімсіз.', 'Command unavailable.')); return true; }
  const [action, value, pageRaw] = callback.slice(6).split(':');
  if (command === '/admin' || action === 'open') { if (session.step?.startsWith('admin_import_')) store.put(chat, restoreStep(session)); showAdmin(store, chat, store.get(chat)); return true; }
  if (handleImport(dialogue, chat, text, callback, document)) return true;
  if (action === 'stats') {
    const counts = store.counts(), pause = Math.max(0, Math.ceil((store.pauseUntil() - Date.now()) / 1000));
    store.send(chat, choose(session, 'Статистика', 'Статистика', 'Statistics') + `\nСессии: ${counts.sessions}\nЧерновики: ${counts.drafts}\nЗадания: ${counts.generation_jobs}\nОжидают отправки: ${counts.outbox}\nПауза провайдера: ${pause} сек.\nЗаписей в справочнике: ${catalog(store).length}`, [[{ text: '⬅️ Админ-панель', callback_data: 'admin:open' }]]); return true;
  }
  if (action === 'list' && ['leadership', 'deans', 'departments'].includes(value)) {
    const all = catalog(store).filter(person => person.group === value), page = Math.max(0, Math.min(Math.floor(Number(pageRaw) || 0), Math.floor(Math.max(0, all.length - 1) / 8))), people = all.slice(page * 8, page * 8 + 8);
    const rows = people.map(person => [{ text: person.short || person.name, callback_data: `admin:person:${person.id}` }]);
    if (all.length > 8) rows.push([{ text: '◀', callback_data: `admin:list:${value}:${Math.max(0, page - 1)}` }, { text: '▶', callback_data: `admin:list:${value}:${Math.min(Math.floor((all.length - 1) / 8), page + 1)}` }]);
    rows.push([{ text: '⬅️ Админ-панель', callback_data: 'admin:open' }]);
    store.send(chat, choose(session, 'Выберите запись для изменения:', 'Өзгертетін жазбаны таңдаңыз:', 'Choose an entry to edit:') + '\n\n' + people.map(person => `${person.roleKk || person.role}\n${person.name}`).join('\n\n'), rows); return true;
  }
  if (action === 'person') {
    const person = catalog(store).find(person => person.id === value); if (!person) return true;
    dialogue.store.cancel(chat);
    store.put(chat, { ...session, admin_return_step: session.admin_return_step || session.step, step: 'admin_edit', admin_person: person.id });
    store.send(chat, `${person.name}\n${person.roleKk || person.role}\n\n` + choose(session, 'Отправьте новое ФИО; должность. Это обновит общий справочник для всех. Личные контакты не нужны. /cancel — выйти.', 'Жаңа аты-жөні; лауазымын жіберіңіз. Ортақ анықтамалық барлық адамға жаңартылады. Жеке байланыс деректері керек емес. /cancel — шығу.', 'Send full name; role. This updates the shared directory. Do not include private contact details. /cancel to leave.')); return true;
  }
  if (action === 'add') { store.send(chat, choose(session, 'В какой раздел добавить?', 'Қай бөлімге қосу керек?', 'Choose a section:'), [[{ text: '🎓 Руководство', callback_data: 'admin:group:leadership' }], [{ text: '🏛 Деканы', callback_data: 'admin:group:deans' }, { text: '📚 Кафедры', callback_data: 'admin:group:departments' }]]); return true; }
  if (action === 'group' && ['leadership', 'deans', 'departments'].includes(value)) {
    if (catalog(store).length >= 60) { store.send(chat, 'Достигнут предел справочника: 60 записей.'); return true; }
    store.put(chat, { ...session, admin_return_step: session.admin_return_step || session.step, step: 'admin_add', admin_group: value });
    store.send(chat, choose(session, 'Отправьте ФИО; должность нового руководителя. Запись будет доступна всем.', 'Жаңа басшының аты-жөні; лауазымын жіберіңіз. Бұл жазба бәріне көрінеді.', 'Send full name; role for the new shared entry.')); return true;
  }
  if (action === 'undo') {
    const undo = store.meta('directory_undo');
    if (!undo) store.send(chat, choose(session, 'Изменений для отмены нет.', 'Бас тартатын өзгеріс жоқ.', 'No change to undo.'));
    else { store.setMeta('directory_overrides', undo.overrides); store.setMeta('directory_extra', undo.extra); store.setMeta('directory_undo', null); store.setMeta('directory_revision', store.meta('directory_revision', 0) + 1); store.send(chat, choose(session, 'Последнее изменение справочника отменено.', 'Анықтамалықтың соңғы өзгерісі қайтарылды.', 'Last directory change undone.')); }
    return true;
  }
  if (action === 'close') { const next = restoreStep(session); store.put(chat, next); store.send(chat, choose(session, 'Вернулись к боту. Новая задача: /new', 'Ботқа оралдыңыз. Жаңа тапсырма: /new', 'Back to the bot. New task: /new')); return true; }
  if (!callback && session.step?.startsWith('admin_')) {
    const parts = text.split(';').map(part => part.trim());
    if (!validPerson(parts)) { store.send(chat, choose(session, 'Формат: ФИО; должность. Без телефонов и почты. До 120 символов в ФИО и 200 в должности.', 'Үлгі: аты-жөні; лауазымы. Телефон не пошта қоспаңыз. Аты-жөні 120, лауазымы 200 таңбаға дейін.', 'Use full name; role, without contact details.')); return true; }
    const overrides = store.meta('directory_overrides', {}), extra = store.meta('directory_extra', []);
    store.setMeta('directory_undo', { overrides, extra });
    if (session.step === 'admin_edit') {
      const person = catalog(store).find(person => person.id === session.admin_person); if (!person) return true;
      store.setMeta('directory_overrides', { ...overrides, [person.id]: { name: parts[0], nameKk: parts[0], role: parts[1], roleKk: parts[1], short: `${parts[1].slice(0, 22)} · ${parts[0].split(' ')[0]}`, degree: '', aliases: [parts[0].split(' ')[0].toLowerCase()] } });
    } else {
      const person = { id: 'extra_' + crypto.randomUUID().slice(0, 8), group: session.admin_group, name: parts[0], role: parts[1], roleKk: parts[1], short: `${parts[1].slice(0, 22)} · ${parts[0].split(' ')[0]}`, aliases: [parts[0].split(' ')[0].toLowerCase()], source: 'owner' };
      store.setMeta('directory_extra', [...extra, person]);
    }
    store.setMeta('directory_revision', store.meta('directory_revision', 0) + 1);
    store.put(chat, restoreStep(session)); store.send(chat, choose(session, 'Общий справочник обновлён. История готовых текстов сохранена.', 'Ортақ анықтамалық жаңартылды. Бұрын дайындалған мәтіндер сақталды.', 'Shared directory updated. Existing drafts remain saved.'), [[{ text: '⬅️ Админ-панель', callback_data: 'admin:open' }]]); return true;
  }
  return true;
}

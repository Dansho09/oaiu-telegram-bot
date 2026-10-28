import { catalog } from './directory.js';
import { PRESETS, PROGRAM_LIBRARY } from './scenario.js';

// Interface language is independent of the language requested for generated text.
// Callback identifiers are protocol data and must never be translated.
const STATIC = {
  'type:speech': '🎤 Сөз сөйлеу', 'type:script': '🎭 Сценарий', 'type:announcement': '📣 Хабарландыру',
  'type:post': '📱 Жарияланым', 'type:thanks': '💐 Алғыс', 'type:kit': '📦 Іс-шараға толық жинақ',
  'length:1': 'Қысқа · ≈1 минут', 'length:3': 'Орташа · ≈3 минут', 'length:5': 'Толық · ≈5 минут',
  'tone:warm': 'Жылы', 'tone:formal': 'Салтанатты', 'tone:inspiring': 'Шабыттандыратын', 'tone:business': 'Іскерлік',
  'edit:short': '✂️ Қысқарту', 'edit:formal': '✨ Салтанатты ету', 'edit:thanks': '💐 Алғыс қосу',
  'edit:simple': '💬 Еркін стиль', 'edit:custom': '✏️ Өз түзетуім',
  'again:yes': '🔄 Басқа нұсқа', 'retry:yes': 'Қайталау', 'new:yes': '➕ Жаңа мәтін',
  'export:menu': '📄 Word / PDF / TXT жүктеу', 'export:docx': '📄 Word жүктеу', 'export:pdf': '📕 PDF жүктеу', 'export:txt': '📝 TXT жүктеу',
  'check:open': '✅ Сөз алдындағы тексеру', 'check:fix': '✏️ Деректерді нақтылау',
  'delete:confirm': 'Мәтіндерімді өшіру', 'delete:cancel': 'Бас тарту',
  'staff:open': '👥 Басшылық / қатысушылар', 'staff:all': '👥 Барлығы',
  'staff:leadership': '🎓 Ректор / проректорлар', 'staff:deans': '🏛 Декандар', 'staff:departments': '📚 Кафедралар',
  'staff:custom': '✍️ Өз қатысушым', 'staff:done': '✅ Жалғастыру', 'staff:none': 'Қатысушы қоспау',
  'event:config': '⚙️ Уақыт, жүргізушілер, сахна', 'event:duration': '⏱ Ұзақтығы', 'event:duration:custom': '✍️ Өз уақытым',
  'event:start': '🕓 Басталу уақыты', 'event:start:none': 'Нақты уақытсыз',
  'event:hosts': '🎙 Жүргізушілер', 'event:names': '✍️ Жүргізушілердің аты',
  'event:stage': '↔️ Шығу және түсу', 'event:profiles': '🎭 Іс-шара түрі',
  'event:stage:right_left': '➡️ Оңнан → солға', 'event:stage:left_right': '⬅️ Солдан → оңға',
  'event:stage:gym': '🏐 Сахнасыз спортзал', 'event:stage:custom': '✍️ Өз нұсқам',
  'program:open': '🧩 Бағдарлама құрастыру', 'sheet:menu': '👥 Командаға жеке парақтар',
  'sheet:sound': '🎚 Дыбыс режиссері', 'sheet:coordinator': '🎬 Үйлестіруші',
  'admin:open': '⚙️ Басқару панелі', 'admin:stats': '📊 Көрсеткіштер', 'admin:add': '➕ Анықтамалыққа қосу',
  'admin:import:directory': '📤 Word-тен анықтамалық', 'admin:import:sample': '📤 Word үлгісін жүктеу',
  'admin:samples': '📚 Сценарий үлгілері', 'admin:samples_undo': '↩️ Үлгілердің соңғы өзгерісін қайтару',
  'admin:undo': '↩️ Соңғы өзгерісті қайтару', 'admin:close': '⬅️ Ботқа оралу',
};
const LANGUAGES = { kk: 'Қазақша', ru: 'Орысша', en: 'Ағылшынша' };
const GROUPS = { leadership: '🎓 Басшылық', deans: '🏛 Декандар', departments: '📚 Кафедралар' };
const PROGRAM_ACTIONS = {
  add: '➕ Бөлім қосу', done: '✅ Бағдарламаны сақтау', cancel: '↩️ Өзгерістерді қайтару',
  back: '⬅️ Бағдарламаға', time: '⏱ Бөлім уақыты', rename: '✏️ Атауы', up: '⬆️ Жоғары', down: '⬇️ Төмен',
  remove: '🗑 Бөлімді өшіру', samples: '📚 Иесінің үлгілері', custom: '✍️ Өз бөлімім',
};
const SAMPLE_TITLES = {
  'День учителя': 'Ұстаздар күні', 'Посвящение в студенты': 'Студенттік арнау кеші',
  'Волейбольный турнир': 'Волейбол жарысы', 'Спортивное мероприятие': 'Спорттық іс-шара', 'Спортивное событие': 'Спорттық іс-шара', 'Мероприятие': 'Іс-шара',
  'Университетское мероприятие': 'Университет іс-шарасы', 'Сценарий мероприятия': 'Іс-шара сценарийі',
};
const trim = (value, length) => [...String(value || '')].slice(0, length).join('');
const compactRole = role => {
  if ([...role].length <= 32) return role;
  const shortened = trim(role, 31), end = shortened.lastIndexOf(' ');
  return (end > 18 ? shortened.slice(0, end) : shortened) + '…';
};
function personCaption(id, session, store, selected) {
  const person = catalog(store).find(person => person.id === id) || session.custom_people?.find(person => person.id === id);
  if (!person) return 'Қатысушы';
  const name = String(person.nameKk || person.name || '').trim().split(/\s+/u);
  const initials = name.slice(1).map(part => [...part][0] + '.').join(' ');
  const shortName = [name[0], initials].filter(Boolean).join(' ');
  let role = String(person.roleKk || '').replace(/\s+кафедрасының меңгерушісі$/u, '').replace(/\s+факультетінің деканы$/u, ' деканы');
  // Uploaded role names are user data; if no Kazakh translation is available,
  // keep the verified name and display the Kazakh category rather than a Russian UI role.
  if (!role || /заведующ|проректор по|декан факультета|декан .*факультета|руководител|начальник|head of|dean of|rector of/iu.test(role)) {
    role = person.group === 'departments' ? 'Кафедра меңгерушісі' : person.group === 'deans' ? 'Декан' : person.id === 'rector' ? 'Ректор' : person.group === 'leadership' ? 'Басшылық' : 'Қатысушы';
  }
  return `${selected ? '✅ ' : ''}${compactRole(role)} · ${trim(shortName, 29)}`;
}
function label(button, session, store) {
  const callback = String(button.callback_data || ''), [kind, action, value, item] = callback.split(':');
  if (Object.hasOwn(STATIC, callback)) return STATIC[callback];
  if (kind === 'language' || kind === 'translate') return LANGUAGES[action] || 'Тілді таңдау';
  if (kind === 'history') return button.text; // A draft title belongs to the user, not the interface.
  if (kind === 'person') return personCaption(action, session, store, (session.people || []).includes(action));
  if (kind === 'event') {
    if (action === 'ready') return session.script_editing ? '✅ Сценарийді жаңарту' : '✅ Жалғастыру';
    if (action === 'profile') return PRESETS[value]?.title[1] || 'Іс-шараны таңдау';
    if (action === 'duration' && /^\d+$/.test(value || '')) {
      const minutes = Number(value);
      return minutes >= 60 && minutes % 30 === 0 ? `${String(minutes / 60).replace('.', ',')} сағат` : `${minutes} минут`;
    }
    if (action === 'hosts' && /^[1-4]$/.test(value || '')) return `${value} жүргізуші`;
  }
  if (kind === 'sheet' && /^host_[1-4]$/.test(action || '')) {
    const number = Number(action.slice(5)), context = session.result_context || session, name = context.host_names?.[number - 1];
    return `🎤 Жүргізуші ${number}${name ? ' · ' + trim(name, 36) : ''}`;
  }
  if (kind === 'sheetdoc') return STATIC[`export:${action}`] || 'Парақты жүктеу';
  if (kind === 'admin') {
    if (action === 'list' || action === 'group') {
      if (action === 'list' && item !== undefined && /^[◀▶←→]/u.test(button.text || '')) return button.text;
      return GROUPS[value] || 'Бөлімді таңдау';
    }
    if (action === 'person') return personCaption(value, session, store, false);
    if (action === 'import_confirm') return '✅ Растау және жариялау';
    if (action === 'import_cancel') return '❌ Бас тарту';
  }
  if (kind === 'program') {
    if (Object.hasOwn(PROGRAM_ACTIONS, action)) return PROGRAM_ACTIONS[action];
    if (action === 'pick') return PROGRAM_LIBRARY[item]?.[1] || 'Бөлімді таңдау';
    if (action === 'view') {
      const index = session.program_blocks?.findIndex(block => block.id === item) ?? -1, block = session.program_blocks?.[index];
      return block ? `${index + 1}. ${trim(block.titles?.[1] || block.titles?.[0], 36)} · ${block.minutes} минут` : 'Бағдарлама бөлімі';
    }
    if (action === 'use') {
      const samples = store?.meta('approved_samples', []) || [], sample = Array.isArray(samples) ? samples.find(sample => sample.id === item) : null;
      if (sample) return trim(sample.titleKk || SAMPLE_TITLES[sample.title] || PRESETS[sample.preset]?.title[1] || 'Іс-шара үлгісі', 50);
      return 'Іс-шара үлгісі';
    }
  }
  // New controls get a safe Kazakh label until a specific translation is added.
  // User-entered content is preserved only in explicitly data-bearing branches above.
  return button.url || button.web_app ? 'Ашу' : 'Таңдау';
}
export function localizeButtons(buttons, session = {}, store = null) {
  if (!Array.isArray(buttons)) return buttons;
  return buttons.map(row => row.map(button => ({ ...button, text: label(button, session, store) })));
}

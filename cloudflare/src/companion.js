import { choose } from './directory.js';
import { clockLabel, stageDescription, timelineText } from './scenario.js';
const HOME_BUTTONS = [[{ text: '🏠 Басты мәзір', callback_data: 'nav:home' }]];

const button = (text, callback_data) => ({ text, callback_data });
const uiChoose = (_session, _ru, kk) => kk;
const RESULT_FIELDS = ['format', 'language', 'brief', 'tone', 'length', 'event_preset', 'event_minutes', 'event_start', 'host_count', 'host_names', 'stage_key', 'stage_note', 'program_blocks', 'script_data', 'people', 'custom_people', 'directory_people', 'reference_date', 'reference_sample', 'event_fact_evidence', 'confirmed_prizes', 'locked_fragments', 'guest_records', 'guest_statuses', 'emergency_state', 'tournament', 'awards_data'];

// A saved text and its attachments always use the settings it was generated with.
export function captureResultContext(session) {
  return Object.fromEntries(RESULT_FIELDS.filter(key => session[key] !== undefined).map(key => [key, structuredClone(session[key])]));
}
export function resultSession(session) {
  return session.result_context ? { ...session.result_context, result: session.result } : session;
}
export function roleTitle(session, role) {
  const number = /^host_([1-4])$/.exec(role)?.[1];
  if (number) return choose(session, `Ведущий ${number}`, `Жүргізуші ${number}`, `Host ${number}`) + (session.host_names?.[Number(number) - 1] ? ` · ${session.host_names[Number(number) - 1]}` : '');
  return role === 'sound' ? choose(session, 'Звукорежиссёр', 'Дыбыс режиссері', 'Sound operator') : choose(session, 'Координатор', 'Үйлестіруші', 'Coordinator');
}
function soundCue(s, block) {
  const title = block.title || '';
  if (/гимн|әнұран|anthem/iu.test(title)) return choose(s, 'Гимн: заранее подтвердить фонограмму. Запуск после объявления ведущего и сигнала координатора; после завершения убрать фон, подготовить микрофон.', 'Әнұран: фонограмманы алдын ала растау. Жүргізуші хабарлап, үйлестіруші белгі бергенде қосу; аяқталған соң фонды өшіріп, микрофонды дайындау.', 'Anthem: confirm the recording beforehand. Start after the host announcement and coordinator cue; stop the backing when it finishes and ready the microphone.');
  if (/танец|би$|dance|творческ|шығармашылық|performance|концерт/iu.test(title)) return choose(s, 'Творческий номер: сверить название и версию фонограммы с исполнителем. По сигналу координатора запустить согласованный трек; после номера вернуть микрофон ведущим. Если номер без записи — фон не включать.', 'Өнер нөмірі: фонограмма атауы мен нұсқасын орындаушымен келісу. Үйлестіруші белгі бергенде келісілген тректі қосу; соңынан микрофонды жүргізушілерге беру. Жазбасыз нөмір болса, фон қоспау.', 'Performance: confirm the track and version with the performer. Play it on the coordinator cue, then return audio to the hosts. Do not play backing for an unaccompanied act.');
  if (/видео|бейне|video/iu.test(title)) return choose(s, 'Видео: проверить звук ролика и согласовать запуск с оператором экрана. По окончании отключить звук ролика, подготовить микрофон ведущего.', 'Бейне: ролик дыбысын тексеріп, экран операторымен қосу сәтін келісу. Аяқталған соң ролик дыбысын өшіріп, жүргізуші микрофонын дайындау.', 'Video: check its audio and coordinate playback with the screen operator. After it ends, stop video audio and ready the host microphone.');
  if (/матч|соревн|жарыс|matches|competition/iu.test(title)) return choose(s, 'Соревнование: не перекрывать свисток и команды судьи музыкой. Объявления — в согласованных паузах после сигнала судьи.', 'Жарыс: музыка төрешінің ысқырығы мен пәрмендерін басып кетпесін. Хабарландыруларды төреші белгі бергеннен кейін келісілген үзілісте айту.', 'Competition: keep official calls and whistles audible. Make announcements only during agreed breaks after the official cue.');
  return choose(s, 'Передать микрофон по порядку выступлений, если он используется. Во время речи убрать фон; следующий аудиосигнал — только по команде координатора.', 'Микрофон қолданылса, сөйлеу ретімен беру. Сөз кезінде фонды өшіру; келесі дыбыс белгісін тек үйлестіруші пәрменімен қосу.', 'Hand over the microphone in speaking order if used. Remove background audio during speeches; play the next cue only on the coordinator instruction.');
}
export function roleSheet(session, role) {
  const s = resultSession(session), blocks = s.script_data?.blocks;
  if (s.format !== 'script' || !Array.isArray(blocks) || !blocks.length) return null;
  if (!['sound', 'coordinator', ...Array.from({ length: s.host_count || 2 }, (_, i) => `host_${i + 1}`)].includes(role)) return null;
  const absolute = Number.isInteger(s.event_start), offset = absolute ? s.event_start : 0;
  const header = `${roleTitle(s, role)}\n\n${timelineText(s)}`;
  const body = blocks.map((block, index) => {
    const time = `${clockLabel(block.start + offset, absolute)}–${clockLabel(block.end + offset, absolute)}`;
    let content;
    if (role.startsWith('host_')) content = [block.cue, block.lines?.[role] || choose(s, 'В этом блоке вашей реплики нет. Ожидайте сигнала.', 'Бұл бөлімде репликаңыз жоқ. Белгі күтіңіз.', 'No line for you in this segment. Wait for the cue.')].filter(Boolean).join('\n\n');
    else if (role === 'sound') content = soundCue(s, block);
    else content = [block.cue || stageDescription(s), ...(block.notes || []), choose(s, 'Подтвердить готовность участников этого блока; дать ведущим и звуку сигнал начала, затем сигнал перехода.', 'Осы бөлім қатысушыларының дайындығын растау; жүргізушілер мен дыбыс режиссеріне басталу және ауысу белгісін беру.', 'Confirm participants are ready, then cue the hosts and sound operator for the start and transition.')].filter(Boolean).join('\n');
    return `${index + 1}. ${block.title} · ${time}\n\n${content}`;
  }).join('\n\n');
  return `${header}\n\n${body}`;
}

export function preflight(session) {
  const s = resultSession(session), text = s.result || '', facts = `${s.brief || ''}\n${text}`, issues = [];
  const placeholders = [...new Set([...text.matchAll(/\[([^\]\n]{1,160})\]/gu)].map(m => m[1].trim()).filter(value =>
    /уточн|заполн|назван|имя|фио|дата|место|награждающ|согласованн.*наград|судь|команд|атауы|аты.?жөні|күні|орны|марапаттаушы|келісілген марапат|төреші|толтыр|нақтыла|name|date|venue|presenter|confirmed awards|team|insert|tbd/iu.test(value)
    && !/^(?:ремарка|stage cue|приветственные выступления|құттықтау сөздерге|welcome addresses)/iu.test(value)))];
  if (placeholders.length) issues.push(uiChoose(s, 'Заполнить места в тексте: ', 'Мәтіндегі орындарды толтыру: ', 'Fill the placeholders: ') + placeholders.map(p => `[${p}]`).join('; '));
  if (!/(?:\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b|\b20\d{2}-\d{2}-\d{2}\b|\d{1,2}\s+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр|қаңтар|ақпан|наурыз|сәуір|мамыр|маусым|шілде|тамыз|қыркүйек|қазан|қараша|желтоқсан)|завтра|сегодня|ертең|бүгін|tomorrow|today|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d)/iu.test(facts)) issues.push(uiChoose(s, 'Дата: в задании и тексте не найдена — уточните день мероприятия.', 'Күні: тапсырма мен мәтінде табылмады — іс-шара күнін нақтылаңыз.', 'Date not found in the brief or text; confirm the event date.'));
  if (!/(?:место\s*[:—-]\s*\S|в\s+(?:актовом|спортивном|конференц|зале|аудитории|спортзале)|спортзал|актовый зал|venue\s*[:—-]|at\s+.{0,40}(?:hall|gym|auditorium)|өтетін\s+орны\s*[:—-]|мәжіліс\s+зал|акт\s+зал|спорт\s*зал|аудитория\s*\d)/iu.test(facts)) issues.push(uiChoose(s, 'Место: не удалось уверенно определить — проверьте площадку и адрес.', 'Орны: нақты анықталмады — алаң мен мекенжайды тексеріңіз.', 'Venue could not be identified reliably; check the location and address.'));
  if (s.format === 'script' && !Number.isInteger(s.event_start)) issues.push(uiChoose(s, 'Не задано время начала: тайминг считается от 00:00.', 'Басталу уақыты берілмеген: уақыт 00:00-ден есептеледі.', 'Start time is unset; timings are relative to 00:00.'));
  if (s.format === 'script' && (!s.host_names || s.host_names.length !== (s.host_count || 2))) issues.push(uiChoose(s, 'Имена ведущих не указаны — в листах останутся номера ролей.', 'Жүргізушілердің аты жоқ — парақтарда рөл нөмірі қалады.', 'Host names are unset; cue sheets will use role numbers.'));
  const heading = uiChoose(s, 'ПРОВЕРКА ПЕРЕД ВЫСТУПЛЕНИЕМ', 'СӨЗ АЛДЫНДАҒЫ ТЕКСЕРУ', 'PRE-EVENT CHECK');
  const summary = issues.length ? issues.map((item, i) => `${i + 1}. ${item}`).join('\n\n') : uiChoose(s, 'Явных пропусков не найдено.', 'Айқын бос орындар табылмады.', 'No obvious omissions found.');
  return { issues, text: `${heading}\n\n${summary}\n\n` + uiChoose(s, 'Это проверка явных пропусков. Перед печатью подтвердите ФИО, должности, участие гостей, регламент и порядок награждения у организатора.', 'Бұл айқын бос орындарды тексеру. Басып шығару алдында аты-жөнін, лауазымдарды, қонақтардың қатысуын, регламент пен марапаттау тәртібін ұйымдастырушымен растаңыз.', 'This checks obvious omissions. Before printing, confirm names, roles, guest attendance, rules and awards with the organizer.') };
}

export function handleCompanion(dialogue, chat, text, callback, command) {
  if (command || !/^(export|sheet|sheetdoc|check):/.test(callback)) return false;
  const store = dialogue.store, session = store.get(chat), s = resultSession(session);
  if (!s.result) { store.send(chat, uiChoose(s, 'Сначала создайте текст: /new', 'Алдымен «Басты мәзірден» мәтін дайындаңыз.', 'Create a text first: /new'), HOME_BUTTONS); return true; }
  const [kind, action, role] = callback.split(':');
  if (kind === 'check') {
    if (action === 'fix' && session.step !== 'ready') {
      store.send(chat, uiChoose(s, 'Сначала завершите или отмените текущую настройку программы, затем нажмите «Уточнить данные» под проверкой готового текста.', 'Алдымен бағдарлама баптауын аяқтаңыз не өзгерістерден бас тартыңыз, содан кейін дайын мәтіннің тексеруінен «Деректерді нақтылау» батырмасын басыңыз.', 'Finish or cancel the current settings first, then select Correct details for the finished text.'));
      return true;
    }
    if (action === 'fix') store.send(chat, uiChoose(s, 'Напишите одним сообщением недостающие данные и что заменить. Например: «Дата — 30 октября, место — актовый зал, награждает ректор». Я обновлю текст, после чего можно проверить его снова.', 'Жетіспейтін деректер мен өзгерістерді бір хабарламада жазыңыз. Мысалы: «Күні — 30 қазан, орны — мәжіліс залы, марапаттаушы — ректор». Мәтінді жаңартып, қайта тексеруге болады.', 'Send missing facts and corrections in one message. I will update the text so you can check it again.'));
    else store.send(chat, preflight(session).text, [[button(uiChoose(s, '✏️ Уточнить данные', '✏️ Деректерді нақтылау', '✏️ Correct details'), 'check:fix')], [button('📄 Word / PDF', 'export:menu')]]);
    return true;
  }
  if (kind === 'sheet') {
    if (s.format !== 'script' || !s.script_data?.blocks?.length) { store.send(chat, uiChoose(s, 'Для отдельных листов создайте новый сценарий: /new → Сценарий. Старый текст останется в истории.', 'Жеке парақтар «Сценарий» форматына арналған. «Басты мәзірден» жаңа сценарий дайындаңыз. Дайын мәтін тарихта сақталады.', 'Create a new script for separate cue sheets: /new → Script. Your existing text stays in history.'), HOME_BUTTONS); return true; }
    if (action === 'menu') {
      store.send(chat, uiChoose(s, 'Чей лист подготовить? Файл получаете вы и можете переслать участнику.', 'Кімнің парағын дайындаймыз? Файлды өзіңіз алып, қатысушыға жібере аласыз.', 'Whose cue sheet? You receive the file and can forward it.'), [...Array.from({ length: s.host_count || 2 }, (_, i) => [button(roleTitle(s, `host_${i + 1}`), `sheet:host_${i + 1}`)]), [button(roleTitle(s, 'sound'), 'sheet:sound'), button(roleTitle(s, 'coordinator'), 'sheet:coordinator')]]);
    } else {
      const sheet = roleSheet(session, action); if (!sheet) return true;
      store.send(chat, sheet, [[button('📄 Word', `sheetdoc:docx:${action}`), button('📕 PDF', `sheetdoc:pdf:${action}`)], [button(uiChoose(s, '👥 Другой участник', '👥 Басқа қатысушы', '👥 Another role'), 'sheet:menu')]]);
    }
    return true;
  }
  if (kind === 'export' && action === 'menu') {
    store.send(chat, uiChoose(s, 'Скачать текущий готовый текст:', 'Дайын мәтінді жүктеу:', 'Download the current finished text:'), [[button('📄 Word', 'export:docx'), button('📕 PDF', 'export:pdf'), button('📝 TXT', 'export:txt')]]); return true;
  }
  if (['docx', 'pdf', 'txt'].includes(action)) {
    const content = kind === 'sheetdoc' ? roleSheet(session, role) : s.result;
    if (!content) return true;
    const title = kind === 'sheetdoc' ? roleTitle(s, role) : uiChoose(s, s.format === 'script' ? 'Сценарий мероприятия OAIU' : 'Текст для мероприятия OAIU', s.format === 'script' ? 'OAIU іс шарасының сценарийі' : 'OAIU іс шарасына арналған мәтін', s.format === 'script' ? 'OAIU event script' : 'OAIU event text');
    const pending = store.rows("SELECT payload FROM outbox WHERE chat_id=? AND kind='document'", chat).some(row => { const p = JSON.parse(row.payload); return p.text === content && (p.format || 'txt') === action; });
    if (!pending) store.effect(chat, 'document', { chat_id: chat, text: content, format: action, title });
  }
  return true;
}

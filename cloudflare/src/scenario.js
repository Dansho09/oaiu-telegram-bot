import { choose, selectedPeople, personName, personRole } from './directory.js';

export const isScenario = s => ['script', 'kit'].includes(s.format);
export const PRESETS = {
  volleyball: { title: ['Волейбольный турнир', 'Волейбол жарысы', 'Volleyball tournament'], blocks: [
    [5, 'Открытие', 'Ашылу', 'Opening'], [5, 'Приветственное слово', 'Құттықтау сөз', 'Welcome address'], [8, 'Представление команд', 'Командаларды таныстыру', 'Team introductions'], [5, 'Регламент и безопасность', 'Регламент және қауіпсіздік', 'Format and safety'], [8, 'Разминка', 'Қыздыру жаттығулары', 'Warm-up'], [48, 'Матчи · время ориентировочное', 'Матчтар · уақыт шамамен', 'Matches · estimated time'], [5, 'Резерв и перерыв', 'Үзіліс пен резерв', 'Break and buffer'], [11, 'Награждение', 'Марапаттау', 'Awards'], [5, 'Закрытие', 'Жабылу', 'Closing'],
  ] },
  sport: { title: ['Другое спортивное событие', 'Басқа спорттық іс-шара', 'Other sports event'], blocks: [
    [5, 'Открытие', 'Ашылу', 'Opening'], [8, 'Приветствие и участники', 'Құттықтау және қатысушылар', 'Welcome and participants'], [10, 'Правила и разминка', 'Ережелер және қыздыру', 'Rules and warm-up'], [52, 'Соревнования · время ориентировочное', 'Жарыс · уақыт шамамен', 'Competition · estimated time'], [8, 'Резерв и перерыв', 'Үзіліс пен резерв', 'Break and buffer'], [12, 'Награждение', 'Марапаттау', 'Awards'], [5, 'Закрытие', 'Жабылу', 'Closing'],
  ] },
  teachers: { title: ['День учителя', 'Ұстаздар күні', "Teachers' Day"], blocks: [
    [6, 'Открытие и приветствие', 'Ашылу және сәлемдесу', 'Opening and greeting'], [8, 'Слово руководства', 'Басшылықтың құттықтауы', 'Leadership address'], [18, 'Награждение преподавателей', 'Ұстаздарды марапаттау', 'Teacher awards'], [36, 'Творческая программа', 'Шығармашылық бағдарлама', 'Performances'], [12, 'Интерактив', 'Интерактив', 'Interactive segment'], [8, 'Общее фото', 'Естелік сурет', 'Group photo'], [6, 'Резерв', 'Резерв', 'Buffer'], [6, 'Завершение', 'Қорытынды', 'Closing'],
  ] },
  dedication: { title: ['Посвящение в студенты', 'Студенттік арнау кеші', 'Student induction'], blocks: [
    [5, 'Открытие', 'Ашылу', 'Opening'], [7, 'Приветствие руководства', 'Басшылық құттықтауы', 'Leadership welcome'], [15, 'Церемония посвящения', 'Арнау рәсімі', 'Induction ceremony'], [35, 'Творческая программа', 'Шығармашылық бағдарлама', 'Performances'], [10, 'Интерактив', 'Интерактив', 'Interactive segment'], [10, 'Награждение', 'Марапаттау', 'Awards'], [8, 'Общее фото', 'Естелік сурет', 'Group photo'], [5, 'Резерв', 'Резерв', 'Buffer'], [5, 'Завершение', 'Қорытынды', 'Closing'],
  ] },
  general: { title: ['Другое мероприятие', 'Басқа іс-шара', 'Other event'], blocks: [
    [5, 'Открытие', 'Ашылу', 'Opening'], [10, 'Приветственное слово', 'Құттықтау сөз', 'Welcome address'], [50, 'Основная программа', 'Негізгі бағдарлама', 'Main program'], [10, 'Перерыв или интерактив', 'Үзіліс не интерактив', 'Break or interaction'], [10, 'Подведение итогов', 'Қорытындылау', 'Results'], [5, 'Общее фото', 'Естелік сурет', 'Group photo'], [5, 'Резерв', 'Резерв', 'Buffer'], [5, 'Закрытие', 'Жабылу', 'Closing'],
  ] },
};
export const STAGES = {
  right_left: ['Вход справа, уход слева; стороны указаны со стороны зрителей.', 'Көрерменге қатысты: оң жақтан шығу, сол жақтан түсу.', 'Enter from audience right, exit to audience left.'],
  left_right: ['Вход слева, уход справа; стороны указаны со стороны зрителей.', 'Көрерменге қатысты: сол жақтан шығу, оң жақтан түсу.', 'Enter from audience left, exit to audience right.'],
  gym: ['Спортзал без сцены: ведущие у судейского столика, участников приглашают на площадку; проходы и игровую зону не перекрывать.', 'Сахнасыз спортзал: жүргізушілер төреші үстелінің жанында, қатысушылар алаңға шақырылады; өту жолы мен ойын алаңы бос қалады.', 'Sports hall without a stage: hosts beside the officials table; invite participants onto the court, keeping access and playing areas clear.'],
};
const localized = (s, list) => list[s.language === 'kk' ? 1 : s.language === 'en' ? 2 : 0];
const btn = (text, callback_data) => ({ text, callback_data });
export const validMinutes = n => Number.isInteger(n) && n >= 15 && n <= 480;
export function parseDuration(text) {
  text = String(text).trim().toLowerCase().replace(',', '.');
  const clock = text.match(/^(\d{1,2}):([0-5]\d)$/);
  let result;
  if (clock) result = Number(clock[1]) * 60 + Number(clock[2]);
  else {
    const hours = text.match(/^(\d+(?:\.\d+)?)\s*(?:ч(?:ас(?:а|ов)?)?\.?|сағат(?:тық)?|h(?:ours?)?)(?:\s+(\d+)\s*(?:мин(?:ут[а-я]*)?|минут|m(?:in)?))?$/u);
    const minutes = text.match(/^(\d+)\s*(?:мин(?:ут[а-я]*)?\.?|минут|m(?:in(?:utes?)?)?)?$/u);
    if (hours) result = Number(hours[1]) * 60 + Number(hours[2] || 0);
    else if (minutes) result = Number(minutes[1]);
  }
  return validMinutes(result) ? result : null;
}
export function mentionedDuration(text) {
  const match = String(text).match(/(\d+(?:[.,]\d+)?)\s*(сағат(?:тық)?|час(?:а|ов)?|hours?|минут[а-я]*|мин\.?|minutes?)/iu);
  if (!match || /через\s*$/iu.test(text.slice(0, match.index)) || /^(?:тан|тен|дан|ден)?\s*кейін/u.test(text.slice(match.index + match[0].length))) return null;
  return parseDuration(match[1] + ' ' + match[2]);
}
export function parseStart(text) {
  const match = String(text).trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}
export function inferPreset(text) {
  return /волейбол|volleyball/iu.test(text) ? 'volleyball' : /ұстаз|учител|teachers?.?day/iu.test(text) ? 'teachers' : /арнау|посвящени|induction/iu.test(text) ? 'dedication' : /жарыс|турнир|соревнова|tournament|competition/iu.test(text) ? 'sport' : 'general';
}
export function scenarioChange(session, instruction) {
  if (!isScenario(session) || !instruction) return session;
  const changed = { ...session }, minutes = mentionedDuration(instruction);
  if (minutes && /на\s+\d|сделай|сократи|уменьши|растяни|длительност|ұзақты|сағаттық|ұзарт|қысқарт|duration|length/iu.test(instruction)) {
    const delta = /(?:сократи|уменьши)[^.!?\n]{0,20}\sна\s+\d/iu.test(instruction);
    const result = delta && validMinutes(session.event_minutes) ? session.event_minutes - minutes : minutes;
    if (validMinutes(result)) changed.event_minutes = result;
  }
  const time = instruction.match(/(?:^|\s)(\d{1,2}:\d{2})(?:\s|$|[.,])/u);
  if (time && /начал|бастал|start/iu.test(instruction) && parseStart(time[1]) !== null) changed.event_start = parseStart(time[1]);
  const hosts = instruction.match(/([1-4])\s*(?:ведущ|жүргізуш|hosts?)/iu);
  if (hosts) { changed.host_count = Number(hosts[1]); if (changed.host_names?.length !== changed.host_count) delete changed.host_names; }
  if (/справа|слева|оң\s*жақ|сол\s*жақ/iu.test(instruction) && /выход|уход|вход|шығ|түс|кір/iu.test(instruction)) { changed.stage_key = 'custom'; changed.stage_note = instruction.slice(0, 500); }
  return changed;
}
export function stageDescription(session) { return session.stage_key === 'custom' ? session.stage_note || '[Уточнить выход и уход]' : localized(session, STAGES[session.stage_key] || STAGES.right_left); }
export function timeline(session) {
  if (!validMinutes(session.event_minutes)) return [];
  const blocks = (PRESETS[session.event_preset] || PRESETS.general).blocks, remaining = session.event_minutes - blocks.length, total = blocks.reduce((sum, block) => sum + block[0], 0);
  const parts = blocks.map((block, index) => ({ index, minutes: 1 + Math.floor(remaining * block[0] / total), fraction: remaining * block[0] / total % 1 }));
  const leftovers = session.event_minutes - parts.reduce((sum, part) => sum + part.minutes, 0);
  [...parts].sort((a, b) => b.fraction - a.fraction || a.index - b.index).slice(0, leftovers).forEach(part => part.minutes++);
  let elapsed = 0;
  return parts.map(part => { const row = { title: localized(session, blocks[part.index].slice(1)), minutes: part.minutes, start: elapsed, end: elapsed + part.minutes }; elapsed = row.end; return row; });
}
export function clockLabel(minutes, absolute = false) {
  const day = absolute ? Math.floor(minutes / 1440) : 0, value = absolute ? minutes % 1440 : minutes;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}${day ? ` (+${day})` : ''}`;
}
export function timelineText(session) {
  const plan = timeline(session); if (!plan.length) return '';
  const absolute = Number.isInteger(session.event_start), offset = absolute ? session.event_start : 0;
  const title = choose(session, 'ПЛАН МЕРОПРИЯТИЯ', 'ІС-ШАРА ЖОСПАРЫ', 'EVENT PLAN');
  const count = session.host_count || 2;
  const hostLine = choose(session, `Ведущих: ${count}`, `Жүргізуші саны: ${count}`, `Hosts: ${count}`) + (session.host_names?.length === count ? ` · ${session.host_names.join('; ')}` : '');
  const label = choose(session, absolute ? 'Время начала: ' : 'Отсчёт от начала: ', absolute ? 'Басталуы: ' : 'Басталғаннан есеп: ', absolute ? 'Starts: ' : 'Elapsed from start: ');
  return `⏱ ${title} · ${session.event_minutes} ${choose(session, 'мин', 'минут', 'minutes')}\n${label}${clockLabel(offset)}\n${hostLine}\n${stageDescription(session)}\n\n`
    + plan.map(row => `${clockLabel(row.start + offset, absolute)}–${clockLabel(row.end + offset, absolute)} · ${row.title} (${row.minutes} ${choose(session, 'мин', 'мин', 'min')})`).join('\n');
}
export function scenarioPrompt(session) {
  if (!isScenario(session)) return '';
  const profile = session.event_preset || inferPreset(session.brief || '');
  let style = 'Университетский сценарий: открытие → приветствие → основная часть → итоги → закрытие. Для каждого блока: реплика, переход, сценическая и техническая ремарка.';
  if (profile === 'teachers') style = 'Структура пользовательского образца «Ұстаздар күні»: открытие/флешмоб, чередующиеся реплики ведущих, приглашение ректора, поздравление, награждение, концерт и интерактив, общее фото, тёплый финал. Сохраняй живые переходы и уместный юмор. Не переноси имена награждаемых, исполнителей, песни или организации из образца без данных организатора.';
  if (profile === 'dedication') style = 'Структура пользовательского образца «Арнау кеші»: приветствие первокурсников, представление выбранных гостей, официальное открытие, условная церемония посвящения, творческие блоки, интерактив, награждение, финал. Ключ знаний, клятва, кубок, QR-голосование и выступления добавляются только по заданию организатора; в противном случае оставь нейтральную церемонию.';
  if (['volleyball', 'sport'].includes(profile)) style = 'Спортивное событие: открытие, приветствие, представление команд, слово главного судьи, согласованный регламент и безопасность, разминка, матчевые блоки, награждение, закрытие. Во время игр нужны только короткие объявления и переходы, не непрерывная речь. Не выдумывай команды, судей, победителей, результаты, число сетов или официальный формат. Матчевое время — оценка; предусмотрен резерв, фактическую длительность матчей согласуют с судьями.';
  const plan = timelineText(session);
  const hosts = Array.from({ length: session.host_count || 2 }, (_, i) => `Ведущий ${i + 1}${session.host_names?.[i] ? ` — ${session.host_names[i]}` : ''}`).join('; ');
  return `\nРЕЖИССЁРСКИЕ ПАРАМЕТРЫ\n${style}\n${plan || 'Длительность мероприятия ещё не задана: не утверждай точное время окончания.'}\nРоли: ${hosts}. Используй только это число ведущих; обозначай их на языке результата. Стороны сцены всегда определяются с точки зрения зрителей, а не исполнителя.\nДля каждого блока напиши готовые реплики и отдельные ремарки: кто выходит, откуда, куда проходит, когда уходит; музыка/микрофон/свет/экран, если уместны. Не требуй сцены в режиме спортзала. Не добавляй обязательное оборудование без данных.\nДлительность мероприятия не равна длине текста ведущих. Точные интервалы плана сохранены отдельно: повторять таблицу/список тайминга в ответе не нужно, пиши сценарную часть по тем же блокам. Общая сумма временных блоков уже рассчитана, не меняй её. Если время не вмещает полноценный турнир, укажи это кратко в сценарной части и не обещай завершить матчи по секундомеру.\nЗакончить: короткий технический список подготовки и план Б на задержку/отказ музыки, без новых фактов.`;
}
export function scenarioBody(text) {
  const marker = String(text).match(/^⏱[\s\S]*?\n\n🎬 [^\n]+\n\n/);
  return marker ? text.slice(marker[0].length) : text;
}
export function renderScenario(session, text) {
  const plan = timelineText(session);
  if (!isScenario(session) || !plan) return text;
  return `${plan}\n\n🎬 ${choose(session, 'СЦЕНАРИЙ', 'СЦЕНАРИЙ', 'SCRIPT')}\n\n${scenarioBody(text)}`;
}

export function scriptSchema(session) {
  const plan = timeline(session), hosts = Array.from({ length: session.host_count || 2 }, (_, i) => `host_${i + 1}`);
  return { type: 'json_schema', json_schema: { name: 'oaiu_event_script', strict: true, schema: {
    type: 'object', additionalProperties: false, properties: {
      blocks: { type: 'array', minItems: plan.length, maxItems: plan.length, items: {
        type: 'object', additionalProperties: false,
        properties: { index: { type: 'integer', enum: plan.map((_, i) => i) }, lines: { type: 'object', additionalProperties: false, properties: Object.fromEntries(hosts.map(key => [key, { type: 'string', minLength: 1 }])), required: hosts } },
        required: ['index', 'lines'],
      } },
    }, required: ['blocks'],
  } } };
}

export function scriptStructurePrompt(session) {
  return `Верни JSON по схеме. Для каждого из ${timeline(session).length} блоков дай index (с нуля) и lines с host_1${(session.host_count || 2) > 1 ? ` ... host_${session.host_count || 2}` : ''}. Қазақша мәтін табиғи әрі сауатты болсын: «жарысына», «бас төреші», «марапаттарды табыстайды» сияқты дұрыс тіркестерді қолдан. Әңгіме волейбол жарысы туралы болса, «жарығына» не «тапсырыс береді» деп жазба. Каждый ведущий говорит коротко: 1–2 предложения, обычно 10–25 слов, на языке задания. Только произносимые реплики, без подписи «Ведущий», тайминга, Markdown, действий, маршрутов, световых эффектов, оборудования и технических списков внутри реплик. Подписи ведущих, точные интервалы, сценические ремарки, приглашение выбранных руководителей с ФИО, техплан и план Б будут добавлены отдельно программой. Поэтому не приглашай выбранных руководителей повторно и не дублируй их имена. Не выдумывай количество команд/участников/матчей, названия, победителей, подарки, оборудование или результаты. Неизвестное обозначай короткими понятными плейсхолдерами. В матчевом блоке достаточно объявления начала и следующего перехода; не озвучивай технические инструкции зрителям.`;
}

export function renderStructuredScenario(session, data) {
  const plan = timeline(session), count = session.host_count || 2;
  if (!data || !Array.isArray(data.blocks) || data.blocks.length !== plan.length) throw new TypeError('Incomplete script');
  const ordered = [...data.blocks].sort((a, b) => a.index - b.index);
  if (ordered.some((block, i) => block.index !== i || !block.lines || Array.from({ length: count }, (_, n) => block.lines[`host_${n + 1}`]).some(line => typeof line !== 'string' || !line.trim()))) throw new TypeError('Invalid script roles');
  const hostLabel = i => choose(session, `Ведущий ${i}`, `Жүргізуші ${i}`, `Host ${i}`) + (session.host_names?.[i - 1] ? ` · ${session.host_names[i - 1]}` : '');
  const plain = value => value.replace(/\*\*|^#{1,6}\s/gm, '').trim();
  const direction = stageDescription(session), gym = session.stage_key === 'gym';
  const welcomeIndex = plan.findIndex(row => /Привет|Слово руковод|Құттықтау|Басшылық|Welcome|Leadership/iu.test(row.title));
  const body = ordered.map((block, i) => {
    const row = plan[i], absolute = Number.isInteger(session.event_start), offset = absolute ? session.event_start : 0;
    const match = /Матч|Соревнован|Жарыс\s|Matches|Competition/iu.test(row.title);
    const cue = match ? choose(session, 'Во время игры ведущие остаются за пределами игровой зоны. Переход объявляют после сигнала судьи.', 'Ойын кезінде жүргізушілер ойын алаңынан тыс тұрады. Келесі кезеңді төреші белгі бергеннен кейін хабарлайды.', 'During play, hosts remain outside the playing area. Announce transitions after the official signal.')
      : gym ? direction : choose(session, `Ремарка: ${direction} Реплики произносятся в согласованной центральной точке; проходы свободны.`, `Ремарка: ${direction} Репликалар келісілген орталық орында айтылады; өту жолы бос қалады.`, `Stage cue: ${direction} Deliver lines at the agreed center position; keep access clear.`);
    const lines = Array.from({ length: count }, (_, n) => `${hostLabel(n + 1)}: ${plain(block.lines[`host_${n + 1}`])}`);
    const facts = (session.brief || '') + '\n' + (session.pending_instruction || '');
    const prizes = /медал|кубо[кч]|кубк|троф|medal|troph|\bcups?\b/iu;
    if (/Награжд|Марапат|Awards/iu.test(row.title) && !prizes.test(facts)) {
      lines.forEach((line, n) => { if (prizes.test(line)) lines[n] = `${hostLabel(n + 1)}: ` + choose(session, '[Награждающий] вручает [согласованные награды]. Поздравляем участников!', '[Марапаттаушы] [келісілген марапаттарды] табыстайды. Қатысушыларды құттықтаймыз!', '[Presenter] presents [confirmed awards]. Congratulations to the participants!'); });
    }
    if (/Резерв|Үзіліс|Break|Buffer/iu.test(row.title) && !/тур|раунд|round/iu.test(facts)) {
      lines.forEach((line, n) => { if (/втор|екінші|second|следующ.*матч|келесі.*матч/iu.test(line)) lines[n] = `${hostLabel(n + 1)}: ` + choose(session, 'Сделаем перерыв. Следующий блок объявим по сигналу организатора.', 'Үзіліс жасаймыз. Ұйымдастырушы белгі бергенде келесі бөлімді хабарлаймыз.', 'We will take a break and announce the next segment on the organizers signal.'); });
    }
    if (i === welcomeIndex && selectedPeople(session).length) {
      const roster = selectedPeople(session).map(person => `${personRole(person, session)} — ${personName(person, session)}`).join('; ');
      lines.length = 0;
      lines.push(`${hostLabel(1)}: ` + choose(session, `Приглашаем для приветствия: ${roster}. Встречаем аплодисментами!`, `Құттықтау сөз: ${roster}. Қошеметпен қарсы алайық!`, `Please welcome: ${roster}, for the opening remarks.`));
      if (count > 1) lines.push(`${hostLabel(2)}: ` + choose(session, 'Спасибо за напутствие! Желаем всем участникам яркого события.', 'Ізгі тілегіңізге рақмет! Барлық қатысушыға сәттілік тілейміз.', 'Thank you for your opening remarks. We wish everyone a wonderful event.'));
      lines.push('[' + choose(session, 'Приветственные выступления в пределах времени блока. После выступления — согласованный уход.', 'Құттықтау сөздерге осы бөлімнің уақыты беріледі. Сөзден кейін келісілген бағытпен түседі.', 'Welcome addresses within this segment. Guests leave by the agreed route.') + ']');
    }
    return `${i + 1}. ${row.title} · ${clockLabel(row.start + offset, absolute)}–${clockLabel(row.end + offset, absolute)}\n[${cue}]\n\n${lines.join('\n\n')}`;
  }).join('\n\n');
  const technical = choose(session,
    'ТЕХНИЧЕСКАЯ ПОДГОТОВКА\n• Согласовать проходы, точку ведущих и сигналы переходов.\n• Проверить звук/микрофон, если они предусмотрены. Музыка и экран — только при наличии.\n• Подтвердить имена гостей, список участников, порядок награждения и фактический регламент.\n\nПЛАН Б\n• Без музыки продолжить голосом, без обещаний о времени устранения неполадки.\n• При задержке использовать резерв и согласовать перенос следующих блоков с организатором.',
    'ТЕХНИКАЛЫҚ ДАЙЫНДЫҚ\n• Өту жолын, жүргізушілердің орнын және ауысу белгілерін келісу.\n• Дыбыс/микрофон қарастырылса, алдын ала тексеру. Музыка мен экран тек бар болса қолданылады.\n• Қонақтардың аты-жөнін, қатысушыларды, марапаттауды және нақты регламентті растау.\n\nБ ЖОСПАРЫ\n• Музыка болмаса, жүргізушілер дауыспен жалғастырады; ақауды жою уақытына уәде берілмейді.\n• Кідіріс болса, резерв уақытын қолданып, кейінгі бөлімдерді ұйымдастырушымен келісу.',
    'TECHNICAL PREPARATION\n• Agree routes, host positions and transition signals.\n• Test sound/microphones if provided. Music and screens are optional.\n• Confirm guest names, participants, awards and the actual event format.\n\nPLAN B\n• Continue without music if unavailable; do not promise a repair time.\n• Use the buffer for delays and agree changes with the organizer.');
  const sportsNote = ['volleyball', 'sport'].includes(session.event_preset) ? '\n\n' + choose(session, 'Матчевое время ориентировочное: полный турнир может не уместиться в выбранный интервал. Фактический график согласуют с судьями.', 'Матч уақыты шамамен берілген: толық жарыс таңдалған уақытқа сыймауы мүмкін. Нақты кесте төрешілермен келісіледі.', 'Match durations are estimates. A full tournament may exceed this window; agree the actual schedule with the officials.') : '';
  return renderScenario(session, body + '\n\n' + technical + sportsNote);
}

export function showProfiles(store, chat, session) {
  store.put(chat, { ...session, step: 'event_profile' });
  store.send(chat, choose(session, 'Какое событие готовим?', 'Қандай іс-шараға сценарий керек?', 'Which event are we planning?'), Object.entries(PRESETS).map(([key, value]) => [btn(localized(session, value.title), `event:profile:${key}`)]));
}
export function showDuration(store, chat, session) {
  store.put(chat, { ...session, step: 'event_duration' });
  const options = [30, 60, 90, 120, 180, 240];
  const buttons = options.map(n => btn(n < 60 ? `${n} мин` : n % 60 ? '1,5 ' + choose(session, 'часа', 'сағат', 'hours') : `${n / 60} ${choose(session, 'ч', 'сағат', 'hours')}`, `event:duration:${n}`));
  store.send(chat, choose(session, 'Сколько длится всё мероприятие? Это время программы, а не длина речи.', 'Іс-шара жалпы қанша уақытқа созылады? Бұл жүргізуші сөзінің ұзақтығы емес, бүкіл бағдарлама уақыты.', 'How long is the whole event? This is program time, not speech length.'), [buttons.slice(0, 2), buttons.slice(2, 4), buttons.slice(4), [btn(choose(session, '✍️ Своя длительность', '✍️ Өз уақытым', '✍️ Custom duration'), 'event:duration:custom')]]);
}
export function showSettings(store, chat, session) {
  session = { event_preset: 'general', host_count: 2, stage_key: 'right_left', ...session, step: 'event_settings' };
  store.put(chat, session);
  const title = localized(session, (PRESETS[session.event_preset] || PRESETS.general).title);
  const time = Number.isInteger(session.event_start) ? clockLabel(session.event_start) : choose(session, 'не указано', 'көрсетілмеген', 'not specified');
  store.send(chat, `${title}\n${choose(session, 'Длительность', 'Ұзақтығы', 'Duration')}: ${session.event_minutes || '?'} мин\n${choose(session, 'Начало', 'Басталуы', 'Starts')}: ${time}\n${choose(session, 'Ведущих', 'Жүргізуші саны', 'Hosts')}: ${session.host_count}${session.host_names?.length ? ` · ${session.host_names.join('; ')}` : ''}\n${stageDescription(session)}`, [
    [btn('⏱ ' + choose(session, 'Длительность', 'Ұзақтығы', 'Duration'), 'event:duration'), btn('🕓 ' + choose(session, 'Начало', 'Басталуы', 'Start time'), 'event:start')],
    [btn('🎙 ' + choose(session, 'Ведущие', 'Жүргізушілер', 'Hosts'), 'event:hosts'), btn('✍️ ' + choose(session, 'Имена ведущих', 'Жүргізушілердің аты', 'Host names'), 'event:names')],
    [btn('↔️ ' + choose(session, 'Выход и уход', 'Шығу және түсу', 'Entry and exit'), 'event:stage'), btn('🎭 ' + choose(session, 'Тип события', 'Іс-шара түрі', 'Event type'), 'event:profiles')],
    [btn(session.script_editing ? choose(session, '✅ Применить к сценарию', '✅ Сценарийді жаңарту', '✅ Apply to script') : choose(session, '✅ Продолжить', '✅ Жалғастыру', '✅ Continue'), 'event:ready')],
  ]);
}

export function handleScenario(dialogue, chat, text, callback) {
  const store = dialogue.store, session = store.get(chat);
  if (!callback.startsWith('event:') && !session.step?.startsWith('event_')) return false;
  if (!isScenario(session)) { store.send(chat, choose(session, 'Сначала выберите «Сценарий»: /new', 'Алдымен «Сценарий» таңдаңыз: /new', 'Choose Script first: /new')); return true; }
  const [action, value] = callback.slice(6).split(':');
  if (callback) {
    if (action === 'config') { store.cancel(chat); showSettings(store, chat, { ...session, script_editing: Boolean(session.result) }); return true; }
    if (action === 'profiles') { showProfiles(store, chat, session); return true; }
    if (action === 'profile' && Object.hasOwn(PRESETS, value)) { const next = { ...session, event_preset: value }; validMinutes(next.event_minutes) ? showSettings(store, chat, next) : showDuration(store, chat, next); return true; }
    if (action === 'duration') {
      if (!value) showDuration(store, chat, session);
      else if (value === 'custom') { store.put(chat, { ...session, step: 'event_duration_custom' }); store.send(chat, choose(session, 'Напишите длительность от 15 минут до 8 часов: «90 минут», «2 часа», «1,5 сағат» или «02:30».', '15 минуттан 8 сағатқа дейінгі ұзақтықты жазыңыз: «90 минут», «2 сағат», «1,5 сағат» не «02:30».', 'Enter 15 minutes to 8 hours, e.g. 90 minutes, 2 hours or 02:30.')); }
      else if (validMinutes(Number(value))) showSettings(store, chat, { ...session, event_minutes: Number(value) });
      return true;
    }
    if (action === 'start') {
      if (value === 'none') showSettings(store, chat, { ...session, event_start: null });
      else { store.put(chat, { ...session, step: 'event_start' }); store.send(chat, choose(session, 'Во сколько начало? Напишите время по Алматы в формате 14:30.', 'Қай уақытта басталады? Алматы уақытымен жазыңыз: 14:30.', 'What time does it start in Almaty? Use HH:MM, e.g. 14:30.'), [[btn(choose(session, 'Без точного времени', 'Нақты уақытсыз', 'No clock time'), 'event:start:none')]]); }
      return true;
    }
    if (action === 'hosts') {
      if (['1', '2', '3', '4'].includes(value)) { const next = { ...session, host_count: Number(value) }; if (next.host_names?.length !== next.host_count) delete next.host_names; showSettings(store, chat, next); }
      else { store.put(chat, { ...session, step: 'event_hosts' }); store.send(chat, choose(session, 'Сколько ведущих?', 'Қанша жүргізуші болады?', 'How many hosts?'), [[1, 2, 3, 4].map(n => btn(String(n), `event:hosts:${n}`))]); }
      return true;
    }
    if (action === 'names') { store.put(chat, { ...session, step: 'event_names' }); store.send(chat, choose(session, 'Имена ведущих через точку с запятой, по одному на ведущего: «Сабина; Ернар». Чтобы убрать имена, отправьте «-».', 'Жүргізушілердің атын нүктелі үтірмен бөліңіз: «Сабина; Ернар». Атын өшіру үшін «-» жіберіңіз.', 'Enter host names separated by semicolons, one per host. Send - to remove names.')); return true; }
    if (action === 'stage') {
      if (Object.hasOwn(STAGES, value)) showSettings(store, chat, { ...session, stage_key: value, stage_note: '' });
      else if (value === 'custom') { store.put(chat, { ...session, step: 'event_stage_custom' }); store.send(chat, choose(session, 'Опишите вход, перемещение и уход (до 500 символов). Укажите стороны с точки зрения зрителей.', 'Шығу, жүру және түсу тәртібін жазыңыз (500 таңбаға дейін). Оң/сол жақ көрерменнің көзімен анықталады.', 'Describe entry, movement and exit in up to 500 characters, from the audience perspective.')); }
      else { store.put(chat, { ...session, step: 'event_stage' }); store.send(chat, choose(session, 'Стороны сцены — с точки зрения зрителей. Выберите выход и уход.', 'Сахнаның оң/сол жағы көрермен көзімен анықталады. Шығу және түсу бағытын таңдаңыз.', 'Stage sides are from the audience perspective. Choose entry and exit.'), [[btn('➡️ ' + choose(session, 'Справа → слева', 'Оңнан → солға', 'Right → left'), 'event:stage:right_left')], [btn('⬅️ ' + choose(session, 'Слева → справа', 'Солдан → оңға', 'Left → right'), 'event:stage:left_right')], [btn('🏐 ' + choose(session, 'Спортзал без сцены', 'Сахнасыз спортзал', 'Sports hall, no stage'), 'event:stage:gym')], [btn('✍️ ' + choose(session, 'Свой вариант', 'Өз нұсқам', 'Custom'), 'event:stage:custom')]]); }
      return true;
    }
    if (action === 'ready') {
      if (!validMinutes(session.event_minutes)) { showDuration(store, chat, session); return true; }
      const next = { ...session }; delete next.script_editing;
      if (session.script_editing && session.result) dialogue.generate(chat, { ...next, step: 'ready' }, 'Перестрой текущий сценарий по новым режиссёрским параметрам и таймингу. Сохрани тему и подтверждённые факты, адаптируй реплики, выходы и уходы.');
      else { store.put(chat, { ...next, step: 'tone' }); dialogue.askTone(chat, next); }
      return true;
    }
    return true;
  }
  if (session.step === 'event_duration_custom') {
    const duration = parseDuration(text); if (duration) showSettings(store, chat, { ...session, event_minutes: duration }); else store.send(chat, choose(session, 'Нужна длительность от 15 минут до 8 часов. Например: 90 минут или 2 часа.', '15 минуттан 8 сағатқа дейінгі уақыт керек. Мысалы: 90 минут не 2 сағат.', 'Enter a duration between 15 minutes and 8 hours.'));
  } else if (session.step === 'event_start') {
    const start = parseStart(text); if (start !== null) showSettings(store, chat, { ...session, event_start: start }); else store.send(chat, choose(session, 'Формат времени: 14:30, часы от 00 до 23.', 'Уақыт үлгісі: 14:30, сағат 00 мен 23 аралығында.', 'Use HH:MM with hours from 00 to 23.'));
  } else if (session.step === 'event_names') {
    const names = text === '-' ? [] : text.split(';').map(v => v.trim()).filter(Boolean);
    if (names.length && (names.length !== (session.host_count || 2) || names.some(n => [...n].length > 80))) store.send(chat, choose(session, 'Число имён должно совпадать с числом ведущих. Разделите их точкой с запятой.', 'Ат саны жүргізуші санына тең болуы керек. Арасына нүктелі үтір қойыңыз.', 'Enter one name per host, separated by semicolons.'));
    else showSettings(store, chat, { ...session, host_names: names });
  } else if (session.step === 'event_stage_custom') {
    if (text && [...text].length <= 500) showSettings(store, chat, { ...session, stage_key: 'custom', stage_note: text }); else store.send(chat, choose(session, 'Опишите выход и уход текстом до 500 символов.', 'Шығу мен түсуді 500 таңбаға дейін жазыңыз.', 'Describe entry and exit in up to 500 characters.'));
  } else store.send(chat, choose(session, 'Выберите настройку кнопкой выше. Начать заново: /new', 'Жоғарыдағы батырмамен таңдаңыз. Жаңадан бастау: /new', 'Choose an option above, or use /new.'));
  return true;
}

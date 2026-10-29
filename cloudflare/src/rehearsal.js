import { resultSession } from './companion.js';
const HOME_BUTTONS = [[{ text: '🏠 Басты мәзір', callback_data: 'nav:home' }]];

const PACES = { slow: { label: 'Баяу', words: 100 }, normal: { label: 'Қалыпты', words: 125 }, fast: { label: 'Жылдам', words: 150 } };
const b = (text, callback_data) => ({ text, callback_data });
const token = () => crypto.randomUUID().slice(0, 8);
const callback = (s, action, value = '') => `rehearsal:${action}:${s.rehearsal_state.token}${value ? ':' + value : ''}`;
const words = text => (String(text).match(/[\p{L}\p{N}]+(?:[’'-][\p{L}\p{N}]+)*/gu) || []).length;
const secondsLabel = seconds => `${Math.floor(seconds / 60)} мин ${Math.round(seconds % 60)} сек`;
function chunks(text) {
  const result = [];
  for (let paragraph of String(text).split(/\n\s*\n/u).map(s => s.trim()).filter(Boolean)) {
    while (paragraph.length > 700) {
      let end = paragraph.lastIndexOf(' ', 700); if (end < 350) end = 700;
      if (/[\uD800-\uDBFF]/.test(paragraph[end - 1])) end--;
      result.push(paragraph.slice(0, end).trim()); paragraph = paragraph.slice(end).trim();
    }
    if (paragraph) result.push(paragraph);
  }
  return result;
}
export function rehearsalItems(session, role = 'all') {
  const s = resultSession(session);
  if (s.format === 'script' && s.script_data?.blocks?.length) {
    return s.script_data.blocks.flatMap((block, index) => Object.entries(block.lines || {}).filter(([key, line]) => (role === 'all' || role === key) && typeof line === 'string' && line.trim()).flatMap(([key, line]) => chunks(line).map(text => ({ text, cue: block.cue || '', block: index, title: block.title, role: key, minutes: block.minutes }))));
  }
  return chunks(s.result || '').map((text, index) => ({ text, cue: '', block: index, title: `${index + 1}-бөлік`, role: 'all', minutes: null }));
}
export function estimateRehearsal(session, pace = 'normal', role = 'all') {
  const s = resultSession(session), items = rehearsalItems(session, role), rate = (PACES[pace] || PACES.normal).words;
  const totalWords = items.reduce((sum, item) => sum + words(item.text), 0);
  const pauses = items.length ? Math.max(0, items.length - 1) * 2 : 0;
  const seconds = Math.ceil(totalWords * 60 / rate + pauses);
  const blocks = [...new Set(items.map(item => item.block))].map(index => {
    const lines = items.filter(item => item.block === index), count = lines.reduce((sum, item) => sum + words(item.text), 0);
    return { index, title: lines[0].title, words: count, seconds: Math.ceil(count * 60 / rate + Math.max(0, lines.length - 1) * 2), plannedSeconds: Number.isFinite(lines[0].minutes) ? lines[0].minutes * 60 : null };
  });
  const planned = s.format === 'speech' ? Number(s.length || 3) * 60 : null;
  return { words: totalWords, seconds, rate, items: items.length, blocks, overflow: blocks.filter(block => block.plannedSeconds && block.seconds > block.plannedSeconds), speechOverflow: planned !== null && seconds > planned, plannedSeconds: planned };
}
function clear(session) { const next = { ...session, step: session.rehearsal_state?.return_step || 'ready' }; delete next.rehearsal_state; return next; }
function ready(store, chat, session) {
  if (!session.result) { store.send(chat, 'Алдымен «Басты мәзірден» мәтін не сценарий дайындаңыз.', HOME_BUTTONS); return false; }
  if (store.job(chat) || !['ready', 'rehearsal'].includes(session.step)) { store.send(chat, 'Алдымен ағымдағы тапсырманы не баптауды аяқтаңыз. Содан кейін «Репетиция» бөлімін ашыңыз.', HOME_BUTTONS); return false; }
  return true;
}
function summary(store, chat, session) {
  const r = session.rehearsal_state, estimate = estimateRehearsal(r.source, r.pace, r.role);
  const role = r.role === 'all' ? 'Барлық реплика' : `Жүргізуші ${r.role.slice(-1)}`;
  const warnings = estimate.overflow.map(block => `• ${block.title}: шамамен ${secondsLabel(block.seconds)}, бөлінген уақыт ${secondsLabel(block.plannedSeconds)}.`);
  if (estimate.speechOverflow) warnings.push(`• Сөз ұзақтығы таңдалған ${Math.round(estimate.plannedSeconds / 60)} минуттан асады.`);
  store.put(chat, session);
  store.send(chat, `🎙 РЕПЕТИЦИЯ\n${role}\nҚарқын: ${PACES[r.pace].label}\nСөз саны: ${estimate.words}\nОқу уақыты шамамен: ${secondsLabel(estimate.seconds)}\n\nБұл тек айтылатын мәтіннің бағасы. Матч, өнер нөмірі, қонақ сөзі мен ұзақ сахналық үзілістер бөлек уақыт алады. Аплодисмент пен нақты паузалар бағалауды өзгертуі мүмкін.${warnings.length ? '\n\nУақытқа назар аударыңыз:\n' + warnings.join('\n') : ''}`, [
    [b('▶️ Репликаларды оқу', callback(session, 'view', '0'))],
    [b('🐢 Баяу', callback(session, 'pace', 'slow')), b('Қалыпты', callback(session, 'pace', 'normal')), b('⚡ Жылдам', callback(session, 'pace', 'fast'))],
    ...(r.source.script_data?.blocks?.length ? [[b('👥 Рөлді таңдау', callback(session, 'roles'))]] : []),
    [b('⏱ Таймерді бастау', callback(session, 'start')), b('⏹ Таймерді тоқтату', callback(session, 'stop'))],
    ...(warnings.length ? [[b('✂️ Қысқартуды сұрау', callback(session, 'shorten'))]] : []),
    [b('⬅️ Дайын мәтінге оралу', callback(session, 'close'))],
  ]);
}
function showItem(store, chat, session, index) {
  const r = session.rehearsal_state, items = rehearsalItems(r.source, r.role); if (!items.length) { store.send(chat, 'Бұл рөлге реплика берілмеген. Басқа рөлді таңдаңыз.'); return; }
  r.index = Math.max(0, Math.min(index, items.length - 1)); store.put(chat, session); const item = items[r.index];
  store.send(chat, `🎙 ${r.index + 1} / ${items.length} · ${item.title}\n${item.role === 'all' ? '' : 'Жүргізуші ' + item.role.slice(-1) + '\n'}${item.cue ? '\nСахна нұсқауы: ' + item.cue + '\n' : ''}\n${item.text}`, [
    [b('⬅️ Алдыңғы', callback(session, 'view', String(r.index - 1))), b('Келесі ➡️', callback(session, 'view', String(r.index + 1)))],
    [b('⏱ Таймерді бастау', callback(session, 'start')), b('⏹ Таймерді тоқтату', callback(session, 'stop'))],
    [b('📊 Есепке оралу', callback(session, 'summary'))],
  ]);
}
export function handleRehearsal(dialogue, chat, text, data, command) {
  const store = dialogue.store, session = store.get(chat);
  if (command !== '/rehearse' && !data.startsWith('rehearsal:')) return false;
  if (command === '/rehearse' || data === 'rehearsal:open') {
    if (!ready(store, chat, session)) return true;
    const finished = resultSession(session);
    const source = structuredClone(Object.fromEntries(['result', 'format', 'script_data', 'host_count', 'host_names', 'length'].filter(key => finished[key] !== undefined).map(key => [key, finished[key]])));
    if (!rehearsalItems(source).length || source.result.length > 100000) { store.send(chat, 'Бұл мәтінді репетицияға дайындау мүмкін болмады. Қысқарақ нұсқа жасаңыз.'); return true; }
    const next = { ...session, step: 'rehearsal', rehearsal_state: { token: token(), source_result: session.result, source, pace: 'normal', role: 'all', index: 0, return_step: 'ready' } };
    summary(store, chat, next); return true;
  }
  const [, action, revision, value] = data.split(':'), r = session.rehearsal_state;
  if (session.step !== 'rehearsal' || !r || r.token !== revision || r.source_result !== session.result) { store.send(chat, 'Бұл репетиция батырмасы ескірген. «Репетиция» бөлімін қайта ашыңыз.', HOME_BUTTONS); return true; }
  if (action === 'close') { store.put(chat, clear(session)); store.send(chat, 'Репетиция аяқталды. Дайын мәтін сақталды.'); return true; }
  if (action === 'pace' && Object.hasOwn(PACES, value)) { r.pace = value; summary(store, chat, session); return true; }
  if (action === 'summary') { summary(store, chat, session); return true; }
  if (action === 'view' && /^-?\d{1,3}$/.test(value || '')) { showItem(store, chat, session, Number(value)); return true; }
  if (action === 'roles') {
    const count = Math.min(4, r.source.host_count || 2);
    store.send(chat, 'Қай рөлді жаттығамыз?', [[b('👥 Барлық реплика', callback(session, 'role', 'all'))], ...Array.from({ length: count }, (_, i) => [b(`🎤 Жүргізуші ${i + 1}${r.source.host_names?.[i] ? ' · ' + r.source.host_names[i] : ''}`, callback(session, 'role', 'host_' + (i + 1)))])]); return true;
  }
  if (action === 'role' && (value === 'all' || /^host_[1-4]$/.test(value || '') && Number(value.slice(-1)) <= (r.source.host_count || 2))) { r.role = value; r.index = 0; summary(store, chat, session); return true; }
  if (action === 'start') {
    if (r.started_at) store.send(chat, 'Таймер жұмыс істеп тұр. Аяқтағанда «Таймерді тоқтату» басыңыз.');
    else { r.started_at = Date.now(); store.put(chat, session); store.send(chat, '⏱ Таймер басталды. Дайын болғанда «Таймерді тоқтату» басыңыз. Автоматты хабарлама жіберілмейді.', [[b('⏹ Таймерді тоқтату', callback(session, 'stop'))]]); }
    return true;
  }
  if (action === 'stop') {
    if (!r.started_at) { store.send(chat, 'Алдымен таймерді бастаңыз.'); return true; }
    const measured = Math.max(0, Math.round((Date.now() - r.started_at) / 1000)); delete r.started_at; store.put(chat, session);
    store.send(chat, measured > 86400 ? 'Таймер бір тәуліктен артық ашық тұрды. Дәл өлшеу үшін қайта бастаңыз.' : `⏱ Қолмен өлшенген уақыт: ${secondsLabel(measured)}. Бұл таймерді бастау мен тоқтату арасындағы уақыт.`, [[b('📊 Репетиция есебі', callback(session, 'summary'))]]); return true;
  }
  if (action === 'shorten') {
    const next = clear(session); store.put(chat, next);
    dialogue.generate(chat, next, 'Репетицияға арналған айтылатын репликаларды қысқарт. Әр бөлімдегі мәтін сол бөлімнің берілген уақытына сыятындай болсын. Жалпы іс-шара ұзақтығын, бөлімдер ретін, расталған фактілер мен бекітілген фрагменттерді өзгертпе. Сахналық үзілістер мен матч уақытын сөздің ұзақтығымен шатастырма.'); return true;
  }
  return true;
}

// Professional names and appointments only. Original DOCX files, student
// rosters, phone numbers and personal metadata are not distributed.
export const DIRECTORY_UPDATED = '2026-10-29';
export const DIRECTORY_SOURCES = {
  supplied: 'Деканат и кафедра (1).docx',
  rector: 'https://caiu.edu.kz/kk/1prorector-kk/',
  academic: 'https://caiu.edu.kz/prorektor-po-ur-czaiu/',
  social: 'https://caiu.edu.kz/prorektor-po-vr-czaiu/',
};
export const PEOPLE = [
  { id: 'rector', group: 'leadership', name: 'Ажидинов Акмалдин Сапардинович', nameKk: 'Ажидинов Акмалдин Сапардинұлы', role: 'Ректор OAIU', roleKk: 'OAIU ректоры', short: 'Ректор · Ажидинов А. С.', degree: 'техника ғылымдарының кандидаты, профессор', aliases: ['ажидинов'], source: 'rector' },
  { id: 'vice_academic', group: 'leadership', name: 'Дуйсенов Нурзак Жезтаевич', nameKk: 'Дуйсенов Нурзак Жезтайұлы', role: 'Проректор по учебно-методической работе', roleKk: 'Оқу-әдістемелік жұмыстар жөніндегі проректор', short: 'Проректор · Дуйсенов Н. Ж.', aliases: ['дуйсенов'], source: 'academic' },
  { id: 'vice_social', group: 'leadership', name: 'Хайдаров Нурлан Шахизиндаевич', nameKk: 'Хайдаров Нұрлан Шахизиндаұлы', role: 'Проректор по социальному развитию и воспитательной работе', roleKk: 'Әлеуметтік-тәрбие жұмысы жөніндегі проректор', short: 'Проректор · Хайдаров Н. Ш.', aliases: ['хайдаров'], source: 'social' },
  { id: 'dean_science', group: 'deans', name: 'Ризаходжаев Абдуманнап Абдумажитович', role: 'Декан естественно-научного факультета', roleKk: 'Жаратылыстану-ғылыми факультетінің деканы', short: 'Жаратылыстану · Ризаходжаев А.', aliases: ['ризаходжаев'], source: 'supplied' },
  { id: 'dean_languages', group: 'deans', name: 'Сыдыкова Зухра Ештаевна', role: 'Декан факультета педагогики и языков', roleKk: 'Педагогика және тілдер факультетінің деканы', short: 'Педагогика, тілдер · Сыдыкова З.', aliases: ['сыдыкова'], source: 'supplied' },
  { id: 'dept_math', group: 'departments', name: 'Кошкинбаева Мадина Жолдыкараевна', role: 'Заведующая кафедрой математики, физики и информатики', roleKk: 'Математика, физика және информатика кафедрасының меңгерушісі', short: 'Математика, физика, информатика', aliases: ['кошкинбаева'], topics: ['математик', 'физик', 'информатик'], source: 'supplied' },
  { id: 'dept_chemistry', group: 'departments', name: 'Бердалиева Акмарал Макуловна', role: 'Заведующая кафедрой химии, биологии и экологии', roleKk: 'Химия, биология және экология кафедрасының меңгерушісі', short: 'Химия, биология, экология', aliases: ['бердалиева'], topics: ['хими', 'биолог', 'эколог'], source: 'supplied' },
  { id: 'dept_sport', group: 'departments', name: 'Амидов Асет Ибрагимұлы', role: 'Заведующий кафедрой начальной военной подготовки и физической культуры', roleKk: 'Бастапқы әскери дайындық және дене шынықтыру кафедрасының меңгерушісі', short: 'Әскери дайындық, дене шынықтыру', aliases: ['амидов'], topics: ['әскери', 'шынықтыру', 'военн', 'физкультур'], source: 'supplied' },
  { id: 'dept_music', group: 'departments', name: 'Жунисова Набат Алибаевна', role: 'Заведующая кафедрой музыки, профессионального обучения и дизайна', roleKk: 'Музыка, кәсіптік оқыту және дизайн кафедрасының меңгерушісі', short: 'Музыка, кәсіптік оқыту, дизайн', aliases: ['жунисова'], topics: ['музык', 'дизайн', 'кәсіптік'], source: 'supplied' },
  { id: 'dept_pedagogy', group: 'departments', name: 'Нишанова Каракоз Сапархановна', role: 'Заведующая кафедрой педагогики', roleKk: 'Педагогика кафедрасының меңгерушісі', short: 'Педагогика', aliases: ['нишанова'], topics: ['педагогик'], source: 'supplied' },
  { id: 'dept_languages', group: 'departments', name: 'Даулеталиева Динара Мыктыбаевна', role: 'Заведующая кафедрой языков и литературы', roleKk: 'Тілдер және әдебиет кафедрасының меңгерушісі', short: 'Тілдер және әдебиет', aliases: ['даулеталиева'], topics: ['тілдер', 'әдебиет', 'язык', 'литератур'], source: 'supplied' },
  { id: 'dept_economy', group: 'departments', name: 'Жадигерова Гулшат Абдимуталиповна', role: 'Заведующая кафедрой экономики и управления', roleKk: 'Экономика және басқару кафедрасының меңгерушісі', short: 'Экономика және басқару', aliases: ['жадигерова'], topics: ['экономик', 'басқару', 'управлен'], source: 'supplied' },
  { id: 'dept_law', group: 'departments', name: 'Жайлауова Акмарал Шерхуатовна', role: 'Заведующая кафедрой права', roleKk: 'Құқық кафедрасының меңгерушісі', short: 'Құқық', aliases: ['жайлауова'], topics: ['құқық', 'прав'], source: 'supplied' },
];

export const choose = (session, ru, kk, en = ru) => session.language === 'kk' ? kk : session.language === 'en' ? en : ru;
const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replaceAll('ё', 'е');
const word = (text, prefix) => new RegExp(`(?:^|[^\\p{L}])${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\p{L}*`, 'u').test(text);
// A rector is one canonical university office. Keep deputies separate even when
// their position contains the word "rector" in Russian, Kazakh or English.
export function isRectorRole(role) {
  const text = String(role || '').normalize('NFKC').toLowerCase();
  if (/проректор|вице[\s\p{Pd}]*ректор|vice[\s\p{Pd}]*rector|pro[\s\p{Pd}]*rector|deputy[\s\p{Pd}]+rector|ректор[^.;\n]{0,35}орынбасар/u.test(text)) return false;
  return /(?:^|[^\p{L}])(?:ректор(?:ы|і|а|дың|ының)?|rector)(?=$|[^\p{L}])/u.test(text);
}
function confirmedKazakhRole(role) {
  const text = String(role || '').trim();
  if (/заведующ|факультета|университета|проректор\s+по|руководител|начальник|rector|dean|head of|vice|academic/iu.test(text)) return '';
  return /[әғқңөұүһі]/iu.test(text) || /^(?:декан|ректор|проректор)$/iu.test(text) ? text : '';
}
export function importedRoleKk(role, previous = {}) {
  if (isRectorRole(role)) return 'OAIU ректоры';
  const direct = confirmedKazakhRole(role); if (direct) return direct;
  const known = PEOPLE.find(person => normalized(person.role) === normalized(role) || normalized(person.roleKk) === normalized(role));
  if (known) return known.roleKk || '';
  if ([previous.role, previous.roleKk].some(old => old && normalized(old) === normalized(role))) return confirmedKazakhRole(previous.roleKk);
  return '';
}
export function directoryRoleKk(person) {
  const verified = importedRoleKk(person.roleKk || '', {}); if (verified) return verified;
  const translated = importedRoleKk(person.role || '', person); if (translated) return translated;
  return person.group === 'departments' ? 'Кафедра меңгерушісі' : person.group === 'deans' ? 'Декан' : person.id === 'rector' || isRectorRole(person.role) ? 'OAIU ректоры' : person.group === 'leadership' ? 'Басшылық' : 'Қатысушы';
}
export const personName = (person, session) => session.language === 'kk' ? person.nameKk || person.name : person.name;
export const personRole = (person, session) => session.language === 'kk' ? directoryRoleKk(person) : person.role;
export function catalog(store) {
  const overrides = store?.meta('directory_overrides', {}) || {}, extra = store?.meta('directory_extra', []) || [];
  return [...PEOPLE, ...extra].map(person => ({ ...person, ...(overrides[person.id] || {}) }));
}
export function snapshotPeople(session, store, refresh = false) {
  const all = catalog(store).map(person => !refresh && (session.directory_people || []).find(saved => saved.id === person.id) || person), ids = new Set(session.people || []);
  return { ...session, directory_people: all.filter(person => ids.has(person.id)).map(({ id, group, name, nameKk, role, roleKk, degree }) => ({ id, group, name, nameKk, role, roleKk, degree })) };
}
export function selectedPeople(session) {
  return [...new Set(session.people || [])].map(id => (session.directory_people || []).find(person => person.id === id) || PEOPLE.find(person => person.id === id) || (session.custom_people || []).find(person => person.id === id)).filter(Boolean).slice(0, 6).sort((a, b) => (PEOPLE.findIndex(p => p.id === a.id) + 1 || 999) - (PEOPLE.findIndex(p => p.id === b.id) + 1 || 999));
}

export function detectPeople(text, store) {
  text = normalized(text); const found = new Set();
  const all = catalog(store);
  for (const person of all) if ([...(person.aliases || []), normalized(person.name.split(' ')[0])].filter(Boolean).some(alias => word(text, alias))) found.add(person.id);
  if (word(text, 'ректор') && !/(?:без|не приглашать|не зови|шақырма)[^.!?\n]{0,25}ректор|ректорсыз/u.test(text)) found.add('rector');
  if (/кафедр|меңгеруш|заведующ/u.test(text)) {
    const heads = all.filter(person => person.topics?.some(topic => word(text, topic)));
    if (heads.length === 1) found.add(heads[0].id);
  }
  return [...found];
}

export function enrichPeople(session, text, store) {
  let people = [...new Set([...(session.people || []), ...detectPeople(text, store)])];
  if (/(?:без|не приглашать|не зови|шақырма)[^.!?\n]{0,25}ректор|ректорсыз/iu.test(text)) people = people.filter(id => id !== 'rector');
  return { ...session, people: people.slice(0, 6) };
}

export function ambiguousPeople(text, session) {
  const source = normalized(text), selected = selectedPeople(session);
  if (word(source, 'декан') && !/(?:без|не приглашать|шақырма)[^.!?\n]{0,25}декан|декансыз/u.test(source) && !selected.some(person => person.group === 'deans')) return 'deans';
  if (/кафедр|меңгеруш|заведующ/u.test(source) && !/(?:без|не приглашать)[^.!?\n]{0,30}(?:заведующ|меңгеруш)/u.test(source) && !selected.some(person => person.group === 'departments') && !detectPeople(text).some(id => id.startsWith('dept_'))) return 'departments';
  return null;
}

export function peopleFacts(session) {
  const selected = selectedPeople(session);
  if (!selected.length) return '';
  return '\nПроверяемый справочник выбранных участников (ФИО воспроизводи точно, русскую/казахскую форму бери отсюда; не выдумывай других руководителей):\n'
    + selected.map(person => `- ${personRole(person, session)} — ${personName(person, session)}${person.degree ? `; ${person.degree}` : ''}`).join('\n')
    + '\nДолжность и ФИО не подтверждают фактическое присутствие. В сценарии это план приглашения; неизвестных судей, победителей, исполнителей и гостей обозначай плейсхолдерами.';
}

export function directoryQuery(text) {
  const s = normalized(text).trim().replace(/[?!.]+$/, '');
  if (/^(?:ректор|ректор кім|ректордың аты(?: кім)?|кто ректор|как зовут ректора)$/.test(s)) return 'leadership';
  if (/^(?:декан|декандар|деканы|басшылық|руководство|кафедры|кафедра меңгерушілері)$/.test(s)) return /декан/.test(s) ? 'deans' : /кафедр/.test(s) ? 'departments' : 'all';
  return null;
}

export function showDirectory(store, chat, session, group = 'all') {
  session = snapshotPeople(session, store, true);
  const groups = new Set(['all', 'leadership', 'deans', 'departments']); if (!groups.has(group)) group = 'all';
  const selected = selectedPeople(session);
  const heading = 'Мәтінге кімді қосамыз? 6 адамға дейін таңдаңыз. Батырманы қайта бассаңыз, адам тізімнен алынады.';
  const all = catalog(store), items = group === 'all' ? all.filter(person => person.id === 'rector') : all.filter(person => person.group === group);
  const cards = items.map(person => `${directoryRoleKk(person)}\n${person.nameKk || person.name}`).join('\n\n');
  const selectedLine = selected.length ? '\n\n' + 'Таңдалғандар: ' + selected.map(person => person.nameKk || person.name).join('; ') : '';
  const rows = items.map(person => [{ text: `${selected.some(p => p.id === person.id) ? '✅ ' : ''}${person.short}`, callback_data: `person:${person.id}` }]);
  rows.push([{ text: '🎓 Ректор / проректорлар', callback_data: 'staff:leadership' }, { text: '🏛 Декандар', callback_data: 'staff:deans' }], [{ text: '📚 Кафедралар', callback_data: 'staff:departments' }, { text: '✍️ Өз қатысушым', callback_data: 'staff:custom' }], [{ text: '✅ Жалғастыру', callback_data: 'staff:done' }, { text: 'Адам қоспау', callback_data: 'staff:none' }]);
  store.put(chat, { ...session, directory_group: group });
  store.send(chat, `${heading}\n\n${cards}${selectedLine}`, rows);
}

import { Inflate, strFromU8 } from 'fflate';
import { catalog } from './directory.js';

export const MAX_DOCX_BYTES = 1024 * 1024;
const MAX_XML_BYTES = 1024 * 1024, MAX_TEXT = 150000, IMPORT_TTL = 15 * 60 * 1000;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export class ImportError extends Error {}
const invalid = message => { throw new ImportError(message); };
const clean = text => String(text || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim();
const key = text => clean(text).normalize('NFKC').toLocaleLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]/gu, '');
export function validateDocument(document) {
  if (!document || typeof document.file_id !== 'string' || !document.file_id || document.file_id.length > 512) invalid('Не удалось прочитать файл. Отправьте его документом.');
  if (!/\.docx$/iu.test(document.file_name || '') || document.mime_type && ![DOCX_MIME, 'application/octet-stream', 'application/zip'].includes(document.mime_type)) invalid('Нужен документ Word .docx. Старый .doc, PDF и изображения пока не поддерживаются.');
  if (!Number.isSafeInteger(document.file_size) || document.file_size < 1 || document.file_size > MAX_DOCX_BYTES) invalid('Документ должен быть не больше 1 МБ. Удалите крупные изображения и отправьте .docx ещё раз.');
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0; });
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0; }
function documentXml(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_DOCX_BYTES || bytes.length < 22) invalid('Файл повреждён или превышает 1 МБ.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = at => view.getUint16(at, true), u32 = at => view.getUint32(at, true);
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) invalid('Нужен обычный документ без пароля .docx.');
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  if (!count || count > 256 || start + size !== end) invalid('Этот Word-файл слишком сложный. Сохраните текст в новом .docx.');
  let at = start, total = 0, entry = null; const names = new Set();
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) invalid('Повреждён архив Word.');
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), compressed = u32(at + 20), uncompressed = u32(at + 24), nameLength = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), offset = u32(at + 42);
    if (at + 46 + nameLength + extra + comment > end || flags & 1 || ![0, 8].includes(method) || compressed === 0xffffffff || uncompressed === 0xffffffff || offset === 0xffffffff) invalid('Зашифрованные и нестандартные архивы Word не поддерживаются.');
    const name = strFromU8(bytes.subarray(at + 46, at + 46 + nameLength));
    if (names.has(name) || /(^\/|\\|(^|\/)\.\.\/|\u0000)/u.test(name) || /vbaproject\.bin$/iu.test(name)) invalid('Нужен обычный .docx без макросов.');
    names.add(name); total += uncompressed;
    if (total > 8 * MAX_XML_BYTES) invalid('Распакованный документ слишком большой. Удалите изображения и лишние страницы.');
    if (name === 'word/document.xml') entry = { flags, method, crc, compressed, uncompressed, offset, name };
    at += 46 + nameLength + extra + comment;
  }
  if (at !== end || !entry || !names.has('[Content_Types].xml')) invalid('В файле не найден текст Word.');
  if (entry.uncompressed > MAX_XML_BYTES || entry.uncompressed < 1) invalid('Текст документа слишком большой. Разделите его на несколько файлов.');
  const local = entry.offset;
  if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) & 1 || u16(local + 8) !== entry.method) invalid('Повреждён файл Word.');
  const dataStart = local + 30 + u16(local + 26) + u16(local + 28);
  if (dataStart + entry.compressed > start || strFromU8(bytes.subarray(local + 30, local + 30 + u16(local + 26))) !== entry.name) invalid('Повреждён файл Word.');
  const packed = bytes.subarray(dataStart, dataStart + entry.compressed); let xmlBytes;
  if (entry.method === 0) xmlBytes = packed;
  else {
    const chunks = []; let expanded = 0;
    const inflater = new Inflate((chunk) => { expanded += chunk.length; if (expanded > MAX_XML_BYTES || expanded > entry.uncompressed) invalid('Распакованный текст слишком большой.'); chunks.push(chunk); });
    try { for (let p = 0; p < packed.length; p += 512) inflater.push(packed.subarray(p, p + 512), p + 512 >= packed.length); }
    catch (error) { if (error instanceof ImportError) throw error; invalid('Не удалось распаковать документ Word.'); }
    xmlBytes = new Uint8Array(expanded); let offset = 0; for (const chunk of chunks) { xmlBytes.set(chunk, offset); offset += chunk.length; }
  }
  if (xmlBytes.length !== entry.uncompressed || crc32(xmlBytes) !== entry.crc) invalid('Файл Word повреждён. Сохраните его заново и повторите отправку.');
  const xml = strFromU8(xmlBytes);
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml) || !/<w:document\b/u.test(xml) || !/<w:body\b/u.test(xml)) invalid('Этот формат Word не поддерживается. Сохраните документ заново как .docx.');
  return xml.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/gu, '');
}
function entities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (all, code) => {
    if (code[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()];
    const point = Number.parseInt(code.slice(code[1].toLowerCase() === 'x' ? 2 : 1), code[1].toLowerCase() === 'x' ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
  });
}
function paragraphText(xml) {
  return clean([...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:(?:tab|br)\b[^>]*\/>/gu)].map(match => match[1] === undefined ? ' ' : entities(match[1])).join(''));
}
export function extractDocx(bytes) {
  const xml = documentXml(bytes);
  const paragraphs = [...xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gu)].map(match => paragraphText(match[0])).filter(Boolean);
  const rows = [...xml.matchAll(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/gu)].map(row => [...row[0].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gu)].map(cell => [...cell[1].matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/gu)].map(p => paragraphText(p[0])).join(' ').trim()));
  const text = paragraphs.join('\n');
  if (!text || text.length > MAX_TEXT || paragraphs.length > 8000) invalid('Нужен текстовый Word-документ до 150 000 символов. Изображения текста не распознаются.');
  return { paragraphs, rows, text };
}
const professionalRole = text => /ректор|декан|заведующ|меңгеруш|rector|\bdean\b|head of (?:department|faculty)/iu.test(text);
const groupFor = text => /кафедр|меңгеруш|заведующ|department/iu.test(text) ? 'departments' : /декан|dean/iu.test(text) ? 'deans' : 'leadership';
const personName = text => [...text].length <= 120 && /^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){1,4}$/u.test(text) && !professionalRole(text) && !/факультет|университет|ғылым|наук|кафедр|дәреж|атақ|лауазым/iu.test(text);
const roleOkay = text => text.length <= 240 && professionalRole(text) && !/[@]|https?:|\+?\d[\d ()-]{6,}/iu.test(text);
export function directoryProposal(doc, store) {
  const found = [], seen = new Set();
  const add = (name, role) => { name = clean(name); role = clean(role); if (!personName(name) || !roleOkay(role) || seen.has(key(name))) return; seen.add(key(name)); found.push({ name, role, group: groupFor(role) }); };
  for (const row of doc.rows) {
    const roles = row.filter(roleOkay), names = row.filter(personName);
    if (roles.length === 1 && names.length === 1) add(names[0], roles[0]);
  }
  for (let i = 0; i < doc.paragraphs.length; i++) {
    const line = doc.paragraphs[i], parts = line.split(/\s*;\s*|\s+[—–]\s+/u);
    if (parts.length === 2) { add(parts[0], parts[1]); add(parts[1], parts[0]); }
    if (personName(line) && roleOkay(doc.paragraphs[i + 1] || '')) add(line, doc.paragraphs[i + 1]);
    if (roleOkay(line) && personName(doc.paragraphs[i + 1] || '')) add(doc.paragraphs[i + 1], line);
  }
  if (!found.length) invalid('Не нашёл однозначные пары ФИО и должность. Используйте таблицу с отдельными колонками «ФИО» и «Должность», либо строки «ФИО; должность». Импортируются только ректор, проректоры, деканы и заведующие кафедрами.');
  if (found.length > 40) invalid('В одном файле можно импортировать до 40 руководителей. Разделите список.');
  const all = catalog(store), used = new Set();
  return found.map(person => {
    let matches = all.filter(old => [old.name, old.nameKk].filter(Boolean).some(name => key(name) === key(person.name)));
    if (!matches.length) matches = all.filter(old => old.group === person.group && [old.role, old.roleKk].filter(Boolean).some(role => key(role) === key(person.role)));
    if (!matches.length && /^(?:ректор(?:\s+oaiu)?|oaiu\s+ректоры)$/iu.test(person.role)) matches = all.filter(old => old.id === 'rector');
    if (matches.length > 1 || matches.length === 1 && used.has(matches[0].id)) invalid('В документе есть неоднозначные записи одной должности. Уточните факультет/кафедру и повторите импорт.');
    const old = matches[0]; if (old) used.add(old.id);
    return { ...person, id: old?.id || 'extra_' + crypto.randomUUID().slice(0, 8), previous: old ? { name: old.name, role: old.roleKk || old.role } : null };
  });
}
const BLOCKS = [
  ['opening', ['Открытие', 'Ашылу', 'Opening'], /открыти|ашылу|opening/iu],
  ['anthem', ['Гимн', 'Әнұран', 'Anthem'], /гимн|әнұран|anthem/iu],
  ['guests', ['Представление гостей', 'Қонақтарды таныстыру', 'Guest introductions'], /қонақ.*таныстыр|представлен.*гост|guest introductions/iu],
  ['welcome', ['Приветственное слово', 'Құттықтау сөз', 'Welcome address'], /ректор|приветственн.*слов|құттықтау|басшылық|welcome address/iu],
  ['ceremony', ['Церемония', 'Салтанатты рәсім', 'Ceremony'], /кілт|клятв|ант\b|антын|посвящени|ceremony/iu],
  ['awards', ['Награждение', 'Марапаттау', 'Awards'], /награжден|марапаттау|awards/iu],
  ['performance', ['Творческая программа', 'Шығармашылық бағдарлама', 'Performances'], /концерт|шығармашылық|performance|творческ/iu],
  ['dance', ['Танец', 'Би', 'Dance'], /флешмоб|ұлттық би|танец|dance/iu],
  ['quiz', ['Интерактив', 'Интерактив', 'Interactive segment'], /квиз|викторин|интерактив|quiz/iu],
  ['video', ['Видеоролик', 'Бейнеролик', 'Video'], /видеоролик|бейнеролик|video/iu],
  ['photo', ['Общее фото', 'Естелік сурет', 'Group photo'], /фотосурет|естелік.*сурет|общее фото|group photo/iu],
  ['break', ['Перерыв и резерв', 'Үзіліс пен резерв', 'Break and buffer'], /перерыв|резерв|үзіліс|break|buffer/iu],
  ['closing', ['Закрытие', 'Қорытынды', 'Closing'], /закрыти|завершени|қорытынды|жабылу|closing|финал/iu],
];
export function sampleProposal(doc) {
  const intro = doc.paragraphs.slice(0, 8).join(' '), preset = /волейбол|volleyball/iu.test(intro) ? 'volleyball' : /ұстаз|учител|teachers/iu.test(intro) ? 'teachers' : /арнау|посвящени|induction/iu.test(intro) ? 'dedication' : /жарыс|спорт|турнир|sport/iu.test(intro) ? 'sport' : 'general';
  const blocks = [], seen = new Set();
  for (const text of doc.paragraphs) {
    if (text.length > 180 || /^(?:\d[- ]?(?:ші|шi)?\s*)?(?:жүргізуші|ведущий|host)\s*[:：]/iu.test(text)) continue;
    for (const [id, title, pattern] of BLOCKS) if (!seen.has(id) && pattern.test(text)) { blocks.push({ key: id, title }); seen.add(id); break; }
  }
  if (blocks.length < 2) invalid('Не удалось выделить структуру. Добавьте отдельные заголовки, например «Открытие», «Речь ректора», «Награждение», «Закрытие». Полные реплики и имена из образца не переносятся.');
  return { id: 'sample_' + crypto.randomUUID().slice(0, 8), preset, title: ({ teachers: 'День учителя', dedication: 'Посвящение в студенты', volleyball: 'Волейбольный турнир', sport: 'Спортивное событие', general: 'Мероприятие' })[preset], blocks: blocks.slice(0, 16), created: Date.now() };
}
export function importIsCurrent(store, chat, payload) {
  const session = store.get(chat);
  return store.meta('admin_owner_id') === chat && session.step === 'admin_import_loading' && session.import_nonce === payload.nonce && session.import_mode === payload.mode && Date.now() - session.import_started < IMPORT_TTL;
}
export function failDocumentImport(store, chat, nonce, message = 'Не удалось загрузить документ. Откройте импорт в админ-панели и отправьте файл ещё раз.') {
  const session = store.get(chat); if (session.import_nonce !== nonce || !session.step?.startsWith('admin_import_')) return false;
  store.put(chat, { ...session, step: 'admin_import_upload' });
  store.send(chat, message, [[{ text: 'Отмена', callback_data: `admin:import_cancel:${nonce}` }]]); return true;
}
export function completeDocumentImport(store, chat, payload, bytes) {
  if (!importIsCurrent(store, chat, payload)) return false;
  try {
    const doc = extractDocx(bytes), proposal = payload.mode === 'directory' ? directoryProposal(doc, store) : sampleProposal(doc), session = store.get(chat);
    const changes = payload.mode === 'directory' ? proposal.map((p, i) => `${i + 1}. ${p.previous ? 'Обновить' : 'Добавить'}: ${p.name}\n${p.role}${p.previous ? `\nСейчас: ${p.previous.name} · ${p.previous.role}` : ''}`).join('\n\n') : `${proposal.title}\n` + proposal.blocks.map((block, i) => `${i + 1}. ${block.title[0]}`).join('\n');
    store.put(chat, { ...session, step: 'admin_import_review', import_proposal: proposal, import_revision: store.meta(payload.mode === 'directory' ? 'directory_revision' : 'samples_revision', 0) });
    store.send(chat, (payload.mode === 'directory' ? 'Проверьте ФИО и должности перед публикацией. Эти записи станут общими для пользователей; остальные записи сохранятся.\n\n' : 'Проверьте структуру образца. Сохраняются только эти названия блоков; имена, реплики и данные участников из файла не сохраняются.\n\n') + changes + '\n\nПодтверждение действует 15 минут с начала загрузки.', [[{ text: '✅ Подтвердить и опубликовать', callback_data: `admin:import_confirm:${payload.nonce}` }], [{ text: '❌ Отменить', callback_data: `admin:import_cancel:${payload.nonce}` }]]);
    return true;
  } catch (error) { if (!(error instanceof ImportError)) throw error; return failDocumentImport(store, chat, payload.nonce, error.message); }
}
export function clearImport(session) { const next = { ...session }; for (const k of Object.keys(next)) if (k.startsWith('import_')) delete next[k]; return next; }
export function handleImport(dialogue, chat, text, callback, document) {
  const store = dialogue.store, session = store.get(chat), [action, value] = callback.slice(6).split(':');
  if (action === 'import' && ['directory', 'sample'].includes(value)) {
    store.cancel(chat);
    const nonce = crypto.randomUUID().replaceAll('-', '');
    store.put(chat, { ...clearImport(session), admin_return_step: session.admin_return_step || (session.step?.startsWith('admin_') ? 'type' : session.step), step: 'admin_import_upload', import_mode: value, import_nonce: nonce, import_started: Date.now() });
    store.send(chat, value === 'directory' ? 'Отправьте Word .docx до 1 МБ с колонками «ФИО» и «Должность». Можно также строки «ФИО; должность». Импортируются ректор, проректоры, деканы и заведующие кафедрами. Сначала покажу изменения для подтверждения.' : 'Отправьте сценарий Word .docx до 1 МБ. Выделю последовательность блоков и покажу перед сохранением. Полные реплики, имена участников и личные контакты в общие образцы не попадут.', [[{ text: 'Отмена', callback_data: `admin:import_cancel:${nonce}` }]]); return true;
  }
  if (action === 'import_cancel' || action === 'import_confirm') {
    if (!value || value !== session.import_nonce || !session.step?.startsWith('admin_import_') || Date.now() - session.import_started >= IMPORT_TTL) { store.send(chat, 'Эта кнопка устарела. Откройте импорт заново через /admin.'); return true; }
    if (action === 'import_confirm') {
      if (session.step !== 'admin_import_review' || !session.import_proposal) return true;
      const revisionKey = session.import_mode === 'directory' ? 'directory_revision' : 'samples_revision';
      if (session.import_revision !== store.meta(revisionKey, 0)) { store.send(chat, 'Данные изменились после просмотра. Загрузите документ повторно, чтобы проверить актуальные изменения.'); return true; }
      if (session.import_mode === 'directory') {
        const people = session.import_proposal, overrides = store.meta('directory_overrides', {}), extra = store.meta('directory_extra', []), all = catalog(store);
        if (all.length + people.filter(p => !p.previous).length > 60) { store.send(chat, 'В справочнике может быть до 60 записей. Уменьшите список для импорта.'); return true; }
        store.setMeta('directory_undo', { overrides, extra });
        const updated = { ...overrides }, added = [...extra];
        for (const person of people) {
          const old = all.find(p => p.id === person.id), values = { name: person.name, nameKk: old && key(old.name) === key(person.name) ? old.nameKk || person.name : person.name, role: person.role, roleKk: person.role, group: person.group, short: `${person.role.slice(0, 22)} · ${person.name.split(' ')[0]}`, degree: '', aliases: [person.name.split(' ')[0].toLocaleLowerCase()] };
          if (old) updated[person.id] = values; else added.push({ id: person.id, ...values, source: 'owner_document' });
        }
        store.setMeta('directory_overrides', updated); store.setMeta('directory_extra', added);
      } else {
        const samples = store.meta('approved_samples', []); store.setMeta('samples_undo', samples); store.setMeta('approved_samples', [...samples, session.import_proposal].slice(-5));
      }
      store.setMeta(revisionKey, store.meta(revisionKey, 0) + 1);
    }
    const next = clearImport(session); next.step = session.admin_return_step || 'type'; delete next.admin_return_step; store.put(chat, next);
    store.send(chat, action === 'import_cancel' ? 'Импорт отменён. Общие данные не изменены.' : session.import_mode === 'directory' ? 'Справочник обновлён. Старые черновики сохраняют свои ФИО. Последнее обновление можно отменить в админ-панели.' : 'Образец опубликован. Он доступен в конструкторе программы. Хранятся последние 5 образцов.', [[{ text: '⬅️ Админ-панель', callback_data: 'admin:open' }]]); return true;
  }
  if (action === 'samples') {
    const samples = store.meta('approved_samples', []);
    store.send(chat, samples.length ? 'Общие образцы программы:\n\n' + samples.map((s, i) => `${i + 1}. ${s.title} · ${s.blocks.length} блоков`).join('\n') : 'Загруженных образцов пока нет.', [[{ text: '📤 Загрузить образец Word', callback_data: 'admin:import:sample' }], [{ text: '↩️ Отменить последнее обновление образцов', callback_data: 'admin:samples_undo' }], [{ text: '⬅️ Админ-панель', callback_data: 'admin:open' }]]); return true;
  }
  if (action === 'samples_undo') {
    const undo = store.meta('samples_undo'); if (undo) { store.setMeta('approved_samples', undo); store.setMeta('samples_undo', null); store.setMeta('samples_revision', store.meta('samples_revision', 0) + 1); }
    store.send(chat, undo ? 'Последнее обновление образцов отменено.' : 'Обновлений образцов для отмены нет.'); return true;
  }
  if (document || session.step?.startsWith('admin_import_') && !callback) {
    if (session.step !== 'admin_import_upload') { store.send(chat, 'Сначала выберите «Загрузить Word» в /admin. Если файл уже обрабатывается, дождитесь списка изменений или отмените импорт.'); return true; }
    if (!document) { store.send(chat, 'Жду файл .docx как документ. /cancel — выйти.'); return true; }
    try { validateDocument(document); } catch (error) { if (!(error instanceof ImportError)) throw error; store.send(chat, error.message); return true; }
    store.put(chat, { ...session, step: 'admin_import_loading', import_started: Date.now() });
    store.send(chat, 'Читаю документ…');
    store.effect(chat, 'import_document', { file_id: document.file_id, nonce: session.import_nonce, mode: session.import_mode }); return true;
  }
  return false;
}
export function samplePrompt(session, store) {
  const sample = session.reference_sample || (session.sample_id && store?.meta('approved_samples', []).find(sample => sample.id === session.sample_id));
  if (!sample?.blocks?.length) return '';
  const language = session.language === 'kk' ? 1 : session.language === 'en' ? 2 : 0;
  return '\nПодтверждённый образец структуры (только ориентир; текущая программа и факты задания имеют приоритет):\n' + sample.blocks.map(b => b.title[language]).join(' → ') + '\nИмена, даты, участники и реплики исходного файла не были импортированы; не придумывай их.';
}

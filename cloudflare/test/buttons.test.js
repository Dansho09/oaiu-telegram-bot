import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeButtons } from '../src/buttons.js';
import { fixture } from './fixture.js';
import { keyboard, resultButtons, RETRY_BUTTONS } from '../src/core.js';
import { FORMATS, LANGUAGES, TONES } from '../src/ui.js';
import { PEOPLE, showDirectory } from '../src/directory.js';
import { showAdmin } from '../src/admin.js';
import { showProfiles, showDuration, showSettings, showProgram, PROGRAM_LIBRARY } from '../src/scenario.js';
let sequence=830000;
const base={step:'ready',format:'script',event_preset:'volleyball',event_minutes:120,host_count:2,host_names:['Алия','Ернар'],stage_key:'gym',result:'Готовый текст',brief:'Тест',script_data:{blocks:[{title:'Test',start:0,end:120,cue:'Test',lines:{host_1:'One',host_2:'Two'}}]}};
const tap=data=>({update_id:sequence++,callback_query:{id:String(sequence),data,from:{id:81},message:{chat:{id:81,type:'private'}}}});
const payloads=f=>f.store.rows("SELECT payload FROM outbox WHERE kind='message'").map(r=>JSON.parse(r.payload));
const local=(rows,s={},store)=>localizeButtons(rows,s,store).flat();
const textFor=(callback,s={},store,original='Русская кнопка')=>local([[{text:original,callback_data:callback}]],s,store)[0].text;
const forbidden=/Речь|Благодарность|Торжественнее|Скачать|Новый текст|Короче|Другой вариант|Уточнить данные|Подтвердить|Отмена|Добавить|Ведущий|Ведущие|Кафедры|Русский|English|Continue|Duration|Save program|Owner templates|Rename|Back to|Выше|Ниже|Удалить|название|Образцы|Проректор по/iu;
function check(rows,s={},store){
 const output=local(rows,s,store);
 for(const b of output){assert.ok(b.text);assert.ok(!forbidden.test(b.text),b.callback_data+' → '+b.text);assert.notEqual(b.text,'Таңдау','missing label: '+b.callback_data);}
 assert.deepEqual(output.map(b=>b.callback_data),rows.flat().map(b=>b.callback_data));
 return output;
}
test('all main format, language, length, tone and result controls use Kazakh for every content language',()=>{
 for(const language of ['ru','kk','en']){
  const s={...base,language};
  for(const rows of [keyboard(FORMATS,'type'),keyboard(LANGUAGES,'language'),keyboard(TONES,'tone'),keyboard({1:'Коротко',3:'Стандарт',5:'Подробно'},'length'),resultButtons(s),RETRY_BUTTONS]) check(rows,s);
  assert.equal(textFor('translate:ru',s),'Орысша');assert.equal(textFor('translate:en',s),'Ағылшынша');assert.equal(textFor('type:script',s),'🎭 Сценарий');
 }
});
test('generated wizard, directory, program and owner menus have no untranslated action labels',()=>{
 for(const language of ['ru','kk','en']){
  const f=fixture(),s={...base,language}; f.store.put(81,s);
  showProfiles(f.store,81,s);showDuration(f.store,81,s);showSettings(f.store,81,s);showDirectory(f.store,81,s,'all');showDirectory(f.store,81,s,'deans');showDirectory(f.store,81,s,'departments');showAdmin(f.store,81,s);
  for(const p of payloads(f))if(p.reply_markup)check(p.reply_markup.inline_keyboard,f.store.get(81),f.store);
  f.store.exec('DELETE FROM outbox');showProgram(f.store,81,s);let current=f.store.get(81);for(const p of payloads(f))if(p.reply_markup)check(p.reply_markup.inline_keyboard,current,f.store);
  const opening=textFor(`program:view:${current.program_revision}:${current.program_blocks[0].id}`,current,f.store);assert.match(opening,/Ашылу/);assert.match(opening,/минут/);
 }
});
test('event options and program actions cover all dynamic callback families',()=>{
 const callbacks=['event:start:none','event:hosts:1','event:hosts:4','event:duration:30','event:duration:60','event:duration:90','event:duration:custom',
  'event:stage:right_left','event:stage:left_right','event:stage:gym','event:stage:custom','event:ready',
  ...['add','done','cancel','back','time','rename','up','down','remove','samples','custom'].map(a=>`program:${a}:nonce:block`),
  ...Object.keys(PROGRAM_LIBRARY).map(k=>`program:pick:nonce:${k}`)];
 for(const language of ['ru','kk','en'])check([callbacks.map(callback_data=>({text:'Russian or English',callback_data}))],{...base,language});
 assert.equal(textFor('event:duration:90'),'1,5 сағат');assert.equal(textFor('event:ready',{script_editing:true}),'✅ Сценарийді жаңарту');
});
test('admin import nonce, directory groups, pagination and file downloads retain protocol values',()=>{
 const callbacks=['admin:import_confirm:nonce-123','admin:import_cancel:nonce-123','admin:import:directory','admin:import:sample','admin:samples','admin:samples_undo',
 ...['leadership','deans','departments'].flatMap(group=>[`admin:list:${group}`,`admin:group:${group}`]),
 'sheet:menu','sheet:sound','sheet:coordinator','sheet:host_1','sheet:host_2','sheetdoc:docx:host_1','sheetdoc:pdf:coordinator','sheetdoc:txt:sound','export:docx','export:pdf','export:txt','check:open','check:fix','delete:confirm','delete:cancel'];
 for(const language of ['ru','kk','en'])check([callbacks.map(callback_data=>({text:'Русский текст',callback_data}))],{...base,language});
 assert.equal(textFor('admin:list:deans:1',{},null,'▶'),'▶');assert.equal(textFor('admin:import_confirm:dynamic'),'✅ Растау және жариялау');
});
test('directory buttons use Kazakh names and roles, preserving selected marks and owner changes',()=>{
 const f=fixture();
 for(const language of ['ru','kk','en']){
  const s={language,people:['rector']};const name=textFor('person:rector',s,f.store);assert.match(name,/^✅ OAIU ректоры/);assert.match(name,/Ажидинов/);
  for(const person of PEOPLE) check([[{text:person.short,callback_data:'person:'+person.id},{text:person.short,callback_data:'admin:person:'+person.id}]],s,f.store);
 }
 f.store.setMeta('directory_overrides',{rector:{name:'Новый Ректор',nameKk:'Жаңа Басшы',roleKk:'OAIU ректоры'}});assert.match(textFor('person:rector',{},f.store),/Жаңа Б\./);
 f.store.setMeta('directory_extra',[{id:'custom_dean',name:'Иван Иванов',roleKk:'Декан экономического факультета',group:'deans'}]);assert.equal(textFor('person:custom_dean',{},f.store),'Декан · Иван И.');
});
test('role names use the finished snapshot and user-authored titles remain data',()=>{
 const s={...base,host_names:['Новые','Имена'],result_context:{...base,host_names:['Дана','Әли']}};
 assert.equal(textFor('sheet:host_1',s),'🎤 Жүргізуші 1 · Дана');
 const title='Мой собственный сценарий';assert.equal(textFor('history:123',s,null,title),title);
 s.program_blocks=[{id:'custom',titles:['Мой танец','Мой танец','Мой танец'],minutes:7}];assert.equal(textFor('program:view:nonce:custom',s),'1. Мой танец · 7 минут');
});
test('owner sample titles are translated by canonical title or preset for all content languages',()=>{
 const f=fixture();f.store.setMeta('approved_samples',[{id:'sample1',title:'День учителя',preset:'teachers'},{id:'sample2',title:'Мероприятие',preset:'general'},{id:'sample3',title:'Спортивное событие',preset:'sport'}]);
 for(const language of ['ru','kk','en']){
  assert.equal(textFor('program:use:nonce:sample1',{language},f.store),'Ұстаздар күні');
  assert.equal(textFor('program:use:nonce:sample2',{language},f.store),'Іс-шара');
  assert.equal(textFor('program:use:nonce:sample3',{language},f.store),'Спорттық іс-шара');
 }
});
test('localization is immutable and unknown controls fail to a Kazakh action rather than Russian static text',()=>{
 const rows=[[{text:'Скачать',callback_data:'future:unknown',extra:42},{text:'Открыть',url:'https://example.com'}]],copy=structuredClone(rows),session={language:'en'};
 const output=localizeButtons(rows,session);assert.deepEqual(rows,copy);assert.equal(output[0][0].text,'Таңдау');assert.equal(output[0][1].text,'Ашу');assert.equal(output[0][0].extra,42);assert.equal(session.language,'en');assert.equal(localizeButtons(null),null);
});

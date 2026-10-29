import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.js';
import {PUBLIC_COMMANDS} from '../src/admin.js';
import {resultButtons} from '../src/core.js';

let sequence=2200000;
const chat=610;
const ready={step:'ready',format:'speech',language:'kk',tone:'warm',length:'3',brief:'Ертең OAIU акт залында кездесу болады.',result:'Құрметті қонақтар! Кездесуімізге қош келдіңіздер.'};
const scenario={...ready,format:'script',event_minutes:60,event_start:840,host_count:2,stage_key:'right_left'};
const send=(f,text,c=chat,username)=>f.dialogue.accept({update_id:sequence++,message:{chat:{id:c,type:'private'},from:{id:c,...username?{username}:{}},text}});
const tap=(f,data,c=chat)=>f.dialogue.accept({update_id:sequence++,callback_query:{id:String(sequence),from:{id:c},data,message:{chat:{id:c,type:'private'}}}});
const messages=(f,c=chat)=>f.store.rows("SELECT payload FROM outbox WHERE kind='message' AND chat_id=? ORDER BY id",c).map(r=>JSON.parse(r.payload));
const last=(f,c=chat)=>messages(f,c).at(-1);
const buttons=m=>(m.reply_markup?.inline_keyboard||[]).flat();
const callbacks=m=>buttons(m).map(b=>b.callback_data);

test('published command menu stays small and all user captions are Kazakh',()=>{
 assert.deepEqual(PUBLIC_COMMANDS.map(c=>c.command),['start','help']);
 assert.ok(PUBLIC_COMMANDS.every(c=>/[әғқңөұүі]/iu.test(c.description)));
});

test('first start offers six clear actions and a persistent home button',()=>{
 const f=fixture();send(f,'/start');
 const primary=['nav:create','nav:script','nav:voice','nav:history','nav:organize','nav:help'];
 assert.deepEqual(new Set(callbacks(last(f))),new Set(primary));
 assert.ok(buttons(last(f)).every(b=>b.text!=='Таңдау'&&!/\/[a-z]+/u.test(b.text)));
 const persistent=messages(f).find(m=>m.reply_markup?.keyboard);
 assert.ok(persistent,'a home reply button must remain available after inline pages');
 assert.deepEqual(persistent.reply_markup.keyboard.flat().map(b=>typeof b==='string'?b:b.text),['🏠 Басты мәзір']);
});

test('home and help preserve an active generation and completed text',()=>{
 const f=fixture();f.store.put(chat,ready);
 const job={id:'active-generation',session:{...ready},instruction:'Мәтінді жылы ет.',next_at:Date.now()+60000};
 f.store.saveJob(chat,job);
 for(const action of ['nav:home','nav:help','nav:organize','nav:home']){
  tap(f,action);assert.deepEqual(f.store.get(chat),ready);assert.deepEqual(f.store.job(chat),job);
 }
 assert.ok(callbacks(last(f)).includes('nav:current'));
 send(f,'/start');assert.deepEqual(f.store.get(chat),ready);assert.deepEqual(f.store.job(chat),job);
});

test('the reply home button cannot become a brief, voice correction or owner directory record',()=>{
 for(const session of [
  {...ready,step:'brief',result:undefined},
  {...ready,step:'voice_edit',voice_return_step:'ready',voice_request:{nonce:'current',started:Date.now(),text:'Бұрынғы танылған мәтін',raw_text:'Бұрынғы танылған мәтін',language:'kk'}},
  {...ready,step:'admin_add',admin_group:'leadership',admin_return_step:'ready'},
 ]){
  const f=fixture();f.store.put(chat,session);f.store.setMeta('admin_owner_id',chat);
  const before=f.store.get(chat);send(f,'🏠 Басты мәзір');
  assert.deepEqual(f.store.get(chat),before);assert.equal(f.store.job(chat),null);
  assert.equal(f.store.meta('directory_extra',[]).length,0);
  assert.ok(callbacks(last(f)).includes('nav:create'));
 }
});

test('a beginner creates a text, downloads it and edits it entirely with buttons',()=>{
 const f=fixture();send(f,'/start');tap(f,'nav:create');
 assert.ok(callbacks(last(f)).includes('type:speech'));
 for(const action of ['type:speech','language:kk','length:1','tone:warm','staff:none'])tap(f,action);
 send(f,'Ертең акт залында жаңа студенттерге құттықтау сөз керек.');
 const job=f.store.job(chat);assert.ok(job);assert.equal(job.session.language,'kk');
 f.store.finish(chat,job.id,job.session,ready.result);
 assert.ok(callbacks(last(f)).includes('export:menu'));assert.ok(callbacks(last(f)).includes('nav:edit'));
 tap(f,'export:menu');assert.ok(callbacks(last(f)).includes('export:docx'));tap(f,'export:docx');
 const document=JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='document' ORDER BY id DESC LIMIT 1").payload);
 assert.equal(document.format,'docx');assert.equal(document.text,ready.result);
 tap(f,'nav:edit');assert.ok(callbacks(last(f)).includes('edit:short'));tap(f,'edit:short');
 assert.ok(f.store.job(chat));assert.match(f.store.job(chat).instruction,/Сократи/u);
});

test('finished text controls stay compact while edit and translation choices remain reachable',()=>{
 for(const session of [ready,scenario]){
  const compact=resultButtons(session).flat();assert.ok(compact.length<=4);
  assert.ok(compact.some(b=>b.callback_data==='nav:edit'));
  assert.ok(compact.some(b=>b.callback_data==='export:menu'));
  assert.ok(compact.some(b=>b.callback_data==='nav:home'));
 }
 const f=fixture();f.store.put(chat,ready);tap(f,'nav:edit');
 for(const action of ['edit:short','edit:formal','edit:thanks','edit:simple','edit:custom','again:yes','nav:language'])assert.ok(callbacks(last(f)).includes(action),action);
 tap(f,'nav:language');assert.deepEqual(new Set(callbacks(last(f)).filter(c=>c.startsWith('translate:'))),new Set(['translate:kk','translate:ru','translate:en']));
 assert.deepEqual(f.store.get(chat),ready);
});

test('event features are grouped and discoverable without slash commands',()=>{
 const f=fixture();f.store.put(chat,scenario);tap(f,'nav:organize');
 for(const action of ['nav:program','nav:people','awards:open','tournament:open','nav:live'])assert.ok(callbacks(last(f)).includes(action),action);
 tap(f,'nav:program');for(const action of ['program:open','event:config','sheet:menu'])assert.ok(callbacks(last(f)).includes(action),action);
 tap(f,'nav:people');for(const action of ['staff:open','guest:open'])assert.ok(callbacks(last(f)).includes(action),action);
 tap(f,'nav:live');for(const action of ['check:open','ops:open','rehearsal:open','lock:open'])assert.ok(callbacks(last(f)).includes(action),action);
 assert.deepEqual(f.store.get(chat),scenario);assert.equal(f.store.job(chat),null);
 assert.ok(messages(f).every(m=>!/\/(?:tools|new|help|program|sheets)\b/u.test(m.text)));
});

test('help exposes privacy and deletion as buttons instead of a command catalogue',()=>{
 const f=fixture();send(f,'/help');
 assert.ok(last(f).text.length<1600);assert.ok(!/\/[a-z]+/u.test(last(f).text));
 for(const action of ['nav:privacy','nav:delete','nav:home'])assert.ok(callbacks(last(f)).includes(action),action);
 tap(f,'nav:privacy');assert.match(last(f).text,/Telegram/u);
 tap(f,'nav:delete');assert.ok(callbacks(last(f)).includes('delete:confirm'));
});

test('owner panel is shown only to its bound owner and direct callbacks remain checked',()=>{
 const f=fixture();f.store.setMeta('admin_owner_id',chat);
 send(f,'/start');assert.ok(callbacks(last(f)).includes('admin:open'));
 send(f,'/start',chat+1);assert.ok(!callbacks(last(f,chat+1)).includes('admin:open'));
 tap(f,'admin:open',chat+1);assert.match(last(f,chat+1).text,/қолжетімсіз/u);
});

test('starting new work requires a current explicit confirmation before cancelling a job',()=>{
 const f=fixture();f.store.put(chat,ready);
 const job={id:'keep-until-confirmed',session:{...ready},instruction:'Қысқарт.'};f.store.saveJob(chat,job);
 f.store.exec('INSERT INTO drafts(id,chat_id,title,text,context) VALUES (1,?,?,?,?)',chat,'Бұрынғы мәтін',ready.result,'{}');
 tap(f,'nav:create');
 let confirm=callbacks(last(f)).find(c=>c.startsWith('nav:confirm_new:'));assert.ok(confirm);
 assert.equal(f.store.get(chat).result,ready.result);assert.deepEqual(f.store.job(chat),job);
 tap(f,'nav:current');assert.deepEqual(f.store.job(chat),job);
 tap(f,confirm);assert.deepEqual(f.store.job(chat),job,'returning to current work cancels the pending reset confirmation');
 tap(f,'nav:create');confirm=callbacks(last(f)).find(c=>c.startsWith('nav:confirm_new:'));assert.ok(confirm);
 tap(f,confirm);assert.equal(f.store.job(chat),null);assert.equal(f.store.get(chat).step,'type');
 assert.equal(f.store.get(chat).result,undefined);assert.ok(callbacks(last(f)).includes('type:speech'));
 assert.equal(f.store.one('SELECT text FROM drafts WHERE id=1 AND chat_id=?',chat).text,ready.result);
 tap(f,'type:speech');const languageStep=f.store.get(chat);tap(f,confirm);
 assert.deepEqual(f.store.get(chat),languageStep,'a replayed confirmation cannot reset a newer wizard');
});

test('a reset confirmation issued before a later text edit cannot cancel the newer generation',()=>{
 const f=fixture();f.store.put(chat,ready);tap(f,'nav:create');
 const confirm=callbacks(last(f)).find(c=>c.startsWith('nav:confirm_new:'));assert.ok(confirm);
 tap(f,'nav:edit');tap(f,'edit:short');
 const edited=f.store.get(chat),job=f.store.job(chat);assert.ok(job);assert.match(job.instruction,/Сократи/u);
 tap(f,confirm);assert.deepEqual(f.store.job(chat),job);
 for(const key of ['step','result','brief','format','language'])assert.equal(f.store.get(chat)[key],edited[key]);
});

test('new scenario entry preserves existing work until confirmation and then opens the scenario wizard',()=>{
 const f=fixture();f.store.put(chat,ready);tap(f,'nav:script');
 const confirm=callbacks(last(f)).find(c=>c.startsWith('nav:confirm_new:'));assert.ok(confirm);
 assert.equal(f.store.get(chat).result,ready.result);tap(f,confirm);
 assert.equal(f.store.get(chat).format,'script');assert.equal(f.store.get(chat).step,'language');
 assert.ok(callbacks(last(f)).includes('language:kk'));
});

test('returning to the current wizard replays the actual saved question without changing choices',()=>{
 const f=fixture();send(f,'/start');tap(f,'nav:create');tap(f,'type:speech');tap(f,'language:kk');tap(f,'length:1');
 const prompt=last(f),session=f.store.get(chat);assert.equal(session.step,'tone');
 tap(f,'nav:home');tap(f,'nav:help');tap(f,'nav:current');
 assert.equal(last(f).text,prompt.text);assert.deepEqual(callbacks(last(f)),callbacks(prompt));
 assert.deepEqual(f.store.get(chat),session);assert.equal(f.store.job(chat),null);
});

test('an unavailable organizer tool cannot replace the question of an unfinished wizard',()=>{
 const f=fixture();send(f,'/start');tap(f,'nav:create');tap(f,'type:speech');
 const prompt=last(f),session=f.store.get(chat);
 assert.equal(session.step,'language');assert.ok(callbacks(prompt).includes('language:kk'));
 const remembered=f.store.one('SELECT value FROM navigation_views WHERE chat_id=?',chat).value;
 tap(f,'nav:home');tap(f,'nav:organize');tap(f,'awards:open');
 assert.deepEqual(f.store.get(chat),session);assert.equal(f.store.job(chat),null);
 assert.equal(f.store.one('SELECT value FROM navigation_views WHERE chat_id=?',chat).value,remembered);
 tap(f,'nav:current');assert.equal(last(f).text,prompt.text);assert.deepEqual(callbacks(last(f)),callbacks(prompt));
});

test('privacy, cancelled deletion and voice instructions preserve the original wizard prompt',()=>{
 const f=fixture();send(f,'/start');tap(f,'nav:create');tap(f,'type:speech');
 const prompt=last(f),session=f.store.get(chat);
 const remembered=f.store.one('SELECT value FROM navigation_views WHERE chat_id=?',chat).value;
 for(const action of ['nav:privacy','nav:delete','nav:voice']){
  tap(f,action);if(action==='nav:delete')tap(f,'delete:cancel');
  assert.deepEqual(f.store.get(chat),session,action);assert.equal(f.store.job(chat),null,action);
  assert.equal(f.store.one('SELECT value FROM navigation_views WHERE chat_id=?',chat).value,remembered,action);
  tap(f,'nav:current');assert.equal(last(f).text,prompt.text,action);assert.deepEqual(callbacks(last(f)),callbacks(prompt),action);
 }
});

test('speech preparation offers checks, fixed text and rehearsal without script-only replanning',()=>{
 const f=fixture();f.store.put(chat,ready);tap(f,'nav:home');tap(f,'nav:organize');tap(f,'nav:live');
 const offered=callbacks(last(f));assert.ok(offered.includes('check:open'));assert.ok(offered.includes('lock:open'));assert.ok(offered.includes('rehearsal:open'));
 assert.ok(!offered.includes('ops:open'));
 assert.deepEqual(f.store.get(chat),ready);assert.equal(f.store.job(chat),null);
});

test('deleting user data also clears their remembered prompt and preserves another user',()=>{
 const f=fixture();f.store.put(chat,{...ready,step:'brief'});f.store.send(chat,'Құпия тапсырма: А тобына сөз керек.');
 f.store.put(chat+1,{...ready,step:'brief'});f.store.send(chat+1,'Басқа пайдаланушының сұрағы.');
 assert.ok(f.store.one('SELECT value FROM navigation_views WHERE chat_id=?',chat));
 tap(f,'nav:delete');tap(f,'delete:confirm');
 const own=f.store.one('SELECT value FROM navigation_views WHERE chat_id=?',chat)?.value||'';
 assert.ok(!own.includes('Құпия тапсырма'));
 assert.ok(f.store.one('SELECT value FROM navigation_views WHERE chat_id=?',chat+1).value.includes('Басқа пайдаланушы'));
});

test('legacy commands still open their compatible feature entry points',()=>{
 const f=fixture();f.store.put(chat,scenario);
 send(f,'/tools');assert.ok(callbacks(last(f)).includes('nav:program'));
 send(f,'/word');assert.ok(f.store.one("SELECT 1 FROM outbox WHERE kind='document'"));
 send(f,'/voice');assert.match(last(f).text,/Дауыстық/u);
});

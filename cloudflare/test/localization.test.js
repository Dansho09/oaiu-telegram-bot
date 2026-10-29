import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixture.js';
import { messagesFor, resultButtons } from '../src/core.js';
import { captureResultContext } from '../src/companion.js';
let seq = 960000;
const send = text => ({update_id:seq++,message:{chat:{id:87,type:'private'},from:{id:87},text}});
const tap = data => ({update_id:seq++,callback_query:{id:String(seq),data,from:{id:87},message:{chat:{id:87,type:'private'}}}});
const latest = f => JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='message' ORDER BY id DESC LIMIT 1").payload).text;
test('new and reset sessions default to Kazakh even when the brief is Russian',()=>{
 const f=fixture();f.dialogue.accept(send('/start'));assert.equal(f.store.get(87).language,'kk');assert.match(latest(f),/Сәлем!|Не дайындаймыз/);
 f.dialogue.accept(send('Подготовь поздравление студентам университета.'));assert.equal(f.store.job(87).session.language,'kk');assert.match(messagesFor(f.store.job(87))[0].content,/Язык: Қазақша/);assert.equal(latest(f),'Мәтін дайындап жатырмын…');
 f.dialogue.accept(send('/new'));assert.equal(f.store.get(87).language,'kk');f.dialogue.accept(send('Нужен сценарий концерта на 60 минут.'));assert.equal(f.store.get(87).language,'kk');
});
test('explicit other output languages keep all wizard and command instructions in Kazakh',()=>{
 for(const language of ['ru','en']){
  const f=fixture();f.dialogue.accept(tap('type:speech'));f.dialogue.accept(tap('language:'+language));assert.match(latest(f),/Қандай көлем/);
  f.dialogue.accept(tap('length:1'));assert.match(latest(f),/Мәтіннің мәнерін таңдаңыз/);
  f.dialogue.accept(tap('tone:warm'));assert.match(latest(f),/Мәтінге кімді қосамыз/);
  f.dialogue.accept(tap('staff:none'));assert.match(latest(f),/Енді іс-шараны/);
  f.dialogue.accept(send('Студенттерге құттықтау.'));assert.equal(f.store.job(87).session.language,language);
  for(const [command,pattern] of [['/help',/Қалай қолданамын/],['/privacy',/Хабарламалар/],['/unknown',/Мұндай команда/],['/delete',/нобайларыңызды/]]){f.dialogue.accept(send(command));assert.match(latest(f),pattern);}
 }
});
test('kit offers only supported outputs while scripts expose team sheets',()=>{
 const callbacks = format => resultButtons({format}).flat().map(b=>b.callback_data);
 assert.ok(!callbacks('kit').includes('sheet:menu'));assert.ok(callbacks('kit').includes('nav:event'));assert.ok(callbacks('kit').includes('export:menu'));assert.ok(callbacks('script').includes('nav:event'));
 const f=fixture();f.store.put(87,{step:'ready',format:'kit',language:'ru',result:'Готовый комплект.'});f.dialogue.accept(send('/sheets'));assert.match(latest(f),/«Сценарий» форматына арналған/);assert.equal(f.store.job(87),null);
});
test('fact evidence is bounded, retained with history context, and forwarded to a new generation',()=>{
 const f=fixture();let s={step:'ready',format:'speech',language:'kk',brief:'Концерт',result:'Дайын мәтін.'};
 for(let i=0;i<25;i++){f.dialogue.generate(87,s,'Нақтылау '+i+' '+ 'а'.repeat(400));s=f.store.get(87);}
 assert.ok(s.event_fact_evidence.length<=20);assert.ok(s.event_fact_evidence.join('').length<=6000);assert.match(s.event_fact_evidence.at(-1),/Нақтылау 24/);
 const snapshot=captureResultContext(s);assert.deepEqual(snapshot.event_fact_evidence,s.event_fact_evidence);
 assert.ok(messagesFor(f.store.job(87))[0].content.includes(s.event_fact_evidence.at(-1)));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.js';
import {completeVoice,transcriptionOptions,voiceSuggestions} from '../src/voice.js';

let seq=1600000;
const chat=196;
const note={file_id:'quality-voice',file_size:1024,duration:12,mime_type:'audio/ogg'};
const ready={step:'ready',format:'speech',language:'ru',brief:'Бұрынғы тапсырма',result:'Бұрынғы дайын мәтін.'};
const message=(text='',voice)=>({update_id:seq++,message:{chat:{id:chat,type:'private'},from:{id:chat},text,...voice?{voice}:{}}});
const tap=(f,action,nonce=f.store.get(chat).voice_request?.nonce)=>f.dialogue.accept({update_id:seq++,callback_query:{id:String(seq),from:{id:chat},data:`voice:${action}:${nonce}`,message:{chat:{id:chat,type:'private'}}}});
const texts=f=>f.store.rows("SELECT payload FROM outbox WHERE kind='message'").map(r=>JSON.parse(r.payload).text);
const waiting=f=>JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='voice_transcribe'").payload);
const begin=()=>{const f=fixture();f.store.put(chat,ready);f.dialogue.accept(message('',note));return f;};
const review=(f,text)=>{tap(f,'transcribe');completeVoice(f.store,chat,waiting(f),{text,duration:12});};

test('ASR language options use localized spelling hints and auto leaves detection to the model',()=>{
 const kk=transcriptionOptions();
 assert.equal(kk.language,'kk');assert.match(kk.prompt,/ертең/iu);assert.match(kk.prompt,/іс-шара/iu);
 const ru=transcriptionOptions('ru'),en=transcriptionOptions('en');
 assert.equal(ru.language,'ru');assert.match(ru.prompt,/[а-я]/iu);
 assert.equal(en.language,'en');assert.match(en.prompt,/[a-z]/iu);
 for(const options of [kk,ru,en])assert.ok(options.prompt.length>0&&options.prompt.length<900,'spelling context should remain concise');
 assert.deepEqual(transcriptionOptions('auto'),{});
});

test('voice input defaults to Kazakh independently of the generated text language',()=>{
 const f=begin();
 assert.equal(f.store.get(chat).language,'ru');
 assert.equal(f.store.get(chat).voice_request.language,'kk');
 assert.match(texts(f).at(-1),/Қазақ/iu);
 tap(f,'transcribe');assert.equal(waiting(f).language,'kk');
 assert.equal(f.store.get(chat).language,'ru');assert.equal(f.store.job(chat),null);
});

test('voice consent selects the source language and freezes it into queued transcription',()=>{
 for(const language of ['ru','en','auto']){
  const f=begin();tap(f,`lang_${language}`);
  assert.equal(f.store.get(chat).step,'voice_consent');
  assert.equal(f.store.get(chat).voice_request.language,language);
  tap(f,'transcribe');assert.equal(waiting(f).language,language);
  assert.equal(f.store.get(chat).language,'ru');
 }
});

test('stale source-language buttons cannot modify a replacement voice request',()=>{
 const f=begin(),old=f.store.get(chat).voice_request.nonce;
 f.dialogue.accept(message('',note));tap(f,'lang_ru',old);
 assert.equal(f.store.get(chat).step,'voice_consent');
 assert.notEqual(f.store.get(chat).voice_request.nonce,old);
 assert.equal(f.store.get(chat).voice_request.language,'kk');
 assert.equal(f.store.one("SELECT COUNT(*) n FROM outbox WHERE kind='voice_transcribe'").n,0);
});

test('language changes during transcription or transcript review are ignored',()=>{
 const f=begin();tap(f,'transcribe');const payload=waiting(f);
 tap(f,'lang_en');assert.equal(f.store.get(chat).step,'voice_loading');
 assert.equal(f.store.get(chat).voice_request.language,'kk');assert.equal(waiting(f).language,'kk');
 completeVoice(f.store,chat,payload,{text:'Ертең іс-шара болады.',duration:12});
 tap(f,'lang_ru');assert.equal(f.store.get(chat).step,'voice_review');
 assert.equal(f.store.get(chat).voice_request.language,'kk');
 assert.equal(f.store.get(chat).voice_request.text,'Ертең іс-шара болады.');
});

test('Kazakh spelling suggestions respect Unicode word boundaries and preserve initial case',()=>{
 assert.equal(voiceSuggestions('ертен концерт болады.')[0]?.text,'ертең концерт болады.');
 assert.equal(voiceSuggestions('Ерсен концерт болады.')[0]?.text,'Ертең концерт болады.');
 assert.equal(voiceSuggestions('«ертен», 14:00.')[0]?.text,'«ертең», 14:00.');
 assert.deepEqual(voiceSuggestions('Ерсенов ерсеннің ертенгі суперертен.'),[]);
 assert.deepEqual(voiceSuggestions('Үш шара өткіземіз. Іс шаралар жоспарланған.'),[]);
 const event=voiceSuggestions('Ертең іс шара өтеді.').find(s=>s.id==='event');
 assert.equal(event?.text,'Ертең іс-шара өтеді.');
 assert.ok(event?.label);
 assert.deepEqual(voiceSuggestions('ертен іс шара болады.','ru'),[]);
 assert.deepEqual(voiceSuggestions('ертен іс шара болады.','en'),[]);
 assert.deepEqual(voiceSuggestions('ертен іс шара болады.','auto'),[]);
});

test('ASR output stays verbatim until a suggestion is explicitly chosen',()=>{
 const f=begin(),raw='Ерсен 2026-11-03 күні 14:00-де келеді. Үш шара өткіземіз.';
 review(f,`  ${raw}\n`);
 const request=f.store.get(chat).voice_request;
 assert.equal(request.raw_text,raw);assert.equal(request.text,raw);
 assert.equal(f.store.get(chat).result,ready.result);assert.equal(f.store.job(chat),null);
 assert.equal(voiceSuggestions(raw).find(s=>s.id==='event'),undefined);
});

test('ambiguous repeated tomorrow-like words never offer a bulk name correction',()=>{
 const raw='Ерсен ертен келеді. Үш шара 14:00-де.';
 assert.equal(voiceSuggestions(raw).find(s=>s.id==='tomorrow'),undefined);
 const f=begin();review(f,raw);tap(f,'suggest_tomorrow');
 assert.equal(f.store.get(chat).voice_request.text,raw);
 assert.equal(f.store.get(chat).voice_request.raw_text,raw);
 assert.equal(f.store.job(chat),null);
 const single=voiceSuggestions('Ерсенов ертен 14:00-де келеді. Үш шара өткіземіз.').find(s=>s.id==='tomorrow');
 assert.equal(single?.text,'Ерсенов ертең 14:00-де келеді. Үш шара өткіземіз.');
});

test('chosen correction preserves the original, people, counts and dates and still needs apply',()=>{
 const f=begin(),raw='ертен 2026-11-03 күні 14:00-де Айдана 3 іс шара өткізеді.';
 review(f,raw);tap(f,'suggest_tomorrow');
 assert.equal(f.store.get(chat).voice_request.text,'ертең 2026-11-03 күні 14:00-де Айдана 3 іс шара өткізеді.');
 assert.equal(f.store.get(chat).voice_request.raw_text,raw);assert.equal(f.store.job(chat),null);
 tap(f,'suggest_event');
 const corrected='ертең 2026-11-03 күні 14:00-де Айдана 3 іс-шара өткізеді.';
 assert.equal(f.store.get(chat).voice_request.text,corrected);
 assert.equal(f.store.get(chat).voice_request.raw_text,raw);assert.equal(f.store.job(chat),null);
 tap(f,'original');
 assert.ok(texts(f).at(-1).includes(raw));
 assert.equal(f.store.get(chat).voice_request.text,corrected);
 assert.equal(f.store.get(chat).voice_request.raw_text,raw);assert.equal(f.store.job(chat),null);
 tap(f,'apply');assert.equal(f.store.job(chat).instruction,corrected);
});

test('manual transcript editing retains the original and rejects stale correction buttons',()=>{
 const f=begin(),raw='Ерсен іс шара өткіземіз деді.';
 review(f,raw);const old=f.store.get(chat).voice_request.nonce;
 tap(f,'edit');f.dialogue.accept(message('Ерсен үш шара өткіземіз деді.'));
 assert.equal(f.store.get(chat).voice_request.raw_text,raw);
 assert.equal(f.store.get(chat).voice_request.text,'Ерсен үш шара өткіземіз деді.');
 f.dialogue.accept(message('',note));review(f,'ертен концерт болады.');
 tap(f,'suggest_tomorrow',old);
 assert.equal(f.store.get(chat).voice_request.text,'ертен концерт болады.');
 assert.equal(f.store.get(chat).voice_request.raw_text,'ертен концерт болады.');
 assert.equal(f.store.job(chat),null);
});

test('only transcript review permits corrections and viewing the original',()=>{
 const f=begin();
 for(const action of ['suggest_tomorrow','suggest_event','original'])tap(f,action);
 assert.equal(f.store.get(chat).step,'voice_consent');assert.equal(f.store.get(chat).voice_request.text,undefined);
 tap(f,'transcribe');
 for(const action of ['suggest_tomorrow','suggest_event','original'])tap(f,action);
 assert.equal(f.store.get(chat).step,'voice_loading');assert.equal(f.store.get(chat).voice_request.text,undefined);
 assert.equal(f.store.job(chat),null);
});

test('transport sends the chosen source language and leaves auto detection unforced',async()=>{
 for(const language of ['kk','ru','en','auto']){
  const f=begin();tap(f,`lang_${language}`);tap(f,'transcribe');
  f.bot.telegram=async method=>method==='getFile'?{file_path:'voice/file.oga',file_size:20}:{};
  const originalFetch=globalThis.fetch;let asr=0;
  globalThis.fetch=async(url,options)=>{
   if(String(url).startsWith('https://api.telegram.org/file/'))return new Response('OggS');
   assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');asr++;
   assert.equal(options.body.get('language'),language==='auto'?null:language);
   assert.equal(options.body.get('temperature'),'0');
   assert.equal(options.body.get('model'),'whisper-large-v3');
   assert.equal(options.body.get('response_format'),'verbose_json');
   if(language!=='auto')assert.equal(options.body.get('prompt'),transcriptionOptions(language).prompt);
   return Response.json({text:'Концерт болады.',duration:12});
  };
  try{await f.bot.flushOutbox();assert.equal(asr,1);assert.equal(f.store.get(chat).step,'voice_review');}
  finally{globalThis.fetch=originalFetch;}
 }
});

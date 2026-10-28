import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.js';
import {validateVoice,readVoiceBytes,VoiceError,completeVoice,voiceIsCurrent,MAX_VOICE_BYTES,voiceBriefCard} from '../src/voice.js';
let seq=1100000;
const note={file_id:'voice-file',file_size:1024,duration:10,mime_type:'audio/ogg'};
const msg=(text,voice,chat=96)=>({update_id:seq++,message:{chat:{id:chat,type:'private'},from:{id:chat},text,...voice?{voice}:{}}});
const tap=(f,action,chat=96,nonce=f.store.get(chat).voice_request?.nonce)=>f.dialogue.accept({update_id:seq++,callback_query:{id:String(seq),from:{id:chat},data:`voice:${action}:${nonce}`,message:{chat:{id:chat,type:'private'}}}});
const texts=f=>f.store.rows("SELECT payload FROM outbox WHERE kind='message'").map(r=>JSON.parse(r.payload).text);
const waiting=f=>JSON.parse(f.store.one("SELECT payload FROM outbox WHERE kind='voice_transcribe'").payload);
const ready={step:'ready',format:'speech',language:'kk',brief:'Ескі тапсырма',result:'Дайын мәтін.'};
test('voice bounds and streamed limit reject oversized malformed or non-audio input',async()=>{
 assert.equal(validateVoice(note).file_id,note.file_id);
 for(const changed of [{duration:181},{file_size:MAX_VOICE_BYTES+1},{file_size:undefined},{mime_type:'application/pdf'},{file_id:''}])assert.throws(()=>validateVoice({...note,...changed}),VoiceError);
 await assert.rejects(readVoiceBytes(new Response(new Uint8Array(MAX_VOICE_BYTES+1))),VoiceError);
});
test('no audio is downloaded or sent to Groq before user opt-in and transcript confirmation',()=>{
 const f=fixture();f.store.put(96,ready);f.dialogue.accept(msg('',note));assert.equal(f.store.get(96).step,'voice_consent');assert.equal(f.store.one("SELECT COUNT(*) n FROM outbox WHERE kind='voice_transcribe'").n,0);assert.match(texts(f).at(-1),/Groq/);
 tap(f,'transcribe');const payload=waiting(f);assert.equal(voiceIsCurrent(f.store,96,payload),true);assert.equal(f.store.job(96),null);
 completeVoice(f.store,96,payload,{text:'Ұйымдастырушыларға алғыс қос.'});assert.equal(f.store.get(96).step,'voice_review');assert.equal(f.store.job(96),null);assert.equal(f.store.get(96).result,ready.result);
 tap(f,'edit');f.dialogue.accept(msg('Қонақтарға алғыс қос.'));assert.equal(f.store.get(96).voice_request.text,'Қонақтарға алғыс қос.');tap(f,'apply');assert.equal(f.store.job(96).instruction,'Қонақтарға алғыс қос.');assert.equal(f.store.get(96).voice_request,undefined);
});
test('voice cancellation expiry and replacement suppress stale results and preserve ready text',()=>{
 const f=fixture();f.store.put(96,ready);f.dialogue.accept(msg('',note));tap(f,'transcribe');const old=waiting(f);tap(f,'cancel');assert.equal(completeVoice(f.store,96,old,{text:'Ескі нәтиже'}),false);assert.equal(f.store.get(96).result,ready.result);
 f.dialogue.accept(msg('',note));const nonce=f.store.get(96).voice_request.nonce;f.dialogue.accept(msg('',note));tap(f,'transcribe',96,nonce);assert.equal(f.store.get(96).step,'voice_consent');
 const s=f.store.get(96);s.voice_request.started=Date.now()-16*60000;f.store.put(96,s);tap(f,'transcribe');assert.equal(f.store.get(96).step,'ready');assert.equal(f.store.get(96).voice_request,undefined);
});
test('voice transcript cannot execute slash commands and other users cannot use its token',()=>{
 const f=fixture();f.store.put(96,ready);f.dialogue.accept(msg('',note));tap(f,'transcribe');const p=waiting(f);completeVoice(f.store,96,p,{text:'/delete'});tap(f,'apply',97,p.nonce);assert.equal(f.store.get(96).step,'voice_review');tap(f,'apply');assert.equal(f.store.get(96).result,ready.result);assert.equal(f.store.job(96),null);
});
test('voice transport uses bounded Telegram download and multipart multilingual transcription',async()=>{
 const f=fixture();f.dialogue.accept(msg('',note));tap(f,'transcribe');f.bot.telegram=async(method,payload)=>method==='getFile'?{file_path:'voice/file.oga',file_size:1024}:{};
 const oldFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});if(String(url).startsWith('https://api.telegram.org/file/'))return new Response(new Uint8Array([79,103,103,83]));assert.equal(url,'https://api.groq.com/openai/v1/audio/transcriptions');assert.equal(options.body.get('model'),'whisper-large-v3');assert.equal(options.body.get('response_format'),'verbose_json');assert.ok(options.body.get('file') instanceof Blob);return Response.json({text:'Ертең концерт болады.',duration:10});};
 try{await f.bot.flushOutbox();assert.equal(f.store.get(96).step,'voice_review');assert.equal(f.store.job(96),null);assert.equal(calls.length,2);assert.equal(f.store.one("SELECT COUNT(*) n FROM outbox WHERE kind='voice_transcribe'").n,0);}finally{globalThis.fetch=oldFetch;}
});
test('ASR rate limit retries silently and new/cancel removes pending audio work',async()=>{
 const f=fixture();f.dialogue.accept(msg('',note));tap(f,'transcribe');f.bot.telegram=async(method)=>method==='getFile'?{file_path:'voice/file.oga',file_size:10}:{};
 const oldFetch=globalThis.fetch;globalThis.fetch=async url=>String(url).startsWith('https://api.telegram.org/file/')?new Response('OggS'):Response.json({error:{message:'rate limit'}},{status:429,headers:{'Retry-After':'60'}});
 try{await f.bot.flushOutbox();const row=f.store.one("SELECT * FROM outbox WHERE kind='voice_transcribe'");assert.ok(row.due>Date.now()+59000);assert.equal(f.store.get(96).step,'voice_loading');f.dialogue.accept(msg('/new'));assert.equal(f.store.one("SELECT COUNT(*) n FROM outbox WHERE kind='voice_transcribe'").n,0);assert.equal(f.store.get(96).voice_request,undefined);}finally{globalThis.fetch=oldFetch;}
});
test('silence is rejected and metadata transcript never overwrites current task after cancellation',()=>{
 const f=fixture();f.dialogue.accept(msg('',note));tap(f,'transcribe');const p=waiting(f);assert.throws(()=>completeVoice(f.store,96,p,{text:'Thank you.',segments:[{no_speech_prob:.99}]}),VoiceError);f.dialogue.accept(msg('/new'));assert.equal(completeVoice(f.store,96,p,{text:'Ескі тапсырма'}),false);
});

test('voice task card identifies supplied facts and leaves ambiguous spoken clocks for review',()=>{
 const card=voiceBriefCard('Ертең акт залында 30 минуттық концертке сценарий керек. Басталуы 14:00. Екі жүргізуші.');
 assert.match(card,/Формат: Сценарий/);assert.match(card,/Күні: Ертең/);assert.match(card,/Басталуы: 14:00/);assert.match(card,/Ұзақтығы: 30 минут/);assert.match(card,/Жүргізуші саны: 2/);
 assert.match(voiceBriefCard('Басталуы сағат екіде.'),/Басталуы: нақтылау керек/);
});

test('Workers-compatible download reports loading first and never follows Telegram redirects',async()=>{
 const f=fixture();f.dialogue.accept(msg('',note));tap(f,'transcribe');const events=[],delivered=[];
 f.bot.telegram=async(method,payload)=>{if(method==='getFile'){events.push('getFile');return{file_path:'voice/file.oga',file_size:100};}if(method==='sendMessage'){delivered.push(payload.text);if(payload.text==='Дауысты мәтінге айналдырып жатырмын…')events.push('loading');}return{};};
 const oldFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{
  if(options.redirect==='error')throw new TypeError('Invalid redirect value, must be follow or manual');
  if(String(url).startsWith('https://api.telegram.org/file/')){assert.equal(options.redirect,'manual');events.push('download');return new Response(null,{status:302,headers:{Location:'https://untrusted.invalid/private-file'}});}
  throw new Error('A redirected file must never be sent to Groq');
 };
 try{await f.bot.flushOutbox();assert.ok(events.indexOf('loading')<events.indexOf('download'));assert.equal(f.store.get(96).step,'voice_consent');assert.match(delivered.at(-1),/Қауіпсіздік/);assert.equal(f.store.one("SELECT COUNT(*) n FROM outbox WHERE kind='voice_transcribe'").n,0);}finally{globalThis.fetch=oldFetch;}
});

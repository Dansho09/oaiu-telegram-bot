import { mentionedDuration } from './scenario.js';
const HOME_BUTTONS = [[{ text: '🏠 Басты мәзір', callback_data: 'nav:home' }]];

export const MAX_VOICE_BYTES = 5 * 1024 * 1024;
export const MAX_VOICE_SECONDS = 180;
const TTL = 15 * 60 * 1000;
const button = (text, callback_data) => ({text,callback_data});
const LANGUAGES = {kk:'Қазақша',ru:'Орысша',en:'Ағылшынша',auto:'Аралас / автоматты'};
export function transcriptionOptions(language='kk') {
 const prompts={
  kk:'Қазақша іс-шара тапсырмасы. OAIU, университет, ертең, бүгін, іс-шара, сценарий, жүргізуші, басталу уақыты, акт залы, волейбол, жарыс, марапаттау.',
  ru:'Университет OAIU, мероприятие, сценарий, ведущий, время начала, актовый зал, волейбол, соревнование, награждение.',
  en:'OAIU university, event, script, host, start time, assembly hall, volleyball, tournament, awards.'
 };
 if(language==='auto')return {};
 const selected=Object.hasOwn(prompts,language)?language:'kk';
 return {language:selected,prompt:prompts[selected]};
}
export function voiceSuggestions(text,language='kk') {
 if(language!=='kk')return [];
 const suggestions=[];
 // These are optional candidates, never automatic corrections: Ерсен may be a name.
 let tomorrowMatches=0;
 const tomorrow=text.replace(/(^|[^\p{L}\p{M}\p{N}_])(ертен|ерсен)(?=$|[^\p{L}\p{M}\p{N}_])/giu,(_,before,word)=>{tomorrowMatches++;return before+(word[0]===word[0].toUpperCase()?'Ертең':'ертең');});
 // Multiple occurrences may mix a date and a person's name; leave those to manual editing.
 if(tomorrowMatches===1)suggestions.push({id:'tomorrow',label:'💡 «ертең» деп түзету',text:tomorrow});
 const event=text.replace(/(^|[^\p{L}\p{M}\p{N}_])(іс)\s+(шара)(?=$|[^\p{L}\p{M}\p{N}_])/giu,(_,before,first,last)=>`${before}${first}-${last}`);
 if(event!==text)suggestions.push({id:'event',label:'💡 «іс-шара» деп түзету',text:event});
 return suggestions;
}
export class VoiceError extends Error {}
export function validateVoice(voice) {
  if (!voice || typeof voice.file_id !== 'string' || !voice.file_id || voice.file_id.length > 256) throw new VoiceError('Дауыстық хабарлама жарамсыз. Қайта жіберіңіз.');
  if (!Number.isInteger(voice.file_size) || voice.file_size < 1 || voice.file_size > MAX_VOICE_BYTES) throw new VoiceError('Дауыстық хабарлама 5 МБ-тан аспауы керек.');
  if (!Number.isInteger(voice.duration) || voice.duration < 1 || voice.duration > MAX_VOICE_SECONDS) throw new VoiceError('Дауыстық тапсырма 3 минуттан аспауы керек.');
  if (voice.mime_type && !/^audio\/(?:ogg|opus|mpeg|mp4|webm)$/i.test(voice.mime_type)) throw new VoiceError('Telegram дауыстық хабарламасын жіберіңіз.');
  return {file_id:voice.file_id,file_size:voice.file_size,duration:voice.duration,mime_type:voice.mime_type || 'audio/ogg'};
}
export async function readVoiceBytes(response) {
  if (Number(response.headers.get('Content-Length')) > MAX_VOICE_BYTES) throw new VoiceError('Дауыстық хабарлама 5 МБ-тан аспауы керек.');
  const reader=response.body?.getReader();if(!reader)throw new VoiceError('Дыбысты оқу мүмкін болмады.');
  const chunks=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_VOICE_BYTES){await reader.cancel();throw new VoiceError('Дауыстық хабарлама 5 МБ-тан аспауы керек.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  if(!size)throw new VoiceError('Дыбыстық файл бос.');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
const requestCurrent=(s,nonce)=>s.voice_request?.nonce===nonce && Date.now()-s.voice_request.started<TTL;
export function voiceIsCurrent(store,chat,payload){const s=store.get(chat);return s.step==='voice_loading'&&requestCurrent(s,payload.nonce);}
function clearVoice(s){const next={...s,step:s.voice_return_step||'type'};delete next.voice_request;delete next.voice_return_step;return next;}
function cancelVoiceEffects(store,chat){store.exec("DELETE FROM outbox WHERE chat_id=? AND kind='voice_transcribe'",chat);}
function consentButtons(nonce){return [[button('🎤 Мәтінге айналдыру',`voice:transcribe:${nonce}`)],[button('Қазақша',`voice:lang_kk:${nonce}`),button('Орысша',`voice:lang_ru:${nonce}`)],[button('Ағылшынша',`voice:lang_en:${nonce}`),button('Аралас',`voice:lang_auto:${nonce}`)],[button('Бас тарту',`voice:cancel:${nonce}`)]];}
function showConsent(store,chat,s){store.send(chat,`Дауыстық хабарламаны мәтінге айналдырайын ба?\n\nДыбыс тілі: ${LANGUAGES[s.voice_request.language||'kk']}. Қажет болса, төменнен өзгертіңіз. Бұл дайын мәтіннің тілін өзгертпейді.\n\nРастасаңыз, дыбыс Groq қызметіне жіберіледі. Дыбыстық файл бот базасында сақталмайды. Танылған мәтінді қолданар алдында тексересіз.`,consentButtons(s.voice_request.nonce));}
export function failVoice(store,chat,payload,message='Дауысты тану мүмкін болмады. Қайта көріңіз немесе тапсырманы мәтінмен жіберіңіз.'){
 const s=store.get(chat);if(s.voice_request?.nonce!==payload.nonce)return false;
 if(!requestCurrent(s,payload.nonce)){store.put(chat,clearVoice(s));store.send(chat,'Дауыстық тапсырманың мерзімі өтті. Хабарламаны қайта жіберіңіз немесе мәтінмен жазыңыз.');return false;}
 store.put(chat,{...s,step:'voice_consent'});store.send(chat,message,consentButtons(payload.nonce));return true;
}
export function voiceBriefCard(text) {
 const format=/сценар|scenario|script/iu.test(text)?'Сценарий':/алғыс|благодар/iu.test(text)?'Алғыс':/анонс|хабарландыр/iu.test(text)?'Хабарландыру':/сөз|речь|speech/iu.test(text)?'Сөз сөйлеу':'нақтылау керек';
 const date=text.match(/\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?\b|ертең|бүгін|завтра|сегодня|tomorrow|today/iu)?.[0] || 'нақтылау керек';
 const time=text.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?=$|[\s.,])/u)?.[0]?.trim() || 'нақтылау керек';
 const venue=text.match(/(?:акт|спорт|мәжіліс|конференц)\s*зал[\p{L}]*|актов[\p{L}]*\s+зал[\p{L}]*|спортзал[\p{L}]*|аудитория\s*\d+|(?:орны|место|venue)\s*[:—-]\s*[^.!?\n]{1,70}/iu)?.[0] || 'нақтылау керек';
 const hosts=text.match(/([1-4])\s*(?:жүргізуш|ведущ|hosts?)/iu)?.[1] || (/екі\s+жүргізуш/iu.test(text)?'2':/бір\s+жүргізуш/iu.test(text)?'1':/үш\s+жүргізуш/iu.test(text)?'3':/төрт\s+жүргізуш/iu.test(text)?'4':'нақтылау керек');
 const minutes=mentionedDuration(text);
 return `ТАПСЫРМА КАРТОЧКАСЫ\nФормат: ${format}\nКүні: ${date}\nБасталуы: ${time}\nОрны: ${venue}\nҰзақтығы: ${minutes?minutes+' минут':'нақтылау керек'}\nЖүргізуші саны: ${hosts}`;
}
function showPreview(store,chat,s){
 const nonce=s.voice_request.nonce;
 const suggestions=voiceSuggestions(s.voice_request.text,s.voice_request.language||'kk');
 const changed=s.voice_request.raw_text!==undefined&&s.voice_request.raw_text!==s.voice_request.text;
 store.send(chat,voiceBriefCard(s.voice_request.text)+(changed?'\n\nТүзетілген мәтін:\n\n':'\n\nТанылған мәтін:\n\n')+s.voice_request.text+(suggestions.length?'\n\nЕмле нұсқасы төменде ұсынылды. Аты-жөнін не мағынасын өзгертіп жібермейтінін тексеріп, қажет болса ғана таңдаңыз.':'')+'\n\nКүні, орны, адамдардың аты және басқа деректерді тексеріңіз. Қате болса, түзетіңіз. Сөзбен айтылған сағатты 14:00 сияқты нақты жазыңыз. Белгісіз дерек ойдан қосылмайды; баптау кезінде нақтылайсыз. Растағаннан кейін тапсырмаға қолданамын.',[[button('✅ Тапсырмаға қолдану',`voice:apply:${nonce}`)],...suggestions.map(v=>[button(v.label,`voice:suggest_${v.id}:${nonce}`)]),...(changed?[[button('📋 Бастапқы танылған мәтін',`voice:original:${nonce}`)]]:[]),[button('✏️ Мәтінді түзету',`voice:edit:${nonce}`),button('Бас тарту',`voice:cancel:${nonce}`)]]);
}
export function completeVoice(store,chat,payload,data){
 if(!voiceIsCurrent(store,chat,payload))return false;
 const text=String(data?.text||'').trim();
 if(!text || [...text].length>3000)throw new VoiceError('Танылған мәтін бос не 3000 таңбадан ұзын. Қысқарақ дауыстық хабарлама жіберіңіз.');
 if(data.duration>MAX_VOICE_SECONDS+1)throw new VoiceError('Дауыстық тапсырма 3 минуттан аспауы керек.');
 if(Array.isArray(data.segments)&&data.segments.length&&data.segments.every(s=>s.no_speech_prob>.85))throw new VoiceError('Анық сөйлеу табылмады. Тапсырманы қайта айтыңыз не мәтінмен жіберіңіз.');
 const s=store.get(chat),next={...s,step:'voice_review',voice_request:{...s.voice_request,raw_text:text,text}};
 store.put(chat,next);showPreview(store,chat,next);return true;
}
export function handleVoice(dialogue,chat,text,callback,command,voice=null){
 const store=dialogue.store,s=store.get(chat);
 if(command==='/voice') {store.send(chat,'Дауыстық тапсырма\n\n3 минутқа және 5 МБ-қа дейінгі Telegram дауыстық хабарламасын жіберіңіз. Іс-шараның атауын, күнін, орнын, ұзақтығын және керек мәтін түрін айтыңыз. Дыбыс тілі әдепкіде қазақша; растау алдында орысша, ағылшынша не аралас тілді таңдауға болады. Дыбысты Groq қызметіне жіберуді растаған соң, танылған мәтінді тексеріп, түзете аласыз.',[[{text:'🏠 Басты мәзір',callback_data:'nav:home'}]],null,false);return true;}
 if(voice){
  if(!['type','brief','ready','voice_consent','voice_loading','voice_review','voice_edit'].includes(s.step)){store.send(chat,'Алдымен ағымдағы баптауды аяқтаңыз. Жаңа тапсырма керек болса, «Басты мәзір» арқылы бастаңыз, содан кейін дауыстық хабарлама жіберіңіз.',HOME_BUTTONS);return true;}
  let valid;try{valid=validateVoice(voice);}catch(e){if(!(e instanceof VoiceError))throw e;store.send(chat,e.message);return true;}
  store.cancel(chat);cancelVoiceEffects(store,chat);
  const dateParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const reference_date=['year','month','day'].map(key=>dateParts.find(p=>p.type===key).value).join('-');
  const nonce=crypto.randomUUID(),next={...s,step:'voice_consent',voice_return_step:s.voice_return_step||s.step,voice_request:{...valid,language:'kk',nonce,started:Date.now(),reference_date}};
  store.put(chat,next);showConsent(store,chat,next);return true;
 }
 if(callback.startsWith('voice:')){
  const [,action,nonce]=callback.split(':');
  if(!requestCurrent(s,nonce)){
   if(s.voice_request?.nonce===nonce){cancelVoiceEffects(store,chat);store.put(chat,clearVoice(s));}
   store.send(chat,'Бұл дауыстық тапсырма ескірген. Хабарламаны қайта жіберіңіз.');return true;
  }
  if(action==='cancel'){cancelVoiceEffects(store,chat);store.put(chat,clearVoice(s));store.send(chat,'Дауыстық тапсырмадан бас тартылды. Бұрынғы мәтін сақталды.');return true;}
  if(action.startsWith('lang_')&&s.step==='voice_consent'){
   const language=action.slice(5);if(!Object.hasOwn(LANGUAGES,language))return true;
   const next={...s,voice_request:{...s.voice_request,language}};store.put(chat,next);showConsent(store,chat,next);return true;
  }
  if(action==='transcribe'&&s.step==='voice_consent'){
   if(!dialogue.env.GROQ_API_KEY){store.send(chat,'Дауысты тану үшін иесі Groq кілтін қосуы керек.');return true;}
   store.put(chat,{...s,step:'voice_loading'});store.send(chat,'Дауысты мәтінге айналдырып жатырмын…');store.effect(chat,'voice_transcribe',{nonce,language:s.voice_request.language||'kk',...Object.fromEntries(['file_id','file_size','mime_type','duration'].map(k=>[k,s.voice_request[k]]))});return true;
  }
  if(action.startsWith('suggest_')&&s.step==='voice_review'){
   const suggestion=voiceSuggestions(s.voice_request.text,s.voice_request.language||'kk').find(v=>v.id===action.slice(8));
   if(suggestion){const next={...s,voice_request:{...s.voice_request,text:suggestion.text}};store.put(chat,next);showPreview(store,chat,next);}return true;
  }
  if(action==='original'&&s.step==='voice_review'){store.send(chat,'Бастапқы танылған мәтін:\n\n'+(s.voice_request.raw_text||s.voice_request.text));return true;}
  if(action==='edit'&&s.step==='voice_review'){store.put(chat,{...s,step:'voice_edit'});store.send(chat,'Дұрыс мәтінді бір хабарламада жіберіңіз (3000 таңбаға дейін). Содан кейін қайта тексеріп, растайсыз.');return true;}
  if(action==='apply'&&s.step==='voice_review'){
   if(s.voice_request.text.startsWith('/')){store.send(chat,'Танылған мәтін командадан басталады. Оны түзетіп, іс-шара сипаттамасын жазыңыз.');return true;}
   const transcript=s.voice_request.text,next=clearVoice(s);if(!next.result&&!next.reference_date)next.reference_date=s.voice_request.reference_date;cancelVoiceEffects(store,chat);store.put(chat,next);dialogue.process(chat,transcript,'',null);return true;
  }
  return true;
 }
 if(!command&&!callback&&s.step==='voice_edit'){
  if(!text||[...text].length>3000){store.send(chat,'Түзетілген мәтін 1–3000 таңба болуы керек.');return true;}
  const next={...s,step:'voice_review',voice_request:{...s.voice_request,text}};store.put(chat,next);showPreview(store,chat,next);return true;
 }
 if(!command&&!callback&&s.step?.startsWith('voice_')){store.send(chat,'Дауыстық тапсырманы жоғарыдағы батырмалармен растаңыз не тоқтатыңыз. Басқа әрекет үшін «Басты мәзір» ашыңыз.',HOME_BUTTONS);return true;}
 return false;
}

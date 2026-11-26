'use strict';
const fs = require('fs'), path = require('path');
const base = process.argv[2], commandFile = path.join(base,'command.json'), stateFile = path.join(base,'state.json');
const writeState = (status, extra={}) => { const p=stateFile+'.tmp'; fs.writeFileSync(p,JSON.stringify({status,...extra})); fs.renameSync(p,stateFile); };
const pino = require('pino');
const {default:makeSocket,useMultiFileAuthState,fetchLatestBaileysVersion,DisconnectReason,jidNormalizedUser,prepareWAMessageMedia,generateWAMessageFromContent,proto} = require('@whiskeysockets/baileys');
const {installStickerAudioPatch,attachAudio,detachAudio} = require('./src/sticker-audio-patch');
const {parseRawFields,findBytesField} = require('./src/protobuf');
require('./src/logger').silenceSignalSessionDumps();
installStickerAudioPatch(proto);
const sessionPointer=path.join(base,'session-current.txt');
let sessionName=fs.existsSync(sessionPointer)?fs.readFileSync(sessionPointer,'utf8').trim():'';
if(!/^session-[a-f0-9]{16}$/.test(sessionName)){sessionName='session-'+require('node:crypto').randomBytes(8).toString('hex');fs.writeFileSync(sessionPointer,sessionName);}
let sock=null, connecting=false, ready=false, pairing=false, phone='';
async function connect(number, replace=false) {
  if (replace && (connecting || ready)) {
    if(sock){sock.ev.removeAllListeners('connection.update');sock.end();sock=null;}
    connecting=false;ready=false;pairing=false;
    sessionName='session-'+require('node:crypto').randomBytes(8).toString('hex');fs.writeFileSync(sessionPointer,sessionName);
  }
  if (connecting || ready) return;
  connecting=true; phone=number;
  const {state,saveCreds}=await useMultiFileAuthState(path.join(base,sessionName));
  const {version}=await fetchLatestBaileysVersion();
  sock=makeSocket({version,auth:state,logger:pino({level:'silent'}),browser:['Ubuntu','Chrome','20.0.04']});
  sock.ev.on('creds.update',saveCreds);
  sock.ev.on('connection.update',async ({connection,lastDisconnect,qr})=>{
    if(qr && !pairing && !state.creds.registered){
      pairing=true;
      try { const code=await sock.requestPairingCode(phone); writeState('pairing',{code}); }
      catch(e){connecting=false;writeState('error',{message:'Pairing failed: '+e.message});}
    }
    if(connection==='open'){connecting=false;ready=true;pairing=false;writeState('linked');}
    if(connection==='close'){
      ready=false; connecting=false;
      const code=lastDisconnect?.error?.output?.statusCode;
      if(code===DisconnectReason.loggedOut){sessionName='session-'+require('node:crypto').randomBytes(8).toString('hex');fs.writeFileSync(sessionPointer,sessionName);pairing=false;writeState('error',{message:'The link was rejected or expired. Tap Link WhatsApp again for a new code.'});}
      else {pairing=false;setTimeout(()=>connect(phone).catch(fail),1500);}
    }
  });
}
async function send(c){
  if(!ready) throw new Error('Link WhatsApp first.');
  writeState('sending');
  const opt={upload:sock.waUploadToServer};
  const audio=(await prepareWAMessageMedia({audio:fs.readFileSync(c.audio),mimetype:'audio/ogg; codecs=opus',seconds:c.seconds},opt)).audioMessage;
  const sticker=(await prepareWAMessageMedia({sticker:fs.readFileSync(c.webp),isAnimated:true},opt)).stickerMessage;
  const encoded=proto.Message.AudioMessage.encode(proto.Message.AudioMessage.create({url:audio.url,mimetype:'audio/ogg; codecs=opus',fileSha256:audio.fileSha256,fileLength:audio.fileLength,seconds:c.seconds,ptt:true,mediaKey:audio.mediaKey,fileEncSha256:audio.fileEncSha256,directPath:audio.directPath,mediaKeyTimestamp:audio.mediaKeyTimestamp||Math.floor(Date.now()/1000),waveform:new Uint8Array(64)})).finish();
  sticker.isAnimated=true; sticker.width=512; sticker.height=512; attachAudio(sticker.fileSha256,encoded);
  try { const chat=jidNormalizedUser(sock.user.id); const msg=generateWAMessageFromContent(chat,{stickerMessage:sticker},{userJid:sock.user.id}); const encodedMessage=Buffer.from(proto.Message.encode(msg.message).finish());const stickerField=findBytesField(parseRawFields(encodedMessage),26);if(!stickerField||!findBytesField(parseRawFields(stickerField.payload),26))throw new Error('Audio was not attached to the sticker.');await sock.relayMessage(chat,msg.message,{messageId:msg.key.id}); writeState('sent'); }
  finally { detachAudio(sticker.fileSha256); }
}
function fail(e){connecting=false;writeState('error',{message:String(e.message||e)});}
writeState('ready');
let busy=false;
setInterval(async()=>{if(busy||!fs.existsSync(commandFile))return;busy=true;try{const c=JSON.parse(fs.readFileSync(commandFile,'utf8'));fs.unlinkSync(commandFile);if(c.type==='connect'){if(!/^\d{8,15}$/.test(c.phone)) throw new Error('Enter your phone number with country code, digits only.');await connect(c.phone,true);}else if(c.type==='send'){await send(c);}}catch(e){fail(e)}finally{busy=false}},400);

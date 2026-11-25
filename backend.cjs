'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const pino = require('pino');
const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, jidNormalizedUser, proto } = require('@whiskeysockets/baileys');
const { convertToSticker } = require('./src/media/sticker');
const { extractAudio } = require('./src/media/audio');
const { parseWebp } = require('./src/media/webp');
const { sendSoundSticker } = require('./src/whatsapp/send');
const { installStickerAudioPatch } = require('./src/sticker-audio-patch');
const emit = (kind, data) => process.stdout.write('APP_EVENT:' + JSON.stringify({kind, data}) + '\n');
const run = (exe, args) => { const r = spawnSync(exe, args, {encoding:'utf8', windowsHide:true}); if (r.status !== 0) throw new Error((r.stderr || r.error?.message || 'Conversion failed').slice(-800)); };
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.env.PATH = path.join(__dirname, 'bin') + path.delimiter + process.env.PATH;
const ffmpeg = path.join(__dirname, 'bin', 'ffmpeg.exe');
let dir;
async function main() {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-sticker-'));
  const video = path.join(dir, 'cropped.mp4'), webp = path.join(dir, 'sticker.webp'), audio = path.join(dir, 'audio.ogg');
  emit('status', 'Cropping and trimming video…');
  const c = config.crop;
  const filter = `crop=trunc(iw*${c.w}/2)*2:trunc(ih*${c.h}/2)*2:trunc(iw*${c.x}/2)*2:trunc(ih*${c.y}/2)*2`;
  run(ffmpeg, ['-hide_banner','-loglevel','error','-y','-ss',String(config.start),'-i',config.video,'-t',String(config.duration),'-vf',filter,'-map','0:v:0','-map','0:a:0','-c:v','libx264','-preset','veryfast','-crf','20','-c:a','aac',video]);
  emit('status', 'Creating animated sticker and audio…');
  const result = await convertToSticker(video, webp, config.duration, {maxBytes:500*1024,maxFrames:250});
  if (result.oversized || fs.statSync(webp).size > 500*1024) throw new Error('The sticker is too large. Try a shorter clip.');
  const info = parseWebp(fs.readFileSync(webp));
  if (!info || !info.animated || info.frames < 2) throw new Error('The video did not produce an animated sticker.');
  await extractAudio(video, audio, info.duration, {kbps:32,leadMs:0});
  if (config.prepareOnly) { fs.copyFileSync(webp,config.outputWebp); fs.copyFileSync(audio,config.outputAudio); emit('done', 'Sticker files prepared.'); return; }
  installStickerAudioPatch(proto);
  emit('status', 'Connecting to WhatsApp…');
  let sending = false, completed = false;
  async function connect() {
    const {state, saveCreds} = await useMultiFileAuthState(config.sessionDir);
    const {version} = await fetchLatestBaileysVersion();
    const sock = makeWASocket({version, auth:state, logger:pino({level:'silent'}), browser:['Windows','Chrome','1.0']});
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async ({connection,lastDisconnect,qr}) => {
      if (qr) { const code = new QRCode(-1,QRLevel.L); code.addData(qr); code.make(); emit('qr',code.modules); }
      if (connection === 'close' && !sending && !completed) {
        if (lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut) { emit('error','WhatsApp session was logged out. Remove the linked session and try again.'); process.exit(1); }
        setTimeout(()=>connect().catch(fail),1000);
      }
      if (connection === 'open' && !sending) {
        sending = true; emit('status','Sending sticker to your own chat…');
        try { await sendSoundSticker(sock,jidNormalizedUser(sock.user.id),{webpPath:webp,oggPath:audio,seconds:Math.max(1,Math.round(info.duration))}); completed=true; emit('done','Sticker sent to your own chat. Open it in WhatsApp and play the sound.'); sock.end(); cleanup(); setTimeout(()=>process.exit(0),300); }
        catch (e) { fail(e); }
      }
    });
  }
  await connect();
}
function cleanup(){if(dir) try {fs.rmSync(dir,{recursive:true,force:true});}catch{}}
function fail(e){emit('error',String(e.message || e)); cleanup(); process.exit(1);}
main().then(()=>{if(config.prepareOnly) cleanup();}).catch(fail);

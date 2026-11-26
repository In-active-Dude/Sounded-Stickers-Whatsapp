'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');
const {jobPath, removeJob, withJobCleanup} = require('../job-cleanup.cjs');

test('removes only the generated job and keeps unrelated session data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sticker-cleanup-test-'));
  try {
    const job = path.join(root, 'sticker-job-12345678-1234-1234-1234-123456789abc');
    const session = path.join(root, 'session');
    fs.mkdirSync(job); fs.mkdirSync(session);
    fs.writeFileSync(path.join(job, 'audio.ogg'), 'temporary');
    fs.writeFileSync(path.join(session, 'creds.json'), 'preserve');
    removeJob(root, job);
    assert.equal(fs.existsSync(job), false);
    assert.equal(fs.readFileSync(path.join(session, 'creds.json'), 'utf8'), 'preserve');
    assert.throws(() => removeJob(root, session), /Invalid/);
    assert.throws(() => jobPath(root, path.join(root, '..', 'sticker-job-12345678-1234-1234-1234-123456789abc')), /Invalid/);
    removeJob(root, job); // Retry after successful cleanup is harmless.
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

test('cleans the job after a successful send as well as a failed send', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sticker-send-test-'));
  const name='sticker-job-12345678-1234-1234-1234-123456789abc';
  try {
    const success=path.join(root,name);fs.mkdirSync(success);fs.writeFileSync(path.join(success,'sticker.webp'),'temporary');
    assert.equal(await withJobCleanup(root,success,async()=>{assert.equal(fs.existsSync(success),true);return 'sent';}),'sent');
    assert.equal(fs.existsSync(success),false);
    const failure=path.join(root,name);fs.mkdirSync(failure);
    await assert.rejects(withJobCleanup(root,failure,async()=>{throw new Error('upload failed');}),/upload failed/);
    assert.equal(fs.existsSync(failure),false);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('trimmed Android runtime starts and removes a failed job', {timeout: 20000}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sticker-bundle-test-'));
  const runtime=path.join(root,'runtime'), base=path.join(root,'app'), cache=path.join(root,'cache');
  fs.mkdirSync(runtime); fs.mkdirSync(base); fs.mkdirSync(cache);
  const archive=path.join(__dirname,'..','app','src','main','assets','runtime-v8.zip');
  const extracted=spawnSync('python',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,runtime],{encoding:'utf8'});
  assert.equal(extracted.status,0,extracted.stderr);
  const job=path.join(cache,'sticker-job-12345678-1234-1234-1234-123456789abc');
  fs.mkdirSync(job);fs.writeFileSync(path.join(job,'audio.ogg'),'temporary');fs.writeFileSync(path.join(job,'sticker.webp'),'temporary');
  const sender=spawn(process.execPath,[path.join(runtime,'sender.cjs'),base,cache],{stdio:'ignore'});
  const state=()=>{try{return JSON.parse(fs.readFileSync(path.join(base,'state.json'),'utf8'));}catch{return null;}};
  const waitFor=async predicate=>{const end=Date.now()+15000;while(Date.now()<end){if(predicate())return;if(sender.exitCode!==null)throw new Error(`Bundled sender exited with code ${sender.exitCode}`);await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Bundled sender test timed out');};
  try {
    await waitFor(()=>state()?.status==='ready');
    fs.writeFileSync(path.join(base,'command.json'),JSON.stringify({type:'send',job,audio:path.join(job,'audio.ogg'),webp:path.join(job,'sticker.webp')}));
    await waitFor(()=>state()?.status==='error');
    assert.match(state().message,/Link WhatsApp first/);
    assert.equal(fs.existsSync(job),false);
  } finally {
    if(sender.exitCode===null){const closed=new Promise(resolve=>sender.once('exit',resolve));sender.kill();await closed;}
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('failed send removes the job while keeping the session directory', {timeout: 15000}, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sticker-sender-test-'));
  const runtime = fs.mkdtempSync(path.join(__dirname, 'runtime-test-'));
  fs.mkdirSync(path.join(runtime,'src'));
  for (const file of ['sender.cjs','job-cleanup.cjs']) fs.copyFileSync(path.join(__dirname,'..',file),path.join(runtime,file));
  for (const file of ['logger.js','protobuf.js','sticker-audio-patch.js']) fs.copyFileSync(path.join(__dirname,'..','..','src',file),path.join(runtime,'src',file));
  const base = path.join(root, 'app'), cache = path.join(root, 'cache');
  fs.mkdirSync(base); fs.mkdirSync(cache);
  const job = path.join(cache, 'sticker-job-12345678-1234-1234-1234-123456789abc');
  fs.mkdirSync(job); fs.writeFileSync(path.join(job,'audio.ogg'),'temporary'); fs.writeFileSync(path.join(job,'sticker.webp'),'temporary');
  const sender = spawn(process.execPath, [path.join(runtime,'sender.cjs'),base,cache], {stdio:'ignore'});
  const waitFor = async predicate => {
    const deadline = Date.now()+10000;
    while(Date.now()<deadline) { if(predicate())return; if(sender.exitCode!==null)throw new Error(`Sender exited with code ${sender.exitCode}`); await new Promise(resolve=>setTimeout(resolve,100)); }
    throw new Error('Sender test timed out');
  };
  const state = () => { try{return JSON.parse(fs.readFileSync(path.join(base,'state.json'),'utf8'));}catch{return null;} };
  try {
    await waitFor(()=>state()?.status==='ready');
    fs.writeFileSync(path.join(base,'command.json'), JSON.stringify({type:'send',job,audio:path.join(job,'audio.ogg'),webp:path.join(job,'sticker.webp')}));
    await waitFor(()=>state()?.status==='error');
    assert.match(state().message,/Link WhatsApp first/);
    assert.equal(fs.existsSync(job),false);
    assert.equal(fs.readdirSync(base).some(name=>name.startsWith('session-')),true);
  } finally {
    if(sender.exitCode===null){ const closed=new Promise(resolve=>sender.once('exit',resolve)); sender.kill(); await closed; }
    fs.rmSync(root,{recursive:true,force:true});
    fs.rmSync(runtime,{recursive:true,force:true});
  }
});

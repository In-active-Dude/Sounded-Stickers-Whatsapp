'use strict';

/**
 * Application bootstrap: configuration, environment checks, protocol patches
 * and bot start-up.
 */

const dns = require('node:dns');
const { proto } = require('@whiskeysockets/baileys');
const { loadEnvFile, loadConfig } = require('./config');
const { log, silenceSignalSessionDumps } = require('./logger');
const { assertFfmpegReady } = require('./media/ffmpeg');
const { installStickerAudioPatch } = require('./sticker-audio-patch');
const { installDecodeInspector } = require('./whatsapp/inspect');
const { startBot } = require('./bot');

async function main() {
    // Many home networks advertise IPv6 without routing it; media downloads then
    // fail with "fetch failed / ETIMEDOUT". Preferring IPv4 avoids that.
    dns.setDefaultResultOrder('ipv4first');

    loadEnvFile();
    const config = loadConfig();

    silenceSignalSessionDumps();
    log('START', await assertFfmpegReady());

    installStickerAudioPatch(proto);
    if (config.debug) installDecodeInspector(proto, config.command);

    await startBot(config);
}

module.exports = { main };

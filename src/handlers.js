'use strict';

/**
 * Command handlers: turn a received video into one sound sticker (main command)
 * or into several variants that differ only in audio encoding (test command).
 */

const fs = require('node:fs');
const path = require('node:path');
const pino = require('pino');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { log, formatKb } = require('./logger');
const { runStep } = require('./retry');
const { createWorkDir } = require('./workdir');
const { probeVideo, describeVideo, inspectAudio } = require('./media/probe');
const { convertToSticker } = require('./media/sticker');
const { extractAudio } = require('./media/audio');
const { parseWebp } = require('./media/webp');
const { validateOutputs } = require('./media/validate');
const { sendSoundSticker } = require('./whatsapp/send');
const { verifyUpload } = require('./whatsapp/verify');

/** Audio variants sent by the test command. */
const TEST_VARIANTS = Object.freeze([
    { mode: 'direct', label: 'direct conversion' },
    { mode: 'clean', label: 'timestamps reset, no metadata' },
    { mode: 'wav48', label: 'clean 48 kHz PCM -> Opus (default)' },
    { mode: 'wav16', label: '16 kHz PCM -> Opus 24 kbps (voice-note like)' },
    { mode: 'voip', label: '48 kHz PCM -> Opus 24 kbps, voip mode' }
]);

/**
 * Length of the sticker: the whole video, capped at `maxSeconds`.
 *
 * @param {number | null} probedDuration Duration measured by FFprobe.
 * @param {number | null | undefined} declaredSeconds Duration announced by the sender's app.
 * @param {number} maxSeconds
 * @returns {number}
 */
function clipDuration(probedDuration, declaredSeconds, maxSeconds) {
    return Math.min(probedDuration || declaredSeconds || maxSeconds, maxSeconds);
}

/**
 * Downloads the video of `message` into `file` and probes it.
 *
 * @param {any} sock
 * @param {any} message
 * @param {string} file
 */
async function downloadAndProbe(sock, message, file) {
    const data = await runStep('download video', () => downloadMediaMessage(message, 'buffer', {},
        { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }), { retries: 3 });
    fs.writeFileSync(file, /** @type {Buffer} */ (data));
    const info = await runStep('probe video', () => probeVideo(file));
    log('VIDEO', `${describeVideo(info)} | duration=${info.duration ? `${info.duration.toFixed(2)}s` : '?'}`);
    return info;
}

/**
 * Makes the audio exactly as long as the encoded animation. The animation
 * length is a sum of whole-millisecond frame durations and can differ slightly
 * from the requested length; a mismatch would make the sound drift every time
 * the sticker loops.
 *
 * @returns {Promise<number>} Final length in seconds.
 */
async function syncAudioToAnimation(video, webp, ogg, requestedDuration, config) {
    const animation = parseWebp(fs.readFileSync(webp));
    if (!animation || animation.duration <= 0) return requestedDuration;

    let audio = await inspectAudio(ogg).catch(() => null);
    if (!audio || !audio.duration || Math.abs(audio.duration - animation.duration) > 0.01) {
        await extractAudio(video, ogg, animation.duration, { kbps: config.audioKbps, leadMs: config.audioLeadMs });
        audio = await inspectAudio(ogg).catch(() => audio);
    }
    const drift = audio && audio.duration ? Math.round((audio.duration - animation.duration) * 1000) : '?';
    log('SYNC', `animation=${animation.duration.toFixed(3)}s audio=${audio && audio.duration ? audio.duration.toFixed(3) : '?'}s ` +
        `drift=${drift}ms lead=${config.audioLeadMs}ms`);
    return animation.duration;
}

/**
 * Main command: video -> sticker with sound, sent as a reply to the request.
 *
 * @param {{ sock: any, config: any }} context
 * @param {any} message Incoming `WAMessage`.
 * @param {any} videoMessage Its video payload.
 */
async function handleStickerCommand({ sock, config }, message, videoMessage) {
    const startedAt = Date.now();
    const chat = message.key.remoteJid;
    const work = createWorkDir(config);
    const video = path.join(work.dir, 'input.mp4');
    const webp = path.join(work.dir, 'sticker.webp');
    const ogg = path.join(work.dir, 'audio.ogg');

    try {
        const info = await downloadAndProbe(sock, message, video);
        if (!info.hasAudio) {
            await sock.sendMessage(chat, { text: 'That video has no audio, so it cannot become a sticker with sound.' },
                { quoted: message });
            log('OUT', `rejected: video without audio | chat=${chat}`);
            return;
        }

        const duration = clipDuration(info.duration, videoMessage.seconds, config.maxSeconds);
        const convertStartedAt = Date.now();
        const [sticker] = await runStep('convert (ffmpeg)', () => Promise.all([
            convertToSticker(video, webp, duration, { maxBytes: config.maxStickerBytes, maxFrames: config.maxFrames }),
            extractAudio(video, ogg, duration, { kbps: config.audioKbps, leadMs: config.audioLeadMs })
        ]));
        const convertMs = Date.now() - convertStartedAt;

        const finalDuration = await syncAudioToAnimation(video, webp, ogg, duration, config);
        await validateOutputs(webp, ogg, finalDuration, config.maxStickerBytes);

        const sendStartedAt = Date.now();
        const uploaded = await sendSoundSticker(sock, chat, {
            webpPath: webp,
            oggPath: ogg,
            seconds: Math.max(1, Math.round(finalDuration)),
            quoted: config.replyToMessage ? message : undefined,
            debug: config.debug
        });

        log('OUT', `sound sticker sent | chat=${chat} | ${duration.toFixed(1)}s ` +
            `(video ${info.duration ? `${info.duration.toFixed(1)}s` : '?'}, max ${config.maxSeconds}s) | ` +
            `webp=${formatKb(sticker.bytes)} ${sticker.fps}fps q${sticker.quality} (${sticker.strategy}, ` +
            `${sticker.encodes} encode(s)${sticker.oversized ? ', OVER 500 KB' : ''}) | audio=${formatKb(fs.statSync(ogg).size)} | ` +
            `ffmpeg=${convertMs}ms send=${Date.now() - sendStartedAt}ms total=${Date.now() - startedAt}ms` +
            `${work.persistent ? ` | files in ${path.relative(process.cwd(), work.dir)}` : ''}`);

        if (config.verifyUpload) await verifyUpload(uploaded, work.dir);
    } finally {
        work.cleanup();
    }
}

/**
 * Test command: sends one sticker per entry of {@link TEST_VARIANTS}. All share
 * the same animation; only the audio encoding changes. Useful to find out which
 * encoding a given phone/client plays.
 *
 * @param {{ sock: any, config: any }} context
 * @param {any} message
 * @param {any} videoMessage
 */
async function handleTestCommand({ sock, config }, message, videoMessage) {
    const chat = message.key.remoteJid;
    const work = createWorkDir(config);
    const video = path.join(work.dir, 'input.mp4');
    const webp = path.join(work.dir, 'sticker.webp');
    try {
        const info = await downloadAndProbe(sock, message, video);
        if (!info.hasAudio) {
            await sock.sendMessage(chat, { text: 'That video has no audio.' }, { quoted: message });
            return;
        }
        const duration = clipDuration(info.duration, videoMessage.seconds, config.maxSeconds);
        await convertToSticker(video, webp, duration, { maxBytes: config.maxStickerBytes, maxFrames: config.maxFrames });
        const animation = parseWebp(fs.readFileSync(webp));
        const finalDuration = animation && animation.duration > 0 ? animation.duration : duration;

        await sock.sendMessage(chat, {
            text: `TEST: ${TEST_VARIANTS.length} numbered stickers, same animation, different audio encoding. Which ones play?`
        });
        for (const [index, variant] of TEST_VARIANTS.entries()) {
            const ogg = path.join(work.dir, `audio_${index + 1}_${variant.mode}.ogg`);
            await extractAudio(video, ogg, finalDuration, { mode: variant.mode, kbps: config.audioKbps, leadMs: config.audioLeadMs });
            const label = `Variant ${index + 1}: ${variant.label} (${formatKb(fs.statSync(ogg).size)})`;
            await sock.sendMessage(chat, { text: label });
            await sendSoundSticker(sock, chat, { webpPath: webp, oggPath: ogg, seconds: Math.max(1, Math.round(finalDuration)), debug: config.debug });
            log('TEST', label);
        }
    } finally {
        work.cleanup();
    }
}

module.exports = { TEST_VARIANTS, clipDuration, handleStickerCommand, handleTestCommand };

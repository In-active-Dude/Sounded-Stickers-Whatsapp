'use strict';

/**
 * Debug tooling (`DEBUG=1`) to study sound stickers sent by other apps.
 *
 * A hook on `proto.Message.decode` reads every incoming message in raw form
 * before Baileys drops unknown fields. For each incoming sticker it records the
 * embedded audio metadata; when the sticker message is later delivered through
 * `messages.upsert`, {@link analyzeIncomingSticker} downloads the animation and
 * logs audio length, animation length and the largest values seen so far, which
 * helps finding the limits WhatsApp clients accept.
 */

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { log, formatKb } = require('../logger');
const { runStep } = require('../retry');
const { parseWebp } = require('../media/webp');
const { parseRawFields, findBytesField, findVarint, describeRawFields } = require('../protobuf');
const { STICKER_AUDIO_FIELD } = require('../sticker-audio-patch');

/** Field numbers inside `Message`, `StickerMessage`, `VideoMessage` and `AudioMessage`. */
const FIELDS = Object.freeze({
    MESSAGE_VIDEO: 9, MESSAGE_STICKER: 26,
    STICKER_SHA256: 2, VIDEO_CAPTION: 7,
    AUDIO_LENGTH: 4, AUDIO_SECONDS: 5, AUDIO_PTT: 6
});

/** @type {Map<string, { seconds: number | null, bytes: number | null, ptt: number | null }>} */
const incomingAudio = new Map();
const largestSeen = { audioSeconds: 0, animationSeconds: 0 };

/**
 * Extracts the embedded audio metadata from a raw `StickerMessage`.
 *
 * @param {Buffer} rawSticker
 * @returns {{ key: string, audio: { seconds: number | null, bytes: number | null, ptt: number | null } } | null}
 */
function readStickerAudio(rawSticker) {
    const fields = parseRawFields(rawSticker);
    const sha = findBytesField(fields, FIELDS.STICKER_SHA256);
    const audio = findBytesField(fields, STICKER_AUDIO_FIELD);
    if (!sha || !audio) return null;
    const audioFields = parseRawFields(/** @type {Buffer} */ (audio.payload));
    return {
        key: Buffer.from(/** @type {Buffer} */ (sha.payload)).toString('base64'),
        audio: {
            seconds: findVarint(audioFields, FIELDS.AUDIO_SECONDS),
            bytes: findVarint(audioFields, FIELDS.AUDIO_LENGTH),
            ptt: findVarint(audioFields, FIELDS.AUDIO_PTT)
        }
    };
}

/**
 * Wraps `proto.Message.decode` to dump incoming stickers and command videos.
 * The hook never throws: any inspection error is swallowed.
 *
 * @param {any} proto
 * @param {string} command Only videos whose caption equals this are dumped.
 */
function installDecodeInspector(proto, command) {
    const originalDecode = proto.Message.decode;
    proto.Message.decode = function (reader, ...rest) {
        try {
            if (reader instanceof Uint8Array) {
                const buffer = Buffer.from(reader.buffer, reader.byteOffset, reader.byteLength);
                for (const field of parseRawFields(buffer)) {
                    if (field.type !== 'bytes') continue;
                    const payload = /** @type {Buffer} */ (field.payload);
                    if (field.field === FIELDS.MESSAGE_STICKER) {
                        console.log(`[RAW-IN] incoming sticker:\n${describeRawFields(payload)}`);
                        const found = readStickerAudio(payload);
                        if (found) incomingAudio.set(found.key, found.audio);
                    } else if (field.field === FIELDS.MESSAGE_VIDEO) {
                        const caption = findBytesField(parseRawFields(payload), FIELDS.VIDEO_CAPTION);
                        if (caption && /** @type {Buffer} */ (caption.payload).toString('utf8').trim().toLowerCase() === command) {
                            console.log(`[RAW-IN] incoming ${command} video:\n${describeRawFields(payload)}`);
                        }
                    }
                }
            }
        } catch { /* inspection must never break message decoding */ }
        return originalDecode.call(this, reader, ...rest);
    };
}

/**
 * Logs audio/animation details of an incoming sound sticker. Plain stickers are ignored.
 *
 * @param {any} sock
 * @param {any} message Full `WAMessage`.
 * @param {any} sticker Its `stickerMessage`.
 */
async function analyzeIncomingSticker(sock, message, sticker) {
    const key = Buffer.from(sticker.fileSha256).toString('base64');
    const audio = incomingAudio.get(key);
    if (!audio) return;
    incomingAudio.delete(key);

    let animation = null;
    try {
        const data = await runStep('download incoming sticker', () => downloadMediaMessage(message, 'buffer', {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }), { retries: 2 });
        animation = parseWebp(/** @type {Buffer} */ (data));
    } catch { /* already logged by runStep */ }

    if (audio.seconds) largestSeen.audioSeconds = Math.max(largestSeen.audioSeconds, audio.seconds);
    if (animation) largestSeen.animationSeconds = Math.max(largestSeen.animationSeconds, animation.duration);

    log('STICKER-IN', `with sound | audio=${audio.seconds ?? '?'}s (${audio.bytes ? formatKb(audio.bytes) : '?'}) | ` +
        `animation=${animation ? `${animation.duration.toFixed(1)}s, ${animation.frames} frames, ${animation.width}x${animation.height}` : '?'} | ` +
        `sticker=${formatKb(Number(sticker.fileLength || 0))} | ` +
        `LARGEST SEEN: audio=${largestSeen.audioSeconds}s animation=${largestSeen.animationSeconds.toFixed(1)}s`);
}

module.exports = { installDecodeInspector, analyzeIncomingSticker, readStickerAudio };

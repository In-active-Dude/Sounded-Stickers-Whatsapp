'use strict';

/**
 * Uploading and sending a sticker with sound.
 *
 * Steps:
 *   1. Upload the Ogg/Opus file as an audio message to WhatsApp's media servers.
 *   2. Upload the WebP file as an animated sticker.
 *   3. Build an `AudioMessage` that points at the uploaded audio and register it
 *      with the encoder patch (see `sticker-audio-patch.js`).
 *   4. Build the sticker message (optionally quoting the request) and relay it.
 */

const fs = require('node:fs');
const { prepareWAMessageMedia, generateWAMessageFromContent, proto } = require('@whiskeysockets/baileys');
const { log } = require('../logger');
const { runStep } = require('../retry');
const { computeWaveform } = require('../media/audio');
const { STICKER_SIZE } = require('../media/sticker');
const { parseRawFields, findBytesField, describeRawFields } = require('../protobuf');
const { STICKER_AUDIO_FIELD, attachAudio, detachAudio } = require('../sticker-audio-patch');

const AUDIO_MIMETYPE = 'audio/ogg; codecs=opus';
/** Field number of `stickerMessage` inside `Message`. */
const MESSAGE_STICKER_FIELD = 26;

/**
 * Checks that an encoded `Message` really carries the audio inside its sticker.
 *
 * @param {Buffer} encodedMessage
 * @returns {number | null} Size of the embedded audio message, or `null` if missing.
 */
function embeddedAudioSize(encodedMessage) {
    const sticker = findBytesField(parseRawFields(encodedMessage), MESSAGE_STICKER_FIELD);
    if (!sticker) return null;
    const audio = findBytesField(parseRawFields(/** @type {Buffer} */ (sticker.payload)), STICKER_AUDIO_FIELD);
    return audio ? /** @type {number} */ (audio.length) : null;
}

/**
 * The JID we speak as. In `@lid` chats our own LID must be used, otherwise the
 * quoted participant ends up empty and clients do not show what we replied to.
 *
 * @param {any} sock
 * @param {string} chatJid
 */
function ownJidFor(sock, chatJid) {
    const me = sock.user || {};
    return chatJid.endsWith('@lid') && me.lid ? me.lid : me.id;
}

/**
 * @typedef {object} UploadedMedia
 * @property {any} audio Uploaded `audioMessage` fields (url, keys, hashes).
 * @property {any} sticker Uploaded `stickerMessage` fields.
 */

/**
 * Uploads both files and sends the sticker with sound to `chatJid`.
 *
 * @param {any} sock Baileys socket.
 * @param {string} chatJid Destination chat.
 * @param {object} params
 * @param {string} params.webpPath
 * @param {string} params.oggPath
 * @param {number} params.seconds Audio length shown by clients (whole seconds, >= 1).
 * @param {any} [params.quoted] Message to reply to.
 * @param {boolean} [params.debug] Print the raw outgoing message.
 * @returns {Promise<UploadedMedia>}
 */
async function sendSoundSticker(sock, chatJid, { webpPath, oggPath, seconds, quoted, debug = false }) {
    const uploadOptions = { upload: sock.waUploadToServer };

    const uploadedAudio = await runStep('upload audio', () => prepareWAMessageMedia(
        { audio: fs.readFileSync(oggPath), mimetype: AUDIO_MIMETYPE, seconds }, uploadOptions), { retries: 2 });
    const waveform = await runStep('waveform', () => computeWaveform(oggPath));
    const uploadedSticker = await runStep('upload sticker', () => prepareWAMessageMedia(
        { sticker: fs.readFileSync(webpPath), isAnimated: true }, uploadOptions), { retries: 2 });

    const audio = uploadedAudio.audioMessage;
    const audioMessageBytes = proto.Message.AudioMessage.encode(proto.Message.AudioMessage.create({
        url: audio.url,
        mimetype: AUDIO_MIMETYPE,
        fileSha256: audio.fileSha256,
        fileLength: audio.fileLength,
        seconds,
        ptt: true,
        mediaKey: audio.mediaKey,
        fileEncSha256: audio.fileEncSha256,
        directPath: audio.directPath,
        mediaKeyTimestamp: audio.mediaKeyTimestamp || Math.floor(Date.now() / 1000),
        waveform
    })).finish();

    const sticker = uploadedSticker.stickerMessage;
    sticker.isAnimated = true;
    sticker.width = STICKER_SIZE;
    sticker.height = STICKER_SIZE;

    attachAudio(sticker.fileSha256, audioMessageBytes);
    try {
        const message = generateWAMessageFromContent(chatJid, { stickerMessage: sticker },
            { quoted, userJid: ownJidFor(sock, chatJid) });

        const context = message.message.stickerMessage && message.message.stickerMessage.contextInfo;
        if (context && context.stanzaId) {
            log('REPLY', `replying to ${context.stanzaId} | participant=${context.participant || '(EMPTY)'}`);
        }

        const encoded = Buffer.from(proto.Message.encode(message.message).finish());
        if (debug) console.log(`[RAW-OUT] outgoing message:\n${describeRawFields(encoded)}`);
        const audioSize = embeddedAudioSize(encoded);
        log('CHECK', audioSize !== null
            ? `audio embedded in the sticker (${audioSize} bytes, ${seconds}s)`
            : 'the audio is NOT embedded in the sticker; it will arrive muted');

        await runStep('send message', () => sock.relayMessage(chatJid, message.message, { messageId: message.key.id }));
    } finally {
        detachAudio(sticker.fileSha256);
    }
    return { audio, sticker };
}

module.exports = { sendSoundSticker, embeddedAudioSize, ownJidFor };

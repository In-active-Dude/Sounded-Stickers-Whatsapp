'use strict';

/**
 * Optional post-send check (`VERIFY_UPLOAD=1`): downloads the media that was just
 * uploaded, compares hashes and confirms the files are still playable.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { log } = require('../logger');
const { runStep, describeError } = require('../retry');
const { inspectAudio } = require('../media/probe');
const { parseWebp } = require('../media/webp');

/**
 * @param {{ mediaKey: any, directPath: string, url: string }} media
 * @param {'audio' | 'sticker'} type
 * @returns {Promise<Buffer>} Decrypted file contents.
 */
async function download(media, type) {
    const stream = await downloadContentFromMessage(media, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
}

/**
 * @param {Buffer} data
 * @param {Uint8Array} expectedSha256
 */
const hashMatches = (data, expectedSha256) =>
    crypto.createHash('sha256').update(data).digest().equals(Buffer.from(expectedSha256));

/**
 * @param {import('./send').UploadedMedia} uploaded
 * @param {string} workDir Where the downloaded audio is written for inspection.
 */
async function verifyUpload({ audio, sticker }, workDir) {
    try {
        const audioData = await runStep('download uploaded audio', () => download(audio, 'audio'), { retries: 1 });
        const audioFile = path.join(workDir, 'server_audio.ogg');
        fs.writeFileSync(audioFile, audioData);
        const info = await inspectAudio(audioFile);
        log('VERIFY', `server audio: hash ${hashMatches(audioData, audio.fileSha256) ? 'OK' : 'MISMATCH'} | ` +
            `${info.codec} ${info.duration ? `${info.duration.toFixed(1)}s` : '?'} | peak ${info.peakDb} dB` +
            `${info.decodeErrors.length ? ` | ERRORS: ${info.decodeErrors.slice(0, 2).join(' / ')}` : ''}`);

        const stickerData = await runStep('download uploaded sticker', () => download(sticker, 'sticker'), { retries: 1 });
        const webp = parseWebp(stickerData);
        log('VERIFY', `server sticker: hash ${hashMatches(stickerData, sticker.fileSha256) ? 'OK' : 'MISMATCH'} | ` +
            (webp ? `${webp.animated ? 'animated' : 'STATIC'} ${webp.width}x${webp.height}, ${webp.frames} frames, ` +
                `${webp.duration.toFixed(1)}s` : 'INVALID WebP'));
    } catch (error) {
        log('VERIFY', `could not verify the upload: ${describeError(error)}`);
    }
}

module.exports = { verifyUpload, hashMatches };

'use strict';

/**
 * Local sanity checks on a generated sticker/audio pair before it is sent.
 * Problems are reported as warnings; they never stop the pipeline.
 */

const fs = require('node:fs');
const { log, formatKb } = require('../logger');
const { parseWebp } = require('./webp');
const { inspectAudio } = require('./probe');
const { STICKER_SIZE } = require('./sticker');

/** Peak level under which the clip is considered silent. */
const SILENCE_DB = -50;

/**
 * Compares the measured properties against what WhatsApp expects. Pure function.
 *
 * @param {object} input
 * @param {import('./webp').WebpInfo | null} input.webp
 * @param {number} input.webpBytes
 * @param {import('./probe').AudioInfo} input.audio
 * @param {number} input.expectedDuration Seconds.
 * @param {number} input.maxBytes
 * @returns {string[]} Warnings, empty when everything looks right.
 */
function collectWarnings({ webp, webpBytes, audio, expectedDuration, maxBytes }) {
    const warnings = [];

    if (!webp) {
        warnings.push('the sticker is not a valid WebP file');
    } else {
        if (!webp.animated) warnings.push('the sticker is not animated');
        if (webp.width !== STICKER_SIZE || webp.height !== STICKER_SIZE) {
            warnings.push(`canvas is ${webp.width}x${webp.height} (expected ${STICKER_SIZE}x${STICKER_SIZE})`);
        }
        if (webp.frames < 2) warnings.push(`only ${webp.frames} frame(s)`);
    }
    if (webpBytes > maxBytes) warnings.push(`the sticker weighs ${formatKb(webpBytes)} (limit ${formatKb(maxBytes)})`);

    if (audio.codec !== 'opus') warnings.push(`audio codec is ${audio.codec}, expected opus`);
    if (audio.startTime !== null && Math.abs(audio.startTime) > 0.02) {
        warnings.push(`audio does not start at 0 (start=${audio.startTime}s); some clients will not play it`);
    }
    if (audio.decodeErrors.length) warnings.push(`decoder errors: ${audio.decodeErrors.slice(0, 2).join(' / ')}`);
    if (audio.peakDb === null || !Number.isFinite(audio.peakDb) || audio.peakDb < SILENCE_DB) {
        warnings.push('the audio is silent (that part of the video has no sound)');
    }
    if (audio.duration && Math.abs(audio.duration - expectedDuration) > 0.6) {
        warnings.push(`audio lasts ${audio.duration.toFixed(1)}s, expected ${expectedDuration.toFixed(1)}s`);
    }
    if (webp && audio.duration && Math.abs(webp.duration - audio.duration) > 0.8) {
        warnings.push(`animation (${webp.duration.toFixed(1)}s) and audio (${audio.duration.toFixed(1)}s) lengths differ`);
    }
    return warnings;
}

/**
 * Inspects the files on disk, logs a summary and returns the warnings.
 *
 * @param {string} webpPath
 * @param {string} oggPath
 * @param {number} expectedDuration
 * @param {number} maxBytes
 * @returns {Promise<string[]>}
 */
async function validateOutputs(webpPath, oggPath, expectedDuration, maxBytes) {
    let warnings;
    let summary = '';
    try {
        const buffer = fs.readFileSync(webpPath);
        const webp = parseWebp(buffer);
        const audio = await inspectAudio(oggPath);
        if (webp) {
            summary += `sticker: ${webp.animated ? 'animated' : 'static'} ${webp.width}x${webp.height}, ` +
                `${webp.frames} frames, ${webp.duration.toFixed(1)}s, ${formatKb(buffer.length)}`;
        }
        summary += ` | audio: ${audio.codec} ${audio.sampleRate}Hz ${audio.channels}ch ` +
            `${audio.duration ? `${audio.duration.toFixed(1)}s` : '?'}, mean ${audio.meanDb} dB, peak ${audio.peakDb} dB`;
        warnings = collectWarnings({ webp, webpBytes: buffer.length, audio, expectedDuration, maxBytes });
    } catch (error) {
        warnings = [`validation failed: ${error.message}`];
    }
    log('CHECK', summary || '(no data)');
    log('CHECK', warnings.length ? `WARNING: ${warnings.join(' ; ')}` : 'sticker and audio look valid');
    return warnings;
}

module.exports = { collectWarnings, validateOutputs };

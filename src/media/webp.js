'use strict';

/**
 * Minimal WebP (RIFF) container reader: canvas size, animation flag, frame
 * count and total animation length. Enough to validate a sticker and to keep
 * its audio exactly as long as its animation.
 */

/**
 * @typedef {object} WebpInfo
 * @property {number | null} width Canvas width (from the VP8X chunk).
 * @property {number | null} height Canvas height (from the VP8X chunk).
 * @property {boolean} animated
 * @property {number} frames Number of ANMF chunks.
 * @property {number} durationMs Sum of all frame durations.
 * @property {number} duration Same as `durationMs`, in seconds.
 */

/**
 * @param {Buffer} buffer Whole file contents.
 * @returns {WebpInfo | null} `null` when the buffer is not a WebP file.
 */
function parseWebp(buffer) {
    if (!buffer || buffer.length < 12) return null;
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

    const info = { width: null, height: null, animated: false, frames: 0, durationMs: 0, duration: 0 };
    let position = 12;
    while (position + 8 <= buffer.length) {
        const type = buffer.toString('ascii', position, position + 4);
        const size = buffer.readUInt32LE(position + 4);
        const data = position + 8;

        if (type === 'VP8X' && data + 10 <= buffer.length) {
            info.animated = Boolean(buffer[data] & 0x02);
            info.width = 1 + buffer.readUIntLE(data + 4, 3);
            info.height = 1 + buffer.readUIntLE(data + 7, 3);
        } else if (type === 'ANMF' && data + 15 <= buffer.length) {
            info.frames++;
            info.durationMs += buffer.readUIntLE(data + 12, 3);
        }
        position = data + size + (size & 1);
    }
    info.duration = info.durationMs / 1000;
    return info;
}

module.exports = { parseWebp };

'use strict';

/**
 * Audio track of a sound sticker: Opus in an Ogg container, mono, exactly as
 * long as the sticker animation, plus the 64-bar waveform WhatsApp displays.
 */

const fs = require('node:fs');
const { runFfmpeg, runFfmpegToBuffer } = require('./ffmpeg');

/**
 * Encoding variants. `wav48` is the default; the others are only used by the
 * test command to compare how WhatsApp clients play each one.
 *
 * - `direct`: straight conversion from the video's audio.
 * - `clean`:  timestamps reset to zero, first track only, metadata stripped.
 * - `wav48`:  decoded to clean 48 kHz PCM first, padded/trimmed to the exact length, then Opus.
 * - `wav16`:  like `wav48` but 16 kHz and 24 kbps (close to a WhatsApp voice note).
 * - `voip`:   like `wav48` but 24 kbps with Opus' speech-optimised `voip` mode.
 */
const AUDIO_MODES = Object.freeze(['direct', 'clean', 'wav48', 'wav16', 'voip']);

/**
 * Extracts `duration` seconds of audio from `input` into an Ogg/Opus file.
 *
 * In the PCM-based modes the clip starts `leadMs` milliseconds into the video:
 * WhatsApp starts the sound slightly after the animation, so skipping a few
 * milliseconds keeps both in sync. The PCM stage pads with silence and trims on
 * the output side, so the file has exactly `duration * sampleRate` samples.
 *
 * @param {string} input Source video.
 * @param {string} output Destination `.ogg`.
 * @param {number} duration Seconds.
 * @param {{ mode?: string, kbps?: number, leadMs?: number }} [options]
 */
async function extractAudio(input, output, duration, { mode = 'wav48', kbps = 32, leadMs = 0 } = {}) {
    const seconds = duration.toFixed(3);

    if (mode === 'direct') {
        await runFfmpeg(['-t', seconds, '-i', input, '-vn',
            '-c:a', 'libopus', '-b:a', `${kbps}k`, '-ar', '48000', '-ac', '1', output]);
        return;
    }
    if (mode === 'clean') {
        await runFfmpeg(['-t', seconds, '-i', input, '-vn', '-map', '0:a:0',
            '-af', 'aresample=48000:first_pts=0', '-ac', '1',
            '-c:a', 'libopus', '-b:a', `${kbps}k`,
            '-avoid_negative_ts', 'make_zero', '-map_metadata', '-1', output]);
        return;
    }
    if (!AUDIO_MODES.includes(mode)) throw new Error(`unknown audio mode "${mode}"`);

    const sampleRate = mode === 'wav16' ? 16000 : 48000;
    const wav = `${output}.wav`;
    await runFfmpeg([
        ...(leadMs > 0 ? ['-ss', (leadMs / 1000).toFixed(3)] : []),
        '-i', input, '-vn', '-map', '0:a:0',
        '-af', `aresample=${sampleRate}:first_pts=0,apad=whole_dur=${seconds}`,
        '-ac', '1', '-c:a', 'pcm_s16le', '-t', seconds, wav
    ]);
    try {
        const bitrate = mode === 'wav48' ? ['-b:a', `${kbps}k`]
            : mode === 'wav16' ? ['-b:a', '24k']
                : ['-b:a', '24k', '-application', 'voip'];
        await runFfmpeg(['-i', wav, '-c:a', 'libopus', ...bitrate, '-map_metadata', '-1', output]);
    } finally {
        fs.rmSync(wav, { force: true });
    }
}

/**
 * Reduces signed 16-bit little-endian mono PCM to `bars` loudness values
 * scaled to 0-100 (the loudest bar is always 100). Pure function.
 *
 * @param {Buffer} pcm
 * @param {number} [bars]
 * @returns {Uint8Array}
 */
function waveformFromPcm(pcm, bars = 64) {
    const samples = Math.floor(pcm.length / 2);
    const levels = new Array(bars).fill(0);
    if (samples === 0) return Uint8Array.from(levels);

    const perBar = Math.max(1, Math.floor(samples / bars));
    for (let bar = 0; bar < bars; bar++) {
        const from = bar * perBar;
        const to = Math.min(samples, from + perBar);
        let sum = 0;
        for (let i = from; i < to; i++) sum += Math.abs(pcm.readInt16LE(i * 2));
        levels[bar] = to > from ? sum / (to - from) : 0;
    }
    const peak = Math.max(...levels) || 1;
    return Uint8Array.from(levels.map((v) => Math.round((v / peak) * 100)));
}

/**
 * Decodes an audio file to 8 kHz PCM and computes its waveform.
 *
 * @param {string} file
 * @returns {Promise<Uint8Array>} 64 values between 0 and 100.
 */
async function computeWaveform(file) {
    const pcm = await runFfmpegToBuffer(['-i', file, '-vn', '-f', 's16le', '-ac', '1', '-ar', '8000', '-']);
    return waveformFromPcm(pcm);
}

module.exports = { AUDIO_MODES, extractAudio, waveformFromPcm, computeWaveform };

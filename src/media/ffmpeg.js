'use strict';

/**
 * Locates and runs the FFmpeg / FFprobe binaries.
 *
 * Lookup order for each binary:
 *   1. `FFMPEG_PATH` / `FFPROBE_PATH` environment variables.
 *   2. Next to the running executable (the release bundles ship them there),
 *      either directly or inside an `ffmpeg/` subfolder.
 *   3. The system `PATH`.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * @param {'ffmpeg' | 'ffprobe'} name
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [executablePath] Path of the running Node binary / bundled executable.
 * @returns {string} Absolute path when a bundled copy exists, otherwise the bare name.
 */
function resolveBinary(name, env = process.env, executablePath = process.execPath) {
    const override = env[`${name.toUpperCase()}_PATH`];
    if (override) return override;

    const fileName = process.platform === 'win32' ? `${name}.exe` : name;
    const baseDir = path.dirname(executablePath);
    for (const candidate of [path.join(baseDir, fileName), path.join(baseDir, 'ffmpeg', fileName)]) {
        if (fs.existsSync(candidate)) return candidate;
    }
    return name;
}

const binaries = { ffmpeg: resolveBinary('ffmpeg'), ffprobe: resolveBinary('ffprobe') };

/**
 * Runs FFmpeg quietly (`-v error`), overwriting outputs (`-y`).
 *
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileOptions} [options]
 */
function runFfmpeg(args, options = {}) {
    return execFileAsync(binaries.ffmpeg, ['-v', 'error', '-y', ...args], { maxBuffer: MAX_OUTPUT_BYTES, ...options });
}

/**
 * Runs FFmpeg returning stdout as a Buffer (used to pipe raw PCM samples).
 *
 * @param {string[]} args
 * @returns {Promise<Buffer>}
 */
async function runFfmpegToBuffer(args) {
    const { stdout } = await execFileAsync(binaries.ffmpeg, ['-v', 'error', '-y', ...args],
        { maxBuffer: MAX_OUTPUT_BYTES, encoding: 'buffer' });
    return /** @type {Buffer} */ (stdout);
}

/**
 * Runs FFmpeg with its full log on stderr (needed to read filter reports such as `volumedetect`).
 *
 * @param {string[]} args
 * @returns {Promise<string>} stderr
 */
async function runFfmpegVerbose(args) {
    const { stderr } = await execFileAsync(binaries.ffmpeg, ['-hide_banner', '-nostats', ...args], { maxBuffer: MAX_OUTPUT_BYTES });
    return String(stderr);
}

/**
 * Runs FFprobe and parses its JSON output.
 *
 * @param {string[]} args
 * @returns {Promise<any>}
 */
async function runFfprobeJson(args) {
    const { stdout } = await execFileAsync(binaries.ffprobe, ['-v', 'error', ...args, '-of', 'json'], { maxBuffer: MAX_OUTPUT_BYTES });
    return JSON.parse(String(stdout));
}

/**
 * Fails early, with an actionable message, when FFmpeg/FFprobe are missing or
 * were built without the encoders the bot needs.
 *
 * @returns {Promise<string>} The FFmpeg version line.
 */
async function assertFfmpegReady() {
    let version;
    try {
        const { stdout } = await execFileAsync(binaries.ffmpeg, ['-hide_banner', '-version']);
        version = String(stdout).split('\n')[0];
        await execFileAsync(binaries.ffprobe, ['-hide_banner', '-version']);
    } catch {
        throw new Error('FFmpeg/FFprobe not found. Install FFmpeg and make sure both "ffmpeg" and "ffprobe" ' +
            'are on your PATH, or place them next to the executable, or set FFMPEG_PATH and FFPROBE_PATH.');
    }
    const { stdout } = await execFileAsync(binaries.ffmpeg, ['-hide_banner', '-encoders'], { maxBuffer: MAX_OUTPUT_BYTES });
    const missing = ['libwebp', 'libopus'].filter((encoder) => !new RegExp(`\\s${encoder}\\s`).test(String(stdout)));
    if (missing.length) {
        throw new Error(`Your FFmpeg build lacks the encoder(s): ${missing.join(', ')}. Install a full FFmpeg build.`);
    }
    return version;
}

module.exports = { binaries, resolveBinary, runFfmpeg, runFfmpegToBuffer, runFfmpegVerbose, runFfprobeJson, assertFfmpegReady };

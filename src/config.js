'use strict';

/**
 * Runtime configuration.
 *
 * Every setting is read from environment variables. When a `.env` file exists
 * in the working directory it is loaded first; variables already present in the
 * real environment take precedence over the file.
 */

const fs = require('node:fs');
const path = require('node:path');

/** WhatsApp rejects animated stickers heavier than this. */
const MAX_STICKER_BYTES = 500 * 1024;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

/**
 * Loads `KEY=value` pairs from a `.env` file into `process.env` if the file exists.
 *
 * @param {string} [file] Path to the env file. Defaults to `./.env`.
 * @returns {boolean} `true` when a file was found and loaded.
 */
function loadEnvFile(file = path.join(process.cwd(), '.env')) {
    if (!fs.existsSync(file) || typeof process.loadEnvFile !== 'function') return false;
    process.loadEnvFile(file);
    return true;
}

/**
 * Parses a numeric variable.
 *
 * @param {string | undefined} raw Raw value from the environment.
 * @param {number} fallback Value used when `raw` is missing or not a finite number.
 * @param {{ min?: number, max?: number }} [limits] Inclusive bounds applied to the result.
 * @returns {number}
 */
function parseNumber(raw, fallback, { min = -Infinity, max = Infinity } = {}) {
    const value = raw === undefined || String(raw).trim() === '' ? NaN : Number(raw);
    const result = Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, result));
}

/**
 * Parses a boolean variable. Accepts 1/0, true/false, yes/no and on/off.
 *
 * @param {string | undefined} raw Raw value from the environment.
 * @param {boolean} fallback Value used when `raw` is missing or unrecognised.
 * @returns {boolean}
 */
function parseFlag(raw, fallback) {
    if (raw === undefined) return fallback;
    const normalized = String(raw).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    return fallback;
}

/**
 * Builds the immutable configuration object used by the whole bot.
 *
 * @param {NodeJS.ProcessEnv} [env] Source of the variables (injectable for tests).
 * @param {string} [cwd] Base directory for relative folders.
 */
function loadConfig(env = process.env, cwd = process.cwd()) {
    const debug = parseFlag(env.DEBUG, false);

    return Object.freeze({
        command: (env.COMMAND || '!a').trim().toLowerCase(),
        testCommand: (env.TEST_COMMAND || '!t').trim().toLowerCase(),

        maxSeconds: parseNumber(env.MAX_SECONDS, 25, { min: 1, max: 60 }),
        maxFrames: parseNumber(env.MAX_FRAMES, 250, { min: 30, max: 1000 }),
        maxStickerBytes: MAX_STICKER_BYTES,

        audioKbps: parseNumber(env.AUDIO_KBPS, 32, { min: 8, max: 128 }),
        audioLeadMs: parseNumber(env.AUDIO_LEAD_MS, 100, { min: 0, max: 2000 }),

        maxParallelJobs: parseNumber(env.MAX_PARALLEL_JOBS, 2, { min: 1, max: 16 }),
        maxMessageAgeSeconds: 120,
        replyToMessage: parseFlag(env.REPLY_TO_MESSAGE, true),

        sessionDir: path.resolve(cwd, env.SESSION_DIR || 'whatsapp_session'),
        pairingNumber: (env.PAIRING_NUMBER || '').replace(/\D/g, ''),

        saveOutputs: parseFlag(env.SAVE_OUTPUTS, false),
        outputsDir: path.resolve(cwd, env.OUTPUTS_DIR || 'outputs'),
        keepOutputs: parseNumber(env.KEEP_OUTPUTS, 15, { min: 1 }),

        debug,
        verifyUpload: parseFlag(env.VERIFY_UPLOAD, debug)
    });
}

module.exports = { MAX_STICKER_BYTES, loadEnvFile, loadConfig, parseNumber, parseFlag };

'use strict';

/**
 * Minimal console logger. Every line looks like `[HH:MM:SS] [TAG] message`,
 * which keeps the output easy to grep while debugging a conversion.
 */

const timestamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

/**
 * @param {string} tag Short category, e.g. `IN`, `OUT`, `STEP`, `ERR`.
 * @param {string} message
 */
function log(tag, message) {
    console.log(`[${timestamp()}] [${tag}] ${message}`);
}

/**
 * @param {number} bytes
 * @returns {string} Size rounded to kilobytes, e.g. `"412 KB"`.
 */
function formatKb(bytes) {
    return `${Math.round(bytes / 1024)} KB`;
}

/**
 * libsignal (used by Baileys) prints whole Signal sessions, private keys included,
 * through `console.info` whenever it closes a session. Those lines are dropped so
 * that secrets never end up in a log someone copies into an issue or a chat.
 */
function silenceSignalSessionDumps() {
    const original = console.info.bind(console);
    console.info = (...args) => {
        if (typeof args[0] === 'string' && args[0].startsWith('Closing')) return;
        original(...args);
    };
}

module.exports = { log, formatKb, silenceSignalSessionDumps };

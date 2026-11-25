'use strict';

/**
 * Helpers to run a named pipeline step, time it and retry it when the failure
 * comes from the network (media downloads and uploads are the usual suspects).
 */

const { log } = require('./logger');

const NETWORK_ERROR = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|UND_ERR|socket|timed out/i;

/**
 * Node's `fetch` wraps the real network error inside `error.cause`.
 * This returns that inner reason (code, name and message) as one string.
 *
 * @param {unknown} error
 * @returns {string} Empty string when there is no cause.
 */
function errorCause(error) {
    const cause = error && /** @type {any} */ (error).cause;
    if (!cause) return '';
    return [cause.code, cause.name !== 'Error' ? cause.name : '', cause.message].filter(Boolean).join(' ');
}

/**
 * @param {unknown} error
 * @returns {string} Error message plus its cause, if any.
 */
function describeError(error) {
    const cause = errorCause(error);
    const message = error instanceof Error ? error.message : String(error);
    return cause ? `${message} | cause: ${cause}` : message;
}

/**
 * @param {unknown} error
 * @returns {boolean} Whether the failure looks transient (network related).
 */
function isNetworkError(error) {
    return NETWORK_ERROR.test(describeError(error));
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn`, logs its duration and retries it with a linear back-off when it
 * fails with a network error. Any other error is rethrown immediately. The
 * thrown error gets a `step` property with the step name so the caller can
 * report where the pipeline broke.
 *
 * @template T
 * @param {string} name Human readable step name.
 * @param {() => Promise<T>} fn Work to run.
 * @param {{ retries?: number, delayMs?: number, sleep?: (ms: number) => Promise<void> }} [options]
 * @returns {Promise<T>}
 */
async function runStep(name, fn, { retries = 0, delayMs = 1500, sleep = wait } = {}) {
    for (let attempt = 0; ; attempt++) {
        const startedAt = Date.now();
        try {
            const result = await fn();
            log('STEP', `${name} ok (${Date.now() - startedAt}ms)`);
            return result;
        } catch (error) {
            log('ERR', `${name} failed (attempt ${attempt + 1}/${retries + 1}): ${describeError(error)}`);
            if (!isNetworkError(error) || attempt >= retries) {
                if (error && typeof error === 'object') /** @type {any} */ (error).step = name;
                throw error;
            }
            await sleep(delayMs * (attempt + 1));
        }
    }
}

module.exports = { errorCause, describeError, isNetworkError, runStep };

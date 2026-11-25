'use strict';

/**
 * Small FIFO job queue with a concurrency limit. Video conversion is CPU heavy,
 * so only a few jobs run at once and the rest wait their turn.
 *
 * @param {number} limit Maximum number of jobs running at the same time.
 * @param {{ onQueued?: (pending: number) => void }} [hooks]
 */
function createQueue(limit, { onQueued } = {}) {
    let active = 0;
    /** @type {Array<() => void>} */
    const waiting = [];

    const next = () => {
        active--;
        const start = waiting.shift();
        if (start) start();
    };

    return {
        /**
         * Schedules `task` and resolves/rejects with its result.
         *
         * @template T
         * @param {() => Promise<T>} task
         * @returns {Promise<T>}
         */
        run(task) {
            return new Promise((resolve, reject) => {
                const start = () => {
                    active++;
                    Promise.resolve()
                        .then(task)
                        .then(resolve, reject)
                        .finally(next);
                };
                if (active < limit) {
                    start();
                } else {
                    waiting.push(start);
                    if (onQueued) onQueued(waiting.length);
                }
            });
        },
        get active() { return active; },
        get pending() { return waiting.length; }
    };
}

module.exports = { createQueue };

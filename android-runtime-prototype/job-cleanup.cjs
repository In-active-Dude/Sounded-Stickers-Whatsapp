'use strict';
const fs = require('node:fs');
const path = require('node:path');

function jobPath(cacheRoot, job) {
    if (typeof cacheRoot !== 'string' || typeof job !== 'string') throw new Error('Temporary job path is missing.');
    const root = path.resolve(cacheRoot), target = path.resolve(job);
    if (path.dirname(target) !== root || !/^sticker-job-[a-f0-9-]{36}$/.test(path.basename(target))) {
        throw new Error('Invalid temporary job path.');
    }
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('Invalid temporary job directory.');
    return target;
}

function removeJob(cacheRoot, job) {
    const target = jobPath(cacheRoot, job);
    fs.rmSync(target, { recursive: true, force: true });
}

async function withJobCleanup(cacheRoot, job, task) {
    jobPath(cacheRoot, job);
    try { return await task(); }
    finally { removeJob(cacheRoot, job); }
}

module.exports = { jobPath, removeJob, withJobCleanup };

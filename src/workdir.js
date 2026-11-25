'use strict';

/**
 * Per-request working directories.
 *
 * By default every request works in a fresh folder under the OS temp directory
 * that is deleted when the request ends, so received videos do not stay on disk.
 * With `SAVE_OUTPUTS=1` the folder is created under `outputs/<timestamp>/` and
 * kept for inspection; only the newest `KEEP_OUTPUTS` folders are retained.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/**
 * @param {{ saveOutputs: boolean, outputsDir: string, keepOutputs: number }} config
 * @returns {{ dir: string, persistent: boolean, cleanup: () => void }}
 */
function createWorkDir({ saveOutputs, outputsDir, keepOutputs }) {
    if (!saveOutputs) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sound-sticker-'));
        return { dir, persistent: false, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
    }

    fs.mkdirSync(outputsDir, { recursive: true });
    const dir = path.join(outputsDir, new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    pruneOldFolders(outputsDir, keepOutputs);
    return { dir, persistent: true, cleanup: () => {} };
}

/**
 * Deletes the oldest subfolders of `parent` (by name, which is an ISO timestamp)
 * so that at most `keep` remain.
 *
 * @param {string} parent
 * @param {number} keep
 */
function pruneOldFolders(parent, keep) {
    const folders = fs.readdirSync(parent).sort();
    for (const old of folders.slice(0, Math.max(0, folders.length - keep))) {
        fs.rmSync(path.join(parent, old), { recursive: true, force: true });
    }
}

module.exports = { createWorkDir, pruneOldFolders };

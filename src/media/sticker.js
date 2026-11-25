'use strict';

/**
 * Video -> animated WebP sticker (512x512, transparent padding, under 500 KB).
 *
 * Every frame is encoded as a complete picture with FFmpeg's `libwebp` encoder.
 * The animated encoder (`libwebp_anim`) is deliberately not used: to save space
 * it keeps blocks from the previous frame whenever they changed by less than a
 * tolerance that grows as quality drops (about 15 levels per channel at quality
 * 30, 20 at quality 12), which leaves stale blocks all over moving images.
 *
 * The output size is then dominated by one trade-off: frames per second versus
 * per-frame quality. Because frames are independent, the size grows linearly
 * with the frame count and the cost of one frame does not depend on the frame
 * rate, so the final size is predictable from a tiny sample:
 *
 *   1. Cut a short sample (three 1-second windows spread across the clip).
 *   2. Encode the sample once per quality level, in parallel, and measure the
 *      average bytes per frame for each quality.
 *   3. Pick the highest frame rate that still leaves a decent quality inside the
 *      size budget; when no frame rate allows that, keep the lowest frame rate
 *      and the best quality that fits (see {@link planEncoding}). The frame rate
 *      is capped by `maxFrames` so long stickers do not stutter on phones.
 *   4. Encode the full clip once; if it is still too heavy, step down quality
 *      or frame rate and try again. If it came out with room to spare, try one
 *      quality step higher and keep it when it still fits.
 *
 * Short clips (<= 6 s) are first tried with a single high quality encode,
 * which is almost always under the limit.
 */

const fs = require('node:fs');
const os = require('node:os');
const { runFfmpeg } = require('./ffmpeg');
const { parseWebp } = require('./webp');

const STICKER_SIZE = 512;
const SHORT_CLIP_SECONDS = 6;
const DIRECT_ENCODE = Object.freeze({ fps: 15, quality: 50 });

/** Frame rates considered for long clips, best first. */
const FPS_LADDER = Object.freeze([15, 12, 10, 8, 6, 5]);
/** libwebp quality levels (0-100) sampled for long clips, best first. */
const QUALITY_LADDER = Object.freeze([75, 60, 45, 30, 20, 12, 6, 2]);
/**
 * Minimum quality worth trading frames for, relaxed in order. The planner first
 * looks for the highest fps that fits with quality >= 30, then >= 12.
 */
const QUALITY_FLOORS = Object.freeze([30, 12]);

/**
 * libwebp effort (0-6). Level 4 produces files within ~2 % of level 6 at the
 * same quality while being many times faster, so it is used for every encode.
 */
const COMPRESSION_LEVEL = 4;

/** Fraction of the 500 KB limit targeted by the prediction (leaves room for estimation error). */
const BUDGET_RATIO = 0.95;
const MAX_FULL_ENCODES = 4;
/** An upgrade is attempted when its predicted size is within this fraction of the limit (the result is verified anyway). */
const UPGRADE_MARGIN = 1.03;
const SAMPLE = Object.freeze({ windows: 3, windowSeconds: 1, fps: 10 });

/**
 * FFmpeg filter chain: resample to `fps`, fit inside 512x512 keeping the aspect
 * ratio and centre the picture on a transparent 512x512 canvas.
 *
 * @param {number} fps
 * @returns {string}
 */
function stickerFilter(fps) {
    return `fps=${fps},scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease,` +
        `format=rgba,pad=${STICKER_SIZE}:${STICKER_SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
}

/**
 * Encodes `input` (first `duration` seconds) as an animated, looping WebP.
 *
 * @param {string} input
 * @param {string} output
 * @param {{ fps: number, quality: number, duration?: number }} params
 * @returns {Promise<number>} Output size in bytes.
 */
async function encodeWebp(input, output, { fps, quality, duration }) {
    await runFfmpeg([
        ...(duration ? ['-t', duration.toFixed(3)] : []), '-i', input,
        '-an', '-c:v', 'libwebp', '-lossless', '0', '-q:v', String(quality),
        '-compression_level', String(COMPRESSION_LEVEL),
        '-vf', stickerFilter(fps), '-loop', '0', output
    ]);
    return fs.statSync(output).size;
}

/**
 * Evenly spread, non-trivial sample windows. Clips shorter than the total
 * sample length are sampled whole.
 *
 * @param {number} duration Clip length in seconds.
 * @param {number} [count]
 * @param {number} [windowSeconds]
 * @returns {{ start: number, end: number }[]}
 */
function sampleWindows(duration, count = SAMPLE.windows, windowSeconds = SAMPLE.windowSeconds) {
    if (duration <= count * windowSeconds) return [{ start: 0, end: duration }];
    return Array.from({ length: count }, (_, i) => {
        const start = ((duration - windowSeconds) * (i + 0.5)) / count;
        return { start, end: start + windowSeconds };
    });
}

/**
 * Runs `fn` over `items` with at most `limit` promises in flight.
 *
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>} Results in input order.
 */
async function mapWithConcurrency(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
    return results;
}

/**
 * Measures the average WebP cost of one frame at every quality of
 * {@link QUALITY_LADDER}, using a short lossless sample of the clip.
 *
 * @param {string} input
 * @param {string} output Final sticker path (temporary files are created next to it).
 * @param {number} duration
 * @returns {Promise<Record<number, number>>} quality -> bytes per frame
 */
async function measureBytesPerFrame(input, output, duration) {
    const sample = `${output}.sample.mkv`;
    const windows = sampleWindows(duration)
        .map(({ start, end }) => `between(t,${start.toFixed(3)},${end.toFixed(3)})`).join('+');
    try {
        await runFfmpeg([
            '-t', duration.toFixed(3), '-i', input, '-an',
            '-vf', `fps=${SAMPLE.fps},select='${windows}',setpts=N/(${SAMPLE.fps}*TB),` +
                `scale=${STICKER_SIZE}:${STICKER_SIZE}:force_original_aspect_ratio=decrease`,
            '-c:v', 'ffv1', sample
        ]);

        const limit = Math.max(1, os.availableParallelism ? os.availableParallelism() : os.cpus().length);
        const measurements = await mapWithConcurrency(QUALITY_LADDER, limit, async (quality) => {
            const file = `${output}.q${quality}.webp`;
            try {
                const bytes = await encodeWebp(sample, file, { fps: SAMPLE.fps, quality });
                const info = parseWebp(fs.readFileSync(file));
                return [quality, bytes / Math.max(1, info ? info.frames : 1)];
            } finally {
                fs.rmSync(file, { force: true });
            }
        });
        return Object.fromEntries(measurements);
    } finally {
        fs.rmSync(sample, { force: true });
    }
}

/**
 * @typedef {object} EncodingPlan
 * @property {number} fps
 * @property {number} quality
 * @property {number} predictedBytes
 * @property {boolean} fitsBudget Whether the prediction is under the budget.
 */

/**
 * Chooses frame rate and quality for a clip from measured per-frame costs.
 *
 * Frame rates allowed by `maxFrames` are tried from highest to lowest, first
 * requiring quality >= 30, then >= 12 (see {@link QUALITY_FLOORS}). The first
 * combination whose predicted size fits the budget wins; within a frame rate the
 * highest fitting quality is used. If even 12 does not fit, the lowest allowed
 * frame rate is used with the best quality that fits, because sharper frames
 * look better than a few extra blurry ones. Pure function.
 *
 * @param {object} input
 * @param {number} input.duration Clip length in seconds.
 * @param {Record<number, number>} input.bytesPerFrame quality -> average bytes per frame.
 * @param {number} input.budgetBytes Target size.
 * @param {number} input.maxFrames Upper bound for `fps * duration`.
 * @returns {EncodingPlan}
 */
function planEncoding({ duration, bytesPerFrame, budgetBytes, maxFrames }) {
    const allowedFps = FPS_LADDER.filter((fps) => fps * duration <= maxFrames);
    const fpsOptions = allowedFps.length ? allowedFps : [FPS_LADDER[FPS_LADDER.length - 1]];
    const qualities = QUALITY_LADDER.filter((q) => Number.isFinite(bytesPerFrame[q]));
    const predict = (fps, quality) => Math.round(bytesPerFrame[quality] * fps * duration);

    for (const floor of QUALITY_FLOORS) {
        for (const fps of fpsOptions) {
            for (const quality of qualities) {
                if (quality < floor) break;
                const predictedBytes = predict(fps, quality);
                if (predictedBytes <= budgetBytes) return { fps, quality, predictedBytes, fitsBudget: true };
            }
        }
    }

    const fps = fpsOptions[fpsOptions.length - 1];
    for (const quality of qualities) {
        const predictedBytes = predict(fps, quality);
        if (predictedBytes <= budgetBytes) return { fps, quality, predictedBytes, fitsBudget: true };
    }
    const quality = qualities[qualities.length - 1] ?? QUALITY_LADDER[QUALITY_LADDER.length - 1];
    return { fps, quality, predictedBytes: predict(fps, quality), fitsBudget: false };
}

/**
 * Next, lighter setting to try after an encode came out too big: lower the
 * quality while it is still above 12, then lower the frame rate, then squeeze
 * the quality to the bottom. Returns `null` when nothing lighter is left.
 *
 * @param {{ fps: number, quality: number }} current
 * @returns {{ fps: number, quality: number } | null}
 */
function lighterSetting({ fps, quality }) {
    const lowerQuality = QUALITY_LADDER.find((q) => q < quality);
    const lowerFps = FPS_LADDER.find((f) => f < fps);
    if (lowerQuality !== undefined && quality > 12) return { fps, quality: lowerQuality };
    if (lowerFps !== undefined) return { fps: lowerFps, quality };
    if (lowerQuality !== undefined) return { fps, quality: lowerQuality };
    return null;
}

/**
 * Quality one step above `quality` whose predicted size, scaled from the size
 * actually obtained, still fits under `maxBytes`. Pure function.
 *
 * @param {{ quality: number, bytes: number }} current Result of an encode that fit.
 * @param {Record<number, number>} bytesPerFrame quality -> average bytes per frame.
 * @param {number} maxBytes
 * @returns {number | null}
 */
function higherQualityThatFits({ quality, bytes }, bytesPerFrame, maxBytes) {
    const higher = [...QUALITY_LADDER].reverse().find((q) => q > quality);
    if (higher === undefined || !bytesPerFrame[higher] || !bytesPerFrame[quality]) return null;
    const predicted = (bytes * bytesPerFrame[higher]) / bytesPerFrame[quality];
    return predicted <= maxBytes * UPGRADE_MARGIN ? higher : null;
}

/**
 * The plan aims below the limit to absorb estimation errors. When the result
 * left enough room, one more encode at the next quality step is attempted and
 * kept only if it still fits.
 *
 * @returns {Promise<{ encoded: boolean, result: { fps: number, quality: number, bytes: number } | null }>}
 */
async function tryHigherQuality(input, output, duration, current, bytesPerFrame, maxBytes) {
    const quality = higherQualityThatFits(current, bytesPerFrame, maxBytes);
    if (quality === null) return { encoded: false, result: null };

    const candidate = `${output}.upgrade.webp`;
    try {
        const bytes = await encodeWebp(input, candidate, { fps: current.fps, quality, duration });
        if (bytes > maxBytes) return { encoded: true, result: null };
        fs.renameSync(candidate, output);
        return { encoded: true, result: { fps: current.fps, quality, bytes } };
    } finally {
        fs.rmSync(candidate, { force: true });
    }
}

/**
 * @typedef {object} StickerResult
 * @property {number} fps
 * @property {number} quality
 * @property {number} bytes
 * @property {number} encodes Number of full-length encodes performed.
 * @property {'direct' | 'planned'} strategy
 * @property {boolean} oversized True if even the lightest attempt exceeds `maxBytes`.
 */

/**
 * Converts the first `duration` seconds of `input` into a WhatsApp animated sticker.
 *
 * @param {string} input Source video.
 * @param {string} output Destination `.webp`.
 * @param {number} duration Seconds to keep.
 * @param {{ maxBytes: number, maxFrames: number }} limits
 * @returns {Promise<StickerResult>}
 */
async function convertToSticker(input, output, duration, { maxBytes, maxFrames }) {
    let encodes = 0;

    if (duration <= SHORT_CLIP_SECONDS && DIRECT_ENCODE.fps * duration <= maxFrames) {
        encodes++;
        const bytes = await encodeWebp(input, output, { ...DIRECT_ENCODE, duration });
        if (bytes <= maxBytes) return { ...DIRECT_ENCODE, bytes, encodes, strategy: 'direct', oversized: false };
    }

    const bytesPerFrame = await measureBytesPerFrame(input, output, duration);
    /** @type {{ fps: number, quality: number } | null} */
    let setting = planEncoding({ duration, bytesPerFrame, budgetBytes: maxBytes * BUDGET_RATIO, maxFrames });
    let last = { fps: setting.fps, quality: setting.quality, bytes: Infinity };

    while (setting && encodes < MAX_FULL_ENCODES + 1) {
        encodes++;
        const bytes = await encodeWebp(input, output, { ...setting, duration });
        last = { fps: setting.fps, quality: setting.quality, bytes };
        if (bytes <= maxBytes) {
            const upgraded = await tryHigherQuality(input, output, duration, last, bytesPerFrame, maxBytes);
            if (upgraded.encoded) encodes++;
            return { ...(upgraded.result || last), encodes, strategy: 'planned', oversized: false };
        }
        setting = lighterSetting(setting);
    }
    return { ...last, encodes, strategy: 'planned', oversized: true };
}

module.exports = {
    STICKER_SIZE, FPS_LADDER, QUALITY_LADDER, QUALITY_FLOORS, COMPRESSION_LEVEL,
    stickerFilter, encodeWebp, sampleWindows, mapWithConcurrency,
    measureBytesPerFrame, planEncoding, lighterSetting, higherQualityThatFits, convertToSticker
};

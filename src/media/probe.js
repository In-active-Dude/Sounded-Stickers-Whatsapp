'use strict';

/**
 * Media inspection with FFprobe / FFmpeg.
 */

const { runFfprobeJson, runFfmpegVerbose } = require('./ffmpeg');

/**
 * @typedef {object} VideoInfo
 * @property {number | null} duration Container duration in seconds.
 * @property {boolean} hasAudio
 * @property {any} audio First audio stream as reported by FFprobe, or null.
 * @property {any} video First video stream as reported by FFprobe, or null.
 * @property {number} audioStreamCount
 */

/**
 * Reads duration and stream layout of a video with a single FFprobe call.
 *
 * @param {string} file
 * @returns {Promise<VideoInfo>}
 */
async function probeVideo(file) {
    const info = await runFfprobeJson(['-show_entries',
        'format=duration:stream=codec_type,codec_name,channels,channel_layout,sample_rate,start_time,width,height', file]);
    const duration = parseFloat(info.format && info.format.duration);
    const streams = info.streams || [];
    const audioStreams = streams.filter((s) => s.codec_type === 'audio');
    return {
        duration: Number.isFinite(duration) && duration > 0 ? duration : null,
        hasAudio: audioStreams.length > 0,
        audio: audioStreams[0] || null,
        video: streams.find((s) => s.codec_type === 'video') || null,
        audioStreamCount: audioStreams.length
    };
}

/**
 * One-line, human readable summary of a probed video (for logs).
 *
 * @param {VideoInfo} info
 * @returns {string}
 */
function describeVideo({ audio, video, audioStreamCount }) {
    const audioText = audio
        ? `audio=${audio.codec_name} ${audio.channels}ch${audio.channel_layout ? `(${audio.channel_layout})` : ''} ` +
          `${audio.sample_rate}Hz start=${audio.start_time}s${audioStreamCount > 1 ? ` [${audioStreamCount} audio tracks]` : ''}`
        : 'no audio';
    const videoText = video ? `video=${video.codec_name} ${video.width}x${video.height} start=${video.start_time}s` : 'no video';
    return `${audioText} | ${videoText}`;
}

/**
 * Extracts the numeric value of a `volumedetect` report line.
 *
 * @param {string} log FFmpeg stderr.
 * @param {'mean_volume' | 'max_volume'} key
 * @returns {number | null} Decibels, `-Infinity` for digital silence, `null` if absent.
 */
function readVolume(log, key) {
    const match = log.match(new RegExp(`${key}:\\s*(-?[\\d.]+|-?inf) dB`));
    if (!match) return null;
    return /inf/.test(match[1]) ? -Infinity : parseFloat(match[1]);
}

/**
 * @typedef {object} AudioInfo
 * @property {string | null} codec
 * @property {number | null} sampleRate
 * @property {number | null} channels
 * @property {number | null} startTime
 * @property {number | null} duration
 * @property {number | null} meanDb
 * @property {number | null} peakDb
 * @property {string[]} decodeErrors Lines FFmpeg flagged while decoding.
 */

/**
 * Probes an audio file and fully decodes it to measure its loudness. Decoding the
 * whole file is the closest thing to "playing" it: corrupt data shows up as errors.
 *
 * @param {string} file
 * @returns {Promise<AudioInfo>}
 */
async function inspectAudio(file) {
    const info = await runFfprobeJson(['-select_streams', 'a:0',
        '-show_entries', 'stream=codec_name,sample_rate,channels,start_time:format=duration', file]);
    const stream = (info.streams || [])[0] || {};
    const log = await runFfmpegVerbose(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']);
    return {
        codec: stream.codec_name || null,
        sampleRate: stream.sample_rate ? Number(stream.sample_rate) : null,
        channels: stream.channels || null,
        startTime: stream.start_time !== undefined ? parseFloat(stream.start_time) : null,
        duration: parseFloat(info.format && info.format.duration) || null,
        meanDb: readVolume(log, 'mean_volume'),
        peakDb: readVolume(log, 'max_volume'),
        decodeErrors: log.split('\n').filter((l) => /error|invalid|corrupt|truncat/i.test(l) && !/volumedetect/i.test(l))
    };
}

module.exports = { probeVideo, describeVideo, inspectAudio, readVolume };

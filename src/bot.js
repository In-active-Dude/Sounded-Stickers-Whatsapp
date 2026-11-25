'use strict';

/**
 * WhatsApp connection and message routing.
 *
 * The bot logs in as a linked device of a normal WhatsApp account (the same
 * mechanism as WhatsApp Web), keeps its credentials in `SESSION_DIR`, reconnects
 * automatically and dispatches commands to the handlers through a bounded queue.
 */

const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const { log, formatKb } = require('./logger');
const { describeError } = require('./retry');
const { createQueue } = require('./queue');
const { handleStickerCommand, handleTestCommand } = require('./handlers');
const { analyzeIncomingSticker } = require('./whatsapp/inspect');

/** How many processed message ids are remembered to ignore duplicates. */
const SEEN_IDS_LIMIT = 500;

/**
 * Returns the video payload of a message, whether it was sent as a regular
 * video or as a document with a caption.
 *
 * @param {any} content `message.message`
 */
function videoOf(content) {
    return content.videoMessage || content.documentWithCaptionMessage?.message?.videoMessage || null;
}

/**
 * Decides whether a message is a bot command. Pure function.
 *
 * @param {any} message Incoming `WAMessage`.
 * @param {{ command: string, testCommand: string, debug: boolean }} config
 * @returns {{ kind: 'sticker' | 'test', video: any } | null}
 */
function parseCommand(message, config) {
    if (!message || !message.message) return null;
    const video = videoOf(message.message);
    const caption = video?.caption?.trim().toLowerCase();
    if (!video || !caption) return null;
    if (caption === config.command) return { kind: 'sticker', video };
    if (config.debug && caption === config.testCommand) return { kind: 'test', video };
    return null;
}

/**
 * Whether a message is recent. On reconnection WhatsApp replays history; old
 * commands must not be processed again.
 *
 * @param {any} message
 * @param {number} maxAgeSeconds
 * @param {number} [nowMs]
 */
function isFresh(message, maxAgeSeconds, nowMs = Date.now()) {
    return nowMs / 1000 - Number(message.messageTimestamp || 0) <= maxAgeSeconds;
}

/**
 * Remembers ids in insertion order, forgetting the oldest beyond `limit`.
 *
 * @param {number} limit
 */
function createSeenSet(limit) {
    const ids = new Set();
    return {
        /** @returns {boolean} `true` the first time an id is seen. */
        add(id) {
            if (ids.has(id)) return false;
            ids.add(id);
            if (ids.size > limit) ids.delete(ids.values().next().value);
            return true;
        }
    };
}

/**
 * Connects to WhatsApp and starts handling messages.
 *
 * @param {ReturnType<typeof import('./config').loadConfig>} config
 */
async function startBot(config) {
    const queue = createQueue(config.maxParallelJobs, {
        onQueued: (pending) => log('QUEUE', `waiting (${pending} pending)`)
    });
    const seen = createSeenSet(SEEN_IDS_LIMIT);

    const connect = async () => {
        const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ['Ubuntu', 'Chrome', '20.0.04']
        });
        let pairingRequested = false;

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (qr && config.pairingNumber && !pairingRequested) {
                pairingRequested = true;
                try {
                    const code = await sock.requestPairingCode(config.pairingNumber);
                    log('LOGIN', `Pairing code: ${code}`);
                    log('LOGIN', 'WhatsApp > Linked devices > Link a device > Link with phone number instead, then type the code.');
                } catch (error) {
                    log('ERR', `could not request a pairing code: ${describeError(error)}`);
                }
            } else if (qr && !config.pairingNumber) {
                console.clear();
                console.log('Scan this QR code with WhatsApp (Settings > Linked devices > Link a device):');
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const status = lastDisconnect?.error?.output?.statusCode;
                log('CONNECTION', `closed (code ${status})`);
                if (status === DisconnectReason.loggedOut) {
                    log('CONNECTION', `logged out. Delete the "${config.sessionDir}" folder and start again to link a new session.`);
                    return;
                }
                log('CONNECTION', 'reconnecting...');
                connect().catch((error) => log('ERR', `reconnection failed: ${describeError(error)}`));
            } else if (connection === 'open') {
                log('CONNECTION', `linked. Send a video with the caption ${config.command} to get a sticker with sound.`);
                log('CONFIG', `max ${config.maxSeconds}s | max frames ${config.maxFrames} | audio ${config.audioKbps} kbps | ` +
                    `audio lead ${config.audioLeadMs}ms | reply ${config.replyToMessage ? 'yes' : 'no'} | ` +
                    `save files ${config.saveOutputs ? `yes (${config.outputsDir})` : 'no'} | debug ${config.debug ? 'yes' : 'no'}`);
                if (config.debug) log('CONFIG', `debug: ${config.testCommand} sends audio test variants; incoming sound stickers are analysed.`);
            }
        });

        sock.ev.on('messages.upsert', ({ messages }) => {
            for (const message of messages) {
                if (!message || !message.message || !isFresh(message, config.maxMessageAgeSeconds)) continue;

                const sticker = message.message.stickerMessage;
                if (config.debug && sticker && sticker.fileSha256) {
                    analyzeIncomingSticker(sock, message, sticker)
                        .catch((error) => log('ERR', `analysing incoming sticker: ${describeError(error)}`));
                }

                const command = parseCommand(message, config);
                if (!command || !seen.add(message.key.id)) continue;

                const { video } = command;
                const sender = message.key.fromMe ? 'me' : (message.key.participant || message.key.remoteJid);
                log('IN', `${command.kind} command | chat=${message.key.remoteJid} | from=${sender} | ` +
                    `video=${video.seconds ?? '?'}s ${formatKb(Number(video.fileLength || 0))} ${video.width ?? '?'}x${video.height ?? '?'}`);

                const handler = command.kind === 'test' ? handleTestCommand : handleStickerCommand;
                queue.run(() => handler({ sock, config }, message, video))
                    .catch((error) => log('ERR', `failed processing ${message.key.id} at step "${error.step || '?'}": ` +
                        `${describeError(error)}\n${error.stack || ''}`));
            }
        });
    };

    await connect();
}

module.exports = { startBot, parseCommand, isFresh, createSeenSet, videoOf };

'use strict';

/**
 * Schema-less protobuf reader.
 *
 * WhatsApp messages are protobuf. Baileys decodes them with a generated schema,
 * which silently drops any field it does not know, such as the audio embedded
 * in a sound sticker (field 26 of `StickerMessage`). This module walks the raw
 * wire format instead, so those fields can be inspected and verified.
 */

/** Protobuf wire types. */
const WIRE = Object.freeze({ VARINT: 0, FIXED64: 1, BYTES: 2, FIXED32: 5 });

/**
 * Reads a base-128 varint.
 *
 * @param {Uint8Array} buffer
 * @param {number} position Offset of the first byte.
 * @returns {[bigint, number]} The value and the offset right after it.
 */
function readVarint(buffer, position) {
    let result = 0n;
    let shift = 0n;
    for (;;) {
        const byte = buffer[position++];
        if (byte === undefined) throw new Error('unexpected end of buffer');
        result |= BigInt(byte & 0x7f) << shift;
        if (!(byte & 0x80)) return [result, position];
        shift += 7n;
    }
}

/**
 * @typedef {object} RawField
 * @property {number} field Field number.
 * @property {'varint' | 'fixed64' | 'fixed32' | 'bytes'} type
 * @property {string} [value] Decimal value, only for varints.
 * @property {number} [length] Payload size, only for length-delimited fields.
 * @property {Buffer} [payload] Payload, only for length-delimited fields.
 */

/**
 * Splits a protobuf message into its top-level fields without a schema.
 * Throws if the buffer is not a valid protobuf message.
 *
 * @param {Buffer} buffer
 * @returns {RawField[]}
 */
function parseRawFields(buffer) {
    /** @type {RawField[]} */
    const fields = [];
    let position = 0;
    while (position < buffer.length) {
        let tag;
        [tag, position] = readVarint(buffer, position);
        const field = Number(tag >> 3n);
        const wire = Number(tag & 7n);
        if (field === 0) throw new Error('invalid field number 0');

        if (wire === WIRE.VARINT) {
            let value;
            [value, position] = readVarint(buffer, position);
            fields.push({ field, type: 'varint', value: value.toString() });
        } else if (wire === WIRE.FIXED64 || wire === WIRE.FIXED32) {
            const size = wire === WIRE.FIXED64 ? 8 : 4;
            if (position + size > buffer.length) throw new Error('unexpected end of buffer');
            fields.push({ field, type: wire === WIRE.FIXED64 ? 'fixed64' : 'fixed32' });
            position += size;
        } else if (wire === WIRE.BYTES) {
            let length;
            [length, position] = readVarint(buffer, position);
            const size = Number(length);
            if (position + size > buffer.length) throw new Error('unexpected end of buffer');
            fields.push({ field, type: 'bytes', length: size, payload: buffer.subarray(position, position + size) });
            position += size;
        } else {
            throw new Error(`unsupported wire type ${wire}`);
        }
    }
    return fields;
}

/**
 * Finds the first length-delimited field with the given number.
 *
 * @param {RawField[]} fields
 * @param {number} number
 * @returns {RawField | undefined}
 */
function findBytesField(fields, number) {
    return fields.find((f) => f.field === number && f.type === 'bytes');
}

/**
 * Finds the first varint field with the given number and returns it as a number.
 *
 * @param {RawField[]} fields
 * @param {number} number
 * @returns {number | null}
 */
function findVarint(fields, number) {
    const found = fields.find((f) => f.field === number && f.type === 'varint');
    return found ? Number(found.value) : null;
}

/**
 * Pretty-prints a raw message as an indented tree. Printable strings are shown,
 * except URLs and media paths; binary blobs (keys, hashes) are always hidden,
 * so the output is safe to share when reporting a problem.
 *
 * @param {Buffer} buffer
 * @param {string} [indent]
 * @returns {string}
 */
function describeRawFields(buffer, indent = '') {
    const lines = [];
    for (const f of parseRawFields(buffer)) {
        if (f.type !== 'bytes') {
            lines.push(`${indent}#${f.field} ${f.type}${f.value ? ` = ${f.value}` : ''}`);
            continue;
        }
        const payload = /** @type {Buffer} */ (f.payload);
        const text = payload.toString('utf8');
        if (/^[\x20-\x7e]+$/.test(text) && /** @type {number} */ (f.length) < 400) {
            const sensitive = /^https?:|^\/[ov]\//.test(text);
            lines.push(`${indent}#${f.field} text(${f.length}) = ${sensitive ? '<hidden url>' : JSON.stringify(text)}`);
            continue;
        }
        let nested = false;
        try {
            if (/** @type {number} */ (f.length) > 1) { parseRawFields(payload); nested = true; }
        } catch { /* not a nested message */ }
        if (nested) {
            lines.push(`${indent}#${f.field} message(${f.length}) {`, describeRawFields(payload, `${indent}  `), `${indent}}`);
        } else {
            lines.push(`${indent}#${f.field} bytes(${f.length}) <hidden>`);
        }
    }
    return lines.join('\n');
}

module.exports = { readVarint, parseRawFields, findBytesField, findVarint, describeRawFields };

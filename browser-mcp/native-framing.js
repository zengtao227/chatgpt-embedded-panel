import os from 'node:os';

export const MAX_NATIVE_MESSAGE_BYTES = 1024 * 1024;
const littleEndian = os.endianness() === 'LE';

function readLength(buffer) {
  return littleEndian ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0);
}

function writeLength(buffer, value) {
  if (littleEndian) buffer.writeUInt32LE(value, 0);
  else buffer.writeUInt32BE(value, 0);
}

export function encodeNativeMessage(payload, { maxBytes = MAX_NATIVE_MESSAGE_BYTES } = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.byteLength > maxBytes) throw new Error('Native message exceeds the configured limit.');
  const header = Buffer.allocUnsafe(4);
  writeLength(header, body.byteLength);
  return Buffer.concat([header, body]);
}

export function writeNativeMessage(stream, payload, options) {
  stream.write(encodeNativeMessage(payload, options));
}

export function createNativeMessageReader(stream, {
  maxBytes = MAX_NATIVE_MESSAGE_BYTES,
  onMessage,
  onError,
  onEnd,
} = {}) {
  if (typeof onMessage !== 'function') throw new TypeError('onMessage is required.');

  let buffer = Buffer.alloc(0);
  let stopped = false;

  const fail = (error) => {
    if (stopped) return;
    stopped = true;
    onError?.(error);
  };

  stream.on('data', (chunk) => {
    if (stopped) return;
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);

    while (buffer.byteLength >= 4) {
      const length = readLength(buffer.subarray(0, 4));
      if (length > maxBytes) {
        fail(new Error('Native message exceeds the configured limit.'));
        return;
      }
      if (buffer.byteLength < 4 + length) return;

      const body = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);

      try {
        onMessage(JSON.parse(body.toString('utf8')));
      } catch {
        fail(new Error('Native message contains invalid JSON.'));
        return;
      }
    }
  });

  stream.on('error', fail);
  stream.on('end', () => {
    if (stopped) return;
    stopped = true;
    if (buffer.byteLength !== 0) onError?.(new Error('Native message stream ended mid-frame.'));
    else onEnd?.();
  });

  return Object.freeze({
    stop() {
      stopped = true;
    },
  });
}

import net from 'node:net';
import path from 'node:path';
import { chmod, mkdir, rm } from 'node:fs/promises';

const VERSION = 1;
const MAX_LINE_BYTES = 1024 * 1024;

function encodeLine(value) {
  return JSON.stringify(value) + '\n';
}

function validRequest(value) {
  return Boolean(value)
    && value.version === VERSION
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.tool === 'string'
    && value.tool.length > 0
    && value.arguments
    && typeof value.arguments === 'object'
    && !Array.isArray(value.arguments);
}

export function createUnixSocketBrowserClient({
  socketPath,
  timeoutMs = 5000,
} = {}) {
  if (typeof socketPath !== 'string' || !socketPath) throw new TypeError('socketPath is required.');

  return Object.freeze({
    call(tool, args) {
      const id = crypto.randomUUID();

      return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath);
        let settled = false;
        let buffer = '';

        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          if (error) reject(error);
          else resolve(value);
        };

        const timer = setTimeout(
          () => finish(new Error('Browser bridge timed out.')),
          timeoutMs,
        );

        socket.setEncoding('utf8');
        socket.on('connect', () => {
          socket.write(encodeLine({ version: VERSION, id, tool, arguments: args }));
        });
        socket.on('data', (chunk) => {
          buffer += chunk;
          if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
            finish(new Error('Browser bridge response is too large.'));
            return;
          }
          const newline = buffer.indexOf('\n');
          if (newline < 0) return;

          let response;
          try {
            response = JSON.parse(buffer.slice(0, newline));
          } catch {
            finish(new Error('Browser bridge returned invalid JSON.'));
            return;
          }

          if (
            !response
            || response.version !== VERSION
            || response.id !== id
            || typeof response.ok !== 'boolean'
          ) {
            finish(new Error('Browser bridge returned an invalid response.'));
            return;
          }

          if (response.ok) resolveAndClose(response.result);
          else finish(Object.assign(new Error(response.error?.message || 'Browser bridge failed.'), {
            code: response.error?.code || 'BROWSER_BRIDGE_ERROR',
          }));
        });
        socket.on('error', (error) => finish(error));

        function resolveAndClose(result) {
          finish(null, result);
        }
      });
    },
  });
}

export async function listenUnixBrowserBridge({
  socketPath,
  dispatch,
} = {}) {
  if (typeof socketPath !== 'string' || !socketPath) throw new TypeError('socketPath is required.');
  if (typeof dispatch !== 'function') throw new TypeError('dispatch is required.');

  const directory = path.dirname(socketPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await rm(socketPath, { force: true });

  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > MAX_LINE_BYTES) {
        socket.end(encodeLine({
          version: VERSION,
          id: '',
          ok: false,
          error: { code: 'REQUEST_TOO_LARGE', message: 'Browser bridge request is too large.' },
        }));
        return;
      }

      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);

      let request;
      try {
        request = JSON.parse(line);
      } catch {
        socket.end(encodeLine({
          version: VERSION,
          id: '',
          ok: false,
          error: { code: 'INVALID_JSON', message: 'Browser bridge request is invalid JSON.' },
        }));
        return;
      }

      if (!validRequest(request)) {
        socket.end(encodeLine({
          version: VERSION,
          id: typeof request?.id === 'string' ? request.id : '',
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'Browser bridge request is invalid.' },
        }));
        return;
      }

      try {
        const result = await dispatch(request);
        socket.end(encodeLine({ version: VERSION, id: request.id, ok: true, result }));
      } catch (error) {
        socket.end(encodeLine({
          version: VERSION,
          id: request.id,
          ok: false,
          error: {
            code: typeof error?.code === 'string' ? error.code : 'BROWSER_BRIDGE_ERROR',
            message: typeof error?.message === 'string' ? error.message : 'Browser bridge failed.',
          },
        }));
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  await chmod(socketPath, 0o600);

  return Object.freeze({
    socketPath,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      await rm(socketPath, { force: true });
    },
  });
}

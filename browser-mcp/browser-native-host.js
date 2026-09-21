import { pathToFileURL } from 'node:url';
import { createNativeMessageReader, writeNativeMessage } from './native-framing.js';
import { browserMcpSocketPath } from './runtime-paths.js';
import { listenUnixBrowserBridge } from './unix-bridge.js';

const TOOL_TIMEOUT_MS = 15000;

export async function runNativeBrowserHost({
  input = process.stdin,
  output = process.stdout,
  socketPath = browserMcpSocketPath(),
  timeoutMs = TOOL_TIMEOUT_MS,
} = {}) {
  if (typeof socketPath !== 'string' || !socketPath) {
    throw new Error('Browser MCP socket path is required.');
  }

  const pending = new Map();
  let closing = false;

  const rejectAll = (error) => {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    pending.clear();
  };

  const reader = createNativeMessageReader(input, {
    onMessage(message) {
      if (
        !message
        || message.type !== 'browser-tool-result'
        || message.version !== 1
        || typeof message.id !== 'string'
      ) {
        return;
      }

      const wait = pending.get(message.id);
      if (!wait) return;
      pending.delete(message.id);
      clearTimeout(wait.timer);

      if (message.ok === true) wait.resolve(message.result);
      else {
        const error = new Error(message.error?.message || 'Browser extension returned an error.');
        error.code = message.error?.code || 'BROWSER_EXTENSION_ERROR';
        wait.reject(error);
      }
    },
    onError(error) {
      rejectAll(error);
    },
    onEnd() {
      if (!closing) rejectAll(new Error('Chrome Native Messaging port closed.'));
    },
  });

  const bridge = await listenUnixBrowserBridge({
    socketPath,
    dispatch(request) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(request.id);
          reject(new Error('Chrome extension timed out.'));
        }, timeoutMs);

        pending.set(request.id, { resolve, reject, timer });
        writeNativeMessage(output, {
          type: 'browser-tool-call',
          version: 1,
          id: request.id,
          tool: request.tool,
          arguments: request.arguments,
        });
      });
    },
  });

  return Object.freeze({
    socketPath,
    async close() {
      closing = true;
      reader.stop();
      rejectAll(new Error('Browser native host closed.'));
      await bridge.close();
    },
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = await runNativeBrowserHost();
  process.stdin.resume();
  process.stdin.once('end', async () => {
    await host.close().catch(() => {});
  });
}

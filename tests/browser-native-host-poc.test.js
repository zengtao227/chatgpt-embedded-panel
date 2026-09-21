import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { createUnixSocketBrowserClient } from '../browser-mcp/unix-bridge.js';
import {
  createNativeMessageReader,
  writeNativeMessage,
} from '../browser-mcp/native-framing.js';
import { runNativeBrowserHost } from '../browser-mcp/browser-native-host.js';

test('Unix bridge round-trips through Chrome Native Messaging framing', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-native-host-poc-'));
  const socketPath = path.join(root, 'private', 'browser.sock');
  const chromeToHost = new PassThrough();
  const hostToChrome = new PassThrough();

  const nativeHost = await runNativeBrowserHost({
    input: chromeToHost,
    output: hostToChrome,
    socketPath,
    timeoutMs: 1000,
  });
  t.after(() => nativeHost.close());

  assert.equal((await stat(socketPath)).mode & 0o777, 0o600);

  const nativeCalls = [];
  createNativeMessageReader(hostToChrome, {
    onMessage(message) {
      nativeCalls.push(message);
      assert.equal(message.type, 'browser-tool-call');
      assert.equal(message.tool, 'inspect_page');
      assert.deepEqual(message.arguments, {});

      writeNativeMessage(chromeToHost, {
        type: 'browser-tool-result',
        version: 1,
        id: message.id,
        ok: true,
        result: {
          title: 'Chrome fixture',
          text: 'Real extension shape',
          elements: [{ ref: 'e1', role: 'button', name: 'Continue', value: '' }],
        },
      });
    },
  });

  const client = createUnixSocketBrowserClient({ socketPath, timeoutMs: 1000 });
  const result = await client.call('inspect_page', {});

  assert.equal(nativeCalls.length, 1);
  assert.equal(result.title, 'Chrome fixture');
  assert.equal(result.elements[0].ref, 'e1');
});

test('Chrome-side error propagates over Native Messaging and Unix bridge', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-native-host-error-'));
  const socketPath = path.join(root, 'private', 'browser.sock');
  const chromeToHost = new PassThrough();
  const hostToChrome = new PassThrough();

  const nativeHost = await runNativeBrowserHost({
    input: chromeToHost,
    output: hostToChrome,
    socketPath,
    timeoutMs: 1000,
  });
  t.after(() => nativeHost.close());

  createNativeMessageReader(hostToChrome, {
    onMessage(message) {
      writeNativeMessage(chromeToHost, {
        type: 'browser-tool-result',
        version: 1,
        id: message.id,
        ok: false,
        error: {
          code: 'PAGE_UNAVAILABLE',
          message: 'No ordinary webpage is available.',
        },
      });
    },
  });

  const client = createUnixSocketBrowserClient({ socketPath, timeoutMs: 1000 });

  await assert.rejects(
    client.call('inspect_page', {}),
    (error) => error.code === 'PAGE_UNAVAILABLE' && /ordinary webpage/.test(error.message),
  );
});

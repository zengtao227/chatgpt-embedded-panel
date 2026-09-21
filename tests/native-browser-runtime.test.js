import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connectChromeNativeBridge } from '../chrome-native-bridge.js';
import { BROWSER_NATIVE_HOST_NAME } from '../browser-native-protocol.js';
import {
  FULL_BROWSER_MCP_TOOLS,
  createBrowserMcpServer,
} from '../browser-mcp/server.js';
import { nativeHostManifest } from '../scripts/native-host-installer.mjs';

function eventSlot() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(value) {
      for (const listener of listeners) listener(value);
    },
  };
}

function fakeRuntime() {
  const posted = [];
  const onMessage = eventSlot();
  const onDisconnect = eventSlot();
  let host = null;
  let disconnected = false;
  const port = {
    onMessage,
    onDisconnect,
    postMessage(message) {
      posted.push(message);
    },
    disconnect() {
      disconnected = true;
      onDisconnect.emit();
    },
  };

  return {
    runtime: {
      connectNative(name) {
        host = name;
        return port;
      },
    },
    port,
    posted,
    get host() {
      return host;
    },
    get disconnected() {
      return disconnected;
    },
  };
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('extension native bridge sends a real MCP browser request into existing runBrowserTool', async () => {
  const fake = fakeRuntime();
  const seen = [];
  const bridge = connectChromeNativeBridge({
    runtime: fake.runtime,
    async runBrowserTool(call) {
      seen.push(call);
      return {
        version: 1,
        id: call.id,
        ok: true,
        result: { title: 'Target page', text: 'Body', elements: [] },
      };
    },
  });

  assert.equal(fake.host, BROWSER_NATIVE_HOST_NAME);

  fake.port.onMessage.emit({
    type: 'browser-tool-call',
    version: 1,
    id: 'native-1',
    tool: 'inspect_page',
    arguments: {},
  });
  await settle();

  assert.deepEqual(seen, [{
    id: 'native-1',
    name: 'inspect_page',
    arguments: {},
  }]);
  assert.deepEqual(fake.posted, [{
    type: 'browser-tool-result',
    version: 1,
    id: 'native-1',
    ok: true,
    result: { title: 'Target page', text: 'Body', elements: [] },
  }]);

  bridge.close();
  assert.equal(fake.disconnected, true);
});

test('extension native bridge rejects invalid browser tool arguments before dispatch', async () => {
  const fake = fakeRuntime();
  let calls = 0;
  connectChromeNativeBridge({
    runtime: fake.runtime,
    async runBrowserTool() {
      calls += 1;
      throw new Error('should not run');
    },
  });

  fake.port.onMessage.emit({
    type: 'browser-tool-call',
    version: 1,
    id: 'native-2',
    tool: 'click',
    arguments: {},
  });
  await settle();

  assert.equal(calls, 0);
  assert.equal(fake.posted[0].ok, false);
  assert.equal(fake.posted[0].error.code, 'INVALID_ARGUMENTS');
});

test('production Browser MCP exposes exactly the six Browser WebMCP tools and forwards calls', async () => {
  assert.deepEqual(
    FULL_BROWSER_MCP_TOOLS.map(({ name }) => name),
    ['inspect_page', 'inspect_form', 'fill', 'select', 'click', 'scroll'],
  );

  const seen = [];
  const server = createBrowserMcpServer({
    tools: FULL_BROWSER_MCP_TOOLS,
    callTool: async (name, args) => {
      seen.push({ name, args });
      return { ref: args.ref ?? null, ok: true };
    },
  });

  const listed = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.deepEqual(
    listed.result.tools.map(({ name }) => name),
    ['inspect_page', 'inspect_form', 'fill', 'select', 'click', 'scroll'],
  );

  const called = await server.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'fill', arguments: { ref: 'e1', value: 'hello' } },
  });

  assert.deepEqual(seen, [{ name: 'fill', args: { ref: 'e1', value: 'hello' } }]);
  assert.equal(called.result.isError, undefined);
  assert.equal(called.result.structuredContent.ok, true);

  const scrollTool = listed.result.tools.find(({ name }) => name === 'scroll');
  assert.deepEqual(scrollTool.inputSchema.required, ['deltaY']);
  assert.equal(scrollTool.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(scrollTool.inputSchema.properties).sort(), ['deltaX', 'deltaY', 'ref']);
  assert.equal(scrollTool.inputSchema.properties.deltaY.maximum, 3000);
  assert.equal(scrollTool.inputSchema.properties.deltaY.minimum, -3000);
  assert.match(scrollTool.description, /lazy loading/);
  assert.doesNotMatch(scrollTool.description, /does not modify page content/);
});

test('production Browser MCP hides local transport details when the Chrome bridge is unavailable', async () => {
  const server = createBrowserMcpServer({
    tools: FULL_BROWSER_MCP_TOOLS,
    callTool: async () => {
      const error = new Error('/Users/example/.chatgpt-embedded-panel/browser-mcp.sock does not exist');
      error.code = 'ENOENT';
      throw error;
    },
  });

  const response = await server.handle({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'inspect_page', arguments: {} },
  });

  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error, 'BROWSER_BRIDGE_UNAVAILABLE');
  assert.equal(response.result.structuredContent.message, 'Browser extension bridge is unavailable.');
  assert.doesNotMatch(response.result.content[0].text, /Users\/example|browser-mcp\.sock/);
});

test('native host manifest exact-binds the Browser MCP host to one Chrome extension origin', () => {
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const manifest = nativeHostManifest({
    extensionId,
    launcherPath: '/tmp/browser-native-host',
  });

  assert.equal(manifest.name, BROWSER_NATIVE_HOST_NAME);
  assert.equal(manifest.type, 'stdio');
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${extensionId}/`]);
});

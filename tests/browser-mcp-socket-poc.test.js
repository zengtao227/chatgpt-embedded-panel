import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createBrowserMcpServer } from '../browser-mcp/server.js';
import {
  createUnixSocketBrowserClient,
  listenUnixBrowserBridge,
} from '../browser-mcp/unix-bridge.js';

test('native MCP inspect_page can round-trip through the Unix browser bridge', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-mcp-poc-'));
  const socketPath = path.join(root, 'private', 'browser.sock');
  const seen = [];

  const bridge = await listenUnixBrowserBridge({
    socketPath,
    dispatch: async (request) => {
      seen.push(request);
      assert.equal(request.tool, 'inspect_page');
      assert.deepEqual(request.arguments, {});
      return {
        title: 'Live browser fixture',
        text: 'Rendered page body',
        elements: [{ ref: 'e1', role: 'button', name: 'Continue', value: '' }],
      };
    },
  });
  t.after(() => bridge.close());

  const socketMode = (await stat(socketPath)).mode & 0o777;
  assert.equal(socketMode, 0o600);

  const client = createUnixSocketBrowserClient({ socketPath });
  const server = createBrowserMcpServer({
    inspectPage: () => client.call('inspect_page', {}),
  });

  const response = await server.handle({
    jsonrpc: '2.0',
    id: 7,
    method: 'tools/call',
    params: { name: 'inspect_page', arguments: {} },
  });

  assert.equal(seen.length, 1);
  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.structuredContent.title, 'Live browser fixture');
  assert.equal(response.result.structuredContent.elements[0].ref, 'e1');
});

test('bridge failure becomes MCP isError instead of synthetic conversation text', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-mcp-poc-missing-'));
  const client = createUnixSocketBrowserClient({
    socketPath: path.join(root, 'missing.sock'),
    timeoutMs: 100,
  });
  const server = createBrowserMcpServer({
    inspectPage: () => client.call('inspect_page', {}),
  });

  const response = await server.handle({
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: { name: 'inspect_page', arguments: {} },
  });

  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error, 'BROWSER_BRIDGE_UNAVAILABLE');
  assert.doesNotMatch(
    response.result.content[0].text,
    /Browser WebMCP tool result\.|<webmcp_tool_call>/,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { browserMcpSocketPath } from '../browser-mcp/runtime-paths.js';

// The launcher installed by activate-browser-tunnel exports this variable, which is how the
// MCP server keeps the Chrome native host's socket while tunnel-client isolates HOME.
test('an explicit socket override wins over home resolution', () => {
  assert.equal(
    browserMcpSocketPath({
      home: '/tmp/browser-tunnel-home-fixture',
      env: { CHATGPT_PANEL_BROWSER_SOCKET: '/Users/example/.chatgpt-embedded-panel/browser-mcp.sock' },
    }),
    '/Users/example/.chatgpt-embedded-panel/browser-mcp.sock',
  );
});

test('without an override the socket follows the given home', () => {
  assert.equal(
    browserMcpSocketPath({ home: '/tmp/test-owner', env: {} }),
    '/tmp/test-owner/.chatgpt-embedded-panel/browser-mcp.sock',
  );
});

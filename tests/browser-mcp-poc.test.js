import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { BROWSER_MCP_TOOLS, createBrowserMcpServer } from '../browser-mcp/server.js';

test('Browser MCP POC exposes exactly inspect_page', async () => {
  assert.deepEqual(BROWSER_MCP_TOOLS.map(({ name }) => name), ['inspect_page']);

  const server = createBrowserMcpServer();
  const listed = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

  assert.equal(listed.result.tools.length, 1);
  assert.equal(listed.result.tools[0].name, 'inspect_page');
  assert.deepEqual(listed.result.tools[0].inputSchema.properties, {});
});

test('inspect_page returns a native MCP tool result, not conversation text', async () => {
  const server = createBrowserMcpServer({
    inspectPage: async () => ({
      title: 'Fixture page',
      text: 'Fixture body',
      elements: [{ ref: 'e1', role: 'button', name: 'Continue', value: '' }],
    }),
  });

  const response = await server.handle({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'inspect_page', arguments: {} },
  });

  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.id, 2);
  assert.equal(response.result.isError, undefined);
  assert.equal(response.result.content[0].type, 'text');
  assert.equal(response.result.structuredContent.title, 'Fixture page');
  assert.equal(response.result.structuredContent.elements[0].ref, 'e1');
});

test('stdio process speaks newline-delimited MCP JSON-RPC', async () => {
  const child = spawn(process.execPath, ['browser-mcp/server.js'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const responses = [];
  let stdout = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    let newline;
    while ((newline = stdout.indexOf('\n')) >= 0) {
      const line = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (line.trim()) responses.push(JSON.parse(line));
    }
  });

  const send = (payload) => child.stdin.write(JSON.stringify(payload) + '\n');

  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'inspect_page', arguments: {} },
  });
  child.stdin.end();

  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('POC exited ' + code)));
  });

  assert.deepEqual(responses.map(({ id }) => id), [1, 2, 3]);
  assert.equal(responses[0].result.serverInfo.name, 'chatgpt-embedded-panel-browser');
  assert.equal(responses[1].result.tools[0].name, 'inspect_page');
  assert.equal(responses[2].result.structuredContent.title, 'Browser MCP POC');
  assert.doesNotMatch(
    responses[2].result.content[0].text,
    /Browser WebMCP tool result\.|<webmcp_tool_call>/,
  );
});

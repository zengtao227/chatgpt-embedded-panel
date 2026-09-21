import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const embedded = await readFile(new URL('../embedded-chatgpt.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('embedded ChatGPT adapter no longer rewrites or hides conversation DOM', () => {
  assert.doesNotMatch(embedded, /MutationObserver/);
  assert.doesNotMatch(embedded, /webmcp_tool_call/);
  assert.doesNotMatch(embedded, /data-webmcp-(?:pending|intermediate|hidden|fold)/);
  assert.doesNotMatch(embedded, /preventDefault|stopImmediatePropagation|execCommand/);
  assert.doesNotMatch(embedded, /document\.createElement\(['"]style['"]\)/);
  assert.match(embedded, /chatgpt-embedded-panel:ready/);
  assert.match(embedded, /chatgpt-embedded-panel:pong/);
  assert.match(embedded, /chatgptEmbeddedPanel\.lastUrl/);
});

test('service worker uses native Browser MCP bridge and no synthetic ChatGPT text controller', () => {
  assert.match(worker, /connectChromeNativeBridge/);
  assert.match(worker, /connectChromeNativeBridge\(\{ runBrowserTool \}\)/);
  assert.doesNotMatch(worker, /WorkController|buildWorkInstructions|buildBrowserToolResult/);
  assert.doesNotMatch(worker, /webmcp\.chatgpt\.(?:arrive|generating|completion|continuation-result)/);
  assert.equal(manifest.permissions.includes('nativeMessaging'), true);
});

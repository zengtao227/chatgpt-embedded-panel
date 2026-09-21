import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../sidepanel.html', import.meta.url), 'utf8');
const panel = await readFile(new URL('../sidepanel.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('normal toolbar contains only status and Stop control', () => {
  assert.match(html, /id="attached"/);
  assert.match(html, /id="stop"/);
  assert.doesNotMatch(html, /id="inspect"/);
  assert.doesNotMatch(html, /id="reload"/);
  assert.doesNotMatch(html, /id="open-window"/);
});

test('recovery UI retains Retry and companion-window fallback', () => {
  assert.match(html, /id="retry"/);
  assert.match(html, /id="fallback"/);
  assert.match(html, /Open ChatGPT window/);
  assert.match(panel, /loadFrame\(\{ cacheBust: true \}\)/);
  assert.match(panel, /chatgpt-panel\.open-companion/);
});

test('production Inspect integration gate is removed', () => {
  assert.doesNotMatch(panel, /inspectCurrentPage/);
  assert.doesNotMatch(worker, /webmcp\.inspect-page/);
  assert.doesNotMatch(worker, /inspectCurrentTaskPage/);
});

test('normal connected state hides secondary status text', () => {
  assert.match(html, /id="status" hidden/);
  assert.match(panel, /setStatus\(''\)/);
  assert.doesNotMatch(panel, /Connected —/);
  assert.doesNotMatch(panel, /Page API ready/);
});

test('closing the Side Panel ends the current Browser WebMCP session', () => {
  assert.match(panel, /addEventListener\('pagehide'/);
  assert.match(panel, /chatgpt-panel\.closed/);
  assert.match(worker, /async function cleanupPanelSession\(\)/);
  assert.match(worker, /await releaseTask\(\)/);
  assert.match(worker, /await disableFramePolicy\(\)/);
  assert.match(worker, /chrome\.sidePanel\?\.onClosed\?\.addListener/);
});

test('Stop remains a user-controlled task lock release', () => {
  assert.match(panel, /webmcp\.task-stop/);
  assert.match(panel, /task\.mode === 'locked'/);
  assert.match(panel, /task\.mode === 'blocked'/);
});

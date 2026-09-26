import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');

test('browser click creates a causal handoff lease before executing the click', () => {
  assert.match(source, /if \(call\.name === 'click'\) await beginClickHandoff\(selected\.target\)/);
  assert.match(source, /createHandoff\(task\.target\)/);
});

test('new tab and popup handoff requires Chrome openerTabId to match the leased source tab', () => {
  assert.match(source, /tab\.openerTabId === task\.handoff\.sourceTabId/);
  assert.match(source, /chrome\.tabs\.onCreated\.addListener/);
  assert.match(source, /considerChildHandoff\(tab\)/);
});

test('same-tab cross-origin navigation is accepted only while a causal click handoff is active', () => {
  assert.match(source, /next\.origin !== task\.target\.origin/);
  assert.match(source, /task\.handoff\.sourceTabId === tabId/);
  assert.match(source, /claimHandoff\(task\.handoff, tabId, changeInfo\.url\)/);
});

test('child close restores a surviving parent task page', () => {
  assert.match(source, /restoreParentAfterClose\(task\)/);
  assert.match(source, /const parents = \[\.\.\.\(task\.parents \?\? \[\]\)\]/);
  assert.match(source, /chrome\.tabs\.get\(parent\.tabId\)/);
});

test('a claimed child that closes before adoption cancels the handoff instead of wedging the task', () => {
  assert.match(source, /task\.handoff\?\.destinationTabId === tabId/);
  assert.match(source, /lockedTask\(task\.target, \{ parents: task\.parents \}\)/);
});

test('manual cross-origin navigation outside a handoff still blocks instead of silently retargeting', () => {
  assert.match(source, /blockedTask\(task\.target, 'ORIGIN_CHANGED'/);
});

test('frame-aware Browser WebMCP injects every accessible frame without adding webNavigation permission', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.match(source, /target: \{ tabId, allFrames: true \}/);
  assert.match(source, /callBrowserTool\(selected\.target\.tabId, call, \{ frameIds \}\)/);
  assert.equal(manifest.permissions.includes('webNavigation'), false);
  assert.equal(manifest.permissions.includes('tabs'), false);
});

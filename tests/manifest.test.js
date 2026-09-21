import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('ChatGPT Embedded Panel gives Browser WebMCP all ordinary web pages by explicit product decision', () => {
  assert.deepEqual(manifest.host_permissions, ['http://*/*', 'https://*/*']);
  assert.deepEqual(manifest.permissions, [
    'scripting',
    'nativeMessaging',
    'sidePanel',
    'storage',
    'declarativeNetRequestWithHostAccess',
  ]);
  const serialized = JSON.stringify(manifest);
  for (const forbidden of ['activeTab', '<all_urls>', 'cookies', 'webRequest', 'debugger', 'tabs']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('ChatGPT content scripts are exactly the isolated relay and the MAIN-world model probe, both frame-scoped', () => {
  assert.deepEqual(
    manifest.content_scripts.map(({ matches, js, all_frames, run_at, world }) => ({ matches, js, all_frames, run_at, world })),
    [
      { matches: ['https://chatgpt.com/*'], js: ['embedded-chatgpt.js'], all_frames: true, run_at: 'document_start', world: 'ISOLATED' },
      { matches: ['https://chatgpt.com/*'], js: ['model-probe.js'], all_frames: true, run_at: 'document_start', world: 'MAIN' },
    ],
  );
});

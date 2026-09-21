import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PANEL_EXTENSION_ID, extensionIdFromManifestKey } from '../scripts/extension-id.mjs';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('the pinned extension id is the one Chrome derives from the manifest key', () => {
  assert.equal(typeof manifest.key, 'string');
  assert.equal(extensionIdFromManifestKey(manifest.key), PANEL_EXTENSION_ID);
  assert.match(PANEL_EXTENSION_ID, /^[a-p]{32}$/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFramePolicyRule } from '../frame-policy.js';

test('frame policy is limited to extension-initiated ChatGPT subframes', () => {
  const rule = buildFramePolicyRule('abcdefghijklmnop');
  assert.deepEqual(rule.condition.requestDomains, ['chatgpt.com']);
  assert.deepEqual(rule.condition.initiatorDomains, ['abcdefghijklmnop']);
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  assert.deepEqual(rule.action.responseHeaders, [
    { header: 'x-frame-options', operation: 'remove' },
    { header: 'content-security-policy', operation: 'remove' },
  ]);
});

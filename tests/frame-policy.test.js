import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENAI_SANDBOX_CSP,
  buildFramePolicyRule,
  buildSandboxFramePolicyRule,
} from '../frame-policy.js';

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

test('visualization policy matches the live OpenAI sandbox CSP and only adds this extension as an ancestor', async () => {
  const { readFile } = await import('node:fs/promises');
  // Captured from https://codex-inline-visualization-*.web-sandbox.oaiusercontent.com/ on 2026-09-26.
  // A hand-written shorter policy never matched the live header, so the rule never fired.
  const live = await readFile(new URL('./fixtures/openai-sandbox-csp-2026-09-26.txt', import.meta.url), 'utf8');
  assert.equal(OPENAI_SANDBOX_CSP, live);

  const runtimeId = 'abcdefghijklmnop';
  const rule = buildSandboxFramePolicyRule(runtimeId);
  assert.equal(rule.id, 42002);
  assert.equal(rule.action.type, 'modifyHeaders');
  assert.deepEqual(rule.condition.requestDomains, ['web-sandbox.oaiusercontent.com']);
  assert.deepEqual(rule.condition.initiatorDomains, ['chatgpt.com', 'web-sandbox.oaiusercontent.com']);
  assert.deepEqual(rule.condition.resourceTypes, ['sub_frame']);
  assert.equal(rule.condition.regexFilter, '^https://codex-inline-visualization-[a-f0-9]+\\.web-sandbox\\.oaiusercontent\\.com/');
  assert.deepEqual(rule.condition.responseHeaders, [{ header: 'content-security-policy', values: [live] }]);

  const rewritten = rule.action.responseHeaders[0];
  assert.equal(rewritten.header, 'content-security-policy');
  assert.equal(rewritten.operation, 'set');
  const directives = (csp) => csp.split('; ');
  const before = directives(live);
  const after = directives(rewritten.value);
  assert.equal(after.length, before.length);
  before.forEach((directive, index) => {
    if (directive.startsWith('frame-ancestors ')) {
      assert.equal(after[index], `${directive} chrome-extension://${runtimeId}`);
    } else {
      assert.equal(after[index], directive, 'every other directive stays exactly as OpenAI sent it');
    }
  });
  assert.ok(after.includes("frame-src 'self' https: data: blob:"), 'the nested preview frame stays allowed');
  assert.ok(after.some((directive) => directive.startsWith('sandbox ') && directive.includes('allow-forms')));
});

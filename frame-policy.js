export const FRAME_POLICY_RULE_ID = 42001;

export function buildFramePolicyRule(runtimeId) {
  if (typeof runtimeId !== 'string' || !runtimeId) {
    throw new TypeError('Extension runtime id is required.');
  }

  return {
    id: FRAME_POLICY_RULE_ID,
    priority: 100,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' },
      ],
    },
    condition: {
      requestDomains: ['chatgpt.com'],
      initiatorDomains: [runtimeId],
      resourceTypes: ['sub_frame'],
    },
  };
}

export async function enableFramePolicy() {
  const rule = buildFramePolicyRule(chrome.runtime.id);
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [FRAME_POLICY_RULE_ID],
    addRules: [rule],
  });
  return { enabled: true, rule };
}

export async function disableFramePolicy() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [FRAME_POLICY_RULE_ID],
  });
  return { enabled: false, rule: null };
}

export async function framePolicyStatus() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  const rule = rules.find((candidate) => candidate.id === FRAME_POLICY_RULE_ID) ?? null;
  return { enabled: Boolean(rule), rule };
}

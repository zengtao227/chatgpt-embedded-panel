import { callBrowserTool } from './browser-client.js';
import { connectChromeNativeBridge } from './chrome-native-bridge.js';
import { disableFramePolicy, enableFramePolicy } from './frame-policy.js';
import {
  TASK_KEY,
  attachablePageUrl,
  blockedTask,
  buildAttachedPage,
  claimHandoff,
  createHandoff,
  idleTask,
  lockedTask,
  normalizeTask,
} from './target-binding.js';

const LAST_URL_KEY = 'chatgptEmbeddedPanel.lastUrl';
const COMPANION_WINDOW_KEY = 'chatgptEmbeddedPanel.companionWindowId';
const PANEL_URL = chrome.runtime.getURL('sidepanel.html');
const CHATGPT_HOME = 'https://chatgpt.com/';
const HANDOFF_LEASE_MS = 1500;
const HANDOFF_DETECT_MS = 600;
const HANDOFF_SETTLE_MS = 5000;
let browserNativeBridge = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function handoffFresh(handoff) {
  return Boolean(
    handoff
    && Number.isFinite(handoff.issuedAt)
    && Date.now() - handoff.issuedAt <= HANDOFF_LEASE_MS,
  );
}

function handoffClaimed(handoff) {
  return Number.isInteger(handoff?.destinationTabId);
}

function sanitizeChatGptUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://chatgpt.com' || url.username || url.password) return CHATGPT_HOME;
    if (/^\/(api|backend-api|cdn)(\/|$)/.test(url.pathname)) return CHATGPT_HOME;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return CHATGPT_HOME;
  }
}

async function readTask() {
  const stored = await chrome.storage.session.get(TASK_KEY);
  return normalizeTask(stored[TASK_KEY]);
}

async function writeTask(task) {
  await chrome.storage.session.set({ [TASK_KEY]: task });
  return task;
}

async function releaseTask() {
  return writeTask(idleTask());
}

async function startPanelSession() {
  await enableFramePolicy();
  if (!browserNativeBridge?.connected) {
    browserNativeBridge = connectChromeNativeBridge({ runBrowserTool });
  }
  return { started: true, browserBridge: browserNativeBridge.connected };
}

async function cleanupPanelSession() {
  browserNativeBridge?.close();
  browserNativeBridge = null;
  await releaseTask();
  await disableFramePolicy();
  return { stopped: true };
}

async function beginClickHandoff(target) {
  const task = await readTask();
  if (task.mode !== 'locked' || task.target.tabId !== target.tabId) return task;
  return writeTask(lockedTask(task.target, {
    parents: task.parents,
    handoff: createHandoff(task.target),
  }));
}

async function clearUnclaimedHandoff(tabId) {
  const task = await readTask();
  if (
    task.mode === 'locked'
    && task.target.tabId === tabId
    && task.handoff
    && !handoffClaimed(task.handoff)
  ) {
    return writeTask(lockedTask(task.target, { parents: task.parents }));
  }
  return task;
}

async function waitForHandoffSettlement(task) {
  if (task.mode !== 'locked' || !handoffClaimed(task.handoff)) return task;

  const deadline = Date.now() + HANDOFF_SETTLE_MS;
  let current = task;
  while (Date.now() < deadline) {
    await sleep(100);
    current = await readTask();
    if (current.mode !== 'locked' || !current.handoff) return current;
  }
  return current;
}

async function waitForPossibleHandoff(task) {
  if (
    task.mode !== 'locked'
    || !task.handoff
    || handoffClaimed(task.handoff)
    || !handoffFresh(task.handoff)
  ) {
    return task;
  }

  const leaseDeadline = task.handoff.issuedAt + HANDOFF_LEASE_MS;
  const deadline = Math.min(leaseDeadline, Date.now() + HANDOFF_DETECT_MS);
  let current = task;
  while (Date.now() < deadline) {
    await sleep(50);
    current = await readTask();
    if (current.mode !== 'locked' || !current.handoff || handoffClaimed(current.handoff)) {
      return current;
    }
  }

  current = await readTask();
  if (
    current.mode === 'locked'
    && current.handoff
    && !handoffClaimed(current.handoff)
  ) {
    return writeTask(lockedTask(current.target, { parents: current.parents }));
  }
  return current;
}

async function activePage() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return { tab: tab ?? null, target: buildAttachedPage(tab) };
}

async function ensureTargetExecutor(tabId) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['target-executor.js'],
  });
  const frameIds = [...new Set((injected ?? [])
    .map((entry) => entry?.frameId)
    .filter((frameId) => Number.isInteger(frameId) && frameId >= 0))];
  const ping = await chrome.tabs.sendMessage(tabId, { type: 'webmcp.browser.ping' }, { frameId: 0 });
  if (ping?.ok !== true || ping?.result?.ready !== true) throw new Error('Attached page executor did not answer.');
  if (!frameIds.includes(0)) frameIds.unshift(0);
  return frameIds;
}

async function targetStatus() {
  const [task, current] = await Promise.all([readTask(), activePage()]);
  return {
    ok: true,
    task,
    candidate: task.mode === 'idle' ? current.target : null,
    currentTabId: Number.isInteger(current.tab?.id) ? current.tab.id : null,
  };
}

async function blockCurrentTask(reason) {
  const task = await readTask();
  if (task.mode !== 'locked') return task;
  return writeTask(blockedTask(task.target, reason, { parents: task.parents }));
}

async function targetForBrowserTool() {
  let task = await readTask();
  if (task.mode === 'blocked') {
    return {
      ok: false,
      error: {
        code: 'TASK_BLOCKED',
        message: 'The page locked to this task is no longer available. Stop the task, then try again.',
      },
    };
  }

  if (task.mode === 'locked') {
    if (task.handoff && !handoffClaimed(task.handoff) && handoffFresh(task.handoff)) {
      task = await waitForPossibleHandoff(task);
    }

    if (handoffClaimed(task.handoff)) {
      task = await waitForHandoffSettlement(task);
      if (task.mode === 'blocked') {
        return {
          ok: false,
          error: {
            code: 'TASK_BLOCKED',
            message: 'Browser WebMCP could not complete the page handoff.',
          },
        };
      }
      if (task.mode === 'locked' && handoffClaimed(task.handoff)) {
        return {
          ok: false,
          error: {
            code: 'TASK_NAVIGATING',
            message: 'The page opened by the previous Browser WebMCP action is still loading.',
          },
        };
      }
    } else if (task.handoff && !handoffFresh(task.handoff)) {
      task = await writeTask(lockedTask(task.target, { parents: task.parents }));
    }
    if (task.mode === 'locked') return { ok: true, target: task.target };
  }

  const { target } = await activePage();
  if (!target) {
    return {
      ok: false,
      error: {
        code: 'PAGE_UNAVAILABLE',
        message: 'The current page cannot be used by Browser WebMCP.',
      },
    };
  }

  try {
    await ensureTargetExecutor(target.tabId);
  } catch {
    return {
      ok: false,
      error: {
        code: 'PAGE_UNAVAILABLE',
        message: 'The current page cannot be used by Browser WebMCP.',
      },
    };
  }

  await writeTask(lockedTask(target));
  return { ok: true, target };
}

async function runBrowserTool(call) {
  const selected = await targetForBrowserTool();
  if (!selected.ok) {
    return { version: 1, id: call.id, ok: false, error: selected.error };
  }

  if (call.name === 'click') await beginClickHandoff(selected.target);
  else await clearUnclaimedHandoff(selected.target.tabId);

  try {
    const frameIds = await ensureTargetExecutor(selected.target.tabId);
    const response = await callBrowserTool(selected.target.tabId, call, { frameIds });
    if (call.name === 'click' && response.ok !== true) {
      await clearUnclaimedHandoff(selected.target.tabId);
    }
    return response;
  } catch {
    if (call.name === 'click') {
      await sleep(100);
      const task = await readTask();
      const navigationObserved = (
        task.mode === 'locked'
        && (
          task.target.tabId !== selected.target.tabId
          || handoffClaimed(task.handoff)
        )
      );
      if (navigationObserved) {
        return {
          version: 1,
          id: call.id,
          ok: true,
          result: { ref: call.arguments.ref, navigation: true },
        };
      }
    }

    await blockCurrentTask('PAGE_UNAVAILABLE');
    return {
      version: 1,
      id: call.id,
      ok: false,
      error: {
        code: 'TASK_BLOCKED',
        message: 'The page locked to this task became unavailable.',
      },
    };
  }
}

async function adoptTab(task, tab, { pushCurrent = false } = {}) {
  const target = buildAttachedPage(tab);
  if (!target) return null;

  try {
    await ensureTargetExecutor(target.tabId);
  } catch {
    return null;
  }

  const parents = pushCurrent
    ? [...(task.parents ?? []), task.target].slice(-12)
    : (task.parents ?? []);
  return writeTask(lockedTask(target, { parents }));
}

async function considerChildHandoff(tab) {
  if (!Number.isInteger(tab?.id)) return false;

  let task = await readTask();
  if (task.mode !== 'locked' || !task.handoff) return false;

  const alreadyClaimed = task.handoff.destinationTabId === tab.id;
  const causallyOpened = (
    !handoffClaimed(task.handoff)
    && handoffFresh(task.handoff)
    && tab.openerTabId === task.handoff.sourceTabId
  );
  if (!alreadyClaimed && !causallyOpened) return false;

  if (!alreadyClaimed) {
    const claimed = claimHandoff(task.handoff, tab.id, tab.url ?? null);
    task = await writeTask(lockedTask(task.target, {
      parents: task.parents,
      handoff: claimed,
    }));
  }

  if (tab.status !== 'complete') return true;

  const adopted = await adoptTab(task, tab, { pushCurrent: true });
  if (adopted) return true;

  const rawUrl = typeof tab.url === 'string' ? tab.url : '';
  if (rawUrl && rawUrl !== 'about:blank') {
    await writeTask(blockedTask(task.target, 'HANDOFF_UNSUPPORTED', { parents: task.parents }));
  }
  return true;
}

async function handleTargetTabUpdate(tabId, changeInfo, tab) {
  let task = await readTask();
  if (task.mode !== 'locked' || task.target.tabId !== tabId) return;

  if (typeof changeInfo.url === 'string') {
    const next = attachablePageUrl(changeInfo.url);
    if (!next) {
      const causal = (
        task.handoff
        && task.handoff.sourceTabId === tabId
        && (handoffFresh(task.handoff) || task.handoff.destinationTabId === tabId)
      );
      await writeTask(blockedTask(
        task.target,
        causal ? 'HANDOFF_UNSUPPORTED' : 'ORIGIN_CHANGED',
        { parents: task.parents },
      ));
      return;
    }

    if (next.origin !== task.target.origin) {
      const canHandoff = (
        task.handoff
        && task.handoff.sourceTabId === tabId
        && (
          task.handoff.destinationTabId === tabId
          || (!handoffClaimed(task.handoff) && handoffFresh(task.handoff))
        )
      );
      if (!canHandoff) {
        await writeTask(blockedTask(task.target, 'ORIGIN_CHANGED', { parents: task.parents }));
        return;
      }

      if (task.handoff.destinationTabId !== tabId) {
        task = await writeTask(lockedTask(task.target, {
          parents: task.parents,
          handoff: claimHandoff(task.handoff, tabId, changeInfo.url),
        }));
      }
    }
  }

  if (changeInfo.status !== 'complete') return;

  task = await readTask();
  if (task.mode !== 'locked' || task.target.tabId !== tabId) return;

  if (task.handoff?.destinationTabId === tabId) {
    const adopted = await adoptTab(task, tab);
    if (!adopted) {
      await writeTask(blockedTask(task.target, 'HANDOFF_UNSUPPORTED', { parents: task.parents }));
    }
    return;
  }

  try {
    await ensureTargetExecutor(tabId);
    const refreshed = buildAttachedPage(tab);
    if (refreshed) {
      await writeTask(lockedTask(refreshed, { parents: task.parents }));
    }
  } catch {
    await writeTask(blockedTask(task.target, 'PAGE_UNAVAILABLE', { parents: task.parents }));
  }
}

async function restoreParentAfterClose(task) {
  const parents = [...(task.parents ?? [])];
  while (parents.length > 0) {
    const parent = parents.pop();
    try {
      const tab = await chrome.tabs.get(parent.tabId);
      const restored = buildAttachedPage(tab);
      if (!restored) continue;
      await ensureTargetExecutor(restored.tabId);
      return writeTask(lockedTask(restored, { parents }));
    } catch {
      // Try the next surviving ancestor.
    }
  }
  return writeTask(blockedTask(task.target, 'TAB_CLOSED', { parents: [] }));
}


async function openCompanionWindow() {
  const stored = await chrome.storage.local.get([LAST_URL_KEY, COMPANION_WINDOW_KEY]);
  const existingId = stored[COMPANION_WINDOW_KEY];

  if (Number.isInteger(existingId)) {
    try {
      await chrome.windows.update(existingId, { focused: true });
      return { windowId: existingId, reused: true };
    } catch {
      await chrome.storage.local.remove(COMPANION_WINDOW_KEY);
    }
  }

  const created = await chrome.windows.create({
    url: sanitizeChatGptUrl(stored[LAST_URL_KEY]),
    type: 'popup',
    width: 520,
    height: 760,
    focused: true,
  });
  if (!Number.isInteger(created?.id)) throw new Error('ChatGPT companion window could not be created.');
  await chrome.storage.local.set({ [COMPANION_WINDOW_KEY]: created.id });
  return { windowId: created.id, reused: false };
}

function isPanel(sender) {
  return sender.url === PANEL_URL;
}

function handleMessage(message, sender) {
  if (!message || typeof message !== 'object') return undefined;
  if (!isPanel(sender)) return undefined;
  if (message.type === 'chatgpt-panel.enable-policy') return startPanelSession();
  if (message.type === 'chatgpt-panel.disable-policy') return disableFramePolicy();
  if (message.type === 'chatgpt-panel.open-companion') return openCompanionWindow();
  if (message.type === 'chatgpt-panel.closed') return cleanupPanelSession();
  if (message.type === 'webmcp.target-status') return targetStatus();
  if (message.type === 'webmcp.task-stop') return releaseTask().then((task) => ({ ok: true, task }));
  return undefined;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const reply = handleMessage(message, sender);
  if (reply === undefined) return false;
  Promise.resolve(reply).then(
    (result) => sendResponse({ ok: true, result }),
    (error) => sendResponse({ ok: false, error: String(error?.message ?? error) }),
  );
  return true;
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

if (chrome.sidePanel?.onClosed?.addListener) {
  chrome.sidePanel.onClosed.addListener(() => {
    void cleanupPanelSession();
  });
}

chrome.windows.onRemoved.addListener((windowId) => {
  void chrome.storage.local.get(COMPANION_WINDOW_KEY).then((stored) => {
    if (stored[COMPANION_WINDOW_KEY] === windowId) return chrome.storage.local.remove(COMPANION_WINDOW_KEY);
    return undefined;
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  void considerChildHandoff(tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void readTask().then(async (task) => {
    if (!['locked', 'blocked'].includes(task.mode)) return;

    if (task.target.tabId === tabId) {
      if ((task.parents ?? []).length > 0) {
        await restoreParentAfterClose(task);
      } else {
        await writeTask(blockedTask(task.target, 'TAB_CLOSED', { parents: [] }));
      }
      return;
    }

    if (task.mode === 'locked' && task.handoff?.destinationTabId === tabId) {
      await writeTask(lockedTask(task.target, { parents: task.parents }));
      return;
    }

    if ((task.parents ?? []).some((parent) => parent.tabId === tabId)) {
      const parents = task.parents.filter((parent) => parent.tabId !== tabId);
      if (task.mode === 'locked') {
        await writeTask(lockedTask(task.target, { parents, handoff: task.handoff }));
      } else {
        await writeTask(blockedTask(task.target, task.reason, { parents }));
      }
    }
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  void (async () => {
    const childHandled = await considerChildHandoff(tab);
    const task = await readTask();
    if (childHandled && task.mode === 'locked' && task.target.tabId !== tabId) return;
    await handleTargetTabUpdate(tabId, changeInfo, tab);
  })();
});

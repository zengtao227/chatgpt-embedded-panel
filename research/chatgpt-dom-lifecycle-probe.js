(() => {
  'use strict';

  const GLOBAL_KEY = '__webmcpChatgptLifecycleProbe';
  const MAX_TREE_NODES = 260;
  const MAX_TEXT = 1200;
  const MAX_NODE_TEXT = 180;
  const MAX_TIMELINE = 120;
  const TOOL_TEXT_RE = /\b(called\s+tool|code\s+tool|call\s+tool|tool\s+call|tool\s+result)\b/i;
  const PROGRESS_TEXT_RE = /\b(thinking|working|thought\s+for|worked\s+for|searching|reading|looking|checking|opening|preparing|analyzing|analysing)\b/i;

  const previous = globalThis[GLOBAL_KEY];
  if (previous?.stop) previous.stop();

  const startedAt = performance.now();
  const stages = new Map();
  const timeline = [];
  let observer = null;
  let scheduled = false;
  let stopped = false;
  let lastFingerprint = '';
  let stage2Timer = null;
  let lastToolCount = 0;

  function nowMs() {
    return Math.round(performance.now() - startedAt);
  }

  function cleanText(value, max = MAX_NODE_TEXT) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  function visible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function attrs(element) {
    const names = [
      'data-testid',
      'data-turn',
      'data-turn-id',
      'data-message-author-role',
      'data-message-id',
      'role',
      'aria-label',
      'aria-expanded',
      'aria-live',
      'aria-busy',
      'aria-hidden',
      'data-state',
    ];
    const result = {};
    for (const name of names) {
      const value = element.getAttribute?.(name);
      if (value !== null && value !== '') result[name] = cleanText(value, 240);
    }
    const cls = cleanText(element.getAttribute?.('class'), 260);
    if (cls) result.class = cls;
    return result;
  }

  function directText(element) {
    let text = '';
    for (const node of element.childNodes ?? []) {
      if (node.nodeType === Node.TEXT_NODE) text += ` ${node.textContent ?? ''}`;
    }
    return cleanText(text);
  }

  function serializeTree(root) {
    let seen = 0;

    function walk(element, depth = 0) {
      if (!(element instanceof Element) || seen >= MAX_TREE_NODES || depth > 7) return null;
      seen += 1;
      const children = [];
      for (const child of element.children ?? []) {
        if (seen >= MAX_TREE_NODES) break;
        const serialized = walk(child, depth + 1);
        if (serialized) children.push(serialized);
      }

      const data = {
        tag: element.tagName.toLowerCase(),
        attrs: attrs(element),
      };
      const text = directText(element);
      if (text) data.directText = text;
      if (!visible(element)) data.hidden = true;
      if (children.length) data.children = children;
      return data;
    }

    return walk(root);
  }

  function allTurns() {
    return [...document.querySelectorAll([
      '[data-testid^="conversation-turn-"][data-turn]',
      'article[data-turn]',
      'section[data-turn]',
      '[data-testid^="conversation-turn-"]',
    ].join(','))];
  }

  function newestAssistantTurn() {
    const turns = allTurns();
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      const turn = turns[index];
      const declared = turn.getAttribute('data-turn');
      if (declared === 'assistant') return turn;
      if (turn.querySelector('[data-message-author-role="assistant"]')) return turn;
      const text = cleanText(turn.innerText, 400);
      if (text && !turn.querySelector('[data-message-author-role="user"]')) return turn;
    }
    return null;
  }

  function stopVisible() {
    const candidates = document.querySelectorAll([
      'button[data-testid="stop-button"]',
      'button[aria-label*="stop" i]',
      '[data-testid*="stop" i]',
    ].join(','));
    return [...candidates].some(visible);
  }

  function copyVisible(turn) {
    return Boolean(turn?.querySelector('button[data-testid="copy-turn-action-button"]'));
  }

  function toolSignals(turn) {
    if (!turn) return { count: 0, candidates: [] };
    const candidates = [];
    const seen = new Set();

    for (const element of turn.querySelectorAll('*')) {
      const testid = element.getAttribute?.('data-testid') ?? '';
      const aria = element.getAttribute?.('aria-label') ?? '';
      const role = element.getAttribute?.('role') ?? '';
      const own = directText(element);
      const structural = /tool|mcp|connector|code/i.test(`${testid} ${aria} ${role}`);
      const textual = TOOL_TEXT_RE.test(own);
      if (!structural && !textual) continue;

      let wrapper = element;
      for (let depth = 0; depth < 3 && wrapper.parentElement && wrapper.parentElement !== turn; depth += 1) {
        const parent = wrapper.parentElement;
        const parentText = cleanText(parent.innerText, 500);
        if (parentText && parentText.length <= 500) wrapper = parent;
        else break;
      }

      if (seen.has(wrapper)) continue;
      seen.add(wrapper);
      candidates.push({
        tag: wrapper.tagName.toLowerCase(),
        attrs: attrs(wrapper),
        text: cleanText(wrapper.innerText, 500),
      });
    }

    const turnText = cleanText(turn.innerText, MAX_TEXT);
    const textualCount = (turnText.match(/called\s+tool|code\s+tool|call\s+tool|tool\s+call/gi) ?? []).length;
    return {
      count: Math.max(textualCount, candidates.length),
      candidates: candidates.slice(0, 12),
    };
  }

  function snapshot(reason) {
    const turn = newestAssistantTurn();
    if (!turn) return null;

    const assistant = turn.querySelector('[data-message-author-role="assistant"]');
    const copy = copyVisible(turn);
    const tools = toolSignals(turn);
    const text = cleanText(turn.innerText, MAX_TEXT);

    return {
      tMs: nowMs(),
      reason,
      urlPath: location.pathname,
      documentVisibility: document.visibilityState,
      turn: {
        tag: turn.tagName.toLowerCase(),
        attrs: attrs(turn),
        text,
      },
      signals: {
        stopVisible: stopVisible(),
        copyActionPresent: copy,
        assistantContentPresent: Boolean(assistant),
        assistantText: cleanText(assistant?.innerText, 700),
        progressTextLikely: PROGRESS_TEXT_RE.test(text),
        toolSignalCount: tools.count,
      },
      toolCandidates: tools.candidates,
      tree: serializeTree(turn),
    };
  }

  function recordStage(name, snap) {
    if (!snap || stages.has(name)) return;
    stages.set(name, snap);
    console.info(`[WebMCP lifecycle probe] ${name}`, snap);
  }

  function recordTimeline(snap) {
    if (!snap) return;
    const fingerprint = JSON.stringify({
      text: snap.turn.text,
      signals: snap.signals,
      tools: snap.toolCandidates.map((item) => [item.tag, item.attrs['data-testid'], item.attrs.role, item.text]),
    });
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    timeline.push(snap);
    if (timeline.length > MAX_TIMELINE) timeline.shift();
  }

  function classify(snap) {
    if (!snap) return;

    if (!stages.has('stage1-thinking-start')) {
      recordStage('stage1-thinking-start', snap);
      clearTimeout(stage2Timer);
      stage2Timer = setTimeout(() => {
        const later = snapshot('stage2-timer');
        if (later && !later.signals.copyActionPresent) recordStage('stage2-progress-update', later);
      }, 900);
    }

    if (
      !stages.has('stage2-progress-update')
      && snap.tMs > 350
      && snap.signals.progressTextLikely
      && !snap.signals.copyActionPresent
      && snap.signals.toolSignalCount === 0
    ) {
      recordStage('stage2-progress-update', snap);
    }

    if (snap.signals.toolSignalCount > 0) {
      if (!stages.has('stage3-first-tool')) recordStage('stage3-first-tool', snap);
      if (
        !stages.has('stage4-multiple-tools')
        && (snap.signals.toolSignalCount >= 2 || lastToolCount > 0 && snap.signals.toolSignalCount !== lastToolCount)
      ) {
        recordStage('stage4-multiple-tools', snap);
      }
      lastToolCount = Math.max(lastToolCount, snap.signals.toolSignalCount);
    }

    if (
      !stages.has('stage5-final-answer-start')
      && snap.signals.assistantContentPresent
      && snap.signals.assistantText
      && !snap.signals.copyActionPresent
    ) {
      recordStage('stage5-final-answer-start', snap);
    }

    if (snap.signals.copyActionPresent) {
      recordStage('stage6-completed', snap);
    }
  }

  function tick(reason) {
    if (stopped) return;
    const snap = snapshot(reason);
    recordTimeline(snap);
    classify(snap);
  }

  function schedule(reason) {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      tick(reason);
    });
  }

  observer = new MutationObserver((mutations) => {
    const reason = mutations.some((m) => m.type === 'attributes')
      ? 'mutation-attributes'
      : mutations.some((m) => m.type === 'characterData')
        ? 'mutation-text'
        : 'mutation-childlist';
    schedule(reason);
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'class',
      'data-testid',
      'data-turn',
      'data-message-author-role',
      'role',
      'aria-label',
      'aria-expanded',
      'aria-busy',
      'data-state',
    ],
  });

  const api = {
    startedAt: new Date().toISOString(),
    tick: () => tick('manual'),
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(stage2Timer);
      observer?.disconnect();
      console.info('[WebMCP lifecycle probe] stopped');
    },
    data() {
      return {
        probeVersion: 1,
        capturedAt: new Date().toISOString(),
        page: {
          origin: location.origin,
          pathname: location.pathname,
          title: document.title,
        },
        stages: Object.fromEntries(stages),
        timeline,
      };
    },
    json() {
      return JSON.stringify(this.data(), null, 2);
    },
    async copy() {
      const value = this.json();
      await navigator.clipboard.writeText(value);
      console.info('[WebMCP lifecycle probe] copied JSON to clipboard');
      return value.length;
    },
    download(filename = 'chatgpt-dom-lifecycle-capture.json') {
      const blob = new Blob([this.json()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };

  globalThis[GLOBAL_KEY] = api;
  tick('probe-start');
  console.info(
    '[WebMCP lifecycle probe] armed. Run a long ChatGPT task with multiple tools. '
    + 'When complete, run __webmcpChatgptLifecycleProbe.download()',
  );
})();
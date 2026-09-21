# ChatGPT Web DOM lifecycle capture

This research probe is not part of the extension manifest and does not change production runtime behavior.

## What it reads

Only the current ChatGPT page DOM:

- the newest assistant turn structure;
- stable attributes such as `data-testid`, `data-turn`, `role`, `aria-*`;
- bounded visible UI text needed to distinguish progress from tool presentation;
- presence of Stop / Copy completion controls.

It does not read cookies, local/session storage, network requests, auth/session tokens, or private APIs.

## Run

On macOS, copy the probe source:

```bash
pbcopy < "$HOME/Doc/My code/chatgpt-embedded-panel/research/chatgpt-dom-lifecycle-probe.js"
```

Open a normal authenticated `https://chatgpt.com` conversation (not the Side Panel), then open Chrome DevTools from **View → Developer → Developer Tools**, choose **Console**, paste, and press Enter.

Expected console line:

```
[WebMCP lifecycle probe] armed.
```

Then run one sufficiently large ChatGPT task that causes multiple native tools/tool activities and a visible Thinking/Working phase.

The recorder attempts to capture:

1. Thinking starts
2. progress summary updates
3. first Called tool
4. multiple Called tool entries
5. final answer starts
6. completed / Worked for

When the final answer is fully complete, run:

```js
__webmcpChatgptLifecycleProbe.download()
```

This downloads `chatgpt-dom-lifecycle-capture.json`.

If a stage classifier misses a transient state, the JSON still contains a bounded de-duplicated `timeline` of DOM structures for manual reconstruction.

## Suggested probe task

Use a task that naturally triggers several web/tool actions, for example:

> Research three current sources about today's most important AI platform announcements, compare them, verify publication dates, and give me a concise synthesis. Keep working until you have checked all three sources.

The exact topic is not important; the goal is to produce native ChatGPT progress plus multiple Called-tool events.

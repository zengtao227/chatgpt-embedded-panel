# ChatGPT Web DOM Lifecycle Study

Status: research in progress. No runtime implementation changes are authorized from this study yet.

## Product principle under study

**Progress visible, tool execution invisible.**

During long Browser WebMCP tasks, preserve ChatGPT's native user-facing Working/Thinking state, reasoning summaries, progress commentary, and native elapsed-time presentation. Hide Browser WebMCP/tool execution details such as Called tool / Code Tool, tool names, arguments, results, harness text, and generated continuation messages.

When the task finishes, preserve ChatGPT's native completed presentation (for example a compact Worked for … disclosure) and final answer; accumulated live progress details should no longer occupy the conversation by default.

## Evidence gathered

### Turn root

Recent ChatGPT DOM integrations continue to identify the assistant turn by a conversation-turn wrapper such as:

- `[data-testid^="conversation-turn-"][data-turn="assistant"]`
- `[data-testid^="conversation-turn-"]:has([data-message-author-role="assistant"])`
- fallback `.agent-turn`

The turn root is the correct lifecycle boundary. It is too coarse to hide wholesale because it contains multiple kinds of UI.

### Thinking / completed reasoning presentation

Live DOM captures show a Thinking/Thought/Worked-for area above the assistant content. It is structurally a sibling of the final assistant message, not part of the final markdown body.

Observed shape:

```html
<article data-turn="assistant" data-testid="conversation-turn-N">
  <div class="...">
    <div class="relative my-1 min-h-6">
      <button>
        <span class="... text-token-text-secondary ...">
          Thought for 18s
        </span>
      </button>
    </div>

    <div data-message-author-role="assistant">
      <div class="markdown prose">...</div>
    </div>
  </div>
</article>
```

Older/current captures also show multiple thinking stages as repeated sibling regions before final content. A recent live automation note reports that `data-message-author-role="assistant"` may not appear until thinking completes, reinforcing that live progress must not be detected only from the final message node.

### Completion signal

Current live-browser ChatGPT automation uses:

```
button[data-testid="copy-turn-action-button"]
```

as a semantic completed-response signal, together with Stop disappearance. This is stronger than text stability alone.

Implication: finalization should be driven by native completion state, not by an arbitrary timeout or by detecting a non-empty assistant body.

### Tool activity

Recent ChatGPT tool/app captures show a separate visible wrapper with text such as:

```
Called tool
Deep Research App
Call tool
Request ...
Response ...
```

This wrapper can exist while the actual report/result lives elsewhere. Therefore tool activity is structurally distinct from reasoning/progress and final assistant content.

Exact stable DOM attributes/testids for the September 2026 Called-tool wrapper are **not yet confirmed**. Do not implement text-only destructive selectors until live DOM is sampled.

### API/product model supports the separation

OpenAI Responses streaming separates reasoning summary events from tool-call events. Reasoning summaries have their own `reasoning_summary_text` lifecycle, while tool calls have distinct call/completion events.

OpenAI's current Plugin/App tool descriptor also exposes dedicated ChatGPT presentation metadata for tool invocation status:

- `_meta["openai/toolInvocation/invoking"]` — short text shown while a tool runs;
- `_meta["openai/toolInvocation/invoked"]` — short text shown after a tool completes.

This is strong product-level evidence that user-facing reasoning/progress and tool-invocation presentation are independent channels. Browser WebMCP should preserve the former and suppress the latter.

## Working DOM model

Treat one assistant turn as four logical layers:

```
assistant turn
├─ progress / reasoning presentation
│  ├─ Working / Thinking state
│  ├─ user-facing reasoning summary / progress commentary
│  └─ elapsed-time / Worked-for disclosure
├─ tool activity
│  ├─ Called tool / Code Tool label
│  ├─ tool name
│  ├─ arguments
│  └─ result
├─ final assistant content
│  └─ data-message-author-role="assistant" / markdown prose
└─ completion actions
   ├─ Copy
   ├─ Rate
   ├─ Share
   └─ Try again / More
```

Desired visibility:

| Phase | Progress summary | Tool activity | Final answer | Completion actions |
| --- | --- | --- | --- | --- |
| Running | visible | hidden | not yet / streaming as native | hidden |
| Tool continuation | visible | hidden | hidden if protocol-only | hidden |
| Finalizing | visible until native completion | hidden | visible | hidden until complete |
| Completed | compact native Worked-for/disclosure | hidden | visible | visible |

## Six-stage live DOM capture matrix

The implementation should not change until these are sampled in a real authenticated ChatGPT Web task that performs multiple tools.

### Stage 1 — Thinking starts

Capture the newest assistant turn immediately after send.

Record:
- turn root attributes
- direct child structure
- visible text
- Stop button presence
- whether `data-message-author-role="assistant"` exists
- all buttons/testids inside the turn

### Stage 2 — Progress summary updates

Capture after visible Working/Thinking commentary changes but before first tool call.

Record:
- which node changes
- whether it is inside the same thinking container
- whether new siblings are appended
- aria-expanded / button structure

### Stage 3 — First Called tool appears

Capture immediately when Called tool / Code Tool becomes visible.

Record:
- nearest stable ancestor
- tag/role/data-testid/data-* attributes
- relationship to thinking container
- relationship to final message node
- whether tool label is its own sibling/card/details node

### Stage 4 — Multiple tool calls

Capture after 2–3 tool calls.

Determine:
- one growing tool container vs multiple repeated siblings
- whether progress summaries are interleaved with tool wrappers
- whether hiding only tool wrappers leaves coherent visible progress

### Stage 5 — Final answer starts

Capture as final natural-language answer begins.

Determine:
- whether progress container remains expanded
- whether Called-tool wrappers remain
- when `data-message-author-role="assistant"` appears
- Stop button state

### Stage 6 — Completed / Worked for

Capture only after `copy-turn-action-button` appears.

Determine:
- how Working/Thinking becomes Thought/Worked-for
- whether progress detail nodes are removed, collapsed, or retained under disclosure
- whether tool wrappers remain in DOM but collapsed
- exact stable attributes on the final disclosure

## Implementation constraints derived from study

Until Stage 1–6 live DOM evidence exists:

1. Do not hide the entire assistant turn.
2. Do not invent a custom Thinking/Worked-for UI.
3. Do not identify reasoning/progress by arbitrary text across the whole turn.
4. Do not hide elements solely because they contain the word "tool" unless the live DOM proves the structural wrapper.
5. Prefer semantic attributes / testids / structural relationships over styling classes.
6. Use `copy-turn-action-button` as one completion signal, not as the only selector for progress classification.
7. Preserve the native progress container and remove/suppress only structurally proven tool-activity nodes.
8. On completion, let ChatGPT's native DOM perform its own progress-to-Worked-for transition wherever possible.

## Current research conclusion

The current 1.0 behavior that collapses a confirmed intermediate assistant turn wholesale is too coarse for long-running tasks. It solves blank-space/tool-noise problems but also removes native progress feedback.

The likely correct implementation is selective suppression inside the native turn:

- preserve ChatGPT progress/reasoning siblings;
- suppress Browser WebMCP textual protocol and native Called-tool wrappers;
- preserve the final native assistant message;
- preserve final native completion controls;
- rely on native completed-state transition rather than recreating it.

The remaining blocker is a live September 2026 DOM sample of Stage 1–6, especially the stable structural identity of Called-tool wrappers.

# Next Stage Execution Plan — DeepSeek -> Local -> Browser WebMCP Platform

Date: 2026-09-20
Status: Implementation plan for Codex review. No runtime implementation in this planning change.

## 0. Execution rule

The next work is deliberately serial:

1. Finish the DeepSeek compact-assistant problem first.
2. Then finish the Local Expert/Privacy setup consolidation.
3. Only then start Hosted Browser WebMCP Platform implementation.

Do not run these as three parallel redesigns. Preserve the already-proven Browser Execution Plane and the current uncommitted work in both repositories. Do not commit or push unless the owner explicitly asks.

Stable Browser Execution Plane:

    Extension
      -> task binding / handoff
      -> runBrowserTool()
      -> browser-client.js
      -> target-executor.js
      -> inspect_page / inspect_form / fill / select / click / scroll

Changing deployment or model provider must not rewrite this layer without a demonstrated correctness blocker.

---

# Phase 1 — Finish DeepSeek Compact Assistant

Repository:

    <workspace>/deepseek-webmcp

Primary design:

    docs/p6-compact-assistant-roadmap.md

## 1.1 Goal

Remove the user's need to manually manage two Chrome windows and make DeepSeek WebMCP readable enough for normal use:

- Extension automatically creates/reuses the required DeepSeek provider window.
- The provider window remains non-minimized and can stay completely behind the work window.
- User works from an extension-owned Side Panel.
- Side Panel shows DeepSeek-visible reasoning separately from the final answer.
- Successful WebMCP tool traffic is aggregated instead of appearing as many conversational turns.
- Existing local tools, Browser tools, replay controls, permission boundaries and confirmation gates remain unchanged.

Today's definition of done is Gates D1-D5 below. Do not expand the phase into a provider framework, DeepSeek API client, or generic AI web adapter.

## 1.2 Facts that must not be re-litigated

Already proven by the 2026-09-19 spikes:

- Direct DeepSeek inside Chrome Side Panel is not viable.
- A fully hidden/background DeepSeek tab can generate but does not render answer/reasoning DOM.
- DeepSeek as the selected tab in a second non-minimized window remains visibility=visible while unfocused.
- That provider window may be fully covered by the normal work window and still render the answer DOM.

Therefore Phase 1 productizes the provider-window constraint; it does not try to bypass it.

## 1.3 D1 — Baseline and records

Before runtime changes:

1. Record git status/diff; preserve all existing uncommitted Browser WebMCP V1 work.
2. Run npm run check and record the baseline result.
3. Confirm docs/browser-v1-live-test.md accurately records the already-completed live Browser V1 acceptance; correct documentation only if stale.
4. Do not modify webmcp-bridge or webmcp-bridge-plus.

Acceptance:

- baseline suite green;
- current uncommitted files accounted for;
- no unrelated cleanup.

## 1.4 D2 — Managed provider-window lifecycle

Expected runtime changes:

- extension/background.js
- extension/popup.html
- extension/popup.js
- tests covering session/provider-window state

Minimum behavior:

1. Add one explicit user action from the existing popup: Open Assistant / Control this page & open Assistant.
2. On that user gesture, bind the current ordinary work tab W using the existing target attachment path.
3. Find an existing dedicated DeepSeek provider tab/window if it is the recorded healthy provider.
4. Otherwise create a dedicated Chrome window containing chat.deepseek.com with focused:false.
5. DeepSeek must remain the active tab of that provider window.
6. Provider window must remain non-minimized.
7. Restore focus to the original work window after provider creation/reuse.
8. Persist one authoritative session in chrome.storage.session:

       workTabId
       workWindowId
       providerTabId
       providerWindowId
       state

9. Never choose another DeepSeek tab merely because it is currently visible or active.
10. If provider tab/window disappears, becomes minimized, or stops answering health messages, mark the session paused.
11. Provide one Restore action that normalizes the recorded provider window/tab and then returns focus to the work window.

Do not:

- minimize the provider window;
- move it off-screen as a new workaround;
- automate login/challenges;
- create multiple simultaneous provider sessions;
- silently retarget.

Official Chrome basis: chrome.windows.create supports focused:false; the existing empirical spike already proves the non-minimized covered-window behavior on the target Mac/Chrome environment.

D2 acceptance:

- one click from work page creates/reuses provider window;
- user does not manually arrange Window B;
- provider reports visible + unfocused;
- work window regains focus;
- provider can remain fully covered;
- closing/minimizing provider produces an explicit paused state;
- Restore returns to healthy state;
- second unrelated DeepSeek tab is never adopted.

## 1.5 D3 — Extension-owned Side Panel

Expected runtime changes:

- extension/manifest.json
- NEW extension/sidepanel.html
- NEW extension/sidepanel.js
- extension/background.js

Use Chrome Side Panel only as extension-owned UI. The side_panel.default_path must be a local extension resource. Opening the panel must follow a user gesture.

Side Panel responsibilities:

- prompt input;
- provider/session state;
- streamed provider-visible reasoning;
- streamed final answer;
- compact tool activity;
- Stop / Restore actions.

Side Panel must not own:

- tool allowlists;
- Browser target selection rules;
- filesystem authority;
- replay protection;
- confirmation gating;
- Native runtime policy.

Keep the existing popup for installation/folder/full-access/uninstall controls; do not move those administrative controls into the assistant UI in this phase.

D3 acceptance:

- panel opens from the explicit popup action;
- panel can close/reopen and reconstruct its state;
- one authoritative session exists in background/storage, not in the panel document;
- switching normal work tabs does not silently retarget the bound session.

## 1.6 D4 — Prompt, visible reasoning, final answer

Expected runtime changes:

- extension/content.js
- extension/background.js
- extension/sidepanel.js
- tests for event/snapshot handling

Prompt path:

- factor the existing normal user-send behavior so a Side Panel prompt and a DeepSeek-page typed prompt reuse the same composer/send mechanism;
- preserve first-message WebMCP instruction attachment;
- do not create a second prompt protocol.

Presentation inputs:

- provider-visible reasoning currently observed under .ds-think-content;
- final answer currently observed under .ds-markdown.ds-assistant-message-main-content.

Rules:

1. Mirror only text the DeepSeek page itself visibly exposes; do not attempt hidden/private chain-of-thought extraction.
2. Render provider text with textContent or equivalent safe rendering, never provider-controlled innerHTML.
3. While generation is active, show a Thinking section that can stream/update.
4. When final answer is present, make it the main visual content.
5. Thinking may auto-collapse after completion but remains user-expandable.
6. Bound snapshot sizes using existing answer-size constraints; do not introduce unbounded storage.

D4 acceptance:

- prompt can be typed entirely in Side Panel;
- provider remains behind the work window;
- visible reasoning updates in Side Panel while available;
- final answer streams and remains readable;
- page reload/session recovery fails closed rather than attaching to another provider.

## 1.7 D5 — Aggregate tool activity

Expected runtime changes:

- extension/background.js
- extension/sidepanel.js
- tests around presentation events

Do not change the WebMCP tool wire protocol or one-call-per-reply rule merely to improve appearance.

Background already knows when it accepts and executes a tool call. Expose presentation-only events/state such as:

    tool.started
    tool.completed
    tool.error
    confirmation.required

Default UI:

    Working · N tool actions

Completed UI:

    Used N tools

Expandable details may show tool names and success/error state.

Always make these visible without expansion:

- CONFIRMATION_REQUIRED;
- target lost;
- local runtime unavailable;
- tool error.

Normal successful request/result protocol text must not be reproduced as separate Side Panel conversation turns.

Actual tool-count optimization is not part of the first UI fix. After the UI is clean, collect traces. Only change tool contracts if real traces prove redundant calls caused by missing information.

D5 acceptance:

- a multi-tool Browser task produces one compact activity item by default;
- final answer is visually dominant;
- errors/confirmation are explicit;
- existing one-tool sequencing remains intact.

## 1.8 D6 — Timer changes only if evidence requires them

Current content.js contains provider-page timers and send-confirm loops. Because the proven provider window remains visibility=visible, do not preemptively rewrite this timing code.

If live P6 testing produces SEND_DISABLED, SEND_NOT_CONFIRMED, or stalled stable-text detection while provider is visible+unfocused, then make the smallest timing change from the prior architecture review: MutationObserver remains the DOM detector and panel/background drives the retry/clock boundary.

No observed timer failure = no timing rewrite.

## 1.9 DeepSeek final acceptance matrix

Required live checks on a disposable/harmless target:

1. Open an ordinary page; invoke Open Assistant once.
2. Provider window is created/reused automatically and stays behind work.
3. Send a normal no-tool prompt from Side Panel; reasoning/final answer display correctly.
4. Run an inspect-only Browser task.
5. Run a safe multi-tool form task: inspect -> fill/select -> safe reversible click if applicable.
6. Verify commit-like action still returns CONFIRMATION_REQUIRED.
7. Tool activity stays collapsed/aggregated.
8. Minimize provider manually -> Assistant pauses.
9. Restore -> provider returns to visible+unfocused and task can continue.
10. Close provider -> fail closed; no random DeepSeek tab adoption.
11. Close/reopen Side Panel -> session presentation restores.
12. Existing DeepSeek-page Work flow still works.
13. Existing local coding tool flow still works.
14. npm run check is green.

Phase 1 is complete only when these checks pass or a concrete provider/browser blocker is identified.

---

# Phase 2 — Finish Local Expert / Privacy Setup

Repository:

    <workspace>/chatgpt-embedded-panel

Detailed design:

    docs/local-expert-install-plan.md

## 2.1 Goal

Turn the already-working Local architecture into one reproducible expert workflow. A technical user should not need old chat history or multiple undocumented commands.

Target experience:

    clone repo
    -> Load unpacked once
    -> npm run local:setup -- --tunnel-id ... --extension-id ...
    -> choose/select the Tunnel in ChatGPT
    -> npm run local:doctor whenever needed

Also provide one browser-only Local uninstall command that removes this project's Local Browser components without deleting Native WebMCP or the source repository.

Do not turn this phase into the full non-technical Family Installer product.

## 2.2 L1 — Canonical documentation

1. README Local Expert Setup becomes the single canonical path.
2. ROADMAP records LaunchAgent reboot/login PASS.
3. Family Installer V1 remains clearly labeled experimental/separate.
4. Document required external inputs only:
   - Node 22+ for the expert path;
   - Chrome;
   - official tunnel-client;
   - tunnel_id;
   - runtime key source;
   - Chrome extension id until a permanent Web Store identity exists.
5. Link to official Secure MCP Tunnel permission/setup documentation.

## 2.3 L2 — npm run local:setup

Create one orchestration script around existing proven mechanisms rather than duplicating them.

Required inputs:

- --tunnel-id;
- --extension-id.

Optional explicit inputs:

- --runtime-key-file;
- --tunnel-client.

Behavior:

1. Preflight macOS / Node / Chrome.
2. Validate ids and file permissions.
3. Resolve tunnel-client from explicit path, existing managed path, or PATH.
4. Prepare/update the Browser MCP launcher using the current repo and current Node path.
5. Install/update the existing Native Messaging host through the existing installer.
6. Invoke the existing Browser LaunchAgent installer with explicit Browser-owned overrides when provided; otherwise preserve the already-proven developer compatibility behavior.
7. Re-running with the same configuration must be idempotent.
8. Refuse to overwrite a mismatched existing Browser profile/config silently.
9. Run local doctor at the end.
10. Print only the remaining ChatGPT UI action.

Do not:

- download Node;
- add a package manager;
- create an OpenAI admin key flow;
- delete Native WebMCP;
- reset working profiles;
- copy the whole repo to a second runtime tree for this expert path.

## 2.4 L3 — npm run local:doctor

Read-only only. No repair.

Check:

- OS/Node;
- extension/native host manifest and allowed origin;
- native-host launcher existence/executable;
- Browser MCP launcher existence/executable;
- Browser profile existence;
- Browser LaunchAgent plist existence;
- launchctl loaded/state/runs/pid/last-exit;
- tunnel health URL;
- /readyz == ready;
- Browser tunnel error-log size and tail when non-empty;
- expected runtime/tunnel-client paths.

Output a compact layer-by-layer PASS/FAIL summary and a final first broken layer.

## 2.5 L4 — npm run local:uninstall

Scope: only Browser Local components owned by this project.

Expected teardown:

- bootout com.webmcp.browser-tunnel when loaded;
- remove its LaunchAgent plist;
- remove com.webmcp.browser Native Messaging manifest;
- remove Browser-native and Browser-MCP launchers owned by this project;
- remove browser-mcp tunnel profile;
- remove Browser-specific tunnel home/logs only where ownership is unambiguous.

Must not remove:

- Native com.webmcp.native-tunnel;
- Native runtime key if shared;
- Native profile;
- ~/.local/share/webmcp/bin/tunnel-client when it belongs to Native compatibility mode;
- source repository;
- unrelated Chrome extensions.

Where ownership cannot be proven, leave the file and report it.

## 2.6 Deterministic extension ID

Do not block Phase 2 on a self-generated manifest key that may later conflict with Chrome Web Store identity.

For now, local:setup accepts one explicit --extension-id. When the product obtains its permanent Web Store public key/ID, make that the default and remove the argument.

This preserves future ID continuity instead of optimizing the expert path at the cost of migration later.

## 2.7 Local acceptance

1. npm test / npm run check baseline green.
2. local:doctor reports current working machine PASS.
3. Re-run local:setup against the existing correct install; it remains healthy and does not destroy state.
4. Native and Browser LaunchAgents remain distinct.
5. real ChatGPT inspect_page still works after setup rerun.
6. local:doctor points to the correct layer when tested against fixtures/mocked missing paths.
7. local:uninstall has unit coverage for exact ownership boundaries; do not live-uninstall the owner's working environment merely for acceptance.
8. README alone is sufficient to reproduce the expert flow.

Phase 2 is done when the owner can return months later and operate Local using README + setup/doctor without reconstructing chat history.

---

# Phase 3 — Browser WebMCP Platform / Hosted Relay

Repository:

    <workspace>/chatgpt-embedded-panel

Primary docs:

    docs/hosted-relay-enterprise-architecture.md
    docs/hosted-relay-review.md
    docs/browser-webmcp-platform-roadmap.md

## 3.1 Claude review decisions adopted before implementation

### P0-A — Connection ownership

Adopt explicit Browser Control session ownership.

The user explicitly arms Browser Control from the extension UI. That session, not Side Panel visibility, owns Hosted transport availability.

Properties:

- panel may close without disarming;
- session state survives service-worker restart within the browser session;
- browser restart/log-out does not silently create a new control session;
- user can explicitly Stop/Disarm;
- while disarmed the relay cannot invoke Browser tools.

This also supplies the consent surface needed to mitigate Hosted auto-lock risk.

### P0-B — Service-worker re-arm

Implement one idempotent ensureTransport() path.

When Browser Control is armed:

- module/service-worker startup checks/reconstructs desired transport state;
- chrome.runtime.onStartup participates where applicable;
- a chrome.alarms fallback/event can wake and re-run ensureTransport();
- WebSocket open/close/reconnect also routes through ensureTransport().

Do not confuse keeping a service worker alive with reconnecting transport state. Chrome officially supports WSS activity keeping an MV3 worker active when messages occur inside the activity window, but code still must reconstruct transport after unexpected worker termination.

### P0-C — Hosted single-flight

Enforce one in-flight Browser call at both boundaries:

- Relay per device;
- Extension before runBrowserTool().

This is correctness protection for the current non-atomic target/handoff state machine.

### P0-D — Wire hardening

Hosted WSS boundary adds:

- bounded/UUID-shaped call ids;
- in-flight duplicate rejection;
- unknown/late/replayed result rejection;
- response-size bounds;
- staggered timeout layers rather than identical 15s timers.

### P0-E — Privacy boundary includes errors

Treat every tool request, result and error object as browser content.

Before crossing WSS, Hosted must not forward page-derived error.details such as accessibleName/button labels unless the protocol explicitly requires them. Logging policy must prohibit request/result/error bodies.

Add a test using a commit-like button label to prove the relay/log sink does not receive page-derived text through CONFIRMATION_REQUIRED details.

### P0-F — Capability credential/logging

Do not assume a secret URL path stays secret: reverse proxies commonly log request paths.

For the isolated read-only POC, either:

- use a client-supported Authorization mechanism, or
- explicitly configure the proxy/application so the capability is never present in access logs.

Production authentication remains OAuth 2.1/MCP authorization for user-specific data/actions.

## 3.2 H1 — Hosted inspect_page POC

Only after P0 decisions are incorporated into code/design.

Implement:

    ChatGPT
      -> public Streamable HTTP MCP using official MCP SDK
      -> one Relay process
      -> one authenticated WSS device
      -> explicit armed Browser Control session
      -> existing runBrowserTool()
      -> inspect_page
      -> response

Still no billing, database, Redis, Kubernetes, multi-tenant account UI, or target-executor rewrite.

## 3.3 H1 acceptance

1. ChatGPT scans endpoint and sees inspect_page.
2. Armed Extension connects to WSS.
3. inspect_page reaches existing Browser Execution Plane.
4. result returns to ChatGPT.
5. closing Side Panel does not tear down an armed Hosted session.
6. disarming Browser Control immediately disables Hosted calls.
7. simulated/real service-worker restart re-establishes transport while the browser-control session remains armed.
8. reconnect after socket loss works.
9. one-call serialization holds in Relay and Extension.
10. duplicate/replayed call id is rejected.
11. page-body fixture is absent from logs.
12. CONFIRMATION_REQUIRED accessible-name/details fixture is absent from relay logs/wire where not required.
13. Local Native path still passes its existing tests and real inspect_page check.

## 3.4 H2 — Actual ChatGPT capability gate

After inspect_page POC, verify the intended ChatGPT plan/workspace with one reversible action. Do not infer full write/action availability from inspect_page success.

## 3.5 H3 — Product auth and multi-user

Only after H1/H2:

- OAuth 2.1 / MCP authorization;
- pairing/device identity;
- tenant-bound immutable connection context;
- multi-user routing/isolation;
- content-free operational logging;
- SaaS/customer-hosted deployment packaging.

---

# 4. Codex review acceptance

Codex should review this execution plan before implementation and return findings in four categories:

- Blocker — phase cannot meet its own acceptance criteria.
- Design gap — must be solved before external users but not necessarily before the current proof.
- Hardening — concrete issue worth doing in the same change if cheap.
- Confirmed — plan is correct; do not redesign.

Codex should prefer exact current repo evidence and authoritative external platform documentation. It should not implement changes, commit, push, or redesign adjacent systems.

Review brief:

    docs/codex-next-stage-review-brief.md

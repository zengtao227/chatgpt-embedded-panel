# ChatGPT Embedded Panel

Standalone Chrome/Chromium extension that runs the user's normal signed-in `https://chatgpt.com` Web UI directly inside Chrome Side Panel.

This is our own implementation. It is based on the empirically proven `X-Frame-Options + Content-Security-Policy` frame-policy requirement and uses a narrower extension-initiated subframe rule than broad/global header overrides.

## Runtime design

- The Side Panel enables one session-scoped `declarativeNetRequest` rule.
- The rule applies only to `chatgpt.com` `sub_frame` responses initiated by this extension id.
- It removes only `X-Frame-Options` and `Content-Security-Policy` from those responses.
- ChatGPT then runs as the real Web UI inside the Side Panel iframe using the browser's existing signed-in session.
- An embedded-frame content script provides a minimal readiness handshake and remembers the last safe ChatGPT route.
- Reopening/reloading the panel restores the last safe ChatGPT route.
- If the embedded page does not reconnect after one retry, the panel offers a normal ChatGPT companion-window fallback.

No OpenAI API, private completion endpoint, cookie export, token export, proxy, or global response-header rewrite is used.

## Load unpacked

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select:

`$HOME/Doc/My code/chatgpt-embedded-panel`

Make sure the same Chrome profile is already signed in at `https://chatgpt.com`.

## Local Expert / Privacy — canonical setup

This is the supported **technical-user** Local path. It keeps browser content on the Mac behind an OpenAI Secure MCP Tunnel and uses the already-proven Browser MCP + Chrome Native Messaging + LaunchAgent architecture.

### Prerequisites

A fresh Mac needs all of the following before Local setup can succeed:

- macOS with Google Chrome;
- Node.js 22 or newer;
- the official OpenAI `tunnel-client` executable;
- a Browser MCP Secure Tunnel id (`tunnel_<32-lowercase-hex>`);
- a runtime API key stored in a local **mode-0600 file**;
- the Chrome extension id from the unpacked extension.

The Tunnel id and Chrome extension id are identifiers only. **They are not enough to authenticate the tunnel.** A fresh machine must also have a runtime-key file and `tunnel-client`.

If Native WebMCP is already installed on this Mac, Local setup can reuse its existing `tunnel-client` and its Native profile's `file:` runtime-key reference. It never copies the secret value onto the command line.

### Setup

1. Clone/open this repository.
2. In `chrome://extensions`, enable Developer mode and **Load unpacked** this repository once.
3. Copy the 32-character Chrome extension id.
4. Run one setup command.

If Native WebMCP is already installed:

```bash
npm run local:setup -- \
  --tunnel-id tunnel_<32-lowercase-hex> \
  --extension-id <32-char-chrome-extension-id>
```

On a fresh Mac, explicitly provide the credential file and official tunnel client:

```bash
npm run local:setup -- \
  --tunnel-id tunnel_<32-lowercase-hex> \
  --extension-id <32-char-chrome-extension-id> \
  --runtime-key-file /absolute/path/to/runtime-key \
  --tunnel-client /absolute/path/to/tunnel-client
```

Before it modifies local state, `local:setup` checks whether an existing `browser-mcp` profile already belongs to the requested Tunnel and Browser MCP launcher. A mismatch fails closed instead of partially rewriting the installation.

The command then reuses the existing installers to register the Browser Native Messaging host, install/update `com.webmcp.browser-tunnel`, and run the Local doctor.

5. In ChatGPT Developer Mode / Plugins, enable the Browser MCP app and choose **Tunnel** as its connection. Select/paste the Tunnel id printed by setup.

Normal use does not require Terminal; the Browser tunnel LaunchAgent starts automatically after macOS login.

### Diagnose

Run:

```bash
npm run local:doctor
```

The doctor is read-only. It checks the Native host manifest/launcher, Browser MCP launcher/profile, LaunchAgent state, health URL, `/readyz`, and Browser tunnel error log, then reports the first broken layer.

### Browser-only uninstall

Run:

```bash
npm run local:uninstall
```

Preview first if desired:

```bash
npm run local:uninstall -- --dry-run
```

The Expert uninstaller removes only Browser-owned manifests, launchers, LaunchAgent and `browser-mcp` profile. It deliberately preserves Native WebMCP, the Native profile/runtime key, the shared `tunnel-client`, shared `~/.local/share/webmcp` state, this repository, and unrelated Chrome extensions.

## AI-assisted setup

The current cross-component setup helper and ordered instructions are in [`setup/INSTALL-FOR-AI.md`](setup/INSTALL-FOR-AI.md). This is an AI-assisted workflow under review, not an unattended installer or a clean-Mac acceptance result.

The superseded, uncommitted Family Installer prototype (`installer/Install.command`, `scripts/onboard-macos.mjs` and its dedicated tests) was removed on 2026-09-21. Its earlier review documents are historical; use the Local Expert commands above for the supported Browser lifecycle.

## Deployment strategy

The product is currently evaluating two long-term deployment/commercial models: **Local-first** (local Browser MCP + Secure MCP Tunnel, strongest privacy, natural one-time purchase/install model) and **Hosted Relay** (public HTTPS MCP + WebSocket to the Chrome Extension, much simpler onboarding, natural subscription model, but browser content transits our VPS). A hosted-control-plane/local-data-plane hybrid is also documented as a possible later option.

See [`docs/deployment-strategies.md`](docs/deployment-strategies.md) for the architecture, privacy tradeoffs, VPS requirements, commercial model, and next decision gates. No final choice has been made; the current Local path remains valid and must not be deleted while Hosted Relay is being evaluated.

## Acceptance

1. Click the extension action; Chrome opens the Side Panel.
2. The status reaches `Connected` and the real ChatGPT UI is visible.
3. Manually send a normal message and receive a reply in the embedded UI.
4. Navigate to a conversation, close/reopen the Side Panel, and verify the route is restored.
5. Close and reopen the Side Panel and verify the embedded ChatGPT reconnects automatically.
6. If embedding recovery is triggered, verify **Retry** and **Open ChatGPT window** work from the recovery screen.

## Reference review

Before productionizing this design, we reviewed `SillySerpent/Dichrome` at commit `e927d6a12542dfeb33b275b77cc5ba9c38430632` (Apache-2.0) as a reference implementation for frame-policy handling, route persistence, reconnect/recovery, and companion-window fallback. This directory is independently structured and implemented; it does not depend on Dichrome at runtime.

## Browser WebMCP task gate

All ordinary `http(s)` pages are eligible Browser WebMCP candidates. No per-page authorization click is required.

1. Open the Side Panel and browse normally.
2. While idle, the current ordinary webpage is only a candidate.
3. The first Browser WebMCP call locks that current tab as the task target.
4. Switching browser tabs does not retarget the running task.
5. **Stop** releases the lock and returns to idle/current-page candidate mode.
6. A same-origin reload keeps the lock and reinjects the existing executor.
7. A navigation caused by a Browser WebMCP `click` may hand the task off to the resulting same-tab page, new tab, or popup. New child tabs are adopted only when Chrome reports the current task tab as their `openerTabId`.
8. Manual/unrelated cross-origin navigation still pauses instead of silently retargeting. Closing an adopted child page restores the nearest surviving parent task page when possible.

Browser WebMCP page inspection includes ordinary form controls plus semantic navigation/action targets such as links, ARIA rows, focusable elements, and editable regions. `fill` supports text inputs, textareas, and `contenteditable` textbox regions. Explicitly non-committing actions such as Reply / Reply all / Forward / Open / View may execute even when a site implements them using submit-like controls; commit-like actions such as Send remain confirmation-gated.

Browser WebMCP now enters ChatGPT through a real MCP tool lifecycle rather than a hidden conversation-text protocol. A thin Browser MCP stdio server reaches the extension through an owner-only Unix socket and Chrome Native Messaging; the service worker then reuses the existing `browser-client.js` and `target-executor.js` path. ChatGPT Web therefore owns Thinking, Called tool, tool-result presentation, completion folding, and the final answer UI.

The page interface remains the proven Browser WebMCP V1 contract. `browser-client.js`, target locking/handoff, and `target-executor.js` stay independent from the separate Native `webmcp-bridge` local-filesystem MCP server.


## Product design principles

### ChatGPT owns the conversation UI

The embedded adapter does not rewrite, hide, collapse, or synthesize conversation turns. Browser tools are real MCP tools, so ChatGPT Web renders its own Working/Thinking state, Called tool presentation, tool-result lifecycle, completion folding, and final answer exactly as it does for other native MCP calls.

The extension owns only browser execution and page-task state. It must not recreate ChatGPT's tool/thinking/completion UI.

## Side Panel UI and lifecycle

The normal toolbar is intentionally minimal:

- idle: `Ready — Current: <page>`;
- active/blocked task: `Working on: <page>` or `Paused: <page>`, plus `Stop`;
- no normal-state Inspect, Reload, or Window buttons.

Inspect was a development integration gate and is removed from production. ChatGPT iframe reload is handled by one automatic retry followed by the recovery-screen Retry action. The companion ChatGPT popup remains available only from recovery as a fallback.

`Stop` appears only while the Browser WebMCP task is locked or blocked. Native MCP does not provide the extension with a reliable final-answer callback, so the page lock remains explicit: **Stop** or closing the Side Panel releases it.

Closing the Side Panel ends the current Browser WebMCP session: the task lock is released and the ChatGPT iframe frame-policy is disabled. This does not uninstall or fully terminate the Chrome extension itself; the MV3 service worker remains event-driven and may be started again by extension/browser events. Chrome 142+ uses the official `sidePanel.onClosed` event; the panel also sends a `pagehide` cleanup signal as a compatibility fallback.

## Project boundary

This project is independent from WorkBuddy and the Native `webmcp-bridge` MCP server. Its scope is the embedded `chatgpt.com` Side Panel plus Browser WebMCP page control.

### Browser tunnel LaunchAgent ownership

`com.webmcp.browser-tunnel` is independent from `com.webmcp.native-tunnel`: the labels, plist files, tunnel profiles, tunnel ids, state homes, and logs are separate.

The Local Expert path owns the Browser-specific Native Messaging manifest/launcher, Browser MCP launcher, `browser-mcp` profile, and `com.webmcp.browser-tunnel` LaunchAgent. `npm run local:uninstall` removes those Browser-owned artifacts.

It deliberately preserves Native WebMCP's LaunchAgent/profile/runtime key, the shared `tunnel-client`, and shared `~/.local/share/webmcp` state because those assets may be reused by Native WebMCP or another local setup. Explicit `--runtime-key-file` and `--tunnel-client` inputs also remain externally owned and are preserved.

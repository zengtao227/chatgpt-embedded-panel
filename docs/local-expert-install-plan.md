# Local Expert / Privacy Setup — Implementation Plan

Date: 2026-09-20
Status: **IMPLEMENTED IN WORKING TREE — automated checks PASS; real macOS doctor/setup-rerun/ChatGPT acceptance pending.**

## Objective

Make the existing Local Browser MCP architecture reproducible for a technical user without turning it into a consumer-grade installer.

Target:

    clone repo
    -> Load unpacked extension once
    -> npm run local:setup -- --tunnel-id ... --extension-id ...
    -> select the Tunnel in ChatGPT
    -> done

Operations:

    npm run local:doctor
    npm run local:uninstall

## Existing mechanisms to reuse

- scripts/native-host-installer.mjs
- scripts/install-browser-tunnel-launchd.mjs
- scripts/activate-browser-tunnel.mjs helper logic where useful
- browser-mcp/stdio-server.js
- browser-mcp/browser-native-host.js
- current LaunchAgent/profile paths
- current readyz/error-log health surfaces

Do not create a second Browser MCP implementation.

## Proposed file delta

NEW scripts/local-setup.mjs
  - argument parsing/validation
  - preflight
  - prepare Browser MCP launcher
  - call existing Native host installer
  - call existing LaunchAgent installer
  - call doctor

NEW scripts/local-doctor.mjs
  - read-only health checks

NEW scripts/local-uninstall.mjs
  - Browser-owned teardown only

CHANGE package.json
  - local:setup
  - local:doctor
  - local:uninstall
  - syntax checks/tests

CHANGE README.md
  - one canonical Local Expert Setup
  - Family Installer V1 explicitly separate/experimental

CHANGE ROADMAP.md
  - current Local milestone status

TEST
  - input validation
  - path/ownership boundaries
  - doctor layer reporting
  - uninstall never targets Native-owned paths
  - idempotent setup planning/config generation

## Required setup inputs

--tunnel-id tunnel_<32 lower hex>
--extension-id <32 char Chrome id>

Optional:

--runtime-key-file /absolute/path
--tunnel-client /absolute/path

Never accept the runtime secret value on argv.

## Ownership model

Browser Local owns:

- com.webmcp.browser Native Messaging manifest;
- ~/.chatgpt-embedded-panel Browser launchers;
- com.webmcp.browser-tunnel LaunchAgent plist;
- browser-mcp tunnel profile;
- Browser-specific state/log directories when they were created specifically for this Browser path.

Browser Local does not own:

- com.webmcp.native-tunnel;
- Native profile;
- Native runtime API key;
- shared tunnel-client binary in developer compatibility mode;
- project source checkout.

If ownership is ambiguous, uninstall leaves the asset intact and reports it.

## Setup algorithm

1. Validate darwin, Node >=22, Google Chrome installed.
2. Validate tunnel ID and extension ID.
3. Resolve tunnel-client.
4. Resolve runtime-key-file if explicitly supplied; otherwise allow existing proven Native-profile compatibility behavior.
5. Create/update ~/.chatgpt-embedded-panel/browser-mcp-server using current process.execPath and repo stdio-server path.
6. Call installBrowserNativeHost({extensionId}) rather than duplicating its manifest logic.
7. Invoke install-browser-tunnel-launchd.mjs with explicit environment overrides when standalone Browser-owned assets are supplied.
8. Let its existing preflight prove runtime key + tunnel id + ready status before plist activation.
9. Verify resulting launchd service.
10. Run local doctor.
11. Print ChatGPT Plugins -> developer app -> Connection = Tunnel -> select/paste tunnel id.

## Idempotency

Same inputs on a healthy install must produce no destructive state reset.

Existing mismatched Browser profile must remain fail-closed; setup must not silently overwrite it.

Do not use the Family Installer's current rmSync(installRoot) behavior in this Expert path.

## Doctor output

Suggested shape:

    Local Browser WebMCP Doctor
    [PASS] Node
    [PASS] Native host manifest
    [PASS] Browser MCP launcher
    [PASS] Browser tunnel profile
    [PASS] LaunchAgent running (runs=1 pid=...)
    [PASS] /readyz = ready
    [PASS] error log empty
    RESULT: READY

On failure:

    [FAIL] /readyz
    RESULT: BROKEN AT browser tunnel readiness

Doctor does not repair.

## Uninstall algorithm

1. Read current state first.
2. bootout Browser LaunchAgent if loaded.
3. remove Browser LaunchAgent plist.
4. remove Browser Native Messaging manifest.
5. remove Browser-owned launchers.
6. remove browser-mcp profile.
7. remove Browser-specific tunnel state/log paths only when exact ownership matches.
8. leave Native and shared binary/key untouched.
9. print leftovers that were deliberately preserved.

## Validation

- npm run check green.
- local:doctor PASS on current working machine.
- local:setup rerun preserves current working state.
- real ChatGPT inspect_page still works.
- unit tests prove uninstaller never targets Native-owned files.
- README alone gives enough information for a technical user to reproduce setup.

## Deferred intentionally

- product-private Node;
- automatic tunnel-client download;
- signed/notarized installer;
- Chrome Web Store distribution;
- zero-input cross-account tunnel provisioning;
- consumer GUI updater/uninstaller.

These remain valid future work only when a real non-technical Local customer requires them.

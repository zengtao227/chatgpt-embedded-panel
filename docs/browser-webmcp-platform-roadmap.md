# Browser WebMCP Platform — Architecture and Work Roadmap

Date: 2026-09-20
Status: Planning / review. No Hosted implementation started.
Governing decision: `architecture-decision-v1.md` (2026-09-21), including A1–A3. Where they differ, that document wins.

Progress updated 2026-09-21: see [the current delivery chart](../ROADMAP.md#delivery-progress--2026-09-21). Both Side Panels are implemented; the unified helper and AI runbook passed the seven-finding review at `1fc5c13` (Panel checks 125/125). Another-Mac acceptance and release version locking remain open. The L0–L4 lists below retain the original planning detail; A1–A3 and the current chart determine present scope and status.

This is the umbrella roadmap for the Browser WebMCP work after the ChatGPT native MCP path, macOS unattended lifecycle, and DeepSeek Browser WebMCP path were proven.

## 1. Stable core

Do not redesign this layer merely because the model provider or transport changes:

    Chrome Extension
      -> task target / handoff state
      -> runBrowserTool()
      -> browser-client.js
      -> target-executor.js
      -> inspect_page / inspect_form / fill / select / click

This is the reusable Browser Execution Plane. The intelligence/host and the transport around it are replaceable.

## 2. Product tracks

### Track A — Hosted / Cloud

Target users: ordinary non-technical users and customers who want the simplest installation.

Architecture:

    ChatGPT / supported MCP host
      -> public HTTPS MCP
      -> vendor Hosted Relay
      -> authenticated WSS
      -> Chrome Extension
      -> Browser Execution Plane

Long-term client experience:

    install extension -> sign in/pair -> use

Business model: monthly / annual SaaS.

Main tradeoff: browser/tool payloads transit vendor infrastructure.

Immediate gate: minimal inspect_page Hosted Relay POC.

### Track B — Enterprise Private

Target users: organizations with private/on-prem/VPC models, organizations that cannot send browser data through vendor SaaS, and organizations with their own AI platform/agent host.

Architecture:

    customer model / customer AI agent host
      -> MCP / internal integration
      -> customer-hosted Browser Relay
      -> authenticated WSS
      -> managed Chrome Extension
      -> Browser Execution Plane

Business model: annual enterprise license plus support/professional services.

Prefer direct MCP/API integration to automating an enterprise AI webpage DOM. If the customer owns only a web AI UI, treat DOM automation as a provider-specific compatibility adapter.

### Track C — Local / Expert / Privacy

Target users: technical users, engineers who can self-manage the repository, and privacy-focused users willing to operate local components.

Architecture:

    ChatGPT
      -> OpenAI Secure MCP Tunnel
      -> local tunnel-client
      -> local Browser MCP
      -> Unix socket
      -> Chrome Native Messaging
      -> Extension
      -> Browser Execution Plane

This path is already working.

The current goal is not a zero-knowledge consumer installer. The current goal is one documented, repeatable expert setup path that can be reproduced months later without reconstructing history from old chats.

## 3. Local track — immediate cleanup plan

### L0 — records correction

Required first:

1. Update ROADMAP to record the completed 2026-09-20 reboot acceptance.
2. Remove statements that Browser LaunchAgent is foreground-only/not installed.
3. Document one canonical expert flow. Family Installer V1 was retired at `192374a`; use `setup/INSTALL-FOR-AI.md` and the existing component installers.
4. Document exactly one teardown/diagnostic location instead of relying on chat history.

Acceptance: a fresh engineer can identify the supported expert path from repository docs alone.

### L1 — one canonical expert setup command

Goal:

    clone -> load extension once -> one setup command -> select Tunnel in ChatGPT -> done

Do not add a new framework. The command should orchestrate proven mechanisms only:

1. preflight macOS / Node / Chrome;
2. verify tunnel-client;
3. verify Browser tunnel id;
4. verify runtime credential source;
5. install/update Native Messaging host;
6. install/update Browser tunnel LaunchAgent;
7. verify launchd state;
8. verify Browser /readyz;
9. print the exact remaining ChatGPT UI step.

Preferred future interface:

    npm run local:setup -- --tunnel-id tunnel_...

If deterministic Extension ID is not yet available, allow one explicit --extension-id input rather than multiple prompts.

Acceptance: setup is idempotent, does not destroy working state on a second run, and finishes with PASS/FAIL diagnostics.

### L2 — one doctor command

Goal:

    npm run local:doctor

Read-only checks:

- Native host manifest identity;
- Native Messaging launcher executable;
- Browser LaunchAgent loaded/running;
- runs/pid/last-exit;
- health URL exists;
- /readyz returns ready;
- error log empty/non-empty;
- Browser profile exists;
- paths point to expected runtime.

Doctor must not auto-repair.

Acceptance: one output identifies the exact broken layer.

### L3 — remove one remaining manual input

Highest-value candidate: deterministic Chrome Extension ID.

This removes extension-id copy/paste and makes Native Messaging binding reproducible.

Do not automatically proceed to product-private Node/tunnel-client unless Local commercial demand justifies it.

### L4 — Local packaging only if demanded

Deferred until a real customer/user requires non-technical Local:

- product-private Node;
- verified tunnel-client download;
- polished uninstaller;
- non-destructive upgrade;
- zero-input tunnel provisioning;
- signed/notarized helper.

## 4. Hosted / Cloud work plan

### H0 — design review

Review docs/hosted-relay-enterprise-architecture.md. Classify review comments as correctness blocker, security blocker, external-platform requirement, or optional future work.

### H1 — single-device inspect_page POC

Implement only:

    ChatGPT
      -> public Streamable HTTP MCP
      -> one Relay process
      -> authenticated WSS
      -> Extension
      -> existing runBrowserTool()
      -> inspect_page
      -> response

Non-goals: billing, account portal, Redis, database unless proven necessary, Kubernetes, multi-tenant UI, autoscaling, target-executor changes.

Acceptance: a real ChatGPT call reaches the browser and returns the target result; reconnect works; Local remains working; page/form contents are absent from server logs.

### H2 — actual target-plan action capability

After inspect_page passes, test one reversible action on the actual ChatGPT plan/workspace intended for the product and confirm whether the full five-tool surface is supported.

### H3/H4 — authentication and multi-user isolation

Only after single-device transport passes: MCP-side authorization, device pairing, short-lived WSS session credentials, tenant-bound connections, call ownership, replay rejection, per-device serialization, and content-free operational logging.

## 5. Enterprise Private work plan

### E1 — local/private model proof

    private model -> Agent Host/MCP client -> Browser MCP -> Extension -> inspect_page

Do not require ChatGPT or OpenAI Tunnel.

### E2 — customer-hosted Relay

Reuse the Hosted Relay data plane inside a customer VPC/on-prem environment. Browser payload must not transit vendor infrastructure.

### E3 — customer AI webpage compatibility

Only if a customer cannot provide API/MCP. Treat each AI webpage as a provider adapter, not as the core architecture.

## 6. DeepSeek work stream

Verified constraints:

- direct DeepSeek in Chrome Side Panel: failed;
- fully hidden/background DeepSeek tab: generation runs but answer DOM does not render;
- selected DeepSeek tab in a second non-minimized window: PASS;
- that window can be completely covered and unfocused while answer DOM continues to render: PASS.
- CORRECTION 2026-09-21: not reproducible in the P6 live test — a fully covered provider window goes hidden on macOS; it renders while any strip stays uncovered (see `<workspace>/deepseek-webmcp/docs/p6-live-test.md`, finding 1). Product rule: keep a strip uncovered.

Completed implementation (2026-09-21 closeout; baseline `main`, `b3a1b14`): provider-window lifecycle, local extension Side Panel UI, reasoning/final-answer presentation and tool activity display. ChatGPT and DeepSeek Side Panels are parallel products over the existing execution capability.

Remaining delivery work: another-Mac AI-assisted installation acceptance and release version locking. Keep a strip of the provider window visible. Real webmail body filling remains a known shared-executor limitation pending investigation; implementation completion does not claim all live scenarios passed. See `release-inventory-v1.md` for the exact evidence and gaps.

See <workspace>/deepseek-webmcp/docs/p6-compact-assistant-roadmap.md.

## 7. Priority order

Superseded 2026-09-21 by `docs/architecture-decision-v1.md` §3 (governing architecture, alignment checklist, and stages 0-4). Summary (as amended by A1–A3): one AI-assisted installation entry (release inventory -> helper/runbook -> another-Mac acceptance), followed by Browser MCP model extension (local/company models, company web-AI). Non-technical distribution starts with DeepSeek. ChatGPT Tunnel serves technical users; non-technical ChatGPT requires the separate Hosted feasibility and implementation gates. Hosted H1 and later, Enterprise E1-E3 keep their definitions above.

Local consumer packaging is no longer deferred (L4 trigger met); billing, Redis/Kubernetes, and broad provider abstractions remain deferred.

## 8. Stop conditions

Stop each phase when its acceptance criterion is satisfied. Do not redesign the Browser Execution Plane while fixing deployment, add future-provider abstractions before a second real implementation requires them, add cloud infrastructure before the Hosted single-device POC passes, polish Local consumer onboarding before demand exists, or attempt to bypass DeepSeek visibility/challenge behavior already established empirically.

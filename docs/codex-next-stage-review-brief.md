# Codex Review Brief — Next Stage Execution Plan

Date: 2026-09-20
Scope: review only. Do not implement, commit, push, reset, clean, or overwrite uncommitted work.

## Repositories

1. <workspace>/deepseek-webmcp
2. <workspace>/chatgpt-embedded-panel

Read AGENTS.md where present and inspect current git status/diff before reviewing.

## Primary plan

<workspace>/chatgpt-embedded-panel/docs/next-stage-execution-plan.md

Supporting docs:

- <workspace>/deepseek-webmcp/docs/p6-compact-assistant-roadmap.md
- <workspace>/deepseek-webmcp/docs/sidepanel-architecture-review.md
- <workspace>/deepseek-webmcp/tests/hidden-deepseek-spike/README.md
- <workspace>/chatgpt-embedded-panel/docs/local-expert-install-plan.md
- <workspace>/chatgpt-embedded-panel/docs/hosted-relay-enterprise-architecture.md
- <workspace>/chatgpt-embedded-panel/docs/hosted-relay-review.md
- <workspace>/chatgpt-embedded-panel/docs/browser-webmcp-platform-roadmap.md

## Required review order

### Review A — Phase 1 DeepSeek

Question: can the proposed P6 implementation be completed as a bounded change without breaking existing P1-P5, Browser WebMCP V1, or the local runtime security boundary?

Check specifically:

1. Provider-window creation/reuse/restore lifecycle.
2. Correct Chrome Side Panel user-gesture requirements.
3. Whether focused:false + explicit refocus is sufficient for the proposed window flow.
4. One authoritative work-tab/provider-tab session and no silent retargeting.
5. Safe extraction of DeepSeek-visible reasoning and final answer.
6. Side Panel state reconstruction after document/service-worker lifecycle changes.
7. Whether existing sendText/interceptSend can be factored minimally for panel prompts.
8. Whether tool activity can be aggregated from existing background state without a second tool protocol.
9. Whether any part of P6 unnecessarily changes one-call-per-reply, Native runtime security, browser-client.js or target-executor.js.
10. Whether any currently proposed timer rewrite should be deferred until a real failure occurs.
11. Exact missing tests and live acceptance blockers.
12. If the full Phase 1 scope is too large for one implementation batch, separate must-have blockers from optional polish without changing the product architecture.

### Review B — Phase 2 Local

Question: is local:setup + local:doctor + local:uninstall the smallest complete expert workflow around existing mechanisms?

Check specifically:

1. Reuse versus duplication of native-host-installer and LaunchAgent installer.
2. Idempotency and mismatched-config fail-closed behavior.
3. Runtime-key secrecy: no secret on argv/logs.
4. Browser-vs-Native ownership boundaries.
5. Whether uninstall can accidentally remove Native WebMCP/shared tunnel-client/key.
6. Whether using current system Node is acceptable for the explicitly technical Expert path.
7. Whether deterministic Extension ID should remain deferred until a permanent Web Store identity exists.
8. Missing setup/doctor/uninstall tests.
9. Whether README can become genuinely canonical with no hidden chat-only steps.

### Review C — Phase 3 Hosted Platform

Claude already found two blockers and several hardening items. Verify that the revised plan resolves them before code starts.

Required decisions to review:

1. Hosted connection is owned by explicit Browser Control session, not Side Panel visibility.
2. Idempotent ensureTransport re-arms after service-worker restart.
3. Extension and Relay both serialize Browser calls.
4. Hosted bridge bounds/dedupes/replay-protects call IDs.
5. Hosted privacy boundary includes error objects and strips page-derived error.details before WSS when unnecessary.
6. Timeout layers are staggered.
7. POC credential cannot leak through reverse-proxy URL/access logs.
8. Official MCP SDK is used for public HTTP edge; local stdio server is left unchanged.
9. POC remains inspect_page-only until transport works.
10. Local path remains regression-tested.

## External-source rule

For Chrome API/service-worker claims, use current official Chrome documentation.
For OpenAI Secure MCP Tunnel, ChatGPT plugin/MCP, authentication and publication claims, use current official OpenAI documentation.
For MCP protocol/SDK claims, use current official MCP specification/SDK material.

Do not treat an undocumented recommendation as a blocker.

## Output format

For each finding provide:

- Severity: Blocker / Design gap / Hardening / Confirmed.
- Phase: DeepSeek / Local / Hosted.
- Exact repo file:line evidence.
- Concrete failure or external requirement.
- Smallest recommended change.
- Whether it must be fixed before that phase starts or can wait.

Then provide:

1. Phase 1 verdict: ready to implement today / not ready, with only true blockers.
2. Phase 2 verdict: ready after Phase 1 / not ready, with only true blockers.
3. Phase 3 verdict: design ready after listed prerequisites / not ready.
4. A final minimal ordered implementation checklist.

Do not implement anything during this review.

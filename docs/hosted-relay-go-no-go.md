# Hosted Relay — Go / No-Go for the Non-Technical ChatGPT Path

Date: 2026-09-21. Status: **evaluation for owner + Codex review; nothing built, nothing deployed, no VPS touched.**
Question (amendment A2, `architecture-decision-v1.md` §9): should Hosted Relay (owner's VPS + domain; ChatGPT -> public HTTPS MCP -> relay -> authenticated WSS -> Chrome extension) start now as the non-technical-user path for the ChatGPT half?

Evidence labels: **[repo]** file:line read this session; **[official]** page fetched this session; **[registry]** the owner's private infrastructure notes read this session (not published); **[unverified]** not checked or not checkable here; **[judgement]** my estimate.

## 0. Verdict

**GO-WITH-CONDITIONS — for H1 only** (one user = the owner, own Mac, own VPS, `inspect_page`), **NO-GO for any second person** until the section 3 minimum exists. Conditions in section 8. The decisive facts: the extension-side preconditions are all still unimplemented, the plan-capability question (H2) is unanswered and the sources conflict, and the step from H1 to a second user is a cliff (OAuth 2.1 authorization server, pairing, tenant isolation), not a slope.

## 1. Preconditions already adopted vs open

Sources: `hosted-relay-enterprise-architecture.md` §6, §9, §10, §20; `hosted-relay-review.md`; `next-stage-execution-plan.md` Phase 3.

| Item | Status | Evidence |
|---|---|---|
| Seam `runBrowserTool()` is transport-neutral; `connectChromeNativeBridge` already takes it as a parameter | **Resolved** (design correct) | [repo] `service-worker.js:246`, `chrome-native-bridge.js:19-24`; review Q1 |
| `browser-native-protocol.js` reusable verbatim (no `chrome.*`) | **Resolved** | [repo] `browser-native-protocol.js` 45 lines; review Q8 |
| Plan decisions P0-A…P0-F (explicit armed session, `ensureTransport()`, single-flight, wire hardening, error.details stripping, capability-log hygiene) | **Adopted in docs, none implemented** | [repo] no `ensureTransport`, `onStartup`, `chrome.alarms` anywhere; `manifest.json` permissions lack `alarms`; `startPanelSession()` (`service-worker.js:66-72`) is still the only place the bridge is created |
| Bridge re-arm after service-worker restart | **Open (Blocker for H1 criterion 7)** | [repo] review Q2; module-scope `browserNativeBridge` `service-worker.js:23` |
| Extension-side single-flight | **Open** | [repo] `runBrowserTool` `service-worker.js:246` has no queue; local path already allows concurrency (`unix-bridge.js:35` socket per call, per review Q4) |
| `error.details` carries page text (button labels) into the wire | **Open** | [repo] `target-executor.js:402-413`, `browser-native-protocol.js:43` spreads it; review Q7 |
| Auth for the public MCP link | **Open, undecided** (POC capability vs OAuth) | arch §9 |
| Plan/capability gate H2 | **Open** | arch §12 vs section 2 below (sources conflict) |
| Codex review of the Phase 3 plan (arch §20: "must not start until Codex reviews") | **No review result found in the repo** [repo: `docs/` has only Claude reviews]. The owner has now asked to build and have Codex review alongside; this waives that gate by owner instruction and should be stated as such to Codex. |

## 2. What OpenAI officially allows (fetched this session)

| Question | Answer | Source |
|---|---|---|
| Custom MCP connector to a public HTTPS URL? | Yes: enable Developer mode (Settings > Security and login), Plugins > plus, enter name, description and the MCP URL **including `/mcp`**, create, review discovered tools. Server must be reachable via a public HTTPS endpoint. | [official] developers.openai.com/plugins/deploy/connect-chatgpt |
| Plans | "Available to Pro, Plus, Business, Enterprise, and Education accounts on the web." Availability "can depend on account and workspace policy". | [official] developers.openai.com/api/docs/guides/developer-mode; connect-chatgpt |
| Transports | SSE and streaming HTTP (server docs: "support the MCP streamable HTTP transport", typically `/mcp`). | [official] developer-mode guide; plugins/build/mcp-server |
| Auth options | "OAuth, No Authentication, and Mixed Authentication"; CIMD, DCR, PKCE S256; protected resource metadata at `/.well-known/oauth-protected-resource`; token `aud` must be verified. | [official] developer-mode guide; plugins/build/auth |
| Write actions | "Write actions by default require confirmation"; approval may be remembered within a conversation; new conversations prompt again. Some risky actions may be blocked. | [official] developer-mode guide; search snippet of the help article |
| Tool annotations | `readOnlyHint`, `destructiveHint`, `openWorldHint` are hints, not a substitute for server-side validation. | [official] plugins/build/mcp-server |
| Limits (tool count, timeout) | Not stated. | [official] |
| After changing tools/schemas | Must Refresh the connection in Plugins and start a new conversation. | [official] connect-chatgpt |
| Public plugin distribution | Needs a public HTTPS MCP endpoint; Secure MCP Tunnel does **not** support public distribution. | [official] plugins docs; secure-mcp-tunnels (fetched earlier this session) |

**H2-lite update (2026-09-21, read through the owner's logged-in Chrome; the Help Center article no longer returns 403 there):** the Help Center article "Developer mode and MCP apps in ChatGPT" (updated last month) says full MCP including write/modify actions is in beta for **Business and Enterprise/Edu** on web; its FAQ answers "Are apps and full MCP beta available to Pro users?" with "Full MCP is only available to Business and Enterprise/Edu users, currently. Pro users can connect MCPs with read/fetch permissions in developer mode." Plus is not mentioned. It also says agent mode does not use custom apps, and deep research uses them read-only. So the two official pages still disagree (this one is the product-facing page and the more restrictive), and the presumption for a Plus or Pro recipient must be **read-only public connectors**, which would make `fill`/`select`/`click` unavailable on the Hosted path for them. The owner's own account shows **Plus**. Only `inspect_page` has ever been run from ChatGPT on the Tunnel path (ROADMAP live gate 2026-09-20); write tools have not been run from ChatGPT on this plan, so whether a Plus account can write through the private Tunnel path is also unrecorded. **Result of step (1), 2026-09-21: PASS** — on the owner's Plus account over the Tunnel path, `fill` wrote to a form (httpbin echo confirmed) and the assistant left Submit to the owner (`architecture-decision-v1.md` A3). Still open: (2) a write-annotated tool through a **public-URL connector** on Plus; only that answers H2 for the Hosted path.

**Earlier conflict statement (superseded above):** the architecture doc §12 (written 2026-09-20) says full MCP write support is "rolling out for Business and Enterprise/Edu" and Pro is read/fetch. The current developer-mode guide says "full MCP client support for all tools, both read and write" for Pro/Plus/Business/Enterprise/Edu. The Help Center article itself returned HTTP 403 to this session, so the conflict is unresolved. H2 must be settled by a live test on the actual recipient plan, not by reading docs.

**Plainly manual, per user, forever (even under Hosted):** turn on Developer mode; add the connector (name, description, URL); complete the OAuth login/consent; confirm write actions per conversation; Refresh + new conversation after any tool change. Removing these needs a published (reviewed) plugin, which is a separate track.

## 3. Multi-user isolation and auth: smallest viable design

Threat: a relay that lets ChatGPT drive a user's **browser** (broad `http(s)://*/*` host permissions, `manifest.json:13-16`). A leak or bug is not a data leak of one file; it is remote read/fill on whatever tab the victim has focused (review Finding 3).

**Must exist before ANY second person connects** (each is testable):

| # | Requirement | Test / evidence |
|---|---|---|
| 1 | Per-user identity taken from an OAuth 2.1 access token (PKCE S256, DCR or CIMD, resource metadata, `aud` bound to the relay); never from a client-supplied device id | token A cannot reach device B (negative test with two users) |
| 2 | Device pairing: user signs in, extension shows/consumes a one-time code, relay stores `{user, device, credential hash}` | replayed/expired code rejected |
| 3 | WSS: authenticate on first frame, short-lived session credential, closes fast on failure | unauthenticated socket gets no calls |
| 4 | Tenant-bound immutable connection context; pending-call map keyed by `(device, call_id)` (arch §10.1-10.4) | late/unknown/replayed results discarded |
| 5 | Armed Browser Control: relay cannot call while the user has not armed; **extension enforces**, not only the relay | disarm blocks the next call |
| 6 | Single-flight on both sides; UUID call ids; in-flight duplicate rejected; response size bound; timeouts ordered executor < extension < relay < client | review Q4, Q6 |
| 7 | Content-free logs: request, result **and error** bodies never logged; proxy access logs never contain secrets or paths that identify content | fixture: a blocked-click button label never reaches the log sink |
| 8 | Origin checks on the MCP endpoint and on the WS handshake; rate limits; revocation (user disarm + owner revoke-device switch) | manual + unit |
| 9 | Authorization server: an off-the-shelf OAuth 2.1 AS that supports what ChatGPT requires (DCR/CIMD, PKCE, discovery); do not hand-roll a protocol | **[unverified]** which product; must be checked against the auth page above |

**Smallest H1 shortcut (owner only):** one 256-bit device secret between relay and the owner's extension (arch §9), and for the MCP link either a client-supported Authorization mechanism or a capability path that is provably absent from proxy and app logs (P0-F). The connector UI's ability to send a header under "No Authentication" is **[unverified]**. **Family exception** (not recommended as default): per-user capability URLs for two or three known people could replace OAuth, but only if the owner explicitly accepts that a leaked URL lets someone drive that person's browser; this contradicts the adopted rule ("OAuth before any external user or write tool", arch §9, §20) and needs the owner's written decision.

## 4. Privacy and liability

Page text, form contents, fill payloads, action targets and **error objects** all transit the VPS (arch §2 "Privacy tradeoff", review Q7). What must be told to users before their first pairing:
- Hosted mode sends the content of pages you let the assistant read through the operator's server (and any proxy in front of it); it is not "local-only". Zero-retention design does not mean the server cannot observe it (arch §10.7).
- What is stored (device/user metadata only), what is not (page content), how to revoke, that the assistant cannot press commit-like buttons (`target-executor.js:360-400`).
- Cloudflare: if the relay hostname were Cloudflare-proxied, TLS would terminate at Cloudflare and content would be visible to a third party. The relay hostname should be DNS-only, or the proxy must be disclosed.
Logging rule: request/result/error bodies never logged at proxy or app; secrets never in paths logged by Caddy; metadata-only security events.

## 5. Where it would run

The host choice and its facts are kept in the owner's private infrastructure notes and are deliberately not published. Requirements for the H1 host:

- an isolated host with spare capacity that does **not** also run a VPN gateway, trading workloads or customer data, or, if it must share a host, strict isolation: a dedicated unprivileged user and systemd unit, a loopback port, its own reverse-proxy site block, no shared secrets, a separate log directory;
- a DNS-only hostname (no CDN proxy in the content path); the reverse proxy issues the certificate;
- a real registered domain before anyone else depends on it (a free-domain provider name is acceptable for H1 on the owner's own machine);
- any change to a production host is a production operation: notes first, backups, the owner's explicit approval.

Ops cost [judgement]: about zero incremental for H1 on an existing host; recurring cost is owner time (patching, monitoring, incident response, abuse handling).

## 6. Extension-side work (concrete items) [repo sizes; effort = judgement]

Base: `service-worker.js` 536 lines, `chrome-native-bridge.js` 73, `browser-native-protocol.js` 45, `browser-client.js` 84; `target-executor.js`, target/handoff state machine unchanged.

| # | Item | Notes |
|---|---|---|
| E1 | `hosted-websocket-bridge.js`: WSS connect, auth frame, 20 s keepalive, backoff reconnect; reuses `browser-native-protocol.js` | Chrome >= 116 lets WebSocket traffic extend an MV3 worker; idle timeout 30 s; 20 s keepalive suggested; **no reconnection guidance** in the doc [official: developer.chrome.com WebSockets page] |
| E2 | `ensureTransport()` + persisted "armed" state + `onStartup` + `chrome.alarms` wake (add `alarms` to `manifest.json`) | P0-B; state must survive worker restart and not resurrect after browser restart without consent |
| E3 | Single-flight promise chain in `runBrowserTool()` | P0-C; also fixes the latent local concurrency |
| E4 | Wire hardening: UUID ids, in-flight dedupe, size bounds, strip `error.details` | P0-D/E |
| E5 | Arm/Disarm UI (extension action + panel status) as the consent surface | product decision needed on wording |
| E6 | Pairing + credential storage | H3, not H1 |
| E7 | Tests: node:test with an in-process relay and fake `chrome` (templates: `tests/browser-mcp-socket-poc.test.js`, `browser-native-host-poc.test.js`) | |

Relay side: R1 official MCP SDK Streamable HTTP edge with one tool (`hosted-relay-review.md` Q3; SDK version **[unverified]**), R2 WS endpoint + device auth, R3 pending-call map, single-flight, staggered timeouts, R4 content-free logging, R5 systemd + Caddy vhost.
Effort [judgement]: H1 is small-to-medium (relay a few hundred lines; extension a few hundred lines plus tests; several focused sessions). H3 (OAuth AS, pairing, multi-tenant, ops) is a multiple of H1 and is where the real cost is.

## 7. Local coding (Native/Docker) under this path

A relay cannot reach into a user's Mac; it would need an **outbound local agent** holding a WSS to the relay and forwarding Native's five tools (`read`, `write`, `edit`, `bash`, `open_workspace`) into the container. That makes relay compromise equal remote code execution on the user's machine, inverts Native's design boundary (immutable host runtime, source gate, Secret Firewall; `webmcp-bridge/CONTEXT.md`), and has no threat model yet. **Defer.** Non-technical local coding stays with DeepSeek (local Docker, no relay) and the expert Tunnel path for ChatGPT.

## 8. Case against starting now, then the decision

Strongest arguments **against**:
1. **Demand is unquantified.** The audience is "non-technical ChatGPT users"; the DeepSeek half already serves non-technical users with no tunnel, no VPS, no paid plan. A ChatGPT user still needs a paid plan, Developer mode, connector creation, OAuth and per-conversation confirmations (section 2): Hosted removes tunnel-client/Node/LaunchAgent/Native Messaging, not those steps.
2. **The value hinges on H2, which is unknown and documented inconsistently** (section 2).
3. **Irreversible trust commitment:** a public service that drives users' browsers, on infrastructure that also runs other private services, run by one person; the browser-facing attack surface (broad host permissions, header-stripping to embed chatgpt.com, Chrome Web Store review) all lands on the operator.
4. **Every extension precondition is unbuilt**, the Codex gate has no recorded result, and H3 (auth, pairing, isolation) dwarfs H1.
5. It competes with the in-flight DeepSeek finish and the unified installer for the same attention.

Why still GO for H1: it answers the single technical question cheaply (does the execution plane survive a WSS transport), reuses proven seams, costs almost nothing to run, and its output (armed session, single-flight, wire hardening) also fixes latent defects in the Local path. What stops at H1 is any second user.

**Conditions:**
- **C1 (before writing relay code):** H2-lite. Run one reversible `fill`/`select` and one gated `click` from ChatGPT on the **actual recipient plan** using the existing Tunnel path, and separately confirm a public-URL connector accepts a write-annotated tool. Cheap, and it can kill the project early.
- **C2:** implement P0-A…P0-F inside H1; do not carry them to H3.
- **C3:** state to Codex that its review runs alongside implementation by owner instruction (the arch doc's "must not start until Codex reviews" gate is waived), and give it this document plus the H1 acceptance below.
- **C4:** host isolation plan in section 5, DNS-only hostname, owner approval for each production change.
- **C5 (decision gate before H3):** count named non-technical ChatGPT users and their plans; if none or read-only, stop at H1 and keep DeepSeek as the non-technical path.
- **C6:** no second person, no write tool exposed beyond the owner, until the section 3 table passes.

**Smallest first deliverable (H1) and acceptance** (subset of `next-stage-execution-plan.md` §3.3):
1. ChatGPT connector to the relay lists `inspect_page`.
2. Armed extension holds a WSS; an `inspect_page` call returns the page result to ChatGPT.
3. Closing the Side Panel does not drop an armed session; disarm blocks the next call at both relay and extension.
4. Service-worker restart and socket loss both recover while armed.
5. Two simultaneous calls are serialized; a replayed call id is rejected.
6. A page-body fixture and a blocked-click button-label fixture never appear in relay logs or on the wire (`error.details` stripped).
7. Local Native path still passes `npm run check` and a real `inspect_page`.

## 9. Top 5 risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Plan capability (H2) unknown/conflicting; product may be read-only on some plans | C1 before code; C5 gate |
| 2 | Trust and blast radius: page content on the owner's VPS, co-tenancy with other private services, possible Cloudflare visibility | isolation, DNS-only host, disclosure, content-free logging, real domain |
| 3 | Auth cliff: a proper OAuth 2.1 authorization server plus pairing before a second user | section 3 table is the entry gate; off-the-shelf AS; no second user before it |
| 4 | MV3 service-worker lifecycle: armed sessions must survive termination and not silently re-arm | `ensureTransport()` + alarms + explicit consent state; live restart test |
| 5 | ChatGPT-side friction and policy: Developer mode, connector setup, per-conversation write confirmations remain manual; Chrome Web Store review of broad permissions; framing chatgpt.com | set expectations honestly in onboarding; keep window fallback; treat store review as a Stage 4 item |

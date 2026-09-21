# Hosted Relay + Enterprise Private AI Architecture

Date: 2026-09-20
Status: **Design for review — no implementation started.**

This document records the current product and architecture direction for ChatGPT Embedded Panel after the Browser WebMCP execution chain and both macOS LaunchAgents were proven working.

It is intended for design review by another engineer/agent before any Hosted Relay implementation begins.

---

## 1. Verified baseline

### Browser execution chain

The core browser execution path is already proven and is **not** the part being redesigned:

```text
ChatGPT native MCP
  -> Browser transport
  -> Chrome Extension
  -> browser-client.js
  -> target-executor.js
  -> inspect_page / inspect_form / fill / select / click / scroll
```

Current code boundaries:

- `browser-client.js`
  - validates exactly six Browser tools;
  - sends bounded tool calls to the locked webpage executor.
- `target-executor.js`
  - performs webpage inspection and bounded interactions.
- `service-worker.js`
  - owns current-page selection, task locking, navigation handoff, and `runBrowserTool()`.
- `chrome-native-bridge.js`
  - is a thin transport adapter from Chrome Native Messaging into `runBrowserTool()`.
- `browser-mcp/server.js`
  - currently exposes the Browser tools through a small hand-written MCP 2025-06-18 server.
- `browser-mcp/stdio-server.js`
  - connects that MCP server to the existing Unix bridge.

The core design rule remains:

> Change transport and model-provider integration around `runBrowserTool()`; do not rewrite `browser-client.js`, target locking/handoff, or `target-executor.js` without a demonstrated correctness blocker.

### macOS unattended lifecycle

Host-side reboot validation completed on 2026-09-20:

```text
kern.boottime:
Sun Sep 20 13:36:30 2026

com.webmcp.native-tunnel:
state = running
runs = 1
pid = 1774
last exit code = never exited
process start = Sun Sep 20 13:48:35 2026

com.webmcp.browser-tunnel:
state = running
runs = 1
pid = 1794
last exit code = never exited
process start = Sun Sep 20 13:48:35 2026

Browser /readyz:
ready

webmcp-browser-tunnel.err:
0 bytes
```

Conclusion:

- Native LaunchAgent reboot/login auto-start: **PASS**.
- Browser LaunchAgent reboot/login auto-start: **PASS**.
- Browser tunnel readiness: **PASS**.
- KeepAlive restart-loop check: **PASS**.

The approximately 12-minute gap between kernel boot and agent start is compatible with per-user LaunchAgents starting at the user's GUI login rather than at kernel boot.

---

## 2. Product direction

The earlier Local-vs-Hosted framing should now be expanded into two independent axes:

### Axis A — where the Browser transport runs

1. **Vendor-hosted Relay**
   - our public HTTPS MCP endpoint;
   - our WebSocket relay;
   - user's Chrome Extension;
   - browser content transits our infrastructure.

2. **Customer-hosted Relay**
   - same logical relay deployed in the customer's VPC/on-prem environment;
   - customer controls the data plane;
   - browser content does not need to transit our infrastructure.

3. **Developer-local**
   - existing local Browser MCP / Native Messaging path;
   - technical users self-manage from the repository and documentation.

### Axis B — who provides the intelligence

1. ChatGPT / OpenAI.
2. Customer's local or private-cloud model through an API/agent host.
3. Customer's own MCP-capable AI host.
4. Customer's internal AI webpage through an explicit web adapter.
5. A third-party AI webpage through a DOM adapter only as a last resort.

This leads to a better product abstraction:

```text
Intelligence / Agent Host
        |
        | MCP or explicit adapter
        v
Browser Tool Gateway / Relay
        |
        | Native Messaging, local IPC, or authenticated WSS
        v
Chrome Extension
        |
        v
runBrowserTool()
        |
        v
browser-client.js
        |
        v
target-executor.js
        |
        v
webpage
```

The durable asset is the **Browser Execution Plane**, not the current ChatGPT-specific transport.

Do not rename the project or refactor the code around this abstraction yet. The abstraction is a product/design boundary, not a request for speculative code.

---

## 3. Revised product segmentation

### 3.1 Hosted / Cloud Edition — mainstream non-technical users

Target experience:

```text
Install Chrome Extension
-> Sign in / Pair device
-> Enable the ChatGPT app/plugin
-> Use
```

Target architecture:

```text
ChatGPT
  -> public HTTPS MCP endpoint
  -> Hosted Relay
  -> authenticated WebSocket
  -> user's Chrome Extension
  -> existing Browser execution plane
```

Natural commercial model:

- monthly subscription;
- annual subscription;
- optional higher tier for teams.

Primary benefit:

- no local Node;
- no local `tunnel-client`;
- no OpenAI Secure MCP Tunnel on the user's Mac;
- no LaunchAgent;
- no Unix socket;
- no Native Messaging in the eventual Cloud build;
- no local MCP process.

Primary cost:

- browser page content, form values, tool arguments, and results transit our server;
- recurring availability/security/operations responsibility;
- tenant isolation becomes a product correctness requirement.

### 3.2 Local / Expert / Privacy — technical users

Current position:

- keep the existing working local path;
- keep current Installer V1 work;
- do not delete anything;
- pause consumer-grade Local installer investment.

Expected user:

- advanced engineer;
- privacy-focused technical user;
- developer evaluating the product;
- customer who can operate the repository themselves.

Expected flow:

```text
clone repo
-> read setup docs
-> create/configure own Secure MCP Tunnel
-> install local Browser components
-> run
```

We do **not** currently need to finish:

- zero-question installer;
- automatic Node provisioning;
- automatic tunnel-client provisioning;
- consumer GUI uninstaller;
- consumer GUI health checker;
- cross-account Tunnel provisioning;
- zero-input ChatGPT Tunnel picker setup.

Those become demand-driven work rather than prerequisites for the main product.

### 3.3 Enterprise / Private AI — customer-controlled intelligence and data plane

This should be treated as a first-class future deployment, not as a special case of the consumer Local installer.

A large customer may require:

- model inference on-prem;
- model inference in its own VPC/private cloud;
- no browser content through our SaaS;
- enterprise IdP/RBAC;
- internal-only network paths;
- a customer-managed relay.

Target architecture:

```text
Customer AI / Agent Host
       |
       | MCP / internal API
       v
Customer-hosted Browser Relay
       |
       | authenticated WSS
       v
Managed Chrome Extension
       |
       v
existing Browser execution plane
```

This reuses almost the same Relay design as Hosted / Cloud, but the relay is deployed inside the customer's trust boundary.

Natural commercial model:

- annual enterprise license;
- support/maintenance;
- customer-managed deployment;
- optional professional services.

This is strategically stronger than forcing enterprise users through our SaaS data plane.

---

## 4. Can a local/private model use Browser WebMCP?

**Yes, and if the model is available through an API or an MCP-capable host, this can be simpler than the current ChatGPT path.**

Important distinction:

> The model itself does not need to implement MCP. The **agent host** around the model needs to know how to call tools/MCP.

MCP's architecture explicitly separates hosts, clients, and servers. A Browser tool server can therefore be used by ChatGPT, Claude-like hosts, IDE agents, or a customer-built application without changing the Browser executor.

### Preferred enterprise path

```text
Local/private LLM API
      ^
      |
Enterprise Agent Host
      |
      | MCP client
      v
Browser MCP tools
      |
      v
Extension
```

If the Enterprise Agent Host runs on the same workstation, the OpenAI-specific Secure MCP Tunnel disappears completely.

Possible local form:

```text
Enterprise Agent Host
  -> Browser MCP stdio
  -> local Browser bridge
  -> Chrome Extension
  -> webpage
```

This is simpler than:

```text
ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> tunnel-client
  -> Browser MCP
  -> local Browser bridge
  -> Extension
```

because the enterprise host can launch or connect to the Browser MCP directly.

### What remains local

A local-model integration still needs a safe way for a normal process/agent to reach the Extension.

The existing Native Messaging + local bridge already solves that problem. There is no reason to replace it just because the model changes.

Later, if evidence shows Native Messaging is undesirable for a managed enterprise deployment, the customer-hosted WSS relay can replace it.

---

## 5. What if the enterprise has its own AI webpage?

There are three materially different cases.

### Case A — they own the web application and can change it

This is the best web-UI case.

Do **not** automate their AI webpage DOM if the customer can provide an explicit integration.

Preferred options, in order:

1. Make their AI backend/host call MCP tools directly.
2. Add an explicit browser-extension integration using a defined message protocol.
3. Use a customer-hosted relay between the AI application and the Extension.

If they want their AI webpage shown in a side panel, ask the customer to configure its own CSP/frame policy to allow the managed extension. Do not generalize the current ChatGPT header-stripping behavior to arbitrary enterprise domains.

### Case B — they expose an API but not MCP

Still straightforward.

Add a small enterprise Agent Host:

```text
Enterprise AI API
<-> Agent Host
<-> Browser MCP
```

The Agent Host owns:

- conversation state;
- model calls;
- tool schemas;
- MCP client behavior;
- tool-result injection back to the model.

This is normally preferable to webpage automation.

### Case C — they expose only a web UI and it cannot be changed

Possible, but it is the least desirable integration.

A provider-specific DOM adapter can:

- read the AI webpage;
- detect model/tool instructions;
- inject tool results;
- send/continue messages.

This is similar in spirit to the earlier DeepSeek WebMCP experiments.

Costs:

- brittle selectors and UI semantics;
- breakage on frontend changes;
- more browser lifecycle edge cases;
- harder security review;
- more provider-specific maintenance.

Therefore:

> Web-only model adapters are compatibility adapters, not the core architecture.

If an enterprise owns the model or application, prefer an explicit API/MCP integration.

---

## 6. Hosted Relay POC — exact goal

The first Hosted implementation should answer only one technical question:

> Can the existing Browser execution plane reliably execute a ChatGPT MCP call when Native Messaging/Unix transport is replaced by a remote authenticated WebSocket relay?

POC flow:

```text
ChatGPT
   |
   | Streamable HTTP / MCP
   v
https://poc.example.com/<ephemeral-secret>/mcp
   |
   v
single Hosted Relay process
   |
   | authenticated WSS
   v
current Chrome Extension
   |
   v
runBrowserTool()
   |
   v
inspect_page
   |
   v
target-executor.js
   |
   v
result -> Relay -> ChatGPT
```

### POC success criteria

Required:

1. ChatGPT scans the MCP endpoint successfully.
2. `inspect_page` appears as a tool.
3. Extension establishes WSS connection.
4. One `inspect_page` call reaches the existing `runBrowserTool()`.
5. Existing target binding/executor produces the result.
6. Result returns to ChatGPT through the same MCP request.
7. Disconnect/reconnect works after Extension service-worker restart.
8. No browser page body or form value is written to application logs.
9. Existing Local/Native path remains unchanged and usable.

Recommended immediately after first PASS:

10. Validate one reversible non-commit action on the target ChatGPT plan/account, because OpenAI's current public documentation distinguishes read/fetch support from full write/modify MCP support by plan/workspace.

### POC non-goals

Do not build:

- billing;
- subscriptions;
- Redis;
- Kubernetes;
- queues;
- microservices;
- autoscaling;
- multi-region;
- admin portal;
- full customer account system;
- production OAuth;
- enterprise SSO;
- device fleet management;
- target-executor rewrite;
- Browser tool redesign.

---

## 7. POC server design

### 7.1 One process

Use one Node service on one normal VPS.

```text
Caddy/Traefik/Nginx
   |
   +--> /<secret>/mcp   -> MCP handler
   |
   +--> /ws             -> WebSocket handler
```

No GPU.

Initial VPS remains reasonable at:

- 2 vCPU;
- 4 GB RAM;
- 30+ GB SSD;
- public IP;
- domain;
- TLS.

Do not optimize capacity before measuring:

- active WebSocket count;
- bytes per Browser tool call;
- MCP request latency;
- Extension execution latency;
- reconnect rate.

### 7.2 MCP protocol edge

**Recommended:** use the official MCP TypeScript SDK v2 for the Hosted HTTP edge instead of extending the current hand-written stdio MCP implementation.

Reason:

- the current project server is intentionally small and pinned to MCP `2025-06-18`;
- current MCP stable specification is `2026-07-28`;
- official SDK v2 is the stable line;
- its HTTP handler can serve the current modern protocol and legacy traffic;
- public ChatGPT interoperability is an external acceptance criterion and should not depend on a new hand-written Streamable HTTP implementation.

This does **not** require rewriting the Local MCP server. Keep the proven Local server as-is until a real reason exists to migrate it.

### 7.3 POC Browser tool scope

Expose only:

```text
inspect_page
```

Do not expose `fill`, `select`, or `click` until transport, routing, and auth boundaries are proven.

### 7.4 Relay state

In memory only:

```text
connectedDevice
pendingCalls: Map<callId, PromiseResolver>
```

POC supports exactly:

- one account;
- one device;
- one active Extension WebSocket;
- one in-flight Browser call per device.

Serializing calls is intentional. Browser task locking and navigation state are stateful; parallel actions are unnecessary for the transport proof and introduce race conditions.

### 7.5 Browser relay message contract

Reuse the existing message shape conceptually:

Request:

```json
{
  "type": "browser-tool-call",
  "version": 1,
  "id": "<uuid>",
  "tool": "inspect_page",
  "arguments": {}
}
```

Response:

```json
{
  "type": "browser-tool-result",
  "version": 1,
  "id": "<same uuid>",
  "ok": true,
  "result": {}
}
```

For POC, reuse the existing validation behavior and wire shape even though the current module is named `browser-native-protocol.js`.

Do **not** rename/refactor the native protocol module merely for naming purity before the Hosted POC passes.

If Hosted succeeds and both transports remain, then decide whether a neutral `browser-tool-protocol.js` extraction is justified.

### 7.6 Timeouts and size bounds

Preserve the existing safety posture:

- bounded tool allowlist;
- exact argument validation;
- maximum text value size;
- request timeout;
- response size bound.

Recommended POC:

- 15 s Browser-call timeout, matching the current stdio path;
- 1 MiB max relay message, matching the current local Unix bridge;
- unknown/replayed call IDs are rejected/dropped;
- close connection -> fail all pending calls.

---

## 8. Extension changes for Hosted POC

The desired seam already exists.

Today:

```text
chrome-native-bridge.js
      |
      v
runBrowserTool()
```

POC:

```text
hosted-websocket-bridge.js
      |
      v
runBrowserTool()
```

The Hosted bridge should be thin:

1. connect to configured `wss://...`;
2. authenticate;
3. receive browser-tool-call;
4. validate tool name/arguments;
5. call the same `runBrowserTool()`;
6. return browser-tool-result;
7. heartbeat/reconnect.

Do not put:

- target selection;
- tab locking;
- handoff;
- DOM inspection;
- form semantics;
- action safety logic

inside the Hosted bridge.

Those remain exactly where they are.

### MV3 lifecycle

Chrome officially supports WebSockets from extension service workers. From Chrome 116 onward, WebSocket send/receive activity resets the service worker idle timer.

For POC, use an approximately 20-second heartbeat while the Hosted connection is active.

Hosted transport is **not** owned by Side Panel visibility.

Adopt an explicit **Browser Control session**:

- the user explicitly arms Browser Control from the extension UI;
- while armed, Hosted transport may remain available even if the Side Panel closes;
- the armed state must survive an extension service-worker restart within the same browser session;
- the user can explicitly Stop/Disarm at any time;
- while disarmed, Hosted Browser tools are unavailable;
- a browser restart must not silently create a newly armed session.

Use one idempotent `ensureTransport()` path to reconstruct transport state. A service-worker startup/restart, socket close, `chrome.runtime.onStartup` where applicable, and a bounded `chrome.alarms` wake/recheck should converge on that same path.

This is distinct from WebSocket keepalive: Chrome 116+ can keep an active service-worker WebSocket alive when messages are exchanged within the activity window, but the extension still needs explicit reconnect/re-arm logic after an unexpected worker/socket restart.

The explicit Browser Control session also provides the consent surface for Hosted's first-call target lock. Do not make the Extension permanently armed merely because the user is signed in.

### Cloud build later

If Hosted becomes a product edition, a Cloud-specific production manifest can eventually remove:

- `nativeMessaging` permission;
- Native Messaging host installation.

Do not split manifests before the POC proves Hosted transport.

---

## 9. Authentication strategy

Authentication must be deliberately split into two independent links.

### Link 1 — ChatGPT / MCP client -> Hosted MCP

### Transport POC

The POC is not a public beta.

To keep auth work out of the transport experiment:

- expose only read-only `inspect_page`;
- do not publish the endpoint;
- use one temporary high-entropy capability only if the target client can present it without leaking it through ordinary proxy/application access logs;
- prefer an Authorization-bearing mechanism when the target client supports one;
- if a URL capability is unavoidable for the isolated POC, explicitly suppress/redact the secret path from reverse-proxy and application access logs;
- destroy/rotate the capability after the test;
- do not treat this as production authentication.

This is intentionally temporary.

### Before any external user or write tool

Implement the MCP authorization model expected by the target client.

For ChatGPT publication, current OpenAI guidance expects OAuth 2.1 for authenticated MCP servers handling user-specific private data or actions.

Do not build a proprietary ChatGPT auth protocol.

### Link 2 — Extension device -> Relay WebSocket

POC:

- one generated 256-bit device secret;
- secret exists only in Relay config and local Extension state/config;
- WSS only;
- Extension sends an authentication message immediately after connect;
- server accepts no Browser calls until authentication succeeds;
- failed/uncompleted auth closes the connection quickly.

Do not put a long-lived secret in query strings or normal logs.

Production:

```text
User signs in
-> backend verifies user
-> one-time pairing
-> device record bound to user + tenant
-> Extension receives device credential
-> WSS exchanges short-lived session credential
```

Exact identity provider is intentionally undecided.

---

## 10. Production tenant isolation invariants

Before multi-user Hosted Beta, the following are **required**, not optional hardening.

### 10.1 Server-derived tenant identity

Never accept:

```json
{ "tenantId": "...", "deviceId": "..." }
```

from MCP tool arguments and use it for routing.

Instead:

```text
validated MCP/OAuth identity
 -> server-side account/tenant
 -> server-side device binding
 -> connection selected by server
```

### 10.2 Authenticated WebSocket context

Each live connection owns immutable server-side identity:

```text
tenantId
userId
deviceId
connectionId
```

Tool calls are routed using that authenticated connection context.

### 10.3 Pending-call ownership

Every call ID is bound to:

```text
connectionId + tenantId + deviceId
```

A result from any other connection must never resolve the call.

Unknown, late, or replayed IDs are discarded.

### 10.4 Per-device serialization

Initially allow one in-flight browser tool call per device **at both boundaries**:

- Relay: one in-flight Browser call per device;
- Extension: serialize calls before `runBrowserTool()`.

This is required by the current non-atomic target/handoff state machine, not merely a performance simplification.

This avoids conflicting:

- target locks;
- navigation handoffs;
- click sequencing;
- page state.

Concurrency can be expanded only if a real use case requires it and the browser task model is proven safe under parallel calls.

### 10.5 Validation at both boundaries

Relay validates:

- allowed tool;
- exact schema;
- size;
- call state.

Extension validates again before `runBrowserTool()`.

Do not trust either the model or the relay request merely because TLS/auth succeeded.

### 10.6 No browser-content logs

Application logs must not contain:

- `inspect_page` text;
- form values;
- `fill.value`;
- page HTML;
- Browser tool request/result JSON bodies;
- Browser tool **error objects/details** that may contain page-derived labels, accessible names, form text, or action text;
- capability credentials in request paths or headers.

Hosted must treat success and error payloads as the same privacy class. In particular, page-derived `CONFIRMATION_REQUIRED.error.details` must be stripped at the Hosted WebSocket boundary unless a documented protocol requirement needs it.

Allowed operational metadata can include:

- pseudonymous tenant/device ID;
- tool name;
- request ID;
- start/end timestamps;
- latency;
- response byte count;
- error code;
- reconnect count.

This is observability without retaining browser content.

### 10.7 Data-retention claim

Hosted may say:

> Browser content is relayed without application-level persistence by default.

Hosted must **not** say:

> Our servers cannot see browser data.

The server necessarily receives plaintext after TLS termination in order to relay ordinary MCP/tool payloads, unless a future end-to-end encrypted design changes the protocol.

---

## 11. Enterprise security deployment

For privacy-sensitive enterprise customers, prefer:

```text
Enterprise AI
   |
Enterprise IdP / Agent Host
   |
Customer-hosted Relay
   |
Managed Extension
   |
Business webpage
```

Advantages:

- model can remain local/private;
- browser data remains in customer infrastructure;
- customer can apply its own SIEM/WAF/network policies;
- no dependency on OpenAI Secure MCP Tunnel unless they specifically use OpenAI products;
- same Browser executor and nearly the same Relay code as SaaS.

Current MCP direction also supports enterprise-managed authorization so organizations can centrally provision MCP access through their identity provider. Treat this as an enterprise integration capability, not something required for the initial Hosted POC.

---

## 12. Important current OpenAI product constraint

Current OpenAI help documentation says:

- full MCP support including write/modify actions is rolling out for ChatGPT Business and Enterprise/Edu;
- Pro can connect custom MCPs with read/fetch permissions in developer mode;
- ChatGPT does not directly connect to a local MCP server; a private local/on-prem MCP can use Secure MCP Tunnel;
- custom-app capabilities depend on plan/workspace policy.

This is strategically important.

The Hosted Relay POC should therefore validate not only transport but the actual target-plan behavior before assuming that a consumer ChatGPT subscription can invoke `fill` / `select` / `click`.

Do not design pricing or consumer onboarding around unsupported plan behavior.

If ChatGPT plan limitations block the desired browser-action product for mainstream consumers, alternatives include:

1. target Business/Enterprise first;
2. use our own model/API-backed agent host;
3. support another MCP-capable host;
4. support enterprise/private models.

This makes model-provider independence more important, not less.

---

## 13. Chrome Web Store implications

Hosted eventually improves extension packaging:

- no local runtime installation;
- no Native Messaging host;
- eventual removal of `nativeMessaging` from Cloud build;
- normal extension auto-update.

However the product still requests broad webpage access because it operates on arbitrary ordinary webpages.

Therefore Web Store review/privacy disclosure remains a product acceptance criterion.

Do not solve this during the transport POC.

---

## 14. Recommended experiment order

### Experiment 0 — completed

macOS Local reboot lifecycle.

Result: **PASS**.

### Experiment 1 — Hosted transport POC

Highest priority.

Implement only:

```text
ChatGPT
-> public MCP / inspect_page
-> in-memory Relay
-> authenticated WSS
-> Extension
-> existing runBrowserTool()
-> result
```

No billing or multi-user system.

### Experiment 2 — plan/capability gate

On the actual intended ChatGPT plan(s):

- verify `inspect_page`;
- verify one reversible action;
- verify whether the full six-tool Browser MCP is accepted.

This is an external product gate.

### Experiment 3 — local/private model proof

Use a simple local/private model Agent Host that acts as an MCP client to the existing Browser MCP.

Goal:

```text
customer/local model
-> agent host
-> Browser MCP
-> Extension
-> inspect_page
```

This demonstrates that the Browser execution product is model-independent.

### Experiment 4 — customer-hosted Relay

Only after Hosted Relay POC is stable.

Deploy the same Relay in a customer-controlled network with no traffic through our SaaS data plane.

### Deferred — Local consumer installer

Resume only when a real user/customer asks for a polished Privacy Edition.

### Deferred — cross-account Secure MCP Tunnel provisioning

No longer a main-product blocker if Local is an expert/self-managed path.

Resume if:

- Local/Privacy becomes commercial;
- an enterprise specifically chooses OpenAI Secure MCP Tunnel;
- zero-input Local onboarding becomes a customer requirement.

---

## 15. Commercial shape after these experiments

Potential long-term product family:

### Cloud

```text
Vendor Hosted Relay
+ Chrome Extension
+ supported AI host
```

Commercial model:

- monthly / annual SaaS.

### Enterprise Private

```text
Customer-hosted Relay
+ managed Extension
+ customer's model / AI platform
```

Commercial model:

- annual license;
- enterprise support;
- professional services.

### Developer / Privacy

```text
repository
+ local Browser MCP
+ self-managed transport
```

Commercial model:

- community/dev access, one-time license, or paid support depending future demand.

Do not force these commercial decisions before the technical gates.

---

## 16. What should remain unchanged now

Keep:

- `browser-client.js`;
- `target-executor.js`;
- target locking/handoff;
- action safety/commit gating;
- Local Browser MCP path;
- Native Messaging path;
- Family Installer V1 work;
- existing uncommitted changes.

Do not:

- delete Local;
- finish Local consumer installer yet;
- refactor Browser tools for hypothetical providers;
- rename the project;
- add Redis/Kubernetes;
- add a database to POC;
- add billing;
- add multi-tenant account code before the single-device transport passes.

---

## 17. Minimum implementation shape proposed for review

Not yet authorized to implement.

If implementation is approved after review, the expected minimum delta is approximately:

```text
NEW: hosted-relay/server.mjs
     - HTTPS-facing MCP handler integration
     - one WebSocket endpoint
     - one connected device
     - pending call map
     - inspect_page only

NEW: hosted-websocket-bridge.js
     - connect/auth/heartbeat/reconnect
     - receive existing browser-tool-call shape
     - call runBrowserTool()
     - return browser-tool-result

CHANGE: service-worker.js
     - small transport selection hook
     - no changes to target state machine / runBrowserTool internals

TEST:
     - relay call correlation
     - auth reject
     - unknown/replayed ID reject
     - timeout/disconnect
     - Browser argument validation
```

The file split is intentionally small. Do not introduce a transport framework or generic provider abstraction until at least two real transports/providers require it.

---

## 18. Questions for Claude review

Please review this design against the current repository, focusing on concrete blockers rather than hypothetical extensibility.

1. Is `runBrowserTool()` the correct minimal seam for a Hosted WebSocket transport?
2. Is there any current service-worker lifecycle behavior that makes the proposed WSS bridge unreliable?
3. Should the Hosted MCP endpoint use the official MCP TypeScript SDK v2 rather than extending the existing hand-written 2025-06-18 MCP server?
4. Is one in-flight Browser call per device the safest POC behavior?
5. Is the temporary read-only capability-URL approach acceptable for an isolated transport POC, provided it is destroyed afterward, or is there an equally small safer mechanism supported by ChatGPT?
6. Are the production tenant-isolation invariants sufficient to prevent cross-user routing?
7. Are there any paths in the current code that can log page/form/tool contents unexpectedly?
8. Can the Hosted bridge reuse the existing browser-native request/result shape without refactoring?
9. For enterprise/private models, is direct MCP/API integration correctly preferred over AI-webpage DOM automation?
10. Is customer-hosted Relay the simplest enterprise privacy deployment while reusing the Hosted code?
11. Are there current OpenAI plan/plugin restrictions that would invalidate the proposed mainstream Cloud product assumption?
12. What is the smallest change set that proves the Hosted transport without damaging the proven Local path?

---

## 19. Authoritative references checked

Checked on 2026-09-20.

- OpenAI Secure MCP Tunnel:
  https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- OpenAI plugin/MCP architecture:
  https://developers.openai.com/plugins/concepts/plugins
- OpenAI plugin MCP server guidance:
  https://developers.openai.com/plugins/build/mcp-server
- OpenAI MCP/plugin authentication:
  https://developers.openai.com/plugins/build/auth
- OpenAI Developer mode and MCP apps:
  https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- MCP 2026-07-28 release:
  https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Official MCP TypeScript SDK v2:
  https://ts.sdk.modelcontextprotocol.io/v2/
- MCP enterprise-managed authorization:
  https://blog.modelcontextprotocol.io/posts/enterprise-managed-auth/
- Chrome extension WebSocket service-worker guidance:
  https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets

## 20. Claude review decisions adopted before Hosted implementation

The repo-grounded review in `docs/hosted-relay-review.md` is accepted as a pre-implementation gate.

Required before H1 code:

1. **Explicit Browser Control session ownership**
   - transport is not Side-Panel-owned;
   - arming is a user-visible consent action;
   - disarm immediately disables Hosted Browser access.

2. **Idempotent transport re-arm**
   - one `ensureTransport()` path;
   - reconstruct after service-worker/socket restart;
   - use service-worker events and an alarm wake/recheck as needed;
   - do not rely on panel reload.

3. **Extension-side serialization**
   - Relay and Extension each enforce one Browser call at a time.

4. **Call-id hardening**
   - bounded UUID-shaped ids;
   - in-flight duplicate rejection;
   - unknown/late/replayed result rejection.

5. **Timeout ordering**
   - avoid identical deadlines at multiple layers;
   - inner Browser execution timeout < Relay timeout < outer MCP/client timeout where controllable.

6. **Privacy boundary includes errors**
   - `error.details` is browser content;
   - strip page-derived details before WSS unless required;
   - no request/result/error bodies in logs.

7. **POC credential logging**
   - capability secrets must not appear in reverse-proxy/application access logs.

8. **Official MCP SDK at public HTTP edge**
   - keep the existing local stdio MCP server unchanged.

The Hosted POC must not start until Codex reviews the revised plan in `docs/next-stage-execution-plan.md`.

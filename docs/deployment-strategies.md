# Deployment and Commercialization Strategies

Date: 2026-09-20
Status: **Historical alternatives, superseded by `architecture-decision-v1.md` and its amendments.** The uncommitted Family V1 prototype was removed on 2026-09-21 by owner-authorized cleanup. References below to retaining or completing it are historical, not current instructions.

This document records the two product/deployment strategies currently under consideration for ChatGPT Embedded Panel.

The core browser execution product is already proven and must be reused in both strategies:

```text
Chrome Extension
  -> target locking / causal handoff
  -> browser-client.js
  -> target-executor.js
  -> inspect_page / inspect_form / fill / select / click
```

Do not redesign that layer merely to change deployment.

---

## 1. Strategy A — Local-first

### Product idea

The Browser MCP runtime stays on the user's own Mac.

```text
ChatGPT Web
  -> OpenAI Secure MCP Tunnel
  -> tunnel-client on the user's Mac
  -> local Browser MCP
  -> Unix socket
  -> Chrome Native Messaging
  -> Chrome Extension
  -> current webpage
```

The user's browser data does **not** pass through our own servers.

OpenAI/ChatGPT still participates in the MCP interaction; the privacy claim is specifically that our infrastructure is not in the browser-content data path.

### Commercial model

Local-first naturally fits:

```text
one-time software / installation fee
+ optional paid upgrades or support
```

A practical commercial offer could be:

- one-time purchase including installation/onboarding;
- a defined update/support period;
- optional paid major upgrades or maintenance after that period.

The seller has little or no per-request server cost after installation.

### Strengths

- Strong privacy story: browser content does not transit our VPS.
- Very low ongoing infrastructure cost.
- Works well for privacy-sensitive customers.
- User execution stays under the user's own machine and account context.
- Good fit for one-time purchase / installation service.

### Costs and complexity

Local-first requires a substantial local installation surface:

- product-private Node runtime;
- OpenAI `tunnel-client`;
- Browser tunnel id + runtime credential;
- Browser MCP profile;
- per-user LaunchAgent;
- Chrome Native Messaging host;
- Chrome Extension installation;
- upgrade path;
- uninstall path;
- health/diagnostics path.

The current Family Installer remains an orchestration layer over the already-proven Browser MCP / Native Messaging / launchd mechanisms. Do not duplicate those mechanisms.

### Current Family Installer V1 direction

The intended non-developer flow is approximately:

```text
Download setup archive
-> double-click Install.command
-> installer downloads/verifies product-private Node
-> installer downloads/verifies tunnel-client
-> installer installs the stable local runtime
-> installer installs Native Messaging
-> installer installs Browser Tunnel LaunchAgent
-> Chrome Load unpacked once
-> ChatGPT Developer App selects the user's tunnel once
-> normal use requires no Terminal
```

The installer should eliminate user knowledge of:

- Node/npm/git;
- YAML/profile files;
- launchctl;
- tunnel-client commands;
- Native Messaging manifests;
- extension ids;
- runtime-key file paths.

### Current Local-first issues to resolve

Before Family V1 is considered ready for a non-technical user:

1. **Stable Extension ID**
   - Use a deterministic manifest `key`.
   - Prefer a key obtained from the Chrome Web Store flow so Family/Beta/Commercial can preserve the same extension id.

2. **Product-private Node**
   - Do not depend on the user's shell PATH or nvm.
   - Installer should download a pinned official Node 22 macOS archive, verify the published checksum, and install it into the product runtime.
   - Local launchers must point to that stable product-owned Node path.

3. **tunnel-client installation**
   - Do not ask the user to browse/download/select the executable manually.
   - Installer should download a pinned official release asset for the current Mac architecture and verify the pinned SHA-256.
   - Current OpenAI release checksum material does not provide the same signed checksum chain as Node; treat this honestly in the threat model.

4. **Non-destructive upgrades**
   - Do not delete the directory currently loaded by Chrome as an unpacked extension.
   - Use a stable install path with a safe swap/versioning strategy.

5. **Uninstaller**
   - A non-technical user needs one obvious removal path for the LaunchAgent, Native Messaging manifest, profile, runtime key, product runtime and product-owned state.

6. **Health check**
   - A background LaunchAgent can fail silently.
   - Provide a one-click diagnostic that confirms Browser tunnel readiness and the local Browser MCP connection.

7. **Tunnel provisioning**
   - For a family install, pre-provisioning a dedicated tunnel + Read/Use credential can remove almost all OpenAI Platform configuration from the recipient.
   - Before relying on this, test whether the recipient's ChatGPT account can directly list/use a tunnel associated with the owner's Platform organization/context.
   - PASS signal: the named tunnel appears in the ChatGPT Tunnel picker without manually pasting the tunnel id.
   - If only pasting the tunnel id works, treat that as partial success rather than zero-input onboarding.

### Local-first target user experience

For Family V1, the target is:

```text
Download
-> double-click
-> approve/open
-> Load unpacked
-> select named Tunnel in ChatGPT
-> Done
```

No Terminal and no developer concepts during normal use.

---

## 2. Strategy B — Hosted Relay

### Product idea

Move the MCP server/relay into our VPS and let the Chrome Extension connect directly to it.

Conceptual architecture:

```text
ChatGPT
  -> public HTTPS MCP endpoint on our VPS
  -> Hosted Relay
  -> authenticated WebSocket
  -> user's Chrome Extension
  -> current webpage
```

The existing browser execution layer remains local inside Chrome.

The transport changes; the browser-control logic should be reused.

### What can disappear from the user's Mac

A successful Hosted Relay design may remove the need for:

- local Node runtime;
- local `tunnel-client`;
- OpenAI Secure MCP Tunnel on the user's Mac;
- Browser MCP LaunchAgent;
- local Browser MCP server process;
- Unix socket transport;
- Chrome Native Messaging host;
- local runtime API key management.

This is the main UX advantage.

With a Chrome Web Store extension, the long-term user flow could approach:

```text
Install extension
-> sign in / pair device
-> use
```

### Commercial model

Hosted Relay naturally fits:

```text
monthly / annual SaaS subscription
```

because we continuously operate:

- public MCP endpoint;
- relay connections;
- authentication;
- device/session routing;
- monitoring;
- availability;
- security;
- potentially billing/account services.

Unlike Local-first, there is a real recurring service being provided.

### Privacy tradeoff

This is the largest strategic cost.

Hosted Relay places our infrastructure directly in the browser-content path:

```text
Chrome webpage
  -> Extension
  -> our VPS
  -> ChatGPT
```

Potentially sensitive data can transit the VPS:

- `inspect_page` results;
- visible webpage text;
- form content;
- fill payloads;
- action targets;
- other MCP request/result content.

Even if the service is designed to be memory-only and zero-retention, our server is still technically able to observe the data while relaying it.

Therefore Hosted Relay cannot honestly make the same privacy promise as Local-first.

A reasonable minimum privacy design would require:

- TLS everywhere;
- strict tenant/device isolation;
- short-lived device/session credentials;
- no browser-content persistence by default;
- no browser-content application logs;
- metadata-only database storage where possible;
- explicit retention policy;
- rate limiting / abuse controls;
- security event logging that excludes page bodies;
- clear privacy disclosure.

### Minimal VPS requirements

Hosted Relay is connection-heavy, not compute-heavy. It does not run an AI model.

A reasonable POC VPS:

```text
2 vCPU
4 GB RAM
30+ GB SSD
public IP
domain
HTTPS/TLS
stable outbound Internet
```

No GPU is required.

A minimal POC deployment can be:

```text
Reverse proxy (Caddy / Traefik / Nginx)
  -> HTTPS MCP endpoint
  -> WebSocket endpoint
  -> one Relay service
  -> small database only if required for auth/device metadata
```

Do **not** introduce Kubernetes, Redis, queues or microservices before the POC proves they are needed.

For an early 10–100 user Beta, a single 4 vCPU / 8 GB VPS would likely be ample from a compute perspective; reliability and tenant isolation matter more than raw CPU.

Commercial HA should eventually prefer multiple Relay instances + durable account/device metadata storage rather than simply buying one very large VPS.

### Hosted Relay POC

Before choosing Hosted Relay as the main product direction, build the smallest possible proof:

```text
ChatGPT
-> VPS public MCP endpoint
-> one authenticated WebSocket
-> current Chrome Extension
-> inspect_page
-> Relay
-> ChatGPT
```

POC non-goals:

- billing;
- subscriptions;
- multi-tenant admin UI;
- complex account system;
- Redis;
- Kubernetes;
- production-grade autoscaling;
- companion app;
- redesigning target-executor.

The POC question is only:

> Can the existing Browser WebMCP execution layer work reliably when Native Messaging transport is replaced by a Hosted Relay/WebSocket transport?

---

## 3. Strategy C — Hosted Control Plane + Local Data Plane

This is a possible middle ground, but it is not the current implementation target.

```text
Our VPS:
  account / billing / provisioning / updates / license

Browser data path:
  ChatGPT
  -> OpenAI Secure MCP Tunnel
  -> user's Mac
  -> Chrome
```

Our servers would **not** relay webpage contents.

This can simplify:

- account management;
- subscription/license;
- tunnel provisioning;
- device registration;
- update metadata.

But it does **not** remove the local runtime/tunnel installation complexity. Therefore it is not a replacement for the Local Installer and not as simple as full Hosted Relay.

Use this option later if the product wants SaaS account/provisioning while preserving the Local-first privacy model.

---

## 4. Side-by-side comparison

| Area | Local-first | Hosted Relay |
|---|---|---|
| Normal install UX | More complex | Much simpler |
| Chrome Extension | Required | Required |
| Local Node | Required today | Not required in target architecture |
| Local tunnel-client | Required | Not required |
| LaunchAgent | Required | Not required |
| Native Messaging | Required | Potentially not required |
| Secure MCP Tunnel | Per user/device | Replaced by public Hosted MCP |
| Our VPS required | No data plane | Yes |
| Browser contents transit our VPS | No | Yes |
| Ongoing infra cost | Low | Recurring |
| Privacy positioning | Strongest | Weaker |
| Natural pricing | One-time / support | Subscription |
| Best fit | privacy-sensitive / install-and-own | mainstream SaaS / easy onboarding |

---

## 5. Commercial interpretation

The current working hypothesis is:

### Local Edition

```text
Pay once
-> install/configure
-> runs locally
-> optional paid updates/support
```

Best differentiator:

> Browser data does not pass through our servers.

### Hosted Edition

```text
Install extension
-> connect account/device
-> recurring hosted service
-> monthly/annual subscription
```

Best differentiator:

> Very fast onboarding and almost no local infrastructure.

Do not present Hosted as more private than Local. The privacy tradeoff must be explicit.

---

## 6. Decision status

No final product decision has been made.

### Keep now

- Existing Browser MCP execution stack.
- Existing Local-first working path.
- Current Family Installer work; do not delete it.
- Existing Native WebMCP remains separate.

### Do next

After restart, compare the two paths using evidence rather than preference:

1. **Local gate:** test the recipient-account Tunnel provisioning/listing flow.
2. **Local gate:** finish the Family V1 design around stable extension id, product-private Node, verified tunnel-client install, non-destructive upgrades, uninstall and health check.
3. **Hosted gate:** design the smallest Hosted Relay POC and estimate the exact changes needed in the Extension transport.
4. **Hosted gate:** define the privacy boundary before any multi-user implementation.
5. Compare:
   - end-user install steps;
   - implementation effort;
   - recurring operating cost;
   - privacy/security liability;
   - commercial model;
   - maintenance burden.

Only then choose whether the default product should be Local-first, Hosted Relay, or both.

---

## 7. Current recommendation

Do **not** delete or abandon Local-first.

Treat the product as potentially having two editions:

```text
Local / Privacy Edition
  -> one-time purchase
  -> local execution
  -> strongest privacy

Hosted / Cloud Edition
  -> subscription
  -> easiest onboarding
  -> Hosted Relay
```

Before committing to the Hosted edition, prove the transport with a minimal POC and explicitly accept the privacy/security obligations created by putting our VPS in the browser-content data path.

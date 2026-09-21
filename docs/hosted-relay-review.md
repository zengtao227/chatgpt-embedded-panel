# Review — Hosted Relay + Enterprise Private AI Architecture

Date: 2026-09-20
Reviewer: Claude (Opus 5), repo-grounded
Subject: [`docs/hosted-relay-enterprise-architecture.md`](hosted-relay-enterprise-architecture.md)

**Scope: review only.** No code was changed, no finding was fixed, and neither
`hosted-relay/server.mjs` nor `hosted-websocket-bridge.js` was created. Every claim below
cites `file:line` in the current working tree (HEAD `fe160bb` + the uncommitted installer work).

Severity vocabulary:

- **Blocker** — the Hosted POC cannot meet its own success criteria without addressing it.
- **Design gap** — hosted-only correctness/security question that must be answered before any
  external user, but not before the transport proof.
- **Hardening** — real but non-blocking; cheap to do at POC time, no design change.
- **Confirmed** — the design is right as written; no change needed.

---

## 0. Headline

The design is sound and the seam it picks is the right one. Two things need resolving
**before** the POC is written, and both sit in the same place — the extension has no way to
re-establish a transport that it did not itself just open:

1. **Finding 1 (Blocker)** — nothing in the extension re-arms the bridge after a
   service-worker restart. POC success criterion #7 ("disconnect/reconnect works after
   Extension service-worker restart") cannot pass against the current wiring.
2. **Finding 2 (Blocker, strategic)** — §8 ties the Hosted connection to the Side Panel
   session, but Hosted's whole premise is ChatGPT-as-cloud-client, where the panel may not be
   open at all. Criterion #7 does not even have a stable meaning until this is decided.

Everything else in §17's minimum delta is realistic, and five of the twelve questions are
"yes, change nothing."

---

## 1. Answers to §18

### Q1 — Is `runBrowserTool()` the correct minimal seam? — **Confirmed**

Yes. `runBrowserTool(call)` (`service-worker.js:246`) already takes a transport-neutral
`{ id, name, arguments }` and returns a transport-neutral
`{ version, id, ok, result|error }`. Everything transport-shaped lives above it:
`chrome-native-bridge.js` does wire validation (`:37`), protocol framing (`:49`) and nothing
else — 73 lines, no target logic. `connectChromeNativeBridge({ runtime, runBrowserTool })`
(`chrome-native-bridge.js:19-24`) is *already* parameterised for exactly the injection the
Hosted bridge needs. No change required to make this seam work.

### Q2 — Does current service-worker lifecycle make the WSS bridge unreliable? — **Blocker, but not for the reason the question implies**

MV3 lifecycle is not the problem. The **missing re-arm path** is. This distinction matters
because it changes the fix from "keep the worker alive" (fragile, version-dependent) to "add
a reconnect trigger" (small, deterministic).

Code-grounded chain, no Chrome-version knowledge required:

- `browserNativeBridge` is a module-scope global — `service-worker.js:23`.
- It is assigned in exactly one place, `startPanelSession()` — `service-worker.js:66-72`.
- `startPanelSession()` is reachable through exactly one message,
  `chatgpt-panel.enable-policy` — `service-worker.js:462`.
- The panel sends that message from exactly one place, `loadFrame()` —
  `sidepanel.js:63`, called at `sidepanel.js:169` on panel-document load and from the Retry
  button at `:140`.
- There is no `chrome.runtime.onStartup` listener, no `chrome.alarms` usage, and no
  reconnect-on-failure anywhere in `service-worker.js`.

Consequence: the bridge is re-established only when the **panel document itself reloads** —
not when the service worker alone restarts. Meanwhile task state survives the restart,
because it lives in `chrome.storage.session` (`service-worker.js:53,58`). That asymmetry —
durable task state, non-durable transport — is the finding.

This already affects the *local* path (a silently-dropped native port stays dropped, and
`onDisconnect` at `chrome-native-bridge.js:56` only flips a flag), but Hosted makes it
load-bearing: the remote peer is the one initiating work, so a dead socket is an outage
rather than a latency blip.

Minimum fix, POC-sized: a `chrome.alarms`-driven `ensureTransport()` plus
`chrome.runtime.onStartup`, both calling the same idempotent connect used by
`startPanelSession()`. No change to `runBrowserTool()` or the target state machine.

> The doc's §8 timing specifics (30s idle timeout, Chrome 116 WebSocket activity resetting
> the idle timer, 20s heartbeat) are taken from the doc's own references and were **not**
> re-verified in this review. The finding above does not depend on any of them.

### Q3 — Official MCP TypeScript SDK v2 for the Hosted edge, or extend `browser-mcp/server.js`? — **Use the SDK. The repo alone settles this.**

`browser-mcp/server.js` is a correct *stdio* server and a wrong starting point for a public
HTTP edge, independent of any claim about spec dates:

- `PROTOCOL_VERSION` is hardcoded at `:5` and echoed unconditionally at `:161-165` —
  the server never inspects `params.protocolVersion`, so it cannot negotiate with a client
  that asks for anything else.
- There is no session concept at all: no `Mcp-Session-Id`, no per-connection state. `handle()`
  (`:153`) is a pure request→response function over a single implicit stdio peer.
- There is no Streamable HTTP, no SSE, no `Origin` validation, no resumability — `runStdio()`
  (`:201-218`) is newline-delimited JSON over stdin/stdout.

Those are four things a public MCP edge needs and this file does not have. Writing them by
hand, when public ChatGPT interoperability is the external acceptance criterion, puts the
POC's failure mode in *your* HTTP implementation rather than in the thing you are trying to
prove. §7.2's recommendation is right, including its corollary: **do not migrate the local
stdio server.** It works, it is 223 lines, and nothing about Hosted requires touching it.

### Q4 — Is one in-flight browser call per device the safest POC behaviour? — **Confirmed, and stronger than the doc states: it is required, on both sides**

The doc treats serialization as a prudent POC simplification. It is actually a correctness
requirement, and the reason is sharper than "target locking is stateful":

The task state machine is a **non-atomic read-modify-write** over a single
`chrome.storage.session` key. `beginClickHandoff` (`service-worker.js:82-89`),
`clearUnclaimedHandoff` (`:91-102`) and `handleTargetTabUpdate` (`:345-410`) all do
`readTask()` → decide → `writeTask()` with `await`s in between. Two concurrent
`runBrowserTool()` calls interleave and lose updates — a dropped handoff lease or a
resurrected `locked` state over a `blocked` one.

Two consequences the doc should absorb:

- **The extension must enforce serialization too**, not just the relay. Per the doc's own
  §10.5 ("validate at both boundaries"), a relay-only guarantee is the wrong side of the
  trust boundary. A single promise chain in `runBrowserTool()` is sufficient.
- **The local path already permits concurrency today.** `browser-native-host.js:18` keeps a
  `pending` Map keyed by id, and `createUnixSocketBrowserClient` opens a **new socket per
  call** (`unix-bridge.js:35`). Nothing serializes them. This is a pre-existing latent issue,
  not something Hosted introduces — reported here, not fixed. *(Hardening on the local path;
  Blocker on Hosted, where the remote peer controls call pacing.)*

### Q5 — Is the temporary capability-URL acceptable for an isolated transport POC? — **Acceptable as scoped, with one condition the doc already implies but does not state**

Yes, given all four of the doc's own constraints hold simultaneously: unpublished endpoint,
`inspect_page` only, single device, capability destroyed after the run. A high-entropy path
segment is a bearer credential in a URL, which is exactly what §9 says not to ship — but §9
also says this is not production auth, and for a read-only single-tool endpoint the blast
radius of a leak is "someone reads one page of yours once, if they also win a race against
your rotation."

The condition worth writing down: **the capability must not reach the same logs the doc's
§10.6 already regulates.** Request paths are the single most commonly logged field in every
reverse proxy; Caddy/Traefik/Nginx (§7.1) log the full URI by default. Put the secret in a
path and you have put it in `access.log` without writing a line of code. Either strip the
path segment in the proxy log format, or move the capability to an `Authorization` header if
the target client supports one.

I did not verify what ChatGPT's connector UI accepts as an equally small alternative — that
is an external-source question, same bucket as Q11.

### Q6 — Are the §10 tenant-isolation invariants sufficient to prevent cross-user routing? — **Sufficient as invariants; two additions**

§10.1–10.4 are the right invariants and are stated at the right level (server-derived
identity, immutable per-connection context, call-ID ownership, per-device serialization).
Two things are missing:

1. **Bound the call ID.** `validBrowserNativeCall` (`browser-native-protocol.js:4-17`)
   accepts any non-empty string as `id`, and `chrome-native-bridge.js` has no in-flight
   dedupe — a repeated id executes twice and posts two results. Over Native Messaging that is
   irrelevant (trusted local peer, single process). Over WSS the id arrives from a remote
   server, so §10.3's "unknown, late, or replayed IDs are discarded" needs an extension-side
   counterpart: UUID-shaped ids only, plus a rejected-if-in-flight check. *(Hardening.)*
2. **Stagger the timeouts.** `browser-native-host.js:6` uses 15 000 ms and
   `stdio-server.js:7` passes 15 000 ms to the Unix client — two layers with *identical*
   deadlines. When the extension is genuinely slow, both fire at the same instant and the
   error surfaced is the outer client's generic "Browser bridge timed out", not the specific
   "Chrome extension timed out". §7.6's proposed 15 s relay timeout would make it three
   layers at the same number. Worth noting the extension's own worst case is not small:
   `HANDOFF_SETTLE_MS` is 5 000 ms (`service-worker.js:22`) on top of executor time. Suggest
   executor < extension < relay < MCP client, e.g. 15 s inner / 20 s relay. *(Hardening.)*

### Q7 — Any current code path that can log page/form/tool contents unexpectedly? — **No logging path (verified). But page text already leaves the page inside error objects.**

A repo-wide search for `console.*`, `process.stderr`, `process.stdout.write`, `appendFile`
and `writeFile` outside `tests/` returns no runtime content logging. Specifically:

- `browser-mcp/server.js:211,216` writes to stdout, but that **is** the MCP transport, not a
  log.
- The only `console.*` calls are in `research/chatgpt-dom-lifecycle-probe.js:210,324,345,361`
  — a manually-pasted research probe, not loaded by `manifest.json`.
- `scripts/*.mjs` stdout/stderr writes are installer status lines and paths, never tool
  payloads.

**However — one claim §10.6 implies is already false, and it matters for Hosted.**
Page-derived text *does* leave the page inside error objects today:

- `clickRiskReason` (`target-executor.js:374`) returns `` `commit-like action: ${match[0]}` ``,
  where `match[0]` is a word matched against `accessibleName(element)` — the button's real
  label.
- `click()` (`target-executor.js:402-413`) puts that reason **and** the raw accessible name
  into the error's `details`: `{ ref, name: accessibleName(element), reason }`.
- `browser-client.js:83` returns `error: response.error` whole — `details` included — and
  `browserNativeResult` (`browser-native-protocol.js:43`) spreads it onto the wire unchanged.

On the **local** path this stops one hop later: `browser-native-host.js:47-49` reads only
`message.error?.message` and `.code`, so `details` never reaches the MCP client. That
truncation is incidental, not a designed boundary.

On a **Hosted** path that reuses `browserNativeResult` verbatim (which Q8 recommends), the
relay receives `details` — i.e. page text — inside a `CONFIRMATION_REQUIRED` error, which is
the single most likely thing a relay would log, because it looks like an error rather than
like content. §10.6's list ("`inspect_page` text, form values, `fill.value`, page HTML,
request/result JSON bodies") does not currently name error objects. It must.

Two further channels widen the same seam once the relay starts logging error strings:

- `safeBridgeError` (`browser-mcp/server.js:109-123`) forwards `error.message.slice(0, 2000)`
  to the MCP client for any non-transport error code.
- `listenUnixBrowserBridge`'s catch (`unix-bridge.js:158-167`) forwards `error.message` from
  `dispatch`.

Error *messages* are fixed strings today (`service-worker.js:180-240`, `browser-client.js`),
so those two are currently clean — but that is a convention, not a mechanism, and `details`
shows the convention has already been broken once where nobody was looking.

### Q8 — Can the Hosted bridge reuse the existing request/result shape without refactoring? — **Confirmed. Verbatim.**

`browser-native-protocol.js` is 45 lines with **zero** `chrome.*` references — pure shape
validation (`validBrowserNativeCall`) and pure response normalisation (`browserNativeResult`).
It imports nothing. The Hosted bridge can import it as-is; the only thing "native" about it is
`BROWSER_NATIVE_HOST_NAME` at `:1`, which the Hosted bridge simply does not use. §7.5's
"don't rename for naming purity before the POC passes" is correct and costs nothing.

Two *additions* in the Hosted bridge, neither a change to this module: Q6's id bounding, and
stripping `error.details` before the result crosses the WebSocket (Q7) — the local path gets
that for free at `browser-native-host.js:47-49`, Hosted does not.

### Q9 — For enterprise/private models, is direct MCP/API integration correctly preferred over AI-webpage DOM automation? — **Confirmed, and the repo gives a concrete argument the doc doesn't use**

Yes, and §5's ordering (own the backend → explicit extension protocol → customer relay →
DOM adapter last) is right. The repo supplies an argument worth adding: **the action safety
gate is already on the far side of every transport.** `clickRiskReason`
(`target-executor.js:360-400`) runs inside the target page's content script; the relay only
ever transmits a tool name and an opaque `ref` (`browser-client.js:67-72`). So Hosted and
customer-hosted deployments inherit the commit-gating unchanged — no relay, and no model, can
route around it.

A DOM adapter for a third-party AI webpage (Case C) has no such property: it reintroduces
exactly the conversation-DOM coupling that `ROADMAP.md` records as *removed* from runtime
("the old hidden conversation-text protocol and DOM repair layer are removed"). Treating it
as a compatibility adapter rather than architecture is consistent with what this project has
already paid to get rid of once.

### Q10 — Is customer-hosted Relay the simplest enterprise privacy deployment while reusing Hosted code? — **Confirmed**

Yes, on the condition the doc already sets: the relay stays a dumb correlator. §7.4's state
(`connectedDevice`, `pendingCalls`) plus §10's identity invariants is all that differs between
vendor-hosted and customer-hosted; everything below the WebSocket is byte-identical. The
thing that makes this work is Q1 and Q8 — the seam and the wire shape are already
transport-neutral in code, so "same relay, different trust boundary" is a deployment fact
rather than an aspiration.

Only caveat: keep the relay free of anything customer-specific (no IdP coupling, no policy
engine). The moment tenant logic leaks below the identity layer, the two deployments fork.

### Q11 — Do current OpenAI plan/plugin restrictions invalidate the mainstream Cloud assumption? — **Cannot be answered from this repository.**

There is nothing in the code that constrains or informs this. §12 already states the risk and
§14's Experiment 2 is the correct gate for it — that sequencing is right and I would not
change it. The doc's §19 references were checked on 2026-09-20 by its author and were
deliberately **not** re-verified in this review, which ChatGPT asked to be repo-grounded.

If you want that verified against the live OpenAI documentation as a separate pass, say so —
it is a different kind of work with a different acceptance standard.

### Q12 — Smallest change set that proves Hosted transport without damaging the proven Local path? — **§17's estimate is realistic; here it is with the seams filled in**

```text
NEW  hosted-websocket-bridge.js          ~ mirrors chrome-native-bridge.js (73 lines)
     - connect / auth / heartbeat / reconnect
     - reuses browser-native-protocol.js verbatim (Q8)
     - adds: UUID-shaped id check + in-flight dedupe (Q6.1)
     - calls the same runBrowserTool(), nothing else

NEW  hosted-relay/server.mjs             ~ MCP SDK HTTP edge + one WS endpoint (Q3)
     - one device, pendingCalls Map, inspect_page only
     - timeout staggered above the extension's (Q6.2)

CHG  service-worker.js
     - startPanelSession() :66-72  -> transport selection (~5 lines)
     - NEW ensureTransport() + chrome.alarms + onStartup re-arm   (Finding 1 — required
       for POC criterion #7, not optional polish)
     - runBrowserTool() :246       -> single-flight promise chain (Q4)
     - target state machine, browser-client.js, target-executor.js: UNCHANGED

TEST tests/hosted-relay-*.test.js
     - templates already exist: tests/browser-mcp-socket-poc.test.js and
       tests/browser-native-host-poc.test.js do exactly this shape (in-process
       bridge + real transport + round-trip assert, node:test, no browser)
     - `npm test` = node --test tests/*.test.js — new files are picked up automatically
```

What guarantees the local path is untouched: `connectChromeNativeBridge` receives
`runBrowserTool` as a parameter (`chrome-native-bridge.js:19-24`), so a second transport is a
second call site next to `service-worker.js:69`, not an edit to the first. `npm run check`
(`package.json`) syntax-checks `service-worker.js` and runs the full suite, so regression
evidence for the local path is one command — and the suite is green right now:
`npm test` → `# tests 68 / # pass 68 / # fail 0` on this working tree (2026-09-20).

---

## 2. Findings the document did not ask about

### Finding 2 — Panel-lifecycle coupling contradicts the Hosted premise — **Blocker (strategic)**

§8 says: *"connect Hosted relay when the Side Panel session starts; close it when the
panel/session closes."* That is correct for today's product, where the panel **is** the
ChatGPT UI. It is incoherent for Hosted, where the premise is `ChatGPT (cloud) → our MCP
endpoint → relay → extension`: in that topology the user may be talking to ChatGPT in an
ordinary tab, in the desktop app, or on a phone, with your side panel closed. The relay would
then have no device to route to, and the MCP call fails for reasons the user cannot see.

This is also why Finding 1 and POC criterion #7 are entangled: "reconnect after service-worker
restart" has no stable meaning until you decide what the connection's *owner* is. Three
coherent options, in increasing cost:

1. **Panel-owned (status quo).** Hosted only works while the panel is open. Simplest; makes
   Hosted a panel feature rather than a cloud product. Legitimate for the POC — but then
   say so, because it changes what criterion #7 tests.
2. **Explicit session toggle.** The user arms a "browser control" session from the extension
   action; the connection lives for that session regardless of panel visibility. Preserves a
   user-visible consent artifact, which Finding 3 wants anyway.
3. **Always-on while signed in.** Matches the Cloud product pitch and contradicts §8's
   explicit "do not make the Extension permanently online before there is a product
   requirement."

I'd take (2): it satisfies the Cloud premise, keeps §8's caution, and produces the consent
surface Finding 3 needs. But this is a product decision, not a technical one — it just needs
making *before* the POC, because it determines what the bridge's lifecycle code looks like.

### Finding 3 — Hosted changes the auto-lock threat model — **Design gap (hosted-only, not a POC blocker)**

`targetForBrowserTool()` (`service-worker.js:219-243`) locks **whatever tab is currently
active** on the first tool call, with no user gesture — `chrome.tabs.query({ active: true,
lastFocusedWindow: true })` at `:150`. Combined with `host_permissions: http://*/*,
https://*/*` (`manifest.json:13-16`), a compromised relay could call `inspect_page` at a
moment of its choosing and read whatever page the user happens to have focused — a bank, a
webmail thread, an internal admin console.

That is a materially different threat model from Local, where an attacker must already be on
the machine. It is not, however, unbounded, and the counterweight is real and already built:

- Once locked, the task cannot wander. Cross-origin navigation writes `ORIGIN_CHANGED` and
  blocks (`service-worker.js:365-375`); non-attachable URLs block at `:349-362`.
- Tab adoption requires a causal opener within a 1 500 ms click lease
  (`service-worker.js:20,311-343`) — the relay cannot conjure a new target.
- Commit-like actions fail closed in the page (`target-executor.js:360-400`), so the worst
  case is read-and-fill, not send-money.

So: a compromised relay gets one un-consented read of the user's current page and bounded
interaction with it. The mitigation is an explicit arm step rather than implicit first-call
locking — which is the same mechanism Finding 2's option (2) already requires. Doing both as
one change is cheaper than doing either alone.

This does **not** block the POC (single device, own machine, `inspect_page` only). It blocks
the first external user, alongside §9's OAuth work.

### Finding 4 — §10.7's data-retention wording is right; make sure the code can back it — **Hardening**

The distinction §10.7 draws (relayed without application-level persistence ≠ "we cannot see
it") is correct and honest, and Q7 confirms no current code logs content. But §10.6's
enumeration is incomplete in a way Q7 shows is not hypothetical: **error objects carry page
text**, via `details` on `CONFIRMATION_REQUIRED` (`target-executor.js:402-413`). Add error
objects to §10.6's list, and have the Hosted bridge drop `details` at the WebSocket boundary
rather than relying on the relay to be careful.

Worth one test in the POC suite: assert the relay's log sink never receives a string
containing a known page-body fixture — and make the fixture a *button label* routed through a
blocked click, not just body text, so it exercises the `details` path specifically.
`tests/browser-mcp-socket-poc.test.js` already builds the plain-body version
(`'Rendered page body'`, `:25`).

---

## 3. What I would not change

For the record, so these don't get re-litigated:

- Keeping `browser-client.js`, `target-executor.js` and the target/handoff state machine
  untouched (§16) — correct, and Q1/Q8 show it is achievable, not just aspirational.
- Not migrating the local stdio MCP server to the SDK (§7.2) — correct.
- Not renaming `browser-native-protocol.js` before the POC passes (§7.5) — correct; the module
  is already transport-neutral in substance.
- Not splitting the manifest before the POC (§8) — correct.
- `inspect_page`-only for the POC (§7.3) — correct, and it also keeps Finding 3's blast
  radius at "read" for the duration of the experiment.
- Deferring the consumer installer and cross-account tunnel provisioning (§14) — correct;
  neither is on the path of any of the four findings above.

---

## 4. Open questions back to the author

1. **Finding 2** — which connection-ownership model? This gates the bridge's lifecycle code
   and the meaning of POC criterion #7.
2. Should the OpenAI/MCP external claims (§12, §19) be verified against live documentation as
   a separate pass? They were excluded here by scope.

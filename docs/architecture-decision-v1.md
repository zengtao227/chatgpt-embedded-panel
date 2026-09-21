# Architecture Decision v1 — Governing Architecture and Priority Order

Date: 2026-09-21
Status: **Frozen.** Every development task must be checked against §7. Changing anything here requires an explicit dated amendment in §9, not a silent edit elsewhere.
Inputs: `browser-webmcp-platform-roadmap.md`, `next-stage-execution-plan.md`, `installer-v1-review.md`, an independent Codex architecture review (2026-09-21), OpenAI Secure MCP Tunnel docs, and code/host checks listed in §5.

## 1. Decision

Share one Browser execution capability, attach different models through different adapters, install components on demand. The nearest deliverable is **ChatGPT Side Panel + Browser tools installable on another Mac** (macOS + Chrome + ChatGPT only; Windows is a separate later acceptance).

Three fixed rules:

1. **The Browser Execution Plane does not know model brands.** `runBrowserTool()` -> `browser-client.js` -> `target-executor.js` (+ task binding/handoff and confirmation rules) stays stable. Do not change it to fix a deployment or a provider.
2. **A model adapter only solves how a model proposes calls and receives results.** ChatGPT = official MCP via Secure MCP Tunnel; DeepSeek = the already-proven web-interaction path; local model = API + an MCP client host. One stable **tool contract**, not one process, one tunnel or one embedding method.
3. **Local file/shell execution is a separate product.** Native `webmcp-bridge` (Docker-isolated) is installed and authorised independently. Using the Browser assistant must never require Docker, Native Base or Plus.

## 2. Component boundaries

| User wants | Component | Install boundary |
|---|---|---|
| Chat with ChatGPT in a side panel | ChatGPT Embedded Panel | Browser extension |
| ChatGPT reads/fills/clicks web pages | Browser MCP + extension execution layer | Local connector + Tunnel (today) |
| DeepSeek operates web pages | DeepSeek web adapter + Browser execution layer | No OpenAI Tunnel |
| Local model operates web pages | Local model + tool-calling host + Browser MCP | No ChatGPT account |
| Read/write local project, run commands | Native `webmcp-bridge` | Independent, Docker |
| Several execution machines | `webmcp-bridge-plus` | Later, on demand |

## 3. Priority order — AMENDED BY A1 in §9 (supersedes roadmap §7 and the serial order in `next-stage-execution-plan.md`)

| Stage | Deliverable | Done when |
|---|---|---|
| 0 | This record + boundaries frozen | Every later task can name its component and stage |
| 1 | Another-Mac install: ChatGPT Side Panel + Browser tools | No preinstalled Node, no sibling-repo dependency; real page read + one reversible action succeed on a second Mac |
| 2 | Install lifecycle | Same-version reinstall, connection check, uninstall, clear failure messages; survives reboot; uninstall leaves Native untouched |
| 3 | Model replaceability | DeepSeek (finish P6 as an adapter) and one local model complete a Browser tool loop without changing execution semantics or needing OpenAI Tunnel |
| 4 | Wider distribution | Chrome Web Store + signed experience; Hosted Relay decided on measured install cost and demand |

DeepSeek P6 is not abandoned; it is demoted from "finish first" to Stage 3 compatibility acceptance. Reason: the roadmap's own L4 trigger ("Local packaging only if a real user requires non-technical Local") has fired.

## 4. Reconciliation with the previous route

| Topic | Previous route | Codex | Decision |
|---|---|---|---|
| Stable core, three tracks (Hosted / Enterprise / Local) | Roadmap §1-2 | Same | No change |
| Order | DeepSeek P6 -> Local -> Hosted | Local install first; DeepSeek/local model as compatibility tests | **Adopt Codex order** (§3) |
| Local packaging | Deferred (L4) | Bring forward | Adopt; trigger met |
| Installer shape | `Install.command`, manifest `key`, bundled Node, pinned tunnel-client, uninstaller, health check (`installer-v1-review`) | Same, plus first version refuses cross-version upgrade | Adopt, with the reinstall constraint in §6 |
| Local-model track | Enterprise E1 | Stage 3 acceptance | Keep as E1 content, run in Stage 3; a model with tool-calling is not an MCP client — a host program must run the tool loop |
| Tunnel -> public plugin | `installer-v1-review` §6 "Commercial: published ChatGPT app" | Not possible | **Codex correct** (§5). Tunnel is permanently private/expert/family. Public distribution = public HTTPS MCP = Hosted track. The review's Commercial bullet is superseded |
| Sidebar needs only the extension | Implicit | Unproven | Record as unverified (§5) |
| Do not copy login state/keys/workspaces | Implicit | Explicit | Adopt: copy versions, component set and non-secret config only; authorise per machine |

## 5. Evidence

Verified this round:
- `RUNTIME_PAYLOAD` (`scripts/onboard-macos.mjs:26-41`) omits `scripts/activate-browser-tunnel.mjs`, which `install-browser-tunnel-launchd.mjs:15` and `local-setup.mjs:21` import statically. `local-setup/doctor/uninstall` are also not in the payload. A clean-machine install would fail on the missing import.
- `installRuntime` (`onboard-macos.mjs:168-169`) does `rmSync(installRoot)` then `renameSync`. That deletes the folder Chrome has loaded as an unpacked extension.
- `com.webmcp.browser-tunnel` is loaded: `state = running`, `runs = 2`, `last exit code = 0` (launchctl, 2026-09-21). `ROADMAP.md` is correct; `.agent/handoff.md` "step B pending" was stale (gitignored).
- OpenAI docs: "Secure MCP Tunnel supports private MCP connections, including developer-mode testing. It does not support public plugin submission or distribution." Creating/editing needs Tunnels Read + Manage; running or selecting needs Read + Use; a tunnel "can be associated with one or more Platform organizations or ChatGPT workspaces"; one associated only with a personal org "doesn't automatically appear in an Enterprise/Edu workspace".

Not verified (do not claim as supported until tested):
- Sidebar cold start with no Native host: `startPanelSession` calls `connectChromeNativeBridge` unguarded; a missing host most likely just disconnects the port, but no real test exists.
- Whether the target user's account can list a tunnel from another Platform org (association is documented; listing for that account is not).
- Gatekeeper/clean-account behaviour of `Install.command` on the second Mac; the earlier `112/112 PASS` is not install evidence.
- ChatGPT embedding depends on stripping frame-policy headers on chatgpt.com responses. It is an independent risk; keep the existing window fallback.

## 6. Stage 1 scope — defects list still valid; scope amended by A1 in §9

Known defects to fix as one bounded installer revision:
1. Payload must contain the full static-import closure of every script the installer runs (add a test that computes it; today it lacks `activate-browser-tunnel.mjs`).
2. Reinstall of the same version must not delete the loaded extension folder; a different version is refused with a clear message (cross-version upgrade is out of Stage 1).
3. Product-private Node at a pinned, verified version (not an nvm path baked into launchers); stable extension ID via manifest `key` from the Chrome Web Store dashboard, not a self-generated key.
4. `tunnel-client` fetched by the installer with SHA-256 check (checksum file is unsigned: it guards corruption, not a compromised release).

Acceptance shows four separate states, because `doctor READY` proves only the first two: side panel usable · local connector healthy · ChatGPT connected · a real tool call succeeded.

Non-goals: Windows, Hosted Relay, billing, `.pkg`/companion app, cross-version upgrade, changes to the Browser Execution Plane.

## 7. Alignment checklist (every development task)

- Which component in §2 and which stage in §3 does it belong to? If neither, it needs an amendment first.
- Does it touch the Browser Execution Plane? Then a demonstrated correctness blocker is required.
- Does it add a model-specific branch outside an adapter?
- Does it make Browser depend on Native/Docker, or copy secrets/login state between machines?
- Are the four acceptance states of §6 reported separately?
- Does anything imply Tunnel can become a public plugin? Correct it.

## 8. Open gates (owner action)

1. One live test of the cross-account tunnel listing question (`installer-v1-review` §3) — only needed if the second Mac is not signed in to the owner's own account.
2. One real cold-start test of the side panel without Native host.
3. Real idempotent `local:setup` rerun + doctor + ChatGPT `inspect_page` (pending in `ROADMAP.md`).

## 9. Amendments

### A1 — 2026-09-21, owner decision: installer-first, two distribution paths

1. **Two paths.** Technical users (e.g. family): Git repository + AI-assisted setup; documentation only, no simplified installer. Non-technical users: a guided Installer; this is the current priority.
2. **Baseline = what already works on the owner's Mac** (ChatGPT Side Panel + DeepSeek WebMCP). The installer packages it; it does not redevelop or restructure it.
3. **Stages replaced.** S0 finish the DeepSeek P6 baseline (owner decision 2026-09-21: finish it before packaging). S1 release inventory (per product: features, dependencies, install and diagnose entrypoints, known limits). S2 Installer: guided UI, automatic dependencies, permission prompts, connection check, uninstall (former Stage 2 merged in). S3 clean-Mac / new-user acceptance and fixes; it gates handing the installer to non-technical users, not development (local checks continue during development). S4 Browser MCP model extension: local model, company model, company web-AI (former Stage 3 + E1). Hosted stays as decided in §3 Stage 4.
4. **Installer constraint.** The installer owns no model logic and no page-execution logic. It calls each component's own install/diagnose/uninstall entrypoints and reports their state.

Facts recorded while amending (verified in repos, 2026-09-21):
- DeepSeek WebMCP is not "finished" per its repo: the P6 Side Panel work lives on branch `p6-compact-assistant`; `docs/p6-live-test.md` says "Partly PASS". Open: a provider window fully covered by the work window goes hidden on macOS (FAIL, options undecided) and several live items are not run. The baseline for S1 must therefore name a specific commit and state this limit.
- Three install entrypoints exist today: Browser panel `local:setup`, Native `webmcp-bridge` installer, DeepSeek `install.sh` (with Uninstall). Docker Desktop is a shared prerequisite of **both** local-coding paths (ChatGPT Native runs in a hardened Docker container; DeepSeek local tools too). Page reading/filling on either product does not need Docker. DeepSeek also needs Node 22+ today.
- The ChatGPT half needs an OpenAI tunnel plus a Tunnels Read+Use runtime key that only an org admin key can create (`installer-v1-review` §2.3). Whether another account can list that tunnel is the feasibility gate for the ChatGPT half (§8.1); the DeepSeek half has no such dependency.

Decisions (owner, 2026-09-21):
- **Installer form: AI-assisted install, not a GUI installer.** The recipient uses a helper AI that can execute terminal commands. Deliverables: one unified entry that installs selected components (Browser panel, DeepSeek, local coding), one `doctor` with fixed-format PASS/FAIL output, and an AI-readable runbook (ordered steps, exact commands, expected output, failure handling; the AI asks the human only for folder choice and logins). Steps only the user can do stay manual: Chrome Developer Mode + load extension, ChatGPT connector/tunnel selection, logins, installing/starting Docker Desktop. The same entry serves technical users (merge/simplify the three existing installers behind it; do not rewrite Native's security-critical host/immutable-runtime logic). No Apple Developer Program needed.
- **First non-technical release includes local coding** (Docker-backed), so the helper AI sets up everything in one pass.
- **DeepSeek provider window: product rule is "keep a strip of the provider window uncovered".** A fully covered window goes hidden on macOS and DeepSeek then renders no answer; the earlier roadmap §6 note that a fully covered window works is superseded.

### A2 — 2026-09-21, owner decisions: repo access, two ChatGPT distribution paths

1. **Repositories stay private during development**; they are made public (with a licence and a secret/history audit) when development is done. Until then a recipient gets access only by explicit collaborator invite.
2. **ChatGPT has two distribution paths.**
   - **P1, technical users:** Secure MCP Tunnel, the recipient creates their own tunnel; the work is a simplified, unified install (Local track, the current installer work).
   - **P2, non-technical users:** AI-assisted install, and the connection goes through the owner's VPS, not a Tunnel (Hosted Relay track). The Panel then needs no `tunnel-client`, Node runtime, LaunchAgent or Native Messaging host on the user's Mac.
3. **Consequence for P2:** its ChatGPT half depends on Hosted Relay work that does not exist yet: H1 (single-device `inspect_page` POC), H2 (full tool surface on the intended ChatGPT plan, unverified), authentication/pairing and the privacy boundary (page content transits the VPS). It cannot ship before those. Local coding for ChatGPT under P2 (Native/Docker on the user's Mac) has no relay design yet and is open.
4. **Non-technical order:** DeepSeek first (browser tools + Docker local coding, no tunnel, no VPS, already has an installer); ChatGPT via VPS after Hosted H1/H2.
5. **Extension ID** (Chrome's 32-letter identifier, derived from the install folder for unpacked extensions, so it differs per computer) matters only where a Native Messaging host must name the allowed extension. DeepSeek's manifest already carries a fixed `key`; the Panel's does not. Needed for P1 (Tunnel + Native Messaging); not for the P2 Panel (WebSocket to the VPS).

### A3 — 2026-09-21, records so they are not researched twice

**Fixed extension ID and a future Chrome Web Store listing.**
- The Panel's `manifest.json` `key` is **self-generated** (commit `1c5e610`); ID `podhehbmgkecchcfmffhfjaakedjgcbe`. The private key is at `~/.local/share/chatgpt-embedded-panel/extension-key.pem` (0600, not in the repo; needed only for packaging a CRX). DeepSeek's extension has its own fixed `key`.
- **If the Panel is ever listed on the Chrome Web Store, its ID will change once.** Migration checklist: (1) create the store developer account and upload the zip unpublished; (2) take the public key shown in the dashboard's Package tab and put it in `manifest.json` `key` so unpacked and store builds share the store's ID (re-verify this against Chrome's current `key` documentation at that time); (3) update `PANEL_EXTENSION_ID` in `scripts/extension-id.mjs` (`tests/extension-id.test.js` fails if it drifts from the key); (4) users must re-run `npm run local:setup` because the Native Messaging host manifest names the allowed ID; make the host accept **both** the old and new origin during the transition (`nativeHostManifest` currently writes one `allowed_origins` entry); (5) extension storage is per ID and starts empty for the new ID.
- Why a self-generated key now: technical/family use needs no store account; the ID stability only serves the Tunnel + Native Messaging path.

**Relay hostname for a future Hosted Relay (no work needed now).**
- Host facts are kept in the owner's private infrastructure notes and are not published. Known there: the main domain's DNS is Cloudflare-proxied; existing sub-hostnames are served by a reverse proxy on the same host, one of them DNS-only for WebSocket use. Whether a name under that domain could be Cloudflare-proxied was **not verified** (an earlier statement that it cannot was unsupported and was corrected after the Codex review).
- Recipe when needed: add a DNS-only A record for the relay hostname pointing at the chosen host; add a reverse-proxy site block (it issues the certificate); run the relay as its own isolated unit; the owner approves each production change. DNS-only keeps a CDN from seeing page content. A free-domain provider name is acceptable for H1 on the owner's own machine; use a real registered domain before anyone else depends on it.

**H2-lite result (owner test, 2026-09-21).**
- Account: ChatGPT **Plus**. Path: existing Secure MCP Tunnel + ChatGPT Embedded Panel. Test page: `https://httpbin.org/forms/post`.
- `fill` worked: after the owner pressed Submit, httpbin echoed `custname: "Bo"` and `custtel: "12345678"` with the other fields empty. The assistant refused to press Submit itself; that refusal is the product's own owner rule (`CONFIRMATION_REQUIRED` from the page executor), not a ChatGPT policy.
- So write tools work from a **Plus** account over the **Tunnel** path. Not established: whether a Plus account can write through a **public-URL connector** (the Hosted path). The Help Center says full MCP writes are Business/Enterprise/Edu only and Pro read-only for MCP connectors, yet the Tunnel path wrote on Plus; the likely reading is that the statement does not cover the private Tunnel path, but this is an inference. The Hosted path still needs its own one-tool test before any relay code (see `hosted-relay-go-no-go.md` C1).


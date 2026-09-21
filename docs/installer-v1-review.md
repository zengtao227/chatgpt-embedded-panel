# Installer / Onboarding V1 — Architecture & UX Review

Date: 2026-09-20. Read-only review; no code changed.
Evidence: real `tunnel-client` v0.0.14 binary on this Mac, official OpenAI docs, Chrome extension docs, live checks on this machine.

---

## 1. Current V1 verdict

**NEEDS CHANGE.**

The orchestration boundary is right and worth keeping, but V1 still hands a non-technical user
four developer-grade prerequisites — install Node, download and un-Gatekeeper an unsigned binary,
create an OpenAI Platform tunnel + runtime API key, and copy a 32-character extension ID — and at
least two of them are verified to fail outright on a clean machine.

---

## 2. Biggest onboarding friction (ranked by real user pain)

### 1. Node.js is a hard prerequisite, and the Node check itself is broken

`installer/Install.command` uses `#!/bin/zsh` + `command -v node`. A shebang'd script is a
non-interactive, non-login shell: it reads `/etc/zshenv` and `~/.zshenv` only, **not** `~/.zshrc`.
Verified on this machine:

```
$ env -i HOME="$HOME" /bin/zsh -c 'command -v node'
NODE NOT FOUND in bare env
$ command -v node
/Users/<user>/.nvm/versions/node/v22.19.0/bin/node
```

So a user who *has* Node via nvm is told to go install Node. And a user who genuinely has no Node
is sent to nodejs.org — which is exactly the "developer setup" the product is trying to escape.
The runtime needs Node permanently too (`browser-mcp/stdio-server.js`, `browser-native-host.js`),
so this is not a one-off install-time cost.

Second-order defect: `prepareBrowserMcpLauncher` bakes `process.execPath` into the launcher. On
this machine that is an nvm path (`~/.nvm/versions/node/v22.19.0/bin/node`) — it disappears on the
next `nvm install`, silently killing Browser MCP with no user-visible cause.

### 2. `tunnel-client` is ad-hoc signed — a browser download is Gatekeeper-blocked

Verified against the real binary:

```
CodeDirectory flags=0x20002(adhoc,linker-signed)
Signature=adhoc
TeamIdentifier=not set
$ spctl -a -vv -t execute .../tunnel-client
.../tunnel-client: rejected
```

The current flow (open the release page → user downloads in a browser → `choose file`) attaches
`com.apple.quarantine`. The installer then does `execFileSync(destination, ['help','quickstart'])`,
which Gatekeeper refuses. The user gets "cannot be opened because the developer cannot be verified"
and must find System Settings → Privacy & Security → Open Anyway. That is a hard stop for the
target user.

The fix is available and legitimate: the official release publishes a per-asset checksum file.
Verified:

```
tunnel-client-v0.0.14-darwin-arm64.zip
SHA256SUMS.txt
https://github.com/openai/tunnel-client/releases/latest → 200
```

A `curl`/`fetch` download performed *by the installer* does not set the quarantine attribute
(quarantine is opt-in by the downloading app via `LSFileQuarantineEnabled` — this is not a
circumvention), so an installer-driven download + SHA-256 verification both removes the manual step
and removes the Gatekeeper wall.

Scope this honestly, though: **OpenAI's `SHA256SUMS.txt` carries no signature** — the release has no
`.sig`, `.asc`, or attestation asset. The pin therefore protects against a corrupted or intercepted
download, not against a compromised release. And notarizing *your own* installer at Commercial does
nothing about `tunnel-client` being ad-hoc signed; those are two separate problems and only the
first one is yours to fix.

### 3. Creating the OpenAI tunnel + runtime API key

This is the deepest friction and the current V1 does not touch it. Verified from the real CLI:

- `tunnel-client admin tunnels create|list|update|delete` **requires an org Admin API key**
  (`OPENAI_ADMIN_KEY`) plus Tunnels Read + Manage.
- `tunnel-client runtimes create` (create tunnel) needs the same admin key.
- `runtimes connect --tunnel-id <existing>` needs only a runtime key with Tunnels Read + Use.
- Official docs: "Creating or editing a tunnel requires Tunnels Read + Manage… running
  tunnel-client or selecting the tunnel while creating an app requires Tunnels Read + Use.
  Tunnel permissions apply to a Platform organization."

So: **tunnel creation is automatable, but only with an admin key, which must never be shipped to a
user.** Asking a non-technical user to visit platform.openai.com, create an org-scoped tunnel and a
runtime API key, and understand the Read/Use/Manage split is not a viable V1 step.

The escape hatch is pre-provisioning — see §3 and the open question below it.

### 4. Load unpacked + copy/paste the extension ID

Two GUI steps plus a 32-character transcription, with a validation regex that will just reject a
mistyped paste. Fully avoidable — see §4 CHANGE #1.

Side note verified: `open -a "Google Chrome" chrome://extensions/` **does work** (Chrome's active
tab reported `chrome://extensions/` afterwards). That part of the flow is fine.

### 5. ChatGPT developer-mode app creation + tunnel selection

Per OpenAI's help docs this is a UI-only path: Plugins → `+` → developer-mode app → Connection =
Tunnel → select the listed tunnel or paste a `tunnel_id`. There is no documented API to create the
ChatGPT-side app. This step cannot be removed for Family V1 or Beta; it goes away only when the app
is published through the plugin/app directory.

---

## 3. Recommended Family V1

The design goal: the brother answers **zero questions** and performs **two GUI actions**.

### Owner-side, done once by you (not by him)

1. Add a `"key"` to `manifest.json` so the extension ID is deterministic everywhere
   (official docs: with `key` set, "the extension will use the same ID"). **Get that key from the
   Chrome Web Store dashboard, not from a self-generated keypair** — pay the one-time $5 developer
   fee, zip the extension, upload it *without publishing*, then Package tab → View public key. A
   self-generated key works for Family V1 but the store assigns its own key at Beta, which changes
   the extension ID and silently breaks every existing install's `allowed_origins` binding.
   $5 and one upload now buys ID continuity all the way to Commercial. Derive the ID offline from
   that key (first 128 bits of SHA-256 over the DER public key, mapped to `a`–`p`) and hardcode it.
2. Create *his* tunnel and a dedicated runtime API key in your Platform org, scoped Tunnels
   Read + Use, associated with his ChatGPT context. Name the tunnel something he will recognise
   in the dropdown, e.g. `Browser Panel — <his name>`.
3. Build one personalised archive: `ChatGPT Panel Setup.zip` containing `Install.command`,
   `app/`, a bundled `bin/node`, and a `config.json` holding the tunnel id + runtime key.

### His side

1. Download the link you sent; double-click the zip; double-click `Install.command`;
   click **Open** on the one Gatekeeper prompt.
2. Installer runs unattended: downloads `tunnel-client` from the pinned official release URL and
   verifies the SHA-256, installs the app, writes the Native Messaging host already bound to the
   known extension ID, writes the tunnel profile and runtime key at 0600, installs the LaunchAgent,
   then opens `chrome://extensions` plus the app folder.
3. **Manual step 1:** Developer mode → Load unpacked → pick the highlighted folder. Nothing to copy.
4. **Manual step 2:** installer opens ChatGPT Plugins; he creates the developer app, picks
   Connection = Tunnel, and clicks the tunnel already named after him.
5. Done. Afterwards: click the extension icon.

Everything he used to type — tunnel id, runtime key, extension id, tunnel-client location — is gone.

### Open question that must be settled before you ship this

Whether his personal ChatGPT account can select a tunnel that lives in **your** Platform org is
**not settled by the docs**. The docs say a tunnel "can be associated with one or more Platform
organizations or ChatGPT workspaces" and that the app creator needs Tunnels Read + Use, but they
only state the negative case ("a tunnel associated only with a personal Platform organization
doesn't automatically appear in an Enterprise/Edu workspace").

Test before building the personalised installer: invite him to your Platform org with Tunnels
Read + Use, associate the tunnel with his context
(`tunnel-client runtimes create --organization-id … --workspace-id …`), and have him check whether
the tunnel is listed in ChatGPT Plugins → Tunnel.

- **If it lists:** the flow above works as written.
- **If it doesn't:** he needs his own Platform org, and the only thing you can pre-fill is
  guidance. In that branch, V1 keeps a two-field paste (tunnel id + runtime key) but you walk him
  through creating them once on a screen-share — and automating this properly becomes a Beta item
  (see §6).

---

## 4. KEEP / DELETE / CHANGE

### KEEP

- **Installer-as-orchestration.** No duplicated Browser MCP / Native Messaging / launchd logic.
  This is the reason the review is "needs change" and not "redesign".
- **Stable install root** under `Application Support/.../app` instead of running from Downloads.
- **Runtime key handling**: AppleScript hidden-answer dialog, 0600 file, never on argv, never
  logged. Correct and worth preserving verbatim.
- **Browser owns its own `tunnel-client`, key, data root, logs.** See §5 answer to question C.
- **`install-browser-tunnel-launchd.mjs` preflight** (connect → `status --json ready:true` →
  assert ephemeral `listen_addr`) before any plist reaches disk. This is genuinely good
  engineering; keep it.
- **`--tunnel-id` / `--runtime-key-file` / `--extension-id` non-interactive flags.** They become
  the mechanism for the zero-question personalised installer.

### DELETE

- **The "open the release page, download, choose file" branch of `resolveTunnelClient`.**
  Replace with a pinned download + checksum. Keep the local-discovery fast path.
- **The extension-ID paste prompt** (`guideExtensionInstall`'s `promptText`). Dead once `key` is
  in the manifest.
- **The Node.js "go install it" dialog in `Install.command`**, once Node is bundled.

### CHANGE

1. **Add `"key"` to `manifest.json`.** Highest value-per-effort item in the review. It makes the ID
   identical across machines, lets the installer bind Native Messaging *before* the extension is
   ever loaded, and removes the transcription step.
2. **Install a product-private Node, downloaded by the installer.** `Install.command` uses only
   macOS built-ins (`uname -m`, `curl`, `tar`, `shasum`), detects `arm64`/`x64`, downloads a pinned
   Node 22 tarball from nodejs.org, verifies it against `SHASUMS256.txt`, unpacks it to
   `<installedRoot>/runtime/node`, and only then runs `onboard-macos.mjs`. Point the native-host
   launcher and `browser-mcp-server` at that path. Fixes the prerequisite, the broken
   `command -v node` check, and the nvm-path rot in one move, without a ~50 MB archive.

   Pin **v22.23.2** (current v22 LTS, "Jod"). Downloading rather than bundling is strictly better
   here, verified against the real binary: Node's macOS tarball is Developer ID signed with
   hardened runtime, and its checksum file is GPG-signed —

   ```
   Authority=Developer ID Application: Node.js Foundation (HX7739G8FX)
   CodeDirectory flags=0x10000(runtime)
   https://nodejs.org/dist/v22.19.0/SHASUMS256.txt.asc -> 200
   ```

   so Node clears Gatekeeper on its own merits regardless of how it arrives. Re-shipping a copy
   inside your zip would instead carry the zip's quarantine and detach it from that signed
   checksum chain.
3. **Make upgrades non-destructive.** `installRuntime` currently does
   `rmSync(installRoot, {recursive:true})` then `renameSync`. That deletes the directory Chrome has
   loaded as an unpacked extension, so Chrome unloads it and the user must Load unpacked again.
   Stage next to the target and swap via `renameSync` of the old directory out first, or write into
   a versioned dir with a stable symlink. (`key` fixes the ID half of this; it does not stop the
   unload.)
4. **Download `tunnel-client` in-process with SHA-256 pinning** against `SHA256SUMS.txt`, selecting
   `tunnel-client-v<ver>-darwin-<arch>.zip` by `process.arch`. Avoids quarantine entirely.
5. **Write an uninstaller now, not later.** The handoff defers this pending an "ownership decision",
   but for a family user "how do I remove this" has to be one double-click:
   `launchctl bootout`, remove the plist, the NativeMessagingHosts manifest, the app dir, the key
   file, `~/.local/share/chatgpt-embedded-panel`, `~/.chatgpt-embedded-panel`, and the
   `browser-mcp` profile. Nothing about that is coupled to the Native WebMCP question — the paths
   are already disjoint.
6. **Add a one-click health check.** With a LaunchAgent, silent failure is the default failure mode.
   `tunnel-client health` / `runtimes status --json` already exist; surface them as a
   `Check Connection.command` (or a menu-bar item later) rather than asking him to read logs.

---

## 5. Packaging comparison

| Option | Solves | Costs | Verdict |
|---|---|---|---|
| **`Install.command` (current)** | Already written and tested; no Apple developer account needed | One Gatekeeper "Open" prompt; can't force-install the extension; can't get root | **Family V1 — keep** |
| **`.pkg`** | Could do sudo work (enterprise policy, `/usr/local` placement); familiar double-click | An *unsigned* `.pkg` is a **worse** first-run than a `.command` on current macOS. Signing needs a Developer ID Installer certificate = the $99/yr Apple Developer Program, which you explicitly declined and shelved permanently for Codex Remaining | **Not for V1/Beta unless the $99 decision is revisited** |
| **Companion `.app`** | Status, diagnostics, upgrade, uninstall in one GUI | Same notarization problem, plus a whole new UI surface to build and maintain — and it does not remove a single one of the five frictions in §2 | **Defer to Commercial** |
| **Chrome Web Store (unlisted)** | Kills Load unpacked, gives a permanent ID and auto-update, no Gatekeeper | Requires a $5 one-time developer account and a review pass. Visibility choice is not the risk: Unlisted = anyone with the URL, Private = named tester accounts (no Workspace needed), domain publishing = needs Workspace — but **all visibility levels go through the same review**. This extension strips `X-Frame-Options`/`CSP` from `chatgpt.com` responses and requests `nativeMessaging` + `http(s)://*/*` — extensions doing header stripping *do* exist on the store, so it is not categorically banned, but expect slow review and be ready to justify the narrow `sub_frame` + own-extension-initiated scope. Framing `chatgpt.com` is also an OpenAI ToS question for a commercial product | **Beta — the right answer, and the cheapest of the four** |

On the extension-ID question specifically: use **`manifest key` now** and let the **Chrome Web
Store fixed ID** take over at Beta. They are compatible *only if* the manifest `key` is the one the
store issued — i.e. the unpublished-upload step in §3 must happen before Family V1 ships. Do that
and the ID never changes from unpacked through store-installed. Self-generate the key instead and
the ID changes at Beta, breaking the Native Messaging `allowed_origins` binding on every V1
install — the exact silent failure §4 CHANGE #6 exists to catch.

On enterprise-policy force-install: Chrome's own docs state that on Windows and macOS, off-store
extensions can only be installed via enterprise policy, and that the external-preferences path
requires a Chrome Web Store `update_url`. Policy-based force-install of a self-hosted CRX on macOS
needs a managed-preferences plist written as root, and there is a known Chromium report of
self-hosted force-installed extensions flickering on macOS restarts. Not worth it for one brother;
reconsider only if the Web Store path is actually rejected.

---

## 6. Family → Beta → Commercial

### Family V1 — one user
- `manifest key`; bundled Node; checksum-pinned `tunnel-client` download; personalised installer
  carrying tunnel id + runtime key; uninstaller; health check.
- Extension: Load unpacked, once.
- Tunnel: you pre-provision it by hand in your Platform org.
- Shipping a runtime key inside the installer is acceptable **here only** — one recipient,
  out-of-band delivery, instantly revocable, Tunnels Read+Use scope only.

### Beta — 10–100 users
- **Chrome Web Store unlisted listing.** Removes Load unpacked, dev-mode nagging, and manual
  updates. This is the step that turns the product from "my brother" into "people I know".
- **A tiny provisioning endpoint on your VPS** that holds the `OPENAI_ADMIN_KEY` and issues one
  tunnel + one runtime key per user on request. Important framing: this is a **control plane, not a
  data plane** — it provisions credentials and never sees `inspect_page` output or form data. It
  does not violate the local-first constraint and it is not Hosted Relay. It is the only way to
  kill friction #3 at scale, because admin keys can never ship to users. Verify separately that
  runtime *keys* can be minted via API — the admin key is confirmed to create tunnels, not keys.
  Note this plan depends on the **same** open question as §3: it also puts every user's tunnel in
  your Platform org, so one test settles both V1 pre-provisioning and the Beta control plane.
- Auto-update for the local runtime (versioned install dir + a check on login).
- This is also where the $99 Apple question has to be re-answered: a signed/notarized helper stops
  being optional once strangers are installing it.

### Commercial — paying users
- Public Chrome Web Store listing plus a published ChatGPT app, which finally removes the
  developer-mode app creation step (friction #5).
- Signed + notarized companion `.app` for install/status/upgrade/uninstall.
- Page data still never transits your servers; only provisioning does. Keep that promise explicit
  and testable, because it is the product's differentiator.

---

## 7. Final recommendation

**Keep `Install.command` and the orchestration-only design. Do not build a `.pkg` or a companion
app. Spend Family V1 entirely on deleting user input, in this order:**

1. `manifest key` → extension ID is known before install; the ID paste step disappears and Native
   Messaging can be pre-bound.
2. Bundle Node → the prerequisite and the broken `command -v node` check both disappear.
3. Checksum-pinned in-installer `tunnel-client` download → the manual download and the Gatekeeper
   wall both disappear.
4. Pre-provision his tunnel and runtime key in your org and personalise the archive → both prompts
   disappear. **Verify the cross-org listing question in §3 first.**
5. Add an uninstaller and a health check, because a LaunchAgent that fails silently is the one
   failure mode a non-technical user cannot diagnose.

That leaves him with: download, double-click, Open, Load unpacked, pick his tunnel in ChatGPT.
Two GUI actions, zero typing, no Terminal — which is the actual goal. Chrome Web Store at Beta
removes one of those two, and the published ChatGPT app at Commercial removes the other.

---

## C. Should Browser be fully independent of Native WebMCP?

**Yes. The current direction is correct.** Browser owning its own `tunnel-client` copy, runtime key,
data root and logs is the difference between a product and a second copy of your dev machine. One
gap remains: `install-browser-tunnel-launchd.mjs` still *defaults* to
`~/.local/share/webmcp` and to reading the runtime key out of `native.yaml` when the installer's env
overrides are absent. That default is fine as a documented developer compatibility path, but it
should fail loudly rather than silently reach into Native WebMCP's files if it is ever invoked on a
machine that has no Native WebMCP.

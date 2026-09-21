# Release Inventory v1 (A1 stage S1)

Date: 2026-09-21. Read-only inventory of what the non-technical installer must package. Sources: each repo's README/docs/`package.json`/`install.sh`, `gh repo view`. Governing record: `architecture-decision-v1.md`.

## 1. Components

| | ChatGPT Embedded Panel (Browser) | Native `webmcp-bridge` (ChatGPT local coding) | DeepSeek WebMCP |
|---|---|---|---|
| Gives the user | ChatGPT side panel + page read/fill tools | ChatGPT reads/writes local project, runs commands (5 tools, Docker-isolated) | DeepSeek side panel + page tools + local coding |
| Repo | `chatgpt-embedded-panel` — public, MIT (published 2026-09-21; the full development history stays in a private repository) | `webmcp-bridge` — **PRIVATE**, no license | `deepseek-webmcp` — public, MIT |
| Install entry today | Load unpacked, then `npm run local:setup -- --tunnel-id <id> [--runtime-key-file <path> --tunnel-client <path>]` (`--extension-id` optional, defaults to the pinned id) | `npm run webmcp -- install --root <dir> --tunnel-id <id> [--tunnel-client --runtime-key-file]` | one-line `install.sh` (README), then Developer mode + load unpacked |
| Doctor | `npm run local:doctor` | `webmcp status` / `doctor` | `npm run doctor` |
| Uninstall | `npm run local:uninstall [--dry-run]` (Browser-only) | `webmcp uninstall` | panel Settings Uninstall / `npm run uninstall` |
| Prerequisites | Chrome, Node 22+, `tunnel-client`, tunnel id + runtime key file, extension id | Node 22+, Git, Docker running, `tunnel-client`, tunnel id + runtime key, **clean Git checkout of reviewed source** (source archive not accepted) | Git, Node 22+, Docker Desktop running, Chrome or Comet |
| Long-running pieces | LaunchAgent `com.webmcp.browser-tunnel`, Chrome Native Messaging host | LaunchAgent `com.webmcp.native-tunnel`, container, immutable host runtime | one-shot Native Messaging host, Docker image |
| Install location | The checkout (Local Expert / AI-assisted path) | Git checkout + `~/.local/share/webmcp` | `~/deepseek-webmcp` |
| Needs OpenAI tunnel | yes (Browser tunnel) | yes (Native tunnel; separate tunnel) | **no** |
| Owner-only manual steps | Chrome Developer mode + Load unpacked; ChatGPT: enable Browser MCP app, choose Tunnel | Choose workspace root; create/select tunnel + key; connect the App in ChatGPT | Chrome Developer mode + Load unpacked; login to DeepSeek; choose folder |

## 2. Shared dependencies

- Node 22+: all three. Git: Native and DeepSeek. Docker Desktop (running): Native and DeepSeek local coding; **not** needed for page reading/filling.
- `tunnel-client` and one runtime key: Panel and Native. A Native runtime key was verified valid for the Browser tunnel (2026-09-20 handoff), so one key can serve both; Panel `local:setup` already reuses Native's client and key file if present.
- Chrome: all three (DeepSeek also Comet). Two separate extensions, each with its own side panel and Native Messaging host.

## 3. Findings that change the installer design

1. **Repository access.** `deepseek-webmcp` and `chatgpt-embedded-panel` are public (MIT). `webmcp-bridge` (Native) is still private and needs a real Git checkout (source-gated image/host runtime), so a recipient needs a GitHub collaborator invitation for it until it is published; publishing it needs its own history and licence clean-up first (a real tunnel id sits in old history, no licence).
2. **The ChatGPT half needs OpenAI tunnels + a runtime key** created with an org admin key (`installer-v1-review` §2.3). Two tunnels (Browser, Native) per recipient, or one per recipient if the two are ever merged. Whether another account can list a tunnel from the owner's org is untested. This gates the ChatGPT half; DeepSeek has no such dependency.
3. **Extension ID (resolved 2026-09-21, `1c5e610`):** the Panel's manifest now carries a self-generated `key`, so the id is fixed (`podhehbmgkecchcfmffhfjaakedjgcbe`) and `local:setup` defaults to it. A future Chrome Web Store listing changes it once; see `architecture-decision-v1.md` A3.
4. **Three installers, no shared state.** Each checks Node/Docker itself and stops with "install X, run again". A single entry must run these checks once and install the prerequisites in order.
5. **Family V1 prototype retired (2026-09-21).** The owner-authorized cleanup removed its uncommitted entrypoint, incomplete payload builder, dedicated tests and Family-only overrides. Earlier findings in `architecture-decision-v1.md` §5 describe that historical prototype; the current route is the component installers plus `setup/INSTALL-FOR-AI.md`.
6. **DeepSeek baseline is `main`** (P6 side panel merged 2026-09-21; the installer must name the commit it installs, currently `b3a1b14`). Owner-verified live: panel opens from the icon, Reload recovery, folder + Docker, Uninstall/Full-access dialogs, rich answers + Copy, reading a real page. Known limits: a fully covered provider window cannot render (keep a strip visible); on a real webmail the Reply click works but the message body could not be filled (cause not investigated; the same shared `target-executor.js` runs in the ChatGPT Panel, so treat it as a shared limit until proven otherwise); fill/Submit-refusal/Stop on a real page were not reported live (covered by E2E on fixture pages only).
7. **DeepSeek `install.sh` already does the right thing for an AI helper** (checks, clear stop messages, idempotent update); the other two lack an equivalent single command.

## 4. Steps only the user can do (an AI helper cannot)

Install Docker Desktop and start it; Chrome Developer mode and Load unpacked (the helper can open the pages and name the folder); logins (ChatGPT, DeepSeek); ChatGPT connector creation and tunnel selection; choosing the workspace folder; any credential that must not pass through a model conversation (the runtime key goes into a local 0600 file, never a chat).

## 5. Open decisions for the owner

1. Repo access for recipients (finding 1).
2. Tunnel/key provisioning for the ChatGPT half (finding 2): run the live cross-account listing test, or ship DeepSeek first.
3. (Decided for now: self-generated key; revisit if a Web Store listing is ever wanted.)

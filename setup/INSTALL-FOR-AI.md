# Install runbook for a helper AI (macOS)

You are helping a person install WebMCP components on their Mac. They may not be technical. Talk to them in their own language; keep commands and tool output verbatim. Follow this file step by step; do not improvise around a failure.

## Rules

1. Ask the person only: (a) which products they want, (b) which folder the coding assistant may work in, (c) for the ChatGPT products, their tunnel ids and where their key file is. Nothing else.
2. **Secrets never pass through chat.** Never ask the person to paste a runtime API key to you, and never print one. To save it: tell them to copy the key (Cmd+C), then run `bash ~/WebMCP/chatgpt-embedded-panel/setup/webmcp-setup.sh save-key`. It writes `~/.webmcp-runtime-key` with mode 600, never overwrites an existing file and never prints the key. If it reports that the file already exists, ask whether to reuse it; to store a different key use `save-key --file ~/.webmcp-runtime-key-2` and pass that path wherever `~/.webmcp-runtime-key` appears below.
3. Stop at the first FAIL. A `FIX ... AUTO` line is a command you may run. A `FIX ... MANUAL` line is something only the person can do: tell them exactly what, wait, then re-run the same check.
4. Never use `sudo`, never delete the person's files, never edit installer-generated configuration by hand, never skip the verification step.
5. Report each step's result in one line. If something is not covered here, stop and say so.

## Choose the components

| Person wants | Components | Needs an OpenAI tunnel |
|---|---|---|
| DeepSeek in a side panel, page tools, local coding | `deepseek` | no |
| ChatGPT side panel that can read/fill web pages | `panel` | yes (Browser tunnel) |
| ChatGPT that can work on local project files | `native` | yes (Native tunnel) |

Start with `deepseek` if the person has no OpenAI Platform tunnel. Tunnels are created by the person in their own OpenAI Platform organization (see https://developers.openai.com/api/docs/guides/secure-mcp-tunnels); you cannot create them for them.

## Step 0 — get the setup script

Git comes first. Run `git --version`. If it fails, run `xcode-select --install`, tell the person to finish the Apple dialog that opens, then re-run `git --version` before going on.

```bash
mkdir -p ~/WebMCP
if [ -d ~/WebMCP/chatgpt-embedded-panel/.git ]; then
  git -C ~/WebMCP/chatgpt-embedded-panel pull --ff-only
else
  git clone https://github.com/zengtao227/chatgpt-embedded-panel.git ~/WebMCP/chatgpt-embedded-panel
fi
```

If `~/WebMCP/chatgpt-embedded-panel` exists but is not a git checkout, stop and ask the person what it is; do not delete it. If clone or pull fails with an authentication or "repository not found" message, the repository is private and their GitHub account has no access: ask them to request an invitation from the owner, sign in (`gh auth login`, or a saved git credential), then retry. A network or DNS message means a connection problem, not access.

## Step 1 — prerequisites (one command for all components)

```bash
bash ~/WebMCP/chatgpt-embedded-panel/setup/webmcp-setup.sh check --components deepseek,panel,native
```

Use only the components chosen. Output lines are `CHECK <id> PASS|WARN|FAIL|SKIP`, `FIX <id> AUTO|MANUAL ...`, and a final `RESULT`. Resolve every FAIL, re-run, and continue only on `RESULT PASS`. Docker Desktop is needed only for `deepseek` and `native`; the tunnel-client only for `panel` and `native`. If `CHECK tunnel-client` fails, its AUTO fix downloads and verifies it into a separate preparation folder; the PASS line then reports its path. Keep that path: pass it to the installers as `--tunnel-client "<path>"` below. Do not copy it into `~/.local/share/webmcp` yourself, Native's installer would then see a partial installation.

## Component `deepseek`

```bash
curl -fsSL -o ~/WebMCP/deepseek-install.sh https://raw.githubusercontent.com/zengtao227/deepseek-webmcp/main/install.sh
bash ~/WebMCP/deepseek-install.sh
```

It downloads to `~/deepseek-webmcp`, builds the local runtime (a few minutes the first time) and asks once which folder DeepSeek may work in. Then the person, in Chrome or Comet: open `chrome://extensions`, turn on Developer mode, drag the folder `~/deepseek-webmcp/extension` onto the page. To use it: click the DeepSeek WebMCP toolbar icon on any ordinary web page. The side panel opens and a separate DeepSeek window is created; the person logs in to DeepSeek in that window (you never handle their DeepSeek credentials) and keeps a strip of it uncovered.

Updating an existing install: run the same two commands, then the person clicks the extension's reload icon on `chrome://extensions`. Reopen the panel; if it says the provider is not ready, press **Restore**.

## Component `native` (ChatGPT local coding)

```bash
git clone https://github.com/zengtao227/webmcp-bridge.git ~/WebMCP/webmcp-bridge
cd ~/WebMCP/webmcp-bridge
npm run webmcp -- install --root "<work folder>" --tunnel-id <native tunnel id> --runtime-key-file ~/.webmcp-runtime-key --tunnel-client "<path from CHECK tunnel-client>"
npm run webmcp -- doctor
```

The work folder is the narrowest folder the person is happy for ChatGPT to change. Afterwards the person creates the WebMCP app in ChatGPT (Plugins, developer mode, connection = Tunnel, pick their Native tunnel). The installer does not do this.

## Component `panel` (ChatGPT side panel)

```bash
cd ~/WebMCP/chatgpt-embedded-panel
npm run local:setup -- --tunnel-id <browser tunnel id> --runtime-key-file ~/.webmcp-runtime-key --tunnel-client "<path from CHECK tunnel-client>"
npm run local:doctor
```

The person, in Chrome: `chrome://extensions`, Developer mode, **Load unpacked**, choose `~/WebMCP/chatgpt-embedded-panel`. The extension id must read `podhehbmgkecchcfmffhfjaakedjgcbe`; if it differs, stop and report. Then in ChatGPT: enable the Browser MCP app with connection = Tunnel and their Browser tunnel.

## Step 2 — verify

```bash
bash ~/WebMCP/chatgpt-embedded-panel/setup/webmcp-setup.sh doctor --components deepseek,panel,native
```

A chosen component that is not installed is reported `NOT-INSTALLED` and counts as a failure: never present that as success. `doctor` passing is not the same as working. Report four separate facts per product: the side panel opens; the local connector is healthy (doctor); the product is connected (ChatGPT app lists the tools / DeepSeek is logged in); a real call succeeds (open any ordinary web page and ask the assistant to read it).

## Versions and pinning

Development installs follow branch heads: `main` for each component and for DeepSeek's `install.sh`, and the latest `tunnel-client`. A release install must be pinned. Tested `tunnel-client`: `v0.0.14` (`webmcp-setup.sh fetch-tunnel-client --version v0.0.14`). The component commits to install are named in `docs/release-inventory-v1.md`. DeepSeek's `install.sh` has no pin option yet; adding one is a release-time task. Do not present a development install as a release.

## Known situations

| Symptom | Action |
|---|---|
| DeepSeek panel says the provider did not become ready | Press **Restore** in the panel |
| DeepSeek panel says its window is hidden | Move windows so a strip of the DeepSeek window stays visible, then press **Restore**. A fully covered window cannot render answers |
| `docker-running` FAIL | `open -a Docker`, wait until it says running, re-run check |
| Extension was reloaded or updated | Reopen the panel; if a DeepSeek tab stays silent, press Restore |
| The panel says the page it was working on is no longer available | The person presses **Stop**, then asks again. The assistant itself keeps running |
| Reply opens in a webmail but the message body is not filled | Known limit (cause not investigated): the assistant cannot fill some webmail editors. The person types the body |
| Anything fails after an update | Run `doctor`, quote the first failing line to the person |

## Uninstall

- `deepseek`: side panel Settings, **Uninstall** (the confirmation dialog is Chrome's own).
- `panel`: `cd ~/WebMCP/chatgpt-embedded-panel && npm run local:uninstall` (add `-- --dry-run` to preview). It leaves `native` alone.
- `native`: `cd ~/WebMCP/webmcp-bridge && npm run webmcp -- uninstall`. If both `panel` and `native` are installed, uninstall `panel` first.

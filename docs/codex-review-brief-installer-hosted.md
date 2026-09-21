# Codex Review Brief — Governing Architecture, AI-Assisted Installer, Hosted Relay Go/No-Go

Date: 2026-09-21
Scope: **review only.** Do not implement, commit, push, reset, clean, or overwrite uncommitted work. Do not run any installer, LaunchAgent, Docker or network-changing command on the owner's machine. Allowed read-only checks: `npm run check` in `chatgpt-embedded-panel`, `bash setup/webmcp-setup.sh check|doctor`, reading files and git history, fetching official documentation.

## Repositories and heads

| Repo | Head | Notes |
|---|---|---|
| `chatgpt-embedded-panel` (private) | `95b13f2` + this brief's commit | Decision/inventory/setup/Hosted docs live here. **Uncommitted and older, out of scope except as superseded:** `installer/`, `scripts/onboard-macos.mjs`, `tests/onboarding-v1.test.js`, modified `README.md`, `package.json`, `scripts/install-browser-tunnel-launchd.mjs` (Family Installer V1) |
| `deepseek-webmcp` (public) | `b3a1b14` | Side panel merged to `main` 2026-09-21; only the installer-facing surface is in scope |
| `webmcp-bridge` (private) | unchanged | Native; has unrelated uncommitted docs, do not touch |
| `browser-webmcp-e2e` (private) | `f729fa9` | Test harness; out of scope |

## Review order

### A. `docs/architecture-decision-v1.md` (frozen record, amendments A1–A3)

Challenge:
1. Are the three fixed rules (execution plane brand-agnostic; adapters only; Native separate) consistent with A1–A3, or did an amendment quietly contradict the original §3/§6?
2. A1 replaced the stage order (DeepSeek finish → inventory → AI-assisted installer → clean-Mac acceptance → model extension). A2 splits ChatGPT into P1 (Tunnel, technical) and P2 (Hosted, non-technical). Is the consequence stated in A2 (P2 blocked on Hosted H1/H2/auth; DeepSeek ships first) complete and correct?
3. A3's Chrome Web Store migration checklist and relay-hostname recipe: any wrong or unverifiable step? (The `key` behaviour on Web Store upload is explicitly marked "re-verify at that time".)
4. Anything stale that a later developer would follow wrongly?

### B. `docs/release-inventory-v1.md`

Verify each cell against the repos' own README/docs (Native `docs/installation.md`, Panel README "Local Expert", DeepSeek README/`install.sh`). Report wrong or missing prerequisites, entrypoints, uninstall order, or manual steps.

### C. `setup/webmcp-setup.sh`, `setup/INSTALL-FOR-AI.md`, `tests/setup-script.test.js`

This is the code/runbook a helper AI will execute on a non-technical person's Mac. Challenge:
1. Correctness on a **clean** macOS (bash 3.2, no Homebrew/nvm, Apple Git shim, Docker Desktop installed but not started). Any construct that fails or misreports?
2. `fetch-tunnel-client`: tag discovery via redirect, SHA-256 against the unsigned `SHA256SUMS.txt`, install to `~/.local/share/webmcp/bin`. Is the security claim in the comment accurate? Anything unsafe (temp files, partial installs, overwriting an existing binary)?
3. Runbook safety for an AI executor: can any instruction be misread into something harmful or into leaking a secret (`umask 077; pbpaste > ~/.webmcp-runtime-key`, key never in chat)? Are the "ask only" and "stop at first FAIL" rules enforceable as written?
4. Are the per-component command sequences and the uninstall order (Panel before Native) consistent with each component's own docs?
5. Do the 7 tests actually exercise the failure branches, or can they pass while the script is wrong?

### D. `docs/hosted-relay-go-no-go.md` (verdict: GO-WITH-CONDITIONS for H1 only; NO-GO for any second person)

Challenge:
1. Re-check the official-documentation claims (public HTTPS connector, plans, write actions, auth, transports). The Help Center article says full MCP writes are Business/Enterprise/Edu only and Pro read-only; the developer guide says all plans. Owner test: on a **Plus** account over the **Tunnel** path `fill` worked (httpbin echo) — is the inference "the Help Center statement does not cover the Tunnel path" reasonable, and is the remaining gap (public-URL connector write on Plus) correctly identified?
2. The §3 minimum auth/isolation table: anything missing before a second person connects? Is the H1 acceptance list sufficient?
3. Privacy/liability section and the Cloudflare finding (main domain is proxied; relay hostname must be DNS-only): correct and complete?
4. The co-tenancy risk of running the relay next to other private services and the C4 isolation condition: adequate, or should another host be preferred?
5. The strongest argument against starting (demand unquantified; DeepSeek already serves non-technical users): does the verdict still hold?

### E. Extension id (`manifest.json` key, `scripts/extension-id.mjs`, `tests/extension-id.test.js`, commit `1c5e610`)

Correct derivation, no private key in the repo, default behaviour of `local:setup`, and the effect on the owner's machine (Native Messaging host currently bound to the old id until `local:setup` is re-run).

## Already verified (evidence)

- Panel `npm run check`: 120/120. DeepSeek `npm run check` 226/226; `npm run e2e` 21/21 (owner-independent rerun).
- `webmcp-setup.sh check` PASS and `doctor` PASS (3 components) on the owner's Mac; `fetch-tunnel-client` in a scratch HOME: checksum matched the official file and the binary is byte-identical to the installed one.
- Chrome-assigned id of the unpacked Panel equals `PANEL_EXTENSION_ID` (real Chromium).
- Owner live acceptance (DeepSeek): panel opens from icon, Reload recovery, folder + Docker, Uninstall/Full-access dialogs, rich answers + Copy, reading a real page.

## Not verified — do not treat as passing

- Any run on a **clean Mac** or by a **real helper AI** following the runbook.
- A write-annotated tool through a **public-URL connector** on Plus (H2 for the Hosted path).
- Whether another account can list a tunnel from the owner's OpenAI Platform org.
- Any Hosted Relay code: none exists.
- Known DeepSeek/shared-executor gap: on a real webmail, the message body could not be filled (cause not investigated); DeepSeek recorded it in `docs/p6-live-test.md`.

## Output format

Classify every finding as **correctness blocker**, **security blocker**, **external-platform requirement** (cite the official source), or **optional**. Give file and line, the failure scenario, and the smallest fix. For each of A–E state explicitly "no finding" when there is none. Do not propose new frameworks or scope beyond what the record already decided.

# Contributing

This repository is the source of truth. Read these first:

1. `docs/architecture-decision-v1.md` — the governing architecture record and its amendments. Check a change against its section 7.
2. `setup/INSTALL-FOR-AI.md` — the install runbook that a helper AI follows on a person's Mac.

## Before every commit

- Run `npm run check`. Everything must pass.
- A change to `setup/webmcp-setup.sh` needs a matching test in `tests/setup-script.test.js`.
- Report real results: if a check fails or was not run, say so.

## Rules that keep the project safe

- **No infrastructure details anywhere** (docs, code, tests, commit messages): no host names, IP addresses, network topology, internal domains, real tunnel ids, keys, personal file paths or private notes. Write "an isolated host" and keep the facts in private notes.
- **Secrets never pass through a chat or a commit.** Runtime keys go into a local file with `setup/webmcp-setup.sh save-key`.
- **The browser execution plane is shared** with DeepSeek WebMCP (`browser-client.js`, `target-executor.js`, `target-binding.js`, task binding and handoff). Change it only for a reproducible correctness problem, with a test, and keep it free of model-specific code.
- **Do not change the `key` in `manifest.json`.** It fixes the extension id that the Native Messaging host is bound to (see amendment A3 in the decision record).
- Submit, send, pay and delete clicks stay with the person; the assistant must never press them.
- Local file and command execution belongs to the separate Native component, not to this extension.

## Commits

Use `type: short description` (`fix:`, `feat:`, `docs:`, `test:`, `chore:`) and explain the reason in the body. Prefer a branch and a pull request for anything larger than a small fix.

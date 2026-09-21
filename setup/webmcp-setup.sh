#!/bin/bash
# WebMCP setup helper for macOS: one fixed-format prerequisite check, one diagnosis, a verified
# tunnel-client download and a safe runtime-key saver. Output lines are stable so that a helper AI
# (or a person) can read them:
#   CHECK <id> PASS|WARN|FAIL|SKIP <detail>
#   FIX   <id> AUTO|MANUAL <command or instruction>
#   DOCTOR <component> PASS|FAIL|NOT-INSTALLED <detail>
#   FETCH PASS|FAIL ...   KEY PASS|FAIL ...   RESULT PASS|FAIL ...
# Nothing here installs a component; each component keeps its own installer (see INSTALL-FOR-AI.md).
set -u

# Non-interactive shells do not load Homebrew or nvm, where Node.js usually lives.
EXTRA_PATH="${WEBMCP_SETUP_EXTRA_PATH-/opt/homebrew/bin:/usr/local/bin}"
if [ -n "$EXTRA_PATH" ]; then PATH="$EXTRA_PATH:$PATH"; fi
if [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true; fi

REPO_BASE="${WEBMCP_SETUP_REPO_BASE:-https://github.com/zengtao227}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Not ~/.local/share/webmcp: Native's installer reads files there as install state, and a lone
# tunnel-client would make its first install look like a partial installation.
PREP_BIN="$HOME/.local/share/webmcp-setup/bin"
ALL_COMPONENTS="panel,native,deepseek"
COMPONENTS="$ALL_COMPONENTS"
FAILED=0

usage() {
  cat <<'EOF'
Usage: webmcp-setup.sh <command> [options]

  check   [--components panel,native,deepseek]
                        prerequisite report for the chosen components
  doctor  [--components ...]
                        run each chosen component's own read-only diagnosis; a component that is
                        not installed counts as a failure
  fetch-tunnel-client [--version vX.Y.Z]
                        download the official OpenAI tunnel-client (default: latest) into a
                        preparation folder and verify its SHA-256; give the installers the reported
                        path with --tunnel-client
  save-key [--file PATH]
                        save the clipboard as a runtime-key file (mode 0600); never overwrites and
                        never prints the key

Components: panel (ChatGPT Embedded Panel), native (ChatGPT local coding), deepseek (DeepSeek WebMCP).
Optional locations: WEBMCP_PANEL_DIR, WEBMCP_NATIVE_DIR, WEBMCP_DEEPSEEK_DIR.
EOF
}

want() {
  local name
  for name in "$@"; do
    case ",$COMPONENTS," in *",$name,"*) return 0 ;; esac
  done
  return 1
}

pass() { echo "CHECK $1 PASS $2"; }
skip() { echo "CHECK $1 SKIP $2"; }
warn() { echo "CHECK $1 WARN $2"; }
bad() { # id detail kind fix
  echo "CHECK $1 FAIL $2"
  echo "FIX $1 $3 $4"
  FAILED=$((FAILED + 1))
}

find_browser() {
  local app
  for app in "/Applications/Google Chrome.app" "$HOME/Applications/Google Chrome.app" "/Applications/Comet.app" "$HOME/Applications/Comet.app"; do
    if [ -d "$app" ]; then basename "$app" .app; return 0; fi
  done
  return 1
}

find_tunnel_client() {
  local candidate
  for candidate in "$PREP_BIN/tunnel-client" "$HOME/.local/share/webmcp/bin/tunnel-client" "$HOME/.local/share/chatgpt-embedded-panel/bin/tunnel-client"; do
    if [ -x "$candidate" ]; then echo "$candidate"; return 0; fi
  done
  command -v tunnel-client
}

repo_of() {
  case "$1" in
    panel) echo "chatgpt-embedded-panel" ;;
    native) echo "webmcp-bridge" ;;
    deepseek) echo "deepseek-webmcp" ;;
  esac
}

cmd_check() {
  echo "WEBMCP-SETUP CHECK components=$COMPONENTS"

  if [ "$(uname)" = "Darwin" ]; then pass macos "$(uname -m)"; else bad macos "$(uname)" MANUAL "This setup supports macOS only."; fi
  if [ "$(id -u)" != "0" ]; then pass not-root "user $(id -un)"; else bad not-root "running as root" MANUAL "Run as your normal macOS user, without sudo."; fi

  if want panel deepseek; then
    if browser="$(find_browser)"; then pass browser "$browser"; else bad browser "no Chrome or Comet in /Applications" MANUAL "Install Google Chrome from https://www.google.com/chrome/ then re-run check."; fi
  fi

  have_git=0
  if command -v git >/dev/null 2>&1 && git --version >/dev/null 2>&1; then pass git "$(git --version)"; have_git=1; else bad git "not installed" AUTO "xcode-select --install"; fi

  if command -v node >/dev/null 2>&1; then
    major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$major" -ge 22 ] 2>/dev/null; then pass node "$(node -v)"; else bad node "$(node -v) is older than 22" MANUAL "Install Node.js 22 or newer from https://nodejs.org/en/download then re-run check."; fi
  else
    bad node "not installed" MANUAL "Install Node.js 22 or newer from https://nodejs.org/en/download then re-run check."
  fi

  if want native deepseek; then
    if command -v docker >/dev/null 2>&1; then
      pass docker-cli "$(command -v docker)"
      if docker info >/dev/null 2>&1; then pass docker-running "engine answers"; else bad docker-running "Docker is installed but not running" AUTO "open -a Docker  (wait until Docker Desktop says it is running, then re-run check)"; fi
    else
      bad docker-cli "not installed" MANUAL "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ , start it, then re-run check."
      skip docker-running "docker missing"
    fi
    free_kb="$(df -k / | awk 'NR==2 {print $4}')"
    if [ "${free_kb:-0}" -ge 10485760 ] 2>/dev/null; then pass disk "$((free_kb / 1048576)) GB free"; else warn disk "under 10 GB free; the Docker image and runtime need several GB"; fi
  fi

  if want panel native; then
    if client="$(find_tunnel_client)"; then pass tunnel-client "$client"; else bad tunnel-client "not found" AUTO "bash \"$SCRIPT_DIR/webmcp-setup.sh\" fetch-tunnel-client   (then give the installers the reported path with --tunnel-client)"; fi
  fi

  local name repo
  for name in panel native deepseek; do
    want "$name" || continue
    repo="$(repo_of "$name")"
    if [ "$have_git" = 1 ]; then
      if GIT_TERMINAL_PROMPT=0 git ls-remote --exit-code "$REPO_BASE/$repo.git" HEAD >/dev/null 2>&1; then
        pass "repo:$repo" "readable"
      else
        bad "repo:$repo" "cannot read $REPO_BASE/$repo.git" MANUAL "The repository may be private. Ask the owner to invite your GitHub account, sign in on this Mac (gh auth login, or a saved git credential), then re-run check."
      fi
    else
      skip "repo:$repo" "git missing"
    fi
  done

  if [ "$FAILED" -eq 0 ]; then echo "RESULT PASS failed=0 components=$COMPONENTS"; return 0; fi
  echo "RESULT FAIL failed=$FAILED components=$COMPONENTS"
  return 1
}

# Runs one component's own read-only diagnosis; a failure prints the tail of its output. A chosen
# component that is not installed is a failure: nothing was verified.
run_doctor() { # component dir command...
  local name="$1" dir="$2" out status
  shift 2
  if [ ! -d "$dir" ]; then echo "DOCTOR $name NOT-INSTALLED $dir"; FAILED=$((FAILED + 1)); return; fi
  out="$(mktemp)"
  (cd "$dir" && "$@") >"$out" 2>&1
  status=$?
  if [ "$status" -eq 0 ]; then
    echo "DOCTOR $name PASS $dir"
  else
    echo "DOCTOR $name FAIL exit=$status $dir"
    tail -n 15 "$out" | sed 's/^/  | /'
    FAILED=$((FAILED + 1))
  fi
  rm -f "$out"
}

cmd_doctor() {
  echo "WEBMCP-SETUP DOCTOR components=$COMPONENTS"
  want panel && run_doctor panel "${WEBMCP_PANEL_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}" npm run --silent local:doctor
  want native && run_doctor native "${WEBMCP_NATIVE_DIR:-$HOME/WebMCP/webmcp-bridge}" npm run --silent webmcp -- doctor
  want deepseek && run_doctor deepseek "${WEBMCP_DEEPSEEK_DIR:-$HOME/deepseek-webmcp}" npm run --silent doctor
  if [ "$FAILED" -eq 0 ]; then echo "RESULT PASS failed=0"; return 0; fi
  echo "RESULT FAIL failed=$FAILED"
  return 1
}

# The official checksum file is unsigned, so the SHA-256 guards against a corrupted or intercepted
# download, not against a compromised release. curl does not set the quarantine attribute, so the
# binary is not blocked by Gatekeeper. The binary is verified and run from a staging folder before it
# replaces anything, so a failed fetch leaves an existing tunnel-client untouched.
cmd_fetch_tunnel_client() {
  local arch tag work zip expected actual binary dest="$PREP_BIN/tunnel-client"
  case "$(uname -m)" in
    arm64) arch=arm64 ;;
    x86_64) arch=amd64 ;;
    *) echo "FETCH FAIL unsupported architecture $(uname -m)"; return 1 ;;
  esac
  tag="$VERSION"
  if [ -z "$tag" ]; then
    tag="$(curl -fsSIL -o /dev/null -w '%{url_effective}' https://github.com/openai/tunnel-client/releases/latest | sed 's|.*/||')" || tag=""
  fi
  case "$tag" in v[0-9]*) ;; *) echo "FETCH FAIL could not determine the tunnel-client release tag"; return 1 ;; esac
  work="$(mktemp -d)" || { echo "FETCH FAIL cannot create a temporary folder"; return 1; }
  zip="tunnel-client-$tag-darwin-$arch.zip"
  if ! curl -fsSL -o "$work/$zip" "https://github.com/openai/tunnel-client/releases/download/$tag/$zip" \
     || ! curl -fsSL -o "$work/SHA256SUMS.txt" "https://github.com/openai/tunnel-client/releases/download/$tag/SHA256SUMS.txt"; then
    echo "FETCH FAIL download failed for $zip"; rm -r -f "$work"; return 1
  fi
  expected="$(awk -v f="$zip" '$2 == f {print $1}' "$work/SHA256SUMS.txt")"
  actual="$(shasum -a 256 "$work/$zip" | awk '{print $1}')"
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    echo "FETCH FAIL checksum mismatch for $zip (expected ${expected:-none}, got $actual)"; rm -r -f "$work"; return 1
  fi
  unzip -q -o "$work/$zip" -d "$work/unpacked" || { echo "FETCH FAIL cannot unzip $zip"; rm -r -f "$work"; return 1; }
  binary="$(find "$work/unpacked" -type f -name tunnel-client | head -n 1)"
  if [ -z "$binary" ]; then echo "FETCH FAIL no tunnel-client inside $zip"; rm -r -f "$work"; return 1; fi
  chmod 755 "$binary" || { echo "FETCH FAIL cannot make the download executable"; rm -r -f "$work"; return 1; }
  if ! "$binary" help >/dev/null 2>&1; then echo "FETCH FAIL the downloaded tunnel-client does not run"; rm -r -f "$work"; return 1; fi
  if ! mkdir -p "$PREP_BIN" || ! install -m 755 "$binary" "$dest.new" || ! mv -f "$dest.new" "$dest"; then
    rm -f "$dest.new" 2>/dev/null
    echo "FETCH FAIL could not write $dest; any existing file was left as it was"; rm -r -f "$work"; return 1
  fi
  rm -r -f "$work"
  echo "FETCH PASS $tag $dest sha256=$actual"
}

# Saves the clipboard as a runtime-key file. The key is never printed, and an existing file or
# symlink is never overwritten or followed, whatever its permissions.
cmd_save_key() {
  local file="${KEY_FILE:-$HOME/.webmcp-runtime-key}" content
  if [ -e "$file" ] || [ -L "$file" ]; then
    echo "KEY FAIL $file already exists and was not touched. Reuse it, or pass --file with a new name"; return 1
  fi
  content="$(pbpaste 2>/dev/null)" || content=""
  if [ -z "$content" ]; then echo "KEY FAIL the clipboard is empty; copy the key first"; return 1; fi
  case "$content" in *$'\n'*) echo "KEY FAIL the clipboard holds more than one line; copy only the key"; return 1 ;; esac
  if ! ( umask 077; set -o noclobber; printf '%s\n' "$content" > "$file" ) 2>/dev/null; then
    echo "KEY FAIL could not create $file"; return 1
  fi
  chmod 600 "$file" 2>/dev/null
  echo "KEY PASS $file mode=$(stat -f '%Lp' "$file")"
}

command="${1:-}"
[ $# -gt 0 ] && shift
VERSION=""
KEY_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --components|--version|--file)
      if [ $# -lt 2 ] || [ -z "$2" ]; then echo "Missing value for $1"; usage; exit 2; fi
      case "$1" in --components) COMPONENTS="$2" ;; --version) VERSION="$2" ;; --file) KEY_FILE="$2" ;; esac
      shift 2 ;;
    *) echo "Unknown option: $1"; usage; exit 2 ;;
  esac
done
for name in $(echo "$COMPONENTS" | tr ',' ' '); do
  case "$name" in panel|native|deepseek) ;; *) echo "Unknown component: $name"; exit 2 ;; esac
done

case "$command" in
  check) cmd_check ;;
  doctor) cmd_doctor ;;
  fetch-tunnel-client) cmd_fetch_tunnel_client ;;
  save-key) cmd_save_key ;;
  *) usage; exit 2 ;;
esac

#!/usr/bin/env node
import {
  accessSync,
  constants as fsConstants,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { profileMatches } from './activate-browser-tunnel.mjs';

const LABEL = 'com.webmcp.browser-tunnel';
const ALIAS = 'webmcp-browser';
const PROFILE = 'browser-mcp';
const STANDARD_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;

// The profile is compared as text because tunnel-client owns its serialization, and it uses
// two dialects: `init --sample` writes commented YAML, `runtimes connect` writes JSON with
// quoted keys and trailing commas. The key and value quoting are therefore both optional.
// The pattern stays line-anchored so a commented-out sample line cannot let a live
// fixed-port listener through.
const EPHEMERAL_HEALTH_PATTERN = /^[ \t]*"?listen_addr"?:[ \t]*["']?127\.0\.0\.1:0["']?,?[ \t]*$/m;

const home = os.homedir();
const uid = process.getuid();
const tunnelId = process.argv[2];

if (!TUNNEL_ID_PATTERN.test(tunnelId ?? '')) {
  throw new Error('Usage: npm run browser:tunnel:install -- tunnel_<32 lowercase hex>');
}

const profileDir = path.join(home, '.config', 'tunnel-client');
const nativeProfilePath = path.join(profileDir, 'native.yaml');
const browserProfilePath = path.join(profileDir, `${PROFILE}.yaml`);
const explicitRuntimeKeyPath = process.env.BROWSER_RUNTIME_KEY_FILE;

let runtimeKey;
if (explicitRuntimeKeyPath) {
  if (!path.isAbsolute(explicitRuntimeKeyPath)) {
    throw new Error('BROWSER_RUNTIME_KEY_FILE must be an absolute path.');
  }
  runtimeKey = `file:${explicitRuntimeKeyPath}`;
} else {
  const nativeProfile = JSON.parse(readFileSync(nativeProfilePath, 'utf8'));
  runtimeKey = nativeProfile?.control_plane?.api_key;
  if (typeof runtimeKey !== 'string' || !runtimeKey.startsWith('file:')) {
    throw new Error('Native profile must use a file: runtime key.');
  }
}

const runtimeKeyPath = runtimeKey.slice('file:'.length);

if (!path.isAbsolute(runtimeKeyPath)) {
  throw new Error('Native profile runtime key reference must be an absolute path.');
}

const runtimeKeyStat = statSync(runtimeKeyPath);

if (!runtimeKeyStat.isFile() || (runtimeKeyStat.mode & 0o777) !== 0o600) {
  throw new Error('Native runtime key must be a mode-0600 regular file.');
}

// Local Expert setup may pass an explicit tunnel client while preserving the
// already-proven developer default that reuses Native webmcp-bridge local assets.
const webmcpData = path.join(home, '.local', 'share', 'webmcp');
const tunnelClient = process.env.BROWSER_TUNNEL_CLIENT
  || path.join(webmcpData, 'bin', 'tunnel-client');
const tunnelHome = path.join(webmcpData, 'browser-tunnel-home');
const logsDir = path.join(webmcpData, 'logs');
const launcher = path.join(home, '.chatgpt-embedded-panel', 'browser-mcp-server');

// Both are executed, not merely read, so F_OK would pass on a non-executable file.
accessSync(tunnelClient, fsConstants.X_OK);
accessSync(launcher, fsConstants.X_OK);

// This installer never writes the launcher, so a launcher left behind by an older install
// still resolves its socket from HOME. The LaunchAgent isolates HOME, so that launcher would
// dial a path nothing binds and every tool call would fail as BROWSER_BRIDGE_UNAVAILABLE.
if (!readFileSync(launcher, 'utf8').includes('CHATGPT_PANEL_BROWSER_SOCKET=')) {
  throw new Error(
    `${launcher} does not pin CHATGPT_PANEL_BROWSER_SOCKET.\n`
    + `Run: npm run browser:tunnel:activate -- --tunnel-id ${tunnelId}\n`
    + 'It rewrites the launcher, then starts a foreground tunnel; Ctrl-C that before '
    + 'installing the LaunchAgent so the two do not run the same profile at once.',
  );
}

const plistPath = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
const childEnv = { ...process.env, HOME: tunnelHome };

// Fail before the first write or runtime mutation when an existing Browser profile
// belongs to another tunnel/launcher. local:setup performs the same guard before it
// updates launchers/manifests, but the lower-level installer must remain safe alone.
let existingProfile = null;
try {
  existingProfile = readFileSync(browserProfilePath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

if (existingProfile !== null && !profileMatches(existingProfile, { tunnelId, launcherPath: launcher })) {
  throw new Error('Existing browser-mcp profile does not match this tunnel and launcher; refusing to modify local state.');
}

mkdirSync(tunnelHome, { recursive: true, mode: 0o700 });
mkdirSync(logsDir, { recursive: true, mode: 0o700 });
mkdirSync(path.dirname(plistPath), { recursive: true });

function stopAlias(stdio) {
  try {
    execFileSync(tunnelClient, ['runtimes', 'stop', ALIAS], { env: childEnv, stdio });
  } catch {
    // The alias may not exist yet, or may already be stopped.
  }
}

function assertEphemeralHealthListener(profileText) {
  if (!EPHEMERAL_HEALTH_PATTERN.test(profileText)) {
    throw new Error(
      `Browser profile health listener is not ephemeral (expected 127.0.0.1:0). `
      + `Remove ${browserProfilePath} and retry.`,
    );
  }
}

// Preflight: prove the Native runtime key authenticates against THIS tunnel id and that the
// generated profile is safe to run headless, before any LaunchAgent reaches disk.
//
// The temporary runtime shares alias, HOME and health URL file with the LaunchAgent, so
// `runtimes stop` deletes the health file of an agent that is already running and nothing
// recreates it until that agent restarts. Callers must therefore only run this when a
// bootstrap follows.
function runPreflight() {
  stopAlias('ignore');

  try {
    execFileSync(tunnelClient, [
      'runtimes', 'connect',
      '--alias', ALIAS,
      '--profile', PROFILE,
      '--profile-dir', profileDir,
      '--tunnel-id', tunnelId,
      '--runtime-api-key', runtimeKey,
      '--mcp-command', launcher,
    ], { env: childEnv, stdio: 'inherit' });

    const statusJson = execFileSync(
      tunnelClient,
      ['runtimes', 'status', ALIAS, '--json'],
      { env: childEnv, encoding: 'utf8' },
    );

    if (JSON.parse(statusJson)?.ready !== true) {
      throw new Error('Browser tunnel preflight did not become ready.');
    }

    assertEphemeralHealthListener(readFileSync(browserProfilePath, 'utf8'));
  } finally {
    stopAlias('inherit');
  }
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const programArguments = [tunnelClient, 'run', '--profile-dir', profileDir, '--profile', PROFILE]
  .map((value) => `      <string>${xmlEscape(value)}</string>`)
  .join('\n');

const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>${LABEL}</string>\n  <key>ProgramArguments</key>\n  <array>\n${programArguments}\n  </array>\n  <key>EnvironmentVariables</key>\n  <dict>\n    <key>HOME</key>\n    <string>${xmlEscape(tunnelHome)}</string>\n    <key>PATH</key>\n    <string>${STANDARD_PATH}</string>\n  </dict>\n  <key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <true/>\n  <key>ThrottleInterval</key>\n  <integer>30</integer>\n  <key>StandardOutPath</key>\n  <string>${xmlEscape(path.join(logsDir, 'webmcp-browser-tunnel.log'))}</string>\n  <key>StandardErrorPath</key>\n  <string>${xmlEscape(path.join(logsDir, 'webmcp-browser-tunnel.err'))}</string>\n</dict>\n</plist>\n`;

const domain = `gui/${uid}`;
const serviceTarget = `${domain}/${LABEL}`;

function readOptional(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function serviceIsLoaded() {
  try {
    execFileSync('launchctl', ['print', serviceTarget], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4));
function waitForServiceAbsent(timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (serviceIsLoaded()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${LABEL} to leave ${domain} after bootout.`);
    }
    Atomics.wait(sleepCell, 0, 0, 100);
  }
}

const existingPlist = readOptional(plistPath);
const wasLoaded = serviceIsLoaded();

// A setup rerun with an identical plist and a profile already on disk must be a no-op for a
// healthy service: no bootout/bootstrap and no temporary runtime, because either would
// disturb the running tunnel's health state. The existing profile is still held to the
// ephemeral-listener gate; the running agent's /readyz (checked by local:doctor) is the
// evidence that its credential works.
if (existingPlist === plist && wasLoaded && existingProfile !== null) {
  assertEphemeralHealthListener(existingProfile);
  execFileSync('launchctl', ['print', serviceTarget], { stdio: 'inherit' });
  process.stdout.write(`Installed ${LABEL} (unchanged; already loaded)\n`);
} else {
  runPreflight();

  if (existingPlist !== plist) {
    // Lint the candidate before it takes the real path: a failed lint must not leave a broken
    // plist where launchctl, or the next run's bootout, would find it.
    const candidatePlist = path.join(
      path.dirname(plistPath),
      `.${path.basename(plistPath)}.${process.pid}.tmp`,
    );

    rmSync(candidatePlist, { force: true });

    try {
      writeFileSync(candidatePlist, plist, { mode: 0o600, flag: 'wx' });
      execFileSync('plutil', ['-lint', candidatePlist], { stdio: 'inherit' });
      renameSync(candidatePlist, plistPath);
    } catch (error) {
      rmSync(candidatePlist, { force: true });
      throw error;
    }
  }

  if (wasLoaded) {
    execFileSync('launchctl', ['bootout', serviceTarget], { stdio: 'inherit' });
    waitForServiceAbsent();
  }

  execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'inherit' });
  execFileSync('launchctl', ['print', serviceTarget], { stdio: 'inherit' });
  process.stdout.write(`Installed ${LABEL}\n`);
}

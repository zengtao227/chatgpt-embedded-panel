#!/usr/bin/env node
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL_EXTENSION_ID } from './extension-id.mjs';
import { installBrowserNativeHost } from './native-host-installer.mjs';
import {
  launcherContent,
  profileMatches,
  resolveTunnelClient,
} from './activate-browser-tunnel.mjs';
import { formatLocalDoctorReport, runLocalDoctor } from './local-doctor.mjs';

const TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

function fail(message) {
  throw new Error(message);
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForLocalDoctorReady(params, {
  runDoctor = runLocalDoctor,
  attempts = 20,
  intervalMs = 250,
  sleep = defaultSleep,
} = {}) {
  let doctor = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    doctor = await runDoctor({ ...params, print: false });
    if (doctor.ready) return doctor;
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  return doctor;
}

export function parseLocalSetupArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return Object.freeze({ help: true });
    const next = () => {
      index += 1;
      if (index >= argv.length) fail(`Missing value for ${arg}.`);
      return argv[index];
    };
    if (arg === '--tunnel-id') options.tunnelId = next();
    else if (arg === '--extension-id') options.extensionId = next();
    else if (arg === '--runtime-key-file') options.runtimeKeyFile = path.resolve(next());
    else if (arg === '--tunnel-client') options.tunnelClient = path.resolve(next());
    else fail(`Unknown option: ${arg}`);
  }

  if (!TUNNEL_ID_PATTERN.test(options.tunnelId ?? '')) {
    fail('A valid --tunnel-id tunnel_<32 lowercase hex> is required.');
  }
  options.extensionId ??= PANEL_EXTENSION_ID;
  if (!EXTENSION_ID_PATTERN.test(options.extensionId)) {
    fail('A valid --extension-id <32-character Chrome extension id> is required.');
  }
  return Object.freeze({ help: false, ...options });
}

export function localSetupPaths(home = os.homedir()) {
  return Object.freeze({
    profileDir: path.join(home, '.config', 'tunnel-client'),
    nativeProfile: path.join(home, '.config', 'tunnel-client', 'native.yaml'),
    browserProfile: path.join(home, '.config', 'tunnel-client', 'browser-mcp.yaml'),
    stateDir: path.join(home, '.chatgpt-embedded-panel'),
    browserMcpLauncher: path.join(home, '.chatgpt-embedded-panel', 'browser-mcp-server'),
    serverPath: path.join(PROJECT_ROOT, 'browser-mcp', 'stdio-server.js'),
    launchdInstaller: path.join(PROJECT_ROOT, 'scripts', 'install-browser-tunnel-launchd.mjs'),
  });
}

function executable(file) {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function assertExistingProfileCompatible({
  profileText,
  tunnelId,
  launcherPath,
} = {}) {
  if (profileText === null || profileText === undefined) return;
  if (!profileMatches(profileText, { tunnelId, launcherPath })) {
    fail('Existing browser-mcp profile does not match this tunnel and launcher; refusing to modify local state.');
  }
}

function runtimeKeyFileFromNativeProfile(profilePath) {
  let profile;
  try {
    profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  } catch {
    fail(
      'No usable runtime-key file was supplied and the existing Native tunnel profile '
      + 'could not be read. Use --runtime-key-file /absolute/path/to/key.',
    );
  }
  const reference = profile?.control_plane?.api_key;
  if (typeof reference !== 'string' || !reference.startsWith('file:')) {
    fail(
      'The existing Native tunnel profile does not reference a runtime key file. '
      + 'Use --runtime-key-file /absolute/path/to/key.',
    );
  }
  const file = reference.slice('file:'.length);
  if (!path.isAbsolute(file)) fail('Native runtime key file reference must be absolute.');
  return file;
}

export function validateRuntimeKeyFile(file) {
  if (!path.isAbsolute(file)) fail('Runtime key file must be an absolute path.');
  const stat = statSync(file);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    fail('Runtime key file must be a mode-0600 regular file.');
  }
  if (readFileSync(file).length === 0) fail('Runtime key file is empty.');
  return file;
}

function chromeInstalled(home) {
  return existsSync('/Applications/Google Chrome.app')
    || existsSync(path.join(home, 'Applications', 'Google Chrome.app'));
}

function usage() {
  return [
    'ChatGPT Embedded Panel — Local Expert / Privacy setup',
    '',
    'Required:',
    '  npm run local:setup -- --tunnel-id tunnel_<32-lowercase-hex>',
    '',
    'Optional:',
    '  --extension-id <32-char-chrome-extension-id>   defaults to the id pinned by manifest.json "key"',
    '',
    'Fresh machine / standalone credential inputs:',
    '    --runtime-key-file /absolute/path/to/runtime-key \\',
    '    --tunnel-client /absolute/path/to/tunnel-client',
    '',
    'If Native WebMCP is already installed, the runtime-key file and tunnel-client',
    'may be reused from its existing local configuration.',
    '',
    'This command never accepts a runtime API key value on argv.',
  ].join('\n');
}

export async function runLocalSetup(options, {
  home = os.homedir(),
  platform = process.platform,
  nodePath = process.execPath,
  execFile = execFileSync,
} = {}) {
  if (platform !== 'darwin') fail('Local Expert setup currently supports macOS only.');

  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) fail('Node.js 22 or newer is required.');
  if (!chromeInstalled(home)) fail('Google Chrome is required.');

  const tunnelId = options?.tunnelId;
  const extensionId = options?.extensionId;
  if (!TUNNEL_ID_PATTERN.test(tunnelId ?? '')) fail('Invalid Browser tunnel id.');
  if (!EXTENSION_ID_PATTERN.test(extensionId ?? '')) fail('Invalid Chrome extension id.');

  const paths = localSetupPaths(home);
  if (!existsSync(paths.serverPath)) fail(`Browser MCP server is missing: ${paths.serverPath}`);

  const tunnelClient = options.tunnelClient
    ? path.resolve(options.tunnelClient)
    : await resolveTunnelClient({ home, pathEnv: process.env.PATH ?? '' });
  if (!executable(tunnelClient)) fail('tunnel-client is missing or not executable.');

  const runtimeKeyFile = validateRuntimeKeyFile(
    options.runtimeKeyFile
      ? path.resolve(options.runtimeKeyFile)
      : runtimeKeyFileFromNativeProfile(paths.nativeProfile),
  );

  // Codex gate: all compatibility checks happen before the first write. A mismatch
  // must not partially update launchers/manifests and only then fail inside connect.
  let existingProfile = null;
  try {
    existingProfile = readFileSync(paths.browserProfile, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  assertExistingProfileCompatible({
    profileText: existingProfile,
    tunnelId,
    launcherPath: paths.browserMcpLauncher,
  });

  mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(
    paths.browserMcpLauncher,
    launcherContent({
      nodePath,
      serverPath: paths.serverPath,
      socketPath: path.join(paths.stateDir, 'browser-mcp.sock'),
    }),
    { mode: 0o700 },
  );
  chmodSync(paths.browserMcpLauncher, 0o700);

  await installBrowserNativeHost({ extensionId, home });

  execFile(nodePath, [paths.launchdInstaller, tunnelId], {
    stdio: 'inherit',
    env: {
      ...process.env,
      BROWSER_RUNTIME_KEY_FILE: runtimeKeyFile,
      BROWSER_TUNNEL_CLIENT: tunnelClient,
    },
  });

  const doctor = await waitForLocalDoctorReady({ home, extensionId, expectedTunnelId: tunnelId });
  // The bounded wait already produced the authoritative readiness snapshot. Print that exact
  // result instead of probing again: a second probe can race with transient health-file churn
  // and turn an observed READY state into a false setup failure.
  process.stdout.write(formatLocalDoctorReport(doctor));
  if (!doctor.ready) fail(`Local setup completed but doctor failed at: ${doctor.firstFailure ?? 'unknown layer'}.`);

  const summary = [
    '',
    'Local Browser WebMCP is ready.',
    '',
    'Remaining ChatGPT-side step:',
    'Open ChatGPT Developer Mode / Plugins, enable the Browser MCP app,',
    `choose Tunnel as the connection, and select/paste: ${tunnelId}`,
    '',
    'Diagnostics: npm run local:doctor',
    'Browser-only teardown: npm run local:uninstall',
  ].join('\n');
  process.stdout.write(`${summary}\n`);

  return Object.freeze({
    tunnelId,
    extensionId,
    tunnelClient,
    runtimeKeyFile,
    browserMcpLauncher: paths.browserMcpLauncher,
    doctor,
  });
}

const mainPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (mainPath === fileURLToPath(import.meta.url)) {
  try {
    const options = parseLocalSetupArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else await runLocalSetup(options);
  } catch (error) {
    process.stderr.write(`Local setup failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

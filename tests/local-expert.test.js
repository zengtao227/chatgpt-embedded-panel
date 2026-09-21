import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PANEL_EXTENSION_ID } from '../scripts/extension-id.mjs';
import {
  assertExistingProfileCompatible,
  localSetupPaths,
  parseLocalSetupArgs,
  validateRuntimeKeyFile,
  waitForLocalDoctorReady,
} from '../scripts/local-setup.mjs';
import {
  localDoctorPaths,
  parseLaunchctlPrint,
  runLocalDoctor,
} from '../scripts/local-doctor.mjs';
import {
  localUninstallPaths,
  runLocalUninstall,
} from '../scripts/local-uninstall.mjs';

const TUNNEL_ID = 'tunnel_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';

async function tempHome() {
  return mkdtemp(path.join(os.tmpdir(), 'browser-webmcp-local-'));
}

async function writeMode(file, content, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, { mode });
  await chmod(file, mode);
}

test('Local setup accepts only explicit file/path inputs and never a runtime secret value', () => {
  assert.deepEqual(
    parseLocalSetupArgs([
      '--tunnel-id', TUNNEL_ID,
      '--extension-id', EXTENSION_ID,
      '--runtime-key-file', '/tmp/browser-key',
      '--tunnel-client', '/tmp/tunnel-client',
    ]),
    {
      help: false,
      tunnelId: TUNNEL_ID,
      extensionId: EXTENSION_ID,
      runtimeKeyFile: path.resolve('/tmp/browser-key'),
      tunnelClient: path.resolve('/tmp/tunnel-client'),
    },
  );
  assert.throws(() => parseLocalSetupArgs(['--runtime-api-key', 'secret']), /Unknown option/);
  assert.equal(parseLocalSetupArgs(['--tunnel-id', TUNNEL_ID]).extensionId, PANEL_EXTENSION_ID);
  assert.throws(() => parseLocalSetupArgs(['--tunnel-id', TUNNEL_ID, '--extension-id', 'not-an-id']), /extension-id/);
});

test('existing browser profile mismatch fails closed', () => {
  const paths = localSetupPaths('/Users/example');
  const matching = [
    `tunnel_id: ${TUNNEL_ID}`,
    'channel: main',
    `command: ${paths.browserMcpLauncher}`,
  ].join('\n');
  assert.doesNotThrow(() => assertExistingProfileCompatible({
    profileText: matching,
    tunnelId: TUNNEL_ID,
    launcherPath: paths.browserMcpLauncher,
  }));
  assert.throws(() => assertExistingProfileCompatible({
    profileText: matching.replace(TUNNEL_ID, 'tunnel_cccccccccccccccccccccccccccccccc'),
    tunnelId: TUNNEL_ID,
    launcherPath: paths.browserMcpLauncher,
  }), /refusing to modify local state/);
});

test('runtime key validation requires a non-empty mode-0600 regular file', async () => {
  const home = await tempHome();
  const key = path.join(home, 'key');
  await writeMode(key, 'test-key\n', 0o600);
  assert.equal(validateRuntimeKeyFile(key), key);

  await chmod(key, 0o644);
  assert.throws(() => validateRuntimeKeyFile(key), /mode-0600/);
});

test('Local setup and lower LaunchAgent installer both guard profile compatibility before first write', async () => {
  const setup = await readFile(new URL('../scripts/local-setup.mjs', import.meta.url), 'utf8');
  const launchd = await readFile(new URL('../scripts/install-browser-tunnel-launchd.mjs', import.meta.url), 'utf8');

  assert.ok(setup.indexOf('assertExistingProfileCompatible({') >= 0);
  assert.ok(setup.indexOf('assertExistingProfileCompatible({') < setup.indexOf('mkdirSync(paths.stateDir'));
  assert.ok(launchd.indexOf('profileMatches(existingProfile') >= 0);
  assert.ok(launchd.indexOf('profileMatches(existingProfile') < launchd.indexOf('mkdirSync(tunnelHome'));
});

test('LaunchAgent install is idempotent and waits for bootout completion before bootstrap', async () => {
  const launchd = await readFile(new URL('../scripts/install-browser-tunnel-launchd.mjs', import.meta.url), 'utf8');

  const noOp = launchd.indexOf('existingPlist === plist && wasLoaded');
  const bootout = launchd.indexOf("execFileSync('launchctl', ['bootout', serviceTarget]");
  const wait = launchd.indexOf('waitForServiceAbsent();');
  const bootstrap = launchd.indexOf("execFileSync('launchctl', ['bootstrap', domain, plistPath]");

  assert.ok(noOp >= 0, 'unchanged loaded service must have a no-op path');
  assert.ok(bootout >= 0 && wait > bootout, 'bootout must be followed by an absence wait');
  assert.ok(bootstrap > wait, 'bootstrap must happen only after bootout completion');
});

test('Local setup waits through transient doctor startup failures without weakening readiness', async () => {
  const calls = [];
  const results = [
    { ready: false, firstFailure: 'LaunchAgent running' },
    { ready: false, firstFailure: 'Health URL file' },
    { ready: true, firstFailure: null },
  ];
  const sleeps = [];
  const doctor = await waitForLocalDoctorReady(
    { home: '/tmp/example', extensionId: EXTENSION_ID, expectedTunnelId: TUNNEL_ID },
    {
      attempts: 5,
      intervalMs: 25,
      runDoctor: async (params) => {
        calls.push(params);
        return results.shift();
      },
      sleep: async (ms) => sleeps.push(ms),
    },
  );

  assert.equal(doctor.ready, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [25, 25]);
  assert.ok(calls.every((call) => call.print === false));
});

test('Local setup prints the READY snapshot without probing doctor a second time', async () => {
  const setup = await readFile(new URL('../scripts/local-setup.mjs', import.meta.url), 'utf8');
  const wait = setup.indexOf('const doctor = await waitForLocalDoctorReady');
  const print = setup.indexOf('formatLocalDoctorReport(doctor)', wait);
  const secondProbe = setup.indexOf('await runLocalDoctor(', wait);

  assert.ok(wait >= 0, 'setup must wait for readiness');
  assert.ok(print > wait, 'setup must print the accepted readiness snapshot');
  assert.equal(secondProbe, -1, 'setup must not race by probing doctor again after readiness');
});

test('launchctl parser reports the top-level running state, runs and pid', () => {
  const parsed = parseLaunchctlPrint([
    'gui/501/com.webmcp.browser-tunnel = {',
    '    state = running',
    '    runs = 1',
    '    pid = 1794',
    '    last exit code = (never exited)',
    '        state = active',
    '}',
  ].join('\n'));
  assert.deepEqual(parsed, {
    state: 'running',
    runs: 1,
    pid: 1794,
    lastExitCode: '(never exited)',
  });
});

test('Local doctor can report a fully healthy Expert install without mutating it', async () => {
  const home = await tempHome();
  const paths = localDoctorPaths(home);

  await writeMode(paths.nativeManifest, JSON.stringify({
    name: 'com.webmcp.browser',
    type: 'stdio',
    path: paths.nativeHostLauncher,
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  }) + '\n');
  await writeMode(paths.nativeHostLauncher, '#!/bin/sh\nexit 0\n', 0o700);
  await writeMode(paths.browserMcpLauncher, '#!/bin/sh\nexit 0\n', 0o700);
  await writeMode(paths.browserProfile, [
    `tunnel_id: ${TUNNEL_ID}`,
    'channel: main',
    `command: ${paths.browserMcpLauncher}`,
  ].join('\n') + '\n');
  await writeMode(paths.launchAgent, '<plist/>\n');
  await writeMode(paths.healthUrlFile, 'http://127.0.0.1:12345\n');
  await writeMode(paths.errorLog, '');

  const result = await runLocalDoctor({
    home,
    extensionId: EXTENSION_ID,
    expectedTunnelId: TUNNEL_ID,
    platform: 'darwin',
    uid: 501,
    execFile: () => [
      'gui/501/com.webmcp.browser-tunnel = {',
      '    state = running',
      '    runs = 1',
      '    pid = 1794',
      '    last exit code = (never exited)',
      '}',
    ].join('\n'),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => 'ready',
    }),
    print: false,
  });

  assert.equal(result.ready, true);
  assert.equal(result.firstFailure, null);
  assert.equal(result.extensionId, EXTENSION_ID);
  assert.equal(result.tunnelId, TUNNEL_ID);
});

test('Local doctor identifies the first broken layer', async () => {
  const home = await tempHome();
  const result = await runLocalDoctor({
    home,
    platform: 'darwin',
    uid: 501,
    execFile: () => { throw new Error('not loaded'); },
    fetchImpl: async () => { throw new Error('should not fetch without health url'); },
    print: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.firstFailure, 'Native host manifest');
});

test('Local uninstall owns only Browser files and preserves Native/shared tunnel assets', async () => {
  const home = await tempHome();
  const paths = localUninstallPaths(home);

  for (const file of [
    paths.launchAgent,
    paths.nativeManifest,
    paths.nativeHostLauncher,
    paths.browserMcpLauncher,
    paths.browserProfile,
  ]) {
    await writeMode(file, 'browser-owned\n');
  }
  for (const file of [paths.sharedNativeProfile, paths.sharedTunnelClient]) {
    await writeMode(file, 'shared\n', file === paths.sharedTunnelClient ? 0o700 : 0o600);
  }

  const calls = [];
  const result = await runLocalUninstall({
    home,
    platform: 'darwin',
    uid: 501,
    execFile: (...args) => { calls.push(args); },
    print: false,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ['bootout', 'gui/501/com.webmcp.browser-tunnel']);

  for (const file of [
    paths.launchAgent,
    paths.nativeManifest,
    paths.nativeHostLauncher,
    paths.browserMcpLauncher,
    paths.browserProfile,
  ]) {
    await assert.rejects(stat(file));
  }

  assert.equal((await readFile(paths.sharedNativeProfile, 'utf8')).trim(), 'shared');
  assert.equal((await readFile(paths.sharedTunnelClient, 'utf8')).trim(), 'shared');
  assert.equal(result.preserved.includes(paths.sharedNativeProfile), true);
  assert.equal(result.preserved.includes(paths.sharedTunnelClient), true);
});

test('Local uninstall path set never includes Native LaunchAgent, Native profile/key, shared tunnel client or repo paths', () => {
  const paths = localUninstallPaths('/Users/example');
  const removable = [
    paths.launchAgent,
    paths.nativeManifest,
    paths.nativeHostLauncher,
    paths.browserMcpLauncher,
    paths.browserProfile,
  ].join('\n');

  assert.doesNotMatch(removable, /com\.webmcp\.native-tunnel/);
  assert.doesNotMatch(removable, /native\.yaml/);
  assert.doesNotMatch(removable, /runtime.*key|api.*key/i);
  assert.doesNotMatch(removable, /webmcp\/bin\/tunnel-client/);
  assert.doesNotMatch(removable, /My code|chatgpt-embedded-panel$/);
});

// Runs the real installer against fake tunnel-client/launchctl/plutil. The fake `runtimes stop`
// deletes the alias health URL file exactly as the real one does: the temporary preflight
// runtime and the LaunchAgent share alias `webmcp-browser` and HOME, so stopping the first
// destroys the second's health state, and nothing recreates it until the agent restarts.
async function installerSandbox() {
  const home = await tempHome();
  const bin = path.join(home, 'fakebin');
  const log = path.join(home, 'calls.log');
  const launchdState = path.join(home, 'launchd-loaded');
  const keyFile = path.join(home, 'runtime-key');
  const tunnelClient = path.join(bin, 'tunnel-client');
  const launcher = path.join(home, '.chatgpt-embedded-panel', 'browser-mcp-server');
  const profile = path.join(home, '.config', 'tunnel-client', 'browser-mcp.yaml');
  const healthFile = path.join(
    home, '.local', 'share', 'webmcp', 'browser-tunnel-home',
    'Library', 'Application Support', 'tunnel-client', 'health', 'webmcp-browser.url',
  );

  await writeMode(keyFile, 'runtime-key\n');
  await writeMode(launcher, '#!/bin/sh\nCHATGPT_PANEL_BROWSER_SOCKET=/tmp/x exec true\n', 0o700);
  await writeMode(tunnelClient, [
    '#!/bin/sh',
    `echo "tunnel-client $*" >> "${log}"`,
    'case "$1 $2" in',
    '  "runtimes connect")',
    `    mkdir -p "$(dirname "${profile}")"`,
    `    printf '{\\n  "tunnel_id": "${TUNNEL_ID}",\\n  "channel": "main",\\n  "command": "${launcher}",\\n  "listen_addr": "127.0.0.1:0",\\n}\\n' > "${profile}" ;;`,
    '  "runtimes status") echo \'{"ready":true}\' ;;',
    `  "runtimes stop") rm -f "$HOME/Library/Application Support/tunnel-client/health/webmcp-browser.url" ;;`,
    'esac',
    '',
  ].join('\n'), 0o700);
  await writeMode(path.join(bin, 'plutil'), '#!/bin/sh\nexit 0\n', 0o700);
  await writeMode(path.join(bin, 'launchctl'), [
    '#!/bin/sh',
    `echo "launchctl $*" >> "${log}"`,
    'case "$1" in',
    `  print) [ -f "${launchdState}" ] || exit 113 ;;`,
    `  bootstrap) : > "${launchdState}" ;;`,
    `  bootout) rm -f "${launchdState}" ;;`,
    'esac',
    '',
  ].join('\n'), 0o700);

  const install = () => spawnSync(process.execPath, [
    fileURLToPath(new URL('../scripts/install-browser-tunnel-launchd.mjs', import.meta.url)),
    TUNNEL_ID,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      PATH: `${bin}:${process.env.PATH}`,
      BROWSER_RUNTIME_KEY_FILE: keyFile,
      BROWSER_TUNNEL_CLIENT: tunnelClient,
    },
  });

  return { home, log, healthFile, install };
}

test('rerunning the installer against an unchanged loaded LaunchAgent leaves its runtime state untouched', async () => {
  const sandbox = await installerSandbox();

  const first = sandbox.install();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Installed com\.webmcp\.browser-tunnel\n/);

  // The now-running agent owns this health file; a well-behaved rerun must not remove it.
  await mkdir(path.dirname(sandbox.healthFile), { recursive: true });
  await writeFile(sandbox.healthFile, 'http://127.0.0.1:54321\n');
  await writeFile(sandbox.log, '');

  const second = sandbox.install();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /unchanged; already loaded/);

  const calls = await readFile(sandbox.log, 'utf8');
  assert.doesNotMatch(calls, /tunnel-client runtimes/, 'no temporary runtime may be created or stopped');
  assert.doesNotMatch(calls, /launchctl (bootout|bootstrap)/);
  assert.equal(await readFile(sandbox.healthFile, 'utf8'), 'http://127.0.0.1:54321\n');
});

test('a first install still runs the connect/status/stop preflight before bootstrap', async () => {
  const sandbox = await installerSandbox();

  const first = sandbox.install();
  assert.equal(first.status, 0, first.stderr);

  const calls = (await readFile(sandbox.log, 'utf8')).split('\n');
  const connect = calls.findIndex((line) => line.includes('runtimes connect'));
  const bootstrap = calls.findIndex((line) => line.startsWith('launchctl bootstrap'));
  assert.ok(connect >= 0, 'preflight connect must run when nothing is installed');
  assert.ok(bootstrap > connect, 'preflight must complete before the LaunchAgent is bootstrapped');
});

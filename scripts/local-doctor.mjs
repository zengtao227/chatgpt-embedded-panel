#!/usr/bin/env node
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_NATIVE_HOST_NAME } from '../browser-native-protocol.js';

const LABEL = 'com.webmcp.browser-tunnel';
const TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

function executable(file) {
  try {
    accessSync(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function soleProfileValue(profileText, key) {
  const prefixSource = `^[ \\t]*-?[ \\t]*"?${key}"?:[ \\t]*`;
  const matches = String(profileText ?? '').match(new RegExp(`${prefixSource}.*$`, 'gm'));
  if (!matches || matches.length !== 1) return null;
  return matches[0]
    .replace(new RegExp(prefixSource), '')
    .trim()
    .replace(/,$/, '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

export function parseLaunchctlPrint(text) {
  const source = String(text ?? '');
  const value = (name) => new RegExp(`^[ \\t]*${name} = ([^\\n]+)$`, 'm').exec(source)?.[1]?.trim() ?? null;
  return Object.freeze({
    state: value('state'),
    runs: value('runs') === null ? null : Number.parseInt(value('runs'), 10),
    pid: value('pid') === null ? null : Number.parseInt(value('pid'), 10),
    lastExitCode: /^[ \t]*last exit code = ([^\n]+)$/m.exec(source)?.[1]?.trim() ?? null,
  });
}

export function localDoctorPaths(home = os.homedir()) {
  const webmcpData = path.join(home, '.local', 'share', 'webmcp');
  return Object.freeze({
    nativeManifest: path.join(
      home,
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${BROWSER_NATIVE_HOST_NAME}.json`,
    ),
    nativeHostLauncher: path.join(home, '.chatgpt-embedded-panel', 'browser-native-host'),
    browserMcpLauncher: path.join(home, '.chatgpt-embedded-panel', 'browser-mcp-server'),
    browserProfile: path.join(home, '.config', 'tunnel-client', 'browser-mcp.yaml'),
    launchAgent: path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
    healthUrlFile: path.join(
      webmcpData,
      'browser-tunnel-home',
      'Library',
      'Application Support',
      'tunnel-client',
      'health',
      'webmcp-browser.url',
    ),
    errorLog: path.join(webmcpData, 'logs', 'webmcp-browser-tunnel.err'),
  });
}

function addCheck(checks, name, ok, detail = '') {
  checks.push(Object.freeze({ name, ok: Boolean(ok), detail: String(detail ?? '') }));
}

async function checkReadyUrl(url, fetchImpl) {
  const base = String(url ?? '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(base)) return { ok: false, detail: 'invalid health URL' };
  try {
    const response = await fetchImpl(`${base}/readyz`, {
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
    });
    const body = (await response.text()).trim();
    return { ok: response.ok && body === 'ready', detail: body || `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error?.name === 'TimeoutError' ? 'timeout' : 'unreachable' };
  }
}

export function formatLocalDoctorReport(result) {
  const lines = ['Local Browser WebMCP Doctor'];
  for (const check of result.checks) {
    lines.push(`[${check.ok ? 'PASS' : 'FAIL'}] ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
  }
  lines.push(result.ready
    ? 'RESULT: READY'
    : `RESULT: BROKEN AT ${result.firstFailure}`);
  if (result.extensionId && result.tunnelId) {
    lines.push(
      `RE-RUN SETUP: npm run local:setup -- --tunnel-id ${result.tunnelId} --extension-id ${result.extensionId}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export async function runLocalDoctor({
  home = os.homedir(),
  extensionId = null,
  expectedTunnelId = null,
  platform = process.platform,
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  execFile = execFileSync,
  fetchImpl = globalThis.fetch,
  print = true,
} = {}) {
  const checks = [];
  const paths = localDoctorPaths(home);

  addCheck(checks, 'macOS', platform === 'darwin', platform);
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  addCheck(checks, 'Node 22+', Number.isInteger(nodeMajor) && nodeMajor >= 22, process.version);

  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(paths.nativeManifest, 'utf8'));
  } catch {}
  const manifestOrigin = Array.isArray(manifest?.allowed_origins) && manifest.allowed_origins.length === 1
    ? manifest.allowed_origins[0]
    : null;
  const manifestExtensionId = /^chrome-extension:\/\/([a-p]{32})\/$/.exec(manifestOrigin ?? '')?.[1] ?? null;
  const manifestOk = manifest?.name === BROWSER_NATIVE_HOST_NAME
    && manifest?.type === 'stdio'
    && EXTENSION_ID_PATTERN.test(manifestExtensionId ?? '')
    && (!extensionId || manifestExtensionId === extensionId);
  addCheck(
    checks,
    'Native host manifest',
    manifestOk,
    manifestOk ? `extension ${manifestExtensionId}` : 'missing, invalid, or bound to another extension',
  );

  addCheck(
    checks,
    'Native host launcher',
    executable(paths.nativeHostLauncher),
    paths.nativeHostLauncher,
  );
  addCheck(
    checks,
    'Browser MCP launcher',
    executable(paths.browserMcpLauncher),
    paths.browserMcpLauncher,
  );

  let profileText = null;
  try {
    profileText = readFileSync(paths.browserProfile, 'utf8');
  } catch {}
  const tunnelId = soleProfileValue(profileText, 'tunnel_id');
  const channel = soleProfileValue(profileText, 'channel');
  const command = soleProfileValue(profileText, 'command');
  const profileOk = TUNNEL_ID_PATTERN.test(tunnelId ?? '')
    && channel === 'main'
    && command === paths.browserMcpLauncher
    && (!expectedTunnelId || tunnelId === expectedTunnelId);
  addCheck(
    checks,
    'Browser tunnel profile',
    profileOk,
    profileOk ? tunnelId : 'missing or does not match Browser MCP launcher/tunnel',
  );

  addCheck(checks, 'LaunchAgent plist', existsSync(paths.launchAgent), paths.launchAgent);

  let launchctl = null;
  if (platform === 'darwin' && Number.isInteger(uid)) {
    try {
      const output = execFile('launchctl', ['print', `gui/${uid}/${LABEL}`], { encoding: 'utf8' });
      launchctl = parseLaunchctlPrint(output);
    } catch {}
  }
  const launchctlOk = launchctl?.state === 'running'
    && Number.isInteger(launchctl?.pid)
    && launchctl.pid > 0
    && Number.isInteger(launchctl?.runs)
    && launchctl.runs >= 1;
  addCheck(
    checks,
    'LaunchAgent running',
    launchctlOk,
    launchctl
      ? `state=${launchctl.state} runs=${launchctl.runs} pid=${launchctl.pid} lastExit=${launchctl.lastExitCode ?? 'n/a'}`
      : 'not loaded',
  );

  let healthUrl = null;
  try {
    healthUrl = readFileSync(paths.healthUrlFile, 'utf8').trim();
  } catch {}
  addCheck(checks, 'Health URL file', Boolean(healthUrl), paths.healthUrlFile);

  if (healthUrl && typeof fetchImpl === 'function') {
    const ready = await checkReadyUrl(healthUrl, fetchImpl);
    addCheck(checks, '/readyz', ready.ok, ready.detail);
  } else {
    addCheck(checks, '/readyz', false, healthUrl ? 'fetch unavailable' : 'health URL missing');
  }

  let errorLogDetail = 'missing';
  let errorLogOk = false;
  try {
    const stat = statSync(paths.errorLog);
    if (stat.isFile()) {
      if (stat.size === 0) {
        errorLogOk = true;
        errorLogDetail = 'empty';
      } else {
        const content = readFileSync(paths.errorLog, 'utf8');
        errorLogDetail = `${stat.size} bytes; tail: ${content.slice(-2000).replaceAll('\n', ' | ')}`;
      }
    }
  } catch {}
  addCheck(checks, 'Browser tunnel error log', errorLogOk, errorLogDetail);

  const firstFailure = checks.find((check) => !check.ok)?.name ?? null;
  const result = Object.freeze({
    ready: firstFailure === null,
    firstFailure,
    checks: Object.freeze(checks),
    extensionId: manifestExtensionId,
    tunnelId,
    launchctl,
  });

  if (print) process.stdout.write(formatLocalDoctorReport(result));

  return result;
}

const mainPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (mainPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await runLocalDoctor();
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`Local doctor failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

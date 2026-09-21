#!/usr/bin/env node
import {
  existsSync,
  readdirSync,
  rmdirSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_NATIVE_HOST_NAME } from '../browser-native-protocol.js';

const LABEL = 'com.webmcp.browser-tunnel';

export function localUninstallPaths(home = os.homedir()) {
  return Object.freeze({
    launchAgent: path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`),
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
    stateDir: path.join(home, '.chatgpt-embedded-panel'),
    browserProfile: path.join(home, '.config', 'tunnel-client', 'browser-mcp.yaml'),

    // These are intentionally preserved by the Expert uninstaller. The current
    // compatibility setup shares this root with Native WebMCP, so ownership is not
    // strong enough to recursively delete anything beneath it.
    sharedTunnelClient: path.join(home, '.local', 'share', 'webmcp', 'bin', 'tunnel-client'),
    sharedNativeProfile: path.join(home, '.config', 'tunnel-client', 'native.yaml'),
    sharedDataRoot: path.join(home, '.local', 'share', 'webmcp'),
  });
}

function removeFile(file, removed, dryRun) {
  if (!existsSync(file)) return;
  if (!dryRun) rmSync(file, { force: true });
  removed.push(file);
}

function removeDirectoryIfEmpty(directory, removed, dryRun) {
  if (!existsSync(directory)) return;
  try {
    if (readdirSync(directory).length !== 0) return;
  } catch {
    return;
  }
  if (!dryRun) rmdirSync(directory);
  removed.push(directory);
}

export async function runLocalUninstall({
  home = os.homedir(),
  platform = process.platform,
  uid = typeof process.getuid === 'function' ? process.getuid() : null,
  execFile = execFileSync,
  dryRun = false,
  print = true,
} = {}) {
  if (platform !== 'darwin') throw new Error('Local Browser uninstall currently supports macOS only.');

  const paths = localUninstallPaths(home);
  const removed = [];
  const preserved = [
    paths.sharedNativeProfile,
    paths.sharedTunnelClient,
    paths.sharedDataRoot,
  ];

  if (Number.isInteger(uid)) {
    try {
      execFile('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });
    } catch {
      // The Browser LaunchAgent may already be unloaded.
    }
  }

  removeFile(paths.launchAgent, removed, dryRun);
  removeFile(paths.nativeManifest, removed, dryRun);
  removeFile(paths.nativeHostLauncher, removed, dryRun);
  removeFile(paths.browserMcpLauncher, removed, dryRun);
  removeFile(paths.browserProfile, removed, dryRun);
  removeDirectoryIfEmpty(paths.stateDir, removed, dryRun);

  const result = Object.freeze({
    dryRun,
    removed: Object.freeze([...removed]),
    preserved: Object.freeze([...preserved]),
  });

  if (print) {
    process.stdout.write(dryRun ? 'Local Browser WebMCP uninstall dry-run\n' : 'Local Browser WebMCP uninstalled\n');
    for (const item of removed) process.stdout.write(`[REMOVE${dryRun ? ' WOULD' : 'D'}] ${item}\n`);
    process.stdout.write('Preserved shared/Native-owned assets:\n');
    for (const item of preserved) process.stdout.write(`[KEEP] ${item}\n`);
    process.stdout.write('The source repository and Native WebMCP were not removed.\n');
  }

  return result;
}

function parseArgs(argv) {
  if (argv.length === 0) return { dryRun: false };
  if (argv.length === 1 && argv[0] === '--dry-run') return { dryRun: true };
  throw new Error('Usage: npm run local:uninstall [-- --dry-run]');
}

const mainPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (mainPath === fileURLToPath(import.meta.url)) {
  try {
    await runLocalUninstall(parseArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`Local uninstall failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

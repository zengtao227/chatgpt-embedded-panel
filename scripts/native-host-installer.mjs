#!/usr/bin/env node
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BROWSER_NATIVE_HOST_NAME } from '../browser-native-protocol.js';

const EXTENSION_ID = /^[a-p]{32}$/;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write('Usage: node scripts/native-host-installer.mjs --extension-id <Chrome extension id>\n');
  process.exit(2);
}

function parseArgs(argv) {
  let extensionId = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--extension-id') usage(`Unknown option: ${arg}`);
    extensionId = argv[++index] ?? usage('Missing value for --extension-id.');
  }
  if (!EXTENSION_ID.test(extensionId ?? '')) usage('Invalid Chrome extension id.');
  return { extensionId };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function nativeHostManifest({ extensionId, launcherPath }) {
  if (!EXTENSION_ID.test(extensionId)) throw new Error('Invalid Chrome extension id.');
  if (!path.isAbsolute(launcherPath)) throw new Error('Native host launcher path must be absolute.');
  return {
    name: BROWSER_NATIVE_HOST_NAME,
    description: 'ChatGPT Embedded Panel Browser MCP bridge',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

export async function installBrowserNativeHost({ extensionId, home = os.homedir() }) {
  if (process.platform !== 'darwin') {
    throw new Error('Browser MCP native-host installer currently supports macOS with Google Chrome only.');
  }

  const stateDir = path.join(home, '.chatgpt-embedded-panel');
  const launcherPath = path.join(stateDir, 'browser-native-host');
  const manifestDir = path.join(
    home,
    'Library',
    'Application Support',
    'Google',
    'Chrome',
    'NativeMessagingHosts',
  );
  const manifestPath = path.join(manifestDir, `${BROWSER_NATIVE_HOST_NAME}.json`);
  const hostScript = path.join(projectRoot, 'browser-mcp', 'browser-native-host.js');

  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  await mkdir(manifestDir, { recursive: true });

  await writeFile(launcherPath, [
    '#!/bin/sh',
    `exec ${shellQuote(process.execPath)} ${shellQuote(hostScript)}`,
    '',
  ].join('\n'), { mode: 0o755 });
  await chmod(launcherPath, 0o755);

  const manifest = nativeHostManifest({ extensionId, launcherPath });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await chmod(manifestPath, 0o600);

  return {
    host: BROWSER_NATIVE_HOST_NAME,
    launcherPath,
    manifestPath,
    extensionOrigin: `chrome-extension://${extensionId}/`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { extensionId } = parseArgs(process.argv.slice(2));
  const result = await installBrowserNativeHost({ extensionId });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

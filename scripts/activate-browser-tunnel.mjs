#!/usr/bin/env node
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;
const PROFILE = 'browser-mcp';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(message);
}

export function parseArgs(argv) {
  const options = { tunnelId: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--tunnel-id') fail(`Unknown option: ${arg}`);
    options.tunnelId = argv[++index] ?? fail('Missing value for --tunnel-id.');
  }
  if (!TUNNEL_ID_PATTERN.test(options.tunnelId ?? '')) {
    fail('A valid tunnel_<32 lowercase hex> id is required.');
  }
  return options;
}

async function executable(file) {
  try {
    await access(file, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveTunnelClient({
  home = os.homedir(),
  pathEnv = process.env.PATH ?? '',
} = {}) {
  const managed = path.join(home, '.local', 'share', 'webmcp', 'bin', 'tunnel-client');
  if (await executable(managed)) return managed;

  for (const directory of pathEnv.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, 'tunnel-client');
    if (await executable(candidate)) return candidate;
  }

  fail('tunnel-client was not found. Expected ~/.local/share/webmcp/bin/tunnel-client or PATH.');
}

export async function readControlPlaneApiKey({
  profilePath,
  env = process.env,
} = {}) {
  if (typeof env.CONTROL_PLANE_API_KEY === 'string' && env.CONTROL_PLANE_API_KEY.trim()) {
    return env.CONTROL_PLANE_API_KEY.trim();
  }

  const raw = await readFile(profilePath, 'utf8').catch(() => {
    fail(`Existing Native tunnel profile was not found: ${profilePath}`);
  });

  let profile;
  try {
    profile = JSON.parse(raw);
  } catch {
    fail('Existing Native tunnel profile is not valid JSON; set CONTROL_PLANE_API_KEY locally and retry.');
  }

  const configured = profile?.control_plane?.api_key;
  if (typeof configured !== 'string' || !configured.trim()) {
    fail('Existing Native tunnel profile does not contain control_plane.api_key.');
  }

  const value = configured.trim();
  if (!value.startsWith('file:')) return value;

  const secretPath = value.slice('file:'.length);
  if (!path.isAbsolute(secretPath)) fail('Native tunnel profile uses a non-absolute API key file reference.');
  const secret = (await readFile(secretPath, 'utf8')).trim();
  if (!secret) fail('Native tunnel API key file is empty.');
  return secret;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function launcherContent({
  nodePath,
  serverPath,
  socketPath,
} = {}) {
  if (!path.isAbsolute(nodePath) || !path.isAbsolute(serverPath)) {
    fail('Node and Browser MCP server paths must be absolute.');
  }
  if (!path.isAbsolute(socketPath ?? '')) {
    fail('Browser MCP socket path must be absolute.');
  }
  // The launcher is spawned by tunnel-client, whose LaunchAgent isolates HOME. Pinning the
  // socket here keeps the MCP server on the OS user's socket, where the Chrome native host
  // listens, instead of following the tunnel HOME into a path nothing ever binds.
  return [
    '#!/bin/sh',
    `CHATGPT_PANEL_BROWSER_SOCKET=${shellQuote(socketPath)} exec ${shellQuote(nodePath)} ${shellQuote(serverPath)}`,
    '',
  ].join('\n');
}

function run(client, args, env) {
  const result = spawnSync(client, args, {
    env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`tunnel-client ${args[0]} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

// The profile is compared as text rather than parsed, because tunnel-client owns its
// serialization and uses two dialects: `init --sample` writes commented YAML, `runtimes
// connect` writes JSON with quoted keys and trailing commas. Key quoting, value quoting, the
// YAML list dash and a trailing comma are therefore all optional.
//
// Each key is read from its own anchored line and must occur exactly once, which keeps this
// equivalent to the structural check it replaced: a bare substring test would accept a tunnel
// id that only appears in a comment, or a launcher that is merely one of several
// mcp.commands entries.
function soleValue(profileText, key) {
  const prefixSource = `^[ \\t]*-?[ \\t]*"?${key}"?:[ \\t]*`;
  const matches = profileText.match(new RegExp(`${prefixSource}.*$`, 'gm'));
  if (!matches || matches.length !== 1) return null;
  return matches[0]
    .replace(new RegExp(prefixSource), '')
    .trim()
    .replace(/,$/, '')
    .trim()
    .replace(/^["']|["']$/g, '');
}

export function profileMatches(profileText, { tunnelId, launcherPath } = {}) {
  if (typeof profileText !== 'string') return false;
  return soleValue(profileText, 'tunnel_id') === tunnelId
    && soleValue(profileText, 'channel') === 'main'
    && soleValue(profileText, 'command') === launcherPath;
}

export async function activateBrowserTunnel({
  tunnelId,
  home = os.homedir(),
  nodePath = process.execPath,
  env = process.env,
} = {}) {
  if (!TUNNEL_ID_PATTERN.test(tunnelId ?? '')) {
    fail('A valid tunnel id is required.');
  }

  const tunnelClient = await resolveTunnelClient({ home, pathEnv: env.PATH ?? '' });
  const profileDir = path.join(home, '.config', 'tunnel-client');
  const nativeProfilePath = path.join(profileDir, 'native.yaml');
  const browserProfilePath = path.join(profileDir, `${PROFILE}.yaml`);
  const stateDir = path.join(home, '.chatgpt-embedded-panel');
  const launcherPath = path.join(stateDir, 'browser-mcp-server');
  const serverPath = path.join(projectRoot, 'browser-mcp', 'stdio-server.js');

  const apiKey = await readControlPlaneApiKey({
    profilePath: nativeProfilePath,
    env,
  });

  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  await writeFile(
    launcherPath,
    launcherContent({ nodePath, serverPath, socketPath: path.join(stateDir, 'browser-mcp.sock') }),
    { mode: 0o755 },
  );
  await chmod(launcherPath, 0o755);

  const childEnv = {
    ...env,
    CONTROL_PLANE_API_KEY: apiKey,
  };

  let existing = null;
  try {
    existing = await readFile(browserProfilePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      fail(`Unable to read existing Browser MCP profile: ${browserProfilePath}`);
    }
  }

  if (existing !== null) {
    if (!profileMatches(existing, { tunnelId, launcherPath })) {
      fail('Existing browser-mcp profile does not match this tunnel and launcher; refusing to overwrite it.');
    }
    process.stdout.write('Existing browser-mcp profile matches; reusing it.\n');
  } else {
    process.stdout.write('Creating browser-mcp tunnel profile...\n');
    run(tunnelClient, [
      'init',
      '--sample', 'sample_mcp_stdio_local',
      '--profile', PROFILE,
      '--tunnel-id', tunnelId,
      '--mcp-command', launcherPath,
    ], childEnv);
  }

  process.stdout.write('Running tunnel-client doctor...\n');
  run(tunnelClient, ['doctor', '--profile', PROFILE, '--explain'], childEnv);

  process.stdout.write([
    '',
    'Browser MCP tunnel is ready.',
    'Starting the foreground tunnel runtime now.',
    'Keep this Terminal open while testing the Embedded Panel.',
    'Press Ctrl-C later to stop only Browser MCP; Native WebMCP is unaffected.',
    '',
  ].join('\n'));

  run(tunnelClient, ['run', '--profile', PROFILE], childEnv);
}

const mainPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (mainPath === fileURLToPath(import.meta.url)) {
  const { tunnelId } = parseArgs(process.argv.slice(2));
  await activateBrowserTunnel({ tunnelId });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  launcherContent,
  parseArgs,
  profileMatches,
  readControlPlaneApiKey,
} from '../scripts/activate-browser-tunnel.mjs';

test('activation helper accepts only a tunnel id', () => {
  assert.deepEqual(
    parseArgs(['--tunnel-id', 'tunnel_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb']),
    { tunnelId: 'tunnel_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  );
  assert.throws(
    () => parseArgs(['--tunnel-id', 'not-a-tunnel']),
    /valid tunnel/,
  );
});

test('activation helper reads the existing Native credential without changing the profile', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-tunnel-helper-'));
  const profilePath = path.join(root, 'native.yaml');
  const before = JSON.stringify({
    control_plane: {
      api_key: 'sk-test-only',
      tunnel_id: 'tunnel_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    },
  }, null, 2);
  await writeFile(profilePath, before);

  const key = await readControlPlaneApiKey({
    profilePath,
    env: {},
  });

  assert.equal(key, 'sk-test-only');
  assert.equal(await readFile(profilePath, 'utf8'), before);
});

test('activation helper follows a file: credential reference without exposing it in launcher content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-tunnel-secret-'));
  const secretPath = path.join(root, 'runtime-key');
  const profilePath = path.join(root, 'native.yaml');
  await writeFile(secretPath, 'sk-file-only\n');
  await writeFile(profilePath, JSON.stringify({
    control_plane: { api_key: `file:${secretPath}` },
  }));

  const key = await readControlPlaneApiKey({ profilePath, env: {} });
  assert.equal(key, 'sk-file-only');

  const launcher = launcherContent({
    nodePath: '/usr/local/bin/node',
    serverPath: '/Users/example/My code/browser-mcp/stdio-server.js',
    socketPath: '/Users/example/.chatgpt-embedded-panel/browser-mcp.sock',
  });
  assert.match(launcher, /exec '\/usr\/local\/bin\/node'/);
  assert.match(launcher, /'\/Users\/example\/My code\/browser-mcp\/stdio-server\.js'/);
  assert.doesNotMatch(launcher, /sk-file-only/);
});

// The LaunchAgent runs tunnel-client with an isolated HOME, so a launcher that leaves the
// socket to HOME resolution reaches a path the Chrome native host never binds, and every
// tool call fails as BROWSER_BRIDGE_UNAVAILABLE.
test('launcher pins the browser socket so tunnel HOME isolation cannot move it', () => {
  const launcher = launcherContent({
    nodePath: '/usr/local/bin/node',
    serverPath: '/Users/example/browser-mcp/stdio-server.js',
    socketPath: '/Users/example/.chatgpt-embedded-panel/browser-mcp.sock',
  });
  assert.match(
    launcher,
    /^CHATGPT_PANEL_BROWSER_SOCKET='\/Users\/example\/\.chatgpt-embedded-panel\/browser-mcp\.sock' exec /m,
  );
  assert.throws(
    () => launcherContent({
      nodePath: '/usr/local/bin/node',
      serverPath: '/Users/example/browser-mcp/stdio-server.js',
    }),
    /socket path must be absolute/,
  );
});

const GENERATED_PROFILE = [
  'config_version: 1',
  'control_plane:',
  '  base_url: "https://api.openai.com"',
  '  tunnel_id: "tunnel_cccccccccccccccccccccccccccccccc"',
  '  api_key: "file:/Users/example/Library/secrets/native-runtime-api-key"',
  'health:',
  '  listen_addr: "127.0.0.1:0"',
  'mcp:',
  '  commands:',
  '    - channel: main',
  '      command: "/Users/example/.chatgpt-embedded-panel/browser-mcp-server"',
  '',
].join('\n');

const GENERATED_EXPECTATION = {
  tunnelId: 'tunnel_cccccccccccccccccccccccccccccccc',
  launcherPath: '/Users/example/.chatgpt-embedded-panel/browser-mcp-server',
};

test('profile match accepts the generated YAML profile for this tunnel and launcher', () => {
  assert.equal(profileMatches(GENERATED_PROFILE, GENERATED_EXPECTATION), true);
});

test('profile match rejects a different tunnel id or launcher', () => {
  assert.equal(profileMatches(GENERATED_PROFILE, {
    ...GENERATED_EXPECTATION,
    tunnelId: 'tunnel_dddddddddddddddddddddddddddddddd',
  }), false);
  assert.equal(profileMatches(GENERATED_PROFILE, {
    ...GENERATED_EXPECTATION,
    launcherPath: '/Users/example/.chatgpt-embedded-panel/other-server',
  }), false);
  assert.equal(profileMatches(undefined, GENERATED_EXPECTATION), false);
});

test('profile match rejects a tunnel id that only appears in a comment', () => {
  const commented = GENERATED_PROFILE
    .replace('  tunnel_id: "tunnel_cccccccccccccccccccccccccccccccc"', [
      '  # tunnel_id: "tunnel_cccccccccccccccccccccccccccccccc"',
      '  tunnel_id: "tunnel_dddddddddddddddddddddddddddddddd"',
    ].join('\n'));
  assert.equal(profileMatches(commented, GENERATED_EXPECTATION), false);
});

test('profile match rejects a launcher that is only one of several mcp commands', () => {
  const extraCommand = GENERATED_PROFILE.replace(
    '      command: "/Users/example/.chatgpt-embedded-panel/browser-mcp-server"',
    [
      '      command: "/Users/example/.chatgpt-embedded-panel/browser-mcp-server"',
      '    - channel: side',
      '      command: "/Users/example/.chatgpt-embedded-panel/unexpected-server"',
    ].join('\n'),
  );
  assert.equal(profileMatches(extraCommand, GENERATED_EXPECTATION), false);
});

// `runtimes connect` rewrites the profile as JSON, so the matcher must handle quoted keys and
// trailing commas as well as the YAML that `init --sample` produces. Captured from a real
// preflight run on 2026-09-20.
const CONNECT_GENERATED_PROFILE = [
  '{',
  '  "admin_ui": {',
  '    "open_browser": false',
  '  },',
  '  "config_version": 1,',
  '  "control_plane": {',
  '    "api_key": "file:/Users/example/Library/secrets/native-runtime-api-key",',
  '    "base_url": "https://api.openai.com",',
  '    "tunnel_id": "tunnel_cccccccccccccccccccccccccccccccc"',
  '  },',
  '  "health": {',
  '    "listen_addr": "127.0.0.1:0",',
  '    "url_file": "/Users/example/browser-tunnel-home/health/webmcp-browser.url"',
  '  },',
  '  "mcp": {',
  '    "commands": [',
  '      {',
  '        "channel": "main",',
  '        "command": "/Users/example/.chatgpt-embedded-panel/browser-mcp-server"',
  '      }',
  '    ]',
  '  }',
  '}',
  '',
].join('\n');

test('profile match accepts the JSON profile that runtimes connect writes', () => {
  assert.equal(profileMatches(CONNECT_GENERATED_PROFILE, GENERATED_EXPECTATION), true);
});

test('profile match still rejects a mismatch in the JSON dialect', () => {
  assert.equal(profileMatches(CONNECT_GENERATED_PROFILE, {
    ...GENERATED_EXPECTATION,
    tunnelId: 'tunnel_dddddddddddddddddddddddddddddddd',
  }), false);
});

test('the ephemeral health gate accepts both profile dialects and rejects a fixed port', () => {
  // Kept in sync with EPHEMERAL_HEALTH_PATTERN in install-browser-tunnel-launchd.mjs, which
  // runs at module scope and so cannot be imported without performing an install.
  const gate = /^[ \t]*"?listen_addr"?:[ \t]*["']?127\.0\.0\.1:0["']?,?[ \t]*$/m;
  assert.equal(gate.test(CONNECT_GENERATED_PROFILE), true);
  assert.equal(gate.test(GENERATED_PROFILE), true);
  assert.equal(gate.test('health:\n  listen_addr: "127.0.0.1:8080"\n'), false);
  assert.equal(
    gate.test('  # switch listen_addr to "127.0.0.1:0" for clean-room runs\n  listen_addr: "127.0.0.1:8080"\n'),
    false,
  );
});

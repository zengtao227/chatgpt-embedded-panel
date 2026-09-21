import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../setup/webmcp-setup.sh', import.meta.url));
const skipUnlessMac = process.platform !== 'darwin' && 'setup script targets macOS';

// A PATH holding only stub commands plus the system tools, with an isolated HOME, so the real
// node/git/docker/nvm/tunnel-client on the machine running the test cannot leak in.
function sandbox(stubs = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'setup-script-'));
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  for (const [name, body] of Object.entries(stubs)) {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(path.join(bin, name), 0o755);
  }
  return { root, bin, home };
}

function run(args, { bin, home }, extraEnv = {}) {
  const result = spawnSync('/bin/bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, WEBMCP_SETUP_EXTRA_PATH: '', ...extraEnv },
  });
  return { status: result.status, out: result.stdout, signal: result.signal };
}

function bareRepos(root, names) {
  const base = path.join(root, 'remote');
  for (const name of names) {
    const dir = path.join(base, `${name}.git`);
    mkdirSync(dir, { recursive: true });
    for (const args of [['init', '-q'], ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x']]) {
      spawnSync('git', args, { cwd: dir });
    }
  }
  return `file://${base}`;
}

const line = (out, prefix) => out.split('\n').find((entry) => entry.startsWith(prefix));

test('missing prerequisites fail with one FIX line each and exit 1', { skip: skipUnlessMac }, () => {
  const box = sandbox();
  const { status, out } = run(['check', '--components', 'native'], box, { WEBMCP_SETUP_REPO_BASE: 'file:///nonexistent' });
  assert.equal(status, 1);
  assert.match(line(out, 'CHECK node'), /FAIL not installed/);
  assert.match(line(out, 'FIX node'), /^FIX node MANUAL .*nodejs\.org/);
  assert.match(line(out, 'CHECK docker-cli'), /FAIL/);
  assert.match(line(out, 'CHECK docker-running'), /SKIP/);
  assert.match(line(out, 'FIX tunnel-client'), /^FIX tunnel-client AUTO .*fetch-tunnel-client/);
  assert.match(line(out, 'FIX repo:webmcp-bridge'), /^FIX repo:webmcp-bridge MANUAL .*invite your GitHub account/);
  assert.match(line(out, 'RESULT'), /^RESULT FAIL failed=/);
});

test('Node older than 22 fails; 22 passes', { skip: skipUnlessMac }, () => {
  const old = sandbox({ node: 'if [ "$1" = "-v" ]; then echo v18.0.0; else echo 18; fi' });
  assert.match(line(run(['check', '--components', 'deepseek'], old).out, 'CHECK node'), /FAIL v18\.0\.0 is older than 22/);
  const current = sandbox({ node: 'if [ "$1" = "-v" ]; then echo v22.1.0; else echo 22; fi' });
  assert.match(line(run(['check', '--components', 'deepseek'], current).out, 'CHECK node'), /PASS v22\.1\.0/);
});

test('a Docker that is installed but not running is an AUTO fix; a running one passes', { skip: skipUnlessMac }, () => {
  const stopped = sandbox({ docker: 'exit 1' });
  const stoppedOut = run(['check', '--components', 'deepseek'], stopped).out;
  assert.match(line(stoppedOut, 'CHECK docker-cli'), /PASS/);
  assert.match(line(stoppedOut, 'CHECK docker-running'), /FAIL/);
  assert.match(line(stoppedOut, 'FIX docker-running'), /^FIX docker-running AUTO open -a Docker/);
  const running = sandbox({ docker: 'exit 0' });
  assert.match(line(run(['check', '--components', 'deepseek'], running).out, 'CHECK docker-running'), /PASS/);
});

test('repository access is checked per chosen component only', { skip: skipUnlessMac }, () => {
  const box = sandbox();
  const base = bareRepos(box.root, ['deepseek-webmcp']);
  const { out } = run(['check', '--components', 'deepseek'], box, { WEBMCP_SETUP_REPO_BASE: base });
  assert.match(line(out, 'CHECK repo:deepseek-webmcp'), /PASS readable/);
  assert.equal(line(out, 'CHECK repo:webmcp-bridge'), undefined);
});

test('tunnel-client is found in the managed location', { skip: skipUnlessMac }, () => {
  const box = sandbox();
  const managed = path.join(box.home, '.local/share/webmcp/bin');
  mkdirSync(managed, { recursive: true });
  writeFileSync(path.join(managed, 'tunnel-client'), '#!/bin/sh\n');
  chmodSync(path.join(managed, 'tunnel-client'), 0o755);
  const { out } = run(['check', '--components', 'panel'], box, { WEBMCP_SETUP_REPO_BASE: 'file:///nonexistent' });
  assert.match(line(out, 'CHECK tunnel-client'), /PASS .*tunnel-client/);
});

test('doctor reports NOT-INSTALLED, PASS and FAIL from each component\'s own exit code', { skip: skipUnlessMac }, () => {
  const box = sandbox({ npm: 'if [ "$3" = "doctor" ] && [ "$(basename "$PWD")" = "bad" ]; then echo broken layer; exit 3; fi; exit 0' });
  const good = path.join(box.root, 'good');
  const bad = path.join(box.root, 'bad');
  mkdirSync(good);
  mkdirSync(bad);
  const env = { WEBMCP_PANEL_DIR: good, WEBMCP_NATIVE_DIR: path.join(box.root, 'absent'), WEBMCP_DEEPSEEK_DIR: bad };
  const { status, out } = run(['doctor'], box, env);
  assert.match(line(out, 'DOCTOR panel'), /PASS/);
  assert.match(line(out, 'DOCTOR native'), /NOT-INSTALLED/);
  assert.match(line(out, 'DOCTOR deepseek'), /FAIL exit=3/);
  assert.match(out, /\| broken layer/);
  assert.equal(status, 1);
});

test('unknown components and commands are refused', { skip: skipUnlessMac }, () => {
  const box = sandbox();
  assert.equal(run(['check', '--components', 'bogus'], box).status, 2);
  assert.equal(run(['frobnicate'], box).status, 2);
});

test('doctor fails when a chosen component is not installed, even if nothing else failed', { skip: skipUnlessMac }, () => {
  const box = sandbox();
  const { status, out } = run(['doctor', '--components', 'native'], box, { WEBMCP_NATIVE_DIR: path.join(box.root, 'absent') });
  assert.match(line(out, 'DOCTOR native'), /NOT-INSTALLED/);
  assert.match(line(out, 'RESULT'), /^RESULT FAIL failed=1/);
  assert.equal(status, 1);
});

test('an option without its value exits with an error instead of looping', { skip: skipUnlessMac }, () => {
  const box = sandbox();
  for (const args of [['check', '--components'], ['fetch-tunnel-client', '--version'], ['save-key', '--file']]) {
    const result = run(args, box);
    assert.equal(result.signal, null, `${args.join(' ')} must not hang`);
    assert.equal(result.status, 2);
    assert.match(result.out, /Missing value/);
  }
});

test('tunnel-client in the setup preparation folder is found', { skip: skipUnlessMac }, () => {
  const box = sandbox();
  const prep = path.join(box.home, '.local/share/webmcp-setup/bin');
  mkdirSync(prep, { recursive: true });
  writeFileSync(path.join(prep, 'tunnel-client'), '#!/bin/sh\n');
  chmodSync(path.join(prep, 'tunnel-client'), 0o755);
  const { out } = run(['check', '--components', 'panel'], box, { WEBMCP_SETUP_REPO_BASE: 'file:///nonexistent' });
  assert.match(line(out, 'CHECK tunnel-client'), /PASS .*webmcp-setup\/bin\/tunnel-client/);
});

// A fake curl that serves a fixture folder, so the download path is tested without the network.
const CURL_STUB = `
out=""; url=""; w=0
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; -w) w=1; shift 2 ;; -*) shift ;; *) url="$1"; shift ;; esac; done
if [ "$w" = 1 ]; then echo "https://github.com/openai/tunnel-client/releases/tag/v9.9.9"; exit 0; fi
case "$url" in
  *SHA256SUMS.txt) cp "$FIXTURE/SHA256SUMS.txt" "$out" ;;
  *.zip) cp "$FIXTURE/$(basename "$url")" "$out" ;;
  *) exit 22 ;;
esac
`;

function fetchFixture(box, tag, { goodSum = true } = {}) {
  const arch = spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout.trim() === 'arm64' ? 'arm64' : 'amd64';
  const fixture = path.join(box.root, 'fixture');
  mkdirSync(fixture, { recursive: true });
  const binary = path.join(fixture, 'tunnel-client');
  writeFileSync(binary, '#!/bin/sh\necho fake tunnel-client\n');
  chmodSync(binary, 0o755);
  const zip = path.join(fixture, `tunnel-client-${tag}-darwin-${arch}.zip`);
  spawnSync('/usr/bin/zip', ['-q', '-j', zip, binary]);
  const sum = createHash('sha256').update(readFileSync(zip)).digest('hex');
  writeFileSync(path.join(fixture, 'SHA256SUMS.txt'), `${goodSum ? sum : '0'.repeat(64)}  ${path.basename(zip)}\n`);
  return fixture;
}

test('fetch-tunnel-client installs a verified binary into the preparation folder, not the Native state folder', { skip: skipUnlessMac }, () => {
  const box = sandbox({ curl: CURL_STUB });
  const fixture = fetchFixture(box, 'v9.9.9');
  const { status, out } = run(['fetch-tunnel-client'], box, { FIXTURE: fixture });
  assert.equal(status, 0);
  assert.match(line(out, 'FETCH'), /^FETCH PASS v9\.9\.9 .*webmcp-setup\/bin\/tunnel-client/);
  assert.ok(existsSync(path.join(box.home, '.local/share/webmcp-setup/bin/tunnel-client')));
  assert.equal(existsSync(path.join(box.home, '.local/share/webmcp')), false, 'nothing is written where Native reads install state');
});

test('fetch-tunnel-client honours --version', { skip: skipUnlessMac }, () => {
  const box = sandbox({ curl: CURL_STUB });
  const fixture = fetchFixture(box, 'v1.2.3');
  const { status, out } = run(['fetch-tunnel-client', '--version', 'v1.2.3'], box, { FIXTURE: fixture });
  assert.equal(status, 0);
  assert.match(line(out, 'FETCH'), /^FETCH PASS v1\.2\.3 /);
});

test('fetch-tunnel-client refuses a checksum mismatch and writes nothing', { skip: skipUnlessMac }, () => {
  const box = sandbox({ curl: CURL_STUB });
  const fixture = fetchFixture(box, 'v9.9.9', { goodSum: false });
  const { status, out } = run(['fetch-tunnel-client'], box, { FIXTURE: fixture });
  assert.equal(status, 1);
  assert.match(line(out, 'FETCH'), /FAIL checksum mismatch/);
  assert.equal(existsSync(path.join(box.home, '.local/share/webmcp-setup/bin/tunnel-client')), false);
});

test('a failed write never reports success and leaves an existing tunnel-client as it was', { skip: skipUnlessMac }, () => {
  const box = sandbox({ curl: CURL_STUB });
  const fixture = fetchFixture(box, 'v9.9.9');
  const prep = path.join(box.home, '.local/share/webmcp-setup/bin');
  mkdirSync(prep, { recursive: true });
  writeFileSync(path.join(prep, 'tunnel-client'), 'OLD');
  chmodSync(prep, 0o500);
  try {
    const { status, out } = run(['fetch-tunnel-client'], box, { FIXTURE: fixture });
    assert.equal(status, 1);
    assert.match(line(out, 'FETCH'), /FAIL could not write/);
    assert.equal(readFileSync(path.join(prep, 'tunnel-client'), 'utf8'), 'OLD');
  } finally {
    chmodSync(prep, 0o700);
  }
});

test('save-key stores the clipboard at mode 600 and never prints it', { skip: skipUnlessMac }, () => {
  const box = sandbox({ pbpaste: 'printf "%s" "sk-test-secret-value"' });
  const file = path.join(box.home, 'key');
  const { status, out } = run(['save-key', '--file', file], box);
  assert.equal(status, 0);
  assert.match(line(out, 'KEY'), /^KEY PASS .* mode=600$/);
  assert.ok(!out.includes('sk-test-secret-value'));
  assert.equal(readFileSync(file, 'utf8').trim(), 'sk-test-secret-value');
  assert.equal((lstatSync(file).mode & 0o777).toString(8), '600');
});

test('save-key never overwrites an existing file or follows a symlink, and rejects bad clipboards', { skip: skipUnlessMac }, () => {
  const box = sandbox({ pbpaste: 'printf "%s" "new-secret"' });
  const existing = path.join(box.home, 'existing');
  writeFileSync(existing, 'keep');
  chmodSync(existing, 0o644);
  assert.match(line(run(['save-key', '--file', existing], box).out, 'KEY'), /^KEY FAIL .*already exists/);
  assert.equal(readFileSync(existing, 'utf8'), 'keep');
  assert.equal((lstatSync(existing).mode & 0o777).toString(8), '644', 'permissions are not changed either');

  const target = path.join(box.home, 'target');
  writeFileSync(target, 'target-content');
  const link = path.join(box.home, 'link');
  symlinkSync(target, link);
  assert.match(line(run(['save-key', '--file', link], box).out, 'KEY'), /^KEY FAIL/);
  assert.equal(readFileSync(target, 'utf8'), 'target-content');

  const empty = sandbox({ pbpaste: 'printf ""' });
  assert.match(line(run(['save-key', '--file', path.join(empty.home, 'k')], empty).out, 'KEY'), /clipboard is empty/);
  assert.equal(existsSync(path.join(empty.home, 'k')), false);

  const multi = sandbox({ pbpaste: 'printf "a\\nb"' });
  assert.match(line(run(['save-key', '--file', path.join(multi.home, 'k')], multi).out, 'KEY'), /more than one line/);
  assert.equal(existsSync(path.join(multi.home, 'k')), false);
});

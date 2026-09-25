// launch.js — start the MCP server, resolving the Python MCP SDK rather than assuming it.
//
// WHY NODE AND NOT BASH (#1233). The manifests have no per-platform variants, so their command must be
// one program name that means the right thing everywhere. `bash` does not: on Windows it is WSL's or
// nothing (see find-bash.js), and the server never started (CONNECTION_CLOSED). `python3` does not
// either: on Windows it is a Microsoft Store placeholder and a python.org install has only `python`,
// while macOS and Linux may have only `python3`. `node` is the same name on every platform, and building
// a graph already needs it.
//
// server.py imports `mcp`, and nothing on a fresh machine installs it: the plugin declares no Python
// dependency and npm cannot express one. Order: an interpreter that already has the SDK wins (fastest, no
// network, respects a venv the user set up). Otherwise uv fetches it into an ephemeral environment, which
// is the one command that works on a clean machine without asking to install anything globally. Otherwise
// any interpreter that runs, because server.py carries a dependency-free fallback for the sliver of the
// protocol it uses and says on stderr which half it is running (#1105). An interpreter is taken only if
// it actually runs, so the WindowsApps placeholders, which exist on PATH and exit 9009, are passed over.
//
// uv is taken only once it has built its environment, not merely because it is on PATH (#1249). A failed
// resolve (offline, a proxy, a transitive dependency with no wheel for the host, such as an x86_64 uv under
// Rosetta asked for `cryptography`) makes the real start exit before `initialize`, and the client sees only
// CONNECTION_CLOSED while the fallback that would have served is never tried. So uv is first asked to import
// the SDK in that same environment, within a time limit; on success its cache is warm and the real start
// reuses it, on failure the launcher says why and moves on to the fallback.
//
// The server shells out to the CLI, a bash script, so the bash find-bash.js chose is handed to it as
// AXIOMCODE_BASH; a bare `bash` from server.py would hit the same Windows lookup this file avoids. That CLI
// calls `python3`, so the server's environment also carries find-python.js's python3 for bash (#1331).
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const { findBash } = require('./find-bash.js');
const { candidates, findPython, withPython } = require('./find-python.js');

const SERVER = path.join(__dirname, 'server.py');
// Run as `node launch.js …` the rest of the command line is the server's; required from mcp.json's
// `node -e` there is none.
const args = require.main === module ? process.argv.slice(2) : [];

const runs = (cmd, argv) => spawnSync(cmd[0], [...cmd.slice(1), ...argv], { stdio: 'ignore', windowsHide: true }).status === 0;

const UV = ['uv', 'run', '--quiet', '--with', 'mcp', 'python'];
// A first resolve on a clean machine downloads the SDK and its dependencies, so the limit is generous; a
// probe that is still resolving when it runs out counts as failed rather than holding the client longer.
const UV_PROBE_MS = Number(process.env.AXIOMCODE_UV_TIMEOUT_MS) || 60000;

function uvWorks() {
  if (!runs(['uv'], ['--version'])) return false;
  const r = spawnSync(UV[0], [...UV.slice(1), '-c', 'import mcp'],
                      { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', timeout: UV_PROBE_MS, windowsHide: true });
  if (r.status === 0) return true;
  const why = r.error ? (r.error.code === 'ETIMEDOUT' ? `no answer within ${UV_PROBE_MS / 1000}s` : r.error.message)
                      : (String(r.stderr || '').trim().split('\n').pop() || `exit ${r.status}`);
  process.stderr.write(`axiomcode mcp: uv could not provide the MCP SDK (${why}); trying the SDK-free server.\n`);
  return false;
}

const pythons = candidates();

function choose() {
  for (const py of pythons) if (runs(py, ['-c', 'import mcp'])) return [...py, SERVER];
  if (uvWorks()) return [...UV, SERVER];
  for (const py of pythons) if (runs(py, ['-c', 'pass'])) return [...py, SERVER];
  return null;
}

const py = findPython();
const env = py.exe ? withPython(process.env, py) : { ...process.env };
const { bash, error } = findBash();
if (bash) env.AXIOMCODE_BASH = bash;
else process.stderr.write(`axiomcode mcp: ${error}\n  The server starts, but every tool will say it cannot run the CLI.\n`);

const cmd = choose();
if (!cmd) {
  process.stderr.write('axiomcode mcp: no python3 or python that runs, so the server cannot start at all.\n' +
                       '  The skill\'s CLI needs Python too; install it, or set AXIOMCODE_PYTHON.\n');
  process.exit(1);
}

// stdio is inherited, so the client talks to the server directly and this process only waits. A signal
// sent to it is passed on, so stopping the launcher stops the server rather than orphaning it.
const child = spawn(cmd[0], [...cmd.slice(1), ...args], { stdio: 'inherit', env, windowsHide: true });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => child.kill(sig));
child.on('error', (e) => { process.stderr.write(`axiomcode mcp: could not start ${cmd[0]}: ${e.message}\n`); process.exit(1); });
child.on('exit', (code, signal) => {
  if (signal) { process.removeAllListeners(signal); process.kill(process.pid, signal); }
  process.exit(code ?? 1);
});
